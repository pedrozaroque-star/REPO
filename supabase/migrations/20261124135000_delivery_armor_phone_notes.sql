-- Migration: delivery_armor_phone_notes
-- Purpose: Real-time customer condiment & no-cost item modification alerts from Phone AI (Kore)
--          linked directly to active DoorDash / Uber Eats / Grubhub / Toast Online orders
--          on the Delivery Armor packing tablet (flashing order alert + sound + cashier apply workflow).

CREATE TABLE IF NOT EXISTS public.delivery_armor_phone_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id integer NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  source text NOT NULL DEFAULT 'twilio'
    CHECK (source IN ('twilio', 'simulator', 'manual')),
  call_id uuid REFERENCES public.phone_calls(id) ON DELETE SET NULL,
  callback_id uuid REFERENCES public.phone_callback_requests(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'MATCHED'
    CHECK (match_status IN ('MATCHED', 'UNMATCHED', 'ALREADY_DELIVERED')),
  toast_order_guid text,
  toast_display_number text,
  platform text NOT NULL DEFAULT 'OTHER'
    CHECK (platform IN ('DOORDASH', 'UBER_EATS', 'GRUBHUB', 'TOAST_ONLINE', 'TAKEOUT', 'OTHER')),
  platform_order_key text,
  short_order_key text,
  order_customer_name text,
  order_stage_at_alert text,
  caller_name text NOT NULL,
  caller_phone text,
  request_type text NOT NULL DEFAULT 'condiments'
    CHECK (request_type IN ('condiments', 'item_modification', 'both')),
  note_summary_es text NOT NULL,
  note_summary_en text,
  requested_condiments jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_modifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  ordered_items_hint text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged', 'applied', 'dismissed')),
  acknowledged_by_name text,
  acknowledged_by_pin text,
  acknowledged_at timestamptz,
  applied_by_name text,
  applied_by_pin text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.delivery_armor_phone_notes IS
  'Alertas en vivo desde la Contestadora IA (Kore) hacia la tableta Delivery Armor para agregar condimentos gratuitos o modificaciones sin costo en ordenes DoorDash/Uber Eats/Grubhub/Online.';

CREATE INDEX IF NOT EXISTS idx_da_phone_notes_store_active
  ON public.delivery_armor_phone_notes (store_id, business_date, created_at DESC)
  WHERE status IN ('pending', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_da_phone_notes_store_recent
  ON public.delivery_armor_phone_notes (store_id, business_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_da_phone_notes_order_guid
  ON public.delivery_armor_phone_notes (store_id, toast_order_guid)
  WHERE toast_order_guid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_da_phone_notes_call_pending
  ON public.delivery_armor_phone_notes (call_id, created_at DESC)
  WHERE call_id IS NOT NULL AND status IN ('pending', 'acknowledged');

-- Strict RLS: service_role only (zero PII exposure to anon/authenticated clients)
ALTER TABLE public.delivery_armor_phone_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.delivery_armor_phone_notes FROM anon, authenticated;

DROP POLICY IF EXISTS service_role_all_delivery_armor_phone_notes ON public.delivery_armor_phone_notes;
CREATE POLICY service_role_all_delivery_armor_phone_notes
  ON public.delivery_armor_phone_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
