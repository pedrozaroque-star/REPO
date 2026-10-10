# Tacos Gavilan


## 📊 1. Ventas y Telemetría en Tiempo Real

- `[     ]` **1. Dashboard Ejecutivo Principal (`/dashboard`)**: Tablero central con métricas clave en vivo: ventas acumuladas del día por Toast POS, alertas de sucursales, pedidos y accesos rápidos a herramientas.
- `[     ]` **2. Radar de Ventas en Vivo (`/ventas`)**: Análisis minuto a minuto de ventas netas, comparativos por hora contra semanas anteriores y desglose por canal (Comedor, Para Llevar, Drive-Thru, Delivery).
- `[     ]` **3. Historial de Ventas por Tienda (`/ventas/historial`)**: Consulta y análisis de históricos de venta por fechas pasadas, rangos mensuales y sucursales individuales para auditoría y comparaciones.
- `[     ]` **4. Reportes Financieros Consolidados de Ventas (`/ventas/reportes`)**: Reportes consolidados de ventas netas, ventas brutas, canales de entrega, impuestos recaudados, propinas y métodos de pago de todas las tiendas.
- `[     ]` **5. Auditoría de Descuentos y Cortesías POS (`/admin/auditoria-descuentos`)**: Auditoría detallada de descuentos aplicados en terminales Toast: cortesías de gerencia (Comps), promociones, cancelaciones y control de mermas financieras.
- `[     ]` **6. Telemetría y Tiempos de Drive-Thru (`/drive-thru`)**: Métricas de velocidad de servicio en ventanilla de auto-servicio, tiempos de espera por automóvil, cuellos de botella y ranking comparativo entre sucursales.
- `[     ]` **7. Tablero de Pedidos Listos para Clientes (`/order-ready-board`)**: Pantalla pública para comedor con visualización de pedidos en preparación y pedidos listos para recoger, complementada con locutor de voz automático.
- `[     ]` **8. Pantalla TV Kiosko de Tienda (`/tv`)**: Modo de pantalla completa para televisores instalados en sucursal que proyecta totales de ventas acumuladas, metas diarias e indicadores operativos.
- `[     ]` **9. Sistema de Pantallas y KDS por Tienda (`/t/[screen]/[store]`)**: Pantallas dinámicas por sucursal que sirven como visualizadores de cocina (KDS), pantallas de entrega en mostrador y monitores de despacho en ventanilla.

---

## 💵 2. Finanzas, Contabilidad y Nómina

- `[     ]` **10. Estado de Resultados P&L Multi-Sucursal (`/admin/pnl`)**: Estado de Pérdidas y Ganancias (Profit & Loss) multi-sucursal comparativo lado a lado de las 15 tiendas, con eliminación automática de transacciones intercompañía.
- `[     ]` **11. Pólizas Contables de Ventas Diarias Cohesion (`/contabilidad`)**: Generación de pólizas de diario de ventas para QuickBooks Online por tienda y día laboral, sustituyendo el software externo Cohesion ($450/mes).
- `[     ]` **12. Auditoría de Paquetes Contables Semanales (`/contabilidad/[packetId]`)**: Revisión exhaustiva semanal de journals contables, cruces de efectivo, depósitos bancarios, comisiones de apps externas y cuadre al centavo antes de enviar a QuickBooks.
- `[     ]` **13. Configuración y Mapeo de Cuentas Contables (`/contabilidad/configuracion`)**: Catálogo de mapeo de códigos de cuenta de mayor en QuickBooks Online para ingresos por alimentos, bebidas, pasivos por impuestos, propinas y bancos.
- `[     ]` **14. Generador y Sincronizador de Bills en QuickBooks (`/admin/crear-bills`)**: Sincronización y creación automática de facturas de compra (Bills) en QuickBooks Online a partir de las facturas internas emitidas por Bodega Central a las tiendas.
- `[     ]` **15. Arqueo de Bóveda y Caja Fuerte (`/caja-fuerte`)**: Control y auditoría de la caja fuerte de cada tienda: conteo de fajos de billetes, rollos de monedas, fondo de cambio y conciliación de efectivo por venta de uniformes.
- `[     ]` **16. Control y Reembolso de Millaje de Supervisores (`/miles`)**: Bitácora de traslados vehiculares entre sucursales de supervisores de zona, cálculo de reembolso según tarifa oficial por milla y exportación a nómina de RRHH.

---

## 📦 3. Inventario, Costos y Compras de Bodega

- `[     ]` **17. Panel Central de Inventario (`/inventory`)**: Visión ejecutiva de existencias, valuación de inventario en bodega y tiendas, alertas de insumos con stock crítico y movimientos de producto.
- `[     ]` **18. Pedido Diario de Tiendas a Bodega Central (`/inventory/orders`)**: Motor algorítmico que calcula la orden de abastecimiento sugerida a cada tienda según ventas de los últimos 7 días y stock mínimo, con envío directo a QuickBooks.
- `[     ]` **19. Hoja Imprimible de Pedido Diario (`/inventory/orders/print-sheet`)**: Formato físico imprimible para que los gerentes anoten conteos en refrigeradores y almacenes antes de capturar el pedido diario.
- `[     ]` **20. Módulo de Compras Viele & Sons (`/admin/compras/viele`)**: Conteo semanal de desechables y abarrotes de tiendas, cálculo de orden de compra sugerida y exportación o checkout directo en el portal de Viele & Sons (Sage 100).
- `[     ]` **21. Historial de Compras Viele & Sons (`/admin/compras/viele/historial`)**: Registro histórico de pedidos semanales enviados al proveedor Viele & Sons, montos facturados y comparación de consumos por tienda.
- `[     ]` **22. Hoja de Conteo Físico Viele & Sons (`/admin/compras/viele/print-sheet`)**: Hoja estandarizada de conteo físico para bodega y almacén de tienda, agrupada por familias de empaques (vasos, charolas, bolsas, servilletas).
- `[     ]` **23. Control y Despacho de Uniformes (`/inventory/uniforms`)**: Control de inventario de uniformes (camisas, mandiles, gorras) por talla y color, registro de paquetes entregados a empleados nuevos y ventas descontadas por nómina o pagadas.
- `[     ]` **24. Food Cost y Márgenes de Menú (`/admin/food-cost`)**: Análisis integral del costo porcentual de alimentos (Food Cost %) por sucursal, rendimiento de compras y margen de utilidad bruta global.
- `[     ]` **25. Food Cost Detallado por Sucursal (`/admin/food-cost/[storeId]`)**: Desglose a nivel tienda de consumo real de carnes, abarrotes y lácteos contra la venta registrada en Toast, identificando sobrecostos o mermas.
- `[     ]` **26. Rendimiento y Merma de Carnes en Parrilla (`/admin/food-cost/meats`)**: Seguimiento especializado de libras de carne cruda entregadas a la tienda vs carne cocinada vendida, calculando el factor de encogimiento y merma por cocción.
- `[     ]` **27. Varianza de Insumos Teórico vs Real (`/admin/food-cost/varianza`)**: Auditoría que compara la cantidad de producto que debió consumirse según recetas teóricas contra las salidas reales de almacén para detectar pérdidas o porciones excesivas.
- `[     ]` **28. Radar de Precios de Proveedores Externos (`/admin/precios-proveedores`)**: Ingesta y comparación de listas de precios de empacadoras y distribuidores, detectando aumentos súbitos en carnes, aguacate, queso y desechables.
- `[     ]` **29. Catálogo Maestro de Insumos de Bodega (`/inventory/items`)**: Padrón de ingredientes y materias primas con claves de compra, costo unitario de proveedor, empaques (cajas, sacos, bidones) y conversión a unidades de cocina.
- `[     ]` **30. Fichas Técnicas e Ingeniería de Menú (`/inventory/menu`)**: Diseño de recetas teóricas para cada platillo del menú (tacos, burritos, quesadillas, aguas), especificando gramos/onzas exactas de cada ingrediente.
- `[     ]` **31. Costos y Márgenes por Platillo (`/inventory/costs`)**: Análisis de margen de ganancia por ítem del menú según precios actualizados de insumos en QuickBooks, evaluando precios de venta al público.

---

## 🥩 4. Preparación de Carne y Cocina (Preparador / Pace)

- `[     ]` **32. Ritmo de Cocción de Parrilla (Cooking Pace) (`/inventory/preparador`)**: Proyección inteligente de libras de carne cruda (Asada, Pastor, Pollo, Cabeza, Lengua) que el parrillero debe tirar a la plancha por bloques de 30 minutos o por tramos de turno.
- `[     ]` **33. Modo Kiosko de Tableta para Cocina (`/inventory/preparador/bodega`)**: Interfaz táctil de pantalla completa y números gigantes para la tableta de cocina, con bloqueo de edición accidental para uso rudo de los cocineros.
- `[     ]` **34. Programación Manual Semanal de Carne (`/inventory/preparador/tabla`)**: Tabla donde gerentes o supervisores configuran proyecciones manuales fijas de carne por día y hora para tiendas sin histórico suficiente o eventos extraordinarios.

---

## 👥 5. Personal, Horarios, RONOS y Descansos

- `[     ]` **35. Programación Semanal de Horarios de Tienda (`/horarios`)**: Editor semanal de turnos de empleados por posición (cajera, parrillero, cocinero, lavaplatos), validando cobertura por turno y costo proyectado de labor.
- `[     ]` **36. Planificador de Demanda y Ventas Semanales (`/planificador`)**: Herramienta de proyección de ventas e ingresos por tienda y día de la semana para definir la plantilla de personal y horas de labor necesarias.
- `[     ]` **37. Impresión de Hojas de Horario y Planificación (`/planificador/imprimir`)**: Vista optimizada para imprimir en papel los horarios semanales aprobados y colocarlos en el tablero de anuncios de la cocina para los empleados.
- `[     ]` **38. Portal de Autoservicio del Empleado (Mi Horario) (`/mis-horarios`)**: Portal móvil para que cada empleado consulte desde su celular los turnos que tiene asignados en la semana y su historial de asistencia.
- `[     ]` **39. Generador Automático de Horarios con IA (Auto-Schedule) (`/gestion/auto-schedule`)**: Algoritmo con inteligencia artificial que genera automáticamente la propuesta de horario semanal optimizando horas según la curva de ventas proyectada.
- `[     ]` **40. Control de Descansos e Infracciones de Comida (`/descansos`)**: Programación y auditoría de turnos de comida (Lunch Breaks) para cumplir la ley laboral de California y evitar multas de 1 hora de sueldo por retraso.
- `[     ]` **41. Auditoría de Ponchadas y Reloj Checador (RONOS) (`/admin/ronos`)**: Auditoría en vivo de ponchadas sincronizadas desde Toast POS: fotos tomadas al ponchar para evitar suplantaciones y monitoreo de penalizaciones con Cingular HR.

---

## 📋 6. Operaciones de Tienda, Checklists y Procedimientos

- `[     ]` **42. Panel de Checklists Operativos de Tienda (`/checklists`)**: Hub principal de checklists para asistentes de gerencia y personal de tienda con acceso a aperturas, cierres, rutinas de día y recorridos.
- `[     ]` **43. Checklist de Apertura de Tienda (`/checklists/crear/apertura`)**: Verificación matutina obligatoria de encendido de freidoras, vaporeras, mesas frías, limpieza de comedor y preparación de línea antes de abrir puertas.
- `[     ]` **44. Checklist de Cierre Nocturno de Tienda (`/checklists/crear/cierre`)**: Protocolo nocturno de apagado de gas, lavado a profundidad de parrillas y pisos, guardado de carnes, resguardo de valores y activación de alarmas.
- `[     ]` **45. Checklist de Rutinas Diarias (`/checklists/crear/daily`)**: Lista de tareas intermedias durante el turno: reposición de salsas, cambio de trapos desinfectantes, vaciado de basura y limpieza de baños.
- `[     ]` **46. Checklist de Turno Gerencial (`/checklists/crear/manager`)**: Checklist exclusivo para el gerente en turno: arqueo parcial de cajas, chequeo de presentación de empleados y revisión de velocidad en cocina.
- `[     ]` **47. Checklist de Recorrido Sanitario y Servicio (`/checklists/crear/recorrido`)**: Ronda de inspección ocular por estacionamiento, mesas de comensales, barra de salsas, cocina y almacén con calificación de estado.
- `[     ]` **48. Conteo de Sobrantes de Comida al Cierre (`/checklists/crear/sobrante`)**: Registro físico obligatorio de libras de carne sobrante, botes de salsa, frijol y arroz al terminar el día para el cálculo de consumo real.
- `[     ]` **49. Bitácora Sanitaria de Temperaturas (`/checklists/crear/temperaturas`)**: Registro sanitario de grados de temperatura en mesas frías, vitrinas de carnes, congeladores y carnes cocinadas para cumplimiento con Salubridad.
- `[     ]` **50. Edición y Corrección de Checklists Operativos (`/checklists/editar/[tipo]/[id]`)**: Módulo que permite a supervisores o gerentes autorizados corregir o complementar capturas de checklists antes de su archivo definitivo.
- `[     ]` **51. Visualizador de Detalle de Checklists (`/checklists/ver/[id]`)**: Pantalla de lectura completa del checklist respondido con respuestas marcadas, observaciones, hora exacta de envío y firmas digitales.
- `[     ]` **52. Tablero de Checklists Gerenciales (`/checklists-manager`)**: Panel directivo para supervisores de zona donde revisan, aprueban o rechazan los checklists enviados por los gerentes de cada restaurante.
- `[     ]` **53. Captura de Nuevo Checklist Gerencial (`/checklists-manager/crear`)**: Formulario especializado para que el gerente registre el estado global de la tienda, cumplimiento de estándares y novedades del turno.
- `[     ]` **54. Edición de Checklist Gerencial (`/checklists-manager/editar/[id]`)**: Ajuste y resolución de observaciones anotadas en un checklist de gerente antes de su firma final por supervisión.
- `[     ]` **55. Visualizador de Checklist Gerencial (`/checklists-manager/ver/[id]`)**: Expediente de consulta para directores con la evaluación gerencial de la sucursal, porcentaje de cumplimiento y comentarios de turno.
- `[     ]` **56. Diseñador de Plantillas de Checklists (`/admin/plantillas`)**: Herramienta administrativa para crear nuevas plantillas de checklists o modificar las existentes agregando o quitando preguntas y secciones.
- `[     ]` **57. Editor de Preguntas de Plantillas (`/admin/plantillas/[id]`)**: Configuración específica de ponderación de puntos, tipo de respuesta (Sí/No, Numérico, Foto obligatoria, Texto) en cada reactivo de checklist.
- `[     ]` **58. Auditorías de Calidad e Inspecciones con Fotos Móviles (`/inspecciones`)**: Tablero de auditorías operativas realizadas por supervisores de zona con evaluación de higiene, servicio, cocina y fotos de evidencia.
- `[     ]` **59. Nueva Inspección con Cámara Móvil (`/inspecciones/nueva`)**: Formulario móvil para auditorías en campo donde el supervisor toma fotos en tiempo real de áreas sucias, alimentos mal rotulados o fallas de servicio.
- `[     ]` **60. Seguimiento de Hallazgos de Inspección (`/inspecciones/editar/[id]`)**: Monitoreo de no-conformidades detectadas en la inspección para dar seguimiento hasta que el gerente de tienda demuestre la corrección.
- `[     ]` **61. Módulo de Actividades y Procedimientos por Puesto (`/actividades`)**: Módulo central que gestiona el catálogo maestro de actividades operativas de la tienda, su mapeo a puestos de trabajo (Parrillero, Cocinero, Cajera, Lavalozas, Gerente) por turno AM/PM, asignación diaria de personal a posiciones y checklist interactivo en tableta. **Requiere perfeccionar el catálogo de actividades a realizar y redactar la descripción detallada paso a paso de cada una.**
- `[     ]` **62. Manuales de Procedimientos y Guías de Cocina (`/procedimientos/imprimir`)**: Biblioteca de consulta e impresión de manuales de procedimientos operativos estándar (SOP), desinfección, lavado de manos y preparación de salsas.
- `[     ]` **63. Minutas y Acuerdos de Juntas Gerenciales (`/reunion`)**: Registro digital de minutas de juntas semanales de gerentes, acuerdos pactados, fechas compromiso de entrega y seguimiento a directores de área.
- `[     ]` **64. Comunicación y Casos Corporativos en Basecamp 3 (`/basecamp`)**: Integración bidireccional que conecta avisos generales de la empresa, mensajes corporativos y casos de soporte operativo directo con Basecamp 3.

---

## ⭐ 7. Clientes, Satisfacción y Menús Digitales

- `[     ]` **65. Evaluación de Desempeño de Personal con Gafetes QR (`/evaluacion`)**: Tablero analítico de satisfacción donde se miden las calificaciones que los clientes otorgan a cajeras y personal escaneando los stickers QR de sus gafetes.
- `[     ]` **66. Kiosko de Calificación en Mostrador (`/evaluacion/kiosk`)**: Pantalla táctil instalada junto a la caja de cobro para que los clientes califiquen en segundos la amabilidad, limpieza y rapidez de su experiencia.
- `[     ]` **67. Buzón Administrativo de Feedback de Clientes (`/feedback`)**: Bandeja de entrada central de quejas, reclamos y felicitaciones enviadas por comensales, con herramientas para que supervisión resuelva el caso.
- `[     ]` **68. Registro Manual de Feedback (`/feedback/nuevo`)**: Formulario para que gerentes capturen incidencias expresadas verbalmente por clientes en el restaurante o recibidas por llamada telefónica.
- `[     ]` **69. Portal Público de Sugerencias de Clientes (`/feedback-publico`)**: Página web abierta para clientes que permite enviar comentarios, subir fotografías de su ticket o comida y calificar a la sucursal visitada.
- `[     ]` **70. Configuración de Terminales de Opinión en Tienda (`/clientes`)**: Panel de vinculación y administración de tabletas de opinión física y códigos QR de encuestas asignados a cada restaurante.
- `[     ]` **71. Gestor de Menús Digitales en Pantallas TV (`/admin/tv-menus`)**: Administración de tableros de menú en pantallas de comedor: edición de precios, fotos de platillos, promociones temporales y productos agotados.

---

## ⚙️ 8. Administración General, Seguridad y Configuración

- `[     ]` **72. Directorio Maestro y Geolocalización de Tiendas (`/tiendas`)**: Padrón de las 15 sucursales de Tacos Gavilan: direcciones físicas, coordenadas GPS, números de teléfono, gerentes a cargo y Toast Store IDs.
- `[     ]` **73. Administración de Usuarios, Roles y Permisos (`/usuarios`)**: Control de cuentas de acceso al sistema, asignación de roles (Administrador, Supervisor, Gerente, Asistente) y vinculación a tiendas autorizadas.
- `[     ]` **74. Panel Central de Administración General (`/admin`)**: Acceso raíz para directores con accesos directos a P&L, creación de facturas, auditoría de descuentos, plantillas y herramientas directivas.
- `[     ]` **75. Configuración Corporativa del Sistema (`/configuracion`)**: Parámetros corporativos globales: definición de jornada laboral (6:00 AM a 5:59 AM), inicio de turno PM (5:00 PM) e integraciones de servidor.
- `[     ]` **76. Buscador Global del Sistema (`/buscar`)**: Motor de búsqueda unificada para localizar rápidamente empleados, números de orden, recetas, insumos, tiendas o registros en segundos.
- `[     ]` **77. Monitor de Salud del Sistema y Cron Jobs (`/admin/salud-sistema`)**: Observabilidad técnica en tiempo real: estado de crons automáticos (ventas, labor, costos), monitoreo de APIs externas y uso de base de datos Supabase vs Spend Cap.
- `[     ]` **78. Bitácora Ejecutiva de Horas y Desarrollo (`/admin/reporte-actividades`)**: Componente nativo en TSX que consolida y grafica las horas de desarrollo trabajadas, con desglose bilingüe, filtros por módulo y cronograma visual Gantt 24h.

---

## 🚀 9. Aplicaciones Digitales Externas y Proyectos Satélite

- `[     ]` **79. Aplicación Móvil Oficial para Clientes (iOS & Android)**: Aplicación descargable desarrollada en Expo / React Native para clientes de Tacos Gavilan: catálogo interactivo, pedidos anticipados para recoger, geolocalización de sucursales, programa de lealtad y promociones.
- `[     ]` **80. Sitio Web Oficial Corporativo (tacosgavilan.com)**: Plataforma web de la marca con menú interactivo con fotos y precios, historia de la empresa, localizador GPS de restaurantes, pedidos en línea para recoger, bolsa de trabajo y formulario de contacto.
- `[     ]` **81. Registro de Actividades de Proveedores de Servicio y/o Mantenimiento**: Módulo de bitácora y seguimiento para técnicos externos (refrigeración, freidoras, parrillas, trampas de grasa, plomería, HVAC) con estatus de caso (abierto, en proceso, concluido) y captura obligatoria de evidencia fotográfica del antes y después de cada reparación.
- `[     ]` **82. Respaldo Automático de Base de Datos y Plan de Contingencia**: Programación de copias de seguridad diarias de Supabase con prueba de restauración periódica para blindar toda la información del negocio ante contingencias.
- `[     ]` **83. Burbuja Flotante de Asistente IA en Pantallas**: Botón interactivo flotante en todas las pantallas del sistema para que gerentes resuelvan dudas de procedimientos, recetas o soporte técnico con respuestas guiadas por IA.
- `[     ]` **84. Encuestas de Satisfacción en Tickets de Toast POS**: Impresión de código QR en el ticket impreso del cliente para medir satisfacción sobre calidad del producto, tiempo de entrega y servicio recibido.
