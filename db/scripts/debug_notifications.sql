-- Buscar el origen de la notificación duplicada
-- 1. Buscamos funciones que contengan el texto específico
SELECT routine_name, routine_definition 
FROM information_schema.routines 
WHERE routine_definition ILIKE '%Nueva Auditoría%' 
   OR routine_definition ILIKE '%🛡️%';

-- 2. Listar todos los triggers de la tabla de inspecciones
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'supervisor_inspections';
