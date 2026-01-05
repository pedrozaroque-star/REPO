
-- AGREGAR COLUMNA PHOTOS FALTANTE
-- Este script agrega la columna 'photos' a la tabla 'assistant_checklists' para soportar la carga de evidencias.

DO $$
BEGIN
  -- Agregar columna photos (Array de texto para URLs)
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN photos TEXT[] DEFAULT '{}';
    RAISE NOTICE 'Columna photos agregada exitosamente.';
  EXCEPTION
    WHEN duplicate_column THEN
    RAISE NOTICE 'La columna photos ya existe.';
  END;

  -- Opcional: Si queremos ser consistentes, agregamos también a managers (supervisor_checklists suele tener estructura diferente)
  -- Por ahora solo assistant_checklists falló.
END $$;
