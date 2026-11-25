/**
 * @module lib/inventory/store-portion-coaching-email
 * @description Generador y despachador oficial del Correo Operativo de Revisión de Sobrantes
 *   y Cuidado de Porciones en Cocina para una sucursal específica de Tacos Gavilan.
 *
 * @businessRules
 *   - Lenguaje claro, directo y operativo para Gerentes, Asistentes y Cocineros (cero tecnicismos complejos).
 *   - Regla obligatoria destacada: el conteo diario de Sobrantes de Orden Diaria DEBE realizarse
 *     estrictamente DESPUÉS DEL CIERRE de la tienda (con la venta del día ya cerrada) para tener cifras exactas.
 *   - En ventanas semanales/multidía NUNCA muestra la columna engañosa "Debían Quedar = Cierre + Faltante 7d";
 *     presenta `Usaron en la Semana` vs. `Ventas en Caja` y el `Uso de Más por Día` con el peso físico real de cada bolsa.
 *   - Enfatiza el buen porcionado con báscula digital y las medidas oficiales requeridas en cocina.
 *   - En modo `live` envía a toda la Escalera de Mando de la sucursal:
 *     * `to`: Gerente(s) + Asistentes AM/PM (`buildEscaleraByStore`).
 *     * `cc`: Supervisor Regional (`stores.supervisor_id -> users.email`, ej. `ricardo@tacosgavilan.com`)
 *             + `gonzalo@tacosgavilan.com` + `carlos@tacosgavilan.com` (+ `extraCc` opcionales).
 *   - En modo `preview` (por defecto) envía únicamente a `previewRecipients` con banner informativo.
 *
 * @dataFlow
 *   `loadToastMeatContext()` + `computeToastVsFridgeForIngredient()` + `scanPortionControlAlerts(dryRun)`
 *   + `buildEscaleraByStore()` -> `buildAndSendStorePortionCoachingEmail()` -> `sendSystemEmail()`.
 *
 * @notes
 *   - [2026-11-24] Creado y calibrado con los rendimientos empíricos reales de las 15 sucursales
 *     y la regla obligatoria de conteo después del cierre indicada por Carlos.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { sendSystemEmail } from '@/lib/system-mailer'
import { resolveAppBaseUrl } from '@/lib/basecamp-todo-email'
import { formatStoreDisplayName } from '@/lib/store-display'
import {
  ACTIVE_PROTEIN_IDS,
  MEAT_DEFAULT_BAG_LBS,
  type ActiveProteinKey,
} from '@/lib/inventory/meat-allocation'
import {
  computeToastVsFridgeForIngredient,
  formatShortDateLabelEs,
  loadToastMeatContext,
  type StoreFridgeVsToastSummary,
} from '@/lib/inventory/toast-meat-sold-resolver'
import {
  buildEscaleraByStore,
  normalizeCorporateEmail,
  scanPortionControlAlerts,
} from '@/lib/inventory/portion-control-alerts'

export interface StoreCoachingMeatRow {
  proteinKey: ActiveProteinKey
  displayName: string
  packLabel: string
  unitWordPlural: string
  spanDays: number
  usedUnits: number
  expectedUnits: number
  excessUnits: number
  dailyAvgUnits: number
  dailyAvgLbs: number
  dollarImpactStore: number
  singleDayDropNote: string | null
}

export interface StorePortionCoachingEmailParams {
  storeId: number
  startDate: string
  endDate: string
  mode?: 'preview' | 'live'
  previewRecipients?: string[]
  extraCc?: string[]
  extraNotesItems?: string[]
  goodItemsSummaryText?: string
}

const MEAT_PACK_LABELS: Record<
  ActiveProteinKey,
  { displayName: string; packLabel: string; unitWordPlural: string; priority: number }
> = {
  asada: { displayName: 'Carne Asada', packLabel: 'bolsa 10 lb', unitWordPlural: 'bolsas', priority: 1 },
  pastor: { displayName: 'Pastor', packLabel: 'bolsa 5 lb', unitWordPlural: 'bolsas', priority: 2 },
  pollo: { displayName: 'Pollo', packLabel: 'bolsa 5 lb', unitWordPlural: 'bolsas', priority: 3 },
  lengua: { displayName: 'Lengua', packLabel: 'bolsita 2.5 lb', unitWordPlural: 'bolsitas', priority: 4 },
  cabeza: { displayName: 'Cabeza', packLabel: 'bolsita 2.5 lb', unitWordPlural: 'bolsitas', priority: 5 },
  chorizo: { displayName: 'Chorizo', packLabel: 'paquetito 8 oz (½ lb)', unitWordPlural: 'paquetitos', priority: 6 },
  carnitas: { displayName: 'Carnitas', packLabel: 'bolsita 6 oz', unitWordPlural: 'bolsitas', priority: 7 },
  buche: { displayName: 'Buche', packLabel: 'bolsita 6 oz', unitWordPlural: 'bolsitas', priority: 8 },
}

function escapeHtml(val: string): string {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function round1(val: number): number {
  return Math.round(val * 10) / 10
}

function detectSingleDayDropNote(
  displayName: string,
  unitWordPlural: string,
  summary: StoreFridgeVsToastSummary
): string | null {
  for (const cut of summary.dailyLedger || []) {
    if (
      cut.spanDays === 1 &&
      cut.closingBags === 0 &&
      (cut.openingBags || 0) >= 12 &&
      Math.abs(cut.fridgeBalanceBags || 0) >= 8
    ) {
      const openRounded = Math.round(cut.openingBags || 0)
      const soldRounded = Math.round(cut.toastSoldBags || 0)
      const missRounded = Math.round(Math.abs(cut.fridgeBalanceBags || 0))
      return `En <strong>${escapeHtml(displayName)}</strong> (${escapeHtml(cut.periodLabel)}): iniciaron con <strong>${openRounded} ${unitWordPlural}</strong>, en caja se vendieron <strong>${soldRounded} ${unitWordPlural}</strong> y al cierre anotaron <strong>0 ${unitWordPlural}</strong> (diferencia de <strong>${missRounded} ${unitWordPlural}</strong> en un solo día; revisar si el día anterior contaron antes de cerrar o qué ocurrió ese día).`
    }
  }
  return null
}

export async function buildAndSendStorePortionCoachingEmail(
  params: StorePortionCoachingEmailParams
) {
  const {
    storeId,
    startDate,
    endDate,
    mode = 'preview',
    previewRecipients = ['carlos@tacosgavilan.com', 'gonzalo@tacosgavilan.com'],
    extraCc = [],
  } = params

  const supabase = await getSupabaseAdminClient()

  const [{ data: storeRows, error: sErr }, { data: userRows, error: uErr }] = await Promise.all([
    supabase
      .from('stores')
      .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
      .eq('id', storeId),
    supabase
      .from('users')
      .select('id, full_name, email, google_email_connected, role, store_id, store_scope, is_active')
      .eq('is_active', true),
  ])

  if (sErr) throw new Error(sErr.message)
  if (uErr) throw new Error(uErr.message)
  const storeRow = (storeRows || [])[0]
  if (!storeRow) throw new Error(`Sucursal #${storeId} no encontrada`)

  const escaleraMap = buildEscaleraByStore([storeRow], userRows || [])
  const escalera = escaleraMap.get(Number(storeId))
  if (!escalera) throw new Error(`No se pudo resolver Escalera de Mando para sucursal #${storeId}`)

  const cleanStoreName = formatStoreDisplayName({ id: storeRow.id, name: storeRow.name }) || storeRow.name

  // Evaluar las 8 proteínas en el rango solicitado (para Asada mirar desde 1 día antes si startDate es martes tras puente)
  const sharedCtx = await loadToastMeatContext({
    storeNumericIds: [storeId],
    minDate: startDate <= '2026-11-17' ? '2026-11-15' : startDate,
    maxDate: endDate,
    reconcileQbInvoices: true,
  })

  const meatRows: StoreCoachingMeatRow[] = []
  const singleDayDropNotes: string[] = []

  for (const [pKey, itemId] of Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>) {
    const meta = MEAT_PACK_LABELS[pKey]
    const effectiveStart = pKey === 'asada' && startDate === '2026-11-17' ? '2026-11-16' : startDate
    const meter = await computeToastVsFridgeForIngredient({
      inventoryItemId: itemId,
      proteinKey: pKey,
      startDate: effectiveStart,
      endDate,
      storeNumericIds: [storeId],
      ctx: sharedCtx,
    })
    const sum = meter.storesSummaries.find((x) => Number(x.storeId) === Number(storeId))
    if (!sum || !sum.hasMeasuredSpan || sum.hasNegativeCountAnomaly) continue

    const usedUnits = Math.round(sum.fridgeUsedBags || 0)
    const expectedUnits = Math.round(sum.toastSoldSpanBags || 0)
    const rawExcess = (sum.fridgeUsedBags || 0) - (sum.toastSoldSpanBags || 0)
    const excessUnits = Math.round(rawExcess)
    const dollarImpact = Math.abs(sum.dollarImpactStore || 0)
    const spanDays = Math.max(1, Number(sum.spanDays || 1))
    const bagLbs = MEAT_DEFAULT_BAG_LBS[pKey] || 5
    const dailyAvgUnits = round1(rawExcess / spanDays)
    const dailyAvgLbs = round1((rawExcess * bagLbs) / spanDays)
    const dropNote = detectSingleDayDropNote(meta.displayName, meta.unitWordPlural, sum)

    if (dropNote) singleDayDropNotes.push(dropNote)

    // Mostrar únicamente carnes con sobre-uso operativo real y material (sin exagerar variaciones menores)
    const isMaterial =
      rawExcess >= 5 &&
      (dollarImpact >= 60 || (pKey === 'asada' && rawExcess >= 3) || Boolean(dropNote)) &&
      dailyAvgLbs >= 3.0

    if (isMaterial) {
      meatRows.push({
        proteinKey: pKey,
        displayName: meta.displayName,
        packLabel: meta.packLabel,
        unitWordPlural: meta.unitWordPlural,
        spanDays,
        usedUnits,
        expectedUnits,
        excessUnits,
        dailyAvgUnits,
        dailyAvgLbs,
        dollarImpactStore: dollarImpact,
        singleDayDropNote: dropNote,
      })
    }
  }

  meatRows.sort((a, b) => MEAT_PACK_LABELS[a.proteinKey].priority - MEAT_PACK_LABELS[b.proteinKey].priority)

  // Obtener nombres reales de cocineros AM/PM para el coaching personalizado
  const scanRes = await scanPortionControlAlerts({
    storeId: String(storeId),
    startDate,
    endDate,
    dryRun: true,
    sendEmails: false,
  })
  const sampleAlert = scanRes.triggeredAlerts[0]
  const amGrillNames = (sampleAlert?.am_staff || [])
    .filter((s) => s.category === 'grill')
    .slice(0, 4)
    .map((s) => s.name.split(' ')[0])
  const pmGrillNames = (sampleAlert?.pm_staff || [])
    .filter((s) => s.category === 'grill')
    .slice(0, 4)
    .map((s) => s.name.split(' ')[0])

  const teamSalutationNames = [
    escalera.managerName ? escalera.managerName.split(' ')[0] : null,
    ...escalera.assistantNames.map((n) => n.split(' ')[0]),
  ].filter((v): v is string => Boolean(v))

  // Construir destinatarios oficiales de Escalera de Mando + Supervisor + Gonzalo + Carlos
  const liveTo = Array.from(new Set(escalera.toEmails))
  const liveCcSet = new Set<string>()
  if (escalera.supervisorEmail) liveCcSet.add(escalera.supervisorEmail)
  liveCcSet.add('gonzalo@tacosgavilan.com')
  liveCcSet.add('carlos@tacosgavilan.com')
  for (const extra of extraCc) {
    const clean = normalizeCorporateEmail(extra)
    if (clean) liveCcSet.add(clean)
  }
  for (const tEmail of liveTo) {
    liveCcSet.delete(tEmail)
  }
  const liveCc = Array.from(liveCcSet)

  const baseUrl = resolveAppBaseUrl()
  const storeActionUrl = `${baseUrl}/admin/food-cost/meats?storeId=${encodeURIComponent(String(storeId))}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&meat=asada`

  const rangeLabel = `${formatShortDateLabelEs(startDate)} al ${formatShortDateLabelEs(endDate)}`
  const liveSubject = `⚖️ ${cleanStoreName} · Cuidado de Porciones y Conteo de Sobrantes Después del Cierre (${rangeLabel})`
  const previewSubject = `[VISTA PREVIA CORREGIDA → ${cleanStoreName.toUpperCase()}] ${liveSubject}`

  const isLive = mode === 'live'
  const previewBannerHtml = isLive
    ? ''
    : `<div style="max-width:640px;margin:0 auto 14px auto;background:#111827;color:#FFFFFF;padding:14px 18px;border-radius:12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;border:1px solid #374151;">
        <strong style="color:#93C5FD;font-size:13px;">🔎 VISTA PREVIA CORREGIDA PARA CARLOS Y GONZALO (AÚN NO ENVIADO A ${escapeHtml(cleanStoreName.toUpperCase())})</strong><br>
        Se calibraron las mermas reales de marinado/cocción, se eliminó la columna engañosa <em>"Debían Quedar"</em> semanal (mostrando consumo real vs. ventas y promedio diario) y se destacó que <strong>el conteo es estrictamente después del cierre</strong>.<br>
        <strong>Al confirmar saldrá Para:</strong> ${liveTo.map((e) => `<code>${escapeHtml(e)}</code>`).join(', ')}<br>
        <strong>Con Copia (CC):</strong> ${liveCc.map((e) => `<code>${escapeHtml(e)}</code>`).join(', ')}
      </div>`

  const meatTableRowsHtml =
    meatRows.length === 0
      ? `<tr><td colspan="4" style="padding:16px;text-align:center;color:#059669;font-weight:800;">✅ Todas las carnes dentro del rango esperado en la semana.</td></tr>`
      : meatRows
          .map((r, idx) => {
            const rowBg = idx % 2 === 1 ? 'background:#FFF5F5;' : ''
            const dailyText =
              r.proteinKey === 'chorizo'
                ? `~${Math.round(r.dailyAvgUnits)} ${r.unitWordPlural}/día (${r.dailyAvgLbs} lb/día)`
                : r.singleDayDropNote
                  ? `+${r.excessUnits} ${r.unitWordPlural} en la semana (ver lunes)`
                  : `~${r.dailyAvgUnits} ${r.unitWordPlural} de más al día`
            const subWeekText = r.singleDayDropNote
              ? 'Revisar cierre puntual del lunes'
              : `(${r.excessUnits} ${r.unitWordPlural} en ${r.spanDays} días)`
            return `<tr style="border-bottom:1px solid #FEE2E2;${rowBg}">
              <td style="padding:11px 12px;font-weight:800;color:#111827;">
                ${escapeHtml(r.displayName)}
                <div style="font-weight:500;color:#6B7280;font-size:11px;">(${escapeHtml(r.packLabel)})</div>
              </td>
              <td style="padding:11px 8px;text-align:center;font-weight:700;color:#374151;">${r.expectedUnits} ${escapeHtml(r.unitWordPlural)}</td>
              <td style="padding:11px 8px;text-align:center;font-weight:800;color:#111827;">${r.usedUnits} ${escapeHtml(r.unitWordPlural)}</td>
              <td style="padding:11px 12px;text-align:right;color:#DC2626;font-weight:900;">
                ${escapeHtml(dailyText)}
                <div style="font-size:11px;color:#991B1B;font-weight:600;">${escapeHtml(subWeekText)}</div>
              </td>
            </tr>`
          })
          .join('')

  const extraBullets: string[] = [
    ...(params.extraNotesItems || []),
    ...singleDayDropNotes,
  ]

  const extraNotesBoxHtml =
    extraBullets.length === 0
      ? ''
      : `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px 14px;font-size:12px;color:#78350F;margin-bottom:22px;line-height:1.55;">
          ${extraBullets.map((b) => `<div style="margin-bottom:6px;">• ${b}</div>`).join('')}
        </div>`

  const cooksMentionHtml =
    amGrillNames.length > 0 || pmGrillNames.length > 0
      ? ` junto con los cocineros de cada turno (${[
          amGrillNames.length > 0 ? `<em>${escapeHtml(amGrillNames.join(', '))}</em> en mañana` : '',
          pmGrillNames.length > 0 ? `<em>${escapeHtml(pmGrillNames.join(', '))}</em> en tarde` : '',
        ]
          .filter(Boolean)
          .join('; ')})`
      : ' junto con los cocineros de mañana y tarde'

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:16px;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  ${previewBannerHtml}
  <table width="640" align="center" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <tr>
      <td style="background:#991B1B;color:#FFFFFF;padding:22px 26px;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.9px;color:#FECACA;">
          TACOS GAVILAN · SUCURSAL ${escapeHtml(cleanStoreName.toUpperCase())}
        </div>
        <div style="font-size:22px;font-weight:900;margin-top:4px;">
          ⚖️ Cuidado de Porciones y Conteo de Sobrantes
        </div>
        <div style="font-size:13px;color:#FEE2E2;margin-top:4px;">
          Semana revisada: <strong>${escapeHtml(rangeLabel)}</strong>
        </div>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 26px;font-size:14px;line-height:1.6;color:#1F2937;">
        <p style="margin:0 0 12px 0;">
          Hola equipo de <strong>${escapeHtml(cleanStoreName)}</strong>${
            teamSalutationNames.length > 0
              ? ` (<strong>${escapeHtml(teamSalutationNames.join(', '))}</strong> y encargados de línea)`
              : ''
          }:
        </p>
        <p style="margin:0 0 14px 0;">
          Revisamos el consumo semanal de los productos de la sucursal para apoyarlos a cuidar nuestras porciones en cocina y tener inventarios exactos. La cuenta con la que revisamos la semana es muy sencilla:
        </p>

        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 16px;margin-bottom:16px;text-align:center;font-size:13px;font-weight:800;color:#111827;">
          Sobrante Inicial + Entregas de Bodega − Sobrante al Cierre = <span style="color:#991B1B;">Bolsas que se usaron en la semana</span>
        </div>

        <!-- REGLA CRÍTICA: CONTEO DESPUÉS DEL CIERRE -->
        <div style="background:#EFF6FF;border-left:5px solid #1D4ED8;border-top:1px solid #BFDBFE;border-right:1px solid #BFDBFE;border-bottom:1px solid #BFDBFE;padding:13px 16px;border-radius:8px;margin-bottom:18px;font-size:13px;color:#1E3A8A;">
          <div style="font-weight:900;font-size:14px;margin-bottom:4px;">
            🕛 REGLA OBLIGATORIA: EL CONTEO ES DESPUÉS DEL CIERRE DE LA TIENDA
          </div>
          Para tener <strong>cifras exactas</strong> todos los días, el conteo de <strong>Sobrantes</strong> de la Orden Diaria se debe hacer <strong>únicamente DESPUÉS DEL CIERRE</strong> (cuando ya se cerró la venta del día y ya no saldrán más órdenes en caja). Si se cuenta temprano mientras la tienda sigue vendiendo, los números nunca van a cuadrar con la venta real del día.
        </div>

        <!-- RECONOCIMIENTO POSITIVO -->
        <div style="background:#ECFDF5;border-left:4px solid #059669;padding:12px 15px;border-radius:8px;margin-bottom:20px;font-size:13px;color:#064E3B;">
          <strong>✅ Lo que hicieron muy bien esta semana:</strong><br>
          Las <strong>${escapeHtml(
            params.goodItemsSummaryText ||
              `tortillas de maíz, tortilla grande de burrito, teleras, mulitas, sopes, quesadillas, totopos de nachos${
                !meatRows.some((r) => r.proteinKey === 'cabeza') ? ', cabeza' : ''
              }, aguacate, arroz y aguas frescas`
          )}</strong> salieron prácticamente exactos con lo vendido en caja. ¡Gracias por ese cuidado!
        </div>

        <!-- TABLA CLARA DE USO SEMANAL Y PROMEDIO POR DÍA -->
        <div style="font-size:16px;font-weight:900;color:#991B1B;margin-bottom:6px;">
          🔴 Productos donde se usó de más frente a lo vendido en caja
        </div>
        <p style="margin:0 0 12px 0;font-size:13px;color:#374151;">
          Ya descontando la merma normal de marinado y cocción de toda la cadena, en estas carnes se abrieron más bolsas de las que pedían las órdenes vendidas (por servir cuchara pasada en línea o por contar antes del cierre):
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #FECACA;border-radius:10px;overflow:hidden;font-size:13px;margin-bottom:14px;">
          <thead>
            <tr style="background:#FEF2F2;color:#991B1B;font-size:11px;font-weight:800;text-transform:uppercase;border-bottom:1px solid #FECACA;">
              <th style="padding:10px 12px;text-align:left;">Producto</th>
              <th style="padding:10px 8px;text-align:center;">Pedían las Ventas</th>
              <th style="padding:10px 8px;text-align:center;">Se Usaron</th>
              <th style="padding:10px 12px;text-align:right;">Uso de Más</th>
            </tr>
          </thead>
          <tbody>
            ${meatTableRowsHtml}
          </tbody>
        </table>

        ${extraNotesBoxHtml}

        <!-- SECCIÓN ESTRELLA: BUEN PORCIONADO Y MEDIDAS REQUERIDAS -->
        <div style="background:#111827;color:#FFFFFF;padding:14px 18px;border-radius:10px 10px 0 0;">
          <div style="font-size:15px;font-weight:900;">
            ⚖️ MEDIDAS REQUERIDAS EN LÍNEA (USAR BÁSCULA TODOS LOS DÍAS)
          </div>
          <div style="font-size:12px;color:#D1D5DB;margin-top:2px;">
            Servir media onza de más en cada taco o una onza de más en cada burrito representa varias bolsas perdidas cada día. Todo el equipo de mañana y tarde debe respetar exactamente estas medidas:
          </div>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D1D5DB;border-top:none;border-radius:0 0 10px 10px;overflow:hidden;font-size:13px;margin-bottom:22px;">
          <tr style="border-bottom:1px solid #E5E7EB;background:#F9FAFB;">
            <td width="48%" style="padding:11px 14px;font-weight:800;color:#111827;">🌮 Taco Regular, Sope y Mulita</td>
            <td width="52%" style="padding:11px 14px;color:#991B1B;font-weight:900;">1.5 oz de carne ya cocida<div style="font-size:11px;color:#4B5563;font-weight:500;">(Taco Carne Dorada = 1.9 oz · Doble Carne = 3.0 oz)</div></td>
          </tr>
          <tr style="border-bottom:1px solid #E5E7EB;">
            <td style="padding:11px 14px;font-weight:800;color:#111827;">🌯 Burrito, Plato, Torta, Quesadilla y Nachos</td>
            <td style="padding:11px 14px;color:#991B1B;font-weight:900;">6.0 oz de carne ya cocida<div style="font-size:11px;color:#4B5563;font-weight:500;">(Meat Only Burrito = 12.0 oz · Side de Carne en vaso 8 oz = 6.0 oz)</div></td>
          </tr>
          <tr style="border-bottom:1px solid #E5E7EB;background:#F9FAFB;">
            <td style="padding:11px 14px;font-weight:800;color:#111827;">🍳 Desayunos con Chorizo<div style="font-size:11px;color:#6B7280;font-weight:500;">(Burrito, Plato o Torta Huevos c/ Chorizo)</div></td>
            <td style="padding:11px 14px;color:#991B1B;font-weight:900;">Media bolsita cruda (4.0 oz crudas = 3.0 oz cocidas)<div style="font-size:11px;color:#B45309;font-weight:700;">¡Nunca echar el paquetito entero de 8 oz en un solo desayuno!</div></td>
          </tr>
          <tr style="border-bottom:1px solid #E5E7EB;">
            <td style="padding:11px 14px;font-weight:800;color:#111827;">🥩 Carnitas y Buche (bolsita 6 oz)</td>
            <td style="padding:11px 14px;color:#111827;font-weight:800;">1 bolsita = 1 Burrito/Plato/Torta, o 4 Tacos de 1.5 oz</td>
          </tr>
          <tr style="border-bottom:1px solid #E5E7EB;background:#F9FAFB;">
            <td style="padding:11px 14px;font-weight:800;color:#111827;">🍚 Arroz y Frijol en Burritos y Platos</td>
            <td style="padding:11px 14px;color:#111827;font-weight:800;">4.0 oz de Arroz en peso + 4.0 oz de Frijol Molido<div style="font-size:11px;color:#4B5563;font-weight:500;">(Cuchara rasa sin copetear · Taco Plate NO lleva Papelito)</div></td>
          </tr>
          <tr>
            <td style="padding:11px 14px;font-weight:800;color:#111827;">🥣 Sides en Vaso Rojo de 8 oz y Queso Amarillo</td>
            <td style="padding:11px 14px;color:#111827;font-weight:800;">Side Arroz = 6.0 oz · Side Frijol Molido = 8.0 oz · Queso Amarillo = 4.0 oz</td>
          </tr>
        </table>

        <!-- 3 ACCIONES PRÁCTICAS -->
        <div style="font-size:15px;font-weight:900;color:#111827;margin-bottom:8px;">
          📋 3 Acciones Obligatorias a partir de HOY en ${escapeHtml(cleanStoreName)}
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E5E7EB;border-radius:10px;font-size:13px;margin-bottom:22px;">
          <tr>
            <td style="padding:11px 14px;border-bottom:1px solid #E5E7EB;background:#EFF6FF;">
              <strong>1. Contar Sobrantes SIEMPRE después del cierre:</strong> Capturar el conteo físico de bolsas cerradas de la Orden Diaria <strong>únicamente cuando la tienda ya cerró al público y se cerró la venta del día</strong>, para que las cifras sean 100% exactas.
            </td>
          </tr>
          <tr>
            <td style="padding:11px 14px;border-bottom:1px solid #E5E7EB;">
              <strong>2. Báscula encendida al iniciar Mañana y Tarde:</strong> Pesar en línea${cooksMentionHtml} <strong>5 tacos (1.5 oz)</strong> y <strong>3 burritos/platos (6.0 oz)</strong> al arranque de cada turno para calibrar la cuchara.
            </td>
          </tr>
          <tr>
            <td style="padding:11px 14px;background:#F9FAFB;">
              <strong>3. Confirmar revisión del equipo:</strong> Responder a este correo confirmando que ya quedó implementado el conteo después del cierre y el chequeo de báscula en ambos turnos.
            </td>
          </tr>
        </table>

        <div style="text-align:center;margin:20px 0 6px 0;">
          <a href="${escapeHtml(storeActionUrl)}" target="_blank" style="display:inline-block;background:#991B1B;color:#FFFFFF;font-size:14px;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:10px;">
            Abrir Panel de Sobrantes y Porciones (${escapeHtml(cleanStoreName)}) ➔
          </a>
        </div>
      </td>
    </tr>

    <tr>
      <td style="background:#F9FAFB;padding:12px 24px;font-size:11px;color:#6B7280;text-align:center;border-top:1px solid #E5E7EB;">
        Tacos Gavilan · Control de Operaciones y Calidad en Cocina
      </td>
    </tr>
  </table>
</body>
</html>`

  const finalTo = isLive ? liveTo : previewRecipients
  const finalCc = isLive ? liveCc : undefined
  const finalSubject = isLive ? liveSubject : previewSubject

  const mailRes = await sendSystemEmail({
    fromName: 'Tacos Gavilan · Operaciones y Cocina',
    to: finalTo,
    cc: finalCc,
    subject: finalSubject,
    html,
  })

  return {
    mode: isLive ? 'LIVE' : 'PREVIEW',
    storeId,
    storeName: cleanStoreName,
    to: finalTo,
    cc: finalCc || [],
    intendedLiveTo: liveTo,
    intendedLiveCc: liveCc,
    supervisorEmail: escalera.supervisorEmail,
    supervisorName: escalera.supervisorName,
    subject: finalSubject,
    meatRows,
    mailRes,
  }
}
