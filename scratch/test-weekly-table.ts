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
  const start = '2026-06-01';
  const end = '2026-06-07';

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
    .gte('assignment_date', start)
    .lte('assignment_date', end);
  // Fetch activities
  const { data: activities } = await supabaseAdmin.from('operating_procedures').select('*');

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

  const weekDays = [
    new Date('2026-06-01T12:00:00'),
    new Date('2026-06-02T12:00:00'),
    new Date('2026-06-03T12:00:00'),
    new Date('2026-06-04T12:00:00'),
    new Date('2026-06-05T12:00:00'),
    new Date('2026-06-06T12:00:00'),
    new Date('2026-06-07T12:00:00'),
  ];

  // Let's print out what activities are shown for each category
  const categories = ['APERTURA', 'CIERRE', 'ACTIVIDAD REGULAR', 'OTRO'];

  categories.forEach(cat => {
    const catActivities = activities.filter(act => {
      const shiftTypeMap: Record<string, string> = {
        'APERTURA': 'Apertura',
        'CIERRE': 'Cierre',
        'ACTIVIDAD REGULAR': 'Regular',
        'OTRO': 'Regular'
      };
      const expectedShiftType = shiftTypeMap[cat];
      if (act.shift_type !== expectedShiftType) return false;

      const matchesShift = act.shift === activeShift || act.shift === 'AMBOS' || !act.shift;
      if (!matchesShift) return false;

      const hasAnyAssignment = weekDays.some(day => {
        const dateStr = day.toISOString().split('T')[0];
        const shiftSuffix = `_${activeShift}`;
        
        return assignments.some(a => {
          if (a.assignment_date !== dateStr) return false;
          if (!a.sub_position?.endsWith(shiftSuffix)) return false;
          
          const resolvedActs = getResolvedActivities(a, day);
          return resolvedActs.some(ra => String(ra.activity_id) === String(act.id));
        });
      });

      return hasAnyAssignment;
    });

    if (catActivities.length === 0) return;

    console.log(`\n================ ${cat} ================`);
    catActivities.forEach(act => {
      const line: string[] = [];
      weekDays.forEach(day => {
        const dateStr = day.toISOString().split('T')[0];
        const shiftSuffix = `_${activeShift}`;
        const assignedPeople = assignments
          .filter(a => {
            const isDateMatch = a.assignment_date === dateStr;
            const isShiftMatch = a.sub_position.endsWith(shiftSuffix);
            if (!isDateMatch || !isShiftMatch) return false;
            
            const resolvedActs = getResolvedActivities(a, day);
            return resolvedActs.some(ra => String(ra.activity_id) === String(act.id));
          })
          .map(a => {
            const e = employees.find(emp => String(emp.id) === String(a.employee_id));
            return e ? (e.chosen_name || e.first_name).toUpperCase() : '?';
          });
        line.push(assignedPeople.length > 0 ? assignedPeople.join('/') : '-');
      });
      console.log(`${act.activity.substring(0, 40).padEnd(40)} | ${line.join(' | ')}`);
    });
  });
}

test();
