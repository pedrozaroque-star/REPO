import fs from 'fs';
import path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'reports/lynwood-personnel-audit-2026-09-25');

function loadJson(filename: string) {
  const filePath = path.join(AUDIT_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function main() {
  console.log('=== LOADING AUDIT ARTIFACTS ===');
  const employees = loadJson('employees.json');
  const jobs = loadJson('jobs.json');
  const punches = loadJson('punches.json');
  const shifts = loadJson('shifts.json');
  const sales = loadJson('sales.json');

  console.log(`Loaded: ${employees.length} employees, ${jobs.length} jobs, ${punches.length} punches, ${shifts.length} shifts, ${sales.length} sales`);

  // Map employee guid -> name
  const empMap = new Map<string, string>();
  for (const e of employees) {
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
    if (e.toast_guid) empMap.set(e.toast_guid, name);
    if (e.v2_toast_guid) empMap.set(e.v2_toast_guid, name);
    if (e.id) empMap.set(e.id, name);
  }

  // Map job guid -> job title
  const jobMap = new Map<string, string>();
  for (const j of jobs) {
    if (j.guid) jobMap.set(j.guid, j.title || j.name);
    if (j.id) jobMap.set(j.id, j.title || j.name);
  }

  // 1. VICTOR MUÑOZ: PROMOTION TIMELINE
  console.log('\n--- 1. VICTOR MUÑOZ: HISTORIAL Y PROMOCIÓN ---');
  const victorPunches = punches.filter((p: any) => {
    const name = empMap.get(p.employee_toast_guid) || '';
    return name.toLowerCase().includes('victor') && name.toLowerCase().includes('muñoz');
  }).sort((a: any, b: any) => (a.business_date || '').localeCompare(b.business_date || ''));

  // Group Victor's punches by month & job & wage
  const victorByMonth: Record<string, { month: string, job: string, wage: number, hours: number, count: number }> = {};
  for (const p of victorPunches) {
    const m = (p.business_date || '').substring(0, 7);
    if (!m) continue;
    const jobName = jobMap.get(p.job_toast_guid) || p.job_toast_guid || 'Unknown';
    const wage = Number(p.hourly_wage) || 0;
    const key = `${m}_${jobName}_${wage}`;
    if (!victorByMonth[key]) {
      victorByMonth[key] = { month: m, job: jobName, wage, hours: 0, count: 0 };
    }
    victorByMonth[key].hours += (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0);
    victorByMonth[key].count++;
  }
  console.table(Object.values(victorByMonth).sort((a, b) => a.month.localeCompare(b.month)));

  // 2. MARIA GONZALEZ: CASHIER COVERAGE (JUNE - SEPT 2026)
  console.log('\n--- 2. MARIA GONZALEZ: COBERTURA DE CAJERAS (JUNIO A SEPTIEMBRE 2026) ---');
  const mariaPunches = punches.filter((p: any) => {
    const name = empMap.get(p.employee_toast_guid) || '';
    return name.toLowerCase().includes('maria') && name.toLowerCase().includes('gonzalez');
  }).sort((a: any, b: any) => (a.business_date || '').localeCompare(b.business_date || ''));

  console.log(`Maria Gonzalez total punches: ${mariaPunches.length}`);
  const mariaHoursByMonth: Record<string, { month: string, regular: number, ot: number, total: number, days: number }> = {};
  for (const p of mariaPunches) {
    const m = (p.business_date || '').substring(0, 7);
    if (!m) continue;
    if (!mariaHoursByMonth[m]) mariaHoursByMonth[m] = { month: m, regular: 0, ot: 0, total: 0, days: 0 };
    const reg = Number(p.regular_hours) || 0;
    const ot = Number(p.overtime_hours) || 0;
    mariaHoursByMonth[m].regular += reg;
    mariaHoursByMonth[m].ot += ot;
    mariaHoursByMonth[m].total += (reg + ot);
    mariaHoursByMonth[m].days++;
  }
  console.table(Object.values(mariaHoursByMonth));

  // Check which cashiers missed shifts when Maria Gonzalez worked in June 2026
  console.log('\n--- CAJERAS AUSENTES EN JUNIO 2026 (CUANDO ENTRÓ MARIA GONZALEZ) ---');
  const juneDaysMariaWorked = new Set(mariaPunches.filter((p: any) => (p.business_date || '').startsWith('2026-06')).map((p: any) => p.business_date));
  
  // Find shifts of other cashiers in June where they had scheduled shift but no punch
  const cashierPunchesJune = punches.filter((p: any) => (p.business_date || '').startsWith('2026-06'));
  const cashierPunchesJuneByDateAndEmp = new Set(cashierPunchesJune.map((p: any) => `${p.business_date}_${p.employee_toast_guid}`));

  const cashierShiftsJune = shifts.filter((s: any) => {
    const d = s.shift_date || s.date;
    return d && d.startsWith('2026-06');
  });

  const absencesJune: Array<{ date: string, employee: string, role: string, scheduledTime: string, status: string }> = [];
  for (const s of cashierShiftsJune) {
    const d = s.shift_date || s.date;
    const empGuid = s.employee_id || s.employee_toast_guid;
    const empName = empMap.get(empGuid) || s.employee_name || 'Desconocido';
    const key = `${d}_${empGuid}`;
    if (!cashierPunchesJuneByDateAndEmp.has(key)) {
      absencesJune.push({
        date: d,
        employee: empName,
        role: jobMap.get(s.job_toast_guid || s.job_id) || s.job_name || 'Turno',
        scheduledTime: `${s.start_time || ''} - ${s.end_time || ''}`,
        status: s.status || 'Programado sin ponchada'
      });
    }
  }
  console.log(`Total de ausencias/turnos no cubiertos por el titular en Junio: ${absencesJune.length}`);
  console.table(absencesJune.slice(0, 25));

  // 3. JONATHAN VELASCO: DOUBLE SHIFTS (35 DOBLETES)
  console.log('\n--- 3. JONATHAN VELASCO: DOBLETES Y EXTENSIONES (PM CUBRIENDO AM/PM) ---');
  const jonathanPunches = punches.filter((p: any) => {
    const name = empMap.get(p.employee_toast_guid) || '';
    return name.toLowerCase().includes('jonathan') && name.toLowerCase().includes('velasco');
  }).sort((a: any, b: any) => (a.business_date || '').localeCompare(b.business_date || ''));

  const jonathanLongShifts = jonathanPunches.map((p: any) => {
    const reg = Number(p.regular_hours) || 0;
    const ot = Number(p.overtime_hours) || 0;
    const tot = reg + ot;
    return {
      date: p.business_date,
      in: p.clock_in ? new Date(p.clock_in).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '',
      out: p.clock_out ? new Date(p.clock_out).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '',
      regular: reg.toFixed(1),
      ot: ot.toFixed(1),
      total: tot.toFixed(1)
    };
  }).filter((p: any) => Number(p.total) >= 10);

  console.log(`Jonathan Velasco turnos >= 10 horas: ${jonathanLongShifts.length}`);
  console.table(jonathanLongShifts.slice(0, 20));

  // 4. KEVIN GARCIA: EXTENDED SHIFTS & SICK DAYS / ABSENCES
  console.log('\n--- 4. KEVIN GARCIA: TURNOS EXTENDIDOS Y AUSENCIAS POR SALUD ---');
  const kevinPunches = punches.filter((p: any) => {
    const name = empMap.get(p.employee_toast_guid) || '';
    return name.toLowerCase().includes('kevin') && name.toLowerCase().includes('garcia');
  }).sort((a: any, b: any) => (a.business_date || '').localeCompare(b.business_date || ''));

  const kevinLongShifts = kevinPunches.map((p: any) => {
    const reg = Number(p.regular_hours) || 0;
    const ot = Number(p.overtime_hours) || 0;
    const tot = reg + ot;
    return {
      date: p.business_date,
      in: p.clock_in ? new Date(p.clock_in).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '',
      out: p.clock_out ? new Date(p.clock_out).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' }) : '',
      regular: reg.toFixed(1),
      ot: ot.toFixed(1),
      total: tot.toFixed(1)
    };
  }).filter((p: any) => Number(p.total) >= 10);

  console.log(`Kevin Garcia turnos >= 10 horas: ${kevinLongShifts.length}`);
  console.table(kevinLongShifts);

  // Kevin absences (shifts scheduled with no punch)
  const kevinPunchDates = new Set(kevinPunches.map((p: any) => p.business_date));
  const kevinShifts = shifts.filter((s: any) => {
    const empGuid = s.employee_id || s.employee_toast_guid;
    const name = empMap.get(empGuid) || s.employee_name || '';
    return name.toLowerCase().includes('kevin') && name.toLowerCase().includes('garcia');
  });

  const kevinAbsences = kevinShifts.filter((s: any) => {
    const d = s.shift_date || s.date;
    return d && !kevinPunchDates.has(d);
  }).map((s: any) => ({
    date: s.shift_date || s.date,
    time: `${s.start_time || ''} - ${s.end_time || ''}`,
    status: s.status || 'No asistió / Falta'
  }));

  console.log(`Kevin Garcia turnos programados en los que no tuvo ponchada (enfermedad/falta): ${kevinAbsences.length}`);
  console.table(kevinAbsences);

  // 5. PEAK SALES DAYS AT LYNWOOD (2026)
  console.log('\n--- 5. DIAS PICO DE VENTA EN LYNWOOD (2026) ---');
  const lynwoodSales = sales.filter((s: any) => s.business_date && s.business_date.startsWith('2026'))
    .sort((a: any, b: any) => Number(b.net_sales) - Number(a.net_sales));

  console.table(lynwoodSales.slice(0, 15).map((s: any) => ({
    Date: s.business_date,
    Sales: `$${Math.round(s.net_sales).toLocaleString()}`,
    Orders: s.order_count,
    LaborPct: `${((s.labor_cost / s.net_sales) * 100).toFixed(1)}%`,
    LaborHours: Number(s.labor_hours).toFixed(1)
  })));
}

main().catch(console.error);
