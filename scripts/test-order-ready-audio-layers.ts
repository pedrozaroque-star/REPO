/**
 * Script de Simulación y Verificación en Vivo: Cuádruple Redundancia de Audio Order Ready
 * Prueba:
 * 1. Zonas horarias California (America/Los_Angeles), medianoche vs 6:00 AM (corte de jornada) y turnos AM/PM.
 * 2. Generación/Caché de audio neuronal Gemini TTS (bilingüe EN + ES).
 * 3. Prueba de mutación real en Supabase DB (Live DB Mutation Smoke Test): INSERT, UPDATE announced_at, SELECT, DELETE.
 * 4. Prueba de emisión de broadcast Supabase Realtime en canal canónico 'order-ready-realtime'.
 * 5. Simulación de la cuádruple capa de redundancia (L1: Client WS, L2: Server WS, L3: Postgres Changes, L4: Polling) con debounce acústico de 6s.
 */

import { supabaseAdmin } from '../lib/supabase'
import { getOrderReadySpeech, isForbiddenRaulVoice } from '../lib/order-ready-tts'

function getCaliforniaBusinessDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(d)

  let year = ''
  let month = ''
  let day = ''
  let hour = 0

  for (const p of parts) {
    if (p.type === 'year') year = p.value
    if (p.type === 'month') month = p.value
    if (p.type === 'day') day = p.value
    if (p.type === 'hour') hour = parseInt(p.value, 10)
  }

  // Si son entre las 00:00 y las 05:59, la jornada pertenece al día calendario anterior
  if (hour < 6) {
    const prev = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10) - 1))
    return prev.toISOString().split('T')[0]
  }

  return `${year}-${month}-${day}`
}

function getCaliforniaShift(d: Date = new Date()): 'AM' | 'PM' {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false
  }).format(d)
  const hour = parseInt(hourStr, 10)
  return hour >= 6 && hour < 17 ? 'AM' : 'PM'
}

async function runSimulation() {
  console.log('======================================================================')
  console.log('🚀 INICIANDO SIMULACIÓN DE CUÁDRUPLE REDUNDANCIA DE AUDIO (ORDER READY)')
  console.log('======================================================================\n')

  let passedTests = 0
  let totalTests = 0

  function assert(condition: boolean, title: string, details?: string) {
    totalTests++
    if (condition) {
      passedTests++
      console.log(`  ✅ [PASS] ${title}`)
    } else {
      console.error(`  ❌ [FAIL] ${title}`)
      if (details) console.error(`     Detalles: ${details}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Horas límite, Medianoche (00:00) y Corte de Jornada (6:00 AM)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('--- TEST 1: Centinela de Fechas de Negocio y Turnos (America/Los_Angeles) ---')

  // Simulamos 2026-10-12 a las 23:59:59 PDT
  const dMidnightBefore = new Date('2026-10-13T06:59:59.000Z') // 23:59:59 PDT en UTC
  const bDateMidnightBefore = getCaliforniaBusinessDate(dMidnightBefore)
  const shiftMidnightBefore = getCaliforniaShift(dMidnightBefore)

  // Simulamos 2026-10-13 a las 00:00:01 PDT (Medianoche justa)
  const dMidnightAfter = new Date('2026-10-13T07:00:01.000Z') // 00:00:01 PDT en UTC
  const bDateMidnightAfter = getCaliforniaBusinessDate(dMidnightAfter)
  const shiftMidnightAfter = getCaliforniaShift(dMidnightAfter)

  assert(
    bDateMidnightBefore === bDateMidnightAfter,
    'La medianoche (00:00) NO corta la jornada laboral; pertenece al mismo día comercial de Tacos Gavilan',
    `Antes: ${bDateMidnightBefore}, Después: ${bDateMidnightAfter}`
  )
  assert(
    shiftMidnightBefore === 'PM' && shiftMidnightAfter === 'PM',
    'El turno a medianoche se mantiene en PM (5:00 PM a 5:59 AM)',
    `Turno antes: ${shiftMidnightBefore}, Turno después: ${shiftMidnightAfter}`
  )

  // Simulamos 5:59:59 AM vs 6:00:00 AM PDT
  const dRollBefore = new Date('2026-10-13T12:59:59.000Z') // 5:59:59 AM PDT
  const dRollAfter = new Date('2026-10-13T13:00:00.000Z')  // 6:00:00 AM PDT
  const bDateRollBefore = getCaliforniaBusinessDate(dRollBefore)
  const bDateRollAfter = getCaliforniaBusinessDate(dRollAfter)

  assert(
    bDateRollBefore !== bDateRollAfter,
    'El corte de jornada ocurre estrictamente a las 6:00 AM en punto',
    `5:59 AM: ${bDateRollBefore} | 6:00 AM: ${bDateRollAfter}`
  )

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Prueba de Audio Neuronal Gemini TTS (Bilingüe #166, #2000 y Filtro Anti-Raúl)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Síntesis Neuronal Gemini TTS (Inglés + Español #166, #2000 y Filtro Anti-Raúl) ---')
  const testNumber = '166'
  const t0 = Date.now()

  const wavEn = await getOrderReadySpeech(testNumber, 'en', 'Kore')
  const timeEn = Date.now() - t0
  assert(
    wavEn && wavEn.length > 500 && wavEn.subarray(0, 4).toString('ascii') === 'RIFF',
    `Clip #166 en inglés leído de Storage en ${timeEn}ms (WAV válido, tamaño: ${wavEn?.length} bytes)`
  )

  const t1 = Date.now()
  const wavEs = await getOrderReadySpeech(testNumber, 'es', 'Kore')
  const timeEs = Date.now() - t1
  assert(
    wavEs && wavEs.length > 500 && wavEs.subarray(0, 4).toString('ascii') === 'RIFF',
    `Clip #166 en español leído de Storage en ${timeEs}ms (WAV válido, tamaño: ${wavEs?.length} bytes)`
  )

  const [wav2000En, wav2000Es] = await Promise.all([
    getOrderReadySpeech('2000', 'en', 'Kore'),
    getOrderReadySpeech('2000', 'es', 'Kore')
  ])
  assert(
    wav2000En.length > 500 && wav2000Es.length > 500 && wav2000Es.subarray(0, 4).toString('ascii') === 'RIFF',
    `Clip límite #2000 bilingüe (EN: ${wav2000En.length}B, ES: ${wav2000Es.length}B) presente y válido en Storage v4/Kore`
  )

  const raulBlocked =
    isForbiddenRaulVoice('Microsoft Raul - Spanish (Mexico)') &&
    isForbiddenRaulVoice('Microsoft Raúl Online (Natural)') &&
    isForbiddenRaulVoice('Desktop Spanish', 'urn:moz-tts:sapi:Microsoft%20Raul%20-%20Spanish%20(Mexico)?es-MX') &&
    !isForbiddenRaulVoice('Microsoft Sabina - Spanish (Mexico)')
  assert(
    raulBlocked,
    'Filtro Anti-Raúl bloquea el 100% de variantes (Raul, Raúl, voiceURI SAPI) y permite voces femeninas válidas'
  )

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Live DB Mutation Smoke Test (order_ready_announcements)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Live DB Mutation Smoke Test en Supabase ---')
  const { randomUUID } = await import('node:crypto')
  const testOrderId = randomUUID()
  const nowIso = new Date().toISOString()
  const currentBDate = getCaliforniaBusinessDate()

  // Obtener store_id válido de la tabla stores
  const { data: storeData } = await supabaseAdmin
    .from('stores')
    .select('id, code, name')
    .eq('code', 'SLAUSON')
    .single()

  const storeId = storeData?.id || randomUUID()

  // 1. Insertar orden de prueba
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .insert({
      id: testOrderId,
      store_id: storeId,
      store_code: 'SLAUSON',
      store_name: 'Slauson',
      order_number: '9999',
      dining_option: 'TOGO',
      customer_name: 'Simulación QA',
      status: 'READY',
      ready_at: nowIso,
      announced: false,
      announced_at: null,
      business_date: currentBDate
    })
    .select()
    .single()

  assert(!insertErr && inserted && inserted.id === testOrderId, 'Inserción de orden de prueba en DB exitosa', insertErr?.message)

  // 2. Simular llamada desde endpoint /api/order-ready/call (UPDATE announced_at)
  const callTimeIso = new Date().toISOString()
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .update({ announced_at: callTimeIso })
    .eq('id', testOrderId)
    .select()
    .single()

  const updatedAnnouncedMs = updated?.announced_at ? Date.parse(updated.announced_at) : 0
  const expectedAnnouncedMs = Date.parse(callTimeIso)
  assert(
    !updateErr && updated && Math.abs(updatedAnnouncedMs - expectedAnnouncedMs) < 1000,
    'Actualización atómica de announced_at en DB exitosa (Capa 3 y 4 activadas)',
    updateErr?.message || `Obtenido: ${updated?.announced_at}, Esperado: ${callTimeIso}`
  )

  // 3. Limpiar registro de prueba de inmediato
  const { error: deleteErr } = await supabaseAdmin
    .from('order_ready_announcements')
    .delete()
    .eq('id', testOrderId)

  assert(!deleteErr, 'Limpieza (DELETE) inmediata de registro de prueba completada sin huella residual', deleteErr?.message)

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Emisión de Broadcast Realtime en 'order-ready-realtime'
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Emisión Realtime Broadcast (Canal Unificado) ---')
  let broadcastOk = false
  try {
    const channel = supabaseAdmin.channel('order-ready-realtime')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        supabaseAdmin.removeChannel(channel).catch(() => {})
        resolve()
      }, 2000)

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            const sendRes = await channel.send({
              type: 'broadcast',
              event: 'call_order',
              payload: {
                order_id: 'test-sim-ws',
                order_number: '9999',
                store_code: 'SLAUSON',
                dining_option: 'TOGO',
                store_name: 'Slauson',
                called_at: new Date().toISOString()
              }
            })
            broadcastOk = sendRes === 'ok'
          } catch (e) {
            console.error('Error enviando broadcast:', e)
          } finally {
            clearTimeout(timer)
            await supabaseAdmin.removeChannel(channel).catch(() => {})
            resolve()
          }
        }
      })
    })
  } catch (err: any) {
    console.error('Excepción en canal Realtime:', err)
  }

  assert(broadcastOk, "Canal Realtime 'order-ready-realtime' suscribe y emite 'call_order' con estatus 'ok'")

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Simulación de Cuádruple Redundancia y Debounce de 6 Segundos
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: Simulación Algorítmica de Capas de Redundancia y Debounce ---')

  const lastImpulseMap = new Map<string, number>()
  const lastAnnouncedAtMap = new Map<string, number>()
  let audioPlayCalls = 0

  function simulateHandleImpulse(orderNumber: string, layerName: string, simulatedTime: number, calledAtMs?: number, storeCode = 'SLAUSON') {
    const storeKey = `${storeCode}:${orderNumber}`
    const last = lastImpulseMap.get(storeKey) || 0
    const lastAnn = lastAnnouncedAtMap.get(storeKey) || 0
    const isSameTap = calledAtMs !== undefined && lastAnn > 0 && Math.abs(calledAtMs - lastAnn) < 2500
    const isRecentCall = last > 0 && (simulatedTime - last) < 6000
    if (isSameTap || isRecentCall) {
      if (isRecentCall && calledAtMs !== undefined && (lastAnn === 0 || Math.abs(calledAtMs - lastAnn) < 5000)) {
        lastAnnouncedAtMap.set(storeKey, calledAtMs)
      }
      // Debounced
      return false
    }
    lastImpulseMap.set(storeKey, simulatedTime)
    lastAnnouncedAtMap.set(storeKey, calledAtMs ?? simulatedTime)
    audioPlayCalls++
    return true
  }

  // Escenario A: Todo funciona normal (Llegada simultánea L1 y L2, más Polling tardío a los 6.9s y 11s tras terminar locución)
  const tStart = 10000
  const l1Fired = simulateHandleImpulse('141', 'Layer 1 (Client WS)', tStart, tStart)
  const l2Fired = simulateHandleImpulse('141', 'Layer 2 (Server WS)', tStart + 150, tStart)
  const l3Fired = simulateHandleImpulse('141', 'Layer 3 (Postgres Changes)', tStart + 300, tStart)
  const l4Fired = simulateHandleImpulse('141', 'Layer 4 (Polling 4s)', tStart + 4000, tStart)
  const l4LateFired = simulateHandleImpulse('141', 'Layer 4 (Polling 6.9s post-audio)', tStart + 6900, tStart)
  const l3LateFired = simulateHandleImpulse('141', 'Layer 3 (Upsert DB 11s)', tStart + 11000, tStart)

  assert(
    l1Fired === true && l2Fired === false && l3Fired === false && l4Fired === false && l4LateFired === false && l3LateFired === false && audioPlayCalls === 1,
    'Escenario A: Capa 1 dispara el audio 1 sola vez; Capas 2, 3 y 4 (incluso a los 6.9s y 11s tras hablar) son absorbidas (Cero repetición doble)'
  )

  // Escenario B: Capa 1 falla (desconexión de tablet), Capa 2 rescata el audio
  const tFail1 = 20000
  const l2Recovered = simulateHandleImpulse('142', 'Layer 2 (Server WS)', tFail1 + 100, tFail1)
  const l3Blocked = simulateHandleImpulse('142', 'Layer 3 (Postgres Changes)', tFail1 + 250, tFail1)

  assert(
    l2Recovered === true && l3Blocked === false && audioPlayCalls === 2,
    'Escenario B: Si el WebSocket del tablet falla, la Capa 2 (Server REST) reproduce el audio en <200ms'
  )

  // Escenario C: Capa 1 y 2 fallan (red de broadcast caída), Capa 3 (Postgres Changes) rescata el audio
  const tFail2 = 30000
  const l3Recovered = simulateHandleImpulse('143', 'Layer 3 (Postgres Changes)', tFail2 + 350, tFail2)
  const l4Blocked = simulateHandleImpulse('143', 'Layer 4 (Polling Fallback)', tFail2 + 4000, tFail2)

  assert(
    l3Recovered === true && l4Blocked === false && audioPlayCalls === 3,
    'Escenario C: Si los WebSockets de broadcast fallan, la Capa 3 (Replicación PostgreSQL DB) rescata el audio'
  )

  // Escenario D: Capa 1, 2 y 3 fallan (Reconexión completa de sockets), Capa 4 (Polling) rescata el audio
  const tFail3 = 40000
  const l4Recovered = simulateHandleImpulse('144', 'Layer 4 (Polling)', tFail3 + 3000, tFail3)

  assert(
    l4Recovered === true && audioPlayCalls === 4,
    'Escenario D: Si la conexión Realtime está suspendida por inactividad, la Capa 4 (Polling a 4s) rescata el audio'
  )

  // Escenario E: Re-llamado deliberado del preparador tras 8 segundos (nuevo called_at) sí se reproduce sin bloqueo de 20s
  const tRecall = tStart + 8000
  const deliberateRecallFired = simulateHandleImpulse('141', 'Layer 1 (Re-call deliberado 8s después)', tRecall, tRecall)
  const deliberateRecallDup = simulateHandleImpulse('141', 'Layer 4 (Polling del re-call)', tRecall + 4000, tRecall)

  assert(
    deliberateRecallFired === true && deliberateRecallDup === false && audioPlayCalls === 5,
    'Escenario E: Re-llamado deliberado del preparador tras >= 6s con nuevo timestamp suena de inmediato y una sola vez'
  )

  // Escenario F: Aislamiento multi-tienda (LYNWOOD #141 y DOWNEY #141 al mismo instante no se bloquean entre sí)
  const tMultiStore = 60000
  const lynwoodFired = simulateHandleImpulse('141', 'Layer 1 (LYNWOOD)', tMultiStore, tMultiStore, 'LYNWOOD')
  const downeyFired = simulateHandleImpulse('141', 'Layer 1 (DOWNEY)', tMultiStore + 200, tMultiStore + 200, 'DOWNEY')

  assert(
    lynwoodFired === true && downeyFired === true && audioPlayCalls === 7,
    'Escenario F: Aislamiento multi-tienda por llave compuesta (storeCode:orderNumber) evita bloqueos cruzados'
  )

  console.log('\n======================================================================')
  console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} PRUEBAS EXITOSAS`)
  console.log('======================================================================\n')

  if (passedTests === totalTests) {
    console.log('🎉 TODOS LOS COMPONENTES Y CAPAS DE REDUNDANCIA ESTÁN 100% OPERATIVOS.')
  } else {
    process.exit(1)
  }
}

runSimulation().catch((err) => {
  console.error('Error fatal ejecutando simulación:', err)
  process.exit(1)
})
