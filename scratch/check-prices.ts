import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkCurrentPrices() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check what's currently stored for key items
    const itemNames = ['Papelito', 'Carne Asada', 'Pollo', 'Arroz', 'Frijol', 'Tortilla', 'Horchata'];
    
    console.log('=== PRECIOS ACTUALES EN INVENTORY_ITEMS ===\n');
    
    for (const name of itemNames) {
        const { data } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost, quantity_per_unit, unit_type, unit_measure')
            .ilike('name', `%${name}%`)
            .order('name')
            .limit(5);
        
        data?.forEach(item => {
            const unitCost = Number(item.purchase_unit_cost || 0);
            const qtyPerUnit = Number(item.quantity_per_unit || 1);
            const costPerPiece = unitCost / qtyPerUnit;
            console.log(`  ${item.name.padEnd(35)} | Case: $${unitCost.toFixed(2).padStart(7)} | Qty/Unit: ${String(qtyPerUnit).padStart(4)} ${item.unit_measure || ''} | Per pza: $${costPerPiece.toFixed(4)}`);
        });
    }

    // Check the quickbooks_mappings for recent sync data
    console.log('\n\n=== ÚLTIMOS CAMBIOS DE PRECIO (price_history, últimos 20) ===\n');
    const { data: history } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .order('effective_date', { ascending: false })
        .limit(20);
    
    if (history?.length) {
        // Get item names
        const itemIds = [...new Set(history.map(h => h.inventory_item_id))];
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name')
            .in('id', itemIds);
        
        const nameMap = new Map(items?.map(i => [i.id, i.name]) || []);
        
        history.forEach(h => {
            const name = nameMap.get(h.inventory_item_id) || h.inventory_item_id;
            console.log(`  ${new Date(h.effective_date).toISOString().split('T')[0]} | $${Number(h.purchase_unit_cost).toFixed(2).padStart(8)} | ${name}`);
        });
    }

    // Check quickbooks_mappings for last_fetch_cost
    console.log('\n\n=== QUICKBOOKS MAPPINGS (muestra) ===\n');
    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, inventory_item_id, last_fetch_cost, updated_at')
        .order('updated_at', { ascending: false })
        .limit(10);
    
    if (mappings?.length) {
        const itemIds = mappings.map(m => m.inventory_item_id);
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost')
            .in('id', itemIds);
        
        const nameMap = new Map(items?.map(i => [i.id, { name: i.name, cost: i.purchase_unit_cost }]) || []);
        
        mappings.forEach(m => {
            const info = nameMap.get(m.inventory_item_id);
            const lastFetch = Number(m.last_fetch_cost || 0);
            const current = Number(info?.cost || 0);
            const match = Math.abs(lastFetch - current) < 0.01 ? '✅' : '⚠️ DIFF';
            console.log(`  ${match} ${(info?.name || '?').padEnd(30)} | QB fetch: $${lastFetch.toFixed(2).padStart(7)} | Current: $${current.toFixed(2).padStart(7)} | Updated: ${m.updated_at?.split('T')[0]}`);
        });
    }
}

checkCurrentPrices();
