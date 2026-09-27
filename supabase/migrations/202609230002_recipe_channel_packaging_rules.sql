-- Extiende reglas variables para empaques dependientes del canal de venta.
ALTER TABLE public.recipe_automation_rules
    DROP CONSTRAINT IF EXISTS recipe_automation_rules_rule_type_check;

ALTER TABLE public.recipe_automation_rules
    ADD CONSTRAINT recipe_automation_rules_rule_type_check
    CHECK (rule_type IN ('historical_allocation', 'special_request_protein_mix', 'channel_packaging'));

COMMENT ON CONSTRAINT recipe_automation_rules_rule_type_check ON public.recipe_automation_rules IS
    'Tipos soportados: asignación histórica, mezcla de proteína por special request y empaque por canal.';
