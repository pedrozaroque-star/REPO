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
    version: 'v2.10.5',
    versionNumber: '2.10.5',
    releaseMonthEs: 'Septiembre 2026',
    releaseMonthEn: 'September 2026',
    stage: 'Producción',
    stageEn: 'Production',
    year: '2026',
    labelEs: 'Septiembre 2026 • SM TEG v2.10.5',
    labelEn: 'September 2026 • SM TEG v2.10.5',
    brand: 'SM TEG',
    lastUpdated: '2026-09-21'
} as const;

export const VERSION_HISTORY: readonly VersionMilestone[] = [
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
