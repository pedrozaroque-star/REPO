// Run SQL migration via Supabase Management API
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    // Extract project ref from URL (e.g., https://xyz.supabase.co → xyz)
    const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
    console.log('Project ref:', projectRef);
    
    // We'll use the pooler connection via supabase-js with raw SQL via postgres functions
    // Since we can't run raw SQL directly, let's create a temporary RPC function first
    // Actually, let's use the pg module
    
    // Alternative: use the local API endpoint to run migration
    const baseUrl = 'http://localhost:3000';
    
    // Create a temporary API endpoint that runs the migration
    const s = createClient(supabaseUrl, serviceKey);
    
    // Try creating table using supabase-js (this works for simple DDL via REST)
    // Actually supabase-js doesn't support DDL. Let's create via a different approach.
    
    // Use the Management API with the service key
    // POST to /sql endpoint (available since Supabase v2)
    const sqlEndpoint = `https://${projectRef}.supabase.co/pg/query`;
    
    const migrations = [
        {
            name: 'Create food_cost_anomalies table',
            sql: `CREATE TABLE IF NOT EXISTS food_cost_anomalies (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                business_date DATE NOT NULL,
                store_id UUID,
                item_name TEXT NOT NULL,
                toast_item_guid TEXT,
                food_cost_percent NUMERIC(10,2),
                total_cost NUMERIC(10,2),
                quantity INTEGER DEFAULT 0,
                severity TEXT DEFAULT 'warning',
                resolved BOOLEAN DEFAULT FALSE,
                resolved_at TIMESTAMPTZ,
                resolved_by TEXT,
                detected_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )`
        },
        {
            name: 'Create index',
            sql: `CREATE INDEX IF NOT EXISTS idx_fc_anomalies_unresolved ON food_cost_anomalies(resolved, business_date) WHERE resolved = FALSE`
        },
        {
            name: 'Create trigger function',
            sql: `CREATE OR REPLACE FUNCTION invalidate_food_cost_cache_on_inventory_change()
            RETURNS TRIGGER AS $$
            BEGIN
                IF (OLD.quantity_per_unit IS DISTINCT FROM NEW.quantity_per_unit)
                   OR (OLD.purchase_unit_cost IS DISTINCT FROM NEW.purchase_unit_cost)
                   OR (OLD.unit_measure IS DISTINCT FROM NEW.unit_measure) THEN
                    DELETE FROM food_cost_daily_cache 
                    WHERE business_date >= (CURRENT_DATE - INTERVAL '3 days');
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql`
        },
        {
            name: 'Drop old trigger',
            sql: `DROP TRIGGER IF EXISTS trg_invalidate_fc_cache_on_inventory_change ON inventory_items`
        },
        {
            name: 'Create trigger',
            sql: `CREATE TRIGGER trg_invalidate_fc_cache_on_inventory_change
                AFTER UPDATE ON inventory_items
                FOR EACH ROW
                EXECUTE FUNCTION invalidate_food_cost_cache_on_inventory_change()`
        }
    ];

    for (const m of migrations) {
        try {
            const res = await fetch(sqlEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json',
                    'apikey': serviceKey
                },
                body: JSON.stringify({ query: m.sql })
            });
            
            if (res.ok) {
                console.log(`✅ ${m.name}`);
            } else {
                const text = await res.text();
                // Try alternative endpoint
                const res2 = await fetch(`https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${serviceKey}`,
                        'Content-Type': 'application/json',
                        'apikey': serviceKey
                    },
                    body: JSON.stringify({ sql: m.sql })
                });
                
                if (res2.ok) {
                    console.log(`✅ ${m.name} (via rpc)`);
                } else {
                    console.log(`❌ ${m.name}: ${res.status} — ${text.substring(0, 100)}`);
                }
            }
        } catch (e) {
            console.log(`❌ ${m.name}: ${e.message}`);
        }
    }

    // Verify
    const { error } = await s.from('food_cost_anomalies').select('id').limit(1);
    console.log('\nVerificación:', error ? `❌ ${error.message}` : '✅ Tabla existe');
}

main().catch(console.error);
