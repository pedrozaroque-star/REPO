-- ============================================================================
-- Migration: Food Cost Packaging Split, Price History Healing & Cascade Triggers
-- Date: 2026-11-23
-- Project: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Description:
--   1. Adds food vs packaging split, meat/asada cost, and unmapped sales columns
--      to `public.food_cost_daily_cache` and backfills `food_cost` from `total_cost`.
--   2. Upgrades `public.log_inventory_price_change()` (`SECURITY DEFINER`,
--      `SET search_path = public`) to fire on `purchase_unit_cost` & `quantity_per_unit`,
--      ignore NULL/<=0 costs, deduplicate rapid 5-second updates, always record
--      `quantity_per_unit`, and heals existing NULL `quantity_per_unit` rows.
--   3. Upgrades `public.invalidate_food_cost_cache_on_inventory_change()` to fire
--      on any cost-impacting column (`purchase_unit_cost`, `quantity_per_unit`,
--      `unit_measure`, `unit_type`, `yield_percent`) using the 6:00 AM
--      `America/Los_Angeles` business date (- 7 days).
--   4. Adds `public.invalidate_food_cost_cache_on_recipe_change()` statement trigger
--      on `public.recipes` (`AFTER INSERT OR UPDATE OR DELETE`) to auto-purge the
--      last 7 LA business days of `food_cost_daily_cache`.
--   5. Hardens RLS on `inventory_items`, `inventory_price_history`, `recipes`, and
--      `toast_menu_items`: preserves `authenticated` staff `SELECT` (`is_teg_staff()`)
--      for client readers (`app/inventory/menu/page.tsx`) while restricting all
--      writes (`INSERT/UPDATE/DELETE`) strictly to `service_role`.
-- ============================================================================

-- 1. Upgrade `public.food_cost_daily_cache` columns & backfill
ALTER TABLE public.food_cost_daily_cache
  ADD COLUMN IF NOT EXISTS food_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_percentage numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meat_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asada_raw_lbs numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asada_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unmapped_sales numeric DEFAULT 0;

UPDATE public.food_cost_daily_cache
SET food_cost = total_cost
WHERE food_cost IS NULL
   OR (food_cost = 0 AND total_cost > 0);

-- 2. Heal existing NULL `quantity_per_unit` rows in `public.inventory_price_history`
UPDATE public.inventory_price_history iph
SET quantity_per_unit = COALESCE(NULLIF(ii.quantity_per_unit, 0), 1)
FROM public.inventory_items ii
WHERE iph.inventory_item_id = ii.id
  AND iph.quantity_per_unit IS NULL;

UPDATE public.inventory_price_history
SET quantity_per_unit = 1
WHERE quantity_per_unit IS NULL;

-- 3. Upgrade `public.log_inventory_price_change()` & trigger on `public.inventory_items`
CREATE OR REPLACE FUNCTION public.log_inventory_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_qty numeric;
  v_existing_id uuid;
BEGIN
  -- Guard against NULL or non-positive costs ($0 glitches must never pollute price history)
  IF NEW.purchase_unit_cost IS NULL OR NEW.purchase_unit_cost <= 0 THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only proceed when purchase_unit_cost or quantity_per_unit actually changed
  IF TG_OP = 'UPDATE'
     AND NOT (
       OLD.purchase_unit_cost IS DISTINCT FROM NEW.purchase_unit_cost
       OR OLD.quantity_per_unit IS DISTINCT FROM NEW.quantity_per_unit
     ) THEN
    RETURN NEW;
  END IF;

  v_qty := CASE
    WHEN NEW.quantity_per_unit IS NOT NULL AND NEW.quantity_per_unit > 0
      THEN NEW.quantity_per_unit
    ELSE 1
  END;

  -- Deduplicate rapid multi-step updates (e.g. price update followed by packaging qty update within 5s)
  SELECT iph.id
    INTO v_existing_id
    FROM public.inventory_price_history iph
   WHERE iph.inventory_item_id = NEW.id
     AND iph.purchase_unit_cost = NEW.purchase_unit_cost
     AND iph.effective_date >= (NOW() - INTERVAL '5 seconds')
   ORDER BY iph.effective_date DESC
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.inventory_price_history
       SET quantity_per_unit = v_qty
     WHERE id = v_existing_id
       AND quantity_per_unit IS DISTINCT FROM v_qty;
  ELSE
    INSERT INTO public.inventory_price_history (
      inventory_item_id,
      purchase_unit_cost,
      quantity_per_unit,
      effective_date
    ) VALUES (
      NEW.id,
      NEW.purchase_unit_cost,
      v_qty,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_log_inventory_price ON public.inventory_items;
CREATE TRIGGER trigger_log_inventory_price
  AFTER INSERT OR UPDATE OF purchase_unit_cost, quantity_per_unit
  ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.log_inventory_price_change();

-- 4. Upgrade `public.invalidate_food_cost_cache_on_inventory_change()` & trigger
CREATE OR REPLACE FUNCTION public.invalidate_food_cost_cache_on_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cutoff_date date;
BEGIN
  IF (OLD.purchase_unit_cost IS DISTINCT FROM NEW.purchase_unit_cost)
     OR (OLD.quantity_per_unit IS DISTINCT FROM NEW.quantity_per_unit)
     OR (OLD.unit_measure IS DISTINCT FROM NEW.unit_measure)
     OR (OLD.unit_type IS DISTINCT FROM NEW.unit_type)
     OR (OLD.yield_percent IS DISTINCT FROM NEW.yield_percent) THEN
    v_cutoff_date := (((NOW() AT TIME ZONE 'America/Los_Angeles') - INTERVAL '6 hours')::date - INTERVAL '7 days')::date;
    DELETE FROM public.food_cost_daily_cache
     WHERE business_date >= v_cutoff_date;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_invalidate_fc_cache_on_inventory_change ON public.inventory_items;
CREATE TRIGGER trg_invalidate_fc_cache_on_inventory_change
  AFTER UPDATE OF purchase_unit_cost, quantity_per_unit, unit_measure, unit_type, yield_percent
  ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_food_cost_cache_on_inventory_change();

-- 5. Create `public.invalidate_food_cost_cache_on_recipe_change()` & statement trigger on `public.recipes`
CREATE OR REPLACE FUNCTION public.invalidate_food_cost_cache_on_recipe_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cutoff_date date;
BEGIN
  v_cutoff_date := (((NOW() AT TIME ZONE 'America/Los_Angeles') - INTERVAL '6 hours')::date - INTERVAL '7 days')::date;
  DELETE FROM public.food_cost_daily_cache
   WHERE business_date >= v_cutoff_date;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_invalidate_fc_cache_on_recipe_change ON public.recipes;
CREATE TRIGGER trg_invalidate_fc_cache_on_recipe_change
  AFTER INSERT OR UPDATE OR DELETE
  ON public.recipes
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.invalidate_food_cost_cache_on_recipe_change();

-- Lock down direct RPC execution on SECURITY DEFINER trigger functions
REVOKE EXECUTE ON FUNCTION
  public.log_inventory_price_change(),
  public.invalidate_food_cost_cache_on_inventory_change(),
  public.invalidate_food_cost_cache_on_recipe_change()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.log_inventory_price_change(),
  public.invalidate_food_cost_cache_on_inventory_change(),
  public.invalidate_food_cost_cache_on_recipe_change()
TO service_role;

-- 6. Harden RLS on catalog/recipe/history tables:
--    Keep staff SELECT (`is_teg_staff()`) for browser client reads (`app/inventory/menu/page.tsx`),
--    restrict INSERT/UPDATE/DELETE strictly to `service_role`.
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'inventory_items',
    'inventory_price_history',
    'recipes',
    'toast_menu_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM authenticated', v_tbl);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'teg_staff_all_' || v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'teg_staff_select_' || v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_role_all_' || v_tbl, v_tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_teg_staff())',
      'teg_staff_select_' || v_tbl,
      v_tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'service_role_all_' || v_tbl,
      v_tbl
    );
  END LOOP;
END $$;

-- 7. Heal legacy `unit_type` labels on the 4 post-cutover meats (bag weights halved 2026-07-24;
--    `quantity_per_unit` & `purchase_unit_cost` remain untouched):
UPDATE public.inventory_items
SET unit_type = '5 lb', updated_at = NOW()
WHERE id IN (
  'ad7e3703-2701-4a05-aa97-77866c8c717e', -- Pastor (qpu = 5, Bag of 5 lbs)
  '4ea7ef9c-986e-4fc1-a363-7200ca558aab'  -- Pollo  (qpu = 5, Bag of 5 lbs)
)
  AND unit_type IS DISTINCT FROM '5 lb';

UPDATE public.inventory_items
SET unit_type = '2.5 lb', updated_at = NOW()
WHERE id IN (
  '511e341b-ca42-44ed-89df-a4a84b51a619', -- Cabeza (qpu = 2.5, Bag of 2.5 lbs)
  '0fb87578-1185-41a9-a318-97428db20a5d'  -- Lengua (qpu = 2.5, Bag of 2.5 lbs)
)
  AND unit_type IS DISTINCT FROM '2.5 lb';

-- 8. Map the 5 previously unmapped active `In Store Menu > Catering (In Store)` items in `public.recipes`
--    (achieving 100% active non-modifier recipe coverage: 228/228):
--    * `2 lb Meat` (ab5adddd-12bd-4871-b6a3-af1c590752b6): 32 oz cooked Carne Asada base (reallocated dynamically by `parseProteinAllocation`) + 1x RC478 + 1x 709DO
--    * `6 lb Meat` (898d1dd3-a406-4bb7-a5c6-c27aa3f0f961): 96 oz cooked Carne Asada base + 1x RC1150 (Half Pan) + 1x RL970 (Half Lid)
--    * `12 lb Meat` (43fc20b5-0252-4847-bf66-e1dcdd5ad3a1): 192 oz cooked Carne Asada base + 1x RC1174 (Full Pan) + 1x RL990 (Full Lid)
--    * `20 oz. Salsa` (7badb46f-87aa-4db6-9fbc-1e6cb79ea312): 10 fl oz Salsa Roja + 10 fl oz Salsa Verde + 1x RC478 + 1x 709DO
--    * `Full Cheesecake` (ff32565b-9be6-419c-8ab2-c8fb65d015f5): 8 pza Whole Cheese Cake (253W, $14 / 8 slices, matching Full Flan 252W)
INSERT INTO public.recipes (toast_menu_item_guid, inventory_item_id, quantity, unit, type)
VALUES
  -- 2 lb Meat ($25.69)
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', 'fab9d589-8ae8-4381-87da-85f836068996', 32, 'oz', 'food'),
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', '85533c59-b2df-4af3-bf2b-e684d3d6c125', 1, 'pza', 'cogs_dine_in'),
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', '85533c59-b2df-4af3-bf2b-e684d3d6c125', 1, 'pza', 'cogs_takeout'),
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', '85533c59-b2df-4af3-bf2b-e684d3d6c125', 1, 'pza', 'cogs_delivery'),
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', 'eba87715-ea18-4f9c-8f22-44c745e86572', 1, 'pza', 'cogs_dine_in'),
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', 'eba87715-ea18-4f9c-8f22-44c745e86572', 1, 'pza', 'cogs_takeout'),
  ('ab5adddd-12bd-4871-b6a3-af1c590752b6', 'eba87715-ea18-4f9c-8f22-44c745e86572', 1, 'pza', 'cogs_delivery'),

  -- 6 lb Meat ($63.79)
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', 'fab9d589-8ae8-4381-87da-85f836068996', 96, 'oz', 'food'),
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', 'd415c752-ee89-4ff0-af67-f1499f9d7fa3', 1, 'pza', 'cogs_dine_in'),
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', 'd415c752-ee89-4ff0-af67-f1499f9d7fa3', 1, 'pza', 'cogs_takeout'),
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', 'd415c752-ee89-4ff0-af67-f1499f9d7fa3', 1, 'pza', 'cogs_delivery'),
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', '93379ffd-cb66-4521-8561-17b5c5f90603', 1, 'pza', 'cogs_dine_in'),
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', '93379ffd-cb66-4521-8561-17b5c5f90603', 1, 'pza', 'cogs_takeout'),
  ('898d1dd3-a406-4bb7-a5c6-c27aa3f0f961', '93379ffd-cb66-4521-8561-17b5c5f90603', 1, 'pza', 'cogs_delivery'),

  -- 12 lb Meat ($117.29)
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', 'fab9d589-8ae8-4381-87da-85f836068996', 192, 'oz', 'food'),
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', 'e1a10e05-6810-4fd7-923a-1d1fb356019a', 1, 'pza', 'cogs_dine_in'),
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', 'e1a10e05-6810-4fd7-923a-1d1fb356019a', 1, 'pza', 'cogs_takeout'),
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', 'e1a10e05-6810-4fd7-923a-1d1fb356019a', 1, 'pza', 'cogs_delivery'),
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', '7c1d3e70-0fe0-40c1-8847-0d2467020264', 1, 'pza', 'cogs_dine_in'),
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', '7c1d3e70-0fe0-40c1-8847-0d2467020264', 1, 'pza', 'cogs_takeout'),
  ('43fc20b5-0252-4847-bf66-e1dcdd5ad3a1', '7c1d3e70-0fe0-40c1-8847-0d2467020264', 1, 'pza', 'cogs_delivery'),

  -- 20 oz. Salsa ($6.69) -> 10 fl oz Salsa Roja + 10 fl oz Salsa Verde + RC478 + 709DO
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', 'aa8d2711-fbd7-45b7-9223-52a2722ffd0e', 10, 'fl oz', 'food'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', '68a502a5-7e28-4b63-a830-47b9acb91bdf', 10, 'fl oz', 'food'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', '85533c59-b2df-4af3-bf2b-e684d3d6c125', 1, 'pza', 'cogs_dine_in'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', '85533c59-b2df-4af3-bf2b-e684d3d6c125', 1, 'pza', 'cogs_takeout'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', '85533c59-b2df-4af3-bf2b-e684d3d6c125', 1, 'pza', 'cogs_delivery'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', 'eba87715-ea18-4f9c-8f22-44c745e86572', 1, 'pza', 'cogs_dine_in'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', 'eba87715-ea18-4f9c-8f22-44c745e86572', 1, 'pza', 'cogs_takeout'),
  ('7badb46f-87aa-4db6-9fbc-1e6cb79ea312', 'eba87715-ea18-4f9c-8f22-44c745e86572', 1, 'pza', 'cogs_delivery'),

  -- Full Cheesecake ($27.89) -> 8 pza Whole Cheese Cake (253W, $14 / 8 slices = $14.00, 1:1 with Full Flan)
  ('ff32565b-9be6-419c-8ab2-c8fb65d015f5', '2e53d7a5-67ff-4247-83cf-1d976650a9bf', 8, 'pza', 'food')
ON CONFLICT (toast_menu_item_guid, inventory_item_id, type)
DO UPDATE SET
  quantity = EXCLUDED.quantity,
  unit = EXCLUDED.unit;

NOTIFY pgrst, 'reload schema';
