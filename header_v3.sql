-- Migration Script for Legacy Supervisor Inspections (Manual Fix v3)
-- Strategy: TRUNCATE + REFILL

-- 1. Cleans the table completely
TRUNCATE TABLE supervisor_inspections;

-- 2. Ensures the UNIQUE constraint on original_report_id exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supervisor_inspections_original_report_id_key') THEN
        ALTER TABLE supervisor_inspections ADD CONSTRAINT supervisor_inspections_original_report_id_key UNIQUE (original_report_id);
    END IF;
END $$;

-- 3. Proceed with Insertions (appended below)
