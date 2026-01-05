SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'manager_checklists'
AND column_name IN ('start_time', 'end_time', 'duration', 'total_time');
