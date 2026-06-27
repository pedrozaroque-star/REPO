-- ============================================================
-- Migration: Create checklist_completions table
-- Date: 2026-06-20
-- Description: Table to store daily checklist completions
--   for the fullscreen Checklist Mode in Actividades module.
--   Each store has independent daily checklists.
-- ============================================================

CREATE TABLE IF NOT EXISTS checklist_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL,
  checklist_date DATE NOT NULL,
  shift_type TEXT NOT NULL,
  activity_id UUID REFERENCES operating_procedures(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  completed_by TEXT,
  completed_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, checklist_date, shift_type, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_date_store 
  ON checklist_completions(store_id, checklist_date, shift_type);

ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON checklist_completions TO anon, authenticated, service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'checklist_all_access' 
    AND tablename = 'checklist_completions'
  ) THEN
    CREATE POLICY "checklist_all_access" 
      ON checklist_completions FOR ALL USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
