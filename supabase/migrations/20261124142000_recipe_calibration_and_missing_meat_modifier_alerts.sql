-- =====================================================================================
-- Migration: 20261124142000_recipe_calibration_and_missing_meat_modifier_alerts.sql
-- Description:
--   1. Unifica Burrito Huevos con Chorizo y Huevos con Chorizo a 3.0 oz cocidas (4.0 oz crudas = media bolsita de 8 oz).
--   2. Corrige quantity_per_unit de Amarillo Cheese de 560 -> 440 oz en inventory_items e inventory_price_history.
--   3. Corrige el error de captura de 11,211,120 bolsas de Bolsa Crema en #14 Lynwood (2026-08-14) a 41.00.
--   4. Crea tabla de auditoría e idempotencia `public.missing_meat_modifier_alerts` para el cron diario
--      que notifica órdenes de Side Order Carne y 2/6/12 lb Meat cobradas sin especificar proteína.
-- =====================================================================================

-- 1. Desayunos con Chorizo -> 3.0 oz cocidas (con yield 75% = 4.0 oz crudas = 1/2 bolsa de 8 oz)
UPDATE public.recipes
SET quantity = 3.0000
WHERE inventory_item_id = '1e4c43b6-4e1b-4e51-8617-e127b89467f1'
  AND toast_menu_item_guid IN (
    'a3a43c21-cffe-4cbe-81d4-7afda41b724d', -- Burrito Huevos con Chorizo
    '4712873a-4981-40ca-a929-33f60645bd69'  -- Huevos con Chorizo
  )
  AND quantity = 4.0000;

-- 2. Amarillo Cheese -> caja real de 440 oz (4 bolsas x 110 oz)
UPDATE public.inventory_items
SET quantity_per_unit = 440
WHERE id = '62968b74-7877-4650-aa43-4ec6e9eb1888'
  AND quantity_per_unit = 560;

UPDATE public.inventory_price_history
SET quantity_per_unit = 440
WHERE inventory_item_id = '62968b74-7877-4650-aa43-4ec6e9eb1888'
  AND quantity_per_unit = 560;

-- 3. Bolsa Crema (#14 Lynwood, 2026-08-14) -> restaurar calculated_qty = 41.00
UPDATE public.inventory_order_lines
SET adjusted_qty = NULL,
    final_qty = 41.00
WHERE id = '2cd62260-f27d-4889-b62c-b554c24a2f8a'
  AND final_qty > 1000000;

-- 4. Tabla de auditoría e idempotencia para alertas diarias a Cajeras y Escalera de Mando AM/PM
CREATE TABLE IF NOT EXISTS public.missing_meat_modifier_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date NOT NULL,
  store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  shift text NOT NULL CHECK (shift IN ('AM', 'PM')),
  orders_count integer NOT NULL DEFAULT 0,
  items_count numeric(10,2) NOT NULL DEFAULT 0,
  orders_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  manager_email text,
  supervisor_email text,
  assistant_emails text[] NOT NULL DEFAULT '{}'::text[],
  cashier_emails text[] NOT NULL DEFAULT '{}'::text[],
  cashier_names text[] NOT NULL DEFAULT '{}'::text[],
  preview_email_sent_at timestamptz,
  live_email_sent_at timestamptz,
  last_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_missing_meat_mod_date_store_shift UNIQUE (business_date, store_id, shift)
);

CREATE INDEX IF NOT EXISTS idx_missing_meat_mod_date_store
  ON public.missing_meat_modifier_alerts (business_date DESC, store_id);

ALTER TABLE public.missing_meat_modifier_alerts ENABLE ROW LEVEL SECURITY;
