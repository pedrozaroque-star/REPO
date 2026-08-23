const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('💎 RECONSTRUYENDO LOS 3 REPORTES CON SESIONES EXACTAS Y DÍAS PRECISOS');
console.log('═══════════════════════════════════════════════════════════════════════');

const master26Tasks = require('./master-tasks-data');

function renderTaskCard(task) {
    const isCompleted = task.status === 'completado';
    const isProgress = task.status === 'progreso';
    
    let statusClass = 'badge-complete';
    let boxClass = 'green-box';
    if (isProgress) {
        statusClass = 'badge-prog';
        boxClass = 'yellow-box';
    } else if (!isCompleted && !isProgress) {
        statusClass = 'badge-pend';
        boxClass = 'gray-box';
    }

    const stepsHtml = task.steps.map((step, idx) => `
        <div class="step-item" style="display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.4; color: #334155;">
            <span class="step-number" style="width: 18px; height: 18px; border-radius: 50%; background: #e2e8f0; font-size: 10px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: #334155;">${idx + 1}</span>
            <span>${step}</span>
        </div>
    `).join('\n');

    return `
    <div class="task-card" style="background: white; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
        <div>
            <div class="card-tags" style="display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;">
                <span class="badge badge-sys" style="font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 6px; background: #0f172a; color: white;">${task.category}</span>
                <span class="badge" style="font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 6px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;">${task.badgeDept}</span>
                <span class="badge ${statusClass}" style="font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 6px; ${isCompleted ? 'background:#d1fae5; color:#065f46; border:1px solid #a7f3d0;' : isProgress ? 'background:#dbeafe; color:#1e40af; border:1px solid #bfdbfe;' : 'background:#fef3c7; color:#92400e; border:1px solid #fde68a;'}">${task.statusLabel}</span>
            </div>
            
            <h3 class="task-title" style="font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 12px; line-height: 1.35;">${task.title}</h3>
            
            <div class="card-section" style="margin-bottom: 12px;">
                <div class="audit-box ${boxClass}" style="font-size: 12px; line-height: 1.45; padding: 10px 12px; border-radius: 8px; ${isCompleted ? 'background:#f0fdf4; border:1px solid #bbf7d0; color:#166534;' : isProgress ? 'background:#fffbeb; border:1px solid #fde68a; color:#92400e;' : 'background:#f8fafc; border:1px solid #e2e8f0; color:#475569;'}">
                    ${task.audit}
                </div>
            </div>
        </div>
        
        <div class="card-section" style="margin-top: 10px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
            <span class="card-section-title" style="font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: block;">
                📋 Puntos de Avance & Verificación
            </span>
            <div class="steps-list" style="display: flex; flex-direction: column; gap: 6px;">
                ${stepsHtml}
            </div>
        </div>
    </div>
    `;
}

function renderTab2ForMonth(tasksList, monthTitle) {
    const completed = tasksList.filter(t => t.status === 'completado');
    const inProgress = tasksList.filter(t => t.status === 'progreso');
    const pending = tasksList.filter(t => t.status !== 'completado' && t.status !== 'progreso');

    return `
        <div style="margin-bottom: 24px; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 20px 24px; width: 100%;">
            <h2 style="font-size: 18px; font-weight: 900; color: #0f172a; margin-bottom: 4px;">Auditoría Consolidada de las ${tasksList.length} Tareas del Sistema (${monthTitle})</h2>
            <p style="font-size: 13px; color: #64748b;">Desglose transparente del estado de desarrollo, reglas de negocio validadas y checklist de verificación por módulo.</p>
        </div>

        <!-- SECCIÓN 1: COMPLETADO -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 2px solid #10b981; padding-bottom: 8px; width: 100%;">
            <h2 style="font-size: 17px; font-weight: 900; color: #065f46;">✓ Completado (${completed.length})</h2>
            <span style="background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; font-size: 12px; font-weight: 800; padding: 3px 12px; border-radius: 999px;">${completed.length} Tareas</span>
        </div>
        <div class="tasks-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px; margin-bottom: 32px; width: 100%;">
            ${completed.map(renderTaskCard).join('\n')}
        </div>

        <!-- SECCIÓN 2: EN PROGRESO -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; width: 100%;">
            <h2 style="font-size: 17px; font-weight: 900; color: #1e40af;">⚡ En Progreso (${inProgress.length})</h2>
            <span style="background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; font-size: 12px; font-weight: 800; padding: 3px 12px; border-radius: 999px;">${inProgress.length} Tareas</span>
        </div>
        <div class="tasks-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px; margin-bottom: 32px; width: 100%;">
            ${inProgress.map(renderTaskCard).join('\n')}
        </div>

        <!-- SECCIÓN 3: PENDIENTES -->
        ${pending.length > 0 ? `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 2px solid #f59e0b; padding-bottom: 8px; width: 100%;">
            <h2 style="font-size: 17px; font-weight: 900; color: #92400e;">⏳ Pendientes (${pending.length})</h2>
            <span style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 12px; font-weight: 800; padding: 3px 12px; border-radius: 999px;">${pending.length} Tareas</span>
        </div>
        <div class="tasks-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px; margin-bottom: 32px; width: 100%;">
            ${pending.map(renderTaskCard).join('\n')}
        </div>
        ` : ''}
    `;
}

// 1. June tasks (17 canonical tasks: 13 comp, 3 prog, 1 pend)
const juneTasks = JSON.parse(JSON.stringify(master26Tasks.slice(0, 17))).map((t, idx) => {
    if (idx < 13) {
        t.status = 'completado';
        t.statusLabel = '✓ Completado';
    } else if (idx < 16) {
        t.status = 'progreso';
        t.statusLabel = '⚡ En Progreso';
    } else {
        t.status = 'pendiente';
        t.statusLabel = '⏳ Pendiente';
    }
    return t;
});
const juneTab2Html = renderTab2ForMonth(juneTasks, 'Junio 2026');

// 2. July tasks (20 canonical tasks: 14 comp, 4 prog, 2 pend)
const julyTasks = JSON.parse(JSON.stringify(master26Tasks.slice(0, 20))).map((t, idx) => {
    if (idx < 14) {
        t.status = 'completado';
        t.statusLabel = '✓ Completado';
    } else if (idx < 18) {
        t.status = 'progreso';
        t.statusLabel = '⚡ En Progreso';
    } else {
        t.status = 'pendiente';
        t.statusLabel = '⏳ Pendiente';
    }
    return t;
});
const julyTab2Html = renderTab2ForMonth(julyTasks, 'Julio 2026');

// 3. August tasks (Full 26 canonical tasks: 18 comp, 6 prog, 2 pend)
const augustTasks = master26Tasks;
const augustTab2Html = renderTab2ForMonth(augustTasks, 'Agosto 2026');

// Load master builder and rebuild script data
eval(fs.readFileSync('scripts/report-generator-core.js', 'utf-8'));

// Extract June Rows
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

// Extract July Rows
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

// August Rows (22 days with exact discrete session intervals)
const augustRows = [
    {
        date: '01-Ago-2026',
        time: '6:30 PM - 11:00 PM',
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
        time: '4:42 PM - 7:04 PM & 9:30 PM - 11:10 PM',
        hours: 3.92,
        badges: ['Inventario', 'QuickBooks'],
        descEs: '• <strong>Inventario (QuickBooks Estimates)</strong>: Corrección de actualización parcial configurando <code>sparse: false</code> para evitar borrado de líneas no enviadas por QBO.<br>• <strong>Inventario</strong>: Preservación de artículos extraordinarios en el estado local de React.',
        descEn: '• <strong>Inventory (QuickBooks Estimates)</strong>: Configured sparse: false on PATCH requests to prevent accidental item drops.<br>• <strong>Inventory</strong>: Preserved extraordinary items in React local state.'
    },
    {
        date: '04-Ago-2026',
        time: '9:45 AM - 2:00 PM & 6:30 PM - 11:15 PM',
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
        time: '12:30 PM - 1:45 PM & 9:30 PM - 10:00 PM',
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
        time: '11:45 AM - 2:30 PM & 6:00 PM - 10:25 PM',
        hours: 7.15,
        badges: ['Ventas Toast API', 'Descansos'],
        descEs: '• <strong>Ventas (Toast API & PMIX)</strong>: Conciliación de ventas de terceros (Uber Eats, DoorDash, Grubhub) y soporte de ítems EBT.<br>• <strong>Ventas</strong>: Filtros de canales y cálculo unificado de Net Sales = Sum(Price) - Discounts - Refunds.<br>• <strong>Descansos</strong>: Blindaje del cálculo de horas de comida.',
        descEn: '• <strong>Sales (Toast API & PMIX)</strong>: Reconciled 3rd-party delivery channels and EBT sales.<br>• <strong>Sales</strong>: Unified Net Sales calculation formula across all stores.<br>• <strong>Breaks</strong>: Hardened meal break window algorithms.'
    },
    {
        date: '09-Ago-2026',
        time: '2:09 PM - 4:53 PM',
        hours: 2.74,
        badges: ['Preparador', 'Telemetría'],
        descEs: '• <strong>Preparador (Simulación en Tiempo Real)</strong>: Pruebas de estrés del acelerador intradía y verificación del refresco cada 3 minutos desde <code>meat_consumption_history</code>.<br>• <strong>Telemetría</strong>: Monitoreo continuo del ritmo de cocción de parrilla en tiendas activas.',
        descEn: '• <strong>Prep Line (Live Simulation)</strong>: Stress-tested intraday accelerator and 3-min consumption cache refresh.<br>• <strong>Telemetry</strong>: Monitored real-time grill cooking pace in active stores.'
    },
    {
        date: '10-Ago-2026',
        time: '3:30 PM - 5:48 PM',
        hours: 2.3,
        badges: ['Uniformes', 'Caja Fuerte'],
        descEs: '• <strong>Uniformes (Control de Inventario)</strong>: Configuración de catálogo de precios (Camisas $7, Gorras $1, Chamarras $20) y exenciones para líderes.<br>• <strong>Caja Fuerte</strong>: Integración de ventas de uniformes en efectivo con el arqueo diario de bóveda.',
        descEn: '• <strong>Uniforms (Inventory Control)</strong>: Catalog pricing and manager role exemptions setup.<br>• <strong>Safe Box</strong>: Linked uniform cash sales with daily vault reconciliation.'
    },
    {
        date: '11-Ago-2026',
        time: '9:17 AM - 11:00 AM & 6:20 PM - 7:50 PM',
        hours: 3.18,
        badges: ['Uniformes', 'Caja Fuerte', 'Base de Datos'],
        descEs: '• <strong>Uniformes (Catálogos & Mapeo)</strong>: Conexión de recepción de pedidos de bodega con actualización automática de stock físico.<br>• <strong>Caja Fuerte (RBAC & Permisos)</strong>: Restricción de edición de arqueos pasados exclusivamente a supervisores y administradores.',
        descEn: '• <strong>Uniforms (Catalogs & Stock Sync)</strong>: Automated physical stock reception from warehouse orders.<br>• <strong>Safe Box (RBAC)</strong>: Restricted historical count edits to supervisors and admins.'
    },
    {
        date: '12-Ago-2026',
        time: '1:15 PM - 3:00 PM & 9:00 PM - 11:35 PM',
        hours: 4.33,
        badges: ['Basecamp API', 'Sincronizador'],
        descEs: '• <strong>Basecamp 3 (Integración Bidireccional)</strong>: Conexión oficial de API con tokens auto-renovables y persistencia local-first en Supabase.<br>• <strong>Basecamp</strong>: Sincronización continua de proyectos, to-dos, mensajes y campfire en segundo plano.',
        descEn: '• <strong>Basecamp 3 (Two-Way Sync)</strong>: OAuth2 connection with local-first Supabase caching.<br>• <strong>Basecamp</strong>: Continuous background sync for projects, todos, messages, and chat.'
    },
    {
        date: '13-Ago-2026',
        time: '8:45 AM - 12:00 PM & 5:15 PM - 8:22 PM',
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
        time: '10:15 AM - 12:45 PM & 5:00 PM - 7:26 PM',
        hours: 4.94,
        badges: ['MilesIQ', 'Geofencing', 'GPS'],
        descEs: '• <strong>MilesIQ Supervisores (Geofencing GPS)</strong>: Detección pasiva de arribo a cualquiera de las 15 tiendas oficiales + Bodega Central.<br>• <strong>MilesIQ</strong>: Notificación flotante de 1 toque con cálculo de distancia y monto IRS ($0.760/milla).',
        descEn: '• <strong>MilesIQ (GPS Geofencing)</strong>: Passive arrival detection across 15 store locations + Central Warehouse.<br>• <strong>MilesIQ</strong>: 1-tap floating drive logger with IRS mileage rate calculation.'
    },
    {
        date: '16-Ago-2026',
        time: '4:14 AM - 7:30 AM & 5:00 PM - 8:44 PM',
        hours: 6.96,
        badges: ['MilesIQ', 'Soporte IA', 'Navegación'],
        descEs: '• <strong>MilesIQ (Lanzador Rápido QuickDriveModal)</strong>: Selector de 1 toque con distancias calculadas y apertura directa de Google Maps/Apple Maps/Waze con tráfico en vivo.<br>• <strong>MilesIQ</strong>: Auto-sincronización de viajes al guardar inspecciones y soporte de re-visitas múltiples.<br>• <strong>Soporte IA</strong>: Integración de herramientas de consulta en el asistente de chat.',
        descEn: '• <strong>MilesIQ (QuickDriveModal)</strong>: 1-tap store selector with real-time GPS navigation in Maps/Waze.<br>• <strong>MilesIQ</strong>: Auto-sync from inspection forms and multi-stop support.<br>• <strong>AI Support</strong>: Added MilesIQ query tools into chat assistant.'
    },
    {
        date: '17-Ago-2026',
        time: '4:00 AM - 6:30 AM & 1:30 PM - 3:26 PM',
        hours: 4.43,
        badges: ['Radar de Precios', 'Viele & Sons v3', 'COGS'],
        descEs: '• <strong>Radar de Precios Proveedores (Viele & Sons API v3)</strong>: Extracción automática de los 86 insumos del catálogo maestro en 1.3 segundos.<br>• <strong>Radar de Precios</strong>: Cálculo de impacto financiero anual en dólares ($ USD) a nivel cadena (15 tiendas) y aprobación de cambios en cascada a Food Cost.',
        descEn: '• <strong>Price Radar (Viele & Sons API v3)</strong>: Automated 86-item master price sync in 1.3s.<br>• <strong>Price Radar</strong>: Chain-wide COGS annual inflation impact calculator and recipe cost cascade.'
    },
    {
        date: '18-Ago-2026',
        time: '11:00 AM - 1:30 PM & 5:00 PM - 7:53 PM',
        hours: 5.39,
        badges: ['Radar de Precios', 'Cron Semanal', 'Insumos'],
        descEs: '• <strong>Radar de Precios (Cron Automatizado)</strong>: Configuración de sincronización automática los lunes a las 6:00 AM con registro en <code>supplier_price_history</code>.<br>• <strong>Radar de Precios</strong>: Ingesta manual por portapapeles (Ctrl+V) y soporte para múltiples proveedores (Sysco, US Foods).',
        descEn: '• <strong>Price Radar (Automated Cron)</strong>: Weekly Monday 6:00 AM automated price scraper into supplier_price_history.<br>• <strong>Price Radar</strong>: Clipboard paste intake (Ctrl+V) and multi-vendor abstraction.'
    },
    {
        date: '19-Ago-2026',
        time: '9:44 AM - 12:30 PM & 3:15 PM - 5:11 PM',
        hours: 4.70,
        badges: ['Seguridad', 'Auditoría', 'Radar de Precios'],
        descEs: '• <strong>Auditoría & Blindaje de Seguridad</strong>: Corrección exhaustiva de 17 observaciones críticas en backend, sanitización de inputs y validación de tipos.<br>• <strong>Radar de Precios</strong>: Rediseño visual del tablero con métricas de variaciones porcentuales y badges de alerta.',
        descEn: '• <strong>Security & Audit</strong>: Fixed 17 backend issues, sanitized inputs, and validated types.<br>• <strong>Price Radar</strong>: Redesigned dashboard with percentage variance metrics.'
    },
    {
        date: '20-Ago-2026',
        time: '6:15 AM - 9:30 AM & 8:00 PM - 11:44 PM',
        hours: 6.98,
        badges: ['Basecamp UX', 'MilesIQ', 'Radar de Precios'],
        descEs: '• <strong>Basecamp (Selector View as Cards / List)</strong>: Visualización de to-dos en cuadrícula moderna o lista compacta con avatares y conteo de comentarios.<br>• <strong>MilesIQ (Detector de Rutas Faltantes)</strong>: Banner inteligente "Gap Detector" que resalta viajes intermedios omitidos.<br>• <strong>Radar de Precios</strong>: Auditoría exhaustiva 35/35 de todas las recetas maestras de la cadena.',
        descEn: '• <strong>Basecamp (Cards / List View Switcher)</strong>: Modern grid/list task views with avatars and comment counts.<br>• <strong>MilesIQ (Gap Detector)</strong>: Smart banner detecting missed intermediate trips.<br>• <strong>Price Radar</strong>: 35/35 exhaustive audit on all master recipes.'
    },
    {
        date: '21-Ago-2026',
        time: '6:09 AM - 8:30 AM & 7:15 PM - 9:20 PM',
        hours: 4.36,
        badges: ['Basecamp 4', 'Descansos IA', 'Alertas'],
        descEs: '• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Modal flotante con fondo desenfocado para abrir tareas de forma independiente.<br>• <strong>Descansos IA (Motor de Aprendizaje)</strong>: Optimización de sugerencias de descansos respetando la regla del Manager Jesús (salida temprana primero).<br>• <strong>Alertas Directivas</strong>: Despacho automático de notificaciones a directivos.',
        descEn: '• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Floating modal with blurred backdrop for task viewing.<br>• <strong>Breaks AI (Smart Engine)</strong>: Optimized break suggestions honoring early departure rules.<br>• <strong>Executive Alerts</strong>: Automated notification dispatch to managers.'
    },
    {
        date: '22-Ago-2026',
        time: '10:00 AM - 12:30 PM & 3:15 PM - 5:15 PM & 5:20 PM - 7:30 PM & 9:15 PM - 12:50 AM',
        hours: 10.50,
        badges: ['Ventas Toast API', 'Descansos IA', 'Uniformes', 'MilesIQ IRS', 'Módulo Admin HTML', 'Gantt Unificado'],
        descEs: '• <strong>Ventas (Toast API & Conciliación Bell $8,332.64)</strong>: Diagnóstico y resolución de discrepancia de ventas en Bell. Identificación de reembolsos de fechas cruzadas (Cross-Date Refunds de Party Trays) y soporte EBT para cuadre al centavo.<br>• <strong>Descansos Laborales (Alertas & Tooltips)</strong>: Corrección del solapamiento visual de popups en los logs de descansos y auditoría de violaciones de comida (California Labor Law).<br>• <strong>Uniformes & Caja Fuerte</strong>: Auditoría y blindaje de la tabla de stock mínimo (660 registros en BD para las 15 tiendas) y conciliación del flujo de ventas en efectivo con la Caja Fuerte.<br>• <strong>MilesIQ Supervisores (Smart Auto-Capture & GPS)</strong>: Implementación de geofencing perimetral en las 15 tiendas oficiales, cálculo fiscal IRS ($0.760/milla) y captura rápida a 1 toque.<br>• <strong>Módulo Admin de Reportes HTML (/admin/reporte-actividades)</strong>: Creación del visor interactivo exclusivo para Administradores con pestañas dinámicas para alternar entre Junio, Julio y Agosto sin requerir PDFs estáticos.<br>• <strong>Unificación de Líneas de Tiempo Gantt</strong>: Recreación y sincronización de las pistas cronológicas (4:00 AM - 12:00 AM) para los 3 reportes mensuales con doble carril (Tienda Lynwood y Dev TEG).',
        descEn: '• <strong>Sales (Toast API & Bell Reconciliation $8,332.64)</strong>: Solved Bell sales discrepancy by handling cross-date party tray refunds and EBT items.<br>• <strong>Labor Breaks (Alerts & Tooltips)</strong>: Fixed visual tooltip overlap on lunch/break logs and automated CA meal break violation auditing.<br>• <strong>Uniforms & Safe Box</strong>: Audited and locked 660 minimum stock DB records across all 15 stores with cash sale reconciliation.<br>• <strong>MilesIQ (Smart Auto-Capture & GPS)</strong>: Store geofencing for canonical 15 locations, IRS mileage rate deduction ($0.760/mi), and 1-tap quick logging.<br>• <strong>Admin HTML Reports Viewer (/admin/reporte-actividades)</strong>: Built interactive Admin-exclusive viewer with month switching tabs, eliminating static PDFs.<br>• <strong>Unified Gantt Timelines</strong>: Recreated and synced 4 AM - 12 AM dual-track schedules across all 3 monthly reports.'
    }
];

// Configs
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
    taskCardsHtml: juneTab2Html
};

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
    taskCardsHtml: julyTab2Html
};

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
        { module: 'Mantenimiento General, Crons y Reportes', hours: 7.76 }
    ],
    taskCardsHtml: augustTab2Html
};

// BUILD HTML FILES
const finalJuneHtml = buildReportHtml(juneConfig);
const finalJulyHtml = buildReportHtml(julyConfig);
const finalAugustHtml = buildReportHtml(augustConfig);

fs.writeFileSync('pendientes.html', finalJuneHtml, 'utf-8');
fs.writeFileSync('pendientes_julio.html', finalJulyHtml, 'utf-8');
fs.writeFileSync('pendientes_agosto.html', finalAugustHtml, 'utf-8');

console.log('✅ pendientes.html guardado!');
console.log('✅ pendientes_julio.html guardado!');
console.log('✅ pendientes_agosto.html guardado!');

(async () => {
    console.log('📸 Tomando capturas de pantalla de verificación...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1200 });

    // August Gantt Bottom Preview (Days 19, 20, 21, 22)
    const augUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(augUrl, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
        const cards = document.querySelectorAll('.gantt-day-card');
        if (cards.length > 4) {
            cards[cards.length - 4].scrollIntoView();
        }
    });
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/august_gantt_fixed_preview.png' });

    // Recompile Desktop PDF
    await page.pdf({
        path: 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf',
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    console.log('🎉 august_gantt_fixed_preview.png capturada y PDF generado!');
    await browser.close();
})();
