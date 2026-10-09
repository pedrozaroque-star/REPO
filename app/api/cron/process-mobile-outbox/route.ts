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
 * 
 * @dataFlow
 * - Vercel Cron / Operador manual -> GET /api/cron/process-mobile-outbox -> processOutboxOrders() (lib/toast-orders.ts) ->
 *   Toast API (/orders/v2/orders) -> app_order_outbox + app_orders.
 * 
 * @notes
 * - Protegido mediante CRON_SECRET en el header de autorización o query string.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processOutboxOrders } from '@/lib/toast-orders'

export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    // Si no hay secret configurado, permitir en entornos de desarrollo local
    return process.env.NODE_ENV !== 'production'
  }

  if (authHeader === `Bearer ${cronSecret}`) {
    return true
  }

  const { searchParams } = new URL(request.url)
  return searchParams.get('key') === cronSecret
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
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
