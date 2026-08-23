const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Min hour 4.0 (4 AM), Max hour 24.0 (Midnight) -> Span 20 hours
const minHour = 4.0;
const maxHour = 24.0;
const totalSpan = maxHour - minHour;

function toPercent(h) {
  const bounded = Math.max(minHour, Math.min(maxHour, h));
  return ((bounded - minHour) / totalSpan) * 100;
}

const daysData = [
  {
    date: '01-Ago',
    dayName: 'Sábado',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 18.5, end: 21.0, hours: 4.5, timeStr: '6:30 PM - 9:00 PM', task: 'Preparador (Tramos, Live data)' }
    ],
    totalDev: 4.50,
    modules: 'Preparador, Soporte IA'
  },
  {
    date: '02-Ago',
    dayName: 'Domingo',
    scheduled: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, timeStr: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 17.0, end: 18.0, hours: 1.0, timeStr: '5:00 PM - 6:00 PM', task: 'Modo básico vs avanzado y tableta' }
    ],
    totalDev: 1.00,
    modules: 'Preparador'
  },
  {
    date: '03-Ago',
    dayName: 'Lunes',
    scheduled: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, timeStr: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 16.75, end: 19.25, hours: 2.5, timeStr: '4:45 PM - 7:15 PM', task: 'QB Estimates y PAR semanal' },
      { start: 20.5, end: 21.25, hours: 0.75, timeStr: '8:30 PM - 9:15 PM', task: 'Tech Pack specs' }
    ],
    totalDev: 3.25,
    modules: 'Inventario, Tech Pack'
  },
  {
    date: '04-Ago',
    dayName: 'Martes',
    scheduled: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, timeStr: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 9.75, end: 19.0, hours: 9.0, timeStr: '9:45 AM - 7:00 PM', task: 'Tech Pack Uniformes, RFQ Formaryx' }
    ],
    totalDev: 9.00,
    modules: 'Tech Pack Uniformes, RFQ'
  },
  {
    date: '06-Ago',
    dayName: 'Jueves',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 12.0, end: 13.0, hours: 1.0, timeStr: '12:00 PM - 1:00 PM', task: 'Sincronización tableta-PC y DB' }
    ],
    totalDev: 1.00,
    modules: 'Preparador, DB'
  },
  {
    date: '07-Ago',
    dayName: 'Viernes',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 13.0, end: 15.0, hours: 2.0, timeStr: '1:00 PM - 3:00 PM', task: 'Notificaciones descansos LUNCH' }
    ],
    totalDev: 2.00,
    modules: 'Horarios, Violaciones'
  },
  {
    date: '08-Ago',
    dayName: 'Sábado',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 13.0, end: 20.0, hours: 7.15, timeStr: '1:00 PM - 8:00 PM', task: 'Pace parrilla carnes y pantallas TV' }
    ],
    totalDev: 7.15,
    modules: 'Preparador, Menú TVs'
  },
  {
    date: '09-Ago',
    dayName: 'Domingo',
    scheduled: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, timeStr: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 14.0, end: 16.0, hours: 2.0, timeStr: '2:00 PM - 4:00 PM', task: 'Simulación intraday acelerador' }
    ],
    totalDev: 2.00,
    modules: 'Preparador'
  },
  {
    date: '10-Ago',
    dayName: 'Lunes',
    scheduled: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, timeStr: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 15.5, end: 17.5, hours: 2.3, timeStr: '3:30 PM - 5:30 PM', task: 'Control de prendas y arqueos' }
    ],
    totalDev: 2.30,
    modules: 'Uniformes, Recepción'
  },
  {
    date: '11-Ago',
    dayName: 'Martes',
    scheduled: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, timeStr: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 18.75, end: 19.5, hours: 0.93, timeStr: '6:45 PM - 7:25 PM', task: 'Catálogos y mapeo bodega' }
    ],
    totalDev: 0.93,
    modules: 'Inventario, DB'
  },
  {
    date: '12-Ago',
    dayName: 'Miércoles',
    scheduled: 'Descanso en Tienda',
    shiftHours: 0.0,
    mgrRange: null,
    devSessions: [
      { start: 13.25, end: 13.58, hours: 0.33, timeStr: '1:15 PM - 1:35 PM', task: 'API Basecamp' },
      { start: 19.33, end: 23.5, hours: 4.0, timeStr: '7:20 PM - 11:30 PM', task: 'Sincronizador continuo en día libre' }
    ],
    totalDev: 4.33,
    modules: 'Basecamp 3 API'
  },
  {
    date: '13-Ago',
    dayName: 'Jueves',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 8.66, end: 9.1, hours: 2.5, timeStr: '8:40 AM - 9:05 AM', task: 'Champurrado y Caja Fuerte' },
      { start: 11.5, end: 12.0, hours: 0.5, timeStr: '11:30 AM - 12:00 PM', task: 'Arqueos' },
      { start: 17.0, end: 19.5, hours: 2.5, timeStr: '5:00 PM - 7:30 PM', task: 'MilesIQ deducción IRS' }
    ],
    totalDev: 5.50,
    modules: 'Uniformes, MilesIQ'
  },
  {
    date: '14-Ago',
    dayName: 'Viernes',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [],
    totalDev: 0.00,
    modules: 'Gerencia Operativa Lynwood'
  },
  {
    date: '15-Ago',
    dayName: 'Sábado',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 20.0, end: 21.5, hours: 2.25, timeStr: '8:00 PM - 9:30 PM', task: 'Tech Pack tabla de tallas' }
    ],
    totalDev: 2.25,
    modules: 'Tech Pack, Uniformes'
  },
  {
    date: '16-Ago',
    dayName: 'Domingo',
    scheduled: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, timeStr: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 12.5, end: 15.5, hours: 3.0, timeStr: '12:30 PM - 3:30 PM', task: 'GPS tiendas y soporte IA' },
      { start: 19.0, end: 20.75, hours: 3.0, timeStr: '7:00 PM - 8:45 PM', task: 'Simulador de millas' }
    ],
    totalDev: 6.00,
    modules: 'MilesIQ, Planificador'
  },
  {
    date: '17-Ago',
    dayName: 'Lunes',
    scheduled: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, timeStr: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 4.0, end: 5.75, hours: 2.03, timeStr: '4:00 AM - 5:45 AM', task: 'Catálogo Viele y auditoría' },
      { start: 13.16, end: 15.58, hours: 2.4, timeStr: '1:10 PM - 3:35 PM', task: 'Radar de precios proveedores' }
    ],
    totalDev: 4.43,
    modules: 'Radar Precios, QB'
  },
  {
    date: '18-Ago',
    dayName: 'Martes',
    scheduled: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, timeStr: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 15.33, end: 17.25, hours: 1.75, timeStr: '3:20 PM - 5:15 PM', task: 'Scraper API Viele v3' }
    ],
    totalDev: 1.75,
    modules: 'Radar Precios, Scraper'
  },
  {
    date: '19-Ago',
    dayName: 'Miércoles',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 9.5, end: 13.0, hours: 3.5, timeStr: '9:30 AM - 1:00 PM', task: 'Auditoría 17 bugs y seguridad' }
    ],
    totalDev: 3.50,
    modules: 'Uniformes, Radar'
  },
  {
    date: '20-Ago',
    dayName: 'Jueves',
    scheduled: 'Descanso en Tienda',
    shiftHours: 0.0,
    mgrRange: null,
    devSessions: [
      { start: 6.25, end: 7.4, hours: 1.15, timeStr: '6:15 AM - 7:25 AM', task: 'Basecamp View As y UX' },
      { start: 14.75, end: 15.66, hours: 0.9, timeStr: '2:45 PM - 3:40 PM', task: 'MilesIQ coordenadas GPS' },
      { start: 20.0, end: 21.0, hours: 1.0, timeStr: '8:00 PM - 9:00 PM', task: 'Radar rediseño ejecutivo' }
    ],
    totalDev: 3.05,
    modules: 'Basecamp, MilesIQ'
  },
  {
    date: '21-Ago',
    dayName: 'Viernes',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 5.5, end: 7.16, hours: 1.6, timeStr: '5:30 AM - 7:10 AM', task: 'Modal Basecamp 4 y MilesIQ' },
      { start: 12.25, end: 13.0, hours: 0.75, timeStr: '12:15 PM - 1:00 PM', task: 'Alertas correo directivos' },
      { start: 21.0, end: 22.41, hours: 1.4, timeStr: '9:00 PM - 10:25 PM', task: 'Descansos IA motor' }
    ],
    totalDev: 3.75,
    modules: 'Basecamp, Alertas, Descansos'
  }
];

// Generate Horizontal Gantt Rows
const ganttRowsHtml = daysData.map((d, idx) => {
  // Manager Track Bar (Green)
  let mgrBarHtml = '';
  if (d.mgrRange) {
    const leftPct = toPercent(d.mgrRange.start);
    const widthPct = ((d.mgrRange.end - d.mgrRange.start) / totalSpan) * 100;
    mgrBarHtml = `
      <div class="gantt-bar bar-mgr" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;">
          <span class="bar-label">🏪 Lynwood: ${d.mgrRange.timeStr} <strong>(${d.shiftHours.toFixed(1)}h)</strong></span>
      </div>
    `;
  } else {
    mgrBarHtml = `<div class="gantt-dayoff-badge"><span>Día Libre en Tienda</span></div>`;
  }

  // Dev Track Bars (Indigo)
  let devBarsHtml = '';
  if (d.devSessions.length > 0) {
    devBarsHtml = d.devSessions.map(seg => {
      const leftPct = toPercent(seg.start);
      let widthPct = ((seg.end - seg.start) / totalSpan) * 100;
      if (widthPct <= 0) widthPct = (seg.hours / totalSpan) * 100;
      widthPct = Math.max(widthPct, 4.0);

      return `
        <div class="gantt-bar bar-dev" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;" title="${seg.task} (${seg.hours}h)">
            <span class="bar-label">💻 Dev: ${seg.timeStr} <strong>(${seg.hours.toFixed(2)}h)</strong></span>
        </div>
      `;
    }).join('');
  } else {
    devBarsHtml = `<div class="gantt-nodev-badge"><span>—</span></div>`;
  }

  return `
    <div class="gantt-day-row ${idx % 2 === 0 ? 'even' : 'odd'}">
        <!-- Date Header Column -->
        <div class="gantt-date-col">
            <div class="gantt-date-badge">
                <span class="day-num">${d.date.split('-')[0]}</span>
                <span class="month-name">Ago</span>
            </div>
            <div class="gantt-day-details">
                <span class="day-name-str">${d.dayName}</span>
                <span class="day-modules-str">${d.modules}</span>
            </div>
        </div>

        <!-- Horizontal Timeline Canvas -->
        <div class="gantt-tracks-canvas">
            <!-- Manager Track -->
            <div class="gantt-track-lane mgr-lane">
                ${mgrBarHtml}
            </div>
            <!-- Dev Track -->
            <div class="gantt-track-lane dev-lane">
                ${devBarsHtml}
            </div>
        </div>

        <!-- Total Hours Badge -->
        <div class="gantt-total-col">
            <span class="total-dev-pill ${d.totalDev > 0 ? 'has-dev' : 'zero-dev'}">
                💻 ${d.totalDev > 0 ? `${d.totalDev.toFixed(2)}h` : '0h'}
            </span>
        </div>
    </div>
  `;
}).join('\n');

// Time markings for header ruler (every 2 hours: 4 AM to 12 AM)
const timeMarkers = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const timeRulerHtml = timeMarkers.map(h => {
  const leftPct = toPercent(h);
  const label = h === 24 || h === 0 ? '12 AM' : (h === 12 ? '12 PM' : (h > 12 ? `${h - 12} PM` : `${h} AM`));
  return `
    <div class="ruler-tick" style="left: ${leftPct.toFixed(1)}%;">
        <span class="tick-label">${label}</span>
        <div class="tick-line"></div>
    </div>
  `;
}).join('\n');

const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Línea de Tiempo Diaria (Gantt) — Carlos Velazquez</title>
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
            padding: 24px 32px;
            font-size: 12px;
            line-height: 1.4;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid #e05638;
            padding-bottom: 12px;
            margin-bottom: 18px;
        }

        .brand-title {
            font-size: 26px;
            font-weight: 900;
            color: #e05638;
            letter-spacing: -0.5px;
        }

        .brand-subtitle {
            font-size: 14px;
            font-weight: 700;
            color: #334155;
            margin-top: 2px;
        }

        .header-meta {
            text-align: right;
        }

        .header-badge {
            display: inline-block;
            background: #0f172a;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            padding: 4px 14px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .author-box {
            font-size: 12px;
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
            gap: 14px;
            margin-bottom: 20px;
        }

        .kpi-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 12px;
            padding: 14px 18px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }

        .kpi-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
        }

        .kpi-dev::before { background: #6366f1; }
        .kpi-mgr::before { background: #10b981; }
        .kpi-total::before { background: #f59e0b; }
        .kpi-ratio::before { background: #0ea5e9; }

        .kpi-val {
            font-size: 24px;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.1;
        }

        .kpi-val small {
            font-size: 13px;
            font-weight: 700;
            color: #64748b;
        }

        .kpi-title {
            font-size: 12px;
            font-weight: 800;
            color: #1e293b;
            margin-top: 3px;
        }

        .kpi-desc {
            font-size: 10.5px;
            color: #64748b;
            margin-top: 1px;
        }

        /* ═══════════════════════════════════════════════════════════════
           HORIZONTAL GANTT TIMELINE SCHEDULE (MAXIMUM CLARITY)
           ═══════════════════════════════════════════════════════════════ */
        .gantt-card {
            background: #ffffff;
            border: 1.5px solid #cbd5e1;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.08);
        }

        .gantt-top-bar {
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
            font-size: 17px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.3px;
        }

        .gantt-subtitle {
            font-size: 12.5px;
            color: #64748b;
            font-weight: 600;
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
            font-size: 12.5px;
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

        /* Ruler Header */
        .gantt-ruler-header {
            display: flex;
            align-items: center;
            height: 38px;
            background: #0f172a;
            color: #ffffff;
            border-radius: 8px 8px 0 0;
            padding: 0 16px;
            position: relative;
        }

        .ruler-title-space {
            width: 220px;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #94a3b8;
        }

        .ruler-timeline-space {
            flex: 1;
            position: relative;
            height: 100%;
        }

        .ruler-total-space {
            width: 90px;
            text-align: right;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #94a3b8;
        }

        .ruler-tick {
            position: absolute;
            top: 0;
            bottom: 0;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .tick-label {
            font-size: 10px;
            font-weight: 800;
            color: #ffffff;
        }

        .tick-line {
            display: none;
        }

        /* Gantt Body with Rows */
        .gantt-body-table {
            border: 1.5px solid #cbd5e1;
            border-top: none;
            border-radius: 0 0 12px 12px;
            overflow: hidden;
            background: #ffffff;
        }

        .gantt-day-row {
            display: flex;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid #e2e8f0;
            min-height: 64px;
            transition: background 0.15s ease;
        }

        .gantt-day-row:last-child {
            border-bottom: none;
        }

        .gantt-day-row.even { background: #ffffff; }
        .gantt-day-row.odd { background: #f8fafc; }
        .gantt-day-row:hover { background: #f1f5f9; }

        /* Left Date Column */
        .gantt-date-col {
            width: 220px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
        }

        .gantt-date-badge {
            background: #0f172a;
            color: #ffffff;
            padding: 6px 10px;
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            line-height: 1;
            min-width: 44px;
        }

        .day-num {
            font-size: 16px;
            font-weight: 900;
            letter-spacing: -0.5px;
        }

        .month-name {
            font-size: 9px;
            font-weight: 700;
            color: #94a3b8;
            text-transform: uppercase;
            margin-top: 2px;
        }

        .gantt-day-details {
            display: flex;
            flex-direction: column;
        }

        .day-name-str {
            font-size: 13px;
            font-weight: 800;
            color: #0f172a;
        }

        .day-modules-str {
            font-size: 11px;
            color: #64748b;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 150px;
        }

        /* Center Horizontal Canvas with 2 Lanes */
        .gantt-tracks-canvas {
            flex: 1;
            height: 48px;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #ffffff;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            padding: 3px 0;
            margin: 0 16px;
        }

        .gantt-track-lane {
            position: relative;
            height: 20px;
            width: 100%;
        }

        .gantt-bar {
            position: absolute;
            top: 0;
            bottom: 0;
            border-radius: 5px;
            display: flex;
            align-items: center;
            padding: 0 10px;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            z-index: 2;
        }

        .gantt-bar:hover {
            transform: scaleY(1.15);
            z-index: 10;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        }

        .bar-mgr {
            background: linear-gradient(90deg, #10b981 0%, #059669 100%);
            border: 1px solid #047857;
            color: #ffffff;
        }

        .bar-dev {
            background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%);
            border: 1px solid #4338ca;
            color: #ffffff;
        }

        .bar-label {
            font-size: 10.5px;
            font-weight: 800;
            letter-spacing: -0.2px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.6);
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .gantt-dayoff-badge, .gantt-nodev-badge {
            position: absolute;
            left: 10px;
            top: 2px;
            font-size: 10.5px;
            font-weight: 700;
            color: #94a3b8;
            font-style: italic;
        }

        /* Right Total Column */
        .gantt-total-col {
            width: 90px;
            text-align: right;
            flex-shrink: 0;
        }

        .total-dev-pill {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 900;
        }

        .total-dev-pill.has-dev {
            background: #ede9fe;
            color: #4f46e5;
            border: 1px solid #c7d2fe;
        }

        .total-dev-pill.zero-dev {
            background: #f1f5f9;
            color: #94a3b8;
            border: 1px solid #e2e8f0;
        }

        .footer {
            margin-top: 18px;
            padding-top: 10px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: #64748b;
        }
    </style>
</head>
<body>

    <div class="header">
        <div>
            <div class="brand-title">TACOS GAVILAN</div>
            <div class="brand-subtitle">Planificador Visual Diario: Franjas Reales de Gerencia Lynwood vs. Horas de Desarrollo SM TEG</div>
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
            <div class="kpi-val">67.69 <small>hrs</small></div>
            <div class="kpi-title">💻 Total Real Programado SM TEG</div>
            <div class="kpi-desc">46 sesiones registradas en el reporte mensual</div>
        </div>
        <div class="kpi-card kpi-mgr">
            <div class="kpi-val">129 <small>hrs</small></div>
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

    <!-- HORIZONTAL GANTT SCHEDULE CARD (MAXIMUM READABILITY) -->
    <div class="gantt-card">
        <div class="gantt-top-bar">
            <div>
                <div class="gantt-title">Planificador Diario de Intervalos de Tiempo (4:00 AM – 12:00 AM)</div>
                <div class="gantt-subtitle">Cada fila muestra el horario exacto del turno en la sucursal de Lynwood y las sesiones reales de programación con sus horas y entregables.</div>
            </div>
            <div class="legend-row">
                <div class="legend-item">
                    <span class="legend-box box-mgr"></span>
                    <span>🏪 Horario en Lynwood (129 hrs)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-box box-dev"></span>
                    <span>💻 Sesiones de Programación (67.69 hrs)</span>
                </div>
            </div>
        </div>

        <!-- Ruler Header -->
        <div class="gantt-ruler-header">
            <div class="ruler-title-space">Día y Módulos</div>
            <div class="ruler-timeline-space">
                ${timeRulerHtml}
            </div>
            <div class="ruler-total-space">Dev Total</div>
        </div>

        <!-- Body Rows -->
        <div class="gantt-body-table">
            ${ganttRowsHtml}
        </div>
    </div>

    <div class="footer">
        <span>Tacos Gavilan • SM TEG • Planificador Oficial de Turnos Lynwood (#14)</span>
        <span>Generado para Carlos Velazquez: 22-Ago-2026</span>
    </div>

</body>
</html>
`;

// Save HTML
const htmlPath = path.resolve('c:/Users/pedro/Desktop/teg-modernizado/reporte_linea_de_tiempo_carlos.html');
fs.writeFileSync(htmlPath, fullHtml, 'utf-8');
console.log('✅ Archivo HTML generado: ' + htmlPath);

(async () => {
    console.log('🚀 Compilando PDF Horizontal Gantt...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1600 });

    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const pdfOutPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_agosto_2026.pdf');
    const execPdfOutPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_ejecutivo.pdf');

    await page.pdf({
        path: pdfOutPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: {
            top: '0.3in',
            right: '0.3in',
            bottom: '0.3in',
            left: '0.3in'
        }
    });

    try { fs.copyFileSync(pdfOutPath, execPdfOutPath); } catch(e) {}

    // Also take screenshot
    const screenshotPath = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/horizontal_gantt_preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await browser.close();
    console.log('🎉 PDF y Screenshot guardados con éxito!');
})();
