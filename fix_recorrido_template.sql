-- Migration for Checklist Recorrido (BIGINT IDs)
-- This script rebuilds 'recorrido_v1' with the correct category structure: Tareas Generales and Horario de Limpieza.

DO $$
DECLARE
    t_id BIGINT;
    s_tareas BIGINT;
    s_horario BIGINT;
BEGIN
    -- 1. Get or Create Template
    SELECT id INTO t_id FROM templates WHERE code = 'recorrido_v1';
    
    IF t_id IS NULL THEN
        INSERT INTO templates (code, title, type)
        VALUES ('recorrido_v1', 'Recorrido de Limpieza', 'asistente')
        RETURNING id INTO t_id;
    END IF;

    -- 2. Cleanup
    DELETE FROM template_questions WHERE section_id IN (SELECT id FROM template_sections WHERE template_id = t_id);
    DELETE FROM template_sections WHERE template_id = t_id;

    -- 3. Create Sections
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'TAREAS GENERALES', 'green', 10) RETURNING id INTO s_tareas;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'HORARIO DE LIMPIEZA (BAÑOS/PARKING)', 'blue', 20) RETURNING id INTO s_horario;

    -- 4. Create Questions for TAREAS GENERALES
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_tareas, 'QUITAR PUBLICIDAD / REMOVE PUBLICITY', 'yes_no', 10),
    (s_tareas, 'BARRER PARKING', 'yes_no', 20),
    (s_tareas, 'BARRER Y TRAPEAR LAS COCINAS / KITCHENS MOP AND SWEEP', 'yes_no', 30),
    (s_tareas, 'CAMBIAR LAS BOLSAS DE BASURA / CHANGE GARBAGE BAGS', 'yes_no', 40),
    (s_tareas, 'LIMPIEZA DE BAÑOS / CLEANING BATHROOM', 'yes_no', 50);

    -- 5. Create Questions for HORARIO DE LIMPIEZA
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_horario, '8AM -- 9AM', 'yes_no', 10),
    (s_horario, '1PM -- 2PM', 'yes_no', 20),
    (s_horario, '3PM -- 4PM', 'yes_no', 30),
    (s_horario, '6PM -- 7PM', 'yes_no', 40),
    (s_horario, '10PM -- 11PM', 'yes_no', 50),
    (s_horario, '1AM -- 2AM', 'yes_no', 60),
    (s_horario, '3AM -- 4AM', 'yes_no', 70);

END $$;
