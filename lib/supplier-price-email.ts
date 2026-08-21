/**
 * @module lib/supplier-price-email
 * @description Sistema de notificación por correo electrónico para alertar de inmediato
 *   a la directiva de Tacos Gavilan (Roberto, Raquel, Gonzalo y Carlos) cuando se detectan
 *   o aprueban aumentos de precios en insumos de distribuidores (Viele & Sons).
 *
 * @businessRules
 *   - Destinatarios oficiales: roberto@tacosgavilan.com, raquel@tacosgavilan.com, gonzalo@tacosgavilan.com, carlos@tacosgavilan.com.
 *   - Se envía automáticamente desde el Cron semanal de los lunes a las 6:00 AM si hay aumentos.
 *   - Se puede enviar manualmente desde la interfaz de usuario (/admin/precios-proveedores).
 *   - Estilo visual ejecutivo en Modo Claro con la marca oficial Tacos Gavilan (#DA291C).
 *
 * @dataFlow
 *   app/api/cron/sync-supplier-prices OR app/api/inventory/supplier-prices/notify
 *   -> sendSupplierPriceAlertEmail() -> Nodemailer (SMTP Gmail) -> Destinatarios.
 */

import nodemailer from 'nodemailer'

export interface PriceIncreaseItem {
  supplierSku: string
  description: string
  packUnit?: string
  packQuantity?: number
  previousCasePrice: number
  newCasePrice: number
  diffAmount: number
  changePercent: number
  annualVolume: number
  annualImpactUsd: number
}

export interface PriceAlertEmailOptions {
  supplierName?: string
  supplierCode?: string
  detectedAt?: string | Date
  sourceType?: 'api_sync' | 'cron_auto' | 'manual_review'
  increases: PriceIncreaseItem[]
  netAnnualImpactUsd: number
  recipients?: string[]
  isTest?: boolean
}

/**
 * Destinatarios directivos oficiales de Tacos Gavilan para alertas de precios
 */
export const DEFAULT_PRICE_ALERT_RECIPIENTS = [
  'roberto@tacosgavilan.com',
  'raquel@tacosgavilan.com',
  'gonzalo@tacosgavilan.com',
  'carlos@tacosgavilan.com'
]

/**
 * Genera la plantilla HTML ejecutiva del correo de alerta de precios
 */
export function generatePriceAlertEmailHtml(options: PriceAlertEmailOptions): string {
  const {
    supplierName = 'Viele & Sons',
    detectedAt = new Date(),
    sourceType = 'api_sync',
    increases,
    netAnnualImpactUsd,
    isTest = false
  } = options

  const formattedDate = new Date(detectedAt).toLocaleString('es-ES', {
    timeZone: 'America/Los_Angeles',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  const sourceLabel = sourceType === 'cron_auto' 
    ? 'Revisión Automática Programada (Lunes 6:00 AM)' 
    : 'Revisión en Vivo desde el Tablero SM TEG'

  const formattedTotalImpact = Math.abs(netAnnualImpactUsd).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  })

  const itemsRows = increases.map(item => {
    const formattedPrev = item.previousCasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const formattedNew = item.newCasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const formattedDiff = (item.diffAmount >= 0 ? '+' : '') + item.diffAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const formattedImpact = item.annualImpactUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const packText = item.packQuantity && item.packQuantity > 1 
      ? `Caja con ${item.packQuantity.toLocaleString()} pzas` 
      : (item.packUnit || 'Caja')

    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 12px; font-family: monospace; font-weight: 700; color: #2563eb; font-size: 13px;">
          ${item.supplierSku}
        </td>
        <td style="padding: 10px 12px; font-size: 13px; color: #0f172a; font-weight: 600;">
          ${item.description}
          <div style="font-size: 11px; color: #64748b; font-weight: 400; margin-top: 2px;">${packText}</div>
        </td>
        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 13px; color: #64748b;">
          ${formattedPrev}
        </td>
        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 13px; color: #dc2626; font-weight: 700;">
          ${formattedNew}
        </td>
        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12px; color: #dc2626; font-weight: 700;">
          ${formattedDiff} (+${item.changePercent.toFixed(1)}%)
        </td>
        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12px; color: #475569;">
          ${item.annualVolume.toLocaleString()} cjs
        </td>
        <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 13px; color: #dc2626; font-weight: 800; background-color: #fff5f5;">
          +${formattedImpact} / año
        </td>
      </tr>
    `
  }).join('')

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alerta de Aumento de Precios — Tacos Gavilan</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">
        
        <!-- CONTENEDOR PRINCIPAL -->
        <table role="presentation" width="100%" style="max-width: 680px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">
          
          <!-- BANDA ROJA SUPERIOR GAVILAN -->
          <tr>
            <td style="background-color: #DA291C; height: 6px;"></td>
          </tr>

          <!-- ENCABEZADO -->
          <tr>
            <td style="padding: 24px 28px 16px 28px; border-bottom: 1px solid #e2e8f0;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="display: inline-block; background-color: #DA291C; color: #ffffff; font-weight: 900; font-size: 14px; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.5px;">
                      TACOS GAVILAN
                    </div>
                    <span style="font-size: 12px; font-weight: 700; color: #64748b; margin-left: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                      SM TEG · Control de Costos
                    </span>
                  </td>
                  <td align="right">
                    ${isTest ? '<span style="background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 12px; text-transform: uppercase;">MODO DE PRUEBA</span>' : ''}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 14px;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #0f172a; line-height: 1.25;">
                      🚨 Alerta de Aumento de Precios de Proveedor
                    </h1>
                    <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
                      Distribuidor: <strong style="color: #0f172a;">${supplierName}</strong> · ${sourceLabel}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TARJETA DE IMPACTO FINANCIERO -->
          <tr>
            <td style="padding: 20px 28px 12px 28px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px;">
                <tr>
                  <td width="50%" style="vertical-align: top; padding-right: 12px; border-right: 1px solid #fecaca;">
                    <div style="font-size: 11px; font-weight: 800; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">
                      Impacto Anual Proyectado (15 Tiendas)
                    </div>
                    <div style="font-size: 28px; font-weight: 900; color: #dc2626; font-family: monospace; margin-top: 4px;">
                      +${formattedTotalImpact} USD
                    </div>
                    <div style="font-size: 11.5px; color: #7f1d1d; margin-top: 4px;">
                      Gasto adicional proyectado para la cadena en el año.
                    </div>
                  </td>
                  <td width="50%" style="vertical-align: top; padding-left: 16px;">
                    <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
                      Resumen del Catálogo
                    </div>
                    <div style="margin-top: 6px; font-size: 13px; color: #1e293b;">
                      • Insumos con Aumento: <strong style="color: #dc2626;">${increases.length} producto(s)</strong><br>
                      • Fecha de Detección: <strong>${formattedDate}</strong><br>
                      • Sucursales Afectadas: <strong>15 tiendas activas</strong>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TABLA DE INSUMOS -->
          <tr>
            <td style="padding: 12px 28px 20px 28px;">
              <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 10px;">
                Detalle de Insumos con Incremento de Precio:
              </div>

              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background-color: #ffffff;">
                <thead>
                  <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Código</th>
                    <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Insumo / Empaque</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Antes</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Hoy</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Alza</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Consumo</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">Impacto Anual</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- BOTÓN DE ACCIÓN DIRECTA -->
          <tr>
            <td style="padding: 0 28px 28px 28px;" align="center">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: #DA291C;">
                    <a href="https://tacosgavilan.vercel.app/admin/precios-proveedores" target="_blank" style="font-size: 14px; font-family: inherit; font-weight: 800; color: #ffffff; text-decoration: none; display: inline-block; padding: 14px 28px; border-radius: 10px; box-shadow: 0 4px 12px rgba(218, 41, 28, 0.3);">
                      Ver y Auditar en el Radar de Precios (SM TEG) ➔
                    </a>
                  </td>
                </tr>
              </table>
              <div style="font-size: 11.5px; color: #64748b; margin-top: 10px;">
                Al entrar al sistema podrás aprobar los costos para actualizar las recetas y Food Cost, o rechazar el aumento para negociar con el distribuidor.
              </div>
            </td>
          </tr>

          <!-- PIE DE PÁGINA -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 28px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center; line-height: 1.5;">
              <strong>Tacos Gavilan · Departamento de Operaciones y Finanzas</strong><br>
              Este es un aviso automático de auditoría de costos para la directiva de Tacos Gavilan.<br>
              Destinatarios: <code>roberto@tacosgavilan.com</code>, <code>raquel@tacosgavilan.com</code>, <code>gonzalo@tacosgavilan.com</code>, <code>carlos@tacosgavilan.com</code>
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
 * Despacha el correo de alerta de precios a los 4 directivos
 */
export async function sendSupplierPriceAlertEmail(options: PriceAlertEmailOptions): Promise<{
  success: boolean
  messageId?: string
  recipients: string[]
  error?: string
}> {
  const recipients = options.recipients && options.recipients.length > 0 
    ? options.recipients 
    : DEFAULT_PRICE_ALERT_RECIPIENTS

  if (!options.increases || options.increases.length === 0) {
    return {
      success: true,
      recipients,
      error: 'No se encontraron aumentos de precio para notificar.'
    }
  }

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    console.error('[PriceAlertEmail] ❌ Error: SMTP_PASSWORD no configurado en variables de entorno.')
    return {
      success: false,
      recipients,
      error: 'Credenciales SMTP no configuradas en el servidor.'
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

    const formattedImpact = Math.abs(options.netAnnualImpactUsd).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    })

    const subject = options.isTest
      ? `[TEST] 🚨 Alerta de Aumento de Precios — ${options.supplierName || 'Viele & Sons'} (+${formattedImpact} USD/año)`
      : `🚨 Alerta de Aumento de Precios — ${options.supplierName || 'Viele & Sons'} (+${formattedImpact} USD/año en 15 Tiendas)`

    const htmlContent = generatePriceAlertEmailHtml(options)

    const info = await transporter.sendMail({
      from: `"Tacos Gavilan · Radar de Precios" <${smtpUser}>`,
      to: recipients.join(', '),
      subject,
      html: htmlContent
    })

    console.log(`[PriceAlertEmail] ✅ Correo de alerta enviado exitosamente a [${recipients.join(', ')}]. ID: ${info.messageId}`)

    return {
      success: true,
      messageId: info.messageId,
      recipients
    }
  } catch (error: any) {
    console.error('[PriceAlertEmail] ❌ Error enviando correo de alerta:', error)
    return {
      success: false,
      recipients,
      error: error?.message || 'Error desconocido al enviar correo'
    }
  }
}
