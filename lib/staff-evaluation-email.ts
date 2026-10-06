/**
 * @module lib/staff-evaluation-email
 * @description Generador y despachador de notificaciones por correo electrónico para Dirección General
 * (Raquel, Roberto, Gonzalo y Carlos) ante el registro de cada nueva evaluación de personal (STAFF y Corporativo).
 * @businessRules
 * - Destinatarios oficiales de Dirección: raquel@tacosgavilan.com, roberto@tacosgavilan.com, gonzalo@tacosgavilan.com y carlos@tacosgavilan.com.
 * - Se despacha automáticamente al completarse la captura de un cuestionario en /evaluacion o /evaluacion/kiosk.
 * - Proporciona el resumen ejecutivo inmediato: sucursal o ubicación, colaborador evaluado, puesto, evaluador,
 *   calificación general (1-10), recomendación (Sí/No), fortalezas y áreas de oportunidad.
 * - Desglosa los promedios de las 5 dimensiones clave (Trabajo en equipo, Liderazgo si aplica, Desempeño, Actitud y Desarrollo).
 * - Utiliza zona horaria oficial America/Los_Angeles y jornada laboral de 6:00 AM a 5:59 AM.
 * - Marca oficial: Tacos Gavilan (#DA291C y #F59E0B).
 * @dataFlow
 * - components/StaffEvaluationForm -> POST /api/evaluacion/notify -> sendStaffEvaluationEmail() -> Nodemailer (SMTP Gmail) -> Destinatarios.
 * @notes
 * - La llamada es no bloqueante en el cliente para garantizar una experiencia instantánea en el kiosko de tienda.
 * - Manejo robusto de errores con log en consola y respuesta estructurada.
 */

import nodemailer from 'nodemailer'

export interface StaffEvaluationEmailPayload {
  id?: number | string
  store_id?: number | null
  location_name?: string | null
  evaluation_date?: string
  evaluator_name?: string | null
  evaluated_name: string
  evaluated_role: string
  q1_1?: number; q1_2?: number; q1_3?: number; q1_4?: number; q1_5?: number
  q2_1?: number | null; q2_2?: number | null; q2_3?: number | null; q2_4?: number | null; q2_5?: number | null
  q3_1?: number; q3_2?: number; q3_3?: number; q3_4?: number; q3_5?: number
  q4_1?: number; q4_2?: number; q4_3?: number; q4_4?: number; q4_5?: number
  q5_1?: number; q5_2?: number; q5_3?: number; q5_4?: number; q5_5?: number
  fortalezas?: string | null
  areas_mejora?: string | null
  recomendaria?: string | null
  desempeno_general?: number | null
  comentarios?: string | null
  language?: string
  answers?: {
    is_lead_role?: boolean
    location_name?: string
    custom_role?: string
    [key: string]: any
  }
}

export const STAFF_EVALUATION_DIRECTORS = [
  'raquel@tacosgavilan.com',
  'roberto@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'carlos@tacosgavilan.com'
]

function calcSectionAvg(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && !isNaN(v) && v > 0)
  if (nums.length === 0) return null
  const sum = nums.reduce((acc, curr) => acc + curr, 0)
  return Math.round((sum / nums.length) * 10) / 10
}

function formatSafeEmailDate(dateStr?: string): { dateText: string; timeText: string } {
  try {
    const d = dateStr ? new Date(dateStr) : new Date()
    const dateText = d.toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Los_Angeles'
    })
    const timeText = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Los_Angeles'
    })
    return {
      dateText: dateText.charAt(0).toUpperCase() + dateText.slice(1),
      timeText
    }
  } catch {
    return { dateText: 'Hoy', timeText: '' }
  }
}

export function generateStaffEvaluationEmailHtml(payload: StaffEvaluationEmailPayload): string {
  const { dateText, timeText } = formatSafeEmailDate(payload.evaluation_date)
  const location = payload.location_name || (payload.store_id ? `Tienda #${payload.store_id}` : 'Oficina Central / Corporativo')
  const evaluator = payload.evaluator_name?.trim() || 'Evaluador en tienda (No especificado)'
  const score = typeof payload.desempeno_general === 'number' ? payload.desempeno_general : 10
  const isRecommended = (payload.recomendaria || '').toLowerCase() === 'si'
  
  // Promedios por dimensión (escala 1 a 5)
  const avgTeam = calcSectionAvg([payload.q1_1, payload.q1_2, payload.q1_3, payload.q1_4, payload.q1_5])
  const isLead = payload.answers?.is_lead_role ?? (payload.q2_1 !== null && payload.q2_1 !== undefined && payload.q2_1 > 0)
  const avgLead = isLead ? calcSectionAvg([payload.q2_1, payload.q2_2, payload.q2_3, payload.q2_4, payload.q2_5]) : null
  const avgPerf = calcSectionAvg([payload.q3_1, payload.q3_2, payload.q3_3, payload.q3_4, payload.q3_5])
  const avgAttitude = calcSectionAvg([payload.q4_1, payload.q4_2, payload.q4_3, payload.q4_4, payload.q4_5])
  const avgGrowth = calcSectionAvg([payload.q5_1, payload.q5_2, payload.q5_3, payload.q5_4, payload.q5_5])

  // Color de badge de calificación
  const scoreColor = score >= 8.5 ? '#16a34a' : score >= 7.0 ? '#d97706' : '#dc2626'
  const scoreBg = score >= 8.5 ? '#f0fdf4' : score >= 7.0 ? '#fffbeb' : '#fef2f2'

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Evaluación de Personal — Tacos Gavilan</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 640px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04); border: 1px solid #e2e8f0;">
          
          <!-- BANNER SUPERIOR CON MARCA GAVILAN -->
          <tr>
            <td style="background: linear-gradient(135deg, #DA291C 0%, #b91c1c 100%); padding: 28px 24px; text-align: center; border-bottom: 4px solid #F59E0B;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: #ffffff; padding: 8px 16px; border-radius: 9999px; margin-bottom: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                      <span style="color: #DA291C; font-weight: 900; font-size: 14px; letter-spacing: 0.5px;">TACOS GAVILAN</span>
                      <span style="color: #64748b; font-size: 12px; margin-left: 6px;">• SISTEMA OPERATIVO TEG</span>
                    </div>
                    <h1 style="color: #ffffff; font-size: 22px; font-weight: 900; margin: 0; letter-spacing: -0.5px;">
                      Nueva Evaluación de Personal (STAFF)
                    </h1>
                    <p style="color: #fef08a; font-size: 13px; font-weight: 600; margin: 6px 0 0 0;">
                      Notificación Directiva para Raquel, Roberto y Gonzalo
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TARJETA HERO: COLABORADOR Y CALIFICACIÓN -->
          <tr>
            <td style="padding: 24px;">
              <table role="presentation" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 20px;">
                <tr>
                  <td>
                    <!-- UBICACIÓN Y FECHA -->
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <span style="display: inline-block; background-color: #DA291C; color: #ffffff; font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.5px;">
                            📍 ${location}
                          </span>
                        </td>
                        <td align="right" style="color: #64748b; font-size: 12px; font-weight: 600;">
                          ${dateText} · ${timeText}
                        </td>
                      </tr>
                    </table>

                    <!-- DATOS DEL COLABORADOR -->
                    <div style="margin-top: 16px;">
                      <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                        Colaborador Evaluado
                      </div>
                      <div style="font-size: 22px; font-weight: 900; color: #0f172a; margin-top: 2px;">
                        ${payload.evaluated_name}
                      </div>
                      <div style="font-size: 14px; font-weight: 700; color: #DA291C; margin-top: 2px;">
                        ${payload.evaluated_role}
                      </div>
                    </div>

                    <!-- HERO SCORE BOX -->
                    <table role="presentation" width="100%" style="margin-top: 20px; border-top: 1px dashed #cbd5e1; padding-top: 16px;">
                      <tr>
                        <td width="55%" style="vertical-align: middle;">
                          <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                            Desempeño General
                          </div>
                          <div style="display: flex; align-items: baseline; margin-top: 4px;">
                            <span style="font-size: 32px; font-weight: 900; color: ${scoreColor}; font-family: monospace;">
                              ${score}
                            </span>
                            <span style="font-size: 16px; font-weight: 700; color: #64748b; margin-left: 4px;">
                              / 10
                            </span>
                            <span style="font-size: 14px; margin-left: 8px;">
                              ${score >= 8.5 ? '⭐ Excelente' : score >= 7 ? '👍 Favorable' : '⚠️ Atención'}
                            </span>
                          </div>
                        </td>
                        <td width="45%" align="right" style="vertical-align: middle;">
                          <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                            ¿Recomendaría?
                          </div>
                          ${isRecommended ? `
                            <span style="display: inline-block; background-color: #dcfce7; color: #15803d; font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 9999px; border: 1px solid #86efac;">
                              ✅ SÍ RECOMENDADO
                            </span>
                          ` : `
                            <span style="display: inline-block; background-color: #fee2e2; color: #b91c1c; font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 9999px; border: 1px solid #fca5a5;">
                              ⚠️ REQUIERE SUPERVISIÓN
                            </span>
                          `}
                        </td>
                      </tr>
                    </table>

                    <!-- EVALUADOR -->
                    <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #475569;">
                      <strong>Evaluado por:</strong> ${evaluator}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- SECCIÓN DE OBSERVACIONES CUALITATIVAS -->
              <h2 style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                📋 Observaciones y Retroalimentación
              </h2>

              <!-- FORTALEZAS -->
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px;">
                <div style="font-size: 11px; font-weight: 800; color: #166534; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                  🌟 Fortalezas Destacadas
                </div>
                <div style="font-size: 13.5px; color: #14532d; font-weight: 600; line-height: 1.5;">
                  ${payload.fortalezas?.trim() ? payload.fortalezas : 'No especificadas en este cuestionario.'}
                </div>
              </div>

              <!-- ÁREAS DE MEJORA -->
              <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px;">
                <div style="font-size: 11px; font-weight: 800; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                  🎯 Áreas de Oportunidad y Mejora
                </div>
                <div style="font-size: 13.5px; color: #78350f; font-weight: 600; line-height: 1.5;">
                  ${payload.areas_mejora?.trim() ? payload.areas_mejora : 'Ninguna área crítica señalada.'}
                </div>
              </div>

              <!-- COMENTARIOS ADICIONALES (SI HAY) -->
              ${payload.comentarios?.trim() ? `
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #64748b; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;">
                  <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                    💬 Comentarios Adicionales del Evaluador
                  </div>
                  <div style="font-size: 13px; color: #334155; line-height: 1.5;">
                    ${payload.comentarios}
                  </div>
                </div>
              ` : ''}

              <!-- RESUMEN DE PROMEDIOS POR ÁREA (1 A 5 ESTRELLAS) -->
              <h2 style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 24px 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">
                📊 Promedios por Dimensión de Trabajo
              </h2>

              <table role="presentation" width="100%" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                  <th style="padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase;">Dimensión Evaluada</th>
                  <th style="padding: 10px 14px; text-align: right; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase;">Promedio (1-5)</th>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 600; color: #1e293b;">🤝 Trabajo en Equipo</td>
                  <td style="padding: 10px 14px; text-align: right; font-size: 13px; font-weight: 800; color: #0f172a; font-family: monospace;">
                    ${avgTeam !== null ? `${avgTeam} / 5` : 'N/A'}
                  </td>
                </tr>
                ${isLead && avgLead !== null ? `
                  <tr style="border-bottom: 1px solid #f1f5f9; background-color: #fefce8;">
                    <td style="padding: 10px 14px; font-size: 13px; font-weight: 700; color: #854d0e;">👑 Liderazgo y Gestión</td>
                    <td style="padding: 10px 14px; text-align: right; font-size: 13px; font-weight: 800; color: #854d0e; font-family: monospace;">
                      ${avgLead} / 5
                    </td>
                  </tr>
                ` : ''}
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 600; color: #1e293b;">⚡ Desempeño y Calidad</td>
                  <td style="padding: 10px 14px; text-align: right; font-size: 13px; font-weight: 800; color: #0f172a; font-family: monospace;">
                    ${avgPerf !== null ? `${avgPerf} / 5` : 'N/A'}
                  </td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 600; color: #1e293b;">😊 Actitud y Compromiso</td>
                  <td style="padding: 10px 14px; text-align: right; font-size: 13px; font-weight: 800; color: #0f172a; font-family: monospace;">
                    ${avgAttitude !== null ? `${avgAttitude} / 5` : 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 600; color: #1e293b;">🚀 Desarrollo y Aprendizaje</td>
                  <td style="padding: 10px 14px; text-align: right; font-size: 13px; font-weight: 800; color: #0f172a; font-family: monospace;">
                    ${avgGrowth !== null ? `${avgGrowth} / 5` : 'N/A'}
                  </td>
                </tr>
              </table>

              <!-- BOTÓN CTA: VER EVALUACIÓN COMPLETA -->
              <div style="text-align: center; margin: 28px 0 12px 0;">
                <a href="https://tacosgavilan.vercel.app/evaluacion" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #DA291C 0%, #b91c1c 100%); color: #ffffff; font-size: 14px; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 14px rgba(218, 41, 28, 0.35); letter-spacing: 0.3px;">
                  🔍 Abrir Auditoría Completa en SM TEG
                </a>
              </div>
              <div style="text-align: center; font-size: 11px; color: #94a3b8;">
                Puedes revisar el desglose de las 25 preguntas y emitir tu dictamen gerencial en la plataforma.
              </div>
            </td>
          </tr>

          <!-- PIE DE CORREO -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center;">
              <p style="font-size: 12px; font-weight: 700; color: #475569; margin: 0 0 4px 0;">
                Tacos Gavilan • Operaciones y Desarrollo de Talento Humano
              </p>
              <p style="font-size: 11px; color: #94a3b8; margin: 0; line-height: 1.4;">
                Notificación ejecutiva enviada automáticamente a la Dirección General:<br>
                <code>raquel@tacosgavilan.com</code> · <code>roberto@tacosgavilan.com</code> · <code>gonzalo@tacosgavilan.com</code> · <code>carlos@tacosgavilan.com</code>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export async function sendStaffEvaluationEmail(
  payload: StaffEvaluationEmailPayload,
  customRecipients?: string[]
): Promise<{ success: boolean; messageId?: string; recipients?: string[]; error?: string }> {
  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    console.warn('[StaffEvaluationEmail] ⚠️ SMTP_PASSWORD no configurado en variables de entorno.')
    return {
      success: false,
      error: 'SMTP_PASSWORD no configurado en el servidor.'
    }
  }

  const recipients = customRecipients && customRecipients.length > 0 
    ? customRecipients 
    : STAFF_EVALUATION_DIRECTORS

  const location = payload.location_name || (payload.store_id ? `Tienda #${payload.store_id}` : 'Oficina Central')
  const score = typeof payload.desempeno_general === 'number' ? payload.desempeno_general : 10
  
  // Asunto ejecutivo limpio
  const subject = `📝 Nueva Evaluación STAFF — ${location}: ${payload.evaluated_name} (${payload.evaluated_role}) — ${score}/10 ⭐`

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })

    const html = generateStaffEvaluationEmailHtml(payload)

    const info = await transporter.sendMail({
      from: `"Tacos Gavilan · STAFF" <${smtpUser}>`,
      to: recipients.join(', '),
      subject,
      html
    })

    console.log(`[StaffEvaluationEmail] ✅ Correo despachado a [${recipients.join(', ')}]. Message ID: ${info.messageId}`)
    return {
      success: true,
      messageId: info.messageId,
      recipients
    }
  } catch (error: any) {
    console.error('[StaffEvaluationEmail] ❌ Error despachando correo de evaluación STAFF:', error)
    return {
      success: false,
      error: error?.message || 'Error desconocido al enviar correo'
    }
  }
}
