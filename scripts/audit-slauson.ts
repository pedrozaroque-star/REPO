import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function run() {
    const storeId = '7'; // Slauson
    const startDate = '2026-04-27';
    const endDate = '2026-05-03';

    // 1. Fetch activities & templates from station_templates
    const { data: globalData } = await supabase.from('station_templates').select('data').eq('store_id', 'GLOBAL').eq('template_name', '__CONFIG_ACTIVITIES__').maybeSingle();
    const { data: localData } = await supabase.from('station_templates').select('data').eq('store_id', storeId).eq('template_name', '__CONFIG_ACTIVITIES__').maybeSingle();
    
    const globalActs = globalData?.data?.master_activities || [];
    const localActs = localData?.data?.master_activities || [];
    const activities = [...globalActs, ...localActs].filter((a, i, arr) => arr.findIndex(x => x.name === a.name) === i);
    
    // station_mappings are only local usually
    const stationActivities = localData?.data?.station_mappings || {};

    // 3. Fetch assignments
    const { data: assignments } = await supabase.from('station_assignments')
        .select('*')
        .eq('store_id', storeId)
        .gte('assignment_date', startDate)
        .lte('assignment_date', endDate);

    const usageMap: Record<string, { assignedTo: string[], isUnassigned: boolean }> = {};
    
    activities.forEach(act => {
        usageMap[act.name] = { assignedTo: [], isUnassigned: true };
    });

    Object.entries(stationActivities).forEach(([key, tasks]) => {
        if (Array.isArray(tasks)) {
            tasks.forEach((taskName: string) => {
                if (usageMap[taskName]) {
                    usageMap[taskName].assignedTo.push(`Plantilla: ${key}`);
                    usageMap[taskName].isUnassigned = false;
                }
            });
        }
    });

    (assignments || []).forEach(assignment => {
        if (assignment.tasks && Array.isArray(assignment.tasks)) {
            assignment.tasks.forEach((taskName: string) => {
                if (usageMap[taskName]) {
                    usageMap[taskName].assignedTo.push(`Empleado ID: ${assignment.employee_id} el ${assignment.assignment_date}`);
                    usageMap[taskName].isUnassigned = false;
                }
            });
        }
    });

    const unassignedAM = activities.filter(a => usageMap[a.name]?.isUnassigned && (a.shift === 'AM' || a.shift === 'AMBOS' || !a.shift));
    const unassignedPM = activities.filter(a => usageMap[a.name]?.isUnassigned && (a.shift === 'PM' || a.shift === 'AMBOS' || !a.shift));

    console.log(`\n=== AUDITORÍA SLAUSON (${startDate} a ${endDate}) ===\n`);
    console.log(`Total Actividades en la Librería: ${activities.length}`);
    
    console.log(`\n-- TAREAS SIN ASIGNAR TURNO AM (${unassignedAM.length}) --`);
    unassignedAM.forEach(a => console.log(`[${a.category}] ${a.name}`));

    console.log(`\n-- TAREAS SIN ASIGNAR TURNO PM (${unassignedPM.length}) --`);
    unassignedPM.forEach(a => console.log(`[${a.category}] ${a.name}`));
}

run();
