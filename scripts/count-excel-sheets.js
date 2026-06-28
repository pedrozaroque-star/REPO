/**
 * Script para contar hojas y ver estructura.
 * Ejecutar: node scripts/count-excel-sheets.js
 */
const XLSX = require('xlsx');
const wb = XLSX.readFile('Lynwood Order.xlsx');

console.log('📊 Total hojas:', wb.SheetNames.length);
console.log('');

// Classify by year
const sheets2024 = [];
const sheets2023 = [];
const sheetsOther = [];
const sheetBase = [];

for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const row0 = data[0] || [];
    
    // Extract first date
    let firstDate = null;
    for (let c = 2; c <= 8; c++) {
        if (row0[c] && typeof row0[c] === 'number' && row0[c] > 40000) {
            const d = XLSX.SSF.parse_date_code(row0[c]);
            firstDate = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            break;
        }
    }
    
    if (name === 'Base' || name === 'Orders') {
        sheetBase.push({ name, firstDate });
    } else if (firstDate && firstDate.startsWith('2024')) {
        sheets2024.push({ name, firstDate });
    } else if (firstDate && firstDate.startsWith('2023')) {
        sheets2023.push({ name, firstDate });
    } else {
        sheetsOther.push({ name, firstDate });
    }
}

console.log('📋 Hojas especiales:', sheetBase.map(s => s.name).join(', '));
console.log('📅 Hojas 2024:', sheets2024.length);
console.log('📅 Hojas 2023:', sheets2023.length);
console.log('📅 Otras:', sheetsOther.length);

// Show first sheet of 2024 for column structure
console.log('\n=== ESTRUCTURA DEL EXCEL (primera hoja de 2024) ===');
const targetSheet = sheets2024.length > 0 ? sheets2024[0].name : wb.SheetNames[0];
const ws = wb.Sheets[targetSheet];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

console.log(`Hoja: "${targetSheet}"`);
const row0 = data[0] || [];
const row2 = data[2] || []; // First data row

// Show all columns with headers and sample data
for (let c = 0; c < Math.min(row0.length, 30); c++) {
    let header = row0[c];
    if (typeof header === 'number' && header > 40000) {
        const d = XLSX.SSF.parse_date_code(header);
        header = `DATE: ${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
    const sample = row2[c] || '';
    console.log(`  Col ${String.fromCharCode(65+c)} (${c}): "${header}" → "${sample}"`);
}

// Show the "Base" sheet structure for comparison
if (wb.Sheets['Base']) {
    console.log('\n=== ESTRUCTURA DE HOJA "Base" (semana activa) ===');
    const baseData = XLSX.utils.sheet_to_json(wb.Sheets['Base'], { header: 1, defval: '' });
    const baseRow0 = baseData[0] || [];
    const baseRow1 = baseData[1] || [];
    const baseRow2 = baseData[2] || [];
    
    for (let c = 0; c < Math.min(baseRow0.length, 30); c++) {
        let h0 = baseRow0[c];
        let h1 = baseRow1[c];
        if (typeof h0 === 'number' && h0 > 40000) {
            const d = XLSX.SSF.parse_date_code(h0);
            h0 = `DATE: ${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
        }
        if (typeof h1 === 'number' && h1 > 40000) {
            const d = XLSX.SSF.parse_date_code(h1);
            h1 = `DATE: ${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
        }
        const sample = baseRow2[c] || '';
        console.log(`  Col ${String.fromCharCode(65+c)} (${c}): h0="${h0}" h1="${h1}" → data="${sample}"`);
    }
    
    // Show 3 sample items with full data
    console.log('\n=== DATOS DE EJEMPLO (3 items) ===');
    for (let i = 2; i < 5; i++) {
        const row = baseData[i] || [];
        console.log(`  Item: "${row[1]}"`);
        console.log(`    BASE: LUN=${row[2]}, MAR=${row[3]}, MIÉ=${row[4]}, JUE=${row[5]}, VIE=${row[6]}, SÁB=${row[7]}, DOM=${row[8]}`);
        console.log(`    SOBRANTES: LUN=${row[9]}, MAR=${row[10]}, MIÉ=${row[11]}, JUE=${row[12]}, VIE=${row[13]}, SÁB=${row[14]}, DOM=${row[15]}`);
        console.log(`    PAR IDEAL: LUN=${row[21]}, MAR=${row[22]}, MIÉ=${row[23]}, JUE=${row[24]}, VIE=${row[25]}, SÁB=${row[26]}, DOM=${row[27]}`);
    }
}
