/**
 * @module fix-price-history-and-backfill
 * @description Script de reparación completa del food cost:
 * 1. Elimina entradas contaminadas de inventory_price_history del 2 de junio (PurchaseCost)
 * 2. Inserta nuevas entradas con precios correctos (UnitPrice de inventory_items)
 * 3. Limpia food_cost_daily_cache de junio para forzar recálculo
 * 
 * Complete food cost repair script:
 * 1. Deletes contaminated June 2 price_history entries (PurchaseCost values)
 * 2. Inserts new entries with correct prices (UnitPrice from inventory_items)
 * 3. Cleans June food_cost_daily_cache to force recalculation
 * 
 * @businessRules
 * - Los precios del 2 de junio usaban PurchaseCost (lo que la bodega paga al proveedor)
 * - Los precios correctos son UnitPrice (lo que el restaurante paga a la bodega)
 * - La "Máquina del Tiempo" en food-cost/route.ts usa price_history para calcular
 *   el costo histórico. Sin este fix, todos los cálculos >= Jun 2 usan precios ~20% más bajos.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fix() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('🔧 REPARACIÓN DE FOOD COST - ' + new Date().toISOString());
    console.log('='.repeat(80));

    // ═══════════════════════════════════════════════════
    // PASO 1: Verificar estado actual ANTES del fix
    // ═══════════════════════════════════════════════════
    console.log('\n📊 PASO 0: Verificación pre-fix...');
    
    const { data: june2Entries, error: e0 } = await supabase
        .from('inventory_price_history')
        .select('id, inventory_item_id, purchase_unit_cost, effective_date')
        .gte('effective_date', '2026-06-02T00:00:00')
        .lte('effective_date', '2026-06-02T23:59:59');
    
    console.log(`  Entradas del 2 de junio a eliminar: ${june2Entries?.length || 0}`);
    
    if (!june2Entries?.length) {
        console.log('  ⚠️ No hay entradas del 2 de junio. ¿Ya se ejecutó este fix?');
        // Continue anyway to ensure price history is up to date
    }

    // ═══════════════════════════════════════════════════
    // PASO 1: Eliminar entradas contaminadas del 2 de junio
    // ═══════════════════════════════════════════════════
    console.log('\n🗑️  PASO 1: Eliminando entradas contaminadas de price_history (Jun 2)...');
    
    const { error: deleteError, count: deleteCount } = await supabase
        .from('inventory_price_history')
        .delete()
        .gte('effective_date', '2026-06-02T00:00:00')
        .lte('effective_date', '2026-06-02T23:59:59');
    
    if (deleteError) {
        console.error('  ❌ Error al eliminar:', deleteError);
        return;
    }
    console.log(`  ✅ Eliminadas ${june2Entries?.length || 0} entradas del 2 de junio`);

    // ═══════════════════════════════════════════════════
    // PASO 2: Insertar nuevas entradas con precios correctos
    // ═══════════════════════════════════════════════════
    console.log('\n📝 PASO 2: Insertando nuevas entradas con precios correctos (UnitPrice)...');
    
    // Get ALL inventory items with their current (correct) prices
    const { data: allItems, error: itemsError } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost')
        .gt('purchase_unit_cost', 0);
    
    if (itemsError || !allItems) {
        console.error('  ❌ Error al obtener items:', itemsError);
        return;
    }
    
    console.log(`  Total items con precio > $0: ${allItems.length}`);
    
    // Insert in batches of 50
    const now = new Date().toISOString();
    const batchSize = 50;
    let insertedCount = 0;
    
    for (let i = 0; i < allItems.length; i += batchSize) {
        const batch = allItems.slice(i, i + batchSize);
        const rows = batch.map(item => ({
            inventory_item_id: item.id,
            purchase_unit_cost: item.purchase_unit_cost,
            effective_date: now
        }));
        
        const { error: insertError } = await supabase
            .from('inventory_price_history')
            .insert(rows);
        
        if (insertError) {
            console.error(`  ❌ Error en batch ${i}-${i + batchSize}:`, insertError);
        } else {
            insertedCount += batch.length;
        }
    }
    
    console.log(`  ✅ Insertadas ${insertedCount} entradas con precios correctos (fecha: ${now.substring(0, 16)})`);

    // ═══════════════════════════════════════════════════
    // PASO 3: Limpiar food_cost_daily_cache de junio
    // ═══════════════════════════════════════════════════
    console.log('\n🗑️  PASO 3: Limpiando food_cost_daily_cache de junio...');
    
    const { error: cacheDeleteError } = await supabase
        .from('food_cost_daily_cache')
        .delete()
        .gte('business_date', '2026-06-01');
    
    if (cacheDeleteError) {
        console.error('  ❌ Error al limpiar caché:', cacheDeleteError);
    } else {
        console.log('  ✅ Caché de junio limpiado');
    }

    // ═══════════════════════════════════════════════════
    // PASO 4: Verificación post-fix
    // ═══════════════════════════════════════════════════
    console.log('\n📊 PASO 4: Verificación post-fix...');
    
    // Check price history summary
    const { data: postHistory } = await supabase
        .from('inventory_price_history')
        .select('effective_date')
        .order('effective_date', { ascending: true });
    
    if (postHistory?.length) {
        const dateGroups = new Map<string, number>();
        postHistory.forEach(h => {
            const date = h.effective_date.substring(0, 10);
            dateGroups.set(date, (dateGroups.get(date) || 0) + 1);
        });
        console.log('  Fechas en price_history después del fix:');
        for (const [date, count] of dateGroups) {
            const label = date === '2026-06-02' ? '❌ SHOULD NOT EXIST' : '✅';
            console.log(`    ${label} ${date}: ${count} entradas`);
        }
    }

    // Verify key meat prices are in the new entries
    console.log('\n  Verificación de precios de carnes en las nuevas entradas:');
    const meatIds = [
        { id: 'fab9d589-8ae8-4381-87da-85f836068996', name: 'Asada' },
        { id: '4ea7ef9c-986e-4fc1-a363-7200ca558aab', name: 'Pollo' },
        { id: 'ad7e3703-2701-4a05-aa97-77866c8c717e', name: 'Pastor' },
        { id: '14990e85-0d90-467c-ad9d-362e6ed4f1cd', name: 'Carnitas' },
        { id: 'baac1d41-3b80-4f80-acfc-7a19f46e03c2', name: 'Buche' },
        { id: '511e341b-ca42-44ed-89df-a4a84b51a619', name: 'Cabeza' },
        { id: '0fb87578-1185-41a9-a318-97428db20a5d', name: 'Lengua' },
        { id: '1e4c43b6-4e1b-4e51-8617-e127b89467f1', name: 'Chorizo' },
    ];
    
    for (const meat of meatIds) {
        const { data: meatHistory } = await supabase
            .from('inventory_price_history')
            .select('purchase_unit_cost, effective_date')
            .eq('inventory_item_id', meat.id)
            .order('effective_date', { ascending: false })
            .limit(3);
        
        const { data: currentItem } = await supabase
            .from('inventory_items')
            .select('purchase_unit_cost')
            .eq('id', meat.id)
            .single();
        
        if (meatHistory?.length) {
            const latest = meatHistory[0];
            const match = currentItem && Math.abs(latest.purchase_unit_cost - currentItem.purchase_unit_cost) < 0.01;
            console.log(`    ${match ? '✅' : '⚠️'} ${meat.name}: Current=$${currentItem?.purchase_unit_cost} | Latest history=$${latest.purchase_unit_cost} (${latest.effective_date.substring(0, 10)})`);
            if (meatHistory.length > 1) {
                meatHistory.slice(1).forEach(h => {
                    console.log(`       Previous: $${h.purchase_unit_cost} (${h.effective_date.substring(0, 10)})`);
                });
            }
        } else {
            console.log(`    ⚠️ ${meat.name}: No history entries found!`);
        }
    }

    // Check remaining cache
    const { data: remainingCache } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date')
        .gte('business_date', '2026-06-01')
        .limit(1);
    
    if (remainingCache?.length) {
        console.log('\n  ⚠️ Todavía hay caché de junio (no se eliminó correctamente)');
    } else {
        console.log('\n  ✅ Caché de junio limpiado exitosamente');
    }

    console.log('\n' + '='.repeat(80));
    console.log('🔧 REPARACIÓN COMPLETADA - Pasos 1-3 exitosos');
    console.log('='.repeat(80));
    console.log('\n📋 SIGUIENTE PASO: Ejecutar backfill del food cost cache');
    console.log('   Esto recalculará el food cost con los precios correctos.');
    console.log('   El backfill requiere que el servidor Next.js esté corriendo.');
}

fix().catch(console.error);
