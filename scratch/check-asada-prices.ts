import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkAsadaPrices() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Current Asada price in inventory_items
    console.log('=== PRECIO ACTUAL DE ASADA EN inventory_items ===');
    const { data: asadaItems } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type, yield_percent, updated_at')
        .ilike('name', '%asada%');
    
    if (asadaItems?.length) {
        asadaItems.forEach(item => {
            console.log(`  ${item.name}: $${item.purchase_unit_cost} | qty_per_unit: ${item.quantity_per_unit} | unit: ${item.unit_measure} | yield: ${item.yield_percent}% | updated: ${item.updated_at}`);
        });
    }

    // 2. Asada price HISTORY
    console.log('\n=== HISTORIAL DE PRECIOS DE ASADA (últimos 20 cambios) ===');
    const asadaIds = asadaItems?.map(a => a.id) || [];
    if (asadaIds.length > 0) {
        const { data: priceHistory } = await supabase
            .from('inventory_price_history')
            .select('inventory_item_id, purchase_unit_cost, effective_date')
            .in('inventory_item_id', asadaIds)
            .order('effective_date', { ascending: false })
            .limit(20);
        
        if (priceHistory?.length) {
            const nameMap = new Map(asadaItems!.map(a => [a.id, a.name]));
            priceHistory.forEach(h => {
                const name = nameMap.get(h.inventory_item_id) || 'unknown';
                console.log(`  ${h.effective_date} | ${name}: $${h.purchase_unit_cost}`);
            });
        } else {
            console.log('  No hay historial de precios para Asada');
        }
    }

    // 3. QuickBooks mapping for Asada
    console.log('\n=== MAPPING QUICKBOOKS → ASADA ===');
    const { data: qbMappings } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, qb_item_name, inventory_item_id, last_fetch_cost, updated_at')
        .ilike('qb_item_name', '%asada%');
    
    if (qbMappings?.length) {
        qbMappings.forEach(m => {
            console.log(`  QB: "${m.qb_item_name}" (ID: ${m.qb_item_id}) → last_cost: $${m.last_fetch_cost} | updated: ${m.updated_at}`);
        });
    }

    // 4. Last QB sync time (check integrations table)
    console.log('\n=== ÚLTIMA SINCRONIZACIÓN QB ===');
    const { data: integration } = await supabase
        .from('integrations')
        .select('updated_at, expires_at')
        .eq('service_name', 'quickbooks')
        .single();
    
    if (integration) {
        console.log(`  Token actualizado: ${integration.updated_at}`);
        console.log(`  Expira: ${integration.expires_at}`);
    }

    // 5. All recent price changes (any product, last 30)
    console.log('\n=== ÚLTIMOS 30 CAMBIOS DE PRECIO (CUALQUIER PRODUCTO) ===');
    const { data: recentChanges } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .order('effective_date', { ascending: false })
        .limit(30);
    
    if (recentChanges?.length) {
        // Get all item names
        const allIds = [...new Set(recentChanges.map(r => r.inventory_item_id))];
        const { data: allItems } = await supabase
            .from('inventory_items')
            .select('id, name')
            .in('id', allIds);
        
        const nameMap2 = new Map(allItems?.map(a => [a.id, a.name]) || []);
        recentChanges.forEach(h => {
            const name = nameMap2.get(h.inventory_item_id) || h.inventory_item_id;
            console.log(`  ${h.effective_date} | ${name}: $${h.purchase_unit_cost}`);
        });
    }
}

checkAsadaPrices();
