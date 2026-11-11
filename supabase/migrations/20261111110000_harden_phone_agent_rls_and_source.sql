-- ============================================================================
-- MIGRATION: Blindaje Integral RLS, Origen de Recados e Integridad - Contestadora IA
-- Fecha: 2026-11-11
-- Descripción:
--   1. Elimina recados pendientes ficticios del simulador (323-555-0144 en sucursal #3).
--   2. Agrega columna `source` ('twilio' | 'simulator') a `phone_callback_requests` para
--      aislar pruebas del simulador de las alertas reales en `/order-ready-board`.
--   3. Normaliza llamadas huérfanas en `in_progress` y corrige `resolved_by_ai` en llamadas de 0 turnos.
--   4. Normaliza teléfonos de transferencia a formato E.164 (+1XXXXXXXXXX) y alinea regla KB con tienda cerrada.
--   5. Crea índice único `UNIQUE NULLS NOT DISTINCT (event_date, store_id)` en `phone_special_hours`.
--   6. Activa `ROW LEVEL SECURITY` (RLS) en las 5 tablas `phone_*`, revoca privilegios de `anon`
--      y retira tablas con PII de `supabase_realtime` público.
-- ============================================================================

-- 1. Limpieza de recados pendientes de prueba del simulador en West Covina (#3)
DELETE FROM public.phone_callback_requests
WHERE store_id = 3
  AND status = 'pending'
  AND caller_phone = '323-555-0144';

-- 2. Columna `source` en `phone_callback_requests` + backfill desde `phone_calls`
ALTER TABLE public.phone_callback_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'twilio';

UPDATE public.phone_callback_requests cb
SET source = c.source
FROM public.phone_calls c
WHERE cb.call_id = c.id
  AND c.source IS NOT NULL;

UPDATE public.phone_callback_requests
SET source = 'simulator'
WHERE caller_phone LIKE '%555-01%';

CREATE INDEX IF NOT EXISTS idx_phone_callbacks_source_store_status
  ON public.phone_callback_requests(source, store_id, status, created_at DESC);

-- 3. Cerrar llamadas antiguas atoradas en `in_progress` y corregir `resolved_by_ai` cuando `turns_count = 0`
ALTER TABLE public.phone_calls
  ALTER COLUMN resolved_by_ai SET DEFAULT false;

UPDATE public.phone_calls
SET
  status = CASE WHEN status = 'in_progress' THEN 'completed' ELSE status END,
  ended_at = COALESCE(ended_at, started_at + make_interval(secs => GREATEST(duration_seconds, 5))),
  resolved_by_ai = CASE WHEN turns_count = 0 THEN false ELSE resolved_by_ai END
WHERE (ended_at IS NULL AND started_at < now() - interval '15 minutes')
   OR (turns_count = 0 AND resolved_by_ai = true);

-- 4. Normalizar `manager_transfer_phone` de 10 dígitos a E.164 (+1XXXXXXXXXX)
UPDATE public.phone_agent_config
SET manager_transfer_phone = '+1' || regexp_replace(manager_transfer_phone, '\D', '', 'g')
WHERE manager_transfer_phone IS NOT NULL
  AND length(regexp_replace(manager_transfer_phone, '\D', '', 'g')) = 10;

-- 5. Alinear regla de Base de Conocimiento con horario abierto vs cerrado
UPDATE public.phone_knowledge_base
SET
  answer_es = 'Si tuviste un inconveniente con tu orden o dejaste un objeto olvidado en la sucursal, tomo tus datos (nombre, teléfono, número de ticket o detalle). Si la sucursal está abierta, envío una alerta prioritaria en vivo a la pantalla del Gerente en turno; si ya está cerrada, queda registrado como recado prioritario para que el Gerente se comunique contigo en cuanto abramos.',
  answer_en = 'If you had an issue with your order or left an item behind at the restaurant, I can take your details (name, phone number, ticket number, or description). When the location is open, I send an immediate live alert to the Manager on duty screen; if we are currently closed, it is logged as a priority callback so the Manager reaches out as soon as we reopen.',
  updated_at = now()
WHERE id = '99e80599-6854-4ba5-8be5-caf30ecfeeb4';

-- 6. Evitar duplicados en `phone_special_hours` por concurrencia
DELETE FROM public.phone_special_hours a
USING public.phone_special_hours b
WHERE a.ctid < b.ctid
  AND a.event_date = b.event_date
  AND a.store_id IS NOT DISTINCT FROM b.store_id;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_phone_special_hours_date_store
  ON public.phone_special_hours (event_date, store_id) NULLS NOT DISTINCT;

-- 7. Seguridad: Retirar PII de `supabase_realtime` público y activar RLS estricto en las 5 tablas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'phone_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.phone_calls;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'phone_callback_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.phone_callback_requests;
  END IF;
END $$;

ALTER TABLE public.phone_agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_special_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phone_agent_config FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.phone_knowledge_base FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.phone_special_hours FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.phone_calls FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.phone_callback_requests FROM anon, authenticated, PUBLIC;

GRANT ALL ON TABLE public.phone_agent_config TO service_role;
GRANT ALL ON TABLE public.phone_knowledge_base TO service_role;
GRANT ALL ON TABLE public.phone_special_hours TO service_role;
GRANT ALL ON TABLE public.phone_calls TO service_role;
GRANT ALL ON TABLE public.phone_callback_requests TO service_role;
