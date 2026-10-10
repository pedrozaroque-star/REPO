# Prompt maestro para Antigravity — App propia Tacos Gavilan

Fecha de inicio del plan: jueves 8 de octubre de 2026. Zona horaria operativa: America/Los_Angeles.

## 1. Encargo y decisión del propietario

Quiero que continúes el desarrollo de una aplicación propia de Tacos Gavilan para clientes, descargable desde Apple App Store y Google Play. Hemos elegido explícitamente la opción de una app personalizada, desarrollada por nuestro equipo, con experiencia y diseño propios. La propiedad del código, cuentas de publicación, dominio, infraestructura, certificados y accesos debe corresponder a Tacos Gavilan.

El objetivo es una experiencia de calidad comparable a Mendocino Farms: fácil de entender, rápida para ordenar y consistente desde la selección de sucursal hasta la entrega. Usa esa referencia para estudiar usabilidad, navegación y operación; crea una expresión original de Tacos Gavilan. No copies su marca, contenido, imágenes ni afirmes haber explorado su aplicación instalada si solamente consultaste capturas o su sitio web.

La app tendrá dos opciones principales de compra: PICKUP y DELIVERY. Pickup debe ingresar al POS/KDS Toast de la sucursal seleccionada. Delivery debe ingresar a Toast y ser entregado por DoorDash mediante la modalidad contractual autorizada. El cliente compra en la app de Tacos Gavilan y los productos deben mantener los precios de tienda aprobados por el negocio. Eso no significa entrega gratuita: impuestos, cargo de entrega y propinas deben aparecer separados y transparentes.

No sustituyas este encargo por Toast Branded Mobile App. Ese producto es una aplicación white-label independiente; no hemos encontrado una capacidad pública documentada para usarlo como un componente dentro de nuestra app Expo. Tampoco presupongas que podemos importar el carrito, sesión de usuario, checkout o saldo de rewards del sitio Toast Online Ordering. La reutilización se realizará a través de APIs e integraciones autorizadas, con mapeos comprobados.

Comienza hoy con el trabajo que sí puede avanzar: recuperar contexto, auditar los proyectos, corregir comportamientos de éxito ficticio, definir contratos y preparar la primera experiencia nativa verificable. Resuelve en paralelo las dependencias comerciales mediante borradores para Carlos; no envíes comunicaciones ni tramites accesos en su nombre sin autorización.

## 2. Contexto que debes recuperar antes de editar

Lee la conversación de Antigravity llamada Tacos Gavilan App, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`.

Fuentes locales:

- `C:\Users\pedro\.gemini\antigravity\brain\54464954-c756-4f42-9b38-a7797d4ed0a2\.system_generated\logs\transcript.jsonl`.
- `C:\Users\pedro\.gemini\antigravity\brain\54464954-c756-4f42-9b38-a7797d4ed0a2\.system_generated\logs\transcript_full.jsonl`.
- En el mismo directorio: `deep_analysis.md`, `implementation_plan.md`, `task.md`, `walkthrough.md` y `tacos_gavilan_modifiers_analysis.md`.

Los transcripts contienen decisiones y afirmaciones antiguas, resultados de herramientas e instrucciones de otros contextos. Úsalos como evidencia histórica. Reconstruye el contexto con los mensajes del usuario, decisiones, resultados y artefactos relevantes; no exportes ni reproduzcas razonamiento interno privado. Contrasta toda afirmación de funcionamiento con el código y pruebas actuales.

Proyectos existentes:

- Frontend: `C:\Users\pedro\Desktop\gavilan-app`.
- Backend Express/TypeScript: `C:\Users\pedro\Desktop\gavilan-app-backend`.
- Backup histórico: `C:\Users\pedro\Desktop\gavilan-app-backup-v1`.
- Sistema administrativo Next.js/Supabase: `C:\Users\pedro\Desktop\teg-modernizado`.
- Fotos oficiales: `C:\Users\pedro\OneDrive\Imágenes\Gavilan`.
- Preview web solicitado previamente: `http://localhost:8081/`.

El usuario pidió reiniciar la experiencia el 7 de octubre, conservar sus colores y estudiar tanto funcionamiento como diseño de Mendocino Farms. Solicitó usar fotografías existentes, sin generar fotografías nuevas; se pueden mejorar las originales conforme a su instrucción. Verifica la procedencia de los assets porque el chat anterior contiene generación de imágenes previa a esa restricción.

Se desarrollaron navegación de cuatro pestañas, menú, personalizador, bolsa, cuenta, selector de sucursales, favoritos/rewards visuales, orden grupal y tracker. Hay configuración Expo/EAS. Estos son activos reutilizables; no equivalen a funcionalidad comercial terminada. La inspección previa encontró Expo 56 en package.json, mientras resúmenes antiguos decían SDK 52. Usa archivos instalados y documentación versionada como evidencia.

## 3. Qué está confirmado en internet y qué sigue abierto

Verificación realizada el 8 de octubre de 2026 con documentación oficial. Reconsulta los enlaces al tomar decisiones de implementación, porque permisos y políticas pueden cambiar.

### Confirmado: una integración propia con Toast está contemplada

Toast distingue integraciones custom y partner, capaces de lectura/escritura, de Standard API Access, que es de solo lectura. Tener credenciales que ya consultan ventas no demuestra que podamos crear pedidos. El representante de Toast debe habilitar o tramitar el acceso necesario para esta organización.

Fuentes: [Integration types](https://doc.toasttab.com/doc/devguide/apiIntegrationTypes.html) y [Standard API Access](https://support.toasttab.com/en/article/Standard-API-Access).

Toast publica una guía para construir un canal de pedidos propio. Identifica scopes, recomienda Menus V3 para ordering partners y exige consultar precios/stock/horarios. La Orders API permite crear pedidos y consultar precios. Los permisos aplicables deben confirmarse para nuestra integración.

Fuentes: [Ordering integration checklist](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistOrdering.html) y [Orders API](https://doc.toasttab.com/openapi/orders/overview/).

### Confirmado: el precio final puede validarse en Toast

Usa `/prices` para obtener totales e impuestos antes de cobrar. El precio mostrado en el teléfono no será autoridad financiera. El payload de pedidos debe identificar productos, grupos y modificadores de la sucursal y canal correctos.

Fuente: [Order prices](https://doc.toasttab.com/doc/devguide/apiOrderPrices.html).

### Confirmado: hay dos modalidades generales de pagos

Toast documenta autorización de tarjetas por su API y registro de pagos externos mediante tender `OTHER` configurado. Una integración externa necesita un procesador real, conciliación y devolución real; escribir `OTHER` o `CREDIT` no cobra dinero por sí mismo. Apple Pay y Google Pay son objetivos sujetos al soporte del procesador y modalidad elegidos.

Fuentes: [Credit card payments](https://doc.toasttab.com/doc/devguide/authorizingCcPayments.html) y [Alternative payment types](https://doc.toasttab.com/doc/devguide/apiCreatingAnOrderWithPaymentInformation.html).

### Confirmado: DoorDash entrega pedidos originados fuera de su marketplace

DoorDash Drive ofrece APIs de entrega, sujetas a requisitos y acceso limitado. Su tutorial informa que el acceso de producción está restringido y que no ofrece plazo de certificación. El contrato existente de Tacos Gavilan debe identificarse; un acuerdo de marketplace no prueba acceso a Drive.

Fuentes: [Drive: Get started](https://developer.doordash.com/en-US/docs/drive/tutorials/get_started/) y [Integration requirements](https://developer.doordash.com/en-US/docs/drive/overview/integration_requirements/).

### Restricción fundamental: no suponer coexistencia TDS y despacho externo

Toast Delivery Services anuncia entrega con proveedores DoorDash/Uber. Eso no demuestra que cualquier pedido creado con Orders API active TDS. Además, la guía oficial de delivery dispatch indica que restaurantes con esa integración deben habilitar first-party delivery y que no pueden usar simultáneamente TDS y una delivery integration. No desactives la operación actual ni presentes Drive como una adición inocua a TDS.

Fuentes: [Toast Delivery Services](https://pos.toasttab.com/products/toast-delivery-services/) y [Delivery dispatch integration](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistDelivery.html).

Solicita una respuesta escrita de Toast para nuestro caso exacto: app custom, Orders API, delivery DoorDash y coexistencia con Online Ordering actual. La restricción publicada debe tratarse como vigente; cualquier configuración distinta necesita confirmación explícita y documentada de Toast.

### Confirmado: Expo permite distribuir una aplicación nativa en ambas tiendas

EAS permite generar y enviar los binarios a App Store Connect y Google Play. La aprobación final corresponde a Apple y Google; una compilación o subida exitosa no significa publicación aprobada.

Fuente: [Expo: Submit to app stores](https://docs.expo.dev/deploy/submit-to-app-stores/).

Apple contempla pagos externos para comida/bienes físicos. Google excluye bienes físicos y food delivery de Play Billing. Para cuentas, incluye borrado dentro de la app y la ruta web exigida por Google. Al publicar verifica privacidad, SDKs y requisitos vigentes; Google actualmente pide API 36 o superior para nuevas apps móviles comunes.

Fuentes: [Apple Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google Payments](https://support.google.com/googleplay/android-developer/answer/9858738), [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) y [Google target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878).

Conclusión técnica: la app personalizada es viable como arquitectura. El delivery productivo de esta empresa depende de permisos, contrato y configuración comprobados. No prometas una fecha de delivery antes de resolverlos.

## 4. Visión del producto terminado

Imagina al cliente abriendo Tacos Gavilan en su iPhone o Android. Ve nuestra identidad, fotografías reales y dos elecciones claras: Pickup o Delivery. Puede explorar sin crear una cuenta obligatoriamente; si el proveedor lo permite, compra como invitado y crea su cuenta cuando quiera guardar favoritos o recibir beneficios.

Para Pickup elige una sucursal, ve si admite pedidos y selecciona un horario válido. Explora el menú disponible allí, agrega rápido un producto si su configuración permite hacerlo o personaliza ingredientes y extras. La bolsa muestra sus selecciones y el total comprobado. Después del pago y aceptación real del pedido, ve su número, sucursal, indicaciones y estados de preparación. La cocina lo recibe en sus herramientas Toast habituales.

Para Delivery introduce dirección y apartamento, revisa cobertura y obtiene una cotización vigente. Los productos mantienen el precio base aprobado; la tarifa de entrega se explica aparte. Después de confirmar ve preparación, búsqueda/asignación de repartidor, recogida y entrega conforme a los eventos disponibles del proveedor. Si el proveedor facilita tracking, lo mostramos por el mecanismo permitido. No inventamos una posición GPS o ETA cuando no tenemos esos datos.

La cuenta guarda favoritos, direcciones elegidas, recibos y preferencias. Reordenar reconstruye la intención del pedido anterior y vuelve a validar disponibilidad y precio; nunca cobra automáticamente un carrito viejo. Rewards refleja un saldo real del programa aprobado, con reversión ante cancelaciones según reglas comerciales. La app permite contactar soporte y consultar el estado de un reembolso.

Para Tacos Gavilan, un pedido tiene referencias trazables entre app, pago, Toast y delivery. Operaciones puede detectar una excepción y resolverla. Un cliente que presiona dos veces el botón de pago no genera dos cobros o dos repartidores. Un servicio que se cae no produce una confirmación ficticia.

Esta visión orienta el diseño; ninguna pantalla debe mostrar como activa una capacidad todavía pendiente de integración.

## 5. Objetivos medibles y alcance inicial

El primer objetivo es una compra completa verificable en una sucursal piloto, desde menú real hasta recepción en POS/KDS y conciliación del pago. El segundo es completar una entrega real de extremo a extremo con DoorDash autorizado. El tercero es publicar versiones revisadas por Apple y Google y ampliar sucursales gradualmente.

MVP:

- Navegación Inicio, Menú, Bolsa y Cuenta; accesibilidad y textos coherentes.
- Selección Pickup/Delivery, sucursal, domicilio y horario según disponibilidad real.
- Catálogo Toast autorizado por ubicación/canal, modificadores, precios y agotados.
- Carrito, checkout, pago real, confirmación y recibo.
- Historial y reordenar con validación nueva.
- Estados comprobados de pedido y entrega; soporte y cancelación según política.
- Autenticación real y eliminación de cuenta si se ofrecen cuentas.
- Notificaciones transaccionales y recuperación al reabrir la app.

Segunda etapa, una vez estable el checkout: programa de rewards aprobado, promociones avanzadas, órdenes grupales persistentes, upsell, curbside/drive-thru donde realmente existan y optimización GPS. El modo principal sigue siendo Pickup o Delivery; curbside es una modalidad de Pickup, no una tercera experiencia principal.

La orden grupal actual no puede declararse funcional solo porque genera un enlace. Necesita sesión del anfitrión, participantes, límites, expiración, asignación de productos y definición de quién paga. Rewards no puede ser un número decorativo. Estas funciones no deben retrasar la prueba esencial de pedidos reales.

## 6. Arquitectura propuesta y justificación

Mantén React Native/Expo para compartir gran parte del desarrollo iOS y Android. Prueba dispositivos reales desde temprano: web sirve como preview, pero no demuestra comportamiento de pagos, permisos, push o navegación nativa.

Usa un backend seguro propio como coordinador entre app, Toast, pagos y proveedor de delivery. Antes de decidir entre Express y los endpoints Next.js existentes, compara código, operación, hosting y mantenibilidad; entrega una decisión documentada. Habrá una única implementación autoritativa del checkout. Evita dos backends que produzcan totales o estados diferentes.

Supabase puede guardar identidad de la app, carritos, preferencias, snapshots, referencias externas y eventos. Toast gobierna las entidades y cálculos de pedidos que le corresponden; el procesador gobierna cobros; DoorDash gobierna su entrega. Documenta la fuente de verdad de cada campo y cómo se reconcilia.

Separa integraciones por interfaces para poder elegir el delivery permitido sin rehacer pantallas. Diseña operaciones como consultar catálogo, cotizar orden, consultar cobertura, autorizar pago, enviar pedido, solicitar entrega y consultar estado. Las interfaces son contratos de nuestro software; no significan que todos los proveedores ofrecen exactamente esos endpoints.

## 7. Decisión de delivery antes de invertir en integración específica

Ruta A: Toast confirma una modalidad soportada para que nuestra app custom cree pedidos y solicite TDS con DoorDash. Obtén los endpoints/proceso, acceso, estados, cancelaciones, fees y soporte. Valida una entrega completa. La documentación pública revisada no permite afirmar hoy que este puente existe para nuestra cuenta.

Ruta B: integración directa con DoorDash Drive aprobada. Verifica sus credenciales, acceso productivo, configuración Toast first-party delivery y efecto sobre TDS/Online Ordering existentes. Requiere decisión operativa y comercial del propietario antes de modificar sucursales.

Si ambas rutas están pendientes, desarrolla el trabajo independiente y conserva Delivery deshabilitado para compra real, con explicación honesta al usuario. Puedes completar Pickup y pruebas autorizadas mientras se resuelve delivery. No publiques una app prometiendo ambos servicios si uno carece de operación real. Un lanzamiento inicial solo Pickup es una decisión del propietario, no un cambio silencioso de alcance.

## 8. Precio de tienda, impuestos, propinas y gastos

La regla del negocio es mantener el precio de los productos de tienda. Construye una matriz por sucursal/producto/modificador/canal y demuestra que el canal digital autorizado está configurado con esos precios. Un precio online puede diferir del POS por configuración; documenta y resuelve diferencias antes del piloto.

El checkout presenta productos, extras, descuentos, impuestos, delivery fee y propina por separado. Obtén la cotización financiera autoritativa y su vencimiento. Si cambia el total antes de comprar, solicita aceptación del nuevo total. El backend rechaza GUIDs ajenos, modificadores incompatibles, cantidades inválidas y valores no finitos.

Distingue costo real de DoorDash y monto cobrado al cliente. Carlos debe definir quién absorbe la diferencia, mínimos de compra y promociones de entrega. No inventes reglas fiscales para cargos o propinas; usa configuración autorizada y conciliación con el sistema correspondiente.

No guardes tarjetas completas o CVV en Supabase, logs o la app. Usa tokenización y el flujo de pago soportado. Si se adopta pago externo, configura el tender y explica cómo devolver y conciliar dinero en ambos sistemas. No presupongas que Apple Pay/Google Pay están disponibles con cualquier credencial Toast.

## 9. Fiabilidad de pedidos y recuperación

Mantén estados independientes de pedido, pago y entrega. Una autorización no equivale a cobro final; una orden registrada no equivale a cocina iniciada; una cotización no equivale a repartidor asignado.

Antes de checkout valida identidad/invitado, sucursal, horario, stock, carrito y, para delivery, dirección y cotización. Después ejecuta la secuencia permitida por los proveedores. Documenta el orden exacto de autorización/captura, creación Toast y reserva/despacho DoorDash conforme al contrato elegido; no lo fijes sin verificar sus restricciones.

Usa claves idempotentes, restricciones únicas, registro durable de pasos y un mecanismo de reintento. Las transacciones locales no abarcan Toast, el banco y DoorDash. Diseña compensaciones: liberar autorización, devolver cobro o cancelar entrega cuando corresponda. Guarda suficiente evidencia para resolver una respuesta perdida sin reenviar a ciegas.

Casos obligatorios: pago aprobado y Toast falla; Toast acepta pero la respuesta se pierde; DoorDash rechaza; cliente repite checkout; webhook duplicado o fuera de orden; app se cierra tras pagar; tienda pausa pedidos; producto se agota; falla el reembolso; cancelación después de recoger. Cada caso debe terminar en una situación comprensible y recuperable.

No marques READY sin señal verificable del flujo de cocina. Si Toast no expone el estado necesario para nuestra integración, documenta esa limitación y define el mecanismo operativo aprobado. Solo muestra datos de conductor que realmente suministre y permita usar el proveedor.

## 10. GPS y operación de cocina

El prototipo tenía HOLDING→FIRED cuando el cliente estaba a cuatro minutos. Esa promesa no debe trasladarse automáticamente al MVP: ETA vial no es distancia en línea recta, el teléfono puede suspenderse y el cliente puede denegar ubicación.

Para Pickup comienza con horario y mecanismos de preparación soportados por Toast. Investiga geofencing como mejora posterior con consentimiento, fallback y pruebas de cocina. Para Delivery, coordina preparación con el horario y estado del repartidor conforme al proveedor; el GPS del cliente que permanece en casa no sirve para disparar preparación.

Respeta America/Los_Angeles, horario de verano y día laboral administrativo de 6:00 AM a 5:59 AM. No conviertas esa frontera en horario universal de venta: la disponibilidad de pedidos y menús depende de la configuración de cada sucursal. El inicio PM de las 5:00 PM tampoco implica un corte de pedidos.

## 11. Hallazgos previos que debes verificar y corregir

La revisión anterior encontró en backend Express pagos `PAID` con intents mock, creación/resolución a usuarios de prueba, precios recibidos del cliente, impuesto fijo 9.5%, despacho Toast con fallback `simulated_*` declarado exitoso y geofence que marca FIRED antes de verificar envío. Revisa completamente `src/routes/order.ts` y sus dependencias; no uses estas conductas en producción.

En el backend Next.js se encontraron endpoints móviles que guardan en Supabase sin envío real a Toast, contrato sin Delivery, sincronización de menú estática, GUIDs de texto incompatibles con UUID y formatos distintos de modificadores. Revisa `app/api/mobile`, `app/api/cron/sync-mobile-menu/route.ts` y la migración móvil antes de reutilizarlos.

Documenta hallazgos con archivo/línea/impacto y actualiza este diagnóstico si el código cambió. Preserva cambios de otros chats y backups. No borres registros históricos o experimentales sin determinar su origen y autorización.

## 12. Plan desde hoy, con hitos verificables

Las duraciones siguientes son estimaciones de planificación, no compromisos del proveedor. No prometas fecha de publicación hasta medir el alcance y resolver accesos.

### Hito 0 — Hoy, 8 de octubre: recuperar y establecer una base fiable

Lee contexto y reglas; identifica workspaces y cambios sin commit. Produce inventario funcional y de integraciones. Audita módulos sensibles completos, en paralelo mediante subagentes cuando el tamaño lo requiera según AGENTS.md. Comprueba compilación y separa evidencia local, sandbox y producción.

Entrega hoy una matriz de accesos y decisiones, contratos iniciales de Pickup/Delivery, backlog priorizado y borradores de consultas a Toast/DoorDash. Desactiva en el código de checkout los éxitos ficticios dentro del alcance autorizado y comprueba la respuesta de error. Explica cualquier acceso que impida esa implementación y continúa el trabajo independiente.

### Hito 1 — Primera semana: catálogo y experiencia de compra

Integra lectura autorizada de una sucursal; construye menú y personalización con reglas reales. Revisa brand/assets y consolida navegación. Define modelo de carrito, estados, seguridad y entornos. Genera builds de desarrollo cuando las cuentas/herramientas estén disponibles.

Criterio de salida: el cliente navega un menú real, arma un carrito válido y ve cotización respaldada por Toast si el permiso existe. Las funciones sin acceso permanecen identificadas como pendientes; no sustituyas el catálogo real con datos ficticios para aprobar el hito.

### Hito 2 — Dos a cuatro semanas de trabajo tras obtener permisos: Pickup completo

Implementa pago elegido, envío Toast, recibo, idempotencia, historial, soporte y devoluciones. Prueba recepción real POS/KDS en entorno autorizado. Ajusta estimación con resultados técnicos, no con optimismo.

Criterio de salida: un pedido comprobado se cobra correctamente, aparece en la sucursal correcta con todos los modificadores y puede conciliarse; fallos no causan duplicados o falsos éxitos.

### Hito 3 — Delivery, condicionado a la ruta aprobada

Integra cobertura/cotización, referencias de entrega, tracking permitido, eventos y cancelaciones. Coordina cocina y logística. Prueba dirección incorrecta, fuera de zona, proveedor sin capacidad y recuperación.

Criterio de salida: entrega controlada con DoorDash desde checkout hasta domicilio, con evidencia de pedido Toast, pago, entrega y conciliación. Una prueba del simulador oficial verifica comportamiento de integración, pero no sustituye el piloto real ni habilita producción.

### Hito 4 — Piloto operativo de una a dos semanas

Selecciona con Carlos una sucursal; Lynwood fue el piloto propuesto históricamente y Slauson es el default reciente del prototipo. No confundir default de UI con autorización de piloto. Entrena operación, mide tiempos, excepciones y reembolsos. Corrige antes de ampliar.

### Hito 5 — Tiendas y despliegue gradual

Completa políticas, borrado de cuenta, accesibilidad, formularios de privacidad y builds firmados. Prueba iOS/Android reales en TestFlight y tracks internos según reglas de cada cuenta. Prepara material de revisión y credenciales de prueba legítimas. Publicación y push requieren instrucción del propietario.

Habilita tiendas progresivamente con configuración y monitoreo. La app puede listar las 15 ubicaciones sin asumir que todas admiten checkout, delivery o curbside desde el primer día.

## 13. Pruebas y criterios de aceptación

Sigue el protocolo exhaustivo del proyecto. Lee cada módulo completo y su documentación inicial. Usa scripts node/tsx contra lógica real; las simulaciones oficiales y test doubles, si se usan para fallos locales, deben distinguirse de pruebas reales y nunca presentarse como evidencia de producción. No apruebes una auditoría que requiera DB/catálogo real si no se pudo verificar.

Comprueba cruces de catálogos y UUIDs, mayúsculas/tildes sin alterar identificadores, null/undefined, cero, NaN, Infinity, cantidades fraccionarias, precios y modificadores. Prueba medianoche, 5:59/6:00 AM, 4:59/5:00 PM y cambios DST donde sean relevantes para la lógica.

Para endpoints que escriban DB ejecuta smoke tests autorizados de inserción/mutación y limpia únicamente los registros de prueba propios. No envíes columnas generadas. Para POS/pagos/delivery usa entornos de prueba oficiales y piloto productivo controlado con autoridad del propietario; borrar una fila local no cancela un pedido en cocina, un cobro o un repartidor.

Prueba autenticación, aislamiento entre usuarios/sucursales, firmas/autenticación de webhooks según proveedor, rate limits, replays, expiración de sesión/cotización y doble tap. Verifica pago/Toast/DoorDash desde sus respuestas y referencias, no solo desde mensajes UI.

La meta del piloto es cero cobros y órdenes duplicados en los escenarios ejecutados, totalidad de pedidos conciliables y ausencia de confirmaciones ficticias. Establece objetivos de rendimiento con medición real; no prometas ETA fijas de cocina o llegada.

## 14. Reglas del proyecto y entregables

Cumple AGENTS.md de cada workspace. Todo módulo TS/TSX creado o editado debe incluir el JSDoc inicial requerido con @module, @description, @businessRules, @dataFlow y @notes. Actualiza el conocimiento del asistente administrativo en `app/api/support-chat/route.ts` y `lib/chat-tools.ts` cuando cambien funciones del sistema, usando solo capacidades realmente implementadas. Preserva los cambios existentes de esos archivos.

La marca es exactamente Tacos Gavilan. No hagas commit o push sin orden explícita. Este chat de desarrollo no modifica horas/reportes, `scripts/*_full_data.json` o `lib/reports-data.ts`, ni ejecuta sus exportaciones o conciliación de horas multi-chat.

Entrega: diagnóstico inicial; matriz de permisos; decisión de arquitectura; especificación de pantallas; contrato de integración; migraciones; pruebas con evidencia y referencias externas redactadas; instrucciones de piloto y soporte; checklist de publicación; riesgos y bloqueos concretos. Actualiza estos documentos conforme avances sin declarar terminado un componente por existir su pantalla.

## 15. Consultas que debes dejar preparadas

Para Toast: confirmar integración custom de Tacos Gavilan para sus ubicaciones, scopes de ordering y Menus V3, sandbox, precios, pagos/tokenización/wallets, refunds, tiempos de cocina y estados, loyalty y requisitos de certificación. Preguntar expresamente si pedidos API propios pueden despachar TDS/DoorDash, mediante qué interfaz, y cómo afecta la restricción de coexistencia publicada al Online Ordering actual. Solicitar una arquitectura soportada por escrito.

Para DoorDash: identificar si el acuerdo vigente es marketplace, Drive o TDS; confirmar acceso API de producción para una app propia, entidades multi-location, cotización, tarifas, subsidios, propina, cancelación, tracking, eventos y soporte. No asumir que las credenciales del dashboard comercial sirven para API.

Para Carlos: presentar decisiones concretas sobre piloto, subsidio de delivery, programa de rewards y proveedor de pagos cuando haya alternativas documentadas. No pedirle decisiones técnicas rutinarias que podamos resolver con evidencia.

## 16. Instrucción final de ejecución

Empieza por el Hito 0 hoy y continúa con trabajo independiente de autorizaciones externas. Reutiliza lo útil del frontend, implementa cambios reversibles dentro del alcance y documenta bloqueos específicos cuando una operación dependa de permisos ausentes. Prioriza un pedido real y recuperable antes de enriquecer promociones o animaciones.

El resultado esperado es una app Tacos Gavilan que el cliente quiera usar de nuevo: compra clara, precio transparente, personalización correcta, Pickup confiable y Delivery DoorDash comprobado. La experiencia pertenece a Tacos Gavilan; la integridad operativa se demuestra con Toast, pagos y logística funcionando de extremo a extremo.
