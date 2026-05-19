CREATE TABLE IF NOT EXISTS public.sales_projections_cache (
    store_id TEXT NOT NULL,
    business_date DATE NOT NULL,
    total_sales NUMERIC(10,2) NOT NULL DEFAULT 0,
    hourly_data JSONB,
    meta JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (store_id, business_date)
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.sales_projections_cache ENABLE ROW LEVEL SECURITY;

-- Política para permitir select a usuarios autenticados
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'sales_projections_cache' AND policyname = 'Enable read access for authenticated users'
    ) THEN
        CREATE POLICY "Enable read access for authenticated users" 
            ON public.sales_projections_cache FOR SELECT 
            TO authenticated USING (true);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'sales_projections_cache' AND policyname = 'Enable all access for authenticated users'
    ) THEN
        CREATE POLICY "Enable all access for authenticated users" 
            ON public.sales_projections_cache FOR ALL 
            TO authenticated USING (true) WITH CHECK (true);
    END IF;
END
$$;
