/**
 * @module app/api/delivery-reconciliation/route
 * @description Endpoint REST seguro para el Módulo de Conciliación de Plataformas de Delivery (DoorDash, Uber Eats, Grubhub vs Toast POS) de Tacos Gavilan.
 *
 * @businessRules
 * - Reglas Fiscales Obligatorias:
 *   * DoorDash y Grubhub: Tacos Gavilan recibe/reporta el Sales Tax (Cuenta 24001) -> `Expected Gross = Toast Net Sales + Tax Real`.
 *   * Uber Eats: Marketplace Facilitator; Uber retiene y remite el Sales Tax (Cuenta 12050) -> `Expected Gross = Toast Net Sales (sin tax)` y `tax_paid_to_merchant = $0`.
 *   * Prohibido estimar impuestos (ej. 10.25%) o comisiones (20%). Si falta desglose fiscal real, se marca `REQUIRES_REVIEW` y se bloquea publicación a QBO.
 * - Clasificación en 4 Grupos Operativos Mutuamente Claros:
 *   1. `CONCILIATED_READY`: Match exacto por ID (`EXACT_ID`), con `payout_reference_id` comprobado, sin diferencia (`$0.00`) y con desglose fiscal real.
 *   2. `VARIANCE_INVESTIGATE`: Diferencia de subtotal o impuesto (`AMOUNT_MISMATCH`, `TAX_MISMATCH`, `MISSING_IN_TOAST`) que requiere investigación.
 *   3. `DISPUTE_RECOVERY`: Órdenes con cargo por error, reembolso, contracargo o recuperación en corte posterior.
 *   4. `BLOCKED_MISSING_INFO`: Bloqueado por falta de información o sincronización (`AMBIGUOUS`, `UNVERIFIED_NO_ID`, `MISSING_TAX_BREAKDOWN`, `UNASSIGNED_STORE`, o en Toast pendiente de corte `TOAST_ONLY`).
 * - Paginación completa de las 15 sucursales mediante `fetchAllSupabaseRows` (sin truncamiento a 1,000 filas de PostgREST).
 * - Seguridad: Protegido con `verifyStaffAuth` en `GET` y `POST`, validación estricta de payloads y lista blanca de columnas en mutaciones.
 * - Disputas y Recuperaciones (`update_dispute`): guardar una recuperación NUNCA sustituye el importe original disputado
 *   (`dispute_amount`); la captura se agrega al libro `raw_payload.recovery_credits` y se verifica contra el settlement del
 *   payout indicado. Sin crédito identificable de la orden (importe, referencia y cronología coherentes) queda
 *   "Recuperación pendiente de verificar" y se responde `recovery_verification.verified = false` + `warning`.
 *   Las notas/razón existentes se conservan cuando la solicitud no las envía.
 * - GET verifica en lectura cada crédito contra el settlement (`buildRecoverySettlementIndex`, incluye payouts de recuperación
 *   fuera del filtro) y expone `original_deduction_abs`, `recovered_amount` (solo verificado), `claimed_unverified_amount`,
 *   `unrecovered_amount` y `recovery_credits_evaluated`.
 * - Filtro de payouts por fechas con solapamiento INCLUSIVO (`payoutPeriodOverlapsRange`).
 * - Cruce Bidireccional Operativo (`bidirectionalSummary` + `toast_only_store_synced` + `suggested_toast_candidate`):
 *   * Separa órdenes `TOAST_ONLY` entre sucursales que ya tienen órdenes sincronizadas de la plataforma en el periodo (`toast_only_store_synced = true` -> alerta real `UNPAID_IN_PLATFORM`) y sucursales pendientes de sincronizar (`toast_only_store_synced = false` -> `PENDING_PLATFORM_SETTLEMENT` con lista `pendingSyncStoreIds`).
 *   * Auto-vincula órdenes de las 3 plataformas (`UBER_EATS`, `DOORDASH`, `GRUBHUB`) con `payout_reference_id === null` cuando existe un único payout oficial de esa tienda/plataforma cuyo `[period_start, period_end]` cubre `business_date`, persistiendo el vínculo en `delivery_platform_orders`.
 *   * Expone `suggested_toast_candidate` cuando una orden en plataforma sin ID en el cheque de Toast tiene un candidato único por misma tienda + fecha + subtotal (`UNVERIFIED_NO_ID`) para confirmación en 1 clic, y suprime la fila sintética duplicada `TOAST_ONLY` de ese mismo `toast_order_guid`.
 *   * Paridad en las 3 plataformas (`DOORDASH`, `UBER_EATS`, `GRUBHUB`) para órdenes cuadradas al centavo con Toast POS cuyo corte semanal aún sigue abierto o está en tránsito (`CONCILIATED_NEXT_PAYOUT` clasificado en `BLOCKED_MISSING_INFO`, excluido de `4. Listos para Póliza` hasta tener corte emitido).
 *   * Soporte de sincronización por lotes (`store_ids: number[]`) en `action === 'sync_live'` acotada estrictamente al rango `[startDate, endDate]`.
 *
 * @dataFlow
 * - GET `/api/delivery-reconciliation` -> Pagina `delivery_platform_orders`, `delivery_platform_payouts`, `delivery_platform_store_mappings` + cuarentena `UNASSIGNED_STORE`, calcula cobertura por tienda/plataforma y los 4 grupos de acción.
 * - POST `/api/delivery-reconciliation` -> Ejecuta `sync_live`, `import_report`, `update_dispute`, `batch_update_disputes`, `update_mapping`, `assign_unassigned_store`, `resolve_review_order`, `batch_resolve_review`.
 *
 * @notes
 * - Fix 2026-11-12: Separar `CONCILIATED_NEXT_PAYOUT` de `CONCILIATED_READY`, filtrar métricas de periodo/plataforma estrictamente por `inSelectedPeriod`,
 *   soportar cierres `ACCEPTED_LOSS`/`REJECTED`, excluir disputas $0.00 sin pérdida, corregir `store_id=0` y enriquecer payouts con CxC QBO y Toast vivo.
 * - No incluye ninguna columna autogenerada (`GENERATED ALWAYS AS`) en mutaciones SQL.
 * - `summary.byPlatform` expone métricas deduplicadas de Toast POS acotadas estrictamente al periodo consultado (`periodToastNet`, `periodToastTax`, `periodToastExpectedGross`, `periodToastOrdersCount`) junto con el desglose real del corte (`payoutsSubtotalTotal`, `payoutsTaxToMerchant`, `payoutsTaxWithheld`, `payoutsTipsTotal`, `payoutsWithTaxBreakdownCount`) para comparación lado a lado Corte vs Toast POS sin contaminación de disputas de semanas previas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeDeliveryReconciliationRequest } from '@/lib/auth-server'
import {
  DeliveryPlatformCode,
  DisputeRecoveryContext,
  buildManualRecoveryUpdate,
  buildRecoverySettlementIndex,
  buildStorePlatformCoverageMatrix,
  computePayoutAccountingAmounts,
  evaluateDisputeRecovery,
  isClosedUnrecoveredDisputeStatus,
  isZeroImpactDisputeOrder,
  fetchAllSupabaseRows,
  getOrderRecoveryCredits,
  getOrderRecoveryPayoutRefs,
  getQuarantinedUnassignedRecords,
  getStorePlatformMappings,
  hasDedicatedIntegrationEncryptionKey,
  parsePlatformReportPayload,
  payoutPeriodOverlapsRange,
  reconcileAndPersistDeliveryData,
  recoverySettlementKey,
  resolveEffectivePayoutPeriod,
  resolveOriginalDisputedAmount,
  round2,
  saveQuarantinedUnassignedRecords,
} from '@/lib/delivery-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export type ReconciliationActionGroup =
  | 'CONCILIATED_READY'
  | 'VARIANCE_INVESTIGATE'
  | 'DISPUTE_RECOVERY'
  | 'BLOCKED_MISSING_INFO'

const VALID_PLATFORMS = new Set<string>(['DOORDASH', 'UBER_EATS', 'GRUBHUB'])
const VALID_DISPUTE_STATUSES = new Set<string>(['NONE', 'OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DENIED', 'ACCEPTED_LOSS', 'REIMBURSED'])
const ALLOWED_MAPPING_COLUMNS = new Set<string>([
  'doordash_store_id',
  'doordash_business_id',
  'doordash_merchant_store_id',
  'doordash_store_name',
  'doordash_delivery_comm_pct',
  'doordash_pickup_comm_pct',
  'ubereats_store_uuid',
  'ubereats_org_uuid',
  'ubereats_store_name',
  'ubereats_delivery_comm_pct',
  'ubereats_pickup_comm_pct',
  'grubhub_cust_id',
  'grubhub_merchant_id',
  'grubhub_store_name',
  'grubhub_delivery_comm_pct',
  'grubhub_pickup_comm_pct',
  'qbo_location_id',
  'qbo_department_name',
  'is_active',
])

function isValidIsoDate(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())
}

/**
 * Verifica si una orden con varianza tiene una aprobación persistida en servidor compatible:
 * - Usuario aprobador + rol + fecha/hora
 * - Motivo obligatorio (>= 5 caracteres)
 * - Monto aprobado coincidente (±$0.02)
 * - Payout reference coincidente
 * - Evidencia disponible
 */
export function hasValidPersistedOrderVarianceApproval(o: any): boolean {
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

export function classifyOrderActionGroupAndExplanation(o: any, recoveryCtx?: DisputeRecoveryContext) {
  const plat = (o.platform as DeliveryPlatformCode) || 'DOORDASH'
  const platDisplay =
    plat === 'DOORDASH' ? 'DoorDash' : plat === 'UBER_EATS' ? 'Uber Eats' : plat === 'GRUBHUB' ? 'Grubhub' : plat
  const fmtUsd = (val: number) => {
    const n = Number.isFinite(Number(val)) ? Number(val) : 0
    return n < -0.004 ? `-$${Math.abs(n).toFixed(2)}` : `$${Math.abs(n).toFixed(2)}`
  }
  const fmtSignedVarUsd = (val: number) => {
    const n = Number.isFinite(Number(val)) ? Number(val) : 0
    if (n > 0.004) return `+$${n.toFixed(2)}`
    if (n < -0.004) return `-$${Math.abs(n).toFixed(2)}`
    return '$0.00'
  }
  const fmtDisputeStatusLabel = (st: string | null | undefined, lang: 'es' | 'en') => {
    const code = String(st || 'OPEN').toUpperCase()
    const mapEs: Record<string, string> = {
      NONE: 'Cargo por Disputar',
      NEEDS_DISPUTE: 'Por Disputar',
      OPEN: 'Disputa Abierta',
      SUBMITTED: 'Enviada al Portal',
      APPROVED: 'Aprobada por Plataforma',
      REIMBURSED: 'Reembolsada',
      COVERED: 'Cubierta / Pagada',
      REJECTED: 'Rechazada',
      DENIED: 'Rechazada',
      ACCEPTED_LOSS: 'Pérdida Aceptada',
    }
    const mapEn: Record<string, string> = {
      NONE: 'Needs Dispute',
      NEEDS_DISPUTE: 'Needs Dispute',
      OPEN: 'Open Dispute',
      SUBMITTED: 'Submitted',
      APPROVED: 'Approved by Platform',
      REIMBURSED: 'Reimbursed',
      COVERED: 'Covered / Paid',
      REJECTED: 'Rejected',
      DENIED: 'Rejected',
      ACCEPTED_LOSS: 'Accepted Loss',
    }
    return lang === 'en' ? mapEn[code] || code : mapEs[code] || code
  }
  const isUnassignedStore = !o.store_id || Number(o.store_id) <= 0 || o.store_code === 'UNASSIGNED_STORE'
  const isToastOnly = o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
  const isAmbiguous = o.match_confidence === 'AMBIGUOUS' || Boolean(o.raw_payload?.ambiguous_toast_candidates?.length)
  const isUnverifiedNoId =
    o.match_confidence !== 'EXACT_ID' &&
    (o.match_confidence === 'UNVERIFIED_NO_ID' ||
      Boolean(o.raw_payload?.unverified_no_platform_id) ||
      Boolean(o.raw_payload?.suggested_toast_candidate))
  const isMissingTax =
    Boolean(o.raw_payload?.missing_tax_breakdown) || o.raw_payload?.tax_breakdown_verified === false
  const hasPayoutRef = Boolean(o.payout_reference_id && String(o.payout_reference_id).trim())

  const errCharge = Number(o.error_charge || 0)
  const adjAmount = Number(o.adjustment_amount || 0)
  const reimbRef = o.raw_payload?.reimbursement_payout_ref ? String(o.raw_payload.reimbursement_payout_ref) : null
  const reimbAmt = Number(o.raw_payload?.reimbursement_amount || 0)
  const reimbDate = o.raw_payload?.reimbursement_deposit_date ? String(o.raw_payload.reimbursement_deposit_date) : null
  const hasRecoveryCredits = getOrderRecoveryCredits(o).length > 0
  const grossVar = round2(Number(o.gross_diff ?? o.gross_variance ?? 0))
  const subVar = round2(Number(o.subtotal_diff ?? o.subtotal_variance ?? 0))
  const taxVar = round2(Number(o.tax_diff ?? o.tax_variance ?? 0))

  const isZeroAmountCancelOrAdj =
    !o.toast_order_guid &&
    Math.abs(Number(o.platform_subtotal || 0)) < 0.01 &&
    Math.abs(Number(o.platform_gross_receivable || 0)) < 0.01 &&
    (o.transaction_type === 'CANCELLATION' || o.transaction_type === 'ADJUSTMENT')

  const isClosedLossStatus = isClosedUnrecoveredDisputeStatus(o.dispute_status)
  const isZeroImpactNoCharge = isZeroImpactDisputeOrder(o)
  const isDisputeOrRecovery =
    !isZeroImpactNoCharge &&
    (Boolean(o.is_disputed) ||
      o.reconciliation_status === 'REFUNDED_OR_DISPUTED' ||
      errCharge < -0.01 ||
      (o.transaction_type === 'ADJUSTMENT' && Math.abs(Number(o.platform_subtotal || 0)) < 0.01 && adjAmount < -0.01) ||
      Boolean(reimbRef) ||
      hasRecoveryCredits ||
      isClosedLossStatus)

  // Defectos 1, 2 y 4: original disputado, créditos (verificados contra el settlement) y saldo pendiente por separado
  const recoveryEval = isDisputeOrRecovery ? evaluateDisputeRecovery(o, recoveryCtx) : null
  const verifiedCredits = (recoveryEval?.recoveryCredits || []).filter((c) => c.verified)
  const pendingCredits = (recoveryEval?.recoveryCredits || []).filter(
    (c) => !c.verified && c.verification_issue !== 'SUPERSEDED_BY_VERIFIED_SETTLEMENT_CREDIT'
  )
  const creditsDetailEs = verifiedCredits
    .map((c) => `+$${c.amount.toFixed(2)} en corte #${c.payout_reference_id}${c.deposit_date ? ` (${c.deposit_date})` : ''}`)
    .join('; ')
  const creditsDetailEn = verifiedCredits
    .map((c) => `+$${c.amount.toFixed(2)} in payout #${c.payout_reference_id}${c.deposit_date ? ` (${c.deposit_date})` : ''}`)
    .join('; ')
  const hasVerifiedRecovery = Boolean(recoveryEval && recoveryEval.verifiedRecoveredAmount > 0)
  const hasPendingRecoveryClaim = Boolean(recoveryEval && !hasVerifiedRecovery && (pendingCredits.length > 0 || reimbRef))
  const lifecycleTrace = [
    {
      step: 1,
      stage: 'TOAST_ORDER',
      title_es: o.toast_order_guid ? `Orden Toast #${o.toast_display_number || 'S/N'}` : 'Sin orden en Toast POS',
      title_en: o.toast_order_guid ? `Toast Order #${o.toast_display_number || 'N/A'}` : 'No Toast POS order',
      date: o.business_date || null,
      amount: round2(Number(o.toast_expected_gross || 0)),
      detail_es: o.toast_order_guid
        ? `Ventas Netas: $${Number(o.toast_net_sales || 0).toFixed(2)} | Tax Toast: $${Number(o.toast_tax || 0).toFixed(2)} | Esperado: $${Number(o.toast_expected_gross || 0).toFixed(2)}`
        : 'No se encontró ticket de Toast POS vinculado',
      detail_en: o.toast_order_guid
        ? `Net Sales: $${Number(o.toast_net_sales || 0).toFixed(2)} | Toast Tax: $${Number(o.toast_tax || 0).toFixed(2)} | Expected: $${Number(o.toast_expected_gross || 0).toFixed(2)}`
        : 'No linked Toast POS check found',
      completed: Boolean(o.toast_order_guid),
    },
    {
      step: 2,
      stage: 'PLATFORM_ORDER',
      title_es: !isToastOnly ? `Orden ${platDisplay} #${o.platform_order_id}` : `Pendiente en ${platDisplay}`,
      title_en: !isToastOnly ? `${platDisplay} Order #${o.platform_order_id}` : `Pending in ${platDisplay}`,
      date: o.business_date || null,
      amount: round2(Number(o.platform_gross_receivable || 0)),
      detail_es: !isToastOnly
        ? plat === 'UBER_EATS'
          ? `Subtotal: ${fmtUsd(Number(o.platform_subtotal || 0))} | Uber retiene Tax (${fmtUsd(Number(o.platform_tax_withheld || o.toast_tax || 0))} Cta 12050, Tax a TEG $0.00)`
          : `Subtotal: ${fmtUsd(Number(o.platform_subtotal || 0))} | Tax a TEG (Cta 24001): ${fmtUsd(Number(o.platform_tax_paid_to_merchant || 0))}`
        : 'Aún no aparece en reporte/API de plataforma',
      detail_en: !isToastOnly
        ? plat === 'UBER_EATS'
          ? `Subtotal: ${fmtUsd(Number(o.platform_subtotal || 0))} | Uber withholds Tax (${fmtUsd(Number(o.platform_tax_withheld || o.toast_tax || 0))} Acct 12050, Tax to TEG $0.00)`
          : `Subtotal: ${fmtUsd(Number(o.platform_subtotal || 0))} | Tax to TEG (Acct 24001): ${fmtUsd(Number(o.platform_tax_paid_to_merchant || 0))}`
        : 'Not yet present in platform report/API',
      completed: !isToastOnly,
    },
    {
      step: 3,
      stage: 'PAYOUT_SETTLEMENT',
      title_es: hasPayoutRef ? `Corte #${o.payout_reference_id}` : 'Sin corte de pago asignado',
      title_en: hasPayoutRef ? `Payout #${o.payout_reference_id}` : 'No payout settlement assigned',
      date: o.payout_date || null,
      amount: round2(Number(o.net_payout || 0)),
      detail_es: hasPayoutRef
        ? `Comisiones: ${fmtUsd(Number(o.commission_fee || 0) + Number(o.delivery_fee || 0) + Number(o.processing_fee || 0) + Number(o.marketing_fee || 0))} | Cargo/Ajuste: ${fmtUsd(errCharge + adjAmount)} | Neto en corte: ${fmtUsd(Number(o.net_payout || 0))}`
        : 'La orden aún no tiene referencia verificable de depósito/settlement',
      detail_en: hasPayoutRef
        ? `Fees: ${fmtUsd(Number(o.commission_fee || 0) + Number(o.delivery_fee || 0) + Number(o.processing_fee || 0) + Number(o.marketing_fee || 0))} | Error/Adj: ${fmtUsd(errCharge + adjAmount)} | Net in payout: ${fmtUsd(Number(o.net_payout || 0))}`
        : 'Order does not yet have a verifiable settlement reference',
      completed: hasPayoutRef,
    },
    {
      step: 4,
      stage: 'DISPUTE_RECOVERY',
      title_es: hasVerifiedRecovery
        ? `Recuperado (verificado) en ${verifiedCredits.length} corte(s) posterior(es)`
        : hasPendingRecoveryClaim
        ? 'Recuperación pendiente de verificar'
        : isDisputeOrRecovery
        ? `Disputa (${fmtDisputeStatusLabel(o.dispute_status, 'es')})`
        : 'Sin disputa ni deducción',
      title_en: hasVerifiedRecovery
        ? `Recovered (verified) in ${verifiedCredits.length} subsequent payout(s)`
        : hasPendingRecoveryClaim
        ? 'Recovery pending verification'
        : isDisputeOrRecovery
        ? `Dispute (${fmtDisputeStatusLabel(o.dispute_status, 'en')})`
        : 'No dispute or deduction',
      date: recoveryEval?.reimbursementDepositDate || reimbDate || o.payout_date || null,
      amount: hasVerifiedRecovery ? round2(recoveryEval!.verifiedRecoveredAmount) : round2(errCharge),
      detail_es: hasVerifiedRecovery
        ? `Original disputado: $${recoveryEval!.originalDeductionAbs.toFixed(2)} en corte #${o.payout_reference_id || 'N/A'} → Recuperado verificado: ${creditsDetailEs} (total +$${recoveryEval!.verifiedRecoveredAmount.toFixed(2)}) → Pendiente: $${recoveryEval!.unrecoveredAmount.toFixed(2)}`
        : hasPendingRecoveryClaim
        ? `Original disputado: $${(recoveryEval?.originalDeductionAbs || Math.abs(errCharge)).toFixed(2)}. Se registró una recuperación de $${(recoveryEval?.claimedUnverifiedAmount || reimbAmt).toFixed(2)} en corte #${reimbRef || pendingCredits[0]?.payout_reference_id || 'N/A'}, pero no se localizó el crédito de la orden en ese settlement.`
        : isDisputeOrRecovery
        ? `Cargo deducido por plataforma: ${fmtUsd(errCharge)}. Motivo: ${o.dispute_reason || 'Deducción / Reembolso de cliente'}`
        : 'Orden cobrada sin cargos por error ni contracargos',
      detail_en: hasVerifiedRecovery
        ? `Original disputed: $${recoveryEval!.originalDeductionAbs.toFixed(2)} in payout #${o.payout_reference_id || 'N/A'} → Verified recovery: ${creditsDetailEn} (total +$${recoveryEval!.verifiedRecoveredAmount.toFixed(2)}) → Remaining: $${recoveryEval!.unrecoveredAmount.toFixed(2)}`
        : hasPendingRecoveryClaim
        ? `Original disputed: $${(recoveryEval?.originalDeductionAbs || Math.abs(errCharge)).toFixed(2)}. A $${(recoveryEval?.claimedUnverifiedAmount || reimbAmt).toFixed(2)} recovery was recorded in payout #${reimbRef || pendingCredits[0]?.payout_reference_id || 'N/A'}, but the order credit was not found in that settlement.`
        : isDisputeOrRecovery
        ? `Platform error deduction: ${fmtUsd(errCharge)}. Reason: ${o.dispute_reason || 'Customer refund / chargeback'}`
        : 'Order settled without error charges or chargebacks',
      completed: recoveryEval?.recoveryClassification === 'FULL_RECOVERY' || recoveryEval?.recoveryClassification === 'CLOSED_LOSS' || !isDisputeOrRecovery,
    },
  ]

  // 1) Check Group 4: BLOCKED_MISSING_INFO first for structural blockers
  if (isUnassignedStore) {
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'BLOCKED_UNASSIGNED_STORE',
      status_label_es: 'Bloqueado: Tienda desconocida',
      status_label_en: 'Blocked: Unknown store',
      what_happened_es: 'Transacción recibida sin mapeo a ninguna de las 15 sucursales de Tacos Gavilan.',
      what_happened_en: 'Transaction received without a valid mapping to any of the 15 Tacos Gavilan stores.',
      cause_es: 'El ID de tienda del reporte o API no coincide con delivery_platform_store_mappings.',
      cause_en: 'Store ID in report or API does not match delivery_platform_store_mappings.',
      evidence_es: `ID externo detectado: ${o.raw_payload?.unassigned_external_store_id || 'Desconocido'}`,
      evidence_en: `Detected external store ID: ${o.raw_payload?.unassigned_external_store_id || 'Unknown'}`,
      next_action_es: 'Asignar manualmente la tienda en la pestaña Conexión de Tiendas.',
      next_action_en: 'Manually map the store in the Store Connections tab.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  if (isAmbiguous) {
    const candidates = o.raw_payload?.ambiguous_toast_candidates || []
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'BLOCKED_AMBIGUOUS_MATCH',
      status_label_es: 'Bloqueado: Coincidencia ambigua',
      status_label_en: 'Blocked: Ambiguous match',
      what_happened_es: `Existen ${candidates.length || 'múltiples'} órdenes candidatas con el mismo código o subtotal.`,
      what_happened_en: `There are ${candidates.length || 'multiple'} candidate orders with the same code or subtotal.`,
      cause_es: 'El sistema bloqueó el emparejamiento automático para evitar asignar la orden equivocada.',
      cause_en: 'Auto-matching was blocked to avoid linking the wrong order.',
      evidence_es: `Candidatos Toast: ${candidates.map((c: any) => `#${c.displayNumber} ($${c.netSales})`).join(', ') || 'Múltiples'}`,
      evidence_en: `Toast candidates: ${candidates.map((c: any) => `#${c.displayNumber} ($${c.netSales})`).join(', ') || 'Multiple'}`,
      next_action_es: 'Revisar tickets en Toast POS y confirmar manualmente cuál corresponde.',
      next_action_en: 'Review checks in Toast POS and manually confirm the matching order.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  if (isUnverifiedNoId) {
    const sugCand = o.raw_payload?.suggested_toast_candidate
    const candNum = o.toast_display_number || sugCand?.toastDisplayNumber || sugCand?.displayNumber || 'N/A'
    const candNet = Number(o.toast_net_sales || sugCand?.netSales || 0)
    const candTax = Number(o.toast_tax || sugCand?.taxAmount || 0)
    const candExpGross = round2(candNet + (plat === 'UBER_EATS' ? 0 : candTax))
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'BLOCKED_NO_PLATFORM_ID',
      status_label_es: 'Bloqueado: Sin ID verificable',
      status_label_en: 'Blocked: Unverified platform ID',
      what_happened_es: 'Misma fecha y subtotal similar en Toast, pero sin código de orden de plataforma en el ticket.',
      what_happened_en: 'Same date and similar subtotal in Toast, but missing platform order ID on the check.',
      cause_es: 'Prohibido conciliar automáticamente solo por fecha + subtotal parecido.',
      cause_en: 'Auto-reconciling solely by date + similar subtotal is prohibited.',
      evidence_es: `Toast #${candNum} ($${candExpGross.toFixed(2)}, Sub $${candNet.toFixed(2)}) vs ${platDisplay} #${o.platform_order_id} ($${Number(o.platform_gross_receivable || o.platform_subtotal || 0).toFixed(2)})`,
      evidence_en: `Toast #${candNum} ($${candExpGross.toFixed(2)}, Sub $${candNet.toFixed(2)}) vs ${platDisplay} #${o.platform_order_id} ($${Number(o.platform_gross_receivable || o.platform_subtotal || 0).toFixed(2)})`,
      next_action_es: 'Verificar la comanda física o tablet y aprobar revisión manual.',
      next_action_en: 'Verify physical slip or tablet and approve manual review.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  if (isMissingTax) {
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'BLOCKED_MISSING_TAX',
      status_label_es: 'Bloqueado: Falta desglose de Tax real',
      status_label_en: 'Blocked: Missing real Tax breakdown',
      what_happened_es: 'La plataforma no entregó el desglose atómico de Sales Tax para esta orden.',
      what_happened_en: 'The platform did not provide the atomic Sales Tax breakdown for this order.',
      cause_es: 'Prohibido estimar impuestos con tasa fija (10.25%). Se requiere el impuesto real.',
      cause_en: 'Estimating tax with a fixed rate (10.25%) is prohibited. Real tax is required.',
      evidence_es: `Subtotal ${platDisplay}: $${Number(o.platform_subtotal || 0).toFixed(2)} | Tax reportado: N/D`,
      evidence_en: `${platDisplay} Subtotal: $${Number(o.platform_subtotal || 0).toFixed(2)} | Reported tax: N/A`,
      next_action_es: 'Sincronizar transacciones detalladas del payout o importar CSV con columna Tax.',
      next_action_en: 'Sync detailed payout transactions or import CSV with Tax column.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  if (isToastOnly) {
    if (o.toast_only_store_synced) {
      return {
        action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
        status_code: 'UNPAID_IN_PLATFORM',
        status_label_es: 'En Toast POS • Sin Pago en Plataforma',
        status_label_en: 'In Toast POS • Unpaid in Platform',
        what_happened_es: `Orden cerrada en Toast POS ($${Number(o.toast_expected_gross || 0).toFixed(2)}) que NO aparece pagada en las órdenes de ${platDisplay} de esta sucursal.`,
        what_happened_en: `Order closed in Toast POS ($${Number(o.toast_expected_gross || 0).toFixed(2)}) that does NOT appear paid in ${platDisplay} orders for this store.`,
        cause_es: `La sucursal ya tiene órdenes sincronizadas de ${platDisplay} en este periodo, pero este ticket de Toast no fue incluido ni pagado por la plataforma.`,
        cause_en: `This store already has synced ${platDisplay} orders in this period, but this Toast check was not included or paid by the platform.`,
        evidence_es: `Toast #${o.toast_display_number || 'S/N'} (${o.toast_tab_name || 'Sin nombre'}) del ${o.business_date}`,
        evidence_en: `Toast #${o.toast_display_number || 'N/A'} (${o.toast_tab_name || 'No tab'}) on ${o.business_date}`,
        next_action_es: `Verificar en el portal de ${platDisplay} si la orden fue cancelada sin pago o levantar reclamo por orden no pagada.`,
        next_action_en: `Verify in the ${platDisplay} portal if the order was cancelled unpaid or file a claim for the unpaid order.`,
        lifecycle_trace: lifecycleTrace,
      }
    }
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'PENDING_PLATFORM_SETTLEMENT',
      status_label_es: 'En Toast (Pendiente sincronizar tienda)',
      status_label_en: 'In Toast (Pending store sync)',
      what_happened_es: `Orden registrada en Toast POS ($${Number(o.toast_expected_gross || 0).toFixed(2)}) aún sin órdenes descargadas de ${platDisplay} en esta tienda.`,
      what_happened_en: `Order recorded in Toast POS ($${Number(o.toast_expected_gross || 0).toFixed(2)}) pending ${platDisplay} order download for this store.`,
      cause_es: 'Falta sincronizar el detalle de órdenes de esta sucursal o el corte semanal aún no cierra.',
      cause_en: 'Store order detail sync is pending for this period or weekly payout has not closed yet.',
      evidence_es: `Toast #${o.toast_display_number || 'S/N'} (${o.toast_tab_name || 'Sin nombre'}) del ${o.business_date}`,
      evidence_en: `Toast #${o.toast_display_number || 'N/A'} (${o.toast_tab_name || 'No tab'}) on ${o.business_date}`,
      next_action_es: 'Usar "Sincronizar Tiendas Pendientes" para descargar y cruzar las órdenes de esta sucursal.',
      next_action_en: 'Use "Sync Pending Stores" to download and cross-check orders for this store.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  // 2) Check Group 3: DISPUTE_RECOVERY
  if (isDisputeOrRecovery && recoveryEval) {
    const recEval = recoveryEval
    const isFullRecovery = recEval.recoveryClassification === 'FULL_RECOVERY'
    const isPartialRecovery = recEval.recoveryClassification === 'PARTIAL_RECOVERY'
    const isUnverifiedRecovery = recEval.recoveryClassification === 'UNVERIFIED_RECOVERY'
    const isConfirmedRecovery = isFullRecovery || isPartialRecovery
    const origTxt = recEval.originalAmountVerified ? `$${recEval.originalDeductionAbs.toFixed(2)}` : 'no comprobado'
    const origTxtEn = recEval.originalAmountVerified ? `$${recEval.originalDeductionAbs.toFixed(2)}` : 'unverified'

    let statusCode = 'DISPUTE_DEDUCTED'
    let statusLabelEs = `Con Payout, en Disputa / Cargo por Error (${fmtUsd(errCharge)})`
    let statusLabelEn = `In Payout, Disputed / Error Charge (${fmtUsd(errCharge)})`
    let whatHappenedEs = `La plataforma descontó ${fmtUsd(errCharge)} por reembolso/error en la orden #${o.platform_order_id}.`
    let whatHappenedEn = `Platform deducted ${fmtUsd(errCharge)} for refund/error on order #${o.platform_order_id}.`
    let nextActionEs = 'Presentar disputa en el portal de la plataforma y registrar el corte de reembolso.'
    let nextActionEn = 'Submit dispute in platform portal and record reimbursement payout reference.'

    if (isFullRecovery) {
      statusCode = 'DISPUTE_RECOVERED'
      statusLabelEs = `Recuperación Total Verificada (+$${recEval.verifiedRecoveredAmount.toFixed(2)})`
      statusLabelEn = `Full Recovery Verified (+$${recEval.verifiedRecoveredAmount.toFixed(2)})`
      whatHappenedEs = `Orden #${o.platform_order_id} sufrió deducción de -$${recEval.originalDeductionAbs.toFixed(2)} en corte #${o.payout_reference_id || 'N/A'} y fue recuperada en su totalidad: ${creditsDetailEs}.`
      whatHappenedEn = `Order #${o.platform_order_id} had a -$${recEval.originalDeductionAbs.toFixed(2)} deduction in payout #${o.payout_reference_id || 'N/A'} and was recovered in full: ${creditsDetailEn}.`
      nextActionEs = 'Crédito(s) localizados en el settlement posterior. Recuperación total conciliada.'
      nextActionEn = 'Credit(s) located in the subsequent settlement. Full recovery reconciled.'
    } else if (isPartialRecovery) {
      statusCode = 'DISPUTE_PARTIALLY_RECOVERED'
      statusLabelEs = `Recuperación Parcial (+$${recEval.verifiedRecoveredAmount.toFixed(2)} de -$${recEval.originalDeductionAbs.toFixed(2)} • Pendiente -$${recEval.unrecoveredAmount.toFixed(2)})`
      statusLabelEn = `Partial Recovery (+$${recEval.verifiedRecoveredAmount.toFixed(2)} of -$${recEval.originalDeductionAbs.toFixed(2)} • Remaining -$${recEval.unrecoveredAmount.toFixed(2)})`
      whatHappenedEs = `Orden #${o.platform_order_id} sufrió deducción de -$${recEval.originalDeductionAbs.toFixed(2)} en corte #${o.payout_reference_id || 'N/A'}; recuperado verificado: ${creditsDetailEs}, quedando -$${recEval.unrecoveredAmount.toFixed(2)} sin recuperar.`
      whatHappenedEn = `Order #${o.platform_order_id} had a -$${recEval.originalDeductionAbs.toFixed(2)} deduction in payout #${o.payout_reference_id || 'N/A'}; verified recovery: ${creditsDetailEn}, leaving -$${recEval.unrecoveredAmount.toFixed(2)} unrecovered.`
      nextActionEs = `Reclamar el saldo restante de -$${recEval.unrecoveredAmount.toFixed(2)} o documentar el cierre parcial de la disputa.`
      nextActionEn = `Claim the remaining -$${recEval.unrecoveredAmount.toFixed(2)} balance or document partial dispute closure.`
    } else if (isUnverifiedRecovery) {
      statusCode = 'DISPUTE_RECOVERY_MISSING_EVIDENCE'
      statusLabelEs = `Recuperación pendiente de verificar (original ${origTxt})`
      statusLabelEn = `Recovery pending verification (original ${origTxtEn})`
      whatHappenedEs = !recEval.originalAmountVerified
        ? `Se registró una recuperación en la orden #${o.platform_order_id}, pero el importe original disputado no está comprobado; no es posible determinar si fue total o parcial.`
        : `Se registró una recuperación de $${recEval.claimedUnverifiedAmount.toFixed(2)} en la orden #${o.platform_order_id}, pero el settlement indicado no contiene un crédito identificable de esa orden con importe y fecha coherentes.`
      whatHappenedEn = !recEval.originalAmountVerified
        ? `A recovery was recorded on order #${o.platform_order_id}, but the original disputed amount is unverified; full vs partial cannot be determined.`
        : `A $${recEval.claimedUnverifiedAmount.toFixed(2)} recovery was recorded on order #${o.platform_order_id}, but the referenced settlement has no identifiable credit for that order with matching amount and date.`
      nextActionEs = 'Verificar en el portal el corte donde se pagó el crédito de la orden (ID de transacción e importe) y re-sincronizar ese corte.'
      nextActionEn = 'Check the platform portal for the payout that paid the order credit (transaction ID and amount) and re-sync that payout.'
    } else if (isClosedLossStatus) {
      statusCode = 'DISPUTE_CLOSED_UNRECOVERED'
      const closedLblEs = String(o.dispute_status || '').toUpperCase() === 'ACCEPTED_LOSS' ? 'Pérdida aceptada' : 'Rechazada'
      const closedLblEn = String(o.dispute_status || '').toUpperCase() === 'ACCEPTED_LOSS' ? 'Accepted loss' : 'Rejected'
      statusLabelEs = `Cerrada sin recuperación (${closedLblEs} • -$${recEval.originalDeductionAbs.toFixed(2)})`
      statusLabelEn = `Closed unrecovered (${closedLblEn} • -$${recEval.originalDeductionAbs.toFixed(2)})`
      whatHappenedEs = `Disputa de orden #${o.platform_order_id} cerrada como ${closedLblEs.toLowerCase()}; pérdida asumida de $${recEval.originalDeductionAbs.toFixed(2)} (saldo pendiente $0.00).`
      whatHappenedEn = `Order #${o.platform_order_id} dispute closed as ${closedLblEn.toLowerCase()}; loss absorbed ($${recEval.originalDeductionAbs.toFixed(2)}, pending balance $0.00).`
      nextActionEs = 'Caso cerrado contablemente sin recuperación pendiente.'
      nextActionEn = 'Accounting case closed with $0.00 pending recovery.'
    } else if (recEval.isDisputeApproved) {
      statusCode = 'DISPUTE_APPROVED_RECOVERY_PENDING'
      statusLabelEs = `Disputa aprobada, recuperación pendiente (-$${recEval.unrecoveredAmount.toFixed(2)})`
      statusLabelEn = `Dispute approved, recovery pending (-$${recEval.unrecoveredAmount.toFixed(2)})`
      whatHappenedEs = `La disputa de la orden #${o.platform_order_id} figura como aprobada, pero aún no existe un crédito en un settlement posterior.`
      whatHappenedEn = `Order #${o.platform_order_id} dispute is marked approved, but no credit exists yet in a subsequent settlement.`
      nextActionEs = 'Esperar el siguiente corte y sincronizarlo; el crédito se vinculará automáticamente al localizarse en el settlement.'
      nextActionEn = 'Wait for the next payout and sync it; the credit will link automatically once found in the settlement.'
    }

    return {
      action_group: 'DISPUTE_RECOVERY' as ReconciliationActionGroup,
      status_code: statusCode,
      recovery_classification: recEval.recoveryClassification,
      original_deduction_abs: recEval.originalDeductionAbs,
      original_amount_verified: recEval.originalAmountVerified,
      recovered_amount: recEval.verifiedRecoveredAmount,
      claimed_unverified_amount: recEval.claimedUnverifiedAmount,
      unrecovered_amount: recEval.unrecoveredAmount,
      recovery_credits_evaluated: recEval.recoveryCredits,
      recovery_verification_issues: recEval.verificationIssues,
      dispute_approved: recEval.isDisputeApproved,
      status_label_es: statusLabelEs,
      status_label_en: statusLabelEn,
      what_happened_es: whatHappenedEs,
      what_happened_en: whatHappenedEn,
      cause_es: o.dispute_reason || 'Reembolso de cliente o ajuste de orden aplicado por la plataforma.',
      cause_en: o.dispute_reason || 'Customer refund or order adjustment applied by the platform.',
      evidence_es: isConfirmedRecovery
        ? `Corte deducción: #${o.payout_reference_id || 'N/A'} (-$${recEval.originalDeductionAbs.toFixed(2)}) → Créditos verificados: ${creditsDetailEs}`
        : `Corte: #${o.payout_reference_id || 'Sin corte'} | Estado disputa: ${o.dispute_status || 'OPEN'}${recEval.verificationIssues.length ? ` | Verificación: ${recEval.verificationIssues.join(', ')}` : ''}`,
      evidence_en: isConfirmedRecovery
        ? `Deduction payout: #${o.payout_reference_id || 'N/A'} (-$${recEval.originalDeductionAbs.toFixed(2)}) → Verified credits: ${creditsDetailEn}`
        : `Payout: #${o.payout_reference_id || 'No payout'} | Dispute status: ${o.dispute_status || 'OPEN'}${recEval.verificationIssues.length ? ` | Verification: ${recEval.verificationIssues.join(', ')}` : ''}`,
      next_action_es: nextActionEs,
      next_action_en: nextActionEn,
      lifecycle_trace: lifecycleTrace,
    }
  }

  if (
    !isToastOnly &&
    !o.toast_order_guid &&
    o.toast_synced_on_date === false &&
    (Number(o.platform_subtotal || 0) > 0 || Number(o.platform_gross_receivable || 0) > 0)
  ) {
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'PENDING_TOAST_SYNC',
      status_label_es: 'En Plataforma (Pendiente sincronizar Toast POS)',
      status_label_en: 'In Platform (Pending Toast POS sync)',
      what_happened_es: `Orden cobrada en ${plat} ($${Number(o.platform_gross_receivable || 0).toFixed(2)}) en una fecha operativa donde aún no se han descargado tickets de Toast POS para esta sucursal.`,
      what_happened_en: `Order settled in ${plat} ($${Number(o.platform_gross_receivable || 0).toFixed(2)}) on a business date where Toast POS checks have not been synced yet for this store.`,
      cause_es: 'La sucursal tiene 0 órdenes de Toast POS sincronizadas en esa fecha operativa.',
      cause_en: 'This store has 0 synced Toast POS orders on that business date.',
      evidence_es: `${plat} #${o.platform_order_id} del ${o.business_date} | Corte: #${o.payout_reference_id || 'Pendiente'}`,
      evidence_en: `${plat} #${o.platform_order_id} on ${o.business_date} | Payout: #${o.payout_reference_id || 'Pending'}`,
      next_action_es: 'Sincronizar la sucursal en ese rango de fechas si deseas cruzar el detalle contra Toast POS.',
      next_action_en: 'Sync the store for that date range if you want to cross-check against Toast POS.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  // 3) Check Group 2: VARIANCE_INVESTIGATE (or CONCILIATED_READY if variance has persisted server approval)
  if (
    !isZeroAmountCancelOrAdj &&
    (o.reconciliation_status === 'MISSING_IN_TOAST' ||
      o.reconciliation_status === 'AMOUNT_MISMATCH' ||
      o.reconciliation_status === 'TAX_MISMATCH' ||
      Math.abs(grossVar) > 0.05)
  ) {
    if (hasValidPersistedOrderVarianceApproval(o) && hasPayoutRef) {
      const va = o.raw_payload.variance_approval
      return {
        action_group: 'CONCILIATED_READY' as ReconciliationActionGroup,
        status_code: 'VARIANCE_APPROVED_READY',
        status_label_es: `Varianza aprobada ($${grossVar.toFixed(2)}) — Lista para contabilizar`,
        status_label_en: `Variance approved ($${grossVar.toFixed(2)}) — Ready to post`,
        what_happened_es: `Diferencia de $${grossVar.toFixed(2)} revisada y aprobada en servidor por ${va.approved_by_email}.`,
        what_happened_en: `Variance of $${grossVar.toFixed(2)} reviewed and approved on server by ${va.approved_by_email}.`,
        cause_es: `Motivo documentado: ${va.reason}`,
        cause_en: `Documented reason: ${va.reason}`,
        evidence_es: `${va.evidence} | Corte: #${o.payout_reference_id}`,
        evidence_en: `${va.evidence} | Payout: #${o.payout_reference_id}`,
        next_action_es: 'Listo para publicar en póliza contable (Journal Entry) de QuickBooks.',
        next_action_en: 'Ready to publish in QuickBooks Journal Entry.',
        lifecycle_trace: lifecycleTrace,
      }
    }

    if (
      o.raw_payload?.toast_voided === true &&
      Number(o.platform_gross_receivable || 0) > 0 &&
      Number(o.net_payout || 0) > 0
    ) {
      const voidOrig = Number(
        o.raw_payload?.toast_voided_original_subtotal || o.platform_gross_receivable || 0
      )
      const pGrossVal = Number(o.platform_gross_receivable || 0)
      const pNetVal = Number(o.net_payout || 0)
      const orderStatusRaw = String(o.raw_payload?.orderStatus || '').toUpperCase()
      const isDeliveryFailed = orderStatusRaw.includes('DELIVERY_FAILED')
      const stateChanges: any[] = Array.isArray(o.raw_payload?.orderDetails?.orderStateChanges)
        ? o.raw_payload.orderDetails.orderStateChanges
        : []
      const statusEvents: any[] = Array.isArray(o.raw_payload?.order?.statusHistory?.orderStatusEvents)
        ? o.raw_payload.order.statusHistory.orderStatusEvents
        : []
      const reachedReady =
        Boolean(o.raw_payload?.platform_reached_ready_for_pickup) ||
        stateChanges.some((sc: any) => String(sc?.type || '').toUpperCase().includes('READY')) ||
        statusEvents.some((ev: any) => String(ev?.orderStatus || '').toUpperCase().includes('READY_FOR_PICKUP'))
      const isLifecycleCanceled =
        Boolean(o.raw_payload?.platform_lifecycle_canceled) ||
        orderStatusRaw.includes('CANCELED') ||
        String(o.raw_payload?.order?.lifecycleStatus || '').toUpperCase().includes('CANCELED')
      const courierName = o.raw_payload?.courierName ? ` (${o.raw_payload.courierName})` : ''

      if (!reachedReady && !isDeliveryFailed && isLifecycleCanceled) {
        return {
          action_group: 'VARIANCE_INVESTIGATE' as ReconciliationActionGroup,
          status_code: 'VOIDED_CANCELED_PLATFORM_AMOUNT_INCONSISTENCY',
          status_label_es: `Anulada en Toast ($0.00) y Cancelada en ${plat} • Payload reporta $${pGrossVal.toFixed(
            2
          )} (Neto $${pNetVal.toFixed(2)})`,
          status_label_en: `Voided in Toast ($0.00) & Canceled in ${plat} • Payload reports $${pGrossVal.toFixed(
            2
          )} (Net $${pNetVal.toFixed(2)})`,
          what_happened_es: `El Ticket #${o.toast_display_number || 'S/N'} (${
            o.toast_tab_name || o.platform_order_id
          }, orig. $${voidOrig.toFixed(
            2
          )}) fue anulado (VOID → $0.00) en Toast POS y ${plat} reporta estado CANCELED sin evento READY_FOR_PICKUP${
            courierName ? `, aunque asignó repartidor${courierName}` : ''
          }. Sin embargo, el payload de ${plat} conserva importes positivos ($${pGrossVal.toFixed(
            2
          )} venta / $${pNetVal.toFixed(2)} neto)${
            hasPayoutRef ? ` en corte #${o.payout_reference_id}` : ' sin referencia de corte vinculada'
          }.`,
          what_happened_en: `Check #${o.toast_display_number || 'N/A'} (${
            o.toast_tab_name || o.platform_order_id
          }, orig. $${voidOrig.toFixed(
            2
          )}) was VOIDED ($0.00) in Toast POS and ${plat} reports CANCELED status without READY_FOR_PICKUP${
            courierName ? `, although courier${courierName} was assigned` : ''
          }. Yet ${plat} payload retains positive amounts ($${pGrossVal.toFixed(2)} gross / $${pNetVal.toFixed(
            2
          )} net)${hasPayoutRef ? ` in payout #${o.payout_reference_id}` : ' without a linked payout reference'}.`,
          cause_es: `Regla de Evidencia: voided = true en Toast no demuestra por sí solo que la plataforma no pagó. Se conservan los importes originales de ${plat} para verificar contra el estado de cuenta oficial del corte.`,
          cause_en: `Evidence Rule: voided = true in Toast does not by itself prove the platform did not pay. Original ${plat} amounts are preserved to verify against the official settlement statement.`,
          evidence_es: `Toast Ticket #${o.toast_display_number || 'S/N'} (VOID orig. $${voidOrig.toFixed(
            2
          )} → $0.00) ↔ ${plat} #${o.platform_order_id} (Estado: CANCELED | Venta: $${pGrossVal.toFixed(
            2
          )} / Neto: $${pNetVal.toFixed(2)}) | Corte: #${o.payout_reference_id || 'Sin vínculo'}`,
          evidence_en: `Toast Check #${o.toast_display_number || 'N/A'} (VOID orig. $${voidOrig.toFixed(
            2
          )} → $0.00) ↔ ${plat} #${o.platform_order_id} (Status: CANCELED | Gross: $${pGrossVal.toFixed(
            2
          )} / Net: $${pNetVal.toFixed(2)}) | Payout: #${o.payout_reference_id || 'Unlinked'}`,
          next_action_es: `Verificar en el detalle del corte semanal de ${plat} si la orden #${o.platform_order_id} fue efectivamente pagada o excluida antes de resolver la diferencia.`,
          next_action_en: `Verify in the ${plat} weekly settlement detail whether order #${o.platform_order_id} was actually paid or excluded before resolving the variance.`,
          lifecycle_trace: lifecycleTrace,
        }
      }

      return {
        action_group: 'VARIANCE_INVESTIGATE' as ReconciliationActionGroup,
        status_code: 'PAID_BY_PLATFORM_VOIDED_IN_TOAST',
        status_label_es: `Preparada (${isDeliveryFailed ? 'Fallo entrega' : 'READY_FOR_PICKUP'}) • ${plat} reporta +$${pNetVal.toFixed(
          2
        )} neto vs VOID en Toast #${o.toast_display_number || 'S/N'}`,
        status_label_en: `Prepared (${isDeliveryFailed ? 'Delivery failed' : 'READY_FOR_PICKUP'}) • ${plat} reports +$${pNetVal.toFixed(
          2
        )} net vs VOID in Toast #${o.toast_display_number || 'N/A'}`,
        what_happened_es: `El Ticket #${o.toast_display_number || 'S/N'} (${
          o.toast_tab_name || o.platform_order_id
        }, orig. $${voidOrig.toFixed(
          2
        )}) ingresó a Toast POS y alcanzó preparación (READY_FOR_PICKUP), pero fue anulado (VOID → $0.00) cuando ${
          isDeliveryFailed
            ? `falló la entrega del repartidor${courierName}`
            : `se canceló después de prepararse${courierName}`
        }. ${plat} reporta pago a Tacos Gavilan ($${pGrossVal.toFixed(2)} venta / +$${pNetVal.toFixed(2)} neto)${
          hasPayoutRef
            ? ` en el corte #${o.payout_reference_id}.`
            : ' (pendiente de vincular payout_reference_id del corte semanal).'
        }`,
        what_happened_en: `Check #${o.toast_display_number || 'N/A'} (${
          o.toast_tab_name || o.platform_order_id
        }, orig. $${voidOrig.toFixed(
          2
        )}) entered Toast POS and reached READY_FOR_PICKUP, but was VOIDED ($0.00) when ${
          isDeliveryFailed
            ? `courier delivery failed${courierName}`
            : `canceled after preparation${courierName}`
        }. ${plat} reports payment to Tacos Gavilan ($${pGrossVal.toFixed(2)} gross / +$${pNetVal.toFixed(2)} net)${
          hasPayoutRef
            ? ` in payout #${o.payout_reference_id}.`
            : ' (pending weekly settlement payout_reference_id link).'
        }`,
        cause_es: `Al fallar la entrega o cancelarse tras READY_FOR_PICKUP, la integración envía un VOID automático a Toast POS ($0.00), mientras ${plat} reconoce la comida preparada.`,
        cause_en: `Upon delivery failure or cancellation after READY_FOR_PICKUP, POS integration VOIDS the Toast check ($0.00), while ${plat} recognizes the prepared food.`,
        evidence_es: `Toast Ticket #${o.toast_display_number || 'S/N'} (VOID orig. $${voidOrig.toFixed(
          2
        )} → $0.00) ↔ ${plat} #${o.platform_order_id} (${
          isDeliveryFailed ? 'DELIVERY_FAILED' : 'READY_FOR_PICKUP → CANCELED'
        } | Venta: $${pGrossVal.toFixed(2)} / Neto: +$${pNetVal.toFixed(2)}) | Corte: #${
          o.payout_reference_id || 'Pendiente'
        }`,
        evidence_en: `Toast Check #${o.toast_display_number || 'N/A'} (VOID orig. $${voidOrig.toFixed(
          2
        )} → $0.00) ↔ ${plat} #${o.platform_order_id} (${
          isDeliveryFailed ? 'DELIVERY_FAILED' : 'READY_FOR_PICKUP → CANCELED'
        } | Gross: $${pGrossVal.toFixed(2)} / Net: +$${pNetVal.toFixed(2)}) | Payout: #${
          o.payout_reference_id || 'Pending'
        }`,
        next_action_es: hasPayoutRef
          ? `Pago verificado en corte #${o.payout_reference_id} (+$${pNetVal.toFixed(
              2
            )}). Puedes aprobar la varianza con evidencia.`
          : `Confirmar la inclusión en el corte semanal de ${plat} (+$${pNetVal.toFixed(
              2
            )}) o aprobar la varianza tras validar el depósito.`,
        next_action_en: hasPayoutRef
          ? `Payment verified in payout #${o.payout_reference_id} (+$${pNetVal.toFixed(
              2
            )}). You may approve the variance with evidence.`
          : `Confirm inclusion in ${plat} weekly settlement (+$${pNetVal.toFixed(
              2
            )}) or approve variance after verifying deposit.`,
        lifecycle_trace: lifecycleTrace,
      }
    }

    const isMissingToast = o.reconciliation_status === 'MISSING_IN_TOAST' || !o.toast_order_guid
    return {
      action_group: 'VARIANCE_INVESTIGATE' as ReconciliationActionGroup,
      status_code: isMissingToast
        ? 'MISSING_IN_TOAST'
        : Math.abs(taxVar) > 0.05 && Math.abs(subVar) <= 0.05
        ? 'TAX_MISMATCH'
        : 'AMOUNT_MISMATCH',
      status_label_es: isMissingToast
        ? 'Con Payout, sin orden en Toast POS'
        : `Con Payout, pendiente de revisión (Dif: ${fmtSignedVarUsd(grossVar)})`,
      status_label_en: isMissingToast
        ? 'With Payout, missing in Toast POS'
        : `With Payout, pending review (Var: ${fmtSignedVarUsd(grossVar)})`,
      what_happened_es: isMissingToast
        ? `La plataforma reportó la orden #${o.platform_order_id} (${fmtUsd(Number(o.platform_gross_receivable || 0))}), pero no existe ticket en Toast POS.`
        : `Diferencia bruta de ${fmtSignedVarUsd(grossVar)} entre Toast (${fmtUsd(Number(o.toast_expected_gross || 0))}) y ${platDisplay} (${fmtUsd(Number(o.platform_gross_receivable || 0))}).`,
      what_happened_en: isMissingToast
        ? `Platform reported order #${o.platform_order_id} (${fmtUsd(Number(o.platform_gross_receivable || 0))}), but no check exists in Toast POS.`
        : `Gross variance of ${fmtSignedVarUsd(grossVar)} between Toast (${fmtUsd(Number(o.toast_expected_gross || 0))}) and ${platDisplay} (${fmtUsd(Number(o.platform_gross_receivable || 0))}).`,
      cause_es: isMissingToast
        ? 'Orden cancelada en POS, ingresada en fecha operativa distinta o sincronización de Toast incompleta.'
        : `Variación de subtotal (${fmtSignedVarUsd(subVar)}) o variación de Sales Tax (${fmtSignedVarUsd(taxVar)}).`,
      cause_en: isMissingToast
        ? 'Order cancelled in POS, entered on different business date, or incomplete Toast sync.'
        : `Subtotal variance (${fmtSignedVarUsd(subVar)}) or Sales Tax variance (${fmtSignedVarUsd(taxVar)}).`,
      evidence_es: `Toast #${o.toast_display_number || 'N/A'} vs ${platDisplay} #${o.platform_order_id} | Corte: #${o.payout_reference_id || 'Pendiente'}`,
      evidence_en: `Toast #${o.toast_display_number || 'N/A'} vs ${platDisplay} #${o.platform_order_id} | Payout: #${o.payout_reference_id || 'Pending'}`,
      next_action_es: 'Investigar diferencia de precio/impuesto o documentar aprobación de revisión.',
      next_action_en: 'Investigate price/tax variance or document review approval.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  // If matched in platform & Toast with $0 variance, check if it has a verified payout_reference_id
  if (!hasPayoutRef) {
    const isVerifiedBothSides =
      Boolean(o.toast_order_guid) &&
      o.match_confidence !== 'TOAST_ONLY' &&
      Boolean(o.platform_transaction_id) &&
      !String(o.platform_transaction_id).startsWith('TOAST-')
    if (o.raw_payload?.pending_next_payout || isVerifiedBothSides) {
      return {
        action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
        status_code: 'CONCILIATED_NEXT_PAYOUT',
        status_label_es: 'Toast ↔ Plataforma cuadrada • Pendiente de corte semanal (QBO)',
        status_label_en: 'Toast ↔ Platform matched • Pending weekly payout (QBO)',
        what_happened_es: `Orden #${o.platform_order_id} cuadrada al centavo entre Toast POS ($${Number(o.toast_expected_gross || 0).toFixed(2)}) y ${platDisplay} ($${Number(o.platform_gross_receivable || 0).toFixed(2)}, Neto: ${fmtUsd(Number(o.net_payout || 0))}), pero aún sin corte semanal cerrado para póliza QBO.`,
        what_happened_en: `Order #${o.platform_order_id} matched to the cent between Toast POS ($${Number(o.toast_expected_gross || 0).toFixed(2)}) and ${platDisplay} ($${Number(o.platform_gross_receivable || 0).toFixed(2)}, Net: ${fmtUsd(Number(o.net_payout || 0))}), but awaits closed weekly payout before QBO posting.`,
        cause_es: `Transacción verificada en ${platDisplay} (Tx #${o.platform_transaction_id}) correspondiente al ciclo abierto o posterior al corte semanal; sin payout_reference_id emitido todavía.`,
        cause_en: `Verified transaction in ${platDisplay} (Tx #${o.platform_transaction_id}) belonging to the open weekly cycle or placed after weekly cutoff; no payout_reference_id issued yet.`,
        evidence_es: `Toast #${o.toast_display_number} ↔ ${platDisplay} #${o.platform_order_id} ($${Number(o.platform_gross_receivable || 0).toFixed(2)} | Neto ${fmtUsd(Number(o.net_payout || 0))}) ↔ Tx #${o.platform_transaction_id} (En tránsito)`,
        evidence_en: `Toast #${o.toast_display_number} ↔ ${platDisplay} #${o.platform_order_id} ($${Number(o.platform_gross_receivable || 0).toFixed(2)} | Net ${fmtUsd(Number(o.net_payout || 0))}) ↔ Tx #${o.platform_transaction_id} (In transit)`,
        next_action_es: 'Esperar cierre del corte semanal oficial para moverla a Listas para contabilizar (QBO).',
        next_action_en: 'Wait for official weekly payout settlement to promote into Ready to post (QBO).',
        lifecycle_trace: lifecycleTrace,
      }
    }
    return {
      action_group: 'BLOCKED_MISSING_INFO' as ReconciliationActionGroup,
      status_code: 'MATCHED_AWAITING_PAYOUT_REF',
      status_label_es: 'Emparejada sin referencia de Payout',
      status_label_en: 'Matched awaiting Payout reference',
      what_happened_es: `Orden #${o.platform_order_id} cuadra al centavo con Toast ($${Number(o.toast_expected_gross || 0).toFixed(2)}), pero aún no tiene ID de depósito/corte vinculado.`,
      what_happened_en: `Order #${o.platform_order_id} matches Toast to the cent ($${Number(o.toast_expected_gross || 0).toFixed(2)}), but has no linked payout reference ID yet.`,
      cause_es: 'No se permite incluir en póliza de QuickBooks sin un payout_reference_id verificable.',
      cause_en: 'Cannot include in QuickBooks Journal Entry without a verifiable payout_reference_id.',
      evidence_es: `Toast #${o.toast_display_number} = ${platDisplay} #${o.platform_order_id} ($${Number(o.platform_gross_receivable || 0).toFixed(2)})`,
      evidence_en: `Toast #${o.toast_display_number} = ${platDisplay} #${o.platform_order_id} ($${Number(o.platform_gross_receivable || 0).toFixed(2)})`,
      next_action_es: 'Sincronizar el corte de pago (settlement) donde se depositó esta orden.',
      next_action_en: 'Sync the payout settlement where this order was deposited.',
      lifecycle_trace: lifecycleTrace,
    }
  }

  // 4) Group 1: CONCILIATED_READY
  return {
    action_group: 'CONCILIATED_READY' as ReconciliationActionGroup,
    status_code: 'CONCILIATED',
    status_label_es: 'Conciliado y listo para contabilizar',
    status_label_en: 'Reconciled and ready to post',
    what_happened_es: `Orden #${o.platform_order_id} conciliada al centavo entre Toast POS, ${platDisplay} y el corte #${o.payout_reference_id}.`,
    what_happened_en: `Order #${o.platform_order_id} reconciled to the cent across Toast POS, ${platDisplay}, and payout #${o.payout_reference_id}.`,
    cause_es: 'Sin diferencias ($0.00). Identificador exacto y reglas fiscales verificadas.',
    cause_en: 'Zero variance ($0.00). Exact ID and fiscal rules verified.',
    evidence_es: `Toast #${o.toast_display_number} ↔ ${platDisplay} #${o.platform_order_id} ↔ Corte #${o.payout_reference_id}`,
    evidence_en: `Toast #${o.toast_display_number} ↔ ${platDisplay} #${o.platform_order_id} ↔ Payout #${o.payout_reference_id}`,
    next_action_es: 'Listo para publicar en póliza contable (Journal Entry) de QuickBooks.',
    next_action_en: 'Ready to publish in QuickBooks Journal Entry.',
    lifecycle_trace: lifecycleTrace,
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
      permission: 'read',
      allowCron: false,
    })
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    }

    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('store_id')
    const platformParam = searchParams.get('platform')
    const statusParam = searchParams.get('status')
    const payoutRefParam = (searchParams.get('payout_reference_id') || '').trim()
    const startDate = searchParams.get('start_date') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const endDate = searchParams.get('end_date') || new Date().toISOString().slice(0, 10)
    const search = (searchParams.get('search') || '').trim().toLowerCase()

    const mappings = await getStorePlatformMappings()
    const storeNameMap = new Map<number, { name: string; code: string }>()
    for (const m of mappings) {
      storeNameMap.set(m.store_id, { name: m.store_name, code: m.store_code })
    }
    storeNameMap.set(0, { name: 'Tienda Desconocida (Requiere Mapeo)', code: 'UNASSIGNED_STORE' })

    const requestedStoreNum =
      storeIdParam && storeIdParam !== 'ALL' && Number.isFinite(Number(storeIdParam))
        ? Number(storeIdParam)
        : null

    if (!auth.isGlobalScope && auth.user?.storeId) {
      if (requestedStoreNum !== null && requestedStoreNum !== auth.user.storeId) {
        return NextResponse.json(
          {
            success: false,
            error: `Acceso denegado: Tu cuenta solo tiene autorización para consultar la sucursal #${auth.user.storeId}.`,
          },
          { status: 403 }
        )
      }
    }

    const selectedStoreNum =
      !auth.isGlobalScope && auth.user?.storeId ? auth.user.storeId : requestedStoreNum

    const [
      rawOrdersRange,
      disputedOrdersAll,
      rawPayouts,
      allSyncOrders,
      allSyncPayouts,
      quarantinedUnassigned,
    ] = await Promise.all([
      fetchAllSupabaseRows<any>((from, to) => {
        let q = supabaseAdmin
          .from('delivery_platform_orders')
          .select('*')
          .order('business_date', { ascending: false })
          .order('placed_at', { ascending: false })
          .order('id', { ascending: true })
        if (payoutRefParam) {
          q = q.eq('payout_reference_id', payoutRefParam)
        } else if (!search || search.length < 2) {
          q = q.gte('business_date', startDate).lte('business_date', endDate)
        }
        if (selectedStoreNum !== null && selectedStoreNum > 0) {
          q = q.eq('store_id', selectedStoreNum)
        }
        if (platformParam && platformParam !== 'ALL') {
          q = q.eq('platform', platformParam)
        }
        if (statusParam && statusParam !== 'ALL') {
          q = q.eq('reconciliation_status', statusParam)
        }
        return q.range(from, to)
      }),
      selectedStoreNum === 0
        ? Promise.resolve([])
        : fetchAllSupabaseRows<any>((from, to) => {
            let q = supabaseAdmin
              .from('delivery_platform_orders')
              .select('*')
              .eq('is_disputed', true)
              .order('id', { ascending: true })
            if (selectedStoreNum !== null && selectedStoreNum > 0) {
              q = q.eq('store_id', selectedStoreNum)
            }
            if (platformParam && platformParam !== 'ALL') {
              q = q.eq('platform', platformParam)
            }
            if (statusParam && statusParam !== 'ALL') {
              q = q.eq('reconciliation_status', statusParam)
            }
            return q.range(from, to)
          }),
      selectedStoreNum === 0
        ? Promise.resolve([])
        : fetchAllSupabaseRows<any>((from, to) => {
            let q = supabaseAdmin
              .from('delivery_platform_payouts')
              .select('*')
              .order('payout_date', { ascending: false })
              .order('id', { ascending: true })
            if (selectedStoreNum !== null && selectedStoreNum > 0) {
              q = q.eq('store_id', selectedStoreNum)
            }
            if (platformParam && platformParam !== 'ALL') {
              q = q.eq('platform', platformParam)
            }
            if (payoutRefParam) {
              q = q.eq('payout_reference_id', payoutRefParam)
            }
            return q.range(from, to)
          }),
      fetchAllSupabaseRows<any>((from, to) =>
        supabaseAdmin
          .from('delivery_platform_orders')
          .select('store_id, platform, business_date, match_confidence, toast_order_guid, payout_reference_id, updated_at')
          .neq('match_confidence', 'TOAST_ONLY')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllSupabaseRows<any>((from, to) =>
        supabaseAdmin
          .from('delivery_platform_payouts')
          .select('store_id, platform, payout_reference_id, payout_date, period_start, period_end, orders_count, updated_at')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      getQuarantinedUnassignedRecords(),
    ])

    for (const p of rawPayouts || []) {
      const eff = resolveEffectivePayoutPeriod(p)
      p.period_start = eff.period_start
      p.period_end = eff.period_end
    }
    for (const sp of allSyncPayouts || []) {
      const eff = resolveEffectivePayoutPeriod(sp)
      sp.period_start = eff.period_start
      sp.period_end = eff.period_end
    }

    // Unir órdenes del rango con órdenes en disputa cuyo reembolso ocurrió dentro del rango seleccionado o payout seleccionado
    const rawOrdersMap = new Map<string, any>()
    if (selectedStoreNum !== 0) {
      for (const r of rawOrdersRange || []) {
        rawOrdersMap.set(String(r.id), r)
      }
      for (const d of disputedOrdersAll || []) {
        // Defecto 4: considerar TODOS los payouts de recuperación de la orden (libro `recovery_credits` + campos históricos)
        const recRefs = getOrderRecoveryPayoutRefs(d)
        if (recRefs.length > 0 && !rawOrdersMap.has(String(d.id))) {
          const recDates = getOrderRecoveryCredits(d)
            .map((c) => String(c.deposit_date || ''))
            .concat(String(d?.raw_payload?.reimbursement_deposit_date || ''))
            .filter(Boolean)
          const isSearchMatch = Boolean(search && search.length >= 2)
          const isPayoutRefMatch = Boolean(
            payoutRefParam && (recRefs.includes(payoutRefParam) || d.payout_reference_id === payoutRefParam)
          )
          const isReimbInWindow = Boolean(
            !payoutRefParam && recDates.some((dt) => dt >= startDate && dt <= endDate)
          )
          if (isSearchMatch || isPayoutRefMatch || isReimbInWindow) {
            rawOrdersMap.set(String(d.id), d)
          }
        }
      }
    }

    // Agregar órdenes en cuarentena con store_id = 0 (UNASSIGNED_STORE) cuando aplique
    if (selectedStoreNum === null || selectedStoreNum === 0) {
      for (let idx = 0; idx < (quarantinedUnassigned.orders || []).length; idx++) {
        const uo = quarantinedUnassigned.orders[idx]
        if (platformParam && platformParam !== 'ALL' && uo.platform !== platformParam) continue
        if (payoutRefParam && uo.payoutReferenceId !== payoutRefParam) continue
        if (!search && !payoutRefParam && (uo.businessDate < startDate || uo.businessDate > endDate)) continue
        const synthId = `UNASSIGNED-ORD-${uo.platform}-${uo.platformOrderId}-${idx}`
        const pSub = Number(uo.platformSubtotal ?? uo.subtotal ?? 0)
        const pTax = Number(uo.platformTax ?? uo.taxCollected ?? 0)
        const pTaxMerch = Number(uo.platformTaxPaidToMerchant ?? uo.taxPaidToMerchant ?? 0)
        const pTaxWith = Number(uo.platformTaxWithheld ?? uo.taxRemittedByPlatform ?? 0)
        const pGross = Number(
          uo.platformGrossReceivable ?? (uo.platform === 'UBER_EATS' ? pSub : round2(pSub + pTaxMerch))
        )
        rawOrdersMap.set(synthId, {
          id: synthId,
          store_id: 0,
          platform: uo.platform,
          platform_order_id: uo.platformOrderId,
          business_date: uo.businessDate,
          placed_at: uo.placedAt,
          customer_name: uo.customerName || null,
          toast_order_guid: null,
          toast_display_number: null,
          toast_tab_name: null,
          toast_net_sales: 0,
          toast_tax: 0,
          toast_expected_gross: 0,
          platform_subtotal: pSub,
          platform_tax: pTax,
          platform_tax_paid_to_merchant: pTaxMerch,
          platform_tax_withheld: pTaxWith,
          platform_gross_receivable: pGross,
          commission_fee: Number(uo.commissionFee || 0),
          delivery_fee: Number(uo.deliveryFee || 0),
          processing_fee: Number(uo.processingFee || 0),
          marketing_fee: Number(uo.marketingFee || 0),
          error_charge: Number(uo.errorCharge || 0),
          adjustment_amount: Number(uo.adjustmentAmount || 0),
          net_payout: Number(uo.netPayout || 0),
          subtotal_diff: 0,
          tax_diff: 0,
          gross_diff: 0,
          subtotal_variance: 0,
          tax_variance: 0,
          gross_variance: 0,
          reconciliation_status: 'REQUIRES_REVIEW',
          match_confidence: 'UNASSIGNED_STORE',
          payout_reference_id: uo.payoutReferenceId || null,
          payout_date: uo.payoutDate || null,
          is_disputed: false,
          dispute_status: 'NONE',
          raw_payload: uo.rawPayload || { unassigned_store: true },
        })
      }
    }

    const rawOrders = Array.from(rawOrdersMap.values())

    // Pilar 2: Auto-vincular órdenes reales de plataforma (`match_confidence !== 'TOAST_ONLY'`) cuyo `payout_reference_id` es nulo
    // cuando existe un único payout oficial de esa sucursal + plataforma cuyo `[period_start, period_end]` cubre `business_date`.
    const autoLinkUpdates: Array<{ orderId: number | string; payoutRef: string; payoutDate: string | null }> = []
    for (const o of rawOrders) {
      if (
        !o ||
        o.match_confidence === 'TOAST_ONLY' ||
        Number(o.store_id) <= 0 ||
        o.payout_reference_id ||
        !o.business_date ||
        o.raw_payload?.pending_next_payout
      ) {
        continue
      }
      const candidatePayouts = (allSyncPayouts || []).filter(
        (sp: any) =>
          Number(sp.store_id) === Number(o.store_id) &&
          sp.platform === o.platform &&
          sp.payout_reference_id &&
          sp.period_start &&
          sp.period_end &&
          o.business_date >= sp.period_start &&
          o.business_date <= sp.period_end
      )
      if (candidatePayouts.length === 1) {
        const matchedPay = candidatePayouts[0]
        o.payout_reference_id = matchedPay.payout_reference_id
        o.payout_date = matchedPay.payout_date || o.payout_date || null
        if (o.id && !String(o.id).startsWith('UNASSIGNED-')) {
          autoLinkUpdates.push({
            orderId: o.id,
            payoutRef: matchedPay.payout_reference_id,
            payoutDate: matchedPay.payout_date || null,
          })
        }
      }
    }
    for (const so of allSyncOrders || []) {
      if (!so || so.match_confidence === 'TOAST_ONLY' || Number(so.store_id) <= 0 || so.payout_reference_id || !so.business_date) {
        continue
      }
      const candidatePayouts = (allSyncPayouts || []).filter(
        (sp: any) =>
          Number(sp.store_id) === Number(so.store_id) &&
          sp.platform === so.platform &&
          sp.payout_reference_id &&
          sp.period_start &&
          sp.period_end &&
          so.business_date >= sp.period_start &&
          so.business_date <= sp.period_end
      )
      if (candidatePayouts.length === 1) {
        so.payout_reference_id = candidatePayouts[0].payout_reference_id
      }
    }
    if (autoLinkUpdates.length > 0) {
      await Promise.all(
        autoLinkUpdates.map((u) =>
          supabaseAdmin
            .from('delivery_platform_orders')
            .update({
              payout_reference_id: u.payoutRef,
              payout_date: u.payoutDate,
              updated_at: new Date().toISOString(),
            })
            .eq('id', u.orderId)
        )
      )
    }

    // Defecto 2: índice de settlements para verificar en lectura que cada crédito de recuperación exista en el payout posterior.
    // Incluye payouts de recuperación que no entran en el filtro actual (otra semana / payout seleccionado).
    const recoverySettlementIndex = buildRecoverySettlementIndex(rawPayouts || [])
    const missingRecoveryRefs = new Set<string>()
    for (const o of rawOrders) {
      if (!o || Number(o.store_id) <= 0) continue
      for (const ref of getOrderRecoveryPayoutRefs(o)) {
        if (!recoverySettlementIndex.has(recoverySettlementKey(o.store_id, o.platform, ref))) missingRecoveryRefs.add(ref)
      }
    }
    if (missingRecoveryRefs.size > 0) {
      const refsList = Array.from(missingRecoveryRefs)
      for (let i = 0; i < refsList.length; i += 100) {
        const chunk = refsList.slice(i, i + 100)
        const { data: recPayouts, error: recErr } = await supabaseAdmin
          .from('delivery_platform_payouts')
          .select('store_id, platform, payout_reference_id, payout_date, period_start, period_end, raw_payload')
          .in('payout_reference_id', chunk)
        if (recErr) throw new Error(`Error leyendo payouts de recuperación: ${recErr.message}`)
        for (const rp of recPayouts || []) {
          recoverySettlementIndex.set(recoverySettlementKey(rp.store_id, rp.platform, rp.payout_reference_id), rp)
        }
      }
    }
    const recoveryCtx = { settlementPayouts: recoverySettlementIndex }

    type PlatformSyncMeta = {
      lastSyncedAt: string | null
      latestBusinessDate: string | null
      ordersCount: number
      payoutsCount: number
      globalLastSyncedAt: string | null
      globalLatestBusinessDate: string | null
      globalOrdersCount: number
      globalPayoutsCount: number
    }

    const initMeta = (): PlatformSyncMeta => ({
      lastSyncedAt: null,
      latestBusinessDate: null,
      ordersCount: 0,
      payoutsCount: 0,
      globalLastSyncedAt: null,
      globalLatestBusinessDate: null,
      globalOrdersCount: 0,
      globalPayoutsCount: 0,
    })

    const syncStatus: {
      TOAST: PlatformSyncMeta
      DOORDASH: PlatformSyncMeta
      GRUBHUB: PlatformSyncMeta
      UBER_EATS: PlatformSyncMeta
      byStore: Record<
        number,
        {
          toastLastSync: string | null
          toastOrders: number
          ddLastSync: string | null
          ddOrders: number
          ddPayouts: number
          ghLastSync: string | null
          ghOrders: number
          ghPayouts: number
          ueLastSync: string | null
          ueOrders: number
          uePayouts: number
        }
      >
    } = {
      TOAST: initMeta(),
      DOORDASH: initMeta(),
      GRUBHUB: initMeta(),
      UBER_EATS: initMeta(),
      byStore: {},
    }

    for (const m of mappings) {
      syncStatus.byStore[m.store_id] = {
        toastLastSync: null,
        toastOrders: 0,
        ddLastSync: null,
        ddOrders: 0,
        ddPayouts: 0,
        ghLastSync: null,
        ghOrders: 0,
        ghPayouts: 0,
        ueLastSync: null,
        ueOrders: 0,
        uePayouts: 0,
      }
    }

    const maxIso = (a: string | null, b: string | null | undefined): string | null => {
      if (!b) return a
      if (!a) return b
      return b > a ? b : a
    }

    // Track linked order counts per payout reference key (platform:store_id:payout_reference_id)
    const linkedOrdersByPayoutKey = new Map<string, number>()

    for (const so of allSyncOrders || []) {
      const sId = Number(so.store_id)
      const plat = (so.platform as DeliveryPlatformCode) || 'DOORDASH'
      const upd = so.updated_at || null
      const bDate = so.business_date || null
      const isSelectedStore = selectedStoreNum === null || sId === selectedStoreNum
      const stEntry = syncStatus.byStore[sId]

      if (so.payout_reference_id) {
        const pKey = `${plat}:${sId}:${so.payout_reference_id}`
        linkedOrdersByPayoutKey.set(pKey, (linkedOrdersByPayoutKey.get(pKey) || 0) + 1)
      }

      if (so.toast_order_guid) {
        syncStatus.TOAST.globalOrdersCount++
        syncStatus.TOAST.globalLastSyncedAt = maxIso(syncStatus.TOAST.globalLastSyncedAt, upd)
        syncStatus.TOAST.globalLatestBusinessDate = maxIso(syncStatus.TOAST.globalLatestBusinessDate, bDate)
        if (isSelectedStore) {
          syncStatus.TOAST.ordersCount++
          syncStatus.TOAST.lastSyncedAt = maxIso(syncStatus.TOAST.lastSyncedAt, upd)
          syncStatus.TOAST.latestBusinessDate = maxIso(syncStatus.TOAST.latestBusinessDate, bDate)
        }
        if (stEntry) {
          stEntry.toastOrders++
          stEntry.toastLastSync = maxIso(stEntry.toastLastSync, upd)
        }
      }

      if (so.match_confidence !== 'TOAST_ONLY' && syncStatus[plat]) {
        syncStatus[plat].globalOrdersCount++
        syncStatus[plat].globalLastSyncedAt = maxIso(syncStatus[plat].globalLastSyncedAt, upd)
        syncStatus[plat].globalLatestBusinessDate = maxIso(syncStatus[plat].globalLatestBusinessDate, bDate)
        if (isSelectedStore) {
          syncStatus[plat].ordersCount++
          syncStatus[plat].lastSyncedAt = maxIso(syncStatus[plat].lastSyncedAt, upd)
          syncStatus[plat].latestBusinessDate = maxIso(syncStatus[plat].latestBusinessDate, bDate)
        }
        if (stEntry) {
          if (plat === 'DOORDASH') {
            stEntry.ddOrders++
            stEntry.ddLastSync = maxIso(stEntry.ddLastSync, upd)
          } else if (plat === 'GRUBHUB') {
            stEntry.ghOrders++
            stEntry.ghLastSync = maxIso(stEntry.ghLastSync, upd)
          } else if (plat === 'UBER_EATS') {
            stEntry.ueOrders++
            stEntry.ueLastSync = maxIso(stEntry.ueLastSync, upd)
          }
        }
      }
    }

    for (const ro of rawOrdersRange || []) {
      if (ro.match_confidence !== 'TOAST_ONLY' || !ro.toast_order_guid) continue
      const sId = Number(ro.store_id)
      const upd = ro.updated_at || null
      const bDate = ro.business_date || null
      const isSelectedStore = selectedStoreNum === null || sId === selectedStoreNum
      const stEntry = syncStatus.byStore[sId]
      syncStatus.TOAST.globalOrdersCount++
      syncStatus.TOAST.globalLastSyncedAt = maxIso(syncStatus.TOAST.globalLastSyncedAt, upd)
      syncStatus.TOAST.globalLatestBusinessDate = maxIso(syncStatus.TOAST.globalLatestBusinessDate, bDate)
      if (isSelectedStore) {
        syncStatus.TOAST.ordersCount++
        syncStatus.TOAST.lastSyncedAt = maxIso(syncStatus.TOAST.lastSyncedAt, upd)
        syncStatus.TOAST.latestBusinessDate = maxIso(syncStatus.TOAST.latestBusinessDate, bDate)
      }
      if (stEntry) {
        stEntry.toastOrders++
        stEntry.toastLastSync = maxIso(stEntry.toastLastSync, upd)
      }
    }

    for (const sp of allSyncPayouts || []) {
      const sId = Number(sp.store_id)
      const plat = (sp.platform as DeliveryPlatformCode) || 'DOORDASH'
      const upd = sp.updated_at || null
      const pDate = sp.payout_date || sp.period_end || null
      const isSelectedStore = selectedStoreNum === null || sId === selectedStoreNum
      const stEntry = syncStatus.byStore[sId]

      if (syncStatus[plat]) {
        syncStatus[plat].globalPayoutsCount++
        syncStatus[plat].globalLastSyncedAt = maxIso(syncStatus[plat].globalLastSyncedAt, upd)
        syncStatus[plat].globalLatestBusinessDate = maxIso(syncStatus[plat].globalLatestBusinessDate, pDate)
        if (isSelectedStore) {
          syncStatus[plat].payoutsCount++
          syncStatus[plat].lastSyncedAt = maxIso(syncStatus[plat].lastSyncedAt, upd)
          syncStatus[plat].latestBusinessDate = maxIso(syncStatus[plat].latestBusinessDate, pDate)
        }
      }
      if (stEntry) {
        if (plat === 'DOORDASH') {
          stEntry.ddPayouts++
          stEntry.ddLastSync = maxIso(stEntry.ddLastSync, upd)
        } else if (plat === 'GRUBHUB') {
          stEntry.ghPayouts++
          stEntry.ghLastSync = maxIso(stEntry.ghLastSync, upd)
        } else if (plat === 'UBER_EATS') {
          stEntry.uePayouts++
          stEntry.ueLastSync = maxIso(stEntry.ueLastSync, upd)
        }
      }
    }

    // Contar cuántas órdenes reales de plataforma (no TOAST_ONLY) y cuántas de Toast existen por sucursal + plataforma + fecha
    const storePlatDateRealOrders = new Map<string, number>()
    const storePlatDateToastOrders = new Map<string, number>()
    const storeDateToastOrders = new Map<string, number>()
    const suggestedToastGuidsSet = new Set<string>()
    for (const o of rawOrders || []) {
      if (!o || Number(o.store_id) <= 0 || !o.business_date) continue
      const spdKey = `${Number(o.store_id)}:${o.platform}:${o.business_date}`
      const sdKey = `${Number(o.store_id)}:${o.business_date}`
      if (o.match_confidence !== 'TOAST_ONLY') {
        storePlatDateRealOrders.set(spdKey, (storePlatDateRealOrders.get(spdKey) || 0) + 1)
        const sugGuid = o.raw_payload?.suggested_toast_candidate?.toastOrderGuid
        if (sugGuid) suggestedToastGuidsSet.add(String(sugGuid))
      }
      if (o.toast_order_guid || o.match_confidence === 'TOAST_ONLY') {
        storePlatDateToastOrders.set(spdKey, (storePlatDateToastOrders.get(spdKey) || 0) + 1)
        storeDateToastOrders.set(sdKey, (storeDateToastOrders.get(sdKey) || 0) + 1)
      }
    }

    const deduplicatedRawOrders = (rawOrders || []).filter((o: any) => {
      const isToastOnlyRow =
        o?.match_confidence === 'TOAST_ONLY' || o?.reconciliation_status === 'MISSING_IN_PLATFORM'
      if (isToastOnlyRow && o?.toast_order_guid && suggestedToastGuidsSet.has(String(o.toast_order_guid))) {
        return false
      }
      return true
    })

    let orders = deduplicatedRawOrders.map((o: any) => {
      const storeMeta = storeNameMap.get(Number(o.store_id)) || {
        name: o.store_id === 0 ? 'Tienda Desconocida (Requiere Mapeo)' : `Store #${o.store_id}`,
        code: o.store_id === 0 ? 'UNASSIGNED_STORE' : '',
      }
      const subVar = round2(Number(o.subtotal_diff ?? o.subtotal_variance ?? 0))
      const taxVar = round2(Number(o.tax_diff ?? o.tax_variance ?? 0))
      const grossVar = round2(Number(o.gross_diff ?? o.gross_variance ?? 0))
      const isToastOnlyRow =
        o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      const spdKey = `${Number(o.store_id)}:${o.platform}:${o.business_date || ''}`
      const realPlatOnDay = storePlatDateRealOrders.get(spdKey) || 0
      const toastOnDay = storePlatDateToastOrders.get(spdKey) || 0
      const coveringPayouts = (allSyncPayouts || []).filter(
        (sp: any) =>
          Number(sp.store_id) === Number(o.store_id) &&
          sp.platform === o.platform &&
          sp.period_start &&
          sp.period_end &&
          o.business_date >= sp.period_start &&
          o.business_date <= sp.period_end
      )
      const payoutCoverageReady =
        coveringPayouts.length === 0 ||
        coveringPayouts.every((sp: any) => {
          const expectedCnt = Number(sp.orders_count || 0)
          const linkedCnt =
            linkedOrdersByPayoutKey.get(`${sp.platform}:${Number(sp.store_id)}:${sp.payout_reference_id}`) || 0
          return expectedCnt > 0 ? linkedCnt >= Math.max(1, Math.floor(expectedCnt * 0.96)) : linkedCnt > 0
        })
      const isTruncatedPageBoundary =
        realPlatOnDay > 0 && realPlatOnDay % 50 === 0 && toastOnDay > realPlatOnDay
      const dayCoverageReady =
        realPlatOnDay > 0 &&
        !isTruncatedPageBoundary &&
        realPlatOnDay >= Math.max(1, Math.floor(toastOnDay * 0.85))
      const toastOnlyStoreSynced = isToastOnlyRow ? dayCoverageReady && payoutCoverageReady : true
      const toastSyncedOnDate =
        (storeDateToastOrders.get(`${Number(o.store_id)}:${o.business_date || ''}`) || 0) > 0 ||
        Boolean(o.raw_payload?.suggested_toast_candidate) ||
        Boolean(o.raw_payload?.toast_live_checked_date)
      const platformMissingToastSynced =
        !isToastOnlyRow &&
        !o.toast_order_guid &&
        !o.raw_payload?.toast_voided &&
        o.raw_payload?.explicit_review_decision !== 'CONFIRM_TOAST_MATCH' &&
        (Number(o.platform_subtotal || 0) > 0 || Number(o.platform_gross_receivable || 0) > 0) &&
        toastSyncedOnDate
      const enrichedBase = {
        ...o,
        store_name: storeMeta.name,
        store_code: storeMeta.code,
        subtotal_diff: subVar,
        tax_diff: taxVar,
        gross_diff: grossVar,
        subtotal_variance: subVar,
        tax_variance: taxVar,
        gross_variance: grossVar,
        toast_only_store_synced: toastOnlyStoreSynced,
        toast_synced_on_date: toastSyncedOnDate,
        platform_missing_toast_synced: platformMissingToastSynced,
      }
      const orderInSelectedPeriod =
        Boolean(payoutRefParam) ||
        Boolean(search && search.length >= 2) ||
        Boolean(o.business_date && o.business_date >= startDate && o.business_date <= endDate)
      const audit = classifyOrderActionGroupAndExplanation(enrichedBase, recoveryCtx)
      const rp = o.raw_payload || {}
      const slimRawPayload = {
        reimbursement_payout_ref: rp.reimbursement_payout_ref ?? undefined,
        reimbursement_period: rp.reimbursement_period ?? undefined,
        reimbursement_deposit_date: rp.reimbursement_deposit_date ?? undefined,
        reimbursement_amount: rp.reimbursement_amount ?? undefined,
        reimbursement_description: rp.reimbursement_description ?? undefined,
        recovery_credits: rp.recovery_credits ?? undefined,
        original_disputed_amount: rp.original_disputed_amount ?? undefined,
        original_disputed_amount_source: rp.original_disputed_amount_source ?? undefined,
        consolidated_from_count: Array.isArray(rp.consolidated_from_rows) ? rp.consolidated_from_rows.length : undefined,
        ambiguous_toast_candidates: rp.ambiguous_toast_candidates ?? undefined,
        suggested_toast_candidate: rp.suggested_toast_candidate ?? undefined,
        missing_tax_breakdown: rp.missing_tax_breakdown ?? undefined,
        tax_breakdown_verified: rp.tax_breakdown_verified ?? undefined,
        unverified_reason: rp.unverified_reason ?? undefined,
        unassigned_store: rp.unassigned_store ?? undefined,
        pending_next_payout: rp.pending_next_payout ?? undefined,
        manual_review_approved: rp.manual_review_approved ?? undefined,
        variance_approval: rp.variance_approval ?? undefined,
        explicit_review_decision: rp.explicit_review_decision ?? undefined,
        explicit_review_notes: rp.explicit_review_notes ?? undefined,
        explicit_reviewed_by: rp.explicit_reviewed_by ?? undefined,
        explicit_reviewed_at: rp.explicit_reviewed_at ?? undefined,
        toast_voided: rp.toast_voided ?? undefined,
        toast_voided_original_subtotal: rp.toast_voided_original_subtotal ?? undefined,
        toast_void_date: rp.toast_void_date ?? undefined,
        cancelled_before_prep: rp.cancelled_before_prep ?? undefined,
        original_cancelled_subtotal: rp.original_cancelled_subtotal ?? undefined,
        orderStatus: rp.orderStatus ?? undefined,
        courierName: rp.courierName ?? undefined,
        canceledBy: rp.canceledBy ?? undefined,
      }
      const itemsSummary = Array.isArray(o.items_summary)
        ? o.items_summary
        : Array.isArray(rp.items_summary)
        ? rp.items_summary
        : Array.isArray(rp.items)
        ? rp.items
        : undefined
      return {
        ...enrichedBase,
        in_selected_period: orderInSelectedPeriod,
        tip_amount: round2(Number(o.tip_amount ?? rp.tip_amount ?? 0)),
        items_summary: itemsSummary,
        raw_payload: slimRawPayload,
        ...audit,
      }
    })

    if (search) {
      orders = orders.filter(
        (o: any) =>
          String(o.platform_order_id || '').toLowerCase().includes(search) ||
          String(o.toast_display_number || '').toLowerCase().includes(search) ||
          String(o.toast_tab_name || '').toLowerCase().includes(search) ||
          String(o.payout_reference_id || '').toLowerCase().includes(search) ||
          String(o.raw_payload?.reimbursement_payout_ref || '').toLowerCase().includes(search) ||
          String(o.raw_payload?.reimbursement_description || '').toLowerCase().includes(search) ||
          String(o.store_name || '').toLowerCase().includes(search)
      )
    }

    // P1-13: Orden de prioridad visual: 1. Bloqueados -> 2. Diferencias por investigar -> 3. Disputas / recuperaciones -> 4. Listos para contabilizar
    const groupPriority: Record<ReconciliationActionGroup, number> = {
      BLOCKED_MISSING_INFO: 1,
      VARIANCE_INVESTIGATE: 2,
      DISPUTE_RECOVERY: 3,
      CONCILIATED_READY: 4,
    }

    orders.sort((a: any, b: any) => {
      const aToastOnly = a.match_confidence === 'TOAST_ONLY' ? 1 : 0
      const bToastOnly = b.match_confidence === 'TOAST_ONLY' ? 1 : 0
      if (aToastOnly !== bToastOnly) return aToastOnly - bToastOnly
      const aPrio = groupPriority[a.action_group as ReconciliationActionGroup] || 9
      const bPrio = groupPriority[b.action_group as ReconciliationActionGroup] || 9
      if (aPrio !== bPrio) return aPrio - bPrio
      if (a.business_date !== b.business_date) return a.business_date > b.business_date ? -1 : 1
      return String(b.placed_at || b.toast_opened_at || '').localeCompare(
        String(a.placed_at || a.toast_opened_at || '')
      )
    })

    // Combinar payouts de DB + payouts en cuarentena (UNASSIGNED_STORE)
    const combinedRawPayouts = [...(rawPayouts || [])]
    if (selectedStoreNum === null || selectedStoreNum === 0) {
      for (let idx = 0; idx < (quarantinedUnassigned.payouts || []).length; idx++) {
        const up = quarantinedUnassigned.payouts[idx]
        if (platformParam && platformParam !== 'ALL' && up.platform !== platformParam) continue
        if (payoutRefParam && up.payout_reference_id !== payoutRefParam) continue
        combinedRawPayouts.push({
          ...up,
          id: `UNASSIGNED-PAY-${up.platform}-${up.payout_reference_id}-${idx}`,
          store_id: 0,
        })
      }
    }

    const payouts = combinedRawPayouts
      .map((p: any) => {
        const sId = Number(p.store_id ?? 0)
        const storeMeta = storeNameMap.get(sId) || {
          name: sId === 0 ? 'Tienda Desconocida (Requiere Mapeo)' : `Store #${sId}`,
          code: sId === 0 ? 'UNASSIGNED_STORE' : '',
        }
        const pKey = `${p.platform}:${sId}:${p.payout_reference_id}`
        const linkedOrdersCount = linkedOrdersByPayoutKey.get(pKey) || 0
        const expectedOrdersCount = Number(p.orders_count || 0)
        const hasMissingTaxFlag =
          Boolean(p.raw_payload?.missing_tax_breakdown) || p.raw_payload?.tax_breakdown_verified === false
        const hasIncompleteOrderDetail = expectedOrdersCount > 0 && linkedOrdersCount === 0
        const prp = p.raw_payload || {}
        const acc = computePayoutAccountingAmounts(p)
        const slimPayoutRaw = {
          tax_breakdown_verified: prp.tax_breakdown_verified ?? undefined,
          period_verified: prp.period_verified ?? undefined,
          missing_tax_breakdown: prp.missing_tax_breakdown ?? undefined,
          unverified_reason: prp.unverified_reason ?? undefined,
          unassigned_store: prp.unassigned_store ?? undefined,
          qb_journal_entry_id: prp.qb_journal_entry_id ?? undefined,
          qb_doc_number: prp.qb_doc_number ?? undefined,
          qb_txn_date: prp.qb_txn_date ?? undefined,
          qb_published_at: prp.qb_published_at ?? undefined,
          qb_publish_status: prp.qb_publish_status ?? undefined,
          qb_last_error: prp.qb_last_error ?? undefined,
          refund_tax_actual: prp.refund_tax_actual ?? undefined,
          cross_payout_refunds: prp.cross_payout_refunds ?? undefined,
          variance_approval: prp.variance_approval ?? undefined,
          portal_deposit_date: prp.portal_deposit_date ?? undefined,
          is_month_end_cutoff: prp.is_month_end_cutoff ?? undefined,
          is_new_month_remainder: prp.is_new_month_remainder ?? undefined,
          created_date: prp.created_date ?? undefined,
        }
        return {
          ...p,
          accounting_gross_receivable: acc.receivableCredit,
          accounting_total_fees: acc.totalFees,
          accounting_err_adj: acc.rawErrAdj,
          raw_payload: slimPayoutRaw,
          store_name: storeMeta.name,
          store_code: storeMeta.code,
          linked_orders_count: linkedOrdersCount,
          coverage_complete: sId > 0 && !hasMissingTaxFlag && !hasIncompleteOrderDetail,
          coverage_warning:
            sId <= 0
              ? 'UNASSIGNED_STORE'
              : hasMissingTaxFlag
              ? 'MISSING_TAX_BREAKDOWN'
              : hasIncompleteOrderDetail
              ? 'MISSING_ORDER_DETAIL_EXTRACTION'
              : null,
        }
      })
      .filter((p: any) => {
        if (payoutRefParam) {
          return p.payout_reference_id === payoutRefParam
        }
        if (search && search.length >= 2) {
          const crossMatch = Array.isArray(p.raw_payload?.cross_payout_refunds)
            ? p.raw_payload.cross_payout_refunds.some(
                (cr: any) =>
                  String(cr?.orderCode || '').toLowerCase().includes(search) ||
                  String(cr?.description || '').toLowerCase().includes(search)
              )
            : false
          return (
            String(p.payout_reference_id || '').toLowerCase().includes(search) ||
            String(p.store_name || '').toLowerCase().includes(search) ||
            String(p.platform || '').toLowerCase().includes(search) ||
            String(p.period_start || '').toLowerCase().includes(search) ||
            String(p.period_end || '').toLowerCase().includes(search) ||
            String(p.payout_date || '').toLowerCase().includes(search) ||
            crossMatch
          )
        }
        const pEnd = p.period_end || ''
        const pStart = p.period_start || pEnd
        const pPay = p.payout_date || ''
        // Defecto 3: solapamiento INCLUSIVO (period_start <= endDate && period_end >= startDate)
        if (pStart && pEnd) {
          return payoutPeriodOverlapsRange(p, startDate, endDate)
        }
        if (pPay) {
          return pPay >= startDate && pPay <= endDate
        }
        return true
      })

    // Calcular cobertura de las 15 tiendas por plataforma en el contexto actual
    const targetStoresForCoverage =
      selectedStoreNum !== null && selectedStoreNum > 0
        ? mappings.filter((m) => m.store_id === selectedStoreNum)
        : mappings

    const platformCoverage = buildStorePlatformCoverageMatrix({
      mappings: targetStoresForCoverage,
      orders,
      payouts,
      encryptionKeyConfigured: hasDedicatedIntegrationEncryptionKey(),
    }).filter((item) => !platformParam || platformParam === 'ALL' || item.platform === platformParam)

    const storeCoverageList = targetStoresForCoverage.map((m) => {
      const stSync = syncStatus.byStore[m.store_id] || {
        toastLastSync: null,
        toastOrders: 0,
        ddLastSync: null,
        ddOrders: 0,
        ddPayouts: 0,
        ghLastSync: null,
        ghOrders: 0,
        ghPayouts: 0,
        ueLastSync: null,
        ueOrders: 0,
        uePayouts: 0,
      }
      const storePayoutsInWindow = payouts.filter((p: any) => Number(p.store_id) === m.store_id)
      const incompletePayouts = storePayoutsInWindow.filter((p: any) => !p.coverage_complete)
      const storePlatformStates = platformCoverage.filter((pc) => pc.store_id === m.store_id)
      const hasFailedOrPartialPlatform = storePlatformStates.some((pc) => pc.status !== 'COMPLETE')
      return {
        store_id: m.store_id,
        store_name: m.store_name,
        store_code: m.store_code,
        toast_orders_total: stSync.toastOrders,
        doordash_orders_total: stSync.ddOrders,
        doordash_payouts_total: stSync.ddPayouts,
        ubereats_orders_total: stSync.ueOrders,
        ubereats_payouts_total: stSync.uePayouts,
        grubhub_orders_total: stSync.ghOrders,
        grubhub_payouts_total: stSync.ghPayouts,
        payouts_in_window: storePayoutsInWindow.length,
        incomplete_payouts_in_window: incompletePayouts.length,
        is_complete_in_window: incompletePayouts.length === 0 && !hasFailedOrPartialPlatform,
        platform_states: storePlatformStates,
      }
    })

    const incompleteStoresInWindow = storeCoverageList.filter((s) => !s.is_complete_in_window)
    const unassignedOrdersCount = quarantinedUnassigned.orders?.length || 0
    const unassignedPayoutsCount = quarantinedUnassigned.payouts?.length || 0
    const nonCompletePlatformCount = platformCoverage.filter((pc) => pc.status !== 'COMPLETE').length

    const totalToastOnlyInWindow = orders.filter((o: any) => o.match_confidence === 'TOAST_ONLY').length
    const totalPayoutsInWindow = payouts.length
    const hasEncryptionKey = hasDedicatedIntegrationEncryptionKey()

    const buildCoverageStatusEs = () => {
      if (
        incompleteStoresInWindow.length === 0 &&
        unassignedOrdersCount === 0 &&
        unassignedPayoutsCount === 0 &&
        nonCompletePlatformCount === 0
      ) {
        return `Cobertura verificada (${storeCoverageList.length}/${mappings.length} sucursales)`
      }
      if (totalPayoutsInWindow === 0 && totalToastOnlyInWindow > 0) {
        return `Alerta informativa: 0 cortes semanales cerrados en este periodo (${totalToastOnlyInWindow} órdenes de Toast POS pendientes de liquidación en plataformas)`
      }
      if (!hasEncryptionKey) {
        return `Alerta informativa: Falta INTEGRATION_ENCRYPTION_KEY en servidor (${incompleteStoresInWindow.length} tienda(s) requieren sincronización)`
      }
      return `Alerta informativa de cobertura (${incompleteStoresInWindow.length} tienda(s) con detalle de órdenes pendiente${
        unassignedOrdersCount + unassignedPayoutsCount > 0
          ? `, ${unassignedOrdersCount + unassignedPayoutsCount} registro(s) sin tienda asignada`
          : ''
      })`
    }

    const buildCoverageStatusEn = () => {
      if (
        incompleteStoresInWindow.length === 0 &&
        unassignedOrdersCount === 0 &&
        unassignedPayoutsCount === 0 &&
        nonCompletePlatformCount === 0
      ) {
        return `Verified coverage (${storeCoverageList.length}/${mappings.length} stores)`
      }
      if (totalPayoutsInWindow === 0 && totalToastOnlyInWindow > 0) {
        return `Informative alert: 0 closed weekly payouts in this period (${totalToastOnlyInWindow} Toast POS orders pending platform settlement)`
      }
      if (!hasEncryptionKey) {
        return `Informative alert: Missing server INTEGRATION_ENCRYPTION_KEY (${incompleteStoresInWindow.length} store(s) require sync)`
      }
      return `Coverage informative alert (${incompleteStoresInWindow.length} store(s) with pending order detail${
        unassignedOrdersCount + unassignedPayoutsCount > 0
          ? `, ${unassignedOrdersCount + unassignedPayoutsCount} unassigned store record(s)`
          : ''
      })`
    }

    const coverageReport = {
      totalStoresConfigured: mappings.length,
      storesEvaluated: storeCoverageList.length,
      storesWithCompleteDetailInWindow: storeCoverageList.length - incompleteStoresInWindow.length,
      incompleteStoresCount: incompleteStoresInWindow.length,
      incompleteStores: incompleteStoresInWindow,
      unassignedOrdersCount,
      unassignedPayoutsCount,
      nonCompletePlatformCount,
      encryptionKeyConfigured: hasEncryptionKey,
      isCoverageComplete:
        incompleteStoresInWindow.length === 0 &&
        unassignedOrdersCount === 0 &&
        unassignedPayoutsCount === 0 &&
        nonCompletePlatformCount === 0,
      statusLabelEs: buildCoverageStatusEs(),
      statusLabelEn: buildCoverageStatusEn(),
      byStore: storeCoverageList,
      byStorePlatform: platformCoverage,
    }

    // Calcular Resumen Ejecutivo (KPIs) y los 4 Grupos de Acción
    let toastNetTotal = 0
    let toastTaxTotal = 0
    let toastTaxForMerchantTotal = 0
    let toastExpectedGrossTotal = 0

    let platformSubtotalTotal = 0
    let platformTaxTotal = 0
    let platformTaxPaidToMerchantTotal = 0
    let platformTaxWithheldTotal = 0
    let platformGrossTotal = 0

    let commissionAndDeliveryTotal = 0
    let processingAndMarketingTotal = 0
    let errorAndAdjustmentTotal = 0
    let netPayoutOrdersTotal = 0

    let conciliatedReadyCount = 0
    let conciliatedReadyGross = 0
    let inTransitNextPayoutCount = 0
    let inTransitNextPayoutGross = 0
    let varianceInvestigateCount = 0
    let varianceInvestigateAmount = 0
    let disputeRecoveryCount = 0
    let disputeRecoveryAmount = 0
    let openDisputeRecoveryCount = 0
    let disputePendingRecoveryAmount = 0
    let closedLossDisputesCount = 0
    let closedLossDisputesAmount = 0
    let priorPeriodRecoveriesCount = 0
    let priorPeriodRecoveriesAmount = 0
    let blockedMissingInfoCount = 0
    let blockedMissingInfoAmount = 0

    let matchedOrdersCount = 0
    let discrepancyOrdersCount = 0
    let disputedOrdersCount = 0

    let settledOrdersCount = 0
    let withPayoutPendingReviewCount = 0
    let settledToastExpectedTotal = 0
    let settledPlatformGrossTotal = 0
    let pendingToastOnlyCount = 0
    let pendingToastOnlyGross = 0

    const initPlatSummary = () => ({
      ordersCount: 0,
      conciliatedReadyCount: 0,
      inTransitNextPayoutCount: 0,
      inTransitNextPayoutGross: 0,
      withPayoutPendingReviewCount: 0,
      varianceInvestigateCount: 0,
      disputeRecoveryCount: 0,
      blockedMissingInfoCount: 0,
      settledOrdersCount: 0,
      matchedCount: 0,
      disputedCount: 0,
      pendingToastCount: 0,
      pendingToastGross: 0,
      toastNet: 0,
      toastTax: 0,
      toastExpectedGross: 0,
      settledToastExpected: 0,
      platformSubtotal: 0,
      platformTaxToMerchant: 0,
      platformTaxWithheld: 0,
      platformGross: 0,
      settledPlatformGross: 0,
      totalFees: 0,
      errorCharges: 0,
      netPayout: 0,
      variance: 0,
      settledVariance: 0,
      payoutsCount: 0,
      payoutsOrdersCount: 0,
      payoutsSubtotalTotal: 0,
      payoutsGrossTotal: 0,
      payoutsFeesTotal: 0,
      payoutsErrorTotal: 0,
      payoutsTipsTotal: 0,
      payoutsTaxToMerchant: 0,
      payoutsTaxWithheld: 0,
      payoutsNetTotal: 0,
      payoutsToastNetTotal: 0,
      payoutsToastTaxTotal: 0,
      payoutsToastExpectedTotal: 0,
      payoutsWithTaxBreakdownCount: 0,
      periodToastOrdersCount: 0,
      periodToastVoidedCount: 0,
      periodToastNet: 0,
      periodToastTax: 0,
      periodToastExpectedGross: 0,
      periodPlatformOrdersCount: 0,
      periodPlatformSubtotal: 0,
      periodPlatformTaxToMerchant: 0,
      periodPlatformTaxWithheld: 0,
      periodPlatformGross: 0,
      periodPlatformFees: 0,
      periodPlatformErrors: 0,
      periodPlatformNetPayout: 0,
      varianceBreakdown: null as {
        mode:
          | 'FULL_ORDER_BRIDGE'
          | 'SUMMARY_ONLY_PENDING_ORDER_SYNC'
          | 'OPEN_PERIOD_NO_PAYOUT'
          | 'NO_ACTIVITY'
        diagnosticStatus:
          | 'OK_TIMING_OR_FAVORABLE'
          | 'NEEDS_REVIEW'
          | 'PENDING_ORDER_SYNC'
          | 'OPEN_PERIOD_NO_PAYOUT'
        payoutRefs: string[]
        toastBaseGross: number
        payoutTargetGross: number
        totalGrossDiff: number
        matchedExactCount: number
        matchedExactGross: number
        items: Array<{
          code:
            | 'PAID_IN_OTHER_PAYOUT'
            | 'IN_TRANSIT_NEXT_PAYOUT'
            | 'FROM_OUTSIDE_PERIOD_IN_PAYOUT'
            | 'VOIDED_IN_TOAST_PAID_IN_PAYOUT'
            | 'IN_PAYOUT_MISSING_IN_TOAST'
            | 'ORDER_PRICE_OR_TAX_DIFF'
            | 'TOAST_UNPAID_IN_PLATFORM'
            | 'TOAST_PENDING_STORE_SYNC'
            | 'PAYOUT_HEADER_ADJUSTMENT'
          count: number
          subtotalDelta: number
          taxDelta: number
          grossDelta: number
          refs: string[]
          dates: string[]
          orders: Array<{
            id: string
            platform_order_id: string
            toast_display_number: string | null
            business_date: string | null
            placed_pt: string | null
            payout_reference_id: string | null
            platform_gross: number
            toast_gross: number
            delta: number
          }>
        }>
      } | null,
    })

    const byPlatform: Record<DeliveryPlatformCode, ReturnType<typeof initPlatSummary>> = {
      DOORDASH: initPlatSummary(),
      UBER_EATS: initPlatSummary(),
      GRUBHUB: initPlatSummary(),
    }

    for (const p of payouts) {
      const plat = (p.platform as DeliveryPlatformCode) || 'DOORDASH'
      if (byPlatform[plat]) {
        const pFees =
          Number(p.commission_fees || 0) +
          Number(p.delivery_fees || 0) +
          Number(p.processing_fees || 0) +
          Number(p.marketing_fees || 0)
        const pErr = Number(p.error_charges || 0) + Number(p.adjustments_amount || 0)
        const pSubSales = Number(p.subtotal_sales || 0)
        const pTaxMerch = Number(p.tax_paid_to_merchant || 0)
        const pTaxRemit = Number(p.tax_remitted_by_platform || 0)
        const pGrossRec = Number(p.accounting_gross_receivable ?? p.platform_gross_receivable ?? 0)
        const pHasTaxBreakdown =
          p.raw_payload?.tax_breakdown_verified === true ||
          pSubSales > 0 ||
          pTaxMerch > 0 ||
          pTaxRemit > 0 ||
          Math.abs(pGrossRec) <= 0.01

        byPlatform[plat].payoutsCount++
        if (pHasTaxBreakdown) {
          byPlatform[plat].payoutsWithTaxBreakdownCount++
        }
        byPlatform[plat].payoutsOrdersCount += Number(p.orders_count || 0)
        byPlatform[plat].payoutsSubtotalTotal = round2(byPlatform[plat].payoutsSubtotalTotal + pSubSales)
        byPlatform[plat].payoutsGrossTotal = round2(
          byPlatform[plat].payoutsGrossTotal + pGrossRec
        )
        byPlatform[plat].payoutsFeesTotal = round2(byPlatform[plat].payoutsFeesTotal + pFees)
        byPlatform[plat].payoutsErrorTotal = round2(byPlatform[plat].payoutsErrorTotal + pErr)
        byPlatform[plat].payoutsTipsTotal = round2(
          byPlatform[plat].payoutsTipsTotal + Number(p.tips_amount || 0)
        )
        byPlatform[plat].payoutsTaxToMerchant = round2(
          byPlatform[plat].payoutsTaxToMerchant + pTaxMerch
        )
        byPlatform[plat].payoutsTaxWithheld = round2(
          byPlatform[plat].payoutsTaxWithheld + pTaxRemit
        )
        byPlatform[plat].payoutsNetTotal = round2(
          byPlatform[plat].payoutsNetTotal + Number(p.net_payout_amount || 0)
        )
        byPlatform[plat].payoutsToastNetTotal = round2(
          byPlatform[plat].payoutsToastNetTotal + Number(p.toast_net_sales || 0)
        )
        byPlatform[plat].payoutsToastTaxTotal = round2(
          byPlatform[plat].payoutsToastTaxTotal + Number(p.toast_tax_amount || 0)
        )
        byPlatform[plat].payoutsToastExpectedTotal = round2(
          byPlatform[plat].payoutsToastExpectedTotal + Number(p.toast_expected_gross || 0)
        )
      }
    }

    const seenToastGuidsByPlat: Record<DeliveryPlatformCode, Set<string>> = {
      DOORDASH: new Set<string>(),
      UBER_EATS: new Set<string>(),
      GRUBHUB: new Set<string>(),
    }
    const isSpecificOrderOrPayoutQuery = Boolean(payoutRefParam) || Boolean(search && search.length >= 2)

    for (const o of orders) {
      const plat = (o.platform as DeliveryPlatformCode) || 'DOORDASH'
      const isToastOnly = o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      const isMatchedBothSides = Boolean(o.toast_order_guid) && !isToastOnly
      const group = o.action_group as ReconciliationActionGroup

      const tNet = Number(o.toast_net_sales || 0)
      const tTax = Number(o.toast_tax || 0)
      const tExp = Number(o.toast_expected_gross || 0)

      const pSub = Number(o.platform_subtotal || 0)
      const pTax = Number(o.platform_tax || 0)
      const pTaxMerch = Number(o.platform_tax_paid_to_merchant || 0)
      const pTaxWithheld = Number(o.platform_tax_withheld || 0)
      const pGross = Number(o.platform_gross_receivable || 0)

      const commDel = Number(o.commission_fee || 0) + Number(o.delivery_fee || 0)
      const procMkt = Number(o.processing_fee || 0) + Number(o.marketing_fee || 0)
      const errAdj = Number(o.error_charge || 0) + Number(o.adjustment_amount || 0)
      const netPay = Number(o.net_payout || 0)

      const isDisputeClosedLoss = isClosedUnrecoveredDisputeStatus(o.dispute_status)
      const isDisputeClosedOrRecovered =
        o.status_code === 'DISPUTE_RECOVERED' || isDisputeClosedLoss
      const hasOrderPayoutRef = Boolean(o.payout_reference_id && String(o.payout_reference_id).trim())
      const inSelectedPeriod = isSpecificOrderOrPayoutQuery
        ? true
        : Boolean(o.business_date && o.business_date >= startDate && o.business_date <= endDate)
      const isInTransitNextPayout = o.status_code === 'CONCILIATED_NEXT_PAYOUT'

      if (!inSelectedPeriod) {
        if (group === 'DISPUTE_RECOVERY') {
          priorPeriodRecoveriesCount++
          priorPeriodRecoveriesAmount = round2(
            priorPeriodRecoveriesAmount + Number(o.recovered_amount || 0)
          )
        }
        continue
      }

      if (group === 'CONCILIATED_READY') {
        conciliatedReadyCount++
        conciliatedReadyGross = round2(conciliatedReadyGross + pGross)
      } else if (group === 'VARIANCE_INVESTIGATE') {
        varianceInvestigateCount++
        varianceInvestigateAmount = round2(varianceInvestigateAmount + Math.abs(Number(o.gross_variance || 0)))
      } else if (group === 'DISPUTE_RECOVERY') {
        disputeRecoveryCount++
        const origDedAbs = Math.max(
          Math.abs(Number(o.error_charge || 0)),
          Number(o.original_deduction_abs || 0)
        )
        const pendingDedAbs =
          typeof o.unrecovered_amount === 'number'
            ? Math.max(0, Number(o.unrecovered_amount))
            : isDisputeClosedOrRecovered
            ? 0
            : origDedAbs
        disputeRecoveryAmount = round2(disputeRecoveryAmount + origDedAbs)
        if (isDisputeClosedLoss) {
          closedLossDisputesCount++
          const lostAmt = Math.max(0, round2(origDedAbs - Number(o.recovered_amount || 0)))
          closedLossDisputesAmount = round2(closedLossDisputesAmount + lostAmt)
        } else if (!isDisputeClosedOrRecovered) {
          openDisputeRecoveryCount++
          disputePendingRecoveryAmount = round2(disputePendingRecoveryAmount + pendingDedAbs)
        }
      } else {
        blockedMissingInfoCount++
        blockedMissingInfoAmount = round2(blockedMissingInfoAmount + (tExp || pGross))
        if (isInTransitNextPayout) {
          inTransitNextPayoutCount++
          inTransitNextPayoutGross = round2(inTransitNextPayoutGross + pGross)
        }
      }

      if (isToastOnly) {
        pendingToastOnlyCount++
        pendingToastOnlyGross = round2(pendingToastOnlyGross + tExp)
      } else {
        // "Listas para contabilizar" exige payout confirmado; "En tránsito" no cuenta como lista ni bloqueada por error
        if (group === 'CONCILIATED_READY') {
          settledOrdersCount++
        } else if (hasOrderPayoutRef && !isDisputeClosedOrRecovered && Number(o.store_id) > 0) {
          withPayoutPendingReviewCount++
        }
        if (isMatchedBothSides) {
          settledToastExpectedTotal = round2(settledToastExpectedTotal + tExp)
          settledPlatformGrossTotal = round2(settledPlatformGrossTotal + pGross)
        }
      }

      if (group === 'CONCILIATED_READY') {
        matchedOrdersCount++
      } else if (!isToastOnly && !isDisputeClosedOrRecovered && !isInTransitNextPayout) {
        discrepancyOrdersCount++
      }

      toastNetTotal += tNet
      toastTaxTotal += tTax
      if (plat === 'DOORDASH' || plat === 'GRUBHUB') {
        toastTaxForMerchantTotal += tTax
      }
      toastExpectedGrossTotal += tExp

      platformSubtotalTotal += pSub
      platformTaxTotal += pTax
      platformTaxPaidToMerchantTotal += pTaxMerch
      platformTaxWithheldTotal += pTaxWithheld
      platformGrossTotal += pGross

      commissionAndDeliveryTotal += commDel
      processingAndMarketingTotal += procMkt
      errorAndAdjustmentTotal += errAdj
      netPayoutOrdersTotal += netPay

      if (group === 'DISPUTE_RECOVERY') {
        disputedOrdersCount++
      }

      if (byPlatform[plat]) {
        byPlatform[plat].ordersCount++
        byPlatform[plat].toastNet = round2(byPlatform[plat].toastNet + tNet)
        byPlatform[plat].toastTax = round2(byPlatform[plat].toastTax + tTax)
        byPlatform[plat].toastExpectedGross = round2(byPlatform[plat].toastExpectedGross + tExp)
        byPlatform[plat].platformSubtotal = round2(byPlatform[plat].platformSubtotal + pSub)
        byPlatform[plat].platformTaxToMerchant = round2(byPlatform[plat].platformTaxToMerchant + pTaxMerch)
        byPlatform[plat].platformTaxWithheld = round2(byPlatform[plat].platformTaxWithheld + pTaxWithheld)
        byPlatform[plat].platformGross = round2(byPlatform[plat].platformGross + pGross)
        byPlatform[plat].totalFees = round2(byPlatform[plat].totalFees + commDel + procMkt)
        byPlatform[plat].errorCharges = round2(byPlatform[plat].errorCharges + errAdj)
        byPlatform[plat].netPayout = round2(byPlatform[plat].netPayout + netPay)
        byPlatform[plat].variance = round2(byPlatform[plat].platformGross - byPlatform[plat].toastExpectedGross)

        if (!isToastOnly) {
          byPlatform[plat].periodPlatformOrdersCount++
          byPlatform[plat].periodPlatformSubtotal = round2(byPlatform[plat].periodPlatformSubtotal + pSub)
          byPlatform[plat].periodPlatformTaxToMerchant = round2(
            byPlatform[plat].periodPlatformTaxToMerchant + pTaxMerch
          )
          byPlatform[plat].periodPlatformTaxWithheld = round2(
            byPlatform[plat].periodPlatformTaxWithheld + pTaxWithheld
          )
          byPlatform[plat].periodPlatformGross = round2(byPlatform[plat].periodPlatformGross + pGross)
          byPlatform[plat].periodPlatformFees = round2(
            byPlatform[plat].periodPlatformFees + commDel + procMkt
          )
          byPlatform[plat].periodPlatformErrors = round2(byPlatform[plat].periodPlatformErrors + errAdj)
          byPlatform[plat].periodPlatformNetPayout = round2(
            byPlatform[plat].periodPlatformNetPayout + netPay
          )
        }

        if (group === 'CONCILIATED_READY') {
          byPlatform[plat].conciliatedReadyCount++
          byPlatform[plat].settledOrdersCount++
          byPlatform[plat].matchedCount++
        } else if (group === 'VARIANCE_INVESTIGATE') {
          byPlatform[plat].varianceInvestigateCount++
          if (hasOrderPayoutRef && Number(o.store_id) > 0) {
            byPlatform[plat].withPayoutPendingReviewCount++
          }
        } else if (group === 'DISPUTE_RECOVERY') {
          byPlatform[plat].disputeRecoveryCount++
          byPlatform[plat].disputedCount++
          if (hasOrderPayoutRef && !isDisputeClosedOrRecovered && Number(o.store_id) > 0) {
            byPlatform[plat].withPayoutPendingReviewCount++
          }
        } else {
          byPlatform[plat].blockedMissingInfoCount++
          if (isInTransitNextPayout) {
            byPlatform[plat].inTransitNextPayoutCount++
            byPlatform[plat].inTransitNextPayoutGross = round2(byPlatform[plat].inTransitNextPayoutGross + pGross)
          }
          if (!isToastOnly && hasOrderPayoutRef && Number(o.store_id) > 0) {
            byPlatform[plat].withPayoutPendingReviewCount++
          }
        }

        if (isToastOnly) {
          byPlatform[plat].pendingToastCount++
          byPlatform[plat].pendingToastGross = round2(byPlatform[plat].pendingToastGross + tExp)
        } else if (isMatchedBothSides) {
          byPlatform[plat].settledToastExpected = round2(byPlatform[plat].settledToastExpected + tExp)
          byPlatform[plat].settledPlatformGross = round2(byPlatform[plat].settledPlatformGross + pGross)
          byPlatform[plat].settledVariance = round2(
            byPlatform[plat].settledPlatformGross - byPlatform[plat].settledToastExpected
          )
        }

        const toastGuid = o.toast_order_guid ? String(o.toast_order_guid).trim() : ''
        const toastDedupKey =
          toastGuid || (Math.abs(tExp) > 0.001 || Math.abs(tNet) > 0.001 ? `row:${o.id}` : '')
        if (toastDedupKey && !seenToastGuidsByPlat[plat].has(toastDedupKey)) {
          seenToastGuidsByPlat[plat].add(toastDedupKey)
          if (o.raw_payload?.toast_voided) {
            byPlatform[plat].periodToastVoidedCount++
          } else {
            byPlatform[plat].periodToastOrdersCount++
          }
          byPlatform[plat].periodToastNet = round2(byPlatform[plat].periodToastNet + tNet)
          byPlatform[plat].periodToastTax = round2(byPlatform[plat].periodToastTax + tTax)
          byPlatform[plat].periodToastExpectedGross = round2(
            byPlatform[plat].periodToastExpectedGross + tExp
          )
        }
      }
    }

    // Puente Contable Exacto (Corte Plataforma vs Toast POS) por Plataforma
    const payoutTupleSetByPlat: Record<DeliveryPlatformCode, Set<string>> = {
      DOORDASH: new Set<string>(),
      UBER_EATS: new Set<string>(),
      GRUBHUB: new Set<string>(),
    }
    const payoutRefsListByPlat: Record<DeliveryPlatformCode, string[]> = {
      DOORDASH: [],
      UBER_EATS: [],
      GRUBHUB: [],
    }
    const activePayoutRefsSet = new Set<string>()
    for (const p of payouts) {
      const plat = ((p.platform as DeliveryPlatformCode) || 'DOORDASH')
      const ref = String(p.payout_reference_id || '').trim()
      if (ref && payoutTupleSetByPlat[plat]) {
        payoutTupleSetByPlat[plat].add(`${Number(p.store_id || 0)}:${ref}`)
        if (!payoutRefsListByPlat[plat].includes(ref)) {
          payoutRefsListByPlat[plat].push(ref)
        }
        activePayoutRefsSet.add(ref)
      }
    }

    const isSafeIsoDate = (val: string) => /^\d{4}-\d{2}-\d{2}$/.test(val)
    const boundaryPayoutOrders: any[] = []
    if (
      !isSpecificOrderOrPayoutQuery &&
      activePayoutRefsSet.size > 0 &&
      isSafeIsoDate(startDate) &&
      isSafeIsoDate(endDate)
    ) {
      const refArr = Array.from(activePayoutRefsSet)
      for (let i = 0; i < refArr.length; i += 80) {
        const chunk = refArr.slice(i, i + 80)
        const chunkRows = await fetchAllSupabaseRows<any>((from, to) => {
          let q = supabaseAdmin
            .from('delivery_platform_orders')
            .select(
              'id, store_id, platform, business_date, placed_at, platform_order_id, toast_order_guid, toast_display_number, payout_reference_id, match_confidence, reconciliation_status, platform_subtotal, platform_tax_paid_to_merchant, platform_tax_withheld, platform_gross_receivable, toast_net_sales, toast_tax, toast_expected_gross, raw_payload'
            )
            .in('payout_reference_id', chunk)
            .or(`business_date.lt.${startDate},business_date.gt.${endDate},business_date.is.null`)
            .order('placed_at', { ascending: true })
            .order('id', { ascending: true })
          if (selectedStoreNum !== null && selectedStoreNum > 0) {
            q = q.eq('store_id', selectedStoreNum)
          }
          if (platformParam && platformParam !== 'ALL') {
            q = q.eq('platform', platformParam)
          }
          if (statusParam && statusParam !== 'ALL') {
            q = q.eq('reconciliation_status', statusParam)
          }
          return q.range(from, to)
        })
        boundaryPayoutOrders.push(...chunkRows)
      }
    }

    // Enriquecer cada payout con la suma viva Toast POS de sus órdenes vinculadas (misma lógica de QBO toastCrossCheckSummary)
    const livePayoutToastStats = new Map<
      string,
      { count: number; net: number; tax: number; expected: number }
    >()
    const seenOrderIdsForPayoutStats = new Set<string>()
    for (const row of [...orders, ...boundaryPayoutOrders]) {
      const rowId = String(row?.id || '')
      if (!rowId || seenOrderIdsForPayoutStats.has(rowId)) continue
      seenOrderIdsForPayoutStats.add(rowId)
      if (row.match_confidence === 'TOAST_ONLY' || row.reconciliation_status === 'MISSING_IN_PLATFORM') continue
      const pRef = String(row.payout_reference_id || '').trim()
      if (!pRef) continue
      const k = `${row.platform}:${Number(row.store_id || 0)}:${pRef}`
      const cur = livePayoutToastStats.get(k) || { count: 0, net: 0, tax: 0, expected: 0 }
      cur.count += 1
      cur.net = round2(cur.net + Number(row.toast_net_sales || 0))
      cur.tax = round2(cur.tax + Number(row.toast_tax || 0))
      cur.expected = round2(cur.expected + Number(row.toast_expected_gross || 0))
      livePayoutToastStats.set(k, cur)
    }
    for (const platKey of ['DOORDASH', 'UBER_EATS', 'GRUBHUB'] as DeliveryPlatformCode[]) {
      byPlatform[platKey].payoutsToastNetTotal = 0
      byPlatform[platKey].payoutsToastTaxTotal = 0
      byPlatform[platKey].payoutsToastExpectedTotal = 0
    }
    for (const p of payouts as any[]) {
      const k = `${p.platform}:${Number(p.store_id || 0)}:${String(p.payout_reference_id || '').trim()}`
      const st = livePayoutToastStats.get(k)
      if (st && st.count > 0) {
        p.toast_matched_orders_count = st.count
        p.toast_net_sales = st.net
        p.toast_tax_amount = st.tax
        p.toast_expected_gross = st.expected
      }
      const accGross = Number(p.accounting_gross_receivable ?? p.platform_gross_receivable ?? 0)
      p.accounting_gross_variance = round2(accGross - Number(p.toast_expected_gross || 0))
      const platCode = (p.platform as DeliveryPlatformCode) || 'DOORDASH'
      if (byPlatform[platCode]) {
        byPlatform[platCode].payoutsToastNetTotal = round2(
          byPlatform[platCode].payoutsToastNetTotal + Number(p.toast_net_sales || 0)
        )
        byPlatform[platCode].payoutsToastTaxTotal = round2(
          byPlatform[platCode].payoutsToastTaxTotal + Number(p.toast_tax_amount || 0)
        )
        byPlatform[platCode].payoutsToastExpectedTotal = round2(
          byPlatform[platCode].payoutsToastExpectedTotal + Number(p.toast_expected_gross || 0)
        )
      }
    }

    const fmtPlacedPtShort = (iso: string | null | undefined): string | null => {
      if (!iso) return null
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      return d.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    }

    for (const plat of ['DOORDASH', 'UBER_EATS', 'GRUBHUB'] as DeliveryPlatformCode[]) {
      const pSum = byPlatform[plat]
      const hasPayouts = pSum.payoutsCount > 0
      const targetGross = hasPayouts ? pSum.payoutsGrossTotal : pSum.periodPlatformGross
      const baseToastGross = pSum.periodToastExpectedGross
      const totalGrossDiff = round2(targetGross - baseToastGross)

      if (!hasPayouts && Math.abs(targetGross) <= 0.009 && Math.abs(baseToastGross) <= 0.009) {
        pSum.varianceBreakdown = {
          mode: 'NO_ACTIVITY',
          diagnosticStatus: 'OK_TIMING_OR_FAVORABLE',
          payoutRefs: [],
          toastBaseGross: 0,
          payoutTargetGross: 0,
          totalGrossDiff: 0,
          matchedExactCount: 0,
          matchedExactGross: 0,
          items: [],
        }
        continue
      }

      const seenRowIds = new Set<string>()
      const unionRows: any[] = []
      for (const o of orders) {
        if (((o.platform as DeliveryPlatformCode) || 'DOORDASH') !== plat) continue
        seenRowIds.add(String(o.id))
        unionRows.push(o)
      }
      for (const b of boundaryPayoutOrders) {
        if (((b.platform as DeliveryPlatformCode) || 'DOORDASH') !== plat) continue
        const ref = String(b.payout_reference_id || '').trim()
        if (!ref || !payoutTupleSetByPlat[plat].has(`${Number(b.store_id || 0)}:${ref}`)) continue
        if (seenRowIds.has(String(b.id))) continue
        seenRowIds.add(String(b.id))
        unionRows.push(b)
      }

      type BridgeCode =
        | 'PAID_IN_OTHER_PAYOUT'
        | 'IN_TRANSIT_NEXT_PAYOUT'
        | 'FROM_OUTSIDE_PERIOD_IN_PAYOUT'
        | 'VOIDED_IN_TOAST_PAID_IN_PAYOUT'
        | 'IN_PAYOUT_MISSING_IN_TOAST'
        | 'ORDER_PRICE_OR_TAX_DIFF'
        | 'TOAST_UNPAID_IN_PLATFORM'
        | 'TOAST_PENDING_STORE_SYNC'
        | 'PAYOUT_HEADER_ADJUSTMENT'

      const bucketMap = new Map<
        BridgeCode,
        {
          code: BridgeCode
          count: number
          subtotalDelta: number
          taxDelta: number
          grossDelta: number
          refsSet: Set<string>
          datesSet: Set<string>
          rawOrders: Array<{
            sortTs: string
            id: string
            platform_order_id: string
            toast_display_number: string | null
            business_date: string | null
            placed_pt: string | null
            payout_reference_id: string | null
            platform_gross: number
            toast_gross: number
            delta: number
          }>
        }
      >()

      const ensureBucket = (code: BridgeCode) => {
        let b = bucketMap.get(code)
        if (!b) {
          b = {
            code,
            count: 0,
            subtotalDelta: 0,
            taxDelta: 0,
            grossDelta: 0,
            refsSet: new Set<string>(),
            datesSet: new Set<string>(),
            rawOrders: [],
          }
          bucketMap.set(code, b)
        }
        return b
      }

      const seenToastDedupBridge = new Set<string>()
      let payoutMatchedRowCount = 0
      let sumOfPayoutOrderGross = 0
      let sumOfPayoutOrderSub = 0
      let sumOfPayoutOrderTax = 0
      let matchedExactCount = 0
      let matchedExactGross = 0

      for (const r of unionRows) {
        const isToastOnly =
          r.match_confidence === 'TOAST_ONLY' || r.reconciliation_status === 'MISSING_IN_PLATFORM'
        const tNet = Number(r.toast_net_sales || 0)
        const tTax = Number(r.toast_tax || 0)
        const tExp = Number(r.toast_expected_gross || 0)
        const pSub = Number(r.platform_subtotal || 0)
        const pTaxMerch = Number(r.platform_tax_paid_to_merchant || 0)
        const pGross = Number(r.platform_gross_receivable || 0)
        const pRef = String(r.payout_reference_id || '').trim()

        const inPeriod = isSpecificOrderOrPayoutQuery
          ? true
          : Boolean(r.business_date && r.business_date >= startDate && r.business_date <= endDate)
        const inPayout = hasPayouts
          ? Boolean(pRef) && payoutTupleSetByPlat[plat].has(`${Number(r.store_id || 0)}:${pRef}`)
          : !isToastOnly && inPeriod

        if (inPayout) {
          payoutMatchedRowCount++
          sumOfPayoutOrderGross = round2(sumOfPayoutOrderGross + pGross)
          sumOfPayoutOrderSub = round2(sumOfPayoutOrderSub + pSub)
          sumOfPayoutOrderTax = round2(
            sumOfPayoutOrderTax + (plat === 'UBER_EATS' ? 0 : pTaxMerch)
          )
        }

        let effTNet = 0
        let effTTax = 0
        let effTExp = 0
        if (inPeriod) {
          const toastGuid = r.toast_order_guid ? String(r.toast_order_guid).trim() : ''
          const toastDedupKey =
            toastGuid || (Math.abs(tExp) > 0.001 || Math.abs(tNet) > 0.001 ? `row:${r.id}` : '')
          if (toastDedupKey && !seenToastDedupBridge.has(toastDedupKey)) {
            seenToastDedupBridge.add(toastDedupKey)
            effTNet = tNet
            effTTax = plat === 'UBER_EATS' ? 0 : tTax
            effTExp = tExp
          }
        }

        const pushToBucket = (
          code: BridgeCode,
          subDelta: number,
          taxDelta: number,
          grossDelta: number,
          refForTag?: string | null,
          dateForTag?: string | null,
          platGrossSample = 0,
          toastGrossSample = 0
        ) => {
          const b = ensureBucket(code)
          b.count++
          b.subtotalDelta = round2(b.subtotalDelta + subDelta)
          b.taxDelta = round2(b.taxDelta + taxDelta)
          b.grossDelta = round2(b.grossDelta + grossDelta)
          if (refForTag) b.refsSet.add(refForTag)
          if (dateForTag) b.datesSet.add(dateForTag)
          b.rawOrders.push({
            sortTs: String(r.placed_at || r.business_date || ''),
            id: String(r.id),
            platform_order_id: String(r.platform_order_id || ''),
            toast_display_number: r.toast_display_number ? String(r.toast_display_number) : null,
            business_date: r.business_date ? String(r.business_date) : null,
            placed_pt: fmtPlacedPtShort(r.placed_at),
            payout_reference_id: pRef || null,
            platform_gross: round2(platGrossSample),
            toast_gross: round2(toastGrossSample),
            delta: round2(grossDelta),
          })
        }

        if (inPeriod && !inPayout) {
          const gDelta = round2(-effTExp)
          if (Math.abs(gDelta) >= 0.005) {
            const sDelta = round2(-effTNet)
            const txDelta = round2(-effTTax)
            if (!isToastOnly && pRef) {
              pushToBucket(
                'PAID_IN_OTHER_PAYOUT',
                sDelta,
                txDelta,
                gDelta,
                pRef,
                r.business_date,
                pGross,
                effTExp
              )
            } else if (!isToastOnly) {
              pushToBucket(
                'IN_TRANSIT_NEXT_PAYOUT',
                sDelta,
                txDelta,
                gDelta,
                null,
                r.business_date,
                pGross,
                effTExp
              )
            } else if (r.toast_only_store_synced) {
              pushToBucket(
                'TOAST_UNPAID_IN_PLATFORM',
                sDelta,
                txDelta,
                gDelta,
                null,
                r.business_date,
                0,
                effTExp
              )
            } else {
              pushToBucket(
                'TOAST_PENDING_STORE_SYNC',
                sDelta,
                txDelta,
                gDelta,
                null,
                r.business_date,
                0,
                effTExp
              )
            }
          }
        } else if (!inPeriod && inPayout) {
          const gDelta = round2(pGross)
          if (Math.abs(gDelta) >= 0.005) {
            const sDelta = round2(pSub)
            const txDelta = round2(plat === 'UBER_EATS' ? 0 : pTaxMerch)
            pushToBucket(
              'FROM_OUTSIDE_PERIOD_IN_PAYOUT',
              sDelta,
              txDelta,
              gDelta,
              pRef,
              r.business_date,
              pGross,
              0
            )
          }
        } else if (inPeriod && inPayout) {
          const gDelta = round2(pGross - effTExp)
          const sDelta = round2(pSub - effTNet)
          const txDelta = round2((plat === 'UBER_EATS' ? 0 : pTaxMerch) - effTTax)
          if (Math.abs(gDelta) < 0.005) {
            if (Math.abs(pGross) > 0.005) {
              matchedExactCount++
              matchedExactGross = round2(matchedExactGross + pGross)
            }
          } else if (r.raw_payload?.toast_voided) {
            pushToBucket(
              'VOIDED_IN_TOAST_PAID_IN_PAYOUT',
              sDelta,
              txDelta,
              gDelta,
              pRef,
              r.business_date,
              pGross,
              effTExp
            )
          } else if (!r.toast_order_guid) {
            pushToBucket(
              'IN_PAYOUT_MISSING_IN_TOAST',
              sDelta,
              txDelta,
              gDelta,
              pRef,
              r.business_date,
              pGross,
              0
            )
          } else {
            pushToBucket(
              'ORDER_PRICE_OR_TAX_DIFF',
              sDelta,
              txDelta,
              gDelta,
              pRef,
              r.business_date,
              pGross,
              effTExp
            )
          }
        }
      }

      if (hasPayouts && payoutMatchedRowCount === 0 && Math.abs(targetGross) > 0.01) {
        pSum.varianceBreakdown = {
          mode: 'SUMMARY_ONLY_PENDING_ORDER_SYNC',
          diagnosticStatus: 'PENDING_ORDER_SYNC',
          payoutRefs: payoutRefsListByPlat[plat],
          toastBaseGross: baseToastGross,
          payoutTargetGross: targetGross,
          totalGrossDiff,
          matchedExactCount: 0,
          matchedExactGross: 0,
          items: [],
        }
        continue
      }

      const headerResidual = round2(targetGross - sumOfPayoutOrderGross)
      if (Math.abs(headerResidual) >= 0.01) {
        const b = ensureBucket('PAYOUT_HEADER_ADJUSTMENT')
        b.count = Math.max(1, pSum.payoutsCount)
        b.subtotalDelta = round2(pSum.payoutsSubtotalTotal - sumOfPayoutOrderSub)
        b.taxDelta = round2(
          (plat === 'UBER_EATS' ? 0 : pSum.payoutsTaxToMerchant) - sumOfPayoutOrderTax
        )
        b.grossDelta = headerResidual
        for (const ref of payoutRefsListByPlat[plat]) b.refsSet.add(ref)
      }

      const orderedCodes: BridgeCode[] = [
        'PAID_IN_OTHER_PAYOUT',
        'IN_TRANSIT_NEXT_PAYOUT',
        'FROM_OUTSIDE_PERIOD_IN_PAYOUT',
        'VOIDED_IN_TOAST_PAID_IN_PAYOUT',
        'IN_PAYOUT_MISSING_IN_TOAST',
        'ORDER_PRICE_OR_TAX_DIFF',
        'TOAST_UNPAID_IN_PLATFORM',
        'TOAST_PENDING_STORE_SYNC',
        'PAYOUT_HEADER_ADJUSTMENT',
      ]

      const itemsOut = orderedCodes
        .map((c) => bucketMap.get(c))
        .filter((b): b is NonNullable<typeof b> => Boolean(b && Math.abs(b.grossDelta) >= 0.005))
        .map((b) => {
          b.rawOrders.sort((x, y) => x.sortTs.localeCompare(y.sortTs))
          return {
            code: b.code,
            count: b.count,
            subtotalDelta: b.subtotalDelta,
            taxDelta: b.taxDelta,
            grossDelta: b.grossDelta,
            refs: Array.from(b.refsSet),
            dates: Array.from(b.datesSet).sort(),
            orders: b.rawOrders.slice(0, 250).map(({ sortTs: _unused, ...rest }) => rest),
          }
        })

      const safeCodes = new Set<BridgeCode>([
        'PAID_IN_OTHER_PAYOUT',
        'IN_TRANSIT_NEXT_PAYOUT',
        'FROM_OUTSIDE_PERIOD_IN_PAYOUT',
        'VOIDED_IN_TOAST_PAID_IN_PAYOUT',
      ])
      const isOpenPeriodNoPayout =
        !hasPayouts && pSum.periodPlatformOrdersCount === 0 && baseToastGross > 0.01
      const allTimingOrFavorable = itemsOut.every((it) => safeCodes.has(it.code))

      pSum.varianceBreakdown = {
        mode: isOpenPeriodNoPayout ? 'OPEN_PERIOD_NO_PAYOUT' : 'FULL_ORDER_BRIDGE',
        diagnosticStatus: isOpenPeriodNoPayout
          ? 'OPEN_PERIOD_NO_PAYOUT'
          : allTimingOrFavorable
          ? 'OK_TIMING_OR_FAVORABLE'
          : 'NEEDS_REVIEW',
        payoutRefs: payoutRefsListByPlat[plat],
        toastBaseGross: baseToastGross,
        payoutTargetGross: targetGross,
        totalGrossDiff,
        matchedExactCount,
        matchedExactGross,
        items: itemsOut,
      }
    }

    const totalFeesAll = round2(commissionAndDeliveryTotal + processingAndMarketingTotal)
    const effectiveFeePct =
      platformGrossTotal > 0 ? round2((Math.abs(totalFeesAll) / platformGrossTotal) * 100) : 0
    const settledVarianceTotal = round2(settledPlatformGrossTotal - settledToastExpectedTotal)

    // Calcular desglose bidireccional explícito: Toast POS <-> Plataformas Delivery
    let inToastUnpaidSyncedStoreCount = 0
    let inToastUnpaidSyncedStoreGross = 0
    let inToastPendingStoreSyncCount = 0
    let inToastPendingStoreSyncGross = 0
    let inPlatformNotInToastCount = 0
    let inPlatformNotInToastGross = 0
    let otherBlockedPlatformCount = 0
    let otherBlockedPlatformGross = 0
    const pendingSyncStoreIdsSet = new Set<number>()

    for (const o of orders) {
      if (o.in_selected_period === false) continue
      const isToastOnly = o.match_confidence === 'TOAST_ONLY' || o.reconciliation_status === 'MISSING_IN_PLATFORM'
      const tExp = Number(o.toast_expected_gross || 0)
      const pGross = Number(o.platform_gross_receivable || 0)
      if (isToastOnly) {
        if (o.toast_only_store_synced) {
          inToastUnpaidSyncedStoreCount++
          inToastUnpaidSyncedStoreGross = round2(inToastUnpaidSyncedStoreGross + tExp)
        } else {
          inToastPendingStoreSyncCount++
          inToastPendingStoreSyncGross = round2(inToastPendingStoreSyncGross + tExp)
          if (Number(o.store_id) > 0) pendingSyncStoreIdsSet.add(Number(o.store_id))
        }
      } else if (o.platform_missing_toast_synced && !o.raw_payload?.toast_voided) {
        inPlatformNotInToastCount++
        inPlatformNotInToastGross = round2(inPlatformNotInToastGross + pGross)
      } else if (o.action_group === 'BLOCKED_MISSING_INFO' && o.status_code !== 'CONCILIATED_NEXT_PAYOUT') {
        otherBlockedPlatformCount++
        otherBlockedPlatformGross = round2(otherBlockedPlatformGross + (tExp || pGross))
      }
    }

    const bidirectionalSummary = {
      paidAndMatchedCount: conciliatedReadyCount,
      paidAndMatchedGross: round2(conciliatedReadyGross),
      inTransitNextPayoutCount,
      inTransitNextPayoutGross: round2(inTransitNextPayoutGross),
      underpaidOrDisputedCount: varianceInvestigateCount + openDisputeRecoveryCount,
      underpaidOrDisputedAmount: round2(varianceInvestigateAmount + disputePendingRecoveryAmount),
      varianceInvestigateCount,
      varianceInvestigateAmount: round2(varianceInvestigateAmount),
      disputeRecoveryCount,
      disputeRecoveryAmount: round2(disputeRecoveryAmount),
      openDisputeRecoveryCount,
      disputePendingRecoveryAmount: round2(disputePendingRecoveryAmount),
      closedLossDisputesCount,
      closedLossDisputesAmount: round2(closedLossDisputesAmount),
      priorPeriodRecoveriesCount,
      priorPeriodRecoveriesAmount: round2(priorPeriodRecoveriesAmount),
      inToastUnpaidSyncedStoreCount,
      inToastUnpaidSyncedStoreGross: round2(inToastUnpaidSyncedStoreGross),
      inToastPendingStoreSyncCount,
      inToastPendingStoreSyncGross: round2(inToastPendingStoreSyncGross),
      inPlatformNotInToastCount,
      inPlatformNotInToastGross: round2(inPlatformNotInToastGross),
      otherBlockedPlatformCount,
      otherBlockedPlatformGross: round2(otherBlockedPlatformGross),
      pendingSyncStoreIds: Array.from(pendingSyncStoreIdsSet).sort((a, b) => a - b),
    }

    const summary = {
      totalOrders: orders.length,
      conciliatedReadyCount,
      conciliatedReadyGross: round2(conciliatedReadyGross),
      inTransitNextPayoutCount,
      inTransitNextPayoutGross: round2(inTransitNextPayoutGross),
      withPayoutPendingReviewCount,
      varianceInvestigateCount,
      varianceInvestigateAmount: round2(varianceInvestigateAmount),
      disputeRecoveryCount,
      disputeRecoveryAmount: round2(disputeRecoveryAmount),
      openDisputeRecoveryCount,
      disputePendingRecoveryAmount: round2(disputePendingRecoveryAmount),
      closedLossDisputesCount,
      closedLossDisputesAmount: round2(closedLossDisputesAmount),
      priorPeriodRecoveriesCount,
      priorPeriodRecoveriesAmount: round2(priorPeriodRecoveriesAmount),
      blockedMissingInfoCount,
      blockedMissingInfoAmount: round2(blockedMissingInfoAmount),
      bidirectionalSummary,
      settledOrdersCount,
      matchedOrdersCount,
      discrepancyOrdersCount,
      disputedOrdersCount,
      pendingToastOnlyCount,
      pendingToastOnlyGross: round2(pendingToastOnlyGross),
      settledToastExpectedTotal: round2(settledToastExpectedTotal),
      settledPlatformGrossTotal: round2(settledPlatformGrossTotal),
      settledVarianceTotal,
      payoutsCount: payouts.length,
      toastNetTotal: round2(toastNetTotal),
      toastTaxTotal: round2(toastTaxTotal),
      toastTaxForMerchantTotal: round2(toastTaxForMerchantTotal),
      toastExpectedGrossTotal: round2(toastExpectedGrossTotal),
      platformSubtotalTotal: round2(platformSubtotalTotal),
      platformTaxTotal: round2(platformTaxTotal),
      platformTaxPaidToMerchantTotal: round2(platformTaxPaidToMerchantTotal),
      platformTaxWithheldTotal: round2(platformTaxWithheldTotal),
      platformGrossTotal: round2(platformGrossTotal),
      commissionAndDeliveryTotal: round2(commissionAndDeliveryTotal),
      processingAndMarketingTotal: round2(processingAndMarketingTotal),
      totalFeesAll,
      effectiveFeePct,
      errorAndAdjustmentTotal: round2(errorAndAdjustmentTotal),
      netPayoutOrdersTotal: round2(netPayoutOrdersTotal),
      grossVarianceTotal: round2(platformGrossTotal - toastExpectedGrossTotal),
      byPlatform,
    }

    return NextResponse.json({
      success: true,
      mappings,
      orders,
      payouts,
      summary,
      syncStatus,
      coverageReport,
    })
  } catch (error: any) {
    console.error('[GET /api/delivery-reconciliation] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Payload inválido' }, { status: 400 })
    }
    const action = String(body.action || '').trim()

    if (action === 'sync_live') {
      const storeIdsArray = Array.isArray(body.store_ids)
        ? body.store_ids.map((id: any) => Number(id)).filter((n: number) => Number.isFinite(n) && n > 0)
        : []
      const storeId =
        storeIdsArray.length > 0
          ? storeIdsArray
          : body.store_id && body.store_id !== 'ALL' && Number.isFinite(Number(body.store_id)) && Number(body.store_id) > 0
            ? [Number(body.store_id)]
            : []

      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'sync',
        allowCron: true,
        targetStoreIds: storeId,
        requireAllStores: storeId.length === 0,
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const startDate = isValidIsoDate(body.start_date)
        ? body.start_date.trim()
        : new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
      const endDate = isValidIsoDate(body.end_date)
        ? body.end_date.trim()
        : new Date().toISOString().slice(0, 10)

      if (startDate > endDate) {
        return NextResponse.json(
          { success: false, error: 'La fecha de inicio no puede ser posterior a la fecha final.' },
          { status: 400 }
        )
      }

      const requestedPlat =
        body.platform && VALID_PLATFORMS.has(String(body.platform))
          ? (String(body.platform) as 'DOORDASH' | 'UBER_EATS' | 'GRUBHUB')
          : 'ALL'
      const result = await reconcileAndPersistDeliveryData({
        storeIds: storeId,
        startDate,
        endDate,
        syncToast: body.sync_toast !== false,
        syncGrubhubLive: body.sync_grubhub !== false,
        syncChromePlatforms:
          body.sync_chrome_platforms !== undefined
            ? Boolean(body.sync_chrome_platforms)
            : requestedPlat !== 'GRUBHUB',
        targetPlatform: requestedPlat,
      })

      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    if (action === 'import_report') {
      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'sync',
        allowCron: false,
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const rawContent = String(body.raw_content || '')
      const forcedPlatform =
        body.platform && VALID_PLATFORMS.has(String(body.platform)) ? body.platform : 'AUTO'
      // P1-10: Prohibido asumir Lynwood #14 o usar defaultStoreId sin confirmación explícita del usuario
      const explicitStoreId: number | undefined =
        body.store_id && body.store_id !== 'ALL' && Number.isFinite(Number(body.store_id)) && Number(body.store_id) > 0
          ? Number(body.store_id)
          : undefined
      const confirmStoreAssignment = Boolean(explicitStoreId && body.confirm_store_assignment === true)

      if (!rawContent.trim()) {
        return NextResponse.json({ success: false, error: 'El contenido del archivo está vacío.' }, { status: 400 })
      }

      const parsed = await parsePlatformReportPayload(rawContent, forcedPlatform, explicitStoreId, {
        confirmStoreAssignment,
        confirmedByUserId: auth.user?.id || null,
        confirmedByEmail: auth.user?.email || 'staff',
        confirmedAt: new Date().toISOString(),
      })
      if (parsed.orders.length === 0 && parsed.payouts.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No se encontraron transacciones válidas en el archivo.' },
          { status: 400 }
        )
      }

      const storeIdsSet = new Set<number>()
      let minDate = isValidIsoDate(body.start_date) ? body.start_date : '2099-12-31'
      let maxDate = isValidIsoDate(body.end_date) ? body.end_date : '2000-01-01'

      for (const o of parsed.orders) {
        if (o.storeId > 0) storeIdsSet.add(o.storeId)
        if (o.businessDate < minDate) minDate = o.businessDate
        if (o.businessDate > maxDate) maxDate = o.businessDate
      }
      for (const p of parsed.payouts) {
        if (p.store_id && Number(p.store_id) > 0) storeIdsSet.add(Number(p.store_id))
      }

      // Verificar alcance de sucursales para usuarios restringidos a una tienda
      const storeScopeAuth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'sync',
        allowCron: false,
        targetStoreIds: Array.from(storeIdsSet),
      })
      if (!storeScopeAuth.authorized) {
        return NextResponse.json(
          { success: false, error: storeScopeAuth.error || 'Acceso denegado a sucursal del reporte' },
          { status: storeScopeAuth.status || 403 }
        )
      }

      if (minDate > maxDate) {
        const today = new Date().toISOString().slice(0, 10)
        minDate = today
        maxDate = today
      }

      const result = await reconcileAndPersistDeliveryData({
        storeIds: Array.from(storeIdsSet),
        startDate: minDate,
        endDate: maxDate,
        syncToast: body.sync_toast !== false,
        syncGrubhubLive: false,
        importedPlatformOrders: parsed.orders,
        importedPayouts: parsed.payouts,
      })

      return NextResponse.json({
        success: true,
        detectedPlatform: parsed.detectedPlatform,
        importedOrdersCount: parsed.orders.length,
        importedPayoutsCount: parsed.payouts.length,
        manualStoreOverrideApplied: confirmStoreAssignment,
        ...result,
      })
    }

    if (action === 'update_dispute') {
      const {
        id,
        dispute_status,
        dispute_notes,
        dispute_reason,
        reimbursement_payout_ref,
        reimbursement_amount,
        reimbursement_deposit_date,
        reimbursement_description,
      } = body
      if (!id) {
        return NextResponse.json({ success: false, error: 'Missing order id' }, { status: 400 })
      }

      const normalizedStatus = String(dispute_status || 'NONE').toUpperCase()
      if (!VALID_DISPUTE_STATUSES.has(normalizedStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid dispute_status: ${dispute_status}` },
          { status: 400 }
        )
      }

      const { data: existingOrd, error: fetchErr } = await supabaseAdmin
        .from('delivery_platform_orders')
        .select(
          'id, store_id, platform, platform_order_id, business_date, payout_reference_id, payout_date, error_charge, platform_gross_receivable, toast_expected_gross, raw_payload, dispute_amount, dispute_status, dispute_notes, is_disputed, reconciliation_status'
        )
        .eq('id', id)
        .single()

      if (fetchErr || !existingOrd) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })
      }

      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'dispute_review',
        allowCron: false,
        targetStoreIds: [Number(existingOrd.store_id)],
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const effectivePayoutRef = String(
        reimbursement_payout_ref !== undefined
          ? reimbursement_payout_ref || ''
          : existingOrd.raw_payload?.reimbursement_payout_ref || ''
      ).trim()
      const effectiveReimbAmt = round2(
        Number(
          reimbursement_amount !== undefined
            ? reimbursement_amount || 0
            : existingOrd.raw_payload?.reimbursement_amount || 0
        )
      )
      const effectiveDepositDate = String(
        reimbursement_deposit_date !== undefined
          ? reimbursement_deposit_date || ''
          : existingOrd.raw_payload?.reimbursement_deposit_date || ''
      ).trim()
      const effectiveNotes = String(
        (dispute_notes !== undefined && String(dispute_notes).trim() ? dispute_notes : undefined) ??
          (reimbursement_description !== undefined && String(reimbursement_description).trim()
            ? reimbursement_description
            : undefined) ??
          existingOrd.dispute_notes ??
          existingOrd.raw_payload?.reimbursement_description ??
          ''
      ).trim()

      // P0-6: No permitir estado REIMBURSED sin payout de recuperación, monto > 0, fecha de depósito y nota/evidencia obligatoria,
      // validando en DB que el payout exista, pertenezca a la misma plataforma/tienda y tenga consistencia de importe.
      let recoveryPayout: Record<string, any> | null = null
      let recoveryPayoutLookedUp = false
      const lookupRecoveryPayout = async () => {
        recoveryPayoutLookedUp = true
        const { data: rows, error: rpErr } = await supabaseAdmin
          .from('delivery_platform_payouts')
          .select('id, store_id, platform, payout_reference_id, payout_date, period_start, period_end, net_payout_amount, adjustments_amount, raw_payload')
          .eq('store_id', existingOrd.store_id)
          .eq('platform', existingOrd.platform)
          .eq('payout_reference_id', effectivePayoutRef)
        if (rpErr) throw new Error(rpErr.message)
        return rows || []
      }
      if (normalizedStatus === 'REIMBURSED') {
        if (!effectivePayoutRef) {
          return NextResponse.json(
            {
              success: false,
              error: 'No se permite marcar como REIMBURSED sin una referencia de payout de recuperación (reimbursement_payout_ref).',
            },
            { status: 400 }
          )
        }
        if (!Number.isFinite(effectiveReimbAmt) || effectiveReimbAmt <= 0) {
          return NextResponse.json(
            {
              success: false,
              error: 'No se permite marcar como REIMBURSED sin un monto de recuperación positivo (reimbursement_amount > 0).',
            },
            { status: 400 }
          )
        }
        if (!isValidIsoDate(effectiveDepositDate)) {
          return NextResponse.json(
            {
              success: false,
              error: 'No se permite marcar como REIMBURSED sin una fecha válida de depósito/recuperación (YYYY-MM-DD).',
            },
            { status: 400 }
          )
        }
        if (effectiveNotes.length < 5) {
          return NextResponse.json(
            {
              success: false,
              error: 'No se permite marcar como REIMBURSED sin nota o evidencia obligatoria (mínimo 5 caracteres).',
            },
            { status: 400 }
          )
        }

        const recoveryPayouts = await lookupRecoveryPayout()

        if (!recoveryPayouts || recoveryPayouts.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: `El payout de recuperación #${effectivePayoutRef} no existe o no pertenece a la sucursal #${existingOrd.store_id} y plataforma ${existingOrd.platform}.`,
            },
            { status: 400 }
          )
        }
        if (recoveryPayouts.length > 1) {
          return NextResponse.json(
            {
              success: false,
              error: `Referencia de payout de recuperación #${effectivePayoutRef} ambigua (${recoveryPayouts.length} registros). Requiere revisión.`,
            },
            { status: 400 }
          )
        }

        const maxPossibleRecovery = round2(
          Math.max(
            Math.abs(Number(existingOrd.error_charge || 0)),
            Math.abs(Number(existingOrd.platform_gross_receivable || 0)),
            Number(existingOrd.toast_expected_gross || 0)
          )
        )
        if (maxPossibleRecovery > 0 && effectiveReimbAmt > maxPossibleRecovery + 0.5) {
          return NextResponse.json(
            {
              success: false,
              error: `El monto de recuperación ($${effectiveReimbAmt.toFixed(2)}) excede el importe máximo reclamable de la orden ($${maxPossibleRecovery.toFixed(2)}).`,
            },
            { status: 400 }
          )
        }
        recoveryPayout = recoveryPayouts[0]
      }

      const nowIso = new Date().toISOString()
      const hasRecoveryInput =
        reimbursement_payout_ref !== undefined || reimbursement_amount !== undefined || reimbursement_deposit_date !== undefined
      let recoveryVerification: { verified: boolean; issue: string | null } | null = null
      let baseRaw: Record<string, any>

      // Defectos 1 y 2: la recuperación se agrega al libro `recovery_credits` y se verifica contra el settlement;
      // el importe original disputado (`dispute_amount` / `original_disputed_amount`) nunca se sustituye.
      if (effectivePayoutRef && effectiveReimbAmt > 0 && (hasRecoveryInput || normalizedStatus === 'REIMBURSED')) {
        if (!recoveryPayoutLookedUp) {
          const rows = await lookupRecoveryPayout()
          recoveryPayout = rows.length === 1 ? rows[0] : null
        }
        const built = buildManualRecoveryUpdate({
          existingOrder: existingOrd,
          recoveryPayout: recoveryPayout as any,
          input: {
            payoutRef: effectivePayoutRef,
            amount: effectiveReimbAmt,
            depositDate: isValidIsoDate(effectiveDepositDate) ? effectiveDepositDate : null,
            description:
              reimbursement_description !== undefined ? String(reimbursement_description || '').trim() || null : null,
            evidence: effectiveNotes || null,
          },
          actorEmail: auth.user?.email || 'staff',
          nowIso,
        })
        baseRaw = built.rawPayload
        recoveryVerification = { verified: built.verification.verified, issue: built.verification.issue }
      } else {
        const original = resolveOriginalDisputedAmount(existingOrd)
        baseRaw = {
          ...(existingOrd?.raw_payload || {}),
          ...(reimbursement_description !== undefined
            ? { reimbursement_description: String(reimbursement_description || '').trim() || null }
            : {}),
          ...(original.amount !== null && !(Number(existingOrd?.raw_payload?.original_disputed_amount || 0) > 0)
            ? { original_disputed_amount: original.amount, original_disputed_amount_source: original.source }
            : {}),
        }
      }

      const updatedRaw = {
        ...baseRaw,
        reimbursement_evidence: effectiveNotes || null,
        last_dispute_updated_by_id: auth.user?.id || null,
        last_dispute_updated_by: auth.user?.email || 'staff',
        last_dispute_updated_by_role: auth.user?.role || null,
        last_dispute_updated_at: nowIso,
      }

      const recoveryEval = evaluateDisputeRecovery(
        {
          ...existingOrd,
          dispute_status: normalizedStatus,
          dispute_notes: effectiveNotes,
          raw_payload: updatedRaw,
        },
        recoveryPayout ? { settlementPayouts: buildRecoverySettlementIndex([recoveryPayout]) } : undefined
      )

      const finalRaw = {
        ...updatedRaw,
        recovery_classification: recoveryEval.recoveryClassification,
        verified_recovered_amount: recoveryEval.verifiedRecoveredAmount,
        unrecovered_amount: recoveryEval.unrecoveredAmount,
      }

      const isDisputed = normalizedStatus !== 'NONE'
      const updatePayload: Record<string, any> = {
        is_disputed: Boolean(isDisputed),
        dispute_status: normalizedStatus,
        raw_payload: finalRaw,
        updated_at: nowIso,
      }
      // Conservar notas y razón existentes cuando la solicitud no las envía
      if (dispute_notes !== undefined) updatePayload.dispute_notes = String(dispute_notes || '').slice(0, 1000)
      if (dispute_reason !== undefined) updatePayload.dispute_reason = String(dispute_reason || '').slice(0, 500)
      // `dispute_amount` = importe ORIGINAL disputado (solo se completa si está comprobado; nunca con el recuperado)
      if (recoveryEval.originalAmountVerified && recoveryEval.originalDeductionAbs > 0) {
        updatePayload.dispute_amount = recoveryEval.originalDeductionAbs
      }

      const { data, error } = await supabaseAdmin
        .from('delivery_platform_orders')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(error.message)
      return NextResponse.json({
        success: true,
        order: data,
        recovery_evaluation: recoveryEval,
        recovery_verification: recoveryVerification,
        ...(recoveryVerification && !recoveryVerification.verified
          ? {
              warning: `Recuperación guardada como pendiente de verificar: no se localizó en el settlement #${effectivePayoutRef} un crédito identificable de la orden #${existingOrd.platform_order_id} por $${effectiveReimbAmt.toFixed(2)} (${recoveryVerification.issue}).`,
            }
          : {}),
      })
    }

    if (action === 'resolve_review_order') {
      const { id, review_decision, review_notes, selected_toast_guid } = body
      if (!id || !review_decision) {
        return NextResponse.json({ success: false, error: 'Missing order id or review_decision' }, { status: 400 })
      }

      const allowedDecisions = new Set(['APPROVE_VARIANCE', 'CONFIRM_TOAST_MATCH', 'KEEP_BLOCKED'])
      if (!allowedDecisions.has(String(review_decision))) {
        return NextResponse.json({ success: false, error: 'Invalid review_decision' }, { status: 400 })
      }

      const trimmedNotes = String(review_notes || '').trim().slice(0, 1000)
      if (review_decision === 'APPROVE_VARIANCE' && trimmedNotes.length < 5) {
        return NextResponse.json(
          {
            success: false,
            error: 'Para aprobar una varianza se requiere un motivo obligatorio documentado (mínimo 5 caracteres).',
          },
          { status: 400 }
        )
      }

      const { data: existingOrd, error: fetchErr } = await supabaseAdmin
        .from('delivery_platform_orders')
        .select('*')
        .eq('id', id)
        .single()

      if (fetchErr || !existingOrd) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })
      }

      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'dispute_review',
        allowCron: false,
        targetStoreIds: [Number(existingOrd.store_id)],
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const nowIso = new Date().toISOString()
      const grossVar = round2(Number(existingOrd.gross_diff ?? existingOrd.gross_variance ?? 0))
      const evidenceStr = `Toast #${existingOrd.toast_display_number || 'N/A'} ($${Number(existingOrd.toast_expected_gross || 0).toFixed(2)}) vs ${existingOrd.platform} #${existingOrd.platform_order_id} ($${Number(existingOrd.platform_gross_receivable || 0).toFixed(2)})`

      const updatedRaw: Record<string, any> = {
        ...(existingOrd.raw_payload || {}),
        explicit_review_decision: review_decision,
        explicit_review_notes: trimmedNotes,
        explicit_reviewed_by_id: auth.user?.id || null,
        explicit_reviewed_by: auth.user?.email || 'staff',
        explicit_reviewed_by_role: auth.user?.role || null,
        explicit_reviewed_at: nowIso,
      }

      if (review_decision === 'APPROVE_VARIANCE') {
        updatedRaw.variance_approval = {
          approved: true,
          approved_by_user_id: auth.user?.id || null,
          approved_by_email: auth.user?.email || 'staff',
          approved_by_role: auth.user?.role || null,
          approved_at: nowIso,
          reason: trimmedNotes,
          approved_amount: grossVar,
          payout_reference_id: existingOrd.payout_reference_id || null,
          evidence: evidenceStr,
        }
      } else if (review_decision === 'KEEP_BLOCKED') {
        updatedRaw.variance_approval = null
      }

      const updateFields: Record<string, any> = {
        raw_payload: updatedRaw,
        updated_at: nowIso,
      }

      if (review_decision === 'CONFIRM_TOAST_MATCH' && selected_toast_guid) {
        const candidates =
          Array.isArray(existingOrd.raw_payload?.ambiguous_toast_candidates) &&
          existingOrd.raw_payload.ambiguous_toast_candidates.length > 0
            ? existingOrd.raw_payload.ambiguous_toast_candidates
            : existingOrd.raw_payload?.suggested_toast_candidate
              ? [existingOrd.raw_payload.suggested_toast_candidate]
              : []
        const chosen = candidates.find(
          (c: any) => (c.toastOrderGuid || c.toastGuid) === selected_toast_guid
        )
        if (chosen) {
          const plat = existingOrd.platform as DeliveryPlatformCode
          const expectedGross =
            plat === 'UBER_EATS'
              ? round2(Number(chosen.netSales || 0))
              : round2(Number(chosen.netSales || 0) + Number(chosen.taxAmount || 0))
          const pGross = Number(existingOrd.platform_gross_receivable || 0)
          const newGrossVar = round2(pGross - expectedGross)
          updateFields.toast_order_guid = chosen.toastOrderGuid || chosen.toastGuid
          updateFields.toast_display_number = chosen.toastDisplayNumber || chosen.displayNumber
          updateFields.toast_net_sales = round2(Number(chosen.netSales || 0))
          updateFields.toast_tax = round2(Number(chosen.taxAmount || 0))
          updateFields.toast_expected_gross = expectedGross
          updateFields.subtotal_diff = round2(Number(existingOrd.platform_subtotal || 0) - Number(chosen.netSales || 0))
          updateFields.gross_diff = newGrossVar
          updateFields.match_confidence = 'EXACT_ID'
          updateFields.reconciliation_status = Math.abs(newGrossVar) <= 0.05 ? 'MATCHED' : 'AMOUNT_MISMATCH'
          updatedRaw.ambiguous_toast_candidates = null
          updatedRaw.suggested_toast_candidate = null
        }
      }

      const { data, error } = await supabaseAdmin
        .from('delivery_platform_orders')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, order: data })
    }

    if (action === 'approve_payout_variance') {
      const payoutId = String(body.payout_id || '').trim()
      const reason = String(body.reason || body.review_notes || '').trim().slice(0, 1000)
      if (!payoutId) {
        return NextResponse.json({ success: false, error: 'Se requiere payout_id.' }, { status: 400 })
      }
      if (reason.length < 5) {
        return NextResponse.json(
          { success: false, error: 'Se requiere un motivo obligatorio documentado (mínimo 5 caracteres) para aprobar la varianza del corte.' },
          { status: 400 }
        )
      }

      const { data: payoutRow, error: payErr } = await supabaseAdmin
        .from('delivery_platform_payouts')
        .select('*')
        .eq('id', payoutId)
        .single()

      if (payErr || !payoutRow) {
        return NextResponse.json({ success: false, error: 'Payout no encontrado.' }, { status: 404 })
      }

      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'dispute_review',
        allowCron: false,
        targetStoreIds: [Number(payoutRow.store_id)],
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const nowIso = new Date().toISOString()
      const approvedAmount = round2(Number(payoutRow.gross_variance || 0))
      const evidence =
        String(body.evidence || '').trim() ||
        `Corte ${payoutRow.platform} #${payoutRow.payout_reference_id} | Bruto Plataforma: $${Number(payoutRow.platform_gross_receivable || 0).toFixed(2)} vs Esperado Toast: $${Number(payoutRow.toast_expected_gross || 0).toFixed(2)} (Dif: $${approvedAmount.toFixed(2)})`

      const updatedRaw = {
        ...(payoutRow.raw_payload || {}),
        variance_approval: {
          approved: true,
          approved_by_user_id: auth.user?.id || null,
          approved_by_email: auth.user?.email || 'staff',
          approved_by_role: auth.user?.role || null,
          approved_at: nowIso,
          reason,
          approved_amount: approvedAmount,
          payout_reference_id: payoutRow.payout_reference_id,
          evidence,
        },
      }

      const { data: updatedPayout, error: updErr } = await supabaseAdmin
        .from('delivery_platform_payouts')
        .update({
          raw_payload: updatedRaw,
          updated_at: nowIso,
        })
        .eq('id', payoutRow.id)
        .select()
        .single()

      if (updErr) throw new Error(updErr.message)
      return NextResponse.json({ success: true, payout: updatedPayout })
    }

    if (action === 'batch_resolve_review') {
      const rawOrderIds: string[] = Array.isArray(body.order_ids)
        ? body.order_ids.map((v: any) => String(v || '').trim()).filter(Boolean)
        : []
      const reviewDecision = String(body.review_decision || 'APPROVE_VARIANCE').trim()
      const reviewNotes = String(body.review_notes || '').trim().slice(0, 1000)

      const allowedDecisions = new Set(['APPROVE_VARIANCE', 'KEEP_BLOCKED'])
      if (rawOrderIds.length === 0 || !allowedDecisions.has(reviewDecision)) {
        return NextResponse.json(
          { success: false, error: 'Se requiere al menos un order_id válido y un review_decision permitido.' },
          { status: 400 }
        )
      }

      if (rawOrderIds.some((id) => id.startsWith('UNASSIGNED-'))) {
        return NextResponse.json(
          {
            success: false,
            error: 'Acción masiva rechazada: las órdenes con tienda desconocida (UNASSIGNED_STORE) están bloqueadas y no pueden entrar en aprobación de varianzas.',
          },
          { status: 400 }
        )
      }

      if (reviewDecision === 'APPROVE_VARIANCE' && reviewNotes.length < 5) {
        return NextResponse.json(
          {
            success: false,
            error: 'Para aprobar varianzas masivamente se requiere un motivo obligatorio documentado (mínimo 5 caracteres).',
          },
          { status: 400 }
        )
      }

      const { data: existingRows, error: fetchErr } = await supabaseAdmin
        .from('delivery_platform_orders')
        .select('*')
        .in('id', rawOrderIds)

      if (fetchErr) throw new Error(fetchErr.message)

      if (!existingRows || existingRows.length !== rawOrderIds.length) {
        return NextResponse.json(
          {
            success: false,
            error: `Acción masiva rechazada: se solicitaron ${rawOrderIds.length} órdenes pero solo se encontraron ${existingRows?.length || 0} en la base de datos.`,
          },
          { status: 400 }
        )
      }

      const involvedStoreIds = Array.from(new Set(existingRows.map((r: any) => Number(r.store_id))))
      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'dispute_review',
        allowCron: false,
        targetStoreIds: involvedStoreIds,
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      // P0-7: Validar que TODAS las órdenes pertenezcan exclusivamente a VARIANCE_INVESTIGATE
      const incompatibleOrders = existingRows.filter((row: any) => {
        const classified = classifyOrderActionGroupAndExplanation(row)
        return classified.action_group !== 'VARIANCE_INVESTIGATE'
      })
      if (incompatibleOrders.length > 0) {
        const badIds = incompatibleOrders.map((r: any) => `#${r.platform_order_id}`).join(', ')
        return NextResponse.json(
          {
            success: false,
            error: `Acción masiva rechazada: "Aprobar varianza" solo permite órdenes en estado "Diferencias por investigar" (VARIANCE_INVESTIGATE). Órdenes incompatibles: ${badIds}.`,
          },
          { status: 400 }
        )
      }

      let updatedCount = 0
      const nowIso = new Date().toISOString()
      const reviewer = auth.user?.email || 'staff'

      for (const row of existingRows) {
        const grossVar = round2(Number(row.gross_diff ?? row.gross_variance ?? 0))
        const evidenceStr = `Toast #${row.toast_display_number || 'N/A'} ($${Number(row.toast_expected_gross || 0).toFixed(2)}) vs ${row.platform} #${row.platform_order_id} ($${Number(row.platform_gross_receivable || 0).toFixed(2)})`
        const mergedRaw: Record<string, any> = {
          ...(row.raw_payload || {}),
          explicit_review_decision: reviewDecision,
          explicit_review_notes: reviewNotes,
          explicit_reviewed_by_id: auth.user?.id || null,
          explicit_reviewed_by: reviewer,
          explicit_reviewed_by_role: auth.user?.role || null,
          explicit_reviewed_at: nowIso,
        }
        if (reviewDecision === 'APPROVE_VARIANCE') {
          mergedRaw.variance_approval = {
            approved: true,
            approved_by_user_id: auth.user?.id || null,
            approved_by_email: reviewer,
            approved_by_role: auth.user?.role || null,
            approved_at: nowIso,
            reason: reviewNotes,
            approved_amount: grossVar,
            payout_reference_id: row.payout_reference_id || null,
            evidence: evidenceStr,
          }
        } else {
          mergedRaw.variance_approval = null
        }

        const { error: updErr } = await supabaseAdmin
          .from('delivery_platform_orders')
          .update({
            raw_payload: mergedRaw,
            updated_at: nowIso,
          })
          .eq('id', row.id)
        if (!updErr) updatedCount++
      }

      return NextResponse.json({
        success: true,
        updatedCount,
      })
    }

    if (action === 'batch_update_disputes') {
      const rawOrderIds: string[] = Array.isArray(body.order_ids)
        ? body.order_ids.map((v: any) => String(v || '').trim()).filter(Boolean)
        : []
      const normalizedStatus = String(body.dispute_status || 'SUBMITTED').toUpperCase()
      const disputeNotes = body.dispute_notes !== undefined ? String(body.dispute_notes || '').slice(0, 1000) : undefined

      if (rawOrderIds.length === 0 || !VALID_DISPUTE_STATUSES.has(normalizedStatus)) {
        return NextResponse.json(
          { success: false, error: 'Se requiere al menos un order_id válido y un dispute_status permitido.' },
          { status: 400 }
        )
      }

      if (normalizedStatus === 'REIMBURSED') {
        return NextResponse.json(
          {
            success: false,
            error: 'El estado REIMBURSED requiere verificar individualmente el payout de recuperación, monto, fecha de depósito y evidencia por cada orden.',
          },
          { status: 400 }
        )
      }

      if (rawOrderIds.some((id) => id.startsWith('UNASSIGNED-'))) {
        return NextResponse.json(
          {
            success: false,
            error: 'Acción masiva rechazada: las órdenes con tienda desconocida (UNASSIGNED_STORE) están bloqueadas.',
          },
          { status: 400 }
        )
      }

      const { data: existingRows, error: fetchErr } = await supabaseAdmin
        .from('delivery_platform_orders')
        .select('*')
        .in('id', rawOrderIds)

      if (fetchErr) throw new Error(fetchErr.message)

      if (!existingRows || existingRows.length !== rawOrderIds.length) {
        return NextResponse.json(
          {
            success: false,
            error: `Acción masiva rechazada: se solicitaron ${rawOrderIds.length} órdenes pero solo se encontraron ${existingRows?.length || 0} en la base de datos.`,
          },
          { status: 400 }
        )
      }

      const involvedStoreIds = Array.from(new Set(existingRows.map((r: any) => Number(r.store_id))))
      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'dispute_review',
        allowCron: false,
        targetStoreIds: involvedStoreIds,
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      // P0-7: Validar que TODAS las órdenes pertenezcan exclusivamente a DISPUTE_RECOVERY
      const incompatibleOrders = existingRows.filter((row: any) => {
        const classified = classifyOrderActionGroupAndExplanation(row)
        return (
          classified.action_group !== 'DISPUTE_RECOVERY' ||
          classified.status_code === 'DISPUTE_RECOVERED' ||
          classified.status_code === 'DISPUTE_CLOSED_UNRECOVERED'
        )
      })
      if (incompatibleOrders.length > 0) {
        const badIds = incompatibleOrders.map((r: any) => `#${r.platform_order_id}`).join(', ')
        return NextResponse.json(
          {
            success: false,
            error: `Acción masiva rechazada: "Marcar disputa presentada" solo permite órdenes en estado "Disputas / recuperaciones" (DISPUTE_RECOVERY). Órdenes incompatibles: ${badIds}.`,
          },
          { status: 400 }
        )
      }

      let updatedCount = 0
      const nowIso = new Date().toISOString()
      const reviewer = auth.user?.email || 'staff'
      const isDisputed = normalizedStatus !== 'NONE'

      for (const row of existingRows) {
        const mergedRaw = {
          ...(row.raw_payload || {}),
          last_dispute_updated_by_id: auth.user?.id || null,
          last_dispute_updated_by: reviewer,
          last_dispute_updated_by_role: auth.user?.role || null,
          last_dispute_updated_at: nowIso,
        }
        const { error: updErr } = await supabaseAdmin
          .from('delivery_platform_orders')
          .update({
            is_disputed: isDisputed,
            dispute_status: normalizedStatus,
            dispute_notes: disputeNotes !== undefined && disputeNotes.trim() ? disputeNotes : row.dispute_notes,
            raw_payload: mergedRaw,
            updated_at: nowIso,
          })
          .eq('id', row.id)
        if (!updErr) updatedCount++
      }

      return NextResponse.json({
        success: true,
        updatedCount,
      })
    }

    if (action === 'assign_unassigned_store') {
      const targetStoreId = Number(body.target_store_id)
      const platform = String(body.platform || '')
      const referenceId = String(body.reference_id || '').trim()
      const confirmStoreAssignment = body.confirm_store_assignment === true
      if (!Number.isFinite(targetStoreId) || targetStoreId <= 0 || !VALID_PLATFORMS.has(platform) || !referenceId) {
        return NextResponse.json(
          { success: false, error: 'Se requiere target_store_id válido (> 0), platform y reference_id.' },
          { status: 400 }
        )
      }
      if (!confirmStoreAssignment) {
        return NextResponse.json(
          {
            success: false,
            error: 'Se requiere confirmación explícita (confirm_store_assignment = true) para asignar una tienda a un registro UNASSIGNED_STORE.',
          },
          { status: 400 }
        )
      }

      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'manage_mappings',
        allowCron: false,
        targetStoreIds: [targetStoreId],
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const nowIso = new Date().toISOString()
      const auditMeta = {
        assigned_to_store_id: targetStoreId,
        assigned_by_user_id: auth.user?.id || null,
        assigned_by_email: auth.user?.email || 'staff',
        assigned_by_role: auth.user?.role || null,
        assigned_at: nowIso,
        reference_id: referenceId,
        platform,
      }

      const quarantined = await getQuarantinedUnassignedRecords()
      const matchedOrders: any[] = quarantined.orders
        .filter((o: any) => o.platform === platform && (o.platformOrderId === referenceId || o.payoutReferenceId === referenceId))
        .map((o: any) => ({
          ...o,
          storeId: targetStoreId,
          rawPayload: {
            ...(o.rawPayload || {}),
            unassigned_store: false,
            unassigned_store_resolution_audit: auditMeta,
          },
        }))
      const matchedPayouts: any[] = quarantined.payouts
        .filter((p: any) => p.platform === platform && p.payout_reference_id === referenceId)
        .map((p: any) => ({
          ...p,
          store_id: targetStoreId,
          raw_payload: {
            ...(p.raw_payload || {}),
            unassigned_store: false,
            unassigned_store_resolution_audit: auditMeta,
          },
        }))

      if (matchedOrders.length === 0 && matchedPayouts.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No se encontró el registro en cuarentena UNASSIGNED_STORE.' },
          { status: 404 }
        )
      }

      const remainingOrders = quarantined.orders.filter(
        (o: any) => !(o.platform === platform && (o.platformOrderId === referenceId || o.payoutReferenceId === referenceId))
      )
      const remainingPayouts = quarantined.payouts.filter(
        (p: any) => !(p.platform === platform && p.payout_reference_id === referenceId)
      )

      const dates = matchedOrders.map((o: any) => String(o.businessDate || '')).filter(Boolean)
      const minDate = dates.length > 0 ? dates.sort()[0] : new Date().toISOString().slice(0, 10)
      const maxDate = dates.length > 0 ? dates.sort()[dates.length - 1] : minDate

      const result = await reconcileAndPersistDeliveryData({
        storeIds: [targetStoreId],
        startDate: minDate,
        endDate: maxDate,
        syncToast: false,
        syncGrubhubLive: false,
        importedPlatformOrders: matchedOrders,
        importedPayouts: matchedPayouts,
      })

      await supabaseAdmin
        .from('integrations')
        .update({
          access_token: JSON.stringify({
            updatedAt: nowIso,
            orders: remainingOrders,
            payouts: remainingPayouts,
          }),
          updated_at: nowIso,
        })
        .eq('service_name', 'delivery_unassigned_quarantine')

      return NextResponse.json({
        success: true,
        assignedStoreId: targetStoreId,
        audit: auditMeta,
        ...result,
      })
    }

    if (action === 'update_mapping') {
      const storeId = Number(body.store_id)
      const updates = body.updates
      if (!Number.isFinite(storeId) || storeId <= 0 || !updates || typeof updates !== 'object') {
        return NextResponse.json({ success: false, error: 'Missing valid store_id or updates' }, { status: 400 })
      }

      const auth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'manage_mappings',
        allowCron: false,
        targetStoreIds: [storeId],
      })
      if (!auth.authorized) {
        return NextResponse.json({ success: false, error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const sanitizedUpdates: Record<string, any> = {}
      for (const [key, val] of Object.entries(updates)) {
        if (ALLOWED_MAPPING_COLUMNS.has(key)) {
          sanitizedUpdates[key] = typeof val === 'string' ? val.trim() : val
        }
      }

      if (Object.keys(sanitizedUpdates).length === 0) {
        return NextResponse.json({ success: false, error: 'No permitted mapping fields provided' }, { status: 400 })
      }

      const { data, error } = await supabaseAdmin
        .from('delivery_platform_store_mappings')
        .update({
          ...sanitizedUpdates,
          updated_at: new Date().toISOString(),
        })
        .eq('store_id', storeId)
        .select()
        .single()

      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, mapping: data })
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error('[POST /api/delivery-reconciliation] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
