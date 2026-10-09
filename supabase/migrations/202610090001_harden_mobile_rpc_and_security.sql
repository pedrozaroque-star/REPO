-- ==============================================================================
-- Migration: 202610090001_harden_mobile_rpc_and_security.sql
-- Description: Endurecimiento estricto de seguridad para funciones RPC de órdenes móviles,
-- outbox transaccional y libro de pagos (PCI / OWASP / Supabase Security Best Practices).
--
-- Correcciones implementadas:
-- 1. REVOKE de permisos EXECUTE a roles no privilegiados (PUBLIC, anon, authenticated).
-- 2. Asignación exclusiva de EXECUTE a service_role.
-- 3. Inclusión obligatoria de SET search_path = public, pg_temp; en funciones SECURITY DEFINER.
-- 4. Verificación financiera estricta: los montos de la orden se validan contra v_quote.
-- 5. Cero falso despacho: app_order_outbox SOLO se genera si payment_status = 'PAID'.
-- ==============================================================================

-- 1. Restricción de permisos en app_order_create_transaction
REVOKE EXECUTE ON FUNCTION public.app_order_create_transaction(
    UUID, BIGINT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER
) FROM PUBLIC, anon, authenticated;

-- 2. Restricción de permisos en claim_outbox_batch
REVOKE EXECUTE ON FUNCTION public.claim_outbox_batch(TEXT, INT) FROM PUBLIC, anon, authenticated;

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

    -- 2. Validación estricta de coherencia financiera contra la cotización (tolerancia $0.01)
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

    -- 5. Outbox transaccional para KDS/Toast: SOLO si el pago está confirmado como PAID
    IF p_payment_status = 'PAID' THEN
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

-- 4. Redefinición segura de claim_outbox_batch
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(
    p_worker_id TEXT,
    p_batch_size INT DEFAULT 5
)
RETURNS SETOF public.app_order_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH claimable AS (
        SELECT id
        FROM public.app_order_outbox
        WHERE (status = 'PENDING' OR (status = 'FAILED' AND next_attempt_at <= NOW()))
          AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
        ORDER BY next_attempt_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.app_order_outbox o
    SET status = 'PROCESSING',
        locked_at = NOW(),
        locked_by = p_worker_id,
        updated_at = NOW()
    FROM claimable c
    WHERE o.id = c.id
    RETURNING o.*;
END;
$$;

-- 5. Concesión exclusiva al rol de servicio del backend
GRANT EXECUTE ON FUNCTION public.app_order_create_transaction TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch TO service_role;
