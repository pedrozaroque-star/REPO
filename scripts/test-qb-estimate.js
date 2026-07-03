/**
 * Test COMPLETO: 49 items — lee tokens directos de Supabase (recién autenticados)
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const QuickBooks = require('node-quickbooks');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    // Lee tokens FRESCOS directo de Supabase (recién guardados por el callback de Vercel)
    const { data: integration } = await supabase
        .from('integrations').select('*').eq('service_name', 'quickbooks').single();

    if (!integration) { console.log('❌ No integration found'); return; }
    console.log('✅ Token from DB, expires:', new Date(integration.expires_at).toLocaleString());

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
        false, null, '2.0', integration.refresh_token
    );

    // 1. Obtener los 49 items ordenables con su QB mapping
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, excel_reference, order_sort_position')
        .not('excel_reference', 'is', null)
        .order('order_sort_position', { ascending: true });

    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('inventory_item_id, qb_item_id, qb_item_name');

    const qbMap = new Map();
    mappings?.forEach(m => qbMap.set(m.inventory_item_id, m));

    // 2. Construir líneas
    const lines = [];
    console.log('\n📋 Items:');
    items?.forEach((item, i) => {
        const qb = qbMap.get(item.id);
        if (!qb) { console.log(`  ⚠️ ${item.excel_reference} — SIN MAPPING`); return; }
        lines.push({
            DetailType: 'SalesItemLineDetail',
            Amount: 0,
            SalesItemLineDetail: { ItemRef: { value: qb.qb_item_id }, Qty: 1, UnitPrice: 0 }
        });
        console.log(`  ${String(i+1).padStart(3)}. ${(item.excel_reference||'').padEnd(32)} → ${qb.qb_item_name}`);
    });

    // 3. Siguiente DocNumber
    const recentEstimates = await new Promise((resolve, reject) => {
        qbo.findEstimates({ fetchAll: false, limit: 20, desc: 'MetaData.LastUpdatedTime' }, (err, result) => {
            if (err) reject(err);
            else resolve(result?.QueryResponse?.Estimate || []);
        });
    });
    let maxNum = 0;
    for (const est of recentEstimates) {
        if (est.DocNumber) { const n = parseInt(est.DocNumber, 10); if (!isNaN(n) && n > maxNum) maxNum = n; }
    }
    const nextDocNumber = String(maxNum + 1);
    console.log(`\n📊 Max DocNumber: ${maxNum} → Siguiente: ${nextDocNumber}`);
    console.log(`📦 Total items: ${lines.length}`);

    // 4. Crear Estimate
    const today = new Date().toISOString().split('T')[0];
    console.log(`\n📤 Enviando a Lynwood-TEG...`);

    try {
        const estimate = await new Promise((resolve, reject) => {
            qbo.createEstimate({
                DocNumber: nextDocNumber,
                CustomerRef: { value: '1108' },
                TxnDate: today,
                CustomerMemo: { value: `🧪 PRUEBA COMPLETA (${lines.length} items) - NO CONVERTIR A INVOICE\nPedido Lynwood - ${today}` },
                PrivateNote: `🧪 TEST ${lines.length} items - ELIMINAR`,
                Line: lines,
            }, (err, result) => { if (err) reject(err); else resolve(result); });
        });

        console.log('\n✅ ¡ESTIMATE COMPLETO CREADO!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Estimate #:', estimate.DocNumber);
        console.log('ID:        ', estimate.Id);
        console.log('Customer:  ', estimate.CustomerRef?.name);
        console.log('Total:     $' + estimate.TotalAmt);
        console.log('Items:     ', estimate.Line?.filter(l => l.DetailType === 'SalesItemLineDetail').length);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n⚠️  Admin QB: Estimate #' + estimate.DocNumber + ' Lynwood-TEG → ELIMINAR');
    } catch (err) {
        console.log('❌ Error:', err?.data?.fault?.error || err.message || JSON.stringify(err).substring(0, 500));
    }
})();
