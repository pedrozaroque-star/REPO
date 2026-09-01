/**
 * @module lib/supplier-price-email
 * @description Sistema de notificación por correo electrónico para alertar de inmediato
 *   a la directiva de Tacos Gavilan (Roberto, Raquel, Gonzalo y Carlos) cuando se detectan
 *   aumentos de precios, REDUCCIONES DE PRECIOS (Oportunidades de Ahorro) o cambios mixtos
 *   en insumos de distribuidores (Viele & Sons, Sysco, US Foods).
 *
 * @businessRules
 *   - Destinatarios oficiales: roberto@tacosgavilan.com, raquel@tacosgavilan.com, gonzalo@tacosgavilan.com, carlos@tacosgavilan.com.
 *   - Se envía automáticamente desde el Cron de lunes a viernes a las 6:00 AM si hay aumentos O reducciones.
 *   - Se puede enviar manualmente desde la interfaz de usuario (/admin/precios-proveedores).
 *   - Si hay rebajas (precios bajan): Muestra plantilla verde esmeralda con el cálculo de ahorro anual en $ USD para las 15 tiendas.
 *   - Si hay aumentos (precios suben): Muestra plantilla roja con el dinero en riesgo anual en $ USD.
 *   - Si hay cambios mixtos: Muestra el impacto neto y dos secciones desglosadas (Aumentos y Ahorros).
 *   - Estilo visual ejecutivo en Modo Claro con la marca oficial Tacos Gavilan (#DA291C).
 *
 * @dataFlow
 *   app/api/cron/sync-supplier-prices OR app/api/inventory/supplier-prices/notify
 *   -> sendSupplierPriceAlertEmail() -> Nodemailer (SMTP Gmail) -> Destinatarios.
 */

import nodemailer from 'nodemailer'

export interface PriceChangeItem {
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
  /** Fecha en que el precio anterior fue aprobado/registrado por última vez en el sistema */
  lastApprovedDate?: string
}

export type PriceIncreaseItem = PriceChangeItem

export interface PriceAlertEmailOptions {
  supplierName?: string
  supplierCode?: string
  detectedAt?: string | Date
  sourceType?: 'api_sync' | 'cron_auto' | 'manual_review'
  increases?: PriceChangeItem[]
  decreases?: PriceChangeItem[]
  netAnnualImpactUsd?: number
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
 * Genera la fila HTML de un artículo para la tabla de correo
 */
/**
 * Genera la fila HTML de un artículo para la tabla de correo (Diseño limpio y bien distribuido)
 */
function renderItemRow(item: PriceChangeItem, type: 'increase' | 'decrease'): string {
  const formattedPrev = item.previousCasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const formattedNew = item.newCasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const isInc = type === 'increase'
  const color = isInc ? '#dc2626' : '#059669'
  const bgColor = isInc ? '#fef2f2' : '#f0fdf4'
  const sign = item.diffAmount >= 0 ? '+' : ''
  const formattedDiff = sign + item.diffAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const formattedImpact = (isInc ? '+' : '') + item.annualImpactUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const packText = item.packQuantity && item.packQuantity > 1 
    ? `Caja con ${item.packQuantity.toLocaleString()} pzas` 
    : (item.packUnit || 'Caja')

  // Formatear la fecha de referencia del precio anterior
  let refDateText = ''
  if (item.lastApprovedDate) {
    try {
      const d = new Date(item.lastApprovedDate)
      refDateText = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Los_Angeles' })
    } catch { refDateText = '' }
  }

  return `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 12px 14px; vertical-align: middle;">
        <span style="font-family: monospace; font-weight: 700; color: #2563eb; font-size: 13px; background-color: #eff6ff; padding: 2px 6px; border-radius: 4px;">
          ${item.supplierSku}
        </span>
        <div style="font-size: 13px; color: #0f172a; font-weight: 600; margin-top: 4px;">
          ${item.description}
        </div>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
          ${packText} · Consumo est.: <strong>${item.annualVolume.toLocaleString()} cjs/año</strong>
        </div>
      </td>
      <td style="padding: 12px 14px; text-align: right; vertical-align: middle; white-space: nowrap;">
        <div style="font-family: monospace; font-size: 14px; color: #64748b; font-weight: 600;">
          ${formattedPrev}
        </div>
        ${refDateText ? `<div style="font-size: 10.5px; color: #94a3b8; margin-top: 2px;">Aprobado: ${refDateText}</div>` : ''}
      </td>
      <td style="padding: 12px 14px; text-align: right; vertical-align: middle; white-space: nowrap;">
        <div style="font-family: monospace; font-size: 15px; color: ${color}; font-weight: 800;">
          ${formattedNew}
        </div>
      </td>
      <td style="padding: 12px 14px; text-align: right; vertical-align: middle; white-space: nowrap;">
        <div style="font-family: monospace; font-size: 13px; color: ${color}; font-weight: 700;">
          ${formattedDiff}
        </div>
        <div style="font-size: 11px; color: ${color}; font-weight: 600; margin-top: 1px;">
          (${sign}${item.changePercent.toFixed(1)}%)
        </div>
      </td>
      <td style="padding: 12px 14px; text-align: right; vertical-align: middle; background-color: ${bgColor}; white-space: nowrap; border-left: 1px solid #f1f5f9;">
        <div style="font-family: monospace; font-size: 14px; color: ${color}; font-weight: 900;">
          ${formattedImpact}
        </div>
        <div style="font-size: 10px; color: ${color}; opacity: 0.85; font-weight: 600; text-transform: uppercase;">
          Cadena (15T)
        </div>
      </td>
    </tr>
  `
}

/**
 * Genera la plantilla HTML ejecutiva del correo de alerta de precios (Aumentos, Rebajas o Mixto)
 */
export function generatePriceAlertEmailHtml(options: PriceAlertEmailOptions): string {
  const {
    supplierName = 'Viele & Sons',
    detectedAt = new Date(),
    sourceType = 'api_sync',
    increases = [],
    decreases = [],
    isTest = false
  } = options

  const formattedDate = new Date(detectedAt).toLocaleString('es-MX', {
    timeZone: 'America/Los_Angeles',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  const sourceLabel = sourceType === 'cron_auto' 
    ? 'Monitoreo Automático Diario (Lunes a Viernes 6:00 AM)' 
    : 'Revisión en Vivo desde Tablero SM TEG'

  const hasIncreases = increases.length > 0
  const hasDecreases = decreases.length > 0

  // Totales
  const totalIncreasesSum = increases.reduce((acc, i) => acc + (i.annualImpactUsd || 0), 0)
  const totalDecreasesSum = decreases.reduce((acc, i) => acc + (i.annualImpactUsd || 0), 0)
  const netImpact = options.netAnnualImpactUsd !== undefined 
    ? options.netAnnualImpactUsd 
    : (totalIncreasesSum + totalDecreasesSum)

  const notifType: 'only_decreases' | 'only_increases' | 'mixed' = 
    (!hasIncreases && hasDecreases) ? 'only_decreases' :
    (hasIncreases && !hasDecreases) ? 'only_increases' : 'mixed'

  let headerTitle = 'Reporte de Variación de Precios'
  let headerColor = '#0f172a'
  let netColor = netImpact <= 0 ? '#059669' : '#dc2626'
  let netBg = netImpact <= 0 ? '#ecfdf5' : '#fef2f2'
  let netBorder = netImpact <= 0 ? '#a7f3d0' : '#fecaca'

  if (notifType === 'only_decreases') {
    headerTitle = 'Oportunidades de Ahorro — Reducción de Precios'
  } else if (notifType === 'only_increases') {
    headerTitle = 'Alerta de Aumento de Precios de Proveedor'
  }

  // Tarjeta de Resumen Financiero Limpia
  const formattedNet = (netImpact >= 0 ? '+' : '') + netImpact.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const formattedInc = Math.abs(totalIncreasesSum).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const formattedDec = Math.abs(totalDecreasesSum).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const financialCardHtml = `
    <table width="100%" cellspacing="0" cellpadding="0" style="background-color: ${netBg}; border: 1px solid ${netBorder}; border-radius: 12px; overflow: hidden;">
      <tr>
        <td style="padding: 18px 20px;">
          <table width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="vertical-align: middle;">
                <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
                  Balance Anual Proyectado (15 Sucursales)
                </div>
                <div style="font-size: 26px; font-weight: 900; color: ${netColor}; font-family: monospace; margin-top: 2px;">
                  ${formattedNet} USD / año
                </div>
                <div style="font-size: 11.5px; color: #64748b; margin-top: 2px;">
                  ${netImpact <= 0 ? 'Ahorro neto estimado para la cadena.' : 'Incremento neto estimado para la cadena.'}
                </div>
              </td>
              <td align="right" style="vertical-align: middle;">
                <table cellspacing="0" cellpadding="0">
                  <tr>
                    ${hasIncreases ? `
                      <td style="padding-left: 16px; text-align: right;">
                        <div style="font-size: 11px; font-weight: 700; color: #dc2626; text-transform: uppercase;">
                          ${increases.length} Aumento${increases.length > 1 ? 's' : ''}
                        </div>
                        <div style="font-size: 15px; font-weight: 800; color: #dc2626; font-family: monospace; margin-top: 1px;">
                          +${formattedInc}
                        </div>
                      </td>
                    ` : ''}
                    ${hasDecreases ? `
                      <td style="padding-left: 16px; text-align: right;">
                        <div style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase;">
                          ${decreases.length} Rebaja${decreases.length > 1 ? 's' : ''}
                        </div>
                        <div style="font-size: 15px; font-weight: 800; color: #059669; font-family: monospace; margin-top: 1px;">
                          -${formattedDec}
                        </div>
                      </td>
                    ` : ''}
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `

  // Sección de Tablas
  let tablesSectionHtml = ''

  // Tabla de Rebajas / Ahorros
  if (hasDecreases) {
    const decRows = decreases.map(i => renderItemRow(i, 'decrease')).join('')
    tablesSectionHtml += `
      <div style="margin-top: 24px;">
        <div style="font-size: 14px; font-weight: 800; color: #059669; margin-bottom: 8px;">
          📉 Insumos con Rebaja de Precio (${decreases.length} Oportunidades de Ahorro):
        </div>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">
              <th style="padding: 10px 14px; text-align: left;">Insumo / Descripción</th>
              <th style="padding: 10px 14px; text-align: right;">Último Aprobado</th>
              <th style="padding: 10px 14px; text-align: right;">Precio Hoy</th>
              <th style="padding: 10px 14px; text-align: right;">Ahorro</th>
              <th style="padding: 10px 14px; text-align: right;">Impacto Anual</th>
            </tr>
          </thead>
          <tbody>
            ${decRows}
          </tbody>
        </table>
      </div>
    `
  }

  // Tabla de Aumentos
  if (hasIncreases) {
    const incRows = increases.map(i => renderItemRow(i, 'increase')).join('')
    tablesSectionHtml += `
      <div style="margin-top: 24px;">
        <div style="font-size: 14px; font-weight: 800; color: #dc2626; margin-bottom: 8px;">
          📈 Insumos con Aumento de Precio (${increases.length} Producto${increases.length > 1 ? 's' : ''} Afectado${increases.length > 1 ? 's' : ''}):
        </div>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">
              <th style="padding: 10px 14px; text-align: left;">Insumo / Descripción</th>
              <th style="padding: 10px 14px; text-align: right;">Último Aprobado</th>
              <th style="padding: 10px 14px; text-align: right;">Precio Hoy</th>
              <th style="padding: 10px 14px; text-align: right;">Aumento</th>
              <th style="padding: 10px 14px; text-align: right;">Impacto Anual</th>
            </tr>
          </thead>
          <tbody>
            ${incRows}
          </tbody>
        </table>
      </div>
    `
  }

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle} — Tacos Gavilan</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 12px;">
    <tr>
      <td align="center">
        
        <!-- CONTENEDOR PRINCIPAL -->
        <table role="presentation" width="100%" style="max-width: 720px; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);" cellspacing="0" cellpadding="0">
          
          <!-- BANDA ROJA SUPERIOR TACOS GAVILAN -->
          <tr>
            <td style="background-color: #DA291C; height: 5px;"></td>
          </tr>

          <!-- ENCABEZADO -->
          <tr>
            <td style="padding: 24px 28px 18px 28px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="display: inline-block; background-color: #DA291C; color: #ffffff; font-weight: 900; font-size: 13px; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.5px;">
                      TACOS GAVILAN
                    </span>
                    <span style="font-size: 12px; font-weight: 700; color: #64748b; margin-left: 8px;">
                      SM TEG · Control de Costos
                    </span>
                  </td>
                  <td align="right">
                    ${isTest ? '<span style="background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 8px; text-transform: uppercase;">MODO DE PRUEBA</span>' : ''}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 14px;">
                    <h1 style="margin: 0; font-size: 20px; font-weight: 900; color: ${headerColor}; line-height: 1.3;">
                      ${headerTitle}
                    </h1>
                    <div style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
                      Proveedor: <strong style="color: #0f172a;">${supplierName}</strong> · ${sourceLabel}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TARJETA DE RESUMEN FINANCIERO -->
          <tr>
            <td style="padding: 20px 28px 8px 28px;">
              ${financialCardHtml}
            </td>
          </tr>

          <!-- TABLAS DE DETALLE -->
          <tr>
            <td style="padding: 0 28px 24px 28px;">
              ${tablesSectionHtml}

              <!-- BOTÓN DE ACCIÓN -->
              <div style="text-align: center; margin-top: 26px;">
                <a href="https://tacosgavilan.vercel.app/admin/precios-proveedores" target="_blank" style="display: inline-block; background-color: #DA291C; color: #ffffff; font-size: 13px; font-weight: 800; text-decoration: none; padding: 12px 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(218, 41, 28, 0.25);">
                  Abrir Radar de Precios en SM TEG ➔
                </a>
              </div>
            </td>
          </tr>

          <!-- PIE DE PÁGINA LIMPIO -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center; line-height: 1.5;">
              <strong style="color: #0f172a;">Tacos Gavilan</strong> · Sistema SM TEG<br>
              Notificación automática para directivos: <code>roberto@tacosgavilan.com</code>, <code>raquel@tacosgavilan.com</code>, <code>gonzalo@tacosgavilan.com</code>, <code>carlos@tacosgavilan.com</code>
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
 * Despacha el correo de alerta de precios a la directiva de Tacos Gavilan
 */
export async function sendSupplierPriceAlertEmail(options: PriceAlertEmailOptions): Promise<{
  success: boolean
  messageId?: string
  recipients?: string[]
  error?: string
}> {
  const {
    supplierName = 'Viele & Sons',
    increases = [],
    decreases = [],
    netAnnualImpactUsd = 0,
    recipients = DEFAULT_PRICE_ALERT_RECIPIENTS,
    isTest = false
  } = options

  if (increases.length === 0 && decreases.length === 0) {
    return {
      success: false,
      error: 'No hay variaciones de precios (aumentos ni rebajas) para notificar.'
    }
  }

  const smtpUser = process.env.SMTP_EMAIL || 'carlos@tacosgavilan.com'
  const smtpPass = process.env.SMTP_PASSWORD

  if (!smtpPass) {
    console.warn('[SupplierPriceEmail] ⚠️ SMTP_PASSWORD no configurado en variables de entorno.')
    return {
      success: false,
      error: 'SMTP_PASSWORD no configurado en el servidor.'
    }
  }

  const hasIncreases = increases.length > 0
  const hasDecreases = decreases.length > 0

  const totalInc = increases.reduce((acc, i) => acc + (i.annualImpactUsd || 0), 0)
  const totalDec = decreases.reduce((acc, i) => acc + (i.annualImpactUsd || 0), 0)

  // Asunto Dinámico
  let subject = ''
  if (!hasIncreases && hasDecreases) {
    const formattedSavings = Math.abs(totalDec).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    subject = `🎉 Oportunidad de Ahorro: ${supplierName} bajó precios (-${formattedSavings} USD/año en 15 Tiendas)`
  } else if (hasIncreases && !hasDecreases) {
    const formattedImpact = Math.abs(totalInc).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    subject = `🚨 Alerta de Aumento de Precios — ${supplierName} (+${formattedImpact} USD/año en 15 Tiendas)`
  } else {
    const net = netAnnualImpactUsd !== undefined ? netAnnualImpactUsd : (totalInc + totalDec)
    const formattedNet = (net >= 0 ? '+' : '') + net.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    subject = `📊 Reporte de Variación de Precios — ${supplierName} (Neto: ${formattedNet} USD / ${increases.length} Alzas, ${decreases.length} Rebajas)`
  }

  if (isTest) {
    subject = `[TEST] ${subject}`
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })

    const html = generatePriceAlertEmailHtml(options)

    const info = await transporter.sendMail({
      from: `"Tacos Gavilan · SM TEG" <${smtpUser}>`,
      to: recipients.join(', '),
      subject,
      html
    })

    console.log(`[SupplierPriceEmail] ✅ Correo despachado con éxito. ID: ${info.messageId}`)
    return {
      success: true,
      messageId: info.messageId,
      recipients
    }
  } catch (error: any) {
    console.error('[SupplierPriceEmail] ❌ Error al despachar correo:', error)
    return {
      success: false,
      error: error?.message || 'Error desconocido al enviar correo'
    }
  }
}
