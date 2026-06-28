/**
 * Script para importar semanas del 2026 del Excel "Lynwood Order.xlsx" a Supabase.
 * Solo importa datos del año 2026.
 * 
 * Importa:
 * - inventory_weekly_bases (BASE/PAR semanal)
 * - inventory_counts (sobrantes diarios) → columna quantity_on_hand
 * - inventory_par_ideal (de la hoja "Base" activa)
 * 
 * Ejecutar: node scripts/import-excel-2026.js
 */
require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORE_ID = 14; // Lynwood
const wb = XLSX.readFile('Lynwood Order.xlsx');

function parseExcelDate(val) {
    if (typeof val === 'number' && val > 40000) {
        const d = XLSX.SSF.parse_date_code(val);
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return null;
}

function getMondayFromDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().split('T')[0];
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

function safeNum(val) {
    if (val === '' || val === null || val === undefined) return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
}

async function getItemMap() {
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, excel_reference')
        .not('excel_reference', 'is', null);
    
    const map = new Map();
    items?.forEach(item => {
        if (item.excel_reference) {
            map.set(item.excel_reference.trim().toLowerCase(), item.id);
        }
    });
    return map;
}

function extractMondayFromSheet(sheetName) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const row0 = data[0] || [];
    const row1 = data[1] || [];
    
    // Check row 1 first (Base sheet has dates there)
    for (let c = 2; c <= 8; c++) {
        const d = parseExcelDate(row1[c]);
        if (d) return { monday: getMondayFromDate(d), data };
    }
    // Then row 0
    for (let c = 2; c <= 8; c++) {
        const d = parseExcelDate(row0[c]);
        if (d) return { monday: getMondayFromDate(d), data };
    }
    return null;
}

async function main() {
    console.log('🔄 Importando semanas del 2026 desde el Excel...\n');
    
    const itemMap = await getItemMap();
    console.log(`📦 ${itemMap.size} items mapeados en la BD\n`);
    
    // First, identify all 2026 sheets
    const sheets2026 = [];
    for (const name of wb.SheetNames) {
        const result = extractMondayFromSheet(name);
        if (result && result.monday.startsWith('2026')) {
            sheets2026.push({ name, monday: result.monday, data: result.data });
        }
    }
    
    console.log(`📅 ${sheets2026.length} hojas con datos de 2026 encontradas:\n`);
    sheets2026.forEach(s => console.log(`   📅 "${s.name}" → Lunes ${s.monday}`));
    console.log('');
    
    if (sheets2026.length === 0) {
        console.log('❌ No se encontraron hojas con datos de 2026.');
        return;
    }
    
    // Clean only 2026 data for Lynwood
    console.log('🧹 Limpiando datos 2026 previos de Lynwood...');
    await supabase.from('inventory_weekly_bases')
        .delete()
        .eq('store_id', STORE_ID)
        .gte('week_start_date', '2026-01-01')
        .lte('week_start_date', '2026-12-31');
    await supabase.from('inventory_counts')
        .delete()
        .eq('store_id', STORE_ID)
        .gte('count_date', '2026-01-01')
        .lte('count_date', '2026-12-31');
    console.log('  ✅ Datos 2026 limpiados\n');
    
    let totalBases = 0;
    let totalLeftovers = 0;
    const weeksSeen = new Set();
    
    for (const sheet of sheets2026) {
        if (weeksSeen.has(sheet.monday)) {
            console.log(`  ⏭️  "${sheet.name}" → ${sheet.monday} (duplicada, saltando)`);
            continue;
        }
        weeksSeen.add(sheet.monday);
        
        const data = sheet.data;
        const basesInsert = [];
        const leftoversInsert = [];
        let itemCount = 0;
        
        for (let i = 2; i < Math.min(data.length, 55); i++) {
            const row = data[i];
            const itemName = row[1];
            if (!itemName || typeof itemName !== 'string' || !itemName.trim()) continue;
            
            const itemId = itemMap.get(itemName.trim().toLowerCase());
            if (!itemId) continue;
            
            itemCount++;
            
            // BASE: C(2)=MON, D(3)=TUE, E(4)=WED, F(5)=THU, G(6)=FRI, H(7)=SAT
            basesInsert.push({
                store_id: STORE_ID,
                week_start_date: sheet.monday,
                inventory_item_id: itemId,
                mon_par: safeNum(row[2]) || 0,
                tue_par: safeNum(row[3]) || 0,
                wed_par: safeNum(row[4]) || 0,
                thu_par: safeNum(row[5]) || 0,
                fri_par: safeNum(row[6]) || 0,
                sat_par: safeNum(row[7]) || 0,
                sun_par: safeNum(row[8]) || 0,
            });
            
            // SOBRANTES: K(10)=MON, L(11)=TUE, M(12)=WED, N(13)=THU, O(14)=FRI, P(15)=SAT, Q(16)=SUN
            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
                const colIndex = 10 + dayOffset;
                const val = safeNum(row[colIndex]);
                if (val !== null && val >= 0) {
                    const countDate = addDays(sheet.monday, dayOffset);
                    leftoversInsert.push({
                        store_id: STORE_ID,
                        inventory_item_id: itemId,
                        count_date: countDate,
                        quantity_on_hand: val,
                    });
                }
            }
        }
        
        // Insert bases
        if (basesInsert.length > 0) {
            for (let i = 0; i < basesInsert.length; i += 50) {
                const batch = basesInsert.slice(i, i + 50);
                const { error } = await supabase.from('inventory_weekly_bases').insert(batch);
                if (error) {
                    console.error(`  ❌ Error bases "${sheet.name}": ${error.message}`);
                }
            }
            totalBases += basesInsert.length;
        }
        
        // Insert leftovers
        if (leftoversInsert.length > 0) {
            for (let i = 0; i < leftoversInsert.length; i += 100) {
                const batch = leftoversInsert.slice(i, i + 100);
                const { error } = await supabase.from('inventory_counts').insert(batch);
                if (error && !error.message.includes('duplicate')) {
                    console.error(`  ❌ Error sobrantes "${sheet.name}": ${error.message}`);
                }
            }
            totalLeftovers += leftoversInsert.length;
        }
        
        console.log(`  ✅ "${sheet.name}" → ${sheet.monday} | ${itemCount} items | ${basesInsert.length} bases | ${leftoversInsert.length} sobrantes`);
    }
    
    // Import PAR Ideal from "Base" sheet
    console.log('\n📊 Importando PAR Ideal desde hoja "Base"...');
    const baseSheet = wb.Sheets['Base'];
    if (baseSheet) {
        const data = XLSX.utils.sheet_to_json(baseSheet, { header: 1, defval: '' });
        
        await supabase.from('inventory_par_ideal').delete().eq('store_id', STORE_ID);
        
        const parRecords = [];
        for (let i = 2; i < Math.min(data.length, 55); i++) {
            const row = data[i];
            const itemName = row[1];
            if (!itemName || typeof itemName !== 'string') continue;
            
            const itemId = itemMap.get(itemName.trim().toLowerCase());
            if (!itemId) continue;
            
            parRecords.push({
                store_id: STORE_ID,
                inventory_item_id: itemId,
                mon_par: safeNum(row[28]) || 0,
                tue_par: safeNum(row[29]) || 0,
                wed_par: safeNum(row[30]) || 0,
                thu_par: safeNum(row[31]) || 0,
                fri_par: safeNum(row[32]) || 0,
                sat_par: safeNum(row[33]) || 0,
                sun_par: safeNum(row[34]) || 0,
                calculated_from_weeks: sheets2026.length,
            });
        }
        
        if (parRecords.length > 0) {
            const { error } = await supabase.from('inventory_par_ideal').insert(parRecords);
            if (error) console.error('  ❌ Error PAR Ideal:', error.message);
            else console.log(`  ✅ ${parRecords.length} registros de PAR Ideal`);
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE IMPORTACIÓN 2026');
    console.log('='.repeat(60));
    console.log(`  📅 Semanas importadas: ${weeksSeen.size}`);
    console.log(`  📋 Registros de BASE: ${totalBases}`);
    console.log(`  📦 Registros de SOBRANTES: ${totalLeftovers}`);
    console.log('='.repeat(60));
    console.log('\n✅ ¡Importación completada!');
}

main().catch(e => console.error('❌ Error fatal:', e));
