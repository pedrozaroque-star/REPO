SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('manager_checklists', 'assistant_checklists') 
AND column_name IN ('user_id', 'created_by');
