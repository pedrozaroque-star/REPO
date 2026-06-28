/**
 * Script para configurar order_sort_position basado en el orden del Excel.
 * Lee el Excel "Lynwood Order.xlsx" y asigna posiciones 1, 2, 3... a cada item.
 * 
 * Ejecutar: node scripts/sync-excel-order-positions.js
 */
require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Read Excel
    const wb = XLSX.readFile('Lynwood Order.xlsx');
    const baseWs = wb.Sheets['Base'];
    const data = XLSX.utils.sheet_to_json(baseWs, { header: 1, defval: '' });

    console.log('📊 Leyendo orden de items del Excel...\n');

    // Extract item names from column B (index 1), starting from row 2 (index 2)
    const excelItems = [];
    for (let i = 2; i < data.length; i++) {
        const name = data[i][1]; // Column B = item name
        if (name && typeof name === 'string' && name.trim().length > 0) {
            excelItems.push(name.trim());
        }
    }

    console.log(`  📋 ${excelItems.length} items encontrados en el Excel:\n`);

    // Get all items with excel_reference from DB
    const { data: dbItems } = await supabase
        .from('inventory_items')
        .select('id, name, excel_reference')
        .not('excel_reference', 'is', null);

    const refMap = new Map();
    dbItems?.forEach(item => refMap.set(item.excel_reference?.trim().toLowerCase(), item));

    let matched = 0;
    let unmatched = 0;
    const updates = [];

    for (let i = 0; i < excelItems.length; i++) {
        const excelName = excelItems[i];
        const position = i + 1;

        // Try to find match by excel_reference
        const dbItem = refMap.get(excelName.toLowerCase());

        if (dbItem) {
            updates.push({ id: dbItem.id, position, excelName, dbName: dbItem.name });
            matched++;
            console.log(`  ${String(position).padStart(3)}. ✅ "${excelName}" → ${dbItem.name}`);
        } else {
            unmatched++;
            console.log(`  ${String(position).padStart(3)}. ❌ "${excelName}" → NO MATCH`);
        }
    }

    console.log(`\n  📊 Matched: ${matched}, Unmatched: ${unmatched}`);

    // Apply updates
    if (updates.length > 0) {
        console.log(`\n🔄 Actualizando order_sort_position para ${updates.length} items...`);
        for (const u of updates) {
            const { error } = await supabase
                .from('inventory_items')
                .update({ order_sort_position: u.position })
                .eq('id', u.id);
            if (error) console.error(`  ❌ Error en ${u.dbName}: ${error.message}`);
        }
        console.log('  ✅ Posiciones actualizadas.');
    }

    // Also extract unit descriptions from column A
    console.log('\n📝 Leyendo unidades del Excel (columna A)...');
    for (let i = 2; i < data.length; i++) {
        const unit = data[i][0]; // Column A = unit type
        const name = data[i][1];
        if (unit && name) {
            const dbItem = refMap.get(name.trim().toLowerCase());
            if (dbItem && unit.toString().trim().length > 0) {
                await supabase
                    .from('inventory_items')
                    .update({ order_unit_description: unit.toString().trim() })
                    .eq('id', dbItem.id);
            }
        }
    }
    console.log('  ✅ Unidades actualizadas.');

    console.log('\n✅ Configuración completada.');
}

run().catch(e => console.error('Error:', e));
