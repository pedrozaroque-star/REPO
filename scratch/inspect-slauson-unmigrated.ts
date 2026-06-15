import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function test() {
  console.log('Fetching Slauson template...');
  const { data: slausonTemplate, error: tempErr } = await supabase
    .from('station_templates')
    .select('*')
    .eq('id', '1a1bcf35-a3da-4b12-855a-365bea871dd4')
    .single();

  if (tempErr || !slausonTemplate) {
    console.error('Error fetching template:', tempErr);
    return;
  }

  const { data: procedures } = await supabase.from('operating_procedures').select('*');
  const { data: currentMappings } = await supabase.from('position_activities').select('*');

  const mappings = slausonTemplate.data?.station_mappings || {};
  console.log(`\nSlauson Mappings count: ${Object.keys(mappings).length}`);

  let missingCount = 0;
  let totalTasks = 0;

  for (const [rawKey, activitiesList] of Object.entries(mappings)) {
    if (!Array.isArray(activitiesList)) continue;
    
    // Parse key
    const suffixMatch = rawKey.match(/_([AP]M)(?:_(\d))?$/);
    const shift = suffixMatch ? suffixMatch[1] : 'AMBOS';
    const station = suffixMatch ? rawKey.replace(/_([AP]M)(?:_\d)?$/, '') : rawKey;
    const dayIndex = suffixMatch ? suffixMatch[2] : 'Diario';

    console.log(`\n=== Station: ${station} (Shift: ${shift}, Freq: ${dayIndex}) ===`);

    for (const actText of activitiesList) {
      if (!actText) continue;
      totalTasks++;

      // Check if it exists in position_activities
      const normText = normalizeText(actText);
      
      // Look for a matched activity in procedures
      const matchedProc = (procedures || []).find(p => {
        const normProc = normalizeText(p.activity);
        return normProc === normText || normText.includes(normProc) || normProc.includes(normText);
      });

      if (!matchedProc) {
        console.log(`  ❌ MISSING FROM CATALOG (not in operating_procedures): "${actText}"`);
        missingCount++;
      } else {
        // Check if actually inserted in position_activities
        const exists = (currentMappings || []).some(m => 
          m.position_key === station && 
          m.shift === shift && 
          m.activity_id === matchedProc.id && 
          m.frequency === (suffixMatch ? suffixMatch[2] || 'Diario' : 'Diario')
        );
        if (!exists) {
          console.log(`  ⚠️ MATCHED BUT NOT INSERTED: "${actText}"`);
          missingCount++;
        }
      }
    }
  }

  console.log(`\nSummary:`);
  console.log(`- Total mapped tasks in Slauson Template: ${totalTasks}`);
  console.log(`- Missing tasks (unmigrated): ${missingCount}`);
}

test();
