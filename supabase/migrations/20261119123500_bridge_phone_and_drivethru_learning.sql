-- =============================================================================
-- Migración: 20261119123500_bridge_phone_and_drivethru_learning.sql
-- Módulo: Puente Bidireccional Contestadora IA (/admin/llamadas) <-> Kore Drive-Thru (/drive-thru)
-- Descripción: Enlaza de forma bidireccional `public.phone_learning_items` y
--   `public.dt_kore_learning_items` mediante `applies_to_channels` ('both' | 'phone_only' | 'drive_thru_only'),
--   `synced_dt_item_id` y `synced_phone_item_id` + índices parciales de llaves foráneas.
-- Proyecto exclusivo: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)
-- Reglas:
--   * Sin columnas generadas (GENERATED ALWAYS AS).
--   * 100% idempotente (IF NOT EXISTS / to_regclass).
-- =============================================================================

BEGIN;

ALTER TABLE public.phone_learning_items
  ADD COLUMN IF NOT EXISTS applies_to_channels text NOT NULL DEFAULT 'both'
    CHECK (applies_to_channels IN ('both', 'phone_only', 'drive_thru_only'));

CREATE INDEX IF NOT EXISTS idx_phone_learning_items_channels_status
  ON public.phone_learning_items (applies_to_channels, status);

DO $$
BEGIN
  IF to_regclass('public.dt_kore_learning_items') IS NOT NULL THEN
    ALTER TABLE public.phone_learning_items
      ADD COLUMN IF NOT EXISTS synced_dt_item_id uuid
        REFERENCES public.dt_kore_learning_items(id) ON DELETE SET NULL;

    ALTER TABLE public.dt_kore_learning_items
      ADD COLUMN IF NOT EXISTS applies_to_channels text NOT NULL DEFAULT 'both'
        CHECK (applies_to_channels IN ('both', 'drive_thru_only', 'phone_only')),
      ADD COLUMN IF NOT EXISTS synced_phone_item_id uuid
        REFERENCES public.phone_learning_items(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_phone_learning_items_synced_dt
      ON public.phone_learning_items (synced_dt_item_id)
      WHERE synced_dt_item_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_dt_kore_learning_items_synced_phone
      ON public.dt_kore_learning_items (synced_phone_item_id)
      WHERE synced_phone_item_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_dt_kore_learning_items_channels_status
      ON public.dt_kore_learning_items (applies_to_channels, status);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
