import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const shifts = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'shifts.json'), 'utf-8'));
const punches = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'punches.json'), 'utf-8'));
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));

const dayPunches = punches.filter((p: any) => p.business_date === '2026-09-24');
const dayShifts = shifts.filter((s: any) => (s.shift_date || s.date) === '2026-09-24');

// Map all employee variants
// Each employee has id, toast_guid, v2_toast_guid
const guidToCanonical = new Map();
employees.forEach((e: any) => {
  const canon = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  if (e.id) guidToCanonical.set(e.id, canon);
  if (e.toast_guid) guidToCanonical.set(e.toast_guid, canon);
  if (e.v2_toast_guid) guidToCanonical.set(e.v2_toast_guid, canon);
});

const punchedNames = new Set(dayPunches.map((p: any) => guidToCanonical.get(p.employee_toast_guid) || p.employee_toast_guid));
const scheduledNames = new Set(dayShifts.map((s: any) => guidToCanonical.get(s.employee_id) || s.employee_name || s.employee_id));

console.log('Punched count:', punchedNames.size);
console.log('Scheduled count:', scheduledNames.size);

const absentNames = Array.from(scheduledNames).filter(n => !punchedNames.has(n));
console.log('\n=== EMPLEADOS PROGRAMADOS QUE NO ASISTIERON (AUSENTES) ===');
console.log(absentNames);

// Let's get shift details for these absentees
const absentDetails = dayShifts.filter((s: any) => {
  const n = guidToCanonical.get(s.employee_id) || s.employee_name;
  return absentNames.includes(n);
}).map((s: any) => ({
  Empleado: guidToCanonical.get(s.employee_id) || s.employee_name,
  Puesto: s.job_name,
  Horario_LA: `${new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })} a ${new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })}`,
  Status: s.status
}));

console.table(absentDetails);
