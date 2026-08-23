const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('✨ CONSTRUYENDO JUNIO, JULIO Y AGOSTO CON LÍNEA DE TIEMPO GANTT');
console.log('═══════════════════════════════════════════════════════════════════════');

// Load Core Generator
eval(fs.readFileSync('scripts/report-generator-core.js', 'utf-8'));

// 1. EXTRACT DATA FOR JUNE 2026
const juneBackupHtml = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const juneRows = parseTableRows(juneBackupHtml);

// Extract Task Cards for June
let juneTaskCardsMatch = juneBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<!-- End Tab/i) || 
                          juneBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="main-footer">/i) ||
                          juneBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>/i);
let juneTaskCardsHtml = juneTaskCardsMatch ? juneTaskCardsMatch[1].trim() : '';

// 2. EXTRACT DATA FOR JULY 2026
const julyBackupHtml = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');
const julyRows = parseTableRows(julyBackupHtml);
let julyTaskCardsMatch = julyBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>/i);
let julyTaskCardsHtml = julyTaskCardsMatch ? julyTaskCardsMatch[1].trim() : '';

// 3. EXTRACT DATA FOR AUGUST 2026
const augustBackupHtml = fs.readFileSync('backups/pendientes_agosto_canonical_backup.html', 'utf-8');
const augustRows = parseTableRows(augustBackupHtml);
let augustTaskCardsMatch = augustBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>/i);
let augustTaskCardsHtml = augustTaskCardsMatch ? augustTaskCardsMatch[1].trim() : '';

console.log(`✅ Junio filas: ${juneRows.length}, Julio filas: ${julyRows.length}, Agosto filas: ${augustRows.length}`);

// Parallel Activities & Effort Summaries per Month
const juneConfig = {
    monthName: 'Junio',
    monthYear: 'Junio 2026',
    monthNum: 6,
    totalTasks: 17,
    completedTasks: 13,
    inProgressTasks: 3,
    pendingTasks: 1,
    totalHours: 190.5,
    rows: juneRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 30.0, desc: 'Pruebas en vivo en tienda Lynwood y terminales POS Toast, validación de telemetría de Drive-Thru y KDS en cocina.' },
        { title: 'Monitoreo DB y APIs', hours: 12.0, desc: 'Optimización de consultas SQL en Supabase, reintentos en APIs de Basecamp y Toast, y depuración de logs en tiempo real.' },
        { title: 'Planificación y Diseño', hours: 5.0, desc: 'Diseño de interfaces de usuario para el módulo de Procedimientos, flujos de trabajo de Basecamp y esquemas de datos.' }
    ],
    effortSummary: [
        { module: 'Clon y Sincronizador de Basecamp', hours: 68.0 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 34.0 },
        { module: 'Planificador de Turnos y Horarios', hours: 22.5 },
        { module: 'Inventario, Costos y Recetas', hours: 19.0 },
        { module: 'Mantenimiento General, Seguridad y Chat AI', hours: 47.0 }
    ],
    taskCardsHtml: juneTaskCardsHtml
};

const julyConfig = {
    monthName: 'Julio',
    monthYear: 'Julio 2026',
    monthNum: 7,
    totalTasks: 20,
    completedTasks: 14,
    inProgressTasks: 4,
    pendingTasks: 2,
    totalHours: 117.8,
    rows: julyRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 9.0, desc: 'Pruebas de pedidos con QuickBooks en sucursales, auditoría de hojas de trabajo impresas de inventario y validación de kioskos.' },
        { title: 'Monitoreo DB y APIs', hours: 6.0, desc: 'Supervisión de sincronización de catálogos con QuickBooks, webhook de clima NWS y logs de errores de autenticación Gmail.' },
        { title: 'Planificación y Diseño', hours: 3.6, desc: 'Diseño de la interfaz simplificada de 2 pestañas de Pedidos Bodega, modales interactivos de ayuda y hojas de trabajo.' }
    ],
    effortSummary: [
        { module: 'Inventario, Pedidos y Sincronización QuickBooks', hours: 78.0 },
        { module: 'Actividades, Planificador y Horarios', hours: 18.5 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 8.5 },
        { module: 'Mantenimiento General y Soporte Técnico', hours: 12.8 }
    ],
    taskCardsHtml: julyTaskCardsHtml
};

const augustConfig = {
    monthName: 'Agosto',
    monthYear: 'Agosto 2026',
    monthNum: 8,
    totalTasks: 26,
    completedTasks: 18,
    inProgressTasks: 6,
    pendingTasks: 2,
    totalHours: 97.76,
    rows: augustRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 3.0, desc: 'Testing en cocina del modo tableta kiosko del Preparador, validación de sincronización PC-Tableta y geofencing de MilesIQ en las 15 tiendas.' },
        { title: 'Monitoreo DB y APIs', hours: 2.5, desc: 'Auditoría de API v3 Viele & Sons (Radar de Precios), endpoints de conciliación de Ventas Toast y cálculo IRS de millas.' },
        { title: 'Planificación y Diseño', hours: 1.5, desc: 'Arquitectura de Tech Packs para uniformes, diseño del acelerador intradía de carne y estructura de las 26 tareas oficiales.' }
    ],
    effortSummary: [
        { module: 'Preparador de Carne y Cocina KDS', hours: 24.5 },
        { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
        { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 16.0 },
        { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
        { module: 'Control de Uniformes & Caja Fuerte', hours: 11.5 },
        { module: 'Radar de Precios Viele v3 & Auditoría COGS', hours: 8.0 },
        { module: 'Mantenimiento General, Crons y Reportes', hours: 6.76 }
    ],
    taskCardsHtml: augustTaskCardsHtml
};

// BUILD THE 3 FILES
const juneHtml = buildReportHtml(juneConfig);
const julyHtml = buildReportHtml(julyConfig);
const augustHtml = buildReportHtml(augustConfig);

fs.writeFileSync('pendientes.html', juneHtml, 'utf-8');
fs.writeFileSync('pendientes_julio.html', julyHtml, 'utf-8');
fs.writeFileSync('pendientes_agosto.html', augustHtml, 'utf-8');

console.log('🎉 pendientes.html (Junio 2026) creado exitosamente con Gantt timeline!');
console.log('🎉 pendientes_julio.html (Julio 2026) creado exitosamente con Gantt timeline!');
console.log('🎉 pendientes_agosto.html (Agosto 2026) creado exitosamente con Gantt timeline!');
