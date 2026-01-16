-- DIAGNOSTICO DE JSON
-- Veamos cómo está guardada la estructura "answers" realmente para ajustar el script.

SELECT id, inspection_date, answers 
FROM supervisor_inspections 
LIMIT 3;
