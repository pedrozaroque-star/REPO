/**
 * @module api/external-accounting/reports
 * @description Motor de generación de Reportes Financieros Avanzados para la Contadora (CPA)
 * del módulo CONTABILIDAD EXTERNA (Raquel Velazquez).
 *
 * @businessRules
 * - Soporta cálculo dinámico en vivo por rango de fechas (`startDate`, `endDate`) y método contable (`Accrual` vs `Cash`):
 *   1. `pnl`: Estado de Resultados (Profit & Loss) + comparativo multianual.
 *   2. `balance_sheet`: Balance General (Activos, Pasivos y Capital).
 *   3. `bank_register`: Auxiliar Bancario con Saldo Acumulado (Running Balance).
 *   4. `general_ledger`: Libro Mayor detallado cuenta por cuenta.
 *   5. `trial_balance`: Balanza de Comprobación (Cargos vs Abonos).
 *   6. `vendor_expenses`: Resumen de Salidas por Proveedor (Auditoría 1099 / Contadora).
 *   7. `customer_income`: Resumen de Entradas por Cliente / Arrendatario.
 *   8. `check_detail`: Reporte Detallado de Cheques Emitidos.
 *   9. `deposit_detail`: Reporte Detallado de Depósitos Bancarios.
 *   10. `qbo_archive`: Visor de Reportes Oficiales Históricos respaldados de Intuit QBO.
 *   11. `account_quickreport`: Transaction Report / Drill-Down por cuenta, grupo, lista o contacto.
 *
 * @dataFlow
 * Client (/admin/contabilidad-externa) -> GET /api/external-accounting/reports -> Supabase
 * Todas las cifras salen del Libro Mayor en partida doble (`lib/external-accounting-ledger.ts`).
 *
 * @notes
 * - 2026-10-28 (auditoría en vivo contra QBO V3 de las 6 empresas conectadas): se reescribieron P&L, Balance Sheet,
 *   Trial Balance, General Ledger, Bank Register, Expenses by Vendor / Income by Customer y el Transaction Report
 *   sobre el motor de pólizas. Errores corregidos: Total Liabilities salía negativo; préstamos al corte desfasados
 *   (los pagos posteriores se revertían con signo invertido); Retained Earnings en $0 y "Net Income" como cifra de
 *   cuadre; depósitos a cuentas de Balance (préstamos, Cash on hand) contados como Ingreso; Trial Balance sin cuentas
 *   de Resultados y con pasivos del lado deudor; Expenses by Vendor sumaba pagos de facturas y abonos a capital.
 * - Convención de montos de salida: signo de presentación QBO (pasivos, capital e ingresos en positivo).
 * - Paginación PostgREST siempre ordenada por `txn_date` + `id` (sin orden, las páginas pueden repetir o saltar filas).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeExternalAccounting } from '@/lib/external-accounting-auth'
import {
  buildLedgerContext,
  buildTxnPostings,
  isRawAuthoritative,
  isBalanceSheetAccountType,
  isProfitLossAccount,
  isIncomeAccount,
  isExpenseAccount,
  toNaturalBalance,
  fiscalYearStart,
  dayBefore,
  type Posting,
} from '@/lib/external-accounting-ledger'

export const dynamic = 'force-dynamic'

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function fetchAllTxns(
  supabase: ReturnType<typeof getAdminSupabase>,
  realmId: string,
  startDate?: string | null,
  endDate?: string | null
) {
  const rows: any[] = []
  let from = 0
  const step = 1000
  while (true) {
    let q = supabase
      .from('external_accounting_transactions')
      .select('*')
      .eq('company_realm_id', realmId)
      .order('txn_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + step - 1)

    if (startDate) q = q.gte('txn_date', startDate)
    if (endDate) q = q.lte('txn_date', endDate)

    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < step) break
    from += step
  }
  return rows
}

function flattenQboReportRows(rows: any[] = [], depth = 0, out: any[] = []): any[] {
  for (const r of rows) {
    if (r.Header?.ColData) {
      out.push({
        rowType: 'section_header',
        depth,
        cells: r.Header.ColData.map((c: any) => c.value ?? '')
      })
    }
    if (r.type === 'Data' && r.ColData) {
      out.push({
        rowType: 'data',
        depth,
        cells: r.ColData.map((c: any) => c.value ?? '')
      })
    }
    if (r.Rows?.Row) {
      flattenQboReportRows(r.Rows.Row, depth + 1, out)
    }
    if (r.Summary?.ColData) {
      out.push({
        rowType: 'summary',
        depth,
        cells: r.Summary.ColData.map((c: any) => c.value ?? '')
      })
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()

    // Strict Backend Authorization (Fail-Closed)
    const auth = await authorizeExternalAccounting(req, supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(req.url)

    const realmId = (searchParams.get('realmId') || '').trim()
    const reportType = searchParams.get('reportType') || 'pnl'
    const startDate = searchParams.get('startDate') || null
    const endDate = searchParams.get('endDate') || null
    const basis = (searchParams.get('basis') || 'Accrual') as 'Accrual' | 'Cash'
    const accountId = searchParams.get('accountId') || 'ALL'
    const qboArchiveKey = searchParams.get('qboArchiveKey') || searchParams.get('reportKey') || 'ProfitAndLoss_ByYear_Accrual'

    if (!realmId) {
      return NextResponse.json({ error: 'Missing realmId' }, { status: 400 })
    }

    // Fetch company, accounts, contacts, items, and available archive keys
    const [compRes, accRes, conRes, itemsRes, archListRes] = await Promise.all([
      supabase.from('external_accounting_companies').select('*').eq('realm_id', realmId).maybeSingle(),
      supabase.from('external_accounting_accounts').select('*').eq('company_realm_id', realmId).order('name'),
      supabase.from('external_accounting_contacts').select('*').eq('company_realm_id', realmId).order('display_name'),
      supabase.from('external_accounting_items').select('*').eq('company_realm_id', realmId).order('name'),
      supabase.from('external_accounting_reports_archive').select('report_key, report_title, accounting_method, start_date, end_date').eq('company_realm_id', realmId).order('report_key')
    ])

    const company = compRes.data
    if (!company) {
      return NextResponse.json({ error: `Empresa no encontrada para realmId: ${realmId}` }, { status: 404 })
    }
    const accounts = accRes.data || []
    const contacts = conRes.data || []
    const items = itemsRes.data || []
    const availableArchives = archListRes.data || []

    const accountTypeMap = new Map<string, any>()
    const accountNameMap = new Map<string, any>()
    for (const a of accounts) {
      accountTypeMap.set(String(a.qb_account_id), a)
      if (a.name) accountNameMap.set(String(a.name).toLowerCase(), a)
      if (a.fully_qualified_name) accountNameMap.set(String(a.fully_qualified_name).toLowerCase(), a)
    }

    const itemByIdMap = new Map<string, any>()
    const itemByNameMap = new Map<string, any>()
    for (const it of items) {
      itemByIdMap.set(String(it.qb_item_id), it)
      if (it.name) itemByNameMap.set(String(it.name).toLowerCase(), it)
      if (it.fully_qualified_name) itemByNameMap.set(String(it.fully_qualified_name).toLowerCase(), it)
    }

    const BALANCE_SHEET_TYPES = new Set([
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

    const isBalanceSheetAccount = (acc: any): boolean => {
      if (!acc) return false
      if (BALANCE_SHEET_TYPES.has(acc.account_type)) return true
      if (['Asset', 'Liability', 'Equity'].includes(acc.classification || '')) return true
      return false
    }

    const resolveLineAccount = (t: any, l: any, mode: 'INCOME' | 'EXPENSE' | 'ANY' = 'ANY'): { acc: any | null; categoryName: string } => {
      // 1. Direct account_qb_id match
      if (l?.account_qb_id && accountTypeMap.has(String(l.account_qb_id))) {
        const acc = accountTypeMap.get(String(l.account_qb_id))
        return { acc, categoryName: acc.fully_qualified_name || acc.name }
      }
      // 2. Item reference (ItemRef -> IncomeAccountRef / ExpenseAccountRef in Chart of Accounts)
      const itemId = l?.item_qb_id || l?.item_id
      const itemName = l?.item_name || l?.account_name
      const matchedItem =
        (itemId && itemByIdMap.get(String(itemId))) ||
        (itemName && itemByNameMap.get(String(itemName).toLowerCase())) ||
        null

      if (matchedItem) {
        const targetAccId =
          mode === 'EXPENSE'
            ? (matchedItem.expense_account_qb_id || matchedItem.income_account_qb_id)
            : (matchedItem.income_account_qb_id || matchedItem.expense_account_qb_id)
        const targetAccName =
          mode === 'EXPENSE'
            ? (matchedItem.expense_account_name || matchedItem.income_account_name)
            : (matchedItem.income_account_name || matchedItem.expense_account_name)

        if (targetAccId && accountTypeMap.has(String(targetAccId))) {
          const acc = accountTypeMap.get(String(targetAccId))
          return { acc, categoryName: acc.fully_qualified_name || acc.name }
        }
        if (targetAccName && accountNameMap.has(String(targetAccName).toLowerCase())) {
          const acc = accountNameMap.get(String(targetAccName).toLowerCase())
          return { acc, categoryName: acc.fully_qualified_name || acc.name }
        }
        if (targetAccName) {
          return { acc: null, categoryName: targetAccName }
        }
      }

      // 3. Direct account_name or fully_qualified_name match in Chart of Accounts
      const rawCat = String(l?.account_name || t?.to_account_name || t?.category_summary || '').trim()
      if (rawCat && accountNameMap.has(rawCat.toLowerCase())) {
        const acc = accountNameMap.get(rawCat.toLowerCase())
        return { acc, categoryName: acc.fully_qualified_name || acc.name }
      }
      // Also check leaf name if rawCat has colon hierarchy (e.g. "Parent:Child")
      if (rawCat.includes(':')) {
        const leaf = rawCat.split(':').pop()?.trim() || ''
        if (leaf && accountNameMap.has(leaf.toLowerCase())) {
          const acc = accountNameMap.get(leaf.toLowerCase())
          return { acc, categoryName: acc.fully_qualified_name || acc.name }
        }
      }

      return { acc: null, categoryName: rawCat || (mode === 'INCOME' ? 'Operating Income' : 'Operating Expense') }
    }

    // -------------------------------------------------------------------------
    // MODE A: OFFICIAL QBO ARCHIVE SNAPSHOT
    // -------------------------------------------------------------------------
    if (reportType === 'qbo_archive') {
      const { data: arch } = await supabase
        .from('external_accounting_reports_archive')
        .select('*')
        .eq('company_realm_id', realmId)
        .eq('report_key', qboArchiveKey)
        .maybeSingle()

      if (!arch || !arch.report_data) {
        return NextResponse.json({
          reportType,
          company,
          availableArchives,
          archiveReport: null
        })
      }

      const repData = arch.report_data
      const columns = (repData?.Columns?.Column || []).map((c: any) => c.ColTitle || '')
      const flatRows = flattenQboReportRows(repData?.Rows?.Row || [])

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        archiveReport: {
          key: arch.report_key,
          title: repData?.Header?.ReportName || arch.report_title,
          basis: repData?.Header?.ReportBasis || arch.accounting_method,
          startPeriod: repData?.Header?.StartPeriod || arch.start_date,
          endPeriod: repData?.Header?.EndPeriod || arch.end_date,
          currency: repData?.Header?.Currency || 'USD',
          columns,
          rows: flatRows,
        }
      })
    }

    // -------------------------------------------------------------------------
    // LIBRO MAYOR (GENERAL LEDGER) EN PARTIDA DOBLE — fuente única de todos los reportes
    // Se carga el historial COMPLETO de la empresa una sola vez y cada transacción se convierte en
    // sus pólizas (`postings`, débito positivo) con `lib/external-accounting-ledger.ts`, igual que QBO.
    // -------------------------------------------------------------------------
    const allTxns = await fetchAllTxns(supabase, realmId)
    const ledgerCtx = buildLedgerContext(accounts, items, allTxns)
    const fiscalStartMonth = company?.metadata?.fiscal_year_start_month || 'January'
    const todayLA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
    const asOfDate = endDate || todayLA
    const inRange = (d: string) => (!startDate || d >= startDate) && (!endDate || d <= endDate)
    const txns = allTxns.filter(t => inRange(String(t.txn_date || '')))
    const activeTxns = txns.filter(t => !t.is_voided)
    const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

    const postingCache = new Map<string, Posting[]>()
    const postingsOf = (t: any): Posting[] => {
      const key = String(t.id)
      let p = postingCache.get(key)
      if (!p) {
        p = buildTxnPostings(t, ledgerCtx)
        postingCache.set(key, p)
      }
      return p
    }
    const accName = (id: string | null | undefined) => {
      const a = id ? ledgerCtx.accounts.get(String(id)) : null
      return a ? (a.fully_qualified_name || a.name || String(id)) : (id ? String(id) : '—')
    }
    /** QBO "Split" column: the other side of the posting (single account name or "-Split-"). */
    const splitLabel = (t: any, accountId: string) => {
      const others = Array.from(new Set(postingsOf(t).filter(p => p.account_qb_id !== accountId).map(p => p.account_qb_id)))
      if (others.length === 0) return '—'
      if (others.length === 1) return accName(others[0])
      return '-Split-'
    }
    const retainedEarningsIds = new Set(
      accounts.filter((a: any) => a.account_sub_type === 'RetainedEarnings').map((a: any) => String(a.qb_account_id))
    )

    /** Balance Sheet balances (debit-positive) as of `date`, anchored on QBO CurrentBalance and rolled back. */
    const balanceAsOf = (date: string | null): Map<string, number> => {
      const m = new Map<string, number>()
      for (const a of accounts) m.set(String(a.qb_account_id), Number(a.current_balance || 0))
      if (!date) return m
      for (const t of allTxns) {
        if (t.is_voided || !(String(t.txn_date || '') > date)) continue
        for (const p of postingsOf(t)) {
          if (m.has(p.account_qb_id)) m.set(p.account_qb_id, r2((m.get(p.account_qb_id) || 0) - p.amount))
        }
      }
      return m
    }

    /** Sum of postings (debit-positive) per account between two dates (inclusive; null = open). */
    const activityBetween = (from: string | null, to: string | null): Map<string, number> => {
      const m = new Map<string, number>()
      for (const t of allTxns) {
        const d = String(t.txn_date || '')
        if (t.is_voided || (from && d < from) || (to && d > to)) continue
        for (const p of postingsOf(t)) m.set(p.account_qb_id, r2((m.get(p.account_qb_id) || 0) + p.amount))
      }
      return m
    }

    /**
     * QBO equity roll-forward as of `date`:
     * - Net Income = fiscal-year-to-date P&L.
     * - Retained Earnings = all P&L of prior fiscal years + entries posted directly to Retained Earnings.
     * (Verified against the QBO Trial Balance / Balance Sheet API for several dates.)
     */
    const equityRollForward = (date: string) => {
      const fys = fiscalYearStart(date, fiscalStartMonth)
      let plBefore = 0
      let plYtd = 0
      let rePosted = 0
      for (const t of allTxns) {
        const d = String(t.txn_date || '')
        if (t.is_voided || d > date) continue
        for (const p of postingsOf(t)) {
          const acc = ledgerCtx.accounts.get(p.account_qb_id)
          if (isProfitLossAccount(acc)) {
            if (d < fys) plBefore += p.amount
            else plYtd += p.amount
          }
          if (retainedEarningsIds.has(p.account_qb_id)) rePosted += p.amount
        }
      }
      return {
        fiscalYearStart: fys,
        netIncome: r2(-plYtd),
        retainedEarnings: r2(-(plBefore + rePosted)),
        retainedEarningsDebitPositive: r2(plBefore + rePosted),
      }
    }

    // Backwards-compatible helper used by the drill-down engine
    const computeBalancesAsOfEndDate = async (): Promise<Map<string, number>> => balanceAsOf(endDate)

    /** Builds a QBO-style transaction row for a posting (amount already in presentation sign). */
    const postingRow = (t: any, p: Posting, amount: number, accountId: string) => ({
      id: t.id,
      qb_txn_id: t.qb_txn_id,
      txn_date: t.txn_date,
      txn_type: t.txn_type,
      doc_number: t.doc_number || '',
      entity_name: p.entity_name || t.entity_name || '—',
      department_name: p.department_name || t.department_name || '',
      location_name: p.department_name || t.department_name || '',
      class_name: p.class_name || t.class_name || '',
      memo: p.memo || t.memo || '',
      account_qb_id: t.account_qb_id || accountId,
      account_name: accName(accountId),
      to_account_qb_id: t.to_account_qb_id || null,
      to_account_name: t.to_account_name || null,
      category_summary: t.category_summary || splitLabel(t, accountId),
      split_account: splitLabel(t, accountId),
      item_name: p.item_name || '',
      amount: r2(amount),
      total_amount: r2(Number(t.total_amount ?? Math.abs(amount))),
      line_items: Array.isArray(t.line_items) ? t.line_items : [],
      payment_method: t.payment_type || '',
      is_voided: Boolean(t.is_voided),
      year: String(t.txn_date || '').slice(0, 4),
      cleared_status: t.cleared_status || 'Cleared',
    })

    /**
     * Unified Accrual / Cash P&L posting iterator used by P&L, Expenses by Vendor, and Income by Customer.
     * Implements QBO Cash-Basis recognition, including prepayment recognition/reversal on
     * Unapplied Cash Payment Income / Unapplied Cash Bill Payment Expense when payDate < srcDate.
     */
    const forEachPlPosting = (cb: (acc: any, p: Posting, effectiveTxn: any, sourceTxn?: any) => void) => {
      if (basis === 'Cash') {
        const byKey = new Map<string, any>()
        for (const t of allTxns) byKey.set(`${t.qb_entity_type || t.txn_type}:${t.qb_txn_id}`, t)
        const NON_CASH = new Set(['Invoice', 'CreditMemo', 'Bill', 'VendorCredit', 'Estimate', 'PurchaseOrder'])
        const unappliedIncomeAcc = accounts.find((a: any) =>
          a.account_sub_type === 'UnappliedCashPaymentIncome' ||
          String(a.name || '').toLowerCase() === 'unapplied cash payment income'
        )
        const unappliedExpenseAcc = accounts.find((a: any) =>
          a.account_sub_type === 'UnappliedCashBillPaymentExpense' ||
          String(a.name || '').toLowerCase() === 'unapplied cash bill payment expense'
        )
        const linksOf = (t: any): Array<{ type: string; id: string; amount: number }> => {
          const raw = t.raw_data
          if (isRawAuthoritative(t) && Array.isArray(raw?.Line)) {
            return raw.Line
              .filter((l: any) => Array.isArray(l.LinkedTxn) && l.LinkedTxn[0]?.TxnId)
              .map((l: any) => ({ type: String(l.LinkedTxn[0].TxnType), id: String(l.LinkedTxn[0].TxnId), amount: Number(l.Amount || 0) }))
          }
          return (Array.isArray(t.line_items) ? t.line_items : [])
            .filter((l: any) => l.linked_txn_id)
            .map((l: any) => ({ type: String(l.linked_txn_type || (t.txn_type === 'BillPayment' ? 'Bill' : 'Invoice')), id: String(l.linked_txn_id), amount: Number(l.amount || 0) }))
        }
        // 1. Direct cash transactions in active date range
        for (const t of activeTxns) {
          if (NON_CASH.has(t.txn_type) || t.txn_type === 'Payment' || t.txn_type === 'BillPayment' || t.direction === 'NON_POSTING') continue
          for (const p of postingsOf(t)) {
            const acc = ledgerCtx.accounts.get(p.account_qb_id)
            if (isProfitLossAccount(acc)) cb(acc, p, t)
          }
        }
        // 2. Payments & BillPayments across allTxns (handles both normal payDate >= srcDate and prepayments payDate < srcDate)
        for (const t of allTxns) {
          if (t.is_voided || t.direction === 'NON_POSTING') continue
          if (t.txn_type !== 'Payment' && t.txn_type !== 'BillPayment') continue
          const payDate = String(t.txn_date || '')
          const isBillPay = t.txn_type === 'BillPayment'
          const unappliedAcc = isBillPay ? unappliedExpenseAcc : unappliedIncomeAcc
          for (const link of linksOf(t)) {
            const src = byKey.get(`${link.type}:${link.id}`)
            if (!src || src.is_voided) continue
            const srcDate = String(src.txn_date || '')
            const srcTotal = Number(src.total_amount || 0)
            if (!srcTotal || !link.amount) continue
            const ratio = link.amount / srcTotal
            if (payDate >= srcDate) {
              if (!inRange(payDate)) continue
              for (const p of postingsOf(src)) {
                const acc = ledgerCtx.accounts.get(p.account_qb_id)
                if (!isProfitLossAccount(acc)) continue
                cb(acc, { ...p, amount: p.amount * ratio }, t, src)
              }
            } else {
              // Prepayment (payDate < srcDate): QBO books Unapplied Cash Payment Income on payDate,
              // then reverses it and recognizes the invoice/bill P&L lines on srcDate.
              if (inRange(payDate) && unappliedAcc) {
                const entName = src.entity_name || t.entity_name || null
                const entId = src.entity_id || t.entity_id || null
                cb(unappliedAcc, {
                  account_qb_id: String(unappliedAcc.qb_account_id),
                  amount: isBillPay ? link.amount : -link.amount,
                  line_index: 0,
                  is_header: false,
                  memo: String(t.memo || src.memo || ''),
                  entity_type: isBillPay ? 'Vendor' : 'Customer',
                  entity_qb_id: entId ? String(entId) : null,
                  entity_name: entName ? String(entName) : null,
                  customer_qb_id: !isBillPay && entId ? String(entId) : null,
                  customer_name: !isBillPay && entName ? String(entName) : null,
                  department_qb_id: t.department_id || src.department_id || null,
                  department_name: t.department_name || src.department_name || null,
                  class_qb_id: t.class_id || src.class_id || null,
                  class_name: t.class_name || src.class_name || null,
                  item_name: null,
                }, t, src)
              }
              if (inRange(srcDate)) {
                for (const p of postingsOf(src)) {
                  const acc = ledgerCtx.accounts.get(p.account_qb_id)
                  if (!isProfitLossAccount(acc)) continue
                  cb(acc, { ...p, amount: p.amount * ratio }, src, t)
                }
                if (unappliedAcc) {
                  const entName = src.entity_name || t.entity_name || null
                  const entId = src.entity_id || t.entity_id || null
                  cb(unappliedAcc, {
                    account_qb_id: String(unappliedAcc.qb_account_id),
                    amount: isBillPay ? -link.amount : link.amount,
                    line_index: 0,
                    is_header: false,
                    memo: String(src.memo || t.memo || ''),
                    entity_type: isBillPay ? 'Vendor' : 'Customer',
                    entity_qb_id: entId ? String(entId) : null,
                    entity_name: entName ? String(entName) : null,
                    customer_qb_id: !isBillPay && entId ? String(entId) : null,
                    customer_name: !isBillPay && entName ? String(entName) : null,
                    department_qb_id: src.department_id || t.department_id || null,
                    department_name: src.department_name || t.department_name || null,
                    class_qb_id: src.class_id || t.class_id || null,
                    class_name: src.class_name || t.class_name || null,
                    item_name: null,
                  }, src, t)
                }
              }
            }
          }
        }
      } else {
        for (const t of activeTxns) {
          for (const p of postingsOf(t)) {
            const acc = ledgerCtx.accounts.get(p.account_qb_id)
            if (isProfitLossAccount(acc)) cb(acc, p, t)
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 1. PROFIT & LOSS (ESTADO DE RESULTADOS) — ESTRUCTURA QBO + DRILL-DOWN POR RENGLÓN
    //    Income · Cost of Goods Sold · Gross Profit · Expenses · Net Operating Income ·
    //    Other Income · Other Expenses · Net Other Income · Net Income
    // -------------------------------------------------------------------------
    if (reportType === 'pnl') {
      type PnlSectionKey = 'income' | 'cogs' | 'expenses' | 'other_income' | 'other_expenses'
      const sectionOf = (acc: any): PnlSectionKey => {
        switch (acc?.account_type) {
          case 'Income': return 'income'
          case 'Other Income': return 'other_income'
          case 'Cost of Goods Sold': return 'cogs'
          case 'Other Expense': return 'other_expenses'
          default: return isIncomeAccount(acc) ? 'income' : 'expenses'
        }
      }
      const rowsByAcc = new Map<string, {
        category: string
        name: string
        account_qb_id: string
        parent_qb_id: string | null
        account_type: string
        section: PnlSectionKey
        amount: number
        count: number
        byYear: Record<string, number>
        transactions: any[]
      }>()
      const yearsSet = new Set<string>()

      const addPl = (acc: any, naturalAmt: number, t: any, p: Posting, sourceTxn?: any) => {
        if (!acc || Math.abs(naturalAmt) < 0.000001) return
        const id = String(acc.qb_account_id)
        const yr = String(t.txn_date || '').slice(0, 4) || 'Unknown'
        yearsSet.add(yr)
        let row = rowsByAcc.get(id)
        if (!row) {
          row = {
            category: acc.fully_qualified_name || acc.name || id,
            name: acc.name || acc.fully_qualified_name || id,
            account_qb_id: id,
            parent_qb_id: acc.parent_qb_id ? String(acc.parent_qb_id) : null,
            account_type: acc.account_type || '',
            section: sectionOf(acc),
            amount: 0,
            count: 0,
            byYear: {},
            transactions: [],
          }
          rowsByAcc.set(id, row)
        }
        row.amount = r2(row.amount + naturalAmt)
        row.count++
        row.byYear[yr] = r2((row.byYear[yr] || 0) + naturalAmt)
        const txRow = postingRow(sourceTxn || t, p, naturalAmt, id)
        if (sourceTxn) {
          // Cash basis: recognized on the payment date, document comes from the invoice/bill
          txRow.txn_date = t.txn_date
          txRow.year = yr
          txRow.memo = `${t.txn_type} ${t.doc_number || ''} → ${sourceTxn.txn_type} #${sourceTxn.doc_number || sourceTxn.qb_txn_id}`.trim()
        }
        row.transactions.push(txRow)
      }
      const naturalOf = (acc: any, p: Posting) => (isIncomeAccount(acc) ? -p.amount : p.amount)

      forEachPlPosting((acc, p, t, src) => {
        addPl(acc, naturalOf(acc, p), t, p, src)
      })

      const years = Array.from(yearsSet).sort()
      const finalize = (r: any) => {
        let run = 0
        const txnsWithRun = r.transactions
          .sort((a: any, b: any) => String(a.txn_date).localeCompare(String(b.txn_date)))
          .map((tx: any) => {
            run = r2(run + Number(tx.amount || 0))
            return { ...tx, running_balance: run }
          })
        for (const y of Object.keys(r.byYear)) r.byYear[y] = r2(r.byYear[y])
        return { ...r, amount: r2(r.amount), transactions: txnsWithRun }
      }
      const allRows = Array.from(rowsByAcc.values()).map(finalize)

      /** QBO hierarchy: parent account row, indented sub-accounts and a "Total <parent>" row. */
      const buildSection = (key: PnlSectionKey) => {
        const rows = allRows.filter(r => r.section === key)
        const rowIds = new Set(rows.map(r => r.account_qb_id))
        const parentIds = new Set<string>()
        for (const r of rows) {
          let pid = r.parent_qb_id
          while (pid) {
            parentIds.add(pid)
            pid = ledgerCtx.accounts.get(pid)?.parent_qb_id ? String(ledgerCtx.accounts.get(pid)!.parent_qb_id) : null
          }
        }
        // Parent accounts without own amount still appear as headers (like QBO)
        for (const pid of parentIds) {
          if (rowIds.has(pid)) continue
          const acc = ledgerCtx.accounts.get(pid)
          if (!acc) continue
          rows.push({
            category: acc.fully_qualified_name || acc.name || pid,
            name: acc.name || pid,
            account_qb_id: pid,
            parent_qb_id: acc.parent_qb_id ? String(acc.parent_qb_id) : null,
            account_type: acc.account_type || '',
            section: key,
            amount: 0,
            count: 0,
            byYear: {},
            transactions: [],
          })
        }
        const children = new Map<string | null, any[]>()
        for (const r of rows) {
          const k = r.parent_qb_id && rows.some(x => x.account_qb_id === r.parent_qb_id) ? r.parent_qb_id : null
          if (!children.has(k)) children.set(k, [])
          children.get(k)!.push(r)
        }
        for (const list of children.values()) list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        const display: any[] = []
        const walk = (parentKey: string | null, depth: number): { amount: number; byYear: Record<string, number>; transactions: any[] } => {
          const agg = { amount: 0, byYear: {} as Record<string, number>, transactions: [] as any[] }
          for (const r of children.get(parentKey) || []) {
            const kids = children.get(r.account_qb_id) || []
            display.push({ kind: kids.length > 0 ? 'parent' : 'account', depth, ...r })
            let subtotal = { amount: r.amount, byYear: { ...r.byYear }, transactions: [...r.transactions] }
            if (kids.length > 0) {
              const k = walk(r.account_qb_id, depth + 1)
              subtotal = {
                amount: r2(r.amount + k.amount),
                byYear: Object.fromEntries(Array.from(new Set([...Object.keys(r.byYear), ...Object.keys(k.byYear)])).map(y => [y, r2((r.byYear[y] || 0) + (k.byYear[y] || 0))])),
                transactions: [...r.transactions, ...k.transactions],
              }
              display.push({
                kind: 'total',
                depth,
                category: `Total ${r.name}`,
                name: `Total ${r.name}`,
                account_qb_id: r.account_qb_id,
                section: key,
                amount: subtotal.amount,
                byYear: subtotal.byYear,
                transactions: subtotal.transactions,
              })
            }
            agg.amount = r2(agg.amount + subtotal.amount)
            for (const [y, v] of Object.entries(subtotal.byYear)) agg.byYear[y] = r2((agg.byYear[y] || 0) + Number(v))
            agg.transactions.push(...subtotal.transactions)
          }
          return agg
        }
        const totals = walk(null, 0)
        return { key, rows: display, total: totals.amount, byYear: totals.byYear, transactions: totals.transactions }
      }

      const sIncome = buildSection('income')
      const sCogs = buildSection('cogs')
      const sExpenses = buildSection('expenses')
      const sOtherIncome = buildSection('other_income')
      const sOtherExpenses = buildSection('other_expenses')
      const byYearCombine = (fn: (y: string) => number) => Object.fromEntries(years.map(y => [y, r2(fn(y))]))
      const yv = (s: { byYear: Record<string, number> }, y: string) => Number(s.byYear[y] || 0)

      const totalIncome = sIncome.total
      const totalCogs = sCogs.total
      const grossProfit = r2(totalIncome - totalCogs)
      const totalExpenses = sExpenses.total
      const netOperatingIncome = r2(grossProfit - totalExpenses)
      const totalOtherIncome = sOtherIncome.total
      const totalOtherExpenses = sOtherExpenses.total
      const netOtherIncome = r2(totalOtherIncome - totalOtherExpenses)
      const netIncome = r2(netOperatingIncome + netOtherIncome)

      const flatAccounts = (s: any) => s.rows.filter((r: any) => r.kind !== 'total' && (r.amount !== 0 || r.transactions.length > 0))

      return NextResponse.json({
        reportType,
        company,
        basis,
        startDate,
        endDate,
        availableArchives,
        pnl: {
          years,
          sections: [sIncome, sCogs, sExpenses, sOtherIncome, sOtherExpenses],
          // Back-compat flat lists (all income-type rows / all expense-type rows)
          incomeRows: [...flatAccounts(sIncome), ...flatAccounts(sOtherIncome)],
          expenseRows: [...flatAccounts(sCogs), ...flatAccounts(sExpenses), ...flatAccounts(sOtherExpenses)],
          totalIncome,
          totalCogs,
          grossProfit,
          totalExpenses,
          netOperatingIncome,
          totalOtherIncome,
          totalOtherExpenses,
          netOtherIncome,
          netIncome,
          incomeByYear: sIncome.byYear,
          cogsByYear: sCogs.byYear,
          grossProfitByYear: byYearCombine(y => yv(sIncome, y) - yv(sCogs, y)),
          expenseByYear: sExpenses.byYear,
          netOperatingIncomeByYear: byYearCombine(y => yv(sIncome, y) - yv(sCogs, y) - yv(sExpenses, y)),
          otherIncomeByYear: sOtherIncome.byYear,
          otherExpenseByYear: sOtherExpenses.byYear,
          netOtherIncomeByYear: byYearCombine(y => yv(sOtherIncome, y) - yv(sOtherExpenses, y)),
          netIncomeByYear: byYearCombine(y => yv(sIncome, y) - yv(sCogs, y) - yv(sExpenses, y) + yv(sOtherIncome, y) - yv(sOtherExpenses, y)),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 2. BALANCE SHEET (BALANCE GENERAL — JERÁRQUICO QBO CON SALDOS HISTÓRICOS A `endDate`)
    //    Montos en signo de presentación QBO: Activos, Pasivos y Capital en positivo.
    // -------------------------------------------------------------------------
    if (reportType === 'balance_sheet') {
      const endMap = balanceAsOf(asOfDate)
      const begDate = startDate ? dayBefore(startDate) : null
      const begMap = begDate ? balanceAsOf(begDate) : null
      const eqEnd = equityRollForward(asOfDate)
      const eqBeg = begDate ? equityRollForward(begDate) : null

      const everPosted = new Set<string>()
      for (const t of allTxns) {
        if (t.is_voided || String(t.txn_date || '') > asOfDate) continue
        for (const p of postingsOf(t)) everPosted.add(p.account_qb_id)
      }

      const withHistoricalBalance = (a: any) => {
        const idStr = String(a.qb_account_id)
        const isRE = retainedEarningsIds.has(idStr)
        const endNat = isRE ? eqEnd.retainedEarnings : toNaturalBalance(a, endMap.get(idStr) ?? 0)
        const begNat = begDate
          ? (isRE ? (eqBeg?.retainedEarnings ?? 0) : toNaturalBalance(a, begMap?.get(idStr) ?? 0))
          : 0
        return {
          ...a,
          current_balance: endNat,
          balance_as_of: endNat,
          beginning_balance: begNat,
          period_change: r2(endNat - begNat),
          balance_sign: 'natural',
        }
      }

      const allBsWithBal = accounts
        .filter((a: any) => isBalanceSheetAccountType(a))
        .map(withHistoricalBalance)
      const allBsById = new Map<string, any>()
      const allBsByFqnLower = new Map<string, any>()
      for (const a of allBsWithBal) {
        allBsById.set(String(a.qb_account_id), a)
        allBsByFqnLower.set(String(a.fully_qualified_name || a.name || '').toLowerCase(), a)
      }

      const bsAccounts = allBsWithBal.filter(
        (a: any) => a.is_active || Math.abs(Number(a.current_balance || 0)) > 0.004 || everPosted.has(String(a.qb_account_id))
      )

      // Build QBO hierarchical parent -> sub-account -> sub-sub-account -> Total [Parent] tree for Balance Sheet sections
      const buildBsTree = (sectionList: any[]) => {
        const nodeMap = new Map<string, any>()
        for (const a of sectionList) {
          nodeMap.set(String(a.qb_account_id), a)
        }
        // Ensure any ancestor of an included sub-account is also present in nodeMap so the parent header appears
        for (const a of sectionList) {
          let cur: any = a
          const visited = new Set<string>()
          while (cur) {
            const cId = String(cur.qb_account_id)
            if (visited.has(cId)) break
            visited.add(cId)
            let pId = String(cur.parent_qb_id || cur.raw_data?.ParentRef?.value || '').trim()
            if (!pId && cur.fully_qualified_name && String(cur.fully_qualified_name).includes(':')) {
              const prefix = String(cur.fully_qualified_name).split(':').slice(0, -1).join(':').toLowerCase()
              const pAcc = allBsByFqnLower.get(prefix)
              if (pAcc && String(pAcc.qb_account_id) !== cId) pId = String(pAcc.qb_account_id)
            }
            if (pId && pId !== cId && allBsById.has(pId)) {
              const parentAcc = allBsById.get(pId)!
              if (parentAcc.account_type === a.account_type && !nodeMap.has(pId)) {
                nodeMap.set(pId, parentAcc)
              }
              cur = parentAcc
            } else {
              break
            }
          }
        }

        const childrenByParent = new Map<string | null, any[]>()
        for (const a of nodeMap.values()) {
          const cId = String(a.qb_account_id)
          let pId: string | null = String(a.parent_qb_id || a.raw_data?.ParentRef?.value || '').trim() || null
          if (!pId && a.fully_qualified_name && String(a.fully_qualified_name).includes(':')) {
            const prefix = String(a.fully_qualified_name).split(':').slice(0, -1).join(':').toLowerCase()
            const pAcc = allBsByFqnLower.get(prefix)
            if (pAcc && String(pAcc.qb_account_id) !== cId) pId = String(pAcc.qb_account_id)
          }
          const validParent = pId && pId !== cId && nodeMap.has(pId) ? pId : null
          if (!childrenByParent.has(validParent)) childrenByParent.set(validParent, [])
          childrenByParent.get(validParent)!.push(a)
        }
        for (const arr of childrenByParent.values()) {
          arr.sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')))
        }

        const displayRows: any[] = []
        const walk = (parentId: string | null, depth: number, visited = new Set<string>()): number => {
          let sum = 0
          for (const node of childrenByParent.get(parentId) || []) {
            const nId = String(node.qb_account_id)
            if (visited.has(nId)) continue
            visited.add(nId)
            const kids = childrenByParent.get(nId) || []
            const ownBal = r2(Number(node.current_balance || 0))
            if (kids.length === 0) {
              if (Math.abs(ownBal) > 0.004 || node.is_active) {
                displayRows.push({
                  ...node,
                  kind: 'account',
                  depth,
                  display_balance: ownBal,
                  rollup_balance: ownBal,
                })
              }
              sum = r2(sum + ownBal)
            } else {
              const headerIdx = displayRows.length
              displayRows.push({
                ...node,
                kind: 'parent',
                depth,
                display_balance: ownBal,
                rollup_balance: ownBal,
                children_count: kids.length,
              })
              const childSum = walk(nId, depth + 1, visited)
              const subTotal = r2(ownBal + childSum)
              displayRows[headerIdx].rollup_balance = subTotal
              if (Math.abs(subTotal) > 0.004 || displayRows.length > headerIdx + 1) {
                displayRows.push({
                  id: `total-${nId}`,
                  qb_account_id: nId,
                  name: `Total ${node.name}`,
                  fully_qualified_name: node.fully_qualified_name || node.name,
                  account_type: node.account_type,
                  kind: 'total',
                  depth,
                  current_balance: subTotal,
                  display_balance: subTotal,
                  rollup_balance: subTotal,
                })
              } else {
                // Hide completely empty zero-balance parent with no visible children
                displayRows.splice(headerIdx, 1)
              }
              sum = r2(sum + subTotal)
            }
          }
          return sum
        }
        walk(null, 0)
        return displayRows
      }

      const assets = bsAccounts.filter((a: any) => ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type))
      const liabilities = bsAccounts.filter((a: any) => ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type))
      const equity = bsAccounts.filter((a: any) => a.account_type === 'Equity')

      const bankAccounts = assets.filter((a: any) => a.account_type === 'Bank')
      const accountsReceivable = assets.filter((a: any) => a.account_type === 'Accounts Receivable')
      const otherCurrentAssets = assets.filter((a: any) => a.account_type === 'Other Current Asset')
      const fixedAssets = assets.filter((a: any) => a.account_type === 'Fixed Asset')
      const otherAssets = assets.filter((a: any) => a.account_type === 'Other Asset')

      const sumBal = (list: any[]) => r2(list.reduce((s, a) => s + Number(a.current_balance || 0), 0))

      const totalBankAccounts = sumBal(bankAccounts)
      const totalAccountsReceivable = sumBal(accountsReceivable)
      const totalOtherCurrentAssets = sumBal(otherCurrentAssets)
      const totalCurrentAssets = r2(totalBankAccounts + totalAccountsReceivable + totalOtherCurrentAssets)
      const totalFixedAssets = sumBal(fixedAssets)
      const totalOtherAssets = sumBal(otherAssets)
      const totalAssets = r2(totalCurrentAssets + totalFixedAssets + totalOtherAssets)

      const accountsPayable = liabilities.filter((a: any) => a.account_type === 'Accounts Payable')
      const creditCards = liabilities.filter((a: any) => a.account_type === 'Credit Card')
      const otherCurrentLiabilities = liabilities.filter((a: any) => a.account_type === 'Other Current Liability')
      const longTermLiabilities = liabilities.filter((a: any) => a.account_type === 'Long Term Liability')

      const totalAccountsPayable = sumBal(accountsPayable)
      const totalCreditCards = sumBal(creditCards)
      const totalOtherCurrentLiabilities = sumBal(otherCurrentLiabilities)
      const totalCurrentLiabilities = r2(totalAccountsPayable + totalCreditCards + totalOtherCurrentLiabilities)
      const totalLongTermLiabilities = sumBal(longTermLiabilities)
      const totalLiabilities = r2(totalCurrentLiabilities + totalLongTermLiabilities)

      const statedEquity = sumBal(equity) // includes Retained Earnings
      const netIncome = eqEnd.netIncome
      const totalEquity = r2(statedEquity + netIncome)
      const totalLiabilitiesAndEquity = r2(totalLiabilities + totalEquity)

      return NextResponse.json({
        reportType,
        company,
        startDate,
        endDate: asOfDate,
        availableArchives,
        balanceSheet: {
          asOfDate,
          fiscalYearStart: eqEnd.fiscalYearStart,
          assets,
          liabilities,
          equity,
          bankAccounts,
          accountsReceivable,
          otherCurrentAssets,
          fixedAssets,
          otherAssets,
          accountsPayable,
          creditCards,
          otherCurrentLiabilities,
          longTermLiabilities,
          bankAccountsTree: buildBsTree(bankAccounts),
          accountsReceivableTree: buildBsTree(accountsReceivable),
          otherCurrentAssetsTree: buildBsTree(otherCurrentAssets),
          fixedAssetsTree: buildBsTree(fixedAssets),
          otherAssetsTree: buildBsTree(otherAssets),
          accountsPayableTree: buildBsTree(accountsPayable),
          creditCardsTree: buildBsTree(creditCards),
          otherCurrentLiabilitiesTree: buildBsTree(otherCurrentLiabilities),
          longTermLiabilitiesTree: buildBsTree(longTermLiabilities),
          equityTree: buildBsTree(equity),
          totalBankAccounts,
          totalAccountsReceivable,
          totalOtherCurrentAssets,
          totalCurrentAssets,
          totalFixedAssets,
          totalOtherAssets,
          totalAssets,
          totalAccountsPayable,
          totalCreditCards,
          totalOtherCurrentLiabilities,
          totalCurrentLiabilities,
          totalLongTermLiabilities,
          totalLiabilities,
          statedEquity,
          retainedEarnings: eqEnd.retainedEarnings,
          netIncome,
          // Kept for UI compatibility: the "Net Income" line of the QBO Balance Sheet
          retainedNetIncome: netIncome,
          totalEquity,
          totalLiabilitiesAndEquity,
          balanceCheckDifference: r2(totalAssets - totalLiabilitiesAndEquity),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 3. BANK / CREDIT CARD REGISTER (AUXILIAR) — saldo inicial + saldo corrido como el registro de QBO
    // -------------------------------------------------------------------------
    if (reportType === 'bank_register') {
      const bankAccounts = accounts
        .filter((a: any) => a.account_type === 'Bank' || a.account_type === 'Credit Card')
        .map((a: any) => ({ ...a, current_balance: toNaturalBalance(a, Number(a.current_balance || 0)), balance_sign: 'natural' }))
      const targetAcctId = accountId !== 'ALL' ? accountId : (bankAccounts[0]?.qb_account_id || '')
      const targetAcc = ledgerCtx.accounts.get(String(targetAcctId))
      const begDp = startDate ? (balanceAsOf(dayBefore(startDate)).get(String(targetAcctId)) ?? 0) : 0
      let runningDp = begDp

      const registerRows: any[] = []
      for (const t of activeTxns) {
        const ps = postingsOf(t).filter(p => p.account_qb_id === String(targetAcctId))
        if (ps.length === 0) continue
        const dp = r2(ps.reduce((s, p) => s + p.amount, 0))
        if (dp === 0) continue
        runningDp = r2(runningDp + dp)
        registerRows.push({
          id: t.id,
          qb_txn_id: t.qb_txn_id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number,
          entity_name: t.entity_name || ps[0].entity_name,
          account_name: t.account_name,
          category_summary: splitLabel(t, String(targetAcctId)),
          memo: t.memo || ps[0].memo,
          inflow: dp > 0 ? dp : 0,
          outflow: dp < 0 ? -dp : 0,
          running_balance: toNaturalBalance(targetAcc, runningDp),
          cleared_status: t.cleared_status,
        })
      }

      const totalIn = r2(registerRows.reduce((s, r) => s + r.inflow, 0))
      const totalOut = r2(registerRows.reduce((s, r) => s + r.outflow, 0))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        bankRegister: {
          selectedAccountId: targetAcctId,
          bankAccounts,
          beginningBalance: toNaturalBalance(targetAcc, begDp),
          rows: registerRows.reverse(), // Newest at top, chronological running_balance preserved
          totalInflows: totalIn,
          totalOutflows: totalOut,
          endingBalance: toNaturalBalance(targetAcc, runningDp),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 4. GENERAL LEDGER (LIBRO MAYOR DETALLADO) — por cuenta: saldo inicial, cargos/abonos, saldo corrido
    // -------------------------------------------------------------------------
    if (reportType === 'general_ledger') {
      const ENTRY_CAP = 3000
      const glStart = startDate || null
      const begBS = glStart ? balanceAsOf(dayBefore(glStart)) : null
      const begPL = glStart ? activityBetween(fiscalYearStart(glStart, fiscalStartMonth), dayBefore(glStart)) : null
      const byAcc = new Map<string, { entries: any[]; total_debit: number; total_credit: number }>()
      for (const t of activeTxns) {
        for (const p of postingsOf(t)) {
          if (!ledgerCtx.accounts.has(p.account_qb_id)) continue
          let g = byAcc.get(p.account_qb_id)
          if (!g) {
            g = { entries: [], total_debit: 0, total_credit: 0 }
            byAcc.set(p.account_qb_id, g)
          }
          const debit = p.amount > 0 ? r2(p.amount) : 0
          const credit = p.amount < 0 ? r2(-p.amount) : 0
          g.total_debit = r2(g.total_debit + debit)
          g.total_credit = r2(g.total_credit + credit)
          g.entries.push({
            id: t.id,
            qb_txn_id: t.qb_txn_id,
            date: t.txn_date,
            txn_date: t.txn_date,
            type: t.txn_type,
            txn_type: t.txn_type,
            doc: t.doc_number || '',
            doc_number: t.doc_number || '',
            name: p.entity_name || t.entity_name || '',
            entity_name: p.entity_name || t.entity_name || '',
            memo: p.memo || t.memo || '',
            split: splitLabel(t, p.account_qb_id),
            split_account: splitLabel(t, p.account_qb_id),
            account_qb_id: t.account_qb_id || p.account_qb_id,
            account_name: t.account_name || accName(p.account_qb_id),
            to_account_qb_id: t.to_account_qb_id || null,
            to_account_name: t.to_account_name || null,
            category_summary: t.category_summary || splitLabel(t, p.account_qb_id),
            total_amount: r2(Number(t.total_amount ?? Math.abs(p.amount))),
            line_items: Array.isArray(t.line_items) ? t.line_items : [],
            is_voided: Boolean(t.is_voided),
            debit,
            credit,
            dp: p.amount,
          })
        }
      }
      const ledgerRows: any[] = []
      const accIds = new Set<string>([...byAcc.keys()])
      if (begBS) {
        for (const a of accounts) {
          const id = String(a.qb_account_id)
          const b = isBalanceSheetAccountType(a) ? (begBS.get(id) ?? 0) : (begPL?.get(id) ?? 0)
          if (Math.abs(b) > 0.004) accIds.add(id)
        }
      }
      for (const id of accIds) {
        const acc = ledgerCtx.accounts.get(id)
        if (!acc) continue
        const g = byAcc.get(id) || { entries: [], total_debit: 0, total_credit: 0 }
        const isBS = isBalanceSheetAccountType(acc)
        const begDp = retainedEarningsIds.has(id)
          ? (glStart ? equityRollForward(dayBefore(glStart)).retainedEarningsDebitPositive : 0)
          : (isBS ? (begBS?.get(id) ?? 0) : (begPL?.get(id) ?? 0))
        let run = begDp
        const entries = g.entries.map(e => {
          run = r2(run + e.dp)
          const { dp, ...rest } = e
          return { ...rest, balance: toNaturalBalance(acc, run) }
        })
        ledgerRows.push({
          account_qb_id: id,
          account_name: acc.fully_qualified_name || acc.name || id,
          account_type: acc.account_type,
          beginning_balance: toNaturalBalance(acc, begDp),
          total_debit: g.total_debit,
          total_credit: g.total_credit,
          net_movement: r2(g.total_debit - g.total_credit),
          ending_balance: toNaturalBalance(acc, run),
          entry_count: entries.length,
          truncated: entries.length > ENTRY_CAP,
          entries: entries.length > ENTRY_CAP ? entries.slice(-ENTRY_CAP) : entries,
        })
      }
      ledgerRows.sort((a, b) => a.account_name.localeCompare(b.account_name))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        generalLedger: ledgerRows,
      })
    }

    // -------------------------------------------------------------------------
    // 5. TRIAL BALANCE (BALANZA DE COMPROBACIÓN) — igual que QBO:
    //    cuentas de Balance al corte, cuentas de Resultados del año fiscal a la fecha y Retained Earnings.
    // -------------------------------------------------------------------------
    if (reportType === 'trial_balance') {
      const endMap = balanceAsOf(asOfDate)
      const eq = equityRollForward(asOfDate)
      const ytd = activityBetween(eq.fiscalYearStart, asOfDate)
      const everPosted = new Set<string>()
      for (const t of allTxns) {
        if (t.is_voided || String(t.txn_date || '') > asOfDate) continue
        for (const p of postingsOf(t)) everPosted.add(p.account_qb_id)
      }
      const tbRows = accounts
        .map((a: any) => {
          const id = String(a.qb_account_id)
          let dp = 0
          if (retainedEarningsIds.has(id)) dp = eq.retainedEarningsDebitPositive
          else if (isBalanceSheetAccountType(a)) dp = endMap.get(id) ?? 0
          else if (isProfitLossAccount(a)) dp = ytd.get(id) ?? 0
          dp = r2(dp)
          return {
            account_id: id,
            account_qb_id: id,
            acct_num: a.acct_num,
            name: a.name,
            fully_qualified_name: a.fully_qualified_name || a.name,
            account_type: a.account_type,
            debit: dp > 0 ? dp : 0,
            credit: dp < 0 ? r2(-dp) : 0,
            _keep: Math.abs(dp) > 0.004 || everPosted.has(id) || retainedEarningsIds.has(id) || a.account_sub_type === 'OpeningBalanceEquity',
          }
        })
        .filter((r: any) => r._keep)
        .map(({ _keep, ...r }: any) => r)

      const totalDebit = r2(tbRows.reduce((s: number, r: any) => s + r.debit, 0))
      const totalCredit = r2(tbRows.reduce((s: number, r: any) => s + r.credit, 0))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        trialBalance: {
          asOfDate,
          fiscalYearStart: eq.fiscalYearStart,
          rows: tbRows,
          totalDebit,
          totalCredit,
          difference: r2(totalDebit - totalCredit),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 6. EXPENSES BY VENDOR SUMMARY & INCOME BY CUSTOMER SUMMARY (QBO)
    //    Suma de pólizas a cuentas de Gasto (o Ingreso) agrupadas por proveedor (o cliente).
    // -------------------------------------------------------------------------
    if (reportType === 'vendor_expenses' || reportType === 'customer_income') {
      const isVendor = reportType === 'vendor_expenses'
      const contactMap = new Map<string, any>()
      for (const c of contacts) {
        contactMap.set((c.display_name || '').toLowerCase(), c)
        if (c.qb_contact_id) contactMap.set(`id:${c.contact_type}:${c.qb_contact_id}`, c)
      }

      const agg: Record<string, {
        name: string
        count: number
        total_amount: number
        expenses_amount: number
        net_amount: number
        last_date: string
        tax_identifier: string | null
        vendor_1099: boolean
        categories: Set<string>
        txnIds: Set<string>
        transactions: any[]
      }> = {}

      forEachPlPosting((acc, p, t, src) => {
          const incomeAcc = isIncomeAccount(acc)
          const expenseAcc = isExpenseAccount(acc)
          if (!incomeAcc && !expenseAcc) return
          let name: string
          if (isVendor) {
            // QBO Expenses by Vendor: only Vendor-type payees; any other payee type is "Not Specified"
            if (!expenseAcc) return
            name = p.entity_type === 'Vendor' && p.entity_name ? String(p.entity_name).trim() : 'Not Specified'
          } else {
            // QBO Income by Customer: only postings tied to a Customer (payee or billable customer)
            const cust = p.entity_type === 'Customer' ? p.entity_name : p.customer_name
            if (!cust) return
            name = String(cust).trim()
          }
          // Vendor report: expenses positive. Customer report: Income column positive; Expenses column = −debits (QBO sign)
          const amt = r2(isVendor ? p.amount : -p.amount)
          if (amt === 0) return
          if (!agg[name]) {
            const matchedContact = contactMap.get(name.toLowerCase())
            agg[name] = {
              name,
              count: 0,
              total_amount: 0,
              expenses_amount: 0,
              net_amount: 0,
              last_date: t.txn_date,
              tax_identifier: matchedContact?.tax_identifier || null,
              vendor_1099: Boolean(matchedContact?.vendor_1099),
              categories: new Set<string>(),
              txnIds: new Set<string>(),
              transactions: [],
            }
          }
          const g = agg[name]
          if (!g.txnIds.has(String(t.id))) {
            g.txnIds.add(String(t.id))
            g.count++
          }
          if (isVendor || incomeAcc) g.total_amount = r2(g.total_amount + amt)
          else g.expenses_amount = r2(g.expenses_amount + amt)
          g.net_amount = r2(g.total_amount + (isVendor ? 0 : g.expenses_amount))
          if (String(t.txn_date) > g.last_date) g.last_date = t.txn_date
          g.categories.add(accName(p.account_qb_id))
          const txRow = postingRow(src || t, p, amt, p.account_qb_id)
          if (src) {
            txRow.txn_date = t.txn_date
            txRow.year = String(t.txn_date || '').slice(0, 4)
          }
          g.transactions.push(txRow)
      })

      const rows = Object.values(agg)
        .map(r => {
          let run = 0
          const txnsWithRun = r.transactions
            .sort((a: any, b: any) => String(a.txn_date).localeCompare(String(b.txn_date)))
            .map(tx => {
              run = r2(run + Number(tx.amount || 0))
              return { ...tx, running_balance: run }
            })
          const { txnIds, ...rest } = r
          return {
            ...rest,
            categories: Array.from(r.categories).slice(0, 3).join(', '),
            transactions: txnsWithRun,
          }
        })
        .filter(r => Math.abs(r.total_amount) > 0.004 || Math.abs(r.expenses_amount) > 0.004)
        .sort((a, b) => a.name === 'Not Specified' ? 1 : b.name === 'Not Specified' ? -1 : a.name.localeCompare(b.name))

      const grandTotal = r2(rows.reduce((s, r) => s + r.total_amount, 0))
      const grandExpenses = r2(rows.reduce((s, r) => s + r.expenses_amount, 0))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        entitySummary: {
          rows,
          grandTotal,
          grandExpenses,
          grandNet: r2(grandTotal + grandExpenses),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 7. CHECK DETAIL & DEPOSIT DETAIL
    // -------------------------------------------------------------------------
    if (reportType === 'check_detail' || reportType === 'deposit_detail') {
      const targetTypes = reportType === 'check_detail' ? ['Check', 'BillPayment'] : ['Deposit', 'Payment']
      const rows = txns
        .filter(t => targetTypes.includes(t.txn_type))
        .reverse()
      const totalAmount = Number(
        rows.filter(r => !r.is_voided).reduce((s, r) => s + Number(r.total_amount || 0), 0).toFixed(2)
      )

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        detailReport: {
          rows,
          totalAmount,
          count: rows.length,
        }
      })
    }

    // -------------------------------------------------------------------------
    // 8. ACCOUNT QUICKREPORT / ECOSYSTEM DRILL-DOWN TRANSACTION REPORT
    //    Supports:
    //    - Single Account (`accountId` or `accountName`)
    //    - Parent Account + all Sub-Accounts (`Prepaid Expenses`, `Short Term Investments`, `Buildings`, `Land`, etc.)
    //    - Balance Sheet / Trial Balance / P&L Group Totals (`GROUP:BANK`, `GROUP:CURRENT_ASSETS`, `GROUP:TOTAL_ASSETS`, etc., or QBO summary titles like `Total Bank Accounts`)
    //    - Relational Lists & Contacts Drill-Down (`filterType=item|location|class|payment_method|term|contact` + `filterValue`)
    // -------------------------------------------------------------------------
    if (reportType === 'account_quickreport') {
      const rawNameParam = (searchParams.get('accountName') || '').trim()
      const targetNameParam = rawNameParam.toLowerCase()
      const filterType = (searchParams.get('filterType') || '').trim().toLowerCase()
      const filterValue = (searchParams.get('filterValue') || '').trim()
      const filterId = (searchParams.get('filterId') || '').trim()

      // MODE 8A: RELATIONAL LISTS / CONTACTS DRILL-DOWN (`filterType` provided)
      if (filterType && (filterValue || filterId)) {
        const valLower = filterValue.toLowerCase()
        const matchedRows: any[] = []
        let runningTotal = 0

        for (const t of activeTxns) {
          if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
          const lines = Array.isArray(t.line_items) && t.line_items.length > 0 ? t.line_items : []

          let matched = false
          let matchedAmt = Number(t.total_amount || 0)
          let matchedMemo = t.memo || ''
          let matchedAcct = t.account_name || t.category_summary || '—'
          let matchedSplit = t.to_account_name || t.category_summary || '—'

          if (filterType === 'contact') {
            if (
              (filterId && String(t.entity_qb_id || '') === filterId) ||
              (valLower && String(t.entity_name || '').toLowerCase() === valLower)
            ) {
              matched = true
              if (t.direction === 'OUT' || t.txn_type === 'Bill') matchedAmt = -Math.abs(matchedAmt)
            } else {
              for (const l of lines) {
                if (
                  (filterId && String(l.entity_qb_id || '') === filterId) ||
                  (valLower && String(l.entity_name || '').toLowerCase() === valLower)
                ) {
                  matched = true
                  matchedAmt = Number(l.amount ?? t.total_amount ?? 0)
                  matchedMemo = l.description || t.memo || ''
                  matchedAcct = l.account_name || matchedAcct
                  break
                }
              }
            }
          } else if (filterType === 'payment_method') {
            if (valLower && String(t.payment_type || '').toLowerCase() === valLower) {
              matched = true
              if (t.direction === 'OUT') matchedAmt = -Math.abs(matchedAmt)
            }
          } else if (filterType === 'term') {
            const rawTerm = String(t.raw_data?.SalesTermRef?.name || t.payment_type || '').toLowerCase()
            if (valLower && rawTerm === valLower) {
              matched = true
            }
          } else if (filterType === 'location' || filterType === 'department') {
            // QBO Location (DepartmentRef) is a transaction-header field: match by Id, exact name or FullyQualifiedName leaf
            const hdrDeptId = String(t.department_qb_id || t.raw_data?.DepartmentRef?.value || '')
            const hdrDeptName = String(t.department_name || t.raw_data?.DepartmentRef?.name || '').toLowerCase().trim()
            const sameLocation = (candidate: string) =>
              Boolean(candidate) && Boolean(valLower) &&
              (candidate === valLower || candidate.split(':').pop()!.trim() === valLower || valLower.split(':').pop()!.trim() === candidate)
            if ((filterId && hdrDeptId === filterId) || sameLocation(hdrDeptName)) {
              matched = true
              if (t.direction === 'OUT' || t.txn_type === 'Bill') matchedAmt = -Math.abs(matchedAmt)
            } else {
              let lineSum = 0
              for (const l of lines) {
                const lDeptId = String(l.department_qb_id || '')
                const lDeptName = String(l.department_name || '').toLowerCase().trim()
                if ((filterId && lDeptId === filterId) || sameLocation(lDeptName)) {
                  matched = true
                  lineSum += Number(l.amount || 0)
                  matchedAcct = l.account_name || matchedAcct
                }
              }
              if (matched && lineSum !== 0) matchedAmt = lineSum
            }
          } else if (filterType === 'class') {
            const hdrClassId = String(t.class_qb_id || '')
            const hdrClassName = String(t.class_name || '').toLowerCase()
            if ((filterId && hdrClassId === filterId) || (valLower && hdrClassName === valLower)) {
              matched = true
              if (t.direction === 'OUT') matchedAmt = -Math.abs(matchedAmt)
            } else {
              let lineSum = 0
              for (const l of lines) {
                const lClassId = String(l.class_qb_id || '')
                const lClassName = String(l.class_name || '').toLowerCase()
                if ((filterId && lClassId === filterId) || (valLower && lClassName === valLower)) {
                  matched = true
                  lineSum += Number(l.amount || 0)
                  matchedAcct = l.account_name || matchedAcct
                }
              }
              if (matched && lineSum !== 0) matchedAmt = lineSum
            }
          } else if (filterType === 'item') {
            let lineSum = 0
            for (const l of lines) {
              const lItemId = String(l.item_qb_id || l.item_id || '')
              const lItemName = String(l.item_name || l.account_name || '').toLowerCase()
              if ((filterId && lItemId === filterId) || (valLower && lItemName === valLower)) {
                matched = true
                lineSum += Number(l.amount || 0)
                const { categoryName } = resolveLineAccount(t, l, 'ANY')
                matchedAcct = categoryName || l.account_name || matchedAcct
                matchedSplit = t.account_name || '—'
                matchedMemo = l.description || t.memo || ''
              }
            }
            if (matched) matchedAmt = lineSum || Number(t.total_amount || 0)
          }

          if (matched) {
            runningTotal = Number((runningTotal + matchedAmt).toFixed(2))
            matchedRows.push({
              id: t.id,
              qb_txn_id: t.qb_txn_id,
              txn_date: t.txn_date,
              txn_type: t.txn_type,
              doc_number: t.doc_number || '',
              entity_name: t.entity_name || '—',
              department_name: t.department_name || '',
              location_name: t.department_name || '',
              class_name: t.class_name || '',
              memo: matchedMemo,
              account_qb_id: t.account_qb_id || null,
              account_name: matchedAcct,
              to_account_qb_id: t.to_account_qb_id || null,
              to_account_name: t.to_account_name || null,
              category_summary: t.category_summary || matchedSplit,
              split_account: matchedSplit,
              amount: Number(matchedAmt.toFixed(2)),
              total_amount: Number((t.total_amount ?? Math.abs(matchedAmt)).toFixed(2)),
              line_items: Array.isArray(t.line_items) ? t.line_items : [],
              payment_method: t.payment_type || '',
              is_voided: Boolean(t.is_voided),
              running_balance: runningTotal,
              year: (t.txn_date || '').slice(0, 4),
              cleared_status: t.cleared_status || 'Cleared',
            })
          }
        }

        const reportTitle = rawNameParam || filterValue || filterType.toUpperCase()
        const singleGroup = {
          account_id: filterId || filterType,
          account_qb_id: filterId || filterType,
          account_name: reportTitle,
          fully_qualified_name: reportTitle,
          account_type: filterType.toUpperCase(),
          is_balance_sheet: false,
          beginning_balance: 0,
          transactions: matchedRows,
          period_net_change: runningTotal,
          ending_balance: runningTotal,
        }

        return NextResponse.json({
          reportType,
          company,
          rows: matchedRows,
          totalAmount: runningTotal,
          count: matchedRows.length,
          quickReport: {
            title: reportTitle,
            subtitle: `${startDate || 'Inicio'} — ${endDate || 'Hoy'}`,
            isBalanceSheetReport: false,
            totalBeginningBalance: 0,
            totalAmount: runningTotal,
            totalEndingBalance: runningTotal,
            count: matchedRows.length,
            groups: [singleGroup],
            rows: matchedRows,
          },
        })
      }

      // MODE 8B: RESOLVE ONE OR MULTIPLE TARGET ACCOUNTS (Single Account, Parent + Sub-Accounts, or Group Total)
      const resolveGroupToken = (tokenOrName: string): { groupTitle: string; list: any[] } | null => {
        const u = tokenOrName.trim().toUpperCase()
        const activeList = accounts.filter(a => a.is_active)
        if (u === 'GROUP:BANK' || u === 'TOTAL BANK ACCOUNTS' || u === 'TOTAL FOR BANK ACCOUNTS' || u === 'BANK ACCOUNTS') {
          return { groupTitle: 'Total Bank Accounts', list: activeList.filter(a => a.account_type === 'Bank') }
        }
        if (u === 'GROUP:AR' || u === 'TOTAL ACCOUNTS RECEIVABLE' || u === 'TOTAL FOR ACCOUNTS RECEIVABLE' || u === 'ACCOUNTS RECEIVABLE') {
          return { groupTitle: 'Total Accounts Receivable (A/R)', list: activeList.filter(a => a.account_type === 'Accounts Receivable') }
        }
        if (u === 'GROUP:OCA' || u === 'TOTAL OTHER CURRENT ASSETS' || u === 'TOTAL FOR OTHER CURRENT ASSETS' || u === 'OTHER CURRENT ASSETS') {
          return { groupTitle: 'Total Other Current Assets', list: activeList.filter(a => a.account_type === 'Other Current Asset') }
        }
        if (u === 'GROUP:CURRENT_ASSETS' || u === 'TOTAL CURRENT ASSETS' || u === 'TOTAL FOR CURRENT ASSETS' || u === 'CURRENT ASSETS') {
          return { groupTitle: 'Total Current Assets', list: activeList.filter(a => ['Bank', 'Accounts Receivable', 'Other Current Asset'].includes(a.account_type)) }
        }
        if (u === 'GROUP:FIXED_ASSETS' || u === 'TOTAL FIXED ASSETS' || u === 'TOTAL FOR FIXED ASSETS' || u === 'FIXED ASSETS') {
          return { groupTitle: 'Total Fixed Assets', list: activeList.filter(a => a.account_type === 'Fixed Asset') }
        }
        if (u === 'GROUP:OTHER_ASSETS' || u === 'TOTAL OTHER ASSETS' || u === 'TOTAL FOR OTHER ASSETS' || u === 'OTHER ASSETS') {
          return { groupTitle: 'Total Other Assets', list: activeList.filter(a => a.account_type === 'Other Asset') }
        }
        if (u === 'GROUP:TOTAL_ASSETS' || u === 'TOTAL ASSETS' || u === 'TOTAL FOR ASSETS') {
          return { groupTitle: 'Total Assets', list: activeList.filter(a => a.classification === 'Asset' || ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type)) }
        }
        if (u === 'GROUP:AP' || u === 'TOTAL ACCOUNTS PAYABLE' || u === 'TOTAL FOR ACCOUNTS PAYABLE' || u === 'ACCOUNTS PAYABLE') {
          return { groupTitle: 'Total Accounts Payable (A/P)', list: activeList.filter(a => a.account_type === 'Accounts Payable') }
        }
        if (u === 'GROUP:CC' || u === 'TOTAL CREDIT CARDS' || u === 'TOTAL FOR CREDIT CARDS' || u === 'CREDIT CARDS') {
          return { groupTitle: 'Total Credit Cards', list: activeList.filter(a => a.account_type === 'Credit Card') }
        }
        if (u === 'GROUP:OCL' || u === 'TOTAL OTHER CURRENT LIABILITIES' || u === 'TOTAL FOR OTHER CURRENT LIABILITIES' || u === 'OTHER CURRENT LIABILITIES') {
          return { groupTitle: 'Total Other Current Liabilities', list: activeList.filter(a => a.account_type === 'Other Current Liability') }
        }
        if (u === 'GROUP:CURRENT_LIABILITIES' || u === 'TOTAL CURRENT LIABILITIES' || u === 'TOTAL FOR CURRENT LIABILITIES' || u === 'CURRENT LIABILITIES') {
          return { groupTitle: 'Total Current Liabilities', list: activeList.filter(a => ['Accounts Payable', 'Credit Card', 'Other Current Liability'].includes(a.account_type)) }
        }
        if (u === 'GROUP:LTL' || u === 'TOTAL LONG-TERM LIABILITIES' || u === 'TOTAL LONG TERM LIABILITIES' || u === 'TOTAL FOR LONG-TERM LIABILITIES' || u === 'LONG-TERM LIABILITIES' || u === 'LONG TERM LIABILITIES') {
          return { groupTitle: 'Total Long-Term Liabilities', list: activeList.filter(a => a.account_type === 'Long Term Liability') }
        }
        if (u === 'GROUP:TOTAL_LIABILITIES' || u === 'TOTAL LIABILITIES' || u === 'TOTAL FOR LIABILITIES') {
          return { groupTitle: 'Total Liabilities', list: activeList.filter(a => a.classification === 'Liability' || ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type)) }
        }
        if (u === 'GROUP:EQUITY' || u === 'TOTAL EQUITY' || u === 'TOTAL FOR EQUITY' || u === 'EQUITY') {
          return { groupTitle: 'Total Equity', list: activeList.filter(a => a.classification === 'Equity' || a.account_type === 'Equity') }
        }
        if (u === 'GROUP:LIABILITIES_AND_EQUITY' || u === 'TOTAL LIABILITIES AND EQUITY' || u === 'TOTAL LIABILITIES & EQUITY') {
          return {
            groupTitle: 'Total Liabilities and Equity',
            list: activeList.filter(a => ['Liability', 'Equity'].includes(a.classification || '') || ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability', 'Equity'].includes(a.account_type)),
          }
        }
        if (u === 'GROUP:ALL_TRIAL_BALANCE') {
          return { groupTitle: 'Trial Balance — All Active Accounts', list: activeList }
        }
        if (u === 'GROUP:NET_INCOME' || u === 'NET INCOME' || u === 'RETAINED NET INCOME' || u === 'UTILIDAD NETA' || u === 'UTILIDAD NETA RETENIDA') {
          return { groupTitle: 'Net Income', list: accounts.filter(a => isProfitLossAccount(a)) }
        }
        if (u === 'GROUP:INCOME' || u === 'TOTAL INCOME') {
          return { groupTitle: 'Total Income', list: accounts.filter(a => a.account_type === 'Income') }
        }
        if (u === 'GROUP:EXPENSES' || u === 'TOTAL EXPENSES') {
          return { groupTitle: 'Total Expenses', list: accounts.filter(a => a.account_type === 'Expense') }
        }
        if (u === 'GROUP:COGS' || u === 'TOTAL COST OF GOODS SOLD') {
          return { groupTitle: 'Total Cost of Goods Sold', list: accounts.filter(a => a.account_type === 'Cost of Goods Sold') }
        }
        if (u === 'GROUP:OTHER_INCOME' || u === 'TOTAL OTHER INCOME') {
          return { groupTitle: 'Total Other Income', list: accounts.filter(a => a.account_type === 'Other Income') }
        }
        if (u === 'GROUP:OTHER_EXPENSES' || u === 'TOTAL OTHER EXPENSES') {
          return { groupTitle: 'Total Other Expenses', list: accounts.filter(a => a.account_type === 'Other Expense') }
        }
        return null
      }

      let targetAccounts: any[] = []
      let reportTitle = rawNameParam || ''

      const groupByAccountId = accountId && accountId !== 'ALL' ? resolveGroupToken(accountId) : null
      const groupByName = !groupByAccountId && rawNameParam ? resolveGroupToken(rawNameParam) : null
      const resolvedGroup = groupByAccountId || groupByName
      // Balance Sheet "Net Income" line = fiscal-year-to-date P&L as of the report date
      const netIncomeMode = resolvedGroup?.groupTitle === 'Net Income'

      if (resolvedGroup) {
        targetAccounts = resolvedGroup.list
        reportTitle = rawNameParam || resolvedGroup.groupTitle
      } else if (accountId && accountId !== 'ALL' && accountId.includes(',')) {
        const idParts = accountId.split(',').map(s => s.trim()).filter(Boolean)
        for (const pid of idParts) {
          const acc = accountTypeMap.get(pid)
          if (acc) targetAccounts.push(acc)
        }
      } else {
        // Strip QBO Archive summary prefixes like "Total for Prepaid Expenses" or "Total Prepaid Expenses"
        const cleanedNameLower = targetNameParam
          .replace(/^total\s+for\s+/i, '')
          .replace(/^total\s+/i, '')
          .trim()

        const baseAccount =
          (accountId && accountId !== 'ALL' && accountTypeMap.get(String(accountId))) ||
          (targetNameParam && accountNameMap.get(targetNameParam)) ||
          (cleanedNameLower && accountNameMap.get(cleanedNameLower)) ||
          null

        if (baseAccount) {
          const baseId = String(baseAccount.qb_account_id)
          const baseFqLower = String(baseAccount.fully_qualified_name || baseAccount.name || '').toLowerCase()
          // Recursively collect all multi-level descendant sub-accounts (Level 1 -> Level 2 -> Level 3 -> Level 4)
          const visitedIds = new Set<string>([baseId])
          const queue: string[] = [baseId]
          const descendants: any[] = []
          while (queue.length > 0) {
            const curId = queue.shift()!
            for (const a of accounts) {
              const aId = String(a.qb_account_id)
              if (visitedIds.has(aId)) continue
              const pId = String(a.parent_qb_id || a.raw_data?.ParentRef?.value || '').trim()
              const fqLower = String(a.fully_qualified_name || '').toLowerCase()
              if (pId === curId || (curId === baseId && baseFqLower && fqLower.startsWith(`${baseFqLower}:`))) {
                visitedIds.add(aId)
                descendants.push(a)
                queue.push(aId)
              }
            }
          }
          targetAccounts = [baseAccount, ...descendants]
          reportTitle = rawNameParam || baseAccount.fully_qualified_name || baseAccount.name
        }
      }

      // Sort targetAccounts by name (just like QBO sorts BANK PARA TRUST, BOFA PRIVATE BANK-6980, Cash on hand, GUTIERREZ, Plaza Bank)
      targetAccounts.sort((a, b) =>
        String(a.fully_qualified_name || a.name || '').localeCompare(String(b.fully_qualified_name || b.name || ''))
      )

      // Build QBO-style Account Groups (`groups`) with Beginning Balance, Chronological Transactions, Running Balance, Period Net Change, and Ending Balance
      const groups: any[] = []
      const allFlatRows: any[] = []
      let totalBeginningBalance = 0
      let totalNetChange = 0
      let totalEndingBalance = 0
      let anyBalanceSheet = false

      if (targetAccounts.length > 0) {
        // Every amount comes from the double-entry postings; balances are shown with the QBO presentation sign
        const endMap = balanceAsOf(endDate)
        const rangeStart = netIncomeMode ? fiscalYearStart(asOfDate, fiscalStartMonth) : startDate
        const rangeEnd = netIncomeMode ? asOfDate : endDate
        const rangeTxns = netIncomeMode
          ? allTxns.filter(t => !t.is_voided && String(t.txn_date || '') >= String(rangeStart) && String(t.txn_date || '') <= String(rangeEnd))
          : activeTxns
        const targetIds = new Set(targetAccounts.map(a => String(a.qb_account_id)))
        const postingsByAcc = new Map<string, Array<{ t: any; p: Posting }>>()
        for (const t of rangeTxns) {
          if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
          for (const p of postingsOf(t)) {
            if (!targetIds.has(p.account_qb_id)) continue
            if (!postingsByAcc.has(p.account_qb_id)) postingsByAcc.set(p.account_qb_id, [])
            postingsByAcc.get(p.account_qb_id)!.push({ t, p })
          }
        }

        for (const acc of targetAccounts) {
          const accIdStr = String(acc.qb_account_id)
          const isBS = isBalanceSheetAccountType(acc)
          const isRE = retainedEarningsIds.has(accIdStr)
          if (isBS) anyBalanceSheet = true
          const accDisplayName = acc.fully_qualified_name || acc.name || ''

          // Merge postings of the same transaction on this account (e.g. two lines to the same account)
          const merged = new Map<string, { t: any; p: Posting; dp: number }>()
          for (const { t, p } of postingsByAcc.get(accIdStr) || []) {
            const k = String(t.id)
            const prev = merged.get(k)
            if (prev) prev.dp = r2(prev.dp + p.amount)
            else merged.set(k, { t, p, dp: p.amount })
          }
          const periodDp = r2(Array.from(merged.values()).reduce((s, x) => s + x.dp, 0))

          let endDp = 0
          if (isRE) {
            for (const t of allTxns) {
              if (t.is_voided || (rangeEnd && String(t.txn_date || '') > rangeEnd)) continue
              for (const p of postingsOf(t)) if (p.account_qb_id === accIdStr) endDp = r2(endDp + p.amount)
            }
          } else if (isBS) {
            endDp = endMap.get(accIdStr) ?? Number(acc.current_balance || 0)
          } else {
            endDp = periodDp
          }
          const begDp = isBS ? r2(endDp - periodDp) : 0

          const begBal = toNaturalBalance(acc, begDp)
          const finalEndBal = toNaturalBalance(acc, endDp)
          const periodNat = toNaturalBalance(acc, periodDp)

          // Skip completely unused sub-accounts when displaying a large multi-account group (QBO hides empty rows)
          if (
            targetAccounts.length > 5 &&
            acc.account_type !== 'Bank' &&
            merged.size === 0 &&
            Math.abs(begBal) < 0.001 &&
            Math.abs(finalEndBal) < 0.001
          ) {
            continue
          }

          let run = begBal
          const groupTxns = Array.from(merged.values())
            .sort((a, b) => String(a.t.txn_date).localeCompare(String(b.t.txn_date)))
            .map(({ t, p, dp }) => {
              const amt = toNaturalBalance(acc, dp)
              run = r2(run + amt)
              const row = { ...postingRow(t, p, amt, accIdStr), account_name: acc.name || accDisplayName, running_balance: run }
              allFlatRows.push(row)
              return row
            })

          totalBeginningBalance = r2(totalBeginningBalance + begBal)
          totalNetChange = r2(totalNetChange + periodNat)
          totalEndingBalance = r2(totalEndingBalance + finalEndBal)

          groups.push({
            account_id: accIdStr,
            account_qb_id: accIdStr,
            account_name: acc.name,
            fully_qualified_name: accDisplayName,
            account_type: acc.account_type,
            is_balance_sheet: isBS,
            beginning_balance: begBal,
            transactions: groupTxns,
            period_net_change: periodNat,
            ending_balance: finalEndBal,
          })
        }
        if (netIncomeMode) {
          // Net Income = Income − Expenses (income rows natural +, expense rows natural +)
          const ni = r2(groups.reduce((s, g) => s + (isIncomeAccount(ledgerCtx.accounts.get(g.account_qb_id)) ? g.period_net_change : -g.period_net_change), 0))
          totalNetChange = ni
          totalEndingBalance = ni
          totalBeginningBalance = 0
        }
      } else if (targetNameParam) {
        // Fallback name matching if an unmapped category/archive label was clicked
        let runningTotal = 0
        for (const t of activeTxns) {
          if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
          const lines = Array.isArray(t.line_items) && t.line_items.length > 0 ? t.line_items : []
          for (const l of lines) {
            const { categoryName: resolvedCat } = resolveLineAccount(t, l, 'ANY')
            if (
              String(l.account_name || '').toLowerCase() === targetNameParam ||
              resolvedCat.toLowerCase() === targetNameParam
            ) {
              const amt = Number(l.amount ?? t.total_amount ?? 0)
              runningTotal = Number((runningTotal + amt).toFixed(2))
              allFlatRows.push({
                id: t.id,
                qb_txn_id: t.qb_txn_id,
                txn_date: t.txn_date,
                txn_type: t.txn_type,
                doc_number: t.doc_number || l.check_num || '',
                entity_name: l.entity_name || t.entity_name || '—',
                department_name: l.department_name || t.department_name || '',
                class_name: l.class_name || t.class_name || '',
                memo: l.description || t.memo || '',
                account_name: resolvedCat || rawNameParam,
                split_account: t.account_name || t.category_summary || '—',
                amount: Number(amt.toFixed(2)),
                running_balance: runningTotal,
                year: (t.txn_date || '').slice(0, 4),
                cleared_status: t.cleared_status || 'Cleared',
              })
            }
          }
        }
        totalNetChange = runningTotal
        totalEndingBalance = runningTotal
        groups.push({
          account_id: 'FALLBACK',
          account_qb_id: 'FALLBACK',
          account_name: rawNameParam,
          fully_qualified_name: rawNameParam,
          account_type: 'Account',
          is_balance_sheet: false,
          beginning_balance: 0,
          transactions: allFlatRows,
          period_net_change: runningTotal,
          ending_balance: runningTotal,
        })
      }

      return NextResponse.json({
        reportType,
        company,
        account: targetAccounts[0] || null,
        rows: allFlatRows,
        totalAmount: totalNetChange,
        totalBeginningBalance,
        totalEndingBalance,
        count: allFlatRows.length,
        quickReport: {
          title: reportTitle || targetAccounts[0]?.fully_qualified_name || targetAccounts[0]?.name || 'Transaction Report',
          subtitle: `${startDate || 'Inicio'} — ${endDate || 'Hoy'}`,
          isBalanceSheetReport: anyBalanceSheet,
          totalBeginningBalance,
          totalAmount: totalNetChange,
          totalEndingBalance,
          count: allFlatRows.length,
          groups,
          rows: allFlatRows,
        },
      })
    }

    return NextResponse.json({ error: `Unsupported reportType: ${reportType}` }, { status: 400 })
  } catch (err: any) {
    console.error('[GET /api/external-accounting/reports] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
