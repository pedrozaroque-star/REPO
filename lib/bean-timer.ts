/**
 * @module lib/bean-timer
 * @description Motor determinístico del Temporizador Digital Multicanal (estilo Cooper-Atkins TFS4)
 *   para la cocción exacta de Frijoles de la Olla y Frijoles Enteros en la Tableta 2 de Cocina Trasera.
 *
 * @businessRules
 * - Reemplaza el temporizador físico Cooper TFS4 de 4 canales (`T1` Azul, `T2` Verde, `T3` Amarillo, `T4` Rojo)
 *   eliminando los botones manuales `+ H / M / S -` en cocina para impedir desprogramaciones accidentales.
 * - Únicamente existen 2 botones oficiales preconfigurados y bloqueados para el personal de tienda:
 *   1. `FRIJOLES_OLLA` (Frijoles de la Olla): **11 minutos exactos** (`660` segundos -> `00:11:00`).
 *   2. `FRIJOLES_ENTEROS` (Frijoles Enteros): **12 minutos exactos** (`720` segundos -> `00:12:00`).
 * - Solo el rol `admin` puede recalibrar los tiempos oficiales globales en `bean_timer_presets`.
 * - Día laboral Tacos Gavilan (`America/Los_Angeles`): inicia a las 6:00 AM y cierra a las 5:59:59 AM del día siguiente.
 *   Turno `AM`: 06:00:00 a 16:59:59 | Turno `PM`: 17:00:00 a 05:59:59.
 * - Continuidad en corte de 6:00 AM: una olla iniciada a las 5:55 AM NO se borra ni reinicia a las 6:00 AM;
 *   continúa su cuenta regresiva real por timestamp absoluto (`expectedEndAtMs`) hasta apagarse.
 * - Al llegar a `00:00:00`, el canal entra en estado `ALARMING`, dispara la misma alarma urgente de línea
 *   (`/sounds/alarm.mp3`) amplificada por Web Audio API (`GainNode` + `DynamicsCompressorNode`) intercalada con la
 *   voz neuronal femenina oficial **`Kore`** (la misma de `Order Ready Board`), y contabiliza en vivo el tiempo
 *   excedido (`Overtime +MM:SS`) hasta que el cocinero presiona el botón rojo de Apagar, guardando `overtime_seconds`
 *   exactos en `bean_cooking_logs`.
 *
 * @dataFlow
 * - `bean_timer_presets` + `bean_cooking_logs` <-> `/api/preparador/bean-timer` <-> `BeanCookingTimerTFS4` (`localStorage` + Realtime).
 * - Clips de voz `Kore` pre-generados y normalizados en `/audio/bean-timer/*.wav` + caché en Supabase Storage (`order-ready-tts`).
 *
 * @notes
 * - Cálculos protegidos contra divisiones por cero (`0/0`), `NaN`, `Infinity` y deriva de `setInterval` en pestañas suspendidas.
 */

export const BEAN_TIMER_CHANNELS = ['T1', 'T2', 'T3', 'T4'] as const
export type BeanTimerChannelId = (typeof BEAN_TIMER_CHANNELS)[number]

export const BEAN_PRODUCT_KEYS = ['FRIJOLES_OLLA', 'FRIJOLES_ENTEROS'] as const
export type BeanProductKey = (typeof BEAN_PRODUCT_KEYS)[number]

export type BeanTimerLogStatus = 'RUNNING' | 'ALARMING' | 'COMPLETED' | 'CANCELLED'

export const DEFAULT_BEAN_TIMER_PRESETS: Record<BeanProductKey, number> = {
  FRIJOLES_OLLA: 11 * 60, // 11 minutos exactos (660s)
  FRIJOLES_ENTEROS: 12 * 60, // 12 minutos exactos (720s)
}

export const MIN_BEAN_PRESET_SECONDS = 10
export const MAX_BEAN_PRESET_SECONDS = 12 * 60 * 60 // 12 horas máx
export const MAX_ACTIVE_BEAN_TIMER_AGE_MS = 6 * 60 * 60 * 1000 // 6 horas máx de vigencia para sesiones activas

// Configuración acústica de alta potencia (misma alarma de Tableta 1 + voz oficial Kore amplificadas)
export const BEAN_TIMER_ALARM_SOUND_URL = '/sounds/alarm.mp3' as const
export const BEAN_TIMER_OFFICIAL_VOICE = 'Kore' as const
export const BEAN_TIMER_ALARM_BOOST_GAIN = 3.4 // +10.6 dB sobre HTMLAudioElement estándar hacia limitador brick-wall
export const BEAN_TIMER_ALARM_DUCKED_GAIN = 0.22 // Atenuación automática mientras habla Kore para inteligibilidad 100%
export const BEAN_TIMER_KORE_VOICE_BOOST_GAIN = 2.8 // +8.9 dB sobre WAV Kore ya masterizado a -0.18 dBFS
export const BEAN_TIMER_STATIC_WAV_VERSION = '2' as const

export interface BeanTimerPresetMap {
  FRIJOLES_OLLA: number
  FRIJOLES_ENTEROS: number
}

export interface ActiveBeanChannelSession {
  logId: string | null
  channelId: BeanTimerChannelId
  productKey: BeanProductKey
  targetSeconds: number
  startedAtMs: number
  expectedEndAtMs: number
  alarmTriggeredAtMs: number | null
  businessDate: string
  shiftPeriod: 'AM' | 'PM'
  startedBy?: string | null
}

export type BeanChannelsStateMap = Record<BeanTimerChannelId, ActiveBeanChannelSession | null>

export interface BeanChannelLiveSnapshot {
  channelId: BeanTimerChannelId
  state: 'IDLE' | 'RUNNING' | 'ALARMING'
  session: ActiveBeanChannelSession | null
  remainingSeconds: number
  overtimeSeconds: number
  progressPct: number
  hoursPart: string
  minutesPart: string
  secondsPart: string
  formattedMain: string
  formattedOvertime: string | null
}

export interface BeanCookingHistoryEntry {
  id: string
  store_id: number
  business_date: string
  shift_period: 'AM' | 'PM'
  channel_id: BeanTimerChannelId
  product_key: BeanProductKey
  target_seconds: number
  started_at: string
  expected_end_at: string
  alarm_triggered_at: string | null
  completed_at: string | null
  overtime_seconds: number
  status: BeanTimerLogStatus
  started_by: string | null
  completed_by: string | null
}

export interface ChannelColorSpec {
  id: BeanTimerChannelId
  badgeBg: string
  badgeBorder: string
  badgeText: string
  ledIdle: string
  ledRunning: string
  ledAlarm: string
  rowActiveBorder: string
  progressBar: string
}

export const COOPER_TFS4_CHANNEL_SPECS: Record<BeanTimerChannelId, ChannelColorSpec> = {
  T1: {
    id: 'T1',
    badgeBg: 'bg-blue-600',
    badgeBorder: 'border-blue-400',
    badgeText: 'text-white',
    ledIdle: 'bg-blue-950 border-blue-800/70',
    ledRunning: 'bg-blue-500 border-blue-300 shadow-[0_0_16px_rgba(59,130,246,0.9)]',
    ledAlarm: 'bg-red-500 border-red-200 shadow-[0_0_22px_rgba(239,68,68,1)]',
    rowActiveBorder: 'border-blue-500/70',
    progressBar: 'bg-blue-500',
  },
  T2: {
    id: 'T2',
    badgeBg: 'bg-emerald-600',
    badgeBorder: 'border-emerald-400',
    badgeText: 'text-white',
    ledIdle: 'bg-emerald-950 border-emerald-800/70',
    ledRunning: 'bg-emerald-500 border-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.9)]',
    ledAlarm: 'bg-red-500 border-red-200 shadow-[0_0_22px_rgba(239,68,68,1)]',
    rowActiveBorder: 'border-emerald-500/70',
    progressBar: 'bg-emerald-500',
  },
  T3: {
    id: 'T3',
    badgeBg: 'bg-amber-400',
    badgeBorder: 'border-yellow-200',
    badgeText: 'text-slate-950',
    ledIdle: 'bg-amber-950 border-amber-800/70',
    ledRunning: 'bg-amber-400 border-yellow-200 shadow-[0_0_16px_rgba(250,204,21,0.9)]',
    ledAlarm: 'bg-red-500 border-red-200 shadow-[0_0_22px_rgba(239,68,68,1)]',
    rowActiveBorder: 'border-amber-400/70',
    progressBar: 'bg-amber-400',
  },
  T4: {
    id: 'T4',
    badgeBg: 'bg-red-600',
    badgeBorder: 'border-red-400',
    badgeText: 'text-white',
    ledIdle: 'bg-red-950 border-red-800/70',
    ledRunning: 'bg-red-500 border-red-300 shadow-[0_0_16px_rgba(239,68,68,0.9)]',
    ledAlarm: 'bg-red-500 border-red-200 shadow-[0_0_22px_rgba(239,68,68,1)]',
    rowActiveBorder: 'border-red-500/70',
    progressBar: 'bg-red-500',
  },
}

export function createEmptyBeanChannelsMap(): BeanChannelsStateMap {
  return {
    T1: null,
    T2: null,
    T3: null,
    T4: null,
  }
}

export function isValidBeanChannelId(val: unknown): val is BeanTimerChannelId {
  return typeof val === 'string' && (BEAN_TIMER_CHANNELS as readonly string[]).includes(val)
}

export function isValidBeanProductKey(val: unknown): val is BeanProductKey {
  return typeof val === 'string' && (BEAN_PRODUCT_KEYS as readonly string[]).includes(val)
}

/**
 * Sanitiza y valida segundos de cocción de un preset evitando `0`, negativos, `NaN` o `Infinity`.
 */
export function sanitizeBeanPresetSeconds(raw: unknown, fallbackSeconds: number): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) return fallbackSeconds
  const rounded = Math.round(num)
  if (rounded < MIN_BEAN_PRESET_SECONDS || rounded > MAX_BEAN_PRESET_SECONDS) {
    return fallbackSeconds
  }
  return rounded
}

export function sanitizeBeanPresetMap(raw?: Partial<Record<string, unknown>> | null): BeanTimerPresetMap {
  return {
    FRIJOLES_OLLA: sanitizeBeanPresetSeconds(
      raw?.FRIJOLES_OLLA,
      DEFAULT_BEAN_TIMER_PRESETS.FRIJOLES_OLLA
    ),
    FRIJOLES_ENTEROS: sanitizeBeanPresetSeconds(
      raw?.FRIJOLES_ENTEROS,
      DEFAULT_BEAN_TIMER_PRESETS.FRIJOLES_ENTEROS
    ),
  }
}

/**
 * Calcula `businessDate` (YYYY-MM-DD) y `shiftPeriod` ('AM' | 'PM') en `America/Los_Angeles`
 * respetando estrictamente la jornada laboral de Tacos Gavilan (6:00 AM -> 5:59:59 AM)
 * y el inicio del turno PM a las 5:00 PM (17:00), sin depender del huso horario local del servidor.
 */
export function resolveBeanBusinessContext(input: Date | number | string = Date.now()): {
  businessDate: string
  shiftPeriod: 'AM' | 'PM'
  laHour: number
  laMinute: number
} {
  const dateObj = input instanceof Date ? input : new Date(input)
  const validDate = Number.isFinite(dateObj.getTime()) ? dateObj : new Date()

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(validDate)

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  const year = parseInt(getPart('year'), 10)
  const month = parseInt(getPart('month'), 10)
  let day = parseInt(getPart('day'), 10)
  let hour = parseInt(getPart('hour'), 10)
  const minute = parseInt(getPart('minute'), 10)
  if (hour === 24) hour = 0

  let targetYear = year
  let targetMonth = month

  // Antes de las 6:00 AM Pacific Time pertenece al día laboral anterior (turno PM nocturno)
  if (hour < 6) {
    const prevUtc = new Date(Date.UTC(year, month - 1, day - 1, 12, 0, 0))
    targetYear = prevUtc.getUTCFullYear()
    targetMonth = prevUtc.getUTCMonth() + 1
    day = prevUtc.getUTCDate()
  }

  const businessDate = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const shiftPeriod: 'AM' | 'PM' = hour >= 6 && hour < 17 ? 'AM' : 'PM'

  return {
    businessDate,
    shiftPeriod,
    laHour: hour,
    laMinute: minute,
  }
}

/**
 * Descompone segundos totales en segmentos `HH`, `MM`, `SS` estilo pantalla LCD Cooper TFS4.
 */
export function splitSecondsToHmsParts(totalSeconds: number): {
  hoursPart: string
  minutesPart: string
  secondsPart: string
  formatted: string
} {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  const hoursPart = String(hours).padStart(2, '0')
  const minutesPart = String(minutes).padStart(2, '0')
  const secondsPart = String(seconds).padStart(2, '0')

  return {
    hoursPart,
    minutesPart,
    secondsPart,
    formatted: `${hoursPart}:${minutesPart}:${secondsPart}`,
  }
}

/**
 * Formatea una duración corta de preset para botones de 1 toque (ej. `660s` -> `11:00`, `3900s` -> `1:05:00`).
 */
export function formatPresetDurationCompact(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Formatea el tiempo excedido (`Overtime`) después de llegar a `00:00:00` (ej. `+00:45` o `+01:02:10`).
 */
export function formatOvertimeLabel(overtimeSeconds: number): string {
  const safe = Number.isFinite(overtimeSeconds) ? Math.max(0, Math.floor(overtimeSeconds)) : 0
  return `+${formatPresetDurationCompact(safe)}`
}

/**
 * Evalúa el estado instantáneo de un canal (`T1..T4`) comparando `expectedEndAtMs` contra `nowMs`.
 * Inmune a bloqueos de pantalla, recargas de página o throttling de `setInterval`.
 */
export function evaluateChannelLiveSnapshot(
  channelId: BeanTimerChannelId,
  session: ActiveBeanChannelSession | null | undefined,
  nowMs: number = Date.now()
): BeanChannelLiveSnapshot {
  if (!session) {
    return {
      channelId,
      state: 'IDLE',
      session: null,
      remainingSeconds: 0,
      overtimeSeconds: 0,
      progressPct: 0,
      hoursPart: '00',
      minutesPart: '00',
      secondsPart: '00',
      formattedMain: '00:00:00',
      formattedOvertime: null,
    }
  }

  const safeTarget = Math.max(1, Number(session.targetSeconds) || 1)
  const diffMs = session.expectedEndAtMs - nowMs

  if (diffMs > 0) {
    const remainingSeconds = Math.min(safeTarget, Math.max(1, Math.ceil(diffMs / 1000)))
    const elapsed = Math.max(0, safeTarget - remainingSeconds)
    const progressPct = Math.min(100, Math.max(0, (elapsed / safeTarget) * 100))
    const parts = splitSecondsToHmsParts(remainingSeconds)

    return {
      channelId,
      state: 'RUNNING',
      session,
      remainingSeconds,
      overtimeSeconds: 0,
      progressPct,
      hoursPart: parts.hoursPart,
      minutesPart: parts.minutesPart,
      secondsPart: parts.secondsPart,
      formattedMain: parts.formatted,
      formattedOvertime: null,
    }
  }

  const overtimeMs = Math.max(0, nowMs - session.expectedEndAtMs)
  const overtimeSeconds = Math.floor(overtimeMs / 1000)

  return {
    channelId,
    state: 'ALARMING',
    session,
    remainingSeconds: 0,
    overtimeSeconds,
    progressPct: 100,
    hoursPart: '00',
    minutesPart: '00',
    secondsPart: '00',
    formattedMain: '00:00:00',
    formattedOvertime: formatOvertimeLabel(overtimeSeconds),
  }
}

/**
 * Selecciona el canal destino al tocar un botón de frijoles:
 * 1) Si el canal seleccionado (`preferredChannel`) está libre (`IDLE`), usa ese canal.
 * 2) Si está ocupado, asigna automáticamente el primer canal libre en orden `T1 -> T2 -> T3 -> T4`.
 * 3) Si los 4 canales están ocupados, retorna `null`.
 */
export function pickTargetChannelForStart(
  channels: BeanChannelsStateMap,
  preferredChannel?: BeanTimerChannelId | null
): BeanTimerChannelId | null {
  if (preferredChannel && isValidBeanChannelId(preferredChannel) && !channels[preferredChannel]) {
    return preferredChannel
  }
  for (const ch of BEAN_TIMER_CHANNELS) {
    if (!channels[ch]) return ch
  }
  return null
}

/**
 * Retorna la lista ordenada de canales actualmente en alarma (`00:00:00` alcanzado),
 * priorizando el que venció primero (mayor riesgo de sobrecocción en la olla).
 */
export function getAlarmingChannelsOrdered(
  channels: BeanChannelsStateMap,
  nowMs: number = Date.now()
): BeanChannelLiveSnapshot[] {
  const alarming: BeanChannelLiveSnapshot[] = []
  for (const ch of BEAN_TIMER_CHANNELS) {
    const snap = evaluateChannelLiveSnapshot(ch, channels[ch], nowMs)
    if (snap.state === 'ALARMING') {
      alarming.push(snap)
    }
  }
  alarming.sort((a, b) => {
    const endA = a.session?.expectedEndAtMs ?? 0
    const endB = b.session?.expectedEndAtMs ?? 0
    if (endA !== endB) return endA - endB
    return BEAN_TIMER_CHANNELS.indexOf(a.channelId) - BEAN_TIMER_CHANNELS.indexOf(b.channelId)
  })
  return alarming
}

/**
 * Convierte una fila activa de `bean_cooking_logs` en `ActiveBeanChannelSession`,
 * descartando sesiones abandonadas mayores a `MAX_ACTIVE_BEAN_TIMER_AGE_MS`.
 */
export function dbLogRowToActiveSession(
  row: any,
  nowMs: number = Date.now()
): ActiveBeanChannelSession | null {
  if (!row || !isValidBeanChannelId(row.channel_id) || !isValidBeanProductKey(row.product_key)) {
    return null
  }
  const channelId: BeanTimerChannelId = row.channel_id
  const productKey: BeanProductKey = row.product_key
  if (row.status !== 'RUNNING' && row.status !== 'ALARMING') {
    return null
  }
  const startedAtMs = new Date(row.started_at).getTime()
  const expectedEndAtMs = new Date(row.expected_end_at).getTime()
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(expectedEndAtMs)) {
    return null
  }
  if (nowMs - startedAtMs > MAX_ACTIVE_BEAN_TIMER_AGE_MS) {
    return null
  }
  const alarmTriggeredAtMs = row.alarm_triggered_at
    ? new Date(row.alarm_triggered_at).getTime()
    : null

  return {
    logId: String(row.id),
    channelId,
    productKey,
    targetSeconds: Math.max(1, Number(row.target_seconds) || DEFAULT_BEAN_TIMER_PRESETS[productKey]),
    startedAtMs,
    expectedEndAtMs,
    alarmTriggeredAtMs: Number.isFinite(alarmTriggeredAtMs) ? alarmTriggeredAtMs : null,
    businessDate: String(row.business_date || resolveBeanBusinessContext(startedAtMs).businessDate),
    shiftPeriod: row.shift_period === 'PM' ? 'PM' : 'AM',
    startedBy: row.started_by || null,
  }
}

/**
 * Construye la frase corta y directa para la voz neuronal oficial `Kore` (la misma voz
 * usada en `Order Ready Board` para llamar órdenes de clientes):
 * - Español: `"Apagar Frijoles de la Olla."` / `"Apagar Frijoles Enteros."`
 * - Inglés: `"Turn off Frijoles de la Olla."` / `"Turn off Frijoles Enteros."`
 */
export function getBeanTimerKorePhrase(
  productKey: BeanProductKey,
  lang: 'es' | 'en' = 'es'
): string {
  const safeLang: 'es' | 'en' = lang === 'en' ? 'en' : 'es'

  if (safeLang === 'en') {
    return productKey === 'FRIJOLES_OLLA'
      ? 'Turn off Frijoles de la Olla.'
      : 'Turn off Frijoles Enteros.'
  }

  return productKey === 'FRIJOLES_OLLA'
    ? 'Apagar Frijoles de la Olla.'
    : 'Apagar Frijoles Enteros.'
}

/**
 * Retorna la ruta estática local pre-generada y masterizada del clip WAV de `Kore` (`0ms` de latencia).
 */
export function getBeanTimerStaticKoreWavUrl(
  productKey: BeanProductKey,
  lang: 'es' | 'en' = 'es'
): string {
  const safeLang: 'es' | 'en' = lang === 'en' ? 'en' : 'es'
  const prodSlug = productKey === 'FRIJOLES_OLLA' ? 'olla' : 'enteros'
  return `/audio/bean-timer/${prodSlug}-${safeLang}.wav?v=${BEAN_TIMER_STATIC_WAV_VERSION}`
}

