const fs = require('fs');

const daysData = [
  { date: '01-Ago', dayName: 'Sáb / Sat', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 4.50, mgr: 2.50, modules: 'Preparador, Soporte IA', note: 'Proyecciones por tramos y live data' },
  { date: '02-Ago', dayName: 'Dom / Sun', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 1.00, mgr: 4.00, modules: 'Preparador', note: 'Modo básico vs avanzado y tableta' },
  { date: '03-Ago', dayName: 'Lun / Mon', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 3.25, mgr: 4.75, modules: 'Inventario, Tech Pack', note: 'QB Estimates y PAR semanal' },
  { date: '04-Ago', dayName: 'Mar / Tue', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 3.50, mgr: 4.50, modules: 'Tech Pack Uniformes, RFQ', note: 'Ficha técnica fabricante y RFQ Formaryx' },
  { date: '06-Ago', dayName: 'Jue / Thu', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 1.00, mgr: 7.00, modules: 'Preparador, DB', note: 'Sincronización tableta-PC y tabla DB' },
  { date: '07-Ago', dayName: 'Vie / Fri', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.00, mgr: 5.00, modules: 'Horarios, Violaciones', note: 'Notificaciones automáticas descansos' },
  { date: '08-Ago', dayName: 'Sáb / Sat', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 3.50, mgr: 3.50, modules: 'Preparador, Menú TVs', note: 'Pace parrilla carnes y pantallas TV' },
  { date: '09-Ago-2026', dayName: 'Dom / Sun', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 2.00, mgr: 3.00, modules: 'Preparador', note: 'Simulación intraday acelerador' },
  { date: '10-Ago', dayName: 'Lun / Mon', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 2.30, mgr: 5.70, modules: 'Uniformes, Recepción', note: 'Control de prendas y arqueos' },
  { date: '11-Ago', dayName: 'Mar / Tue', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 0.93, mgr: 7.07, modules: 'Inventario, DB', note: 'Catálogos y mapeo de bodegas' },
  { date: '12-Ago', dayName: 'Mié / Wed', scheduled: 'Descanso en Tienda', shiftHours: 0.0, dev: 4.33, mgr: 0.00, modules: 'Basecamp 3 API', note: 'Integración API Basecamp en día libre' },
  { date: '13-Ago', dayName: 'Jue / Thu', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 5.50, mgr: 2.50, modules: 'Uniformes, MilesIQ', note: 'Champurrado, Caja Fuerte y MilesIQ' },
  { date: '14-Ago', dayName: 'Vie / Fri', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 0.00, mgr: 7.00, modules: 'Gerencia Operativa', note: '100% Supervisión en restaurante' },
  { date: '15-Ago', dayName: 'Sáb / Sat', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.25, mgr: 4.75, modules: 'Tech Pack, Uniformes', note: 'Especificaciones de fabricante' },
  { date: '16-Ago', dayName: 'Dom / Sun', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 3.00, mgr: 2.00, modules: 'MilesIQ, Planificador', note: 'GPS tiendas y soporte IA' },
  { date: '17-Ago', dayName: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 4.43, mgr: 3.57, modules: 'Radar Precios, QB', note: 'Auditoría laboral y catálogo Viele' },
  { date: '18-Ago', dayName: 'Mar / Tue', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 1.75, mgr: 6.25, modules: 'Radar Precios, Scraper', note: 'Scraper API Viele v3 y precios' },
  { date: '19-Ago', dayName: 'Mié / Wed', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 3.50, mgr: 4.50, modules: 'Uniformes, Radar', note: 'Auditoría 17 bugs y seguridad' },
  { date: '20-Ago', dayName: 'Jue / Thu', scheduled: 'Descanso en Tienda', shiftHours: 0.0, dev: 3.05, mgr: 0.00, modules: 'Basecamp, MilesIQ', note: 'Rediseño radar y coordenadas en día libre' },
  { date: '21-Ago-2026', dayName: 'Vie / Fri', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.35, mgr: 4.65, modules: 'Basecamp, Alertas', note: 'Carga bajo demanda y PDF' }
];

const totalDev = daysData.reduce((acc, d) => acc + d.dev, 0);
const totalMgr = daysData.reduce((acc, d) => acc + d.mgr, 0);
const totalWork = totalDev + totalMgr;
const devPct = ((totalDev / totalWork) * 100).toFixed(1);
const mgrPct = ((totalMgr / totalWork) * 100).toFixed(1);
const totalScheduledShifts = daysData.filter(d => d.shiftHours > 0).length;
const totalScheduledHours = daysData.reduce((acc, d) => acc + d.shiftHours, 0);

const maxDailyHours = 10.0;

const chartBarsHtml = daysData.map((d, idx) => {
  const totalDay = d.dev + d.mgr;
  const devHeight = ((d.dev / maxDailyHours) * 100).toFixed(1);
  const mgrHeight = ((d.mgr / maxDailyHours) * 100).toFixed(1);
  const devDayPct = totalDay > 0 ? ((d.dev / totalDay) * 100).toFixed(0) : '0';
  const mgrDayPct = totalDay > 0 ? ((d.mgr / totalDay) * 100).toFixed(0) : '0';
  const dayShort = d.date.split('-')[0];

  return `
    <div class="dual-bar-col" data-idx="${idx}">
        <div class="dual-bar-tooltip">
            <div class="tooltip-header">
                <strong>${d.date.replace('-2026', '')}-2026</strong> • <span style="color: #64748b;">${d.dayName}</span>
            </div>
            <div class="tooltip-row" style="margin-bottom: 6px; font-size: 11px; color: #d97706;">
                <span>📅 <strong>Planificador Lynwood:</strong></span>
                <strong>${d.scheduled}</strong>
            </div>
            <div class="tooltip-row dev-row">
                <span class="dot dev-dot"></span>
                <span>💻 Programación SM TEG:</span>
                <strong>${d.dev > 0 ? `${d.dev.toFixed(2)} hrs (${devDayPct}%)` : '—'}</strong>
            </div>
            <div class="tooltip-row mgr-row">
                <span class="dot mgr-dot"></span>
                <span>🏪 Gerencia Lynwood:</span>
                <strong>${d.mgr > 0 ? `${d.mgr.toFixed(2)} hrs (${mgrDayPct}%)` : '—'}</strong>
            </div>
            <div class="tooltip-divider"></div>
            <div class="tooltip-row total-row">
                <span>⏱️ Jornada Total:</span>
                <strong>${totalDay.toFixed(2)} hrs</strong>
            </div>
            <div class="tooltip-modules">
                📦 <em>${d.modules}</em><br>
                📝 <span style="font-size: 10.5px; color: #64748b;">${d.note}</span>
            </div>
        </div>
        <div class="dual-bar-stack">
            <!-- Manager Lynwood Segment (Top) -->
            ${d.mgr > 0 ? `
            <div class="bar-segment bar-mgr" style="height: ${mgrHeight}%;" title="Gerencia Lynwood: ${d.mgr.toFixed(2)}h">
                ${d.mgr >= 1.5 ? `<span class="segment-label">${d.mgr.toFixed(1)}h</span>` : ''}
            </div>` : ''}
            <!-- Dev TEG Segment (Bottom) -->
            ${d.dev > 0 ? `
            <div class="bar-segment bar-dev" style="height: ${devHeight}%;" title="Desarrollo SM TEG: ${d.dev.toFixed(2)}h">
                ${d.dev >= 1.0 ? `<span class="segment-label">${d.dev.toFixed(1)}h</span>` : ''}
            </div>` : ''}
        </div>
        <div class="dual-bar-footer">
            <span class="bar-date-label">${dayShort}</span>
            <span class="bar-total-label">${totalDay.toFixed(1)}h</span>
        </div>
    </div>
  `;
}).join('\n');

const updatedStreamlinedChartSection = `
<div class="dual-workday-card-light">
    <div class="dual-card-header">
        <div class="header-badge-row">
            <span class="badge-executive">📊 Visualización Ejecutiva • Agosto 2026</span>
            <span class="badge-role">👔 Carlos Velazquez • General Manager Lynwood & Creador / Arquitecto del Sistema SM TEG</span>
        </div>
        <h3 class="dual-card-title">
            Distribución Diaria de Jornada Laboral: Gerencia Lynwood vs. Desarrollo del Sistema
        </h3>
        <p class="dual-card-subtitle">
            Gráfico de barras compuestas integradas (2-en-1) que ilustra la distribución del tiempo laboral por turno entre la gestión operativa de la sucursal de Lynwood (cruzada con el Planificador) y las horas invertidas en la creación, arquitectura y programación de la plataforma tecnológica SM TEG.
        </p>
    </div>

    <!-- 4 KPI Metrics Grid -->
    <div class="dual-kpi-grid">
        <div class="kpi-card kpi-dev">
            <div class="kpi-icon-wrap">💻</div>
            <div class="kpi-info">
                <span class="kpi-num">${totalDev.toFixed(1)} <small>hrs</small></span>
                <span class="kpi-label">Programando Sistema SM TEG</span>
                <span class="kpi-subtext">${devPct}% del tiempo productivo</span>
            </div>
        </div>

        <div class="kpi-card kpi-mgr">
            <div class="kpi-icon-wrap">🏪</div>
            <div class="kpi-info">
                <span class="kpi-num">${totalMgr.toFixed(1)} <small>hrs</small></span>
                <span class="kpi-label">Gerencia Operativa Lynwood</span>
                <span class="kpi-subtext">${mgrPct}% supervisión en restaurante</span>
            </div>
        </div>

        <div class="kpi-card kpi-total">
            <div class="kpi-icon-wrap">⏱️</div>
            <div class="kpi-info">
                <span class="kpi-num">${totalWork.toFixed(1)} <small>hrs</small></span>
                <span class="kpi-label">Jornada Laboral Combinada</span>
                <span class="kpi-subtext">20 días activos registrados</span>
            </div>
        </div>

        <div class="kpi-card kpi-ratio">
            <div class="kpi-icon-wrap">📅</div>
            <div class="kpi-info">
                <span class="kpi-num">${totalScheduledHours.toFixed(0)} <small>hrs</small></span>
                <span class="kpi-label">Horas Planificador Lynwood</span>
                <span class="kpi-subtext">${totalScheduledShifts} turnos programados en tienda</span>
            </div>
        </div>
    </div>

    <!-- Clean Light Themed Stacked Bar Chart Canvas (ENLARGED) -->
    <div class="chart-container-card-light">
        <div class="chart-top-bar">
            <div class="chart-legend">
                <div class="legend-item">
                    <span class="legend-box legend-dev"></span>
                    <span class="legend-text"><strong>💻 Desarrollo del Sistema SM TEG</strong> (${totalDev.toFixed(1)} hrs • ${devPct}%)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-box legend-mgr"></span>
                    <span class="legend-text"><strong>🏪 Gerencia Lynwood</strong> (${totalMgr.toFixed(1)} hrs • ${mgrPct}%)</span>
                </div>
            </div>
            <span class="chart-hint">💡 Pasa el cursor por cada barra para ver el turno del Planificador y actividades</span>
        </div>

        <div class="dual-chart-body-light" style="height: 340px; padding: 20px 24px;">
            <!-- Y Axis Labels -->
            <div class="chart-y-axis" style="padding-bottom: 35px; font-size: 11px;">
                <span>10h</span>
                <span>8h</span>
                <span>6h</span>
                <span>4h</span>
                <span>2h</span>
                <span>0h</span>
            </div>

            <!-- Chart Columns Container -->
            <div class="chart-bars-viewport" style="padding-bottom: 35px; gap: 12px;">
                <!-- Grid Lines -->
                <div class="chart-grid-line" style="bottom: 80%;"></div>
                <div class="chart-grid-line" style="bottom: 60%;"></div>
                <div class="chart-grid-line" style="bottom: 40%;"></div>
                <div class="chart-grid-line" style="bottom: 20%;"></div>
                <div class="chart-grid-line" style="bottom: 0%;"></div>

                <!-- Bars -->
                ${chartBarsHtml}
            </div>
        </div>

        <div class="chart-bottom-summary">
            <div class="summary-pill">
                <span>📅 <strong>Horarios Planificador Lynwood (#14):</strong> Sábados 2-9 PM (7h), Domingos 2-7 PM (5h), L-M-J 8h</span>
            </div>
            <div class="summary-pill">
                <span>⚡ <strong>Dedicación en Días Libres:</strong> 12-Ago (4.3h API Basecamp) y 20-Ago (3.1h Radar de Precios)</span>
            </div>
        </div>
    </div>
</div>
`;

let html = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

const cardRegex = /<div class="dual-workday-card-light">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
html = html.replace(cardRegex, updatedStreamlinedChartSection.trim());

fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', html, 'utf-8');
console.log('✅ pendientes_agosto.html actualizado con conciliación exacta!');
