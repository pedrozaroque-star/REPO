/**
 * @module app/api/evaluacion/notify/route
 * @description Endpoint para notificar de inmediato a la Dirección General de Tacos Gavilan
 * (Raquel, Roberto, Gonzalo y Carlos) tras el registro de cada nueva evaluación de personal (STAFF y Corporativo).
 * @businessRules
 * - Destinatarios automáticos: raquel@tacosgavilan.com, roberto@tacosgavilan.com, gonzalo@tacosgavilan.com y carlos@tacosgavilan.com.
 * - Recibe el payload completo de la evaluación recién registrada en Supabase.
 * - Devuelve confirmación de entrega y Message ID de Nodemailer.
 * - Diseñado para ser invocado de forma asíncrona no bloqueante desde el cliente web o tabletas de tienda.
 * @dataFlow
 * - components/StaffEvaluationForm -> POST /api/evaluacion/notify -> lib/staff-evaluation-email -> Gmail SMTP -> Directores.
 * @notes
 * - Protegido contra caídas de red; si el correo falla, no cancela el registro en base de datos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendStaffEvaluationEmail, STAFF_EVALUATION_DIRECTORS, StaffEvaluationEmailPayload } from '@/lib/staff-evaluation-email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body || !body.evaluated_name || !body.evaluated_role) {
      return NextResponse.json({
        success: false,
        error: 'Datos incompletos: se requiere evaluated_name y evaluated_role.'
      }, { status: 400 })
    }

    const payload: StaffEvaluationEmailPayload = {
      id: body.id,
      store_id: body.store_id,
      location_name: body.location_name,
      evaluation_date: body.evaluation_date || new Date().toISOString(),
      evaluator_name: body.evaluator_name,
      evaluated_name: body.evaluated_name,
      evaluated_role: body.evaluated_role,
      q1_1: body.q1_1, q1_2: body.q1_2, q1_3: body.q1_3, q1_4: body.q1_4, q1_5: body.q1_5,
      q2_1: body.q2_1, q2_2: body.q2_2, q2_3: body.q2_3, q2_4: body.q2_4, q2_5: body.q2_5,
      q3_1: body.q3_1, q3_2: body.q3_2, q3_3: body.q3_3, q3_4: body.q3_4, q3_5: body.q3_5,
      q4_1: body.q4_1, q4_2: body.q4_2, q4_3: body.q4_3, q4_4: body.q4_4, q4_5: body.q4_5,
      q5_1: body.q5_1, q5_2: body.q5_2, q5_3: body.q5_3, q5_4: body.q5_4, q5_5: body.q5_5,
      fortalezas: body.fortalezas,
      areas_mejora: body.areas_mejora,
      recomendaria: body.recomendaria,
      desempeno_general: body.desempeno_general,
      comentarios: body.comentarios,
      language: body.language,
      answers: body.answers
    }

    const customRecipients = Array.isArray(body.recipients) && body.recipients.length > 0
      ? body.recipients
      : STAFF_EVALUATION_DIRECTORS

    const result = await sendStaffEvaluationEmail(payload, customRecipients)

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Error al despachar el correo a Dirección General.'
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      recipients: result.recipients,
      notifiedAt: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('[API /api/evaluacion/notify] Error procesando notificación:', error)
    return NextResponse.json({
      success: false,
      error: error?.message || 'Error interno del servidor al procesar notificación.'
    }, { status: 500 })
  }
}
