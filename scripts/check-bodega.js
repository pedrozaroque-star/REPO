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

async function checkBodega() {
  const { data: allItems } = await supabase
    .from('inventory_items')
    .select('id, name, sku, is_bodega, purchase_unit_cost');

  const bodegaItems = allItems.filter(i => i.is_bodega === true);
  const restaurantItems = allItems.filter(i => i.is_bodega === false || i.is_bodega === null);

  console.log(`Total items: ${allItems.length}`);
  console.log(`Bodega items (is_bodega: true): ${bodegaItems.length}`);
  console.log(`Restaurant / External items (is_bodega: false/null): ${restaurantItems.length}`);

  // Check 8 syrups is_bodega
  const syrups = allItems.filter(i => ['BCLCO', 'BDICO', 'BSPRI', 'BMMLE', 'BMMOR', 'BSTRA', 'BRATE', 'BZECO'].includes(i.sku));
  console.log('Syrups is_bodega:');
  syrups.forEach(s => console.log(`  • ${s.sku}: ${s.name} -> is_bodega: ${s.is_bodega}, cost: $${s.purchase_unit_cost}`));
}

checkBodega().catch(console.error);
