const fs = require('fs');

const data = JSON.parse(fs.readFileSync('scripts/september_full_data.json', 'utf-8'));

// 1. Update 21-Sep-2026
const row21 = data.rows.find(r => r.date === '21-Sep-2026');
if (row21) {
    row21.time = "1:00 PM - 2:45 PM & 2:45 PM - 4:23 PM & 4:30 PM - 7:51 PM & 11:15 PM - 12:00 AM";
    row21.hours = 7.4;
    const newBadges21 = [
        "Paridad Tax 0% Viele",
        "Sage 100 Validación Cruzada",
        "Paridad Pre/Post Checkout",
        "Sincronización Order Guides",
        "Blindaje Seguridad RBAC Viele",
        "Configuración Vercel Accounts",
        "Turno Lynwood 12PM-8PM"
    ];
    row21.badges = Array.from(new Set([...row21.badges, ...newBadges21]));
    row21.descEs = row21.descEs + "<br>• <strong>Viele & Sons: Paridad Pre/Post Checkout & Sincronización Order Guides</strong>: En sesión vespertina (commit 1596cc5), corrección para que el cálculo de impuestos al 0% en el carrito previo y el recibo posterior coincidan al centavo. Adición de enlace directo a reposición de Lynwood, manejo de fecha defensiva en historial de compras y sincronización automática de catálogos y guías de pedido oficiales de Viele por tienda.<br>• <strong>Viele & Sons: Blindaje Integral de Seguridad & RBAC</strong>: En sesión nocturna (commit 47da978), remediación exhaustiva de hallazgos de auditoría con control de acceso granular por roles (RBAC: Gerente solo su tienda, Supervisor su zona, Admin global), validación perimetral y blindaje del checkout contra manipulaciones de payload.<br>• <strong>Configuración de Entorno Vercel & Turno Lynwood #14</strong>: Preparación y verificación de variables seguras en Vercel (VIELE_STORE_ACCOUNTS_JSON). Turno de Gerente General en Lynwood #14 (12:00 PM - 8:00 PM, 8.0h) registrado en el Planificador de Supabase.";
    row21.descEn = row21.descEn + "<br>• <strong>Viele & Sons: Pre/Post Checkout Parity & Order Guides Sync</strong>: In afternoon session (commit 1596cc5), achieved exact 0% tax parity between pre-checkout cart and post-checkout confirmation. Added direct Lynwood restocking link, defensive dates in purchase history, and store-specific Viele order guides synchronization.<br>• <strong>Viele & Sons: Comprehensive Security Hardening & RBAC</strong>: In evening session (commit 47da978), resolved all security audit items with Role-Based Access Control (Manager restricted to store, Supervisor to territory, Admin global), perimeter input validation, and hardened checkout against payload tampering.<br>• <strong>Vercel Environment Setup & Lynwood #14 Shift</strong>: Prepared and verified production environment variables in Vercel (VIELE_STORE_ACCOUNTS_JSON). General Manager shift at Lynwood #14 (12:00 PM - 8:00 PM, 8.0h) logged in Supabase schedules.";
}

// 2. Add 22-Sep-2026
const row22 = {
    date: "22-Sep-2026",
    time: "12:00 AM - 1:40 AM & 12:22 PM - 1:35 PM & 6:18 PM - 8:42 PM",
    hours: 5.3,
    badges: [
        "Viele Certificación 16/16",
        "Preview Vercel 529deb4",
        "Google TimesFM 2.5 Piloto",
        "GAVILAN MIX EXE Resiliencia",
        "Búfer Offline 10+ Videos",
        "Auto-Recuperación Apagones",
        "Turno Lynwood 3PM-10PM"
    ],
    descEs: "• <strong>Viele & Sons: Despliegue de Preview & Certificación 16/16 en Producción (Chat 0881a7ea)</strong>: En sesión de madrugada (commit 529deb4), despliegue de preview para verificación del blindaje integral. Ejecución de la suite completa de 16 pruebas automatizadas contra tacosgavilan.vercel.app pasando con 100% de éxito en catálogo, guardado de PAR, carrito y despacho seguro de órdenes.<br>• <strong>Motor de Proyecciones: Evaluación de Google TimesFM 2.5 (Chat a3924ef4)</strong>: En sesión matutina, investigación forense del origen y dependencias de lib/intelligence.ts. Análisis de viabilidad técnica y arquitectura para incorporar Google TimesFM (Time Series Foundation Model) en un piloto aislado sin impacto en producción.<br>• <strong>GAVILAN MIX: Resiliencia del Reproductor EXE ante Fallas & Soporte Multidisco (Chat 564a7b20)</strong>: En sesión vespertina, optimización profunda del lanzador Windows (.exe) de Gavilan TV. Soporte dinámico para computadoras con poco espacio en C: mediante detección de unidades secundarias (disco E:). Mecanismo de copiado en segundo plano con búfer de reproducción inmediata al alcanzar 10 videos descargados. Blindaje contra cortes eléctricos y apagones en tienda, reiniciando automáticamente la lista offline sin pantallas negras ni bloqueos de interfaz.<br>• <strong>Turno Presencial Lynwood #14</strong>: Turno de Gerente General en Lynwood #14 (3:00 PM - 10:00 PM, 7.0h) registrado en el Planificador de Supabase.",
    descEn: "• <strong>Viele & Sons: Preview Deployment & 16/16 Production Test Certification (Chat 0881a7ea)</strong>: In early morning session (commit 529deb4), deployed preview build for full shielding verification. Executed complete 16-test automated suite against tacosgavilan.vercel.app with 100% pass rate across catalog syncing, PAR persistence, cart calculations, and checkout.<br>• <strong>Forecasting Engine: Google TimesFM 2.5 Evaluation (Chat a3924ef4)</strong>: In morning session, conducted forensic audit of lib/intelligence.ts architecture. Evaluated technical feasibility of Google TimesFM (Time Series Foundation Model) in an isolated pilot without impacting production.<br>• <strong>GAVILAN MIX: Standalone EXE Resilience & Multi-Drive Support (Chat 564a7b20)</strong>: In evening session, optimized standalone Windows (.exe) TV launcher. Added dynamic secondary drive fallback (drive E: vs C: for low-storage PCs). Engineered background copy pipeline with immediate playback buffering once 10 videos are downloaded. Hardened against store power cuts, automatically resuming offline playback without black screens.<br>• <strong>Lynwood #14 Manager Shift</strong>: In-store General Manager shift at Lynwood #14 (3:00 PM - 10:00 PM, 7.0h) logged in Supabase schedules."
};

// 3. Add 23-Sep-2026
const row23 = {
    date: "23-Sep-2026",
    time: "6:21 AM - 1:28 PM & 3:58 PM - 4:32 PM",
    hours: 7.7,
    badges: [
        "Pedidos Automáticos IA (Codex)",
        "Recetas y Empaques por Canal",
        "Migraciones Supabase (3)",
        "Snapshots Consumo Toast",
        "Automatización Sobrantes",
        "Grubhub Direct Injection Audit",
        "Turno Lynwood 9AM-5PM"
    ],
    descEs: "• <strong>Pedidos Automáticos por IA (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 7h 07m Confirmadas</strong>: En jornada de desarrollo matutina (6:21 AM - 1:28 PM; pausa de 1:28 PM a 3:35 PM expresamente excluida y sin contar descargas automáticas de tickets), diseño y arquitectura del motor de pedidos inteligentes y control de sobrantes. Creación de reglas de recetas y empaques por canal de venta (Dine-In, Takeout, Third-Party Delivery) para descontar con precisión exacta cajas, bolsas, charolas y contenedores. Generación de las primeras 3 migraciones en Supabase: 202609230001_recipe_automation_rules.sql, 202609230002_recipe_channel_packaging_rules.sql y 202609230003_toast_ticket_consumption_snapshots.sql. Pruebas de consumo de tickets reales y almacenamiento local comprimido para resguardar la cuota de base de datos en Supabase.<br>• <strong>Auditoría de Inyección Directa de Grubhub en Toast POS (Chat 43319138) — 34 min</strong>: En sesión vespertina (3:58 PM - 4:32 PM), análisis técnico de la notificación de Grubhub sobre su integración de inyección directa de órdenes en Toast POS. Auditoría del impacto en opciones de comedor (Dining Options), preservación de fórmulas de Ventas Netas (Net Sales) e insumos de empaque de delivery. Redacción de informe ejecutivo y correo formal de seguimiento.<br>• <strong>Turno Presencial Lynwood #14</strong>: Turno de Gerente General en Lynwood #14 (9:00 AM - 5:00 PM, 8.0h) registrado en el Planificador de Supabase.",
    descEn: "• <strong>AI Automated Ordering Engine (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 7h 07m Confirmed</strong>: In morning engineering session (6:21 AM - 1:28 PM; 1:28 PM - 3:35 PM pause explicitly excluded, background ticket downloads excluded), architected AI-driven automated purchasing and leftover control. Designed recipe and channel packaging deduction rules (Dine-In, Takeout, Third-Party Delivery) to deduct boxes, bags, trays, and takeout containers accurately. Authored first 3 Supabase migrations: 202609230001_recipe_automation_rules.sql, 202609230002_recipe_channel_packaging_rules.sql, and 202609230003_toast_ticket_consumption_snapshots.sql. Validated real Toast ticket consumption and engineered compressed local storage to safeguard Supabase database limits.<br>• <strong>Grubhub Direct POS Injection Technical Audit (Chat 43319138) — 34 min</strong>: In afternoon session (3:58 PM - 4:32 PM), audited Grubhub notification regarding direct order injection into Toast POS. Evaluated dining option mappings, Net Sales calculation preservation, and delivery packaging allocation. Drafted executive assessment and response guidance.<br>• <strong>Lynwood #14 Manager Shift</strong>: In-store General Manager shift at Lynwood #14 (9:00 AM - 5:00 PM, 8.0h) logged in Supabase schedules."
};

// 4. Add 24-Sep-2026
const row24 = {
    date: "24-Sep-2026",
    time: "1:12 PM - 1:46 PM & 7:10 PM - 7:25 PM",
    hours: 0.8,
    badges: [
        "Pedidos Automáticos IA (Codex)",
        "Canal Metadata Toast POS",
        "Compresión Local Archivo",
        "Protección DB Supabase",
        "Carta Apoyo Institucional",
        "Día Libre Lynwood"
    ],
    descEs: "• <strong>Pedidos Automáticos por IA (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 34 min Confirmados</strong>: En sesión dedicada (1:12 PM - 1:46 PM), desarrollo de la migración supabase/migrations/202609240001_toast_ticket_channel_metadata.sql para capturar metadatos granulares de canal de venta en tickets de Toast. Refinamiento de la lógica de compresión en archivos locales JSONL para resguardar almacenamiento histórico y proteger la base de datos de Supabase contra sobrecarga de escrituras.<br>• <strong>Carta de Apoyo y Respaldo Institucional (Chat 52ae7a77) — 15 min</strong>: En sesión vespertina (7:10 PM - 7:25 PM), redacción, maquetación ejecutiva en Word (.docx) y envío formal por correo de la carta oficial de recomendación y apoyo laboral para Lilia Judith Campos Martinez (Letter_of_Support_Lilia_Judith_Campos_Martinez.docx).<br>• <strong>Día Libre en Tienda Lynwood</strong>: Día de descanso operativo programado en Lynwood #14.",
    descEn: "• <strong>AI Automated Ordering Engine (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 34 min Confirmed</strong>: In dedicated session (1:12 PM - 1:46 PM), created migration supabase/migrations/202609240001_toast_ticket_channel_metadata.sql capturing granular sales channel metadata from Toast POS checks. Refined local JSONL file compression pipeline to archive historical tickets safely while shielding Supabase storage and IOPS quotas.<br>• <strong>Corporate Support Letter (Chat 52ae7a77) — 15 min</strong>: In evening session (7:10 PM - 7:25 PM), drafted, formatted in executive Word (.docx), and emailed official employment support letter for Lilia Judith Campos Martinez (Letter_of_Support_Lilia_Judith_Campos_Martinez.docx).<br>• <strong>Store Day Off Lynwood</strong>: Scheduled store day off at Lynwood #14."
};

// 5. Add 25-Sep-2026
const row25 = {
    date: "25-Sep-2026",
    time: "8:57 AM - 11:06 AM & 11:24 AM - 12:48 PM & 5:28 PM - 7:29 PM & 8:31 PM - 8:43 PM",
    hours: 5.7,
    badges: [
        "Auditoría Personal Lynwood #14",
        "Informe Ejecutivo Cobertura PDF",
        "Pedidos Automáticos IA (Codex)",
        "Carne Cruda vs Cocida",
        "Compuertas Validación Órdenes",
        "Simulación Tickets Reales Toast",
        "Turno Lynwood 2PM-10PM"
    ],
    descEs: "• <strong>Auditoría Laboral y Respaldo Operativo Lynwood #14 (Chat df8c49ce) — 2h 09m</strong>: En sesión matutina (8:57 AM - 11:06 AM), recopilación forense de evidencia laboral sobre la gestión de Carlos Velázquez como General Manager. Cruce de datos de reloj de Toast (punches), nómina de Simplify HR y planificador de Supabase, justificando horas extras y turnos extendidos por cobertura de 4 ausencias imprevistas (Kevin Garcia, Luis y Joseph cubriendo en sus días de descanso). Generación del informe ejecutivo formal en PDF en reports/ sin lenguaje punitivo de auditoría.<br>• <strong>Pedidos Automáticos por IA (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 3h 34m Confirmadas</strong>: En sesiones de desarrollo (11:24 AM - 12:48 PM, 5:28 PM - 7:29 PM y 8:31 PM - 8:43 PM; pausa de 7:29 PM a 8:31 PM excluida y sin contar descargas automáticas de tickets), creación de la migración supabase/migrations/202609250001_inventory_automation_pilot.sql. Implementación de los módulos lib/inventory/meat-allocation.ts (conversión exacta de carne cruda a cocida por selección en ticket) y lib/inventory/order-count-validation.ts (compuertas de validación de conteo para evitar duplicación de tickets). Ejecución de simulaciones con tickets reales de días anteriores de Toast POS verificando que el consumo teórico coincida con el inventario sin afectar la base operativa.<br>• <strong>Turno Presencial Lynwood #14</strong>: Turno de Gerente General en Lynwood #14 (2:00 PM - 10:00 PM, 8.0h) registrado en el Planificador de Supabase.",
    descEn: "• <strong>Labor Audit & Operational Defense Lynwood #14 (Chat df8c49ce) — 2h 09m</strong>: In morning session (8:57 AM - 11:06 AM), compiled forensic labor evidence supporting Carlos Velázquez's leadership as General Manager. Triangulated Toast clock punches, Simplify HR payroll, and Supabase schedules to justify overtime and extended shifts covering 4 unexpected employee absences (Kevin Garcia, Luis, and Joseph covering on scheduled days off). Compiled formal executive PDF in reports/ removing punitive audit labels.<br>• <strong>AI Automated Ordering Engine (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 3h 34m Confirmed</strong>: In dev sessions (11:24 AM - 12:48 PM, 5:28 PM - 7:29 PM, and 8:31 PM - 8:43 PM; 7:29 PM - 8:31 PM pause excluded, background ticket downloads excluded), authored migration supabase/migrations/202609250001_inventory_automation_pilot.sql. Built lib/inventory/meat-allocation.ts (raw-to-cooked meat conversion per check selection) and lib/inventory/order-count-validation.ts (order count gates preventing double ticket processing). Replayed real Toast checks to verify theoretical deductions against store ledgers without mutating live inventory.<br>• <strong>Lynwood #14 Manager Shift</strong>: In-store General Manager shift at Lynwood #14 (2:00 PM - 10:00 PM, 8.0h) logged in Supabase schedules."
};

// 6. Add 26-Sep-2026
const row26 = {
    date: "26-Sep-2026",
    time: "9:05 AM - 12:00 PM & 2:24 PM - 3:04 PM & 4:30 PM - 5:48 PM",
    hours: 4.9,
    badges: [
        "Pedidos Automáticos IA (Codex)",
        "Backtest Multitienda 15 Sucursales",
        "Party Trays Reingeniería",
        "Viele Manual Operativo PDF",
        "Sincronización Turnos Lynwood",
        "Consolidación Horas Multi-Chat",
        "Turno Lynwood 2PM-10PM"
    ],
    descEs: "• <strong>Pedidos Automáticos por IA (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 2h 55m Confirmadas</strong>: En sesión matutina (9:05 AM - 12:00 PM), ejecución del backtest integral multitienda sobre las 15 sucursales (scripts/backtest-inventory-pilot-all-stores.cjs) validando el motor de deducción de recetas y empaques contra miles de tickets reales. Reingeniería matemática de recetas virtuales de charolas de fiesta (Party Trays para 15 a 40 personas en lib/inventory/party-tray-guidelines.ts) y verificación de blindaje de Supabase mediante archivos comprimidos locales.<br>• <strong>Viele & Sons: Manual Operativo en PDF & PAR en Tiendas (Chat 0881a7ea) — 40 min</strong>: En sesión vespertina (2:24 PM - 3:04 PM), inspección profunda del módulo en producción. Generación del manual formal public/docs/Manual_Operativo_Viele_and_Sons_Tacos_Gavilan.pdf (estilo corporativo sin emojis, flujo de 3 pasos con énfasis en el Paso 1 obligatorio de revisar y guardar el PAR de tienda, y contacto de soporte técnico de Carlos Velázquez 424-319-5019).<br>• <strong>Sincronización de Turnos Lynwood & Conciliación Multi-Chat (Chat 72f704bf) — 1h 18m</strong>: Sincronización de los 245 turnos de Supabase en scripts/carlos_planner_shifts_by_date.json corrigiendo la etiqueta del 21 de septiembre a Turno Lynwood 12PM-8PM en la barra Gantt 24h. Conciliación forense y acumulativa de 14h 10m de la tarea Codex y todas las sesiones multi-chat del 21 al 26 de septiembre, actualización de scripts/september_full_data.json, recompilación de lib/reports-data.ts y reporte ejecutivo previo a commit.<br>• <strong>Turno Presencial Lynwood #14</strong>: Turno de Gerente General en Lynwood #14 (2:00 PM - 10:00 PM, 8.0h) registrado en el Planificador de Supabase.",
    descEn: "• <strong>AI Automated Ordering Engine (Codex ID 01a0cf29-cef7-7163-8b3c-df9f0685491c) — 2h 55m Confirmed</strong>: In morning session (9:05 AM - 12:00 PM), executed multi-store backtest across all 15 branches (scripts/backtest-inventory-pilot-all-stores.cjs) validating recipe and packaging deduction against thousands of historical Toast tickets. Re-engineered dynamic virtual recipes for Party Trays (15 to 40 persons in lib/inventory/party-tray-guidelines.ts) and verified Supabase quota shielding via local archives.<br>• <strong>Viele & Sons: Operational Manual PDF & Store PAR Verification (Chat 0881a7ea) — 40 min</strong>: In afternoon session (2:24 PM - 3:04 PM), conducted production health check. Generated formal manual public/docs/Manual_Operativo_Viele_and_Sons_Tacos_Gavilan.pdf (clean corporate zero-emoji design, 3-step workflow emphasizing mandatory Step 1 PAR review/saving, and Carlos Velázquez support contact 424-319-5019).<br>• <strong>Lynwood Shifts Synchronization & Multi-Chat Consolidation (Chat 72f704bf) — 1h 18m</strong>: Synchronized all 245 Supabase shifts in scripts/carlos_planner_shifts_by_date.json, correcting September 21 to Lynwood Shift 12PM-8PM on the 24h Gantt bar. Reconciled 14h 10m Codex task and all multi-chat development sessions from Sep 21 to Sep 26, updated scripts/september_full_data.json, recompiled lib/reports-data.ts, and prepared executive summary prior to commit.<br>• <strong>Lynwood #14 Manager Shift</strong>: In-store General Manager shift at Lynwood #14 (2:00 PM - 10:00 PM, 8.0h) logged in Supabase schedules."
};

// Filter out existing 22-26 rows if any (avoid duplicate)
data.rows = data.rows.filter(r => !['22-Sep-2026', '23-Sep-2026', '24-Sep-2026', '25-Sep-2026', '26-Sep-2026'].includes(r.date));
data.rows.push(row22, row23, row24, row25, row26);

// Update Effort Summary
data.effort = [
    {
        module: "Módulo de Compras Viele & Sons & Tech Packs",
        hours: 53.17
    },
    {
        module: "Control de Horarios y Cobertura (/horarios) & Auditoría RONOS",
        hours: 29.95
    },
    {
        module: "Ecosistema TV KDS, Gavilan Mix & Curación Musical",
        hours: 21.55
    },
    {
        module: "Módulo de Contabilidad (Reemplazo Cohesion) & QuickBooks",
        hours: 18.00
    },
    {
        module: "Automatización de Recetas, Consumo por Ticket & Pedidos IA (Piloto de Inventario)",
        hours: 14.17
    },
    {
        module: "Motor de Proyecciones de Ventas (Forecast V3.1), Event Intelligence & Descansos",
        hours: 10.70
    },
    {
        module: "Reporte de Actividades TSX, Gantt & Planificador Lynwood",
        hours: 8.70
    },
    {
        module: "Auditoría Técnica Restaurant365 (P&L, Commissary & AvT)",
        hours: 7.75
    },
    {
        module: "Infraestructura, Centinela Supabase/Vercel & Alertas Email",
        hours: 5.57
    },
    {
        module: "Soporte IA Conversacional, Changelog Modal & Versionado UI (v2.10.4)",
        hours: 3.25
    },
    {
        module: "Auditoría Forense de Tareas y Roadmap Canónico",
        hours: 1.50
    },
    {
        module: "Blindaje de Caché Food Cost Multitienda & Cron In-Process",
        hours: 1.25
    },
    {
        module: "Barra Lateral, Finanzas & Módulo Miles Raquel",
        hours: 1.25
    }
];

// Recompute total hours
// Sum of rows hours:
const totalCalc = data.rows.reduce((sum, r) => sum + r.hours, 0);
data.totalHours = parseFloat(totalCalc.toFixed(2));

fs.writeFileSync('scripts/september_full_data.json', JSON.stringify(data, null, 2), 'utf-8');
console.log('✅ scripts/september_full_data.json updated successfully!');
console.log('New total hours:', data.totalHours);
console.log('Rows count:', data.rows.length);
