const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const minHour = 4.0; // 4:00 AM
const maxHour = 24.0; // 12:00 AM Midnight
const totalSpan = maxHour - minHour; // 20 hours

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
      { start: 18.5, end: 21.0, hours: 4.50, timeStr: '6:30 PM - 9:00 PM', task: 'Preparador (Tramos, Live data)' }
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
      { start: 17.0, end: 18.0, hours: 1.00, timeStr: '5:00 PM - 6:00 PM', task: 'Modo básico vs avanzado y tableta' }
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
      { start: 16.75, end: 19.25, hours: 2.50, timeStr: '4:45 PM - 7:15 PM', task: 'QB Estimates y PAR semanal' },
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
      { start: 9.75, end: 19.0, hours: 9.00, timeStr: '9:45 AM - 7:00 PM', task: 'Tech Pack Uniformes, RFQ Formaryx' }
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
      { start: 12.0, end: 13.0, hours: 1.00, timeStr: '12:00 PM - 1:00 PM', task: 'Sincronización tableta-PC y DB' }
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
      { start: 13.0, end: 15.0, hours: 2.00, timeStr: '1:00 PM - 3:00 PM', task: 'Notificaciones descansos LUNCH' }
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
      { start: 13.0, end: 20.0, hours: 7.00, timeStr: '1:00 PM - 8:00 PM', task: 'Pace parrilla carnes y pantallas TV' },
      { start: 19.83, end: 20.0, hours: 0.15, timeStr: '7:50 PM - 8:00 PM', task: 'Sincronización' }
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
      { start: 14.0, end: 16.0, hours: 2.00, timeStr: '2:00 PM - 4:00 PM', task: 'Simulación intraday acelerador' }
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
      { start: 15.5, end: 17.5, hours: 2.30, timeStr: '3:30 PM - 5:30 PM', task: 'Control de prendas y arqueos' }
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
      { start: 19.33, end: 23.5, hours: 4.00, timeStr: '7:20 PM - 11:30 PM', task: 'Sincronizador continuo en día libre' }
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
      { start: 8.66, end: 9.1, hours: 2.50, timeStr: '8:40 AM - 9:05 AM', task: 'Champurrado y Caja Fuerte' },
      { start: 11.5, end: 12.0, hours: 0.50, timeStr: '11:30 AM - 12:00 PM', task: 'Arqueos' },
      { start: 17.0, end: 19.5, hours: 2.50, timeStr: '5:00 PM - 7:30 PM', task: 'MilesIQ deducción IRS' }
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
      { start: 12.5, end: 15.5, hours: 3.00, timeStr: '12:30 PM - 3:30 PM', task: 'GPS tiendas y soporte IA' },
      { start: 19.0, end: 20.75, hours: 3.00, timeStr: '7:00 PM - 8:45 PM', task: 'Simulador de millas' }
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
      { start: 13.16, end: 15.58, hours: 2.40, timeStr: '1:10 PM - 3:35 PM', task: 'Radar de precios proveedores' }
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
      { start: 9.5, end: 13.0, hours: 3.50, timeStr: '9:30 AM - 1:00 PM', task: 'Auditoría 17 bugs y seguridad' }
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
      { start: 15.25, end: 18.0, hours: 2.75, timeStr: '3:15 PM - 6:00 PM', task: 'MilesIQ 15 Tiendas y Basecamp Drawer' },
      { start: 20.66, end: 23.75, hours: 3.08, timeStr: '8:40 PM - 11:45 PM', task: 'Radar Rediseño y Auditoría 35/35' }
    ],
    totalDev: 6.98,
    modules: 'Basecamp, MilesIQ, Radar Precios'
  },
  {
    date: '21-Ago',
    dayName: 'Viernes',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 5.5, end: 7.16, hours: 1.60, timeStr: '5:30 AM - 7:10 AM', task: 'Modal Basecamp 4 y MilesIQ' },
      { start: 12.25, end: 13.0, hours: 0.75, timeStr: '12:15 PM - 1:00 PM', task: 'Alertas correo directivos' },
      { start: 21.0, end: 22.41, hours: 1.40, timeStr: '9:00 PM - 10:25 PM', task: 'Descansos IA motor' }
    ],
    totalDev: 3.75,
    modules: 'Basecamp, Alertas, Descansos'
  }
];

// Build Gantt Cards with Zero Truncation
const ganttCardsHtml = daysData.map(d => {
  // Manager Track Bar (Green)
  let mgrBarHtml = '';
  if (d.mgrRange) {
    const leftPct = toPercent(d.mgrRange.start);
    const widthPct = ((d.mgrRange.end - d.mgrRange.start) / totalSpan) * 100;
    mgrBarHtml = `
      <div class="gantt-bar bar-mgr" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;">
          <span class="bar-tag-left">${d.mgrRange.timeStr.split('-')[0].trim()}</span>
          <span class="bar-center-text">🏪 Turno Lynwood: <strong>${d.shiftHours.toFixed(1)} hrs</strong></span>
          <span class="bar-tag-right">${d.mgrRange.timeStr.split('-')[1].trim()}</span>
      </div>
    `;
  } else {
    mgrBarHtml = `<div class="day-off-tag">🏖️ <strong>Día Libre en Tienda</strong> (Descanso Oficial en Rol de Turnos)</div>`;
  }

  // Dev Track Bars (Indigo)
  let devBarsHtml = '';
  if (d.devSessions.length > 0) {
    devBarsHtml = d.devSessions.map(seg => {
      const leftPct = toPercent(seg.start);
      let widthPct = ((seg.end - seg.start) / totalSpan) * 100;
      if (widthPct <= 0) widthPct = (seg.hours / totalSpan) * 100;
      widthPct = Math.max(widthPct, 4.0);

      const isWide = widthPct >= 18.0;

      return `
        <div class="gantt-bar bar-dev" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;" title="${seg.task} (${seg.timeStr} • ${seg.hours}h)">
            <span class="bar-center-text">
                💻 ${isWide ? `<strong>${seg.hours.toFixed(1)}h</strong> • ${seg.timeStr}` : `<strong>${seg.hours.toFixed(1)}h</strong>`}
            </span>
        </div>
      `;
    }).join('');
  } else {
    devBarsHtml = `<div class="no-dev-tag"><em>Sin sesiones de desarrollo registradas</em></div>`;
  }

  // Formatted Sessions List for Footer
  const sessionsDetailHtml = d.devSessions.map(s => `
    <span class="session-badge">
        <span class="dot-indigo"></span> <strong>${s.timeStr}</strong> (${s.hours.toFixed(2)}h) • <span class="task-desc">${s.task}</span>
    </span>
  `).join(' ');

  return `
    <div class="gantt-day-card ${d.mgrRange ? 'has-shift' : 'store-day-off'}">
        <div class="gantt-card-header">
            <div class="day-date-group">
                <span class="date-badge">${d.date.split('-')[0]} Ago</span>
                <span class="day-name-label">${d.dayName}</span>
            </div>
            <div class="day-info-pills">
                <span class="info-pill pill-shift">
                    ${d.mgrRange ? `🏪 Turno Tienda: <strong>${d.scheduled} (${d.shiftHours.toFixed(1)}h)</strong>` : '🏖️ <strong>Día Libre en Tienda</strong>'}
                </span>
                <span class="info-pill pill-dev ${d.totalDev > 0 ? 'active' : ''}">
                    💻 Dev TEG: <strong>${d.totalDev > 0 ? `${d.totalDev.toFixed(2)} hrs` : '0h'}</strong>
                </span>
            </div>
        </div>

        <div class="gantt-lanes-box">
            <!-- Manager Lane -->
            <div class="lane-wrapper">
                <div class="lane-label">🏪 TIENDA</div>
                <div class="lane-track mgr-lane">
                    ${mgrBarHtml}
                </div>
            </div>
            <!-- Dev Lane -->
            <div class="lane-wrapper">
                <div class="lane-label">💻 SISTEMA</div>
                <div class="lane-track dev-lane">
                    ${devBarsHtml}
                </div>
            </div>
        </div>

        <div class="gantt-card-footer">
            ${d.devSessions.length > 0 ? `
            <div class="sessions-breakdown">
                <span class="sessions-title">⏱️ Sesiones Reales:</span>
                ${sessionsDetailHtml}
            </div>` : ''}
        </div>
    </div>
  `;
}).join('\n');

// Time markers for ruler (every 2 hours: 4 AM to 12 AM)
const timeMarkers = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const timeRulerHtml = timeMarkers.map(h => {
  const leftPct = toPercent(h);
  const label = h === 24 || h === 0 ? '12 AM' : (h === 12 ? '12 PM' : (h > 12 ? `${h - 12} PM` : `${h} AM`));
  return `
    <div class="ruler-tick" style="left: ${leftPct.toFixed(1)}%;">
        <span class="tick-label">${label}</span>
    </div>
  `;
}).join('\n');

const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Planificador Diario de Turnos y Desarrollo — Carlos Velazquez</title>
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
            background: #f8fafc;
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
            background: #ffffff;
            padding: 18px 24px;
            border-radius: 14px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
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
           PLANIFICADOR DIARIO EN TARJETAS (MÁXIMA LEGIBILIDAD)
           ═══════════════════════════════════════════════════════════════ */
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

        /* Sticky Time Ruler */
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

        /* Days Grid */
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

        /* 2 Lanes Inside Each Day */
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

        /* Sessions Breakdown in Footer */
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

        .footer {
            margin-top: 24px;
            padding-top: 12px;
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
            <div class="brand-subtitle">Planificador Visual Diario: Franjas Reales de Gerencia Lynwood (#14) vs. Sesiones de Desarrollo SM TEG</div>
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
            <div class="kpi-val">71.62 <small>hrs</small></div>
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
            <div class="kpi-desc">12-Ago (4.33h) y 20-Ago (6.98h)</div>
        </div>
    </div>

    <!-- GANTT SCHEDULE CONTAINER -->
    <div class="gantt-container">
        <div class="gantt-header-block">
            <div>
                <div class="gantt-title">Planificador Diario de Horarios e Intervalos de Tiempo (4:00 AM – 12:00 AM)</div>
                <div class="gantt-subtitle">Cada tarjeta muestra las horas exactas en la tienda y las franjas de programación con sus entregables y módulos.</div>
            </div>
            <div class="legend-row">
                <div class="legend-item">
                    <span class="legend-box box-mgr"></span>
                    <span>🏪 Horario en Lynwood (129 hrs)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-box box-dev"></span>
                    <span>💻 Sesiones de Programación (71.62 hrs)</span>
                </div>
            </div>
        </div>

        <!-- Sticky Time Ruler on Top -->
        <div class="sticky-ruler">
            <div class="ruler-canvas">
                ${timeRulerHtml}
            </div>
        </div>

        <!-- Days Grid -->
        <div class="days-grid">
            ${ganttCardsHtml}
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
console.log('✅ Archivo HTML generado con máxima claridad: ' + htmlPath);

(async () => {
    console.log('🚀 Compilando PDF y Captura de Pantalla...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1800 });

    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const pdfOutPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_agosto_2026.pdf');
    const execPdfOutPath = path.resolve('c:/Users/pedro/Desktop/distribucion_jornada_carlos_velazquez_ejecutivo.pdf');

    await page.pdf({
        path: pdfOutPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.85,
        margin: {
            top: '0.3in',
            right: '0.3in',
            bottom: '0.3in',
            left: '0.3in'
        }
    });

    try { fs.copyFileSync(pdfOutPath, execPdfOutPath); } catch(e) {}

    // Take high-res screenshot
    const screenshotPath = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/horizontal_gantt_preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await browser.close();
    console.log('🎉 PDF y Screenshot regenerados con éxito!');
})();
