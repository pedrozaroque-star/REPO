
-- Tabla para historial de 'ponchadas' (Time Entries) de Toast
CREATE TABLE IF NOT EXISTS public.punches (
    toast_id text PRIMARY KEY,
    store_id text,
    employee_toast_guid text,
    employee_toast_id text, -- Legacy
    job_toast_guid text,
    job_toast_id text, -- Legacy
    business_date date,
    clock_in timestamptz,
    clock_out timestamptz,
    regular_hours numeric,
    overtime_hours numeric,
    tips numeric DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

-- Index para búsquedas rápidas por fecha y empleado
CREATE INDEX IF NOT EXISTS idx_punches_date ON public.punches(business_date);
CREATE INDEX IF NOT EXISTS idx_punches_employee ON public.punches(employee_toast_guid);

-- Tabla para los horarios generados (Shifts)
CREATE TABLE IF NOT EXISTS public.shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE, -- Link interno a employees
    store_id text, -- Puede ser GUID de Toast o ID interno de store, dependiendo de implementación
    job_id uuid REFERENCES public.jobs(id), -- Link interno a jobs
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    status text DEFAULT 'draft', -- 'draft', 'published'
    notes text,
    is_open boolean DEFAULT false,
    toast_job_guid text, -- Metadata extra
    created_at timestamptz DEFAULT now()
);

-- Index para búsquedas por tienda y fecha
CREATE INDEX IF NOT EXISTS idx_shifts_store_date ON public.shifts(store_id, start_time);
