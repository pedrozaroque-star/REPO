# Prompt de continuación para Antigravity — Tacos Gavilan App

Fecha: 8 de octubre de 2026. Zona horaria: America/Los_Angeles.

## Encargo

Continúa desarrollando la aplicación propia de clientes de Tacos Gavilan. La meta inmediata no es agregar más pantallas o decoración: completa un flujo vertical real y recuperable de **Pickup en una sola sucursal piloto**, desde autenticación y menú Toast auténtico hasta pago verificado, creación idempotente de la orden en Toast POS/KDS y estado comprobable.

Después de estabilizar Pickup, desarrolla Delivery solamente sobre una modalidad autorizada y probada de DoorDash/Toast. No presentes Delivery como terminado mientras solo existan un cliente API, webhooks sintéticos, tarifa fija o estados inferidos.

Este prompt corrige el reporte anterior que declaró “Hitos 0–5 completados”. Las pruebas 85/85 demostraron partes de lógica y mutaciones Supabase, pero no demostraron un cobro real, un ticket recibido por Toast/KDS, una entrega DoorDash, un piloto Lynwood o publicación en las tiendas. Conserva el trabajo útil y cambia la clasificación del avance para que refleje evidencia real.

## Lectura obligatoria antes de editar

Lee completamente:

- `C:\Users\pedro\Desktop\teg-modernizado\AGENTS.md`.
- `C:\Users\pedro\Desktop\gavilan-app\AGENTS.md`.
- La documentación inicial completa de cada `.ts`/`.tsx` que vayas a modificar.
- El chat “Tacos Gavilan App”, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`, especialmente desde el step 5400 hasta el final.
- `C:\Users\pedro\.gemini\antigravity\brain\54464954-c756-4f42-9b38-a7797d4ed0a2\audit_and_architecture_decision.md`.
- `integrations_and_access_matrix.md`, `api_contracts_pickup_delivery.md`, `toast_and_doordash_inquiries.md`, `roadmap_and_backlog.md` y `pilot_support_and_store_submission_guide.md` del mismo directorio.
- El prompt maestro anterior en `C:\Users\pedro\Desktop\teg-modernizado\docs\PROMPT_ANTIGRAVITY_APP_TACOS_GAVILAN_2026-10-08.md`.

No confíes en resúmenes ni en mensajes finales como evidencia de implementación. Revisa el código actual y ejecuta pruebas apropiadas.

## Estado confirmado después de la nueva auditoría

### Avances reales

- Existe una aplicación Expo Router con Inicio, Menú, Bolsa, Rastreo y Cuenta.
- La experiencia visual fue modernizada, se retiraron emojis visibles y se agregó una animación inspirada en el inicio del TEG System.
- La app se exportó dentro de TEG System y se añadieron rutas `/app` y `/ordenar`, entrada en la barra lateral y salida de la experiencia fullscreen web.
- El menú y personalización tienen una base visual amplia, selector Pickup/Delivery, carrito y desglose de cotización.
- Existen endpoints Next.js para menú, quote, create, status, geofence, curbside, payment-intent, delivery webhook y eliminación de usuario.
- Existen clientes iniciales `lib/toast-orders.ts` y `lib/doordash-drive.ts`.
- Se añadieron documentos de arquitectura, contratos, accesos y piloto.
- TypeScript pasa actualmente en `teg-modernizado`, `gavilan-app` y el backend Express heredado.
- `scripts/test_order_quote.ts` pasó 24/24 contra datos Supabase y verificó algunos cálculos, rango delivery y rechazo de GUIDs alterados.
- Hubo commits autorizados por Carlos antes del prompt maestro: `d2cfba5` en `gavilan-app` y `9fc4912` en `teg-modernizado`. Los cambios posteriores siguen mayormente sin commit.

### Clasificación honesta actual

- UI/prototipo móvil: aproximadamente 70–80%.
- Integración productiva completa: aproximadamente 20–30%.
- Pickup real recibido en Toast POS/KDS: no probado.
- Cobro real Stripe/Toast: no implementado de extremo a extremo ni probado.
- Delivery DoorDash real: no conectado ni probado.
- Piloto Lynwood: no ejecutado.
- TestFlight/Google Internal testing: no ejecutado.
- Publicación: no iniciada realmente.

Usa en adelante una matriz con estas categorías:

1. **UI implementada**: la pantalla existe, pero no prueba operación externa.
2. **Lógica local probada**: funciones o DB local/remota verificadas sin proveedor final.
3. **Sandbox externo probado**: respuesta verificable del entorno oficial del proveedor.
4. **Piloto real probado**: cobro/pedido/entrega controlados y conciliados.
5. **Bloqueado externamente**: requiere credenciales, contrato, scope o cuenta.

No uses “completado”, “production ready”, “cumplimiento total” o “live” para un hito que no alcanzó la categoría correspondiente.

## Fallos críticos que debes corregir primero

### 1. Pago manipulable y confirmación falsa

`app/api/mobile/order/payment-intent/route.ts` recibe `amountCents` desde el teléfono. El servidor debe obtener el monto exclusivamente de una cotización autoritativa persistida, vigente y perteneciente al usuario. El fallback de monto no puede existir.

`app/api/mobile/order/create/route.ts` confía en `paymentConfirmed === true` y en cualquier `paymentIntentId` enviado por el cliente. El cliente nunca será autoridad de pago. Consulta o recibe mediante webhook firmado el estado del procesador, verifica monto, moneda, usuario, quote y metadata.

La app activa envía `paymentIntentId: null` y aun así puede mostrar “Orden Confirmada” y vaciar el carrito. Cambia el flujo para que una orden PENDING no sea presentada como pagada, aceptada o enviada. Si aún no hay integración de pago disponible, deshabilita el botón de compra con un mensaje claro; permite seguir probando la cotización sin simular éxito.

No otorgues rewards por una bandera enviada desde el teléfono ni por una orden no conciliada.

### 2. Quote sin autoridad real

El `quoteId` actual es un UUID aleatorio no persistido ni firmado. Crea una tabla/mecanismo para cotizaciones con:

- usuario o sesión invitada;
- sucursal y canal;
- hash canónico del carrito, modificadores y dirección;
- subtotal, descuentos, impuestos, delivery fee, tip permitido y total;
- moneda;
- fuente y versión de precios;
- fecha de creación y expiración;
- estado `OPEN`, `CONSUMED`, `EXPIRED` o `CANCELLED`;
- restricción de uso único y clave de idempotencia.

El endpoint de pago recibe `quoteId`, carga la cotización en servidor y rechaza cualquier discrepancia. `create` consume la cotización de manera atómica y no acepta precios, totales o confirmación financiera del cliente.

### 3. FIRED aunque Toast falle

Geofence y curbside cambian a `FIRED` antes de saber si Toast aceptó la orden. Corrige la máquina de estados: la orden solo puede comunicar cocina iniciada cuando existe evidencia autoritativa definida por el flujo Toast/KDS. Si `injectOrderToToast` falla, guarda un estado explícito de error/reintento y responde sin `triggeredFire: true`.

No cambies `READY` porque el teléfono llegó físicamente a la tienda. Llegada del cliente y preparación de cocina son estados distintos.

### 4. Falta de idempotencia y concurrencia

Dos solicitudes concurrentes pueden crear tickets duplicados en Toast. Implementa un claim atómico/outbox o mecanismo equivalente:

- restricción única por orden e integración;
- estados de intento;
- claves idempotentes del proveedor cuando existan;
- bloqueo/claim transaccional;
- reintentos acotados;
- almacenamiento de request/response sanitizados y referencias externas;
- reconciliación ante timeout/respuesta perdida.

Aplica lo mismo a PaymentIntent y futuro dispatch DoorDash. Un doble toque, reintento móvil o webhook duplicado no debe duplicar dinero, tickets o repartidores.

### 5. Webhook DoorDash falsificable

`app/api/mobile/delivery/webhook/route.ts` acepta eventos sin verificar firma, secreto, autenticación o replay. Implementa exactamente el mecanismo documentado por DoorDash para la modalidad aprobada. Persiste un identificador de evento, rechaza duplicados y aplica transiciones monotónicas. Un evento tardío no puede retroceder `COMPLETED` a `READY`.

Mientras no haya credenciales o especificación contractual, devuelve un bloqueo explícito y no habilites el endpoint como fuente productiva.

### 6. Delivery todavía no llama a DoorDash

`dispatchDoorDashDelivery` existe, pero ningún flujo productivo lo invoca. La quote de Delivery actual usa Haversine y tarifa fija de $4.99; no es una cotización DoorDash. Etiqueta esos valores como configuración preliminar o retíralos del checkout comprable.

No conectes dispatch hasta que se resuelva por escrito la modalidad autorizada:

- TDS/Online Ordering con mecanismo oficialmente soportado para la app custom, o
- DoorDash Drive con acceso de producción y configuración Toast first-party delivery.

Toast documenta una restricción de coexistencia entre Toast Delivery Services y una delivery integration. No cambies la configuración de una sucursal ni interrumpas el Online Ordering actual sin decisión de Carlos y confirmación de Toast.

### 7. Dirección Delivery no se geocodifica

La app inicia con dirección y coordenadas fijas de Lynwood. Editar la calle o ZIP no actualiza latitud/longitud. Esto puede aceptar una dirección fuera de zona usando coordenadas antiguas.

Implementa autocomplete/geocoding autorizado y validación server-side. Liga coordenadas, dirección normalizada y quote. Si el texto cambia, invalida cotización y cobertura. No confíes en coordenadas arbitrarias enviadas por el cliente.

### 8. GUIDs Toast dañados en el frontend

`CustomizerModal.tsx` usa `${product.guid}-${Date.now()}` como ID de línea y `cart.tsx` intenta recuperar el GUID mediante `split('-')[0]`. Un UUID contiene guiones; el resultado queda truncado. Separa siempre:

- `cartLineId`: identificador local único;
- `productGuid`: UUID Toast original e inmutable;
- `modifierOptionGuid`: UUID Toast original;
- visual key: puede ser local, nunca sustituye al GUID comercial.

Los modificadores actuales `mod-cebolla`, `mod-salsa-roja` y otros IDs inventados se filtran o no corresponden a Toast. El personalizador debe consumir modifier groups reales, defaults, min/max, duplicados, nested modifiers y precios del catálogo de esa sucursal. Si los datos no están disponibles, bloquea la compra de ese producto en vez de enviar una selección incompleta.

### 9. Menú clonado para las 15 sucursales

El cron tomó `toast_menu_items` globales y replicó exactamente 216 filas a cada tienda: 3,240 registros. Eso no demuestra menú, precio, horario o stock por sucursal. Implementa la fuente autorizada por location/channel —Menus V3 para una integración ordering si Toast concede el scope— y conserva external IDs correctos.

No conviertas errores de red o menú vacío en un catálogo comprable hardcodeado. En producción, el modo offline permite explorar un snapshot claramente identificado si se decide, pero debe impedir checkout cuando no puede validar disponibilidad y precios.

### 10. Auth y persistencia incompletas

El splash entra directamente a tabs; checkout requiere token, pero no redirige al login. La sesión se guarda en memoria y se pierde al cerrar la app. Implementa:

- guard de rutas y retorno al flujo original después de autenticarse;
- sesión persistente en almacenamiento seguro apropiado;
- refresh y expiración reales;
- guest browsing separado de guest checkout si el backend no lo soporta;
- mensajes de error y recuperación.

No muestres teléfono ficticio, 350 puntos u Oro a invitados. Rewards debe provenir de una fuente real o permanecer deshabilitado.

### 11. Tracker usa sucursal y estados incorrectos

El tracker usa `DEFAULT_STORE`/Slauson incluso si la orden pertenece a otra sucursal y muestra Lynwood de forma fija. Carga la sucursal desde la orden autoritativa. Elimina el botón “Simular Viaje” de builds productivos y restringe simulaciones a desarrollo.

No traduzcas estados locales de cocina a supuestos estados DoorDash. Muestra delivery status, courier, ETA y tracking únicamente cuando el proveedor los haya enviado y estén ligados a esa orden.

### 12. Entornos y publicación

La app apunta a localhost en `.env` rastreado. En un teléfono, localhost es el teléfono. Define perfiles `development`, `preview/staging` y `production` con URLs HTTPS y variables EAS apropiadas. No guardes secretos en Expo ni en archivos versionados. Revisa el historial Git y rota credenciales si alguna credencial sensible fue versionada o expuesta; reporta el hallazgo a Carlos sin imprimir los valores.

Verifica `owner`, `projectId`, `runtimeVersion`, updates, notificaciones, URLs legales y target SDK mediante un build real. No marques API 36 o App Store readiness solo por verlo en una guía.

## Arquitectura a consolidar

El backend autoritativo para la app será Next.js en `teg-modernizado`. Retira el backend Express `gavilan-app-backend` del flujo activo y documenta que es legado. No lo despliegues. `gavilan-app/App.tsx` también es código legado muerto porque el entry actual es `expo-router/entry`; elimínalo o archívalo de forma segura después de confirmar que no se importa.

Flujo deseado para Pickup:

1. App obtiene sucursal, horarios, menú y stock autorizados.
2. Usuario arma carrito con GUIDs y reglas reales.
3. Backend crea cotización autoritativa persistida.
4. App presenta total y obtiene aceptación.
5. Backend crea/autoriza pago usando solamente la quote.
6. Webhook firmado confirma el estado financiero.
7. Worker/outbox reclama una vez la creación Toast.
8. Toast acepta el ticket y devuelve referencia.
9. App muestra estado real o, donde Toast no lo exponga, un estado operativo claramente definido.
10. Reintentos y timeouts se reconcilian sin duplicados.

No conectes el geofence Hold-and-Fire a producción hasta demostrar que el flujo operativo de Toast puede aceptar el momento de disparo y que el tracking móvil es confiable. Para el primer corte vertical, prioriza Pickup programado/inmediato soportado por Toast.

## Orden de ejecución

### Fase A — Reparar autoridad y seguridad

1. Haz inventario del estado Git en ambos repos y preserva cambios ajenos.
2. Repara la metadata/worktree de `gavilan-app` si `git status` sigue fallando, sin reset destructivo.
3. Añade JSDoc obligatorio a módulos editados.
4. Diseña/aplica migración nueva para quotes, intents/eventos de pago y outbox; no edites destructivamente migraciones históricas aplicadas.
5. Implementa quote persistida/single-use y payment intent derivado de quote.
6. Implementa webhook de pago firmado y transición financiera autoritativa.
7. Implementa dispatch Toast idempotente y estados de error honestos.
8. Corrige geofence/curbside para no marcar FIRED ante fallo.
9. Cierra o bloquea el webhook DoorDash hasta poder autenticarlo correctamente.

### Fase B — Corregir cliente móvil

1. Separa `cartLineId` de GUIDs Toast.
2. Usa modificadores reales; valida min/max y nested data.
3. Exige quote vigente antes de habilitar checkout.
4. Implementa auth persistente y navegación al login.
5. Configura entornos HTTPS y perfiles EAS.
6. Elimina catálogo comprable offline, recompensas ficticias, datos de usuario ficticios y confirmaciones falsas.
7. Corrige tracker por sucursal y limita simuladores a desarrollo.
8. Persiste orden activa para recuperar la pantalla después de reiniciar la app.

### Fase C — Pickup vertical slice

Usa una sola sucursal piloto elegida explícitamente por Carlos. Históricamente se propuso Lynwood, mientras el prototipo usa Slauson por default; no elijas por inferencia.

Con scopes/entorno autorizado:

1. Sincroniza su menú real.
2. Ejecuta una cotización real incluyendo impuestos.
3. Usa procesador en test/sandbox y valida webhook.
4. Crea un ticket de prueba controlado en Toast sandbox o ubicación piloto autorizada.
5. Verifica KDS/POS y todos los modificadores.
6. Reconcilia referencias app/payment/Toast.
7. Cancela/void/refund mediante el flujo correcto y documenta el resultado.

No ejecutes una orden productiva, cobro real o despacho de repartidor sin autoridad expresa para esa prueba específica. Mientras faltan scopes, completa toda la lógica independiente y demuestra el bloqueo con respuesta real sanitizada.

### Fase D — Delivery después de Pickup

Solo después de confirmar proveedor/modalidad:

1. Geocoding y normalización server-side.
2. Cobertura/cotización oficial con expiración.
3. Quote conjunta de comida, impuestos, delivery fee y propina.
4. Orden Toast con dining option Delivery correcto.
5. Dispatch DoorDash idempotente después del estado financiero/operativo definido.
6. Webhooks autenticados, monotónicos y reproducibles.
7. Cancelación, reembolso, soporte y tracking reales.
8. Simulador DoorDash y posteriormente una entrega piloto controlada.

## Pruebas obligatorias

No cuentes asserts que solo prueban funciones puras como integración de producción. Separa resultados por nivel.

- Unitarias: hash canónico, money math, state machine, transiciones monotónicas.
- API integradas: invocar routes productivas con auth; no insertar directamente en tablas evitando la lógica.
- DB mutation smoke: crear un registro de prueba identificable, verificarlo y limpiarlo. Nunca eliminar registros ajenos.
- Concurrencia: doble tap, dos workers, webhook repetido, timeout después de éxito externo.
- Límites: 0, negativos, fracciones, NaN/Infinity, cantidades máximas, tip máximo, expiración.
- Tiempo: DST, medianoche, 5:59/6:00 AM y horarios reales cuando apliquen.
- Frontend: dirección editada invalida coordenadas/quote; cambio de tienda invalida carrito incompatible; reinicio recupera sesión/orden.
- Toast sandbox/piloto: ticket único y modificadores correctos.
- Payment sandbox: monto igual a quote, webhook y devolución.
- DoorDash: simulator oficial y luego piloto autorizado; un webhook sintético local no equivale a integración.

Antes de cada mutación real muestra internamente el identificador/nombre de prueba y verifica que el cleanup apunta exactamente a ese registro. No envíes columnas PostgreSQL generadas.

Ejecuta `npx tsc --noEmit` en `teg-modernizado` y `gavilan-app`. Realiza build/export Expo solo cuando el entorno permita escribir sus carpetas y reporta claramente si un EPERM del sandbox impide verificarlo.

## Reglas invariables

- Nombre oficial: Tacos Gavilan.
- No generar fotografías nuevas; usar y mejorar las proporcionadas por Carlos.
- No usar emojis como iconos de la interfaz; usa iconografía consistente.
- No inventar slogans, precios, rewards, horarios, estados, tracking, tiendas abiertas o capacidades.
- No imprimir secretos, tokens o llaves. Comprueba presencia mediante booleanos/nombres redactados.
- No hacer commit o push sin una nueva instrucción explícita de Carlos.
- No tocar reportes ni horas: `scripts/*_full_data.json`, `lib/reports-data.ts`, exportaciones o conciliación multi-chat.
- Si cambias funcionalidades del sistema, actualiza `app/api/support-chat/route.ts` y `lib/chat-tools.ts` con el estado verdadero, preservando cambios existentes.
- Todo TS/TSX editado debe tener el bloque JSDoc requerido por AGENTS.md.
- No ejecutes cambios de configuración de Toast Delivery Services, first-party delivery o DoorDash productivo sin decisión de Carlos.

## Entregable de esta continuación

Al terminar este ciclo, entrega:

1. Matriz **UI / lógica local / sandbox / piloto / bloqueo externo** actualizada.
2. Lista exacta de archivos modificados y motivo.
3. Migración y contratos de quote/payment/outbox.
4. Evidencia de pruebas por nivel, sin llamar “real” a lo sintético.
5. Bloqueos externos con la respuesta o ausencia de scopes redactada.
6. Estado del corte vertical Pickup y el siguiente paso mínimo.
7. `git status` de ambos proyectos; no commit.

No cierres el trabajo con “Hitos completados” mientras no exista una orden Pickup de prueba conciliada de extremo a extremo. El objetivo de este ciclo es convertir el prototipo visual en una base financiera y operativa confiable.
