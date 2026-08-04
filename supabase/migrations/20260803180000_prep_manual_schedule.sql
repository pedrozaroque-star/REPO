-- Migration for Preparador Manual Weekly Schedule (Manager fixed recurring targets per Day of Week)

CREATE TABLE IF NOT EXISTS public.prep_manual_schedule (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Lunes, 2=Martes...7=Domingo
    interval_start TIME NOT NULL, -- e.g. '10:00:00', '10:30:00'
    meat_type TEXT NOT NULL,      -- 'ASADA', 'PASTOR', 'POLLO', 'CABEZA', 'LENGUA'
    max_lbs NUMERIC NOT NULL DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(store_id, day_of_week, interval_start, meat_type)
);

CREATE INDEX IF NOT EXISTS idx_prep_manual_schedule_lookup 
ON public.prep_manual_schedule(store_id, day_of_week);
