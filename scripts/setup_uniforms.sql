-- PASO 1: Limpiar tablas anteriores (orden importa por dependencias)
DROP TABLE IF EXISTS uniforms_transactions;
DROP TABLE IF EXISTS uniforms_inventory_stock;
DROP TABLE IF EXISTS uniforms_pricing;

-- PASO 2: Crear tabla de precios
CREATE TABLE uniforms_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_category TEXT UNIQUE NOT NULL,
    display_name_es TEXT NOT NULL,
    display_name_en TEXT NOT NULL,
    sale_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_free_for_roles TEXT[] DEFAULT '{}',
    provider_name TEXT,
    provider_cost NUMERIC(10, 2) DEFAULT 0,
    effective_from TIMESTAMPTZ DEFAULT now(),
    notes TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- PASO 3: Insertar 6 categorias de uniformes
INSERT INTO uniforms_pricing (item_category, display_name_es, display_name_en, sale_price, is_free_for_roles)
VALUES 
    ('shirt_red',    'Camisa Roja',    'Red Shirt',     7.00, '{}'),
    ('shirt_black',  'Camisa Negra',   'Black Shirt',   7.00, '{manager}'),
    ('cap_red',      'Gorra Roja',     'Red Cap',       1.00, '{}'),
    ('cap_black',    'Gorra Negra',    'Black Cap',     1.00, '{}'),
    ('jacket_red',   'Chamarra Roja',  'Red Jacket',   20.00, '{}'),
    ('jacket_black', 'Chamarra Negra', 'Black Jacket', 20.00, '{}');

-- PASO 4: Crear tabla de stock por tienda
CREATE TABLE uniforms_inventory_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    item_category TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT 'ONE_SIZE',
    quantity_on_hand NUMERIC NOT NULL DEFAULT 0,
    min_stock NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(store_id, item_category, size)
);

-- PASO 5: Crear tabla de transacciones
CREATE TABLE uniforms_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    item_category TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT 'ONE_SIZE',
    transaction_type TEXT NOT NULL,
    quantity NUMERIC NOT NULL,
    previous_stock NUMERIC NOT NULL DEFAULT 0,
    new_stock NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC(10, 2),
    total_amount NUMERIC(10, 2),
    employee_toast_guid TEXT,
    employee_name TEXT,
    reason TEXT,
    reference_order_id UUID,
    business_date DATE NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- PASO 6: Indices
CREATE INDEX idx_uniforms_stock_store ON uniforms_inventory_stock(store_id);
CREATE INDEX idx_uniforms_tx_store_date ON uniforms_transactions(store_id, business_date);
CREATE INDEX idx_uniforms_tx_employee ON uniforms_transactions(employee_toast_guid);
CREATE INDEX idx_uniforms_tx_type ON uniforms_transactions(transaction_type);

-- PASO 7: RLS
ALTER TABLE uniforms_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE uniforms_inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE uniforms_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uniforms_pricing_all" ON uniforms_pricing FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "uniforms_stock_all" ON uniforms_inventory_stock FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "uniforms_tx_all" ON uniforms_transactions FOR ALL USING (true) WITH CHECK (true);
