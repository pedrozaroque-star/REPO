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
  const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';
  
  console.log('Fetching all station_assignments tasks...');
  const { data: assignments } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('store_id', slausonStoreId);

  const { data: positionActivities } = await supabase
    .from('position_activities')
    .select(`
      *,
      operating_procedures (
        activity
      )
    `);

  console.log(`Loaded ${assignments?.length} assignments and ${positionActivities?.length} global mappings.`);

  let totalTasks = 0;
  let missingTasks = 0;

  (assignments || []).forEach((a: any) => {
    if (!a.tasks || !Array.isArray(a.tasks)) return;

    const shiftSuffix = a.sub_position?.includes('_PM') ? 'PM' : 'AM';
    const station = a.main_station || a.sub_position?.replace(/_([AP]M)$/, '');

    a.tasks.forEach((taskText: string) => {
      totalTasks++;
      const normText = normalizeText(taskText);

      // Check if this task exists in position_activities for this station & shift
      const exists = (positionActivities || []).some((pa: any) => {
        const matchStation = pa.position_key === station;
        const matchShift = pa.shift === 'AMBOS' || pa.shift === shiftSuffix;
        const normProc = normalizeText(pa.operating_procedures?.activity);
        return matchStation && matchShift && (normProc === normText || normText.includes(normProc) || normProc.includes(normText));
      });

      if (!exists) {
        console.log(`❌ Task: "${taskText}" is NOT in position_activities for Station: ${station} (Shift: ${shiftSuffix})`);
        missingTasks++;
      }
    });
  });

  console.log(`\nSummary:`);
  console.log(`- Total tasks in Slauson assignments: ${totalTasks}`);
  console.log(`- Missing from position_activities: ${missingTasks}`);
}

test();
