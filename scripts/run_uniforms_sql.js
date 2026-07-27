const { Client } = require('pg');

const regions = [
    'us-west-1', 'us-west-2', 'us-east-1', 'us-east-2',
    'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'ap-southeast-1', 'ap-northeast-1', 'ca-central-1', 'sa-east-1'
];

const username = 'postgres.ywwwdcvgfculqmcfkihq';
const password = '100Prechivas.com';
const dbName = 'postgres';

const sql = `
DROP TABLE IF EXISTS uniforms_transactions;
DROP TABLE IF EXISTS uniforms_inventory_stock;
DROP TABLE IF EXISTS uniforms_pricing;

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

INSERT INTO uniforms_pricing (item_category, display_name_es, display_name_en, sale_price, is_free_for_roles)
VALUES 
    ('shirt_red',    'Camisa Roja',    'Red Shirt',     7.00, '{}'),
    ('shirt_black',  'Camisa Negra',   'Black Shirt',   7.00, '{manager}'),
    ('cap_red',      'Gorra Roja',     'Red Cap',       1.00, '{}'),
    ('cap_black',    'Gorra Negra',    'Black Cap',     1.00, '{}'),
    ('jacket_red',   'Chamarra Roja',  'Red Jacket',   20.00, '{}'),
    ('jacket_black', 'Chamarra Negra', 'Black Jacket', 20.00, '{}');

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

CREATE INDEX idx_uniforms_stock_store ON uniforms_inventory_stock(store_id);
CREATE INDEX idx_uniforms_tx_store_date ON uniforms_transactions(store_id, business_date);
CREATE INDEX idx_uniforms_tx_employee ON uniforms_transactions(employee_toast_guid);
CREATE INDEX idx_uniforms_tx_type ON uniforms_transactions(transaction_type);

ALTER TABLE uniforms_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE uniforms_inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE uniforms_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uniforms_pricing_all" ON uniforms_pricing FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "uniforms_stock_all" ON uniforms_inventory_stock FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "uniforms_tx_all" ON uniforms_transactions FOR ALL USING (true) WITH CHECK (true);
`;

async function testRegion(region) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://${username}:${password}@${host}:6543/${dbName}`;
    
    console.log(`Testing ${region}...`);
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        console.log(`\n🎉 Connected to ${region}!`);
        console.log(`Running uniforms SQL...`);
        await client.query(sql);
        console.log(`✅ All tables created successfully!`);
        
        // Verify
        const res = await client.query('SELECT item_category, sale_price FROM uniforms_pricing ORDER BY item_category');
        console.log(`\nVerification - uniforms_pricing (${res.rows.length} rows):`);
        res.rows.forEach(r => console.log(`   ${r.item_category}: $${r.sale_price}`));
        
        await client.end();
        return true;
    } catch (e) {
        console.log(`❌ Failed: ${e.message}`);
        try { await client.end(); } catch (err) {}
        return false;
    }
}

(async () => {
    for (const region of regions) {
        const ok = await testRegion(region);
        if (ok) {
            console.log("\n🎉 UNIFORMS MODULE READY!");
            process.exit(0);
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.log("\n❌ Could not connect to any pooler region.");
    process.exit(1);
})();
