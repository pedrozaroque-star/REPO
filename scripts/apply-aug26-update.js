const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📊 ACTUALIZACIÓN DEL REPORTE DE AGOSTO CON DÍA 26 (131.00 HRS)');
console.log('═══════════════════════════════════════════════════════════════════════');

const augustFull = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

// Update 25-Ago row to 11.0 hrs
const row25 = augustFull.rows.find(r => r.date === '25-Ago-2026');
if (row25) {
    row25.time = '7:00 AM - 1:45 PM & 3:20 PM - 7:30 PM';
    row25.hours = 11.0;
}

// Add 26-Ago row
const row26 = {
    date: '26-Ago-2026',
    time: '12:00 AM - 1:45 AM & 11:45 AM - 5:15 PM',
    hours: 7.25,
    badges: [
        'Radar Precios (Alertas Ahorro & Cron 5D)',
        'RONOS & Simplify Admin Creds',
        'Invoices Azusa y La Puente',
        'Viele Scraper Optimizado (1.15s)'
    ],
    descEs: '• <strong>Radar de Precios (Alertas de Ahorro por Bajada de Precios & Cron 5 Días)</strong>: Implementación del sistema de alertas ejecutivas por correo ante bajadas de precios para resaltar ahorros directos para la empresa (petición de Roberto Velazquez). Configuración del cron de revisión automática a 5 días por semana (Lunes a Viernes 6:00 AM PST).<br>• <strong>Radar de Precios (Scraper Optimizado & Homologación de Códigos)</strong>: Optimización del scraper de la API de Viele con respuesta ultra-rápida (1.15s) y mapeo automático de códigos de reemplazo de insumos (EL4LID a KDL76PP).<br>• <strong>RONOS & Simplify (Credenciales Administrativas & Extracción Batch)</strong>: Conexión con credenciales administrativas corporativas para extracción masiva de perfiles, salarios reales de supervisores/gerentes y paystubs históricos.<br>• <strong>Auditoría de Invoices Multitienda</strong>: Conciliación matemática de facturas PDF de Cingular HR para las sucursales de Azusa (invoice-TEGA-0009.pdf) y La Puente (invoice-TEGL-0022.pdf).',
    descEn: '• <strong>Price Radar (Savings Alerts on Price Drops & 5-Day Cron)</strong>: Implemented executive email alerts for price decreases to highlight company savings (requested by Roberto Velazquez). Configured automated cron to run 5 days a week (Mon-Fri 6:00 AM PST).<br>• <strong>Price Radar (Optimized Scraper & Item Code Remapping)</strong>: Accelerated Viele API live scraper to 1.15s response time and remapped vendor replacement codes (EL4LID to KDL76PP).<br>• <strong>RONOS & Simplify (Admin Credentials & Batch Extraction)</strong>: Integrated corporate admin credentials for bulk extraction of employee master profiles, active supervisor/manager salaries, and historical paystubs.<br>• <strong>Multi-Store Invoice Auditing</strong>: Cent-perfect mathematical reconciliation of Cingular HR PDF invoices for Azusa (invoice-TEGA-0009.pdf) and La Puente (invoice-TEGL-0022.pdf).'
};

// Check if 26-Ago already exists
const existing26Idx = augustFull.rows.findIndex(r => r.date === '26-Ago-2026');
if (existing26Idx >= 0) {
    augustFull.rows[existing26Idx] = row26;
} else {
    augustFull.rows.push(row26);
}

// Update Effort Summary
augustFull.effort = [
    { module: 'Preparador de Carne y Cocina KDS', hours: 25.5 },
    { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 19.25 },
    { module: 'Módulo RONOS HR & Simplify Payroll Audit', hours: 18.75 },
    { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
    { module: 'Radar de Precios Viele v3, Scraper & Alertas de Ahorro', hours: 14.5 },
    { module: 'Control de Uniformes & Caja Fuerte', hours: 12.5 },
    { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
    { module: 'Mantenimiento General, Crons y Reportes', hours: 9.5 }
];

const totalHours = augustFull.rows.reduce((sum, r) => sum + r.hours, 0);
augustFull.totalHours = parseFloat(totalHours.toFixed(2));

console.log(`Total Horas Agosto (01-26 Ago): ${augustFull.totalHours} hrs en ${augustFull.rows.length} días`);

fs.writeFileSync('scripts/august_full_data.json', JSON.stringify(augustFull, null, 2), 'utf-8');

// Now apply to build-authentic-accurate-reports.js
let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(augustFull.rows, null, 4)};`);
buildScript = buildScript.replace(/totalHours:\s*[\d\.]+,(\s*rows:\s*augustRows,)/, `totalHours: ${augustFull.totalHours.toFixed(2)},$1`);
buildScript = buildScript.replace(/effortSummary:\s*\[[\s\S]*?\n\s*\],\s*taskCardsHtml:\s*renderTab2ForMonth\(augustTasks,\s*'Agosto 2026'\)/, `effortSummary: ${JSON.stringify(augustFull.effort, null, 8)},\n    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')`);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log('✅ Applied to scripts/build-authentic-accurate-reports.js successfully!');
