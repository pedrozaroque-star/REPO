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

    const { data: positionActivities } = await supabase
      .from('position_activities')
      .select(`
        *,
        operating_procedures (
          id,
          activity,
          shift_type,
          start_time,
          duration_minutes
        )
      `);

    const { data: procedures } = await supabase
      .from('operating_procedures')
      .select('*');

    const activities = (procedures || []).map((p: any) => ({
      id: String(p.id),
      name: p.activity,
      category: p.shift_type === 'Apertura' ? 'APERTURA' : p.shift_type === 'Cierre' ? 'CIERRE' : 'ACTIVIDAD REGULAR',
      startTime: p.start_time ? p.start_time.substring(0, 5) : '',
      shift: p.shift || 'AMBOS',
      overrides: p.overrides || {},
    }));

    console.log(`Loaded ${assignments?.length} assignments, ${positionActivities?.length} position activities, and ${activities.length} activities.`);

    const getResolvedActivities = (assignee: any) => {
        if (!assignee) return [];
        
        const isShiftPM = assignee.sub_position?.includes('_PM');
        const shift = isShiftPM ? 'PM' : 'AM';
        const storeModel = 'REGULAR'; // Slauson has no DT

        const resolved: any[] = [];

        // 1. Resolve matching station activities
        const stationActs = (positionActivities || []).filter((pa: any) => {
          if (pa.position_key !== assignee.main_station) return false;
          if (pa.shift !== 'AMBOS' && pa.shift !== shift) return false;
          if (pa.store_model !== 'AMBOS' && pa.store_model !== storeModel) return false;
          return true;
        });

        stationActs.forEach((pa: any) => {
          if (pa.operating_procedures) {
            resolved.push({
              id: pa.operating_procedures.id,
              activity_id: pa.operating_procedures.id,
              name: pa.operating_procedures.activity,
              shift_type: pa.operating_procedures.shift_type,
              start_time: pa.operating_procedures.start_time,
              duration_minutes: pa.operating_procedures.duration_minutes,
              isCustom: false
            });
          }
        });

        // 2. Resolve custom/assigned tasks
        const customTasks = Array.isArray(assignee.tasks) ? assignee.tasks : [];
        customTasks.forEach((taskText: string, idx: number) => {
          const normText = normalizeText(taskText);
          const matchedAct = activities.find(act => normalizeText(act.name) === normText);

          if (matchedAct) {
            // Check if not already in resolved to avoid duplicates
            if (!resolved.some(r => r.id === matchedAct.id)) {
              resolved.push({
                id: matchedAct.id,
                activity_id: matchedAct.id,
                name: matchedAct.name,
                shift_type: matchedAct.category === 'APERTURA' ? 'Apertura' : matchedAct.category === 'CIERRE' ? 'Cierre' : 'Regular',
                isCustom: false
              });
            }
          } else {
            resolved.push({
              id: `custom-${idx}-${taskText}`,
              activity_id: `custom-${idx}`,
              name: taskText,
              shift_type: 'Especial',
              isCustom: true
            });
          }
        });

        return resolved;
    };

    assignments?.forEach((a: any) => {
        const resolved = getResolvedActivities(a);
        console.log(`\nStation: ${a.sub_position}`);
        console.log(`Tasks: ${JSON.stringify(a.tasks)}`);
        console.log(`Resolved: ${resolved.length} activities`);
        resolved.forEach((r: any) => {
            console.log(`  - [${r.isCustom ? 'CUSTOM' : 'CATALOG'}] ${r.name} (${r.id})`);
        });
    });
}
run();
