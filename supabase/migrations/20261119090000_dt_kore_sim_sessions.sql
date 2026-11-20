-- Migration: Kore Drive-Thru — bitácora de simulaciones de voz (Gemini Live API) por sucursal
-- Fecha: 2026-11-19
-- Módulo: app/drive-thru (tab "Kore IA") -> POST/GET /api/drive-thru/kore/sessions
-- Reglas:
--   * Solo simulación: NADA se envía a Toast. Cada fila es una prueba terminada (confirmed | cancelled | abandoned).
--   * Totales en centavos enteros USD recalculados en el servidor con lib/drive-thru-kore-order.ts (computeKoreTotals).
--   * Sin columnas generadas: el backend envía valores atómicos; los CHECK garantizan consistencia (total = subtotal + tax).
--   * La columna de la orden se llama order_json (ORDER es palabra reservada en SQL/PostgREST).
--   * RLS activo: solo service_role (las rutas API autentican con authorizePhoneModuleRequest y usan supabaseAdmin).

BEGIN;

CREATE TABLE IF NOT EXISTS public.dt_kore_sim_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_sec integer NOT NULL CHECK (duration_sec >= 0 AND duration_sec <= 86400),
  lang text NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transcript) = 'array'),
  order_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(order_json) = 'object'),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  tax_rate_pct numeric(6, 3) CHECK (tax_rate_pct IS NULL OR (tax_rate_pct >= 0 AND tax_rate_pct <= 20)),
  tax_is_estimate boolean NOT NULL DEFAULT true,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'cancelled', 'abandoned')),
  model text,
  created_by bigint,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dt_kore_sim_sessions_time_order CHECK (ended_at >= started_at),
  CONSTRAINT dt_kore_sim_sessions_total_sum CHECK (total_cents = subtotal_cents + tax_cents)
);

COMMENT ON TABLE public.dt_kore_sim_sessions IS
  'Kore Drive-Thru: simulaciones de toma de orden por voz (Gemini Live). Solo prueba, nunca se envía a Toast.';

CREATE INDEX IF NOT EXISTS idx_dt_kore_sim_sessions_store_created
  ON public.dt_kore_sim_sessions (store_id, created_at DESC);

ALTER TABLE public.dt_kore_sim_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dt_kore_sim_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dt_kore_sim_sessions TO service_role;

DROP POLICY IF EXISTS "Service role full access dt_kore_sim_sessions" ON public.dt_kore_sim_sessions;
CREATE POLICY "Service role full access dt_kore_sim_sessions"
  ON public.dt_kore_sim_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
