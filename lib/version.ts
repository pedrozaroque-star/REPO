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
    version: 'v2.21.0',
    versionNumber: '2.21.0',
    releaseMonthEs: 'Octubre 2026',
    releaseMonthEn: 'October 2026',
    stage: 'Producción',
    stageEn: 'Production',
    year: '2026',
    labelEs: 'Octubre 2026 • SM TEG v2.21.0',
    labelEn: 'October 2026 • SM TEG v2.21.0',
    brand: 'SM TEG',
    lastUpdated: '2026-10-26'
} as const;

export const VERSION_HISTORY: readonly VersionMilestone[] = [
    {
        version: 'v2.21.0',
        date: '26-Oct-2026',
        titleEs: 'Mantenimiento Encargados Turno + CCTV + Correo Raquel, Actividades Tablero Fullscreen & Planificador, Blindaje Delivery 4 Candados, Descansos IA V29, Order Ready v=3 (#164/#168) y Viele 5 Capas Resiliencia',
        titleEn: 'Maintenance Shift Leaders + CCTV + Raquel Email, Actividades Fullscreen Board & Planner Sync, Delivery Shield 4 Locks, Breaks AI V29, Order Ready v=3 (#164/#168) & Viele 5-Layer Resilience',
        highlightsEs: [
            'Módulo Mantenimiento y Proveedores (/mantenimiento/registro, /admin/mantenimiento, /api/mantenimiento y lib/maintenance-email.ts, commit bd784f24): selector dinámico de encargados en turno conectado en vivo al Planificador y Horarios (?shift_leaders=1 para listar Supervisor, Manager, Assistant Manager o Shift Leader en el Paso 7 y en edición del Admin), protocolo de servicio nocturno sin firma con verificación por cámaras CCTV y notificación automática por correo a raquel@tacosgavilan.com al completar los 7 pasos',
            'Módulo ACTIVIDADES y Publicación de Horarios del Planificador (AsignacionDiariaTab.tsx, lib/actividades-resolution.ts, /api/notifications/publish-schedule y /api/schedule/calendar): resolución del reporte en Slauson #7 para mostrar en el Tablero Operativo Fullscreen y en horarios publicados el 100% de las actividades asignadas a cada estación (incluyendo SL Male AM, SL PM Temperaturas/Daily Check y Uber + Salsas)',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque/page.tsx, lib/delivery-armor.ts y lib/tablet-cache-cleaner.ts): 4 candados definitivos con memoria persistente en localStorage (teg_delivery_sticky_audits_v1_{storeId}) protegida ante recargas y limpiezas de caché para que ninguna orden ya entregada al repartidor vuelva a aparecer en la cola activa de la tableta',
            'Motor IA de Descansos V29 (/descansos y lib/breaks-engine.ts): calibración directa sobre los ajustes manuales recientes del mánager Jesús en Slauson #7 (21 al 26 de Octubre), priorizando patrones reales aprendidos por estación y duración de turno (incluyendo turnos vespertinos de 6 horas 5:00 PM - 11:00 PM)',
            'Order Ready Board (/order-ready-board, commit 8ce0b4dd): auditoría de los 4,000 audios Kore, regeneración en Supabase Storage de los 19 clips con desfase fonético (incluyendo #164 EN "one six four" y #168 ES "ciento sesenta y ocho") e invalidación de caché inmutable con &v=3',
            'Radar de Precios & Viele & Sons (5 capas de blindaje de conexión en la nube con fallback automático a VIELE_STORE_ACCOUNTS_JSON, timeouts de 15s y reintentos, commit 48f30353), Filtro Anti-Spam Comercial B2B (Shadow-Drop TG-FILTERED en tacosgavilan.com/api/contact, commits 26501a7 y d62efc6b), arquitectura de respaldo en vivo en OneDrive + Google Drive Cloud-Only (+10.69 GB libres) y 194.7 horas de desarrollo e ingeniería consolidadas (Desarrollador del Sistema & IT en La Bodega, 1 al 26 de Octubre 2026)'
        ],
        highlightsEn: [
            'Maintenance & Service Providers (/mantenimiento/registro, /admin/mantenimiento, /api/mantenimiento & lib/maintenance-email.ts, commit bd784f24): dynamic on-duty shift leader selector synced live with Planner and Schedules (?shift_leaders=1 listing Supervisor, Manager, Assistant Manager, or Shift Leader in Step 7 and Admin Edit Modal), overnight unattended service CCTV verification notice, and automatic executive email dispatch to raquel@tacosgavilan.com upon completing all 7 steps',
            'ACTIVIDADES Module & Planner Schedule Publishing (AsignacionDiariaTab.tsx, lib/actividades-resolution.ts, /api/notifications/publish-schedule & /api/schedule/calendar): resolved the Slauson #7 report so 100% of station-assigned tasks (including SL Male AM, SL PM Temperatures/Daily Check, and Uber + Salsas) render on the Fullscreen Operational Board and published schedules',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque/page.tsx, lib/delivery-armor.ts & lib/tablet-cache-cleaner.ts): 4 permanent safeguards with localStorage sticky audit persistence (teg_delivery_sticky_audits_v1_{storeId}) whitelisted in the tablet cache cleaner so delivered (HANDED_OFF) orders never reappear in the active tablet queue',
            'Breaks AI Engine V29 (/descansos & lib/breaks-engine.ts): calibrated directly against Manager Jesús\'s recent manual break adjustments at Slauson #7 (Oct 21–26), prioritizing learned station and shift-length preferences (including 6-hour 5:00 PM - 11:00 PM evening shifts)',
            'Order Ready Board (/order-ready-board, commit 8ce0b4dd): audited all 4,000 Kore voice clips, regenerated all 19 affected WAV files in Supabase Storage (including English #164 "one six four" and Spanish #168 "ciento sesenta y ocho"), and bumped immutable cache-buster to &v=3',
            'Price Radar & Viele & Sons (5-layer cloud connection hardening with automatic fallback to VIELE_STORE_ACCOUNTS_JSON, 15s timeouts, and retries, commit 48f30353), B2B Solicitation Spam Filter (Shadow-Drop TG-FILTERED in tacosgavilan.com/api/contact, commits 26501a7 & d62efc6b), live OneDrive Disaster Recovery + Google Drive Cloud-Only streaming (+10.69 GB freed), and 194.7 system development & engineering hours consolidated (System Developer & IT at La Bodega, October 1–26, 2026)'
        ]
    },
    {
        version: 'v2.20.0',
        date: '24-Oct-2026',
        titleEs: 'Contabilidad Externa Sync Bidireccional QBO V3 & Vista Previa Total, App Clientes V1/V2 OTP por Correo Real & Home Limpio, Web Ranking Mensual Automático & Mapa Tesla y Mantenimiento Directorio Real + GPS',
        titleEn: 'External Accounting Live Bidirectional QBO V3 Sync & Universal Preview, Customer App V1/V2 Live Email OTP & Clean Home, Web Monthly Sales Store Ranking & Tesla Map & Maintenance Live Vendor Directory + GPS',
        highlightsEs: [
            'Contabilidad Externa Multi-Empresa (/admin/contabilidad-externa, lib/external-accounting-qbo-sync.ts y /api/external-accounting): sincronización bidireccional en vivo con Intuit QuickBooks Online V3 (creación, edición y eliminación con SyncToken en las 8 compañías), rediseño institucional Cero Ruido con Registro Bancario de 2 líneas (QBO 2-Line Bank Register), captura rápida en línea, desglose Split, impresión PDF contable en ventana limpia y Modal de Vista Previa Oficial al dar clic en cualquier elemento de todas las pestañas con botones de Imprimir, Editar y Eliminar con doble confirmación',
            'App Móvil Clientes (/app, /app/v1, /app/v2, CustomerAppV2Pro.tsx, gavilan-app y lib/mobile-auth-email.ts): apertura directa en 1 toque de la sucursal seleccionada sobre order.online al pulsar Menu en V1 y V2, autenticación y registro real por Correo Electrónico con código OTP de 6 dígitos enviado en vivo vía Gmail/Supabase (/api/mobile/auth/send-otp, /api/mobile/auth/verify-otp y /api/mobile/user/profile), política estricta Cero Emojis, retiro de elementos ficticios (Fast-Pass QR), logo oficial con aro blanco idéntico a la web y rediseño limpio sin amontonamiento en Home de V2',
            'Sitio Web tacosgavilan.com (v112–v117): ordenamiento automático mensual de las 15 sucursales de mayor a menor venta conectado en vivo a Supabase (homologado con el módulo VENTAS), adaptación proporcional del mapa interactivo y fitBounds para pantallas de Tesla y cualquier dispositivo, geolocalización Find Me de 3 capas con tarjeta Obsidian & Gold, correo oficial support@tacosgavilan.com con envío real Gmail OAuth2 (/api/contact), pestañas en Gotham Ultra amarillo, Taco de Cabeza Opción 5 en 4K y leyenda "Auténtica Comida Mexicana / Authentic Mexican Food"',
            'Módulo Mantenimiento y Proveedores (/mantenimiento/registro, /admin/mantenimiento y /api/mantenimiento?directory=1): sugerencias rápidas en el Paso 2 alimentadas dinámicamente del historial real de empresas y técnicos que han dado servicio en las tiendas (autocompletando empresa, técnico, teléfono y categoría en 1 toque), tarjeta de bienvenida explicativa con el logo oficial de Tacos Gavilan y lema "¡Ya está!" sin duplicaciones, y selección híbrida en el Paso 1 (GPS automático + selector manual en respaldo mutuo)',
            'Módulo Contabilidad Cohesion (/contabilidad): apertura automática de la semana anterior completa (Lunes a Domingo) exclusivamente al entrar al módulo en día lunes (getDay() === 1 en horario de Los Ángeles), y consolidación de 187.7 horas de ingeniería (Desarrollador del Sistema & IT en La Bodega) (1 al 24 de Octubre 2026)'
        ],
        highlightsEn: [
            'Multi-Company External Accounting (/admin/contabilidad-externa, lib/external-accounting-qbo-sync.ts & /api/external-accounting): live bidirectional Intuit QuickBooks Online V3 synchronization (create, edit, and delete with SyncToken across all 8 companies), zero-noise institutional UI with QBO 2-Line Bank Register, Inline Quick-Add, Split Breakdown, dedicated clean-window PDF print engine, and Universal Click-to-Preview Modal across every tab with Print, Edit, and two-step confirmed Delete actions',
            'Customer Mobile App (/app, /app/v1, /app/v2, CustomerAppV2Pro.tsx, gavilan-app & lib/mobile-auth-email.ts): 1-tap direct order.online launch for the active store from the Menu tab in both V1 and V2, live 6-digit Email OTP sign-in and profile persistence via Gmail/Supabase (/api/mobile/auth/send-otp, /api/mobile/auth/verify-otp, and /api/mobile/user/profile), strict Zero-Emoji policy, removal of mock elements (Fast-Pass QR), unified white-ring website logo, and decluttered V2 Home screen layout',
            'tacosgavilan.com Website (v112–v117): automatic monthly ordering of all 15 branches from highest to lowest sales synced live with Supabase (matching the VENTAS module), proportional interactive map and fitBounds scaling for Tesla vehicle displays and all viewports, 3-tier Find Me geolocation with Obsidian & Gold store popup cards, live support@tacosgavilan.com Gmail OAuth2 dispatch (/api/contact), Gotham Ultra brand-yellow category tabs, 4K Cabeza Taco Option 5, and "Authentic Mexican Food / Auténtica Comida Mexicana" header tag',
            'Maintenance & Service Providers (/mantenimiento/registro, /admin/mantenimiento & /api/mantenimiento?directory=1): dynamic Step 2 quick-suggestion chips powered by real historical service companies and technicians per store (auto-filling company, technician, phone, and category in 1 tap), onboarding welcome banner with the official Tacos Gavilan logo and "¡Ya está!" motto without visual duplication, and Step 1 mutual-fallback hybrid GPS + manual branch selection',
            'Cohesion Accounting Module (/contabilidad): automatic full prior-week loading (Monday–Sunday) when opening the module on Mondays (getDay() === 1 in Los Angeles time), and 187.7 engineering hours (System Developer & IT at La Bodega) consolidated (October 1–24, 2026)'
        ]
    },
    {
        version: 'v2.19.0',
        date: '23-Oct-2026',
        titleEs: 'Contabilidad Externa (8 Empresas QBO), Crear Bills Viele & Sons (Wholesail + Cron 4PM), App Clientes V2 Pro & order.online, Erradicación Tormenta Realtime (-99.8%) y Basecamp (-30.5 GB) y Menú Web 4K',
        titleEn: 'External Accounting (8 QBO Companies), Viele & Sons Bills (Wholesail + 4PM Cron), Customer App V2 Pro & order.online, Realtime Storm Eradication (-99.8%), Basecamp (-30.5 GB) & 4K Web Menu',
        highlightsEs: [
            'Nuevo Módulo "Contabilidad Externa" (/admin/contabilidad-externa, /api/external-accounting y /api/external-accounting/reports): extracción histórica completa desde Intuit QuickBooks Online y sembrado en Supabase de las 8 compañías contables manejadas por Raquel Velasquez (Raquel Accounting, 7947 Downey Plaza LLC, Canasty Financial, LLC, Chicken Taco Catering LLC, Elveze LLC, Govegu LLC, Gutierrez Financial y TEG Holdings Inc) con catálogo de cuentas, terceros, transacciones y 12 reportes financieros oficiales, protegido con lista blanca estricta para Raquel, Roberto y Roque',
            'Módulo Crear Bills — Nuevo Submódulo "Viele & Sons (Wholesail)" (/admin/crear-bills, lib/viele-wholesail-bills.ts, /api/quickbooks/viele-bills y /api/cron/sync-viele-bills): sincronización de las 15 sucursales desde Wholesail y ClearNine para capturar las 3 facturas semanales por tienda (1. Sodas BIB Wxxxxxx → 50001 Beverages, 2. Insumos Generales Wxxxxxx → 53050 Restaurant Supplies con split automático en 2 líneas para Cloro 3BLEA $12.01 hacia 51170 Janitorial Supplies, y 3. Químicos Imperial Chemical 50xxxxx → 51170 Janitorial Supplies), auditado contra 486 Bills históricos en QBO ($499,049.31), filtro de /FUEL y cron diario a las 4:00 PM Los Ángeles',
            'Order Ready Board, Basecamp y Supabase (commits 0dfc0358 y 17b01427): erradicación definitiva de la tormenta de 30.31 millones de mensajes Realtime mediante 5 capas de protección (items_summary canónico determinista, trigger anti-no-op JSONB, candado distribuido por tienda y canales aislados, reduciendo el tráfico en 99.77%) y liberación de 30.53 GB en Supabase Storage tras purgar 166,509 adjuntos duplicados de Basecamp y blindar lib/basecamp-api.ts',
            'App Móvil Clientes (/app, /app/v1, /app/v2 y gavilan-app): lanzamiento de la "Versión 2" (CustomerAppV2Pro.tsx) con 5 historias verticales, inicio de sesión multi-plataforma (Apple, Google, Facebook, SMS OTP y Correo), envoltura nativa de order.online para las 15 sucursales, modo TEST FULLSCREEN y homologación de los 15 nombres canónicos de tienda',
            'Sitio Web tacosgavilan.com: actualización de las 23 fotografías del menú en calidad 4K de estudio sobre fondo negro #000000 (incluyendo los 8 tacos alineados en tortilla completa y Taco de Lengua bicolor al vapor), Hero original completo sin recortes, logo oficial con círculo blanco al doble de tamaño y carrusel interactivo bidireccional infinito en iOS Safari',
            'Contabilidad (paso dedicado refundBusinessDate para reembolsos de fechas cruzadas en Rialto, commit 005bfc71), Motor Táctil Ultra-Sensible con sesión de 10 min en las 5 tabletas, Zoom Táctil (100%–250%) en Actividades, auto-scroll al módulo activo en AppSidebar y 173.6 horas de ingeniería (Desarrollador del Sistema & IT en La Bodega) consolidadas (1 al 23 de Octubre 2026)'
        ],
        highlightsEn: [
            'New "External Accounting" Module (/admin/contabilidad-externa, /api/external-accounting & /api/external-accounting/reports): complete historical extraction from Intuit QuickBooks Online and Supabase seeding across all 8 companies managed by Raquel Velasquez (Raquel Accounting, 7947 Downey Plaza LLC, Canasty Financial, LLC, Chicken Taco Catering LLC, Elveze LLC, Govegu LLC, Gutierrez Financial, and TEG Holdings Inc) including Chart of Accounts, entities, transactions, and 12 official financial reports per company, protected by a strict email whitelist for Raquel, Roberto, and Roque',
            'Crear Bills Module — New "Viele & Sons (Wholesail)" Submodule (/admin/crear-bills, lib/viele-wholesail-bills.ts, /api/quickbooks/viele-bills & /api/cron/sync-viele-bills): 15-store synchronization across Wholesail and ClearNine capturing all 3 weekly invoices per branch (1. Sodas BIB Wxxxxxx → 50001 Beverages, 2. General Supplies Wxxxxxx → 53050 Restaurant Supplies with automatic 2-line split for Bleach 3BLEA $12.01 into 51170 Janitorial Supplies, and 3. Imperial Chemical 50xxxxx → 51170 Janitorial Supplies), audited against 486 historical QBO bills ($499,049.31), /FUEL exclusion, and daily 4:00 PM Los Angeles cron',
            'Order Ready Board, Basecamp & Supabase (commits 0dfc0358 & 17b01427): eradicated the 30.31M Realtime message storm via 5 protection layers (deterministic canonical items_summary, JSONB no-op trigger suppression, per-store distributed sync leases, and store-scoped channels, cutting traffic by 99.77%) and freed 30.53 GB in Supabase Storage by purging 166,509 duplicate Basecamp attachments and hardening lib/basecamp-api.ts',
            'Customer Mobile App (/app, /app/v1, /app/v2 & gavilan-app): launched "Version 2" (CustomerAppV2Pro.tsx) with 5 vertical stories, multi-platform sign-in (Apple, Google, Facebook, SMS OTP, and Email), native order.online wrapper across all 15 branches, TEST FULLSCREEN mode, and canonical 15-store naming alignment',
            'tacosgavilan.com Website: upgraded all 23 menu photos to 4K studio quality on pure black #000000 cards (including all 8 tacos aligned on full double tortillas and steamed two-tone Lengua Taco), uncropped original Hero banner, 2x white-ring official logo, and touch-draggable bidirectional infinite carousel on iOS Safari',
            'Accounting (dedicated refundBusinessDate cross-date refund sweep in Rialto, commit 005bfc71), Ultra-Responsive Touch Engine with 10-min timeout across all 5 tablets, Touch Zoom (100%–250%) in Actividades, AppSidebar active-item auto-scroll, and 173.6 engineering hours (System Developer & IT at La Bodega) consolidated (October 1–23, 2026)'
        ]
    },
    {
        version: 'v2.18.0',
        date: '20-Oct-2026',
        titleEs: 'Actividades 200 Nombres Cortos & Mapa Físico 15 Tiendas, Gavilan POS 13.48M Unidades (Bebidas M/L & Cero Emojis), Descansos IA V28, Blindaje Delivery Anti-Regresión, Order Ready <1s y Supabase 156 Tablas RLS',
        titleEn: 'Actividades 200 Short Names & 15-Store Physical Map, Gavilan POS 13.48M Units (M/L Drinks & Zero Emojis), Breaks AI V28, Delivery Shield Anti-Regression, Order Ready <1s & 156-Table Supabase RLS',
        highlightsEs: [
            'Módulo ACTIVIDADES (/actividades y AsignacionDiariaTab.tsx): formalización de las 200 actividades en Supabase (140 Catálogo + 60 Roles) con Nombres Cortos ejecutivos (2–5 palabras) y Descripciones Detalladas desplegables alineadas 100% con Orden Diaria y Orden de Líquidos, resolución de los 7 hallazgos de expansión a las 15 sucursales preservando el 100% de las asignaciones del mánager (5,543 filas verificadas), Tablero Operativo 100vw × 100dvh exclusivo para el mapa físico de estaciones (sin cuadros de Liderazgo ni Extra) y botón "☀️ Despertar Tableta" visible únicamente cuando las 5 tabletas están dormidas',
            'Gavilan POS (/gavilan-pos y CashierRegister.tsx): pantalla de caja basada en 13.48 millones de unidades vendidas (27,792 tickets + 5,235 días-tienda de PMIX en For Here, To Go y Drive-Thru), Estación de Bebidas reorganizada con selectores limpios "M" y "L" sin ruido visual, política Cero Emojis, jerarquía tipográfica anti-fatiga y motor universal de Pago Dividido y Múltiples Métodos de Pago (Split Payment / Multi-Tender con Efectivo, Tarjeta, Gift Card y EBT CalFresh RMP)',
            'Motor IA de Descansos V28 (/descansos y lib/breaks-engine.ts, commit af086eee): calibración sobre 773 turnos auditados y 477 patrones limpios de Jesús en Slauson #7 con escalera de relevos de almuerzo de 30 minutos (30-min lunch relay ladder), reserva de ventana final, precisión de cohorte de líderes y retiro del botón redundante "⚡ Recalcular IA"',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque y lib/delivery-armor.ts): candado monótono definitivo que impide que una orden entregada (HANDED_OFF) regrese a estatus EMPACANDO, y protección anti-parpadeo ante paginación parcial de Toast API (/orders/v2/ordersBulk) para que las órdenes activas nunca desaparezcan de la pantalla',
            'Order Ready Board (/order-ready-board, /api/order-ready/call y lib/order-ready-tts.ts): aislamiento de canal por petición para evitar pérdida de locución nocturna en toques simultáneos (<1 segundo entre órdenes) y auditoría/reparación de los 4,000 archivos WAV Kore en Supabase Storage (regenerando los 15 clips corruptos)',
            'Seguridad Supabase Zero-Downtime en las 156 tablas (0 alertas 0013/0008 en Security Advisor), tarjetas inferiores de descarga CSV en TEG Assistant AI y 146.2 horas de ingeniería (Desarrollador del Sistema & IT en La Bodega) consolidadas (1 al 20 de Octubre 2026)'
        ],
        highlightsEn: [
            'ACTIVIDADES Module (/actividades & AsignacionDiariaTab.tsx): standardized all 200 Supabase activities (140 Catalog + 60 Roles) with 2–5 word executive Short Names and expandable Detailed Descriptions aligned 100% with Daily Order and Liquids Order catalogs, resolved all 7 15-store expansion findings while preserving 100% of manual manager assignments (5,543 verified rows), full-screen 100vw × 100dvh Operational Board rendering strictly the physical station map (no Leadership or Extra boxes), and "☀️ Wake Up Tablet" button shown only when the 5 store tablets are asleep',
            'Gavilan POS (/gavilan-pos & CashierRegister.tsx): cashier register screen engineered from 13.48 million units sold (27,792 tickets + 5,235 store-days of PMIX across For Here, To Go, and Drive-Thru), reorganized Drink Station with clean "M" and "L" selectors, strict Zero-Emoji Policy, anti-fatigue typography, and universal Split Payment & Multi-Tender engine (Cash, Card, Gift Card, and CalFresh RMP EBT)',
            'Breaks AI Engine V28 (/descansos & lib/breaks-engine.ts, commit af086eee): calibrated across 773 audited shifts and 477 clean manager patterns from Jesús at Slauson #7 featuring a 30-minute lunch relay ladder, tail-window reservation, leader cohort precision, and removal of the redundant "⚡ Recalculate AI" button',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque & lib/delivery-armor.ts): strict monotonic state lock preventing delivered (HANDED_OFF) orders from ever regressing to PACKING, plus anti-flicker cache protection when Toast API bulk pagination (/orders/v2/ordersBulk) partially times out on Page 2+',
            'Order Ready Board (/order-ready-board, /api/order-ready/call & lib/order-ready-tts.ts): per-request broadcast isolation preventing late-night missed callouts on sub-second concurrent bumps (<1s apart) and forensic audit/repair of all 4,000 Kore WAV clips in Supabase Storage (regenerating all 15 corrupted clips)',
            '156-table Supabase Zero-Downtime RLS hardening (0 Security Advisor 0013/0008 warnings), bottom CSV download cards in TEG Assistant AI, and 146.2 engineering hours (System Developer & IT at La Bodega) consolidated (October 1–20, 2026)'
        ]
    },
    {
        version: 'v2.17.0',
        date: '19-Oct-2026',
        titleEs: 'Auto-Reconfiguración 24/7 en 5 Tabletas & Modal Despertar 3h, Estabilización Integral ACTIVIDADES (A01–A26), Voceo Café & Champurrado, Asistente IA Tablas 42 Semanas + CSV y Etiqueta Salsa 5oz Cilíndrica',
        titleEn: '5-Tablet 24/7 Auto-Reconfig & 3h Wake Modal, Full ACTIVIDADES Stabilization (A01–A26), Café & Champurrado Voice Callouts, TEG Assistant 42-Week Tables + CSV & 5oz Cylindrical Label',
        highlightsEs: [
            'Sistema de Reconfiguración Automática 24/7, Renovación Silenciosa de Sesión y Modal "☀️ Despertar Tableta" (tras 3 horas de inactividad) en las 5 tabletas operativas de tienda (Cocina Trasera/Bodega, Proyección de Carnes + Llamadas, Blindaje Delivery, Descansos y Actividades/Asignación Diaria + Order Ready Board) con lib/tablet-cache-cleaner.ts y /api/auth/refresh',
            'Estabilización Integral y Blindaje Transaccional del Módulo ACTIVIDADES (Hallazgos A01–A26 + 58/58 pruebas en vivo): endurecimiento de políticas RLS en station_assignments y checklist_completions, revocación de permisos EXECUTE a anon en RPCs SECURITY DEFINER, corte operativo multitienda de las 06:00 AM y resolución de conflictos 409 entre AM+PM vs AM/PM',
            'Preparador KDS y Order Ready Board (commit d6ce9138): botones táctiles "☕ Café" y "☕ Champurrado" en la tableta del Preparador con transmisión silenciosa en tiempo real hacia la PC del Manager y locuciones WAV neuronales ("Café pendiente ya está listo" y "Champurrado pendiente ya está listo")',
            'TEG Assistant AI (lib/chat-tools.ts, app/api/support-chat/route.ts y SupportChatWidget.tsx): corrección de uniones SQL en store_id (8/8 pruebas en vivo), renderizado completo sin truncamiento de tablas grandes de 5 y 42 semanas y botón garantizado "⬇️ Descargar CSV (Excel)"',
            'Módulo Sitio Web (/nueva-web): barra superior de filtros homologada 1:1 con VENTAS, paginación completa en Supabase sin límite de 1,000 filas y gestión de activación de DoorDash Storefront API (Business ID: 137616)',
            'Ingeniería de Etiqueta Botella de Salsa Picante 5 fl. oz. ("Versión Dueño" por desenrollado cilíndrico sin acento en "Gavilan" y texto de ingredientes negro puro #000000 para impresora Epson 3840 en Imprimir_Prueba_1a1_Tacos_Gavilan_5oz_Carta.pdf) y auditoría contable de Orden Abierta #512 vs Cohesion'
        ],
        highlightsEn: [
            '24/7 Automatic Daily Reconfiguration, Silent Session Renewal & 3-Hour Inactivity "☀️ Wake Up Tablet" Modal across all 5 store tablets (Back Kitchen/Bodega, Meat Projection + Callouts, Delivery Shield, Breaks, and Daily Activities/Assignments + Order Ready Board) via lib/tablet-cache-cleaner.ts and /api/auth/refresh',
            'Full Stabilization & Transactional Hardening of the ACTIVIDADES Module (Findings A01–A26 + 58/58 live tests passed): hardened RLS policies on station_assignments and checklist_completions, revoked anon EXECUTE on SECURITY DEFINER RPCs, unified multi-store 06:00 AM boundaries, and eliminated false-positive 409 Conflicts between AM+PM and single-shift revisions',
            'Prep Line KDS & Order Ready Board (commit d6ce9138): touch buttons for "☕ Café" and "☕ Champurrado" on the Prep Line tablet routed silently in real time to the Manager PC with neural WAV callouts ("Café pendiente ya está listo" and "Champurrado pendiente ya está listo")',
            'TEG Assistant AI (lib/chat-tools.ts, app/api/support-chat/route.ts & SupportChatWidget.tsx): fixed store_id SQL join types (8/8 live tests passed), full untruncated rendering for 5-week and 42-week store sales tables, and guaranteed "⬇️ Download CSV (Excel)" button',
            'Website Module (/nueva-web): filter bar aligned 1:1 with the VENTAS module, full uncapped Supabase pagination (>1,000 rows), and DoorDash Storefront API activation request (Business ID: 137616)',
            '5 fl. oz. Hot Sauce Bottle Label Engineering ("Owner\'s Choice" via cylindrical unwrapping, accent-free "Gavilan", and pure black #000000 ingredients text for Epson 3840 inkjet printing in Imprimir_Prueba_1a1_Tacos_Gavilan_5oz_Carta.pdf) and Open Order #512 Cohesion accounting audit'
        ]
    },
    {
        version: 'v2.16.0',
        date: '17-Oct-2026',
        titleEs: 'Motor IA Descansos V27 (48 Días Slauson), RONOS Ponchadas en Vivo & Nómina Limpia, Mantenimiento 8 Escenarios Sin Marcas, Menu 2 Carrito v3 + Storefront API, Blindaje Delivery #975 y Reorganización de 6 Categorías',
        titleEn: 'Breaks AI Engine V27 (48-Day Slauson Backtest), RONOS Live Punches & Clean Payroll, Brand-Free Maintenance 8 Scenarios, Menu 2 Cart v3 + Storefront API, Blindaje Delivery #975 & 6-Category Reorganization',
        highlightsEs: [
            'Motor IA de Descansos V27 (lib/breaks-engine.ts y /descansos): aprendizaje calibrado sobre movimientos manuales del mánager en Slauson #7 respetando horas pico, límites de turno, 5ª hora de California y segundo lunch en turnos extendidos (validado con 48 días reales de Septiembre y Octubre 2026 en Slauson + 379 simulaciones en las 15 sucursales)',
            'RONOS en Vivo y Conciliación de Nómina (/admin/ronos): sincronización en tiempo real de las ponchadas de hoy en las 16 ubicaciones (StoreAttendanceTab.tsx) y depuración de la pestaña Nómina (PayrollReconciliationTab.tsx y lib/payroll-reconciliation.ts) eliminando filas vacías (0.00h / "No disponible") y cuentas "Manager Default"',
            'Mantenimiento y Proveedores (/mantenimiento/registro y /admin/mantenimiento): eliminación total de marcas comerciales en sugerencias rápidas e integración de 8 mejoras técnicas y 8 escenarios operativos reales (La Bodega, garantías, seguimiento multi-visita, emergencias y firmas táctiles)',
            'App Móvil Clientes Menu 2 + DoorDash Storefront API (/app y gavilan-app): carrito v3 aislado por sucursal con identidad determinista lineId, validación de precios en servidor, límite de peticiones y contrato estricto order_session (15/15 pruebas runtime y 801/801 aserciones de cumplimiento)',
            'Blindaje Delivery (resolución de orden #975 Karla M con desfase UTC/programada, sesión de PIN de 2 minutos con botón nítido "Cerrar Sesión", audio de voz/campanita permanentemente activo, sincronización automática en tiempo real de PINs contra RONOS API para altas/bajas, auditoría forense de 450 cierres de septiembre, comunicado ejecutivo y Manual SOP de 1 sola página Manual_Procedimiento_Tableta_Blindaje_Delivery_Tacos_Gavilan.pdf)',
            'Reorganización intuitiva de las 6 categorías en /inicio y AppSidebar (Feedback Staff junto a Feedback Clientes y RONOS en Finanzas y Contabilidad), supresión de alertas en Dashboard por vacaciones/descanso (vacation / day_off), desglose Pickup vs Delivery de order.online en /nueva-web, orden cronológico created_at ASC en Basecamp y 129.4 horas de ingeniería (Desarrollador del Sistema & IT en La Bodega) (1 al 17 de Octubre 2026)'
        ],
        highlightsEn: [
            'Breaks AI Engine V27 (lib/breaks-engine.ts & /descansos): calibrated AI learning from Slauson #7 manager manual adjustments while enforcing peak-hour protection, shift boundaries, 5th-hour California meal compliance, and extended-shift 2nd lunches (verified across 48 real Slauson days in Sept–Oct 2026 + 379 simulation runs across all 15 stores)',
            'RONOS Live Attendance & Payroll Reconciliation (/admin/ronos): real-time today punch synchronization across all 16 locations (StoreAttendanceTab.tsx) and clean biweekly Payroll tab (PayrollReconciliationTab.tsx & lib/payroll-reconciliation.ts) filtering out empty 0.00h / "Unavailable" rows and "Manager Default" accounts',
            'Maintenance & Service Providers (/mantenimiento/registro & /admin/mantenimiento): 100% brand-free quick-suggestion chips plus 8 technical upgrades and 8 real-world store service scenarios (La Bodega support, warranty/emergency tracking, multi-visit follow-ups, and touch signatures)',
            'Customer Mobile App Menu 2 + DoorDash Storefront API (/app & gavilan-app): store-scoped cart v3 with deterministic lineId identity, server-side price validation, rate limiting, and strict order_session contract (15/15 runtime tests and 801/801 compliance assertions passed)',
            'Blindaje Delivery (resolved scheduled/midnight-UTC DoorDash Order #975 Karla M via createdDate, 2-minute PIN session timeout with crisp "Log Out / Cerrar Sesión" button, permanent always-on voice/bell audio, real-time RONOS API roster & PIN sync for new hires/terminations, 450-close September audit, executive briefing email, and 1-page SOP Manual Manual_Procedimiento_Tableta_Blindaje_Delivery_Tacos_Gavilan.pdf)',
            'Mental-model reorganization of all 6 categories in /inicio & AppSidebar (Feedback Staff next to Customer Feedback and RONOS under Finance & Accounting), Dashboard alert suppression for supervisors on vacation/day_off, order.online Pickup vs Delivery split in /nueva-web, chronological created_at ASC sorting in Basecamp, and 129.4 engineering hours (System Developer & IT at La Bodega) consolidated (October 1–17, 2026)'
        ]
    },
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
            'Enlace profundo bidireccional entre el Dashboard Ejecutivo (/dashboard) y sus 6 módulos alimentadores, Wake Lock de doble capa (lib/use-wake-lock.ts + wake-lock.mp4) para Modo Tableta en Descansos y Asignación Diaria, Check # prominente en Blindaje Delivery, Basecamp 6 capas con fecha/hora de creación y 120.7 horas de ingeniería (Desarrollador del Sistema & IT en La Bodega) consolidadas (1 al 16 de Octubre 2026)'
        ],
        highlightsEn: [
            'New categorized Launchpad Hub (/inicio), all 6 AppSidebar sections expanded by default with differentiated color palettes, post-login destination selector (INICIO vs Executive Dashboard after 3D Splash), and standardized "NEW" and "[ 🚧 Building ]" status badges',
            'Customer Mobile App (/app & gavilan-app): compacted native "Menu 2" (single Horchata card with Medium/Large selector, unified Tacos submenu with dynamic protein photo switching and 2-step customizer modal), live Delivery Address Autocomplete (/api/mobile/address/autocomplete), Option A cart-preserving checkout, and DoorDash Developer API integration',
            'tacosgavilan.com & "Website" module (/nueva-web): full-width SM TEG Light Mode redesign, iPad/iPhone device simulators, Time-Window Order Matching with Toast POS orders, CCPA/CPRA 2026 legal compliance, strict Consent Mode v2 gating, GPC signal support, and 0 axe-core WCAG 2.2 AA violations across 12 contexts',
            'Proprietary Packaging Engineering (5 fl. oz. Hot Sauce Bottle): Manufacturing Tech Pack (6.65" × Ø 1.85", 24-414 finish) and 3 100% original label designs using official Adobe Illustrator SVG vectors and Gotham Ultra in a 100% pure-vector 1:1 US Letter print sheet (Imprimir_Prueba_1a1_Tacos_Gavilan_5oz_Carta.pdf)',
            'Bidirectional deep-linking between Executive Dashboard (/dashboard) and its 6 feeder modules, dual-layer Screen Wake Lock (lib/use-wake-lock.ts + wake-lock.mp4) for Tablet Mode in Breaks & Daily Assignment, prominent Check # badge in Blindaje Delivery, 6-layer Basecamp sync with creation timestamps, and 120.7 engineering hours (System Developer & IT at La Bodega) consolidated (October 1–16, 2026)'
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
            'Order Ready Board & Preparador KDS: columna izquierda renombrada a "Entregadas / Delivered", soporte de folios offline de 6 dígitos (80001+), diseño ejecutivo sobrio con badges FOR HERE / TO GO, apertura instantánea de recibos Toast y consolidación de 112.1 horas de ingeniería (Desarrollador del Sistema & IT en La Bodega) (1 al 15 de Octubre 2026)'
        ],
        highlightsEn: [
            'Gavilan POS Cloud (/gavilan-pos & /api/gavilan-pos/overview) & Executive PDF Report (Informe_Ejecutivo_Gavilan_POS_Tacos_Gavilan.pdf): 9-module Light Mode POS ecosystem plus executive brief on legal hardware ownership, real Toast store costs, card processing, and direct 3PD APIs',
            'Blindaje Delivery (/admin/blindaje-delivery/empaque): seamless cross-cashier shift handover continuity (Step 1 -> Step 2), 7 operational safeguards at Slauson #7 (driver-present guard, undo packing, reopen delivery), manual-only order selection without QR references, and tap-outside blank-space deselection',
            'Accounting (/contabilidad): extracted and audited all 135 Cohesion workflow settings screens (15 stores × 9 tabs), resolved negative Paid In (-$0.99 in LA Broadway), and enforced strict Toast POS Deposit lock (HTTP 422 PENDING_TOAST_DEPOSIT)',
            'Customer Mobile App (/app & gavilan-app): foreground GPS locator sorting all 15 branches by proximity, 1-tap dialing and Apple/Google Maps routing, hardened Toast Online WebView (800-assertion compliance suite), root route collision fix, and 4 bilingual store-compliance pages',
            'Order Ready Board & Prep Line KDS: renamed left column to "Entregadas / Delivered", 6-digit offline Toast order number support (80001+), clean executive UI with FOR HERE / TO GO badges, instant Toast receipt cache, and 112.1 engineering hours (System Developer & IT at La Bodega) consolidated (October 1–15, 2026)'
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
