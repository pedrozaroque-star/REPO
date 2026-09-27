import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');
const employees = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'employees.json'), 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'jobs.json'), 'utf-8'));
const punches = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'punches.json'), 'utf-8'));
const shifts = JSON.parse(fs.readFileSync(path.join(AUDIT_DIR, 'shifts.json'), 'utf-8'));

const empMap = new Map();
employees.forEach((e: any) => {
  const n = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  if (e.toast_guid) empMap.set(e.toast_guid, n);
  if (e.v2_toast_guid) empMap.set(e.v2_toast_guid, n);
  if (e.id) empMap.set(e.id, n);
});

// Check all punches of Blanca Zarat, Maria Tapia, Maria T Alejandre, Maria Gonzalez in June 2026
const cashierNames = ['Blanca Zarat', 'Maria Tapia', 'Maria T Alejandre', 'Maria Gonzalez', 'Sugey Reyes', 'Martha Lemus'];
const juneCashierPunches = punches.filter((p: any) => {
  const d = p.business_date || '';
  if (!d.startsWith('2026-06')) return false;
  const name = empMap.get(p.employee_toast_guid) || '';
  return cashierNames.some(cn => name.toLowerCase().includes(cn.toLowerCase()));
});

// Aggregate by date
const daysInJune: Record<string, string[]> = {};
for (let d = 1; d <= 30; d++) {
  const dayStr = `2026-06-${String(d).padStart(2, '0')}`;
  daysInJune[dayStr] = [];
}

juneCashierPunches.forEach((p: any) => {
  const d = p.business_date;
  const name = empMap.get(p.employee_toast_guid) || '';
  if (daysInJune[d]) {
    const hours = ((Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0)).toFixed(1);
    daysInJune[d].push(`${name} (${hours}h)`);
  }
});

console.log('=== ASISTENCIA DE CAJERAS EN JUNIO 2026 (INICIO DE MARIA GONZALEZ) ===');
Object.entries(daysInJune).forEach(([d, emps]) => {
  console.log(`${d}: [${emps.length} cajeras activas] -> ${emps.join(' | ')}`);
});
