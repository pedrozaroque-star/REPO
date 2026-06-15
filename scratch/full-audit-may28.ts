import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fullAuditMay28() {
    const CENTRAL_ID = '8685e942-3f07-403a-afb6-faec697cd2cb';
    const url = `http://localhost:3000/api/inventory/food-cost?storeId=${CENTRAL_ID}&startDate=2026-05-28&endDate=2026-05-28`;
    
    console.log('Fetching food cost data for LA Central - May 28, 2026...\n');
    const res = await fetch(url);
    const json = await res.json();
    const data = json.data || [];

    // === 1. SUMMARY ===
    let totalSales = 0, totalCost = 0, totalQty = 0;
    let withRecipe = 0, noRecipe = 0;
    let zeroFCWithSales = 0;
    let highFC: any[] = [];
    let lowFC: any[] = [];
    let noRecipeItems: any[] = [];
    let zeroCostItems: any[] = [];
    let negativeCostItems: any[] = [];
    let missingPriceItems: any[] = [];

    data.forEach((item: any) => {
        totalSales += item.net_sales || 0;
        totalCost += item.total_cost || 0;
        totalQty += item.quantity || 0;

        if (item.has_recipe) withRecipe++;
        else noRecipe++;

        // Items with $0 food cost but positive sales (anomalous)
        if (item.total_cost === 0 && item.net_sales > 10 && item.has_recipe) {
            zeroCostItems.push(item);
        }

        // Items with $0 food cost and NO recipe
        if (!item.has_recipe && item.net_sales > 10) {
            noRecipeItems.push(item);
        }

        // Items with negative cost (shouldn't happen)
        if (item.total_cost < 0) {
            negativeCostItems.push(item);
        }

        // Missing prices
        if (item.missing_prices) {
            missingPriceItems.push(item);
        }

        // Very high FC% (>60%)
        if (item.food_cost_percent > 60 && item.net_sales > 20) {
            highFC.push(item);
        }

        // Very low FC% (<10% but has recipe and positive sales >$50)
        if (item.food_cost_percent > 0 && item.food_cost_percent < 10 && item.net_sales > 50 && item.has_recipe) {
            lowFC.push(item);
        }
    });

    const overallFC = totalSales > 0 ? (totalCost / totalSales * 100) : 0;

    console.log('═══════════════════════════════════════════');
    console.log('          RESUMEN GENERAL');
    console.log('═══════════════════════════════════════════');
    console.log(`  Total items:      ${data.length}`);
    console.log(`  Total quantity:   ${totalQty}`);
    console.log(`  Net Sales:        $${totalSales.toFixed(2)}`);
    console.log(`  Food Cost:        $${totalCost.toFixed(2)}`);
    console.log(`  FC%:              ${overallFC.toFixed(1)}%`);
    console.log(`  With Recipe:      ${withRecipe} (${(withRecipe/data.length*100).toFixed(1)}%)`);
    console.log(`  No Recipe:        ${noRecipe}`);

    // === 2. ITEMS SIN RECETA ===
    if (noRecipeItems.length > 0) {
        console.log('\n═══════════════════════════════════════════');
        console.log('  ❌ ITEMS SIN RECETA (>$10 ventas)');
        console.log('═══════════════════════════════════════════');
        noRecipeItems.sort((a, b) => b.net_sales - a.net_sales);
        noRecipeItems.forEach(i => {
            console.log(`  $${i.net_sales.toFixed(0).padStart(6)} | Qty: ${String(i.quantity).padStart(4)} | "${i.name?.substring(0, 50)}"`);
        });
        const noRecipeSales = noRecipeItems.reduce((s: number, i: any) => s + i.net_sales, 0);
        console.log(`  TOTAL: $${noRecipeSales.toFixed(0)} (${(noRecipeSales/totalSales*100).toFixed(1)}% de ventas)`);
    } else {
        console.log('\n  ✅ Todos los items con ventas >$10 tienen receta');
    }

    // === 3. ITEMS CON RECETA PERO $0 COST ===
    if (zeroCostItems.length > 0) {
        console.log('\n═══════════════════════════════════════════');
        console.log('  ⚠️ ITEMS CON RECETA PERO $0 FOOD COST');
        console.log('═══════════════════════════════════════════');
        zeroCostItems.sort((a, b) => b.net_sales - a.net_sales);
        zeroCostItems.forEach(i => {
            console.log(`  $${i.net_sales.toFixed(0).padStart(6)} sales | FC: $${i.total_cost.toFixed(2)} | "${i.name?.substring(0, 50)}"`);
        });
    } else {
        console.log('\n  ✅ No hay items con receta que tengan $0 food cost');
    }

    // === 4. ITEMS CON COSTO NEGATIVO ===
    if (negativeCostItems.length > 0) {
        console.log('\n═══════════════════════════════════════════');
        console.log('  🚨 ITEMS CON COSTO NEGATIVO');
        console.log('═══════════════════════════════════════════');
        negativeCostItems.forEach(i => {
            console.log(`  FC: $${i.total_cost.toFixed(2)} | Sales: $${i.net_sales.toFixed(0)} | "${i.name?.substring(0, 50)}"`);
        });
    } else {
        console.log('  ✅ No hay items con costo negativo');
    }

    // === 5. ITEMS CON MISSING PRICES ===
    if (missingPriceItems.length > 0) {
        console.log('\n═══════════════════════════════════════════');
        console.log('  ⚠️ ITEMS CON PRECIOS FALTANTES EN INVENTARIO');
        console.log('═══════════════════════════════════════════');
        missingPriceItems.sort((a, b) => b.net_sales - a.net_sales);
        missingPriceItems.forEach(i => {
            console.log(`  $${i.net_sales.toFixed(0).padStart(6)} sales | FC: $${i.total_cost.toFixed(2).padStart(8)} | FC%: ${i.food_cost_percent.toFixed(1).padStart(5)}% | "${i.name?.substring(0, 45)}"`);
        });
    } else {
        console.log('  ✅ Todos los ingredientes tienen precios');
    }

    // === 6. FC% MUY ALTO (>60%) ===
    if (highFC.length > 0) {
        console.log('\n═══════════════════════════════════════════');
        console.log('  🔴 ITEMS CON FC% > 60% (posible error)');
        console.log('═══════════════════════════════════════════');
        highFC.sort((a, b) => b.food_cost_percent - a.food_cost_percent);
        highFC.forEach(i => {
            console.log(`  ${i.food_cost_percent.toFixed(1).padStart(6)}% | $${i.total_cost.toFixed(2).padStart(8)} / $${i.net_sales.toFixed(2).padStart(8)} | Qty: ${String(i.quantity).padStart(4)} | "${i.name?.substring(0, 40)}"`);
        });
    } else {
        console.log('  ✅ No hay items con FC% anormalmente alto');
    }

    // === 7. FC% MUY BAJO (<10%) con ventas altas ===
    if (lowFC.length > 0) {
        console.log('\n═══════════════════════════════════════════');
        console.log('  🟡 ITEMS CON FC% < 10% (posible error)');
        console.log('═══════════════════════════════════════════');
        lowFC.sort((a, b) => a.food_cost_percent - b.food_cost_percent);
        lowFC.forEach(i => {
            console.log(`  ${i.food_cost_percent.toFixed(1).padStart(6)}% | $${i.total_cost.toFixed(2).padStart(8)} / $${i.net_sales.toFixed(2).padStart(8)} | Qty: ${String(i.quantity).padStart(4)} | "${i.name?.substring(0, 40)}"`);
        });
    } else {
        console.log('  ✅ No hay items con FC% anormalmente bajo');
    }

    // === 8. TOP 20 POR SALES ===
    console.log('\n═══════════════════════════════════════════');
    console.log('  📊 TOP 20 PRODUCTOS POR VENTAS');
    console.log('═══════════════════════════════════════════');
    const topSales = [...data].sort((a: any, b: any) => b.net_sales - a.net_sales).slice(0, 20);
    topSales.forEach((i: any) => {
        const fcMark = i.food_cost_percent > 50 ? '🔴' : i.food_cost_percent > 35 ? '🟡' : i.food_cost_percent > 0 ? '🟢' : '⚪';
        console.log(`  ${fcMark} $${i.net_sales.toFixed(0).padStart(5)} | FC: $${i.total_cost.toFixed(0).padStart(5)} (${i.food_cost_percent.toFixed(1).padStart(5)}%) | Qty: ${String(i.quantity).padStart(4)} | "${i.name?.substring(0, 45)}"`);
    });

    // === 9. PARTY TRAYS ===
    console.log('\n═══════════════════════════════════════════');
    console.log('  🎉 PARTY TRAYS');
    console.log('═══════════════════════════════════════════');
    const trays = data.filter((d: any) => d.name?.toLowerCase().includes('people') || d.name?.toLowerCase().includes('tray'));
    if (trays.length > 0) {
        trays.forEach((t: any) => {
            console.log(`  "${t.name?.substring(0, 55)}"`);
            console.log(`    Qty: ${t.quantity} | Sales: $${t.net_sales.toFixed(0)} | FC: $${t.total_cost.toFixed(2)} | FC%: ${t.food_cost_percent.toFixed(1)}% | Meat: ${t.total_meat_lbs.toFixed(1)} lbs`);
        });
    }

    // === 10. BEBIDAS (Horchata, aguas) ===
    console.log('\n═══════════════════════════════════════════');
    console.log('  🥤 BEBIDAS');
    console.log('═══════════════════════════════════════════');
    const drinks = data.filter((d: any) => 
        d.name?.toLowerCase().includes('horchata') || 
        d.name?.toLowerCase().includes('jamaica') || 
        d.name?.toLowerCase().includes('tamarindo') ||
        d.name?.toLowerCase().includes('piña') ||
        d.name?.toLowerCase().includes('champurrado')
    );
    drinks.sort((a: any, b: any) => b.net_sales - a.net_sales);
    drinks.forEach((d: any) => {
        const status = d.has_recipe ? (d.total_cost > 0 ? '✅' : '⚠️$0') : '❌NoRec';
        console.log(`  ${status} $${d.net_sales.toFixed(0).padStart(5)} | FC: $${d.total_cost.toFixed(2).padStart(7)} (${d.food_cost_percent.toFixed(1).padStart(5)}%) | Qty: ${String(d.quantity).padStart(4)} | "${d.name?.substring(0, 40)}"`);
    });
}

fullAuditMay28();
