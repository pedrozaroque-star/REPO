-- Paquete 1 + 2A + 2B (Contestadora IA):
-- 1) Columna opcional `origin_store_id` en `phone_callback_requests` (sin FK extra para preservar el embed único `stores(id, name)` en PostgREST)
--    para auditar recados recibidos en una sucursal y enrutados en vivo hacia la sucursal destino correcta.
-- 2) 4 reglas globales oficiales en `phone_knowledge_base` para:
--    - Cambios o cancelaciones en Uber Eats / DoorDash / Grubhub
--    - Agregar condimentos gratis (Nota de Empaque sin alarma roja)
--    - Pedidos realizados en sucursal equivocada (Apps vs tacosgavilan.com con enrutamiento multi-sucursal)
--    - Órdenes retrasadas, no entregadas o llegadas equivocadas / incompletas

ALTER TABLE public.phone_callback_requests
  ADD COLUMN IF NOT EXISTS origin_store_id integer NULL;

COMMENT ON COLUMN public.phone_callback_requests.origin_store_id IS
  'ID de la sucursal donde ingresó originalmente la llamada cuando la IA enruta un recado de sucursal equivocada hacia otro store_id.';

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
  'delivery',
  'Cambios o Cancelaciones de Órdenes (Uber Eats, DoorDash y Grubhub)',
  'modificar orden, cambiar orden, corregir orden, cancelar uber, cancelar doordash, cancelar grubhub, editar pedido, modify order, change order, cancel order',
  'Cuando el pedido se pagó por Uber Eats, DoorDash o Grubhub, la sucursal no puede modificar platillos con costo, cambiar dirección ni emitir reembolsos; eso se gestiona directo en la aplicación del cliente en la sección Ayuda. Si solo desea un ajuste menor sin costo antes de empacar (como quitar un ingrediente) o avisar urgente antes de que salga, toma nombre, teléfono de 10 dígitos, plataforma y código de orden para enviar un aviso al equipo aclarando que únicamente aplica si la orden aún no se ha empacado ni entregado al repartidor.',
  'When an order is paid through Uber Eats, DoorDash, or Grubhub, the restaurant cannot edit paid items, change the delivery address, or issue refunds; those must be handled directly in the app under Help. For a minor no-cost tweak before packing (like removing an ingredient), collect name, 10-digit phone, platform, and order code to send a notice to the store, clearly explaining it only applies if the order has not been packed or handed to the driver yet.',
  true,
  94
WHERE NOT EXISTS (
  SELECT 1 FROM public.phone_knowledge_base
  WHERE store_id IS NULL AND title = 'Cambios o Cancelaciones de Órdenes (Uber Eats, DoorDash y Grubhub)'
);

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
  'Agregar Condimentos Gratis (Salsas, Limones, Cilantro y Cubiertos)',
  'agregar salsa, salsas gratis, condimentos, cilantro, cebolla, limones, jalapenos, tenedores, servilletas, extra salsa, free condiments, add salsa, limes, napkins, utensils',
  'Los condimentos habituales (salsa roja y verde, cebolla con cilantro, limones, chiles jalapeños, servilletas y cubiertos) son gratis con tu orden. Si ya hiciste tu pedido y deseas agregar condimentos sin costo, dime tu nombre, número o código de orden, teléfono de 10 dígitos y qué condimentos necesitas para enviar una Nota de Empaque a la tienda (aclarando que cocina y caja los incluirán siempre que tu orden aún no haya salido o sido entregada al repartidor). Si pediste por Uber Eats, DoorDash o Grubhub, también puedes mandarle mensaje en tu app al repartidor.',
  'Standard condiments (red and green salsa, chopped onion & cilantro, limes, pickled jalapeños, napkins, and utensils) are free with your order. If you already placed an order and want to add free condiments, share your name, order number or code, 10-digit phone number, and which condiments you need so I can send a Packing Note to the store—clearly noting they will be added as long as the order has not left or been handed to the driver yet. For Uber Eats, DoorDash, or Grubhub, you can also message your driver in the app.',
  true,
  93
WHERE NOT EXISTS (
  SELECT 1 FROM public.phone_knowledge_base
  WHERE store_id IS NULL AND title = 'Agregar Condimentos Gratis (Salsas, Limones, Cilantro y Cubiertos)'
);

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
  'Pedidos Realizados en Sucursal Equivocada',
  'sucursal equivocada, tienda equivocada, pedi en otra sucursal, orden en otra tienda, me equivoque de sucursal, wrong store, wrong location, ordered at wrong restaurant',
  'Cada sucursal de Tacos Gavilan procesa sus propios pagos y comandas por separado, por lo que no se puede mover automáticamente un pedido pagado de una tienda a otra. Si ordenaste por Uber Eats, DoorDash o Grubhub en la sucursal equivocada, debes cancelar de inmediato desde tu aplicación antes de que se prepare y volver a ordenar eligiendo la dirección correcta (confirmando siempre entrecalles en Los Ángeles). Si ordenaste directo para recoger en tacosgavilan.com en otra sucursal por error, dime exactamente en cuál sucursal cayó el pedido, tu nombre, teléfono de 10 dígitos y número de orden para enviar una alerta prioritaria directa al Gerente de esa sucursal destino.',
  'Each Tacos Gavilan location processes its own payments and kitchen tickets separately, so a paid order cannot be automatically moved from one store to another. If you ordered through Uber Eats, DoorDash, or Grubhub at the wrong store, please cancel immediately in the app before preparation and reorder at the correct location (always verifying Los Angeles cross-streets). If you placed a pickup order directly on tacosgavilan.com at the wrong branch, share the exact store where the order landed, your name, 10-digit phone number, and order number so I can route a priority alert directly to that store manager.',
  true,
  92
WHERE NOT EXISTS (
  SELECT 1 FROM public.phone_knowledge_base
  WHERE store_id IS NULL AND title = 'Pedidos Realizados en Sucursal Equivocada'
);

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
  'delivery',
  'Órdenes Retrasadas, No Entregadas o Llegaron Equivocadas / Incompletas',
  'no ha llegado mi orden, orden retrasada, no me llega, llego equivocada, orden incompleta, falto comida doordash, falto comida uber, order not arrived, delayed order, never arrived, wrong delivery',
  'Distingue si la orden no ha llegado o llegó mal y el canal de compra: 1) Si un pedido de Uber Eats, DoorDash o Grubhub aún no llega, el traslado depende del repartidor asignado; invita al cliente a revisar el estado en el mapa de su aplicación y, si lleva mucho tiempo esperando repartidor, ofrece tomar nombre, teléfono de 10 dígitos y código de orden para que caja confirme si la bolsa sigue en mostrador. 2) Si una orden de Uber Eats, DoorDash o Grubhub llegó equivocada o incompleta, pide disculpas, indícale reportarlo en la sección Ayuda de su aplicación para recibir reembolso o crédito directo, y ofrece tomar sus datos para enviar alerta prioritaria al Gerente en sucursal. 3) Si compró directo en tacosgavilan.com, mostrador o Drive-Thru, toma nombre, teléfono de 10 dígitos, número de ticket y detalle para enviar alerta prioritaria inmediata al Gerente.',
  'Separate whether the order has not arrived or arrived wrong, and which channel was used: 1) If an Uber Eats, DoorDash, or Grubhub order has not arrived yet, transit is handled by the platform driver—advise checking the live status map in the app, and if it has been stuck waiting for a driver too long, offer to take name, 10-digit phone, and order code so counter staff can check if the bag is still on the rack. 2) If a Uber Eats, DoorDash, or Grubhub order arrived wrong or incomplete, apologize sincerely, advise reporting it in the Help section of the app for a direct refund or credit, and offer to send a priority alert to the store Manager for follow-up. 3) If ordered directly on tacosgavilan.com, counter, or Drive-Thru, collect name, 10-digit phone, ticket/order number, and details for an immediate Manager callback alert.',
  true,
  91
WHERE NOT EXISTS (
  SELECT 1 FROM public.phone_knowledge_base
  WHERE store_id IS NULL AND title = 'Órdenes Retrasadas, No Entregadas o Llegaron Equivocadas / Incompletas'
);
