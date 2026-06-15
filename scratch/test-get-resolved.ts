import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

// Helper to translate employee job + station group to standard roles
const resolvePositionKey = (employee: any, stationName: string, stationGroup: string, jobs: any[]): string => {
  if (!employee) {
    const s = (stationName || '').toLowerCase();
    if (['tacos', 'carnes', 'burritos', 'preparacion', 'preparador', 'tortas/mulitas', 'tortas/quesadillas', 'tortillas', 'tacos/burritos (dt)', 'tortas/quesadillas (dt)'].some(k => s.includes(k))) {
      return 'COOK_MALE';
    }
    return 'CASHIER';
  }

  const getTitleSafe = (e: any) => {
    const ref = e.job_references?.[0];
    if (!ref) return '';
    const match = (jobs || []).find((j: any) => j.guid === ref.guid || j.id === ref.guid);
    return match?.title || '';
  };

  const title = getTitleSafe(employee).toLowerCase();
  
  if (title.includes('manager') && !title.includes('asst') && !title.includes('assist') && !title.includes('asistente') && !title.includes('shift')) {
    return 'MANAGER';
  }
  
  if (title.includes('asst') || title.includes('assist') || title.includes('asistente')) {
    return 'ASSISTANT';
  }
  
  if (title.includes('shift') || title.includes('leader') || title.includes('encargado')) {
    const group = (stationGroup || '').toLowerCase();
    const station = (stationName || '').toLowerCase();
    const isKitchen = group === 'kitchen' || ['burritos', 'tortillas', 'tacos', 'carnes', 'preparacion', 'cubrir descansos (cocina)'].some(s => station.includes(s));
    return isKitchen ? 'SHIFT_LEADER_MALE' : 'SHIFT_LEADER_FEMALE';
  }
  
  if (title.includes('cook') || title.includes('cocinero') || title.includes('prep') || title.includes('preparador') || title.includes('taquero') || title.includes('tortill')) {
    return 'COOK_MALE';
  }
  
  return 'CASHIER';
};

async function test() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'; // Slauson
  const dateStr = '2026-06-07'; // Sunday
  const date = new Date(dateStr + 'T12:00:00'); // Sunday Date

  // Fetch employees
  const { data: employees } = await supabaseAdmin.from('toast_employees').select('*');
  // Fetch jobs
  const { data: jobs } = await supabaseAdmin.from('toast_jobs').select('*');
  // Fetch position activities
  const { data: positionActivities } = await supabaseAdmin.from('position_activities').select('*');
  // Fetch assignments
  const { data: assignments } = await supabaseAdmin
    .from('station_assignments')
    .select('*')
    .eq('store_id', storeId)
    .eq('assignment_date', dateStr);

  const hasDriveThru = false; // Slauson is not DT
  const activeShift = 'AM';

  console.log(`Loaded ${assignments.length} assignments for Sunday`);

  const getResolvedActivities = (assignee: any, date: Date) => {
    if (!assignee) return [];
    
    const isShiftPM = assignee.sub_position?.includes('_PM');
    const shift = isShiftPM ? 'PM' : 'AM';
    const storeModel = hasDriveThru ? 'DRIVE_THRU' : 'REGULAR';
    
    const jsDay = date.getDay();
    const myDayIndex = jsDay === 0 ? '6' : String(jsDay - 1);

    // 1. Resolve employee job role if assigned
    const emp = assignee.employee_id ? employees.find(e => String(e.id) === String(assignee.employee_id)) : null;
    const roleKey = emp ? resolvePositionKey(emp, assignee.main_station, assignee.station_group, jobs) : null;
    
    const isLeadership = roleKey && ['MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE'].includes(roleKey);

    const resolved: any[] = [];

    const stationActs = positionActivities.filter((pa: any) => {
      const isKeyMatch = (pa.position_key === assignee.main_station) || (isLeadership && pa.position_key === roleKey);
      if (!isKeyMatch) return false;
      
      if (pa.shift !== 'AMBOS' && pa.shift !== shift) return false;
      if (pa.store_model !== 'AMBOS' && pa.store_model !== storeModel) return false;
      if (pa.frequency !== 'Diario' && pa.frequency !== myDayIndex) return false;
      return true;
    });
    resolved.push(...stationActs);

    return resolved;
  };

  // Resolve activities for each AM assignment
  const amAssignments = assignments.filter(a => a.sub_position.endsWith('_AM'));
  console.log(`\nAM Assignments processing:`);
  amAssignments.forEach(a => {
    const emp = employees.find(e => String(e.id) === String(a.employee_id));
    const empName = emp ? `${emp.chosen_name || emp.first_name}` : 'Vacante';
    const resolved = getResolvedActivities(a, date);
    console.log(`- Station: ${a.main_station}, Employee: ${empName}, Resolved count: ${resolved.length}`);
    resolved.forEach((ra: any) => {
      console.log(`    * [Freq: ${ra.frequency}] Activity ID: ${ra.activity_id}`);
    });
  });
}

test();
