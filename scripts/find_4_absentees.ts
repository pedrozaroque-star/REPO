import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const shifts = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'shifts.json'), 'utf-8'));
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));
const punches = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'punches.json'), 'utf-8'));
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

const dayPunches = punches.filter((p: any) => p.business_date === '2026-09-24');
const punchedGuids = new Set(dayPunches.map((p: any) => p.employee_toast_guid));

const dayShifts = shifts.filter((s: any) => (s.shift_date || s.date) === '2026-09-24');

console.log('=== QUIÉNES TENÍAN TURNO PROGRAMADO EL 24-SEP Y NO ASISTIERON (CERO PONCHADAS) ===');
const absentees = dayShifts.filter((s: any) => {
  const empGuid = s.employee_id || s.employee_toast_guid;
  return !punchedGuids.has(empGuid);
}).map((s: any) => {
  const empGuid = s.employee_id || s.employee_toast_guid;
  const name = empMap.get(empGuid) || s.employee_name || empGuid;
  const role = s.job_name || jobMap.get(s.job_id) || 'N/A';
  const startLA = s.start_time ? new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  const endLA = s.end_time ? new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '';
  return {
    Empleado: name,
    Puesto: role,
    Horario_LA: `${startLA} a ${endLA}`,
    Status: s.status
  };
});

console.table(absentees);
