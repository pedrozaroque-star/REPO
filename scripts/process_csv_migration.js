const fs = require('fs');
const path = require('path');

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
    'WilianAguilar': 48, // Handle typo in CSV if exists
    'Wilian  Aguilar': 48, // Handle double space
    'Willian Aguilar': 48,
};

// Robust CSV Parser handling multiline quotes
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
                    // Escaped quote
                    currentField += '"';
                    i++; // Skip next quote
                } else {
                    // End of quote
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
                // End of line
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                if (char === '\r') i++; // Skip \n
            } else if (char === '\r') {
                // Standalone \r usually line break too
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
            } else {
                currentField += char;
            }
        }
    }
    // Push last row if exists
    if (currentRow.length > 0 || currentField.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }
    return rows;
}

// Format Date for Postgres (YYYY-MM-DD HH:mm:ss)
// Format Date for Postgres (YYYY-MM-DD HH:mm:ss)
function formatTimestamp(dateStr, timeStr) {
    if (!dateStr) return null;

    // Parse YYYY-MM-DD directly to avoid timezone issues with new Date()
    // format: 2025-10-28
    const dateParts = dateStr.trim().split('-');
    if (dateParts.length !== 3) return null;

    const yyyy = dateParts[0];
    const mm = dateParts[1];
    const dd = dateParts[2];
    const baseDate = `${yyyy}-${mm}-${dd}`;

    if (!timeStr) return `${baseDate} 00:00:00`;

    // Time cleaning
    let time = timeStr.trim();
    // Helper to genericize time format (e.g. 1:20 PM -> 13:20) if needed, 
    // but assuming 24h as per previous check or 13:22 format.
    // If it is 24h HH:mm
    if (time.match(/^\d{1,2}:\d{2}$/)) {
        if (time.length < 5) time = '0' + time; // 9:00 -> 09:00
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
    if (isNaN(diffMs)) return null;
    if (diffMs < 0) return null;

    const diffMins = Math.floor(diffMs / 60000);

    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;

    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
}

try {
    console.log('Reading CSV file...');
    const csvPath = path.resolve(__dirname, '../inspecciones_original.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');

    console.log('Parsing CSV...');
    const rows = parseCSV(csvContent);
    console.log(`Parsed ${rows.length} rows.`);

    if (rows.length === 0) throw new Error('CSV is empty or parsed incorrectly.');

    const header = rows[0].map(h => h.trim());
    // Headers mapped by index
    const idx = {};
    header.forEach((h, i) => idx[h] = i);

    console.log('Headers:', header);

    // Validate critical headers
    if (idx['ID'] === undefined || idx['Fecha'] === undefined) {
        throw new Error('Missing required headers ID or Fecha.');
    }

    let sqlOutput = '';
    let updateCount = 0;
    let insertCount = 0;

    // Generate SQL
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length === 0 || (row.length === 1 && row[0] === '')) continue; // Skip empty

        // Basic safety check for row length roughly matching header
        // Some rows might have extra empty columns or strict checks?

        let originalId = row[idx['ID']];

        // Handle missing ID by generating a deterministic UUID
        if (!originalId) {
            const nReport = row[idx['NReport']];
            if (nReport) {
                const crypto = require('crypto');
                const uniqueString = `${nReport}-${fecha}-${row[idx['Sucursal']]}-${row[idx['Inspector']]}`;
                const hash = crypto.createHash('md5').update(uniqueString).digest('hex');
                // Format as UUID: 8-4-4-4-12
                originalId = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
            }
        }

        if (!originalId) continue;

        const fecha = row[idx['Fecha']];
        const horaStart = row[idx['Hora']];
        const timestampEnd = row[idx['Timestamp']];

        // Parse Timestamps
        let endIso = null;
        if (timestampEnd) {
            const cleanedEnd = timestampEnd.replace(/(\d+)\/(\d+)\/(\d+) /, '$3-$1-$2 '); // MM/DD/YYYY -> YYYY-MM-DD
            const d = new Date(cleanedEnd);
            if (!isNaN(d.getTime())) {
                const y = d.getFullYear();
                const mo = String(d.getMonth() + 1).padStart(2, '0');
                const da = String(d.getDate()).padStart(2, '0');
                const t = d.toTimeString().split(' ')[0]; // HH:mm:ss
                endIso = `${y}-${mo}-${da} ${t}`;
            }
        }

        const startIso = formatTimestamp(fecha, horaStart);
        const duration = calculateDuration(startIso, endIso);

        const storeName = row[idx['Sucursal']];
        const storeId = STORE_MAP[storeName] || 'NULL';

        const inspectorName = row[idx['Inspector']];
        const inspectorId = USER_MAP[inspectorName] || 'NULL';

        // Additional Inspector Mapping fallback - try to find by string similarity or partial?
        // For now rely on map.

        const score = row[idx['Promedio(0-100)']];
        const answersJson = row[idx['DetalleJSON']];
        const photosStr = row[idx['FotosURLs']];
        let photos = [];
        if (photosStr) {
            photos = photosStr.split(/\r?\n/).map(p => p.trim()).filter(p => p.startsWith('http'));
        }

        const escape = (str) => str ? str.replace(/'/g, "''") : '';
        const safeAnswers = answersJson ? `'${escape(answersJson)}'::jsonb` : 'NULL';

        // UPDATE
        if (startIso && endIso && duration && originalId) {
            sqlOutput += `UPDATE supervisor_inspections SET start_time = '${startIso.split(' ')[1]}', end_time = '${endIso.split(' ')[1]}', duration = '${duration}' WHERE original_report_id = '${originalId}';\n`;
            updateCount++;
        }

        // INSERT
        const insertSql = `
        INSERT INTO supervisor_inspections (
            original_report_id, store_id, inspector_id, inspection_date, 
            start_time, end_time, duration, overall_score, 
            answers, photos, created_at, updated_at,
            estatus_admin, supervisor_name
        )
        SELECT 
            '${originalId}', ${storeId}, ${inspectorId}, '${formatTimestamp(fecha, '00:00:00').split(' ')[0]}',
            ${startIso ? `'${startIso.split(' ')[1]}'` : 'NULL'}, ${endIso ? `'${endIso.split(' ')[1]}'` : 'NULL'}, ${duration ? `'${duration}'` : 'NULL'}, ${score || 0},
            ${safeAnswers}, ARRAY[${photos.map(p => `'${escape(p)}'`).join(',')}]::text[], '${endIso || 'NOW()'}', '${endIso || 'NOW()'}',
            'cerrado', '${escape(inspectorName)}'
        WHERE NOT EXISTS (SELECT 1 FROM supervisor_inspections WHERE original_report_id = '${originalId}');
        `;

        sqlOutput += insertSql + '\n';
        insertCount++;
    }

    const outPath = path.resolve(__dirname, '../migration_plan.sql');
    fs.writeFileSync(outPath, sqlOutput);
    console.log(`Analyzed ${rows.length - 1} rows.`);
    console.log(`Generated SQL for ${updateCount} updates and potential ${insertCount} inserts.`);
    console.log(`Backup saved to ${outPath}`);

} catch (err) {
    console.error('ERROR:', err);
    process.exit(1);
}
