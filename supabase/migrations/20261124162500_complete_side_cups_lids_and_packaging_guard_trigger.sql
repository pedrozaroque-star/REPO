-- =====================================================================================
-- Migration: 20261124162500_complete_side_cups_lids_and_packaging_guard_trigger.sql
-- Description:
--   1. Completa vasos (`EL4OZ` / `EL8OZ`) en los 3 canales y tapas (`EL4LID` / `EL8LID`)
--      únicamente en `cogs_takeout` (ToGo/DT) y `cogs_delivery` para:
--        - `Whole Beans` (`c09a1208-e42f-4ee3-aa64-f1fab2668b58`) -> 4 oz cup + lid
--        - `Side Order Cotija` (`b162aea2-7573-481e-8ce1-ad7afbcb0d94`) -> 4 oz cup + lid
--        - `Side Order Queso Fresco` (`f3a10b37-d73d-4aa2-88c9-aa00a094086d`) -> 4 oz cup + lid
--        - `Side Order Beans/Rice` (`7ec91ecd-9e8a-4062-aa4f-a62e0b845e9a`) -> 8 oz cup + lid
--   2. Candado a nivel PostgreSQL (`trg_lock_canonical_inventory_packaging`) para evitar
--      que cualquier ejecución de `sync-quickbooks` revierta `Amarillo Cheese` (`440 oz`),
--      `Cheesecake` individual (`1 pza`) o `Rajas y Zanahorias` (`6.5625 lb`).
-- =====================================================================================

INSERT INTO public.recipes (toast_menu_item_guid, inventory_item_id, quantity, unit, type)
SELECT v.guid, v.inv_id::uuid, 1.0000, 'pza', v.ch_type
FROM (
  VALUES
    -- Whole Beans (4 oz Frijol Entero -> vaso 4 oz + tapa 4 oz en takeout/delivery)
    ('c09a1208-e42f-4ee3-aa64-f1fab2668b58', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_dine_in'),
    ('c09a1208-e42f-4ee3-aa64-f1fab2668b58', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_takeout'),
    ('c09a1208-e42f-4ee3-aa64-f1fab2668b58', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_delivery'),
    ('c09a1208-e42f-4ee3-aa64-f1fab2668b58', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_takeout'),
    ('c09a1208-e42f-4ee3-aa64-f1fab2668b58', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_delivery'),
    -- Side Order Cotija (4 oz -> vaso 4 oz + tapa 4 oz en takeout/delivery)
    ('b162aea2-7573-481e-8ce1-ad7afbcb0d94', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_dine_in'),
    ('b162aea2-7573-481e-8ce1-ad7afbcb0d94', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_takeout'),
    ('b162aea2-7573-481e-8ce1-ad7afbcb0d94', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_delivery'),
    ('b162aea2-7573-481e-8ce1-ad7afbcb0d94', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_takeout'),
    ('b162aea2-7573-481e-8ce1-ad7afbcb0d94', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_delivery'),
    -- Side Order Queso Fresco (1 rebanada -> vaso 4 oz + tapa 4 oz en takeout/delivery)
    ('f3a10b37-d73d-4aa2-88c9-aa00a094086d', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_dine_in'),
    ('f3a10b37-d73d-4aa2-88c9-aa00a094086d', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_takeout'),
    ('f3a10b37-d73d-4aa2-88c9-aa00a094086d', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_delivery'),
    ('f3a10b37-d73d-4aa2-88c9-aa00a094086d', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_takeout'),
    ('f3a10b37-d73d-4aa2-88c9-aa00a094086d', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_delivery'),
    -- Side Order Beans/Rice (4 oz Arroz + 4 oz Frijol Molido -> vaso 8 oz + tapa 8 oz en takeout/delivery)
    ('7ec91ecd-9e8a-4062-aa4f-a62e0b845e9a', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_dine_in'),
    ('7ec91ecd-9e8a-4062-aa4f-a62e0b845e9a', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_takeout'),
    ('7ec91ecd-9e8a-4062-aa4f-a62e0b845e9a', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_delivery'),
    ('7ec91ecd-9e8a-4062-aa4f-a62e0b845e9a', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_takeout'),
    ('7ec91ecd-9e8a-4062-aa4f-a62e0b845e9a', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_delivery')
) AS v(guid, inv_id, ch_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.recipes r
  WHERE r.toast_menu_item_guid = v.guid
    AND r.inventory_item_id = v.inv_id::uuid
    AND r.type = v.ch_type
);

-- Candado permanente de unidades físicas reales verificadas en bodega/sucursal
CREATE OR REPLACE FUNCTION public.enforce_canonical_inventory_packaging()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = '62968b74-7877-4650-aa43-4ec6e9eb1888'::uuid THEN
    NEW.quantity_per_unit := 440;
    NEW.order_unit_description := '(Case of 440 oz)';
  ELSIF NEW.id = '8ba55664-5ca9-4886-8ac8-acf1fd070713'::uuid THEN
    NEW.quantity_per_unit := 1;
    NEW.order_unit_description := '(Per Unit)';
  ELSIF NEW.id = 'd56d8df8-d30c-4964-a425-9aa25d962364'::uuid THEN
    NEW.quantity_per_unit := 6.5625;
    NEW.order_unit_description := '(Bag of 6 lbs 9 oz)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_canonical_inventory_packaging ON public.inventory_items;
CREATE TRIGGER trg_lock_canonical_inventory_packaging
  BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_canonical_inventory_packaging();

UPDATE public.inventory_items
SET quantity_per_unit = 440,
    order_unit_description = '(Case of 440 oz)'
WHERE id = '62968b74-7877-4650-aa43-4ec6e9eb1888'::uuid;

UPDATE public.inventory_items
SET quantity_per_unit = 1,
    order_unit_description = '(Per Unit)'
WHERE id = '8ba55664-5ca9-4886-8ac8-acf1fd070713'::uuid;

UPDATE public.inventory_items
SET quantity_per_unit = 6.5625,
    order_unit_description = '(Bag of 6 lbs 9 oz)'
WHERE id = 'd56d8df8-d30c-4964-a425-9aa25d962364'::uuid;
