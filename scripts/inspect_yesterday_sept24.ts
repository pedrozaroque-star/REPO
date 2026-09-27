import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function main() {
  const storeId = 14;
  const storeExtId = '80a1ec95-bc73-402e-8884-e5abbe9343e6';
  const targetDate = '2026-09-24';

  console.log(`=== 1. SHIFTS PROGRAMADOS PARA ${targetDate} ===`);
  const { data: shifts, error: shiftsErr } = await supabase
    .from('shifts')
    .select('*')
    .eq('store_id', storeExtId)
    .eq('shift_date', targetDate);

  if (shiftsErr) console.error('Shifts err:', shiftsErr);
  console.log(`Turnos programados: ${shifts?.length || 0}`);

  console.log('\n=== 2. PUNCHES REALES PARA ${targetDate} ===');
  const { data: punches, error: punchesErr } = await supabase
    .from('punches')
    .select('*')
    .eq('store_id', storeExtId)
    .eq('business_date', targetDate);

  if (punchesErr) console.error('Punches err:', punchesErr);
  console.log(`Ponchadas registradas: ${punches?.length || 0}`);

  // Also get toast_employees to resolve names
  const { data: employees } = await supabase
    .from('toast_employees')
    .select('id, toast_guid, v2_toast_guid, first_name, last_name');

  const empMap = new Map();
  employees?.forEach(e => {
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
    if (e.toast_guid) empMap.set(e.toast_guid, name);
    if (e.v2_toast_guid) empMap.set(e.v2_toast_guid, name);
    if (e.id) empMap.set(e.id, name);
  });

  const { data: jobs } = await supabase.from('toast_jobs').select('guid, title');
  const jobMap = new Map();
  jobs?.forEach(j => {
    if (j.guid) jobMap.set(j.guid, j.title);
  });

  console.log('\n--- DETALLE DE PONCHADAS EN 2026-09-24 ---');
  const punchedGuids = new Set();
  const punchSummary = punches?.map(p => {
    const name = empMap.get(p.employee_toast_guid) || p.employee_toast_guid;
    punchedGuids.add(p.employee_toast_guid);
    const inTime = p.clock_in ? new Date(p.clock_in).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
    const outTime = p.clock_out ? new Date(p.clock_out).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : 'Abierta / Sin salida';
    const reg = Number(p.regular_hours) || 0;
    const ot = Number(p.overtime_hours) || 0;
    return {
      Empleado: name,
      Puesto: jobMap.get(p.job_toast_guid) || p.job_toast_guid,
      Entrada: inTime,
      Salida: outTime,
      Regulares: reg.toFixed(1),
      OT: ot.toFixed(1),
      Total: (reg + ot).toFixed(1)
    };
  });
  console.table(punchSummary?.sort((a, b) => a.Empleado.localeCompare(b.Empleado)));

  console.log('\n--- COMPARATIVA SHIFT VS PUNCH (QUIÉN ESTABA PROGRAMADO Y NO FALTÓ / QUIÉN NO VINO) ---');
  const missingShifts: any[] = [];
  shifts?.forEach(s => {
    const name = empMap.get(s.employee_id) || s.employee_name || s.employee_id;
    if (!punchedGuids.has(s.employee_id)) {
      missingShifts.push({
        Empleado: name,
        Puesto_Programado: s.job_name || jobMap.get(s.job_id) || s.job_id,
        Horario_Programado: `${s.start_time || ''} - ${s.end_time || ''}`,
        Status: s.status,
        Nota: 'PROGRAMADO PERO NO ASISTIÓ'
      });
    }
  });
  console.log(`Ausencias (Programados sin ponchada): ${missingShifts.length}`);
  console.table(missingShifts);

  // Check if Joseph had a shift scheduled
  const josephShift = shifts?.filter(s => {
    const name = empMap.get(s.employee_id) || s.employee_name || '';
    return name.toLowerCase().includes('joseph');
  });
  console.log('\nTurno programado de Joseph Castellanos el 24-Sep:');
  console.log(josephShift);
}

main().catch(console.error);
