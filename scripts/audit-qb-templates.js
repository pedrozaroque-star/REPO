/**
 * Auditoría RÁPIDA: Query individual por tienda usando axios directo
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
    return r.data?.QueryResponse?.Estimate || [];
}

(async () => {
    const { data: integ } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    const { data: stores } = await supabase.from('stores').select('id, name, qb_customer_id')
        .not('qb_customer_id', 'is', null).order('name');

    console.log(`\n📊 Auditando ${stores.length} tiendas...\n`);

    const allItemNames = new Map();
    const storeTemplates = {};

    for (const store of stores) {
        try {
            // Get most recent estimate for this customer
            const sql = `SELECT * FROM Estimate WHERE CustomerRef = '${store.qb_customer_id}' ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS 1`;
            const estimates = await qbQuery(integ.realm_id, integ.access_token, sql);
            
            if (estimates.length === 0) {
                console.log(`  ⚠️  ${store.name.padEnd(22)} Sin estimates`);
                storeTemplates[store.name] = { items: new Set(), count: 0 };
                continue;
            }

            const est = estimates[0];
            const items = new Set();
            (est.Line || []).forEach(line => {
                if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail?.ItemRef?.value) {
                    const id = line.SalesItemLineDetail.ItemRef.value;
                    items.add(id);
                    allItemNames.set(id, line.SalesItemLineDetail.ItemRef.name || 'Unknown');
                }
            });

            storeTemplates[store.name] = { items, count: items.size, doc: est.DocNumber, date: est.TxnDate };
            console.log(`  ✅ ${store.name.padEnd(22)} ${String(items.size).padStart(2)} items  (Est #${est.DocNumber} del ${est.TxnDate})`);
            
            // Small delay to avoid rate limit
            await new Promise(r => setTimeout(r, 300));
        } catch (e) {
            const msg = e?.response?.data?.fault?.error?.[0]?.message || e.message;
            console.log(`  ❌ ${store.name.padEnd(22)} Error: ${msg}`);
            storeTemplates[store.name] = { items: new Set(), count: 0 };
        }
    }

    // Analysis
    const storesWithData = Object.entries(storeTemplates).filter(([,v]) => v.count > 0);
    const allItems = new Set();
    storesWithData.forEach(([,v]) => v.items.forEach(id => allItems.add(id)));

    const universalItems = [];
    const partialItems = [];

    for (const itemId of allItems) {
        const presentIn = storesWithData.filter(([,v]) => v.items.has(itemId)).map(([name]) => name);
        const missingFrom = storesWithData.filter(([,v]) => !v.items.has(itemId)).map(([name]) => name);
        
        if (missingFrom.length === 0) {
            universalItems.push({ id: itemId, name: allItemNames.get(itemId) });
        } else {
            partialItems.push({ id: itemId, name: allItemNames.get(itemId), presentIn, missingFrom });
        }
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📋 RESUMEN DE AUDITORÍA DE TEMPLATES QB`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`Tiendas auditadas: ${storesWithData.length}`);
    console.log(`Items únicos totales: ${allItems.size}`);
    console.log(`Items en TODAS las tiendas: ${universalItems.length}`);
    console.log(`Items con DIFERENCIAS: ${partialItems.length}`);

    // Per-store count
    const counts = storesWithData.map(([,v]) => v.count);
    const modeCount = Math.max(...counts);
    console.log(`\n📊 CONTEO POR TIENDA:`);
    Object.entries(storeTemplates)
        .filter(([,v]) => v.count > 0)
        .sort(([a],[b]) => a.localeCompare(b))
        .forEach(([name, data]) => {
            const diff = data.count - modeCount;
            const icon = data.count === modeCount ? '✅' : data.count > modeCount - 3 ? '🟡' : '🔴';
            console.log(`  ${icon} ${name.padEnd(22)} ${String(data.count).padStart(2)} items ${diff !== 0 ? `(${diff > 0 ? '+' : ''}${diff})` : ''}`.trimEnd());
        });

    // Universal items
    console.log(`\n✅ ITEMS UNIVERSALES (${universalItems.length}) — presentes en TODAS las tiendas:`);
    universalItems.sort((a,b) => (a.name||'').localeCompare(b.name||''));
    universalItems.forEach((item, i) => console.log(`  ${String(i+1).padStart(3)}. ${item.name}`));

    // Differences
    if (partialItems.length > 0) {
        console.log(`\n⚠️  DIFERENCIAS ENCONTRADAS (${partialItems.length} items):`);
        console.log(`${'─'.repeat(80)}`);
        partialItems.sort((a,b) => b.missingFrom.length - a.missingFrom.length);
        partialItems.forEach(item => {
            console.log(`\n  📦 ${item.name}`);
            console.log(`     ✅ Está en (${item.presentIn.length}): ${item.presentIn.join(', ')}`);
            console.log(`     ❌ FALTA en (${item.missingFrom.length}): ${item.missingFrom.join(', ')}`);
        });
    }

    // Save JSON
    const fs = require('fs');
    fs.writeFileSync('scripts/template-audit-result.json', JSON.stringify({
        timestamp: new Date().toISOString(),
        storesAudited: storesWithData.length,
        totalUniqueItems: allItems.size,
        universalCount: universalItems.length,
        differenceCount: partialItems.length,
        storeCounts: Object.fromEntries(Object.entries(storeTemplates).map(([k,v]) => [k, v.count])),
        universalItems: universalItems.map(i => ({ name: i.name, qbId: i.id })),
        differences: partialItems.map(i => ({ name: i.name, qbId: i.id, presentIn: i.presentIn, missingFrom: i.missingFrom }))
    }, null, 2));
    console.log('\n📄 JSON guardado en scripts/template-audit-result.json');
})();
