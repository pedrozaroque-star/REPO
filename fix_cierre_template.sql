-- Final migration for Checklist Cierre (Fixed for BIGINT IDs)
-- This script clears existing questions/sections for 'cierre_v1' and rebuilds them with the correct structure.

DO $$
DECLARE
    t_id BIGINT;
    s_cocina_id BIGINT;
    s_planchas_id BIGINT;
    s_vaporeras_id BIGINT;
    s_piso_id BIGINT;
    s_salon_id BIGINT;
    s_parking_id BIGINT;
BEGIN
    -- 1. Get or Create Template
    SELECT id INTO t_id FROM templates WHERE code = 'cierre_v1';
    
    IF t_id IS NULL THEN
        INSERT INTO templates (code, title, type)
        VALUES ('cierre_v1', 'Checklist de Cierre', 'asistente')
        RETURNING id INTO t_id;
    END IF;

    -- 2. Cleanup existing sections and questions for this template
    DELETE FROM template_questions WHERE section_id IN (SELECT id FROM template_sections WHERE template_id = t_id);
    DELETE FROM template_sections WHERE template_id = t_id;

    -- 3. Create Sections
    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'COCINA', 'blue', 10) RETURNING id INTO s_cocina_id;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'PLANCHAS', 'orange', 20) RETURNING id INTO s_planchas_id;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'VAPORERAS', 'red', 30) RETURNING id INTO s_vaporeras_id;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'PISO', 'green', 40) RETURNING id INTO s_piso_id;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'SALON', 'purple', 50) RETURNING id INTO s_salon_id;

    INSERT INTO template_sections (template_id, title, color_theme, order_index)
    VALUES (t_id, 'PARKING', 'slate', 60) RETURNING id INTO s_parking_id;

    -- 4. Create Questions for COCINA
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_cocina_id, 'Vaporera lavada', 'yes_no', 10),
    (s_cocina_id, 'Olla del champurrado', 'yes_no', 20),
    (s_cocina_id, 'Ollas de los frijoles', 'yes_no', 30),
    (s_cocina_id, 'Refrigerador limpio y acomodado el producto', 'yes_no', 40),
    (s_cocina_id, 'Cocina barrida y trapeada', 'yes_no', 50),
    (s_cocina_id, 'Coladeras limpias y poner cloro', 'yes_no', 60),
    (s_cocina_id, 'charolas rojas limpias y secas', 'yes_no', 70),
    (s_cocina_id, 'Trastes acomodados y limpios', 'yes_no', 80),
    (s_cocina_id, 'Botes de basura vacios y con bolsa', 'yes_no', 90),
    (s_cocina_id, 'Trapeadores lavados y limpios', 'yes_no', 100),
    (s_cocina_id, 'Contenedor de la grasa limpio y tapado', 'yes_no', 110),
    (s_cocina_id, 'Contenedor de basura limpio y tapado', 'yes_no', 120),
    (s_cocina_id, 'Trapos en agua caliente y con jabon (no cloro)', 'yes_no', 130),
    (s_cocina_id, 'Cuarto de descanso limpio (Lockers)', 'yes_no', 140),
    (s_cocina_id, 'Refrigerador de empleados limpio', 'yes_no', 150),
    (s_cocina_id, 'Bote de champurrado limpio', 'yes_no', 160),
    (s_cocina_id, 'Ollas de cafe limpias', 'yes_no', 170),
    (s_cocina_id, 'Productos de limpieza en su lugar asignado', 'yes_no', 180);

    -- 5. Create Questions for PLANCHAS
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_planchas_id, 'Planchas apagadas y lavadas', 'yes_no', 10),
    (s_planchas_id, 'vaporera de tortillas limpia y apagada', 'yes_no', 20),
    (s_planchas_id, 'Filtros en acido y ventana de plastico limpia', 'yes_no', 30),
    (s_planchas_id, 'Contenedores de grasa vacios', 'yes_no', 40),
    (s_planchas_id, 'Refrijerador de planchas limpios', 'yes_no', 50),
    (s_planchas_id, 'Utencilios acomodados en las planchas', 'yes_no', 60),
    (s_planchas_id, 'Charolas de grasa de plachas limpias', 'yes_no', 70),
    (s_planchas_id, 'No trapos y platos debajo de planchas', 'yes_no', 80),
    (s_planchas_id, 'Productos sobrandes cerrados o guardados', 'yes_no', 90);

    -- 6. Create Questions for VAPORERAS
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_vaporeras_id, 'Vaporeras limpias y apagadas', 'yes_no', 10),
    (s_vaporeras_id, 'Trastes acomodados en vaporeras y salsa bar', 'yes_no', 20),
    (s_vaporeras_id, 'Contenedor de basura vacios y con bolsa', 'yes_no', 30),
    (s_vaporeras_id, 'Refrijeradores de salsa Bar limpios y apagados', 'yes_no', 40),
    (s_vaporeras_id, 'Vidrios limpios', 'yes_no', 50);

    -- 7. Create Questions for PISO
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_piso_id, 'Linea barrida y lavada', 'yes_no', 10),
    (s_piso_id, 'Coladeras limpias y poner cloro', 'yes_no', 20);

    -- 8. Create Questions for SALON
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_salon_id, 'Area de cajas limpia', 'yes_no', 10),
    (s_salon_id, 'Basureros limpios', 'yes_no', 20),
    (s_salon_id, 'Baños limpios', 'yes_no', 30),
    (s_salon_id, 'Botes de basura vacios y con bolsa', 'yes_no', 40),
    (s_salon_id, 'Tvs apagada', 'yes_no', 50),
    (s_salon_id, 'Puertas cerradas y confirmadas', 'yes_no', 60),
    (s_salon_id, 'Salon limpio(no charolas y comida en mesas)', 'yes_no', 70),
    (s_salon_id, 'Luces apagadas', 'yes_no', 80);

    -- 9. Create Questions for PARKING
    INSERT INTO template_questions (section_id, text, type, order_index) VALUES
    (s_parking_id, 'Parking barrido', 'yes_no', 10),
    (s_parking_id, 'Candados cerrados', 'yes_no', 20),
    (s_parking_id, 'Contenedores de basura cerrados', 'yes_no', 30),
    (s_parking_id, 'Basura no rebase los contenedores', 'yes_no', 40);

END $$;
