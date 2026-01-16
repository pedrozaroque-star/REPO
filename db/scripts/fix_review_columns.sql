
-- SOPORTE PARA FLUJO DE REVISIÓN (MANAGER/SUPERVISOR)
-- Agrega las columnas necesarias para que Managers y Supervisores puedan aprobar/rechazar checklists.

DO $$
BEGIN
  -- 1. CAMPOS DE MANAGER
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN estatus_manager TEXT DEFAULT 'pendiente'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN reviso_manager TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN fecha_revision_manager TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN comentarios_manager TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;

  -- 2. CAMPOS DE ADMIN/SUPERVISOR (estatus_admin se usa para la aprobación final)
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN estatus_admin TEXT DEFAULT 'pendiente'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN reviso_admin TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN fecha_revision_admin TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE assistant_checklists ADD COLUMN comentarios_admin TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;

  RAISE NOTICE 'Columnas de flujo de revisión verificadas y agregadas.';
END $$;
