-- Tickets individuales de Toast para consumo por orden (empaques, separadores y modificadores).
-- PMIX sigue siendo el agregado financiero; esta tabla conserva únicamente el contexto operativo.
CREATE TABLE IF NOT EXISTS public.toast_ticket_consumption_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  toast_order_guid TEXT NOT NULL,
  dining_option_name TEXT,
  selections JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_opened_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT toast_ticket_consumption_snapshots_unique UNIQUE (store_id, toast_order_guid)
);

CREATE INDEX IF NOT EXISTS idx_toast_ticket_consumption_snapshots_store_date
  ON public.toast_ticket_consumption_snapshots (store_id, business_date);

ALTER TABLE public.toast_ticket_consumption_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read Toast ticket consumption snapshots"
  ON public.toast_ticket_consumption_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role manages Toast ticket consumption snapshots"
  ON public.toast_ticket_consumption_snapshots FOR ALL
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.toast_ticket_consumption_snapshots IS
  'Contexto operativo crudo por ticket Toast: canal, selecciones y modificadores. Se usa para empaques por ticket y nunca sustituye PMIX financiero.';
