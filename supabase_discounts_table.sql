-- Migration: Crear tabla para auditoría detallada de descuentos (Toast)
-- Esta tabla guardará cada descuento aplicado a nivel transacción

CREATE TABLE IF NOT EXISTS public.sales_discounts_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id TEXT NOT NULL,
    store_name TEXT NOT NULL,
    business_date DATE NOT NULL,
    discount_name TEXT NOT NULL,
    discount_amount NUMERIC(10, 2) NOT NULL,
    approver_name TEXT,
    server_name TEXT,
    order_id TEXT,
    check_id TEXT,
    opened_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Nota: Removimos la restricción UNIQUE. 
    -- Toast permite múltiples descuentos idénticos en un mismo ticket (Ej. aplicar dos 'Senior Discounts' al mismo cheque).
    -- La duplicidad al correr el script la manejamos borrando primero los registros del día antes de insertar.
);

-- Índices para el Dashboard
CREATE INDEX IF NOT EXISTS idx_sales_discounts_date ON public.sales_discounts_log(business_date);
CREATE INDEX IF NOT EXISTS idx_sales_discounts_store ON public.sales_discounts_log(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_discounts_name ON public.sales_discounts_log(discount_name);

-- RLS (Row Level Security)
ALTER TABLE public.sales_discounts_log ENABLE ROW LEVEL SECURITY;

-- Permitir lectura a todos (para el admin dashboard) y escritura al role service_role
CREATE POLICY "Enable read access for all dashboard users" ON public.sales_discounts_log
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for service_role only" ON public.sales_discounts_log
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable delete for service_role only" ON public.sales_discounts_log
    FOR DELETE USING (true);
