-- Migration: Add is_active column to ronos_employee_mappings
-- Ensures explicit persistence of inactive status in Supabase

ALTER TABLE ronos_employee_mappings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ronos_mappings_company_active
  ON ronos_employee_mappings (ronos_company_id, is_active);
