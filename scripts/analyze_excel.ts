import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

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

// Log the first few rows to understand structure (sometimes headers are not in row 1)
console.log("--- First 5 Rows ---");
data.slice(0, 5).forEach((row, i) => {
    console.log(`Row ${i + 1}:`, JSON.stringify(row));
});
