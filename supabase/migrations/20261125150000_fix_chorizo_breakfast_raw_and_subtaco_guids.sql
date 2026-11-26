-- =====================================================================================
-- Migration: 20261125150000_fix_chorizo_breakfast_raw_and_subtaco_guids.sql
-- Description:
--   1. Desayunos con Chorizo (`Burrito Huevos con Chorizo`, `Huevos con Chorizo`,
--      `Torta Huevos con Chorizo`): regla oficial aprobada por Carlos de media bolsita
--      cruda de 8 oz = `4.0000 oz` crudas (`type = 'raw'`), evitando que el rendimiento
--      empírico de cocción `67.00%` de `321W Chorizo 8 oz` infle la porción de media
--      bolsita (`0.5000` paq) a `0.5597` paq (`+11.94%`).
--   2. Registra en `public.toast_menu_items` y `public.recipes` los 9 GUIDs alternos
--      reales de sub-tacos de `Taco Plate` detectados en `pmix_daily_cache` (`327`
--      ocurrencias en 14 días), espejando exactamente las filas de receta de sus
--      contrapartes canónicas de forma 100% idempotente (cero duplicados al re-ejecutar).
-- =====================================================================================

-- 1. Desayunos con Chorizo -> exactamente 4.0000 oz crudas (`type = 'raw'` = 0.5000 bolsa de 8 oz)
UPDATE public.recipes
SET quantity = 4.0000,
    unit = 'oz',
    type = 'raw'
WHERE inventory_item_id = '1e4c43b6-4e1b-4e51-8617-e127b89467f1'::uuid
  AND toast_menu_item_guid IN (
    'a3a43c21-cffe-4cbe-81d4-7afda41b724d', -- Burrito Huevos con Chorizo
    '4712873a-4981-40ca-a929-33f60645bd69', -- Huevos con Chorizo
    'a0e3e9c6-eec2-40b7-b661-d775944f4e2d'  -- Torta Huevos con Chorizo
  );

-- 2a. Upsert idempotente de los 9 GUIDs alternos de sub-taco de Taco Plate en `public.toast_menu_items`
INSERT INTO public.toast_menu_items (
  guid,
  name,
  sku,
  price,
  group_name,
  is_modifier,
  active,
  recipe_na
)
VALUES
  ('805f478f-ccde-4f29-9382-cf2fbd52fb81', 'Taco Asada', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('b269208e-224e-4d32-b6b6-b5348a4e60e6', 'Taco Pastor', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('cf155144-c32d-4e59-a8de-2df89174e5af', 'Taco Pollo', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('8d294851-8467-4f2f-8516-3a257a8dc303', 'Taco Chorizo', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('1bf17785-6d16-453f-b456-4ba6db53ad32', 'Taco Carnitas', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('d2cc407f-0e92-4fd3-8dcd-2b9f80e95ef9', 'Taco Lengua', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('7a6f5b1f-0ae1-4f32-b12b-db59a4f7ae2b', 'Taco Cabeza', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('5bcb26d6-53ee-4c9c-9f72-bf66faba53bd', 'Taco Vegetariano', NULL, 0, '[Mod] Taco Plate Choices', true, true, false),
  ('51e161dc-41cb-4c5c-a3a4-4b16f936bbad', 'Taco Buche', NULL, 0, '[Mod] Taco Plate Choices', true, true, false)
ON CONFLICT (guid) DO UPDATE
SET name = EXCLUDED.name,
    is_modifier = EXCLUDED.is_modifier,
    active = true,
    recipe_na = false;

-- 2b. Sincronización e inserción idempotente de las filas de receta desde los GUIDs canónicos
WITH subtaco_guid_map (alt_guid, canonical_guid) AS (
  VALUES
    ('805f478f-ccde-4f29-9382-cf2fbd52fb81', '6141b8b8-8707-4632-a837-81cfccffc0e6'), -- Taco Asada
    ('b269208e-224e-4d32-b6b6-b5348a4e60e6', 'a29735c2-48a6-4f65-86c1-e2f27614f718'), -- Taco Pastor
    ('cf155144-c32d-4e59-a8de-2df89174e5af', '87bbf158-caf5-4d15-b747-d8af3185c802'), -- Taco Pollo
    ('8d294851-8467-4f2f-8516-3a257a8dc303', 'f6c84203-de05-485b-b1db-c80ff297d211'), -- Taco Chorizo
    ('1bf17785-6d16-453f-b456-4ba6db53ad32', '51886888-6e37-477b-8147-9741c7145d0b'), -- Taco Carnitas
    ('d2cc407f-0e92-4fd3-8dcd-2b9f80e95ef9', '24d8b7d3-a261-42a3-bdbb-d44345d51548'), -- Taco Lengua
    ('7a6f5b1f-0ae1-4f32-b12b-db59a4f7ae2b', '2073726e-5ec6-417d-a6d2-ae367e663c04'), -- Taco Cabeza
    ('5bcb26d6-53ee-4c9c-9f72-bf66faba53bd', '7b591175-fa2c-455a-83cf-2627cd11fcad'), -- Taco Vegetariano
    ('51e161dc-41cb-4c5c-a3a4-4b16f936bbad', 'f97a828f-18d0-48aa-ad0d-2b26d0ff59a1')  -- Taco Buche
)
UPDATE public.recipes AS dst
SET quantity = src.quantity,
    unit = src.unit
FROM subtaco_guid_map AS m
JOIN public.recipes AS src
  ON src.toast_menu_item_guid = m.canonical_guid
WHERE dst.toast_menu_item_guid = m.alt_guid
  AND dst.inventory_item_id = src.inventory_item_id
  AND COALESCE(dst.type, 'food') = COALESCE(src.type, 'food')
  AND (dst.quantity IS DISTINCT FROM src.quantity OR dst.unit IS DISTINCT FROM src.unit);

WITH subtaco_guid_map (alt_guid, canonical_guid) AS (
  VALUES
    ('805f478f-ccde-4f29-9382-cf2fbd52fb81', '6141b8b8-8707-4632-a837-81cfccffc0e6'), -- Taco Asada
    ('b269208e-224e-4d32-b6b6-b5348a4e60e6', 'a29735c2-48a6-4f65-86c1-e2f27614f718'), -- Taco Pastor
    ('cf155144-c32d-4e59-a8de-2df89174e5af', '87bbf158-caf5-4d15-b747-d8af3185c802'), -- Taco Pollo
    ('8d294851-8467-4f2f-8516-3a257a8dc303', 'f6c84203-de05-485b-b1db-c80ff297d211'), -- Taco Chorizo
    ('1bf17785-6d16-453f-b456-4ba6db53ad32', '51886888-6e37-477b-8147-9741c7145d0b'), -- Taco Carnitas
    ('d2cc407f-0e92-4fd3-8dcd-2b9f80e95ef9', '24d8b7d3-a261-42a3-bdbb-d44345d51548'), -- Taco Lengua
    ('7a6f5b1f-0ae1-4f32-b12b-db59a4f7ae2b', '2073726e-5ec6-417d-a6d2-ae367e663c04'), -- Taco Cabeza
    ('5bcb26d6-53ee-4c9c-9f72-bf66faba53bd', '7b591175-fa2c-455a-83cf-2627cd11fcad'), -- Taco Vegetariano
    ('51e161dc-41cb-4c5c-a3a4-4b16f936bbad', 'f97a828f-18d0-48aa-ad0d-2b26d0ff59a1')  -- Taco Buche
)
INSERT INTO public.recipes (toast_menu_item_guid, inventory_item_id, quantity, unit, type)
SELECT
  m.alt_guid,
  src.inventory_item_id,
  src.quantity,
  src.unit,
  COALESCE(src.type, 'food')
FROM subtaco_guid_map AS m
JOIN public.recipes AS src
  ON src.toast_menu_item_guid = m.canonical_guid
WHERE NOT EXISTS (
  SELECT 1
  FROM public.recipes AS existing
  WHERE existing.toast_menu_item_guid = m.alt_guid
    AND existing.inventory_item_id = src.inventory_item_id
    AND COALESCE(existing.type, 'food') = COALESCE(src.type, 'food')
);
