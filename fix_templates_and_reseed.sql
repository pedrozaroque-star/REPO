
-- SCRIPT DE LIMPIEZA TOTAL Y CORRECCIÓN (Versión Nuclear)
-- Este script BORRA TODAS LAS PLANTILLAS para arreglar el problema de "8 rows returned".
-- Luego regenera todo limpio y bloquea que vuelva a pasar.

DO $$
BEGIN
  -- 1. LIMPIEZA PROFUNDA (Orden Correcto para evitar Foreign Key errors)
  -- Borramos preguntas, luego secciones, luego templates
  DELETE FROM template_questions;
  DELETE FROM template_sections;
  DELETE FROM templates;

  -- 2. ASEGURAR UNICIDAD (Para que nunca vuelva a pasar)
  -- Si ya existe la restricción, esto fallará pero no importa, el goal es que exista.
  BEGIN
    ALTER TABLE templates ADD CONSTRAINT unique_template_code UNIQUE (code);
  EXCEPTION
    WHEN duplicate_table THEN 
    -- Si falla porque la constraint ya existe, no hacemos nada
    RAISE NOTICE 'La restricción unique_template_code ya existía.';
    WHEN OTHERS THEN
    RAISE NOTICE 'Nota sobre constraint: %', SQLERRM;
  END;

  RAISE NOTICE 'Tablas limpiadas y aseguradas. Ahora reinsertando datos...';
END $$;

-- 3. REINSERCIÓN DE DATOS (Copia idéntica de tu seed_data.sql pero garantizada de correr en limpio)

DO $$
DECLARE
  v_template_id BIGINT;
  v_section_id BIGINT;
BEGIN

  --------------------------------------------------------------------------------
  -- 1. APERTURA (13 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('apertura_v1', 'Inspección de Apertura', 'standard', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Lista de Verificación', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Desarmar alarma y validar que estaba activada', 'yes_no', 0),
  (v_section_id, 'Encendido de vaporeras', 'yes_no', 1),
  (v_section_id, 'Encendido de refrigeradores', 'yes_no', 2),
  (v_section_id, 'Encendido de planchas', 'yes_no', 3),
  (v_section_id, 'Encendido de luces en linea y salon', 'yes_no', 4),
  (v_section_id, 'Encendido de pantallas y TVs', 'yes_no', 5),
  (v_section_id, 'Revision de baños, salon y parking', 'yes_no', 6),
  (v_section_id, 'Recepcion de mercancias adecuado', 'yes_no', 7),
  (v_section_id, 'Ordenar todas las mercancias en su lugar correspondiente', 'yes_no', 8),
  (v_section_id, 'Limpieza de Walking', 'yes_no', 9),
  (v_section_id, 'Apertura de Restaurante en tiempo', 'yes_no', 10),
  (v_section_id, 'linea de produccion abastecida', 'yes_no', 11),
  (v_section_id, 'Apertura correcta de las cajas', 'yes_no', 12);

  --------------------------------------------------------------------------------
  -- 2. CIERRE (46 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('cierre_v1', 'Inspección de Cierre', 'standard', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Lista de Verificación', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Vaporera lavada', 'yes_no', 0),
  (v_section_id, 'Olla del champurrado', 'yes_no', 1),
  (v_section_id, 'Ollas de los frijoles', 'yes_no', 2),
  (v_section_id, 'Refrigerador limpio y acomodado el producto', 'yes_no', 3),
  (v_section_id, 'Cocina barrida y trapeada', 'yes_no', 4),
  (v_section_id, 'Coladeras limpias y poner cloro', 'yes_no', 5),
  (v_section_id, 'Charolas rojas limpias y secas', 'yes_no', 6),
  (v_section_id, 'Trastes acomodados y limpios', 'yes_no', 7),
  (v_section_id, 'Botes de basura vacios y con bolsa', 'yes_no', 8),
  (v_section_id, 'Trapeadores lavados y limpios', 'yes_no', 9),
  (v_section_id, 'Contenedor de la grasa limpio y tapado', 'yes_no', 10),
  (v_section_id, 'Contenedor de basura limpio y tapado', 'yes_no', 11),
  (v_section_id, 'Trapos en agua caliente y con jabon (no cloro)', 'yes_no', 12),
  (v_section_id, 'Cuarto de descanso limpio (Lockers)', 'yes_no', 13),
  (v_section_id, 'Refrigerador de empleados limpio', 'yes_no', 14),
  (v_section_id, 'Bote de champurrado limpio', 'yes_no', 15),
  (v_section_id, 'Ollas de cafe limpias', 'yes_no', 16),
  (v_section_id, 'Productos de limpieza en su lugar asignado', 'yes_no', 17),
  (v_section_id, 'Planchas apagadas y lavadas', 'yes_no', 18),
  (v_section_id, 'Vaporera de tortillas limpia y apagada', 'yes_no', 19),
  (v_section_id, 'Filtros en acido y ventana de plastico limpia', 'yes_no', 20),
  (v_section_id, 'Contenedores de grasa vacios', 'yes_no', 21),
  (v_section_id, 'Refrijerador de planchas limpios', 'yes_no', 22),
  (v_section_id, 'Utencilios acomodados en las planchas', 'yes_no', 23),
  (v_section_id, 'Charolas de grasa de plachas limpias', 'yes_no', 24),
  (v_section_id, 'No trapos y platos debajo de planchas', 'yes_no', 25),
  (v_section_id, 'Productos sobrandes cerrados o guardados', 'yes_no', 26),
  (v_section_id, 'Vaporeras limpias y apagadas', 'yes_no', 27),
  (v_section_id, 'Trastes acomodados en vaporeras y salsa bar', 'yes_no', 28),
  (v_section_id, 'Contenedor de basura vacios y con bolsa (Vaporeras)', 'yes_no', 29),
  (v_section_id, 'Refrijeradores de salsa Bar limpios y apagados', 'yes_no', 30),
  (v_section_id, 'Vidrios limpios', 'yes_no', 31),
  (v_section_id, 'Linea barrida y lavada', 'yes_no', 32),
  (v_section_id, 'Coladeras limpias y poner cloro (Piso)', 'yes_no', 33),
  (v_section_id, 'Area de cajas limpia', 'yes_no', 34),
  (v_section_id, 'Basureros limpios', 'yes_no', 35),
  (v_section_id, 'Baños limpios', 'yes_no', 36),
  (v_section_id, 'Botes de basura vacios y con bolsa (Salon)', 'yes_no', 37),
  (v_section_id, 'Tvs apagada', 'yes_no', 38),
  (v_section_id, 'Puertas cerradas y confirmadas', 'yes_no', 39),
  (v_section_id, 'Salon limpio (no charolas y comida en mesas)', 'yes_no', 40),
  (v_section_id, 'Luces apagadas', 'yes_no', 41),
  (v_section_id, 'Parking barrido', 'yes_no', 42),
  (v_section_id, 'Candados cerrados', 'yes_no', 43),
  (v_section_id, 'Contenedores de basura cerrados', 'yes_no', 44),
  (v_section_id, 'Basura no rebase los contenedores', 'yes_no', 45);


  --------------------------------------------------------------------------------
  -- 3. DAILY (34 Preguntas) - AQUÍ ESTABA EL PROBLEMA ORIGINAL
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('daily_checklist_v1', 'Daily Checklist', 'standard', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Tareas Diarias', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Todo el equipo alcanza la temperatura adecuada', 'yes_no', 0),
  (v_section_id, 'Cubeta roja de sanitizante bajo línea @ 200ppm', 'yes_no', 1),
  (v_section_id, 'Máquina de hielo limpia', 'yes_no', 2),
  (v_section_id, 'Área del trapeador limpia', 'yes_no', 3),
  (v_section_id, 'Microondas está limpio', 'yes_no', 4),
  (v_section_id, 'Estaciones de champurrado limpias', 'yes_no', 5),
  (v_section_id, 'Baño de empleados limpio', 'yes_no', 6),
  (v_section_id, 'Tanque de gas de refrescos lleno', 'yes_no', 7),
  (v_section_id, 'Checklists siendo usados', 'yes_no', 8),
  (v_section_id, 'Food Handler visible', 'yes_no', 9),
  (v_section_id, 'Se saluda a clientes dentro de 5 segundos', 'yes_no', 10),
  (v_section_id, 'Hacemos contacto visual con el cliente', 'yes_no', 11),
  (v_section_id, 'Ventanas limpias', 'yes_no', 12),
  (v_section_id, 'Baños limpios', 'yes_no', 13),
  (v_section_id, 'Estacionamiento limpio', 'yes_no', 14),
  (v_section_id, 'TVs funcionando', 'yes_no', 15),
  (v_section_id, 'Toda la iluminación funciona', 'yes_no', 16),
  (v_section_id, 'Mesas y sillas limpias', 'yes_no', 17),
  (v_section_id, 'Todas las luces funcionan', 'yes_no', 18),
  (v_section_id, 'Acero inoxidable limpio', 'yes_no', 19),
  (v_section_id, 'Rebanadoras y tijeras limpias', 'yes_no', 20),
  (v_section_id, 'Drenajes limpios', 'yes_no', 21),
  (v_section_id, 'Pisos y zócalos limpios', 'yes_no', 22),
  (v_section_id, 'Lavado de manos frecuente', 'yes_no', 23),
  (v_section_id, 'Área de escoba organizada', 'yes_no', 24),
  (v_section_id, 'Se utiliza FIFO', 'yes_no', 25),
  (v_section_id, 'Trapos en sanitizante', 'yes_no', 26),
  (v_section_id, 'Expedidor anuncia órdenes', 'yes_no', 27),
  (v_section_id, 'Cámaras funcionando', 'yes_no', 28),
  (v_section_id, 'SOS/DT Time visible', 'yes_no', 29),
  (v_section_id, 'Management consciente', 'yes_no', 30),
  (v_section_id, 'Manejo de efectivo correcto', 'yes_no', 31),
  (v_section_id, 'Reparaciones reportadas', 'yes_no', 32),
  (v_section_id, 'AC limpio', 'yes_no', 33);

  --------------------------------------------------------------------------------
  -- 4. RECORRIDO (13 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('recorrido_v1', 'Recorrido de Limpieza', 'standard', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Puntos de Recorrido', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Quitar publicidad y promociones vencidas', 'yes_no', 0),
  (v_section_id, 'Barrer todas las áreas', 'yes_no', 1),
  (v_section_id, 'Barrer y trapear cocinas', 'yes_no', 2),
  (v_section_id, 'Cambiar bolsas de basura', 'yes_no', 3),
  (v_section_id, 'Limpieza de baños', 'yes_no', 4),
  (v_section_id, 'Limpiar ventanas y puertas', 'yes_no', 5),
  (v_section_id, 'Limpiar mesas y sillas', 'yes_no', 6),
  (v_section_id, 'Organizar área de basura', 'yes_no', 7),
  (v_section_id, 'Limpiar refrigeradores', 'yes_no', 8),
  (v_section_id, 'Limpiar estufas y planchas', 'yes_no', 9),
  (v_section_id, 'Limpiar campanas', 'yes_no', 10),
  (v_section_id, 'Revisar inventario de limpieza', 'yes_no', 11),
  (v_section_id, 'Reportar reparaciones necesarias', 'yes_no', 12);

  --------------------------------------------------------------------------------
  -- 5. SOBRANTE (11 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('sobrante_v1', 'Producto Sobrante', 'standard', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Productos a Contar', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Arroz (Lbs)', 'number', 0),
  (v_section_id, 'Frijol (Lbs)', 'number', 1),
  (v_section_id, 'Asada (Lbs)', 'number', 2),
  (v_section_id, 'Pastor (Lbs)', 'number', 3),
  (v_section_id, 'Pollo (Lbs)', 'number', 4),
  (v_section_id, 'Carnitas (Lbs)', 'number', 5),
  (v_section_id, 'Buche (Lbs)', 'number', 6),
  (v_section_id, 'Chorizo (Lbs)', 'number', 7),
  (v_section_id, 'Cabeza (Lbs)', 'number', 8),
  (v_section_id, 'Lengua (Lbs)', 'number', 9),
  (v_section_id, 'Frijoles de olla (Lbs)', 'number', 10);

  --------------------------------------------------------------------------------
  -- 6. TEMPERATURAS (21 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('temperaturas_v1', 'Control de Temperaturas', 'standard', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Equipos y Alimentos', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Refrig 1 - Papelitos con mayo', 'yes_no', 0),
  (v_section_id, 'Refrig 1 - Papelitos sin mayo', 'yes_no', 1),
  (v_section_id, 'Refrig 1 - Quesadillas', 'yes_no', 2),
  (v_section_id, 'Refrig 2 - Carnes para cocinar', 'yes_no', 3),
  (v_section_id, 'Refrig 2 - Asada y pollo', 'yes_no', 4),
  (v_section_id, 'Refrig 3 - Queso monterrey', 'yes_no', 5),
  (v_section_id, 'Refrig 3 - Queso cotija', 'yes_no', 6),
  (v_section_id, 'Refrig 4 - Salsas', 'yes_no', 7),
  (v_section_id, 'Refrig 4 - Lechuga', 'yes_no', 8),
  (v_section_id, 'Vapor 1 - Cabeza', 'yes_no', 9),
  (v_section_id, 'Vapor 1 - Lengua', 'yes_no', 10),
  (v_section_id, 'Vapor 2 - Asada', 'yes_no', 11),
  (v_section_id, 'Vapor 2 - Pastor', 'yes_no', 12),
  (v_section_id, 'Vapor 3 - Chorizo', 'yes_no', 13),
  (v_section_id, 'Vapor 3 - Salsa de huevo', 'yes_no', 14),
  (v_section_id, 'Vapor 4 - Pollo', 'yes_no', 15),
  (v_section_id, 'Vapor 4 - Buche', 'yes_no', 16),
  (v_section_id, 'Vapor 5 - Arroz', 'yes_no', 17),
  (v_section_id, 'Vapor 5 - Frijol', 'yes_no', 18),
  (v_section_id, 'Vapor 7 - Chile asado', 'yes_no', 19),
  (v_section_id, 'Vapor 7 - Frijol entero', 'yes_no', 20);

  --------------------------------------------------------------------------------
  -- 7. MANAGER CHECKLIST (54 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('manager_checklist_v1', 'Manager Daily Checklist', 'standard', true)
  RETURNING id INTO v_template_id;

  -- 7.1 SECCIÓN 0: Cocina y Línea de Preparación
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Cocina y Línea de Preparación', 'standard', 0)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'No hay basura ni aceite debajo de las parrillas y equipos', 'yes_no', 0),
  (v_section_id, 'Todos los productos están a la temperatura adecuada', 'yes_no', 1),
  (v_section_id, 'Los protectores contra estornudos están limpios (huellas, etc.)', 'yes_no', 2),
  (v_section_id, 'Todo el acero inoxidable está limpio y pulido', 'yes_no', 3),
  (v_section_id, 'Todas las campanas están limpias y en buen estado', 'yes_no', 4),
  (v_section_id, 'Las parrillas están limpias (paneles laterales sin acumulación)', 'yes_no', 5),
  (v_section_id, 'Todos los botes de basura están limpios (por dentro y por fuera)', 'yes_no', 6),
  (v_section_id, 'Las paredes y todas las puertas están limpias', 'yes_no', 7),
  (v_section_id, 'La máquina de queso para nachos está limpia', 'yes_no', 8),
  (v_section_id, 'La comida está fresca y se ve apetitosa para el cliente', 'yes_no', 9),
  (v_section_id, 'Se usan cubetas a 200ppm; los trapos no están sobre la línea', 'yes_no', 10),
  (v_section_id, 'Paredes, pisos y zócalos del Walk-in están limpios y barridos', 'yes_no', 11),
  (v_section_id, 'Todos los artículos están a 6" del suelo (cajas, trapeadores, etc.)', 'yes_no', 12),
  (v_section_id, 'Las estaciones de preparación están limpias y sanitizadas', 'yes_no', 13),
  (v_section_id, 'Todo el equipo está en funcionamiento', 'yes_no', 14),
  (v_section_id, 'La entrega (delivery) está guardada y organizada', 'yes_no', 15),
  (v_section_id, 'Toda la iluminación y ventilación funcionan y están limpias', 'yes_no', 16),
  (v_section_id, 'Los empaques (gaskets) están limpios y no rotos', 'yes_no', 17),
  (v_section_id, 'Las boquillas de refresco están limpias (sin moho)', 'yes_no', 18),
  (v_section_id, 'La máquina de hielo está libre de moho y limpia', 'yes_no', 19),
  (v_section_id, 'Tijeras/Tomate/Lima limpios y funcionando', 'yes_no', 20),
  (v_section_id, 'Todos los drenajes están limpios', 'yes_no', 21),
  (v_section_id, 'El baño de empleados está limpio y surtido', 'yes_no', 22),
  (v_section_id, 'Todas las bolsas abiertas están almacenadas correctamente', 'yes_no', 23);

  -- 7.2 SECCIÓN 1: Comedor y Áreas de Clientes
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Comedor y Áreas de Clientes', 'standard', 1)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Limpiar/sacudir muebles, TVs, etc.', 'yes_no', 0),
  (v_section_id, 'Las ventanas y marcos de ventanas están limpios', 'yes_no', 1),
  (v_section_id, 'Los baños están limpios y en funcionamiento', 'yes_no', 2),
  (v_section_id, 'Saludo de 5 segundos y venta sugestiva (bienvenida a clientes)', 'yes_no', 3),
  (v_section_id, 'Música y Aire Acondicionado a nivel apropiado', 'yes_no', 4),
  (v_section_id, 'El comedor está limpio / Estacionamiento', 'yes_no', 5),
  (v_section_id, 'Paredes y estaciones de bebida están limpias', 'yes_no', 6),
  (v_section_id, 'Ventilas y plafones del techo están limpios y en buen estado', 'yes_no', 7),
  (v_section_id, 'Los uniformes están limpios y sin manchas', 'yes_no', 8),
  (v_section_id, 'Los tableros de menú (Menuboards) funcionan', 'yes_no', 9),
  (v_section_id, 'El área de botes de basura está limpia', 'yes_no', 10),
  (v_section_id, 'Visitas a mesas en el comedor (Table touching)', 'yes_no', 11),
  (v_section_id, 'Estacionamiento y botes de basura limpios', 'yes_no', 12),
  (v_section_id, 'Puertas de entrada limpias (sin manchas)', 'yes_no', 13);
  
  -- 7.3 SECCIÓN 2: Checklist y Reportes
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Checklist y Reportes', 'standard', 2)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Tarjetas de manejo de alimentos (Food handlers) en archivo', 'yes_no', 0),
  (v_section_id, '¿La tienda tiene personal completo?', 'yes_no', 1),
  (v_section_id, '¿Cuál es el % de labor de la semana?', 'yes_no', 2),
  (v_section_id, '¿Cuántos asistentes? Shift leaders', 'yes_no', 3),
  (v_section_id, '¿Se están utilizando todos los checklists? Completos', 'yes_no', 4),
  (v_section_id, 'Horario publicado y fácil de leer', 'yes_no', 5),
  (v_section_id, '¿Los managers conocen los errores de reloj checador? (Ronos/Toast)', 'yes_no', 6),
  (v_section_id, 'Planes de acción vigentes para miembros del equipo (QUIÉN)', 'yes_no', 7),
  (v_section_id, '¿Las ventas han subido respecto a semanas anteriores?', 'yes_no', 8),
  (v_section_id, '¿Todos tienen al menos un día libre?', 'yes_no', 9),
  (v_section_id, '¿Todos están entrenados en los nuevos procesos?', 'yes_no', 10),
  (v_section_id, '¿Se han reportado todas las reparaciones en Basecamp?', 'yes_no', 11),
  (v_section_id, 'Se siguen los procedimientos de manejo de efectivo', 'yes_no', 12);

  -- 7.4 SECCIÓN 3: Adicional
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Adicional', 'standard', 3)
  RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Se toma la temperatura de cada empleado en turno', 'yes_no', 0),
  (v_section_id, 'Cualquier problema de empleado reportado al DM', 'yes_no', 1),
  (v_section_id, 'Soda CO2 está a 1/4 o menos, avisar al manager', 'yes_no', 2);

  --------------------------------------------------------------------------------
  -- 8. SUPERVISOR (25 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('supervisor_inspection_v1', 'Inspección de Supervisor', 'inspection', true)
  RETURNING id INTO v_template_id;

  -- 8.1 Servicio
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Servicio al Cliente', 'blue', 0) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Saluda y despide cordialmente', 'score_100', 0),
  (v_section_id, 'Atiende con paciencia y respeto', 'score_100', 1),
  (v_section_id, 'Entrega órdenes con frase de cierre', 'score_100', 2),
  (v_section_id, 'Evita charlas personales en línea', 'score_100', 3);

  -- 8.2 Carnes
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Procedimiento de Carnes', 'red', 1) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Controla temperatura (450°/300°) y tiempos', 'score_100', 0),
  (v_section_id, 'Utensilios limpios, no golpear espátulas', 'score_100', 1),
  (v_section_id, 'Escurre carnes y rota producto (FIFO)', 'score_100', 2),
  (v_section_id, 'Vigila cebolla asada y porciones', 'score_100', 3);

  -- 8.3 Alimentos
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Preparación de Alimentos', 'orange', 2) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Respeta porciones estándar (cucharas)', 'score_100', 0),
  (v_section_id, 'Quesadillas bien calientes, sin quemar', 'score_100', 1),
  (v_section_id, 'Burritos bien enrollados, sin dorar de más', 'score_100', 2),
  (v_section_id, 'Stickers correctos donde aplica', 'score_100', 3);

  -- 8.4 Tortillas
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Seguimiento a Tortillas', 'yellow', 3) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Tortillas bien calientes (aceite solo en orillas)', 'score_100', 0),
  (v_section_id, 'Máx 5 tacos por plato (presentación)', 'score_100', 1),
  (v_section_id, 'Reponer a tiempo y mantener frescura', 'score_100', 2);

  -- 8.5 Limpieza
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Limpieza General y Baños', 'green', 4) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Cubetas rojas con sanitizer tibio', 'score_100', 0),
  (v_section_id, 'Plancha limpia y sin residuos', 'score_100', 1),
  (v_section_id, 'Baños con insumos completos y sin olores', 'score_100', 2),
  (v_section_id, 'Exterior y basureros limpios', 'score_100', 3);

  -- 8.6 Bitácoras
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Checklists y Bitácoras', 'purple', 5) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Checklist apertura/cierre completo', 'score_100', 0),
  (v_section_id, 'Bitácora de temperaturas al día', 'score_100', 1),
  (v_section_id, 'Registros de limpieza firmados', 'score_100', 2);

  -- 8.7 Aseo Personal
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Aseo Personal', 'cyan', 6) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Uniforme limpio y completo', 'score_100', 0),
  (v_section_id, 'Uñas cortas, sin joyas/auriculares', 'score_100', 1),
  (v_section_id, 'Uso correcto de gorra y guantes', 'score_100', 2);


  --------------------------------------------------------------------------------
  -- 9. FEEDBACK (5 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('public_feedback_v1', 'Feedback Público Clientes', 'feedback', true)
  RETURNING id INTO v_template_id;

  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Encuesta General', 'standard', 0) RETURNING id INTO v_section_id;

  INSERT INTO template_questions (section_id, text, type, order_index) VALUES 
  (v_section_id, 'Atención en caja', 'rating_5', 0),
  (v_section_id, 'Tiempo de entrega', 'rating_5', 1),
  (v_section_id, 'Calidad de alimentos', 'rating_5', 2),
  (v_section_id, 'Limpieza del local', 'rating_5', 3),
  (v_section_id, '¿Nos recomendarías? (NPS)', 'nps_10', 4);
  
  --------------------------------------------------------------------------------
  -- 10. EVALUACION STAFF (25 Preguntas)
  --------------------------------------------------------------------------------
  INSERT INTO templates (code, title, type, active)
  VALUES ('staff_evaluation_v1', 'Evaluación de Personal', 'evaluation', true)
  RETURNING id INTO v_template_id;
  
  -- S1: Trabajo en equipo
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Trabajo en equipo', 'standard', 0) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES
  (v_section_id, '¿Se comunica de manera clara?', 'rating_5', 0),
  (v_section_id, '¿Escucha a los demás?', 'rating_5', 1),
  (v_section_id, '¿Apoya cuando está ocupado?', 'rating_5', 2),
  (v_section_id, '¿Fomenta ambiente positivo?', 'rating_5', 3),
  (v_section_id, '¿Resuelve conflictos? (Líder)', 'rating_5', 4);

  -- S2: Liderazgo
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Liderazgo', 'standard', 1) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES
  (v_section_id, '¿Motiva al equipo?', 'rating_5', 0),
  (v_section_id, '¿Da feedback constructivo?', 'rating_5', 1),
  (v_section_id, '¿Es justo asignando tareas?', 'rating_5', 2),
  (v_section_id, '¿Apoya en dificultades?', 'rating_5', 3),
  (v_section_id, '¿Es ejemplo a seguir?', 'rating_5', 4);
  
  -- S3: Desempeño
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Desempeño', 'standard', 2) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES
  (v_section_id, '¿Cumple sin supervisión?', 'rating_5', 0),
  (v_section_id, '¿Mantiene limpieza?', 'rating_5', 1),
  (v_section_id, '¿Sigue procedimientos?', 'rating_5', 2),
  (v_section_id, '¿Rápido y preciso?', 'rating_5', 3),
  (v_section_id, '¿Tiene iniciativa? (Líder)', 'rating_5', 4);
  
  -- S4: Actitud
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Actitud', 'standard', 3) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES
  (v_section_id, '¿Actitud positiva?', 'rating_5', 0),
  (v_section_id, '¿Respetuoso sin favoritismos?', 'rating_5', 1),
  (v_section_id, '¿Representa bien la marca?', 'rating_5', 2),
  (v_section_id, '¿Recibe críticas bien?', 'rating_5', 3),
  (v_section_id, '¿Contribuye al ambiente?', 'rating_5', 4);
  
  -- S5: Desarrollo
  INSERT INTO template_sections (template_id, title, color_theme, order_index)
  VALUES (v_template_id, 'Desarrollo', 'standard', 4) RETURNING id INTO v_section_id;
  INSERT INTO template_questions (section_id, text, type, order_index) VALUES
  (v_section_id, '¿Interés en aprender?', 'rating_5', 0),
  (v_section_id, '¿Busca crecer?', 'rating_5', 1),
  (v_section_id, '¿Ayuda a entrenar?', 'rating_5', 2),
  (v_section_id, '¿Aplica lo aprendido?', 'rating_5', 3),
  (v_section_id, '¿Abierto a cambios?', 'rating_5', 4);

END $$;
