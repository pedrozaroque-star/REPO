const fs = require('fs');

function replaceAll() {
  const pageFile = 'c:/Users/pedro/Desktop/teg-modernizado/app/miles/page.tsx';
  let pageContent = fs.readFileSync(pageFile, 'utf8');

  const pageReplacements = [
    // Header
    { search: /language === 'en'\s*\?\s*'Supervisor Mileage Calculation & HR Payroll Dispatch'\s*:\s*'Control de Millas Manejadas por Supervisores y Envío a RRHH'/g, replace: "t('miles.subtitle')" },
    { search: /language === 'en' \? 'Export CSV' : 'Exportar CSV'/g, replace: "t('miles.export_csv')" },
    { search: /language === 'en' \? 'Log New Trip' : 'Registrar Viaje'/g, replace: "t('miles.log_trip')" },

    // KPI Cards
    { search: /language === 'en' \? 'Total Drives' : 'Viajes Registrados'/g, replace: "t('miles.total_drives')" },
    { search: /language === 'en' \? 'Across all supervisors' : 'Todas las sucursales'/g, replace: "t('miles.all_supervisors')" },
    { search: /language === 'en' \? 'Total Miles' : 'Millas Totales'/g, replace: "t('miles.total_miles')" },
    { search: /language === 'en' \? 'Reimbursement' : 'Reembolso Acumulado'/g, replace: "t('miles.reimbursement')" },
    { search: /language === 'en' \? 'Includes tolls & parking' : 'Incluye casetas y parking'/g, replace: "t('miles.includes_tolls_parking')" },
    { search: /language === 'en' \? 'Sent to HR' : 'Enviados a RRHH'/g, replace: "t('miles.sent_to_hr')" },
    { search: /\{metrics\.hrCount\} <span className="text-sm font-semibold">viajes<\/span>/g, replace: "{metrics.hrCount} <span className=\"text-sm font-semibold\">{t('miles.trips_unit')}</span>" },
    { search: /\{metrics\.pendingCount\} \{language === 'en' \? 'pending approval' : 'pendientes de despacho'\}/g, replace: "{metrics.pendingCount} {t('miles.pending_dispatch')}" },

    // Tabs
    { search: /language === 'en' \? 'Drive Log \(Mis Viajes\)' : 'Mis Viajes \(Drive Log\)'/g, replace: "t('miles.tab_drive_log')" },
    { search: /language === 'en' \? 'HR Payroll Dispatch \(Envío a RRHH\)' : 'Despacho a RRHH \(Nómina\)'/g, replace: "t('miles.tab_hr_dispatch')" },
    { search: /language === 'en' \? 'Submissions Log' : 'Historial de Envíos'/g, replace: "t('miles.tab_history')" },
    { search: /language === 'en' \? 'Distance Matrix & Rates' : 'Matriz & Configuración'/g, replace: "t('miles.tab_settings')" },

    // Filter Bar
    { search: /language === 'en' \? 'Search origin, destination, supervisor\.\.\.' : 'Buscar origen, destino, supervisor\.\.\.'/g, replace: "t('miles.search_placeholder')" },
    { search: /language === 'en' \? 'All Statuses' : 'Todos los Estados'/g, replace: "t('miles.all_statuses')" },
    { search: /language === 'en' \? 'Pending' : 'Pendiente'/g, replace: "t('miles.status_pending')" },
    { search: /language === 'en' \? 'Submitted to HR' : 'Enviado a RRHH'/g, replace: "t('miles.status_submitted_hr')" },
    { search: /language === 'en' \? 'Approved' : 'Aprobado'/g, replace: "t('miles.status_approved')" },
    { search: /language === 'en' \? 'Paid' : 'Pagado'/g, replace: "t('miles.status_paid')" },
    { search: /language === 'en' \? 'All Supervisors' : 'Todos los Supervisores'/g, replace: "t('miles.all_supervisors')" },
    { search: /\{filteredTrips\.length\} viajes encontrados/g, replace: "{filteredTrips.length} {t('miles.trips_found')}" },

    // Table Headers
    { search: /language === 'en' \? 'When' : 'Fecha \/ Hora'/g, replace: "t('miles.th_when')" },
    { search: /language === 'en' \? 'Supervisor' : 'Supervisor'/g, replace: "t('miles.th_supervisor')" },
    { search: /language === 'en' \? 'Why' : 'Motivo'/g, replace: "t('miles.th_why')" },
    { search: /language === 'en' \? 'Route \(Start -> End\)' : 'Ruta \(Origen -> Destino\)'/g, replace: "t('miles.th_route')" },
    { search: /language === 'en' \? 'Distance' : 'Millas'/g, replace: "t('miles.th_distance')" },
    { search: /language === 'en' \? 'Rate' : 'Tarifa'/g, replace: "t('miles.th_rate')" },
    { search: /language === 'en' \? 'Reimbursement' : 'Total \$ USD'/g, replace: "t('miles.th_reimbursement')" },
    { search: /language === 'en' \? 'Status' : 'Estado'/g, replace: "t('miles.th_status')" },
    { search: /language === 'en' \? 'Actions' : 'Acciones'/g, replace: "t('miles.th_actions')" },

    // Status Badges
    { search: /ENVIADO A RRHH/g, replace: "{t('miles.badge_submitted_hr')}" },
    { search: />\s*PENDIENTE\s*</g, replace: ">{t('miles.badge_pending')}<" },
    { search: />\s*APROBADO\s*</g, replace: ">{t('miles.badge_approved')}<" },
    { search: />\s*PAGADO\s*</g, replace: ">{t('miles.badge_paid')}<" },
    { search: />\s*IDA\/VUELTA\s*</g, replace: ">{t('miles.badge_round_trip')}<" },

    // Action tooltips
    { search: /title="Aprobar Viaje"/g, replace: "title={t('miles.approve_trip')}" },
    { search: /title="Eliminar Viaje"/g, replace: "title={t('miles.delete_trip')}" },

    // Empty state
    { search: /language === 'en' \? 'No trips recorded yet\. Click "Log New Trip" to get started\.' : 'No se han registrado viajes\. Haz clic en "Registrar Viaje" para comenzar\.'/g, replace: "t('miles.empty_table')" },

    // Toasts & Messages
    { search: /language === 'en' \? 'Trip logged successfully!' : '¡Viaje registrado con éxito en MilesIQ!'/g, replace: "t('miles.trip_saved')" },
    { search: /json\.error \|\| 'Error al guardar viaje'/g, replace: "json.error || t('miles.error_save')" },
    { search: /err\.message \|\| 'Error de conexión'/g, replace: "err.message || t('miles.error_connection')" },
    { search: /language === 'en' \? 'Are you sure you want to delete this trip\?' : '¿Confirmas eliminar este viaje\?'/g, replace: "t('miles.confirm_delete')" },
    { search: /language === 'en' \? 'Trip deleted' : 'Viaje eliminado'/g, replace: "t('miles.trip_deleted')" },
    { search: /`Estado actualizado a \$\{newStatus\}`/g, replace: "`${t('miles.status_updated')}: ${newStatus}`" },
    { search: /language === 'en' \? 'Please enter a valid HR recipient email' : 'Por favor ingresa un correo de RRHH válido'/g, replace: "t('miles.valid_email_required')" },
    
    // complex multiline literal replace for HR send
    { search: /language === 'en'\s*\?\s*`Mileage report sent to \$\{emailToUse\} using \$\{currentUser\.email\}!`\s*:\s*`¡Reporte enviado a \$\{emailToUse\} con tu cuenta \(\$\{currentUser\.email\}\)!`/g, replace: "`${t('miles.report_sent')} ${emailToUse}`" },
    
    { search: /json\.error \|\| 'Error al enviar reporte a RRHH'/g, replace: "json.error || t('miles.error_send_hr')" },
    { search: /err\.message \|\| 'Error al enviar correo'/g, replace: "err.message || t('miles.error_send_email')" },
    { search: /language === 'en' \? `Rate updated to \$\$\{val\.toFixed\(3\)\}\/mi` : `Tarifa actualizada a \$\$\{val\.toFixed\(3\)\}\/mi`/g, replace: "`${t('miles.rate_updated')}: $${val.toFixed(3)}/mi`" },
    
    { search: /language === 'en'\s*\?\s*'Calculate all store pair distances using Map AI with traffic evasion model\?'\s*:\s*'¿Deseas calcular automáticamente todas las distancias entre sucursales usando mapa IA con modelo de desvío de tráfico\?'/g, replace: "t('miles.confirm_generate')" },
    
    { search: /json\.message \|\| 'Matriz de distancias actualizada desde Mapa'/g, replace: "json.message || t('miles.matrix_updated')" },
    { search: /json\.error \|\| 'Error al actualizar matriz'/g, replace: "json.error || t('miles.error_matrix')" },
    { search: /err\.message \|\| 'Error en auto-cálculo'/g, replace: "err.message || t('miles.error_auto_calc')" },
    { search: /language === 'en' \? 'Distance pair saved to matrix' : 'Par de sucursales guardado en la matriz'/g, replace: "t('miles.distance_saved')" },
    { search: /language === 'en' \? 'Send Report to HR' : 'Enviar Resumen a RRHH'/g, replace: "t('miles.send_report')" },

    // HR Dispatch Tab hardcoded
    { search: />Despacho a RRHH</g, replace: ">{t('miles.hr_dispatch_title')}<" },
    { search: />Envío de reporte para nómina</g, replace: ">{t('miles.hr_dispatch_subtitle')}<" },
    { search: />\s*Remitente \(Sesión Activa\):\s*</g, replace: ">\n                  {t('miles.sender_label')}\n                <" },
    { search: />\s*Período de Nómina:\s*</g, replace: ">\n                  {t('miles.payroll_period')}\n                <" },
    { search: />Desde:</g, replace: ">{t('miles.from')}<" },
    { search: />Hasta:</g, replace: ">{t('miles.to')}<" },
    { search: />\s*Destinatario \(RRHH \/ Nómina\):\s*</g, replace: ">\n                  {t('miles.recipient_label')}\n                <" },
    { search: />Correos Recurrentes \/ Frecuentes:</g, replace: ">{t('miles.recurrent_emails')}<" },
    { search: />O escribe un correo nuevo:</g, replace: ">{t('miles.custom_email')}<" },
    { search: />Resumen de Reembolsos por Supervisor</g, replace: ">{t('miles.summary_title')}<" },
    { search: />Millas acumuladas para el período seleccionado</g, replace: ">{t('miles.summary_subtitle')}<" },
    { search: /\{supervisorSummaries\.length\} Supervisores/g, replace: "{supervisorSummaries.length} {t('miles.supervisors_unit')}" },
    
    // Table headers hr dispatch
    { search: /<th className="py-3 px-4">Supervisor<\/th>/g, replace: '<th className="py-3 px-4">{t(\'miles.th_supervisor\')}</th>' },
    { search: /<th className="py-3 px-4 text-center">Viajes<\/th>/g, replace: '<th className="py-3 px-4 text-center">{t(\'miles.th_trips\')}</th>' },
    { search: /<th className="py-3 px-4 text-right">Millas Totales<\/th>/g, replace: '<th className="py-3 px-4 text-right">{t(\'miles.th_total_miles\')}</th>' },
    { search: /<th className="py-3 px-4 text-right">Parking<\/th>/g, replace: '<th className="py-3 px-4 text-right">{t(\'miles.th_parking\')}</th>' },
    { search: /<th className="py-3 px-4 text-right">Tolls<\/th>/g, replace: '<th className="py-3 px-4 text-right">{t(\'miles.th_tolls\')}</th>' },
    { search: /<th className="py-3 px-4 text-right">Total Reembolso<\/th>/g, replace: '<th className="py-3 px-4 text-right">{t(\'miles.th_total_reimbursement\')}</th>' },
    { search: />\s*No hay datos registrados para el período seleccionado\.\s*</g, replace: ">\n                          {t('miles.no_data_period')}\n                        <" },
    
    // History Tab
    { search: />Bitácora Histórica de Envíos a RRHH</g, replace: ">{t('miles.history_title')}<" },
    { search: />Registro auditado de reportes de nómina despachados</g, replace: ">{t('miles.history_subtitle')}<" },
    { search: /Bitácora de envíos a RRHH activa\. Cada lote enviado registrará fecha, remitente, correo destino y total pagado\./g, replace: "{t('miles.history_empty')}" },

    // Settings Tab
    { search: />Tarifa Oficial por Milla</g, replace: ">{t('miles.rate_title')}<" },
    { search: />Configuración global del valor por milla \(IRS Standard\)</g, replace: ">{t('miles.rate_subtitle')}<" },
    { search: />USD \/ milla</g, replace: ">{t('miles.rate_unit')}<" },
    { search: />\s*Guardar Tarifa\s*</g, replace: ">\n                  {t('miles.save_rate')}\n                <" },
    { search: /<p className="text-xs text-slate-400">\s*La tarifa por defecto observada en los reportes reales de supervisores es de <strong>\$0\.725 USD por milla<\/strong>\.\s*<\/p>/g, replace: '<p className="text-xs text-slate-400" dangerouslySetInnerHTML={{ __html: t(\'miles.rate_note\') }} />' },
    { search: />Matriz de Distancias Estándar</g, replace: ">{t('miles.matrix_title')}<" },
    { search: />Par de tiendas con millas sugeridas \(Ruta intermedia con desvío de tráfico\)</g, replace: ">{t('miles.matrix_subtitle')}<" },
    { search: /language === 'en' \? 'Auto-Generate Matrix from Map' : 'Generar Matriz con Mapa IA'/g, replace: "t('miles.generate_matrix')" },
    
    { search: /placeholder="Origen \(ej\. Central Gavilan\)"/g, replace: "placeholder={t('miles.origin_placeholder')}" },
    { search: /placeholder="Destino \(ej\. Broadway Gavilan\)"/g, replace: "placeholder={t('miles.dest_placeholder')}" },
    { search: /placeholder="Millas \(ej\. 3\.2\)"/g, replace: "placeholder={t('miles.miles_placeholder')}" },
    
    { search: />\s*Agregar Ruta Estándar\s*</g, replace: ">\n                    {t('miles.add_route')}\n                  <" },
    { search: /<th className="py-2 px-3">Origen<\/th>/g, replace: '<th className="py-2 px-3">{t(\'miles.th_origin\')}</th>' },
    { search: /<th className="py-2 px-3">Destino<\/th>/g, replace: '<th className="py-2 px-3">{t(\'miles.th_dest\')}</th>' },
    { search: /<th className="py-2 px-3 text-right">Millas<\/th>/g, replace: '<th className="py-2 px-3 text-right">{t(\'miles.th_miles\')}</th>' },

    // Email Placeholder
    { search: /placeholder="rrhh@tacosgavilan\.com"/g, replace: 'placeholder="email@tacosgavilan.com"' },
  ];

  pageReplacements.forEach(r => {
    pageContent = pageContent.replace(r.search, r.replace);
  });
  
  fs.writeFileSync(pageFile, pageContent);

  const modalFile = 'c:/Users/pedro/Desktop/teg-modernizado/components/miles/TripModal.tsx';
  let modalContent = fs.readFileSync(modalFile, 'utf8');

  const modalReplacements = [
    { search: /language === 'en' \? 'Log New Trip \(MilesIQ\)' : 'Registrar Nuevo Viaje \(MilesIQ\)'/g, replace: "t('miles.modal_title')" },
    { search: /language === 'en' \? 'Track business drives and calculate reimbursement' : 'Captura de recorrido para cálculo de millas y reembolso'/g, replace: "t('miles.modal_subtitle')" },
    { search: /language === 'en' \? 'Supervisor \(Driver\)' : 'Supervisor \(Conductor\)'/g, replace: "t('miles.supervisor_driver')" },
    { search: /\(\{s\.email \|\| 'Sin correo'\}\)/g, replace: "({s.email || t('miles.no_email')})" },
    { search: /language === 'en' \? 'Date' : 'Fecha'/g, replace: "t('miles.date')" },
    { search: /language === 'en' \? 'Time \(Optional\)' : 'Hora \(Opcional\)'/g, replace: "t('miles.time_optional')" },
    { search: /language === 'en' \? 'Route Information' : 'Información de la Ruta'/g, replace: "t('miles.route_info')" },
    { search: /language === 'en' \? 'Round Trip \(Ida y vuelta\)' : 'Ida y Vuelta \(x2\)'/g, replace: "t('miles.round_trip')" },
    { search: /language === 'en' \? 'Origin \(Start\)' : 'Origen \(Inicio\)'/g, replace: "t('miles.origin_start')" },
    { search: /language === 'en' \? 'Destination \(End\)' : 'Destino \(Llegada\)'/g, replace: "t('miles.destination_end')" },
    { search: /language === 'en' \? 'Distance \(Miles\)' : 'Millas Recorridas'/g, replace: "t('miles.distance_miles_label')" },
    { search: /language === 'en' \? 'Recalculate Map Route' : 'Recalcular con Mapa IA'/g, replace: "t('miles.recalculate_map')" },
    { search: /language === 'en' \? 'Odometer Start' : 'Odómetro Inicial'/g, replace: "t('miles.odometer_start')" },
    { search: /language === 'en' \? 'Odometer End' : 'Odómetro Final'/g, replace: "t('miles.odometer_end')" },
    { search: /language === 'en' \? 'Parking \(\$ USD\)' : 'Estacionamiento \(\$ USD\)'/g, replace: "t('miles.parking_usd')" },
    { search: /language === 'en' \? 'Tolls \(\$ USD\)' : 'Peajes \/ Casetas \(\$ USD\)'/g, replace: "t('miles.tolls_usd')" },
    { search: /language === 'en' \? 'Classification' : 'Clasificación'/g, replace: "t('miles.classification')" },
    
    // Select options classification
    { search: /language === 'en' \? 'Business \(Negocio\)' : 'Negocios \(Business\)'/g, replace: "t('miles.purpose_business')" },
    { search: /language === 'en' \? 'Personal' : 'Personal'/g, replace: "t('miles.purpose_personal')" },
    { search: /language === 'en' \? 'Commute \(Traslado\)' : 'Traslado Diario'/g, replace: "t('miles.purpose_commute')" },
    
    { search: /language === 'en' \? 'Notes \/ Details' : 'Motivo \/ Detalles del Viaje'/g, replace: "t('miles.notes_label')" },
    { search: /placeholder=\{language === 'en' \? 'e\.g\. Shift inspection and inventory check' : 'ej\. Inspección de turno y conteo de caja'\}/g, replace: "placeholder={t('miles.notes_placeholder')}" },
    { search: /language === 'en' \? 'Calculated Reimbursement' : 'Reembolso Calculado'/g, replace: "t('miles.calculated_reimbursement')" },
    { search: /language === 'en' \? 'Save Trip' : 'Guardar Viaje'/g, replace: "t('miles.save_trip')" },
    { search: /'Matriz de distancias estándar'/g, replace: "t('miles.standard_matrix')" },
    { search: /'Ruta intermedia balanceada \(evasión de tráfico\)'/g, replace: "t('miles.traffic_route')" },
  ];

  modalReplacements.forEach(r => {
    modalContent = modalContent.replace(r.search, r.replace);
  });
  
  fs.writeFileSync(modalFile, modalContent);
  console.log("Done replacing.");
}

replaceAll();
