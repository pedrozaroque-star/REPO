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
  const day = new Date(dateStr + 'T12:00:00'); // Sunday Date

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
  // Fetch activities
  const { data: rawActivities } = await supabaseAdmin.from('operating_procedures').select('*');

  const hasDriveThru = false; // Slauson is not DT
  const activeShift = 'AM';

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

  // Now, let's run the exact matching block for the table cell
  const shiftSuffix = `_${activeShift}`;
  
  // Let's test a specific activity: "COBRO Y ATENCION AL CLIENTE" (id: 58a4b30f-8fa4-40dc-9c64-b3ef4bec4b1e)
  const targetActId = '58a4b30f-8fa4-40dc-9c64-b3ef4bec4b1e'; 
  const targetAct = rawActivities.find(act => String(act.id) === targetActId);

  if (!targetAct) {
    console.error("Target activity not found!");
    return;
  }

  console.log(`Testing table matching for activity: "${targetAct.activity}" on ${dateStr}`);

  const assignedPeople = assignments
    .filter(a => {
      const isDateMatch = a.assignment_date === dateStr;
      const isShiftMatch = a.sub_position.endsWith(shiftSuffix);
      
      console.log(`- Checking assignment: ${a.main_station} (${a.sub_position})`);
      console.log(`    * isDateMatch: ${isDateMatch} (DB: ${a.assignment_date} vs expected: ${dateStr})`);
      console.log(`    * isShiftMatch: ${isShiftMatch} (DB: ${a.sub_position} ends with ${shiftSuffix})`);

      if (!isDateMatch || !isShiftMatch) return false;
      
      const resolvedActs = getResolvedActivities(a, day);
      console.log(`    * Resolved activities count: ${resolvedActs.length}`);
      
      const hasAct = resolvedActs.some(ra => {
        const match = String(ra.activity_id) === String(targetAct.id);
        if (match) {
          console.log(`      -> MATCHED ACTIVITY: ${ra.activity_id}`);
        }
        return match;
      });

      return hasAct;
    })
    .map(a => {
      const e = employees.find(emp => String(emp.id) === String(a.employee_id));
      return e ? (e.chosen_name || e.first_name).toUpperCase() : null;
    })
    .filter(Boolean);

  console.log(`\nFinal assigned people:`, assignedPeople);
}

test();
