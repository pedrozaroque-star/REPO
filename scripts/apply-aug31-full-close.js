const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📊 ACTUALIZACIÓN FINAL DE AGOSTO 2026 (31 DÍAS COMPLETOS - 152.25 HRS)');
console.log('═══════════════════════════════════════════════════════════════════════');

const augustFull = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

// 1. Update 28-Ago
const row28 = {
    date: '28-Ago-2026',
    time: '12:30 AM - 1:30 AM & 6:30 AM - 10:15 AM',
    hours: 4.75,
    badges: [
        'MilesIQ Auditoría Línea por Línea',
        'Validación Decimales Millas',
        'Null-Safety Blindaje Total',
        'Estabilidad RONOS & Simplify'
    ],
    descEs: '• <strong>MilesIQ (Auditoría Forense Integral Línea por Línea)</strong>: Auditoría profunda de TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, endpoints de API (/api/miles) y lógica de geofencing, blindando todos los escenarios de registro de viajes.<br>• <strong>MilesIQ (Validación de Decimales & Round-Trip)</strong>: Corrección de validación de decimales (step 0.01) en captura de millas y duplicación automática de distancia en viajes redondos (Round-Trip).<br>• <strong>RONOS & Simplify (Blindaje Null-Safety Extremo)</strong>: Aplicación de 73 protecciones null-safe completas en lib/payroll-calculator.ts (978 líneas), lib/ronos-api.ts (1,262 líneas) y app/admin/ronos/page.tsx (2,756 líneas), aprobando el 100% de los smoke tests en runtime.',
    descEn: '• <strong>MilesIQ (Comprehensive Line-by-Line Forensic Audit)</strong>: Deep audit across TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, API routes (/api/miles), and geofencing logic, securing all trip capture scenarios.<br>• <strong>MilesIQ (Decimal Validation & Round-Trip Calculation)</strong>: Fixed 2-decimal step validation in trip logging and automated round-trip distance doubling.<br>• <strong>RONOS & Simplify (Total Null-Safety Hardening)</strong>: Applied 73 null-safe guards across lib/payroll-calculator.ts (978 lines), lib/ronos-api.ts (1,262 lines), and app/admin/ronos/page.tsx (2,756 lines), passing 100% of runtime smoke tests.'
};

const idx28 = augustFull.rows.findIndex(r => r.date === '28-Ago-2026');
if (idx28 >= 0) augustFull.rows[idx28] = row28;
else augustFull.rows.push(row28);

// 2. Add 29-Ago
const row29 = {
    date: '29-Ago-2026',
    time: '—',
    hours: 0.0,
    badges: ['Descanso Operativo'],
    descEs: '• <strong>Día de Descanso Operativo (Programación)</strong>: Turno presencial en tienda Lynwood #14 (2:00 PM - 9:00 PM). Sin actividad de desarrollo en el sistema.',
    descEn: '• <strong>Operational Rest Day (Development)</strong>: In-store manager shift at Lynwood #14 (2:00 PM - 9:00 PM). No system development activity.'
};
const idx29 = augustFull.rows.findIndex(r => r.date === '29-Ago-2026');
if (idx29 >= 0) augustFull.rows[idx29] = row29;
else augustFull.rows.push(row29);

// 3. Add 30-Ago
const row30 = {
    date: '30-Ago-2026',
    time: '—',
    hours: 0.0,
    badges: ['Descanso Operativo'],
    descEs: '• <strong>Día de Descanso Operativo (Programación)</strong>: Turno presencial en tienda Lynwood #14 (2:00 PM - 7:00 PM). Sin actividad de desarrollo en el sistema.',
    descEn: '• <strong>Operational Rest Day (Development)</strong>: In-store manager shift at Lynwood #14 (2:00 PM - 7:00 PM). No system development activity.'
};
const idx30 = augustFull.rows.findIndex(r => r.date === '30-Ago-2026');
if (idx30 >= 0) augustFull.rows[idx30] = row30;
else augustFull.rows.push(row30);

// 4. Add 31-Ago
const row31 = {
    date: '31-Ago-2026',
    time: '12:45 PM - 1:30 PM & 6:00 PM - 8:00 PM',
    hours: 2.75,
    badges: [
        'Preparador KDS (Despertar Tableta)',
        'Auto-Actualización 24/7 (6 AM)',
        'Persistencia Programación Manual',
        'Cierre Oficial Agosto 2026'
    ],
    descEs: '• <strong>Preparador de Carne (Botón Despertar Tableta & Sincro de Turno)</strong>: Implementación del botón de acción rápida prominente y de alto contraste al inicio del turno para sincronizar proyecciones, pedidos de carne y programación manual del gerente con un solo toque.<br>• <strong>Tablets KDS (Auto-Actualización 24/7 sin Recarga Manual)</strong>: Corrección de la lógica de auto-detección del día comercial actual (regla 6:00 AM) para que las tablets de cocina en modo kiosko se actualicen solas al nuevo día sin requerir intervención del cocinero.<br>• <strong>Persistencia en Base de Datos</strong>: Aseguramiento de la persistencia de las sobreescrituras manuales del gerente (prep_manual_schedule) al despertar la tableta o cambiar de día.<br>• <strong>Actividades & Checklists</strong>: Sincronización instantánea de nuevas tareas por estación en el tablero de cocina.<br>• <strong>Cierre Oficial Agosto 2026</strong>: Consolidación final del informe mensual con 152.25 horas auditadas y 27 tareas oficiales.',
    descEn: '• <strong>Prep Line (Wake Tablet Button & 1-Tap Shift Sync)</strong>: Implemented high-contrast prominent action button at shift start to synchronize meat projections, orders, and manager manual schedule in 1 tap.<br>• <strong>KDS Tablets (24/7 Auto-Update at 6:00 AM Business Day)</strong>: Fixed commercial business day rollover logic so kitchen kiosk tablets automatically transition to the new day without manual refresh.<br>• <strong>Database Persistence</strong>: Guaranteed persistence of manager manual overrides (prep_manual_schedule) upon waking tablets or day rollover.<br>• <strong>Activities & Checklists</strong>: Instant synchronization of new station tasks to the kitchen board.<br>• <strong>August 2026 Official Close</strong>: Final consolidation of monthly report with 152.25 audited hours and 27 canonical tasks.'
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
    { module: 'Radar de Precios Viele v3, Scraper & Alertas de Ahorro', hours: 14.5 },
    { module: 'Control de Uniformes & Caja Fuerte', hours: 12.5 },
    { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
    { module: 'Mantenimiento General, Crons y Reportes', hours: 14.0 }
];

const totalHours = augustFull.rows.reduce((sum, r) => sum + r.hours, 0);
augustFull.totalHours = parseFloat(totalHours.toFixed(2));

console.log(`Total Horas Agosto (01-31 Ago): ${augustFull.totalHours} hrs en ${augustFull.rows.length} días`);

fs.writeFileSync('scripts/august_full_data.json', JSON.stringify(augustFull, null, 2), 'utf-8');

// Now apply to build-authentic-accurate-reports.js
let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(augustFull.rows, null, 4)};`);
buildScript = buildScript.replace(/totalHours:\s*[\d\.]+,(\s*rows:\s*augustRows,)/, `totalHours: ${augustFull.totalHours.toFixed(2)},$1`);
buildScript = buildScript.replace(/effortSummary:\s*\[[\s\S]*?\n\s*\],\s*taskCardsHtml:\s*renderTab2ForMonth\(augustTasks,\s*'Agosto 2026'\)/, `effortSummary: ${JSON.stringify(augustFull.effort, null, 8)},\n    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')`);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log('✅ Applied to scripts/build-authentic-accurate-reports.js successfully!');
