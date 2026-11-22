/**
 * @module app/api/phone/verify-order
 * @description Endpoint interno firmado por HMAC-SHA256 para que la Edge Function `phone-live-bridge`
 * (cuando no cuenta con credenciales Toast locales) valide tickets y estatus de órdenes en tiempo real contra
 * Supabase y la API en vivo de Toast POS (`validateStoreOrderTicket`).
 *
 * @businessRules
 * - **Seguridad Fail-Closed**: Toda petición debe incluir `ts` (vigencia máxima ±5 minutos) y firma `sig`
 *   HMAC-SHA256 válida sobre `${storeId}|${ticketOrOrderNumber}|${purchaseDateText}|${customerName}|${ts}`
 *   generada con `PHONE_TTS_SIGNING_SECRET || SUPABASE_SERVICE_ROLE_KEY` (la misma llave distribuida en
 *   `ttsSigningSecret` dentro de `twilio-bridge-config.json`).
 * - **Sin Pérdida de Disponibilidad**: Nunca propaga excepciones no manejadas; retorna JSON estructurado con
 *   `storeId`, `found`, `observedRange` y mensajes listos para voz ES/EN.
 *
 * @dataFlow
 * - Supabase Edge Function (`phone-live-bridge`) -> POST `/api/phone/verify-order` ->
 *   `validateStoreOrderTicket()` -> Supabase + Toast `/orders/v2/ordersBulk` (secuencial sin 429).
 *
 * @notes
 * - Creado 2026-11-21 tras la auditoría de llamadas reales de Carlos (`+14243195019`, ticket `#1600`)
 *   y entregas Uber Eats (`delivery_packing_audits`), donde la Edge Function no tenía `toastClientId` en su JSON.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { validateStoreOrderTicket } from '@/lib/toast-ticket-validator'

export const runtime = 'nodejs'
export const maxDuration = 15

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

function getVerifySigningSecret(): string {
  return process.env.PHONE_TTS_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

function signVerifyPayload(
  storeId: number,
  ticketOrOrderNumber: string,
  purchaseDateText: string,
  customerName: string,
  ts: string
): string {
  const secret = getVerifySigningSecret()
  if (!secret) return ''
  const canonical = `${storeId}|${ticketOrOrderNumber}|${purchaseDateText}|${customerName}|${ts}`
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function verifyRequestSignature(
  storeId: number,
  ticketOrOrderNumber: string,
  purchaseDateText: string,
  customerName: string,
  ts: string,
  providedSig: string
): { valid: boolean; reason?: string } {
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: 'expired_or_invalid_timestamp' }
  }
  const expected = signVerifyPayload(storeId, ticketOrOrderNumber, purchaseDateText, customerName, ts)
  const cleanSig = String(providedSig || '').trim().toLowerCase()
  if (!expected || !cleanSig || (cleanSig.length !== expected.length && cleanSig.length !== 32)) {
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'invalid_json_body' }, { status: 400 })
    }

    const storeId = Number(body.storeId)
    const ticketOrOrderNumber = String(body.ticketOrOrderNumber ?? '').trim()
    const purchaseDateText = String(body.purchaseDateText ?? '').trim()
    const customerName = String(body.customerName ?? '').trim()
    const ts = String(body.ts ?? '').trim()
    const sig = String(body.sig ?? '').trim()

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid_store_id' }, { status: 400 })
    }

    const sigCheck = verifyRequestSignature(storeId, ticketOrOrderNumber, purchaseDateText, customerName, ts, sig)
    if (!sigCheck.valid) {
      return NextResponse.json({ ok: false, error: sigCheck.reason || 'unauthorized' }, { status: 401 })
    }

    const result = await validateStoreOrderTicket({
      storeId,
      ticketOrOrderNumber,
      purchaseDateText: purchaseDateText || null,
      customerName: customerName || null
    })

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    console.error('[api/phone/verify-order] unexpected error:', err)
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 }
    )
  }
}
