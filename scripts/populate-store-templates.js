/**
 * Populate store_order_template with items from QBO Recurring Transactions.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function qbQuery(realmId, accessToken, sql) {
    const r = await axios.get(`https://quickbooks.api.intuit.com/v3/company/${realmId}/query`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
        params: { query: sql, minorversion: 75 }
    });
    return r.data?.QueryResponse?.RecurringTransaction || [];
}

(async () => {
    console.log('🏁 Iniciando población de templates por tienda desde Recurring Transactions...');
    
    // 1. Obtener la conexión de QuickBooks
    const { data: integ } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    if (!integ) {
        console.error('❌ No se encontró la integración de QuickBooks en la base de datos.');
        process.exit(1);
    }

    // 2. Obtener las tiendas activas con qb_customer_id
    const { data: stores } = await supabase.from('stores').select('id, name, qb_customer_id')
        .not('qb_customer_id', 'is', null).order('name');
    
    console.log(`🏪 Tiendas encontradas con QB Customer ID: ${stores.length}`);

    // 3. Obtener todos los mappings de QB actuales
    const { data: mappings } = await supabase.from('quickbooks_mappings').select('inventory_item_id, qb_item_id, qb_item_name');
    const qbMap = new Map();
    mappings?.forEach(m => qbMap.set(String(m.qb_item_id), m));
    console.log(`🔗 Mappings de QB cargados: ${mappings.length}`);

    // Limpiar tabla antes de poblar para tener un estado fresco
    console.log('🧹 Limpiando tabla store_order_template...');
    await supabase.rpc('execute_sql', { query_text: 'SELECT 1 ) t; TRUNCATE TABLE store_order_template; SELECT * FROM (SELECT 1' });

    // 4. Consultar todos los RecurringTransactions
    console.log('🔄 Consultando todos los RecurringTransactions de QBO...');
    const allRecurring = await qbQuery(integ.realm_id, integ.access_token, "SELECT * FROM RecurringTransaction");
    console.log(`📊 Encontrados ${allRecurring.length} recurring transactions en QB.`);

    // Agrupar los templates por Customer ID
    const dailyTemplatesByCustomerId = new Map();
    let liquidsTemplate = null;

    allRecurring.forEach(t => {
        if (!t.Estimate) return;
        const est = t.Estimate;
        const templateName = (est.RecurringInfo?.Name || '').toLowerCase();
        const customerId = est.CustomerRef?.value;

        if (templateName.includes('orden diaria')) {
            dailyTemplatesByCustomerId.set(String(customerId), est);
        } else if (templateName.includes('liquido') || templateName.includes('liquidos')) {
            liquidsTemplate = est;
        }
    });

    let totalInserted = 0;

    // A. Insertar templates Diarios por tienda
    for (const store of stores) {
        console.log(`\n🏪 Tienda: ${store.name}`);
        const est = dailyTemplatesByCustomerId.get(String(store.qb_customer_id));
        if (!est) {
            console.log(`  ⚠️ No se encontró plantilla "Orden Diaria" para esta tienda.`);
            continue;
        }

        const lines = est.Line || [];
        console.log(`  📝 Leyendo plantilla "${est.RecurringInfo?.Name}" - ${lines.length} líneas...`);

        const toInsert = [];
        let pos = 1;
        
        for (const line of lines) {
            if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                const qbItemName = line.SalesItemLineDetail.ItemRef.name || 'Unknown';
                
                const mapping = qbMap.get(String(qbItemId));
                if (!mapping) {
                    console.warn(`  ⚠️ Item sin mapping: "${qbItemName}" (QB ID: ${qbItemId}) - Omitiendo`);
                    continue;
                }

                toInsert.push({
                    store_id: store.id,
                    inventory_item_id: mapping.inventory_item_id,
                    qb_item_id: qbItemId,
                    qb_item_name: qbItemName,
                    sort_position: pos++,
                    order_type: 'daily'
                });
            }
        }

        if (toInsert.length > 0) {
            const { error: insertErr } = await supabase.from('store_order_template').insert(toInsert);
            if (insertErr) {
                console.error(`  ❌ Error al insertar items de ${store.name}:`, insertErr.message);
            } else {
                console.log(`  ✅ Insertados ${toInsert.length} items diarios.`);
                totalInserted += toInsert.length;
            }
        }
    }

    // B. Insertar template único de Líquidos para todas las tiendas
    if (liquidsTemplate) {
        console.log(`\n🧴 Procesando template único de Líquidos: "${liquidsTemplate.RecurringInfo?.Name}"`);
        const lines = liquidsTemplate.Line || [];
        const liquidsItems = [];
        let pos = 1;

        for (const line of lines) {
            if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                const qbItemId = line.SalesItemLineDetail.ItemRef.value;
                const qbItemName = line.SalesItemLineDetail.ItemRef.name || 'Unknown';
                
                const mapping = qbMap.get(String(qbItemId));
                if (!mapping) continue;

                liquidsItems.push({
                    inventory_item_id: mapping.inventory_item_id,
                    qb_item_id: qbItemId,
                    qb_item_name: qbItemName,
                    sort_position: pos++
                });
            }
        }

        if (liquidsItems.length > 0) {
            const allStoresLiquids = [];
            stores.forEach(store => {
                liquidsItems.forEach(item => {
                    allStoresLiquids.push({
                        store_id: store.id,
                        inventory_item_id: item.inventory_item_id,
                        qb_item_id: item.qb_item_id,
                        qb_item_name: item.qb_item_name,
                        sort_position: item.sort_position,
                        order_type: 'liquids'
                    });
                });
            });

            // Insertar en lotes de 100
            for (let i = 0; i < allStoresLiquids.length; i += 100) {
                const batch = allStoresLiquids.slice(i, i + 100);
                const { error: insertErr } = await supabase.from('store_order_template').insert(batch);
                if (insertErr) {
                    console.error(`  ❌ Error insertando batch de líquidos:`, insertErr.message);
                } else {
                    totalInserted += batch.length;
                }
            }
            console.log(`  ✅ Template único de Líquidos sincronizado para las ${stores.length} tiendas (${liquidsItems.length} items c/u)`);
        }
    }

    console.log(`\n🎉 Población terminada. Total registros insertados en store_order_template: ${totalInserted}`);
})();
