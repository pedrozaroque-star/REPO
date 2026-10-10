# Prompt maestro para Antigravity — MVP publicable con Toast Online Ordering y ruta a integración nativa

Fecha: 9 de octubre de 2026. Zona horaria operativa: `America/Los_Angeles`.

## Encargo

Continúa ahora mismo el desarrollo de la aplicación descargable de clientes de **Tacos Gavilan**. Corrige el rumbo técnico actual y entrega un MVP seguro, honesto y verificable que utilice **Toast Online Ordering como checkout oficial**, mientras se prepara por separado la futura integración nativa mediante las APIs oficiales de Toast.

No agregues más decoración, animaciones, promociones, rewards, calorías, pedidos de ejemplo ni funcionalidades simuladas. La prioridad absoluta es que ningún cliente pueda ver una confirmación falsa, perder su carrito, recibir un ETA inventado o creer que una orden llegó a cocina cuando la app no tiene evidencia autoritativa.

Trabaja de forma autónoma en todo lo que no requiera credenciales o decisiones externas. Si una acción exige acceso de Toast, Apple, Google, DoorDash, Stripe o una orden/cobro real, completa primero toda la preparación independiente, documenta el bloqueo exacto y detente antes de ejecutar la acción externa.

## Decisión de arquitectura que debes implementar

### MVP inmediato

La aplicación de Tacos Gavilan será una app nativa propia con contenido y utilidad auténticos. Para realizar el pedido y pago, el usuario será transferido claramente al **Toast Online Ordering oficial de la sucursal seleccionada**.

Este MVP NO es una integración de carrito. Por tanto:

- No intentes enviar artículos del carrito nativo a Toast mediante query params, inyección JavaScript, scraping o automatización de WebView.
- No afirmes que el carrito, modificadores, dirección, descuentos o identidad se transfieren a Toast.
- No confirmes una orden al cerrar el navegador.
- No borres el carrito al regresar.
- No generes un `orderId` local como sustituto de una orden Toast.
- No muestres seguimiento, ETA, cocina, Dasher o confirmación de pago sin una respuesta oficial vinculada a una orden.
- Pickup y Delivery deben ser exclusivamente las opciones, tarifas, cobertura, horarios y disponibilidad mostrados por el checkout oficial de Toast.
- El pago debe ocurrir dentro de Toast Online Ordering. No recolectes PAN, fecha de expiración ni CVC en nuestra app o backend.

### Futuro flujo nativo

Mantén documentada, pero no presentada como terminada, la ruta futura:

1. Catálogo y modificadores reales por restaurante mediante Menus V3.
2. Carrito propio.
3. Cálculo autoritativo mediante Toast Orders `/prices`.
4. Pago mediante el mecanismo autorizado por Toast.
5. `POST /orders` con scope `orders.orders:write`.
6. Ticket comprobado en POS/KDS.
7. Pickup o Delivery respaldado por estados oficiales.

El error actual `403 / code 10010` debe clasificarse como **bloqueo externo de permisos**, no como prueba aprobada de integración.

## Lectura obligatoria antes de editar

Lee completamente:

- `C:\Users\pedro\Desktop\teg-modernizado\AGENTS.md`.
- `C:\Users\pedro\Desktop\gavilan-app\AGENTS.md`.
- El chat “Tacos Gavilan App”, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`, desde el step 6922 hasta el final actual.
- `C:\Users\pedro\Desktop\teg-modernizado\docs\PROMPT_ANTIGRAVITY_SIGUIENTE_HITO_PICKUP_REAL_2026-10-08.md`.
- El encabezado JSDoc y el contenido completo de cada `.ts` o `.tsx` que vayas a modificar.
- Las guías oficiales de Toast para Orders API, `/prices`, scopes, dining options, Menus V3 e integration types.
- Las reglas vigentes de Apple App Review, especialmente funcionalidad mínima y contenido web.
- Las reglas vigentes de Google Play sobre funcionalidad limitada, WebViews y contenido repetitivo.

No uses blogs, snippets, memoria del modelo o mensajes anteriores como autoridad para impuestos, tarifas, horarios, radio de entrega o capacidades de Toast. Conserva enlaces y fecha de consulta de las fuentes oficiales utilizadas.

## Estado confirmado que debes corregir

### Regresión actual del checkout

El flujo actual abre una URL general de Toast sin transferir carrito, artículos, modificadores, dirección, fulfillment, usuario, quote o callback verificable. Después muestra un botón manual equivalente a “Sí, ya completé mi pedido”, borra el carrito y comunica que el pedido fue enviado a cocina.

Esto es una confirmación falsa y debe eliminarse inmediatamente.

Archivos que debes revisar completos, entre otros:

- `C:\Users\pedro\Desktop\gavilan-app\app\(tabs)\cart.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\lib\toast-ordering.ts`.
- `C:\Users\pedro\Desktop\gavilan-app\components\ToastCheckoutModal.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\app\(tabs)\tracker.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\app\(tabs)\index.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\components\CustomizerModal.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\contexts\CartContext.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\contexts\AuthContext.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\contexts\StoreContext.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\lib\constants.ts`.

### Datos y mensajes simulados que debes retirar

Busca el repositorio móvil completo, no solamente estos ejemplos, y elimina o deshabilita en producción:

- “ORDEN EN LA PARRILLA”.
- “3x Tacos de Asada + Horchata”.
- “ETA: 8 min”.
- “MARTES DE TACOS”.
- “Doble Puntos”.
- “2x Gavilan Rewards”.
- Rewards fijos como 350 puntos, Oro o descuentos sin saldo real.
- Calorías estimadas o inventadas.
- “Chofer asignado”, “repartidor en camino”, “en cocina” o similares derivados de estados locales.
- Botones de simulación de viaje, geofence o cocina en builds no-development.
- Precios, impuestos, delivery fee, distancia máxima o tiempos no provenientes de una fuente oficial.
- Referencias visibles o internas no justificadas a otras marcas como “Mendocino Farms”.

No te limites a reemplazar comentarios. Audita strings renderizados, valores iniciales, fallbacks, fixtures, constantes, componentes condicionales y estados de demostración.

### Riesgos backend ya confirmados

Debes revisar y corregir:

- Funciones RPC `SECURITY DEFINER` invocables por `PUBLIC`, `anon` o `authenticated` sin autorización server-side.
- Falta de `SET search_path` seguro y validación `auth.uid()`/rol de servicio.
- RPC que confía en `p_user_id`, `p_payment_status`, montos, canal, artículos o pickup enviados por el llamador.
- Endpoint `payment-confirm` que recibe PAN/CVC y amplía peligrosamente el alcance PCI.
- Columnas del ledger de pagos incompatibles con la migración.
- Webhook Stripe que no reconcilia estrictamente amount, currency, user, quote, cart hash y PaymentIntent.
- Snapshot de orden que conserva precios o nombres enviados por el teléfono.
- Modificadores desconocidos descartados silenciosamente.
- Outbox creado antes del estado `PAID`.
- Posible duplicación si Toast acepta la orden y el proceso cae antes de persistir el GUID.
- Cron de menú público, destructivo y basado en un catálogo global clonado a 15 sucursales.
- Delivery sin orquestación DoorDash y con estados de logística derivados de estados de cocina.
- Geofence que confía en ETA o coordenadas del cliente.
- Eliminación de usuario no transaccional e incompleta.

## Fase 0 — Congelar afirmaciones y preservar el trabajo

1. Obtén `git status`, HEAD y diff de ambos repositorios sin resetear ni borrar cambios.
2. Identifica todos los commits realizados después del prompt anterior y los cambios posteriores sin commit.
3. No sobrescribas trabajo ajeno.
4. No hagas commit, push ni despliegue sin una nueva autorización explícita de Carlos después de terminar este ciclo.
5. No uses “100%”, “completo”, “production ready”, “plug-and-play”, “auténtico” o “integrado” salvo que exista evidencia externa correspondiente.
6. Crea una matriz inicial con estas categorías:
   - UI implementada.
   - Lógica local probada.
   - Servicio oficial enlazado.
   - Sandbox externo probado.
   - Piloto real probado.
   - Bloqueado externamente.

## Fase 1 — Eliminar el falso éxito de Toast

### Comportamiento requerido

Al tocar “Ordenar con Toast”:

1. La app debe verificar que existe una sucursal seleccionada y una URL Toast explícitamente aprobada para esa sucursal.
2. Debe mostrar una pantalla/modal informativa propia de Tacos Gavilan:
   - “Continuarás tu pedido y pago seguro en Toast”.
   - “Los artículos agregados aquí no se transfieren automáticamente”.
   - “Pickup, Delivery, precios, impuestos y disponibilidad se confirmarán en Toast”.
3. El usuario confirma y la app abre únicamente el dominio Toast permitido.
4. Usa navegador del sistema o sesión de navegador segura. No inyectes JavaScript ni expongas interfaces nativas al contenido externo.
5. Al regresar, muestra una opción neutral: “Volver a Tacos Gavilan”.
6. No muestres “orden confirmada”, “pago completado”, “enviado a cocina” ni “ya completé mi pedido”.
7. No vacíes el carrito ni marques estados.
8. Si el usuario necesita soporte, ofrece “Ver mi pedido en Toast” o instrucciones de revisión únicamente si Toast proporciona una URL oficial apropiada. No inventes deep links.

### Decisión sobre el carrito interno

Para este MVP, elige una de estas dos implementaciones y documenta la decisión:

- **Recomendada:** elimina/deshabilita el carrito comprable interno. La exploración del menú puede terminar en “Ordenar en Toast”, donde el cliente crea el carrito oficial.
- Alternativa únicamente si la UX lo justifica: conserva el carrito como “lista para recordar”, claramente etiquetado como no transferible, sin precios finales, impuestos, delivery fee ni confirmación. Nunca lo llames carrito de checkout.

No mantengas dos checkouts que parezcan conectados cuando no lo están.

### URLs por sucursal

1. Verifica manualmente cada una de las 15 URLs oficiales.
2. Usa una allowlist exacta de hosts y rutas aceptadas.
3. Rechaza `http`, dominios desconocidos, redirecciones abiertas y URLs construidas con datos del usuario.
4. Si una sucursal no tiene URL confirmada, muestra “Pedidos en línea temporalmente no disponibles” y teléfono real; no uses otra tienda como fallback.
5. Documenta cualquier slug histórico que contenga “tacos-el-gavilan”. Si es una URL externa real que no se puede cambiar, no lo presentes como nombre oficial dentro de la interfaz y solicita su corrección a Toast.

## Fase 2 — Convertir la app en algo publicable y no en un simple WebView

La aplicación debe aportar utilidad nativa auténtica más allá del enlace a Toast.

Implementa o conserva solamente funciones respaldadas por datos reales:

1. Listado de las 15 sucursales desde una única fuente autoritativa del backend.
2. Dirección, teléfono, coordenadas y horarios reales por sucursal.
3. Selección de tienda persistente.
4. Botones nativos de llamar, abrir mapas y obtener indicaciones.
5. Favoritos locales de sucursales; favoritos de productos solamente si existe un identificador real y estable.
6. Preferencias de notificaciones persistentes.
7. Centro de soporte con teléfono/correo/política reales.
8. Información de Pickup y Delivery expresada sin garantías no verificadas.
9. Contenido de marca propio de Tacos Gavilan.
10. Accesibilidad: labels, contraste, tamaños dinámicos, navegación por lector de pantalla y targets táctiles.

No inventes historial de pedidos, ofertas, puntos, badges, disponibilidad, horarios especiales o notificaciones promocionales. Si no hay fuente real, elimina la sección o márcala como no disponible sin simular contenido.

## Fase 3 — Menú honesto durante el MVP

1. No uses las 3,240 filas clonadas como prueba de menús auténticos por restaurante.
2. No permitas checkout basado en el menú cacheado local.
3. Si se conserva la exploración nativa del menú:
   - Identifícala como catálogo informativo.
   - Incluye “Precios y disponibilidad se confirman en Toast”.
   - No muestres stock o disponibilidad que no exista.
   - No muestres modifier groups globales como si fueran válidos para todos los productos.
   - No muestres impuestos o total final.
4. Si no se puede garantizar la exactitud, prioriza abrir directamente el menú Toast de la sucursal en vez de ofrecer una copia inconsistente.
5. Elimina pseudo-modificadores como `mod-cebolla`, `mod-salsa-roja`, `sin-*`, `ext_*` y `tort_*` de cualquier flujo comprable.
6. Mantén separados `cartLineId`, product GUID y modifier GUID.

## Fase 4 — Endurecer el backend aunque el checkout nativo quede deshabilitado

### RPC y base de datos

1. Crea una migración nueva; no edites destructivamente migraciones ya aplicadas.
2. Revoca `EXECUTE` de funciones privilegiadas a `PUBLIC`, `anon` y `authenticated` cuando deban ser server-only.
3. Concede ejecución únicamente al rol necesario.
4. Define `SET search_path` explícito y seguro.
5. No confíes en `p_user_id`, `p_payment_status`, montos o artículos del llamador.
6. Obtén identidad desde contexto autenticado o ejecuta la función únicamente desde service role después de validar en la API.
7. Quote, order y outbox deben crearse en una transacción y desde valores autoritativos.
8. No generes outbox Toast para órdenes no pagadas.
9. Nunca incluyas columnas generadas de PostgreSQL en payloads de mutación.

### Pagos

1. Deshabilita o elimina del routing productivo el endpoint que recibe número de tarjeta/CVC.
2. Retira `PaymentModal` y cualquier formulario manual de tarjeta del build productivo.
3. No declares cumplimiento PCI por inferencia.
4. Conserva la arquitectura Stripe únicamente como código experimental deshabilitado si Carlos decide usarla en el futuro.
5. Si mantienes webhooks Stripe, corrige el esquema y exige firma, event ID único, amount, currency, customer/user, quote, metadata y cart hash coherentes antes de transicionar estados.
6. Todo error de DB debe impedir responder éxito.

### Outbox

1. Mantén claim atómico y lease, pero prueba dos workers simultáneos.
2. Implementa recuperación de locks vencidos.
3. No gastes reintentos mientras falta pago.
4. Documenta el riesgo de timeout después de que Toast acepta pero antes de guardar su GUID.
5. No prometas “exactly once” si Toast no ofrece una clave idempotente o reconciliación comprobable. Usa “at-least-once con deduplicación/reconciliación” cuando corresponda.
6. El cron solo debe aceptar `Authorization: Bearer`; no secretos en query params.

### Sincronización de menú

1. Exige `CRON_SECRET` o mecanismo equivalente.
2. Elimina el patrón público `DELETE` seguido de `INSERT` por tienda.
3. Usa staging + swap/transacción o versionado de snapshots.
4. Un fallo no puede dejar el menú vacío.
5. No replique un catálogo global a las 15 ubicaciones y lo llames menú real.
6. Hasta recibir Menus V3 por location, marca el dataset como informativo/no reconciliado.

### Cuenta y privacidad

1. Haz la eliminación de cuenta transaccional o implementa compensación segura.
2. Anonimiza o elimina PII en quotes, orders, delivery addresses y snapshots según la política legal aplicable.
3. Define retención de pedidos y registros financieros antes de borrar información que deba conservarse legalmente.
4. Nunca expongas secretos en logs o documentación.

## Fase 5 — Delivery durante el MVP

Delivery será administrado enteramente por el checkout oficial de Toast mientras no exista integración aprobada.

La app debe:

- No calcular tarifa Delivery.
- No definir radio de 6 o 10 millas.
- No usar una dirección prellenada como si fuera la del cliente.
- No geocodificar para prometer cobertura.
- No crear un dispatch DoorDash.
- No mostrar nombre de Dasher, ETA o tracking.
- No traducir estados de cocina a estados de entrega.
- No afirmar que “DoorDash entregará” salvo texto aprobado y configuración confirmada para esa ubicación.
- Comunicar: “Disponibilidad, tarifa y tiempo de entrega se confirman en Toast”.

Mantén `lib/doordash-drive.ts` fuera del flujo productivo. No pruebes con repartidores reales sin autorización expresa.

## Fase 6 — Sesión, persistencia y configuración móvil

1. Termina la persistencia de autenticación con SecureStore en iOS/Android y almacenamiento web apropiado.
2. Implementa refresh y expiración reales; no fabriques una expiración local de una hora.
3. Persiste la tienda seleccionada y preferencias necesarias.
4. Si se conserva una lista/carrito informativo, persístelo correctamente en móvil y web.
5. Elimina dependencias y handlers muertos del checkout anterior.
6. Ningún build físico puede usar `localhost`.
7. Configura perfiles:
   - development.
   - preview/staging.
   - production.
8. Cada perfil debe usar una URL HTTPS explícita y no secreta.
9. Completa `owner`, `projectId`, `runtimeVersion`, updates y canales EAS usando valores reales; no inventes IDs.
10. Verifica bundle ID `com.tacosgavilan.app`, package Android, iconos, splash, permisos y deep links.
11. Solicita únicamente permisos realmente utilizados y explica su propósito.

## Fase 7 — Cumplimiento y materiales de publicación

Prepara, sin enviar todavía:

1. Privacy Policy pública.
2. Terms of Service.
3. Support URL y contacto.
4. Proceso de eliminación de cuenta.
5. Declaración clara de que pedidos/pagos se procesan en Toast.
6. Texto de privacidad sobre ubicación, notificaciones, analytics y datos de cuenta.
7. App Store privacy nutrition labels basadas en comportamiento real.
8. Google Play Data Safety basada en SDKs y datos reales.
9. Notas para revisión que expliquen el salto seguro a Toast Online Ordering.
10. Credenciales demo únicamente si existe cuenta demo legítima.
11. Capturas sin pedidos, rewards, descuentos, ETA o promociones simuladas.

No envíes la app a producción. Primero genera builds internos y valida el flujo en dispositivos.

## Fase 8 — Paquete formal para solicitar acceso nativo a Toast

Crea un documento listo para enviar a Toast con:

### Descripción

- Tacos Gavilan opera 15 sucursales.
- Se desea una app oficial propia para clientes.
- Pickup debe crear órdenes directamente en Toast POS/KDS.
- Delivery debe usar la modalidad Toast/DoorDash ya acordada, manteniendo precio de tienda para el cliente.
- La integración debe respetar menú, modifiers, disponibilidad, impuestos, dining options y horarios por restaurante.

### Accesos solicitados

- Integration type apropiado: custom o partner, según Toast determine.
- `orders.orders:write`.
- Lectura de Orders necesaria para reconciliación.
- `config:read`.
- Menus V3 por ubicación/canal.
- `/prices` para totales autoritativos.
- Order management configuration/horarios.
- Dining options Pickup, Curbside y Delivery.
- Sandbox o ubicación de prueba.
- Order source para “Tacos Gavilan App”.
- Mecanismo de pagos permitido para custom app.
- Webhooks/eventos requeridos.
- Procedimiento de cancelación, void, refund y reconciliación.
- Confirmación de compatibilidad con Toast Delivery Services y/o DoorDash Drive.

### Preguntas concretas

1. ¿Puede una custom integration crear órdenes y pagos para restaurantes propios?
2. ¿Qué certificación se requiere antes de habilitar Orders write?
3. ¿Se puede utilizar el procesamiento Toast Payments desde una app custom y cuál es el flujo oficial?
4. ¿Cómo se cotiza y despacha Delivery cuando la cuenta usa DoorDash mediante Toast?
5. ¿Existe restricción de coexistencia entre TDS y una integración DoorDash propia?
6. ¿Qué estados/webhooks oficiales permiten mostrar seguimiento al cliente?
7. ¿Cómo se identifica una orden de nuestra app en POS/KDS?
8. ¿Existe idempotency key o método recomendado de reconciliación tras timeout?
9. ¿Qué datos de menú son distintos por restaurante y canal?
10. ¿Qué entorno y location GUID debe usarse para el piloto Lynwood?

Incluye el error sanitizado `403 / code 10010`, sin tokens ni secretos.

## Fase 9 — Pruebas obligatorias

### Auditoría estática

- Busca globalmente strings y fixtures prohibidos.
- Comprueba que no queda ningún handler que borre carrito o confirme una orden al cerrar Toast.
- Verifica que no se usa `localhost` en preview/production.
- Verifica allowlist de URLs por las 15 sucursales.
- Verifica que ningún componente productivo recolecta PAN/CVC.

### Pruebas frontend

- Abrir Toast para cada sucursal lleva al dominio permitido correcto.
- Cancelar antes de abrir no cambia estado.
- Regresar de Toast no borra datos ni crea orden.
- Error de navegador muestra recuperación honesta.
- Modo offline no permite presentar precios/availability como vigentes.
- Reinicio conserva tienda y sesión según corresponda.
- VoiceOver/TalkBack y tamaños dinámicos en pantallas principales.

### Pruebas backend

- `anon` y `authenticated` no pueden ejecutar RPC server-only.
- Usuario A no puede consumir quote/orden de usuario B.
- No se puede marcar `PAID` desde payload del cliente.
- Orden sin pago no crea outbox.
- Cron sin Authorization, con token incorrecto o por query param es rechazado.
- Fallo de sync no elimina el snapshot vigente.
- Modificador desconocido produce error explícito.
- Eliminación de cuenta maneja fallo parcial sin perder trazabilidad.

### Simulaciones requeridas por AGENTS.md

- Ejecuta scripts `tsx` reales para límites 5:59/6:00 AM, medianoche, DST y `America/Los_Angeles` cuando la lógica de horarios aplique.
- Prueba null, undefined, `0`, negativos, NaN, Infinity, cantidades máximas y texto con/sin acentos.
- Toda mutación DB usa ID único, verifica resultado y limpia exclusivamente sus registros.
- No insertes columnas generadas.
- No realices cobros, pedidos Toast ni dispatch DoorDash reales sin autorización específica.

### Builds

- `npx tsc --noEmit` en ambos repos.
- Tests automatizados con salida reproducible.
- `expo-doctor` completo; timeout o ausencia de salida no cuenta como aprobado.
- Export web únicamente como verificación adicional, no como sustituto de build nativo.
- Build EAS preview de iOS y Android cuando owner/project/credenciales estén disponibles.
- Instalación y prueba en al menos un iPhone y un Android antes de submission.

## Criterios de aceptación del MVP

El MVP puede considerarse candidato a testing interno solamente si:

1. No existe confirmación falsa de orden.
2. No se borra el carrito/lista al regresar de Toast.
3. No existe captura manual de tarjeta.
4. No hay pedidos, ETA, rewards, calorías, descuentos o promociones ficticias.
5. Las 15 URLs Toast están validadas y restringidas por allowlist.
6. Pickup/Delivery, impuestos y tarifas se confirman exclusivamente en Toast.
7. La app aporta utilidad nativa real más allá del navegador.
8. RPC, cron y datos sensibles están protegidos.
9. Preview/production usan HTTPS, no localhost.
10. TypeScript, pruebas, expo-doctor y build preview pasan.
11. Un dispositivo real completa el salto a Toast y vuelve sin pérdida ni mensaje engañoso.
12. Privacy Policy, soporte y Data Safety están preparados.

Esto NO significa todavía integración nativa, pedido Toast conciliado ni publicación aprobada.

## Reglas invariables

- Nombre oficial: **Tacos Gavilan**, nunca “Tacos El Gavilan”, salvo que aparezca dentro de una URL externa histórica documentada.
- No inventar slogans, promociones, precios, impuestos, tarifas, horarios, puntos, estados o capacidades.
- No usar emojis como iconos de interfaz.
- No crear fotografías nuevas; usar únicamente activos autorizados por Carlos.
- No tocar reportes, horas, `scripts/*_full_data.json`, `lib/reports-data.ts` ni documentos de pendientes.
- No hacer commit, push ni deploy sin nueva autorización explícita de Carlos.
- Todo módulo `.ts`/`.tsx` nuevo o editado debe incluir JSDoc con `@module`, `@description`, `@businessRules`, `@dataFlow` y `@notes`.
- Si cambias funcionalidad, actualiza `app/api/support-chat/route.ts` y `lib/chat-tools.ts` con el estado verdadero.
- No imprimir secretos ni valores completos de credenciales.
- No modificar migraciones aplicadas; crear migraciones nuevas.
- Preservar cambios ajenos y documentar cualquier conflicto.

## Entregable obligatorio

Al terminar, entrega un documento persistente y un resumen final con:

1. Matriz honesta UI / lógica local / servicio enlazado / sandbox / piloto / bloqueo externo.
2. Lista exacta de archivos modificados y motivo.
3. Lista completa de contenido ficticio eliminado.
4. Arquitectura final del MVP y diagrama del handoff a Toast.
5. Evidencia de las 15 URLs validadas, sin exponer secretos.
6. Evidencia de pruebas frontend, backend, seguridad, DB y dispositivos.
7. Resultado de TypeScript, expo-doctor y builds.
8. Riesgos todavía abiertos.
9. Documento listo para Toast solicitando scopes e integración.
10. Materiales pendientes de Carlos: cuentas Apple/Google/Expo, URLs legales, contactos y aprobaciones.
11. `git status`, HEAD y diff resumido de ambos repos.
12. Próximo paso mínimo.

Detente sin commit, push ni deploy. No concluyas que la app está lista para App Store o Google Play solamente porque la web responde HTTP 200 o TypeScript compila.
