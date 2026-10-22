-- Migration: 202610210001_actividades_revision_fingerprint.sql
-- Purpose:
--   Use a deterministic fingerprint of every station assignment in the requested scope.
--   The previous count + max(updated_at in milliseconds) revision could miss same-count
--   concurrent edits committed within the same millisecond while a range was paginated.

CREATE OR REPLACE FUNCTION public.get_station_assignments_revision(
    p_store_id text,
    p_start_date date,
    p_end_date date,
    p_active_shift text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.get_station_assignments_revision(text, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_station_assignments_revision(text, date, date, text) TO service_role;

