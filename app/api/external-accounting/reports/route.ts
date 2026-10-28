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
 *
 * @dataFlow
 * Client (/admin/contabilidad-externa) -> GET /api/external-accounting/reports -> Supabase
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeExternalAccounting, computeTransactionAccountDeltas } from '@/lib/external-accounting-auth'

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

    // Fetch transactions for live dynamic reports
    const txns = await fetchAllTxns(supabase, realmId, startDate, endDate)
    const activeTxns = txns.filter(t => !t.is_voided)

    // Helper to enrich a transaction so all lines and header references have resolved `account_qb_id`
    const enrichTxnForDeltas = (t: any) => {
      const rawLines = Array.isArray(t.line_items) ? t.line_items : []
      const enrichedLines = rawLines.map((l: any) => {
        if (l?.account_qb_id && accountTypeMap.has(String(l.account_qb_id))) {
          return { ...l, account_qb_id: String(l.account_qb_id) }
        }
        const { acc } = resolveLineAccount(t, l, 'ANY')
        if (acc?.qb_account_id) {
          return { ...l, account_qb_id: String(acc.qb_account_id), account_name: acc.fully_qualified_name || acc.name }
        }
        return l
      })
      let toAccId = t.to_account_qb_id ? String(t.to_account_qb_id) : undefined
      if ((!toAccId || !accountTypeMap.has(toAccId)) && t.to_account_name) {
        const matchedTo = accountNameMap.get(String(t.to_account_name).toLowerCase())
        if (matchedTo?.qb_account_id) toAccId = String(matchedTo.qb_account_id)
      }
      let primaryAccId = t.account_qb_id ? String(t.account_qb_id) : undefined
      if ((!primaryAccId || !accountTypeMap.has(primaryAccId)) && t.account_name) {
        const matchedPrimary = accountNameMap.get(String(t.account_name).toLowerCase())
        if (matchedPrimary?.qb_account_id) primaryAccId = String(matchedPrimary.qb_account_id)
      }
      return {
        ...t,
        account_qb_id: primaryAccId,
        to_account_qb_id: toAccId,
        line_items: enrichedLines,
      }
    }

    // Helper to compute exact historical Ending Balances as of `endDate` (by rolling back transactions > endDate)
    const computeBalancesAsOfEndDate = async (): Promise<Map<string, number>> => {
      const balMap = new Map<string, number>()
      for (const a of accounts) {
        balMap.set(String(a.qb_account_id), Number(a.current_balance || 0))
      }
      if (!endDate) return balMap

      const afterRows: any[] = []
      let from = 0
      const step = 1000
      while (true) {
        const { data, error } = await supabase
          .from('external_accounting_transactions')
          .select('*')
          .eq('company_realm_id', realmId)
          .gt('txn_date', endDate)
          .order('txn_date', { ascending: true })
          .range(from, from + step - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        afterRows.push(...data)
        if (data.length < step) break
        from += step
      }

      for (const t of afterRows) {
        if (t.is_voided) continue
        const d = computeTransactionAccountDeltas(accountTypeMap, enrichTxnForDeltas(t), -1)
        for (const [id, val] of d.entries()) {
          balMap.set(id, Number(((balMap.get(id) || 0) + val).toFixed(2)))
        }
      }
      return balMap
    }

    // -------------------------------------------------------------------------
    // 1. PROFIT & LOSS (ESTADO DE RESULTADOS) — CON DRILL-DOWN DE TRANSACCIONES POR RENGLÓN
    // -------------------------------------------------------------------------
    if (reportType === 'pnl') {
      const incomeByCategory: Record<string, {
        category: string
        account_qb_id: string | null
        account_type: string
        amount: number
        count: number
        byYear: Record<string, number>
        transactions: any[]
      }> = {}
      const expenseByCategory: Record<string, {
        category: string
        account_qb_id: string | null
        account_type: string
        amount: number
        count: number
        byYear: Record<string, number>
        transactions: any[]
      }> = {}
      const yearsSet = new Set<string>()

      const pushPnlLine = (
        bucket: typeof incomeByCategory,
        catName: string,
        acc: any | null,
        amt: number,
        yr: string,
        t: any,
        l: any
      ) => {
        if (!bucket[catName]) {
          bucket[catName] = {
            category: catName,
            account_qb_id: acc?.qb_account_id ? String(acc.qb_account_id) : null,
            account_type: acc?.account_type || '',
            amount: 0,
            count: 0,
            byYear: {},
            transactions: [],
          }
        }
        const entry = bucket[catName]
        entry.amount = Number((entry.amount + amt).toFixed(2))
        entry.count++
        entry.byYear[yr] = Number(((entry.byYear[yr] || 0) + amt).toFixed(2))
        entry.transactions.push({
          id: t.id,
          qb_txn_id: t.qb_txn_id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number || l?.check_num || '',
          entity_name: l?.entity_name || t.entity_name || '—',
          department_name: l?.department_name || t.department_name || '',
          class_name: l?.class_name || t.class_name || '',
          memo: l?.description || t.memo || '',
          account_name: catName,
          split_account: t.account_name || t.to_account_name || t.category_summary || '—',
          item_name: l?.item_name || '',
          amount: Number(amt.toFixed(2)),
          year: yr,
          cleared_status: t.cleared_status || 'Cleared',
        })
      }

      for (const t of activeTxns) {
        const yr = (t.txn_date || '').slice(0, 4) || 'Unknown'
        yearsSet.add(yr)

        if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue

        // Cash vs Accrual filtering
        if (basis === 'Cash') {
          if (t.txn_type === 'Invoice' || t.txn_type === 'Bill' || t.txn_type === 'CreditMemo' || t.txn_type === 'VendorCredit') continue
        } else {
          // In Accrual, avoid double counting Payment on A/R (Invoice already recorded revenue)
          if (t.txn_type === 'Payment') continue
        }

        const lines = Array.isArray(t.line_items) && t.line_items.length > 0
          ? t.line_items
          : [{ account_name: t.category_summary || t.to_account_name || t.txn_type, amount: t.total_amount, posting_type: null }]

        if (t.txn_type === 'Deposit' || t.txn_type === 'Invoice' || t.txn_type === 'SalesReceipt' || t.txn_type === 'RefundReceipt' || t.txn_type === 'CreditMemo' || (basis === 'Cash' && t.txn_type === 'Payment')) {
          const sign = (t.txn_type === 'RefundReceipt' || t.txn_type === 'CreditMemo') ? -1 : 1
          for (const l of lines) {
            // In Accrual mode, skip Deposit lines that are simply depositing Linked Payments from Undeposited Funds
            if (basis === 'Accrual' && t.txn_type === 'Deposit' && l?.linked_txn_id) continue
            const { acc: matchedAcc, categoryName: cat } = resolveLineAccount(t, l, 'INCOME')
            const lowerCat = cat.toLowerCase()
            if (basis === 'Accrual' && (lowerCat.includes('accounts receivable') || lowerCat.includes('undeposited funds'))) continue
            // If matchedAcc is an Expense/COGS account (e.g. an expense refund deposited), route as negative expense or skip BS only if strict
            const amt = Number(l.amount ?? t.total_amount ?? 0) * sign
            if (amt === 0) continue
            pushPnlLine(incomeByCategory, cat, matchedAcc, amt, yr, t, l)
          }
        } else if (t.txn_type === 'Check' || t.txn_type === 'Expense' || t.txn_type === 'CreditCardExpense' || t.txn_type === 'VendorCredit' || t.txn_type === 'CreditCardCredit' || (basis === 'Accrual' && t.txn_type === 'Bill') || (basis === 'Cash' && t.txn_type === 'BillPayment')) {
          const sign = (t.txn_type === 'VendorCredit' || t.txn_type === 'CreditCardCredit') ? -1 : 1
          for (const l of lines) {
            const { acc: matchedAcc, categoryName: cat } = resolveLineAccount(t, l, 'EXPENSE')
            // Skip balance sheet principal/asset transfers unless classified as Expense/COGS
            if (matchedAcc && ['Bank', 'Fixed Asset', 'Other Asset', 'Equity', 'Long Term Liability'].includes(matchedAcc.account_type)) {
              continue
            }
            const amt = Number(l.amount ?? t.total_amount ?? 0) * sign
            if (amt === 0) continue
            pushPnlLine(expenseByCategory, cat, matchedAcc, amt, yr, t, l)
          }
        } else if (t.txn_type === 'JournalEntry') {
          for (const l of lines) {
            const { acc: matchedAcc, categoryName: cat } = resolveLineAccount(t, l, 'ANY')
            if (!matchedAcc) continue
            const amt = Number(l.amount ?? 0)
            if (amt === 0) continue
            if (matchedAcc.classification === 'Revenue' || matchedAcc.account_type === 'Income' || matchedAcc.account_type === 'Other Income') {
              const signed = l.posting_type === 'Credit' ? amt : -amt
              pushPnlLine(incomeByCategory, cat, matchedAcc, signed, yr, t, l)
            } else if (matchedAcc.classification === 'Expense' || matchedAcc.account_type === 'Expense' || matchedAcc.account_type === 'Cost of Goods Sold' || matchedAcc.account_type === 'Other Expense') {
              const signed = l.posting_type === 'Debit' ? amt : -amt
              pushPnlLine(expenseByCategory, cat, matchedAcc, signed, yr, t, l)
            }
          }
        }
      }

      // Compute chronological running balance inside each category's transaction list
      const finalizeCategoryRows = (rowsObj: typeof incomeByCategory) =>
        Object.values(rowsObj)
          .map(r => {
            let run = 0
            const txnsWithRun = r.transactions.map(tx => {
              run = Number((run + Number(tx.amount || 0)).toFixed(2))
              return { ...tx, running_balance: run }
            })
            return { ...r, transactions: txnsWithRun }
          })
          .sort((a, b) => b.amount - a.amount)

      const incomeRows = finalizeCategoryRows(incomeByCategory)
      const expenseRows = finalizeCategoryRows(expenseByCategory)
      const totalIncome = Number(incomeRows.reduce((s, r) => s + r.amount, 0).toFixed(2))
      const totalExpenses = Number(expenseRows.reduce((s, r) => s + r.amount, 0).toFixed(2))
      const netIncome = Number((totalIncome - totalExpenses).toFixed(2))
      const years = Array.from(yearsSet).sort()

      const incomeByYear: Record<string, number> = {}
      const expenseByYear: Record<string, number> = {}
      const netIncomeByYear: Record<string, number> = {}
      for (const y of years) {
        const incY = Number(incomeRows.reduce((s, r) => s + Number(r.byYear?.[y] || 0), 0).toFixed(2))
        const expY = Number(expenseRows.reduce((s, r) => s + Number(r.byYear?.[y] || 0), 0).toFixed(2))
        incomeByYear[y] = incY
        expenseByYear[y] = expY
        netIncomeByYear[y] = Number((incY - expY).toFixed(2))
      }

      return NextResponse.json({
        reportType,
        company,
        basis,
        startDate,
        endDate,
        availableArchives,
        pnl: {
          years,
          incomeRows,
          expenseRows,
          incomeByYear,
          expenseByYear,
          netIncomeByYear,
          totalIncome,
          totalExpenses,
          netIncome,
        }
      })
    }

    // -------------------------------------------------------------------------
    // 2. BALANCE SHEET (BALANCE GENERAL — JERÁRQUICO QBO CON SALDOS HISTÓRICOS A `endDate`)
    // -------------------------------------------------------------------------
    if (reportType === 'balance_sheet') {
      const endingBalMap = await computeBalancesAsOfEndDate()

      // Compute period deltas in [startDate, endDate] so every Balance Sheet account also knows its Beginning Balance
      const periodDeltaMap = new Map<string, number>()
      for (const t of activeTxns) {
        const d = computeTransactionAccountDeltas(accountTypeMap, enrichTxnForDeltas(t), 1)
        for (const [id, val] of d.entries()) {
          periodDeltaMap.set(id, Number(((periodDeltaMap.get(id) || 0) + val).toFixed(2)))
        }
      }

      const withHistoricalBalance = (a: any) => {
        const idStr = String(a.qb_account_id)
        const endBal = Number((endingBalMap.get(idStr) ?? Number(a.current_balance || 0)).toFixed(2))
        const pDelta = Number((periodDeltaMap.get(idStr) ?? 0).toFixed(2))
        const begBal = Number((endBal - pDelta).toFixed(2))
        return {
          ...a,
          current_balance: endBal,
          balance_as_of: endBal,
          beginning_balance: begBal,
          period_change: pDelta,
        }
      }

      const activeAccounts = accounts.filter(a => a.is_active).map(withHistoricalBalance)

      const assets = activeAccounts.filter(a => a.classification === 'Asset' || ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type))
      const liabilities = activeAccounts.filter(a => a.classification === 'Liability' || ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type))
      const equity = activeAccounts.filter(a => a.classification === 'Equity' || a.account_type === 'Equity')

      // QBO Sub-sections for Assets
      const bankAccounts = assets.filter(a => a.account_type === 'Bank')
      const accountsReceivable = assets.filter(a => a.account_type === 'Accounts Receivable')
      const otherCurrentAssets = assets.filter(a => a.account_type === 'Other Current Asset')
      const fixedAssets = assets.filter(a => a.account_type === 'Fixed Asset')
      const otherAssets = assets.filter(a => a.account_type === 'Other Asset' || (!['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset'].includes(a.account_type)))

      const sumBal = (list: any[]) => Number(list.reduce((s, a) => s + Number(a.current_balance || 0), 0).toFixed(2))

      const totalBankAccounts = sumBal(bankAccounts)
      const totalAccountsReceivable = sumBal(accountsReceivable)
      const totalOtherCurrentAssets = sumBal(otherCurrentAssets)
      const totalCurrentAssets = Number((totalBankAccounts + totalAccountsReceivable + totalOtherCurrentAssets).toFixed(2))
      const totalFixedAssets = sumBal(fixedAssets)
      const totalOtherAssets = sumBal(otherAssets)
      const totalAssets = sumBal(assets)

      // QBO Sub-sections for Liabilities
      const accountsPayable = liabilities.filter(a => a.account_type === 'Accounts Payable')
      const creditCards = liabilities.filter(a => a.account_type === 'Credit Card')
      const otherCurrentLiabilities = liabilities.filter(a => a.account_type === 'Other Current Liability')
      const longTermLiabilities = liabilities.filter(a => a.account_type === 'Long Term Liability' || (!['Accounts Payable', 'Credit Card', 'Other Current Liability'].includes(a.account_type)))

      const totalAccountsPayable = sumBal(accountsPayable)
      const totalCreditCards = sumBal(creditCards)
      const totalOtherCurrentLiabilities = sumBal(otherCurrentLiabilities)
      const totalCurrentLiabilities = Number((totalAccountsPayable + totalCreditCards + totalOtherCurrentLiabilities).toFixed(2))
      const totalLongTermLiabilities = sumBal(longTermLiabilities)
      const totalLiabilities = sumBal(liabilities)

      const statedEquity = sumBal(equity)
      // In QBO, Net Income / Unclosed Retained Earnings bridges Total Assets - (Total Liabilities + Stated Equity)
      const retainedNetIncome = Number((totalAssets - totalLiabilities - statedEquity).toFixed(2))
      const totalEquity = Number((statedEquity + retainedNetIncome).toFixed(2))

      return NextResponse.json({
        reportType,
        company,
        startDate,
        endDate,
        availableArchives,
        balanceSheet: {
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
          retainedNetIncome,
          totalEquity,
          totalLiabilitiesAndEquity: Number((totalLiabilities + totalEquity).toFixed(2)),
        }
      })
    }

    // -------------------------------------------------------------------------
    // 3. BANK REGISTER & RUNNING BALANCE (AUXILIAR BANCARIO)
    // -------------------------------------------------------------------------
    if (reportType === 'bank_register') {
      const bankAccounts = accounts.filter(a => a.account_type === 'Bank' || a.account_type === 'Credit Card')
      const targetAcctId = accountId !== 'ALL' ? accountId : (bankAccounts[0]?.qb_account_id || '')

      const regTxns = activeTxns.filter(t => {
        if (!targetAcctId) return t.direction === 'IN' || t.direction === 'OUT' || t.direction === 'TRANSFER'
        return t.account_qb_id === targetAcctId || t.to_account_qb_id === targetAcctId
      })

      let runningBal = 0
      const registerRows = regTxns.map(t => {
        const amt = Number(t.total_amount || 0)
        let inflow = 0
        let outflow = 0
        if (t.direction === 'IN') {
          inflow = amt
          runningBal = Number((runningBal + amt).toFixed(2))
        } else if (t.direction === 'OUT') {
          outflow = amt
          runningBal = Number((runningBal - amt).toFixed(2))
        } else if (t.direction === 'TRANSFER') {
          if (t.to_account_qb_id === targetAcctId) {
            inflow = amt
            runningBal = Number((runningBal + amt).toFixed(2))
          } else {
            outflow = amt
            runningBal = Number((runningBal - amt).toFixed(2))
          }
        }
        return {
          id: t.id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number,
          entity_name: t.entity_name,
          account_name: t.account_name,
          category_summary: t.category_summary,
          memo: t.memo,
          inflow,
          outflow,
          running_balance: runningBal,
          cleared_status: t.cleared_status,
        }
      })

      const totalIn = Number(registerRows.reduce((s, r) => s + r.inflow, 0).toFixed(2))
      const totalOut = Number(registerRows.reduce((s, r) => s + r.outflow, 0).toFixed(2))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        bankRegister: {
          selectedAccountId: targetAcctId,
          bankAccounts,
          rows: registerRows.reverse(), // Newest at top for UI convenience, with chronological running_balance preserved
          totalInflows: totalIn,
          totalOutflows: totalOut,
          endingBalance: runningBal,
        }
      })
    }

    // -------------------------------------------------------------------------
    // 4. GENERAL LEDGER (LIBRO MAYOR DETALLADO)
    // -------------------------------------------------------------------------
    if (reportType === 'general_ledger') {
      const ledgerByAccount: Record<string, {
        account_name: string
        total_debit: number
        total_credit: number
        net_movement: number
        entries: any[]
      }> = {}

      const addEntry = (acctName: string, entry: { date: string; type: string; doc: string; name: string; memo: string; debit: number; credit: number }) => {
        const key = acctName || 'Uncategorized'
        if (!ledgerByAccount[key]) {
          ledgerByAccount[key] = { account_name: key, total_debit: 0, total_credit: 0, net_movement: 0, entries: [] }
        }
        const g = ledgerByAccount[key]
        g.total_debit = Number((g.total_debit + entry.debit).toFixed(2))
        g.total_credit = Number((g.total_credit + entry.credit).toFixed(2))
        g.net_movement = Number((g.total_debit - g.total_credit).toFixed(2))
        if (g.entries.length < 250) {
          g.entries.push(entry)
        }
      }

      for (const t of activeTxns) {
        if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
        const amt = Number(t.total_amount || 0)
        const rawLines = Array.isArray(t.line_items) ? t.line_items : []
        const lines = rawLines.length > 0
          ? rawLines
          : [{ account_name: t.to_account_name || t.category_summary || (t.direction === 'IN' ? 'Income' : 'Expense'), amount: amt }]

        if (t.txn_type === 'Transfer' || t.txn_type === 'PayDownCreditCard') {
          if (t.account_name) {
            addEntry(t.account_name, {
              date: t.txn_date,
              type: t.txn_type,
              doc: t.doc_number || '',
              name: t.entity_name || '',
              memo: t.memo || '',
              debit: 0,
              credit: amt,
            })
          }
          addEntry(t.to_account_name || t.category_summary || 'Transfer Target', {
            date: t.txn_date,
            type: t.txn_type,
            doc: t.doc_number || '',
            name: t.entity_name || '',
            memo: t.memo || '',
            debit: amt,
            credit: 0,
          })
        } else if (t.direction === 'OUT' || t.txn_type === 'Bill') {
          if (t.account_name) {
            addEntry(t.account_name, {
              date: t.txn_date,
              type: t.txn_type,
              doc: t.doc_number || '',
              name: t.entity_name || '',
              memo: t.memo || '',
              debit: 0,
              credit: amt,
            })
          }
          for (const l of lines) {
            addEntry(l.account_name || t.category_summary || 'Expense', {
              date: t.txn_date,
              type: t.txn_type,
              doc: t.doc_number || '',
              name: l.entity_name || t.entity_name || '',
              memo: l.description || t.memo || '',
              debit: Number(l.amount ?? amt),
              credit: 0,
            })
          }
        } else if (t.direction === 'IN' || t.txn_type === 'Invoice') {
          if (t.account_name) {
            addEntry(t.account_name, {
              date: t.txn_date,
              type: t.txn_type,
              doc: t.doc_number || '',
              name: t.entity_name || '',
              memo: t.memo || '',
              debit: amt,
              credit: 0,
            })
          }
          for (const l of lines) {
            addEntry(l.account_name || t.category_summary || 'Income', {
              date: t.txn_date,
              type: t.txn_type,
              doc: t.doc_number || '',
              name: l.entity_name || t.entity_name || '',
              memo: l.description || t.memo || '',
              debit: 0,
              credit: Number(l.amount ?? amt),
            })
          }
        } else if (t.txn_type === 'JournalEntry') {
          for (const l of rawLines) {
            const lAmt = Number(l.amount ?? 0)
            addEntry(l.account_name || 'Journal Account', {
              date: t.txn_date,
              type: 'JournalEntry',
              doc: t.doc_number || '',
              name: l.entity_name || t.entity_name || '',
              memo: l.description || t.memo || '',
              debit: l.posting_type === 'Debit' ? lAmt : 0,
              credit: l.posting_type === 'Credit' ? lAmt : 0,
            })
          }
        }
      }

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        generalLedger: Object.values(ledgerByAccount).sort((a, b) => a.account_name.localeCompare(b.account_name))
      })
    }

    // -------------------------------------------------------------------------
    // 5. TRIAL BALANCE (BALANZA DE COMPROBACIÓN)
    // -------------------------------------------------------------------------
    if (reportType === 'trial_balance') {
      const endingBalMap = await computeBalancesAsOfEndDate()
      const tbRows = accounts
        .filter(a => {
          const b = endingBalMap.get(String(a.qb_account_id)) ?? Number(a.current_balance || 0)
          return a.is_active && Math.abs(b) > 0.001
        })
        .map(a => {
          const bal = Number((endingBalMap.get(String(a.qb_account_id)) ?? Number(a.current_balance || 0)).toFixed(2))
          const isNormalDebit = ['Asset', 'Expense'].includes(a.classification || '') || ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset', 'Expense', 'Cost of Goods Sold', 'Other Expense'].includes(a.account_type)
          let debit = 0
          let credit = 0
          if (isNormalDebit) {
            if (bal >= 0) debit = bal
            else credit = Math.abs(bal)
          } else {
            if (bal >= 0) credit = bal
            else debit = Math.abs(bal)
          }
          return {
            account_id: a.qb_account_id,
            acct_num: a.acct_num,
            name: a.name,
            fully_qualified_name: a.fully_qualified_name || a.name,
            account_type: a.account_type,
            debit: Number(debit.toFixed(2)),
            credit: Number(credit.toFixed(2)),
          }
        })

      const totalDebit = Number(tbRows.reduce((s, r) => s + r.debit, 0).toFixed(2))
      const totalCredit = Number(tbRows.reduce((s, r) => s + r.credit, 0).toFixed(2))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        trialBalance: {
          rows: tbRows,
          totalDebit,
          totalCredit,
        }
      })
    }

    // -------------------------------------------------------------------------
    // 6. VENDOR EXPENSES SUMMARY (RESUMEN POR PROVEEDOR / 1099) & CUSTOMER INCOME
    // -------------------------------------------------------------------------
    if (reportType === 'vendor_expenses' || reportType === 'customer_income') {
      const isVendor = reportType === 'vendor_expenses'
      const contactMap = new Map<string, any>()
      for (const c of contacts) {
        contactMap.set((c.display_name || '').toLowerCase(), c)
      }

      const agg: Record<string, {
        name: string
        count: number
        total_amount: number
        last_date: string
        tax_identifier: string | null
        vendor_1099: boolean
        categories: Set<string>
        transactions: any[]
      }> = {}

      for (const t of activeTxns) {
        if (t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder' || t.direction === 'NON_POSTING') continue
        if (isVendor && t.direction !== 'OUT' && t.txn_type !== 'Bill') continue
        if (!isVendor && t.direction !== 'IN' && t.txn_type !== 'Invoice') continue
        const name = (t.entity_name || 'Sin Beneficiario Especificado').trim()
        const amt = Number(t.total_amount || 0)
        if (amt === 0) continue

        if (!agg[name]) {
          const matchedContact = contactMap.get(name.toLowerCase())
          agg[name] = {
            name,
            count: 0,
            total_amount: 0,
            last_date: t.txn_date,
            tax_identifier: matchedContact?.tax_identifier || null,
            vendor_1099: Boolean(matchedContact?.vendor_1099),
            categories: new Set<string>(),
            transactions: [],
          }
        }
        agg[name].count++
        agg[name].total_amount = Number((agg[name].total_amount + amt).toFixed(2))
        if (t.txn_date > agg[name].last_date) agg[name].last_date = t.txn_date
        if (t.category_summary) agg[name].categories.add(t.category_summary)
        agg[name].transactions.push({
          id: t.id,
          qb_txn_id: t.qb_txn_id,
          txn_date: t.txn_date,
          txn_type: t.txn_type,
          doc_number: t.doc_number || '',
          entity_name: name,
          department_name: t.department_name || '',
          class_name: t.class_name || '',
          memo: t.memo || '',
          account_name: t.category_summary || t.to_account_name || '—',
          split_account: t.account_name || '—',
          amount: amt,
          year: (t.txn_date || '').slice(0, 4),
          cleared_status: t.cleared_status || 'Cleared',
        })
      }

      const rows = Object.values(agg)
        .map(r => {
          let run = 0
          const txnsWithRun = r.transactions.map(tx => {
            run = Number((run + Number(tx.amount || 0)).toFixed(2))
            return { ...tx, running_balance: run }
          })
          return {
            ...r,
            categories: Array.from(r.categories).slice(0, 3).join(', '),
            transactions: txnsWithRun,
          }
        })
        .sort((a, b) => b.total_amount - a.total_amount)

      const grandTotal = Number(rows.reduce((s, r) => s + r.total_amount, 0).toFixed(2))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        entitySummary: {
          rows,
          grandTotal,
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

      const endingBalMap = await computeBalancesAsOfEndDate()

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
            const hdrDeptId = String(t.department_qb_id || t.raw_data?.DepartmentRef?.value || '')
            const hdrDeptName = String(t.department_name || t.raw_data?.DepartmentRef?.name || '').toLowerCase()
            const strippedVal = valLower.replace(/^\d+\s*[-:]\s*/, '').trim()
            const matchesLocText = (candidate: string) => {
              if (!candidate || !valLower) return false
              if (candidate === valLower || candidate.includes(valLower)) return true
              if (strippedVal.length >= 4 && candidate.includes(strippedVal)) return true
              return false
            }
            if ((filterId && hdrDeptId === filterId) || matchesLocText(hdrDeptName)) {
              matched = true
              if (t.direction === 'OUT') matchedAmt = -Math.abs(matchedAmt)
            } else {
              let lineSum = 0
              for (const l of lines) {
                const lDeptId = String(l.department_qb_id || '')
                const lDeptName = String(l.department_name || '').toLowerCase()
                const lAccName = String(l.account_name || '').toLowerCase()
                if ((filterId && lDeptId === filterId) || matchesLocText(lDeptName) || matchesLocText(lAccName)) {
                  matched = true
                  lineSum += Number(l.amount || 0)
                  matchedAcct = l.account_name || matchedAcct
                }
              }
              if (!matched) {
                const hdrAccName = `${t.account_name || ''} ${t.to_account_name || ''}`.toLowerCase()
                if (matchesLocText(hdrAccName)) {
                  matched = true
                  if (t.direction === 'OUT') matchedAmt = -Math.abs(matchedAmt)
                }
              } else if (lineSum !== 0) {
                matchedAmt = lineSum
              }
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
              class_name: t.class_name || '',
              memo: matchedMemo,
              account_name: matchedAcct,
              split_account: matchedSplit,
              amount: Number(matchedAmt.toFixed(2)),
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
        return null
      }

      let targetAccounts: any[] = []
      let reportTitle = rawNameParam || ''

      const groupByAccountId = accountId && accountId !== 'ALL' ? resolveGroupToken(accountId) : null
      const groupByName = !groupByAccountId && rawNameParam ? resolveGroupToken(rawNameParam) : null
      const resolvedGroup = groupByAccountId || groupByName

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
          // Include baseAccount AND any descendant sub-accounts (e.g. Prepaid Expenses -> Prepaid Tax-Federal, etc.)
          const descendants = accounts.filter(
            a =>
              String(a.qb_account_id) !== baseId &&
              (String(a.parent_qb_id || '') === baseId ||
                String(a.fully_qualified_name || '').toLowerCase().startsWith(`${baseFqLower}:`))
          )
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
        // Pre-enrich activeTxns once for fast delta calculation across target accounts
        const enrichedActiveTxns = activeTxns
          .filter(t => t.txn_type !== 'Estimate' && t.txn_type !== 'PurchaseOrder' && t.direction !== 'NON_POSTING')
          .map(t => ({ raw: t, enriched: enrichTxnForDeltas(t) }))

        for (const acc of targetAccounts) {
          const accIdStr = String(acc.qb_account_id)
          const isBS = isBalanceSheetAccount(acc)
          if (isBS) anyBalanceSheet = true

          const endBal = isBS ? Number((endingBalMap.get(accIdStr) ?? Number(acc.current_balance || 0)).toFixed(2)) : 0
          const accDisplayName = acc.fully_qualified_name || acc.name || ''
          const groupTxnsRaw: any[] = []
          let periodDeltaSum = 0

          for (const { raw: t, enriched } of enrichedActiveTxns) {
            const deltas = computeTransactionAccountDeltas(accountTypeMap, enriched, 1)
            const deltaOnAcc = deltas.get(accIdStr) || 0
            if (Math.abs(deltaOnAcc) < 0.0001) continue

            periodDeltaSum = Number((periodDeltaSum + deltaOnAcc).toFixed(2))

            const lines: any[] = Array.isArray(enriched.line_items) ? enriched.line_items : []
            const isHeaderAccount = String(enriched.account_qb_id || '') === accIdStr

            // Determine QBO "Item split account" and line description
            let splitAccountLabel = '—'
            let lineMemo = t.memo || ''
            let lineEntity = t.entity_name || '—'
            let lineDoc = t.doc_number || ''
            let lineDept = t.department_name || ''
            let lineClass = t.class_name || ''

            if (isHeaderAccount) {
              const distinctLineAccounts = Array.from(
                new Set(
                  lines
                    .map((l: any) => String(l.account_name || '').trim())
                    .filter(Boolean)
                )
              )
              if (distinctLineAccounts.length > 1) {
                splitAccountLabel = '-Split-'
              } else if (distinctLineAccounts.length === 1) {
                splitAccountLabel = distinctLineAccounts[0]
              } else {
                splitAccountLabel = t.to_account_name || t.category_summary || '—'
              }
              if (!lineMemo && lines[0]?.description) lineMemo = lines[0].description
              if ((!lineEntity || lineEntity === '—') && lines[0]?.entity_name) lineEntity = lines[0].entity_name
              if (!lineDoc && lines[0]?.check_num) lineDoc = lines[0].check_num
            } else {
              splitAccountLabel = t.account_name || t.to_account_name || t.category_summary || '—'
              const matchingLine = lines.find((l: any) => String(l.account_qb_id || '') === accIdStr)
              if (matchingLine) {
                if (matchingLine.description) lineMemo = matchingLine.description
                if (matchingLine.entity_name) lineEntity = matchingLine.entity_name
                if (matchingLine.check_num && !lineDoc) lineDoc = matchingLine.check_num
                if (matchingLine.department_name) lineDept = matchingLine.department_name
                if (matchingLine.class_name) lineClass = matchingLine.class_name
              }
            }

            groupTxnsRaw.push({
              id: t.id,
              qb_txn_id: t.qb_txn_id,
              txn_date: t.txn_date,
              txn_type: t.txn_type,
              doc_number: lineDoc,
              entity_name: lineEntity,
              department_name: lineDept,
              class_name: lineClass,
              memo: lineMemo,
              account_name: acc.name || accDisplayName,
              split_account: splitAccountLabel,
              amount: Number(deltaOnAcc.toFixed(2)),
              year: (t.txn_date || '').slice(0, 4),
              cleared_status: t.cleared_status || 'Cleared',
            })
          }

          const begBal = isBS ? Number((endBal - periodDeltaSum).toFixed(2)) : 0

          // Skip completely zero inactive/unused sub-accounts when displaying a huge multi-account group (unless it's a Bank account or single-account report)
          if (
            targetAccounts.length > 5 &&
            acc.account_type !== 'Bank' &&
            groupTxnsRaw.length === 0 &&
            Math.abs(begBal) < 0.001 &&
            Math.abs(endBal) < 0.001
          ) {
            continue
          }

          let run = begBal
          const groupTxns = groupTxnsRaw.map(tx => {
            run = Number((run + tx.amount).toFixed(2))
            const rowWithRun = { ...tx, running_balance: run }
            allFlatRows.push(rowWithRun)
            return rowWithRun
          })

          const finalEndBal = isBS ? endBal : periodDeltaSum

          totalBeginningBalance = Number((totalBeginningBalance + begBal).toFixed(2))
          totalNetChange = Number((totalNetChange + periodDeltaSum).toFixed(2))
          totalEndingBalance = Number((totalEndingBalance + finalEndBal).toFixed(2))

          groups.push({
            account_id: accIdStr,
            account_qb_id: accIdStr,
            account_name: acc.name,
            fully_qualified_name: accDisplayName,
            account_type: acc.account_type,
            is_balance_sheet: isBS,
            beginning_balance: begBal,
            transactions: groupTxns,
            period_net_change: periodDeltaSum,
            ending_balance: finalEndBal,
          })
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
