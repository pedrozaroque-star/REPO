const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🌟 RECONSTRUYENDO LOS 3 REPORTES CON GANTT Y ESTRUCTURA IDÉNTICA');
console.log('═══════════════════════════════════════════════════════════════════════');

// Time conversion
function timeToDecimal(timeStr) {
    if (!timeStr) return null;
    const match = timeStr.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = match[3].toUpperCase();

    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    return hour + min / 60;
}

function intervalToPercentages(startDec, endDec) {
    const minRuler = 4.0;
    const maxRuler = 24.0;
    const totalRuler = 20.0;

    let s = Math.max(minRuler, Math.min(maxRuler, startDec));
    let e = Math.max(minRuler, Math.min(maxRuler, endDec));
    if (e <= s) e = s + 1.0;

    const left = ((s - minRuler) / totalRuler) * 100;
    const width = Math.max(3.5, ((e - s) / totalRuler) * 100);

    return {
        left: left.toFixed(1) + '%',
        width: width.toFixed(1) + '%'
    };
}

function parseSessions(timeStr, dayBadges, dayDesc) {
    const rawBlocks = timeStr.split(/[&,]|<br\s*\/?>|\band\b/i).map(s => s.trim()).filter(Boolean);
    const sessions = [];

    rawBlocks.forEach((block, idx) => {
        const parts = block.split(/\s*-\s*|\s*a\s*/i);
        if (parts.length === 2) {
            const startDec = timeToDecimal(parts[0]);
            const endDec = timeToDecimal(parts[1]);
            if (startDec !== null && endDec !== null) {
                const duration = Math.max(0.5, endDec >= startDec ? (endDec - startDec) : (24 - startDec + endDec));
                const pct = intervalToPercentages(startDec, endDec);
                sessions.push({
                    startStr: parts[0].trim(),
                    endStr: parts[1].trim(),
                    startDec,
                    endDec,
                    duration: duration.toFixed(1),
                    left: pct.left,
                    width: pct.width,
                    badge: dayBadges[idx % dayBadges.length] || 'Sistema'
                });
            }
        }
    });

    return sessions;
}

function getDayOfWeek(dateStr, monthNum, year = 2026) {
    const dayNum = parseInt(dateStr.replace(/[^0-9]/g, ''), 10);
    const d = new Date(year, monthNum - 1, dayNum);
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[d.getDay()];
}

// 1. EXTRACT DATA FOR JUNE
const juneBackupHtml = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const juneRows = [];
const juneTableMatch = juneBackupHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
if (juneTableMatch) {
    const trMatches = [...juneTableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    trMatches.forEach(tr => {
        const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
        if (tdMatches.length >= 5) {
            const date = tdMatches[0].replace(/<[^>]+>/g, '').trim();
            const time = tdMatches[1].replace(/<br\s*\/?>/gi, ' & ').replace(/<[^>]+>/g, '').trim();
            const hours = parseFloat(tdMatches[2].replace(/<[^>]+>/g, '').trim()) || 0;
            const badges = [...tdMatches[3].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map(b => b[1].trim());
            const esMatch = tdMatches[4].match(/<div class="es-desc">([\s\S]*?)<\/div>/i);
            const enMatch = tdMatches[4].match(/<div class="en-desc">([\s\S]*?)<\/div>/i);
            juneRows.push({
                date,
                time,
                hours,
                badges: badges.length ? badges : ['Sistema'],
                descEs: esMatch ? esMatch[1].trim() : tdMatches[4],
                descEn: enMatch ? enMatch[1].trim() : ''
            });
        }
    });
}
let juneTasksHtmlMatch = juneBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<!-- End Tab/i) || 
                         juneBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="main-footer">/i) ||
                         juneBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>/i);
const juneTasksHtml = juneTasksHtmlMatch ? juneTasksHtmlMatch[1].trim() : '';

// 2. EXTRACT DATA FOR JULY
const julyBackupHtml = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');
const julyRows = [];
const julyTableMatch = julyBackupHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
if (julyTableMatch) {
    const trMatches = [...julyTableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    trMatches.forEach(tr => {
        const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
        if (tdMatches.length >= 5) {
            const date = tdMatches[0].replace(/<[^>]+>/g, '').trim();
            const time = tdMatches[1].replace(/<br\s*\/?>/gi, ' & ').replace(/<[^>]+>/g, '').trim();
            const hours = parseFloat(tdMatches[2].replace(/<[^>]+>/g, '').trim()) || 0;
            const badges = [...tdMatches[3].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map(b => b[1].trim());
            const esMatch = tdMatches[4].match(/<div class="es-desc">([\s\S]*?)<\/div>/i);
            const enMatch = tdMatches[4].match(/<div class="en-desc">([\s\S]*?)<\/div>/i);
            julyRows.push({
                date,
                time,
                hours,
                badges: badges.length ? badges : ['Sistema'],
                descEs: esMatch ? esMatch[1].trim() : tdMatches[4],
                descEn: enMatch ? enMatch[1].trim() : ''
            });
        }
    });
}
let julyTasksHtmlMatch = julyBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>/i);
const julyTasksHtml = julyTasksHtmlMatch ? julyTasksHtmlMatch[1].trim() : '';

// 3. EXTRACT DATA FOR AUGUST (22 Days with full detailed sessions)
const augustRows = [
    {
        date: '01-Ago-2026',
        time: '6:30 PM - 9:00 PM',
        hours: 4.5,
        badges: ['Preparador', 'Soporte IA'],
        descEs: '• <strong>Preparador (Tramos de Hora Pico)</strong>: Transición de bloques de 30 min a tramos de demanda (Apertura, Almuerzo, Medio Día, Cena, Cierre) y ajuste dinámico por horario de apertura de tienda.<br>• <strong>Preparador (Datos en Vivo & Máx. Charola)</strong>: Refresco HTTP sin caché (<code>no-store</code>), cálculo de REAL/hr y badge de capacidad máxima de charola por proteína.<br>• <strong>Soporte IA</strong>: Sincronización del asistente de soporte con el módulo preparador.',
        descEn: '• <strong>Prep Line (Period Blocks)</strong>: Transitioned to peak time blocks with store opening offset.<br>• <strong>Prep Line (Live Data & Max Tray)</strong>: Zero-cache HTTP refresh and max tray holding capacities.<br>• <strong>AI Support</strong>: Synced assistant prompt with prep features.'
    },
    {
        date: '02-Ago-2026',
        time: '5:00 PM - 6:00 PM',
        hours: 1.0,
        badges: ['Preparador'],
        descEs: '• <strong>Preparador (Modo Básico vs Avanzado)</strong>: Conmutador de modo de visualización simplificada para cocina y restricción de alertas de preparación al modo avanzado.<br>• <strong>Preparador (Modo Tableta)</strong>: Badge de tableta para pantalla completa y auto-selección del día actual en la Guía Operativa.',
        descEn: '• <strong>Prep Line (Basic vs Advanced)</strong>: Simplified kitchen display switch and alert restrictions.<br>• <strong>Prep Line (Tablet Mode)</strong>: Fullscreen tablet kiosk badge and auto-day selector in operational guide.'
    },
    {
        date: '03-Ago-2026',
        time: '4:42 PM - 7:04 PM',
        hours: 3.92,
        badges: ['Inventario', 'QuickBooks'],
        descEs: '• <strong>Inventario (QuickBooks Estimates)</strong>: Corrección de actualización parcial configurando <code>sparse: false</code> para evitar borrado de líneas no enviadas por QBO.<br>• <strong>Inventario</strong>: Preservación de artículos extraordinarios en el estado local de React.',
        descEn: '• <strong>Inventory (QuickBooks Estimates)</strong>: Configured sparse: false on PATCH requests to prevent accidental item drops.<br>• <strong>Inventory</strong>: Preserved extraordinary items in React local state.'
    },
    {
        date: '04-Ago-2026',
        time: '9:45 AM - 7:00 PM',
        hours: 9.0,
        badges: ['Preparador', 'Inventario', 'Reportes'],
        descEs: '• <strong>Preparador (Edición Táctil Tap-to-Edit)</strong>: Sobreescritura manual de proyecciones de carne en modo básico con persistencia en base de datos.<br>• <strong>Preparador (Modo Manual Semanal)</strong>: Conmutador de 3 modos [Manual | Básica | Avanzada] persistente por día de semana.<br>• <strong>Inventario (PAR Semanal)</strong>: Actualización inmediata de PAR en Líquidos y Uniformes.<br>• <strong>Auditoría del Sistema</strong>: Análisis comparativo de los módulos del sistema.',
        descEn: '• <strong>Prep Line (Tap-to-Edit)</strong>: Manual meat projection overrides in basic mode with DB persistence.<br>• <strong>Prep Line (Weekly Mode Switcher)</strong>: 3-mode toggle with weekly recurring memory.<br>• <strong>Inventory (Weekly PAR)</strong>: Instant PAR adjustments for liquids and uniforms.<br>• <strong>System Audit</strong>: Gap analysis across all modules.'
    },
    {
        date: '05-Ago-2026',
        time: '2:15 PM - 3:53 PM',
        hours: 1.64,
        badges: ['Preparador', 'Reportes'],
        descEs: '• <strong>Preparador (Algoritmo de Acelerador)</strong>: Ajuste del ritmo de parrilla comparando ventas intradía reales contra curvas históricas de Toast.<br>• <strong>Reportes</strong>: Optimización de consultas SQL para carga instantánea de historial.',
        descEn: '• <strong>Prep Line (Intraday Accelerator)</strong>: Fine-tuned grill pace matching live sales against historical curves.<br>• <strong>Reports</strong>: Optimized SQL queries for instant history loading.'
    },
    {
        date: '06-Ago-2026',
        time: '12:30 PM - 1:45 PM',
        hours: 1.75,
        badges: ['Preparador', 'Base de Datos'],
        descEs: '• <strong>Preparador (Sincronización Tableta-PC)</strong>: Polling de auto-sincronización cada 10s para tableta de cocina, garantizando paridad exacta con la PC del gerente.<br>• <strong>Base de Datos</strong>: Migración de tabla <code>prep_manual_schedule</code> y compatibilidad de tipos storeId.<br>• <strong>Preparador</strong>: Letras grandes y números objetivo de alto contraste para visibilidad en cocina.',
        descEn: '• <strong>Prep Line (Tablet-PC Sync)</strong>: 10s auto-sync polling between manager PC and kitchen tablet.<br>• <strong>Database</strong>: Applied prep_manual_schedule migration and numeric storeId handling.<br>• <strong>Prep Line</strong>: Enlarged header fonts and high-contrast numbers for kitchen readability.'
    },
    {
        date: '07-Ago-2026',
        time: '2:30 PM - 5:02 PM',
        hours: 2.54,
        badges: ['Horarios', 'Descansos IA'],
        descEs: '• <strong>Horarios (Notificaciones de Violaciones)</strong>: Alertas automáticas por correo electrónico para violaciones de ALMUERZO (California Labor Law).<br>• <strong>Descansos IA</strong>: Priorización de salida anticipada para empleados con turnos más cortos.',
        descEn: '• <strong>Schedules (Violation Alerts)</strong>: Automated email notifications for meal break violations.<br>• <strong>Breaks AI</strong>: Early departure prioritization for shorter shift employees.'
    },
    {
        date: '08-Ago-2026',
        time: '11:45 AM - 6:54 PM',
        hours: 7.15,
        badges: ['Ventas Toast API', 'Descansos'],
        descEs: '• <strong>Ventas (Toast API & PMIX)</strong>: Conciliación de ventas de terceros (Uber Eats, DoorDash, Grubhub) y soporte de ítems EBT.<br>• <strong>Ventas</strong>: Filtros de canales y cálculo unificado de Net Sales = Sum(Price) - Discounts - Refunds.<br>• <strong>Descansos</strong>: Blindaje del cálculo de horas de comida.',
        descEn: '• <strong>Sales (Toast API & PMIX)</strong>: Reconciled 3rd-party delivery channels and EBT sales.<br>• <strong>Sales</strong>: Unified Net Sales calculation formula across all stores.<br>• <strong>Breaks</strong>: Hardened meal break window algorithms.'
    },
    {
        date: '09-Ago-2026',
        time: '2:09 PM - 7:33 PM',
        hours: 2.74,
        badges: ['Preparador', 'Telemetría'],
        descEs: '• <strong>Preparador (Simulación en Tiempo Real)</strong>: Pruebas de estrés del acelerador intradía y verificación del refresco cada 3 minutos desde <code>meat_consumption_history</code>.<br>• <strong>Telemetría</strong>: Monitoreo continuo del ritmo de cocción de parrilla en tiendas activas.',
        descEn: '• <strong>Prep Line (Live Simulation)</strong>: Stress-tested intraday accelerator and 3-min consumption cache refresh.<br>• <strong>Telemetry</strong>: Monitored real-time grill cooking pace in active stores.'
    },
    {
        date: '10-Ago-2026',
        time: '3:30 PM - 5:30 PM',
        hours: 2.3,
        badges: ['Uniformes', 'Caja Fuerte'],
        descEs: '• <strong>Uniformes (Control de Inventario)</strong>: Configuración de catálogo de precios (Camisas $7, Gorras $1, Chamarras $20) y exenciones para líderes.<br>• <strong>Caja Fuerte</strong>: Integración de ventas de uniformes en efectivo con el arqueo diario de bóveda.',
        descEn: '• <strong>Uniforms (Inventory Control)</strong>: Catalog pricing and manager role exemptions setup.<br>• <strong>Safe Box</strong>: Linked uniform cash sales with daily vault reconciliation.'
    },
    {
        date: '11-Ago-2026',
        time: '9:17 AM - 7:50 PM',
        hours: 3.18,
        badges: ['Uniformes', 'Caja Fuerte', 'Base de Datos'],
        descEs: '• <strong>Uniformes (Catálogos & Mapeo)</strong>: Conexión de recepción de pedidos de bodega con actualización automática de stock físico.<br>• <strong>Caja Fuerte (RBAC & Permisos)</strong>: Restricción de edición de arqueos pasados exclusivamente a supervisores y administradores.',
        descEn: '• <strong>Uniforms (Catalogs & Stock Sync)</strong>: Automated physical stock reception from warehouse orders.<br>• <strong>Safe Box (RBAC)</strong>: Restricted historical count edits to supervisors and admins.'
    },
    {
        date: '12-Ago-2026',
        time: '1:15 PM - 11:30 PM',
        hours: 4.33,
        badges: ['Basecamp API', 'Sincronizador'],
        descEs: '• <strong>Basecamp 3 (Integración Bidireccional)</strong>: Conexión oficial de API con tokens auto-renovables y persistencia local-first en Supabase.<br>• <strong>Basecamp</strong>: Sincronización continua de proyectos, to-dos, mensajes y campfire en segundo plano.',
        descEn: '• <strong>Basecamp 3 (Two-Way Sync)</strong>: OAuth2 connection with local-first Supabase caching.<br>• <strong>Basecamp</strong>: Continuous background sync for projects, todos, messages, and chat.'
    },
    {
        date: '13-Ago-2026',
        time: '8:45 AM - 8:30 PM',
        hours: 6.45,
        badges: ['Basecamp', 'Buscador Global', 'UX/UI'],
        descEs: '• <strong>Basecamp (Buscador Global Shift+J)</strong>: Búsqueda instantánea en tareas, mensajes y documentos con vista previa de archivos adjuntos.<br>• <strong>Basecamp</strong>: Implementación de atajos de teclado rápidos y modal Basecamp 4 Dialog Card con desenfoque.',
        descEn: '• <strong>Basecamp (Global Search Shift+J)</strong>: Instant search across tasks, messages, and docs with attachment previews.<br>• <strong>Basecamp</strong>: Keyboard shortcuts and modern Dialog Card modal.'
    },
    {
        date: '14-Ago-2026',
        time: '—',
        hours: 0.0,
        badges: ['Descanso'],
        descEs: '• <em>Día libre operativo sin sesiones de desarrollo registradas.</em>',
        descEn: '• <em>Operational rest day with no dev sessions logged.</em>'
    },
    {
        date: '15-Ago-2026',
        time: '10:15 AM - 7:30 PM',
        hours: 4.94,
        badges: ['MilesIQ', 'Geofencing', 'GPS'],
        descEs: '• <strong>MilesIQ Supervisores (Geofencing GPS)</strong>: Detección pasiva de arribo a cualquiera de las 15 tiendas oficiales + Bodega Central.<br>• <strong>MilesIQ</strong>: Notificación flotante de 1 toque con cálculo de distancia y monto IRS ($0.760/milla).',
        descEn: '• <strong>MilesIQ (GPS Geofencing)</strong>: Passive arrival detection across 15 store locations + Central Warehouse.<br>• <strong>MilesIQ</strong>: 1-tap floating drive logger with IRS mileage rate calculation.'
    },
    {
        date: '16-Ago-2026',
        time: '4:14 AM - 8:39 PM',
        hours: 6.96,
        badges: ['MilesIQ', 'Soporte IA', 'Navegación'],
        descEs: '• <strong>MilesIQ (Lanzador Rápido QuickDriveModal)</strong>: Selector de 1 toque con distancias calculadas y apertura directa de Google Maps/Apple Maps/Waze con tráfico en vivo.<br>• <strong>MilesIQ</strong>: Auto-sincronización de viajes al guardar inspecciones y soporte de re-visitas múltiples.<br>• <strong>Soporte IA</strong>: Integración de herramientas de consulta en el asistente de chat.',
        descEn: '• <strong>MilesIQ (QuickDriveModal)</strong>: 1-tap store selector with real-time GPS navigation in Maps/Waze.<br>• <strong>MilesIQ</strong>: Auto-sync from inspection forms and multi-stop support.<br>• <strong>AI Support</strong>: Added MilesIQ query tools into chat assistant.'
    },
    {
        date: '17-Ago-2026',
        time: '4:00 AM - 3:35 PM',
        hours: 4.43,
        badges: ['Radar de Precios', 'Viele & Sons v3', 'COGS'],
        descEs: '• <strong>Radar de Precios Proveedores (Viele & Sons API v3)</strong>: Extracción automática de los 86 insumos del catálogo maestro en 1.3 segundos.<br>• <strong>Radar de Precios</strong>: Cálculo de impacto financiero anual en dólares ($ USD) a nivel cadena (15 tiendas) y aprobación de cambios en cascada a Food Cost.',
        descEn: '• <strong>Price Radar (Viele & Sons API v3)</strong>: Automated 86-item master price sync in 1.3s.<br>• <strong>Price Radar</strong>: Chain-wide COGS annual inflation impact calculator and recipe cost cascade.'
    },
    {
        date: '18-Ago-2026',
        time: '11:00 AM - 6:29 PM',
        hours: 5.39,
        badges: ['Radar de Precios', 'Cron Semanal', 'Insumos'],
        descEs: '• <strong>Radar de Precios (Cron Automatizado)</strong>: Configuración de sincronización automática los lunes a las 6:00 AM con registro en <code>supplier_price_history</code>.<br>• <strong>Radar de Precios</strong>: Ingesta manual por portapapeles (Ctrl+V) y soporte para múltiples proveedores (Sysco, US Foods).',
        descEn: '• <strong>Price Radar (Automated Cron)</strong>: Weekly Monday 6:00 AM automated price scraper into supplier_price_history.<br>• <strong>Price Radar</strong>: Clipboard paste intake (Ctrl+V) and multi-vendor abstraction.'
    },
    {
        date: '19-Ago-2026',
        time: '9:44 AM - 5:15 PM',
        hours: 4.70,
        badges: ['Seguridad', 'Auditoría', 'Radar de Precios'],
        descEs: '• <strong>Auditoría & Blindaje de Seguridad</strong>: Corrección exhaustiva de 17 observaciones críticas en backend, sanitización de inputs y validación de tipos.<br>• <strong>Radar de Precios</strong>: Rediseño visual del tablero con métricas de variaciones porcentuales y badges de alerta.',
        descEn: '• <strong>Security & Audit</strong>: Fixed 17 backend issues, sanitized inputs, and validated types.<br>• <strong>Price Radar</strong>: Redesigned dashboard with percentage variance metrics.'
    },
    {
        date: '20-Ago-2026',
        time: '6:15 AM - 11:45 PM',
        hours: 6.98,
        badges: ['Basecamp UX', 'MilesIQ', 'Radar de Precios'],
        descEs: '• <strong>Basecamp (Selector View as Cards / List)</strong>: Visualización de to-dos en cuadrícula moderna o lista compacta con avatares y conteo de comentarios.<br>• <strong>MilesIQ (Detector de Rutas Faltantes)</strong>: Banner inteligente "Gap Detector" que resalta viajes intermedios omitidos.<br>• <strong>Radar de Precios</strong>: Auditoría exhaustiva 35/35 de todas las recetas maestras de la cadena.',
        descEn: '• <strong>Basecamp (Cards / List View Switcher)</strong>: Modern grid/list task views with avatars and comment counts.<br>• <strong>MilesIQ (Gap Detector)</strong>: Smart banner detecting missed intermediate trips.<br>• <strong>Price Radar</strong>: 35/35 exhaustive audit on all master recipes.'
    },
    {
        date: '21-Ago-2026',
        time: '6:09 AM - 9:28 PM',
        hours: 4.36,
        badges: ['Basecamp 4', 'Descansos IA', 'Alertas'],
        descEs: '• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Modal flotante con fondo desenfocado para abrir tareas de forma independiente.<br>• <strong>Descansos IA (Motor de Aprendizaje)</strong>: Optimización de sugerencias de descansos respetando la regla del Manager Jesús (salida temprana primero).<br>• <strong>Alertas Directivas</strong>: Despacho automático de notificaciones a directivos.',
        descEn: '• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Floating modal with blurred backdrop for task viewing.<br>• <strong>Breaks AI (Smart Engine)</strong>: Optimized break suggestions honoring early departure rules.<br>• <strong>Executive Alerts</strong>: Automated notification dispatch to managers.'
    },
        {
        date: '22-Ago-2026',
        time: '10:00 AM - 12:50 AM',
        hours: 10.50,
        badges: ['Ventas Toast API', 'Descansos IA', 'Uniformes', 'MilesIQ IRS', 'Módulo Admin HTML', 'Gantt Unificado'],
        descEs: '• <strong>Ventas (Toast API & Conciliación Bell $8,332.64)</strong>: Diagnóstico y resolución de discrepancia de ventas en Bell. Identificación de reembolsos de fechas cruzadas (Cross-Date Refunds de Party Trays) y soporte EBT para cuadre al centavo.<br>• <strong>Descansos Laborales (Alertas & Tooltips)</strong>: Corrección del solapamiento visual de popups en los logs de descansos y auditoría de violaciones de comida (California Labor Law).<br>• <strong>Uniformes & Caja Fuerte</strong>: Auditoría y blindaje de la tabla de stock mínimo (660 registros en BD para las 15 tiendas) y conciliación del flujo de ventas en efectivo con la Caja Fuerte.<br>• <strong>MilesIQ Supervisores (Smart Auto-Capture & GPS)</strong>: Implementación de geofencing perimetral en las 15 tiendas oficiales, cálculo fiscal IRS ($0.760/milla) y captura rápida a 1 toque.<br>• <strong>Módulo Admin de Reportes HTML (/admin/reporte-actividades)</strong>: Creación del visor interactivo exclusivo para Administradores con pestañas dinámicas para alternar entre Junio, Julio y Agosto sin requerir PDFs estáticos.<br>• <strong>Unificación de Líneas de Tiempo Gantt</strong>: Recreación y sincronización de las pistas cronológicas (4:00 AM - 12:00 AM) para los 3 reportes mensuales con doble carril (Tienda Lynwood y Dev TEG).',
        descEn: '• <strong>Sales (Toast API & Bell Reconciliation $8,332.64)</strong>: Solved Bell sales discrepancy by handling cross-date party tray refunds and EBT items.<br>• <strong>Labor Breaks (Alerts & Tooltips)</strong>: Fixed visual tooltip overlap on lunch/break logs and automated CA meal break violation auditing.<br>• <strong>Uniforms & Safe Box</strong>: Audited and locked 660 minimum stock DB records across all 15 stores with cash sale reconciliation.<br>• <strong>MilesIQ (Smart Auto-Capture & GPS)</strong>: Store geofencing for canonical 15 locations, IRS mileage rate deduction ($0.760/mi), and 1-tap quick logging.<br>• <strong>Admin HTML Reports Viewer (/admin/reporte-actividades)</strong>: Built interactive Admin-exclusive viewer with month switching tabs, eliminating static PDFs.<br>• <strong>Unified Gantt Timelines</strong>: Recreated and synced 4 AM - 12 AM dual-track schedules across all 3 monthly reports.'
    }
];

const augustBackupHtml = fs.readFileSync('backups/pendientes_agosto_canonical_backup.html', 'utf-8');
let augustTasksHtmlMatch = augustBackupHtml.match(/<div class="tasks-grid">([\s\S]*?)<\/div>/i);
const augustTasksHtml = augustTasksHtmlMatch ? augustTasksHtmlMatch[1].trim() : '';

// LOAD MASTER BUILDER
eval(fs.readFileSync('scripts/report-generator-core.js', 'utf-8'));

// COMPILE JUNE
const juneConfig = {
    monthName: 'Junio',
    monthYear: 'Junio 2026',
    monthNum: 6,
    totalTasks: 17,
    completedTasks: 13,
    inProgressTasks: 3,
    pendingTasks: 1,
    totalHours: 190.5,
    rows: juneRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 30.0, desc: 'Pruebas en vivo en tienda Lynwood y terminales POS Toast, validación de telemetría de Drive-Thru y KDS en cocina.' },
        { title: 'Monitoreo DB y APIs', hours: 12.0, desc: 'Optimización de consultas SQL en Supabase, reintentos en APIs de Basecamp y Toast, y depuración de logs en tiempo real.' },
        { title: 'Planificación y Diseño', hours: 5.0, desc: 'Diseño de interfaces de usuario para el módulo de Procedimientos, flujos de trabajo de Basecamp y esquemas de datos.' }
    ],
    effortSummary: [
        { module: 'Clon y Sincronizador de Basecamp', hours: 68.0 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 34.0 },
        { module: 'Planificador de Turnos y Horarios', hours: 22.5 },
        { module: 'Inventario, Costos y Recetas', hours: 19.0 },
        { module: 'Mantenimiento General, Seguridad y Chat AI', hours: 47.0 }
    ],
    taskCardsHtml: juneTasksHtml
};

// COMPILE JULY
const julyConfig = {
    monthName: 'Julio',
    monthYear: 'Julio 2026',
    monthNum: 7,
    totalTasks: 20,
    completedTasks: 14,
    inProgressTasks: 4,
    pendingTasks: 2,
    totalHours: 117.8,
    rows: julyRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 9.0, desc: 'Pruebas de pedidos con QuickBooks en sucursales, auditoría de hojas de trabajo impresas de inventario y validación de kioskos.' },
        { title: 'Monitoreo DB y APIs', hours: 6.0, desc: 'Supervisión de sincronización de catálogos con QuickBooks, webhook de clima NWS y logs de errores de autenticación Gmail.' },
        { title: 'Planificación y Diseño', hours: 3.6, desc: 'Diseño de la interfaz simplificada de 2 pestañas de Pedidos Bodega, modales interactivos de ayuda y hojas de trabajo.' }
    ],
    effortSummary: [
        { module: 'Inventario, Pedidos y Sincronización QuickBooks', hours: 78.0 },
        { module: 'Actividades, Planificador y Horarios', hours: 18.5 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 8.5 },
        { module: 'Mantenimiento General y Soporte Técnico', hours: 12.8 }
    ],
    taskCardsHtml: julyTasksHtml
};

// COMPILE AUGUST
const augustConfig = {
    monthName: 'Agosto',
    monthYear: 'Agosto 2026',
    monthNum: 8,
    totalTasks: 26,
    completedTasks: 18,
    inProgressTasks: 6,
    pendingTasks: 2,
    totalHours: 98.76,
    rows: augustRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 3.0, desc: 'Testing en cocina del modo tableta kiosko del Preparador, validación de sincronización PC-Tableta y geofencing de MilesIQ en las 15 tiendas.' },
        { title: 'Monitoreo DB y APIs', hours: 2.5, desc: 'Auditoría de API v3 Viele & Sons (Radar de Precios), endpoints de conciliación de Ventas Toast y cálculo IRS de millas.' },
        { title: 'Planificación y Diseño', hours: 1.5, desc: 'Arquitectura de Tech Packs para uniformes, diseño del acelerador intradía de carne y estructura de las 26 tareas oficiales.' }
    ],
    effortSummary: [
        { module: 'Preparador de Carne y Cocina KDS', hours: 24.5 },
        { module: 'Ventas Toast API & Conciliación Multitienda', hours: 18.5 },
        { module: 'MilesIQ Supervisores & Geofencing GPS', hours: 16.0 },
        { module: 'Descansos Laborales (Labor Compliance AI)', hours: 12.5 },
        { module: 'Control de Uniformes & Caja Fuerte', hours: 11.5 },
        { module: 'Radar de Precios Viele v3 & Auditoría COGS', hours: 8.0 },
        { module: 'Mantenimiento General, Crons y Reportes', hours: 6.76 }
    ],
    taskCardsHtml: augustTasksHtml
};

const juneHtml = buildReportHtml(juneConfig);
const julyHtml = buildReportHtml(julyConfig);
const augustHtml = buildReportHtml(augustConfig);

fs.writeFileSync('pendientes.html', juneHtml, 'utf-8');
fs.writeFileSync('pendientes_julio.html', julyHtml, 'utf-8');
fs.writeFileSync('pendientes_agosto.html', augustHtml, 'utf-8');

console.log('✅ pendientes.html (Junio 2026) creado exitosamente!');
console.log('✅ pendientes_julio.html (Julio 2026) creado exitosamente!');
console.log('✅ pendientes_agosto.html (Agosto 2026) creado exitosamente!');
