-- ============================================================================
-- Migration: Sync `food_cost` with `total_cost` on Legacy Upserts in `food_cost_daily_cache`
-- Date: 2026-11-23
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Description:
--   1. Drops `DEFAULT 0` on `food_cost_daily_cache.food_cost` so legacy writers omitting
--      `food_cost` never insert a false `$0` on new business days.
--   2. Adds `BEFORE INSERT OR UPDATE` trigger `trg_sync_food_cost_cache_columns` so any
--      cron/upsert that updates `total_cost` without explicitly updating `food_cost`
--      keeps `food_cost = total_cost` in lockstep.
--   3. Heals any stale `food_cost` rows where `total_cost` advanced ahead of `food_cost`.
-- ============================================================================

ALTER TABLE public.food_cost_daily_cache
  ALTER COLUMN food_cost DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.sync_food_cost_cache_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.food_cost IS NULL OR (NEW.food_cost = 0 AND COALESCE(NEW.total_cost, 0) > 0) THEN
      NEW.food_cost := NEW.total_cost;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.total_cost IS DISTINCT FROM OLD.total_cost
       AND NEW.food_cost IS NOT DISTINCT FROM OLD.food_cost THEN
      NEW.food_cost := NEW.total_cost;
    ELSIF NEW.food_cost IS NULL AND NEW.total_cost IS NOT NULL THEN
      NEW.food_cost := NEW.total_cost;
    END IF;
  END IF;

  IF COALESCE(NEW.net_sales, 0) > 0 AND COALESCE(NEW.packaging_cost, 0) > 0 THEN
    NEW.packaging_percentage := ROUND((NEW.packaging_cost / NEW.net_sales) * 100, 2);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_food_cost_cache_columns ON public.food_cost_daily_cache;
CREATE TRIGGER trg_sync_food_cost_cache_columns
  BEFORE INSERT OR UPDATE ON public.food_cost_daily_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_food_cost_cache_columns();

UPDATE public.food_cost_daily_cache
SET food_cost = total_cost
WHERE COALESCE(total_cost, 0) > 0
  AND food_cost IS DISTINCT FROM total_cost;

-- Heal pre-July-2026 legacy price_history rows seeded with default quantity_per_unit = 1 on multi-unit cases/drums
UPDATE public.inventory_price_history iph
SET quantity_per_unit = ii.quantity_per_unit
FROM public.inventory_items ii
WHERE iph.inventory_item_id = ii.id
  AND iph.quantity_per_unit = 1
  AND ii.quantity_per_unit > 1
  AND iph.effective_date < '2026-07-01T00:00:00Z';

