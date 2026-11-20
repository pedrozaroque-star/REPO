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
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getPhoneAgentSpeech, getPhoneSpeechStoragePath } from '@/lib/order-ready-tts'
import { pickKoreDriveThruGreeting, type KoreLang } from '@/lib/drive-thru-kore'
import { KORE_FAST_CLIP_SPECS } from '@/lib/drive-thru-kore-fast-match'

export const KORE_DRIVE_THRU_STORE_IDS: readonly number[] = Object.freeze([3, 6, 10, 12, 14, 15])
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
  /** Total de archivos individuales de audio (cada situación cuenta 2: `es` + `en`). */
  totalClips: number
  /** Archivos de audio ya disponibles en Storage / RAM listos para reproducción `< 10 ms`. */
  cachedClips: number
  /** Total de situaciones bilingües incluidas en `clips`. */
  totalSituations: number
}

export interface KoreFastClipsBundleResponse {
  clips: Record<string, { es: KoreEncodedFastClip | null; en: KoreEncodedFastClip | null }>
  stats: KoreFastClipsBundleStats
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
 * Extrae las muestras crudas PCM16 LE (`base64`) y `sampleRate` desde un `Buffer` RIFF/WAV de `getPhoneAgentSpeech`,
 * omitiendo por completo el encabezado WAV para evitar artefactos al decodificar en el navegador.
 */
export function extractPcm16FromWav(wav: Buffer): { pcm16Base64: string; sampleRate: number } | null {
  if (!Buffer.isBuffer(wav) || wav.length <= 44) return null
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    const evenLen = wav.length - (wav.length % 2)
    return evenLen > 0 ? { pcm16Base64: wav.subarray(0, evenLen).toString('base64'), sampleRate: 24000 } : null
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
      return {
        pcm16Base64: wav.subarray(dataStart, dataStart + evenLen).toString('base64'),
        sampleRate
      }
    }
    offset = dataStart + chunkSize + (chunkSize % 2)
  }

  const tail = wav.subarray(44)
  const evenLen = tail.length - (tail.length % 2)
  return evenLen > 0 ? { pcm16Base64: tail.subarray(0, evenLen).toString('base64'), sampleRate } : null
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
    .slice(0, 12)

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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const wav = await getPhoneAgentSpeech(cleanText, lang, 'Kore', forceRegenerate || attempt > 0, {
        skipSseAttempt: true,
        awaitStoragePersist: true,
        requireKore38: true
      })
      const parsed = extractPcm16FromWav(wav)
      if (!parsed) {
        lastErr = 'invalid_wav'
        continue
      }
      // Verificar existencia REAL en el bucket de Supabase Storage (sin pasar por `memoryPhoneAudioCache` en RAM)
      const persistedInBucket = await verifyPathExistsInStorageBucket(info.path)
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
        await new Promise((r) => setTimeout(r, 1500))
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

/**
 * Devuelve el paquete completo de clips pregrabados (`es` + `en`) disponibles en Storage junto con las estadísticas
 * históricas reales de Drive-Thru (`dt_orders` + `toast_ticket_consumption_snapshots`).
 */
export async function getKoreFastClipsBundle(storeId?: number | null): Promise<KoreFastClipsBundleResponse> {
  const validStoreId =
    typeof storeId === 'number' && Number.isInteger(storeId) && KORE_DRIVE_THRU_STORE_IDS.includes(storeId)
      ? storeId
      : null

  const entries: Array<{ clipId: string; textEs: string; textEn: string }> = [
    ...KORE_FAST_CLIP_SPECS.map((s) => ({ clipId: s.clipId, textEs: s.textEs, textEn: s.textEn })),
    ...(validStoreId ? buildStoreGreetingSpecs(validStoreId) : [])
  ]

  const tasks: Array<{ clipId: string; lang: KoreLang; text: string }> = []
  for (const e of entries) {
    tasks.push({ clipId: e.clipId, lang: 'es', text: e.textEs })
    tasks.push({ clipId: e.clipId, lang: 'en', text: e.textEn })
  }

  const [knownPaths, analytics] = await Promise.all([
    getPersistedKoreStoragePaths(),
    getKoreHistoricalDriveThruAnalytics()
  ])

  const loadedList = await mapWithConcurrency(tasks, 6, async (t) => ({
    clipId: t.clipId,
    lang: t.lang,
    clip: await loadFastClipFromStorageOnly(t.text, t.lang, knownPaths)
  }))

  const clips: Record<string, { es: KoreEncodedFastClip | null; en: KoreEncodedFastClip | null }> = {}
  for (const e of entries) {
    clips[e.clipId] = { es: null, en: null }
  }

  let cachedClips = 0
  for (const item of loadedList) {
    if (!clips[item.clipId]) clips[item.clipId] = { es: null, en: null }
    clips[item.clipId][item.lang] = item.clip
    if (item.clip) cachedClips += 1
  }

  return {
    clips,
    stats: {
      totalClips: tasks.length,
      cachedClips,
      totalSituations: entries.length,
      historicalDtOrdersCount: analytics.historicalDtOrdersCount,
      historicalDetailedSnapshotsCount: analytics.historicalDetailedSnapshotsCount,
      topDriveThruItems: analytics.topDriveThruItems
    }
  }
}

/**
 * Pre-graba y persiste en Supabase Storage cualquier clip faltante del catálogo común (`KORE_FAST_CLIP_SPECS`)
 * y de las bienvenidas de las 6 sucursales con Drive-Thru (`#3, #6, #10, #12, #14, #15`) en Español e Inglés.
 */
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
  const concurrency = Math.max(1, Math.min(4, opts?.concurrency ?? 3))
  const maxToSynth =
    typeof opts?.maxClipsToSynthesize === 'number' && opts.maxClipsToSynthesize > 0
      ? Math.trunc(opts.maxClipsToSynthesize)
      : 500

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
    if (idx > 0) await new Promise((r) => setTimeout(r, 280))
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
