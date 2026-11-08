-- ============================================================================
-- MIGRATION: Contestadora IA Multi-Sucursal (15 Tiendas) - Tacos Gavilan
-- Fecha: 2026-11-04
-- Tablas:
--   1. public.phone_agent_config
--   2. public.phone_knowledge_base
--   3. public.phone_special_hours
--   4. public.phone_calls
--   5. public.phone_callback_requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.phone_agent_config (
  store_id INTEGER PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  routing_mode TEXT NOT NULL DEFAULT 'conditional_forward',
  carrier_type TEXT NOT NULL DEFAULT 'att_wireless',
  twilio_phone_number TEXT,
  forwarding_status TEXT NOT NULL DEFAULT 'pending',
  forwarding_verified_at TIMESTAMPTZ,
  ring_timeout_seconds INTEGER NOT NULL DEFAULT 20,
  voice_id TEXT NOT NULL DEFAULT 'Kore',
  default_language TEXT NOT NULL DEFAULT 'es',
  custom_greeting_es TEXT,
  custom_greeting_en TEXT,
  manager_transfer_phone TEXT,
  allow_live_transfer BOOLEAN NOT NULL DEFAULT false,
  accepts_ebt BOOLEAN NOT NULL DEFAULT true,
  parking_notes_es TEXT,
  parking_notes_en TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS public.phone_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id INTEGER REFERENCES public.stores(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  question_keywords TEXT,
  answer_es TEXT NOT NULL,
  answer_en TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_kb_store_active
  ON public.phone_knowledge_base(store_id, is_active, priority DESC);

CREATE TABLE IF NOT EXISTS public.phone_special_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id INTEGER REFERENCES public.stores(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  holiday_name TEXT NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  open_time TEXT,
  close_time TEXT,
  notes_es TEXT,
  notes_en TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_special_hours_date
  ON public.phone_special_hours(event_date, store_id);

CREATE TABLE IF NOT EXISTS public.phone_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT UNIQUE NOT NULL,
  store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'twilio',
  caller_number TEXT,
  to_number TEXT,
  forwarded_from TEXT,
  language TEXT NOT NULL DEFAULT 'es',
  caller_category TEXT NOT NULL DEFAULT 'customer',
  primary_intent TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'in_progress',
  resolved_by_ai BOOLEAN NOT NULL DEFAULT true,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  turns_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  unanswered_question TEXT,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  business_date DATE NOT NULL,
  shift TEXT NOT NULL DEFAULT 'AM',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_store_bdate
  ON public.phone_calls(store_id, business_date DESC, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_calls_unanswered
  ON public.phone_calls(business_date DESC)
  WHERE unanswered_question IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.phone_callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES public.phone_calls(id) ON DELETE SET NULL,
  store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  caller_name TEXT NOT NULL,
  caller_phone TEXT NOT NULL,
  caller_type TEXT NOT NULL DEFAULT 'customer',
  urgency TEXT NOT NULL DEFAULT 'high',
  reason_category TEXT NOT NULL DEFAULT 'general',
  reason_summary TEXT NOT NULL,
  ticket_or_order_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_by TEXT,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  business_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_callbacks_store_status
  ON public.phone_callback_requests(store_id, status, created_at DESC);
