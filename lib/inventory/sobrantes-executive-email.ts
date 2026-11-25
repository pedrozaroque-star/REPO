/**
 * @module lib/inventory/sobrantes-executive-email
 * @description Plantilla ejecutiva ultra-limpia de lectura en 5 segundos para el correo diario
 *   de Control de Sobrantes vs. Ventas Toast POS en las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 *   - Diseñado para lectura inmediata en celular o computadora sin fórmulas ni tablas saturadas:
 *     1. Tres tarjetas grandes arriba: Tiendas con Faltante, Tiendas en Regla y Sin Conteo.
 *     2. Tabla limpia de solo 4 columnas (números enteros redondeados del mismo periodo):
 *        `Sucursal | Debía Sobrar | Capturaron | Resultado`.
 *     3. Lista compacta de sucursales sin conteo y sucursales en regla.
 *   - Durante la Semana de Pruebas Privadas envía 100% en exclusiva a `carlos@tacosgavilan.com`.
 *
 * @dataFlow
 *   `computeToastVsFridgeForIngredient()` -> `buildSobrantesExecutiveEmailHtml()` -> `sendSystemEmail()`.
 */

import { formatSignedUSD } from '@/lib/inventory/food-cost-sales-resolver'
import { resolveAppBaseUrl } from '@/lib/basecamp-todo-email'
import {
  formatShortDateLabelEs,
  type computeToastVsFridgeForIngredient,
} from '@/lib/inventory/toast-meat-sold-resolver'
import { sendSystemEmail } from '@/lib/system-mailer'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import { validateTestToEmail } from '@/lib/inventory/portion-control-alerts'

export type UnifiedMeterResult = Awaited<ReturnType<typeof computeToastVsFridgeForIngredient>>

function escapeHtml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildSobrantesExecutiveEmailHtml(params: {
  ingredientName: string
  startDate: string
  endDate: string
  meter: UnifiedMeterResult
  dashboardUrl?: string
  recipientEmail?: string
}): { subject: string; html: string; shortageCount: number; totalShortageUsd: number } {
  const { ingredientName, startDate, endDate, meter } = params
  const recipientEmail = params.recipientEmail || 'carlos@tacosgavilan.com'
  const baseUrl = resolveAppBaseUrl()
  const normIng = ingredientName.toLowerCase()
  const meatSlug = normIng.includes('pastor') ? 'pastor'
    : normIng.includes('pollo') ? 'pollo'
    : normIng.includes('cabeza') ? 'cabeza'
    : normIng.includes('lengua') ? 'lengua'
    : normIng.includes('chorizo') ? 'chorizo'
    : normIng.includes('carnitas') ? 'carnitas'
    : normIng.includes('buche') ? 'buche'
    : 'asada'
  const linkUrl =
    params.dashboardUrl ||
    `${baseUrl}/admin/food-cost/meats?storeId=all&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&meat=${meatSlug}`

  const rangeLabel = `${formatShortDateLabelEs(startDate)} al ${formatShortDateLabelEs(endDate)}`

  const cleanSummaryName = (s: { storeId: number | string; storeName: string }) =>
    formatStoreDisplayName({ id: s.storeId, name: s.storeName }) || s.storeName

  const shortageStores = sortStoresAlphabetically(
    meter.storesSummaries.filter(
      (s) => s.hasMeasuredSpan && !s.hasNegativeCountAnomaly && (s.cumulativeFridgeBalanceBags ?? 0) <= -1
    ),
    (s) => cleanSummaryName(s),
    { pinSpecialFirst: false }
  )

  const uncountedStores = sortStoresAlphabetically(
    meter.storesSummaries.filter((s) => !s.hasMeasuredSpan || s.hasNegativeCountAnomaly),
    (s) => cleanSummaryName(s),
    { pinSpecialFirst: false }
  )

  const okStores = sortStoresAlphabetically(
    meter.storesSummaries.filter(
      (s) => s.hasMeasuredSpan && !s.hasNegativeCountAnomaly && (s.cumulativeFridgeBalanceBags ?? 0) > -1
    ),
    (s) => cleanSummaryName(s),
    { pinSpecialFirst: false }
  )

  const totalMissingBags = Math.round(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceBags || 0), 0)
  )
  const totalShortageUsd = Math.round(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceDollarStore || 0), 0)
  )

  const shortageRowsHtml =
    shortageStores.length === 0
      ? `<tr><td colspan="4" style="padding:18px;text-align:center;color:#059669;font-weight:700;font-size:14px;">✅ Ninguna sucursal presentó faltante de sobrante en este periodo.</td></tr>`
      : shortageStores
          .map((s) => {
            const actual = Math.round(s.closingBags || 0)
            const missing = Math.max(1, Math.round(Math.abs(s.cumulativeFridgeBalanceBags || 0)))
            const expected = actual + missing
            const lossUsd = formatSignedUSD(-Math.round(Math.abs(s.cumulativeFridgeBalanceDollarStore || 0)), {
              decimals: 0,
            })
            const storeUrl = `${baseUrl}/admin/food-cost/meats?storeId=${encodeURIComponent(String(s.storeId))}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&meat=${meatSlug}`
            return `<tr style="border-bottom:1px solid #FEE2E2;">
              <td style="padding:14px 12px;font-size:15px;font-weight:800;color:#111827;"><a href="${escapeHtml(storeUrl)}" target="_blank" style="color:#111827;text-decoration:underline;">${escapeHtml(cleanSummaryName(s))}</a></td>
              <td style="padding:14px 10px;text-align:center;font-size:15px;font-weight:700;color:#374151;">${expected} bolsas</td>
              <td style="padding:14px 10px;text-align:center;font-size:15px;font-weight:700;color:#111827;">${actual} bolsas</td>
              <td style="padding:14px 12px;text-align:right;font-size:15px;font-weight:900;color:#DC2626;">
                Faltan ${missing} bolsas (${lossUsd})
              </td>
            </tr>`
          })
          .join('')

  const uncountedHtml =
    uncountedStores.length === 0
      ? ''
      : `<div style="margin-top:20px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px 16px;">
          <div style="font-size:13px;font-weight:800;color:#92400E;margin-bottom:4px;">⚠️ Pendiente de Conteo Manual (${uncountedStores.length})</div>
          <div style="font-size:14px;color:#78350F;">
            ${uncountedStores.map((s) => `<strong>${escapeHtml(cleanSummaryName(s))}</strong>`).join(', ')} — Sin captura manual suficiente en la semana (ya activa en Conteo Ciego obligatorio).
          </div>
        </div>`

  const okPillsHtml = okStores
    .map(
      (s) =>
        `<span style="display:inline-block;margin:4px 6px 4px 0;padding:6px 10px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;font-size:13px;font-weight:700;color:#065F46;">✅ ${escapeHtml(cleanSummaryName(s))}</span>`
    )
    .join('')

  const subject =
    shortageStores.length > 0
      ? `📦 Resumen de Sobrantes (${ingredientName}): ${shortageStores.length} tiendas con faltante (-$${totalShortageUsd.toLocaleString('en-US')})`
      : `📦 Resumen de Sobrantes (${ingredientName}): 15 sucursales en regla`

  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:16px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table width="620" align="center" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <tr>
        <td style="background:#111827;color:#FFFFFF;padding:22px 24px;">
          <div style="font-size:11px;font-weight:800;color:#93C5FD;text-transform:uppercase;letter-spacing:0.8px;">REPORTE SIMPLE · VISTA PREVIA EJECUTIVA (${escapeHtml(recipientEmail)})</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px;">📦 Sobrantes de ${escapeHtml(ingredientName)}</div>
          <div style="font-size:13px;color:#D1D5DB;margin-top:4px;">Semana del ${escapeHtml(rangeLabel)} · Ventas Toast vs. Sobrante Capturado</div>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 20px -8px;">
            <tr>
              <td width="34%" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 12px;text-align:center;">
                <div style="font-size:11px;font-weight:800;color:#991B1B;text-transform:uppercase;">Con Faltante</div>
                <div style="font-size:24px;font-weight:900;color:#DC2626;margin-top:2px;">${shortageStores.length}</div>
                <div style="font-size:12px;font-weight:700;color:#B91C1C;">-${totalMissingBags} bolsas (-$${totalShortageUsd.toLocaleString('en-US')})</div>
              </td>
              <td width="33%" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:14px 12px;text-align:center;">
                <div style="font-size:11px;font-weight:800;color:#065F46;text-transform:uppercase;">En Regla</div>
                <div style="font-size:24px;font-weight:900;color:#059669;margin-top:2px;">${okStores.length}</div>
                <div style="font-size:12px;font-weight:700;color:#047857;">Sin pérdida</div>
              </td>
              <td width="33%" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px 12px;text-align:center;">
                <div style="font-size:11px;font-weight:800;color:#92400E;text-transform:uppercase;">Sin Contar</div>
                <div style="font-size:24px;font-weight:900;color:#D97706;margin-top:2px;">${uncountedStores.length}</div>
                <div style="font-size:12px;font-weight:700;color:#B45309;">${uncountedStores[0] ? escapeHtml(cleanSummaryName(uncountedStores[0])) : 'Ninguna'}</div>
              </td>
            </tr>
          </table>

          <div style="font-size:16px;font-weight:900;color:#111827;margin-bottom:10px;">🔴 Sucursales donde Faltó Carne</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #FECACA;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#FEF2F2;font-size:11px;font-weight:800;text-transform:uppercase;color:#991B1B;border-bottom:1px solid #FECACA;">
                <th style="padding:10px 12px;text-align:left;">Sucursal</th>
                <th style="padding:10px 10px;text-align:center;">Debía Sobrar</th>
                <th style="padding:10px 10px;text-align:center;">Capturaron</th>
                <th style="padding:10px 12px;text-align:right;">Faltante</th>
              </tr>
            </thead>
            <tbody>${shortageRowsHtml}</tbody>
          </table>

          ${uncountedHtml}

          <div style="margin-top:22px;">
            <div style="font-size:14px;font-weight:800;color:#065F46;margin-bottom:8px;">✅ Sucursales en Regla (${okStores.length} tiendas sin pérdida de bolsas)</div>
            <div>${okPillsHtml}</div>
          </div>

          <div style="text-align:center;margin:26px 0 6px 0;">
            <a href="${escapeHtml(linkUrl)}" target="_blank" style="display:inline-block;background:#111827;color:#FFFFFF;font-size:14px;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:10px;">
              Ver Detalle Día por Día en el Sistema ➔
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;padding:12px 24px;font-size:11px;color:#6B7280;text-align:center;border-top:1px solid #E5E7EB;">
          Tacos Gavilan · Enviado únicamente a ${escapeHtml(recipientEmail)}
        </td>
      </tr>
    </table>
  </body></html>`

  return { subject, html, shortageCount: shortageStores.length, totalShortageUsd }
}

export async function sendSobrantesExecutiveDigest(params: {
  ingredientName: string
  startDate: string
  endDate: string
  meter: UnifiedMeterResult
  rawTestTo?: string | null
}) {
  const recipientCheck = validateTestToEmail(params.rawTestTo)
  const targetEmail = recipientCheck.email || 'carlos@tacosgavilan.com'
  const built = buildSobrantesExecutiveEmailHtml({ ...params, recipientEmail: targetEmail })
  const mailRes = await sendSystemEmail({
    fromName: 'Tacos Gavilan · Sobrantes',
    to: [targetEmail],
    subject: built.subject,
    html: built.html,
  })
  return { ...built, to: targetEmail, mailRes }
}
