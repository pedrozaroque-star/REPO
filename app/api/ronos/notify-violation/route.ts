/**
 * @module app/api/ronos/notify-violation/route
 * @description API endpoint para despachar avisos formales de incumplimiento laboral por correo a empleados de RONOS.
 *
 * @businessRules
 *   - Seguridad estricta: El cliente únicamente envía identificadores (companyId, employeeUserId, violationDate).
 *   - Toda la evidencia de ponchadas, horas, cálculo de penalización, identidad y destinatarios es resuelta
 *     y validada exclusivamente en el servidor desde la auditoría oficial de RONOS y Supabase.
 *   - El endpoint rechaza cualquier petición sin violación laboral comprobada en el sistema.
 *   - Requiere rol 'admin' obligatorio y bloquea cualquier intento de format=csv.
 *   - Envía copia a la escalera de mando: Gerente de sucursal, Supervisor de zona y Directiva de Tacos Gavilan.
 *
 * @dataFlow
 *   POST /api/ronos/notify-violation { companyId, employeeUserId, violationDate }
 *     -> Validación en Servidor (getRonosStoreAudit)
 *     -> Extracción oficial de ponchadas
 *     -> sendRonosViolationWarningEmail() -> Nodemailer -> JSON.
 *   GET /api/ronos/notify-violation?companyId=34 -> Historial de avisos enviados.
 *
 * @notes
 *   - Prohíbe terminantemente la exportación CSV (format=csv) y asegura que cada aviso guarde registro en ronos_violation_notifications.
 */

import { NextResponse } from 'next/server'
import { sendRonosViolationWarningEmail, getEscaleraDeMando } from '@/lib/ronos-email'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyAdminAuth } from '@/lib/auth-server'
import { getDynamicRonosStores, RONOS_STORES_MAP, getRonosWeeks, getRonosStoreAudit } from '@/lib/ronos-api'

export async function POST(req: Request) {
  try {
    // 1. Control de acceso estricto: Requiere rol 'admin'
    const auth = verifyAdminAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get('format')?.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))

    if (body.format && String(body.format).toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    // 2. Validación estricta de parámetros de entrada con regex
    const rawCompanyId = body.ronosCompanyId ?? body.companyId
    if (rawCompanyId === undefined || rawCompanyId === null || !/^\d+$/.test(String(rawCompanyId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId / ronosCompanyId inválido: debe ser numérico' },
        { status: 400 }
      )
    }
    const targetCompanyId = parseInt(String(rawCompanyId), 10)
    if (targetCompanyId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId debe ser mayor a 0' },
        { status: 400 }
      )
    }

    const rawUserId = body.employeeUserId ?? body.userId
    if (rawUserId === undefined || rawUserId === null || !/^\d+$/.test(String(rawUserId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro employeeUserId inválido: debe ser numérico' },
        { status: 400 }
      )
    }
    const targetUserId = parseInt(String(rawUserId), 10)

    const rawDate = body.violationDate ?? body.date
    if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(rawDate))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro violationDate inválido: debe tener formato YYYY-MM-DD' },
        { status: 400 }
      )
    }
    const targetDate = String(rawDate)

    const rawWarningStage = body.warningStage || 'first'
    if (!['first', 'second', 'suspension'].includes(rawWarningStage)) {
      return NextResponse.json(
        { success: false, error: "warningStage inválido: debe ser 'first', 'second' o 'suspension'" },
        { status: 400 }
      )
    }
    const validWarningStage = rawWarningStage as 'first' | 'second' | 'suspension'

    // 3. Resolución segura del período semanal en el servidor
    let targetWeekId: number | null = null
    const { data: weekRow } = await supabaseAdmin
      .from('ronos_work_weeks')
      .select('week_id, start_date, end_date')
      .eq('company_id', targetCompanyId)
      .lte('start_date', targetDate)
      .gte('end_date', targetDate)
      .maybeSingle()

    if (weekRow?.week_id) {
      targetWeekId = weekRow.week_id
    } else {
      const weeks = await getRonosWeeks(targetCompanyId)
      const foundWeek = weeks.find(w => {
        const start = w.startDate?.substring(0, 10) || ''
        const end = w.endDate?.substring(0, 10) || ''
        return start && end && targetDate >= start && targetDate <= end
      })
      if (foundWeek) {
        targetWeekId = foundWeek.weekId
      }
    }

    if (!targetWeekId) {
      return NextResponse.json(
        { success: false, error: `No se localizó un período semanal registrado para la sucursal ${targetCompanyId} en la fecha ${targetDate}.` },
        { status: 404 }
      )
    }

    // 4. Verificación de la violación real en la auditoría oficial del servidor
    const storeAudit = await getRonosStoreAudit(targetCompanyId, targetWeekId, false)
    if (!storeAudit || !storeAudit.employees) {
      return NextResponse.json(
        { success: false, error: 'No fue posible consultar la auditoría laboral del servidor para la semana indicada.' },
        { status: 500 }
      )
    }

    const auditEmp = storeAudit.employees.find((e: any) => e.employeeUserId === targetUserId)
    if (!auditEmp) {
      return NextResponse.json(
        { success: false, error: `El colaborador con ID ${targetUserId} no cuenta con registros en la auditoría laboral de esta sucursal.` },
        { status: 404 }
      )
    }

    const auditDay = auditEmp.days?.find((d: any) => d.date === targetDate || d.date?.startsWith(targetDate))
    if (!auditDay) {
      return NextResponse.json(
        { success: false, error: `No existen ponchadas registradas para el colaborador en la fecha ${targetDate}.` },
        { status: 404 }
      )
    }

    const violations = auditDay.violations || []
    if (violations.length === 0) {
      return NextResponse.json(
        { success: false, error: `Auditoría verificada: No existe ninguna infracción laboral comprobada en el sistema para la fecha ${targetDate}.` },
        { status: 400 }
      )
    }

    // 5. Extracción de evidencia y ponchadas validadas del servidor (NO del cliente)
    const primaryViolation = violations[0]
    const violationType = primaryViolation.type || 'MEAL_PENALTY'
    const violationTitle = primaryViolation.title || 'Incumplimiento de Descanso de Comida'
    const violationDescription = primaryViolation.description || 'Registro de ponchadas incumple la normativa laboral de California.'

    const clockInTime = auditDay.clockInTime
    const lunchStartTime = auditDay.lunchStartTime
    const lunchEndTime = auditDay.lunchEndTime
    const clockOutTime = auditDay.clockOutTime
    const totalHoursWorked = auditDay.totalHours

    // 6. Resolución de identidad y correo verificado desde la base de datos (NO del cliente)
    let verifiedFullName = auditEmp.fullName || `${auditEmp.firstName || ''} ${auditEmp.lastName || ''}`.trim()
    let verifiedPin = auditEmp.pin || ''
    let verifiedJobTitle = auditEmp.jobTitle || 'Colaborador'
    let verifiedEmail: string | null = null

    const { data: mappingData } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .select('toast_email, toast_full_name, ronos_full_name, ronos_pin, ronos_job_title, toast_employee_id')
      .eq('ronos_employee_user_id', targetUserId)
      .eq('ronos_company_id', targetCompanyId)
      .maybeSingle()

    if (mappingData) {
      verifiedFullName = mappingData.toast_full_name || mappingData.ronos_full_name || verifiedFullName
      verifiedPin = mappingData.ronos_pin || verifiedPin
      verifiedJobTitle = mappingData.ronos_job_title || verifiedJobTitle

      if (mappingData.toast_email && mappingData.toast_email.includes('@')) {
        verifiedEmail = mappingData.toast_email.trim().toLowerCase()
      } else if (mappingData.toast_employee_id) {
        const { data: toastEmp } = await supabaseAdmin
          .from('toast_employees')
          .select('email, full_name')
          .eq('id', mappingData.toast_employee_id)
          .maybeSingle()
        if (toastEmp?.email && toastEmp.email.includes('@')) {
          verifiedEmail = toastEmp.email.trim().toLowerCase()
        }
      }
    }

    if (!verifiedEmail && verifiedPin) {
      const { data: toastByPin } = await supabaseAdmin
        .from('toast_employees')
        .select('email, full_name')
        .eq('passcode', verifiedPin)
        .maybeSingle()
      if (toastByPin?.email && toastByPin.email.includes('@')) {
        verifiedEmail = toastByPin.email.trim().toLowerCase()
      }
    }

    if (!verifiedEmail || !verifiedEmail.includes('@')) {
      return NextResponse.json(
        { success: false, error: `El empleado "${verifiedFullName}" (ID: ${targetUserId}) no cuenta con un correo electrónico verificado en la base de datos oficial.` },
        { status: 400 }
      )
    }

    // 7. Resolver tienda oficial en el servidor
    const dynamicStores = await getDynamicRonosStores()
    const storeFound = dynamicStores.find(s => s.ronosCompanyId === targetCompanyId) || RONOS_STORES_MAP.find(s => s.ronosCompanyId === targetCompanyId)
    const storeName = storeFound?.tegName ? `Tacos Gavilan - ${storeFound.tegName}` : 'Tacos Gavilan'

    const senderEmail = auth.user?.email || 'notificaciones@tacosgavilan.com'

    // 8. Generación segura del correo y despacho con datos exclusivos del servidor
    const result = await sendRonosViolationWarningEmail({
      ronosCompanyId: targetCompanyId,
      storeName,
      employeeUserId: targetUserId,
      employeeName: verifiedFullName,
      employeeEmail: verifiedEmail,
      employeePin: verifiedPin,
      employeeJobTitle: verifiedJobTitle,
      violationDate: targetDate,
      violationType,
      violationTitle,
      violationDescription,
      clockInTime,
      lunchStartTime,
      lunchEndTime,
      clockOutTime,
      totalHoursWorked: totalHoursWorked ? Number(totalHoursWorked) : undefined,
      warningStage: validWarningStage,
      additionalNotes: typeof body.additionalNotes === 'string' ? body.additionalNotes.substring(0, 500) : undefined,
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
    const auth = verifyAdminAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    if (searchParams.get('format')?.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const companyIdParam = searchParams.get('companyId')
    if (companyIdParam !== null && !/^\d+$/.test(companyIdParam)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId inválido: debe ser numérico' },
        { status: 400 }
      )
    }

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
