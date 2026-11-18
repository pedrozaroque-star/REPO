-- 20261117160000_phone_tombstone_non_clobber_rpc.sql
-- RPC atómico para phone_call_status_tombstones:
-- Garantiza que un evento sin CallDuration (p_duration_seconds IS NULL) JAMÁS reemplace
-- una duración válida existente con NULL, ni sobreescriba metadatos o ended_at previo.

CREATE OR REPLACE FUNCTION public.upsert_phone_call_status_tombstone_atomic(
  p_call_sid text,
  p_terminal_status text,
  p_duration_seconds integer DEFAULT NULL,
  p_caller_number text DEFAULT NULL,
  p_to_number text DEFAULT NULL,
  p_forwarded_from text DEFAULT NULL,
  p_ended_at timestamptz DEFAULT now()
)
RETURNS public.phone_call_status_tombstones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.phone_call_status_tombstones;
  v_clean_sid text := btrim(COALESCE(p_call_sid, ''));
  v_clean_status text := btrim(COALESCE(p_terminal_status, 'completed'));
  v_safe_dur integer := CASE
    WHEN p_duration_seconds IS NOT NULL AND p_duration_seconds >= 0 THEN LEAST(p_duration_seconds, 7200)
    ELSE NULL
  END;
BEGIN
  IF v_clean_sid = '' THEN
    RAISE EXCEPTION 'p_call_sid is required';
  END IF;

  INSERT INTO public.phone_call_status_tombstones (
    call_sid,
    terminal_status,
    duration_seconds,
    caller_number,
    to_number,
    forwarded_from,
    ended_at
  ) VALUES (
    v_clean_sid,
    CASE WHEN v_clean_status = '' THEN 'completed' ELSE v_clean_status END,
    v_safe_dur,
    NULLIF(btrim(COALESCE(p_caller_number, '')), ''),
    NULLIF(btrim(COALESCE(p_to_number, '')), ''),
    NULLIF(btrim(COALESCE(p_forwarded_from, '')), ''),
    COALESCE(p_ended_at, now())
  )
  ON CONFLICT (call_sid) DO UPDATE SET
    terminal_status = CASE
      WHEN EXCLUDED.duration_seconds IS NOT NULL THEN EXCLUDED.terminal_status
      ELSE COALESCE(public.phone_call_status_tombstones.terminal_status, EXCLUDED.terminal_status)
    END,
    duration_seconds = COALESCE(EXCLUDED.duration_seconds, public.phone_call_status_tombstones.duration_seconds),
    caller_number = COALESCE(EXCLUDED.caller_number, public.phone_call_status_tombstones.caller_number),
    to_number = COALESCE(EXCLUDED.to_number, public.phone_call_status_tombstones.to_number),
    forwarded_from = COALESCE(EXCLUDED.forwarded_from, public.phone_call_status_tombstones.forwarded_from),
    ended_at = LEAST(public.phone_call_status_tombstones.ended_at, EXCLUDED.ended_at)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_phone_call_status_tombstone_atomic(text, text, integer, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_phone_call_status_tombstone_atomic(text, text, integer, text, text, text, timestamptz) TO service_role;
