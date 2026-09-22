-- Deploy before enabling live checkout in the matching application release.
-- No automatic expiry: an interrupted checkout requires reconciliation with V&S.
CREATE TABLE IF NOT EXISTS public.viele_checkout_requests (
  request_key text PRIMARY KEY,
  store_id integer NOT NULL REFERENCES public.stores(id),
  payload_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('processing', 'completed', 'recovery_required')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS viele_checkout_one_active_store
ON public.viele_checkout_requests(store_id) WHERE state IN ('processing', 'recovery_required');
ALTER TABLE public.viele_checkout_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.viele_checkout_requests FROM anon, authenticated;
GRANT ALL ON public.viele_checkout_requests TO service_role;

CREATE OR REPLACE FUNCTION public.claim_viele_checkout(p_key text, p_store_id integer, p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE existing public.viele_checkout_requests; inserted_count integer;
BEGIN
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

-- Atomic header + detail persistence. Only input columns are listed explicitly.
CREATE OR REPLACE FUNCTION public.persist_viele_order_batch(p_orders jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE entry jsonb; line jsonb; header jsonb; new_id integer; saved jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_orders) <> 'array' OR jsonb_array_length(p_orders) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'Invalid Viele order batch';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    header := entry->'header';
    IF jsonb_typeof(entry->'items') <> 'array' OR jsonb_array_length(entry->'items') = 0 THEN
      RAISE EXCEPTION 'Order detail is required';
    END IF;
    INSERT INTO public.viele_orders(store_id, order_number, order_category, linked_order_number,
      order_date, ship_date, status, total_cases, subtotal_amount, tax_amount, total_amount,
      buyer_name, customer_po_no, viele_response, notes)
    VALUES ((header->>'store_id')::integer, header->>'order_number', header->>'order_category', header->>'linked_order_number',
      (header->>'order_date')::date, (header->>'ship_date')::date, header->>'status', (header->>'total_cases')::integer,
      (header->>'subtotal_amount')::numeric, (header->>'tax_amount')::numeric, (header->>'total_amount')::numeric,
      header->>'buyer_name', header->>'customer_po_no', header->'viele_response', header->>'notes') RETURNING id INTO new_id;
    FOR line IN SELECT value FROM jsonb_array_elements(entry->'items') LOOP
      INSERT INTO public.viele_order_items(order_id, item_code, description, uom, unit_price,
        par_quantity, leftover_quantity, suggested_quantity, order_quantity, extended_amount)
      VALUES (new_id, line->>'item_code', line->>'description', line->>'uom', (line->>'unit_price')::numeric,
        (line->>'par_quantity')::numeric, (line->>'leftover_quantity')::numeric,
        (line->>'suggested_quantity')::numeric, (line->>'order_quantity')::numeric, (line->>'extended_amount')::numeric);
    END LOOP;
    saved := saved || jsonb_build_array(header || jsonb_build_object('id', new_id));
  END LOOP;
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_viele_checkout(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_viele_order_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_viele_checkout(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_viele_order_batch(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
