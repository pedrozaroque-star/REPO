/**
 * @module lib/phone-agent
 * @description Motor central de la Contestadora IA Multi-Sucursal (15 tiendas) de Tacos Gavilan.
 * Gestiona la evaluación de horarios (incluyendo cierres de madrugada después de medianoche y días festivos),
 * búsqueda de precios en vivo en `app_menu_cache`, cotizador de Fiesta Platters, Base de Conocimiento Editable
 * (`phone_knowledge_base`), creación de alertas prioritarias en vivo para gerentes (`phone_callback_requests`),
 * bitácora de llamadas (`phone_calls`), validación criptográfica de webhooks de Twilio e instrucciones de desvío
 * condicional para líneas fijas Spectrum Business y celulares Android con AT&T.
 *
 * @businessRules
 * - **Un Solo Módulo Unificado (15 Sucursales)**: Todas las 15 tiendas usan el mismo motor identificando la sucursal
 *   por `store_id` o por el número receptor de Twilio (`twilio_phone_number`).
 * - **Día Laboral y Zona Horaria Oficial**: Toda evaluación de tiempo opera en `America/Los_Angeles`. El día laboral
 *   de Tacos Gavilan inicia a las 6:00 AM y termina a las 5:59:59 AM del día siguiente; el turno PM inicia a las 5:00 PM.
 * - **Horarios Nocturnos (After-Midnight Spillover)**: Si un cliente llama en la madrugada (ej. sábado a la 1:30 AM),
 *   el sistema evalúa primero si el turno nocturno del día calendario anterior (viernes que cierra a las 3:00 AM)
 *   sigue abierto antes de evaluar la apertura matutina del día actual.
 * - **6 Categorías Reales de Llamadas**:
 *   1. Clientes pre-visita (horarios, dirección, Drive-Thru, precios del menú, carnes, Fiesta Platters, formas de pago).
 *   2. Clientes que desean ordenar por teléfono (se canalizan a ordenar en línea en `tacosgavilan.com` o en sucursal).
 *   3. Clientes post-orden con incidencias (faltantes, quejas, objetos olvidados -> recado prioritario en vivo al Manager).
 *   4. Repartidores de Delivery (Uber Eats, DoorDash, Grubhub -> instrucciones de recolección o alerta a tienda).
 *   5. Empleados y Recursos Humanos (avisos de retardo/falta -> alerta prioritaria al Manager; bolsa de trabajo -> información).
 *   6. Proveedores, Técnicos, Corporativo y Filtro Anti-Spam.
 * - **Cumplimiento Legal de California (AB 2905 & Penal Code §632)**: El saludo inicial informa que contesta la
 *   asistente virtual de Tacos Gavilan y que la llamada se transcribe para mejorar el servicio.
 *
 * @dataFlow
 * - Twilio Webhook (`/api/phone/incoming`, `/api/phone/respond`) o Simulador Web (`/api/phone/simulate`)
 *   -> `processPhoneAgentTurn()` -> Gemini Function Calling (`stores`, `app_menu_cache`, `phone_knowledge_base`,
 *   `phone_special_hours`) -> Persistencia en `phone_calls` / `phone_callback_requests` -> Audio WAV (`getPhoneAgentSpeech`
 *   con voz `Kore` cacheada en Supabase Storage).
 *
 * @notes
 * - Soporta las 4 tiendas con línea fija Spectrum Business (Rialto #1, Hollywood #8, Lynwood #14, Downey #16) y las
 *   11 tiendas con celular Android AT&T (West Covina #3, Azusa #4, Broadway #5, Central #6, Slauson #7,
 *   Santa Ana #9, La Puente #10, Huntington Park #11, Norwalk #12, Bell #13, South Gate #15).
 * - FIX 2026-11-06 (texto/audio cortado "...en la su"): los Gemini 3.x cuentan los thinking tokens dentro de
 *   `maxOutputTokens` (antes 180). Ahora `thinkingLevel: 'minimal'` en TODOS los modelos + `maxOutputTokens: 1024`
 *   + `clampPhoneReplyLength()` que recorta solo en fin de oración (máx. 480 caracteres, límite TTS 600).
 * - AUDITORÍA 2026-11-09:
 *   * CRÍTICO: `stores.weekly_hours` es un ARREGLO `[{day,open,close}]` y Rialto #1, West Covina #3 y Azusa #4 vienen
 *     en orden [1..6,0]; se indexaba por posición y la IA daba el horario de OTRO día. Ahora `normalizeWeeklyHours()`.
 *   * Se eliminaron las "respuestas canónicas" fijas: guardaban recados con datos de demo (Juan Hernández 562-555-0188,
 *     Roberto Gómez 323-555-0144) en lugar de los datos reales del cliente e inventaban datos (suadero, horario de
 *     entrevistas 2-4 PM). Todo vuelve a salir de datos vivos + Base de Conocimiento Editable.
 *   * Catálogo de precios generado EN VIVO desde `app_menu_cache` (`buildLiveMenuCatalogText`), antes escrito a mano.
 *   * `sanitizePhoneReplyText` ya no convierte el condicional "Si ..." en afirmación ni mutila "Claro que no".
 *   * Failover con presupuesto global de 13 s por turno (Twilio corta a ~15 s), 404 = salta el MODELO (no la llave),
 *     429 = siguiente modelo, 400 = error determinista sin reintentos.
 *   * Herramientas en paralelo, try/catch por herramienta, anti-duplicado de recados por llamada y estado
 *     `callback_requested` persistente aunque el cliente se despida después.
 *   * Idioma final = idioma real del texto hablado (`detectPhoneTextLanguage`), así voz, bitácora y `<Gather>` coinciden.
 *   * Firma de Twilio: en despliegues de Vercel sin `TWILIO_AUTH_TOKEN` se RECHAZA el webhook (antes se aceptaba todo).
 *   * Se quitó el broadcast público `phone_callback_alert` (sin receptores; exponía nombre/teléfono del cliente).
 *   * STREAMING EN TIEMPO REAL (`streamPhoneAgentSpeechPcm` + `deferDbFlush` + `prewarm`): El audio de la voz `Kore 3.8`
 *     ahora se transmite por fragmentos PCM 24kHz vía `:streamGenerateContent?alt=sse` (~600 ms al primer sonido en vez de
 *     ~3,200 ms, y 0–90 ms desde caché), reduciendo la latencia total percibida de ~5.2 s a ~1.4 s sin cambiar de voz.
 *   * CALENDARIO FESTIVO EN TIEMPO REAL (`lib/holidays.ts` + `phone_special_hours`): Integra las 7 fechas oficiales anuales
 *     validadas contra Toast POS 2023–2026 (Viernes Santo y Navidad cerrados todo el día; Thanksgiving, Nochebuena y Fin de Año
 *     con cierre temprano 4:00 PM; Año Nuevo y Viernes después de Thanksgiving con apertura tarde 11:00 AM), respetando
 *     prioridad 1 = override por tienda en DB, prioridad 2 = regla global en DB, prioridad 3 = cálculo perpetuo multianual.
 * - AUDITORÍA PROFUNDA PRE-PRODUCCIÓN 2026-11-11:
 *   * URLs reales verificadas `order.online` para las 15 sucursales.
 *   * Separación estricta `source: 'twilio' | 'simulator'` en `phone_callback_requests` para no contaminar tablets en tienda.
 *   * Cero desvío/transferencia a celulares personales de gerentes (`shouldTransferToPhone = null`, escalación en PC de tienda), gramática `"a la 1:00 AM"`, lookahead +7 días
 *     en cierres festivos consecutivos, preservación legal CIPA + tecla `9` en saludos personalizados, herramientas
 *     declaradas completas (`get_fiesta_platter_packages` >40 invitados y `get_store_hours_and_status`), filtro de
 *     sustantivos del menú (`Piña`, `Jalapeño`) en `detectPhoneTextLanguage`, y pronunciación vial/telefónica natural
 *     en las 15 sucursales (`lib/phone-speech-format.ts`: sin abreviaturas `S.`, `E.`, `Ave.`, `Rd.`, `Blvd.`, `17th St.`, `Hwy.`, `CA`).
 * - FIX 2026-11-12 (Ingredientes Reales, Regular vs Super y Torta Cubana/Milanesa): `buildLiveMenuCatalogText` y
 *   `menuPreContext` ahora propagan las descripciones reales de Toast POS (`app_menu_cache.description`) al prompt,
 *   `normalizeToastMenuPrep` solo colapsa prefijos de carne estándar simples (preservando especialidades como
 *   `Torta Cubana` `Breaded Steak + Ham + Wiener`, `Torta Milanesa` y `Plato Milanesa` en `Variantes`),
 *   `searchStoreMenuPrices` añade sinónimos bilingües (`milanesa`/`breaded`, `jamon`/`ham`, `salchicha`/`wiener`),
 *   `phone_knowledge_base` respalda Regular vs Super y carnes exactas de Torta Cubana/Milanesa sin alucinaciones,
 *   y `callGeminiPhoneWithFailover` itera model-first (`gemini-3-flash-preview` -> `gemini-3.1-flash-lite-preview`,
 *   omitiendo `gemini-3.6-flash` por timeouts) con enfriamiento `(llave, modelo)` (`keyModelCooldownUntil`) y `MAX_ATTEMPTS = 14`.
 * - FIX 2026-11-12 (Horarios Semanales Reales, Comparativa Determinista, Anclaje de Fecha y Failover GA Rápido):
 *   1) Cada tienda tiene horarios distintos (ej. entre las 6 Drive-Thru, `#6 LA Central` abre 8:00 AM y cierra hasta 4:00 AM
 *   Vie-Sáb / 3:00 AM Jue / 2:00 AM Dom-Mié, mientras `#10 La Puente` cierra 2:00 AM Vie-Sáb / 12:00 AM Dom-Jue y `#3 West Covina`
 *   cierra 3:00 AM Vie-Sáb / 1:00 AM Dom-Jue). `buildCompactWeeklyHours`, `buildCrossStoreHoursComparison`,
 *   `loadAllActiveStoresDirectory` (preservando `weekly_hours`), `storesDirectoryBlock` y `find_other_stores` exponen
 *   tanto el horario semanal compacto individual como los ganadores exactos de apertura más temprana / cierre más tarde
 *   por día (Todas las 15 sucursales vs Drive-Thru), impidiendo generalizaciones o errores de comparación del LLM.
 *   2) `calendarDateLine` ancla las fechas exactas YYYY-MM-DD de HOY y MAÑANA en California y etiqueta festivos futuros
 *   (`[FECHA FUTURA - NO aplica hoy ni mañana]`) para evitar que un viernes normal aplique erróneamente Black Friday.
 *   3) `MODERN_CHAT_MODELS` / `CLASSIC_CHAT_MODELS` priorizan `gemini-3.5-flash-lite` (GA ~0.4-0.85s, 7/7 llaves activas) ->
 *   `gemini-3-flash-preview` -> `gemini-3.1-flash-lite-preview`, con límite `maxAttemptsOnThisModel` y salto rápido ante `503`/`429`
 *   para no agotar los 13s del webhook quemando llaves de un solo modelo caído o sin cuota.
 * - FIX 2026-11-17 (Deduplicación Atómica, Inmutabilidad de Estado Terminal, Paridad de Horarios Especiales y Precios 100% Dinámicos):
 *   1) `createManagerCallbackRequest` maneja violaciones `23505` sobre el índice único parcial `idx_phone_callbacks_one_pending_per_call`
 *   para deduplicar atómicamente recados concurrentes de una misma llamada.
 *   2) `processPhoneAgentTurn` respeta llamadas ya terminadas (`ended_at !== null` o estado terminal `completed`/`canceled`/`busy`/`failed`/`no-answer`)
 *   con `UPDATE` condicional en PostgreSQL para que un turno tardío jamás reabra ni cambie una llamada terminada a `callback_requested`.
 *   3) `resolveEffectiveDaySchedule` unifica la evaluación de horarios especiales, overrides globales y días cerrados entre
 *   `evaluateStoreSchedulePure` y `buildCrossStoreHoursComparison`.
 *   4) Se eliminaron todos los precios fijos en `buildLiveMenuCatalogText` y `recommendFiestaPlatters`, derivándolos exclusivamente de `app_menu_cache`.
 * - FIX 2026-11-17 (Ronda 2 — Tombstones sin store_id y Honestidad en Tortillas de Fiesta Platters):
 *   1) `reconcileCallWithTerminalTombstone` sincroniza cierres anticipados de `phone_call_status_tombstones` (incluyendo `CallDuration`
 *   autoritativo) aun cuando `/api/phone/status` llegó sin poder identificar `store_id`.
 *   2) Confirmado `Party Tray Guidelines` (`docs/Party Tray Instructions.pdf` / `PARTY_TRAY_GUIDELINES`) como fuente oficial única en todo el
 *   ecosistema (web pública, recetas virtuales, Contestadora IA, `phone_knowledge_base` y POS): los 4 tamaños entregan `10/5`, `15/7`, `20/9`
 *   y `25/12` docenas de tortillas de maíz/harina (`2/5`, `3/7`, `4/9` y `5/12` paquetes), `3/4/6/10` lbs de arroz y frijol, `6/7.5/10/12` lbs
 *   de carne y `3/4/5/6` galones de agua fresca, con precios 100% dinámicos desde `app_menu_cache`.
 * - FIX 2026-11-17 (Ronda 3 — Integridad Transaccional de Tombstones, Protección de CallDuration y Tope Explícito de Recados):
 *   1) `upsertPhoneCallStatusTombstone` usa `upsert_phone_call_status_tombstone_atomic` (`COALESCE`) para que un evento sin `CallDuration`
 *   jamás reemplace una duración válida con `NULL`.
 *   2) `reconcileCallWithTerminalTombstone` conserva el tombstone intacto si falla el `UPDATE` de `phone_calls`, omite `duration_seconds`
 *   cuando el tombstone no trae duración autoritativa (nunca pisa una duración válida con `NULL` ni `0`), jamás reabre llamadas terminadas y propaga errores de DB.
 *   3) `fetchScopedCriticalPendingCallbacksWithCap` detecta explícitamente truncamiento (`pageSize + 1` sobre el tope de 10,000) para nunca mostrar listas parciales como completas.
 * - FIX 2026-11-17 (Ronda 4 — Reconciliación Transaccional ante StatusCallback Simultáneos):
 *   1) `upsertPhoneCallStatusTombstone` y `reconcileCallWithTerminalTombstone` operan bajo candado transaccional por `CallSid`
 *   (`pg_advisory_xact_lock` + `FOR UPDATE`) en PostgreSQL (`upsert_phone_call_status_tombstone_atomic` y `reconcile_phone_call_with_tombstone_atomic`).
 *   2) La lectura del tombstone, actualización de `phone_calls` y borrado condicional (`WHERE revision = v_tomb.revision`) ocurren en una
 *   sola transacción ACID: conserva siempre la duración final más reciente, respeta `SequenceNumber` / `Timestamp` cuando Twilio los envía,
 *   jamás reabre llamadas terminadas y jamás borra un cierre que no se haya aplicado.
 * - FIX 2026-11-17 (Moneda Exclusiva EE. UU. Dólares/Centavos y Postres Oficiales Sin Pasteles de Cumpleaños):
 *   1) Prohibición absoluta de `"pesos"` / `"MXN"` en `systemInstruction`, `buildLiveMenuCatalogText` y sanitización determinista en
 *   `sanitizePhoneReplyText` (todos los precios se expresan exclusivamente en dólares y centavos estadounidenses USD).
 *   2) Tacos Gavilan NO maneja pasteles de cumpleaños, pasteles enteros ni churros (solo Flan y Cheesecake individuales); ante políticas
 *   administrativas no registradas jamás se envía al cliente a buscar políticas o productos inexistentes en `tacosgavilan.com`.
 * - FIX 2026-11-17 (Regla Global Sucursales de Los Ángeles #5, #6 y #7 con Entrecalles para Clientes):
 *   Todas las locuciones, saludos, prompts y comparativas de cara al cliente usan `lib/customer-store-names.ts` para referirse
 *   a #5, #6 y #7 como `Los Ángeles` con sus entrecalles oficiales (`Vernon y Broadway`, `Central y Washington`, `Slauson y Broadway`),
 *   conservando `cleanPhoneStoreName` intacta para el panel administrativo interno (`/api/phone/dashboard`).
 * - FIX 2026-11-18 (Blindaje Fail-Closed de Config, Retención Segura de Tombstones >24h y Veracidad de Transcripción):
 *   1) `getStorePhoneContext` verifica explícitamente `configRes.error` y lanza error sin fabricar jamás `is_enabled: true`
 *      ante fallos de DB ni contaminar el caché SWR; incluso si no existe fila en `phone_agent_config`, el fallback es `is_enabled: false`.
 *   2) `cleanupOrReconcileExpiredTombstones` reemplaza la purga ciega >24h: comprueba en `phone_calls` que el cierre ya quedó
 *      aplicado (estado terminal + `ended_at` + `duration_seconds`), intenta reconciliar los pendientes y conserva intactos
 *      los tombstones si la llamada aún no existe o si falla la base de datos.
 *   3) El saludo bilingüe informa con exactitud que la llamada es transcrita ("en una llamada transcrita para atenderte" /
 *      "on a transcribed line") sin afirmar grabación de audio mientras no exista grabación real.
 * - FIX 2026-11-18 (Ronda 2 — Auditoría Forense):
 *   * `cacheEpoch` evita que lecturas SWR en vuelo reescriban cachés tras `invalidateStorePhoneContextCache`, y `crossStoreCmpRamCache` poda entradas expiradas.
 *   * `buildEffectiveUpcomingHolidaysForStore` y `evaluateStoreSchedulePure` alinean reglas cuando un día regular está marcado `CLOSED`.
 *   * `buildInitialGreeting` blinda frases adicionales de grabación en saludos personalizados (`recorded` / `grabada` / `grabando`).
 *   * `callGeminiPhoneWithFailover` descarta respuestas `STOP` solo-pensamiento sin texto visible ni `functionCall`.
 *   * `inspectMissingCallbackGuard` ya no desactiva el blindaje por mencionar `"con tu nombre y tu número"` en confirmaciones sin pregunta, y soporta tildes en cleanup.
 * - UPGRADE 2026-11-18 (Paquete 1 + 2A + 2B — Reglas Delivery Apps, Condimentos Gratis y Enrutamiento Multi-Sucursal):
 *   1) Paquete 1 (Reglas oficiales en KB + prompt): distingue claramente entre cambios/reembolsos de Uber Eats / DoorDash /
 *      Grubhub (gestionados en Ayuda de la app; ajustes menores sin costo solo antes de empacar), pedidos retrasados vs
 *      llegados equivocados/incompletos, y pedidos directos en tacosgavilan.com/mostrador.
 *   2) Paquete 2A (`target_store_id` + `origin_store_id`): cuando un cliente pide por error en otra sucursal (especialmente
 *      tacosgavilan.com Pickup) y llama a una tienda distinta, `create_manager_callback` enruta la alerta directo al
 *      `/order-ready-board` del Gerente de la sucursal destino evaluando su horario real y etiquetando el origen.
 *   3) Paquete 2B (`condiments_note` con `urgency = 'normal'`): las peticiones de condimentos gratis en órdenes existentes
 *      se registran como Nota de Empaque separada en `PhoneCallbackAlertBanner` (sin saturar la alarma roja cada 45s)
 *      aclarando que aplican únicamente si la orden todavía no sale ni se entrega al repartidor.
 * - UPGRADE 2026-11-18 (Banco Completo de Respuestas Canónicas Preparadas + Hedged Gemini LLM Rápido):
 *   1) `resolveCanonicalPreparedReply()` resuelve en <2 ms (0 llamadas LLM, texto uniforme <=210 chars en su mayoría
 *      cacheable 100% en Supabase Storage `phone_v6/Kore`) las 19 preguntas frecuentes y operativas más comunes
 *      (cierre, spam, orden por teléfono, horario hoy/mañana/cualquier día/festivos, dirección/teléfono, Drive-Thru,
 *      pagos/EBT, empleo, repartidores, política de cambios Uber/DD/GH, aguas frescas/bebidas, postres sin pasteles,
 *      carnes, Regular vs Super, Torta Cubana/quesos, productos no manejados y Fiesta Platters), cediendo
 *      automáticamente a IA ante preguntas compuestas (>1 tema), overrides por tienda o reglas KB editadas en vivo.
 *   2) `MODERN_CHAT_MODELS` / `CLASSIC_CHAT_MODELS` priorizan `gemini-3.5-flash-lite` (~620 ms) ->
 *      `gemini-3.1-flash-lite-preview` -> `gemini-3-flash-preview`, con **Hedged Request paralela a los 950 ms**
 *      (`callGeminiPhoneWithFailover`) y podado contextual de KB/Catálogo cuando SÍ se requiere generar con IA.
 * - UPGRADE 2026-11-18 (Protocolo de Revisión de Preparación en Órdenes Equivocadas/Incompletas de Drive-Thru y Comedor):
 *   1) En reclamos de órdenes equivocadas o incompletas compradas en Drive-Thru, comedor, mostrador o directo en tacosgavilan.com,
 *      solicita los 4 datos obligatorios para revisar la preparación de la orden: número de ticket, fecha de compra, nombre y
 *      teléfono de 10 dígitos, aclarando de forma educada y seria que sin el ticket es poco probable determinar la equivocación.
 *   2) Incluye respuesta canónica instantánea de primer turno (`in_store_wrong_order`, <=210 chars), parámetro `order_date` en
 *      `create_manager_callback` concatenado en `ticket_or_order_number`, manejo respetuoso de `SIN TICKET` sin prometer reposición,
 *      y protección en `isPromptExpectingPhoneOrDetails` para que respuestas cortas de fecha ("el viernes", "ayer") no disparen FAQs.
 *   3) Cierre automático limpio de llamadas (`isCallerEndingConversation` + `didAssistantConcludeCall` + Regla 9): detecta
 *      todas las respuestas naturales de fin de conversación ("no", "no gracias", "así está bien", "todo bien", "ya no",
 *      "perfecto, espero su llamada", "ahorita ordeno en línea", "I'm good", "all set", "nope", "thanks") tras preguntas de
 *      cierre sin falsos positivos mientras se capturan datos, y emite `shouldHangup = true` (`<Hangup/>`) también cuando
 *      la asistente concluye con despedida final sin pregunta abierta.
 * - AUDITORÍA FORENSE 2026-11-19 (Twilio 13334/13335, Hedge 3-Vías, STT Real, AT&T MMI, Compuerta 4-Campos y Cierre Limpio):
 *   1) `callGeminiPhoneWithFailover`: máquina de estados con `launchedSlots`/`skippedSlots` + cancelación de timers por slot,
 *      eliminando lanzamientos duplicados y resoluciones prematuras a `null` ante fallos rápidos.
 *   2) `buildTwilioGatherAttrs`: `speechModel` válido por idioma (`en-US` -> `phone_call`, `es-US` -> `default`) y
 *      `speechTimeout` entero positivo (`"1"` estándar / `"3"` paciente) eliminando Twilio Warning 13334 y 13335;
 *      `buildTwilioFallbackSay` normaliza con `normalizeTextForPhoneSpeech`.
 *   3) `getCarrierForwardingInstructions`: menú nativo Android/Samsung como vía principal para AT&T + códigos `*61*<10d>*11*<seg>#`,
 *      `*67*<10d>#`, `*62*<10d>#`, `##002#`/`##004#` y aviso `*73` + Voice Manager Voicemail en Spectrum Business.
 *   4) `normalizeSearchText` une contracciones inglesas intra-palabra (`don't`->`dont`), `normalizePhoneSttTranscript` corrige
 *      glitches reales de producción (`fiesta playa`, `tienen raid`) sin dañar delivery drivers ni apellidos, `normUser` usa
 *      el texto STT normalizado, y `inspectMissingCallbackGuard` evita colisión ticket+teléfono y mutilación de nombres (Miguel/Elena/Laura).
 *   5) Eliminación total de `"por política de Tacos Gavilan"` en pedidos/recados, refuerzo de `existingPending` (`storeOpenNow` +
 *      escalación de `condiments_note`), guardia monotónica `turns_count` en `deferDbFlush`, y paridad byte-a-byte de prewarm Drive-Thru.
 */

import twilio from 'twilio'
import {
  formatCustomerGreetingTarget,
  formatCustomerStoreName,
  getCustomerStoreCrossStreets,
  resolveCustomerStoreMeta,
  sanitizeCustomerStoreReferencesInText
} from '@/lib/customer-store-names'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getGeminiKeyPoolWithRemote, VoiceId, resolvePhoneFemaleVoice } from '@/lib/order-ready-tts'
import { PARTY_TRAY_GUIDELINES } from '@/lib/inventory/party-tray-guidelines'
import { getOfficialStoreHolidaySchedule, getUpcomingOfficialStoreHolidays } from '@/lib/holidays'
import { extractPhoneDigits, isFictitiousNanpPhone, normalizeUsPhoneE164 } from '@/lib/phone-agent-access'
import {
  expandStreetAbbreviationsInText,
  extractZipCodeFromAddress,
  formatStoreAddressForAgent,
  normalizeTextForPhoneSpeech
} from '@/lib/phone-speech-format'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// Orden validado con benchmark en vivo (2026-11-12):
// - gemini-3.5-flash-lite (~0.41-0.85s, 7/7 llaves activas GA, soporta thinking minimal + functionCall) como primario.
// - gemini-3-flash-preview y gemini-3.1-flash-lite-preview como respaldos automáticos con salto rápido si hay 429/503.
// ('gemini-3.6-flash' y 'gemini-3.8-flash' se omiten: sufrieron 429/503 y 3.8 rechaza thinking minimal).
const MODERN_CHAT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview'
]
const CLASSIC_CHAT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview'
]

const keyQuarantineUntil = new Map<string, number>()
const modelUnavailableUntil = new Map<string, number>()
const keyModelCooldownUntil = new Map<string, number>()
let keyRoundRobin = 0

// Cachés en RAM con SWR (Stale-While-Revalidate) y Singleflight para mantener ~0 ms de latencia DB por turno
interface StoreMenuCacheEntry {
  items: any[]
  compactCatalogEs: string
  compactCatalogEn: string
  fetchedAt: number
}
const storeMenuRamCache = new Map<number, StoreMenuCacheEntry>()
const storeMenuInFlight = new Map<number, Promise<StoreMenuCacheEntry | null>>()
const storeContextRamCache = new Map<number, { data: any; fetchedAt: number }>()
const storeContextInFlight = new Map<number, Promise<any>>()
let specialHoursRamCache: { rows: any[]; fetchedAt: number } | null = null
let specialHoursInFlight: Promise<any[]> | null = null
let allKbRamCache: { rows: any[]; fetchedAt: number } | null = null
let allKbInFlight: Promise<any[]> | null = null
const crossStoreCmpRamCache = new Map<string, { text: string; fetchedAt: number }>()
let cacheEpoch = 0

function setCrossStoreCmpCache(key: string, text: string, writeEpoch: number) {
  if (writeEpoch !== cacheEpoch) return
  const nowMs = Date.now()
  if (crossStoreCmpRamCache.size >= 16) {
    for (const [k, v] of crossStoreCmpRamCache.entries()) {
      if (nowMs - v.fetchedAt >= 30_000) crossStoreCmpRamCache.delete(k)
    }
    while (crossStoreCmpRamCache.size >= 32) {
      const oldestKey = crossStoreCmpRamCache.keys().next().value
      if (!oldestKey) break
      crossStoreCmpRamCache.delete(oldestKey)
    }
  }
  crossStoreCmpRamCache.set(key, { text, fetchedAt: nowMs })
}

interface PhoneRoutingDirectoryEntry {
  fetchedAt: number
  configs: Array<{ store_id: number; twilio_phone_number: string | null }>
  activeStores: Array<{ id: number; phone: string | null; is_active: boolean | null }>
}
let phoneRoutingDirCache: PhoneRoutingDirectoryEntry | null = null
let phoneRoutingDirInFlight: Promise<PhoneRoutingDirectoryEntry> | null = null

export function invalidatePhoneRoutingDirectoryCache() {
  cacheEpoch++
  phoneRoutingDirCache = null
  phoneRoutingDirInFlight = null
}

export function invalidateStorePhoneContextCache(storeId?: number) {
  cacheEpoch++
  crossStoreCmpRamCache.clear()
  specialHoursRamCache = null
  specialHoursInFlight = null
  allKbRamCache = null
  allKbInFlight = null
  phoneRoutingDirCache = null
  phoneRoutingDirInFlight = null
  allStoresDirectoryCache = null
  allStoresInFlight = null
  if (storeId && Number.isFinite(storeId)) {
    const id = Number(storeId)
    storeContextRamCache.delete(id)
    storeContextInFlight.delete(id)
    storeMenuRamCache.delete(id)
    storeMenuInFlight.delete(id)
  } else {
    storeContextRamCache.clear()
    storeContextInFlight.clear()
    storeMenuRamCache.clear()
    storeMenuInFlight.clear()
  }
}

export type PhoneLang = 'es' | 'en'
export type CarrierType = 'spectrum_landline' | 'att_wireless'

export interface StoreScheduleDay {
  open: string
  close: string
}

export interface StoreOpenEvaluation {
  storeId: number
  storeName: string
  isOpenNow: boolean
  activeScheduleDate: string
  activeDayLabelEs: string
  activeDayLabelEn: string
  todayOpen: string
  todayClose: string
  todayOpenFormattedEs: string
  todayCloseFormattedEs: string
  todayOpenFormattedEn: string
  todayCloseFormattedEn: string
  isAfterMidnightSpillover: boolean
  isSpecialHolidaySchedule: boolean
  specialHolidayName: string | null
  statusMessageEs: string
  statusMessageEn: string
  closedGreetingPromptEs?: string | null
  closedGreetingPromptEn?: string | null
  weeklySummaryEs: string
  weeklySummaryEn: string
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'tool'
  text: string
  timestamp: string
  toolName?: string
}

const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const OFFICIAL_STORE_URLS: Record<number, string> = {
  1: 'https://order.online/store/tacos-gavilan-rialto-841931',
  3: 'https://order.online/store/tacos-gavilan-west-covina-725035',
  4: 'https://order.online/store/tacos-gavilan-azusa-718169',
  5: 'https://order.online/store/tacos-gavilan-los-angeles-260769',
  6: 'https://order.online/store/tacos-gavilan-los-angeles-260847',
  7: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119',
  8: 'https://order.online/store/tacos-gavilan-los-angeles-551916',
  9: 'https://order.online/store/tacos-gavilan-santa-ana-724574',
  10: 'https://order.online/store/tacos-gavilan-la-puente-963464',
  11: 'https://order.online/store/tacos-gavilan-huntington-park-260849',
  12: 'https://order.online/store/tacos-gavilan-norwalk-1327857',
  13: 'https://order.online/store/tacos-gavilan-bell-260912',
  14: 'https://order.online/store/tacos-gavilan-lynwood-727877',
  15: 'https://order.online/store/tacos-gavilan-south-gate-846517',
  16: 'https://order.online/store/tacos-gavilan-downey-302620'
}

export const OFFICIAL_ORDER_FALLBACK_URL = 'https://order.online/business/-137616'

/**
 * Normaliza texto eliminando tildes/acentos y convirtiendo a minúsculas para búsquedas tolerantes.
 */
export function normalizeSearchText(input: string | null | undefined): string {
  if (!input) return ''
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(?<=[a-z0-9])['’](?=[a-z0-9])/gi, '')
    .replace(/[/\-+&]/g, ' ')
    .replace(/[¿?¡!.,;:()"'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

/**
 * Limpia el nombre oficial de la sucursal eliminando el prefijo "Tacos Gavilan" (y guiones separadores)
 * y el prefijo "LA " para que las sucursales #5 y #6 se muestren y pronuncien siempre como "Broadway" y "Central",
 * preservando "La Puente" (#10) intacto.
 */
export function cleanPhoneStoreName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .replace(/^Tacos\s+(?:El\s+)?Gavil[aá]n\s*[-–—:]?\s*/i, '')
    .replace(/^[-–—:]+\s*/, '')
    .replace(/^LA\s+(Broadway|Central)\b/i, '$1')
    .trim()
}

/**
 * Convierte una hora en formato "HH:MM" (24h) a minutos desde las 00:00.
 */
function isClosedTimeToken(raw: unknown): boolean {
  const s = String(raw || '').trim().toLowerCase()
  return !s || s === 'closed' || s === 'cerrado' || s === 'cerrada' || s === 'off'
}

export function parseTimeToMinutes(hhmm: string | null | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return 480
  if (isClosedTimeToken(hhmm)) return 480
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return 480
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m > 0)) return 480
  return h * 60 + m
}

/**
 * Formatea una hora "HH:MM" (24h) en formato limpio de 12 horas (ej. "8:00 AM", "12:00 AM", "12:00 PM")
 * sin paréntesis hablados para que el motor TTS pronuncie las horas con total fluidez.
 */
export function formatTime12h(hhmm: string | null | undefined, lang: PhoneLang = 'es'): string {
  if (!hhmm) return ''
  if (isClosedTimeToken(hhmm)) return lang === 'en' ? 'Closed' : 'Cerrado'
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return hhmm
  const hRaw = Number(match[1])
  const m = Number(match[2])
  if (!Number.isInteger(hRaw) || !Number.isInteger(m) || hRaw < 0 || hRaw > 24 || m < 0 || m > 59 || (hRaw === 24 && m > 0)) return hhmm

  const h = hRaw === 24 ? 0 : hRaw
  const minStr = String(m).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${minStr} ${period}`
}

const PACIFIC_PARTS_DTF = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/**
 * Extrae las partes de fecha y hora en la zona horaria oficial `America/Los_Angeles` usando formatter singleton.
 */
export function getPacificDateParts(now: Date = new Date()): {
  dateStr: string
  yesterdayDateStr: string
  dayOfWeek: number
  yesterdayDayOfWeek: number
  hour: number
  minute: number
  currentMinutes: number
} {
  const parts = PACIFIC_PARTS_DTF.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''

  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute'))

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  }
  const dayOfWeek = weekdayMap[get('weekday')] ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const yesterdayDayOfWeek = (dayOfWeek + 6) % 7

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const yesterdayUtc = new Date(Date.UTC(year, month - 1, day))
  yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1)
  const yesterdayDateStr = yesterdayUtc.toISOString().slice(0, 10)

  return {
    dateStr,
    yesterdayDateStr,
    dayOfWeek,
    yesterdayDayOfWeek,
    hour,
    minute,
    currentMinutes: hour * 60 + minute
  }
}

/**
 * Normaliza `stores.weekly_hours` a un mapa indexado por día de la semana (0=Domingo ... 6=Sábado).
 * En la base de datos real `weekly_hours` es un ARREGLO `[{ day, open, close }]` cuyo orden NO es uniforme:
 * Rialto #1, West Covina #3 y Azusa #4 vienen en orden [1,2,3,4,5,6,0]. Indexar el arreglo por posición
 * desfasaba un día completo el horario de esas 3 tiendas, por eso SIEMPRE se indexa por el campo `day`.
 */
const DAY_KEY_ALIASES: Record<string, number> = {
  '0': 0, sunday: 0, sun: 0, domingo: 0, dom: 0,
  '1': 1, monday: 1, mon: 1, lunes: 1, lun: 1,
  '2': 2, tuesday: 2, tue: 2, tues: 2, martes: 2, mar: 2,
  '3': 3, wednesday: 3, wed: 3, miercoles: 3, mie: 3,
  '4': 4, thursday: 4, thu: 4, thur: 4, thurs: 4, jueves: 4, jue: 4,
  '5': 5, friday: 5, fri: 5, viernes: 5, vie: 5,
  '6': 6, saturday: 6, sat: 6, sabado: 6, sab: 6,
}

function resolveDayIndex(rawDay: unknown): number | null {
  if (typeof rawDay === 'number' && Number.isInteger(rawDay) && rawDay >= 0 && rawDay <= 6) {
    return rawDay
  }
  const normalized = String(rawDay ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  return Object.prototype.hasOwnProperty.call(DAY_KEY_ALIASES, normalized) ? DAY_KEY_ALIASES[normalized] : null
}

export function normalizeWeeklyHours(raw: unknown): Record<string, StoreScheduleDay> {
  let source: unknown = raw
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return {}
    }
  }
  const isExplicitClosedWord = (raw: unknown): boolean => {
    const s = String(raw || '').trim().toLowerCase()
    return s === 'closed' || s === 'cerrado' || s === 'cerrada' || s === 'off'
  }
  const toSlot = (entry: any): StoreScheduleDay | null => {
    if (!entry || typeof entry !== 'object') return null
    if (entry.is_closed === true || isExplicitClosedWord(entry.open) || isExplicitClosedWord(entry.close)) {
      return { open: 'CLOSED', close: 'CLOSED' }
    }
    const openStr = typeof entry.open === 'string' ? entry.open.trim() : ''
    const closeStr = typeof entry.close === 'string' ? entry.close.trim() : ''
    if (openStr && closeStr) {
      return { open: openStr, close: closeStr }
    }
    return null
  }
  const out: Record<string, StoreScheduleDay> = {}
  if (Array.isArray(source)) {
    for (const row of source) {
      const day = resolveDayIndex(row?.day)
      const slot = toSlot(row)
      if (day !== null && slot) {
        out[String(day)] = slot
      }
    }
    return out
  }
  if (source && typeof source === 'object') {
    for (const [k, v] of Object.entries(source as Record<string, any>)) {
      const day = resolveDayIndex(k)
      const slot = toSlot(v)
      if (day !== null && slot) {
        out[String(day)] = slot
      }
    }
  }
  return out
}

/**
 * Extrae la etiqueta de festividad en el idioma solicitado cuando el nombre viene bilingüe ("Español / English").
 */
export function localizeHolidayLabel(rawName: string | null | undefined, lang: PhoneLang, eventDate?: string): string {
  if (eventDate) {
    const official = getOfficialStoreHolidaySchedule(eventDate)
    if (official && (!rawName || rawName === official.holiday_name)) {
      return lang === 'en' ? official.holiday_name_en : official.holiday_name_es
    }
  }
  if (!rawName) return ''
  const parts = String(rawName)
    .split(/\s+\/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return lang === 'en' ? parts[1] : parts[0]
  }
  return String(rawName).trim()
}

function normalizeHhMm(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(am|pm))?$/i)
  if (!match) return null
  let h = Number(match[1])
  const m = Number(match[2])
  const mer = match[3] ? match[3].toLowerCase() : null
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59) return null
  if (mer) {
    if (h < 1 || h > 12) return null
    if (mer === 'am') h = h === 12 ? 0 : h
    else h = h === 12 ? 12 : h + 12
  } else if (h < 0 || h > 24 || (h === 24 && m > 0)) {
    return null
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Fusiona los días festivos configurados en `phone_special_hours` (override por sucursal > regla global)
 * con las 7 fechas oficiales perpetuas de `lib/holidays.ts`, calculando las horas reales de apertura y cierre
 * para la sucursal consultada (`weeklyHours`). Respeta estrictamente el límite superior `<= endDateStr`.
 */
export function buildEffectiveUpcomingHolidaysForStore(params: {
  storeId: number
  weeklyHours: unknown
  specialHours?: Array<{
    store_id: number | null
    event_date: string
    holiday_name: string
    is_closed: boolean
    open_time: string | null
    close_time: string | null
  }>
  fromDateStr: string
  daysAhead?: number
}) {
  const { storeId, specialHours = [], fromDateStr, daysAhead = 180 } = params
  const wh = normalizeWeeklyHours(params.weeklyHours)
  const officialUpcoming = getUpcomingOfficialStoreHolidays(fromDateStr, daysAhead)
  const safeDaysAhead = Number.isFinite(daysAhead) ? Math.max(1, Math.trunc(daysAhead)) : 180
  const endUtc = new Date(`${fromDateStr}T12:00:00Z`)
  endUtc.setUTCDate(endUtc.getUTCDate() + safeDaysAhead)
  const endDateStr = Number.isNaN(endUtc.getTime()) ? '9999-12-31' : endUtc.toISOString().slice(0, 10)

  const allDates = new Set<string>()
  const numericStoreId = Number(storeId)
  for (const s of specialHours) {
    if (
      s?.event_date &&
      s.event_date >= fromDateStr &&
      s.event_date <= endDateStr &&
      (s.store_id === null || Number(s.store_id) === numericStoreId)
    ) {
      allDates.add(s.event_date)
    }
  }
  for (const off of officialUpcoming) {
    allDates.add(off.event_date)
  }

  const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b))

  return sortedDates.map((dStr) => {
    const dow = new Date(`${dStr}T12:00:00Z`).getUTCDay()
    const regular = wh[String(dow)] || { open: '10:00', close: '00:00' }
    const regularClosed = isClosedTimeToken(regular.open) || isClosedTimeToken(regular.close)

    const storeSpecific = specialHours.find(
      (s) => s.event_date === dStr && s.store_id !== null && Number(s.store_id) === numericStoreId
    )
    const globalRow = !storeSpecific ? specialHours.find((s) => s.event_date === dStr && s.store_id === null) : null
    const dbMatch = storeSpecific || globalRow || null

    if (dbMatch) {
      const openOverride = normalizeHhMm(dbMatch.open_time)
      const closeOverride = normalizeHhMm(dbMatch.close_time)
      // Una regla GLOBAL (ej. apertura tarde 11:00 AM) jamás debe abrir un día que regularmente cierra la tienda;
      // solo un override ESPECÍFICO por sucursal con apertura y cierre explícitos puede reabrir un día cerrado.
      const canReopenRegularClosed = Boolean(storeSpecific && openOverride && closeOverride)
      const isClosed = Boolean(dbMatch.is_closed) || (regularClosed && !canReopenRegularClosed)
      let effectiveOpen = regular.open
      if (!isClosed && openOverride) {
        effectiveOpen =
          !storeSpecific && !regularClosed && parseTimeToMinutes(openOverride) < parseTimeToMinutes(regular.open)
            ? regular.open
            : openOverride
      }
      const effectiveClose = isClosed ? 'CLOSED' : closeOverride || regular.close
      return {
        event_date: dStr,
        holiday_name: dbMatch.holiday_name,
        holiday_name_es: localizeHolidayLabel(dbMatch.holiday_name, 'es', dStr),
        holiday_name_en: localizeHolidayLabel(dbMatch.holiday_name, 'en', dStr),
        is_closed: isClosed,
        open_time: openOverride,
        close_time: closeOverride,
        effective_open: isClosed ? 'CLOSED' : effectiveOpen,
        effective_close: effectiveClose,
        is_early_close_only: !isClosed && !openOverride && Boolean(closeOverride),
        is_late_open_only: !isClosed && Boolean(openOverride) && !closeOverride,
        source: storeSpecific ? ('store_override' as const) : ('global_db' as const)
      }
    }

    const official = getOfficialStoreHolidaySchedule(dStr)!
    const isClosed = official.is_closed || regularClosed
    let effectiveOpen = regular.open
    if (!isClosed && official.open_time) {
      effectiveOpen =
        parseTimeToMinutes(official.open_time) > parseTimeToMinutes(regular.open) ? official.open_time : regular.open
    }
    const effectiveClose = isClosed ? 'CLOSED' : official.close_time || regular.close

    return {
      event_date: dStr,
      holiday_name: official.holiday_name,
      holiday_name_es: official.holiday_name_es,
      holiday_name_en: official.holiday_name_en,
      is_closed: isClosed,
      open_time: official.open_time,
      close_time: official.close_time,
      effective_open: isClosed ? 'CLOSED' : effectiveOpen,
      effective_close: effectiveClose,
      is_early_close_only: !isClosed && !official.open_time && Boolean(official.close_time),
      is_late_open_only: !isClosed && Boolean(official.open_time) && !official.close_time,
      source: 'official_calendar' as const
    }
  })
}

/**
 * Evalúa con precisión si una sucursal está abierta o cerrada en un instante dado (`now`),
 * contemplando los cierres de madrugada después de medianoche (00:00 a 05:59 AM) del día anterior,
 * los overrides en `phone_special_hours` y las 7 fechas oficiales perpetuas de `lib/holidays.ts`.
 */
function resolveEffectiveDaySchedule(params: {
  storeIdNum: number
  regular: StoreScheduleDay | undefined
  dateStr: string
  specialHours: any[]
}): {
  isClosedAllDay: boolean
  open: string
  close: string
  isSpecial: boolean
  holidayName: string | null
  holidayNameEn: string | null
} {
  const { storeIdNum, dateStr, specialHours = [] } = params
  const regular = params.regular || { open: '10:00', close: '00:00' }
  const regularClosed = isClosedTimeToken(regular.open) || isClosedTimeToken(regular.close)
  const regOpen = regularClosed ? 'CLOSED' : regular.open || '10:00'
  const regClose = regularClosed ? 'CLOSED' : regular.close || '00:00'

  const sp =
    specialHours.find(
      (s) => s.event_date === dateStr && s.store_id !== null && Number(s.store_id) === storeIdNum
    ) || specialHours.find((s) => s.event_date === dateStr && s.store_id === null) || null

  if (sp) {
    const openOverride = normalizeHhMm(sp.open_time)
    const closeOverride = normalizeHhMm(sp.close_time)
    const holidayEs = localizeHolidayLabel(sp.holiday_name, 'es', dateStr) || sp.holiday_name || null
    const holidayEn = localizeHolidayLabel(sp.holiday_name, 'en', dateStr) || sp.holiday_name || null

    const isStoreSpecificOverride = sp.store_id !== null && Number(sp.store_id) === storeIdNum
    const canReopenRegularClosed = isStoreSpecificOverride && Boolean(openOverride) && Boolean(closeOverride)
    if (Boolean(sp.is_closed) || (regularClosed && !canReopenRegularClosed)) {
      return {
        isClosedAllDay: true,
        open: 'CLOSED',
        close: 'CLOSED',
        isSpecial: true,
        holidayName: holidayEs,
        holidayNameEn: holidayEn
      }
    }

    const effOpen = openOverride
      ? sp.store_id === null && !regularClosed && parseTimeToMinutes(openOverride) < parseTimeToMinutes(regOpen)
        ? regOpen
        : openOverride
      : regOpen
    const effClose = closeOverride || regClose
    const closedByTokens = isClosedTimeToken(effOpen) || isClosedTimeToken(effClose)

    return {
      isClosedAllDay: closedByTokens,
      open: closedByTokens ? 'CLOSED' : effOpen,
      close: closedByTokens ? 'CLOSED' : effClose,
      isSpecial: true,
      holidayName: holidayEs,
      holidayNameEn: holidayEn
    }
  }

  const official = getOfficialStoreHolidaySchedule(dateStr)
  if (official) {
    if (official.is_closed || regularClosed) {
      return {
        isClosedAllDay: true,
        open: 'CLOSED',
        close: 'CLOSED',
        isSpecial: true,
        holidayName: official.holiday_name_es,
        holidayNameEn: official.holiday_name_en
      }
    }
    const effOpen =
      official.open_time && parseTimeToMinutes(official.open_time) > parseTimeToMinutes(regOpen)
        ? official.open_time
        : regOpen
    const effClose = official.close_time || regClose
    return {
      isClosedAllDay: false,
      open: effOpen,
      close: effClose,
      isSpecial: true,
      holidayName: official.holiday_name_es,
      holidayNameEn: official.holiday_name_en
    }
  }

  return {
    isClosedAllDay: regularClosed,
    open: regOpen,
    close: regClose,
    isSpecial: false,
    holidayName: null,
    holidayNameEn: null
  }
}

export function evaluateStoreSchedulePure(params: {
  storeId: number
  storeName: string
  weeklyHours: unknown
  specialHours?: Array<{
    store_id: number | null
    event_date: string
    holiday_name: string
    is_closed: boolean
    open_time: string | null
    close_time: string | null
  }>
  now?: Date
}): StoreOpenEvaluation {
  const { storeId, specialHours = [], now = new Date() } = params
  const storeName = cleanPhoneStoreName(params.storeName)
  const custStoreMeta = resolveCustomerStoreMeta({ id: storeId, name: params.storeName })
  const branchNounEs = custStoreMeta?.isLosAngelesCrossStreetStore
    ? `sucursal de Los Ángeles en la esquina de ${custStoreMeta.crossStreetsEs}`
    : `sucursal ${storeName}`
  const ourLocCapEn = custStoreMeta?.isLosAngelesCrossStreetStore
    ? `Our Los Angeles location at ${custStoreMeta.spokenCrossStreetsEn}`
    : `Our ${storeName} location`
  const ourLocLowEn = custStoreMeta?.isLosAngelesCrossStreetStore
    ? `our Los Angeles location at ${custStoreMeta.spokenCrossStreetsEn}`
    : `our ${storeName} location`
  const pt = getPacificDateParts(now)
  const wh = normalizeWeeklyHours(params.weeklyHours)

  const addUtcDays = (baseDateStr: string, days: number) => {
    const u = new Date(`${baseDateStr}T12:00:00Z`)
    u.setUTCDate(u.getUTCDate() + days)
    return u.toISOString().slice(0, 10)
  }

  const numericStoreId = Number(storeId)

  const atTimeEs = (formatted12h: string) =>
    /^1:/i.test(formatted12h.trim()) ? `a la ${formatted12h}` : `a las ${formatted12h}`
  const cleanSpokenHoliday = (raw: string | null | undefined) =>
    String(raw || '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim()
  const expandHolidayMonthsEn = (raw: string | null | undefined) =>
    String(raw || '')
      .replace(/\bJan\b/g, 'January')
      .replace(/\bFeb\b/g, 'February')
      .replace(/\bMar\b/g, 'March')
      .replace(/\bApr\b/g, 'April')
      .replace(/\bJun\b/g, 'June')
      .replace(/\bJul\b/g, 'July')
      .replace(/\bAug\b/g, 'August')
      .replace(/\bSep\b/g, 'September')
      .replace(/\bOct\b/g, 'October')
      .replace(/\bNov\b/g, 'November')
      .replace(/\bDec\b/g, 'December')
  const formatHolidayForParenhEs = (raw: string | null | undefined) => {
    const s = String(raw || '').trim()
    if (!s) return ''
    return s.replace(/\s*\(([^)]*)\)/g, ' — $1').replace(/\s+,/g, ',').trim()
  }
  const formatHolidayForParenEn = (raw: string | null | undefined) => {
    const s = expandHolidayMonthsEn(raw).trim()
    if (!s) return ''
    return s.replace(/\s*\(([^)]*)\)/g, ', $1').replace(/\s+,/g, ',').trim()
  }

  const getScheduleForDay = (dayIdx: number, dStr: string) =>
    resolveEffectiveDaySchedule({
      storeIdNum: numericStoreId,
      regular: wh[String(dayIdx)],
      dateStr: dStr,
      specialHours
    })

  // Busca el próximo día abierto hasta +7 días para soportar cierres especiales consecutivos
  const findNextOpenDay = (fromDaysAhead: number = 1) => {
    for (let offset = fromDaysAhead; offset <= 7; offset++) {
      const dStr = addUtcDays(pt.dateStr, offset)
      const dow = (pt.dayOfWeek + offset) % 7
      const sched = getScheduleForDay(dow, dStr)
      if (!sched.isClosedAllDay) {
        return { offset, dStr, dow, sched }
      }
    }
    return null
  }

  // 1. Verificar primero si estamos en la madrugada (00:00 - 05:59 AM) y el turno de AYER sigue abierto
  const yesterdaySched = getScheduleForDay(pt.yesterdayDayOfWeek, pt.yesterdayDateStr)
  if (!yesterdaySched.isClosedAllDay) {
    const yOpenMin = parseTimeToMinutes(yesterdaySched.open)
    const yCloseMin = parseTimeToMinutes(yesterdaySched.close)
    // Si cierra después de medianoche (ej. "01:00", "02:00", "03:00", "04:00"), yCloseMin <= 359 y yCloseMin > 0
    if (yCloseMin > 0 && yCloseMin <= 359 && yCloseMin <= yOpenMin && pt.currentMinutes < yCloseMin) {
      const openEs = formatTime12h(yesterdaySched.open, 'es')
      const closeEs = formatTime12h(yesterdaySched.close, 'es')
      const openEn = formatTime12h(yesterdaySched.open, 'en')
      const closeEn = formatTime12h(yesterdaySched.close, 'en')
      const dayEs = DAY_NAMES_ES[pt.yesterdayDayOfWeek]
      const dayEn = DAY_NAMES_EN[pt.yesterdayDayOfWeek]
      const todayCalSched = getScheduleForDay(pt.dayOfWeek, pt.dateStr)
      const closedDayNoteEs = todayCalSched.isClosedAllDay
        ? ` (Nota: después de cerrar ${atTimeEs(closeEs)}, permaneceremos cerrados el resto del día por ${cleanSpokenHoliday(todayCalSched.holidayName) || 'día festivo'})`
        : ''
      const closedDayNoteEn = todayCalSched.isClosedAllDay
        ? ` (Note: after closing at ${closeEn}, we remain closed for the rest of the day for ${cleanSpokenHoliday(todayCalSched.holidayNameEn || todayCalSched.holidayName) || 'the holiday'})`
        : ''

      return {
        storeId,
        storeName,
        isOpenNow: true,
        activeScheduleDate: pt.yesterdayDateStr,
        activeDayLabelEs: dayEs,
        activeDayLabelEn: dayEn,
        todayOpen: yesterdaySched.open,
        todayClose: yesterdaySched.close,
        todayOpenFormattedEs: openEs,
        todayCloseFormattedEs: closeEs,
        todayOpenFormattedEn: openEn,
        todayCloseFormattedEn: closeEn,
        isAfterMidnightSpillover: true,
        isSpecialHolidaySchedule: yesterdaySched.isSpecial || todayCalSched.isSpecial,
        specialHolidayName: todayCalSched.holidayName || yesterdaySched.holidayName,
        statusMessageEs: `La ${branchNounEs} está ABIERTA en este momento; nuestro turno nocturno de ${dayEs} cierra hoy ${atTimeEs(closeEs)}${closedDayNoteEs}.`,
        statusMessageEn: `${ourLocCapEn} is OPEN right now; our ${dayEn} late-night shift closes at ${closeEn}${closedDayNoteEn}.`,
        closedGreetingPromptEs: null,
        closedGreetingPromptEn: null,
        weeklySummaryEs: buildWeeklySummary(wh, 'es'),
        weeklySummaryEn: buildWeeklySummary(wh, 'en')
      }
    }
  }

  // 2. Evaluar el horario del día calendario actual (HOY)
  const todaySched = getScheduleForDay(pt.dayOfWeek, pt.dateStr)
  const dayEs = DAY_NAMES_ES[pt.dayOfWeek]
  const dayEn = DAY_NAMES_EN[pt.dayOfWeek]

  if (todaySched.isClosedAllDay) {
    const nextOpen = findNextOpenDay(1)
    const nextOpenEs = nextOpen ? formatTime12h(nextOpen.sched.open, 'es') : ''
    const nextOpenEn = nextOpen ? formatTime12h(nextOpen.sched.open, 'en') : ''
    const reopenDayPhraseEs = nextOpen
      ? nextOpen.offset === 1
        ? `mañana ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}`
        : `el ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}`
      : ''
    const reopenDayPhraseEn = nextOpen
      ? nextOpen.offset === 1
        ? `tomorrow, ${DAY_NAMES_EN[nextOpen.dow]},`
        : `on ${DAY_NAMES_EN[nextOpen.dow]}`
      : ''

    const reopenTailEs = nextOpen
      ? ` ${nextOpen.offset === 1 ? `Mañana ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}` : `El ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}`} reanudamos servicio ${atTimeEs(nextOpenEs)}.`
      : ''
    const reopenTailEn = nextOpen
      ? ` We reopen ${nextOpen.offset === 1 ? `tomorrow (${DAY_NAMES_EN[nextOpen.dow]})` : `on ${DAY_NAMES_EN[nextOpen.dow]}`} at ${nextOpenEn}.`
      : ''
    const spokenHolEs = cleanSpokenHoliday(todaySched.holidayName) || dayEs
    const spokenHolEn = cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName) || dayEn
    const reopenSpokenEs = nextOpen ? ` y reanudamos servicio ${reopenDayPhraseEs} ${atTimeEs(nextOpenEs)}` : ''
    const reopenSpokenEn = nextOpen ? `, and we reopen ${reopenDayPhraseEn} at ${nextOpenEn}` : ''

    return {
      storeId,
      storeName,
      isOpenNow: false,
      activeScheduleDate: pt.dateStr,
      activeDayLabelEs: dayEs,
      activeDayLabelEn: dayEn,
      todayOpen: 'CLOSED',
      todayClose: 'CLOSED',
      todayOpenFormattedEs: 'Cerrado',
      todayCloseFormattedEs: 'Cerrado',
      todayOpenFormattedEn: 'Closed',
      todayCloseFormattedEn: 'Closed',
      isAfterMidnightSpillover: false,
      isSpecialHolidaySchedule: todaySched.isSpecial,
      specialHolidayName: todaySched.holidayName,
      statusMessageEs: todaySched.isSpecial
        ? `Hoy (${formatHolidayForParenhEs(todaySched.holidayName) || dayEs}) la ${branchNounEs} permanece cerrada todo el día por día festivo.${reopenTailEs}`
        : `Hoy (${dayEs}) la ${branchNounEs} permanece cerrada todo el día.${reopenTailEs}`,
      statusMessageEn: todaySched.isSpecial
        ? `Today (${formatHolidayForParenEn(todaySched.holidayNameEn) || dayEn}) ${ourLocLowEn} is closed all day for the holiday.${reopenTailEn}`
        : `Today (${dayEn}) ${ourLocLowEn} is closed all day.${reopenTailEn}`,
      closedGreetingPromptEs: todaySched.isSpecial
        ? `En este momento nuestra sucursal está cerrada; hoy permanecemos cerrados todo el día por ${spokenHolEs}${reopenSpokenEs}. ¿En qué te puedo ayudar?`
        : `En este momento nuestra sucursal está cerrada; hoy permanecemos cerrados todo el día${reopenSpokenEs}. ¿En qué te puedo ayudar?`,
      closedGreetingPromptEn: todaySched.isSpecial
        ? `Our location is currently closed all day for ${spokenHolEn}${reopenSpokenEn}. How can I help you?`
        : `Our location is currently closed all day${reopenSpokenEn}. How can I help you?`,
      weeklySummaryEs: buildWeeklySummary(wh, 'es'),
      weeklySummaryEn: buildWeeklySummary(wh, 'en')
    }
  }

  const openMin = parseTimeToMinutes(todaySched.open)
  const rawCloseMin = parseTimeToMinutes(todaySched.close)
  // Si rawCloseMin <= openMin (ej. cierra a las 00:00 medianoche o 01:00 / 03:00 AM del día siguiente), sumamos 1440
  const effectiveCloseMin = rawCloseMin <= openMin ? rawCloseMin + 1440 : rawCloseMin
  const isOpenNow = pt.currentMinutes >= openMin && pt.currentMinutes < effectiveCloseMin

  const openEs = formatTime12h(todaySched.open, 'es')
  const closeEs = formatTime12h(todaySched.close, 'es')
  const openEn = formatTime12h(todaySched.open, 'en')
  const closeEn = formatTime12h(todaySched.close, 'en')

  let statusMessageEs = ''
  let statusMessageEn = ''
  let closedGreetingPromptEs: string | null = null
  let closedGreetingPromptEn: string | null = null

  if (isOpenNow) {
    if (todaySched.isSpecial && todaySched.holidayName) {
      const hEs = formatHolidayForParenhEs(todaySched.holidayName)
      const hEn = formatHolidayForParenEn(todaySched.holidayNameEn || todaySched.holidayName)
      statusMessageEs = `La ${branchNounEs} está ABIERTA en este momento. Hoy ${dayEs} (${hEs}) tenemos horario especial de ${openEs} a ${closeEs}.`
      statusMessageEn = `${ourLocCapEn} is OPEN right now. Today (${dayEn}, ${hEn}) our special holiday hours are ${openEn} to ${closeEn}.`
    } else {
      statusMessageEs = `La ${branchNounEs} está ABIERTA en este momento. Hoy ${dayEs} nuestro horario es de ${openEs} a ${closeEs}.`
      statusMessageEn = `${ourLocCapEn} is OPEN right now. Today (${dayEn}) our hours are ${openEn} to ${closeEn}.`
    }
  } else if (pt.currentMinutes < openMin) {
    if (todaySched.isSpecial && todaySched.holidayName) {
      const spokenHolEs = cleanSpokenHoliday(todaySched.holidayName)
      const spokenHolEn = expandHolidayMonthsEn(cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName))
      const hEs = formatHolidayForParenhEs(todaySched.holidayName)
      const hEn = formatHolidayForParenEn(todaySched.holidayNameEn || todaySched.holidayName)
      statusMessageEs = `En este momento la ${branchNounEs} está cerrada. Hoy ${dayEs} (${hEs}) abrimos en horario especial ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}.`
      statusMessageEn = `${ourLocCapEn} is currently closed. Today (${dayEn}, ${hEn}) we open at ${openEn} (special holiday hours) and close at ${closeEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal aún está cerrada; hoy por ${spokenHolEs} abrimos en horario especial ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; today for ${spokenHolEn} we open at ${openEn} and close at ${closeEn}. How can I help you?`
    } else {
      statusMessageEs = `En este momento la ${branchNounEs} está cerrada. Hoy ${dayEs} abrimos ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}.`
      statusMessageEn = `${ourLocCapEn} is currently closed. Today (${dayEn}) we open at ${openEn} and close at ${closeEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal aún está cerrada; hoy ${dayEs.toLowerCase()} abrimos ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; today, ${dayEn}, we open at ${openEn} and close at ${closeEn}. How can I help you?`
    }
  } else {
    // Ya cerró por hoy: anunciar el motivo si fue cierre temprano festivo + la apertura REAL siguiente (lookahead hasta +7 días)
    const closedReasonEs = todaySched.isSpecial && todaySched.holidayName ? ` por horario especial de ${cleanSpokenHoliday(todaySched.holidayName)}` : ''
    const closedReasonEn =
      todaySched.isSpecial && (todaySched.holidayNameEn || todaySched.holidayName)
        ? ` for ${expandHolidayMonthsEn(cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName))} special hours`
        : ''

    const regToday = wh[String(pt.dayOfWeek)] || { open: '10:00', close: '00:00' }
    const regTodayClosed = isClosedTimeToken(regToday.open) || isClosedTimeToken(regToday.close)
    const regCloseMin = parseTimeToMinutes(regToday.close)
    const regEffCloseMin = regCloseMin <= parseTimeToMinutes(regToday.open) ? regCloseMin + 1440 : regCloseMin
    const closedEarlierThanUsual = !regTodayClosed && todaySched.isSpecial && effectiveCloseMin < regEffCloseMin

    const spokenTodayHolEs = cleanSpokenHoliday(todaySched.holidayName)
    const spokenTodayHolEn = cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName)
    const todayClosedPartEs =
      todaySched.isSpecial && spokenTodayHolEs
        ? `hoy por ${spokenTodayHolEs} ${closedEarlierThanUsual ? 'cerramos temprano' : 'cerramos'} ${atTimeEs(closeEs)}`
        : `hoy cerramos ${atTimeEs(closeEs)}`
    const todayClosedPartEn =
      todaySched.isSpecial && spokenTodayHolEn
        ? `today for ${spokenTodayHolEn} we ${closedEarlierThanUsual ? 'closed early' : 'closed'} at ${closeEn}`
        : `we closed for the night at ${closeEn}`

    const tomorrowDateStr = addUtcDays(pt.dateStr, 1)
    const tomorrowDow = (pt.dayOfWeek + 1) % 7
    const tomorrowSched = getScheduleForDay(tomorrowDow, tomorrowDateStr)

    if (tomorrowSched.isClosedAllDay) {
      const nextOpen = findNextOpenDay(2)
      const nextOpenEs = nextOpen ? formatTime12h(nextOpen.sched.open, 'es') : ''
      const nextOpenEn = nextOpen ? formatTime12h(nextOpen.sched.open, 'en') : ''
      const reopenNextEs = nextOpen
        ? ` y reanudamos servicio el ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()} ${atTimeEs(nextOpenEs)}`
        : ''
      const reopenNextEn = nextOpen
        ? `, and reopen ${DAY_NAMES_EN[nextOpen.dow]} at ${nextOpenEn}`
        : ''
      const spokenTomHolEs = cleanSpokenHoliday(tomorrowSched.holidayName)
      const spokenTomHolEn = cleanSpokenHoliday(tomorrowSched.holidayNameEn || tomorrowSched.holidayName)
      const reopenSpokenNextEn = nextOpen
        ? `, and we reopen ${DAY_NAMES_EN[nextOpen.dow]} at ${nextOpenEn}`
        : ''

      statusMessageEs = `En este momento la ${branchNounEs} ya cerró por hoy (cerró ${atTimeEs(closeEs)}${closedReasonEs}). Mañana permanecemos cerrados${tomorrowSched.holidayName ? ` por ${formatHolidayForParenhEs(tomorrowSched.holidayName)}` : ''}${reopenNextEs}.`
      statusMessageEn = `${ourLocCapEn} is closed for the day (closed at ${closeEn}${closedReasonEn}). We will be closed tomorrow${tomorrowSched.holidayNameEn || tomorrowSched.holidayName ? ` for ${formatHolidayForParenEn(tomorrowSched.holidayNameEn || tomorrowSched.holidayName)}` : ''}${reopenNextEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal ya está cerrada; ${todayClosedPartEs}, mañana permanecemos cerrados${spokenTomHolEs ? ` por ${spokenTomHolEs}` : ''}${reopenNextEs}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; ${todayClosedPartEn}, we remain closed tomorrow${spokenTomHolEn ? ` for ${spokenTomHolEn}` : ''}${reopenSpokenNextEn}. How can I help you?`
    } else {
      const tomOpenEs = formatTime12h(tomorrowSched.open, 'es')
      const tomOpenEn = formatTime12h(tomorrowSched.open, 'en')
      const tomCloseNoteEs = tomorrowSched.isSpecial && tomorrowSched.close ? ` y cerramos ${atTimeEs(formatTime12h(tomorrowSched.close, 'es'))}` : ''
      const tomCloseNoteEn = tomorrowSched.isSpecial && tomorrowSched.close ? ` and close at ${formatTime12h(tomorrowSched.close, 'en')}` : ''
      const tomorrowSpecialEs =
        tomorrowSched.isSpecial && tomorrowSched.holidayName ? ` (horario especial por ${formatHolidayForParenhEs(tomorrowSched.holidayName)}${tomCloseNoteEs})` : ''
      const tomorrowSpecialEn =
        tomorrowSched.isSpecial && (tomorrowSched.holidayNameEn || tomorrowSched.holidayName)
          ? ` (${formatHolidayForParenEn(tomorrowSched.holidayNameEn || tomorrowSched.holidayName)} special hours${tomCloseNoteEn})`
          : ''

      statusMessageEs = `En este momento la ${branchNounEs} ya cerró por hoy (cerró ${atTimeEs(closeEs)}${closedReasonEs}). Mañana abrimos ${atTimeEs(tomOpenEs)}${tomorrowSpecialEs}.`
      statusMessageEn = `${ourLocCapEn} is closed for the day (closed at ${closeEn}${closedReasonEn}). We reopen tomorrow at ${tomOpenEn}${tomorrowSpecialEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal ya está cerrada; ${todayClosedPartEs} y mañana ${DAY_NAMES_ES[tomorrowDow].toLowerCase()} abrimos ${atTimeEs(tomOpenEs)}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; ${todayClosedPartEn}, and we reopen tomorrow, ${DAY_NAMES_EN[tomorrowDow]}, at ${tomOpenEn}. How can I help you?`
    }
  }

  return {
    storeId,
    storeName,
    isOpenNow,
    activeScheduleDate: pt.dateStr,
    activeDayLabelEs: dayEs,
    activeDayLabelEn: dayEn,
    todayOpen: todaySched.open,
    todayClose: todaySched.close,
    todayOpenFormattedEs: openEs,
    todayCloseFormattedEs: closeEs,
    todayOpenFormattedEn: openEn,
    todayCloseFormattedEn: closeEn,
    isAfterMidnightSpillover: false,
    isSpecialHolidaySchedule: todaySched.isSpecial,
    specialHolidayName: todaySched.holidayName,
    statusMessageEs,
    statusMessageEn,
    closedGreetingPromptEs,
    closedGreetingPromptEn,
    weeklySummaryEs: buildWeeklySummary(wh, 'es'),
    weeklySummaryEn: buildWeeklySummary(wh, 'en')
  }
}

function buildWeeklySummary(wh: Record<string, StoreScheduleDay>, lang: PhoneLang): string {
  const names = lang === 'es' ? DAY_NAMES_ES : DAY_NAMES_EN
  const parts: string[] = []
  for (let d = 0; d <= 6; d++) {
    const slot = wh[String(d)]
    if (!slot) continue
    const closed = isClosedTimeToken(slot.open) || isClosedTimeToken(slot.close)
    parts.push(
      closed
        ? `${names[d]}: ${lang === 'en' ? 'Closed' : 'Cerrado'}`
        : `${names[d]}: ${formatTime12h(slot.open, lang)} - ${formatTime12h(slot.close, lang)}`
    )
  }
  return parts.join(' | ')
}

/**
 * Resume el horario semanal en bloques compactos de días consecutivos con el mismo horario
 * (ej. "Dom-Jue 10:00 AM-1:00 AM; Vie-Sáb 10:00 AM-3:00 AM") para mostrar los horarios reales
 * de las 15 sucursales sin inflar el prompt ni perder diferencias entre días.
 */
export function buildCompactWeeklyHours(rawWeeklyHours: unknown, lang: PhoneLang): string {
  const wh = normalizeWeeklyHours(rawWeeklyHours)
  const shortEs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const shortEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const names = lang === 'es' ? shortEs : shortEn

  const groups: Array<{ start: number; end: number; open: string; close: string }> = []
  for (let d = 0; d <= 6; d++) {
    const slot = wh[String(d)]
    if (!slot) continue
    const last = groups[groups.length - 1]
    if (last && last.end === d - 1 && last.open === slot.open && last.close === slot.close) {
      last.end = d
    } else {
      groups.push({ start: d, end: d, open: slot.open, close: slot.close })
    }
  }

  return groups
    .map((g) => {
      const dayLabel = g.start === g.end ? names[g.start] : `${names[g.start]}-${names[g.end]}`
      const closed = isClosedTimeToken(g.open) || isClosedTimeToken(g.close)
      return closed
        ? `${dayLabel} ${lang === 'en' ? 'Closed' : 'Cerrado'}`
        : `${dayLabel} ${formatTime12h(g.open, lang)}-${formatTime12h(g.close, lang)}`
    })
    .join('; ')
}

function getEffectiveCloseMinutes(openHHMM: string, closeHHMM: string): number {
  const openMin = parseTimeToMinutes(openHHMM)
  const rawCloseMin = parseTimeToMinutes(closeHHMM)
  return rawCloseMin <= openMin ? rawCloseMin + 1440 : rawCloseMin
}

/**
 * Calcula dinámicamente desde la base de datos qué sucursales abren más temprano y cierran más tarde
 * (hoy en tiempo real y por cada día de la semana, tanto entre las 15 tiendas como en el subconjunto Drive-Thru)
 * para evitar comparaciones manuales erróneas del LLM sobre listas densas de horarios.
 */
export function buildCrossStoreHoursComparison(
  stores: Array<{ id: number; name: string; has_drive_thru?: boolean; weekly_hours: unknown }>,
  lang: PhoneLang,
  specialHours: any[] = [],
  now?: Date
): string {
  if (!Array.isArray(stores) || stores.length === 0) return ''
  const ptNow = getPacificDateParts(now || new Date())
  const useCache = !now
  const cmpEpoch = cacheEpoch
  const specialSig = (specialHours || [])
    .filter((s) => s && (s.event_date === ptNow.dateStr || s.event_date === ptNow.yesterdayDateStr))
    .map((s) => `${s.event_date}:${s.store_id ?? 'all'}:${s.is_closed ? 1 : 0}:${s.open_time || ''}:${s.close_time || ''}`)
    .sort()
    .join('|')
  const storeIdsSig = stores
    .map((s) => `${Number(s.id)}:${s.has_drive_thru ? 1 : 0}`)
    .sort()
    .join(',')
  const cacheKey = `${lang}:${ptNow.dateStr}:${Math.floor(ptNow.currentMinutes / 5)}:${storeIdsSig}:${specialSig}`
  if (useCache) {
    const cachedCmp = crossStoreCmpRamCache.get(cacheKey)
    if (cachedCmp && Date.now() - cachedCmp.fetchedAt < 30_000) {
      return cachedCmp.text
    }
  }

  const shortEs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const shortEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayShorts = lang === 'es' ? shortEs : shortEn
  const joinAnd = (items: string[]) => {
    if (items.length <= 1) return items[0] || ''
    if (items.length === 2) return lang === 'es' ? `${items[0]} y ${items[1]}` : `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${items[items.length - 1]}`
  }

  const groupDaysByValue = (entries: Array<{ d: number; text: string }>) => {
    const groups: Array<{ start: number; end: number; text: string }> = []
    for (const item of entries) {
      if (!item.text) continue
      const last = groups[groups.length - 1]
      if (last && last.end === item.d - 1 && last.text === item.text) {
        last.end = item.d
      } else {
        groups.push({ start: item.d, end: item.d, text: item.text })
      }
    }
    return groups
      .map((g) => {
        const label = g.start === g.end ? dayShorts[g.start] : `${dayShorts[g.start]}-${dayShorts[g.end]}`
        return `${label}: ${g.text}`
      })
      .join('; ')
  }

  const getCalendarTodaySchedule = (storeIdNum: number, wh: Record<string, StoreScheduleDay>) =>
    resolveEffectiveDaySchedule({
      storeIdNum,
      regular: wh[String(ptNow.dayOfWeek)],
      dateStr: ptNow.dateStr,
      specialHours
    })

  const summarizeSubset = (subset: typeof stores) => {
    if (subset.length === 0) return null

    const normalized = subset.map((s) => {
      const id = Number(s.id)
      const wh = normalizeWeeklyHours(s.weekly_hours)
      return {
        id,
        name: formatCustomerStoreName({ id, name: s.name }, lang, { style: 'spoken_compact' }),
        wh,
        calToday: getCalendarTodaySchedule(id, wh),
        ev: evaluateStoreSchedulePure({
          storeId: id,
          storeName: s.name,
          weeklyHours: s.weekly_hours,
          specialHours,
          now
        })
      }
    })

    // En madrugada (00:00-05:59 AM), separar qué tiendas siguen ABIERTAS ahorita por turno de anoche
    // sin mezclar fechas al comparar qué sucursales abren/cierran más tarde hoy calendario.
    const spilloverOpenNow = normalized
      .filter((x) => x.ev.isAfterMidnightSpillover && x.ev.isOpenNow)
      .map((x) => ({
        name: x.name,
        closeMin: parseTimeToMinutes(x.ev.todayClose),
        closeFmt: lang === 'es' ? x.ev.todayCloseFormattedEs : x.ev.todayCloseFormattedEn
      }))
      .sort((a, b) => b.closeMin - a.closeMin)

    const spilloverNoteStr =
      spilloverOpenNow.length > 0
        ? lang === 'es'
          ? `Abiertas AHORITA en madrugada: ${spilloverOpenNow.map((s) => `${s.name} (hasta ${s.closeFmt})`).join(', ')}`
          : `Open RIGHT NOW (late-night shift): ${spilloverOpenNow.map((s) => `${s.name} (until ${s.closeFmt})`).join(', ')}`
        : ''

    // Horario uniforme del día calendario HOY en todas las tiendas del subconjunto
    const openCalToday = normalized
      .filter((x) => !x.calToday.isClosedAllDay && !isClosedTimeToken(x.calToday.open) && !isClosedTimeToken(x.calToday.close))
      .map((x) => ({
        name: x.name,
        openMin: parseTimeToMinutes(x.calToday.open),
        closeEff: getEffectiveCloseMinutes(x.calToday.open, x.calToday.close),
        openFmt: formatTime12h(x.calToday.open, lang),
        closeFmt: formatTime12h(x.calToday.close, lang)
      }))

    const todayLabel = lang === 'es' ? DAY_NAMES_ES[ptNow.dayOfWeek] : DAY_NAMES_EN[ptNow.dayOfWeek]

    let todayLatestStr = lang === 'es' ? 'Todas cerradas hoy' : 'All closed today'
    let todayEarliestStr = lang === 'es' ? 'Todas cerradas hoy' : 'All closed today'
    if (openCalToday.length > 0) {
      const maxClose = Math.max(...openCalToday.map((x) => x.closeEff))
      const latest = openCalToday.filter((x) => x.closeEff === maxClose)
      todayLatestStr =
        latest.length >= 10 && latest.length === openCalToday.length
          ? `${lang === 'en' ? 'All open locations' : 'Todas las sucursales abiertas'} (${latest[0].closeFmt})`
          : `${joinAnd(latest.map((x) => x.name))} (${latest[0].closeFmt})`

      const minOpen = Math.min(...openCalToday.map((x) => x.openMin))
      const earliest = openCalToday.filter((x) => x.openMin === minOpen)
      todayEarliestStr =
        earliest.length >= 10 && earliest.length === openCalToday.length
          ? `${lang === 'en' ? 'All open locations' : 'Todas las sucursales abiertas'} (${earliest[0].openFmt})`
          : `${joinAnd(earliest.map((x) => x.name))} (${earliest[0].openFmt})`
    }

    const dailyLatestClose: Array<{ d: number; text: string }> = []
    const dailyEarliestOpen: Array<{ d: number; text: string }> = []
    for (let d = 0; d <= 6; d++) {
      const dayEntries = normalized
        .map((s) => {
          const slot = s.wh[String(d)]
          if (!slot || isClosedTimeToken(slot.open) || isClosedTimeToken(slot.close)) return null
          return {
            name: s.name,
            open: slot.open,
            close: slot.close,
            openMin: parseTimeToMinutes(slot.open),
            closeEff: getEffectiveCloseMinutes(slot.open, slot.close)
          }
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))

      if (dayEntries.length === 0) continue
      const maxClose = Math.max(...dayEntries.map((x) => x.closeEff))
      const latest = dayEntries.filter((x) => x.closeEff === maxClose)
      dailyLatestClose.push({
        d,
        text: `${joinAnd(latest.map((x) => x.name))} (${formatTime12h(latest[0].close, lang)})`
      })

      const minOpen = Math.min(...dayEntries.map((x) => x.openMin))
      const earliest = dayEntries.filter((x) => x.openMin === minOpen)
      dailyEarliestOpen.push({
        d,
        text: `${joinAnd(earliest.map((x) => x.name))} (${formatTime12h(earliest[0].open, lang)})`
      })
    }

    return {
      count: subset.length,
      names: subset.map((s) => formatCustomerStoreName({ id: s.id, name: s.name }, lang, { style: 'spoken_compact' })),
      spilloverNoteStr,
      todayLabel,
      todayLatestStr,
      todayEarliestStr,
      weeklyLatestStr: groupDaysByValue(dailyLatestClose),
      weeklyEarliestStr: groupDaysByValue(dailyEarliestOpen)
    }
  }

  const allSummary = summarizeSubset(stores)
  const dtStores = stores.filter((s) => Boolean(s.has_drive_thru))
  const dtSummary = summarizeSubset(dtStores)
  if (!allSummary) return ''

  if (lang === 'en') {
    const lines = [
      `EXACT LIVE CROSS-STORE SCHEDULE WINNERS (NEVER GUESS OR LUMP STORES TOGETHER):`
    ]
    if (allSummary.spilloverNoteStr) {
      lines.push(`- ${allSummary.spilloverNoteStr}`)
    }
    lines.push(
      `- ALL ${allSummary.count} LOCATIONS -> Today (${allSummary.todayLabel}): latest close ${allSummary.todayLatestStr} | earliest open ${allSummary.todayEarliestStr} | Latest close by day: ${allSummary.weeklyLatestStr} | Earliest open: ${allSummary.weeklyEarliestStr}`
    )
    if (dtSummary) {
      if (dtSummary.spilloverNoteStr) {
        lines.push(`- DRIVE-THRU ${dtSummary.spilloverNoteStr}`)
      }
      lines.push(
        `- DRIVE-THRU ONLY (${dtSummary.count} stores: ${dtSummary.names.join(', ')}) -> Today (${dtSummary.todayLabel}): latest close ${dtSummary.todayLatestStr} | earliest open ${dtSummary.todayEarliestStr} | Latest close by day (Drive-Thru): ${dtSummary.weeklyLatestStr} | Earliest open (Drive-Thru): ${dtSummary.weeklyEarliestStr}`
      )
    }
    const outEn = lines.join('\n')
    if (useCache) setCrossStoreCmpCache(cacheKey, outEn, cmpEpoch)
    return outEn
  }

  const lines = [
    `COMPARATIVA EXACTA EN VIVO ENTRE SUCURSALES (USA ESTOS GANADORES EXACTOS; NUNCA ADIVINES NI AGRUPES TIENDAS CON DISTINTO HORARIO):`
  ]
  if (allSummary.spilloverNoteStr) {
    lines.push(`- ${allSummary.spilloverNoteStr}`)
  }
  lines.push(
    `- TODAS LAS ${allSummary.count} SUCURSALES -> Hoy (${allSummary.todayLabel}): cierra más tarde ${allSummary.todayLatestStr} | abre más temprano ${allSummary.todayEarliestStr} | Cierre más tarde por día: ${allSummary.weeklyLatestStr} | Apertura más temprana: ${allSummary.weeklyEarliestStr}`
  )
  if (dtSummary) {
    if (dtSummary.spilloverNoteStr) {
      lines.push(`- SOLO DRIVE-THRU ${dtSummary.spilloverNoteStr}`)
    }
    lines.push(
      `- SOLO CON DRIVE-THRU (${dtSummary.count} sucursales: ${dtSummary.names.join(', ')}) -> Hoy (${dtSummary.todayLabel}): cierra más tarde ${dtSummary.todayLatestStr} | abre más temprano ${dtSummary.todayEarliestStr} | Cierre más tarde por día (Drive-Thru): ${dtSummary.weeklyLatestStr} | Apertura más temprana (Drive-Thru): ${dtSummary.weeklyEarliestStr}`
    )
  }
  const outEs = lines.join('\n')
  if (useCache) setCrossStoreCmpCache(cacheKey, outEs, cmpEpoch)
  return outEs
}

/**
 * Calcula los paquetes recomendados de Fiesta Platter según el número de invitados,
 * protegiendo contra divisiones por cero, valores negativos o NaN.
 */
export function recommendFiestaPlatters(
  guestCountInput?: number | null,
  menuItems?: Array<{ name?: string | null; category_name?: string | null; price?: number | string | null }> | null
) {
  const g15 = PARTY_TRAY_GUIDELINES['15-20']
  const g20 = PARTY_TRAY_GUIDELINES['20-25']
  const g25 = PARTY_TRAY_GUIDELINES['25-30']
  const g30 = PARTY_TRAY_GUIDELINES['30-40']
  const cornDoz = (packs: number) => (packs * 60) / 12 // 1 paquete = 60 tortillas = 5 docenas
  const flourDoz = (packs: number) => (packs * 12) / 12 // 1 paquete = 12 tortillas = 1 docena

  const findLivePlatterPrice = (sizeRe: RegExp): number | null => {
    if (!Array.isArray(menuItems) || menuItems.length === 0) return null
    const platterCandidate =
      menuItems.find(
        (m) =>
          /fiesta\s*platter|party\s*tray|charola/i.test(String(m?.category_name || '')) &&
          sizeRe.test(String(m?.name || '')) &&
          Number.isFinite(Number(m?.price)) &&
          Number(m?.price) > 0
      ) ||
      menuItems.find(
        (m) =>
          sizeRe.test(String(m?.name || '')) &&
          /people|personas|fiesta|platter/i.test(String(m?.name || '')) &&
          Number.isFinite(Number(m?.price)) &&
          Number(m?.price) > 0
      )
    return platterCandidate ? Number(platterCandidate.price) : null
  }

  const buildPackageSpec = (
    sizeKey: '15-20' | '20-25' | '25-30' | '30-40',
    minGuests: number,
    maxGuests: number,
    sizeRe: RegExp,
    g: typeof g15
  ) => {
    const cDoz = cornDoz(g.cornPacks)
    const fDoz = flourDoz(g.flourPacks)
    return {
      sizeKey,
      labelEs: `Paquete para ${minGuests} a ${maxGuests} personas`,
      labelEn: `${minGuests} to ${maxGuests} People Fiesta Platter`,
      minGuests,
      maxGuests,
      price: findLivePlatterPrice(sizeRe),
      meatLbs: g.meatLbs,
      riceLbs: g.riceLbs,
      beansLbs: g.beansLbs,
      riceBeansTrayEs: `${g.riceLbs} lbs de arroz y ${g.beansLbs} lbs de frijol`,
      riceBeansTrayEn: `${g.riceLbs} lbs of rice and ${g.beansLbs} lbs of beans`,
      aguasGallons: g.aguaGallons,
      cornPacks: g.cornPacks,
      flourPacks: g.flourPacks,
      cornTortillasDozens: cDoz,
      flourTortillasDozens: fDoz,
      tortillasSummaryEs: `${cDoz} docenas de maíz (${g.cornPacks} paquetes) o ${fDoz} docenas de harina (${g.flourPacks} paquetes)`,
      tortillasSummaryEn: `${cDoz} dozen corn (${g.cornPacks} packs) or ${fDoz} dozen flour (${g.flourPacks} packs) tortillas`,
      plates: g.plates,
      forks: g.forks,
      spoons: g.spoons,
      cups: g.cups,
      napkinPacks: g.napkinPacks,
      salsaRojaPacks: g.salsaRojaPacks,
      salsaVerdePacks: g.salsaVerdePacks,
      mixtaBags: g.mixtaBags,
      limeBags: g.limeBags,
      jalapenoOz: g.jalapenoOz,
      extrasSummaryEs: `${g.salsaRojaPacks} salsas rojas, ${g.salsaVerdePacks} verdes, ${g.mixtaBags} cebolla y cilantro, ${g.limeBags} limones, ${g.jalapenoOz} oz chiles y zanahorias, ${g.plates} platos, ${g.forks} tenedores, ${g.spoons} cucharas, ${g.cups} vasos y ${g.napkinPacks} ${g.napkinPacks === 1 ? 'paquete' : 'paquetes'} de servilletas`,
      extrasSummaryEn: `${g.salsaRojaPacks} red & ${g.salsaVerdePacks} green salsas, ${g.mixtaBags} onion/cilantro, ${g.limeBags} limes, ${g.jalapenoOz} oz pickled jalapeños/carrots, ${g.plates} plates, ${g.forks} forks, ${g.spoons} spoons, ${g.cups} cups, and ${g.napkinPacks} napkin pack(s)`,
      exactTortillasVerified: true
    }
  }

  const packages = [
    buildPackageSpec('15-20', 15, 20, /\b15\s*[-–a-z]*\s*20\b/i, g15),
    buildPackageSpec('20-25', 20, 25, /\b20\s*[-–a-z]*\s*25\b/i, g20),
    buildPackageSpec('25-30', 25, 30, /\b25\s*[-–a-z]*\s*30\b/i, g25),
    buildPackageSpec('30-40', 30, 40, /\b30\s*[-–a-z]*\s*40\b/i, g30)
  ]

  const allPricesAvailable = packages.every((p) => p.price !== null && Number.isFinite(p.price))
  const fmtPriceEs = (price: number | null) =>
    price !== null ? ` en $${price.toFixed(2)}` : ' (precio vigente en tacosgavilan.com)'
  const fmtPriceEn = (price: number | null) =>
    price !== null ? ` at $${price.toFixed(2)}` : ' (current price on tacosgavilan.com)'

  const rawGuests = Number(guestCountInput)
  const guests =
    guestCountInput !== null &&
    guestCountInput !== undefined &&
    String(guestCountInput).trim() !== '' &&
    Number.isFinite(rawGuests)
      ? Math.round(rawGuests)
      : NaN
  let recommendationEs =
    'Se ordenan en línea en tacosgavilan.com con mínimo 1 hora de anticipación para recoger el mismo día. Carnes a elegir: Carne Asada, Pollo o Al Pastor. Aguas Frescas: Horchata, Jamaica, Piña o Tamarindo. Todos incluyen arroz, frijol, tortillas de maíz o harina a elegir, salsas, verdura y desechables completos.'
  let recommendationEn =
    'Order online at tacosgavilan.com with at least 1 hour advance notice for same-day pickup. Meats: Carne Asada, Chicken, or Al Pastor. Aguas Frescas: Horchata, Jamaica, Pineapple, or Tamarind. All packages include rice, beans, corn or flour tortillas of your choice, salsas, toppings, and utensils.'

  if (Number.isFinite(guests) && guests > 0) {
    if (guests <= 20) {
      const p = packages[0]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 15 a 20 personas${fmtPriceEs(p.price)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs} y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 15 to 20 people package${fmtPriceEn(p.price)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.tortillasSummaryEn}, and ${p.aguasGallons} gallons of agua fresca).`
    } else if (guests <= 25) {
      const p = packages[1]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 20 a 25 personas${fmtPriceEs(p.price)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs} y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 20 to 25 people package${fmtPriceEn(p.price)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.tortillasSummaryEn}, and ${p.aguasGallons} gallons of agua fresca).`
    } else if (guests === 30) {
      const p25 = packages[2]
      const p30 = packages[3]
      recommendationEs = `Para 30 personas tenemos el paquete de 25 a 30 personas${fmtPriceEs(p25.price)} (${p25.meatLbs} lbs de carne, ${p25.tortillasSummaryEs} y ${p25.aguasGallons} galones de agua fresca) o, si desean porciones más abundantes, el de 30 a 40 personas${fmtPriceEs(p30.price)} (${p30.meatLbs} lbs de carne, ${p30.tortillasSummaryEs} y ${p30.aguasGallons} galones de agua fresca).`
      recommendationEn = `For 30 guests we offer the 25 to 30 people package${fmtPriceEn(p25.price)} (${p25.meatLbs} lbs of meat, ${p25.tortillasSummaryEn}, and ${p25.aguasGallons} gallons of agua fresca), or for larger portions, the 30 to 40 people package${fmtPriceEn(p30.price)} (${p30.meatLbs} lbs of meat, ${p30.tortillasSummaryEn}, and ${p30.aguasGallons} gallons of agua fresca).`
    } else if (guests < 30) {
      const p = packages[2]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 25 a 30 personas${fmtPriceEs(p.price)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs} y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 25 to 30 people package${fmtPriceEn(p.price)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.tortillasSummaryEn}, and ${p.aguasGallons} gallons of agua fresca).`
    } else if (guests <= 40) {
      const p = packages[3]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 30 a 40 personas${fmtPriceEs(p.price)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs} y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 30 to 40 people package${fmtPriceEn(p.price)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.tortillasSummaryEn}, and ${p.aguasGallons} gallons of agua fresca).`
    } else {
      // Combinación óptima de menor costo real (app_menu_cache) o menor exceso de capacidad si el menú no tiene precios
      const cappedGuests = Math.min(500, guests)
      let bestCombo: { counts: number[]; total: number | null; score: number; trays: number; minCap: number; maxCap: number } | null = null
      if (cappedGuests <= 500) {
        const max30 = Math.ceil(cappedGuests / 40) + 1
        for (let c3 = 0; c3 <= max30; c3++) {
          for (let c2 = 0; c2 <= 3; c2++) {
            for (let c1 = 0; c1 <= 3; c1++) {
              for (let c0 = 0; c0 <= 3; c0++) {
                const counts = [c0, c1, c2, c3]
                const trays = c0 + c1 + c2 + c3
                if (trays === 0) continue
                const maxCap = c0 * 20 + c1 * 25 + c2 * 30 + c3 * 40
                if (maxCap < cappedGuests) continue
                const minCap = c0 * 15 + c1 * 20 + c2 * 25 + c3 * 30
                const total = allPricesAvailable
                  ? +(
                      c0 * (packages[0].price as number) +
                      c1 * (packages[1].price as number) +
                      c2 * (packages[2].price as number) +
                      c3 * (packages[3].price as number)
                    ).toFixed(2)
                  : null
                const score = total !== null ? total : maxCap - cappedGuests + trays * 0.25
                if (
                  !bestCombo ||
                  score < bestCombo.score - 0.001 ||
                  (Math.abs(score - bestCombo.score) < 0.001 && trays < bestCombo.trays)
                ) {
                  bestCombo = { counts, total, score, trays, minCap, maxCap }
                }
              }
            }
          }
        }
      }
      if (!bestCombo) {
        const fullTrays = Math.ceil(cappedGuests / 40)
        const total = allPricesAvailable ? +(fullTrays * (packages[3].price as number)).toFixed(2) : null
        bestCombo = {
          counts: [0, 0, 0, fullTrays],
          total,
          score: total ?? fullTrays,
          trays: fullTrays,
          minCap: fullTrays * 30,
          maxCap: fullTrays * 40
        }
      }
      const descPartsEs: string[] = []
      const descPartsEn: string[] = []
      for (let i = packages.length - 1; i >= 0; i--) {
        const q = bestCombo.counts[i]
        if (q <= 0) continue
        const sizeLabel = packages[i].sizeKey.replace('-', ' a ')
        const sizeLabelEn = packages[i].sizeKey.replace('-', ' to ')
        const pkgPriceEs =
          packages[i].price !== null ? ` ($${(packages[i].price as number).toFixed(2)}${q > 1 ? ' cada uno' : ''})` : ''
        const pkgPriceEn =
          packages[i].price !== null ? ` ($${(packages[i].price as number).toFixed(2)}${q > 1 ? ' each' : ''})` : ''
        descPartsEs.push(`${q} ${q === 1 ? 'paquete' : 'paquetes'} de ${sizeLabel} personas${pkgPriceEs}`)
        descPartsEn.push(`${q} ${sizeLabelEn} people ${q === 1 ? 'package' : 'packages'}${pkgPriceEn}`)
      }
      const countDisplay = guests > 500 ? `${cappedGuests} (máximo cotizable por paquete directo)` : String(guests)
      const countDisplayEn = guests > 500 ? `${cappedGuests} (max per automated package quote)` : String(guests)
      const totalTailEs =
        bestCombo.total !== null ? `, total $${bestCombo.total.toFixed(2)}` : ', consulta el total vigente en tacosgavilan.com'
      const totalTailEn =
        bestCombo.total !== null ? `, total $${bestCombo.total.toFixed(2)}` : ', check live total pricing on tacosgavilan.com'
      const comboLabelEs = allPricesAvailable ? 'la combinación más económica' : 'la combinación recomendada'
      const comboLabelEn = allPricesAvailable ? 'the most cost-effective combination' : 'the recommended combination'
      recommendationEs = `Para ${countDisplay} personas ${comboLabelEs} es ${descPartsEs.join(' y ')} (cubre ${bestCombo.minCap} a ${bestCombo.maxCap} personas${totalTailEs}).`
      recommendationEn = `For ${countDisplayEn} guests ${comboLabelEn} is ${descPartsEn.join(' and ')} (serves ${bestCombo.minCap} to ${bestCombo.maxCap} guests${totalTailEn}).`
    }
  }

  return {
    advanceNoticeRuleEs: 'Mínimo 1 hora de anticipación ordenando exclusivamente en línea en tacosgavilan.com',
    advanceNoticeRuleEn: 'Minimum 1 hour advance notice, ordered exclusively online at tacosgavilan.com',
    allowedMeats: ['Carne Asada', 'Pollo (Chicken)', 'Al Pastor'],
    allowedAguasFrescas: ['Horchata', 'Jamaica', 'Piña (Pineapple)', 'Tamarindo (Tamarind)'],
    includedExtrasEs: 'Salsa roja y verde, cebolla con cilantro, limones, chiles jalapeños y zanahorias en vinagre, platos, tenedores, cucharas, vasos y servilletas',
    includedExtrasEn: 'Red and green salsa, chopped onion & cilantro, limes, pickled jalapeños & carrots, plates, forks, spoons, cups, and napkins',
    tortillaCountPolicyEs:
      'Conteos oficiales confirmados (Party Tray Guidelines) según tamaño: 15-20 personas = 10 docenas de maíz (2 paquetes) o 5 docenas de harina (5 paquetes); 20-25 personas = 15 docenas de maíz (3 paquetes) o 7 docenas de harina (7 paquetes); 25-30 personas = 20 docenas de maíz (4 paquetes) o 9 docenas de harina (9 paquetes); 30-40 personas = 25 docenas de maíz (5 paquetes) o 12 docenas de harina (12 paquetes). Al ordenar en línea en tacosgavilan.com también pueden elegir mitad maíz y mitad harina (aprox. 50%/50%).',
    tortillaCountPolicyEn:
      'Confirmed official tortilla counts (Party Tray Guidelines) by size: 15-20 guests = 10 dozen corn (2 packs) or 5 dozen flour (5 packs); 20-25 guests = 15 dozen corn (3 packs) or 7 dozen flour (7 packs); 25-30 guests = 20 dozen corn (4 packs) or 9 dozen flour (9 packs); 30-40 guests = 25 dozen corn (5 packs) or 12 dozen flour (12 packs). When ordering online at tacosgavilan.com guests can also choose half corn and half flour (approx. 50%/50%).',
    packages,
    recommendationEs,
    recommendationEn
  }
}

/**
 * Genera las instrucciones exactas de desvío condicional de llamadas según el operador de la tienda
 * (Spectrum Business fijo vs. Celular Android AT&T).
 */
export function getCarrierForwardingInstructions(
  carrierType: CarrierType,
  twilioPhoneNumber: string | null | undefined,
  ringTimeoutSeconds: number = 20,
  options?: { storePhones?: Array<string | null | undefined> }
) {
  const parsedTw = normalizeUsPhoneE164(twilioPhoneNumber)
  const tenDigit = parsedTw.valid && parsedTw.tenDigits ? parsedTw.tenDigits : ''
  const collidesWithStoreLine = Boolean(
    tenDigit &&
      (options?.storePhones || []).some((sp) => sp && extractPhoneDigits(sp).slice(-10) === tenDigit)
  )
  const hasValidTwilioNumber = Boolean(
    parsedTw.valid && tenDigit.length === 10 && !isFictitiousNanpPhone(tenDigit, false) && !collidesWithStoreLine
  )
  const displayNumEs = hasValidTwilioNumber ? tenDigit : 'NÚMERO_TWILIO'
  const displayNumEn = hasValidTwilioNumber ? tenDigit : 'TWILIO_NUMBER'
  const safeTimeout = Number.isFinite(ringTimeoutSeconds) && ringTimeoutSeconds > 0 ? ringTimeoutSeconds : 20
  const clampedRing = Math.min(30, Math.max(5, Math.round(safeTimeout / 5) * 5))

  if (carrierType === 'spectrum_landline') {
    return {
      hasValidTwilioNumber,
      carrierLabelEs: 'Spectrum Business (Línea Fija)',
      carrierLabelEn: 'Spectrum Business (Landline)',
      activateNoAnswerCode: `*92${displayNumEs}`,
      activateNoAnswerCodeEn: `*92${displayNumEn}`,
      deactivateNoAnswerCode: '*93',
      activateBusyCode: `*90${displayNumEs}`,
      activateBusyCodeEn: `*90${displayNumEn}`,
      deactivateBusyCode: '*91',
      deactivateAllCode: '*93 / *91 / *73',
      deactivateAllCodeEn: '*93 / *91 / *73',
      stepsEs: [
        `Levanta el teléfono fijo de la tienda y marca *92${displayNumEs} para activar el desvío cuando nadie conteste (escucharás tono de confirmación).`,
        `Levanta de nuevo y marca *90${displayNumEs} para que también conteste la IA si la línea ya está ocupada en otra llamada.`,
        `Entra a SpectrumBusiness.net -> Voice Manager -> Call Forwarding para ajustar timbrazos y DESACTIVA el buzón de voz (Voicemail) de Spectrum para que no intercepte antes que la IA.`,
        `Para desactivar en cualquier momento, marca *93 y *91 (o *73 si activaste *72 por error) desde el teléfono de la tienda.`
      ],
      stepsEn: [
        `Pick up the store landline and dial *92${displayNumEn} to enable Call Forwarding No Answer (wait for confirmation tone).`,
        `Pick up again and dial *90${displayNumEn} to enable Call Forwarding Busy so the AI answers when the line is busy.`,
        `Sign in to SpectrumBusiness.net -> Voice Manager -> Call Forwarding to set ring count and DISABLE Spectrum Voicemail so it does not intercept before the AI.`,
        `To disable at any time, dial *93 and *91 (or *73 if *72 was dialed by mistake) from the store phone.`
      ],
      gotchaEs:
        'Nunca uses *72 (desvío incondicional total) si quieres que el teléfono de la caja timbre primero; si se activó por error, cancélalo marcando *73. Asegúrate de apagar el Voicemail de Spectrum en Voice Manager.',
      gotchaEn:
        'Do not use *72 (unconditional forwarding) if you want the register phone to ring first; if enabled by mistake, cancel it with *73. Be sure to disable Spectrum Voicemail in Voice Manager.'
    }
  }

  return {
    hasValidTwilioNumber,
    carrierLabelEs: 'Celular Android con AT&T',
    carrierLabelEn: 'AT&T Android Cellphone',
    activateNoAnswerCode: `*61*${displayNumEs}*11*${clampedRing}#`,
    activateNoAnswerCodeEn: `*61*${displayNumEn}*11*${clampedRing}#`,
    deactivateNoAnswerCode: '##61#',
    activateBusyCode: `*67*${displayNumEs}#`,
    activateBusyCodeEn: `*67*${displayNumEn}#`,
    deactivateBusyCode: '##67#',
    activateUnreachableCode: `*62*${displayNumEs}#`,
    activateUnreachableCodeEn: `*62*${displayNumEn}#`,
    deactivateUnreachableCode: '##62#',
    deactivateAllCode: '##004#',
    deactivateAllCodeEn: '##004#',
    stepsEs: [
      `Paso recomendado (Samsung/Android sin error MMI): apaga Wi-Fi y "Llamadas por Wi-Fi" temporalmente, abre Teléfono -> ⋮ Ajustes -> Servicios complementarios -> Desvío de llamadas -> Llamada de voz. Deja "Desviar siempre" APAGADO y escribe ${displayNumEs} en "Si está ocupado", "Si no hay respuesta" y "Si no está disponible".`,
      `Alternativa por teclado AT&T (sin +1 y con *11*): primero marca ##004# (o ##002#) para limpiar desvíos viejos; si falla MMI, prende y apaga Modo Avión 10 segundos con solo señal celular AT&T.`,
      `Marca *61*${displayNumEs}*11*${clampedRing}# y presiona Llamar (desvía a la IA si nadie contesta en ${clampedRing} s; si la red pide doble asterisco, usa **61*${displayNumEs}*11*${clampedRing}#).`,
      `Marca *67*${displayNumEs}# (cuando la línea esté ocupada) y *62*${displayNumEs}# (sin señal o apagado), luego vuelve a encender Wi-Fi.`,
      `Para desactivar todos los desvíos condicionales al instante, marca ##004# (o ##002#).`
    ],
    stepsEn: [
      `Recommended (Samsung/Android — avoids MMI errors): temporarily turn OFF Wi-Fi and "Wi-Fi Calling", open Phone -> ⋮ Settings -> Supplementary Services -> Call Forwarding -> Voice Call. Leave "Always forward" OFF and enter ${displayNumEn} under "When busy", "When unanswered", and "When unreachable".`,
      `AT&T dialer alternative (no +1, with *11*): dial ##004# (or ##002#) first to clear old forwards; if MMI fails, toggle Airplane Mode for 10 seconds on cellular AT&T signal only.`,
      `Dial *61*${displayNumEn}*11*${clampedRing}# and press Call (forwards if unanswered after ${clampedRing}s; fallback **61*${displayNumEn}*11*${clampedRing}#).`,
      `Dial *67*${displayNumEn}# (when busy) and *62*${displayNumEn}# (when unreachable), then turn Wi-Fi back on.`,
      `To disable all conditional forwarding at any time, dial ##004# (or ##002#).`
    ],
    gotchaEs:
      'En AT&T Wireless jamás incluyas "+1" en *61/*67/*62 y usa siempre "*11*" antes de los segundos (*61*10DIGITOS*11*20#). Si el menú nativo y los códigos muestran "Error de conexión o código MMI", llama al 611 de AT&T para confirmar que la línea tiene habilitado Conditional Call Forwarding (CCF) con el IMEI correcto.',
    gotchaEn:
      'On AT&T Wireless never include "+1" in *61/*67/*62 and always include "*11*" before seconds (*61*10DIGITS*11*20#). If both Settings and star codes fail with an MMI error, call AT&T 611 to ensure Conditional Call Forwarding (CCF) is provisioned on the line/IMEI.'
  }
}

/**
 * Carga (con caché RAM de 5 min) los productos disponibles del menú oficial en línea (`app_menu_cache`) de una sucursal.
 */
async function loadStoreMenuEntry(storeId: number, storeNameFallback = ''): Promise<StoreMenuCacheEntry> {
  const now = Date.now()
  const cachedMenu = storeMenuRamCache.get(storeId)
  if (cachedMenu && now - cachedMenu.fetchedAt <= 60 * 1000) return cachedMenu

  const refresh = async (): Promise<StoreMenuCacheEntry> => {
    let job = storeMenuInFlight.get(storeId)
    if (!job) {
      const fetchEpoch = cacheEpoch
      job = (async () => {
        const { data: items, error } = await supabaseAdmin
          .from('app_menu_cache')
          .select('name, description, price, category_name, is_available')
          .eq('store_id', storeId)
          .eq('is_available', true)
        if (error || !Array.isArray(items)) {
          return cachedMenu || null
        }
        const sanitized = items.map((item: any) => {
          if (item?.name && /\blengua\b/i.test(String(item.name)) && item?.description && /Steamed Beef Head/i.test(String(item.description))) {
            return {
              ...item,
              description: String(item.description).replace(/Steamed Beef Head/gi, 'Steamed Beef Tongue')
            }
          }
          return item
        })
        const storeLabel = storeNameFallback || formatCustomerStoreName(storeId, 'es', { style: 'display' }) || `Sucursal #${storeId}`
        const compactCatalog = buildLiveMenuCatalogText(storeLabel, sanitized, { includeFiestaPlat: false })
        const entry: StoreMenuCacheEntry = {
          items: sanitized,
          compactCatalogEs: compactCatalog,
          compactCatalogEn: compactCatalog,
          fetchedAt: Date.now()
        }
        if (fetchEpoch === cacheEpoch) storeMenuRamCache.set(storeId, entry)
        return entry
      })().finally(() => {
        if (storeMenuInFlight.get(storeId) === job) storeMenuInFlight.delete(storeId)
      })
      storeMenuInFlight.set(storeId, job)
    }
    const res = await job
    return (
      res ||
      cachedMenu || {
        items: [],
        compactCatalogEs: buildLiveMenuCatalogText(storeNameFallback || `Sucursal #${storeId}`, []),
        compactCatalogEn: buildLiveMenuCatalogText(storeNameFallback || `Sucursal #${storeId}`, []),
        fetchedAt: now
      }
    )
  }

  if (cachedMenu && now - cachedMenu.fetchedAt <= 5 * 60 * 1000) {
    void refresh().catch(() => null)
    return cachedMenu
  }
  return refresh()
}

export async function loadStoreMenuItems(storeId: number): Promise<any[]> {
  const entry = await loadStoreMenuEntry(storeId)
  return entry.items
}

const STANDARD_SINGLE_MEAT_PREFIX_RE =
  /^(?:1\s+)?(?:Grilled\s+(?:Steak|Beef|Chicken|Pork\s+Maw|Hog\s+Maw)|Beef\s+Steak|Steamed\s+Beef\s+(?:Head|Tongue)|Braised\s+Pork|Mexican\s+Sausage|Marinated\s+Pork)(?:\s+(?:Mulita|Sope|Taco))?$/i

function normalizeToastMenuPrep(rawDesc: string): string {
  const s = String(rawDesc || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (/^Only\s+.+$/i.test(s)) return 'Only the selected meat'
  const m = s.match(/^(.+?)\s+-\s+(.+)$/)
  if (m && STANDARD_SINGLE_MEAT_PREFIX_RE.test(m[1].trim())) return m[2].trim()
  if (/^(?:Grilled|Marinated|Steamed|Braised|Mexican)\b.+\band Cheese$/i.test(s) && !/\+|Breaded/i.test(s)) {
    return 'Meat and Cheese'
  }
  return s
}

/**
 * Construye el catálogo de precios y descripciones EN VIVO para el prompt, agrupando por categoría y por precio
 * (ej. "- Tacos: Taco Asada, Taco Pastor, ...: $<precio> [Prep Toast: ...]"). Incluye las descripciones reales de Toast
 * (`app_menu_cache.description`) de forma compacta para responder con exactitud qué lleva cada platillo y la diferencia Regular vs Super.
 */
function compactNameGroupList(names: string[]): string {
  if (names.length <= 2) return names.join(', ')
  // Detectar prefijo común (ej. "Super Burrito Asada", "Super Burrito Pastor" -> "Super Burrito [Asada, Pastor, ...]")
  const tokenized = names.map((n) => n.trim().split(/\s+/))
  const minWords = Math.min(...tokenized.map((w) => w.length))
  if (minWords >= 2) {
    let prefixLen = 0
    for (let k = 0; k < minWords - 1; k++) {
      const ref = tokenized[0][k]
      if (tokenized.every((w) => w[k] === ref)) {
        prefixLen = k + 1
      } else {
        break
      }
    }
    if (prefixLen >= 1) {
      const prefix = tokenized[0].slice(0, prefixLen).join(' ')
      const suffixes = tokenized.map((w) => w.slice(prefixLen).join(' '))
      return `${prefix} [${suffixes.join(', ')}]`
    }
  }
  return names.join(', ')
}

export function buildLiveMenuCatalogText(
  storeName: string,
  items: any[],
  opts?: { includeFiestaPlat?: boolean }
): string {
  const includeFiestaPlat = opts?.includeFiestaPlat !== false
  const byCategory = new Map<
    string,
    {
      priceGroups: Map<string, string[]>
      itemPreps: Array<{ name: string; rawDesc: string; norm: string }>
    }
  >()
  for (const it of items || []) {
    const price = Number(it?.price)
    const name = String(it?.name || '').trim()
    if (!name || !Number.isFinite(price) || price <= 0) continue
    const category = String(it?.category_name || 'Otros').trim()
    if (!includeFiestaPlat && /fiesta\s*platter/i.test(category)) continue
    if (!byCategory.has(category)) byCategory.set(category, { priceGroups: new Map(), itemPreps: [] })
    const entry = byCategory.get(category)!
    const priceKey = price.toFixed(2)
    if (!entry.priceGroups.has(priceKey)) entry.priceGroups.set(priceKey, [])
    entry.priceGroups.get(priceKey)!.push(name)

    const rawDesc = String(it?.description || '').replace(/\s+/g, ' ').trim()
    if (rawDesc) {
      entry.itemPreps.push({ name, rawDesc, norm: normalizeToastMenuPrep(rawDesc) })
    }
  }

  if (byCategory.size === 0) {
    return 'CATÁLOGO DE PRECIOS: no disponible en este momento. Si preguntan precios, NO inventes cifras: invita a consultar tacosgavilan.com.'
  }

  const lines: string[] = []
  for (const [category, entry] of byCategory) {
    const segments = Array.from(entry.priceGroups.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([price, names]) => `${compactNameGroupList(names)}: $${price}`)

    let prepSuffix = ''
    if (entry.itemPreps.length > 0) {
      if (/fiesta\s*platter/i.test(category)) {
        const listed = entry.itemPreps.slice(0, 6).map((p) => `${p.name}: ${p.rawDesc}`)
        prepSuffix = ` [Prep Toast: ${listed.join('; ')}]`
      } else {
      const counts = new Map<string, number>()
      for (const p of entry.itemPreps) {
        counts.set(p.norm, (counts.get(p.norm) || 0) + 1)
      }
      let topNorm = ''
      let topCount = 0
      for (const [k, v] of counts) {
        if (v > topCount) {
          topNorm = k
          topCount = v
        }
      }
      if (topCount >= 2 && topCount >= Math.ceil(entry.itemPreps.length / 2)) {
        const outliers = entry.itemPreps
          .filter((p) => p.norm !== topNorm)
          .slice(0, 6)
          .map((p) => `${p.name}: ${p.rawDesc}`)
        prepSuffix = ` [Prep Toast: ${topNorm}${outliers.length ? ` | Variantes: ${outliers.join('; ')}` : ''}]`
      } else {
        const listed = entry.itemPreps.slice(0, 6).map((p) => `${p.name}: ${p.rawDesc}`)
        prepSuffix = ` [Prep Toast: ${listed.join('; ')}]`
      }
      }
    }

    lines.push(`- ${category}: ${segments.join(' | ')}${prepSuffix}`)
  }
  lines.push(
    '- Bebidas Físicas y Sabores Oficiales (cita SIEMPRE los precios en vivo listados arriba en Medium Drinks, Large Drinks y Misc. Drinks; nunca inventes precios): Mediana = vaso de 22 oz, Grande = vaso de 32 oz, Galón Agua Fresca = 128 oz (~5 vasos medianos). Sabores Agua Fresca: Horchata, Jamaica, Piña y Tamarindo (NO Pepino). Champurrado individual = vaso térmico de 16 oz; Caja Champurrado To-Go = 96 oz (rinde 6×16 oz e incluye 8 vasos de cortesía de 12 oz). Café = vaso térmico de 16 oz.'
  )
  lines.push(
    '- Quesos, Desayunos y Postres Oficiales (cita SIEMPRE los precios en vivo en DÓLARES USD listados arriba; JAMÁS digas pesos): Tortas (Cubana, Milanesa, etc.) = Queso Fresco en rebanada (NUNCA crema ni queso fundido; sí mayonesa y aguacate). Quesadillas/Mulitas/Super Burritos = Queso blanco Monterey Jack fundido. Sopes/Platos/Taco Plate/Desayunos = Queso Cotija (Sope Queso añade Queso Fresco). Super Nachos = Queso Amarillo caliente Nacho Cheese. Breakfast: Burrito de Huevo incluye arroz y frijol; Plato de Huevos incluye arroz, frijol c/cotija, ensalada y tortillas; Torta de Huevo se sirve en pan telera. Postres (Desserts): ÚNICAMENTE Flan y Cheesecake individuales (NO manejamos ni vendemos pasteles de cumpleaños, pasteles enteros ni churros).'
  )
  return `CATÁLOGO EN VIVO DE ${storeName.toUpperCase()} (Toast POS — TODOS los precios son en DÓLARES ESTADOUNIDENSES USD, JAMÁS pesos; "Large"=Grande, "Medium"=Mediana):\n${lines.join('\n')}`
}

/**
 * Normaliza colisiones fonéticas frecuentes de Speech-to-Text en telefonía/navegador para tacos, bebidas y servicios
 * (ej. "torta corona" -> "torta cubana", "salad burrito" -> "asada burrito", "muleta" -> "mulita", "driver" -> "drive-thru").
 */
export function normalizePhoneSttTranscript(rawText: string): string {
  const input = String(rawText || '')
  const hasDeliveryDriverContext =
    /\b(uber(?:\s*eats)?|doordash|door\s*dash|grubhub|postmates|repartidor(?:es)?|asignad[oa]s?|entreg[aoó]|delivery\s+driver)\b/i.test(
      input
    )
  let out = input
    .replace(/\btorta(?:s)?\s+corona\b/gi, 'torta cubana')
    .replace(/\b(?:a\s+)?salad\s+burritos?\b/gi, 'asada burrito')
    .replace(/\bfiesta\s+(?:playas?|platers?|platos?|plaza|planes)\b/gi, 'fiesta platter')
    .replace(/(?<!\b(?:dej[eé]|olvid[eé]|perd[ií]|mis?)\s+)\bmuletas\b/gi, 'mulitas')
    .replace(/(?<!\b(?:dej[eé]|olvid[eé]|perd[ií]|mi)\s+)\bmuleta\b/gi, 'mulita')
    .replace(/\bch[ao]mpur{1,2}ado\b/gi, 'champurrado')
    .replace(/\b(?:chapurrado|champorado)\b/gi, 'champurrado')
    .replace(/\borchata\b/gi, 'horchata')
    .replace(/\blingua\b/gi, 'lengua')
    .replace(/(?<!\b(?:soy|llamo|nombre\s+es|habla|apellido)\s+(?:[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+)?)\b(?:puche|guche)\b/gi, 'buche')
    .replace(/\b(drive\s*tru|drive\s*true|drive\s*through|drai\s*tru|draiv\s*tru|dray\s*tru|dry\s*thru|ray\s*tru|raid\s*(?:tru|true|thru|through|threw))\b/gi, 'drive-thru')
    .replace(/\b(tienen?|hay|cuentan?\s+con|con|por\s+el|en\s+el|al|del)\s+(?:raid|ride|drai|dray|dry|drive)\b(?!\s*(?:thru|through|tru|true|-|to\b|in\b|from\b|home\b|away\b|back\b))/gi, '$1 drive-thru')
    .replace(/\b(?:tiquet|tique|tiket|tiquete)\b/gi, 'ticket')
    .replace(/\b(?:cal|call|car)\s+fresh\b/gi, 'calfresh')
    .replace(/\b(?:e[\s.-]b[\s.-]t\.?|i[\s.-]b[\s.-]t\.?)\b/gi, 'ebt')
    .replace(/\b(?:tarjetas?\s+abc|abc\s+(?:card|tarjetas?))\b/gi, 'ebt')
  if (!hasDeliveryDriverContext) {
    out = out.replace(/\b(tienen?|con|hay|por\s+el|en\s+el|al|del)\s+drivers?\b(?!\s+(?:de|for|from|assigned|is|was|never|has|did))/gi, '$1 drive-thru')
  }
  return out
}

export function rankMenuItemsForPrompt(items: any[], query: string, limit: number = 12) {
  if (!Array.isArray(items) || items.length === 0) return []
  const stopWords = new Set([
    'de', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'por', 'para', 'del', 'al', 'que',
    'cuesta', 'cuanto', 'precio', 'precios', 'tienen', 'hay', 'me', 'puedes', 'decir', 'hola', 'quiero',
    'saber', 'how', 'much', 'is', 'the', 'and', 'for', 'do', 'you', 'have', 'can', 'tell', 'cost'
  ])
  const synonymMap: Record<string, string[]> = {
    grande: ['large'], grandes: ['large'], large: ['grande'],
    mediana: ['medium'], mediano: ['medium'], medianas: ['medium'], medium: ['mediana', 'mediano'],
    galon: ['gallon'], galones: ['gallon'], gallon: ['galon'],
    agua: ['horchata', 'jamaica', 'pina', 'tamarindo', 'lemonade', 'water', 'fresca'],
    aguas: ['horchata', 'jamaica', 'pina', 'tamarindo', 'fresca'],
    fresca: ['agua', 'horchata', 'jamaica', 'pina', 'tamarindo'],
    embotellada: ['bottled', 'water'],
    botella: ['bottled', 'water'],
    bottled: ['water', 'embotellada'],
    water: ['bottled', 'agua'],
    fresa: ['strawberry'],
    naranja: ['orange'],
    dieta: ['diet'],
    frijol: ['beans', 'frijol'], frijoles: ['beans', 'frijol'], beans: ['frijol', 'beans'],
    arroz: ['rice'], rice: ['arroz', 'rice'],
    queso: ['cheese', 'queso'], cheese: ['queso', 'cheese'], crema: ['sour', 'cream'],
    cafe: ['coffee'], coffee: ['cafe', 'coffee'], coca: ['coke'], totopos: ['chips'],
    limonada: ['lemonade'], helado: ['iced', 'tea'], te: ['tea', 'iced'],
    pineapple: ['pina', 'agua'], hibiscus: ['jamaica', 'agua'], tamarind: ['tamarindo', 'agua'],
    chicken: ['pollo'], beef: ['asada', 'carne'], steak: ['asada', 'carne'],
    pork: ['carnitas', 'pastor'], tongue: ['lengua'], head: ['cabeza'],
    sausage: ['chorizo', 'salchicha', 'wiener'],
    refresco: ['coke', 'sprite', 'fanta'], soda: ['coke', 'sprite', 'fanta'],
    postre: ['flan', 'cheesecake'], postres: ['flan', 'cheesecake'],
    dessert: ['flan', 'cheesecake'], desserts: ['flan', 'cheesecake'],
    pastel: ['flan', 'cheesecake'], pasteles: ['flan', 'cheesecake'],
    cake: ['cheesecake', 'flan'], cakes: ['cheesecake', 'flan'],
    desayuno: ['huevos', 'breakfast'], huevo: ['huevos', 'breakfast'],
    egg: ['huevos', 'huevo', 'breakfast'], eggs: ['huevos', 'huevo', 'breakfast'],
    milanesa: ['breaded', 'milanesa'], breaded: ['milanesa'],
    jamon: ['ham', 'jamon'], ham: ['jamon'],
    salchicha: ['wiener', 'salchicha'], wiener: ['salchicha'],
  }
  const fixedQuery = normalizePhoneSttTranscript(query)
  const normQuery = normalizeSearchText(fixedQuery)
  const isTeaQuery =
    /(?:^|[^\p{L}])t[éÉ](?![\p{L}])/u.test(fixedQuery) ||
    /\bte\s+(?:helado|frio|negro|verde|iced)\b|\b(?:helado|frio|iced|bebida|drink|vaso|mediano|grande)\b[^.!?]{0,18}\bte\b/i.test(normQuery)
  const rawTokens = normQuery
    .split(/\s+/)
    .filter((t) => (t.length >= 3 || t === 'oz' || (t === 'te' && isTeaQuery)) && !stopWords.has(t))

  const isBottledQuery = rawTokens.includes('embotellada') || rawTokens.includes('botella') || rawTokens.includes('bottled')
  const wantsFiesta = /fiesta|platter|charola|paquete|persona|people|catering/i.test(normQuery)

  const directTokens = new Set<string>()
  const synonymTokens = new Set<string>()
  for (const tok of rawTokens) {
    directTokens.add(tok)
    // Quitar 's' simple en sustantivos (sopes->sope, tortas->torta, mulitas->mulita) y '-es' solo en terminaciones castellanas reales (-nes/-res/-les/-mes/-ces)
    if (tok.length > 4 && /(?:ciones|siones|nes|res|les|mes|ces)$/.test(tok)) {
      directTokens.add(tok.slice(0, -2))
    } else if (tok.length > 4 && tok.endsWith('s')) {
      directTokens.add(tok.slice(0, -1))
    }
    if (tok === 'agua' && isBottledQuery) {
      synonymTokens.add('bottled')
      synonymTokens.add('water')
      continue
    }
    const syns = synonymMap[tok]
    if (syns) for (const s of syns) if (!directTokens.has(s)) synonymTokens.add(s)
  }
  const directList = Array.from(directTokens)
  const synonymList = Array.from(synonymTokens).filter((s) => !directTokens.has(s))
  const allSearchTokens = [...directList, ...synonymList]
  const pickedMap = new Map<string, { item: any; score: number }>()
  const validItems = items.filter((it) => Number.isFinite(Number(it?.price)) && Number(it?.price) > 0)
  const itemKey = (it: any) => `${String(it?.category_name || '')}|${String(it?.name || '')}`

  for (const tok of allSearchTokens) {
    const rawBase = directTokens.has(tok) ? 30 : 10
    for (const m of validItems.filter((it) => normalizeSearchText(it.name).includes(tok)).slice(0, 4)) {
      const penalized =
        !wantsFiesta && /fiesta\s*platter/i.test(String(m.category_name || ''))
          ? Math.max(0, rawBase - 25)
          : rawBase
      if (penalized <= 0) continue
      const k = itemKey(m)
      const prev = pickedMap.get(k)
      if (!prev || penalized > prev.score) pickedMap.set(k, { item: m, score: penalized })
    }
  }
  for (const item of validItems) {
    const metaHay = normalizeSearchText(`${item.category_name || ''} ${item.description || ''}`)
    const nameNorm = normalizeSearchText(item.name)
    let score = 0
    let directNameMatches = 0
    let synNameMatches = 0
    if (nameNorm === normQuery) score += 140
    if (normQuery.length >= 4 && nameNorm.includes(normQuery)) score += 70
    for (const tok of directList) {
      if (nameNorm.includes(tok)) { score += 45; directNameMatches++ }
      else if (metaHay.includes(tok)) score += 15
    }
    for (const syn of synonymList) {
      if (nameNorm.includes(syn)) { score += 28; synNameMatches++ }
      else if (metaHay.includes(syn)) score += 5
    }
    if (directNameMatches >= 2) score += directNameMatches * 30
    else if (directNameMatches + synNameMatches >= 2) score += 14
    if (!wantsFiesta && /fiesta\s*platter/i.test(String(item.category_name || ''))) {
      score = Math.max(0, score - 25)
    }
    if (score > 0) {
      const k = itemKey(item)
      const prev = pickedMap.get(k)
      if (!prev || score > prev.score) pickedMap.set(k, { item, score })
    }
  }
  return Array.from(pickedMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      name: entry.item.name,
      category: entry.item.category_name || 'Menú',
      price: Number(entry.item.price || 0),
      priceFormatted: `$${Number(entry.item.price || 0).toFixed(2)}`,
      description: entry.item.description || ''
    }))
}

/**
 * Busca precios reales en `app_menu_cache` para una sucursal delegando en `rankMenuItemsForPrompt`.
 */
export async function searchStoreMenuPrices(storeId: number, query: string, limit: number = 12) {
  const items = await loadStoreMenuItems(storeId)
  return rankMenuItemsForPrompt(items, query, limit)
}

type ActiveStoreDirectoryItem = {
  id: number
  name: string
  address: string
  phone: string
  has_drive_thru: boolean
  weekly_hours: any
  compactHoursEs: string
  compactHoursEn: string
}

let allStoresDirectoryCache: {
  fetchedAt: number
  stores: ActiveStoreDirectoryItem[]
} | null = null

let allStoresInFlight: Promise<ActiveStoreDirectoryItem[]> | null = null

export async function loadAllActiveStoresDirectory(opts?: {
  supabaseClient?: any
  bypassRamCache?: boolean
}): Promise<ActiveStoreDirectoryItem[]> {
  const db = opts?.supabaseClient || supabaseAdmin
  const useRam = !opts?.supabaseClient && !opts?.bypassRamCache
  const now = Date.now()
  if (useRam && allStoresDirectoryCache && now - allStoresDirectoryCache.fetchedAt < 60 * 1000) {
    return allStoresDirectoryCache.stores
  }
  const fetchStores = async () => {
    if (useRam && allStoresInFlight) return allStoresInFlight
    const fetchEpoch = cacheEpoch
    const job = (async () => {
      const { data, error } = await db
        .from('stores')
        .select('id, name, address, phone, has_drive_thru, weekly_hours, is_active')
        .eq('is_active', true)
        .order('id', { ascending: true })
      if (error || !data || data.length === 0) {
        return useRam ? allStoresDirectoryCache?.stores || [] : []
      }
      const stores = data.map((s: any) => ({
        id: Number(s.id),
        name: cleanPhoneStoreName(s.name),
        address: String(s.address || ''),
        phone: String(s.phone || ''),
        has_drive_thru: Boolean(s.has_drive_thru),
        weekly_hours: s.weekly_hours || null,
        compactHoursEs: buildCompactWeeklyHours(s.weekly_hours, 'es'),
        compactHoursEn: buildCompactWeeklyHours(s.weekly_hours, 'en')
      }))
      if (useRam && fetchEpoch === cacheEpoch) allStoresDirectoryCache = { fetchedAt: Date.now(), stores }
      return stores
    })().finally(() => {
      if (useRam && allStoresInFlight === job) allStoresInFlight = null
    })
    if (useRam) allStoresInFlight = job
    return job
  }

  if (useRam && allStoresDirectoryCache && now - allStoresDirectoryCache.fetchedAt < 5 * 60 * 1000) {
    void fetchStores().catch(() => null)
    return allStoresDirectoryCache.stores
  }
  return fetchStores()
}

export async function loadAllSpecialHoursCached(opts?: { supabaseClient?: any; bypassRamCache?: boolean }): Promise<any[]> {
  const db = opts?.supabaseClient || supabaseAdmin
  const useRam = !opts?.supabaseClient && !opts?.bypassRamCache
  const now = Date.now()
  if (useRam && specialHoursRamCache && now - specialHoursRamCache.fetchedAt < 12 * 1000) {
    return specialHoursRamCache.rows
  }
  const fetchSp = async () => {
    if (useRam && specialHoursInFlight) return specialHoursInFlight
    const fetchEpoch = cacheEpoch
    const job = (async () => {
      const { data, error } = await db
        .from('phone_special_hours')
        .select('*')
        .order('event_date', { ascending: true })
      if (error || !Array.isArray(data)) {
        return useRam ? specialHoursRamCache?.rows || [] : []
      }
      if (useRam && fetchEpoch === cacheEpoch) specialHoursRamCache = { rows: data, fetchedAt: Date.now() }
      return data
    })().finally(() => {
      if (useRam && specialHoursInFlight === job) specialHoursInFlight = null
    })
    if (useRam) specialHoursInFlight = job
    return job
  }
  if (useRam && specialHoursRamCache && now - specialHoursRamCache.fetchedAt < 120 * 1000) {
    void fetchSp().catch(() => null)
    return specialHoursRamCache.rows
  }
  return fetchSp()
}

async function loadAllActiveKnowledgeBaseCached(opts?: { supabaseClient?: any; bypassRamCache?: boolean }): Promise<any[]> {
  const db = opts?.supabaseClient || supabaseAdmin
  const useRam = !opts?.supabaseClient && !opts?.bypassRamCache
  const now = Date.now()
  if (useRam && allKbRamCache && now - allKbRamCache.fetchedAt < 12 * 1000) {
    return allKbRamCache.rows
  }
  const fetchKb = async () => {
    if (useRam && allKbInFlight) return allKbInFlight
    const fetchEpoch = cacheEpoch
    const job = (async () => {
      const { data, error } = await db
        .from('phone_knowledge_base')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
      if (error || !Array.isArray(data)) {
        return useRam ? allKbRamCache?.rows || [] : []
      }
      if (useRam && fetchEpoch === cacheEpoch) allKbRamCache = { rows: data, fetchedAt: Date.now() }
      return data
    })().finally(() => {
      if (useRam && allKbInFlight === job) allKbInFlight = null
    })
    if (useRam) allKbInFlight = job
    return job
  }
  if (useRam && allKbRamCache && now - allKbRamCache.fetchedAt < 120 * 1000) {
    void fetchKb().catch(() => null)
    return allKbRamCache.rows
  }
  return fetchKb()
}

export async function getPhoneRoutingDirectory(): Promise<PhoneRoutingDirectoryEntry> {
  const now = Date.now()
  if (phoneRoutingDirCache && now - phoneRoutingDirCache.fetchedAt < 15 * 1000) {
    return phoneRoutingDirCache
  }
  if (phoneRoutingDirInFlight) return phoneRoutingDirInFlight
  const fetchEpoch = cacheEpoch
  phoneRoutingDirInFlight = (async () => {
    const [{ data: configs, error: cfgErr }, { data: stores, error: storeErr }] = await Promise.all([
      supabaseAdmin.from('phone_agent_config').select('store_id, twilio_phone_number').order('store_id', { ascending: true }),
      supabaseAdmin.from('stores').select('id, phone, is_active').order('id', { ascending: true })
    ])
    if (cfgErr || storeErr) {
      if (phoneRoutingDirCache) return phoneRoutingDirCache
      throw cfgErr || storeErr
    }
    const entry: PhoneRoutingDirectoryEntry = {
      fetchedAt: Date.now(),
      configs: (configs || []) as Array<{ store_id: number; twilio_phone_number: string | null }>,
      activeStores: ((stores || []) as Array<{ id: number; phone: string | null; is_active: boolean | null }>).filter(
        (s) => s.is_active !== false
      )
    }
    if (fetchEpoch === cacheEpoch) phoneRoutingDirCache = entry
    return entry
  })().finally(() => {
    phoneRoutingDirInFlight = null
  })
  return phoneRoutingDirInFlight
}

function normalizeRouteDigits10(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/**
 * Resuelve la sucursal de destino para llamadas Twilio reales con precedencia segura para piloto con 1 solo número
 * o 15 números dedicados:
 * 1) Query param `?storeId=`,
 * 2) `ForwardedFrom` contra `stores.phone` (PRIORITARIO sobre `To` para soportar desvíos de múltiples tiendas al mismo número piloto),
 * 3) `To` contra `phone_agent_config.twilio_phone_number`,
 * 4) Respaldo piloto opcional via `TWILIO_DEFAULT_STORE_ID`.
 */
export async function resolveStoreFromIncomingCall(params: {
  queryStoreId?: string | null
  toNumber?: string | null
  forwardedFrom?: string | null
  directory?: PhoneRoutingDirectoryEntry
  defaultPilotStoreId?: number | null
}): Promise<{ storeId: number | null; matchedStorePhone: string | null; matchedBy: 'query' | 'forwarded_from' | 'to_twilio' | 'pilot_env' | null }> {
  const dir = params.directory || (await getPhoneRoutingDirectory())
  const storeById = new Map<number, any>(dir.activeStores.map((s) => [Number(s.id), s]))

  if (params.queryStoreId && Number.isFinite(Number(params.queryStoreId))) {
    const candidate = Number(params.queryStoreId)
    const found = storeById.get(candidate)
    if (found) {
      return { storeId: candidate, matchedStorePhone: found.phone || null, matchedBy: 'query' }
    }
  }

  const fwdDigits = normalizeRouteDigits10(params.forwardedFrom)
  if (fwdDigits.length === 10) {
    const matchByForwarded = dir.activeStores.find((s) => s.phone && normalizeRouteDigits10(s.phone) === fwdDigits)
    if (matchByForwarded) {
      return {
        storeId: Number(matchByForwarded.id),
        matchedStorePhone: matchByForwarded.phone || null,
        matchedBy: 'forwarded_from'
      }
    }
  }

  const toDigits = normalizeRouteDigits10(params.toNumber)
  if (toDigits.length === 10 && dir.configs) {
    const matchesByTwilio = dir.configs.filter(
      (c) =>
        c.twilio_phone_number &&
        normalizeRouteDigits10(c.twilio_phone_number) === toDigits &&
        storeById.has(Number(c.store_id))
    )
    if (matchesByTwilio.length === 1) {
      const onlyMatch = matchesByTwilio[0]
      const s = storeById.get(Number(onlyMatch.store_id))
      return { storeId: Number(onlyMatch.store_id), matchedStorePhone: s?.phone || null, matchedBy: 'to_twilio' }
    }
    // Si 2+ sucursales comparten un mismo número piloto y no llegó ForwardedFrom, no suplantar al azar: usar solo TWILIO_DEFAULT_STORE_ID si existe
  }

  const envPilotRaw =
    params.defaultPilotStoreId ??
    (process.env.TWILIO_DEFAULT_STORE_ID ? Number(process.env.TWILIO_DEFAULT_STORE_ID) : null)
  if (envPilotRaw && Number.isFinite(envPilotRaw) && storeById.has(Number(envPilotRaw))) {
    const s = storeById.get(Number(envPilotRaw))
    return { storeId: Number(envPilotRaw), matchedStorePhone: s?.phone || null, matchedBy: 'pilot_env' }
  }

  return { storeId: null, matchedStorePhone: null, matchedBy: null }
}

/**
 * Obtiene el contexto completo de una sucursal (`stores`, `phone_agent_config`, `phone_special_hours`, `phone_knowledge_base`)
 * usando caché en RAM SWR (12s fresco / 120s stale) y compartiendo catálogos globales entre las 15 sucursales.
 * Falla en cerrado (`fail-closed`) si falla la lectura de `phone_agent_config` para nunca activar una tienda que podría estar apagada.
 */
export async function getStorePhoneContext(
  storeId: number,
  opts?: { supabaseClient?: any; bypassRamCache?: boolean }
) {
  const db = opts?.supabaseClient || supabaseAdmin
  const useRamCache = !opts?.supabaseClient && !opts?.bypassRamCache
  const now = Date.now()
  const cached = useRamCache ? storeContextRamCache.get(storeId) : undefined
  if (cached && now - cached.fetchedAt < 12 * 1000) {
    const freshEval = evaluateStoreSchedulePure({
      storeId: cached.data.store.id,
      storeName: cached.data.store.name,
      weeklyHours: cached.data.store.weekly_hours,
      specialHours: cached.data.specialHours || []
    })
    return {
      ...cached.data,
      scheduleEval: freshEval
    }
  }

  const refreshContext = async () => {
    const inFlight = useRamCache ? storeContextInFlight.get(storeId) : undefined
    if (inFlight) return inFlight
    const fetchEpoch = cacheEpoch
    const job = (async () => {
      const subOpts = useRamCache ? undefined : { supabaseClient: db, bypassRamCache: true }
      const [allStores, configRes, allSpecialHours, allKb] = await Promise.all([
        loadAllActiveStoresDirectory(subOpts),
        db.from('phone_agent_config').select('*').eq('store_id', storeId).maybeSingle(),
        loadAllSpecialHoursCached(subOpts),
        loadAllActiveKnowledgeBaseCached(subOpts)
      ])

      if (configRes.error) {
        throw new Error(
          `Error al leer phone_agent_config para sucursal #${storeId}: ${configRes.error.message || String(configRes.error)}`
        )
      }

      let store = allStores.find((s) => Number(s.id) === Number(storeId)) || null
      if (!store) {
        const { data: rawStore, error: rawStoreErr } = await db
          .from('stores')
          .select('id, name, address, phone, has_drive_thru, weekly_hours')
          .eq('id', storeId)
          .single()
        if (rawStoreErr || !rawStore) {
          throw new Error(
            `Sucursal #${storeId} no encontrada${rawStoreErr?.message ? `: ${rawStoreErr.message}` : ''}`
          )
        }
        store = {
          id: Number(rawStore.id),
          name: cleanPhoneStoreName(rawStore.name),
          address: String(rawStore.address || ''),
          phone: String(rawStore.phone || ''),
          has_drive_thru: Boolean(rawStore.has_drive_thru),
          weekly_hours: rawStore.weekly_hours || null,
          compactHoursEs: buildCompactWeeklyHours(rawStore.weekly_hours, 'es'),
          compactHoursEn: buildCompactWeeklyHours(rawStore.weekly_hours, 'en')
        }
      }

      const storeSpecial = allSpecialHours.filter(
        (s: any) => s.store_id === null || Number(s.store_id) === Number(storeId)
      )
      const storeKb = allKb.filter(
        (k: any) => k.store_id === null || Number(k.store_id) === Number(storeId)
      )

      // Si una sucursal todavía no tiene registro en phone_agent_config (error === null && data === null),
      // mantener fail-closed (is_enabled: false) para jamás activarla por error.
      const config = configRes.data || {
        store_id: store.id,
        is_enabled: false,
        routing_mode: 'conditional_forward',
        carrier_type: [1, 8, 14, 16].includes(store.id) ? 'spectrum_landline' : 'att_wireless',
        twilio_phone_number: null,
        forwarding_status: 'pending',
        ring_timeout_seconds: 20,
        voice_id: 'Kore',
        default_language: 'es',
        custom_greeting_es: null,
        custom_greeting_en: null,
        manager_transfer_phone: null,
        allow_live_transfer: false,
        accepts_ebt: ![1, 9].includes(store.id),
        parking_notes_es: null,
        parking_notes_en: null
      }

      const scheduleEval = evaluateStoreSchedulePure({
        storeId: store.id,
        storeName: store.name,
        weeklyHours: store.weekly_hours,
        specialHours: storeSpecial
      })

      const result = {
        store,
        config,
        scheduleEval,
        specialHours: storeSpecial,
        allSpecialHours,
        knowledgeBase: storeKb,
        onlineOrderUrl: OFFICIAL_STORE_URLS[store.id] || OFFICIAL_ORDER_FALLBACK_URL
      }
      if (useRamCache && fetchEpoch === cacheEpoch) {
        storeContextRamCache.set(storeId, { data: result, fetchedAt: Date.now() })
      }
      return result
    })().finally(() => {
      if (useRamCache && storeContextInFlight.get(storeId) === job) {
        storeContextInFlight.delete(storeId)
      }
    })
    if (useRamCache) {
      storeContextInFlight.set(storeId, job)
    }
    return job
  }

  if (cached && now - cached.fetchedAt < 120 * 1000) {
    void refreshContext().catch(() => null)
    const freshEval = evaluateStoreSchedulePure({
      storeId: cached.data.store.id,
      storeName: cached.data.store.name,
      weeklyHours: cached.data.store.weekly_hours,
      specialHours: cached.data.specialHours || []
    })
    return { ...cached.data, scheduleEval: freshEval }
  }
  return refreshContext()
}

/**
 * Crea un recado prioritario en `phone_callback_requests` separando estrictamente
 * `source = 'twilio'` (llamadas reales que encienden el banner rojo en `/order-ready-board`)
 * vs `source = 'simulator'` (pruebas de entrenamiento del Simulador Web).
 */
export async function createManagerCallbackRequest(params: {
  callId?: string | null
  storeId: number
  originStoreId?: number | null
  source?: 'twilio' | 'simulator'
  callerName: string
  callerPhone: string
  callerType?: string
  urgency?: string
  reasonCategory?: string
  reasonSummary: string
  ticketOrOrderNumber?: string | null
}) {
  const ptBiz = getPacificDateParts()
  const businessDate = ptBiz.hour < 6 ? ptBiz.yesterdayDateStr : ptBiz.dateStr
  const cleanCategory = params.reasonCategory || 'other'
  const cleanUrgency = cleanCategory === 'condiments_note' ? 'normal' : params.urgency || 'high'
  const payload: Record<string, any> = {
    call_id: params.callId || null,
    store_id: params.storeId,
    source: params.source === 'simulator' ? 'simulator' : 'twilio',
    caller_name: (params.callerName || 'Cliente').trim(),
    caller_phone: (params.callerPhone || 'No proporcionado').trim(),
    caller_type: params.callerType || 'customer',
    urgency: cleanUrgency,
    reason_category: cleanCategory,
    reason_summary: (params.reasonSummary || 'Solicitud de llamada al gerente').trim(),
    ticket_or_order_number: params.ticketOrOrderNumber ? String(params.ticketOrOrderNumber).trim() : null,
    status: 'pending',
    business_date: businessDate
  }
  if (params.originStoreId && Number(params.originStoreId) !== Number(params.storeId)) {
    payload.origin_store_id = Number(params.originStoreId)
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('phone_callback_requests')
    .insert(payload)
    .select()
    .single()

  if (error) {
    // Deduplicación atómica en PostgreSQL (índice único parcial idx_phone_callbacks_one_pending_per_call)
    if (error.code === '23505' && payload.call_id) {
      const { data: winner, error: winErr } = await supabaseAdmin
        .from('phone_callback_requests')
        .select('*')
        .eq('call_id', payload.call_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (winErr) {
        throw new Error(`Error al leer recado duplicado para el gerente: ${winErr.message}`)
      }
      if (!winner) {
        // El recado anterior se resolvió justo en medio de la carrera: reintentar INSERT una sola vez
        const { data: retried, error: retryErr } = await supabaseAdmin
          .from('phone_callback_requests')
          .insert(payload)
          .select()
          .single()
        if (retryErr) {
          throw new Error(`Error al guardar recado tras reintento: ${retryErr.message}`)
        }
        return retried
      }

      const patch: Record<string, any> = {}
      const prevSummary = String(winner.reason_summary || '')
      if (payload.reason_summary && !prevSummary.includes(payload.reason_summary)) {
        patch.reason_summary = `${prevSummary} | ${payload.reason_summary}`.slice(0, 2000)
      }
      if (payload.caller_phone && payload.caller_phone !== 'No proporcionado' && extractPhoneDigits(payload.caller_phone).length >= 10) {
        patch.caller_phone = payload.caller_phone
      }
      if (
        payload.caller_name &&
        !/^(cliente|customer|cliente en linea|caller|unknown)$/i.test(normalizeSearchText(payload.caller_name))
      ) {
        patch.caller_name = payload.caller_name
      }
      if (payload.ticket_or_order_number) {
        const prevTk = String(winner.ticket_or_order_number || '').trim()
        const prevIsRealTk = Boolean(prevTk) && !/\b(?:sin|no)\s*ticket\b/i.test(normalizeSearchText(prevTk))
        const nextIsNoTk = /\b(?:sin|no)\s*ticket\b/i.test(normalizeSearchText(payload.ticket_or_order_number))
        if (!(prevIsRealTk && nextIsNoTk)) {
          patch.ticket_or_order_number = payload.ticket_or_order_number
        }
      }
      if (payload.store_id && Number(payload.store_id) !== Number(winner.store_id)) {
        patch.store_id = payload.store_id
        patch.origin_store_id =
          payload.origin_store_id && Number(payload.origin_store_id) !== Number(payload.store_id)
            ? payload.origin_store_id
            : null
      }
      const urgencyRank: Record<string, number> = { normal: 1, high: 2, urgent: 3, critical: 4 }
      const prevRank = urgencyRank[String(winner.urgency || 'normal').toLowerCase()] ?? 1
      const nextRank = urgencyRank[String(payload.urgency || 'normal').toLowerCase()] ?? 1
      if (nextRank > prevRank) {
        patch.urgency = payload.urgency
      }
      if (winner.reason_category === 'condiments_note' && payload.reason_category && payload.reason_category !== 'condiments_note') {
        patch.reason_category = payload.reason_category
        if (!patch.urgency || (urgencyRank[String(patch.urgency)] ?? 1) < 2) {
          patch.urgency = payload.urgency === 'critical' ? 'critical' : 'high'
        }
      }
      if (Object.keys(patch).length > 0) {
        const { data: merged, error: mergeErr } = await supabaseAdmin
          .from('phone_callback_requests')
          .update(patch)
          .eq('id', winner.id)
          .select()
          .maybeSingle()
        if (mergeErr) {
          throw new Error(`Error al actualizar recado existente: ${mergeErr.message}`)
        }
        return { ...(merged || { ...winner, ...patch }), _wasDeduplicated: true }
      }
      return { ...winner, _wasDeduplicated: true }
    }
    throw new Error(`Error al guardar recado para el gerente: ${error.message}`)
  }

  // NOTA DE SEGURIDAD (RLS + Polling Autenticado):
  // Las tablas `phone_*` tienen RLS estricto (`service_role` únicamente) para proteger PII telefónico.
  // El banner del gerente en `/order-ready-board` consulta `/api/phone/dashboard?callbacksOnly=true` (solo `source='twilio'`)
  // con recuperación instantánea al reactivar pestaña/red.
  return inserted
}

/**
 * Devuelve la frase hablada posterior al aviso de apertura:
 * - Si la sucursal está ABIERTA: "¿En qué te ayudo hoy?" / "How can I help you today?"
 * - Si la sucursal está CERRADA (ej. Thanksgiving 6:00 PM, Navidad, Viernes Santo o madrugada): anuncia primero
 *   con claridad que ya está cerrada + el motivo/hora y la reapertura, y luego ofrece ayudar en lo que necesite.
 */
export function getPostDisclosurePrompt(lang: PhoneLang, scheduleEval?: StoreOpenEvaluation | null): string {
  if (scheduleEval && !scheduleEval.isOpenNow) {
    if (lang === 'en') {
      return scheduleEval.closedGreetingPromptEn || `${scheduleEval.statusMessageEn} How can I help you today?`
    }
    return scheduleEval.closedGreetingPromptEs || `${scheduleEval.statusMessageEs} ¿En qué te ayudo hoy?`
  }
  return lang === 'en' ? 'How can I help you today?' : '¿En qué te ayudo hoy?'
}

/**
 * Construye el saludo oficial conciso de apertura de llamada (sin repetir "IA" / "inteligencia artificial"):
 * - Español (entrada principal con tecla 9):
 *   `"¡Gracias por llamar a Tacos Gavilan Lynwood! For English, press nine. Hablas con nuestra asistente virtual en una llamada transcrita para atenderte. ¿En qué te ayudo hoy?"`
 * - Inglés (al presionar tecla 9, `includeLanguageSwitchHint: false`):
 *   `"Thanks for calling Tacos Gavilan in Los Angeles, at the corner of Slauson and Broadway! You're speaking with our virtual assistant on a transcribed line. How can I help you today?"`
 * - Cumple con California AB 2905 / CIPA informando con exactitud que atiende nuestra asistente virtual y que la llamada es transcrita (el sistema no graba audio).
 */
export function buildInitialGreeting(
  storeName: string,
  lang: PhoneLang,
  customEs?: string | null,
  customEn?: string | null,
  options?: {
    omitTrailingQuestion?: boolean
    includeLanguageSwitchHint?: boolean
    scheduleEval?: StoreOpenEvaluation | null
  }
): string {
  const greetingTarget = formatCustomerGreetingTarget(storeName, lang)
  // Por defecto incluye la opción de tecla 9 en la entrada principal; al cambiar con tecla 9 se pasa includeLanguageSwitchHint: false
  const includeHint = options?.includeLanguageSwitchHint !== false
  const postPrompt = options?.omitTrailingQuestion ? '' : ` ${getPostDisclosurePrompt(lang, options?.scheduleEval)}`

  if (lang === 'en') {
    const switchEs = includeHint ? ' Para español, oprima el nueve.' : ''
    if (customEn && customEn.trim()) {
      let baseEn = sanitizeCustomerStoreReferencesInText(
        customEn.trim().replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan'),
        'en'
      )
        .replace(/\b(are(?:\s+being)?)\s+recorded\s+(?:and|or)\s+(?=transcrib)/gi, 'are ')
        .replace(/\b(?:may\s+be|can\s+be|might\s+be|will\s+be|is(?:\s+being)?)\s+recorded\s+(?:and|or)\s+(?=transcrib)/gi, 'is ')
        .replace(/\brecorded\s+(?:and|or)\s+(?=transcrib)/gi, '')
        .replace(/\s+(?:and|or)\s+(?:being\s+)?(?:recorded|recording)\b/gi, '')
        .replace(/\b(?:are(?:\s+being)?)\s+recorded\b/gi, 'are transcribed')
        .replace(/\b(?:may\s+be|can\s+be|might\s+be|will\s+be|is(?:\s+being)?)\s+recorded\b/gi, 'is transcribed')
        .replace(/\bwe\s+(?:are\s+recording|(?:may|might|will)\s+record|record)\s+(?:all\s+|this\s+|your\s+)?(calls?|lines?|conversations?)\b/gi, 'we transcribe $1')
        .replace(/\brecorded\s+(line|call|conversation|for|to|and|or)\b/gi, 'transcribed $1')
        .replace(/\b(line|call|calls|conversation|conversations)\s+(?:being\s+)?recorded\b/gi, '$1 transcribed')
        .replace(/\b(?:audio|voice|call)\s+recording\b/gi, 'call transcription')
        .replace(/\brecording\b/gi, 'transcribing')
        .replace(/\brecorded\b/gi, 'transcribed')
        .replace(/\s*how (?:can|may) (?:i|we) (?:help|assist) you(?: today)?\??\s*$/i, '')
        .trim()
      if (!/[.!?]$/.test(baseEn)) baseEn += '.'
      if (includeHint && !/\b(oprim[ae]|marqu[ae]|marca|presion[ae]|press)\b[^.!?]{0,25}\b(nueve|nine|9)\b/i.test(baseEn)) {
        baseEn += switchEs
      }
      const hasVirtualAndTranscribe =
        /\b(ai|artificial intelligence|virtual assistant)\b/i.test(baseEn) &&
        /\btranscrib\w*/i.test(baseEn)
      if (!hasVirtualAndTranscribe) {
        baseEn += " You're speaking with our virtual assistant on a transcribed line."
      }
      if (options?.omitTrailingQuestion) {
        return baseEn.trim()
      }
      if (options?.scheduleEval && !options.scheduleEval.isOpenNow && /\b(closed|currently closed|we close)\b/i.test(baseEn)) {
        return `${baseEn} ${getPostDisclosurePrompt('en', null)}`.trim()
      }
      return `${baseEn}${postPrompt}`.trim()
    }
    return `Thanks for calling Tacos Gavilan ${greetingTarget}!${switchEs} You're speaking with our virtual assistant on a transcribed line.${postPrompt}`
  }

  // "nine" escrito en letra para que la voz en español lo pronuncie en inglés puro ("press nine" y no "press nueve")
  const switchEn = includeHint ? ' For English, press nine.' : ''
  if (customEs && customEs.trim()) {
    let baseEs = sanitizeCustomerStoreReferencesInText(
      customEs.trim().replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan'),
      'es'
    )
      .replace(/\b(?:pueden\s+ser|son|est[aá]n(?:\s+siendo)?|ser[aá]n)\s+grabad[oa]s?\s+(?:y|o)\s+(?=transcrit)/gi, 'son ')
      .replace(/\b(?:puede\s+ser|pueda\s+ser|es|est[aá](?:\s+siendo)?|ser[aá])\s+grabad[oa]s?\s+(?:y|o)\s+(?=transcrit)/gi, 'es ')
      .replace(/\bse\s+est[aá]n?\s+grabando\s+(?:y|o)\s+(?=transcrib)/gi, 'se está ')
      .replace(/\b(?:grabad[oa]s?|grabando)\s+(?:y|o)\s+(?=transcri[bt])/gi, '')
      .replace(/\s+(?:y|o|ni)\s+(?:est[aá]n?\s+siendo\s+)?(?:grabad[oa]s?|grabando)\b/gi, '')
      .replace(/\b(?:pueden\s+ser|son|est[aá]n(?:\s+siendo)?|ser[aá]n)\s+grabad[oa]s?\b/gi, 'son transcritas')
      .replace(/\b(?:puede\s+ser|pueda\s+ser|es|est[aá](?:\s+siendo)?|ser[aá])\s+grabad[oa]s?\b/gi, 'es transcrita')
      .replace(/\b(llamadas|l[ií]neas|conversaciones)\s+(?:est[aá]n\s+siendo\s+)?grabad[oa]s\b/gi, '$1 transcritas')
      .replace(/\b(llamada|l[ií]nea|conversaci[oó]n)\s+(?:est[aá]\s+siendo\s+)?grabad[oa]\b/gi, '$1 transcrita')
      .replace(/\bse\s+(?:est[aá]n\s+grabando|graban)\b/gi, 'se transcriben')
      .replace(/\bse\s+(?:est[aá]\s+grabando|graba)\b/gi, 'se transcribe')
      .replace(/\bestamos\s+grabando\s+((?:esta|la|su|las|tus)?\s*(?:llamadas?|l[ií]neas?|conversaciones?))\b/gi, 'estamos transcribiendo $1')
      .replace(/\bgrabamos\s+((?:esta|la|su|las|tus)?\s*(?:llamadas?|l[ií]neas?|conversaciones?))\b/gi, 'transcribimos $1')
      .replace(/\bgrabaci[oó]n(?:\s+de\s+(?:audio|voz|llamadas?))?\b/gi, 'transcripción')
      .replace(/\bgrabar\b/gi, 'transcribir')
      .replace(/\bgrabando\b/gi, 'transcribiendo')
      .replace(/\bgrabad[oa]s\b/gi, 'transcritas')
      .replace(/\bgrabad[oa]\b/gi, 'transcrita')
      .replace(/\s*¿?(?:en qu[eé]|c[oó]mo) (?:te|le) (?:puedo ayudar|ayudo)(?: hoy)?\??\s*$/i, '')
      .trim()
    if (!/[.!?]$/.test(baseEs)) baseEs += '.'
    if (includeHint && !/\b(press|oprim[ae]|marqu[ae]|marca|presion[ae])\b[^.!?]{0,25}\b(nine|nueve|9)\b/i.test(baseEs)) {
      baseEs += switchEn
    }
    const hasVirtualAndTranscribe =
      /\b(inteligencia artificial|asistente virtual|asistente de ia)\b/i.test(baseEs) &&
      /\b(transcrit|transcrib)\w*/i.test(baseEs)
    if (!hasVirtualAndTranscribe) {
      baseEs += ' Hablas con nuestra asistente virtual en una llamada transcrita para atenderte.'
    }
    if (options?.omitTrailingQuestion) {
      return baseEs.trim()
    }
    if (options?.scheduleEval && !options.scheduleEval.isOpenNow && /\b(cerrad[oa]s?|ya cerramos|en este momento cerramos)\b/i.test(baseEs)) {
      return `${baseEs} ${getPostDisclosurePrompt('es', null)}`.trim()
    }
    return `${baseEs}${postPrompt}`.trim()
  }
  return `¡Gracias por llamar a Tacos Gavilan ${greetingTarget}!${switchEn} Hablas con nuestra asistente virtual en una llamada transcrita para atenderte.${postPrompt}`
}

const REGION_STORE_IDS: Record<string, number[]> = {
  'southeast la': [11, 12, 13, 14, 15, 16],
  'gateway cities': [11, 12, 13, 14, 15, 16],
  'este de los angeles': [11, 13],
  'sur de los angeles': [5, 6, 7],
  'centro de los angeles': [5, 6],
  'east la': [11, 13],
  'south la': [5, 6, 7],
  'downtown': [5, 6],
  'vernon': [5],
  'washington': [6],
  'slauson': [7],
  'broadway': [5, 7],
  'los angeles': [5, 6, 7, 8],
  'orange county': [9],
  'condado de orange': [9],
  'inland empire': [1],
  'san bernardino': [1],
  'san gabriel': [3, 4, 10],
  'sgv': [3, 4, 10]
}

const PHONE_AGENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_store_hours_and_status',
        description:
          'Respaldo: los DATOS EN VIVO de tu contexto ya incluyen estado abierto/cerrado, horario y dirección de esta sucursal. Úsala solo si falta algún dato festivo.',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'search_menu_item_price',
        description:
          'Respaldo: úsala SOLO si el platillo, bebida o postre NO aparece ya en CATÁLOGO EN VIVO ni en COINCIDENCIAS DEL MENÚ del prompt.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Nombre del platillo o bebida a buscar (ej. "torta cubana", "champurrado", "flan").'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_fiesta_platter_packages',
        description:
          'Respaldo: úsala SOLO si la cotización exacta para un evento de MÁS DE 40 invitados NO aparece ya calculada en CHAROLAS FIESTA PLATTER de tu contexto.',
        parameters: {
          type: 'OBJECT',
          properties: {
            guest_count: {
              type: 'INTEGER',
              description: 'Número estimado de invitados o personas para el evento (ej. 25, 40, 60, 100).'
            }
          },
          required: ['guest_count']
        }
      },
      {
        name: 'find_other_stores',
        description:
          'Respaldo: úsala ÚNICAMENTE si el usuario pregunta por otra sucursal, zona o comparativa y esa información NO aparece ya en tu contexto.',
        parameters: {
          type: 'OBJECT',
          properties: {
            search_city_or_filter: {
              type: 'STRING',
              description: 'Nombre de ciudad, zona o "drive_thru" para filtrar tiendas con Drive-Thru; omítelo o envía vacío para revisar las 15 sucursales.'
            }
          }
        }
      },
      {
        name: 'create_manager_callback',
        description:
          'Registra un Recado Prioritario para el Gerente o una Nota de Empaque (condimentos gratis) en la pantalla /order-ready-board de la sucursal (sin transferir llamadas a celulares personales). Soporta enrutamiento directo a otra sucursal mediante target_store_id cuando un pedido cayó en una tienda equivocada. Úsalo ÚNICAMENTE cuando ya tengas nombre y teléfono real de 10 dígitos (o en llamada Twilio pida usar su mismo número).',
        parameters: {
          type: 'OBJECT',
          properties: {
            caller_name: {
              type: 'STRING',
              description: 'Nombre real proporcionado por la persona que llama.'
            },
            caller_phone: {
              type: 'STRING',
              description: 'Teléfono real de 10 dígitos confirmado por la persona (NUNCA "No proporcionado" ni números 555). Si en llamada real pide marcar a este mismo número, envía "CALLER_ID".'
            },
            caller_type: {
              type: 'STRING',
              description: 'Tipo de persona: "customer", "employee", "vendor", "delivery_driver", o "corporate".'
            },
            urgency: {
              type: 'STRING',
              description: 'Nivel de urgencia: "high", "critical", o "normal" (usa SIEMPRE "normal" para reason_category "condiments_note").'
            },
            reason_category: {
              type: 'STRING',
              description:
                'Categoría: "condiments_note" (salsas/limones/cilantro/cebolla/cubiertos gratis en orden existente), "wrong_store_order" (pedido en sucursal equivocada), "delivery_issue" (retraso/no llega/problema en orden de Uber Eats, DoorDash o Grubhub), "missing_or_wrong_item", "lost_item", "employee_callout", "vendor_arrival", "billing_refund", o "other".'
            },
            reason_summary: {
              type: 'STRING',
              description: 'Resumen claro y completo del asunto (incluyendo condimentos solicitados, plataforma de delivery o sucursal donde cayó el pedido).'
            },
            ticket_or_order_number: {
              type: 'STRING',
              description:
                'Número de ticket u orden (obligatorio preguntarlo en órdenes equivocadas o incompletas de Drive-Thru, comedor o mostrador para revisar la preparación; si el cliente confirma que ya no tiene el ticket, envía "SIN TICKET").'
            },
            order_date: {
              type: 'STRING',
              description:
                'Fecha de compra del ticket indicada por el cliente en reclamos de órdenes equivocadas o incompletas (ej. "Hoy 2026-11-18", "Ayer", "Viernes 15 Nov").'
            },
            target_store_id: {
              type: 'INTEGER',
              description:
                'ID numérico de la sucursal destino (1, 3..16 según el DIRECTORIO OFICIAL) ÚNICAMENTE cuando el cliente indique que su orden cayó por error en OTRA sucursal distinta a la que está llamando. Omítelo si corresponde a esta misma sucursal.'
            }
          },
          required: ['caller_name', 'caller_phone', 'reason_category', 'reason_summary']
        }
      },
      {
        name: 'flag_unanswered_question',
        description:
          'Úsalo ÚNICAMENTE para dudas legítimas del negocio (políticas, facturación, eventos especiales) que no tengan respuesta en el contexto. NUNCA lo llames por chistes, música, deportes o preguntas fuera de tema ajenas a Tacos Gavilan.',
        parameters: {
          type: 'OBJECT',
          properties: {
            question_text: {
              type: 'STRING',
              description: 'La pregunta o duda exacta que no tenía respuesta oficial.'
            }
          },
          required: ['question_text']
        }
      }
    ]
  }
]

/**
 * Limpia muletillas iniciales redundantes ("¡Sí!", "¡Claro que sí!", "Hola."), corrige cualquier mención
 * accidental a "Tacos El Gavilan", y evita mutilar "la central" en español (reemplaza solo "LA " mayúscula).
 */
export function sanitizePhoneReplyText(rawText: string, lang: PhoneLang = 'es'): string {
  const formatDisplayUsd = (amtRaw: string): string => {
    const cleanNum = Number(String(amtRaw).replace(/,/g, ''))
    if (lang === 'en') return `$${amtRaw}`
    if (Number.isFinite(cleanNum) && cleanNum > 0 && cleanNum < 1) {
      return `$${amtRaw}`
    }
    return `$${amtRaw} ${cleanNum === 1 ? 'dólar' : 'dólares'}`
  }

  const preCleaned = sanitizeCustomerStoreReferencesInText(
    rawText
      .replace(/[*#_`~]/g, '')
      .replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan'),
    lang
  )
    // Moneda exclusiva EE. UU. (dólares y centavos USD — jamás pesos ni MXN)
    .replace(
      /\$\s*((?:\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.\d{1,2})?)\s*(?:pesos?(?:\s+mexicanos?)?|mxn)\b/gi,
      (_m, amt: string) => formatDisplayUsd(amt)
    )
    .replace(
      /\b(d[oó]lares?)\s+(?:con|y)\s+(\d{1,2})\s+pesos?\b/gi,
      (_m, dw: string, cStr: string) => `${dw} con ${Number(cStr)} ${Number(cStr) === 1 ? 'centavo' : 'centavos'}`
    )
    .replace(
      /(^|[^\w$])((?:\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.\d{1,2})?)\s*(?:pesos?(?:\s+mexicanos?)?|mxn)\b/gi,
      (_m, lead: string, amt: string) => `${lead}${formatDisplayUsd(amt)}`
    )
    .replace(/\b(un|uno)\s+peso(?:\s+mexicano)?\b/gi, lang === 'en' ? 'one dollar' : 'un dólar')
    .replace(
      /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|hundred)\s+pesos(?:\s+mexicanos)?\b/gi,
      (_m, word: string) => (lang === 'en' ? `${word} dollars` : `${word} dólares`)
    )
    .replace(
      /(?<!\bno\s+(?:est[aá]n|son|manejamos|aceptamos|cobramos)\s+)\ben\s+(?:pesos(?:\s+mexicanos?)?|mxn)\b/gi,
      lang === 'en' ? 'in US dollars' : 'en dólares'
    )
    .replace(
      /(?<!\b(?:not|aren't|are\s+not|don't|do\s+not)\s+(?:in\s+|priced\s+in\s+)?)\bin\s+(?:pesos(?:\s+mexicanos?)?|mxn)\b/gi,
      lang === 'en' ? 'in US dollars' : 'en dólares'
    )
    // Expectativa realista de devolución de llamada: jamás prometer "enseguida" / "de inmediato" / "right away"
    .replace(
      /\b(se\s+comunicar[aá](?:\s+contigo|\s+con\s+usted)?|comunicarse(?:\s+contigo|\s+con\s+usted)?|(?:te|le)\s+(?:llamar[aá]|marcar[aá]|contactar[aá])|(?:(?:te|le)\s+)?devolver(?:[aá]|te|le)\s+la\s+llamada)\s+(?:enseguida|en\s+seguida|de\s+inmediato|inmediatamente|ahorita(?:\s+mismo)?|lo\s+antes\s+posible|a\s+la\s+brevedad)\b/gi,
      '$1 en cuanto sea posible'
    )
    .replace(
      /\b((?:(?:will|can|to)\s+)?(?:call\s+you\s+back|give\s+you\s+a\s+call(?:\s+back)?|get\s+back\s+to\s+you|reach\s+out(?:\s+to\s+you)?|contact\s+you))\s+(?:right\s+away|immediately|(?:very\s+)?shortly)\b/gi,
      '$1 as soon as possible'
    )
    // Pedidos por teléfono y recados: jamás mencionar políticas, pólizas o reglamentos (pre-posicionada, post-posicionada o invertida)
    .replace(
      /\b(?:por|debido\s+a|siguiendo|seg[uú]n)\s+(?:nuestras?\s+|las?\s+|una\s+)?(?:pol[ií]ticas?|p[oó]lizas?|reglamentos?|normas?)(?:\s+(?:internas?|oficiales?|estrictas?))?(?:\s+de\s+(?:Tacos\s+Gavil[aá]n|la\s+(?:empresa|tienda|sucursal)|el\s+restaurante))?,?\s*(?:lamentablemente\s+)?(no\s+(?:tomamos|aceptamos|recibimos|se\s+toman|podemos\s+(?:tomar|aceptar|recibir))\s+(?:pedidos|[oó]rdenes))/gi,
      (_m, phrase: string, offset: number) => `${offset === 0 ? 'Disculpa' : 'disculpa'}, ${phrase.toLowerCase()}`
    )
    .replace(
      /\b(no\s+(?:tomamos|aceptamos|recibimos|se\s+toman|podemos\s+(?:tomar|aceptar|recibir))\s+(?:pedidos|[oó]rdenes)(?:\s+por\s+tel[eé]fono)?),?\s*(?:por|debido\s+a|siguiendo|seg[uú]n)\s+(?:nuestras?\s+|las?\s+|una\s+)?(?:pol[ií]ticas?|p[oó]lizas?|reglamentos?|normas?)(?:\s+(?:internas?|oficiales?|estrictas?))?(?:\s+de\s+(?:Tacos\s+Gavil[aá]n|la\s+(?:empresa|tienda|sucursal)|el\s+restaurante))?/gi,
      '$1'
    )
    .replace(
      /\b(?:es\s+(?:nuestra\s+)?|nuestras?\s+)(?:pol[ií]ticas?|p[oó]lizas?|reglamentos?)(?:\s+de\s+(?:Tacos\s+Gavil[aá]n|la\s+empresa))?\s+(?:es\s+no\s+(?:tomar|aceptar|recibir)|no\s+nos\s+permite\s+(?:tomar|aceptar|recibir))\s+(?:pedidos|[oó]rdenes)/gi,
      (_m, offset: number) => `${offset === 0 ? 'Disculpa' : 'disculpa'}, no tomamos órdenes`
    )
    .replace(
      /\b(?:por|debido\s+a|siguiendo|seg[uú]n)\s+(?:nuestras?\s+|las?\s+|una\s+)?(?:pol[ií]ticas?|p[oó]lizas?|reglamentos?|normas?)(?:\s+(?:internas?|oficiales?|estrictas?))?(?:\s+de\s+Tacos\s+Gavil[aá]n)?,?\s*(no\s+(?:transferimos|desviamos)\s+llamadas)/gi,
      (_m, phrase: string, offset: number) => (offset === 0 ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase.toLowerCase())
    )
    .replace(
      /\b(?:per|by|due\s+to)\s+(?:Tacos\s+Gavil[aá]n(?:'s)?\s+)?(?:our\s+|company\s+|store\s+|strict\s+)?(?:policy|policies|rules?|regulations?),?\s*(we\s+(?:do\s+not|don't|cannot|can't)\s+(?:take|accept|place)\s+(?:phone\s+)?orders)/gi,
      (_m, phrase: string, offset: number) => `${offset === 0 ? 'I apologize, ' : ''}${phrase.toLowerCase()}`
    )
    .replace(
      /\b(we\s+(?:do\s+not|don't|cannot|can't)\s+(?:take|accept|place)\s+(?:phone\s+)?orders(?:\s+(?:over|by)\s+the\s+phone)?),?\s*(?:per|by|due\s+to)\s+(?:Tacos\s+Gavil[aá]n(?:'s)?\s+)?(?:our\s+|company\s+|store\s+|strict\s+)?(?:policy|policies|rules?|regulations?)/gi,
      '$1'
    )
    .replace(
      /\b(?:it\s+is\s+(?:Tacos\s+Gavil[aá]n(?:'s)?|our)\s+|our\s+)(?:policy|policies|rules?)(?:\s+not\s+to|\s+does\s+not\s+allow\s+us\s+to)\s+(?:take|accept|place)\s+(?:phone\s+)?orders/gi,
      (_m, offset: number) => `${offset === 0 ? 'I apologize, we' : 'we'} do not take orders`
    )
    .replace(
      /\b(?:per|by|due\s+to)\s+(?:Tacos\s+Gavil[aá]n(?:'s)?\s+)?(?:our\s+|company\s+|store\s+|strict\s+)?(?:policy|policies|rules?|regulations?),?\s*(we\s+(?:do\s+not|don't)\s+transfer\s+calls)/gi,
      (_m, phrase: string, offset: number) => (offset === 0 ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase.toLowerCase())
    )
    .replace(/\s+/g, ' ')
    .trim()
  const base = expandStreetAbbreviationsInText(preCleaned, lang, { stripZipAfterState: false })
  let clean = base

  // REGLAS DE SEGURIDAD (auditoría 2026-11-09):
  // - Solo se elimina una muletilla si va INMEDIATAMENTE seguida de puntuación (",", "!", ".") y luego más texto.
  //   Esto evita mutilar "Surely" o "Hi there" (no llevan puntuación pegada). No se usa \b porque en JS no
  //   funciona después de letras acentuadas ("sí").
  // - "Si" SIN tilde es condicional ("Si la sucursal está cerrada...") y NUNCA se toca; solo se quita "Sí" CON tilde.
  // - Nunca se quita una muletilla seguida de negación ("Claro que no", "Por supuesto que no tomamos pedidos").

  // 1. Saludos repetidos a mitad de llamada ("¡Hola!", "Hola,", "Hello!", "Hi!")
  clean = clean.replace(/^¡?(hola|hello|hi)[,!.]+\s+(?=\S)/i, '')

  // 2. Muletillas de apertura ("¡Claro que sí!", "¡Con mucho gusto!", "¡Por supuesto!", "Of course!")
  for (let i = 0; i < 2; i++) {
    clean = clean.replace(
      /^¡?(claro que sí|claro que si|por supuesto|con mucho gusto|claro|entendido|of course|sure thing|sure|happy to help|certainly|absolutely)[,!.]+\s+(?=\S)/i,
      ''
    )
  }

  // 3. "¡Sí!" / "Sí," / "Yes," de apertura (solo con tilde y con puntuación obligatoria)
  clean = clean.replace(/^¡?sí[,!.]+\s+(?=\S)/i, '').replace(/^yes[,!.]+\s+(?=\S)/i, '')

  // 4. Si se quitó una muletilla con "¡" y quedó un "!" de cierre huérfano en la primera oración, cambiarlo por punto
  if (clean !== base && lang === 'es') {
    const firstBang = clean.indexOf('!')
    const firstStop = clean.search(/[.?]/)
    if (firstBang !== -1 && (firstStop === -1 || firstBang < firstStop) && !clean.slice(0, firstBang).includes('¡')) {
      clean = clean.slice(0, firstBang) + '.' + clean.slice(firstBang + 1)
    }
  }

  // 5. Capitalizar la primera letra tras la limpieza
  if (clean.length > 0 && clean !== base) {
    const firstAlphaIdx = clean.search(/[a-záéíóúñA-ZÁÉÍÓÚÑ]/)
    if (firstAlphaIdx === 0) {
      clean = clean.charAt(0).toUpperCase() + clean.slice(1)
    } else if (firstAlphaIdx === 1 && (clean.startsWith('¡') || clean.startsWith('¿'))) {
      clean = clean.charAt(0) + clean.charAt(1).toUpperCase() + clean.slice(2)
    }
  }

  return clean.trim() || base
}

/**
 * Recorta la respuesta hablada a un máximo seguro (≈2-3 oraciones) cortando SIEMPRE en fin de oración,
 * para que el audio telefónico (límite de 900 caracteres en `/api/phone/tts`) nunca quede a medias.
 */
export function clampPhoneReplyLength(text: string, maxChars = 480): string {
  const clean = text.trim()
  if (clean.length <= maxChars) return clean
  const windowWithNext = clean.slice(0, maxChars + 1)
  const lastStop = Math.max(windowWithNext.lastIndexOf('. '), windowWithNext.lastIndexOf('? '), windowWithNext.lastIndexOf('! '))
  if (lastStop >= 80 && lastStop < maxChars) return clean.slice(0, lastStop + 1).trim()
  const window = clean.slice(0, maxChars)
  const lastSpace = window.lastIndexOf(' ')
  return `${window.slice(0, lastSpace > 0 ? lastSpace : maxChars).trim().replace(/[,;:¿¡.!?\-]+$/, '')}.`
}

/**
 * Detecta el idioma REAL de un texto (preferentemente la respuesta generada por la IA, que es texto limpio).
 * Filtra primero sustantivos propios del menú mexicano ("Piña", "Jalapeño", "Gavilán") que también se usan
 * dentro de frases en inglés para evitar cambiar la voz a español por error cuando la respuesta está en inglés.
 */
const MENU_LOANWORDS_RE =
  /(?<![\p{L}\p{N}_])(los\s+[aá]ngeles|al\s+pastor|aguas?\s+frescas?|piña|pina|jalapeños?|jalapenos?|horchata|jamaica|tamarindo|champurrado|asada|pastor|carnitas|lengua|cabeza|buche|chorizo|mulitas?|quesadillas?|sopes?|tacos?|burritos?|tortas?|platos?|frijoles?|arroz|queso|cotija|guacamole|cilantro|cebolla|flan|milanesa|cubana|birria|menudo|pozole|suadero|tripa|lim[oó]n(?:es)?|chiles?|salsas?|caf[eé]s?|monterey\s+jack|gavil[aá]n)(?![\p{L}\p{N}_])/giu

const ES_STRONG_WORDS = new Set([
  'de', 'del', 'al', 'la', 'el', 'que', 'en', 'los', 'las', 'por', 'para', 'con', 'una', 'un', 'es', 'esta', 'estan', 'estamos', 'tenemos',
  'hoy', 'puedes', 'puede', 'pueden', 'nuestra', 'nuestro', 'sucursal', 'tu', 'te', 'si', 'cuanto', 'cuesta', 'cuestan', 'horario', 'abren', 'cierran',
  'quiero', 'tienen', 'hay', 'gracias', 'hola', 'gerente', 'orden', 'algo', 'mas', 'ayudar', 'pedido', 'ahorita', 'donde', 'cuando', 'quien', 'aceptan',
  'mi', 'muy', 'pero', 'como', 'ya', 'solo', 'todo', 'bueno', 'buenas', 'buenos', 'tardes', 'dias', 'noches', 'cual', 'lleva',
  'precio', 'precios', 'direccion', 'ubicacion', 'abierto', 'abierta', 'cerrado', 'cerrada', 'abrimos', 'cerramos', 'horas'
])
const EN_STRONG_WORDS = new Set([
  'the', 'and', 'you', 'your', 'we', 'our', 'is', 'are', 'to', 'of', 'for', 'at', 'with', 'can', 'do', 'have', 'today',
  'open', 'close', 'closing', 'closed', 'what', 'how', 'much', 'please', 'thank', 'thanks', 'hello', 'location', 'would', 'like',
  'help', 'there', 'does', 'accept', 'where', 'when', 'my', 'it', 'this', 'that', 'address', 'hours', 'price', 'many',
  'i', 'im', 'am', 'want', 'need', 'not', 'dont', 'cant', 'was', 'wrong', 'missing', 'time', 'place', 'call', 'back', 'store',
  'number', 'phone', 'food', 'good', 'all', 'set', 'order', 'manager', 'receipt', 'problem'
])

export function detectPhoneTextLanguage(text: string, fallback: PhoneLang): PhoneLang {
  const raw = String(text || '')
  if (!raw.trim()) return fallback
  const strippedMenuLoanwords = raw.replace(MENU_LOANWORDS_RE, ' ')
  const norm = normalizeSearchText(strippedMenuLoanwords)
  const words = norm.split(/\s+/).filter(Boolean)
  let es = /[¿¡]/.test(raw) || /[ñáéíóú]/i.test(strippedMenuLoanwords) ? 3 : 0
  let en = 0
  for (const w of words) {
    if (ES_STRONG_WORDS.has(w)) es++
    if (EN_STRONG_WORDS.has(w)) en++
  }
  if (es === en) return fallback
  if (Math.abs(es - en) < 2 && words.length > 3) return fallback
  return es > en ? 'es' : 'en'
}

/**
 * Detecta cambios de idioma en la entrada cruda/STT del usuario exigiendo evidencia sólida para evitar
 * falsos cambios ante frases cortas mixtas ("tacos de pastor", "one café please", "mi order", "ok", "drive thru").
 */
export function detectCallerLanguageSwitch(userText: string, currentLang: PhoneLang): PhoneLang {
  const raw = String(userText || '').trim()
  if (!raw) return currentLang
  const normRaw = normalizeSearchText(raw)
  if (/^english$/i.test(normRaw) || /\b(speak english|in english|english please|switch to english|hablas? ingles|ingles por favor|prefiero ingles)\b/i.test(normRaw)) return 'en'
  if (/^(?:spanish|espanol)$/i.test(normRaw) || /\b(hablas? espanol|en espanol|espanol por favor|spanish please|switch to spanish|prefiero espanol)\b/i.test(normRaw)) return 'es'

  const stripped = raw
    .replace(MENU_LOANWORDS_RE, ' ')
    .replace(/\b(ok|okay|bye|super|regular|combo|drive|thru|manager|ticket|order|ebt|calfresh|hi)\b/gi, ' ')
  const norm = normalizeSearchText(stripped)
  const words = norm.split(/\s+/).filter(Boolean)
  let es = /[¿¡]/.test(raw) || /[ñáéíóú]/i.test(stripped) ? 2 : 0
  let en = 0
  for (const w of words) {
    if (ES_STRONG_WORDS.has(w)) es++
    if (EN_STRONG_WORDS.has(w)) en++
  }
  const targetLang: PhoneLang = es > en ? 'es' : 'en'
  if (targetLang === currentLang) return currentLang
  const targetScore = targetLang === 'es' ? es : en
  const currentScore = currentLang === 'es' ? es : en
  if (targetScore >= 2 && targetScore - currentScore >= 2) {
    return targetLang
  }
  return currentLang
}

interface SingleGeminiAttemptOutcome {
  ok: boolean
  data?: any
  usedModel?: string
  status?: number
  errorMessage?: string
  deterministicBadRequest?: boolean
}

async function executeSingleGeminiAttempt(params: {
  model: string
  apiKey: string
  body: any
  preferredModel?: string | null
  timeoutMs: number
  abortController?: AbortController
}): Promise<SingleGeminiAttemptOutcome> {
  const { model, apiKey, body, preferredModel, timeoutMs, abortController } = params
  const pairKey = `${apiKey}:${model}`
  const supportsMinimalThinking = !model.includes('3.8')
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`

  const genCfg: Record<string, any> = {
    maxOutputTokens: 1024,
    ...(body.generationConfig || {})
  }
  if (supportsMinimalThinking) {
    genCfg.thinkingConfig = { thinkingLevel: 'minimal' }
  }
  const patchedContents =
    preferredModel && model !== preferredModel && Array.isArray(body.contents)
      ? body.contents.map((turn: any) =>
          Array.isArray(turn?.parts)
            ? {
                ...turn,
                parts: turn.parts.map((p: any) =>
                  p?.functionCall
                    ? { ...p, thoughtSignature: 'skip_thought_signature_validator' }
                    : p
                )
              }
            : turn
        )
      : body.contents

  try {
    const timeoutSignal = AbortSignal.timeout(Math.max(400, timeoutMs))
    const signal = abortController ? AbortSignal.any([abortController.signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        ...body,
        contents: patchedContents,
        generationConfig: genCfg
      })
    })
    const data = await res.json().catch(() => ({}))
    const candidate = data?.candidates?.[0]
    const parts: any[] = candidate?.content?.parts || []
    const hasFunctionCall = parts.some((p) => p?.functionCall)
    const visibleText = parts
      .filter((p) => !p?.thought)
      .map((p) => p?.text || '')
      .join('')
      .trim()

    if (res.ok && parts.length > 0) {
      if (
        hasFunctionCall ||
        (visibleText.length > 0 && (candidate?.finishReason !== 'MAX_TOKENS' || visibleText.length >= 40))
      ) {
        return { ok: true, data, usedModel: model }
      }
      return { ok: false, status: 200, errorMessage: `Respuesta truncada (MAX_TOKENS) en ${model}` }
    }

    const msg = data?.error?.message || `HTTP ${res.status}${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}`
    if (res.status === 404) {
      modelUnavailableUntil.set(model, Date.now() + 60 * 60 * 1000)
    } else if (res.status === 401 || res.status === 402 || res.status === 403) {
      keyQuarantineUntil.set(apiKey, Date.now() + 6 * 60 * 60 * 1000)
    } else if (res.status === 400) {
      return { ok: false, status: 400, errorMessage: msg, deterministicBadRequest: true }
    } else if (res.status === 429) {
      keyModelCooldownUntil.set(pairKey, Date.now() + 5 * 60 * 1000)
    } else {
      keyModelCooldownUntil.set(pairKey, Date.now() + 30 * 1000)
    }
    return { ok: false, status: res.status, errorMessage: msg }
  } catch (e: any) {
    if (abortController?.signal.aborted) {
      return { ok: false, status: 0, errorMessage: 'Aborted after faster peer succeeded' }
    }
    keyModelCooldownUntil.set(pairKey, Date.now() + 30 * 1000)
    return { ok: false, status: 0, errorMessage: e?.message || 'Error de red' }
  }
}

async function callGeminiPhoneWithFailover(
  body: any,
  deadlineMs: number = Date.now() + 12000,
  preferredModel?: string | null
) {
  const rawPool = await getGeminiKeyPoolWithRemote()
  if (rawPool.length === 0) {
    throw new Error('No hay llaves GEMINI_API_KEY configuradas')
  }

  const now = Date.now()
  const activePool = rawPool.filter((k) => (keyQuarantineUntil.get(k) || 0) <= now)
  const bypassKeyQuarantine = activePool.length === 0
  const candidateKeys = bypassKeyQuarantine ? rawPool : activePool

  const startIdx = keyRoundRobin++ % candidateKeys.length
  const rotated = [...candidateKeys.slice(startIdx), ...candidateKeys.slice(0, startIdx)]
  const modernKeys = rotated.filter((k) => k.startsWith('AQ.'))
  const classicKeys = rotated.filter((k) => !k.startsWith('AQ.'))
  const orderedKeys = modernKeys.length >= 3 ? modernKeys : [...modernKeys, ...classicKeys]

  const baseModels = Array.from(new Set([...MODERN_CHAT_MODELS, ...CLASSIC_CHAT_MODELS]))
  const orderedModels = preferredModel && baseModels.includes(preferredModel)
    ? [preferredModel, ...baseModels.filter((m) => m !== preferredModel)]
    : baseModels
  let lastError = 'Servicio de IA temporalmente no disponible'
  let attempts = 0
  const MAX_ATTEMPTS = 14
  const attemptedPairs = new Set<string>()

  // Solicitud Especulativa Escalonada 3-Vías (0 ms / 600 ms / 1250 ms con timeout 3800 ms):
  // Evita abortar prematuramente una respuesta válida de 2.5s mientras garantiza que si un shard de Google se congela,
  // una segunda y tercera llave/modelo corran en paralelo y el primero en responder gane al instante.
  const hedgeBudgetRemaining = deadlineMs - Date.now()
  if (hedgeBudgetRemaining >= 2000) {
    const usedKeysInRace = new Set<string>()
    const pickCandidate = (preferDifferentModelFrom?: string): { model: string; key: string } | null => {
      const modelOrder = preferDifferentModelFrom
        ? [...orderedModels.filter((m) => m !== preferDifferentModelFrom), ...orderedModels.filter((m) => m === preferDifferentModelFrom)]
        : orderedModels
      for (const m of modelOrder) {
        if ((modelUnavailableUntil.get(m) || 0) > now) continue
        for (const k of orderedKeys) {
          if (usedKeysInRace.has(k)) continue
          if ((keyModelCooldownUntil.get(`${k}:${m}`) || 0) > now) continue
          const mList = k.startsWith('AQ.') ? MODERN_CHAT_MODELS : CLASSIC_CHAT_MODELS
          if (!mList.includes(m)) continue
          usedKeysInRace.add(k)
          return { model: m, key: k }
        }
      }
      return null
    }
    const cand1 = pickCandidate()
    const cand2 = cand1 ? pickCandidate(cand1.model) : null
    const cand3 = cand1 ? pickCandidate() : null

    if (cand1) {
      const slotCands: Array<{ model: string; key: string } | null> = [cand1, cand2, cand3]
      const ctrls = [new AbortController(), new AbortController(), new AbortController()]
      const slotTimers: Array<ReturnType<typeof setTimeout> | null> = [null, null, null]
      const hedgeOutcome = await new Promise<SingleGeminiAttemptOutcome | null>((resolve) => {
        let settled = false
        let inFlightCount = 0
        let lastFailOutcome: SingleGeminiAttemptOutcome | null = null
        const launchedSlots = new Set<number>()
        const skippedSlots = new Set<number>()

        const clearSlotTimer = (idx: number) => {
          const t = slotTimers[idx]
          if (t !== null) {
            clearTimeout(t)
            slotTimers[idx] = null
          }
        }
        const clearAll = () => {
          for (let i = 0; i < slotTimers.length; i++) clearSlotTimer(i)
          for (const c of ctrls) c.abort()
        }
        const checkDone = () => {
          if (settled) return
          const hasPendingScheduled = [0, 1, 2].some(
            (i) => Boolean(slotCands[i]) && !launchedSlots.has(i) && !skippedSlots.has(i)
          )
          if (inFlightCount === 0 && !hasPendingScheduled) {
            settled = true
            clearAll()
            resolve(lastFailOutcome)
          }
        }

        const launchSlot = (slotIdx: number) => {
          if (settled || launchedSlots.has(slotIdx) || skippedSlots.has(slotIdx)) return
          clearSlotTimer(slotIdx)
          const cand = slotCands[slotIdx]
          if (!cand) {
            skippedSlots.add(slotIdx)
            checkDone()
            return
          }
          const rem = deadlineMs - Date.now()
          if (rem < 900) {
            // Si el presupuesto ya bajó de 900 ms, cancelar este slot y los posteriores pendientes sin esperar timers condenados
            for (let i = slotIdx; i < 3; i++) {
              if (!launchedSlots.has(i)) {
                skippedSlots.add(i)
                clearSlotTimer(i)
              }
            }
            checkDone()
            return
          }
          launchedSlots.add(slotIdx)
          inFlightCount++
          attempts++
          attemptedPairs.add(`${cand.key}:${cand.model}`)
          void executeSingleGeminiAttempt({
            model: cand.model,
            apiKey: cand.key,
            body,
            preferredModel,
            timeoutMs: Math.min(3800, Math.max(950, rem - 200)),
            abortController: ctrls[slotIdx]
          })
            .catch((err: any): SingleGeminiAttemptOutcome => ({
              ok: false,
              status: 0,
              errorMessage: err?.message || 'Error de red'
            }))
            .then((outcome) => {
              inFlightCount = Math.max(0, inFlightCount - 1)
              if (settled) return
              if (outcome?.ok || outcome?.deterministicBadRequest) {
                settled = true
                clearAll()
                resolve(outcome)
                return
              }
              lastFailOutcome = outcome
              // Si el slot actual falló rápido (ej. 429 en 200 ms), adelantar el siguiente respaldo no lanzado y cancelar su timer
              const nextUnlaunched = [0, 1, 2].find(
                (i) => i > slotIdx && Boolean(slotCands[i]) && !launchedSlots.has(i) && !skippedSlots.has(i)
              )
              if (nextUnlaunched !== undefined) {
                launchSlot(nextUnlaunched)
              }
              checkDone()
            })
        }

        if (cand2) slotTimers[1] = setTimeout(() => launchSlot(1), 600)
        if (cand3) slotTimers[2] = setTimeout(() => launchSlot(2), 1250)
        launchSlot(0)
      })

      if (hedgeOutcome?.ok) {
        return { data: hedgeOutcome.data, usedModel: hedgeOutcome.usedModel }
      }
      if (hedgeOutcome?.deterministicBadRequest) {
        throw new Error(`Petición inválida a Gemini: ${hedgeOutcome.errorMessage}`)
      }
      if (hedgeOutcome?.errorMessage) {
        lastError = hedgeOutcome.errorMessage
      }
    }
  }

  for (const pass of ['fresh', 'cooldown_fallback'] as const) {
    if (pass === 'cooldown_fallback' && deadlineMs - Date.now() < 1200) break
    const passKeys = pass === 'cooldown_fallback' && modernKeys.length >= 3 ? [...modernKeys, ...classicKeys] : orderedKeys
    for (const model of orderedModels) {
      if (pass === 'fresh' && (modelUnavailableUntil.get(model) || 0) > Date.now()) continue
      let attemptsOnModel = 0
      let overloadsOnModel = 0
      const maxAttemptsOnThisModel = 2

      for (const key of passKeys) {
        if (attemptsOnModel >= maxAttemptsOnThisModel) break
        if (!bypassKeyQuarantine && (keyQuarantineUntil.get(key) || 0) > Date.now()) continue
        const pairKey = `${key}:${model}`
        if (pass === 'fresh' && (attemptedPairs.has(pairKey) || (keyModelCooldownUntil.get(pairKey) || 0) > Date.now())) continue
        const modelsForKey = key.startsWith('AQ.') ? MODERN_CHAT_MODELS : CLASSIC_CHAT_MODELS
        if (!modelsForKey.includes(model)) continue

        const remaining = deadlineMs - Date.now()
        if (remaining < 900 || attempts >= MAX_ATTEMPTS) {
          throw new Error(`${lastError} (presupuesto de tiempo agotado tras ${attempts} intentos)`)
        }
        attempts++
        attemptsOnModel++
        attemptedPairs.add(pairKey)

        const attemptLimitMs = pass === 'fresh' ? 2300 : 3000
        const outcome = await executeSingleGeminiAttempt({
          model,
          apiKey: key,
          body,
          preferredModel,
          timeoutMs: Math.min(attemptLimitMs, remaining - 250)
        })

        if (outcome.ok) {
          return { data: outcome.data, usedModel: outcome.usedModel }
        }
        if (outcome.deterministicBadRequest) {
          throw new Error(`Petición inválida a Gemini: ${outcome.errorMessage}`)
        }
        lastError = outcome.errorMessage || lastError
        if (outcome.status === 404) {
          break
        }
        if (outcome.status === 401 || outcome.status === 402 || outcome.status === 403) {
          attemptsOnModel = Math.max(0, attemptsOnModel - 1)
          continue
        }
        if (outcome.status === 429) {
          continue
        }
        overloadsOnModel++
        if (overloadsOnModel >= (pass === 'fresh' ? 1 : 2)) {
          modelUnavailableUntil.set(model, Date.now() + 30 * 1000)
          break
        }
      }
    }
  }

  throw new Error(lastError)
}

/**
 * Detecta si la respuesta generada prometió/confirmó enviar una alerta o recado al gerente sin haber invocado
 * `create_manager_callback`, y extrae datos de contacto reales dichos por quien llama para garantizar persistencia.
 */
const SPOKEN_DIGIT_WORDS: Record<string, string> = {
  cero: '0', zero: '0', oh: '0',
  uno: '1', una: '1', one: '1',
  dos: '2', two: '2',
  tres: '3', three: '3',
  cuatro: '4', four: '4',
  cinco: '5', five: '5',
  seis: '6', six: '6',
  siete: '7', seven: '7',
  ocho: '8', eight: '8',
  nueve: '9', nine: '9'
}

function replaceSpokenDigitRuns(raw: string): string {
  const w = '(?:cero|zero|oh|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine)'
  const re = new RegExp(`\\b${w}(?:[\\s,.-]+${w}){2,10}\\b`, 'gi')
  return raw.replace(re, (seq) =>
    seq
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)
      .map((tok) => SPOKEN_DIGIT_WORDS[tok] ?? '')
      .join('')
  )
}

function hasExplicitSameLineOptIn(text: string): boolean {
  const norm = normalizeSearchText(text)
  if (/\b(no (?:es |a |marques a |llames a )?(?:este|el) mismo numero|not this number|don\s*t call this number|do not call this number)\b/i.test(norm)) {
    return false
  }
  return /\b(este mismo numero|el mismo numero|al mismo numero|a este numero|de este numero|a este telefono|al mismo telefono|mismo telefono|de donde llamo|de donde estoy llamando|del que te marco|del que llamo|this same number|the same number|this phone|same phone|call me back on this number|use this number|number i\s*(?:am|m) calling from|caller id)\b/i.test(
    norm
  )
}

export function inspectMissingCallbackGuard(params: {
  replyText: string
  transcript: TranscriptEntry[]
  blockedStoreTenDigits: string[]
  source: 'twilio' | 'simulator'
  callerNumber?: string | null
  allowDev555: boolean
}): {
  claimedSent: boolean
  callerPhone: string | null
  callerName: string
  ticketNumber?: string | null
  orderDate?: string | null
  summary: string
} {
  const normReply = normalizeSearchText(params.replyText)
  // Evaluar negación de envío acotada al objeto de alerta/recado (para no confundir "no podemos enviar reembolso, pero ya envié tu alerta")
  const hasNegatedSend =
    /\b(no|nunca|jamas|tampoco|sin|imposible|not|never|don\s*t|do not|cannot|can\s*t)\s+(?:te\s+|le\s+|se\s+|puedo\s+|podemos\s+)?(?:envio|envie|enviar|enviamos|mando|mande|mandar|deje|dejar|registre|registrar|notifico|notificar|send|sending|sent|leave|log|logging|register|submit)(?:\s+\w+){0,5}\s+(?:alerta|recado|reporte|aviso|notificacion|nota|gerente|manager|callback|alert|message|packing\s+note)\b/i.test(
      normReply
    )
  const sentencesWithQ = String(params.replyText || '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /\?/.test(s))
  const normQuestionClauses = normalizeSearchText(sentencesWithQ.join(' '))
  const isAskingDetails =
    /\b(necesito|dame|regala(?:s|me|nos)?|comparte(?:s|me|nos)?|proporciona(?:s|me|nos)?|cual es|como te llamas|indica(?:s|me|nos)?|me das|me puedes dar|me podrias|would you like me to|quieres que|deseas que|gustaria que|si gustas|si deseas|can i send|could you (?:give|share|provide|tell)|please (?:give|share|provide|tell)|si me das|if you share|if you give|if you\s*(?:d|would) like)\b/i.test(
      normReply
    ) ||
    (Boolean(normQuestionClauses) &&
      /\b(dime|me dices|tu nombre|tu numero|su nombre|su numero|a que numero|a que telefono|un numero|un telefono|your name|your phone|your number|callback number|best number|who i am speaking|10 digitos|diez digitos|10 digits|ten digits|10[\s-]*digit)\b/i.test(
        normQuestionClauses
      ))
  const claimedSent =
    !hasNegatedSend &&
    !isAskingDetails &&
    (/\b(en este momento envio|estoy enviando|acabo de enviar|ya envie|envie|he enviado|ya mande|estoy mandando|le pase|ya le pase|ya registre|he registrado|registre|acabo de registrar|deje registrado|deje tu recado|ya notifique|estoy notificando|i just sent|i have sent|i\s*ve sent|i sent|i am sending|i\s*m sending|i logged|i have logged|i\s*ve logged|i registered|i just registered|i notified|submitting your)\b.{0,70}\b(alerta|recado|reporte|aviso|notificacion|nota|revision|empaque|mesa de empaque|condimentos|pantalla|gerente|manager|priority\s+alert|packing\s+note|callback)\b/i.test(
      normReply
    ) ||
      /\b(tu\s+(?:recado|alerta|reporte|nota)\s+ya\s+(?:esta|quedo)|quedo\s+registrad[oa]\s+(?:tu\s+|el\s+|la\s+)?(?:recado|alerta|reporte|nota)|ya\s+(?:recibio|tiene)\s+(?:la\s+|tu\s+)?(?:alerta|recado|reporte|nota)|(?:your\s+)?(?:message|alert|callback(?:\s+request)?|packing\s+note|note)\s+(?:is\s+already|has\s+been)\s+(?:on|saved|sent|submitted|logged))\b/i.test(
        normReply
      ))

  if (!claimedSent) {
    return { claimedSent: false, callerPhone: null, callerName: 'Cliente en línea', summary: '' }
  }

  const rawUserTexts = params.transcript
    .filter((t) => t.role === 'user')
    .map((t) => String(t.text || '').trim())
  const userTexts = rawUserTexts.map((t) => normalizePhoneSttTranscript(t))
  const combinedRawUser = rawUserTexts.join(' | ').trim()
  const combinedUser = userTexts.join(' | ').trim()
  const expandedUser = replaceSpokenDigitRuns(combinedUser)
  const blocked = new Set(params.blockedStoreTenDigits.filter(Boolean))

  // Limpiar números cortos etiquetados (ticket/orden/recibo/sucursal/fecha/cantidades) antes de buscar teléfonos
  // para evitar que "Ticket 408, 323-982-4512" fusione "408" con el código de área "323".
  const stripLabeledNonPhoneNumbers = (txt: string): string =>
    txt
      .replace(/\b(?:ticket|recibo|orden|order|receipt)(?:\s+(?:n[uú]mero|number|num|no\.?|es|fue|era|is|was|el|la|#)){0,3}\s*[:#\-]?\s*[A-Za-z0-9\-]*\d[A-Za-z0-9\-]{0,6}\b/gi, ' ')
      .replace(/\b(?:sucursal|tienda|store)\s*#?\s*\d{1,2}\b/gi, ' ')
      .replace(/\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+\d{4})?\b/gi, ' ')
      .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ')
      .replace(/\b\d{1,3}\s+(?:tacos?|burritos?|mulitas?|quesadillas?|tortas?|sopes?|platos?|personas?|invitados?|people|guests?|minutos?|minutes?|horas?|hours?)\b/gi, ' ')

  const phoneSearchText = stripLabeledNonPhoneNumbers(expandedUser)
  let detectedPhone: string | null = null
  const tryPickPhone = (candidates: string[]): string | null => {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const parsed = normalizeUsPhoneE164(candidates[i])
      if (
        parsed.valid &&
        parsed.normalized &&
        parsed.tenDigits &&
        !blocked.has(parsed.tenDigits) &&
        !isFictitiousNanpPhone(parsed.tenDigits, params.allowDev555)
      ) {
        return parsed.normalized
      }
    }
    return null
  }
  // 1) Priorizar teléfonos completos bien delimitados (evitando cortar IDs de 12+ dígitos o números internacionales +52)
  const strictPhoneCandidates =
    phoneSearchText.match(/(?<![+\d])(?:\+?1[\s,.\-]*)?\(?[2-9]\d{2}\)?[\s,.\-]*[2-9]\d{2}[\s,.\-]*\d{2}[\s,.\-]*\d{2}(?!\d)/g) || []
  detectedPhone = tryPickPhone(strictPhoneCandidates)
  if (!detectedPhone) {
    const flexibleCandidates =
      phoneSearchText.match(/(?<![+\d])(?:\+?1[\s,.\-]*)?(?:\d[\s,.\-]*){10,11}(?!\d)/g) || []
    detectedPhone = tryPickPhone(flexibleCandidates)
  }

  // Reconstrucción multi-turno: si el cliente pausó a la mitad al dictar su número (ej. "323 982" y luego "45 12"),
  // filtrar primero números de ticket/fecha/cantidad y priorizar pares 3+7 / 6+4 / 3+3+4 sobre 7+3.
  if (!detectedPhone && userTexts.length >= 2) {
    const recentSegments = userTexts
      .slice(-4)
      .map((turnText) => {
        const cleanedTurn = stripLabeledNonPhoneNumbers(replaceSpokenDigitRuns(turnText))
        const runs = cleanedTurn.match(/\d[\d\s,.\-()]*\d|\d+/g) || []
        const lastRunDigits = runs.length > 0 ? runs[runs.length - 1].replace(/\D/g, '') : ''
        return lastRunDigits
      })
      .filter((d) => d.length >= 1 && d.length <= 9)

    const stitchCandidates: string[] = []
    if (recentSegments.length >= 3) {
      const a = recentSegments[recentSegments.length - 3]
      const b = recentSegments[recentSegments.length - 2]
      const c = recentSegments[recentSegments.length - 1]
      if (a.length === 3 && b.length === 3 && c.length === 4) stitchCandidates.push(a + b + c)
      if (a.length === 3 && b.length === 7) stitchCandidates.push(a + b)
      if (a.length >= 3 && (a + b + c).length === 10) stitchCandidates.push(a + b + c)
      if (a.length >= 3 && (a + b).length === 10) stitchCandidates.push(a + b)
    }
    if (recentSegments.length >= 2) {
      const a = recentSegments[recentSegments.length - 2]
      const b = recentSegments[recentSegments.length - 1]
      if (a.length >= 3 && (a.length <= 6 || b.length >= 4)) {
        stitchCandidates.push(a + b)
      }
    }

    for (const stitched of stitchCandidates) {
      if (stitched.length !== 10 && !(stitched.length === 11 && stitched.startsWith('1'))) continue
      const parsed = normalizeUsPhoneE164(stitched)
      if (
        parsed.valid &&
        parsed.normalized &&
        parsed.tenDigits &&
        !blocked.has(parsed.tenDigits) &&
        !isFictitiousNanpPhone(parsed.tenDigits, params.allowDev555)
      ) {
        detectedPhone = parsed.normalized
        break
      }
    }
  }

  if (
    !detectedPhone &&
    params.source === 'twilio' &&
    params.callerNumber &&
    hasExplicitSameLineOptIn(combinedUser)
  ) {
    const parsedCaller = normalizeUsPhoneE164(params.callerNumber)
    if (
      parsedCaller.valid &&
      parsedCaller.normalized &&
      parsedCaller.tenDigits &&
      !blocked.has(parsedCaller.tenDigits) &&
      !isFictitiousNanpPhone(parsedCaller.tenDigits, false)
    ) {
      detectedPhone = parsedCaller.normalized
    }
  }

  let detectedName = 'Cliente en línea'
  const nonNameTokens =
    /^(un|una|el|la|cliente|empleado|empleada|repartidor|repartidora|encargado|proveedor|customer|caller|employee|driver|calling|having|missing|trying|ordering|speaking|working|running|waiting|looking|asking|going|here|late|sick|upset|mad|sorry|good|fine|at|on|in|not|very|really|just|still|about|regarding|ridiculous|frustrated|espanol|spanish|english|ingles|nuevo|nueva)$/i
  const nameRegex =
    /(?:^|[.,;|]\s*|\b)(?:hola\s+|hi\s+|hello\s+)?(?:soy|me llamo|mi nombre es|(?:le|te)\s+habla|(?:^|[.,;|]\s*)habla|this is|my name is|i am|i'm)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})/gi
  const allNameMatches = Array.from(combinedRawUser.matchAll(nameRegex))
  for (let i = allNameMatches.length - 1; i >= 0; i--) {
    const rawCand = allNameMatches[i]?.[1] || ''
    // CRÍTICO: trailing \b evita mutilar nombres que empiezan con Mi-/El-/La-/En-/And-/Y-/De-/Con- (Miguel, Elena, Laura, Andrea, etc.)
    const cleaned = rawCand
      .replace(/\b(?:de|del|en|por|para|con|y|mi|my|and|tel[eé]fono|phone|n[uú]mero|number|porque|because|que|un|una|el|la|empleado|empleada|cliente|manager|gerente|calling|missing|about|from)\b.*$/i, '')
      .trim()
    const firstWord = normalizeSearchText(cleaned.split(/\s+/)[0] || '')
    if (cleaned.length >= 2 && firstWord && !nonNameTokens.test(firstWord)) {
      detectedName = cleaned
      break
    }
  }

  const detectedPhoneTen = detectedPhone ? extractPhoneDigits(detectedPhone).slice(-10) : ''
  const assistantAskedTicketEarlier = params.transcript.some(
    (t) => t.role === 'assistant' && /\b(ticket|recibo|receipt)\b/i.test(String(t.text || ''))
  )
  const normCombined = normalizeSearchText(combinedUser)
  const statedNoTicket =
    /\b(?:no tengo|sin|perdi|se me perdio|tire|no me dieron|no me lo dieron|no conservo|no guarde|no traigo|no lo traigo)\s+(?:el\s+|mi\s+)?(?:ticket|recibo|comprobante)\b/i.test(normCombined) ||
    /\b(?:don\s*t|do not|didn\s*t|did not)\s+(?:have|get|keep)\s+(?:the\s+|my\s+|a\s+)?(?:ticket|receipt)\b/i.test(normCombined) ||
    /\b(?:lost|threw\s+away|threw\s+out)\s+(?:the\s+|my\s+)?(?:ticket|receipt)\b/i.test(normCombined) ||
    (assistantAskedTicketEarlier &&
      /\b(no lo tengo|ya lo tire|lo tire|lo perdi|se me perdio|no me lo dieron|no lo traigo|no me dieron|don\s*t have it|do not have it|threw it away|lost it)\b/i.test(normCombined))

  const explicitTicketMatches: string[] = []
  const tkRe =
    /\b(ticket|recibo|orden|order|receipt)(?:\s+(n[uú]mero|number|num|no\.?|es|fue|era|is|was|el|la|#)){0,3}\s*[:#\-]?\s*([A-Za-z0-9\-]*\d[A-Za-z0-9\-]{0,9})\b(?!\s+(?:de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|tacos?|burritos?|mulitas?|quesadillas?|tortas?|sopes?|platos?|personas?|invitados?|people|guests?|minutos?|minutes?|horas?|hours?))/gi
  for (const m of combinedUser.matchAll(tkRe)) {
    const leadWord = String(m[1] || '').toLowerCase()
    const cand = String(m[3] || '').trim()
    const candDigits = cand.replace(/\D/g, '')
    if (!candDigits) continue
    if (candDigits.length >= 10 || (detectedPhoneTen && detectedPhoneTen.includes(candDigits) && candDigits.length >= 7)) continue
    if (/^\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?$/.test(cand)) continue
    // Para "orden"/"order" exigir código explícito o >=2 dígitos para no confundir "mi orden fue el 4..."
    if ((leadWord === 'orden' || leadWord === 'order') && candDigits.length === 1 && !m[2]) continue
    explicitTicketMatches.push(cand)
  }
  const hashRe = /(?<!\b(?:sucursal|tienda|store)\s*)#\s*(\d{2,6})\b/gi
  for (const m of combinedUser.matchAll(hashRe)) {
    const cand = String(m[1] || '').trim()
    if (cand && !(detectedPhoneTen && detectedPhoneTen.includes(cand) && cand.length >= 7)) {
      explicitTicketMatches.push(cand)
    }
  }
  let detectedTicket: string | null =
    explicitTicketMatches.length > 0
      ? explicitTicketMatches[explicitTicketMatches.length - 1]
      : statedNoTicket
        ? 'SIN TICKET'
        : null

  const esMonths = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)'
  const enMonths = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)'
  const dateRe = new RegExp(
    `\\b((?:hoy|ayer)\\s+\\d{1,2}\\s+de\\s+${esMonths}(?:\\s+\\d{4})?|hoy|ahorita|acabo de salir|hace rato|hace un momento|hace media hora|hace una hora|hace \\d{1,2}\\s+(?:minutos?|horas?|d[ií]as?)|esta (?:mañana|tarde|noche)|anoche|ayer|antier|anteayer|la semana pasada|el fin de semana|today|right now|just now|earlier|this (?:morning|afternoon|evening)|tonight|last night|yesterday|last week|this weekend|\\d{1,2}\\s+(?:minutes?|hours?|days?)\\s+ago|an hour ago|half an hour ago|(?:el\\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\\s+\\d{1,2}\\s+de\\s+${esMonths})?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\\d{1,2}\\s+de\\s+${esMonths}(?:\\s+\\d{4})?|${enMonths}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}[\\/-]\\d{1,2}(?:[\\/-]\\d{2,4})?)\\b`,
    'gi'
  )
  let detectedOrderDate: string | null = null
  const dateMatches = Array.from(combinedUser.matchAll(dateRe)).filter((m) => {
    const val = String(m[1] || '').trim()
    const slashMatch = val.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/)
    if (slashMatch) {
      const mm = Number(slashMatch[1])
      const dd = Number(slashMatch[2])
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
      const after = combinedUser.slice((m.index || 0) + val.length, (m.index || 0) + val.length + 18)
      if (/^\s*(?:personas?|invitados?|people|guests?)/i.test(after)) return false
    }
    return true
  })
  if (dateMatches.length > 0) {
    detectedOrderDate = dateMatches[dateMatches.length - 1][1].trim()
  }

  return {
    claimedSent: true,
    callerPhone: detectedPhone,
    callerName: detectedName,
    ticketNumber: detectedTicket,
    orderDate: detectedOrderDate,
    summary: combinedUser.slice(0, 500)
  }
}

/**
 * Clasifica la intención y categoría de la llamada a partir del texto del usuario y herramientas usadas,
 * respetando estrictamente el orden de prioridad operativa para evitar colisiones entre escenarios.
 */
/**
 * Resuelve de forma conservadora si un texto de sucursal equivocada menciona inequívocamente
 * otra sucursal distinta de `currentStoreId` (evitando confusiones como "broadway" solo entre #5 y #7).
 */
function inferMentionedOtherStore(
  allActiveStores: any[],
  currentStoreId: number,
  rawText: string
): any | null {
  const rawNorm = normalizeSearchText(rawText)
  if (!rawNorm || !Array.isArray(allActiveStores) || allActiveStores.length === 0) return null
  // Retirar frases no-sucursal para evitar falsos enrutamientos (Taco Bell, Bell Gardens, Huntington Beach, Bodega Central, Azusa Ave en #3)
  let norm = rawNorm
    .replace(/\b(taco\s+bell|bell\s+gardens|huntington\s+beach|(?:oficina|bodega|linea|cocina)\s+central|central\s+telefonica|5182\s+malabar(?:\s+street|\s+st)?(?:\s+vernon)?)\b/gi, ' ')
  if (Number(currentStoreId) === 3) {
    norm = norm.replace(/\bazusa\s+(?:ave|avenue|avenida)\b/gi, ' ')
  }
  const uniqueStorePatterns: Array<{ storeId: number; re: RegExp }> = [
    { storeId: 1, re: /\brialto\b/i },
    { storeId: 3, re: /\b(west covina|covina)\b/i },
    { storeId: 4, re: /\bazusa\b/i },
    { storeId: 5, re: /\b(vernon|la broadway|4380)\b/i },
    { storeId: 6, re: /\b(central|washington|la central|1900)\b/i },
    { storeId: 7, re: /\b(slauson|5833)\b/i },
    { storeId: 8, re: /\bhollywood\b/i },
    { storeId: 9, re: /\bsanta ana\b/i },
    { storeId: 10, re: /\bla puente\b/i },
    { storeId: 11, re: /\bhuntington(?:\s+park)?\b/i },
    { storeId: 12, re: /\bnorwalk\b/i },
    { storeId: 13, re: /\bbell\b/i },
    { storeId: 14, re: /\blynwood\b/i },
    { storeId: 15, re: /\bsouth\s*gate\b/i },
    { storeId: 16, re: /\bdowney\b/i }
  ]
  const matchedIds = new Set<number>()
  for (const pat of uniqueStorePatterns) {
    if (pat.storeId !== Number(currentStoreId) && pat.re.test(norm)) {
      matchedIds.add(pat.storeId)
    }
  }
  if (matchedIds.size !== 1) return null
  const onlyId = Array.from(matchedIds)[0]
  return allActiveStores.find((s) => Number(s.id) === onlyId) || null
}

function inferCallMetadata(
  userText: string,
  toolsUsed: string[],
  callbackCreated: boolean
): {
  callerCategory: string
  primaryIntent: string
  resolvedByAi: boolean
  detectedLang: PhoneLang
} {
  const norm = normalizeSearchText(userText)
  const detectedLang: PhoneLang = detectPhoneTextLanguage(userText, 'es')

  if (/\b(google listing|seo|merchant cash|prestamo comercial|extended warranty|solar panels|paneles solares|business insurance)\b/i.test(norm)) {
    return { callerCategory: 'spam', primaryIntent: 'spam', resolvedByAi: true, detectedLang }
  }
  const hasExplicitWorkContext =
    /\b(soy empleado|soy empleada|trabajo ahi|trabajo en la sucursal|estacion de parrilla|mi turno|no puedo ir a trabajar|no voy a poder ir a trabajar|calling in sick|call in sick|call out|grill station|my shift|cant come in|won\s*t make.*shift)\b/i.test(norm)
  const hasCustomerFoodOrPickupContext =
    /\b(comi|tacos?|burritos?|mulitas?|comida|mi orden|mi pedido|recoger mi|pick\s*up my|my order|my food)\b/i.test(norm)
  if (
    hasExplicitWorkContext ||
    (/\b(llegar tarde|voy a llegar tarde|estoy enferm[oa]|no voy a poder ir|running late)\b/i.test(norm) && !hasCustomerFoodOrPickupContext)
  ) {
    return {
      callerCategory: 'employee',
      primaryIntent: 'employee_callout',
      resolvedByAi: false,
      detectedLang
    }
  }
  const mentionsDeliveryApp = /\b(uber(?:\s*eats)?|doordash|door dash|grubhub|postmates)\b/i.test(norm)
  const isDriverSelf =
    (/\b(soy repartidor|repartidor|(?:delivery|uber(?:\s*eats)?|doordash|door dash|grubhub|postmates)\s+driver|dasher|courier|picking up|pick up an? order for)\b/i.test(norm) ||
      (/\b(voy a recoger|vengo a recoger)\b/i.test(norm) && mentionsDeliveryApp)) &&
    !/\b(el repartidor (?:no|todavia|se|aun)|esperando repartidor|mi orden|mi pedido|mi comida|driver (?:never|hasn\s*t|didn\s*t|is late|still))\b/i.test(norm)

  // Condimentos gratis en una orden existente (incluyendo órdenes de apps) ANTES de delivery_issue, excluyendo quejas y preguntas de menú/charolas
  const isPreVisitMenuOrPlatterCondimentQ =
    /\b(charola|charolas|fiesta platter|party tray|llevan|traen|incluyen|do .* include|does .* come with)\b/i.test(norm)
  const hasCondimentAddVerb =
    /\b(agregar|anadir|poner(?:le)?|ponle|echale|incluir|mandar|regalar|pedir|quiero|necesito|add|include|extra|free condiments|sin costo|mas salsa|salsas gratis)\b/i.test(norm)
  const mentionsCondimentsRequest =
    !isPreVisitMenuOrPlatterCondimentQ &&
    hasCondimentAddVerb &&
    /\b(condimento|condimentos|cilantro|limon|limones|jalapeno|jalapenos|servilleta|servilletas|tenedor|tenedores|cuchara|cucharas|cubierto|cubiertos|salsa|salsas|limes|napkins|utensils|forks)\b/i.test(
      norm
    ) &&
    !/\b(falto|falta|faltaron|incomplet[oa]s?|equivocad[oa]s?|mal|no me pusieron|no venia|no traia|queja|reembolso|missing|wrong|refund|forgot my)\b/i.test(norm)
  if (mentionsCondimentsRequest) {
    return {
      callerCategory: 'customer',
      primaryIntent: 'condiments_note',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }

  // Sucursal equivocada: si fue por Uber/DoorDash/Grubhub es delivery_issue (Regla 6B); si fue directo/tacosgavilan.com es wrong_store_order
  if (
    /\b(sucursal equivocad|tienda equivocad|locacion equivocad|me equivoque de (?:sucursal|tienda|ubicacion)|pedi en (?:la )?otra (?:sucursal|tienda)|ordene en (?:la )?otra (?:sucursal|tienda)|mande la orden a otra|por error.{0,35}(?:sucursal|tienda|ubicacion)|wrong (?:store|location|branch)|ordered at the wrong|sent my order to the wrong)\b/i.test(
      norm
    )
  ) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: mentionsDeliveryApp ? 'delivery_issue' : 'wrong_store_order',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }

  // Cliente con problema en orden de Uber Eats / DoorDash / Grubhub / Postmates
  const isCustomerDeliveryProblem =
    /\b(mi orden|mi pedido|una orden|un pedido|agregar|anadir|modificar|cambiar|corregir|cancelar|no ha llegado|no llega|no me llega|tardando|retras|llego|falt|incomplet|equivocad|mal|reembolso|cobro|my order|an order|add|modify|change|edit|cancel|hasn\s*t arrived|has not arrived|not arrived|never arrived|didn\s*t arrive|delayed|missing|wrong|refund)\b/i.test(
      norm
    )
  if ((mentionsDeliveryApp && !isDriverSelf && isCustomerDeliveryProblem) || /\b(no ha llegado mi (?:orden|pedido)|mi orden no ha llegado|order has not arrived|never got my order)\b/i.test(norm)) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'delivery_issue',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }

  const isBareTimeToCloseAsk = /\bcuanto falta para (?:cerrar|que cierren|abrir|que abran)\b/i.test(norm)
  const isBareTicketQuestion = /\b(?:me dan|dan|entregan)\s+ticket\b/i.test(norm) && !/\b(mal|equivocad|falto|incomplet|reembolso|queja)\b/i.test(norm)
  if (
    !isBareTimeToCloseAsk &&
    !isBareTicketQuestion &&
    /\b(falto|faltaron|me falto|me falta|le falta|incompleta|incompleto|equivocada|equivocado|equivocaron|me dieron mal|salio mal|venia mal|vino mal|prepararon mal|orden mal|pedido mal|me cambiaron|queja|reembolso|me cobraron|cobro doble|cobraron de mas|intoxic|me enferme|food poisoning|wrong order|got my order wrong|messed up my order|order was wrong|order is wrong|missing|refund|overcharged|got sick|ticket\s*(?:numero|num|no|es|fue|#)?\s*\d|receipt\s*(?:number|num|no|is|#)?\s*\d)\b/i.test(
      norm
    )
  ) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'complaint_missing_item',
      resolvedByAi: false,
      detectedLang
    }
  }
  // Empleo ANTES que objetos perdidos ("bolsa de trabajo" no es una bolsa olvidada)
  if (/\b(bolsa de trabajo|empleo|contratando|vacantes|solicitud de empleo|aplicar para trabajar|busco trabajo|hiring|job application|apply for a job|looking for a job)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'job_inquiry', resolvedByAi: true, detectedLang }
  }
  if (
    /\b(olvide|deje mi|deje una|mi cartera|mi celular|mis llaves|mi bolsa|mi chamarra|left my|forgot my)\b/i.test(norm) ||
    (/\b(perdi|lost)\b/i.test(norm) && !/\b(me perdi|im lost|i\s+m lost|i am lost|buscando|where are you|donde estan)\b/i.test(norm))
  ) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'lost_and_found',
      resolvedByAi: false,
      detectedLang
    }
  }
  if (/\b(proveedor|tecnico|mantenimiento|bodega|plomero|refrigeracion|vendor|delivery truck|technician)\b/i.test(norm)) {
    return {
      callerCategory: 'vendor',
      primaryIntent: 'vendor_service',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (isDriverSelf) {
    return {
      callerCategory: 'delivery_driver',
      primaryIntent: 'delivery_driver',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(hacer una? (?:orden|pedido)|pedido por telefono|ordenar por telefono|quiero ordenar|quiero pedir|tomar (?:mi |una )?orden|place an order|order over the phone|take my order|i want to order|i\s*d like to order)\b/i.test(norm) && !/\b(charola|fiesta platter|party tray|trabajo|empleo)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'order_by_phone', resolvedByAi: true, detectedLang }
  }
  if (
    toolsUsed.includes('get_fiesta_platter_packages') ||
    /\b(charola|charolas|fiesta platter|party tray|catering|invitados|guests)\b/i.test(norm) ||
    /\b([1-9]\d{1,2})\s+(personas|people)\b/i.test(norm)
  ) {
    return { callerCategory: 'customer', primaryIntent: 'fiesta_platters', resolvedByAi: true, detectedLang }
  }
  if (/\b(ebt|calfresh|cal fresh|call fresh|car fresh|e b t|i b t|food stamps|estampillas|tarjeta|efectivo|apple pay|google pay|formas de pago|metodos de pago|cash|credit card|debit card|payment methods)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'payment_ebt', resolvedByAi: true, detectedLang }
  }
  if (
    toolsUsed.includes('search_menu_item_price') ||
    /\b(precio|cuanto cuesta|how much|cost|menu|taco|burrito|mulita|quesadilla|torta|plato|sope|nachos|horchata|jamaica|champurrado|aguas? frescas?|postres?|flan|cheesecake|pasteles?|churros?|menudo|birria|pozole|suadero|tripa|cerveza|queso|regular|super|carnes)\b/i.test(
      norm
    )
  ) {
    return { callerCategory: 'customer', primaryIntent: 'menu_prices', resolvedByAi: true, detectedLang }
  }
  if (/\b(drive thru|drive-thru|direccion|ubicacion|donde estan|calles|address|location)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'location_drivethru', resolvedByAi: true, detectedLang }
  }
  if (
    toolsUsed.includes('get_store_hours_and_status') ||
    /\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|thanksgiving|accion de gracias|navidad|nochebuena|christmas|ano nuevo|new year|viernes santo|good friday|black friday|festivo|festivos|holiday|holidays)\b/i.test(
      norm
    )
  ) {
    return { callerCategory: 'customer', primaryIntent: 'hours', resolvedByAi: true, detectedLang }
  }

  return {
    callerCategory: 'customer',
    primaryIntent: callbackCreated ? 'complaint_missing_item' : 'general',
    resolvedByAi: !callbackCreated,
    detectedLang
  }
}

/**
 * Procesa un turno de conversación telefónica (tanto para llamadas reales de Twilio como para el Simulador Web).
 * Consulta herramientas en tiempo real, actualiza la bitácora en `phone_calls` y devuelve el texto listo para hablar con voz `Kore`.
 */
const TOMBSTONE_TERMINAL_ENDED_STATUSES = new Set(['completed', 'canceled', 'cancelled', 'busy', 'failed', 'no-answer'])

export interface PhoneCallTombstoneInput {
  callSid: string
  terminalStatus: string
  authoritativeDuration: number | null
  callerNumber?: string | null
  toNumber?: string | null
  forwardedFrom?: string | null
  endedAt?: string
  sequenceNumber?: number | null
  eventTimestamp?: string | null
}

/**
 * Registra de forma atómica un cierre anticipado o repetido en `public.phone_call_status_tombstones`.
 * Garantiza bajo candado transaccional por `CallSid` (`pg_advisory_xact_lock`) que:
 * - Un evento sin `CallDuration` (`authoritativeDuration === null`) JAMÁS reemplace una `duration_seconds` válida con `NULL`.
 * - Se incremente `revision` monotónicamente y se respete `SequenceNumber` / `Timestamp` cuando estén presentes.
 */
export async function upsertPhoneCallStatusTombstone(
  input: PhoneCallTombstoneInput,
  opts?: { db?: any }
): Promise<any> {
  const db = opts?.db || supabaseAdmin
  const cleanSid = String(input.callSid || '').trim()
  if (!cleanSid) {
    throw new Error('callSid es obligatorio para registrar phone_call_status_tombstones')
  }
  const rawStatus = String(input.terminalStatus || 'completed').trim().toLowerCase() || 'completed'
  const cleanStatus = rawStatus === 'cancelled' ? 'canceled' : rawStatus
  const hasAuthDur =
    input.authoritativeDuration !== null &&
    input.authoritativeDuration !== undefined &&
    String(input.authoritativeDuration).trim() !== '' &&
    Number.isFinite(Number(input.authoritativeDuration)) &&
    Number(input.authoritativeDuration) >= 0
  const safeDuration = hasAuthDur
    ? Math.min(7200, Math.max(0, Math.round(Number(input.authoritativeDuration))))
    : null
  let endedIso = new Date().toISOString()
  if (input.endedAt && String(input.endedAt).trim() !== '') {
    const parsedEnd = new Date(String(input.endedAt).trim())
    if (!Number.isNaN(parsedEnd.getTime())) endedIso = parsedEnd.toISOString()
  }
  const cleanCaller = String(input.callerNumber || '').trim() || null
  const cleanTo = String(input.toNumber || '').trim() || null
  const cleanForwarded = String(input.forwardedFrom || '').trim() || null

  const hasSeq =
    input.sequenceNumber !== null &&
    input.sequenceNumber !== undefined &&
    String(input.sequenceNumber).trim() !== '' &&
    Number.isFinite(Number(input.sequenceNumber)) &&
    Number(input.sequenceNumber) >= 0
  const safeSequenceNumber = hasSeq ? Math.trunc(Number(input.sequenceNumber)) : null

  let safeEventTimestamp: string | null = null
  if (input.eventTimestamp && String(input.eventTimestamp).trim() !== '') {
    const parsedTs = new Date(String(input.eventTimestamp).trim())
    if (!Number.isNaN(parsedTs.getTime())) {
      safeEventTimestamp = parsedTs.toISOString()
    }
  }

  if (typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('upsert_phone_call_status_tombstone_atomic', {
      p_call_sid: cleanSid,
      p_terminal_status: cleanStatus,
      p_duration_seconds: safeDuration,
      p_caller_number: cleanCaller,
      p_to_number: cleanTo,
      p_forwarded_from: cleanForwarded,
      p_ended_at: endedIso,
      p_sequence_number: safeSequenceNumber,
      p_event_timestamp: safeEventTimestamp
    })
    if (error) throw error
    return data
  }

  // Fallback para clientes de prueba sin .rpc: preserva duration_seconds no nula previa y lleva revisión monotónica
  const { data: existingTomb, error: readErr } = await db
    .from('phone_call_status_tombstones')
    .select('*')
    .eq('call_sid', cleanSid)
    .maybeSingle()
  if (readErr) throw readErr

  const prevHasValidDur =
    existingTomb &&
    existingTomb.duration_seconds !== null &&
    existingTomb.duration_seconds !== undefined &&
    Number.isFinite(Number(existingTomb.duration_seconds)) &&
    Number(existingTomb.duration_seconds) >= 0

  const existingTombSeq =
    existingTomb?.sequence_number !== null && existingTomb?.sequence_number !== undefined
      ? Number(existingTomb.sequence_number)
      : null
  const existingTombTsMs =
    existingTomb?.event_timestamp && !Number.isNaN(new Date(existingTomb.event_timestamp).getTime())
      ? new Date(existingTomb.event_timestamp).getTime()
      : null
  const incomingTsMs =
    safeEventTimestamp && !Number.isNaN(new Date(safeEventTimestamp).getTime())
      ? new Date(safeEventTimestamp).getTime()
      : null
  const isStaleBySeq =
    prevHasValidDur &&
    ((existingTombSeq !== null && safeSequenceNumber !== null && safeSequenceNumber < existingTombSeq) ||
      ((existingTombSeq === null || safeSequenceNumber === null) &&
        existingTombTsMs !== null &&
        incomingTsMs !== null &&
        incomingTsMs < existingTombTsMs))

  const prevDurVal = prevHasValidDur ? Math.min(7200, Math.max(0, Math.round(Number(existingTomb.duration_seconds)))) : null
  const mergedDuration = isStaleBySeq
    ? prevDurVal
    : safeDuration !== null
      ? safeDuration === 0 && prevDurVal !== null && prevDurVal > 0
        ? prevDurVal
        : safeDuration
      : prevDurVal

  const mergedPayload: Record<string, any> = {
    call_sid: cleanSid,
    terminal_status: isStaleBySeq
      ? existingTomb.terminal_status || cleanStatus
      : safeDuration !== null
        ? cleanStatus
        : existingTomb?.terminal_status || cleanStatus,
    duration_seconds: mergedDuration,
    sequence_number:
      safeDuration === null || isStaleBySeq
        ? existingTomb?.sequence_number ?? null
        : safeSequenceNumber ?? existingTomb?.sequence_number ?? null,
    event_timestamp:
      safeDuration === null || isStaleBySeq
        ? existingTomb?.event_timestamp ?? null
        : safeEventTimestamp ?? existingTomb?.event_timestamp ?? null,
    caller_number: cleanCaller || existingTomb?.caller_number || null,
    to_number: cleanTo || existingTomb?.to_number || null,
    forwarded_from: cleanForwarded || existingTomb?.forwarded_from || null,
    ended_at:
      existingTomb?.ended_at &&
      !Number.isNaN(new Date(existingTomb.ended_at).getTime()) &&
      new Date(existingTomb.ended_at).getTime() <= new Date(endedIso).getTime()
        ? existingTomb.ended_at
        : endedIso,
    revision: Number(existingTomb?.revision || 0) + 1,
    updated_at: new Date().toISOString()
  }

  const { data: upserted, error: upErr } = await db
    .from('phone_call_status_tombstones')
    .upsert(mergedPayload, { onConflict: 'call_sid' })
    .select('*')
    .maybeSingle()
  if (upErr) throw upErr
  return upserted
}

/**
 * Reconcilia de forma transaccional, segura ante concurrencia e idempotente una llamada en `public.phone_calls`
 * contra un cierre pendiente en `public.phone_call_status_tombstones` (`reconcile_phone_call_with_tombstone_atomic`):
 * - Ejecuta lectura (`FOR UPDATE`), actualización de `phone_calls` y borrado condicional (`WHERE revision = v_tomb.revision`)
 *   en una sola transacción PostgreSQL bajo candado por `CallSid` (`pg_advisory_xact_lock`).
 * - Si llegan dos `StatusCallback` simultáneos con duraciones distintas, conserva siempre la duración final más reciente.
 * - Si `phone_calls` aún no existe, conserva el tombstone intacto y devuelve `null`.
 * - Si falla el `UPDATE` de `phone_calls`, conserva intacto el tombstone para reintentar y lanza el error.
 * - Jamás reemplaza una duración válida existente con `NULL` ni con `0`, y jamás reabre una llamada ya terminada.
 */
export async function reconcileCallWithTerminalTombstone(
  callSid: string,
  opts?: { db?: any; forceClientFallback?: boolean; _depth?: number }
): Promise<any | null> {
  const depth = opts?._depth ?? 0
  const db = opts?.db || supabaseAdmin
  const cleanSid = String(callSid || '').trim()
  if (!cleanSid) return null

  if (!opts?.forceClientFallback && typeof db.rpc === 'function') {
    const { data: rpcRows, error: rpcErr } = await db.rpc('reconcile_phone_call_with_tombstone_atomic', {
      p_call_sid: cleanSid
    })
    if (rpcErr) throw rpcErr
    if (Array.isArray(rpcRows)) {
      return rpcRows.length > 0 ? rpcRows[0] : null
    }
    return rpcRows || null
  }

  // Fallback para dobles de prueba sin .rpc (o con forceClientFallback explícito)
  const { data: tombstone, error: tombErr } = await db
    .from('phone_call_status_tombstones')
    .select('*')
    .eq('call_sid', cleanSid)
    .maybeSingle()

  if (tombErr) throw tombErr
  if (!tombstone) {
    const { data: existingClosed, error: closedErr } = await db
      .from('phone_calls')
      .select('*')
      .eq('call_sid', cleanSid)
      .maybeSingle()
    if (closedErr) throw closedErr
    if (
      existingClosed &&
      (Boolean(existingClosed.ended_at) ||
        TOMBSTONE_TERMINAL_ENDED_STATUSES.has(String(existingClosed.status || '').trim().toLowerCase()))
    ) {
      return existingClosed
    }
    return null
  }

  const { data: callRow, error: callErr } = await db
    .from('phone_calls')
    .select('*')
    .eq('call_sid', cleanSid)
    .maybeSingle()

  if (callErr) throw callErr
  if (!callRow) return null

  // En el fallback sin .rpc, revalidar que la revisión del tombstone no haya sido superada ni consumida antes de escribir
  if (tombstone.revision !== undefined && tombstone.revision !== null) {
    const { data: liveTomb, error: liveTombErr } = await db
      .from('phone_call_status_tombstones')
      .select('revision')
      .eq('call_sid', cleanSid)
      .maybeSingle()
    if (liveTombErr) throw liveTombErr
    if (!liveTomb || Number(liveTomb.revision) !== Number(tombstone.revision)) {
      if (depth >= 3) return callRow
      return await reconcileCallWithTerminalTombstone(cleanSid, { ...opts, _depth: depth + 1 })
    }
  }

  const currentStatusNorm = String(callRow.status || '').trim().toLowerCase()
  const isAlreadyTerminated =
    Boolean(callRow.ended_at) || TOMBSTONE_TERMINAL_ENDED_STATUSES.has(currentStatusNorm)

  const normTombStatus =
    String(tombstone.terminal_status || 'completed').trim().toLowerCase() === 'cancelled'
      ? 'canceled'
      : tombstone.terminal_status || 'completed'
  const preservedStatus =
    currentStatusNorm === 'callback_requested' || currentStatusNorm === 'transferred'
      ? callRow.status
      : isAlreadyTerminated && currentStatusNorm && currentStatusNorm !== 'in_progress'
        ? callRow.status
        : normTombStatus

  const hasAuthDur =
    tombstone.duration_seconds !== null &&
    tombstone.duration_seconds !== undefined &&
    String(tombstone.duration_seconds).trim() !== '' &&
    Number.isFinite(Number(tombstone.duration_seconds)) &&
    Number(tombstone.duration_seconds) >= 0

  const callSeq =
    callRow.last_status_sequence !== null && callRow.last_status_sequence !== undefined
      ? Number(callRow.last_status_sequence)
      : null
  const tombSeq =
    tombstone.sequence_number !== null && tombstone.sequence_number !== undefined
      ? Number(tombstone.sequence_number)
      : null
  const callTsMs =
    callRow.last_status_event_at && !Number.isNaN(new Date(callRow.last_status_event_at).getTime())
      ? new Date(callRow.last_status_event_at).getTime()
      : null
  const tombTsMs =
    tombstone.event_timestamp && !Number.isNaN(new Date(tombstone.event_timestamp).getTime())
      ? new Date(tombstone.event_timestamp).getTime()
      : null
  const isStaleDur =
    hasAuthDur &&
    ((callSeq !== null && tombSeq !== null && tombSeq < callSeq) ||
      ((callSeq === null || tombSeq === null) && callTsMs !== null && tombTsMs !== null && tombTsMs < callTsMs))

  const rawTombDur = hasAuthDur ? Math.min(7200, Math.max(0, Math.round(Number(tombstone.duration_seconds)))) : null
  const existingCallDur =
    callRow.duration_seconds !== null && callRow.duration_seconds !== undefined && Number.isFinite(Number(callRow.duration_seconds))
      ? Math.round(Number(callRow.duration_seconds))
      : null
  const authoritativeDurVal =
    rawTombDur !== null && !isStaleDur && !(rawTombDur === 0 && existingCallDur !== null && existingCallDur > 0)
      ? rawTombDur
      : null

  const finalEndedAt = callRow.ended_at || tombstone.ended_at || new Date().toISOString()

  const patch: Record<string, any> = {
    status: preservedStatus,
    ended_at: finalEndedAt
  }
  // CRÍTICO: solo escribir duration_seconds cuando existe CallDuration autoritativo; jamás pisar una duración válida con NULL ni 0
  if (authoritativeDurVal !== null) {
    patch.duration_seconds = authoritativeDurVal
    if (tombSeq !== null) patch.last_status_sequence = tombSeq
    if (tombstone.event_timestamp) patch.last_status_event_at = tombstone.event_timestamp
  }
  const preservedStatusNorm = String(preservedStatus || '').toLowerCase()
  if (
    Number(callRow.turns_count || 0) === 0 ||
    preservedStatusNorm === 'callback_requested' ||
    preservedStatusNorm === 'transferred' ||
    (TOMBSTONE_TERMINAL_ENDED_STATUSES.has(preservedStatusNorm) && preservedStatusNorm !== 'completed')
  ) {
    patch.resolved_by_ai = false
  }

  let updated: any = null

  if (currentStatusNorm === 'in_progress') {
    const { data: transitioned, error: transErr } = await db
      .from('phone_calls')
      .update(patch)
      .eq('id', callRow.id)
      .eq('status', 'in_progress')
      .select('*')
      .maybeSingle()

    if (transErr) {
      // Conservar tombstone para reintento
      throw transErr
    }
    updated = transitioned

    if (!updated) {
      // Otro flujo cambió status justo en paralelo (ej. a callback_requested, transferred o completed):
      // sellar ended_at y aplicar CallDuration autoritativo sin reabrir ni sobrescribir el status ganador.
      const { data: freshRow, error: freshErr } = await db
        .from('phone_calls')
        .select('*')
        .eq('id', callRow.id)
        .maybeSingle()
      if (freshErr || !freshRow) {
        throw freshErr || new Error(`No se encontró phone_calls id=${callRow.id} en reconciliación; tombstone conservado.`)
      }
      const freshSeq =
        freshRow.last_status_sequence !== null && freshRow.last_status_sequence !== undefined
          ? Number(freshRow.last_status_sequence)
          : null
      const freshTsMs =
        freshRow.last_status_event_at && !Number.isNaN(new Date(freshRow.last_status_event_at).getTime())
          ? new Date(freshRow.last_status_event_at).getTime()
          : null
      const freshDur =
        freshRow.duration_seconds !== null && freshRow.duration_seconds !== undefined && Number.isFinite(Number(freshRow.duration_seconds))
          ? Math.round(Number(freshRow.duration_seconds))
          : null
      const isStaleAgainstFresh =
        rawTombDur !== null &&
        ((freshSeq !== null && tombSeq !== null && tombSeq < freshSeq) ||
          ((freshSeq === null || tombSeq === null) && freshTsMs !== null && tombTsMs !== null && tombTsMs < freshTsMs))
      const freshAuthoritativeDur =
        rawTombDur !== null && !isStaleAgainstFresh && !(rawTombDur === 0 && freshDur !== null && freshDur > 0)
          ? rawTombDur
          : null
      const syncPatch: Record<string, any> = {
        ended_at: freshRow.ended_at || tombstone.ended_at || new Date().toISOString()
      }
      if (freshAuthoritativeDur !== null) {
        syncPatch.duration_seconds = freshAuthoritativeDur
        if (tombSeq !== null) syncPatch.last_status_sequence = tombSeq
        if (tombstone.event_timestamp) syncPatch.last_status_event_at = tombstone.event_timestamp
      }
      const freshNorm = String(freshRow.status || '').toLowerCase()
      if (
        Number(freshRow.turns_count || 0) === 0 ||
        freshNorm === 'callback_requested' ||
        freshNorm === 'transferred' ||
        (TOMBSTONE_TERMINAL_ENDED_STATUSES.has(freshNorm) && freshNorm !== 'completed')
      ) {
        syncPatch.resolved_by_ai = false
      }
      const { data: syncedRow, error: syncErr } = await db
        .from('phone_calls')
        .update(syncPatch)
        .eq('id', callRow.id)
        .select('*')
        .maybeSingle()
      if (syncErr || !syncedRow) {
        throw syncErr || new Error(`Fallo al sincronizar phone_calls id=${callRow.id}; tombstone conservado.`)
      }
      updated = syncedRow
    }
  } else {
    const { data: updRow, error: updErr } = await db
      .from('phone_calls')
      .update(patch)
      .eq('id', callRow.id)
      .select('*')
      .maybeSingle()

    if (updErr || !updRow) {
      // Conservar tombstone intacto para poder reintentar posteriormente
      throw updErr || new Error(`Fallo al actualizar phone_calls id=${callRow.id}; tombstone conservado.`)
    }
    updated = updRow
  }

  // Solo eliminar la revisión exacta del tombstone DESPUÉS de que el UPDATE en phone_calls se haya confirmado exitosamente
  let deleteQuery = db
    .from('phone_call_status_tombstones')
    .delete()
    .eq('call_sid', cleanSid)
  if (tombstone.revision !== undefined && tombstone.revision !== null) {
    deleteQuery = deleteQuery.eq('revision', tombstone.revision)
  }
  const { error: delErr } = await deleteQuery
  if (delErr) {
    throw delErr
  }

  // Si en el fallback sin .rpc entró una revisión más nueva mientras se escribía phone_calls, reconciliarla antes de retornar
  if (tombstone.revision !== undefined && tombstone.revision !== null) {
    const { data: newerTomb, error: newerErr } = await db
      .from('phone_call_status_tombstones')
      .select('revision')
      .eq('call_sid', cleanSid)
      .maybeSingle()
    if (newerErr) throw newerErr
    if (newerTomb && Number(newerTomb.revision) > Number(tombstone.revision)) {
      if (depth >= 3) return updated
      return await reconcileCallWithTerminalTombstone(cleanSid, { ...opts, _depth: depth + 1 })
    }
  }

  return updated
}

/**
 * Evalúa tombstones antiguos (>24h por defecto) sin borrar cierres pendientes:
 * - Solo elimina un tombstone si comprueba en `phone_calls` que su estado terminal, `ended_at` y `duration_seconds`
 *   (salvo evento más reciente por secuencia/timestamp) ya quedaron aplicados, borrando únicamente su `revision`.
 * - Si la fila de `phone_calls` existe pero el cierre aún no se aplicó, intenta reconciliarla transaccionalmente.
 * - Si `phone_calls` aún no existe o la base de datos falla, conserva intacto el tombstone para reintentos futuros.
 */
export async function cleanupOrReconcileExpiredTombstones(opts?: {
  olderThanIso?: string
  limit?: number
  supabaseClient?: any
  forceClientFallback?: boolean
}): Promise<{
  scanned: number
  deletedAlreadyApplied: number
  reconciledAndDeleted: number
  preservedPending: number
}> {
  const db = opts?.supabaseClient || supabaseAdmin
  const cutoffIso = opts?.olderThanIso || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const batchLimit = Math.min(500, Math.max(1, opts?.limit ?? 100))

  const { data: expiredTombstones, error: tombReadErr } = await db
    .from('phone_call_status_tombstones')
    .select(
      'call_sid, revision, terminal_status, duration_seconds, ended_at, sequence_number, event_timestamp, created_at, updated_at'
    )
    .lt('updated_at', cutoffIso)
    .order('updated_at', { ascending: false })
    .limit(batchLimit)

  if (tombReadErr) {
    throw tombReadErr
  }

  const rows = Array.isArray(expiredTombstones) ? expiredTombstones : []
  let deletedAlreadyApplied = 0
  let reconciledAndDeleted = 0
  let preservedPending = 0

  for (const t of rows) {
    const cleanSid = String(t?.call_sid || '').trim()
    if (!cleanSid) {
      preservedPending++
      continue
    }

    const { data: callRow, error: callErr } = await db
      .from('phone_calls')
      .select('id, call_sid, status, ended_at, duration_seconds, last_status_sequence, last_status_event_at')
      .eq('call_sid', cleanSid)
      .maybeSingle()

    if (callErr || !callRow) {
      preservedPending++
      continue
    }

    const normSt = (s: unknown) => {
      const v = String(s || '').trim().toLowerCase()
      return v === 'cancelled' ? 'canceled' : v
    }
    const statusNorm = normSt(callRow.status)
    const tombStatusNorm = normSt(t.terminal_status) || 'completed'
    const hasEndedAt = Boolean(callRow.ended_at)
    const statusMatchesApplied =
      statusNorm === tombStatusNorm ||
      statusNorm === 'callback_requested' ||
      statusNorm === 'transferred' ||
      (TOMBSTONE_TERMINAL_ENDED_STATUSES.has(statusNorm) && hasEndedAt)

    const tombHasDur =
      t.duration_seconds !== null &&
      t.duration_seconds !== undefined &&
      String(t.duration_seconds).trim() !== '' &&
      Number.isFinite(Number(t.duration_seconds)) &&
      Number(t.duration_seconds) >= 0
    const expectedDur = tombHasDur ? Math.min(7200, Math.max(0, Math.round(Number(t.duration_seconds)))) : null

    const callHasDur =
      callRow.duration_seconds !== null &&
      callRow.duration_seconds !== undefined &&
      String(callRow.duration_seconds).trim() !== '' &&
      Number.isFinite(Number(callRow.duration_seconds)) &&
      Number(callRow.duration_seconds) >= 0

    const tombEventMs = t.event_timestamp ? new Date(t.event_timestamp).getTime() : NaN
    const callEventMs = callRow.last_status_event_at ? new Date(callRow.last_status_event_at).getTime() : NaN
    const tombIsOlderBySeqOrTs =
      (callRow.last_status_sequence !== null &&
        callRow.last_status_sequence !== undefined &&
        t.sequence_number !== null &&
        t.sequence_number !== undefined &&
        Number(t.sequence_number) < Number(callRow.last_status_sequence)) ||
      ((callRow.last_status_sequence === null ||
        callRow.last_status_sequence === undefined ||
        t.sequence_number === null ||
        t.sequence_number === undefined) &&
        Number.isFinite(tombEventMs) &&
        Number.isFinite(callEventMs) &&
        tombEventMs < callEventMs)

    const callDurRounded = callHasDur ? Math.round(Number(callRow.duration_seconds)) : null
    const durAlreadyApplied =
      !tombHasDur ||
      (callDurRounded !== null &&
        (callDurRounded === expectedDur || (expectedDur === 0 && callDurRounded > 0) || tombIsOlderBySeqOrTs))

    if (hasEndedAt && statusMatchesApplied && durAlreadyApplied) {
      let delQ = db.from('phone_call_status_tombstones').delete().eq('call_sid', cleanSid)
      if (t.revision !== undefined && t.revision !== null) {
        delQ = delQ.eq('revision', t.revision)
      }
      const { data: deletedRows, error: delErr } = await delQ.select('call_sid')
      if (delErr || (Array.isArray(deletedRows) && deletedRows.length === 0)) {
        preservedPending++
      } else {
        deletedAlreadyApplied++
      }
      continue
    }

    try {
      const rec = await reconcileCallWithTerminalTombstone(cleanSid, {
        db,
        forceClientFallback: opts?.forceClientFallback
      })
      if (rec && rec.ended_at) {
        reconciledAndDeleted++
      } else {
        preservedPending++
      }
    } catch {
      preservedPending++
    }
  }

  return {
    scanned: rows.length,
    deletedAlreadyApplied,
    reconciledAndDeleted,
    preservedPending
  }
}

export const CRITICAL_CALLBACKS_PAGE_SIZE = 250
export const CRITICAL_CALLBACKS_MAX_PAGES = 40
export const CRITICAL_CALLBACKS_MAX_ROWS = CRITICAL_CALLBACKS_PAGE_SIZE * CRITICAL_CALLBACKS_MAX_PAGES

const CURSOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CURSOR_ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

function formatPgKeysetTimestamp(raw: unknown): string {
  const formatted = String(raw ?? '')
    .trim()
    .replace(' ', 'T')
    .replace(/\+00(?::00)?$/, 'Z')
  return CURSOR_ISO_TS_RE.test(formatted) ? formatted : ''
}

/**
 * Paginación keyset acotada sobre `idx_phone_callbacks_pending_critical_scoped` con detección exacta de truncamiento (`pageSize + 1`).
 * Nunca realiza escaneos ilimitados: si existen más registros más allá del tope (`capLimit`, por defecto 10,000),
 * devuelve `truncated: true` para que la API y la UI adviertan explícitamente que la lista está truncada.
 */
export async function fetchScopedCriticalPendingCallbacksWithCap(
  buildScopedQuery: () => any,
  opts?: { pageSize?: number; maxPages?: number }
): Promise<{
  data: any[]
  error: any
  truncated: boolean
  capLimit: number
  pagesFetched: number
}> {
  const rawPageSize = opts?.pageSize != null ? Number(opts.pageSize) : NaN
  const rawMaxPages = opts?.maxPages != null ? Number(opts.maxPages) : NaN
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(500, Math.max(1, Math.floor(rawPageSize))) : CRITICAL_CALLBACKS_PAGE_SIZE
  const maxPages = Number.isFinite(rawMaxPages) ? Math.min(200, Math.max(1, Math.floor(rawMaxPages))) : CRITICAL_CALLBACKS_MAX_PAGES
  const capLimit = pageSize * maxPages

  const collected: any[] = []
  const seenIds = new Set<string>()
  let cursorCreatedAt: string | null = null
  let cursorId: string | null = null
  let truncated = false
  let pagesFetched = 0

  for (let page = 0; page < maxPages; page++) {
    let q = buildScopedQuery()
      .eq('status', 'pending')
      .in('urgency', ['critical', 'urgent'])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize + 1)

    if (cursorCreatedAt && cursorId) {
      q = q.or(
        `created_at.lt."${cursorCreatedAt}",and(created_at.eq."${cursorCreatedAt}",id.lt.${cursorId})`
      )
    }

    const { data, error } = await q
    if (error) {
      return { data: [], error, truncated: false, capLimit, pagesFetched }
    }
    pagesFetched++

    const rawBatch = Array.isArray(data) ? data : []
    if (rawBatch.length === 0) break

    const hasMoreAfterPage = rawBatch.length > pageSize
    const batch = hasMoreAfterPage ? rawBatch.slice(0, pageSize) : rawBatch

    let addedInBatch = 0
    for (const row of batch) {
      const idStr = String(row?.id || '')
      if (idStr && !seenIds.has(idStr)) {
        seenIds.add(idStr)
        collected.push(row)
        addedInBatch++
      }
    }

    if (!hasMoreAfterPage) {
      break
    }

    if (page === maxPages - 1) {
      truncated = true
      break
    }

    const last = batch[batch.length - 1]
    const nextTs = formatPgKeysetTimestamp(last?.created_at)
    const nextId = String(last?.id || '')
    if (addedInBatch === 0 || !nextTs || !CURSOR_UUID_RE.test(nextId)) {
      truncated = true
      break
    }
    cursorCreatedAt = nextTs
    cursorId = nextId
  }

  return { data: collected, error: null, truncated, capLimit, pagesFetched }
}

// Marca temporal del despliegue canónico actual; si el Admin edita o desactiva una regla en /admin/llamadas,
// el motor cede automáticamente el turno a Gemini para aplicar el texto actualizado en vivo.
const CANONICAL_KB_EPOCH_MS = Date.parse('2026-11-19T06:40:00Z')

function didAssistantOfferClosingFollowUp(assistantText: string | null | undefined): boolean {
  const raw = String(assistantText || '').trim()
  if (!raw || isPromptExpectingPhoneOrDetails(raw)) return false
  const norm = normalizeSearchText(raw)
  return /\b(algo mas|alguna otra (?:duda|pregunta|consulta|cosa|informacion)|otra (?:duda|pregunta|consulta|informacion)|algun otro|algun precio|algun ingrediente|horario o direccion de alguna|en que mas (?:te|le) (?:puedo|ayudo)|puedo ayudar(?:te|le)? con algo|pueda apoyarte|anything else|something else|how else can i help|else (?:can )?i (?:can )?help|any other questions?|any prices|hours or address for any|hours or menu|what else can i)\b/i.test(
    norm
  )
}

export function isCallerEndingConversation(params: {
  userText: string
  normUser: string
  prevAssistantText: string
}): boolean {
  const { userText, normUser, prevAssistantText } = params
  const trimmed = normUser.trim()
  if (!trimmed) return false
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length

  // 0. Abortos explícitos de llamada (incluso si Kore pidió datos o contiene "llamo"/"tarde"):
  //    nunca activar si hay pregunta abierta, dígitos de orden/teléfono o palabras de solicitud/pregunta activa.
  if (
    !/[?¿]/.test(userText) &&
    !/\b\d{3,}\b/.test(trimmed) &&
    wordCount <= 12 &&
    !/\b(pero|dime|cuanto|a que hora|donde|cuando|cual|como|quien|quiero|necesito|tienen|venden|pregunta|duda|espera|espere|but|wait|actually|how much|what time)\b/i.test(
      trimmed
    ) &&
    /\b(cuelgame|puedes colgar|ya voy a colgar|mejor luego llamo|mejor llamo luego|mejor llamo mas tarde|despues llamo|llamo despues|llamo mas tarde|te llamo luego|te llamo mas tarde|olvida(?:lo)?[\s,]+(?:adios|gracias|bye)|hang up|(?:ill|i\s+ll|i will) call back later|never mind[\s,]+(?:bye|goodbye|thanks))\b/i.test(
      trimmed
    )
  ) {
    return true
  }

  // 1. Nunca colgar si el usuario está haciendo otra pregunta, reportando incidencia o dando un número/orden/solicitud nueva
  if (
    /[?¿]/.test(userText) ||
    /\b\d{3,}\b/.test(trimmed) ||
    /\b(mejor\s+(?:dime|pregunt|quiero|dame|pasame|cual|cuanto|a que)|espera|espere|aguanta|momento|una pregunta|otra pregunta|otra duda|otra cosa|y cuanto|cuanto cuesta|a que hora|donde|cuando|cual|como|quien|tambien|ademas|pero|quiero|necesito|quisiera|me puedes|me podrias|puedes decirme|podrias decirme|tienen|venden|manejan|aceptan|falto|faltaron|equivocad[oa]s?|incomplet[oa]s?|ticket|recibo|orden|order|gerente|manager|dime|pasame|avisar|aviso|llamo|llamaba|tarde|mal|dieron|olvide|cartera|refund|reembolso|uber|doordash|grubhub|direccion|telefono|trabajo|empleo|salsa|limon|limones|cilantro|pongale|ponganle|arrived|one more|another question|wait|hold on|actually|but|also|how much|what time|where|when|which|i want|i need|can you tell|do you have|do you sell|missing|wrong)\b/i.test(
      trimmed
    ) ||
    /\b(nada mas (?:queria|quiero|para|una|saber|preguntar|era|me|les)|es todo lo que)\b/i.test(trimmed)
  ) {
    return false
  }

  // Si Kore acaba de pedir datos (ticket, fecha, nombre, teléfono, sucursal), NO tratar "no" o "nada" como colgar
  if (isPromptExpectingPhoneOrDetails(prevAssistantText)) {
    return /\b(cuelgame|puedes colgar|ya voy a colgar|mejor luego llamo|despues llamo|llamo mas tarde|olvida(?:lo)? adios|hang up|(?:ill|i\s+ll) call back later|never mind bye|goodbye)\b/i.test(
      trimmed
    )
  }

  const offeredClosing = didAssistantOfferClosingFollowUp(prevAssistantText)

  // 2. Frases explícitas de cierre o despedida completa (ancladas o inequívocas para evitar falsos cuelgues)
  if (
    wordCount <= 16 &&
    /\b(gracias es todo|es todo gracias|todo gracias|ya esta gracias|eso es todo|ya es todo|seria todo|ya seria todo|solo era eso|era todo|con eso basta|con eso es suficiente|ya quedo gracias|muchas gracias adios|gracias buen dia|gracias buenos dias|gracias buena tarde|gracias buenas tardes|gracias buena noche|gracias buenas noches|que tengas? (?:un[ao]? )?(?:buen[ao]?|excelente|bonit[ao]) (?:dia|tarde|noche)|que pases? (?:un[ao]? )?(?:buen[ao]?|excelente|bonit[ao]) (?:dia|tarde|noche)|hasta luego|adios|nos vemos|chao|cuelgame|puedes colgar|ya voy a colgar|ahorita (?:lo )?(?:pido|ordeno) en (?:linea|la pagina|internet)|lo (?:pido|ordeno) en tacosgavilan|thank you (?:thats|that s|that is) all|thanks (?:thats|that s|that is) all|(?:thats|that s|that is) all|that will be all|(?:thats|that s|that is) everything|(?:thats|that s|that is) it|all set thanks|thank you maam|thank you miss|thank you sir|have a (?:good|great|wonderful|nice) (?:day|night|evening|one)|goodbye|bye|see ya|take care|hang up|(?:ill|i\s+ll|i will) order online)\b/i.test(
      trimmed
    )
  ) {
    return true
  }

  // 2b. Frases cortas de cierre ancladas de extremo a extremo (incluyendo recortes reales STT como "no esto", "ya esta", "nada mas", "espero su llamada")
  if (
    wordCount <= 10 &&
    /^(?:ok|okay|si|perfecto|muy bien|esta bien|listo|gracias|muchas gracias|no)?[\s,]*(?:es todo|no es todo|no esto|no nada mas|nada mas|ya esta|espero (?:la|su) llamada|ahorita paso a la (?:sucursal|tienda)|no thank you|no thanks|nothing else|(?:im|i\s+m|i am) all set|(?:were|we\s+re|we are) all set)(?:[\s,]+(?:gracias|muchas gracias|muchisimas gracias|mil gracias|adios|hasta luego|buen dia|buenos dias|buena tarde|buenas tardes|buena noche|buenas noches|thank you|thanks|so much|bye))*\.?\!*$/i.test(
      trimmed
    )
  ) {
    return true
  }

  // 3. Respuestas breves naturales cuando la asistente acaba de ofrecer "¿Algo más? / ¿Alguna otra duda? / How else can I help?"
  const shortClosingToken =
    '(?:no|nop|nel|nope|nah|ninguna|ninguno|nada|nada mas|ya no|no ya no|no esto|todo gracias|ya esta|ya esta gracias|asi esta bien|esta bien|todo bien|con eso|con eso esta bien|listo|ya quedo|perfecto|muy bien|ok|okay|sale|orale|entendido|enterado|gracias|muchas gracias|muchisimas gracias|mil gracias|te lo agradezco|amable|muy amable|buen dia|buenos dias|buena tarde|buenas tardes|buena noche|buenas noches|igualmente|thank you|thanks|thank you so much|thanks so much|thanks a lot|so much|a lot|appreciate it|maam|miss|sir|(?:im|i\\s+m|i am) good|all good|(?:were|we\\s+re|we are) good|(?:im|i\\s+m|i am) all set|(?:were|we\\s+re|we are) all set|all set|(?:thats|that s|that is) it|have a good day|have a great day|have a good night|have a good one|bye)'
  if (offeredClosing && wordCount <= 12) {
    const shortClosingRe = new RegExp(`^${shortClosingToken}(?:[\\s,]+${shortClosingToken})*\\.?\\!*$`, 'i')
    if (shortClosingRe.test(trimmed)) {
      return true
    }
  }

  return false
}

export function didAssistantConcludeCall(replyText: string | null | undefined): boolean {
  const raw = String(replyText || '').trim()
  if (!raw || /[?¿]/.test(raw) || isPromptExpectingPhoneOrDetails(raw)) return false
  const norm = normalizeSearchText(raw)
  const hasExplicitFarewell =
    /\b(que tengas? (?:un[ao]? )?(?:excelente|buen[ao]?|bonit[ao]|gran) (?:dia|tarde|noche)|que pases? (?:un[ao]? )?(?:excelente|buen[ao]?|bonit[ao]|gran) (?:tarde|noche|dia)|que estes bien|hasta pronto|hasta luego|adios|no recibimos ofertas comerciales|have a (?:wonderful|great|good|nice) (?:day|evening|night|one)|goodbye|take care|do not accept commercial solicitations)\b/i.test(
      norm
    )
  if (hasExplicitFarewell) return true
  // "Gracias por llamar" solo cierra llamada cuando es despedida (no saludo de apertura seguido de horarios/dirección)
  const hasThankForCalling = /\b(gracias por llamar|thank you for calling|thanks for calling)\b/i.test(norm)
  const looksLikeOpeningPlusInfo =
    /^(?:gracias por llamar|thanks? for calling|thank you for calling)\b/i.test(norm) &&
    /\b(abrimos|cerramos|abiertos|cerrado|direccion|ubicados|open|close|located|address)\b/i.test(norm)
  return hasThankForCalling && !looksLikeOpeningPlusInfo
}

function isGlobalKbTopicCanonicalUntouched(knowledgeBase: any[], storeId: number, category: string, titlePattern: RegExp): boolean {
  if (!Array.isArray(knowledgeBase) || knowledgeBase.length === 0) return false
  const hasStoreOverride = knowledgeBase.some(
    (k: any) =>
      k?.is_active !== false &&
      Number(k?.store_id) === Number(storeId) &&
      String(k?.category || '').toLowerCase() === category
  )
  if (hasStoreOverride) return false
  const globalMatch = knowledgeBase.find(
    (k: any) => !k?.store_id && String(k?.category || '').toLowerCase() === category && titlePattern.test(String(k?.title || ''))
  )
  if (!globalMatch || globalMatch.is_active === false) return false
  const updMs = globalMatch.updated_at ? Date.parse(String(globalMatch.updated_at)) : 0
  if (Number.isFinite(updMs) && updMs > CANONICAL_KB_EPOCH_MS) return false
  return true
}

function formatCanonicalScheduleForOffsetDay(params: {
  store: any
  specialHours: any[]
  offsetDays: number
  explicitDow: number | null
  prefixLabelEs: string
  prefixLabelEn: string
  lang: PhoneLang
  isWeekendAsk?: boolean
}): string {
  const { store, specialHours, offsetDays, prefixLabelEs, prefixLabelEn, lang } = params
  const weeklyMap = normalizeWeeklyHours(store.weekly_hours)
  const ptNow = getPacificDateParts()
  const [y, m, d] = ptNow.dateStr.split('-').map(Number)
  const targetUtc = new Date(Date.UTC(y, m - 1, d + offsetDays))
  const dateStr = targetUtc.toISOString().slice(0, 10)
  const dow = targetUtc.getUTCDay()
  const dayEs = DAY_NAMES_ES[dow].toLowerCase()
  const dayEsPlural = dayEs === 'sábado' || dayEs === 'domingo' ? `${dayEs}s` : dayEs
  const dayEn = DAY_NAMES_EN[dow]

  const eff = resolveEffectiveDaySchedule({
    storeIdNum: store.id,
    regular: weeklyMap[dow],
    dateStr,
    specialHours
  })

  if (eff.isClosedAllDay) {
    if (lang === 'en') {
      const hol = eff.holidayNameEn ? ` for ${eff.holidayNameEn}` : ''
      return `${prefixLabelEn || `On ${dayEn}`}${hol}, our store will be closed all day. Can I help with anything else?`
    }
    const hol = eff.holidayName ? ` por ${eff.holidayName}` : ''
    return `${prefixLabelEs || `El ${dayEs}`}${hol} nuestra sucursal permanecerá cerrada todo el día. ¿Te ayudo con algo más?`
  }

  const open12Es = formatTime12h(eff.open, 'es')
  const close12Es = formatTime12h(eff.close, 'es')
  const open12En = formatTime12h(eff.open, 'en')
  const close12En = formatTime12h(eff.close, 'en')
  if (lang === 'en') {
    const hol = eff.holidayNameEn ? `, ${eff.holidayNameEn} special hours,` : ''
    const lead = prefixLabelEn || (eff.isSpecial ? `This upcoming ${dayEn}` : `On ${dayEn}s`)
    return `${lead}${hol} we are open from ${open12En} to ${close12En}. Can I help with anything else?`
  }
  const hol = eff.holidayName ? ` por ${eff.holidayName}` : ''
  const lead = prefixLabelEs || (eff.isSpecial ? `Este ${dayEs}` : `Los ${dayEsPlural}`)
  return `${lead}${hol} abrimos de ${open12Es} a ${close12Es}. ¿Te puedo ayudar con algo más?`
}

/**
 * Banco determinista de Respuestas Canónicas Preparadas (< 2 ms CPU, 0 llamadas LLM).
 * Garantiza redacción uniforme, veloz y pre-calentable en Storage (`phone_v6/Kore`) para las 19 preguntas
 * frecuentes más comunes, delegando a Gemini Hedged LLM cualquier pregunta compuesta (>1 tema), flujo con herramientas
 * o regla editada por el Administrador.
 */
export function resolveCanonicalPreparedReply(params: {
  userText: string
  normUser: string
  lang: PhoneLang
  lastAssistantText: string
  hadPriorPostOrderTurn?: boolean
  hadPriorCallbackInCall?: boolean
  store: any
  config: any
  scheduleEval: StoreOpenEvaluation
  allSpecialHours: any[]
  upcomingHolidays: any[]
  knowledgeBase: any[]
  allActiveStores: any[]
  liveMenuItems: any[]
  spokenStoreAddress: string
  customerBranchCrossStreets: string | null
  wantsFiestaContext: boolean
  detectedGuestCount: number | null
  platterInfo: ReturnType<typeof recommendFiestaPlatters> | null
}): {
  replyText: string
  markAsSpam?: boolean
  toolsUsedToAdd?: string[]
} | null {
  const {
    userText,
    normUser,
    lang,
    lastAssistantText,
    hadPriorPostOrderTurn = false,
    hadPriorCallbackInCall = false,
    store,
    config,
    scheduleEval,
    allSpecialHours,
    upcomingHolidays,
    knowledgeBase,
    allActiveStores,
    liveMenuItems,
    spokenStoreAddress,
    customerBranchCrossStreets,
    wantsFiestaContext,
    detectedGuestCount,
    platterInfo
  } = params

  if (!normUser) return null
  // Si Kore acaba de pedir datos para un recado / nota / orden, jamás cortar con FAQ
  if (isPromptExpectingPhoneOrDetails(lastAssistantText)) return null
  // Si la llamada acaba de hablar de órdenes previas o reclamos y el usuario no pregunta otro FAQ claro, o si el turno mismo requiere atención interactiva:
  const needsInteractiveFlow =
    /\b(falto|falta|faltaron|incomplet|queja|mal|reembolso|refund|cobro|gerente|manager|supervisor|olvide|deje mi|perdi|empleado|empleada|trabajo ahi|llegar tarde|mi turno|proveedor|tecnico|condimento|condimentos|cilantro|limon|limones|jalapeno|jalapenos|servilleta|tenedor|tenedores|cubierto|cubiertos|agregar salsa|mas salsa|ponle salsa|poner salsa|equivocad|wrong store|wrong location|no ha llegado|no llega|no me llega|tardando|retras|delayed|ya hice|mi orden|mi pedido|llamando porque)\b/i.test(
      normUser
    )

  const storeSpecial = allSpecialHours.filter(
    (sh: any) => sh.store_id === null || Number(sh.store_id) === Number(store.id)
  )

  // Detectar qué temas distintos están presentes en esta frase (si >1 -> pregunta compuesta -> Hedged LLM)
  const topics = new Set<string>()

  const isClosingHit = isCallerEndingConversation({
    userText,
    normUser,
    prevAssistantText: lastAssistantText
  })
  if (isClosingHit) topics.add('closing')

  const isSpamHit =
    /\b(google listing|seo|merchant cash|prestamo comercial|extended warranty|solar panels|paneles solares|business insurance|posicionamiento web)\b/i.test(
      normUser
    )
  if (isSpamHit) topics.add('spam')

  const isOrderByPhoneHit =
    !wantsFiestaContext &&
    !needsInteractiveFlow &&
    !/\b(trabajo|empleo|vacante|solicitud|job|apply|cuanto|cuesta|precio|price|how much)\b/i.test(normUser) &&
    /\b(hacer una? (?:orden|pedido)|pedir por telefono|ordenar por telefono|toman (?:ordenes|pedidos) por telefono|aceptan (?:ordenes|pedidos) por telefono|se puede (?:ordenar|pedir) por telefono|puedo (?:ordenar|pedir).{0,24}(?:por telefono|para llevar|para recoger)|tomar (?:mi |una )?(?:orden|pedido)|tomame la orden|toma mi orden|me tomas la orden|puedes tomar (?:mi |una )?(?:orden|pedido)|me pueden tomar (?:mi |una )?(?:orden|pedido)|quiero (?:ordenar|pedir)|quisiera (?:pedir|ordenar|hacer una? (?:orden|pedido))|llamando para (?:hacer )?una? (?:orden|pedido)|can i (?:order|place an? (?:\w+ )?order|call in an? order)|do you take (?:phone orders|orders over the phone|orders by phone)|place an? (?:\w+ )?order|order over the phone|put in an? order|take my order|i want to order|i\s*d like to (?:order|place an? (?:\w+ )?order)|like to place an? (?:\w+ )?order)\b/i.test(
      normUser
    )
  if (isOrderByPhoneHit) topics.add('order_by_phone')

  // Distinguir "en la mañana / por la mañana / de la mañana / esta mañana" (horario matutino) vs "mañana" (día siguiente)
  const normWithoutMorningPhrase = normUser.replace(/\b(?:en|de|por|a|toda)\s+la\s+manana\b|\besta\s+manana\b/gi, ' ')
  const isTodayHoursHit =
    /\b(a que hora (?:abren|cierran)|hora de (?:cierre|apertura)|estan abiertos|esta abierto|tienen abierto|siguen abiertos|siguen dando servicio|estan dando servicio|ya abrieron|ya cerraron|todavia alcanzo|hasta que hora|cual es (?:su|el) horario(?: de hoy)?|que horario (?:tienen|manejan)(?: hoy)?|what time do you (?:open|close)|when do you (?:open|close)|are you (?:guys )?(?:still )?(?:open|closed)|still open|what(?:\s*s| is| are) your (?:hours|schedule)(?: today)?|your hours(?: today)?)\b/i.test(
      normUser
    ) && !/\b(manana|tomorrow|lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|fin de semana|weekend|festiv|holiday|thanksgiving|navidad|nochebuena|christmas|black friday|ano nuevo|new year|viernes santo|good friday|24 de diciembre|25 de diciembre|31 de diciembre|1 de enero|dec\w* 24|dec\w* 25|dec\w* 31|jan\w* 1)\b/i.test(normWithoutMorningPhrase)
  if (isTodayHoursHit) topics.add('today_hours')

  const weekdayTokens = [
    { dow: 0, re: /\b(domingo|domingos|sunday|sundays)\b/i },
    { dow: 1, re: /\b(lunes|monday|mondays)\b/i },
    { dow: 2, re: /\b(martes|tuesday|tuesdays)\b/i },
    { dow: 3, re: /\b(miercoles|wednesday|wednesdays)\b/i },
    { dow: 4, re: /\b(jueves|thursday|thursdays)\b/i },
    { dow: 5, re: /\b(viernes|friday|fridays)\b/i },
    { dow: 6, re: /\b(sabado|sabados|saturday|saturdays)\b/i }
  ].filter((d) => d.re.test(normUser))
  const mentionsTomorrow = /\b(manana|tomorrow)\b/i.test(normWithoutMorningPhrase)
  const mentionsWeekend = /\b(fin de semana|weekend)\b/i.test(normUser)
  const mentionsTodayWord = /\b(hoy|today)\b/i.test(normUser)
  const asksHoursWord = /\b(hora|horario|abren|cierran|abierto|cerrado|open|close|hours)\b/i.test(normUser)
  const isOfficialHolidayWord =
    /\b(festiv|holiday|holidays|thanksgiving|accion de gracias|black friday|navidad|nochebuena|christmas|fin de ano|ano nuevo|new year|viernes santo|good friday|24 de diciembre|25 de diciembre|31 de diciembre|1 de enero|dec(?:ember)?\s*(?:24|25|31)|jan(?:uary)?\s*1)\b/i.test(
      normUser
    )
  const isMinorHolidayScheduleAsk =
    asksHoursWord &&
    /\b(cinco de mayo|4 de julio|july 4|labor day|dia de las madres|mothers day)\b/i.test(normUser)
  const isSpecificHolidayWord = isOfficialHolidayWord || isMinorHolidayScheduleAsk
  const isFriSatPair =
    weekdayTokens.length === 2 &&
    weekdayTokens.some((d) => d.dow === 5) &&
    weekdayTokens.some((d) => d.dow === 6)
  if (
    (((mentionsTomorrow && !mentionsWeekend) && (weekdayTokens.length === 0 || isFriSatPair)) ||
      (mentionsWeekend && !mentionsTomorrow && weekdayTokens.length === 0) ||
      (isFriSatPair && !mentionsTomorrow && !mentionsWeekend) ||
      (weekdayTokens.length === 1 && !mentionsTomorrow && !mentionsWeekend)) &&
    !isSpecificHolidayWord &&
    !mentionsTodayWord
  ) {
    if (asksHoursWord || /^(?:y\s+)?(?:el|los|para)?\s*(?:manana|tomorrow|lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\??$/i.test(normWithoutMorningPhrase.trim())) {
      topics.add('weekday_hours')
    }
  }
  if (isSpecificHolidayWord) {
    topics.add('holidays')
  }

  const isAddressOrPhoneHit =
    /\b(cual es (?:la|su) (?:direccion|domicilio)|en que (?:direccion|calles?) estan|donde estan ubicados|donde queda(?:n| la tienda| la sucursal)?|me das la direccion|en donde estan|cual es (?:el|su) (?:numero de )?telefono|que numero de telefono tienen|numero de telefono de la (?:tienda|sucursal)|what(?:\s*s| is) (?:the|your) (?:address|phone number)|can i get (?:the|your) (?:address|phone number)|where (?:are you|is the store|is this location)(?: located)?|what street are you on|store phone number)\b/i.test(
      normUser
    )
  if (isAddressOrPhoneHit) topics.add('address_phone')

  const asksWhichDriveThruStores =
    /\b(cuales|que tiendas|que sucursales|cuantas sucursales|donde tienen|which stores|which locations|where do you have).{0,28}\b(drive|ventanilla)\b/i.test(
      normUser
    )
  const isDriveThruHit =
    asksWhichDriveThruStores ||
    /\b((?:tienen?|hay|cuentan?\s+con)\s+(?:servicio\s+(?:de\s+|al\s+)|ventanilla\s+de\s+)?(?:drive[\s\-]*thru|drive\s+through|ventanilla|carro)|puedo\s+pasar\s+en\s+carro|(?:do\s+you(?:\s+guys)?|does\s+(?:this\s+location|this\s+store|it))\s+have\s+(?:a\s+)?(?:drive[\s\-]*thru|drive\s+through)|is\s+there\s+(?:a\s+)?(?:drive[\s\-]*thru|drive\s+through))\b/i.test(
      normUser
    )
  if (isDriveThruHit) topics.add('drive_thru')

  const isPaymentsHit =
    /\b(ebt|calfresh|food stamps|estampillas|apple pay|google pay|formas de pago|metodos de pago|(?:aceptan|agarran)\s+tarjetas?|pagar con tarjeta|aceptan efectivo|solo efectivo|payment methods|do you (?:accept|take)\s+(?:credit|debit|cards?|cash|apple pay|google pay)|accept credit|accept debit|is it cash only|cash only)\b/i.test(
      normUser
    )
  if (isPaymentsHit) topics.add('payments_ebt')

  const isJobHit =
    /\b(bolsa de trabajo|estan contratando|estan agarrando gente|tienen vacantes|tienen trabajo|hay trabajo|solicitud de empleo|aplicar para trabajar|quiero trabajar con ustedes|busco trabajo|como aplico|want to apply|are you hiring|hiring|job application|job openings?|apply (?:for a job|to work)|looking for a job)\b/i.test(
      normUser
    )
  if (isJobHit) topics.add('job_inquiry')

  const mentionsDeliveryApp = /\b(uber(?:\s*eats)?|doordash|door dash|grubhub|postmates)\b/i.test(normUser)
  const isDriverSelf =
    (/\b(soy repartidor|repartidor|(?:delivery|uber(?:\s*eats)?|doordash|door dash|grubhub|postmates)\s+driver|dasher|courier|picking up|pick up an? order|where\s+(?:do|can)\s+i\s+pick\s*up)\b/i.test(normUser) ||
      (/\b(voy a recoger|vengo a recoger)\b/i.test(normUser) && mentionsDeliveryApp)) &&
    !/\b(el repartidor (?:no|todavia|se|aun)|esperando repartidor|mi orden|mi pedido|mi comida|driver (?:never|hasn\s*t|didn\s*t|is late|still))\b/i.test(normUser)
  if (isDriverSelf && /\b(uber|doordash|grubhub|driver|repartidor|donde recojo|where\s+(?:do|can)\s+i\s+pick|drive|comedor|mostrador|counter)\b/i.test(normUser)) {
    topics.add('delivery_driver')
  }

  const asksSpecificPriceWord = /\b(cuanto cuesta|cuesta|precio|precios|vale|a como|how much|price|cost)\b/i.test(normUser)

  const isAguasHit =
    !asksSpecificPriceWord &&
    /\b(que sabores? de aguas?|de que sabores? son las aguas|que aguas? (?:frescas? )?(?:tienen|manejan)|cuales aguas? frescas?|que bebidas? (?:tienen|manejan)|tienen agua de|tienen pepino|tamano de (?:las? )?(?:aguas|bebidas|champurrado|vaso)|cuantas onzas|what (?:aguas frescas|flavors|drinks|sizes)|do you have cucumber)\b/i.test(
      normUser
    )
  if (isAguasHit) topics.add('aguas_drinks')

  const isDessertsHit =
    /\b(pastel(?:es)?(?: de cumpleanos)?|birthday cakes?|whole cakes?|que postres?|venden postres?|tienen postres?|tienen flan|tienen cheesecake|(?:tienen|venden|hay|manejan|do you (?:have|sell|serve))\s+(?:el\s+|la\s+|un\s+|una\s+)?churros?|what desserts?|do you have cakes?|do you sell desserts?|tres leches)\b/i.test(
      normUser
    )
  if (isDessertsHit) topics.add('desserts')

  const isMeatsHit =
    !asksSpecificPriceWord &&
    /\b(que carnes? (?:tienen|manejan)|cuales son las carnes|de que carnes? (?:tienen|son)|cuales carnes? manejan|de que son los tacos|tipos? de carne|what (?:kind of |types? of )?meats? (?:do you (?:have|serve)|options)|what meat options|which meats)\b/i.test(
      normUser
    )
  if (isMeatsHit) topics.add('meats_list')

  const isRegularSuperHit =
    /\b(diferencia (?:entre|hay entre).{0,28}(?:regular|super)|que (?:lleva|tiene|trae) (?:la|el|un|una) (?:super|regular)|what(?:\s*s| is) the difference between.{0,22}(?:regular|super)|what comes (?:in|on) a super (?:burrito|quesadilla|mulita))\b/i.test(
      normUser
    ) && !asksSpecificPriceWord
  if (isRegularSuperHit) topics.add('regular_vs_super')

  const isCubanaOrTortaCheeseHit =
    !asksSpecificPriceWord &&
    (/\b((?:que|cuales)(?:\s+(?:carnes?|ingredientes?|es lo que))?\s+(?:lleva|tiene|contiene|trae|son|incluye)\s+(?:(?:la|una)\s+)?(?:torta\s+cubana|cubana)|de\s+que\s+(?:es|esta\s+hecha)\s+(?:la\s+)?(?:torta\s+cubana|cubana)|what.{0,20}torta cubana|ingredients.{0,16}(?:torta\s+)?cubana)\b/i.test(
      normUser
    ) ||
      /\b(que queso (?:lleva|llevan|tienen) las tortas|tortas?.{0,16}(?:crema|queso fundido|queso)|what cheese.{0,12}tortas)\b/i.test(normUser))
  if (isCubanaOrTortaCheeseHit) topics.add('torta_info')

  const mentionsManagedDish = /\b(taco|burrito|mulita|quesadilla|torta|sope|nacho|horchata|jamaica|flan|cheesecake|asada|pastor|pollo|cabeza|lengua|buche|chorizo|carnitas)\b/i.test(normUser)
  const isUnsupportedOnlyHit =
    !mentionsManagedDish &&
    /\b(tienen|venden|hay|manejan|hacen|sirven|do you (?:have|sell|serve))\s+(?:el\s+|la\s+|un\s+|una\s+)?(menudo|birria|quesabirrias?|pozole|suadero|tripa|tripas|cerveza|beer|alcohol|micheladas?)\b/i.test(
      normUser
    )
  if (isUnsupportedOnlyHit) topics.add('unsupported_items')

  const asksFiestaDetailedSpec = /\b(precio|precios|cuanto|cuesta|tamano|tamanos|docena|docenas|tortilla|tortillas|popote|popotes|straw|straws|how much|size|sizes|price|prices|dozen)\b/i.test(normUser)
  const isFiestaCanonicalHit =
    wantsFiestaContext &&
    !/\b(puro arroz|puro frijol|solo carne|mi charola|ya ordene|ya pedi)\b/i.test(normUser) &&
    (detectedGuestCount !== null ||
      (!asksFiestaDetailedSpec &&
        /\b(que incluye|como ordeno|donde ordeno|charolas|fiesta platters?|party trays?|what do.{0,18}include|how to order)\b/i.test(
          normUser
        )))
  if (isFiestaCanonicalHit) topics.add('fiesta_platters')

  // Si hay un reclamo/recado abierto de turnos previos aún sin registrar, solo permitir cierre explícito para no secuestrar respuestas cortas como "el viernes"
  if (hadPriorPostOrderTurn && !hadPriorCallbackInCall) {
    if (!(topics.size === 1 && topics.has('closing'))) return null
  }

  // Primer turno de orden equivocada o incompleta en Drive-Thru, comedor o mostrador (sin Uber/DD/GH y antes de dar ticket/teléfono/nombre)
  const expandedDigitsUser = replaceSpokenDigitRuns(userText)
  const alreadyHasTenDigitPhone =
    /(?:\+?1[\s,.\-]*)?(?:\(?\d{3}\)?[\s,.\-]*\d{3}[\s,.\-]*\d{2}[\s,.\-]*\d{2}|(?:\d[\s,.\-]*){10,11})/.test(
      expandedDigitsUser
    )
  const alreadyHasTicketRef =
    /\b(?:ticket|recibo|orden|order|receipt)(?:\s+(?:numero|number|num|no|es|fue|era|is|was|el|la|#)){0,3}\s*[a-z0-9\-]*\d[a-z0-9\-]*\b/i.test(normUser) ||
    /#\s*\d{2,6}\b/.test(userText)
  const alreadyHasCallerName =
    /\b(?:me llamo|mi nombre es|my name is)\s+[a-z]{2,}\b/i.test(normUser) ||
    (/\b(?:soy|habla|this is)\s+([a-z]{2,})\b/i.test(normUser) &&
      !/\b(?:soy|habla|this is)\s+(?:un|una|el|la|cliente|customer|caller|calling|missing|having|ordering|speaking|trying|here|llamando|para|por|de)\b/i.test(
        normUser
      ))
  const alreadyStatesNoTicket =
    /\b(?:no tengo|sin|perdi|se me perdio|tire|no me dieron|no me lo dieron|olvide)\s+(?:el\s+|mi\s+)?(?:ticket|recibo|comprobante)\b/i.test(normUser) ||
    /\b(?:don\s*t|do not|didn\s*t|did not)\s+(?:have|get|keep)\s+(?:the\s+|my\s+|a\s+)?(?:ticket|receipt)\b/i.test(normUser) ||
    /\b(?:lost|threw\s+away|threw\s+out)\s+(?:the\s+|my\s+)?(?:ticket|receipt)\b/i.test(normUser)
  const isPreVisitCondimentMenuQ =
    /\b(do\s+(?:your\s+|the\s+)?(?:tacos?|burritos?|orders?|you)\s+include|llevan|traen|incluyen|viene\s+con|vienen\s+con)\b/i.test(normUser) &&
    !/\b(mi orden|mi pedido|ya hice|ya ordene|ya pedi|my order|i ordered|i placed)\b/i.test(normUser)
  const isAddingFreeCondimentsOnly =
    !isPreVisitCondimentMenuQ &&
    /\b(agregar|anadir|poner(?:le)?|ponle|echar(?:le)?|echale|incluir|mandar|regalar|add|include|extra)\b.{0,28}\b(salsas?|limon(?:es)?|cilantro|cebolla|jalapenos?|condimentos?|servilletas?|cubiertos?|tenedores?|utensils?|napkins?|limes?)\b/i.test(
      normUser
    )
  const isWrongBranchMention =
    /\b(sucursal equivocada|tienda equivocada|otra sucursal|otra tienda|me equivoque de (?:sucursal|tienda)|wrong store|wrong location|other store|other location)\b/i.test(
      normUser
    )
  const isLostOrBillingOrSick =
    /\b(olvide mi|deje mi|perdi mi|cartera|llaves|celular|bolsa|mochila|wallet|keys|cobro doble|doble cobro|cobraron de mas|overcharged|enferm|intoxic|got sick|food poisoning)\b/i.test(
      normUser
    )
  const isTacosGavilanOwnApp = /\b(aplicacion de tacos gavilan|app de tacos gavilan|tacos gavilan app)\b/i.test(normUser)
  const isThirdPartyDeliveryContext =
    !isTacosGavilanOwnApp &&
    /\b(uber(?:\s*eats)?|doordash|door dash|grubhub|postmates|repartidor|driver|chofer|aplicacion|delivery)\b/i.test(normUser)
  const isWrongPhoneNumberOnly = /\b(numero equivocado|wrong number)\b/i.test(normUser)
  const mentionsWrongOrIncompleteOrder =
    !isWrongPhoneNumberOnly &&
    (/\b(orden equivocad[oa]|pedido equivocad[oa]|salio equivocad[oa]|venia equivocad[oa]|estaba equivocad[oa]|orden mal|pedido mal|me dieron mal|salio mal|venia mal|vino mal|hicieron mal|prepararon mal|equivocaron|equivocad[oa]s?|me cambiaron|no era lo que pedi|me falto|me faltaron|faltaron|incomplet[oa]s?|no (?:me )?llego complet[oa]|no me pusieron|no me dieron|no venia|no traia|wrong order|got my order wrong|messed up my (?:\w+ )?order|order was wrong|order came out wrong|order is wrong|missing (?:item|items|food|tacos?|burritos?|quesadillas?|mulitas?|tortas?|plates?|drinks?)|left out|forgot my)\b/i.test(
      normUser
    ) ||
      (/\b(drive[\s\-]*thru|ventanilla|comedor|mostrador|en caja|para llevar|dine[\s\-]*in|take[\s\-]*out|takeout|counter)\b/i.test(normUser) &&
        /\b(equivocad[oa]s?|mal|mala|malos|malas|falto|faltaron|incomplet[oa]s?|wrong|missing|mistake|incorrect|messed up)\b/i.test(normUser)))

  const isDeliveryDelayedHit =
    !hadPriorPostOrderTurn &&
    !alreadyHasTenDigitPhone &&
    !alreadyHasTicketRef &&
    !alreadyHasCallerName &&
    isThirdPartyDeliveryContext &&
    !isDriverSelf &&
    !isWrongBranchMention &&
    /\b(no ha llegado|no me llega|no llega|tardando|retras[oa]?(?:d[oa]s?)?|hasn\s*t arrived|has not arrived|not arrived|never arrived|didn\s*t arrive|delayed|taking too long)\b/i.test(
      normUser
    )

  const asksAppModifyPolicy =
    mentionsDeliveryApp &&
    !isDriverSelf &&
    !isAddingFreeCondimentsOnly &&
    !mentionsWrongOrIncompleteOrder &&
    !isDeliveryDelayedHit &&
    !isWrongBranchMention &&
    /\b(agregar|anadir|cambiar|modificar|corregir|cancelar|direccion|modify|change|edit|cancel|address|add food|add items)\b/i.test(
      normUser
    )
  if (asksAppModifyPolicy) topics.add('delivery_app_modify')

  if (
    !hadPriorPostOrderTurn &&
    !isDriverSelf &&
    !isThirdPartyDeliveryContext &&
    !isWrongBranchMention &&
    !isAddingFreeCondimentsOnly &&
    !isLostOrBillingOrSick &&
    !alreadyHasTenDigitPhone &&
    !alreadyHasTicketRef &&
    !alreadyHasCallerName &&
    !alreadyStatesNoTicket &&
    mentionsWrongOrIncompleteOrder
  ) {
    topics.add('in_store_wrong_order')
  }

  if (!hadPriorPostOrderTurn && !alreadyHasTenDigitPhone && !alreadyHasTicketRef && !alreadyHasCallerName) {
    if (isDeliveryDelayedHit) topics.add('delivery_app_delayed')

    const isDeliveryWrongHit =
      isThirdPartyDeliveryContext &&
      !isDriverSelf &&
      !isWrongBranchMention &&
      !isDeliveryDelayedHit &&
      mentionsWrongOrIncompleteOrder
    if (isDeliveryWrongHit) topics.add('delivery_app_wrong')

    if (isAddingFreeCondimentsOnly && !mentionsWrongOrIncompleteOrder && !isWrongBranchMention) {
      topics.add('condiments_initial')
    }

    const namesSpecificOtherBranch = inferMentionedOtherStore(allActiveStores, store.id, normUser) !== null
    if (isWrongBranchMention && !namesSpecificOtherBranch && !isThirdPartyDeliveryContext) {
      topics.add('wrong_store_initial')
    }
  }

  const allowedInteractiveTopics = new Set([
    'delivery_app_modify',
    'in_store_wrong_order',
    'delivery_app_delayed',
    'delivery_app_wrong',
    'condiments_initial',
    'wrong_store_initial'
  ])

  // Si toca flujo interactivo/callback o menciona precios/ítems no cubiertos o hay más de 1 tema -> usar Hedged Gemini
  if (needsInteractiveFlow && topics.size === 0) return null
  if (needsInteractiveFlow && !Array.from(topics).every((t) => allowedInteractiveTopics.has(t))) return null
  // Combinación frecuente "¿están abiertos hoy y tienen Drive-Thru?" -> responder canónicamente en < 200 ms
  if (topics.size === 2 && topics.has('today_hours') && topics.has('drive_thru') && !asksWhichDriveThruStores) {
    topics.clear()
    topics.add('today_hours_and_drive_thru')
  }
  if (topics.size !== 1) return null

  const onlyTopic = Array.from(topics)[0]
  const mentionsOtherStore =
    !asksWhichDriveThruStores &&
    onlyTopic !== 'wrong_store_initial' &&
    (inferMentionedOtherStore(allActiveStores, store.id, normUser) !== null ||
      /\b(otra sucursal|otra tienda|otras sucursales|otras tiendas|other store|other location|other locations)\b/i.test(normUser))
  if (mentionsOtherStore) return null

  // Palabras sueltas de menú que no pertenecen al topic elegido -> dejar que Gemini responda el precio o detalle
  if (
    asksSpecificPriceWord &&
    onlyTopic !== 'fiesta_platters' &&
    onlyTopic !== 'desserts'
  ) {
    return null
  }

  switch (onlyTopic) {
    case 'closing':
      return {
        replyText:
          lang === 'en'
            ? 'You are very welcome! Thank you for calling Tacos Gavilan, have a wonderful day!'
            : 'Con gusto. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!'
      }
    case 'spam':
      return {
        replyText:
          lang === 'en'
            ? 'Thank you for calling, however we do not accept commercial solicitations at this location. Have a great day!'
            : 'Agradecemos tu llamada, pero en esta sucursal no recibimos ofertas comerciales ni servicios externos. ¡Que tengas excelente día!',
        markAsSpam: true
      }
    case 'delivery_app_delayed':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'delivery', /retrasadas, no entregadas/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'Delivery transit is handled by your app driver. If it has been waiting too long for pickup, may I have your name, 10-digit phone, and order code so we can check the counter?'
            : 'El traslado depende del repartidor en tu app. Si lleva mucho tiempo esperando repartidor, ¿me das tu nombre, teléfono de 10 dígitos y código de orden para revisar en mostrador si sigue aquí?'
      }
    case 'delivery_app_wrong':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'delivery', /retrasadas, no entregadas/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'I apologize for that. Please report it in the Help section of your app for your refund or credit. If you also want to alert the manager, may I have your name, 10-digit phone, and order code?'
            : 'Lamento el inconveniente. Por favor repórtalo en la sección Ayuda de tu app para tu reembolso o crédito. Si gustas avisar al gerente, ¿me das tu nombre, teléfono de 10 dígitos y código de orden?'
      }
    case 'condiments_initial':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'policies', /agregar condimentos gratis/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'I can send a packing note to include them as long as your order has not left yet. May I have your name, order number, which condiments you need, and your 10-digit phone number?'
            : 'Con gusto envío nota de empaque para incluirlos siempre que tu orden aún no haya salido. ¿Me das tu nombre, número de orden, qué condimentos deseas y tu teléfono de 10 dígitos?'
      }
    case 'wrong_store_initial':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'policies', /sucursal equivocada/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'Paid orders cannot be moved between stores. For app orders please cancel right away in the app; for tacosgavilan.com pickup, which store did it go to, and what is your name, phone, and order number?'
            : 'No podemos mover órdenes pagadas entre tiendas. Si fue por app, cancélala de inmediato en tu app; si fue en tacosgavilan.com, ¿en qué sucursal cayó y cuál es tu nombre, teléfono y número de orden?'
      }
    case 'in_store_wrong_order':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'policies', /equivocadas o incompletas en drive-thru/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'I apologize for the inconvenience. To review how your order was prepared, may I have your ticket number, date, name, and phone number? Without the ticket, it is unlikely we can verify the mistake.'
            : 'Lamento el inconveniente. Para revisar la preparación de tu orden, ¿me das tu número de ticket, fecha, nombre y teléfono? Sin el ticket es poco probable determinar la equivocación.'
      }
    case 'order_by_phone':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'policies', /pedidos por tel/i)) return null
      return {
        replyText:
          lang === 'en'
            ? `I apologize, we do not take orders over the phone. You can easily place your order at tacosgavilan.com for pickup, or ${store.has_drive_thru ? 'directly at the counter or Drive-Thru.' : 'directly at the counter.'} How else can I help you?`
            : `Disculpa, no tomamos órdenes por teléfono. Puedes hacer tu pedido fácilmente en tacosgavilan.com para pasar a recoger, o ${store.has_drive_thru ? 'pedir directamente en caja o por el Drive-Thru.' : 'pedir directamente en caja.'} ¿Te ayudo con algo más?`
      }
    case 'today_hours':
      return {
        replyText:
          lang === 'en'
            ? `${scheduleEval.statusMessageEn} How else can I help you?`
            : `${scheduleEval.statusMessageEs} ¿Te puedo ayudar con algo más?`,
        toolsUsedToAdd: ['get_store_hours_and_status']
      }
    case 'today_hours_and_drive_thru': {
      const dtSentence =
        lang === 'en'
          ? store.has_drive_thru
            ? 'Yes, this location has Drive-Thru service.'
            : 'This location does not have a Drive-Thru, only counter and dining room service.'
          : store.has_drive_thru
            ? 'Sí contamos con servicio de Drive-Thru en esta sucursal.'
            : 'Esta sucursal no cuenta con Drive-Thru, solo servicio en caja y comedor.'
      return {
        replyText:
          lang === 'en'
            ? `${scheduleEval.statusMessageEn} ${dtSentence} Anything else?`
            : `${scheduleEval.statusMessageEs} ${dtSentence} ¿Te ayudo con algo más?`,
        toolsUsedToAdd: ['get_store_hours_and_status']
      }
    }
    case 'weekday_hours': {
      const ptNow = getPacificDateParts()
      if (isFriSatPair) {
        const weeklyMap = normalizeWeeklyHours(store.weekly_hours)
        const getEff = (off: number) => {
          const [yy, mm, dd] = ptNow.dateStr.split('-').map(Number)
          const dt = new Date(Date.UTC(yy, mm - 1, dd + off))
          const dStr = dt.toISOString().slice(0, 10)
          return resolveEffectiveDaySchedule({ storeIdNum: store.id, regular: weeklyMap[dt.getUTCDay()], dateStr: dStr, specialHours: storeSpecial })
        }
        const friOffset = ptNow.dayOfWeek === 6 ? -1 : (5 - ptNow.dayOfWeek + 7) % 7
        const satOffset = (6 - ptNow.dayOfWeek + 7) % 7
        const friEff = getEff(friOffset)
        const satEff = getEff(satOffset)
        if (!friEff.isClosedAllDay && !satEff.isClosedAllDay) {
          const friOpen = formatTime12h(friEff.open, lang)
          const friClose = formatTime12h(friEff.close, lang)
          const satOpen = formatTime12h(satEff.open, lang)
          const satClose = formatTime12h(satEff.close, lang)
          if (mentionsTomorrow) {
            const isAfterMidnightBizDay = ptNow.hour < 6 || scheduleEval.isAfterMidnightSpillover
            const tomOffset = isAfterMidnightBizDay ? 0 : 1
            const tomDow = (ptNow.dayOfWeek + tomOffset) % 7
            const tomEff = getEff(tomOffset)
            if (tomEff.isClosedAllDay) return null
            const tomOpen = formatTime12h(tomEff.open, lang)
            const tomClose = formatTime12h(tomEff.close, lang)
            if (lang === 'en') {
              const fsPart =
                friClose === satClose
                  ? `Friday and Saturday we close at ${friClose}`
                  : `Friday we close at ${friClose} and Saturday at ${satClose}`
              return {
                replyText: `${fsPart}, and tomorrow (${DAY_NAMES_EN[tomDow]}) we open from ${tomOpen} to ${tomClose}. Anything else?`,
                toolsUsedToAdd: ['get_store_hours_and_status']
              }
            }
            const fsPartEs =
              friClose === satClose
                ? `Los viernes y sábados cerramos a las ${friClose}`
                : `El viernes cerramos a las ${friClose} y el sábado a las ${satClose}`
            return {
              replyText: `${fsPartEs}, y mañana ${DAY_NAMES_ES[tomDow].toLowerCase()} abrimos de ${tomOpen} a ${tomClose}. ¿Te ayudo con algo más?`,
              toolsUsedToAdd: ['get_store_hours_and_status']
            }
          }
          if (lang === 'en') {
            const fsSoloEn =
              friOpen === satOpen && friClose === satClose
                ? `On Fridays and Saturdays we are open from ${friOpen} to ${friClose}. Anything else?`
                : `On Friday we are open from ${friOpen} to ${friClose}, and on Saturday from ${satOpen} to ${satClose}. Anything else?`
            return {
              replyText: fsSoloEn,
              toolsUsedToAdd: ['get_store_hours_and_status']
            }
          }
          const fsSoloEs =
            friOpen === satOpen && friClose === satClose
              ? `Los viernes y sábados abrimos de ${friOpen} a ${friClose}. ¿Te ayudo con algo más?`
              : `El viernes abrimos de ${friOpen} a ${friClose} y el sábado de ${satOpen} a ${satClose}. ¿Te ayudo con algo más?`
          return {
            replyText: fsSoloEs,
            toolsUsedToAdd: ['get_store_hours_and_status']
          }
        }
        return null
      }
      if (mentionsWeekend) {
        // Si hoy es sábado o domingo, usar el próximo viernes solo si no está cerrado por festivo distinto; formatear cerrado/abierto con gramática natural
        const friOffset = ptNow.dayOfWeek === 6 ? -1 : (5 - ptNow.dayOfWeek + 7) % 7
        const satOffset = (6 - ptNow.dayOfWeek + 7) % 7
        const sunOffset = (0 - ptNow.dayOfWeek + 7) % 7
        const weeklyMap = normalizeWeeklyHours(store.weekly_hours)
        const getEff = (off: number) => {
          const [yy, mm, dd] = ptNow.dateStr.split('-').map(Number)
          const dt = new Date(Date.UTC(yy, mm - 1, dd + off))
          const dStr = dt.toISOString().slice(0, 10)
          return resolveEffectiveDaySchedule({ storeIdNum: store.id, regular: weeklyMap[dt.getUTCDay()], dateStr: dStr, specialHours: storeSpecial })
        }
        const friEff = getEff(friOffset)
        const satEff = getEff(satOffset)
        const sunEff = getEff(sunOffset)
        const fmtSpan = (eff: ReturnType<typeof resolveEffectiveDaySchedule>) => {
          if (eff.isClosedAllDay) {
            if (lang === 'en') return eff.holidayNameEn ? `closed for ${eff.holidayNameEn}` : 'closed'
            return eff.holidayName ? `cerrado por ${eff.holidayName}` : 'cerrado'
          }
          return lang === 'en'
            ? `from ${formatTime12h(eff.open, 'en')} to ${formatTime12h(eff.close, 'en')}`
            : `de ${formatTime12h(eff.open, 'es')} a ${formatTime12h(eff.close, 'es')}`
        }
        const friSpan = fmtSpan(friEff)
        const satSpan = fmtSpan(satEff)
        const sunSpan = fmtSpan(sunEff)
        if (lang === 'en') {
          const fsText =
            !friEff.isClosedAllDay && !satEff.isClosedAllDay && friSpan === satSpan
              ? `Friday and Saturday we are open ${friSpan}`
              : `Friday we are ${friEff.isClosedAllDay ? friSpan : `open ${friSpan}`}, Saturday ${satEff.isClosedAllDay ? satSpan : `open ${satSpan}`}`
          const sunText = sunEff.isClosedAllDay ? `Sunday we are ${sunSpan}` : `Sunday ${sunSpan}`
          return {
            replyText: `${fsText}, and ${sunText}. Anything else?`,
            toolsUsedToAdd: ['get_store_hours_and_status']
          }
        }
        const fsTextEs =
          !friEff.isClosedAllDay && !satEff.isClosedAllDay && friSpan === satSpan
            ? `Viernes y sábado abrimos ${friSpan}`
            : `El viernes ${friEff.isClosedAllDay ? `estamos ${friSpan}` : `abrimos ${friSpan}`}, el sábado ${satEff.isClosedAllDay ? `estamos ${satSpan}` : `abrimos ${satSpan}`}`
        const sunTextEs = sunEff.isClosedAllDay ? `el domingo estamos ${sunSpan}` : `el domingo abrimos ${sunSpan}`
        return {
          replyText: `${fsTextEs}, y ${sunTextEs}. ¿Algo más?`,
          toolsUsedToAdd: ['get_store_hours_and_status']
        }
      }
      if (mentionsTomorrow) {
        // Regla del día laboral 6:00 AM - 5:59 AM: en la madrugada (00:00-05:59 AM), la próxima apertura de "mañana"
        // corresponde al turno diurno del día calendario actual (offsetDays = 0, ej. viernes 8:00 AM o Thanksgiving)
        const isAfterMidnightBizDay = ptNow.hour < 6 || scheduleEval.isAfterMidnightSpillover
        const tomOffset = isAfterMidnightBizDay ? 0 : 1
        const tomDow = (ptNow.dayOfWeek + tomOffset) % 7
        return {
          replyText: formatCanonicalScheduleForOffsetDay({
            store,
            specialHours: storeSpecial,
            offsetDays: tomOffset,
            explicitDow: tomDow,
            prefixLabelEs: `Mañana ${DAY_NAMES_ES[tomDow].toLowerCase()}`,
            prefixLabelEn: isAfterMidnightBizDay ? `Tomorrow morning (${DAY_NAMES_EN[tomDow]})` : `Tomorrow (${DAY_NAMES_EN[tomDow]})`,
            lang
          }),
          toolsUsedToAdd: ['get_store_hours_and_status']
        }
      }
      const targetDow = weekdayTokens[0].dow
      const offsetDays = (targetDow - ptNow.dayOfWeek + 7) % 7
      return {
        replyText: formatCanonicalScheduleForOffsetDay({
          store,
          specialHours: storeSpecial,
          offsetDays,
          explicitDow: targetDow,
          prefixLabelEs: '',
          prefixLabelEn: '',
          lang
        }),
        toolsUsedToAdd: ['get_store_hours_and_status']
      }
    }
    case 'holidays': {
      const holMatchRe: Array<{ re: RegExp; keyRe: RegExp }> = [
        { re: /\b(thanksgiving|accion de gracias)\b/i, keyRe: /thanksgiving/i },
        { re: /\bblack friday\b/i, keyRe: /black friday/i },
        { re: /\b(nochebuena|christmas eve|24 de diciembre|dec\w* 24)\b/i, keyRe: /nochebuena|christmas eve/i },
        { re: /\b(navidad|christmas(?! eve)|25 de diciembre|dec\w* 25)\b/i, keyRe: /navidad|christmas day/i },
        { re: /\b(fin de ano|new year.?s eve|31 de diciembre|dec\w* 31)\b/i, keyRe: /fin de|new year.?s eve/i },
        { re: /\b(ano nuevo|new year.?s day|1 de enero|jan\w* 1)\b/i, keyRe: /ano nuevo|new year.?s day/i },
        { re: /\b(viernes santo|good friday)\b/i, keyRe: /viernes santo|good friday/i }
      ]
      const matchedHols = holMatchRe.filter((h) => h.re.test(normUser))
      if (matchedHols.length > 1) return null
      const specificHol = matchedHols[0]
      if (specificHol) {
        const foundHol = upcomingHolidays.find((h: any) =>
          specificHol.keyRe.test(normalizeSearchText(`${h.holiday_name_es} ${h.holiday_name_en}`))
        )
        if (foundHol) {
          const holName = lang === 'en' ? foundHol.holiday_name_en : foundHol.holiday_name_es
          if (foundHol.is_closed) {
            const isStoreOnly = foundHol.source === 'store_override'
            return {
              replyText:
                lang === 'en'
                  ? isStoreOnly
                    ? `On ${holName} this location is closed all day. Can I help with anything else?`
                    : `On ${holName} all Tacos Gavilan locations are closed all day. Can I help with anything else?`
                  : isStoreOnly
                    ? `En ${holName} esta sucursal cierra todo el día. ¿Te ayudo con algo más?`
                    : `En ${holName} cerramos todo el día en nuestras sucursales. ¿Te ayudo con algo más?`,
              toolsUsedToAdd: ['get_store_hours_and_status']
            }
          }
          return {
            replyText:
              lang === 'en'
                ? `On ${holName} this location is open from ${formatTime12h(foundHol.effective_open, 'en')} to ${formatTime12h(foundHol.effective_close, 'en')}. Anything else?`
                : `En ${holName} esta sucursal abre de ${formatTime12h(foundHol.effective_open, 'es')} a ${formatTime12h(foundHol.effective_close, 'es')}. ¿Te ayudo con algo más?`,
            toolsUsedToAdd: ['get_store_hours_and_status']
          }
        }
      }
      if (/\b(cinco de mayo|4 de julio|july 4|labor day|dia de las madres|mothers day)\b/i.test(normUser)) {
        const hasMinorOverride = storeSpecial.some((sh: any) =>
          /cinco de mayo|july 4|4 de julio|labor day|madres|mother/i.test(normalizeSearchText(String(sh?.holiday_name || '')))
        )
        if (hasMinorOverride) return null
        return {
          replyText:
            lang === 'en'
              ? 'We operate regular hours on that holiday. Can I help with your store’s hours or menu?'
              : 'Ese día festivo operamos en horario normal en todas nuestras sucursales. ¿Te ayudo con algo más?',
          toolsUsedToAdd: ['get_store_hours_and_status']
        }
      }
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'hours', /festivos/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'We only adjust hours on 7 holidays a year: closed Good Friday and Christmas Day; closing at 4:00 PM on Thanksgiving, Christmas Eve, and New Year’s Eve; and opening at 11:00 AM on New Year’s Day and Black Friday. Anything else?'
            : 'Solo modificamos horario 7 fechas al año: cerramos Viernes Santo y Navidad 25 de diciembre; cerramos a las 4:00 PM en Thanksgiving, Nochebuena y Fin de Año; y abrimos a las 11:00 AM en Año Nuevo y Black Friday. ¿Te ayudo con algo más?',
        toolsUsedToAdd: ['get_store_hours_and_status']
      }
    }
    case 'address_phone': {
      const asksPhone = /\b(telefono|numero de telefono|numero de la tienda|phone number|store number)\b/i.test(normUser)
      if (asksPhone && store.phone) {
        return {
          replyText:
            lang === 'en'
              ? `Our store phone number is ${store.phone}, and we are located at ${spokenStoreAddress}${customerBranchCrossStreets ? `, at the corner of ${customerBranchCrossStreets}` : ''}. Anything else?`
              : `El teléfono de esta sucursal es ${store.phone} y estamos en ${spokenStoreAddress}${customerBranchCrossStreets ? `, en la esquina de ${customerBranchCrossStreets}` : ''}. ¿Te ayudo con algo más?`
        }
      }
      return {
        replyText:
          lang === 'en'
            ? `We are located at ${spokenStoreAddress}${customerBranchCrossStreets ? `, at the corner of ${customerBranchCrossStreets}` : ''}. How else can I help you?`
            : `Estamos ubicados en ${spokenStoreAddress}${customerBranchCrossStreets ? `, en la esquina de ${customerBranchCrossStreets}` : ''}. ¿Te puedo ayudar con algo más?`
      }
    }
    case 'drive_thru':
      if (asksWhichDriveThruStores && allActiveStores.length > 0) {
        const dtNames = [...allActiveStores]
          .filter((s) => s.has_drive_thru)
          .sort((a, b) => Number(a.id) - Number(b.id))
          .map((s) => formatCustomerStoreName(s, lang, { style: 'spoken_compact' }))
        const dtListEs =
          dtNames.length > 1 ? `${dtNames.slice(0, -1).join(', ')} y ${dtNames[dtNames.length - 1]}` : dtNames.join(', ')
        const dtListEn =
          dtNames.length > 1 ? `${dtNames.slice(0, -1).join(', ')}, and ${dtNames[dtNames.length - 1]}` : dtNames.join(', ')
        return {
          replyText:
            lang === 'en'
              ? `Our six locations with Drive-Thru are ${dtListEn}. Would you like hours or address for any of them?`
              : `Las seis sucursales con Drive-Thru son ${dtListEs}. ¿Te doy el horario o dirección de alguna?`
        }
      }
      return {
        replyText:
          lang === 'en'
            ? store.has_drive_thru
              ? 'We have Drive-Thru service at this location. How else can I help you?'
              : 'We do not have a Drive-Thru at this location, but we gladly serve you for dine-in and takeout. How else can I help you?'
            : store.has_drive_thru
              ? 'Contamos con servicio de Drive-Thru en esta sucursal. ¿Te puedo ayudar con algo más?'
              : 'En esta ubicación no contamos con Drive-Thru, pero te atendemos con gusto en comedor y para llevar. ¿Te puedo ayudar con algo más?'
      }
    case 'payments_ebt':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'payments', /formas de pago/i)) return null
      return {
        replyText:
          lang === 'en'
            ? config.accepts_ebt
              ? 'We accept cash, credit and debit cards, Apple Pay, Google Pay, and EBT CalFresh at the register. How else can I help you?'
              : 'We accept cash, credit and debit cards, Apple Pay, and Google Pay; EBT CalFresh is not available at this location. How else can I help you?'
            : config.accepts_ebt
              ? 'Aceptamos efectivo, tarjetas, Apple Pay, Google Pay y también tarjeta EBT CalFresh directamente en caja. ¿Te ayudo con algo más?'
              : 'Aceptamos efectivo, tarjetas de débito o crédito, Apple Pay y Google Pay; en esta sucursal no contamos con EBT CalFresh. ¿Te ayudo con algo más?'
      }
    case 'job_inquiry':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'employment', /empleo/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'You can apply in person with the store manager at any of our 15 locations, or submit your information at tacosgavilan.com/contact. Anything else?'
            : 'Puedes acudir en persona con el gerente a cualquiera de nuestras 15 sucursales para llenar solicitud, o enviar tus datos en tacosgavilan.com/contact. ¿Algo más?'
      }
    case 'delivery_driver':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'delivery', /repartidores/i)) return null
      return {
        replyText:
          lang === 'en'
            ? store.has_drive_thru
              ? 'Uber Eats, DoorDash, and Grubhub drivers pick up at the counter by showing the customer name and code, or via the Drive-Thru window once the dining room closes. Anything else?'
              : 'This location does not have a Drive-Thru, so Uber Eats, DoorDash, and Grubhub drivers pick up at the counter during open hours by showing the customer name and order code. Anything else?'
            : store.has_drive_thru
              ? 'Los repartidores de Uber Eats, DoorDash y Grubhub recogen en el mostrador mostrando el nombre y código del cliente; si el comedor ya cerró pero seguimos abiertos, pasan por el Drive-Thru. ¿Algo más?'
              : 'En esta sucursal no tenemos Drive-Thru, así que todos los repartidores de Uber Eats, DoorDash y Grubhub recogen en mostrador dentro de nuestro horario mostrando nombre y código. ¿Algo más?'
      }
    case 'delivery_app_modify':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'delivery', /cambios o cancelaciones/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'Because your order was paid through the delivery app, the restaurant cannot edit paid items or change the delivery address. Please modify or cancel it directly in the Help section of your app. Anything else?'
            : 'Como tu pedido se pagó directo en la aplicación, la sucursal no puede modificar platillos con costo ni cambiar la dirección. Debes ajustarlo o cancelarlo desde la sección Ayuda de tu app. ¿Algo más?'
      }
    case 'aguas_drinks':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'menu', /aguas frescas/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'We serve fresh Horchata, Jamaica, Pineapple, and Tamarind aguas frescas in 22, 32, and 128 oz gallons, plus 16 oz hot Coffee and Champurrado and a 96 oz Champurrado box. Anything else?'
            : 'Tenemos aguas frescas naturales de Horchata, Jamaica, Piña y Tamarindo en 22 onzas, 32 onzas y galón de 128 onzas, además de Champurrado y Café en 16 onzas y caja de 96 onzas. ¿Algo más?'
      }
    case 'desserts': {
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'menu', /postres oficiales/i)) return null
      const findLivePriceNum = (re: RegExp): number | null => {
        const hit = liveMenuItems.find((m: any) => re.test(String(m?.name || '')) && Number.isFinite(Number(m?.price)) && Number(m?.price) > 0)
        return hit ? Number(hit.price) : null
      }
      const flanP = findLivePriceNum(/\bflan\b/i)
      const cheeseP = findLivePriceNum(/\bcheesecake\b/i)
      const flanEs = flanP !== null ? ` ($${flanP.toFixed(2)} dólares)` : ''
      const cheeseEs = cheeseP !== null ? ` ($${cheeseP.toFixed(2)} dólares)` : ''
      const flanEn = flanP !== null ? ` ($${flanP.toFixed(2)})` : ''
      const cheeseEn = cheeseP !== null ? ` ($${cheeseP.toFixed(2)})` : ''
      return {
        replyText:
          lang === 'en'
            ? `We do not sell birthday cakes, whole cakes, or churros. For dessert we only offer individual Flan${flanEn} and Cheesecake${cheeseEn}. How else can I help you?`
            : `No vendemos pasteles de cumpleaños ni churros. De postre solo ofrecemos Flan${flanEs} y Cheesecake${cheeseEs} individuales. ¿Te puedo ayudar con algo más?`
      }
    }
    case 'meats_list':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'menu', /variedad de carnes/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'We serve Carne Asada, Al Pastor, Chicken, Cabeza, Tongue, Buche, Chorizo, and Carnitas, with freshly made salsas and tortillas daily. Would you like any prices?'
            : 'Manejamos Carne Asada, Al Pastor, Pollo, Cabeza, Lengua, Buche, Chorizo y Carnitas, con tortillas y salsas frescas todos los días. ¿Te ayudo con algún precio?'
      }
    case 'regular_vs_super':
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'menu', /regular y super/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'For quesadillas and mulitas, Super adds guacamole and sour cream. For burritos, Super adds Monterey Jack cheese, guacamole, and sour cream to the meat, rice, and beans. Anything else?'
            : 'En quesadillas y mulitas, la Super añade guacamole y crema. En burritos, el Super Burrito añade queso Monterey Jack, guacamole y crema además de carne, arroz y frijol. ¿Algo más?'
      }
    case 'torta_info':
      if (/\bcubana\b/i.test(normUser)) {
        if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'menu', /torta cubana/i)) return null
        return {
          replyText:
            lang === 'en'
              ? 'Our Torta Cubana comes with breaded steak, ham, and wiener sausage on a telera roll with Queso Fresco, beans, avocado, lettuce, tomato, and mayo, with no sour cream or melted cheese. Anything else?'
              : 'Nuestra Torta Cubana lleva milanesa de res, jamón y salchicha en telera con Queso Fresco, frijoles, guacamole, lechuga, tomate y mayonesa, sin crema ni queso fundido. ¿Algo más?'
        }
      }
      if (!isGlobalKbTopicCanonicalUntouched(knowledgeBase, store.id, 'menu', /ingredientes, quesos/i)) return null
      return {
        replyText:
          lang === 'en'
            ? 'Our tortas come with sliced Queso Fresco, beans, avocado, lettuce, tomato, and mayo, and never include sour cream or melted cheese. Anything else?'
            : 'Las tortas llevan Queso Fresco en rebanada, frijol, guacamole, lechuga, tomate y mayonesa; jamás llevan crema ni queso fundido. ¿Te ayudo con algo más?'
      }
    case 'unsupported_items': {
      const hasMenuStoreOverride = knowledgeBase.some(
        (k: any) => k?.is_active !== false && Number(k?.store_id) === Number(store.id) && String(k?.category || '').toLowerCase() === 'menu'
      )
      if (hasMenuStoreOverride) return null
      return {
        replyText:
          lang === 'en'
            ? 'I apologize, we do not serve menudo, birria, pozole, suadero, tripa, or alcoholic beverages. We gladly offer our 8 meats and fresh aguas frescas instead. Anything else?'
            : 'Disculpa, por el momento no manejamos menudo, birria, pozole, suadero, tripa ni bebidas alcohólicas. Con gusto te ofrecemos nuestras 8 carnes y aguas frescas. ¿Algo más?'
      }
    }
    case 'fiesta_platters': {
      const hasCateringStoreOverride = knowledgeBase.some(
        (k: any) => k?.is_active !== false && Number(k?.store_id) === Number(store.id) && String(k?.category || '').toLowerCase() === 'catering'
      )
      if (hasCateringStoreOverride || !platterInfo) return null
      const baseRec = lang === 'en' ? platterInfo.recommendationEn : platterInfo.recommendationEs
      return {
        replyText: `${baseRec} ${lang === 'en' ? 'Anything else?' : '¿Te ayudo con algo más?'}`,
        toolsUsedToAdd: ['get_fiesta_platter_packages']
      }
    }
    default:
      return null
  }
}

/**
 * Devuelve la lista de locuciones canónicas estáticas (bilingües) para pre-calentamiento en Supabase Storage (`phone_v6/Kore`),
 * de modo que al atender llamadas reales suenen con latencia ~0-90 ms desde caché sin esperar síntesis TTS en vivo.
 */
export function getStaticCanonicalWarmPhrases(): Array<{ text: string; lang: PhoneLang }> {
  const staticPairs: Array<[string, string]> = [
    ['Con gusto. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!', 'You are very welcome! Thank you for calling Tacos Gavilan, have a wonderful day!'],
    ['Agradecemos tu llamada, pero en esta sucursal no recibimos ofertas comerciales ni servicios externos. ¡Que tengas excelente día!', 'Thank you for calling, however we do not accept commercial solicitations at this location. Have a great day!'],
    ['Disculpa, no tomamos órdenes por teléfono. Puedes hacer tu pedido fácilmente en tacosgavilan.com para pasar a recoger, o pedir directamente en caja o por el Drive-Thru. ¿Te ayudo con algo más?', 'I apologize, we do not take orders over the phone. You can easily place your order at tacosgavilan.com for pickup, or directly at the counter or Drive-Thru. How else can I help you?'],
    ['Disculpa, no tomamos órdenes por teléfono. Puedes hacer tu pedido fácilmente en tacosgavilan.com para pasar a recoger, o pedir directamente en caja. ¿Te ayudo con algo más?', 'I apologize, we do not take orders over the phone. You can easily place your order at tacosgavilan.com for pickup, or directly at the counter. How else can I help you?'],
    ['Aceptamos efectivo, tarjetas, Apple Pay, Google Pay y también tarjeta EBT CalFresh directamente en caja. ¿Te ayudo con algo más?', 'We accept cash, credit and debit cards, Apple Pay, Google Pay, and EBT CalFresh at the register. How else can I help you?'],
    ['Aceptamos efectivo, tarjetas de débito o crédito, Apple Pay y Google Pay; en esta sucursal no contamos con EBT CalFresh. ¿Te ayudo con algo más?', 'We accept cash, credit and debit cards, Apple Pay, and Google Pay; EBT CalFresh is not available at this location. How else can I help you?'],
    ['Puedes acudir en persona con el gerente a cualquiera de nuestras 15 sucursales para llenar solicitud, o enviar tus datos en tacosgavilan.com/contact. ¿Algo más?', 'You can apply in person with the store manager at any of our 15 locations, or submit your information at tacosgavilan.com/contact. Anything else?'],
    ['Los repartidores de Uber Eats, DoorDash y Grubhub recogen en el mostrador mostrando el nombre y código del cliente; si el comedor ya cerró pero seguimos abiertos, pasan por el Drive-Thru. ¿Algo más?', 'Uber Eats, DoorDash, and Grubhub drivers pick up at the counter by showing the customer name and code, or via the Drive-Thru window once the dining room closes. Anything else?'],
    ['En esta sucursal no tenemos Drive-Thru, así que todos los repartidores de Uber Eats, DoorDash y Grubhub recogen en mostrador dentro de nuestro horario mostrando nombre y código. ¿Algo más?', 'This location does not have a Drive-Thru, so Uber Eats, DoorDash, and Grubhub drivers pick up at the counter during open hours by showing the customer name and order code. Anything else?'],
    ['Como tu pedido se pagó directo en la aplicación, la sucursal no puede modificar platillos con costo ni cambiar la dirección. Debes ajustarlo o cancelarlo desde la sección Ayuda de tu app. ¿Algo más?', 'Because your order was paid through the delivery app, the restaurant cannot edit paid items or change the delivery address. Please modify or cancel it directly in the Help section of your app. Anything else?'],
    ['Lamento el inconveniente. Para revisar la preparación de tu orden, ¿me das tu número de ticket, fecha, nombre y teléfono? Sin el ticket es poco probable determinar la equivocación.', 'I apologize for the inconvenience. To review how your order was prepared, may I have your ticket number, date, name, and phone number? Without the ticket, it is unlikely we can verify the mistake.'],
    ['El traslado depende del repartidor en tu app. Si lleva mucho tiempo esperando repartidor, ¿me das tu nombre, teléfono de 10 dígitos y código de orden para revisar en mostrador si sigue aquí?', 'Delivery transit is handled by your app driver. If it has been waiting too long for pickup, may I have your name, 10-digit phone, and order code so we can check the counter?'],
    ['Lamento el inconveniente. Por favor repórtalo en la sección Ayuda de tu app para tu reembolso o crédito. Si gustas avisar al gerente, ¿me das tu nombre, teléfono de 10 dígitos y código de orden?', 'I apologize for that. Please report it in the Help section of your app for your refund or credit. If you also want to alert the manager, may I have your name, 10-digit phone, and order code?'],
    ['Con gusto envío nota de empaque para incluirlos siempre que tu orden aún no haya salido. ¿Me das tu nombre, número de orden, qué condimentos deseas y tu teléfono de 10 dígitos?', 'I can send a packing note to include them as long as your order has not left yet. May I have your name, order number, which condiments you need, and your 10-digit phone number?'],
    ['No podemos mover órdenes pagadas entre tiendas. Si fue por app, cancélala de inmediato en tu app; si fue en tacosgavilan.com, ¿en qué sucursal cayó y cuál es tu nombre, teléfono y número de orden?', 'Paid orders cannot be moved between stores. For app orders please cancel right away in the app; for tacosgavilan.com pickup, which store did it go to, and what is your name, phone, and order number?'],
    ['Tenemos aguas frescas naturales de Horchata, Jamaica, Piña y Tamarindo en 22 onzas, 32 onzas y galón de 128 onzas, además de Champurrado y Café en 16 onzas y caja de 96 onzas. ¿Algo más?', 'We serve fresh Horchata, Jamaica, Pineapple, and Tamarind aguas frescas in 22, 32, and 128 oz gallons, plus 16 oz hot Coffee and Champurrado and a 96 oz Champurrado box. Anything else?'],
    ['Manejamos Carne Asada, Al Pastor, Pollo, Cabeza, Lengua, Buche, Chorizo y Carnitas, con tortillas y salsas frescas todos los días. ¿Te ayudo con algún precio?', 'We serve Carne Asada, Al Pastor, Chicken, Cabeza, Tongue, Buche, Chorizo, and Carnitas, with freshly made salsas and tortillas daily. Would you like any prices?'],
    ['En quesadillas y mulitas, la Super añade guacamole y crema. En burritos, el Super Burrito añade queso Monterey Jack, guacamole y crema además de carne, arroz y frijol. ¿Algo más?', 'For quesadillas and mulitas, Super adds guacamole and sour cream. For burritos, Super adds Monterey Jack cheese, guacamole, and sour cream to the meat, rice, and beans. Anything else?'],
    ['Nuestra Torta Cubana lleva milanesa de res, jamón y salchicha en telera con Queso Fresco, frijoles, guacamole, lechuga, tomate y mayonesa, sin crema ni queso fundido. ¿Algo más?', 'Our Torta Cubana comes with breaded steak, ham, and wiener sausage on a telera roll with Queso Fresco, beans, avocado, lettuce, tomato, and mayo, with no sour cream or melted cheese. Anything else?'],
    ['Las tortas llevan Queso Fresco en rebanada, frijol, guacamole, lechuga, tomate y mayonesa; jamás llevan crema ni queso fundido. ¿Te ayudo con algo más?', 'Our tortas come with sliced Queso Fresco, beans, avocado, lettuce, tomato, and mayo, and never include sour cream or melted cheese. Anything else?'],
    ['Disculpa, por el momento no manejamos menudo, birria, pozole, suadero, tripa ni bebidas alcohólicas. Con gusto te ofrecemos nuestras 8 carnes y aguas frescas. ¿Algo más?', 'I apologize, we do not serve menudo, birria, pozole, suadero, tripa, or alcoholic beverages. We gladly offer our 8 meats and fresh aguas frescas instead. Anything else?'],
    ['Contamos con servicio de Drive-Thru en esta sucursal. ¿Te puedo ayudar con algo más?', 'We have Drive-Thru service at this location. How else can I help you?'],
    ['En esta ubicación no contamos con Drive-Thru, pero te atendemos con gusto en comedor y para llevar. ¿Te puedo ayudar con algo más?', 'We do not have a Drive-Thru at this location, but we gladly serve you for dine-in and takeout. How else can I help you?'],
    ['Las seis sucursales con Drive-Thru son West Covina, Los Ángeles (Central y Washington), La Puente, Norwalk, Lynwood y South Gate. ¿Te doy el horario o dirección de alguna?', 'Our six locations with Drive-Thru are West Covina, Los Angeles (Central and Washington), La Puente, Norwalk, Lynwood, and South Gate. Would you like hours or address for any of them?']
  ]
  const out: Array<{ text: string; lang: PhoneLang }> = []
  for (const [esText, enText] of staticPairs) {
    out.push({ text: esText, lang: 'es' })
    out.push({ text: enText, lang: 'en' })
  }
  return out
}

export async function processPhoneAgentTurn(params: {
  callSid: string
  storeId: number
  userText: string
  source?: 'twilio' | 'simulator'
  callerNumber?: string | null
  toNumber?: string | null
  forwardedFrom?: string | null
  preferredLang?: PhoneLang
  deferDbFlush?: boolean
}): Promise<{
  callId: string
  replyText: string
  language: PhoneLang
  voiceId: VoiceId
  primaryIntent: string
  toolsUsed: string[]
  callbackCreated: any | null
  shouldTransferToPhone: string | null
  shouldHangup: boolean
  isCanonicalReply?: boolean
  transcript: TranscriptEntry[]
  storeContext: Awaited<ReturnType<typeof getStorePhoneContext>>
  flushDbPromise?: Promise<void>
}> {
  const {
    callSid,
    storeId,
    userText,
    source = 'simulator',
    callerNumber = null,
    toNumber = null,
    forwardedFrom = null,
    preferredLang,
    deferDbFlush = false
  } = params

  const turnStartedAt = Date.now()
  const turnBudgetMs = source === 'twilio' ? 11200 : 12800
  const turnDeadline = turnStartedAt + turnBudgetMs

  // Ejecutar TODAS las lecturas iniciales en paralelo (incluyendo pool de llaves Gemini y menú pre-compilado en caché SWR)
  const [ctx, existingCallRes, menuEntry, allActiveStores] = await Promise.all([
    getStorePhoneContext(storeId),
    supabaseAdmin.from('phone_calls').select('*').eq('call_sid', callSid).maybeSingle(),
    loadStoreMenuEntry(storeId),
    loadAllActiveStoresDirectory(),
    getGeminiKeyPoolWithRemote()
  ])
  const liveMenuItems = menuEntry.items

  const { store, config, scheduleEval, knowledgeBase, onlineOrderUrl } = ctx
  const voiceId: VoiceId = resolvePhoneFemaleVoice(config.voice_id)

  // 1. Obtener o iniciar en paralelo la creación del registro en `phone_calls` (sin bloquear el arranque de Gemini)
  const businessDate = getCaliforniaBusinessDate()
  const shift = getCaliforniaShift()
  const defaultCallLang: PhoneLang = (preferredLang || config.default_language || 'es') as PhoneLang

  if (existingCallRes.error) {
    throw existingCallRes.error
  }

  let callRecord: any = existingCallRes.data
  let ensureCallRecordPromise: Promise<any> | null = null

  if (callRecord) {
    const reconciledExisting = await reconcileCallWithTerminalTombstone(callSid)
    if (reconciledExisting) {
      callRecord = reconciledExisting
    }
  }

  if (!callRecord) {
    const initialGreeting = buildInitialGreeting(
      store.name,
      defaultCallLang,
      config.custom_greeting_es,
      config.custom_greeting_en,
      { scheduleEval }
    )
    const initialTranscript: TranscriptEntry[] = [
      {
        role: 'assistant',
        text: initialGreeting,
        timestamp: new Date().toISOString()
      }
    ]
    ensureCallRecordPromise = (async () => {
      const { error: createErr } = await supabaseAdmin
        .from('phone_calls')
        .upsert(
          {
            call_sid: callSid,
            store_id: store.id,
            source,
            caller_number: callerNumber,
            to_number: toNumber,
            forwarded_from: forwardedFrom,
            language: defaultCallLang,
            status: 'in_progress',
            turns_count: 0,
            transcript: initialTranscript,
            business_date: businessDate,
            shift
          },
          { onConflict: 'call_sid', ignoreDuplicates: true }
        )
      if (createErr) throw createErr
      const { data: ensuredRow, error: fetchEnsuredErr } = await supabaseAdmin
        .from('phone_calls')
        .select('*')
        .eq('call_sid', callSid)
        .single()
      if (fetchEnsuredErr || !ensuredRow) throw fetchEnsuredErr || new Error('No se encontró la llamada tras upsert')
      const reconciled = await reconcileCallWithTerminalTombstone(callSid)
      callRecord = reconciled || ensuredRow
      return callRecord
    })()
    void ensureCallRecordPromise.catch(() => null)
  }

  const ensureCallRecord = async () => {
    if (callRecord) return callRecord
    if (ensureCallRecordPromise) return await ensureCallRecordPromise
    throw new Error('No se pudo inicializar el registro de la llamada')
  }

  const seedTranscript: TranscriptEntry[] = callRecord
    ? Array.isArray(callRecord.transcript)
      ? [...callRecord.transcript]
      : []
    : [
        {
          role: 'assistant',
          text: buildInitialGreeting(store.name, defaultCallLang, config.custom_greeting_es, config.custom_greeting_en, {
            scheduleEval
          }),
          timestamp: new Date().toISOString()
        }
      ]

  const transcript: TranscriptEntry[] = seedTranscript
  transcript.push({
    role: 'user',
    text: userText,
    timestamp: new Date().toISOString()
  })

  // Idioma de la llamada: el que ya venía en la bitácora (persistido turno a turno) o el default de la tienda.
  const callLang: PhoneLang = callRecord?.language === 'en' ? 'en' : callRecord?.language === 'es' ? 'es' : defaultCallLang
  const normalizedUserForMatch = normalizePhoneSttTranscript(userText)
  // Detectar si el cliente pidió o habló claramente en otro idioma evitando falsos flips en frases cortas mixtas
  const turnLangGuess: PhoneLang = detectCallerLanguageSwitch(userText, preferredLang || callLang)

  // Contexto combinado con el último turno de usuario si hace repregunta corta ("¿y qué lleva?", "¿y en súper?", "¿y para 65?")
  const prevUserTexts = transcript
    .slice(0, -1)
    .filter((t) => t.role === 'user')
    .slice(-2)
    .map((t) => normalizePhoneSttTranscript(t.text))
  const combinedMenuQuery =
    normalizedUserForMatch.split(/\s+/).length <= 7 && prevUserTexts.length > 0
      ? `${prevUserTexts[prevUserTexts.length - 1]} ${normalizedUserForMatch}`
      : normalizedUserForMatch
  const preFetchedMenu = rankMenuItemsForPrompt(liveMenuItems, combinedMenuQuery, 12)

  const allUserTurnsText = transcript
    .filter((t) => t.role === 'user')
    .map((t) => normalizePhoneSttTranscript(t.text))
    .join(' ')
  const normAllUserForScope = normalizeSearchText(allUserTurnsText)
  const normCombinedForScope = normalizeSearchText(`${prevUserTexts.join(' ')} ${normalizedUserForMatch}`)
  const wantsHolidayContext =
    Boolean(scheduleEval.isSpecialHolidaySchedule) ||
    /\b(festiv|holiday|navidad|nochebuena|christmas|thanksgiving|accion de gracias|black friday|fin de ano|ano nuevo|new year|viernes santo|jueves santo|sabado de gloria|semana santa|good friday|pascua|easter|cinco de mayo|madres|mothers|padre|father|julio|july|labor|memorial|septiembre|halloween|dia de muertos|guadalupe|especial|24 de diciembre|25 de diciembre|31 de diciembre|1 de enero|december 24|december 25|december 31|january 1)\b/i.test(
      normCombinedForScope
    )
  const ownCleanNameNorm = normalizeSearchText(cleanPhoneStoreName(store.name))
  const mentionsForeignCityOrBranch =
    inferMentionedOtherStore(allActiveStores, store.id, normAllUserForScope) !== null ||
    (/\b(covina|azusa|broadway|vernon|washington|central|slauson|hollywood|santa ana|la puente|huntington|norwalk|bell|lynwood|south gate|downey|rialto)\b/i.test(
      normAllUserForScope
    ) &&
      (!ownCleanNameNorm || !normAllUserForScope.includes(ownCleanNameNorm) || /\b(otra|otras|other|equivocad[oa]|wrong)\b/i.test(normAllUserForScope)))
  const wantsMultiStoreContext =
    mentionsForeignCityOrBranch ||
    /\b(otra sucursal|otra tienda|otras sucursales|otras tiendas|otras ubicaciones|sucursal equivocad[oa]|tienda equivocad[oa]|wrong store|wrong location|other store|other location|closest|nearest|earliest|latest|all stores|all locations|which store|which location|cual(?:es)? (?:sucursal|tienda|tienen)|cerca|zonas?|east la|este de los angeles|south la|sur de los angeles|downtown|sgv|san gabriel|orange|inland|cierra mas|abre mas|todas las sucursales|cuantas sucursales)\b/i.test(
      normAllUserForScope
    )
  const wantsMenuCatalogContext =
    preFetchedMenu.length > 0 ||
    /\b(precio|precios|cuesta|cuanto|vale|a como|menu|comer|platillo|combo|combos|taco|burrito|mulita|quesadilla|torta|plato|sope|nacho|chips|totopos|bebida|agua|soda|refresco|coca|sprite|fanta|champurrado|cafe|coffee|flan|cheesecake|postre|postres|dessert|desserts|pastel|pasteles|cake|cakes|churro|churros|desayuno|breakfast|huevo|carne|asada|pastor|pollo|lengua|cabeza|buche|chorizo|carnitas|menudo|birria|pozole|suadero|tripa|cerveza|alcohol|beer|queso|crema|guacamole|tortillas?|ingredient|lleva|diferencia|regular|super|vegetar|alerg|frijol|arroz|oz|onza|galon)\b/i.test(
      normCombinedForScope
    )

  const prevAssistantForTurn =
    transcript
      .slice(0, -1)
      .filter((t) => t.role === 'assistant')
      .slice(-1)[0]?.text || ''
  const normUserForKbScope = normalizeSearchText(normalizedUserForMatch)
  const isCallbackOrPostOrderTopic =
    isPromptExpectingPhoneOrDetails(prevAssistantForTurn) ||
    /\b(soy empleado|empleada|llegar tarde|mi turno|falto|faltaron|incompleta|equivocad|no ha llegado|retras|modificar|cambiar|cancelar|condimento|cilantro|cebolla|limon|jalapeno|servilleta|tenedor|cubierto|sucursal equivocada|wrong store|wrong location|wrong order|missing|ticket|recibo|receipt|queja|complaint|reembolso|refund|cobro|cobraron|overcharged|olvide|perdi|lost|left my|forgot my|calling in sick|running late|delayed|never arrived|vendor|proveedor|tecnico|technician|gerente|manager|uber|doordash|grubhub|postmates|repartidor|contratando|empleo|vacantes|trabajo)\b/i.test(
      normAllUserForScope
    )

  // 2. Podado contextual seguro de KB: reduce ~35-45% tokens de entrada en turnos de IA sin omitir overrides locales ni reglas editadas
  const kbFiltered = knowledgeBase.filter((rule: any) => {
    if (rule.store_id) return true
    const updMs = rule.updated_at ? Date.parse(String(rule.updated_at)) : 0
    if (Number.isFinite(updMs) && updMs > CANONICAL_KB_EPOCH_MS) return true
    const cat = String(rule.category || '').toLowerCase()
    if (cat === 'catering' && /fiesta platter/i.test(String(rule.title || ''))) return false
    if (wantsMenuCatalogContext && !isCallbackOrPostOrderTopic) {
      return cat === 'menu' || cat === 'payments' || cat === 'catering' || (cat === 'policies' && /pedidos por tel/i.test(String(rule.title || '')))
    }
    if (isCallbackOrPostOrderTopic && !wantsMenuCatalogContext) {
      return cat === 'policies' || cat === 'delivery' || cat === 'staff' || cat === 'employment'
    }
    if (!wantsMenuCatalogContext && !isCallbackOrPostOrderTopic && !wantsHolidayContext && /\b(torta|super|queso|postre|aguas)\b/i.test(normUserForKbScope) === false) {
      return cat !== 'menu'
    }
    return true
  })
  const kbFormatted = kbFiltered
    .map((rule: any, idx: number) => {
      const ruleText =
        turnLangGuess === 'en' && rule.answer_en && String(rule.answer_en).trim()
          ? String(rule.answer_en).trim()
          : String(rule.answer_es || '').trim()
      return `${idx + 1}. [${rule.category.toUpperCase()}${rule.store_id ? ` - SOLO ${formatCustomerStoreName(store, turnLangGuess, { style: 'display' })}` : ' - GLOBAL'}] ${rule.title}: ${ruleText}`
    })
    .join('\n')

  const hadPriorCallbackInCall =
    callRecord?.status === 'callback_requested' ||
    callRecord?.status === 'transferred' ||
    (Array.isArray(callRecord?.transcript) &&
      callRecord.transcript.some(
        (t: any) => t?.role === 'tool' && t?.toolName === 'create_manager_callback' && String(t?.text || '').includes('"success":true')
      ))
  const normPrevUsersOnly = normalizeSearchText(
    transcript
      .slice(0, -1)
      .filter((t) => t.role === 'user')
      .map((t) => normalizePhoneSttTranscript(t.text))
      .join(' ')
  )
  const hadPriorPostOrderTurn =
    hadPriorCallbackInCall ||
    /\b(soy empleado|empleada|llegar tarde|mi turno|falto|faltaron|incomplet[oa]s?|equivocad[oa]s?|equivocaron|orden mal|pedido mal|me dieron mal|wrong order|missing|no ha llegado|retras[oa]?(?:d[oa]s?)?|modificar|cambiar|cancelar|condimento|cilantro|cebolla|limon|jalapeno|servilleta|tenedor|cubierto|sucursal equivocada|wrong store|wrong location|ticket|recibo|queja|reembolso|olvide|perdi|gerente|manager|uber|doordash|grubhub)\b/i.test(
      normPrevUsersOnly
    )

  // Fecha calendario exacta en California (para no confundir hoy/mañana con festivos de fechas futuras)
  const ptNow = getPacificDateParts()
  const [calY, calM, calD] = ptNow.dateStr.split('-').map(Number)
  const tomorrowUtc = new Date(Date.UTC(calY, calM - 1, calD + 1))
  const tomorrowDateStr = tomorrowUtc.toISOString().slice(0, 10)
  const tomorrowDow = (ptNow.dayOfWeek + 1) % 7
  const todayDayLabelEs = DAY_NAMES_ES[ptNow.dayOfWeek]
  const tomorrowDayLabelEs = DAY_NAMES_ES[tomorrowDow]

  // Días festivos próximos (anclado al día calendario en California ptNow.dateStr, límite exacto 365 días para incluir las 7 fechas oficiales)
  const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
    storeId: store.id,
    weeklyHours: store.weekly_hours,
    specialHours: ctx.specialHours || [],
    fromDateStr: ptNow.dateStr,
    daysAhead: 365
  })
  const todayHoliday = upcomingHolidays.find((h) => h.event_date === ptNow.dateStr) || null
  const tomorrowHoliday = upcomingHolidays.find((h) => h.event_date === tomorrowDateStr) || null
  const todayHolName = todayHoliday ? (turnLangGuess === 'en' ? todayHoliday.holiday_name_en : todayHoliday.holiday_name_es) : ''
  const tomHolName = tomorrowHoliday ? (turnLangGuess === 'en' ? tomorrowHoliday.holiday_name_en : tomorrowHoliday.holiday_name_es) : ''
  const calendarDateLine = `- Fecha calendario actual en California: HOY es ${todayDayLabelEs} ${ptNow.dateStr} (${todayHoliday ? `SÍ es festivo: ${todayHolName}` : 'día normal SIN horario festivo'}) | MAÑANA es ${tomorrowDayLabelEs} ${tomorrowDateStr} (${tomorrowHoliday ? `SÍ es festivo: ${tomHolName}` : 'día normal SIN horario festivo; aplica horario semanal regular'}).`

  const holidaysContextLine = wantsHolidayContext || Boolean(todayHoliday || tomorrowHoliday)
    ? upcomingHolidays.length > 0
      ? `- Horarios Especiales / 7 Fechas Oficiales Festivas de ${formatCustomerStoreName(store, turnLangGuess, { style: 'display' })}: ` +
        upcomingHolidays
          .slice(0, 7)
          .map((h) => {
            const label = turnLangGuess === 'en' ? h.holiday_name_en : h.holiday_name_es
            const relTag =
              h.event_date === ptNow.dateStr
                ? ' [HOY]'
                : h.event_date === tomorrowDateStr
                  ? ' [MAÑANA]'
                  : ' [FUTURA]'
            if (h.is_closed) {
              return `${h.event_date} (${label}): CERRADO TODO EL DÍA${relTag}`
            }
            const note = h.is_early_close_only
              ? ' [cierre temprano]'
              : h.is_late_open_only
                ? ' [apertura tarde]'
                : ' [horario especial]'
            return `${h.event_date} (${label}): ${formatTime12h(h.effective_open, turnLangGuess)} a ${formatTime12h(h.effective_close, turnLangGuess)}${note}${relTag}`
          })
          .join(' | ') +
        `\n  (Regla obligatoria si preguntan por festivos en general: menciona las 3 categorías completas — Cerrado todo el día: Viernes Santo y Navidad 25 dic; Cierre temprano 4:00 PM: Thanksgiving, Nochebuena 24 dic y Fin de Año 31 dic; Apertura tarde 11:00 AM: Año Nuevo 1 ene y Viernes después de Thanksgiving/Black Friday. Todos los demás festivos —Super Bowl, Pascua, Cinco de Mayo, Día de las Madres, 4 de Julio, Labor Day, 15/16 Sep— operan en horario regular).`
      : `- Horarios Especiales: aplica el horario semanal regular.`
    : ''

  const asksBroadMenuList =
    preFetchedMenu.length < 3 ||
    /\b(menu|todo|demas|otros|otra|what else|opciones|variedad|bebidas|platillos|desayunos|combos|tamanos)\b/i.test(normUserForKbScope)
  // Catálogo en vivo compilado 1 sola vez en caché SWR; se omite si preFetchedMenu ya cubrió el platillo exacto para acelerar TTFT
  const asksPriceExplicitly = /\b(precio|precios|cuesta|cuanto|vale|a como|how much|price|cost|menu)\b/i.test(normCombinedForScope)
  const menuCatalogSummary =
    wantsMenuCatalogContext && asksBroadMenuList && (!isCallbackOrPostOrderTopic || asksPriceExplicitly)
      ? turnLangGuess === 'en'
        ? menuEntry.compactCatalogEn
        : menuEntry.compactCatalogEs
      : ''

  const menuPreContext =
    preFetchedMenu.length > 0
      ? `\nCOINCIDENCIAS DEL MENÚ PARA ESTA PREGUNTA:\n` +
        preFetchedMenu
          .map((m) => {
            const desc = String(m.description || '').replace(/\s+/g, ' ').trim()
            return `- ${m.name} (${m.category}): ${m.priceFormatted}${desc ? ` — ${desc}` : ''}`
          })
          .join('\n')
      : ''

  const explicitGuestMatch = combinedMenuQuery.match(/\b([1-9]\d{0,2})\s*(?:personas?|invitados?|gente|people|guests?|adultos?|adults?)\b/i)
  const wantsFiestaContext =
    explicitGuestMatch !== null ||
    /\b(charola|charolas|fiesta\s*platters?|party\s*trays?|platters?|trays?|paquetes?|catering|taquizas?|banquetes?|eventos?|fiestas?|reunion(?:es)?)\b/i.test(
      normCombinedForScope
    )
  const followUpGuestMatch =
    wantsFiestaContext && !explicitGuestMatch
      ? combinedMenuQuery.match(/\b(?:para|for|of)\s+([1-9]\d{0,2})\b/i)
      : null
  const guestMatch = explicitGuestMatch || followUpGuestMatch
  const detectedGuestCount = guestMatch ? Math.min(500, Math.max(1, Number(guestMatch[1]))) : null
  const platterInfo = recommendFiestaPlatters(detectedGuestCount, liveMenuItems)
  const platterPreContext = wantsFiestaContext
    ? `\nCHAROLAS FIESTA PLATTER OFICIALES — PARTY TRAY GUIDELINES (orden exclusivo en línea en tacosgavilan.com con mínimo 1 hora de anticipación; carnes a elegir: Carne Asada, Pollo o Al Pastor [en orden en línea Toast también permite elegir entre las 8 carnes]; aguas frescas: Horchata, Jamaica, Piña o Tamarindo; incluye arroz, frijol, tortillas recién hechas de maíz o harina a elegir, salsas roja y verde, condimentos y utensilios completos):\n` +
      platterInfo.packages
        .map(
          (p) =>
            `- ${p.labelEs}: ${p.price !== null ? '$' + p.price.toFixed(2) : 'consultar en tacosgavilan.com'} (${p.meatLbs} lbs carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs}, ${p.aguasGallons} gal agua fresca; además: ${p.extrasSummaryEs})`
        )
        .join('\n') +
      (detectedGuestCount
        ? `\n  -> CÁLCULO EXACTO PARA ${detectedGuestCount} PERSONAS (RESPONDE DIRECTO SIN LLAMAR HERRAMIENTAS): ${turnLangGuess === 'en' ? platterInfo.recommendationEn : platterInfo.recommendationEs}`
        : '')
    : ''

  const atTimePromptEs = (formatted12h: string) =>
    /^1:/i.test(formatted12h.trim()) ? `a la ${formatted12h}` : `a las ${formatted12h}`

  // Frase de cierre correcta: en la madrugada (turno nocturno del día anterior) se dice "cerramos hoy a las 3:00 AM",
  // y en días festivos con horario especial se menciona la festividad.
  const closingPhraseEs = scheduleEval.isAfterMidnightSpillover
    ? `cerramos hoy ${atTimePromptEs(scheduleEval.todayCloseFormattedEs)}`
    : scheduleEval.isSpecialHolidaySchedule && scheduleEval.specialHolidayName
      ? `hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} por ${scheduleEval.specialHolidayName} cerramos en horario especial ${atTimePromptEs(scheduleEval.todayCloseFormattedEs)}`
      : `hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} cerramos ${atTimePromptEs(scheduleEval.todayCloseFormattedEs)}`
  const hoursExampleBranchEs = resolveCustomerStoreMeta(store)?.isLosAngelesCrossStreetStore
    ? `la ${formatCustomerStoreName(store, 'es', { style: 'spoken' }).replace(/^Los Ángeles,\s*/i, 'sucursal de Los Ángeles ')}`
    : `la sucursal ${formatCustomerStoreName(store, 'es', { style: 'display' })}`
  const hoursExampleEs = scheduleEval.isOpenNow
    ? store.has_drive_thru
      ? `"En este momento estamos abiertos aquí en ${hoursExampleBranchEs}, contamos con servicio de Drive-Thru y ${closingPhraseEs}. ¿Te puedo ayudar con algo más?"`
      : `"En este momento estamos abiertos aquí en ${hoursExampleBranchEs} y ${closingPhraseEs}; en esta ubicación no contamos con Drive-Thru, pero te atendemos con gusto en comedor y para llevar."`
    : `Usa exactamente el "Estado actual en vivo" de arriba (la sucursal está CERRADA en este momento) y menciona si hay Drive-Thru o no en la misma oración.`

  const parkingNotesBlock = [
    config.parking_notes_es ? `- Notas de acceso/estacionamiento (ES): ${config.parking_notes_es}` : '',
    config.parking_notes_en ? `- Parking / access notes (EN): ${config.parking_notes_en}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const customerBranchDisplay = formatCustomerStoreName(store, turnLangGuess, { style: 'display' })
  const customerBranchSpoken = formatCustomerStoreName(store, turnLangGuess, { style: 'spoken' })
  const customerBranchCrossStreets = getCustomerStoreCrossStreets(store, turnLangGuess)
  const priorCallbackNote = hadPriorCallbackInCall
    ? `\nESTADO DE ESTA LLAMADA: En un turno previo de esta misma llamada YA quedó registrado el recado prioritario para el gerente de ${customerBranchDisplay}. NO vuelvas a pedir nombre ni teléfono; solo llama \`create_manager_callback\` si la persona desea agregar información nueva al recado.`
    : ''

  const callbackOutcomeInstruction = scheduleEval.isOpenNow
    ? 'confírmale con calidez que el gerente en turno en la sucursal ya recibió la alerta prioritaria en su pantalla y se comunicará contigo en cuanto sea posible / as soon as possible (NUNCA prometas "enseguida", "de inmediato", "ahorita", "right away" ni "immediately"; nunca transferimos llamadas a teléfonos personales, y exprésalo de forma amable y natural sin mencionar "políticas" ni "reglamentos").'
    : 'aclárale con transparencia que como la sucursal está cerrada en este momento, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos.'

  const spokenStoreAddress = formatStoreAddressForAgent(store.address, turnLangGuess, { includeZip: false })
  const storeZipCode = extractZipCodeFromAddress(store.address)
  const allSpecialForCross = (ctx as any).allSpecialHours || ctx.specialHours || []
  const regionalMatchIds = Object.entries(REGION_STORE_IDS).find(([alias]) => normCombinedForScope.includes(alias))?.[1] || null
  const crossStoreComparison =
    wantsMultiStoreContext && allActiveStores.length > 0
      ? buildCrossStoreHoursComparison(allActiveStores, turnLangGuess, allSpecialForCross)
      : ''
  const regionalPreContext =
    regionalMatchIds && allActiveStores.length > 0
      ? `\nCOINCIDENCIAS REGIONALES PRE-CALCULADAS (RESPONDE DIRECTO SIN TOOL): ` +
        allActiveStores
          .filter((s) => regionalMatchIds.includes(Number(s.id)))
          .map((s) => {
            const custLabel = formatCustomerStoreName(s, turnLangGuess, { style: 'display' })
            const cross = getCustomerStoreCrossStreets(s, turnLangGuess)
            return `#${s.id} ${custLabel}${cross ? ` [Esquina: ${cross}]` : ''} (${formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false })}, Tel: ${s.phone}, ${s.has_drive_thru ? 'CON Drive-Thru' : 'Sin Drive-Thru'})`
          })
          .join(' | ')
      : ''
  const storesDirectoryBlock =
    wantsMultiStoreContext && allActiveStores.length > 0
      ? `\nDIRECTORIO OFICIAL VERIFICADO DE LAS 15 SUCURSALES (USA ESTOS NOMBRES DE CLIENTE Y ENTRECALLES REALES; NUNCA INVENTES CALLES):\n` +
        allActiveStores
          .map((s) => {
            const custLabel = formatCustomerStoreName(s, turnLangGuess, { style: 'display' })
            const cross = getCustomerStoreCrossStreets(s, turnLangGuess)
            return `- #${s.id} ${custLabel}${cross ? ` (Esquina: ${cross})` : ''}: ${formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false })} | Tel: ${s.phone} | ${s.has_drive_thru ? 'CON Drive-Thru' : 'Sin Drive-Thru'} | Horario: ${turnLangGuess === 'en' ? s.compactHoursEn : s.compactHoursEs}`
          })
          .join('\n') +
        (crossStoreComparison ? `\n\n${crossStoreComparison}` : '') +
        regionalPreContext
      : ''

  const systemInstruction = `Eres la recepcionista telefónica virtual oficial de **Tacos Gavilan** en **${customerBranchSpoken}** (Sucursal #${store.id}${customerBranchCrossStreets ? `, entrecalles oficiales: ${customerBranchCrossStreets}` : ''}).
El nombre oficial de la marca es estrictamente **Tacos Gavilan** (NUNCA digas "Tacos El Gavilan").
**REGLA OBLIGATORIA SUCURSALES DE LOS ÁNGELES (#5, #6 y #7)**: Frente al cliente **PROHIBIDO** llamar a estas tres tiendas únicamente "Broadway", "Central", "Slauson", "LA Broadway" o "LA Central". **SIEMPRE** nómbralas como **Los Ángeles** indicando sus entrecalles (esquinas): #5 = **Los Ángeles, en la esquina de Vernon y Broadway** (4380 South Broadway); #6 = **Los Ángeles, en la esquina de Central y Washington** (1900 South Central Avenue, con Drive-Thru); #7 = **Los Ángeles, en la esquina de Slauson y Broadway** (5833 South Broadway).
Operamos exclusivamente en California, EE. UU.: **TODOS los precios son en dólares y centavos estadounidenses (USD)**. **QUEDA TERMINANTEMENTE PROHIBIDO** decir o escribir "pesos", "peso" o "MXN" (ejemplo correcto: "Cada taco cuesta $2.29 dólares").

DATOS EN VIVO DE ESTA SUCURSAL (${customerBranchDisplay}):
${calendarDateLine}
- Estado actual en vivo (Zona Horaria Pacífico): ${turnLangGuess === 'en' ? scheduleEval.statusMessageEn : scheduleEval.statusMessageEs}
- Horario de la semana: ${turnLangGuess === 'en' ? scheduleEval.weeklySummaryEn : scheduleEval.weeklySummaryEs}
${holidaysContextLine ? holidaysContextLine + '\n' : ''}- Dirección exacta para decir por teléfono (SIN abreviaturas): ${spokenStoreAddress}${customerBranchCrossStreets ? ` (Entrecalles / esquina: ${customerBranchCrossStreets})` : ''}${storeZipCode ? ` (Código postal solo si lo piden: ${storeZipCode})` : ''}
- Teléfono: ${store.phone}
- Drive-Thru: ${store.has_drive_thru ? 'Esta sucursal SÍ tiene Drive-Thru.' : 'Esta sucursal NO tiene Drive-Thru (solo Comedor y Para Llevar).'} Las únicas 6 sucursales con Drive-Thru son Los Ángeles (esquina de Central y Washington), West Covina, La Puente, Norwalk, Lynwood y South Gate.
- Pagos / EBT: ${config.accepts_ebt ? 'Aceptamos EBT CalFresh RMP en caja, efectivo, tarjetas y Apple Pay/Google Pay.' : 'NO aceptamos EBT CalFresh aquí; sí efectivo, tarjetas y Apple Pay/Google Pay.'}
- Web / Ordenar en línea: tacosgavilan.com (NUNCA dictes URLs largas ni IDs numéricos)
- Privacidad de la llamada: El sistema NO graba audio de las llamadas; únicamente guarda la transcripción escrita de la conversación para atenderte mejor.${source === 'twilio' && callerNumber ? `\n- Caller ID Twilio entrante: ${callerNumber} (solo úsalo si piden marcar a este mismo número)` : ''}
${parkingNotesBlock}${priorCallbackNote}
${storesDirectoryBlock}

${menuCatalogSummary}
${menuPreContext}
${platterPreContext}

BASE DE CONOCIMIENTO OFICIAL EDITABLE (REGLAS VIGENTES, TIENEN PRIORIDAD SOBRE CUALQUIER EJEMPLO):
${kbFormatted}

MAPA DE EJECUCIÓN DE ESCENARIOS Y REGLAS ESTRICTAS DE DIÁLOGO:
0. **CERO DATOS INVENTADOS, MONEDA DÓLARES/CENTAVOS Y PRONUNCIACIÓN VIAL NATURAL (REGLA CRÍTICA)**:
   - Usa ÚNICAMENTE la información de este contexto. NUNCA inventes platillos, carnes, ingredientes, pasteles, precios, promociones, horarios de entrevistas ni procesos que no aparezcan arriba. Ante una política administrativa o operativa legítima no registrada en este contexto (ej. convenios escolares o permisos especiales), indica con honestidad que no cuentas con esa política oficial confirmada, ofrece dejar un recado al gerente de la sucursal y llama a \`flag_unanswered_question\` (**PROHIBIDO** inventar que esos detalles o productos que no manejamos aparecen en \`tacosgavilan.com\`).
   - Todos los importes se expresan únicamente en **dólares y centavos** (\`$2.29 dólares\`, jamás \`pesos\`).
   - Al decir cualquier domicilio o calle, dilo SIEMPRE completo y sin abreviaturas (ej. \`101 South Azusa Avenue, en West Covina, California\`, \`115 East Baseline Road\`, \`1258 East Seventeenth Street\`, \`3220 East Imperial Highway\`, \`Boulevard\`). NUNCA escribas \`S.\`, \`E.\`, \`N.\`, \`W.\`, \`Ave.\`, \`Rd.\`, \`Blvd.\`, \`St.\`, \`Hwy.\` ni \`CA\`, y no menciones el código postal a menos que el cliente lo pida.
1. **CERO MULETILLAS Y CERO REPETICIÓN DE "¡SÍ!"**:
   - **PROHIBIDO** empezar tus respuestas con "¡Sí!", "¡Claro que sí!", "¡Claro!", "¡Por supuesto!", "¡Hola!" o "Yes!".
   - Cuando el cliente hace varias preguntas a la vez (ej. "¿Están abiertos, a qué hora cierran y tienen Drive-Thru?"), **NUNCA** digas "Sí" dos veces. Integra todo en una sola oración fluida. Ejemplo para este momento: ${hoursExampleEs}
2. **Menú, STT Fonético, Bebidas, Quesos, Postres, Regular vs Super y No Manejados**:
   - Si el precio/ingrediente YA está en tu contexto, **RESPONDE DIRECTO SIN LLAMAR HERRAMIENTAS**. Ante posibles errores de micrófono sobre un tema reciente (ej. "torta Corona" tras hablar de "torta cubana", "salad burrito" = asada, "muleta" = mulita, "driver" = Drive-Thru), interpreta con naturalidad el platillo correcto.
   - Medidas reales de bebidas, quesos y postres aparecen en el CATÁLOGO y Base de Conocimiento (ej. Champurrado y Café individual = **vaso térmico de 16 onzas**, Caja Champurrado = **96 onzas** [6×16 oz / 8 vasitos de 12 oz]; Aguas Frescas: **Horchata, Jamaica, Piña y Tamarindo** en 22 oz / 32 oz / 128 oz; Tortas = **Queso Fresco**, NUNCA crema ni queso fundido; Postres = **SOLO Flan y Cheesecake individuales**). Diferencia Regular vs Super: Quesadilla/Mulita Super añade guacamole y crema; Burrito Super añade queso Monterey Jack, guacamole y crema; Torta Cubana = milanesa de res, jamón y salchicha.
   - **NO vendemos ni manejamos pasteles de cumpleaños**, pasteles enteros, churros, menudo, birria, pozole, suadero, tripa (descontinuada) ni alcohol/cerveza; si preguntan si tenemos alguno de estos productos o temas ajenos (música, deportes, chistes), acláralo con amabilidad (indicando que de postre solo ofrecemos Flan y Cheesecake individuales si preguntaron por pastel/postre), **NUNCA** digas que los busquen en \`tacosgavilan.com\` y **NUNCA** llames \`flag_unanswered_question\` por productos que no vendemos.
3. **Charolas Fiesta Platters**:
   - Usa la sección CHAROLAS de tu contexto (si ya calculó \`CÁLCULO EXACTO\` para >40 personas, responde directo sin tool call).
4. **Pedidos por Teléfono**:
   - Explica de manera educada y seria que no tomamos órdenes por teléfono, e invítalo a hacer su pedido fácilmente en tacosgavilan.com para pasar a recoger${store.has_drive_thru ? ' o directamente en caja o por el Drive-Thru' : ' o directamente en caja'}. Si insisten en preguntar por qué, mantente amable y seria indicando únicamente que los pedidos para recoger se toman en tacosgavilan.com o directamente en la sucursal. **PROHIBIDO** mencionar "políticas", "política", "pólizas", "reglamentos", "policy" o "policies" al responder sobre órdenes por teléfono.
   - EXCEPCIÓN: Si el cliente ya hizo una orden y llama para agregar **condimentos gratis**, reportar **sucursal equivocada** o un **problema/retraso de entrega**, NO apliques esta regla de pedido nuevo: atiende según las reglas 5 y 6.
5. **Repartidores vs. Clientes de Plataformas Delivery (Uber Eats, DoorDash y Grubhub)**:
   - **Si llama un REPARTIDOR**: ${store.has_drive_thru ? `En esta sucursal (${customerBranchDisplay}), mientras el comedor esté abierto recogen en el mostrador; si el comedor ya cerró pero el Drive-Thru sigue abierto, pueden recoger por la ventanilla del Drive-Thru mostrando el nombre y código de la orden. Si la sucursal ya está totalmente cerrada, díselo con claridad.` : `En esta sucursal (${customerBranchDisplay}) NO tenemos Drive-Thru, por lo que todas las órdenes de DoorDash y Uber Eats se recogen en el mostrador dentro del horario de la tienda (usa el "Estado actual en vivo" de arriba). Si tiene algún inconveniente, ofrécele avisar en vivo al gerente.`}
   - **Si llama un CLIENTE sobre su orden de Uber Eats / DoorDash / Grubhub**:
     * **Modificar platillos pagados, agregar comida con costo, cambiar dirección o pedir reembolso**: Explica con claridad y empatía que, como el pago se procesó por esa aplicación externa, la sucursal **no puede modificar platillos con costo, cambiar la dirección ni emitir reembolsos**; debe gestionarlo o cancelarlo directo en su aplicación en la sección **Ayuda (Help)**.
     * **Ajuste menor sin costo antes de empacar** (ej. quitar cebolla/cilantro): Pide nombre, teléfono de 10 dígitos, plataforma y código de orden para enviar un aviso urgente (\`reason_category: "delivery_issue"\`), aclarando honestamente que **solo aplica si la bolsa aún no se ha empacado ni entregado al repartidor**.
     * **La orden NO ha llegado aún (retraso)**: Explica que la entrega física depende del repartidor asignado e invítalo a revisar el estado en su app; si lleva mucho tiempo esperando repartidor, ofrece tomar nombre, teléfono de 10 dígitos y código de orden para enviar aviso a tienda (\`reason_category: "delivery_issue"\`) y revisar si la bolsa sigue en el mostrador.
     * **La orden LLEGÓ EQUIVOCADA o INCOMPLETA**: Pide disculpas sinceras, indícale reportarlo en la sección **Ayuda** de Uber Eats / DoorDash / Grubhub para recibir su reembolso o crédito directo, y además ofrece tomar nombre, teléfono de 10 dígitos y código/detalle (\`reason_category: "delivery_issue"\` o \`"missing_or_wrong_item"\`) para avisar en vivo al Gerente.
6. **Condimentos Gratis, Sucursal Equivocada, Reclamos Directos, Objetos Olvidados, Empleados o Proveedores**:
   - **6A) Agregar Condimentos Gratis en orden ya hecha** (salsa roja/verde, cebolla con cilantro, limones, jalapeños, cubiertos/servilletas):
     * Pide **nombre en la orden, número/código de orden, qué condimentos desea y teléfono real de 10 dígitos**.
     * Ejecuta \`create_manager_callback\` con \`reason_category: "condiments_note"\` y \`urgency: "normal"\`.
     * Confirma que enviaste una **Nota de Empaque** al mostrador/cocina aclarando honestamente que **los incluirán siempre que tu orden todavía no haya salido ni se haya entregado al repartidor** (NO digas que el gerente llamará por unas salsas). Si es de Uber/DD/GH, sugiérele también mandar mensaje en su app al repartidor.
   - **6B) Pidió en Sucursal Equivocada**:
     * Explica que cada sucursal procesa pagos y tickets por separado, por lo que no se puede mover automáticamente una orden pagada de una tienda a otra.
     * Si pidió por **Uber Eats / DoorDash / Grubhub**: indícale cancelar de inmediato en su app antes de preparación y reordenar en la tienda correcta (confirmando siempre entrecalles si es en Los Ángeles).
     * Si pidió directo en **tacosgavilan.com** (para recoger): pregunta en cuál de las 15 sucursales cayó realmente el pedido, toma nombre, teléfono de 10 dígitos y número de orden, y ejecuta \`create_manager_callback\` pasando **\`target_store_id\`** de ESA sucursal destino (del DIRECTORIO OFICIAL) con \`reason_category: "wrong_store_order"\` y \`urgency: "high"\`.
   - **6C) Órdenes Equivocadas o Incompletas en Drive-Thru, Comedor, Mostrador o \`tacosgavilan.com\`**:
     * Para hacer la **revisión de la preparación de su orden** (*review how your order was prepared*), debes solicitar SIEMPRE de manera educada y seria estos **4 datos**: **1) número de ticket, 2) fecha de compra, 3) nombre y 4) número de teléfono real de 10 dígitos**, e incluir OBLIGATORIAMENTE la aclaración de que **sin el número de ticket es poco probable determinar la equivocación** (en inglés: *"Without the ticket number, it is unlikely we can verify the mistake"*).
     * Si el cliente aún NO ha proporcionado alguno de los 4 datos (y todavía NO ha dicho que perdió/tiró el ticket), pídele amablemente los datos que falten ANTES de llamar \`create_manager_callback\` (nota: si dijo \`"hoy"\`, \`"ahorita"\` o \`"ayer"\` en la llamada, ya tienes la fecha usando la fecha actual de California).
     * Si el cliente indica que **NO tiene el ticket** (lo tiró, perdió o no lo conserva): reitera de forma respetuosa y seria que **sin el número de ticket es poco probable determinar la equivocación al revisar la preparación**, y si ya dio (o desea dejar) su fecha de compra, nombre y teléfono de 10 dígitos, ejecuta \`create_manager_callback\` con \`reason_category: "missing_or_wrong_item"\`, \`ticket_or_order_number: "SIN TICKET"\` y \`order_date\`, sin prometer reposición ni reembolso.
     * En cuanto tengas número de ticket (o confirmación de \`SIN TICKET\`), fecha, nombre y teléfono real de 10 dígitos, **EJECUTA PRIMERO \`create_manager_callback\`** (\`reason_category: "missing_or_wrong_item"\`, \`urgency: "high"\`, incluyendo \`ticket_or_order_number\` y \`order_date\`) antes de responder, y confirma que el gerente revisará la preparación de su orden y ${callbackOutcomeInstruction}
   - **6D) Objetos Olvidados, Cobros, Empleados, Proveedores o "quiero hablar con el gerente"**:
     * **ACCIÓN OBLIGATORIA CON HERRAMIENTA**: Si la persona YA dio su nombre y teléfono real de 10 dígitos (o en llamada Twilio pidió marcarle a su Caller ID), **EJECUTA PRIMERO \`create_manager_callback\`** con EXACTAMENTE esos datos antes de responder. **PROHIBIDO** decir en texto que "envías / dejaste / registraste una alerta, nota o recado" sin haber invocado \`create_manager_callback\`.
     * Después de ejecutar \`create_manager_callback\`, aclara de forma amable y natural que no transferimos llamadas a celulares personales de los gerentes (sin mencionar "políticas" ni "reglamentos") y ${callbackOutcomeInstruction}
     * Si aún NO ha dado su nombre o teléfono real de 10 dígitos, aclara que no transferimos a celulares personales y pídeselos con empatía en una sola frase corta ANTES de intentar registrar el recado.
     * **Dictado pausado de teléfono**: si el cliente pausó a la mitad y solo escuchaste entre 3 y 9 dígitos, **conserva esos dígitos** y pídele amablemente solo los dígitos restantes (ej. \`"Anoté 323-982, ¿me regalas los últimos 4 dígitos?"\`); en cuanto te dé el resto en el siguiente turno, únelos en un solo número de 10 dígitos y ejecuta \`create_manager_callback\` de inmediato.
     * Si ya enviaste la alerta o nota en esta misma llamada, no la dupliques salvo que agregue datos nuevos: confirma que el equipo o el gerente ya la tienen en su pantalla.
7. **Idioma y Agilidad Telefónica (REGLA CRÍTICA DE VELOCIDAD)**:
   - Idioma detectado del cliente: ${turnLangGuess === 'en' ? 'Inglés' : 'Español'}. Responde SIEMPRE en el mismo idioma de su último mensaje (español cálido y natural del Sur de California con precios SIEMPRE en dólares y centavos, o inglés natural).
   - **RESPUESTAS ULTRA ÁGILES (8 a 20 palabras, 1–2 oraciones cortas)**: Ya dijiste la sucursal al saludar; NO repitas el nombre largo ni las esquinas en cada respuesta a menos que pregunten ubicación, dirección o sucursal. Responde directo el dato pedido más una pregunta breve de cierre (ej. \`"Hoy cerramos a las 2:00 AM. ¿Te puedo ayudar con algo más?"\`, \`"Cada taco de asada cuesta $2.29 dólares. ¿Algo más?"\`). Excepciones autorizadas hasta **65–75 palabras**: (a) calendario completo de los **7 festivos** (cerrados Viernes Santo y Navidad 25 dic; cierre 4 PM Thanksgiving, Nochebuena 24 dic y Fin de Año 31 dic; apertura 11 AM Año Nuevo 1 ene y Black Friday); o (b) varias sucursales a la vez. Sin comerciales de relleno, viñetas, emojis ni markdown.
8. **Filtro Anti-Spam / Ventas Comerciales**:
   - Si llaman para vender servicios comerciales (SEO/Google, préstamos, paneles solares, garantías), declina con cortesía en una oración breve indicando que en sucursal no recibimos ofertas comerciales y NO ejecutes \`create_manager_callback\`.
9. **Cierre Limpio de Llamada Cuando Ya No Hay Nada Más Que Hacer**:
   - Cuando el asunto ya quedó resuelto o aclarado (ej. ya registraste el recado/nota y el cliente solo agradece o confirma de enterado sin hacer otra pregunta, o tras explicar que los pedidos se hacen en \`tacosgavilan.com\` el cliente dice que está bien o que ya no ocupa nada más), **NO alargues la llamada con más preguntas**: despídete con calidez en una sola oración corta diciendo \`"Con gusto. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!"\` (o en inglés \`"You are very welcome! Thank you for calling Tacos Gavilan, have a wonderful day!"\`) **SIN ningún signo de interrogación (\`?\`)**, para que el sistema finalice la llamada de inmediato.`

  // Convertir historial de transcripción a contents de Gemini excluyendo fallbacks de error previos para no contaminar el modelo
  const historyEntries = transcript
    .filter(
      (t) =>
        (t.role === 'user' || t.role === 'assistant') &&
        !/problema t[eé]cnico moment[aá]neo|brief technical issue/i.test(String(t.text || ''))
    )
    .slice(-10)
  while (historyEntries.length > 0 && historyEntries[0].role !== 'user') historyEntries.shift()
  const contents: any[] = historyEntries.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text }]
  }))

  const toolsUsed: string[] = []
  let resolvedCallbackTargetStore: any = store
  let resolvedCallbackCategory = 'other'
  const normUser = normalizeSearchText(normalizedUserForMatch)
  const isCallbackOrOrderScenario =
    /\b(soy empleado|llegar tarde|mi turno|falto|faltaron|incompleta|equivocad|no ha llegado|retras|modificar|cambiar|cancelar|condimento|cilantro|cebolla|limon|jalapeno|servilleta|tenedor|sucursal equivocada|otra tienda|wrong store|wrong location|ticket|queja|reembolso|olvide|perdi|hacer un pedido|pedido por telefono|ordenar por telefono|place an order|order over the phone|uber|doordash|grubhub|repartidor|contratando|empleo|vacantes|trabajo)\b/i.test(
      normUser
    )

  // Telemetría de herramientas consultadas implícitamente (los datos ya van inyectados en el contexto)
  if (
    !isCallbackOrOrderScenario &&
    preFetchedMenu.length > 0 &&
    /\b(precio|cuesta|cuanto|how much|price|cost|taco|burrito|mulita|quesadilla|torta|plato|sope|nachos|horchata|jamaica|champurrado|agua)\b/i.test(
      normUser
    )
  ) {
    toolsUsed.push('search_menu_item_price')
  }
  if (!isCallbackOrOrderScenario && (/\b(charola|charolas|fiesta platter|party tray|catering|invitados)\b/i.test(normUser) || /\b([1-9]\d{1,2})\s+(personas|people)\b/i.test(normUser))) {
    toolsUsed.push('get_fiesta_platter_packages')
  }
  if (
    !isCallbackOrOrderScenario &&
    /\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|drive thru|drive-thru|direccion|address|thanksgiving|accion de gracias|navidad|nochebuena|christmas|ano nuevo|new year|viernes santo|good friday|black friday|festivo|festivos|holiday|holidays)\b/i.test(
      normUser
    )
  ) {
    toolsUsed.push('get_store_hours_and_status')
  }

  let callbackCreated: any | null = null
  let callbackWasNew = false
  let unansweredFlagged: string | null = null
  let replyText = ''
  let geminiFailed = false
  const VALID_URGENCY = new Set(['high', 'critical', 'normal'])
  const VALID_REASON = new Set([
    'condiments_note',
    'wrong_store_order',
    'delivery_issue',
    'missing_or_wrong_item',
    'lost_item',
    'employee_callout',
    'vendor_arrival',
    'billing_refund',
    'other'
  ])

  const executeTool = async (toolName: string, toolArgs: any): Promise<any> => {
    if (toolName === 'get_store_hours_and_status') {
      return {
        address: formatStoreAddressForAgent(store.address, turnLangGuess, { includeZip: false }),
        zip_code: extractZipCodeFromAddress(store.address),
        phone: store.phone,
        hasDriveThru: store.has_drive_thru,
        acceptsEbt: config.accepts_ebt,
        ...scheduleEval,
        upcomingHolidays: upcomingHolidays.slice(0, 7)
      }
    }
    if (toolName === 'search_menu_item_price') {
      const q = String(toolArgs?.query || '')
      const matches = rankMenuItemsForPrompt(liveMenuItems, q, 8)
      return { storeName: customerBranchDisplay, query: q, matchesFound: matches.length, items: matches }
    }
    if (toolName === 'get_fiesta_platter_packages') {
      const guestCount = Math.round(Number(toolArgs?.guest_count))
      return recommendFiestaPlatters(
        Number.isFinite(guestCount) && guestCount > 0 ? guestCount : null,
        liveMenuItems
      )
    }
    if (toolName === 'find_other_stores') {
      const [activeStores, allSpecialHours] = await Promise.all([
        allActiveStores.length > 0 ? Promise.resolve(allActiveStores) : loadAllActiveStoresDirectory(),
        loadAllSpecialHoursCached()
      ])
      const filterNorm = normalizeSearchText(toolArgs?.search_city_or_filter || '')
      const matchedRegionIds = Object.entries(REGION_STORE_IDS).find(([alias]) => filterNorm.includes(alias))?.[1] || null
      const isScheduleComparisonFilter =
        !filterNorm ||
        /^(all|todas|todos|sucursales|stores|horario|horarios|hours)$/.test(filterNorm) ||
        (/\b(tarde|temprano|late|latest|early|earliest|cierra|cierran|abre|abren|domingo|lunes|martes|miercoles|jueves|viernes|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday|semana|weekend)\b/.test(
          filterNorm
        ) &&
          !matchedRegionIds)

      const matchedStores = activeStores.filter((s: any) => {
        if (filterNorm.includes('drive')) return Boolean(s.has_drive_thru)
        if (isScheduleComparisonFilter) return true
        if (matchedRegionIds) return matchedRegionIds.includes(Number(s.id))
        const meta = resolveCustomerStoreMeta(s)
        const extraKeys = meta ? `${meta.displayEs} ${meta.displayEn} ${meta.searchKeywords}` : ''
        return normalizeSearchText(`${s.name} ${cleanPhoneStoreName(s.name)} ${s.address} ${extraKeys}`).includes(filterNorm)
      })
      const targetStores = matchedStores.length > 0 ? matchedStores : activeStores
      const comparisonSummary = buildCrossStoreHoursComparison(activeStores, turnLangGuess, allSpecialHours || [])

      const filtered = targetStores.map((s: any) => {
        const ev = evaluateStoreSchedulePure({
          storeId: Number(s.id),
          storeName: s.name,
          weeklyHours: s.weekly_hours,
          specialHours: allSpecialHours || []
        })
        return {
          id: s.id,
          name: formatCustomerStoreName(s, turnLangGuess, { style: 'display' }),
          spoken_name: formatCustomerStoreName(s, turnLangGuess, { style: 'spoken' }),
          cross_streets: getCustomerStoreCrossStreets(s, turnLangGuess),
          address: formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false }),
          zip_code: extractZipCodeFromAddress(s.address),
          phone: s.phone,
          has_drive_thru: s.has_drive_thru,
          isOpenNow: ev.isOpenNow,
          activeDayEs: ev.activeDayLabelEs,
          activeDayEn: ev.activeDayLabelEn,
          todayHoursEs: ev.todayOpen === 'CLOSED' ? 'Cerrado hoy' : `${ev.todayOpenFormattedEs} - ${ev.todayCloseFormattedEs}`,
          todayHoursEn: ev.todayOpen === 'CLOSED' ? 'Closed today' : `${ev.todayOpenFormattedEn} - ${ev.todayCloseFormattedEn}`,
          weeklyHoursCompactEs: buildCompactWeeklyHours(s.weekly_hours, 'es'),
          weeklyHoursCompactEn: buildCompactWeeklyHours(s.weekly_hours, 'en'),
          weeklySummaryEs: ev.weeklySummaryEs,
          weeklySummaryEn: ev.weeklySummaryEn,
          statusMessageEs: ev.statusMessageEs,
          statusMessageEn: ev.statusMessageEn
        }
      })
      return { comparisonSummary, stores: filtered }
    }
    if (toolName === 'create_manager_callback') {
      const ensuredCall = await ensureCallRecord()
      const reasonSummary = String(toolArgs?.reason_summary || userText).trim()
      const argPhoneRaw = String(toolArgs?.caller_phone || '').trim()
      const allowDev555 = source === 'simulator' && /^TEST_SMOKE_/i.test(callSid)
      const blockedOwnTen = new Set(
        [extractPhoneDigits(store.phone).slice(-10), extractPhoneDigits(config.twilio_phone_number).slice(-10)].filter(Boolean)
      )
      const expandedArgPhone = replaceSpokenDigitRuns(argPhoneRaw)
      const parsedArg =
        argPhoneRaw.toUpperCase() === 'CALLER_ID'
          ? { valid: false, normalized: null, tenDigits: null }
          : normalizeUsPhoneE164(expandedArgPhone)
      const callerAuthorizedSameLine =
        argPhoneRaw.toUpperCase() === 'CALLER_ID' ||
        hasExplicitSameLineOptIn(transcript.filter((t) => t.role === 'user').map((t) => t.text).join(' | '))
      const parsedCaller =
        source === 'twilio' && callerNumber && callerAuthorizedSameLine
          ? normalizeUsPhoneE164(callerNumber)
          : { valid: false, normalized: null, tenDigits: null }
      const argIsClean =
        parsedArg.valid &&
        parsedArg.tenDigits &&
        !blockedOwnTen.has(parsedArg.tenDigits) &&
        !isFictitiousNanpPhone(parsedArg.tenDigits, allowDev555)
      const callerIsClean =
        parsedCaller.valid &&
        parsedCaller.tenDigits &&
        !blockedOwnTen.has(parsedCaller.tenDigits) &&
        !isFictitiousNanpPhone(parsedCaller.tenDigits, false)
      const cleanCallbackPhone = argIsClean
        ? parsedArg.normalized!
        : callerIsClean
          ? parsedCaller.normalized!
          : ''

      // Anti-duplicados en vivo: consultar siempre por call_id antes de insertar para cubrir concurrencia y deferDbFlush
      const existingPending =
        callbackCreated ||
        (
          await supabaseAdmin
            .from('phone_callback_requests')
            .select('*')
            .eq('call_id', ensuredCall.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ).data

      if (existingPending) {
        const prevSummary = String(existingPending.reason_summary || '')
        const patch: Record<string, any> = {}
        if (reasonSummary && !prevSummary.includes(reasonSummary)) {
          patch.reason_summary = `${prevSummary} | ${reasonSummary}`.slice(0, 2000)
        }
        if (cleanCallbackPhone && extractPhoneDigits(cleanCallbackPhone).length >= 7) {
          patch.caller_phone = cleanCallbackPhone
        }
        const candidateName = String(toolArgs?.caller_name || '').trim()
        if (candidateName && !/^(cliente|customer|cliente en linea|caller|unknown)$/i.test(normalizeSearchText(candidateName))) {
          patch.caller_name = candidateName
        }
        const updTicket = toolArgs?.ticket_or_order_number ? String(toolArgs.ticket_or_order_number).trim() : ''
        const updOrderDate = toolArgs?.order_date ? String(toolArgs.order_date).trim() : ''
        if (updTicket || updOrderDate) {
          const prevTk = String(existingPending.ticket_or_order_number || '').trim()
          const prevIsRealTk = Boolean(prevTk) && !/\b(?:sin|no)\s*ticket\b/i.test(normalizeSearchText(prevTk))
          const updIsNoTk = Boolean(updTicket) && /\b(?:sin|no)\s*ticket\b/i.test(normalizeSearchText(updTicket))
          const baseTk = updTicket && !(prevIsRealTk && updIsNoTk) ? updTicket : prevTk
          patch.ticket_or_order_number =
            baseTk && updOrderDate && !normalizeSearchText(baseTk).includes(normalizeSearchText(updOrderDate))
              ? `${baseTk} (${updOrderDate})`
              : baseTk || `SIN TICKET (${updOrderDate})`
        }
        const reqUpdCat = String(toolArgs?.reason_category || '').trim().toLowerCase()
        if (
          existingPending.reason_category === 'condiments_note' &&
          VALID_REASON.has(reqUpdCat) &&
          reqUpdCat !== 'condiments_note'
        ) {
          patch.reason_category = reqUpdCat
          patch.urgency = String(toolArgs?.urgency || '').toLowerCase() === 'critical' ? 'critical' : 'high'
        }
        const urgencyRank: Record<string, number> = { normal: 1, high: 2, urgent: 3, critical: 4 }
        const curUrgRank = urgencyRank[String(patch.urgency || existingPending.urgency || 'normal').toLowerCase()] ?? 1
        const reqUrgNorm = String(toolArgs?.urgency || '').toLowerCase()
        const reqUrgRank = urgencyRank[reqUrgNorm] ?? 0
        if (reqUrgRank > curUrgRank && (patch.reason_category || existingPending.reason_category) !== 'condiments_note') {
          patch.urgency = reqUrgNorm
        }
        const updTargetId = Number(toolArgs?.target_store_id)
        const updTargetStore =
          Number.isFinite(updTargetId) && updTargetId > 0
            ? allActiveStores.find((s) => Number(s.id) === updTargetId) || null
            : null
        if (updTargetStore && Number(updTargetStore.id) !== Number(existingPending.store_id)) {
          patch.store_id = Number(updTargetStore.id)
          patch.origin_store_id = Number(updTargetStore.id) !== Number(store.id) ? store.id : null
        }

        if (Object.keys(patch).length > 0) {
          const { data: updatedCb, error: updErr } = await supabaseAdmin
            .from('phone_callback_requests')
            .update(patch)
            .eq('id', existingPending.id)
            .select()
            .maybeSingle()
          if (updErr) {
            throw new Error(`No se pudo actualizar el recado existente: ${updErr.message}`)
          }
          callbackCreated = updatedCb || { ...existingPending, ...patch }
        } else {
          callbackCreated = existingPending
        }

        const effectiveTargetStoreId = Number(callbackCreated.store_id || existingPending.store_id || store.id)
        const effectiveTargetStore =
          allActiveStores.find((s) => Number(s.id) === effectiveTargetStoreId) || store
        const effectiveCategory = String(callbackCreated.reason_category || existingPending.reason_category || 'other')
        const effectiveTargetDisplay = formatCustomerStoreName(effectiveTargetStore, turnLangGuess, { style: 'display' })
        const effectiveTargetSched =
          Number(effectiveTargetStore.id) !== Number(store.id)
            ? evaluateStoreSchedulePure({
                storeId: effectiveTargetStore.id,
                storeName: effectiveTargetStore.name,
                weeklyHours: effectiveTargetStore.weekly_hours,
                specialHours: ((ctx as any).allSpecialHours || []).filter(
                  (sh: any) => sh.store_id === null || Number(sh.store_id) === Number(effectiveTargetStore.id)
                )
              })
            : scheduleEval

        resolvedCallbackTargetStore = effectiveTargetStore
        resolvedCallbackCategory = effectiveCategory

        return {
          success: true,
          alreadySent: true,
          routedToStoreId: Number(effectiveTargetStore.id),
          routedToStoreName: effectiveTargetDisplay,
          isCrossStoreRouted: Number(effectiveTargetStore.id) !== Number(store.id),
          reasonCategory: effectiveCategory,
          storeOpenNow: effectiveTargetSched.isOpenNow,
          willTransferLive: false,
          callbackId: existingPending.id,
          message: `El gerente de ${effectiveTargetDisplay} ya tiene la alerta de esta llamada; se actualizó el detalle.`
        }
      }

      // Validación estricta: NUNCA guardar un recado sin teléfono real válido de 10 dígitos
      if (!cleanCallbackPhone) {
        return {
          success: false,
          missingCallerPhone: true,
          message:
            'Aún NO cuentas con un número telefónico real válido de 10 dígitos con código de área. Pídele amablemente su nombre y su número de teléfono de 10 dígitos antes de registrar el recado.'
        }
      }

      const rawReasonCategory = String(toolArgs?.reason_category || '').trim().toLowerCase()
      const hasFoodOrderIssueEvidence =
        /\b(falto|faltaron|incomplet[oa]s?|equivocad[oa]s?|equivocaron|me dieron mal|salio mal|venia mal|orden mal|pedido mal|wrong order|missing|incomplete|ticket|recibo|receipt|tacos?|burritos?|mulitas?|quesadillas?|tortas?|platos?|comida|food|orden|order)\b/i.test(
          normalizeSearchText(`${reasonSummary} ${allUserTurnsText}`)
        )
      let normalizedCategory = VALID_REASON.has(rawReasonCategory) ? rawReasonCategory : ''
      if (!normalizedCategory || (normalizedCategory === 'other' && rawReasonCategory !== 'other')) {
        if (/^(complaint_missing_item|wrong_order|missing_item|incomplete_order)$/.test(rawReasonCategory)) {
          normalizedCategory = 'missing_or_wrong_item'
        } else {
          const fallbackMeta = inferCallMetadata(`${reasonSummary} ${allUserTurnsText}`, toolsUsed, true)
          normalizedCategory =
            fallbackMeta.primaryIntent === 'condiments_note'
              ? 'condiments_note'
              : fallbackMeta.primaryIntent === 'wrong_store_order'
                ? 'wrong_store_order'
                : fallbackMeta.primaryIntent === 'delivery_issue'
                  ? 'delivery_issue'
                  : fallbackMeta.primaryIntent === 'complaint_missing_item'
                    ? /\b(cobro|cobraron|reembolso|refund|overcharged|billing)\b/i.test(normalizeSearchText(reasonSummary))
                      ? 'billing_refund'
                      : hasFoodOrderIssueEvidence
                        ? 'missing_or_wrong_item'
                        : 'other'
                    : fallbackMeta.primaryIntent === 'lost_and_found'
                      ? 'lost_item'
                      : fallbackMeta.primaryIntent === 'employee_callout'
                        ? 'employee_callout'
                        : fallbackMeta.primaryIntent === 'vendor_service'
                          ? 'vendor_arrival'
                          : 'other'
        }
      }
      const rawUrgency = String(toolArgs?.urgency || 'high').toLowerCase()
      // Notas de condimentos jamás deben disparar alarma roja crítica cada 45s en pantalla del gerente
      const effectiveUrgency =
        normalizedCategory === 'condiments_note' ? 'normal' : VALID_URGENCY.has(rawUrgency) ? rawUrgency : 'high'

      const requestedTargetStoreId = Number(toolArgs?.target_store_id)
      const explicitTargetStore =
        Number.isFinite(requestedTargetStoreId) && requestedTargetStoreId > 0
          ? allActiveStores.find((s) => Number(s.id) === requestedTargetStoreId) || null
          : null
      const destinationStore = explicitTargetStore || store
      const isCrossStoreRouted = Number(destinationStore.id) !== Number(store.id)

      resolvedCallbackTargetStore = destinationStore
      resolvedCallbackCategory = normalizedCategory

      const rawTicketArg = toolArgs?.ticket_or_order_number ? String(toolArgs.ticket_or_order_number).trim() : ''
      const rawOrderDateArg = toolArgs?.order_date ? String(toolArgs.order_date).trim() : ''

      // Compuerta determinista en órdenes equivocadas/incompletas de tienda (DT, comedor, mostrador, tacosgavilan.com):
      // exige que el cliente haya mencionado realmente en la conversación (1) número de ticket o confirmación de no tenerlo
      // y (2) fecha/momento de compra (impidiendo que el LLM invente "Hoy" cuando el cliente no dijo cuándo compró).
      const mentionsDeliveryAppInCall = /\b(uber(?:\s*eats)?|doordash|door dash|grubhub|postmates)\b/i.test(normAllUserForScope)
      if (!toolArgs?._fromGuard && normalizedCategory === 'missing_or_wrong_item' && !mentionsDeliveryAppInCall) {
        const anyAssistantAskedTicket = transcript.some(
          (t) => t.role === 'assistant' && /\b(ticket|recibo|receipt)\b/i.test(String(t.text || ''))
        )
        const userStatedNoTicket =
          /\b(?:no tengo|sin|perdi|se me perdio|tire|no me dieron|no me lo dieron|no conservo|no guarde|no traigo|no lo traigo)\s+(?:el\s+|mi\s+)?(?:ticket|recibo|comprobante)\b/i.test(
            normAllUserForScope
          ) ||
          (anyAssistantAskedTicket &&
            /\b(no lo tengo|ya lo tire|lo tire|lo perdi|se me perdio|no me lo dieron|no me dieron|no lo traigo|no tengo|don\s*t have it|do not have it|threw it away|threw it out|lost it)\b/i.test(
              normAllUserForScope
            )) ||
          /\b(?:don\s*t|do not|didn\s*t|did not)\s+(?:have|get|keep)\s+(?:the\s+|my\s+|a\s+)?(?:ticket|receipt)\b/i.test(
            normAllUserForScope
          ) ||
          /\b(?:lost|threw\s+away|threw\s+out)\s+(?:the\s+|my\s+)?(?:ticket|receipt)\b/i.test(normAllUserForScope)

        const ticketDigitsOnly = rawTicketArg.replace(/\D/g, '')
        const cleanCallbackTen = extractPhoneDigits(cleanCallbackPhone).slice(-10)
        // Excluir el número telefónico del cliente al verificar si realmente dictó los dígitos del ticket
        const userWithoutPhone = replaceSpokenDigitRuns(allUserTurnsText).replace(
          /(?<![+\d])(?:\+?1[\s,.\-]*)?\(?[2-9]\d{2}\)?[\s,.\-]*[2-9]\d{2}[\s,.\-]*\d{2}[\s,.\-]*\d{2}(?!\d)/g,
          ' '
        )
        const ticketIsNotJustPhoneSubstring =
          !cleanCallbackTen || !cleanCallbackTen.includes(ticketDigitsOnly) || userWithoutPhone.includes(ticketDigitsOnly)
        const userSpokeTicketDigits =
          ticketDigitsOnly.length >= 1 &&
          ticketDigitsOnly.length <= 7 &&
          ticketIsNotJustPhoneSubstring &&
          userWithoutPhone.includes(ticketDigitsOnly)
        const userExplicitTicketPattern =
          /\b(?:ticket|recibo|orden|order|receipt)(?:\s+(?:n[uú]mero|number|num|no\.?|es|fue|era|is|was|el|la|#)){0,3}\s*[:#\-]?\s*[a-z0-9\-]*\d[a-z0-9\-]*\b(?!\s+(?:de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|tacos?|burritos?|mulitas?|quesadillas?|tortas?|sopes?|platos?|personas?|people|guests?))/i.test(
            allUserTurnsText
          ) || /(?<!\b(?:sucursal|tienda|store)\s*)#\s*\d{1,6}\b/i.test(allUserTurnsText)
        const hasRealTicketInfo = userStatedNoTicket || userExplicitTicketPattern || userSpokeTicketDigits

        const hasValidSlashDate = Array.from(allUserTurnsText.matchAll(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-]\d{2,4})?\b/g)).some((m) => {
          const mm = Number(m[1])
          const dd = Number(m[2])
          if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
          const after = allUserTurnsText.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 18)
          return !/^\s*(?:personas?|invitados?|people|guests?)/i.test(after)
        })
        const userMentionedPurchaseDate =
          /\b(hoy|ahorita|acabo de salir|hace rato|hace un rato|hace un momento|hace media hora|hace una hora|hace \d{1,2} (?:minutos?|horas?|dias?)|esta manana|esta tarde|esta noche|anoche|ayer|antier|anteayer|la semana pasada|el fin de semana|today|right now|just now|earlier|this morning|this afternoon|this evening|tonight|last night|yesterday|last week|this weekend|\d{1,2} (?:minutes?|hours?|days?) ago|an hour ago|half an hour ago|lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
            normAllUserForScope
          ) ||
          hasValidSlashDate ||
          /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i.test(
            normAllUserForScope
          )

        if (!hasRealTicketInfo || !userMentionedPurchaseDate) {
          const missingFields: string[] = []
          if (!hasRealTicketInfo) missingFields.push('número de ticket')
          if (!userMentionedPurchaseDate) missingFields.push('fecha de compra')
          return {
            success: false,
            missingOrderReviewFields: missingFields,
            message: `Aún NO puedes registrar la alerta porque el cliente todavía NO ha dicho en la llamada: ${missingFields.join(' y ')}. PROHIBIDO asumir o inventar la fecha o el ticket. Pídele amablemente ${missingFields.join(' y ')} para poder hacer la revisión de la preparación de su orden, aclarando con respeto que sin el número de ticket es poco probable determinar la equivocación.`
          }
        }
      }
      const combinedTicketDisplay =
        rawTicketArg && rawOrderDateArg && !normalizeSearchText(rawTicketArg).includes(normalizeSearchText(rawOrderDateArg))
          ? `${rawTicketArg} (${rawOrderDateArg})`
          : rawTicketArg
            ? rawTicketArg
            : rawOrderDateArg && normalizedCategory === 'missing_or_wrong_item'
              ? `SIN TICKET (${rawOrderDateArg})`
              : null

      const summaryWithDate =
        rawOrderDateArg && !normalizeSearchText(reasonSummary).includes(normalizeSearchText(rawOrderDateArg))
          ? `${reasonSummary} [Fecha compra: ${rawOrderDateArg}]`
          : reasonSummary

      const destDisplay = formatCustomerStoreName(destinationStore, turnLangGuess, { style: 'display' })
      const finalReasonSummary =
        isCrossStoreRouted && !summaryWithDate.includes(`-> Enrutada a #${destinationStore.id}`)
          ? `[Llamó a #${store.id} ${customerBranchDisplay} -> Enrutada a #${destinationStore.id} ${destDisplay}] ${summaryWithDate}`
          : summaryWithDate

      const destScheduleEval = isCrossStoreRouted
        ? evaluateStoreSchedulePure({
            storeId: destinationStore.id,
            storeName: destinationStore.name,
            weeklyHours: destinationStore.weekly_hours,
            specialHours: ((ctx as any).allSpecialHours || []).filter(
              (sh: any) => sh.store_id === null || Number(sh.store_id) === Number(destinationStore.id)
            )
          })
        : scheduleEval

      callbackCreated = await createManagerCallbackRequest({
        callId: ensuredCall.id,
        storeId: Number(destinationStore.id),
        originStoreId: isCrossStoreRouted ? store.id : null,
        source,
        callerName: String(toolArgs?.caller_name || 'Cliente en línea'),
        callerPhone: cleanCallbackPhone,
        callerType: String(toolArgs?.caller_type || 'customer'),
        urgency: effectiveUrgency,
        reasonCategory: normalizedCategory,
        reasonSummary: finalReasonSummary,
        ticketOrOrderNumber: combinedTicketDisplay
      })
      callbackWasNew = !Boolean((callbackCreated as any)?._wasDeduplicated)

      let toolGuidance = ''
      const isMissingTicketCase =
        normalizedCategory === 'missing_or_wrong_item' &&
        (!rawTicketArg || /\b(sin\s*ticket|no\s*ticket|extraviad|perdid|no\s*tiene)\b/i.test(normalizeSearchText(rawTicketArg)))

      if (normalizedCategory === 'condiments_note') {
        toolGuidance = destScheduleEval.isOpenNow
          ? `Nota de Empaque / Condimentos enviada en vivo a la pantalla del mostrador en ${destDisplay}. Confírmale amablemente que cocina y caja los agregarán siempre que su orden todavía no haya salido ni se haya entregado al repartidor (NO digas que el gerente llamará de regreso).`
          : `Nota registrada para ${destDisplay}. IMPORTANTE: La sucursal está CERRADA ahora (${destScheduleEval.statusMessageEs}); indícale al cliente que la orden solo puede recibir condimentos en horario abierto.`
      } else if (isCrossStoreRouted) {
        toolGuidance = destScheduleEval.isOpenNow
          ? `Alerta prioritaria enrutada DIRECTAMENTE a la pantalla del Gerente en ${destDisplay} (sucursal destino donde cayó la orden, sin desviar a teléfonos personales). Confírmale que el gerente de ${destDisplay} ya recibió la alerta y se comunicará contigo en cuanto sea posible ("as soon as possible"); NUNCA digas "enseguida", "de inmediato" ni "right away".`
          : `Recado prioritario enrutado a ${destDisplay}, pero ESA sucursal destino está CERRADA ahora (${destScheduleEval.statusMessageEs}). Informa al cliente que el gerente de ${destDisplay} verá la alerta al abrir.`
      } else if (isMissingTicketCase) {
        toolGuidance = destScheduleEval.isOpenNow
          ? `Alerta registrada en la pantalla del Manager en ${destDisplay} marcada SIN TICKET. Confírmale que dejaste sus datos con el gerente para que se comunique en cuanto sea posible, pero REITERA de forma educada y seria que sin el número de ticket es poco probable poder determinar la equivocación en la revisión de preparación (NUNCA prometas reposición ni reembolso).`
          : `Recado registrado para el Manager de ${destDisplay} marcado SIN TICKET (la sucursal está CERRADA ahora: ${destScheduleEval.statusMessageEs}). Informa que verá la nota al reabrir, reiterando con respeto que sin el ticket es poco probable determinar la equivocación.`
      } else if (normalizedCategory === 'missing_or_wrong_item') {
        toolGuidance = destScheduleEval.isOpenNow
          ? `Alerta enviada en vivo a la pantalla del Manager en ${destDisplay} con Ticket ${combinedTicketDisplay || ''} para revisar la preparación de su orden (sin desviar a teléfonos personales). Confírmale que el gerente revisará la preparación de su orden y se comunicará contigo en cuanto sea posible ("as soon as possible"); NUNCA digas "enseguida", "de inmediato" ni "right away".`
          : `Recado prioritario registrado para el Manager de ${destDisplay} con Ticket ${combinedTicketDisplay || ''} para revisar la preparación de su orden (la sucursal está CERRADA ahora: ${destScheduleEval.statusMessageEs}); informa que se comunicará al reabrir.`
      } else {
        toolGuidance = destScheduleEval.isOpenNow
          ? `Alerta enviada en vivo a la pantalla del Manager en ${destDisplay} (sin desviar a teléfonos personales). Confírmale que el gerente se comunicará contigo en cuanto sea posible ("as soon as possible") desde la tienda; NUNCA digas "enseguida", "de inmediato" ni "right away".`
          : `Recado prioritario registrado para el Manager de ${destDisplay}. IMPORTANTE: La sucursal está CERRADA ahora (${destScheduleEval.statusMessageEs}); informa al cliente que el gerente le devolverá la llamada al reabrir.`
      }

      return {
        success: true,
        alreadySent: Boolean((callbackCreated as any)?._wasDeduplicated),
        routedToStoreId: Number(destinationStore.id),
        routedToStoreName: destDisplay,
        isCrossStoreRouted,
        reasonCategory: normalizedCategory,
        storeOpenNow: destScheduleEval.isOpenNow,
        willTransferLive: false,
        callbackId: callbackCreated.id,
        message: toolGuidance
      }
    }
    if (toolName === 'flag_unanswered_question') {
      const qRaw = String(toolArgs?.question_text || userText).slice(0, 300)
      const isIgnoredTopic = /\b(chiste|joke|cancion|canta|song|sing|banda|rock|heroes del silencio|futbol|soccer|nfl|nba|clima|weather|presidente|politica|menudo|birria|pozole|suadero|tripa|cerveza|alcohol|beer|pastel(?:es)?|birthday\s*cakes?|churros?)\b/i.test(
        normalizeSearchText(`${userText} ${qRaw}`)
      )
      if (!isIgnoredTopic) {
        unansweredFlagged = qRaw
      }
      return { recorded: !isIgnoredTopic }
    }
    return { error: `Herramienta desconocida: ${toolName}` }
  }

  // Filtrar declaraciones redundantes cuyas respuestas ya fueron pre-inyectadas 100% en vivo en el systemInstruction
  // para evitar viajes dobles de functionCall (+900 ms por pregunta) sin perder ninguna herramienta cuando haga falta.
  const currentTurnMenuMatches = rankMenuItemsForPrompt(liveMenuItems, normalizedUserForMatch, 3)
  const excludedToolNames = new Set<string>(['get_store_hours_and_status'])
  if (currentTurnMenuMatches.length > 0) excludedToolNames.add('search_menu_item_price')
  if (wantsFiestaContext) excludedToolNames.add('get_fiesta_platter_packages')
  if (wantsMultiStoreContext) excludedToolNames.add('find_other_stores')
  const turnTools = [
    {
      functionDeclarations: PHONE_AGENT_TOOLS[0].functionDeclarations.filter(
        (fn: any) => !excludedToolNames.has(String(fn?.name || ''))
      )
    }
  ]

  // Fast-Path Canónico Determinista (< 2 ms CPU, 0 llamadas LLM, audio cacheable en Supabase Storage `phone_v6/Kore`):
  // Resuelve al instante las 19 preguntas frecuentes y operativas con redacción exacta y consistente; cualquier pregunta
  // compuesta (>1 tema), de flujo interactivo/callback o con regla personalizada por sucursal pasa a Gemini Hedged LLM.
  let forcedSpamFastPath = false
  let isCanonicalReply = false
  if (!replyText) {
    const canonicalHit = resolveCanonicalPreparedReply({
      userText,
      normUser,
      lang: turnLangGuess,
      lastAssistantText: prevAssistantForTurn,
      hadPriorPostOrderTurn,
      hadPriorCallbackInCall,
      store,
      config,
      scheduleEval,
      allSpecialHours: (ctx as any).allSpecialHours || ctx.specialHours || [],
      upcomingHolidays,
      knowledgeBase,
      allActiveStores,
      liveMenuItems,
      spokenStoreAddress,
      customerBranchCrossStreets,
      wantsFiestaContext,
      detectedGuestCount,
      platterInfo
    })
    if (canonicalHit) {
      replyText = canonicalHit.replyText
      isCanonicalReply = true
      if (canonicalHit.markAsSpam) forcedSpamFastPath = true
      for (const tu of canonicalHit.toolsUsedToAdd || []) {
        if (!toolsUsed.includes(tu)) toolsUsed.push(tu)
      }
    }
  }

  const composeInstantCallbackTurnReply = (cbRes: any, rawCallerName: string): string | null => {
    const cleanFirst =
      rawCallerName && !/^(cliente|customer|caller|unknown)/i.test(normalizeSearchText(rawCallerName))
        ? rawCallerName.split(/\s+/)[0]
        : ''
    const nameSuffix = cleanFirst ? `, ${cleanFirst}` : ''

    if (cbRes?.success && callbackCreated) {
      const targetMetaStore = resolvedCallbackTargetStore || store
      const custSpokenCompact = formatCustomerStoreName(targetMetaStore, turnLangGuess, { style: 'spoken_compact' })
      const storeOpen = cbRes.storeOpenNow !== undefined ? Boolean(cbRes.storeOpenNow) : Boolean(scheduleEval.isOpenNow)
      const cat = String(cbRes.reasonCategory || resolvedCallbackCategory || 'other')
      const tkLabel = String(callbackCreated.ticket_or_order_number || '').trim()
      const isNoTicket = /\b(sin\s*ticket|no\s*ticket)\b/i.test(normalizeSearchText(tkLabel))
      // Detectar turnos mixtos de detalle + despedida (ej. "orden 1088 Ya está gracias") para cerrar limpiamente sin preguntar "¿Algo más?"
      const callerIncludedClosingTail =
        !/[?¿]/.test(userText) &&
        /(?:ya\s+est[aá]\s+gracias|es\s+todo\s+gracias|todo\s+gracias|nada\s+m[aá]s\s+gracias|ser[ií]a\s+todo\s+gracias|muchas\s+gracias(?:\s+(?:adi[oó]s|hasta\s+luego|buen\s+d[ií]a|buenas\s+(?:tardes|noches)))?|that'?s\s+all(?:,?\s+thanks?)?|thanks?,?\s+that'?s\s+all|thank\s+you,?\s+bye)\s*[.!]?$/i.test(
          userText.trim()
        )
      const tailEs = callerIncludedClosingTail
        ? ' ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!'
        : ' ¿Te puedo ayudar con algo más?'
      const tailShortEs = callerIncludedClosingTail
        ? ' ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!'
        : ' ¿Algo más?'
      const tailEn = callerIncludedClosingTail
        ? ' Thank you for calling Tacos Gavilan, have a wonderful day!'
        : ' Anything else?'

      if (cbRes.alreadySent) {
        const shortTk = tkLabel ? tkLabel.split('(')[0].trim() : ''
        if (turnLangGuess === 'en') {
          const detailEn = shortTk && !isNoTicket ? ` with order ${shortTk}` : ''
          return `Perfect${nameSuffix}, I updated your report${detailEn} for the ${custSpokenCompact} manager, and they will reach out ${storeOpen ? 'as soon as possible' : 'as soon as we reopen'}.${tailEn}`
        }
        const detailEs = shortTk && !isNoTicket ? ` con el número ${shortTk}` : ''
        return `Perfecto${nameSuffix}, ya actualicé tu reporte${detailEs} para el gerente de ${custSpokenCompact} y se comunicará contigo ${storeOpen ? 'en cuanto sea posible' : 'en cuanto abramos'}.${tailShortEs}`
      }

      if (cat === 'condiments_note') {
        return turnLangGuess === 'en'
          ? `All set${nameSuffix}. Your condiment note is on the packing screen for ${custSpokenCompact} and will be included as long as your order has not left yet.${tailEn}`
          : `Listo${nameSuffix}. Ya envié tu nota de condimentos a la pantalla de empaque en ${custSpokenCompact}; los incluirán siempre que tu orden todavía no haya salido.${tailShortEs}`
      }
      if (cat === 'missing_or_wrong_item' && isNoTicket) {
        return turnLangGuess === 'en'
          ? `Thank you${nameSuffix}. I logged your report on the ${custSpokenCompact} manager's screen, though without the ticket number it is unlikely we can verify the mistake when reviewing preparation. The manager will reach out ${storeOpen ? 'as soon as possible' : 'as soon as we reopen'}.${tailEn}`
          : `Gracias${nameSuffix}. Registré tu reporte en la pantalla del gerente en ${custSpokenCompact}, aunque te reitero que sin el número de ticket es poco probable determinar la equivocación al revisar la preparación. El gerente se comunicará contigo ${storeOpen ? 'en cuanto sea posible' : 'al reabrir'}.${tailShortEs}`
      }
      if (cat === 'missing_or_wrong_item') {
        const shortTk = tkLabel.split('(')[0].trim() || tkLabel
        return turnLangGuess === 'en'
          ? `All set${nameSuffix}. I sent a priority alert to the ${custSpokenCompact} manager's screen with ticket ${shortTk} to review how your order was prepared, and they will reach out ${storeOpen ? 'as soon as possible' : 'as soon as we reopen'}.${tailEn}`
          : `Listo${nameSuffix}. Ya envié la alerta prioritaria a la pantalla del gerente en ${custSpokenCompact} con tu ticket ${shortTk} para revisar la preparación de tu orden y se comunicará contigo ${storeOpen ? 'en cuanto sea posible' : 'en cuanto abramos'}.${tailEs}`
      }
      return turnLangGuess === 'en'
        ? `All set${nameSuffix}. I sent a priority alert to the ${custSpokenCompact} manager's screen, and they will reach out ${storeOpen ? 'as soon as possible' : 'as soon as we reopen'}.${callerIncludedClosingTail ? ' Thank you for calling Tacos Gavilan, have a wonderful day!' : ' How else can I help you?'}`
        : `Listo${nameSuffix}. Ya envié la alerta prioritaria a la pantalla del gerente en ${custSpokenCompact} y se comunicará contigo ${storeOpen ? 'en cuanto sea posible' : 'en cuanto abramos'}.${tailEs}`
    }

    if (cbRes && !cbRes.success && Array.isArray(cbRes.missingOrderReviewFields) && cbRes.missingOrderReviewFields.length > 0) {
      const miss: string[] = cbRes.missingOrderReviewFields
      const needsTk = miss.some((m) => m.includes('ticket'))
      const needsDt = miss.some((m) => m.includes('fecha'))
      if (turnLangGuess === 'en') {
        const whatEn = needsTk && needsDt ? 'your ticket number and purchase date' : needsTk ? 'your ticket number' : 'the date of your purchase'
        const noTkNoteEn = needsTk ? ' Without the ticket number, it is unlikely we can verify the mistake.' : ''
        return `Thank you${nameSuffix}. To review how your order was prepared, could you share ${whatEn}?${noTkNoteEn}`
      }
      const whatEs = needsTk && needsDt ? 'tu número de ticket y la fecha de compra' : needsTk ? 'tu número de ticket' : 'qué día fue tu compra'
      const noTkNoteEs = needsTk ? ' Te recuerdo que sin el número de ticket es poco probable determinar la equivocación.' : ''
      return `Gracias${nameSuffix}. Para revisar la preparación de tu orden, ¿me confirmas ${whatEs}?${noTkNoteEs}`
    }

    if (cbRes && !cbRes.success && cbRes.missingCallerPhone) {
      return turnLangGuess === 'en'
        ? `Could you please share your name and a valid 10-digit phone number with area code so I can send the alert?`
        : `¿Me compartes por favor tu nombre y un número de teléfono válido de 10 dígitos con código de área para enviar el aviso?`
    }
    return null
  }

  // Fast-Path Determinista de Captura de Datos (< 280 ms extremo a extremo, 0 llamadas LLM):
  // Cuando el cliente está en un escenario claro de recado/ticket/condimentos/sucursal equivocada y YA proporcionó en la llamada
  // un teléfono válido de 10 dígitos + su nombre real, ejecutamos `create_manager_callback` al instante sin esperar red de Gemini.
  const asksUnrelatedMenuOrHours = /\b(cuanto cuesta|precio|a que hora|horario|aceptan|tienen drive|how much|what time)\b/i.test(normUser)
  if (!replyText && !hadPriorCallbackInCall && isCallbackOrPostOrderTopic && !asksUnrelatedMenuOrHours) {
    const store10Fast = extractPhoneDigits(store.phone).slice(-10)
    const twilio10Fast = extractPhoneDigits(config.twilio_phone_number).slice(-10)
    const allowDev555Fast = source === 'simulator' && /^TEST_SMOKE_/i.test(callSid)
    const parsedCb = inspectMissingCallbackGuard({
      replyText: 'ya envie la alerta al gerente',
      transcript,
      blockedStoreTenDigits: [store10Fast, twilio10Fast],
      source,
      callerNumber,
      allowDev555: allowDev555Fast
    })

    if (parsedCb.callerPhone && parsedCb.callerName && parsedCb.callerName !== 'Cliente en línea') {
      const metaForFastCb = inferCallMetadata(allUserTurnsText, toolsUsed, true)
      const fastReason =
        metaForFastCb.primaryIntent === 'condiments_note'
          ? 'condiments_note'
          : metaForFastCb.primaryIntent === 'wrong_store_order'
            ? 'wrong_store_order'
            : metaForFastCb.primaryIntent === 'delivery_issue'
              ? 'delivery_issue'
              : metaForFastCb.primaryIntent === 'complaint_missing_item'
                ? /\b(cobro|cobraron|reembolso|refund|overcharged|billing)\b/i.test(normAllUserForScope)
                  ? 'billing_refund'
                  : 'missing_or_wrong_item'
                : metaForFastCb.primaryIntent === 'lost_and_found'
                  ? 'lost_item'
                  : metaForFastCb.primaryIntent === 'employee_callout'
                    ? 'employee_callout'
                    : metaForFastCb.primaryIntent === 'vendor_service'
                      ? 'vendor_arrival'
                      : ''
      const fastTargetStore =
        fastReason === 'wrong_store_order'
          ? inferMentionedOtherStore(allActiveStores, store.id, allUserTurnsText)
          : null
      const isThirdPartyAppModifyOrWrongStore =
        /\b(uber(?:\s*eats)?|doordash|door dash|grubhub|postmates)\b/i.test(normAllUserForScope) &&
        (/\b(modificar|cambiar|cancelar|direccion|modify|change|cancel|address|sucursal equivocada|wrong store|wrong location)\b/i.test(
          normAllUserForScope
        ) &&
          fastReason !== 'condiments_note')
      const canFastExecute =
        Boolean(fastReason) &&
        !isThirdPartyAppModifyOrWrongStore &&
        (fastReason !== 'wrong_store_order' || Boolean(fastTargetStore)) &&
        (fastReason !== 'condiments_note' || Boolean(parsedCb.ticketNumber))

      if (canFastExecute) {
        const fastCallerType =
          metaForFastCb.callerCategory === 'employee'
            ? 'employee'
            : metaForFastCb.callerCategory === 'vendor'
              ? 'vendor'
              : metaForFastCb.callerCategory === 'delivery_driver'
                ? 'delivery_driver'
                : 'customer'
        try {
          const fastToolRes = await executeTool('create_manager_callback', {
            caller_name: parsedCb.callerName,
            caller_phone: parsedCb.callerPhone,
            caller_type: fastCallerType,
            urgency:
              fastReason === 'condiments_note'
                ? 'normal'
                : /\b(emergencia|emergency|intoxic|got sick|cobro doble|overcharged|fraud)\b/i.test(normAllUserForScope)
                  ? 'critical'
                  : 'high',
            reason_category: fastReason,
            reason_summary: parsedCb.summary || userText,
            ...(parsedCb.ticketNumber ? { ticket_or_order_number: parsedCb.ticketNumber } : {}),
            ...(parsedCb.orderDate ? { order_date: parsedCb.orderDate } : {}),
            ...(fastTargetStore ? { target_store_id: Number(fastTargetStore.id) } : {})
          })
          if (fastToolRes?.success) {
            toolsUsed.push('create_manager_callback')
          }
          transcript.push({
            role: 'tool',
            text: JSON.stringify(fastToolRes),
            timestamp: new Date().toISOString(),
            toolName: 'create_manager_callback'
          })
          const fastReply = composeInstantCallbackTurnReply(fastToolRes, parsedCb.callerName)
          if (fastReply) {
            replyText = fastReply
          }
        } catch (fastCbErr) {
          console.warn('[phone-agent] Fast callback path cedió a Gemini:', fastCbErr)
        }
      }
    }
  }

  let pinnedModelForTurn: string | null = null
  for (let round = 0; round < 3 && !replyText; round++) {
    let data: any
    try {
      const resGemini = await callGeminiPhoneWithFailover(
        {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          tools: turnTools,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024
          }
        },
        turnDeadline,
        pinnedModelForTurn
      )
      data = resGemini.data
      if (!pinnedModelForTurn && resGemini.usedModel) {
        pinnedModelForTurn = resGemini.usedModel
      }
    } catch (e) {
      console.error('[phone-agent] Gemini no disponible en este turno:', e)
      geminiFailed = true
      break
    }

    const candidateContent = data?.candidates?.[0]?.content
    const parts: any[] = candidateContent?.parts || []
    const fnCallParts = parts.filter((p) => p?.functionCall)

    if (fnCallParts.length === 0) {
      replyText = parts
        .filter((p) => !p?.thought)
        .map((p) => p.text || '')
        .join(' ')
        .replace(/[*#_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      break
    }

    // Gemini puede pedir VARIAS herramientas en paralelo: se ejecutan todas y se responden en el mismo orden
    const responseParts: any[] = []
    for (const fnPart of fnCallParts) {
      const toolName = String(fnPart.functionCall?.name || '')
      const toolArgs = fnPart.functionCall?.args || {}
      toolsUsed.push(toolName)
      let toolResult: any
      try {
        toolResult = await executeTool(toolName, toolArgs)
      } catch (toolErr: any) {
        console.error(`[phone-agent] Error en herramienta ${toolName}:`, toolErr)
        toolResult = { success: false, error: String(toolErr?.message || toolErr).slice(0, 300) }
      }
      transcript.push({
        role: 'tool',
        text: JSON.stringify(toolResult),
        timestamp: new Date().toISOString(),
        toolName
      })
      responseParts.push({ functionResponse: { name: toolName, response: toolResult } })
    }

    // Atajo de Cero Ronda Extra (~1.8-2.4s ahorrados): cuando la única herramienta invocada fue create_manager_callback
    // y el cliente no está haciendo otra pregunta adicional de menú/horarios, componemos la confirmación exacta en 0 ms.
    if (fnCallParts.length === 1 && fnCallParts[0]?.functionCall?.name === 'create_manager_callback' && !asksUnrelatedMenuOrHours) {
      const cbRes = responseParts[0]?.functionResponse?.response
      const rawCallerName = String(fnCallParts[0]?.functionCall?.args?.caller_name || callbackCreated?.caller_name || '').trim()
      const composed = composeInstantCallbackTurnReply(cbRes, rawCallerName)
      if (composed) {
        replyText = composed
        break
      }
    }

    contents.push(candidateContent)
    contents.push({ role: 'user', parts: responseParts })
  }

  // Política oficial Tacos Gavilan: cero desvíos a teléfonos personales; escalación vía Alerta Prioritaria en PC de tienda
  const shouldTransferToPhone: string | null = null

  // Blindaje determinista: si un modelo rápido confirmó envío de alerta sin invocar `create_manager_callback`,
  // persistimos el recado con los datos reales dichos por quien llama o evitamos una confirmación falsa si falta el teléfono.
  const preGuardMeta = inferCallMetadata(normalizedUserForMatch, toolsUsed, false)
  if (
    !callbackCreated &&
    !hadPriorCallbackInCall &&
    !geminiFailed &&
    replyText &&
    preGuardMeta.primaryIntent !== 'spam' &&
    preGuardMeta.primaryIntent !== 'job_inquiry'
  ) {
    const store10 = extractPhoneDigits(store.phone).slice(-10)
    const twilio10 = extractPhoneDigits(config.twilio_phone_number).slice(-10)
    const allowDev555 = source === 'simulator' && /^TEST_SMOKE_/i.test(callSid)
    const guard = inspectMissingCallbackGuard({
      replyText,
      transcript,
      blockedStoreTenDigits: [store10, twilio10],
      source,
      callerNumber,
      allowDev555
    })
    if (guard.claimedSent) {
      if (guard.callerPhone) {
        const inferredForCb = inferCallMetadata(guard.summary || userText, toolsUsed, true)
        const inferredReason =
          inferredForCb.primaryIntent === 'condiments_note'
            ? 'condiments_note'
            : inferredForCb.primaryIntent === 'wrong_store_order'
              ? 'wrong_store_order'
              : inferredForCb.primaryIntent === 'delivery_issue'
                ? 'delivery_issue'
                : inferredForCb.primaryIntent === 'complaint_missing_item'
                  ? /\b(cobro|cobraron|reembolso|refund|overcharged|billing)\b/i.test(normalizeSearchText(guard.summary))
                    ? 'billing_refund'
                    : 'missing_or_wrong_item'
                  : inferredForCb.primaryIntent === 'lost_and_found'
                    ? 'lost_item'
                    : inferredForCb.primaryIntent === 'employee_callout'
                      ? 'employee_callout'
                      : inferredForCb.primaryIntent === 'vendor_service'
                        ? 'vendor_arrival'
                        : 'other'
        const inferredCallerType =
          inferredForCb.callerCategory === 'employee'
            ? 'employee'
            : inferredForCb.callerCategory === 'vendor'
              ? 'vendor'
              : inferredForCb.callerCategory === 'delivery_driver'
                ? 'delivery_driver'
                : 'customer'
        const inferredTargetStore =
          inferredReason === 'wrong_store_order'
            ? inferMentionedOtherStore(allActiveStores, store.id, `${guard.summary} ${allUserTurnsText}`)
            : null
        try {
          const forcedRes = await executeTool('create_manager_callback', {
            caller_name: guard.callerName,
            caller_phone: guard.callerPhone,
            caller_type: inferredCallerType,
            urgency:
              inferredReason === 'condiments_note'
                ? 'normal'
                : /\b(emergencia|emergency|intoxic|got sick|cobro doble|overcharged|fraud)\b/i.test(normalizeSearchText(guard.summary))
                  ? 'critical'
                  : 'high',
            reason_category: inferredReason,
            reason_summary: guard.summary || userText,
            ...(guard.ticketNumber ? { ticket_or_order_number: guard.ticketNumber } : {}),
            ...(guard.orderDate ? { order_date: guard.orderDate } : {}),
            ...(inferredTargetStore ? { target_store_id: Number(inferredTargetStore.id) } : {})
          })
          if (forcedRes?.success) {
            toolsUsed.push('create_manager_callback')
          }
          transcript.push({
            role: 'tool',
            text: JSON.stringify(forcedRes),
            timestamp: new Date().toISOString(),
            toolName: 'create_manager_callback'
          })
          if (!forcedRes?.success) {
            const gatePrompt = composeInstantCallbackTurnReply(forcedRes, guard.callerName)
            replyText =
              gatePrompt ||
              (turnLangGuess === 'en'
                ? 'I ran into an issue saving your callback request. Could you please confirm your full name and 10-digit phone number so I can try again?'
                : 'Tuve un inconveniente técnico al guardar tu recado. ¿Me confirmas tu nombre completo y teléfono de 10 dígitos para intentarlo de nuevo?')
          }
        } catch (cbErr) {
          console.error('[phone-agent] Error en blindaje de recado obligatorio:', cbErr)
          replyText =
            turnLangGuess === 'en'
              ? 'I had a technical issue saving your callback alert right now. Could you repeat your 10-digit phone number so we can log it?'
              : 'Tuve un inconveniente técnico al registrar la alerta ahorita. ¿Me repites tu teléfono de 10 dígitos para volver a intentarlo?'
        }
      } else {
        replyText =
          turnLangGuess === 'en'
            ? "We don't transfer calls to managers' personal phones, but I'd gladly send a priority alert to the store manager's screen. Could you give me your name and 10-digit phone number?"
            : 'No transferimos llamadas a celulares personales de los gerentes, pero con gusto envío una alerta prioritaria a la pantalla del gerente en sucursal. ¿Me compartes tu nombre y número de teléfono de 10 dígitos para que se comunique contigo?'
      }
    }
  }

  if (!replyText) {
    if (callbackCreated) {
      const targetMetaStore = resolvedCallbackTargetStore || store
      const custSpokenCompact = formatCustomerStoreName(targetMetaStore, turnLangGuess, { style: 'spoken_compact' })
      const targetSched =
        Number(targetMetaStore.id) !== Number(store.id)
          ? evaluateStoreSchedulePure({
              storeId: targetMetaStore.id,
              storeName: targetMetaStore.name,
              weeklyHours: targetMetaStore.weekly_hours,
              specialHours: ((ctx as any).allSpecialHours || []).filter(
                (sh: any) => sh.store_id === null || Number(sh.store_id) === Number(targetMetaStore.id)
              )
            })
          : scheduleEval
      if (resolvedCallbackCategory === 'condiments_note') {
        replyText =
          turnLangGuess === 'en'
            ? `Your condiment note is already on the packing screen for our ${custSpokenCompact} location, so the team will include it as long as your order has not left yet. Is there anything else I can help you with?`
            : `Tu nota de condimentos ya quedó en la pantalla de empaque de ${custSpokenCompact} para que los agreguen siempre que tu orden todavía no haya salido. ¿Te puedo ayudar con algo más?`
      } else if (!targetSched.isOpenNow) {
        replyText =
          turnLangGuess === 'en'
            ? `Since our ${custSpokenCompact} location is currently closed, your priority message has been saved so the manager can call you back as soon as we reopen. Is there anything else I can help you with?`
            : `Como nuestra sucursal de ${custSpokenCompact} está cerrada en este momento, dejé tu recado prioritario registrado para que el gerente te devuelva la llamada en cuanto abramos. ¿Te puedo ayudar con algo más?`
      } else {
        replyText =
          turnLangGuess === 'en'
            ? `Your message is already on the ${custSpokenCompact} manager's screen, and they will reach out to you as soon as possible. Is there anything else I can help you with?`
            : `Tu recado ya está en la pantalla del gerente de ${custSpokenCompact} y se comunicará contigo en cuanto sea posible. ¿Te puedo ayudar con algo más?`
      }
    } else if (geminiFailed) {
      // Respaldo determinista en memoria si Gemini agotó presupuesto o cuota: priorizar incidencias/recados antes que FAQs genéricas
      if (preGuardMeta.primaryIntent === 'delivery_issue') {
        replyText =
          turnLangGuess === 'en'
            ? 'For refunds or order edits on Uber Eats, DoorDash, or Grubhub, please use the Help section inside your delivery app. If you need us to alert the store, please share your name, 10-digit phone number, and order code.'
            : 'Para reembolsos o cambios en pedidos de Uber Eats, DoorDash o Grubhub, repórtalo en la sección Ayuda de tu aplicación. Si deseas avisar a la tienda, dime tu nombre, teléfono de 10 dígitos y código de orden.'
      } else if (preGuardMeta.primaryIntent === 'wrong_store_order') {
        replyText =
          turnLangGuess === 'en'
            ? 'Paid orders cannot be transferred automatically between locations. For app orders please cancel right away in the app; for tacosgavilan.com pickup orders, share the store where it landed, your name, 10-digit phone, and order number.'
            : 'No podemos mover pedidos pagados entre sucursales automáticamente. Si pediste por app, cancélalo de inmediato en la app; si fue en tacosgavilan.com para recoger, dime en qué sucursal cayó, tu nombre, teléfono de 10 dígitos y número de orden.'
      } else if (preGuardMeta.primaryIntent === 'condiments_note') {
        replyText =
          turnLangGuess === 'en'
            ? 'I can send a condiment packing note as long as your order has not left yet. Please share your name, order number, requested condiments, and 10-digit phone number.'
            : 'Con gusto envío la nota de condimentos a empaque siempre que tu orden aún no haya salido. ¿Me das tu nombre, número de orden, qué condimentos deseas y tu teléfono de 10 dígitos?'
      } else if (preGuardMeta.primaryIntent === 'complaint_missing_item') {
        replyText =
          turnLangGuess === 'en'
            ? 'I apologize for the inconvenience. To review how your order was prepared, may I have your ticket number, date, name, and 10-digit phone number? Without the ticket, it is unlikely we can verify the mistake.'
            : 'Lamento el inconveniente. Para revisar la preparación de tu orden, ¿me das tu número de ticket, fecha, nombre y teléfono de 10 dígitos? Sin el ticket es poco probable determinar la equivocación.'
      } else if (['lost_and_found', 'employee_callout'].includes(preGuardMeta.primaryIntent)) {
        replyText =
          turnLangGuess === 'en'
            ? "We don't transfer calls to managers' personal phones, but I can send a priority alert to the manager screen. Could you please share your name and 10-digit phone number?"
            : 'No transferimos llamadas a celulares personales, pero puedo enviar una alerta prioritaria a la pantalla del gerente en sucursal. ¿Me compartes tu nombre y número de teléfono de 10 dígitos?'
      } else if (/\b(drive|ventanilla)\b/i.test(normUser) && allActiveStores.length > 0) {
        const dtNames = allActiveStores
          .filter((s) => s.has_drive_thru)
          .map((s) => formatCustomerStoreName(s, turnLangGuess, { style: 'spoken_compact' }))
        const dtListEs = dtNames.length > 1 ? `${dtNames.slice(0, -1).join(', ')} y ${dtNames[dtNames.length - 1]}` : dtNames.join(', ')
        const dtListEn = dtNames.length > 1 ? `${dtNames.slice(0, -1).join(', ')}, and ${dtNames[dtNames.length - 1]}` : dtNames.join(', ')
        replyText =
          turnLangGuess === 'en'
            ? `Our six locations with Drive-Thru are ${dtListEn}. Would you like hours or address for any of them?`
            : `Las seis sucursales con Drive-Thru son ${dtListEs}. ¿Te doy el horario o dirección de alguna?`
      } else if (wantsFiestaContext && detectedGuestCount) {
        replyText = turnLangGuess === 'en' ? platterInfo.recommendationEn : platterInfo.recommendationEs
      } else if (preFetchedMenu.length > 0 && /\b(precio|cuesta|cuanto|price|cost|how much)\b/i.test(normUser)) {
        const top = preFetchedMenu.slice(0, 3).map((m) => `${m.name} (${m.priceFormatted})`)
        const custSpokenCompact = formatCustomerStoreName(store, turnLangGuess, { style: 'spoken_compact' })
        replyText =
          turnLangGuess === 'en'
            ? `In ${custSpokenCompact}, ${top.join(', ')}. Can I check anything else?`
            : `En ${custSpokenCompact}, ${top.join(', ')}. ¿Te ayudo con algo más?`
      } else if (/\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|direccion|ubicacion|address)\b/i.test(normUser)) {
        replyText =
          turnLangGuess === 'en'
            ? `${scheduleEval.statusMessageEn} Our address is ${spokenStoreAddress}.`
            : `${scheduleEval.statusMessageEs} Nuestra dirección es ${spokenStoreAddress}.`
      } else {
        replyText =
          turnLangGuess === 'en'
            ? 'Sorry, I had a brief technical issue. Could you please repeat your question?'
            : 'Disculpa, tuve un problema técnico momentáneo. ¿Me puedes repetir tu pregunta, por favor?'
      }
    } else {
      replyText =
        turnLangGuess === 'en'
          ? `${scheduleEval.statusMessageEn} How else can I help you?`
          : `${scheduleEval.statusMessageEs} ¿Te puedo ayudar con algo más?`
    }
  }

  const meta = inferCallMetadata(normalizedUserForMatch, toolsUsed, Boolean(callbackCreated))
  if (forcedSpamFastPath) {
    meta.callerCategory = 'spam'
    meta.primaryIntent = 'spam'
    meta.resolvedByAi = true
  }
  if (
    callbackCreated &&
    (resolvedCallbackCategory === 'wrong_store_order' ||
      resolvedCallbackCategory === 'condiments_note' ||
      resolvedCallbackCategory === 'delivery_issue')
  ) {
    meta.primaryIntent = resolvedCallbackCategory
  }

  // Idioma FINAL = idioma real del texto generado (se detecta antes de acentuar topónimos como "Los Ángeles")
  const finalLang: PhoneLang = detectPhoneTextLanguage(replyText, turnLangGuess)
  // Sanitizar muletillas iniciales ("¡Sí!", "¡Claro que sí!", "Hola."), expandir abreviaturas viales y recortar en fin de oración
  replyText = clampPhoneReplyLength(sanitizePhoneReplyText(replyText, finalLang), 620)

  transcript.push({
    role: 'assistant',
    text: replyText,
    timestamp: new Date().toISOString()
  })

  const normEnd = normalizeSearchText(userText)
  const prevAssistantText =
    transcript
      .slice(0, -1)
      .filter((t) => t.role === 'assistant')
      .slice(-1)[0]?.text || ''
  const assistantLeftOpenQuestion = replyText.trim().endsWith('?') || isPromptExpectingPhoneOrDetails(replyText)
  const shouldHangup =
    !shouldTransferToPhone &&
    !assistantLeftOpenQuestion &&
    (meta.primaryIntent === 'spam' ||
      isCallerEndingConversation({
        userText,
        normUser: normEnd,
        prevAssistantText
      }) ||
      didAssistantConcludeCall(replyText))

  const finalCallRecord = await ensureCallRecord()
  const rawStartedAtMs = finalCallRecord.started_at ? new Date(finalCallRecord.started_at).getTime() : NaN
  const startedAtMs = Number.isFinite(rawStartedAtMs) ? rawStartedAtMs : Date.now()
  const durationSeconds = Math.max(5, Math.round((Date.now() - startedAtMs) / 1000))

  // Estado persistente: una llamada ya terminada (ended_at o estado terminal de cierre) jamás cambia a callback_requested por un turno tardío
  const TERMINAL_ENDED_STATUSES = new Set(['completed', 'canceled', 'cancelled', 'busy', 'failed', 'no-answer'])
  const callAlreadyTerminated =
    Boolean(finalCallRecord.ended_at) ||
    TERMINAL_ENDED_STATUSES.has(String(finalCallRecord.status || '').toLowerCase())
  const wasTransferred = Boolean(shouldTransferToPhone) || finalCallRecord.status === 'transferred'
  const callbackEverRequested = Boolean(callbackCreated) || finalCallRecord.status === 'callback_requested'

  const nextStatus = callAlreadyTerminated
    ? String(finalCallRecord.status || 'completed')
    : wasTransferred
      ? 'transferred'
      : callbackEverRequested
        ? 'callback_requested'
        : shouldHangup
          ? 'completed'
          : 'in_progress'

  const INTENT_PRIORITY: Record<string, number> = {
    employee_callout: 100,
    wrong_store_order: 97,
    complaint_missing_item: 95,
    delivery_issue: 92,
    lost_and_found: 90,
    vendor_service: 85,
    spam: 80,
    condiments_note: 78,
    delivery_driver: 75,
    fiesta_platters: 65,
    order_by_phone: 60,
    job_inquiry: 55,
    payment_ebt: 50,
    menu_prices: 40,
    location_drivethru: 35,
    hours: 30,
    general: 10
  }
  const prevIntent = String(finalCallRecord.primary_intent || 'general')
  const prevPrio = INTENT_PRIORITY[prevIntent] ?? 10
  const nextPrio = INTENT_PRIORITY[meta.primaryIntent] ?? 10
  const callbackRefinedOverride =
    Boolean(callbackCreated) &&
    (resolvedCallbackCategory === 'wrong_store_order' ||
      resolvedCallbackCategory === 'condiments_note' ||
      resolvedCallbackCategory === 'delivery_issue')
  const resolvedIntent = callbackRefinedOverride
    ? resolvedCallbackCategory
    : nextPrio >= prevPrio && meta.primaryIntent !== 'general'
      ? meta.primaryIntent
      : prevIntent !== 'general'
        ? prevIntent
        : meta.primaryIntent

  // Respaldo: capturar unanswered_question si la IA admite falta de dato oficial de negocio sin haber invocado la herramienta
  if (
    !unansweredFlagged &&
    /\b(no cuento con (?:esa )?(?:informaci[oó]n|pol[ií]tica) oficial|no contamos con (?:una )?(?:informaci[oó]n|pol[ií]tica) oficial|no tengo ese dato oficial|don't have (?:an? )?official (?:information|policy)|do not have (?:that|an? official) policy)\b/i.test(
      replyText
    ) &&
    !/\b(chiste|joke|cancion|song|banda|rock|heroes del silencio|futbol|soccer|nfl|nba|clima|weather|menudo|birria|pozole|suadero|tripa|cerveza|pastel|birthday\s*cake|churro)\b/i.test(
      normUser
    )
  ) {
    unansweredFlagged = userText.slice(0, 300)
  }

  const updatePayload: Record<string, any> = {
    language: finalLang,
    caller_category:
      finalCallRecord.caller_category && finalCallRecord.caller_category !== 'customer' && meta.callerCategory === 'customer'
        ? finalCallRecord.caller_category
        : meta.callerCategory,
    primary_intent: resolvedIntent,
    status: nextStatus,
    resolved_by_ai:
      wasTransferred ||
      callbackEverRequested ||
      geminiFailed ||
      Boolean(unansweredFlagged) ||
      isPromptExpectingPhoneOrDetails(replyText) ||
      ['complaint_missing_item', 'lost_and_found', 'employee_callout'].includes(resolvedIntent)
        ? false
        : meta.resolvedByAi,
    duration_seconds: durationSeconds,
    turns_count: Number(finalCallRecord.turns_count || 0) + 1,
    summary: `${userText.slice(0, 120)} -> ${replyText.slice(0, 140)}`,
    transcript
  }

  if (unansweredFlagged) {
    updatePayload.unanswered_question = unansweredFlagged
  }
  if (shouldHangup) {
    updatePayload.ended_at = new Date().toISOString()
  }

  const flushDbPromise = (async () => {
    const buildNonTerminalSafePayload = () => {
      const {
        status: _omitStatus,
        ended_at: _omitEnded,
        duration_seconds: _omitDur,
        resolved_by_ai: _omitResolved,
        ...safeFields
      } = updatePayload
      return callbackCreated ? { ...safeFields, resolved_by_ai: false } : safeFields
    }
    const targetTurns = Number(updatePayload.turns_count || 1)

    // Si la llamada ya había terminado al iniciar/cerrar este turno, jamás alterar status, ended_at ni duration_seconds de un cierre previo
    if (callAlreadyTerminated) {
      const { error: updateErr } = await supabaseAdmin
        .from('phone_calls')
        .update(buildNonTerminalSafePayload())
        .eq('id', finalCallRecord.id)
        .lt('turns_count', targetTurns)
      if (updateErr) {
        console.error('[phone-agent] No se pudo actualizar llamada terminada:', updateErr.message)
        throw updateErr
      }
      return
    }

    if (nextStatus === 'in_progress') {
      const { status: _omitStatus, ...nonStatusPayload } = updatePayload
      const { data: inProgRows, error: updateErr } = await supabaseAdmin
        .from('phone_calls')
        .update(nonStatusPayload)
        .eq('id', finalCallRecord.id)
        .lt('turns_count', targetTurns)
        .is('ended_at', null)
        .not('status', 'in', '("completed","canceled","cancelled","busy","failed","no-answer")')
        .select('id')
      if (updateErr) {
        console.error('[phone-agent] No se pudo actualizar la bitácora de la llamada:', updateErr.message)
        throw updateErr
      }
      if (!inProgRows || inProgRows.length === 0) {
        // /api/phone/status cerró la llamada mientras corría este turno (o un turno más nuevo ya avanzó turns_count):
        // guardar transcript/intent sin pisar CallDuration ni ended_at, respetando monotonicidad de turns_count
        const { error: fallbackErr } = await supabaseAdmin
          .from('phone_calls')
          .update(buildNonTerminalSafePayload())
          .eq('id', finalCallRecord.id)
          .lt('turns_count', targetTurns)
        if (fallbackErr) {
          console.error('[phone-agent] Error guardando transcript en llamada cerrada en paralelo:', fallbackErr.message)
          throw fallbackErr
        }
      }
      return
    }

    // Transición a 'callback_requested' / 'transferred' / 'completed': exigir atómicamente que /api/phone/status no haya cerrado la llamada mientras corría el turno
    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from('phone_calls')
      .update(updatePayload)
      .eq('id', finalCallRecord.id)
      .lt('turns_count', targetTurns)
      .is('ended_at', null)
      .not('status', 'in', '("completed","canceled","cancelled","busy","failed","no-answer")')
      .select('id')

    if (updateErr) {
      console.error('[phone-agent] No se pudo actualizar estado de la llamada:', updateErr.message)
      throw updateErr
    }

    // Si /api/phone/status cerró la llamada en paralelo (updatedRows vacío), guardar transcript e intent sin cambiar status ni CallDuration
    if (!updatedRows || updatedRows.length === 0) {
      const { error: fallbackErr } = await supabaseAdmin
        .from('phone_calls')
        .update(buildNonTerminalSafePayload())
        .eq('id', finalCallRecord.id)
        .lt('turns_count', targetTurns)
      if (fallbackErr) {
        console.error('[phone-agent] Error guardando transcript en llamada recién cerrada:', fallbackErr.message)
        throw fallbackErr
      }
    }
  })()

  if (!deferDbFlush) {
    await flushDbPromise
  } else {
    void flushDbPromise.catch(() => null)
  }

  return {
    callId: finalCallRecord.id,
    replyText,
    language: finalLang,
    voiceId,
    primaryIntent: updatePayload.primary_intent,
    toolsUsed,
    callbackCreated: callbackWasNew ? callbackCreated : null,
    shouldTransferToPhone,
    shouldHangup,
    isCanonicalReply,
    transcript,
    storeContext: ctx,
    flushDbPromise
  }
}

/**
 * Verifica criptográficamente la firma `X-Twilio-Signature` en webhooks entrantes de Twilio,
 * reconstruyendo la URL pública con `x-forwarded-proto` y `x-forwarded-host` sanitizados en Vercel.
 */
export function verifyTwilioWebhookSignature(
  request: Request,
  formParams: Record<string, string>
): { valid: boolean; reason?: string } {
  const rawToken = (process.env.TWILIO_AUTH_TOKEN || '').trim().replace(/^["']|["']$/g, '')
  if (!rawToken) {
    // Fail-closed en producción o cualquier despliegue de Vercel (production / preview)
    const isProductionOrDeployed =
      process.env.NODE_ENV === 'production' ||
      Boolean(process.env.VERCEL) ||
      (Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== 'development')
    if (isProductionOrDeployed) {
      return { valid: false, reason: 'missing_twilio_auth_token_in_deployment' }
    }
    return { valid: true, reason: 'no_auth_token_configured_dev_only' }
  }

  const signature = (request.headers.get('x-twilio-signature') || '').trim()
  if (!signature) {
    return { valid: false, reason: 'missing_x_twilio_signature' }
  }

  const reqUrl = new URL(request.url)
  const rawProtoCandidate = (request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')).split(',')[0].trim().toLowerCase()
  const rawProto = rawProtoCandidate === 'http' || rawProtoCandidate === 'https' ? rawProtoCandidate : 'https'
  const fwdHost = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim()
  const hdrHost = (request.headers.get('host') || reqUrl.host).split(',')[0].trim()
  const safeHostRe = /^[a-zA-Z0-9.-]+(?::\d+)?$/

  const candidateBases = new Set<string>()
  const envBase = (process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '')
  if (envBase.startsWith('http')) candidateBases.add(envBase)
  if (fwdHost && safeHostRe.test(fwdHost)) {
    candidateBases.add(`${rawProto}://${fwdHost}`)
    candidateBases.add(`https://${fwdHost}`)
  }
  if (hdrHost && safeHostRe.test(hdrHost)) {
    candidateBases.add(`${rawProto}://${hdrHost}`)
    candidateBases.add(`https://${hdrHost}`)
  }

  for (const base of candidateBases) {
    const candidateUrl = `${base}${reqUrl.pathname}${reqUrl.search}`
    if (twilio.validateRequest(rawToken, signature, candidateUrl, formParams)) {
      return { valid: true, reason: 'verified' }
    }
  }
  return { valid: false, reason: 'invalid_signature' }
}

/**
 * Firma HMAC-SHA256 para las URLs de `/api/phone/tts`. Twilio (`<Play>`) no puede enviar sesión de usuario, así que
 * el servidor firma `lang|voice|text` (normalizado con `.trim()`) y el endpoint solo genera audio si la firma coincide.
 */
function getPhoneTtsSigningSecret(): string {
  return process.env.PHONE_TTS_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

export function signPhoneTtsParams(text: string, lang: string, voice: string, isDynamic = false): string {
  const secret = getPhoneTtsSigningSecret()
  if (!secret) return ''
  const cleanText = String(text || '').trim()
  const dynSuffix = isDynamic ? '|dyn=1' : ''
  return createHmac('sha256', secret).update(`${lang}|${voice}|${cleanText}${dynSuffix}`).digest('hex').slice(0, 32)
}

export function verifyPhoneTtsSignature(
  text: string,
  lang: string,
  voice: string,
  sig: string | null | undefined,
  isDynamic = false
): boolean {
  const cleanText = String(text || '').trim()
  const expected = signPhoneTtsParams(cleanText, lang, voice, isDynamic)
  if (!expected || !sig || sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch {
    return false
  }
}

const TWILIO_GATHER_HINTS =
  'Tacos Gavilan, asada, pastor, pollo, cabeza, lengua, buche, chorizo, carnitas, mulita, super mulita, torta cubana, torta milanesa, super burrito, burrito vegetariano, quesadilla, super quesadilla, sope, taco plate, super nachos, flan, cheesecake, horchata, jamaica, pina, tamarindo, champurrado, aguas frescas, huevos rancheros, huevos con chorizo, Monterey Jack, queso fresco, cotija, fiesta platter, charola, drive thru, EBT, CalFresh, Uber Eats, DoorDash, Grubhub, condimentos, salsa verde, salsa roja, cilantro, cebolla, limones, jalapenos, cancelar, modificar, West Covina, Lynwood, South Gate, Downey, Norwalk, La Puente, Huntington Park, Santa Ana, Rialto, Azusa, Bell, Hollywood, Los Angeles, Vernon, Washington, Slauson, Central, Broadway, comedor, ticket, recibo, gerente, manager'

/**
 * Genera una etiqueta `<Say>` de Twilio usando la voz Google Chirp 3 HD `Kore`
 * (misma identidad acústica femenina de Google que `Kore 3.8`, eliminando por completo Amazon Polly).
 * Twilio exige `language="es-US"` para `Google.es-US-Chirp3-HD-Kore` y `language="en-US"` para `Google.en-US-Chirp3-HD-Kore`.
 */
export function buildTwilioFallbackSay(text: string, lang: PhoneLang): string {
  const voice = lang === 'en' ? 'Google.en-US-Chirp3-HD-Kore' : 'Google.es-US-Chirp3-HD-Kore'
  const speechLang = lang === 'en' ? 'en-US' : 'es-US'
  const spokenText = normalizeTextForPhoneSpeech(text, lang) || String(text || '')
  return `<Say voice="${voice}" language="${speechLang}">${escapeXml(spokenText)}</Say>`
}

/**
 * Detecta si la última respuesta de la asistente acaba de pedir al cliente su nombre,
 * teléfono de 10 dígitos, dígitos restantes, número de ticket, fecha o detalles de un recado/queja,
 * para otorgar mayor paciencia en Twilio `<Gather>` (`speechTimeout="3"` y `timeout="7"`)
 * sin falsos positivos en confirmaciones ya enviadas ni en FAQs informativas con `¿Algo más?`.
 */
export function isPromptExpectingPhoneOrDetails(text: string | null | undefined): boolean {
  const raw = String(text || '').trim()
  if (!raw) return false
  // Evaluar por oración para que una confirmación ya enviada ("Ya envié la alerta con tu ticket 452... ¿Algo más?")
  // o una respuesta informativa ("Our store phone number is... Anything else?") NO dispare captura de datos.
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const targetFieldRe =
    /\b(tu\s+nombre|su\s+nombre|como\s+te\s+llamas|como\s+se\s+llama|tu\s+numero|su\s+numero|tu\s+telefono|su\s+telefono|numero\s+de\s+telefono|telefono\s+de\s+10|10\s+digitos|diez\s+digitos|digitos\s+restantes|ultimos\s+\d*\s*digitos|faltan\s+\d*\s*digitos|a\s+que\s+numero|numero\s+de\s+orden|numero\s+de\s+ticket|tu\s+ticket|su\s+ticket|el\s+ticket|recibo|que\s+fecha|cual\s+fecha|fecha\s+de|que\s+dia\s+fue|cuando\s+(?:compraste|fue|pasaste)|codigo\s+de\s+orden|que\s+condimentos|en\s+(?:que|cual)\s+sucursal|your\s+name|your\s+phone|your\s+number|phone\s+number|callback\s+number|best\s+number|10\s+digits|ten\s+digits|10[\s-]*digit|remaining\s+digits|last\s+\d*\s*digits|rest\s+of\s+(?:the\s+|your\s+)?number|order\s+number|order\s+code|ticket\s+number|your\s+ticket|the\s+ticket|receipt|purchase\s+date|what\s+date|which\s+date|date\s+of|when\s+did\s+you|which\s+condiments|which\s+store|which\s+location)\b/i
  const askingVerbRe =
    /\b(dame|me\s+das|me\s+confirmas|me\s+puedes|me\s+podrias|regala(?:me|nos)?|comparte(?:me|nos)?|dime|me\s+dices|indica(?:me|nos)?|necesito|falta(?:n|ron)?|cual\s+es|como\s+te\s+llamas|como\s+se\s+llama|que\s+dia\s+fue|digitos\s+restantes|remaining\s+digits|last\s+\d*\s*digits|rest\s+of|may\s+i\s+have|could\s+you|can\s+you|please\s+(?:give|share|tell|provide|confirm)|what(?:\s+is|s)?|need\s+your|missing)\b/i
  const completedStatementRe =
    /^(?:listo|gracias|perfecto|all\s+set|thank\s+you|your\s+(?:condiment\s+note|message)|our\s+store\s+phone\s+number|el\s+telefono\s+de\s+esta\s+sucursal|uber\s+eats|this\s+location\s+does\s+not|los\s+repartidores|en\s+esta\s+sucursal\s+no\s+tenemos)\b/i

  for (const s of sentences) {
    const normS = normalizeSearchText(s)
    if (!normS || !targetFieldRe.test(normS)) continue
    if (completedStatementRe.test(normS) && !s.includes('?')) continue
    if (s.includes('?') || askingVerbRe.test(normS)) {
      return true
    }
  }
  return false
}

/**
 * Genera los atributos estándar optimizados de Twilio `<Gather input="speech dtmf">`
 * con `speechModel` válido por idioma (`"phone_call"` para `en-US` y `"default"` para `es-US`, evitando Twilio 13334),
 * `speechTimeout` entero positivo (`"1"` estándar / `"3"` paciente, evitando Twilio 13335 con `speechModel`),
 * `timeout` (`"4"` estándar / `"7"` paciente), `actionOnEmptyResult="true"` y `hints`.
 */
export function buildTwilioGatherAttrs(
  lang: PhoneLang,
  actionUrl: string,
  opts?: { patient?: boolean }
): string {
  const speechLang = lang === 'en' ? 'en-US' : 'es-US'
  const speechModel = lang === 'en' ? 'phone_call' : 'default'
  const speechTimeout = opts?.patient ? '3' : '1'
  const timeout = opts?.patient ? '7' : '4'
  return `input="speech dtmf" numDigits="1" language="${speechLang}" speechTimeout="${speechTimeout}" timeout="${timeout}" actionOnEmptyResult="true" speechModel="${speechModel}" hints="${escapeXml(TWILIO_GATHER_HINTS)}" action="${escapeXml(actionUrl)}" method="POST"`
}

/**
 * Construye la URL firmada de audio telefónico (`/api/phone/tts?lang&voice&text&sig[&rate=8000][&dyn=1]`).
 * Cuando `dynamic = true` (respuestas dinámicas de `respond`), añade `&dyn=1` para omitir búsquedas/subidas lentas en Storage.
 */
export function buildPhoneTtsUrl(
  baseUrl: string,
  text: string,
  lang: PhoneLang,
  voice: string = 'Kore',
  rateOrOpts?: 8000 | 24000 | { rate?: 8000 | 24000; dynamic?: boolean }
): string {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '')
  const cleanText = String(text || '').trim()
  const rateOpt = typeof rateOrOpts === 'number' ? rateOrOpts : rateOrOpts?.rate
  const isDynamic = typeof rateOrOpts === 'object' ? Boolean(rateOrOpts?.dynamic) : false
  const sig = signPhoneTtsParams(cleanText, lang, voice, isDynamic)
  const effectiveRate = rateOpt ?? (cleanBase ? 8000 : 24000)
  const rateParam = effectiveRate === 8000 ? '&rate=8000' : ''
  const dynParam = isDynamic ? '&dyn=1' : ''
  return `${cleanBase}/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(cleanText)}&sig=${sig}${rateParam}${dynParam}`
}

/**
 * Escapa texto para incluirlo de forma segura dentro de etiquetas XML/TwiML.
 */
export function escapeXml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
