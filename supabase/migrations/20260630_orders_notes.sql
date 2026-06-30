-- Migration: Add notes field to inventory_orders
-- Date: 2026-06-30
-- Purpose: Allow managers to add observations to orders that get sent as CustomerMemo in QB Estimates
-- E.g.: "Hoy necesitamos más asada por evento especial"

ALTER TABLE inventory_orders ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN inventory_orders.notes IS 'Observaciones del manager - se envía como CustomerMemo en el Estimate de QB';
