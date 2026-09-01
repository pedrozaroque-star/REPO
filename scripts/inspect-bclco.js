const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve('.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
    const idx = l.indexOf('=');
    if (idx > 0 && !l.trim().startsWith('#')) {
      env[l.substring(0, idx).trim()] = l.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  });
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectBclco() {
  console.log('=== BCLCO MAPPING ===');
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select('*, inventory_items(*)')
    .eq('supplier_sku', 'BCLCO');
  console.log(JSON.stringify(mappings, null, 2));

  console.log('=== BCLCO HISTORY IN supplier_price_history ===');
  const { data: history } = await supabase
    .from('supplier_price_history')
    .select('*')
    .eq('supplier_sku', 'BCLCO')
    .order('created_at', { ascending: false });
  console.log(JSON.stringify(history, null, 2));

  console.log('=== ALL COCA-COLA ITEMS IN INVENTORY_ITEMS ===');
  const { data: inv } = await supabase
    .from('inventory_items')
    .select('id, sku, name, purchase_unit_cost, quantity_per_unit, unit_measure')
    .or('sku.ilike.%BCLCO%,name.ilike.%coca%,name.ilike.%coke%');
  console.log(JSON.stringify(inv, null, 2));
}

inspectBclco().catch(console.error);
