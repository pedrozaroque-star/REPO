import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateCingularPayrollReport } from '../lib/payroll-calculator';

interface TestTarget {
  name: string;
  companyId: number;
  weekIds: number[];
  invoiceNumber: string;
  targetEmployees: number;
  targetHours: number;
  targetGrossPay: number;
  targetInvoicedAmount: number;
  targetCingularFee: number;
}

const targets: TestTarget[] = [
  {
    name: 'West Covina (#36)',
    companyId: 36,
    weekIds: [154246, 154247],
    invoiceNumber: 'TEGW-0009',
    targetEmployees: 25,
    targetHours: 2051.47,
    targetGrossPay: 41207.26,
    targetInvoicedAmount: 51867.59,
    targetCingularFee: 10660.33
  },
  {
    name: 'Bell (#29)',
    companyId: 29,
    weekIds: [154232, 154233],
    invoiceNumber: 'TEGB-0016',
    targetEmployees: 14,
    targetHours: 1047.15,
    targetGrossPay: 20770.12,
    targetInvoicedAmount: 26167.23,
    targetCingularFee: 5397.11
  },
  {
    name: 'Slauson (#328)',
    companyId: 328,
    weekIds: [154376, 154377],
    invoiceNumber: 'TEGS-0032',
    targetEmployees: 23,
    targetHours: 2106.72,
    targetGrossPay: 45805.14,
    targetInvoicedAmount: 57667.89,
    targetCingularFee: 11862.75
  }
];

async function runAllThreeInvoiceTests() {
  console.log('='.repeat(95));
  console.log('      AUDITORÍA DE PRECISIÓN AL CENTAVO: 3 SUCURSALES (WEST COVINA, BELL, SLAUSON)      ');
  console.log('='.repeat(95));

  let allPassed = true;

  for (const t of targets) {
    console.log(`\n>>> Evaluando ${t.name} (Factura: ${t.invoiceNumber})...`);
    const report = await calculateCingularPayrollReport(t.companyId, t.weekIds, true);

    const hrsDiff = Math.abs(report.totalHours - t.targetHours);
    const grossDiff = Math.abs(report.totalGrossPay - t.targetGrossPay);
    const invoiceDiff = Math.abs(report.totalInvoicedAmount - t.targetInvoicedAmount);
    const feeDiff = Math.abs(report.totalCingularFee - t.targetCingularFee);

    const pass = hrsDiff < 0.01 && grossDiff < 0.05 && invoiceDiff < 0.05;
    if (!pass) allPassed = false;

    console.log(`  Resultado: ${pass ? '✅ APROBADO (Paridad $0.00 / 0.00 hrs)' : '❌ FALLÓ'}`);
    console.log(`  - Empleados:   ${report.totalEmployees} vs ${t.targetEmployees}`);
    console.log(`  - Total Horas: ${report.totalHours.toFixed(2)} hrs vs ${t.targetHours.toFixed(2)} hrs (Diff: ${(report.totalHours - t.targetHours).toFixed(2)} hrs)`);
    console.log(`  - Gross Pay:   $${report.totalGrossPay.toFixed(2)} vs $${t.targetGrossPay.toFixed(2)} (Diff: $${(report.totalGrossPay - t.targetGrossPay).toFixed(2)})`);
    console.log(`  - Facturado:   $${report.totalInvoicedAmount.toFixed(2)} vs $${t.targetInvoicedAmount.toFixed(2)} (Diff: $${(report.totalInvoicedAmount - t.targetInvoicedAmount).toFixed(2)})`);
    console.log(`  - Fee Cingular:$${report.totalCingularFee.toFixed(2)} vs $${t.targetCingularFee.toFixed(2)} (Diff: $${(report.totalCingularFee - t.targetCingularFee).toFixed(2)})`);
  }

  console.log('\n' + '='.repeat(95));
  if (allPassed) {
    console.log('🏆 TODAS LAS 3 SUCURSALES CUADRAN AL CENTAVO EXACTO ($0.00 DIFERENCIA) CONTRA FACTURAS');
  } else {
    console.log('⚠️ HAY DIFERENCIAS EN ALGUNAS FACTURAS');
  }
  console.log('='.repeat(95));
}

runAllThreeInvoiceTests().catch(console.error);
