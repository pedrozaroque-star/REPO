-- Inspect schemas of dynamic checklist tables
SELECT 
    t.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public'
  AND t.table_name IN ('templates', 'template_sections', 'template_questions')
ORDER BY t.table_name, c.ordinal_position;
