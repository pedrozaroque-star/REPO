const fs = require('fs');

const fullData = JSON.parse(fs.readFileSync('scripts/august_full_data.json', 'utf-8'));

let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');

// Replace augustRows
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(fullData.rows, null, 4)};`);

// Replace augustTasks
buildScript = buildScript.replace(/const augustTasks = \[[\s\S]*?\n\];/, `const augustTasks = ${JSON.stringify(fullData.tasks, null, 4)};`);

const configsBlock = `// JUNE CONFIG: 17 tasks (1 Completada, 9 En Progreso, 7 Pendientes)
const juneConfig = {
    monthName: 'Junio',
    monthYear: 'Junio 2026',
    monthNum: 6,
    totalTasks: 17,
    completedTasks: 1,
    inProgressTasks: 9,
    pendingTasks: 7,
    totalHours: 190.5,
    rows: juneRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 30.0, desc: 'Pruebas en vivo en tienda Lynwood y terminales POS Toast, validación de telemetría de Drive-Thru y KDS en cocina.' },
        { title: 'Monitoreo DB y APIs', hours: 12.0, desc: 'Optimización de consultas SQL en Supabase, reintentos en APIs de Basecamp y Toast, y depuración de logs en tiempo real.' },
        { title: 'Planificación y Diseño', hours: 5.0, desc: 'Diseño de interfaces de usuario para el módulo de Procedimientos, flujos de trabajo de Basecamp y esquemas de datos.' }
    ],
    effortSummary: [
        { module: 'Drive-Thru Telemetría & Tiempos en Vivo', hours: 85.0 },
        { module: 'Clon de Basecamp 3 & Mensajería Interna', hours: 42.0 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 28.5 },
        { module: 'Preparador de Carne y Cocina KDS', hours: 18.0 },
        { module: 'Mantenimiento General y Soporte Técnico', hours: 17.0 }
    ],
    taskCardsHtml: renderTab2ForMonth(juneTasks, 'Junio 2026')
};

// JULY CONFIG: 20 tasks (4 Completadas, 9 En Progreso, 7 Pendientes)
const julyConfig = {
    monthName: 'Julio',
    monthYear: 'Julio 2026',
    monthNum: 7,
    totalTasks: 20,
    completedTasks: 4,
    inProgressTasks: 9,
    pendingTasks: 7,
    totalHours: 117.8,
    rows: julyRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 18.0, desc: 'Pruebas en restaurante Lynwood de las vistas de tableta KDS y validación de aperturas/cierres en Caja Fuerte.' },
        { title: 'Monitoreo DB y APIs', hours: 6.0, desc: 'Verificación continua de sincronizaciones automáticas de QuickBooks y endpoints de Google Maps para las 15 tiendas.' },
        { title: 'Planificación y Diseño', hours: 4.0, desc: 'Diseño de arquitectura para el módulo de Control de Uniformes y especificaciones de TV Menús digitales.' }
    ],
    effortSummary: [
        { module: 'Preparador de Carne y Cocina KDS', hours: 38.5 },
        { module: 'Inventario, Pedidos y Sincronización QuickBooks', hours: 26.0 },
        { module: 'Actividades, Planificador y Horarios', hours: 18.0 },
        { module: 'Clon y Sincronizador de Basecamp', hours: 14.0 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 8.5 },
        { module: 'Mantenimiento General y Soporte Técnico', hours: 12.8 }
    ],
    taskCardsHtml: renderTab2ForMonth(julyTasks, 'Julio 2026')
};

// AUGUST CONFIG: 27 tasks (16 Completadas, 8 En Progreso, 3 Pendientes)
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
};
`;

buildScript = buildScript.replace(/\/\/ JUNE CONFIG[\s\S]*?\/\/ WRITE REPORTS/, `${configsBlock}\n// WRITE REPORTS`);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log('✅ Rebuilt clean scripts/build-authentic-accurate-reports.js with 168.99h!');
