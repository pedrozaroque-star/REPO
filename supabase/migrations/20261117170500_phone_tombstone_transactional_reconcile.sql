-- 20261117170500_phone_tombstone_transactional_reconcile.sql
-- Protección transaccional ante concurrencia para phone_call_status_tombstones y phone_calls:
-- 1. Serializa escrituras y reconciliaciones por CallSid mediante pg_advisory_xact_lock(hashtextextended(...)).
-- 2. Lleva control monotónico de revision, sequence_number y event_timestamp para conservar siempre
--    la duración final más reciente sin permitir que una reconciliación atrasada pise un valor más nuevo.
-- 3. Ejecuta lectura (FOR UPDATE), actualización de phone_calls y borrado condicional (WHERE revision = v_tomb.revision)
--    en una sola transacción PostgreSQL (reconcile_phone_call_with_tombstone_atomic):
--    - No reabre jamás llamadas terminadas ni altera callback_requested / transferred.
--    - Nunca reemplaza una duration_seconds válida con NULL ni con 0 cuando falta CallDuration.
--    - Nunca borra un cierre (tombstone) que no se haya aplicado efectivamente en phone_calls.

ALTER TABLE public.phone_call_status_tombstones
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sequence_number integer NULL,
  ADD COLUMN IF NOT EXISTS event_timestamp timestamptz NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS last_status_sequence integer NULL,
  ADD COLUMN IF NOT EXISTS last_status_event_at timestamptz NULL;

DROP FUNCTION IF EXISTS public.upsert_phone_call_status_tombstone_atomic(text, text, integer, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.upsert_phone_call_status_tombstone_atomic(text, text, integer, text, text, text, timestamptz, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.upsert_phone_call_status_tombstone_atomic(
  p_call_sid text,
  p_terminal_status text,
  p_duration_seconds integer DEFAULT NULL,
  p_caller_number text DEFAULT NULL,
  p_to_number text DEFAULT NULL,
  p_forwarded_from text DEFAULT NULL,
  p_ended_at timestamptz DEFAULT now(),
  p_sequence_number integer DEFAULT NULL,
  p_event_timestamp timestamptz DEFAULT NULL
)
RETURNS public.phone_call_status_tombstones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.phone_call_status_tombstones;
  v_clean_sid text := btrim(COALESCE(p_call_sid, ''));
  v_clean_status text := lower(btrim(COALESCE(p_terminal_status, 'completed')));
  v_safe_dur integer := CASE
    WHEN p_duration_seconds IS NOT NULL AND p_duration_seconds >= 0 THEN LEAST(p_duration_seconds, 7200)
    ELSE NULL
  END;
  v_safe_seq integer := CASE
    WHEN p_sequence_number IS NOT NULL AND p_sequence_number >= 0 THEN p_sequence_number
    ELSE NULL
  END;
BEGIN
  IF v_clean_sid = '' THEN
    RAISE EXCEPTION 'p_call_sid is required';
  END IF;

  -- Serialización por CallSid dentro de la transacción (sin bloquear llamadas de otros CallSid)
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_call_close:' || v_clean_sid, 0));

  INSERT INTO public.phone_call_status_tombstones (
    call_sid,
    terminal_status,
    duration_seconds,
    caller_number,
    to_number,
    forwarded_from,
    ended_at,
    revision,
    sequence_number,
    event_timestamp,
    updated_at
  ) VALUES (
    v_clean_sid,
    CASE WHEN v_clean_status = '' THEN 'completed' ELSE v_clean_status END,
    v_safe_dur,
    NULLIF(btrim(COALESCE(p_caller_number, '')), ''),
    NULLIF(btrim(COALESCE(p_to_number, '')), ''),
    NULLIF(btrim(COALESCE(p_forwarded_from, '')), ''),
    COALESCE(p_ended_at, now()),
    1,
    CASE WHEN v_safe_dur IS NOT NULL THEN v_safe_seq ELSE NULL END,
    CASE WHEN v_safe_dur IS NOT NULL THEN p_event_timestamp ELSE NULL END,
    now()
  )
  ON CONFLICT (call_sid) DO UPDATE SET
    terminal_status = CASE
      WHEN (
        public.phone_call_status_tombstones.sequence_number IS NOT NULL
        AND v_safe_seq IS NOT NULL
        AND v_safe_seq < public.phone_call_status_tombstones.sequence_number
      ) OR (
        (public.phone_call_status_tombstones.sequence_number IS NULL OR v_safe_seq IS NULL)
        AND public.phone_call_status_tombstones.event_timestamp IS NOT NULL
        AND p_event_timestamp IS NOT NULL
        AND p_event_timestamp < public.phone_call_status_tombstones.event_timestamp
      ) THEN public.phone_call_status_tombstones.terminal_status
      WHEN v_safe_dur IS NOT NULL THEN EXCLUDED.terminal_status
      ELSE COALESCE(public.phone_call_status_tombstones.terminal_status, EXCLUDED.terminal_status)
    END,
    duration_seconds = CASE
      WHEN (
        (
          public.phone_call_status_tombstones.sequence_number IS NOT NULL
          AND v_safe_seq IS NOT NULL
          AND v_safe_seq < public.phone_call_status_tombstones.sequence_number
        ) OR (
          (public.phone_call_status_tombstones.sequence_number IS NULL OR v_safe_seq IS NULL)
          AND public.phone_call_status_tombstones.event_timestamp IS NOT NULL
          AND p_event_timestamp IS NOT NULL
          AND p_event_timestamp < public.phone_call_status_tombstones.event_timestamp
        )
      ) AND public.phone_call_status_tombstones.duration_seconds IS NOT NULL
        THEN public.phone_call_status_tombstones.duration_seconds
      ELSE COALESCE(v_safe_dur, public.phone_call_status_tombstones.duration_seconds)
    END,
    sequence_number = CASE
      WHEN v_safe_dur IS NULL THEN public.phone_call_status_tombstones.sequence_number
      WHEN (
        public.phone_call_status_tombstones.sequence_number IS NOT NULL
        AND v_safe_seq IS NOT NULL
        AND v_safe_seq < public.phone_call_status_tombstones.sequence_number
      ) AND public.phone_call_status_tombstones.duration_seconds IS NOT NULL
        THEN public.phone_call_status_tombstones.sequence_number
      ELSE COALESCE(v_safe_seq, public.phone_call_status_tombstones.sequence_number)
    END,
    event_timestamp = CASE
      WHEN v_safe_dur IS NULL THEN public.phone_call_status_tombstones.event_timestamp
      WHEN (
        (public.phone_call_status_tombstones.sequence_number IS NULL OR v_safe_seq IS NULL)
        AND public.phone_call_status_tombstones.event_timestamp IS NOT NULL
        AND p_event_timestamp IS NOT NULL
        AND p_event_timestamp < public.phone_call_status_tombstones.event_timestamp
      ) AND public.phone_call_status_tombstones.duration_seconds IS NOT NULL
        THEN public.phone_call_status_tombstones.event_timestamp
      ELSE COALESCE(p_event_timestamp, public.phone_call_status_tombstones.event_timestamp)
    END,
    caller_number = COALESCE(EXCLUDED.caller_number, public.phone_call_status_tombstones.caller_number),
    to_number = COALESCE(EXCLUDED.to_number, public.phone_call_status_tombstones.to_number),
    forwarded_from = COALESCE(EXCLUDED.forwarded_from, public.phone_call_status_tombstones.forwarded_from),
    ended_at = LEAST(public.phone_call_status_tombstones.ended_at, EXCLUDED.ended_at),
    revision = public.phone_call_status_tombstones.revision + 1,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_phone_call_status_tombstone_atomic(text, text, integer, text, text, text, timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_phone_call_status_tombstone_atomic(text, text, integer, text, text, text, timestamptz, integer, timestamptz) TO service_role;

DROP FUNCTION IF EXISTS public.reconcile_phone_call_with_tombstone_atomic(text);

CREATE OR REPLACE FUNCTION public.reconcile_phone_call_with_tombstone_atomic(
  p_call_sid text
)
RETURNS SETOF public.phone_calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_sid text := btrim(COALESCE(p_call_sid, ''));
  v_tomb public.phone_call_status_tombstones;
  v_call public.phone_calls;
  v_updated public.phone_calls;
  v_curr_status_norm text;
  v_already_terminated boolean;
  v_next_status text;
  v_next_status_norm text;
  v_next_ended_at timestamptz;
  v_is_stale_dur boolean := false;
  v_apply_dur boolean := false;
  v_next_dur integer;
  v_next_seq integer;
  v_next_event_ts timestamptz;
  v_next_resolved boolean;
BEGIN
  IF v_clean_sid = '' THEN
    RETURN;
  END IF;

  -- 1. Candado transaccional exclusivo por CallSid (idéntico orden de bloqueo que upsert -> cero deadlocks)
  PERFORM pg_advisory_xact_lock(hashtextextended('phone_call_close:' || v_clean_sid, 0));

  -- 2. Leer y bloquear el tombstone pendiente
  SELECT *
  INTO v_tomb
  FROM public.phone_call_status_tombstones
  WHERE call_sid = v_clean_sid
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Si otro worker concurrente ya reconcilió y borró el tombstone en paralelo,
    -- devolver la fila de phone_calls únicamente si ya quedó efectivamente cerrada.
    SELECT *
    INTO v_call
    FROM public.phone_calls
    WHERE call_sid = v_clean_sid;

    IF FOUND AND (
      v_call.ended_at IS NOT NULL
      OR lower(btrim(COALESCE(v_call.status, ''))) IN ('completed', 'canceled', 'busy', 'failed', 'no-answer')
    ) THEN
      RETURN NEXT v_call;
    END IF;

    RETURN;
  END IF;

  -- 3. Leer y bloquear la fila de phone_calls.
  --    Si phone_calls aún no existe, conservar intacto el tombstone (jamás borrar un cierre no aplicado).
  SELECT *
  INTO v_call
  FROM public.phone_calls
  WHERE call_sid = v_clean_sid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 4. Calcular estado terminal sin reabrir llamadas terminadas ni pisar callback_requested / transferred
  v_curr_status_norm := lower(btrim(COALESCE(v_call.status, '')));
  v_already_terminated := (
    v_call.ended_at IS NOT NULL
    OR v_curr_status_norm IN ('completed', 'canceled', 'busy', 'failed', 'no-answer')
  );

  v_next_status := CASE
    WHEN v_curr_status_norm IN ('callback_requested', 'transferred') THEN v_call.status
    WHEN v_already_terminated AND v_curr_status_norm <> '' AND v_curr_status_norm <> 'in_progress' THEN v_call.status
    ELSE COALESCE(NULLIF(btrim(COALESCE(v_tomb.terminal_status, '')), ''), 'completed')
  END;
  v_next_status_norm := lower(btrim(COALESCE(v_next_status, 'completed')));

  v_next_ended_at := COALESCE(v_call.ended_at, v_tomb.ended_at, now());

  -- 5. Aplicar CallDuration autoritativo solo si viene presente y no es anterior a un cierre ya aplicado
  IF v_tomb.duration_seconds IS NOT NULL AND v_tomb.duration_seconds >= 0 THEN
    v_is_stale_dur := (
      (
        v_call.last_status_sequence IS NOT NULL
        AND v_tomb.sequence_number IS NOT NULL
        AND v_tomb.sequence_number < v_call.last_status_sequence
      )
      OR (
        (v_call.last_status_sequence IS NULL OR v_tomb.sequence_number IS NULL)
        AND v_call.last_status_event_at IS NOT NULL
        AND v_tomb.event_timestamp IS NOT NULL
        AND v_tomb.event_timestamp < v_call.last_status_event_at
      )
    );
    v_apply_dur := NOT v_is_stale_dur;
  END IF;

  IF v_apply_dur THEN
    v_next_dur := LEAST(v_tomb.duration_seconds, 7200);
    v_next_seq := COALESCE(v_tomb.sequence_number, v_call.last_status_sequence);
    v_next_event_ts := COALESCE(v_tomb.event_timestamp, v_call.last_status_event_at);
  ELSE
    v_next_dur := v_call.duration_seconds;
    v_next_seq := v_call.last_status_sequence;
    v_next_event_ts := v_call.last_status_event_at;
  END IF;

  -- 6. Preservar invariantes de resolved_by_ai
  IF COALESCE(v_call.turns_count, 0) = 0
     OR v_next_status_norm IN ('callback_requested', 'transferred', 'canceled', 'busy', 'failed', 'no-answer')
  THEN
    v_next_resolved := false;
  ELSE
    v_next_resolved := COALESCE(v_call.resolved_by_ai, false);
  END IF;

  -- 7. Actualizar phone_calls en la misma transacción
  UPDATE public.phone_calls
  SET
    status = v_next_status,
    ended_at = v_next_ended_at,
    duration_seconds = v_next_dur,
    resolved_by_ai = v_next_resolved,
    last_status_sequence = v_next_seq,
    last_status_event_at = v_next_event_ts
  WHERE id = v_call.id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo actualizar phone_calls id=% al reconciliar tombstone', v_call.id;
  END IF;

  -- 8. Borrar únicamente la revisión aplicada del tombstone
  DELETE FROM public.phone_call_status_tombstones
  WHERE call_sid = v_clean_sid
    AND revision = v_tomb.revision;

  RETURN NEXT v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_phone_call_with_tombstone_atomic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_phone_call_with_tombstone_atomic(text) TO service_role;

NOTIFY pgrst, 'reload schema';
