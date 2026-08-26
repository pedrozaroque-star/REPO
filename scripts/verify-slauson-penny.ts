import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateCingularPayrollReport, CINGULAR_RATE_OVERRIDES } from '../lib/payroll-calculator';

// Slauson verified master rates
const SLAUSON_RATES: Record<string, { payRate: number, billRate: number, otBillRate?: number }> = {
  'jesus ramos': { payRate: 35.65, billRate: 44.38 }, // General Manager (Salaried)
  'alfonso alarcon': { payRate: 23.43, billRate: 29.52, otBillRate: 44.28 },
  'alberto romero': { payRate: 23.40, billRate: 29.48, otBillRate: 44.23 },
  'arturo juarez': { payRate: 21.49, billRate: 27.08, otBillRate: 40.62 },
  'hector flores': { payRate: 21.43, billRate: 27.00, otBillRate: 40.50 },
  'oscar tiguila': { payRate: 20.93, billRate: 26.37, otBillRate: 39.55 },
  'oscar tiguilla': { payRate: 20.93, billRate: 26.37, otBillRate: 39.55 },
  'daisy ramirez bautista': { payRate: 20.47, billRate: 25.79, otBillRate: 38.68 },
  'daisy bautista': { payRate: 20.47, billRate: 25.79, otBillRate: 38.68 },
  'veronica osorio': { payRate: 19.93, billRate: 25.11, otBillRate: 37.66 },
  'abigail mendoza antonio': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'abigail mendoza': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'alberto rodriguez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'alexander chay chiguil': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'alexander chiguil': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'brandon lopez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'carlos roca': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'felix reimundez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'felix remundez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'jennifer lizbeth baltazar rojas': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'jennifer baltazar': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'juan antonio hernandez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'juan hernandez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'justin rodriguez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'lorenzo lorenzo marcos': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'lorenzo lorenzo': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'maria moreno': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'rosalinda gutierrez hernandez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'rosalinda gutierrez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'sandra yoselyn gonon itzep': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'sandra gonon itzep': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'teresa gabarrete nunez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'teresa nunez': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 },
  'william salgado': { payRate: 18.47, billRate: 23.27, otBillRate: 34.90 }
};

Object.assign(CINGULAR_RATE_OVERRIDES, SLAUSON_RATES);

const targetEmployees = [
  { id: '277274', name: 'Abigail Mendoza Antonio', payRate: 18.47, billRate: 23.27, totalPay: 2093.92, totalBill: 2638.12, totalHours: 102.25 },
  { id: 'EMP007989', name: 'Alberto Rodriguez', payRate: 18.47, billRate: 23.27, totalPay: 1841.30, totalBill: 2319.84, totalHours: 93.13 },
  { id: '187800', name: 'Alberto Romero', payRate: 23.40, billRate: 29.48, totalPay: 3327.95, totalBill: 4193.05, totalHours: 121.18 },
  { id: '259740', name: 'alexander chay chiguil', payRate: 18.47, billRate: 23.27, totalPay: 2362.99, totalBill: 2977.13, totalHours: 111.67 },
  { id: '82836', name: 'Alfonso Alarcon', payRate: 23.43, billRate: 29.52, totalPay: 3149.40, totalBill: 3968.23, totalHours: 115.76 },
  { id: '264266', name: 'arturo juarez', payRate: 21.49, billRate: 27.08, totalPay: 1686.75, totalBill: 2125.51, totalHours: 78.49 },
  { id: '268708', name: 'Brandon Lopez', payRate: 18.47, billRate: 23.27, totalPay: 2042.88, totalBill: 2573.81, totalHours: 100.89 },
  { id: '254994', name: 'Carlos Roca', payRate: 18.47, billRate: 23.27, totalPay: 1029.34, totalBill: 1296.84, totalHours: 55.73 },
  { id: '255257', name: 'Daisy Ramirez Bautista', payRate: 20.47, billRate: 25.79, totalPay: 2040.08, totalBill: 2570.29, totalHours: 93.11 },
  { id: '254838', name: 'Felix Reimundez', payRate: 18.47, billRate: 23.27, totalPay: 1517.95, totalBill: 1912.44, totalHours: 81.44 },
  { id: '317300', name: 'Hector Flores', payRate: 21.43, billRate: 27.00, totalPay: 2303.52, totalBill: 2902.36, totalHours: 98.33 },
  { id: '284774', name: 'Jennifer lizbeth Baltazar Rojas', payRate: 18.47, billRate: 23.27, totalPay: 1723.95, totalBill: 2171.98, totalHours: 89.65 },
  { id: '193697', name: 'Jesus Ramos', payRate: 35.65, billRate: 44.38, totalPay: 2852.00, totalBill: 3550.40, totalHours: 80.00 },
  { id: '255083', name: 'Juan Antonio Hernandez', payRate: 18.47, billRate: 23.27, totalPay: 2019.96, totalBill: 2544.94, totalHours: 99.58 },
  { id: 'EMP007984', name: 'Justin Rodriguez', payRate: 18.47, billRate: 23.27, totalPay: 1169.70, totalBill: 1473.69, totalHours: 63.33 },
  { id: '279827', name: 'Lorenzo Lorenzo Marcos', payRate: 18.47, billRate: 23.27, totalPay: 2049.45, totalBill: 2582.08, totalHours: 103.25 },
  { id: '279570', name: 'Maria Moreno', payRate: 18.47, billRate: 23.27, totalPay: 1917.20, totalBill: 2415.46, totalHours: 95.72 },
  { id: '255081', name: 'Oscar Tiguila', payRate: 20.93, billRate: 26.37, totalPay: 2400.14, totalBill: 3024.00, totalHours: 103.12 },
  { id: '277479', name: 'Rosalinda Gutierrez Hernandez', payRate: 18.47, billRate: 23.27, totalPay: 1476.49, totalBill: 1860.21, totalHours: 79.94 },
  { id: '283171', name: 'Sandra Yoselyn Gonon Itzep', payRate: 18.47, billRate: 23.27, totalPay: 1882.30, totalBill: 2371.49, totalHours: 94.61 },
  { id: '254990', name: 'Teresa Gabarrete Nunez', payRate: 18.47, billRate: 23.27, totalPay: 1117.44, totalBill: 1407.83, totalHours: 60.50 },
  { id: '286736', name: 'Veronica Osorio', payRate: 19.93, billRate: 25.11, totalPay: 2069.65, totalBill: 2607.60, totalHours: 95.90 },
  { id: '285130', name: 'William Salgado', payRate: 18.47, billRate: 23.27, totalPay: 1730.78, totalBill: 2180.59, totalHours: 89.14 },
];

async function verifySlausonPennyPerfect() {
  const report = await calculateCingularPayrollReport(328, [154376, 154377], true);

  console.log('\n--- DETALLE LÍNEA POR LÍNEA ---');
  for (const target of targetEmployees) {
    const calc = report.employees.find(e => 
      e.employeeId === target.id || 
      String(e.employeeUserId) === target.id ||
      e.fullName.toLowerCase().includes(target.name.toLowerCase().split(' ')[0]) && e.fullName.toLowerCase().includes(target.name.toLowerCase().split(' ')[1] || '')
    );

    if (!calc) {
      console.log(`❌ NO ENCONTRADO: ${target.name} (ID: ${target.id})`);
      continue;
    }

    const payDiff = calc.totalGrossPay - target.totalPay;
    const billDiff = calc.totalInvoicedAmount - target.totalBill;
    const match = Math.abs(payDiff) < 0.02 && Math.abs(billDiff) < 0.02;

    console.log(`[${match ? '✅ MATCH' : '⚠️ MISMATCH'}] ${target.name.padEnd(28)} | PayRate: $${calc.payRate} (Target: $${target.payRate}) | Gross: $${calc.totalGrossPay.toFixed(2)} vs $${target.totalPay.toFixed(2)} (Diff: $${payDiff.toFixed(2)}) | Bill: $${calc.totalInvoicedAmount.toFixed(2)} vs $${target.totalBill.toFixed(2)} (Diff: $${billDiff.toFixed(2)})`);
  }
}

verifySlausonPennyPerfect().catch(console.error);
