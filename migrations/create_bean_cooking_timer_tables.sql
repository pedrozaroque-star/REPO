-- Migración: Temporizador Digital TFS4 para Cocción de Frijoles de la Olla y Frijoles Enteros
-- Aplicada en Supabase producción vía MCP (create_bean_cooking_timer_tables)

CREATE TABLE IF NOT EXISTS public.bean_timer_presets (
  product_key TEXT PRIMARY KEY CHECK (product_key IN ('FRIJOLES_OLLA', 'FRIJOLES_ENTEROS')),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 10 AND duration_seconds <= 43200),
  sort_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.bean_timer_presets (product_key, duration_seconds, sort_order, is_active, updated_by)
VALUES
  ('FRIJOLES_OLLA', 660, 1, true, 'system_seed'),
  ('FRIJOLES_ENTEROS', 720, 2, true, 'system_seed')
ON CONFLICT (product_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bean_cooking_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  shift_period TEXT NOT NULL CHECK (shift_period IN ('AM', 'PM')),
  channel_id TEXT NOT NULL CHECK (channel_id IN ('T1', 'T2', 'T3', 'T4')),
  product_key TEXT NOT NULL CHECK (product_key IN ('FRIJOLES_OLLA', 'FRIJOLES_ENTEROS')),
  target_seconds INTEGER NOT NULL CHECK (target_seconds > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_end_at TIMESTAMPTZ NOT NULL,
  alarm_triggered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  overtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (overtime_seconds >= 0),
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'ALARMING', 'COMPLETED', 'CANCELLED')),
  started_by TEXT,
  completed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bean_cooking_logs_store_date
  ON public.bean_cooking_logs (store_id, business_date DESC, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bean_cooking_logs_active_channel
  ON public.bean_cooking_logs (store_id, channel_id)
  WHERE status IN ('RUNNING', 'ALARMING');

ALTER TABLE public.bean_timer_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bean_cooking_logs ENABLE ROW LEVEL SECURITY;
