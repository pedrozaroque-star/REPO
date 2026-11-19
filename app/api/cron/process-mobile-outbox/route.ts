/**
 * @module app/api/cron/process-mobile-outbox/route
 * @description Cron worker endpoint para procesar y reintentar de forma idempotente las órdenes móviles pendientes en app_order_outbox.
 * Despacha comandas hacia Toast KDS e integra reintentos automáticos con backoff exponencial.
 * 
 * @businessRules
 * - Procesa transaccionalmente registros en estado 'PENDING' o 'FAILED' que hayan cumplido su tiempo de espera (next_attempt_at <= NOW()).
 * - Cero éxito ficticio: Las órdenes solo se marcan como 'SUCCEEDED' si Toast POS responde con un identificador de orden real (GUID).
 * - Dead Letter Queue: Si una comanda supera el número máximo de reintentos (max_attempts = 3), se transiciona a 'DEAD_LETTER'
 *   para revisión manual por gerencia de sucursal, sin bloquear la cola general.
 * - Ventana sin ventas (Dead Hours): Se omite automáticamente entre 4:15 AM y 6:59 AM (`America/Los_Angeles`), salvo override manual `?force=1`.
 * 
 * @dataFlow
 * - Vercel Cron / Operador manual -> GET /api/cron/process-mobile-outbox -> processOutboxOrders() (lib/toast-orders.ts) ->
 *   Toast API (/orders/v2/orders) -> app_order_outbox + app_orders.
 * 
 * @notes
 * - Protegido mediante CRON_SECRET en el header de autorización o query string.
 * - 2026-11-19 (Paquete 2A): Frecuencia ajustada a cada 15 min en `vercel.json` y salto automático en ventana muerta `4:15–6:59 AM LA` con soporte `?force=1`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processOutboxOrders } from '@/lib/toast-orders'

export const dynamic = 'force-dynamic'

function getLATimeParts(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const rawHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const hour = rawHour === 24 ? 0 : rawHour
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  return { hour, minute }
}

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    // Si no hay secret configurado, permitir únicamente en entornos de desarrollo local
    return process.env.NODE_ENV !== 'production'
  }

  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const forceRun = searchParams.get('force') === '1' || searchParams.get('force') === 'true'

    if (!forceRun) {
      const { hour, minute } = getLATimeParts()
      if ((hour === 4 && minute >= 15) || hour === 5 || hour === 6) {
        console.log(
          `⏳ [CRON PROCESS OUTBOX] Omitido en ventana sin ventas (4:15 AM - 6:59 AM LA). Hora LA: ${hour}:${String(minute).padStart(2, '0')}`
        )
        return NextResponse.json({
          ok: true,
          skipped: true,
          message: 'Skipped: Dead hours (4:15 AM - 6:59 AM LA)',
          timestamp: new Date().toISOString(),
        })
      }
    }

    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 10), 1), 50)

    const summary = await processOutboxOrders(limit)
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...summary,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno al procesar outbox'
    console.error('[CRON PROCESS OUTBOX] Error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request)
}
