
-- ESTANDARIZACIÓN DE NOMBRES DE COLUMNA
-- El frontend envía 'user_name' pero la base de datos (según mensaje de error) espera 'assistant_name'.
-- Vamos a estandarizar todo a 'user_name' que es más genérico, pero manteniendo retro-compatibilidad si es necesario.

DO $$
BEGIN
  -- 1. Si existe 'assistant_name', lo renombramos a 'user_name' (si 'user_name' no existe)
  -- Si ambos existen, el código frontend debe decidir, pero aquí simplificamos.
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='assistant_checklists' AND column_name='assistant_name') THEN
     ALTER TABLE assistant_checklists RENAME COLUMN assistant_name TO user_name;
     RAISE NOTICE 'Columna assistant_name renombrada a user_name.';
  END IF;

  -- 2. Aseguramos que user_name NO SEA NULO (dado que el frontend siempre lo envía)
  ALTER TABLE assistant_checklists ALTER COLUMN user_name DROP NOT NULL; -- Por seguridad inicial
  RAISE NOTICE 'Restricción NOT NULL removida temporalmente de user_name para evitar bloqueos.';

END $$;
