-- =============================================================================
-- Migración: 20261119201500_dt_kore_bidirectional_phone_sync.sql
-- Módulo: Kore Drive-Thru <-> Contestadora IA Telefónica (/admin/llamadas)
-- Descripción: Sincronización bidireccional 100% en tiempo real entre
--   `public.dt_kore_learning_items` y `public.phone_knowledge_base` +
--   análisis forense idempotente de `public.phone_calls` (`kore_analyzed_at`).
-- Proyecto Supabase: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- =============================================================================

ALTER TABLE public.dt_kore_learning_items
  ADD COLUMN IF NOT EXISTS applies_to_channels text NOT NULL DEFAULT 'both'
    CHECK (applies_to_channels IN ('both', 'drive_thru_only', 'phone_only')),
  ADD COLUMN IF NOT EXISTS synced_kb_id uuid
    REFERENCES public.phone_knowledge_base(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_phone_call_id uuid
    REFERENCES public.phone_calls(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dt_kore_learning_synced_kb
  ON public.dt_kore_learning_items (synced_kb_id)
  WHERE synced_kb_id IS NOT NULL;

ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS kore_analyzed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_phone_calls_kore_unanalyzed
  ON public.phone_calls (started_at DESC)
  WHERE kore_analyzed_at IS NULL;
