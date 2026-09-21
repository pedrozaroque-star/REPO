-- Persist native RONOS assignment IDs so payroll joins hours to Simplify rates without name matching.
ALTER TABLE ronos_employee_timecards_cache
  ADD COLUMN IF NOT EXISTS ronos_assignment_id TEXT;

ALTER TABLE simplify_employee_rates
  ADD COLUMN IF NOT EXISTS ronos_assignment_id TEXT,
  ADD COLUMN IF NOT EXISTS ronos_synced BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ronos_timecards_company_assignment
  ON ronos_employee_timecards_cache (company_id, ronos_assignment_id)
  WHERE ronos_assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_simplify_rates_company_assignment
  ON simplify_employee_rates (ronos_company_id, ronos_assignment_id)
  WHERE ronos_assignment_id IS NOT NULL;
