/**
 * @module api/drive-thru/kore/fast-clips
 * @description Endpoint autenticado para consultar (`GET`) y pre-calentar bajo demanda (`POST`) el banco bilingüe de
 * respuestas de voz pregrabadas (`Kore 3.8`, `24000 Hz` PCM16 en Español e Inglés) de "Kore Drive-Thru", junto con las
 * estadísticas reales de tickets históricos de Drive-Thru (`dt_orders` + `toast_ticket_consumption_snapshots`).
 *
 * @businessRules
 * - **RBAC idéntico al simulador Kore**: `authorizePhoneModuleRequest` (`permission: 'simulate'`) + `KORE_SIM_ALLOWED_ROLES`
 *   y validación de alcance por tienda (`allowedStoreIds`) cuando se especifica `storeId`.
 * - **Cero bloqueo en `GET`**: `GET /api/drive-thru/kore/fast-clips?storeId=14` únicamente devuelve los clips que ya
 *   existen en RAM o en Supabase Storage (`order-ready-tts`), sin disparar síntesis en vivo.
 * - **Pre-grabación bajo demanda en `POST`**: `POST /api/drive-thru/kore/fast-clips` sintetiza con concurrencia controlada
 *   cualquier clip faltante en `Kore 3.8` y devuelve el paquete actualizado.
 *
 * @dataFlow
 * - `GET /api/drive-thru/kore/fast-clips?storeId=14` -> `getKoreFastClipsBundle(storeId)` -> `{ clips, stats }`.
 * - `POST /api/drive-thru/kore/fast-clips` `{ storeId?: number, maxClips?: number }`
 *   -> `prewarmAllKoreFastClips(...)` + `getKoreFastClipsBundle(storeId)` -> `{ ok: true, prewarm, clips, stats }`.
 *
 * @notes
 * - `Cache-Control: no-store` para reflejar de inmediato el conteo real de clips pregrabados en Storage.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { KORE_SIM_ALLOWED_ROLES, loadKoreStore } from '@/lib/drive-thru-kore'
import {
  KORE_DRIVE_THRU_STORE_IDS,
  cacheDynamicKoreFastClip,
  getKoreFastClipsBundle,
  prewarmAllKoreFastClips
} from '@/lib/drive-thru-kore-fast-clips'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS })
}

function parseOptionalStoreId(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw).trim()) ? Number(raw) : NaN
  if (!Number.isInteger(n) || n <= 0) return 'invalid'
  return n
}

function parseNonNegInt(raw: string | null, fallback: number): number | 'invalid' {
  if (raw === null || raw.trim() === '') return fallback
  if (!/^\d+$/.test(raw.trim())) return 'invalid'
  const n = Number(raw.trim())
  return Number.isSafeInteger(n) && n >= 0 ? n : 'invalid'
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401)
    }
    const user = auth.user
    if (!KORE_SIM_ALLOWED_ROLES.has(user.role)) {
      return jsonError(`Acceso denegado: el rol '${user.role}' no tiene acceso a Kore Drive-Thru.`, 403)
    }

    const parsedStoreId = parseOptionalStoreId(request.nextUrl.searchParams.get('storeId'))
    if (parsedStoreId === 'invalid') {
      return jsonError('storeId inválido (usa stores.id numérico).', 400)
    }
    const parsedOffset = parseNonNegInt(request.nextUrl.searchParams.get('offset'), 0)
    const parsedLimit = parseNonNegInt(request.nextUrl.searchParams.get('limit'), 36)
    if (parsedOffset === 'invalid' || parsedLimit === 'invalid' || parsedLimit <= 0) {
      return jsonError('offset y limit deben ser enteros válidos (offset >= 0, limit >= 1).', 400)
    }

    if (parsedStoreId !== null) {
      if (!user.isGlobalAdmin && !user.allowedStoreIds.includes(parsedStoreId)) {
        return jsonError(`Acceso denegado: tu cuenta solo tiene autorización sobre la sucursal #${user.assignedStoreId}.`, 403)
      }
      const store = await loadKoreStore(parsedStoreId)
      if (!store || !store.isActive) return jsonError('Sucursal no encontrada o inactiva.', 404)
      if (!store.hasDriveThru) return jsonError('Esta sucursal no cuenta con Drive-Thru.', 422)
    }

    const bundle = await getKoreFastClipsBundle(parsedStoreId, { offset: parsedOffset, limit: parsedLimit })
    return NextResponse.json(bundle, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[Kore DT fast-clips] GET error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error consultando respuestas de voz pregrabadas de Kore Drive-Thru.', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401)
    }
    const user = auth.user
    if (!KORE_SIM_ALLOWED_ROLES.has(user.role)) {
      return jsonError(`Acceso denegado: el rol '${user.role}' no tiene acceso a Kore Drive-Thru.`, 403)
    }

    const body = await request.json().catch(() => ({}))
    const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, any>) : {}

    if (typeof b.dynamicPhrase === 'string' && b.dynamicPhrase.trim().length > 0) {
      const phraseLang = b.lang === 'en' ? 'en' : 'es'
      const saved = await cacheDynamicKoreFastClip(b.dynamicPhrase, phraseLang)
      return NextResponse.json(saved, { headers: NO_STORE_HEADERS })
    }
    const parsedStoreId = parseOptionalStoreId(b.storeId ?? b.store_id ?? request.nextUrl.searchParams.get('storeId'))
    if (parsedStoreId === 'invalid') {
      return jsonError('storeId inválido (usa stores.id numérico).', 400)
    }

    if (parsedStoreId !== null) {
      if (!user.isGlobalAdmin && !user.allowedStoreIds.includes(parsedStoreId)) {
        return jsonError(`Acceso denegado: tu cuenta solo tiene autorización sobre la sucursal #${user.assignedStoreId}.`, 403)
      }
      const store = await loadKoreStore(parsedStoreId)
      if (!store || !store.isActive) return jsonError('Sucursal no encontrada o inactiva.', 404)
      if (!store.hasDriveThru) return jsonError('Esta sucursal no cuenta con Drive-Thru.', 422)
    }

    const rawMax = Number(b.maxClips ?? b.max_clips)
    const maxClipsToSynthesize = Number.isInteger(rawMax) && rawMax > 0 ? Math.min(350, rawMax) : 80
    const targetStores = parsedStoreId !== null ? [parsedStoreId] : user.isGlobalAdmin ? KORE_DRIVE_THRU_STORE_IDS : user.allowedStoreIds

    const prewarm = await prewarmAllKoreFastClips({
      storeIds: targetStores,
      concurrency: 4,
      maxClipsToSynthesize
    })
    const bundle = await getKoreFastClipsBundle(parsedStoreId, { offset: 0, limit: 36 })

    return NextResponse.json(
      {
        ok: true,
        prewarm,
        ...bundle
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err: any) {
    console.error('[Kore DT fast-clips] POST error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error pre-grabando respuestas de voz de Kore Drive-Thru.', 500)
  }
}
