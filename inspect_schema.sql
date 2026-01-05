
DO $$
DECLARE
  v_col_name text;
  v_data_type text;
BEGIN
  FOR v_col_name, v_data_type IN 
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'assistant_checklists'
  LOOP
    RAISE NOTICE 'Column: %, Type: %', v_col_name, v_data_type;
  END LOOP;
END $$;
