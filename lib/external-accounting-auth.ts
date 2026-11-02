/**
 * @module lib/external-accounting-auth
 * @description Guardián de autorización backend (Fail-Closed), aislamiento multi-empresa (`company_realm_id`),
 * paginación completa sin truncamiento PostgREST (bloques de 1,000 filas) y motor atómico de saldos en partida doble
 * para el módulo de Contabilidad Externa (`/admin/contabilidad-externa`).
 *
 * @businessRules
 * - Acceso exclusivo (Whitelist estricta en servidor):
 *   1. Raquel Velazquez (`raquel@tacosgavilan.com`, `id: 45`)
 *   2. Roberto Velazquez (`roberto@tacosgavilan.com`, `id: 46`)
 *   3. Roque (`roque@tacosgavilan.com`, `id: 47`)
 * - Cualquier petición sin JWT válido (`teg_token`) recibe HTTP 401.
 * - Cualquier usuario autenticado fuera de la lista blanca recibe HTTP 403.
 * - Aislamiento estricto por `company_realm_id`: ninguna transacción, cuenta, contacto o plantilla recurrente
 *   puede leerse, editarse, anularse o eliminarse cruzando otro `realmId`.
 * - Paginación real sobre el universo completo de transacciones de la empresa (superando el límite de 1,000 filas de PostgREST).
 *
 * @dataFlow
 * - NextRequest -> `authorizeExternalAccounting(req)` -> `getServerUser(req)` + validación en `public.users`.
 * - `fetchAllCompanyTransactions(supabase, realmId)` -> lectura paginada `.range()` en lotes de 1,000 hasta completar el 100% de la empresa.
 * - `computeTransactionAccountDeltas` + `applyAccountDeltasAtomically` -> actualización atómica en PostgreSQL (`current_balance = ROUND(COALESCE(current_balance, 0) + delta, 2)`).
 *
 * @notes
 * - Implementado para garantizar preparación 100% de producción sin dependencia de Intuit QuickBooks Online.
 * - 2026-10-28: `computeTransactionAccountDeltas` usa el motor de pólizas `lib/external-accounting-ledger.ts`
 *   con la convención de signo de QBO (`CurrentBalance` débito positivo). Antes invertía el movimiento de
 *   pasivos / capital / tarjetas al crear, editar, anular o reclasificar transacciones.
 */

import { NextRequest } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { getServerUser, ServerUser } from './auth-server'
import { buildLedgerContext, buildTxnPostings, postingsToDeltaMap, type LedgerContext } from './external-accounting-ledger'

export const ALLOWED_EXTERNAL_ACCOUNTING_EMAILS = new Set([
  'raquel@tacosgavilan.com',
  'roberto@tacosgavilan.com',
  'roque@tacosgavilan.com',
])

export const ALLOWED_EXTERNAL_ACCOUNTING_USER_IDS = new Set([
  '45',
  '46',
  '47',
])

export type ExternalAccountingAuthResult =
  | {
      authorized: true
      user: ServerUser
    }
  | {
      authorized: false
      status: number
      error: string
    }

/**
 * Verifica criptográficamente el JWT del usuario y valida que pertenezca exclusivamente
 * a Raquel Velazquez (45), Roberto Velazquez (46) o Roque (47).
 */
export async function authorizeExternalAccounting(
  req: NextRequest | Request,
  supabase: SupabaseClient
): Promise<ExternalAccountingAuthResult> {
  const user = await getServerUser(req)
  if (!user) {
    return {
      authorized: false,
      status: 401,
      error: 'No autorizado: Sesión inválida o expirada. Por favor inicia sesión.'
    }
  }

  const emailLower = String(user.email || '').trim().toLowerCase()
  const userIdStr = String(user.id || '').trim()

  const inStaticWhitelist =
    ALLOWED_EXTERNAL_ACCOUNTING_EMAILS.has(emailLower) ||
    ALLOWED_EXTERNAL_ACCOUNTING_USER_IDS.has(userIdStr)

  if (!inStaticWhitelist) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso restringido: Este módulo es exclusivo para Raquel Velazquez, Roberto Velazquez y Roque.'
    }
  }

  // Verificar en base de datos que la cuenta exista, esté activa y coincida con la lista blanca
  const numericId = Number(userIdStr)
  let dbUser: any = null
  if (Number.isFinite(numericId) && numericId > 0) {
    const { data } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active')
      .eq('id', numericId)
      .maybeSingle()
    dbUser = data
  }
  if (!dbUser && emailLower) {
    const { data } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active')
      .ilike('email', emailLower)
      .maybeSingle()
    dbUser = data
  }

  if (!dbUser || dbUser.is_active === false) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso denegado: Usuario inactivo o no registrado en el padrón autorizado.'
    }
  }

  const dbEmailLower = String(dbUser.email || '').trim().toLowerCase()
  const dbIdStr = String(dbUser.id || '').trim()
  if (
    !ALLOWED_EXTERNAL_ACCOUNTING_USER_IDS.has(dbIdStr) &&
    !ALLOWED_EXTERNAL_ACCOUNTING_EMAILS.has(dbEmailLower)
  ) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso restringido: Cuenta no autorizada para Contabilidad Externa.'
    }
  }
  if (!ALLOWED_EXTERNAL_ACCOUNTING_USER_IDS.has(dbIdStr)) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso restringido: Solo los IDs autorizados (45 Raquel, 46 Roberto, 47 Roque) tienen acceso.'
    }
  }

  return {
    authorized: true,
    user: {
      ...user,
      id: dbIdStr,
      email: dbUser.email,
      name: dbUser.full_name || user.name
    }
  }
}

/**
 * Descarga el 100% de las transacciones de una empresa (`company_realm_id`) superando
 * el límite por defecto de 1,000 filas de Supabase PostgREST mediante bloques `.range()`.
 */
export async function fetchAllCompanyTransactions(
  supabase: SupabaseClient,
  realmId: string,
  ascending = false
): Promise<any[]> {
  const PAGE_SIZE = 1000
  const allRows: any[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('external_accounting_transactions')
      .select('*')
      .eq('company_realm_id', realmId)
      .order('txn_date', { ascending })
      .order('created_at', { ascending })
      .order('id', { ascending })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    allRows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return allRows
}

/**
 * Determina si una cuenta contable es de naturaleza deudora (Asset / Expense / COGS).
 */
export function isDebitNormalAccount(accountType: string, classification?: string): boolean {
  const t = (accountType || '').toLowerCase()
  const c = (classification || '').toLowerCase()
  if (
    t.includes('payable') ||
    t.includes('credit card') ||
    t.includes('liability') ||
    t.includes('equity') ||
    t.includes('income') ||
    t.includes('revenue')
  ) {
    return false
  }
  if (
    t.includes('bank') ||
    t.includes('receivable') ||
    t.includes('asset') ||
    t.includes('expense') ||
    t.includes('cost of goods')
  ) {
    return true
  }
  if (c === 'asset' || c === 'expense') return true
  if (c === 'liability' || c === 'equity' || c === 'revenue') return false
  return false
}

/**
 * Calcula de forma pura y determinista el mapa de ajustes (`qb_account_id -> delta`)
 * que una transacción produce sobre el catálogo de cuentas de `realmId`.
 * `multiplier = 1` aplica la transacción; `multiplier = -1` la revierte.
 *
 * Convención (igual a `Account.CurrentBalance` de la API V3 de QBO): débito positivo / crédito negativo.
 * Los pasivos, capital e ingresos guardan saldos negativos; usar `toNaturalBalance()` para mostrarlos.
 *
 * @notes 2026-10-28: Reescrito sobre el motor de pólizas `lib/external-accounting-ledger.ts`.
 * La versión anterior sumaba con signo "natural" sobre saldos que QBO entrega con signo deudor,
 * lo que invertía el movimiento de pasivos/capital (préstamos, A/P, tarjetas) y desfasaba los saldos al corte.
 */
const ledgerCtxCache = new WeakMap<Map<string, any>, LedgerContext>()

export function computeTransactionAccountDeltas(
  acctByQbId: Map<string, any>,
  txn: any,
  multiplier: 1 | -1,
  ctx?: LedgerContext
): Map<string, number> {
  if (!txn || txn.is_voided) return new Map<string, number>()
  let ledgerCtx = ctx || ledgerCtxCache.get(acctByQbId)
  if (!ledgerCtx) {
    ledgerCtx = buildLedgerContext(Array.from(acctByQbId.values()))
    ledgerCtxCache.set(acctByQbId, ledgerCtx)
  }
  return postingsToDeltaMap(buildTxnPostings(txn, ledgerCtx), ledgerCtx, multiplier)
}

/**
 * @deprecated Motor anterior (signo natural). Se conserva solo como referencia histórica; no usar.
 */
export function computeTransactionAccountDeltasLegacy(
  acctByQbId: Map<string, any>,
  txn: any,
  multiplier: 1 | -1
): Map<string, number> {
  const deltas = new Map<string, number>()
  if (!txn || txn.is_voided) return deltas

  const amt = Number(txn.total_amount || 0)
  if (amt === 0) return deltas

  const addDelta = (qbId: string | null | undefined, d: number) => {
    if (!qbId || !Number.isFinite(d) || d === 0) return
    if (!acctByQbId.has(qbId)) return
    deltas.set(qbId, Number(((deltas.get(qbId) || 0) + d).toFixed(2)))
  }

  const tType = txn.txn_type || 'Check'
  const rawLines: any[] = Array.isArray(txn.line_items) ? txn.line_items : []
  const lines: any[] =
    rawLines.length > 0
      ? rawLines
      : txn.to_account_qb_id
      ? [{ account_qb_id: txn.to_account_qb_id, amount: amt }]
      : []

  if (tType === 'Transfer') {
    addDelta(txn.account_qb_id, -amt * multiplier)
    addDelta(txn.to_account_qb_id, amt * multiplier)
  } else if (tType === 'PayDownCreditCard') {
    addDelta(txn.account_qb_id, -amt * multiplier)
    const targetCc = txn.to_account_qb_id || lines[0]?.account_qb_id
    if (targetCc) {
      addDelta(targetCc, -amt * multiplier)
    }
  } else if (tType === 'JournalEntry') {
    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      const acc = acctByQbId.get(line.account_qb_id)
      const debitNormal = isDebitNormalAccount(acc?.account_type || '', acc?.classification || '')
      const isDebit = (line.posting_type || 'Debit') === 'Debit'
      const sign = debitNormal ? (isDebit ? 1 : -1) : (isDebit ? -1 : 1)
      addDelta(line.account_qb_id, lAmt * sign * multiplier)
    }
  } else if (tType === 'Deposit' || tType === 'Payment' || tType === 'SalesReceipt') {
    addDelta(txn.account_qb_id, amt * multiplier)
    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      const acc = acctByQbId.get(line.account_qb_id)
      const debitNormal = isDebitNormalAccount(acc?.account_type || '', acc?.classification || '')
      addDelta(line.account_qb_id, (debitNormal ? -lAmt : lAmt) * multiplier)
    }
  } else if (tType === 'Check' || tType === 'Expense' || tType === 'CreditCardExpense' || tType === 'BillPayment') {
    const primaryAcc = acctByQbId.get(txn.account_qb_id)
    const isCreditCard = (primaryAcc?.account_type || '').toLowerCase().includes('credit card')
    addDelta(txn.account_qb_id, (isCreditCard ? amt : -amt) * multiplier)

    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      const acc = acctByQbId.get(line.account_qb_id)
      const debitNormal = isDebitNormalAccount(acc?.account_type || '', acc?.classification || '')
      addDelta(line.account_qb_id, (debitNormal ? lAmt : -lAmt) * multiplier)
    }
  } else if (tType === 'RefundReceipt') {
    addDelta(txn.account_qb_id, -amt * multiplier)
    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      addDelta(line.account_qb_id, -lAmt * multiplier)
    }
  } else if (tType === 'CreditMemo' || tType === 'VendorCredit' || tType === 'CreditCardCredit') {
    if (txn.account_qb_id) {
      addDelta(txn.account_qb_id, -amt * multiplier)
    }
    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      addDelta(line.account_qb_id, -lAmt * multiplier)
    }
  } else if (tType === 'Invoice') {
    if (txn.account_qb_id) {
      addDelta(txn.account_qb_id, amt * multiplier)
    }
    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      addDelta(line.account_qb_id, lAmt * multiplier)
    }
  } else if (tType === 'Bill') {
    if (txn.account_qb_id) {
      addDelta(txn.account_qb_id, amt * multiplier)
    }
    for (const line of lines) {
      const lAmt = Number(line.amount || 0)
      if (!line.account_qb_id || lAmt === 0) continue
      addDelta(line.account_qb_id, lAmt * multiplier)
    }
  }
  // Note: Estimate & PurchaseOrder are non-posting transactions in QBO (0 balance impact)

  return deltas
}

/**
 * Combina dos mapas de ajustes (`qb_account_id -> delta`) en un solo mapa neto.
 */
export function mergeAccountDeltas(
  first: Map<string, number>,
  second: Map<string, number>
): Map<string, number> {
  const merged = new Map<string, number>(first)
  for (const [qbId, delta] of second.entries()) {
    const nextVal = Number(((merged.get(qbId) || 0) + delta).toFixed(2))
    if (Math.abs(nextVal) < 0.0001) {
      merged.delete(qbId)
    } else {
      merged.set(qbId, nextVal)
    }
  }
  return merged
}

/**
 * Aplica de forma atómica un conjunto de ajustes (`qb_account_id -> delta`) en PostgreSQL
 * estrictamente aislados por `company_realm_id = realmId` mediante el RPC transaccional
 * `public.fn_ext_acct_apply_account_deltas`.
 */
export async function applyAccountDeltasAtomically(
  supabase: SupabaseClient,
  realmId: string,
  deltas: Map<string, number>
): Promise<void> {
  const entries = Array.from(deltas.entries())
    .filter(([, d]) => Math.abs(d) >= 0.001)
    .map(([qb_account_id, delta]) => ({
      qb_account_id: String(qb_account_id).trim(),
      delta: Number(delta.toFixed(2)),
    }))
  if (entries.length === 0) return

  const { data, error } = await supabase.rpc('fn_ext_acct_apply_account_deltas', {
    p_realm_id: realmId,
    p_deltas: entries,
  })
  if (error) {
    throw new Error(`Atomic balance update failed: ${error.message}`)
  }
  if (!data || (typeof data === 'object' && 'ok' in data && !(data as any).ok)) {
    throw new Error(`Atomic balance update returned unexpected payload: ${JSON.stringify(data)}`)
  }
}

export interface AtomicTransactionMutationParams {
  operation: 'UPSERT' | 'VOID' | 'DELETE'
  realmId: string
  txn: Record<string, any>
  deltas: Map<string, number>
  invoiceUpdates?: Array<{ id: string; open_balance: number; raw_data?: Record<string, any> }>
  contactDeltas?: Array<{
    id?: string
    qb_contact_id?: string
    display_name?: string
    delta?: number
    balance?: number
    require_found?: boolean
  }>
  user: ServerUser
  audit: {
    actionType: string
    entityType?: string
    entityId?: string
    docNumber?: string | null
    amount?: number | null
    summary: string
    details?: Record<string, any>
  }
  outbox?: {
    entityKind?: 'TRANSACTION' | 'ACCOUNT' | 'CONTACT' | 'LIST_ITEM' | 'RECURRING' | 'ATTACHMENT'
    entityType?: string
    qbEntityId?: string | null
    operation?: 'CREATE' | 'UPDATE' | 'UPSERT' | 'VOID' | 'DELETE' | 'DEACTIVATE'
    idempotencyKey: string
    payload?: Record<string, any>
    status?: 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED' | 'SKIPPED_LOCAL_ONLY'
  } | null
}

/**
 * Ejecuta una mutación contable completa (Transacción + Líneas + LinkedTxn + Saldos de Cuentas +
 * Facturas/Bills vinculadas + Saldo de Contacto + Cola Outbox QBO + Auditoría Obligatoria)
 * dentro de una ÚNICA transacción ACID de PostgreSQL (`public.fn_ext_acct_mutate_transaction_atomic`).
 */
export async function mutateTransactionAtomically(
  supabase: SupabaseClient,
  params: AtomicTransactionMutationParams
): Promise<{
  transaction: Record<string, any>
  balanceUpdates: any
  auditId: string
  outboxId: string | null
  autoCreatedContactId: string | null
  autoCreatedContactQbId: string | null
  autoCreatedContactOutboxId: string | null
}> {
  const deltaEntries = Array.from(params.deltas.entries())
    .filter(([, d]) => Math.abs(d) >= 0.001)
    .map(([qb_account_id, delta]) => ({
      qb_account_id: String(qb_account_id).trim(),
      delta: Number(delta.toFixed(2)),
    }))

  const auditPayload = {
    user_id: String(params.user.id || ''),
    user_name: params.user.name || params.user.email || 'Authorized User',
    user_email: params.user.email || null,
    action_type: params.audit.actionType,
    entity_type: params.audit.entityType || params.txn.txn_type || null,
    entity_id: params.audit.entityId ? String(params.audit.entityId) : null,
    doc_number: params.audit.docNumber ?? params.txn.doc_number ?? null,
    amount:
      params.audit.amount !== undefined && params.audit.amount !== null
        ? Number(params.audit.amount)
        : Number(params.txn.total_amount || 0),
    summary: params.audit.summary,
    details: params.audit.details || {},
  }

  const outboxPayload = params.outbox
    ? {
        entity_kind: params.outbox.entityKind || 'TRANSACTION',
        entity_type: params.outbox.entityType || params.txn.qb_entity_type || params.txn.txn_type,
        qb_entity_id: params.outbox.qbEntityId || params.txn.qb_txn_id || null,
        operation: params.outbox.operation || params.operation,
        idempotency_key: params.outbox.idempotencyKey,
        payload: params.outbox.payload || params.txn,
        status: params.outbox.status || 'PENDING',
      }
    : null

  const { data, error } = await supabase.rpc('fn_ext_acct_mutate_transaction_atomic', {
    p_operation: params.operation,
    p_realm_id: params.realmId,
    p_txn: params.txn,
    p_deltas: deltaEntries,
    p_invoice_updates: params.invoiceUpdates || [],
    p_contact_deltas: params.contactDeltas || [],
    p_audit: auditPayload,
    p_outbox: outboxPayload,
  })

  if (error) {
    throw new Error(`Atomic accounting transaction failed: ${error.message}`)
  }
  if (!data || !(data as any).ok || !(data as any).transaction) {
    throw new Error(`Atomic accounting transaction returned invalid response: ${JSON.stringify(data)}`)
  }

  return {
    transaction: (data as any).transaction,
    balanceUpdates: (data as any).balance_updates,
    auditId: String((data as any).audit_id || ''),
    outboxId: (data as any).outbox_id ? String((data as any).outbox_id) : null,
    autoCreatedContactId: (data as any).auto_created_contact_id ? String((data as any).auto_created_contact_id) : null,
    autoCreatedContactQbId: (data as any).auto_created_contact_qb_id ? String((data as any).auto_created_contact_qb_id) : null,
    autoCreatedContactOutboxId: (data as any).auto_created_contact_outbox_id ? String((data as any).auto_created_contact_outbox_id) : null,
  }
}

/**
 * Ejecuta en una ÚNICA transacción ACID de PostgreSQL (`public.fn_ext_acct_batch_mutate_transactions_atomic`)
 * la creación o actualización masiva de transacciones (Batch Save, Reclassify, Bank Rules, Write-Off Invoices),
 * junto con ajustes de saldos de cuentas, saldos pendientes de facturas, saldos de contactos,
 * encolado obligatorio de Outbox QBO y bitácora de auditoría. Si falla 1 renglón, se revierte el 100% del lote.
 */
export async function batchMutateTransactionsAtomically(
  supabase: SupabaseClient,
  params: {
    mode?: 'BATCH_INSERT' | 'BATCH_UPDATE' | 'WRITE_OFF'
    realmId: string
    items: Array<{
      operation?: string
      txn: Record<string, any>
      deltas?: Map<string, number>
      outbox?: {
        idempotency_key?: string
        idempotencyKey?: string
        status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        [key: string]: any
      }
    }>
    deltas?: Map<string, number>
    outboxStatus?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
    invoiceUpdates?: Array<{ id?: string; invoice_id?: string; open_balance: number; raw_data?: Record<string, any> }>
    contactUpdates?: Array<{ id?: string; qb_contact_id?: string; balance?: number; delta?: number }>
    user: ServerUser
    audit?: {
      actionType: string
      entityType?: string
      entityId?: string
      docNumber?: string | null
      amount?: number | null
      summary: string
      details?: Record<string, any>
    }
    batchAudit?: {
      actionType: string
      entityType?: string
      entityId?: string
      docNumber?: string | null
      amount?: number | null
      summary: string
      details?: Record<string, any>
    }
  }
): Promise<{
  count: number
  mutatedCount: number
  transactions: Record<string, any>[]
  outboxIds: string[]
  auditId: string
}> {
  let combinedDeltas = params.deltas ? new Map(params.deltas) : new Map<string, number>()
  for (const item of params.items || []) {
    if (item.deltas) {
      combinedDeltas = mergeAccountDeltas(combinedDeltas, item.deltas)
    }
  }

  const deltaEntries = Array.from(combinedDeltas.entries())
    .filter(([, d]) => Math.abs(d) >= 0.001)
    .map(([qb_account_id, delta]) => ({
      qb_account_id: String(qb_account_id).trim(),
      delta: Number(delta.toFixed(2)),
    }))

  const normalizedItems = (params.items || []).map(item => ({
    txn: item.txn,
    outbox: {
      ...(item.outbox || {}),
      idempotency_key: item.outbox?.idempotency_key || item.outbox?.idempotencyKey || undefined,
      status: item.outbox?.status || params.outboxStatus || undefined,
    },
  }))

  const normalizedInvoiceUpdates = (params.invoiceUpdates || []).map(inv => ({
    id: String(inv.id || inv.invoice_id || ''),
    open_balance: Number(inv.open_balance || 0),
    ...(inv.raw_data !== undefined ? { raw_data: inv.raw_data } : {}),
  }))

  const normalizedContactUpdates = (params.contactUpdates || []).map((c: any) => ({
    id: c.id || c.contact_id ? String(c.id || c.contact_id) : undefined,
    qb_contact_id: c.qb_contact_id ? String(c.qb_contact_id) : undefined,
    ...(c.balance !== undefined ? { balance: Number(c.balance) } : {}),
    ...(c.delta !== undefined ? { delta: Number(c.delta) } : {}),
  }))

  const auditInfo = params.audit || params.batchAudit || {
    actionType: 'BATCH_MUTATE_TRANSACTIONS',
    summary: `Batch mutated ${(params.items || []).length} transactions`,
  }
  const effectiveMode = params.mode || (params.invoiceUpdates && params.invoiceUpdates.length > 0 ? 'WRITE_OFF' : 'BATCH_UPDATE')

  const auditPayload = {
    user_id: String(params.user.id || ''),
    user_name: params.user.name || params.user.email || 'Authorized User',
    user_email: params.user.email || null,
    action_type: auditInfo.actionType,
    entity_type: auditInfo.entityType || effectiveMode,
    entity_id: auditInfo.entityId || null,
    doc_number: auditInfo.docNumber || null,
    amount:
      auditInfo.amount !== undefined && auditInfo.amount !== null
        ? Number(auditInfo.amount)
        : null,
    summary: auditInfo.summary,
    details: auditInfo.details || {},
  }

  const { data, error } = await supabase.rpc('fn_ext_acct_batch_mutate_transactions_atomic', {
    p_mode: effectiveMode,
    p_realm_id: params.realmId,
    p_items: normalizedItems,
    p_deltas: deltaEntries,
    p_invoice_updates: normalizedInvoiceUpdates,
    p_contact_updates: normalizedContactUpdates,
    p_audit: auditPayload,
  })

  if (error) {
    throw new Error(`Atomic batch transaction mutation failed: ${error.message}`)
  }
  if (!data || !(data as any).ok) {
    throw new Error(`Atomic batch transaction mutation returned invalid response: ${JSON.stringify(data)}`)
  }

  const countVal = Number((data as any).count || 0)
  return {
    count: countVal,
    mutatedCount: countVal,
    transactions: Array.isArray((data as any).transactions) ? (data as any).transactions : [],
    outboxIds: Array.isArray((data as any).outbox_ids) ? (data as any).outbox_ids.map(String) : [],
    auditId: String((data as any).audit_id || ''),
  }
}

/**
 * Ejecuta en una ÚNICA transacción ACID de PostgreSQL (`public.fn_ext_acct_save_reconciliation_atomic`)
 * la conciliación bancaria completa: cargos bancarios, intereses ganados, asiento de ajuste justificado,
 * actualización de `cleared_status = 'Reconciled'`, actualización de saldos de cuentas,
 * registro en `external_accounting_reconciliations`, Outbox QBO y bitácora de auditoría.
 */
export async function saveReconciliationAtomically(
  supabase: SupabaseClient,
  params: {
    realmId: string
    reconciliation: Record<string, any>
    reconciledTxnIds?: string[]
    extraTransactions?: Array<{
      txn: Record<string, any>
      deltas?: Map<string, number>
      outbox?: {
        idempotency_key?: string
        idempotencyKey?: string
        status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
        [key: string]: any
      }
      audit?: Record<string, any>
    }>
    deltas?: Map<string, number>
    user: ServerUser
    audit: {
      actionType: string
      entityType?: string
      entityId?: string
      docNumber?: string | null
      amount?: number | null
      summary: string
      details?: Record<string, any>
    }
  }
): Promise<{
  reconciliation: Record<string, any>
  extraTransactions: Record<string, any>[]
  extraTxnIds: string[]
  outboxIds: string[]
  auditId: string
}> {
  let combinedDeltas = params.deltas ? new Map(params.deltas) : new Map<string, number>()
  for (const et of params.extraTransactions || []) {
    if (et.deltas) {
      combinedDeltas = mergeAccountDeltas(combinedDeltas, et.deltas)
    }
  }

  const deltaEntries = Array.from(combinedDeltas.entries())
    .filter(([, d]) => Math.abs(d) >= 0.001)
    .map(([qb_account_id, delta]) => ({
      qb_account_id: String(qb_account_id).trim(),
      delta: Number(delta.toFixed(2)),
    }))

  const normalizedExtraTxns = (params.extraTransactions || []).map(et => ({
    txn: et.txn,
    outbox: et.outbox
      ? {
          ...et.outbox,
          idempotency_key: et.outbox.idempotency_key || et.outbox.idempotencyKey || undefined,
        }
      : undefined,
    audit: et.audit,
  }))

  const recPayload = {
    ...params.reconciliation,
    reconciled_txn_ids:
      params.reconciledTxnIds !== undefined
        ? params.reconciledTxnIds
        : params.reconciliation.reconciled_txn_ids || [],
  }

  const auditPayload = {
    user_id: String(params.user.id || ''),
    user_name: params.user.name || params.user.email || 'Authorized User',
    user_email: params.user.email || null,
    action_type: params.audit.actionType,
    doc_number: params.audit.docNumber || null,
    amount: params.audit.amount !== undefined && params.audit.amount !== null ? Number(params.audit.amount) : null,
    summary: params.audit.summary,
    details: params.audit.details || {},
  }

  const { data, error } = await supabase.rpc('fn_ext_acct_save_reconciliation_atomic', {
    p_realm_id: params.realmId,
    p_reconciliation: recPayload,
    p_extra_transactions: normalizedExtraTxns,
    p_deltas: deltaEntries,
    p_audit: auditPayload,
  })

  if (error) {
    throw new Error(`Atomic reconciliation save failed: ${error.message}`)
  }
  if (!data || !(data as any).ok || !(data as any).reconciliation) {
    throw new Error(`Atomic reconciliation save returned invalid response: ${JSON.stringify(data)}`)
  }

  const extraTxns = Array.isArray((data as any).extra_transactions) ? (data as any).extra_transactions : []
  return {
    reconciliation: (data as any).reconciliation,
    extraTransactions: extraTxns,
    extraTxnIds: extraTxns.map((t: any) => String(t?.id || '')).filter(Boolean),
    outboxIds: Array.isArray((data as any).outbox_ids) ? (data as any).outbox_ids.map(String) : [],
    auditId: String((data as any).audit_id || ''),
  }
}

/**
 * Reabre o elimina una conciliación bancaria en una ÚNICA transacción ACID de PostgreSQL
 * (`public.fn_ext_acct_reopen_or_delete_reconciliation_atomic`).
 */
export async function reopenOrDeleteReconciliationAtomically(
  supabase: SupabaseClient,
  params: {
    operation: 'REOPEN' | 'DELETE'
    realmId: string
    reconciliationId: string
    user: ServerUser
    audit?: {
      actionType?: string
      docNumber?: string | null
      amount?: number | null
      summary?: string
      details?: Record<string, any>
    }
  }
): Promise<{
  reconciliation: Record<string, any>
  auditId: string
}> {
  const auditPayload = {
    user_id: String(params.user.id || ''),
    user_name: params.user.name || params.user.email || 'Authorized User',
    user_email: params.user.email || null,
    action_type: params.audit?.actionType || `RECONCILE_BANK_${params.operation}`,
    doc_number: params.audit?.docNumber || null,
    amount: params.audit?.amount !== undefined && params.audit?.amount !== null ? Number(params.audit.amount) : null,
    summary: params.audit?.summary || `${params.operation} reconciliation ${params.reconciliationId}`,
    details: params.audit?.details || {},
  }

  const { data, error } = await supabase.rpc('fn_ext_acct_reopen_or_delete_reconciliation_atomic', {
    p_operation: params.operation,
    p_realm_id: params.realmId,
    p_reconciliation_id: params.reconciliationId,
    p_audit: auditPayload,
  })

  if (error) {
    throw new Error(`Atomic reconciliation ${params.operation} failed: ${error.message}`)
  }
  if (!data || !(data as any).ok) {
    throw new Error(`Atomic reconciliation ${params.operation} returned invalid response: ${JSON.stringify(data)}`)
  }

  return {
    reconciliation: (data as any).reconciliation,
    auditId: String((data as any).audit_id || ''),
  }
}

/**
 * Ejecuta en una ÚNICA transacción ACID de PostgreSQL (`public.fn_ext_acct_mutate_entity_atomic`)
 * el CRUD de entidades (`ACCOUNT`, `CONTACT`, `LIST_ITEM`, `RECURRING`, `ATTACHMENT`) junto con
 * su registro obligatorio en `external_accounting_sync_outbox` y `external_accounting_audit_log`.
 */
export async function mutateEntityAtomically(
  supabase: SupabaseClient,
  params: {
    entityKind: 'ACCOUNT' | 'CONTACT' | 'LIST_ITEM' | 'RECURRING' | 'ATTACHMENT' | 'BANK_RULE' | 'BUDGET' | 'COMPANY_SETTINGS' | 'NOTE_TASK'
    operation: 'UPSERT' | 'DELETE' | 'DEACTIVATE' | 'TOGGLE'
    realmId: string
    listKey?: string | null
    entity?: Record<string, any>
    record?: Record<string, any>
    user: ServerUser
    audit: {
      actionType: string
      entityType?: string
      entityId?: string
      docNumber?: string | null
      amount?: number | null
      summary: string
      details?: Record<string, any>
    }
    outbox?: {
      entityKind?: string
      entityType?: string
      qbEntityId?: string | null
      operation?: 'CREATE' | 'UPDATE' | 'UPSERT' | 'DELETE' | 'DEACTIVATE' | 'TOGGLE'
      idempotencyKey?: string
      payload?: Record<string, any>
      status?: 'PENDING' | 'SKIPPED_LOCAL_ONLY'
      maxAttempts?: number
    } | null
  }
): Promise<{
  entity: Record<string, any>
  record: Record<string, any>
  localId: string | null
  qbId: string | null
  outboxId: string | null
  outboxStatus: string | null
  qboSyncEnabled: boolean
  auditId: string
}> {
  const entityObj = params.entity || params.record || {}
  const auditPayload = {
    user_id: String(params.user.id || ''),
    user_name: params.user.name || params.user.email || 'Authorized User',
    user_email: params.user.email || null,
    action_type: params.audit.actionType,
    entity_type: params.audit.entityType || params.listKey || params.entityKind,
    entity_id: params.audit.entityId || null,
    doc_number: params.audit.docNumber || null,
    amount: params.audit.amount !== undefined && params.audit.amount !== null ? Number(params.audit.amount) : null,
    summary: params.audit.summary,
    details: params.audit.details || {},
  }

  const outboxPayload =
    params.outbox === null
      ? null
      : {
          entity_type: params.outbox?.entityType || params.listKey || params.entityKind,
          qb_entity_id: params.outbox?.qbEntityId || null,
          operation: params.outbox?.operation || params.operation,
          idempotency_key:
            params.outbox?.idempotencyKey ||
            `${params.entityKind}-${params.operation}-${params.realmId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          payload: params.outbox?.payload || entityObj,
          status: params.outbox?.status || 'PENDING',
          max_attempts: params.outbox?.maxAttempts || 5,
        }

  const { data, error } = await supabase.rpc('fn_ext_acct_mutate_entity_atomic', {
    p_entity_kind: params.entityKind,
    p_operation: params.operation,
    p_realm_id: params.realmId,
    p_list_key: params.listKey || null,
    p_entity: entityObj,
    p_audit: auditPayload,
    p_outbox: outboxPayload,
  })

  if (error) {
    throw new Error(`Atomic entity mutation (${params.entityKind}/${params.operation}) failed: ${error.message}`)
  }
  if (!data || !(data as any).ok) {
    throw new Error(`Atomic entity mutation returned invalid response: ${JSON.stringify(data)}`)
  }

  const retEntity = (data as any).entity || {}
  return {
    entity: retEntity,
    record: retEntity,
    localId: (data as any).local_id ? String((data as any).local_id) : null,
    qbId: (data as any).qb_id ? String((data as any).qb_id) : null,
    outboxId: (data as any).outbox_id ? String((data as any).outbox_id) : null,
    outboxStatus: (data as any).outbox_status ? String((data as any).outbox_status) : null,
    qboSyncEnabled: Boolean((data as any).qbo_sync_enabled),
    auditId: String((data as any).audit_id || ''),
  }
}

/**
 * Registra de forma obligatoria y NO silenciosa en la bitácora de auditoría contable
 * (`external_accounting_audit_log`) cualquier mutación realizada por Raquel, Roberto o Roque.
 */
export async function logExternalAccountingAudit(
  supabase: SupabaseClient,
  params: {
    realmId: string
    user: ServerUser
    actionType: string
    entityType?: string
    entityId?: string
    docNumber?: string | null
    amount?: number | null
    summary: string
    details?: Record<string, any>
    strict?: boolean
  }
): Promise<void> {
  const { error } = await supabase.from('external_accounting_audit_log').insert({
    company_realm_id: params.realmId,
    user_id: String(params.user.id || ''),
    user_name: params.user.name || params.user.email || 'Authorized User',
    user_email: params.user.email || null,
    action_type: params.actionType,
    entity_type: params.entityType || null,
    entity_id: params.entityId ? String(params.entityId) : null,
    doc_number: params.docNumber || null,
    amount: params.amount !== undefined && params.amount !== null ? Number(params.amount) : null,
    summary: params.summary,
    details: params.details || {},
  })

  if (error) {
    if (params.strict !== false) {
      throw new Error(`Mandatory audit log insert failed: ${error.message}`)
    }
    console.warn('[external_accounting_audit_log] Non-blocking log warning:', error)
  }
}
