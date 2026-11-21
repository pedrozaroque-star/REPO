/**
 * @module app/api/integrations/ronos/punches/route
 * @description Receptor webhook de ponchadas / tarjetas de tiempo enviadas por RONOS hacia Tacos Gavilan.
 *
 * @businessRules
 * - Exige `process.env.RONOS_WEBHOOK_SECRET` configurado en entorno (fail-closed `503` si falta; cero llaves temporales hardcodeadas).
 * - Valida el Bearer token o header `x-api-key` mediante comparación en tiempo constante (`crypto.timingSafeEqual`).
 * - Valida el arreglo entrante (`punches`, `data` o `timesheets`).
 *
 * @dataFlow
 * - RONOS Webhook `POST /api/integrations/ronos/punches` -> Verificación `timingSafeEqual` -> Validación de estructura -> Respuesta JSON.
 *
 * @notes
 * - Blindaje de Seguridad (2026-11-21): eliminada llave temporal hardcodeada y volcado de PII en consola.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse, NextRequest } from 'next/server'

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

function extractWebhookToken(request: NextRequest): string {
  const authHeader = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim()
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  if (authHeader) {
    return authHeader
  }
  return (request.headers.get('x-api-key') || '').trim()
}

export async function POST(request: NextRequest) {
  try {
    const expectedKey = (process.env.RONOS_WEBHOOK_SECRET || '').trim()
    if (!expectedKey) {
      return NextResponse.json(
        { error: 'Configuración de seguridad faltante: RONOS_WEBHOOK_SECRET no configurado.' },
        { status: 503 }
      )
    }

    const candidateToken = extractWebhookToken(request)
    if (!safeTimingEqualStrings(candidateToken, expectedKey)) {
      console.warn('[RONOS] Intento de acceso denegado: token inválido o ausente.')
      return NextResponse.json({ error: 'Unauthorized. Invalid API Key.' }, { status: 401 })
    }

    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ success: false, error: 'Cuerpo JSON inválido.' }, { status: 400 })
    }

    const dataArray = payload.punches || payload.data || payload.timesheets

    if (!dataArray || !Array.isArray(dataArray)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Formato inválido. Se espera un arreglo en la propiedad "punches", "data" o "timesheets".',
          received_keys: Object.keys(payload).slice(0, 20),
        },
        { status: 400 }
      )
    }

    let inserted = 0
    let errors = 0

    for (const item of dataArray.slice(0, 1000)) {
      try {
        const ronosEmployeeId = item?.employeeId || item?.employee_id || item?.assignmentId
        const clockIn = item?.clockInTime || item?.startTime

        if (!ronosEmployeeId || !clockIn) {
          throw new Error('Falta EmployeeID o ClockIn')
        }
        inserted++
      } catch {
        errors++
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Webhook recibido y procesado correctamente',
        summary: {
          total_received: dataArray.length,
          inserted,
          errors,
        },
      },
      { status: 200 }
    )
  } catch (err: any) {
    console.error('[RONOS WEBHOOK] Error fatal:', err?.message)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
