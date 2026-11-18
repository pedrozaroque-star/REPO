-- Migración: Deduplicación atómica de recados por llamada, índice de urgencia pendiente y eliminación de precios fijos en KB
-- Proyecto: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)

-- 1. Deduplicación atómica en PostgreSQL: máximo un recado pendiente por llamada activa (call_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_callbacks_one_pending_per_call
  ON public.phone_callback_requests (call_id)
  WHERE status = 'pending' AND call_id IS NOT NULL;

-- 2. Índice compuesto para rescatar siempre recados pendientes críticos/urgentes aunque existan >50 registros recientes
CREATE INDEX IF NOT EXISTS idx_phone_callbacks_pending_urgency_created
  ON public.phone_callback_requests (status, urgency, created_at DESC);

-- 3. Eliminar precios fijos en reglas semilla de phone_knowledge_base para que nunca contradigan app_menu_cache
UPDATE public.phone_knowledge_base
SET
  answer_es = 'Manejamos 4 paquetes Fiesta Platter completos (incluyen carnes a elegir: Carne Asada, Pollo o Al Pastor; arroz, frijoles pintos/refritos, galones de agua fresca de Horchata, Jamaica, Piña o Tamarindo; tortillas recién hechas, salsas roja/verde/mixta, cilantro, cebolla, limones, zanahorias/chiles, platos, servilletas, vasos y cubiertos): 1) 15 a 20 personas (6 lb de carne, charola mediana 3 lb arroz / 3 lb frijol, 3 galones de agua, 10 docenas de maíz o 5 de harina); 2) 20 a 25 personas (7.5 lb carne, 4 lb arroz / 4 lb frijol, 4 galones, 15 docenas maíz o 7 harina); 3) 25 a 30 personas (10 lb carne, 6 lb arroz / 6 lb frijol, 5 galones, 20 docenas maíz o 9 harina); 4) 30 a 40 personas (12 lb carne, 10 lb arroz / 10 lb frijol, 6 galones, 25 docenas maíz o 12 harina). Para los precios exactos vigentes de cada paquete o combinaciones para más de 40 personas, consulta siempre el catálogo en vivo de la sucursal (app_menu_cache / get_fiesta_platter_info). Se ordenan el mismo día exclusivamente en línea en tacosgavilan.com con mínimo 1 hora de anticipación.',
  answer_en = 'We offer 4 complete Fiesta Platter packages (all include choice of Carne Asada, Chicken, or Al Pastor; Mexican rice, refried/pinto beans, gallons of Agua Fresca [Horchata, Jamaica, Pineapple, or Tamarindo], fresh tortillas, salsas, cilantro, onions, limes, pickled carrots/peppers, plates, napkins, cups, and utensils): 1) 15-20 guests (6 lbs meat, 3 lbs rice/3 lbs beans, 3 gallons agua fresca, 10 dozen corn or 5 dozen flour tortillas); 2) 20-25 guests (7.5 lbs meat, 4 lbs rice/4 lbs beans, 4 gallons, 15 dozen corn or 7 dozen flour); 3) 25-30 guests (10 lbs meat, 6 lbs rice/6 lbs beans, 5 gallons, 20 dozen corn or 9 dozen flour); 4) 30-40 guests (12 lbs meat, 10 lbs rice/10 lbs beans, 6 gallons, 25 dozen corn or 12 dozen flour). Always quote current package prices and 40+ guest combinations from the live store menu catalog (app_menu_cache / get_fiesta_platter_info). Same-day ordering exclusively online at tacosgavilan.com with at least 1 hour advance notice.',
  updated_at = now()
WHERE id = 'bfa65ad0-cd2f-4fee-ac00-b1c5a3be62df';

UPDATE public.phone_knowledge_base
SET
  answer_es = 'Manejamos Aguas Frescas naturales (Horchata, Jamaica, Piña y Tamarindo; no manejamos Pepino) y sodas de fuente (Coca-Cola, Diet Coke, Sprite, Orange Fanta, Strawberry Fanta, Lemonade e Iced Tea) en vaso Mediano de 22 onzas, Grande de 32 onzas y Galón de Agua Fresca de 128 onzas (rinde aprox. 5 vasos medianos). En bebidas calientes tenemos Champurrado individual en vaso térmico de 16 onzas, Caja de Champurrado Para Llevar de 96 onzas (equivale a 6 vasos de 16 onzas e incluye 8 vasos de cortesía de 12 onzas), Café caliente en vaso de 16 onzas y Agua Embotellada. Usa siempre los precios vigentes del catálogo en vivo de la sucursal (app_menu_cache).',
  answer_en = 'We serve natural Aguas Frescas (Horchata, Jamaica/Hibiscus, Pineapple/Piña, and Tamarindo; no Cucumber) and fountain sodas (Coca-Cola, Diet Coke, Sprite, Orange Fanta, Strawberry Fanta, Lemonade, and Iced Tea) in Medium 22 oz, Large 32 oz, and 128 oz Agua Fresca Gallon (serves about 5 medium cups). For hot drinks we serve individual Champurrado in a 16 oz insulated cup, the 96 oz To-Go Champurrado Box (equivalent to six 16 oz cups and includes eight 12 oz serving cups), hot Coffee in a 16 oz cup, and Bottled Water. Always quote current prices from the live store menu catalog (app_menu_cache).',
  updated_at = now()
WHERE id = 'a351dfe7-5263-41c9-99df-5646e697ca67';

UPDATE public.phone_knowledge_base
SET
  answer_es = 'Tipos de queso por platillo: las Tortas (incluyendo Cubana y Milanesa) llevan Queso Fresco en rebanada y NUNCA llevan crema ni queso fundido (sí mayonesa, aguacate, frijol, lechuga y tomate); las Quesadillas, Mulitas, Super Burritos y Burritos de Frijol con Queso llevan Queso blanco Monterey Jack para fundir; los Sopes, Platos combinados, Taco Plate y Desayunos llevan Queso Cotija (el Sope de Queso lleva Queso Fresco y Cotija); los Super Nachos llevan Queso Amarillo caliente tipo Nacho Cheese. Nuestros frijoles son pintos tradicionales y contamos con opciones sin carne (Burrito de Arroz y Frijol, Quesadillas y Mulitas de Queso, Torta Vegetariana). En desayunos servimos Burritos de Huevo, Platos de Huevos y Tortas de Huevo (usa siempre los precios vigentes del catálogo en vivo de la sucursal). Ante alergias severas, indícalo directo en caja al ordenar.',
  answer_en = 'Cheese by dish: Tortas (including Cubana and Milanesa) use sliced Queso Fresco and NEVER include sour cream or melted cheese (they come with mayo, avocado, beans, lettuce, and tomato); Quesadillas, Mulitas, Super Burritos, and Bean/Rice/Cheese Burritos use white melted Monterey Jack cheese; Sopes, Combination Plates, Taco Plate, and Breakfast Plates use crumbled Cotija cheese (Cheese Sope uses Queso Fresco plus Cotija); Super Nachos use warm yellow Nacho cheese. We serve traditional pinto beans and meatless options (Bean & Cheese Burritos, Cheese Quesadillas/Mulitas, Vegetarian Torta/Burrito). For breakfast we serve Egg Burritos, Egg Plates, and Egg Tortas (always quote current prices from the live store menu catalog). For severe food allergies, please inform the cashier when ordering.',
  updated_at = now()
WHERE id = 'd439241b-9494-4007-835d-37da4dcb559c';
