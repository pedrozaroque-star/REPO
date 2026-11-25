-- =====================================================================================
-- Migration: 20261124190500_calibrate_empirical_meat_cooking_yields.sql
-- Description:
--   Calibra los rendimientos reales de cocción y drenado de marinado/jugo (`yield_percent`)
--   de las 5 proteínas secundarias contra el benchmark empírico de Lynwood (#14) y las
--   15 sucursales de Tacos Gavilan, manteniendo intactos Carne Asada (61.50%),
--   Carnitas 6 oz (100.00%) y Buche 6 oz (100.00%):
--     - Pastor (5 lb con adobo líquido + plancha): 61.50% -> 53.00%
--     - Pollo (5 lb con marinado líquido + parrilla): 65.00% -> 57.50%
--     - Cabeza (2.5 lb con jugo/grasa al vapor): 87.00% -> 78.50%
--     - Lengua (2.5 lb con jugo en bolsa al vacío): 100.00% -> 92.50%
--     - Chorizo 8 oz (grasa fundida en plancha): 75.00% -> 67.00%
-- =====================================================================================

UPDATE public.inventory_items
SET yield_percent = CASE id
  WHEN 'ad7e3703-2701-4a05-aa97-77866c8c717e'::uuid THEN 53.00
  WHEN '4ea7ef9c-986e-4fc1-a363-7200ca558aab'::uuid THEN 57.50
  WHEN '511e341b-ca42-44ed-89df-a4a84b51a619'::uuid THEN 78.50
  WHEN '0fb87578-1185-41a9-a318-97428db20a5d'::uuid THEN 92.50
  WHEN '1e4c43b6-4e1b-4e51-8617-e127b89467f1'::uuid THEN 67.00
  ELSE yield_percent
END
WHERE id IN (
  'ad7e3703-2701-4a05-aa97-77866c8c717e'::uuid,
  '4ea7ef9c-986e-4fc1-a363-7200ca558aab'::uuid,
  '511e341b-ca42-44ed-89df-a4a84b51a619'::uuid,
  '0fb87578-1185-41a9-a318-97428db20a5d'::uuid,
  '1e4c43b6-4e1b-4e51-8617-e127b89467f1'::uuid
);
