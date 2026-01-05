
-- Update Sobrante template questions to 'number' type and append '(Lbs)' to text

DO $$
DECLARE
  v_template_id BIGINT;
  v_section_id BIGINT;
BEGIN
  -- Get the template ID
  SELECT id INTO v_template_id FROM templates WHERE code = 'sobrante_v1';
  
  IF v_template_id IS NOT NULL THEN
    -- Get the section ID
    SELECT id INTO v_section_id FROM template_sections WHERE template_id = v_template_id LIMIT 1;
    
    IF v_section_id IS NOT NULL THEN
       -- Update questions
       UPDATE template_questions
       SET type = 'number',
           text = text || ' (Lbs)'
       WHERE section_id = v_section_id
         AND type = 'yes_no' -- Only update if not already updated
         AND text NOT LIKE '%(Lbs)%';
         
       RAISE NOTICE 'Updated Sobrante questions to number type.';
    ELSE
       RAISE NOTICE 'Sobrante section not found.';
    END IF;
  ELSE
    RAISE NOTICE 'Sobrante template not found.';
  END IF;
END $$;
