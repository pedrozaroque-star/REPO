import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findPapelitoRecipes() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';
    
    // First check what columns exist
    const { data: sample } = await supabase
        .from('recipes')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID)
        .limit(1);
    
    if (sample?.length) {
        console.log('Recipe columns:', Object.keys(sample[0]).join(', '));
    }

    // Fetch ALL recipes for papelito
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID);
    
    if (error) { console.log('Error:', error.message); return; }

    console.log(`\n=== RECETAS CON PAPELITO: ${recipes?.length || 0} ===`);
    
    // Get menu item names from GUIDs via pmix or toast data
    const guids = recipes?.map(r => r.toast_menu_item_guid).filter(Boolean) || [];
    
    // Try to get names from pmix_daily_cache or similar
    let nameMap = new Map<string, string>();
    if (guids.length > 0) {
        const { data: pmix } = await supabase
            .from('pmix_daily_cache')
            .select('menu_item_guid, menu_item_name')
            .in('menu_item_guid', guids.slice(0, 50));
        
        pmix?.forEach(p => {
            if (!nameMap.has(p.menu_item_guid)) {
                nameMap.set(p.menu_item_guid, p.menu_item_name);
            }
        });
    }

    const OLD_COST_PER_PZA = 0.58 / 60;   // $0.0097
    const NEW_COST_PER_PZA = 34.80 / 60;  // $0.58

    recipes?.forEach(r => {
        const qty = Number(r.quantity || 0);
        const name = nameMap.get(r.toast_menu_item_guid) || r.toast_menu_item_guid?.substring(0, 16) + '...';
        const oldCost = qty * OLD_COST_PER_PZA;
        const newCost = qty * NEW_COST_PER_PZA;
        console.log(`  ${qty} ${r.unit} → "${name}" | OLD: $${oldCost.toFixed(3)} → NEW: $${newCost.toFixed(3)} | +$${(newCost - oldCost).toFixed(3)}`);
    });

    console.log(`\n=== IMPACTO EN CACHE ===`);
    console.log(`  Cada plato con 1 papelito: +$${(NEW_COST_PER_PZA - OLD_COST_PER_PZA).toFixed(3)}`);
    console.log(`  Cada plato con 2 papelitos: +$${(2 * (NEW_COST_PER_PZA - OLD_COST_PER_PZA)).toFixed(3)}`);
    console.log(`  El cache histórico ya calculado tiene el valor VIEJO ($0.01/pza)`);
    console.log(`  Los nuevos cálculos (de hoy en adelante) usarán el valor CORRECTO ($0.58/pza)`);
}

findPapelitoRecipes();
