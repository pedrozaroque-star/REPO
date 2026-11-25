/**
 * @module app/api/delivery-armor/phone-notes/route
 * @description Endpoint en vivo para alertas telefónicas de condimentos gratuitos y modificaciones sin costo
 *   en órdenes de DoorDash, Uber Eats, Grubhub y Tacos Gavilan Online hacia la tableta Delivery Armor y
 *   temporalmente hacia la tableta de llamado de clientes (`/inventory/preparador`) y `/order-ready-board`.
 *
 * @businessRules
 * - `GET ?storeId=6`: retorna las notas activas (`pending`, `acknowledged`) y aplicadas recientes para la sucursal.
 *   Exige sesión autenticada con alcance a `storeId` (cookie `teg_token` o `Authorization: Bearer`, con ventana
 *   de gracia 24/7 acotada a 14 días y verificación live `users.is_active !== false`) O un PIN RONOS de 4 dígitos
 *   válido de esa sucursal. `includeSimulator=1` solo se honra para administradores globales (`access.all === true`).
 * - `POST`: endpoint interno firmado con HMAC-SHA256 (mismo secreto `PHONE_TTS_SIGNING_SECRET || SUPABASE_SERVICE_ROLE_KEY`
 *   que `/api/phone/verify-order`, ventana ±5 min) invocado por `phone-live-bridge` en tiempo real para emparejar la orden
 *   activa y encender la alerta parpadeante en las tabletas de la sucursal.
 * - `PATCH`: soporta dos modos de autenticación autoritativa en servidor:
 *   1) **Tableta Delivery Armor**: PIN de RONOS de 4 dígitos verificado contra la sucursal (`verifyRonosPin`).
 *   2) **Tableta de Llamado de Clientes (`/inventory/preparador`) y `/order-ready-board`**: sesión autenticada
 *      verificada en servidor con alcance válido a `storeId`, derivando `actorName` desde `public.users` (nunca del body).
 *   Marca la nota como `acknowledge`, `apply` o `dismiss`, emite ping Realtime Broadcast instantáneo para apagar el
 *   parpadeo en TODAS las tabletas de la sucursal y resuelve cualquier callback ligado en `phone_callback_requests`.
 *
 * @dataFlow
 * - `phone-live-bridge` -> POST (HMAC) -> `createOrUpdateDeliveryArmorPhoneNote()` -> Supabase + Realtime Broadcast
 * - Tableta Delivery Armor / Tableta de Llamado / Order Ready Board -> GET / PATCH -> `listDeliveryArmorPhoneNotes()` / `updateDeliveryArmorPhoneNoteStatus()`
 *
 * @notes
 * - 2026-11-24: Se habilitó autenticación dual en `GET` y `PATCH` para que la tableta de llamado de clientes
 *   (`/inventory/preparador`) y `/order-ready-board` operen temporalmente la alerta parpadeante con la misma
 *   funcionalidad de Delivery Armor sin requerir PIN de empacador y con aislamiento estricto por sucursal.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { NextRequest, NextResponse } from 'next/server'
import {
  createOrUpdateDeliveryArmorPhoneNote,
  listDeliveryArmorPhoneNotes,
  updateDeliveryArmorPhoneNoteStatus
} from '@/lib/delivery-armor-phone-notes'
import { verifyRonosPin } from '@/lib/delivery-armor'
import { getJwtSecret, getServerUser, MAX_EXPIRED_GRACE_MS } from '@/lib/auth-server'
import { canAccessStore, resolveOrderReadyAccess, type OrderReadyAccess } from '@/lib/order-ready-access'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 15

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const STORE_CODE_CACHE_TTL_MS = 15 * 60 * 1000
let storeCodeByIdCache: { at: number; map: Map<number, string> } | null = null

async function resolveStoreCodeById(storeId: number): Promise<string | null> {
  const now = Date.now()
  if (storeCodeByIdCache && now - storeCodeByIdCache.at < STORE_CODE_CACHE_TTL_MS) {
    return storeCodeByIdCache.map.get(storeId) || null
  }
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, code, is_active')
  if (error || !Array.isArray(data)) {
    return storeCodeByIdCache?.map.get(storeId) || null
  }
  const nextMap = new Map<number, string>()
  for (const row of data as Array<{ id: number | string; code?: string | null; is_active?: boolean | null }>) {
    if (row.is_active === false) continue
    const idNum = Number(row.id)
    const code = String(row.code || '').trim().toUpperCase()
    if (Number.isInteger(idNum) && idNum > 0 && code) {
      nextMap.set(idNum, code)
    }
  }
  storeCodeByIdCache = { at: now, map: nextMap }
  return nextMap.get(storeId) || null
}

type TabletSessionAuthResult =
  | { ok: true; userId: string | number; actorName: string; role: string; access: OrderReadyAccess }
  | { ok: false; status: 401 | 403 | 404; error: string }

async function resolveAuthenticatedTabletSession(
  req: NextRequest,
  storeId: number
): Promise<TabletSessionAuthResult> {
  let userId: string | number | null = null
  let fallbackName = ''
  let fallbackEmail = ''
  let tokenRole = ''

  const activeUser = await getServerUser(req)
  if (activeUser) {
    userId = activeUser.id
    fallbackName = activeUser.name || ''
    fallbackEmail = activeUser.email || ''
    tokenRole = String(activeUser.role || '').toLowerCase()
  } else {
    // Soporte 24/7 para tabletas de piso: si el JWT expiró dentro de la ventana acotada MAX_EXPIRED_GRACE_MS (14 días),
    // validar firma HMAC-SHA256 y verificar vigencia real del usuario en public.users.
    let token: string | undefined
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const bearer = authHeader.substring(7).trim()
      if (bearer && bearer !== 'null' && bearer !== 'undefined') token = bearer
    }
    if (!token) {
      try {
        const cookieStore = await cookies()
        token = cookieStore.get('teg_token')?.value
      } catch {
        // ignore
      }
    }
    if (token) {
      const secret = getJwtSecret()
      if (secret) {
        try {
          const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
            ignoreExpiration: true
          }) as Record<string, any>
          const expSec = Number(decoded?.exp)
          const withinGrace =
            !Number.isFinite(expSec) ||
            expSec <= 0 ||
            Date.now() - expSec * 1000 <= MAX_EXPIRED_GRACE_MS
          if (decoded?.sub && withinGrace) {
            userId = decoded.sub
            fallbackEmail = String(decoded.email || '').trim()
            tokenRole = String(decoded.user_role || decoded.user_metadata?.role || '').toLowerCase()
          }
        } catch {
          // Firma inválida -> no autenticado
        }
      }
    }
  }

  if (!userId) {
    return {
      ok: false,
      status: 401,
      error: 'No autenticado: se requiere sesión válida de Tacos Gavilan o PIN de 4 dígitos.'
    }
  }

  const numericUserId = Number(userId)
  const { data: dbUser } = Number.isFinite(numericUserId) && numericUserId > 0
    ? await supabaseAdmin
        .from('users')
        .select('id, email, full_name, role, is_active')
        .eq('id', numericUserId)
        .maybeSingle()
    : { data: null as any }

  if (!dbUser || dbUser.is_active === false) {
    return {
      ok: false,
      status: 401,
      error: 'Sesión no válida o usuario inactivo.'
    }
  }

  const authoritativeRole = String(dbUser.role || tokenRole || '').trim().toLowerCase()
  if (authoritativeRole === 'basecamp') {
    return {
      ok: false,
      status: 403,
      error: 'Acceso restringido para el rol basecamp.'
    }
  }

  const storeCode = await resolveStoreCodeById(storeId)
  if (!storeCode) {
    return {
      ok: false,
      status: 404,
      error: 'Sucursal no encontrada o inactiva.'
    }
  }

  const access = await resolveOrderReadyAccess(dbUser.id, authoritativeRole)
  if (!canAccessStore(access, storeCode)) {
    return {
      ok: false,
      status: 403,
      error: 'No tienes permiso para acceder a las alertas de esta sucursal.'
    }
  }

  const actorName =
    String(dbUser.full_name || '').trim() ||
    fallbackName.trim() ||
    String(dbUser.email || '').trim() ||
    fallbackEmail.trim() ||
    'Tableta de Llamado'

  return {
    ok: true,
    userId: dbUser.id,
    actorName,
    role: authoritativeRole,
    access
  }
}

function getBridgeSigningSecret(): string {
  return process.env.PHONE_TTS_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

function verifyBridgeSignature(
  storeId: number,
  callSid: string,
  customerName: string,
  ts: string,
  providedSig: string
): { valid: boolean; reason?: string } {
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: 'expired_or_invalid_timestamp' }
  }
  const secret = getBridgeSigningSecret()
  if (!secret) return { valid: false, reason: 'missing_signing_secret' }

  const canonical = `${storeId}|${callSid}|${customerName}|${ts}`
  const expected = createHmac('sha256', secret).update(canonical).digest('hex')
  const cleanSig = String(providedSig || '').trim().toLowerCase()
  if (!cleanSig || (cleanSig.length !== expected.length && cleanSig.length !== 32)) {
    return { valid: false, reason: 'invalid_signature_length' }
  }
  const expectedSlice = cleanSig.length === 32 ? expected.slice(0, 32) : expected
  try {
    const ok = timingSafeEqual(Buffer.from(expectedSlice, 'utf8'), Buffer.from(cleanSig, 'utf8'))
    return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' }
  } catch {
    return { valid: false, reason: 'signature_compare_error' }
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeId = parseInt(searchParams.get('storeId') || '0', 10)
    const businessDate = searchParams.get('businessDate') || undefined
    const requestedSimulator = searchParams.get('includeSimulator') === '1' || searchParams.get('includeSimulator') === 'true'
    const pinParam = String(req.headers.get('x-ronos-pin') || searchParams.get('pin') || '').trim()

    if (isNaN(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'Parámetro storeId inválido.' }, { status: 400 })
    }

    let allowSimulator = false
    if (pinParam) {
      if (!/^\d{4}$/.test(pinParam)) {
        return NextResponse.json({ ok: false, error: 'PIN de RONOS inválido.' }, { status: 401 })
      }
      const pinCheck = await verifyRonosPin(storeId, pinParam)
      if (!pinCheck.valid) {
        return NextResponse.json({ ok: false, error: pinCheck.error || 'PIN de RONOS no autorizado.' }, { status: 403 })
      }
    } else {
      const sessionAuth = await resolveAuthenticatedTabletSession(req, storeId)
      if (!sessionAuth.ok) {
        return NextResponse.json({ ok: false, error: sessionAuth.error }, { status: sessionAuth.status })
      }
      allowSimulator = requestedSimulator && sessionAuth.access.all === true
    }

    const notes = await listDeliveryArmorPhoneNotes(storeId, {
      businessDate,
      includeSimulator: allowSimulator
    })
    return NextResponse.json({
      ok: true,
      storeId,
      notes,
      pendingCount: notes.filter((n) => n.status === 'pending' || n.status === 'acknowledged').length
    })
  } catch (err: any) {
    console.error('[api/delivery-armor/phone-notes] GET error:', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error consultando notas telefónicas de Delivery Armor.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'invalid_json_body' }, { status: 400 })
    }

    const storeId = Number(body.storeId)
    const callSid = String(body.callSid ?? '').trim()
    const customerName = String(body.customerName ?? '').trim()
    const ts = String(body.ts ?? '').trim()
    const sig = String(body.sig ?? '').trim()

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid_store_id' }, { status: 400 })
    }

    const sigCheck = verifyBridgeSignature(storeId, callSid, customerName, ts, sig)
    if (!sigCheck.valid) {
      return NextResponse.json({ ok: false, error: sigCheck.reason || 'unauthorized' }, { status: 401 })
    }

    const result = await createOrUpdateDeliveryArmorPhoneNote({
      storeId,
      source: body.source === 'simulator' ? 'simulator' : body.source === 'manual' ? 'manual' : 'twilio',
      callSid: callSid || null,
      callId: body.callId ? String(body.callId) : null,
      callbackId: body.callbackId ? String(body.callbackId) : null,
      platform: body.platform ? String(body.platform) : null,
      customerName,
      orderCode: body.orderCode ? String(body.orderCode) : null,
      orderedItemsHint: body.orderedItemsHint ? String(body.orderedItemsHint) : null,
      callerName: body.callerName ? String(body.callerName) : customerName,
      callerPhone: body.callerPhone ? String(body.callerPhone) : null,
      requestType: body.requestType ? String(body.requestType) : null,
      noteSummaryEs: String(body.noteSummaryEs ?? ''),
      noteSummaryEn: body.noteSummaryEn ? String(body.noteSummaryEn) : null,
      requestedCondiments: Array.isArray(body.requestedCondiments)
        ? body.requestedCondiments.map(String)
        : [],
      itemModifications: Array.isArray(body.itemModifications)
        ? body.itemModifications.map(String)
        : [],
      confirmSaveUnmatched: Boolean(body.confirmSaveUnmatched)
    })

    return NextResponse.json(result, { status: 200 })
  } catch (err: any) {
    console.error('[api/delivery-armor/phone-notes] POST error:', err)
    return NextResponse.json(
      { ok: false, outcome: 'MISSING_INFO', error: err?.message || 'internal_error' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Cuerpo JSON inválido.' }, { status: 400 })
    }

    const noteId = String(body.noteId || body.id || '').trim()
    const storeId = Number(body.storeId || body.store_id)
    const rawAction = String(body.action || 'apply').trim().toLowerCase()
    const action: 'acknowledge' | 'apply' | 'dismiss' =
      rawAction === 'acknowledge' ? 'acknowledge' : rawAction === 'dismiss' ? 'dismiss' : 'apply'
    const pin = String(body.pin || body.packerPin || '').trim()
    let actorName = String(body.actorName || body.packerName || '').trim()

    if (!noteId || !Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'Faltan noteId y storeId válidos.' }, { status: 400 })
    }

    let resolvedActorPin: string | null = null
    let resolvedActorSourceLabel = 'Delivery Armor'

    if (pin) {
      if (!/^\d{4}$/.test(pin)) {
        return NextResponse.json({ ok: false, error: 'Se requiere PIN válido de 4 dígitos de cajera/empacador.' }, { status: 401 })
      }
      const pinCheck = await verifyRonosPin(storeId, pin)
      if (!pinCheck.valid) {
        return NextResponse.json({ ok: false, error: pinCheck.error || 'PIN de RONOS no autorizado para esta sucursal.' }, { status: 403 })
      }
      if (pinCheck.fullName) {
        actorName = pinCheck.fullName
      }
      resolvedActorPin = pin
      resolvedActorSourceLabel = 'Delivery Armor'
    } else {
      const sessionAuth = await resolveAuthenticatedTabletSession(req, storeId)
      if (!sessionAuth.ok) {
        return NextResponse.json({ ok: false, error: sessionAuth.error }, { status: sessionAuth.status })
      }
      // Identidad 100% autoritativa del servidor (nunca confiar en body.actorName en modo sesión)
      actorName = sessionAuth.actorName
      resolvedActorPin = null
      const clientSource = String(body.clientSource || '').trim().toLowerCase()
      resolvedActorSourceLabel =
        clientSource === 'order_ready_board' ? 'Order Ready Board' : 'Tableta de Llamado'
    }

    const note = await updateDeliveryArmorPhoneNoteStatus({
      noteId,
      storeId,
      action,
      actorName: actorName || 'Cajera Delivery Armor',
      actorPin: resolvedActorPin,
      actorSourceLabel: resolvedActorSourceLabel,
      matchedOrderGuid: body.matchedOrderGuid ? String(body.matchedOrderGuid) : null,
      matchedDisplayNumber: body.matchedDisplayNumber ? String(body.matchedDisplayNumber) : null
    })

    return NextResponse.json({ ok: true, note })
  } catch (err: any) {
    console.error('[api/delivery-armor/phone-notes] PATCH error:', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error actualizando nota telefónica.' },
      { status: 500 }
    )
  }
}
