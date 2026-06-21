/**
 * RESTAURAR PRECIOS ANTERIORES AL 2 DE JUNIO
 * 
 * Los precios antes del 2 de junio usaban UnitPrice (correcto).
 * Los precios después del 2 de junio usaban PurchaseCost (incorrecto, ~20% más bajo).
 * 
 * Para cada item que cambió de precio el 2 de junio:
 * 1. Encontrar el precio anterior (UnitPrice, antes del 2 de junio)
 * 2. Restaurar ese precio en inventory_items
 * 3. Actualizar price_history
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function restoreCorrectPrices() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all price history
    const { data: history } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .order('effective_date', { ascending: true });

    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost');

    if (!history || !items) { console.log('No data'); return; }

    const itemMap = new Map(items.map(i => [i.id, i]));

    // Group by item, find before/after June 2
    const byItem = new Map<string, { before: number | null; after: number | null }>();
    history.forEach(h => {
        if (!byItem.has(h.inventory_item_id)) {
            byItem.set(h.inventory_item_id, { before: null, after: null });
        }
        const entry = byItem.get(h.inventory_item_id)!;
        if (h.effective_date < '2026-06-02') {
            entry.before = h.purchase_unit_cost;
        } else {
            entry.after = h.purchase_unit_cost;
        }
    });

    console.log('═══════════════════════════════════════════════════');
    console.log('  RESTAURAR PRECIOS UnitPrice (pre-2 de junio)');
    console.log('═══════════════════════════════════════════════════');

    let restored = 0;
    let skipped = 0;

    for (const [itemId, prices] of byItem) {
        const item = itemMap.get(itemId);
        if (!item) continue;
        
        // Skip Papelito - already correctly fixed
        if (item.name.includes('Papelito')) {
            console.log(`  ⏭️ "${item.name}" → Skipping (already protected with multiplier)`);
            skipped++;
            continue;
        }

        // Only restore if: has a before price AND current price matches the "after" (wrong) price
        if (prices.before && prices.after && Math.abs(item.purchase_unit_cost - prices.after) < 0.01) {
            // Restore the old price
            const { error } = await supabase
                .from('inventory_items')
                .update({ purchase_unit_cost: prices.before, updated_at: new Date() })
                .eq('id', itemId);

            if (error) {
                console.log(`  ❌ "${item.name}": ${error.message}`);
            } else {
                const changePct = ((prices.before - prices.after) / prices.after * 100).toFixed(1);
                console.log(`  ✅ "${item.name}": $${prices.after.toFixed(2)} → $${prices.before.toFixed(2)} (+${changePct}%)`);
                restored++;

                // Add price history entry
                await supabase.from('inventory_price_history').insert({
                    inventory_item_id: itemId,
                    purchase_unit_cost: prices.before,
                    effective_date: new Date().toISOString()
                });
            }
        } else {
            skipped++;
        }
    }

    console.log(`\n═══ RESULTADO ═══`);
    console.log(`  Restaurados: ${restored}`);
    console.log(`  Skipped: ${skipped}`);

    // Quick verify key meats
    console.log('\n═══ VERIFICACIÓN CARNES ═══');
    const meatNames = ['Carne Asada', 'Pastor', 'Pollo', 'Cabeza', 'Lengua', 'Birria'];
    for (const name of meatNames) {
        const { data } = await supabase
            .from('inventory_items')
            .select('name, purchase_unit_cost, quantity_per_unit, unit_measure')
            .ilike('name', `%${name}%`)
            .limit(1);
        if (data?.[0]) {
            const i = data[0];
            const perUnit = (i.purchase_unit_cost || 0) / (i.quantity_per_unit || 1);
            console.log(`  "${i.name}" → $${i.purchase_unit_cost}/${i.quantity_per_unit} ${i.unit_measure} = $${perUnit.toFixed(2)}/${i.unit_measure}`);
        }
    }
}

restoreCorrectPrices();
