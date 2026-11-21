/**
 * @module api/mobile/order/payment-confirm
 * @description Ruta de confirmación de pago autenticada y deshabilitada por seguridad arquitectónica.
 *
 * @businessRules
 * - Exige autenticación válida de comensal (`getAuthUser(request)`) + validación de titularidad de `orderId` en `public.app_orders` cuando se envía, más límite de tasa acotado por IP (`x-vercel-forwarded-for` / `x-real-ip`).
 * - La captura de pago permanece deshabilitada (`503 PAYMENT_PROVIDER_DISABLED`) hasta recibir el mecanismo autorizado por Toast y completar la evaluación de cumplimiento correspondiente.
 * - Prohibición absoluta de recolección, recepción o transporte de PAN/CVC en servidor propio.
 *
 * @dataFlow
 * - `POST /api/mobile/order/payment-confirm` -> Rate Limit IP -> `getAuthUser` + titularidad `orderId` -> `503 PAYMENT_PROVIDER_DISABLED`.
 *
 * @notes
 * - Mantiene el código `PAYMENT_PROVIDER_DISABLED` alineado con `lib/mobile/payment-provider.ts`.
 * - Blindaje de Seguridad (2026-11-21): agregado `getAuthUser(request)`, verificación de titularidad de `orderId` y rate limit acotado por IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsHeaders, corsResponse, getAuthUser, isAuthSuccess, jsonError } from '../../_helpers'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IP_BUCKETS = 2000
const RATE_LIMIT_PER_MINUTE = 15
const RATE_WINDOW_MS = 60_000
const paymentIpBuckets = new Map<string, number[]>()

function extractTrustedClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function checkPaymentConfirmRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (paymentIpBuckets.size >= MAX_IP_BUCKETS && !paymentIpBuckets.has(ip)) {
    for (const [k, arr] of paymentIpBuckets) {
      const valid = arr.filter((t) => now - t < RATE_WINDOW_MS)
      if (valid.length === 0) paymentIpBuckets.delete(k)
      else paymentIpBuckets.set(k, valid)
    }
    if (paymentIpBuckets.size >= MAX_IP_BUCKETS) {
      const oldest = paymentIpBuckets.keys().next().value
      if (oldest) paymentIpBuckets.delete(oldest)
    }
  }
  const hits = (paymentIpBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_PER_MINUTE) {
    paymentIpBuckets.set(ip, hits)
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000)),
    }
  }
  hits.push(now)
  paymentIpBuckets.set(ip, hits)
  return { allowed: true, retryAfterSec: 0 }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = extractTrustedClientIp(request.headers)
  const rl = checkPaymentConfirmRateLimit(ip)
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: 'RATE_LIMITED',
        error: `Demasiadas solicitudes. Espera ${rl.retryAfterSec}s antes de intentar nuevamente.`,
      },
      {
        status: 429,
        headers: {
          ...corsHeaders(),
          'Retry-After': String(rl.retryAfterSec),
        },
      }
    )
  }

  const auth = await getAuthUser(request)
  if (!isAuthSuccess(auth)) {
    return jsonError(auth.error, 401, 'UNAUTHORIZED')
  }

  const body = await request.json().catch(() => null)
  const orderId = body && typeof body === 'object' ? String((body as any).orderId || (body as any).order_id || '').trim() : ''

  if (orderId) {
    if (!UUID_RE.test(orderId)) {
      return jsonError('Identificador de orden inválido.', 400, 'VALIDATION_ERROR')
    }
    const { data: orderRow, error: orderErr } = await supabaseAdmin
      .from('app_orders')
      .select('id, user_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderErr) {
      return jsonError('Error verificando la titularidad de la orden.', 500, 'INTERNAL_ERROR')
    }
    if (!orderRow) {
      return jsonError('Orden no encontrada.', 404, 'ORDER_NOT_FOUND')
    }
    if (orderRow.user_id !== auth.userId) {
      return jsonError('No tienes autorización para confirmar el pago de esta orden.', 403, 'FORBIDDEN')
    }
  }

  return jsonError(
    'La captura de pago permanece deshabilitada hasta recibir el mecanismo autorizado por Toast y completar la evaluación de cumplimiento correspondiente.',
    503,
    'PAYMENT_PROVIDER_DISABLED'
  )
}
