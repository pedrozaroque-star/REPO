-- Migration: phone_kitchen_order_alerts
-- Purpose: Extend delivery_armor_phone_notes and phone_callback_requests to support 3 new real-time
--          kitchen & multi-store operational workflows from Phone AI (Kore):
--          1) Toast Online pickup time change (`pickup_time_change`)
--          2) Dual-store wrong-store transfer (`wrong_store_stop` at paid store + `wrong_store_prepare` at target store)
--          3) Fiesta Platter / Party Tray platform customization (`fiesta_platter_custom`) directly to PREPARADOR cooks

-- 1. Expand request_type CHECK constraint on delivery_armor_phone_notes
ALTER TABLE public.delivery_armor_phone_notes
  DROP CONSTRAINT IF EXISTS delivery_armor_phone_notes_request_type_check;

ALTER TABLE public.delivery_armor_phone_notes
  ADD CONSTRAINT delivery_armor_phone_notes_request_type_check
  CHECK (request_type IN (
    'condiments',
    'item_modification',
    'both',
    'pickup_time_change',
    'wrong_store_stop',
    'wrong_store_prepare',
    'fiesta_platter_custom'
  ));

-- 2. Add optional structured columns for pickup time changes, dual-store wrong-store transfers, and Fiesta Platters
ALTER TABLE public.delivery_armor_phone_notes
  ADD COLUMN IF NOT EXISTS origin_store_id integer REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_store_id integer REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_note_id uuid REFERENCES public.delivery_armor_phone_notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_pickup_time text,
  ADD COLUMN IF NOT EXISTS original_pickup_time text,
  ADD COLUMN IF NOT EXISTS platter_spec jsonb;

CREATE INDEX IF NOT EXISTS idx_da_phone_notes_store_type_active
  ON public.delivery_armor_phone_notes (store_id, request_type, created_at DESC)
  WHERE status IN ('pending', 'acknowledged');

-- 3. Allow 1 pending callback per (call_id, store_id) instead of only (call_id)
--    so wrong-store dual alerts can create 1 pending callback for Store A (DO NOT PREPARE)
--    AND 1 pending callback for Store B (PREPARE HERE) during the exact same phone call,
--    while preserving 100% single-store deduplication.
DROP INDEX IF EXISTS public.idx_phone_callbacks_one_pending_per_call;

CREATE UNIQUE INDEX idx_phone_callbacks_one_pending_per_call
  ON public.phone_callback_requests (call_id, store_id)
  WHERE status = 'pending' AND call_id IS NOT NULL;
