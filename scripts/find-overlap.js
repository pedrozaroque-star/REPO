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

async function findOverlap() {
  const { data: supplierMappings } = await supabase
    .from('supplier_item_mappings')
    .select('id, supplier_sku, supplier_description, master_item_id, inventory_items(id, name, sku, purchase_unit_cost, is_bodega)');

  const { data: qbMappings } = await supabase
    .from('quickbooks_mappings')
    .select('id, qb_item_id, qb_item_name, last_fetch_cost, inventory_item_id');

  const qbMap = new Map();
  (qbMappings || []).forEach(q => {
    qbMap.set(q.inventory_item_id, q);
  });

  const overlap = [];
  (supplierMappings || []).forEach(s => {
    if (s.master_item_id && qbMap.has(s.master_item_id)) {
      const q = qbMap.get(s.master_item_id);
      overlap.push({
        supplier_sku: s.supplier_sku,
        supplier_desc: s.supplier_description,
        master_name: s.inventory_items?.name,
        master_id: s.master_item_id,
        is_bodega: s.inventory_items?.is_bodega,
        qb_mapping_id: q.id,
        qb_item_name: q.qb_item_name,
        qb_cost: q.last_fetch_cost,
        current_inv_cost: s.inventory_items?.purchase_unit_cost
      });
    }
  });

  console.log(`=== OVERLAPPING ITEMS (Mapped to BOTH Supplier & QB): ${overlap.length} items ===`);
  console.log(JSON.stringify(overlap, null, 2));
}

findOverlap().catch(console.error);
