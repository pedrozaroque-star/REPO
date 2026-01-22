const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'Weekly Operations Report.xlsx');

if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert sheet to JSON (header: 1 means array of arrays)
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

if (data.length === 0) {
    console.log("Empty sheet");
    process.exit(0);
}

console.log("--- First 10 Rows ---");
data.slice(0, 10).forEach((row, i) => {
    console.log(`Row ${i + 1}:`, JSON.stringify(row));
});
