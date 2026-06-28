const XLSX = require('xlsx');
const wb = XLSX.readFile('Lynwood Order.xlsx');

// Get the Orders sheet
const ordersWs = wb.Sheets['Orders'];
if (ordersWs) {
  const data = XLSX.utils.sheet_to_json(ordersWs, {header:1, defval:''});
  console.log('=== ORDERS SHEET ===');
  console.log('Total rows:', data.length);
  // Show ALL rows
  for (let i = 0; i < Math.min(data.length, 60); i++) {
    const row = data[i];
    if (row.some(v => v !== '')) {
      console.log('Row ' + i + ':', JSON.stringify(row));
    }
  }
}

// Get the Base sheet headers more detail
const baseWs = wb.Sheets['Base'];
if (baseWs) {
  const data = XLSX.utils.sheet_to_json(baseWs, {header:1, defval:''});
  console.log('\n\n=== BASE SHEET HEADERS ===');
  console.log('Row 0:', JSON.stringify(data[0]));
  console.log('Row 1:', JSON.stringify(data[1]));
  // Show a complete row for structure
  console.log('\nRow 2 (Horchata):', JSON.stringify(data[2]));
  console.log('Columns count:', data[2].length);
  
  // Map columns
  console.log('\n--- Column mapping for Row 2 ---');
  for (let c = 0; c < data[2].length; c++) {
    console.log('  Col ' + c + ' (H0: "' + (data[0][c] || '') + '", H1: "' + (data[1][c] || '') + '"): ' + data[2][c]);
  }
}

// Get a weekly sheet full structure
const weekSheet = wb.Sheets['15-Jun al 21-Jun'];
if (weekSheet) {
  const data = XLSX.utils.sheet_to_json(weekSheet, {header:1, defval:''});
  console.log('\n\n=== 15-Jun al 21-Jun SHEET ===');
  console.log('Row 0:', JSON.stringify(data[0]));
  console.log('Row 1:', JSON.stringify(data[1]));
  console.log('\nRow 2 (Horchata):', JSON.stringify(data[2]));
  console.log('Columns count:', data[2].length);
  console.log('\n--- Column mapping for Row 2 ---');
  for (let c = 0; c < data[0].length; c++) {
    console.log('  Col ' + c + ' (H0: "' + (data[0][c] || '') + '", H1: "' + (data[1][c] || '') + '"): ' + (data[2][c] || ''));
  }
}
