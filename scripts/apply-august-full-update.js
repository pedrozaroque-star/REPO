const fs = require('fs');

const fullData = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');

// Replace augustRows
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(fullData.rows, null, 4)};`);

// Replace augustTasks
buildScript = buildScript.replace(/const augustTasks = \[[\s\S]*?\n\];/, `const augustTasks = ${JSON.stringify(fullData.tasks, null, 4)};`);

// Update augustConfig
const augustConfigStr = `// AUGUST CONFIG: 27 tasks (16 Completadas, 8 En Progreso, 3 Pendientes)
const augustConfig = {
    monthName: 'Agosto',
    monthYear: 'Agosto 2026',
    monthNum: 8,
    totalTasks: 27,
    completedTasks: 16,
    inProgressTasks: 8,
    pendingTasks: 3,
    totalHours: ${fullData.totalHours.toFixed(2)},
    rows: augustRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 3.0, desc: 'Testing en cocina del modo tableta kiosko del Preparador, validación de sincronización PC-Tableta y geofencing de MilesIQ en las 15 tiendas.' },
        { title: 'Monitoreo DB y APIs', hours: 2.5, desc: 'Auditoría de API v3 Viele & Sons (Radar de Precios), endpoints de conciliación de Ventas Toast y cálculo IRS de millas.' },
        { title: 'Planificación y Diseño', hours: 1.5, desc: 'Arquitectura de Tech Packs para uniformes, diseño del acelerador intradía de carne y estructura de las 27 tareas oficiales.' }
    ],
    effortSummary: ${JSON.stringify(fullData.effort, null, 8)},
    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')
};`;

buildScript = buildScript.replace(/\/\/ AUGUST CONFIG[\s\S]*?taskCardsHtml:\s*renderTab2ForMonth\(augustTasks,\s*'Agosto 2026'\)\s*\};/, augustConfigStr);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log(`✅ Updated scripts/build-authentic-accurate-reports.js with ${fullData.totalHours} hrs for August!`);
