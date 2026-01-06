-- Eliminar el trigger que genera notificaciones duplicadas automáticamente
DROP TRIGGER IF EXISTS trg_notify_supervisor ON supervisor_inspections;

-- Opcional: Si quieres eliminar también la función subyacente si ya no se usa en otros lados
-- DROP FUNCTION IF EXISTS notify_hierarchy();
