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
function renderItemRow(item: PriceChangeItem, type: 'increase' | 'decrease'): string {
  const formattedPrev = item.previousCasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const formattedNew = item.newCasePrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const isInc = type === 'increase'
  const color = isInc ? '#dc2626' : '#059669'
  const bgColor = isInc ? '#fff5f5' : '#f0fdf4'
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
      refDateText = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'America/Los_Angeles' })
    } catch { refDateText = '' }
  }

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
        ${refDateText ? `<div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${refDateText}</div>` : ''}
      </td>
      <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 13px; color: ${color}; font-weight: 700;">
        ${formattedNew}
      </td>
      <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12px; color: ${color}; font-weight: 700;">
        ${formattedDiff} (${sign}${item.changePercent.toFixed(1)}%)
      </td>
      <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 12px; color: #475569;">
        ${item.annualVolume.toLocaleString()} cjs
      </td>
      <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-size: 13px; color: ${color}; font-weight: 800; background-color: ${bgColor};">
        ${formattedImpact} / año
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
    ? 'Revisión Automática Programada (Lunes a Viernes 6:00 AM)' 
    : 'Revisión en Vivo desde el Tablero SM TEG'

  const hasIncreases = increases.length > 0
  const hasDecreases = decreases.length > 0

  // Totales
  const totalIncreasesSum = increases.reduce((acc, i) => acc + (i.annualImpactUsd || 0), 0)
  const totalDecreasesSum = decreases.reduce((acc, i) => acc + (i.annualImpactUsd || 0), 0)
  const netImpact = options.netAnnualImpactUsd !== undefined 
    ? options.netAnnualImpactUsd 
    : (totalIncreasesSum + totalDecreasesSum)

  // Determinar Tipo de Notificación:
  // 'only_decreases' | 'only_increases' | 'mixed'
  const notifType: 'only_decreases' | 'only_increases' | 'mixed' = 
    (!hasIncreases && hasDecreases) ? 'only_decreases' :
    (hasIncreases && !hasDecreases) ? 'only_increases' : 'mixed'

  // Configuración de Título y Colores de Cabecera
  let headerTitle = '🚨 Alerta de Aumento de Precios de Proveedor'
  let mainThemeColor = '#dc2626'
  let mainThemeBg = '#fef2f2'
  let mainThemeBorder = '#fecaca'

  if (notifType === 'only_decreases') {
    headerTitle = '🎉 Alerta de Reducción de Precios & Oportunidades de Ahorro'
    mainThemeColor = '#059669'
    mainThemeBg = '#ecfdf5'
    mainThemeBorder = '#a7f3d0'
  } else if (notifType === 'mixed') {
    headerTitle = '📊 Reporte de Variación de Precios de Proveedor'
    mainThemeColor = netImpact >= 0 ? '#dc2626' : '#059669'
    mainThemeBg = netImpact >= 0 ? '#fef2f2' : '#ecfdf5'
    mainThemeBorder = netImpact >= 0 ? '#fecaca' : '#a7f3d0'
  }

  // Tarjeta de Resumen Financiero
  let financialCardHtml = ''
  if (notifType === 'only_decreases') {
    const formattedSavings = Math.abs(totalDecreasesSum).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    financialCardHtml = `
      <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 16px;">
        <tr>
          <td width="50%" style="vertical-align: top; padding-right: 12px; border-right: 1px solid #a7f3d0;">
            <div style="font-size: 11px; font-weight: 800; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px;">
              Ahorro Anual Proyectado (15 Tiendas)
            </div>
            <div style="font-size: 28px; font-weight: 900; color: #059669; font-family: monospace; margin-top: 4px;">
              -${formattedSavings} USD
            </div>
            <div style="font-size: 11.5px; color: #047857; margin-top: 4px;">
              Dinero que la cadena ahorrará al año con estas rebajas de costos.
            </div>
          </td>
          <td width="50%" style="vertical-align: top; padding-left: 16px;">
            <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
              Resumen de Ahorros
            </div>
            <div style="margin-top: 6px; font-size: 13px; color: #1e293b;">
              • Insumos con Rebaja: <strong style="color: #059669;">${decreases.length} producto(s)</strong><br>
              • Fecha de Detección: <strong>${formattedDate}</strong><br>
              • Sucursales Beneficiadas: <strong>15 tiendas activas</strong>
            </div>
          </td>
        </tr>
      </table>
    `
  } else if (notifType === 'only_increases') {
    const formattedCost = Math.abs(totalIncreasesSum).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    financialCardHtml = `
      <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px;">
        <tr>
          <td width="50%" style="vertical-align: top; padding-right: 12px; border-right: 1px solid #fecaca;">
            <div style="font-size: 11px; font-weight: 800; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">
              Impacto Anual Proyectado (15 Tiendas)
            </div>
            <div style="font-size: 28px; font-weight: 900; color: #dc2626; font-family: monospace; margin-top: 4px;">
              +${formattedCost} USD
            </div>
            <div style="font-size: 11.5px; color: #7f1d1d; margin-top: 4px;">
              Gasto adicional proyectado para la cadena si se aceptan las alzas.
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
    `
  } else {
    // Mixto
    const formattedNet = (netImpact >= 0 ? '+' : '') + netImpact.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const formattedInc = Math.abs(totalIncreasesSum).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const formattedDec = Math.abs(totalDecreasesSum).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    financialCardHtml = `
      <table width="100%" cellspacing="0" cellpadding="0" style="background-color: ${mainThemeBg}; border: 1px solid ${mainThemeBorder}; border-radius: 12px; padding: 16px;">
        <tr>
          <td width="40%" style="vertical-align: top; padding-right: 12px; border-right: 1px solid #e2e8f0;">
            <div style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
              Impacto Neto Anual (15 Tiendas)
            </div>
            <div style="font-size: 24px; font-weight: 900; color: ${mainThemeColor}; font-family: monospace; margin-top: 4px;">
              ${formattedNet} USD
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">
              Balance total de aumentos vs rebajas.
            </div>
          </td>
          <td width="30%" style="vertical-align: top; padding: 0 12px; border-right: 1px solid #e2e8f0;">
            <div style="font-size: 11px; font-weight: 800; color: #991b1b; text-transform: uppercase;">
              🔴 Aumentos (${increases.length})
            </div>
            <div style="font-size: 18px; font-weight: 900; color: #dc2626; font-family: monospace; margin-top: 4px;">
              +${formattedInc}
            </div>
          </td>
          <td width="30%" style="vertical-align: top; padding-left: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #065f46; text-transform: uppercase;">
              🟢 Ahorros (${decreases.length})
            </div>
            <div style="font-size: 18px; font-weight: 900; color: #059669; font-family: monospace; margin-top: 4px;">
              -${formattedDec}
            </div>
          </td>
        </tr>
      </table>
    `
  }

  // Sección de Tablas
  let tablesSectionHtml = ''

  // Tabla de Reducciones / Ahorros (si hay)
  if (hasDecreases) {
    const decRows = decreases.map(i => renderItemRow(i, 'decrease')).join('')
    tablesSectionHtml += `
      <div style="margin-top: 24px;">
        <div style="font-size: 14px; font-weight: 900; color: #059669; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
          🎉 Insumos con Reducción de Precio (${decreases.length} Oportunidades de Ahorro):
        </div>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #ecfdf5; border-bottom: 2px solid #a7f3d0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #065f46;">
              <th style="padding: 10px 12px; text-align: left;">SKU</th>
              <th style="padding: 10px 12px; text-align: left;">Insumo / Descripción</th>
              <th style="padding: 10px 12px; text-align: right;">Último Aprobado</th>
              <th style="padding: 10px 12px; text-align: right;">Precio Hoy</th>
              <th style="padding: 10px 12px; text-align: right;">Ahorro</th>
              <th style="padding: 10px 12px; text-align: right;">Consumo</th>
              <th style="padding: 10px 12px; text-align: right;">Ahorro Anual (15T)</th>
            </tr>
          </thead>
          <tbody>
            ${decRows}
          </tbody>
        </table>
      </div>
    `
  }

  // Tabla de Aumentos (si hay)
  if (hasIncreases) {
    const incRows = increases.map(i => renderItemRow(i, 'increase')).join('')
    tablesSectionHtml += `
      <div style="margin-top: 24px;">
        <div style="font-size: 14px; font-weight: 900; color: #dc2626; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
          🚨 Insumos con Aumento de Precio (${increases.length} Productos Afectados):
        </div>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #fef2f2; border-bottom: 2px solid #fecaca; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #991b1b;">
              <th style="padding: 10px 12px; text-align: left;">SKU</th>
              <th style="padding: 10px 12px; text-align: left;">Insumo / Descripción</th>
              <th style="padding: 10px 12px; text-align: right;">Último Aprobado</th>
              <th style="padding: 10px 12px; text-align: right;">Precio Hoy</th>
              <th style="padding: 10px 12px; text-align: right;">Aumento</th>
              <th style="padding: 10px 12px; text-align: right;">Consumo</th>
              <th style="padding: 10px 12px; text-align: right;">Impacto Anual (15T)</th>
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
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">
        
        <!-- CONTENEDOR PRINCIPAL -->
        <table role="presentation" width="100%" style="max-width: 700px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">
          
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
                      ${headerTitle}
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
              ${financialCardHtml}
            </td>
          </tr>

          <!-- TABLAS DE DETALLE -->
          <tr>
            <td style="padding: 0 28px 24px 28px;">
              ${tablesSectionHtml}

              <!-- BOTÓN DE ACCIÓN DIRECTA -->
              <div style="text-align: center; margin-top: 28px;">
                <a href="https://tacosgavilan.vercel.app/admin/precios-proveedores" target="_blank" style="display: inline-block; background-color: #DA291C; color: #ffffff; font-size: 14px; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 10px; box-shadow: 0 4px 12px rgba(218, 41, 28, 0.25);">
                  Ver y Auditar en el Radar de Precios (SM TEG) ➔
                </a>
              </div>
            </td>
          </tr>

          <!-- PIE DE PÁGINA -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center; line-height: 1.5;">
              <strong>Tacos Gavilan · Dirección de Operaciones, Finanzas y Tecnología</strong><br>
              Sistema SM TEG · Auditoría Automática de Costos COGS de las 15 Sucursales<br>
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
