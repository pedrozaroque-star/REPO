-- 20261117185500_phone_kb_desserts_no_birthday_cakes_usd.sql
-- Registra en phone_knowledge_base la regla oficial de Postres de Tacos Gavilan:
-- 1. NO vendemos ni manejamos pasteles de cumpleaños, pasteles enteros ni churros.
-- 2. Como postre únicamente ofrecemos Flan y Cheesecake individuales con precios en dólares estadounidenses (USD) desde app_menu_cache.

INSERT INTO public.phone_knowledge_base (
  store_id,
  category,
  title,
  question_keywords,
  answer_es,
  answer_en,
  is_active,
  priority
)
SELECT
  NULL,
  'menu',
  'Postres Oficiales (Solo Flan y Cheesecake — Sin Pasteles de Cumpleaños)',
  'postre, postres, flan, cheesecake, pastel, pasteles, pastel de cumpleanos, birthday cake, cake, cakes, tres leches, churros, dulce, dessert, desserts',
  'En Tacos Gavilan NO manejamos ni vendemos pasteles de cumpleaños, pasteles enteros ni churros. Como postre únicamente contamos con porciones individuales de Flan y Cheesecake (cita siempre su precio vigente en dólares y centavos estadounidenses desde el catálogo en vivo de la sucursal; jamás digas pesos ni envíes a buscar pasteles en tacosgavilan.com).',
  'At Tacos Gavilan we do NOT carry or sell birthday cakes, whole cakes, or churros. For dessert, we only serve individual portions of Flan and Cheesecake (always quote current US dollar and cent prices from the live store menu catalog; never refer callers to tacosgavilan.com for birthday cakes).',
  true,
  84
WHERE NOT EXISTS (
  SELECT 1
  FROM public.phone_knowledge_base
  WHERE store_id IS NULL
    AND (
      title ILIKE '%Pasteles de Cumpleaños%'
      OR title ILIKE '%Postres Oficiales%'
    )
);
