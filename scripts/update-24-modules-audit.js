const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🚀 AUDITORÍA REAL Y ACTUALIZACIÓN DE LOS 24 MÓDULOS DE SM TEG');
console.log('═══════════════════════════════════════════════════════════════════════');

// Master list of all 24 modules with authentic, audited technical status
const masterModules = [
  {
    id: 1,
    number: '01',
    title: 'Preparador de Carne & KDS de Cocina en Tiempo Real',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Cocina & Operaciones',
    desc: 'Sistema inteligente de proyección de carne en parrilla (libras crudas) por bloques de 30 minutos y tramos de hora pico (Apertura, Almuerzo, Medio Día, Cena, Cierre). Incluye modo tableta kiosko seguro, sobreescritura manual semanal recurrente (prep_manual_schedule), acelerador intraday en tiempo real y modal de guía operativa.',
    files: 'app/inventory/preparador/page.tsx, lib/preparador-sync.ts, supabase: prep_manual_schedule, meat_consumption_history',
    progressPct: 100
  },
  {
    id: 2,
    number: '02',
    title: 'Módulo de Ventas Toast API & Conciliación Contable al Centavo',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Ventas & Finanzas',
    desc: 'Dashboard analítico de ventas de las 15 sucursales conectado a Toast API. Incluye detección y conciliación de reembolsos cruzados (Cross-Date Refunds), soporte completo de EBT, curvas de ventas horarias, filtros de turnos y comida/cena, auto-curación de datos históricos y exportación CSV funcional.',
    files: 'app/ventas/page.tsx, lib/toast-api.ts, app/api/ventas/route.ts, supabase: sales_daily_cache, toast_orders_cache',
    progressPct: 100
  },
  {
    id: 3,
    number: '03',
    title: 'Control de Uniformes, Recepción de Prendas & Arqueos de Ropa',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Inventario & Personal',
    desc: 'Sistema integral de recepción, asignación y auditoría de uniformes de cocinero y gorras bordadas por sucursal. Incluye control de tallas (S a 4XL), validación contra órdenes de compra, control de merma y arqueo físico de prendas en stock.',
    files: 'app/admin/uniforms/page.tsx, app/api/uniforms/route.ts, supabase: uniform_inventory, uniform_assignments',
    progressPct: 100
  },
  {
    id: 4,
    number: '04',
    title: 'Tech Packs Industriales & RFQ de Fabricación Textil',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Manufactura & Proveedores',
    desc: 'Fichas técnicas PDF de grado industrial para la confección de camisas y gorras bordadas con tablas de medidas, especificaciones de costura, telas de alto rendimiento y volúmenes de licitación (RFQ) para fabricantes directos.',
    files: 'tech_pack_camisa_cocinero_teg.pdf, tech_pack_gorra_bordada_teg.pdf, RFQ_Formaryx_Bidding.pdf',
    progressPct: 100
  },
  {
    id: 5,
    number: '05',
    title: 'Clon & Sincronizador Continuo de Basecamp 3/4',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Gestión & Proyectos',
    desc: 'Módulo de réplica y sincronización de Basecamp 3 API con base de datos Supabase. Soporta visualización en tarjetas (Cards) y lista (List), badges de comentarios no leídos, cajón lateral (Drawer) con carga bajo demanda de más de 30,600 comentarios sin ralentizar la interfaz.',
    files: 'app/basecamp/page.tsx, lib/basecamp-api.ts, app/api/basecamp/sync/route.ts, supabase: bc_todos, bc_comments',
    progressPct: 100
  },
  {
    id: 6,
    number: '06',
    title: 'Radar de Precios Viele & Sons & Scraper Automatizado v3',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Costos & Proveedores',
    desc: 'Monitor automatizado de costos de los 87 insumos maestros de Viele & Sons. Incluye motor de scraping de facturas, normalización de multi-packs, cálculo de impacto anual en USD ($) para las 15 tiendas y alertas por correo a directivos.',
    files: 'app/admin/radar-precios/page.tsx, lib/viele-scraper.ts, app/api/radar-precios/route.ts, supabase: supplier_price_history',
    progressPct: 100
  },
  {
    id: 7,
    number: '07',
    title: 'Módulo de Millaje Deducible IRS & GPS Canónico de 15 Tiendas',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Logística & Fiscal',
    desc: 'Calculadora y simulador de rutas con deducción fiscal bajo estándar IRS ($0.67/milla). Geocodificación canónica de las 15 tiendas de Tacos Gavilan, cálculo de matriz de distancias punto a punto con algoritmo Haversine y exportación de reportes para contabilidad.',
    files: 'app/miles/page.tsx, lib/stores-canonical.ts, app/api/miles/route.ts, supabase: store_coordinates, mileage_logs',
    progressPct: 100
  },
  {
    id: 8,
    number: '08',
    title: 'Módulo de Caja Fuerte, Bóveda & Arqueos por Sucursal',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Tesorería & Bóveda',
    desc: 'Registro digital de arqueos de efectivo, fondos de cambio y depósitos bancarios por tienda. Incluye control de denominaciones de billetes, firmas digitales, verificación de sobres y auditoría estricta con permisos RBAC.',
    files: 'app/caja-fuerte/page.tsx, app/api/safe/route.ts, supabase: safe_counts, safe_drops, safe_audit_logs',
    progressPct: 100
  },
  {
    id: 9,
    number: '09',
    title: 'Planificador de Horarios & Alertas de Violaciones de Descanso',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Laboral & Turnos',
    desc: 'Gestión de horarios laborales bajo la regla de negocio (6:00 AM a 5:59 AM del día siguiente). Detección automática de violaciones de comida (LUNCH) según ley laboral de California, alertas instantáneas por correo electrónico a gerentes y motor de descansos IA.',
    files: 'app/horarios/page.tsx, app/planificador/page.tsx, app/descansos/page.tsx, lib/labor-rules.ts, supabase: punches, schedules',
    progressPct: 100
  },
  {
    id: 10,
    number: '10',
    title: 'Food Cost, COGS & Sincronización QuickBooks Online',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Costos de Alimentos',
    desc: 'Pipeline integral de costeo de alimentos conectando QuickBooks (costo real de compra) + Toast Product Mix (PMIX). Generación de recetas virtuales escaladas para Party Trays (15-20 hasta 30-40 personas) con cálculo de salsas, desechables y carnes.',
    files: 'app/inventory/food-cost/page.tsx, lib/food-cost.ts, app/api/inventory/food-cost/route.ts, supabase: food_cost_daily_cache',
    progressPct: 100
  },
  {
    id: 11,
    number: '11',
    title: 'Pedidos de Almacén Central (Bodega) a 15 Sucursales',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Cadena de Suministro',
    desc: 'Sistema de reposición semanal de inventario con generación automática de Estimates en QuickBooks Online (usando sparse: false para prevenir borrado accidental de ítems). Soporta pedidos de carnes, secos, líquidos y uniformes.',
    files: 'app/inventory/orders/page.tsx, lib/quickbooks.ts, app/api/inventory/orders/route.ts, supabase: warehouse_orders',
    progressPct: 100
  },
  {
    id: 12,
    number: '12',
    title: 'Catálogo de Recetas Maestras de Cocina & Rendimientos',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Estandarización',
    desc: 'Repositorio de recetas oficiales con desglose de ingredientes por tipo (food, raw, cooked, cogs_packaging), cálculo de costo por porción, factores de merma y equivalencias de carnes cocidas vs crudas.',
    files: 'app/inventory/recipes/page.tsx, app/api/inventory/recipes/route.ts, supabase: recipes, recipe_ingredients',
    progressPct: 100
  },
  {
    id: 13,
    number: '13',
    title: 'Configuración & Despliegue Local de TVs de Menús Digitales',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Marketing en Tienda',
    desc: 'Módulo de control de pantallas de menú digital en alta resolución por sucursal. Permite ajustar precios, promociones, productos agotados y alternar entre menús de día y nocturnos de manera centralizada.',
    files: 'app/tv/page.tsx, app/api/tv/route.ts, supabase: menu_screens, tv_layouts',
    progressPct: 100
  },
  {
    id: 14,
    number: '14',
    title: 'Checklists Operativos Digitales & Checklists Manager',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Control de Calidad',
    desc: 'Listas de verificación digital para turnos de Apertura, Turno PM (5:00 PM) y Cierre. Firma de supervisores, registro de temperaturas de mesas frías y freidoras, y panel de control gerencial para seguimiento de cumplimiento.',
    files: 'app/checklists/page.tsx, app/checklists-manager/page.tsx, app/api/checklists/route.ts, supabase: checklist_submissions',
    progressPct: 100
  },
  {
    id: 15,
    number: '15',
    title: 'Manuales de Procedimientos, Fotos e Inspecciones con Cámara',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Operaciones & Auditoría',
    desc: 'Catálogo de procedimientos operativos estandarizados con guías visuales paso a paso y módulo de auditoría de sucursales con captura y subida directa de fotografías desde teléfonos y tabletas.',
    files: 'app/procedimientos/page.tsx, app/inspecciones/page.tsx, app/actividades/page.tsx, supabase: inspections, procedure_docs',
    progressPct: 100
  },
  {
    id: 16,
    number: '16',
    title: 'Asistente de Soporte IA TEG con Aprendizaje Contextual',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Inteligencia Artificial',
    desc: 'Asistente de IA conversacional especializado en las operaciones de Tacos Gavilan, conectado a las herramientas de base de datos y al catálogo de procedimientos para responder dudas gerenciales y técnicas en tiempo real.',
    files: 'app/api/support-chat/route.ts, lib/chat-tools.ts',
    progressPct: 100
  },
  {
    id: 17,
    number: '17',
    title: 'Directorio Canónico de Sucursales & Geocodificación',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Infraestructura',
    desc: 'Administrador central de las 15 tiendas de Tacos Gavilan con external IDs de Toast POS, direcciones oficiales verificadas, coordenadas de latitud/longitud y números telefónicos directos.',
    files: 'app/tiendas/page.tsx, lib/stores-canonical.ts, supabase: stores',
    progressPct: 100
  },
  {
    id: 18,
    number: '18',
    title: 'Sistema de Seguridad RBAC, Usuarios & Permisos',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Seguridad & Accesos',
    desc: 'Control de acceso granular basado en roles (Administrador, Gerente General, Supervisor, Cajero, Cocinero) con restricción por sucursal y autenticación protegida.',
    files: 'app/admin/page.tsx, app/usuarios/page.tsx, app/login/page.tsx, lib/auth.ts, supabase: user_roles, store_permissions',
    progressPct: 100
  },
  {
    id: 19,
    number: '19',
    title: 'Batería de Crons Automáticos & Auto-Curación de Datos',
    status: 'completado',
    statusLabel: 'Completado',
    category: 'Infraestructura Cloud',
    desc: 'Suite de 6 cron jobs programados en Vercel y Supabase para sincronización continua de ventas, ponchadas laborales, costeo de recetas, chequeo de integridad diaria y alertas automáticas de aumentos de precios.',
    files: 'vercel.json, app/api/cron/*, app/api/integrity/verify-day/route.ts',
    progressPct: 100
  },
  {
    id: 20,
    number: '20',
    title: 'Telemetría de Drive-Thru (HME Zoom Nitro)',
    status: 'progreso',
    statusLabel: 'En Progreso',
    category: 'Tiempos de Servicio',
    desc: 'Ingesta de datos de tiempos de espera en ventanilla de auto-servicio, medición de cuellos de botella en orden, preparación y entrega para tiendas con Drive-Thru. Integración de API en fase de calibración de sensores físicos.',
    files: 'app/drive-thru/page.tsx, app/api/drive-thru/route.ts, supabase: drive_thru_events',
    progressPct: 85
  },
  {
    id: 21,
    number: '21',
    title: 'Evaluaciones de Personal & Retroalimentación de Clientes',
    status: 'progreso',
    statusLabel: 'En Progreso',
    category: 'Recursos Humanos',
    desc: 'Módulo de evaluaciones periódicas de desempeño para supervisores y empleados, encuestas digitales de satisfacción de comensales y canal de feedback de servicio por sucursal.',
    files: 'app/evaluacion/page.tsx, app/feedback/page.tsx, app/feedback-publico/page.tsx',
    progressPct: 80
  },
  {
    id: 22,
    number: '22',
    title: 'Minutas de Reuniones Gerenciales & Seguimiento de Acuerdos',
    status: 'progreso',
    statusLabel: 'En Progreso',
    category: 'Dirección Operativa',
    desc: 'Registro digital de juntas ejecutivas y reuniones de gerentes de área con asignación de compromisos, fechas límite y seguimiento de acuerdos por sucursal.',
    files: 'app/reunion/page.tsx, app/gestion/page.tsx, supabase: meeting_minutes',
    progressPct: 75
  },
  {
    id: 23,
    number: '23',
    title: 'Integración Contable Avanzada & Reportes Cohesion',
    status: 'progreso',
    statusLabel: 'En Progreso',
    category: 'Finanzas Corporativas',
    desc: 'Módulo de exportación financiera con desglose de ventas netas, costos laborales, compras de insumos y deducciones fiscales para integración directa con sistemas de contabilidad corporativa.',
    files: 'app/admin/cohesion/page.tsx, app/api/reports/financial/route.ts',
    progressPct: 70
  },
  {
    id: 24,
    number: '24',
    title: 'Gestor de Medios & Video Displays en Sucursales',
    status: 'pendiente',
    statusLabel: 'Pendiente',
    category: 'Ambiente en Tienda',
    desc: 'Plataforma para programar y reproducir contenidos audiovisuales y videos musicales de ambientación en las pantallas de salón de las tiendas.',
    files: 'Roadmap de despliegue para siguiente fase tecnológica',
    progressPct: 20
  }
];

const completedCount = masterModules.filter(m => m.status === 'completado').length;
const progressCount = masterModules.filter(m => m.status === 'progreso').length;
const pendingCount = masterModules.filter(m => m.status === 'pendiente').length;

console.log(`📊 TOTAL MÓDULOS: ${masterModules.length}`);
console.log(`✅ COMPLETADOS: ${completedCount}`);
console.log(`🔄 EN PROGRESO: ${progressCount}`);
console.log(`⏳ PENDIENTES: ${pendingCount}`);

// Generate Task Cards HTML for Tab 2 (Pendientes del Sistema)
const taskCardsHtml = masterModules.map(m => {
  const badgeClass = m.status === 'completado' ? 'status-completed' : (m.status === 'progreso' ? 'status-progress' : 'status-pending');
  const badgeEmoji = m.status === 'completado' ? '✅' : (m.status === 'progreso' ? '🔄' : '⏳');
  
  return `
    <div class="task-card">
        <div class="task-card-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="task-num-badge">#${m.number}</span>
                <div>
                    <h3 class="task-title">${m.title}</h3>
                    <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">📂 ${m.category}</span>
                </div>
            </div>
            <span class="status-badge ${badgeClass}">${badgeEmoji} ${m.statusLabel} (${m.progressPct}%)</span>
        </div>
        <p class="task-desc-box">${m.desc}</p>
        <div class="task-audit-box">
            <div class="task-audit-title">🛠️ Componentes Técnicos & Archivos de Respaldo:</div>
            <code>${m.files}</code>
        </div>
    </div>
  `;
}).join('\n');

// Read existing August Report to keep Gantt and table intact
let currentAugustHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Replace Stats Row
const newStatsGrid = `
    <!-- Stats Row -->
    <div class="stats-grid">
        <div class="stat-card total">
            <div class="stat-num">${masterModules.length}</div>
            <div class="stat-label">Total Módulos</div>
        </div>
        <div class="stat-card completed">
            <div class="stat-num">${completedCount}</div>
            <div class="stat-label">Completados (100%)</div>
        </div>
        <div class="stat-card progress">
            <div class="stat-num">${progressCount}</div>
            <div class="stat-label">En Progreso</div>
        </div>
        <div class="stat-card pending">
            <div class="stat-num">${pendingCount}</div>
            <div class="stat-label">Siguiente Fase</div>
        </div>
        <div class="stat-card hours">
            <div class="stat-num">89.62 <small style="font-size:16px;">hrs</small></div>
            <div class="stat-label">Horas Agosto</div>
        </div>
    </div>
`;

currentAugustHtml = currentAugustHtml.replace(/<!-- Stats Row -->[\s\S]*?<!-- Tabs Navigation/m, newStatsGrid.trim() + '\n\n    <!-- Tabs Navigation');

// Replace Tab 2 content
const tab2Regex = /<div id="panel-pendientes" class="tab-panel">[\s\S]*?<\/div>\s*<\/div>\s*<!-- Footer -->/m;
const newTab2Content = `
        <div id="panel-pendientes" class="tab-panel">
            <div style="margin-bottom: 20px; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 18px 22px;">
                <h2 style="font-size: 18px; font-weight: 900; color: #0f172a; margin-bottom: 4px;">Auditoría Tecnológica de los ${masterModules.length} Módulos del Sistema SM TEG</h2>
                <p style="font-size: 13px; color: #64748b;">Desglose transparente del estado de desarrollo de cada módulo, componentes de código fuente, endpoints de API y tablas en Supabase.</p>
            </div>
            ${taskCardsHtml}
        </div>
    </div>

    <!-- Footer -->
`;

currentAugustHtml = currentAugustHtml.replace(tab2Regex, newTab2Content.trim());

// Update Tab 2 label
currentAugustHtml = currentAugustHtml.replace(/📋 Pendientes del Sistema \(20 Modulos\)/g, `📋 Módulos del Sistema (${masterModules.length} Módulos)`);

// Save updated HTML
fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', currentAugustHtml, 'utf-8');
console.log('✅ pendientes_agosto.html actualizado con la auditoría de 24 módulos!');

(async () => {
    console.log('🚀 Recompilando Reporte_Agosto_2026_TEG.pdf...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1800 });

    const fileUrl = `file:///${path.resolve('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const pdfOutPath = 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf';
    await page.pdf({
        path: pdfOutPath,
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    console.log('🎉 Reporte_Agosto_2026_TEG.pdf generado exitosamente!');
    
    // Screenshot of tab 2
    await page.click('label[for="tab-pendientes"]');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
    
    const screenshotPath = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/modules_tab_preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('📸 Screenshot de pestaña módulos guardado en: ' + screenshotPath);

    await browser.close();
})();
