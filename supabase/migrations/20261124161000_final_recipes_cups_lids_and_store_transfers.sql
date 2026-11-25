-- =====================================================================================
-- Migration: 20261124161000_final_recipes_cups_lids_and_store_transfers.sql
-- Description:
--   1. Burritos (`Burrito`, `Super Burrito`, `Burrito Huevos`): `Arroz` = `4.0000 oz` en peso
--      (cuchara volumétrica de 6 fl oz de arroz esponjado = 4.0 oz reales en báscula).
--   2. Platos regulares (`Plato Pastor/Pollo/Lengua/Chorizo/Buche/Milanesa/Jamon`): unificados
--      a `2.0000 oz` de `Bolsa Aguacate` igual que `Plato Asada/Cabeza/Carnitas` (`Taco Plate` = 0 oz).
--   3. `Huevos Rancheros`: `Salsa Huevos Rancheros` = `4.0000 oz` + vaso `EL4OZ` en los 3 canales
--      + tapa `EL4LID` únicamente en `cogs_takeout` (ToGo/DT) y `cogs_delivery`.
--   4. `Side Rice` (`6.0 oz` Arroz) y `Side Beans` (`8.0 oz` Frijol Molido): unificados con vaso `EL8OZ`
--      en los 3 canales + tapa `EL8LID` únicamente en `cogs_takeout` y `cogs_delivery`;
--      `Beans` de la olla (`4.0 oz` Frijol Entero) con vaso `EL4OZ` + tapa `EL4LID` en takeout/delivery.
--   5. Elimina tapas (`EL4LID` y `EL8LID`) de `cogs_dine_in` en todos los platillos/modificadores
--      (en comedor no llevan tapa; solo llevan tapa en DT, ToGo y Delivery).
--   6. Crea la tabla oficial `public.inventory_store_transfers` (Traspasos/Préstamos de bolsas
--      entre sucursales) con RLS e índices para ajustar automáticamente los Sobrantes y la Orden Diaria.
-- =====================================================================================

-- 1. Arroz en todos los Burritos -> 4.0000 oz en peso
UPDATE public.recipes r
SET quantity = 4.0000
FROM public.toast_menu_items tmi
WHERE tmi.guid = r.toast_menu_item_guid
  AND r.inventory_item_id = 'a1bbc13a-a481-4b7f-a5c6-8a44a96ad562' -- Arroz
  AND tmi.name ILIKE '%burrito%'
  AND r.quantity = 6.0000;

-- 2. Unificar todos los Platos regulares a 2.0000 oz de Bolsa Aguacate (excluyendo Taco Plate)
UPDATE public.recipes r
SET quantity = 2.0000
FROM public.toast_menu_items tmi
WHERE tmi.guid = r.toast_menu_item_guid
  AND r.inventory_item_id = '0289794f-e7e1-4a65-9492-56ca6b6767e9' -- Bolsa Aguacate
  AND tmi.name ILIKE 'Plato %'
  AND tmi.name NOT ILIKE '%taco plate%'
  AND r.quantity = 1.0000;

-- 3. Huevos Rancheros -> 4.0000 oz exactas de Salsa Huevos Rancheros
UPDATE public.recipes
SET quantity = 4.0000
WHERE toast_menu_item_guid = '4546e8ab-5ce8-496e-b643-ef52f4edebd1'
  AND inventory_item_id = '202c48b0-f9f9-4304-87a5-07d5e970f0cf';

-- 4. Side Beans (Frijol Molido) -> 8.0000 oz exactas (Side Rice permanece en 6.0000 oz)
UPDATE public.recipes
SET quantity = 8.0000
WHERE toast_menu_item_guid = 'a41acfa9-e4dc-4471-88d7-9250017c286a'
  AND inventory_item_id = '557d9414-c769-4399-a6cc-15bb81cba85f';

-- 5a. Quitar tapas de 4 oz y 8 oz cuando es Comedor (`cogs_dine_in`)
DELETE FROM public.recipes
WHERE type = 'cogs_dine_in'
  AND inventory_item_id IN (
    'c46553c8-99ed-4864-a83b-0c46a8ba736a', -- EL4LID (Flat Lid 4 oz)
    'ca483e81-2b40-469e-8264-c232efe2a3db'  -- EL8LID (Flat Lid 8 oz)
  );

-- 5b. Asegurar vaso EL4OZ (3 canales) + tapa EL4LID (solo takeout/delivery) en Huevos Rancheros y Frijoles de la Olla (2a9dd8f4...)
INSERT INTO public.recipes (toast_menu_item_guid, inventory_item_id, quantity, unit, type)
SELECT v.guid, v.inv_id, 1.0000, 'pza', v.ch_type
FROM (
  VALUES
    -- Huevos Rancheros (vasito 4 oz salsa ranchera)
    ('4546e8ab-5ce8-496e-b643-ef52f4edebd1', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_dine_in'),
    ('4546e8ab-5ce8-496e-b643-ef52f4edebd1', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_takeout'),
    ('4546e8ab-5ce8-496e-b643-ef52f4edebd1', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_delivery'),
    ('4546e8ab-5ce8-496e-b643-ef52f4edebd1', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_takeout'),
    ('4546e8ab-5ce8-496e-b643-ef52f4edebd1', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_delivery'),
    -- Beans (Frijol Entero de la olla 4 oz)
    ('2a9dd8f4-3365-4f87-abf1-e8eb39296f98', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_dine_in'),
    ('2a9dd8f4-3365-4f87-abf1-e8eb39296f98', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_takeout'),
    ('2a9dd8f4-3365-4f87-abf1-e8eb39296f98', '6b81f73c-dd80-4376-8e05-fd44138ca0f6', 'cogs_delivery'),
    ('2a9dd8f4-3365-4f87-abf1-e8eb39296f98', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_takeout'),
    ('2a9dd8f4-3365-4f87-abf1-e8eb39296f98', 'c46553c8-99ed-4864-a83b-0c46a8ba736a', 'cogs_delivery'),
    -- Side Rice (vaso 8 oz + tapa 8 oz en takeout/delivery)
    ('0c31b57e-7897-4d8f-a864-73488087d602', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_dine_in'),
    ('0c31b57e-7897-4d8f-a864-73488087d602', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_takeout'),
    ('0c31b57e-7897-4d8f-a864-73488087d602', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_delivery'),
    ('0c31b57e-7897-4d8f-a864-73488087d602', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_takeout'),
    ('0c31b57e-7897-4d8f-a864-73488087d602', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_delivery'),
    -- Side Beans Frijol Molido (vaso 8 oz + tapa 8 oz en takeout/delivery)
    ('a41acfa9-e4dc-4471-88d7-9250017c286a', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_dine_in'),
    ('a41acfa9-e4dc-4471-88d7-9250017c286a', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_takeout'),
    ('a41acfa9-e4dc-4471-88d7-9250017c286a', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_delivery'),
    ('a41acfa9-e4dc-4471-88d7-9250017c286a', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_takeout'),
    ('a41acfa9-e4dc-4471-88d7-9250017c286a', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_delivery'),
    -- Side Order Nacho Cheese (vaso 8 oz + tapa 8 oz en takeout/delivery)
    ('134cefe3-096c-45d8-b3dc-306dff335b4d', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_dine_in'),
    ('134cefe3-096c-45d8-b3dc-306dff335b4d', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_takeout'),
    ('134cefe3-096c-45d8-b3dc-306dff335b4d', '10daaedf-6969-4326-ae10-4c4f69dd0260', 'cogs_delivery'),
    ('134cefe3-096c-45d8-b3dc-306dff335b4d', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_takeout'),
    ('134cefe3-096c-45d8-b3dc-306dff335b4d', 'ca483e81-2b40-469e-8264-c232efe2a3db', 'cogs_delivery')
) AS v(guid, inv_id, ch_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.recipes r
  WHERE r.toast_menu_item_guid = v.guid
    AND r.inventory_item_id = v.inv_id::uuid
    AND r.type = v.ch_type
);

-- 6. Tabla oficial de Traspasos / Préstamos de Bolsas entre Sucursales
CREATE TABLE IF NOT EXISTS public.inventory_store_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_date date NOT NULL,
  from_store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  to_store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  notes text,
  created_by_user_id bigint,
  created_by_name text,
  confirmed_by_user_id bigint,
  confirmed_by_name text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_distinct_stores CHECK (from_store_id <> to_store_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_store_transfers_date_status
  ON public.inventory_store_transfers (transfer_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_inv_store_transfers_from_store
  ON public.inventory_store_transfers (from_store_id, transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_inv_store_transfers_to_store
  ON public.inventory_store_transfers (to_store_id, transfer_date DESC);

ALTER TABLE public.inventory_store_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_inv_store_transfers ON public.inventory_store_transfers;
CREATE POLICY service_role_all_inv_store_transfers
  ON public.inventory_store_transfers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS teg_staff_select_inv_store_transfers ON public.inventory_store_transfers;
CREATE POLICY teg_staff_select_inv_store_transfers
  ON public.inventory_store_transfers
  FOR SELECT
  TO authenticated
  USING (public.is_teg_staff());
