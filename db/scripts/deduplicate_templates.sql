
-- SCRIPT DE DEDUPLICACIÓN DE PLANTILLAS
-- Ejecutar para limpiar templates duplicados y dejar solo el más reciente.

DO $$
DECLARE
  dup_record RECORD;
BEGIN
  FOR dup_record IN
    SELECT code
    FROM templates
    GROUP BY code
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'Limpiando duplicados para: %', dup_record.code;

    -- Borrar todos MENOS el id más reciente
    DELETE FROM templates
    WHERE code = dup_record.code
    AND id NOT IN (
      SELECT MAX(id)
      FROM templates
      WHERE code = dup_record.code
    );
  END LOOP;
  
  RAISE NOTICE '¡Limpieza completada!';
END $$;
