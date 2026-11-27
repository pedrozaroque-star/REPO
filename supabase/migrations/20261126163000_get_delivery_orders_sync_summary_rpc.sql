-- RPC agregada en SQL (SECURITY INVOKER, cero OFFSET) para eliminar el escaneo de 30 páginas (30,000 filas)
-- en GET /api/delivery-reconciliation sobre public.delivery_platform_orders (61k+ filas no-TOAST_ONLY).
CREATE OR REPLACE FUNCTION public.get_delivery_orders_sync_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      store_id,
      platform,
      business_date,
      updated_at,
      toast_order_guid,
      payout_reference_id
    FROM public.delivery_platform_orders
    WHERE match_confidence IS DISTINCT FROM 'TOAST_ONLY'
  ),
  by_store_platform AS (
    SELECT
      store_id,
      platform,
      count(*)::int AS orders_count,
      max(updated_at) AS last_synced_at,
      max(business_date)::text AS latest_business_date,
      (count(*) FILTER (WHERE toast_order_guid IS NOT NULL AND toast_order_guid <> ''))::int AS toast_orders_count,
      max(updated_at) FILTER (WHERE toast_order_guid IS NOT NULL AND toast_order_guid <> '') AS toast_last_synced_at,
      (max(business_date) FILTER (WHERE toast_order_guid IS NOT NULL AND toast_order_guid <> ''))::text AS toast_latest_business_date
    FROM base
    GROUP BY store_id, platform
  ),
  explicit_payout_counts AS (
    SELECT
      store_id,
      platform,
      payout_reference_id,
      count(*)::int AS orders_count
    FROM base
    WHERE payout_reference_id IS NOT NULL AND payout_reference_id <> ''
    GROUP BY store_id, platform, payout_reference_id
  ),
  unlinked_by_day AS (
    SELECT
      store_id,
      platform,
      business_date::text AS business_date,
      count(*)::int AS orders_count
    FROM base
    WHERE (payout_reference_id IS NULL OR payout_reference_id = '')
      AND store_id > 0
      AND business_date IS NOT NULL
    GROUP BY store_id, platform, business_date
  )
  SELECT jsonb_build_object(
    'by_store_platform', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM by_store_platform s), '[]'::jsonb),
    'explicit_payout_counts', COALESCE((SELECT jsonb_agg(row_to_json(p)) FROM explicit_payout_counts p), '[]'::jsonb),
    'unlinked_by_day', COALESCE((SELECT jsonb_agg(row_to_json(u)) FROM unlinked_by_day u), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_delivery_orders_sync_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_orders_sync_summary() TO service_role;

-- Endurecimiento de funciones trigger reportadas por Supabase Security Advisor
ALTER FUNCTION public.enforce_canonical_inventory_packaging() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.enforce_canonical_inventory_packaging() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_food_cost_cache_columns() FROM PUBLIC, anon, authenticated;
