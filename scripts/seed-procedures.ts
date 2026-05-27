import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

// Load Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Seeding operating procedures...');

  // 1. We will use supabase.rpc to execute raw SQL or we can just fetch first to see if it works.
  // Actually, wait, creating tables requires postgres execution or a direct sql string.
  // Since we don't have direct SQL execution without RPC setup, let's just use the Supabase JS client to insert data.
  // But wait, the table doesn't exist yet! We have to create it.
  
  // Since I have `mcp_supabase-mcp-server_execute_sql` available, I can just execute the CREATE TABLE via MCP!
  console.log('Table should be created via MCP or another tool before running this script.');
  console.log('Reading CSV...');

  const csvPath = path.join(__dirname, 'procedures.csv');
  const csvData = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvData.split('\\n');
  const headers = lines[0].split(',');

  const rowsToInsert = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted strings correctly
    const row = [];
    let inQuotes = false;
    let currentField = '';
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            row.push(currentField);
            currentField = '';
        } else {
            currentField += char;
        }
    }
    row.push(currentField);

    if (row.length < 5) continue;

    const no = row[0];
    const horario = row[1];
    const tiempo = row[2];
    const actividad = row[3];
    let tipo = row[4];
    let dia = row[5];
    const dt = row[6];
    const responsable = row[7];
    const descripcion = row[8] || null;

    if (!dia) dia = 'Diario';
    if (tipo === 'Zierre') tipo = 'Cierre';

    // Parse time
    let timeStr = null;
    if (horario) {
        const t = horario.trim();
        const match = t.match(/(\\d+):(\\d+)\\s*(AM|PM)/i);
        if (match) {
            let h = parseInt(match[1]);
            const m = match[2];
            const ampm = match[3].toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            timeStr = \`\${String(h).padStart(2, '0')}:\${m}:00\`;
        }
    }

    // Parse duration
    let durationMins = null;
    if (tiempo) {
        const minMatch = tiempo.match(/([\\d.]+)/);
        if (minMatch) {
            durationMins = parseFloat(minMatch[1]);
        }
    }

    rowsToInsert.push({
        start_time: timeStr,
        duration_minutes: durationMins,
        activity: actividad.trim(),
        shift_type: tipo.trim(),
        frequency: dia.trim(),
        role: responsable ? responsable.trim() : null,
        description: descripcion ? descripcion.trim() : null
    });
  }

  console.log(\`Parsed \${rowsToInsert.length} procedures.\`);

  // Wipe existing to be safe
  await supabase.from('operating_procedures').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const { data, error } = await supabase.from('operating_procedures').insert(rowsToInsert);
  
  if (error) {
    console.error('Error inserting data:', error);
  } else {
    console.log('Successfully inserted data.');
  }
}

main().catch(console.error);
