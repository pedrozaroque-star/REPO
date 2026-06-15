import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function run() {
  console.log("🚀 Starting migration of manually assigned tasks from station_assignments to global catalogs...");

  // 1. Fetch all assignments
  const { data: assignments, error: assignErr } = await supabase
    .from('station_assignments')
    .select('main_station, sub_position, tasks, assignment_date, store_id');

  if (assignErr || !assignments) {
    console.error("❌ Failed to fetch assignments:", assignErr);
    return;
  }
  console.log(`📋 Loaded ${assignments.length} assignments from database.`);

  // 2. Fetch all operating procedures
  const { data: procedures, error: procErr } = await supabase
    .from('operating_procedures')
    .select('id, activity');

  if (procErr || !procedures) {
    console.error("❌ Failed to fetch operating procedures:", procErr);
    return;
  }
  console.log(`📋 Loaded ${procedures.length} global procedures.`);

  // Map of normalized activity text -> procedure id
  const procMap = new Map<string, string>();
  procedures.forEach((p: any) => {
    procMap.set(normalizeText(p.activity), String(p.id));
  });

  // 3. Fetch all current position activities mappings
  const { data: mappings, error: mapErr } = await supabase
    .from('position_activities')
    .select('*');

  if (mapErr || !mappings) {
    console.error("❌ Failed to fetch position_activities:", mapErr);
    return;
  }
  console.log(`📋 Loaded ${mappings.length} position activities.`);

  const existingMappingsSet = new Set<string>();
  mappings.forEach((m: any) => {
    const key = `${m.position_key}|${m.shift}|${m.activity_id}|${m.frequency}|${m.store_model}`;
    existingMappingsSet.add(key);
  });

  // Track mappings to insert
  const newMappingsToInsert: { position_key: string; shift: string; activity_id: string; frequency: string; store_model: string }[] = [];

  // 4. Process each assignment
  for (const a of assignments) {
    if (!a.tasks || !Array.isArray(a.tasks) || a.tasks.length === 0) continue;

    const station = a.main_station || a.sub_position?.replace(/_([AP]M)$/, '') || '';
    if (!station) continue;

    const suffixMatch = a.sub_position?.match(/_([AP]M)$/);
    const shift = suffixMatch ? suffixMatch[1] : 'AMBOS';

    const sLower = station.toLowerCase();
    const isDriveThru = sLower.includes('(dt)') || sLower.includes('ventana');
    const storeModel = isDriveThru ? 'DRIVE_THRU' : 'AMBOS';

    const frequency = 'Diario';

    for (const taskText of a.tasks) {
      if (!taskText || !taskText.trim()) continue;

      const normText = normalizeText(taskText);
      let procId = procMap.get(normText);

      // If it doesn't exist in operating_procedures, we must insert it
      if (!procId) {
        console.log(`➕ New procedure found: "${taskText}"`);
        const { data: newProc, error: insErr } = await supabase
          .from('operating_procedures')
          .insert([{
            activity: taskText.trim(),
            shift_type: 'Regular',
            frequency: 'Diario',
            shift: shift
          }])
          .select('id')
          .single();

        if (insErr || !newProc) {
          console.error(`❌ Failed to insert procedure "${taskText}":`, insErr);
          continue;
        }

        procId = String((newProc as any).id);
        procMap.set(normText, procId);
        console.log(`   Inserted with ID: ${procId}`);
      }

      // Check if mapping already exists in position_activities
      const mappingKey = `${station}|${shift}|${procId}|${frequency}|${storeModel}`;
      if (!existingMappingsSet.has(mappingKey)) {
        existingMappingsSet.add(mappingKey);
        newMappingsToInsert.push({
          position_key: station,
          shift: shift,
          activity_id: procId,
          frequency: frequency,
          store_model: storeModel
        });
      }
    }
  }

  console.log(`\nMigration Summary:`);
  console.log(`- Mappings to insert: ${newMappingsToInsert.length}`);

  // 5. Bulk insert mappings into position_activities
  if (newMappingsToInsert.length > 0) {
    const CHUNK_SIZE = 50;
    let inserted = 0;
    for (let i = 0; i < newMappingsToInsert.length; i += CHUNK_SIZE) {
      const chunk = newMappingsToInsert.slice(i, i + CHUNK_SIZE);
      const { error: insErr } = await supabase
        .from('position_activities')
        .insert(chunk);

      if (insErr) {
        console.error(`❌ Failed to insert mapping chunk at ${i}:`, insErr);
      } else {
        inserted += chunk.length;
        console.log(`   Inserted ${inserted}/${newMappingsToInsert.length} mappings...`);
      }
    }
  }

  console.log("🎉 Migration finished successfully!");
}

run().catch(console.error);
