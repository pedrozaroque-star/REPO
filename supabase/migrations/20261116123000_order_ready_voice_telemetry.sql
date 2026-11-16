-- =============================================================================
-- Migration: 20261116123000_order_ready_voice_telemetry.sql
-- Purpose:
--   1. Create dedicated non-Realtime telemetry tables for Order Ready Board &
--      Preparador kitchen tablet monitoring without adding columns or extra
--      UPDATE storms to public.order_ready_announcements:
--        - public.order_ready_device_status (heartbeat, mute, audio unlock, voice, volume)
--        - public.order_ready_voice_playbacks (end-to-end speaker Playback ACK log)
--   2. Enable strict RLS (service_role only, ZERO Security Advisor warnings).
--   3. Create PostgreSQL aggregation RPC public.get_order_ready_telemetry_summary
--      so multi-day queries (>40k rows) aggregate server-side with zero 1,000-row
--      PostgREST truncation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.order_ready_device_status (
  store_code text NOT NULL,
  device_role text NOT NULL CHECK (device_role IN ('prep_tablet', 'speaker_board')),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  is_muted boolean NOT NULL DEFAULT false,
  audio_unlocked boolean NOT NULL DEFAULT false,
  voice_id text NOT NULL DEFAULT 'Kore',
  voice_volume numeric(4,2) NOT NULL DEFAULT 1.00,
  is_fullscreen boolean NOT NULL DEFAULT false,
  last_played_at timestamptz NULL,
  last_played_order_number text NULL,
  last_engine text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_code, device_role)
);

CREATE TABLE IF NOT EXISTS public.order_ready_voice_playbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code text NOT NULL,
  business_date date NOT NULL,
  order_id uuid NULL,
  order_number text NOT NULL,
  dining_option text NULL,
  trigger_source text NOT NULL CHECK (
    trigger_source IN (
      'tablet_tap',
      'smart_auto_timer',
      'manual_board_replay',
      'reminder',
      'auto_bump',
      'special_button'
    )
  ),
  engine_used text NOT NULL CHECK (engine_used IN ('neural_wav', 'browser_tts')),
  voice_id text NOT NULL DEFAULT 'Kore',
  voice_volume numeric(4,2) NOT NULL DEFAULT 1.00,
  called_at timestamptz NULL,
  played_at timestamptz NOT NULL DEFAULT now(),
  latency_ms integer NULL
);

CREATE INDEX IF NOT EXISTS idx_order_ready_voice_playbacks_store_bdate
  ON public.order_ready_voice_playbacks (store_code, business_date, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_ready_voice_playbacks_bdate
  ON public.order_ready_voice_playbacks (business_date, store_code);

CREATE INDEX IF NOT EXISTS idx_order_ready_voice_playbacks_order_id
  ON public.order_ready_voice_playbacks (order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.order_ready_device_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_ready_device_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_ready_device_status TO service_role;

DROP POLICY IF EXISTS "Service role full access order_ready_device_status" ON public.order_ready_device_status;
CREATE POLICY "Service role full access order_ready_device_status"
  ON public.order_ready_device_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.order_ready_voice_playbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_ready_voice_playbacks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_ready_voice_playbacks TO service_role;

DROP POLICY IF EXISTS "Service role full access order_ready_voice_playbacks" ON public.order_ready_voice_playbacks;
CREATE POLICY "Service role full access order_ready_voice_playbacks"
  ON public.order_ready_voice_playbacks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_order_ready_telemetry_summary(
  p_start_date date,
  p_end_date date,
  p_store_codes text[] DEFAULT NULL
)
RETURNS TABLE (
  store_code text,
  total_orders integer,
  tablet_called_orders integer,
  pct_tablet_called numeric,
  special_buttons_called integer,
  speaker_confirmed_orders integer,
  total_playback_events integer,
  calls_since_speaker_active integer,
  unheard_calls_since_active integer,
  avg_prep_to_call_sec integer,
  avg_call_to_bump_sec integer,
  avg_speaker_latency_ms integer,
  last_tablet_call_at timestamptz,
  last_order_created_at timestamptz,
  prep_last_heartbeat_at timestamptz,
  speaker_last_heartbeat_at timestamptz,
  speaker_is_muted boolean,
  speaker_audio_unlocked boolean,
  speaker_voice_id text,
  speaker_voice_volume numeric,
  speaker_is_fullscreen boolean,
  speaker_last_played_at timestamptz,
  speaker_last_played_order text,
  speaker_last_engine text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH target_stores AS (
    SELECT DISTINCT upper(trim(u.code)) AS store_code
    FROM unnest(p_store_codes) AS u(code)
    WHERE p_store_codes IS NOT NULL
      AND array_length(p_store_codes, 1) > 0
      AND nullif(trim(u.code), '') IS NOT NULL
    UNION
    SELECT DISTINCT a.store_code::text
    FROM public.order_ready_announcements a
    WHERE (p_store_codes IS NULL OR array_length(p_store_codes, 1) IS NULL OR array_length(p_store_codes, 1) = 0)
      AND a.business_date BETWEEN p_start_date AND p_end_date
    UNION
    SELECT DISTINCT d.store_code::text
    FROM public.order_ready_device_status d
    WHERE (p_store_codes IS NULL OR array_length(p_store_codes, 1) IS NULL OR array_length(p_store_codes, 1) = 0)
  ),
  playbacks_matched AS (
    SELECT
      vp.store_code,
      vp.business_date,
      vp.order_id,
      vp.order_number,
      vp.latency_ms,
      vp.played_at
    FROM public.order_ready_voice_playbacks vp
    WHERE vp.business_date BETWEEN p_start_date AND p_end_date
  ),
  playbacks_agg AS (
    SELECT
      pm.store_code,
      COUNT(*)::integer AS total_playback_events,
      ROUND(AVG(pm.latency_ms)::numeric)::integer AS avg_speaker_latency_ms,
      MIN(pm.played_at) AS first_playback_at
    FROM playbacks_matched pm
    GROUP BY pm.store_code
  ),
  speaker_activation AS (
    SELECT
      ts.store_code,
      CASE
        WHEN pa.first_playback_at IS NOT NULL AND spk.created_at IS NOT NULL THEN LEAST(pa.first_playback_at, spk.created_at)
        WHEN pa.first_playback_at IS NOT NULL THEN pa.first_playback_at
        ELSE spk.created_at
      END AS active_since
    FROM target_stores ts
    LEFT JOIN playbacks_agg pa ON pa.store_code = ts.store_code
    LEFT JOIN public.order_ready_device_status spk
      ON spk.store_code = ts.store_code AND spk.device_role = 'speaker_board'
  ),
  orders_agg AS (
    SELECT
      a.store_code::text AS store_code,
      COUNT(*) FILTER (
        WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
      )::integer AS total_orders,
      COUNT(*) FILTER (
        WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
          AND a.announced_at IS NOT NULL
      )::integer AS tablet_called_orders,
      COUNT(*) FILTER (
        WHERE a.order_number IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
      )::integer AS special_buttons_called,
      COUNT(*) FILTER (
        WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
          AND a.announced_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM playbacks_matched pm
            WHERE pm.store_code = a.store_code
              AND pm.business_date = a.business_date
              AND (pm.order_id = a.id OR pm.order_number = a.order_number)
          )
      )::integer AS speaker_confirmed_orders,
      COUNT(*) FILTER (
        WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
          AND a.announced_at IS NOT NULL
          AND sa.active_since IS NOT NULL
          AND a.announced_at >= sa.active_since
      )::integer AS calls_since_speaker_active,
      COUNT(*) FILTER (
        WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
          AND a.announced_at IS NOT NULL
          AND sa.active_since IS NOT NULL
          AND a.announced_at >= sa.active_since
          AND a.announced_at <= (now() - interval '30 seconds')
          AND NOT EXISTS (
            SELECT 1
            FROM playbacks_matched pm
            WHERE pm.store_code = a.store_code
              AND pm.business_date = a.business_date
              AND (pm.order_id = a.id OR pm.order_number = a.order_number)
          )
      )::integer AS unheard_calls_since_active,
      ROUND(
        AVG(EXTRACT(EPOCH FROM (a.announced_at - a.created_at)))
        FILTER (
          WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
            AND a.announced_at IS NOT NULL
            AND a.announced_at >= a.created_at
        )::numeric
      )::integer AS avg_prep_to_call_sec,
      ROUND(
        AVG(EXTRACT(EPOCH FROM (a.ready_at - a.announced_at)))
        FILTER (
          WHERE a.order_number NOT IN ('CAFE', 'CHAMPURRADO', 'ORDEN_PENDIENTE')
            AND a.announced_at IS NOT NULL
            AND a.ready_at IS NOT NULL
        )::numeric
      )::integer AS avg_call_to_bump_sec,
      MAX(a.announced_at) AS last_tablet_call_at,
      MAX(a.created_at) AS last_order_created_at
    FROM public.order_ready_announcements a
    JOIN target_stores ts ON ts.store_code = a.store_code
    LEFT JOIN speaker_activation sa ON sa.store_code = a.store_code
    WHERE a.business_date BETWEEN p_start_date AND p_end_date
      AND a.dining_option IN ('FOR_HERE', 'TOGO')
    GROUP BY a.store_code
  )
  SELECT
    ts.store_code::text,
    COALESCE(oa.total_orders, 0)::integer AS total_orders,
    COALESCE(oa.tablet_called_orders, 0)::integer AS tablet_called_orders,
    ROUND(
      100.0 * COALESCE(oa.tablet_called_orders, 0) / NULLIF(oa.total_orders, 0),
      1
    )::numeric AS pct_tablet_called,
    COALESCE(oa.special_buttons_called, 0)::integer AS special_buttons_called,
    COALESCE(oa.speaker_confirmed_orders, 0)::integer AS speaker_confirmed_orders,
    COALESCE(pa.total_playback_events, 0)::integer AS total_playback_events,
    COALESCE(oa.calls_since_speaker_active, 0)::integer AS calls_since_speaker_active,
    COALESCE(oa.unheard_calls_since_active, 0)::integer AS unheard_calls_since_active,
    oa.avg_prep_to_call_sec::integer,
    oa.avg_call_to_bump_sec::integer,
    pa.avg_speaker_latency_ms::integer,
    oa.last_tablet_call_at,
    oa.last_order_created_at,
    prep.last_heartbeat_at AS prep_last_heartbeat_at,
    spk.last_heartbeat_at AS speaker_last_heartbeat_at,
    spk.is_muted AS speaker_is_muted,
    spk.audio_unlocked AS speaker_audio_unlocked,
    spk.voice_id AS speaker_voice_id,
    spk.voice_volume AS speaker_voice_volume,
    spk.is_fullscreen AS speaker_is_fullscreen,
    spk.last_played_at AS speaker_last_played_at,
    spk.last_played_order_number AS speaker_last_played_order,
    spk.last_engine AS speaker_last_engine
  FROM target_stores ts
  LEFT JOIN orders_agg oa ON oa.store_code = ts.store_code
  LEFT JOIN playbacks_agg pa ON pa.store_code = ts.store_code
  LEFT JOIN public.order_ready_device_status prep
    ON prep.store_code = ts.store_code AND prep.device_role = 'prep_tablet'
  LEFT JOIN public.order_ready_device_status spk
    ON spk.store_code = ts.store_code AND spk.device_role = 'speaker_board'
  ORDER BY pct_tablet_called DESC NULLS LAST, tablet_called_orders DESC, ts.store_code ASC;
$$;

REVOKE ALL ON FUNCTION public.get_order_ready_telemetry_summary(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_ready_telemetry_summary(date, date, text[]) TO service_role;
