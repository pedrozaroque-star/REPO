-- 📱 ESQUEMA DE BASE DE DATOS PARA LA APLICACIÓN MÓVIL TACOS GAVILÁN (MVP)
-- Migración: 20260530000000_mobile_app_schema.sql
-- Propósito: Crear tablas de usuarios de app, carritos, caché de menú, órdenes de compra y programa de lealtad.

-- 1. Perfiles de Usuario (Extensión de Supabase Auth Users)
CREATE TABLE IF NOT EXISTS public.app_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    phone VARCHAR(20) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_users_phone ON public.app_users(phone);

-- 2. Dispositivos y Push Tokens
CREATE TABLE IF NOT EXISTS public.app_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    push_token TEXT NOT NULL UNIQUE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android')),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_devices_user ON public.app_devices(user_id);

-- 3. Caché de Menú por Sucursal (Sincronizado desde Toast API)
-- NOTA CRÍTICA: store_id usa BIGINT para hacer match exacto con public.stores(id)
CREATE TABLE IF NOT EXISTS public.app_menu_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id BIGINT REFERENCES public.stores(id) ON DELETE CASCADE,
    category_name VARCHAR(100) NOT NULL,
    toast_item_guid UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    image_url TEXT,
    modifier_groups_json JSONB DEFAULT '[]'::jsonb, -- Cebolla, cilantro, doble carne, salsas
    is_available BOOLEAN DEFAULT true,
    last_synced TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_id, toast_item_guid)
);

CREATE INDEX IF NOT EXISTS idx_menu_cache_store ON public.app_menu_cache(store_id);

-- 4. Carritos de Compras Persistentes (Un carrito por usuario)
CREATE TABLE IF NOT EXISTS public.app_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    store_id BIGINT REFERENCES public.stores(id) ON DELETE CASCADE,
    items_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{item_guid, qty, price, modifiers: [...]}]
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- 5. Órdenes y Geofencing (Hold-and-Fire Status)
CREATE TABLE IF NOT EXISTS public.app_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    store_id BIGINT REFERENCES public.stores(id) ON DELETE RESTRICT,
    toast_order_guid UUID, -- Llenado cuando se dispara a la cocina real
    total_amount DECIMAL(10,2) NOT NULL,
    net_amount DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0.00,
    items_json JSONB NOT NULL, -- Snapshot de los productos y precios al ordenar
    pickup_method VARCHAR(30) NOT NULL CHECK (pickup_method IN ('curbside', 'in_store', 'drive_thru')),
    curbside_stall VARCHAR(20), -- Cajón de estacionamiento designado
    status VARCHAR(50) NOT NULL DEFAULT 'HOLDING' CHECK (status IN ('HOLDING', 'FIRED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PENDING', 'PAID', 'REFUNDED')),
    payment_intent_id VARCHAR(255), -- ID de Stripe/Adyen
    user_latitude DOUBLE PRECISION,
    user_longitude DOUBLE PRECISION,
    eta_minutes INTEGER, -- ETA estimado de arribo
    fired_at TIMESTAMP WITH TIME ZONE, -- Cuándo se imprimió en cocina
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_orders_status ON public.app_orders(status);
CREATE INDEX IF NOT EXISTS idx_app_orders_user ON public.app_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_app_orders_store ON public.app_orders(store_id);

-- 6. Combinaciones Favoritas
CREATE TABLE IF NOT EXISTS public.app_favorite_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    store_id BIGINT REFERENCES public.stores(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'Mi Combo Favorito',
    items_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_favorites_user ON public.app_favorite_orders(user_id);

-- 7. Puntos e Historial del Programa de Lealtad (Gavilán Rewards)
CREATE TABLE IF NOT EXISTS public.app_rewards_balances (
    user_id UUID PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
    points_balance INTEGER NOT NULL DEFAULT 0,
    points_accumulated INTEGER NOT NULL DEFAULT 0,
    points_redeemed INTEGER NOT NULL DEFAULT 0,
    tier VARCHAR(20) NOT NULL DEFAULT 'BRONZE' CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM'))
);

CREATE TABLE IF NOT EXISTS public.app_rewards_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.app_orders(id) ON DELETE SET NULL,
    points INTEGER NOT NULL, -- Positivo si suma, Negativo si redime
    type VARCHAR(30) NOT NULL CHECK (type IN ('EARN', 'BURN', 'PROMO', 'ADJUSTMENT')),
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_rewards_tx_user ON public.app_rewards_transactions(user_id);

-- 8. POLÍTICAS DE SEGURIDAD RLS (Row Level Security)
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_menu_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_favorite_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rewards_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rewards_transactions ENABLE ROW LEVEL SECURITY;

-- Políticas de Usuarios
CREATE POLICY "Users can view and edit their own profile" ON public.app_users
    FOR ALL USING (auth.uid() = id);

-- Políticas de Dispositivos
CREATE POLICY "Users can manage their own device tokens" ON public.app_devices
    FOR ALL USING (auth.uid() = user_id);

-- Políticas de Menú Cache (Público, lectura libre)
CREATE POLICY "Menu cache is publicly readable" ON public.app_menu_cache
    FOR SELECT USING (true);

-- Políticas de Carritos
CREATE POLICY "Users can manage their own cart" ON public.app_carts
    FOR ALL USING (auth.uid() = user_id);

-- Políticas de Órdenes
CREATE POLICY "Users can view and manage their own orders" ON public.app_orders
    FOR ALL USING (auth.uid() = user_id);

-- Políticas de Favoritos
CREATE POLICY "Users can manage their favorite orders" ON public.app_favorite_orders
    FOR ALL USING (auth.uid() = user_id);

-- Políticas de Balances de Recompensas
CREATE POLICY "Users can view their own reward balance" ON public.app_rewards_balances
    FOR SELECT USING (auth.uid() = user_id);

-- Políticas de Transacciones de Recompensas
CREATE POLICY "Users can view their own reward transactions" ON public.app_rewards_transactions
    FOR SELECT USING (auth.uid() = user_id);
