-- migration file for Preparador module (Meat History & Reltame Requests)

-- 1. Tabla Histórica de Consumo de Carne (Intervalos de 30 mins)
CREATE TABLE IF NOT EXISTS public.meat_consumption_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    interval_start TIME NOT NULL, -- e.g., '10:00:00' o '10:30:00'
    meat_type TEXT NOT NULL,      -- 'ASADA', 'POLLO', 'PASTOR', 'CABEZA', 'LENGUA'
    raw_lbs NUMERIC NOT NULL,     -- Libras calculadas después de aplicar Yield
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Evitar duplicidad de la misma franja para la misma tienda y carne en el mismo día
    UNIQUE(store_id, business_date, interval_start, meat_type)
);

-- Índices UltraRápidos para extraer el "Promedio de Libras por Día de la Semana" al vuelo
-- Por default: Querremos el promedio de ese mismo 'Day Of Week' (e.g. Todos los Jueves a las 10:00)
CREATE INDEX idx_meat_dow_lookup ON public.meat_consumption_history(
    store_id, 
    meat_type, 
    interval_start, 
    (EXTRACT(ISODOW FROM business_date)) -- 1=Monday...7=Sunday
);
CREATE INDEX idx_meat_consumption_date ON public.meat_consumption_history(business_date);

-- 2. Tabla de Pedidos en Tiempo Real (Tableta Línea -> Tableta Bodega)
CREATE TABLE IF NOT EXISTS public.preparador_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    sender_name TEXT,
    items JSONB NOT NULL DEFAULT '[]'::jsonb, -- ['Queso Cotija', 'Vasos 8oz']
    status TEXT NOT NULL DEFAULT 'PENDING',   -- 'PENDING' | 'ACKNOWLEDGED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_preparador_requests_active ON public.preparador_requests(store_id, status);

-- 3. Habilitar Realtime para que la Bodega escuche los INSERTS
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE public.preparador_requests;
COMMIT;

-- 4. Función RPC para Agrupar y Promediar Libras Consumidas en memoria DB (Ultra Rápido)
CREATE OR REPLACE FUNCTION get_meat_history_avg(p_store_id BIGINT, p_dow INT)
RETURNS TABLE (
    interval_start TIME,
    meat_type TEXT,
    avg_lbs NUMERIC,
    samples INT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.interval_start, 
        m.meat_type, 
        ROUND(AVG(m.raw_lbs)::NUMERIC, 2) AS avg_lbs,
        COUNT(m.raw_lbs)::INT AS samples
    FROM public.meat_consumption_history m
    WHERE m.store_id = p_store_id
      AND EXTRACT(ISODOW FROM m.business_date) = p_dow
      AND m.business_date >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY m.interval_start, m.meat_type
    ORDER BY m.interval_start, m.meat_type;
END;
$$;
