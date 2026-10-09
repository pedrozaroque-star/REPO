-- Migration: 202610080003_app_order_atomic_rpc.sql
-- Description: Atomic PostgreSQL transaction for mobile order creation and concurrency-safe outbox claiming.

-- 1. Atomic Order Creation Function
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
AS $$
DECLARE
    v_quote RECORD;
    v_order_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_result JSONB;
BEGIN
    -- 1. Lock and validate quote with FOR UPDATE to prevent race conditions
    SELECT * INTO v_quote
    FROM public.app_quotes
    WHERE id = p_quote_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUOTE_NOT_FOUND';
    END IF;

    IF v_quote.status != 'OPEN' THEN
        RAISE EXCEPTION 'QUOTE_ALREADY_CONSUMED: Quote % is %', p_quote_id, v_quote.status;
    END IF;

    IF v_quote.expires_at < v_now THEN
        UPDATE public.app_quotes SET status = 'EXPIRED' WHERE id = p_quote_id;
        RAISE EXCEPTION 'QUOTE_EXPIRED: Quote % expired at %', p_quote_id, v_quote.expires_at;
    END IF;

    IF v_quote.store_id != p_store_id THEN
        RAISE EXCEPTION 'QUOTE_STORE_MISMATCH: Quote store is %, requested %', v_quote.store_id, p_store_id;
    END IF;

    IF v_quote.cart_hash != p_cart_hash THEN
        RAISE EXCEPTION 'QUOTE_CART_HASH_MISMATCH: Quote hash %, requested %', v_quote.cart_hash, p_cart_hash;
    END IF;

    IF v_quote.user_id IS NOT NULL AND v_quote.user_id != p_user_id THEN
        RAISE EXCEPTION 'QUOTE_USER_MISMATCH: Quote owner %, requested %', v_quote.user_id, p_user_id;
    END IF;

    -- 2. Insert order into public.app_orders
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
        p_total_amount,
        p_net_amount,
        p_tax_amount,
        p_discount_amount,
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

    -- 3. Transition quote to CONSUMED atomically
    UPDATE public.app_quotes
    SET status = 'CONSUMED',
        consumed_at = v_now,
        consumed_order_id = v_order_id
    WHERE id = p_quote_id;

    -- 4. Insert transactional outbox record for Toast KDS
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
    );

    v_result := jsonb_build_object(
        'order_id', v_order_id,
        'status', 'HOLDING',
        'payment_status', p_payment_status,
        'created_at', v_now
    );

    RETURN v_result;
END;
$$;

-- 2. Concurrency-Safe Outbox Batch Claiming Function
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(
    p_worker_id TEXT,
    p_batch_size INT DEFAULT 5
)
RETURNS SETOF public.app_order_outbox
LANGUAGE plpgsql
SECURITY DEFINER
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
