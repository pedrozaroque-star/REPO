-- ============================================================================
-- Migration: 20261019_actividades_atomic_rpcs.sql
-- Purpose:
--   1. Atomic transactional replacement + optimistic concurrency control for
--      station_assignments (`replace_station_assignments_atomic`).
--   2. Atomic transactional replacement for position_activities
--      (`replace_position_activities_atomic`).
--   3. RLS hardening on position_activities (remove public write policy).
-- ============================================================================

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
    v_rev text;
BEGIN
    SELECT
        count(*)::text || ':' ||
        coalesce(max((extract(epoch from updated_at) * 1000)::bigint)::text, '0')
    INTO v_rev
    FROM public.station_assignments
    WHERE store_id = p_store_id
      AND assignment_date >= p_start_date
      AND assignment_date <= p_end_date
      AND (
          p_active_shift IS NULL
          OR (
              upper(p_active_shift) = 'AM'
              AND (
                  coalesce(sub_position, '') LIKE '%\_AM' ESCAPE '\'
                  OR (
                      coalesce(sub_position, '') NOT LIKE '%\_AM' ESCAPE '\'
                      AND coalesce(sub_position, '') NOT LIKE '%\_PM' ESCAPE '\'
                  )
              )
          )
          OR (
              upper(p_active_shift) = 'PM'
              AND coalesce(sub_position, '') LIKE '%\_PM' ESCAPE '\'
          )
      );

    RETURN coalesce(v_rev, '0:0');
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_station_assignments_atomic(
    p_store_id text,
    p_start_date date,
    p_end_date date,
    p_active_shift text DEFAULT NULL,
    p_expected_revision text DEFAULT NULL,
    p_assignments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_rev text;
    v_new_rev text;
    v_deleted_count integer := 0;
    v_inserted_count integer := 0;
    v_item jsonb;
    v_assign_date date;
    v_emp_id uuid;
    v_main_station text;
    v_sub_pos text;
    v_station_group text;
    v_is_closing boolean;
    v_tasks text[];
BEGIN
    IF p_store_id IS NULL OR btrim(p_store_id) = '' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: store_id es obligatorio';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Rango de fechas inválido (% a %)', p_start_date, p_end_date;
    END IF;

    IF p_active_shift IS NOT NULL AND upper(p_active_shift) NOT IN ('AM', 'PM') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: active_shift inválido (%)', p_active_shift;
    END IF;

    -- Serializar guardados concurrentes sobre la misma tienda (día individual o semana completa)
    PERFORM pg_advisory_xact_lock(
        hashtext('station_assignments:' || p_store_id)
    );

    v_current_rev := public.get_station_assignments_revision(
        p_store_id,
        p_start_date,
        p_end_date,
        p_active_shift
    );

    IF p_expected_revision IS NOT NULL
       AND btrim(p_expected_revision) <> ''
       AND p_expected_revision <> v_current_rev
       AND p_expected_revision <> public.get_station_assignments_revision(p_store_id, p_start_date, p_end_date, NULL) THEN
        RAISE EXCEPTION 'CONFLICT_REVISION_MISMATCH: El contexto fue modificado por otro usuario (esperada=%, actual=%)',
            p_expected_revision, v_current_rev;
    END IF;

    -- Eliminar asignaciones previas únicamente del ámbito autorizado dentro de la misma transacción
    DELETE FROM public.station_assignments
    WHERE store_id = p_store_id
      AND assignment_date >= p_start_date
      AND assignment_date <= p_end_date
      AND (
          p_active_shift IS NULL
          OR (
              upper(p_active_shift) = 'AM'
              AND (
                  coalesce(sub_position, '') LIKE '%\_AM' ESCAPE '\'
                  OR (
                      coalesce(sub_position, '') NOT LIKE '%\_AM' ESCAPE '\'
                      AND coalesce(sub_position, '') NOT LIKE '%\_PM' ESCAPE '\'
                  )
              )
          )
          OR (
              upper(p_active_shift) = 'PM'
              AND coalesce(sub_position, '') LIKE '%\_PM' ESCAPE '\'
          )
      );

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- Validar e insertar cada nueva asignación; cualquier error aborta toda la transacción y restaura el DELETE
    IF p_assignments IS NOT NULL AND jsonb_typeof(p_assignments) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignments)
        LOOP
            v_assign_date := (v_item->>'assignment_date')::date;
            IF v_assign_date IS NULL OR v_assign_date < p_start_date OR v_assign_date > p_end_date THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: assignment_date (%) fuera del rango autorizado (% a %)',
                    v_item->>'assignment_date', p_start_date, p_end_date;
            END IF;

            v_emp_id := (v_item->>'employee_id')::uuid;
            IF v_emp_id IS NULL THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: employee_id es obligatorio';
            END IF;

            v_main_station := btrim(coalesce(v_item->>'main_station', ''));
            IF v_main_station = '' THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: main_station es obligatorio';
            END IF;

            v_sub_pos := nullif(btrim(coalesce(v_item->>'sub_position', '')), '');
            IF p_active_shift IS NOT NULL AND v_sub_pos IS NOT NULL THEN
                IF upper(p_active_shift) = 'AM' AND v_sub_pos LIKE '%\_PM' ESCAPE '\' THEN
                    RAISE EXCEPTION 'VALIDATION_ERROR: sub_position (%) no coincide con turno AM', v_sub_pos;
                END IF;
                IF upper(p_active_shift) = 'PM' AND v_sub_pos LIKE '%\_AM' ESCAPE '\' THEN
                    RAISE EXCEPTION 'VALIDATION_ERROR: sub_position (%) no coincide con turno PM', v_sub_pos;
                END IF;
            END IF;

            v_station_group := lower(btrim(coalesce(v_item->>'station_group', 'front')));
            IF v_station_group = '' THEN
                v_station_group := 'front';
            END IF;

            v_is_closing := coalesce((v_item->>'is_closing')::boolean, false);

            IF v_item ? 'tasks' AND jsonb_typeof(v_item->'tasks') = 'array' THEN
                SELECT coalesce(array_agg(elem), ARRAY[]::text[])
                INTO v_tasks
                FROM jsonb_array_elements_text(v_item->'tasks') AS elem;
            ELSE
                v_tasks := ARRAY[]::text[];
            END IF;

            INSERT INTO public.station_assignments (
                store_id,
                assignment_date,
                employee_id,
                station_group,
                main_station,
                sub_position,
                is_closing,
                tasks,
                updated_at
            ) VALUES (
                p_store_id,
                v_assign_date,
                v_emp_id,
                v_station_group,
                v_main_station,
                v_sub_pos,
                v_is_closing,
                v_tasks,
                now()
            );

            v_inserted_count := v_inserted_count + 1;
        END LOOP;
    END IF;

    v_new_rev := public.get_station_assignments_revision(
        p_store_id,
        p_start_date,
        p_end_date,
        p_active_shift
    );

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count,
        'inserted_count', v_inserted_count,
        'previous_revision', v_current_rev,
        'new_revision', v_new_rev
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_position_activities_atomic(
    p_position_key text,
    p_mappings jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted_count integer := 0;
    v_inserted_count integer := 0;
    v_item jsonb;
    v_activity_id uuid;
    v_shift text;
    v_freq text;
    v_model text;
    v_sort_order integer;
    v_exists boolean;
BEGIN
    IF p_position_key IS NULL OR btrim(p_position_key) = '' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: position_key es obligatorio';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('position_activities:' || p_position_key));

    DELETE FROM public.position_activities
    WHERE position_key = p_position_key;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF p_mappings IS NOT NULL AND jsonb_typeof(p_mappings) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_mappings)
        LOOP
            v_activity_id := (v_item->>'activity_id')::uuid;
            IF v_activity_id IS NULL THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: activity_id es obligatorio en cada mapeo';
            END IF;

            SELECT EXISTS(SELECT 1 FROM public.operating_procedures WHERE id = v_activity_id)
            INTO v_exists;
            IF NOT v_exists THEN
                RAISE EXCEPTION 'FOREIGN_KEY_ERROR: activity_id (%) no existe en operating_procedures', v_activity_id;
            END IF;

            v_shift := coalesce(nullif(btrim(v_item->>'shift'), ''), 'AMBOS');
            v_freq := coalesce(nullif(btrim(v_item->>'frequency'), ''), 'Diario');
            v_model := coalesce(nullif(btrim(v_item->>'store_model'), ''), 'AMBOS');
            v_sort_order := coalesce((v_item->>'sort_order')::integer, 0);

            INSERT INTO public.position_activities (
                position_key,
                shift,
                activity_id,
                frequency,
                store_model,
                sort_order
            ) VALUES (
                p_position_key,
                v_shift,
                v_activity_id,
                v_freq,
                v_model,
                v_sort_order
            )
            ON CONFLICT (position_key, shift, activity_id, frequency, store_model)
            DO UPDATE SET sort_order = EXCLUDED.sort_order;

            v_inserted_count := v_inserted_count + 1;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'position_key', p_position_key,
        'deleted_count', v_deleted_count,
        'inserted_count', v_inserted_count
    );
END;
$$;

-- Endurecer políticas RLS y privilegios de tabla de escritura pública en tablas de ACTIVIDADES (Fase 0 item 9)
ALTER TABLE public.operating_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable write for authenticated" ON public.position_activities;
DROP POLICY IF EXISTS "Allow public read position_activities" ON public.position_activities;
CREATE POLICY "Allow public read position_activities"
ON public.position_activities
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow public full access" ON public.operating_procedures;
DROP POLICY IF EXISTS "Allow public read access" ON public.operating_procedures;
DROP POLICY IF EXISTS "Allow public read operating_procedures" ON public.operating_procedures;
CREATE POLICY "Allow public read operating_procedures"
ON public.operating_procedures
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow all for station_assignments" ON public.station_assignments;
DROP POLICY IF EXISTS "Allow public read station_assignments" ON public.station_assignments;
CREATE POLICY "Allow public read station_assignments"
ON public.station_assignments
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "checklist_all_access" ON public.checklist_completions;
DROP POLICY IF EXISTS "Allow public read checklist_completions" ON public.checklist_completions;
CREATE POLICY "Allow public read checklist_completions"
ON public.checklist_completions
FOR SELECT
TO public
USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
    public.operating_procedures,
    public.position_activities,
    public.station_assignments,
    public.checklist_completions
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
    public.operating_procedures,
    public.position_activities,
    public.station_assignments,
    public.checklist_completions
TO anon, authenticated;

GRANT ALL ON TABLE
    public.operating_procedures,
    public.position_activities,
    public.station_assignments,
    public.checklist_completions
TO service_role;

-- Revocar ejecución pública/anónima de las funciones SECURITY DEFINER y restringir exclusivamente a service_role
REVOKE ALL ON FUNCTION public.get_station_assignments_revision(text, date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_station_assignments_atomic(text, date, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_position_activities_atomic(text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_station_assignments_revision(text, date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_station_assignments_atomic(text, date, date, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_position_activities_atomic(text, jsonb) TO service_role;
