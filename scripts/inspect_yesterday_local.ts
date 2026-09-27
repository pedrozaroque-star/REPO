import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'jobs.json'), 'utf-8'));
const punches = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'punches.json'), 'utf-8'));
const shifts = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'shifts.json'), 'utf-8'));

const targetDate = '2026-09-24';

const empMap = new Map();
employees.forEach((e: any) => {
  const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  if (e.toast_guid) empMap.set(e.toast_guid, name);
  if (e.v2_toast_guid) empMap.set(e.v2_toast_guid, name);
  if (e.id) empMap.set(e.id, name);
});

const jobMap = new Map();
jobs.forEach((j: any) => {
  if (j.guid) jobMap.set(j.guid, j.title || j.name);
  if (j.id) jobMap.set(j.id, j.title || j.name);
});

console.log(`=== 1. PUNCHES REALES DEL 24 DE SEPTIEMBRE DE 2026 ===`);
const dayPunches = punches.filter((p: any) => p.business_date === targetDate);
const punchedGuids = new Set();

const punchTable = dayPunches.map((p: any) => {
  const name = empMap.get(p.employee_toast_guid) || p.employee_toast_guid;
  punchedGuids.add(p.employee_toast_guid);
  const inTime = p.clock_in ? new Date(p.clock_in).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  const outTime = p.clock_out ? new Date(p.clock_out).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  const reg = Number(p.regular_hours) || 0;
  const ot = Number(p.overtime_hours) || 0;
  return {
    Empleado: name,
    Puesto: jobMap.get(p.job_toast_guid) || 'Desconocido',
    Entrada: inTime,
    Salida: outTime,
    Reg: reg.toFixed(1),
    OT: ot.toFixed(1),
    Total: (reg + ot).toFixed(1)
  };
}).sort((a: any, b: any) => a.Empleado.localeCompare(b.Empleado));

console.table(punchTable);

console.log(`\n=== 2. SHIFTS PROGRAMADOS PARA EL 24 DE SEPTIEMBRE DE 2026 ===`);
const dayShifts = shifts.filter((s: any) => (s.shift_date || s.date) === targetDate);

const shiftTable = dayShifts.map((s: any) => {
  const empGuid = s.employee_id || s.employee_toast_guid;
  const name = empMap.get(empGuid) || s.employee_name || empGuid;
  const didPunch = punchedGuids.has(empGuid);
  return {
    Empleado: name,
    Puesto_Programado: s.job_name || jobMap.get(s.job_toast_guid || s.job_id) || 'N/A',
    Horario: `${s.start_time || ''} - ${s.end_time || ''}`,
    Status: s.status,
    Asistio: didPunch ? 'SÍ ASISTIÓ' : '❌ NO ASISTIÓ (FALTA)'
  };
}).sort((a: any, b: any) => a.Empleado.localeCompare(b.Empleado));

console.table(shiftTable);

console.log('\n=== 3. ANÁLISIS DE LAS AUSENCIAS Y COBERTURAS DEL 24-SEP ===');
const missing = shiftTable.filter((s: any) => s.Asistio.includes('NO ASISTIÓ'));
console.log('Personas programadas que NO asistieron ayer:');
console.table(missing);

const unassignedPunch = punchTable.filter((p: any) => {
  // Check if this employee was in dayShifts
  return !dayShifts.some((s: any) => {
    const empGuid = s.employee_id || s.employee_toast_guid;
    const name = empMap.get(empGuid) || s.employee_name || '';
    return name.toLowerCase() === p.Empleado.toLowerCase();
  });
});

console.log('\nPersonas que trabajaron pero NO estaban originalmente programadas (COBERTURAS DE EMERGENCIA):');
console.table(unassignedPunch);
