-- Migration: Restructure supervisor management into two dedicated relational tables
-- Architecture: Dynamic Supervisor Territory & Paying Store Management for RONOS module
-- 1. supervisor_operational_assignments: "¿Qué tiendas opera esta persona?"
-- 2. supervisor_payroll_assignments: "¿Dónde y con qué recibo se pagó?" (UNIQUE paystub_id)

-- 1. supervisor_operational_assignments
CREATE TABLE IF NOT EXISTS supervisor_operational_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_assignment_id TEXT,
  supervisor_employee_id TEXT,
  operational_store_id INTEGER NOT NULL REFERENCES stores(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  source TEXT NOT NULL CHECK (source IN ('stores_assignment', 'simplify_paystub', 'manual_review')),
  review_status TEXT NOT NULL CHECK (review_status IN ('verified', 'requires_review', 'expired')),
  supervisor_name_snapshot TEXT,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sup_op_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_sup_op_asg_id ON supervisor_operational_assignments (supervisor_assignment_id);
CREATE INDEX IF NOT EXISTS idx_sup_op_emp_id ON supervisor_operational_assignments (supervisor_employee_id);
CREATE INDEX IF NOT EXISTS idx_sup_op_store ON supervisor_operational_assignments (operational_store_id);
CREATE INDEX IF NOT EXISTS idx_sup_op_dates ON supervisor_operational_assignments (effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_sup_op_status ON supervisor_operational_assignments (review_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sup_op_unique_active 
  ON supervisor_operational_assignments (supervisor_assignment_id, operational_store_id) 
  WHERE effective_to IS NULL AND supervisor_assignment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sup_op_unique_active_emp 
  ON supervisor_operational_assignments (supervisor_employee_id, operational_store_id) 
  WHERE effective_to IS NULL AND supervisor_employee_id IS NOT NULL;

-- 2. supervisor_payroll_assignments
CREATE TABLE IF NOT EXISTS supervisor_payroll_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_assignment_id TEXT,
  supervisor_employee_id TEXT,
  payroll_store_id INTEGER NOT NULL REFERENCES stores(id),
  simplify_site_id TEXT NOT NULL,
  paystub_id TEXT NOT NULL UNIQUE,
  batch_id TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_wages NUMERIC(10, 2),
  salary_hours NUMERIC(6, 2),
  source TEXT NOT NULL CHECK (source IN ('simplify_paystub', 'manual_review')),
  review_status TEXT NOT NULL CHECK (review_status IN ('verified', 'requires_review', 'expired')),
  supervisor_name_snapshot TEXT,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sup_pay_period_dates CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_sup_pay_asg_id ON supervisor_payroll_assignments (supervisor_assignment_id);
CREATE INDEX IF NOT EXISTS idx_sup_pay_emp_id ON supervisor_payroll_assignments (supervisor_employee_id);
CREATE INDEX IF NOT EXISTS idx_sup_pay_store ON supervisor_payroll_assignments (payroll_store_id);
CREATE INDEX IF NOT EXISTS idx_sup_pay_period ON supervisor_payroll_assignments (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_sup_pay_status ON supervisor_payroll_assignments (review_status);
