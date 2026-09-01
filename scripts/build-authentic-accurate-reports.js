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
        "date": "01-Ago-2026",
        "time": "6:30 PM - 11:00 PM",
        "hours": 4.5,
        "badges": [
            "Preparador",
            "Soporte IA"
        ],
        "descEs": "• <strong>Preparador (Proyecciones por Tramos & Live Data)</strong>: Transición completa de las proyecciones de carne de intervalos de 30 min a bloques de tramos de hora pico. Forzado de HTTP no-store para refresco en tiempo real.<br>• <strong>Preparador (🔥 Máx. Charola & Guía Operativa)</strong>: Nuevo badge de capacidad máxima de charola por tarjeta de proteína y modal interactivo de guía operativa.<br>• <strong>Soporte IA</strong>: Sincronización del prompt del asistente con las capacidades del preparador.",
        "descEn": "• <strong>Prep Line (Period Blocks & Live Data)</strong>: Full transition of meat projections to peak period blocks. Zero-cache HTTP fetching for real-time sync.<br>• <strong>Prep Line (🔥 Max Tray & Operational Guide)</strong>: Max holding tray capacity badge and interactive operational guide modal.<br>• <strong>AI Support</strong>: Synced assistant prompt with new prep line capabilities."
    },
    {
        "date": "02-Ago-2026",
        "time": "5:00 PM - 6:00 PM",
        "hours": 1,
        "badges": [
            "Preparador"
        ],
        "descEs": "• <strong>Preparador (Modo Básico vs Avanzado)</strong>: Conmutador de visualización para tarjetas limpias de un solo número.<br>• <strong>Preparador (Modo Tableta Kiosko)</strong>: Badge TABLETA prominente y ocultamiento de botones no operativos en pantalla completa.",
        "descEn": "• <strong>Prep Line (Basic vs Advanced Mode)</strong>: Display switch for clean single-number cards.<br>• <strong>Prep Line (Tablet Kiosk Mode)</strong>: Prominent TABLETA badge and hidden non-operational buttons in fullscreen."
    },
    {
        "date": "03-Ago-2026",
        "time": "4:42 PM - 7:04 PM & 9:30 PM - 11:10 PM",
        "hours": 3.92,
        "badges": [
            "Inventario",
            "QuickBooks"
        ],
        "descEs": "• <strong>Inventario (QuickBooks Estimates)</strong>: Corrección crítica en la actualización de presupuestos configurando sparse: false para prevenir que QBO elimine ítems no enviados durante guardados parciales diarios.<br>• <strong>Preservación de Estado</strong>: Soporte para ítems extraordinarios en el estado local de React.",
        "descEn": "• <strong>Inventory (QuickBooks Estimates)</strong>: Critical fix for QBO Estimate updates with sparse: false to prevent item truncation during partial daily saves.<br>• <strong>State Preservation</strong>: Retained extraordinary items in React local state."
    },
    {
        "date": "04-Ago-2026",
        "time": "9:45 AM - 2:00 PM & 6:30 PM - 11:15 PM",
        "hours": 9,
        "badges": [
            "Preparador",
            "Inventario",
            "Reportes"
        ],
        "descEs": "• <strong>Reporte Julio</strong>: Consolidación final del informe de julio con 117.80 hrs.<br>• <strong>Preparador (Edición Táctil & Modo Semanal)</strong>: Modo de sobreescritura manual tap-to-edit y selector de 3 modos [Manual | Básica | Avanzada] persistente en base de datos.<br>• <strong>Inventario (PAR Semanal)</strong>: Corrección de actualizaciones inmediatas de PAR para tipos de orden de Líquidos y Uniformes.",
        "descEn": "• <strong>July Report</strong>: Finalized July report at 117.80 hrs.<br>• <strong>Prep Line (Touch Edit & Weekly Mode)</strong>: Tap-to-edit manual overrides and 3-mode toggle [Manual | Basic | Advanced] persisted to database.<br>• <strong>Inventory (Weekly PAR)</strong>: Fixed immediate PAR updates for Liquids and Uniforms orders."
    },
    {
        "date": "05-Ago-2026",
        "time": "2:15 PM - 3:53 PM",
        "hours": 1.64,
        "badges": [
            "Preparador",
            "Reportes"
        ],
        "descEs": "• <strong>Preparador (Optimización Gráfica)</strong>: Ajuste de contraste y tipografía para legibilidad a larga distancia en cocina.<br>• <strong>Reportes de Rendimiento</strong>: Estabilización de cálculos de rendimiento de carne por hora.",
        "descEn": "• <strong>Prep Line (Visual Optimization)</strong>: High-contrast typography adjustments for long-distance kitchen readability.<br>• <strong>Yield Reports</strong>: Stabilized meat yield hourly calculations."
    },
    {
        "date": "06-Ago-2026",
        "time": "12:30 PM - 1:45 PM & 9:30 PM - 10:00 PM",
        "hours": 1.75,
        "badges": [
            "Preparador",
            "Base de Datos"
        ],
        "descEs": "• <strong>Preparador (Sincronización Tableta-PC)</strong>: Integración de polling cada 10s para paridad de cocina con PC del gerente.<br>• <strong>Base de Datos</strong>: Migración de tabla prep_manual_schedule a producción y compatibilidad de IDs numéricos/texto.",
        "descEn": "• <strong>Prep Line (Tablet-PC Sync)</strong>: 10s polling for manager PC parity.<br>• <strong>Database</strong>: Migrated prep_manual_schedule table to production and normalized storeId parsing."
    },
    {
        "date": "07-Ago-2026",
        "time": "2:30 PM - 5:02 PM",
        "hours": 2.54,
        "badges": [
            "Horarios",
            "Descansos IA"
        ],
        "descEs": "• <strong>Horarios (Notificaciones de Violaciones)</strong>: Habilitación de alertas por correo para violaciones de descansos de comida (Lunch Breaks) bajo normativa laboral de California.<br>• <strong>Descansos IA</strong>: Calibración del motor predictivo para asignar descansos antes de la 5ta hora de trabajo.",
        "descEn": "• <strong>Schedules (Violation Notifications)</strong>: Automated email alerts for CA lunch break violations.<br>• <strong>Breaks AI</strong>: Calibrated engine to assign breaks before the 5th working hour."
    },
    {
        "date": "08-Ago-2026",
        "time": "10:00 AM - 1:30 PM & 6:00 PM - 9:45 PM",
        "hours": 7.15,
        "badges": [
            "Ventas Toast API",
            "Descansos IA"
        ],
        "descEs": "• <strong>Ventas (Toast API & Conciliación Neta)</strong>: Conciliación de ventas netas, soporte de descuentos prorrateados y Party Trays a escala.<br>• <strong>Descansos Laborales (Regla de Salida Temprana)</strong>: Implementación de la prioridad de descansos para turnos con salida anticipada.",
        "descEn": "• <strong>Sales (Toast API Reconciliation)</strong>: Reconciled net sales, prorated discount handling, and scaled Party Trays.<br>• <strong>Breaks (Early Exit Rule)</strong>: Prioritized breaks for early departure shifts."
    },
    {
        "date": "09-Ago-2026",
        "time": "11:00 AM - 1:45 PM",
        "hours": 2.74,
        "badges": [
            "Preparador",
            "Telemetría"
        ],
        "descEs": "• <strong>Preparador (Auto-Refresh & Acelerador)</strong>: Ajuste del acelerador intradía de carne contra curvas de ventas históricas.<br>• <strong>Telemetría de Cocina</strong>: Diagnóstico de tiempos de respuesta en tablets de cocina.",
        "descEn": "• <strong>Prep Line (Auto-Refresh & Accelerator)</strong>: Adjusted intraday meat pace against historical curves.<br>• <strong>Kitchen Telemetry</strong>: Diagnosed kitchen tablet response times."
    },
    {
        "date": "10-Ago-2026",
        "time": "4:15 PM - 6:33 PM",
        "hours": 2.3,
        "badges": [
            "Actividades",
            "Descansos IA",
            "Tech Packs RFQ"
        ],
        "descEs": "• <strong>Actividades (Asignación Diaria)</strong>: Filtrado de empleados en combos por sucursal activa en AsignacionDiariaTab, excluyendo perfiles directivos y respetando empleados en vacaciones.<br>• <strong>Descansos IA</strong>: Soporte para adición y eliminación manual de descansos en turnos menores o iguales a 6 horas.<br>• <strong>Tech Packs RFQ</strong>: Planificación de fichas técnicas para menudeo y comercialización de insumos.",
        "descEn": "• <strong>Activities (Daily Assignment)</strong>: Filtered employee dropdowns strictly by store, hiding corporate users while retaining returning vacation staff.<br>• <strong>Breaks AI</strong>: Manual break add/remove for shifts <= 6h.<br>• <strong>Tech Packs RFQ</strong>: Initial specs for wholesale and retail items."
    },
    {
        "date": "11-Ago-2026",
        "time": "9:15 AM - 10:30 AM & 6:45 PM - 8:41 PM",
        "hours": 3.18,
        "badges": [
            "Caja Fuerte",
            "Uniformes",
            "Tech Packs Viele"
        ],
        "descEs": "• <strong>Caja Fuerte (Edición de Historial)</strong>: Habilitación de edición de registros históricos de corte para supervisores y admins en pestaña Historial para corrección de capturas erróneas.<br>• <strong>Uniformes & Sidebar</strong>: Asignación de badge NEW en barra lateral al módulo de Control de Uniformes.<br>• <strong>Tech Packs & Proveedores</strong>: Redacción de especificaciones de 21 productos desechables y solicitud formal a Viele & Sons.",
        "descEn": "• <strong>Safe Counts (History Edit)</strong>: Permitted supervisors/admins to edit past cash count logs to fix entry mistakes.<br>• <strong>Uniforms & Sidebar</strong>: Assigned NEW badge to Uniforms module in sidebar.<br>• <strong>Tech Packs & Vendors</strong>: Drafted 21 disposables spec sheets and formal request to Viele & Sons."
    },
    {
        "date": "12-Ago-2026",
        "time": "10:30 AM - 1:45 PM & 7:00 PM - 8:05 PM",
        "hours": 4.33,
        "badges": [
            "Uniformes Bodega",
            "Tech Packs Desechables"
        ],
        "descEs": "• <strong>Inventario & Uniformes</strong>: Sincronización automática de PAR de uniformes con stock mínimo de tienda y Sobrante en tiempo real en Pedidos de Bodega.<br>• <strong>i18n Bilingüe</strong>: Corrección de clave de traducción faltante bodegaOrders.inStock.<br>• <strong>Tech Packs</strong>: Investigación técnica exhaustiva de materiales, dimensiones y empaques para 22 insumos desechables.",
        "descEn": "• <strong>Inventory & Uniforms</strong>: Auto-synced uniform PAR with minimum stock and real-time on-hand inventory in Bodega Orders.<br>• <strong>Bilingual i18n</strong>: Fixed missing bodegaOrders.inStock translation key.<br>• <strong>Tech Packs</strong>: Technical research on materials, dimensions, and packaging for 22 disposable products."
    },
    {
        "date": "13-Ago-2026",
        "time": "8:45 AM - 10:00 AM & 4:30 PM - 8:00 PM & 8:15 PM - 9:45 PM",
        "hours": 6.45,
        "badges": [
            "MilesIQ Supervisores",
            "Champurrado Forecast"
        ],
        "descEs": "• <strong>MilesIQ (Módulo de Millas Supervisores)</strong>: Creación completa del módulo MilesIQ: registro de viajes, geocodificación de sucursales, despacho consolidado a RRHH, control de acceso por rol y edición de viajes pendientes.<br>• <strong>Champurrado Forecast</strong>: Motor de pronóstico estacional a 5 años en /api/inventory/champurrado-forecast, carrusel de cocina trasera y corrección de conversión (1 galón = 8 lbs).",
        "descEn": "• <strong>MilesIQ (Supervisor Mileage)</strong>: Complete MilesIQ module build: trip logging, store geocoding, HR payroll dispatch, role access, and pending trip editing.<br>• <strong>Champurrado Forecast</strong>: 5-year seasonal forecasting engine at /api/inventory/champurrado-forecast, back kitchen carousel, and gallon conversion fix (1 gal = 8 lbs)."
    },
    {
        "date": "14-Ago-2026",
        "time": "—",
        "hours": 0,
        "badges": [
            "Descanso Operativo"
        ],
        "descEs": "• <strong>Día de Descanso Operativo</strong>: Sin actividad de desarrollo en el sistema.",
        "descEn": "• <strong>Operational Rest Day</strong>: No development activity recorded."
    },
    {
        "date": "15-Ago-2026",
        "time": "3:00 PM - 5:30 PM & 7:30 PM - 9:56 PM",
        "hours": 4.94,
        "badges": [
            "Uniformes Stock",
            "Análisis Viele 87 CSV"
        ],
        "descEs": "• <strong>Control de Uniformes</strong>: Editor individual de stock por prenda/talla (EditItemStockModal), deducción resiliente en intercambios por daño y bloqueo de doble recepción de órdenes.<br>• <strong>Análisis de Costos Viele & Sons</strong>: Auditoría exhaustiva de la guía de órdenes (87 productos) con histórico de fluctuaciones de precios 2025.",
        "descEn": "• <strong>Uniforms Stock</strong>: Individual item stock editor per size/garment, resilient damage exchange deductions, and duplicate reception locking.<br>• <strong>Viele Cost Analysis</strong>: Comprehensive audit of 87-item Viele Order Guide with 2025 price fluctuation history."
    },
    {
        "date": "16-Ago-2026",
        "time": "12:00 PM - 4:15 PM & 6:30 PM - 9:15 PM",
        "hours": 6.96,
        "badges": [
            "MilesIQ GPS",
            "Uniformes Store Lock",
            "Planificador Calendar Sync"
        ],
        "descEs": "• <strong>MilesIQ (Navegación GPS de 1 Toque)</strong>: Lanzadores móviles directos para Google Maps, Apple Maps y Waze con autoguardado de viaje, autoselección de sucursal origen y tarifa fiscal IRS ($0.760/milla).<br>• <strong>Uniformes</strong>: Bloqueo de sesión para gerentes de tienda a su sucursal asignada.<br>• <strong>Planificador</strong>: Sincronización móvil a calendarios (.ics / Google Calendar / Apple Calendar) para turnos de empleados.<br>• <strong>Preparador</strong>: Throttle de rueda de mouse/trackpad (400ms) para laptops.",
        "descEn": "• <strong>MilesIQ (1-Tap GPS Navigation)</strong>: Direct mobile launchers for Google Maps, Apple Maps, Waze with trip auto-save, origin autodetect, and IRS rate ($0.760/mi).<br>• <strong>Uniforms</strong>: Locked store manager sessions strictly to assigned store.<br>• <strong>Planner</strong>: Mobile calendar sync (.ics / Google / Apple Calendar) for employee shifts.<br>• <strong>Prep Line</strong>: 400ms mouse wheel throttle for laptop trackpads."
    },
    {
        "date": "17-Ago-2026",
        "time": "4:45 AM - 5:45 AM & 2:30 PM - 5:56 PM",
        "hours": 4.43,
        "badges": [
            "Radar de Precios Viele 87",
            "Planificador Violaciones Cron",
            "Tech Packs Insumos"
        ],
        "descEs": "• <strong>Radar de Precios de Proveedores</strong>: Lanzamiento del módulo /admin/precios-proveedores con catálogo de 87 insumos Viele & Sons y cálculo de impacto COGS anual a nivel cadena.<br>• <strong>Planificador (Cron de Violaciones)</strong>: Cron automatizado de las 11:59 AM (/api/cron/sync-daily-violations) para detección de anomalías de asistencia en Toast.<br>• <strong>Tech Packs de Insumos</strong>: Generación de reportes PDF desglosados de compras por categoría (Beef, Milk, Desechables).",
        "descEn": "• <strong>Supplier Price Radar</strong>: Launched /admin/precios-proveedores with 87-item Viele catalog and annual COGS chain impact calculator.<br>• <strong>Planner (Violations Cron)</strong>: Automated 11:59 AM cron (/api/cron/sync-daily-violations) for Toast attendance anomaly detection.<br>• <strong>Item Tech Packs</strong>: Generated category-specific PDF purchasing reports (Beef, Milk, Packaging)."
    },
    {
        "date": "18-Ago-2026",
        "time": "11:00 AM - 1:30 PM & 5:00 PM - 7:53 PM",
        "hours": 5.39,
        "badges": [
            "Radar de Precios Scraper Viele v3",
            "Cron Semanal",
            "Tech Pack Calibración",
            "Uniformes Orders"
        ],
        "descEs": "• <strong>Radar de Precios (Scraper Viele v3 & Cron)</strong>: Scraper automático en vivo (/api/inventory/supplier-prices/sync) y cron semanal de detección de inflación.<br>• <strong>Radar de Precios (Nuevos Proveedores)</strong>: Modal para registro y mapeo de distribuidores alternativos.<br>• <strong>Calibración de Precios</strong>: Ajuste de precios base Dic 2025 del Tech Pack oficial.<br>• <strong>Pedidos & Uniformes</strong>: Eliminación de race conditions en edición de PAR y blindaje contra concatenación de texto en recepción.",
        "descEn": "• <strong>Price Radar (Viele v3 Scraper & Cron)</strong>: Live automated scraper (/api/inventory/supplier-prices/sync) and weekly inflation detection cron.<br>• <strong>Price Radar (New Vendors)</strong>: Modal for registering and mapping alternative suppliers.<br>• <strong>Price Calibration</strong>: Calibrated Dec 2025 baseline prices from official Tech Pack.<br>• <strong>Orders & Uniforms</strong>: Eliminated PAR edit race conditions and guarded against string concatenation on order reception."
    },
    {
        "date": "19-Ago-2026",
        "time": "9:44 AM - 12:30 PM & 3:15 PM - 5:11 PM",
        "hours": 4.7,
        "badges": [
            "Actividades & Checklists",
            "Control de Uniformes & Caja Fuerte",
            "Radar de Precios COGS",
            "Basecamp Sync"
        ],
        "descEs": "• <strong>Actividades & Checklists (Auditoría Integral)</strong>: Auditoría exhaustiva paso a paso de AsignacionDiariaTab.tsx, ChecklistMode.tsx y ReportesChecklistTab.tsx, corrigiendo estados de carga y selectores de empleados.<br>• <strong>Control de Uniformes & Caja Fuerte</strong>: Conciliación de ventas en efectivo de uniformes con la bóveda de Caja Fuerte y reversión física en anulaciones.<br>• <strong>Radar de Precios & Food Cost</strong>: Conexión de precios de insumos con el cálculo automático de Food Cost y resolución de 17 observaciones de auditoría.<br>• <strong>Basecamp Sync</strong>: Estabilización de la sincronización de comentarios y documentos.",
        "descEn": "• <strong>Activities & Checklists (Full Audit)</strong>: Step-by-step audit of AsignacionDiariaTab.tsx, ChecklistMode.tsx, ReportesChecklistTab.tsx, fixing loading states and employee selectors.<br>• <strong>Uniforms & Safe Box</strong>: Reconciled cash uniform sales with Safe vault and automated stock reversal on voided transactions.<br>• <strong>Price Radar & Food Cost</strong>: Linked vendor ingredient prices to dynamic Food Cost recalculation and resolved 17 audit items.<br>• <strong>Basecamp Sync</strong>: Stabilized comments and documents synchronization."
    },
    {
        "date": "20-Ago-2026",
        "time": "6:15 AM - 9:30 AM & 8:00 PM - 11:44 PM",
        "hours": 6.98,
        "badges": [
            "Basecamp UX (Cards/List)",
            "MilesIQ (Gap Detector & Canonical Maps)",
            "Procedimientos Sorting"
        ],
        "descEs": "• <strong>Basecamp (Selector View as Cards / List)</strong>: Visualización de to-dos en cuadrícula moderna o lista compacta con avatares y conteo de comentarios.<br>• <strong>MilesIQ (Detector de Rutas Faltantes & Geofencing)</strong>: Banner inteligente \"Gap Detector\" que resalta viajes omitidos y sincronización canónica de coordenadas de las 15 tiendas con tacosgavilan.com.<br>• <strong>Procedimientos</strong>: Ordenamiento cronológico de fotos e inspecciones.<br>• <strong>Radar de Precios</strong>: Auditoría exhaustiva 35/35 de todas las recetas maestras de la cadena.",
        "descEn": "• <strong>Basecamp (Cards / List View Switcher)</strong>: Modern grid/list task views with avatars and comment counts.<br>• <strong>MilesIQ (Gap Detector & Canonical Maps)</strong>: Smart banner detecting missed trips and canonical geofence synchronization of all 15 stores from tacosgavilan.com.<br>• <strong>Procedures</strong>: Chronological sorting of inspection photos.<br>• <strong>Price Radar</strong>: 35/35 exhaustive audit on all master recipes."
    },
    {
        "date": "21-Ago-2026",
        "time": "6:09 AM - 8:30 AM & 11:30 AM - 1:45 PM & 4:30 PM - 5:30 PM & 7:15 PM - 9:30 PM",
        "hours": 7.85,
        "badges": [
            "Radar de Precios (Alertas & Scraper Viele v3)",
            "MilesIQ & Chatbot Overlap",
            "Descansos IA",
            "Basecamp 4"
        ],
        "descEs": "• <strong>Radar de Precios (Alertas Ejecutivas & Despacho a Directivos)</strong>: Diseño y programación de la plantilla HTML ejecutiva para alertas de fluctuaciones de precios de Viele & Sons. Despacho por correo a los 4 directivos (Roberto, Raquel, Gonzalo y Carlos) con métricas de impacto anual a nivel cadena ($ USD), enlaces directos a /admin/precios-proveedores y envío de correo oficial de presentación con PDF adjunto.<br>• <strong>Radar de Precios (Scraper Viele & Sons v3)</strong>: Blindaje del scraper de la API REST de Viele y manejo seguro de credenciales con fallback preventivo.<br>• <strong>MilesIQ & UI Chatbot</strong>: Reubicación del toast de actualizaciones a la parte inferior-central para evitar solapamientos con el botón flotante del asistente.<br>• <strong>Descansos IA (Motor de Aprendizaje)</strong>: Auditoría y optimización de sugerencias de breaks respetando la regla de salidas tempranas.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Modal flotante con desenfoque de fondo para visualización de tareas.",
        "descEn": "• <strong>Price Radar (Executive Alerts & Management Dispatch)</strong>: Designed and implemented executive HTML email template for Viele & Sons price changes. Deployed email dispatch to 4 directors (Roberto, Raquel, Gonzalo, Carlos) with annual chain-wide financial impact ($ USD), direct links to /admin/precios-proveedores, and sent official presentation email with attached PDF.<br>• <strong>Price Radar (Viele & Sons v3 Scraper)</strong>: Hardened Viele REST API scraper and secured credential handling.<br>• <strong>MilesIQ & Chatbot UI</strong>: Repositioned update toast to bottom-center to prevent floating chatbot button overlap.<br>• <strong>Breaks AI (Learning Engine)</strong>: Audited and refined break suggestions honoring early-departure manager rules.<br>• <strong>Basecamp 4 (Dialog Card Modal)</strong>: Floating modal with blurred backdrop for task viewing."
    },
    {
        "date": "22-Ago-2026",
        "time": "10:00 AM - 12:30 PM & 3:15 PM - 5:15 PM & 5:20 PM - 7:30 PM & 9:15 PM - 12:50 AM",
        "hours": 10.5,
        "badges": [
            "Ventas Toast API (Bell $8,332.64)",
            "Descansos IA Audit",
            "Uniformes Stock Mínimo",
            "MilesIQ GPS & Generated Columns",
            "Módulo Admin HTML",
            "Gantt Unificado"
        ],
        "descEs": "• <strong>Ventas (Toast API & Conciliación Bell $8,332.64)</strong>: Diagnóstico y resolución de discrepancia de ventas en Bell. Identificación de reembolsos de fechas cruzadas (Cross-Date Refunds de Party Trays) y soporte EBT para cuadre al centavo.<br>• <strong>Descansos Laborales (Auditoría Integral LÍNEA POR LÍNEA)</strong>: Corrección de solapamiento visual de popups en logs de descansos, blindaje del motor de pausas y auditoría de violaciones de California.<br>• <strong>Uniformes & Caja Fuerte</strong>: Auditoría y blindaje de la tabla de stock mínimo (660 registros en BD para las 15 tiendas) y conciliación del flujo de ventas en efectivo con la Caja Fuerte.<br>• <strong>MilesIQ Supervisores (GPS & Columnas Generadas)</strong>: Blindaje contra error fatal PostgreSQL 428C9 omitiendo columnas autocalculadas en payloads de inserción, optimización de interpolación de rutas y captura a 1 toque.<br>• <strong>Módulo Admin de Reportes HTML (/admin/reporte-actividades)</strong>: Creación del visor interactivo exclusivo para Administradores con pestañas dinámicas para alternar entre Junio, Julio y Agosto sin requerir PDFs estáticos.<br>• <strong>Unificación de Líneas de Tiempo Gantt</strong>: Recreación y sincronización de las pistas cronológicas (4:00 AM - 12:00 AM) para los 3 reportes mensuales con doble carril (Tienda Lynwood y Dev TEG).",
        "descEn": "• <strong>Sales (Toast API & Bell Reconciliation $8,332.64)</strong>: Solved Bell sales discrepancy by handling cross-date party tray refunds and EBT items.<br>• <strong>Labor Breaks (Full LINE-BY-LINE Audit)</strong>: Fixed visual tooltip overlap on lunch/break logs and automated CA meal break violation auditing.<br>• <strong>Uniforms & Safe Box</strong>: Audited and locked 660 minimum stock DB records across all 15 stores with cash sale reconciliation.<br>• <strong>MilesIQ (GPS & PostgreSQL Generated Columns)</strong>: Guarded against Postgres 428C9 error by omitting computed columns in insertion payloads, route gap optimization, and 1-tap logging.<br>• <strong>Admin HTML Reports Viewer (/admin/reporte-actividades)</strong>: Built interactive Admin-exclusive viewer with month switching tabs, eliminating static PDFs.<br>• <strong>Unified Gantt Timelines</strong>: Recreated and synced 4 AM - 12 AM dual-track schedules across all 3 monthly reports."
    },
    {
        "date": "23-Ago-2026",
        "time": "12:00 AM - 1:15 AM & 6:30 AM - 8:30 AM & 9:30 AM - 12:30 PM & 10:00 PM - 10:30 PM",
        "hours": 6.75,
        "badges": [
            "Preparador (Auditoría)",
            "Caja Fuerte (PST & Sync)",
            "Pedidos Bodega (PAR Lock)",
            "Checklists Temperaturas (≤40°F / ≥140°F)",
            "MilesIQ (Filtro Supervisores)",
            "Planificador Turnos Lynwood"
        ],
        "descEs": "• <strong>Preparador de Carne (Auditoría Forense Integral Línea por Línea)</strong>: Blindaje del acelerador intradía contra divisiones por cero, calibración de proyecciones por tramos y sincronización con tablets de cocina.<br>• <strong>Caja Fuerte & Bóveda</strong>: Corrección del cálculo de fechas en zona horaria PST (America/Los_Angeles), limpieza de manualOverride al resetear formulario y eliminación de condición de carrera asíncrona en conciliación con ventas de uniformes.<br>• <strong>Pedidos de Bodega & Insumos</strong>: Habilitación de edición de PAR en días bloqueados con reflejo en la semana siguiente y badge de estatus; auditoría exhaustiva de guardado parcial de estimates en QuickBooks.<br>• <strong>Checklists de Inocuidad y Temperaturas</strong>: Calibración reglamentaria de umbrales para refrigeración y barras frías (≤ 40°F) y mantenimiento caliente (≥ 140°F) con integración de estatus_manager.<br>• <strong>MilesIQ (Sincronización de Inspecciones & Filtro de Supervisores)</strong>: Filtrado estricto por supervisor activo y prevención de rutas redundantes.<br>• <strong>Planificador & Gantt</strong>: Conexión dinámica con Supabase para reflejar los 75 turnos exactos de Carlos Velazquez en Lynwood #14 y resolución del caso borde de medianoche en el Gantt.",
        "descEn": "• <strong>Prep Line (Comprehensive Line-by-Line Forensic Audit)</strong>: Hardened intraday accelerator against zero-division errors, calibrated period blocks, and synced kitchen tablets.<br>• <strong>Safe Management (PST Timezone & Race Conditions)</strong>: Fixed PST date calculations, cleared manualOverride on form resets, and resolved async race condition in uniform cash reconciliation.<br>• <strong>Bodega Orders & Warehouse PAR</strong>: Enabled PAR editing on locked days with next-week reflection and status badge; full audit of partial QuickBooks estimate saves.<br>• <strong>Food Safety & Temperature Checklists</strong>: Calibrated regulatory thresholds for cold holding (≤ 40°F) and hot holding (≥ 140°F), adding estatus_manager field.<br>• <strong>MilesIQ (Inspection Sync & Active Supervisor Filter)</strong>: Filtered active supervisors and prevented redundant multi-leg direct routes.<br>• <strong>Planner & Gantt Sync</strong>: Live connection to Supabase shifts table to display Carlos Velazquez's exact 75 Lynwood #14 General Manager shift schedules and resolved midnight wrap-around on Gantt ruler."
    },
    {
        "date": "24-Ago-2026",
        "time": "1:15 PM - 1:30 PM & 7:00 PM - 11:15 PM",
        "hours": 4.5,
        "badges": [
            "Ventas Reportes Auth",
            "RONOS HR API Conector",
            "Asistencia Biométrica & Mapeo",
            "Simplify Payroll Sync"
        ],
        "descEs": "• <strong>Ventas & Reportes Operativos</strong>: Corrección de autenticación y carga resiliente en reportes de ventas operativos y semanales.<br>• <strong>Módulo RONOS HR (Conector Oficial & Scraping Biométrico)</strong>: Creación de la arquitectura de conexión contra el portal de RONOS (lib/ronos-api.ts), autenticación segura y extracción de ponchadas de reloj, fotografías biométricas y turnos de empleados en las 15 tiendas.<br>• <strong>Asistencia & Violaciones</strong>: Detección automática de faltas, retardos, violaciones de lunch breaks bajo normativa de California y dobles descansos.<br>• <strong>Mapeo de Empleados</strong>: Motor de sincronización automática de perfiles entre RONOS, Toast POS y el Planificador de Tacos Gavilan.",
        "descEn": "• <strong>Sales & Operational Reports</strong>: Fixed authentication and resilient loading in daily and weekly sales dashboards.<br>• <strong>RONOS HR Module (Official Connector & Biometric Scraping)</strong>: Built core connection engine to RONOS portal (lib/ronos-api.ts), secure auth, and ingestion of clock-ins, biometric photos, and store punches across all 15 branches.<br>• <strong>Attendance & Violations</strong>: Automated detection of absences, tardiness, California meal break violations, and split lunches.<br>• <strong>Employee Mapping</strong>: Auto-mapping engine between RONOS, Toast POS, and Tacos Gavilan Shift Planner."
    },
    {
        "date": "25-Ago-2026",
        "time": "7:00 AM - 1:45 PM & 3:20 PM - 7:30 PM",
        "hours": 11,
        "badges": [
            "RONOS & Simplify Nómina",
            "Auditoría Invoices Cingular",
            "Markup % & Salarios Managers",
            "MilesIQ GPS Bugfix Rialto"
        ],
        "descEs": "• <strong>RONOS & Simplify (Motor de Conciliación de Nómina Cingular HR)</strong>: Algoritmo de cruce de Pay Rate vs Bill Rate y cálculo de margen de markup exacto (26.0% y 25.98%). Fórmulas de cálculo al centavo para salarios de General Managers y Supervisores, desglosando Sick Pay y Vacaciones ($3,033.40 para Carlos Velazquez en Lynwood).<br>• <strong>Auditoría de Facturas Reales PDF</strong>: Conciliación automatizada de facturas de Cingular HR para West Covina, Bell, Slauson, Lynwood y Broadway contra ponchadas reales de RONOS.<br>• <strong>Detección de Transferencias Multitienda</strong>: Algoritmo cronológico de detección de empleados transferidos entre sucursales (Adriana Reyes, Tiare Alor) según fecha de actividad.<br>• <strong>Caché Permanente en Supabase</strong>: Almacenamiento histórico en base de datos para carga instantánea de 2022 a la fecha.<br>• <strong>MilesIQ (Auditoría Línea por Línea & Bugfix Rialto)</strong>: Resolución de bloqueo en app de iPhone para supervisora Estefani al iniciar ruta en Rialto, auditoría de geofences y aislamiento de notificaciones push.",
        "descEn": "• <strong>RONOS & Simplify (Cingular HR Payroll Audit Engine)</strong>: Pay Rate vs Bill Rate matching engine and exact markup margin calculation (26.0% & 25.98%). Cent-perfect wage formulas for General Managers and Supervisors with Sick Pay & Vacation breakdown ($3,033.40 for Carlos Velazquez at Lynwood).<br>• <strong>Real PDF Invoice Auditing</strong>: Automated audit of Cingular HR invoices for West Covina, Bell, Slauson, Lynwood, and Broadway against real RONOS punches.<br>• <strong>Multi-Store Transfer Detector</strong>: Chronological employee transfer detector between branches based on punch activity dates.<br>• <strong>Permanent Supabase Cache</strong>: Database caching from 2022 to present for instant UI loading.<br>• <strong>MilesIQ (Line-by-Line Audit & Rialto Bugfix)</strong>: Resolved iPhone app flow lock for supervisor Estefani starting routes at Rialto, audited geofences, and isolated push alerts."
    },
    {
        "date": "26-Ago-2026",
        "time": "12:00 AM - 1:45 AM & 11:45 AM - 5:15 PM & 7:00 PM - 10:30 PM",
        "hours": 10.75,
        "badges": [
            "Radar Precios (Alertas Ahorro & Cron 5D)",
            "RONOS & Simplify Admin Creds",
            "Invoices Azusa y La Puente",
            "Viele Scraper Optimizado (1.15s)"
        ],
        "descEs": "• <strong>Radar de Precios (Alertas de Ahorro por Bajada de Precios & Cron 5 Días)</strong>: Implementación del sistema de alertas ejecutivas por correo ante bajadas de precios para resaltar ahorros directos para la empresa (petición de Roberto Velazquez). Configuración del cron de revisión automática a 5 días por semana (Lunes a Viernes 6:00 AM PST).<br>• <strong>Radar de Precios (Scraper Optimizado & Homologación de Códigos)</strong>: Optimización del scraper de la API de Viele con respuesta ultra-rápida (1.15s) y mapeo automático de códigos de reemplazo de insumos (EL4LID a KDL76PP).<br>• <strong>RONOS & Simplify (Credenciales Administrativas & Extracción Batch)</strong>: Conexión con credenciales administrativas corporativas para extracción masiva de perfiles, salarios reales de supervisores/gerentes y paystubs históricos.<br>• <strong>Auditoría de Invoices Multitienda</strong>: Conciliación matemática de facturas PDF de Cingular HR para las sucursales de Azusa (invoice-TEGA-0009.pdf) y La Puente (invoice-TEGL-0022.pdf).",
        "descEn": "• <strong>Price Radar (Savings Alerts on Price Drops & 5-Day Cron)</strong>: Implemented executive email alerts for price decreases to highlight company savings (requested by Roberto Velazquez). Configured automated cron to run 5 days a week (Mon-Fri 6:00 AM PST).<br>• <strong>Price Radar (Optimized Scraper & Item Code Remapping)</strong>: Accelerated Viele API live scraper to 1.15s response time and remapped vendor replacement codes (EL4LID to KDL76PP).<br>• <strong>RONOS & Simplify (Admin Credentials & Batch Extraction)</strong>: Integrated corporate admin credentials for bulk extraction of employee master profiles, active supervisor/manager salaries, and historical paystubs.<br>• <strong>Multi-Store Invoice Auditing</strong>: Cent-perfect mathematical reconciliation of Cingular HR PDF invoices for Azusa (invoice-TEGA-0009.pdf) and La Puente (invoice-TEGL-0022.pdf)."
    },
    {
        "date": "27-Ago-2026",
        "time": "5:30 AM - 8:45 AM & 5:30 PM - 11:45 PM",
        "hours": 9.5,
        "badges": [
            "RONOS Motor Invoices 16 Tiendas",
            "La Bodega Horas & Nómina",
            "Simplify Bugfixes & Resiliencia",
            "Rediseño UI Pestañas RONOS"
        ],
        "descEs": "• <strong>RONOS & Simplify (Motor de Pre-Cálculo de Invoices a Nivel Cadena)</strong>: Algoritmo automatizado para pre-calcular las facturas quincenales de las 16 sucursales (incluyendo La Bodega) antes de la emisión de Cingular HR, contrastando punches reales contra nómina procesada.<br>• <strong>La Bodega (Horas & Personal)</strong>: Integración de personal de almacén central y resolución de fórmulas de cálculo para personal con esquemas especiales.<br>• <strong>Auditoría Integral Línea por Línea</strong>: Auditoría exhaustiva de app/admin/ronos/page.tsx (2,728 líneas), lib/simplifyhr-api.ts (843 líneas) y lib/ronos-api.ts (1,006 líneas), eliminando fallos en runtime por propiedades nulas.<br>• <strong>Rediseño UI & Usabilidad</strong>: Simplificación de la interfaz visual de RONOS, modernización del sistema de navegación por pestañas y clarificación de métricas de cumplimiento de descansos.",
        "descEn": "• <strong>RONOS & Simplify (Chain-Wide Invoice Pre-Calculation Engine)</strong>: Automated algorithm to pre-calculate bi-weekly invoices across all 16 locations (including Warehouse) prior to Cingular HR billing, benchmarking actual punches against payroll.<br>• <strong>Warehouse (Staff & Hours)</strong>: Integrated central warehouse staff and resolved specialized pay calculations.<br>• <strong>Comprehensive Line-by-Line Audit</strong>: Full audit of app/admin/ronos/page.tsx (2,728 lines), lib/simplifyhr-api.ts (843 lines), and lib/ronos-api.ts (1,006 lines), eliminating runtime null crashes.<br>• <strong>UI Redesign & Usability</strong>: Streamlined RONOS visual interface, modern tab navigation, and clear break compliance metrics."
    },
    {
        "date": "28-Ago-2026",
        "time": "12:30 AM - 1:30 AM & 6:30 AM - 10:15 AM",
        "hours": 4.75,
        "badges": [
            "MilesIQ Auditoría Línea por Línea",
            "Validación Decimales Millas",
            "Null-Safety Blindaje Total",
            "Estabilidad RONOS & Simplify"
        ],
        "descEs": "• <strong>MilesIQ (Auditoría Forense Integral Línea por Línea)</strong>: Auditoría profunda de TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, endpoints de API (/api/miles) y lógica de geofencing, blindando todos los escenarios de registro de viajes.<br>• <strong>MilesIQ (Validación de Decimales & Round-Trip)</strong>: Corrección de validación de decimales (step 0.01) en captura de millas y duplicación automática de distancia en viajes redondos (Round-Trip).<br>• <strong>RONOS & Simplify (Blindaje Null-Safety Extremo)</strong>: Aplicación de 73 protecciones null-safe completas en lib/payroll-calculator.ts (978 líneas), lib/ronos-api.ts (1,262 líneas) y app/admin/ronos/page.tsx (2,756 líneas), aprobando el 100% de los smoke tests en runtime.",
        "descEn": "• <strong>MilesIQ (Comprehensive Line-by-Line Forensic Audit)</strong>: Deep audit across TripModal.tsx, SupervisorAutoTracker.tsx, QuickDriveModal.tsx, API routes (/api/miles), and geofencing logic, securing all trip capture scenarios.<br>• <strong>MilesIQ (Decimal Validation & Round-Trip Calculation)</strong>: Fixed 2-decimal step validation in trip logging and automated round-trip distance doubling.<br>• <strong>RONOS & Simplify (Total Null-Safety Hardening)</strong>: Applied 73 null-safe guards across lib/payroll-calculator.ts (978 lines), lib/ronos-api.ts (1,262 lines), and app/admin/ronos/page.tsx (2,756 lines), passing 100% of runtime smoke tests."
    },
    {
        "date": "29-Ago-2026",
        "time": "—",
        "hours": 0,
        "badges": [
            "Descanso Operativo"
        ],
        "descEs": "• <strong>Día de Descanso Operativo (Programación)</strong>: Turno presencial en tienda Lynwood #14 (2:00 PM - 9:00 PM). Sin actividad de desarrollo en el sistema.",
        "descEn": "• <strong>Operational Rest Day (Development)</strong>: In-store manager shift at Lynwood #14 (2:00 PM - 9:00 PM). No system development activity."
    },
    {
        "date": "30-Ago-2026",
        "time": "—",
        "hours": 0,
        "badges": [
            "Descanso Operativo"
        ],
        "descEs": "• <strong>Día de Descanso Operativo (Programación)</strong>: Turno presencial en tienda Lynwood #14 (2:00 PM - 7:00 PM). Sin actividad de desarrollo en el sistema.",
        "descEn": "• <strong>Operational Rest Day (Development)</strong>: In-store manager shift at Lynwood #14 (2:00 PM - 7:00 PM). No system development activity."
    },
    {
        "date": "31-Ago-2026",
        "time": "12:45 PM - 1:30 PM & 7:45 PM - 11:30 PM",
        "hours": 5,
        "badges": [
            "Radar Precios Auto-Aprobación",
            "Protección Food Cost Histórico",
            "Cron Viele 6:00 AM PST",
            "Preparador KDS Despertar",
            "MilesIQ Respaldo Pruebas"
        ],
        "descEs": "• <strong>Radar de Precios & Cron (Auto-Aprobación & Protección de Food Cost Histórico)</strong>: Blindaje de la sincronización de QuickBooks para no sobreescribir insumos externos (is_bodega: false). Auto-aprobación automática de precios de Viele en inventory_items e inventory_price_history al dispararse el cron diario (6:00 AM PST), invalidando la caché de Food Cost actual sin alterar los históricos de fechas pasadas.<br>• <strong>Plantilla Ejecutiva de Correo</strong>: Rediseño limpio en 5 columnas con fecha del último precio aprobado (lastApprovedDate) y cálculo de impacto financiero anual a nivel cadena.<br>• <strong>Preparador de Carne (Botón Despertar Tableta & Auto-Actualización 24/7)</strong>: Botón de inicio de turno para sincronización en 1 toque y auto-cambio de día comercial (6:00 AM) sin recarga manual.<br>• <strong>MilesIQ</strong>: Respaldo y depuración de recorridos de prueba de Ricardo y Estefani antes del arranque oficial del 1 de septiembre.<br>• <strong>Cierre Definitivo Agosto 2026</strong>: Consolidación final del informe mensual oficial con 154.50 horas de desarrollo auditadas y 27 tareas canonicales del sistema.",
        "descEn": "• <strong>Price Radar & Cron (Auto-Approval & Historical Food Cost Protection)</strong>: Guarded QuickBooks sync from overwriting non-bodega vendor items. Enabled automatic price auto-approval in inventory_items and inventory_price_history upon daily 6:00 AM PST cron execution, refreshing current food cost cache while strictly preserving historical food cost integrity.<br>• <strong>Executive Email Template</strong>: Clean 5-column layout with last approved price date (lastApprovedDate) and annual chain-wide financial impact.<br>• <strong>Prep Line (Wake Tablet Button & 24/7 KDS Auto-Sync)</strong>: 1-tap shift start sync button and seamless 6:00 AM business day rollover without manual page reloads.<br>• <strong>MilesIQ</strong>: Backed up and purged August testing trips for Ricardo and Estefani ahead of official Sept 1 launch.<br>• <strong>August 2026 Final Close</strong>: Final consolidation of official monthly report with 154.50 audited dev hours and 27 canonical system tasks."
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
        { module: 'Drive-Thru Telemetría & Tiempos en Vivo', hours: 85.0 },
        { module: 'Clon de Basecamp 3 & Mensajería Interna', hours: 42.0 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 28.5 },
        { module: 'Preparador de Carne y Cocina KDS', hours: 18.0 },
        { module: 'Mantenimiento General y Soporte Técnico', hours: 17.0 }
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
        { title: 'Pruebas en Sucursal/Local', hours: 18.0, desc: 'Pruebas en restaurante Lynwood de las vistas de tableta KDS y validación de aperturas/cierres en Caja Fuerte.' },
        { title: 'Monitoreo DB y APIs', hours: 6.0, desc: 'Verificación continua de sincronizaciones automáticas de QuickBooks y endpoints de Google Maps para las 15 tiendas.' },
        { title: 'Planificación y Diseño', hours: 4.0, desc: 'Diseño de arquitectura para el módulo de Control de Uniformes y especificaciones de TV Menús digitales.' }
    ],
    effortSummary: [
        { module: 'Preparador de Carne y Cocina KDS', hours: 38.5 },
        { module: 'Inventario, Pedidos y Sincronización QuickBooks', hours: 26.0 },
        { module: 'Actividades, Planificador y Horarios', hours: 18.0 },
        { module: 'Clon y Sincronizador de Basecamp', hours: 14.0 },
        { module: 'Procedimientos, Fotos e Inspecciones', hours: 8.5 },
        { module: 'Mantenimiento General y Soporte Técnico', hours: 12.8 }
    ],
    taskCardsHtml: renderTab2ForMonth(julyTasks, 'Julio 2026')
};

// AUGUST CONFIG: 27 tasks (16 Completadas, 8 En Progreso, 3 Pendientes)
const augustConfig = {
    monthName: 'Agosto',
    monthYear: 'Agosto 2026',
    monthNum: 8,
    totalTasks: 27,
    completedTasks: 16,
    inProgressTasks: 8,
    pendingTasks: 3,
    totalHours: 154.50,
    rows: augustRows,
    parallelActivities: [
        { title: 'Pruebas en Sucursal/Local', hours: 3.0, desc: 'Testing en cocina del modo tableta kiosko del Preparador, validación de sincronización PC-Tableta y geofencing de MilesIQ en las 15 tiendas.' },
        { title: 'Monitoreo DB y APIs', hours: 2.5, desc: 'Auditoría de API v3 Viele & Sons (Radar de Precios), endpoints de conciliación de Ventas Toast y cálculo IRS de millas.' },
        { title: 'Planificación y Diseño', hours: 1.5, desc: 'Arquitectura de Tech Packs para uniformes, diseño del acelerador intradía de carne y estructura de las 27 tareas oficiales.' }
    ],
    effortSummary: [
        {
                "module": "Módulo RONOS HR & Simplify Payroll Audit",
                "hours": 28.5
        },
        {
                "module": "Preparador de Carne y Cocina KDS",
                "hours": 28.25
        },
        {
                "module": "MilesIQ Supervisores & Geofencing GPS",
                "hours": 23.5
        },
        {
                "module": "Ventas Toast API & Conciliación Multitienda",
                "hours": 18.5
        },
        {
                "module": "Radar de Precios Viele v3, Scraper & Alertas de Ahorro",
                "hours": 16.75
        },
        {
                "module": "Mantenimiento General, Crons y Reportes",
                "hours": 14
        },
        {
                "module": "Control de Uniformes & Caja Fuerte",
                "hours": 12.5
        },
        {
                "module": "Descansos Laborales (Labor Compliance AI)",
                "hours": 12.5
        }
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
