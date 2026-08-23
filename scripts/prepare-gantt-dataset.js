const fs = require('fs');

// Test building the horizontal Gantt / Timeline view for Carlos Velazquez
const daysTimelineData = [
  {
    date: '01-Ago',
    dayName: 'Sábado',
    fullDate: '01-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, label: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 18.5, end: 21.0, hours: 4.5, timeStr: '6:30 PM - 9:00 PM', label: 'Proyecciones por tramos y live data' }
    ],
    totalDev: 4.5,
    modules: 'Preparador, Soporte IA'
  },
  {
    date: '02-Ago',
    dayName: 'Domingo',
    fullDate: '02-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, label: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 17.0, end: 18.0, hours: 1.0, timeStr: '5:00 PM - 6:00 PM', label: 'Modo básico vs avanzado y tableta' }
    ],
    totalDev: 1.0,
    modules: 'Preparador'
  },
  {
    date: '03-Ago',
    dayName: 'Lunes',
    fullDate: '03-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, label: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 16.75, end: 19.25, hours: 2.5, timeStr: '4:45 PM - 7:15 PM', label: 'QB Estimates y PAR semanal' },
      { start: 20.5, end: 21.25, hours: 0.75, timeStr: '8:30 PM - 9:15 PM', label: 'Tech Pack specs' }
    ],
    totalDev: 3.25,
    modules: 'Inventario, Tech Pack'
  },
  {
    date: '04-Ago',
    dayName: 'Martes',
    fullDate: '04-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, label: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 9.75, end: 18.75, hours: 9.0, timeStr: '9:45 AM - 7:00 PM', label: 'Ficha técnica fabricante y cotizaciones Formaryx' }
    ],
    totalDev: 9.0,
    modules: 'Tech Pack Uniformes, RFQ'
  },
  {
    date: '06-Ago',
    dayName: 'Jueves',
    fullDate: '06-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, label: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 12.0, end: 13.0, hours: 1.0, timeStr: '12:00 PM - 1:00 PM', label: 'Sincronización tableta-PC y tabla DB' }
    ],
    totalDev: 1.0,
    modules: 'Preparador, DB'
  },
  {
    date: '07-Ago',
    dayName: 'Viernes',
    fullDate: '07-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, label: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 13.0, end: 15.0, hours: 2.0, timeStr: '1:00 PM - 3:00 PM', label: 'Notificaciones automáticas descansos LUNCH' }
    ],
    totalDev: 2.0,
    modules: 'Horarios, Violaciones'
  },
  {
    date: '08-Ago',
    dayName: 'Sábado',
    fullDate: '08-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, label: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 13.0, end: 20.0, hours: 7.0, timeStr: '1:00 PM - 8:00 PM', label: 'Pace parrilla carnes y pantallas TV' },
      { start: 19.83, end: 20.0, hours: 0.15, timeStr: '7:50 PM - 8:00 PM', label: 'Sincronización' }
    ],
    totalDev: 7.15,
    modules: 'Preparador, Menú TVs'
  },
  {
    date: '09-Ago',
    dayName: 'Domingo',
    fullDate: '09-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, label: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 14.0, end: 16.0, hours: 2.0, timeStr: '2:00 PM - 4:00 PM', label: 'Simulación intraday acelerador' }
    ],
    totalDev: 2.0,
    modules: 'Preparador'
  },
  {
    date: '10-Ago',
    dayName: 'Lunes',
    fullDate: '10-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, label: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 15.5, end: 17.5, hours: 2.0, timeStr: '3:30 PM - 5:30 PM', label: 'Control de prendas y arqueos' },
      { start: 17.0, end: 17.33, hours: 0.3, timeStr: '5:00 PM - 5:20 PM', label: 'Ajuste base de datos' }
    ],
    totalDev: 2.3,
    modules: 'Uniformes, Recepción'
  },
  {
    date: '11-Ago',
    dayName: 'Martes',
    fullDate: '11-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, label: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 18.75, end: 19.08, hours: 0.33, timeStr: '6:45 PM - 7:05 PM', label: 'Catálogos y mapeo de bodegas' },
      { start: 19.16, end: 19.41, hours: 0.25, timeStr: '7:10 PM - 7:25 PM', label: 'RBAC y seguridad' }
    ],
    totalDev: 0.93,
    modules: 'Inventario, DB'
  },
  {
    date: '12-Ago',
    dayName: 'Miércoles',
    fullDate: '12-Ago-2026',
    scheduledStr: 'Descanso en Tienda',
    shiftHours: 0.0,
    mgrRange: null,
    devSessions: [
      { start: 13.25, end: 13.58, hours: 0.33, timeStr: '1:15 PM - 1:35 PM', label: 'Endpoints API Basecamp' },
      { start: 19.33, end: 23.5, hours: 4.0, timeStr: '7:20 PM - 11:30 PM', label: 'Sincronizador continuo en día libre' }
    ],
    totalDev: 4.33,
    modules: 'Basecamp 3 API'
  },
  {
    date: '13-Ago',
    dayName: 'Jueves',
    fullDate: '13-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, label: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 8.66, end: 9.08, hours: 2.5, timeStr: '8:40 AM - 9:05 AM', label: 'Champurrado y Caja Fuerte' },
      { start: 11.5, end: 12.0, hours: 0.5, timeStr: '11:30 AM - 12:00 PM', label: 'Arqueo de bóveda' },
      { start: 17.0, end: 19.5, hours: 2.5, timeStr: '5:00 PM - 7:30 PM', label: 'MilesIQ deducción IRS' }
    ],
    totalDev: 5.5,
    modules: 'Uniformes, MilesIQ'
  },
  {
    date: '14-Ago',
    dayName: 'Viernes',
    fullDate: '14-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, label: '2:00 PM - 9:00 PM' },
    devSessions: [],
    totalDev: 0.0,
    modules: 'Gerencia Operativa Lynwood'
  },
  {
    date: '15-Ago',
    dayName: 'Sábado',
    fullDate: '15-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, label: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 20.0, end: 20.75, hours: 0.75, timeStr: '8:00 PM - 8:45 PM', label: 'Especificaciones de fabricante' },
      { start: 20.5, end: 21.5, hours: 1.0, timeStr: '8:30 PM - 9:30 PM', label: 'Tech Pack tabla de tallas' }
    ],
    totalDev: 2.25,
    modules: 'Tech Pack, Uniformes'
  },
  {
    date: '16-Ago',
    dayName: 'Domingo',
    fullDate: '06-Ago-2026',
    scheduledStr: '2:00 PM - 7:00 PM',
    shiftHours: 5.0,
    mgrRange: { start: 14.0, end: 19.0, label: '2:00 PM - 7:00 PM' },
    devSessions: [
      { start: 12.5, end: 15.5, hours: 3.0, timeStr: '12:30 PM - 3:30 PM', label: 'GPS tiendas y soporte IA' },
      { start: 19.0, end: 20.75, hours: 1.5, timeStr: '7:00 PM - 8:45 PM', label: 'Simulador y reportes' }
    ],
    totalDev: 6.0,
    modules: 'MilesIQ, Planificador'
  },
  {
    date: '17-Ago',
    dayName: 'Lunes',
    fullDate: '17-Ago-2026',
    scheduledStr: '12:00 PM - 8:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 12.0, end: 20.0, label: '12:00 PM - 8:00 PM' },
    devSessions: [
      { start: 4.0, end: 5.75, hours: 1.7, timeStr: '4:00 AM - 5:45 AM', label: 'Auditoría laboral y catálogo Viele' },
      { start: 13.16, end: 15.58, hours: 2.4, timeStr: '1:10 PM - 3:35 PM', label: 'Radar de precios proveedores' }
    ],
    totalDev: 4.43,
    modules: 'Radar Precios, QB'
  },
  {
    date: '18-Ago',
    dayName: 'Martes',
    fullDate: '18-Ago-2026',
    scheduledStr: '2:00 PM - 10:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 14.0, end: 22.0, label: '2:00 PM - 10:00 PM' },
    devSessions: [
      { start: 15.33, end: 17.25, hours: 1.75, timeStr: '3:20 PM - 5:15 PM', label: 'Scraper API Viele v3 y precios' }
    ],
    totalDev: 1.75,
    modules: 'Radar Precios, Scraper'
  },
  {
    date: '19-Ago',
    dayName: 'Miércoles',
    fullDate: '19-Ago-2026',
    scheduledStr: '9:00 AM - 5:00 PM',
    shiftHours: 8.0,
    mgrRange: { start: 9.0, end: 17.0, label: '9:00 AM - 5:00 PM' },
    devSessions: [
      { start: 9.5, end: 13.0, hours: 3.5, timeStr: '9:30 AM - 1:00 PM', label: 'Auditoría 17 bugs y seguridad' }
    ],
    totalDev: 3.5,
    modules: 'Uniformes, Radar'
  },
  {
    date: '20-Ago',
    dayName: 'Jueves',
    fullDate: '20-Ago-2026',
    scheduledStr: 'Descanso en Tienda',
    shiftHours: 0.0,
    mgrRange: null,
    devSessions: [
      { start: 6.25, end: 7.4, hours: 1.15, timeStr: '6:15 AM - 7:25 AM', label: 'Basecamp View As y UX' },
      { start: 14.75, end: 15.66, hours: 0.9, timeStr: '2:45 PM - 3:40 PM', label: 'MilesIQ coordenadas 15 tiendas' },
      { start: 20.0, end: 21.0, hours: 1.0, timeStr: '8:00 PM - 9:00 PM', label: 'Radar de precios rediseño' }
    ],
    totalDev: 3.05,
    modules: 'Basecamp, MilesIQ'
  },
  {
    date: '21-Ago',
    dayName: 'Viernes',
    fullDate: '21-Ago-2026',
    scheduledStr: '2:00 PM - 9:00 PM',
    shiftHours: 7.0,
    mgrRange: { start: 14.0, end: 21.0, label: '2:00 PM - 9:00 PM' },
    devSessions: [
      { start: 5.5, end: 7.16, hours: 1.6, timeStr: '5:30 AM - 7:10 AM', label: 'Modal Basecamp 4 y MilesIQ' },
      { start: 12.25, end: 13.0, hours: 0.75, timeStr: '12:15 PM - 1:00 PM', label: 'Alertas por correo directivos' },
      { start: 21.0, end: 22.41, hours: 1.4, timeStr: '9:00 PM - 10:25 PM', label: 'Descansos IA y aprendizaje' }
    ],
    totalDev: 3.75,
    modules: 'Basecamp, Alertas'
  }
];

console.log('Dataset prepared successfully!');
