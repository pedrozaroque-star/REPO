-- LIMPIEZA DE DUPLICADOS
-- Ejecutar PRIMERO en Supabase SQL Editor

-- Esto borrará todas las plantillas, secciones y preguntas
-- gracias al CASCADE en las foreign keys
DELETE FROM templates WHERE code IN (
  'checklist_apertura',
  'checklist_cierre', 
  'checklist_daily',
  'checklist_recorrido',
  'checklist_sobrante',
  'checklist_temperaturas',
  'manager_checklist_v1',
  'supervisor_inspection_v1',
  'public_feedback_v1',
  'staff_evaluation_v1'
);

-- Verificar que todo está limpio
SELECT 'Templates restantes:', COUNT(*) FROM templates;
SELECT 'Secciones restantes:', COUNT(*) FROM template_sections;
SELECT 'Preguntas restantes:', COUNT(*) FROM template_questions;
