-- ============================================================================
-- Migration: 20261125_actividades_realtime_and_staff_roles.sql
-- Date: 2026-11-25
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Purpose:
--   1. Expand `public.is_teg_staff()` to include `'general_manager'` and
--      `'shift leader'` (space variant alongside `'shift_leader'`) while
--      preserving all existing authorized staff roles.
--   2. Idempotently add `public.station_assignments` and `public.shifts` to
--      the `supabase_realtime` publication so store tablets receive live
--      `postgres_changes` events when schedules or station assignments change.
--   3. Synchronize `public.get_station_assignments_revision` in production
--      with the deterministic MD5 row fingerprint (`202610210001`), pin
--      `search_path = public, pg_temp` on Actividades atomic RPCs, and preserve
--      strict `service_role`-only execution privileges.
-- ============================================================================

-- 1. Update `public.is_teg_staff()` preserving all existing roles + 'general_manager' & 'shift leader'
CREATE OR REPLACE FUNCTION public.is_teg_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT (
    auth.role() = 'service_role'
    OR public.teg_staff_role() = ANY (ARRAY[
      'admin',
      'supervisor',
      'regional_manager',
      'manager',
      'gerente',
      'general_manager',
      'asistente',
      'assistant',
      'shift_leader',
      'shift leader',
      'auditor',
      'planificador',
      'basecamp',
      'raquel',
      'external_accounting',
      'employee'
    ])
  );
$function$;

-- 2. Idempotently register `station_assignments` and `shifts` in `supabase_realtime`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'station_assignments'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.station_assignments;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'shifts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
    END IF;
  END IF;
END
$$;

-- 3. Synchronize `public.get_station_assignments_revision` (deterministic MD5 fingerprint)
--    and pin `search_path = public, pg_temp` on Actividades atomic RPCs
CREATE OR REPLACE FUNCTION public.get_station_assignments_revision(
    p_store_id text,
    p_start_date date,
    p_end_date date,
    p_active_shift text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count bigint;
    v_fingerprint text;
BEGIN
    SELECT
        count(*),
        md5(coalesce(string_agg(md5(to_jsonb(sa)::text), '' ORDER BY sa.id::text), ''))
    INTO v_count, v_fingerprint
    FROM public.station_assignments AS sa
    WHERE sa.store_id = p_store_id
      AND sa.assignment_date >= p_start_date
      AND sa.assignment_date <= p_end_date
      AND (
          p_active_shift IS NULL
          OR (
              upper(p_active_shift) = 'AM'
              AND (
                  coalesce(sa.sub_position, '') LIKE '%\_AM' ESCAPE '\'
                  OR (
                      coalesce(sa.sub_position, '') NOT LIKE '%\_AM' ESCAPE '\'
                      AND coalesce(sa.sub_position, '') NOT LIKE '%\_PM' ESCAPE '\'
                  )
              )
          )
          OR (
              upper(p_active_shift) = 'PM'
              AND coalesce(sa.sub_position, '') LIKE '%\_PM' ESCAPE '\'
          )
      );

    RETURN coalesce(v_count, 0)::text || ':' || coalesce(v_fingerprint, md5(''));
END;
$$;

ALTER FUNCTION public.replace_station_assignments_atomic(text, date, date, text, text, jsonb)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.replace_position_activities_atomic(text, jsonb)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_station_assignments_revision(text, date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_station_assignments_atomic(text, date, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_position_activities_atomic(text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_station_assignments_revision(text, date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_station_assignments_atomic(text, date, date, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_position_activities_atomic(text, jsonb) TO service_role;
