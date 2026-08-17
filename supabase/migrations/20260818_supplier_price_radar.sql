-- Migration: Supplier Price Radar & Multi-Vendor Inventory Mapping Architecture
-- Target: Tacos Gavilan (TEG Modernizado)
-- Date: 2026-08-18

-- 1. Create suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    supplier_code TEXT UNIQUE,
    category TEXT DEFAULT 'general',
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    portal_url TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create supplier_item_mappings table (Decoupled translation layer)
CREATE TABLE IF NOT EXISTS supplier_item_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_sku TEXT NOT NULL,
    supplier_description TEXT NOT NULL,
    master_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    pack_quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
    pack_unit TEXT NOT NULL DEFAULT 'CS',
    base_unit TEXT NOT NULL DEFAULT 'pza',
    is_primary BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(supplier_id, supplier_sku)
);

-- 3. Create supplier_price_history table (Inflation & Price Increase Tracking)
CREATE TABLE IF NOT EXISTS supplier_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_sku TEXT NOT NULL,
    master_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    case_price NUMERIC(12, 4) NOT NULL,
    unit_cost NUMERIC(12, 4) NOT NULL,
    previous_unit_cost NUMERIC(12, 4),
    change_percent NUMERIC(8, 2),
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    source_type TEXT NOT NULL DEFAULT 'clipboard',
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Indexes for High Performance
CREATE INDEX IF NOT EXISTS idx_supplier_mappings_sku ON supplier_item_mappings(supplier_sku);
CREATE INDEX IF NOT EXISTS idx_supplier_mappings_master ON supplier_item_mappings(master_item_id);
CREATE INDEX IF NOT EXISTS idx_supplier_price_history_sku ON supplier_price_history(supplier_sku);
CREATE INDEX IF NOT EXISTS idx_supplier_price_history_date ON supplier_price_history(effective_date);
CREATE INDEX IF NOT EXISTS idx_supplier_price_history_master ON supplier_price_history(master_item_id);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_price_history ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
DROP POLICY IF EXISTS "suppliers_policy_all" ON suppliers;
CREATE POLICY "suppliers_policy_all" ON suppliers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "supplier_mappings_policy_all" ON supplier_item_mappings;
CREATE POLICY "supplier_mappings_policy_all" ON supplier_item_mappings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "supplier_price_history_policy_all" ON supplier_price_history;
CREATE POLICY "supplier_price_history_policy_all" ON supplier_price_history FOR ALL USING (true) WITH CHECK (true);
