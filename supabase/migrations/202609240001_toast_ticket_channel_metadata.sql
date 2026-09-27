-- Contexto completo de canal para clasificar Delivery / Drive Thru / To Go sin adivinar por "API".
ALTER TABLE public.toast_ticket_consumption_snapshots
  ADD COLUMN IF NOT EXISTS channel_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.toast_ticket_consumption_snapshots.channel_metadata IS
  'Metadatos operativos de Toast por ticket (dining option, source y delivery service). Se usan solo para resolver canal y empaque.';
