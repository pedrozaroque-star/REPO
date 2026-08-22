const fs = require('fs');

const daysData = [
  { date: '01-Ago', dayName: 'Sáb / Sat', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 4.50, mgr: 2.50, mode: 'COMBINADO', modules: 'Preparador, Soporte IA', note: 'Proyecciones por tramos y datos en vivo' },
  { date: '02-Ago', dayName: 'Dom / Sun', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 1.00, mgr: 4.00, mode: 'COMBINADO', modules: 'Preparador', note: 'Modo básico vs avanzado y tableta' },
  { date: '03-Ago', dayName: 'Lun / Mon', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 3.25, mgr: 4.75, mode: 'COMBINADO', modules: 'Inventario, Tech Pack', note: 'QB Estimates y Tech Pack Uniformes' },
  { date: '04-Ago', dayName: 'Mar / Tue', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 9.00, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Preparador, Auditoría', note: '100% Dev intensivo (Turno completo + 1h extra)' },
  { date: '06-Ago', dayName: 'Jue / Thu', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 1.00, mgr: 7.00, mode: 'COMBINADO', modules: 'Preparador, DB', note: 'Sincronización tableta-PC y tabla DB' },
  { date: '07-Ago', dayName: 'Vie / Fri', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.00, mgr: 5.00, mode: 'COMBINADO', modules: 'Horarios, Violaciones', note: 'Notificaciones automáticas de descansos' },
  { date: '08-Ago', dayName: 'Sáb / Sat', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 7.15, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Preparador, Menú TVs', note: 'Pace de parrilla, carne y pantallas' },
  { date: '09-Ago-2026', dayName: 'Dom / Sun', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 2.00, mgr: 3.00, mode: 'COMBINADO', modules: 'Preparador', note: 'Simulación intraday y acelerador de parrilla' },
  { date: '10-Ago', dayName: 'Lun / Mon', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 2.30, mgr: 5.70, mode: 'COMBINADO', modules: 'Uniformes, Recepción', note: 'Control de prendas y arqueos' },
  { date: '11-Ago', dayName: 'Mar / Tue', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 0.93, mgr: 7.07, mode: 'COMBINADO', modules: 'Inventario, DB', note: 'Catálogos y mapeo de bodegas' },
  { date: '12-Ago', dayName: 'Mié / Wed', scheduled: 'Descanso en Tienda', shiftHours: 0.0, dev: 4.33, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Basecamp, Sincronizador', note: 'Integración API Basecamp y hilos' },
  { date: '13-Ago', dayName: 'Jue / Thu', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 5.50, mgr: 2.50, mode: 'COMBINADO', modules: 'Uniformes, Caja Fuerte', note: 'Conciliación de efectivo y ventas' },
  { date: '14-Ago', dayName: 'Vie / Fri', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 0.00, mgr: 7.00, mode: 'INDEPENDIENTE_OPS', modules: 'Gerencia Operativa', note: 'Supervisión de restaurante en Lynwood' },
  { date: '15-Ago', dayName: 'Sáb / Sat', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.25, mgr: 4.75, mode: 'COMBINADO', modules: 'Tech Pack, Uniformes', note: 'Especificaciones de fabricante' },
  { date: '16-Ago', dayName: 'Dom / Sun', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 6.00, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'MilesIQ, Planificador, IA', note: 'GPS de tiendas y notificaciones' },
  { date: '17-Ago', dayName: 'Lun / Mon', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 4.43, mgr: 3.57, mode: 'COMBINADO', modules: 'Radar Precios, QB, Cron', note: 'Auditoría laboral y catálogo Viele' },
  { date: '18-Ago', dayName: 'Mar / Tue', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 1.75, mgr: 6.25, mode: 'COMBINADO', modules: 'Radar Precios, Scraper', note: 'Scraper API Viele v3 y precios base' },
  { date: '19-Ago', dayName: 'Mié / Wed', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 3.50, mgr: 4.50, mode: 'COMBINADO', modules: 'Uniformes, Radar, Seguridad', note: 'Auditoría forense 17 bugs y roles' },
  { date: '20-Ago', dayName: 'Jue / Thu', scheduled: 'Descanso en Tienda', shiftHours: 0.0, dev: 3.05, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Basecamp, MilesIQ, Radar', note: 'Rediseño ejecutivo y coordenadas' },
  { date: '21-Ago-2026', dayName: 'Vie / Fri', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.35, mgr: 4.65, mode: 'COMBINADO', modules: 'Basecamp, MilesIQ, Alertas', note: 'Carga bajo demanda, alertas correo y PDF' }
];

const combinedDays = daysData.filter(d => d.mode === 'COMBINADO');
const independentDevDays = daysData.filter(d => d.mode === 'INDEPENDIENTE_DEV');
const independentOpsDays = daysData.filter(d => d.mode === 'INDEPENDIENTE_OPS');

const devCombined = combinedDays.reduce((acc, d) => acc + d.dev, 0);
const mgrCombined = combinedDays.reduce((acc, d) => acc + d.mgr, 0);
const totalCombined = devCombined + mgrCombined;

const devIndependent = independentDevDays.reduce((acc, d) => acc + d.dev, 0);
const mgrIndependent = independentOpsDays.reduce((acc, d) => acc + d.mgr, 0);

const totalDev = devCombined + devIndependent;
const totalMgr = mgrCombined + mgrIndependent;
const totalWork = totalDev + totalMgr;
const devPct = ((totalDev / totalWork) * 100).toFixed(1);
const mgrPct = ((totalMgr / totalWork) * 100).toFixed(1);

const maxDailyHours = 10.0;

const chartBarsHtml = daysData.map((d, idx) => {
  const totalDay = d.dev + d.mgr;
  const devHeight = ((d.dev / maxDailyHours) * 100).toFixed(1);
  const mgrHeight = ((d.mgr / maxDailyHours) * 100).toFixed(1);
  const devDayPct = totalDay > 0 ? ((d.dev / totalDay) * 100).toFixed(0) : '0';
  const mgrDayPct = totalDay > 0 ? ((d.mgr / totalDay) * 100).toFixed(0) : '0';
  const dayShort = d.date.split('-')[0];

  let modeTag = '🔀 Combinada';
  let modeBadgeStyle = 'background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe;';
  let modeIcon = '🔀';
  if (d.mode === 'INDEPENDIENTE_DEV') {
    modeTag = '💻 100% Dev';
    modeIcon = '💻';
    modeBadgeStyle = 'background: #fef3c7; color: #92400e; border: 1px solid #fde68a;';
  }
  if (d.mode === 'INDEPENDIENTE_OPS') {
    modeTag = '🏪 100% Tienda';
    modeIcon = '🏪';
    modeBadgeStyle = 'background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0;';
  }

  return `
    <div class="dual-bar-col" data-idx="${idx}">
        <div class="dual-bar-tooltip">
            <div class="tooltip-header">
                <strong>${d.date.replace('-2026', '')}-2026</strong> • <span style="color: #64748b;">${d.dayName}</span>
            </div>
            <div class="tooltip-row" style="margin-bottom: 4px; font-size: 11px; color: #0284c7;">
                <span>🎯 <strong>Modalidad:</strong></span>
                <strong>${modeTag}</strong>
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
        <div class="bar-mode-pill" style="${modeBadgeStyle}">${modeIcon}</div>
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

const updatedLightChartSection = `
<div class="dual-workday-card-light">
    <div class="dual-card-header">
        <div class="header-badge-row">
            <span class="badge-executive">📊 Visualización Ejecutiva • Agosto 2026</span>
            <span class="badge-role">👔 Carlos Velazquez • General Manager Lynwood & Creador / Arquitecto del Sistema SM TEG</span>
        </div>
        <h3 class="dual-card-title">
            Distribución de Jornada Laboral: Gerencia Lynwood vs. Desarrollo del Sistema
        </h3>
        <p class="dual-card-subtitle">
            Gráfico de barras compuestas integradas (2-en-1) que ilustra la distribución del tiempo laboral por turno entre la gestión operativa de la sucursal de Lynwood (cruzada con el Planificador) y las horas invertidas en la creación, arquitectura y programación de la plataforma tecnológica SM TEG.
        </p>
    </div>

    <!-- 2-Box Modality Breakdown (Combinada vs Independiente) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 20px;">
        <div style="background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 13px; font-weight: 800; color: #1e3a8a;">🔀 Jornadas Combinadas (En Turno de Tienda)</span>
                <span style="font-size: 10px; font-weight: 800; background: #6366f1; color: #fff; padding: 2px 8px; border-radius: 999px;">14 Días • 102.0 hrs</span>
            </div>
            <div style="display: flex; gap: 16px; font-size: 11.5px; color: #334155;">
                <div>💻 Dev SM TEG: <strong style="color: #4f46e5; font-size: 13px;">${devCombined.toFixed(1)}h</strong> (36%)</div>
                <div>🏪 Gerencia Lynwood: <strong style="color: #059669; font-size: 13px;">${mgrCombined.toFixed(1)}h</strong> (64%)</div>
            </div>
        </div>

        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 13px; font-weight: 800; color: #92400e;">🎯 Jornadas Independientes (Enfoque Exclusivo)</span>
                <span style="font-size: 10px; font-weight: 800; background: #d97706; color: #fff; padding: 2px 8px; border-radius: 999px;">6 Días • ${(devIndependent + mgrIndependent).toFixed(1)} hrs</span>
            </div>
            <div style="display: flex; gap: 16px; font-size: 11.5px; color: #334155;">
                <div>💻 100% Dev (5 días): <strong style="color: #b45309; font-size: 13px;">${devIndependent.toFixed(1)}h</strong></div>
                <div>🏪 100% Tienda (1 día): <strong style="color: #059669; font-size: 13px;">${mgrIndependent.toFixed(1)}h</strong></div>
            </div>
        </div>
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
            <div class="kpi-icon-wrap">⚖️</div>
            <div class="kpi-info">
                <span class="kpi-num">${devPct}% / ${mgrPct}%</span>
                <span class="kpi-label">Ratio de Enfoque Dual</span>
                <span class="kpi-subtext">Balance Dev vs Operaciones</span>
            </div>
        </div>
    </div>

    <!-- Clean Light Themed Stacked Bar Chart Canvas (ENLARGED) -->
    <div class="chart-container-card-light">
        <div class="chart-top-bar">
            <div class="chart-legend">
                <div class="legend-item">
                    <span class="legend-box legend-dev"></span>
                    <span class="legend-text"><strong>💻 Desarrollo del Sistema SM TEG</strong> (Horas Código & Arquitectura)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-box legend-mgr"></span>
                    <span class="legend-text"><strong>🏪 Gerencia Lynwood</strong> (Operación en Piso, Cocina y Equipo)</span>
                </div>
            </div>
            <span class="chart-hint">💡 Pasa el cursor por cada barra para ver la modalidad, turno del Planificador y actividades</span>
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
                <span>🎯 <strong>Modalidades:</strong> 14 Días Combinados (102h) + 6 Días Independientes Monotarea (36.5h)</span>
            </div>
        </div>
    </div>
</div>
`;

// Clean Light Styles to inject into <head>
const lightStyles = `
<style>
/* ==========================================================================
   CLEAN LIGHT THEME DUAL WORKDAY DISTRIBUTION (CARLOS VELAZQUEZ) - ENLARGED
   ========================================================================== */
.dual-workday-card-light {
    background: #ffffff;
    border-radius: 20px;
    padding: 32px;
    margin-bottom: 35px;
    color: #0f172a;
    box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.08), 0 0 0 1px #e2e8f0;
    position: relative;
    overflow: visible;
}

.dual-card-header {
    margin-bottom: 25px;
}

.header-badge-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
}

.badge-executive {
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
    color: #ffffff;
    font-size: 11.5px;
    font-weight: 800;
    padding: 5px 14px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
}

.badge-role {
    background: #f1f5f9;
    color: #334155;
    font-size: 11.5px;
    font-weight: 700;
    padding: 5px 14px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
}

.dual-card-title {
    font-size: 26px;
    font-weight: 900;
    color: #0f172a;
    margin: 0 0 8px 0;
    letter-spacing: -0.5px;
}

.dual-card-subtitle {
    font-size: 13.5px;
    color: #64748b;
    line-height: 1.6;
    margin: 0;
    max-width: 950px;
}

/* KPI Grid */
.dual-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    margin-bottom: 25px;
}

.kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 16px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.kpi-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.08);
}

.kpi-icon-wrap {
    font-size: 26px;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f8fafc;
    flex-shrink: 0;
}

.kpi-dev .kpi-icon-wrap { background: #e0e7ff; border: 1px solid #c7d2fe; }
.kpi-mgr .kpi-icon-wrap { background: #d1fae5; border: 1px solid #a7f3d0; }
.kpi-total .kpi-icon-wrap { background: #fef3c7; border: 1px solid #fde68a; }
.kpi-ratio .kpi-icon-wrap { background: #e0f2fe; border: 1px solid #bae6fd; }

.kpi-info {
    display: flex;
    flex-direction: column;
}

.kpi-num {
    font-size: 24px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1.1;
}

.kpi-num small {
    font-size: 14px;
    font-weight: 600;
    color: #64748b;
}

.kpi-label {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    margin-top: 2px;
}

.kpi-subtext {
    font-size: 11px;
    color: #64748b;
    margin-top: 1px;
}

/* Light Chart Canvas Container */
.chart-container-card-light {
    background: #ffffff;
    border-radius: 16px;
    border: 1.5px solid #cbd5e1;
    padding: 26px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.05);
}

.chart-top-bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e2e8f0;
}

.chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #1e293b;
    font-weight: 700;
}

.legend-box {
    width: 15px;
    height: 15px;
    border-radius: 4px;
    flex-shrink: 0;
}

.legend-dev {
    background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
    box-shadow: 0 2px 6px rgba(99, 102, 241, 0.4);
}

.legend-mgr {
    background: linear-gradient(180deg, #10b981 0%, #059669 100%);
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
}

.chart-hint {
    font-size: 12px;
    color: #64748b;
    font-weight: 500;
}

/* Chart Body with Y Axis & Bars */
.dual-chart-body-light {
    display: flex;
    gap: 14px;
    position: relative;
    margin-bottom: 18px;
    background: #f8fafc;
    border-radius: 14px;
    border: 1px solid #e2e8f0;
}

.chart-y-axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-weight: 800;
    color: #475569;
    width: 28px;
    text-align: right;
    user-select: none;
}

.chart-bars-viewport {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    position: relative;
    border-bottom: 2.5px solid #94a3b8;
}

.chart-grid-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: #e2e8f0;
    pointer-events: none;
}

/* Single Bar Column (WIDER & TALLER) */
.dual-bar-col {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    position: relative;
    cursor: pointer;
    min-width: 26px;
}

.bar-mode-pill {
    font-size: 10px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 5px;
    margin-bottom: 6px;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.dual-bar-stack {
    width: 100%;
    max-width: 44px; /* WIDER BARS */
    height: 100%;
    display: flex;
    flex-direction: column-reverse;
    border-radius: 8px;
    overflow: hidden;
    background: #e2e8f0;
    border: 1px solid #cbd5e1;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.dual-bar-col:hover .dual-bar-stack {
    transform: scaleY(1.03);
    box-shadow: 0 6px 16px rgba(0,0,0,0.15);
}

.bar-segment {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
}

.bar-dev {
    background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
}

.bar-mgr {
    background: linear-gradient(180deg, #10b981 0%, #059669 100%);
    border-top: 1.5px solid rgba(255, 255, 255, 0.5);
}

.segment-label {
    font-size: 11px; /* LARGER NUMBERS INSIDE BARS */
    font-weight: 900;
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    letter-spacing: -0.3px;
}

.dual-bar-footer {
    position: absolute;
    bottom: -32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
}

.bar-date-label {
    font-size: 11px;
    font-weight: 900;
    color: #0f172a;
}

.bar-total-label {
    font-size: 10px;
    font-weight: 800;
    color: #64748b;
}

/* Tooltip on Hover (Light Theme) */
.dual-bar-tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(-10px);
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 14px 16px;
    width: 270px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(99, 102, 241, 0.2);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 1000;
    pointer-events: none;
    color: #0f172a;
}

.dual-bar-col:hover .dual-bar-tooltip {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(-16px);
}

.tooltip-header {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e2e8f0;
}

.tooltip-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    margin-bottom: 5px;
    color: #475569;
}

.tooltip-row strong {
    color: #0f172a;
    font-weight: 800;
}

.dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
}

.dev-dot { background: #6366f1; }
.mgr-dot { background: #10b981; }

.tooltip-divider {
    height: 1px;
    background: #e2e8f0;
    margin: 8px 0;
}

.tooltip-modules {
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.45;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed #e2e8f0;
}

/* Bottom summary pills */
.chart-bottom-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 40px;
}

.summary-pill {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 7px 16px;
    border-radius: 999px;
    font-size: 12px;
    color: #334155;
    font-weight: 600;
}

@media (max-width: 768px) {
    .dual-workday-card-light { padding: 18px; }
    .dual-card-title { font-size: 18px; }
    .chart-bars-viewport { gap: 6px; overflow-x: auto; }
    .dual-bar-col { min-width: 18px; }
    .dual-bar-tooltip { width: 220px; font-size: 10px; }
}
</style>
`;

let html = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

const styleRegex = /<style>[\s\S]*?CLEAN LIGHT THEME DUAL WORKDAY DISTRIBUTION[\s\S]*?<\/style>/;
if (styleRegex.test(html)) {
    html = html.replace(styleRegex, lightStyles.trim());
} else {
    html = html.replace('</head>', `${lightStyles}\n</head>`);
}

const cardRegex = /<div class="dual-workday-card-light">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
html = html.replace(cardRegex, updatedLightChartSection.trim());

fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', html, 'utf-8');
console.log('✅ pendientes_agosto.html ampliado con gráfica grande y nítida!');
