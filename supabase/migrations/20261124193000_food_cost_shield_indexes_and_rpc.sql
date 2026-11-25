-- =============================================================================
-- Migration: 20261124193000_food_cost_shield_indexes_and_rpc.sql
-- Purpose:   Food Cost Shield — Critical composite indexes eliminating full-table
--            scans/sorts on ci_small (2 GB RAM) + AM/PM meat consumption summary
--            RPCs replacing 30k-100k raw-row PostgREST scans.
-- Note:      Zero destructive changes. 100% additive and idempotent.
-- =============================================================================

-- 1. Critical composite indexes for Food Cost, Meat Analysis, Variance AvT & Portion Alerts
CREATE INDEX IF NOT EXISTS idx_pmix_daily_cache_date_store
  ON public.pmix_daily_cache (business_date, store_id);

CREATE INDEX IF NOT EXISTS idx_inv_price_history_item_eff_id
  ON public.inventory_price_history (inventory_item_id, effective_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_inv_price_history_eff_id
  ON public.inventory_price_history (effective_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_schedules_store_date
  ON public.schedules (store_id, date);

CREATE INDEX IF NOT EXISTS idx_assistant_checklists_type_date_store
  ON public.assistant_checklists (checklist_type, checklist_date, store_id);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_item_date_store
  ON public.inventory_counts (inventory_item_id, count_date, store_id);

CREATE INDEX IF NOT EXISTS idx_meat_consumption_type_date_store
  ON public.meat_consumption_history (meat_type, business_date, store_id);

CREATE INDEX IF NOT EXISTS idx_punches_store_business_date
  ON public.punches (store_id, business_date);

-- 2. AM (06:00-16:59) vs PM (17:00-05:59) aggregated RPC on meat_consumption_history
--    Replaces fetching 30,000-100,000 raw 30-min interval rows across PostgREST
--    with ~150-1,200 tiny aggregated rows (100% exact parity, zero 40k truncation).
CREATE OR REPLACE FUNCTION public.get_meat_consumption_ampm_summary(
  p_start_date date,
  p_end_date date,
  p_meat_types text[] DEFAULT NULL,
  p_store_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  store_id bigint,
  meat_type text,
  business_date date,
  am_lbs numeric,
  pm_lbs numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    m.store_id,
    UPPER(m.meat_type) AS meat_type,
    m.business_date,
    COALESCE(
      SUM(
        CASE
          WHEN EXTRACT(HOUR FROM COALESCE(m.interval_start, TIME '12:00:00')) BETWEEN 6 AND 16
          THEN m.raw_lbs
          ELSE 0
        END
      ),
      0
    ) AS am_lbs,
    COALESCE(
      SUM(
        CASE
          WHEN EXTRACT(HOUR FROM COALESCE(m.interval_start, TIME '12:00:00')) BETWEEN 6 AND 16
          THEN 0
          ELSE m.raw_lbs
        END
      ),
      0
    ) AS pm_lbs
  FROM public.meat_consumption_history m
  WHERE m.business_date >= p_start_date
    AND m.business_date <= p_end_date
    AND m.raw_lbs > 0
    AND (p_meat_types IS NULL OR m.meat_type = ANY(p_meat_types))
    AND (p_store_ids IS NULL OR m.store_id = ANY(p_store_ids))
  GROUP BY m.store_id, UPPER(m.meat_type), m.business_date
  ORDER BY m.business_date ASC, m.store_id ASC, UPPER(m.meat_type) ASC;
$$;

REVOKE ALL ON FUNCTION public.get_meat_consumption_ampm_summary(date, date, text[], bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_meat_consumption_ampm_summary(date, date, text[], bigint[]) TO service_role;

-- 3. Aggregated totals by meat_type for AI Assistant (queryProductMix)
--    Replaces truncated .limit(500) raw-row queries over 360 MB meat_consumption_history.
CREATE OR REPLACE FUNCTION public.get_meat_consumption_totals_by_type(
  p_start_date date,
  p_end_date date,
  p_store_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  meat_type text,
  total_raw_lbs numeric,
  row_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    UPPER(m.meat_type) AS meat_type,
    COALESCE(SUM(m.raw_lbs), 0) AS total_raw_lbs,
    COUNT(*)::bigint AS row_count
  FROM public.meat_consumption_history m
  WHERE m.business_date >= p_start_date
    AND m.business_date <= p_end_date
    AND m.raw_lbs > 0
    AND (p_store_ids IS NULL OR m.store_id = ANY(p_store_ids))
  GROUP BY UPPER(m.meat_type)
  ORDER BY total_raw_lbs DESC, UPPER(m.meat_type) ASC;
$$;

REVOKE ALL ON FUNCTION public.get_meat_consumption_totals_by_type(date, date, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_meat_consumption_totals_by_type(date, date, bigint[]) TO service_role;
