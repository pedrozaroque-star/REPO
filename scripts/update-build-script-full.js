const fs = require('fs');

const augustRowsUpdated = [
    {
        date: '01-Ago-2026',
        time: '6:30 PM - 11:00 PM',
        hours: 4.5,
        badges: ['Preparador', 'Soporte IA'],
        descEs: '• <strong>Preparador (Proyecciones por Tramos & Live Data)</strong>: Transición completa de las proyecciones de carne de intervalos de 30 min a bloques de tramos de hora pico. Forzado de HTTP no-store para refresco en tiempo real.<br>• <strong>Preparador (🔥 Máx. Charola & Guía Operativa)</strong>: Nuevo badge de capacidad máxima de charola por tarjeta de proteína y modal interactivo de guía operativa.<br>• <strong>Soporte IA</strong>: Sincronización del prompt del asistente con las capacidades del preparador.',
        descEn: '• <strong>Prep Line (Period Blocks & Live Data)</strong>: Full transition of meat projections to peak period blocks. Zero-cache HTTP fetching for real-time sync.<br>• <strong>Prep Line (🔥 Max Tray & Operational Guide)</strong>: Max holding tray capacity badge and interactive operational guide modal.<br>• <strong>AI Support</strong>: Synced assistant prompt with new prep line capabilities.'
    },
    {
        date: '02-Ago-2026',
        time: '5:00 PM - 6:00 PM',
        hours: 1.0,
        badges: ['Preparador'],
        descEs: '• <strong>Preparador (Modo Básico vs Avanzado)</strong>: Conmutador de visualización para tarjetas limpias de un solo número.<br>• <strong>Preparador (Modo Tableta Kiosko)</strong>: Badge TABLETA prominente y ocultamiento de botones no operativos en pantalla completa.',
        descEn: '• <strong>Prep Line (Basic vs Advanced Mode)</strong>: Display switch for clean single-number cards.<br>• <strong>Prep Line (Tablet Kiosk Mode)</strong>: Prominent TABLETA badge and hidden non-operational buttons in fullscreen.'
    },
    {
        date: '03-Ago-2026',
        time: '4:42 PM - 7:04 PM & 9:30 PM - 11:10 PM',
        hours: 3.92,
        badges: ['Inventario', 'QuickBooks'],
        descEs: '• <strong>Inventario (QuickBooks Estimates)</strong>: Corrección crítica en la actualización de presupuestos configurando sparse: false para prevenir que QBO elimine ítems no enviados durante guardados parciales diarios.<br>• <strong>Preservación de Estado</strong>: Soporte para ítems extraordinarios en el estado local de React.',
        descEn: '• <strong>Inventory (QuickBooks Estimates)</strong>: Critical fix for QBO Estimate updates with sparse: false to prevent item truncation during partial daily saves.<br>• <strong>State Preservation</strong>: Retained extraordinary items in React local state.'
    },
    {
        date: '04-Ago-2026',
        time: '9:45 AM - 2:00 PM & 6:30 PM - 11:15 PM',
        hours: 9.0,
        badges: ['Preparador', 'Inventario', 'Reportes'],
        descEs: '• <strong>Reporte Julio</strong>: Consolidación final del informe de julio con 117.80 hrs.<br>• <strong>Preparador (Edición Táctil & Modo Semanal)</strong>: Modo de sobreescritura manual tap-to-edit y selector de 3 modos [Manual | Básica | Avanzada] persistente en base de datos.<br>• <strong>Inventario (PAR Semanal)</strong>: Corrección de actualizaciones inmediatas de PAR para tipos de orden de Líquidos y Uniformes.',
        descEn: '• <strong>July Report</strong>: Finalized July report at 117.80 hrs.<br>• <strong>Prep Line (Touch Edit & Weekly Mode)</strong>: Tap-to-edit manual overrides and 3-mode toggle [Manual | Basic | Advanced] persisted to database.<br>• <strong>Inventory (Weekly PAR)</strong>: Fixed immediate PAR updates for Liquids and Uniforms orders.'
    },
    {
        date: '05-Ago-2026',
        time: '2:15 PM - 3:53 PM',
        hours: 1.64,
        badges: ['Preparador', 'Reportes'],
        descEs: '• <strong>Preparador (Optimización Gráfica)</strong>: Ajuste de contraste y tipografía para legibilidad a larga distancia en cocina.<br>• <strong>Reportes de Rendimiento</strong>: Estabilización de cálculos de rendimiento de carne por hora.',
        descEn: '• <strong>Prep Line (Visual Optimization)</strong>: High-contrast typography adjustments for long-distance kitchen readability.<br>• <strong>Yield Reports</strong>: Stabilized meat yield hourly calculations.'
    },
    {
        date: '06-Ago-2026',
        time: '12:30 PM - 1:45 PM & 9:30 PM - 10:00 PM',
        hours: 1.75,
        badges: ['Preparador', 'Base de Datos'],
        descEs: '• <strong>Preparador (Sincronización Tableta-PC)</strong>: Integración de polling cada 10s para paridad de cocina con PC del gerente.<br>• <strong>Base de Datos</strong>: Migración de tabla prep_manual_schedule a producción y compatibilidad de IDs numéricos/texto.',
        descEn: '• <strong>Prep Line (Tablet-PC Sync)</strong>: 10s polling for manager PC parity.<br>• <strong>Database</strong>: Migrated prep_manual_schedule table to production and normalized storeId parsing.'
    },
    {
        date: '07-Ago-2026',
        time: '2:30 PM - 5:02 PM',
        hours: 2.54,
        badges: ['Horarios', 'Descansos IA'],
        descEs: '• <strong>Horarios (Notificaciones de Violaciones)</strong>: Habilitación de alertas por correo para violaciones de descansos de comida (Lunch Breaks) bajo normativa laboral de California.<br>• <strong>Descansos IA</strong>: Calibración del motor predictivo para asignar descansos antes de la 5ta hora de trabajo.',
        descEn: '• <strong>Schedules (Violation Notifications)</strong>: Automated email alerts for CA lunch break violations.<br>• <strong>Breaks AI</strong>: Calibrated engine to assign breaks before the 5th working hour.'
    },
    {
        date: '08-Ago-2026',
        time: '10:00 AM - 1:30 PM & 6:00 PM - 9:45 PM',
        hours: 7.15,
        badges: ['Ventas Toast API', 'Descansos IA'],
        descEs: '• <strong>Ventas (Toast API & Conciliación Neta)</strong>: Conciliación de ventas netas, soporte de descuentos prorrateados y Party Trays a escala.<br>• <strong>Descansos Laborales (Regla de Salida Temprana)</strong>: Implementación de la prioridad de descansos para turnos con salida anticipada.',
        descEn: '• <strong>Sales (Toast API Reconciliation)</strong>: Reconciled net sales, prorated discount handling, and scaled Party Trays.<br>• <strong>Breaks (Early Exit Rule)</strong>: Prioritized breaks for early departure shifts.'
    },
    {
        date: '09-Ago-2026',
        time: '11:00 AM - 1:45 PM',
        hours: 2.74,
        badges: ['Preparador', 'Telemetría'],
        descEs: '• <strong>Preparador (Auto-Refresh & Acelerador)</strong>: Ajuste del acelerador intradía de carne contra curvas de ventas históricas.<br>• <strong>Telemetría de Cocina</strong>: Diagnóstico de tiempos de respuesta en tablets de cocina.',
        descEn: '• <strong>Prep Line (Auto-Refresh & Accelerator)</strong>: Adjusted intraday meat pace against historical curves.<br>• <strong>Kitchen Telemetry</strong>: Diagnosed kitchen tablet response times.'
    },
    {
        date: '10-Ago-2026',
        time: '4:15 PM - 6:33 PM',
        hours: 2.3,
        badges: ['Actividades', 'Descansos IA', 'Tech Packs RFQ'],
        descEs: '• <strong>Actividades (Asignación Diaria)</strong>: Filtrado de empleados en combos por sucursal activa en AsignacionDiariaTab, excluyendo perfiles directivos y respetando empleados en vacaciones.<br>• <strong>Descansos IA</strong>: Soporte para adición y eliminación manual de descansos en turnos menores o iguales a 6 horas.<br>• <strong>Tech Packs RFQ</strong>: Planificación de fichas técnicas para menudeo y comercialización de insumos.',
        descEn: '• <strong>Activities (Daily Assignment)</strong>: Filtered employee dropdowns strictly by store, hiding corporate users while retaining returning vacation staff.<br>• <strong>Breaks AI</strong>: Manual break add/remove for shifts <= 6h.<br>• <strong>Tech Packs RFQ</strong>: Initial specs for wholesale and retail items.'
    },
    {
        date: '11-Ago-2026',
        time: '9:15 AM - 10:30 AM & 6:45 PM - 8:41 PM',
        hours: 3.18,
        badges: ['Caja Fuerte', 'Uniformes', 'Tech Packs Viele'],
        descEs: '• <strong>Caja Fuerte (Edición de Historial)</strong>: Habilitación de edición de registros históricos de corte para supervisores y admins en pestaña Historial para corrección de capturas erróneas.<br>• <strong>Uniformes & Sidebar</strong>: Asignación de badge NEW en barra lateral al módulo de Control de Uniformes.<br>• <strong>Tech Packs & Proveedores</strong>: Redacción de especificaciones de 21 productos desechables y solicitud formal a Viele & Sons.',
        descEn: '• <strong>Safe Counts (History Edit)</strong>: Permitted supervisors/admins to edit past cash count logs to fix entry mistakes.<br>• <strong>Uniforms & Sidebar</strong>: Assigned NEW badge to Uniforms module in sidebar.<br>• <strong>Tech Packs & Vendors</strong>: Drafted 21 disposables spec sheets and formal request to Viele & Sons.'
    },
    {
        date: '12-Ago-2026',
        time: '10:30 AM - 1:45 PM & 7:00 PM - 8:05 PM',
        hours: 4.33,
        badges: ['Uniformes Bodega', 'Tech Packs Desechables'],
        descEs: '• <strong>Inventario & Uniformes</strong>: Sincronización automática de PAR de uniformes con stock mínimo de tienda y Sobrante en tiempo real en Pedidos de Bodega.<br>• <strong>i18n Bilingüe</strong>: Corrección de clave de traducción faltante bodegaOrders.inStock.<br>• <strong>Tech Packs</strong>: Investigación técnica exhaustiva de materiales, dimensiones y empaques para 22 insumos desechables.',
        descEn: '• <strong>Inventory & Uniforms</strong>: Auto-synced uniform PAR with minimum stock and real-time on-hand inventory in Bodega Orders.<br>• <strong>Bilingual i18n</strong>: Fixed missing bodegaOrders.inStock translation key.<br>• <strong>Tech Packs</strong>: Technical research on materials, dimensions, and packaging for 22 disposable products.'
    },
    {
        date: '13-Ago-2026',
        time: '8:45 AM - 10:00 AM & 4:30 PM - 8:00 PM & 8:15 PM - 9:45 PM',
        hours: 6.45,
        badges: ['MilesIQ Supervisores', 'Champurrado Forecast'],
        descEs: '• <strong>MilesIQ (Módulo de Millas Supervisores)</strong>: Creación completa del módulo MilesIQ: registro de viajes, geocodificación de sucursales, despacho consolidado a RRHH, control de acceso por rol y edición de viajes pendientes.<br>• <strong>Champurrado Forecast</strong>: Motor de pronóstico estacional a 5 años en /api/inventory/champurrado-forecast, carrusel de cocina trasera y corrección de conversión (1 galón = 8 lbs).',
        descEn: '• <strong>MilesIQ (Supervisor Mileage)</strong>: Complete MilesIQ module build: trip logging, store geocoding, HR payroll dispatch, role access, and pending trip editing.<br>• <strong>Champurrado Forecast</strong>: 5-year seasonal forecasting engine at /api/inventory/champurrado-forecast, back kitchen carousel, and gallon conversion fix (1 gal = 8 lbs).'
    },
    {
        date: '14-Ago-2026',
        time: '—',
        hours: 0.0,
        badges: ['Descanso Operativo'],
        descEs: '• <strong>Día de Descanso Operativo</strong>: Sin actividad de desarrollo en el sistema.',
        descEn: '• <strong>Operational Rest Day</strong>: No development activity recorded.'
    },
    {
        date: '15-Ago-2026',
        time: '3:00 PM - 5:30 PM & 7:30 PM - 9:56 PM',
        hours: 4.94,
        badges: ['Uniformes Stock', 'Análisis Viele 87 CSV'],
        descEs: '• <strong>Control de Uniformes</strong>: Editor individual de stock por prenda/talla (EditItemStockModal), deducción resiliente en intercambios por daño y bloqueo de doble recepción de órdenes.<br>• <strong>Análisis de Costos Viele & Sons</strong>: Auditoría exhaustiva de la guía de órdenes (87 productos) con histórico de fluctuaciones de precios 2025.',
        descEn: '• <strong>Uniforms Stock</strong>: Individual item stock editor per size/garment, resilient damage exchange deductions, and duplicate reception locking.<br>• <strong>Viele Cost Analysis</strong>: Comprehensive audit of 87-item Viele Order Guide with 2025 price fluctuation history.'
    },
    {
        date: '16-Ago-2026',
        time: '12:00 PM - 4:15 PM & 6:30 PM - 9:15 PM',
        hours: 6.96,
        badges: ['MilesIQ GPS', 'Uniformes Store Lock', 'Planificador Calendar Sync'],
        descEs: '• <strong>MilesIQ (Navegación GPS de 1 Toque)</strong>: Lanzadores móviles directos para Google Maps, Apple Maps y Waze con autoguardado de viaje, autoselección de sucursal origen y tarifa fiscal IRS ($0.760/milla).<br>• <strong>Uniformes</strong>: Bloqueo de sesión para gerentes de tienda a su sucursal asignada.<br>• <strong>Planificador</strong>: Sincronización móvil a calendarios (.ics / Google Calendar / Apple Calendar) para turnos de empleados.<br>• <strong>Preparador</strong>: Throttle de rueda de mouse/trackpad (400ms) para laptops.',
        descEn: '• <strong>MilesIQ (1-Tap GPS Navigation)</strong>: Direct mobile launchers for Google Maps, Apple Maps, Waze with trip auto-save, origin autodetect, and IRS rate ($0.760/mi).<br>• <strong>Uniforms</strong>: Locked store manager sessions strictly to assigned store.<br>• <strong>Planner</strong>: Mobile calendar sync (.ics / Google / Apple Calendar) for employee shifts.<br>• <strong>Prep Line</strong>: 400ms mouse wheel throttle for laptop trackpads.'
    },
    {
        date: '17-Ago-2026',
        time: '4:45 AM - 5:45 AM & 2:30 PM - 5:56 PM',
        hours: 4.43,
        badges: ['Radar de Precios Viele 87', 'Planificador Violaciones Cron', 'Tech Packs Insumos'],
        descEs: '• <strong>Radar de Precios de Proveedores</strong>: Lanzamiento del módulo /admin/precios-proveedores con catálogo de 87 insumos Viele & Sons y cálculo de impacto COGS anual a nivel cadena.<br>• <strong>Planificador (Cron de Violaciones)</strong>: Cron automatizado de las 11:59 AM (/api/cron/sync-daily-violations) para detección de anomalías de asistencia en Toast.<br>• <strong>Tech Packs de Insumos</strong>: Generación de reportes PDF desglosados de compras por categoría (Beef, Milk, Desechables).',
        descEn: '• <strong>Supplier Price Radar</strong>: Launched /admin/precios-proveedores with 87-item Viele catalog and annual COGS chain impact calculator.<br>• <strong>Planner (Violations Cron)</strong>: Automated 11:59 AM cron (/api/cron/sync-daily-violations) for Toast attendance anomaly detection.<br>• <strong>Item Tech Packs</strong>: Generated category-specific PDF purchasing reports (Beef, Milk, Packaging).'
    },
    {
        date: '18-Ago-2026',
        time: '11:00 AM - 1:30 PM & 5:00 PM - 7:53 PM',
        hours: 5.39,
        badges: ['Radar de Precios Scraper Viele v3', 'Cron Semanal', 'Tech Pack Calibración', 'Uniformes Orders'],
        descEs: '• <strong>Radar de Precios (Scraper Viele v3 & Cron)</strong>: Scraper automático en vivo (/api/inventory/supplier-prices/sync) y cron semanal de detección de inflación.<br>• <strong>Radar de Precios (Nuevos Proveedores)</strong>: Modal para registro y mapeo de distribuidores alternativos.<br>• <strong>Calibración de Precios</strong>: Ajuste de precios base Dic 2025 del Tech Pack oficial.<br>• <strong>Pedidos & Uniformes</strong>: Eliminación de race conditions en edición de PAR y blindaje contra concatenación de texto en recepción.',
        descEn: '• <strong>Price Radar (Viele v3 Scraper & Cron)</strong>: Live automated scraper (/api/inventory/supplier-prices/sync) and weekly inflation detection cron.<br>• <strong>Price Radar (New Vendors)</strong>: Modal for registering and mapping alternative suppliers.<br>• <strong>Price Calibration</strong>: Calibrated Dec 2025 baseline prices from official Tech Pack.<br>• <strong>Orders & Uniforms</strong>: Eliminated PAR edit race conditions and guarded against string concatenation on order reception.'
    },
    {
        date: '19-Ago-2026',
        time: '9:44 AM - 12:30 PM & 3:15 PM - 5:11 PM',
        hours: 4.7,
        badges: ['Actividades & Checklists', 'Control de Uniformes & Caja Fuerte', 'Radar de Precios COGS', 'Basecamp Sync'],
        descEs: '• <strong>Actividades & Checklists (Auditoría Integral)</strong>: Auditoría exhaustiva paso a paso de AsignacionDiariaTab.tsx, ChecklistMode.tsx y ReportesChecklistTab.tsx, corrigiendo estados de carga y selectores de empleados.<br>• <strong>Control de Uniformes & Caja Fuerte</strong>: Conciliación de ventas en efectivo de uniformes con la bóveda de Caja Fuerte y reversión física en anulaciones.<br>• <strong>Radar de Precios & Food Cost</strong>: Conexión de precios de insumos con el cálculo automático de Food Cost y resolución de 17 observaciones de auditoría.<br>• <strong>Basecamp Sync</strong>: Estabilización de la sincronización de comentarios y documentos.',
        descEn: '• <strong>Activities & Checklists (Full Audit)</strong>: Step-by-step audit of AsignacionDiariaTab.tsx, ChecklistMode.tsx, ReportesChecklistTab.tsx, fixing loading states and employee selectors.<br>• <strong>Uniforms & Safe Box</strong>: Reconciled cash uniform sales with Safe vault and automated stock reversal on voided transactions.<br>• <strong>Price Radar & Food Cost</strong>: Linked vendor ingredient prices to dynamic Food Cost recalculation and resolved 17 audit items.<br>• <strong>Basecamp Sync</strong>: Stabilized comments and documents synchronization.'
    },
    {
        date: '20-Ago-2026',
        time: '6:15 AM - 9:30 AM & 8:00 PM - 11:44 PM',
        hours: 6.98,
        badges: ['Basecamp UX (Cards/List)', 'MilesIQ (Gap Detector & Canonical Maps)', 'Procedimientos Sorting'],
        descEs: '• <strong>Basecamp (Selector View as Cards / List)</strong>: Visualización de to-dos en cuadrícula moderna o lista compacta con avatares y conteo de comentarios.<br>• <strong>MilesIQ (Detector de Rutas Faltantes & Geofencing)</strong>: Banner inteligente "Gap Detector" que resalta viajes omitidos y sincronización canónica de coordenadas de las 15 tiendas con tacosgavilan.com.<br>• <strong>Procedimientos</strong>: Ordenamiento cronológico de fotos e inspecciones.<br>• <strong>Radar de Precios</strong>: Auditoría exhaustiva 35/35 de todas las recetas maestras de la cadena.',
        descEn: '• <strong>Basecamp (Cards / List View Switcher)</strong>: Modern grid/list task views with avatars and comment counts.<br>• <strong>MilesIQ (Gap Detector & Canonical Maps)</strong>: Smart banner detecting missed trips and canonical geofence synchronization of all 15 stores from tacosgavilan.com.<br>• <strong>Procedures</strong>: Chronological sorting of inspection photos.<br>• <strong>Price Radar</strong>: 35/35 exhaustive audit on all master recipes.'
    },
    {
        date: '21-Ago-2026',
        time: '6:09 AM - 8:30 AM & 11:30 AM - 1:45 PM & 4:30 PM - 5:30 PM & 7:15 PM - 9:30 PM',
        hours: 7.85,
        badges: ['Radar de Precios (Alertas & Scraper Viele v3)', 'MilesIQ & Chatbot Overlap', 'Descansos IA', 'Basecamp 4'],
        descEs: '• <strong>Radar de Precios (Alertas Ejecutivas & Despacho a Directivos)</strong>: Diseño y programación de la plantilla HTML ejecutiva para alertas de fluctuaciones de precios de Viele & Sons. Despacho por correo a los 4 directivos (Roberto, Raquel, Gonzalo y Carlos) con métricas de impacto anual a nivel cadena ($ USD), enlaces directos a /admin/precios-proveedores y envío de correo oficial de presentación con PDF adjunto.<br>• <strong>Radar de Precios (Scraper Viele & Sons v3)</strong>: Blindaje del scraper de la API REST de Viele y manejo seguro de credenciales con fallback preventivo.<br>• <strong>MilesIQ & UI Chatbot</strong>: Reubicación del toast de actualizaciones a la parte inferior-central para evitar solapamientos con el botón flotante del asistente.<br>• <strong>Descansos IA (Motor de Aprendizaje)</strong>: Auditoría y optimización de sugerencias de breaks respetando la regla de salidas tempranas.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Modal flotante con desenfoque de fondo para visualización de tareas.',
        descEn: '• <strong>Price Radar (Executive Alerts & Management Dispatch)</strong>: Designed and implemented executive HTML email template for Viele & Sons price changes. Deployed email dispatch to 4 directors (Roberto, Raquel, Gonzalo, Carlos) with annual chain-wide financial impact ($ USD), direct links to /admin/precios-proveedores, and sent official presentation email with attached PDF.<br>• <strong>Price Radar (Viele & Sons v3 Scraper)</strong>: Hardened Viele REST API scraper and secured credential handling.<br>• <strong>MilesIQ & Chatbot UI</strong>: Repositioned update toast to bottom-center to prevent floating chatbot button overlap.<br>• <strong>Breaks AI (Learning Engine)</strong>: Audited and refined break suggestions honoring early-departure manager rules.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Floating modal with blurred backdrop for task viewing.'
    },
    {
        date: '22-Ago-2026',
        time: '10:00 AM - 12:30 PM & 3:15 PM - 5:15 PM & 5:20 PM - 7:30 PM & 9:15 PM - 12:50 AM',
        hours: 10.5,
        badges: ['Ventas Toast API (Bell $8,332.64)', 'Descansos IA Audit', 'Uniformes Stock Mínimo', 'MilesIQ GPS & Generated Columns', 'Módulo Admin HTML', 'Gantt Unificado'],
        descEs: '• <strong>Ventas (Toast API & Conciliación Bell $8,332.64)</strong>: Diagnóstico y resolución de discrepancia de ventas en Bell. Identificación de reembolsos de fechas cruzadas (Cross-Date Refunds de Party Trays) y soporte EBT para cuadre al centavo.<br>• <strong>Descansos Laborales (Auditoría Integral LÍNEA POR LÍNEA)</strong>: Corrección de solapamiento visual de popups en logs de descansos, blindaje del motor de pausas y auditoría de violaciones de California.<br>• <strong>Uniformes & Caja Fuerte</strong>: Auditoría y blindaje de la tabla de stock mínimo (660 registros en BD para las 15 tiendas) y conciliación del flujo de ventas en efectivo con la Caja Fuerte.<br>• <strong>MilesIQ Supervisores (GPS & Columnas Generadas)</strong>: Blindaje contra error fatal PostgreSQL 428C9 omitiendo columnas autocalculadas en payloads de inserción, optimización de interpolación de rutas y captura a 1 toque.<br>• <strong>Módulo Admin de Reportes HTML (/admin/reporte-actividades)</strong>: Creación del visor interactivo exclusivo para Administradores con pestañas dinámicas para alternar entre Junio, Julio y Agosto sin requerir PDFs estáticos.<br>• <strong>Unificación de Líneas de Tiempo Gantt</strong>: Recreación y sincronización de las pistas cronológicas (4:00 AM - 12:00 AM) para los 3 reportes mensuales con doble carril (Tienda Lynwood y Dev TEG).',
        descEn: '• <strong>Sales (Toast API & Bell Reconciliation $8,332.64)</strong>: Solved Bell sales discrepancy by handling cross-date party tray refunds and EBT items.<br>• <strong>Labor Breaks (Full LINE-BY-LINE Audit)</strong>: Fixed visual tooltip overlap on lunch/break logs and automated CA meal break violation auditing.<br>• <strong>Uniforms & Safe Box</strong>: Audited and locked 660 minimum stock DB records across all 15 stores with cash sale reconciliation.<br>• <strong>MilesIQ (GPS & PostgreSQL Generated Columns)</strong>: Guarded against Postgres 428C9 error by omitting computed columns in insertion payloads, route gap optimization, and 1-tap logging.<br>• <strong>Admin HTML Reports Viewer (/admin/reporte-actividades)</strong>: Built interactive Admin-exclusive viewer with month switching tabs, eliminating static PDFs.<br>• <strong>Unified Gantt Timelines</strong>: Recreated and synced 4 AM - 12 AM dual-track schedules across all 3 monthly reports.'
    },
    {
        date: '23-Ago-2026',
        time: '12:00 AM - 1:15 AM & 6:30 AM - 8:30 AM',
        hours: 3.25,
        badges: ['MilesIQ (Filtro Supervisores)', 'Planificador Turnos Reales Lynwood', 'Auditoría Forense Multi-Chat'],
        descEs: '• <strong>MilesIQ (Sincronización de Inspecciones & Filtro de Supervisores)</strong>: Filtrado estricto por supervisor activo, excluyendo evaluadores programados para septiembre (Ricardo y Estefani) y prevención de viajes redundantes cuando ya existe ruta multitienda.<br>• <strong>Planificador (Sincronización Dinámica de Turnos Reales)</strong>: Conexión con la tabla shifts de Supabase para extraer los 75 turnos exactos de Carlos Velazquez como General Manager de Lynwood #14 por día de la semana (Sábados 2-9 PM, Domingos 2-7 PM, Lunes 12-8 PM, Martes 2-10 PM, Miércoles OFF, Jueves 9 AM-5 PM, Viernes 2-9 PM) en la pista visual del Gantt.<br>• <strong>Auditoría Forense Multi-Chat Día por Día</strong>: Consolidación exhaustiva de todas las conversaciones concurrentes del mes de agosto, incorporando actividades de Tech Packs, Radar de Precios, Basecamp, Uniformes y Horarios.',
        descEn: '• <strong>MilesIQ (Inspection Sync & Active Supervisor Filter)</strong>: Strictly filtered active store supervisors, excluding upcoming Sept 1 testers, and prevented redundant direct trips when multi-leg routes exist.<br>• <strong>Planner (Dynamic Manager Shifts Sync)</strong>: Connected Supabase shifts table to display Carlos Velazquez\'s exact 75 Lynwood #14 General Manager shift schedules per day of week on Gantt Track 1.<br>• <strong>Multi-Chat Day-by-Day Forensic Audit</strong>: Full consolidation of concurrent August conversation sessions, integrating Tech Packs, Price Radar, Basecamp, Uniforms, and Schedule activities.'
    }
];

// Read and update build-authentic-accurate-reports.js
let buildScript = fs.readFileSync('scripts/build-authentic-accurate-reports.js', 'utf-8');

// Replace augustRows
buildScript = buildScript.replace(/const augustRows = \[[\s\S]*?\n\];/, `const augustRows = ${JSON.stringify(augustRowsUpdated, null, 4)};`);

// Update augustConfig
buildScript = buildScript.replace(/totalHours:\s*[\d\.]+,\s*rows:\s*augustRows,/, `totalHours: 105.50,\n    rows: augustRows,`);

// Update effortSummary
const effortSummaryUpdated = [
    { module: 'Preparador de Carne y Cocina KDS', hours: 24.5 },
    { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 19.25 },
    { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
    { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
    { module: 'Radar de Precios Viele v3 & Auditoría COGS', hours: 11.5 },
    { module: 'Control de Uniformes & Caja Fuerte', hours: 11.5 },
    { module: 'Mantenimiento General, Crons y Reportes', hours: 7.75 }
];

buildScript = buildScript.replace(/effortSummary:\s*\[[\s\S]*?\n\s*\],/, `effortSummary: ${JSON.stringify(effortSummaryUpdated, null, 8)},`);

fs.writeFileSync('scripts/build-authentic-accurate-reports.js', buildScript, 'utf-8');
console.log('✅ Updated scripts/build-authentic-accurate-reports.js successfully!');
