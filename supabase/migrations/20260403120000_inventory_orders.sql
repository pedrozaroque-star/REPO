-- ============================================================================
-- MIGRACIÓN: PAR IDEAL SEMANAL Y ÓRDENES (Bodega)
-- FECHA: 2026-04-03
-- DESCRIPCIÓN: Estructura para almacenar las bases (metas dinámicas) de 
--              inventario semanal para el cálculo de pedidos a Bodega.
-- ============================================================================

-- 1. Agregar campo de ordenamiento visual para coincidir con Excel
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 999;

-- 2. Crear tabla de PAR IDEAL (Bases Semanales Dinámicas)
CREATE TABLE IF NOT EXISTS public.inventory_weekly_bases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL, -- Siempre debe ser Lunes
    mon_par NUMERIC(10,2) DEFAULT 0,
    tue_par NUMERIC(10,2) DEFAULT 0,
    wed_par NUMERIC(10,2) DEFAULT 0,
    thu_par NUMERIC(10,2) DEFAULT 0,
    fri_par NUMERIC(10,2) DEFAULT 0,
    sat_par NUMERIC(10,2) DEFAULT 0,
    sun_par NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Evitar duplicados para la misma tienda, ingrediente y semana
    UNIQUE(store_id, inventory_item_id, week_start_date)
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_weekly_bases_week ON public.inventory_weekly_bases(store_id, week_start_date);

-- Políticas RLS (Si RLS está activo en la tabla)
ALTER TABLE public.inventory_weekly_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users on bases" 
ON public.inventory_weekly_bases FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users on bases" 
ON public.inventory_weekly_bases FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users on bases" 
ON public.inventory_weekly_bases FOR UPDATE USING (auth.role() = 'authenticated');

-- ============================================================================
-- OPCIONAL: SEED DE ORDENAMIENTO (Basado en el Excel original proporcionado)
-- ============================================================================
-- A modo de ejemplo, actualizamos el display_order de los items clave si los encontramos.
UPDATE public.inventory_items SET display_order = 1 WHERE name ILIKE '%Horchata%';
UPDATE public.inventory_items SET display_order = 2 WHERE name ILIKE '%Tamarindo%';
UPDATE public.inventory_items SET display_order = 3 WHERE name ILIKE '%Jamaica%';
UPDATE public.inventory_items SET display_order = 4 WHERE name ILIKE '%Piña%';
UPDATE public.inventory_items SET display_order = 5 WHERE name ILIKE '%Salsa Roja Bag%';
UPDATE public.inventory_items SET display_order = 6 WHERE name ILIKE '%Salsa Verde Bag%';
