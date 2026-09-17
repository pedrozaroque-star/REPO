-- Migration: Create P&L Operating and Shared Expenses Tables
-- Enables multi-location side-by-side financial reporting and intercompany markup reconciliation

CREATE TABLE IF NOT EXISTS store_operating_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    store_name VARCHAR(100),
    month_year VARCHAR(7) NOT NULL DEFAULT 'DEFAULT', -- 'YYYY-MM' or 'DEFAULT'
    rent_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cam_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    utilities_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    repairs_maintenance_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    supplies_misc_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    insurance_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_store_operating_expenses UNIQUE (store_id, month_year)
);

CREATE TABLE IF NOT EXISTS shared_brand_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'marketing', -- 'marketing', 'corporate_overhead', 'legal_accounting', 'supervision'
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    allocation_method VARCHAR(30) NOT NULL DEFAULT 'even_split', -- 'even_split' or 'sales_weighted'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policies
ALTER TABLE store_operating_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_brand_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read store_operating_expenses" ON store_operating_expenses;
CREATE POLICY "Allow authenticated read store_operating_expenses" ON store_operating_expenses
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated write store_operating_expenses" ON store_operating_expenses;
CREATE POLICY "Allow authenticated write store_operating_expenses" ON store_operating_expenses
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read shared_brand_expenses" ON shared_brand_expenses;
CREATE POLICY "Allow authenticated read shared_brand_expenses" ON shared_brand_expenses
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated write shared_brand_expenses" ON shared_brand_expenses;
CREATE POLICY "Allow authenticated write shared_brand_expenses" ON shared_brand_expenses
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
