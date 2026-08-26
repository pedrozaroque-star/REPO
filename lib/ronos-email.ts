/**
 * @module lib/ronos-email
 * @description Sistema de Notificación y Envío de Avisos de Cumplimiento Laboral (RONOS Labor Warnings).
 *   - Envía avisos formales por correo al colaborador (usando el correo verificado en Toast/Planificador).
 *   - Incluye en Copia (CC) a la Escalera de Mando: Manager de Sucursal, Supervisor de Zona y Directiva de Tacos Gavilan.
 *   - Enfatiza el monitoreo automatizado y continuo de todas las ponchadas en el reloj checador.
 *   - Registra el historial de despachos en Supabase (`ronos_violation_notifications`).
 *
 * @businessRules
 *   - El nombre de la marca es estrictamente Tacos Gavilan.
 *   - Se debe enviar copia a la escalera de mando correspondiente a la tienda.
 *   - Los correos de directiva siempre incluyen a carlos@tacosgavilan.com y directores.
 *
 * @dataFlow
 *   UI / Endpoint -> getEscaleraDeMando() -> generateViolationWarningEmailHtml() -> Nodemailer -> Supabase Log.
 */

import nodemailer from 'nodemailer'
import { supabaseAdmin } from './supabase'
import { RONOS_STORES_MAP } from './ronos-api'

export interface RonosViolationEmailPayload {
  ronosCompanyId: number
  storeName: string
  employeeUserId: number
  employeeName: string
  employeeEmail: string
  employeePin?: string
  employeeJobTitle?: string
  violationDate: string
  violationType: string
  violationTitle: string
  violationDescription: string
  clockInTime?: string
  lunchStartTime?: string
  lunchEndTime?: string
  clockOutTime?: string
  totalHoursWorked?: number
  additionalNotes?: string
  senderEmail?: string
}

export interface EscaleraDeMando {
  managerEmail: string | null
  managerName: string | null
  supervisorEmail: string | null
  supervisorName: string | null
  leadershipEmails: string[]
  allCcEmails: string[]
}

/**
 * Correos de la directiva ejecutiva de Tacos Gavilan
 */
export const DEFAULT_LEADERSHIP_CC = [
  'carlos@tacosgavilan.com',
  'raquel@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'roberto@tacosgavilan.com'
]

/**
 * Resuelve la escalera de mando oficial (Manager, Supervisor, Directiva) para una sucursal
 */
export async function getEscaleraDeMando(ronosCompanyId: number): Promise<EscaleraDeMando> {
  const storeMeta = RONOS_STORES_MAP.find(s => s.ronosCompanyId === ronosCompanyId)
  const tegStoreId = storeMeta?.tegStoreId || 0

  let managerEmail: string | null = null
  let managerName: string | null = null
  let supervisorEmail: string | null = null
  let supervisorName: string | null = null

  try {
    // 1. Buscar información de la tienda y supervisor
    const { data: storeData } = await supabaseAdmin
      .from('stores')
      .select('id, name, supervisor_name, supervisor_id')
      .eq('id', tegStoreId)
      .single()

    if (storeData) {
      supervisorName = storeData.supervisor_name || null

      if (storeData.supervisor_id) {
        const { data: supUser } = await supabaseAdmin
          .from('users')
          .select('email, full_name')
          .eq('id', storeData.supervisor_id)
          .single()

        if (supUser?.email) {
          supervisorEmail = supUser.email
          if (!supervisorName) supervisorName = supUser.full_name
        }
      }
    }

    // 2. Buscar Manager asignado a la tienda
    const { data: managerUser } = await supabaseAdmin
      .from('users')
      .select('email, full_name')
      .eq('store_id', tegStoreId)
      .eq('role', 'manager')
      .limit(1)
      .single()

    if (managerUser?.email) {
      managerEmail = managerUser.email
      managerName = managerUser.full_name
    }
  } catch (err) {
    console.warn(`[getEscaleraDeMando] Advertencia obteniendo mandos para tienda ${tegStoreId}:`, err)
  }

  const allCcEmails = Array.from(new Set([
    ...(managerEmail ? [managerEmail] : []),
    ...(supervisorEmail ? [supervisorEmail] : []),
    ...DEFAULT_LEADERSHIP_CC
  ]))

  return {
    managerEmail,
    managerName,
    supervisorEmail,
    supervisorName,
    leadershipEmails: DEFAULT_LEADERSHIP_CC,
    allCcEmails
  }
}

/**
 * Genera la plantilla HTML ejecutiva del correo de aviso laboral
 */
export function generateViolationWarningEmailHtml(payload: RonosViolationEmailPayload, escalera: EscaleraDeMando): string {
  const {
    storeName,
    employeeName,
    employeePin,
    employeeJobTitle,
    violationDate,
    violationTitle,
    violationDescription,
    clockInTime,
    lunchStartTime,
    lunchEndTime,
    clockOutTime,
    totalHoursWorked,
    additionalNotes
  } = payload

  const formattedDate = new Date(violationDate).toLocaleDateString('es-ES', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aviso Oficial de Cumplimiento Laboral — Tacos Gavilan</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">

        <!-- CONTENEDOR PRINCIPAL -->
        <table role="presentation" width="100%" style="max-width: 680px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">

          <!-- BANDA SUPERIOR CORPORATIVA TACOS GAVILAN -->
          <tr>
            <td style="background-color: #DA291C; padding: 20px 28px; text-align: left;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 22px; font-weight: 900; color: #ffffff; letter-spacing: 0.5px;">TACOS GAVILAN</span>
                    <span style="display: block; font-size: 12px; color: #fecaca; font-weight: 600; text-transform: uppercase; margin-top: 2px;">
                      Dirección de Recursos Humanos & Operaciones • Auditoría Laboral
                    </span>
                  </td>
                  <td align="right">
                    <span style="background-color: rgba(0,0,0,0.25); color: #ffffff; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 20px; text-transform: uppercase; border: 1px solid rgba(255,255,255,0.3);">
                      Aviso Oficial
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BANNER DE MONITOREO AUTOMATIZADO -->
          <tr>
            <td style="background-color: #fff1f2; border-bottom: 1px solid #fecdd3; padding: 14px 28px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="28" valign="top" style="font-size: 18px;">⚠️</td>
                  <td style="font-size: 13px; color: #9f1239; font-weight: 600; line-height: 1.4;">
                    <strong>Monitoreo Automatizado Activo:</strong> El sistema de auditoría laboral de Tacos Gavilan monitorea de forma continua todos los registros, entradas, descansos y salidas en el reloj checador.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CUERPO PRINCIPAL -->
          <tr>
            <td style="padding: 28px;">

              <!-- SALUDO Y DESTINATARIO -->
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">
                Estimado(a) <strong>${employeeName}</strong>${employeeJobTitle ? ` (${employeeJobTitle})` : ''}:
              </p>

              <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569; line-height: 1.6;">
                Por medio del presente aviso oficial se le informa que nuestro sistema central de auditoría ha detectado una irregularidad en el registro de sus horas laborales en la sucursal <strong>${storeName}</strong> correspondiente al día <strong>${formattedDate}</strong>.
              </p>

              <!-- CAJA DE DETALLE DE LA INFRACCIÓN -->
              <table width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px; overflow: hidden;" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color: #fee2e2; border-bottom: 1px solid #fecaca; padding: 12px 18px;">
                    <span style="font-size: 13px; font-weight: 800; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">
                      📌 Infracción Registrada: ${violationTitle}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 18px;">
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #1e293b; font-weight: 600;">
                      ${violationDescription}
                    </p>

                    <!-- TABLA DE PONCHADAS REGISTRADAS -->
                    <table width="100%" style="font-size: 12px; border-collapse: collapse; margin-top: 10px;" cellspacing="0" cellpadding="6">
                      <tr style="background-color: #edf2f7; color: #475569; font-weight: 700; text-transform: uppercase;">
                        <th align="left" style="padding: 6px 10px; border-radius: 6px 0 0 6px;">Entrada (Clock In)</th>
                        <th align="center" style="padding: 6px 10px;">Inicio Lunch</th>
                        <th align="center" style="padding: 6px 10px;">Fin Lunch</th>
                        <th align="right" style="padding: 6px 10px; border-radius: 0 6px 6px 0;">Salida (Clock Out)</th>
                      </tr>
                      <tr style="color: #0f172a; font-family: monospace; font-weight: 600;">
                        <td align="left" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          ${clockInTime ? new Date(clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                        </td>
                        <td align="center" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          ${lunchStartTime ? new Date(lunchStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                        </td>
                        <td align="center" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          ${lunchEndTime ? new Date(lunchEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                        </td>
                        <td align="right" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          ${clockOutTime ? new Date(clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
                        </td>
                      </tr>
                    </table>

                    ${totalHoursWorked ? `
                      <p style="margin: 10px 0 0 0; font-size: 12px; color: #64748b;">
                        Total de horas registradas en el turno: <strong>${totalHoursWorked.toFixed(2)} hrs</strong>
                      </p>
                    ` : ''}
                  </td>
                </tr>
              </table>

              <!-- REGLAMENTO LABORAL DE CALIFORNIA -->
              <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                <span style="font-size: 12px; font-weight: 800; color: #166534; text-transform: uppercase; display: block; margin-bottom: 4px;">
                  ⚖️ Marco Legal y Normativa de California (IWC Wage Order 5 / Labor Code § 512):
                </span>
                <p style="margin: 0; font-size: 12px; color: #15803d; line-height: 1.5;">
                  • En jornadas mayores a 6 horas, es obligatorio tomar un descanso de comida de <strong>30 minutos ininterrumpidos antes de cumplir la 5ta hora de trabajo continuo</strong>.<br>
                  • Ningún colaborador debe retrasar su comida ni regresar antes de los 30 minutos obligatorios.<br>
                  • Toda entrada y salida debe ser registrada puntualmente con la fotografía del reloj checador correspondiente.
                </p>
              </div>

              ${additionalNotes ? `
                <p style="margin: 0 0 20px 0; font-size: 13px; color: #475569; background-color: #fffbeb; border: 1px solid #fef3c7; padding: 12px; border-radius: 8px;">
                  <strong>Nota de la Gerencia:</strong> ${additionalNotes}
                </p>
              ` : ''}

              <!-- LLAMADO A LA ACCIÓN / DISCIPLINA -->
              <p style="margin: 0 0 24px 0; font-size: 13px; color: #334155; line-height: 1.6;">
                Le solicitamos coordinar estrictamente sus horarios con su Gerente o Encargado de turno para asegurar que sus descansos sean tomados en tiempo y forma.
              </p>

              <!-- ESCALERA DE MANDO CC NOTIFICATION -->
              <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 20px;">
                <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 6px;">
                  Copia de Notificación (Escalera de Mando):
                </span>
                <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                  • <strong>Gerente de Sucursal:</strong> ${escalera.managerName || 'Gerencia'} (${escalera.managerEmail || 'No asignado'})<br>
                  • <strong>Supervisor de Zona:</strong> ${escalera.supervisorName || 'Supervisión'} (${escalera.supervisorEmail || 'No asignado'})<br>
                  • <strong>Dirección Ejecutiva:</strong> ${DEFAULT_LEADERSHIP_CC.join(', ')}
                </p>
              </div>

            </td>
          </tr>

          <!-- PIE DE PÁGINA FORMAL -->
          <tr>
            <td style="background-color: #0f172a; padding: 20px 28px; text-align: center;">
              <p style="margin: 0; font-size: 12px; font-weight: 700; color: #ffffff;">
                TACOS GAVILAN • CUMPLIMIENTO LABORAL Y NÓMINA
              </p>
              <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8;">
                Este correo fue generado automáticamente por el sistema central de auditoría laboral (RONOS Module).
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
  `
}

/**
 * Despacha el correo de advertencia laboral al empleado con copia a la escalera de mando
 */
export async function sendRonosViolationWarningEmail(payload: RonosViolationEmailPayload): Promise<{
  success: boolean
  messageId?: string
  recipientsTo: string[]
  recipientsCc: string[]
  error?: string
}> {
  const { ronosCompanyId, storeName, employeeName, employeeEmail, violationTitle, violationDate } = payload

  if (!employeeEmail || !employeeEmail.includes('@')) {
    return {
      success: false,
      recipientsTo: [],
      recipientsCc: [],
      error: `El empleado "${employeeName}" no cuenta con un correo electrónico válido registrado en Toast.`
    }
  }

  // 1. Obtener Escalera de Mando
  const escalera = await getEscaleraDeMando(ronosCompanyId)

  const recipientsTo = [employeeEmail.trim()]
  const recipientsCc = escalera.allCcEmails.filter(e => e && e.includes('@'))

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    return {
      success: false,
      recipientsTo,
      recipientsCc,
      error: 'SMTP_PASSWORD no configurado en el servidor.'
    }
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })

    const subject = `⚠️ Aviso Oficial de Incumplimiento Laboral en Registro de Ponchadas — Tacos Gavilan ${storeName}`
    const htmlContent = generateViolationWarningEmailHtml(payload, escalera)

    const info = await transporter.sendMail({
      from: `"Tacos Gavilan · Auditoría Laboral" <${smtpUser}>`,
      to: recipientsTo.join(', '),
      cc: recipientsCc.join(', '),
      subject,
      html: htmlContent
    })

    console.log(`[RonosEmail] ✅ Aviso laboral enviado a [${recipientsTo.join(', ')}] con CC [${recipientsCc.join(', ')}]. ID: ${info.messageId}`)

    // 2. Registrar en base de datos Supabase
    try {
      await supabaseAdmin
        .from('ronos_violation_notifications')
        .insert({
          ronos_company_id: ronosCompanyId,
          store_name: storeName,
          employee_user_id: payload.employeeUserId,
          employee_name: employeeName,
          employee_email: employeeEmail,
          violation_type: payload.violationType,
          violation_title: violationTitle,
          violation_date: violationDate,
          violation_details: {
            description: payload.violationDescription,
            clockInTime: payload.clockInTime,
            lunchStartTime: payload.lunchStartTime,
            lunchEndTime: payload.lunchEndTime,
            clockOutTime: payload.clockOutTime,
            totalHoursWorked: payload.totalHoursWorked,
            additionalNotes: payload.additionalNotes
          },
          recipients_to: recipientsTo,
          recipients_cc: recipientsCc,
          sent_by: payload.senderEmail || smtpUser,
          status: 'sent',
          email_message_id: info.messageId
        })
    } catch (logErr) {
      console.warn('[RonosEmail] Error guardando log en Supabase:', logErr)
    }

    return {
      success: true,
      messageId: info.messageId,
      recipientsTo,
      recipientsCc
    }
  } catch (error: any) {
    console.error('[RonosEmail] ❌ Error despachando correo de aviso laboral:', error)
    return {
      success: false,
      recipientsTo,
      recipientsCc,
      error: error?.message || 'Error desconocido despachando correo'
    }
  }
}
