
-- SOLUCIÓN FINAL DE COLUMNAS (Versión 2)
-- El error indica que 'user_name' YA existe (porque la creamos con el script anterior).
-- Y 'assistant_name' TAMBIÉN existe y tiene NOT NULL (causando el error).

DO $$
BEGIN
  -- 1. Migrar datos viejos (si los hay) de assistant_name a user_name
  -- Solo para registros donde user_name esté vacío
  UPDATE assistant_checklists 
  SET user_name = assistant_name 
  WHERE user_name IS NULL AND assistant_name IS NOT NULL;

  -- 2. Eliminar la columna problemática 'assistant_name'
  -- Ya no la necesitamos porque el frontend usa 'user_name'
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='assistant_checklists' AND column_name='assistant_name') THEN
    ALTER TABLE assistant_checklists DROP COLUMN assistant_name;
    RAISE NOTICE 'Columna obsoleta assistant_name eliminada.';
  END IF;

  RAISE NOTICE 'Conflicto resuelto: Ahora solo existe user_name.';
END $$;
