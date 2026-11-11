-- Migration: Enable visible auto-calculated QuickBooks Daily Order mode ('auto_order_visible')
-- across all 15 active Tacos Gavilan stores.
-- Business rule: All 51 SKUs display system-calculated leftover and QB order upfront;
-- whenever an assistant or manager enters a physical leftover count, the physical count takes immediate precedence.

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_inventory_automation_mode_check;

ALTER TABLE public.stores
  ALTER COLUMN inventory_automation_mode SET DEFAULT 'auto_order_visible';

ALTER TABLE public.stores
  ADD CONSTRAINT stores_inventory_automation_mode_check
  CHECK (inventory_automation_mode IN ('off', 'shadow_blind', 'assisted_2tier', 'auto_order_visible'));

UPDATE public.stores
SET inventory_automation_mode = 'auto_order_visible'
WHERE external_id IS NOT NULL;
