/**
 * Script para verificar y configurar los datos iniciales del módulo de órdenes.
 * - Verifica cuántos items tienen excel_reference
 * - Configura rounding rules para Papelitos y Quesadillas
 * - Configura order_sort_position basado en el orden del Excel
 * 
 * Ejecutar: node scripts/setup-order-items.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log('📊 Verificando items con excel_reference...\n');

    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('id, name, excel_reference, order_rounding_rule, order_sort_position, order_unit_description')
        .not('excel_reference', 'is', null)
        .order('order_sort_position', { ascending: true });

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log(`  ✅ ${items.length} items tienen excel_reference\n`);

    if (items.length > 0) {
        console.log('  Lista de items:');
        items.forEach((item, i) => {
            const rounding = item.order_rounding_rule || 'none';
            const pos = item.order_sort_position || 999;
            console.log(`  ${String(i + 1).padStart(3)}. [pos:${pos}] ${item.excel_reference} (${item.name}) — rounding: ${rounding}`);
        });
    }

    // Configurar rounding rules automáticamente
    console.log('\n🔧 Configurando rounding rules...');

    // Papelitos → ceiling_30
    const { data: papelitos } = await supabase
        .from('inventory_items')
        .select('id, name, excel_reference')
        .or('excel_reference.ilike.%papelito%,name.ilike.%papelito%');

    if (papelitos && papelitos.length > 0) {
        for (const p of papelitos) {
            await supabase.from('inventory_items').update({ order_rounding_rule: 'ceiling_30' }).eq('id', p.id);
            console.log(`  ✅ ${p.name} → ceiling_30`);
        }
    } else {
        console.log('  ⚠️ No se encontraron Papelitos');
    }

    // Quesadillas → ceiling_4
    const { data: quesadillas } = await supabase
        .from('inventory_items')
        .select('id, name, excel_reference')
        .or('excel_reference.ilike.%quesadilla%,name.ilike.%quesadilla%');

    if (quesadillas && quesadillas.length > 0) {
        for (const q of quesadillas) {
            await supabase.from('inventory_items').update({ order_rounding_rule: 'ceiling_4' }).eq('id', q.id);
            console.log(`  ✅ ${q.name} → ceiling_4`);
        }
    } else {
        console.log('  ⚠️ No se encontraron Quesadillas');
    }

    // Verificar datos de weekly_bases (para saber si hay bases guardadas)
    console.log('\n📅 Verificando bases semanales existentes...');
    const { data: bases, error: basesErr } = await supabase
        .from('inventory_weekly_bases')
        .select('week_start_date, store_id')
        .order('week_start_date', { ascending: false })
        .limit(10);

    if (bases && bases.length > 0) {
        const uniqueWeeks = [...new Set(bases.map(b => `${b.week_start_date} (store: ${b.store_id})`))];
        console.log(`  ✅ ${bases.length} registros encontrados. Semanas más recientes:`);
        uniqueWeeks.forEach(w => console.log(`    📅 ${w}`));
    } else {
        console.log('  ⚠️ No hay bases semanales guardadas aún');
    }

    // Verificar inventory_counts
    console.log('\n📋 Verificando sobrantes (inventory_counts)...');
    const { data: countSummary } = await supabase
        .from('inventory_counts')
        .select('count_date, store_id')
        .order('count_date', { ascending: false })
        .limit(10);

    if (countSummary && countSummary.length > 0) {
        const uniqueDates = [...new Set(countSummary.map(c => `${c.count_date} (store: ${c.store_id})`))];
        console.log(`  ✅ Registros encontrados. Fechas más recientes:`);
        uniqueDates.forEach(d => console.log(`    📋 ${d}`));
    } else {
        console.log('  ⚠️ No hay sobrantes guardados aún');
    }

    // Check QB mappings
    console.log('\n🔗 Verificando mapeos QuickBooks...');
    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, inventory_item_id, qb_item_name')
        .limit(5);
    
    console.log(`  ${mappings ? mappings.length : 0} mapeos QB encontrados (mostrando primeros 5)`);
    mappings?.forEach(m => console.log(`    🔗 QB:${m.qb_item_id} → ${m.qb_item_name}`));

    console.log('\n✅ Setup completado.');
}

run().catch(e => console.error('Error:', e));
