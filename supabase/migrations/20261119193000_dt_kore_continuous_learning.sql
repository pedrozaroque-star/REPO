-- Migration: Kore Drive-Thru Fase 2 — Telemetría de Latencia, Recolección Multi-Orden de Repartidores y Aprendizaje Continuo
-- Fecha: 2026-11-19
-- Proyecto exclusivo: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Reglas:
--   * Sin columnas generadas (GENERATED ALWAYS AS).
--   * RLS estricto: acceso exclusivo para service_role.
--   * Soporta reglas por sucursal (store_id = bigint) o globales para todas las sucursales Drive-Thru (store_id IS NULL).

BEGIN;

ALTER TABLE public.dt_kore_sim_sessions
  ADD COLUMN IF NOT EXISTS avg_latency_ms integer CHECK (avg_latency_ms IS NULL OR (avg_latency_ms >= 0 AND avg_latency_ms <= 120000)),
  ADD COLUMN IF NOT EXISTS p95_latency_ms integer CHECK (p95_latency_ms IS NULL OR (p95_latency_ms >= 0 AND p95_latency_ms <= 120000)),
  ADD COLUMN IF NOT EXISTS barge_in_count integer NOT NULL DEFAULT 0 CHECK (barge_in_count >= 0 AND barge_in_count <= 1000),
  ADD COLUMN IF NOT EXISTS session_kind text NOT NULL DEFAULT 'customer_order' CHECK (session_kind IN ('customer_order', 'driver_pickup')),
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_dt_kore_sim_sessions_unanalyzed
  ON public.dt_kore_sim_sessions (created_at DESC)
  WHERE analyzed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.dt_kore_learning_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id bigint REFERENCES public.stores(id) ON DELETE CASCADE,
  source_session_id uuid REFERENCES public.dt_kore_sim_sessions(id) ON DELETE SET NULL,
  dedupe_key text,
  source_type text NOT NULL DEFAULT 'auto_analysis' CHECK (source_type IN ('auto_analysis', 'cron_daily', 'manual_owner', 'dt_simulation', 'phone_call', 'manual', 'cron_audit')),
  item_kind text NOT NULL CHECK (item_kind IN ('doubt_for_owner', 'learned_rule', 'synonym_fix', 'latency_insight')),
  status text NOT NULL CHECK (status IN ('needs_owner_input', 'auto_applied', 'approved', 'dismissed')),
  question_or_trigger text NOT NULL,
  customer_quote text,
  kore_quote text,
  proposed_rule_es text,
  proposed_rule_en text,
  owner_instruction text,
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
  avg_latency_ms integer CHECK (avg_latency_ms IS NULL OR avg_latency_ms >= 0),
  resolved_by bigint,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dt_kore_learning_items IS
  'Kore Drive-Thru: hallazgos automáticos de simulaciones, dudas pendientes de criterio del dueño y reglas aprendidas inyectadas en vivo al system prompt.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_dt_kore_learning_items_dedupe_key
  ON public.dt_kore_learning_items (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dt_kore_learning_items_status_store
  ON public.dt_kore_learning_items (status, store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dt_kore_learning_items_source_session
  ON public.dt_kore_learning_items (source_session_id)
  WHERE source_session_id IS NOT NULL;

ALTER TABLE public.dt_kore_learning_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dt_kore_learning_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dt_kore_learning_items TO service_role;

DROP POLICY IF EXISTS "Service role full access dt_kore_learning_items" ON public.dt_kore_learning_items;
CREATE POLICY "Service role full access dt_kore_learning_items"
  ON public.dt_kore_learning_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
