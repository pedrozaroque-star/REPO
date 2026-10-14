-- =============================================================================
-- Migration: 202610140001_app_menu_cache_sort_order.sql
-- Description: Agrega columnas de ordenamiento determinista (category_sort_order
--              e item_sort_order) a public.app_menu_cache para preservar el
--              orden exacto de categorías y productos de Toast Online Ordering.
-- =============================================================================

ALTER TABLE public.app_menu_cache
  ADD COLUMN IF NOT EXISTS category_sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_app_menu_cache_store_sort
  ON public.app_menu_cache (store_id, is_available, category_sort_order, item_sort_order);
