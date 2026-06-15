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
    const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';
    const targetDate = '2026-06-07';

    console.log(`Fetching Slauson assignments for ${targetDate}...`);
    const { data: assignments } = await supabase
      .from('station_assignments')
      .select('*')
      .eq('store_id', slausonStoreId)
      .eq('assignment_date', targetDate);

    const { data: procedures } = await supabase
      .from('operating_procedures')
      .select('*');

    const activities = (procedures || []).map((p: any) => ({
      ...p,
      // For compatibility, let's keep the raw fields, but also add the mapped name/startTime if needed
      // activities in page.tsx are raw rows: id, activity, start_time, duration_minutes, shift_type
    }));

    console.log(`Loaded ${assignments?.length} assignments and ${activities.length} procedures.`);

    const getResolvedActivities = (assignee: any) => {
        if (!assignee) return [];
        
        // --- PRIORITY RULE: If assignee has manually defined tasks, use ONLY those tasks ---
        if (assignee.tasks && Array.isArray(assignee.tasks) && assignee.tasks.length > 0) {
          const resolved: any[] = [];
          assignee.tasks.forEach((taskText: string, idx: number) => {
            if (!taskText || !taskText.trim()) return;
            const normText = normalizeText(taskText);
            // Look up in master activities catalog (activities state)
            const matchedAct = activities.find(act => normalizeText(act.activity) === normText);

            if (matchedAct) {
              resolved.push({
                id: matchedAct.id,
                activity_id: matchedAct.id,
                position_key: assignee.main_station,
                operating_procedures: {
                  id: matchedAct.id,
                  activity: matchedAct.activity,
                  shift_type: matchedAct.shift_type || 'Regular',
                  frequency: 'Diario',
                  start_time: matchedAct.start_time || null,
                  duration_minutes: matchedAct.duration_minutes || null
                },
                sort_order: matchedAct.start_time 
                  ? parseInt(matchedAct.start_time.split(':')[0]) * 60 + parseInt(matchedAct.start_time.split(':')[1]) 
                  : 9999,
                isCustom: false
              });
            } else {
              resolved.push({
                id: `custom-${idx}-${taskText}`,
                activity_id: `custom-${idx}`,
                position_key: assignee.main_station,
                operating_procedures: {
                  id: `custom-proc-${idx}`,
                  activity: taskText,
                  shift_type: 'Especial',
                  frequency: 'Diario'
                },
                isCustom: true,
                sort_order: 9999
              });
            }
          });
          return resolved.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        }

        return []; // In our test we are focusing on priority rule
    };

    assignments?.forEach((a: any) => {
        if (!a.tasks || a.tasks.length === 0) return;
        const resolved = getResolvedActivities(a);
        console.log(`\nStation: ${a.sub_position}`);
        console.log(`Tasks: ${JSON.stringify(a.tasks)}`);
        console.log(`Resolved: ${resolved.length} activities (Expected only tasks)`);
        resolved.forEach((r: any) => {
            console.log(`  - [${r.isCustom ? 'CUSTOM' : 'CATALOG'}] ${r.operating_procedures.activity} (ID: ${r.id})`);
        });
    });
}
run();
