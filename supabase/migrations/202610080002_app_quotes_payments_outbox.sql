-- Migration: 202610080002_app_quotes_payments_outbox.sql
-- Description: Authoritative persisted financial quotes, payment events ledger, and transactional outbox for Tacos Gavilan App.

-- 1. Table: app_quotes (Persistent single-use authoritative price quotes)
CREATE TABLE IF NOT EXISTS public.app_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    guest_session_id TEXT NULL,
    store_id BIGINT NOT NULL REFERENCES public.stores(id),
    channel TEXT NOT NULL CHECK (channel IN ('PICKUP', 'DELIVERY')),
    pickup_method TEXT NOT NULL DEFAULT 'in_store' CHECK (pickup_method IN ('in_store', 'curbside', 'drive_thru')),
    cart_hash TEXT NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    tax_rate NUMERIC(6, 4) NOT NULL CHECK (tax_rate >= 0),
    tax_amount NUMERIC(10, 2) NOT NULL CHECK (tax_amount >= 0),
    delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
    tip_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (tip_amount >= 0),
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    price_source TEXT NOT NULL DEFAULT 'app_menu_cache',
    price_version TEXT NOT NULL DEFAULT 'v1',
    items_json JSONB NOT NULL,
    delivery_address JSONB NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
    consumed_at TIMESTAMPTZ NULL,
    consumed_order_id UUID NULL REFERENCES public.app_orders(id) ON DELETE SET NULL,
    idempotency_key TEXT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_quotes_store_status ON public.app_quotes(store_id, status);
CREATE INDEX IF NOT EXISTS idx_app_quotes_expires_at ON public.app_quotes(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_quotes_user_id ON public.app_quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_app_quotes_cart_hash ON public.app_quotes(cart_hash);

-- 2. Alter table: app_orders (Link authoritative quote and cart hash)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_orders' AND column_name = 'quote_id'
    ) THEN
        ALTER TABLE public.app_orders ADD COLUMN quote_id UUID REFERENCES public.app_quotes(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_orders' AND column_name = 'cart_hash'
    ) THEN
        ALTER TABLE public.app_orders ADD COLUMN cart_hash TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_orders_quote_id ON public.app_orders(quote_id);

-- 3. Table: app_payment_events (Immutable audit ledger for payment processor webhooks)
CREATE TABLE IF NOT EXISTS public.app_payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'toast', 'manual')),
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payment_intent_id TEXT NOT NULL,
    quote_id UUID NULL REFERENCES public.app_quotes(id) ON DELETE SET NULL,
    order_id UUID NULL REFERENCES public.app_orders(id) ON DELETE SET NULL,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_payment_events_pi ON public.app_payment_events(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_app_payment_events_quote ON public.app_payment_events(quote_id);
CREATE INDEX IF NOT EXISTS idx_app_payment_events_order ON public.app_payment_events(order_id);

-- 4. Table: app_order_outbox (Transactional outbox for idempotent external dispatches: Toast KDS & DoorDash)
CREATE TABLE IF NOT EXISTS public.app_order_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.app_orders(id) ON DELETE CASCADE,
    integration TEXT NOT NULL CHECK (integration IN ('toast_kds', 'doordash_drive', 'stripe_refund')),
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMPTZ NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ NULL,
    locked_by TEXT NULL,
    request_payload JSONB NULL,
    response_payload JSONB NULL,
    external_reference TEXT NULL,
    error_log TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_order_outbox_queue ON public.app_order_outbox(status, next_attempt_at) 
WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_app_order_outbox_order_integration ON public.app_order_outbox(order_id, integration);

-- 5. Row Level Security Policies
ALTER TABLE public.app_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_order_outbox ENABLE ROW LEVEL SECURITY;

-- Grants for authenticated users and service_role
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can read own quotes" ON public.app_quotes;
    CREATE POLICY "Users can read own quotes" ON public.app_quotes
        FOR SELECT TO authenticated
        USING (user_id = auth.uid());

    DROP POLICY IF EXISTS "Service role full access app_quotes" ON public.app_quotes;
    CREATE POLICY "Service role full access app_quotes" ON public.app_quotes
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Service role full access app_payment_events" ON public.app_payment_events;
    CREATE POLICY "Service role full access app_payment_events" ON public.app_payment_events
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Service role full access app_order_outbox" ON public.app_order_outbox;
    CREATE POLICY "Service role full access app_order_outbox" ON public.app_order_outbox
        FOR ALL TO service_role
        USING (true) WITH CHECK (true);
END $$;
