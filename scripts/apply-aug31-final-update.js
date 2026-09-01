const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📊 CONSOLIDACIÓN FINAL DEFINITIVA DE AGOSTO 2026 (154.50 HRS)');
console.log('═══════════════════════════════════════════════════════════════════════');

const augustFull = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

// Update 31-Ago row
const row31 = {
    date: '31-Ago-2026',
    time: '12:45 PM - 1:30 PM & 7:45 PM - 11:30 PM',
    hours: 5.0,
    badges: [
        'Radar Precios Auto-Aprobación',
        'Protección Food Cost Histórico',
        'Cron Viele 6:00 AM PST',
        'Preparador KDS Despertar',
        'MilesIQ Respaldo Pruebas'
    ],
    descEs: '• <strong>Radar de Precios & Cron (Auto-Aprobación & Protección de Food Cost Histórico)</strong>: Blindaje de la sincronización de QuickBooks para no sobreescribir insumos externos (is_bodega: false). Auto-aprobación automática de precios de Viele en inventory_items e inventory_price_history al dispararse el cron diario (6:00 AM PST), invalidando la caché de Food Cost actual sin alterar los históricos de fechas pasadas.<br>• <strong>Plantilla Ejecutiva de Correo</strong>: Rediseño limpio en 5 columnas con fecha del último precio aprobado (lastApprovedDate) y cálculo de impacto financiero anual a nivel cadena.<br>• <strong>Preparador de Carne (Botón Despertar Tableta & Auto-Actualización 24/7)</strong>: Botón de inicio de turno para sincronización en 1 toque y auto-cambio de día comercial (6:00 AM) sin recarga manual.<br>• <strong>MilesIQ</strong>: Respaldo y depuración de recorridos de prueba de Ricardo y Estefani antes del arranque oficial del 1 de septiembre.<br>• <strong>Cierre Definitivo Agosto 2026</strong>: Consolidación final del informe mensual oficial con 154.50 horas de desarrollo auditadas y 27 tareas canonicales del sistema.',
    descEn: '• <strong>Price Radar & Cron (Auto-Approval & Historical Food Cost Protection)</strong>: Guarded QuickBooks sync from overwriting non-bodega vendor items. Enabled automatic price auto-approval in inventory_items and inventory_price_history upon daily 6:00 AM PST cron execution, refreshing current food cost cache while strictly preserving historical food cost integrity.<br>• <strong>Executive Email Template</strong>: Clean 5-column layout with last approved price date (lastApprovedDate) and annual chain-wide financial impact.<br>• <strong>Prep Line (Wake Tablet Button & 24/7 KDS Auto-Sync)</strong>: 1-tap shift start sync button and seamless 6:00 AM business day rollover without manual page reloads.<br>• <strong>MilesIQ</strong>: Backed up and purged August testing trips for Ricardo and Estefani ahead of official Sept 1 launch.<br>• <strong>August 2026 Final Close</strong>: Final consolidation of official monthly report with 154.50 audited dev hours and 27 canonical system tasks.'
};

const idx31 = augustFull.rows.findIndex(r => r.date === '31-Ago-2026');
if (idx31 >= 0) augustFull.rows[idx31] = row31;
else augustFull.rows.push(row31);

// Update Effort Summary
augustFull.effort = [
    { module: 'Módulo RONOS HR & Simplify Payroll Audit', hours: 28.5 },
    { module: 'Preparador de Carne y Cocina KDS', hours: 28.25 },
    { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 23.5 },
    { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
    { module: 'Radar de Precios Viele v3, Scraper & Alertas de Ahorro', hours: 16.75 },
    { module: 'Mantenimiento General, Crons y Reportes', hours: 14.0 },
    { module: 'Control de Uniformes & Caja Fuerte', hours: 12.5 },
    { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 }
];

const totalHours = augustFull.rows.reduce((sum, r) => sum + r.hours, 0);
augustFull.totalHours = parseFloat(totalHours.toFixed(2));

console.log(`Total Horas Agosto (01-31 Ago): ${augustFull.totalHours} hrs en ${augustFull.rows.length} días`);

fs.writeFileSync('scripts/august_full_data.json', JSON.stringify(augustFull, null, 2), 'utf-8');

// Update build script
let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(augustFull.rows, null, 4)};`);
buildScript = buildScript.replace(/totalHours:\s*[\d\.]+,(\s*rows:\s*augustRows,)/, `totalHours: ${augustFull.totalHours.toFixed(2)},$1`);
buildScript = buildScript.replace(/effortSummary:\s*\[[\s\S]*?\n\s*\],\s*taskCardsHtml:\s*renderTab2ForMonth\(augustTasks,\s*'Agosto 2026'\)/, `effortSummary: ${JSON.stringify(augustFull.effort, null, 8)},\n    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')`);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log('✅ Updated scripts/build-authentic-accurate-reports.js successfully!');
