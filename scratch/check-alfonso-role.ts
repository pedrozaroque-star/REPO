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
  // Fetch Alfonso (employee_id: bd655ff9-36a0-4ebf-89f8-64298fd42579)
  const { data: alfonso } = await supabaseAdmin
    .from('toast_employees')
    .select('*')
    .eq('id', 'bd655ff9-36a0-4ebf-89f8-64298fd42579')
    .single();

  const { data: jobs } = await supabaseAdmin.from('toast_jobs').select('*');

  if (alfonso) {
    const ref = alfonso.job_references?.[0];
    const match = jobs?.find(j => j.guid === ref?.guid || j.id === ref?.guid);
    console.log("Alfonso raw job reference:", ref);
    console.log("Alfonso job details:", match);
    console.log("Alfonso job title:", match?.title);
    
    const roleKey = resolvePositionKey(alfonso, 'CUBRIR DESCANSOS (COCINA)', 'kitchen', jobs || []);
    console.log("Alfonso resolved role key:", roleKey);
  } else {
    console.error("Alfonso not found in database!");
  }
}

test();
