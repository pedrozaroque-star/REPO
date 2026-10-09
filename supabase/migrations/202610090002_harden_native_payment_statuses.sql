-- ==============================================================================
-- Migration: 202610090002_harden_native_payment_statuses.sql
-- Description: Ampliación de estados financieros autoritativos para app_orders y app_payment_events,
-- y actualización de la función RPC transaccional app_order_create_transaction para arquitectura nativa Toast.
-- ==============================================================================

-- 1. Ampliar restricción CHECK de payment_status en public.app_orders
ALTER TABLE public.app_orders DROP CONSTRAINT IF EXISTS app_orders_payment_status_check;
ALTER TABLE public.app_orders ADD CONSTRAINT app_orders_payment_status_check 
  CHECK (payment_status IN (
    'PENDING_PAYMENT', 
    'AUTHORIZED', 
    'PAID', 
    'PAYMENT_FAILED', 
    'VOID_PENDING', 
    'VOIDED', 
    'REFUND_PENDING', 
    'REFUNDED',
    'PENDING' -- Compatibilidad con registros existentes
  ));

-- 2. Asegurar que app_payment_events admita los nuevos estados financieros
ALTER TABLE public.app_payment_events DROP CONSTRAINT IF EXISTS app_payment_events_status_check;
ALTER TABLE public.app_payment_events ADD CONSTRAINT app_payment_events_status_check
  CHECK (status IN (
    'pending',
    'authorized',
    'succeeded',
    'failed',
    'voided',
    'refunded',
    'mismatch_flagged'
  ));

-- 3. Redefinición segura de app_order_create_transaction
CREATE OR REPLACE FUNCTION public.app_order_create_transaction(
    p_user_id UUID,
    p_store_id BIGINT,
    p_quote_id UUID,
    p_cart_hash TEXT,
    p_channel TEXT,
    p_pickup_method TEXT,
    p_curbside_stall TEXT,
    p_items_json JSONB,
    p_total_amount NUMERIC(10, 2),
    p_net_amount NUMERIC(10, 2),
    p_tax_amount NUMERIC(10, 2),
    p_discount_amount NUMERIC(10, 2),
    p_payment_status TEXT,
    p_payment_intent_id TEXT,
    p_user_latitude DOUBLE PRECISION,
    p_user_longitude DOUBLE PRECISION,
    p_eta_minutes INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_quote RECORD;
    v_order_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_result JSONB;
BEGIN
    -- 1. Bloquear y validar la cotización autoritativa
    SELECT * INTO v_quote
    FROM public.app_quotes
    WHERE id = p_quote_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUOTE_NOT_FOUND: Cotización % no encontrada', p_quote_id;
    END IF;

    IF v_quote.status != 'OPEN' THEN
        RAISE EXCEPTION 'QUOTE_ALREADY_CONSUMED: La cotización % ya tiene estado %', p_quote_id, v_quote.status;
    END IF;

    IF v_quote.expires_at < v_now THEN
        UPDATE public.app_quotes SET status = 'EXPIRED' WHERE id = p_quote_id;
        RAISE EXCEPTION 'QUOTE_EXPIRED: La cotización % expiró en %', p_quote_id, v_quote.expires_at;
    END IF;

    IF v_quote.store_id != p_store_id THEN
        RAISE EXCEPTION 'QUOTE_STORE_MISMATCH: Cotización para sucursal %, solicitada %', v_quote.store_id, p_store_id;
    END IF;

    IF v_quote.cart_hash != p_cart_hash THEN
        RAISE EXCEPTION 'QUOTE_CART_HASH_MISMATCH: Discrepancia de cart_hash';
    END IF;

    IF v_quote.user_id IS NOT NULL AND v_quote.user_id != p_user_id THEN
        RAISE EXCEPTION 'QUOTE_USER_MISMATCH: El comensal % no coincide con el dueño de la cotización %', p_user_id, v_quote.user_id;
    END IF;

    -- 2. Validación financiera estricta contra la cotización (tolerancia $0.01)
    IF ABS(v_quote.total_amount - p_total_amount) > 0.01 THEN
        RAISE EXCEPTION 'FINANCIAL_MISMATCH: total_amount (% vs quote %)', p_total_amount, v_quote.total_amount;
    END IF;

    IF ABS(v_quote.subtotal - p_net_amount) > 0.01 THEN
        RAISE EXCEPTION 'FINANCIAL_MISMATCH: net_amount (% vs quote %)', p_net_amount, v_quote.subtotal;
    END IF;

    IF ABS(v_quote.tax_amount - p_tax_amount) > 0.01 THEN
        RAISE EXCEPTION 'FINANCIAL_MISMATCH: tax_amount (% vs quote %)', p_tax_amount, v_quote.tax_amount;
    END IF;

    -- 3. Inserción atómica en public.app_orders
    INSERT INTO public.app_orders (
        user_id,
        store_id,
        quote_id,
        cart_hash,
        total_amount,
        net_amount,
        tax_amount,
        discount_amount,
        items_json,
        pickup_method,
        curbside_stall,
        status,
        payment_status,
        payment_intent_id,
        user_latitude,
        user_longitude,
        eta_minutes,
        created_at,
        updated_at
    ) VALUES (
        p_user_id,
        p_store_id,
        p_quote_id,
        p_cart_hash,
        v_quote.total_amount,
        v_quote.subtotal,
        v_quote.tax_amount,
        v_quote.discount_amount,
        p_items_json,
        p_pickup_method,
        p_curbside_stall,
        'HOLDING',
        p_payment_status,
        p_payment_intent_id,
        p_user_latitude,
        p_user_longitude,
        p_eta_minutes,
        v_now,
        v_now
    ) RETURNING id INTO v_order_id;

    -- 4. Transicionar la cotización a CONSUMED
    UPDATE public.app_quotes
    SET status = 'CONSUMED',
        consumed_at = v_now,
        consumed_order_id = v_order_id
    WHERE id = p_quote_id;

    -- 5. Outbox transaccional para KDS/Toast: SOLO si el pago está en estado PAID o AUTHORIZED
    IF p_payment_status IN ('PAID', 'AUTHORIZED') THEN
        INSERT INTO public.app_order_outbox (
            order_id,
            integration,
            idempotency_key,
            status,
            request_payload
        ) VALUES (
            v_order_id,
            'toast_kds',
            'toast:' || v_order_id::text,
            'PENDING',
            jsonb_build_object(
                'orderId', v_order_id,
                'storeId', p_store_id,
                'channel', p_channel,
                'items', p_items_json->'items'
            )
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    v_result := jsonb_build_object(
        'order_id', v_order_id,
        'status', 'HOLDING',
        'payment_status', p_payment_status,
        'created_at', v_now
    );

    RETURN v_result;
END;
$$;

-- 4. Permisos exclusivos a service_role
REVOKE EXECUTE ON FUNCTION public.app_order_create_transaction(
    UUID, BIGINT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.app_order_create_transaction TO service_role;
