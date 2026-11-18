-- Migración: Tabla tombstone para cierres anticipados sin store_id, índice parcial keyset de recados críticos pendientes
-- y neutralización de docenas de tortillas en discrepancia para Fiesta Platters (20-25, 25-30, 30-40)
-- Proyecto: teg-tacos-gavilan (ywwwdcvgfculqmcfkihq)

CREATE TABLE IF NOT EXISTS public.phone_call_status_tombstones (
  call_sid text PRIMARY KEY,
  terminal_status text NOT NULL,
  duration_seconds integer NULL,
  caller_number text NULL,
  to_number text NULL,
  forwarded_from text NULL,
  ended_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_call_status_tombstones ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_phone_call_status_tombstones_created_at
  ON public.phone_call_status_tombstones (created_at);

CREATE INDEX IF NOT EXISTS idx_phone_callbacks_pending_critical_scoped
  ON public.phone_callback_requests (store_id, source, created_at DESC, id DESC)
  WHERE status = 'pending' AND urgency IN ('critical', 'urgent');

UPDATE public.phone_knowledge_base
SET
  answer_es = 'Manejamos 4 paquetes Fiesta Platter completos (incluyen carnes a elegir, arroz, frijoles pintos/refritos, galones de agua fresca de Horchata, Jamaica, Piña o Tamarindo, tortillas recién hechas de maíz o de harina a elegir, salsas roja/verde/mixta, cilantro, cebolla, limones, zanahorias/chiles, platos, servilletas, vasos y cubiertos): 1) 15 a 20 personas (6 lb de carne, arroz y frijol, 3 galones de agua fresca, 10 docenas de maíz o 5 docenas de harina); 2) 20 a 25 personas (7.5 lb de carne, arroz y frijol, 4 galones de agua fresca y tortillas de maíz o harina a elegir); 3) 25 a 30 personas (10 lb de carne, arroz y frijol, 5 galones de agua fresca y tortillas de maíz o harina a elegir); 4) 30 a 40 personas (12 lb de carne, arroz y frijol, 6 galones de agua fresca y tortillas de maíz o harina a elegir). Si el cliente pregunta el conteo exacto de docenas de tortillas para los paquetes de 20-25, 25-30 o 30-40 personas, NO inventes ni prometas una cifra fija: explica que incluye tortillas recién hechas de maíz o harina para cubrir el grupo y ofrece dejar un recado al gerente de la sucursal si desea confirmar las bolsas exactas para su pedido. Consulta siempre precios vigentes en el catálogo en vivo (app_menu_cache). Se ordenan en línea en tacosgavilan.com con mínimo 1 hora de anticipación.',
  answer_en = 'We offer 4 complete Fiesta Platter packages (all include choice of meats, Mexican rice, refried/pinto beans, gallons of Agua Fresca [Horchata, Jamaica, Pineapple, or Tamarindo], fresh corn or flour tortillas of your choice, salsas, cilantro, onions, limes, pickled carrots/peppers, plates, napkins, cups, and utensils): 1) 15-20 guests (6 lbs meat, rice & beans, 3 gallons agua fresca, 10 dozen corn or 5 dozen flour tortillas); 2) 20-25 guests (7.5 lbs meat, rice & beans, 4 gallons agua fresca, and corn or flour tortillas of choice); 3) 25-30 guests (10 lbs meat, rice & beans, 5 gallons agua fresca, and corn or flour tortillas of choice); 4) 30-40 guests (12 lbs meat, rice & beans, 6 gallons agua fresca, and corn or flour tortillas of choice). If a caller asks for the exact dozen count of tortillas on the 20-25, 25-30, or 30-40 packages, DO NOT guess or promise a fixed figure: confirm that fresh corn or flour tortillas are included for the group size and offer a manager callback if they want to confirm exact tortilla pack counts for their order. Always quote current prices from the live store menu catalog (app_menu_cache). Same-day ordering online at tacosgavilan.com with at least 1 hour advance notice.',
  updated_at = now()
WHERE id = 'bfa65ad0-cd2f-4fee-ac00-b1c5a3be62df';
