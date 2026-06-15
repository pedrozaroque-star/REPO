import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function compareWarehouseVsRestaurant() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all items with is_bodega flag
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, is_bodega, purchase_unit_cost, unit_type, quantity_per_unit, unit_measure')
        .order('purchase_unit_cost', { ascending: false });

    const warehouse = items?.filter(i => i.is_bodega) || [];
    const restaurant = items?.filter(i => !i.is_bodega) || [];

    console.log('=== RESUMEN ===');
    console.log(`  WAREHOUSE (is_bodega=true):  ${warehouse.length} items`);
    console.log(`  RESTAURANT (is_bodega=false): ${restaurant.length} items`);

    console.log('\n=== WAREHOUSE ITEMS (top 15 por costo) ===');
    warehouse.slice(0, 15).forEach(i => {
        const cost = Number(i.purchase_unit_cost || 0);
        const qty = Number(i.quantity_per_unit || 1);
        console.log(`  $${cost.toFixed(2).padStart(8)} | ${String(qty).padStart(4)} ${(i.unit_measure || '').padEnd(4)} | $${(cost/qty).toFixed(4).padStart(9)}/u | ${i.name?.substring(0, 45)}`);
    });

    console.log('\n=== RESTAURANT ITEMS (top 15 por costo) ===');
    restaurant.sort((a, b) => Number(b.purchase_unit_cost || 0) - Number(a.purchase_unit_cost || 0));
    restaurant.slice(0, 15).forEach(i => {
        const cost = Number(i.purchase_unit_cost || 0);
        const qty = Number(i.quantity_per_unit || 1);
        console.log(`  $${cost.toFixed(2).padStart(8)} | ${String(qty).padStart(4)} ${(i.unit_measure || '').padEnd(4)} | $${(cost/qty).toFixed(4).padStart(9)}/u | ${i.name?.substring(0, 45)}`);
    });

    // Check quickbooks_mappings to see what QB sends for each type
    console.log('\n=== MAPPINGS: QB fetch vs current - WAREHOUSE ===');
    const warehouseIds = warehouse.map(w => w.id);
    const { data: wMappings } = await supabase
        .from('quickbooks_mappings')
        .select('inventory_item_id, qb_item_name, last_fetch_cost')
        .in('inventory_item_id', warehouseIds.slice(0, 10));

    wMappings?.forEach(m => {
        const item = warehouse.find(w => w.id === m.inventory_item_id);
        const match = Math.abs(Number(m.last_fetch_cost || 0) - Number(item?.purchase_unit_cost || 0)) < 0.01 ? '✅' : '⚠️';
        console.log(`  ${match} QB: $${Number(m.last_fetch_cost || 0).toFixed(2).padStart(8)} | DB: $${Number(item?.purchase_unit_cost || 0).toFixed(2).padStart(8)} | ${m.qb_item_name?.substring(0, 40)}`);
    });
}

compareWarehouseVsRestaurant();
