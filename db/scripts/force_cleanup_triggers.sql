-- Verificación y Limpieza Profunda de Triggers
-- 1. Listar lo que existe actualmente (para que veas si se borró o no)
SELECT tgname AS nombre_trigger
FROM pg_trigger
WHERE tgrelid = 'supervisor_inspections'::regclass;

-- 2. Borrar explícitamente TODOS los triggers sospechosos de notificación
DROP TRIGGER IF EXISTS trg_notify_supervisor ON supervisor_inspections;
DROP TRIGGER IF EXISTS trg_notify_status_supervisor ON supervisor_inspections;

-- 3. Confirmación final (debería salir vacío o solo triggers de sistema)
SELECT 'Triggers restantes:' as estado, tgname 
FROM pg_trigger
WHERE tgrelid = 'supervisor_inspections'::regclass;
