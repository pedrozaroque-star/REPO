const fs = require('fs');

// Read the refined timeline chart section HTML from the generator
const timelineGenerator = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/scripts/generate-timeline-chart-pdf.js', 'utf-8');

// Extract the timeline HTML and CSS
const htmlMatch = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/reporte_linea_de_tiempo_carlos.html', 'utf-8');

// Extract the .timeline-card element from reporte_linea_de_tiempo_carlos.html
const cardStart = htmlMatch.indexOf('<div class="timeline-card">');
const cardEnd = htmlMatch.indexOf('<!-- Summary Cross Table -->');
const timelineCardHtml = htmlMatch.substring(cardStart, cardEnd).trim();

// Extract the KPI grid from reporte_linea_de_tiempo_carlos.html
const kpiStart = htmlMatch.indexOf('<div class="kpi-grid">');
const kpiEnd = htmlMatch.indexOf('<!-- TIMELINE SCHEDULE CHART');
const kpiGridHtml = htmlMatch.substring(kpiStart, kpiEnd).trim();

const fullTimelineComponentHtml = `
<!-- • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • •  -->
<!--    SECCIÓN: LÍNEA DE TIEMPO DIARIA DE FRANJAS HORARIAS (CARLOS VELAZQUEZ - BOSQUEJO OFICIAL)         -->
<!-- • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • •  -->
<div class="dual-workday-card-light">
    <div class="dual-card-header">
        <div class="header-badge-row">
            <span class="badge-executive">📊 Visualización Forense • Agosto 2026</span>
            <span class="badge-role">👔 Carlos Velazquez • General Manager Lynwood (#14) & Creador / Arquitecto del Sistema SM TEG</span>
        </div>
        <h3 class="dual-card-title">
            Línea de Tiempo de Turnos en Lynwood vs. Franjas Horarias de Desarrollo
        </h3>
        <p class="dual-card-subtitle">
            Gráfico de franjas horarias reales (de 5:00 AM a 11:30 PM) que ilustra los bloques de tiempo de cada jornada: en color verde el horario del turno en la sucursal de Lynwood y en color índigo/morado los horarios exactos en los que se programó la plataforma SM TEG, permitiendo visualizar claramente los turnos, solapamientos productivos y desarrollos en días libres o fuera de horario.
        </p>
    </div>

    ${kpiGridHtml}

    ${timelineCardHtml}
</div>
`;

let reportHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Replace any existing dual-workday-card or timeline card in pendientes_agosto.html
const cardRegex = /<div class="dual-workday-card-light">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
if (cardRegex.test(reportHtml)) {
    reportHtml = reportHtml.replace(cardRegex, fullTimelineComponentHtml.trim());
} else {
    // If there's another format, replace the entire section before Detailed Table
    const searchTarget = '<!-- Detailed Table -->';
    const idx = reportHtml.indexOf(searchTarget);
    if (idx !== -1) {
        reportHtml = reportHtml.substring(0, idx) + searchTarget + '\n\n' + fullTimelineComponentHtml.trim() + '\n\n' + reportHtml.substring(idx + searchTarget.length);
    }
}

// Add the required timeline CSS to pendientes_agosto.html if not present
const timelineCss = `
/* ==========================================================================
   TIMELINE SCHEDULE CHART CSS (CARLOS VELAZQUEZ)
   ========================================================================== */
.timeline-card {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 14px;
    padding: 18px 22px;
    margin-bottom: 20px;
    box-shadow: 0 6px 20px -4px rgba(15, 23, 42, 0.06);
}

.timeline-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 10px;
    flex-wrap: wrap;
    gap: 12px;
}

.timeline-title {
    font-size: 16px;
    font-weight: 900;
    color: #0f172a;
    letter-spacing: -0.3px;
}

.timeline-subtitle {
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
    margin-top: 2px;
}

.legend-row {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 800;
    color: #1e293b;
}

.legend-box {
    width: 14px;
    height: 14px;
    border-radius: 4px;
}

.box-mgr { background: linear-gradient(180deg, #10b981 0%, #059669 100%); }
.box-dev { background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%); }

.timeline-body {
    display: flex;
    height: 380px;
    background: #fafafa;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 18px 28px 10px;
    position: relative;
    gap: 8px;
}

.timeline-y-axis {
    width: 44px;
    position: relative;
    height: 100%;
    border-right: 1.5px solid #cbd5e1;
    margin-right: 2px;
    user-select: none;
}

.y-label {
    position: absolute;
    left: 0;
    transform: translateY(50%);
    font-size: 10px;
    font-weight: 800;
    color: #475569;
    white-space: nowrap;
}

.timeline-viewport {
    flex: 1;
    display: flex;
    position: relative;
    height: 100%;
    gap: 6px;
    border-bottom: 2px solid #94a3b8;
    overflow-x: auto;
}

.timeline-grid-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: #e2e8f0;
    border-top: 1px dashed #cbd5e1;
    pointer-events: none;
    z-index: 1;
}

.timeline-col {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
    min-width: 38px;
    z-index: 2;
}

.day-track-canvas {
    flex: 1;
    position: relative;
    display: flex;
    gap: 3px;
    border-radius: 6px;
    background: rgba(241, 245, 249, 0.6);
    border: 1px solid #e2e8f0;
    padding: 2px;
}

.sub-track {
    flex: 1;
    height: 100%;
    position: relative;
}

.day-off-tag, .no-dev-tag {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
    font-size: 8px;
    font-weight: 800;
    color: #94a3b8;
    white-space: nowrap;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.interval-bar {
    position: absolute;
    left: 0;
    right: 0;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: 1px 0;
    box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 5;
    overflow: hidden;
}

.interval-bar:hover {
    transform: scale(1.04);
    z-index: 10;
    box-shadow: 0 6px 16px rgba(0,0,0,0.2);
}

.bar-mgr {
    background: linear-gradient(180deg, #10b981 0%, #059669 100%);
    border: 1px solid #047857;
}

.bar-dev {
    background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
    border: 1px solid #4338ca;
}

.bar-edge-cap {
    font-size: 8.5px;
    font-weight: 900;
    color: #ffffff;
    background: rgba(15, 23, 42, 0.85);
    padding: 1px 2px;
    border-radius: 2px;
    line-height: 1;
    text-align: center;
    width: 92%;
    letter-spacing: -0.3px;
}

.bar-core-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    line-height: 1.1;
    margin: 2px 0;
}

.bar-core-info.compact .core-icon {
    display: none;
}

.core-icon {
    font-size: 10px;
}

.core-hours {
    font-size: 10px;
    font-weight: 900;
    letter-spacing: -0.3px;
}

.timeline-col-footer {
    position: absolute;
    bottom: -24px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
}

.col-date {
    font-size: 11px;
    font-weight: 900;
    color: #0f172a;
}

.col-weekday {
    font-size: 9px;
    font-weight: 700;
    color: #64748b;
}
`;

if (!reportHtml.includes('.timeline-viewport')) {
    reportHtml = reportHtml.replace('</style>', timelineCss + '\n</style>');
}

fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', reportHtml, 'utf-8');
console.log('✅ pendientes_agosto.html sincronizado con la Línea de Tiempo de Franjas Horarias!');
