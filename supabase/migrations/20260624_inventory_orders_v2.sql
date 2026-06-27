-- ============================================================================
-- MIGRACIÓN: SISTEMA DE PEDIDOS AUTOMÁTICOS A BODEGA V2
-- FECHA: 2026-06-24
-- DESCRIPCIÓN: Crea tablas para el sistema completo de órdenes a bodega con
--              tracking de pedidos, integración QuickBooks, y PAR ideal
--              auto-calculado. Reemplaza el flujo manual del Excel.
-- ============================================================================

-- 1. TABLA DE ÓRDENES (Cada envío/pedido a la bodega)
CREATE TABLE IF NOT EXISTS public.inventory_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    order_date DATE NOT NULL,               -- Fecha para la cual se genera la orden
    week_start_date DATE NOT NULL,          -- Lunes de la semana (para agrupación)
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft','pending','sent','received','cancelled')),
    created_by TEXT,                         -- Nombre del usuario que creó
    notes TEXT,
    qb_estimate_id TEXT,                    -- ID del Estimate en QuickBooks
    qb_estimate_number TEXT,                -- Número legible del Estimate en QB
    sent_at TIMESTAMP WITH TIME ZONE,       -- Cuándo se envió a QB
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Una sola orden por tienda por día
    UNIQUE(store_id, order_date)
);

-- 2. LÍNEAS DE CADA ORDEN (Detalle por item)
CREATE TABLE IF NOT EXISTS public.inventory_order_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.inventory_orders(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    calculated_qty NUMERIC(10,2) DEFAULT 0,   -- Cantidad calculada: PAR_mañana - Sobrante_hoy
    adjusted_qty NUMERIC(10,2),               -- Cantidad ajustada por el manager (override)
    final_qty NUMERIC(10,2) DEFAULT 0,        -- Cantidad final que se envía (adjusted ?? calculated)
    par_value NUMERIC(10,2),                  -- PAR que se usó para el cálculo (audit trail)
    leftover_value NUMERIC(10,2),             -- Sobrante que se usó para el cálculo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. PAR IDEAL (Promedio histórico calculado, referencia estable)
-- Se actualiza periódicamente promediando las weekly_bases de las últimas N semanas
CREATE TABLE IF NOT EXISTS public.inventory_par_ideal (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    mon_par NUMERIC(10,2) DEFAULT 0,
    tue_par NUMERIC(10,2) DEFAULT 0,
    wed_par NUMERIC(10,2) DEFAULT 0,
    thu_par NUMERIC(10,2) DEFAULT 0,
    fri_par NUMERIC(10,2) DEFAULT 0,
    sat_par NUMERIC(10,2) DEFAULT 0,
    sun_par NUMERIC(10,2) DEFAULT 0,
    calculated_from_weeks INTEGER DEFAULT 0,  -- Cuántas semanas se usaron para el promedio
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(store_id, inventory_item_id)
);

-- 4. CAMPOS ADICIONALES EN inventory_items PARA ÓRDENES
ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS order_unit_description TEXT;  -- Ej: "(Bag of 10 lbs)"

ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS order_rounding_rule TEXT DEFAULT 'none';  -- 'none', 'ceiling_30', 'ceiling_4'

ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS order_sort_position INTEGER DEFAULT 999;  -- Orden en la lista de pedido

-- ============================================================================
-- ÍNDICES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_orders_store_date 
    ON public.inventory_orders(store_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_week 
    ON public.inventory_orders(store_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_order_lines_order 
    ON public.inventory_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_item 
    ON public.inventory_order_lines(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_par_ideal_store 
    ON public.inventory_par_ideal(store_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.inventory_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_par_ideal ENABLE ROW LEVEL SECURITY;

-- inventory_orders policies
CREATE POLICY "auth_read_orders" 
    ON public.inventory_orders FOR SELECT 
    USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_orders" 
    ON public.inventory_orders FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_orders" 
    ON public.inventory_orders FOR UPDATE 
    USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_orders" 
    ON public.inventory_orders FOR DELETE 
    USING (auth.role() = 'authenticated');

-- inventory_order_lines policies
CREATE POLICY "auth_read_order_lines" 
    ON public.inventory_order_lines FOR SELECT 
    USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_order_lines" 
    ON public.inventory_order_lines FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_order_lines" 
    ON public.inventory_order_lines FOR UPDATE 
    USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_order_lines" 
    ON public.inventory_order_lines FOR DELETE 
    USING (auth.role() = 'authenticated');

-- inventory_par_ideal policies
CREATE POLICY "auth_read_par_ideal" 
    ON public.inventory_par_ideal FOR SELECT 
    USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_par_ideal" 
    ON public.inventory_par_ideal FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_par_ideal" 
    ON public.inventory_par_ideal FOR UPDATE 
    USING (auth.role() = 'authenticated');
