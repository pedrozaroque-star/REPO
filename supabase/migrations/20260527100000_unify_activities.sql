-- ============================================================
-- Migration: Unify Activities
-- Adds 'shift' and 'overrides' columns to operating_procedures
-- Sets shift values based on existing shift_type
-- Adds RLS policies for write operations
-- ============================================================

-- 1. Add 'shift' column (AM, PM, AMBOS)
ALTER TABLE operating_procedures
  ADD COLUMN IF NOT EXISTS shift TEXT DEFAULT 'AMBOS';

-- 2. Add 'overrides' column (JSONB for per-store overrides)
ALTER TABLE operating_procedures
  ADD COLUMN IF NOT EXISTS overrides JSONB DEFAULT '{}'::jsonb;

-- 3. Backfill 'shift' based on existing shift_type values
UPDATE operating_procedures
  SET shift = CASE
    WHEN shift_type = 'Apertura' THEN 'AM'
    WHEN shift_type = 'Cierre'   THEN 'PM'
    WHEN shift_type = 'Regular'  THEN 'AMBOS'
    ELSE 'AMBOS'
  END
  WHERE shift IS NULL OR shift = 'AMBOS';

-- 4. RLS policies for INSERT, UPDATE, DELETE (mirrors existing SELECT policy)
DROP POLICY IF EXISTS "Enable insert for all users" ON operating_procedures;
CREATE POLICY "Enable insert for all users"
  ON operating_procedures
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all users" ON operating_procedures;
CREATE POLICY "Enable update for all users"
  ON operating_procedures
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON operating_procedures;
CREATE POLICY "Enable delete for all users"
  ON operating_procedures
  FOR DELETE
  USING (true);
