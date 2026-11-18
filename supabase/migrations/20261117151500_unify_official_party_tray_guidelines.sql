-- Migration: Unify Official Party Tray Guidelines across Phone Knowledge Base and Gavilan POS Catalog
-- Date: 2026-11-17
-- Source of Truth: Official Party Tray Guidelines (docs/Party Tray Instructions.pdf / PARTY_TRAY_GUIDELINES)

-- 1. Update Fiesta Platters rule in phone_knowledge_base with the official verified quantities for all 4 packages
UPDATE public.phone_knowledge_base
SET
  answer_es = 'Manejamos 4 paquetes Fiesta Platter completos conforme a la Guía Oficial Party Tray Guidelines (todos incluyen carnes a elegir, arroz mexicano, frijoles pintos refritos, galones de agua fresca de Horchata, Jamaica, Piña o Tamarindo, tortillas recién hechas de maíz o de harina a elegir, sobres de salsa roja y verde, cebolla con cilantro, limones, chiles jalapeños con zanahorias en escabeche, platos, tenedores, cucharas, vasos y servilletas): '
    || '1) 15 a 20 personas: 6 lbs de carne (charola mediana), 3 lbs de arroz y 3 lbs de frijol, 3 galones de agua fresca, 10 docenas de tortilla de maíz (2 paquetes) o 5 docenas de harina (5 paquetes), 12 salsas rojas, 12 verdes, 16 cebolla/cilantro, 16 limones, 8 oz de jalapeños, 30 platos, 15 tenedores, 15 cucharas, 20 vasos y 1 paquete de servilletas. '
    || '2) 20 a 25 personas: 7.5 lbs de carne (charola mediana), 4 lbs de arroz y 4 lbs de frijol, 4 galones de agua fresca, 15 docenas de tortilla de maíz (3 paquetes) o 7 docenas de harina (7 paquetes), 16 salsas rojas, 16 verdes, 20 cebolla/cilantro, 20 limones, 12 oz de jalapeños, 35 platos, 15 tenedores, 15 cucharas, 25 vasos y 1 paquete de servilletas. '
    || '3) 25 a 30 personas: 10 lbs de carne (charola completa), 6 lbs de arroz y 6 lbs de frijol, 5 galones de agua fresca, 20 docenas de tortilla de maíz (4 paquetes) o 9 docenas de harina (9 paquetes), 20 salsas rojas, 20 verdes, 20 cebolla/cilantro, 20 limones, 16 oz de jalapeños, 40 platos, 20 tenedores, 20 cucharas, 30 vasos y 2 paquetes de servilletas. '
    || '4) 30 a 40 personas: 12 lbs de carne (charola completa), 10 lbs de arroz y 10 lbs de frijol (charola completa), 6 galones de agua fresca, 25 docenas de tortilla de maíz (5 paquetes) o 12 docenas de harina (12 paquetes), 24 salsas rojas, 24 verdes, 30 cebolla/cilantro, 30 limones, 20 oz de jalapeños, 50 platos, 25 tenedores, 25 cucharas, 40 vasos y 3 paquetes de servilletas. '
    || 'Consulta siempre los precios vigentes en el catálogo en vivo (app_menu_cache). Se ordenan exclusivamente en línea en tacosgavilan.com con mínimo 1 hora de anticipación para recoger el mismo día.',
  answer_en = 'We offer 4 complete Fiesta Platter packages per our Official Party Tray Guidelines (all include choice of meats, Mexican rice, refried pinto beans, gallons of Agua Fresca [Horchata, Jamaica, Pineapple, or Tamarind], fresh corn or flour tortillas of your choice, red & green salsa packets, chopped cilantro & onion packets, limes, pickled jalapeños & carrots, plates, forks, spoons, cups, and napkins): '
    || '1) 15-20 guests: 6 lbs meat (medium tray), 3 lbs rice & 3 lbs beans, 3 gallons agua fresca, 10 dozen corn tortillas (2 packs) or 5 dozen flour tortillas (5 packs), 12 red & 12 green salsas, 16 onion/cilantro, 16 limes, 8 oz jalapeños, 30 plates, 15 forks, 15 spoons, 20 cups, and 1 napkin pack. '
    || '2) 20-25 guests: 7.5 lbs meat (medium tray), 4 lbs rice & 4 lbs beans, 4 gallons agua fresca, 15 dozen corn tortillas (3 packs) or 7 dozen flour tortillas (7 packs), 16 red & 16 green salsas, 20 onion/cilantro, 20 limes, 12 oz jalapeños, 35 plates, 15 forks, 15 spoons, 25 cups, and 1 napkin pack. '
    || '3) 25-30 guests: 10 lbs meat (full tray), 6 lbs rice & 6 lbs beans, 5 gallons agua fresca, 20 dozen corn tortillas (4 packs) or 9 dozen flour tortillas (9 packs), 20 red & 20 green salsas, 20 onion/cilantro, 20 limes, 16 oz jalapeños, 40 plates, 20 forks, 20 spoons, 30 cups, and 2 napkin packs. '
    || '4) 30-40 guests: 12 lbs meat (full tray), 10 lbs rice & 10 lbs beans (full tray), 6 gallons agua fresca, 25 dozen corn tortillas (5 packs) or 12 dozen flour tortillas (12 packs), 24 red & 24 green salsas, 30 onion/cilantro, 30 limes, 20 oz jalapeños, 50 plates, 25 forks, 25 spoons, 40 cups, and 3 napkin packs. '
    || 'Always quote current prices from the live store menu catalog (app_menu_cache). Same-day ordering exclusively online at tacosgavilan.com with at least 1 hour advance notice.',
  updated_at = NOW()
WHERE id = 'bfa65ad0-cd2f-4fee-ac00-b1c5a3be62df';

-- 2. Ensure all 4 official In-Store Fiesta Platter sizes exist in gavilan_pos_menu_items with current Toast POS base prices
INSERT INTO public.gavilan_pos_menu_items (
  id,
  name,
  category,
  base_price,
  delivery_markup_pct,
  station_code,
  is_86ed,
  tax_exempt_ebt,
  modifier_groups,
  updated_at
)
VALUES (
  '81e1e9f7-de80-4f50-80ef-5e3d76541ef0',
  '30 - 40 People',
  'In Store Menu > Catering (In Store)',
  373.89,
  18,
  'LINEA',
  false,
  true,
  '["CON TODO", "SIN CEBOLLA", "SALSA ROJA"]'::jsonb,
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  base_price = EXCLUDED.base_price,
  updated_at = NOW();
