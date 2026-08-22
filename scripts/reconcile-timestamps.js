const daysData = [
  { date: '01-Ago', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '6:29 PM - 9:01 PM', dev: 4.50, mgr: 2.50, modules: 'Preparador, Soporte IA', note: 'Proyecciones por tramos y live data' },
  { date: '02-Ago', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, devRange: '5:06 PM - 6:06 PM', dev: 1.00, mgr: 4.00, modules: 'Preparador', note: 'Modo básico vs avanzado y tableta' },
  { date: '03-Ago', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, devRange: '4:48 PM - 7:04 PM', dev: 3.25, mgr: 4.75, modules: 'Inventario, Tech Pack', note: 'QB Estimates y PAR semanal' },
  { date: '04-Ago', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, devRange: '6:27 PM - 9:30 PM', dev: 3.50, mgr: 4.50, modules: 'Tech Pack Uniformes, RFQ', note: 'Ficha técnica fabricante y RFQ Formaryx' },
  { date: '06-Ago', day: 'Jue', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, devRange: '2:44 PM - 3:44 PM', dev: 1.00, mgr: 7.00, modules: 'Preparador, DB', note: 'Sincronización tableta-PC y tabla DB' },
  { date: '07-Ago', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '1:44 PM - 3:44 PM', dev: 2.00, mgr: 5.00, modules: 'Horarios, Violaciones', note: 'Notificaciones automáticas descansos' },
  { date: '08-Ago', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '6:06 PM - 8:32 PM', dev: 3.50, mgr: 3.50, modules: 'Preparador, Menú TVs', note: 'Pace parrilla carnes y pantallas TV' },
  { date: '09-Ago', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, devRange: '5:30 PM - 7:30 PM', dev: 2.00, mgr: 3.00, modules: 'Preparador', note: 'Simulación intraday acelerador' },
  { date: '10-Ago', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, devRange: '4:34 PM - 6:50 PM', dev: 2.30, mgr: 5.70, modules: 'Uniformes, Recepción', note: 'Control de prendas y arqueos' },
  { date: '11-Ago', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, devRange: '7:47 PM - 8:43 PM', dev: 0.93, mgr: 7.07, modules: 'Inventario, DB', note: 'Catálogos y mapeo de bodegas' },
  { date: '12-Ago', day: 'Mié', scheduled: 'Descanso en Tienda', shiftHours: 0.0, devRange: '11:14 AM - 3:34 PM', dev: 4.33, mgr: 0.00, modules: 'Basecamp 3 API', note: 'Integración API Basecamp en día libre' },
  { date: '13-Ago', day: 'Jue', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, devRange: '9:06 AM & 5:46 PM', dev: 5.50, mgr: 2.50, modules: 'Uniformes, MilesIQ', note: 'Champurrado, Caja Fuerte y MilesIQ' },
  { date: '14-Ago', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '—', dev: 0.00, mgr: 7.00, modules: 'Gerencia Operativa', note: '100% Supervisión en restaurante' },
  { date: '15-Ago', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '6:45 PM - 9:00 PM', dev: 2.25, mgr: 4.75, modules: 'Tech Pack, Uniformes', note: 'Especificaciones de fabricante' },
  { date: '16-Ago', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, devRange: '12:43 PM - 4:40 PM', dev: 3.00, mgr: 2.00, modules: 'MilesIQ, Planificador', note: 'GPS tiendas y soporte IA' },
  { date: '17-Ago', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, devRange: '5:16 AM & 3:39 PM', dev: 4.43, mgr: 3.57, modules: 'Radar Precios, QB', note: 'Auditoría laboral y catálogo Viele' },
  { date: '18-Ago', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, devRange: '1:15 PM - 4:05 PM', dev: 1.75, mgr: 6.25, modules: 'Radar Precios, Scraper', note: 'Scraper API Viele v3 y precios' },
  { date: '19-Ago', day: 'Mié', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, devRange: '1:00 PM - 4:30 PM', dev: 3.50, mgr: 4.50, modules: 'Uniformes, Radar', note: 'Auditoría 17 bugs y seguridad' },
  { date: '20-Ago', day: 'Jue', scheduled: 'Descanso en Tienda', shiftHours: 0.0, devRange: '11:00 AM - 2:05 PM', dev: 3.05, mgr: 0.00, modules: 'Basecamp, MilesIQ', note: 'Rediseño radar y coordenadas en día libre' },
  { date: '21-Ago', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, devRange: '2:00 PM - 4:20 PM', dev: 2.35, mgr: 4.65, modules: 'Basecamp, Alertas', note: 'Carga bajo demanda y PDF' }
];

const totalDev = daysData.reduce((acc, d) => acc + d.dev, 0);
const totalMgr = daysData.reduce((acc, d) => acc + d.mgr, 0);
const totalWork = totalDev + totalMgr;
const totalScheduled = daysData.reduce((acc, d) => acc + d.shiftHours, 0);

console.log('═════════════════════════════════════════════════════════════════════');
console.log('🎯 CONCILIACIÓN FORENSE DE HORAS DE CARLOS VELAZQUEZ');
console.log('═════════════════════════════════════════════════════════════════════');
console.log(`💻 Total Desarrollo SM TEG:  ${totalDev.toFixed(2)} hrs (${((totalDev/totalWork)*100).toFixed(1)}%)`);
console.log(`🏪 Total Gerencia Lynwood:   ${totalMgr.toFixed(2)} hrs (${((totalMgr/totalWork)*100).toFixed(1)}%)`);
console.log(`⏱️ Total Jornada Combinada:  ${totalWork.toFixed(2)} hrs`);
console.log(`📅 Total Horas Planificador: ${totalScheduled.toFixed(2)} hrs`);
console.log('═════════════════════════════════════════════════════════════════════');
