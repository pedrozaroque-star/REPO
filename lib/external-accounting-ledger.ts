/**
 * @module lib/external-accounting-ledger
 * @description Motor de Pólizas en Partida Doble (Double-Entry Posting Engine) del módulo CONTABILIDAD EXTERNA.
 * Convierte cada transacción (Check, Deposit, Invoice, Payment, Bill, BillPayment, JournalEntry, Transfer, etc.)
 * en sus asientos contables (`postings`: cuenta + monto con signo deudor) exactamente como lo hace el
 * Libro Mayor (General Ledger) de Intuit QuickBooks Online. TODOS los reportes (Balance Sheet, P&L,
 * Trial Balance, General Ledger, Bank Register, Transaction Report/Drill-Down) y los saldos de cuentas
 * se derivan de este único motor para que cuadren al centavo entre sí y contra QBO.
 *
 * @businessRules
 * - Convención de signo = la misma de la API V3 de QBO (`Account.CurrentBalance`): **débito positivo / crédito negativo**.
 *   (Activos y Gastos con saldo deudor > 0; Pasivos, Capital e Ingresos con saldo acreedor < 0.)
 *   Para mostrar en pantalla como QBO (pasivos/capital/ingresos en positivo) usar `toNaturalBalance()`.
 * - Fuente preferente: `raw_data` (objeto original QBO V3) cuando está sincronizado y coincide con la fila
 *   (mismo Id, fecha y TotalAmt). Si la transacción fue creada/editada localmente, se usan los campos normalizados.
 * - Depósitos: líneas con `LinkedTxn` (pagos de clientes) salen de *Undeposited Funds*; `CashBack` se carga a su cuenta.
 * - Invoice / SalesReceipt / CreditMemo: líneas `SalesItemLineDetail` usan `ItemAccountRef` o la cuenta de ingreso del Producto/Servicio;
 *   `DiscountLineDetail` va a su cuenta de descuento; `TxnTaxDetail.TotalTax` va a la cuenta de impuesto por pagar.
 * - Payment: Dr Banco/Undeposited Funds, Cr Accounts Receivable. BillPayment: Dr Accounts Payable, Cr Banco/Tarjeta.
 * - Estimate y PurchaseOrder no afectan saldos (non-posting).
 *
 * @dataFlow
 * external_accounting_transactions (+ raw_data) + external_accounting_accounts + external_accounting_items
 *   -> buildLedgerContext() -> buildTxnPostings() -> reportes / saldos / drill-downs.
 *
 * @notes
 * - 2026-10-28: Creado para corregir errores de signo detectados al auditar contra QBO en vivo
 *   (Total Liabilities negativo, préstamos con saldos al corte desfasados, depósitos a cuentas de Balance
 *   contados como ingreso en el P&L, Trial Balance sin cuentas de resultados, Retained Earnings en $0).
 */

export const CREDIT_NORMAL_TYPES = new Set([
  'Accounts Payable',
  'Credit Card',
  'Other Current Liability',
  'Long Term Liability',
  'Equity',
  'Income',
  'Other Income',
])

export const BALANCE_SHEET_TYPES = new Set([
  'Bank',
  'Accounts Receivable',
  'Other Current Asset',
  'Fixed Asset',
  'Other Asset',
  'Accounts Payable',
  'Credit Card',
  'Other Current Liability',
  'Long Term Liability',
  'Equity',
])

export const INCOME_TYPES = new Set(['Income', 'Other Income'])
export const EXPENSE_TYPES = new Set(['Expense', 'Cost of Goods Sold', 'Other Expense'])

export interface LedgerAccount {
  qb_account_id: string
  name?: string | null
  fully_qualified_name?: string | null
  account_type?: string | null
  account_sub_type?: string | null
  classification?: string | null
  parent_qb_id?: string | null
  is_active?: boolean | null
  current_balance?: number | null
  [k: string]: any
}

export interface LedgerItem {
  qb_item_id: string
  name?: string | null
  fully_qualified_name?: string | null
  item_type?: string | null
  income_account_qb_id?: string | null
  expense_account_qb_id?: string | null
  asset_account_qb_id?: string | null
  [k: string]: any
}

export interface LedgerContext {
  accounts: Map<string, LedgerAccount>
  accountsByName: Map<string, LedgerAccount>
  items: Map<string, LedgerItem>
  itemsByName: Map<string, LedgerItem>
  undepositedFundsId: string | null
  defaultArId: string | null
  defaultApId: string | null
  salesTaxPayableId: string | null
  txnAccountByKey?: Map<string, string | null>
}

export interface Posting {
  account_qb_id: string
  /** Debit-positive signed amount (Debit > 0, Credit < 0). */
  amount: number
  line_index: number
  is_header: boolean
  memo: string
  /** Name on the posting (line Name for deposits/journal entries, otherwise the transaction payee). */
  entity_name: string | null
  entity_qb_id: string | null
  /** QBO entity type of `entity_name`: Vendor | Customer | Employee | Other (null when unknown). */
  entity_type: string | null
  /** Billable customer of an expense line (`AccountBasedExpenseLineDetail.CustomerRef`). */
  customer_name: string | null
  customer_qb_id: string | null
  department_name: string | null
  department_qb_id: string | null
  class_name: string | null
  class_qb_id: string | null
  item_name: string | null
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const str = (v: any): string | null => (v === undefined || v === null || v === '' ? null : String(v))
/** QBO returns entity types as "Vendor", "VENDOR", "CUSTOMER", "Employee"… → canonical "Vendor" | "Customer" | "Employee" | "Other". */
export function normalizeEntityType(v: any): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('vendor')) return 'Vendor'
  if (s.startsWith('customer') || s === 'job') return 'Customer'
  if (s.startsWith('employee')) return 'Employee'
  return 'Other'
}

export function isCreditNormalAccount(acc: { account_type?: string | null; classification?: string | null } | null | undefined): boolean {
  if (!acc) return false
  if (acc.account_type && CREDIT_NORMAL_TYPES.has(acc.account_type)) return true
  if (acc.account_type) return false
  return ['Liability', 'Equity', 'Revenue'].includes(String(acc.classification || ''))
}

export function isBalanceSheetAccountType(acc: { account_type?: string | null; classification?: string | null } | null | undefined): boolean {
  if (!acc) return false
  if (acc.account_type && BALANCE_SHEET_TYPES.has(acc.account_type)) return true
  if (acc.account_type) return false
  return ['Asset', 'Liability', 'Equity'].includes(String(acc.classification || ''))
}

export function isIncomeAccount(acc: any): boolean {
  return Boolean(acc) && (INCOME_TYPES.has(acc.account_type) || (!acc.account_type && acc.classification === 'Revenue'))
}

export function isExpenseAccount(acc: any): boolean {
  return Boolean(acc) && (EXPENSE_TYPES.has(acc.account_type) || (!acc.account_type && acc.classification === 'Expense'))
}

export function isProfitLossAccount(acc: any): boolean {
  return isIncomeAccount(acc) || isExpenseAccount(acc)
}

/** Converts a debit-positive amount/balance into the natural presentation sign QBO uses on screen. */
export function toNaturalBalance(acc: any, debitPositive: number): number {
  const v = Number(debitPositive || 0)
  return r2(isCreditNormalAccount(acc) ? -v : v)
}

/** Converts a natural presentation amount back to debit-positive storage sign. */
export function fromNaturalBalance(acc: any, natural: number): number {
  const v = Number(natural || 0)
  return r2(isCreditNormalAccount(acc) ? -v : v)
}

export function buildLedgerContext(accountsList: LedgerAccount[], itemsList: LedgerItem[] = [], txns: any[] = []): LedgerContext {
  const accounts = new Map<string, LedgerAccount>()
  const accountsByName = new Map<string, LedgerAccount>()
  let undepositedFundsId: string | null = null
  let defaultArId: string | null = null
  let defaultApId: string | null = null
  let salesTaxPayableId: string | null = null
  for (const a of accountsList || []) {
    if (!a?.qb_account_id) continue
    const id = String(a.qb_account_id)
    accounts.set(id, a)
    if (a.name) accountsByName.set(String(a.name).toLowerCase().trim(), a)
    if (a.fully_qualified_name) accountsByName.set(String(a.fully_qualified_name).toLowerCase().trim(), a)
    const sub = String(a.account_sub_type || '')
    const nm = String(a.name || '').toLowerCase()
    if (!undepositedFundsId && (sub === 'UndepositedFunds' || nm === 'undeposited funds')) undepositedFundsId = id
    if (!defaultArId && a.account_type === 'Accounts Receivable') defaultArId = id
    if (!defaultApId && a.account_type === 'Accounts Payable') defaultApId = id
    if (!salesTaxPayableId && (sub === 'SalesTaxPayable' || sub === 'GlobalTaxPayable' || (a.account_type === 'Other Current Liability' && nm.includes('sales tax')))) salesTaxPayableId = id
  }
  const items = new Map<string, LedgerItem>()
  const itemsByName = new Map<string, LedgerItem>()
  for (const it of itemsList || []) {
    if (!it?.qb_item_id) continue
    items.set(String(it.qb_item_id), it)
    if (it.name) itemsByName.set(String(it.name).toLowerCase().trim(), it)
    if (it.fully_qualified_name) itemsByName.set(String(it.fully_qualified_name).toLowerCase().trim(), it)
  }
  const txnAccountByKey = new Map<string, string | null>()
  for (const t of txns || []) {
    if (t?.qb_txn_id) txnAccountByKey.set(`${t.qb_entity_type || t.txn_type}:${t.qb_txn_id}`, str(t.account_qb_id))
  }
  return { accounts, accountsByName, items, itemsByName, undepositedFundsId, defaultArId, defaultApId, salesTaxPayableId, txnAccountByKey }
}

function resolveAccountRef(ctx: LedgerContext, ref: any): string | null {
  if (!ref) return null
  const id = str(ref.value ?? ref)
  if (id && ctx.accounts.has(id)) return id
  const nm = str(ref.name)
  if (nm) {
    const byName = ctx.accountsByName.get(nm.toLowerCase().trim())
    if (byName) return String(byName.qb_account_id)
  }
  return id
}

function resolveAccountByIdOrName(ctx: LedgerContext, id: any, name: any): string | null {
  const sid = str(id)
  if (sid && ctx.accounts.has(sid)) return sid
  const nm = str(name)
  if (nm) {
    const key = nm.toLowerCase().trim()
    const byName = ctx.accountsByName.get(key) || (key.includes(':') ? ctx.accountsByName.get(key.split(':').pop()!.trim()) : undefined)
    if (byName) return String(byName.qb_account_id)
  }
  return sid
}

function itemAccount(ctx: LedgerContext, itemRef: any, mode: 'INCOME' | 'EXPENSE'): string | null {
  if (!itemRef) return null
  const id = str(itemRef.value ?? itemRef)
  const it = (id && ctx.items.get(id)) || (itemRef.name ? ctx.itemsByName.get(String(itemRef.name).toLowerCase().trim()) : undefined)
  if (!it) return null
  if (mode === 'INCOME') return str(it.income_account_qb_id) || str(it.expense_account_qb_id)
  const isInventory = String(it.item_type || '').toLowerCase() === 'inventory'
  return (isInventory ? str(it.asset_account_qb_id) : null) || str(it.expense_account_qb_id) || str(it.income_account_qb_id)
}

function txnMeta(t: any) {
  const raw = t?.raw_data || {}
  const ent = String(t?.qb_entity_type || t?.txn_type || '')
  const rawPayee = raw.EntityRef || raw.VendorRef || raw.CustomerRef || null
  let payeeType: string | null = null
  if (raw.EntityRef?.type) payeeType = String(raw.EntityRef.type)
  else if (raw.VendorRef) payeeType = 'Vendor'
  else if (raw.CustomerRef) payeeType = 'Customer'
  else if (t?.entity_type) payeeType = String(t.entity_type)
  else if (['Bill', 'VendorCredit', 'BillPayment'].includes(ent)) payeeType = 'Vendor'
  else if (['Invoice', 'CreditMemo', 'SalesReceipt', 'RefundReceipt', 'Payment'].includes(ent)) payeeType = 'Customer'
  return {
    entity_name: str(t.entity_name) || str(rawPayee?.name),
    entity_qb_id: str(t.entity_qb_id) || str(rawPayee?.value),
    entity_type: normalizeEntityType(payeeType),
    department_name: str(t.department_name) || str(raw.DepartmentRef?.name),
    department_qb_id: str(t.department_qb_id) || str(raw.DepartmentRef?.value),
    class_name: str(t.class_name) || str(raw.ClassRef?.name),
    class_qb_id: str(t.class_qb_id) || str(raw.ClassRef?.value),
    memo: String(t.memo || raw.PrivateNote || ''),
  }
}

/** True when `raw_data` is the authoritative, untouched QBO object for this row. */
export function isRawAuthoritative(t: any): boolean {
  const raw = t?.raw_data
  if (!raw || typeof raw !== 'object' || !raw.Id) return false
  if (STALE_RAW_STATUSES.has(String(raw.qbo_sync_status || ''))) return false
  if (String(raw.Id) !== String(t.qb_txn_id || '')) return false
  if (raw.TxnDate && t.txn_date && String(raw.TxnDate) !== String(t.txn_date)) return false
  const rawTotal = raw.TotalAmt ?? raw.Amount
  if (rawTotal !== undefined && Math.abs(Number(rawTotal) - Number(t.total_amount || 0)) > 0.005) return false
  if (t.qb_entity_type === 'Transfer') return Boolean(raw.FromAccountRef && raw.ToAccountRef)
  if (t.qb_entity_type === 'JournalEntry') return Array.isArray(raw.Line)
  return Array.isArray(raw.Line) || ['Payment', 'BillPayment'].includes(String(t.qb_entity_type))
}

/**
 * Statuses that mean the row was edited/created locally after its last QBO snapshot,
 * so `raw_data` no longer describes the row and the normalized fields must be used.
 */
export const STALE_RAW_STATUSES = new Set(['PENDING_QBO_SYNC', 'LOCAL_ONLY', 'LOCAL_EDIT_PENDING'])

/** Marks a row's QBO snapshot as stale after a local edit (keeps Id/SyncToken for the next push). */
export function markRawAsLocallyEdited(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw ?? null
  return { ...raw, qbo_sync_status: 'LOCAL_EDIT_PENDING', local_edited_at: new Date().toISOString() }
}

/** Expands sales lines (including GroupLineDetail bundles). */
function flattenSalesLines(lines: any[]): any[] {
  const out: any[] = []
  for (const l of lines || []) {
    if (l?.DetailType === 'GroupLineDetail' && Array.isArray(l.GroupLineDetail?.Line)) out.push(...flattenSalesLines(l.GroupLineDetail.Line))
    else out.push(l)
  }
  return out
}

function buildFromRaw(t: any, ctx: LedgerContext): Posting[] | null {
  const raw = t.raw_data
  const ent = String(t.qb_entity_type || t.txn_type)
  const meta = txnMeta(t)
  const total = r2(Number(raw.TotalAmt ?? raw.Amount ?? t.total_amount ?? 0))
  const out: Posting[] = []
  const push = (acc: string | null, amount: number, idx: number, isHeader: boolean, extra: Partial<Posting> = {}) => {
    const a = r2(amount)
    if (!acc || a === 0) return
    out.push({
      account_qb_id: acc,
      amount: a,
      line_index: idx,
      is_header: isHeader,
      memo: extra.memo ?? meta.memo,
      entity_name: extra.entity_name ?? meta.entity_name,
      entity_qb_id: extra.entity_qb_id ?? meta.entity_qb_id,
      entity_type: extra.entity_type ?? meta.entity_type,
      customer_name: extra.customer_name ?? null,
      customer_qb_id: extra.customer_qb_id ?? null,
      department_name: extra.department_name ?? meta.department_name,
      department_qb_id: extra.department_qb_id ?? meta.department_qb_id,
      class_name: extra.class_name ?? meta.class_name,
      class_qb_id: extra.class_qb_id ?? meta.class_qb_id,
      item_name: extra.item_name ?? null,
    })
  }
  const lines: any[] = Array.isArray(raw.Line) ? raw.Line : []
  /**
   * Line metadata following QBO semantics:
   * - expense lines keep the transaction payee; `CustomerRef` is the *billable customer*
   * - deposit lines use `DepositLineDetail.Entity` ("Received From")
   * - journal lines use `JournalEntryLineDetail.Entity` (Name column)
   */
  const lineExtra = (l: any, det: any, kind: 'expense' | 'deposit' | 'journal' | 'sales' = 'sales'): Partial<Posting> => {
    let entName: string | null = meta.entity_name
    let entId: string | null = meta.entity_qb_id
    let entType: string | null = meta.entity_type
    if (kind === 'deposit' && det?.Entity) {
      entName = str(det.Entity.name) || str(det.Entity.EntityRef?.name)
      entId = str(det.Entity.value) || str(det.Entity.EntityRef?.value)
      entType = normalizeEntityType(det.Entity.type || det.Entity.Type)
    } else if (kind === 'journal') {
      entName = str(det?.Entity?.EntityRef?.name) || str(det?.Entity?.name) || null
      entId = str(det?.Entity?.EntityRef?.value) || str(det?.Entity?.value) || null
      entType = normalizeEntityType(det?.Entity?.Type || det?.Entity?.type)
    }
    return {
      memo: String(l?.Description || meta.memo || ''),
      entity_name: entName,
      entity_qb_id: entId,
      entity_type: entType,
      customer_name: kind === 'expense' ? str(det?.CustomerRef?.name) : (kind === 'sales' ? meta.entity_name : null),
      customer_qb_id: kind === 'expense' ? str(det?.CustomerRef?.value) : (kind === 'sales' ? meta.entity_qb_id : null),
      class_name: str(det?.ClassRef?.name) || meta.class_name,
      class_qb_id: str(det?.ClassRef?.value) || meta.class_qb_id,
      department_name: str(det?.DepartmentRef?.name) || meta.department_name,
      department_qb_id: str(det?.DepartmentRef?.value) || meta.department_qb_id,
      item_name: str(det?.ItemRef?.name),
    }
  }

  // Expense-side lines (Purchase, Bill, VendorCredit): debit (or credit if reversed) each line
  const expenseLines = (sign: 1 | -1) => {
    lines.forEach((l, i) => {
      if (l?.DetailType === 'AccountBasedExpenseLineDetail') {
        const det = l.AccountBasedExpenseLineDetail || {}
        push(resolveAccountRef(ctx, det.AccountRef), sign * Number(l.Amount || 0), i, false, lineExtra(l, det, 'expense'))
      } else if (l?.DetailType === 'ItemBasedExpenseLineDetail') {
        const det = l.ItemBasedExpenseLineDetail || {}
        push(itemAccount(ctx, det.ItemRef, 'EXPENSE'), sign * Number(l.Amount || 0), i, false, lineExtra(l, det, 'expense'))
      }
    })
  }
  // Sales-side lines (Invoice, SalesReceipt, CreditMemo, RefundReceipt): credit income (sign=-1) or debit (sign=+1)
  const salesLines = (sign: 1 | -1) => {
    flattenSalesLines(lines).forEach((l, i) => {
      if (l?.DetailType === 'SalesItemLineDetail') {
        const det = l.SalesItemLineDetail || {}
        const acc = resolveAccountRef(ctx, det.ItemAccountRef) || itemAccount(ctx, det.ItemRef, 'INCOME')
        push(acc, sign * Number(l.Amount || 0), i, false, lineExtra(l, det))
      } else if (l?.DetailType === 'DiscountLineDetail') {
        const det = l.DiscountLineDetail || {}
        push(resolveAccountRef(ctx, det.DiscountAccountRef), -sign * Number(l.Amount || 0), i, false, lineExtra(l, det))
      }
    })
    const tax = Number(raw.TxnTaxDetail?.TotalTax || 0)
    if (tax) push(ctx.salesTaxPayableId, sign * tax, 9999, false, { memo: 'Sales Tax' })
  }

  switch (ent) {
    case 'Purchase': {
      const credit = raw.Credit === true
      push(resolveAccountRef(ctx, raw.AccountRef), credit ? total : -total, -1, true)
      expenseLines(credit ? -1 : 1)
      return out
    }
    case 'Deposit': {
      push(resolveAccountRef(ctx, raw.DepositToAccountRef), total, -1, true)
      if (raw.CashBack && Number(raw.CashBack.Amount || 0)) {
        push(resolveAccountRef(ctx, raw.CashBack.AccountRef), Number(raw.CashBack.Amount), 9998, false, { memo: String(raw.CashBack.Memo || 'Cash back') })
      }
      lines.forEach((l, i) => {
        const det = l.DepositLineDetail || {}
        let acc: string | null = null
        if (Array.isArray(l.LinkedTxn) && l.LinkedTxn.length > 0) {
          const lt = l.LinkedTxn[0]
          const linkedAcc = ctx.txnAccountByKey?.get(`${lt.TxnType}:${lt.TxnId}`)
          acc = (linkedAcc && ctx.accounts.has(linkedAcc) ? linkedAcc : null) || ctx.undepositedFundsId
        } else {
          acc = resolveAccountRef(ctx, det.AccountRef)
        }
        push(acc, -Number(l.Amount || 0), i, false, lineExtra(l, det, 'deposit'))
      })
      return out
    }
    case 'Transfer': {
      push(resolveAccountRef(ctx, raw.FromAccountRef), -total, 0, true)
      push(resolveAccountRef(ctx, raw.ToAccountRef), total, 1, false)
      return out
    }
    case 'JournalEntry': {
      lines.forEach((l, i) => {
        const det = l.JournalEntryLineDetail || {}
        const isDebit = String(det.PostingType || 'Debit') === 'Debit'
        push(resolveAccountRef(ctx, det.AccountRef), isDebit ? Number(l.Amount || 0) : -Number(l.Amount || 0), i, false, lineExtra(l, det, 'journal'))
      })
      return out
    }
    case 'Bill': {
      push(resolveAccountRef(ctx, raw.APAccountRef) || ctx.defaultApId, -total, -1, true)
      expenseLines(1)
      return out
    }
    case 'VendorCredit': {
      push(resolveAccountRef(ctx, raw.APAccountRef) || ctx.defaultApId, total, -1, true)
      expenseLines(-1)
      return out
    }
    case 'BillPayment': {
      const bankRef = raw.CheckPayment?.BankAccountRef || raw.CreditCardPayment?.CCAccountRef
      push(resolveAccountRef(ctx, bankRef) || str(t.account_qb_id), -total, -1, true)
      push(resolveAccountRef(ctx, raw.APAccountRef) || ctx.defaultApId, total, 0, false)
      return out
    }
    case 'Invoice': {
      push(resolveAccountRef(ctx, raw.ARAccountRef) || ctx.defaultArId, total, -1, true)
      salesLines(-1)
      return out
    }
    case 'SalesReceipt': {
      push(resolveAccountRef(ctx, raw.DepositToAccountRef) || ctx.undepositedFundsId, total, -1, true)
      salesLines(-1)
      return out
    }
    case 'CreditMemo': {
      push(resolveAccountRef(ctx, raw.ARAccountRef) || ctx.defaultArId, -total, -1, true)
      salesLines(1)
      return out
    }
    case 'RefundReceipt': {
      push(resolveAccountRef(ctx, raw.DepositToAccountRef) || str(t.account_qb_id), -total, -1, true)
      salesLines(1)
      return out
    }
    case 'Payment': {
      push(resolveAccountRef(ctx, raw.DepositToAccountRef) || ctx.undepositedFundsId, total, -1, true)
      push(resolveAccountRef(ctx, raw.ARAccountRef) || ctx.defaultArId, -total, 0, false)
      return out
    }
    case 'Estimate':
    case 'PurchaseOrder':
      return []
    default:
      return null
  }
}

function buildFromNormalized(t: any, ctx: LedgerContext): Posting[] {
  const tType = String(t.txn_type || 'Check')
  if (tType === 'Estimate' || tType === 'PurchaseOrder' || t.direction === 'NON_POSTING') return []
  const meta = txnMeta(t)
  const total = r2(Number(t.total_amount || 0))
  const out: Posting[] = []
  const isExpenseSide = ['Check', 'Expense', 'CreditCardExpense', 'CreditCardCredit', 'Bill', 'VendorCredit', 'BillPayment'].includes(tType)
  const lineNamed = ['Deposit', 'JournalEntry'].includes(tType)
  const push = (acc: string | null, amount: number, idx: number, isHeader: boolean, l?: any) => {
    const a = r2(amount)
    if (!acc || a === 0) return
    // Expense lines keep the transaction payee (line names there are billable customers, like QBO)
    const useLineName = lineNamed && !isHeader && Boolean(l?.entity_name)
    out.push({
      account_qb_id: acc,
      amount: a,
      line_index: idx,
      is_header: isHeader,
      memo: String(l?.description || meta.memo || ''),
      entity_name: useLineName ? str(l?.entity_name) : (meta.entity_name || (!isExpenseSide ? str(l?.entity_name) : null)),
      entity_qb_id: useLineName ? str(l?.entity_qb_id) : (meta.entity_qb_id || (!isExpenseSide ? str(l?.entity_qb_id) : null)),
      entity_type: useLineName ? normalizeEntityType(l?.entity_type) : meta.entity_type,
      customer_name: isExpenseSide ? str(l?.entity_name) : (['Invoice', 'CreditMemo', 'SalesReceipt', 'RefundReceipt'].includes(tType) ? meta.entity_name : null),
      customer_qb_id: isExpenseSide ? str(l?.entity_qb_id) : (['Invoice', 'CreditMemo', 'SalesReceipt', 'RefundReceipt'].includes(tType) ? meta.entity_qb_id : null),
      department_name: str(l?.department_name) || meta.department_name,
      department_qb_id: str(l?.department_qb_id) || meta.department_qb_id,
      class_name: str(l?.class_name) || meta.class_name,
      class_qb_id: str(l?.class_qb_id) || meta.class_qb_id,
      item_name: str(l?.item_name),
    })
  }
  const rawLines: any[] = Array.isArray(t.line_items) ? t.line_items : []
  const lines: any[] = rawLines.length > 0
    ? rawLines
    : (t.to_account_qb_id || t.to_account_name) ? [{ account_qb_id: t.to_account_qb_id, account_name: t.to_account_name, amount: total }] : []

  const lineAccount = (l: any, mode: 'INCOME' | 'EXPENSE' | 'DEPOSIT' | 'AR' | 'AP'): string | null => {
    const direct = resolveAccountByIdOrName(ctx, l?.account_qb_id, l?.account_name)
    if (direct && ctx.accounts.has(direct)) return direct
    if (l?.item_qb_id || l?.item_name) {
      const viaItem = itemAccount(ctx, { value: l.item_qb_id, name: l.item_name }, mode === 'INCOME' ? 'INCOME' : 'EXPENSE')
      if (viaItem) return viaItem
    }
    if (mode === 'DEPOSIT' && (l?.linked_txn_id || l?.linked_txn_type)) {
      const linkedAcc = ctx.txnAccountByKey?.get(`${l.linked_txn_type || 'Payment'}:${l.linked_txn_id}`)
      return (linkedAcc && ctx.accounts.has(linkedAcc) ? linkedAcc : null) || ctx.undepositedFundsId
    }
    if (mode === 'AR') return ctx.defaultArId
    if (mode === 'AP') return ctx.defaultApId
    return direct
  }
  const header = (fallback: string | null) => resolveAccountByIdOrName(ctx, t.account_qb_id, t.account_name) || fallback

  switch (tType) {
    case 'Transfer':
      push(header(null), -total, 0, true)
      push(resolveAccountByIdOrName(ctx, t.to_account_qb_id, t.to_account_name), total, 1, false)
      return out
    case 'PayDownCreditCard':
      push(header(null), -total, -1, true)
      push(resolveAccountByIdOrName(ctx, t.to_account_qb_id, t.to_account_name) || lineAccount(lines[0], 'EXPENSE'), total, 0, false)
      return out
    case 'JournalEntry':
      lines.forEach((l, i) => {
        const isDebit = String(l?.posting_type || 'Debit') === 'Debit'
        push(lineAccount(l, 'EXPENSE'), isDebit ? Number(l.amount || 0) : -Number(l.amount || 0), i, false, l)
      })
      return out
    case 'Deposit':
    case 'SalesReceipt': {
      push(header(tType === 'SalesReceipt' ? ctx.undepositedFundsId : null), total, -1, true)
      lines.forEach((l, i) => {
        const amt = Number(l?.amount || 0)
        if (l?.detail_type === 'CashBackLineDetail') { push(lineAccount(l, 'DEPOSIT'), Math.abs(amt), i, false, l); return }
        push(lineAccount(l, tType === 'SalesReceipt' ? 'INCOME' : 'DEPOSIT'), -amt, i, false, l)
      })
      return out
    }
    case 'Payment': {
      push(header(ctx.undepositedFundsId), total, -1, true)
      const candArId = resolveAccountByIdOrName(ctx, t.to_account_qb_id, t.to_account_name)
      const candArAcc = candArId ? ctx.accounts.get(candArId) : null
      const arId = candArAcc && (candArAcc.account_type === 'Accounts Receivable' || String(candArAcc.account_sub_type || '').includes('AccountsReceivable'))
        ? candArId
        : ctx.defaultArId
      push(arId || ctx.defaultArId, -total, 0, false)
      return out
    }
    case 'Invoice':
      push(header(ctx.defaultArId), total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'INCOME'), -Number(l?.amount || 0), i, false, l))
      return out
    case 'CreditMemo':
      push(header(ctx.defaultArId), -total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'INCOME'), Number(l?.amount || 0), i, false, l))
      return out
    case 'RefundReceipt':
      push(header(null), -total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'INCOME'), Number(l?.amount || 0), i, false, l))
      return out
    case 'Bill':
      push(header(ctx.defaultApId), -total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'EXPENSE'), Number(l?.amount || 0), i, false, l))
      return out
    case 'VendorCredit':
      push(header(ctx.defaultApId), total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'EXPENSE'), -Number(l?.amount || 0), i, false, l))
      return out
    case 'BillPayment': {
      push(header(null), -total, -1, true)
      const candApId = resolveAccountByIdOrName(ctx, t.to_account_qb_id, t.to_account_name)
      const candApAcc = candApId ? ctx.accounts.get(candApId) : null
      const apId = candApAcc && (candApAcc.account_type === 'Accounts Payable' || String(candApAcc.account_sub_type || '').includes('AccountsPayable'))
        ? candApId
        : ctx.defaultApId
      push(apId || ctx.defaultApId, total, 0, false)
      return out
    }
    case 'CreditCardCredit':
      push(header(null), total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'EXPENSE'), -Number(l?.amount || 0), i, false, l))
      return out
    case 'Check':
    case 'Expense':
    case 'CreditCardExpense':
    default:
      push(header(null), -total, -1, true)
      lines.forEach((l, i) => push(lineAccount(l, 'EXPENSE'), Number(l?.amount || 0), i, false, l))
      return out
  }
}

/** Returns the double-entry postings (debit-positive) of one transaction. Voided rows return []. */
export function buildTxnPostings(t: any, ctx: LedgerContext): Posting[] {
  if (!t || t.is_voided) return []
  if (isRawAuthoritative(t)) {
    const fromRaw = buildFromRaw(t, ctx)
    if (fromRaw) return fromRaw
  }
  return buildFromNormalized(t, ctx)
}

/** Aggregates postings into an account -> debit-positive delta map (filtered to known accounts). */
export function postingsToDeltaMap(postings: Posting[], ctx: LedgerContext, multiplier: 1 | -1 = 1): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of postings) {
    if (!ctx.accounts.has(p.account_qb_id)) continue
    m.set(p.account_qb_id, r2((m.get(p.account_qb_id) || 0) + p.amount * multiplier))
  }
  for (const [k, v] of m.entries()) if (Math.abs(v) < 0.0001) m.delete(k)
  return m
}

/** Sum of debits minus credits of a posting set (0 when balanced). */
export function postingImbalance(postings: Posting[]): number {
  return r2(postings.reduce((s, p) => s + p.amount, 0))
}

/** First day of the fiscal year that contains `date` (YYYY-MM-DD). */
export function fiscalYearStart(date: string, fiscalStartMonth: string | number = 'January'): string {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const asNum = Number(fiscalStartMonth)
  let m = Number.isFinite(asNum) && asNum >= 1 && asNum <= 12
    ? asNum
    : months.indexOf(String(fiscalStartMonth || 'January').toLowerCase().trim()) + 1
  if (!m || m < 1 || m > 12) m = 1
  const [y, mo] = date.split('-').map(Number)
  const year = mo >= m ? y : y - 1
  return `${year}-${String(m).padStart(2, '0')}-01`
}

export function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
