const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('💎 RECONSTRUYENDO LOS 3 REPORTES CON ESTATUS HISTÓRICOS 100% REALES');
console.log('═══════════════════════════════════════════════════════════════════════');

// Base 26 tasks catalog with detailed descriptions
const catalog26 = [
  {
    num: 1,
    title: '1. Inventario con reposición automática',
    category: 'Inventario / Inventory',
    badgeDept: '📦 Inventario',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas analizando el consumo histórico de las últimas 4 semanas y las existencias actuales capturadas por el gerente.',
    auditJuly: '<strong>Muy Avanzado (En Progreso).</strong> El sistema calcula de manera inteligente el pedido sugerido de insumos para las tiendas con soporte preliminar de QuickBooks.',
    auditAugust: '<strong>✓ Completado e Implementado en Producción (Agosto 2026).</strong> Sistema de reposición semanal con cálculo de PAR dinámico, generación automática de Estimates en QuickBooks Online (usando <code>sparse: false</code> para proteger ítems) y soporte para carnes, secos, líquidos y uniformes.',
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
    badgeDept: '📦 Inventario',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran al proveedor Viele & Sons.',
    auditJuly: '<strong>Estructurado (En Progreso).</strong> Creado el catálogo en base de datos para diferenciar los insumos de uso interno del restaurante vs los que se compran a Viele & Sons.',
    auditAugust: '<strong>✓ Completado e Integrado (Agosto 2026).</strong> Motor de scraping automático de facturas de Viele & Sons v3, indexación de los 87 insumos maestros, Radar de Precios con cálculo de impacto anual en USD ($) para las 15 tiendas y alertas automáticas por correo a directivos.',
    steps: [
      'Scraper automatizado de facturas con normalización de empaques.',
      'Dashboard ejecutivo de Radar de Precios con 4 métricas anuales.',
      'Alertas por correo electrónico enviadas automáticamente ante aumentos.'
    ]
  },
  {
    num: 3,
    title: '3. Configuración local de TVs de Menús',
    category: 'Dispositivos / Devices',
    badgeDept: '📺 Dispositivos',
    badgePriority: '🟡 Media',
    auditJune: '<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda y la página pública que muestra el menú rotativo en las pantallas.',
    auditJuly: '<strong>Muy Avanzado (En Progreso).</strong> Diseñada la pantalla de administración para subir las imágenes de menús por tienda.',
    auditAugust: '<strong>✓ Completado y Desplegado (Agosto 2026).</strong> Módulo de visualización y control centralizado de menús digitales en alta definición para pantallas de sucursales con soporte de cambios de precios y turnos día/noche.',
    steps: [
      'Diseño responsive en alta resolución para pantallas de TV.',
      'Conexión en tiempo real con la base de datos de precios.',
      'Despliegue y verificación en pantallas locales.'
    ]
  },
  {
    num: 4,
    title: '4. Logotipo de marca en correos electrónicos',
    category: 'Comunicaciones / Comms',
    badgeDept: '✉️ Comunicaciones',
    badgePriority: '🔵 Baja',
    auditJune: '<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales utilizando el servidor de tacosgavilan.com con texto plano y firma básica.',
    auditJuly: '<strong>Configuración Básica (En Progreso).</strong> El sistema ya envía correos institucionales con firma básica.',
    auditAugust: '<strong>✓ Completado (Agosto 2026).</strong> Plantillas de correo electrónico con diseño corporativo oficial, branding de Tacos Gavilan, encabezados responsivos y soporte para notificaciones de violaciones laborales y alertas de precios.',
    steps: [
      'Plantilla HTML responsiva con logotipo oficial de Tacos Gavilan.',
      'Integración con el servicio de envío de correos (Resend/SMTP).',
      'Verificado en clientes de correo móvil y escritorio.'
    ]
  },
  {
    num: 5,
    title: '5. Descripciones de procedimientos en página de ACTIVIDADES',
    category: 'Operaciones / Operations',
    badgeDept: '📝 Operaciones',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo. Contiene el listado de 31 procedimientos operativos estandarizados.',
    auditJuly: '<strong>Estructura Concluida (En Progreso).</strong> El panel administrativo y móvil de Actividades de Cocina está completo.',
    auditAugust: '<strong>✓ Completado e Implementado (Agosto 2026).</strong> Catálogo digital de procedimientos operativos estandarizados con descripciones paso a paso, buscador interactivo y visualización clara para el personal.',
    steps: [
      'Base de datos de procedimientos y actividades estructurada.',
      'Interfaz de consulta rápida y búsqueda por palabra clave.',
      'Sincronización con el Asistente de Soporte IA.'
    ]
  },
  {
    num: 6,
    title: '6. Verificar tabletas piloto en Slauson',
    category: 'Dispositivos / Devices',
    badgeDept: '📺 Dispositivos',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>En Pruebas (En Progreso).</strong> Hay 4 tabletas instaladas físicamente en la cocina piloto de Slauson corriendo software de telemetría.',
    auditJuly: '<strong>✓ Completado e Integrado (Julio 2026).</strong> Se verificaron físicamente las 4 tabletas piloto en la cocina de Slauson durante las pruebas de campo.',
    auditAugust: '<strong>✓ Completado e Integrado.</strong> Modo kiosko de tableta seguro para cocina (Preparador KDS) con bloqueo de edición táctil accidental, polling de sincronización cada 10 segundos con la PC del gerente y tipografía ampliada para visibilidad.',
    steps: [
      'Desarrollo del modo pantalla completa exclusivo para cocina.',
      'Polling de sincronización bidireccional cada 10s en Supabase.',
      'Pruebas y validación en sitio en tableta de cocina.'
    ]
  },
  {
    num: 7,
    title: '7. App de Tacos Gavilán (Imitar King Taco)',
    category: 'Sistemas / Systems',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>Muy Avanzado (En Progreso).</strong> Creado el sistema de base de datos para la aplicación móvil (carritos de compra, puntos de fidelidad, selector de sucursal y menú interactivo).',
    auditJuly: '<strong>Muy Avanzado (En Progreso).</strong> Base de datos de la app móvil y catálogo digital de productos estructurado.',
    auditAugust: '<strong>⚡ En Progreso.</strong> Arquitectura móvil en React Native/Expo con flujo de pedidos, selección de sucursales y sincronización con POS Toast.',
    steps: [
      'Estructura de catálogo móvil y carrito de compras.',
      'Integración con la pasarela de pagos y menú en línea.',
      'Pruebas de pedidos móviles en sucursales piloto.'
    ]
  },
  {
    num: 8,
    title: '8. Sincronizador y clon de Basecamp',
    category: 'Sistemas / Systems',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>Altamente Avanzado (En Progreso).</strong> El sistema web está integrado con Basecamp. Las tablas internas sincronizan automáticamente proyectos, mensajes y listas de tareas pendientes.',
    auditJuly: '<strong>Altamente Avanzado (En Progreso).</strong> Sincronización continua con Basecamp y descarga asíncrona de adjuntos.',
    auditAugust: '<strong>✓ Completado (Agosto 2026).</strong> Integración bidireccional con Basecamp 3 API con tokens auto-renovables, buscador instantáneo global (Shift+J), modal Basecamp 4 Dialog Card con desenfoque y descarga asíncrona de archivos adjuntos.',
    steps: [
      'Integración OAuth2 y sincronización local-first en Supabase.',
      'Buscador universal Shift+J con búsqueda paralela.',
      'Rediseño moderno con modal Dialog Card y carga bajo demanda de comentarios.'
    ]
  },
  {
    num: 9,
    title: '9. Página Web Oficial de Tacos El Gavilán',
    category: 'Sistemas / Systems',
    badgeDept: '💻 Sistemas',
    badgePriority: '🟡 Media',
    auditJune: '<strong>Avanzado (En Progreso).</strong> Toda la estructura visual y de contenidos del sitio web oficial está finalizada (exhibición de platillos, historia, mapa de sucursales).',
    auditJuly: '<strong>Avanzado (En Progreso).</strong> Estructura visual y mapa de sucursales completado.',
    auditAugust: '<strong>⚡ En Progreso.</strong> Portal web oficial responsivo con localización de sucursales, menú interactivo y optimización SEO.',
    steps: [
      'Diseño responsivo móvil y de escritorio.',
      'Integración del directorio oficial de 15 tiendas.',
      'Despliegue y configuración de dominio.'
    ]
  },
  {
    num: 10,
    title: '10. Determinar gasto en Salsa Bar',
    category: 'Inventario / Inventory',
    badgeDept: '📦 Inventario',
    badgePriority: '🟡 Media',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> Existe registro de mermas e ingredientes de la barra de salsas en los checklists históricos, pero no se ha desarrollado el módulo de cálculo de costo por porción.',
    auditJuly: '<strong>⏳ No Iniciado (Pendiente).</strong> Módulo pendiente de desarrollo para calcular el costo por porción del salsa bar.',
    auditAugust: '<strong>⏳ Pendiente.</strong> Modelo de costos para estimar el consumo y merma de salsas, limones y vegetales por comensal.',
    steps: [
      'Estandarizar recetas y pesos de preparación de salsas.',
      'Registrar rendimiento por tanda y costo de insumos.',
      'Integrar en la matriz de Food Cost de la cadena.'
    ]
  },
  {
    num: 11,
    title: '11. Fotos y verificación Apple Business Connect (Slauson)',
    category: 'Dispositivos / Marketing',
    badgeDept: '📺 Dispositivos',
    badgePriority: '🟡 Media',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> Tarea operativa consistente en registrar la sucursal de Slauson, subir fotografías en alta resolución del interior/exterior y verificar la ficha del negocio en Apple Maps.',
    auditJuly: '<strong>⏳ No Iniciado (Pendiente).</strong> Verificación en Apple Maps pendiente de sesión de fotografía.',
    auditAugust: '<strong>⏳ Pendiente.</strong> Sesión fotográfica y verificación en Apple Business Connect para sucursales oficiales.',
    steps: [
      'Fotografía profesional de exteriores e interiores de tiendas.',
      'Carga de assets en portal Apple Business Connect.',
      'Validación de pin y horarios en Apple Maps.'
    ]
  },
  {
    num: 12,
    title: '12. Registro de proveedores y técnicos sin contraseña',
    category: 'Sistemas / Systems',
    badgeDept: '💻 Sistemas',
    badgePriority: '🟡 Media',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> Planificado un portal simplificado de acceso rápido con códigos temporales para que técnicos de refrigeración y proveedores registren sus visitas sin requerir cuenta.',
    auditJuly: '<strong>⏳ No Iniciado (Pendiente).</strong> Portal de acceso con código QR temporal para proveedores pendiente.',
    auditAugust: '<strong>⏳ Pendiente.</strong> Registro ágil mediante código QR temporal para visitas técnicas de mantenimiento en tiendas.',
    steps: [
      'Generador de códigos QR y links temporales para contratistas.',
      'Bitácora digital de entradas y salidas de técnicos.',
      'Alertas al gerente de tienda al arribar personal externo.'
    ]
  },
  {
    num: 13,
    title: '13. Control de uniformes, gorras e inventario de ropa',
    category: 'Inventario / Merchandise',
    badgeDept: '📦 Inventario',
    badgePriority: '🟡 Media',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> Módulo operativo pendiente de desarrollo para controlar las existencias de uniformes, gorras y chamarras.',
    auditJuly: '<strong>▶ En Progreso (Julio 2026).</strong> Se implementó y desplegó en producción el tipo de orden de Uniformes en el módulo de Pedidos de Bodega.',
    auditAugust: '<strong>✓ Completado e Integrado (Agosto 2026).</strong> Módulo integral de uniformes con catálogo de precios (Camisas $7, Gorras $1, Chamarras $20), exenciones gerenciales, tabla de stock mínimo de 660 registros en BD para 15 tiendas y conciliación de ventas en efectivo con Caja Fuerte.',
    steps: [
      'Catálogo de precios y reglas de exención implementadas.',
      'Tabla de stock mínimo (660 registros en BD) blindada.',
      'Conciliación automática con la bóveda de Caja Fuerte.'
    ]
  },
  {
    num: 14,
    title: '14. Manuales, videos y certificación de cocina',
    category: 'Operaciones / Training',
    badgeDept: '📝 Operaciones',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> El sistema cuenta con exámenes rápidos de desempeño para gerentes, pero falta crear la biblioteca de videos demostrativos y el flujo de certificación para personal de línea.',
    auditJuly: '<strong>⏳ No Iniciado (Pendiente).</strong> Biblioteca de videos demostrativos de recetas y cocina pendiente de producción.',
    auditAugust: '<strong>⏳ Pendiente.</strong> Portal interactivo de capacitación con videos y exámenes de certificación para cocineros y taqueros.',
    steps: [
      'Producción de videos cortos demostrativos por estación.',
      'Cuestionarios de evaluación interactivos en tableta.',
      'Certificados digitales de aprobación por empleado.'
    ]
  },
  {
    num: 15,
    title: '15. Sección de Cultura Empresarial',
    category: 'Operaciones / HR',
    badgeDept: '📝 Operaciones',
    badgePriority: '🟡 Media',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> Sección informativa planificada para capacitar y familiarizar a los nuevos empleados con los valores, historia y visión de Tacos Gavilan.',
    auditJuly: '<strong>⏳ No Iniciado (Pendiente).</strong> Módulo de onboarding y valores de empresa pendiente.',
    auditAugust: '<strong>⚡ En Progreso.</strong> Guía interactiva de bienvenida y cultura institucional integrada en el asistente de soporte.',
    steps: [
      'Documento de valores, misión y estándares de servicio.',
      'Módulo visual de inducción para nuevos empleados.',
      'Integración en el flujo de bienvenida de la app.'
    ]
  },
  {
    num: 16,
    title: '16. CLONAR Cohesion (app de contabilidad)',
    category: 'Sistemas / Finance',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>⏳ No Iniciado (Pendiente).</strong> Desarrollo e integración de un clon contable de la plataforma Cohesión a medida para procesar nóminas, conciliar facturas y estados de cuenta.',
    auditJuly: '<strong>⏳ No Iniciado (Pendiente).</strong> Módulo contable integral por evaluar.',
    auditAugust: '<strong>⏳ Pendiente.</strong> Módulo contable para conciliación automática de nóminas, depósitos bancarios y facturación.',
    steps: [
      'Especificación de esquemas de datos contables y reportes.',
      'Integración con extractos bancarios y API de nómina.',
      'Tablero financiero de pérdidas y ganancias.'
    ]
  },
  {
    num: 17,
    title: '17. Módulo de Rendimiento y Telemetría de Drive-Thru (HME Zoom Nitro)',
    category: 'Sistemas / Hardware',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    auditJune: '<strong>✓ Completado e Integrado (Junio 2026).</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru en las sucursales con ventanilla.',
    auditJuly: '<strong>✓ Completado e Integrado.</strong> Se vinculó exitosamente el sistema con los sensores físicos de autos del Drive-Thru.',
    auditAugust: '<strong>✓ Completado e Integrado.</strong> Telemetría en tiempo real de tiempos de espera, cobro y despacho de ventanilla con alertas por cuello de botella.',
    steps: [
      'Conexión con la API/controlador de HME Zoom Nitro.',
      'Métricas en vivo de segundos por vehículo en ventanilla.',
      'Historial de rendimiento y benchmarks entre sucursales.'
    ]
  },
  {
    num: 18,
    title: '18. Actualizar y Descargar Videos Musicales Regional Mexicano',
    category: 'Operaciones / Marketing',
    badgeDept: '🎵 Tienda',
    badgePriority: '🟢 Normal',
    auditJune: '', // Not in June
    auditJuly: '<strong>⏳ Pendiente (Julio 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano para las pantallas de las sucursales.',
    auditAugust: '<strong>✓ Completado (Agosto 2026).</strong> Actualización y descarga de la biblioteca de videos musicales de Regional Mexicano en formato MP4 HD organizados en unidades USB para reproducción en los televisores de los restaurantes.',
    steps: [
      'Definir lista de canciones y artistas populares para el ambiente de los restaurantes.',
      'Descargar videos en alta definición compatibles con las pantallas de las sucursales.',
      'Organizar archivos y distribuirlos a las sucursales.'
    ]
  },
  {
    num: 19,
    title: '19. Módulo de Caja Fuerte (Conteo de Efectivo por Sucursal)',
    category: 'Finanzas / Treasury',
    badgeDept: '💰 Finanzas',
    badgePriority: '🔴 Alta',
    auditJune: '', // Not in June
    auditJuly: '<strong>✓ Completado e Integrado (10-Jul-2026).</strong> Módulo completo para que los gerentes registren el conteo de efectivo semanal de la caja fuerte con desglose de billetes, monedas y total.',
    auditAugust: '<strong>✓ Completado e Integrado.</strong> Registro semanal de billetes, monedas sueltas, rollos y gavetas con cálculo automático de gran total, conciliación de ventas de uniformes y control de ediciones pasadas.',
    steps: [
      'Formulario estructurado de desglose de efectivo.',
      'Conciliación automática con ventas de uniformes en efectivo.',
      'Historial auditable con control de modificaciones por rol.'
    ]
  },
  {
    num: 20,
    title: '20. Módulo de Tiendas (Integración Dinámica, Geocodificación y Mapas de Google)',
    category: 'Sistemas / Locations',
    badgeDept: '💻 Sistemas',
    badgePriority: '🔴 Alta',
    auditJune: '', // Not in June
    auditJuly: '<strong>✓ Completado e Integrado (14-Jul-2026).</strong> Vinculación dinámica de sucursales con el resto de los módulos del sistema y mapas de Google.',
    auditAugust: '<strong>✓ Completado e Integrado.</strong> Directorio dinámico de las 15 sucursales oficiales + Bodega Central con coordenadas GPS exactas, teléfonos y horarios de operación.',
    steps: [
      'Tabla canónica de tiendas en base de datos.',
      'Geocodificación de coordenadas GPS para integración con MilesIQ.',
      'Selector global de sucursales en cabecera del sistema.'
    ]
  },
  {
    num: 21,
    title: '21. Radar de Precios Viele v3 y Auditoría de Impacto Anual COGS',
    category: 'Costos & Proveedores',
    badgeDept: '📊 Finanzas',
    badgePriority: '🔴 Alta',
    auditJune: '',
    auditJuly: '',
    auditAugust: '<strong>⚡ En Progreso (90% de avance).</strong> Ingesta automática de API REST v3 de Viele & Sons (86 insumos en 1.3s), cron semanal los lunes 6:00 AM, cálculo de impacto anual en USD ($) para 15 tiendas y aprobación de cambios a Food Cost.',
    steps: [
      'Conexión API REST v3 y scraper automatizado.',
      'Cálculo de impacto inflacionario en dólares para la cadena.',
      'Integración con Sysco y US Foods para comparativas de mercado.'
    ]
  },
  {
    num: 22,
    title: '22. Control de Descansos Laborales (Labor Compliance AI & Alertas CA)',
    category: 'Recursos Humanos',
    badgeDept: '⚖️ Legal & RRHH',
    badgePriority: '🔴 Alta',
    auditJune: '',
    auditJuly: '',
    auditAugust: '<strong>⚡ En Progreso (85% de avance).</strong> Algoritmo de sugerencias inteligentes de comida respetando la regla del Manager Jesús (salida temprana primero), alertas por correo de violaciones y auditoría según California Labor Law.',
    steps: [
      'Motor de asignación dinámica de horarios de comida.',
      'Alertas de violaciones despachadas a supervisores y directivos.',
      'Afinación de la interfaz móvil y reporte mensual consolidado de multas.'
    ]
  },
  {
    num: 23,
    title: '23. Conciliación Multitienda Toast API (Cross-Date Refunds & EBT)',
    category: 'Ventas & Contabilidad',
    badgeDept: '💰 Finanzas',
    badgePriority: '🔴 Alta',
    auditJune: '',
    auditJuly: '',
    auditAugust: '<strong>⚡ En Progreso (90% de avance).</strong> Algoritmo de conciliación de reembolsos de fechas cruzadas (Party Trays) y ventas EBT para cuadre al centavo con reportes contables oficiales en las 15 tiendas.',
    steps: [
      'Fórmula unificada: Sum(Items) - Discounts - Refunds - CrossDateRefunds.',
      'Diagnóstico y resolución de discrepancias en tiendas (Bell $8,332.64).',
      'Automatización del cron de auto-sanación de caché de ventas.'
    ]
  },
  {
    num: 24,
    title: '24. Módulo de Control de Millas y Desplazamientos MilesIQ (Geofencing GPS e IRS)',
    category: 'Supervisión & RRHH',
    badgeDept: '🚗 Supervisión',
    badgePriority: '🔴 Alta',
    auditJune: '',
    auditJuly: '',
    auditAugust: '<strong>⚡ En Progreso (85% de avance).</strong> Geofencing perimetral en las 15 tiendas + Bodega, cálculo fiscal IRS ($0.760/milla), lanzador rápido QuickDriveModal con apertura de Google/Apple Maps y sincronización automática desde inspecciones.',
    steps: [
      'Detección GPS pasiva por geofencing en tiendas oficiales.',
      'Cálculo automático de distancias y montos de reembolso IRS.',
      'Concluir exportación formal de nómina para despacho a RRHH.'
    ]
  },
  {
    num: 25,
    title: '25. Tech Packs y Fichas Técnicas de Uniformes (Licitación RFQ)',
    category: 'Compras & Proveedores',
    badgeDept: '👕 Mercancía',
    badgePriority: '🟡 Media',
    auditJune: '',
    auditJuly: '',
    auditAugust: '<strong>⚡ En Progreso (75% de avance).</strong> Especificaciones técnicas de confección (telas, gramajes, costuras, bordados, pantones) y volúmenes de licitación anual (15 tiendas) para negociación directa con fabricantes.',
    steps: [
      'Fichas técnicas de Playeras Rojas, Polos Gerenciales y Chamarras.',
      'Volúmenes de compra anual calculados para licitación RFQ.',
      'Generación de documentos ejecutivos de negociación con proveedores.'
    ]
  },
  {
    num: 26,
    title: '26. Predicción Estacional de Galones de Champurrado & Kiosko de Satisfacción',
    category: 'Cocina & Temporadas',
    badgeDept: '☕ Operaciones',
    badgePriority: '🟡 Media',
    auditJune: '',
    auditJuly: '',
    auditAugust: '<strong>⏳ Pendiente.</strong> Modelo de proyección estacional en /api/inventory/champurrado-forecast con 5 años de historial de semanas ISO y sugerencia informativa de galones diarios para la orden de bodega.',
    steps: [
      'Extracción histórica de galones y vasos vendidos en Toast.',
      'Fórmula de sugerencia con niveles de confianza (HIGH/MED/LOW).',
      'Integración visual informativa en la Orden Diaria de Bodega.'
    ]
  }
];

// 1. BUILD JUNE TASKS (17 Tasks: 1 Comp, 9 Prog, 7 Pend)
const juneTasks = catalog26.slice(0, 17).map(t => {
    let status = 'pendiente';
    let statusLabel = '⏳ Pendiente';
    if (t.num === 17) {
        status = 'completado';
        statusLabel = '✓ Completado';
    } else if (t.num >= 1 && t.num <= 9) {
        status = 'progreso';
        statusLabel = '⚡ En Progreso';
    }
    return {
        ...t,
        status,
        statusLabel,
        audit: t.auditJune
    };
});

// 2. BUILD JULY TASKS (20 Tasks: 4 Comp, 9 Prog, 7 Pend)
const julyTasks = catalog26.slice(0, 20).map(t => {
    let status = 'pendiente';
    let statusLabel = '⏳ Pendiente';
    if ([17, 19, 20, 6].includes(t.num)) {
        status = 'completado';
        statusLabel = '✓ Completado';
    } else if ([1, 2, 3, 4, 5, 7, 8, 9, 13].includes(t.num)) {
        status = 'progreso';
        statusLabel = '⚡ En Progreso';
    }
    return {
        ...t,
        status,
        statusLabel,
        audit: t.auditJuly
    };
});

// 3. BUILD AUGUST TASKS (26 Tasks: 12 Comp, 7 Prog, 7 Pend)
const augustTasks = catalog26.map(t => {
    let status = 'pendiente';
    let statusLabel = '⏳ Pendiente';
    if ([1, 2, 3, 4, 5, 6, 8, 13, 17, 18, 19, 20].includes(t.num)) {
        status = 'completado';
        statusLabel = '✓ Completado';
    } else if ([7, 15, 21, 22, 23, 24, 25].includes(t.num)) {
        status = 'progreso';
        statusLabel = '⚡ En Progreso';
    }
    return {
        ...t,
        status,
        statusLabel,
        audit: t.auditAugust
    };
});

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

// Load master builder logic
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

// August Rows (22 days)
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
        time: '6:09 AM - 8:30 AM & 11:30 AM - 1:45 PM & 4:30 PM - 5:30 PM & 7:15 PM - 9:30 PM',
        hours: 7.85,
        badges: ['Radar de Precios', 'Viele & Sons v3', 'Descansos IA', 'Basecamp 4'],
        descEs: '• <strong>Radar de Precios (Alertas Ejecutivas & Despacho a Directivos)</strong>: Diseño y programación de la plantilla HTML ejecutiva para alertas de fluctuaciones de precios de Viele & Sons. Implementación del motor de despacho por correo a los 4 directivos (Roberto, Raquel, Gonzalo y Carlos) con métricas de impacto anual a nivel cadena ($ USD), enlaces directos a /admin/precios-proveedores y envío de correo oficial de presentación con PDF adjunto.<br>• <strong>Radar de Precios (Scraper Viele & Sons v3)</strong>: Blindaje del scraper de la API REST de Viele y manejo seguro de credenciales con fallback preventivo de errores.<br>• <strong>Descansos IA (Motor de Aprendizaje)</strong>: Auditoría y optimización de sugerencias de breaks respetando la regla operativa de salidas tempranas primero.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Modal flotante con desenfoque de fondo para visualización y edición independiente de tareas.',
        descEn: '• <strong>Price Radar (Executive Alerts & Management Dispatch)</strong>: Designed and implemented executive HTML email template for Viele & Sons price changes. Deployed automated email dispatch to 4 directors (Roberto, Raquel, Gonzalo, Carlos) with annual chain-wide financial impact ($ USD), direct links to /admin/precios-proveedores, and sent official presentation email with attached PDF.<br>• <strong>Price Radar (Viele & Sons v3 Scraper)</strong>: Hardened Viele REST API scraper and secured credential handling with graceful error fallbacks.<br>• <strong>Breaks AI (Learning Engine)</strong>: Audited and refined break suggestions honoring early-departure manager rules.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Floating modal with blurred backdrop for standalone task viewing and editing.'
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

// JUNE CONFIG: 17 tasks (1 Completada, 9 En Progreso, 7 Pendientes)
const juneConfig = {
    monthName: 'Junio',
    monthYear: 'Junio 2026',
    monthNum: 6,
    totalTasks: 17,
    completedTasks: 1,
    inProgressTasks: 9,
    pendingTasks: 7,
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
    taskCardsHtml: renderTab2ForMonth(juneTasks, 'Junio 2026')
};

// JULY CONFIG: 20 tasks (4 Completadas, 9 En Progreso, 7 Pendientes)
const julyConfig = {
    monthName: 'Julio',
    monthYear: 'Julio 2026',
    monthNum: 7,
    totalTasks: 20,
    completedTasks: 4,
    inProgressTasks: 9,
    pendingTasks: 7,
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
    taskCardsHtml: renderTab2ForMonth(julyTasks, 'Julio 2026')
};

// AUGUST CONFIG: 26 tasks (12 Completadas, 7 En Progreso, 7 Pendientes)
const augustConfig = {
    monthName: 'Agosto',
    monthYear: 'Agosto 2026',
    monthNum: 8,
    totalTasks: 26,
    completedTasks: 12,
    inProgressTasks: 7,
    pendingTasks: 7,
    totalHours: 102.25,
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
        { module: 'Radar de Precios Viele v3 & Auditoría COGS', hours: 11.5 },
        { module: 'Mantenimiento General, Crons y Reportes', hours: 7.75 }
    ],
    taskCardsHtml: renderTab2ForMonth(augustTasks, 'Agosto 2026')
};

// WRITE REPORTS
fs.writeFileSync('pendientes.html', buildReportHtml(juneConfig), 'utf-8');
fs.writeFileSync('pendientes_julio.html', buildReportHtml(julyConfig), 'utf-8');
fs.writeFileSync('pendientes_agosto.html', buildReportHtml(augustConfig), 'utf-8');

console.log('✅ 3 reportes reconstruidos con estatus históricos 100% auténticos!');

(async () => {
    console.log('📸 Tomando capturas de pantalla de junio, julio y agosto...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1200 });

    // June Tab 2
    const juneUrl = `file:///${path.resolve('pendientes.html').replace(/\\/g, '/')}`;
    await page.goto(juneUrl, { waitUntil: 'networkidle0' });
    await page.click('label[for="tab-pendientes"]');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/june_tab2_exact_status.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    // July Tab 2
    const julyUrl = `file:///${path.resolve('pendientes_julio.html').replace(/\\/g, '/')}`;
    await page.goto(julyUrl, { waitUntil: 'networkidle0' });
    await page.click('label[for="tab-pendientes"]');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/july_tab2_exact_status.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    // August Tab 2
    const augUrl = `file:///${path.resolve('pendientes_agosto.html').replace(/\\/g, '/')}`;
    await page.goto(augUrl, { waitUntil: 'networkidle0' });
    await page.click('label[for="tab-pendientes"]');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: 'C:/Users/pedro/.gemini/antigravity/brain/72f704bf-fc24-425d-8dbd-e2a211289a28/august_tab2_exact_status.png', clip: { x: 0, y: 0, width: 1300, height: 1100 } });

    // Recompile Desktop PDF
    await page.click('label[for="tab-reporte"]');
    await new Promise(r => setTimeout(r, 400));
    await page.pdf({
        path: 'c:/Users/pedro/Desktop/Reporte_Agosto_2026_TEG.pdf',
        format: 'Letter',
        printBackground: true,
        scale: 0.82,
        margin: { top: '0.3in', right: '0.3in', bottom: '0.3in', left: '0.3in' }
    });

    console.log('🎉 Screenshots capturadas y PDF recompilado!');
    await browser.close();
})();
