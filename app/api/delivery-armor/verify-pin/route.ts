/**
 * @module app/api/delivery-armor/verify-pin/route
 * @description Endpoint para validar el PIN de 4 dígitos de colaboradores contra RONOS y gestionar la sesión única activa por tienda.
 *
 * @businessRules
 *   - El PIN del empleado se obtiene y valida contra RONOS, NUNCA de Toast.
 *   - Solo puede existir 1 sesión de PIN activa por sucursal (`storeId`): si otra persona inicia sesión en esa tienda, la sesión anterior se invalida inmediatamente.
 *   - Límite anti-fuerza bruta por IP+sucursal (`máx 8 intentos fallidos / 5 min`, `429 Retry-After`) y enfriamiento de `60s` sobre refrescos en vivo a RONOS (`forceRefresh`).
 *   - `DELETE` exige `sessionToken` válido que coincida con la sesión activa de la tienda (`crypto.timingSafeEqual`) o sesión autenticada de personal (`verifyStaffAuth` + `authorizeStoreScope`).
 *
 * @dataFlow
 *   Client Tablet -> POST/PUT/DELETE { storeId, pin / sessionToken } -> Rate Limit + verifyRonosPin() + registerExclusiveStorePinSession() -> Supabase -> Response JSON.
 *
 * @notes
 *   - Blindaje de Seguridad (2026-11-21): rate limit de intentos fallidos, cooldown de 60s ante misses en vivo de RONOS y autorización obligatoria en `DELETE`.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeStoreScope, getServerUser, verifyStaffAuth } from '@/lib/auth-server'
import {
  verifyRonosPin,
  getRonosCompanyId,
  getActiveStorePinSession,
  registerExclusiveStorePinSession,
  touchActiveStorePinSession,
  clearActiveStorePinSession
} from '@/lib/delivery-armor'

const MAX_PIN_BUCKETS = 2000
const FAILED_PIN_LIMIT = 8
const FAILED_PIN_WINDOW_MS = 5 * 60_000
const LIVE_RONOS_MISS_COOLDOWN_MS = 60_000

const failedPinBuckets = new Map<string, number[]>()
const lastLiveMissByStore = new Map<number, number>()

function extractTrustedIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function getFailedPinStatus(key: string, now = Date.now()): { blocked: boolean; retryAfterSec: number } {
  const hits = (failedPinBuckets.get(key) || []).filter((t) => now - t < FAILED_PIN_WINDOW_MS)
  if (hits.length === 0) {
    failedPinBuckets.delete(key)
    return { blocked: false, retryAfterSec: 0 }
  }
  failedPinBuckets.set(key, hits)
  if (hits.length >= FAILED_PIN_LIMIT) {
    const retryAfterSec = Math.max(1, Math.ceil((FAILED_PIN_WINDOW_MS - (now - hits[0])) / 1000))
    return { blocked: true, retryAfterSec }
  }
  return { blocked: false, retryAfterSec: 0 }
}

function recordFailedPinAttempt(key: string, now = Date.now()) {
  if (failedPinBuckets.size >= MAX_PIN_BUCKETS && !failedPinBuckets.has(key)) {
    for (const [k, arr] of failedPinBuckets) {
      const valid = arr.filter((t) => now - t < FAILED_PIN_WINDOW_MS)
      if (valid.length === 0) failedPinBuckets.delete(k)
      else failedPinBuckets.set(k, valid)
    }
    if (failedPinBuckets.size >= MAX_PIN_BUCKETS) {
      const oldest = failedPinBuckets.keys().next().value
      if (oldest) failedPinBuckets.delete(oldest)
    }
  }
  const hits = (failedPinBuckets.get(key) || []).filter((t) => now - t < FAILED_PIN_WINDOW_MS)
  hits.push(now)
  failedPinBuckets.set(key, hits)
}

function safeTimingEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    const ha = createHash('sha256').update(bufA).digest()
    const hb = createHash('sha256').update(bufB).digest()
    timingSafeEqual(ha, hb)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

async function verifyCachedRonosPinDuringCooldown(storeId: number, cleanPin: string): Promise<{
  valid: boolean
  employeeUserId?: number
  fullName?: string
  jobTitle?: string
}> {
  const companyId = getRonosCompanyId(storeId)
  const { data: latestWeek } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id')
    .eq('company_id', companyId)
    .order('week_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestWeek?.week_id) {
    const { data: rows } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('employee_user_id, full_name, job_title, pin')
      .eq('company_id', companyId)
      .eq('week_id', latestWeek.week_id)

    const match = (rows || []).find((r: any) => safeTimingEqualStrings(String(r.pin || '').trim(), cleanPin))
    if (match && Number(match.employee_user_id) > 0 && match.full_name) {
      return {
        valid: true,
        employeeUserId: Number(match.employee_user_id),
        fullName: String(match.full_name),
        jobTitle: match.job_title ? String(match.job_title) : 'Colaborador',
      }
    }
  }
  return { valid: false }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const { storeId, pin } = body || {}

    if (!storeId || !pin) {
      return NextResponse.json(
        {
          ok: false,
          error: 'storeId y pin son campos obligatorios.'
        },
        { status: 400 }
      )
    }

    const numericStoreId = Number(storeId)
    const cleanPin = String(pin || '').trim()
    if (!Number.isInteger(numericStoreId) || numericStoreId <= 0 || !/^\d{4}$/.test(cleanPin)) {
      return NextResponse.json(
        { ok: false, error: 'storeId válido y PIN numérico de 4 dígitos son obligatorios.' },
        { status: 400 }
      )
    }

    const ip = extractTrustedIp(req.headers)
    const rateKey = `${ip}:${numericStoreId}`
    const rl = getFailedPinStatus(rateKey)
    if (rl.blocked) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: `Demasiados intentos fallidos de PIN. Espera ${rl.retryAfterSec}s antes de intentar nuevamente.`
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const now = Date.now()
    const lastMissAt = lastLiveMissByStore.get(numericStoreId) || 0
    const inLiveRefreshCooldown = now - lastMissAt < LIVE_RONOS_MISS_COOLDOWN_MS

    let verification: {
      valid: boolean
      employeeUserId?: number
      fullName?: string
      jobTitle?: string
      error?: string
    }

    if (inLiveRefreshCooldown) {
      const cachedRes = await verifyCachedRonosPinDuringCooldown(numericStoreId, cleanPin)
      verification = cachedRes.valid
        ? cachedRes
        : { valid: false, error: 'PIN no válido en RONOS.' }
    } else {
      verification = await verifyRonosPin(numericStoreId, cleanPin)
      if (!verification.valid) {
        lastLiveMissByStore.set(numericStoreId, Date.now())
      }
    }

    if (!verification.valid || !verification.employeeUserId || !verification.fullName) {
      recordFailedPinAttempt(rateKey)
      return NextResponse.json(
        {
          ok: false,
          error: verification.error || 'PIN no válido en RONOS.'
        },
        { status: 401 }
      )
    }

    failedPinBuckets.delete(rateKey)

    const session = await registerExclusiveStorePinSession({
      storeId: numericStoreId,
      employeeUserId: verification.employeeUserId,
      employeeName: verification.fullName,
      jobTitle: verification.jobTitle || 'Colaborador'
    })

    return NextResponse.json({
      ok: true,
      verified: true,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      session,
      employee: {
        id: verification.employeeUserId,
        employee_id: verification.employeeUserId,
        fullName: verification.fullName,
        full_name: verification.fullName,
        jobTitle: verification.jobTitle,
        job_title: verification.jobTitle
      }
    })
  } catch (err: any) {
    console.error('Error en POST /api/delivery-armor/verify-pin:', err)
    return NextResponse.json(
      {
        ok: false,
        error: 'Error al verificar PIN de RONOS'
      },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const storeId = Number(body.storeId)
    const sessionToken = String(body.sessionToken || '').trim()

    if (!storeId || !sessionToken) {
      return NextResponse.json({ ok: false, valid: false }, { status: 400 })
    }

    const check = await touchActiveStorePinSession(storeId, sessionToken)
    if (!check.valid) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          replacedBy: check.replacedBy || null,
          expired: !!check.expired
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ok: true,
      valid: true,
      session: check.session
    })
  } catch {
    return NextResponse.json({ ok: false, valid: false }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const storeId = Number(body?.storeId)
    const sessionToken = body?.sessionToken ? String(body.sessionToken).trim() : ''

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'storeId inválido.' }, { status: 400 })
    }

    const staffAuth = verifyStaffAuth(req, { allowCron: false })
    if (staffAuth.authorized && staffAuth.user) {
      const serverUser = (await getServerUser(req)) || {
        id: staffAuth.user.id,
        email: staffAuth.user.email,
        name: staffAuth.user.user_metadata?.full_name || staffAuth.user.email,
        role: staffAuth.user.role,
        store_id: staffAuth.user.user_metadata?.store_id,
        store_ids: staffAuth.user.user_metadata?.store_ids,
        store_scope: staffAuth.user.user_metadata?.store_scope,
      }
      const scopeCheck = await authorizeStoreScope(serverUser, storeId, supabaseAdmin, { action: 'view' })
      if (!scopeCheck.authorized) {
        return NextResponse.json(
          { ok: false, error: scopeCheck.error || 'No autorizado para esta sucursal.' },
          { status: scopeCheck.status || 403 }
        )
      }
      await clearActiveStorePinSession(storeId, sessionToken || undefined)
      return NextResponse.json({ ok: true })
    }

    if (!sessionToken) {
      return NextResponse.json(
        { ok: false, error: 'No autorizado: se requiere sessionToken válido o sesión administrativa.' },
        { status: 401 }
      )
    }

    const activeSession = await getActiveStorePinSession(storeId)
    if (!activeSession) {
      return NextResponse.json({ ok: false, error: 'No existe sesión activa para esta sucursal.' }, { status: 401 })
    }

    if (!safeTimingEqualStrings(sessionToken, activeSession.sessionToken)) {
      return NextResponse.json(
        { ok: false, error: 'sessionToken no coincide con la sesión activa de la sucursal.' },
        { status: 403 }
      )
    }

    await clearActiveStorePinSession(storeId, sessionToken)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Error cerrando sesión de PIN.' }, { status: 500 })
  }
}
