const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('⚡ ACTUALIZANDO REPORTE DE AGOSTO 2026 CON LA SESIÓN DE UNIFICACIÓN');
console.log('═══════════════════════════════════════════════════════════════════════');

// Re-run rebuild script with updated August data directly
const rebuildScriptPath = path.join(process.cwd(), 'scripts', 'rebuild-master-all-three-reports.js');
let scriptContent = fs.readFileSync(rebuildScriptPath, 'utf-8');

// Update August 22 row in rebuild script
const updatedRowCode = `    {
        date: '22-Ago-2026',
        time: '10:00 AM - 12:50 AM',
        hours: 10.50,
        badges: ['Ventas Toast API', 'Descansos IA', 'Uniformes', 'MilesIQ IRS', 'Módulo Admin HTML', 'Gantt Unificado'],
        descEs: '• <strong>Ventas (Toast API & Conciliación Bell $8,332.64)</strong>: Diagnóstico y resolución de discrepancia de ventas en Bell. Identificación de reembolsos de fechas cruzadas (Cross-Date Refunds de Party Trays) y soporte EBT para cuadre al centavo.<br>• <strong>Descansos Laborales (Alertas & Tooltips)</strong>: Corrección del solapamiento visual de popups en los logs de descansos y auditoría de violaciones de comida (California Labor Law).<br>• <strong>Uniformes & Caja Fuerte</strong>: Auditoría y blindaje de la tabla de stock mínimo (660 registros en BD para las 15 tiendas) y conciliación del flujo de ventas en efectivo con la Caja Fuerte.<br>• <strong>MilesIQ Supervisores (Smart Auto-Capture & GPS)</strong>: Implementación de geofencing perimetral en las 15 tiendas oficiales, cálculo fiscal IRS ($0.760/milla) y captura rápida a 1 toque.<br>• <strong>Módulo Admin de Reportes HTML (/admin/reporte-actividades)</strong>: Creación del visor interactivo exclusivo para Administradores con pestañas dinámicas para alternar entre Junio, Julio y Agosto sin requerir PDFs estáticos.<br>• <strong>Unificación de Líneas de Tiempo Gantt</strong>: Recreación y sincronización de las pistas cronológicas (4:00 AM - 12:00 AM) para los 3 reportes mensuales con doble carril (Tienda Lynwood y Dev TEG).',
        descEn: '• <strong>Sales (Toast API & Bell Reconciliation $8,332.64)</strong>: Solved Bell sales discrepancy by handling cross-date party tray refunds and EBT items.<br>• <strong>Labor Breaks (Alerts & Tooltips)</strong>: Fixed visual tooltip overlap on lunch/break logs and automated CA meal break violation auditing.<br>• <strong>Uniforms & Safe Box</strong>: Audited and locked 660 minimum stock DB records across all 15 stores with cash sale reconciliation.<br>• <strong>MilesIQ (Smart Auto-Capture & GPS)</strong>: Store geofencing for canonical 15 locations, IRS mileage rate deduction ($0.760/mi), and 1-tap quick logging.<br>• <strong>Admin HTML Reports Viewer (/admin/reporte-actividades)</strong>: Built interactive Admin-exclusive viewer with month switching tabs, eliminating static PDFs.<br>• <strong>Unified Gantt Timelines</strong>: Recreated and synced 4 AM - 12 AM dual-track schedules across all 3 monthly reports.'
    }`;

scriptContent = scriptContent.replace(/\{\s*date:\s*'22-Ago-2026'[\s\S]*?descEn:[\s\S]*?\}\s*\]/m, `${updatedRowCode}\n]`);
scriptContent = scriptContent.replace(/totalHours:\s*97\.76/g, 'totalHours: 98.76');

fs.writeFileSync(rebuildScriptPath, scriptContent, 'utf-8');

// Run the updated rebuild script
require('./rebuild-master-all-three-reports.js');

(async () => {
    console.log('🚀 Recompilando PDF en escritorio...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1800 });

    const fileUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const pdfOutPath = 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf';
    await page.pdf({
        path: pdfOutPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    console.log('🎉 Reporte_Agosto_2026_TEG.pdf generado exitosamente con 98.76 horas!');
    await browser.close();
})();
