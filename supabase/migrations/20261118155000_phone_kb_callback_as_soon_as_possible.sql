-- Alinea la expectativa de tiempo de respuesta en recados al Gerente ("en cuanto sea posible" / "as soon as possible")
UPDATE public.phone_knowledge_base
SET
  answer_es = 'Si tuviste un inconveniente con tu orden o dejaste un objeto olvidado en la sucursal, tomo tus datos (nombre, teléfono, número de ticket o detalle). Si la sucursal está abierta, envío una alerta prioritaria en vivo a la pantalla del Gerente en turno para que se comunique contigo en cuanto sea posible; si ya está cerrada, queda registrado como recado prioritario para que el Gerente se comunique contigo en cuanto abramos.',
  answer_en = 'If you had an issue with your order or left an item behind at the restaurant, I can take your details (name, phone number, ticket number, or description). When the location is open, I send a live priority alert to the Manager on duty screen so they can reach out to you as soon as possible; if we are currently closed, it is logged as a priority callback so the Manager reaches out as soon as we reopen.',
  updated_at = NOW()
WHERE category = 'policies'
  AND title = 'Quejas de Órdenes, Faltantes u Objetos Olvidados';
