const fs = require('fs');

const buildScriptPath = 'scripts/build-authentic-accurate-reports.js';
let buildScript = fs.readFileSync(buildScriptPath, 'utf-8');

// Update August 23 row
const august23Row = {
    date: '23-Ago-2026',
    time: '12:00 AM - 1:15 AM & 6:30 AM - 8:30 AM & 9:30 AM - 12:30 PM',
    hours: 6.25,
    badges: [
        'Preparador (Auditoría)',
        'Caja Fuerte (PST & Sync)',
        'Pedidos Bodega',
        'Checklists Temperaturas (≤40°F / ≥140°F)',
        'MilesIQ (Filtro Supervisores)',
        'Planificador Turnos Lynwood'
    ],
    descEs: '• <strong>Preparador de Carne (Auditoría Forense Integral Línea por Línea)</strong>: Blindaje del acelerador intradía contra divisiones por cero, calibración de proyecciones por tramos y sincronización con tablets de cocina.<br>• <strong>Caja Fuerte & Bóveda</strong>: Corrección del cálculo de fechas en zona horaria PST (America/Los_Angeles), limpieza de manualOverride al resetear formulario y eliminación de condición de carrera asíncrona en conciliación con ventas de uniformes.<br>• <strong>Pedidos de Bodega & Insumos</strong>: Auditoría exhaustiva de guardado parcial de estimates en QuickBooks y sincronización de PAR.<br>• <strong>Checklists de Inocuidad y Temperaturas</strong>: Calibración reglamentaria de umbrales para refrigeración y barras frías (≤ 40°F) y mantenimiento caliente (≥ 140°F) con integración de estatus_manager.<br>• <strong>MilesIQ (Sincronización de Inspecciones & Filtro de Supervisores)</strong>: Filtrado estricto por supervisor activo y prevención de rutas redundantes.<br>• <strong>Planificador & Gantt</strong>: Conexión dinámica con Supabase para reflejar los 75 turnos exactos de Carlos Velazquez en Lynwood #14 y resolución del caso borde de medianoche en el Gantt.',
    descEn: '• <strong>Prep Line (Comprehensive Line-by-Line Forensic Audit)</strong>: Hardened intraday accelerator against zero-division errors, calibrated period blocks, and synced kitchen tablets.<br>• <strong>Safe Management (PST Timezone & Race Conditions)</strong>: Fixed PST date calculations, cleared manualOverride on form resets, and resolved async race condition in uniform cash reconciliation.<br>• <strong>Bodega Orders & Warehouse PAR</strong>: Full audit of partial QuickBooks estimate saves and PAR auto-sync.<br>• <strong>Food Safety & Temperature Checklists</strong>: Calibrated regulatory thresholds for cold holding (≤ 40°F) and hot holding (≥ 140°F), adding estatus_manager field.<br>• <strong>MilesIQ (Inspection Sync & Active Supervisor Filter)</strong>: Filtered active supervisors and prevented redundant multi-leg direct routes.<br>• <strong>Planner & Gantt Sync</strong>: Live connection to Supabase shifts table to display Carlos Velazquez\'s exact 75 Lynwood #14 General Manager shift schedules and resolved midnight wrap-around on Gantt ruler.'
};

// Replace August 23 row in buildScript
buildScript = buildScript.replace(/\{\s*"date":\s*"23-Ago-2026"[\s\S]*?\n\s*\}/, JSON.stringify(august23Row, null, 4));

// Update total hours to 108.50
buildScript = buildScript.replace(/totalHours:\s*[\d\.]+,(\s*rows:\s*augustRows,)/, 'totalHours: 108.50,$1');

// Update effort summary
const effortSummaryUpdated = [
    { module: 'Preparador de Carne y Cocina KDS', hours: 25.5 },
    { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 19.25 },
    { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
    { module: 'Control de Uniformes & Caja Fuerte', hours: 12.5 },
    { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
    { module: 'Radar de Precios Viele v3 & Auditoría COGS', hours: 11.5 },
    { module: 'Mantenimiento General, Crons y Reportes', hours: 8.75 }
];

buildScript = buildScript.replace(/effortSummary:\s*\[[\s\S]*?\n\s*\],\s*taskCardsHtml:\s*renderTab2ForMonth\(augustTasks,\s*'Agosto 2026'\)/, `effortSummary: ${JSON.stringify(effortSummaryUpdated, null, 8)},\n    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')`);

fs.writeFileSync(buildScriptPath, buildScript, 'utf-8');
console.log('✅ Updated scripts/build-authentic-accurate-reports.js with full August 23 activities (108.50h total)!');
