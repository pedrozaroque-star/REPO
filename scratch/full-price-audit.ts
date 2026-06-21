/**
 * PRE/POST Sync Monitor:
 * 1. Snapshot de TODOS los precios de ingredientes que se usan en recetas
 * 2. Detectar items con precios sospechosamente bajos
 * 3. Comparar con lo que debería ser según el modelo bodega
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fullPriceAudit() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Get ALL inventory items with their recipe usage count
    console.log('═══════════════════════════════════════════════════');
    console.log('  FULL PRICE AUDIT — ALL RECIPE INGREDIENTS');
    console.log('═══════════════════════════════════════════════════');

    // Get recipe usage counts
    const { data: allRecipes } = await supabase
        .from('recipes')
        .select('inventory_item_id')
        .limit(10000);

    const usageCount = new Map<string, number>();
    allRecipes?.forEach(r => {
        usageCount.set(r.inventory_item_id, (usageCount.get(r.inventory_item_id) || 0) + 1);
    });

    // Get ALL inventory items
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_type, unit_measure, is_bodega, updated_at')
        .order('name');

    if (!items?.length) { console.log('No items found'); return; }

    // 2. Show items USED IN RECIPES sorted by impact (cost × usage)
    console.log('\n📋 INGREDIENTS USED IN RECIPES (sorted by estimated impact):');
    console.log('─────────────────────────────────────────────────────────────────────────');
    
    const recipeItems = items.filter(i => usageCount.has(i.id));
    const withImpact = recipeItems.map(item => {
        const recipes = usageCount.get(item.id) || 0;
        const costPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
        const impact = costPerUnit * recipes; // rough estimate
        return { ...item, recipes, costPerUnit, impact };
    });

    // Sort by number of recipes (most used first)
    withImpact.sort((a, b) => b.recipes - a.recipes);

    console.log(`${'Name'.padEnd(45)} | ${'Case$'.padStart(8)} | ${'Qty/U'.padStart(5)} | ${'$/Unit'.padStart(8)} | ${'Recipes'.padStart(7)} | ${'Unit'.padStart(6)} | Updated`);
    console.log('─'.repeat(120));

    withImpact.forEach(item => {
        const flag = item.purchase_unit_cost <= 0 ? '❌' : (item.costPerUnit < 0.01 ? '⚠️' : '  ');
        console.log(`${flag}${item.name.substring(0, 43).padEnd(43)} | $${(item.purchase_unit_cost || 0).toFixed(2).padStart(7)} | ${(item.quantity_per_unit || 1).toString().padStart(5)} | $${item.costPerUnit.toFixed(4).padStart(7)} | ${item.recipes.toString().padStart(7)} | ${(item.unit_measure || '?').padStart(6)} | ${item.updated_at?.substring(0, 10)}`);
    });

    // 3. Check QB mappings for ALL items
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  QB MAPPINGS WITH MULTIPLIER STATUS');
    console.log('═══════════════════════════════════════════════════');

    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, qb_item_name, inventory_item_id, last_fetch_cost, multiplier, max_drop_percent')
        .order('qb_item_name');

    // Check which mapped items have multiplier != 1
    const specialMappings = mappings?.filter(m => m.multiplier && Number(m.multiplier) !== 1);
    console.log(`  Total mappings: ${mappings?.length}`);
    console.log(`  With special multiplier: ${specialMappings?.length || 0}`);
    specialMappings?.forEach(m => {
        console.log(`    "${m.qb_item_name}" (QB:${m.qb_item_id}) → multiplier: ${m.multiplier}, last_cost: $${m.last_fetch_cost}`);
    });

    // 4. Items with price $0 that are used in recipes
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ⚠️  ITEMS WITH $0 PRICE USED IN RECIPES');
    console.log('═══════════════════════════════════════════════════');
    
    const zeroPrice = withImpact.filter(i => (i.purchase_unit_cost || 0) <= 0);
    if (zeroPrice.length) {
        zeroPrice.forEach(i => console.log(`  ❌ "${i.name}" used in ${i.recipes} recipes — cost is $0!`));
    } else {
        console.log('  ✅ No $0 items used in recipes');
    }

    // 5. Summary stats
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Total inventory items: ${items.length}`);
    console.log(`  Items used in recipes: ${recipeItems.length}`);
    console.log(`  Unique recipe GUIDs: ${new Set(allRecipes?.map(r => r.inventory_item_id)).size}`);
    console.log(`  Items with $0 price: ${items.filter(i => (i.purchase_unit_cost || 0) <= 0).length}`);
    console.log(`  Items with multiplier: ${specialMappings?.length || 0}`);

    // 6. Specifically check key meat prices (highest impact on food cost)
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  🥩 KEY MEAT/PROTEIN PRICES');
    console.log('═══════════════════════════════════════════════════');
    const meatNames = ['Carne Asada', 'Pastor', 'Pollo', 'Chorizo', 'Carnitas', 'Birria', 'Cabeza', 'Lengua', 'Buche', 'Milaneza', 'Chicharron'];
    meatNames.forEach(name => {
        const item = items.find(i => i.name.toLowerCase().includes(name.toLowerCase()));
        if (item) {
            const costPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
            const recipes = usageCount.get(item.id) || 0;
            console.log(`  "${item.name}" → $${item.purchase_unit_cost}/${item.unit_type || 'unit'} ($/unit: $${costPerUnit.toFixed(4)}) [${recipes} recipes]`);
        }
    });
}

fullPriceAudit();
