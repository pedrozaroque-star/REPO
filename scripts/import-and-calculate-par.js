/**
 * @module scripts/import-and-calculate-par
 * @description Script para importar historial de PAR y sobrantes desde Excel y calcular el PAR Ideal Matemático.
 *              Guarda este script para poder reutilizarlo con otras tiendas.
 * 
 * Instrucciones:
 * 1. Para cambiar de tienda, modifica las constantes STORE_ID y EXCEL_FILE de abajo.
 * 2. Ejecutar con: node scripts/import-and-calculate-par.js
 */

require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURACIÓN DE LA TIENDA (MODIFICABLE)
// ==========================================
const STORE_ID = 14; // Lynwood por defecto (puedes cambiarlo al ID de la tienda correspondiente)
const EXCEL_FILE = 'Lynwood Order.xlsx'; // Nombre del archivo Excel a procesar

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mapeos de columnas de la hoja semanal
const BASE_COLS = [2, 3, 4, 5, 6, 7]; // LUN-SÁB (Dom está vacío)
const LEFTOVER_COLS = [10, 11, 12, 13, 14, 15, 16]; // LUN-DOM
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

    // Alias especial: Mapear 'Tortillas, Tacos y Platos' (Excel) al item id activo (excel_reference: 'Tortillas para Tacos y Platos')
    map.set('tortillas, tacos y platos', 'dcd79433-e97c-46dc-80c0-8429401e0fa0');

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

async function processSheet(workbook, sheetName, itemMap) {
    const ws = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const row0 = data[0] || [];
    const row1 = data[1] || [];
    
    let mondayDate = null;
    
    // Buscar la fecha del Lunes en la fila 1 o la fila 0
    for (let c = 2; c <= 8; c++) {
        const d = parseExcelDate(row1[c]);
        if (d) {
            mondayDate = getMondayFromDate(d);
            break;
        }
    }
    
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
        return { skipped: true, reason: 'No se encontraron fechas' };
    }

    // Filtrar para importar SOLO las semanas del año 2026
    if (!mondayDate.startsWith('2026')) {
        return { skipped: true, reason: 'No es del año 2026' };
    }
    
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
        
        // Extract SOBRANTES (LEFTOVERS) - daily counts
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
            const colIndex = 10 + dayOffset; // K=10, L=11, ...Q=16
            const val = safeNum(row[colIndex]);
            if (val !== null && val >= 0) {
                const countDate = addDays(mondayDate, dayOffset);
                leftoversUpsert.push({
                    store_id: STORE_ID.toString(),
                    inventory_item_id: itemId,
                    count_date: countDate,
                    quantity_on_hand: val,
                });
            }
        }
    }
    
    return { mondayDate, basesUpsert, leftoversUpsert, itemsProcessed };
}

async function calculateMathematicalParIdeal() {
    console.log('\n📊 Calculando PAR Ideal Matemático...');

    // 1. Obtener todas las bases semanales de la tienda
    const { data: bases, error: basesErr } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', STORE_ID);

    if (basesErr) throw basesErr;
    console.log(`📋 Se leyeron ${bases.length} registros de bases semanales`);

    // 2. Obtener todos los sobrantes de la tienda
    const { data: leftovers, error: leftoversErr } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', STORE_ID.toString());

    if (leftoversErr) throw leftoversErr;
    console.log(`📦 Se leyeron ${leftovers.length} registros de sobrantes`);

    // Crear mapa de sobrantes por item_id y fecha para búsqueda rápida
    const leftoverMap = new Map();
    leftovers.forEach(l => {
        leftoverMap.set(`${l.inventory_item_id}_${l.count_date}`, l.quantity_on_hand);
    });

    const daysOfWeek = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    
    // Agrupar los PARs ajustados de cada semana por item
    const itemAdjustedBases = {};

    bases.forEach(b => {
        const itemId = b.inventory_item_id;
        if (!itemAdjustedBases[itemId]) {
            itemAdjustedBases[itemId] = {
                mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: []
            };
        }

        // Para cada día de la semana (Lunes a Sábado)
        daysOfWeek.forEach((day, index) => {
            const parVal = Number(b[`${day}_par`]) || 0;
            let adjPar = parVal;

            if (day === 'sat') {
                // Sábado se valida con el sobrante del Domingo (índice 6)
                const sundayDateStr = addDays(b.week_start_date, 6);
                const sundayLeftoverVal = leftoverMap.get(`${itemId}_${sundayDateStr}`);
                
                if (sundayLeftoverVal !== undefined && parVal >= 8) {
                    const leftoverPct = (sundayLeftoverVal / parVal) * 100;
                    if (leftoverPct > 30) {
                        if (leftoverPct >= 50) {
                            adjPar = parVal - Math.round(parVal * 0.15);
                        } else {
                            adjPar = parVal - Math.round(parVal * 0.10);
                        }
                    } else if (leftoverPct < 10) {
                        if (parVal >= 40) {
                            adjPar = parVal + Math.round(parVal * 0.10);
                        } else {
                            adjPar = parVal + Math.round(parVal * 0.20);
                        }
                    }
                }
            } else {
                // Lunes a Viernes se valida con el sobrante del mismo día
                const dateStr = addDays(b.week_start_date, index);
                const leftoverVal = leftoverMap.get(`${itemId}_${dateStr}`);
                
                if (leftoverVal !== undefined && parVal >= 10) {
                    const leftoverPct = (leftoverVal / parVal) * 100;
                    if (leftoverPct > 60) {
                        if (leftoverPct >= 70) {
                            adjPar = parVal - Math.round(parVal * 0.15);
                        } else {
                            adjPar = parVal - Math.round(parVal * 0.10);
                        }
                    } else if (leftoverPct < 20) {
                        if (parVal >= 40) {
                            adjPar = parVal + Math.round(parVal * 0.10);
                        } else {
                            adjPar = parVal + Math.round(parVal * 0.20);
                        }
                    }
                }
            }
            
            itemAdjustedBases[itemId][day].push(adjPar);
        });
    });

    // Calcular el promedio de los PARs ajustados para cada item
    const parIdealRecords = [];
    Object.entries(itemAdjustedBases).forEach(([itemId, days]) => {
        const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
        
        parIdealRecords.push({
            store_id: STORE_ID,
            inventory_item_id: itemId,
            mon_par: avg(days.mon),
            tue_par: avg(days.tue),
            wed_par: avg(days.wed),
            thu_par: avg(days.thu),
            fri_par: avg(days.fri),
            sat_par: avg(days.sat),
            sun_par: 0, // Domingo siempre es 0
            calculated_from_weeks: days.mon.length,
            updated_at: new Date().toISOString()
        });
    });

    if (parIdealRecords.length > 0) {
        // Limpiar PAR Ideal anterior de la tienda
        await supabase.from('inventory_par_ideal').delete().eq('store_id', STORE_ID);
        
        // Insertar en lotes de 50
        for (let i = 0; i < parIdealRecords.length; i += 50) {
            const batch = parIdealRecords.slice(i, i + 50);
            const { error } = await supabase.from('inventory_par_ideal').insert(batch);
            if (error) {
                console.error('❌ Error al guardar lote de PAR Ideal:', error.message);
            }
        }
        console.log(`✅ ¡Cálculo matemático completado! Se guardaron ${parIdealRecords.length} registros en inventory_par_ideal.`);
    }
}

async function main() {
    console.log(`🔄 Iniciando procesamiento del Excel "${EXCEL_FILE}" para la tienda ID: ${STORE_ID}...\n`);
    
    const fs = require('fs');
    const tempFile = 'temp_import_' + Date.now() + '.xlsx';
    fs.copyFileSync(EXCEL_FILE, tempFile);
    
    const workbook = XLSX.readFile(tempFile);
    
    try {
        fs.unlinkSync(tempFile);
    } catch (err) {
        console.error('Warning: could not delete temp file:', err.message);
    }
    
    const itemMap = await getItemMap();
    console.log(`📦 ${itemMap.size} items mapeados en la base de datos.`);
    
    // Limpieza de datos antiguos de esta tienda para evitar duplicados
    console.log('🧹 Limpiando historial previo de la tienda...');
    await supabase.from('inventory_weekly_bases').delete().eq('store_id', STORE_ID);
    await supabase.from('inventory_counts').delete().eq('store_id', STORE_ID.toString());
    console.log('  ✅ Limpieza completada\n');
    
    let totalSheets = 0;
    let totalBases = 0;
    let totalLeftovers = 0;
    let skipped = 0;
    const weeksSeen = new Set();
    
    // Procesar cada pestaña del archivo
    for (const sheetName of workbook.SheetNames) {
        // Ignorar pestañas de control (procesamos 'base' porque contiene la semana actual activa)
        if (['orders', 'respaldo', 'copy of base', 'copy of base 1'].includes(sheetName.toLowerCase())) {
            continue;
        }

        const result = await processSheet(workbook, sheetName, itemMap);
        
        if (result.skipped) {
            skipped++;
            continue;
        }
        
        if (weeksSeen.has(result.mondayDate)) {
            console.log(`  ⏭️  "${sheetName}" → ${result.mondayDate} (duplicada, saltando)`);
            continue;
        }
        weeksSeen.add(result.mondayDate);
        totalSheets++;
        
        // Guardar bases de la semana
        if (result.basesUpsert.length > 0) {
            for (let i = 0; i < result.basesUpsert.length; i += 50) {
                const batch = result.basesUpsert.slice(i, i + 50);
                const { error } = await supabase
                    .from('inventory_weekly_bases')
                    .insert(batch);
                if (error) console.error(`  ❌ Error al insertar bases de la pestaña ${sheetName}: ${error.message}`);
            }
            totalBases += result.basesUpsert.length;
        }
        
        // Guardar sobrantes de la semana
        if (result.leftoversUpsert.length > 0) {
            for (let i = 0; i < result.leftoversUpsert.length; i += 100) {
                const batch = result.leftoversUpsert.slice(i, i + 100);
                const { error } = await supabase
                    .from('inventory_counts')
                    .insert(batch);
                if (error && !error.message.includes('duplicate')) {
                    console.error(`  ❌ Error al insertar sobrantes de la pestaña ${sheetName}: ${error.message}`);
                }
            }
            totalLeftovers += result.leftoversUpsert.length;
        }
        
        console.log(`  ✅ "${sheetName}" → ${result.mondayDate} | ${result.itemsProcessed} items | ${result.basesUpsert.length} bases | ${result.leftoversUpsert.length} sobrantes`);
    }
    
    console.log(`\n🎉 Sincronización de Excel terminada.`);
    console.log(`  Semanas procesadas: ${totalSheets}`);
    console.log(`  Hojas ignoradas/sin fecha: ${skipped}`);
    
    // Ejecutar el cálculo matemático
    await calculateMathematicalParIdeal();
    
    console.log('\n🌟 ¡Proceso completo de Sincronización y Recálculo finalizado exitosamente!');
}

main().catch(e => console.error('❌ Error fatal:', e));
