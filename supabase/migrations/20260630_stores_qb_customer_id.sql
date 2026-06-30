-- Migration: Add QB Customer ID to stores
-- Date: 2026-06-30
-- Purpose: Store QuickBooks Customer ID per store for automatic Estimate creation
-- The IDs were fetched via qbo.findCustomers() from the live QB production account

ALTER TABLE stores ADD COLUMN IF NOT EXISTS qb_customer_id TEXT;

COMMENT ON COLUMN stores.qb_customer_id IS 'QuickBooks Online Customer ID for this store (used in Estimate creation)';

UPDATE stores SET qb_customer_id = CASE name
    WHEN 'Azusa' THEN '1100'
    WHEN 'Bell' THEN '1101'
    WHEN 'LA Broadway' THEN '1102'
    WHEN 'LA Central' THEN '1103'
    WHEN 'Downey' THEN '1104'
    WHEN 'Hollywood' THEN '1111'
    WHEN 'Huntington Park' THEN '1105'
    WHEN 'La Puente' THEN '1110'
    WHEN 'Lynwood' THEN '1108'
    WHEN 'Norwalk' THEN '1219'
    WHEN 'Rialto' THEN '1441'
    WHEN 'Santa Ana' THEN '1106'
    WHEN 'Slauson' THEN '1329'
    WHEN 'South Gate' THEN '1109'
    WHEN 'West Covina' THEN '1107'
END
WHERE is_active = true;
