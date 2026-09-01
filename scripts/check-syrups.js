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

async function checkSyrups() {
  const skus = ['BCLCO', 'BDICO', 'BSPRI', 'BMMLE', 'BMMOR', 'BSTRA', 'BRATE', 'BZECO'];
  const { data: items } = await supabase
    .from('inventory_items')
    .select('sku, name, purchase_unit_cost')
    .in('sku', skus);

  console.log('=== 8 SYRUPS IN INVENTORY_ITEMS ===');
  console.log(JSON.stringify(items, null, 2));
}

checkSyrups().catch(console.error);
