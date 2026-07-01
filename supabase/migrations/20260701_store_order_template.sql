-- Migration: Add store_order_template table for per-store order templates
-- Date: 2026-07-01
-- Description: Mapea qué items del catálogo participan en el pedido de cada tienda.

CREATE TABLE IF NOT EXISTS store_order_template (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    qb_item_id TEXT NOT NULL,
    qb_item_name TEXT NOT NULL,
    sort_position INT DEFAULT 999,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(store_id, inventory_item_id)
);

-- Index for fast retrieval on store_id
CREATE INDEX IF NOT EXISTS idx_store_order_template_store ON store_order_template(store_id);

-- Enable RLS but allow authenticated/service_role access
ALTER TABLE store_order_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON store_order_template
    FOR SELECT TO public USING (true);

CREATE POLICY "Allow service_role full access" ON store_order_template
    FOR ALL TO service_role USING (true);
