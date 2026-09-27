import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const shifts = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'shifts.json'), 'utf-8'));
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'jobs.json'), 'utf-8'));

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

const dayShifts = shifts.filter((s: any) => (s.shift_date || s.date) === '2026-09-24');

console.log('=== TURNOS 24-SEP-2026 CON NOMBRES Y HORAS LA ===');
dayShifts.forEach((s: any) => {
  const name = empMap.get(s.employee_id) || empMap.get(s.employee_toast_guid) || s.employee_name || 'Desconocido';
  const role = s.job_name || jobMap.get(s.job_id) || 'Puesto';
  const startLA = s.start_time ? new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  const endLA = s.end_time ? new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  console.log(`• ${name.padEnd(25)} | ${String(role).padEnd(15)} | ${startLA} a ${endLA}`);
});
