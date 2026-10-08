# Auditoría API, publicación, cron e interfaz COHESION

## Revalidación del 8 de octubre de 2026 — commit 7b5c848

Los **ocho archivos contables del alcance son idénticos byte por byte (SHA256)** a la versión ya leída completamente en esta auditoría. El commit consolidó los cambios que ya se habían verificado; no corrige los hallazgos pendientes descritos abajo. Se comparó su diff y el contenido actual contra la evidencia previa. El único archivo auxiliar distinto es middleware: agrega `/mantenimiento` a rutas públicas y mantiene APIs accounting fuera del matcher; se leyó completo nuevamente y no cambia la conclusión de seguridad.

Se repitió `npx tsx scripts/audit-cohesion-api-20261006.ts docs/cohesion-audit-20261006/api-runtime-evidence-20261008.json`: **exit 0, 13 verificaciones**. Persisten el acceso a validación sin autenticación, NaN en fallback y estimación $3,134.41 frente depósito real de muestra $2,774.70. Siguen aprobadas únicamente las correcciones específicas de aliases UI, preservación de depósito y cálculo de ventana cron. Nueva evidencia contiene hashes actuales y fecha de ejecución. No se hicieron mutaciones externas; estos resultados no prueban publicación end-to-end ni paridad contable con QBO.

Las líneas de hallazgos contables permanecen vigentes porque sus archivos no cambiaron. El matcher del middleware ahora está una línea más abajo. La limitación OAuth citada al final describe el corte anterior; el coordinador debe actualizar en su reporte maestro el resultado de la conexión QBO actual, sin inferirlo de este subanálisis.

Revisión del 7 de octubre de 2026. No aprobada para reemplazar Cohesion todavía. Se leyeron completos JSDoc y código de los 8 archivos del alcance, además del middleware; luego se releyeron los cambios concurrentes de Antigravity. Los hashes y conteos exactos corresponden a `cohesion-audit-20261006/api-runtime-evidence-20261007.json`. No se editó implementación, no se publicó a QuickBooks y no se hicieron mutaciones externas desde este subanálisis.

## Pruebas realizadas

`npx tsc --noEmit --incremental false`: exit 0, sin errores. Revalidación final SHA256 de los nueve archivos contra evidencia: cero cambios posteriores detectados al cerrar la revisión.

`npx tsx scripts/audit-cohesion-api-20261006.ts`: **13 verificaciones exitosas**. PASS significa que se reprodujo el resultado documentado, no que el módulo es correcto. Dos handlers reales recibieron requests sin sesión y cuerpo vacío; su respuesta fue 400 de validación de negocio, no 401/403. Se probaron expresiones reales extraídas del código actual, sin reemplazar dependencias con mocks, usando snapshot de 105 pólizas reales del 21–27 de septiembre. Se probó cron en medianoche, 05:59, 06:00, 16:59, 17:00 y cambio de horario de noviembre. El cálculo actual de ventana del cron pasó esas siete pruebas.

La primera ejecución en sandbox falló por `uv_os_get_passwd ENOMEM`; la repetición autorizada fuera del sandbox terminó con exit 0. No se ejecutaron mutaciones de pólizas ni publicación, por lo que no se afirma aprobación de esos flujos end-to-end. La prueba aislada de DB y lectura anónima corresponde al agente coordinador: `cohesion-audit-20261006/db-access-catalog.json`.

## Correcciones verificadas en esta segunda lectura

- `app/contabilidad/[packetId]/page.tsx:551,665,669,673`: ahora consume nombres DB `total_discounts`, `total_credit_cards_gross`, `credit_card_deposit`, `credit_card_fees`. El depósito real de muestra $2,774.70 ahora se formatea correctamente, no $0.00.
- `app/api/accounting/packets/route.ts:309` y `app/api/cron/sync-accounting/route.ts:259`: preservan depósito existente incluyendo cero; probados 0,100.25,null,undefined. Ya no corresponde reportar como vigente que todo recálculo sustituye automáticamente depósitos por efectivo esperado.
- Ambos generadores pasan mapeos GL al motor y ahora incluyen ventas kiosk. El cron consume descuentos reales y audita también pólizas publicadas de ayer. Hora 24 normalizada con `%24`.
- La edición de efectivo usa cuentas configuradas `undeposited_funds_account` y `cash_over_short_account`; ya no corresponde reportarlas como siempre hardcoded.
- `app/contabilidad/page.tsx:204` conecta botón Publicar Día al endpoint batch. Publicación elimina líneas de monto cero en `publish/route.ts:186`.

## Hallazgos actuales

### P1 — API contable sin autenticación ni autorización

`app/api/accounting/packets/route.ts:35,75`, `[id]/route.ts:45,82`, `[id]/publish/route.ts:59`, `publish-batch/route.ts:19` ejecutan con `supabaseAdmin` sin verificar sesión, rol o permisos de sucursal. `app/contabilidad/layout.tsx:20` solamente protege cliente. `middleware.ts:94` excluye APIs salvo Viele. Un request directo puede consultar datos o intentar generar, modificar y publicar; la UI admin no protege esos handlers. Prueba real segura confirma que requests anónimos alcanzan validación de negocio. El coordinador además confirmó lectura anónima de tablas con anon key (739 pólizas,15 mappings); escrituras anónimas no se probaron.

### P1 — Falla Toast produce pólizas estimadas potencialmente publicables

`packets/route.ts:211–265` captura fallo de datos granulares y reparte ventas/taxes/tarjetas por porcentajes fijos 52%,82.9%,70%,1.8%. `:319–337` interpreta ausencia de resultado Toast como cero órdenes abiertas y validación aprobada; si balancea queda ready. Datos estimados pueden llegar a QuickBooks sin advertencia de estimación. La reproducción con una póliza real arroja depósito estimado $3,134.41 frente real $2,774.70. El fallback también divide por netSales en `:235–236`: net_sales=0, doordash_sales=100,taxes=0 da NaN. Se debe bloquear generación publicable si no hay información verificable, no declarar la validación aprobada.

### P1 — Protección contra duplicados no es atómica y permite continuar ante fallos

`[id]/publish/route.ts:270–297`: `force` suministrado por cliente desactiva el guard; si consulta QBO devuelve HTTP no OK simplemente continúa al POST de `:300`. Dos requests concurrentes pueden leer ready, consultar inexistencia simultáneamente y ambos crear una póliza. No hay estado publishing/claim atómico ni clave idempotente. El guard solo consulta primeras 500 entradas del día y detecta DepartmentRef en líneas; no verifica `qb_journal_entry_id` local cuando status quedó ready. No se reprodujo creando duplicados reales por impacto contable; deriva directamente del flujo completo leído.

### P1 — Recálculo/PATCH pueden sobrescribir una publicación concurrente

`packets/route.ts:293–304,387–389`, cron `:125–133,330–332`, `[id]/route.ts:94,142,258–263`: comprobación de status y escritura son operaciones separadas. Si se publica entre lectura y upsert, vuelve a ready/pending y reemplaza líneas/respuesta de publicación; si PATCH comenzó antes de publicación, puede editar efectivo ya publicado. El UI permite acciones simultáneas: detalle `:484,514,762` controla actionLoading y publishing por separado; tablero `:334,344` permite recalcular mientras publica. Preservar depósito mediante lectura previa corrige un caso secuencial pero no esta carrera.

### P1 — Se anuncia éxito aunque persistencia posterior a QBO falle

`[id]/publish/route.ts:325–342,360–364` registra error Supabase pero devuelve success y objeto publicado sintético. QBO sí tiene asiento mientras DB queda ready; siguiente visita contradice éxito y un reintento depende del guard defectuoso. Logs de éxito/fallo también ignoran errores de Supabase. Se necesita recuperación explícita por ID y estado no reintentable hasta reconciliar, conservando identidad de operación.

### P2 — Clase, ubicación y entidad publicadas ignoran configuración editable

`[id]/publish/route.ts:183,199–215` usa `getQBStoreRefs(storeName)` para todas las líneas en vez de refs configurados/mostrados por póliza; cliente puede mostrar `line.location`/`line.className` distintos del payload. Entity sigue condicionada a cuenta literal 13200 (`:210`), aunque el generador/edición ya admite otra undeposited_funds_account. Cambiar esa cuenta puede eliminar Customer requerido; la selección de QB customer por UI no llega aquí. La función de refs pertenece a otra auditoría del equipo.

### P2 — Edición de depósito no valida número ni reconstruye línea ausente

`[id]/route.ts:141–151` acepta strings, negativos y entradas no numéricas al no tener validación runtime. `:190–194` solo modifica depósito si encuentra la cuenta actual; si la cuenta configurada cambió tras crear póliza, conserva la línea vieja y añade diferencia a over/short, causando descuadre. Tampoco pone credit=0 al modificar una línea originalmente crédito. Se guardan totales y status previo sin exigir balance. UI `page.tsx:284` convierte campo vacío/inválido a cero. No se ensayó alterando datos productivos.

### P2 — Cron oculta fallos DB y no comprueba balance real

`cron/sync-accounting/route.ts:185–188` fija `isBalanced=true` y decide ready solo por órdenes, antes de generar líneas. `:167–173,330–332,347–355` ignora objetos error de updates/upsert/log, que Supabase normalmente devuelve sin throw; contadores se incrementan antes de persistencia. Respuesta success puede informar pólizas listas que nunca se guardaron. POST normal sí reúne errors pero responde success y frontend no muestra errorDetails (`contabilidad/page.tsx:169,192`).

### P2 — Resumen Gross Receipts sigue incompleto

`[packetId]/page.tsx:571` muestra net_sales + total_taxes + paid_in, mientras generadores `packets/route.ts:341–350` y cron `:278–287` suman además delivery_service_charges, deferred_gift_cards,tips_payable,deposits_collected. Cuando cualquiera existe, “Total Gross Receipts” no coincide con gross_sales calculado. Paid-in fallback usa cuenta literal12049 y solo primer crédito, también ajeno a mapeos personalizados. No debe presentarse como réplica visual 1:1.

### P2 — Semana UI depende de zona horaria de navegador y omite corte 06:00

`contabilidad/page.tsx:69–99`: convierte hora LA a texto y la reinterpreta como hora local de navegador, luego vuelve a convertir medianoche local a LA. En navegador UTC, lunes00:00 pasa a domingo LA aunque encabezado muestra lunes. Tampoco resta día laboral antes06:00; lunes05:59 abre semana nueva aunque negocio sigue domingo. Cron actual sí tiene corte correcto. Ordenes abiertas detalle `:423` usa toLocaleTimeString sin zona LA.

### P2 — Auditoría pospublicación solo detecta cambio en net_sales

Cron `:136–176` no compara líneas, tarjetas, tips, impuestos ni cambios de canal con net_sales constante. Tampoco retira alerta antigua cuando diferencia desaparece. Una reasignación de pagos o cambio de tips sin cambio de venta neta queda invisible.

### P2 — Revisión/rechazo se pierden al recalcular

Generadores `packets/route.ts:326,353` y cron `:188,290` vuelven a ready/pending para cualquier póliza no published, incluidas rejected/reviewed, y sobrescriben notes/validation. No preservan decisión del revisor ni limpian coherentemente reviewed_at/by. La publicación permite ready sin revisión (esto está expresamente documentado; no es por sí mismo bug).

## Observaciones y límites

- Cron auth `:45` falla abierto si CRON_SECRET no está definido. Con secreto definido exige coincidencia; no se llamó cron sin él para evitar generación real.
- Rutas no validan formato/rango de fechas ni límite de generación; `storeIds=[]` significa todas tiendas. GET trunca500 sin paginación; semana15×7 cabe, rangos largos no.
- Batch usa URL pública y no propaga identidad del usuario; al corregir auth deberá cambiarse a servicio compartido o autorización interna segura, no abrir la API para que siga funcionando.
- Publicación verifica totales almacenados, no suma payload final ni rechaza negativos/débito+crédito simultáneos. Filtro nuevo de líneas cero no sustituye validación completa.
- No se confirma bug de columna generada únicamente por comentario JSDoc. PATCH escribe cash_over_short; debe contrastarse catálogo real (coordinador), no inferir esquema de comentarios contradictorios.
- Páginas layout/detalle y batch carecen @notes obligatorio. No se actualizaron asistente ni herramientas porque esta auditoría solo agrega evidencia, sin cambiar negocio.
- Comparación QBO línea por línea requiere reconexión OAuth; no corresponde llamarla aprobada con tokens expirados. No se probaron concurrencia ni errores contables creando asientos reales.

## Cobertura exacta

Completos: `app/api/accounting/packets/route.ts`, `[id]/route.ts`, `[id]/publish/route.ts`, `publish-batch/route.ts`, `app/api/cron/sync-accounting/route.ts`, `app/contabilidad/page.tsx`, `app/contabilidad/[packetId]/page.tsx`, `app/contabilidad/layout.tsx`. Cruce middleware completo y cabecera/cliente administrativo `lib/supabase.ts`. Configuración, motor journal, Toast y catálogos refs se revisan por agentes hermanos. Los hashes de evidencia delimitan la revisión ante nuevas ediciones concurrentes.
