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

async function verifyAllSlauson() {
  const report = await calculateCingularPayrollReport(328, [154376, 154377], true);

  console.log('='.repeat(85));
  console.log('                 REPORTE CONCILIADO SLAUSON (TEGS-0032)                  ');
  console.log('='.repeat(85));
  console.log(`Total Empleados:          ${report.totalEmployees} (Target: 23)`);
  console.log(`Total Horas:              ${report.totalHours.toFixed(2)} hrs (Target: 2,106.72 hrs) -> Diff: ${(report.totalHours - 2106.72).toFixed(2)} hrs`);
  console.log(`Salario Bruto (Gross):    $${report.totalGrossPay.toFixed(2)} (Target: $45,805.14) -> Diff: $${(report.totalGrossPay - 45805.14).toFixed(2)}`);
  console.log(`Total Facturado (Invoice):$${report.totalInvoicedAmount.toFixed(2)} (Target: $57,667.89) -> Diff: $${(report.totalInvoicedAmount - 57667.89).toFixed(2)}`);
  console.log(`Margen Cingular (PEO):    $${report.totalCingularFee.toFixed(2)} (Target: $11,862.75) -> Diff: $${(report.totalCingularFee - 11862.75).toFixed(2)}`);

  console.log('\n--- TODOS LOS 23 EMPLEADOS PROCESADOS ---');
  for (const emp of report.employees) {
    console.log(
      `${emp.fullName.padEnd(30)} | Salaried: ${emp.isSalaried ? 'YES' : ' NO'} | Rate: $${emp.payRate.toFixed(2)} | BillRate: $${emp.billRate.toFixed(2)} | Hrs: ${emp.totalHours.toFixed(2).padStart(6)} (Reg: ${emp.regularHours.toFixed(2).padStart(5)}, Sal: ${emp.salaryHours.toFixed(2).padStart(5)}, OT: ${emp.overtimeHours.toFixed(2).padStart(5)}, DT: ${emp.doubleTimeHours.toFixed(2).padStart(4)}, Sick: ${emp.sickHours.toFixed(2).padStart(5)}) | Gross: $${emp.totalGrossPay.toFixed(2).padStart(7)} | Bill: $${emp.totalInvoicedAmount.toFixed(2).padStart(7)}`
    );
  }
}

verifyAllSlauson().catch(console.error);
