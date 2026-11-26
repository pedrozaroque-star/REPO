-- =====================================================================================
-- Migration: 20261125161500_apply_carlos_confirmed_recipe_calibrations.sql
-- Description:
--   Aplica EXCLUSIVAMENTE las 6 calibraciones de recetas 100% confirmadas por Carlos
--   en entrevista operativa (100% idempotente, cero columnas generadas, cero duplicados):
--
--   A. Burrito Beans/Cheese (sin arroz ni carne, 17957b49...):
--        022W Frijol Molido 4.0 oz -> 8.0000 oz (doble porción de frijol).
--        Burrito Beans/Cheese/Rice, Super Burrito Beans/Rice/Cheese y Burrito Rice/Beans
--        permanecen en 4.0 oz; Super Nachos permanece con 0 filas de Frijol Molido.
--   B. Super Nachos (9 platillos activos):
--        045W Amarillo Cheese 4.0 oz -> 5.0000 oz.
--        Side Order Nacho Cheese (4.0 oz) y modificadores permanecen sin cambio.
--   C. Aguas Frescas (001W Horchata, 002W Tamarindo, 003W Jamaica, 004W Piña):
--        Volumen líquido neto descontando hielo (bolsa de 1 galón viene lista para servir):
--        Medium (22 oz -> 14.0000 oz) y Large (32 oz -> 20.0000 oz).
--        Modificadores de 1 Gallon (Gallon Agua / Party Trays) permanecen 1:1 sin cambio.
--   D. 026W Queso Rayado (Jack Cheese) — unificación de modificadores:
--        - Taco / Mulita / Sope (5 GUIDs): 1.0 oz -> 0.6000 oz.
--        - Burrito / Plato / S.Quesadilla (d84e275e..., 27a8f0b4..., 9433e2b2...): 4.0 oz -> 2.1000 oz.
--        - Taco Plate Add Ons (227b174e..., 62895f5b..., 3 tacos × 0.6 oz): 3.0 oz -> 1.8000 oz.
--        Mulitas base y Platos base conservan 0 filas de 026W.
--   E. 029W Queso Fresco (Queso Tortas/platos/Desayuno, paquete de 20 pzas):
--        Upsert idempotente de 1.0000 pza ('food') en TODAS las Tortas activas con receta
--        (carnes, Milanesa, Jamón, Cubana, Queso, Salchicha, Vegetariana y Huevo; excluye
--        Torta Tripa con recipe_na = true). Platos regulares conservan 0 filas de 029W
--        porque su rebanada viene incluida dentro de 271W Papelito Para Torta.
--   F. 043W Tortilla Regular 8 in (Harina):
--        Modificadores Flour Tortilla (53d8f1fc...) y Harina (3410e9f6...): 1.0 -> 2.0000 pza.
--        Half Flour/Corn (1dd7c34e...) permanece en 1 pza harina + 4 pza maíz.
--
--   SIN TOCAR (verificado): 009W Carne Asada (61.5%), 271W Papelito, 017W Salchicha (0.8 oz),
--   1100 Corn Tortilla (+6.5%), 034W Huevo (2 pza), 251W Cheesecake ($1.85), Olla Café Regular.
-- =====================================================================================

-- A. Burrito Beans/Cheese (sin arroz ni carne) -> 8.0000 oz de 022W Frijol Molido
UPDATE public.recipes
SET quantity = 8.0000,
    unit = 'oz'
WHERE inventory_item_id = '557d9414-c769-4399-a6cc-15bb81cba85f'::uuid -- 022W Frijol Molido
  AND toast_menu_item_guid = '17957b49-2c20-40fb-a3cc-a28fae7172fb'    -- Burrito Beans/Cheese
  AND (quantity IS DISTINCT FROM 8.0000 OR unit IS DISTINCT FROM 'oz');

-- B. Super Nachos (9 platillos activos) -> 5.0000 oz de 045W Amarillo Cheese
UPDATE public.recipes
SET quantity = 5.0000,
    unit = 'oz'
WHERE inventory_item_id = '62968b74-7877-4650-aa43-4ec6e9eb1888'::uuid -- 045W Amarillo Cheese
  AND toast_menu_item_guid IN (
    'c2c29494-ef57-4e99-88e1-0923366f94b9', -- Super Nachos Asada
    '0454767e-78f2-4c94-be9d-8dd2ee08edd9', -- Super Nachos Pastor
    'fc4e3ab4-edba-4cec-bd38-892a3c8806ae', -- Super Nachos Chorizo
    '1d9b2a65-9f93-450a-a3f0-a99ec110c6c7', -- Super Nachos Pollo
    '86e28af9-6d6c-4f40-982c-4682c76a7995', -- Super Nachos Cabeza
    '7598ecc9-3ba9-42da-993a-a12557846d9f', -- Super Nachos Lengua
    '5df60269-099b-4353-b16e-764ea848327f', -- Super Nachos Buche
    '20c7d3f5-d354-46e3-a2ef-513ef910509c', -- Super Nachos No Carne
    'a7cad89d-2deb-427f-a296-16e5db79f569'  -- Super Nachos Carnitas
  )
  AND (quantity IS DISTINCT FROM 5.0000 OR unit IS DISTINCT FROM 'oz');

-- C1. Aguas Frescas Medium (22 oz -> 14.0000 oz líquido neto descontando hielo)
UPDATE public.recipes
SET quantity = 14.0000,
    unit = 'oz'
WHERE inventory_item_id IN (
    '085ecb0d-c711-4134-ae1a-f7630a22759c'::uuid, -- 001W Horchata
    'b6f3f5de-c554-4650-b0df-09dd5d3ca053'::uuid, -- 002W Tamarindo Concentrate
    '6051e960-7564-41f6-9a52-ff79ed7c6353'::uuid, -- 003W Jamaica Concentrate
    '9851a32c-dc35-4653-a1e4-b2cf7bac9009'::uuid  -- 004W Piña Concentrate
  )
  AND toast_menu_item_guid IN (
    '9b752302-33fb-4994-b592-92775203d772', -- Medium Horchata
    '4ba378bd-e285-4348-a841-b7d838872637', -- Medium Jamaica
    '63a3c472-114a-42c4-a7db-ffde7e65415c', -- Medium Piña
    'c4d16122-8738-4e63-b884-b47d73eb9b2e'  -- Medium Tamarindo
  )
  AND (quantity IS DISTINCT FROM 14.0000 OR unit IS DISTINCT FROM 'oz');

-- C2. Aguas Frescas Large (32 oz -> 20.0000 oz líquido neto descontando hielo)
UPDATE public.recipes
SET quantity = 20.0000,
    unit = 'oz'
WHERE inventory_item_id IN (
    '085ecb0d-c711-4134-ae1a-f7630a22759c'::uuid, -- 001W Horchata
    'b6f3f5de-c554-4650-b0df-09dd5d3ca053'::uuid, -- 002W Tamarindo Concentrate
    '6051e960-7564-41f6-9a52-ff79ed7c6353'::uuid, -- 003W Jamaica Concentrate
    '9851a32c-dc35-4653-a1e4-b2cf7bac9009'::uuid  -- 004W Piña Concentrate
  )
  AND toast_menu_item_guid IN (
    '04c3493c-4f2c-4e95-b3ba-6872acaf2846', -- Large Horchata (primary)
    '717ae4d3-04a7-4a24-83f7-e89111102a1e', -- Large Horchata (alt)
    '5f551da6-2ccb-4521-91c7-c324c77a5422', -- Large Jamaica
    '5741485b-63af-419f-bd38-9ef2cc81d4fa', -- Large Piña
    '633da3c8-d8b7-41f9-be0f-222b7e0863d3'  -- Large Tamarindo
  )
  AND (quantity IS DISTINCT FROM 20.0000 OR unit IS DISTINCT FROM 'oz');

-- D1. 026W Queso Rayado (Jack Cheese) — Modificadores Taco / Mulita / Sope (1.0 oz -> 0.6000 oz)
UPDATE public.recipes
SET quantity = 0.6000,
    unit = 'oz'
WHERE inventory_item_id = '525a859d-9f16-477b-9a30-a56abeb4ec14'::uuid -- 026W Queso Rayado
  AND toast_menu_item_guid IN (
    'c37ede52-224f-432d-a5c8-97f65b6dfefc', -- Jack Cheese ([Mod] Taco Extras)
    '02397301-ca2b-44b1-b4b7-3e8a2c07403e', -- Extra Queso ([Mod] Mulita Extras)
    '163f17a7-401e-4ce6-9209-51beec00a779', -- Extra Queso ([Mod] S.Mulita Extras)
    '79e6ca59-6fc3-411a-b371-d200700a41b5', -- Jack Cheese ([Mod] Sope Add Ons)
    '6446aa8a-ed40-4243-8884-a6a7a7867866'  -- Jack Cheese ([Mod] Sope Add Ons)
  )
  AND (quantity IS DISTINCT FROM 0.6000 OR unit IS DISTINCT FROM 'oz');

-- D2. 026W Queso Rayado (Jack Cheese) — Modificadores Burrito / Plato / S.Quesadilla (4.0 oz -> 2.1000 oz)
UPDATE public.recipes
SET quantity = 2.1000,
    unit = 'oz'
WHERE inventory_item_id = '525a859d-9f16-477b-9a30-a56abeb4ec14'::uuid -- 026W Queso Rayado
  AND toast_menu_item_guid IN (
    'd84e275e-409c-4a17-a7fd-e5c1a439d584', -- Jack Cheese (primary Burrito/Nacho modifier)
    '27a8f0b4-c0d6-481b-ab16-7ceaa0a08c08', -- Jack Cheese ([Mod] Plato/Burrito Add Ons)
    '9433e2b2-1e0c-4119-98aa-5c6ca685bec3'  -- Extra Cheese 3 oz ([Mod] S.Quesadilla Extras)
  )
  AND (quantity IS DISTINCT FROM 2.1000 OR unit IS DISTINCT FROM 'oz');

-- D3. 026W Queso Rayado (Jack Cheese) — Modificadores Taco Plate Add Ons (3 tacos × 0.6 oz = 1.8000 oz)
UPDATE public.recipes
SET quantity = 1.8000,
    unit = 'oz'
WHERE inventory_item_id = '525a859d-9f16-477b-9a30-a56abeb4ec14'::uuid -- 026W Queso Rayado
  AND toast_menu_item_guid IN (
    '227b174e-8f13-400d-ae50-d23382bb5d91', -- Jack Cheese ([Mod] Taco Plate Add Ons)
    '62895f5b-b168-446a-9a67-4633b2713e72'  -- Jack Cheese ([Mod] Taco Plate Add Ons)
  )
  AND (quantity IS DISTINCT FROM 1.8000 OR unit IS DISTINCT FROM 'oz');

-- E. 029W Queso Fresco (Queso Tortas/platos/Desayuno) -> 1.0000 pza en TODAS las Tortas activas con receta
--    (Normaliza existentes y agrega de forma idempotente las 19 Tortas que aún no tenían la línea;
--     excluye Torta Tripa con recipe_na = true y nunca toca Platos regulares)
UPDATE public.recipes AS r
SET quantity = 1.0000,
    unit = 'pza',
    type = 'food'
FROM public.toast_menu_items AS m
WHERE r.toast_menu_item_guid = m.guid
  AND r.inventory_item_id = '34720160-015c-4623-bb1e-98da0e7b4e51'::uuid -- 029W Queso Fresco
  AND m.is_modifier = false
  AND m.active = true
  AND COALESCE(m.recipe_na, false) = false
  AND m.name ILIKE 'Torta%'
  AND (
    r.quantity IS DISTINCT FROM 1.0000
    OR r.unit IS DISTINCT FROM 'pza'
    OR COALESCE(r.type, 'food') IS DISTINCT FROM 'food'
  );

INSERT INTO public.recipes (toast_menu_item_guid, inventory_item_id, quantity, unit, type)
SELECT
  m.guid,
  '34720160-015c-4623-bb1e-98da0e7b4e51'::uuid, -- 029W Queso Tortas/platos/Desayuno
  1.0000,
  'pza',
  'food'
FROM public.toast_menu_items AS m
WHERE m.is_modifier = false
  AND m.active = true
  AND COALESCE(m.recipe_na, false) = false
  AND m.name ILIKE 'Torta%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.recipes AS existing
    WHERE existing.toast_menu_item_guid = m.guid
      AND existing.inventory_item_id = '34720160-015c-4623-bb1e-98da0e7b4e51'::uuid
      AND COALESCE(existing.type, 'food') = 'food'
  );

-- F. 043W Tortilla Regular 8 in (Harina) -> 2.0000 pza en modificadores Flour Tortilla y Harina
UPDATE public.recipes
SET quantity = 2.0000,
    unit = 'pza'
WHERE inventory_item_id = '1df90372-7648-4ec1-9a6c-fca4032095a6'::uuid -- 043W 358_9604BT Tortilla Regular 8 in
  AND toast_menu_item_guid IN (
    '53d8f1fc-40c0-4cd8-ada3-794a0a9b55e3', -- Flour Tortilla ([Mod] Tortillas)
    '3410e9f6-84a1-4400-8f09-92c00882812a'  -- Harina ([Mod] Tortilla Choice)
  )
  AND (quantity IS DISTINCT FROM 2.0000 OR unit IS DISTINCT FROM 'pza');
