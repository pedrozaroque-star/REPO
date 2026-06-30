require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    // Get ONLY the 52 orderable items (the ones with excel_reference = the bodega order items)
    const {data: orderItems} = await s
        .from('inventory_items')
        .select('id, name, excel_reference, order_sort_position, order_unit_description')
        .not('excel_reference', 'is', null)
        .not('order_sort_position', 'is', null)
        .order('order_sort_position', {ascending: true});

    // Get QB mappings
    const {data: mappings} = await s
        .from('quickbooks_mappings')
        .select('inventory_item_id, qb_item_id, qb_item_name');

    const qbMap = new Map();
    mappings?.forEach(m => qbMap.set(m.inventory_item_id, m));

    console.log('=== AUDITORÍA: 52 Items del Pedido a Bodega vs QuickBooks ===\n');

    let matched = 0;
    let missing = 0;

    console.log(' #  | Excel Name (Pedido)              | QB Mapped? | QB Item Name in QuickBooks');
    console.log('----|----------------------------------|------------|------------------------------------------');

    orderItems?.forEach((item, i) => {
        const qb = qbMap.get(item.id);
        if (qb) matched++;
        else missing++;
        
        const excelName = (item.excel_reference || '').padEnd(32);
        const status = qb ? '✅' : '❌';
        const qbName = qb?.qb_item_name || '⚠️  NO TIENE MAPEO QB';
        
        console.log(`${String(i+1).padStart(3)} | ${excelName} | ${status}         | ${qbName}`);
    });

    console.log(`\n=== RESUMEN ===`);
    console.log(`Total items del pedido: ${orderItems?.length}`);
    console.log(`✅ Con mapeo QB: ${matched}`);
    console.log(`❌ Sin mapeo QB: ${missing}`);
    
    if (missing > 0) {
        console.log('\n🔴 ESTOS ITEMS NO SE ENVIARÁN EN EL ESTIMATE:');
        orderItems?.forEach(item => {
            if (!qbMap.has(item.id)) {
                console.log(`   → ${item.excel_reference} (${item.name})`);
            }
        });
    } else {
        console.log('\n🟢 TODOS los items del pedido tienen mapeo QB. El Estimate estará completo.');
    }
})();
