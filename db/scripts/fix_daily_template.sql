-- Migration for Daily Checklist (BIGINT IDs)
-- This script rebuilds 'daily_checklist_v1' with translated categories and questions.

DO $$
DECLARE
    t_id BIGINT;
    s_cocina BIGINT;
    s_comedor BIGINT;
    s_admin BIGINT;
BEGIN
    -- 1. Get or Create Template
    SELECT id INTO t_id FROM templates WHERE code = 'daily_checklist_v1';
    
    IF t_id IS NULL THEN
        INSERT INTO templates (code, title, type)
        VALUES ('daily_checklist_v1', 'Daily Checklist', 'asistente')
        RETURNING id INTO t_id;
    END IF;

    -- 2. Cleanup
    DELETE FROM template_questions WHERE section_id IN (SELECT id FROM template_sections WHERE template_id = t_id);
    DELETE FROM template_sections WHERE template_id = t_id;

    -- 3. Create Sections
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'Área de Cocina y Sección de Línea', 'blue', 10) RETURNING id INTO s_cocina;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'Comedor y Baños de Clientes', 'green', 20) RETURNING id INTO s_comedor;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'Administración y Oficina', 'purple', 30) RETURNING id INTO s_admin;

    -- 4. Questions for Cocina (s_cocina)
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_cocina, 'El equipo alcanza la temperatura adecuada (fría 34°F / caliente 160°F)', 'yes_no', 10),
    (s_cocina, 'Todas las luces funcionan y están en buen estado', 'yes_no', 20),
    (s_cocina, 'Todo el acero inoxidable está limpio y pulido', 'yes_no', 30),
    (s_cocina, 'Cubeta roja de sanitizante bajo la línea a 200ppm', 'yes_no', 40),
    (s_cocina, 'Rebanadoras y tijeras limpias y funcionando', 'yes_no', 50),
    (s_cocina, 'Máquina de hielo limpia (sin moho)', 'yes_no', 60),
    (s_cocina, 'Todos los drenajes limpios y funcionando', 'yes_no', 70),
    (s_cocina, 'Pisos y zócalos limpios', 'yes_no', 80),
    (s_cocina, 'Área del fregadero de trapeadores limpia y organizada', 'yes_no', 90),
    (s_cocina, 'Microondas limpio', 'yes_no', 100),
    (s_cocina, 'Lavado de manos y cambio de guantes frecuente', 'yes_no', 110),
    (s_cocina, 'Área de escobas limpia y organizada (todo a 15cm/6" del suelo)', 'yes_no', 120),
    (s_cocina, 'Estaciones de champurrado limpias y organizadas', 'yes_no', 130),
    (s_cocina, 'Baño de empleados limpio y surtido', 'yes_no', 140),
    (s_cocina, 'Se utiliza el sistema PEPS (FIFO)', 'yes_no', 150),
    (s_cocina, 'Toallas en línea dentro de cubetas de sanitizante', 'yes_no', 160),
    (s_cocina, 'El expedidor dicta las órdenes con claridad', 'yes_no', 170),
    (s_cocina, 'Tanque de gas de sodas al menos a la mitad (si no, avisar al SM)', 'yes_no', 180);

    -- 5. Questions for Comedor (s_comedor)
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_comedor, 'Clientes saludados en menos de 5 segundos', 'yes_no', 10),
    (s_comedor, 'Se hace contacto visual y se interactúa con el cliente', 'yes_no', 20),
    (s_comedor, 'Ventanas limpias (sin manchas) y marcos limpios', 'yes_no', 30),
    (s_comedor, 'Baños surtidos, limpios, sin graffiti y funcionando', 'yes_no', 40),
    (s_comedor, 'Estacionamiento limpio y mantenido', 'yes_no', 50),
    (s_comedor, 'TVs funcionando y rejillas de aire acondicionado limpias', 'yes_no', 60),
    (s_comedor, 'Toda la iluminación funciona (sin focos fundidos)', 'yes_no', 70),
    (s_comedor, 'Mesas, sillas, paredes y pisos limpios y mantenidos', 'yes_no', 80);

    -- 6. Questions for Admin (s_admin)
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_admin, 'Todas las cámaras funcionan', 'yes_no', 10),
    (s_admin, 'Todos tienen su tarjeta de manejador de alimentos vigente y en archivo', 'yes_no', 20),
    (s_admin, 'Se están utilizando los checklists', 'yes_no', 30),
    (s_admin, 'Gerencia conoce ventas, labor y proyecciones de la semana', 'yes_no', 40),
    (s_admin, 'Tiempo de servicio (SOS) 5 min o menos - DT 3:30 o menos', 'yes_no', 50),
    (s_admin, 'Se siguen procedimientos de manejo de efectivo / no hay efectivo expuesto', 'yes_no', 60),
    (s_admin, 'Reparaciones reportadas a Basecamp y al DM', 'yes_no', 70),
    (s_admin, 'Tanque de CO2 de soda a 1/4 o menos, avisar al gerente', 'yes_no', 80);

END $$;
