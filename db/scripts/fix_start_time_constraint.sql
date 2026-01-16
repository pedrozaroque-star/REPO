
-- SOLUCIÓN DE TIEMPOS (AUTO-FILL)
-- El backend legacy espera start_time, pero el frontend no lo manda.
-- Solución: Dejar que la base de datos lo ponga automáticamente.

DO $$
BEGIN
  -- 1. start_time: Si no se envía, usar la hora actual
  ALTER TABLE assistant_checklists ALTER COLUMN start_time SET DEFAULT now();
  RAISE NOTICE 'start_time ahora tiene valor default (now).';

  -- 2. end_time: Prevenimos el siguiente error lógico
  -- Si existe end_time, también le ponemos default o lo hacemos opcional
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='assistant_checklists' AND column_name='end_time') THEN
    ALTER TABLE assistant_checklists ALTER COLUMN end_time DROP NOT NULL;
    RAISE NOTICE 'end_time ahora es opcional.';
  END IF;

  RAISE NOTICE 'Restricciones de tiempo corregidas.';
END $$;
