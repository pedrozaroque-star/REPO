const fs = require('fs');

// Read the clean horizontal Gantt HTML from reporte_linea_de_tiempo_carlos.html
const htmlMatch = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/reporte_linea_de_tiempo_carlos.html', 'utf-8');

// Extract the .gantt-container element
const ganttStart = htmlMatch.indexOf('<div class="gantt-container">');
const ganttEnd = htmlMatch.indexOf('<div class="footer">');
const ganttContainerHtml = htmlMatch.substring(ganttStart, ganttEnd).trim();

// Extract KPI Grid
const kpiStart = htmlMatch.indexOf('<div class="kpi-grid">');
const kpiEnd = htmlMatch.indexOf('<!-- GANTT SCHEDULE CONTAINER -->');
const kpiGridHtml = htmlMatch.substring(kpiStart, kpiEnd).trim();

const fullTimelineComponentHtml = `
<!-- • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • •  -->
<!--    SECCIÓN: PLANIFICADOR VISUAL DIARIO DE TURNOS Y DESARROLLO (CARLOS VELAZQUEZ)                     -->
<!-- • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • •  -->
<div class="dual-workday-card-light">
    <div class="dual-card-header">
        <div class="header-badge-row">
            <span class="badge-executive">📊 Planificador Visual Diario • Agosto 2026</span>
            <span class="badge-role">👔 Carlos Velazquez • General Manager Lynwood (#14) & Creador / Arquitecto del Sistema SM TEG</span>
        </div>
        <h3 class="dual-card-title">
            Planificador Diario de Horarios e Intervalos de Tiempo (4:00 AM – 12:00 AM)
        </h3>
        <p class="dual-card-subtitle">
            Visualización limpia y detallada en pistas horizontales que refleja las 46 sesiones reales de programación (67.69 hrs) cruzadas directamente con los turnos oficiales de la sucursal de Lynwood (129 hrs), permitiendo identificar con máxima claridad los turnos en tienda, el desarrollo en oficina y las sesiones en días libres o madrugadas.
        </p>
    </div>

    ${kpiGridHtml}

    ${ganttContainerHtml}
</div>
`;

let reportHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Replace any existing dual-workday-card in pendientes_agosto.html
const cardRegex = /<div class="dual-workday-card-light">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
if (cardRegex.test(reportHtml)) {
    reportHtml = reportHtml.replace(cardRegex, fullTimelineComponentHtml.trim());
} else {
    const searchTarget = '<!-- Detailed Table -->';
    const idx = reportHtml.indexOf(searchTarget);
    if (idx !== -1) {
        reportHtml = reportHtml.substring(0, idx) + searchTarget + '\n\n' + fullTimelineComponentHtml.trim() + '\n\n' + reportHtml.substring(idx + searchTarget.length);
    }
}

// Add clean Gantt styles
const ganttCss = `
/* ==========================================================================
   HORIZONTAL GANTT SCHEDULE STYLES (CARLOS VELAZQUEZ)
   ========================================================================== */
.gantt-container {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
    margin-bottom: 24px;
}

.gantt-header-block {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    border-bottom: 1.5px solid #e2e8f0;
    padding-bottom: 14px;
    flex-wrap: wrap;
    gap: 14px;
}

.gantt-title {
    font-size: 18px;
    font-weight: 900;
    color: #0f172a;
    letter-spacing: -0.4px;
}

.gantt-subtitle {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
    margin-top: 2px;
}

.legend-row {
    display: flex;
    align-items: center;
    gap: 20px;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 800;
    color: #1e293b;
}

.legend-box {
    width: 16px;
    height: 16px;
    border-radius: 4px;
}

.box-mgr { background: linear-gradient(90deg, #10b981 0%, #059669 100%); }
.box-dev { background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%); }

.sticky-ruler {
    display: flex;
    align-items: center;
    height: 36px;
    background: #0f172a;
    color: #ffffff;
    border-radius: 8px;
    padding: 0 16px 0 94px;
    position: relative;
    margin-bottom: 14px;
}

.ruler-canvas {
    flex: 1;
    position: relative;
    height: 100%;
}

.ruler-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
}

.tick-label {
    font-size: 10.5px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.2px;
}

.days-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.gantt-day-card {
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 18px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.gantt-day-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 6px 16px rgba(0,0,0,0.06);
}

.gantt-day-card.store-day-off {
    background: #fffdfa;
    border-left: 5px solid #f59e0b;
}

.gantt-day-card.has-shift {
    border-left: 5px solid #10b981;
}

.gantt-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.day-date-group {
    display: flex;
    align-items: center;
    gap: 10px;
}

.date-badge {
    background: #0f172a;
    color: #ffffff;
    font-size: 12px;
    font-weight: 900;
    padding: 4px 10px;
    border-radius: 6px;
    letter-spacing: -0.2px;
}

.day-name-label {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
}

.day-info-pills {
    display: flex;
    align-items: center;
    gap: 8px;
}

.info-pill {
    font-size: 11.5px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
}

.info-pill.pill-dev.active {
    background: #ede9fe;
    color: #4f46e5;
    border-color: #c7d2fe;
    font-weight: 800;
}

.gantt-lanes-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 8px;
}

.lane-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
}

.lane-label {
    width: 70px;
    font-size: 10px;
    font-weight: 900;
    color: #64748b;
    letter-spacing: 0.3px;
    flex-shrink: 0;
}

.lane-track {
    flex: 1;
    height: 26px;
    position: relative;
    background: #ffffff;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
}

.gantt-bar {
    position: absolute;
    top: 2px;
    bottom: 2px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    color: #ffffff;
    box-shadow: 0 2px 5px rgba(0,0,0,0.12);
    transition: transform 0.15s ease;
}

.gantt-bar:hover {
    transform: scaleY(1.12);
    z-index: 10;
}

.bar-mgr {
    background: linear-gradient(90deg, #10b981 0%, #059669 100%);
    border: 1px solid #047857;
}

.bar-dev {
    background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%);
    border: 1px solid #4338ca;
}

.bar-center-text {
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    margin: 0 auto;
}

.bar-tag-left, .bar-tag-right {
    font-size: 9px;
    font-weight: 900;
    background: rgba(15, 23, 42, 0.7);
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1;
}

.day-off-tag {
    font-size: 11px;
    color: #d97706;
    font-weight: 700;
    padding: 3px 8px;
}

.no-dev-tag {
    font-size: 11px;
    color: #94a3b8;
    font-style: italic;
    padding: 3px 8px;
}

.gantt-card-footer {
    font-size: 11px;
    color: #475569;
}

.sessions-breakdown {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 4px;
}

.sessions-title {
    font-weight: 800;
    color: #0f172a;
}

.session-badge {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    padding: 2px 8px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
}

.dot-indigo {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6366f1;
    display: inline-block;
}

.task-desc {
    color: #64748b;
}
`;

if (!reportHtml.includes('.lane-wrapper')) {
    reportHtml = reportHtml.replace('</style>', ganttCss + '\n</style>');
}

fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', reportHtml, 'utf-8');
console.log('✅ pendientes_agosto.html sincronizado con el nuevo Gantt claro!');
