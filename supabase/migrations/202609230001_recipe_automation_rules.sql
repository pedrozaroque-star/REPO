-- Reglas variables de consumo para recetas Toast.
-- Complementan recipes (ingredientes fijos) sin mezclar estimaciones con cantidades estáticas.
CREATE TABLE IF NOT EXISTS public.recipe_automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    toast_menu_item_guid TEXT NOT NULL REFERENCES public.toast_menu_items(guid) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('historical_allocation', 'special_request_protein_mix')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (toast_menu_item_guid, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_recipe_automation_rules_menu_item
    ON public.recipe_automation_rules (toast_menu_item_guid);

ALTER TABLE public.recipe_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_automation_rules_authenticated_read"
    ON public.recipe_automation_rules FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "recipe_automation_rules_service_role_write"
    ON public.recipe_automation_rules FOR ALL TO service_role
    USING (true) WITH CHECK (true);

COMMENT ON TABLE public.recipe_automation_rules IS
    'Reglas editables para asignar consumos variables de recetas Toast, como sabores de agua/salsa y mezclas de carne.';
