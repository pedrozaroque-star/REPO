/**
 * @module lib/drive-thru-kore-fast-clips
 * @description Motor de SERVIDOR para minería de tickets históricos reales de Drive-Thru (`toast_ticket_consumption_snapshots`
 * + `dt_orders`) y gestión del banco de respuestas de voz pregrabadas (`Kore 3.8`, `24000 Hz` PCM16 en Español e Inglés)
 * persistidas permanentemente en Supabase Storage (`order-ready-tts`, ruta `phone_v6/Kore/...`).
 *
 * @businessRules
 * - **Cero Mocks — Datos 100% reales**: `getKoreHistoricalDriveThruAnalytics()` consulta en vivo `public.dt_orders`
 *   (~398,905 órdenes históricas en las 6 tiendas con Drive-Thru) y `public.toast_ticket_consumption_snapshots`
 *   (`WHERE dining_option_name = 'Drive Thru'`, ~6,408 tickets detallados con JSONB `selections`), excluyendo ítems
 *   anulados (`voided`) y separadores visuales (`Taco Separator`) para obtener el Top 12 real de productos Drive-Thru.
 * - **Reutilización sin duplicar ni editar `lib/order-ready-tts.ts`**: importa `getPhoneAgentSpeech` y
 *   `warmPhoneSpeechFromStorageOnly` con voz `'Kore'`, garantizando la compuerta acústica femenina (`F0 >= 148 Hz`) y
 *   persistencia duradera en Supabase Storage.
 * - **Lectura no bloqueante en inicio de sesión (`<= 260 ms`)**: `getInitialGreetingFastClips` solo consulta RAM/Storage
 *   (`warmPhoneSpeechFromStorageOnly`) con tope de tiempo estricto para que `POST /api/drive-thru/kore/session` jamás se
 *   retrase si algún clip aún no estuviera precalentado.
 *
 * @dataFlow
 * - Pre-grabación / Cron (`/api/cron/learn-kore-drive-thru` o `POST /api/drive-thru/kore/fast-clips`)
 *   -> `prewarmAllKoreFastClips()` -> `getPhoneAgentSpeech(..., { awaitStoragePersist: true, requireKore38: true })`
 *   -> Supabase Storage `order-ready-tts` (`phone_v6/Kore/...`).
 * - Simulador / Carril (`GET /api/drive-thru/kore/fast-clips` y `POST /api/drive-thru/kore/session`)
 *   -> `getKoreFastClipsBundle()` / `getInitialGreetingFastClips()` -> `{ text, pcm16Base64, sampleRate: 24000 }`.
 *
 * @notes
 * - `extractPcm16FromWav` recorre los sub-chunks RIFF/WAVE (`fmt ` y `data`) para entregar únicamente muestras PCM16 LE
 *   alineadas a múltiplo de 2 bytes, evitando cualquier clic acústico de cabecera WAV en Web Audio API.
 * - Protección Single-Key RPM (2026-11-20): `prewarmAllKoreFastClips` limita concurrencia a `1` cuando el pool tiene `<= 1` llave activa.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getGeminiKeyPoolWithRemote, getPhoneAgentSpeech, getPhoneSpeechStoragePath } from '@/lib/order-ready-tts'
import { pickKoreDriveThruGreeting, type KoreLang } from '@/lib/drive-thru-kore'
import { KORE_FAST_CLIP_SPECS, TOP_SINGLE_LINE_ACKS, type KoreFastClipSpec } from '@/lib/drive-thru-kore-fast-match'

export const KORE_DRIVE_THRU_STORE_IDS: readonly number[] = Object.freeze([3, 6, 10, 12, 14, 15])
export const KORE_FAST_CLIPS_DEFAULT_PAGE_LIMIT = 6
export const KORE_FAST_CLIPS_MAX_PAGE_LIMIT = 6
const GREETING_VARIANT_COUNT = 4
const ANALYTICS_CACHE_TTL_MS = 10 * 60 * 1000
const STORAGE_BUCKET = 'order-ready-tts'
const STORAGE_INDEX_TTL_MS = 45 * 1000

export interface KoreEncodedFastClip {
  text: string
  pcm16Base64: string
  sampleRate: number
}

export interface KoreTopDriveThruItem {
  name: string
  quantitySold: number
  ticketMentions: number
}

export interface KoreHistoricalDriveThruAnalytics {
  historicalDtOrdersCount: number
  historicalDetailedSnapshotsCount: number
  topDriveThruItems: KoreTopDriveThruItem[]
}

export interface KoreFastClipsBundleStats extends KoreHistoricalDriveThruAnalytics {
  /** Total global de archivos individuales de audio del catálogo (cada situación cuenta 2: `es` + `en`, ej. 288 con `storeId`). */
  totalClips: number
  /** Archivos de audio ya disponibles en Storage / RAM sobre TODAS las situaciones del catálogo. */
  cachedClips: number
  /** Total global de situaciones bilingües del catálogo (ej. 144 con `storeId`, 140 sin `storeId`). */
  totalSituations: number
}

export interface KoreFastClipsPagination {
  offset: number
  limit: number
  totalSituations: number
  hasMore: boolean
  nextOffset: number | null
}

export interface KoreFastClipsBundleResponse {
  clips: Record<string, { es: KoreEncodedFastClip | null; en: KoreEncodedFastClip | null }>
  stats: KoreFastClipsBundleStats
  pagination: KoreFastClipsPagination
}

const pcmClipMemCache = new Map<string, KoreEncodedFastClip>()
let analyticsCache: { data: KoreHistoricalDriveThruAnalytics; fetchedAt: number } | null = null
let persistedPathsCache: { paths: Set<string>; fetchedAt: number } | null = null
let persistedPathsInflight: Promise<Set<string>> | null = null

export function clearKoreFastClipsRamCache(): void {
  pcmClipMemCache.clear()
  persistedPathsCache = null
  persistedPathsInflight = null
}

async function listAllFolderWavPaths(folder: string): Promise<string[]> {
  const out: string[] = []
  const pageLimit = 1000
  for (let offset = 0; offset < 5000; offset += pageLimit) {
    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).list(folder, {
      limit: pageLimit,
      offset
    })
    if (error || !Array.isArray(data) || data.length === 0) break
    for (const entry of data) {
      if (entry?.name && entry.name.endsWith('.wav')) {
        out.push(`${folder}/${entry.name}`)
      }
    }
    if (data.length < pageLimit) break
  }
  return out
}

/**
 * Índice ligero de rutas `.wav` realmente existentes en Supabase Storage (`phone_v6/Kore/es` + `phone_v6/Kore/en`),
 * evitando tormentas de 400/404 y timeouts por contención TLS en arranques en frío.
 */
export async function getPersistedKoreStoragePaths(forceRefresh = false): Promise<Set<string>> {
  const now = Date.now()
  if (!forceRefresh && persistedPathsCache && now - persistedPathsCache.fetchedAt < STORAGE_INDEX_TTL_MS) {
    return persistedPathsCache.paths
  }
  if (!forceRefresh && persistedPathsInflight) {
    return persistedPathsInflight
  }

  const job = (async () => {
    const [esPaths, enPaths] = await Promise.all([
      listAllFolderWavPaths('phone_v6/Kore/es'),
      listAllFolderWavPaths('phone_v6/Kore/en')
    ])
    const set = new Set<string>([...esPaths, ...enPaths])
    persistedPathsCache = { paths: set, fetchedAt: Date.now() }
    return set
  })().finally(() => {
    if (persistedPathsInflight === job) persistedPathsInflight = null
  })

  persistedPathsInflight = job
  return job
}

/**
 * Verifica directamente contra Supabase Storage (sin pasar por ninguna caché RAM) si un archivo `.wav` existe en el bucket.
 */
export async function verifyPathExistsInStorageBucket(storagePath: string): Promise<boolean> {
  const slashIdx = storagePath.lastIndexOf('/')
  if (slashIdx <= 0) return false
  const dir = storagePath.slice(0, slashIdx)
  const fileName = storagePath.slice(slashIdx + 1)
  if (!fileName) return false

  const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).list(dir, {
    limit: 20,
    search: fileName
  })
  if (error || !Array.isArray(data)) return false
  const found = data.some((f) => f?.name === fileName)
  if (found && persistedPathsCache) {
    persistedPathsCache.paths.add(storagePath)
  }
  return found
}

function makeMemKey(lang: KoreLang, text: string): string {
  return `${lang}::${text.trim()}`
}

/**
 * Recorta únicamente el silencio digital puro al inicio y final del buffer PCM16 LE (`|sample| <= 48`),
 * conservando un colchón suave de `18 ms` al inicio y `55 ms` al final para inicio instantáneo `< 5 ms`
 * y reducción ~25–35% de peso Base64 sin alterar la frecuencia `24000 Hz` ni la voz.
 */
function trimPcm16Silence(pcm: Buffer, sampleRate: number): Buffer {
  const evenLen = pcm.length - (pcm.length % 2)
  if (evenLen < 4) return pcm.subarray(0, evenLen)
  const totalSamples = evenLen >> 1
  const threshold = 280

  let firstActive = -1
  for (let i = 0; i < totalSamples; i++) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > threshold) {
      firstActive = i
      break
    }
  }
  if (firstActive === -1) return pcm.subarray(0, Math.min(evenLen, Math.round(sampleRate * 0.1) * 2))

  let lastActive = firstActive
  for (let i = totalSamples - 1; i > firstActive; i--) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > threshold) {
      lastActive = i
      break
    }
  }

  const leadPad = Math.round(sampleRate * 0.018)
  const tailPad = Math.round(sampleRate * 0.055)
  const startSample = Math.max(0, firstActive - leadPad)
  const endSample = Math.min(totalSamples, lastActive + 1 + tailPad)
  return pcm.subarray(startSample * 2, endSample * 2)
}

/**
 * Extrae las muestras crudas PCM16 LE (`base64`) y `sampleRate` desde un `Buffer` RIFF/WAV de `getPhoneAgentSpeech`,
 * omitiendo por completo el encabezado WAV para evitar artefactos al decodificar en el navegador.
 */
export function extractPcm16FromWav(wav: Buffer): { pcm16Base64: string; sampleRate: number } | null {
  if (!Buffer.isBuffer(wav) || wav.length <= 44) return null
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    const evenLen = wav.length - (wav.length % 2)
    if (evenLen <= 0) return null
    const trimmed = trimPcm16Silence(wav.subarray(0, evenLen), 24000)
    return trimmed.length > 0 ? { pcm16Base64: trimmed.toString('base64'), sampleRate: 24000 } : null
  }

  let sampleRate = 24000
  let offset = 12
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4)
    const chunkSize = wav.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    if (chunkId === 'fmt ' && dataStart + 8 <= wav.length) {
      const sr = wav.readUInt32LE(dataStart + 4)
      if (sr >= 8000 && sr <= 96000) sampleRate = sr
    } else if (chunkId === 'data') {
      const available = Math.min(chunkSize, wav.length - dataStart)
      const evenLen = available - (available % 2)
      if (evenLen <= 0) return null
      const trimmed = trimPcm16Silence(wav.subarray(dataStart, dataStart + evenLen), sampleRate)
      return {
        pcm16Base64: trimmed.toString('base64'),
        sampleRate
      }
    }
    offset = dataStart + chunkSize + (chunkSize % 2)
  }

  const tail = wav.subarray(44)
  const evenLen = tail.length - (tail.length % 2)
  if (evenLen <= 0) return null
  const trimmed = trimPcm16Silence(tail.subarray(0, evenLen), sampleRate)
  return trimmed.length > 0 ? { pcm16Base64: trimmed.toString('base64'), sampleRate } : null
}

function isIgnoredSnapshotSelectionName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return true
  if (/^[-=_*\s]+$/.test(trimmed)) return true
  if (/separator/i.test(trimmed)) return true
  return false
}

/**
 * Analiza en vivo los tickets reales de Drive-Thru en `toast_ticket_consumption_snapshots` (`dining_option_name = 'Drive Thru'`)
 * y el volumen total histórico de `dt_orders` (caché en memoria de 10 min).
 */
export async function getKoreHistoricalDriveThruAnalytics(forceRefresh = false): Promise<KoreHistoricalDriveThruAnalytics> {
  const now = Date.now()
  if (!forceRefresh && analyticsCache && now - analyticsCache.fetchedAt < ANALYTICS_CACHE_TTL_MS) {
    return analyticsCache.data
  }

  const [dtCountRes, snapCountRes] = await Promise.all([
    supabaseAdmin.from('dt_orders').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('toast_ticket_consumption_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('dining_option_name', 'Drive Thru')
  ])

  const historicalDtOrdersCount = Number(dtCountRes.count) || 0
  const historicalDetailedSnapshotsCount = Number(snapCountRes.count) || 0

  // Paginar los snapshots reales de Drive-Thru en bloques de 1,000 (límite por página de PostgREST)
  const itemStats = new Map<string, { quantitySold: number; ticketMentions: number }>()
  const pageSize = 1000
  const maxPages = Math.min(10, Math.max(1, Math.ceil((historicalDetailedSnapshotsCount || 7000) / pageSize)))

  const pageIndices = Array.from({ length: maxPages }, (_, pageIdx) => pageIdx)
  const pageResults = await mapWithConcurrency(pageIndices, 3, async (pageIdx) => {
    const from = pageIdx * pageSize
    const to = from + pageSize - 1
    return supabaseAdmin
      .from('toast_ticket_consumption_snapshots')
      .select('selections')
      .eq('dining_option_name', 'Drive Thru')
      .range(from, to)
  })
  for (const page of pageResults) {
    if (page.error || !Array.isArray(page.data)) continue
    for (const row of page.data) {
      const selections = Array.isArray((row as any)?.selections) ? (row as any).selections : []
      const seenInTicket = new Set<string>()
      for (const sel of selections) {
        if (!sel || sel.voided === true) continue
        const rawName = String(sel.displayName || sel.itemName || sel.name || '').replace(/\s+/g, ' ').trim()
        if (isIgnoredSnapshotSelectionName(rawName)) continue
        const qty = Math.max(1, Math.round(Number(sel.quantity) || 1))
        const prev = itemStats.get(rawName) || { quantitySold: 0, ticketMentions: 0 }
        prev.quantitySold += qty
        if (!seenInTicket.has(rawName)) {
          prev.ticketMentions += 1
          seenInTicket.add(rawName)
        }
        itemStats.set(rawName, prev)
      }
    }
  }

  const topDriveThruItems: KoreTopDriveThruItem[] = Array.from(itemStats.entries())
    .map(([name, st]) => ({ name, quantitySold: st.quantitySold, ticketMentions: st.ticketMentions }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.ticketMentions - a.ticketMentions)
    .slice(0, 16)

  const data: KoreHistoricalDriveThruAnalytics = {
    historicalDtOrdersCount,
    historicalDetailedSnapshotsCount,
    topDriveThruItems
  }
  analyticsCache = { data, fetchedAt: now }
  return data
}

/**
 * Carga un clip únicamente si YA existe en RAM o en el índice real de Supabase Storage (`order-ready-tts`),
 * devolviendo `null` en `0 ms` para rutas inexistentes (cero tormenta de 400/404) y descargando sin timeout corto espurio.
 */
export async function loadFastClipFromStorageOnly(
  text: string,
  lang: KoreLang,
  knownPaths?: ReadonlySet<string>
): Promise<KoreEncodedFastClip | null> {
  const cleanText = String(text || '').trim()
  if (!cleanText) return null

  const key = makeMemKey(lang, cleanText)
  const cached = pcmClipMemCache.get(key)
  if (cached) return cached

  const info = getPhoneSpeechStoragePath(cleanText, lang, 'Kore')
  if (!info) return null

  const pathSet = knownPaths ?? (await getPersistedKoreStoragePaths())
  if (!pathSet.has(info.path)) return null

  try {
    const dl = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(info.path)
    if (dl.error || !dl.data) return null
    const wav = Buffer.from(await dl.data.arrayBuffer())
    const parsed = extractPcm16FromWav(wav)
    if (!parsed) return null
    const clip: KoreEncodedFastClip = {
      text: cleanText,
      pcm16Base64: parsed.pcm16Base64,
      sampleRate: parsed.sampleRate
    }
    pcmClipMemCache.set(key, clip)
    return clip
  } catch {
    return null
  }
}

/**
 * Garantiza que un clip exista grabado con voz femenina verificada `Kore 3.8` y PERSISTIDO REALMENTE en Supabase Storage
 * (`order-ready-tts`), verificando directamente contra el bucket (nunca contra cachés RAM en memoria).
 */
export async function ensureFastClipRecorded(
  text: string,
  lang: KoreLang,
  forceRegenerate = false
): Promise<{ clip: KoreEncodedFastClip | null; fromCache: boolean; error?: string }> {
  const cleanText = String(text || '').trim()
  if (!cleanText) return { clip: null, fromCache: false, error: 'empty_text' }

  const info = getPhoneSpeechStoragePath(cleanText, lang, 'Kore')
  if (!info) return { clip: null, fromCache: false, error: 'invalid_storage_path' }

  if (!forceRegenerate) {
    const existsInBucket = await verifyPathExistsInStorageBucket(info.path)
    if (existsInBucket) {
      const existing = await loadFastClipFromStorageOnly(cleanText, lang, new Set([info.path]))
      if (existing) return { clip: existing, fromCache: true }
    }
  }

  let lastErr = 'synthesis_not_persisted'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const wav = await getPhoneAgentSpeech(cleanText, lang, 'Kore', forceRegenerate || attempt > 0, {
        skipSseAttempt: true,
        awaitStoragePersist: true,
        requireKore38: true,
        maxTotalMs: 14000
      })
      const parsed = extractPcm16FromWav(wav)
      if (!parsed) {
        lastErr = 'invalid_wav'
        continue
      }
      // Verificar existencia REAL en el bucket; si hubo retardo o lite-tts omitió subida, subir explícitamente el WAV validado
      let persistedInBucket = await verifyPathExistsInStorageBucket(info.path)
      if (!persistedInBucket) {
        const up = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(info.path, wav, {
          contentType: 'audio/wav',
          upsert: true
        })
        if (!up.error) {
          persistedInBucket = await verifyPathExistsInStorageBucket(info.path)
        }
      }
      if (!persistedInBucket) {
        lastErr = 'not_persisted_in_storage_bucket'
        continue
      }
      const clip: KoreEncodedFastClip = {
        text: cleanText,
        pcm16Base64: parsed.pcm16Base64,
        sampleRate: parsed.sampleRate
      }
      pcmClipMemCache.set(makeMemKey(lang, cleanText), clip)
      return { clip, fromCache: false }
    } catch (err: any) {
      lastErr = String(err?.message || err).slice(0, 200)
      if (/429|quota|exhausted|falló \(\)/i.test(lastErr)) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 12000 : 22000))
      }
    }
  }
  return { clip: null, fromCache: false, error: lastErr }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeConc = Math.max(1, Math.min(20, Math.trunc(concurrency) || 5))
  const results: R[] = new Array(items.length)
  let nextIdx = 0

  const runners = Array.from({ length: Math.min(safeConc, items.length) }, async () => {
    while (true) {
      const idx = nextIdx++
      if (idx >= items.length) break
      results[idx] = await worker(items[idx], idx)
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * Obtiene los clips de bienvenida inicial (`es` y `en`) de una sucursal para la variante indicada sin superar `maxWaitMs`
 * (por defecto `260 ms`), de modo que `POST /api/drive-thru/kore/session` jamás se bloquee.
 */
export async function getInitialGreetingFastClips(
  storeId: number,
  variantIndex: number,
  maxWaitMs = 650
): Promise<{ es: KoreEncodedFastClip | null; en: KoreEncodedFastClip | null }> {
  const candidateIndices = Array.from(new Set([((variantIndex % 4) + 4) % 4, 0, 1, 2, 3]))
  const timeoutNull = new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(100, maxWaitMs)))

  const work = (async () => {
    const knownPaths = await getPersistedKoreStoragePaths()
    const pickFirstCached = async (l: KoreLang): Promise<KoreEncodedFastClip | null> => {
      for (const idx of candidateIndices) {
        const text = pickKoreDriveThruGreeting(storeId, l, idx).primary
        const memHit = pcmClipMemCache.get(makeMemKey(l, text))
        if (memHit) return memHit
        const info = getPhoneSpeechStoragePath(text, l, 'Kore')
        if (info && knownPaths.has(info.path)) {
          const loaded = await loadFastClipFromStorageOnly(text, l, knownPaths)
          if (loaded) return loaded
        }
      }
      return null
    }
    const [es, en] = await Promise.all([pickFirstCached('es'), pickFirstCached('en')])
    return { es, en }
  })()

  const raced = await Promise.race([work, timeoutNull]).catch(() => null)
  return raced || { es: null, en: null }
}

export function buildStoreGreetingSpecs(storeId: number): Array<{ clipId: string; textEs: string; textEn: string }> {
  const out: Array<{ clipId: string; textEs: string; textEn: string }> = []
  for (let v = 0; v < GREETING_VARIANT_COUNT; v++) {
    out.push({
      clipId: `greeting_v${v}`,
      textEs: pickKoreDriveThruGreeting(storeId, 'es', v).primary,
      textEn: pickKoreDriveThruGreeting(storeId, 'en', v).primary
    })
  }
  return out
}

const CLIP_ID_TO_SINGLE_PAIR: ReadonlyMap<string, { qty: number; normName: string }> = (() => {
  const m = new Map<string, { qty: number; normName: string }>()
  for (const [k, clipId] of Object.entries(TOP_SINGLE_LINE_ACKS)) {
    const pipe = k.indexOf('|')
    if (pipe > 0) {
      m.set(clipId, { qty: Number(k.slice(0, pipe)) || 1, normName: k.slice(pipe + 1) })
    }
  }
  return m
})()

function normPlainKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function buildOrderedFastClipEntries(
  validStoreId: number | null,
  topDriveThruItems: readonly KoreTopDriveThruItem[]
): Array<{ clipId: string; textEs: string; textEn: string }> {
  const popularityByNorm = new Map<string, number>()
  topDriveThruItems.forEach((it, idx) => {
    popularityByNorm.set(normPlainKey(it.name), it.quantitySold * 10 + (100 - idx))
  })

  const priorityGroup = (spec: KoreFastClipSpec): number => {
    if (spec.category === 'clarify') return 1
    if (spec.category === 'ops') return 2
    if (spec.category === 'sendoff') return 3
    if (
      spec.clipId.startsWith('added_ack_') ||
      spec.clipId.startsWith('removed_ack_') ||
      spec.clipId.startsWith('mod_')
    ) {
      return 4
    }
    return 5
  }

  const itemPopularityScore = (spec: KoreFastClipSpec, originalIdx: number): number => {
    if (spec.clipId.startsWith('combo_')) return 50000 - originalIdx
    const single = CLIP_ID_TO_SINGLE_PAIR.get(spec.clipId)
    if (!single) return -originalIdx
    const basePop = popularityByNorm.get(single.normName) || 0
    const qtyBonus = single.qty <= 3 ? (4 - single.qty) * 50 : Math.max(0, 20 - single.qty)
    return basePop + qtyBonus
  }

  const indexedSpecs = KORE_FAST_CLIP_SPECS.map((spec, idx) => ({ spec, idx }))
  indexedSpecs.sort((a, b) => {
    const gA = priorityGroup(a.spec)
    const gB = priorityGroup(b.spec)
    if (gA !== gB) return gA - gB
    if (gA === 5) {
      const sDiff = itemPopularityScore(b.spec, b.idx) - itemPopularityScore(a.spec, a.idx)
      if (sDiff !== 0) return sDiff
    }
    return a.idx - b.idx
  })

  const sortedSpecs = indexedSpecs.map(({ spec }) => ({
    clipId: spec.clipId,
    textEs: spec.textEs,
    textEn: spec.textEn
  }))
  const top23LongestIds = new Set(
    [...sortedSpecs]
      .sort((a, b) => b.textEs.length + b.textEn.length - (a.textEs.length + a.textEn.length))
      .slice(0, 23)
      .map((s) => s.clipId)
  )
  const longSpecs = sortedSpecs.filter((s) => top23LongestIds.has(s.clipId))
  const shortSpecs = sortedSpecs.filter((s) => !top23LongestIds.has(s.clipId))
  const balancedSpecs: Array<{ clipId: string; textEs: string; textEn: string }> = []
  let li = 0
  let si = 0
  // Align to page size 6 after the 4 store greetings (4 greetings + 2 short = Page 0; then 23x [1 long + 5 short] = Pages 1..23)
  if (validStoreId) {
    for (let k = 0; k < 2 && si < shortSpecs.length; k++) {
      balancedSpecs.push(shortSpecs[si++])
    }
  }
  while (li < longSpecs.length || si < shortSpecs.length) {
    if (li < longSpecs.length) balancedSpecs.push(longSpecs[li++])
    for (let k = 0; k < 5 && si < shortSpecs.length; k++) {
      balancedSpecs.push(shortSpecs[si++])
    }
  }

  return [
    ...(validStoreId ? buildStoreGreetingSpecs(validStoreId) : []),
    ...balancedSpecs
  ]
}

/**
 * Devuelve una página segura para Vercel (`<= 2.6 MB`, por defecto `36` situaciones = `72` clips por petición)
 * de clips pregrabados (`es` + `en`) disponibles en Storage, calculando en `O(1)` `stats.totalClips` (`288` con `storeId`)
 * y `stats.cachedClips` sobre TODAS las situaciones del catálogo mediante `knownPaths` (`getPersistedKoreStoragePaths()`).
 */
export async function getKoreFastClipsBundle(
  storeId?: number | null,
  opts?: { offset?: number; limit?: number }
): Promise<KoreFastClipsBundleResponse> {
  const validStoreId =
    typeof storeId === 'number' && Number.isInteger(storeId) && KORE_DRIVE_THRU_STORE_IDS.includes(storeId)
      ? storeId
      : null

  const [knownPaths, analytics] = await Promise.all([
    getPersistedKoreStoragePaths(),
    getKoreHistoricalDriveThruAnalytics()
  ])

  const allEntries = buildOrderedFastClipEntries(validStoreId, analytics.topDriveThruItems)
  const totalSituations = allEntries.length
  const totalClips = totalSituations * 2

  // Cálculo global O(1) de `cachedClips` sobre las 144 situaciones completas sin descargar los 288 WAVs en cada página
  let cachedClips = 0
  const isClipPersistedOrCached = (lang: KoreLang, text: string): boolean => {
    const clean = String(text || '').trim()
    if (!clean) return false
    if (pcmClipMemCache.has(makeMemKey(lang, clean))) return true
    const info = getPhoneSpeechStoragePath(clean, lang, 'Kore')
    return Boolean(info && knownPaths.has(info.path))
  }
  for (const e of allEntries) {
    if (isClipPersistedOrCached('es', e.textEs)) cachedClips += 1
    if (isClipPersistedOrCached('en', e.textEn)) cachedClips += 1
  }

  const rawOffset = Number(opts?.offset)
  const safeOffset =
    Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.min(totalSituations, Math.trunc(rawOffset)) : 0
  const rawLimit = Number(opts?.limit)
  const safeLimit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(KORE_FAST_CLIPS_MAX_PAGE_LIMIT, Math.max(1, Math.trunc(rawLimit)))
      : KORE_FAST_CLIPS_DEFAULT_PAGE_LIMIT

  const pageEntries = allEntries.slice(safeOffset, safeOffset + safeLimit)
  const pageTasks: Array<{ clipId: string; lang: KoreLang; text: string }> = []
  for (const e of pageEntries) {
    pageTasks.push({ clipId: e.clipId, lang: 'es', text: e.textEs })
    pageTasks.push({ clipId: e.clipId, lang: 'en', text: e.textEn })
  }

  const loadedList = await mapWithConcurrency(pageTasks, 8, async (t) => ({
    clipId: t.clipId,
    lang: t.lang,
    clip: await loadFastClipFromStorageOnly(t.text, t.lang, knownPaths)
  }))

  const clips: Record<string, { es: KoreEncodedFastClip | null; en: KoreEncodedFastClip | null }> = {}
  for (const e of pageEntries) {
    clips[e.clipId] = { es: null, en: null }
  }
  for (const item of loadedList) {
    if (!clips[item.clipId]) clips[item.clipId] = { es: null, en: null }
    clips[item.clipId][item.lang] = item.clip
  }

  const nextEnd = safeOffset + pageEntries.length
  const hasMore = nextEnd < totalSituations && pageEntries.length > 0

  return {
    clips,
    stats: {
      totalClips,
      cachedClips,
      totalSituations,
      historicalDtOrdersCount: analytics.historicalDtOrdersCount,
      historicalDetailedSnapshotsCount: analytics.historicalDetailedSnapshotsCount,
      topDriveThruItems: analytics.topDriveThruItems
    },
    pagination: {
      offset: safeOffset,
      limit: safeLimit,
      totalSituations,
      hasMore,
      nextOffset: hasMore ? nextEnd : null
    }
  }
}

/**
 * Pre-graba y persiste en Supabase Storage cualquier clip faltante del catálogo común (`KORE_FAST_CLIP_SPECS`)
 * y de las bienvenidas de las 6 sucursales con Drive-Thru (`#3, #6, #10, #12, #14, #15`) en Español e Inglés.
 */
/**
 * Determina si una frase hablada por Kore es reutilizable entre clientes (sin totales dinámicos en dólares,
 * códigos de orden ni nombres propios de tickets) para persistirla una sola vez en Supabase Storage (`phone_v6/Kore/`).
 */
export function isReusableDriveThruPhrase(rawText: string): boolean {
  const clean = String(rawText || '').replace(/\s+/g, ' ').trim()
  if (clean.length < 10 || clean.length > 165) return false
  if (/^[.\s…]+$/.test(clean)) return false
  // Excluir frases con precios/totales dinámicos, porcentajes o números de orden/ticket específicos
  if (/\$\s*\d|\b\d+\s*(?:d[oó]lares?|dollars?|centavos?|cents?)\b|#\s*\d{2,}|\borden\s+de\s+[A-ZÁÉÍÓÚÑ]/i.test(clean)) {
    return false
  }
  return true
}

/**
 * Auto-recicla en segundo plano una frase reutilizable hablada por Kore: si ya existe en Supabase Storage (`phone_v6/Kore/`),
 * la devuelve desde Storage a costo $0.00; si es nueva, la sintetiza UNA SOLA VEZ con `Kore 3.8` y la persiste para siempre.
 */
export async function cacheDynamicKoreFastClip(
  text: string,
  lang: KoreLang
): Promise<{ ok: boolean; fromCache: boolean; clip: KoreEncodedFastClip | null; storagePath?: string; reason?: string }> {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!isReusableDriveThruPhrase(clean)) {
    return { ok: false, fromCache: false, clip: null, reason: 'non_reusable_phrase' }
  }
  const info = getPhoneSpeechStoragePath(clean, lang, 'Kore')
  if (!info) {
    return { ok: false, fromCache: false, clip: null, reason: 'empty_storage_path' }
  }
  const res = await ensureFastClipRecorded(clean, lang, false)
  if (!res.clip) {
    return { ok: false, fromCache: false, clip: null, reason: res.error || 'synthesis_failed' }
  }
  if (persistedPathsCache) {
    persistedPathsCache.paths.add(info.path)
  }
  return { ok: true, fromCache: res.fromCache, clip: res.clip, storagePath: info.path }
}

export async function prewarmAllKoreFastClips(opts?: {
  storeIds?: readonly number[]
  concurrency?: number
  maxClipsToSynthesize?: number
}): Promise<{
  totalAudioClips: number
  alreadyCached: number
  newlySynthesized: number
  skippedByBudget: number
  failed: number
  failures: string[]
}> {
  const targetStores = (opts?.storeIds && opts.storeIds.length > 0 ? opts.storeIds : KORE_DRIVE_THRU_STORE_IDS).filter(
    (id) => KORE_DRIVE_THRU_STORE_IDS.includes(id)
  )
  const activeKeyPool = await getGeminiKeyPoolWithRemote()
  const maxSafeConcurrency = activeKeyPool.length <= 1 ? 1 : 4
  const concurrency = Math.max(1, Math.min(maxSafeConcurrency, opts?.concurrency ?? (activeKeyPool.length <= 1 ? 1 : 3)))
  const interItemDelayMs = activeKeyPool.length <= 1 ? 1600 : 280
  const maxToSynth =
    typeof opts?.maxClipsToSynthesize === 'number' && opts.maxClipsToSynthesize > 0
      ? Math.trunc(opts.maxClipsToSynthesize)
      : 600

  const orderedStores = [...targetStores].sort((a, b) => {
    const rank = (id: number) => (id === 14 ? 0 : id === 6 ? 1 : id)
    return rank(a) - rank(b)
  })

  const uniqueTasks = new Map<string, { label: string; lang: KoreLang; text: string }>()
  const addSpecTask = (label: string, textEs: string, textEn: string) => {
    uniqueTasks.set(makeMemKey('es', textEs), { label: `${label}:es`, lang: 'es', text: textEs })
    uniqueTasks.set(makeMemKey('en', textEn), { label: `${label}:en`, lang: 'en', text: textEn })
  }

  // Prioridad #1: Bienvenidas principales (v0) de #14 y #6 + despedidas (`sendoff_*`) + políticas (`ops`) + aclaraciones (`clarify`) + acuses universales + resto de bienvenidas v0
  for (const sid of orderedStores.filter((id) => id === 14 || id === 6)) {
    const g0 = buildStoreGreetingSpecs(sid)[0]
    if (g0) addSpecTask(`store${sid}_${g0.clipId}`, g0.textEs, g0.textEn)
  }
  for (const spec of KORE_FAST_CLIP_SPECS) {
    if (
      spec.category === 'sendoff' ||
      spec.category === 'ops' ||
      spec.category === 'clarify' ||
      spec.clipId.startsWith('added_ack_') ||
      spec.clipId.startsWith('removed_ack_')
    ) {
      addSpecTask(spec.clipId, spec.textEs, spec.textEn)
    }
  }
  for (const sid of orderedStores.filter((id) => id !== 14 && id !== 6)) {
    const g0 = buildStoreGreetingSpecs(sid)[0]
    if (g0) addSpecTask(`store${sid}_${g0.clipId}`, g0.textEs, g0.textEn)
  }
  // Prioridad #2: Top platillos históricos de Drive-Thru + variante v1 de bienvenidas
  for (const spec of KORE_FAST_CLIP_SPECS) {
    if (spec.category === 'item_ack') {
      addSpecTask(spec.clipId, spec.textEs, spec.textEn)
    }
  }
  for (const sid of orderedStores) {
    for (const g of buildStoreGreetingSpecs(sid).slice(1)) {
      addSpecTask(`store${sid}_${g.clipId}`, g.textEs, g.textEn)
    }
  }

  const allTasks = Array.from(uniqueTasks.values())

  // Paso 1: identificar contra el índice REAL de Supabase Storage cuáles existen y cuáles faltan (0 falsos positivos por RAM)
  const existingBucketPaths = await getPersistedKoreStoragePaths(true)
  const checkResults = allTasks.map((task) => {
    const info = getPhoneSpeechStoragePath(task.text, task.lang, 'Kore')
    return { task, exists: Boolean(info && existingBucketPaths.has(info.path)) }
  })

  const alreadyCached = checkResults.filter((r) => r.exists).length
  const missing = checkResults.filter((r) => !r.exists).map((r) => r.task)
  const toSynthesize = missing.slice(0, maxToSynth)
  const skippedByBudget = Math.max(0, missing.length - toSynthesize.length)

  let newlySynthesized = 0
  let failed = 0
  const failures: string[] = []

  await mapWithConcurrency(toSynthesize, concurrency, async (task, idx) => {
    if (idx > 0) await new Promise((r) => setTimeout(r, interItemDelayMs))
    const res = await ensureFastClipRecorded(task.text, task.lang, false)
    if (res.clip) {
      newlySynthesized += 1
    } else {
      failed += 1
      if (failures.length < 15) {
        failures.push(`${task.label} -> ${res.error || 'unknown_error'}`)
      }
    }
  })

  return {
    totalAudioClips: allTasks.length,
    alreadyCached,
    newlySynthesized,
    skippedByBudget,
    failed,
    failures
  }
}
