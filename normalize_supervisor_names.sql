-- SCRIPT DE NORMALIZACIÓN DE NOMBRES
-- Unifica las variaciones de nombres de supervisores mal escritos.

BEGIN;

-- 1. Unificar "Willian Aguilar" (y sus typos)
UPDATE supervisor_inspections
SET supervisor_name = 'Willian Aguilar'
WHERE supervisor_name ILIKE '%Willian%' 
   OR supervisor_name ILIKE '%Wilian%'
   OR supervisor_name ILIKE '%William%'
   OR supervisor_name ILIKE '%Aguilar%';

-- 2. Asignar "Desconocido" si está vacío
UPDATE supervisor_inspections
SET supervisor_name = 'Supervisor Estándar'
WHERE supervisor_name IS NULL OR supervisor_name = '';

-- Verificación final
SELECT supervisor_name, COUNT(*) 
FROM supervisor_inspections 
GROUP BY supervisor_name;

COMMIT;
