UPDATE supervisor_inspections
SET estatus_admin = 'cerrado'
WHERE inspection_date < '2026-01-05' 
  AND estatus_admin IS DISTINCT FROM 'cerrado';
