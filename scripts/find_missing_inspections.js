const fs = require('fs');
const path = require('path');

// Existing record in Supabase for the date range
const EXISTING_IDS = [
    'd8dd5dce-9917-483a-9473-c9263b04a3d1' // Dec 27, 2025
];

// MAPPINGS
const STORE_MAP = {
    'Bell': 13,
    'Lynwood': 14,
    'South Gate': 15,
    'Downey': 16,
};

const USER_MAP = {
    'Wilian Aguilar': 48,
    'Roque': 47,
    'Gonzalo Velazquez': 44,
    'WilianAguilar': 48,
    'Wilian  Aguilar': 48,
    'Willian Aguilar': 48,
};

// Robust CSV Parser
function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuote) {
            if (char === '"') {
                if (nextChar === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuote = false;
                }
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                inQuote = true;
            } else if (char === ',') {
                currentRow.push(currentField);
                currentField = '';
            } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                if (char === '\r') i++;
            } else if (char === '\r') {
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
            } else {
                currentField += char;
            }
        }
    }
    if (currentRow.length > 0 || currentField.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }
    return rows;
}

function formatTimestamp(dateStr, timeStr) {
    if (!dateStr) return null;
    const dateParts = dateStr.trim().split('-');
    if (dateParts.length !== 3) return null;

    const yyyy = dateParts[0];
    const mm = dateParts[1];
    const dd = dateParts[2];
    const baseDate = `${yyyy}-${mm}-${dd}`;

    if (!timeStr) return `${baseDate} 00:00:00`;

    let time = timeStr.trim();
    if (time.match(/^\d{1,2}:\d{2}$/)) {
        if (time.length < 5) time = '0' + time;
        time += ':00';
    } else if (time.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
        if (time.length < 8) time = '0' + time;
    }

    return `${baseDate} ${time}`;
}

function calculateDuration(startStr, endStr) {
    if (!startStr || !endStr) return null;
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end - start;
    if (isNaN(diffMs) || diffMs < 0) return null;

    const diffMins = Math.floor(diffMs / 60000);
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;

    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
}

function isInDateRange(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const startDate = new Date('2025-12-27');
    const endDate = new Date('2026-01-03T23:59:59');
    return date >= startDate && date <= endDate;
}

try {
    console.log('Reading CSV file...');
    const csvPath = path.resolve(__dirname, '../inspecciones_original.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');

    console.log('Parsing CSV...');
    const rows = parseCSV(csvContent);
    console.log(`Parsed ${rows.length} rows.`);

    if (rows.length === 0) throw new Error('CSV is empty.');

    const header = rows[0].map(h => h.trim());
    const idx = {};
    header.forEach((h, i) => idx[h] = i);

    if (idx['ID'] === undefined || idx['Fecha'] === undefined) {
        throw new Error('Missing required headers ID or Fecha.');
    }

    let sqlOutput = '-- Missing Inspections for Dec 27 - Jan 3\n\n';
    let missingCount = 0;
    let skippedCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

        const fecha = row[idx['Fecha']];

        // Filter by date range
        if (!isInDateRange(fecha)) continue;

        let originalId = row[idx['ID']];

        // Generate UUID if missing
        if (!originalId) {
            const nReport = row[idx['NReport']];
            if (nReport) {
                const crypto = require('crypto');
                const uniqueString = `${nReport}-${fecha}-${row[idx['Sucursal']]}-${row[idx['Inspector']]}`;
                const hash = crypto.createHash('md5').update(uniqueString).digest('hex');
                originalId = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
            }
        }

        if (!originalId) continue;

        // Skip if already exists in Supabase
        if (EXISTING_IDS.includes(originalId)) {
            skippedCount++;
            console.log(`Skipping existing record: ${originalId} (${fecha})`);
            continue;
        }

        const horaStart = row[idx['Hora']];
        const timestampEnd = row[idx['Timestamp']];

        let endIso = null;
        if (timestampEnd) {
            const cleanedEnd = timestampEnd.replace(/(\d+)\/(\d+)\/(\d+) /, '$3-$1-$2 ');
            const d = new Date(cleanedEnd);
            if (!isNaN(d.getTime())) {
                const y = d.getFullYear();
                const mo = String(d.getMonth() + 1).padStart(2, '0');
                const da = String(d.getDate()).padStart(2, '0');
                const t = d.toTimeString().split(' ')[0];
                endIso = `${y}-${mo}-${da} ${t}`;
            }
        }

        const startIso = formatTimestamp(fecha, horaStart);
        const duration = calculateDuration(startIso, endIso);

        const storeName = row[idx['Sucursal']];
        const storeId = STORE_MAP[storeName] || 'NULL';

        const inspectorName = row[idx['Inspector']];
        const inspectorId = USER_MAP[inspectorName] || 'NULL';

        const score = row[idx['Promedio(0-100)']] || 0;
        const answersJson = row[idx['DetalleJSON']];
        const photosStr = row[idx['FotosURLs']];
        let photos = [];
        if (photosStr) {
            photos = photosStr.split(/\r?\n/).map(p => p.trim()).filter(p => p.startsWith('http'));
        }

        const escape = (str) => str ? str.replace(/'/g, "''") : '';
        const safeAnswers = answersJson ? `'${escape(answersJson)}'::jsonb` : 'NULL';

        const insertSql = `
INSERT INTO supervisor_inspections (
    original_report_id, store_id, inspector_id, inspection_date, 
    start_time, end_time, duration, overall_score, 
    answers, photos, created_at, updated_at,
    estatus_admin, supervisor_name
)
VALUES (
    '${originalId}', ${storeId}, ${inspectorId}, '${formatTimestamp(fecha, '00:00:00').split(' ')[0]}',
    ${startIso ? `'${startIso.split(' ')[1]}'` : 'NULL'}, ${endIso ? `'${endIso.split(' ')[1]}'` : 'NULL'}, ${duration ? `'${duration}'` : 'NULL'}, ${score},
    ${safeAnswers}, ARRAY[${photos.map(p => `'${escape(p)}'`).join(',')}]::text[], ${endIso ? `'${endIso}'` : 'NOW()'}, ${endIso ? `'${endIso}'` : 'NOW()'},
    'cerrado', '${escape(inspectorName)}'
);
`;

        sqlOutput += insertSql + '\n';
        missingCount++;
        console.log(`Missing: ${originalId} - ${fecha} (${storeName})`);
    }

    const outPath = path.resolve(__dirname, '../missing_inspections_dec27_jan3.sql');
    fs.writeFileSync(outPath, sqlOutput);

    console.log(`\n=== SUMMARY ===`);
    console.log(`Records in date range: ${missingCount + skippedCount}`);
    console.log(`Already in Supabase: ${skippedCount}`);
    console.log(`Missing records: ${missingCount}`);
    console.log(`\nSQL file saved to: ${outPath}`);

} catch (err) {
    console.error('ERROR:', err);
    process.exit(1);
}
