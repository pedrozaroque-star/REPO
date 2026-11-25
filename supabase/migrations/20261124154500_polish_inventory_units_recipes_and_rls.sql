-- =====================================================================================
-- Migration: 20261124154500_polish_inventory_units_recipes_and_rls.sql
-- Description:
--   1. Restaura y blinda `Amarillo Cheese` (`440 oz`), corrige `Cheesecake` individual (`36 -> 1 pza`,
--      $1.85/rebanada) y corrige `Rajas y Zanahorias` (`6 -> 6.5625 lb` = 6 lb 9 oz) en
--      `inventory_items` e `inventory_price_history`.
--   2. Corrige `Full Cheesecake` y `Full Flan` en `public.recipes` de `8 Whole Cakes` ($112) -> `1 Whole Cake` ($14).
--   3. Inserta la línea alimentaria base de `Side Order Carne` (`6.0 oz` cocidas de Carne Asada, `type = 'cooked'`)
--      para paridad 100% entre `public.recipes`, Food Cost, Preparador y Orden Diaria.
--   4. Normaliza `Dz. Tortillas Harina` (`12 pza`) y `Con Lechuga (In Store)` (`unit = 'pza'`) en `public.recipes`.
--   5. Agrega políticas explícitas de RLS en `public.missing_meat_modifier_alerts`.
-- =====================================================================================

-- 1a. Amarillo Cheese -> 440 oz por caja (4 bolsas x 110 oz)
UPDATE public.inventory_items
SET quantity_per_unit = 440,
    order_unit_description = '(Case of 440 oz)'
WHERE id = '62968b74-7877-4650-aa43-4ec6e9eb1888';

UPDATE public.inventory_price_history
SET quantity_per_unit = 440
WHERE inventory_item_id = '62968b74-7877-4650-aa43-4ec6e9eb1888'
  AND quantity_per_unit <> 440;

-- 1b. Cheesecake individual -> 1 pza por unidad ($1.85 c/u, igual que Flan)
UPDATE public.inventory_items
SET quantity_per_unit = 1
WHERE id = '8ba55664-5ca9-4886-8ac8-acf1fd070713'
  AND quantity_per_unit = 36;

UPDATE public.inventory_price_history
SET quantity_per_unit = 1
WHERE inventory_item_id = '8ba55664-5ca9-4886-8ac8-acf1fd070713'
  AND quantity_per_unit = 36;

-- 1c. Rajas y Zanahorias -> 6.5625 lb (6 lbs 9 oz exactas)
UPDATE public.inventory_items
SET quantity_per_unit = 6.5625
WHERE id = 'd56d8df8-d30c-4964-a425-9aa25d962364'
  AND quantity_per_unit = 6;

UPDATE public.inventory_price_history
SET quantity_per_unit = 6.5625
WHERE inventory_item_id = 'd56d8df8-d30c-4964-a425-9aa25d962364'
  AND quantity_per_unit = 6;

-- 2. Full Cheesecake y Full Flan -> 1 pieza de Whole Cheese Cake / Whole Flan (antes decía 8 enteros = $112 USD)
UPDATE public.recipes
SET quantity = 1.0000
WHERE toast_menu_item_guid IN (
    'ff32565b-9be6-419c-8ab2-c8fb65d015f5', -- Full Cheesecake
    '538f2016-dc03-49d1-9337-f69a356799e3'  -- Full Flan
  )
  AND inventory_item_id IN (
    '2e53d7a5-67ff-4247-83cf-1d976650a9bf', -- Whole Cheese Cake
    '6528faad-ab6c-4e7c-8f37-1297bb8ef957'  -- Whole Flan
  )
  AND quantity = 8.0000;

-- 3. Side Order Carne -> línea alimentaria base (6.0 oz cocidas de Carne Asada por defecto)
INSERT INTO public.recipes (toast_menu_item_guid, inventory_item_id, quantity, unit, type)
SELECT
  'ada1f576-a22b-469f-9042-ed1d5ddea10f',
  'fab9d589-8ae8-4381-87da-85f836068996',
  6.0000,
  'oz',
  'cooked'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.recipes
  WHERE toast_menu_item_guid = 'ada1f576-a22b-469f-9042-ed1d5ddea10f'
    AND inventory_item_id = 'fab9d589-8ae8-4381-87da-85f836068996'
    AND type IN ('food', 'cooked', 'raw')
);

-- 4. Normalizar unidades en public.recipes (`1 dz` -> `12 pza` en Dz. Tortillas Harina; `pieza` -> `pza`)
UPDATE public.recipes
SET quantity = 12.0000,
    unit = 'pza'
WHERE toast_menu_item_guid = '57514ded-c8de-4664-8ccc-ad6d8d8f6824'
  AND inventory_item_id = '1df90372-7648-4ec1-9a6c-fca4032095a6'
  AND unit = '1 dz'
  AND quantity = 1.0000;

UPDATE public.recipes
SET unit = 'pza'
WHERE unit = 'pieza';

-- 5. Políticas explícitas RLS para `public.missing_meat_modifier_alerts`
DROP POLICY IF EXISTS service_role_all_missing_meat_modifier_alerts ON public.missing_meat_modifier_alerts;
CREATE POLICY service_role_all_missing_meat_modifier_alerts
  ON public.missing_meat_modifier_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS teg_staff_select_missing_meat_modifier_alerts ON public.missing_meat_modifier_alerts;
CREATE POLICY teg_staff_select_missing_meat_modifier_alerts
  ON public.missing_meat_modifier_alerts
  FOR SELECT
  TO authenticated
  USING (public.is_teg_staff());
