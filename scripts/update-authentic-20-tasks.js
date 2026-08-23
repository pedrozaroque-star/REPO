const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🎯 ACTUALIZACIÓN AUTÉNTICA DE LAS 20 TAREAS OFICIALES DE CARLOS');
console.log('═══════════════════════════════════════════════════════════════════════');

// Read the pristine 20 task cards from July HTML
const julyHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8');

// The 20 official tasks categorized for August 2026 based on real work completed
const updated20Tasks = [
  // ── COMPLETADOS (12) ──
  {
    num: 1,
    title: '1. Inventario con reposición automática',
    category: 'Inventario',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Implementado en Producción.</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes.',
    steps: [
      'Configurado el motor de órdenes semanales por sucursal hacia la bodega central.',
      'Integrada la API de QuickBooks Online con guardado seguro.',
      'Pruebas y validación en sucursales operando al 100%.'
    ]
  },
  {
    num: 2,
    title: '2. Inventario para Bodega y COGS (Viele & Sons)',
    category: 'Costos & Proveedores',
    badgeDept: '📊 Finanzas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Integrado.</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos.',
    steps: [
      'Scraper automatizado de facturas con normalización de empaques.',
      'Dashboard ejecutivo de Radar de Precios con 4 métricas anuales.',
      'Alertas por correo electrónico enviadas automáticamente ante aumentos.'
    ]
  },
  {
    num: 3,
    title: '3. Configuración local de TVs de Menús',
    category: 'Marketing & Tienda',
    badgeDept: '💻 Sistemas',
    badgePriority: '🟡 Media',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado y Desplegado.</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche.',
    steps: [
      'Diseño responsive en alta resolución para pantallas de TV.',
      'Conexión en tiempo real con la base de datos de precios.',
      'Despliegue y verificación en pantallas locales.'
    ]
  },
  {
    num: 4,
    title: '4. Logotipo de marca en correos electrónicos',
    category: 'Comunicación',
    badgeDept: '🎨 Diseño',
    badgePriority: '🟢 Normal',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado.</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios.',
    steps: [
      'Plantilla HTML responsiva con logotipo oficial de Tacos Gavilan.',
      'Integración con el servicio de envío de correos (Resend/SMTP).',
      'Verificado en clientes de correo móvil y escritorio.'
    ]
  },
  {
    num: 5,
    title: '5. Descripciones de procedimientos en página de ACTIVIDADES',
    category: 'Operaciones',
    badgeDept: '📋 Operaciones',
    badgePriority: '🟡 Media',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Implementado.</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal.',
    steps: [
      'Base de datos de procedimientos y actividades estructurada.',
      'Interfaz de consulta rápida y búsqueda por palabra clave.',
      'Sincronización con el Asistente de Soporte IA.'
    ]
  },
  {
    num: 6,
    title: '6. Verificar tabletas piloto en Slauson',
    category: 'Hardware & Kiosko',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad.',
    steps: [
      'Desarrollo del modo pantalla completa exclusivo para cocina.',
      'Polling de sincronización bidireccional cada 10s en Supabase.',
      'Pruebas y validación en sitio en tableta de cocina.'
    ]
  },
  {
    num: 8,
    title: '8. Sincronizador y clon de Basecamp',
    category: 'Gestión & Proyectos',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Integrado al 100%.</strong> Réplica completa de Basecamp 3 API con almacenamiento en Supabase. Vistas Cards/List ("View As"), Drawer lateral de tareas con carga bajo demanda de más de 30,600 comentarios sin congelar la interfaz.',
    steps: [
      'Pipeline de sincronización continua con la API de Basecamp 3.',
      'Carga bajo demanda de hilos de comentarios con backdrop blur.',
      'Corrección de bucles de renderizado y optimización de memoria.'
    ]
  },
  {
    num: 10,
    title: '10. Determinar gasto en Salsa Bar',
    category: 'Costos de Alimentos',
    badgeDept: '📊 Finanzas',
    badgePriority: '🟡 Media',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Integrado en Food Cost.</strong> Algoritmo de costeo de salsas (roja, verde, habanero, aguacate) basado en rendimientos de recetas maestras, vasos/tapas de empaque y volumen de ventas de tacos y órdenes.',
    steps: [
      'Estandarización de recetas de salsa en el módulo de recetas.',
      'Cálculo de porciones promedio consumidas por cliente/orden.',
      'Integración en el pipeline de Food Cost y COGS mensual.'
    ]
  },
  {
    num: 13,
    title: '13. Control de uniformes, gorras e inventario de ropa',
    category: 'Inventario & Personal',
    badgeDept: '👔 Personal',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado con Tech Packs Oficiales.</strong> Módulo de recepción y asignación de prendas (tallas S a 4XL), arqueos físicos de stock por tienda y creación de Tech Packs PDF de grado industrial para confección de camisas y gorras bordadas con RFQ de licitación.',
    steps: [
      'Módulo administrativo de control de prendas y asignación.',
      'Fichas técnicas industriales (Tech Packs) con tablas de medidas.',
      'Documento RFQ de licitación enviado a proveedores textiles.'
    ]
  },
  {
    num: 17,
    title: '17. Módulo de Rendimiento y Telemetría de Drive-Thru (HME Zoom Nitro)',
    category: 'Tiempos de Servicio',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Integrado.</strong> Vinculación con sensores físicos de autos de Drive-Thru y pantallas KDS. Tablero con 4 pestañas para rankings de velocidad por tienda, promedios por media hora, reportes exportables en CSV y visor de tickets.',
    steps: [
      'Proceso de descarga automática de datos de velocidad cada 2 minutos.',
      'API de consulta rápida para tablero de velocidades y rankings.',
      'Reportes históricos y exportación a Excel.'
    ]
  },
  {
    num: 19,
    title: '19. Módulo de Caja Fuerte (Conteo de Efectivo por Sucursal)',
    category: 'Tesorería & Bóveda',
    badgeDept: '💰 Finanzas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Integrado.</strong> Registro digital de arqueos de caja fuerte por denominación de billetes, control de sobres de depósito bancario, firmas digitales y permisos de seguridad RBAC.',
    steps: [
      'Formulario digital de arqueo de billetes y monedas.',
      'Registro de depósitos bancarios y control de diferencias.',
      'Auditoría y trazabilidad por gerente en Supabase.'
    ]
  },
  {
    num: 20,
    title: '20. Módulo de Tiendas (Integración Dinámica, Geocodificación y Mapas de Google)',
    category: 'Infraestructura',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    status: 'completado',
    statusLabel: '✓ Completado',
    audit: '<strong>Completado e Integrado.</strong> Catálogo centralizado de las 15 sucursales de Tacos Gavilan con external IDs de Toast POS, geocodificación canónica verificada con tacosgavilan.com, coordenadas GPS y teléfonos de contacto.',
    steps: [
      'Base de datos unificada de tiendas en Supabase.',
      'Geocodificación canónica y cálculo de matrices de distancia.',
      'Integración con módulos de Ventas, Horarios y Millaje IRS.'
    ]
  },

  // ── EN PROGRESO (6) ──
  {
    num: 7,
    title: '7. App de Tacos Gavilán (Imitar King Taco)',
    category: 'Móvil & Clientes',
    badgeDept: '📱 Móvil',
    badgePriority: '🟡 Media',
    status: 'progreso',
    statusLabel: 'En Progreso (60%)',
    audit: '<strong>En Progreso.</strong> Arquitectura base de la aplicación móvil de pedidos para clientes inspirada en modelos líderes de la industria, con catálogo de productos y selección de sucursal.',
    steps: [
      'Definición de flujo de usuario y catálogo de productos.',
      'Integración preliminar con el menú de Toast POS.',
      'Pendiente: Pasarela de pagos y programa de lealtad.'
    ]
  },
  {
    num: 9,
    title: '9. Página Web Oficial de Tacos El Gavilán',
    category: 'Web Corporativa',
    badgeDept: '🌐 Web',
    badgePriority: '🟡 Media',
    status: 'progreso',
    statusLabel: 'En Progreso (75%)',
    audit: '<strong>En Progreso.</strong> Actualización de la presencia web corporativa, sincronización de direcciones de sucursales, menú interactivo y optimización SEO bajo la marca oficial Tacos Gavilan.',
    steps: [
      'Estandarización de direcciones y horarios de las 15 tiendas.',
      'Optimización de imágenes y menú para dispositivos móviles.',
      'Pendiente: Publicación final de la nueva versión.'
    ]
  },
  {
    num: 11,
    title: '11. Fotos y verificación Apple Business Connect (Slauson)',
    category: 'Marketing Digital',
    badgeDept: '📍 Marketing',
    badgePriority: '🟢 Normal',
    status: 'progreso',
    statusLabel: 'En Progreso (50%)',
    audit: '<strong>En Progreso.</strong> Actualización de perfiles en Apple Maps y Google Business con fotografías profesionales de comida, fachadas y horarios oficiales para la sucursal de Slauson.',
    steps: [
      'Sesión de fotos y recopilación de material gráfico.',
      'Validación de datos de ubicación en Apple Business Connect.',
      'Pendiente: Aprobación final de fichas en plataforma Apple.'
    ]
  },
  {
    num: 12,
    title: '12. Registro de proveedores y técnicos sin contraseña',
    category: 'Seguridad & Acceso',
    badgeDept: '🔐 Seguridad',
    badgePriority: '🟡 Media',
    status: 'progreso',
    statusLabel: 'En Progreso (50%)',
    audit: '<strong>En Progreso.</strong> Sistema de acceso mediante Magic Links y códigos temporales por SMS/WhatsApp para técnicos y proveedores de mantenimiento sin requerir contraseñas permanentes.',
    steps: [
      'Diseño del flujo de autenticación sin contraseña (Passwordless).',
      'Integración preliminar de tokens temporales.',
      'Pendiente: Despliegue en tableta de acceso de sucursal.'
    ]
  },
  {
    num: 14,
    title: '14. Manuales, videos y certificación de cocina',
    category: 'Capacitación',
    badgeDept: '📚 Capacitación',
    badgePriority: '🟡 Media',
    status: 'progreso',
    statusLabel: 'En Progreso (85%)',
    audit: '<strong>En Progreso Avanzado.</strong> Guía operativa digital del Preparador integrada en la tableta con modal de consulta rápida, tablas de capacidad máxima de charola y estándares de cocción de carne.',
    steps: [
      'Modal de Guía Operativa integrado en pantalla de Preparador KDS.',
      'Tablas de máximos de charola por proteína documentadas.',
      'Pendiente: Grabación y subida de videos interactivos.'
    ]
  },
  {
    num: 16,
    title: '16. CLONAR Cohesion (app de contabilidad)',
    category: 'Finanzas & Contabilidad',
    badgeDept: '📊 Finanzas',
    badgePriority: '🔴 Alta',
    status: 'progreso',
    statusLabel: 'En Progreso (80%)',
    audit: '<strong>En Progreso Avanzado.</strong> Conciliación de ventas netas, costos de nómina por hora, detección de reembolsos cruzados en Toast API y reportes exportables para el departamento contable.',
    steps: [
      'Fórmula exacta de Net Sales y conciliación de Toast API al centavo.',
      'Cálculo proporcional de mano de obra y horas trabajadas.',
      'Pendiente: Integración con módulo de nómina directa.'
    ]
  },

  // ── PENDIENTES (2) ──
  {
    num: 15,
    title: '15. Sección de Cultura Empresarial',
    category: 'Identidad Corporativa',
    badgeDept: '🏛️ Cultura',
    badgePriority: '🟢 Normal',
    status: 'pendiente',
    statusLabel: 'Pendiente',
    audit: '<strong>Pendiente de Inicio.</strong> Sección dedicada a la historia, valores, misión y visión de Tacos Gavilan para inducción de nuevos empleados y material institucional.',
    steps: [
      'Redacción de contenidos institucionales con la dirección.',
      'Diseño de la sección interactiva en la plataforma web.',
      'Pendiente: Aprobación por dirección ejecutiva.'
    ]
  },
  {
    num: 18,
    title: '18. Actualizar y Descargar Videos Musicales Regional Mexicano',
    category: 'Ambiente en Tienda',
    badgeDept: '🎵 Medios',
    badgePriority: '🟢 Normal',
    status: 'pendiente',
    statusLabel: 'Pendiente',
    audit: '<strong>Pendiente.</strong> Descarga, depuración y actualización del catálogo de videos musicales de ambientación para reproducción en las pantallas de salón de las tiendas.',
    steps: [
      'Selección y filtro de listas de reproducción autorizadas.',
      'Compresión de video en formatos ligeros para reproducción offline.',
      'Pendiente: Distribución a discos duros de pantallas locales.'
    ]
  }
];

const completedTasks = updated20Tasks.filter(t => t.status === 'completado');
const progressTasks = updated20Tasks.filter(t => t.status === 'progreso');
const pendingTasks = updated20Tasks.filter(t => t.status === 'pendiente');

console.log(`📊 TOTAL TAREAS CANÓNICAS: ${updated20Tasks.length}`);
console.log(`✅ COMPLETADAS: ${completedTasks.length}`);
console.log(`🔄 EN PROGRESO: ${progressTasks.length}`);
console.log(`⏳ PENDIENTES: ${pendingTasks.length}`);

// Function to generate task cards HTML
function renderTaskCard(t) {
  const badgeClass = t.status === 'completado' ? 'badge-complete' : (t.status === 'progreso' ? 'badge-prog' : 'badge-pend');
  const boxClass = t.status === 'completado' ? 'green-box' : (t.status === 'progreso' ? 'yellow-box' : 'gray-box');
  const numColor = t.status === 'completado' ? 'green-num' : (t.status === 'progreso' ? 'yellow-num' : 'gray-num');
  const numIcon = t.status === 'completado' ? '✓' : (t.status === 'progreso' ? '⚡' : '○');

  const stepsHtml = t.steps.map(step => `
    <div class="step-item">
        <span class="step-number ${numColor}">${numIcon}</span>
        <span class="step-text">${step}</span>
    </div>
  `).join('');

  return `
    <div class="task-card">
        <div>
            <div class="card-tags">
                <span class="badge badge-sys">${t.badgeDept}</span>
                <span class="badge ${t.badgePriority.includes('Alta') ? 'badge-hi' : (t.badgePriority.includes('Media') ? 'badge-med' : 'badge-norm')}">${t.badgePriority}</span>
                <span class="badge ${badgeClass}">${t.statusLabel}</span>
            </div>
            <h3 class="task-title">${t.title}</h3>
            
            <div class="card-section">
                <span class="card-section-title">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" class="card-section-icon"><path d="M12 2C6.48 2 2 4.02 2 6.5s4.48 4.5 10 4.5 10-2.02 10-4.5S17.52 2 12 2zM2 17c0 2.48 4.48 4.5 10 4.5s10-2.02 10-4.5M2 12c0 2.48 4.48 4.5 10 4.5s10-2.02 10-4.5"/></svg>
                    Estatus del código / BD
                </span>
                <div class="audit-box ${boxClass}">
                    ${t.audit}
                </div>
            </div>
        </div>
        
        <div class="card-section" style="margin-top: 14px;">
            <span class="card-section-title">
                <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" class="card-section-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><polyline points="9 11 12 14 17 9"></polyline></svg>
                Puntos de Avance & Próximos Pasos
            </span>
            <div class="steps-list">
                ${stepsHtml}
            </div>
        </div>
    </div>
  `;
}

const completedHtml = completedTasks.map(renderTaskCard).join('\n');
const progressHtml = progressTasks.map(renderTaskCard).join('\n');
const pendingHtml = pendingTasks.map(renderTaskCard).join('\n');

const fullTab2Content = `
        <div id="panel-pendientes" class="tab-panel">
            <div style="margin-bottom: 24px; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 18px 22px;">
                <h2 style="font-size: 18px; font-weight: 900; color: #0f172a; margin-bottom: 4px;">Auditoría de las 20 Tareas Oficiales del Sistema (Agosto 2026)</h2>
                <p style="font-size: 13px; color: #64748b;">Seguimiento transparente de las 20 tareas canónicas definidas para el proyecto, reflejando los avances de ingeniería alcanzados hasta la fecha.</p>
            </div>

            <!-- SECCIÓN 1: COMPLETADO (12) -->
            <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 2px solid #10b981; padding-bottom: 8px;">
                <h2 style="font-size: 18px; font-weight: 900; color: #065f46;">✓ Completado</h2>
                <span style="background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; font-size: 12px; font-weight: 800; padding: 3px 12px; border-radius: 999px;">${completedTasks.length} Tareas</span>
            </div>
            <div class="cards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 32px;">
                ${completedHtml}
            </div>

            <!-- SECCIÓN 2: EN PROGRESO (6) -->
            <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">
                <h2 style="font-size: 18px; font-weight: 900; color: #1e40af;">⚡ En Progreso</h2>
                <span style="background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; font-size: 12px; font-weight: 800; padding: 3px 12px; border-radius: 999px;">${progressTasks.length} Tareas</span>
            </div>
            <div class="cards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 32px;">
                ${progressHtml}
            </div>

            <!-- SECCIÓN 3: PENDIENTES (2) -->
            <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 2px solid #f59e0b; padding-bottom: 8px;">
                <h2 style="font-size: 18px; font-weight: 900; color: #92400e;">⏳ Pendientes</h2>
                <span style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 12px; font-weight: 800; padding: 3px 12px; border-radius: 999px;">${pendingTasks.length} Tareas</span>
            </div>
            <div class="cards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 32px;">
                ${pendingHtml}
            </div>
        </div>
    </div>

    <!-- Footer -->
`;

// Read current August HTML
let currentAugustHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Replace Stats Row
const newStatsGrid = `
    <!-- Stats Row -->
    <div class="stats-grid">
        <div class="stat-card total">
            <div class="stat-num">20</div>
            <div class="stat-label">Total Tareas</div>
        </div>
        <div class="stat-card completed">
            <div class="stat-num">12</div>
            <div class="stat-label">Completado</div>
        </div>
        <div class="stat-card progress">
            <div class="stat-num">6</div>
            <div class="stat-label">En Progreso</div>
        </div>
        <div class="stat-card pending">
            <div class="stat-num">2</div>
            <div class="stat-label">Pendiente</div>
        </div>
        <div class="stat-card hours">
            <div class="stat-num">89.62 <small style="font-size:16px;">hrs</small></div>
            <div class="stat-label">Horas Agosto</div>
        </div>
    </div>
`;

currentAugustHtml = currentAugustHtml.replace(/<!-- Stats Row -->[\s\S]*?<!-- Tabs Navigation/m, newStatsGrid.trim() + '\n\n    <!-- Tabs Navigation');

// Replace Tab 2
const tab2Regex = /<div id="panel-pendientes" class="tab-panel">[\s\S]*?<\/div>\s*<\/div>\s*<!-- Footer -->/m;
currentAugustHtml = currentAugustHtml.replace(tab2Regex, fullTab2Content.trim());

// Update Tab 2 label
currentAugustHtml = currentAugustHtml.replace(/📋 (?:Pendientes|Módulos) del Sistema \(\d+ (?:Módulos|Modulos|Tareas)\)/g, '📋 Pendientes del Sistema (20 Tareas)');

// Add styling for card tags, audit-box, steps-list if needed
const additionalCss = `
        /* ── July-Style Rich Task Card CSS ── */
        .card-tags {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }

        .badge {
            font-size: 10px;
            font-weight: 800;
            padding: 3px 8px;
            border-radius: 6px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .badge-sys { background: #0f172a; color: #ffffff; }
        .badge-hi { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        .badge-med { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .badge-norm { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .badge-complete { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
        .badge-prog { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
        .badge-pend { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }

        .card-section-title {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            font-weight: 800;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-bottom: 6px;
        }

        .audit-box {
            font-size: 12.5px;
            line-height: 1.45;
            padding: 10px 14px;
            border-radius: 8px;
            border: 1px solid transparent;
        }

        .green-box { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
        .yellow-box { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .gray-box { background: #f8fafc; border-color: #e2e8f0; color: #475569; }

        .steps-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .step-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            font-size: 12px;
            line-height: 1.4;
            color: #334155;
        }

        .step-number {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 900;
            flex-shrink: 0;
            margin-top: 1px;
        }

        .green-num { background: #d1fae5; color: #065f46; }
        .yellow-num { background: #fef3c7; color: #92400e; }
        .gray-num { background: #e2e8f0; color: #64748b; }
`;

if (!currentAugustHtml.includes('.card-tags {')) {
    currentAugustHtml = currentAugustHtml.replace('</style>', additionalCss + '\n    </style>');
}

// Save updated HTML
fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', currentAugustHtml, 'utf-8');
console.log('✅ pendientes_agosto.html restaurado con las 20 tareas canónicas de Carlos!');

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
    
    const screenshotPath = 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/canonical_20_tasks_preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('📸 Screenshot de 20 tareas guardado en: ' + screenshotPath);

    await browser.close();
})();
