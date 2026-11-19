-- Actualiza la regla global de pedidos por teléfono en phone_knowledge_base para responder de forma educada y seria
-- sin mencionar "políticas", "pólizas" ni "reglamentos", dirigiendo amablemente a tacosgavilan.com.

UPDATE public.phone_knowledge_base
SET
  answer_es = 'Disculpa, no tomamos órdenes por teléfono. Con gusto puedes hacer tu pedido en tacosgavilan.com para pasar a recoger, o directamente en caja o por el Drive-Thru (en sucursales con ventanilla).',
  answer_en = 'I apologize, we do not take orders over the phone. You can easily place your order at tacosgavilan.com for pickup, or directly at the counter or Drive-Thru (where available).',
  updated_at = NOW()
WHERE id = '974e34a3-369d-485d-ba78-099301458ae3';
