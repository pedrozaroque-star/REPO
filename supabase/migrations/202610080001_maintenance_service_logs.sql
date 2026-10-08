-- Migración: Registro de Actividades de Proveedores y Mantenimiento (Tacos Gavilan)
-- Tabla principal: maintenance_service_logs

CREATE TABLE IF NOT EXISTS public.maintenance_service_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id TEXT NOT NULL,
    service_date DATE NOT NULL DEFAULT CURRENT_DATE,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    company_name TEXT NOT NULL,
    technician_name TEXT NOT NULL,
    technician_phone TEXT,
    category TEXT NOT NULL,
    service_type TEXT NOT NULL DEFAULT 'corrective',
    area_equipment TEXT NOT NULL,
    work_description TEXT NOT NULL,
    parts_replaced TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    photos_before TEXT[] DEFAULT '{}'::TEXT[],
    photos_after TEXT[] DEFAULT '{}'::TEXT[],
    photos_invoice TEXT[] DEFAULT '{}'::TEXT[],
    invoice_number TEXT,
    cost_estimate NUMERIC(10, 2),
    manager_name TEXT NOT NULL,
    manager_signature_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para consultas y filtros ágiles
CREATE INDEX IF NOT EXISTS idx_maintenance_store_id ON public.maintenance_service_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_service_date ON public.maintenance_service_logs(service_date DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_category ON public.maintenance_service_logs(category);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON public.maintenance_service_logs(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_company ON public.maintenance_service_logs(company_name);

-- Habilitar RLS pero permitir lectura y escritura pública controlada (o por service_role)
ALTER TABLE public.maintenance_service_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'maintenance_service_logs' AND policyname = 'Public insert for maintenance logs'
    ) THEN
        CREATE POLICY "Public insert for maintenance logs" 
        ON public.maintenance_service_logs 
        FOR INSERT 
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'maintenance_service_logs' AND policyname = 'Authenticated or public read for maintenance logs'
    ) THEN
        CREATE POLICY "Authenticated or public read for maintenance logs" 
        ON public.maintenance_service_logs 
        FOR SELECT 
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'maintenance_service_logs' AND policyname = 'Admin update for maintenance logs'
    ) THEN
        CREATE POLICY "Admin update for maintenance logs" 
        ON public.maintenance_service_logs 
        FOR UPDATE 
        USING (true);
    END IF;
END $$;
