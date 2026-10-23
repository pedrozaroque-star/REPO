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
    const { searchParams } = new URL(req.url)

    const realmId = searchParams.get('realmId')
    const reportType = searchParams.get('reportType') || 'pnl'
    const startDate = searchParams.get('startDate') || null
    const endDate = searchParams.get('endDate') || null
    const basis = (searchParams.get('basis') || 'Accrual') as 'Accrual' | 'Cash'
    const accountId = searchParams.get('accountId') || 'ALL'
    const qboArchiveKey = searchParams.get('qboArchiveKey') || 'ProfitAndLoss_ByYear_Accrual'

    if (!realmId) {
      return NextResponse.json({ error: 'Missing realmId' }, { status: 400 })
    }

    // Fetch company, accounts, contacts, and available archive keys
    const [compRes, accRes, conRes, archListRes] = await Promise.all([
      supabase.from('external_accounting_companies').select('*').eq('realm_id', realmId).maybeSingle(),
      supabase.from('external_accounting_accounts').select('*').eq('company_realm_id', realmId).order('name'),
      supabase.from('external_accounting_contacts').select('*').eq('company_realm_id', realmId).order('display_name'),
      supabase.from('external_accounting_reports_archive').select('report_key, report_title, accounting_method, start_date, end_date').eq('company_realm_id', realmId).order('report_key')
    ])

    const company = compRes.data
    const accounts = accRes.data || []
    const contacts = conRes.data || []
    const availableArchives = archListRes.data || []

    const accountTypeMap = new Map<string, any>()
    const accountNameMap = new Map<string, any>()
    for (const a of accounts) {
      accountTypeMap.set(a.qb_account_id, a)
      accountNameMap.set((a.name || '').toLowerCase(), a)
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

    // -------------------------------------------------------------------------
    // 1. PROFIT & LOSS (ESTADO DE RESULTADOS)
    // -------------------------------------------------------------------------
    if (reportType === 'pnl') {
      const incomeByCategory: Record<string, { category: string; amount: number; count: number; byYear: Record<string, number> }> = {}
      const expenseByCategory: Record<string, { category: string; amount: number; count: number; byYear: Record<string, number> }> = {}
      const yearsSet = new Set<string>()

      for (const t of activeTxns) {
        const yr = (t.txn_date || '').slice(0, 4) || 'Unknown'
        yearsSet.add(yr)

        // Cash vs Accrual filtering
        if (basis === 'Cash') {
          if (t.txn_type === 'Invoice' || t.txn_type === 'Bill') continue
        } else {
          // In Accrual, if company uses Invoices (like Gutierrez Financial), avoid double counting Payment + Deposit on A/R
          if (t.txn_type === 'Payment') continue
        }

        const lines = Array.isArray(t.line_items) && t.line_items.length > 0
          ? t.line_items
          : [{ account_name: t.category_summary || t.to_account_name || t.txn_type, amount: t.total_amount, posting_type: null }]

        if (t.txn_type === 'Deposit' || t.txn_type === 'Invoice' || t.txn_type === 'SalesReceipt') {
          for (const l of lines) {
            const cat = l.account_name || t.category_summary || 'Operating Income'
            if (cat.toLowerCase().includes('accounts receivable') && basis === 'Accrual') continue
            const amt = Number(l.amount || 0)
            if (amt === 0) continue
            if (!incomeByCategory[cat]) incomeByCategory[cat] = { category: cat, amount: 0, count: 0, byYear: {} }
            incomeByCategory[cat].amount = Number((incomeByCategory[cat].amount + amt).toFixed(2))
            incomeByCategory[cat].count++
            incomeByCategory[cat].byYear[yr] = Number(((incomeByCategory[cat].byYear[yr] || 0) + amt).toFixed(2))
          }
        } else if (t.txn_type === 'Check' || t.txn_type === 'Expense' || t.txn_type === 'CreditCardExpense' || (basis === 'Accrual' && t.txn_type === 'Bill') || (basis === 'Cash' && t.txn_type === 'BillPayment')) {
          for (const l of lines) {
            const cat = l.account_name || t.category_summary || 'Operating Expense'
            const matchedAcc = accountNameMap.get(cat.toLowerCase())
            // Skip balance sheet principal/asset transfers unless classified as Expense/COGS
            if (matchedAcc && ['Bank', 'Fixed Asset', 'Other Asset', 'Equity', 'Long Term Liability'].includes(matchedAcc.account_type)) {
              continue
            }
            const amt = Number(l.amount || t.total_amount || 0)
            if (amt === 0) continue
            if (!expenseByCategory[cat]) expenseByCategory[cat] = { category: cat, amount: 0, count: 0, byYear: {} }
            expenseByCategory[cat].amount = Number((expenseByCategory[cat].amount + amt).toFixed(2))
            expenseByCategory[cat].count++
            expenseByCategory[cat].byYear[yr] = Number(((expenseByCategory[cat].byYear[yr] || 0) + amt).toFixed(2))
          }
        } else if (t.txn_type === 'JournalEntry') {
          for (const l of lines) {
            const cat = l.account_name || ''
            const matchedAcc = accountNameMap.get(cat.toLowerCase())
            if (!matchedAcc) continue
            const amt = Number(l.amount || 0)
            if (matchedAcc.classification === 'Revenue' || matchedAcc.account_type === 'Income' || matchedAcc.account_type === 'Other Income') {
              const signed = l.posting_type === 'Credit' ? amt : -amt
              if (!incomeByCategory[cat]) incomeByCategory[cat] = { category: cat, amount: 0, count: 0, byYear: {} }
              incomeByCategory[cat].amount = Number((incomeByCategory[cat].amount + signed).toFixed(2))
              incomeByCategory[cat].count++
              incomeByCategory[cat].byYear[yr] = Number(((incomeByCategory[cat].byYear[yr] || 0) + signed).toFixed(2))
            } else if (matchedAcc.classification === 'Expense' || matchedAcc.account_type === 'Expense' || matchedAcc.account_type === 'Cost of Goods Sold' || matchedAcc.account_type === 'Other Expense') {
              const signed = l.posting_type === 'Debit' ? amt : -amt
              if (!expenseByCategory[cat]) expenseByCategory[cat] = { category: cat, amount: 0, count: 0, byYear: {} }
              expenseByCategory[cat].amount = Number((expenseByCategory[cat].amount + signed).toFixed(2))
              expenseByCategory[cat].count++
              expenseByCategory[cat].byYear[yr] = Number(((expenseByCategory[cat].byYear[yr] || 0) + signed).toFixed(2))
            }
          }
        }
      }

      const incomeRows = Object.values(incomeByCategory).sort((a, b) => b.amount - a.amount)
      const expenseRows = Object.values(expenseByCategory).sort((a, b) => b.amount - a.amount)
      const totalIncome = Number(incomeRows.reduce((s, r) => s + r.amount, 0).toFixed(2))
      const totalExpenses = Number(expenseRows.reduce((s, r) => s + r.amount, 0).toFixed(2))
      const netIncome = Number((totalIncome - totalExpenses).toFixed(2))
      const years = Array.from(yearsSet).sort()

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
          totalIncome,
          totalExpenses,
          netIncome,
        }
      })
    }

    // -------------------------------------------------------------------------
    // 2. BALANCE SHEET (BALANCE GENERAL)
    // -------------------------------------------------------------------------
    if (reportType === 'balance_sheet') {
      const assets = accounts.filter(a => a.is_active && (a.classification === 'Asset' || ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(a.account_type)))
      const liabilities = accounts.filter(a => a.is_active && (a.classification === 'Liability' || ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(a.account_type)))
      const equity = accounts.filter(a => a.is_active && (a.classification === 'Equity' || a.account_type === 'Equity'))

      const totalAssets = Number(assets.reduce((s, a) => s + Number(a.current_balance || 0), 0).toFixed(2))
      const totalLiabilities = Number(liabilities.reduce((s, a) => s + Number(a.current_balance || 0), 0).toFixed(2))
      const statedEquity = Number(equity.reduce((s, a) => s + Number(a.current_balance || 0), 0).toFixed(2))
      // In QBO, Net Income / Unclosed Retained Earnings bridges Total Assets - (Total Liabilities + Stated Equity)
      const retainedNetIncome = Number((totalAssets - totalLiabilities - statedEquity).toFixed(2))
      const totalEquity = Number((statedEquity + retainedNetIncome).toFixed(2))

      return NextResponse.json({
        reportType,
        company,
        availableArchives,
        balanceSheet: {
          assets,
          liabilities,
          equity,
          totalAssets,
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
        const amt = Number(t.total_amount || 0)
        const lines = Array.isArray(t.line_items) ? t.line_items : []

        if (t.direction === 'OUT') {
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
              debit: Number(l.amount || amt),
              credit: 0,
            })
          }
        } else if (t.direction === 'IN') {
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
              credit: Number(l.amount || amt),
            })
          }
        } else if (t.txn_type === 'JournalEntry') {
          for (const l of lines) {
            const lAmt = Number(l.amount || 0)
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
      const tbRows = accounts
        .filter(a => a.is_active && Math.abs(Number(a.current_balance || 0)) > 0.001)
        .map(a => {
          const bal = Number(a.current_balance || 0)
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
      }> = {}

      for (const t of activeTxns) {
        if (isVendor && t.direction !== 'OUT') continue
        if (!isVendor && t.direction !== 'IN') continue
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
            categories: new Set<string>()
          }
        }
        agg[name].count++
        agg[name].total_amount = Number((agg[name].total_amount + amt).toFixed(2))
        if (t.txn_date > agg[name].last_date) agg[name].last_date = t.txn_date
        if (t.category_summary) agg[name].categories.add(t.category_summary)
      }

      const rows = Object.values(agg)
        .map(r => ({
          ...r,
          categories: Array.from(r.categories).slice(0, 3).join(', ')
        }))
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

    return NextResponse.json({ error: `Unsupported reportType: ${reportType}` }, { status: 400 })
  } catch (err: any) {
    console.error('[GET /api/external-accounting/reports] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
