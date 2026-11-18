-- 20261118100000_phone_tombstones_monotonic_and_grants.sql
-- Hardening transaccional y de privilegios para public.phone_call_status_tombstones:
-- 1. Uniforma el predicado completo de obsolescencia (sequence_number OR missing-seq + event_timestamp)
--    en las 4 columnas (terminal_status, duration_seconds, sequence_number, event_timestamp) dentro de
--    upsert_phone_call_status_tombstone_atomic, evitando corrupción híbrida ante webhooks fuera de orden.
-- 2. Normaliza 'cancelled' -> 'canceled'.
-- 3. Endurece privilegios de tabla con REVOKE ALL a anon, authenticated y PUBLIC (paridad con las otras 5 tablas phone_*).

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
  v_raw_status text := lower(btrim(COALESCE(p_terminal_status, 'completed')));
  v_clean_status text := CASE
    WHEN v_raw_status = '' THEN 'completed'
    WHEN v_raw_status = 'cancelled' THEN 'canceled'
    ELSE v_raw_status
  END;
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
    v_clean_status,
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
        THEN public.phone_call_status_tombstones.terminal_status
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
        THEN public.phone_call_status_tombstones.sequence_number
      ELSE COALESCE(v_safe_seq, public.phone_call_status_tombstones.sequence_number)
    END,
    event_timestamp = CASE
      WHEN v_safe_dur IS NULL THEN public.phone_call_status_tombstones.event_timestamp
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

REVOKE ALL ON TABLE public.phone_call_status_tombstones FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.phone_call_status_tombstones TO service_role;

NOTIFY pgrst, 'reload schema';
