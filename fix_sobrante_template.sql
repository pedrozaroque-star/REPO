-- Migration for Checklist Sobrante (BIGINT IDs)
-- This script clears existing questions/sections for 'sobrante_v1' and rebuilds them with the correct structure.

DO $$
DECLARE
    t_id BIGINT;
    s_id BIGINT;
BEGIN
    -- 1. Get or Create Template
    SELECT id INTO t_id FROM templates WHERE code = 'sobrante_v1';
    
    IF t_id IS NULL THEN
        INSERT INTO templates (code, title, type)
        VALUES ('sobrante_v1', 'Reporte de Sobrante', 'asistente')
        RETURNING id INTO t_id;
    END IF;

    -- 2. Cleanup existing sections and questions for this template
    DELETE FROM template_questions WHERE section_id IN (SELECT id FROM template_sections WHERE template_id = t_id);
    DELETE FROM template_sections WHERE template_id = t_id;

    -- 3. Create Section
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'SOBRANTES', 'orange', 10) RETURNING id INTO s_id;

    -- 4. Create Questions (Using 'number' type for quantities)
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_id, 'ARROZ', 'number', 10),
    (s_id, 'FRIJOL', 'number', 20),
    (s_id, 'ASADA', 'number', 30),
    (s_id, 'PASTOR', 'number', 40),
    (s_id, 'POLLO', 'number', 50),
    (s_id, 'CARNITAS', 'number', 60),
    (s_id, 'BUCHE', 'number', 70),
    (s_id, 'CHORIZO', 'number', 80),
    (s_id, 'CABEZA', 'number', 90),
    (s_id, 'LENGUA', 'number', 100),
    (s_id, 'FRIJOLES OLLA', 'number', 110);

END $$;
