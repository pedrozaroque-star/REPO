const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const minHour = 5.0; // 5:00 AM
const maxHour = 23.5; // 11:30 PM
const totalHourSpan = maxHour - minHour; // 18.5 hours span

function hourToPercent(h) {
  return ((h - minHour) / totalHourSpan) * 100;
}

const daysTimelineData = [
  {
    date: '01-Ago',
    dayName: 'Sáb',
    fullDate: '01-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7.0h)',
    mgrSegments: [{ start: 14.0, end: 21.0, labelStart: '2:00 PM', labelEnd: '9:00 PM', hours: 7.0 }],
    devSegments: [{ start: 18.5, end: 21.0, labelStart: '6:30 PM', labelEnd: '9:00 PM', hours: 4.5 }],
    modules: 'Preparador (Tramos, Live data), Soporte IA',
    note: 'Proyecciones por tramos y live data'
  },
  {
    date: '02-Ago',
    dayName: 'Dom',
    fullDate: '02-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM (5.0h)',
    mgrSegments: [{ start: 14.0, end: 19.0, labelStart: '2:00 PM', labelEnd: '7:00 PM', hours: 5.0 }],
    devSegments: [{ start: 17.0, end: 18.0, labelStart: '5:00 PM', labelEnd: '6:00 PM', hours: 1.0 }],
    modules: 'Preparador (Básico vs Avanzado)',
    note: 'Modo básico vs avanzado y tableta'
  },
  {
    date: '03-Ago',
    dayName: 'Lun',
    fullDate: '03-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM (8.0h)',
    mgrSegments: [{ start: 12.0, end: 20.0, labelStart: '12:00 PM', labelEnd: '8:00 PM', hours: 8.0 }],
    devSegments: [{ start: 16.75, end: 20.0, labelStart: '4:45 PM', labelEnd: '8:00 PM', hours: 3.25 }],
    modules: 'Inventario (QB Estimates), Tech Pack',
    note: 'QB Estimates y PAR semanal'
  },
  {
    date: '04-Ago',
    dayName: 'Mar',
    fullDate: '04-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM (8.0h)',
    mgrSegments: [{ start: 14.0, end: 22.0, labelStart: '2:00 PM', labelEnd: '10:00 PM', hours: 8.0 }],
    devSegments: [{ start: 18.5, end: 22.0, labelStart: '6:30 PM', labelEnd: '10:00 PM', hours: 3.5 }],
    modules: 'Tech Pack Uniformes, RFQ Formaryx',
    note: 'Ficha técnica fabricante y cotizaciones'
  },
  {
    date: '06-Ago',
    dayName: 'Jue',
    fullDate: '06-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM (8.0h)',
    mgrSegments: [{ start: 9.0, end: 17.0, labelStart: '9:00 AM', labelEnd: '5:00 PM', hours: 8.0 }],
    devSegments: [{ start: 14.75, end: 15.75, labelStart: '2:45 PM', labelEnd: '3:45 PM', hours: 1.0 }],
    modules: 'Preparador (Sync Tableta-PC, DB)',
    note: 'Sincronización tableta-PC y tabla DB'
  },
  {
    date: '07-Ago',
    dayName: 'Vie',
    fullDate: '07-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7.0h)',
    mgrSegments: [{ start: 14.0, end: 21.0, labelStart: '2:00 PM', labelEnd: '9:00 PM', hours: 7.0 }],
    devSegments: [{ start: 13.75, end: 15.75, labelStart: '1:45 PM', labelEnd: '3:45 PM', hours: 2.0 }],
    modules: 'Horarios (Violaciones breaks LUNCH)',
    note: 'Notificaciones automáticas descansos'
  },
  {
    date: '08-Ago',
    dayName: 'Sáb',
    fullDate: '08-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7.0h)',
    mgrSegments: [{ start: 14.0, end: 21.0, labelStart: '2:00 PM', labelEnd: '9:00 PM', hours: 7.0 }],
    devSegments: [{ start: 18.0, end: 20.5, labelStart: '6:00 PM', labelEnd: '8:30 PM', hours: 3.5 }],
    modules: 'Preparador (Pace parrilla), Menú TVs',
    note: 'Pace parrilla carnes y pantallas TV'
  },
  {
    date: '09-Ago',
    dayName: 'Dom',
    fullDate: '09-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM (5.0h)',
    mgrSegments: [{ start: 14.0, end: 19.0, labelStart: '2:00 PM', labelEnd: '7:00 PM', hours: 5.0 }],
    devSegments: [{ start: 17.5, end: 19.0, labelStart: '5:30 PM', labelEnd: '7:00 PM', hours: 2.0 }],
    modules: 'Preparador (Simulación acelerador)',
    note: 'Simulación intraday acelerador'
  },
  {
    date: '10-Ago',
    dayName: 'Lun',
    fullDate: '10-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM (8.0h)',
    mgrSegments: [{ start: 12.0, end: 20.0, labelStart: '12:00 PM', labelEnd: '8:00 PM', hours: 8.0 }],
    devSegments: [{ start: 16.5, end: 18.83, labelStart: '4:30 PM', labelEnd: '6:50 PM', hours: 2.3 }],
    modules: 'Control de Uniformes (Recepción, Arqueos)',
    note: 'Control de prendas y arqueos'
  },
  {
    date: '11-Ago',
    dayName: 'Mar',
    fullDate: '11-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM (8.0h)',
    mgrSegments: [{ start: 14.0, end: 22.0, labelStart: '2:00 PM', labelEnd: '10:00 PM', hours: 8.0 }],
    devSegments: [{ start: 19.75, end: 20.75, labelStart: '7:45 PM', labelEnd: '8:45 PM', hours: 0.93 }],
    modules: 'Inventario (Catálogos y mapeo bodega)',
    note: 'Catálogos y mapeo de bodegas'
  },
  {
    date: '12-Ago',
    dayName: 'Mié',
    fullDate: '12-Ago-2026',
    scheduledStr: 'Descanso en Tienda',
    mgrSegments: [],
    devSegments: [{ start: 11.25, end: 15.5, labelStart: '11:15 AM', labelEnd: '3:30 PM', hours: 4.33 }],
    modules: 'Basecamp 3 API & Sincronizador',
    note: 'Integración API Basecamp en día libre'
  },
  {
    date: '13-Ago',
    dayName: 'Jue',
    fullDate: '13-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM (8.0h)',
    mgrSegments: [{ start: 9.0, end: 17.0, labelStart: '9:00 AM', labelEnd: '5:00 PM', hours: 8.0 }],
    devSegments: [
      { start: 9.0, end: 9.75, labelStart: '9:00 AM', labelEnd: '9:45 AM', hours: 0.75 },
      { start: 17.75, end: 19.5, labelStart: '5:45 PM', labelEnd: '7:30 PM', hours: 4.75 }
    ],
    modules: 'Champurrado, Caja Fuerte, MilesIQ',
    note: 'Champurrado, Caja Fuerte y MilesIQ'
  },
  {
    date: '14-Ago',
    dayName: 'Vie',
    fullDate: '14-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7.0h)',
    mgrSegments: [{ start: 14.0, end: 21.0, labelStart: '2:00 PM', labelEnd: '9:00 PM', hours: 7.0 }],
    devSegments: [],
    modules: 'Gerencia Operativa en Lynwood',
    note: '100% Supervisión en restaurante'
  },
  {
    date: '15-Ago',
    dayName: 'Sáb',
    fullDate: '15-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7.0h)',
    mgrSegments: [{ start: 14.0, end: 21.0, labelStart: '2:00 PM', labelEnd: '9:00 PM', hours: 7.0 }],
    devSegments: [{ start: 18.75, end: 21.0, labelStart: '6:45 PM', labelEnd: '9:00 PM', hours: 2.25 }],
    modules: 'Tech Pack Uniformes (Specs Fabricante)',
    note: 'Especificaciones de fabricante'
  },
  {
    date: '16-Ago',
    dayName: 'Dom',
    fullDate: '16-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM (5.0h)',
    mgrSegments: [{ start: 14.0, end: 19.0, labelStart: '2:00 PM', labelEnd: '7:00 PM', hours: 5.0 }],
    devSegments: [{ start: 12.75, end: 16.75, labelStart: '12:45 PM', labelEnd: '4:45 PM', hours: 3.0 }],
    modules: 'MilesIQ GPS tiendas, Planificador',
    note: 'GPS tiendas y soporte IA'
  },
  {
    date: '17-Ago',
    dayName: 'Lun',
    fullDate: '17-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM (8.0h)',
    mgrSegments: [{ start: 12.0, end: 20.0, labelStart: '12:00 PM', labelEnd: '8:00 PM', hours: 8.0 }],
    devSegments: [
      { start: 5.25, end: 6.0, labelStart: '5:15 AM', labelEnd: '6:00 AM', hours: 0.75 },
      { start: 15.66, end: 19.33, labelStart: '3:40 PM', labelEnd: '7:20 PM', hours: 3.68 }
    ],
    modules: 'Radar Precios Viele & Sons, QB',
    note: 'Auditoría laboral y catálogo Viele'
  },
  {
    date: '18-Ago',
    dayName: 'Mar',
    fullDate: '18-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM (8.0h)',
    mgrSegments: [{ start: 14.0, end: 22.0, labelStart: '2:00 PM', labelEnd: '10:00 PM', hours: 8.0 }],
    devSegments: [{ start: 13.25, end: 16.0, labelStart: '1:15 PM', labelEnd: '4:00 PM', hours: 1.75 }],
    modules: 'Radar Precios, Scraper API Viele v3',
    note: 'Scraper API Viele v3 y precios'
  },
  {
    date: '19-Ago',
    dayName: 'Mié',
    fullDate: '19-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM (8.0h)',
    mgrSegments: [{ start: 9.0, end: 17.0, labelStart: '9:00 AM', labelEnd: '5:00 PM', hours: 8.0 }],
    devSegments: [{ start: 13.0, end: 16.5, labelStart: '1:00 PM', labelEnd: '4:30 PM', hours: 3.5 }],
    modules: 'Uniformes (17 bugs), Radar, Roles',
    note: 'Auditoría 17 bugs y seguridad'
  },
  {
    date: '20-Ago',
    dayName: 'Jue',
    fullDate: '20-Ago-2026',
    scheduledStr: 'Descanso en Tienda',
    mgrSegments: [],
    devSegments: [
      { start: 6.25, end: 7.4, labelStart: '6:15 AM', labelEnd: '7:25 AM', hours: 1.15 },
      { start: 14.75, end: 15.66, labelStart: '2:45 PM', labelEnd: '3:40 PM', hours: 0.90 },
      { start: 20.0, end: 21.0, labelStart: '8:00 PM', labelEnd: '9:00 PM', hours: 1.00 }
    ],
    modules: 'Basecamp View As, MilesIQ, Radar',
    note: 'Rediseño radar y coordenadas en día libre'
  },
  {
    date: '21-Ago',
    dayName: 'Vie',
    fullDate: '21-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7.0h)',
    mgrSegments: [{ start: 14.0, end: 21.0, labelStart: '2:00 PM', labelEnd: '9:00 PM', hours: 7.0 }],
    devSegments: [
      { start: 5.5, end: 7.15, labelStart: '5:30 AM', labelEnd: '7:10 AM', hours: 1.1 },
      { start: 12.25, end: 13.0, labelStart: '12:15 PM', labelEnd: '1:00 PM', hours: 0.75 },
      { start: 21.0, end: 21.75, labelStart: '9:00 PM', labelEnd: '9:45 PM', hours: 0.75 }
    ],
    modules: 'Basecamp 4 Modal, Alertas, Descansos AI',
    note: 'Carga bajo demanda y PDF'
  }
];

function formatTimeClean(h) {
  const hInt = Math.floor(h);
  const min = Math.round((h - hInt) * 60);
  const period = hInt >= 12 ? 'p' : 'a';
  const displayH = hInt > 12 ? hInt - 12 : (hInt === 0 ? 12 : hInt);
  if (min === 0) return `${displayH}${period}`;
  return `${displayH}:${min < 10 ? '0' : ''}${min}${period}`;
}

const totalDev = daysTimelineData.reduce((acc, d) => acc + d.devSegments.reduce((a, b) => a + b.hours, 0), 0);
const totalMgr = daysTimelineData.reduce((acc, d) => acc + (d.mgrSegments.length > 0 ? (d.mgrSegments[0].hours - d.devSegments.reduce((a, b) => a + b.hours, 0)) : 0), 0);
const totalCombined = totalDev + totalMgr;
const totalScheduledHours = daysTimelineData.reduce((acc, d) => acc + (d.mgrSegments.length > 0 ? d.mgrSegments[0].hours : 0), 0);

// Generate Time Grid Lines (every 2 hours from 6 AM to 10 PM)
const hoursMarkings = [6, 8, 10, 12, 14, 16, 18, 20, 22];
const yAxisLabelsHtml = hoursMarkings.map(h => {
  const pct = hourToPercent(h);
  const label = h === 12 ? '12 PM' : (h > 12 ? `${h - 12} PM` : `${h} AM`);
  return `<span class="y-label" style="bottom: ${pct}%;">${label}</span>`;
}).join('\n');

const gridLinesHtml = hoursMarkings.map(h => {
  const pct = hourToPercent(h);
  return `<div class="timeline-grid-line" style="bottom: ${pct}%;"></div>`;
}).join('\n');

// Generate Day Columns HTML with Ultra-Clean In-Bar Caps
const timelineColumnsHtml = daysTimelineData.map((d, idx) => {
  const dayShort = d.date.split('-')[0];

  // Render Manager Floating Bars (Green)
  const mgrBars = d.mgrSegments.map(seg => {
    const bottomPct = hourToPercent(seg.start);
    const heightPct = ((seg.end - seg.start) / totalHourSpan) * 100;
    const startTxt = formatTimeClean(seg.start);
    const endTxt = formatTimeClean(seg.end);
    return `
      <div class="interval-bar bar-mgr" style="bottom: ${bottomPct.toFixed(1)}%; height: ${heightPct.toFixed(1)}%;">
          <div class="bar-edge-cap cap-top">${endTxt}</div>
          <div class="bar-core-info">
              <span class="core-icon">🏪</span>
              <span class="core-hours">${seg.hours.toFixed(1)}h</span>
          </div>
          <div class="bar-edge-cap cap-bottom">${startTxt}</div>
      </div>
    `;
  }).join('');

  // Render Dev Floating Bars (Indigo)
  const devBars = d.devSegments.map(seg => {
    const bottomPct = hourToPercent(seg.start);
    const heightPct = ((seg.end - seg.start) / totalHourSpan) * 100;
    const startTxt = formatTimeClean(seg.start);
    const endTxt = formatTimeClean(seg.end);
    const isSmall = heightPct < 8.5;
    return `
      <div class="interval-bar bar-dev" style="bottom: ${bottomPct.toFixed(1)}%; height: ${heightPct.toFixed(1)}%;">
          <div class="bar-edge-cap cap-top">${endTxt}</div>
          <div class="bar-core-info ${isSmall ? 'compact' : ''}">
              <span class="core-icon">💻</span>
              <span class="core-hours">${seg.hours.toFixed(1)}h</span>
          </div>
          <div class="bar-edge-cap cap-bottom">${startTxt}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="timeline-col" data-day="${d.date}">
        <!-- Day Track Area -->
        <div class="day-track-canvas">
            <!-- Left Sub-Track: Gerencia Lynwood -->
            <div class="sub-track mgr-subtrack">
                ${mgrBars.length > 0 ? mgrBars : '<div class="day-off-tag"><span>Descanso</span></div>'}
            </div>
            <!-- Right Sub-Track: Desarrollo SM TEG -->
            <div class="sub-track dev-subtrack">
                ${devBars.length > 0 ? devBars : '<div class="no-dev-tag"><span>—</span></div>'}
            </div>
        </div>

        <!-- Day Footer -->
        <div class="timeline-col-footer">
            <span class="col-date">${dayShort}</span>
            <span class="col-weekday">${d.dayName}</span>
        </div>
    </div>
  `;
}).join('\n');

const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Línea de Tiempo de Jornada Laboral — Carlos Velazquez</title>
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
            font-size: 20px;
            font-weight: 900;
            color: #0f172a;
            line-height: 1.1;
        }

        .kpi-val small {
            font-size: 11.5px;
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

        /* ═══════════════════════════════════════════════════════════════
           VERTICAL TIMELINE / GANTT SCHEDULE CHART
           ═══════════════════════════════════════════════════════════════ */
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

        /* Timeline Main Body */
        .timeline-body {
            display: flex;
            height: 370px;
            background: #fafafa;
            border: 1.5px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px 16px 26px 8px;
            position: relative;
            gap: 8px;
        }

        /* Y-Axis (Time from 5am to 11pm) */
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

        /* Viewport with Grid Lines & Day Columns */
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

        /* Individual Day Column */
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

        /* Floating Interval Bars (Crisp & Clean) */
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
            background: rgba(15, 23, 42, 0.82);
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

        /* Summary Table */
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
            <div class="brand-subtitle">Línea de Tiempo de Turnos en Lynwood vs. Franjas Horarias de Desarrollo del Sistema</div>
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
            <div class="kpi-val">${totalDev.toFixed(1)} <small>hrs</small></div>
            <div class="kpi-title">💻 Desarrollo Sistema SM TEG</div>
            <div class="kpi-desc">Franjas de programación y arquitectura</div>
        </div>
        <div class="kpi-card kpi-mgr">
            <div class="kpi-val">${totalMgr.toFixed(1)} <small>hrs</small></div>
            <div class="kpi-title">🏪 Gerencia Operativa Lynwood</div>
            <div class="kpi-desc">Franjas de piso y supervisión en tienda</div>
        </div>
        <div class="kpi-card kpi-total">
            <div class="kpi-val">${totalCombined.toFixed(1)} <small>hrs</small></div>
            <div class="kpi-title">⏱️ Jornada Total Combinada</div>
            <div class="kpi-desc">20 días activos registrados en Agosto</div>
        </div>
        <div class="kpi-card kpi-ratio">
            <div class="kpi-val">${totalScheduledHours.toFixed(0)} <small>hrs</small></div>
            <div class="kpi-title">📅 Horas Planificador Lynwood</div>
            <div class="kpi-desc">18 turnos programados en sucursal</div>
        </div>
    </div>

    <!-- TIMELINE SCHEDULE CHART (CLARA, FLOTANTE, IDENTICA AL BOSQUEJO DE CARLOS) -->
    <div class="timeline-card">
        <div class="timeline-header">
            <div>
                <div class="timeline-title">Línea de Tiempo Diaria: Franjas de Gerencia vs. Franjas de Desarrollo</div>
                <div class="timeline-subtitle">Visualización de intervalos reales que refleja turnos en tienda, horas de programación y solapamientos productivos.</div>
            </div>
            <div class="legend-row">
                <div class="legend-item">
                    <span class="legend-box box-mgr"></span>
                    <span>🏪 Gerencia Lynwood (Horario en Tienda)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-box box-dev"></span>
                    <span>💻 Desarrollo SM TEG (Horas de Sistema)</span>
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
                    <th style="width: 17%; text-align: center;">🏪 Planificador Lynwood</th>
                    <th style="width: 22%; text-align: center;">💻 Franja Exacta de Desarrollo</th>
                    <th style="width: 9%; text-align: center;">⏱️ Dev (hrs)</th>
                    <th style="width: 43%;">Módulos y Entregables Clave</th>
                </tr>
            </thead>
            <tbody>
                ${daysTimelineData.map(d => {
                  const devHrs = d.devSegments.reduce((a, b) => a + b.hours, 0);
                  const devRangesStr = d.devSegments.map(s => `${s.labelStart} - ${s.labelEnd}`).join(', ') || '—';
                  return `
                    <tr>
                        <td><strong>${d.date}</strong> <small style="color:#64748b;">${d.dayName}</small></td>
                        <td style="text-align: center;"><span class="badge-shift">${d.scheduledStr}</span></td>
                        <td style="text-align: center;"><span class="badge-dev-range">${devRangesStr}</span></td>
                        <td style="text-align: center; font-weight: 800; color: #4f46e5;">${devHrs > 0 ? `${devHrs.toFixed(2)}h` : '—'}</td>
                        <td><strong>${d.modules}</strong> <small style="color:#64748b;">(${d.note})</small></td>
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
fs.writeFileSync(htmlOutPath, fullHtml, 'utf-8');
console.log('✅ Archivo HTML generado: ' + htmlOutPath);

(async () => {
    console.log('🚀 Compilando PDF de Línea de Tiempo...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1350, height: 950 });

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
        scale: 0.90,
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
    console.log('🎉 PDF de Línea de Tiempo regenerado en Desktop: ' + pdfOutPath);
})();
