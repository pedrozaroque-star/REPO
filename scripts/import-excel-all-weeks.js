/**
 * Script para importar TODAS las semanas del Excel "Lynwood Order.xlsx" a Supabase.
 * 
 * Importa:
 * - inventory_weekly_bases (BASE/PAR semanal)
 * - inventory_counts (sobrantes diarios)
 * - inventory_par_ideal (de la hoja "Base" activa)
 * 
 * Ejecutar: node scripts/import-excel-all-weeks.js
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

// Column mapping based on our analysis:
// BASE: C(2)=MON, D(3)=TUE, E(4)=WED, F(5)=THU, G(6)=FRI, H(7)=SAT, I(8)=SUN(empty)
// SOBRANTES: K(10)=MON, L(11)=TUE, M(12)=WED, N(13)=THU, O(14)=FRI, P(15)=SAT, Q(16)=SUN
// PAR IDEAL: col 28=MON, 29=TUE, 30=WED, 31=THU, 32=FRI, 33=SAT, 34=SUN

const BASE_COLS = [2, 3, 4, 5, 6, 7]; // MON-SAT (SUN at 8 is empty per rules)
const LEFTOVER_COLS = [10, 11, 12, 13, 14, 15, 16]; // MON-SUN
const PAR_COLS = [28, 29, 30, 31, 32, 33, 34]; // MON-SUN
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LEFTOVER_DAY_OFFSETS = [0, 1, 2, 3, 4, 5, 6]; // MON=0, TUE=1, ...SUN=6

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

function parseExcelDate(val) {
    if (typeof val === 'number' && val > 40000) {
        const d = XLSX.SSF.parse_date_code(val);
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return null;
}

function getMondayFromDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay(); // 0=Sun...6=Sat
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

async function processSheet(sheetName, itemMap) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const row0 = data[0] || [];
    const row1 = data[1] || [];
    
    // Try to find the Monday date from row 1 (archived sheets) or row 0
    // Dates are in columns C onwards (index 2+)
    let mondayDate = null;
    
    // Check row 1 first (Base sheet has dates in row 1)
    for (let c = 2; c <= 8; c++) {
        const d = parseExcelDate(row1[c]);
        if (d) {
            mondayDate = getMondayFromDate(d);
            break;
        }
    }
    
    // Then check row 0 (archived sheets may have dates here)
    if (!mondayDate) {
        for (let c = 2; c <= 8; c++) {
            const d = parseExcelDate(row0[c]);
            if (d) {
                mondayDate = getMondayFromDate(d);
                break;
            }
        }
    }
    
    if (!mondayDate) {
        return { skipped: true, reason: 'No dates found' };
    }
    
    // Filter: only 2024 and later (this year = 2026, but Excel has 2023-2024 data)
    // Actually import ALL data - user asked for "todas las semanas"
    
    const basesUpsert = [];
    const leftoversUpsert = [];
    let itemsProcessed = 0;
    
    for (let i = 2; i < Math.min(data.length, 55); i++) {
        const row = data[i];
        const itemName = row[1];
        if (!itemName || typeof itemName !== 'string' || !itemName.trim()) continue;
        
        const itemId = itemMap.get(itemName.trim().toLowerCase());
        if (!itemId) continue;
        
        itemsProcessed++;
        
        // Extract BASE values (MON-SAT, index 2-7)
        const baseMon = safeNum(row[2]) || 0;
        const baseTue = safeNum(row[3]) || 0;
        const baseWed = safeNum(row[4]) || 0;
        const baseThu = safeNum(row[5]) || 0;
        const baseFri = safeNum(row[6]) || 0;
        const baseSat = safeNum(row[7]) || 0;
        const baseSun = safeNum(row[8]) || 0;
        
        basesUpsert.push({
            store_id: STORE_ID,
            week_start_date: mondayDate,
            inventory_item_id: itemId,
            mon_par: baseMon,
            tue_par: baseTue,
            wed_par: baseWed,
            thu_par: baseThu,
            fri_par: baseFri,
            sat_par: baseSat,
            sun_par: baseSun,
        });
        
        // Extract SOBRANTES (LEFTOVERS) - these are daily counts
        // Col K(10)=MON, L(11)=TUE, M(12)=WED, N(13)=THU, O(14)=FRI, P(15)=SAT, Q(16)=SUN
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
            const colIndex = 10 + dayOffset; // K=10, L=11, ...Q=16
            const val = safeNum(row[colIndex]);
            if (val !== null && val >= 0) {
                const countDate = addDays(mondayDate, dayOffset);
                leftoversUpsert.push({
                    store_id: STORE_ID,
                    inventory_item_id: itemId,
                    count_date: countDate,
                    quantity: val,
                    count_type: 'leftover',
                });
            }
        }
    }
    
    return { mondayDate, basesUpsert, leftoversUpsert, itemsProcessed };
}

async function main() {
    console.log('🔄 Importando TODAS las semanas del Excel...\n');
    
    const itemMap = await getItemMap();
    console.log(`📦 ${itemMap.size} items mapeados en la BD\n`);
    
    // First clear existing data for Lynwood to avoid duplicates
    console.log('🧹 Limpiando datos previos de Lynwood...');
    await supabase.from('inventory_weekly_bases').delete().eq('store_id', STORE_ID);
    await supabase.from('inventory_counts').delete().eq('store_id', STORE_ID);
    console.log('  ✅ Datos limpiados\n');
    
    let totalSheets = 0;
    let totalBases = 0;
    let totalLeftovers = 0;
    let skipped = 0;
    const weeksSeen = new Set();
    
    // Process all sheets
    for (const sheetName of wb.SheetNames) {
        const result = await processSheet(sheetName, itemMap);
        
        if (result.skipped) {
            skipped++;
            continue;
        }
        
        if (weeksSeen.has(result.mondayDate)) {
            // Skip duplicate weeks (Base and archived sheet may overlap)
            // Keep the first one (which is the most recent / active)
            console.log(`  ⏭️  "${sheetName}" → ${result.mondayDate} (duplicada, saltando)`);
            continue;
        }
        weeksSeen.add(result.mondayDate);
        totalSheets++;
        
        // Upsert bases in batches of 50
        if (result.basesUpsert.length > 0) {
            for (let i = 0; i < result.basesUpsert.length; i += 50) {
                const batch = result.basesUpsert.slice(i, i + 50);
                const { error } = await supabase
                    .from('inventory_weekly_bases')
                    .upsert(batch, { onConflict: 'store_id,week_start_date,inventory_item_id' });
                if (error) {
                    // Try insert instead
                    const { error: insErr } = await supabase
                        .from('inventory_weekly_bases')
                        .insert(batch);
                    if (insErr) console.error(`  ❌ Error bases ${sheetName}: ${insErr.message}`);
                }
            }
            totalBases += result.basesUpsert.length;
        }
        
        // Insert leftovers in batches of 100
        if (result.leftoversUpsert.length > 0) {
            for (let i = 0; i < result.leftoversUpsert.length; i += 100) {
                const batch = result.leftoversUpsert.slice(i, i + 100);
                const { error } = await supabase
                    .from('inventory_counts')
                    .upsert(batch, { onConflict: 'store_id,inventory_item_id,count_date,count_type' });
                if (error) {
                    // Try insert
                    const { error: insErr } = await supabase
                        .from('inventory_counts')
                        .insert(batch);
                    if (insErr && !insErr.message.includes('duplicate')) {
                        console.error(`  ❌ Error leftovers ${sheetName}: ${insErr.message}`);
                    }
                }
            }
            totalLeftovers += result.leftoversUpsert.length;
        }
        
        console.log(`  ✅ "${sheetName}" → ${result.mondayDate} | ${result.itemsProcessed} items | ${result.basesUpsert.length} bases | ${result.leftoversUpsert.length} sobrantes`);
    }
    
    // Now import PAR Ideal from "Base" sheet
    console.log('\n📊 Importando PAR Ideal desde hoja "Base"...');
    const baseWs = wb.Sheets['Base'];
    if (baseWs) {
        const data = XLSX.utils.sheet_to_json(baseWs, { header: 1, defval: '' });
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
                calculated_from_weeks: totalSheets,
            });
        }
        
        if (parRecords.length > 0) {
            // Clear existing
            await supabase.from('inventory_par_ideal').delete().eq('store_id', STORE_ID);
            
            for (let i = 0; i < parRecords.length; i += 50) {
                const batch = parRecords.slice(i, i + 50);
                const { error } = await supabase.from('inventory_par_ideal').insert(batch);
                if (error) console.error('  ❌ Error PAR Ideal:', error.message);
            }
            console.log(`  ✅ ${parRecords.length} registros de PAR Ideal importados`);
        }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE IMPORTACIÓN');
    console.log('='.repeat(60));
    console.log(`  📅 Semanas importadas: ${totalSheets}`);
    console.log(`  📋 Registros de BASE: ${totalBases}`);
    console.log(`  📦 Registros de SOBRANTES: ${totalLeftovers}`);
    console.log(`  ⏭️  Hojas saltadas: ${skipped} (sin fechas o duplicadas)`);
    console.log(`  📊 Registros de PAR Ideal: importados desde hoja "Base"`);
    console.log('='.repeat(60));
    console.log('\n✅ ¡Importación completada!');
}

main().catch(e => console.error('❌ Error fatal:', e));
