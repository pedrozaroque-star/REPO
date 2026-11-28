/**
 * @module lib/inventory/sobrantes-executive-email
 * @description Plantilla ejecutiva semanal (Lunes a Domingo) bilingüe (`es` / `en`) simplificada y fácil
 *   de escanear para el correo de Control de Sobrantes vs. Ventas Toast POS en las 15 sucursales de
 *   Tacos Gavilan, despachado automáticamente todos los lunes a las 10:00 AM hora California
 *   (`America/Los_Angeles`) desde `noreply@tacosgavilan.com`.
 *
 * @businessRules
 *   - **Ventana semanal oficial**: Semana completa inmediata anterior **Lunes a Domingo** (`getPreviousCompletedWeekMonSunLA`).
 *   - **Distribución Semanal Oficial (Lunes 10:00 AM LA — `sendWeeklySobrantesFullDistribution`)**:
 *     1. **1 correo personalizado por cada Supervisor Regional** con **ÚNICAMENTE sus 3–4 sucursales**:
 *        - `Estefani Duran` (`estefani@tacosgavilan.com` — **Inglés `EN`** automático): `Azusa`, `Rialto`, `West Covina`.
 *        - `Javier Pastor` (`javier@tacosgavilan.com` — **Español `ES`**): `Hollywood`, `LA Broadway`, `LA Central`, `Slauson`.
 *        - `Ricardo Velazquez` (`ricardo@tacosgavilan.com` — **Español `ES`**): `Huntington Park`, `La Puente`, `Norwalk`, `Santa Ana`.
 *        - `Willian Aguilar` (`willian@tacosgavilan.com` — **Español `ES`**): `Bell`, `Downey`, `Lynwood`, `South Gate`.
 *        - Destinatarios en cada correo de Supervisor: `To: [supervisorEmail]`, `CC: [gonzalo@tacosgavilan.com]`, `BCC: [carlos@tacosgavilan.com]` (nunca expone `carlos@` en `From:` ni en `CC:`).
 *     2. **1 Resumen Ejecutivo Consolidado de las 15 Sucursales (`ES`)**:
 *        - `To: [carlos@tacosgavilan.com]`, `CC: [gonzalo@tacosgavilan.com]`.
 *   - **Soporte Bilingüe Nativo (`es` / `en`)**:
 *     * `resolveSobrantesEmailLang()` detecta automáticamente idioma inglés (`en`) para destinatarios
 *       angloparlantes (`estefani@tacosgavilan.com` — Estefani Duran) o mediante parámetro explícito `lang: 'en' | 'es'`.
 *     * Formatea fechas, encabezados, columnas, avisos y totales 100% en el idioma elegido (cero mezcla de idiomas).
 *   - **Diseño ejecutivo simple y accionable (cero ruido)**:
 *     1. Tres tarjetas KPI arriba (`Con Faltante / Short`, `En Regla / On Track`, `Sin Contar / Uncounted`) +
 *        aviso corto de conteo **DESPUÉS DEL CIERRE / AFTER CLOSING**.
 *     2. **Desglose `Supervisor → Sucursal → Día` ÚNICAMENTE para las tiendas con faltante semanal**,
 *        con tabla limpia de 4 columnas (`Día / Day | Caja / Usó / POS / Used | Diferencia / Variance | Costo / Cost`)
 *        conciliada al decimal con el tramo telescópico medido (`anchorDate >= t0`), resaltando en rojo los
 *        días exactos con faltante (`<= -1.0` bolsa).
 *     3. **Bloque compacto de tiendas sin conteo** (solo si existen).
 *     4. **Tiendas En Regla en pastillas verdes** + nota discreta de 1 línea solo si alguna tienda en regla
 *        tuvo un pico aislado `<= -5` bolsas.
 *   - **Tamaño ultra-ligero anti-recorte Gmail**: HTML compacto (`~8–18 KB`, muy lejos del límite `102 KB` de Gmail).
 *   - **Remitente institucional**: estrictamente `noreply@tacosgavilan.com` (`Sistema de Monitoreo` / `Monitoring System`) vía `sendSystemEmail()`.
 *
 * @dataFlow
 *   `/api/cron/weekly-sobrantes-digest` (Lunes 10:00 AM LA) -> `computeToastVsFridgeForIngredient()`
 *   -> `sendWeeklySobrantesFullDistribution()` -> `buildSobrantesExecutiveEmailHtml()` -> `sendSystemEmail()` (`noreply@tacosgavilan.com`).
 *
 * @notes
 *   - [2026-11-27] Migrado de correo diario móvil de 7 días (promedio `~X/día`) a reporte semanal oficial
 *     Lunes–Domingo enviado los lunes a las 10:00 AM con desglose `Supervisor → Sucursal → Día`.
 *   - [2026-11-27] Simplificado visualmente + soporte bilingüe nativo `ES`/`EN` + distribución semanal por
 *     Supervisor (Estefani en `EN`, resto en `ES`) con `CC: gonzalo@tacosgavilan.com` y `BCC: carlos@tacosgavilan.com`,
 *     más Resumen Consolidado de las 15 sucursales para Carlos con `CC: gonzalo@tacosgavilan.com`.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import {
  addDaysIso,
  formatSignedUSD,
  getBusinessDateLA,
  isValidIsoDate,
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
import {
  CORPORATE_EMAIL_GUARD_REGEX,
  normalizeCorporateEmail,
} from '@/lib/inventory/portion-control-alerts'

export type UnifiedMeterResult = Awaited<ReturnType<typeof computeToastVsFridgeForIngredient>>
export type SobrantesEmailLang = 'es' | 'en'

export const CARLOS_EXEC_EMAIL = 'carlos@tacosgavilan.com'
export const GONZALO_CC_EMAIL = 'gonzalo@tacosgavilan.com'

/** Destinatarios corporativos cuya preferencia oficial de correo es Inglés (`en`). */
export const ENGLISH_PREFERRED_RECIPIENT_EMAILS = new Set<string>([
  'estefani@tacosgavilan.com',
])

const SHORT_WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
 * Valida `?test_to=` exclusivamente para el Resumen Semanal de Sobrantes (sin bloquear el envío live
 * de los lunes con el viejo candado `PORTION_ALERTS_LIVE_RECIPIENTS` de `#3`/`#7`).
 * - Si no se pasa `rawTestTo`, devuelve `{ valid: true, email: null }` (modo distribución semanal real).
 * - Si se pasa `rawTestTo`, exige dominio corporativo `@tacosgavilan.com`.
 */
export function validateWeeklyDigestTestTo(rawTestTo?: string | null): {
  valid: boolean
  email: string | null
  error?: string
} {
  if (!rawTestTo || String(rawTestTo).trim() === '') {
    return { valid: true, email: null }
  }
  const clean = String(rawTestTo).trim().toLowerCase()
  if (!CORPORATE_EMAIL_GUARD_REGEX.test(clean)) {
    return {
      valid: false,
      email: null,
      error: 'El parámetro test_to debe ser exclusivamente un correo corporativo @tacosgavilan.com',
    }
  }
  const normalized = normalizeCorporateEmail(clean)
  if (!normalized) {
    return { valid: false, email: null, error: 'Correo corporativo inválido en test_to' }
  }
  return { valid: true, email: normalized }
}

export function resolveSobrantesEmailLang(
  recipientEmail?: string | null,
  explicitLang?: string | null
): SobrantesEmailLang {
  const normExplicit = String(explicitLang || '').trim().toLowerCase()
  if (normExplicit === 'en') return 'en'
  if (normExplicit === 'es') return 'es'
  const normRecipient = String(recipientEmail || '').trim().toLowerCase()
  if (normRecipient && ENGLISH_PREFERRED_RECIPIENT_EMAILS.has(normRecipient)) return 'en'
  return 'es'
}

export function formatShortDateLabelEn(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate
  const d = new Date(`${isoDate}T12:00:00Z`)
  const dow = SHORT_WEEKDAYS_EN[d.getUTCDay()] || ''
  const mon = SHORT_MONTHS_EN[d.getUTCMonth()] || ''
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${dow} ${mon} ${day}`
}

function formatShortDateForLang(isoDate: string, lang: SobrantesEmailLang): string {
  return lang === 'en' ? formatShortDateLabelEn(isoDate) : formatShortDateLabelEs(isoDate)
}

function formatIngredientNameForLang(ingredientName: string, lang: SobrantesEmailLang): string {
  if (lang !== 'en') return ingredientName
  const norm = ingredientName.toLowerCase()
  if (norm.includes('asada')) return 'Carne Asada'
  if (norm.includes('pastor')) return 'Al Pastor'
  if (norm.includes('pollo')) return 'Chicken (Pollo)'
  if (norm.includes('cabeza')) return 'Beef Head (Cabeza)'
  if (norm.includes('lengua')) return 'Beef Tongue (Lengua)'
  if (norm.includes('carnitas')) return 'Carnitas'
  if (norm.includes('buche')) return 'Buche'
  if (norm.includes('chorizo')) return 'Chorizo'
  return ingredientName
}

function formatLedgerPeriodLabel(entry: FridgeLedgerIntervalEntry, lang: SobrantesEmailLang): string {
  if (lang !== 'en') return entry.periodLabel
  if (entry.status === 'pending_count') {
    return entry.spanDays === 1
      ? `${formatShortDateLabelEn(entry.endDate)} (Pending close)`
      : `${formatShortDateLabelEn(entry.startDate)} – ${formatShortDateLabelEn(entry.endDate)} (No closing count)`
  }
  if (entry.spanDays === 1) return formatShortDateLabelEn(entry.endDate)
  if (entry.isWeekendPair) {
    return `${formatShortDateLabelEn(entry.startDate)} + ${formatShortDateLabelEn(entry.endDate)}`
  }
  return `${formatShortDateLabelEn(entry.startDate)} – ${formatShortDateLabelEn(entry.endDate)} (${entry.spanDays}d)`
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
  lang?: SobrantesEmailLang
  /** Si se define, renderiza el correo enfocado exclusivamente a la zona de ese supervisor (sin barras duplicadas). */
  scopedSupervisorName?: string | null
  /** Lista opcional de `storesSummaries` ya filtradas para un supervisor específico. */
  scopedStoreSummaries?: StoreFridgeVsToastSummary[]
}): {
  subject: string
  html: string
  lang: SobrantesEmailLang
  shortageCount: number
  totalShortageUsd: number
  totalMissingBags: number
  storesCount: number
  htmlBytes: number
} {
  const { ingredientName, startDate, endDate, meter, supervisorNameByStoreId } = params
  const recipientEmail = params.recipientEmail || CARLOS_EXEC_EMAIL
  const lang = resolveSobrantesEmailLang(recipientEmail, params.lang)
  const isEn = lang === 'en'
  const displayIngredient = formatIngredientNameForLang(ingredientName, lang)
  const scopedSupName = params.scopedSupervisorName?.trim() || null
  const isSingleSupervisorView = Boolean(scopedSupName)
  const activeSummaries = params.scopedStoreSummaries ?? meter.storesSummaries

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

  const startLabel = formatShortDateForLang(startDate, lang)
  const endLabel = formatShortDateForLang(endDate, lang)
  const rangeLabel = isEn ? `${startLabel} – ${endLabel}` : `${startLabel} al ${endLabel}`
  const prevSunday = addDaysIso(startDate, -1)

  const bagsWord = isEn ? 'bags' : 'bolsas'
  const storeWordFor = (n: number) => (isEn ? (n === 1 ? 'store' : 'stores') : n === 1 ? 'tienda' : 'tiendas')

  const cleanSummaryName = (s: { storeId: number | string; storeName: string }) =>
    formatStoreDisplayName({ id: s.storeId, name: s.storeName }) || s.storeName

  const resolveSupervisorName = (s: StoreFridgeVsToastSummary): string => {
    const override = supervisorNameByStoreId?.get(Number(s.storeId))
    const raw = (override || s.supervisorName || '').trim()
    return raw || (isEn ? 'Unassigned Supervisor' : 'Sin Supervisor')
  }

  const shortageStores = activeSummaries.filter((s) => classifyStoreWeeklyState(s) === 'shortage')
  const uncountedStores = activeSummaries.filter((s) => classifyStoreWeeklyState(s) === 'uncounted')
  const okStores = activeSummaries.filter((s) => classifyStoreWeeklyState(s) === 'ok')

  const totalMissingBags = round1(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceBags || 0), 0)
  )
  const totalShortageUsd = Math.round(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceDollarStore || 0), 0)
  )

  const renderStoreShortageCard = (s: StoreFridgeVsToastSummary): string => {
    const storeClean = cleanSummaryName(s)
    const storeUrl = `${baseUrl}/admin/food-cost/meats?storeId=${encodeURIComponent(String(s.storeId))}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&meat=${meatSlug}`
    const ledger = getReconciledWeeklyLedgerEntries(s)
    const missingBags = Math.abs(s.cumulativeFridgeBalanceBags || 0)
    const lossUsd = Math.round(Math.abs(s.cumulativeFridgeBalanceDollarStore || 0))

    const partialSpanNote =
      s.hasMeasuredSpan && s.t0 && s.t0 > prevSunday
        ? `<div style="font-size:11px;color:#92400E;margin-top:2px;">${
            isEn
              ? `Measured ${s.spanDays} days (missing count on ${escapeHtml(formatShortDateForLang(prevSunday, 'en'))}).`
              : `Medido ${s.spanDays} días (faltó conteo el ${escapeHtml(formatShortDateForLang(prevSunday, 'es'))}).`
          }</div>`
        : ''

    const dayRowsHtml = ledger
      .map((entry) => {
        const bal = entry.fridgeBalanceBags
        const isPending = entry.status === 'pending_count'
        const isAnomaly = entry.hasNegativeCountAnomaly
        const isDeficit = !isPending && !isAnomaly && bal !== null && bal <= -1
        const isMinorNeg = !isPending && !isAnomaly && bal !== null && bal < -0.25 && bal > -1
        const rowClass = isDeficit ? ' class="r-def"' : isAnomaly ? ' class="r-anm"' : ''

        const flags: string[] = []
        if (entry.isBridgedMultiDay) flags.push(isEn ? 'missing prior count' : 'sin conteo previo')
        if (entry.reboundSuspected) flags.push(isEn ? 'rebound' : 'rebote')
        const dayNote =
          flags.length > 0 ? ` <span class="dn">(${escapeHtml(flags.join(' · '))})</span>` : ''

        const soldUsed = `${formatBags1(entry.toastSoldBags)} / ${isPending ? '—' : formatBags1(entry.fridgeUsedBags)}`

        let diffHtml = `<span class="cm">${isEn ? 'Pending' : 'Pendiente'}</span>`
        let costHtml = '<span class="cm">—</span>'
        if (isAnomaly) {
          diffHtml = `<span class="ca">${isEn ? 'Count error' : 'Error conteo'}</span>`
          costHtml = `<span class="ca">${isEn ? 'Review' : 'Revisar'}</span>`
        } else if (!isPending && bal !== null) {
          if (isDeficit) {
            diffHtml = `<span class="cd">-${formatBags1(Math.abs(bal))} ${bagsWord}</span>`
            costHtml = `<span class="cd">${formatSignedUSD(-Math.round(Math.abs(entry.fridgeBalanceDollarStore || 0)), { decimals: 0 })}</span>`
          } else if (isMinorNeg) {
            diffHtml = `<span class="cw">-${formatBags1(Math.abs(bal))}</span>`
            costHtml = `<span class="cw">${formatSignedUSD(-Math.round(Math.abs(entry.fridgeBalanceDollarStore || 0)), { decimals: 0 })}</span>`
          } else if (bal >= 2.5 || entry.reboundSuspected) {
            diffHtml = `<span class="co">+${formatBags1(bal)}</span>`
          } else {
            diffHtml = `<span class="co">${isEn ? 'On track' : 'En regla'}</span>`
          }
        }

        const dayLabel = formatLedgerPeriodLabel(entry, lang)
        return `<tr${rowClass}><td class="${isDeficit ? 'dlb' : 'dl'}">${escapeHtml(dayLabel)}${dayNote}</td><td class="dc">${soldUsed}</td><td class="dr">${diffHtml}</td><td class="dr">${costHtml}</td></tr>`
      })
      .join('')

    return `<div style="margin-top:8px;border:1px solid #FECACA;border-radius:10px;overflow:hidden;">
      <div style="background:#FEF2F2;padding:9px 12px;border-bottom:1px solid #FECACA;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:14px;font-weight:900;color:#111827;"><a href="${escapeHtml(storeUrl)}" target="_blank" style="color:#111827;text-decoration:underline;">${escapeHtml(storeClean)}</a></td>
          <td style="text-align:right;font-size:13px;font-weight:900;color:#DC2626;">-${formatBags1(missingBags)} ${bagsWord} (-$${lossUsd.toLocaleString('en-US')})</td>
        </tr></table>${partialSpanNote}
      </div>
      <table class="dt" width="100%" cellpadding="0" cellspacing="0">
        <thead><tr><th class="tl">${isEn ? 'Day' : 'Día'}</th><th class="tc">${isEn ? 'POS / Used' : 'Caja / Usó'}</th><th class="tr">${isEn ? 'Variance' : 'Diferencia'}</th><th class="tr">${isEn ? 'Cost' : 'Costo'}</th></tr></thead>
        <tbody>
          ${dayRowsHtml}
          <tr class="rt">
            <td class="dtl">${isEn ? `Weekly Total (${s.spanDays}d)` : `Total Semana (${s.spanDays}d)`}</td>
            <td class="dtc">${formatBags1(s.toastSoldSpanBags)} / ${formatBags1(s.fridgeUsedBags)}</td>
            <td class="dr"><span class="cd">-${formatBags1(missingBags)} ${bagsWord}</span></td>
            <td class="dr"><span class="cd">-$${lossUsd.toLocaleString('en-US')}</span></td>
          </tr>
        </tbody>
      </table>
    </div>`
  }

  // 1. Sección principal: SOLO sucursales con faltante
  let shortageSectionsHtml = ''
  if (shortageStores.length === 0) {
    shortageSectionsHtml = `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:14px 16px;text-align:center;color:#065F46;font-size:14px;font-weight:800;margin-bottom:16px;">
      ${
        isSingleSupervisorView
          ? isEn
            ? '✅ None of your stores had a shortage this week.'
            : '✅ Ninguna de tus sucursales tuvo faltante esta semana.'
          : isEn
            ? '✅ No stores had a shortage this week.'
            : '✅ Ninguna sucursal tuvo faltante esta semana.'
      }
    </div>`
  } else if (isSingleSupervisorView) {
    const ordered = [...shortageStores].sort((a, b) => {
      const diff = (a.cumulativeFridgeBalanceBags ?? 0) - (b.cumulativeFridgeBalanceBags ?? 0)
      if (Math.abs(diff) > 0.01) return diff
      return compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b))
    })
    shortageSectionsHtml = `<div style="margin-bottom:16px;">${ordered.map(renderStoreShortageCard).join('')}</div>`
  } else {
    const shortageBySup = new Map<string, StoreFridgeVsToastSummary[]>()
    for (const s of shortageStores) {
      const sup = resolveSupervisorName(s)
      const list = shortageBySup.get(sup) || []
      list.push(s)
      shortageBySup.set(sup, list)
    }

    shortageSectionsHtml = Array.from(shortageBySup.entries())
      .sort(([a], [b]) => a.localeCompare(b, isEn ? 'en' : 'es', { sensitivity: 'base' }))
      .map(([supervisorName, stores]) => {
        const ordered = [...stores].sort((a, b) => {
          const diff = (a.cumulativeFridgeBalanceBags ?? 0) - (b.cumulativeFridgeBalanceBags ?? 0)
          if (Math.abs(diff) > 0.01) return diff
          return compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b))
        })
        const supBags = round1(
          ordered.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceBags || 0), 0)
        )
        const supUsd = Math.round(
          ordered.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceDollarStore || 0), 0)
        )
        return `<div style="margin-bottom:16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:7px 12px;">
            <tr>
              <td style="font-size:12px;font-weight:900;color:#111827;text-transform:uppercase;letter-spacing:0.3px;">👔 ${escapeHtml(supervisorName)}</td>
              <td style="font-size:12px;font-weight:800;color:#B91C1C;text-align:right;">${ordered.length} ${storeWordFor(ordered.length)} · -${formatBags1(supBags)} ${bagsWord} (-$${supUsd.toLocaleString('en-US')})</td>
            </tr>
          </table>
          ${ordered.map(renderStoreShortageCard).join('')}
        </div>`
      })
      .join('')
  }

  // 2. Bloque compacto de sucursales sin conteo (solo si hay >= 1)
  const uncountedSectionHtml =
    uncountedStores.length === 0
      ? ''
      : `<div style="margin:14px 0;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:10px 12px;">
          <div style="font-size:12px;font-weight:900;color:#92400E;margin-bottom:6px;">${
            isEn
              ? `⚠️ Missing Counts (${uncountedStores.length})`
              : `⚠️ Sin Conteo Suficiente (${uncountedStores.length})`
          }</div>
          ${[...uncountedStores]
            .sort((a, b) => compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b)))
            .map((s) => {
              const reason = s.hasNegativeCountAnomaly
                ? isEn
                  ? 'Physical count error'
                  : 'Error de conteo físico'
                : isEn
                  ? 'Insufficient daily counts'
                  : 'Sin capturas suficientes'
              const supPart = isSingleSupervisorView ? '' : ` (${escapeHtml(resolveSupervisorName(s))})`
              return `<div style="font-size:12px;color:#78350F;padding:2px 0;">• <strong>${escapeHtml(cleanSummaryName(s))}</strong>${supPart} — ${reason}</div>`
            })
            .join('')}
        </div>`

  // 3. Sucursales en Regla: pastillas verdes compactas
  let okListBodyHtml = ''
  if (isSingleSupervisorView) {
    okListBodyHtml = `<div>${[...okStores]
      .sort((a, b) => compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b)))
      .map(
        (s) =>
          `<span style="display:inline-block;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;font-size:12px;font-weight:700;padding:4px 9px;border-radius:7px;margin:2px 4px 2px 0;">✅ ${escapeHtml(cleanSummaryName(s))}</span>`
      )
      .join('')}</div>`
  } else {
    const okBySup = new Map<string, StoreFridgeVsToastSummary[]>()
    for (const s of okStores) {
      const sup = resolveSupervisorName(s)
      const list = okBySup.get(sup) || []
      list.push(s)
      okBySup.set(sup, list)
    }
    const okRows = Array.from(okBySup.entries())
      .sort(([a], [b]) => a.localeCompare(b, isEn ? 'en' : 'es', { sensitivity: 'base' }))
      .map(([supervisorName, stores]) => {
        const pills = [...stores]
          .sort((a, b) => compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b)))
          .map(
            (s) =>
              `<span style="display:inline-block;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;font-size:12px;font-weight:700;padding:4px 9px;border-radius:7px;margin:2px 4px 2px 0;">✅ ${escapeHtml(cleanSummaryName(s))}</span>`
          )
          .join('')
        return `<tr>
          <td style="padding:6px 0;vertical-align:top;width:155px;font-size:12px;font-weight:800;color:#374151;">${escapeHtml(supervisorName)}</td>
          <td style="padding:4px 0;">${pills}</td>
        </tr>`
      })
      .join('')
    okListBodyHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tbody>${okRows}</tbody></table>`
  }

  // Nota discreta de 1 línea si alguna tienda En Regla tuvo un pico aislado fuerte (<= -5 bolsas) que luego se compensó
  const okSingleDaySpikes: string[] = []
  for (const s of [...okStores].sort((a, b) => compareStoreNamesAlphabetically(cleanSummaryName(a), cleanSummaryName(b)))) {
    const ledger = getReconciledWeeklyLedgerEntries(s)
    const worst = ledger
      .filter((d) => d.status !== 'pending_count' && !d.hasNegativeCountAnomaly && (d.fridgeBalanceBags ?? 0) <= -5)
      .sort((a, b) => (a.fridgeBalanceBags ?? 0) - (b.fridgeBalanceBags ?? 0))[0]
    if (worst && worst.fridgeBalanceBags !== null) {
      okSingleDaySpikes.push(
        `${cleanSummaryName(s)} (${formatLedgerPeriodLabel(worst, lang)}: -${formatBags1(Math.abs(worst.fridgeBalanceBags))})`
      )
    }
  }
  const okSpikeNoteHtml =
    okSingleDaySpikes.length > 0
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #D1D5DB;font-size:11px;color:#6B7280;line-height:1.45;">
          ℹ️ <strong>${
            isEn
              ? 'Single-day swing (balanced out over the week):'
              : 'Variación puntual en 1 día (se compensó en la semana):'
          }</strong> ${escapeHtml(okSingleDaySpikes.join(' · '))}.
        </div>`
      : ''

  const subject = isSingleSupervisorView
    ? shortageStores.length > 0
      ? isEn
        ? `📦 Weekly Leftovers — ${scopedSupName} (${displayIngredient} · ${rangeLabel}): ${shortageStores.length} ${storeWordFor(shortageStores.length)} short (-$${totalShortageUsd.toLocaleString('en-US')})`
        : `📦 Sobrantes Semanales — ${scopedSupName} (${displayIngredient} · ${rangeLabel}): ${shortageStores.length} ${storeWordFor(shortageStores.length)} con faltante (-$${totalShortageUsd.toLocaleString('en-US')})`
      : isEn
        ? `📦 Weekly Leftovers — ${scopedSupName} (${displayIngredient} · ${rangeLabel}): ${okStores.length} ${storeWordFor(okStores.length)} on track`
        : `📦 Sobrantes Semanales — ${scopedSupName} (${displayIngredient} · ${rangeLabel}): ${okStores.length} ${okStores.length === 1 ? 'sucursal' : 'sucursales'} en regla`
    : shortageStores.length > 0
      ? isEn
        ? `📦 Weekly Leftovers Summary (${displayIngredient} · ${rangeLabel}): ${shortageStores.length} ${storeWordFor(shortageStores.length)} short (-$${totalShortageUsd.toLocaleString('en-US')})`
        : `📦 Resumen Semanal de Sobrantes (${displayIngredient} · ${rangeLabel}): ${shortageStores.length} ${storeWordFor(shortageStores.length)} con faltante (-$${totalShortageUsd.toLocaleString('en-US')})`
      : isEn
        ? `📦 Weekly Leftovers Summary (${displayIngredient} · ${rangeLabel}): ${okStores.length} stores on track`
        : `📦 Resumen Semanal de Sobrantes (${displayIngredient} · ${rangeLabel}): ${okStores.length} sucursales en regla`

  const headerKicker = isSingleSupervisorView
    ? isEn
      ? `WEEKLY REPORT (MON–SUN) · ${scopedSupName!.toUpperCase()}`
      : `REPORTE SEMANAL (LUN–DOM) · ${scopedSupName!.toUpperCase()}`
    : isEn
      ? 'WEEKLY REPORT (MON–SUN)'
      : 'REPORTE SEMANAL (LUN–DOM)'

  const headerSubtitle = isSingleSupervisorView
    ? isEn
      ? `Week of ${rangeLabel} · Your ${activeSummaries.length} ${storeWordFor(activeSummaries.length)} (Toast Sales vs. Logged Leftovers)`
      : `Semana del ${rangeLabel} · Tus ${activeSummaries.length} ${activeSummaries.length === 1 ? 'Sucursal' : 'Sucursales'} (Ventas Toast vs. Sobrante Capturado)`
    : isEn
      ? `Week of ${rangeLabel} · Toast Sales vs. Logged Leftovers`
      : `Semana del ${rangeLabel} · Ventas Toast vs. Sobrante Capturado`

  const shortageHeading = isSingleSupervisorView
    ? isEn
      ? '🔴 Stores with Meat Shortage (Day by Day)'
      : '🔴 Sucursales donde Faltó Carne (Día por Día)'
    : isEn
      ? '🔴 Stores with Meat Shortage (by Supervisor & Day)'
      : '🔴 Sucursales donde Faltó Carne (por Supervisor y Día)'

  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><style>
.dt{border-collapse:collapse;background:#fff}.dt th{background:#f9fafb;font-size:10px;font-weight:800;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:6px 8px}.dt td{font-size:12px;padding:6px 8px;border-bottom:1px solid #f3f4f6}.tl,.dl,.dlb{text-align:left}.tc,.dc,.dtc{text-align:center}.tr,.dr{text-align:right}.dl{color:#374151;font-weight:600}.dlb{color:#111827;font-weight:800}.dc{color:#4b5563}.r-def{background:#fef2f2}.r-anm{background:#fffbeb}.rt{background:#f8fafc}.rt td{border-top:2px solid #e5e7eb;border-bottom:0}.dtl{text-align:left;font-size:11px!important;font-weight:900;color:#111827}.dtc{font-weight:800;color:#374151}.dn{font-size:10px;color:#92400e;font-weight:700}.cd{color:#dc2626;font-weight:900}.cw{color:#b45309;font-weight:700}.ca{color:#b45309;font-weight:800}.co{color:#059669;font-weight:700}.cm{color:#9ca3af}
</style></head><body style="margin:0;padding:12px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table width="640" align="center" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <tr>
        <td style="background:#111827;color:#FFFFFF;padding:20px 22px;">
          <div style="font-size:11px;font-weight:800;color:#93C5FD;text-transform:uppercase;letter-spacing:0.7px;">${escapeHtml(headerKicker)}</div>
          <div style="font-size:21px;font-weight:900;margin-top:4px;">${
            isEn ? `📦 ${escapeHtml(displayIngredient)} Leftovers` : `📦 Sobrantes de ${escapeHtml(displayIngredient)}`
          }</div>
          <div style="font-size:13px;color:#D1D5DB;margin-top:4px;">${escapeHtml(headerSubtitle)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 14px -8px;">
            <tr>
              <td width="34%" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 10px;text-align:center;">
                <div style="font-size:10px;font-weight:800;color:#991B1B;text-transform:uppercase;">${isEn ? 'Short' : 'Con Faltante'}</div>
                <div style="font-size:22px;font-weight:900;color:#DC2626;margin-top:2px;">${shortageStores.length}</div>
                <div style="font-size:11px;font-weight:700;color:#B91C1C;">-${formatBags1(totalMissingBags)} ${bagsWord} (-$${totalShortageUsd.toLocaleString('en-US')})</div>
              </td>
              <td width="33%" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:12px 10px;text-align:center;">
                <div style="font-size:10px;font-weight:800;color:#065F46;text-transform:uppercase;">${isEn ? 'On Track' : 'En Regla'}</div>
                <div style="font-size:22px;font-weight:900;color:#059669;margin-top:2px;">${okStores.length}</div>
                <div style="font-size:11px;font-weight:700;color:#047857;">${isEn ? 'No loss' : 'Sin pérdida'}</div>
              </td>
              <td width="33%" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 10px;text-align:center;">
                <div style="font-size:10px;font-weight:800;color:#92400E;text-transform:uppercase;">${isEn ? 'Uncounted' : 'Sin Contar'}</div>
                <div style="font-size:22px;font-weight:900;color:#D97706;margin-top:2px;">${uncountedStores.length}</div>
                <div style="font-size:11px;font-weight:700;color:#B45309;">${
                  uncountedStores[0] ? escapeHtml(cleanSummaryName(uncountedStores[0])) : isEn ? 'None' : 'Ninguna'
                }</div>
              </td>
            </tr>
          </table>

          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:9px 12px;margin-bottom:16px;font-size:12px;color:#1E3A8A;line-height:1.4;">
            ${
              isEn
                ? '🕛 <strong>Rule:</strong> Daily <strong>Leftovers</strong> counts must be entered strictly <strong>AFTER CLOSING</strong>. Rows highlighted in <span style="background:#FEF2F2;color:#DC2626;font-weight:800;padding:1px 4px;border-radius:4px;">red</span> show the exact day the shortage occurred.'
                : '🕛 <strong>Regla:</strong> El conteo de <strong>Sobrantes</strong> debe capturarse estrictamente <strong>DESPUÉS DEL CIERRE</strong>. Las filas en <span style="background:#FEF2F2;color:#DC2626;font-weight:800;padding:1px 4px;border-radius:4px;">rojo</span> muestran el día exacto del faltante.'
            }
          </div>

          <div style="font-size:14px;font-weight:900;color:#111827;margin-bottom:10px;">${escapeHtml(shortageHeading)}</div>
          ${shortageSectionsHtml}

          ${uncountedSectionHtml}

          ${
            okStores.length > 0
              ? `<div style="margin-top:16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;">
                  <div style="font-size:13px;font-weight:900;color:#065F46;margin-bottom:8px;">${
                    isEn
                      ? `✅ Stores on Track (${okStores.length} ${storeWordFor(okStores.length)} with no weekly loss)`
                      : `✅ Sucursales en Regla (${okStores.length} ${storeWordFor(okStores.length)} sin pérdida semanal)`
                  }</div>
                  ${okListBodyHtml}
                  ${okSpikeNoteHtml}
                </div>`
              : ''
          }

          <div style="text-align:center;margin:20px 0 4px 0;">
            <a href="${escapeHtml(linkUrl)}" target="_blank" style="display:inline-block;background:#111827;color:#FFFFFF;font-size:14px;font-weight:800;text-decoration:none;padding:12px 24px;border-radius:10px;">
              ${isEn ? 'View Day-by-Day Details in System ➔' : 'Ver Detalle Día por Día en el Sistema ➔'}
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;padding:12px 20px;font-size:11px;color:#6B7280;text-align:center;border-top:1px solid #E5E7EB;">
          ${
            isEn
              ? `Tacos Gavilan · Monitoring System · Automatic Monday 10:00 AM dispatch (Mon–Sun week) · ${escapeHtml(recipientEmail)}`
              : `Tacos Gavilan · Sistema de Monitoreo · Envío automático lunes 10:00 AM (Semana Lun–Dom) · ${escapeHtml(recipientEmail)}`
          }
        </td>
      </tr>
    </table>
  </body></html>`

  return {
    subject,
    html,
    lang,
    shortageCount: shortageStores.length,
    totalShortageUsd,
    totalMissingBags,
    storesCount: activeSummaries.length,
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
  lang?: SobrantesEmailLang
  scopedSupervisorName?: string | null
  scopedStoreSummaries?: StoreFridgeVsToastSummary[]
  cc?: string[]
  bcc?: string[]
}) {
  const recipientCheck = validateWeeklyDigestTestTo(params.rawTestTo)
  const targetEmail = recipientCheck.email || CARLOS_EXEC_EMAIL
  const resolvedLang = resolveSobrantesEmailLang(targetEmail, params.lang)
  const built = buildSobrantesExecutiveEmailHtml({
    ...params,
    recipientEmail: targetEmail,
    lang: resolvedLang,
  })
  const cleanCc = (params.cc || []).filter((e) => e && e.toLowerCase() !== targetEmail.toLowerCase())
  const cleanBcc = (params.bcc || []).filter(
    (e) =>
      e &&
      e.toLowerCase() !== targetEmail.toLowerCase() &&
      !cleanCc.some((c) => c.toLowerCase() === e.toLowerCase())
  )
  const mailRes = await sendSystemEmail({
    fromName: resolvedLang === 'en' ? 'Monitoring System' : 'Sistema de Monitoreo',
    to: [targetEmail],
    cc: cleanCc.length > 0 ? cleanCc : undefined,
    bcc: cleanBcc.length > 0 ? cleanBcc : undefined,
    subject: built.subject,
    html: built.html,
  })
  return { ...built, to: targetEmail, cc: cleanCc, bcc: cleanBcc, mailRes }
}

export interface SupervisorWeeklyDispatchItem {
  scopeKey: string
  kind: 'supervisor' | 'executive_consolidated'
  supervisorName: string | null
  lang: SobrantesEmailLang
  to: string
  cc: string[]
  bcc: string[]
  storesCount: number
  shortageCount: number
  totalMissingBags: number
  totalShortageUsd: number
  subject: string
  htmlBytes: number
  sent: boolean
  skippedDuplicate?: boolean
  dryRun?: boolean
  messageId?: string
  providerUsed?: string
  error?: string
}

/**
 * Despacha la distribución semanal oficial de todos los lunes a las 10:00 AM LA:
 * - 1 correo personalizado por cada Supervisor Regional (únicamente sus 3–4 tiendas; Estefani Duran en EN,
 *   resto en ES), `CC: gonzalo@tacosgavilan.com`, `BCC: carlos@tacosgavilan.com`.
 * - 1 Resumen Ejecutivo Consolidado de las 15 sucursales (`To: carlos@tacosgavilan.com`, `CC: gonzalo@tacosgavilan.com`).
 */
export async function sendWeeklySobrantesFullDistribution(params: {
  ingredientName: string
  startDate: string
  endDate: string
  meter: UnifiedMeterResult
  dryRun?: boolean
  alreadySentScopes?: Set<string>
  forceResend?: boolean
}): Promise<{
  dispatches: SupervisorWeeklyDispatchItem[]
  sentScopes: string[]
  totalSent: number
  totalFailed: number
}> {
  const { ingredientName, startDate, endDate, meter } = params
  const dryRun = Boolean(params.dryRun)
  const forceResend = Boolean(params.forceResend)
  const alreadySent = params.alreadySentScopes || new Set<string>()

  const supabase = await getSupabaseAdminClient()
  const supervisorIds = Array.from(
    new Set(
      meter.storesSummaries
        .map((s) => s.supervisorId)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0)
    )
  )

  const supEmailById = new Map<number, { email: string; name: string }>()
  if (supervisorIds.length > 0) {
    const { data: supUsers } = await supabase
      .from('users')
      .select('id, full_name, email, google_email_connected, is_active')
      .in('id', supervisorIds)
    for (const u of supUsers || []) {
      if (u.is_active === false) continue
      const email = normalizeCorporateEmail(u.google_email_connected || u.email)
      if (email && CORPORATE_EMAIL_GUARD_REGEX.test(email)) {
        supEmailById.set(Number(u.id), {
          email,
          name: String(u.full_name || '').trim() || 'Supervisor',
        })
      }
    }
  }

  // Agrupar tiendas activas por supervisor con correo válido (orden alfabético por nombre de supervisor)
  const groupsBySupId = new Map<number, { supervisorName: string; email: string; stores: StoreFridgeVsToastSummary[] }>()
  for (const s of meter.storesSummaries) {
    if (!s.supervisorId) continue
    const supInfo = supEmailById.get(s.supervisorId)
    if (!supInfo) continue
    const existing = groupsBySupId.get(s.supervisorId)
    if (existing) {
      existing.stores.push(s)
    } else {
      groupsBySupId.set(s.supervisorId, {
        supervisorName: (s.supervisorName || supInfo.name || '').trim() || supInfo.name,
        email: supInfo.email,
        stores: [s],
      })
    }
  }

  const orderedSupervisors = Array.from(groupsBySupId.entries()).sort(([, a], [, b]) =>
    a.supervisorName.localeCompare(b.supervisorName, 'es', { sensitivity: 'base' })
  )

  const dispatches: SupervisorWeeklyDispatchItem[] = []
  const newlySentScopes: string[] = []

  // 1. Correos individuales por Supervisor (CC Gonzalo, BCC Carlos)
  for (const [supId, grp] of orderedSupervisors) {
    const scopeKey = `sup:${supId}`
    const lang = resolveSobrantesEmailLang(grp.email)
    const cc = grp.email !== GONZALO_CC_EMAIL ? [GONZALO_CC_EMAIL] : []
    const bcc =
      grp.email !== CARLOS_EXEC_EMAIL && !cc.includes(CARLOS_EXEC_EMAIL)
        ? [CARLOS_EXEC_EMAIL]
        : []

    const built = buildSobrantesExecutiveEmailHtml({
      ingredientName,
      startDate,
      endDate,
      meter,
      recipientEmail: grp.email,
      lang,
      scopedSupervisorName: grp.supervisorName,
      scopedStoreSummaries: grp.stores,
    })

    if (!forceResend && alreadySent.has(scopeKey)) {
      dispatches.push({
        scopeKey,
        kind: 'supervisor',
        supervisorName: grp.supervisorName,
        lang: built.lang,
        to: grp.email,
        cc,
        bcc,
        storesCount: built.storesCount,
        shortageCount: built.shortageCount,
        totalMissingBags: built.totalMissingBags,
        totalShortageUsd: built.totalShortageUsd,
        subject: built.subject,
        htmlBytes: built.htmlBytes,
        sent: false,
        skippedDuplicate: true,
      })
      continue
    }

    if (dryRun) {
      dispatches.push({
        scopeKey,
        kind: 'supervisor',
        supervisorName: grp.supervisorName,
        lang: built.lang,
        to: grp.email,
        cc,
        bcc,
        storesCount: built.storesCount,
        shortageCount: built.shortageCount,
        totalMissingBags: built.totalMissingBags,
        totalShortageUsd: built.totalShortageUsd,
        subject: built.subject,
        htmlBytes: built.htmlBytes,
        sent: false,
        dryRun: true,
      })
      continue
    }

    try {
      const mailRes = await sendSystemEmail({
        fromName: built.lang === 'en' ? 'Monitoring System' : 'Sistema de Monitoreo',
        to: [grp.email],
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject: built.subject,
        html: built.html,
      })
      newlySentScopes.push(scopeKey)
      dispatches.push({
        scopeKey,
        kind: 'supervisor',
        supervisorName: grp.supervisorName,
        lang: built.lang,
        to: grp.email,
        cc,
        bcc,
        storesCount: built.storesCount,
        shortageCount: built.shortageCount,
        totalMissingBags: built.totalMissingBags,
        totalShortageUsd: built.totalShortageUsd,
        subject: built.subject,
        htmlBytes: built.htmlBytes,
        sent: true,
        messageId: mailRes.messageId,
        providerUsed: mailRes.providerUsed,
      })
      await new Promise((r) => setTimeout(r, 400))
    } catch (err: any) {
      dispatches.push({
        scopeKey,
        kind: 'supervisor',
        supervisorName: grp.supervisorName,
        lang: built.lang,
        to: grp.email,
        cc,
        bcc,
        storesCount: built.storesCount,
        shortageCount: built.shortageCount,
        totalMissingBags: built.totalMissingBags,
        totalShortageUsd: built.totalShortageUsd,
        subject: built.subject,
        htmlBytes: built.htmlBytes,
        sent: false,
        error: err?.message || String(err),
      })
    }
  }

  // 2. Resumen Ejecutivo Consolidado de las 15 sucursales (To: Carlos, CC: Gonzalo)
  {
    const scopeKey = 'exec:all'
    const execTo = CARLOS_EXEC_EMAIL
    const execCc = [GONZALO_CC_EMAIL]
    const built = buildSobrantesExecutiveEmailHtml({
      ingredientName,
      startDate,
      endDate,
      meter,
      recipientEmail: execTo,
      lang: 'es',
    })

    if (!forceResend && alreadySent.has(scopeKey)) {
      dispatches.push({
        scopeKey,
        kind: 'executive_consolidated',
        supervisorName: null,
        lang: 'es',
        to: execTo,
        cc: execCc,
        bcc: [],
        storesCount: built.storesCount,
        shortageCount: built.shortageCount,
        totalMissingBags: built.totalMissingBags,
        totalShortageUsd: built.totalShortageUsd,
        subject: built.subject,
        htmlBytes: built.htmlBytes,
        sent: false,
        skippedDuplicate: true,
      })
    } else if (dryRun) {
      dispatches.push({
        scopeKey,
        kind: 'executive_consolidated',
        supervisorName: null,
        lang: 'es',
        to: execTo,
        cc: execCc,
        bcc: [],
        storesCount: built.storesCount,
        shortageCount: built.shortageCount,
        totalMissingBags: built.totalMissingBags,
        totalShortageUsd: built.totalShortageUsd,
        subject: built.subject,
        htmlBytes: built.htmlBytes,
        sent: false,
        dryRun: true,
      })
    } else {
      try {
        const mailRes = await sendSystemEmail({
          fromName: 'Sistema de Monitoreo',
          to: [execTo],
          cc: execCc,
          subject: built.subject,
          html: built.html,
        })
        newlySentScopes.push(scopeKey)
        dispatches.push({
          scopeKey,
          kind: 'executive_consolidated',
          supervisorName: null,
          lang: 'es',
          to: execTo,
          cc: execCc,
          bcc: [],
          storesCount: built.storesCount,
          shortageCount: built.shortageCount,
          totalMissingBags: built.totalMissingBags,
          totalShortageUsd: built.totalShortageUsd,
          subject: built.subject,
          htmlBytes: built.htmlBytes,
          sent: true,
          messageId: mailRes.messageId,
          providerUsed: mailRes.providerUsed,
        })
      } catch (err: any) {
        dispatches.push({
          scopeKey,
          kind: 'executive_consolidated',
          supervisorName: null,
          lang: 'es',
          to: execTo,
          cc: execCc,
          bcc: [],
          storesCount: built.storesCount,
          shortageCount: built.shortageCount,
          totalMissingBags: built.totalMissingBags,
          totalShortageUsd: built.totalShortageUsd,
          subject: built.subject,
          htmlBytes: built.htmlBytes,
          sent: false,
          error: err?.message || String(err),
        })
      }
    }
  }

  const allSentScopes = Array.from(new Set([...Array.from(alreadySent), ...newlySentScopes]))
  return {
    dispatches,
    sentScopes: allSentScopes,
    totalSent: dispatches.filter((d) => d.sent).length,
    totalFailed: dispatches.filter((d) => Boolean(d.error)).length,
  }
}
