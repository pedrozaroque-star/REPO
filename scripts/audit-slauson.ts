import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateCingularPayrollReport } from '../lib/payroll-calculator';

// Ground truth from invoice-TEGS-0032.pdf
interface TargetEmp {
  id: string;
  name: string;
  payRate: number;
  billRate: number;
  totalPay: number;
  totalBill: number;
  totalHours: number;
  regHours: number;
  salHours: number;
  otHours: number;
  dtHours: number;
  sickHours: number;
  vacHours: number;
}

const targetEmployees: TargetEmp[] = [
  { id: '277274', name: 'Abigail Mendoza Antonio', payRate: 18.47, billRate: 23.27, totalPay: 2093.92, totalBill: 2638.12, totalHours: 102.25, regHours: 80.00, salHours: 0, otHours: 22.25, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: 'EMP007989', name: 'Alberto Rodriguez', payRate: 18.47, billRate: 23.27, totalPay: 1841.30, totalBill: 2319.84, totalHours: 93.13, regHours: 80.00, salHours: 0, otHours: 13.13, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '187800', name: 'Alberto Romero', payRate: 23.40, billRate: 29.48, totalPay: 3327.95, totalBill: 4193.05, totalHours: 121.18, regHours: 80.00, salHours: 0, otHours: 40.28, dtHours: 0.90, sickHours: 0, vacHours: 0 },
  { id: '259740', name: 'alexander chay chiguil', payRate: 18.47, billRate: 23.27, totalPay: 2362.99, totalBill: 2977.13, totalHours: 111.67, regHours: 80.00, salHours: 0, otHours: 30.79, dtHours: 0.88, sickHours: 0, vacHours: 0 },
  { id: '82836', name: 'Alfonso Alarcon', payRate: 23.43, billRate: 29.52, totalPay: 3149.40, totalBill: 3968.23, totalHours: 115.76, regHours: 80.00, salHours: 0, otHours: 34.19, dtHours: 1.57, sickHours: 0, vacHours: 0 },
  { id: '264266', name: 'arturo juarez', payRate: 21.49, billRate: 27.08, totalPay: 1686.75, totalBill: 2125.51, totalHours: 78.49, regHours: 78.49, salHours: 0, otHours: 0, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '268708', name: 'Brandon Lopez', payRate: 18.47, billRate: 23.27, totalPay: 2042.88, totalBill: 2573.81, totalHours: 100.89, regHours: 80.00, salHours: 0, otHours: 18.34, dtHours: 0.55, sickHours: 2.00, vacHours: 0 },
  { id: '254994', name: 'Carlos Roca', payRate: 18.47, billRate: 23.27, totalPay: 1029.34, totalBill: 1296.84, totalHours: 55.73, regHours: 55.73, salHours: 0, otHours: 0, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '255257', name: 'Daisy Ramirez Bautista', payRate: 20.47, billRate: 25.79, totalPay: 2040.08, totalBill: 2570.29, totalHours: 93.11, regHours: 80.00, salHours: 0, otHours: 13.11, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '254838', name: 'Felix Reimundez', payRate: 18.47, billRate: 23.27, totalPay: 1517.95, totalBill: 1912.44, totalHours: 81.44, regHours: 79.95, salHours: 0, otHours: 1.49, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '317300', name: 'Hector Flores', payRate: 21.43, billRate: 27.00, totalPay: 2303.52, totalBill: 2902.36, totalHours: 98.33, regHours: 80.00, salHours: 0, otHours: 18.33, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '284774', name: 'Jennifer lizbeth Baltazar Rojas', payRate: 18.47, billRate: 23.27, totalPay: 1723.95, totalBill: 2171.98, totalHours: 89.65, regHours: 74.27, salHours: 0, otHours: 7.38, dtHours: 0, sickHours: 8.00, vacHours: 0 },
  { id: '193697', name: 'Jesus Ramos', payRate: 35.65, billRate: 44.38, totalPay: 2852.00, totalBill: 3550.40, totalHours: 80.00, regHours: 0, salHours: 80.00, otHours: 0, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '255083', name: 'Juan Antonio Hernandez', payRate: 18.47, billRate: 23.27, totalPay: 2019.96, totalBill: 2544.94, totalHours: 99.58, regHours: 80.00, salHours: 0, otHours: 19.58, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: 'EMP007984', name: 'Justin Rodriguez', payRate: 18.47, billRate: 23.27, totalPay: 1169.70, totalBill: 1473.69, totalHours: 63.33, regHours: 63.33, salHours: 0, otHours: 0, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '279827', name: 'Lorenzo Lorenzo Marcos', payRate: 18.47, billRate: 23.27, totalPay: 2049.45, totalBill: 2582.08, totalHours: 103.25, regHours: 71.82, salHours: 0, otHours: 15.43, dtHours: 0, sickHours: 16.00, vacHours: 0 },
  { id: '279570', name: 'Maria Moreno', payRate: 18.47, billRate: 23.27, totalPay: 1917.20, totalBill: 2415.46, totalHours: 95.72, regHours: 79.55, salHours: 0, otHours: 16.17, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '255081', name: 'Oscar Tiguila', payRate: 20.93, billRate: 26.37, totalPay: 2400.14, totalBill: 3024.00, totalHours: 103.12, regHours: 80.00, salHours: 0, otHours: 23.12, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '277479', name: 'Rosalinda Gutierrez Hernandez', payRate: 18.47, billRate: 23.27, totalPay: 1476.49, totalBill: 1860.21, totalHours: 79.94, regHours: 71.94, salHours: 0, otHours: 0, dtHours: 0, sickHours: 8.00, vacHours: 0 },
  { id: '283171', name: 'Sandra Yoselyn Gonon Itzep', payRate: 18.47, billRate: 23.27, totalPay: 1882.30, totalBill: 2371.49, totalHours: 94.61, regHours: 80.00, salHours: 0, otHours: 14.61, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '254990', name: 'Teresa Gabarrete Nunez', payRate: 18.47, billRate: 23.27, totalPay: 1117.44, totalBill: 1407.83, totalHours: 60.50, regHours: 60.50, salHours: 0, otHours: 0, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '286736', name: 'Veronica Osorio', payRate: 19.93, billRate: 25.11, totalPay: 2069.65, totalBill: 2607.60, totalHours: 95.90, regHours: 80.00, salHours: 0, otHours: 15.90, dtHours: 0, sickHours: 0, vacHours: 0 },
  { id: '285130', name: 'William Salgado', payRate: 18.47, billRate: 23.27, totalPay: 1730.78, totalBill: 2180.59, totalHours: 89.14, regHours: 80.00, salHours: 0, otHours: 9.14, dtHours: 0, sickHours: 0, vacHours: 0 },
];

async function runAudit() {
  console.log('='.repeat(80));
  console.log('         AUDITORÍA DE NÓMINA SLAUSON: TEGS-0032 (08/10 - 08/23)         ');
  console.log('='.repeat(80));

  // Correct weeks for 08/10/2026 - 08/23/2026: 154376 (Week 1) + 154377 (Week 2)
  const report = await calculateCingularPayrollReport(328, [154376, 154377], true);

  console.log('\n--- TOTALES GLOBALES ---');
  console.log(`Empleados:  Calculados: ${report.totalEmployees} | Target: ${targetEmployees.length}`);
  console.log(`Horas:      Calculadas: ${report.totalHours.toFixed(2)} | Target: 2106.72 | Diff: ${(report.totalHours - 2106.72).toFixed(2)}`);
  console.log(`Gross Pay:  Calculado:  $${report.totalGrossPay.toFixed(2)} | Target: $45805.14 | Diff: $${(report.totalGrossPay - 45805.14).toFixed(2)}`);
  console.log(`Facturado:  Calculado:  $${report.totalInvoicedAmount.toFixed(2)} | Target: $57667.89 | Diff: $${(report.totalInvoicedAmount - 57667.89).toFixed(2)}`);

  console.log('\n' + '='.repeat(100));
  console.log('COMPARACIÓN DETALLADA LÍNEA POR LÍNEA:');
  console.log('='.repeat(100));

  for (const target of targetEmployees) {
    const calculated = report.employees.find(e => 
      e.employeeId === target.id ||
      String(e.ronosUserId) === target.id ||
      (e.firstName && target.name.toLowerCase().includes(e.firstName.toLowerCase()) && e.lastName && target.name.toLowerCase().includes(e.lastName.toLowerCase()))
    );

    if (!calculated) {
      console.log(`❌ NO ENCONTRADO EN CÁLCULO: ${target.name} (RonosID: ${target.id})`);
      continue;
    }

    const hrsDiff = calculated.totalHours - target.totalHours;
    const payDiff = calculated.totalGrossPay - target.totalPay;
    const billDiff = calculated.totalInvoicedAmount - target.totalBill;
    const status = (Math.abs(hrsDiff) < 0.01 && Math.abs(payDiff) < 0.02 && Math.abs(billDiff) < 0.02) ? '✅ MATCH' : '⚠️ MISMATCH';

    console.log(`\n[${status}] ${target.name} (ID: ${target.id} | Calc: ${calculated.firstName} ${calculated.lastName})`);
    console.log(`  TARGET : PayRate: $${target.payRate} | BillRate: $${target.billRate} | Hrs: ${target.totalHours} (Reg: ${target.regHours}, Sal: ${target.salHours}, OT: ${target.otHours}, DT: ${target.dtHours}, Sick: ${target.sickHours}) | Gross: $${target.totalPay} | Bill: $${target.totalBill}`);
    console.log(`  CALCUL : PayRate: $${calculated.payRate} | BillRate: $${calculated.billRate} | Hrs: ${calculated.totalHours} (Reg: ${calculated.regularHours}, Sal: ${calculated.salaryHours}, OT: ${calculated.overtimeHours}, DT: ${calculated.doubleTimeHours}, Sick: ${calculated.sickHours}) | Gross: $${calculated.totalGrossPay} | Bill: $${calculated.totalInvoicedAmount}`);
    if (status !== '✅ MATCH') {
      console.log(`  👉 DIFERENCIA: Hrs: ${hrsDiff.toFixed(2)} | PayRate: $${(calculated.payRate - target.payRate).toFixed(2)} | GrossPay: $${payDiff.toFixed(2)} | Invoiced: $${billDiff.toFixed(2)}`);
    }
  }

  // Empleados extras en cálculo que no están en target
  const extraEmps = report.employees.filter(e => !targetEmployees.some(t => 
    t.id === e.employeeId || 
    t.id === String(e.ronosUserId) ||
    (e.firstName && t.name.toLowerCase().includes(e.firstName.toLowerCase()) && e.lastName && t.name.toLowerCase().includes(e.lastName.toLowerCase()))
  ));

  if (extraEmps.length > 0) {
    console.log('\n❌ EMPLEADOS EXTRAS CALCULADOS QUE NO ESTÁN EN LA FACTURA TARGET:');
    for (const extra of extraEmps) {
      console.log(`  - ${extra.firstName} ${extra.lastName} (Ronos: ${extra.ronosUserId}) | Hrs: ${extra.totalHours} | Gross: $${extra.totalGrossPay} | Invoiced: $${extra.totalInvoicedAmount}`);
    }
  }
}

runAudit().catch(console.error);
