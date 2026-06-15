import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function partyTrayAnalysis() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const CENTRAL_ID = '8685e942-3f07-403a-afb6-faec697cd2cb';

    // 1. Get PMIX for May 28 - find all party tray items
    const { data: pmix28 } = await supabase
        .from('pmix_daily_cache')
        .select('items')
        .eq('store_id', CENTRAL_ID)
        .eq('business_date', '2026-05-28')
        .single();

    const items28 = pmix28?.items as any[];
    
    console.log('=== PARTY TRAYS EN MAYO 28 - LA CENTRAL ===');
    const trays = items28.filter(i => 
        i.name?.toLowerCase().includes('people') || 
        i.name?.toLowerCase().includes('party') ||
        i.name?.toLowerCase().includes('tray')
    );
    
    let totalTraySales = 0;
    trays.forEach(t => {
        totalTraySales += Number(t.net_sales || 0);
        console.log(`  "${t.name}" | Qty: ${t.quantity} | Sales: $${t.net_sales} | Unit: $${t.unit_price} | Group: ${t.group_name}`);
    });
    console.log(`\n  TOTAL Party Tray Sales: $${totalTraySales.toFixed(0)}`);

    // 2. Check if party trays have recipes
    const trayGuids = [...new Set(trays.map(t => t.guid))];
    console.log(`\n  Unique Party Tray GUIDs: ${trayGuids.length}`);
    
    const { data: trayRecipes } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid, quantity, unit, inventory_item_id')
        .in('toast_menu_item_guid', trayGuids);
    
    console.log(`  Party Tray recipes found: ${trayRecipes?.length || 0}`);
    
    if (trayRecipes?.length) {
        trayRecipes.forEach(r => {
            console.log(`    GUID: ${r.toast_menu_item_guid?.substring(0, 12)}... | ${r.quantity} ${r.unit}`);
        });
    }

    // 3. Now call the food-cost API directly for May 28 Central to see individual item costs
    console.log('\n=== FOOD COST API - Mayo 28 LA Central ===');
    try {
        const url = `http://localhost:3000/api/inventory/food-cost?storeId=${CENTRAL_ID}&startDate=2026-05-28&endDate=2026-05-28`;
        const res = await fetch(url);
        const json = await res.json();
        
        const data = json.data || [];
        console.log(`  Total items returned: ${data.length}`);
        
        // Find party tray items in the response
        const trayItems = data.filter((d: any) => 
            d.name?.toLowerCase().includes('people') || 
            d.name?.toLowerCase().includes('party') ||
            d.name?.toLowerCase().includes('tray')
        );
        
        console.log(`\n=== PARTY TRAYS - DETALLE FOOD COST ===`);
        trayItems.forEach((t: any) => {
            console.log(`  "${t.name?.substring(0, 50)}" | Qty: ${t.quantity} | Sales: $${t.net_sales?.toFixed(0)} | FC: $${t.total_cost?.toFixed(0)} | FC%: ${t.food_cost_percent?.toFixed(1)}% | has_recipe: ${t.has_recipe}`);
        });

        // Top 10 items by total_cost (highest food cost contributors)
        console.log('\n=== TOP 10 CONTRIBUTORS AL FOOD COST ===');
        const sorted = data.sort((a: any, b: any) => (b.total_cost || 0) - (a.total_cost || 0));
        sorted.slice(0, 10).forEach((d: any) => {
            console.log(`  $${(d.total_cost || 0).toFixed(0).padStart(5)} FC | $${(d.net_sales || 0).toFixed(0).padStart(5)} Sales | FC%: ${(d.food_cost_percent || 0).toFixed(1).padStart(5)}% | "${d.name?.substring(0, 40)}" (Qty: ${d.quantity})`);
        });

        // Check: items with $0 food cost but > $100 sales
        console.log('\n=== ITEMS CON $0 FOOD COST PERO > $100 EN VENTAS ===');
        const zeroFC = data.filter((d: any) => (d.total_cost || 0) === 0 && (d.net_sales || 0) > 100);
        zeroFC.forEach((d: any) => {
            console.log(`  ❌ "${d.name?.substring(0, 45)}" | Sales: $${d.net_sales?.toFixed(0)} | has_recipe: ${d.has_recipe}`);
        });

        // Summary
        let totalFC = 0, totalSales = 0;
        data.forEach((d: any) => {
            totalFC += Number(d.total_cost || 0);
            totalSales += Number(d.net_sales || 0);
        });
        console.log(`\n=== RESUMEN ===`);
        console.log(`  Total Food Cost: $${totalFC.toFixed(0)}`);
        console.log(`  Total Net Sales: $${totalSales.toFixed(0)}`);
        console.log(`  FC%: ${(totalFC/totalSales*100).toFixed(1)}%`);

    } catch (e: any) {
        console.error('API Error:', e.message);
    }
}

partyTrayAnalysis();
