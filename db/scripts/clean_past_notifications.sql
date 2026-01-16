-- Limpiar el historial de notificaciones duplicadas (las "feas")
-- Esto borrará solo las notificaciones pasadas que dicen "Nueva Auditoría de Supervisor"

DELETE FROM notifications 
WHERE title LIKE '%Nueva Auditoría de Supervisor%' OR title LIKE '%🛡️ Nueva Auditoría de Supervisor%';

-- Confirmación visual de cuántas quedan (debería ser 0)
SELECT count(*) as restantes_a_borrar 
FROM notifications 
WHERE title LIKE '%Nueva Auditoría de Supervisor%';
