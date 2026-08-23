const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════');
console.log('🚀 ACTUALIZANDO HORAS REALES DEL JUEVES 20 DE AGOSTO (6.98 hrs)');
console.log('═══════════════════════════════════════════════════════════════════');

// Read August report
let reportHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Update Row 37 (Afternoon Session 20-Aug)
// Replace "2:45 PM - 3:40 PM</td>\n                                <td style=\"text-align: center; font-weight: 700;\">0.90"
// with "3:15 PM - 6:00 PM</td>\n                                <td style=\"text-align: center; font-weight: 700;\">2.75"
reportHtml = reportHtml.replace(
    '<td>2:45 PM - 3:40 PM</td>\n                                <td style="text-align: center; font-weight: 700;">0.90</td>',
    '<td>3:15 PM - 6:00 PM</td>\n                                <td style="text-align: center; font-weight: 700;">2.75</td>'
);

// Update Row 38 (Night Session 20-Aug)
// Replace "8:00 PM - 9:00 PM</td>\n                                <td style=\"text-align: center; font-weight: 700;\">1.00"
// with "8:40 PM - 11:45 PM</td>\n                                <td style=\"text-align: center; font-weight: 700;\">3.08"
reportHtml = reportHtml.replace(
    '<td>8:00 PM - 9:00 PM</td>\n                                <td style="text-align: center; font-weight: 700;">1.00</td>',
    '<td>8:40 PM - 11:45 PM</td>\n                                <td style="text-align: center; font-weight: 700;">3.08</td>'
);

// Update Total August Hours from 67.69 (or other) to 71.62
reportHtml = reportHtml.replace(/67\.69\s*hrs/g, '71.62 hrs');
reportHtml = reportHtml.replace(/67\.69\s*<small>hrs<\/small>/g, '71.62 <small>hrs</small>');
reportHtml = reportHtml.replace(/67\.69\s*h/g, '71.62 h');
reportHtml = reportHtml.replace(/67\.69/g, '71.62');
reportHtml = reportHtml.replace(/20-Ago \(3\.05h\)/g, '20-Ago (6.98h)');
reportHtml = reportHtml.replace(/20-Ago \(3\.1h/g, '20-Ago (7.0h');

fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', reportHtml, 'utf-8');
console.log('✅ pendientes_agosto.html actualizado a 71.62 hrs!');

// Now let's update scripts/generate-dual-view-schedule.js with the real Aug 20 sessions and total 71.62 hrs
const scheduleScriptPath = 'c:/Users/pedro/Desktop/teg-modernizado/scripts/generate-dual-view-schedule.js';
let scheduleScript = fs.readFileSync(scheduleScriptPath, 'utf-8');

// Update daysData entry for 20-Ago
const old20AgoEntry = `  {
    date: '20-Ago',
    dayName: 'Jueves',
    scheduled: 'Descanso en Tienda',
    shiftHours: 0.0,
    mgrRange: null,
    devSessions: [
      { start: 6.25, end: 7.4, hours: 1.15, timeStr: '6:15 AM - 7:25 AM', task: 'Basecamp View As y UX' },
      { start: 14.75, end: 15.66, hours: 0.90, timeStr: '2:45 PM - 3:40 PM', task: 'MilesIQ coordenadas GPS' },
      { start: 20.0, end: 21.0, hours: 1.00, timeStr: '8:00 PM - 9:00 PM', task: 'Radar rediseño ejecutivo' }
    ],
    totalDev: 3.05,
    modules: 'Basecamp, MilesIQ'
  }`;

const new20AgoEntry = `  {
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
  }`;

scheduleScript = scheduleScript.replace(old20AgoEntry, new20AgoEntry);
scheduleScript = scheduleScript.replace(/67\.69/g, '71.62');
scheduleScript = scheduleScript.replace(/20-Ago \(3\.05h\)/g, '20-Ago (6.98h)');

fs.writeFileSync(scheduleScriptPath, scheduleScript, 'utf-8');
console.log('✅ scripts/generate-dual-view-schedule.js actualizado!');
