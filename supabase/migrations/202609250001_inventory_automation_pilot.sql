-- Piloto controlado de automatizacion de Orden Diaria (Lynwood y Slauson).
-- El conteo fisico sigue siendo oficial; la estimacion automatica es shadow-only.

CREATE TABLE IF NOT EXISTS public.inventory_automation_pilot_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id BIGINT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'daily' CHECK (order_type IN ('daily')),
    status TEXT NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'revealed')),
    model_version TEXT NOT NULL DEFAULT 'shadow-v1',
    completed_by_user_id TEXT,
    completed_by_name TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, business_date, order_type)
);

CREATE TABLE IF NOT EXISTS public.inventory_automation_pilot_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.inventory_automation_pilot_sessions(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    physical_leftover NUMERIC(12,4) NOT NULL CHECK (physical_leftover >= 0),
    automatic_leftover NUMERIC(12,4),
    variance NUMERIC(12,4),
    tolerance_value NUMERIC(12,4),
    within_tolerance BOOLEAN,
    par_value NUMERIC(12,4) NOT NULL DEFAULT 0,
    automatic_order_qty NUMERIC(12,4),
    official_order_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_pilot_sessions_store_date
    ON public.inventory_automation_pilot_sessions(store_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_pilot_lines_session
    ON public.inventory_automation_pilot_lines(session_id);

ALTER TABLE public.inventory_automation_pilot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_automation_pilot_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory pilot authenticated read sessions" ON public.inventory_automation_pilot_sessions;
CREATE POLICY "inventory pilot authenticated read sessions"
    ON public.inventory_automation_pilot_sessions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory pilot authenticated read lines" ON public.inventory_automation_pilot_lines;
CREATE POLICY "inventory pilot authenticated read lines"
    ON public.inventory_automation_pilot_lines FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory pilot service sessions" ON public.inventory_automation_pilot_sessions;
CREATE POLICY "inventory pilot service sessions"
    ON public.inventory_automation_pilot_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "inventory pilot service lines" ON public.inventory_automation_pilot_lines;
CREATE POLICY "inventory pilot service lines"
    ON public.inventory_automation_pilot_lines FOR ALL TO service_role USING (true) WITH CHECK (true);
