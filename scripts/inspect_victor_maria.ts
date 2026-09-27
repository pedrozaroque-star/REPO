import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'jobs.json'), 'utf-8'));
const punches = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'punches.json'), 'utf-8'));

const empMap = new Map();
employees.forEach((e: any) => {
  const n = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  if (e.toast_guid) empMap.set(e.toast_guid, n);
  if (e.v2_toast_guid) empMap.set(e.v2_toast_guid, n);
  if (e.id) empMap.set(e.id, n);
});

const jobMap = new Map();
jobs.forEach((j: any) => {
  if (j.guid) jobMap.set(j.guid, j.title || j.name);
  if (j.id) jobMap.set(j.id, j.title || j.name);
});

console.log('=== VICTOR MUÑOZ PROGRESSION (2025-2026) ===');
const victorPunches = punches.filter((p: any) => {
  const name = empMap.get(p.employee_toast_guid) || '';
  return name.toLowerCase().includes('victor') && name.toLowerCase().includes('muñoz');
});

const vByMonth: Record<string, { month: string, role: string, wage: number, hours: number, shifts: number }> = {};
victorPunches.forEach((p: any) => {
  const m = (p.business_date || '').substring(0, 7);
  if (!m || m < '2025-01') return;
  const role = jobMap.get(p.job_toast_guid) || 'Desconocido';
  const wage = Number(p.hourly_wage) || 0;
  const k = `${m}_${role}_${wage}`;
  if (!vByMonth[k]) vByMonth[k] = { month: m, role, wage, hours: 0, shifts: 0 };
  vByMonth[k].hours += (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0);
  vByMonth[k].shifts++;
});
console.table(Object.values(vByMonth).sort((a, b) => a.month.localeCompare(b.month)));

console.log('\n=== MARIA GONZALEZ SUMMARY (2026) ===');
const mariaPunches = punches.filter((p: any) => {
  const name = empMap.get(p.employee_toast_guid) || '';
  return name.toLowerCase().includes('maria') && name.toLowerCase().includes('gonzalez');
});
const mByMonth: Record<string, { month: string, regular: number, ot: number, total: number, shifts: number }> = {};
mariaPunches.forEach((p: any) => {
  const m = (p.business_date || '').substring(0, 7);
  if (!m) return;
  if (!mByMonth[m]) mByMonth[m] = { month: m, regular: 0, ot: 0, total: 0, shifts: 0 };
  const r = Number(p.regular_hours) || 0;
  const o = Number(p.overtime_hours) || 0;
  mByMonth[m].regular += r;
  mByMonth[m].ot += o;
  mByMonth[m].total += (r + o);
  mByMonth[m].shifts++;
});
console.table(Object.values(mByMonth).sort((a, b) => a.month.localeCompare(b.month)));
