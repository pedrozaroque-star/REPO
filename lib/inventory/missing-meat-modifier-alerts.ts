/**
 * @module lib/inventory/missing-meat-modifier-alerts
 * @description Motor automatizado de auditoría diaria y notificación obligatoria a la Escalera de Mando (AM/PM)
 *   cuando en Toast POS se cobra `Side Order Carne` o `2 / 6 / 12 lb Meat` SIN especificar el tipo de carne.
 *
 * @businessRules
 *   - Día laboral oficial de Tacos Gavilan (`America/Los_Angeles`): `06:00 AM` a `05:59 AM` del día siguiente.
 *     • `Turno AM`: `06:00 AM – 04:59 PM`.
 *     • `Turno PM`: `05:00 PM – 05:59 AM`.
 *   - Mientras una orden de `Side Order Carne` o `2 / 6 / 12 lb Meat` no especifique proteína, el motor de inventario
 *     la descuenta provisionalmente al 100% de **Carne Asada**, pero dispara esta alerta obligatoria para que el
 *     General Manager y el Asistente del turno entrenen de inmediato a la cajera involucrada.
 *   - Destinatarios obligatorios por `(store_id, shift)` en modo `'live_escalera'`:
 *     • `Para (To)`: General Manager de la sucursal (respaldo: Supervisor si no hay Manager asignado).
 *     • `Con Copia Obligatoria (CC)`: Supervisor Regional + Asistente(s) del turno exacto (`AM` o `PM`) donde sucedió
 *       + Cajera(s) involucrada(s) (correo en `users` o `toast_employees`).
 *     • `Copia Oculta (BCC)`: `carlos@tacosgavilan.com` (sin exponer jamás su buzón en `From:` ni en `CC:`).
 *     • `Remitente (From)`: estrictamente `noreply@tacosgavilan.com` (`Sistema de Monitoreo`) vía `sendSystemEmail()`.
 *   - Modo `'preview_carlos'`: envía un resumen consolidado exclusivamente a `carlos@tacosgavilan.com` mostrando las
 *     órdenes reales detectadas y la lista exacta de destinatarios (`Para` y `CC`) antes de ejecutar el envío en vivo.
 *   - Idempotencia estricta en `public.missing_meat_modifier_alerts` (`UNIQUE (business_date, store_id, shift)` + `live_email_sent_at`).
 *
 * @dataFlow
 *   `pmix_daily_cache` (pre-filtro rápido) → Toast `/config/v2/diningOptions` + `/orders/v2/ordersBulk` →
 *   `toast_employees` + `users` + `assistant_checklists` + `schedules` + `punches` →
 *   `public.missing_meat_modifier_alerts` + `sendSystemEmail()`.
 *
 * @notes
 *   - Respeta el Protocolo Toast API: traduce siempre `diningOption.guid -> Nombre` vía `/config/v2/diningOptions`.
 *   - Nombre oficial de marca en asuntos y cuerpo: estrictamente **Tacos Gavilan**.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { sendSystemEmail } from '@/lib/system-mailer'
import { compareStoreNamesAlphabetically, formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import {
  addDaysIso,
  buildLAInstant,
  getBusinessDateLA,
  getLANowParts,
  isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  hasExplicitMeatSpecification,
  isVariableMeatMenuItem,
} from '@/lib/inventory/meat-allocation'
import {
  isPmixCacheRowFinalized,
  readPmixDailyCacheChunked,
} from '@/lib/inventory/pmix-cache-reader'
import { getAuthToken, getDiningOptions } from '@/lib/toast-api'
import {
  buildEscaleraByStore,
  escapeHtml,
  normalizeCorporateEmail,
} from '@/lib/inventory/portion-control-alerts'
import { formatShortDateLabelEs } from '@/lib/inventory/toast-meat-sold-resolver'
import {
  loadEmailDeliverabilityContext,
  resolveDeliverableUserEmail,
  resolveSingleRecipientEmail,
} from '@/lib/email-recipient-guard'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const EXEC_COPY_EMAIL = 'carlos@tacosgavilan.com'

export type ShiftCode = 'AM' | 'PM'
export type MissingMeatDeliveryMode = 'preview_carlos' | 'sample_single_to_carlos' | 'live_escalera'

export interface MissingMeatOrderIncident {
  orderGuid: string
  orderNumber: string
  timestampIso: string
  localDateTimeLabel: string
  shift: ShiftCode
  diningChannel: string
  source: string
  itemName: string
  quantity: number
  provisionalAsadaOz: number
  serverToastGuid: string | null
  cashierName: string
  cashierEmail: string | null
}

export interface StoreShiftMissingMeatGroup {
  businessDate: string
  storeId: number
  storeName: string
  storeCode: string | null
  shift: ShiftCode
  ordersCount: number
  itemsCount: number
  incidents: MissingMeatOrderIncident[]
  managerName: string | null
  managerEmail: string | null
  supervisorName: string | null
  supervisorEmail: string | null
  shiftAssistantNames: string[]
  shiftAssistantEmails: string[]
  cashierNames: string[]
  cashierEmails: string[]
  liveTo: string[]
  liveCc: string[]
}

export interface ScanMissingMeatModifiersOptions {
  businessDate?: string | null
  storeId?: number | string | null
  dryRun?: boolean
  deliveryMode?: MissingMeatDeliveryMode
  forceResend?: boolean
  previewTo?: string[]
  previewCc?: string[]
}

export interface DispatchedMissingMeatEmail {
  storeId: number | 'ALL_PREVIEW'
  storeName: string
  shift: ShiftCode | 'ALL'
  mode: MissingMeatDeliveryMode
  to: string[]
  cc: string[]
  subject: string
  sent: boolean
  skippedDuplicate?: boolean
  messageId?: string
  fromEmail?: string
  providerUsed?: string
  error?: string
}

export interface ScanMissingMeatModifiersResult {
  businessDate: string
  deliveryMode: MissingMeatDeliveryMode
  dryRun: boolean
  storesEvaluated: number
  storesWithIncidents: number
  groupsDetected: StoreShiftMissingMeatGroup[]
  emailsDispatched: DispatchedMissingMeatEmail[]
}

function cleanEmailAnyDomain(raw?: string | null): string | null {
  if (!raw) return null
  const clean = String(raw).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null
  if (clean === 'roque@tacosgavilan.com') return EXEC_COPY_EMAIL
  return clean
}

function formatPersonDisplayName(raw?: string | null): string {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean
    .split(' ')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function collectModifierTexts(modifiers: any): string[] {
  if (!Array.isArray(modifiers)) return []
  const out: string[] = []
  for (const m of modifiers) {
    if (!m || m.voided) continue
    const pre = String(m?.preModifier?.displayName || '').trim()
    const disp = String(m?.displayName || '').trim()
    const combined = [pre, disp].filter(Boolean).join(' ').trim()
    if (combined) out.push(combined)
    if (Array.isArray(m.modifiers) && m.modifiers.length > 0) {
      out.push(...collectModifierTexts(m.modifiers))
    }
  }
  return out
}

function classifyScheduleShift(sch: { shift_label?: string | null; start_time?: string | null; end_time?: string | null }): ShiftCode | null {
  const lbl = String(sch.shift_label || '').trim()
  const startRaw = String(sch.start_time || '').trim()
  const endRaw = String(sch.end_time || '').trim()
  if (/vacac|descans|\boff\b|sick|incap|permis|libre|ausent|feriad/i.test(lbl)) {
    return null
  }
  if ((!startRaw || startRaw.startsWith('00:00')) && (!endRaw || endRaw.startsWith('00:00')) && !/apertura|mañana|manana|am|pm|tarde|noche|cierre/i.test(lbl)) {
    return null
  }
  if (/\bpm\b|tarde|noche|cierre/i.test(lbl)) return 'PM'
  if (/\bam\b|apertura|mañana|manana/i.test(lbl)) return 'AM'
  const startHour = parseInt((startRaw || '12:00').slice(0, 2), 10)
  if (!Number.isFinite(startHour)) return 'AM'
  return startHour >= 14 || startHour < 6 ? 'PM' : 'AM'
}

function formatLaTimeAmPm(dateObj: Date): { shift: ShiftCode; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dateObj)

  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  const hour24 = Number(get('hour')) % 24
  const minute = get('minute')
  const calDate = `${get('year')}-${get('month')}-${get('day')}`
  // Regla oficial Tacos Gavilan: AM = 06:00 a 16:59; PM = 17:00 a 05:59 del día siguiente
  const shift: ShiftCode = hour24 >= 6 && hour24 < 17 ? 'AM' : 'PM'
  const suffix = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return {
    shift,
    label: `${formatShortDateLabelEs(calDate)} · ${hour12}:${minute} ${suffix}`,
  }
}

function inferProvisionalAsadaOz(itemName: string, qty: number): number {
  const lbMatch = String(itemName || '').match(/\b(\d+)\s*lb\s*meat\b/i)
  const unitOz = lbMatch ? parseInt(lbMatch[1], 10) * 16 : 6.0
  return Math.round(unitOz * qty * 10) / 10
}

async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message || String(error))
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

async function getToastAccessToken(): Promise<string> {
  const clientId = process.env.TOAST_CLIENT_ID
  const clientSecret = process.env.TOAST_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Faltan credenciales TOAST_CLIENT_ID / TOAST_CLIENT_SECRET')
  }
  const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId,
      clientSecret,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    throw new Error(`Error autenticando Toast API: HTTP ${res.status}`)
  }
  const json = await res.json()
  const token = json?.token?.accessToken
  if (!token) throw new Error('Toast API no devolvió accessToken')
  return token
}

async function fetchToastJsonWithRetry(url: string, headers: Record<string, string>): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(45_000),
    })
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * attempt))
        continue
      }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Toast HTTP ${res.status}: ${txt.slice(0, 180)}`)
    }
    return res.json()
  }
  throw new Error('Toast API agotó reintentos')
}

async function getDiningOptionsMapForStore(token: string, externalStoreId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const list = await fetchToastJsonWithRetry(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': externalStoreId,
    })
    if (Array.isArray(list)) {
      for (const opt of list) {
        if (opt?.guid && opt?.name) {
          map.set(String(opt.guid), String(opt.name))
        }
      }
    }
  } catch (err) {
    console.warn(`[MissingMeatAlerts] No se pudo cargar diningOptions para ${externalStoreId}:`, err)
  }
  return map
}

export function buildLiveShiftAlertEmailHtml(group: StoreShiftMissingMeatGroup): {
  subject: string
  html: string
} {
  const shiftLabel =
    group.shift === 'AM'
      ? 'Turno AM (06:00 AM – 04:59 PM)'
      : 'Turno PM (05:00 PM – 05:59 AM)'
  const cleanStoreName = formatStoreDisplayName({ id: group.storeId, name: group.storeName }) || group.storeName
  const dateLabel = formatShortDateLabelEs(group.businessDate)
  const subject = `⚠️ Obligatorio Tacos Gavilan · ${cleanStoreName} (${group.shift}): Registrar Tipo de Carne en Toast (${group.ordersCount} ${group.ordersCount === 1 ? 'orden' : 'órdenes'})`

  const rowsHtml = group.incidents
    .map(
      (inc) => `<tr style="border-bottom:1px solid #E5E7EB;">
        <td style="padding:11px 10px;font-size:14px;font-weight:900;color:#111827;">#${escapeHtml(inc.orderNumber)}</td>
        <td style="padding:11px 10px;font-size:13px;font-weight:700;color:#374151;">${escapeHtml(inc.localDateTimeLabel)}</td>
        <td style="padding:11px 10px;font-size:14px;font-weight:800;color:#991B1B;">${inc.quantity} × ${escapeHtml(inc.itemName)}</td>
        <td style="padding:11px 10px;font-size:14px;font-weight:800;color:#111827;">${escapeHtml(inc.cashierName)}</td>
      </tr>`
    )
    .join('')

  const assistantDisplay =
    group.shiftAssistantNames.length > 0 ? group.shiftAssistantNames.join(', ') : 'Asistente en turno'

  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:16px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table width="620" align="center" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <tr>
        <td style="background:#991B1B;color:#FFFFFF;padding:20px 24px;">
          <div style="font-size:11px;font-weight:800;color:#FECACA;text-transform:uppercase;letter-spacing:0.8px;">TACOS GAVILAN · CUMPLIMIENTO OBLIGATORIO EN CAJA</div>
          <div style="font-size:21px;font-weight:900;margin-top:4px;">${escapeHtml(cleanStoreName)} · ${escapeHtml(shiftLabel)}</div>
          <div style="font-size:13px;color:#FEE2E2;margin-top:4px;">Día laboral: ${escapeHtml(dateLabel)} (${escapeHtml(group.businessDate)})</div>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 24px;">
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
            <div style="font-size:14px;font-weight:900;color:#991B1B;margin-bottom:6px;">🚨 Acción Obligatoria Inmediata para Manager y Asistente de Turno</div>
            <div style="font-size:14px;line-height:1.5;color:#7F1D1D;">
              En las siguientes órdenes se cobró <strong>Side Order Carne</strong> o <strong>Carne por Libra</strong> <strong>SIN anotar qué tipo de carne se sirvió</strong>.<br><br>
              Es <strong>100% OBLIGATORIO</strong> que todas las cajeras registren siempre el tipo exacto de carne en Toast POS para calcular correctamente los consumos y los sobrantes diarios de la sucursal. Mientras no se especifique, el sistema descuenta estas órdenes directamente de <strong>Carne Asada</strong>.
            </div>
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;font-size:13px;color:#374151;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;">
            <tr>
              <td style="padding:4px 0;"><strong>Manager Responsable:</strong> ${escapeHtml(group.managerName || 'Gerente de Sucursal')}</td>
              <td style="padding:4px 0;"><strong>Supervisor (CC):</strong> ${escapeHtml(group.supervisorName || 'Supervisor')}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;"><strong>Asistente ${group.shift} (CC):</strong> ${escapeHtml(assistantDisplay)}</td>
              <td style="padding:4px 0;"><strong>Cajera(s) (CC):</strong> ${escapeHtml(group.cashierNames.join(', '))}</td>
            </tr>
          </table>

          <div style="font-size:15px;font-weight:900;color:#111827;margin-bottom:8px;">Órdenes sin Tipo de Carne Detectadas (${group.ordersCount})</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#F3F4F6;font-size:11px;font-weight:800;text-transform:uppercase;color:#4B5563;border-bottom:1px solid #E5E7EB;">
                <th style="padding:10px;text-align:left;"># Orden</th>
                <th style="padding:10px;text-align:left;">Fecha y Hora</th>
                <th style="padding:10px;text-align:left;">Producto Cobrado</th>
                <th style="padding:10px;text-align:left;">Cajera</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div style="margin-top:18px;font-size:13px;color:#374151;line-height:1.5;">
            <strong>Instrucción:</strong> Entrenar hoy mismo a la(s) cajera(s) involucrada(s) antes de iniciar su turno para asegurar cero órdenes sin tipo de carne a partir de hoy.
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;padding:12px 24px;font-size:11px;color:#6B7280;text-align:center;border-top:1px solid #E5E7EB;">
          Tacos Gavilan · Auditoría Automática Diaria de Consumos y Sobrantes
        </td>
      </tr>
    </table>
  </body></html>`

  return { subject, html }
}

export function buildPreviewDigestForCarlosHtml(
  businessDate: string,
  groups: StoreShiftMissingMeatGroup[],
  recipientEmails: string[] = [EXEC_COPY_EMAIL]
): { subject: string; html: string } {
  const dateLabel = formatShortDateLabelEs(businessDate)
  const totalOrders = groups.reduce((acc, g) => acc + g.ordersCount, 0)
  const uniqueStores = new Set(groups.map((g) => g.storeId)).size
  const recipientsLabel = recipientEmails.length > 0 ? recipientEmails.join(', ') : EXEC_COPY_EMAIL

  const subject =
    groups.length > 0
      ? `🔎 [VISTA PREVIA EJECUTIVA] Órdenes sin Tipo de Carne (${dateLabel}): ${totalOrders} órdenes en ${uniqueStores} sucursales`
      : `✅ [VISTA PREVIA EJECUTIVA] Órdenes sin Tipo de Carne (${dateLabel}): 0 incidencias`

  const sortedGroups = [...groups].sort((a, b) => {
    const cmp = compareStoreNamesAlphabetically(
      formatStoreDisplayName({ id: a.storeId, name: a.storeName }),
      formatStoreDisplayName({ id: b.storeId, name: b.storeName })
    )
    if (cmp !== 0) return cmp
    return a.shift.localeCompare(b.shift)
  })

  const sectionsHtml =
    sortedGroups.length === 0
      ? `<div style="padding:18px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;color:#065F46;font-weight:800;text-align:center;">✅ Todas las órdenes de Side Order Carne y Carne por Libra especificaron proteína en este día.</div>`
      : sortedGroups
          .map((g) => {
            const rows = g.incidents
              .map(
                (inc) => `<tr style="border-bottom:1px solid #F3F4F6;">
                  <td style="padding:9px 8px;font-size:13px;font-weight:900;color:#111827;">#${escapeHtml(inc.orderNumber)}</td>
                  <td style="padding:9px 8px;font-size:13px;color:#374151;">${escapeHtml(inc.localDateTimeLabel)}</td>
                  <td style="padding:9px 8px;font-size:13px;font-weight:800;color:#991B1B;">${inc.quantity} × ${escapeHtml(inc.itemName)}</td>
                  <td style="padding:9px 8px;font-size:13px;font-weight:800;color:#111827;">${escapeHtml(inc.cashierName)}</td>
                </tr>`
              )
              .join('')

            return `<div style="margin-bottom:20px;border:1px solid #FECACA;border-radius:12px;overflow:hidden;">
              <div style="background:#FEF2F2;padding:12px 14px;border-bottom:1px solid #FECACA;">
                <div style="font-size:16px;font-weight:900;color:#991B1B;">${escapeHtml(formatStoreDisplayName({ id: g.storeId, name: g.storeName }) || g.storeName)} · Turno ${g.shift} (${g.ordersCount} ${g.ordersCount === 1 ? 'orden' : 'órdenes'})</div>
                <div style="font-size:12px;color:#7F1D1D;margin-top:4px;line-height:1.5;">
                  <strong>Para (Manager):</strong> ${escapeHtml(g.managerName || '—')} (${escapeHtml(g.liveTo.join(', ') || 'Sin correo')})<br>
                  <strong>CC Obligatorio:</strong> Supervisor ${escapeHtml(g.supervisorName || '—')} · Asistente ${g.shift}: ${escapeHtml(g.shiftAssistantNames.join(', ') || '—')} · Cajera(s): ${escapeHtml(g.cashierNames.join(', '))}<br>
                  <strong>Correos en CC al activar:</strong> ${escapeHtml(g.liveCc.join(', ') || '—')} · <strong>BCC:</strong> ${escapeHtml(EXEC_COPY_EMAIL)}
                </div>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#FFFFFF;">
                <thead>
                  <tr style="background:#F9FAFB;font-size:11px;font-weight:800;text-transform:uppercase;color:#4B5563;border-bottom:1px solid #E5E7EB;">
                    <th style="padding:8px;text-align:left;"># Orden</th>
                    <th style="padding:8px;text-align:left;">Fecha y Hora</th>
                    <th style="padding:8px;text-align:left;">Producto</th>
                    <th style="padding:8px;text-align:left;">Cajera</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`
          })
          .join('')

  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:16px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table width="640" align="center" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <tr>
        <td style="background:#111827;color:#FFFFFF;padding:20px 24px;">
          <div style="font-size:11px;font-weight:800;color:#93C5FD;text-transform:uppercase;letter-spacing:0.8px;">VISTA PREVIA EJECUTIVA DE PRUEBA (AÚN NO ENVIADO A TIENDAS)</div>
          <div style="font-size:21px;font-weight:900;margin-top:4px;">📋 Cajeras sin Anotar Tipo de Carne en Toast</div>
          <div style="font-size:13px;color:#D1D5DB;margin-top:4px;">Día revisado: ${escapeHtml(dateLabel)} (${escapeHtml(businessDate)}) · ${totalOrders} órdenes en ${uniqueStores} sucursales</div>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 24px;">
          <div style="font-size:14px;color:#374151;margin-bottom:16px;line-height:1.5;">
            Estas son las órdenes reales del día anterior donde se cobró <strong>Side Order Carne</strong> o <strong>Carne por Libra</strong> sin anotar la carne (descontadas provisionalmente de <strong>Carne Asada</strong>). Esta es una vista previa ejecutiva (aún no enviada a las sucursales); al activar el envío en vivo, cada bloque saldrá automáticamente a su Manager, Supervisor, Asistente del turno y Cajera involucrada:
          </div>
          ${sectionsHtml}
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;padding:12px 24px;font-size:11px;color:#6B7280;text-align:center;border-top:1px solid #E5E7EB;">
          Tacos Gavilan · Vista Previa Ejecutiva enviada a ${escapeHtml(recipientsLabel)}
        </td>
      </tr>
    </table>
  </body></html>`

  return { subject, html }
}

export async function scanAndNotifyMissingMeatModifiers(
  options: ScanMissingMeatModifiersOptions = {}
): Promise<ScanMissingMeatModifiersResult> {
  const supabase = await getSupabaseAdminClient()
  const todayLa = getBusinessDateLA()
  const businessDate =
    options.businessDate && isValidIsoDate(options.businessDate)
      ? options.businessDate
      : addDaysIso(todayLa, -1)

  const dryRun = Boolean(options.dryRun)
  const deliveryMode: MissingMeatDeliveryMode = options.deliveryMode || 'live_escalera'
  const forceResend = Boolean(options.forceResend)

  const { data: storesRows, error: storesErr } = await supabase
    .from('stores')
    .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })
  if (storesErr) throw new Error(storesErr.message)

  let stores = sortStoresAlphabetically((storesRows || []).filter((s: any) => Boolean(s.external_id)), (s: any) => s.name, { pinSpecialFirst: false })
  if (options.storeId !== null && options.storeId !== undefined && String(options.storeId).trim() !== '' && String(options.storeId) !== 'all') {
    const rawFilter = String(options.storeId).trim()
    stores = stores.filter((s: any) => String(s.id) === rawFilter || String(s.external_id) === rawFilter)
  }

  if (stores.length === 0) {
    return {
      businessDate,
      deliveryMode,
      dryRun,
      storesEvaluated: 0,
      storesWithIncidents: 0,
      groupsDetected: [],
      emailsDispatched: [],
    }
  }

  // 1. Pre-filtro rápido usando `pmix_daily_cache` en lotes pequeños (5 tiendas/lote = ~1 MB/petición)
  //    con propagación explícita de error DB (nunca disparar 15 tiendas contra Toast si falla Supabase)
  const storeGuids = stores.map((s: any) => String(s.external_id))
  const pmixRes = await readPmixDailyCacheChunked(supabase, {
    storeGuids,
    startDate: businessDate,
    endDate: businessDate,
    includeUpdatedAt: true,
    chunkRows: 5,
  })

  const pmixByGuid = new Map<string, any[]>()
  for (const r of pmixRes.rows) {
    if (Array.isArray(r.items) && r.items.length > 0 && isPmixCacheRowFinalized(businessDate, r.updated_at, todayLa)) {
      pmixByGuid.set(String(r.store_id), r.items)
    }
  }

  const candidateStores = stores.filter((s: any) => {
    const cached = pmixByGuid.get(String(s.external_id))
    if (!cached) return true // Si no hay caché definitiva aún, revisar en vivo
    return cached.some(
      (item: any) =>
        Number(item?.quantity || 0) > 0 &&
        isVariableMeatMenuItem(item?.name, item?.guid) &&
        !hasExplicitMeatSpecification(item?.name)
    )
  })

  if (candidateStores.length === 0) {
    return {
      businessDate,
      deliveryMode,
      dryRun,
      storesEvaluated: stores.length,
      storesWithIncidents: 0,
      groupsDetected: [],
      emailsDispatched: [],
    }
  }

  // 2. Cargar directorios de personal, escalera de mando, checklists y turnos en 2 olas acotadas (máx 3 consultas en paralelo)
  const candidateStoreIds = candidateStores.map((s: any) => Number(s.id))
  const candidateGuids = candidateStores.map((s: any) => String(s.external_id))
  const rollingStart = addDaysIso(businessDate, -6)
  const rollingEnd = addDaysIso(businessDate, 1)

  const [usersRows, toastEmpRows, checklistsRes, deliverabilityCtx] = await Promise.all([
    fetchAllPaginated<any>((from, to) =>
      supabase
        .from('users')
        .select('id, full_name, email, google_email_connected, role, store_id, store_scope, is_active, toast_guid')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllPaginated<any>((from, to) =>
      supabase
        .from('toast_employees')
        .select('id, toast_guid, v2_toast_guid, first_name, last_name, chosen_name, email, deleted, store_ids')
        .order('id', { ascending: true })
        .range(from, to)
    ),
    supabase
      .from('assistant_checklists')
      .select('store_id, shift, user_id, user_name')
      .in('store_id', candidateStoreIds)
      .eq('checklist_date', businessDate),
    loadEmailDeliverabilityContext(supabase),
  ])
  if (checklistsRes.error) {
    throw new Error(`Error leyendo assistant_checklists: ${checklistsRes.error.message}`)
  }
  const checklistsRows = checklistsRes.data || []

  const [schedulesWindowRows, punchesRows, existingAlertsRes] = await Promise.all([
    fetchAllPaginated<any>((from, to) =>
      supabase
        .from('schedules')
        .select('store_id, date, user_id, shift_label, start_time, end_time, role')
        .in('store_id', candidateStoreIds)
        .gte('date', rollingStart)
        .lte('date', rollingEnd)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllPaginated<any>((from, to) =>
      supabase
        .from('punches')
        .select('store_id, employee_toast_guid, clock_in, clock_out, regular_hours, overtime_hours')
        .in('store_id', candidateGuids)
        .eq('business_date', businessDate)
        .order('toast_id', { ascending: true })
        .range(from, to)
    ),
    supabase
      .from('missing_meat_modifier_alerts')
      .select('store_id, shift, live_email_sent_at')
      .eq('business_date', businessDate)
      .in('store_id', candidateStoreIds),
  ])
  if (existingAlertsRes.error) {
    throw new Error(`Error leyendo missing_meat_modifier_alerts: ${existingAlertsRes.error.message}`)
  }
  const existingAlertsRows = existingAlertsRes.data || []

  const escaleraByStore = buildEscaleraByStore(stores as any, usersRows, {
    deliverabilityCtx,
    toastEmployees: toastEmpRows,
  })

  const userById = new Map<number, any>()
  const userByToastGuid = new Map<string, any>()
  for (const u of usersRows) {
    userById.set(Number(u.id), u)
    if (u.toast_guid) {
      userByToastGuid.set(String(u.toast_guid).trim().toLowerCase(), u)
    }
  }

  const toastEmpByGuid = new Map<string, { name: string; email: string | null }>()
  for (const te of toastEmpRows) {
    const rawName = String(te.chosen_name || `${te.first_name || ''} ${te.last_name || ''}`)
    const fullName = formatPersonDisplayName(rawName) || 'Cajera en Turno'
    const rawClean = cleanEmailAnyDomain(te.email)
    const checkedEmail = rawClean ? resolveSingleRecipientEmail(rawClean, deliverabilityCtx) : null
    const email = checkedEmail?.deliverable ? checkedEmail.resolvedEmail : null
    const g1 = te.toast_guid ? String(te.toast_guid).trim().toLowerCase() : ''
    const g2 = te.v2_toast_guid ? String(te.v2_toast_guid).trim().toLowerCase() : ''
    if (g1) toastEmpByGuid.set(g1, { name: fullName, email })
    if (g2) toastEmpByGuid.set(g2, { name: fullName, email })
    // Puente cruzado v1 <-> v2 GUID hacia `users`
    if (g1 && g2) {
      if (userByToastGuid.has(g1) && !userByToastGuid.has(g2)) userByToastGuid.set(g2, userByToastGuid.get(g1))
      if (userByToastGuid.has(g2) && !userByToastGuid.has(g1)) userByToastGuid.set(g1, userByToastGuid.get(g2))
    }
  }

  const isAssistantRole = (roleRaw?: string | null) => {
    const r = String(roleRaw || '').toLowerCase()
    return r.includes('asist') || r.includes('assist')
  }

  const resolveShiftAssistants = (storeId: number, storeExternalId: string, shift: ShiftCode) => {
    const names = new Set<string>()
    const emails = new Set<string>()
    let managerCoveredName: string | null = null

    const addUser = (u: any, fallbackName?: string | null) => {
      if (u) {
        const nm = formatPersonDisplayName(u.full_name || fallbackName)
        if (nm) names.add(nm)
        const em = resolveDeliverableUserEmail(
          u,
          deliverabilityCtx.verifiedCorporateEmails,
          deliverabilityCtx.assistantIndex,
          deliverabilityCtx.blockedExternalEmails
        )
        if (em && em !== EXEC_COPY_EMAIL) emails.add(em)
      } else if (fallbackName) {
        const nm = formatPersonDisplayName(fallbackName)
        if (nm) names.add(nm)
      }
    }

    // 1. Checklists de Asistente del turno exacto (AM o PM) — ignorando si lo llenó un Manager
    for (const chk of checklistsRows) {
      if (Number(chk.store_id) !== storeId) continue
      const chkShift = String(chk.shift || '').trim().toUpperCase()
      if (chkShift === shift || (shift === 'AM' && chkShift.includes('APERTURA')) || (shift === 'PM' && chkShift.includes('CIERRE'))) {
        const u = chk.user_id ? userById.get(Number(chk.user_id)) : null
        if (u && !isAssistantRole(u.role)) {
          managerCoveredName = formatPersonDisplayName(u.full_name) || managerCoveredName
          continue
        }
        addUser(u, chk.user_name)
      }
    }

    // 2. Horarios programados (`schedules`) del día exacto `businessDate`
    if (names.size === 0) {
      for (const sch of schedulesWindowRows) {
        if (Number(sch.store_id) !== storeId || String(sch.date) !== businessDate) continue
        const u = sch.user_id ? userById.get(Number(sch.user_id)) : null
        const schShift = classifyScheduleShift(sch)
        if (schShift !== shift) continue
        if (isAssistantRole(sch.role || u?.role)) {
          addUser(u)
        } else if (u && String(u.role || '').toLowerCase().includes('manag')) {
          managerCoveredName = formatPersonDisplayName(u.full_name) || managerCoveredName
        }
      }
    }

    // 3. Punches reales de asistentes en el día (clasificados por hora de entrada LA + protección contra auto-cierre 06:00 AM)
    if (names.size === 0) {
      const autoCloseIsoMs = buildLAInstant(addDaysIso(businessDate, 1), 6, 0).getTime()
      for (const p of punchesRows) {
        if (String(p.store_id) !== storeExternalId || !p.employee_toast_guid || !p.clock_in) continue
        const u = userByToastGuid.get(String(p.employee_toast_guid).trim().toLowerCase())
        if (!u || !isAssistantRole(u.role)) continue
        const clockInDate = new Date(String(p.clock_in))
        if (Number.isNaN(clockInDate.getTime())) continue
        const inHourLa = getLANowParts(clockInDate).hour
        const primaryShift: ShiftCode = inHourLa >= 6 && inHourLa < 14 ? 'AM' : 'PM'
        const totalHrs = Number(p.regular_hours || 0) + Number(p.overtime_hours || 0)
        const outMs = p.clock_out ? Date.parse(String(p.clock_out)) : 0
        const isAutoClosed = outMs > 0 && Math.abs(outMs - autoCloseIsoMs) <= 5 * 60_000
        const workedDouble = totalHrs >= 10 && !isAutoClosed
        if (primaryShift === shift || workedDouble) {
          addUser(u)
        }
      }
    }

    // 4. Asistente Titular del turno (AM o PM) en la ventana semanal (ej. si el incidente ocurrió en su día de descanso)
    if (emails.size === 0) {
      for (const sch of schedulesWindowRows) {
        if (Number(sch.store_id) !== storeId) continue
        const u = sch.user_id ? userById.get(Number(sch.user_id)) : null
        if (!u || !isAssistantRole(sch.role || u.role)) continue
        if (classifyScheduleShift(sch) === shift) {
          addUser(u)
        }
      }
    }

    // 5. Respaldo final si la tienda no tiene horarios cargados en la semana
    if (emails.size === 0 && !managerCoveredName) {
      const esc = escaleraByStore.get(storeId)
      if (esc) {
        esc.assistantNames.forEach((n) => names.add(n))
        esc.assistantEmails.forEach((e) => emails.add(e))
      }
    }

    const finalNames = Array.from(names)
    if (managerCoveredName && finalNames.length > 0) {
      finalNames[0] = `${finalNames[0]} (Turno cubierto por ${managerCoveredName})`
    } else if (managerCoveredName && finalNames.length === 0) {
      finalNames.push(`Cubierto por Manager (${managerCoveredName})`)
    }

    return {
      names: finalNames,
      emails: Array.from(emails),
    }
  }

  // 3. Consultar Toast `/orders/v2/ordersBulk` en las sucursales candidatas (usando token y diningOptions cacheados + guard de tiempo)
  const token = (await getAuthToken()) || (await getToastAccessToken())
  const formattedBizDate = businessDate.replaceAll('-', '')
  const groupsDetected: StoreShiftMissingMeatGroup[] = []
  const scanStartedAt = Date.now()
  const MAX_SCAN_MS = 230_000

  for (const store of candidateStores) {
    if (Date.now() - scanStartedAt > MAX_SCAN_MS) {
      console.warn(`[MissingMeatMod] Tope de tiempo (${MAX_SCAN_MS}ms) alcanzado; persistiendo tiendas ya escaneadas.`)
      break
    }
    const storeId = Number(store.id)
    const externalId = String(store.external_id)
    const diningMap = await getDiningOptions(externalId).catch(() => getDiningOptionsMapForStore(token, externalId))
    const byShift = new Map<ShiftCode, MissingMeatOrderIncident[]>()

    try {
      for (let page = 1; page <= 50; page++) {
        const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${formattedBizDate}&pageSize=100&page=${page}`
        const batch = await fetchToastJsonWithRetry(url, {
          Authorization: `Bearer ${token}`,
          'Toast-Restaurant-External-ID': externalId,
        })
        if (!Array.isArray(batch) || batch.length === 0) break

        for (const ord of batch) {
          if (ord?.voided || ord?.deleted) continue
          const diningChannel =
            (ord?.diningOption?.guid && diningMap.get(String(ord.diningOption.guid))) ||
            String(ord?.diningOption?.name || ord?.source || 'Mostrador')
          const source = String(ord?.source || 'In Store')

          for (const chk of ord.checks || []) {
            if (chk?.voided || chk?.deleted) continue
            const paymentServerGuid =
              Array.isArray(chk.payments) && chk.payments.length > 0
                ? chk.payments.find((p: any) => p?.server?.guid)?.server?.guid
                : null
            const rawServerGuid = String(paymentServerGuid || ord?.server?.guid || '').trim()
            const cleanServerGuid = rawServerGuid ? rawServerGuid.toLowerCase() : null

            for (const sel of chk.selections || []) {
              if (sel?.voided) continue
              if (sel?.deferred && !sel?.toastGiftCard) continue
              const selPrice = Number(sel?.price || 0)
              const refundAmt = Number(sel?.refundDetails?.refundAmount || 0)
              if (selPrice > 0 && refundAmt >= selPrice - 0.01) continue

              const qty = Number(sel?.quantity ?? 1)
            if (!Number.isFinite(qty) || qty <= 0) continue

            const selPre = String(sel?.preModifier?.displayName || '').trim()
            const selNameRaw = String(sel?.displayName || '')
            const selName = selPre ? `${selPre} ${selNameRaw}`.trim() : selNameRaw
            const selGuid = String(sel?.item?.guid || '')
            if (!isVariableMeatMenuItem(selNameRaw, selGuid)) continue

            const modTexts = collectModifierTexts(sel.modifiers)
            if (hasExplicitMeatSpecification(selName, modTexts)) continue

            const tsIso = String(sel?.createdDate || ord?.openedDate || ord?.paidDate || `${businessDate}T19:00:00Z`)
            const parsedDate = new Date(tsIso)
            const safeDate = Number.isNaN(parsedDate.getTime())
              ? buildLAInstant(businessDate, 12, 0)
              : parsedDate
            const { shift, label: localDateTimeLabel } = formatLaTimeAmPm(safeDate)

            const matchedUser = cleanServerGuid ? userByToastGuid.get(cleanServerGuid) : null
            const matchedToastEmp = cleanServerGuid ? toastEmpByGuid.get(cleanServerGuid) : null

            const isOnlineOrder = /uber|doordash|grubhub|online|web|app/i.test(`${source} ${diningChannel}`) && !matchedToastEmp && !matchedUser
            const cashierName =
              formatPersonDisplayName(matchedUser?.full_name) ||
              matchedToastEmp?.name ||
              (isOnlineOrder ? `Orden Digital (${diningChannel})` : 'Cajera sin identificar en POS')
            const cashierEmail =
              normalizeCorporateEmail(matchedUser?.google_email_connected || matchedUser?.email) ||
              cleanEmailAnyDomain(matchedUser?.email) ||
              matchedToastEmp?.email ||
              null

            const orderNumber = String(chk?.displayNumber || ord?.displayNumber || 'S/N').trim()
            const list = byShift.get(shift) || []
            list.push({
              orderGuid: String(ord.guid || ''),
              orderNumber,
              timestampIso: safeDate.toISOString(),
              localDateTimeLabel,
              shift,
              diningChannel,
              source,
              itemName: modTexts.length > 0 ? `${selName} (${modTexts.join(', ')})` : selName,
              quantity: qty,
              provisionalAsadaOz: inferProvisionalAsadaOz(selName, qty),
              serverToastGuid: rawServerGuid || null,
              cashierName,
              cashierEmail,
            })
            byShift.set(shift, list)
          }
        }
      }

      if (batch.length < 100) break
    }

    const esc = escaleraByStore.get(storeId)
    for (const shift of ['AM', 'PM'] as const) {
      const incidents = byShift.get(shift)
      if (!incidents || incidents.length === 0) continue

      incidents.sort((a, b) => a.timestampIso.localeCompare(b.timestampIso))
      const uniqueOrderGuids = new Set(incidents.map((i) => `${i.orderGuid}::${i.orderNumber}`))
      const itemsCount = incidents.reduce((acc, i) => acc + i.quantity, 0)

      const shiftAsst = resolveShiftAssistants(storeId, externalId, shift)
      const cashierNames = Array.from(new Set(incidents.map((i) => i.cashierName)))
      const cashierEmails = Array.from(
        new Set(
          incidents
            .map((i) => i.cashierEmail)
            .filter((e): e is string => Boolean(e) && e !== EXEC_COPY_EMAIL)
        )
      )

      const managerEmail = esc?.managerEmail || null
      const supervisorEmail = esc?.supervisorEmail || null
      const liveTo: string[] = Array.from(
        new Set(
          [managerEmail || supervisorEmail || EXEC_COPY_EMAIL].filter(
            (e): e is string => typeof e === 'string' && e.length > 0
          )
        )
      )
      const liveCc: string[] = Array.from(
        new Set(
          [
            supervisorEmail,
            ...shiftAsst.emails,
            ...cashierEmails,
          ].filter(
            (e): e is string =>
              typeof e === 'string' &&
              e.length > 0 &&
              e.toLowerCase() !== EXEC_COPY_EMAIL &&
              !liveTo.includes(e)
          )
        )
      )

      groupsDetected.push({
        businessDate,
        storeId,
        storeName: formatStoreDisplayName(store) || 'Sucursal',
        storeCode: store.code ? String(store.code) : null,
        shift,
        ordersCount: uniqueOrderGuids.size,
        itemsCount,
        incidents,
        managerName: esc?.managerName || null,
        managerEmail,
        supervisorName: esc?.supervisorName || null,
        supervisorEmail,
        shiftAssistantNames: shiftAsst.names,
        shiftAssistantEmails: shiftAsst.emails,
        cashierNames,
        cashierEmails,
        liveTo,
        liveCc,
      })
    }
    } catch (storeScanErr) {
      console.error(`[MissingMeatMod] Error escaneando tienda #${storeId} (${store.name}):`, storeScanErr)
    }
  }

  // 4. Persistir registros (en 1 solo batch upsert con verificación de error) y despachar correos según `deliveryMode`
  const sentAlreadySet = new Set<string>(
    (existingAlertsRows || [])
      .filter((r: any) => Boolean(r.live_email_sent_at))
      .map((r: any) => `${Number(r.store_id)}::${String(r.shift)}`)
  )

  const emailsDispatched: DispatchedMissingMeatEmail[] = []

  if (!dryRun) {
    if (groupsDetected.length > 0) {
      const nowUpsertIso = new Date().toISOString()
      const upsertRows = groupsDetected.map((grp) => ({
        business_date: grp.businessDate,
        store_id: grp.storeId,
        shift: grp.shift,
        orders_count: grp.ordersCount,
        items_count: grp.itemsCount,
        orders_detail: grp.incidents,
        manager_email: grp.managerEmail,
        supervisor_email: grp.supervisorEmail,
        assistant_emails: grp.shiftAssistantEmails,
        cashier_emails: grp.cashierEmails,
        cashier_names: grp.cashierNames,
        updated_at: nowUpsertIso,
      }))
      const { error: upsertErr } = await supabase
        .from('missing_meat_modifier_alerts')
        .upsert(upsertRows, { onConflict: 'business_date,store_id,shift' })
      if (upsertErr) {
        console.error('[MissingMeatMod] Error persistiendo missing_meat_modifier_alerts:', upsertErr.message)
      }
    }

    if (deliveryMode === 'preview_carlos') {
      const validPreviewTo = Array.from(
        new Set(
          (options.previewTo || [EXEC_COPY_EMAIL])
            .map((e) => normalizeCorporateEmail(e))
            .filter((e): e is string => typeof e === 'string' && e.length > 0)
        )
      )
      const finalPreviewTo = validPreviewTo.length > 0 ? validPreviewTo : [EXEC_COPY_EMAIL]
      const finalPreviewCc = Array.from(
        new Set(
          (options.previewCc || [])
            .map((e) => normalizeCorporateEmail(e))
            .filter((e): e is string => typeof e === 'string' && e.length > 0 && !finalPreviewTo.includes(e))
        )
      )
      const allPreviewRecipients = [...finalPreviewTo, ...finalPreviewCc]
      const preview = buildPreviewDigestForCarlosHtml(businessDate, groupsDetected, allPreviewRecipients)
      const mailRes = await sendSystemEmail({
        fromName: 'Sistema de Monitoreo',
        to: finalPreviewTo,
        cc: finalPreviewCc.length > 0 ? finalPreviewCc : undefined,
        subject: preview.subject,
        html: preview.html,
      })

      const nowIso = new Date().toISOString()
      for (const grp of groupsDetected) {
        await supabase
          .from('missing_meat_modifier_alerts')
          .update({
            preview_email_sent_at: nowIso,
            last_message_id: mailRes.messageId,
            updated_at: nowIso,
          })
          .eq('business_date', grp.businessDate)
          .eq('store_id', grp.storeId)
          .eq('shift', grp.shift)
      }

      emailsDispatched.push({
        storeId: 'ALL_PREVIEW',
        storeName: `Resumen Vista Previa (${allPreviewRecipients.join(', ')})`,
        shift: 'ALL',
        mode: 'preview_carlos',
        to: finalPreviewTo,
        cc: finalPreviewCc,
        subject: preview.subject,
        sent: true,
        messageId: mailRes.messageId,
        fromEmail: mailRes.fromEmail,
        providerUsed: mailRes.providerUsed,
      })
    } else if (deliveryMode === 'sample_single_to_carlos') {
      const sampleTarget =
        (options.previewTo || [])
          .map((e) => normalizeCorporateEmail(e))
          .find((e): e is string => typeof e === 'string' && e.length > 0) || EXEC_COPY_EMAIL
      const sampleGrp = groupsDetected[0]
      if (sampleGrp) {
        const built = buildLiveShiftAlertEmailHtml(sampleGrp)
        const bannerNote = `<div style="max-width:620px;margin:0 auto 12px auto;background:#111827;color:#FFFFFF;padding:12px 16px;border-radius:10px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;">
          <strong style="color:#93C5FD;">🔎 MUESTRA INDIVIDUAL DE VISTA PREVIA (${escapeHtml(sampleTarget)} · AÚN NO ENVIADO A LA TIENDA)</strong><br>
          Así se ve exactamente el correo individual que recibe cada sucursal en vivo.<br>
          <strong>Al activar saldrá Para:</strong> ${escapeHtml(sampleGrp.liveTo.join(', '))}<br>
          <strong>Con Copia (CC):</strong> ${escapeHtml(sampleGrp.liveCc.join(', ') || '—')}<br>
          <strong>Copia Oculta (BCC):</strong> ${escapeHtml(EXEC_COPY_EMAIL)}
        </div>`
        const sampleHtml = built.html.replace(
          '<table width="620"',
          `${bannerNote}<table width="620"`
        )
        const sampleSubject = `[MUESTRA TIENDA] ${built.subject}`
        const mailRes = await sendSystemEmail({
          fromName: 'Sistema de Monitoreo',
          to: [sampleTarget],
          subject: sampleSubject,
          html: sampleHtml,
        })
        emailsDispatched.push({
          storeId: sampleGrp.storeId,
          storeName: sampleGrp.storeName,
          shift: sampleGrp.shift,
          mode: 'sample_single_to_carlos',
          to: [sampleTarget],
          cc: [],
          subject: sampleSubject,
          sent: true,
          messageId: mailRes.messageId,
          fromEmail: mailRes.fromEmail,
          providerUsed: mailRes.providerUsed,
        })
      }
    } else {
      for (const grp of groupsDetected) {
        const key = `${grp.storeId}::${grp.shift}`
        if (sentAlreadySet.has(key) && !forceResend) {
          emailsDispatched.push({
            storeId: grp.storeId,
            storeName: grp.storeName,
            shift: grp.shift,
            mode: 'live_escalera',
            to: grp.liveTo,
            cc: grp.liveCc,
            subject: `(Duplicado omitido) ${formatStoreDisplayName({ id: grp.storeId, name: grp.storeName }) || grp.storeName} (${grp.shift})`,
            sent: false,
            skippedDuplicate: true,
          })
          continue
        }

        const built = buildLiveShiftAlertEmailHtml(grp)
        try {
          const mailRes = await sendSystemEmail({
            fromName: 'Sistema de Monitoreo',
            to: grp.liveTo,
            cc: grp.liveCc.length > 0 ? grp.liveCc : undefined,
            bcc: grp.liveTo.includes(EXEC_COPY_EMAIL) ? undefined : EXEC_COPY_EMAIL,
            subject: built.subject,
            html: built.html,
          })

          const nowIso = new Date().toISOString()
          await supabase
            .from('missing_meat_modifier_alerts')
            .update({
              live_email_sent_at: nowIso,
              last_message_id: mailRes.messageId,
              updated_at: nowIso,
            })
            .eq('business_date', grp.businessDate)
            .eq('store_id', grp.storeId)
            .eq('shift', grp.shift)

          emailsDispatched.push({
            storeId: grp.storeId,
            storeName: grp.storeName,
            shift: grp.shift,
            mode: 'live_escalera',
            to: grp.liveTo,
            cc: grp.liveCc,
            subject: built.subject,
            sent: true,
            messageId: mailRes.messageId,
            fromEmail: mailRes.fromEmail,
            providerUsed: mailRes.providerUsed,
          })
        } catch (err: any) {
          emailsDispatched.push({
            storeId: grp.storeId,
            storeName: grp.storeName,
            shift: grp.shift,
            mode: 'live_escalera',
            to: grp.liveTo,
            cc: grp.liveCc,
            subject: built.subject,
            sent: false,
            error: err?.message || String(err),
          })
        }
      }
    }
  }

  return {
    businessDate,
    deliveryMode,
    dryRun,
    storesEvaluated: stores.length,
    storesWithIncidents: new Set(groupsDetected.map((g) => g.storeId)).size,
    groupsDetected,
    emailsDispatched,
  }
}
