-- Migration for Checklist Temperaturas (BIGINT IDs)
-- This script rebuilds 'temperaturas_v1' with the correct category structure.

DO $$
DECLARE
    t_id BIGINT;
    s_ref1 BIGINT;
    s_ref2 BIGINT;
    s_ref3 BIGINT;
    s_ref4 BIGINT;
    s_ref5 BIGINT;
    s_walking BIGINT;
    s_vap1 BIGINT;
    s_vap2 BIGINT;
    s_vap3 BIGINT;
    s_vap4 BIGINT;
    s_vap5 BIGINT;
    s_vap6 BIGINT;
    s_vap7 BIGINT;
BEGIN
    -- 1. Get or Create Template
    SELECT id INTO t_id FROM templates WHERE code = 'temperaturas_v1';
    
    IF t_id IS NULL THEN
        INSERT INTO templates (code, title, type)
        VALUES ('temperaturas_v1', 'Control de Temperaturas', 'asistente')
        RETURNING id INTO t_id;
    END IF;

    -- 2. Cleanup
    DELETE FROM template_questions WHERE section_id IN (SELECT id FROM template_sections WHERE template_id = t_id);
    DELETE FROM template_sections WHERE template_id = t_id;

    -- 3. Create Sections (Refrigeradores)
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'REFRIGERADOR 1', 'blue', 10) RETURNING id INTO s_ref1;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'REFRIGERADOR 2', 'blue', 20) RETURNING id INTO s_ref2;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'REFRIGERADOR 3', 'blue', 30) RETURNING id INTO s_ref3;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'REFRIGERADOR 4', 'blue', 40) RETURNING id INTO s_ref4;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'REFRIGERADOR 5', 'blue', 50) RETURNING id INTO s_ref5;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'WALKING', 'blue', 60) RETURNING id INTO s_walking;

    -- 4. Create Sections (Vaporeras)
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 1', 'orange', 70) RETURNING id INTO s_vap1;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 2', 'orange', 80) RETURNING id INTO s_vap2;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 3', 'orange', 90) RETURNING id INTO s_vap3;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 4', 'orange', 100) RETURNING id INTO s_vap4;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 5', 'orange', 110) RETURNING id INTO s_vap5;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 6', 'orange', 120) RETURNING id INTO s_vap6;
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERA 7', 'orange', 130) RETURNING id INTO s_vap7;

    -- 5. Insert Questions (Refrigeradores)
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_ref1, 'PAPELITOS NO MAYO', 'number', 10),
    (s_ref1, 'QUESADILLAS, JAMON, SALCHICHA', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_ref2, 'CARNES PARA COCINAR', 'number', 10),
    (s_ref2, 'ASADA, POLLO, PASTOR', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_ref3, 'QUESO MONTERREY, TOMATE', 'number', 10),
    (s_ref3, 'QUESO COTIJA, MIXTA', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_ref4, 'SALSA ROJA, VERDE Y MIXTA', 'number', 10),
    (s_ref4, 'LECHUGA, LIMONES', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_ref5, 'SALSA ROJA, VERDE Y MIXTA', 'number', 10),
    (s_ref5, 'LECHUGA, LIMONES', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_walking, 'REFRIGERADOR WALKING', 'number', 10);

    -- 6. Insert Questions (Vaporeras)
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap1, 'CABEZA', 'number', 10),
    (s_vap1, 'LENGUA', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap2, 'ASADA', 'number', 10),
    (s_vap2, 'PASTOR', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap3, 'CHORIZO', 'number', 10),
    (s_vap3, 'SALSA HUEVO RANCHERO', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap4, 'POLLO', 'number', 10),
    (s_vap4, 'BUCHE, CARNITAS', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap5, 'ARROZ', 'number', 10),
    (s_vap5, 'FRIJOL MOLIDO', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap6, 'ASADA', 'number', 10),
    (s_vap6, 'PASTOR', 'number', 20);

    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vap7, 'CHILE ASADO', 'number', 10),
    (s_vap7, 'FRIJO ENTERO', 'number', 20);

END $$;
