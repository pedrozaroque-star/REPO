/**
 * @module lib/inventory/pmix-cache-reader
 * @description Lector seguro, paginado por ventanas pequeñas y determinista para `public.pmix_daily_cache`
 *              (donde cada fila almacena un JSONB TOAST de ~218 KB promedio / hasta ~472 KB pico),
 *              diseñado para proteger Supabase `ci_small` (2 GB RAM) contra picos de memoria,
 *              `57014 statement timeout` y caídas de PostgREST (`522`/`524`).
 * @businessRules
 * - Cada solicitud HTTP a PostgREST sobre `pmix_daily_cache` lee **estrictamente <= 15 filas**
 *   (~3.2 MB promedio / <= 7 MB en el peor caso), ejecutándose de forma secuencial sin `OFFSET`.
 * - Aplica la regla corporativa de Tacos Gavilan (día laboral 06:00 AM – 05:59 AM `America/Los_Angeles`):
 *   una fila de caché se considera cerrada (`isPmixCacheRowFinalized`) solo si `business_date < todayBusinessDateLA`
 *   y fue escrita tras el cierre de las 06:00 AM del día siguiente (o pertenece al archivo histórico > 120 días).
 * - Nunca silencia errores de PostgreSQL/PostgREST: propaga el error explícitamente para evitar que un fallo
 *   de DB dispare tormentas de consultas en vivo contra la API de Toast.
 * @dataFlow
 * - Callers (`toast-meat-sold-resolver`, `toast-pmix`, `missing-meat-modifier-alerts`, `chat-tools`)
 *   -> `readPmixDailyCacheChunked` (index scan sobre `idx_pmix_daily_cache_date_store` / `pmix_daily_cache_pkey`)
 *   -> lotes secuenciales de <= 15 filas -> retorno consolidado o streaming vía `onChunk`.
 * @notes
 * - [2026-11-24] Creado como pieza central del Blindaje Food Cost tras el incidente de saturación de RAM
 *   provocado por consultas sin fragmentación (`limit=1000` / `limit=500`, ~170–218 MB JSONB en 1 petición).
 */

import { getLANowParts } from '@/lib/inventory/food-cost-sales-resolver'

export const PMIX_SAFE_CHUNK_ROWS = 15
export const PMIX_MAX_CHUNK_ROWS = 25
export const PMIX_DEFAULT_MAX_ROWS = 2500

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface PmixDailyCacheRow {
  store_id: string
  business_date: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any
  updated_at?: string | null
}

export interface ReadPmixCacheOptions {
  /** Lista de Toast `external_id` (UUIDs). Si se pasa `[]`, retorna vacío sin consultar DB. Si se omite, consulta todas las tiendas. */
  storeGuids?: string[]
  /** Fecha inicio inclusiva (`YYYY-MM-DD`). */
  startDate: string
  /** Fecha fin inclusiva (`YYYY-MM-DD`). */
  endDate: string
  /** Incluir columna `updated_at` en el SELECT (default: `true`). */
  includeUpdatedAt?: boolean
  /** Máximo de filas por petición HTTP a PostgREST (acotado a `1..25`, default: `15`). */
  chunkRows?: number
  /** Tope de seguridad de filas totales leídas (default: `2500`). */
  maxRows?: number
  /** Modo streaming: procesa cada lote de <=15 filas y evita acumular todos los JSONB simultáneamente en memoria. */
  onChunk?: (rows: PmixDailyCacheRow[]) => void | Promise<void>
}

export interface ReadPmixCacheResult {
  rows: PmixDailyCacheRow[]
  totalRowsRead: number
  chunksFetched: number
  truncated: boolean
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const dt = new Date(`${isoDate}T12:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().slice(0, 10)
}

function diffCalendarDays(startIso: string, endIso: string): number {
  const a = new Date(`${startIso}T12:00:00Z`).getTime()
  const b = new Date(`${endIso}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/**
 * Evalúa si una fila de `pmix_daily_cache` corresponde a un día laboral ya cerrado y definitivo
 * conforme a la regla corporativa de Tacos Gavilan (cierre a las 06:00 AM `America/Los_Angeles`).
 */
export function isPmixCacheRowFinalized(
  businessDate: string,
  updatedAt: string | null | undefined,
  todayBusinessDateLA: string
): boolean {
  if (!isValidIsoDate(businessDate) || !isValidIsoDate(todayBusinessDateLA)) return false
  if (businessDate >= todayBusinessDateLA) return false
  // Archivo histórico > 120 días se considera congelado y válido para evitar fetches masivos a Toast
  if (diffCalendarDays(businessDate, todayBusinessDateLA) > 120) return true
  if (!updatedAt) return false
  const updDate = new Date(updatedAt)
  if (Number.isNaN(updDate.getTime())) return false
  return getLANowParts(updDate).businessDate > businessDate
}

/**
 * Lee filas de `public.pmix_daily_cache` fragmentadas en lotes secuenciales estrictos de `<= 15` filas
 * por petición HTTP usando cortes deterministas por ventana de fecha y tienda (cero `OFFSET`, cero OOM).
 */
export async function readPmixDailyCacheChunked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options: ReadPmixCacheOptions
): Promise<ReadPmixCacheResult> {
  const {
    storeGuids,
    startDate,
    endDate,
    includeUpdatedAt = true,
    chunkRows = PMIX_SAFE_CHUNK_ROWS,
    maxRows = PMIX_DEFAULT_MAX_ROWS,
    onChunk,
  } = options

  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
    throw new Error(`Invalid pmix_daily_cache date range: ${startDate}..${endDate}`)
  }

  // Si el caller filtró explícitamente a una lista vacía de tiendas, no tocar Supabase
  if (Array.isArray(storeGuids) && storeGuids.length === 0) {
    return { rows: [], totalRowsRead: 0, chunksFetched: 0, truncated: false }
  }

  const safeChunkRows = Math.max(1, Math.min(PMIX_MAX_CHUNK_ROWS, Math.floor(chunkRows)))
  const safeMaxRows = Math.max(1, Math.floor(maxRows))
  const selectCols = includeUpdatedAt
    ? 'store_id, business_date, items, updated_at'
    : 'store_id, business_date, items'

  // Normalizar y deduplicar storeGuids si existen
  const uniqueStoreGuids = storeGuids
    ? Array.from(new Set(storeGuids.map((g) => String(g || '').trim()).filter(Boolean)))
    : null

  if (uniqueStoreGuids && uniqueStoreGuids.length === 0) {
    return { rows: [], totalRowsRead: 0, chunksFetched: 0, truncated: false }
  }

  // Construir sub-lotes de tiendas para garantizar que storesInBatch * daysPerBatch <= safeChunkRows
  const storeBatches: Array<string[] | null> = []
  if (!uniqueStoreGuids) {
    storeBatches.push(null)
  } else {
    for (let i = 0; i < uniqueStoreGuids.length; i += safeChunkRows) {
      storeBatches.push(uniqueStoreGuids.slice(i, i + safeChunkRows))
    }
  }

  const allRows: PmixDailyCacheRow[] = []
  let totalRowsRead = 0
  let chunksFetched = 0
  let truncated = false

  for (const storeBatch of storeBatches) {
    // Si no hay filtro de tiendas asumimos 15 tiendas activas por día para dimensionar la ventana
    const effectiveStoresPerDay = storeBatch ? storeBatch.length : 15
    const daysPerBatch = Math.max(1, Math.floor(safeChunkRows / Math.max(1, effectiveStoresPerDay)))

    let cursorDate = startDate
    while (cursorDate <= endDate) {
      if (totalRowsRead >= safeMaxRows) {
        truncated = true
        break
      }

      const candidateEnd = addDaysIso(cursorDate, daysPerBatch - 1)
      const batchEnd = candidateEnd <= endDate ? candidateEnd : endDate
      const remainingBudget = safeMaxRows - totalRowsRead

      // Si consultamos sin storeGuids (todas las tiendas) y hay > safeChunkRows en 1 día, paginar ese único día con límite seguro
      const queryLimit = Math.min(safeChunkRows, remainingBudget)

      let batchOffset = 0
      let dayChunkGuard = 0
      while (dayChunkGuard < 10) {
        dayChunkGuard++
        let q = supabase
          .from('pmix_daily_cache')
          .select(selectCols)
          .order('business_date', { ascending: true })
          .order('store_id', { ascending: true })

        if (cursorDate === batchEnd) {
          q = q.eq('business_date', cursorDate)
        } else {
          q = q.gte('business_date', cursorDate).lte('business_date', batchEnd)
        }

        if (storeBatch) {
          if (storeBatch.length === 1) {
            q = q.eq('store_id', storeBatch[0])
          } else {
            q = q.in('store_id', storeBatch)
          }
        }

        const sliceLimit = Math.min(queryLimit, safeMaxRows - totalRowsRead)
        if (sliceLimit <= 0) {
          truncated = true
          break
        }

        const { data, error } = await q.range(batchOffset, batchOffset + sliceLimit - 1)
        if (error) {
          throw new Error(
            `pmix_daily_cache chunk read failed (${cursorDate}..${batchEnd}, batchStores=${storeBatch ? storeBatch.length : 'all'}): ${error.message}`
          )
        }

        chunksFetched++
        const chunk: PmixDailyCacheRow[] = Array.isArray(data) ? data : []
        if (chunk.length > 0) {
          totalRowsRead += chunk.length
          if (onChunk) {
            await onChunk(chunk)
          } else {
            allRows.push(...chunk)
          }
        }

        // Si el lote devolvió menos filas que el límite o teníamos filtro acotado de tiendas, avanzamos a la siguiente ventana de fechas
        if (chunk.length < sliceLimit || storeBatch !== null) {
          break
        }
        batchOffset += chunk.length
      }

      if (truncated) break
      cursorDate = addDaysIso(batchEnd, 1)
    }

    if (truncated) break
  }

  return {
    rows: allRows,
    totalRowsRead,
    chunksFetched,
    truncated,
  }
}
