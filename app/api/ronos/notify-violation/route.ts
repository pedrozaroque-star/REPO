/**
 * @module app/api/ronos/notify-violation/route
 * @description API endpoint para despachar avisos formales de incumplimiento laboral por correo a empleados de RONOS.
 *
 * @businessRules
 *   - Utiliza el correo verificado del colaborador en Toast/Planificador.
 *   - Envía copia a la escalera de mando: Gerente de sucursal, Supervisor de zona y Directiva de Tacos Gavilan.
 *   - Enfatiza el monitoreo automatizado y continuo de ponchadas en el reloj checador.
 *
 * @dataFlow
 *   POST /api/ronos/notify-violation -> sendRonosViolationWarningEmail() -> Nodemailer -> JSON.
 *   GET /api/ronos/notify-violation?companyId=34 -> Historial de avisos enviados.
 */

import { NextResponse } from 'next/server'
import { sendRonosViolationWarningEmail, getEscaleraDeMando } from '@/lib/ronos-email'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      ronosCompanyId,
      storeName,
      employeeUserId,
      employeeName,
      employeeEmail,
      employeePin,
      employeeJobTitle,
      violationDate,
      violationType,
      violationTitle,
      violationDescription,
      clockInTime,
      lunchStartTime,
      lunchEndTime,
      clockOutTime,
      totalHoursWorked,
      additionalNotes,
      senderEmail
    } = body

    if (!employeeEmail || !employeeEmail.includes('@')) {
      return NextResponse.json(
        { success: false, error: `El empleado "${employeeName}" no tiene un correo electrónico válido registrado en Toast.` },
        { status: 400 }
      )
    }

    if (!violationTitle || !violationDate) {
      return NextResponse.json(
        { success: false, error: 'Faltan datos de la infracción (violationTitle, violationDate).' },
        { status: 400 }
      )
    }

    const result = await sendRonosViolationWarningEmail({
      ronosCompanyId: Number(ronosCompanyId),
      storeName: storeName || 'Tacos Gavilan',
      employeeUserId: Number(employeeUserId),
      employeeName,
      employeeEmail,
      employeePin,
      employeeJobTitle,
      violationDate,
      violationType: violationType || 'MEAL_PENALTY',
      violationTitle,
      violationDescription: violationDescription || '',
      clockInTime,
      lunchStartTime,
      lunchEndTime,
      clockOutTime,
      totalHoursWorked: totalHoursWorked ? Number(totalHoursWorked) : undefined,
      additionalNotes,
      senderEmail
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Error al despachar el correo' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      recipientsTo: result.recipientsTo,
      recipientsCc: result.recipientsCc
    })
  } catch (error: any) {
    console.error('Error in POST /api/ronos/notify-violation:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno al enviar aviso laboral' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const companyIdParam = searchParams.get('companyId')
    const companyId = companyIdParam ? parseInt(companyIdParam, 10) : null

    let query = supabaseAdmin
      .from('ronos_violation_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (companyId) {
      query = query.eq('ronos_company_id', companyId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Obtener también información de la escalera de mando si se solicitó companyId
    let escalera = null
    if (companyId) {
      escalera = await getEscaleraDeMando(companyId)
    }

    return NextResponse.json({
      success: true,
      data,
      escalera
    })
  } catch (error: any) {
    console.error('Error in GET /api/ronos/notify-violation:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error al obtener historial de notificaciones' },
      { status: 500 }
    )
  }
}
