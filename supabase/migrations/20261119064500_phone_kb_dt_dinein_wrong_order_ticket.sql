-- Migration: Protocolo de revisión de preparación para órdenes equivocadas/incompletas en Drive-Thru, Comedor y Mostrador
-- Fecha: 2026-11-19
-- Requiere solicitar: 1) número de ticket, 2) fecha de compra, 3) nombre y 4) teléfono de 10 dígitos,
-- aclarando con respeto que sin el número de ticket es poco probable determinar la equivocación.

BEGIN;

-- 1. Regla global dedicada y prioritaria para órdenes equivocadas o incompletas en Drive-Thru, Comedor, Mostrador o Web Directa
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
  'policies',
  'Órdenes Equivocadas o Incompletas en Drive-Thru, Comedor o Mostrador',
  'orden equivocada, drive thru, ventanilla, comedor, mostrador, caja, para llevar, me dieron mal mi orden, falto comida, incompleta, ticket, recibo, wrong order, drive-thru, dine-in, counter, takeout, missing items, receipt',
  'Para órdenes compradas en Drive-Thru, comedor, mostrador/caja o directo en tacosgavilan.com que hayan salido equivocadas o incompletas, solicita amablemente 4 datos para hacer la revisión de la preparación de su orden: 1) número de ticket, 2) fecha de la compra, 3) nombre y 4) número de teléfono de 10 dígitos. Aclara siempre de manera educada y seria que sin el número de ticket es poco probable poder determinar la equivocación. Si el cliente confirma que ya no tiene el ticket, reitera respetuosamente esa aclaración pero ofrece registrar su fecha, nombre y teléfono (marcando SIN TICKET) para conocimiento del Gerente en turno, sin prometer reposición ni reembolso.',
  'For Drive-Thru, dine-in, counter/takeout, or direct tacosgavilan.com orders that came out wrong or incomplete, politely request 4 details to review how the order was prepared: 1) ticket number, 2) purchase date, 3) caller name, and 4) 10-digit phone number. Politely and clearly explain that without the ticket number, it is unlikely we can verify or determine the mistake. If the caller confirms they no longer have the ticket, respectfully reiterate that caveat while still offering to log their purchase date, name, and 10-digit phone number (marked NO TICKET) for the Manager on duty without promising a replacement or refund.',
  true,
  96
WHERE NOT EXISTS (
  SELECT 1
  FROM public.phone_knowledge_base
  WHERE store_id IS NULL
    AND title = 'Órdenes Equivocadas o Incompletas en Drive-Thru, Comedor o Mostrador'
);

-- 2. Alinear regla global existente de Quejas y Objetos Olvidados para no contradecir los 4 requisitos en órdenes equivocadas
UPDATE public.phone_knowledge_base
SET
  answer_es = 'Si dejaste un objeto olvidado en la sucursal o tienes una consulta de cobro, tomo tu nombre, teléfono de 10 dígitos y detalle para enviar una alerta prioritaria a la pantalla del Gerente en turno (o dejar recado prioritario si ya cerramos). Si se trata de una orden equivocada o incompleta comprada en Drive-Thru, comedor o mostrador, solicita siempre número de ticket, fecha de compra, nombre y teléfono de 10 dígitos para hacer la revisión de la preparación de su orden, aclarando que sin el ticket es poco probable determinar la equivocación.',
  answer_en = 'If you left a personal item behind at the restaurant or have a billing inquiry, I take your name, 10-digit phone number, and details to send a live priority alert to the Manager on duty screen (or log a priority callback if closed). If it is a wrong or incomplete order from Drive-Thru, dine-in, or counter, always request the ticket number, purchase date, name, and 10-digit phone number to review how the order was prepared, explaining that without the ticket it is unlikely we can verify the mistake.',
  updated_at = now()
WHERE store_id IS NULL
  AND title = 'Quejas de Órdenes, Faltantes u Objetos Olvidados';

-- 3. Alinear el punto 3 de la regla comparativa de Delivery vs Compra Directa
UPDATE public.phone_knowledge_base
SET
  answer_es = 'Distingue si la orden no ha llegado o llegó mal y el canal de compra: 1) Si un pedido de Uber Eats, DoorDash o Grubhub aún no llega, el traslado depende del repartidor asignado; invita al cliente a revisar el estado en el mapa de su aplicación y, si lleva mucho tiempo esperando repartidor, ofrece tomar nombre, teléfono de 10 dígitos y código de orden para que caja confirme si la bolsa sigue en mostrador. 2) Si una orden de Uber Eats, DoorDash o Grubhub llegó equivocada o incompleta, pide disculpas, indícale reportarlo en la sección Ayuda de su aplicación para recibir reembolso o crédito directo, y ofrece tomar sus datos para enviar alerta prioritaria al Gerente en sucursal. 3) Si compró directo en Drive-Thru, comedor, mostrador o tacosgavilan.com, solicita número de ticket, fecha de compra, nombre y teléfono de 10 dígitos para revisar la preparación de su orden (aclarando que sin el ticket es poco probable determinar la equivocación) y envía alerta prioritaria al Gerente.',
  answer_en = 'Separate whether the order has not arrived or arrived wrong, and which channel was used: 1) If an Uber Eats, DoorDash, or Grubhub order has not arrived yet, transit is handled by the platform driver—advise checking the live status map in the app, and if it has been stuck waiting for a driver too long, offer to take name, 10-digit phone, and order code so counter staff can check if the bag is still on the rack. 2) If an Uber Eats, DoorDash, or Grubhub order arrived wrong or incomplete, apologize sincerely, advise reporting it in the Help section of the app for a direct refund or credit, and offer to send a priority alert to the store Manager for follow-up. 3) If purchased directly via Drive-Thru, dine-in, counter, or tacosgavilan.com, request the ticket number, purchase date, name, and 10-digit phone number to review how the order was prepared (explaining that without the ticket it is unlikely we can verify the mistake) and send a priority alert to the Manager.',
  updated_at = now()
WHERE store_id IS NULL
  AND title = 'Órdenes Retrasadas, No Entregadas o Llegaron Equivocadas / Incompletas';

COMMIT;
