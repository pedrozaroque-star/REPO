/**
 * @module lib/inventory/sobrantes-executive-email
 * @description Plantilla ejecutiva semanal (Lunes a Domingo) para el correo de Control de Sobrantes
 *   vs. Ventas Toast POS en las 15 sucursales de Tacos Gavilan, despachado automáticamente todos los
 *   lunes a las 10:00 AM hora California (`America/Los_Angeles`) desde `noreply@tacosgavilan.com`.
 *
 * @businessRules
 *   - **Ventana semanal oficial**: Semana completa inmediata anterior **Lunes a Domingo** (`getPreviousCompletedWeekMonSunLA`).
 *   - **Desglose jerárquico obligatorio (`Supervisor → Sucursal → Día`)**:
 *     1. Tres tarjetas ejecutivas KPI arriba (`Con Faltante`, `En Regla`, `Sin Contar`) + resumen por Supervisor.
 *     2. Agrupación alfabética por Supervisor Regional (`Estefani Duran`, `Javier Pastor`, `Ricardo Velazquez`, `Willian Aguilar`).
 *     3. Dentro de cada Supervisor, desglose de todas sus sucursales (primero con faltante, luego en regla, luego sin conteo),
 *        y dentro de cada sucursal el detalle exacto **día por día** (`Lun`, `Mar`, `Mié`, `Jue`, `Vie`, `Sáb + Dom`)
 *        conciliado exactamente con el tramo telescópico medido (`anchorDate >= t0`) para identificar en qué días exactos
 *        ocurrió cada faltante en lugar de mostrar solo un promedio aproximado.
 *     4. Resalta en rojo suave las filas de días con faltante (`<= -1.0` bolsa), marca días agrupados por falta de conteo
 *        intermedio (`isBridgedMultiDay`) y alerta posibles rebotes de conteo (`reboundSuspected`).
 *   - **Tamaño seguro anti-recorte Gmail**: HTML compacto en tablas inline (`< 95 KB`) para evitar el corte `[Message clipped]` de Gmail.
 *   - **Remitente institucional**: estrictamente `noreply@tacosgavilan.com` (`Sistema de Monitoreo`) vía `sendSystemEmail()`.
 *   - Durante la Semana de Pruebas Privadas (`isPortionAlertsWeeklyTestMode()`) envía 100% en exclusiva a `carlos@tacosgavilan.com`.
 *
 * @dataFlow
 *   `/api/cron/weekly-sobrantes-digest` (Lunes 10:00 AM LA) -> `computeToastVsFridgeForIngredient()`
 *   -> `buildSobrantesExecutiveEmailHtml()` -> `sendSystemEmail()` (`noreply@tacosgavilan.com`).
 *
 * @notes
 *   - [2026-11-27] Migrado de correo diario móvil de 7 días (promedio `~X/día`) a reporte semanal oficial
 *     Lunes–Domingo enviado los lunes a las 10:00 AM con desglose completo `Supervisor → Sucursal → Día`.
 */

import {
  addDaysIso,
  formatSignedUSD,
  getBusinessDateLA,
} from '@/lib/inventory/food-cost-sales-resolver'
import { resolveAppBaseUrl } from '@/lib/basecamp-todo-email'
import {
  formatShortDateLabelEs,
  type FridgeLedgerIntervalEntry,
  type StoreFridgeVsToastSummary,
  type computeToastVsFridgeForIngredient,
} from '@/lib/inventory/toast-meat-sold-resolver'
import { sendSystemEmail } from '@/lib/system-mailer'
import {
  compareStoreNamesAlphabetically,
  formatStoreDisplayName,
} from '@/lib/store-display'
import { validateTestToEmail } from '@/lib/inventory/portion-control-alerts'

export type UnifiedMeterResult = Awaited<ReturnType<typeof computeToastVsFridgeForIngredient>>

function escapeHtml(val: string): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function round1(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round(val * 10) / 10
}

function formatBags1(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—'
  const rounded = round1(val)
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1)
}

/**
 * Devuelve el rango exacto de la última semana completa **Lunes a Domingo** en hora de California
 * (`America/Los_Angeles`).
 * - Ejemplo: Lunes `2026-11-30` -> `{ startDate: '2026-11-23', endDate: '2026-11-29' }` (Lun 23 Nov al Dom 29 Nov).
 * - Ejemplo: Viernes `2026-11-27` -> `{ startDate: '2026-11-16', endDate: '2026-11-22' }` (Lun 16 Nov al Dom 22 Nov).
 * - Ejemplo: Domingo `2026-11-29` (día aún abierto) -> `{ startDate: '2026-11-16', endDate: '2026-11-22' }`.
 */
export function getPreviousCompletedWeekMonSunLA(refDate = new Date()): {
  startDate: string
  endDate: string
  todayBusinessDateLA: string
} {
  const todayBusinessDateLA = getBusinessDateLA(refDate)
  const dow = new Date(`${todayBusinessDateLA}T12:00:00Z`).getUTCDay() // 0=Dom, 1=Lun .. 6=Sáb
  // Si hoy es lunes (1), el domingo cerrado fue ayer (-1); si es domingo (0), el último domingo cerrado fue hace 7 días (-7).
  const daysBackToLastClosedSunday = dow === 0 ? 7 : dow
  const endDate = addDaysIso(todayBusinessDateLA, -daysBackToLastClosedSunday)
  const startDate = addDaysIso(endDate, -6)
  return { startDate, endDate, todayBusinessDateLA }
}

/**
 * Filtra las entradas del `dailyLedger` que pertenecen exactamente al tramo telescópico medido `[t0, t1]`
 * (más eventuales filas pendientes al final) para garantizar que la suma de días cuadre 100% con el total semanal.
 */
export function getReconciledWeeklyLedgerEntries(
  summary: StoreFridgeVsToastSummary
): FridgeLedgerIntervalEntry[] {
  if (!Array.isArray(summary.dailyLedger) || summary.dailyLedger.length === 0) return []
  if (!summary.t0) return summary.dailyLedger
  return summary.dailyLedger.filter(
    (entry) =>
      entry.status === 'pending_count' ||
      !entry.anchorDate ||
      entry.anchorDate >= summary.t0!
  )
}

function classifyStoreWeeklyState(s: StoreFridgeVsToastSummary): 'shortage' | 'uncounted' | 'ok' {
  if (!s.hasMeasuredSpan || s.hasNegativeCountAnomaly) return 'uncounted'
  if ((s.cumulativeFridgeBalanceBags ?? 0) <= -1) return 'shortage'
  return 'ok'
}

export function buildSobrantesExecutiveEmailHtml(params: {
  ingredientName: string
  startDate: string
  endDate: string
  meter: UnifiedMeterResult
  dashboardUrl?: string
  recipientEmail?: string
  supervisorNameByStoreId?: Map<number, string>
}): {
  subject: string
  html: string
  shortageCount: number
  totalShortageUsd: number
  totalMissingBags: number
  htmlBytes: number
} {
  const { ingredientName, startDate, endDate, meter, supervisorNameByStoreId } = params
  const recipientEmail = params.recipientEmail || 'carlos@tacosgavilan.com'
  const baseUrl = resolveAppBaseUrl()
  const normIng = ingredientName.toLowerCase()
  const meatSlug = normIng.includes('pastor')
    ? 'pastor'
    : normIng.includes('pollo')
      ? 'pollo'
      : normIng.includes('cabeza')
        ? 'cabeza'
        : normIng.includes('lengua')
          ? 'lengua'
          : normIng.includes('chorizo')
            ? 'chorizo'
            : normIng.includes('carnitas')
              ? 'carnitas'
              : normIng.includes('buche')
                ? 'buche'
                : 'asada'

  const linkUrl =
    params.dashboardUrl ||
    `${baseUrl}/admin/food-cost/meats?storeId=all&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&meat=${meatSlug}`

  const startLabel = formatShortDateLabelEs(startDate)
  const endLabel = formatShortDateLabelEs(endDate)
  const rangeLabel = `${startLabel} al ${endLabel}`

  const cleanSummaryName = (s: { storeId: number | string; storeName: string }) =>
    formatStoreDisplayName({ id: s.storeId, name: s.storeName }) || s.storeName

  const resolveSupervisorName = (s: StoreFridgeVsToastSummary): string => {
    const override = supervisorNameByStoreId?.get(Number(s.storeId))
    const raw = (override || s.supervisorName || '').trim()
    return raw || 'Sin Supervisor Asignado'
  }

  const shortageStores = meter.storesSummaries.filter((s) => classifyStoreWeeklyState(s) === 'shortage')
  const uncountedStores = meter.storesSummaries.filter((s) => classifyStoreWeeklyState(s) === 'uncounted')
  const okStores = meter.storesSummaries.filter((s) => classifyStoreWeeklyState(s) === 'ok')

  const totalMissingBags = round1(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceBags || 0), 0)
  )
  const totalShortageUsd = Math.round(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceDollarStore || 0), 0)
  )

  // Agrupar las 15 sucursales por Supervisor (A–Z)
  const bySupervisorMap = new Map<string, StoreFridgeVsToastSummary[]>()
  for (const s of meter.storesSummaries) {
    const supName = resolveSupervisorName(s)
    const list = bySupervisorMap.get(supName) || []
    list.push(s)
    bySupervisorMap.set(supName, list)
  }

  const supervisorGroups = Array.from(bySupervisorMap.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
    .map(([supervisorName, stores]) => {
      // Dentro de cada supervisor: primero tiendas con faltante (mayor pérdida primero), luego en regla A-Z, luego sin conteo A-Z
      const orderedStores = [...stores].sort((a, b) => {
        const rank = (x: StoreFridgeVsToastSummary) => {
          const st = classifyStoreWeeklyState(x)
          if (st === 'shortage') return 0
          if (st === 'uncounted') return 1
          return 2
        }
        const ra = rank(a)
        const rb = rank(b)
        if (ra !== rb) return ra - rb
        if (ra === 0) {
          const diff = (a.cumulativeFridgeBalanceBags ?? 0) - (b.cumulativeFridgeBalanceBags ?? 0)
          if (Math.abs(diff) > 0.01) return diff
        }
        return compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b))
      })

      const supShortageStores = orderedStores.filter((s) => classifyStoreWeeklyState(s) === 'shortage')
      const supUncountedStores = orderedStores.filter((s) => classifyStoreWeeklyState(s) === 'uncounted')
      const supMissingBags = round1(
        supShortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceBags || 0), 0)
      )
      const supShortageUsd = Math.round(
        supShortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceDollarStore || 0), 0)
      )

      return {
        supervisorName,
        stores: orderedStores,
        shortageCount: supShortageStores.length,
        uncountedCount: supUncountedStores.length,
        missingBags: supMissingBags,
        shortageUsd: supShortageUsd,
      }
    })

  // Tarjeta resumen rápido por supervisor
  const supervisorOverviewRows = supervisorGroups
    .map((g) => {
      const hasShortage = g.shortageCount > 0
      const statusBadge = hasShortage
        ? `<span style="color:#DC2626;font-weight:800;">🔴 ${g.shortageCount}/${g.stores.length} con faltante (-${formatBags1(g.missingBags)} bolsas · -$${g.shortageUsd.toLocaleString('en-US')})</span>`
        : g.uncountedCount > 0
          ? `<span style="color:#B45309;font-weight:700;">⚠️ ${g.uncountedCount} sin conteo · 0 con faltante</span>`
          : `<span style="color:#059669;font-weight:800;">✅ ${g.stores.length}/${g.stores.length} en regla</span>`
      return `<tr style="border-bottom:1px solid #E5E7EB;">
        <td style="padding:7px 10px;font-size:13px;font-weight:800;color:#111827;">${escapeHtml(g.supervisorName)}</td>
        <td style="padding:7px 10px;font-size:12px;text-align:right;">${statusBadge}</td>
      </tr>`
    })
    .join('')

  // Render por Supervisor -> Sucursal -> Día
  const supervisorSectionsHtml = supervisorGroups
    .map((grp) => {
      const supBannerBg = grp.shortageCount > 0 ? '#7F1D1D' : '#1E293B'
      const supSummaryTag =
        grp.shortageCount > 0
          ? `${grp.shortageCount} ${grp.shortageCount === 1 ? 'tienda' : 'tiendas'} con faltante · -${formatBags1(grp.missingBags)} bolsas (-$${grp.shortageUsd.toLocaleString('en-US')})`
          : grp.uncountedCount > 0
            ? `0 con faltante · ${grp.uncountedCount} pendiente de conteo`
            : `Todas sus sucursales en regla (${grp.stores.length})`

      const storeBlocksHtml = grp.stores
        .map((s) => {
          const storeClean = cleanSummaryName(s)
          const state = classifyStoreWeeklyState(s)
          const storeUrl = `${baseUrl}/admin/food-cost/meats?storeId=${encodeURIComponent(String(s.storeId))}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&meat=${meatSlug}`
          const ledger = getReconciledWeeklyLedgerEntries(s)
          const deficitDaysCount = ledger.filter(
            (d) =>
              d.status !== 'pending_count' &&
              !d.hasNegativeCountAnomaly &&
              (d.fridgeBalanceBags ?? 0) <= -1
          ).length

          const borderCol =
            state === 'shortage'
              ? '#FCA5A5'
              : state === 'uncounted'
                ? '#FCD34D'
                : deficitDaysCount > 0
                  ? '#FDBA74'
                  : '#D1FAE5'

          const headerBg =
            state === 'shortage'
              ? '#FEF2F2'
              : state === 'uncounted'
                ? '#FFFBEB'
                : deficitDaysCount > 0
                  ? '#FFF7ED'
                  : '#F0FDF4'

          const badgeHtml =
            state === 'shortage'
              ? `<span style="color:#DC2626;font-weight:900;font-size:12px;">🔴 Faltaron ${formatBags1(Math.abs(s.cumulativeFridgeBalanceBags || 0))} bolsas (${formatSignedUSD(-Math.round(Math.abs(s.cumulativeFridgeBalanceDollarStore || 0)), { decimals: 0 })})</span>`
              : state === 'uncounted'
                ? `<span style="color:#B45309;font-weight:800;font-size:12px;">${s.hasNegativeCountAnomaly ? '⚠️ Error de conteo físico' : '⚠️ Sin conteo semanal'}</span>`
                : deficitDaysCount > 0
                  ? `<span style="color:#C2410C;font-weight:800;font-size:12px;">✅ Semana +${formatBags1(s.cumulativeFridgeBalanceBags)} · ⚠️ ${deficitDaysCount} ${deficitDaysCount === 1 ? 'día' : 'días'} con faltante</span>`
                  : `<span style="color:#059669;font-weight:800;font-size:12px;">✅ En regla (+${formatBags1(s.cumulativeFridgeBalanceBags)} bolsas)</span>`

          const prevSunday = addDaysIso(startDate, -1)
          const partialSpanNote =
            s.hasMeasuredSpan && s.t0 && s.t0 > prevSunday
              ? `<div style="font-size:11px;color:#92400E;margin-top:2px;">Nota: Medido desde ${escapeHtml(formatShortDateLabelEs(addDaysIso(s.t0, 1)))} (${s.spanDays}d) por falta de conteo el ${escapeHtml(formatShortDateLabelEs(prevSunday))}.</div>`
              : ''

          if (!s.hasMeasuredSpan || ledger.length === 0) {
            return `<div style="margin:10px 0;border:1px solid ${borderCol};border-radius:10px;overflow:hidden;">
              <div style="background:${headerBg};padding:9px 12px;">
                <table width="100%" cellpadding="0" cellspacing="0"><tr>
                  <td style="font-size:14px;font-weight:900;color:#111827;"><a href="${escapeHtml(storeUrl)}" target="_blank" style="color:#111827;text-decoration:underline;">${escapeHtml(storeClean)}</a></td>
                  <td style="text-align:right;">${badgeHtml}</td>
                </tr></table>
              </div>
              <div style="padding:9px 12px;font-size:12px;color:#78350F;background:#FFFFFF;">
                Sin capturas manuales suficientes en Orden Diaria durante la semana (Ventas Toast: <strong>${formatBags1(s.toastSoldWindowBags)} bolsas</strong>).
              </div>
            </div>`
          }

          const dayRowsHtml = ledger
            .map((entry) => {
              const bal = entry.fridgeBalanceBags
              const isPending = entry.status === 'pending_count'
              const isAnomaly = entry.hasNegativeCountAnomaly
              const isDeficit = !isPending && !isAnomaly && bal !== null && bal <= -1
              const isMinorNeg = !isPending && !isAnomaly && bal !== null && bal < -0.25 && bal > -1
              const rowClass = isDeficit
                ? ' class="r-def"'
                : isAnomaly
                  ? ' class="r-anm"'
                  : isMinorNeg
                    ? ' class="r-min"'
                    : ''

              const flags: string[] = []
              if (entry.isBridgedMultiDay) flags.push('sin conteo previo')
              if (entry.reboundSuspected) flags.push('posible rebote')
              const dayNote =
                flags.length > 0 ? ` <span class="dn">(${escapeHtml(flags.join(' · '))})</span>` : ''

              let diffCellHtml = '<span class="cm">Pendiente</span>'
              let usdCellHtml = '<span class="cm">—</span>'
              if (isAnomaly) {
                diffCellHtml = '<span class="ca">⚠️ Error conteo</span>'
                usdCellHtml = '<span class="ca">Revisar</span>'
              } else if (!isPending && bal !== null) {
                if (isDeficit) {
                  diffCellHtml = `<span class="cd">Faltan ${formatBags1(Math.abs(bal))}</span>`
                  usdCellHtml = `<span class="cd">${formatSignedUSD(-Math.round(Math.abs(entry.fridgeBalanceDollarStore || 0)), { decimals: 0 })}</span>`
                } else if (isMinorNeg) {
                  diffCellHtml = `<span class="cw">-${formatBags1(Math.abs(bal))}</span>`
                  usdCellHtml = `<span class="cw">${formatSignedUSD(-Math.round(Math.abs(entry.fridgeBalanceDollarStore || 0)), { decimals: 0 })}</span>`
                } else {
                  const sign = bal >= 0.05 ? '+' : ''
                  diffCellHtml = `<span class="co">${sign}${formatBags1(bal)}</span>`
                  const roundedUsd = Math.round(entry.fridgeBalanceDollarStore || 0)
                  usdCellHtml = `<span class="cm">${roundedUsd === 0 ? '$0' : formatSignedUSD(roundedUsd, { decimals: 0 })}</span>`
                }
              }

              return `<tr${rowClass}><td class="${isDeficit ? 'dlb' : 'dl'}">${escapeHtml(entry.periodLabel)}${dayNote}</td><td class="dc">${formatBags1(entry.toastSoldBags)}</td><td class="du">${isPending ? '—' : formatBags1(entry.fridgeUsedBags)}</td><td class="dr">${diffCellHtml}</td><td class="dr">${usdCellHtml}</td></tr>`
            })
            .join('')

          const netBal = s.cumulativeFridgeBalanceBags ?? 0
          const netUsd = Math.round(s.cumulativeFridgeBalanceDollarStore || 0)
          const totalBalLabel =
            netBal <= -1
              ? `<span class="cd">Faltan ${formatBags1(Math.abs(netBal))}</span>`
              : netBal < -0.05
                ? `<span class="cw">-${formatBags1(Math.abs(netBal))}</span>`
                : `<span class="co">+${formatBags1(netBal)}</span>`
          const totalUsdLabel =
            netBal <= -1
              ? `<span class="cd">${formatSignedUSD(-Math.abs(netUsd), { decimals: 0 })}</span>`
              : `<span class="cok">${netUsd === 0 ? '$0' : formatSignedUSD(netUsd, { decimals: 0 })}</span>`

          return `<div style="margin:10px 0;border:1px solid ${borderCol};border-radius:10px;overflow:hidden;"><div style="background:${headerBg};padding:8px 10px;border-bottom:1px solid ${borderCol};"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:14px;font-weight:900;color:#111827;"><a href="${escapeHtml(storeUrl)}" target="_blank" style="color:#111827;text-decoration:underline;">${escapeHtml(storeClean)}</a></td><td style="text-align:right;">${badgeHtml}</td></tr></table>${partialSpanNote}</div><table class="dt" width="100%" cellpadding="0" cellspacing="0"><thead><tr><th class="tl">Día / Corte</th><th class="tc">Caja</th><th class="tc">Usaron</th><th class="tr">Bolsas</th><th class="tr">Impacto</th></tr></thead><tbody>${dayRowsHtml}<tr class="rt"><td class="dtl">TOTAL SEMANA (${s.spanDays}d)</td><td class="dtc">${formatBags1(s.toastSoldSpanBags)}</td><td class="dtu">${formatBags1(s.fridgeUsedBags)}</td><td class="dr">${totalBalLabel}</td><td class="dr">${totalUsdLabel}</td></tr></tbody></table></div>`
        })
        .join('')

      return `<div style="margin-top:18px;"><div style="background:${supBannerBg};color:#FFFFFF;padding:10px 14px;border-radius:10px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.4px;color:#FFFFFF;">👔 ${escapeHtml(grp.supervisorName)}</td><td style="font-size:12px;font-weight:700;text-align:right;color:${grp.shortageCount > 0 ? '#FECACA' : '#A7F3D0'};">${escapeHtml(supSummaryTag)}</td></tr></table></div>${storeBlocksHtml}</div>`
    })
    .join('')

  const storeWord = shortageStores.length === 1 ? 'tienda' : 'tiendas'
  const subject =
    shortageStores.length > 0
      ? `📦 Resumen Semanal de Sobrantes (${ingredientName} · ${rangeLabel}): ${shortageStores.length} ${storeWord} con faltante (-$${totalShortageUsd.toLocaleString('en-US')})`
      : `📦 Resumen Semanal de Sobrantes (${ingredientName} · ${rangeLabel}): ${okStores.length} sucursales en regla`

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><style>
.dt{border-collapse:collapse;background:#fff}.dt th{background:#f9fafb;font-size:10px;font-weight:800;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:5px 6px}.dt td{font-size:12px;padding:5px 6px;border-bottom:1px solid #f3f4f6}.tl,.dl,.dlb{text-align:left;padding-left:8px!important}.tc,.dc,.du,.dtc,.dtu{text-align:center}.tr,.dr{text-align:right;padding-right:8px!important}.dl{color:#111827;font-weight:600}.dlb{color:#111827;font-weight:800}.dc{color:#374151}.du{color:#111827;font-weight:700}.r-def{background:#fef2f2}.r-anm{background:#fffbeb}.r-min{background:#fff7ed}.rt{background:#f8fafc}.rt td{border-top:2px solid #e5e7eb;border-bottom:0}.dtl{text-align:left;padding-left:8px!important;font-size:11px!important;font-weight:900;color:#111827}.dtc{font-weight:800;color:#374151}.dtu{font-weight:900;color:#111827}.dn{font-size:10px;color:#92400e;font-weight:700}.cd{color:#dc2626;font-weight:900}.cw{color:#c2410c;font-weight:700}.ca{color:#b45309;font-weight:800}.co{color:#059669;font-weight:700}.cok{color:#065f46;font-weight:800}.cm{color:#6b7280}
</style></head><body style="margin:0;padding:12px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table width="700" align="center" cellpadding="0" cellspacing="0" style="max-width:700px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <tr>
        <td style="background:#111827;color:#FFFFFF;padding:20px 22px;">
          <div style="font-size:11px;font-weight:800;color:#93C5FD;text-transform:uppercase;letter-spacing:0.7px;">REPORTE SEMANAL (LUN–DOM) · DESGLOSE SUPERVISOR / SUCURSAL / DÍA</div>
          <div style="font-size:21px;font-weight:900;margin-top:4px;">📦 Sobrantes de ${escapeHtml(ingredientName)}</div>
          <div style="font-size:13px;color:#D1D5DB;margin-top:4px;">Semana del ${escapeHtml(rangeLabel)} · Ventas Toast vs. Sobrante Capturado</div>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 16px -8px;">
            <tr>
              <td width="34%" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 10px;text-align:center;">
                <div style="font-size:10px;font-weight:800;color:#991B1B;text-transform:uppercase;">Con Faltante</div>
                <div style="font-size:22px;font-weight:900;color:#DC2626;margin-top:2px;">${shortageStores.length}</div>
                <div style="font-size:11px;font-weight:700;color:#B91C1C;">-${formatBags1(totalMissingBags)} bolsas (-$${totalShortageUsd.toLocaleString('en-US')})</div>
              </td>
              <td width="33%" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:12px 10px;text-align:center;">
                <div style="font-size:10px;font-weight:800;color:#065F46;text-transform:uppercase;">En Regla</div>
                <div style="font-size:22px;font-weight:900;color:#059669;margin-top:2px;">${okStores.length}</div>
                <div style="font-size:11px;font-weight:700;color:#047857;">Sin pérdida neta</div>
              </td>
              <td width="33%" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 10px;text-align:center;">
                <div style="font-size:10px;font-weight:800;color:#92400E;text-transform:uppercase;">Sin Contar</div>
                <div style="font-size:22px;font-weight:900;color:#D97706;margin-top:2px;">${uncountedStores.length}</div>
                <div style="font-size:11px;font-weight:700;color:#B45309;">${uncountedStores[0] ? escapeHtml(cleanSummaryName(uncountedStores[0])) : 'Ninguna'}</div>
              </td>
            </tr>
          </table>

          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#1E3A8A;line-height:1.45;">
            🕛 <strong>Regla para cifras exactas:</strong> El conteo diario de <strong>Sobrantes</strong> debe capturarse estrictamente <strong>DESPUÉS DEL CIERRE</strong>. Las filas en <span style="background:#FEF2F2;color:#DC2626;font-weight:800;padding:1px 4px;border-radius:4px;">rojo</span> muestran el día exacto donde faltó carne (Sábado + Domingo se consolidan juntos).
          </div>

          <div style="font-size:13px;font-weight:900;color:#111827;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.4px;">Resumen por Supervisor</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;margin-bottom:6px;">
            <tbody>${supervisorOverviewRows}</tbody>
          </table>

          ${supervisorSectionsHtml}

          <div style="text-align:center;margin:24px 0 6px 0;">
            <a href="${escapeHtml(linkUrl)}" target="_blank" style="display:inline-block;background:#111827;color:#FFFFFF;font-size:14px;font-weight:800;text-decoration:none;padding:12px 24px;border-radius:10px;">
              Abrir Panel Completo de Sobrantes en el Sistema ➔
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;padding:12px 20px;font-size:11px;color:#6B7280;text-align:center;border-top:1px solid #E5E7EB;">
          Tacos Gavilan · Sistema de Monitoreo · Envío automático lunes 10:00 AM (Semana Lun–Dom) · Destinatario: ${escapeHtml(recipientEmail)}
        </td>
      </tr>
    </table>
  </body></html>`

  return {
    subject,
    html,
    shortageCount: shortageStores.length,
    totalShortageUsd,
    totalMissingBags,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
  }
}

export async function sendSobrantesExecutiveDigest(params: {
  ingredientName: string
  startDate: string
  endDate: string
  meter: UnifiedMeterResult
  rawTestTo?: string | null
  supervisorNameByStoreId?: Map<number, string>
}) {
  const recipientCheck = validateTestToEmail(params.rawTestTo)
  const targetEmail = recipientCheck.email || 'carlos@tacosgavilan.com'
  const built = buildSobrantesExecutiveEmailHtml({ ...params, recipientEmail: targetEmail })
  const mailRes = await sendSystemEmail({
    fromName: 'Sistema de Monitoreo',
    to: [targetEmail],
    subject: built.subject,
    html: built.html,
  })
  return { ...built, to: targetEmail, mailRes }
}
