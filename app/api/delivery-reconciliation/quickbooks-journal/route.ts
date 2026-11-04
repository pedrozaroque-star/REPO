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
  evaluateDisputeRecovery,
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

export type HistoricalQboMatchClassification =
  | 'FIRM_ID_OR_REF'
  | 'FIRM_ACCOUNTING_MATCH'
  | 'USER_CONFIRMED'
  | 'HISTORICAL_CANDIDATE_PENDING_REVIEW'
  | 'AMBIGUOUS_CANDIDATES'
  | 'CONFLICT_DUPLICATE_JE'
  | 'DISCARDED_BY_USER'
  | 'NONE'

export interface HistoricalQboCandidateSummary {
  id: string
  docNumber: string
  txnDate: string
  privateNote: string
  bankDebitAmount: number
  receivableCreditAmount: number
  matchBasis: 'IDEMPOTENCY_OR_REF' | 'SAVED_QB_ID' | 'ACCOUNTING_CRITERIA'
}

export interface HistoricalQboEvaluationResult {
  classification: HistoricalQboMatchClassification
  matchedJe: any | null
  candidates: HistoricalQboCandidateSummary[]
  conflictWithPayoutId?: string | null
}

/**
 * Evalúa coincidencias con pólizas históricas de QuickBooks Online:
 * 1. Prioriza ID QBO persistido (`qb_journal_entry_id`) y referencia oficial (`idempotencyKey` o `#payout_reference_id`).
 * 2. Cuando no existen, comprueba sucursal (`DepartmentRef`), cuenta CxC de plataforma (`12050`/`12053`/`12054`) en sentido `Credit`,
 *    cuenta bancaria de la sucursal (`100XX`) en sentido `Debit`, importe exacto (±$0.05) y fecha compatible ([-14d, +25d]).
 * 3. No vincula automáticamente si hay ambigüedad (>1 candidato) ni cuando la póliza no tiene referencia oficial y aún no ha sido confirmada.
 * 4. Impide que una misma póliza se asigne a payouts diferentes (`alreadyAssignedJeIds`), salvo agrupación explícitamente aprobada (`qbo_shared_je_approved`).
 */
export function evaluateHistoricalQboJournalMatch(params: {
  payout: any
  storeLocationId: string
  bankAccountQbId?: string
  receivableQbId: string
  expectedReceivableAmount?: number
  qbJournalEntries: any[]
  alreadyAssignedJeIds?: Map<string, string>
  autoLinkAccountingSingleCandidate?: boolean
}): HistoricalQboEvaluationResult {
  const {
    payout,
    storeLocationId,
    bankAccountQbId,
    receivableQbId,
    expectedReceivableAmount,
    qbJournalEntries,
    alreadyAssignedJeIds,
    autoLinkAccountingSingleCandidate = false,
  } = params

  const discardedList: any[] = Array.isArray(payout?.raw_payload?.qbo_discarded_candidates)
    ? payout.raw_payload.qbo_discarded_candidates
    : []
  const discardedIds = new Set<string>(
    discardedList.map((d: any) => String(d?.je_id ?? d ?? '').trim()).filter(Boolean)
  )

  const payoutIdStr = String(payout?.id || '').trim()
  const savedQbId = String(payout?.raw_payload?.qb_journal_entry_id || '').trim()
  const sharedJeApproved = payout?.raw_payload?.qbo_shared_je_approved === true
  const netPayoutSigned = round2(Number(payout?.net_payout_amount || 0))
  const netPayoutAbs = round2(Math.abs(netPayoutSigned))
  const expectedBankPostingType = netPayoutSigned >= 0 ? 'Debit' : 'Credit'
  const expectedRecPostingType = (expectedReceivableAmount ?? 1) >= 0 ? 'Credit' : 'Debit'

  const extractCandidateSummary = (
    je: any,
    matchBasis: HistoricalQboCandidateSummary['matchBasis']
  ): HistoricalQboCandidateSummary => {
    const lines: any[] = Array.isArray(je?.Line) ? je.Line : []
    const bankLine = lines.find(
      (l) => String(l?.JournalEntryLineDetail?.AccountRef?.value || '') === String(bankAccountQbId || '')
    )
    const recLine = lines.find(
      (l) => String(l?.JournalEntryLineDetail?.AccountRef?.value || '') === String(receivableQbId || '')
    )
    return {
      id: String(je.Id),
      docNumber: String(je.DocNumber || ''),
      txnDate: String(je.TxnDate || ''),
      privateNote: String(je.PrivateNote || ''),
      bankDebitAmount: round2(Number(bankLine?.Amount || netPayoutAbs)),
      receivableCreditAmount: round2(Number(recLine?.Amount || expectedReceivableAmount || 0)),
      matchBasis,
    }
  }

  // Verificar conflicto de duplicidad en ID guardado
  if (savedQbId && !discardedIds.has(savedQbId)) {
    const ownerPayoutId = alreadyAssignedJeIds?.get(savedQbId)
    if (ownerPayoutId && payoutIdStr && ownerPayoutId !== payoutIdStr && !sharedJeApproved) {
      const conflictJe = Array.isArray(qbJournalEntries)
        ? qbJournalEntries.find((je) => String(je.Id) === savedQbId)
        : null
      return {
        classification: 'CONFLICT_DUPLICATE_JE',
        matchedJe: null,
        candidates: conflictJe
          ? [extractCandidateSummary(conflictJe, 'SAVED_QB_ID')]
          : [
              {
                id: savedQbId,
                docNumber: String(payout?.raw_payload?.qb_doc_number || ''),
                txnDate: String(payout?.raw_payload?.qb_txn_date || ''),
                privateNote: '',
                bankDebitAmount: netPayoutAbs,
                receivableCreditAmount: round2(Number(expectedReceivableAmount || 0)),
                matchBasis: 'SAVED_QB_ID',
              },
            ],
        conflictWithPayoutId: ownerPayoutId,
      }
    }

    const byId = Array.isArray(qbJournalEntries)
      ? qbJournalEntries.find((je) => String(je.Id) === savedQbId)
      : null
    if (byId) {
      const pNote = String(byId.PrivateNote || '')
      const payoutRef = String(payout?.payout_reference_id || '').trim()
      const idempKey = payoutRef
        ? buildPayoutIdempotencyKey(payout.platform, Number(payout.store_id), payoutRef)
        : ''
      const hasExplicitRef =
        (idempKey && pNote.includes(idempKey)) || (payoutRef.length >= 4 && pNote.includes(`#${payoutRef}`))
      const isUserConfirmed = Boolean(payout?.raw_payload?.qbo_candidate_confirmation?.confirmed)
      return {
        classification: isUserConfirmed
          ? 'USER_CONFIRMED'
          : hasExplicitRef
          ? 'FIRM_ID_OR_REF'
          : 'FIRM_ACCOUNTING_MATCH',
        matchedJe: byId,
        candidates: [extractCandidateSummary(byId, hasExplicitRef ? 'IDEMPOTENCY_OR_REF' : 'SAVED_QB_ID')],
      }
    }
  }

  if (!Array.isArray(qbJournalEntries) || qbJournalEntries.length === 0) {
    return {
      classification: discardedIds.size > 0 ? 'DISCARDED_BY_USER' : 'NONE',
      matchedJe: null,
      candidates: [],
    }
  }

  const payoutRef = String(payout?.payout_reference_id || '').trim()
  const idempotencyKey = payoutRef
    ? buildPayoutIdempotencyKey(payout.platform, Number(payout.store_id), payoutRef)
    : ''
  const refDateStr = String(payout?.period_end || payout?.payout_date || payout?.period_start || '').slice(0, 10)
  const refDateMs = refDateStr ? new Date(`${refDateStr}T12:00:00Z`).getTime() : NaN

  const explicitRefMatches: any[] = []
  const accountingMatches: any[] = []

  for (const je of qbJournalEntries) {
    const jeId = String(je?.Id || '').trim()
    if (!jeId || discardedIds.has(jeId)) continue

    const privateNote = String(je.PrivateNote || '')
    const lines: any[] = Array.isArray(je.Line) ? je.Line : []

    // 1. Match por llave de idempotencia exacta en PrivateNote
    if (idempotencyKey && privateNote.includes(idempotencyKey)) {
      explicitRefMatches.push(je)
      continue
    }

    // Verificar sucursal (DepartmentRef), cuenta CxC de plataforma (12050/12053/12054) y sentido Credit/Debit
    const hasExactStoreAndPlatformRec = lines.some(
      (l) =>
        String(l?.JournalEntryLineDetail?.DepartmentRef?.value) === String(storeLocationId) &&
        String(l?.JournalEntryLineDetail?.AccountRef?.value) === String(receivableQbId) &&
        (!l?.JournalEntryLineDetail?.PostingType ||
          String(l?.JournalEntryLineDetail?.PostingType) === expectedRecPostingType)
    )
    if (!hasExactStoreAndPlatformRec) continue

    // 2. Match por referencia oficial exacta del payout en PrivateNote (ej. "#U6KV2P7BG77XLAW")
    if (payoutRef.length >= 4 && privateNote.includes(`#${payoutRef}`)) {
      explicitRefMatches.push(je)
      continue
    }

    // 3. Match contable por sucursal + CxC (Credit) + Banco (Debit) + importe + fecha compatible
    if (bankAccountQbId && netPayoutAbs > 0) {
      const jeDateStr = String(je.TxnDate || '').slice(0, 10)
      const jeDateMs = jeDateStr ? new Date(`${jeDateStr}T12:00:00Z`).getTime() : NaN
      const withinDateWindow =
        Number.isNaN(refDateMs) ||
        Number.isNaN(jeDateMs) ||
        (jeDateMs >= refDateMs - 14 * 86400000 && jeDateMs <= refDateMs + 25 * 86400000)

      if (withinDateWindow) {
        const hasExactBankLine = lines.some(
          (l) =>
            String(l?.JournalEntryLineDetail?.AccountRef?.value) === String(bankAccountQbId) &&
            String(l?.JournalEntryLineDetail?.DepartmentRef?.value) === String(storeLocationId) &&
            (!l?.JournalEntryLineDetail?.PostingType ||
              String(l?.JournalEntryLineDetail?.PostingType) === expectedBankPostingType) &&
            Math.abs(round2(Number(l?.Amount || 0)) - netPayoutAbs) <= 0.05
        )
        const hasExactReceivableLine =
          expectedReceivableAmount && expectedReceivableAmount > 0
            ? lines.some(
                (l) =>
                  String(l?.JournalEntryLineDetail?.AccountRef?.value) === String(receivableQbId) &&
                  String(l?.JournalEntryLineDetail?.DepartmentRef?.value) === String(storeLocationId) &&
                  (!l?.JournalEntryLineDetail?.PostingType ||
                    String(l?.JournalEntryLineDetail?.PostingType) === expectedRecPostingType) &&
                  Math.abs(round2(Number(l?.Amount || 0)) - round2(expectedReceivableAmount)) <= 0.05
              )
            : false
        const hasFeeLine = lines.some((l) =>
          ['353', '375', '374'].includes(String(l?.JournalEntryLineDetail?.AccountRef?.value || ''))
        )

        if (hasExactBankLine || (hasExactReceivableLine && hasFeeLine)) {
          accountingMatches.push(je)
        }
      }
    }
  }

  // Evaluar coincidencias explícitas por referencia oficial / llave de idempotencia
  if (explicitRefMatches.length === 1) {
    const je = explicitRefMatches[0]
    const jeId = String(je.Id)
    const ownerPayoutId = alreadyAssignedJeIds?.get(jeId)
    if (ownerPayoutId && payoutIdStr && ownerPayoutId !== payoutIdStr && !sharedJeApproved) {
      return {
        classification: 'CONFLICT_DUPLICATE_JE',
        matchedJe: null,
        candidates: [extractCandidateSummary(je, 'IDEMPOTENCY_OR_REF')],
        conflictWithPayoutId: ownerPayoutId,
      }
    }
    return {
      classification: 'FIRM_ID_OR_REF',
      matchedJe: je,
      candidates: [extractCandidateSummary(je, 'IDEMPOTENCY_OR_REF')],
    }
  }

  if (explicitRefMatches.length > 1) {
    return {
      classification: 'AMBIGUOUS_CANDIDATES',
      matchedJe: null,
      candidates: explicitRefMatches.map((je) => extractCandidateSummary(je, 'IDEMPOTENCY_OR_REF')),
    }
  }

  // Evaluar candidatos contables históricos cuando no existe ID QBO ni referencia oficial en PrivateNote
  if (accountingMatches.length > 1) {
    return {
      classification: 'AMBIGUOUS_CANDIDATES',
      matchedJe: null,
      candidates: accountingMatches.map((je) => extractCandidateSummary(je, 'ACCOUNTING_CRITERIA')),
    }
  }

  if (accountingMatches.length === 1) {
    const je = accountingMatches[0]
    const jeId = String(je.Id)
    const ownerPayoutId = alreadyAssignedJeIds?.get(jeId)
    if (ownerPayoutId && payoutIdStr && ownerPayoutId !== payoutIdStr && !sharedJeApproved) {
      return {
        classification: 'CONFLICT_DUPLICATE_JE',
        matchedJe: null,
        candidates: [extractCandidateSummary(je, 'ACCOUNTING_CRITERIA')],
        conflictWithPayoutId: ownerPayoutId,
      }
    }
    if (autoLinkAccountingSingleCandidate) {
      return {
        classification: 'FIRM_ACCOUNTING_MATCH',
        matchedJe: je,
        candidates: [extractCandidateSummary(je, 'ACCOUNTING_CRITERIA')],
      }
    }
    return {
      classification: 'HISTORICAL_CANDIDATE_PENDING_REVIEW',
      matchedJe: null,
      candidates: [extractCandidateSummary(je, 'ACCOUNTING_CRITERIA')],
    }
  }

  return {
    classification: discardedIds.size > 0 ? 'DISCARDED_BY_USER' : 'NONE',
    matchedJe: null,
    candidates: [],
  }
}

export function matchExistingJournalEntryStrict(params: {
  payout: any
  storeLocationId: string
  bankAccountQbId?: string
  receivableQbId: string
  expectedReceivableAmount?: number
  qbJournalEntries: any[]
  alreadyAssignedJeIds?: Map<string, string>
}): any | null {
  const res = evaluateHistoricalQboJournalMatch({
    ...params,
    autoLinkAccountingSingleCandidate: true,
  })
  return res.matchedJe
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
  cause_es?: string
  cause_en?: string
  next_action_es?: string
  next_action_en?: string
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
 * 1. El payout sigue pendiente (`status` en `PENDING`, `POSTED`, `RECONCILED`, `REQUIRES_REVIEW`);
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
  userId?: string | number | null
  userRole?: string | null
  allowRecoveryRetry?: boolean
}): Promise<{
  acquired: boolean
  affectedRows: number
  lockedRow?: Record<string, any>
  reason?: string
}> {
  const {
    payoutId,
    currentRawPayload,
    idempotencyKey,
    userEmail,
    userId,
    userRole,
    allowRecoveryRetry = false,
  } = params
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

  if (curStatus === 'RECOVERY_REQUIRED' && !allowRecoveryRetry) {
    return {
      acquired: false,
      affectedRows: 0,
      reason:
        'El corte está en estado RECOVERY_REQUIRED. Debe verificarse en QuickBooks antes de reintentar la publicación.',
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
  } else if (
    curStatus === 'PENDING' ||
    curStatus === 'FAILED' ||
    (curStatus === 'RECOVERY_REQUIRED' && allowRecoveryRetry)
  ) {
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
  const rawPlat = String(payout?.platform || '').trim().toUpperCase()
  const isSupportedPlatform = ['UBER_EATS', 'DOORDASH', 'GRUBHUB'].includes(rawPlat)
  const plat = (isSupportedPlatform ? rawPlat : 'UBER_EATS') as DeliveryPlatformCode
  const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
  const storeRefs = getQBStoreRefs(storeName)
  const payoutRef = String(payout?.payout_reference_id || '').trim()
  const storeIdNum = Number(payout?.store_id || 0)
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

  const rawNumericFields = [
    payout?.net_payout_amount,
    payout?.commission_fees,
    payout?.delivery_fees,
    payout?.processing_fees,
    payout?.marketing_fees,
    payout?.error_charges,
    payout?.adjustments_amount,
    payout?.platform_gross_receivable,
    payout?.subtotal_sales,
  ]
  const hasInvalidNumericValue = rawNumericFields.some(
    (v) => v !== null && v !== undefined && !Number.isFinite(Number(v))
  )

  const hasNetPayoutField =
    payout?.net_payout_amount !== null &&
    payout?.net_payout_amount !== undefined &&
    String(payout?.net_payout_amount).trim() !== '' &&
    Number.isFinite(Number(payout.net_payout_amount))

  const netPayout = hasNetPayoutField ? round2(Number(payout.net_payout_amount)) : 0

  let totalFees = round2(
    Math.abs(
      Number(payout?.commission_fees || 0) +
        Number(payout?.delivery_fees || 0) +
        Number(payout?.processing_fees || 0) +
        Number(payout?.marketing_fees || 0)
    )
  )
  if (plat === 'UBER_EATS' && payout?.raw_payload?.uberFees !== undefined) {
    const uFees = Math.abs(parseRawMoney(payout.raw_payload.uberFees) ?? 0)
    const uMkt = Math.abs(parseRawMoney(payout.raw_payload.marketing) ?? 0)
    if (uFees + uMkt > 0) {
      totalFees = round2(uFees + uMkt)
    }
  }

  const grossEarnings = plat === 'UBER_EATS' ? parseRawMoney(payout?.raw_payload?.earnings) : null
  const facTax = Number(payout?.tax_remitted_by_platform || 0)
  const declaredGrossVal = round2(Number(payout?.platform_gross_receivable || 0))
  const declaredSubVal = round2(Number(payout?.subtotal_sales || 0))
  const declaredTipsVal = round2(Number(payout?.tips_amount || 0))
  const hasOfficialGrossOrEarnings =
    (grossEarnings !== null && grossEarnings > 0) ||
    declaredGrossVal > 0.005 ||
    declaredSubVal > 0.005

  let receivableCredit = 0
  let rawErrAdj = round2(Number(payout?.error_charges || 0) + Number(payout?.adjustments_amount || 0))

  if (payout?.raw_payload?.official_receivable_credit !== undefined) {
    // Cuando se proporciona un crédito CxC explícito, jamás inventar línea de compensación (plug)
    receivableCredit = round2(Number(payout.raw_payload.official_receivable_credit || 0))
  } else if (plat === 'UBER_EATS') {
    if (grossEarnings !== null && grossEarnings > 0 && facTax > 0) {
      receivableCredit = round2(grossEarnings - facTax)
      rawErrAdj = round2(netPayout + totalFees - receivableCredit)
    } else if (hasOfficialGrossOrEarnings) {
      // Sin `earnings` en raw_payload, usar el importe oficial de CxC sin inventar plug
      receivableCredit = round2((declaredGrossVal > 0 ? declaredGrossVal : declaredSubVal) + declaredTipsVal)
    } else {
      receivableCredit = 0
    }
  } else if (plat === 'GRUBHUB') {
    if (payout?.raw_payload?.totals !== undefined && hasOfficialGrossOrEarnings) {
      receivableCredit = round2(netPayout + totalFees - rawErrAdj)
    } else if (hasOfficialGrossOrEarnings) {
      receivableCredit = round2((declaredGrossVal > 0 ? declaredGrossVal : declaredSubVal) + declaredTipsVal)
    } else {
      receivableCredit = 0
    }
  } else {
    // DOORDASH
    if (hasOfficialGrossOrEarnings) {
      const expectedFromComponents = round2(netPayout + totalFees - rawErrAdj)
      const officialGrossWithTips = round2(
        (declaredGrossVal > 0 ? declaredGrossVal : declaredSubVal + Number(payout?.tax_paid_to_merchant || 0)) +
          declaredTipsVal
      )
      // Si el bruto oficial coincide con los componentes (±$0.05), usar el valor oficial; si difiere, conservar el bruto oficial para que el desbalance se detecte sin inventar líneas
      receivableCredit =
        Math.abs(officialGrossWithTips - expectedFromComponents) <= 0.05
          ? expectedFromComponents
          : officialGrossWithTips
    } else {
      receivableCredit = 0
    }
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

  // Regla Fiscal de Reembolsos (Sección 2):
  // Los ajustes fiscales por reembolsos requieren evidencia del impuesto efectivamente involucrado.
  // Prohibido revertir automáticamente el tax completo de una orden cuando el reembolso sea parcial.
  let deductedOrdersRealTax = 0
  let hasPartialRefundWithoutExplicitTax = false

  if (plat !== 'UBER_EATS') {
    for (const o of deductedOrders) {
      const errChargeVal = Number(o.error_charge || 0)
      if (errChargeVal >= -0.01) continue
      const errAbs = round2(Math.abs(errChargeVal))
      const explicitOrderRefundTax = round2(Number(o.raw_payload?.refund_tax_actual || 0))
      const orderSub = round2(Number(o.platform_subtotal || o.toast_net_sales || 0))
      const orderTax = round2(
        Number(
          o.platform_tax_paid_to_merchant > 0 ? o.platform_tax_paid_to_merchant : o.toast_tax || 0
        )
      )
      const orderGross = round2(
        Number(o.platform_gross_receivable || o.toast_expected_gross || orderSub + orderTax)
      )

      if (explicitOrderRefundTax > 0) {
        deductedOrdersRealTax = round2(deductedOrdersRealTax + explicitOrderRefundTax)
      } else if (orderGross > 0 && orderTax > 0 && Math.abs(errAbs - orderGross) <= 0.05) {
        // Reembolso total del importe bruto (Subtotal + Tax): el impuesto completo de la orden sí está involucrado
        deductedOrdersRealTax = round2(deductedOrdersRealTax + orderTax)
      } else {
        // Reembolso parcial (o solo de subtotal sin tax): prohibido revertir el tax completo de la orden sin evidencia explícita
        hasPartialRefundWithoutExplicitTax = true
      }
    }
  }

  const explicitStatementRefundTax =
    plat === 'UBER_EATS' ? 0 : round2(Number(payout?.raw_payload?.refund_tax_actual || 0))

  const embeddedRefundTax =
    plat === 'UBER_EATS'
      ? 0
      : explicitStatementRefundTax > 0
      ? explicitStatementRefundTax
      : !hasPartialRefundWithoutExplicitTax && deductedOrdersRealTax > 0
      ? deductedOrdersRealTax
      : 0

  const pStartDot = fmtShortPeriodDot(payout?.period_start || payout?.payout_date)
  const pEndDot = fmtShortPeriodDot(payout?.period_end || payout?.payout_date)
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
  const isBalanced =
    !hasInvalidNumericValue &&
    totalDebits > 0 &&
    totalCredits > 0 &&
    Math.abs(totalDebits - totalCredits) < 0.005

  // Órdenes de Toast pendientes en la ventana de fechas (solo informativo para saber si faltan órdenes en plataforma)
  const pStart = payout?.period_start || payout?.payout_date || ''
  const pEnd = payout?.period_end || payout?.payout_date || ''
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
  }> = Array.isArray(payout?.raw_payload?.cross_payout_refunds)
    ? payout.raw_payload.cross_payout_refunds
    : []

  const unpaidToastSubtotal = round2(
    unpaidToastOrders.reduce((acc, o) => acc + Number(o.toast_net_sales || 0), 0)
  )
  const unpaidToastTax = round2(
    unpaidToastOrders.reduce((acc, o) => acc + Number(o.toast_tax || 0), 0)
  )

  const adjustmentsInCut = round2(Number(payout?.adjustments_amount || 0))
  const chargebacksInCut = round2(rawErrAdj - adjustmentsInCut)

  // Evaluar bloqueos contables reales de la póliza de 4 líneas (publishBlockers) vs alertas informativas de auditoría orden por orden (auditWarnings)
  const publishBlockers: PublishBlocker[] = []
  const auditWarnings: PublishBlocker[] = []

  if (storeIdNum <= 0 || !isSupportedPlatform || !storeRefs.locationId || !storeRefs.bankAccountQbId) {
    publishBlockers.push({
      code: 'MISSING_STORE_OR_MAPPING',
      message_es: 'Falta sucursal asignada, plataforma válida o mapeo contable (cuenta bancaria/ubicación) en QuickBooks.',
      message_en: 'Missing assigned store, valid platform, or QuickBooks accounting mapping (bank account/location).',
      cause_es: 'El corte no tiene una sucursal de Tacos Gavilan vinculada o carece de LocationRef/AccountRef en QuickBooks.',
      cause_en: 'Payout has no linked Tacos Gavilan store or lacks QuickBooks LocationRef/AccountRef.',
      next_action_es: 'Asignar la sucursal en configuración avanzada de mapeos antes de publicar.',
      next_action_en: 'Assign the store in advanced mapping settings before publishing.',
    })
  }

  if (!payoutRef || payoutRef === '--' || payoutRef.startsWith('SYNTH')) {
    publishBlockers.push({
      code: 'MISSING_PAYOUT_REFERENCE',
      message_es: 'Falta referencia oficial (payout_reference_id) del settlement de la plataforma.',
      message_en: 'Missing official platform settlement reference (payout_reference_id).',
      cause_es: 'No se permite registrar una Journal Entry sin el identificador oficial del corte de la plataforma.',
      cause_en: 'Posting a Journal Entry without the official platform settlement identifier is prohibited.',
      next_action_es: 'Sincronizar o importar el estado de cuenta oficial de la plataforma con su ID de pago.',
      next_action_en: 'Sync or import the official platform statement with its payout ID.',
    })
  }

  if (hasInvalidNumericValue) {
    publishBlockers.push({
      code: 'INVALID_SETTLEMENT_VALUES',
      message_es: 'El corte contiene valores numéricos inválidos (NaN o infinitos) en sus importes.',
      message_en: 'Payout contains invalid numeric values (NaN or non-finite) in its amounts.',
      cause_es: 'Uno o más importes del corte están corruptos o mal formateados.',
      cause_en: 'One or more settlement amounts are corrupted or malformed.',
      next_action_es: 'Volver a sincronizar o reimportar el reporte oficial del corte.',
      next_action_en: 'Re-sync or re-import the official settlement report.',
    })
  }

  if (
    !hasNetPayoutField ||
    !hasOfficialGrossOrEarnings ||
    payout?.raw_payload?.missing_official_amounts === true
  ) {
    publishBlockers.push({
      code: 'MISSING_OFFICIAL_SETTLEMENT_AMOUNTS',
      message_es: 'Faltan importes oficiales del settlement (venta bruta/CxC o depósito neto) necesarios para construir el asiento.',
      message_en: 'Missing official settlement amounts (gross receivable or net payout) required to build the Journal Entry.',
      cause_es: 'Prohibido inventar líneas de compensación o estimar importes faltantes para forzar el cuadre del asiento.',
      cause_en: 'Inventing compensating lines or estimating missing amounts to force balance is prohibited.',
      next_action_es: 'Importar o sincronizar el estado de cuenta oficial completo del settlement.',
      next_action_en: 'Import or sync the complete official settlement statement.',
    })
  }

  if (!isBalanced) {
    publishBlockers.push({
      code: 'UNBALANCED_JOURNAL',
      message_es: `La póliza no está cuadrada al centavo (Débitos: $${totalDebits.toFixed(2)} vs Créditos: $${totalCredits.toFixed(2)}).`,
      message_en: `Journal Entry is not balanced to the cent (Debits: $${totalDebits.toFixed(2)} vs Credits: $${totalCredits.toFixed(2)}).`,
      cause_es: 'Los importes oficiales de depósito neto, comisiones, reembolsos y CxC no cuadran entre sí.',
      cause_en: 'Official net payout, fees, refunds, and receivable amounts do not balance.',
      next_action_es: 'Verificar el desglose oficial del estado de cuenta de la plataforma sin inventar líneas de ajuste.',
      next_action_en: 'Verify the official platform statement breakdown without inventing adjustment lines.',
    })
  }

  if (
    splitTaxOnRefunds &&
    plat !== 'UBER_EATS' &&
    rawErrAdj < -0.01 &&
    embeddedRefundTax <= 0 &&
    !hasPartialRefundWithoutExplicitTax
  ) {
    auditWarnings.push({
      code: 'MISSING_REAL_REFUND_TAX_BREAKDOWN',
      message_es:
        'Alerta informativa: No hay evidencia del impuesto real involucrado en el reembolso; se registra el asiento oficial de 4 líneas sin fabricar reversión fiscal (24001) y se deja la investigación pendiente.',
      message_en:
        'Informative alert: No verified real tax found for the refund; the official 4-line Journal Entry is prepared without fabricating a Sales Tax (24001) reversal, leaving the investigation pending.',
      cause_es: 'Falta evidencia del impuesto real efectivamente involucrado en el reembolso.',
      cause_en: 'Missing evidence of the actual tax involved in the refund.',
      next_action_es:
        'Registrar el settlement oficial de 4 líneas sin reversión fiscal fabricada o aportar refund_tax_actual si se confirma el impuesto del reembolso.',
      next_action_en:
        'Post the official 4-line settlement without fabricated tax reversal or provide refund_tax_actual if the refunded tax is confirmed.',
    })
  }

  // Alertas informativas de auditoría orden por orden (NO bloquean la creación de la póliza semanal de 4 líneas)
  const declaredOrdersCount = Number(payout?.orders_count || 0)
  const declaredSubtotal = Math.abs(Number(payout?.subtotal_sales || 0))
  const declaredGross = Math.abs(Number(payout?.platform_gross_receivable || 0))
  if ((declaredOrdersCount > 0 || declaredSubtotal > 0.01 || declaredGross > 0.01) && settledOrdersInCut.length === 0) {
    auditWarnings.push({
      code: 'INCOMPLETE_ORDER_COVERAGE',
      message_es: `Alerta informativa: El corte declara ${declaredOrdersCount || 'múltiples'} orden(es), pero existen 0 órdenes vinculadas por payout_reference_id (#${payoutRef}).`,
      message_en: `Informative alert: Payout declares ${declaredOrdersCount || 'multiple'} order(s), but has 0 linked orders by payout_reference_id (#${payoutRef}).`,
      cause_es: 'El resumen semanal del settlement está disponible, pero aún no se ha sincronizado el detalle de órdenes individuales con este payout_reference_id.',
      cause_en: 'Weekly settlement summary is available, but individual order detail has not yet been linked to this payout_reference_id.',
      next_action_es: 'Puedes publicar la póliza con los importes oficiales del corte e investigar/sincronizar el detalle de órdenes por separado.',
      next_action_en: 'You may publish the Journal Entry using official settlement amounts and sync/investigate order details separately.',
    })
  }

  const effectiveSyncStatus = platformSyncStatus || payout?.raw_payload?.sync_status
  if (effectiveSyncStatus === 'PARTIAL' || effectiveSyncStatus === 'FAILED') {
    auditWarnings.push({
      code: 'PLATFORM_SYNC_INCOMPLETE',
      message_es: `Alerta informativa (${effectiveSyncStatus}): ${platformSyncCause || payout?.raw_payload?.sync_cause || 'La sincronización de órdenes de esta plataforma/sucursal está parcial o pendiente.'}`,
      message_en: `Informative alert (${effectiveSyncStatus}): ${platformSyncCause || payout?.raw_payload?.sync_cause || 'Order synchronization for this platform/store is partial or pending.'}`,
      cause_es: 'La última sincronización de órdenes de la plataforma reportó cobertura parcial o error de conexión.',
      cause_en: 'The latest platform order sync reported partial coverage or connection error.',
      next_action_es: 'Revisar la pestaña de Cobertura por Sucursal/Plataforma o reintentar sincronización de órdenes.',
      next_action_en: 'Check the Store/Platform Coverage tab or retry order synchronization.',
    })
  }

  const hasMissingTaxFlag =
    Boolean(payout?.raw_payload?.missing_tax_breakdown) ||
    payout?.raw_payload?.tax_breakdown_verified === false ||
    settledOrdersInCut.some(
      (o) => Boolean(o.raw_payload?.missing_tax_breakdown) || o.raw_payload?.tax_breakdown_verified === false
    )

  const isDdOrGhMissingTax =
    (plat === 'DOORDASH' || plat === 'GRUBHUB') &&
    ((Number(payout?.subtotal_sales || 0) > 0 &&
      Number(payout?.tax_paid_to_merchant || 0) <= 0 &&
      Number(payout?.tax_collected || 0) <= 0 &&
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
      cause_es: 'Algunas órdenes carecen de desglose fiscal individual, aunque los importes contables oficiales del settlement están completos.',
      cause_en: 'Some orders lack individual tax breakdown, although official settlement accounting amounts are complete.',
      next_action_es: 'Dejar la investigación fiscal por orden pendiente sin fabricar reversiones fiscales.',
      next_action_en: 'Keep order-level tax investigation pending without fabricating tax reversals.',
    })
  }

  if (hasPartialRefundWithoutExplicitTax && plat !== 'UBER_EATS') {
    auditWarnings.push({
      code: 'PARTIAL_REFUND_TAX_PENDING_INVESTIGATION',
      message_es: `Alerta informativa: Existen reembolsos parciales en ${plat} sin desglose explícito del impuesto involucrado; no se revierte automáticamente el Sales Tax completo de la orden.`,
      message_en: `Informative alert: Partial refunds exist in ${plat} without explicit refunded tax breakdown; full order Sales Tax is not automatically reversed.`,
      cause_es: 'El reembolso es menor al total bruto de la orden y no incluye evidencia del impuesto exacto reembolsado.',
      cause_en: 'Refund is smaller than the full order gross and lacks evidence of the exact refunded tax.',
      next_action_es: 'Registrar el settlement oficial sin reversión fiscal fabricada e investigar el detalle del reembolso si se requiere ajuste de Sales Tax (24001).',
      next_action_en: 'Post the official settlement without fabricated tax reversal and investigate the refund detail if a Sales Tax (24001) adjustment is needed.',
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
      cause_es: 'Existen órdenes en el corte cuyo vínculo con Toast POS requiere confirmación manual.',
      cause_en: 'Orders exist in this payout whose Toast POS link requires manual confirmation.',
      next_action_es: 'Usar el botón "Auditar Órdenes" para confirmar el ticket de Toast correspondiente.',
      next_action_en: 'Use the "Audit Orders" button to confirm the matching Toast check.',
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
  const payoutGrossVar = round2(Number(payout?.gross_variance || 0))
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
      cause_es: 'Diferencia entre lo esperado en Toast POS y lo reportado por la plataforma en una o más órdenes.',
      cause_en: 'Variance between Toast POS expected amounts and platform reported amounts on one or more orders.',
      next_action_es: 'Investigar las órdenes con diferencia en el paso de Auditoría de Órdenes (no impide registrar la póliza del corte oficial).',
      next_action_en: 'Investigate orders with variances in the Order Audit step (does not block posting the official settlement Journal Entry).',
    })
  }

  if (unpaidToastOrders.length > 0) {
    auditWarnings.push({
      code: 'UNMATCHED_TOAST_ORDERS',
      message_es: `Alerta informativa: ${unpaidToastOrders.length} orden(es) en Toast POS ($${unpaidToastSubtotal.toFixed(2)}) dentro del periodo aún no tienen match con la plataforma.`,
      message_en: `Informative alert: ${unpaidToastOrders.length} Toast POS order(s) ($${unpaidToastSubtotal.toFixed(2)}) in the period remain unmatched with the platform.`,
      cause_es: 'Tickets registrados en Toast POS como delivery de esta plataforma que no aparecen en este corte.',
      cause_en: 'Checks recorded in Toast POS for this delivery platform that do not appear in this settlement.',
      next_action_es: 'Verificar en Atención Requerida si fueron pagados en otro corte o anulados.',
      next_action_en: 'Check in Attention Required whether they were settled in another payout or voided.',
    })
  }

  const disputeEvaluations = deductedOrders.map((o) => evaluateDisputeRecovery(o))
  const openOrPartialDisputesCount = disputeEvaluations.filter(
    (d) =>
      d.recoveryClassification === 'OPEN_DISPUTE' ||
      d.recoveryClassification === 'UNVERIFIED_RECOVERY' ||
      d.recoveryClassification === 'PARTIAL_RECOVERY'
  ).length
  if (openOrPartialDisputesCount > 0 || (rawErrAdj < -0.01 && deductedOrders.length === 0)) {
    auditWarnings.push({
      code: 'OPEN_DISPUTES_OR_RECOVERIES_PENDING',
      message_es:
        openOrPartialDisputesCount > 0
          ? `Alerta informativa: ${openOrPartialDisputesCount} orden(es) con cargo/disputa abierta o recuperación parcial pendiente de seguimiento.`
          : `Alerta informativa: El corte incluye cargos/reembolsos por $${rawErrAdj.toFixed(2)} pendientes de seguimiento por orden.`,
      message_en:
        openOrPartialDisputesCount > 0
          ? `Informative alert: ${openOrPartialDisputesCount} order(s) with open dispute/error charge or partial recovery pending follow-up.`
          : `Informative alert: Payout includes $${rawErrAdj.toFixed(2)} in error charges/refunds pending order-level follow-up.`,
      cause_es: 'Existen deducciones por reembolsos o errores de orden cuyo reclamo o recuperación total sigue abierto.',
      cause_en: 'Order refund or error deductions exist whose claim or full recovery remains open.',
      next_action_es: 'Dar seguimiento en la pestaña Disputas y Recuperaciones y vincular el payout posterior cuando se recupere.',
      next_action_en: 'Follow up in the Disputes & Recoveries tab and link the subsequent payout once recovered.',
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
          return pStart <= effEnd && pEnd > effStart
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
      for (let startPos = 1; startPos <= 6001; startPos += 1000) {
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

    // Mapa global de pólizas QBO ya asignadas a algún payout en DB para impedir vínculos duplicados
    const alreadyAssignedJeIds = new Map<string, string>()
    for (const row of rawPayoutsAll || []) {
      const existingJeId = String(row?.raw_payload?.qb_journal_entry_id || '').trim()
      if (existingJeId && row?.id) {
        alreadyAssignedJeIds.set(existingJeId, String(row.id))
      }
    }

    const payoutsToBackfillQbId: Array<{ id: string; raw_payload: Record<string, any> }> = []

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

      const savedQbId = String(p.raw_payload?.qb_journal_entry_id || '').trim()
      const qboMatch = evaluateHistoricalQboJournalMatch({
        payout: p,
        storeLocationId: storeRefs.locationId,
        bankAccountQbId: storeRefs.bankAccountQbId,
        receivableQbId: cfg.receivableQbId,
        expectedReceivableAmount: preview.receivableCredit,
        qbJournalEntries,
        alreadyAssignedJeIds,
        // Para payouts sin vínculo en DB, NO vincular silenciosamente por coincidencia contable sin referencia en PrivateNote
        autoLinkAccountingSingleCandidate: false,
      })

      const matchedJe = qboMatch.matchedJe
      if (matchedJe && p.id) {
        alreadyAssignedJeIds.set(String(matchedJe.Id), String(p.id))
      }

      // Solo auto-reparar en DB si la coincidencia es FIRME por ID o Referencia Oficial en PrivateNote (Prioridad 1)
      if (matchedJe && !savedQbId && p.id && qboMatch.classification === 'FIRM_ID_OR_REF') {
        payoutsToBackfillQbId.push({
          id: p.id,
          raw_payload: {
            ...(p.raw_payload || {}),
            qb_journal_entry_id: String(matchedJe.Id),
            qb_doc_number: String(matchedJe.DocNumber || ''),
            qb_txn_date: String(matchedJe.TxnDate || preview.txnDate),
            qb_publish_status: 'PUBLISHED',
          },
        })
      }

      const hasJournalEntry = Boolean(
        (matchedJe || savedQbId) && qboMatch.classification !== 'CONFLICT_DUPLICATE_JE'
      )
      const publishStatus = p.raw_payload?.qb_publish_status || (hasJournalEntry ? 'PUBLISHED' : 'PENDING')
      const recoveryRequired = publishStatus === 'RECOVERY_REQUIRED'

      const qbJournalEntry = matchedJe && hasJournalEntry
        ? {
            id: String(matchedJe.Id),
            docNumber: String(matchedJe.DocNumber || p.raw_payload?.qb_doc_number || ''),
            txnDate: String(matchedJe.TxnDate || preview.txnDate),
            totalAmount: preview.totalDebits,
          }
        : savedQbId && hasJournalEntry
        ? {
            id: String(savedQbId),
            docNumber: String(p.raw_payload?.qb_doc_number || ''),
            txnDate: String(p.raw_payload?.qb_txn_date || preview.txnDate),
            totalAmount: preview.totalDebits,
          }
        : null

      // Construir lista final de bloqueos contables (incluyendo estado de póliza e historial QBO)
      const effectiveBlockers: PublishBlocker[] = [...preview.publishBlockers]

      if (hasJournalEntry) {
        effectiveBlockers.push({
          code: 'ALREADY_PUBLISHED_IN_QBO',
          message_es: `La póliza contable ya está registrada en QuickBooks Online (Doc #${qbJournalEntry?.docNumber || qbJournalEntry?.id}).`,
          message_en: `Journal Entry is already posted in QuickBooks Online (Doc #${qbJournalEntry?.docNumber || qbJournalEntry?.id}).`,
          cause_es: `El corte ya cuenta con el Journal Entry ID #${qbJournalEntry?.id} vinculado en QuickBooks Online.`,
          cause_en: `Settlement is already linked to QuickBooks Journal Entry ID #${qbJournalEntry?.id}.`,
          next_action_es: 'No vuelva a publicar este corte. Puede consultar la póliza existente o revisar las alertas de auditoría de órdenes.',
          next_action_en: 'Do not re-publish this settlement. You may view the existing entry or review order audit alerts.',
        })
      } else if (publishStatus === 'IN_PROGRESS') {
        effectiveBlockers.push({
          code: 'PUBLISH_IN_PROGRESS',
          message_es: 'El corte tiene una solicitud de publicación en curso en este momento.',
          message_en: 'This settlement currently has a publish request in progress.',
          cause_es: 'Existe un lock atómico activo en la base de datos para evitar creación duplicada.',
          cause_en: 'An active atomic lock exists in the database to prevent duplicate creation.',
          next_action_es: 'Espere a que finalice la solicitud actual y actualice la vista.',
          next_action_en: 'Wait for the current request to finish and refresh the view.',
        })
      } else if (recoveryRequired) {
        effectiveBlockers.push({
          code: 'RECOVERY_REQUIRED_CHECK_QBO',
          message_es: 'Publicación previa en estado de recuperación (RECOVERY_REQUIRED): se debe consultar QuickBooks antes de reintentar.',
          message_en: 'Previous publish in recovery state (RECOVERY_REQUIRED): QuickBooks must be checked before retrying.',
          cause_es: 'Una solicitud previa a QuickBooks Online sufrió un error de red o de persistencia post-creación.',
          cause_en: 'A previous request to QuickBooks Online experienced a network or post-creation persistence failure.',
          next_action_es: 'Use la acción "Verificar estado en QBO" para comprobar si la póliza se creó o liberar el corte de forma segura.',
          next_action_en: 'Use the "Verify status in QBO" action to check if the entry was created or safely unlock the settlement.',
        })
      }

      if (qboMatch.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW' && qboMatch.candidates.length > 0) {
        const cand = qboMatch.candidates[0]
        effectiveBlockers.push({
          code: 'HISTORICAL_QBO_CANDIDATE_PENDING',
          message_es: `Posible póliza histórica detectada en QuickBooks (Doc #${cand.docNumber || cand.id} del ${cand.txnDate} por $${cand.bankDebitAmount.toFixed(2)}) pendiente de resolver.`,
          message_en: `Possible historical Journal Entry detected in QuickBooks (Doc #${cand.docNumber || cand.id} dated ${cand.txnDate} for $${cand.bankDebitAmount.toFixed(2)}) pending resolution.`,
          cause_es: `La póliza QBO #${cand.id} coincide en sucursal, cuenta CxC, cuenta bancaria e importe ($${cand.bankDebitAmount.toFixed(2)}), pero no contiene la referencia oficial en PrivateNote.`,
          cause_en: `QBO Journal Entry #${cand.id} matches store, receivable account, bank account, and amount ($${cand.bankDebitAmount.toFixed(2)}), but lacks the official reference in PrivateNote.`,
          next_action_es: 'Revise la póliza candidata en el detalle del corte y confírmela (vincular) o descártela con motivo y evidencia antes de publicar.',
          next_action_en: 'Review the candidate entry in the settlement detail and confirm (link) or discard it with reason and evidence before publishing.',
        })
      } else if (qboMatch.classification === 'AMBIGUOUS_CANDIDATES') {
        effectiveBlockers.push({
          code: 'AMBIGUOUS_HISTORICAL_QBO_CANDIDATE',
          message_es: `Ambigüedad en QuickBooks: existen ${qboMatch.candidates.length} pólizas históricas candidatas con el mismo importe y banco.`,
          message_en: `Ambiguity in QuickBooks: ${qboMatch.candidates.length} candidate historical entries match the same amount and bank.`,
          cause_es: `Múltiples pólizas en QBO (${qboMatch.candidates.map((c) => `#${c.docNumber || c.id}`).join(', ')}) coinciden en sucursal, banco e importe dentro de la ventana de fechas.`,
          cause_en: `Multiple QBO entries (${qboMatch.candidates.map((c) => `#${c.docNumber || c.id}`).join(', ')}) match store, bank, and amount within the date window.`,
          next_action_es: 'Inspeccione las pólizas candidatas y seleccione explícitamente cuál vincular (o descarte las que no correspondan) con motivo y evidencia.',
          next_action_en: 'Inspect the candidate entries and explicitly select which one to link (or discard non-matching ones) with reason and evidence.',
        })
      } else if (qboMatch.classification === 'CONFLICT_DUPLICATE_JE') {
        effectiveBlockers.push({
          code: 'CONFLICTING_HISTORICAL_QBO_LINK',
          message_es: `Conflicto de vínculo QBO: la póliza ya está asignada a otro payout (${qboMatch.conflictWithPayoutId}).`,
          message_en: `QBO link conflict: the Journal Entry is already assigned to another payout (${qboMatch.conflictWithPayoutId}).`,
          cause_es: 'Una misma póliza de QuickBooks no puede asignarse a dos payouts distintos salvo agrupación explícitamente documentada.',
          cause_en: 'A single QuickBooks Journal Entry cannot be assigned to two different payouts unless explicitly documented as a grouped entry.',
          next_action_es: 'Descarte la póliza en conflicto o documente la aprobación explícita de póliza agrupada.',
          next_action_en: 'Discard the conflicting entry or document explicit grouped-entry approval.',
        })
      }

      const canPublish =
        !hasJournalEntry &&
        publishStatus !== 'IN_PROGRESS' &&
        !recoveryRequired &&
        effectiveBlockers.length === 0

      // 3. Distinguir estrictamente "Póliza registrada en QBO" de "Depósito confirmado en banco"
      // Una línea bancaria dentro del propio Journal Entry NO demuestra recepción ni conciliación bancaria real.
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
              String(l?.JournalEntryLineDetail?.PostingType || '') === 'Debit' &&
              Math.abs(round2(Number(l?.Amount || 0)) - netPayoutAbs) <= 0.05
          )
        : false

      const isBankDepositConfirmed =
        Boolean(matchedQbDeposit) || p.raw_payload?.bank_feed_confirmed === true

      const bankStatus: 'VERIFIED_IN_BANK' | 'JE_POSTED_IN_TRANSIT' | 'NOT_POSTED' =
        isBankDepositConfirmed
          ? 'VERIFIED_IN_BANK'
          : hasJournalEntry
          ? 'JE_POSTED_IN_TRANSIT'
          : 'NOT_POSTED'

      const bankVerification = {
        status: bankStatus,
        jeBankDebitVerified,
        label_es:
          bankStatus === 'VERIFIED_IN_BANK'
            ? 'Depósito confirmado en banco'
            : bankStatus === 'JE_POSTED_IN_TRANSIT'
            ? 'Póliza registrada en QBO (Depósito bancario pendiente de confirmar)'
            : 'Sin póliza registrada en QBO',
        label_en:
          bankStatus === 'VERIFIED_IN_BANK'
            ? 'Deposit confirmed in bank'
            : bankStatus === 'JE_POSTED_IN_TRANSIT'
            ? 'Journal Entry posted in QBO (Bank deposit pending confirmation)'
            : 'No Journal Entry posted in QBO',
        bankAccountNum: storeRefs.bankAccount,
        bankAccountName: `${storeRefs.bankAccount} ${storeRefs.bankAccountName.replace(/^\d+\s*-\s*/, '')}`,
        expectedDepositAmount: round2(Number(p.net_payout_amount || 0)),
        matchedDepositId: matchedQbDeposit
          ? String(matchedQbDeposit.Id)
          : p.raw_payload?.bank_feed_deposit_id
          ? String(p.raw_payload.bank_feed_deposit_id)
          : null,
        matchedDepositDate: matchedQbDeposit
          ? String(matchedQbDeposit.TxnDate || '')
          : p.raw_payload?.bank_feed_confirmed_date
          ? String(p.raw_payload.bank_feed_confirmed_date)
          : null,
        matchedDepositAmount: matchedQbDeposit
          ? round2(Number(matchedQbDeposit.TotalAmt || 0))
          : isBankDepositConfirmed
          ? round2(Number(p.net_payout_amount || 0))
          : null,
      }

      // 5. Tres estados independientes para la UI: (1) Payout/Póliza, (2) Auditoría de Órdenes, (3) Disputa/Recuperación
      const payoutPolicyStatus = {
        code: hasJournalEntry
          ? isBankDepositConfirmed
            ? 'PUBLISHED_AND_BANK_CONFIRMED'
            : 'PUBLISHED_IN_QBO'
          : recoveryRequired
          ? 'RECOVERY_REQUIRED'
          : publishStatus === 'IN_PROGRESS'
          ? 'PUBLISH_IN_PROGRESS'
          : qboMatch.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW' ||
            qboMatch.classification === 'AMBIGUOUS_CANDIDATES' ||
            qboMatch.classification === 'CONFLICT_DUPLICATE_JE'
          ? 'HISTORICAL_CANDIDATE_PENDING'
          : canPublish
          ? 'READY_TO_PUBLISH'
          : 'BLOCKED',
        label_es: hasJournalEntry
          ? `Póliza registrada en QBO (#${qbJournalEntry?.docNumber || qbJournalEntry?.id})`
          : recoveryRequired
          ? 'Recuperación QBO requerida'
          : publishStatus === 'IN_PROGRESS'
          ? 'Publicando en QBO...'
          : qboMatch.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW'
          ? 'Posible póliza histórica por confirmar'
          : qboMatch.classification === 'AMBIGUOUS_CANDIDATES'
          ? 'Candidatos QBO ambiguos'
          : qboMatch.classification === 'CONFLICT_DUPLICATE_JE'
          ? 'Conflicto de póliza QBO'
          : canPublish
          ? 'Listo para publicar en QBO'
          : 'Bloqueado para publicar',
        label_en: hasJournalEntry
          ? `Journal Entry posted in QBO (#${qbJournalEntry?.docNumber || qbJournalEntry?.id})`
          : recoveryRequired
          ? 'QBO Recovery Required'
          : publishStatus === 'IN_PROGRESS'
          ? 'Publishing to QBO...'
          : qboMatch.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW'
          ? 'Historical QBO candidate pending confirmation'
          : qboMatch.classification === 'AMBIGUOUS_CANDIDATES'
          ? 'Ambiguous QBO candidates'
          : qboMatch.classification === 'CONFLICT_DUPLICATE_JE'
          ? 'QBO entry link conflict'
          : canPublish
          ? 'Ready to publish to QBO'
          : 'Blocked from publishing',
        bank_status: bankStatus,
        bank_label_es: bankVerification.label_es,
        bank_label_en: bankVerification.label_en,
      }

      const auditStatus = {
        code: preview.auditWarnings.length === 0 ? 'AUDIT_CLEAN' : 'AUDIT_PENDING_ALERTS',
        warningsCount: preview.auditWarnings.length,
        label_es:
          preview.auditWarnings.length === 0
            ? 'Auditoría de órdenes sin alertas'
            : `Auditoría con ${preview.auditWarnings.length} alerta(s) pendiente(s)`,
        label_en:
          preview.auditWarnings.length === 0
            ? 'Order audit clean (no alerts)'
            : `Order audit has ${preview.auditWarnings.length} pending alert(s)`,
      }

      const deductedOrdersList = preview.auditBreakdown?.deductedOrders || []
      let openDisputesCount = 0
      let partialRecoveryCount = 0
      let fullRecoveryCount = 0
      let unverifiedRecoveryCount = 0
      for (const dOrd of deductedOrdersList) {
        const dStat = String(dOrd.dispute_status || 'PENDING')
        const recAmt = round2(Math.abs(Number(dOrd.reimbursement_amount || 0)))
        const dedAmt = round2(Math.abs(Number(dOrd.error_charge || 0)))
        const hasRef = Boolean(String(dOrd.reimbursement_payout_ref || '').trim())
        if (dStat === 'REIMBURSED') {
          if (hasRef && recAmt > 0 && recAmt >= dedAmt - 0.05) {
            fullRecoveryCount++
          } else if (hasRef && recAmt > 0) {
            partialRecoveryCount++
          } else {
            unverifiedRecoveryCount++
          }
        } else if (dStat !== 'ACCEPTED_LOSS') {
          openDisputesCount++
        }
      }

      const disputeRecoveryStatus = {
        code:
          unverifiedRecoveryCount > 0
            ? 'UNVERIFIED_RECOVERY'
            : partialRecoveryCount > 0
            ? 'PARTIAL_RECOVERY'
            : openDisputesCount > 0 || (preview.rawErrAdj < -0.01 && fullRecoveryCount === 0)
            ? 'OPEN_DISPUTES'
            : fullRecoveryCount > 0
            ? 'FULL_RECOVERY'
            : preview.rawErrAdj > 0.01
            ? 'POSITIVE_REIMBURSEMENT'
            : 'NO_DISPUTES',
        openDisputesCount,
        partialRecoveryCount,
        fullRecoveryCount,
        unverifiedRecoveryCount,
        netRefundsAdjustments: preview.rawErrAdj,
        label_es:
          unverifiedRecoveryCount > 0
            ? `${unverifiedRecoveryCount} recuperación(es) sin evidencia completa`
            : partialRecoveryCount > 0
            ? `${partialRecoveryCount} recuperación(es) parcial(es) (${openDisputesCount} abierta(s))`
            : openDisputesCount > 0
            ? `${openDisputesCount} disputa(s) / descuento(s) pendiente(s)`
            : preview.rawErrAdj < -0.01 && fullRecoveryCount === 0
            ? `Cargo por error / reembolso ($${preview.rawErrAdj.toFixed(2)}) por investigar`
            : fullRecoveryCount > 0
            ? `${fullRecoveryCount} disputa(s) recuperada(s) totalmente`
            : preview.rawErrAdj > 0.01
            ? `Reembolso a favor recibido (+$${preview.rawErrAdj.toFixed(2)})`
            : 'Sin disputas ni cargos por error',
        label_en:
          unverifiedRecoveryCount > 0
            ? `${unverifiedRecoveryCount} recovery(ies) missing verifiable evidence`
            : partialRecoveryCount > 0
            ? `${partialRecoveryCount} partial recovery(ies) (${openDisputesCount} open)`
            : openDisputesCount > 0
            ? `${openDisputesCount} open dispute(s) / deduction(s)`
            : preview.rawErrAdj < -0.01 && fullRecoveryCount === 0
            ? `Error charge / refund ($${preview.rawErrAdj.toFixed(2)}) to investigate`
            : fullRecoveryCount > 0
            ? `${fullRecoveryCount} dispute(s) fully recovered`
            : preview.rawErrAdj > 0.01
            ? `Positive reimbursement received (+$${preview.rawErrAdj.toFixed(2)})`
            : 'No disputes or error charges',
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
        portal_deposit_date: p.raw_payload?.portal_deposit_date || null,
        is_month_end_cutoff:
          p.raw_payload?.is_month_end_cutoff === true ||
          (plat === 'GRUBHUB' && /^\d{6}01/.test(String(p.payout_reference_id || ''))),
        is_new_month_remainder:
          p.raw_payload?.is_new_month_remainder === true ||
          (plat === 'GRUBHUB' &&
            !/^\d{6}01/.test(String(p.payout_reference_id || '')) &&
            typeof p.period_start === 'string' &&
            p.period_start.endsWith('-01') &&
            typeof p.period_end === 'string' &&
            p.period_end !== p.period_start &&
            Number(p.period_end.slice(-2)) <= 6),
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
        canPublish,
        publishBlockers: effectiveBlockers,
        auditWarnings: preview.auditWarnings,
        payoutPolicyStatus,
        auditStatus,
        disputeRecoveryStatus,
        qboMatchEvaluation: {
          classification: qboMatch.classification,
          candidates: qboMatch.candidates,
          conflictWithPayoutId: qboMatch.conflictWithPayoutId,
        },
        qbJournalEntry,
        bankVerification,
        journalPreview: {
          ...preview,
          canPublish,
          publishBlockers: effectiveBlockers,
        },
      }
    })

    if (payoutsToBackfillQbId.length > 0) {
      Promise.allSettled(
        payoutsToBackfillQbId.map((item) =>
          supabaseAdmin
            .from('delivery_platform_payouts')
            .update({
              raw_payload: item.raw_payload,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id)
        )
      ).catch(() => {})
    }

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

    const action = typeof body.action === 'string' ? body.action.trim() : 'publish'

    // =========================================================================
    // ACCIONES DE RESOLUCIÓN DE CANDIDATOS QBO HISTÓRICOS Y RECUPERACIÓN
    // =========================================================================
    if (
      action === 'confirm_qbo_candidate' ||
      action === 'discard_qbo_candidate' ||
      action === 'verify_recovery_status'
    ) {
      const targetPayoutId = String(body.payoutId || body.payout_id || '').trim()
      if (!targetPayoutId) {
        return NextResponse.json(
          { success: false, error: 'Se requiere payoutId para ejecutar esta acción.' },
          { status: 400 }
        )
      }

      const { data: targetPayout, error: tpErr } = await supabaseAdmin
        .from('delivery_platform_payouts')
        .select('*')
        .eq('id', targetPayoutId)
        .single()

      if (tpErr || !targetPayout) {
        return NextResponse.json(
          { success: false, error: 'No se encontró el corte indicado en la base de datos.' },
          { status: 404 }
        )
      }

      const scopeAuth = await authorizeDeliveryReconciliationRequest(req, supabaseAdmin, {
        permission: 'publish_journal',
        allowCron: false,
        targetStoreIds: [Number(targetPayout.store_id)],
      })
      if (!scopeAuth.authorized) {
        return NextResponse.json(
          { success: false, error: scopeAuth.error || 'No autorizado para esta sucursal.' },
          { status: scopeAuth.status || 403 }
        )
      }

      if (action === 'confirm_qbo_candidate' || action === 'discard_qbo_candidate') {
        const candidateJeId = String(body.jeId || body.je_id || '').trim()
        const reason = String(body.reason || '').trim()
        const evidence = String(body.evidence || '').trim()
        const allowSharedJe = Boolean(body.allowSharedJe || body.allow_shared_je)

        if (!candidateJeId) {
          return NextResponse.json(
            { success: false, error: 'Se requiere el ID de la póliza candidata de QuickBooks (jeId).' },
            { status: 400 }
          )
        }
        if (reason.length < 5) {
          return NextResponse.json(
            {
              success: false,
              error: 'Debe registrar un motivo explícito (mínimo 5 caracteres) para confirmar o descartar una póliza candidata.',
            },
            { status: 400 }
          )
        }
        if (evidence.length < 3) {
          return NextResponse.json(
            {
              success: false,
              error: 'Debe registrar evidencia verificable (ej. DocNumber, fecha o referencia de estado de cuenta) para confirmar o descartar.',
            },
            { status: 400 }
          )
        }

        if (action === 'confirm_qbo_candidate') {
          // Verificar que ninguna otra fila tenga ya asignada esta misma póliza QBO (salvo agrupación explícitamente aprobada)
          const allPayoutRows = await fetchAllSupabaseRows<any>((from, to) =>
            supabaseAdmin
              .from('delivery_platform_payouts')
              .select('id, payout_reference_id, store_id, platform, raw_payload')
              .range(from, to)
          )
          const conflictingRow = (allPayoutRows || []).find(
            (r: any) =>
              String(r?.id) !== String(targetPayout.id) &&
              String(r?.raw_payload?.qb_journal_entry_id || '').trim() === candidateJeId
          )
          if (conflictingRow && !allowSharedJe) {
            return NextResponse.json(
              {
                success: false,
                error: `La póliza QBO #${candidateJeId} ya está asignada al corte ${conflictingRow.payout_reference_id} (ID ${conflictingRow.id}). No se permite asignar la misma póliza a dos payouts distintos salvo agrupación explícitamente documentada (allowSharedJe=true).`,
              },
              { status: 409 }
            )
          }

          let verifiedDocNumber = String(body.docNumber || body.doc_number || '').trim()
          let verifiedTxnDate = String(body.txnDate || body.txn_date || targetPayout.payout_date || targetPayout.period_end || '').trim()
          try {
            const { token, realmId } = await getValidQuickBooksToken()
            const q = encodeURIComponent(`select * from JournalEntry where Id = '${candidateJeId.replace(/'/g, '')}'`)
            const r = await fetch(
              `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${q}&minorversion=75`,
              { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
            )
            if (r.ok) {
              const j = await r.json()
              const jeObj = j?.QueryResponse?.JournalEntry?.[0]
              if (jeObj) {
                verifiedDocNumber = String(jeObj.DocNumber || verifiedDocNumber)
                verifiedTxnDate = String(jeObj.TxnDate || verifiedTxnDate)
              }
            }
          } catch {}

          const currentRaw = targetPayout.raw_payload || {}
          const resolutionEntry = {
            action: 'CONFIRMED',
            je_id: candidateJeId,
            doc_number: verifiedDocNumber,
            txn_date: verifiedTxnDate,
            reason,
            evidence,
            allow_shared_je: allowSharedJe,
            resolved_by: auth.user.email || 'staff',
            resolved_by_user_id: auth.user.id || null,
            resolved_by_role: auth.user.role || null,
            resolved_at: new Date().toISOString(),
          }
          const updatedRaw = {
            ...currentRaw,
            qb_journal_entry_id: candidateJeId,
            qb_doc_number: verifiedDocNumber,
            qb_txn_date: verifiedTxnDate,
            qb_publish_status: 'PUBLISHED',
            qbo_shared_je_approved: allowSharedJe ? true : currentRaw.qbo_shared_je_approved,
            qbo_candidate_resolution: resolutionEntry,
            qbo_candidate_audit_log: [
              ...(Array.isArray(currentRaw.qbo_candidate_audit_log) ? currentRaw.qbo_candidate_audit_log : []),
              resolutionEntry,
            ],
          }

          const { error: updErr } = await supabaseAdmin
            .from('delivery_platform_payouts')
            .update({
              raw_payload: updatedRaw,
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetPayout.id)

          if (updErr) {
            return NextResponse.json(
              { success: false, error: `Error al guardar confirmación de póliza: ${updErr.message}` },
              { status: 500 }
            )
          }

          return NextResponse.json({
            success: true,
            action: 'confirm_qbo_candidate',
            payoutId: targetPayout.id,
            journalEntry: {
              id: candidateJeId,
              docNumber: verifiedDocNumber,
              txnDate: verifiedTxnDate,
            },
            resolution: resolutionEntry,
          })
        } else {
          // discard_qbo_candidate
          const currentRaw = targetPayout.raw_payload || {}
          const existingDiscarded: string[] = Array.isArray(currentRaw.discarded_qbo_je_ids)
            ? currentRaw.discarded_qbo_je_ids.map((x: any) => String(x))
            : []
          const nextDiscarded = Array.from(new Set([...existingDiscarded, candidateJeId]))
          const discardEntry = {
            action: 'DISCARDED',
            je_id: candidateJeId,
            reason,
            evidence,
            resolved_by: auth.user.email || 'staff',
            resolved_by_user_id: auth.user.id || null,
            resolved_by_role: auth.user.role || null,
            resolved_at: new Date().toISOString(),
          }
          const updatedRaw = {
            ...currentRaw,
            discarded_qbo_je_ids: nextDiscarded,
            qbo_candidate_resolution: discardEntry,
            qbo_candidate_audit_log: [
              ...(Array.isArray(currentRaw.qbo_candidate_audit_log) ? currentRaw.qbo_candidate_audit_log : []),
              discardEntry,
            ],
          }

          const { error: updErr } = await supabaseAdmin
            .from('delivery_platform_payouts')
            .update({
              raw_payload: updatedRaw,
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetPayout.id)

          if (updErr) {
            return NextResponse.json(
              { success: false, error: `Error al descartar candidato QBO: ${updErr.message}` },
              { status: 500 }
            )
          }

          return NextResponse.json({
            success: true,
            action: 'discard_qbo_candidate',
            payoutId: targetPayout.id,
            discardedJeId: candidateJeId,
            discardedJeIds: nextDiscarded,
            resolution: discardEntry,
          })
        }
      }

      if (action === 'verify_recovery_status') {
        const { token, realmId } = await getValidQuickBooksToken()
        const mappings = await getStorePlatformMappings()
        const storeMeta = mappings.find((m) => m.store_id === Number(targetPayout.store_id))
        const storeName = storeMeta?.store_name || `Store #${targetPayout.store_id}`
        const storeRefs = getQBStoreRefs(storeName)
        const plat = (targetPayout.platform as DeliveryPlatformCode) || 'UBER_EATS'
        const cfg = PLATFORM_QB_CONFIG[plat] || PLATFORM_QB_CONFIG.UBER_EATS
        const idempotencyKey = buildPayoutIdempotencyKey(
          plat,
          Number(targetPayout.store_id),
          targetPayout.payout_reference_id
        )

        const q = encodeURIComponent(`select * from JournalEntry orderby TxnDate desc maxresults 500`)
        const r = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${q}&minorversion=75`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        )
        if (!r.ok) {
          return NextResponse.json(
            { success: false, error: `No se pudo consultar QuickBooks Online (${r.status}).` },
            { status: 502 }
          )
        }
        const j = await r.json()
        const recentJournals: any[] = j?.QueryResponse?.JournalEntry || []
        const preview = buildPayoutJournalPreview({
          payout: targetPayout,
          storeName,
          storeOrders: [],
        })
        const evalRes = evaluateHistoricalQboJournalMatch({
          payout: targetPayout,
          storeLocationId: storeRefs.locationId,
          bankAccountQbId: storeRefs.bankAccountQbId,
          receivableQbId: cfg.receivableQbId,
          expectedReceivableAmount: preview.receivableCredit,
          qbJournalEntries: recentJournals,
          autoLinkAccountingSingleCandidate: false,
        })

        if (evalRes.matchedJe && evalRes.classification === 'FIRM_ID_OR_REF') {
          const jeId = String(evalRes.matchedJe.Id)
          const docNum = String(evalRes.matchedJe.DocNumber || '')
          const txnDt = String(evalRes.matchedJe.TxnDate || preview.txnDate)
          await supabaseAdmin
            .from('delivery_platform_payouts')
            .update({
              raw_payload: {
                ...(targetPayout.raw_payload || {}),
                qb_journal_entry_id: jeId,
                qb_doc_number: docNum,
                qb_txn_date: txnDt,
                qb_idempotency_key: idempotencyKey,
                qb_publish_status: 'PUBLISHED',
                qb_recovered_at: new Date().toISOString(),
                qb_recovered_by: auth.user.email || 'staff',
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetPayout.id)

          return NextResponse.json({
            success: true,
            action: 'verify_recovery_status',
            outcome: 'RECOVERED_EXISTING_IN_QBO',
            payoutId: targetPayout.id,
            journalEntry: { id: jeId, docNumber: docNum, txnDate: txnDt },
          })
        }

        if (evalRes.candidates.length > 0) {
          return NextResponse.json({
            success: true,
            action: 'verify_recovery_status',
            outcome: 'CANDIDATES_FOUND_REQUIRE_CONFIRMATION',
            payoutId: targetPayout.id,
            candidates: evalRes.candidates,
          })
        }

        // Confirmado que NO se creó en QBO: liberar estado RECOVERY_REQUIRED a PENDING para permitir reintento seguro
        const cleanedRaw = { ...(targetPayout.raw_payload || {}) }
        cleanedRaw.qb_publish_status = 'PENDING'
        delete cleanedRaw.qb_lock_expires_at
        cleanedRaw.qb_recovery_verified_absent_at = new Date().toISOString()
        cleanedRaw.qb_recovery_verified_by = auth.user.email || 'staff'

        await supabaseAdmin
          .from('delivery_platform_payouts')
          .update({
            raw_payload: cleanedRaw,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetPayout.id)

        return NextResponse.json({
          success: true,
          action: 'verify_recovery_status',
          outcome: 'CONFIRMED_ABSENT_IN_QBO_UNLOCKED',
          payoutId: targetPayout.id,
        })
      }
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

    // Cargar todos los vínculos QBO existentes para evitar duplicidad de póliza entre payouts
    const allPayoutLinksRows = await fetchAllSupabaseRows<any>((from, to) =>
      supabaseAdmin
        .from('delivery_platform_payouts')
        .select('id, raw_payload')
        .range(from, to)
    )
    const alreadyAssignedJeIds = new Map<string, string>()
    for (const row of allPayoutLinksRows || []) {
      const existingJeId = String(row?.raw_payload?.qb_journal_entry_id || '').trim()
      if (existingJeId && row?.id) {
        alreadyAssignedJeIds.set(existingJeId, String(row.id))
      }
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

      // 2. Evaluar existencia en DB o en QuickBooks Online antes de publicar
      const qboMatch = evaluateHistoricalQboJournalMatch({
        payout: p,
        storeLocationId: storeRefs.locationId,
        bankAccountQbId: storeRefs.bankAccountQbId,
        receivableQbId: cfg.receivableQbId,
        expectedReceivableAmount: preview.receivableCredit,
        qbJournalEntries: existingQbJournals,
        alreadyAssignedJeIds,
        autoLinkAccountingSingleCandidate: false,
      })

      const alreadyInQbo = qboMatch.matchedJe

      if (p.raw_payload?.qb_journal_entry_id || alreadyInQbo) {
        const existingId = String(alreadyInQbo?.Id || p.raw_payload?.qb_journal_entry_id)
        const existingDoc = String(alreadyInQbo?.DocNumber || p.raw_payload?.qb_doc_number || '')
        const existingTxn = String(alreadyInQbo?.TxnDate || p.raw_payload?.qb_txn_date || preview.txnDate)

        // Si estaba en QBO por referencia firme (FIRM_ID_OR_REF) pero no en DB, reparar vínculo en DB
        if (!p.raw_payload?.qb_journal_entry_id && alreadyInQbo && qboMatch.classification === 'FIRM_ID_OR_REF') {
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

      // 2b. Si el corte está en RECOVERY_REQUIRED y no se encontró por referencia firme en QBO, exigir verificación explícita
      if (p.raw_payload?.qb_publish_status === 'RECOVERY_REQUIRED') {
        const recBlocker: PublishBlocker = {
          code: 'RECOVERY_REQUIRED_CHECK_QBO',
          message_es: 'El corte está en estado RECOVERY_REQUIRED tras un fallo previo. Ejecute primero la verificación contra QuickBooks antes de reintentar.',
          message_en: 'Settlement is in RECOVERY_REQUIRED state after a prior failure. Run QuickBooks verification first before retrying.',
          cause_es: 'Una solicitud previa a QuickBooks Online pudo haber creado la póliza antes de fallar la respuesta o persistencia.',
          cause_en: 'A previous request to QuickBooks Online may have created the entry before the response or persistence failed.',
          next_action_es: 'Haga clic en "Verificar estado en QBO" para vincular la póliza existente o desbloquear el reintento.',
          next_action_en: 'Click "Verify status in QBO" to link the existing entry or unlock retry.',
        }
        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: false,
          recoveryRequired: true,
          status: 'RECOVERY_REQUIRED',
          blockers: [recBlocker],
          error: recBlocker.message_es,
        })
        continue
      }

      // 2c. Bloquear si existe una posible póliza histórica pendiente de confirmar/descartar o ambigua
      const candidateBlockers: PublishBlocker[] = [...preview.publishBlockers]
      if (qboMatch.classification === 'HISTORICAL_CANDIDATE_PENDING_REVIEW' && qboMatch.candidates.length > 0) {
        const cand = qboMatch.candidates[0]
        candidateBlockers.push({
          code: 'HISTORICAL_QBO_CANDIDATE_PENDING',
          message_es: `Existe una posible póliza histórica en QuickBooks (Doc #${cand.docNumber || cand.id} del ${cand.txnDate} por $${cand.bankDebitAmount.toFixed(2)}) pendiente de confirmar o descartar.`,
          message_en: `Possible historical Journal Entry in QuickBooks (Doc #${cand.docNumber || cand.id} dated ${cand.txnDate} for $${cand.bankDebitAmount.toFixed(2)}) pending confirmation or discard.`,
          cause_es: `La póliza QBO #${cand.id} coincide en sucursal, cuenta CxC, banco e importe, pero requiere confirmación explícita del usuario.`,
          cause_en: `QBO entry #${cand.id} matches store, receivable, bank, and amount, requiring explicit user confirmation.`,
          next_action_es: 'Confirme el vínculo con la póliza histórica o descártela con motivo y evidencia antes de crear una nueva.',
          next_action_en: 'Confirm the link to the historical entry or discard it with reason and evidence before creating a new one.',
        })
      } else if (qboMatch.classification === 'AMBIGUOUS_CANDIDATES') {
        candidateBlockers.push({
          code: 'AMBIGUOUS_HISTORICAL_QBO_CANDIDATE',
          message_es: `Se detectaron ${qboMatch.candidates.length} posibles pólizas históricas en QuickBooks con el mismo importe y banco. No se puede publicar sin resolver la ambigüedad.`,
          message_en: `Detected ${qboMatch.candidates.length} candidate historical entries in QuickBooks with the same amount and bank. Cannot publish without resolving ambiguity.`,
          cause_es: 'Múltiples pólizas en QuickBooks coinciden con los parámetros contables del corte.',
          cause_en: 'Multiple entries in QuickBooks match the settlement accounting parameters.',
          next_action_es: 'Confirme cuál póliza corresponde a este corte o descarte los candidatos con motivo y evidencia.',
          next_action_en: 'Confirm which entry belongs to this settlement or discard candidates with reason and evidence.',
        })
      } else if (qboMatch.classification === 'CONFLICT_DUPLICATE_JE') {
        candidateBlockers.push({
          code: 'CONFLICTING_HISTORICAL_QBO_LINK',
          message_es: `Conflicto de póliza QBO con otro payout (${qboMatch.conflictWithPayoutId}).`,
          message_en: `QBO entry conflict with another payout (${qboMatch.conflictWithPayoutId}).`,
          cause_es: 'La póliza QBO ya está asignada a otro payout.',
          cause_en: 'The QBO Journal Entry is already assigned to another payout.',
          next_action_es: 'Resuelva el conflicto descartando o documentando la agrupación.',
          next_action_en: 'Resolve the conflict by discarding or documenting grouping.',
        })
      }

      // 3. Bloquear si existen publishBlockers contables o de candidatos QBO
      if (!preview.canPublish || candidateBlockers.length > 0) {
        results.push({
          payoutId: p.id,
          payoutRef: p.payout_reference_id,
          storeName,
          platform: p.platform,
          idempotencyKey,
          success: false,
          status: 'BLOCKED',
          blockers: candidateBlockers,
          error: candidateBlockers.map((b) => b.message_es).join(' | '),
        })
        continue
      }

      // 4. P0-1: Adquirir lock verdaderamente atómico en Supabase ANTES de llamar a QuickBooks Online
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

      let qbDeterministicValidationReject = false
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
          if (qbRes.status === 400 && errTxt.includes('Fault')) {
            qbDeterministicValidationReject = true
          }
          throw new Error(`QuickBooks API Error (${qbRes.status}): ${errTxt}`)
        }

        const qbData = await qbRes.json()
        const jeCreated = qbData.JournalEntry || qbData
        const jeId = String(jeCreated.Id || '')
        if (!jeId) {
          throw new Error('QuickBooks respondió HTTP 200 pero sin Id de JournalEntry en el cuerpo.')
        }
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
          // Intentar dejar marcado explícitamente RECOVERY_REQUIRED
          await supabaseAdmin
            .from('delivery_platform_payouts')
            .update({
              raw_payload: {
                ...(p.raw_payload || {}),
                qb_idempotency_key: idempotencyKey,
                qb_publish_status: 'RECOVERY_REQUIRED',
                qb_pending_recovery_je_id: jeId,
                qb_pending_recovery_doc_number: finalDocNumber,
                qb_last_error: 'Persistencia post-creación QBO incompleta; requiere sincronización de recuperación.',
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
            recoveryRequired: true,
            status: 'RECOVERY_REQUIRED',
            journalEntry: {
              id: jeId,
              docNumber: finalDocNumber,
              txnDate: finalTxnDate,
            },
            error: `Creado en QuickBooks (ID #${jeId}, Doc #${finalDocNumber}), pero falló la confirmación de persistencia en Supabase. Estado: RECOVERY_REQUIRED (consultar QBO antes de reintentar).`,
          })
          continue
        }

        alreadyAssignedJeIds.set(jeId, String(p.id))

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
        // Si QBO pudo haber creado la póliza pero falló la red/respuesta/5xx, usar RECOVERY_REQUIRED y consultar QBO antes de reintentar
        const nextStatus = qbDeterministicValidationReject ? 'FAILED' : 'RECOVERY_REQUIRED'
        await supabaseAdmin
          .from('delivery_platform_payouts')
          .update({
            raw_payload: {
              ...(p.raw_payload || {}),
              qb_idempotency_key: idempotencyKey,
              qb_publish_status: nextStatus,
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
          recoveryRequired: nextStatus === 'RECOVERY_REQUIRED',
          status: nextStatus === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : 'ERROR',
          error:
            nextStatus === 'RECOVERY_REQUIRED'
              ? `Respuesta de QBO incierta (${err.message || 'Error de comunicación'}). Estado puesto en RECOVERY_REQUIRED: verifique en QuickBooks Online antes de reintentar.`
              : err.message || 'Error al publicar Journal Entry en QuickBooks Online',
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
