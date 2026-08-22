const daysData = [
  { date: '01-Ago-2026', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 4.50, mgr: 2.50, mode: 'COMBINADO', modules: 'Preparador, Soporte IA', note: 'Proyecciones por tramos y datos en vivo' },
  { date: '02-Ago-2026', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 1.00, mgr: 4.00, mode: 'COMBINADO', modules: 'Preparador', note: 'Modo básico vs avanzado y tableta' },
  { date: '03-Ago-2026', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 3.25, mgr: 4.75, mode: 'COMBINADO', modules: 'Inventario, Tech Pack', note: 'QB Estimates y Tech Pack Uniformes' },
  { date: '04-Ago-2026', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 9.00, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Preparador, Auditoría', note: '100% Dev intensivo (Turno completo + 1h extra)' },
  { date: '06-Ago-2026', day: 'Jue', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 1.00, mgr: 7.00, mode: 'COMBINADO', modules: 'Preparador, DB', note: 'Sincronización tableta-PC y tabla DB' },
  { date: '07-Ago-2026', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.00, mgr: 5.00, mode: 'COMBINADO', modules: 'Horarios, Violaciones', note: 'Notificaciones automáticas de descansos' },
  { date: '08-Ago-2026', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 7.15, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Preparador, Menú TVs', note: '100% Dev intensivo (Pace de parrilla y pantallas)' },
  { date: '09-Ago-2026', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 2.00, mgr: 3.00, mode: 'COMBINADO', modules: 'Preparador', note: 'Simulación intraday y acelerador de parrilla' },
  { date: '10-Ago-2026', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 2.30, mgr: 5.70, mode: 'COMBINADO', modules: 'Uniformes, Recepción', note: 'Control de prendas y arqueos' },
  { date: '11-Ago-2026', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 0.93, mgr: 7.07, mode: 'COMBINADO', modules: 'Inventario, DB', note: 'Catálogos y mapeo de bodegas' },
  { date: '12-Ago-2026', day: 'Mié', scheduled: 'Descanso en Tienda', shiftHours: 0.0, dev: 4.33, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Basecamp 3 API', note: '100% Dev en día de descanso' },
  { date: '13-Ago-2026', day: 'Jue', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 5.50, mgr: 2.50, mode: 'COMBINADO', modules: 'Uniformes, Caja Fuerte', note: 'Conciliación de efectivo y ventas' },
  { date: '14-Ago-2026', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 0.00, mgr: 7.00, mode: 'INDEPENDIENTE_OPS', modules: 'Gerencia Operativa', note: '100% Gerencia Operativa en piso de Lynwood' },
  { date: '15-Ago-2026', day: 'Sáb', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.25, mgr: 4.75, mode: 'COMBINADO', modules: 'Tech Pack, Uniformes', note: 'Especificaciones de fabricante' },
  { date: '16-Ago-2026', day: 'Dom', scheduled: '2:00 PM - 7:00 PM', shiftHours: 5.0, dev: 6.00, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'MilesIQ, Planificador', note: '100% Dev intensivo (GPS tiendas y soporte IA)' },
  { date: '17-Ago-2026', day: 'Lun', scheduled: '12:00 PM - 8:00 PM', shiftHours: 8.0, dev: 4.43, mgr: 3.57, mode: 'COMBINADO', modules: 'Radar Precios, QB', note: 'Auditoría laboral y catálogo Viele' },
  { date: '18-Ago-2026', day: 'Mar', scheduled: '2:00 PM - 10:00 PM', shiftHours: 8.0, dev: 1.75, mgr: 6.25, mode: 'COMBINADO', modules: 'Radar Precios, Scraper', note: 'Scraper API Viele v3 y precios base' },
  { date: '19-Ago-2026', day: 'Mié', scheduled: '9:00 AM - 5:00 PM', shiftHours: 8.0, dev: 3.50, mgr: 4.50, mode: 'COMBINADO', modules: 'Uniformes, Radar', note: 'Auditoría forense 17 bugs y roles' },
  { date: '20-Ago-2026', day: 'Jue', scheduled: 'Descanso en Tienda', shiftHours: 0.0, dev: 3.05, mgr: 0.00, mode: 'INDEPENDIENTE_DEV', modules: 'Basecamp, MilesIQ', note: '100% Dev en día de descanso' },
  { date: '21-Ago-2026', day: 'Vie', scheduled: '2:00 PM - 9:00 PM', shiftHours: 7.0, dev: 2.35, mgr: 4.65, mode: 'COMBINADO', modules: 'Basecamp, Alertas', note: 'Carga bajo demanda, alertas correo y PDF' }
];

// Calculations
const combinedDays = daysData.filter(d => d.mode === 'COMBINADO');
const independentDevDays = daysData.filter(d => d.mode === 'INDEPENDIENTE_DEV');
const independentOpsDays = daysData.filter(d => d.mode === 'INDEPENDIENTE_OPS');

const devCombined = combinedDays.reduce((acc, d) => acc + d.dev, 0);
const mgrCombined = combinedDays.reduce((acc, d) => acc + d.mgr, 0);
const totalCombined = devCombined + mgrCombined;

const devIndependent = independentDevDays.reduce((acc, d) => acc + d.dev, 0);
const mgrIndependent = independentOpsDays.reduce((acc, d) => acc + d.mgr, 0);

const grandTotalDev = devCombined + devIndependent;
const grandTotalMgr = mgrCombined + mgrIndependent;
const grandTotal = grandTotalDev + grandTotalMgr;

console.log('═══════════════════════════════════════════════════════════════════');
console.log('📊 ANÁLISIS DE MODALIDADES DE TRABAJO DE CARLOS VELAZQUEZ');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`1. DÍAS COMBINADOS (JORNADA DUAL EN EL MISMO TURNO) — ${combinedDays.length} Días:`);
console.log(`   - 💻 Horas Programando SM TEG: ${devCombined.toFixed(2)} hrs (${((devCombined/totalCombined)*100).toFixed(1)}%)`);
console.log(`   - 🏪 Horas Gerencia Lynwood:   ${mgrCombined.toFixed(2)} hrs (${((mgrCombined/totalCombined)*100).toFixed(1)}%)`);
console.log(`   - ⏱️ Subtotal Horas Combinadas: ${totalCombined.toFixed(2)} hrs\n`);

console.log(`2. DÍAS INDEPENDIENTES (ENFOQUE EXCLUSIVO / MONOTAREA) — ${independentDevDays.length + independentOpsDays.length} Días:`);
console.log(`   - 💻 100% Desarrollo Exclusivo (${independentDevDays.length} días: 04, 08, 12, 16, 20-Ago): ${devIndependent.toFixed(2)} hrs`);
console.log(`   - 🏪 100% Gerencia Operativa Exclusiva (${independentOpsDays.length} día: 14-Ago): ${mgrIndependent.toFixed(2)} hrs`);
console.log(`   - ⏱️ Subtotal Horas Independientes: ${(devIndependent + mgrIndependent).toFixed(2)} hrs\n`);

console.log(`3. TOTALES GLOBALES (1 al 21 de Agosto):`);
console.log(`   - 💻 Total Desarrollo SM TEG: ${grandTotalDev.toFixed(2)} hrs (${((grandTotalDev/grandTotal)*100).toFixed(1)}%)`);
console.log(`   - 🏪 Total Gerencia Lynwood:  ${grandTotalMgr.toFixed(2)} hrs (${((grandTotalMgr/grandTotal)*100).toFixed(1)}%)`);
console.log(`   - ⏱️ Total Horas Trabajadas:  ${grandTotal.toFixed(2)} hrs`);
console.log('═══════════════════════════════════════════════════════════════════');
