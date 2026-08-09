import { getSupabaseAdminClient } from '../lib/supabase';

async function auditUniformsModule() {
  console.log('=== 🎽 DEEP AUDIT: UNIFORMS CONTROL & CAJA FUERTE INTEGRATION ===\n');
  const supabase = await getSupabaseAdminClient();

  // 1. Audit uniforms_pricing
  const { data: pricing, error: pErr } = await supabase.from('uniforms_pricing').select('*');
  if (pErr) {
    console.error('❌ Error fetching uniforms_pricing:', pErr.message);
  } else {
    console.log(`✅ uniforms_pricing table: ${pricing?.length || 0} categories configured.`);
    pricing?.forEach(p => console.log(`   - ${p.item_category}: $${p.sale_price}`));
  }

  // 2. Audit uniforms_inventory_stock
  const { data: stock, error: sErr } = await supabase.from('uniforms_inventory_stock').select('*');
  if (sErr) {
    console.error('❌ Error fetching uniforms_inventory_stock:', sErr.message);
  } else {
    console.log(`\n✅ uniforms_inventory_stock table: ${stock?.length || 0} total stock records.`);
    const activeStoresWithStock = new Set((stock || []).map(s => s.store_id));
    console.log(`   - Stores with stock initialized: ${activeStoresWithStock.size} stores (${Array.from(activeStoresWithStock).join(', ')})`);
  }

  // 3. Audit uniforms_transactions
  const { data: txs, error: tErr } = await supabase.from('uniforms_transactions').select('*');
  if (tErr) {
    console.error('❌ Error fetching uniforms_transactions:', tErr.message);
  } else {
    console.log(`\n✅ uniforms_transactions table: ${txs?.length || 0} total transactions logged.`);
    const txTypes = Array.from(new Set((txs || []).map(t => t.transaction_type)));
    console.log(`   - Distinct transaction_types found in DB:`, txTypes);
    
    // Check sales total vs safe reconciliation logic
    const salesTx = (txs || []).filter(t => t.transaction_type === 'employee_sale');
    const totalSalesAmount = salesTx.reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0);
    console.log(`   - Total employee_sale transactions: ${salesTx.length}, Total cash/sales value: $${totalSalesAmount.toFixed(2)}`);
  }

  // 4. Audit safe-reconciliation API logic
  console.log('\n--- 🔒 CAJA FUERTE RECONCILIATION API SIMULATION ---');
  // Check Lynwood store (store_id = 1 or whatever id Lynwood has)
  const { data: lynwoodStore } = await supabase.from('stores').select('id, name').ilike('name', '%lynwood%').single();
  if (lynwoodStore) {
    console.log(`Testing Lynwood store ID = ${lynwoodStore.id} (${lynwoodStore.name})`);
    const today = new Date().toISOString().split('T')[0];
    const { data: lynwoodSales } = await supabase
      .from('uniforms_transactions')
      .select('total_amount, business_date, transaction_type')
      .eq('store_id', lynwoodStore.id)
      .eq('transaction_type', 'employee_sale');
    
    console.log(`   - Sales found for Lynwood: ${lynwoodSales?.length || 0} transactions.`);
    lynwoodSales?.forEach(s => console.log(`     * Date: ${s.business_date}, Amount: $${s.total_amount}`));
  }

  console.log('\n=== AUDIT COMPLETED SUCCESSFULLY ===');
}

auditUniformsModule().catch(console.error);
