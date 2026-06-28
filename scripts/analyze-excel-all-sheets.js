/**
 * Script para analizar TODAS las hojas del Excel "Lynwood Order.xlsx"
 * y entender la estructura de datos por semana.
 * 
 * Ejecutar: node scripts/analyze-excel-all-sheets.js
 */
const XLSX = require('xlsx');
const wb = XLSX.readFile('Lynwood Order.xlsx');

console.log('📊 Hojas encontradas en el Excel:', wb.SheetNames.length);
console.log('');

for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    
    // Get date range from row 1 (cells C2:I2 in Excel = index [1][2] to [1][8])
    const row0 = data[0] || [];
    const row1 = data[1] || [];
    
    // Count non-empty data rows (starting from row 2 = index 2)
    let dataRows = 0;
    let itemsWithBase = 0;
    let itemsWithLeftovers = 0;
    
    for (let i = 2; i < Math.min(data.length, 55); i++) {
        const row = data[i];
        if (!row || !row[1]) continue; // Column B = item name
        dataRows++;
        
        // Check if BASE columns have data (columns C-H = index 2-7)
        const hasBase = [2, 3, 4, 5, 6, 7].some(c => row[c] !== '' && row[c] !== 0 && row[c] !== undefined);
        if (hasBase) itemsWithBase++;
        
        // Check if sobrante columns have data (columns J-P = index 9-15)
        const hasLeftovers = [9, 10, 11, 12, 13, 14, 15].some(c => row[c] !== '' && row[c] !== 0 && row[c] !== undefined);
        if (hasLeftovers) itemsWithLeftovers++;
    }
    
    // Try to extract dates
    let dateInfo = '';
    // Row 0 has headers, Row 1 has dates typically
    // The dates are usually in cells C1:I1 (index [0][2] to [0][8]) or row 1
    const dateCell1 = row0[2] || row1[2] || '';
    const dateCell2 = row0[8] || row1[8] || '';
    
    // Check for date values in various positions
    const possibleDates = [];
    for (let c = 2; c <= 8; c++) {
        if (row0[c] && typeof row0[c] === 'number' && row0[c] > 40000) {
            // Excel serial date
            const d = XLSX.SSF.parse_date_code(row0[c]);
            possibleDates.push(`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`);
        } else if (row1[c] && typeof row1[c] === 'number' && row1[c] > 40000) {
            const d = XLSX.SSF.parse_date_code(row1[c]);
            possibleDates.push(`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`);
        }
    }
    
    if (possibleDates.length > 0) {
        dateInfo = `${possibleDates[0]} → ${possibleDates[possibleDates.length - 1]}`;
    }
    
    console.log(`📅 "${sheetName}"`);
    console.log(`   Fechas: ${dateInfo || 'N/A'}`);
    console.log(`   Filas de datos: ${dataRows}`);
    console.log(`   Items con BASE: ${itemsWithBase}`);
    console.log(`   Items con Sobrantes: ${itemsWithLeftovers}`);
    
    // Show first data row structure for the first sheet
    if (wb.SheetNames.indexOf(sheetName) === 0) {
        console.log('\n   === ESTRUCTURA DE LA PRIMERA HOJA ===');
        console.log('   Row 0 (headers):', JSON.stringify(row0.slice(0, 20)));
        console.log('   Row 1 (dates?):', JSON.stringify(row1.slice(0, 20)));
        if (data[2]) {
            console.log('   Row 2 (first item):', JSON.stringify(data[2].slice(0, 20)));
        }
        
        // Show column mapping
        console.log('\n   === MAPEO DE COLUMNAS ===');
        for (let c = 0; c < Math.min(row0.length, 25); c++) {
            const h = row0[c] || '';
            const v = data[2] ? (data[2][c] || '') : '';
            console.log(`   Col ${c}: "${h}" → ejemplo: "${v}"`);
        }
    }
    console.log('');
}
