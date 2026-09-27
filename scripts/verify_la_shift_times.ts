import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const shifts = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'shifts.json'), 'utf-8'));
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));

const empMap = new Map();
employees.forEach((e: any) => {
  const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  if (e.toast_guid) empMap.set(e.toast_guid, name);
  if (e.v2_toast_guid) empMap.set(e.v2_toast_guid, name);
});

const dayShifts = shifts.filter((s: any) => (s.shift_date || s.date) === '2026-09-24');

console.log('=== TURNOS PROGRAMADOS 24-SEP-2026 EN HORA DE LOS ÁNGELES (PDT) ===');
for (const s of dayShifts) {
  const name = empMap.get(s.employee_id || s.employee_toast_guid) || s.employee_name || 'Desconocido';
  const startLA = s.start_time ? new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  const endLA = s.end_time ? new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  console.log(`• ${name.padEnd(25)} | ${String(s.job_name || 'Turno').padEnd(15)} | Horario LA: ${startLA} a ${endLA}`);
}
