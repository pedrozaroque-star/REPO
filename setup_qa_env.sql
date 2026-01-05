
-- SCRIPT DE PREPARACIÓN DE ENTORNO QA (TEG Modernizado)
-- Ejecutar en Supabase SQL Editor para crear datos de prueba.

DO $$
DECLARE
  v_store_id BIGINT;
  v_admin_id UUID;
  v_supervisor_id UUID;
  v_manager_id UUID;
  v_asistente_id UUID;
BEGIN

  -- 1. Crear Tienda de Prueba
  INSERT INTO stores (name, code, city)
  VALUES ('Tienda QA Test', 'QA-001', 'Test City')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_store_id;

  RAISE NOTICE 'Tienda QA creada con ID: %', v_store_id;

  -- 2. Crear/Actualizar Usuarios de Prueba (Simulados en tabla public.users)
  -- NOTA: Esto solo crea el perfil en la tabla 'users'. 
  -- Para hacer login real, debes crearlos en Authentication > Users manualmente
  -- o usar un script de auth.users si tienes privilegios de superadmin.
  
  -- Para pruebas locales, asumimos que Authentication ya tiene estos emails o que 
  -- crearás los usuarios en el panel de Supabase Auth coincidiendo con estos emails.

  -- 2.1 ADMIN
  INSERT INTO users (email, full_name, role, store_scope)
  VALUES ('admin@teg.com', 'Admin QA', 'admin', null)
  ON CONFLICT (email) DO UPDATE SET role = 'admin';
  
  -- 2.2 SUPERVISOR
  INSERT INTO users (email, full_name, role, store_scope)
  VALUES ('supervisor@teg.com', 'Supervisor QA', 'supervisor', ARRAY[v_store_id]::text[])
  ON CONFLICT (email) DO UPDATE SET role = 'supervisor', store_scope = ARRAY[v_store_id]::text[];

  -- 2.3 MANAGER
  INSERT INTO users (email, full_name, role, store_id)
  VALUES ('manager@teg.com', 'Manager QA', 'manager', v_store_id)
  ON CONFLICT (email) DO UPDATE SET role = 'manager', store_id = v_store_id;

  -- 2.4 ASISTENTE
  INSERT INTO users (email, full_name, role, store_id)
  VALUES ('asistente@teg.com', 'Asistente QA', 'asistente', v_store_id)
  ON CONFLICT (email) DO UPDATE SET role = 'asistente', store_id = v_store_id;

  RAISE NOTICE 'Usuarios de prueba configurados en tabla public.users';
  RAISE NOTICE 'RECUERDA: Debes crear estos mismos usuarios en Supabase Auth con password seguro.';

END $$;
