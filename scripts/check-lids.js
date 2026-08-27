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

async function checkItem() {
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select('id, supplier_sku, supplier_description, pack_quantity, pack_unit, master_item_id, inventory_items(id, name, sku, purchase_unit_cost, quantity_per_unit)')
    .in('supplier_sku', ['EL4LID', 'KDL76PP']);

  console.log('MAPPINGS IN DB:');
  console.log(JSON.stringify(mappings, null, 2));

  // Check inventory_items with LID or 4oz
  const { data: invItems } = await supabase
    .from('inventory_items')
    .select('id, name, sku, purchase_unit_cost, quantity_per_unit, unit_measure')
    .or('name.ilike.%tapa%,name.ilike.%lid%,sku.ilike.%EL4LID%,sku.ilike.%KDL76PP%');

  console.log('INVENTORY ITEMS:');
  console.log(JSON.stringify(invItems, null, 2));

  // Check recipes using this inventory_item
  if (invItems && invItems.length > 0) {
    const itemIds = invItems.map(i => i.id);
    const { data: recipeIngs } = await supabase
      .from('recipe_ingredients')
      .select('id, recipe_id, inventory_item_id, quantity, recipes(id, name)')
      .in('inventory_item_id', itemIds);

    console.log('RECIPE INGREDIENTS USING LIDS:');
    console.log(JSON.stringify(recipeIngs, null, 2));
  }
}
checkItem().catch(console.error);
