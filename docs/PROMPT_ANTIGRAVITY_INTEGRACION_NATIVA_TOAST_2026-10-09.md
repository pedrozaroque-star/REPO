# Prompt maestro para Antigravity — integración nativa de Toast en Tacos Gavilan App

Fecha: 9 de octubre de 2026. Zona horaria: `America/Los_Angeles`.

## Decisión definitiva de producto

Construye la aplicación descargable oficial de **Tacos Gavilan** con una experiencia de pedido completamente nativa dentro de nuestra propia app.

El cliente debe poder, sin abandonar Tacos Gavilan App:

1. Seleccionar una de las 15 sucursales.
2. Elegir Pickup o Delivery.
3. Consultar el menú Toast real correspondiente a esa sucursal y canal.
4. Elegir productos y modificadores auténticos.
5. Armar y editar su carrito.
6. Obtener precios, impuestos, service charges, propina y total calculados autoritativamente por Toast.
7. Pagar mediante el mecanismo oficialmente autorizado por Toast.
8. Crear exactamente una orden en Toast.
9. Recibir confirmación solamente cuando Toast devuelva un GUID válido.
10. Consultar un estado respaldado por datos oficiales.
11. Para Pickup, recoger la orden en la sucursal seleccionada.
12. Para Delivery, recibir el pedido mediante la modalidad Toast/DoorDash contractualmente aprobada para Tacos Gavilan.

No utilices el wrapper actual que abre Toast Online Ordering como solución final. No uses WebView, navegador interno, redirección externa, scraping, inyección JavaScript ni confirmación manual como sustituto de una integración.

## Restricción externa actual

Las credenciales actuales reciben `HTTP 403 / Toast code 10010` al intentar crear órdenes. Esto significa que todavía no existe autorización de escritura suficiente.

La integración nativa requiere aprobación y scopes oficiales de Toast. Por tanto:

- Implementa y prueba hoy toda la arquitectura independiente de esos permisos.
- Construye adapters y feature flags para conectar el sandbox cuando lleguen las credenciales.
- No simules respuestas exitosas de Toast.
- No crees un ticket productivo ni cobres a una tarjeta real sin autorización expresa de Carlos para esa prueba.
- Cuando un paso dependa de Toast, muestra y documenta `BLOCKED_EXTERNALLY`.
- No regreses al wrapper externo para ocultar el bloqueo.

## Lectura obligatoria antes de trabajar

Lee completamente:

- `C:\Users\pedro\Desktop\teg-modernizado\AGENTS.md`.
- `C:\Users\pedro\Desktop\gavilan-app\AGENTS.md`.
- El chat “Tacos Gavilan App”, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`, desde el step 6922 hasta el final actual.
- `C:\Users\pedro\Desktop\teg-modernizado\docs\PROMPT_ANTIGRAVITY_SIGUIENTE_HITO_PICKUP_REAL_2026-10-08.md`.
- La documentación oficial actual de Toast sobre integration types, Menus V3, Orders API, `/prices`, Credit Cards API, stock, restaurant availability, dining options, order management configuration, webhooks e integración de online ordering.
- El encabezado JSDoc y el contenido completo, línea por línea, de cada módulo que vayas a editar.

Fuentes oficiales mínimas:

- `https://doc.toasttab.com/doc/devguide/apiIntegrationTypes.html`
- `https://doc.toasttab.com/doc/devguide/integrationDevProcess.html`
- `https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistOrdering.html`
- `https://doc.toasttab.com/doc/devguide/apiCreatingOrders.html`
- `https://doc.toasttab.com/doc/devguide/apiOrdersFirstOrder.html`
- `https://doc.toasttab.com/doc/devguide/authorizingCcPayments.html`
- `https://doc.toasttab.com/openapi/orders/overview/`

No utilices blogs o suposiciones como autoridad para scopes, pagos, impuestos o Delivery.

## Estado actual que debes tratar como no terminado

No confíes en mensajes anteriores que dicen “100%”, “plug-and-play”, “menú auténtico” o “engineering completo”. La auditoría encontró:

- Ninguna orden real creada en Toast POS/KDS.
- Ningún pago Toast o Stripe sandbox reconciliado.
- Ningún dispatch o entrega DoorDash.
- Menú de 216 productos clonado a las 15 sucursales.
- Modificadores globales/hardcodeados que no pertenecen necesariamente al producto.
- Checkout wrapper que abre `/order/checkout` sin carrito ni identidad.
- Confirmación manual falsa que puede borrar el carrito.
- Tracker que inventa estados Delivery desde estados de cocina.
- Dirección y coordenadas Delivery prellenadas.
- Backend con RPC privilegiadas insuficientemente protegidas.
- Endpoint de pago que recibe PAN/CVC directamente.
- Pruebas que cuentan un 403 controlado como PASS técnico.
- Build web HTTP 200, pero sin build nativo instalado ni prueba operativa.

## Arquitectura objetivo

```text
Tacos Gavilan App
        |
        | HTTPS + access token del usuario
        v
Backend autoritativo teg-modernizado
        |
        +--> Menus V3 / Config / Stock / Schedule
        |
        +--> Orders /prices
        |
        +--> Pago autorizado según flujo aprobado por Toast
        |
        +--> Transacción DB: quote + order + outbox
        |
        +--> Worker idempotente
        |
        +--> Toast POST /orders
        |
        +--> GUID real de Toast -> POS/KDS
        |
        +--> Delivery aprobado -> Toast/TDS/DoorDash
```

La app móvil nunca debe poseer secretos de Toast ni decidir precios, impuestos, estado de pago o estado de cocina.

## Fase 0 — Inventario y congelamiento seguro

1. Obtén HEAD, branches, `git status` y diff resumido de `teg-modernizado` y `gavilan-app`.
2. Identifica los commits y cambios sin commit del wrapper Toast, impuestos, delivery fee, animaciones y eliminación de contenido ficticio.
3. Preserva cambios ajenos. No uses reset, checkout destructivo o limpieza masiva.
4. No hagas commit, push o deploy sin una nueva autorización explícita de Carlos.
5. Deshabilita mediante feature flag el checkout wrapper y toda confirmación manual mientras desarrollas.
6. Conserva una ruta de desarrollo para probar UI, pero nunca muestres éxito externo simulado.

## Fase 1 — Eliminar inmediatamente el wrapper y las simulaciones

Elimina del flujo productivo:

- Apertura de Toast como supuesto checkout integrado.
- Botón “Sí, ya completé mi pedido”.
- Borrado de carrito al cerrar el navegador.
- Mensajes “orden enviada a cocina” sin Toast GUID.
- Navegación al tracker sin `orderId` autoritativo.
- `ToastCheckoutModal` si su única función es simular conclusión.
- Handlers muertos del checkout anterior.
- Formulario manual que envía PAN/CVC al backend.
- Dirección/latitud/longitud fija usada como si fuera del cliente.
- Delivery fee fijo, suplemento por distancia y radio inventado.
- Impuestos estáticos no verificados mediante Toast `/prices`.
- Estados de DoorDash inferidos desde `HOLDING`, `FIRED`, `PREPARING` o `READY`.
- Pedido ficticio “3x Tacos de Asada + Horchata”.
- “ORDEN EN LA PARRILLA” y “ETA: 8 min”.
- “MARTES DE TACOS”, “Doble Puntos” y “2x Gavilan Rewards” sin fuente real.
- Calorías inventadas.
- Puntos, niveles y beneficios ficticios.
- Botones de simulación visibles fuera de desarrollo.
- Referencias injustificadas a “Mendocino Farms”.

Si una funcionalidad no tiene una fuente autoritativa, ocúltala mediante feature flag. No la reemplaces por otro valor ficticio.

## Fase 2 — Cerrar la seguridad del backend

### RPC

1. Crea una migración nueva; no edites migraciones ya aplicadas.
2. Revoca `EXECUTE` de RPC privilegiadas a `PUBLIC`, `anon` y `authenticated` si son server-only.
3. Autoriza únicamente el rol necesario.
4. Define un `search_path` seguro.
5. No aceptes como autoridad `p_user_id`, `p_payment_status`, montos, precios, items, channel o dining option enviados por el cliente.
6. La identidad debe derivarse de la sesión validada o del backend con service role.
7. La quote debe cargarse desde DB, comprobar owner, expiración, hash, tienda, canal y estado.
8. Prueba explícitamente que un cliente Supabase directo no puede consumir quotes, crear órdenes `PAID` ni reclamar el outbox.

### Pagos y PCI

1. Deshabilita/elimina el endpoint que recibe tarjeta y CVC sin tokenización oficial.
2. No almacenes, registres ni retransmitas PAN/CVC en nuestro backend.
3. No uses Stripe como reemplazo automático si la decisión es utilizar Toast Payments.
4. Crea una interfaz `PaymentProvider` desacoplada, pero mantén el provider productivo deshabilitado hasta que Toast indique el mecanismo autorizado.
5. Implementa estados financieros separados: `PENDING_PAYMENT`, `AUTHORIZED`, `PAID`, `PAYMENT_FAILED`, `VOID_PENDING`, `VOIDED`, `REFUND_PENDING`, `REFUNDED`.
6. Ningún booleano del teléfono puede cambiar estos estados.

### Cron y menú

1. Protege todos los cron con `Authorization: Bearer`; nunca secretos en query params.
2. Evita `DELETE` seguido de `INSERT` fuera de transacción.
3. Implementa snapshots versionados o staging + swap.
4. Un fallo no puede dejar el menú vacío.
5. No sincronices un catálogo global como si fuera específico de cada restaurante.

### Cuenta y PII

1. Corrige eliminación de cuenta para no dejar estados parciales.
2. Define qué datos deben eliminarse, anonimizarse o conservarse legalmente.
3. Incluye addresses, phone, quotes, order snapshots y delivery data.
4. Nunca imprimas secretos.

## Fase 3 — Contrato autoritativo de catálogo Toast

Diseña e implementa el contrato preparado para Menus V3 por:

- `restaurantGuid`.
- canal de ordering.
- horario.
- disponibilidad.
- visibility.
- version/hash del menú.
- grupos y subgrupos.
- productos.
- tamaños.
- modifier groups.
- defaults.
- min/max selections.
- multiplicidad.
- nested modifiers.
- precios y price inheritance.
- stock/availability.
- imágenes autorizadas.

Reglas:

1. No inventes GUIDs como `group-*`, `mod-cebolla`, `sin-*`, `ext_*` o `tort_*`.
2. Un modifier GUID debe pertenecer al grupo y producto correctos.
3. Valida min/max, required, exclusive, duplicates y nested choices en servidor.
4. Un modifier desconocido produce error; nunca se descarta silenciosamente.
5. Separa `cartLineId` local de todos los GUIDs Toast.
6. Si Menus V3 no está autorizado, deja el catálogo como `BLOCKED_EXTERNALLY` y usa fixtures explícitamente marcados solo en tests/dev, nunca en builds productivos.
7. El menú offline puede mostrarse únicamente como snapshot no comprable y claramente desactualizado.

## Fase 4 — Carrito nativo y quote Toast

Implementa un carrito propio sólido:

- tienda única por carrito.
- canal único por carrito.
- product GUID real.
- modifier GUIDs reales.
- cantidades enteras positivas y límites.
- instrucciones sanitizadas.
- dining option validada.
- fulfillment time validado.
- hash canónico.
- persistencia segura.
- invalidación al cambiar tienda/canal/menú.

Invariante de precio:

- La app puede mostrar un estimado de catálogo.
- El total comprable solo puede provenir de Toast `/prices`.
- Base price y modifier price no se suman dos veces.
- Impuestos, service charges, descuentos, fees y total se leen de `/prices`.
- No mantengas tablas estáticas de impuestos como autoridad.
- La quote persistida debe contener respuesta sanitizada de Toast, versión, expiración, usuario, tienda, canal y hash.
- Cambiar cualquier elemento invalida la quote.

Mientras `/prices` responda 403, el botón final debe decir “Pedidos temporalmente no disponibles” y explicar que la integración se está habilitando. No permitas completar una orden con cálculo local.

## Fase 5 — Pago nativo aprobado por Toast

No elijas el mecanismo por inferencia. Prepara dos adapters deshabilitados y documentados:

### Adapter A — Toast Credit Cards API

Para activar solamente si Toast concede:

- `credit_cards.authorization:write`.
- encryption key y procedimiento oficial.
- merchant UUID.
- alcance/certificación correspondiente.

Flujo:

1. Llamar `/prices`.
2. Generar payment UUID único.
3. Tokenizar/cifrar tarjeta exactamente como Toast indique.
4. Autorizar por el monto exacto.
5. Crear la orden dentro de la ventana permitida.
6. Aplicar el payment UUID.
7. Reconciliar autorización, orden, captura, void y refund.

Nunca implementes criptografía casera ni recibas PAN/CVC sin el componente aprobado.

### Adapter B — Proveedor externo + Toast OTHER payment

Solo si Toast confirma por escrito que el modelo es permitido:

1. Procesador tokeniza en cliente mediante SDK oficial.
2. Backend valida quote y autoriza el monto.
3. Toast recibe el payment type alternativo configurado.
4. Refund debe conciliarse tanto en procesador como en Toast.

No actives Stripe por decisión propia.

## Fase 6 — Creación atómica e idempotente de la orden

1. Quote debe ser single-use.
2. Payment debe estar autorizado/confirmado según el flujo aprobado.
3. Usa RPC/transacción para:
   - validar quote.
   - reservar idempotency key.
   - insertar order.
   - consumir quote.
   - crear outbox.
4. Si cualquier paso falla, revierte todo.
5. No insertes columnas PostgreSQL generadas.
6. Claim del outbox debe ser atómico con lease, owner, `locked_at`, `next_retry_at` y recuperación de lock vencido.
7. Dos workers no pueden procesar el mismo registro simultáneamente.
8. Usa `externalId` único y estable para Order, Check y Selection conforme Toast.
9. Antes de reintentar, consulta/reconcilia si Toast pudo aceptar el pedido.
10. Si Toast acepta, persiste GUID y respuesta sanitizada antes de confirmar al cliente.
11. Si el proceso cae después del POST, evita duplicar mediante external IDs y reconciliación.
12. No prometas exactly-once si no puedes demostrarlo.
13. Define compensación: void/refund si el pago existe y la orden no puede completarse.

## Fase 7 — Pickup nativo

Implementa primero una sola sucursal piloto: **Lynwood #14**, GUID conocido `80a1ec95-bc73-402e-8884-e5abbe9343e6`, pero no envíes pedidos reales sin autorización.

Flujo objetivo:

1. Menú Lynwood real.
2. Dining option Pickup real.
3. Horario y disponibilidad oficiales.
4. Quote `/prices`.
5. Pago sandbox autorizado.
6. Orden creada una vez.
7. GUID Toast persistido.
8. Ticket visible en POS/KDS.
9. Estado mostrado solo desde información oficial o una definición operacional honesta.
10. Cancelación/void/refund controlado.

No actives Hold-and-Fire, geofence o curbside hasta demostrar que Toast soporta el flujo configurado y que no puede dispararse con coordenadas/ETA manipuladas.

## Fase 8 — Delivery nativo con Toast y DoorDash

Mantén Delivery deshabilitado mediante feature flag hasta recibir confirmación contractual.

Solicita determinar una de estas modalidades:

- Toast Delivery Services con DoorDash.
- DoorDash Drive administrado por Tacos Gavilan.
- Otra modalidad first-party aprobada por Toast.

No mezcles modalidades ni cambies configuración productiva.

Cuando esté autorizada, el flujo debe incluir:

1. Dirección capturada por el usuario, nunca prellenada como real.
2. Autocomplete/geocoding permitido.
3. Normalización y validación server-side.
4. Correspondencia verificable entre texto y coordenadas.
5. Cobertura/cotización oficial con expiración.
6. Delivery dining option correcto.
7. Quote Toast con impuestos y service charges.
8. Pago.
9. Orden Toast.
10. Dispatch idempotente al proveedor correcto.
11. `delivery_status` separado de `kitchen_status`.
12. Webhooks firmados, event ID único, anti-replay y transiciones monotónicas.
13. Tracking, Dasher y ETA solamente si el proveedor los entrega.
14. Cancelación y refund coordinados.

No muestres $5.99, +$1.75, 6 millas, 10 millas o cualquier regla no confirmada.

## Fase 9 — App móvil lista para integración

1. Auth persistente con SecureStore.
2. Refresh token y expiración reales.
3. Route guard y regreso al checkout después de login.
4. Persistencia de tienda, carrito, quote vigente y orden activa.
5. Recuperación después de cerrar/reabrir la app.
6. Tracker requiere `orderId` autoritativo.
7. Tracker resuelve la tienda desde la orden.
8. Ningún estado local cambia cocina, pago o delivery.
9. Elimina `DEFAULT_STORE` de decisiones de órdenes.
10. Elimina fallbacks comprables de Lynwood para otras sucursales.
11. Configura development, preview y production con HTTPS.
12. Ningún build físico usa localhost.
13. Completa EAS `owner`, `projectId`, `runtimeVersion`, update channels y credenciales con valores reales.
14. No incluyas secretos de Toast o DoorDash en Expo.
15. Aplica accesibilidad y manejo de errores/reintentos.

## Fase 10 — Solicitud formal a Toast

Genera un documento y correo profesional listos para enviar al representante de Toast.

### Solicitud de integración

Explica:

- Tacos Gavilan opera 15 restaurantes.
- Se desarrolla una app oficial propia para iOS y Android.
- Se necesita ordering completamente nativo.
- Pickup debe entrar directamente a Toast POS/KDS.
- Delivery debe conservar precio de tienda y utilizar la modalidad Toast/DoorDash ya contratada.
- Lynwood será la ubicación piloto.

### Solicita explícitamente

- Custom integration o tipo que Toast recomiende.
- Sandbox y credenciales de prueba.
- `orders.orders:write`.
- `orders.payments:write`.
- `orders.delivery_info:write`.
- `credit_cards.authorization:write`.
- `config:read`.
- `menus.channel:read`.
- `digital_schedule:read`.
- `restaurants:read`.
- `stock:read`.
- `packaging:read`.
- `/prices`.
- Menus V3 por ubicación/canal.
- Webhooks/eventos de órdenes.
- Order source “Tacos Gavilan App”.
- Dining options y service charges.
- Payment encryption/tokenization requirements.
- Refund/void workflow.
- Delivery/TDS/DoorDash workflow.
- Idempotency/reconciliation guidance.

Incluye el error sanitizado `403 / 10010`. Nunca incluyas client secret, token o llaves.

### Preguntas que Toast debe responder

1. ¿Qué proceso de aprobación/certificación requiere la app?
2. ¿Qué scopes exactos habilitarán para las 15 locations?
3. ¿Cómo debe procesarse el pago dentro de una custom mobile app?
4. ¿Toast proporciona componente/SDK de tokenización o encryption key?
5. ¿Cómo se reconcilia una autorización si falla `POST /orders`?
6. ¿Qué `externalId`/idempotency/reconciliation recomiendan?
7. ¿Cómo se recibe disponibilidad y horario de ordering?
8. ¿Cómo opera Delivery con el contrato actual de DoorDash?
9. ¿Qué webhook proporciona courier, ETA y delivery status?
10. ¿Qué pruebas requieren antes de activar producción?

## Pruebas obligatorias

Cumple íntegramente `AGENTS.md`.

### Seguridad

- `anon` no ejecuta RPC server-only.
- Usuario A no consume quote de usuario B.
- Cliente no puede establecer `PAID`.
- PAN/CVC nunca llega a nuestro backend en el flujo habilitado.
- Cron rechaza ausencia/token incorrecto/query secret.
- Webhooks rechazan firma inválida, replay y duplicados.

### Catálogo

- GUID inexistente, de otra tienda o grupo: rechazo.
- Min/max/default/exclusive/nested/duplicates.
- Menú vacío o sync parcial no reemplaza snapshot vigente.
- Diferencias de precio o disponibilidad invalidan quote.

### Dinero

- `/prices` es la única autoridad final.
- $2.29 + $1.50 = $3.79.
- Cantidades múltiples y redondeo en centavos.
- Cero, negativos, NaN, Infinity, tip máximo y moneda.
- Monto del pago coincide exactamente con quote.

### Atomicidad y concurrencia

- Dos create simultáneos: una orden/outbox.
- Dos workers: un claim.
- Lock abandonado: recuperación.
- Tres fallos: backoff/dead letter.
- Timeout posterior a aceptación: reconciliación sin duplicado.
- Fallo en cada etapa RPC: cero estado parcial.

### Tiempo

- Quote expirada.
- 5:59/6:00 AM.
- Medianoche.
- DST.
- `America/Los_Angeles`.
- Horarios oficiales por restaurante.

### Mutación DB

- IDs de prueba únicos.
- Verificación posterior.
- Cleanup exacto.
- Confirmar que no quedan quotes, orders, events u outbox de prueba.
- Nunca enviar columnas generadas.

### Integración externa

- Un 403 demuestra bloqueo, no integración aprobada.
- No contar mocks como sandbox.
- Cuando lleguen credenciales: `/prices`, pago sandbox, orden, POS/KDS, cancelación/refund.
- Después: delivery simulator y entrega piloto autorizada.

### Build

- `npx tsc --noEmit` en ambos repos.
- Tests reproducibles.
- `expo-doctor` completo.
- EAS preview iOS/Android.
- Instalación física en iPhone y Android.
- Reinicio y recuperación de sesión/orden.

## Definición estricta de terminado

### “Código preparado”

Puede declararse cuando arquitectura, seguridad, adapters, feature flags y tests locales estén terminados, aunque Toast siga en 403.

### “Sandbox Toast probado”

Solo cuando exista evidencia de `/prices`, pago autorizado, orden creada y GUID Toast en entorno aprobado.

### “Pickup piloto probado”

Solo cuando un pedido controlado aparezca una vez en POS/KDS Lynwood y se complete/cancele/refunde correctamente.

### “Delivery probado”

Solo cuando exista cotización oficial, dispatch, webhook, tracking y entrega piloto autorizada.

### “Lista para tiendas”

Solo después de build instalado, pruebas de dispositivos, políticas, privacidad, soporte y testing interno.

No mezcles estas categorías.

## Reglas invariables

- Nombre oficial: **Tacos Gavilan**, nunca “Tacos El Gavilan”, salvo slug externo histórico documentado.
- No inventar productos, modificadores, precios, impuestos, tarifas, horarios, promociones, rewards, calorías, estados o ETA.
- No usar emojis como iconos.
- No crear fotografías nuevas.
- No tocar reportes, horas, `scripts/*_full_data.json`, `lib/reports-data.ts` o documentos del chat de pendientes.
- No hacer commit, push o deploy sin nueva autorización explícita de Carlos.
- Todo `.ts`/`.tsx` nuevo o editado debe tener JSDoc con `@module`, `@description`, `@businessRules`, `@dataFlow` y `@notes`.
- Si cambia funcionalidad, actualiza `app/api/support-chat/route.ts` y `lib/chat-tools.ts` con el estado real.
- No imprimir secretos.
- No modificar destructivamente migraciones aplicadas.
- Preservar cambios ajenos.

## Entregables de este ciclo

1. Matriz UI / lógica local / sandbox / piloto / bloqueo externo.
2. Inventario exacto de archivos modificados.
3. Migración de seguridad RPC y sus pruebas.
4. Evidencia de eliminación del wrapper, falso éxito y contenido simulado.
5. Contratos TypeScript del catálogo, quote, pago, orden y delivery.
6. Adapters Toast deshabilitados por feature flag hasta recibir scopes.
7. Pruebas y simulaciones con salidas agrupadas por nivel.
8. Estado de DB y cleanup de pruebas.
9. Documento/correo listo para Toast.
10. Lista exacta de accesos que debe proporcionar Carlos/Toast.
11. Estado Git de ambos repositorios.
12. Próximo paso mínimo.

Detente sin commit, push ni deploy. Si Toast continúa devolviendo 403, el resultado correcto es **código preparado + integración nativa bloqueada externamente**, no una redirección, un WebView ni una confirmación simulada.
