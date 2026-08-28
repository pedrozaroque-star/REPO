const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('📊 ACTUALIZACIÓN DEL REPORTE DE AGOSTO CON DÍAS 26, 27 Y 28 (149.25 HRS)');
console.log('═══════════════════════════════════════════════════════════════════════');

const augustFull = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

// 1. Update 25-Ago
const row25 = augustFull.rows.find(r => r.date === '25-Ago-2026');
if (row25) {
    row25.time = '7:00 AM - 1:45 PM & 3:20 PM - 7:30 PM';
    row25.hours = 11.0;
}

// 2. Update 26-Ago
const row26 = {
    date: '26-Ago-2026',
    time: '12:00 AM - 1:45 AM & 11:45 AM - 5:15 PM & 7:00 PM - 10:30 PM',
    hours: 10.75,
    badges: [
        'Radar Precios (Alertas Ahorro & Cron 5D)',
        'RONOS & Simplify Admin Creds',
        'Invoices Azusa y La Puente',
        'Viele Scraper Optimizado (1.15s)'
    ],
    descEs: '• <strong>Radar de Precios (Alertas de Ahorro por Bajada de Precios & Cron 5 Días)</strong>: Implementación del sistema de alertas ejecutivas por correo ante bajadas de precios para resaltar ahorros directos para la empresa (petición de Roberto Velazquez). Configuración del cron de revisión automática a 5 días por semana (Lunes a Viernes 6:00 AM PST).<br>• <strong>Radar de Precios (Scraper Optimizado & Homologación de Códigos)</strong>: Optimización del scraper de la API de Viele con respuesta ultra-rápida (1.15s) y mapeo automático de códigos de reemplazo de insumos (EL4LID a KDL76PP).<br>• <strong>RONOS & Simplify (Credenciales Administrativas & Extracción Batch)</strong>: Conexión con credenciales administrativas corporativas para extracción masiva de perfiles, salarios reales de supervisores/gerentes y paystubs históricos.<br>• <strong>Auditoría de Invoices Multitienda</strong>: Conciliación matemática de facturas PDF de Cingular HR para las sucursales de Azusa (invoice-TEGA-0009.pdf) y La Puente (invoice-TEGL-0022.pdf).',
    descEn: '• <strong>Price Radar (Savings Alerts on Price Drops & 5-Day Cron)</strong>: Implemented executive email alerts for price decreases to highlight company savings (requested by Roberto Velazquez). Configured automated cron to run 5 days a week (Mon-Fri 6:00 AM PST).<br>• <strong>Price Radar (Optimized Scraper & Item Code Remapping)</strong>: Accelerated Viele API live scraper to 1.15s response time and remapped vendor replacement codes (EL4LID to KDL76PP).<br>• <strong>RONOS & Simplify (Admin Credentials & Batch Extraction)</strong>: Integrated corporate admin credentials for bulk extraction of employee master profiles, active supervisor/manager salaries, and historical paystubs.<br>• <strong>Multi-Store Invoice Auditing</strong>: Cent-perfect mathematical reconciliation of Cingular HR PDF invoices for Azusa (invoice-TEGA-0009.pdf) and La Puente (invoice-TEGL-0022.pdf).'
};

const idx26 = augustFull.rows.findIndex(r => r.date === '26-Ago-2026');
if (idx26 >= 0) augustFull.rows[idx26] = row26;
else augustFull.rows.push(row26);

// 3. Add 27-Ago
const row27 = {
    date: '27-Ago-2026',
    time: '5:30 AM - 8:45 AM & 5:30 PM - 11:45 PM',
    hours: 9.5,
    badges: [
        'RONOS Motor Invoices 16 Tiendas',
        'La Bodega Horas & Nómina',
        'Simplify Bugfixes & Resiliencia',
        'Rediseño UI Pestañas RONOS'
    ],
    descEs: '• <strong>RONOS & Simplify (Motor de Pre-Cálculo de Invoices a Nivel Cadena)</strong>: Algoritmo automatizado para pre-calcular las facturas quincenales de las 16 sucursales (incluyendo La Bodega) antes de la emisión de Cingular HR, contrastando punches reales contra nómina procesada.<br>• <strong>La Bodega (Horas & Personal)</strong>: Integración de personal de almacén central y resolución de fórmulas de cálculo para personal con esquemas especiales.<br>• <strong>Auditoría Integral Línea por Línea</strong>: Auditoría exhaustiva de app/admin/ronos/page.tsx (2,728 líneas), lib/simplifyhr-api.ts (843 líneas) y lib/ronos-api.ts (1,006 líneas), eliminando fallos en runtime por propiedades nulas.<br>• <strong>Rediseño UI & Usabilidad</strong>: Simplificación de la interfaz visual de RONOS, modernización del sistema de navegación por pestañas y clarificación de métricas de cumplimiento de descansos.',
    descEn: '• <strong>RONOS & Simplify (Chain-Wide Invoice Pre-Calculation Engine)</strong>: Automated algorithm to pre-calculate bi-weekly invoices across all 16 locations (including Warehouse) prior to Cingular HR billing, benchmarking actual punches against payroll.<br>• <strong>Warehouse (Staff & Hours)</strong>: Integrated central warehouse staff and resolved specialized pay calculations.<br>• <strong>Comprehensive Line-by-Line Audit</strong>: Full audit of app/admin/ronos/page.tsx (2,728 lines), lib/simplifyhr-api.ts (843 lines), and lib/ronos-api.ts (1,006 lines), eliminating runtime null crashes.<br>• <strong>UI Redesign & Usability</strong>: Streamlined RONOS visual interface, modern tab navigation, and clear break compliance metrics.'
};

const idx27 = augustFull.rows.findIndex(r => r.date === '27-Ago-2026');
if (idx27 >= 0) augustFull.rows[idx27] = row27;
else augustFull.rows.push(row27);

// 4. Add 28-Ago (today)
const row28 = {
    date: '28-Ago-2026',
    time: '12:30 AM - 1:30 AM & 6:30 AM - 9:55 AM',
    hours: 4.42,
    badges: [
        'MilesIQ Auditoría Línea por Línea',
        'Validación Decimales Millas',
        'Null-Safety Blindaje Total',
        'Estabilidad RONOS & Simplify'
    ],
    descEs: '• <strong>MilesIQ (Auditoría Forense Integral Línea por Línea)</strong>: Auditoría profunda de TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, endpoints de API (/api/miles) y lógica de geofencing, blindando todos los escenarios de registro de viajes.<br>• <strong>MilesIQ (Validación de Decimales)</strong>: Corrección de validación estricta de números decimales en la captura de millas que impedía a supervisores guardar recorridos con fracciones.<br>• <strong>RONOS & Simplify (Blindaje Null-Safety Extremo)</strong>: Aplicación de protecciones null-safe completas en lib/payroll-calculator.ts (978 líneas), lib/ronos-api.ts (1,262 líneas) y app/admin/ronos/page.tsx (2,756 líneas) garantizando cero fallos en producción.',
    descEn: '• <strong>MilesIQ (Comprehensive Line-by-Line Forensic Audit)</strong>: Deep audit across TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, API routes (/api/miles), and geofencing logic, securing all trip capture scenarios.<br>• <strong>MilesIQ (Decimal Miles Validation)</strong>: Fixed decimal parsing and validation in trip logging modal preventing supervisor trip saves with fractional miles.<br>• <strong>RONOS & Simplify (Total Null-Safety Hardening)</strong>: Applied full null-safe guards across lib/payroll-calculator.ts (978 lines), lib/ronos-api.ts (1,262 lines), and app/admin/ronos/page.tsx (2,756 lines), ensuring rock-solid runtime stability.'
};

const idx28 = augustFull.rows.findIndex(r => r.date === '28-Ago-2026');
if (idx28 >= 0) augustFull.rows[idx28] = row28;
else augustFull.rows.push(row28);

// Update Effort Summary
augustFull.effort = [
    { module: 'Módulo RONOS HR & Simplify Payroll Audit', hours: 28.5 },
    { module: 'Preparador de Carne y Cocina KDS', hours: 25.5 },
    { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 23.5 },
    { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
    { module: 'Radar de Precios Viele v3, Scraper & Alertas de Ahorro', hours: 14.5 },
    { module: 'Control de Uniformes & Caja Fuerte', hours: 12.5 },
    { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
    { module: 'Mantenimiento General, Crons y Reportes', hours: 13.92 }
];

const totalHours = augustFull.rows.reduce((sum, r) => sum + r.hours, 0);
augustFull.totalHours = parseFloat(totalHours.toFixed(2));

console.log(`Total Horas Agosto (01-28 Ago): ${augustFull.totalHours} hrs en ${augustFull.rows.length} días`);

fs.writeFileSync('scripts/august_full_data.json', JSON.stringify(augustFull, null, 2), 'utf-8');

// Now apply to build-authentic-accurate-reports.js
let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(augustFull.rows, null, 4)};`);
buildScript = buildScript.replace(/totalHours:\s*[\d\.]+,(\s*rows:\s*augustRows,)/, `totalHours: ${augustFull.totalHours.toFixed(2)},$1`);
buildScript = buildScript.replace(/effortSummary:\s*\[[\s\S]*?\n\s*\],\s*taskCardsHtml:\s*renderTab2ForMonth\(augustTasks,\s*'Agosto 2026'\)/, `effortSummary: ${JSON.stringify(augustFull.effort, null, 8)},\n    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')`);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log('✅ Applied to scripts/build-authentic-accurate-reports.js successfully!');
