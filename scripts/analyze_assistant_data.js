const fs = require('fs');

const SUPABASE_CSV = 'assistant_checklists_rows.csv';
const LEGACY_CSV = 'asistentes.csv';

const STORE_MAP = {
    'Bell': 15,
    'Lynwood': 14,
    'Downey': 13,
    'South Gate': 16,
    'Azusa': 17 // Tentative
};

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote
                    currentField += '"';
                    i++;
                } else {
                    // End of quotes
                    inQuotes = false;
                }
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                currentRow.push(currentField.trim());
                currentField = '';
            } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                currentRow.push(currentField.trim());
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                if (char === '\r') i++;
            } else if (char === '\r') {
                // CR only case
                currentRow.push(currentField.trim());
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
            } else {
                currentField += char;
            }
        }
    }
    // Push last row if exists
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }

    // Remove empty header row if any (or empty lines)
    return rows.filter(r => r.length > 1);
}

function normalizeTime(t) {
    if (!t) return 'UNKNOWN';
    // Handle HH:MM:SS or HH:MM
    // Remove quotes if any remaining (parser handles CSV quotes, but check if content has them)
    t = t.replace(/"/g, '');
    if (t.length >= 5) return t.substring(0, 5);
    return t;
}

function normalizeDate(d) {
    if (!d) return 'UNKNOWN';
    // 2025-12-18
    return d.trim();
}

function main() {
    console.log("Loading Supabase Data...");
    let sbContent;
    try {
        sbContent = fs.readFileSync(SUPABASE_CSV, 'utf8');
    } catch (e) {
        console.error("Error reading Supabase CSV:", e.message);
        return;
    }

    const sbData = parseCSV(sbContent);
    const sbHeader = sbData[0];
    const sbRows = sbData.slice(1);

    // Map header names to indices
    const sbIdx = {};
    sbHeader.forEach((h, i) => sbIdx[h] = i);

    const sbKeys = new Set();

    sbRows.forEach(row => {
        const s_id = row[sbIdx['store_id']];
        const c_type = row[sbIdx['checklist_type']];
        const c_date = row[sbIdx['checklist_date']];
        const u_name = row[sbIdx['user_name']];
        const start_time = row[sbIdx['start_time']];

        const time = normalizeTime(start_time);

        if (s_id && c_type && c_date) {
            const key = `${s_id}|${c_type}|${c_date}|${u_name}|${time}`;
            sbKeys.add(key);
        }
    });

    console.log(`Loaded ${sbRows.length} Supabase records.`);

    console.log("Loading Legacy Data...");
    let legContent;
    try {
        legContent = fs.readFileSync(LEGACY_CSV, 'utf8');
    } catch (e) {
        console.error("Error reading Legacy CSV:", e.message);
        return;
    }

    const legData = parseCSV(legContent);
    const legHeader = legData[0];
    const legRows = legData.slice(1);

    const legIdx = {};
    legHeader.forEach((h, i) => legIdx[h] = i);

    console.log(`Loaded ${legRows.length} Legacy records.`);

    let overlapCount = 0;
    let lastOverlapIndex = -1;
    const unknownStores = new Set();

    const recordsToMigrate = [];

    legRows.forEach((row, index) => {
        const s_name = row[legIdx['store']];
        let s_id = STORE_MAP[s_name];

        if (!s_id) {
            if (s_name && s_name.length < 50) unknownStores.add(s_name); // Check length to avoid garbage capture
            s_id = 'UNKNOWN';
        }

        const c_type = row[legIdx['checklist_type']];
        const u_name = row[legIdx['user']];
        const start_time_full = row[legIdx['start_time']];

        let c_date = 'UNKNOWN';
        let time = 'UNKNOWN';

        if (start_time_full) {
            // 12/26/2025 20:51
            const parts = start_time_full.split(' ');
            if (parts.length >= 2) {
                const datePart = parts[0];
                const timePart = parts[1];

                const dParts = datePart.split('/');
                if (dParts.length === 3) {
                    // MM/DD/YYYY to YYYY-MM-DD
                    // 12/26/2025
                    c_date = `${dParts[2]}-${dParts[0].padStart(2, '0')}-${dParts[1].padStart(2, '0')}`;
                }
                time = normalizeTime(timePart);
            }
        }

        const key = `${s_id}|${c_type}|${c_date}|${u_name}|${time}`;

        if (sbKeys.has(key)) {
            overlapCount++;
            lastOverlapIndex = index;
        } else {
            recordsToMigrate.push({ index, key, s_name, date: c_date, time });
        }
    });

    console.log(`\nAnalysis Results:`);
    console.log(`Unknown Stores: ${Array.from(unknownStores).join(', ') || 'None'}`);
    console.log(`Overlapping Records: ${overlapCount}`);
    console.log(`Last Overlap Index: ${lastOverlapIndex}`);

    if (lastOverlapIndex >= 0 && lastOverlapIndex < legRows.length - 1) {
        console.log(`Records to Migrate (Count from last overlap): ${legRows.length - 1 - lastOverlapIndex}`);
        const firstNew = legRows[lastOverlapIndex + 1];
        console.log(`First New Record Date/Time: ${firstNew[legIdx['start_time']]}`);

        // Debug: Show a few keys around the overlap
        console.log(`\nLast Overlap Key: ${legRows[lastOverlapIndex][legIdx['store']]}|${legRows[lastOverlapIndex][legIdx['checklist_type']]}|...|${legRows[lastOverlapIndex][legIdx['start_time']]}`);
        console.log(`First New Key: ${firstNew[legIdx['store']]}|${firstNew[legIdx['checklist_type']]}|...|${firstNew[legIdx['start_time']]}`);

    } else if (lastOverlapIndex === -1 && overlapCount === 0) {
        console.log("No overlap found. Are dates aligned?");
        // Print sample keys to debug
        console.log("Sample Supabase Key:", Array.from(sbKeys)[0]);
        // Construct sample legacy key
        if (legRows.length > 0) {
            const row = legRows[0];
            const parts = row[legIdx['start_time']].split(' ');
            const dParts = parts[0].split('/');
            const c_date = `${dParts[2]}-${dParts[0].padStart(2, '0')}-${dParts[1].padStart(2, '0')}`;
            const time = normalizeTime(parts[1]);
            const s_id = STORE_MAP[row[legIdx['store']]];
            console.log(`Sample Legacy Key: ${s_id}|${row[legIdx['checklist_type']]}|${c_date}|${row[legIdx['user']]}|${time}`);
        }
    } else {
        console.log("Migration status: All or partial overlap logic unclear or complete.");
    }
}

main();
