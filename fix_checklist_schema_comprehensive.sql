
-- CORRECCIÓN INTEGRAL DEL ESQUEMA DE CHECKLISTS
-- Este script asegura que TODAS las columnas requeridas por el frontend existan.

DO $$
BEGIN
  -- 1. user_name (Texto)
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN user_name TEXT;
    RAISE NOTICE 'Columna user_name agregada.';
  EXCEPTION WHEN duplicate_column THEN NULL; END;

  -- 2. comments (Texto) - A veces se llama 'notes', aseguramos 'comments'
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN comments TEXT;
    RAISE NOTICE 'Columna comments agregada.';
  EXCEPTION WHEN duplicate_column THEN NULL; END;

  -- 3. score (Numérico/Entero)
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN score INTEGER DEFAULT 0;
    RAISE NOTICE 'Columna score agregada.';
  EXCEPTION WHEN duplicate_column THEN NULL; END;

  -- 4. photos (Array de Texto) - Re-verificamos por si acaso
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN photos TEXT[] DEFAULT '{}';
    RAISE NOTICE 'Columna photos agregada/verificada.';
  EXCEPTION WHEN duplicate_column THEN NULL; END;

  -- 5. shift (Texto: AM/PM)
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN shift TEXT;
    RAISE NOTICE 'Columna shift agregada.';
  EXCEPTION WHEN duplicate_column THEN NULL; END;
  
   -- 6. checklist_type (Texto)
  BEGIN
    ALTER TABLE assistant_checklists ADD COLUMN checklist_type TEXT;
    RAISE NOTICE 'Columna checklist_type agregada.';
  EXCEPTION WHEN duplicate_column THEN NULL; END;

  RAISE NOTICE 'Esquema de assistant_checklists actualizado al 100 por ciento.';
END $$;
