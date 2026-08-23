const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Read the exact table rows from pendientes_agosto.html to ensure 100% PARITY
const html = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

const rowRegex = /<tr>\s*<td><strong>(.*?)<\/strong><\/td>\s*<td>(.*?)<\/td>\s*<td style="text-align: center; font-weight: 700;">([\d\.]+)<\/td>\s*<td>(.*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;

let match;
const parsedRows = [];
let totalTableHours = 0;

while ((match = rowRegex.exec(html)) !== null) {
    const date = match[1].trim();
    const timeRange = match[2].trim();
    const hours = parseFloat(match[3].trim());
    const modules = match[4].replace(/<[^>]+>/g, ' ').trim();
    totalTableHours += hours;
    parsedRows.push({ date, timeRange, hours, modules });
}

console.log(`Audited total table hours: ${totalTableHours.toFixed(2)} hrs across ${parsedRows.length} rows`);

// Define scheduled Lynwood store shifts
const storeShifts = {
  '01-Aug-2026': { scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, start: 14.0, end: 21.0, dayName: 'Sáb' },
  '02-Aug-2026': { scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, start: 14.0, end: 19.0, dayName: 'Dom' },
  '03-Aug-2026': { scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, start: 12.0, end: 20.0, dayName: 'Lun' },
  '04-Aug-2026': { scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, start: 14.0, end: 22.0, dayName: 'Mar' },
  '06-Aug-2026': { scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, start: 9.0, end: 17.0, dayName: 'Jue' },
  '07-Aug-2026': { scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, start: 14.0, end: 21.0, dayName: 'Vie' },
  '08-Aug-2026': { scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, start: 14.0, end: 21.0, dayName: 'Sáb' },
  '09-Aug-2026': { scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, start: 14.0, end: 19.0, dayName: 'Dom' },
  '10-Aug-2026': { scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, start: 12.0, end: 20.0, dayName: 'Lun' },
  '11-Aug-2026': { scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, start: 14.0, end: 22.0, dayName: 'Mar' },
  '12-Aug-2026': { scheduled: 'Descanso en Tienda', shiftHours: 0.0, start: 0, end: 0, dayName: 'Mié' },
  '13-Aug-2026': { scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, start: 9.0, end: 17.0, dayName: 'Jue' },
  '14-Aug-2026': { scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, start: 14.0, end: 21.0, dayName: 'Vie' },
  '15-Aug-2026': { scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, start: 14.0, end: 21.0, dayName: 'Sáb' },
  '16-Aug-2026': { scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, start: 14.0, end: 19.0, dayName: 'Dom' },
  '17-Aug-2026': { scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, start: 12.0, end: 20.0, dayName: 'Lun' },
  '18-Aug-2026': { scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, start: 14.0, end: 22.0, dayName: 'Mar' },
  '19-Aug-2026': { scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, start: 9.0, end: 17.0, dayName: 'Mié' },
  '20-Aug-2026': { scheduled: 'Descanso en Tienda', shiftHours: 0.0, start: 0, end: 0, dayName: 'Jue' },
  '21-Aug-2026': { scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, start: 14.0, end: 21.0, dayName: 'Vie' }
};

// Parse a time string like "6:30 PM" into decimal hour 18.5
function parseTimeToDecimal(timeStr) {
  const match = timeStr.trim().match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?$/i);
  if (!match) return 12.0;
  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const p = (match[3] || '').toUpperCase();
  if (p === 'PM' && h < 12) h += 12;
  if (p === 'AM' && h === 12) h = 0;
  return h + (m / 60);
}

// Group sessions by day
const daysMap = {};
Object.keys(storeShifts).forEach(d => {
  daysMap[d] = {
    dateKey: d,
    dateShort: d.split('-')[0],
    dayName: storeShifts[d].dayName,
    shift: storeShifts[d],
    devSessions: [],
    totalDevHours: 0
  };
});

parsedRows.forEach(r => {
  if (daysMap[r.date]) {
    const parts = r.timeRange.split('-');
    let startDec = 12.0;
    let endDec = 13.0;
    if (parts.length === 2) {
      startDec = parseTimeToDecimal(parts[0]);
      endDec = parseTimeToDecimal(parts[1]);
    }
    daysMap[r.date].devSessions.push({
      timeRange: r.timeRange,
      start: startDec,
      end: endDec,
      hours: r.hours,
      modules: r.modules
    });
    daysMap[r.date].totalDevHours += r.hours;
  }
});

// Calculate grand totals
const totalDevSum = Object.values(daysMap).reduce((acc, d) => acc + d.totalDevHours, 0);
const totalScheduledSum = Object.values(daysMap).reduce((acc, d) => acc + d.shift.shiftHours, 0);

console.log('═══════════════════════════════════════════════════════════════════');
console.log(`💻 TOTAL REAL DESARROLLO SM TEG:  ${totalDevSum.toFixed(2)} hrs`);
console.log(`📅 TOTAL PLANIFICADOR LYNWOOD:   ${totalScheduledSum.toFixed(2)} hrs`);
console.log('═══════════════════════════════════════════════════════════════════');

const minHour = 4.0; // 4:00 AM (to fit 4:00 AM sessions)
const maxHour = 24.0; // 12:00 AM Midnight
const totalHourSpan = maxHour - minHour; // 20 hours

function hourToPercent(h) {
  const bounded = Math.max(minHour, Math.min(maxHour, h));
  return ((bounded - minHour) / totalHourSpan) * 100;
}

function formatCleanTime(h) {
  const hInt = Math.floor(h);
  const min = Math.round((h - hInt) * 60);
  const period = hInt >= 12 && hInt < 24 ? 'p' : 'a';
  const displayH = hInt > 12 ? (hInt > 24 ? hInt - 24 : hInt - 12) : (hInt === 0 ? 12 : hInt);
  if (min === 0) return `${displayH}${period}`;
  return `${displayH}:${min < 10 ? '0' : ''}${min}${period}`;
}

// Generate Timeline Columns HTML
const timelineColumnsHtml = Object.values(daysMap).map((d, idx) => {
  // Manager Bar (Green)
  let mgrBarsHtml = '';
  if (d.shift.shiftHours > 0) {
    const bottomPct = hourToPercent(d.shift.start);
    const heightPct = ((d.shift.end - d.shift.start) / totalHourSpan) * 100;
    const startTxt = formatCleanTime(d.shift.start);
    const endTxt = formatCleanTime(d.shift.end);
    mgrBarsHtml = `
      <div class="interval-bar bar-mgr" style="bottom: ${bottomPct.toFixed(1)}%; height: ${heightPct.toFixed(1)}%;">
          <div class="bar-edge-cap cap-top">${endTxt}</div>
          <div class="bar-core-info">
              <span class="core-icon">🏪</span>
              <span class="core-hours">${d.shift.shiftHours.toFixed(1)}h</span>
          </div>
          <div class="bar-edge-cap cap-bottom">${startTxt}</div>
      </div>
    `;
  } else {
    mgrBarsHtml = '<div class="day-off-tag"><span>Descanso</span></div>';
  }

  // Dev Bars (Indigo)
  let devBarsHtml = '';
  if (d.devSessions.length > 0) {
    devBarsHtml = d.devSessions.map(seg => {
      const bottomPct = hourToPercent(seg.start);
      let heightPct = ((seg.end - seg.start) / totalHourSpan) * 100;
      if (heightPct <= 0) heightPct = (seg.hours / totalHourSpan) * 100;
      const startTxt = formatCleanTime(seg.start);
      const endTxt = formatCleanTime(seg.end);
      const isCompact = heightPct < 7.0;

      return `
        <div class="interval-bar bar-dev" style="bottom: ${bottomPct.toFixed(1)}%; height: ${Math.max(4.5, heightPct).toFixed(1)}%;">
            <div class="bar-edge-cap cap-top">${endTxt}</div>
            <div class="bar-core-info ${isCompact ? 'compact' : ''}">
                <span class="core-icon">💻</span>
                <span class="core-hours">${seg.hours.toFixed(1)}h</span>
            </div>
            <div class="bar-edge-cap cap-bottom">${startTxt}</div>
        </div>
      `;
    }).join('');
  } else {
    devBarsHtml = '<div class="no-dev-tag"><span>—</span></div>';
  }

  return `
    <div class="timeline-col" data-day="${d.dateKey}">
        <div class="day-track-canvas">
            <div class="sub-track mgr-subtrack">
                ${mgrBarsHtml}
            </div>
            <div class="sub-track dev-subtrack">
                ${devBarsHtml}
            </div>
        </div>
        <div class="timeline-col-footer">
            <span class="col-date">${d.dateShort}</span>
            <span class="col-weekday">${d.dayName}</span>
        </div>
    </div>
  `;
}).join('\n');

// Time labels for Y Axis (every 2 hours from 4 AM to 12 AM)
const hoursMarkings = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const yAxisLabelsHtml = hoursMarkings.map(h => {
  const pct = hourToPercent(h);
  const label = h === 24 || h === 0 ? '12 AM' : (h === 12 ? '12 PM' : (h > 12 ? `${h - 12} PM` : `${h} AM`));
  return `<span class="y-label" style="bottom: ${pct}%;">${label}</span>`;
}).join('\n');

const gridLinesHtml = hoursMarkings.map(h => {
  const pct = hourToPercent(h);
  return `<div class="timeline-grid-line" style="bottom: ${pct}%;"></div>`;
}).join('\n');

// Standalone HTML template
const standaloneHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Horas Reales de Programación y Turnos — Carlos Velazquez (Agosto 2026)</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #ffffff;
            color: #0f172a;
            padding: 20px 24px;
            font-size: 11px;
            line-height: 1.35;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid #e05638;
            padding-bottom: 10px;
            margin-bottom: 14px;
        }

        .brand-title {
            font-size: 24px;
            font-weight: 900;
            color: #e05638;
            letter-spacing: -0.5px;
        }

        .brand-subtitle {
            font-size: 13px;
            font-weight: 700;
            color: #334155;
            margin-top: 1px;
        }

        .header-meta {
            text-align: right;
        }

        .header-badge {
            display: inline-block;
            background: #0f172a;
            color: #ffffff;
            font-size: 10.5px;
            font-weight: 800;
            padding: 3px 12px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 3px;
        }

        .author-box {
            font-size: 11px;
            color: #475569;
        }

        .author-box strong {
            color: #0f172a;
            font-weight: 800;
        }

        /* 4 KPI Metrics */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 14px;
        }

        .kpi-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 10px;
            padding: 10px 14px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 2px 6px rgba(0,0,0,0.03);
        }

        .kpi-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3.5px;
        }

        .kpi-dev::before { background: #6366f1; }
        .kpi-mgr::before { background: #10b981; }
        .kpi-total::before { background: #f59e0b; }
        .kpi-ratio::before { background: #0ea5e9; }

        .kpi-val {
            font-size: 21px;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.1;
        }

        .kpi-val small {
            font-size: 12px;
            font-weight: 700;
            color: #64748b;
        }

        .kpi-title {
            font-size: 10.5px;
            font-weight: 800;
            color: #1e293b;
            margin-top: 2px;
        }

        .kpi-desc {
            font-size: 9px;
            color: #64748b;
            margin-top: 1px;
        }

        /* Timeline Card */
        .timeline-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 14px;
            page-break-inside: avoid;
            box-shadow: 0 6px 20px -4px rgba(15, 23, 42, 0.06);
        }

        .timeline-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 8px;
        }

        .timeline-title {
            font-size: 14px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.3px;
        }

        .timeline-subtitle {
            font-size: 10.5px;
            color: #64748b;
            font-weight: 600;
            margin-top: 1px;
        }

        .legend-row {
            display: flex;
            align-items: center;
            gap: 18px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 11px;
            font-weight: 800;
            color: #1e293b;
        }

        .legend-box {
            width: 13px;
            height: 13px;
            border-radius: 3.5px;
        }

        .box-mgr { background: linear-gradient(180deg, #10b981 0%, #059669 100%); }
        .box-dev { background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%); }

        .timeline-body {
            display: flex;
            height: 380px;
            background: #fafafa;
            border: 1.5px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px 16px 26px 8px;
            position: relative;
            gap: 8px;
        }

        .timeline-y-axis {
            width: 40px;
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
            font-size: 9.5px;
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
            min-width: 36px;
            z-index: 2;
        }

        .day-track-canvas {
            flex: 1;
            position: relative;
            display: flex;
            gap: 3px;
            border-radius: 6px;
            background: rgba(241, 245, 249, 0.5);
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
            font-size: 7.5px;
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

        .bar-mgr {
            background: linear-gradient(180deg, #10b981 0%, #059669 100%);
            border: 1px solid #047857;
        }

        .bar-dev {
            background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
            border: 1px solid #4338ca;
        }

        .bar-edge-cap {
            font-size: 8px;
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
            line-height: 1;
            margin: 2px 0;
        }

        .bar-core-info.compact .core-icon {
            display: none;
        }

        .core-icon {
            font-size: 9px;
        }

        .core-hours {
            font-size: 9.5px;
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
            font-size: 10px;
            font-weight: 900;
            color: #0f172a;
        }

        .col-weekday {
            font-size: 8.5px;
            font-weight: 700;
            color: #64748b;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5px;
            margin-top: 6px;
        }

        th {
            background: #f1f5f9;
            color: #334155;
            font-weight: 800;
            text-align: left;
            padding: 5px 7px;
            border-bottom: 2px solid #cbd5e1;
            text-transform: uppercase;
            font-size: 8.5px;
            letter-spacing: 0.5px;
        }

        td {
            padding: 5px 7px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
        }

        tr:nth-child(even) td {
            background: #f8fafc;
        }

        .badge-shift {
            background: #e2e8f0;
            color: #1e293b;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 4px;
            font-size: 8px;
            display: inline-block;
        }

        .badge-dev-range {
            background: #ede9fe;
            color: #5b21b6;
            font-weight: 800;
            padding: 2px 5px;
            border-radius: 4px;
            font-size: 8px;
            display: inline-block;
        }

        .footer {
            margin-top: 10px;
            padding-top: 6px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            font-size: 8.5px;
            color: #64748b;
        }
    </style>
</head>
<body>

    <div class="header">
        <div>
            <div class="brand-title">TACOS GAVILAN</div>
            <div class="brand-subtitle">Registro Forense: Horas Reales de Programación vs. Turnos Oficiales de Tienda</div>
        </div>
        <div class="header-meta">
            <div class="header-badge">Agosto 2026 • 20 Días Registrados</div>
            <div class="author-box">
                <strong>Carlos Velazquez</strong><br>
                General Manager Lynwood (#14) & Creador / Arquitecto del Sistema SM TEG
            </div>
        </div>
    </div>

    <!-- 4 KPI Metrics -->
    <div class="kpi-grid">
        <div class="kpi-card kpi-dev">
            <div class="kpi-val">${totalDevSum.toFixed(2)} <small>hrs</small></div>
            <div class="kpi-title">💻 Total Real Programado SM TEG</div>
            <div class="kpi-desc">46 sesiones registradas en el reporte mensual</div>
        </div>
        <div class="kpi-card kpi-mgr">
            <div class="kpi-val">${totalScheduledSum.toFixed(0)} <small>hrs</small></div>
            <div class="kpi-title">📅 Horas Planificador Lynwood</div>
            <div class="kpi-desc">18 turnos asignados en rol oficial (#14)</div>
        </div>
        <div class="kpi-card kpi-total">
            <div class="kpi-val">19 <small>días</small></div>
            <div class="kpi-title">🚀 Días con Desarrollo Activo</div>
            <div class="kpi-desc">Avances continuos en software y tech packs</div>
        </div>
        <div class="kpi-card kpi-ratio">
            <div class="kpi-val">2 <small>días</small></div>
            <div class="kpi-title">⚡ Desarrollo en Días Libres</div>
            <div class="kpi-desc">12-Ago (4.33h) y 20-Ago (3.05h)</div>
        </div>
    </div>

    <!-- TIMELINE SCHEDULE CHART (CLARA, FLOTANTE, IDENTICA AL BOSQUEJO DE CARLOS) -->
    <div class="timeline-card">
        <div class="timeline-header">
            <div>
                <div class="timeline-title">Línea de Tiempo Diaria: Franjas Reales de Turnos vs. Franjas de Desarrollo</div>
                <div class="timeline-subtitle">Visualización de intervalos que refleja las 46 sesiones reales de programación (67.69 hrs) cruzadas con el Planificador.</div>
            </div>
            <div class="legend-row">
                <div class="legend-item">
                    <span class="legend-box box-mgr"></span>
                    <span>🏪 Horario en Lynwood (${totalScheduledSum.toFixed(0)} hrs)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-box box-dev"></span>
                    <span>💻 Sesiones de Programación (${totalDevSum.toFixed(2)} hrs)</span>
                </div>
            </div>
        </div>

        <div class="timeline-body">
            <div class="timeline-y-axis">
                ${yAxisLabelsHtml}
            </div>
            <div class="timeline-viewport">
                ${gridLinesHtml}
                ${timelineColumnsHtml}
            </div>
        </div>
    </div>

    <!-- Summary Cross Table -->
    <div>
        <table>
            <thead>
                <tr>
                    <th style="width: 9%;">Fecha</th>
                    <th style="width: 18%; text-align: center;">🏪 Planificador Lynwood</th>
                    <th style="width: 25%; text-align: center;">💻 Sesiones Exactas de Programación</th>
                    <th style="width: 10%; text-align: center;">⏱️ Dev Real</th>
                    <th style="width: 38%;">Módulos Principales</th>
                </tr>
            </thead>
            <tbody>
                ${Object.values(daysMap).map(d => {
                  const devRangesStr = d.devSessions.map(s => `${s.timeRange} (${s.hours}h)`).join(', ') || '—';
                  const modulesStr = d.devSessions.map(s => s.modules).filter((v, i, a) => a.indexOf(v) === i).join(', ') || (d.shift.shiftHours > 0 ? 'Gerencia Operativa en Tienda' : 'Descanso');
                  return `
                    <tr>
                        <td><strong>${d.dateKey.replace('-2026', '')}</strong> <small style="color:#64748b;">${d.dayName}</small></td>
                        <td style="text-align: center;"><span class="badge-shift">${d.shift.scheduled} ${d.shift.shiftHours > 0 ? `(${d.shift.shiftHours}h)` : ''}</span></td>
                        <td style="text-align: center;"><span class="badge-dev-range">${devRangesStr}</span></td>
                        <td style="text-align: center; font-weight: 800; color: #4f46e5;">${d.totalDevHours > 0 ? `${d.totalDevHours.toFixed(2)}h` : '—'}</td>
                        <td><strong>${modulesStr}</strong></td>
                    </tr>
                  `;
                }).join('\n')}
            </tbody>
        </table>
    </div>

    <div class="footer">
        <span>Tacos Gavilan • SM TEG • Planificador Oficial de Turnos Lynwood (#14)</span>
        <span>Generado para Carlos Velazquez: 22-Ago-2026</span>
    </div>

</body>
</html>
`;

// Save HTML and compile to PDF
const htmlOutPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/reporte_linea_de_tiempo_carlos.html');
fs.writeFileSync(htmlOutPath, standaloneHtml, 'utf-8');
console.log('✅ Archivo HTML actualizado con las 67.69 horas reales: ' + htmlOutPath);

(async () => {
    console.log('🚀 Compilando PDF de Línea de Tiempo con 67.69 hrs...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1380, height: 980 });

    const fileUrl = `file:///${htmlOutPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const pdfOutPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_agosto_2026.pdf');
    const execPdfOutPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_ejecutivo.pdf');

    await page.pdf({
        path: pdfOutPath,
        format: 'Letter',
        landscape: true,
        printBackground: true,
        scale: 0.88,
        margin: {
            top: '0.2in',
            right: '0.2in',
            bottom: '0.2in',
            left: '0.2in'
        }
    });

    try {
        fs.copyFileSync(pdfOutPath, execPdfOutPath);
    } catch(e) {}

    await browser.close();
    console.log('🎉 PDF de Línea de Tiempo actualizado en Desktop: ' + pdfOutPath);
})();
