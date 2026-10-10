# Prompt para Antigravity — siguiente hito de Tacos Gavilan App

Fecha: 8 de octubre de 2026. Zona horaria: America/Los_Angeles.

## Objetivo de este ciclo

Continúa el desarrollo de la aplicación descargable de clientes de **Tacos Gavilan**, pero no agregues nuevas pantallas, animaciones, rewards ni funciones promocionales. El único objetivo de este ciclo es dejar preparado y, cuando existan los accesos externos necesarios, demostrar un flujo vertical de **Pickup pagado, idempotente y recibido una sola vez por Toast POS/KDS en la sucursal piloto Lynwood #14**.

Delivery debe permanecer deshabilitado para compra productiva hasta que Pickup alcance ese nivel y Tacos Gavilan confirme por escrito la modalidad autorizada con Toast/DoorDash. Puedes reparar arquitectura común y preparar contratos de Delivery, pero no muestres tarifa, chofer, ETA, tracking ni estados de entrega como hechos mientras DoorDash no los haya emitido.

No cierres este ciclo diciendo “completado”, “production ready” o “listo para publicar” si falta pago sandbox, ticket Toast real, dispositivo instalado o evidencia del proveedor.

## Lectura obligatoria antes de editar

Lee completos, no solamente sus resúmenes:

- `C:\Users\pedro\Desktop\teg-modernizado\AGENTS.md`.
- `C:\Users\pedro\Desktop\gavilan-app\AGENTS.md`.
- El encabezado JSDoc y el contenido completo de cada archivo `.ts`/`.tsx` que vayas a modificar.
- El chat “Tacos Gavilan App”, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`, especialmente steps 6522–6921.
- `C:\Users\pedro\Desktop\teg-modernizado\docs\PROMPT_ANTIGRAVITY_CONTINUACION_APP_TACOS_GAVILAN_2026-10-08.md`.
- La migración `supabase/migrations/202610080002_app_quotes_payments_outbox.sql` y todas las rutas móviles actuales.

Preserva cambios ajenos. No uses reset, checkout destructivo ni limpies masivamente el working tree. No hagas commit ni push sin una nueva orden explícita de Carlos.

## Estado real confirmado por la auditoría independiente

### Lo que sí avanzó

- Existen cotizaciones persistidas con expiración, totales autoritativos y `cart_hash`.
- `order/create` deriva sus totales de la quote y, cuando recibe un PaymentIntent, consulta Stripe y valida estado, monto, moneda y `quote_id`.
- Se creó `app_order_outbox`, lógica de reintentos y dead letter, y se aplicó la migración en Supabase.
- Geofence y curbside ya conservan `HOLDING` si Toast responde con error.
- El frontend separa `cartLineId` del GUID original del artículo y exige una quote de servidor antes de enviar.
- La app ya no vacía el carrito cuando `create` falla.
- TypeScript pasa en `teg-modernizado` y `gavilan-app`.
- `test_pickup_vertical_slice.ts` terminó 26/26, con mutaciones reales de Auth/Supabase y cleanup.
- Toast Orders v2 respondió `403 / code 10010` para Lynwood; esto demuestra el bloqueo de scope, no una integración exitosa.

### Lo que todavía no está demostrado

- Ningún ticket fue recibido por Toast POS/KDS.
- Ningún PaymentIntent/cobro Stripe fue creado o confirmado.
- Ningún worker procesó realmente un outbox pendiente en la prueba final.
- No se probó concurrencia, recuperación de locks, backoff ni dead letter.
- No hubo cotización, dispatch, Dasher, tracking ni entrega DoorDash.
- No hubo prueba en dispositivo, build EAS, TestFlight, Play Internal Testing ni piloto Lynwood.

### Hallazgos críticos nuevos

1. `order/create` permite crear una orden `PENDING` sin PaymentIntent y crea outbox. `toast-orders.ts` no exige `payment_status === 'PAID'`, por lo que comida no pagada podría enviarse a Toast.
2. Orden, consumo de quote y outbox son mutaciones separadas. El error de inserción del outbox no se valida; puede haber cobro/orden sin despacho o quote consumida a medias.
3. El claim del outbox no es atómico. Dos workers pueden seleccionar la misma fila; no hay recuperación robusta de locks `PROCESSING` abandonados ni deduplicación autoritativa antes de Toast.
4. El worker `/api/cron/process-mobile-outbox` no está programado en `vercel.json`.
5. El snapshot de la orden todavía incorpora nombres y precios enviados por el teléfono. Toast puede recibir una selección con precio alterado aunque el total de la quote sea correcto.
6. Los modificadores siguen siendo ficticios o incompletos. El frontend genera IDs como `mod-cebolla`, `sin-*`, `ext_*` y `tort_*`; la quote descarta silenciosamente los que no sean GUID. No se validan min/max, grupo exclusivo, defaults, duplicados ni nested modifiers.
7. El precio de extras se suma dos veces en la app: el customizer guarda `unitPrice` incluyendo extras y `CartContext` vuelve a sumar los modifiers. Caso confirmado: producto $2.29 + extra $1.50 termina mostrando $5.29 en vez de $3.79. La propina puede calcularse sobre ese monto inflado.
8. El menú de 216 productos fue clonado para las 15 tiendas. No representa precio, disponibilidad, horario ni configuración auténtica por restaurante.
9. El cron de menú es público y destructivo: no valida `CRON_SECRET`, borra antes de reinsertar y deja una ventana de menú vacío.
10. La autenticación móvil vive en memoria, no tiene refresh real ni guard de rutas; la sesión desaparece al cerrar la app.
11. La dirección Delivery y sus coordenadas son fijas. Editar el texto no geocodifica ni invalida coordenadas/quote.
12. El tracker usa una tienda default distinta, texto fijo de Lynwood e infiere estados DoorDash a partir de cocina. También hay simulación cliente capaz de fabricar `FIRED`/`READY` en fallos o ausencia de token.
13. Delivery se manda a Toast como `Takeout` porque la dining option depende de `pickup_method`, no del fulfillment autoritativo.
14. El webhook DoorDash verifica una HMAC inicial, pero no guarda event ID, no evita replay y permite transiciones regresivas. Solo se probó el bloqueo 503 sin secreto.
15. No existe webhook Stripe firmado, asociación persistente quote→PaymentIntent→order, cancelación, refund ni compensación si Toast falla después del cobro.
16. `send-otp`, `verify-otp`, `_helpers.ts`, cart y favorites no cumplen todavía toda la documentación JSDoc obligatoria. `send-otp` solo busca entre los primeros 50 usuarios y `verify-otp` intenta sustituir una PK existente.
17. `.env` móvil apunta a localhost y está rastreado. EAS no tiene `owner`/`projectId` resueltos ni perfiles HTTPS demostrados.
18. `App.tsx` e `index.ts` fueron movidos a `.legacy_backup`, dejando archivos tracked como eliminados y backups sin seguimiento. Decide y documenta su destino; no los pierdas ni los presentes como limpieza terminada.

## Definición estricta de “Pickup vertical cerrado”

Pickup solo puede declararse cerrado cuando exista evidencia concatenada de:

1. Usuario autenticado y sesión recuperable después de reiniciar la app.
2. Menú y modificadores auténticos de Lynwood, con GUIDs Toast válidos.
3. Quote persistida, vigente, single-use y calculada únicamente en servidor.
4. PaymentIntent sandbox creado desde la quote, confirmado y conciliado por webhook firmado.
5. Creación atómica de order + consumo de quote + outbox.
6. Worker con claim exclusivo y recuperación de fallos.
7. Exactamente un ticket aceptado por Toast con productos, modificadores, dining option y monto correctos.
8. Referencias quote/payment/order/Toast conciliadas en DB.
9. Reintento, doble toque y webhook duplicado sin duplicar cobro ni ticket.
10. Cancelación/refund o compensación probada para el fallo posterior al cobro.
11. App instalada en un dispositivo físico de prueba y recuperación correcta de la orden tras reinicio.

Hasta lograrlo, usa la categoría correspondiente: **UI implementada**, **lógica local probada**, **sandbox externo probado**, **piloto real probado** o **bloqueado externamente**.

## Plan obligatorio de ejecución

### Fase 1 — Impedir órdenes no pagadas

1. Bloquea `order/create`, el worker, geofence y curbside para que jamás llamen a Toast si `payment_status !== 'PAID'`.
2. No permitas que `paymentIntentId: null` termine como “Orden Confirmada”. Si pago todavía no está configurado, el botón debe quedar deshabilitado y explicar “Pago temporalmente no disponible”.
3. Separa claramente `PENDING_PAYMENT`, `PAID`, `PAYMENT_FAILED`, `REFUND_PENDING` y `REFUNDED` de los estados de cocina y entrega.
4. No construyas un pago Toast `OPEN` como sustituto del cobro real.

### Fase 2 — Autoridad financiera e idempotencia

1. Implementa webhook Stripe con firma oficial, raw body, event ID único y procesamiento idempotente.
2. Persiste la relación quote→PaymentIntent→order, monto, moneda y último estado del procesador.
3. Al crear PaymentIntent, usa idempotency key estable derivada de la quote/usuario y nunca un monto del teléfono.
4. Implementa cancelación/refund/compensación segura si el pedido no puede llegar a Toast después del cobro.
5. No imprimas llaves. Si faltan credenciales, completa la lógica independiente y reporta `BLOCKED_EXTERNALLY`.

### Fase 3 — Transacción y outbox verdaderos

1. Crea una función SQL/RPC transaccional que, en una sola transacción, valide y consuma la quote, inserte la orden y cree el outbox. Cualquier fallo debe revertir todo.
2. Nunca envíes columnas generadas de PostgreSQL en `INSERT`/`UPDATE`.
3. Implementa claim atómico con condición de estado/versionado o `FOR UPDATE SKIP LOCKED`, según lo permitido por Supabase.
4. Añade `locked_at`, `locked_by`, recuperación de locks vencidos, contador, `next_retry_at`, error sanitizado y `DEAD_LETTER` verificable.
5. Antes de llamar a Toast, comprueba si ya existe `toast_order_guid`. Maneja timeout posterior a éxito externo con reconciliación; no asumas que ausencia de respuesta significa ausencia de ticket.
6. Programa el cron en `vercel.json` y protege la ruta con `CRON_SECRET` mediante comparación segura.

### Fase 4 — Catálogo, modificadores y matemática

1. Reconstruye el snapshot exclusivamente desde la quote persistida y el catálogo server-side; ignora nombres, precios y totales enviados por el teléfono.
2. No descartes silenciosamente modificadores. Rechaza la quote con error explicativo si un GUID no pertenece al artículo/sucursal.
3. Valida grupos, defaults, min/max, multiplicidad, exclusividad, nested modifiers y disponibilidad.
4. Elimina todos los pseudo GUIDs del frontend y consume los modifier groups reales del API.
5. Define un solo invariante de precio: `base unit price` separado de `modifier total`. Corrige el doble cobro y calcula tip sobre el subtotal autoritativo permitido.
6. Añade pruebas exactas del caso $2.29 + $1.50 = $3.79 y de cantidades múltiples.
7. Protege el cron de menú, evita delete+insert no transaccional y sincroniza por restaurante. Usa staging/swap o transacción para no publicar un catálogo vacío.
8. No llames “auténtico” al catálogo hasta reconciliarlo contra la fuente Toast autorizada de Lynwood.

### Fase 5 — Cliente móvil confiable

1. Implementa sesión persistente con almacenamiento seguro, refresh/expiración real, guard de rutas y regreso al checkout después de login.
2. Persiste quote, carrito y orden activa de forma segura para recuperarlas tras reinicio.
3. Resuelve la tienda desde la orden; no uses `DEFAULT_STORE` para tracking o geofence.
4. Elimina de builds productivos todo botón/simulador que cambie estados localmente. Un fallo de API nunca puede fabricar `FIRED`, `READY` o “chofer en camino”.
5. Unifica fulfillment del StoreContext y checkout. Cambiar tienda o canal debe invalidar la quote y, si corresponde, el carrito incompatible.
6. Elimina rewards, teléfono y nivel ficticios. Deshabilita rewards hasta tener fuente real.
7. El modo offline puede mostrar un snapshot claramente marcado, pero no permitir checkout sin revalidación de precio/disponibilidad.

### Fase 6 — Delivery honesto y aislado

Mientras falten contrato/accesos:

- Oculta o marca Delivery como “Próximamente”; no muestres tarifa fija $4.99 ni mensajes DoorDash operativos.
- No derives estados de chofer de `PREPARING`/`READY`.
- Mantén estados de cocina y logística en campos/máquinas separados.
- No llames `dispatchDoorDashDelivery` ni generes un outbox DoorDash.

Después de autorización escrita y credenciales oficiales:

1. Implementa geocoding/autocomplete autorizado y normalización server-side.
2. Liga texto normalizado, coordenadas verificadas, tienda, cobertura y quote; cualquier edición invalida la quote.
3. Obtén quote DoorDash oficial con expiración.
4. Envía dining option Delivery correcta a Toast.
5. Despacha de forma idempotente solo después del estado financiero/operativo acordado.
6. Verifica webhooks según la especificación contractual real; guarda event ID y orden temporal, rechaza replay y transiciones regresivas.
7. Ejecuta simulator oficial y luego una entrega piloto expresamente autorizada.

### Fase 7 — Entornos y publicación interna

1. Configura development, preview/staging y production con URLs HTTPS; nunca `localhost` en builds físicos.
2. No pongas secretos en Expo ni en archivos versionados. Revisa exposición histórica y reporta qué variable debe rotarse sin mostrar su valor.
3. Completa `owner`, `projectId`, `runtimeVersion`, updates, deep links, notificaciones, privacy policy, terms, support URL y permisos con datos reales.
4. Genera primero builds internos instalables. No inicies App Store/Google Play production submission hasta pasar el piloto.

## Pruebas mínimas de este ciclo

Cumple AGENTS.md: revisión línea por línea, simulaciones runtime y smoke tests de mutación real con cleanup exacto. No cuentes inserts directos como prueba del endpoint productivo.

### Seguridad y dinero

- Create sin pago: rechazado y cero outbox.
- PaymentIntent con quote ajena, expirada, consumida o monto alterado: rechazado.
- Webhook Stripe: firma válida, inválida, duplicada y fuera de orden.
- Refund/compensación ante fallo Toast posterior al pago.

### Atomicidad y concurrencia

- Fallo forzado en cada etapa de RPC: cero estado parcial.
- Dos requests simultáneos con la misma quote: una orden, un outbox.
- Dos workers simultáneos: un solo claim y una sola llamada externa.
- Lock abandonado: recuperado después del TTL.
- Tres fallos: backoff verificable y transición a dead letter.
- Timeout después de una respuesta externa aceptada: reconciliación sin duplicado.

### Catálogo y matemática

- GUID artículo/modifier inexistente o de otra tienda: rechazo explícito.
- Reglas min/max/default/nested y duplicados.
- $2.29 + $1.50 = $3.79; cantidades, centavos, tip permitido, cero, negativos, NaN e Infinity.
- Comparación catálogo Lynwood cacheado contra fuente autorizada.

### Tiempo y móvil

- Expiración quote, medianoche, DST, 5:59/6:00 AM y horarios de tienda cuando apliquen.
- Reinicio de app conserva sesión y orden, pero no revive quote expirada.
- Cambio de dirección/tienda/canal invalida quote.
- Build preview instalado en iOS y Android o bloqueo preciso documentado.

### Externas

- Stripe sandbox: pago y webhook reales.
- Toast sandbox/piloto autorizado: ticket único visible en POS/KDS y cancelación controlada.
- DoorDash: no ejecutar hasta fase autorizada; un webhook sintético no cuenta como entrega.

Antes de toda mutación real, usa un identificador de prueba único, verifica que el cleanup apunta exclusivamente a él y confirma después que no quedaron órdenes, quotes, eventos ni outbox de prueba.

## Accesos externos que debes reportar, no inventar

Entrega a Carlos una solicitud precisa y separada para:

1. Toast: habilitar Orders write/sandbox para la integración y restaurante Lynwood GUID `80a1ec95-bc73-402e-8884-e5abbe9343e6`; confirmar Menus V3/order source/dining options y cancelación.
2. Stripe: publishable key para la app, secret key y webhook signing secret para staging; confirmar cuenta y política de Apple Pay/Google Pay.
3. DoorDash: modalidad contractual aprobada, developer/business IDs, signing secret, environment y simulator/certificación; no cambiar Toast Delivery Services sin autorización.
4. Expo/App stores: owner/project, Apple Developer, App Store Connect y Google Play Console cuando el build interno esté listo.

No ejecutes cobro productivo, pedido real, cancelación en una tienda activa ni dispatch de repartidor sin autorización expresa para esa prueba.

## Reglas invariables

- Nombre oficial: **Tacos Gavilan**, nunca “Tacos El Gavilan”.
- No tocar reportes, horas, `scripts/*_full_data.json`, `lib/reports-data.ts` ni exportaciones de pendientes.
- No hacer commit ni push sin instrucción explícita de Carlos.
- Todo módulo `.ts`/`.tsx` nuevo o editado debe tener `@module`, `@description`, `@businessRules`, `@dataFlow` y `@notes`.
- Si cambias funcionalidad, sincroniza el conocimiento verdadero en `app/api/support-chat/route.ts` y `lib/chat-tools.ts`.
- No imprimas secretos ni los copies a documentación.
- No inventes precios, horarios, tiendas, rewards, estados o capacidades.
- No uses emojis como iconos de la interfaz.
- No edites migraciones ya aplicadas de forma destructiva; crea una migración nueva.

## Entregable obligatorio

Al finalizar, entrega en un documento persistente y en el mensaje final:

1. Matriz actualizada: UI / lógica local / sandbox externo / piloto / bloqueado externamente.
2. Lista exacta de archivos modificados, migraciones aplicadas y motivo.
3. Estado de cada P0 de este prompt con evidencia, no afirmaciones.
4. Salida de pruebas agrupada por unitarias, rutas productivas, DB, concurrencia, Stripe, Toast, móvil y DoorDash.
5. IDs de prueba y confirmación de cleanup, sin secretos.
6. `git status` de ambos repositorios, incluyendo decisión sobre `.legacy_backup` y bundles Expo.
7. Bloqueos externos con el error sanitizado y la acción exacta requerida de Carlos/proveedor.
8. El siguiente paso mínimo.

Detente al final sin commit. Si Toast sigue en 403 o Stripe sigue sin llaves, no maquilles el resultado: deja Pickup como **bloqueado externamente**, pero completa y prueba toda la seguridad, atomicidad y experiencia independiente de esos accesos.
