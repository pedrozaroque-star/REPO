-- Ensure time tracking columns exist for manager_checklists
ALTER TABLE manager_checklists ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE manager_checklists ADD COLUMN IF NOT EXISTS end_time TEXT;
ALTER TABLE manager_checklists ADD COLUMN IF NOT EXISTS duration TEXT;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'manager_checklists'
AND column_name IN ('start_time', 'end_time', 'duration');
