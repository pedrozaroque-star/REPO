const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Days data with exact time ranges for Timeline / Gantt visualization
// Day hours range: 6:00 AM (06:00 = 6.0) to 11:00 PM (23:00 = 23.0) -> Total 17 hours span
const minHour = 6.0;
const maxHour = 23.0;
const totalHourSpan = maxHour - minHour; // 17 hours

function hourToPercent(h) {
  return ((h - minHour) / totalHourSpan) * 100;
}

const daysTimelineData = [
  {
    date: '01-Ago',
    dayName: 'Sáb',
    fullDate: '01-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7h)',
    mgrSegments: [{ start: 14.0, end: 21.0, label: '2pm - 9pm', hours: 7.0 }],
    devSegments: [{ start: 18.5, end: 21.0, label: '6:30pm - 9pm', hours: 4.5 }],
    modules: 'Preparador (Tramos, Live data), Soporte IA',
    note: 'Proyecciones por tramos y live data'
  },
  {
    date: '02-Ago',
    dayName: 'Dom',
    fullDate: '02-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM (5h)',
    mgrSegments: [{ start: 14.0, end: 19.0, label: '2pm - 7pm', hours: 5.0 }],
    devSegments: [{ start: 17.0, end: 18.0, label: '5pm - 6pm', hours: 1.0 }],
    modules: 'Preparador (Básico vs Avanzado)',
    note: 'Modo básico vs avanzado y tableta'
  },
  {
    date: '03-Ago',
    dayName: 'Lun',
    fullDate: '03-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM (8h)',
    mgrSegments: [{ start: 12.0, end: 20.0, label: '12pm - 8pm', hours: 8.0 }],
    devSegments: [{ start: 16.75, end: 20.0, label: '4:45pm - 8pm', hours: 3.25 }],
    modules: 'Inventario (QB Estimates), Tech Pack',
    note: 'QB Estimates y PAR semanal'
  },
  {
    date: '04-Ago',
    dayName: 'Mar',
    fullDate: '04-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM (8h)',
    mgrSegments: [{ start: 14.0, end: 22.0, label: '2pm - 10pm', hours: 8.0 }],
    devSegments: [{ start: 18.5, end: 22.0, label: '6:30pm - 10pm', hours: 3.5 }],
    modules: 'Tech Pack Uniformes, RFQ Formaryx',
    note: 'Ficha técnica fabricante y cotizaciones'
  },
  {
    date: '06-Ago',
    dayName: 'Jue',
    fullDate: '06-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM (8h)',
    mgrSegments: [{ start: 9.0, end: 17.0, label: '9am - 5pm', hours: 8.0 }],
    devSegments: [{ start: 14.75, end: 15.75, label: '2:45pm - 3:45pm', hours: 1.0 }],
    modules: 'Preparador (Sync Tableta-PC, DB)',
    note: 'Sincronización tableta-PC y tabla DB'
  },
  {
    date: '07-Ago',
    dayName: 'Vie',
    fullDate: '07-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7h)',
    mgrSegments: [{ start: 14.0, end: 21.0, label: '2pm - 9pm', hours: 7.0 }],
    devSegments: [{ start: 13.75, end: 15.75, label: '1:45pm - 3:45pm', hours: 2.0 }],
    modules: 'Horarios (Violaciones breaks LUNCH)',
    note: 'Notificaciones automáticas descansos'
  },
  {
    date: '08-Ago',
    dayName: 'Sáb',
    fullDate: '08-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7h)',
    mgrSegments: [{ start: 14.0, end: 21.0, label: '2pm - 9pm', hours: 7.0 }],
    devSegments: [{ start: 18.0, end: 20.5, label: '6pm - 8:30pm', hours: 3.5 }],
    modules: 'Preparador (Pace parrilla), Menú TVs',
    note: 'Pace parrilla carnes y pantallas TV'
  },
  {
    date: '09-Ago',
    dayName: 'Dom',
    fullDate: '09-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM (5h)',
    mgrSegments: [{ start: 14.0, end: 19.0, label: '2pm - 7pm', hours: 5.0 }],
    devSegments: [{ start: 17.5, end: 19.0, label: '5:30pm - 7pm', hours: 2.0 }],
    modules: 'Preparador (Simulación acelerador)',
    note: 'Simulación intraday acelerador'
  },
  {
    date: '10-Ago',
    dayName: 'Lun',
    fullDate: '10-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM (8h)',
    mgrSegments: [{ start: 12.0, end: 20.0, label: '12pm - 8pm', hours: 8.0 }],
    devSegments: [{ start: 16.5, end: 18.83, label: '4:30pm - 6:50pm', hours: 2.3 }],
    modules: 'Control de Uniformes (Recepción, Arqueos)',
    note: 'Control de prendas y arqueos'
  },
  {
    date: '11-Ago',
    dayName: 'Mar',
    fullDate: '11-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM (8h)',
    mgrSegments: [{ start: 14.0, end: 22.0, label: '2pm - 10pm', hours: 8.0 }],
    devSegments: [{ start: 19.75, end: 20.75, label: '7:45pm - 8:45pm', hours: 0.93 }],
    modules: 'Inventario (Catálogos y mapeo bodega)',
    note: 'Catálogos y mapeo de bodegas'
  },
  {
    date: '12-Ago',
    dayName: 'Mié',
    fullDate: '12-Ago-2026',
    scheduledStr: 'Descanso en Tienda',
    mgrSegments: [],
    devSegments: [{ start: 11.25, end: 15.5, label: '11:15am - 3:30pm', hours: 4.33 }],
    modules: 'Basecamp 3 API & Sincronizador',
    note: 'Integración API Basecamp en día libre'
  },
  {
    date: '13-Ago',
    dayName: 'Jue',
    fullDate: '13-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM (8h)',
    mgrSegments: [{ start: 9.0, end: 17.0, label: '9am - 5pm', hours: 8.0 }],
    devSegments: [
      { start: 9.0, end: 9.75, label: '9am - 9:45am', hours: 0.75 },
      { start: 17.75, end: 19.5, label: '5:45pm - 7:30pm', hours: 4.75 }
    ],
    modules: 'Champurrado, Caja Fuerte, MilesIQ',
    note: 'Champurrado, Caja Fuerte y MilesIQ'
  },
  {
    date: '14-Ago',
    dayName: 'Vie',
    fullDate: '14-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7h)',
    mgrSegments: [{ start: 14.0, end: 21.0, label: '2pm - 9pm', hours: 7.0 }],
    devSegments: [],
    modules: 'Gerencia Operativa en Lynwood',
    note: '100% Supervisión en restaurante'
  },
  {
    date: '15-Ago',
    dayName: 'Sáb',
    fullDate: '15-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7h)',
    mgrSegments: [{ start: 14.0, end: 21.0, label: '2pm - 9pm', hours: 7.0 }],
    devSegments: [{ start: 18.75, end: 21.0, label: '6:45pm - 9pm', hours: 2.25 }],
    modules: 'Tech Pack Uniformes (Specs Fabricante)',
    note: 'Especificaciones de fabricante'
  },
  {
    date: '16-Ago',
    dayName: 'Dom',
    fullDate: '16-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM (5h)',
    mgrSegments: [{ start: 14.0, end: 19.0, label: '2pm - 7pm', hours: 5.0 }],
    devSegments: [{ start: 12.75, end: 16.75, label: '12:45pm - 4:45pm', hours: 3.0 }],
    modules: 'MilesIQ GPS tiendas, Planificador',
    note: 'GPS tiendas y soporte IA'
  },
  {
    date: '17-Ago',
    dayName: 'Lun',
    fullDate: '17-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM (8h)',
    mgrSegments: [{ start: 12.0, end: 20.0, label: '12pm - 8pm', hours: 8.0 }],
    devSegments: [
      { start: 6.0, end: 6.75, label: '5:15am - 6am', hours: 0.75 },
      { start: 15.66, end: 19.33, label: '3:40pm - 7:20pm', hours: 3.68 }
    ],
    modules: 'Radar Precios Viele & Sons, QB',
    note: 'Auditoría laboral y catálogo Viele'
  },
  {
    date: '18-Ago',
    dayName: 'Mar',
    fullDate: '18-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM (8h)',
    mgrSegments: [{ start: 14.0, end: 22.0, label: '2pm - 10pm', hours: 8.0 }],
    devSegments: [{ start: 13.25, end: 16.0, label: '1:15pm - 4pm', hours: 1.75 }],
    modules: 'Radar Precios, Scraper API Viele v3',
    note: 'Scraper API Viele v3 y precios'
  },
  {
    date: '19-Ago',
    dayName: 'Mié',
    fullDate: '19-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM (8h)',
    mgrSegments: [{ start: 9.0, end: 17.0, label: '9am - 5pm', hours: 8.0 }],
    devSegments: [{ start: 13.0, end: 16.5, label: '1pm - 4:30pm', hours: 3.5 }],
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
      { start: 6.25, end: 7.4, label: '6:15am - 7:25am', hours: 1.15 },
      { start: 14.75, end: 15.66, label: '2:45pm - 3:40pm', hours: 0.90 },
      { start: 20.0, end: 21.0, label: '8pm - 9pm', hours: 1.00 }
    ],
    modules: 'Basecamp View As, MilesIQ, Radar',
    note: 'Rediseño radar y coordenadas en día libre'
  },
  {
    date: '21-Ago',
    dayName: 'Vie',
    fullDate: '21-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM (7h)',
    mgrSegments: [{ start: 14.0, end: 21.0, label: '2pm - 9pm', hours: 7.0 }],
    devSegments: [
      { start: 6.0, end: 7.15, label: '5:30am - 7:10am', hours: 1.1 },
      { start: 12.25, end: 13.0, label: '12:15pm - 1pm', hours: 0.75 },
      { start: 21.0, end: 21.75, label: '9pm - 9:45pm', hours: 0.75 }
    ],
    modules: 'Basecamp 4 Modal, Alertas, Descansos AI',
    note: 'Carga bajo demanda y PDF'
  }
];

// Helper to format hour float to text (e.g. 14.0 -> "2pm", 9.5 -> "9:30am")
function formatHourText(h) {
  const hourInt = Math.floor(h);
  const min = Math.round((h - hourInt) * 60);
  const period = hourInt >= 12 ? 'pm' : 'am';
  const displayHour = hourInt > 12 ? hourInt - 12 : (hourInt === 0 ? 12 : hourInt);
  if (min === 0) return `${displayHour}${period}`;
  return `${displayHour}:${min < 10 ? '0' : ''}${min}${period}`;
}

const timelineColsHtml = daysTimelineData.map((d, idx) => {
  const dayShort = d.date.split('-')[0];

  // Render Manager Floating Bars (Green)
  const mgrBarsHtml = d.mgrSegments.map(seg => {
    const bottomPct = hourToPercent(seg.start);
    const heightPct = ((seg.end - seg.start) / totalHourSpan) * 100;
    const startTxt = formatHourText(seg.start);
    const endTxt = formatHourText(seg.end);
    return `
      <div class="timeline-bar bar-mgr" style="bottom: ${bottomPct.toFixed(1)}%; height: ${heightPct.toFixed(1)}%;">
          <span class="bar-cap-label cap-top">${endTxt}</span>
          <span class="bar-center-label">🏪 Gerencia<br><strong>${seg.hours.toFixed(1)}h</strong></span>
          <span class="bar-cap-label cap-bottom">${startTxt}</span>
      </div>
    `;
  }).join('');

  // Render Dev Floating Bars (Indigo)
  const devBarsHtml = d.devSegments.map(seg => {
    const bottomPct = hourToPercent(seg.start);
    const heightPct = ((seg.end - seg.start) / totalHourSpan) * 100;
    const startTxt = formatHourText(seg.start);
    const endTxt = formatHourText(seg.end);
    return `
      <div class="timeline-bar bar-dev" style="bottom: ${bottomPct.toFixed(1)}%; height: ${heightPct.toFixed(1)}%;">
          <span class="bar-cap-label cap-top">${endTxt}</span>
          <span class="bar-center-label">💻 Dev<br><strong>${seg.hours.toFixed(1)}h</strong></span>
          <span class="bar-cap-label cap-bottom">${startTxt}</span>
      </div>
    `;
  }).join('');

  const totDev = d.devSegments.reduce((a, b) => a + b.hours, 0);
  const totMgr = d.mgrSegments.reduce((a, b) => a + b.hours, 0);

  return `
    <div class="timeline-day-col" data-idx="${idx}">
        <!-- Day Track Canvas (6am to 11pm) -->
        <div class="timeline-day-track">
            <!-- Left Track: Gerencia -->
            <div class="track-half track-mgr">
                ${mgrBarsHtml}
            </div>
            <!-- Right Track: Desarrollo -->
            <div class="track-half track-dev">
                ${devBarsHtml}
            </div>
        </div>

        <!-- Day Footer Label -->
        <div class="timeline-day-footer">
            <span class="day-num">${dayShort}</span>
            <span class="day-name">${d.dayName}</span>
        </div>
    </div>
  `;
}).join('\n');

console.log('Generated Timeline Columns HTML length:', timelineColsHtml.length);
