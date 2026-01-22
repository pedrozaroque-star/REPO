-- Migration: Create Weekly Operations Reports table (CORRECTED TYPE)
-- Description: Stores the digitized "Weekly Operations Report" replacing the Excel sheet.

CREATE TABLE IF NOT EXISTS weekly_operations_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id BIGINT NOT NULL REFERENCES stores(id), -- Changed from UUID to BIGINT to match stores table
    week_start_date DATE NOT NULL,
    status TEXT DEFAULT 'draft', -- 'draft', 'finalized'
    
    -- Storing daily data in JSONB
    daily_data JSONB DEFAULT '{}'::jsonb,
    
    -- Week-level metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),

    -- Ensure one report per store per week
    UNIQUE(store_id, week_start_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_weekly_reports_store_date ON weekly_operations_reports(store_id, week_start_date);

-- Permissions (RLS)
ALTER TABLE weekly_operations_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON weekly_operations_reports
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Enable insert/update for authenticated users" ON weekly_operations_reports
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
