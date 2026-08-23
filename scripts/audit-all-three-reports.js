const fs = require('fs');

const reports = [
    { name: 'Junio 2026', file: 'pendientes.html', expectedHours: '190.5' },
    { name: 'Julio 2026', file: 'pendientes_julio.html', expectedHours: '117.8' },
    { name: 'Agosto 2026', file: 'pendientes_agosto.html', expectedHours: '97.76' }
];

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 AUDITORÍA DE REPORTES UNIFICADOS CON GANTT TIMELINE');
console.log('═══════════════════════════════════════════════════════════════════════');

reports.forEach(r => {
    const html = fs.readFileSync(r.file, 'utf-8');
    const size = (fs.statSync(r.file).size / 1024).toFixed(1);
    const hasGantt = html.includes('gantt-section') && html.includes('timeline-ruler');
    const hasTable = html.includes('activity-table');
    const hasParallel = html.includes('parallel-cards');
    const hasEffort = html.includes('Resumen de Esfuerzo');
    const hasTasks = html.includes('tasks-grid');
    const ganttDaysCount = (html.match(/<div class="gantt-day-card">/g) || []).length;
    const tableRowsCount = (html.match(/<tr>\s*<td class="date-cell">/g) || []).length;

    console.log(`\n📄 [${r.name}] -> ${r.file} (${size} KB):`);
    console.log(`   - Gantt Timeline: ${hasGantt ? '✅ ACTIVO' : '❌ FALTA'} (${ganttDaysCount} días mapeados con barras)`);
    console.log(`   - Tabla Detallada Bilingüe: ${hasTable ? '✅ ACTIVA' : '❌ FALTA'} (${tableRowsCount} filas)`);
    console.log(`   - Actividades Paralelas: ${hasParallel ? '✅ ACTIVA' : '❌ FALTA'}`);
    console.log(`   - Resumen de Esfuerzo: ${hasEffort ? '✅ ACTIVO' : '❌ FALTA'}`);
    console.log(`   - Pestaña de Tareas (Tab 2): ${hasTasks ? '✅ ACTIVA' : '❌ FALTA'}`);
});
