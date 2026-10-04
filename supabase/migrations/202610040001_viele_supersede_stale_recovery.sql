-- Viele checkout: un recovery_required VIEJO no debe bloquear para siempre una sucursal.
--
-- Problema (04/oct/2026): Bell, Downey y casi todas las tiendas quedaron en 'recovery_required' tras su envio
-- del 27/sep porque la verificacion inmediata contra Sage llegaba vacia. El indice unico parcial
-- viele_checkout_one_active_store (store_id WHERE state IN ('processing','recovery_required')) impedia
-- cualquier envio nuevo y la funcion respondia 'busy' sin salida.
--
-- Solucion: nuevo estado 'superseded'. Al reclamar un checkout nuevo, los 'recovery_required' de mas de
-- 24 horas de ESA sucursal pasan a 'superseded' (queda el registro de auditoria; la orden sigue en
-- viele_orders con status 'reconciliation_required'). Los 'processing' NO se tocan (pueden estar en vuelo)
-- y un 'recovery_required' reciente (<24h) SIGUE bloqueando para evitar duplicar un pedido incierto.
ALTER TABLE public.viele_checkout_requests DROP CONSTRAINT IF EXISTS viele_checkout_requests_state_check;
ALTER TABLE public.viele_checkout_requests ADD CONSTRAINT viele_checkout_requests_state_check
  CHECK (state IN ('processing', 'completed', 'recovery_required', 'superseded'));

CREATE OR REPLACE FUNCTION public.claim_viele_checkout(p_key text, p_store_id integer, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE existing public.viele_checkout_requests; inserted_count integer;
BEGIN
  UPDATE public.viele_checkout_requests
     SET state = 'superseded', updated_at = now()
   WHERE store_id = p_store_id
     AND state = 'recovery_required'
     AND request_key <> p_key
     AND updated_at < now() - interval '24 hours';

  INSERT INTO public.viele_checkout_requests(request_key, store_id, payload_hash, state)
  VALUES(p_key, p_store_id, p_hash, 'processing') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 1 THEN RETURN jsonb_build_object('claimed', true); END IF;
  SELECT * INTO existing FROM public.viele_checkout_requests WHERE request_key = p_key;
  IF existing.request_key IS NULL THEN RETURN jsonb_build_object('claimed', false, 'busy', true); END IF;
  IF existing.payload_hash <> p_hash OR existing.store_id <> p_store_id THEN
    RETURN jsonb_build_object('claimed', false, 'mismatch', true);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'state', existing.state, 'result', existing.result);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_viele_checkout(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_viele_checkout(text, integer, text) TO service_role;
NOTIFY pgrst, 'reload schema';
