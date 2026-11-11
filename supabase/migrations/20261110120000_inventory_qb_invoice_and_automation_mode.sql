-- Migration: Add QuickBooks Invoice reconciliation metadata on inventory_orders
-- and per-store 2-tier inventory automation mode on stores.
-- Default pilot stores (Slauson #7 and Lynwood #14) remain in 'shadow_blind'
-- until explicitly switched to 'assisted_2tier' by Admin / Roque / Carlos.

ALTER TABLE public.inventory_orders
  ADD COLUMN IF NOT EXISTS qb_invoice_id text,
  ADD COLUMN IF NOT EXISTS qb_invoice_number text,
  ADD COLUMN IF NOT EXISTS qb_invoiced_at timestamptz;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS inventory_automation_mode text NOT NULL DEFAULT 'off';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_inventory_automation_mode_check'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_inventory_automation_mode_check
      CHECK (inventory_automation_mode IN ('off', 'shadow_blind', 'assisted_2tier'));
  END IF;
END $$;

UPDATE public.stores
SET inventory_automation_mode = 'shadow_blind'
WHERE id IN (7, 14)
  AND inventory_automation_mode = 'off';
