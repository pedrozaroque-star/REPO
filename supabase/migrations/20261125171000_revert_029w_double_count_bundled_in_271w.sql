-- =====================================================================================
-- Migration: 20261125171000_revert_029w_double_count_bundled_in_271w.sql
-- Description:
--   Revierte ÚNICAMENTE la inserción de las 19 filas de 029W Queso Fresco
--   (Queso Tortas/platos/Desayuno, 34720160-015c-4623-bb1e-98da0e7b4e51) en las
--   Tortas regulares introducida en 20261125161500.
--
--   Motivo financiero / QBO verificado en vivo (Francisco Foods -> Kitchen-TEG ->
--   Cocina -> 15 sucursales):
--     - Aunque La Bodega empaca físicamente el Queso Fresco aparte del papel encerado
--       para no remojarlo, en QBO sigue facturando el 95.5% del Queso Fresco incluido
--       1:1 dentro de 271W Papelito Para Torta ($0.48 costo Cocina / $0.58 factura tienda).
--     - 029W ($3.28 / paquete de 20 pzas) representa únicamente ~4.5% de pedidos extra /
--       refuerzo (164 paquetes / 30d).
--     - Mantener 1 pza de 029W en las 19 Tortas regulares duplicaba ~$7,900/mes en Food
--       Cost teórico y creaba una varianza falsa de -92% (-$7,206/14d) en TVF.
--
--   FILAS DE 029W QUE PERMANECEN 100% INTACTAS (preexistentes desde 2026-02-13):
--     - Torta Queso                   (b4156466-f837-4a08-9547-5c4427010dc7)
--     - Sope Queso                    (776901c9-f2a6-4f77-8c4b-1f8911d7ccf3)
--     - Side Order Queso Fresco       (f3a10b37-d73d-4aa2-88c9-aa00a094086d)
--     - Extra Queso Fresco (In Store) (819876d8-aaa8-4848-83f3-54d079bbb90d)
--
--   CALIBRACIONES 20261125161500 INTACTAS (NO SE TOCAN):
--     - Burrito Beans/Cheese = 8.0 oz Frijol Molido (022W)
--     - Super Nachos = 5.0 oz Amarillo Cheese (045W)
--     - Aguas Frescas (001W–004W) = 14 oz Medium / 20 oz Large
--     - Queso Rayado (026W) modificadores = 0.6 oz / 2.1 oz / 1.8 oz
--     - Tortilla Harina 8" (043W) modificadores = 2.0 pza
--
--   100% idempotente: primera ejecución elimina 19 filas (1,020 -> 1,001);
--   ejecuciones subsecuentes eliminan 0 filas (permanece en 1,001).
-- =====================================================================================

DELETE FROM public.recipes
WHERE inventory_item_id = '34720160-015c-4623-bb1e-98da0e7b4e51'::uuid -- 029W Queso Tortas/platos/Desayuno
  AND toast_menu_item_guid <> 'b4156466-f837-4a08-9547-5c4427010dc7'   -- Guard explícito: conservar Torta Queso
  AND toast_menu_item_guid IN (
    '51ee8f16-2912-427d-8d79-834424ef841e', -- Torta Asada
    '7bea2551-2c99-45a8-8a0a-10c9ec18a331', -- Torta Buche
    '206a615f-422f-4783-a571-9ef35db0f54e', -- Torta Cabeza
    '3dd7d3b5-97fa-41e1-ae16-e4e9608194c8', -- Torta Carnitas
    'edbfab34-21ea-4f22-8b23-d4bdc0c3ebf9', -- Torta Chorizo
    '8bac2d2c-9ef7-45a4-8223-3419be7f28f9', -- Torta Cubana
    '0159ee8f-8c50-4263-a253-13db2013d069', -- Torta de Huevo
    'fada64bc-7bf0-43a1-b245-3c57ff50a240', -- Torta de Huevo/Asada
    '4e3f7e0c-ac55-44ea-a3be-4d8849ab1ff9', -- Torta Huevos con Asada
    'a0e3e9c6-eec2-40b7-b661-d775944f4e2d', -- Torta Huevos con Chorizo
    '9cf92eed-446d-4b79-844a-a797c751d55c', -- Torta Huevos con Jamon (GUID 1)
    'f537638e-f8b9-45d6-94e0-f47a6228a7e4', -- Torta Huevos con Jamon (GUID 2)
    'c67941e9-2a6b-4133-ad1e-3e51b951daab', -- Torta Jamon
    '7c947000-df49-4bd5-be81-94dc6a93a1b4', -- Torta Lengua
    'd00fa5ce-281d-4c14-9dd2-cc97a784478a', -- Torta Milanesa
    '8d687908-3279-4da8-aca0-c4919e62a3eb', -- Torta Pastor
    'f5e74167-8f0f-4171-824e-5fa198bb5f95', -- Torta Pollo
    '6b60fcd4-2dd7-469f-98a3-82068dc650c7', -- Torta Salchicha
    'a1e7c9fa-0718-4b6e-b0b3-076be91d12d0'  -- Torta Vegetariana
  );
