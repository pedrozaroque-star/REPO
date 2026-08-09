import { getSupabaseAdminClient } from '../lib/supabase';
import { fetchRecentStoreEstimates, fetchQBEstimateForReception } from '../app/inventory/uniforms/actions';

async function testUniformsIntegration() {
  console.log('=== 🎽 TESTING UNIFORMS & BODEGA ORDERS INTEGRATION ===\n');
  const supabase = await getSupabaseAdminClient();

  // 1. Check store_order_template for order_type = 'uniforms'
  const { data: uniTemplates, error: tErr } = await supabase
    .from('store_order_template')
    .select('*, inventory_items(name)')
    .eq('order_type', 'uniforms');

  if (tErr) {
    console.error('❌ Error reading store_order_template for uniforms:', tErr.message);
  } else {
    console.log(`✅ Master Uniform Template in store_order_template: ${uniTemplates?.length || 0} items found.`);
    uniTemplates?.slice(0, 10).forEach(t => console.log(`   - Item: "${(t.inventory_items as any)?.name || t.qb_item_name}" (QB Item ID: ${t.qb_item_id})`));
  }

  // 2. Check recent uniform orders in inventory_orders
  const { data: LynwoodStore } = await supabase.from('stores').select('id, name').ilike('name', '%lynwood%').single();
  const storeId = LynwoodStore ? LynwoodStore.id : 14;

  console.log(`\nTesting recent uniform estimates for Lynwood (store_id = ${storeId})...`);
  const recentEstimates = await fetchRecentStoreEstimates(storeId);
  console.log(`✅ fetchRecentStoreEstimates returned ${recentEstimates.length} orders for store ${storeId}.`);
  recentEstimates.forEach(est => {
    console.log(`   - Estimate #${est.qb_estimate_number} (ID: ${est.id}) | Status: ${est.status} | Created: ${est.created_at}`);
  });

  // 3. Test reception search if any order exists
  if (recentEstimates.length > 0) {
    const targetEst = recentEstimates[0].qb_estimate_number || recentEstimates[0].id;
    console.log(`\nTesting fetchQBEstimateForReception for search term: "${targetEst}"...`);
    const receptionData = await fetchQBEstimateForReception(storeId, targetEst);
    console.log(`✅ Reception Search Result (Found: ${reconciliationResult(receptionData.found)}):`);
    console.log(`   - Order Number: ${receptionData.orderNumber}`);
    console.log(`   - Items count: ${receptionData.items.length}`);
    receptionData.items.forEach(i => {
      console.log(`     * Category: ${i.category}, Size: ${i.size}, Ordered Qty: ${i.orderedQty}`);
    });
  } else {
    console.log('\nℹ️ No previous uniform orders found in DB for Lynwood. The reception search will accept manual input or any new order created in Bodega Orders.');
  }

  console.log('\n=== INTEGRATION TEST COMPLETED SUCCESSFULLY ===');
}

function reconciliationResult(found: boolean) {
  return found ? 'YES' : 'NO';
}

testUniformsIntegration().catch(console.error);
