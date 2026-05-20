-- Migration: Create break_manual_overrides table for AI learning
-- This table stores every manual break adjustment made by managers
-- so the AI engine can learn their preferences over time.

CREATE TABLE IF NOT EXISTS break_manual_overrides (
  id bigserial PRIMARY KEY,
  store_id text NOT NULL,
  role text NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  break_type text NOT NULL,
  break_index smallint NOT NULL DEFAULT 0,
  offset_from_start_min int NOT NULL,
  shift_duration_min int NOT NULL,
  peak_hour smallint,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bmo_lookup 
  ON break_manual_overrides(store_id, role, day_of_week, break_type);

-- Enable RLS but allow service role full access
ALTER TABLE break_manual_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON break_manual_overrides
  FOR ALL USING (true) WITH CHECK (true);
