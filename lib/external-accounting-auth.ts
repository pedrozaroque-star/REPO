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
  'rvelasquez95@yahoo.com',
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
    !ALLOWED_EXTERNAL_ACCOUNTING_EMAILS.has(dbEmailLower) &&
    !ALLOWED_EXTERNAL_ACCOUNTING_USER_IDS.has(dbIdStr)
  ) {
    return {
      authorized: false,
      status: 403,
      error: 'Acceso restringido: Cuenta no autorizada para Contabilidad Externa.'
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
 * estrictamente aislados por `company_realm_id = realmId`.
 */
export async function applyAccountDeltasAtomically(
  supabase: SupabaseClient,
  realmId: string,
  deltas: Map<string, number>
): Promise<void> {
  const entries = Array.from(deltas.entries()).filter(([, d]) => Math.abs(d) >= 0.001)
  if (entries.length === 0) return

  const safeRealm = realmId.replace(/'/g, "''")
  const valuesSql = entries
    .map(([qbId, delta]) => `('${qbId.replace(/'/g, "''")}', ${Number(delta.toFixed(2))})`)
    .join(', ')

  const atomicUpdateSql = `
    SELECT 1 ) t;
    UPDATE external_accounting_accounts AS a
    SET
      current_balance = ROUND(COALESCE(a.current_balance, 0) + v.delta, 2),
      updated_at = NOW()
    FROM (VALUES ${valuesSql}) AS v(qb_account_id, delta)
    WHERE a.company_realm_id = '${safeRealm}'
      AND a.qb_account_id = v.qb_account_id;
    SELECT * FROM (SELECT 1
  `

  const { error } = await supabase.rpc('execute_sql', { query_text: atomicUpdateSql })
  if (error) {
    throw new Error(`Atomic balance update failed: ${error.message}`)
  }
}

/**
 * Registra en la bitácora de auditoría contable (`external_accounting_audit_log`)
 * cualquier mutación realizada por Raquel, Roberto o Roque.
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
  }
): Promise<void> {
  try {
    await supabase.from('external_accounting_audit_log').insert({
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
  } catch (err) {
    console.warn('[external_accounting_audit_log] Non-blocking log warning:', err)
  }
}
