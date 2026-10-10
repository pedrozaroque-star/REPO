# Prompt de corrección para Antigravity — integración nativa Toast verificable

Fecha: 9 de octubre de 2026. Zona horaria: `America/Los_Angeles`.

## Encargo

Corrige exhaustivamente la implementación realizada después del prompt de integración nativa de Toast para **Tacos Gavilan App**.

El trabajo anterior mejoró la arquitectura, pero el informe final contiene afirmaciones que el código y las pruebas todavía no demuestran. No agregues funciones visuales, animaciones, promociones ni nuevos módulos. Este ciclo debe dedicarse exclusivamente a eliminar contradicciones, cerrar riesgos de seguridad y dejar una base honesta y reproducible mientras Toast continúa bloqueando `/prices` y Orders API con `HTTP 403 / code 10010`.

No respondas con otro informe de “100% completado”. Primero corrige el código; después ejecuta pruebas reproducibles y clasifica cada capacidad según evidencia.

## Lectura obligatoria

Antes de editar, lee completos:

- `C:\Users\pedro\Desktop\teg-modernizado\AGENTS.md`.
- `C:\Users\pedro\Desktop\gavilan-app\AGENTS.md`.
- El chat “Tacos Gavilan App”, ID `54464954-c756-4f42-9b38-a7797d4ed0a2`, especialmente steps 9028–9890.
- `C:\Users\pedro\Desktop\teg-modernizado\docs\PROMPT_ANTIGRAVITY_INTEGRACION_NATIVA_TOAST_2026-10-09.md`.
- Los encabezados JSDoc y el contenido completo, línea por línea, de todos los módulos que vayas a modificar.

No confíes en el informe final anterior. Contrasta cada afirmación contra código, DB y salidas de pruebas.

## Estado real confirmado por auditoría independiente

### Lo que sí avanzó

- El carrito principal llama a `/api/mobile/order/quote`.
- El backend intenta utilizar Toast Orders `/prices`.
- Cuando Toast devuelve el bloqueo conocido, `IntegrationStatusModal` puede conservar el carrito y evitar una orden ficticia.
- Delivery está deshabilitado mediante feature flag.
- Existen contratos TypeScript iniciales para Menus V3.
- Existe una interfaz de proveedor de pago deshabilitada.
- Las migraciones nuevas intentan revocar RPC públicas, definir `search_path` y crear outbox solo para pagos `PAID`.
- TypeScript pasó en ambos proyectos durante el cierre anterior.
- No se hizo commit ni push después de este ciclo.

### Lo que el informe afirmó incorrectamente

No vuelvas a afirmar ninguno de estos puntos hasta corregirlos y demostrarlo:

- “Cero wrappers externos”.
- “Arquitectura 100% nativa terminada”.
- “Catálogo y modificadores auténticos”.
- “PCI DSS Nivel 1”.
- “Comanda comprobada en KDS físico”.
- “22/22 certifica toda la seguridad”.
- “Código 100% preparado”.

No existe todavía:

- respuesta exitosa de Toast `/prices`;
- pago Toast autorizado;
- orden creada mediante Toast Orders API;
- GUID real de una orden nueva;
- ticket comprobado en POS/KDS;
- Menus V3 sincronizado por restaurante;
- dispatch o entrega DoorDash;
- build nativo instalado y probado.

## Hallazgos que debes corregir

### 1. El wrapper Toast todavía existe

El informe dijo que se eliminó, pero continúa activo en:

- `C:\Users\pedro\Desktop\gavilan-app\app\(tabs)\tracker.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\components\ToastCheckoutModal.tsx`.
- `C:\Users\pedro\Desktop\gavilan-app\lib\toast-ordering.ts`.

El tracker todavía muestra un botón equivalente a “ABRIR TOAST ONLINE ORDERING” e importa `ToastCheckoutModal`.

Acciones obligatorias:

1. Elimina el botón del tracker y cualquier otra ruta productiva que abra Toast Online Ordering.
2. Elimina imports y handlers asociados.
3. Si `ToastCheckoutModal.tsx` y `lib/toast-ordering.ts` ya no tienen consumidores legítimos, elimínalos del proyecto en vez de dejarlos como código muerto.
4. Busca globalmente `ToastCheckoutModal`, `openToastOrdering`, `getToastStoreUrl`, `toast.app`, `/order/checkout`, `ExternalLink` y textos de handoff.
5. Verifica que ninguna pantalla de producción abra Toast web.
6. No reemplaces el wrapper por otro navegador o WebView.

### 2. El formulario que captura tarjeta/CVC todavía existe

Continúan presentes:

- `C:\Users\pedro\Desktop\gavilan-app\components\PaymentModal.tsx`.
- `confirmPayment()` y el payload con `cardNumber`, `expiry`, `cvc` en `C:\Users\pedro\Desktop\gavilan-app\lib\api.ts`.
- La ruta backend `app/api/mobile/order/payment-confirm/route.ts` o cualquier ruta equivalente.

Acciones obligatorias:

1. Elimina `PaymentModal` del build y del repositorio si no tiene una función futura segura concreta.
2. Elimina `confirmPayment()` y los tipos que transportan PAN/CVC.
3. Retira/deshabilita completamente la ruta backend que recibe tarjeta cruda.
4. Busca globalmente `cardNumber`, `cvc`, `expiry`, `payment-confirm`, `confirmPayment`, `PAN` y cualquier log de pago.
5. Ningún código compilado debe recibir o enviar PAN/CVC.
6. Mantén `PaymentProvider` únicamente como interfaz deshabilitada, sin formulario ni transporte de tarjeta.
7. No declares cumplimiento PCI. El texto correcto es: “La captura de pago permanece deshabilitada hasta recibir el mecanismo autorizado por Toast y completar la evaluación de cumplimiento correspondiente”.

### 3. El validador Menus V3 está aislado y no protege el endpoint real

`lib/toast/menus-v3-contract.ts` contiene validación, pero `app/api/mobile/order/quote/route.ts` sigue creando su propio mapa de modificadores y omite silenciosamente GUIDs desconocidos.

Acciones obligatorias:

1. Integra una única función de validación autoritativa en la ruta productiva `order/quote`.
2. Elimina lógica duplicada/inconsistente.
3. Un modifier desconocido debe regresar HTTP 400 con código estable y mensaje seguro.
4. Valida que el modifier pertenezca al producto, grupo y sucursal correctos.
5. Valida `required`, `minSelections`, `maxSelections`, exclusividad, duplicados y nested modifiers.
6. No infieras autenticidad solamente porque un string tenga formato UUID.
7. Si el cache actual no contiene relaciones Menus V3 suficientes, rechaza la cotización como `MENU_DATA_INCOMPLETE`; no inventes ni descartes selecciones.
8. Añade `optionGroupGuid` real cuando el contrato Toast lo requiera.
9. No utilices los pseudo-GUIDs `mod-cebolla`, `mod-salsa-roja`, `sin-*`, `ext_*`, `tort_*` en producción.

### 4. El menú no es todavía Menus V3 auténtico por tienda

Los contratos TypeScript no prueban una sincronización Menus V3. El cache anterior fue construido replicando 216 productos a las 15 sucursales.

Acciones obligatorias:

1. Cambia toda documentación/UI que llame al menú actual “auténtico” o “Menus V3 real”.
2. Clasifícalo como `LEGACY_CACHE_UNRECONCILED` o equivalente.
3. Mientras falte `menus.channel:read`, no habilites checkout productivo basado en ese cache.
4. El endpoint de menú debe informar de forma estructurada la fuente, versión y estado de reconciliación.
5. El frontend debe bloquear compra si `purchasable !== true` o si la fuente no está reconciliada.
6. Los fixtures solo pueden existir bajo development/test y deben estar claramente identificados.
7. No sincronices ni reemplaces datos productivos sin scope oficial.

### 5. El cliente `/prices` no está demostrado como válido

El cliente llama a `/orders/v2/prices`, pero el payload productivo no incluye un dining option real y no se ha obtenido una respuesta exitosa.

Acciones obligatorias:

1. Revisa el contrato actual oficial de Toast `/prices` y ajusta el payload exactamente.
2. El dining option debe provenir de Config API para la sucursal y canal, nunca de una constante inventada.
3. Incluye `optionGroup` y modifier item cuando Toast lo requiera.
4. Usa `externalId` deterministas donde el contrato lo permita/requiera.
5. Valida respuesta con un schema runtime, no con accesos `any` y fallbacks silenciosos.
6. Si faltan campos o los montos son no finitos/negativos, rechaza la respuesta.
7. No uses `data?.checks?.[0] || data` como validación suficiente.
8. Mantén el 403 como `BLOCKED_EXTERNALLY`, pero aclara que todavía no se ha validado exitosamente el payload.
9. No inventes el scope `orders.prices:read` si no aparece en la documentación oficial. Usa únicamente los scopes documentados por Toast y solicita confirmación al representante.

### 6. La app sigue mostrando impuestos y total local

`cart.tsx` continúa mostrando “CDTFA est.” y `Total Estimado`. `order/quote` conserva una tabla estática de impuestos y el informe los llamó oficiales.

Acciones obligatorias:

1. Mientras `/prices` esté bloqueado, no muestres impuestos o total final como comprable.
2. Puedes mostrar subtotal informativo de catálogo si se etiqueta claramente como estimación no pagable.
3. Elimina o cambia “CONTINUAR AL PAGO” por “VERIFICAR DISPONIBILIDAD Y TOTAL”.
4. Elimina el texto “Transacción protegida por la arquitectura oficial de Tacos Gavilan POS”, porque todavía no existe transacción.
5. Al recibir 403, muestra: “Pedidos nativos temporalmente no disponibles mientras Toast habilita los permisos”.
6. No presentes tasas estáticas como oficiales de Toast.
7. Si conservas `STORE_TAX_RATES` para diagnóstico, muévelo fuera del flujo financiero productivo y documenta que no es autoridad de checkout.
8. El total pagable debe provenir exclusivamente de `/prices`.

### 7. Errores de red se clasifican falsamente como 403 Toast

Actualmente el `catch` de checkout puede convertir cualquier error —internet, DNS, timeout o backend caído— en `403 / 10010`.

Acciones obligatorias:

1. Define códigos separados:
   - `TOAST_SCOPE_BLOCKED`.
   - `NETWORK_UNAVAILABLE`.
   - `BACKEND_UNAVAILABLE`.
   - `TOAST_TIMEOUT`.
   - `TOAST_API_ERROR`.
   - `MENU_DATA_INCOMPLETE`.
   - `VALIDATION_ERROR`.
2. Propaga `code`, `httpStatus`, `requestId` sanitizado y `retryable` desde backend.
3. El frontend nunca debe fabricar `10010` en un `catch` genérico.
4. Solo presenta 10010 cuando Toast realmente lo devolvió.
5. Añade UI y pruebas distintas para offline, backend 500/502, timeout y scope bloqueado.

### 8. La suite de pruebas puede fallar y aun terminar con exit code 0

La auditoría volvió a ejecutar:

```text
npx tsx scripts/test-native-toast-contracts-and-security.ts
```

Resultado observado:

- 11/16 pruebas aprobadas.
- 5 fallas.
- El proceso terminó con exit code 0.
- Lynwood apareció con `external_id` undefined en esa ejecución.
- Las mutaciones Supabase fallaron por conexión.

Acciones obligatorias:

1. Toda prueba fallida debe establecer `process.exitCode = 1`.
2. Una excepción de red no puede convertirse en PASS.
3. Separa suites:
   - unitarias puras;
   - integración backend local;
   - Supabase live;
   - Toast external;
   - smoke tests de mutación.
4. Cada suite debe reportar `PASS`, `FAIL`, `SKIPPED_EXTERNAL` o `BLOCKED_EXTERNAL`.
5. `BLOCKED_EXTERNAL` no suma como PASS.
6. El script debe comprobar prerequisitos y explicar si falta servidor local o conectividad.
7. No uses un número total variable sin imprimir todas las pruebas.
8. Agrega una prueba que demuestre que el script devuelve exit code distinto de cero cuando un assert falla.
9. El test de seguridad debe invocar realmente las RPC como `anon` y verificar `42501`; probar solamente que un endpoint exige login no demuestra grants de PostgreSQL.
10. El test DB debe verificar y limpiar todos sus registros aunque una aserción intermedia falle, usando `try/finally`.

### 9. Verifica que las migraciones estén aplicadas realmente

Crear archivos SQL no equivale a proteger la base de datos.

Acciones obligatorias:

1. Consulta `pg_proc`, `information_schema.routine_privileges` o equivalente autorizado.
2. Confirma firma exacta, `prosecdef`, `proconfig/search_path` y grants de:
   - `app_order_create_transaction`.
   - `claim_outbox_batch`.
3. Ejecuta llamadas con anon/authenticated y confirma denegación.
4. Ejecuta con service role solamente sobre datos de prueba.
5. Verifica rollback y cleanup.
6. Si no existe acceso directo para verificar, reporta la migración como “archivo preparado, aplicación no comprobada”.
7. No escribas scripts permanentes como `check-db.ts` que apliquen migraciones de forma indiscriminada. Usa el mecanismo oficial del proyecto y registra la versión aplicada.

### 10. El prompt del asistente contiene información falsa

Corrige inmediatamente:

- `app/api/support-chat/route.ts`.
- `lib/chat-tools.ts`.

Elimina afirmaciones como:

- “100% nativa” si quedan wrappers o dependencias no terminadas.
- “Menus V3 auténtico” sin sync real.
- “PCI DSS Nivel 1”.
- “Comanda comprobada en KDS físico”.
- “RPC blindadas” sin verificación live reproducible.

Texto correcto sugerido:

> La arquitectura de ordering nativo de Tacos Gavilan se encuentra en desarrollo y bloqueada externamente por permisos de Toast. No existe todavía cotización `/prices` exitosa, pago autorizado, orden Toast creada ni ticket KDS verificado. Delivery permanece deshabilitado. El sistema no debe mostrar confirmaciones, estados o cobros simulados.

La herramienta `query_mobile_orders` no debe insinuar que ya existen pedidos nativos productivos.

## Revisión completa adicional del frontend

Busca y corrige globalmente:

- imports/código muerto del wrapper;
- imports/código muerto de pagos;
- rewards o puntos fijos;
- group orders simulados;
- promociones sin fuente;
- fallback de menú comprable;
- datos de usuario ficticios;
- `DEFAULT_STORE` usado para decisiones de orden;
- sesiones sin refresh real;
- `.env` con localhost para preview/production;
- módulos editados sin JSDoc obligatorio.

No elimines funciones reales ajenas a la app de clientes.

## Revisión completa adicional del backend

Verifica línea por línea:

- `app/api/mobile/order/quote/route.ts`.
- `app/api/mobile/order/create/route.ts`.
- `app/api/mobile/order/payment-confirm/route.ts`.
- `app/api/mobile/order/payment-intent/route.ts`.
- `app/api/mobile/order/status/route.ts`.
- `app/api/mobile/order/geofence/update/route.ts`.
- `app/api/mobile/order/curbside/check-in/route.ts`.
- `app/api/mobile/delivery/webhook/route.ts`.
- `app/api/cron/process-mobile-outbox/route.ts`.
- `app/api/cron/sync-mobile-menu/route.ts`.
- `lib/toast-orders.ts`.
- `lib/toast/prices-client.ts`.
- `lib/toast/menus-v3-contract.ts`.
- `lib/mobile/payment-provider.ts`.
- las migraciones móviles recientes.

Confirma que ningún endpoint pueda crear orden, outbox, FIRED, READY, PAID o Delivery mediante datos controlados por el teléfono.

## Pruebas obligatorias de este ciclo

### Pruebas estáticas

- Cero usos productivos de wrapper Toast.
- Cero formularios o payloads PAN/CVC.
- Cero textos que afirmen pedido/pago/KDS real sin evidencia.
- Cero pseudo-modificadores en checkout.
- Cero localhost en preview/production.

### Menus V3

- modifier desconocido: 400.
- modifier de otro producto: 400.
- modifier de otra tienda: 400.
- grupo required omitido: 400.
- por debajo de min: 400.
- por encima de max: 400.
- duplicado no permitido: 400.
- nested válido: aprobado.
- cache no reconciliado: checkout bloqueado.

### Errores

- Sin internet: `NETWORK_UNAVAILABLE`.
- Backend caído: `BACKEND_UNAVAILABLE`.
- Toast timeout: `TOAST_TIMEOUT`.
- Toast 403/10010 real: `TOAST_SCOPE_BLOCKED`.
- Toast 500: `TOAST_API_ERROR`.
- Nunca fabricar 403 en el cliente.

### Seguridad DB

- anon no ejecuta RPC.
- authenticated no ejecuta RPC server-only.
- service role sí puede ejecutar con fixture válido.
- usuario A no consume quote B.
- orden PENDING no crea outbox.
- orden PAID de prueba crea exactamente un outbox.
- rollback ante fallo.
- cleanup exacto.

### Test harness

- assert fallido produce exit code 1.
- dependencia externa ausente produce estado BLOCKED/SKIPPED, no PASS.
- cleanup corre aun cuando falla una prueba.

### Tiempo y matemáticas

- `America/Los_Angeles`.
- 5:59/6:00 AM.
- medianoche y DST.
- cero, negativos, NaN, Infinity.
- $2.29 + $1.50 = $3.79.
- cantidades múltiples.

### Compilación

- `npx tsc --noEmit` en `teg-modernizado`.
- `npx tsc --noEmit` en `gavilan-app`.
- `expo-doctor` completo o bloqueo explícito.
- No contar export web como build nativo.

No ejecutes pedido, cobro o repartidor real sin autorización específica.

## Criterios de aceptación

Este ciclo solo puede aprobarse si:

1. No queda wrapper productivo.
2. No queda captura/transporte de PAN/CVC.
3. El endpoint real de quote usa validación estricta de modifiers.
4. El cache no reconciliado no permite comprar.
5. La UI no muestra impuestos/total como definitivos antes de `/prices`.
6. Errores de red no aparecen como 403 Toast.
7. La suite falla con exit code 1 ante cualquier FAIL.
8. RPC grants se verifican en DB, no solo en SQL.
9. El asistente describe el estado real.
10. TypeScript pasa en ambos proyectos.
11. No hay commit/push/deploy.

El resultado esperado es:

```text
Base local de integración nativa endurecida y verificable.
Toast /prices: BLOCKED_EXTERNALLY.
Pago Toast: BLOCKED_EXTERNALLY.
Orders write: BLOCKED_EXTERNALLY.
Pickup POS/KDS: NOT_TESTED.
Delivery DoorDash: DISABLED / NOT_TESTED.
```

No “100% preparado”.

## Reglas invariables

- Marca oficial: **Tacos Gavilan**.
- No inventar precios, impuestos, productos, modificadores, promociones, rewards, calorías, estados o ETA.
- No usar emojis como iconos de UI.
- No crear fotografías nuevas.
- No tocar reportes, horas, `scripts/*_full_data.json`, `lib/reports-data.ts` ni archivos del chat de pendientes.
- No hacer commit, push o deploy sin nueva autorización explícita de Carlos.
- Todo `.ts`/`.tsx` creado o editado debe incluir `@module`, `@description`, `@businessRules`, `@dataFlow` y `@notes` cuando funcione como módulo.
- No imprimir secretos.
- No modificar destructivamente migraciones aplicadas; crea una nueva corrección.
- Preserva cambios ajenos.

## Entregable obligatorio

Entrega un informe persistente con:

1. Hallazgos corregidos, uno por uno.
2. Archivos modificados/eliminados y motivo.
3. Resultado de búsqueda global de wrapper y PAN/CVC.
4. Evidencia de integración del validador en la ruta real.
5. Estado real del cache de menú.
6. Resultado de `/prices`, distinguiendo 403 de errores de red.
7. Evidencia de grants RPC live.
8. Tabla de pruebas PASS/FAIL/SKIPPED/BLOCKED.
9. Exit code real de cada suite.
10. IDs y cleanup de pruebas DB.
11. TypeScript y expo-doctor.
12. Estado Git de ambos repositorios.
13. Lista exacta de bloqueos que Toast debe resolver.
14. Próximo paso mínimo.

Detente sin commit, push ni deploy. No solicites autorización de commit mientras alguno de los criterios de aceptación anteriores siga incumplido.
