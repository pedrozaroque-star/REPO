-- ═══════════════════════════════════════════════════════════
-- Migration: Add Smart Price Protection to QuickBooks Sync
-- Date: 2026-06-19
-- ═══════════════════════════════════════════════════════════
-- 
-- PURPOSE:
-- Adds multiplier and max_drop_percent columns to quickbooks_mappings
-- to enable "smart price protection" during QB sync:
--   1. multiplier: For items where QB stores per-piece cost but DB needs case cost
--      (e.g., Papelito Para Torta: QB has $0.58/piece, DB needs $34.80/case of 60)
--   2. max_drop_percent: Maximum allowed price decrease (%) per sync cycle.
--      If QB sends a price that drops more than this threshold, the update is BLOCKED
--      and a warning is logged. Price INCREASES always pass through.
--
-- BUSINESS RULES:
--   - Default multiplier = 1 (no multiplication, pass-through)
--   - Default max_drop_percent = 50 (block drops >50%)
--   - Papelito Para Torta (QB ID 540) gets multiplier = 60
--   - Subidas de precio SIEMPRE se permiten
--   - Bajadas de precio se permiten HASTA max_drop_percent
-- ═══════════════════════════════════════════════════════════

-- Step 1: Add columns
ALTER TABLE quickbooks_mappings 
  ADD COLUMN IF NOT EXISTS multiplier decimal DEFAULT 1;

ALTER TABLE quickbooks_mappings 
  ADD COLUMN IF NOT EXISTS max_drop_percent decimal DEFAULT 50;

-- Step 2: Add comments for documentation
COMMENT ON COLUMN quickbooks_mappings.multiplier IS 
  'Multiplicador para convertir el precio por unidad de QB al precio de case/empaque de la DB. Default 1 (sin multiplicación). Ejemplo: Papelito = 60 porque QB tiene precio por pieza y DB guarda por case de 60.';

COMMENT ON COLUMN quickbooks_mappings.max_drop_percent IS 
  'Porcentaje máximo permitido de caída de precio en un sync. Si QB envía un precio que baja más de este %, se bloquea el update y se logea warning. Subidas siempre se permiten. Default 50%.';

-- Step 3: Configure Papelito Para Torta
UPDATE quickbooks_mappings 
  SET multiplier = 60 
  WHERE qb_item_id = '540';
