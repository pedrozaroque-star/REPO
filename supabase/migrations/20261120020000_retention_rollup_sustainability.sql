-- Migration: Automatic Rollup & Non-Destructive Retention Sustainability Pipeline
-- Date: 2026-11-20
-- Purpose:
--   Keep Supabase Postgres permanently well below the 8 GB Pro ceiling (< 3.5 GB)
--   without losing ANY financial, payroll, accounting, AI learning, or seasonal analytics data.
--
-- Tables added (RLS enabled):
--   1. public.meat_consumption_daily_summary — preserves multi-year daily raw_lbs totals
--      (5-year Champurrado & seasonal forecasts) after 30-min intervals > 180 days roll up.
--   2. public.order_ready_daily_metrics — preserves daily Order Ready & voice playback KPIs
--      after raw order_ready_announcements & order_ready_voice_playbacks > 90 days roll up.
--
-- RPCs updated / created:
--   1. public.get_champurrado_seasonal_forecast — reads daily_summary + live history seamlessly.
--   2. public.get_seasonal_avg_gallons — reads daily_summary + live history seamlessly.
--   3. public.run_retention_maintenance(p_dry_run, p_meat_batch_days, p_order_ready_batch_days, p_delivery_batch_rows)
--      — service_role-only atomic retention worker invoked nightly by /api/cron/retention-cleanup.

BEGIN;

-- ============================================================================
-- 1. Lossless Daily Summary Table: meat_consumption_daily_summary
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.meat_consumption_daily_summary (
  store_id bigint NOT NULL,
  business_date date NOT NULL,
  meat_type text NOT NULL,
  total_raw_lbs numeric(14, 4) NOT NULL DEFAULT 0,
  intervals_count integer NOT NULL DEFAULT 0,
  rolled_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, business_date, meat_type)
);

COMMENT ON TABLE public.meat_consumption_daily_summary IS
  'Resumen diario histórico sin pérdida de meat_consumption_history (>180 días) para pronósticos estacionales de 5 años (Champurrado y carnes).';

CREATE INDEX IF NOT EXISTS idx_meat_daily_summary_store_type_date
  ON public.meat_consumption_daily_summary (store_id, meat_type, business_date DESC);

ALTER TABLE public.meat_consumption_daily_summary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meat_consumption_daily_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.meat_consumption_daily_summary TO authenticated;
GRANT ALL ON TABLE public.meat_consumption_daily_summary TO service_role;

DROP POLICY IF EXISTS "Service role full access meat_consumption_daily_summary" ON public.meat_consumption_daily_summary;
CREATE POLICY "Service role full access meat_consumption_daily_summary"
  ON public.meat_consumption_daily_summary
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read meat_consumption_daily_summary" ON public.meat_consumption_daily_summary;
CREATE POLICY "Authenticated read meat_consumption_daily_summary"
  ON public.meat_consumption_daily_summary
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- 2. Lossless Daily Summary Table: order_ready_daily_metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_ready_daily_metrics (
  store_code text NOT NULL,
  business_date date NOT NULL,
  total_orders integer NOT NULL DEFAULT 0,
  ready_orders integer NOT NULL DEFAULT 0,
  announced_orders integer NOT NULL DEFAULT 0,
  playback_count integer NOT NULL DEFAULT 0,
  avg_latency_ms integer,
  p95_latency_ms integer,
  engine_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  rolled_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_code, business_date)
);

COMMENT ON TABLE public.order_ready_daily_metrics IS
  'Métricas diarias históricas de Order Ready y reproducción de voz (>90 días) preservadas antes de podar filas granulares.';

CREATE INDEX IF NOT EXISTS idx_order_ready_daily_metrics_date
  ON public.order_ready_daily_metrics (business_date DESC);

ALTER TABLE public.order_ready_daily_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_ready_daily_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_ready_daily_metrics TO authenticated;
GRANT ALL ON TABLE public.order_ready_daily_metrics TO service_role;

DROP POLICY IF EXISTS "Service role full access order_ready_daily_metrics" ON public.order_ready_daily_metrics;
CREATE POLICY "Service role full access order_ready_daily_metrics"
  ON public.order_ready_daily_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read order_ready_daily_metrics" ON public.order_ready_daily_metrics;
CREATE POLICY "Authenticated read order_ready_daily_metrics"
  ON public.order_ready_daily_metrics
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- 3. Update Seasonal Forecast RPCs (100% parity across summary + live history)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_champurrado_seasonal_forecast(
  p_store_id bigint,
  p_target_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  year_label integer,
  iso_week integer,
  avg_daily_gallons numeric,
  max_daily_gallons numeric,
  total_days_with_data integer,
  avg_daily_raw_units numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_target_week integer;
BEGIN
  v_target_week := EXTRACT(WEEK FROM p_target_date)::integer;

  RETURN QUERY
  WITH combined_daily AS (
    SELECT s.business_date, s.total_raw_lbs AS day_total
    FROM public.meat_consumption_daily_summary s
    WHERE s.store_id = p_store_id
      AND s.meat_type = 'CHAMPURRADO'
      AND EXTRACT(WEEK FROM s.business_date)::integer = v_target_week
    UNION ALL
    SELECT m.business_date, SUM(m.raw_lbs) AS day_total
    FROM public.meat_consumption_history m
    WHERE m.store_id = p_store_id
      AND m.meat_type = 'CHAMPURRADO'
      AND EXTRACT(WEEK FROM m.business_date)::integer = v_target_week
      AND NOT EXISTS (
        SELECT 1
        FROM public.meat_consumption_daily_summary s2
        WHERE s2.store_id = m.store_id
          AND s2.business_date = m.business_date
          AND s2.meat_type = m.meat_type
      )
    GROUP BY m.business_date
  )
  SELECT
    EXTRACT(YEAR FROM cd.business_date)::integer AS year_label,
    v_target_week AS iso_week,
    ROUND((SUM(cd.day_total) / NULLIF(COUNT(*), 0) / 8.0)::numeric, 1) AS avg_daily_gallons,
    ROUND((MAX(cd.day_total) / 8.0)::numeric, 1) AS max_daily_gallons,
    COUNT(*)::integer AS total_days_with_data,
    ROUND((SUM(cd.day_total) / NULLIF(COUNT(*), 0))::numeric, 1) AS avg_daily_raw_units
  FROM combined_daily cd
  GROUP BY EXTRACT(YEAR FROM cd.business_date)
  ORDER BY year_label DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seasonal_avg_gallons(
  p_store_id bigint,
  p_meat_type text DEFAULT 'CHAMPURRADO',
  p_target_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  suggested_daily_gallons numeric,
  historical_years_count integer,
  confidence text
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_target_week integer;
  v_avg numeric;
  v_years integer;
BEGIN
  v_target_week := EXTRACT(WEEK FROM p_target_date)::integer;

  WITH combined_daily AS (
    SELECT s.business_date, s.total_raw_lbs AS day_total
    FROM public.meat_consumption_daily_summary s
    WHERE s.store_id = p_store_id
      AND s.meat_type = p_meat_type
      AND EXTRACT(WEEK FROM s.business_date)::integer = v_target_week
    UNION ALL
    SELECT m.business_date, SUM(m.raw_lbs) AS day_total
    FROM public.meat_consumption_history m
    WHERE m.store_id = p_store_id
      AND m.meat_type = p_meat_type
      AND EXTRACT(WEEK FROM m.business_date)::integer = v_target_week
      AND NOT EXISTS (
        SELECT 1
        FROM public.meat_consumption_daily_summary s2
        WHERE s2.store_id = m.store_id
          AND s2.business_date = m.business_date
          AND s2.meat_type = m.meat_type
      )
    GROUP BY m.business_date
  )
  SELECT
    ROUND((SUM(day_total) / NULLIF(COUNT(*), 0) / 8.0)::numeric, 1),
    COUNT(DISTINCT EXTRACT(YEAR FROM business_date))::integer
  INTO v_avg, v_years
  FROM combined_daily;

  RETURN QUERY
  SELECT
    COALESCE(v_avg, 0) AS suggested_daily_gallons,
    COALESCE(v_years, 0) AS historical_years_count,
    CASE
      WHEN COALESCE(v_years, 0) >= 3 THEN 'HIGH'
      WHEN COALESCE(v_years, 0) = 2 THEN 'MEDIUM'
      WHEN COALESCE(v_years, 0) = 1 THEN 'LOW'
      ELSE 'NONE'
    END AS confidence;
END;
$$;

-- ============================================================================
-- 4. Atomic Non-Destructive Retention Worker: run_retention_maintenance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.run_retention_maintenance(
  p_dry_run boolean DEFAULT false,
  p_meat_batch_days integer DEFAULT 45,
  p_order_ready_batch_days integer DEFAULT 30,
  p_delivery_batch_rows integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_la_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_meat_cutoff date := v_la_today - 180;
  v_order_ready_cutoff date := v_la_today - 90;
  v_delivery_cutoff date := v_la_today - 90;
  v_notif_cutoff timestamptz := now() - interval '30 days';
  v_voice_cutoff timestamptz := now() - interval '180 days';

  v_meat_dates date[];
  v_meat_summaries_upserted integer := 0;
  v_meat_rows_pruned integer := 0;
  v_meat_remaining_dates integer := 0;

  v_or_dates date[];
  v_or_summaries_upserted integer := 0;
  v_or_ann_pruned integer := 0;
  v_or_playbacks_pruned integer := 0;
  v_or_remaining_dates integer := 0;

  v_delivery_slimmed integer := 0;
  v_notif_pruned integer := 0;
  v_phone_transcripts_compacted integer := 0;
  v_kore_transcripts_compacted integer := 0;

  v_bulky_keys text[] := ARRAY[
    'orderDetails',
    'cells',
    'fareLineItems',
    'primary',
    'eater',
    'restaurant',
    'lastMessage'
  ];
BEGIN
  -- --------------------------------------------------------------------------
  -- A. meat_consumption_history (>180d -> lossless daily summary + chunk prune)
  -- --------------------------------------------------------------------------
  SELECT ARRAY(
    SELECT DISTINCT business_date
    FROM public.meat_consumption_history
    WHERE business_date < v_meat_cutoff
    ORDER BY business_date ASC
    LIMIT GREATEST(1, LEAST(p_meat_batch_days, 180))
  ) INTO v_meat_dates;

  IF p_dry_run THEN
    SELECT COUNT(*)::integer INTO v_meat_rows_pruned
    FROM public.meat_consumption_history
    WHERE business_date = ANY(COALESCE(v_meat_dates, ARRAY[]::date[]));

    SELECT COUNT(DISTINCT business_date)::integer INTO v_meat_remaining_dates
    FROM public.meat_consumption_history
    WHERE business_date < v_meat_cutoff;
  ELSIF COALESCE(array_length(v_meat_dates, 1), 0) > 0 THEN
    INSERT INTO public.meat_consumption_daily_summary (
      store_id, business_date, meat_type, total_raw_lbs, intervals_count, rolled_up_at
    )
    SELECT
      store_id,
      business_date,
      meat_type,
      COALESCE(SUM(raw_lbs), 0),
      COUNT(*)::integer,
      now()
    FROM public.meat_consumption_history
    WHERE business_date = ANY(v_meat_dates)
    GROUP BY store_id, business_date, meat_type
    ON CONFLICT (store_id, business_date, meat_type)
    DO UPDATE SET
      total_raw_lbs = EXCLUDED.total_raw_lbs,
      intervals_count = EXCLUDED.intervals_count,
      rolled_up_at = now();

    GET DIAGNOSTICS v_meat_summaries_upserted = ROW_COUNT;

    DELETE FROM public.meat_consumption_history
    WHERE business_date = ANY(v_meat_dates);

    GET DIAGNOSTICS v_meat_rows_pruned = ROW_COUNT;

    SELECT COUNT(DISTINCT business_date)::integer INTO v_meat_remaining_dates
    FROM public.meat_consumption_history
    WHERE business_date < v_meat_cutoff;
  END IF;

  -- --------------------------------------------------------------------------
  -- B. order_ready_announcements & voice_playbacks (>90d -> daily KPI rollup)
  -- --------------------------------------------------------------------------
  SELECT ARRAY(
    SELECT d FROM (
      SELECT DISTINCT business_date AS d
      FROM public.order_ready_announcements
      WHERE business_date IS NOT NULL AND business_date < v_order_ready_cutoff
      UNION
      SELECT DISTINCT business_date AS d
      FROM public.order_ready_voice_playbacks
      WHERE business_date IS NOT NULL AND business_date < v_order_ready_cutoff
    ) sub
    ORDER BY d ASC
    LIMIT GREATEST(1, LEAST(p_order_ready_batch_days, 120))
  ) INTO v_or_dates;

  IF p_dry_run THEN
    SELECT COUNT(*)::integer INTO v_or_ann_pruned
    FROM public.order_ready_announcements
    WHERE business_date = ANY(COALESCE(v_or_dates, ARRAY[]::date[]));

    SELECT COUNT(*)::integer INTO v_or_playbacks_pruned
    FROM public.order_ready_voice_playbacks
    WHERE business_date = ANY(COALESCE(v_or_dates, ARRAY[]::date[]));

    SELECT COUNT(*)::integer INTO v_or_remaining_dates
    FROM (
      SELECT DISTINCT business_date FROM public.order_ready_announcements WHERE business_date < v_order_ready_cutoff
      UNION
      SELECT DISTINCT business_date FROM public.order_ready_voice_playbacks WHERE business_date < v_order_ready_cutoff
    ) rem;
  ELSIF COALESCE(array_length(v_or_dates, 1), 0) > 0 THEN
    WITH ann_agg AS (
      SELECT
        COALESCE(NULLIF(TRIM(store_code), ''), NULLIF(TRIM(store_id), ''), 'UNKNOWN') AS store_code,
        business_date,
        COUNT(*)::integer AS total_orders,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) = 'READY')::integer AS ready_orders,
        COUNT(*) FILTER (WHERE announced IS TRUE)::integer AS announced_orders
      FROM public.order_ready_announcements
      WHERE business_date = ANY(v_or_dates)
      GROUP BY 1, 2
    ),
    pb_engine AS (
      SELECT
        COALESCE(NULLIF(TRIM(store_code), ''), 'UNKNOWN') AS store_code,
        business_date,
        COALESCE(NULLIF(TRIM(engine_used), ''), 'unknown') AS engine_used,
        COUNT(*)::integer AS cnt
      FROM public.order_ready_voice_playbacks
      WHERE business_date = ANY(v_or_dates)
      GROUP BY 1, 2, 3
    ),
    pb_engine_json AS (
      SELECT
        store_code,
        business_date,
        jsonb_object_agg(engine_used, cnt) AS engine_counts
      FROM pb_engine
      GROUP BY 1, 2
    ),
    pb_agg AS (
      SELECT
        COALESCE(NULLIF(TRIM(store_code), ''), 'UNKNOWN') AS store_code,
        business_date,
        COUNT(*)::integer AS playback_count,
        ROUND(AVG(latency_ms))::integer AS avg_latency_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::integer AS p95_latency_ms
      FROM public.order_ready_voice_playbacks
      WHERE business_date = ANY(v_or_dates)
      GROUP BY 1, 2
    ),
    merged AS (
      SELECT
        COALESCE(a.store_code, p.store_code) AS store_code,
        COALESCE(a.business_date, p.business_date) AS business_date,
        COALESCE(a.total_orders, 0) AS total_orders,
        COALESCE(a.ready_orders, 0) AS ready_orders,
        COALESCE(a.announced_orders, 0) AS announced_orders,
        COALESCE(p.playback_count, 0) AS playback_count,
        p.avg_latency_ms,
        p.p95_latency_ms,
        COALESCE(e.engine_counts, '{}'::jsonb) AS engine_counts
      FROM ann_agg a
      FULL OUTER JOIN pb_agg p
        ON p.store_code = a.store_code AND p.business_date = a.business_date
      LEFT JOIN pb_engine_json e
        ON e.store_code = COALESCE(a.store_code, p.store_code)
       AND e.business_date = COALESCE(a.business_date, p.business_date)
    )
    INSERT INTO public.order_ready_daily_metrics (
      store_code, business_date, total_orders, ready_orders, announced_orders,
      playback_count, avg_latency_ms, p95_latency_ms, engine_counts, rolled_up_at
    )
    SELECT
      store_code, business_date, total_orders, ready_orders, announced_orders,
      playback_count, avg_latency_ms, p95_latency_ms, engine_counts, now()
    FROM merged
    ON CONFLICT (store_code, business_date)
    DO UPDATE SET
      total_orders = EXCLUDED.total_orders,
      ready_orders = EXCLUDED.ready_orders,
      announced_orders = EXCLUDED.announced_orders,
      playback_count = EXCLUDED.playback_count,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      p95_latency_ms = EXCLUDED.p95_latency_ms,
      engine_counts = EXCLUDED.engine_counts,
      rolled_up_at = now();

    GET DIAGNOSTICS v_or_summaries_upserted = ROW_COUNT;

    DELETE FROM public.order_ready_voice_playbacks
    WHERE business_date = ANY(v_or_dates);
    GET DIAGNOSTICS v_or_playbacks_pruned = ROW_COUNT;

    DELETE FROM public.order_ready_announcements
    WHERE business_date = ANY(v_or_dates);
    GET DIAGNOSTICS v_or_ann_pruned = ROW_COUNT;

    SELECT COUNT(*)::integer INTO v_or_remaining_dates
    FROM (
      SELECT DISTINCT business_date FROM public.order_ready_announcements WHERE business_date < v_order_ready_cutoff
      UNION
      SELECT DISTINCT business_date FROM public.order_ready_voice_playbacks WHERE business_date < v_order_ready_cutoff
    ) rem;
  END IF;

  -- --------------------------------------------------------------------------
  -- C. delivery_platform_orders (>90d MATCHED only — lossless raw_payload slim)
  --    Preserves 100% of rows & all reconciliation/CPA keys; strips ONLY bulky
  --    redundant webhook blobs (orderDetails, cells, fareLineItems, etc.).
  -- --------------------------------------------------------------------------
  IF p_dry_run THEN
    SELECT COUNT(*)::integer INTO v_delivery_slimmed
    FROM public.delivery_platform_orders
    WHERE reconciliation_status = 'MATCHED'
      AND business_date < v_delivery_cutoff
      AND raw_payload IS NOT NULL
      AND raw_payload ?| v_bulky_keys;
  ELSE
    WITH batch AS (
      SELECT id
      FROM public.delivery_platform_orders
      WHERE reconciliation_status = 'MATCHED'
        AND business_date < v_delivery_cutoff
        AND raw_payload IS NOT NULL
        AND raw_payload ?| v_bulky_keys
      ORDER BY business_date ASC
      LIMIT GREATEST(100, LEAST(p_delivery_batch_rows, 10000))
    )
    UPDATE public.delivery_platform_orders d
    SET raw_payload = (
      d.raw_payload
        - 'orderDetails'
        - 'cells'
        - 'fareLineItems'
        - 'primary'
        - 'eater'
        - 'restaurant'
        - 'lastMessage'
    )
    FROM batch b
    WHERE d.id = b.id;

    GET DIAGNOSTICS v_delivery_slimmed = ROW_COUNT;
  END IF;

  -- --------------------------------------------------------------------------
  -- D. notifications (>30d — UI displays current business week since Mon 6 AM)
  -- --------------------------------------------------------------------------
  IF p_dry_run THEN
    SELECT COUNT(*)::integer INTO v_notif_pruned
    FROM public.notifications
    WHERE created_at < v_notif_cutoff;
  ELSE
    DELETE FROM public.notifications
    WHERE created_at < v_notif_cutoff;
    GET DIAGNOSTICS v_notif_pruned = ROW_COUNT;
  END IF;

  -- --------------------------------------------------------------------------
  -- E. Voice transcripts (>180d & analyzed_at IS NOT NULL — 0 rows deleted!)
  --    Preserves call/session rows, totals, summaries, outcomes & learning items.
  -- --------------------------------------------------------------------------
  IF p_dry_run THEN
    SELECT COUNT(*)::integer INTO v_phone_transcripts_compacted
    FROM public.phone_calls
    WHERE started_at < v_voice_cutoff
      AND analyzed_at IS NOT NULL
      AND transcript IS NOT NULL
      AND jsonb_typeof(transcript) = 'array'
      AND jsonb_array_length(transcript) > 0;

    SELECT COUNT(*)::integer INTO v_kore_transcripts_compacted
    FROM public.dt_kore_sim_sessions
    WHERE created_at < v_voice_cutoff
      AND analyzed_at IS NOT NULL
      AND transcript IS NOT NULL
      AND jsonb_typeof(transcript) = 'array'
      AND jsonb_array_length(transcript) > 0;
  ELSE
    UPDATE public.phone_calls
    SET transcript = '[]'::jsonb
    WHERE started_at < v_voice_cutoff
      AND analyzed_at IS NOT NULL
      AND transcript IS NOT NULL
      AND jsonb_typeof(transcript) = 'array'
      AND jsonb_array_length(transcript) > 0;
    GET DIAGNOSTICS v_phone_transcripts_compacted = ROW_COUNT;

    UPDATE public.dt_kore_sim_sessions
    SET transcript = '[]'::jsonb
    WHERE created_at < v_voice_cutoff
      AND analyzed_at IS NOT NULL
      AND transcript IS NOT NULL
      AND jsonb_typeof(transcript) = 'array'
      AND jsonb_array_length(transcript) > 0;
    GET DIAGNOSTICS v_kore_transcripts_compacted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'dryRun', p_dry_run,
    'laToday', v_la_today,
    'meatHistory', jsonb_build_object(
      'cutoffDate', v_meat_cutoff,
      'batchDatesCount', COALESCE(array_length(v_meat_dates, 1), 0),
      'summariesUpserted', v_meat_summaries_upserted,
      'rowsPruned', v_meat_rows_pruned,
      'remainingOldDates', v_meat_remaining_dates
    ),
    'orderReady', jsonb_build_object(
      'cutoffDate', v_order_ready_cutoff,
      'batchDatesCount', COALESCE(array_length(v_or_dates, 1), 0),
      'summariesUpserted', v_or_summaries_upserted,
      'announcementsPruned', v_or_ann_pruned,
      'playbacksPruned', v_or_playbacks_pruned,
      'remainingOldDates', v_or_remaining_dates
    ),
    'deliveryRawPayloadSlimmed', v_delivery_slimmed,
    'notificationsPruned', v_notif_pruned,
    'voiceTranscriptsCompacted', jsonb_build_object(
      'cutoffTs', v_voice_cutoff,
      'phoneCalls', v_phone_transcripts_compacted,
      'koreSessions', v_kore_transcripts_compacted
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_retention_maintenance(boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention_maintenance(boolean, integer, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
