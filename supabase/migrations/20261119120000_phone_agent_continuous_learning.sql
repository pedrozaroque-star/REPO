-- Migration: Contestadora IA (15 Sucursales) — Aprendizaje Continuo Diario, Pre-Calentamiento de Audio y Bandeja del Dueño
-- Fecha: 2026-11-19
-- Proyecto exclusivo: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Reglas:
--   * Sin columnas generadas (GENERATED ALWAYS AS).
--   * RLS estricto habilitado: acceso exclusivo vía supabaseAdmin (service_role).
--   * Soporta reglas globales para las 15 sucursales (store_id IS NULL) o por sucursal específica (store_id = bigint).

BEGIN;

ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_phone_calls_unanalyzed
  ON public.phone_calls (started_at DESC)
  WHERE analyzed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.phone_learning_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id bigint REFERENCES public.stores(id) ON DELETE SET NULL,
  source_call_id uuid REFERENCES public.phone_calls(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  source_type text NOT NULL DEFAULT 'cron_daily' CHECK (
    source_type IN ('cron_daily', 'auto_analysis', 'twilio_call', 'simulator_call', 'manual_owner')
  ),
  item_kind text NOT NULL CHECK (
    item_kind IN ('doubt_for_owner', 'learned_rule', 'fast_reply_macro', 'stt_synonym', 'audio_prewarm', 'latency_insight')
  ),
  status text NOT NULL CHECK (
    status IN ('needs_owner_input', 'auto_applied', 'approved', 'dismissed')
  ),
  category text NOT NULL DEFAULT 'general',
  question_or_trigger text NOT NULL,
  trigger_keywords text[] NOT NULL DEFAULT '{}',
  customer_quote text,
  kore_quote text,
  doubt_for_owner text,
  proposed_rule_es text,
  proposed_rule_en text,
  fast_reply_es text,
  fast_reply_en text,
  owner_instruction text,
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
  avg_latency_ms integer CHECK (avg_latency_ms IS NULL OR avg_latency_ms >= 0),
  audio_prewarmed boolean NOT NULL DEFAULT false,
  kb_entry_id uuid REFERENCES public.phone_knowledge_base(id) ON DELETE SET NULL,
  resolved_by text,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.phone_learning_items IS
  'Contestadora IA (15 Sucursales): hallazgos forenses de llamadas reales, dudas pendientes para el dueño, reglas aprendidas activas (<2ms fast-reply + system prompt) y audios WAV pre-calentados (~80ms).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_learning_items_dedupe_key
  ON public.phone_learning_items (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_phone_learning_items_status_store
  ON public.phone_learning_items (status, store_id);

CREATE INDEX IF NOT EXISTS idx_phone_learning_items_inbox
  ON public.phone_learning_items (status, evidence_count DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_learning_items_store_fk
  ON public.phone_learning_items (store_id)
  WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phone_learning_items_source_call_fk
  ON public.phone_learning_items (source_call_id)
  WHERE source_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_phone_learning_items_kb_entry_fk
  ON public.phone_learning_items (kb_entry_id)
  WHERE kb_entry_id IS NOT NULL;

ALTER TABLE public.phone_learning_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_learning_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.phone_learning_items TO service_role;

DROP POLICY IF EXISTS "Service role full access phone_learning_items" ON public.phone_learning_items;
CREATE POLICY "Service role full access phone_learning_items"
  ON public.phone_learning_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
