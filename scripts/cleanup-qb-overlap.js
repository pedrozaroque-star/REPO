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

async function cleanup() {
  console.log('1. Finding QB mappings linked to external items (is_bodega: false)...');
  const { data: supplierMappings } = await supabase
    .from('supplier_item_mappings')
    .select('master_item_id, supplier_sku, inventory_items(id, name, is_bodega)');

  const externalItemIds = (supplierMappings || [])
    .filter(s => s.master_item_id && s.inventory_items?.is_bodega === false)
    .map(s => s.master_item_id);

  console.log(`Found ${externalItemIds.length} external items mapped to suppliers.`);

  const { data: deleted, error: delError } = await supabase
    .from('quickbooks_mappings')
    .delete()
    .in('inventory_item_id', externalItemIds)
    .select();

  if (delError) {
    console.error('Error deleting QB mappings:', delError);
  } else {
    console.log(`Deleted ${deleted?.length || 0} overlapping QB mappings for external items.`);
  }

  // 2. Restore 7 syrups to $118.32
  const syrups = ['BCLCO', 'BDICO', 'BSPRI', 'BMMLE', 'BMMOR', 'BSTRA', 'BRATE'];
  console.log(`2. Restoring approved price ($118.32) for syrups: ${syrups.join(', ')}...`);
  const { data: updated, error: upError } = await supabase
    .from('inventory_items')
    .update({ purchase_unit_cost: 118.32, updated_at: new Date().toISOString() })
    .in('sku', syrups)
    .select();

  if (upError) {
    console.error('Error updating syrups:', upError);
  } else {
    console.log(`Updated ${updated?.length || 0} syrups to $118.32.`);
  }
}

cleanup().catch(console.error);
