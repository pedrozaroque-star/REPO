/**
 * Tabla de productos de comida ordenados por costo,
 * mostrando costo actual y costo por unidad de receta.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function showPriceTable() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all food items that are used in recipes
    const { data: recipes } = await supabase.from('recipes').select('inventory_item_id').eq('type', 'food');
    const recipeItemIds = [...new Set(recipes?.map(r => r.inventory_item_id) || [])];

    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type, is_bodega')
        .in('id', recipeItemIds)
        .order('purchase_unit_cost', { ascending: false });

    if (!items) { console.log('No data'); return; }

    // Count recipe usage
    const usageCount = new Map<string, number>();
    recipes?.forEach(r => {
        usageCount.set(r.inventory_item_id, (usageCount.get(r.inventory_item_id) || 0) + 1);
    });

    // Also get price history to show before/after
    const { data: history } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .in('inventory_item_id', recipeItemIds)
        .order('effective_date', { ascending: true });

    const priceHistoryMap = new Map<string, { before: number | null; after: number | null }>();
    history?.forEach(h => {
        if (!priceHistoryMap.has(h.inventory_item_id)) {
            priceHistoryMap.set(h.inventory_item_id, { before: null, after: null });
        }
        const entry = priceHistoryMap.get(h.inventory_item_id)!;
        if (h.effective_date < '2026-06-02') {
            entry.before = h.purchase_unit_cost;
        } else if (!entry.after) {
            entry.after = h.purchase_unit_cost; // First price after June 2
        }
    });

    console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('  TABLA DE INGREDIENTES DE COMIDA — Ordenados por costo total del paquete');
    console.log('  "Precio Antes" = antes del 2 de junio (lo que se usaba) | "Precio Ahora" = después del sync');
    console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`${'#'.padStart(3)} | ${'Nombre'.padEnd(42)} | ${'$/Paquete'.padStart(10)} | ${'Qty'.padStart(5)} | ${'Unit'.padStart(5)} | ${'$/Unidad'.padStart(10)} | ${'Antes'.padStart(10)} | ${'Cambio'.padStart(8)} | Recetas`);
    console.log('─'.repeat(115));

    items.forEach((item, idx) => {
        const costPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
        const usage = usageCount.get(item.id) || 0;
        const hist = priceHistoryMap.get(item.id);
        const beforePrice = hist?.before;
        const beforeStr = beforePrice ? `$${beforePrice.toFixed(2)}` : '-';
        const changePct = beforePrice && item.purchase_unit_cost 
            ? (((item.purchase_unit_cost - beforePrice) / beforePrice) * 100).toFixed(0) + '%'
            : '-';

        console.log(
            `${(idx + 1).toString().padStart(3)} | ${item.name.substring(0, 42).padEnd(42)} | $${(item.purchase_unit_cost || 0).toFixed(2).padStart(9)} | ${(item.quantity_per_unit || 1).toString().padStart(5)} | ${(item.unit_measure || '?').padStart(5)} | $${costPerUnit.toFixed(4).padStart(9)} | ${beforeStr.padStart(10)} | ${changePct.padStart(8)} | ${usage}`
        );
    });

    // Summary: total food cost impact
    console.log('\n═══ CARNES (los que más impactan el food cost) ═══');
    const meats = ['Carne Asada', 'Pastor', 'Pollo', 'Cabeza', 'Lengua', 'Carnitas', 'Buche', 'Chorizo', 'Milaneza', 'Birria'];
    meats.forEach(name => {
        const item = items.find(i => i.name.toLowerCase().includes(name.toLowerCase()));
        if (!item) return;
        const costPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
        const hist = priceHistoryMap.get(item.id);
        const beforeCPU = hist?.before ? hist.before / (item.quantity_per_unit || 1) : null;
        console.log(`  🥩 ${item.name}: $${(item.purchase_unit_cost || 0).toFixed(2)}/${item.quantity_per_unit} ${item.unit_measure} = $${costPerUnit.toFixed(2)}/${item.unit_measure}${beforeCPU ? ` (antes: $${beforeCPU.toFixed(2)}/${item.unit_measure})` : ''}`);
    });
}

showPriceTable();
