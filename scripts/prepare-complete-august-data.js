const fs = require('fs');
const path = require('path');

// Complete verified dataset for all 22 days of August 2026
const completeDaysData = [
  {
    date: '01-Ago',
    dayName: 'Sábado',
    fullDate: '01-Ago-2026',
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
    fullDate: '02-Ago-2026',
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
    fullDate: '03-Ago-2026',
    scheduled: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, timeStr: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 16.7, end: 19.07, hours: 2.61, timeStr: '4:42 PM - 7:04 PM', task: 'QB Estimates y PAR semanal' },
      { start: 20.53, end: 21.6, hours: 1.31, timeStr: '8:32 PM - 9:36 PM', task: 'Tech Pack specs y RFQ' }
    ],
    totalDev: 3.92,
    modules: 'Inventario, Tech Pack'
  },
  {
    date: '04-Ago',
    dayName: 'Martes',
    fullDate: '04-Ago-2026',
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
    date: '05-Ago',
    dayName: 'Miércoles',
    fullDate: '05-Ago-2026',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 11.66, end: 12.85, hours: 1.14, timeStr: '11:40 AM - 12:51 PM', task: 'Configurar Semana PAR Uniformes' },
      { start: 15.96, end: 16.2, hours: 0.50, timeStr: '3:58 PM - 4:12 PM', task: 'Sincronización base de datos' }
    ],
    totalDev: 1.64,
    modules: 'Inventario, Uniformes'
  },
  {
    date: '06-Ago',
    dayName: 'Jueves',
    fullDate: '06-Ago-2026',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 10.0, end: 11.6, hours: 1.00, timeStr: '10:00 AM - 11:37 AM', task: 'Sincronización tableta-PC y DB' },
      { start: 14.5, end: 15.0, hours: 0.75, timeStr: '2:30 PM - 3:00 PM', task: 'Ajuste de letras de cocina' }
    ],
    totalDev: 1.75,
    modules: 'Preparador, DB'
  },
  {
    date: '07-Ago',
    dayName: 'Viernes',
    fullDate: '07-Ago-2026',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 11.46, end: 13.76, hours: 2.54, timeStr: '11:28 AM - 1:46 PM', task: 'Notificaciones automáticas descansos LUNCH' }
    ],
    totalDev: 2.54,
    modules: 'Horarios, Violaciones'
  },
  {
    date: '08-Ago',
    dayName: 'Sábado',
    fullDate: '08-Ago-2026',
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
    fullDate: '09-Ago-2026',
    scheduled: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, timeStr: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 14.15, end: 15.15, hours: 1.24, timeStr: '2:09 PM - 3:09 PM', task: 'Simulación intraday acelerador' },
      { start: 17.63, end: 19.55, hours: 1.50, timeStr: '5:38 PM - 7:33 PM', task: 'Monitoreo de ritmo en parrilla' }
    ],
    totalDev: 2.74,
    modules: 'Preparador'
  },
  {
    date: '10-Ago',
    dayName: 'Lunes',
    fullDate: '10-Ago-2026',
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
    fullDate: '11-Ago-2026',
    scheduled: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, timeStr: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 9.28, end: 11.2, hours: 1.00, timeStr: '9:17 AM - 11:10 AM', task: 'Catálogos y mapeo de bodegas' },
      { start: 16.93, end: 19.83, hours: 2.18, timeStr: '4:56 PM - 7:50 PM', task: 'Caja Fuerte, RBAC y auditoría' }
    ],
    totalDev: 3.18,
    modules: 'Inventario, Caja Fuerte, DB'
  },
  {
    date: '12-Ago',
    dayName: 'Miércoles',
    fullDate: '12-Ago-2026',
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
    fullDate: '13-Ago-2026',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 8.51, end: 9.68, hours: 1.41, timeStr: '8:31 AM - 9:41 AM', task: 'Champurrado y Caja Fuerte' },
      { start: 11.01, end: 12.65, hours: 1.89, timeStr: '11:01 AM - 12:39 PM', task: 'Arqueos y deducciones' },
      { start: 14.28, end: 16.7, hours: 1.26, timeStr: '2:17 PM - 4:42 PM', task: 'Control de prendas' },
      { start: 17.71, end: 19.36, hours: 1.89, timeStr: '5:43 PM - 7:22 PM', task: 'MilesIQ deducción IRS' }
    ],
    totalDev: 6.45,
    modules: 'Uniformes, MilesIQ, Caja Fuerte'
  },
  {
    date: '14-Ago',
    dayName: 'Viernes',
    fullDate: '14-Ago-2026',
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
    fullDate: '15-Ago-2026',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 16.18, end: 20.36, hours: 4.44, timeStr: '4:11 PM - 8:22 PM', task: 'Tech Pack tabla de tallas y medidas' },
      { start: 20.98, end: 21.2, hours: 0.50, timeStr: '8:59 PM - 9:12 PM', task: 'Fichas técnicas proveedores' }
    ],
    totalDev: 4.94,
    modules: 'Tech Pack, Uniformes'
  },
  {
    date: '16-Ago',
    dayName: 'Domingo',
    fullDate: '16-Ago-2026',
    scheduled: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, timeStr: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 12.61, end: 15.83, hours: 3.45, timeStr: '12:37 PM - 3:50 PM', task: 'GPS tiendas y soporte IA' },
      { start: 19.11, end: 20.65, hours: 1.51, timeStr: '7:07 PM - 8:39 PM', task: 'Simulador de millas' },
      { start: 4.23, end: 5.98, hours: 2.00, timeStr: '4:14 AM - 5:59 AM', task: 'Auditoría nocturna de motor' }
    ],
    totalDev: 6.96,
    modules: 'MilesIQ, Planificador'
  },
  {
    date: '17-Ago',
    dayName: 'Lunes',
    fullDate: '17-Ago-2026',
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
    fullDate: '18-Ago-2026',
    scheduled: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, timeStr: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 11.0, end: 13.31, hours: 1.05, timeStr: '11:00 AM - 1:19 PM', task: 'Viele & Sons Scraper API v3' },
      { start: 14.4, end: 18.48, hours: 4.34, timeStr: '2:24 PM - 6:29 PM', task: 'Catálogo 87 insumos y auditoría precios' }
    ],
    totalDev: 5.39,
    modules: 'Radar Precios, Scraper'
  },
  {
    date: '19-Ago',
    dayName: 'Miércoles',
    fullDate: '19-Ago-2026',
    scheduled: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, timeStr: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 9.73, end: 12.51, hours: 3.05, timeStr: '9:44 AM - 12:31 PM', task: 'Auditoría 17 bugs y seguridad' },
      { start: 14.9, end: 17.25, hours: 1.65, timeStr: '2:54 PM - 5:15 PM', task: 'Radar de precios rediseño' }
    ],
    totalDev: 4.70,
    modules: 'Uniformes, Radar'
  },
  {
    date: '20-Ago',
    dayName: 'Jueves',
    fullDate: '20-Ago-2026',
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
    fullDate: '21-Ago-2026',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 6.15, end: 7.05, hours: 1.14, timeStr: '6:09 AM - 7:03 AM', task: 'Modal Basecamp 4 y MilesIQ' },
      { start: 11.88, end: 12.5, hours: 0.87, timeStr: '11:53 AM - 12:30 PM', task: 'Alertas correo directivos' },
      { start: 16.83, end: 17.0, hours: 0.50, timeStr: '4:50 PM - 5:00 PM', task: 'Ajuste UI' },
      { start: 19.86, end: 21.46, hours: 1.84, timeStr: '7:52 PM - 9:28 PM', task: 'Descansos IA motor y aprendizaje' }
    ],
    totalDev: 4.36,
    modules: 'Basecamp, Alertas, Descansos'
  },
  {
    date: '22-Ago',
    dayName: 'Sábado',
    fullDate: '22-Ago-2026',
    scheduled: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, timeStr: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 17.36, end: 18.46, hours: 1.36, timeStr: '5:22 PM - 6:28 PM', task: 'Toast API Cross-Date Refunds (Bell $8,332.64) y Conciliación' }
    ],
    totalDev: 1.36,
    modules: 'Toast API, Ventas'
  }
];

const totalHours = completeDaysData.reduce((sum, d) => sum + d.totalDev, 0);
const totalDays = completeDaysData.filter(d => d.totalDev > 0).length;

console.log(`Total días con desarrollo: ${totalDays}`);
console.log(`Total horas de desarrollo: ${totalHours.toFixed(2)} hrs`);

// Export dataset
fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/scratch/complete_days_data.json', JSON.stringify(completeDaysData, null, 2), 'utf-8');
console.log('✅ complete_days_data.json exportado con éxito!');
