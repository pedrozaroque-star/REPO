/**
 * @module api/cron/retention-cleanup
 * @description Cron nocturno de sustentabilidad y auto-limpieza de Supabase (`45 12 * * *` UTC = 4:45 AM PST / 5:45 AM PDT,
 * durante horario cerrado de todas las sucursales) para mantener la base de datos y Storage siempre holgados por debajo de
 * los límites de Supabase Pro (8 GB BD / 100 GB Storage) sin perder jamás datos financieros, de nómina, contabilidad ni aprendizaje IA.
 *
 * @businessRules
 * - **Fail-closed auth**: exige `Authorization: Bearer <CRON_SECRET>` válido (comparación en tiempo constante) O sesión
 *   administrativa global (`manage_global` vía `authorizePhoneModuleRequest`).
 * - **Paso 1 — Audios efímeros de Contestadora IA (`order-ready-tts/phone_v6_tmp/*`, TTL 24h)**:
 *   * Elimina únicamente archivos con prefijo estricto `phone_v6_tmp/` mayores a 24 horas.
 *   * PROHIBIDO tocar `phone_v6/` (saludos y respuestas canónicas permanentes), `v4/` (Order Ready), `announcements/` ni `_config/`.
 * - **Paso 2 — Evidencia fotográfica de Blindaje Delivery (`delivery-evidence/*`, TTL 90 días)**:
 *   * Solo limpia fotos de `delivery_packing_audits` > 90 días (fuera de ventana de disputa) cuyo `dispute_status` NO esté
 *     abierto (`open`, `pending`, `in_review`, `disputed`), limpiando únicamente las URLs de foto y conservando 100% de la fila de auditoría.
 *   * También depura archivos huérfanos en `delivery-evidence` mayores a 95 días.
 * - **Paso 3 — Rollups sin pérdida y retención en Postgres (`public.run_retention_maintenance`)**:
 *   * `meat_consumption_history` > 180 días -> resume en `meat_consumption_daily_summary` (preserva 100% pronóstico Champurrado 5 años) y poda intervalos de 30m.
 *   * `order_ready_announcements` + `order_ready_voice_playbacks` > 90 días -> resume en `order_ready_daily_metrics` y poda filas granulares.
 *   * `delivery_platform_orders` (`reconciliation_status = 'MATCHED'` y > 90 días) -> conserva 100% de filas y llaves de conciliación/CPA, removiendo solo bloques webhook voluminosos de `raw_payload`.
 *   * `notifications` > 30 días -> depura notificaciones históricas antiguas (la UI solo muestra la semana laboral actual desde lunes 6:00 AM).
 *   * `phone_calls` y `dt_kore_sim_sessions` > 180 días y ya analizados (`analyzed_at IS NOT NULL`) -> compacta únicamente `transcript` a `[]` conservando 100% de filas, totales, resúmenes y aprendizajes (`phone_learning_items` / `dt_kore_learning_items`).
 * - **Intocables**: `punches`, `external_accounting_transactions`, `pmix_daily_cache`, `sales_daily_cache`, `food_cost_daily_cache`, `sales_discounts_log`, `phone_learning_items`, `dt_kore_learning_items`, `phone_knowledge_base`.
 *
 * @dataFlow
 * - Vercel Cron (`45 12 * * *`) o Admin (`?dryRun=1` opcional) -> `GET/POST /api/cron/retention-cleanup`
 *   -> Storage cleanup (`order-ready-tts/phone_v6_tmp/`, `delivery-evidence/`) + RPC `run_retention_maintenance` -> JSON resumen.
 *
 * @notes
 * - `preferredRegion = 'sfo1'` y `maxDuration = 60` para baja latencia con Supabase `us-west-1`.
 * - Operación acotada por lote e idempotente: seguro re-ejecutar manualmente o en modo `?dryRun=1`.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCronSecret } from '@/lib/auth-server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { PHONE_EPHEMERAL_STORAGE_DIR } from '@/lib/order-ready-tts'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'sfo1'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const TTS_BUCKET = 'order-ready-tts'
const DELIVERY_EVIDENCE_BUCKET = 'delivery-evidence'
const EPHEMERAL_TTS_TTL_MS = 24 * 60 * 60 * 1000
const DELIVERY_PHOTO_RETENTION_DAYS = 90
const DELIVERY_ORPHAN_RETENTION_DAYS = 95
const OPEN_DISPUTE_STATUSES = new Set(['open', 'pending', 'in_review', 'disputed'])
const MAX_TTS_FILES_PER_RUN = 500
const MAX_DELIVERY_AUDITS_PER_RUN = 250
const STORAGE_REMOVE_CHUNK = 100

function hasValidCronBearer(request: NextRequest): boolean {
  const secret = getCronSecret()
  if (!secret) return false
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return false
  const provided = authHeader.slice(7).trim()
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function extractStoragePathFromPublicUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null
  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`
  ]
  for (const marker of markers) {
    const idx = trimmed.indexOf(marker)
    if (idx !== -1) {
      const raw = trimmed.slice(idx + marker.length).split('?')[0]
      const decoded = decodeURIComponent(raw).replace(/^\/+/, '')
      if (decoded && !decoded.includes('..')) return decoded
    }
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.includes('..')) {
    return trimmed.replace(/^\/+/, '')
  }
  return null
}

function getFileAgeMs(entry: { created_at?: string | null; updated_at?: string | null }, nowMs: number): number | null {
  const ts = entry.updated_at || entry.created_at
  if (!ts) return null
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, nowMs - parsed)
}

async function listExpiredFilesUnderPrefix(
  bucket: string,
  rootPrefix: string,
  ttlMs: number,
  maxFiles: number,
  nowMs = Date.now()
): Promise<{ expiredPaths: string[]; scanned: number }> {
  const expiredPaths: string[] = []
  let scanned = 0
  const queue: string[] = [rootPrefix]

  while (queue.length > 0 && expiredPaths.length < maxFiles) {
    const prefix = queue.shift()!
    let offset = 0
    const limit = 100

    while (expiredPaths.length < maxFiles) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, {
        limit,
        offset,
        sortBy: { column: 'created_at', order: 'asc' }
      })
      if (error || !data || data.length === 0) break

      for (const item of data) {
        if (!item?.name) continue
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name
        // En Supabase Storage, las carpetas virtuales tienen id === null y metadata === null
        const isFolder = item.id === null && !item.metadata
        if (isFolder) {
          queue.push(fullPath)
          continue
        }
        scanned += 1
        const ageMs = getFileAgeMs(item, nowMs)
        if (ageMs !== null && ageMs >= ttlMs) {
          expiredPaths.push(fullPath)
          if (expiredPaths.length >= maxFiles) break
        }
      }

      if (data.length < limit) break
      offset += limit
    }
  }

  return { expiredPaths, scanned }
}

async function cleanupEphemeralPhoneTts(dryRun: boolean): Promise<{
  prefix: string
  ttlHours: number
  scanned: number
  eligible: number
  deleted: number
  errors: string[]
}> {
  const errors: string[] = []
  const requiredPrefix = `${PHONE_EPHEMERAL_STORAGE_DIR}/`
  const { expiredPaths, scanned } = await listExpiredFilesUnderPrefix(
    TTS_BUCKET,
    PHONE_EPHEMERAL_STORAGE_DIR,
    EPHEMERAL_TTS_TTL_MS,
    MAX_TTS_FILES_PER_RUN
  )

  // Candado estricto: jamás permitir borrar fuera de `phone_v6_tmp/`
  const safePaths = expiredPaths.filter((p) => p.startsWith(requiredPrefix) && !p.includes('..'))
  let deleted = 0

  if (!dryRun && safePaths.length > 0) {
    for (let i = 0; i < safePaths.length; i += STORAGE_REMOVE_CHUNK) {
      const chunk = safePaths.slice(i, i + STORAGE_REMOVE_CHUNK)
      const { error } = await supabaseAdmin.storage.from(TTS_BUCKET).remove(chunk)
      if (error) {
        errors.push(`remove chunk ${i}: ${error.message}`)
      } else {
        deleted += chunk.length
      }
    }
  }

  return {
    prefix: requiredPrefix,
    ttlHours: 24,
    scanned,
    eligible: safePaths.length,
    deleted,
    errors
  }
}

async function cleanupExpiredDeliveryEvidence(dryRun: boolean): Promise<{
  retentionDays: number
  auditsEligible: number
  auditsCleared: number
  filesDeleted: number
  orphanFilesDeleted: number
  errors: string[]
}> {
  const errors: string[] = []
  const cutoffIso = new Date(Date.now() - DELIVERY_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: audits, error: queryErr } = await supabaseAdmin
    .from('delivery_packing_audits')
    .select('id, photo_open_url, photo_sealed_url, dispute_status, created_at')
    .lt('created_at', cutoffIso)
    .or('photo_open_url.not.is.null,photo_sealed_url.not.is.null')
    .order('created_at', { ascending: true })
    .limit(MAX_DELIVERY_AUDITS_PER_RUN)

  if (queryErr) {
    return {
      retentionDays: DELIVERY_PHOTO_RETENTION_DAYS,
      auditsEligible: 0,
      auditsCleared: 0,
      filesDeleted: 0,
      orphanFilesDeleted: 0,
      errors: [queryErr.message]
    }
  }

  const eligibleAudits = (audits || []).filter((a) => {
    const status = String(a.dispute_status || 'none').trim().toLowerCase()
    return !OPEN_DISPUTE_STATUSES.has(status)
  })

  const pathsToDelete = new Set<string>()
  for (const audit of eligibleAudits) {
    const openPath = extractStoragePathFromPublicUrl(audit.photo_open_url, DELIVERY_EVIDENCE_BUCKET)
    const sealedPath = extractStoragePathFromPublicUrl(audit.photo_sealed_url, DELIVERY_EVIDENCE_BUCKET)
    if (openPath) pathsToDelete.add(openPath)
    if (sealedPath) pathsToDelete.add(sealedPath)
  }

  let filesDeleted = 0
  let auditsCleared = 0

  if (!dryRun && eligibleAudits.length > 0) {
    const pathList = Array.from(pathsToDelete)
    for (let i = 0; i < pathList.length; i += STORAGE_REMOVE_CHUNK) {
      const chunk = pathList.slice(i, i + STORAGE_REMOVE_CHUNK)
      const { error: remErr } = await supabaseAdmin.storage.from(DELIVERY_EVIDENCE_BUCKET).remove(chunk)
      if (remErr) {
        errors.push(`delivery remove chunk ${i}: ${remErr.message}`)
      } else {
        filesDeleted += chunk.length
      }
    }

    // Solo limpiar las URLs si no hubo errores borrando archivos (conserva 100% de la fila de auditoría)
    if (errors.length === 0) {
      const ids = eligibleAudits.map((a) => a.id)
      const { error: updErr } = await supabaseAdmin
        .from('delivery_packing_audits')
        .update({ photo_open_url: null, photo_sealed_url: null })
        .in('id', ids)
      if (updErr) {
        errors.push(`clear audit photo urls: ${updErr.message}`)
      } else {
        auditsCleared = ids.length
      }
    }
  }

  // Limpieza secundaria de huérfanos > 95 días dentro de `delivery-evidence`
  const { expiredPaths: orphanPaths } = await listExpiredFilesUnderPrefix(
    DELIVERY_EVIDENCE_BUCKET,
    '',
    DELIVERY_ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    200
  )
  let orphanFilesDeleted = 0
  if (!dryRun && orphanPaths.length > 0) {
    for (let i = 0; i < orphanPaths.length; i += STORAGE_REMOVE_CHUNK) {
      const chunk = orphanPaths.slice(i, i + STORAGE_REMOVE_CHUNK)
      const { error: orphErr } = await supabaseAdmin.storage.from(DELIVERY_EVIDENCE_BUCKET).remove(chunk)
      if (orphErr) {
        errors.push(`orphan delivery remove ${i}: ${orphErr.message}`)
      } else {
        orphanFilesDeleted += chunk.length
      }
    }
  }

  return {
    retentionDays: DELIVERY_PHOTO_RETENTION_DAYS,
    auditsEligible: eligibleAudits.length,
    auditsCleared,
    filesDeleted,
    orphanFilesDeleted: dryRun ? orphanPaths.length : orphanFilesDeleted,
    errors
  }
}

async function handleRun(request: NextRequest) {
  try {
    if (!hasValidCronBearer(request)) {
      const auth = await authorizePhoneModuleRequest(request, { permission: 'manage_global' })
      if (!auth.authorized || !auth.user) {
        return (
          auth.response ||
          NextResponse.json(
            { error: auth.error || 'No autorizado' },
            { status: auth.status || 401, headers: NO_STORE_HEADERS }
          )
        )
      }
    }

    const dryRun =
      request.nextUrl.searchParams.get('dryRun') === '1' ||
      request.nextUrl.searchParams.get('dry_run') === '1'

    const startedAt = Date.now()
    const [ephemeralPhoneTts, deliveryEvidence, dbRetentionRes] = await Promise.all([
      cleanupEphemeralPhoneTts(dryRun),
      cleanupExpiredDeliveryEvidence(dryRun),
      supabaseAdmin.rpc('run_retention_maintenance', {
        p_dry_run: dryRun,
        p_meat_batch_days: 45,
        p_order_ready_batch_days: 30,
        p_delivery_batch_rows: 2000
      })
    ])

    if (dbRetentionRes.error) {
      console.error('[CRON retention-cleanup] DB RPC error:', dbRetentionRes.error.message)
      return NextResponse.json(
        {
          ok: false,
          dryRun,
          elapsedMs: Date.now() - startedAt,
          ephemeralPhoneTts,
          deliveryEvidence,
          dbRetentionError: dbRetentionRes.error.message
        },
        { status: 500, headers: NO_STORE_HEADERS }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        dryRun,
        ranAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        ephemeralPhoneTts,
        deliveryEvidence,
        dbRetention: dbRetentionRes.data
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CRON retention-cleanup] Error:', msg.slice(0, 300))
    return NextResponse.json(
      { ok: false, error: 'Error ejecutando retención nocturna' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function GET(request: NextRequest) {
  return handleRun(request)
}

export async function POST(request: NextRequest) {
  return handleRun(request)
}
