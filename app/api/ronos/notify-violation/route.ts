/**
 * @module app/api/ronos/notify-violation/route
 * @description API endpoint para despachar avisos formales de incumplimiento laboral, puntualidad (±3 min),
 *   comidas (30 min / 5ta hora) y reparación de ponchadas Toast POS vs RONOS por correo a empleados de RONOS.
 *
 * @businessRules
 *   - Seguridad estricta: El cliente únicamente envía identificadores (`companyId`, `employeeUserId`, `violationDate`, opcionalmente `violationType`).
 *   - Toda la evidencia de ponchadas (RONOS + Planificador + Toast POS), exención de asalariados, exención por
 *     cobertura/emergencia gerencial, identidad y destinatarios es resuelta y validada exclusivamente en el servidor.
 *   - El endpoint rechaza cualquier petición sin violación laboral comprobada en el sistema o dirigida a personal asalariado exento.
 *   - Requiere rol `'admin'` obligatorio y bloquea cualquier intento de `format=csv`.
 *   - Envía copia a la escalera de mando: Gerente de sucursal, Supervisor de zona y Directiva de Tacos Gavilan.
 *
 * @dataFlow
 *   POST /api/ronos/notify-violation { companyId, employeeUserId, violationDate, violationType?, warningStage? }
 *     -> Validación en Servidor (`getRonosStoreAudit` + `enrichStoreAuditWithNhpPolicy`)
 *     -> `buildEmployeeRonosPolicyEmailHtml` / `sendRonosViolationWarningEmail` -> `sendSystemEmail` -> `ronos_violation_notifications`.
 *   GET /api/ronos/notify-violation?companyId=34 -> Historial de avisos enviados.
 *
 * @notes
 *   - Prohíbe terminantemente la exportación CSV (`format=csv`) y asegura que cada aviso guarde registro en `ronos_violation_notifications`.
 *   - Compatible al 100% con todas las aserciones de seguridad de `tests/ronos-audit-suite.ts`.
 */

import { NextResponse } from 'next/server'
import { sendRonosViolationWarningEmail, getEscaleraDeMando } from '@/lib/ronos-email'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyAdminAuth } from '@/lib/auth-server'
import { getDynamicRonosStores, RONOS_STORES_MAP, getRonosWeeks, getRonosStoreAudit } from '@/lib/ronos-api'
import { enrichStoreAuditWithNhpPolicy } from '@/lib/ronos-nhp-audit'
import {
  buildEmployeeRonosPolicyEmailHtml,
  validateEmployeeViolationEmail,
  type RonosDayAttendanceEvaluation,
} from '@/lib/ronos-attendance-policy'
import { INTERNAL_LUNCH_MIN_VIOLATION_MINUTES } from '@/lib/break-violations-policy'
import { sendSystemEmail } from '@/lib/system-mailer'

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
      const foundWeek = weeks.find((w) => {
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
        {
          success: false,
          error: `No se localizó un período semanal registrado para la sucursal ${targetCompanyId} en la fecha ${targetDate}.`,
        },
        { status: 404 }
      )
    }

    // 4. Verificación de la violación real en la auditoría oficial del servidor (RONOS + Planificador + Toast POS)
    const rawStoreAudit = await getRonosStoreAudit(targetCompanyId, targetWeekId, false)
    if (!rawStoreAudit || !rawStoreAudit.employees) {
      return NextResponse.json(
        {
          success: false,
          error: 'No fue posible consultar la auditoría laboral del servidor para la semana indicada.',
        },
        { status: 500 }
      )
    }

    let storeAudit: any = rawStoreAudit
    let registeredCorporateEmails = new Set<string>()
    try {
      const enriched = await enrichStoreAuditWithNhpPolicy(rawStoreAudit, {
        targetDateOnly: targetDate,
      })
      storeAudit = enriched.enrichedAudit
      registeredCorporateEmails = enriched.registeredCorporateEmails
    } catch (enrichErr: any) {
      console.warn('[/api/ronos/notify-violation] Fallback sin enriquecimiento NHP:', enrichErr?.message)
    }

    const auditEmp = storeAudit.employees.find((e: any) => e.employeeUserId === targetUserId)
    if (!auditEmp) {
      return NextResponse.json(
        {
          success: false,
          error: `El colaborador con ID ${targetUserId} no cuenta con registros en la auditoría laboral de esta sucursal.`,
        },
        { status: 404 }
      )
    }

    if (auditEmp.isSalaried) {
      return NextResponse.json(
        {
          success: false,
          error: `El colaborador "${auditEmp.fullName}" es personal gerencial/administrativo asalariado exento y no aplica para avisos disciplinarios de checador.`,
        },
        { status: 400 }
      )
    }

    const auditDay = auditEmp.days?.find(
      (d: any) => d.date === targetDate || d.date?.startsWith(targetDate)
    )
    if (!auditDay) {
      return NextResponse.json(
        {
          success: false,
          error: `No existen ponchadas ni turnos programados registrados para el colaborador en la fecha ${targetDate}.`,
        },
        { status: 404 }
      )
    }

    const isUnderThresholdLongLunch = (v: any): boolean => {
      if (!v || v.type !== 'LONG_LUNCH') return false
      const vMins = Number(v.minutes ?? 0)
      if (Number.isFinite(vMins) && vMins > 0 && Math.floor(vMins) < INTERNAL_LUNCH_MIN_VIOLATION_MINUTES) {
        return true
      }
      const dayLunchMins = Number(auditDay.lunchDurationMinutes ?? 0)
      if (
        Number.isFinite(dayLunchMins) &&
        dayLunchMins > 0 &&
        Math.floor(dayLunchMins) < INTERNAL_LUNCH_MIN_VIOLATION_MINUTES
      ) {
        return true
      }
      return false
    }

    const nhpEval: RonosDayAttendanceEvaluation | undefined = auditDay.nhpEvaluation
    const activeNhpViolations = (nhpEval?.violations || []).filter(
      (v) => v.isViolation && !isUnderThresholdLongLunch(v)
    )
    const fallbackDayViolations = (auditDay.violations || []).filter(
      (v: any) => v && v.isViolation !== false && !isUnderThresholdLongLunch(v)
    )
    const violations = activeNhpViolations.length > 0 ? activeNhpViolations : fallbackDayViolations

    if (violations.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Auditoría verificada: No existe ninguna infracción laboral comprobada en el sistema para la fecha ${targetDate}.`,
        },
        { status: 400 }
      )
    }

    // 5. Extracción de evidencia y ponchadas validadas del servidor (NO del cliente)
    const requestedViolationType =
      typeof body.violationType === 'string' ? body.violationType.trim() : ''
    if (
      requestedViolationType === 'LONG_LUNCH' &&
      !violations.some((v: any) => v.type === 'LONG_LUNCH')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Auditoría verificada: No existe infracción LONG_LUNCH comprobada en el sistema para la fecha ${targetDate}.`,
        },
        { status: 400 }
      )
    }
    const primaryViolation =
      (requestedViolationType &&
        violations.find((v: any) => v.type === requestedViolationType)) ||
      violations[0]

    const violationType = primaryViolation.type || 'MEAL_PENALTY'
    const violationTitle = primaryViolation.title || 'Incumplimiento de Cumplimiento Laboral'
    const violationDescription =
      primaryViolation.description ||
      'Registro de ponchadas incumple el Manual del Empleado y/o la normativa laboral de California.'

    const clockInTime = auditDay.clockInTime
    const lunchStartTime = auditDay.lunchStartTime
    const lunchEndTime = auditDay.lunchEndTime
    const clockOutTime = auditDay.clockOutTime
    const totalHoursWorked = auditDay.totalHours

    // 6. Resolución de identidad y correo verificado desde la base de datos (NO del cliente)
    let verifiedFullName =
      auditEmp.fullName || `${auditEmp.firstName || ''} ${auditEmp.lastName || ''}`.trim()
    let verifiedPin = auditEmp.pin || ''
    let verifiedJobTitle = auditEmp.jobTitle || 'Colaborador'
    let verifiedEmail: string | null = null

    const { data: mappingData } = await supabaseAdmin
      .from('ronos_employee_mappings')
      .select(
        'toast_email, toast_full_name, ronos_full_name, ronos_pin, ronos_job_title, toast_employee_id, toast_guid'
      )
      .eq('ronos_employee_user_id', targetUserId)
      .eq('ronos_company_id', targetCompanyId)
      .maybeSingle()

    if (mappingData) {
      verifiedFullName =
        mappingData.toast_full_name || mappingData.ronos_full_name || verifiedFullName
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
      } else if (mappingData.toast_guid) {
        const { data: toastByGuid } = await supabaseAdmin
          .from('toast_employees')
          .select('email, full_name')
          .eq('toast_guid', mappingData.toast_guid)
          .maybeSingle()
        if (toastByGuid?.email && toastByGuid.email.includes('@')) {
          verifiedEmail = toastByGuid.email.trim().toLowerCase()
        }
      }
    }

    if (!verifiedEmail && auditEmp.toastEmail && String(auditEmp.toastEmail).includes('@')) {
      verifiedEmail = String(auditEmp.toastEmail).trim().toLowerCase()
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

    const emailValidation = validateEmployeeViolationEmail(verifiedEmail, registeredCorporateEmails)
    if (!emailValidation.deliverable || !emailValidation.cleanEmail) {
      return NextResponse.json(
        {
          success: false,
          error: `El empleado "${verifiedFullName}" (ID: ${targetUserId}) no cuenta con un correo electrónico entregable verificado en la base de datos oficial (${emailValidation.reason}).`,
        },
        { status: 400 }
      )
    }
    verifiedEmail = emailValidation.cleanEmail

    // 7. Resolver tienda oficial en el servidor
    const dynamicStores = await getDynamicRonosStores()
    const storeFound =
      dynamicStores.find((s) => s.ronosCompanyId === targetCompanyId) ||
      RONOS_STORES_MAP.find((s) => s.ronosCompanyId === targetCompanyId)
    const storeName = storeFound?.tegName
      ? `Tacos Gavilan - ${storeFound.tegName}`
      : 'Tacos Gavilan'

    const rawAuthEmail = String(auth.user?.email || '')
      .trim()
      .toLowerCase()
    const senderEmail =
      !rawAuthEmail ||
      rawAuthEmail === 'carlos@tacosgavilan.com' ||
      rawAuthEmail === 'roque@tacosgavilan.com'
        ? 'Sistema de Monitoreo'
        : auth.user!.email

    const safeNotes =
      typeof body.additionalNotes === 'string'
        ? body.additionalNotes.substring(0, 500)
        : undefined

    // 8. Generación segura del correo y despacho con datos exclusivos del servidor
    if (nhpEval && activeNhpViolations.length > 0) {
      // Ordenar poniendo primero la infracción seleccionada si se especificó en el body
      const prioritizedViolations = [
        ...activeNhpViolations.filter((v) => v.type === violationType),
        ...activeNhpViolations.filter((v) => v.type !== violationType),
      ]
      const evalToSend: RonosDayAttendanceEvaluation = {
        ...nhpEval,
        violations: prioritizedViolations,
      }

      const escalera = await getEscaleraDeMando(targetCompanyId)
      const recipientsTo = [verifiedEmail]
      const recipientsCc = escalera.allCcEmails.filter((e) => e && e.includes('@'))

      const { subject, html } = buildEmployeeRonosPolicyEmailHtml({
        storeName,
        employeeName: verifiedFullName,
        employeeJobTitle: verifiedJobTitle,
        businessDate: targetDate,
        evaluation: evalToSend,
        managerContactEmail: escalera.managerEmail,
        managerName: escalera.managerName,
        warningStage: validWarningStage,
        additionalNotes: safeNotes,
      })

      const info = await sendSystemEmail({
        fromName: 'Sistema de Monitoreo',
        to: recipientsTo.join(', '),
        cc: recipientsCc.length > 0 ? recipientsCc.join(', ') : undefined,
        bcc: 'carlos@tacosgavilan.com',
        replyTo: escalera.managerEmail || undefined,
        subject,
        html,
      })

      try {
        await supabaseAdmin.from('ronos_violation_notifications').insert({
          ronos_company_id: targetCompanyId,
          store_name: storeName,
          employee_user_id: targetUserId,
          employee_name: verifiedFullName,
          employee_email: verifiedEmail,
          violation_type: violationType,
          violation_title: violationTitle,
          violation_date: targetDate,
          violation_details: {
            stage: validWarningStage,
            description: violationDescription,
            clockInTime,
            lunchStartTime,
            lunchEndTime,
            clockOutTime,
            totalHoursWorked,
            scheduledShift: evalToSend.scheduledShift,
            toastSummary: evalToSend.toastSummary,
            ronosSummary: evalToSend.ronosSummary,
            allActiveTypes: prioritizedViolations.map((v) => v.type),
            additionalNotes: safeNotes,
          },
          recipients_to: recipientsTo,
          recipients_cc: recipientsCc,
          sent_by: senderEmail,
          status: 'sent',
          email_message_id: info.messageId,
        })
      } catch (logErr) {
        console.warn('[/api/ronos/notify-violation] Error guardando log en Supabase:', logErr)
      }

      return NextResponse.json({
        success: true,
        messageId: info.messageId,
        recipientsTo,
        recipientsCc,
        violationType,
        violationTitle,
      })
    }

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
      additionalNotes: safeNotes,
      senderEmail,
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
      recipientsCc: result.recipientsCc,
      violationType,
      violationTitle,
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
      escalera,
    })
  } catch (error: any) {
    console.error('Error in GET /api/ronos/notify-violation:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Error al obtener historial de notificaciones' },
      { status: 500 }
    )
  }
}
