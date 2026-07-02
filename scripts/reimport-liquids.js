require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const wb = XLSX.readFile('Liquidos Order .xlsx');

const sheetToStoreMap = {
    'H-P Liquidos Order': { id: 11, name: 'Huntington Park' },
    'Downey Orden liquidos': { id: 16, name: 'Downey' },
    'Bell Liquidos Order': { id: 13, name: 'Bell' },
    'Hollywood Liquidos Order': { id: 8, name: 'Hollywood' },
    'Slauson Liquidos Order': { id: 7, name: 'Slauson' },
    'Central Liquidos Order': { id: 6, name: 'LA Central' },
    'Lynwood Liquidos Order': { id: 14, name: 'Lynwood' },
    'Southgate Liquidos Order': { id: 15, name: 'South Gate' },
    'Broadway Liquidos Order Pars': { id: 5, name: 'LA Broadway' },
    'Santa Ana Liquidos Order': { id: 9, name: 'Santa Ana' },
    'Norwalk Liquidos Pars': { id: 12, name: 'Norwalk' },
    'La Puente Liquidos Pars': { id: 10, name: 'La Puente' },
    'Rialto Liquidos Order Pars': { id: 1, name: 'Rialto' },
    'West Covina Liquidos Pars': { id: 3, name: 'West Covina' },
    'Azusa Liquidos ': { id: 4, name: 'Azusa' }
};

// Common name translations to help matching
const aliasMap = {
    'Agua Gavilan': 'Agua Gavilan',
    'Cafe Regular': 'Cafe Regular',
    'Cafe Descafeinado': 'Cafe Descafeinado',
    'Cafe de Olla': 'Cafe de olla',
    'Cafe De Olla': 'Cafe de olla',
    'Papel Termico': 'Papel Termico',
    '33" x 40" x 1.25 mil blue - Trash Bag 125R99SB': '33" x 40" x 1.25 mil blue - Trash Bag 125R99SB',
    '33" x 40" x 1.25 mil blue -Trash Bag': '33" x 40" x 1.25 mil blue - Trash Bag 125R99SB',
    '33" x 40" x 1.25 mil blue - Trash Bag': '33" x 40" x 1.25 mil blue - Trash Bag 125R99SB',
    '30" x 18" x 50" 2.25 Black - Trash Bag 225R99BK': '30" x 18" x 50" 2.25 Black- Trash Bag 225R99BK',
    '30" x 18" x 50" 2.25 Black-Trash Bag': '30" x 18" x 50" 2.25 Black- Trash Bag 225R99BK',
    '30" x 18" x 50" 2.25 Black- Trash Bag': '30" x 18" x 50" 2.25 Black- Trash Bag 225R99BK',
    'Trash Bag - Office': 'Trash bag- office',
    'Trash bag- office': 'Trash bag- office',
    'Trash Bag-Office': 'Trash bag- office',
    'Scotch Brite Heavy Duty Pads': 'Scotch Brite Heavy Duty Pads',
    'Grill Bright MORGAN-320-004': 'Grill Bright MORGAN-320-004',
    'Grill Bright': 'Grill Bright MORGAN-320-004',
    'Lemon Oil 1 QT MORGAN-354-012': 'LEMON OIL 1 QT MORGAN-354-012',
    'Glass Cleaner 900 MORGAN-090-004': 'Glass Cleaner 900 MORGAN-090-004'
};

async function run() {
    console.log('Fetching database mappings and items...');
    const { data: mappings } = await supabase.from('quickbooks_mappings').select('*');
    const { data: items } = await supabase.from('inventory_items').select('*');

    console.log(`Loaded ${mappings.length} QB mappings, ${items.length} inventory items.`);

    // Clean templates first for order_type = 'liquids'
    console.log('🧹 Limpiando templates de liquidos anteriores...');
    await supabase.from('store_order_template').delete().eq('order_type', 'liquids');

    const templatesToInsert = [];
    const parIdealsToInsert = [];
    const seenItems = new Set();

    for (const sheetName of wb.SheetNames) {
        const storeInfo = sheetToStoreMap[sheetName];
        if (!storeInfo) continue;

        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log(`\n🏪 Store: ${storeInfo.name} (Sheet: ${sheetName})`);

        // Find column indexes dynamically
        let parIdx = -1;
        let sIdx = -1;
        let oIdx = -1;

        // Scan rows 0, 1, 2 for headers
        for (let r = 0; r < 3; r++) {
            const row = rows[r];
            if (row) {
                row.forEach((cell, idx) => {
                    if (cell && typeof cell === 'string') {
                        const clean = cell.toLowerCase().trim();
                        if (clean === 'par') parIdx = idx;
                        if (clean === 's' || clean === 'sobrante') sIdx = idx;
                        if (clean === 'o' || clean === 'orden' || clean === 'order') oIdx = idx;
                    }
                });
            }
        }

        console.log(`  Header indexes: PAR=${parIdx}, Sobrante(S)=${sIdx}, Order(O)=${oIdx}`);

        const isBell = sheetName === 'Bell Liquidos Order';
        let pos = 1;
        let matchedCount = 0;

        for (let i = 2; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            let excelName = isBell ? row[1] : row[0];
            if (!excelName || typeof excelName !== 'string') continue;
            excelName = excelName.trim();

            if (excelName.includes('Total') || excelName.includes('TOTAL') || excelName.includes('Order') || excelName.includes('PAR') || excelName === 'S' || excelName === 'O') continue;
            if (excelName.startsWith('(') && excelName.endsWith(')')) continue; // skip units
            if (excelName.length < 3) continue;

            // Extract and clean PAR value
            let parVal = 0;
            if (parIdx !== -1) {
                const rawVal = row[parIdx];
                if (rawVal !== undefined && rawVal !== null) {
                    if (typeof rawVal === 'number') {
                        parVal = rawVal;
                    } else if (typeof rawVal === 'string') {
                        // Extract digits
                        parVal = parseFloat(rawVal) || 0;
                    }
                }
            }

            // Fallback: If PAR is 0 or empty, and we have Sobrante (S) and Order (O) values, calculate PAR = S + O
            if (parVal === 0 && sIdx !== -1 && oIdx !== -1) {
                const sVal = parseFloat(row[sIdx]) || 0;
                const oVal = parseFloat(row[oIdx]) || 0;
                parVal = sVal + oVal;
            }

            // Find matching item in DB
            let matchedMapping = null;
            
            // 1. Try alias
            const alias = aliasMap[excelName];
            if (alias) {
                matchedMapping = mappings.find(m => m.qb_item_name.toLowerCase() === alias.toLowerCase());
            }

            // 2. Try exact qb_item_name match
            if (!matchedMapping) {
                matchedMapping = mappings.find(m => m.qb_item_name.toLowerCase() === excelName.toLowerCase());
            }

            // 3. Try partial match
            if (!matchedMapping) {
                matchedMapping = mappings.find(m => m.qb_item_name.toLowerCase().includes(excelName.toLowerCase()) || excelName.toLowerCase().includes(m.qb_item_name.toLowerCase()));
            }

            // 4. Try inventory_items match
            let matchedItem = null;
            if (matchedMapping) {
                matchedItem = items.find(item => item.id === matchedMapping.inventory_item_id);
            } else {
                matchedItem = items.find(item => item.name.toLowerCase() === excelName.toLowerCase());
                if (!matchedItem) {
                    matchedItem = items.find(item => item.name.toLowerCase().includes(excelName.toLowerCase()) || excelName.toLowerCase().includes(item.name.toLowerCase()));
                }
                if (matchedItem) {
                    matchedMapping = mappings.find(m => m.inventory_item_id === matchedItem.id);
                }
            }

            if (matchedItem && matchedMapping) {
                const uniqueKey = `${storeInfo.id}_${matchedItem.id}`;
                if (!seenItems.has(uniqueKey)) {
                    seenItems.add(uniqueKey);

                    templatesToInsert.push({
                        store_id: storeInfo.id,
                        inventory_item_id: matchedItem.id,
                        qb_item_id: matchedMapping.qb_item_id,
                        qb_item_name: matchedMapping.qb_item_name,
                        sort_position: pos++,
                        order_type: 'liquids'
                    });

                    parIdealsToInsert.push({
                        store_id: storeInfo.id,
                        inventory_item_id: matchedItem.id,
                        mon_par: parVal,
                        tue_par: parVal,
                        wed_par: parVal,
                        thu_par: parVal,
                        fri_par: parVal,
                        sat_par: parVal,
                        sun_par: parVal
                    });

                    matchedCount++;
                }
            }
        }
        console.log(`  Matched and prepared: ${matchedCount} items`);
    }

    console.log(`\nTotal template records to insert: ${templatesToInsert.length}`);
    
    // Insert store_order_template
    if (templatesToInsert.length > 0) {
        console.log('📥 Insertando store_order_template para liquidos...');
        for (let i = 0; i < templatesToInsert.length; i += 100) {
            const batch = templatesToInsert.slice(i, i + 100);
            const { error } = await supabase.from('store_order_template').insert(batch);
            if (error) console.error(`  ❌ Error insertando batch ${i}:`, error.message);
        }
        console.log('✅ store_order_template insertado.');
    }

    // Insert PAR ideals
    if (parIdealsToInsert.length > 0) {
        console.log('📥 Insertando baseline PARs en inventory_par_ideal...');
        for (const par of parIdealsToInsert) {
            const { error } = await supabase
                .from('inventory_par_ideal')
                .upsert(par, { onConflict: 'store_id,inventory_item_id' });
            if (error) console.error(`  ❌ Error upserting PAR:`, error.message);
        }
        console.log('✅ inventory_par_ideal actualizado.');
    }
    console.log('\n🎉 ALL LIQUIDS TEMPLATES RE-IMPORTED SUCCESSFULLY!');
}

run();
