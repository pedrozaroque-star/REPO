/**
 * @module api/mobile/order/payment-confirm
 * @description Ruta de confirmación de pago deshabilitada por seguridad arquitectónica.
 * 
 * @businessRules
 * - La captura de pago permanece deshabilitada hasta recibir el mecanismo autorizado por Toast y completar la evaluación de cumplimiento correspondiente.
 * - Prohibición absoluta de recolección, recepción o transporte de PAN/CVC en servidor propio.
 * 
 * @dataFlow
 * - Cualquier petición entrante recibe HTTP 503 Service Unavailable informando el estado de bloqueo externo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '../../_helpers'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return jsonError(
    'La captura de pago permanece deshabilitada hasta recibir el mecanismo autorizado por Toast y completar la evaluación de cumplimiento correspondiente.',
    503
  )
}
