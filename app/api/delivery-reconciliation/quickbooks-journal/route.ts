/**
 * @module app/api/delivery-reconciliation/quickbooks-journal/route
 * @description Endpoint seguro e idempotente para previsualizar, auditar y publicar en QuickBooks Online
 *              las Pólizas Semanales de Liquidación de Plataformas Delivery (`Settlement Journal Entries` para Uber Eats, DoorDash y Grubhub).
 *
 * @businessRules
 * 1. Seguridad de Servidor (Fail-Closed Session + DB Active User + Role Matrix + Store Scope):
 *    - Protegido con `authorizeDeliveryReconciliationRequest` tanto en `GET` (`permission: 'read'`) como en `POST` (`permission: 'publish_journal'`).
 *    - Verifica firma criptográfica HS256 y expiración del JWT (`teg_token`), confirma usuario activo en `public.users` (`is_active !== false`), valida matriz de rol por acción (`publish_journal` restringido a `admin`, `supervisor`, `accounting`, `contador`) y aislamiento por sucursal (`store_id`).
 *    - Nunca confía en montos, cuentas o banderas enviadas por el cliente; todo se recalcula en el servidor desde Supabase.
 * 2. Estructura Oficial en QuickBooks Online (Tacos Gavilan):
 *    - **Línea 1 (DEBIT/CREDIT)**: Cuenta Bancaria de la Sucursal (`10000`–`10017`, ej. `10014 Norwalk` `QB_ID: 378`) por `net_payout_amount`.
 *    - **Línea 2 (DEBIT)**: Cuenta de Comisiones (`50039 Uber Eats Fee` `ID 353` | `50036 Doordash Fees` `ID 375` | `50037 Grubhub Fees` `ID 374`) por `|total_fees|`.
 *    - **Línea 3 (CREDIT/DEBIT)**: Cuenta por Cobrar (`12050 Uber Eats` `ID 349` | `12053 DoorDash` `ID 372` | `12054 Grubhub` `ID 373`) por el Bruto Reconocido.
 *    - **Línea 4 (DEBIT/CREDIT)**: Cuenta de Ventas (`40060 Sales-Uber Eats` `ID 277` | `40062 Sales - Doordash` `ID 370` | `40063 Sales - Grubhub` `ID 371`) por el neto de `error_charges + adjustments_amount`.
 * 3. Cero Estimaciones de Impuestos (`1.1025` eliminado):
 *    - Uber Eats es Marketplace Facilitator: el impuesto retenido jamás genera `24001 Sales tax payable` para Tacos Gavilan (`$0.00`).
 *    - DoorDash y Grubhub: la reversión de Sales Tax en reembolsos (`splitTaxOnRefunds`) usa exclusivamente el impuesto real por orden (`platform_tax_paid_to_merchant` / `toast_tax`) de las órdenes descontadas vinculadas al payout. Si no existe desglose real por orden, se bloquea la separación fiscal automática (`MISSING_REAL_REFUND_TAX_BREAKDOWN`).
 * 4. Bloqueo Estricto de Publicación (`publishBlockers`):
 *    - Se bloquea publicar a QBO si la póliza no está balanceada al centavo (`< $0.005`), si falta tienda o `payout_reference_id`, si falta tax real donde aplique, si hay coincidencias ambiguas o no verificadas, si la cobertura de órdenes está incompleta, o si existe una diferencia sin decisión explícita de revisión.
 * 5. Idempotencia y Persistencia Verificada:
 *    - Llave única por corte: `TEG-JE-${platform}-S${store_id}-${payout_reference_id}`.
 *    - Reserva/lock en Supabase (`qb_publish_status = 'IN_PROGRESS'`) antes de llamar a QBO.
 *    - Detección exacta en QBO por `qb_journal_entry_id`, `idempotencyKey` en `PrivateNote` o `payout_reference_id` + tienda + cuenta CxC (sin heurísticas de monto `±$1.00`).
 *    - Verificación post-publicación en Supabase; si QBO crea la póliza pero falla la persistencia en DB, devuelve estado explícito `RECOVERY_REQUIRED` en lugar de éxito falso.
 *
 * @dataFlow
 * - GET `/api/delivery-reconciliation/quickbooks-journal` -> Cruza `delivery_platform_payouts` + `delivery_platform_orders` (paginados con `fetchAllSupabaseRows`) + QBO `JournalEntry`.
 * - POST `/api/delivery-reconciliation/quickbooks-journal` -> Valida bloqueos, adquiere lock idempotente, publica en QBO y confirma persistencia en Supabase.
 *
 * @notes
 * - No incluye ninguna columna autogenerada (`GENERATED ALWAYS AS`) en mutaciones SQL.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeDeliveryReconciliationRequest } from '@/lib/auth-server'
import { getAuthClient } from '@/lib/quickbooks'
import { getQBStoreRefs } from '@/lib/qb-classes-locations'
import {
  DeliveryPlatformCode,
  fetchAllSupabaseRows,
  getStorePlatformMappings,
  round2,
} from '@/lib/delivery-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface PlatformQBConfig {
  receivableAccountNum: string
  receivableQbId: string
  receivableName: string
  feeAccountNum: string
  feeQbId: string
  feeName: string
  salesAccountNum: string
  salesQbId: string
  salesName: string
  settlementTitle: string
  refundLineTitle: string
}

const PLATFORM_QB_CONFIG: Record<DeliveryPlatformCode, PlatformQBConfig> = {
  UBER_EATS: {
    receivableAccountNum: '12050',
    receivableQbId: '349',
    receivableName: 'Receivables Due from Uber Eats',
    feeAccountNum: '50039',
    feeQbId: '353',
    feeName: 'Uber Eats Fee',
    salesAccountNum: '40060',
    salesQbId: '277',
    salesName: 'Sales-Uber Eats',
    settlementTitle: 'Uber Eats Settlement',
    refundLineTitle: 'Uber Eats Settlement - CUSTOMER REFUNDS',
  },
  DOORDASH: {
    receivableAccountNum: '12053',
    receivableQbId: '372',
    receivableName: 'Receivables Due from Doordash',
    feeAccountNum: '50036',
    feeQbId: '375',
    feeName: 'Doordash Fees',
    salesAccountNum: '40062',
    salesQbId: '370',
    salesName: 'Sales - Doordash',
    settlementTitle: 'Doordash Statement',
    refundLineTitle: 'Doordash Statement - ERROR CHARGES',
  },
  GRUBHUB: {
    receivableAccountNum: '12054',
    receivableQbId: '373',
    receivableName: 'Receivables Due from Grubhub',
    feeAccountNum: '50037',
    feeQbId: '374',
    feeName: 'Grubhub Fees',
    salesAccountNum: '40063',
    salesQbId: '371',
    salesName: 'Sales - Grubhub',
    settlementTitle: 'Grubhub Settlement',
    refundLineTitle: 'Grubhub Settlement - REFUNDS',
  },
}

const SALES_TAX_PAYABLE_QB = {
  accountNum: '24001',
  qbId: '40',
  name: 'Sales tax payable',
}

function fmtShortPeriodDot(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const parts = String(isoDate).slice(0, 10).split('-')
  if (parts.length !== 3) return String(isoDate)
  return `${parts[1]}.${parts[2]}.${parts[0].slice(2)}`
}

export function buildPayoutIdempotencyKey(
  platform: string,
  storeId: number,
  payoutReferenceId: string
): string {
  const cleanPlat = String(platform || 'UNKNOWN').trim().toUpperCase()
  const cleanRef = String(payoutReferenceId || '').trim()
  return `TEG-JE-${cleanPlat}-S${Number(storeId || 0)}-${cleanRef}`
}

export function matchExistingJournalEntryStrict(params: {
  payout: any
  storeLocationId: string
  receivableQbId: string
  qbJournalEntries: any[]
}): any | null {
  const { payout, storeLocationId, receivableQbId, qbJournalEntries } = params
  if (!Array.isArray(qbJournalEntries) || qbJournalEntries.length === 0) return null

  const savedQbId = payout.raw_payload?.qb_journal_entry_id
  if (savedQbId) {
    const byId = qbJournalEntries.find((je) => String(je.Id) === String(savedQbId))
    if (byId) return byId
  }

  const payoutRef = String(payout.payout_reference_id || '').trim()
  if (!payoutRef) return null

  const idempotencyKey = buildPayoutIdempotencyKey(payout.platform, Number(payout.store_id), payoutRef)
  const savedDocNumber = String(payout.raw_payload?.qb_doc_number || '').trim()

  for (const je of qbJournalEntries) {
    const privateNote = String(je.PrivateNote || '')
    const docNum = String(je.DocNumber || '').trim()
    const lines: any[] = Array.isArray(je.Line) ? je.Line : []

    // 1. Match por llave de idempotencia exacta en PrivateNote
    if (privateNote.includes(idempotencyKey)) {
      return je
    }

    // Verificar que la póliza corresponda exactamente a la sucursal (DepartmentRef) y cuenta CxC de la plataforma
    const hasExactStoreAndPlatformAccount = lines.some(
      (l) =>
        String(l?.JournalEntryLineDetail?.DepartmentRef?.value) === String(storeLocationId) &&
        String(l?.JournalEntryLineDetail?.AccountRef?.value) === String(receivableQbId)
    )
    if (!hasExactStoreAndPlatformAccount) continue

    // 2. Match por referencia exacta del payout en PrivateNote (ej. "#U6KV2P7BG77XLAW")
    if (payoutRef.length >= 4 && privateNote.includes(`#${payoutRef}`)) {
      return je
    }

    // 3. Match por DocNumber previamente registrado en el payout + sucursal + cuenta CxC
    if (savedDocNumber && docNum === savedDocNumber) {
      return je
    }
  }

  return null
}

async function getValidQuickBooksToken(): Promise<{ token: string; realmId: string }> {
  const { data: integ, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('service_name', 'quickbooks')
    .single()

  if (error || !integ || !integ.access_token) {
    throw new Error('No active QuickBooks token found. Please re-authenticate.')
  }

  let token = integ.access_token
  const realmId = integ.realm_id

  if (new Date(integ.expires_at) <= new Date(Date.now() + 60000)) {
    const authClient = getAuthClient()
    const refreshRes = await authClient.refreshUsingToken(integ.refresh_token)
    const newTokens = refreshRes.getJson()
    token = newTokens.access_token

    await supabaseAdmin
      .from('integrations')
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', integ.id)
  }

  return { token, realmId }
}

export interface SettlementJournalLinePreview {
  lineNumber: number
  accountNumber: string
  accountQbId: string
  accountName: string
  postingType: 'Debit' | 'Credit'
  amount: number
  description: string
  locationName: string
  locationId: string
  className: string
  classId: string
}

export interface PublishBlocker {
  code: string
  message_es: string
  message_en: string
}

/**
 * Verifica si una orden con diferencia tiene aprobación persistida en servidor compatible:
 * - Usuario aprobador + fecha/hora
 * - Motivo obligatorio (>= 5 caracteres)
 * - Monto aprobado coincidente (±$0.02)
 * - Payout reference coincidente
 * - Evidencia disponible
 */
export function hasValidOrderVarianceApproval(o: any): boolean {
  const va = o?.raw_payload?.variance_approval
  if (!va || va.approved !== true) return false
  if (!va.approved_by_email || !va.approved_at) return false
  if (typeof va.reason !== 'string' || va.reason.trim().length < 5) return false
  if (!va.evidence || typeof va.evidence !== 'string') return false
  const orderPayoutRef = String(o?.payout_reference_id || '').trim()
  const approvedPayoutRef = String(va.payout_reference_id || '').trim()
  if (orderPayoutRef && approvedPayoutRef !== orderPayoutRef) return false
  const grossVar = round2(Number(o?.gross_diff ?? o?.gross_variance ?? 0))
  const approvedAmt = round2(Number(va.approved_amount ?? 0))
  return Math.abs(grossVar - approvedAmt) <= 0.02
}

/**
 * Verifica si un corte (payout) con diferencia tiene aprobación persistida en servidor compatible.
 */
export function hasValidPayoutVarianceApproval(payout: any): boolean {
  const va = payout?.raw_payload?.variance_approval
  if (!va || va.approved !== true) return false
  if (!va.approved_by_email || !va.approved_at) return false
  if (typeof va.reason !== 'string' || va.reason.trim().length < 5) return false
  if (!va.evidence || typeof va.evidence !== 'string') return false
  const payoutRef = String(payout?.payout_reference_id || '').trim()
  const approvedRef = String(va.payout_reference_id || '').trim()
  if (!payoutRef || approvedRef !== payoutRef) return false
  const grossVar = round2(Number(payout?.gross_variance ?? 0))
  const approvedAmt = round2(Number(va.approved_amount ?? 0))
  return Math.abs(grossVar - approvedAmt) <= 0.02
}

/**
 * Adquiere un lock de publicación QBO verdaderamente atómico en PostgreSQL/Supabase mediante
 * `UPDATE ... WHERE` condicional.
 * Solo tiene éxito cuando:
 * 1. El payout sigue pendiente (`status` en `PENDING`, `POSTED`, `RECONCILED`);
 * 2. No existe `raw_payload->>qb_journal_entry_id`;
 * 3. No existe lock activo (`raw_payload->>qb_publish_status` nulo/PENDING/FAILED, o lock expirado >120s con CAS exacto);
 * 4. La llave idempotente coincide (o es nula).
 * Verifica estrictamente que el número de filas afectadas sea === 1 antes de llamar a QuickBooks.
 */
export async function acquireAtomicPayoutPublishLock(params: {
  payoutId: string
  currentRawPayload: Record<string, any>
  idempotencyKey: string
  userEmail: string
  userId: string | number | null
  userRole: string | null
}): Promise<{
  acquired: boolean
  affectedRows: number
  lockedRow?: Record<string, any>
  reason?: string
}> {
  const { payoutId, currentRawPayload, idempotencyKey, userEmail, userId, userRole } = params
  const lockTimestamp = new Date().toISOString()

  const curStatus = currentRawPayload?.qb_publish_status
  const curLockAt = currentRawPayload?.qb_publish_lock_at
  const isStaleLock =
    curStatus === 'IN_PROGRESS' &&
    curLockAt &&
    Date.now() - new Date(curLockAt).getTime() >= 120000

  if (curStatus === 'IN_PROGRESS' && !isStaleLock) {
    return {
      acquired: false,
      affectedRows: 0,
      reason: 'Publicación en curso para este corte (lock idempotente activo). Evitando duplicado.',
    }
  }

  const nextRawPayload = {
    ...(currentRawPayload || {}),
    qb_idempotency_key: idempotencyKey,
    qb_publish_status: 'IN_PROGRESS',
    qb_publish_lock_at: lockTimestamp,
    qb_publish_initiated_by: userEmail,
    qb_publish_initiated_by_user_id: userId,
    qb_publish_initiated_by_role: userRole,
  }

  const curIdempKey = currentRawPayload?.qb_idempotency_key
  if (curIdempKey && String(curIdempKey) !== idempotencyKey) {
    return {
      acquired: false,
      affectedRows: 0,
      reason: `Conflicto de llave idempotente: esperada ${idempotencyKey}, actual ${curIdempKey}.`,
    }
  }

  let query = supabaseAdmin
    .from('delivery_platform_payouts')
    .update({
      raw_payload: nextRawPayload,
      updated_at: lockTimestamp,
    })
    .eq('id', payoutId)
    .in('status', ['PENDING', 'POSTED', 'RECONCILED', 'REQUIRES_REVIEW'])
    .filter('raw_payload->>qb_journal_entry_id', 'is', null)

  if (!curIdempKey) {
    query = query.filter('raw_payload->>qb_idempotency_key', 'is', null)
  } else {
    query = query.eq('raw_payload->>qb_idempotency_key', idempotencyKey)
  }

  if (isStaleLock && curLockAt) {
    query = query
      .eq('raw_payload->>qb_publish_status', 'IN_PROGRESS')
      .eq('raw_payload->>qb_publish_lock_at', String(curLockAt))
  } else if (!curStatus) {
    query = query.filter('raw_payload->>qb_publish_status', 'is', null)
  } else if (curStatus === 'PENDING' || curStatus === 'FAILED') {
    query = query.eq('raw_payload->>qb_publish_status', String(curStatus))
  } else {
    return {
      acquired: false,
      affectedRows: 0,
      reason: `El corte ya tiene estado de publicación ${curStatus}.`,
    }
  }

  const { data: lockedRows, error } = await query.select('id, raw_payload')
  if (error) {
    return {
      acquired: false,
      affectedRows: 0,
      reason: `Error adquiriendo lock atómico en Supabase: ${error.message}`,
    }
  }

  const affectedRows = Array.isArray(lockedRows) ? lockedRows.length : 0
  if (affectedRows !== 1) {
    return {
      acquired: false,
      affectedRows,
      reason: 'Otro proceso concurrente adquirió el lock o el corte ya fue publicado.',
    }
  }

  return {
    acquired: true,
    affectedRows: 1,
    lockedRow: lockedRows[0],
  }
}

export function buildPayoutJournalPreview(params: {
  payout: any
  storeName: string
  storeOrders: any[]
  splitTaxOnRefunds?: boolean
  platformSyncStatus?: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NOT_CONNECTED'
  platformSyncCause?: string
}) {
  const {
    payout,
    storeName,
    storeOrders,
    splitTaxOnRefunds = false,
    platformSyncStatus,
    platformSyncCause,
  } = params
  const plat = (payout.platform as DeliveryPlatformCode) || 'UBER_EATS'
  const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
  const storeRefs = getQBStoreRefs(storeName)
  const payoutRef = String(payout.payout_reference_id || '').trim()
  const storeIdNum = Number(payout.store_id || 0)
  const idempotencyKey = buildPayoutIdempotencyKey(plat, storeIdNum, payoutRef)

  const parseRawMoney = (val: any): number | null => {
    if (typeof val === 'number' && Number.isFinite(val)) return round2(val)
    if (typeof val === 'string' && val.trim()) {
      const cleaned = val.replace(/[^0-9.-]/g, '')
      const n = Number(cleaned)
      if (Number.isFinite(n)) return round2(n)
    }
    return null
  }

  const netPayout = round2(Number(payout.net_payout_amount || 0))

  let totalFees = round2(
    Math.abs(
      Number(payout.commission_fees || 0) +
        Number(payout.delivery_fees || 0) +
        Number(payout.processing_fees || 0) +
        Number(payout.marketing_fees || 0)
    )
  )
  if (plat === 'UBER_EATS' && payout.raw_payload?.uberFees !== undefined) {
    const uFees = Math.abs(parseRawMoney(payout.raw_payload.uberFees) ?? 0)
    const uMkt = Math.abs(parseRawMoney(payout.raw_payload.marketing) ?? 0)
    if (uFees + uMkt > 0) {
      totalFees = round2(uFees + uMkt)
    }
  }

  let receivableCredit = 0
  let rawErrAdj = 0

  if (plat === 'UBER_EATS') {
    const grossEarnings = parseRawMoney(payout.raw_payload?.earnings)
    const facTax = Number(payout.tax_remitted_by_platform || 0)
    if (grossEarnings !== null && grossEarnings > 0 && facTax > 0) {
      receivableCredit = round2(grossEarnings - facTax)
      rawErrAdj = round2(netPayout + totalFees - receivableCredit)
    } else {
      rawErrAdj = round2(Number(payout.error_charges || 0) + Number(payout.adjustments_amount || 0))
      receivableCredit = round2(netPayout + totalFees - rawErrAdj)
    }
  } else {
    rawErrAdj = round2(Number(payout.error_charges || 0) + Number(payout.adjustments_amount || 0))
    receivableCredit = round2(netPayout + totalFees - rawErrAdj)
  }

  // Órdenes vinculadas estrictamente por payout_reference_id (o reembolsadas en este payout_reference_id)
  // Prohibido agregar órdenes al payout solo por caer dentro de [period_start, period_end]
  const settledOrdersInCut = storeOrders.filter(
    (o) =>
      o.platform === plat &&
      o.match_confidence !== 'TOAST_ONLY' &&
      o.reconciliation_status !== 'MISSING_IN_PLATFORM' &&
      Boolean(payoutRef) &&
      (String(o.payout_reference_id || '').trim() === payoutRef ||
        String(o.raw_payload?.reimbursement_payout_ref || '').trim() === payoutRef)
  )

  const deductedOrders = settledOrdersInCut.filter(
    (o) =>
      String(o.payout_reference_id || '').trim() === payoutRef &&
      (Number(o.error_charge || 0) < -0.01 ||
        Number(o.adjustment_amount || 0) !== 0 ||
        o.reconciliation_status === 'REFUNDED_OR_DISPUTED' ||
        o.is_disputed)
  )

  // Impuesto REAL de órdenes descontadas en este corte (CERO tasa fija 1.1025)
  // Para Uber Eats siempre es $0.00 porque Uber es Marketplace Facilitator.
  const deductedOrdersRealTax =
    plat === 'UBER_EATS'
      ? 0
      : round2(
          deductedOrders
            .filter((o) => Number(o.error_charge || 0) < -0.01)
            .reduce(
              (acc, o) =>
                acc +
                Number(
                  o.platform_tax_paid_to_merchant > 0
                    ? o.platform_tax_paid_to_merchant
                    : o.toast_tax || 0
                ),
              0
            )
        )

  const explicitStatementRefundTax =
    plat === 'UBER_EATS' ? 0 : round2(Number(payout.raw_payload?.refund_tax_actual || 0))

  const embeddedRefundTax =
    plat === 'UBER_EATS'
      ? 0
      : deductedOrdersRealTax > 0
      ? deductedOrdersRealTax
      : explicitStatementRefundTax > 0
      ? explicitStatementRefundTax
      : 0

  const pStartDot = fmtShortPeriodDot(payout.period_start || payout.payout_date)
  const pEndDot = fmtShortPeriodDot(payout.period_end || payout.payout_date)
  const periodPrefix = pStartDot && pEndDot ? `${pStartDot}-${pEndDot} ` : ''

  const lines: SettlementJournalLinePreview[] = [
    {
      lineNumber: 1,
      accountNumber: storeRefs.bankAccount,
      accountQbId: storeRefs.bankAccountQbId,
      accountName: `${storeRefs.bankAccount} ${storeRefs.bankAccountName.replace(/^\d+\s*-\s*/, '')}`,
      postingType: netPayout >= 0 ? 'Debit' : 'Credit',
      amount: Math.abs(netPayout),
      description: cfg.settlementTitle,
      locationName: storeRefs.locationName,
      locationId: storeRefs.locationId,
      className: storeRefs.className,
      classId: storeRefs.classId,
    },
    {
      lineNumber: 2,
      accountNumber: cfg.feeAccountNum,
      accountQbId: cfg.feeQbId,
      accountName: `${cfg.feeAccountNum} ${cfg.feeName}`,
      postingType: 'Debit',
      amount: totalFees,
      description: cfg.settlementTitle,
      locationName: storeRefs.locationName,
      locationId: storeRefs.locationId,
      className: storeRefs.className,
      classId: storeRefs.classId,
    },
    {
      lineNumber: 3,
      accountNumber: cfg.receivableAccountNum,
      accountQbId: cfg.receivableQbId,
      accountName: `${cfg.receivableAccountNum} ${cfg.receivableName}`,
      postingType: receivableCredit >= 0 ? 'Credit' : 'Debit',
      amount: Math.abs(receivableCredit),
      description: `${periodPrefix}${cfg.settlementTitle}`,
      locationName: storeRefs.locationName,
      locationId: storeRefs.locationId,
      className: storeRefs.className,
      classId: storeRefs.classId,
    },
  ]

  if (Math.abs(rawErrAdj) >= 0.01) {
    if (
      splitTaxOnRefunds &&
      plat !== 'UBER_EATS' &&
      rawErrAdj < 0 &&
      embeddedRefundTax > 0.01 &&
      embeddedRefundTax < Math.abs(rawErrAdj)
    ) {
      const subtotalPortion = round2(Math.abs(rawErrAdj) - embeddedRefundTax)
      lines.push({
        lineNumber: 4,
        accountNumber: cfg.salesAccountNum,
        accountQbId: cfg.salesQbId,
        accountName: `${cfg.salesAccountNum} ${cfg.salesName}`,
        postingType: 'Debit',
        amount: subtotalPortion,
        description: `${cfg.refundLineTitle} (Subtotal excl. Real Tax)`,
        locationName: storeRefs.locationName,
        locationId: storeRefs.locationId,
        className: storeRefs.className,
        classId: storeRefs.classId,
      })
      lines.push({
        lineNumber: 5,
        accountNumber: SALES_TAX_PAYABLE_QB.accountNum,
        accountQbId: SALES_TAX_PAYABLE_QB.qbId,
        accountName: `${SALES_TAX_PAYABLE_QB.accountNum} ${SALES_TAX_PAYABLE_QB.name}`,
        postingType: 'Debit',
        amount: embeddedRefundTax,
        description: `${cfg.refundLineTitle} (Reversión Sales Tax Real 24001)`,
        locationName: storeRefs.locationName,
        locationId: storeRefs.locationId,
        className: storeRefs.className,
        classId: storeRefs.classId,
      })
    } else {
      lines.push({
        lineNumber: 4,
        accountNumber: cfg.salesAccountNum,
        accountQbId: cfg.salesQbId,
        accountName: `${cfg.salesAccountNum} ${cfg.salesName}`,
        postingType: rawErrAdj < 0 ? 'Debit' : 'Credit',
        amount: Math.abs(rawErrAdj),
        description: cfg.refundLineTitle,
        locationName: storeRefs.locationName,
        locationId: storeRefs.locationId,
        className: storeRefs.className,
        classId: storeRefs.classId,
      })
    }
  }

  const totalDebits = round2(
    lines.filter((l) => l.postingType === 'Debit').reduce((acc, l) => acc + l.amount, 0)
  )
  const totalCredits = round2(
    lines.filter((l) => l.postingType === 'Credit').reduce((acc, l) => acc + l.amount, 0)
  )
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.005

  // Órdenes de Toast pendientes en la ventana de fechas (solo informativo para saber si faltan órdenes en plataforma)
  const pStart = payout.period_start || payout.payout_date || ''
  const pEnd = payout.period_end || payout.payout_date || ''
  const unpaidToastOrders = storeOrders.filter(
    (o) =>
      o.platform === plat &&
      pStart &&
      pEnd &&
      o.business_date >= pStart &&
      o.business_date <= pEnd &&
      (o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM')
  )

  const crossPayoutRefunds: Array<{
    orderCode: string
    orderDate: string | null
    amount: number
    description: string
  }> = Array.isArray(payout.raw_payload?.cross_payout_refunds)
    ? payout.raw_payload.cross_payout_refunds
    : []

  const unpaidToastSubtotal = round2(
    unpaidToastOrders.reduce((acc, o) => acc + Number(o.toast_net_sales || 0), 0)
  )
  const unpaidToastTax = round2(
    unpaidToastOrders.reduce((acc, o) => acc + Number(o.toast_tax || 0), 0)
  )

  const adjustmentsInCut = round2(Number(payout.adjustments_amount || 0))
  const chargebacksInCut = round2(rawErrAdj - adjustmentsInCut)

  // Evaluar bloqueos contables reales de la póliza de 4 líneas (publishBlockers) vs alertas informativas de auditoría orden por orden (auditWarnings)
  const publishBlockers: PublishBlocker[] = []
  const auditWarnings: PublishBlocker[] = []

  if (!isBalanced) {
    publishBlockers.push({
      code: 'UNBALANCED_JOURNAL',
      message_es: `La póliza no está cuadrada al centavo (Débitos: $${totalDebits.toFixed(2)} vs Créditos: $${totalCredits.toFixed(2)}).`,
      message_en: `Journal Entry is not balanced to the cent (Debits: $${totalDebits.toFixed(2)} vs Credits: $${totalCredits.toFixed(2)}).`,
    })
  }

  if (storeIdNum <= 0 || !storeRefs.locationId || !storeRefs.bankAccountQbId) {
    publishBlockers.push({
      code: 'MISSING_STORE_OR_MAPPING',
      message_es: 'Falta sucursal asignada o mapeo de cuenta bancaria/ubicación en QuickBooks.',
      message_en: 'Missing assigned store or QuickBooks bank account/location mapping.',
    })
  }

  if (!payoutRef || payoutRef === '--' || payoutRef.startsWith('SYNTH')) {
    publishBlockers.push({
      code: 'MISSING_PAYOUT_REFERENCE',
      message_es: 'Falta payout_reference_id oficial del settlement de la plataforma.',
      message_en: 'Missing official platform settlement payout_reference_id.',
    })
  }

  if (splitTaxOnRefunds && plat !== 'UBER_EATS' && rawErrAdj < -0.01 && embeddedRefundTax <= 0) {
    publishBlockers.push({
      code: 'MISSING_REAL_REFUND_TAX_BREAKDOWN',
      message_es: 'No hay impuesto real por orden vinculada para separar el Sales Tax del reembolso (prohibido estimar 10.25%).',
      message_en: 'No real order-level tax found to split Sales Tax on refund (estimating 10.25% is prohibited).',
    })
  }

  // Alertas informativas de auditoría orden por orden (NO bloquean la creación de la póliza semanal de 4 líneas)
  const declaredOrdersCount = Number(payout.orders_count || 0)
  const declaredSubtotal = Math.abs(Number(payout.subtotal_sales || 0))
  const declaredGross = Math.abs(Number(payout.platform_gross_receivable || 0))
  if ((declaredOrdersCount > 0 || declaredSubtotal > 0.01 || declaredGross > 0.01) && settledOrdersInCut.length === 0) {
    auditWarnings.push({
      code: 'INCOMPLETE_ORDER_COVERAGE',
      message_es: `Alerta informativa: El corte declara ${declaredOrdersCount || 'múltiples'} orden(es), pero existen 0 órdenes vinculadas por payout_reference_id (#${payoutRef}).`,
      message_en: `Informative alert: Payout declares ${declaredOrdersCount || 'multiple'} order(s), but has 0 linked orders by payout_reference_id (#${payoutRef}).`,
    })
  }

  const effectiveSyncStatus = platformSyncStatus || payout.raw_payload?.sync_status
  if (effectiveSyncStatus === 'PARTIAL' || effectiveSyncStatus === 'FAILED') {
    auditWarnings.push({
      code: 'PLATFORM_SYNC_INCOMPLETE',
      message_es: `Alerta informativa (${effectiveSyncStatus}): ${platformSyncCause || payout.raw_payload?.sync_cause || 'La sincronización de órdenes de esta plataforma/sucursal está parcial o pendiente.'}`,
      message_en: `Informative alert (${effectiveSyncStatus}): ${platformSyncCause || payout.raw_payload?.sync_cause || 'Order synchronization for this platform/store is partial or pending.'}`,
    })
  }

  const hasMissingTaxFlag =
    Boolean(payout.raw_payload?.missing_tax_breakdown) ||
    payout.raw_payload?.tax_breakdown_verified === false ||
    settledOrdersInCut.some(
      (o) => Boolean(o.raw_payload?.missing_tax_breakdown) || o.raw_payload?.tax_breakdown_verified === false
    )

  const isDdOrGhMissingTax =
    (plat === 'DOORDASH' || plat === 'GRUBHUB') &&
    ((Number(payout.subtotal_sales || 0) > 0 &&
      Number(payout.tax_paid_to_merchant || 0) <= 0 &&
      Number(payout.tax_collected || 0) <= 0 &&
      settledOrdersInCut.every((o) => Number(o.platform_tax_paid_to_merchant || 0) <= 0)) ||
      settledOrdersInCut.some(
        (o) =>
          o.transaction_type === 'ORDER' &&
          Number(o.platform_subtotal || 0) > 0 &&
          (o.raw_payload?.tax_breakdown_verified === false || o.raw_payload?.missing_tax_breakdown === true)
      ))

  if (hasMissingTaxFlag || isDdOrGhMissingTax) {
    auditWarnings.push({
      code: 'MISSING_REAL_TAX_BREAKDOWN',
      message_es: `Alerta informativa: Falta desglose de Sales Tax orden por orden en ${plat} (la póliza usa los totales oficiales del estado de cuenta).`,
      message_en: `Informative alert: Missing order-by-order Sales Tax breakdown for ${plat} (Journal Entry uses official statement totals).`,
    })
  }

  const ambiguousOrUnverifiedOrders = settledOrdersInCut.filter(
    (o) =>
      (o.match_confidence === 'AMBIGUOUS' ||
        o.match_confidence === 'UNVERIFIED_NO_ID' ||
        o.reconciliation_status === 'REQUIRES_REVIEW') &&
      o.raw_payload?.explicit_review_decision !== 'CONFIRM_TOAST_MATCH' &&
      !hasValidOrderVarianceApproval(o)
  )
  if (ambiguousOrUnverifiedOrders.length > 0) {
    auditWarnings.push({
      code: 'AMBIGUOUS_OR_UNVERIFIED_MATCH',
      message_es: `Alerta informativa: ${ambiguousOrUnverifiedOrders.length} orden(es) con coincidencia ambigua o sin ID verificable pendientes de revisión en Toast.`,
      message_en: `Informative alert: ${ambiguousOrUnverifiedOrders.length} order(s) with ambiguous or unverified Toast ID matching pending review.`,
    })
  }

  const payoutVarianceApprovedInDb = hasValidPayoutVarianceApproval(payout)
  const unreviewedVarianceOrders = settledOrdersInCut.filter(
    (o) =>
      (o.reconciliation_status === 'AMOUNT_MISMATCH' ||
        o.reconciliation_status === 'TAX_MISMATCH' ||
        (o.reconciliation_status === 'MISSING_IN_TOAST' && o.transaction_type === 'ORDER') ||
        Math.abs(Number(o.gross_diff ?? o.gross_variance ?? 0)) > 0.05) &&
      !hasValidOrderVarianceApproval(o) &&
      !payoutVarianceApprovedInDb
  )
  const payoutGrossVar = round2(Number(payout.gross_variance || 0))
  const hasUnapprovedPayoutLevelVariance =
    Math.abs(payoutGrossVar) > 0.05 &&
    !payoutVarianceApprovedInDb &&
    (settledOrdersInCut.length === 0 || unreviewedVarianceOrders.length > 0)

  if (unreviewedVarianceOrders.length > 0 || hasUnapprovedPayoutLevelVariance) {
    auditWarnings.push({
      code: 'UNREVIEWED_VARIANCE',
      message_es:
        unreviewedVarianceOrders.length > 0
          ? `Alerta informativa: ${unreviewedVarianceOrders.length} orden(es) en este corte tienen diferencia de monto/impuesto vs Toast pendiente de revisión.`
          : `Alerta informativa: El corte presenta una diferencia bruta vs Toast de $${payoutGrossVar.toFixed(2)} pendiente de revisión.`,
      message_en:
        unreviewedVarianceOrders.length > 0
          ? `Informative alert: ${unreviewedVarianceOrders.length} order(s) in this payout have an unreviewed amount/tax variance vs Toast.`
          : `Informative alert: Payout has a gross variance vs Toast of $${payoutGrossVar.toFixed(2)} pending review.`,
    })
  }

  return {
    idempotencyKey,
    txnDate: payout.period_end || payout.payout_date || new Date().toISOString().slice(0, 10),
    lines,
    totalDebits,
    totalCredits,
    isBalanced,
    canPublish: publishBlockers.length === 0,
    publishBlockers,
    auditWarnings,
    receivableCredit,
    rawErrAdj,
    chargebacksInCut,
    adjustmentsInCut,
    embeddedRefundTax,
    auditBreakdown: {
      settledOrdersCount: settledOrdersInCut.length || Number(payout.orders_count || 0),
      linkedOrdersExactCount: settledOrdersInCut.length,
      deductedOrders: deductedOrders.map((o) => ({
        id: o.id,
        platform_order_id: o.platform_order_id,
        business_date: o.business_date,
        toast_display_number: o.toast_display_number,
        toast_tab_name: o.toast_tab_name,
        toast_net_sales: Number(o.toast_net_sales || 0),
        toast_tax: Number(o.toast_tax || 0),
        platform_subtotal: Number(o.platform_subtotal || 0),
        platform_tax_paid_to_merchant: Number(o.platform_tax_paid_to_merchant || 0),
        error_charge: Number(o.error_charge || 0),
        adjustment_amount: Number(o.adjustment_amount || 0),
        net_payout: Number(o.net_payout || 0),
        dispute_status: o.dispute_status,
        dispute_reason: o.dispute_reason,
        reimbursement_payout_ref: o.raw_payload?.reimbursement_payout_ref || null,
        reimbursement_amount: o.raw_payload?.reimbursement_amount || null,
      })),
      crossPayoutRefunds,
      unpaidToastOrdersCount: unpaidToastOrders.length,
      unpaidToastSubtotal,
      unpaidToastTax,
      deductedOrdersToastTax: deductedOrdersRealTax,
      totalAtRiskTax: round2(
        (plat !== 'UBER_EATS' ? deductedOrdersRealTax : 0) +
          (plat !== 'UBER_EATS' ? unpaidToastTax : 0)
      ),
      unpaidToastOrdersSample: unpaidToastOrders.slice(0, 15).map((o) => ({
        id: o.id,
        platform_order_id: o.platform_order_id,
        business_date: o.business_date,
        toast_display_number: o.toast_display_number,
        toast_tab_name: o.toast_tab_name,
        toast_net_sales: Number(o.toast_net_sales || 0),
        toast_tax: Number(o.toast_tax || 0),
        toast_expected_gross: Number(o.toast_expected_gross || 0),
      })),
    },
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('store_id')
    const platformParam = searchParams.get('platform')
    const statusParam = searchParams.get('status') || 'ALL'
    const startDate = searchParams.get('start_date') || ''
    const endDate = searchParams.get('end_date') || ''
    const search = (searchParams.get('search') || '').trim().toLowerCase()

    const requestedStoreNum =
      storeIdParam && storeIdParam !== 'ALL' && Number.isFinite(Number(storeIdParam)) && Number(storeIdParam) > 0
        ? Number(storeIdParam)
        : null

    const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
      permission: 'read',
      allowCron: false,
      targetStoreIds: requestedStoreNum ? [requestedStoreNum] : [],
    })
    if (!auth.authorized || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'No autorizado', code: auth.code },
        { status: auth.status || 401 }
      )
    }

    const mappings = await getStorePlatformMappings()
    const storeNameMap = new Map<number, { name: string; code: string }>()
    for (const m of mappings) {
      storeNameMap.set(m.store_id, { name: m.store_name, code: m.store_code })
    }

    const selectedStoreNum = auth.user.canAccessAllStores
      ? requestedStoreNum
      : auth.user.store_id

    const rawPayoutsAll = await fetchAllSupabaseRows<any>((from, to) => {
      let q = supabaseAdmin
        .from('delivery_platform_payouts')
        .select('*')
        .order('period_end', { ascending: false })
        .order('payout_date', { ascending: false })
        .order('id', { ascending: true })
      if (selectedStoreNum !== null && selectedStoreNum > 0) {
        q = q.eq('store_id', selectedStoreNum)
      }
      if (platformParam && platformParam !== 'ALL') {
        q = q.eq('platform', platformParam)
      }
      return q.range(from, to)
    })

    const rawPayouts = (rawPayoutsAll || []).filter((p: any) => {
      if (search && search.length >= 2) return true
      if (!startDate && !endDate) return true
      const pEnd = p.period_end || ''
      const pStart = p.period_start || pEnd
      const pPay = p.payout_date || ''
      const effStart = startDate || '2020-01-01'
      const effEnd = endDate || '2099-12-31'
      if (pStart && pEnd) {
        if (pStart < pEnd && effStart < effEnd) {
          return pStart < effEnd && pEnd > effStart
        }
        return pStart <= effEnd && pEnd >= effStart
      }
      if (pPay) {
        return pPay >= effStart && pPay <= effEnd
      }
      return true
    })

    let minQbDate = startDate || '2026-09-01'
    let maxQbDate = endDate || new Date().toISOString().slice(0, 10)
    for (const p of rawPayouts) {
      const ps = p.period_start || p.payout_date || ''
      const pe = p.payout_date || p.period_end || ''
      if (ps && ps < minQbDate) minQbDate = ps
      if (pe && pe > maxQbDate) maxQbDate = pe
    }
    const minQbDateBuffered = new Date(new Date(`${minQbDate}T12:00:00Z`).getTime() - 7 * 86400000)
      .toISOString()
      .slice(0, 10)
    const maxQbDateBuffered = new Date(new Date(`${maxQbDate}T12:00:00Z`).getTime() + 14 * 86400000)
      .toISOString()
      .slice(0, 10)

    const activePayoutRefs = Array.from(
      new Set(
        rawPayouts
          .map((p: any) => String(p.payout_reference_id || '').trim())
          .filter((r: string) => Boolean(r) && r !== '--')
      )
    )

    const [ordersInDateRange, ordersByPayoutRef] = await Promise.all([
      fetchAllSupabaseRows<any>((from, to) => {
        let q = supabaseAdmin
          .from('delivery_platform_orders')
          .select('*')
          .neq('match_confidence', 'TOAST_ONLY')
          .gte('business_date', minQbDateBuffered)
          .lte('business_date', maxQbDateBuffered)
          .order('business_date', { ascending: false })
          .order('id', { ascending: true })
        if (selectedStoreNum !== null && selectedStoreNum > 0) {
          q = q.eq('store_id', selectedStoreNum)
        }
        if (platformParam && platformParam !== 'ALL') {
          q = q.eq('platform', platformParam)
        }
        return q.range(from, to)
      }),
      activePayoutRefs.length > 0 && activePayoutRefs.length <= 200
        ? fetchAllSupabaseRows<any>((from, to) => {
            let q = supabaseAdmin
              .from('delivery_platform_orders')
              .select('*')
              .neq('match_confidence', 'TOAST_ONLY')
              .in('payout_reference_id', activePayoutRefs)
              .order('business_date', { ascending: false })
              .order('id', { ascending: true })
            if (selectedStoreNum !== null && selectedStoreNum > 0) {
              q = q.eq('store_id', selectedStoreNum)
            }
            if (platformParam && platformParam !== 'ALL') {
              q = q.eq('platform', platformParam)
            }
            return q.range(from, to)
          })
        : Promise.resolve([]),
    ])

    const rawOrdersMap = new Map<string, any>()
    for (const o of ordersInDateRange || []) {
      if (o?.id) rawOrdersMap.set(String(o.id), o)
    }
    for (const o of ordersByPayoutRef || []) {
      if (o?.id) rawOrdersMap.set(String(o.id), o)
    }
    const rawOrders = Array.from(rawOrdersMap.values())

    let qbJournalEntries: any[] = []
    let qbDeposits: any[] = []
    let isAuthError = false
    let qbErrorMsg: string | null = null
    let nextSuggestedDocNumber = '20261060'

    try {
      const { token, realmId } = await getValidQuickBooksToken()
      for (const startPos of [1, 1001]) {
        const q = encodeURIComponent(
          `select * from JournalEntry where TxnDate >= '${minQbDateBuffered}' and TxnDate <= '${maxQbDateBuffered}' orderby TxnDate desc startposition ${startPos} maxresults 1000`
        )
        const qbRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${q}&minorversion=75`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (qbRes.status === 401) {
          isAuthError = true
          qbErrorMsg = 'La sesión de QuickBooks Online ha expirado. Por favor reconecta la cuenta.'
          break
        } else if (qbRes.ok) {
          const qbJson = await qbRes.json()
          const pageEntries: any[] = qbJson?.QueryResponse?.JournalEntry || []
          qbJournalEntries.push(...pageEntries)
          if (pageEntries.length < 1000) break
        } else {
          break
        }
      }

      if (!isAuthError) {
        const qDep = encodeURIComponent(
          `select * from Deposit where TxnDate >= '${minQbDateBuffered}' and TxnDate <= '${maxQbDateBuffered}' orderby TxnDate desc maxresults 1000`
        )
        const depRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${qDep}&minorversion=75`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (depRes.ok) {
          const depJson = await depRes.json()
          qbDeposits = depJson?.QueryResponse?.Deposit || []
        }
      }

      if (qbJournalEntries.length > 0) {
        let maxNum = 20261000
        for (const je of qbJournalEntries) {
          const doc = String(je.DocNumber || '').trim()
          if (/^2026\d{4}$/.test(doc)) {
            const n = parseInt(doc, 10)
            if (n > maxNum) maxNum = n
          }
        }
        nextSuggestedDocNumber = String(maxNum + 1)
      }
    } catch (qbErr: any) {
      const msg = String(qbErr?.message || '')
      if (
        msg.includes('token') ||
        msg.includes('auth') ||
        msg.includes('invalid_grant') ||
        msg.includes('401') ||
        msg.includes('re-authenticate')
      ) {
        isAuthError = true
        qbErrorMsg = 'La sesión de QuickBooks Online ha expirado. Por favor reconecta la cuenta.'
      }
    }

    const ordersByStore = new Map<number, any[]>()
    for (const o of rawOrders || []) {
      const sId = Number(o.store_id)
      const arr = ordersByStore.get(sId) || []
      arr.push(o)
      ordersByStore.set(sId, arr)
    }

    let enrichedRecords = (rawPayouts || []).map((p: any) => {
      const storeMeta = storeNameMap.get(p.store_id) || { name: `Store #${p.store_id}`, code: '' }
      const storeRefs = getQBStoreRefs(storeMeta.name)
      const plat = (p.platform as DeliveryPlatformCode) || 'UBER_EATS'
      const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
      const storeOrders = ordersByStore.get(p.store_id) || []

      const preview = buildPayoutJournalPreview({
        payout: p,
        storeName: storeMeta.name,
        storeOrders,
        splitTaxOnRefunds: false,
      })

      // Detección estricta en QBO usando ID guardado, llave idempotente o referencia exacta del payout + tienda + cuenta CxC
      const savedQbId = p.raw_payload?.qb_journal_entry_id
      const matchedJe = matchExistingJournalEntryStrict({
        payout: p,
        storeLocationId: storeRefs.locationId,
        receivableQbId: cfg.receivableQbId,
        qbJournalEntries,
      })

      const hasJournalEntry = Boolean(matchedJe || savedQbId)
      const publishStatus = p.raw_payload?.qb_publish_status || (hasJournalEntry ? 'PUBLISHED' : 'PENDING')
      const recoveryRequired = publishStatus === 'RECOVERY_REQUIRED'

      const qbJournalEntry = matchedJe
        ? {
            id: String(matchedJe.Id),
            docNumber: String(matchedJe.DocNumber || p.raw_payload?.qb_doc_number || ''),
            txnDate: String(matchedJe.TxnDate || preview.txnDate),
            totalAmount: preview.totalDebits,
          }
        : savedQbId
        ? {
            id: String(savedQbId),
            docNumber: String(p.raw_payload?.qb_doc_number || ''),
            txnDate: String(p.raw_payload?.qb_txn_date || preview.txnDate),
            totalAmount: preview.totalDebits,
          }
        : null

      const netPayoutAbs = round2(Math.abs(Number(p.net_payout_amount || 0)))
      const matchedQbDeposit = (qbDeposits || []).find((dep: any) => {
        const depAcctId = String(dep?.DepositToAccountRef?.value || '')
        const depAmt = round2(Math.abs(Number(dep?.TotalAmt || 0)))
        return depAcctId === String(storeRefs.bankAccountQbId) && Math.abs(depAmt - netPayoutAbs) <= 0.05
      })

      const jeBankDebitVerified = matchedJe
        ? (Array.isArray(matchedJe.Line) ? matchedJe.Line : []).some(
            (l: any) =>
              String(l?.JournalEntryLineDetail?.AccountRef?.value || '') === String(storeRefs.bankAccountQbId) &&
              Math.abs(round2(Number(l?.Amount || 0)) - netPayoutAbs) <= 0.05
          )
        : false

      const bankStatus: 'VERIFIED_IN_BANK' | 'JE_POSTED_IN_TRANSIT' | 'NOT_POSTED' =
        matchedQbDeposit || jeBankDebitVerified
          ? 'VERIFIED_IN_BANK'
          : hasJournalEntry
          ? 'JE_POSTED_IN_TRANSIT'
          : 'NOT_POSTED'

      const bankVerification = {
        status: bankStatus,
        bankAccountNum: storeRefs.bankAccount,
        bankAccountName: `${storeRefs.bankAccount} ${storeRefs.bankAccountName.replace(/^\d+\s*-\s*/, '')}`,
        expectedDepositAmount: round2(Number(p.net_payout_amount || 0)),
        matchedDepositId: matchedQbDeposit
          ? String(matchedQbDeposit.Id)
          : jeBankDebitVerified && matchedJe
          ? String(matchedJe.DocNumber || matchedJe.Id)
          : null,
        matchedDepositDate: matchedQbDeposit
          ? String(matchedQbDeposit.TxnDate || '')
          : jeBankDebitVerified && matchedJe
          ? String(matchedJe.TxnDate || preview.txnDate)
          : null,
        matchedDepositAmount: matchedQbDeposit
          ? round2(Number(matchedQbDeposit.TotalAmt || 0))
          : jeBankDebitVerified
          ? round2(Number(p.net_payout_amount || 0))
          : null,
      }

      return {
        id: p.id,
        store_id: p.store_id,
        store_name: storeMeta.name,
        store_code: storeMeta.code,
        platform: plat,
        payout_reference_id: p.payout_reference_id,
        period_start: p.period_start,
        period_end: p.period_end,
        payout_date: p.payout_date,
        net_payout_amount: Number(p.net_payout_amount || 0),
        platform_gross_receivable: preview.receivableCredit,
        total_fees: round2(
          Math.abs(
            Number(p.commission_fees || 0) +
              Number(p.delivery_fees || 0) +
              Number(p.processing_fees || 0) +
              Number(p.marketing_fees || 0)
          )
        ),
        net_refunds_adjustments: preview.rawErrAdj,
        hasJournalEntry,
        publishStatus,
        recoveryRequired,
        canPublish: !hasJournalEntry && preview.canPublish,
        publishBlockers: preview.publishBlockers,
        auditWarnings: preview.auditWarnings,
        qbJournalEntry,
        bankVerification,
        journalPreview: preview,
      }
    })

    if (search) {
      enrichedRecords = enrichedRecords.filter((r) => {
        const audit = r.journalPreview?.auditBreakdown || {}
        const hasOrderMatch =
          (audit.deductedOrders || []).some(
            (o: any) =>
              String(o.platform_order_id || '').toLowerCase().includes(search) ||
              String(o.toast_display_number || '').toLowerCase().includes(search) ||
              String(o.toast_tab_name || '').toLowerCase().includes(search)
          ) ||
          (audit.crossPayoutRefunds || []).some(
            (cr: any) =>
              String(cr.orderCode || '').toLowerCase().includes(search) ||
              String(cr.description || '').toLowerCase().includes(search)
          )
        return (
          String(r.payout_reference_id || '').toLowerCase().includes(search) ||
          String(r.store_name || '').toLowerCase().includes(search) ||
          String(r.platform || '').toLowerCase().includes(search) ||
          String(r.period_start || '').toLowerCase().includes(search) ||
          String(r.period_end || '').toLowerCase().includes(search) ||
          String(r.payout_date || '').toLowerCase().includes(search) ||
          String(r.qbJournalEntry?.docNumber || '').toLowerCase().includes(search) ||
          String(r.qbJournalEntry?.id || '').toLowerCase().includes(search) ||
          hasOrderMatch
        )
      })
    }

    if (statusParam && statusParam !== 'ALL') {
      enrichedRecords = enrichedRecords.filter((r) => {
        const audit = r.journalPreview?.auditBreakdown || {}
        if (statusParam === 'QB_CREATED') return r.hasJournalEntry
        if (statusParam === 'QB_PENDING') return !r.hasJournalEntry
        if (statusParam === 'QB_BLOCKED') return !r.hasJournalEntry && !r.canPublish
        if (statusParam === 'MATCHED') return Math.abs(r.net_refunds_adjustments || 0) < 0.01 && r.canPublish
        if (statusParam === 'REFUNDED_OR_DISPUTED') {
          return (
            Math.abs(r.net_refunds_adjustments || 0) >= 0.01 ||
            (audit.deductedOrders?.length || 0) > 0 ||
            (audit.crossPayoutRefunds?.length || 0) > 0
          )
        }
        if (statusParam === 'TAX_MISMATCH' || statusParam === 'MISSING_IN_PLATFORM') {
          return (audit.totalAtRiskTax || 0) > 0.01 || (audit.unpaidToastOrdersCount || 0) > 0
        }
        return true
      })
    }

    const createdCount = enrichedRecords.filter((r) => r.hasJournalEntry).length
    const pendingCount = enrichedRecords.length - createdCount
    const blockedCount = enrichedRecords.filter((r) => !r.hasJournalEntry && !r.canPublish).length

    return NextResponse.json({
      success: true,
      isAuthError,
      reauthUrl: '/api/integrations/quickbooks/auth',
      qbErrorMsg,
      nextSuggestedDocNumber,
      records: enrichedRecords,
      summary: {
        totalCount: enrichedRecords.length,
        createdCount,
        pendingCount,
        blockedCount,
        readyToPublishCount: pendingCount - blockedCount,
        totalNetPayout: round2(
          enrichedRecords.reduce((acc, r) => acc + Number(r.net_payout_amount || 0), 0)
        ),
        pendingNetPayout: round2(
          enrichedRecords
            .filter((r) => !r.hasJournalEntry)
            .reduce((acc, r) => acc + Number(r.net_payout_amount || 0), 0)
        ),
      },
    })
  } catch (error: any) {
    console.error('[GET /api/delivery-reconciliation/quickbooks-journal] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al obtener pólizas de liquidación de QuickBooks',
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
      permission: 'publish_journal',
      allowCron: false,
    })
    if (!auth.authorized || !auth.user) {
      return NextResponse.json(
        { success: false, error: auth.error || 'No autorizado', code: auth.code },
        { status: auth.status || 401 }
      )
    }

    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Payload inválido' }, { status: 400 })
    }

    const payoutIds: string[] = Array.isArray(body.payoutIds)
      ? Array.from(new Set(body.payoutIds.map((id: any) => String(id).trim()).filter(Boolean)))
      : body.payoutId
      ? [String(body.payoutId).trim()]
      : []

    if (payoutIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Debe seleccionar al menos un corte para crear el Journal Entry.' },
        { status: 400 }
      )
    }

    const customTxnDate: string | undefined =
      typeof body.txnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.txnDate.trim())
        ? body.txnDate.trim()
        : undefined
    const customDocNumber: string | undefined =
      typeof body.docNumber === 'string' && body.docNumber.trim()
        ? body.docNumber.trim().slice(0, 21)
        : undefined
    const splitTaxOnRefunds: boolean = Boolean(body.splitTaxOnRefunds)
    // P0-2: Prohibido aceptar explicitVarianceApproved desde el cliente; se consulta únicamente en DB.

    const { token, realmId } = await getValidQuickBooksToken()
    const mappings = await getStorePlatformMappings()
    const storeNameMap = new Map<number, string>()
    for (const m of mappings) {
      storeNameMap.set(m.store_id, m.store_name)
    }

    const { data: payouts, error: payErr } = await supabaseAdmin
      .from('delivery_platform_payouts')
      .select('*')
      .in('id', payoutIds)

    if (payErr || !payouts || payouts.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No se encontraron los cortes seleccionados en la base de datos.' },
        { status: 404 }
      )
    }

    // Cargar órdenes reales de las sucursales involucradas para validar bloqueos e impuestos reales
    const involvedStoreIds = Array.from(new Set(payouts.map((p: any) => Number(p.store_id)).filter((s) => s > 0)))
    const storeScopeAuth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
      permission: 'publish_journal',
      allowCron: false,
      targetStoreIds: involvedStoreIds,
    })
    if (!storeScopeAuth.authorized) {
      return NextResponse.json(
        { success: false, error: storeScopeAuth.error || 'No autorizado para la sucursal del corte', code: storeScopeAuth.code },
        { status: storeScopeAuth.status || 403 }
      )
    }
    const storeOrdersAll = involvedStoreIds.length > 0
      ? await fetchAllSupabaseRows<any>((from, to) =>
          supabaseAdmin
            .from('delivery_platform_orders')
            .select('*')
            .neq('match_confidence', 'TOAST_ONLY')
            .in('store_id', involvedStoreIds)
            .range(from, to)
        )
      : []

    const ordersByStore = new Map<number, any[]>()
    for (const o of storeOrdersAll) {
      const sId = Number(o.store_id)
      const arr = ordersByStore.get(sId) || []
      arr.push(o)
      ordersByStore.set(sId, arr)
    }

    // Consultar JournalEntries recientes en QBO para garantizar idempotencia y número secuencial
    let existingQbJournals: any[] = []
    let runningDocNum = 20261060
    try {
      const q = encodeURIComponent(
        `select * from JournalEntry orderby TxnDate desc maxresults 500`
      )
      const r = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${q}&minorversion=75`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      )
      if (r.ok) {
        const j = await r.json()
        existingQbJournals = j?.QueryResponse?.JournalEntry || []
        for (const je of existingQbJournals) {
          const doc = String(je.DocNumber || '').trim()
          if (/^2026\d{4}$/.test(doc)) {
            const n = parseInt(doc, 10)
            if (n >= runningDocNum) runningDocNum = n + 1
          }
        }
      }
    } catch {}

    const results: Array<{
      payoutId: string
      payoutRef: string
      storeName: string
      platform: string
      idempotencyKey: string
      success: boolean
      alreadyPublished?: boolean
      recoveryRequired?: boolean
      status: 'PUBLISHED' | 'ALREADY_PUBLISHED' | 'BLOCKED' | 'RECOVERY_REQUIRED' | 'ERROR'
      journalEntry?: { id: string; docNumber: string; txnDate: string }
      blockers?: PublishBlocker[]
      error?: string
    }> = []

    for (let idx = 0; idx < payouts.length; idx++) {
      // 1. Re-leer fila fresca de DB para prevenir condiciones de carrera (race conditions)
      const { data: freshPayout } = await supabaseAdmin
        .from('delivery_platform_payouts')
        .select('*')
        .eq('id', payouts[idx].id)
        .single()

      const p = freshPayout || payouts[idx]
      const plat = (p.platform as DeliveryPlatformCode) || 'UBER_EATS'
      const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
      const storeName = storeNameMap.get(p.store_id) || `Store #${p.store_id}`
      const storeRefs = getQBStoreRefs(storeName)
      const storeOrders = ordersByStore.get(p.store_id) || []
      const idempotencyKey = buildPayoutIdempotencyKey(plat, Number(p.store_id), p.payout_reference_id)

      const preview = buildPayoutJournalPreview({
        payout: p,
        storeName,
        storeOrders,
        splitTaxOnRefunds,
      })

      // 2. Verificar idempotencia en DB o en QuickBooks Online antes de publicar
      const alreadyInQbo = matchExistingJournalEntryStrict({
        payout: p,
        storeLocationId: storeRefs.locationId,
        receivableQbId: cfg.receivableQbId,
        qbJournalEntries: existingQbJournals,
      })

      if (p.raw_payload?.qb_journal_entry_id || alreadyInQbo) {
        const existingId = String(alreadyInQbo?.Id || p.raw_payload?.qb_journal_entry_id)
        const existingDoc = String(alreadyInQbo?.DocNumber || p.raw_payload?.qb_doc_number || '')
        const existingTxn = String(alreadyInQbo?.TxnDate || p.raw_payload?.qb_txn_date || preview.txnDate)

        // Si estaba en QBO pero no en DB (ej. reintento tras fallo previo de red), reparar vínculo en DB
        if (!p.raw_payload?.qb_journal_entry_id && alreadyInQbo) {
          await supabaseAdmin
            .from('delivery_platform_payouts')
            .update({
              raw_payload: {
                ...(p.raw_payload || {}),
                qb_journal_entry_id: existingId,
                qb_doc_number: existingDoc,
                qb_txn_date: existingTxn,
                qb_idempotency_key: idempotencyKey,
                qb_publish_status: 'PUBLISHED',
                qb_recovered_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id)
        }

        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: true,
          alreadyPublished: true,
          status: 'ALREADY_PUBLISHED',
          journalEntry: {
            id: existingId,
            docNumber: existingDoc,
            txnDate: existingTxn,
          },
        })
        continue
      }

      // 3. Bloquear si existen publishBlockers (desbalanceado, falta tax real, cobertura incompleta, varianza sin aprobar en servidor, etc.)
      if (!preview.canPublish || preview.publishBlockers.length > 0) {
        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: false,
          status: 'BLOCKED',
          blockers: preview.publishBlockers,
          error: preview.publishBlockers.map((b) => b.message_es).join(' | '),
        })
        continue
      }

      // 4. P0-1: Adquirir lock verdaderamente atómico en Supabase ANTES de llamar a QuickBooks Online
      // Verifica que exactamente 1 fila sea actualizada bajo las condiciones de estado, ausencia de qb_journal_entry_id y ausencia de lock activo.
      const lockRes = await acquireAtomicPayoutPublishLock({
        payoutId: p.id,
        currentRawPayload: p.raw_payload || {},
        idempotencyKey,
        userEmail: auth.user?.email || 'staff',
        userId: auth.user?.id || null,
        userRole: auth.user?.role || null,
      })

      if (!lockRes.acquired || lockRes.affectedRows !== 1) {
        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: false,
          status: 'BLOCKED',
          error: lockRes.reason || 'No se pudo adquirir la reserva atómica de publicación en Supabase.',
        })
        continue
      }

      const txnDate = customTxnDate || preview.txnDate
      const docNumber =
        payouts.length === 1 && customDocNumber
          ? customDocNumber
          : String(runningDocNum++)

      const qbLines = preview.lines
        .filter((l) => l.amount > 0)
        .map((l) => ({
          Amount: l.amount,
          DetailType: 'JournalEntryLineDetail' as const,
          Description: l.description,
          JournalEntryLineDetail: {
            PostingType: l.postingType,
            AccountRef: {
              value: l.accountQbId,
              name: l.accountName,
            },
            ClassRef: {
              value: l.classId,
              name: l.className,
            },
            DepartmentRef: {
              value: l.locationId,
              name: l.locationName,
            },
          },
        }))

      const qbPayload = {
        TxnDate: txnDate,
        DocNumber: docNumber,
        PrivateNote: `${p.platform} Settlement #${p.payout_reference_id} (${p.period_start || ''} to ${
          p.period_end || ''
        }) - ${storeName} [IDEMPOTENCY:${idempotencyKey}]`,
        Line: qbLines,
      }

      try {
        const qbRes = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/journalentry?minorversion=75`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(qbPayload),
          }
        )

        if (!qbRes.ok) {
          const errTxt = await qbRes.text()
          throw new Error(`QuickBooks API Error (${qbRes.status}): ${errTxt}`)
        }

        const qbData = await qbRes.json()
        const jeCreated = qbData.JournalEntry || qbData
        const jeId = String(jeCreated.Id || '')
        const finalDocNumber = String(jeCreated.DocNumber || docNumber)
        const finalTxnDate = String(jeCreated.TxnDate || txnDate)

        // 6. Persistir el ID en Supabase y CONFIRMAR lectura post-escritura
        const mergedRaw = {
          ...(p.raw_payload || {}),
          qb_journal_entry_id: jeId,
          qb_doc_number: finalDocNumber,
          qb_txn_date: finalTxnDate,
          qb_idempotency_key: idempotencyKey,
          qb_publish_status: 'PUBLISHED',
          qb_published_at: new Date().toISOString(),
          qb_published_by: auth.user?.email || 'staff',
          qb_published_by_user_id: auth.user?.id || null,
          qb_published_by_role: auth.user?.role || null,
        }

        const { error: persistErr } = await supabaseAdmin
          .from('delivery_platform_payouts')
          .update({
            raw_payload: mergedRaw,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)

        const { data: verifyRow, error: verifyErr } = await supabaseAdmin
          .from('delivery_platform_payouts')
          .select('raw_payload')
          .eq('id', p.id)
          .single()

        const persistedId = String(verifyRow?.raw_payload?.qb_journal_entry_id || '')

        if (persistErr || verifyErr || persistedId !== jeId) {
          results.push({
            payoutId: p.id,
            payoutRef: p.payout_reference_id,
            storeName,
            platform: p.platform,
            idempotencyKey,
            success: false,
            recoveryRequired: true,
            status: 'RECOVERY_REQUIRED',
            journalEntry: {
              id: jeId,
              docNumber: finalDocNumber,
              txnDate: finalTxnDate,
            },
            error: `Creado en QuickBooks (ID #${jeId}, Doc #${finalDocNumber}), pero falló la confirmación de persistencia en Supabase. Estado: RECOVERY_REQUIRED (no reintentar manualmente; el próximo GET/POST sincronizará el ID por llave idempotente).`,
          })
          continue
        }

        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: true,
          status: 'PUBLISHED',
          journalEntry: {
            id: jeId,
            docNumber: finalDocNumber,
            txnDate: finalTxnDate,
          },
        })
      } catch (err: any) {
        // Liberar lock de publicación fallida para permitir reintento seguro
        await supabaseAdmin
          .from('delivery_platform_payouts')
          .update({
            raw_payload: {
              ...(p.raw_payload || {}),
              qb_idempotency_key: idempotencyKey,
              qb_publish_status: 'FAILED',
              qb_last_error: String(err?.message || 'Error').slice(0, 500),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)

        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: false,
          status: 'ERROR',
          error: err.message || 'Error al publicar Journal Entry en QuickBooks Online',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const recoveryCount = results.filter((r) => r.recoveryRequired).length
    return NextResponse.json({
      success: successCount > 0 && recoveryCount === 0,
      recoveryRequired: recoveryCount > 0,
      results,
      summary: {
        total: results.length,
        successCount,
        recoveryCount,
        failCount: results.length - successCount,
      },
    })
  } catch (error: any) {
    console.error('[POST /api/delivery-reconciliation/quickbooks-journal] Error:', error)
    const errMsg = String(error?.message || '')
    const isAuthError =
      errMsg.includes('token') ||
      errMsg.includes('auth') ||
      errMsg.includes('invalid_grant') ||
      errMsg.includes('401') ||
      errMsg.includes('re-authenticate')

    return NextResponse.json(
      {
        success: false,
        isAuthError,
        reauthUrl: '/api/integrations/quickbooks/auth',
        error: isAuthError
          ? 'La sesión de QuickBooks Online ha expirado. Por favor reconecta la cuenta.'
          : error.message || 'Error al crear Journal Entry en QuickBooks Online',
      },
      { status: isAuthError ? 401 : 500 }
    )
  }
}
