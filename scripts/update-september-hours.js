const fs = require('fs');
const d = JSON.parse(fs.readFileSync('scripts/september_full_data.json', 'utf8'));

// Update total hours
d.totalHours = 29.25;

// Update effort
const vieleEffort = d.effort.find(e => e.module.includes('Viele & Sons'));
if (vieleEffort) vieleEffort.hours = 7.25;

// Update row for 06-Sep-2026
const row = d.rows.find(r => r.date === '06-Sep-2026');
if (row) {
  row.time = '10:15 AM - 1:45 PM & 3:30 PM - 7:15 PM';
  row.hours = 7.25;
  if (!row.badges.includes('Entrega Martes')) row.badges.push('Entrega Martes');
  if (!row.badges.includes('Comprador Oficial AFV')) row.badges.push('Comprador Oficial AFV');
  
  row.descEs += '<br>• <strong>Reglas de Entrega en Martes y Comprador Oficial AFV en Viele & Sons</strong>: Configuración de la regla de despacho semanal donde la fecha de entrega siempre se calcula y preselecciona para el próximo día martes habitual (getNextTuesday), habilitando la modificación por excepciones de emergencia o cierre temporal con alerta visual distintiva y botón de restablecimiento rápido. Certificación histórica de órdenes en Sage 100 identificando el código oficial de comprador "AFV" utilizado en el 90%+ de los pedidos de la cadena; se fijó "AFV" como valor por defecto tanto en el nombre de comprador como en el número de PO (CustomerPONo), con chips de selección rápida para códigos secundarios autorizados (LEWIS, MARK, PV).';
  row.descEn += '<br>• <strong>Tuesday Delivery Rules & Official AFV Buyer Code in Viele & Sons</strong>: Configured weekly delivery day automation where ship date always defaults to the upcoming standard Tuesday (getNextTuesday), allowing managers to adjust for store emergencies or closures with visual alert banners and a 1-click reset button. Forensically audited Sage 100 historical order headers confirming "AFV" as the official registered buyer code across 90%+ of chain orders; set "AFV" as default buyer and PO fallback in checkout and backend endpoints, with quick-select chips for secondary authorized codes (LEWIS, MARK, PV).';
}

fs.writeFileSync('scripts/september_full_data.json', JSON.stringify(d, null, 2), 'utf8');
console.log('september_full_data.json updated successfully. Total hours:', d.totalHours);
