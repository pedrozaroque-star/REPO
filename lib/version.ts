/**
 * @module version
 * @description Master system version and release configuration for SM TEG (Sistema de Management Tacos Gavilan).
 * @businessRules
 * - Semantic Versioning (SemVer): v[MAJOR].[MINOR].[PATCH].
 *   * MAJOR: Reescritura integral de plataforma o cambios estructurales incompatibles (v2.0.0).
 *   * MINOR: Módulos completos nuevos o expansiones clave (v2.6.0 Contabilidad, v2.7.0 Viele & Sons, v2.8.0 Salud del Sistema).
 *   * PATCH: Correcciones de bugs, optimización de caché, calibraciones y parches operativos (v2.6.1 - v2.6.3, v2.7.5).
 * - Sincronizado permanentemente con AppSidebar (desktop/mobile), Reporte de Actividades y Asistente IA.
 * @notes Fuente única de verdad para el versionado de la aplicación en UI, chatbots y documentación.
 */

export interface VersionMilestone {
    version: string;
    date: string;
    titleEs: string;
    titleEn: string;
    highlightsEs: string[];
    highlightsEn: string[];
}

export const SYSTEM_VERSION = {
    version: 'v2.15.0',
    versionNumber: '2.15.0',
    releaseMonthEs: 'Octubre 2026',
    releaseMonthEn: 'October 2026',
    stage: 'Producción',
    stageEn: 'Production',
    year: '2026',
    labelEs: 'Octubre 2026 • SM TEG v2.15.0',
    labelEn: 'October 2026 • SM TEG v2.15.0',
    brand: 'SM TEG',
    lastUpdated: '2026-10-16'
} as const;

export const VERSION_HISTORY: readonly VersionMilestone[] = [
    {
        version: 'v2.15.0',
        date: '16-Oct-2026',
        titleEs: 'Centro de Mando /inicio & Selector Post-Login, App Clientes Menu 2 + Autocomplete, Web CCPA/CPRA 2026 & WCAG 2.2 AA, Botella Salsa 5oz Vectorial 1:1, Dashboard Deep-Linking y Wake Lock Tabletas',
        titleEn: 'Launchpad Hub /inicio & Post-Login Selector, Customer App Menu 2 + Autocomplete, Web CCPA/CPRA 2026 & WCAG 2.2 AA, 5oz Hot Sauce 1:1 Vector Proof, Dashboard Deep-Linking & Tablet Wake Lock',
        highlightsEs: [
            'Nuevo centro de mando categorizado (/inicio), expansión permanente de las 6 secciones de la barra lateral con colores diferenciados, selector ejecutivo post-login (INICIO vs Dashboard tras el Splash 3D) y estandarización de insignias "NEW" y "[ 🚧 Building ]"',
            'App Móvil Clientes (/app y gavilan-app): nuevo "Menu 2" nativo compactado (Horchata Medium/Large en 1 tarjeta, submenú unificado de Tacos con cambio dinámico de foto y modal en 2 pasos), autocompletado de direcciones de entrega en tiempo real (/api/mobile/address/autocomplete), Opción A preserva-bolsa e integración DoorDash Developer API',
            'Sitio Web tacosgavilan.com y módulo "Sitio Web" (/nueva-web): rediseño en Modo Claro SM TEG a ancho completo, simuladores de iPad/iPhone, cruce por ventana de tiempo entre clics web y órdenes Toast POS, blindaje legal CCPA/CPRA 2026, Consent Mode v2 estricto, señal GPC y 0 violaciones axe-core WCAG 2.2 AA en 12 contextos',
            'Ingeniería de Empaque Propio (Botella Salsa Picante 5 fl. oz.): ficha técnica de manufactura (6.65" × Ø 1.85", corona 24-414) y 3 propuestas 100% originales con vectores oficiales de Adobe Illustrator y Gotham Ultra en pliego PDF 100% vectorial a escala real 1:1 (Imprimir_Prueba_1a1_Tacos_Gavilan_5oz_Carta.pdf)',
            'Enlace profundo bidireccional entre el Dashboard Ejecutivo (/dashboard) y sus 6 módulos alimentadores, Wake Lock de doble capa (lib/use-wake-lock.ts + wake-lock.mp4) para Modo Tableta en Descansos y Asignación Diaria, Check # prominente en Blindaje Delivery, Basecamp 6 capas con fecha/hora de creación y 120.7 horas de ingeniería + 98.0 horas de turnos en Lynwood #14 consolidadas (1 al 16 de Octubre 2026)'
        ],
        highlightsEn: [
            'New categorized Launchpad Hub (/inicio), all 6 AppSidebar sections expanded by default with differentiated color palettes, post-login destination selector (INICIO vs Executive Dashboard after 3D Splash), and standardized "NEW" and "[ 🚧 Building ]" status badges',
            'Customer Mobile App (/app & gavilan-app): compacted native "Menu 2" (single Horchata card with Medium/Large selector, unified Tacos submenu with dynamic protein photo switching and 2-step customizer modal), live Delivery Address Autocomplete (/api/mobile/address/autocomplete), Option A cart-preserving checkout, and DoorDash Developer API integration',
            'tacosgavilan.com & "Website" module (/nueva-web): full-width SM TEG Light Mode redesign, iPad/iPhone device simulators, Time-Window Order Matching with Toast POS orders, CCPA/CPRA 2026 legal compliance, strict Consent Mode v2 gating, GPC signal support, and 0 axe-core WCAG 2.2 AA violations across 12 contexts',
            'Proprietary Packaging Engineering (5 fl. oz. Hot Sauce Bottle): Manufacturing Tech Pack (6.65" × Ø 1.85", 24-414 finish) and 3 100% original label designs using official Adobe Illustrator SVG vectors and Gotham Ultra in a 100% pure-vector 1:1 US Letter print sheet (Imprimir_Prueba_1a1_Tacos_Gavilan_5oz_Carta.pdf)',
            'Bidirectional deep-linking between Executive Dashboard (/dashboard) and its 6 feeder modules, dual-layer Screen Wake Lock (lib/use-wake-lock.ts + wake-lock.mp4) for Tablet Mode in Breaks & Daily Assignment, prominent Check # badge in Blindaje Delivery, 6-layer Basecamp sync with creation timestamps, and 120.7 engineering hours + 98.0 Lynwood #14 shift hours consolidated (October 1–16, 2026)'
        ]
    },
    {
        version: 'v2.14.0',
        date: '15-Oct-2026',
        titleEs: 'Gavilan POS Cloud & PDF Ejecutivo, Continuidad Entre Cajeras y 7 Blindajes en Delivery, Paridad 135 Pantallas Cohesion + Candado Toast, App Móvil GPS/Maps/WebView y Order Ready 6 Dígitos Offline',
        titleEn: 'Gavilan POS Cloud & Executive PDF, Cross-Cashier Delivery Continuity & 7 Safeguards, 135-Screen Cohesion Parity + Toast Lock, Mobile App GPS/Maps/WebView & 6-Digit Offline Order Ready',
        highlightsEs: [
            'Gavilan POS Cloud (/gavilan-pos y /api/gavilan-pos/overview) e Informe Ejecutivo en PDF (Informe_Ejecutivo_Gavilan_POS_Tacos_Gavilan.pdf): ecosistema en Modo Claro con 9 módulos estratégicos y análisis directivo de propiedad legal de hardware, costos reales de Toast, procesamiento de tarjetas y APIs directas 3PD',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque): continuidad total entre cajeras en cambio de turno (Paso 1 -> Paso 2), 7 blindajes operativos en Slauson #7 (guardia de chofer presente, deshacer empaque, reabrir entrega), selección 100% manual de órdenes sin referencias QR y deselección al tocar espacio en blanco',
            'Contabilidad (/contabilidad): extracción y auditoría de las 135 pantallas de configuración de workflow de Cohesion (15 tiendas × 9 pestañas), resolución de Paid In negativo (-$0.99 en LA Broadway) y candado estricto de Depósito en Toast POS (HTTP 422 PENDING_TOAST_DEPOSIT)',
            'App Móvil Clientes (/app y gavilan-app): localizador GPS en primer plano para ordenar las 15 sucursales por cercanía, marcación en 1 toque y navegación Apple/Google Maps, WebView directo de Toast Online endurecido (800 aserciones en verde), eliminación de bucle de ruta raíz y 4 páginas legales públicas',
            'Order Ready Board & Preparador KDS: columna izquierda renombrada a "Entregadas / Delivered", soporte de folios offline de 6 dígitos (80001+), diseño ejecutivo sobrio con badges FOR HERE / TO GO, apertura instantánea de recibos Toast y consolidación de 112.1 horas de ingeniería y 90.0 horas de turnos en Lynwood #14 (1 al 15 de Octubre 2026)'
        ],
        highlightsEn: [
            'Gavilan POS Cloud (/gavilan-pos & /api/gavilan-pos/overview) & Executive PDF Report (Informe_Ejecutivo_Gavilan_POS_Tacos_Gavilan.pdf): 9-module Light Mode POS ecosystem plus executive brief on legal hardware ownership, real Toast store costs, card processing, and direct 3PD APIs',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque): seamless cross-cashier shift handover continuity (Step 1 -> Step 2), 7 operational safeguards at Slauson #7 (driver-present guard, undo packing, reopen delivery), manual-only order selection without QR references, and tap-outside blank-space deselection',
            'Accounting (/contabilidad): extracted and audited all 135 Cohesion workflow settings screens (15 stores × 9 tabs), resolved negative Paid In (-$0.99 in LA Broadway), and enforced strict Toast POS Deposit lock (HTTP 422 PENDING_TOAST_DEPOSIT)',
            'Customer Mobile App (/app & gavilan-app): foreground GPS locator sorting all 15 branches by proximity, 1-tap dialing and Apple/Google Maps routing, hardened Toast Online WebView (800-assertion compliance suite), root route collision fix, and 4 bilingual store-compliance pages',
            'Order Ready Board & Prep Line KDS: renamed left column to "Entregadas / Delivered", 6-digit offline Toast order number support (80001+), clean executive UI with FOR HERE / TO GO badges, instant Toast receipt cache, and 112.1 engineering hours + 90.0 Lynwood #14 shift hours consolidated (October 1–15, 2026)'
        ]
    },
    {
        version: 'v2.13.0',
        date: '14-Oct-2026',
        titleEs: 'Blindaje Delivery KDS & 100% Bilingüe (/blindaje-delivery), 4,000 Audios Kore Pre-Generados, Sincronización Uniformes ↔ Caja Fuerte, Cron Contable 6:30 AM y Corte DNS en Vivo de tacosgavilan.com',
        titleEn: 'Blindaje Delivery KDS & 100% Bilingual (/blindaje-delivery), 4,000 Pre-Generated Kore Audios, Uniforms ↔ Safe Box Sync, 6:30 AM Accounting Cron & Live tacosgavilan.com DNS Cutover',
        highlightsEs: [
            'Módulo Blindaje Delivery (/admin/blindaje-delivery, /admin/blindaje-delivery/empaque y /tablet/blindaje-delivery) en Slauson y LA Central: semáforo KDS de 3 estados + auto-expiración a 2h (UNCLAIMED_2H), extracción automática de chofer en Uber Eats, alerta anti-colisión de nombres, locutor bilingüe al salir de KDS y traducción 100% ES/EN',
            'Banco completo de 4,000 archivos de voz bilingües pre-generados (#1 al #2000 EN/ES con voz oficial Kore en Supabase Storage), reproducción Web Audio API anti-bloqueo de autoplay y cuádruple redundancia con deduplicación exacta de toque en Order Ready Board (/order-ready-board)',
            'Sincronización bidireccional acumulativa en tiempo real entre Control de Uniformes (/inventory/uniforms) y Caja Fuerte (/caja-fuerte): cada venta de playera ($7), gorra ($1) o chamarra ($20) actualiza al instante el saldo de efectivo de uniformes en bóveda, con edición y anulación para Supervisores/Admins',
            'Paridad contable 1:1 en Contabilidad (/contabilidad): cron diario automatizado a las 6:30 AM y 7:30 AM PT (/api/cron/sync-accounting), cheques sobrepagados por descuento post-pago en crédito 12049, pagos de fechas cruzadas, Cash In-Out / Tip Out y propinas de plataformas en cierres dominicales',
            'Corte de DNS en vivo de tacosgavilan.com hacia Vercel Edge Network (76.76.21.21), redirección canónica 308, preservación en 4 capas del respaldo clásico de WordPress y Centro de Mando Web (/nueva-web) con 5 pestañas operativas',
            'Auditoría forense en MilesIQ con recalibración de la matriz oficial de distancias reales de manejo por carretera entre las 15 sucursales y actualización del Reporte Ejecutivo de Actividades (/admin/reporte-actividades)'
        ],
        highlightsEn: [
            'Blindaje Delivery module (/admin/blindaje-delivery, /admin/blindaje-delivery/empaque & /tablet/blindaje-delivery) at Slauson & LA Central: 3-state KDS traffic light + 2h auto-expiration (UNCLAIMED_2H), automatic Uber Eats driver name backfill, name collision guard, bilingual KDS bump voice callout, and 100% ES/EN translation',
            'Complete bank of 4,000 pre-generated bilingual voice files (#1 to #2000 EN/ES with official Kore voice in Supabase Storage), Web Audio API playback preventing browser autoplay blocks, and 4x redundancy with exact tap deduplication in Order Ready Board (/order-ready-board)',
            'Real-time cumulative bidirectional synchronization between Uniforms Control (/inventory/uniforms) and Safe Box (/caja-fuerte): every shirt ($7), cap ($1), or jacket ($20) sale immediately increments safe uniform cash balance, with Supervisor/Admin edit and void capabilities',
            '1:1 accounting parity in Accounting (/contabilidad): automated daily cron at 6:30 AM & 7:30 AM PT (/api/cron/sync-accounting), overpaid post-discount checks credited to 12049, cross-date payments, Cash In-Out / Tip Out, and 3rd-party delivery tips on Sunday closes',
            'Live DNS cutover of tacosgavilan.com to Vercel Edge Network (76.76.21.21), canonical 308 redirect, 4-layer preservation of classic WordPress backup, and 5-tab Website Command Center (/nueva-web)',
            'Forensic MilesIQ road distance matrix recalibration across all 15 stores and updated Executive Activity Report (/admin/reporte-actividades)'
        ]
    },
    {
        version: 'v2.12.0',
        date: '09-Oct-2026',
        titleEs: 'Lanzamiento de Order Ready Board con Voz Neuronal Gemini TTS, App Móvil Clientes (/app), Módulo Crear Bills (QBO), Registro de Mantenimiento y Auditoría de Octubre',
        titleEn: 'Order Ready Board Launch with Gemini Neural TTS, Customer Mobile App (/app), QuickBooks Bills Creator, Maintenance Log & October Audit',
        highlightsEs: [
            'Lanzamiento oficial del módulo Order Ready Board (/order-ready-board): integración con KDS expediter de Toast POS, locución bilingüe (Español/Inglés) con voz femenina natural Gemini TTS y el eslogan "¡Ya está!", rotación multi-llave anti-429 y visualizador TV a pantalla completa',
            'Despliegue de la Aplicación Móvil de Pedidos (/app & /ordenar) con splash animado 3D a 60 FPS acelerado por GPU, flujo de checkout Toast Local, tasas oficiales CDTFA (Octubre 2026) y reglas de entrega a domicilio',
            'Creación del módulo financiero Crear Bills (/admin/crear-bills) para transformar facturas de bodega central en Bills de QuickBooks Online con ordenamiento interactivo y validación de costos',
            'Módulo de Registro de Proveedores y Mantenimiento con bitácora para técnicos externos, captura obligatoria de evidencia fotográfica del antes y después, firma digital y semáforo preventivo',
            'Paridad contable Toast Cash Management en Cohesion (depósitos esperados, Paid In de cheques de nómina, cuenta 12049 y candado anti-duplicados en QBO)',
            'Optimización de producción y accesibilidad móvil para el sitio oficial tacosgavilan.com con 3 temas interactivos de Google Maps y previsualización en la barra lateral',
            'Integración del mes de Octubre 2026 (65.2 horas auditadas y turnos oficiales Lynwood #14) en el componente nativo TSX del Reporte de Actividades'
        ],
        highlightsEn: [
            'Official launch of Order Ready Board (/order-ready-board): Toast POS expediter KDS sync, natural female bilingual Gemini TTS voice with "¡Ya está!" signature slogan, round-robin multi-key pool, and full-screen TV display',
            'Rolled out Customer Mobile Ordering App (/app & /ordenar) with GPU-accelerated 60 FPS 3D perspective splash, Toast Local checkout flow, official CDTFA Oct 2026 tax rates, and delivery fee calculation',
            'Engineered Crear Bills module (/admin/crear-bills) to automatically turn central warehouse invoices into official QuickBooks Online vendor Bills with column sorting and cost verification',
            'Maintenance & Service Providers module featuring external technician work logs, mandatory before/after photo evidence, digital manager sign-off, and preventive maintenance status indicators',
            'Toast Cash Management accounting parity with Cohesion (expected deposits, payroll check Paid In logic, account 12049 routing, and QBO duplicate publishing protection)',
            'Production polish and mobile accessibility for official website tacosgavilan.com with 3 interactive Google Maps themes and AppSidebar live preview link',
            'Integrated October 2026 (65.2 audited engineering hours and Lynwood #14 manager shifts) into the native TSX Activity Reports dashboard'
        ]
    },
    {
        version: 'v2.11.0',
        date: '30-Sep-2026',
        titleEs: 'Piloto de Automatización de Pedidos IA, Calibración Viele & Sons 4 Páginas, Blindaje de Actividades (19 Fixes), Planificador Móvil y Drive-Thru TV',
        titleEn: 'AI Automated Ordering Pilot, Viele & Sons 4-Page Calibration, Activities Hardening (19 Fixes), Mobile Planner & Drive-Thru TV',
        highlightsEs: [
            'Arquitectura del motor de pedidos inteligentes por IA y Orden Diaria: deducción de empaques por canal (Dine-In, Takeout, Delivery), calibración de recetas de tortillas/aguas frescas y cruce PMIX vs tickets locales',
            'Calibración de hoja física Viele & Sons a 4 páginas exactas tamaño Carta, cron matutino de las 6:00 AM (/api/cron/viele-daily-setup), sincronización de 15 Order Guides, corrección visual DX900GE/MUFO y Manual Operativo en PDF',
            'Remediación integral de 19 hallazgos en el módulo de Actividades (aislamiento estricto por tienda, offset dinámico de apertura/cierre y restauración de asignaciones de estaciones en Slauson #1 y Lynwood #14)',
            'Rediseño móvil del Planificador de Horarios (1-tap para llamadas/WhatsApp y selección multi-día en ShiftModal), adaptación nativa del Preparador y Modo TV Leaderboard en Drive-Thru con buscador de tickets',
            'Resiliencia del reproductor Windows (.exe) de GAVILAN MIX y cierre mensual de Septiembre 2026 acumulando 195.00 horas de ingeniería y 154.00 horas de turnos gerenciales en Lynwood #14'
        ],
        highlightsEn: [
            'AI automated ordering and Daily Order engine architecture: channel packaging deduction rules (Dine-In, Takeout, Delivery), tortilla/agua fresca recipe calibration, and PMIX vs local ticket parity checks',
            'Viele & Sons physical count sheet calibrated to 4 exact Letter pages, 6:00 AM daily cron (/api/cron/viele-daily-setup), 15-store Order Guide sync, DX900GE/MUFO image swap fix, and official PDF Operational Manual',
            'Comprehensive 19-bug remediation in the Activities module (strict store_id isolation, dynamic opening/closing time offsets, and restored station assignments for Slauson #1 and Lynwood #14)',
            'Mobile UX redesign for Schedule Planner (1-tap Call/WhatsApp contact sheet and multi-day selection in ShiftModal), native mobile Prep Line adaptation, and Drive-Thru Fullscreen TV Leaderboard with ticket lookup',
            'Hardened GAVILAN MIX standalone Windows (.exe) player and closed September 2026 monthly reconciliation at 195.00 engineering hours and 154.00 managerial shift hours at Lynwood #14'
        ]
    },
    {
        version: 'v2.10.5',
        date: '21-Sep-2026',
        titleEs: 'Viele & Sons Paridad de Precios (0% Tax), Validación Cruzada Sage 100 y Auditoría RONOS Final',
        titleEn: 'Viele & Sons Price Parity (0% Tax), Sage 100 Cross-Validation & Final RONOS Audit',
        highlightsEs: [
            'Corrección de cálculo fiscal en Viele & Sons (taxAmount = 0, totalAmount = subtotalAmount) eliminando recargo erróneo del 9.5% sobre insumos alimenticios al mayoreo',
            'Validación cruzada automatizada post-checkout con Sage 100 (salesOrderDetail_dt) comparando códigos de ítems y cantidades para certificar paridad y evitar contaminación de carritos',
            'Corrección del error de build generateCingularSummaryCSV y auditoría profunda de prompts/respuestas en el cierre técnico de RONOS',
            'Reconciliación acumulada de 146.80 horas de ingeniería en el Reporte de Actividades TSX nativo y soporte de turnos gerenciales Lynwood #14'
        ],
        highlightsEn: [
            'Wholesale tax calculation fix in Viele & Sons (taxAmount = 0, totalAmount = subtotalAmount) eradicating erroneous 9.5% sales tax on tax-exempt food supplies',
            'Automated post-checkout cross-validation against Sage 100 (salesOrderDetail_dt) comparing item codes and quantities to certify parity and prevent cart contamination',
            'Resolved generateCingularSummaryCSV build error and conducted deep prompt/response audits for RONOS technical closure',
            'Cumulative engineering reconciliation reaching 146.80 hours in native TSX Activity Reports and Lynwood #14 managerial shift tracking'
        ]
    },
    {
        version: 'v2.10.4',
        date: '19-Sep-2026',
        titleEs: 'Reingeniería Modular de RONOS, Asignación Dinámica de Supervisores y Reconexión Descansos V3.1',
        titleEn: 'RONOS Modular Re-engineering, Dynamic Supervisor Allocation & Breaks V3.1 Reconnection',
        highlightsEs: [
            'Rediseño modular de RONOS dividiendo la página monolítica en componentes independientes (RonosHomeTab, StoreAttendanceTab, PayrollReconciliationTab, helpers.ts)',
            'Desvinculación de referencias fijas en lib/payroll-calculator.ts y migración al esquema relacional supervisor_payroll_assignments en Supabase',
            'Separación formal entre tienda operativa (operational_store_id) y tienda pagadora (payroll_store_id) en lib/supervisor-assignments.ts',
            'Localización i18n 100% bilingüe en lib/i18n.tsx para todas las métricas, tarjetas, modales y tablas de RONOS',
            'Corrección del bug de doble turno en helpers.ts (detectTodayAttendance) y eliminación de matching por nombre en asignaciones',
            'Reconexión y blindaje de Descansos Laborales (/descansos) con la curva horaria normalizada V3.1 y autenticación JWT'
        ],
        highlightsEn: [
            'Full modular redesign of RONOS breaking monolithic page into independent sub-components (RonosHomeTab, StoreAttendanceTab, PayrollReconciliationTab, helpers.ts)',
            'De-coupled hardcoded invoice references in lib/payroll-calculator.ts and migrated to dynamic supervisor_payroll_assignments relational schema in Supabase',
            'Formal separation between operational supervisory territory (operational_store_id) and paying entity (payroll_store_id) in lib/supervisor-assignments.ts',
            '100% bilingual i18n localization in lib/i18n.tsx across all RONOS metrics, cards, modals, and tables',
            'Resolved double shift attendance consolidation bug in helpers.ts and eliminated name-based matching in supervisor assignments',
            'Reconnected and hardened Labor Breaks (/descansos) with Forecast V3.1 normalized hourly curve and JWT authentication'
        ]
    },
    {
        version: 'v2.10.3',
        date: '17-Sep-2026',
        titleEs: 'Calibración de Atenuación de Eventos (Hollywood Bowl), Transparencia en Ventas y Sync Cron',
        titleEn: 'Event Distance-Decay Calibration (Hollywood Bowl), Sales UI Transparency & Sync Cron',
        highlightsEs: [
            'Calibración de decaimiento por distancia geográfica para eventos masivos (Hollywood Bowl / Concierto Andrea Bocelli), focalizando el impacto en sucursal #8 sin inflar tiendas lejanas',
            'Transparencia ejecutiva en /ventas con tooltips e insignias de eventos detallando nombre, recinto, distancia en millas y factor de impacto',
            'Robustecimiento del cron de sincronización de eventos (/api/cron/sync-events) con validación estricta de coordenadas y parseo de fechas',
            'Script de recálculo masivo scripts/refresh-v31-week.ts para actualizar y cachear proyecciones semanales V3.1 en Supabase con JWT',
            'Briefing técnico-metodológico para Roberto Velázquez sobre la arquitectura Forecast V3.1 (tickets × ticket promedio y lookback de 8 semanas)'
        ],
        highlightsEn: [
            'Geographical distance-decay calibration for massive venue events (Hollywood Bowl / Andrea Bocelli concert), isolating impact to store #8 Hollywood without inflating distant stores',
            'Executive transparency in /ventas rendering badges and tooltips detailing event name, venue, distance in miles, and impact multiplier',
            'Hardened local events synchronization cron (/api/cron/sync-events) with strict coordinate validation and robust date parsing',
            'Batch recalculation script scripts/refresh-v31-week.ts regenerating and caching authenticated V3.1 projections in Supabase',
            'Technical methodological briefing for Roberto Velázquez on Forecast V3.1 architecture (tickets × median ticket and 8-week lookback)'
        ]
    },
    {
        version: 'v2.10.2',
        date: '17-Sep-2026',
        titleEs: 'Motor de Proyecciones de Ventas V3.1 (Estadística Robusta, Normalización Horaria y Seguridad JWT)',
        titleEn: 'Sales Forecast Engine V3.1 (Robust Statistics, Hourly Normalization & JWT Security)',
        highlightsEs: [
            'Proyección basada en tráfico (tickets × ticket promedio) con base de 8 semanas, pesos de recencia y Winsorization anti-anomalías',
            'Curva horaria normalizada con suma idéntica al total diario, eliminando duplicación 12–5 AM e inflación de huecos',
            'Comparativos de feriados estrictamente anteriores sin fuga temporal y composición simétrica de eventos con atenuación por distancia',
            'Blindaje de API de proyecciones con JWT, validación estricta de parámetros, control de roles y cron de eventos locales',
            'Reducción del WAPE simulado en 900 tienda/día de 6.59% a 5.65% y del error consolidado diario de 4.95% a 3.05%'
        ],
        highlightsEn: [
            'Traffic-based forecast (tickets × average ticket) with 8-week baseline, recency weights, and Winsorization outlier clipping',
            'Strictly normalized hourly curve ensuring hourly sum matches daily total, eliminating 12–5 AM collision and gap inflation',
            'Retrospective holiday comparatives preventing future data leakage and symmetric event composition with continuous distance decay',
            'Secured forecast API with JWT session tokens, strict role enforcement, 31-day ceiling, and local events sync cron',
            'Reduced retrospective simulated WAPE across 900 store/days from 6.59% to 5.65% and consolidated daily error from 4.95% to 3.05%'
        ]
    },
    {
        version: 'v2.10.1',
        date: '17-Sep-2026',
        titleEs: 'Conciliación de Facturas PEO Cingular HR, Sincronizador Diario de Tarifas y Edición Navideña GAVILAN MIX',
        titleEn: 'Cingular HR PEO Invoice Reconciliation, Daily Pay Rate Sync & GAVILAN MIX Christmas Edition',
        highlightsEs: [
            'Motor de conciliación matemática 1:1 contra facturas reales de Cingular HR (TEGL-0025/26, TEGB-0018, TEGD-0008, TEGS-0039, TEGH-0009)',
            'Cron centinela diario (/api/cron/sync-daily-payroll) a las 11:59 AM para sincronización automática de tarifas desde Simplify HR hacia Supabase',
            'Soporte para finiquitos, cheques complementarios y tiempo libre remunerado (PTO Sick/Vacation) en el calculador de nómina',
            'Lanzador EXE autónomo de 1 clic para GAVILAN MIX con auto-limpieza de carpetas obsoletas y desanclado de reproductores antiguos de la barra de tareas',
            'Edición Navideña de pantallas de comedor: 300 videos festivos (1970-2026) con marco decorativo y esferas con logo Tacos Gavilan'
        ],
        highlightsEn: [
            '1:1 mathematical reconciliation engine against real Cingular HR PEO invoices (TEGL-0025/26, TEGB-0018, TEGD-0008, TEGS-0039, TEGH-0009)',
            'Daily 11:59 AM sentinel cron (/api/cron/sync-daily-payroll) for automated pay rate synchronization from Simplify HR into Supabase',
            'Payroll engine handling for final termination checks, supplemental payroll, and non-clocked paid time off (PTO Sick/Vacation)',
            'Standalone 1-click Windows EXE launcher for GAVILAN MIX featuring legacy folder auto-cleanup and taskbar player unpinning',
            'Christmas TV Edition: 300 curated holiday music videos (1970-2026) with festive borders and branded Tacos Gavilan holiday ornaments'
        ]
    },
    {
        version: 'v2.10.0',
        date: '14-Sep-2026',
        titleEs: 'P&L Ejecutivo Consolidado, Varianza AvT (Paridad R365) y Ecosistema GAVILAN MIX',
        titleEn: 'Consolidated Executive P&L, AvT Variance (R365 Parity) & GAVILAN MIX Ecosystem',
        highlightsEs: [
            'Nuevo módulo de Estado de Resultados (/admin/pnl) consolidado y por sucursal con Ventas, Food Cost, Labor, Comisiones y EBITDA',
            'Módulo de Varianza de Food Cost (/admin/food-cost/varianza) comparando costo teórico vs real en dólares con semáforos de tolerancia',
            'Ecosistema GAVILAN MIX con curación musical, censura inteligente de letras y automatización en pantalla secundaria para tiendas',
            'Simulaciones forenses de estrés y casos extremos para pedidos de insumos y bebidas en Viele & Sons'
        ],
        highlightsEn: [
            'New Consolidated Income Statement module (/admin/pnl) per store and chain-wide tracking Sales, Food Cost, Labor, and EBITDA',
            'Food Cost Variance module (/admin/food-cost/varianza) comparing theoretical vs actual usage in dollars with tolerance alerts',
            'GAVILAN MIX store TV ecosystem with automated lyrics censorship, parallel downloads, and secondary monitor playback',
            'Forensic stress simulations and edge-case validation between TEG app and live Viele & Sons portal'
        ]
    },
    {
        version: 'v2.9.2',
        date: '13-Sep-2026',
        titleEs: 'Corrección de Bugs Críticos en Módulo de Captura Viele & Sons',
        titleEn: 'Critical Bug Fixes in Viele & Sons Capture Module',
        highlightsEs: [
            'Eliminado bug de espejismo visual: items sin estado real en React se mostraban con pedido sugerido pero se perdían al enviar',
            'Sincronización de orderRows al restablecer orden oficial: previene desincronización catálogo vs estado',
            'Eliminado setCatalog duplicado en inicialización que causaba flash de catálogo sin filtrar',
            'Auditoría exhaustiva línea por línea con 5 subagentes especializados en paralelo'
        ],
        highlightsEn: [
            'Fixed phantom fallback bug: items without real React state showed suggested order but were silently lost on submit',
            'OrderRows sync on official order reset: prevents catalog vs state desynchronization',
            'Removed duplicate setCatalog in loadData that caused unfiltered catalog flash',
            'Exhaustive line-by-line audit with 5 specialized parallel subagents'
        ]
    },
    {
        version: 'v2.9.1',
        date: '13-Sep-2026',
        titleEs: 'Blindaje Transaccional Viele & Sons y Lectura Fiscal Sage 100',
        titleEn: 'Viele & Sons Transactional Hardening & Sage 100 Tax Integration',
        highlightsEs: [
            'Vaciado higiénico forzado del carrito vía fixupcheckoutdetail con cantidad cero en sesión activa',
            'Aislamiento estricto de artículos por lote (evita absorción de productos ajenos en checkout)',
            'Extracción fiscal en tiempo real de Sage 100 (salesOrder_doc) capturando taxes reales sobre químicos',
            'Aumento de tamaño de letra y optimización de legibilidad en Hoja de Conteo Imprimible'
        ],
        highlightsEn: [
            'Forced hygienic cart purge via fixupcheckoutdetail setting quantity to zero in active session',
            'Strict item batch isolation preventing residual cart items from entering checkout',
            'Real-time Sage 100 tax breakdown extraction (salesOrder_doc) capturing exact chemical sales tax',
            'Font size enhancement and improved readability on physical Print Sheet'
        ]
    },
    {
        version: 'v2.9.0',
        date: '11-Sep-2026',
        titleEs: 'Paridad Total Cohesion, Toast Accounting y Control de Pólizas',
        titleEn: 'Full Cohesion Parity, Toast Accounting & Policy Publishing Flow',
        highlightsEs: [
            'Resolución automática de nombres de cajeros en órdenes abiertas (Step 11) cruzando contra toast_employees',
            'Segregación contable de Gift Cards (cuenta pasivo 20500 diferida y redenciones debito)',
            'Deducción de comisiones bancarias reales de Toast POS y retenciones Toast Capital MCA',
            'Segregación contable de ventas de Drive Thru y cargos por servicio de entrega (51030)',
            'Flujo de publicación individual a QuickBooks dentro de cada póliza (/contabilidad/[packetId]) con auditoría previa'
        ],
        highlightsEn: [
            'Automated cashier resolution for open checks (Step 11) via toast_employees cross-table lookup',
            'Segregated Gift Card accounting (liability account 20500 deferred sales and debit redemptions)',
            'Deduction of real Toast POS bank processing fees and Toast Capital MCA repayments',
            'Segregated general ledger breakdown for Drive Thru sales and delivery service charges (51030)',
            'In-packet QuickBooks publishing workflow (/contabilidad/[packetId]) enforcing pre-sync audit'
        ]
    },
    {
        version: 'v2.8.1',
        date: '10-Sep-2026',
        titleEs: 'Blindaje de Caché Food Cost y Acotamiento de Pólizas',
        titleEn: 'Food Cost Cache Shielding & Week-Scoped Policies',
        highlightsEs: [
            'Blindaje de caché food_cost_daily_cache restringiendo el guardado a consultas consolidadas globales con >= 14 tiendas',
            'Migración del cron sync-food-cost-today a ejecución directa in-process para eliminar timeouts de Vercel',
            'Triangulación forense de cheques físicos Cingular Lynwood #14 contra logs detallados de RONOS y Simplify HR',
            'Optimización de /contabilidad para procesar exclusivamente la semana activa seleccionada en UI'
        ],
        highlightsEn: [
            'food_cost_daily_cache hardening restricting write-through strictly to consolidated runs with >= 14 stores',
            'Migrated sync-food-cost-today cron to direct in-process execution eliminating Vercel timeouts',
            'Forensic reconciliation of Cingular physical checks (Lynwood #14) against RONOS detailed CSVs and Simplify HR',
            'Optimized /contabilidad policy generation to strictly process the active selected week in UI'
        ]
    },
    {
        version: 'v2.8.0',
        date: '09-Sep-2026',
        titleEs: 'Centinela de Salud, Blindaje PMIX y Gobernanza del Sistema',
        titleEn: 'System Health Sentinel, PMIX Shielding & System Governance',
        highlightsEs: [
            'Centinela de Salud del Sistema (/admin/salud-sistema) con monitoreo de cuota Supabase (8GB cap) y alertas por correo',
            'Blindaje de caché PMIX write-through síncrono con salvaguarda defensiva de 120 días y seguridad Dual-Gate en cron jobs',
            'Calibración de facturación Cingular/Simplify HR (Hollywood, Bell, La Puente) y hoja de ruta ejecutiva R365',
            'Reglas estrictas de aislamiento de reportes y commits autorizados únicamente por el usuario'
        ],
        highlightsEn: [
            'System Health Sentinel (/admin/salud-sistema) with Supabase quota monitoring (8GB cap) and email alerting',
            'PMIX synchronous write-through cache hardening with 120-day defensive guard and Dual-Gate cron security',
            'Cingular/Simplify HR payroll calibration (Hollywood, Bell, La Puente) and R365 executive roadmap',
            'Strict reports isolation governance and explicit user-only commit authorizations'
        ]
    },
    {
        version: 'v2.7.5',
        date: '08-Sep-2026',
        titleEs: 'Sincronización de Ausencias RONOS y Puente Planificador-Horarios',
        titleEn: 'RONOS Absence Sync & Planner-to-Schedules Bridge',
        highlightsEs: [
            'Sincronización automatizada de ausencias aprobadas (Sick, PTO, Permisos) desde RONOS en ventana de 4 semanas',
            'Semáforos de cobertura visual (coversBlock = false) para turnos en descubierto',
            'Puente automatizado semanal entre el Planificador y los Horarios oficiales de supervisores'
        ],
        highlightsEn: [
            'Automated sync of approved absences (Sick, PTO, Leaves) from RONOS in 4-week window',
            'Visual coverage traffic lights (coversBlock = false) for uncovered shifts',
            'Automated weekly bridge between Planner and official supervisor schedules'
        ]
    },
    {
        version: 'v2.7.0',
        date: '06-07-Sep-2026',
        titleEs: 'Motor Integral de Compras Viele & Sons y Facturación Dual Sage 100',
        titleEn: 'Viele & Sons Procurement Engine & Sage 100 Dual Invoicing',
        highlightsEs: [
            'Módulo de Compras Viele & Sons (/admin/compras/viele) con catálogo de 89 insumos normalizados',
            'Checkout automatizado con partición estricta de 2 facturas independientes en Sage 100 (Sodas BIB vs Insumos Generales)',
            'Hoja de conteo físico imprimible en 2 páginas verticales (Letter Portrait)',
            'Edición dinámica de niveles PAR multi-tienda con guardado atómico y reordenamiento Drag & Drop',
            'Historial unificado multi-tienda (/admin/compras/viele/historial) con 2,614 órdenes y más de $4.01M auditables',
            'Restricción RBAC de seguridad para Stephany Torres (rol estricto planificador)'
        ],
        highlightsEn: [
            'Viele & Sons Procurement Module (/admin/compras/viele) with 89 standardized items',
            'Automated dual-invoice checkout in Sage 100 (Sodas BIB vs General Supplies)',
            'Printable physical inventory count sheet fitting exactly 2 vertical Letter pages',
            'Dynamic multi-store PAR level editor with atomic saving and Drag & Drop sorting',
            'Unified multi-store order history (/admin/compras/viele/historial) auditing 2,614 orders ($4.01M+)',
            'Strict RBAC security lock for Stephany Torres (planner-only role)'
        ]
    },
    {
        version: 'v2.6.3',
        date: '03-Sep-2026',
        titleEs: 'Centro de Configuración Contable y Bloqueador Step 11 Cohesion',
        titleEn: 'Accounting Configuration Center & Cohesion Step 11 Blocker',
        highlightsEs: [
            'Panel interactivo de configuración contable (/contabilidad/configuracion) para las 15 sucursales',
            'Validación estricta de órdenes abiertas/desbalanceadas (Step 11 de Cohesion) bloqueando envíos a QuickBooks (HTTP 422)',
            'Auditoría histórica de $32.7M USD en pólizas de diario contra QuickBooks Online',
            'Centinela de auditoría rodante de 7 días a las 6:15 AM PST para detección de reembolsos tardíos'
        ],
        highlightsEn: [
            'Interactive Accounting Configuration panel (/contabilidad/configuracion) for all 15 stores',
            'Strict open/unbalanced check validation (Cohesion Step 11) blocking QuickBooks publishing (HTTP 422)',
            'Historical audit of $32.7M USD in journal entries against QuickBooks Online',
            '6:15 AM PST 7-day rolling audit sentinel detecting late POS refunds'
        ]
    },
    {
        version: 'v2.6.2',
        date: '02-Sep-2026',
        titleEs: 'Grupo Sidebar Finanzas y Vinculación de Turnos Lynwood',
        titleEn: 'Finance Sidebar Group & Lynwood Schedule Integration',
        highlightsEs: [
            'Nuevo grupo \'Finanzas y Contabilidad\' en el sidebar para rol admin',
            'Acceso directo a Miles para Raquel Velázquez',
            'Vinculación dinámica de turnos reales de Carlos Velázquez (Lynwood #14) desde Supabase schedules'
        ],
        highlightsEn: [
            'New \'Finanzas y Contabilidad\' group in sidebar for admin role',
            'Direct shortcut to Miles for Raquel Velázquez',
            'Dynamic linking of Carlos Velázquez\'s real shifts (Lynwood #14) from Supabase schedules'
        ]
    },
    {
        version: 'v2.6.1',
        date: '01-Sep-2026',
        titleEs: 'Génesis de Reemplazo Cohesion y Dashboard TSX Nativo',
        titleEn: 'Cohesion Replacement Genesis & Native TSX Dashboard',
        highlightsEs: [
            'Ingeniería inversa de Cohesion (ahorro de $450/mes) con mapeo de 17 cuentas contables',
            'Migración integral de Reporte de Actividades a componente TSX 100% nativo con diseño PRO',
            'Auditoría de 4 pestañas de RONOS con formato de ponchadas 12h'
        ],
        highlightsEn: [
            'Reverse engineering of Cohesion ($450/month savings) mapping 17 GL accounts',
            'Full migration of Activities Report to 100% native TSX component with PRO design',
            'Audit of 4 RONOS tabs with 12h punch formatting'
        ]
    }
] as const;
