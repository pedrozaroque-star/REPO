/**
 * @module api/external-accounting
 * @description API principal del módulo CONTABILIDAD EXTERNA exclusivo para Raquel Velazquez, Roberto Velazquez y Roque.
 * Gestiona las 8 razones sociales (mini compañías) migradas al 100% desde Intuit QuickBooks Online:
 * - Raquel Accounting (123145825185692)
 * - 7947 Downey Plaza LLC (123145858055022)
 * - Canasty Financial, LLC (193514841181564)
 * - Chicken Taco Catering LLC (193514304333307)
 * - Elveze LLC (9130355308251406)
 * - Govegu LLC (9130357603135416)
 * - Gutierrez Financial (554651555)
 * - TEG Holdings Inc (9130357696871496)
 *
 * @businessRules
 * - Soporta creación, edición, conciliación (`Cleared`/`Reconciled`), anulación (`VOID`) y eliminación de:
 *   Cheques (`Check`), Depósitos (`Deposit`), Gastos/Salidas (`Expense`/`CreditCardExpense`),
 *   Transferencias (`Transfer`), Pólizas de Diario (`JournalEntry`), Facturas a Clientes (`Invoice`),
 *   Cobros Recibidos (`Payment`), Facturas de Proveedor (`Bill`) y Pagos de Facturas (`BillPayment`).
 * - Motor contable de partida doble (`applyTransactionBalanceImpacts`): actualiza automáticamente el saldo
 *   (`current_balance`) tanto de la cuenta bancaria/origen como de las cuentas contables de desglose (`line_items`).
 * - Calcula el Saldo Acumulado (`running_balance`) sobre el libro completo de la compañía antes de aplicar filtros
 *   de fecha o búsqueda, garantizando precisión al centavo en todo momento.
 *
 * @dataFlow
 * Client (/admin/contabilidad-externa) <-> /api/external-accounting <-> Supabase (external_accounting_*)
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

async function fetchAllCompanyTransactions(
  supabase: ReturnType<typeof getAdminSupabase>,
  realmId: string
) {
  const allRows: any[] = []
  let from = 0
  const step = 1000

  while (true) {
    const { data, error } = await supabase
      .from('external_accounting_transactions')
      .select('id, company_realm_id, txn_type, qb_entity_type, qb_txn_id, txn_date, due_date, doc_number, payment_type, direction, account_qb_id, account_name, to_account_qb_id, to_account_name, entity_qb_id, entity_name, entity_type, department_qb_id, department_name, total_amount, open_balance, memo, category_summary, print_status, cleared_status, is_voided, line_items, created_by, created_at')
      .eq('company_realm_id', realmId)
      .order('txn_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + step - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < step) break
    from += step
  }

  return allRows
}

function isLiabilityEquityOrRevenue(acc: { classification?: string | null; account_type?: string | null }) {
  const cls = (acc.classification || '').toLowerCase()
  const t = (acc.account_type || '').toLowerCase()
  if (cls === 'liability' || cls === 'equity' || cls === 'revenue') return true
  return [
    'credit card',
    'accounts payable',
    'other current liability',
    'long term liability',
    'equity',
    'income',
    'other income',
  ].includes(t)
}

async function adjustSingleAccountBalance(
  supabase: ReturnType<typeof getAdminSupabase>,
  realmId: string,
  accountQbId: string | null | undefined,
  debitMinusCreditDelta: number
) {
  if (!accountQbId || !Number.isFinite(debitMinusCreditDelta) || Math.abs(debitMinusCreditDelta) < 0.001) return
  const { data: acc } = await supabase
    .from('external_accounting_accounts')
    .select('id, current_balance, classification, account_type')
    .eq('company_realm_id', realmId)
    .eq('qb_account_id', accountQbId)
    .maybeSingle()

  if (!acc) return
  // In standard accounting:
  // Normal Debit accounts (Asset, Bank, Expense, COGS) increase with Debit (+debitMinusCreditDelta) and decrease with Credit.
  // Normal Credit accounts (Liability, Credit Card, A/P, Equity, Income) increase with Credit (-debitMinusCreditDelta).
  const normalCredit = isLiabilityEquityOrRevenue(acc)
  const signedChange = normalCredit ? -debitMinusCreditDelta : debitMinusCreditDelta
  const nextBal = Number((Number(acc.current_balance || 0) + signedChange).toFixed(2))

  await supabase
    .from('external_accounting_accounts')
    .update({ current_balance: nextBal, updated_at: new Date().toISOString() })
    .eq('id', acc.id)
}

/**
 * Applies (multiplier = +1) or reverses (multiplier = -1) the double-entry balance impact of a transaction.
 */
async function applyTransactionBalanceImpacts(
  supabase: ReturnType<typeof getAdminSupabase>,
  realmId: string,
  txn: any,
  multiplier: 1 | -1
) {
  if (!txn || txn.is_voided) return
  const amt = Number(txn.total_amount || 0)
  if (!Number.isFinite(amt) || Math.abs(amt) < 0.001) return

  const tType = txn.txn_type
  const lines = Array.isArray(txn.line_items) ? txn.line_items : []

  if (tType === 'Transfer') {
    // Credit From-Account (-amt), Debit To-Account (+amt)
    await adjustSingleAccountBalance(supabase, realmId, txn.account_qb_id, -amt * multiplier)
    if (txn.to_account_qb_id) {
      await adjustSingleAccountBalance(supabase, realmId, txn.to_account_qb_id, amt * multiplier)
    }
    return
  }

  if (tType === 'JournalEntry') {
    for (const l of lines) {
      const lAmt = Number(l.amount || 0)
      if (!l.account_qb_id || !Number.isFinite(lAmt) || Math.abs(lAmt) < 0.001) continue
      const debitMinusCredit = l.posting_type === 'Credit' ? -lAmt : lAmt
      await adjustSingleAccountBalance(supabase, realmId, l.account_qb_id, debitMinusCredit * multiplier)
    }
    return
  }

  if (txn.direction === 'OUT') {
    // Check, Expense, CreditCardExpense, BillPayment: Credit Bank/Card (-amt), Debit Line Accounts (+lAmt)
    await adjustSingleAccountBalance(supabase, realmId, txn.account_qb_id, -amt * multiplier)
    for (const l of lines) {
      const lAmt = Number(l.amount || 0)
      if (l.account_qb_id && l.account_qb_id !== txn.account_qb_id && Math.abs(lAmt) >= 0.001) {
        // Only Balance Sheet GL accounts carry a persistent current_balance in QBO Account list,
        // but updating any matched account keeps GL balances in sync
        await adjustSingleAccountBalance(supabase, realmId, l.account_qb_id, lAmt * multiplier)
      }
    }
    return
  }

  if (txn.direction === 'IN') {
    // Deposit, Payment, SalesReceipt: Debit Bank (+amt), Credit Line Accounts (-lAmt)
    await adjustSingleAccountBalance(supabase, realmId, txn.account_qb_id, amt * multiplier)
    for (const l of lines) {
      const lAmt = Number(l.amount || 0)
      if (l.account_qb_id && l.account_qb_id !== txn.account_qb_id && Math.abs(lAmt) >= 0.001) {
        await adjustSingleAccountBalance(supabase, realmId, l.account_qb_id, -lAmt * multiplier)
      }
    }
    return
  }

  if (tType === 'Invoice') {
    // Debit Accounts Receivable (+amt)
    await adjustSingleAccountBalance(supabase, realmId, txn.account_qb_id, amt * multiplier)
  } else if (tType === 'Bill') {
    // Credit Accounts Payable (-amt -> increases A/P liability)
    await adjustSingleAccountBalance(supabase, realmId, txn.account_qb_id, -amt * multiplier)
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()
    const { searchParams } = new URL(req.url)

    const requestedRealmId = searchParams.get('realmId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const txnType = searchParams.get('txnType') || 'ALL'
    const direction = searchParams.get('direction') || 'ALL'
    const accountId = searchParams.get('accountId') || 'ALL'
    const search = (searchParams.get('search') || '').trim().toLowerCase()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 300), 10), 2500)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    // 1. Fetch all 8 companies
    const { data: companies, error: compErr } = await supabase
      .from('external_accounting_companies')
      .select('*')
      .order('company_name')

    if (compErr) throw compErr

    // Fetch all active accounts across all companies for the top overview cards
    const { data: allAccounts, error: allAccErr } = await supabase
      .from('external_accounting_accounts')
      .select('company_realm_id, qb_account_id, name, acct_num, classification, account_type, account_sub_type, current_balance, is_active')
      .eq('is_active', true)

    if (allAccErr) throw allAccErr

    const companyOverviewMap: Record<string, {
      bankAccountsCount: number
      totalBankBalance: number
      bankAccounts: any[]
      totalAccountsCount: number
    }> = {}

    for (const c of companies || []) {
      companyOverviewMap[c.realm_id] = {
        bankAccountsCount: 0,
        totalBankBalance: 0,
        bankAccounts: [],
        totalAccountsCount: 0,
      }
    }

    for (const acc of allAccounts || []) {
      const entry = companyOverviewMap[acc.company_realm_id]
      if (!entry) continue
      entry.totalAccountsCount++
      if (acc.account_type === 'Bank') {
        entry.bankAccountsCount++
        entry.totalBankBalance = Number((entry.totalBankBalance + Number(acc.current_balance || 0)).toFixed(2))
        entry.bankAccounts.push(acc)
      }
    }

    const enrichedCompanies = (companies || []).map(c => ({
      ...c,
      overview: companyOverviewMap[c.realm_id] || {
        bankAccountsCount: 0,
        totalBankBalance: 0,
        bankAccounts: [],
        totalAccountsCount: 0,
      }
    }))

    const activeRealmId = requestedRealmId || enrichedCompanies.find(c => c.slug === '7947_downey_plaza_llc')?.realm_id || enrichedCompanies[0]?.realm_id
    if (!activeRealmId) {
      return NextResponse.json({ companies: [], accounts: [], contacts: [], recurring: [], transactions: [], summary: {} })
    }

    // 2. Fetch active company's Accounts, Contacts, Recurring
    const [accountsRes, contactsRes, recurringRes] = await Promise.all([
      supabase
        .from('external_accounting_accounts')
        .select('id, company_realm_id, qb_account_id, name, fully_qualified_name, acct_num, classification, account_type, account_sub_type, current_balance, initial_qbo_balance, is_sub_account, parent_qb_id, is_active')
        .eq('company_realm_id', activeRealmId)
        .order('name'),
      supabase
        .from('external_accounting_contacts')
        .select('id, company_realm_id, contact_type, qb_contact_id, display_name, company_name, print_on_check_name, email, phone, address, tax_identifier, vendor_1099, acct_num, balance, is_active')
        .eq('company_realm_id', activeRealmId)
        .order('display_name'),
      supabase
        .from('external_accounting_recurring')
        .select('id, company_realm_id, qb_recurring_id, template_name, recur_type, txn_type, interval_type, num_interval, day_of_week, day_of_month, previous_date, next_date, start_date, account_qb_id, account_name, entity_qb_id, entity_name, department_name, amount, memo, line_items, is_active')
        .eq('company_realm_id', activeRealmId)
        .order('template_name')
    ])

    if (accountsRes.error) throw accountsRes.error
    if (contactsRes.error) throw contactsRes.error
    if (recurringRes.error) throw recurringRes.error

    // 3. Fetch full company ledger to compute exact chronological running balances first
    const allCompanyTxns = await fetchAllCompanyTransactions(supabase, activeRealmId)

    const accountsList = accountsRes.data || []
    const runningCursor = new Map<string, number>()
    for (const a of accountsList) {
      runningCursor.set(a.qb_account_id, Number(a.current_balance || 0))
    }

    // Walk backwards from current_balance on the full unfiltered ledger so every row gets its exact historical running_balance
    const txnsWithRunningBalance = allCompanyTxns.map(t => {
      const primaryAcctId = (accountId !== 'ALL' && t.to_account_qb_id === accountId)
        ? t.to_account_qb_id
        : (t.account_qb_id || '')
      const currentRun = runningCursor.has(primaryAcctId) ? runningCursor.get(primaryAcctId)! : null

      if (!t.is_voided) {
        const amt = Number(t.total_amount || 0)
        if (t.account_qb_id && runningCursor.has(t.account_qb_id)) {
          const prev = runningCursor.get(t.account_qb_id)!
          if (t.direction === 'IN') {
            runningCursor.set(t.account_qb_id, Number((prev - amt).toFixed(2)))
          } else if (t.direction === 'OUT' || t.direction === 'TRANSFER') {
            runningCursor.set(t.account_qb_id, Number((prev + amt).toFixed(2)))
          }
        }
        if (t.direction === 'TRANSFER' && t.to_account_qb_id && runningCursor.has(t.to_account_qb_id)) {
          const prevTo = runningCursor.get(t.to_account_qb_id)!
          runningCursor.set(t.to_account_qb_id, Number((prevTo - amt).toFixed(2)))
        }
      }

      return {
        ...t,
        running_balance: currentRun
      }
    })

    // 4. Now apply user filters (date range, txnType, direction, accountId, search) without distorting running_balance
    const filteredTxns = txnsWithRunningBalance.filter(t => {
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      if (txnType && txnType !== 'ALL') {
        if (txnType === 'EXPENSE_ALL') {
          if (t.txn_type !== 'Expense' && t.txn_type !== 'CreditCardExpense') return false
        } else if (t.txn_type !== txnType) {
          return false
        }
      }
      if (direction && direction !== 'ALL' && t.direction !== direction) return false
      if (accountId && accountId !== 'ALL') {
        const lineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === accountId)
        if (t.account_qb_id !== accountId && t.to_account_qb_id !== accountId && !lineHit) return false
      }
      if (search) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.account_name || ''} ${t.to_account_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.txn_type || ''} ${t.total_amount || ''}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })

    // 5. Calculate Period & Company Summary KPIs
    let totalInflows = 0
    let totalOutflows = 0
    let checksCount = 0
    let checksAmount = 0
    let depositsCount = 0
    let depositsAmount = 0
    let expensesCount = 0
    let expensesAmount = 0
    let journalsCount = 0
    let transfersCount = 0
    let billsCount = 0
    let invoicesCount = 0

    for (const t of filteredTxns) {
      if (t.is_voided) continue
      const amt = Number(t.total_amount || 0)
      if (t.direction === 'IN') {
        totalInflows += amt
      } else if (t.direction === 'OUT') {
        totalOutflows += amt
      }

      if (t.txn_type === 'Check') {
        checksCount++
        checksAmount += amt
      } else if (t.txn_type === 'Deposit') {
        depositsCount++
        depositsAmount += amt
      } else if (t.txn_type === 'Expense' || t.txn_type === 'CreditCardExpense') {
        expensesCount++
        expensesAmount += amt
      } else if (t.txn_type === 'JournalEntry') {
        journalsCount++
      } else if (t.txn_type === 'Transfer') {
        transfersCount++
      } else if (t.txn_type === 'Bill' || t.txn_type === 'BillPayment') {
        billsCount++
      } else if (t.txn_type === 'Invoice' || t.txn_type === 'Payment') {
        invoicesCount++
      }
    }

    const bankAccounts = accountsList.filter(a => a.account_type === 'Bank' && a.is_active)
    const totalBankBalance = bankAccounts.reduce((acc, b) => acc + Number(b.current_balance || 0), 0)

    // Suggest next check number for each bank account
    const nextCheckNumberByBank: Record<string, string> = {}
    for (const b of bankAccounts) {
      let maxNum = 1000
      for (const t of allCompanyTxns) {
        if (t.account_qb_id === b.qb_account_id && t.doc_number && /^\d+$/.test(t.doc_number.trim())) {
          const n = parseInt(t.doc_number.trim(), 10)
          if (n > maxNum && n < 9999999) maxNum = n
        }
      }
      nextCheckNumberByBank[b.qb_account_id] = String(maxNum + 1)
    }

    return NextResponse.json({
      activeRealmId,
      companies: enrichedCompanies,
      accounts: accountsList,
      contacts: contactsRes.data || [],
      recurring: recurringRes.data || [],
      transactions: filteredTxns.slice(offset, offset + limit),
      totalTransactionsCount: filteredTxns.length,
      nextCheckNumberByBank,
      summary: {
        totalBankBalance: Number(totalBankBalance.toFixed(2)),
        totalInflows: Number(totalInflows.toFixed(2)),
        totalOutflows: Number(totalOutflows.toFixed(2)),
        netCashFlow: Number((totalInflows - totalOutflows).toFixed(2)),
        totalRecords: filteredTxns.length,
        checksCount,
        checksAmount: Number(checksAmount.toFixed(2)),
        depositsCount,
        depositsAmount: Number(depositsAmount.toFixed(2)),
        expensesCount,
        expensesAmount: Number(expensesAmount.toFixed(2)),
        journalsCount,
        transfersCount,
        billsCount,
        invoicesCount,
      }
    })
  } catch (err: any) {
    console.error('[GET /api/external-accounting] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()
    const body = await req.json()
    const { action, realmId } = body

    if (!realmId) {
      return NextResponse.json({ error: 'Missing realmId' }, { status: 400 })
    }

    // -------------------------------------------------------------------------
    // 1. SAVE TRANSACTION (Check, Deposit, Expense, Transfer, JournalEntry, Invoice, Payment, Bill, BillPayment)
    // -------------------------------------------------------------------------
    if (action === 'save_transaction') {
      const {
        id,
        txn_type,
        txn_date,
        due_date,
        doc_number,
        payment_type,
        account_qb_id,
        account_name,
        to_account_qb_id,
        to_account_name,
        entity_qb_id,
        entity_name,
        entity_type,
        department_name,
        memo,
        print_status,
        line_items,
        total_amount,
        created_by
      } = body

      if (!txn_type || !txn_date) {
        return NextResponse.json({ error: 'txn_type and txn_date are required' }, { status: 400 })
      }

      // If editing an existing transaction, first reverse its old balance impact
      let existingTxn: any = null
      if (id) {
        const { data: found } = await supabase
          .from('external_accounting_transactions')
          .select('*')
          .eq('id', id)
          .maybeSingle()
        existingTxn = found
        if (existingTxn) {
          await applyTransactionBalanceImpacts(supabase, realmId, existingTxn, -1)
        }
      }

      // Normalize line items and compute total amount
      const normalizedLines = Array.isArray(line_items) ? line_items.map((l: any, idx: number) => ({
        id: String(idx + 1),
        line_num: idx + 1,
        description: l.description || '',
        amount: Number(l.amount || 0),
        posting_type: l.posting_type || null,
        account_qb_id: l.account_qb_id || null,
        account_name: l.account_name || '',
        entity_qb_id: l.entity_qb_id || null,
        entity_name: l.entity_name || entity_name || null,
        payment_method: l.payment_method || payment_type || null,
        check_num: l.check_num || doc_number || null,
      })) : []

      let computedTotal = Number(total_amount || 0)
      if (normalizedLines.length > 0) {
        if (txn_type === 'JournalEntry') {
          const debitSum = normalizedLines
            .filter(l => l.posting_type === 'Debit')
            .reduce((s, l) => s + Number(l.amount || 0), 0)
          const creditSum = normalizedLines
            .filter(l => l.posting_type === 'Credit')
            .reduce((s, l) => s + Number(l.amount || 0), 0)
          if (Math.abs(debitSum - creditSum) > 0.01) {
            // Re-apply existingTxn impact before returning validation error
            if (existingTxn) {
              await applyTransactionBalanceImpacts(supabase, realmId, existingTxn, 1)
            }
            return NextResponse.json({
              error: `La póliza contable (Journal Entry) debe cuadrar al centavo: Cargos ($${debitSum.toFixed(2)}) ≠ Abonos ($${creditSum.toFixed(2)})`
            }, { status: 400 })
          }
          computedTotal = Number(debitSum.toFixed(2))
        } else {
          const linesSum = normalizedLines.reduce((s, l) => s + Number(l.amount || 0), 0)
          if (linesSum > 0) computedTotal = Number(linesSum.toFixed(2))
        }
      }

      // Determine direction
      let direction: 'IN' | 'OUT' | 'TRANSFER' | 'JOURNAL' | 'ACCRUAL' = 'OUT'
      if (txn_type === 'Deposit' || txn_type === 'Payment' || txn_type === 'SalesReceipt') {
        direction = 'IN'
      } else if (txn_type === 'Transfer') {
        direction = 'TRANSFER'
      } else if (txn_type === 'JournalEntry') {
        direction = 'JOURNAL'
      } else if (txn_type === 'Bill' || txn_type === 'Invoice' || txn_type === 'VendorCredit' || txn_type === 'CreditMemo') {
        direction = 'ACCRUAL'
      }

      // Resolve primary account for Invoice (Accounts Receivable) or Bill (Accounts Payable) if not explicitly chosen
      let resolvedAccountQbId = account_qb_id || null
      let resolvedAccountName = account_name || null
      if (!resolvedAccountQbId && (txn_type === 'Invoice' || txn_type === 'Bill')) {
        const targetType = txn_type === 'Invoice' ? 'Accounts Receivable' : 'Accounts Payable'
        const { data: arAp } = await supabase
          .from('external_accounting_accounts')
          .select('qb_account_id, name')
          .eq('company_realm_id', realmId)
          .eq('account_type', targetType)
          .limit(1)
          .maybeSingle()
        if (arAp) {
          resolvedAccountQbId = arAp.qb_account_id
          resolvedAccountName = arAp.name
        }
      }

      // Auto-create contact if payee name is new
      let resolvedEntityQbId = entity_qb_id || null
      const trimmedEntityName = (entity_name || '').trim()
      if (trimmedEntityName && !resolvedEntityQbId) {
        const contactType = (direction === 'IN' || txn_type === 'Invoice' || txn_type === 'CreditMemo') ? 'Customer' : 'Vendor'
        const { data: existingContact } = await supabase
          .from('external_accounting_contacts')
          .select('qb_contact_id')
          .eq('company_realm_id', realmId)
          .ilike('display_name', trimmedEntityName)
          .maybeSingle()

        if (existingContact) {
          resolvedEntityQbId = existingContact.qb_contact_id
        } else {
          const newContactId = `LOCAL-C-${Date.now()}`
          await supabase.from('external_accounting_contacts').insert({
            company_realm_id: realmId,
            contact_type: contactType,
            qb_contact_id: newContactId,
            display_name: trimmedEntityName,
            print_on_check_name: trimmedEntityName,
            is_active: true
          })
          resolvedEntityQbId = newContactId
        }
      }

      const categories = Array.from(new Set(normalizedLines.map(l => l.account_name).filter(Boolean)))
      const categorySummary = txn_type === 'Transfer'
        ? `${resolvedAccountName || ''} ➔ ${to_account_name || ''}`
        : categories.join(', ') || to_account_name || txn_type

      const payload: Record<string, any> = {
        company_realm_id: realmId,
        txn_type,
        qb_entity_type: existingTxn?.qb_entity_type || (txn_type === 'Check' || txn_type === 'Expense' || txn_type === 'CreditCardExpense' ? 'Purchase' : txn_type),
        qb_txn_id: existingTxn?.qb_txn_id || `LOCAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        txn_date,
        due_date: due_date || null,
        doc_number: doc_number || null,
        payment_type: payment_type || txn_type,
        direction,
        account_qb_id: resolvedAccountQbId,
        account_name: resolvedAccountName,
        to_account_qb_id: to_account_qb_id || normalizedLines[0]?.account_qb_id || null,
        to_account_name: to_account_name || normalizedLines[0]?.account_name || null,
        entity_qb_id: resolvedEntityQbId,
        entity_name: trimmedEntityName || null,
        entity_type: entity_type || (direction === 'IN' || txn_type === 'Invoice' ? 'Customer' : 'Vendor'),
        department_name: department_name || null,
        total_amount: computedTotal,
        open_balance: (txn_type === 'Invoice' || txn_type === 'Bill') ? computedTotal : 0,
        memo: memo || normalizedLines[0]?.description || null,
        category_summary: categorySummary,
        print_status: print_status || 'NotSet',
        cleared_status: existingTxn?.cleared_status || 'Cleared',
        is_voided: false,
        line_items: normalizedLines,
        created_by: created_by || 'Raquel Velazquez',
        updated_at: new Date().toISOString()
      }

      let savedRow: any
      if (existingTxn) {
        const { data, error } = await supabase
          .from('external_accounting_transactions')
          .update(payload)
          .eq('id', existingTxn.id)
          .select()
          .single()
        if (error) throw error
        savedRow = data
      } else {
        const { data, error } = await supabase
          .from('external_accounting_transactions')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        savedRow = data
      }

      // Apply new double-entry balance impact
      await applyTransactionBalanceImpacts(supabase, realmId, savedRow, 1)

      return NextResponse.json({ success: true, transaction: savedRow })
    }

    // -------------------------------------------------------------------------
    // 2. TOGGLE CLEARED / RECONCILED STATUS (Bank Reconciliation)
    // -------------------------------------------------------------------------
    if (action === 'toggle_cleared_status') {
      const { id } = body
      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('id, cleared_status, is_voided')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .single()

      if (findErr || !existing) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
      }
      if (existing.is_voided) {
        return NextResponse.json({ error: 'Cannot change reconciliation status of a VOID transaction' }, { status: 400 })
      }

      const cycle: Record<string, string> = {
        'Uncleared': 'Cleared',
        'Cleared': 'Reconciled',
        'Reconciled': 'Uncleared'
      }
      const nextStatus = cycle[existing.cleared_status || 'Cleared'] || 'Reconciled'

      const { data: updated, error: updErr } = await supabase
        .from('external_accounting_transactions')
        .update({ cleared_status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (updErr) throw updErr
      return NextResponse.json({ success: true, transaction: updated })
    }

    // -------------------------------------------------------------------------
    // 3. VOID TRANSACTION (Anular Cheque / Registro)
    // -------------------------------------------------------------------------
    if (action === 'void_transaction') {
      const { id } = body
      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .single()

      if (findErr || !existing) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
      }

      if (!existing.is_voided) {
        await applyTransactionBalanceImpacts(supabase, realmId, existing, -1)
      }

      const voidMemo = existing.memo?.startsWith('[VOID]') ? existing.memo : `[VOID] ${existing.memo || ''}`.trim()
      const { data: updated, error: updErr } = await supabase
        .from('external_accounting_transactions')
        .update({
          is_voided: true,
          cleared_status: 'Voided',
          total_amount: 0,
          open_balance: 0,
          memo: voidMemo,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (updErr) throw updErr
      return NextResponse.json({ success: true, transaction: updated })
    }

    // -------------------------------------------------------------------------
    // 4. DELETE TRANSACTION
    // -------------------------------------------------------------------------
    if (action === 'delete_transaction') {
      const { id } = body
      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .single()

      if (findErr || !existing) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
      }

      if (!existing.is_voided) {
        await applyTransactionBalanceImpacts(supabase, realmId, existing, -1)
      }

      const { error: delErr } = await supabase
        .from('external_accounting_transactions')
        .delete()
        .eq('id', id)

      if (delErr) throw delErr
      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------------------------
    // 5. EXECUTE RECURRING TEMPLATE (Post Scheduled/Reminder Transaction Now)
    // -------------------------------------------------------------------------
    if (action === 'execute_recurring') {
      const { recurringId, txnDate, docNumber } = body
      const { data: rec, error: recErr } = await supabase
        .from('external_accounting_recurring')
        .select('*')
        .eq('id', recurringId)
        .eq('company_realm_id', realmId)
        .single()

      if (recErr || !rec) {
        return NextResponse.json({ error: 'Recurring template not found' }, { status: 404 })
      }

      const effectiveDate = txnDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
      const tType = rec.txn_type || 'Deposit'
      const direction = tType === 'Deposit' || tType === 'Payment'
        ? 'IN'
        : tType === 'Invoice' || tType === 'Bill'
          ? 'ACCRUAL'
          : tType === 'JournalEntry'
            ? 'JOURNAL'
            : 'OUT'

      // Resolve fallback A/R, A/P, or Bank account if template didn't store account_qb_id
      let resolvedAcctQbId = rec.account_qb_id
      let resolvedAcctName = rec.account_name
      if (!resolvedAcctQbId) {
        const fallbackType = tType === 'Invoice'
          ? 'Accounts Receivable'
          : tType === 'Bill'
            ? 'Accounts Payable'
            : 'Bank'
        const { data: fallbackAcc } = await supabase
          .from('external_accounting_accounts')
          .select('qb_account_id, name')
          .eq('company_realm_id', realmId)
          .eq('account_type', fallbackType)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
        if (fallbackAcc) {
          resolvedAcctQbId = fallbackAcc.qb_account_id
          resolvedAcctName = fallbackAcc.name
        }
      }

      const lines = Array.isArray(rec.line_items) ? rec.line_items : []
      const categories = Array.from(new Set(lines.map((l: any) => l.account_name).filter(Boolean)))

      const { data: createdTxn, error: insErr } = await supabase
        .from('external_accounting_transactions')
        .insert({
          company_realm_id: realmId,
          txn_type: tType,
          qb_entity_type: tType === 'Check' || tType === 'Expense' ? 'Purchase' : tType,
          qb_txn_id: `REC-${Date.now()}`,
          txn_date: effectiveDate,
          doc_number: docNumber || lines[0]?.check_num || (tType === 'Invoice' ? `INV-${effectiveDate.replace(/-/g, '')}` : 'EFT'),
          payment_type: tType,
          direction,
          account_qb_id: resolvedAcctQbId,
          account_name: resolvedAcctName,
          to_account_qb_id: lines[0]?.account_qb_id || null,
          to_account_name: lines[0]?.account_name || null,
          entity_qb_id: rec.entity_qb_id,
          entity_name: rec.entity_name || rec.template_name,
          entity_type: direction === 'IN' || tType === 'Invoice' ? 'Customer' : 'Vendor',
          department_name: rec.department_name || null,
          total_amount: Number(rec.amount || 0),
          open_balance: (tType === 'Invoice' || tType === 'Bill') ? Number(rec.amount || 0) : 0,
          memo: rec.memo || `Recurring: ${rec.template_name}`,
          category_summary: categories.join(', ') || rec.template_name,
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: lines,
          created_by: 'Raquel Velazquez (Recurring)',
        })
        .select()
        .single()

      if (insErr) throw insErr

      // Apply double-entry balance impact
      await applyTransactionBalanceImpacts(supabase, realmId, createdTxn, 1)

      // Advance next_date on recurring template
      const baseNext = new Date(`${effectiveDate}T12:00:00Z`)
      const intervalCount = Number(rec.num_interval || 1)
      if (rec.interval_type === 'Weekly') {
        baseNext.setUTCDate(baseNext.getUTCDate() + 7 * intervalCount)
      } else if (rec.interval_type === 'Yearly') {
        baseNext.setUTCFullYear(baseNext.getUTCFullYear() + intervalCount)
      } else {
        baseNext.setUTCMonth(baseNext.getUTCMonth() + intervalCount)
      }
      const nextDateStr = baseNext.toISOString().split('T')[0]

      await supabase
        .from('external_accounting_recurring')
        .update({
          previous_date: effectiveDate,
          next_date: nextDateStr,
          updated_at: new Date().toISOString()
        })
        .eq('id', rec.id)

      return NextResponse.json({ success: true, transaction: createdTxn, nextDate: nextDateStr })
    }

    // -------------------------------------------------------------------------
    // 6. SAVE RECURRING TEMPLATE
    // -------------------------------------------------------------------------
    if (action === 'save_recurring') {
      const {
        id,
        template_name,
        recur_type,
        txn_type,
        interval_type,
        num_interval,
        next_date,
        account_qb_id,
        account_name,
        entity_name,
        department_name,
        amount,
        memo,
        line_items
      } = body

      if (!template_name) {
        return NextResponse.json({ error: 'template_name is required' }, { status: 400 })
      }

      const payload: Record<string, any> = {
        company_realm_id: realmId,
        qb_recurring_id: id ? undefined : `LOCAL-REC-${Date.now()}`,
        template_name,
        recur_type: recur_type || 'Automated',
        txn_type: txn_type || 'Deposit',
        interval_type: interval_type || 'Monthly',
        num_interval: Number(num_interval || 1),
        next_date: next_date || null,
        account_qb_id: account_qb_id || null,
        account_name: account_name || null,
        entity_name: entity_name || template_name,
        department_name: department_name || null,
        amount: Number(amount || 0),
        memo: memo || null,
        line_items: Array.isArray(line_items) ? line_items : [],
        is_active: true,
        updated_at: new Date().toISOString()
      }

      if (id) {
        delete payload.qb_recurring_id
        const { data, error } = await supabase
          .from('external_accounting_recurring')
          .update(payload)
          .eq('id', id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ success: true, recurring: data })
      } else {
        const { data, error } = await supabase
          .from('external_accounting_recurring')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ success: true, recurring: data })
      }
    }

    // -------------------------------------------------------------------------
    // 7. DELETE RECURRING TEMPLATE
    // -------------------------------------------------------------------------
    if (action === 'delete_recurring') {
      const { id } = body
      const { error } = await supabase
        .from('external_accounting_recurring')
        .delete()
        .eq('id', id)
        .eq('company_realm_id', realmId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------------------------
    // 8. SAVE ACCOUNT (Chart of Accounts)
    // -------------------------------------------------------------------------
    if (action === 'save_account') {
      const { id, name, acct_num, classification, account_type, account_sub_type, current_balance } = body
      if (!name || !account_type) {
        return NextResponse.json({ error: 'Name and account_type are required' }, { status: 400 })
      }
      if (id) {
        const { data, error } = await supabase
          .from('external_accounting_accounts')
          .update({
            name,
            fully_qualified_name: name,
            acct_num: acct_num || null,
            classification: classification || 'Asset',
            account_type,
            account_sub_type: account_sub_type || account_type,
            current_balance: Number(current_balance || 0),
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ success: true, account: data })
      } else {
        const { data, error } = await supabase
          .from('external_accounting_accounts')
          .insert({
            company_realm_id: realmId,
            qb_account_id: `LOCAL-ACC-${Date.now()}`,
            name,
            fully_qualified_name: name,
            acct_num: acct_num || null,
            classification: classification || 'Asset',
            account_type,
            account_sub_type: account_sub_type || account_type,
            current_balance: Number(current_balance || 0),
            initial_qbo_balance: Number(current_balance || 0),
            is_active: true
          })
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ success: true, account: data })
      }
    }

    // -------------------------------------------------------------------------
    // 9. SAVE CONTACT (Vendor / Customer)
    // -------------------------------------------------------------------------
    if (action === 'save_contact') {
      const { id, contact_type, display_name, company_name, email, phone, tax_identifier, vendor_1099 } = body
      if (!display_name) {
        return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
      }
      if (id) {
        const { data, error } = await supabase
          .from('external_accounting_contacts')
          .update({
            contact_type: contact_type || 'Vendor',
            display_name,
            company_name: company_name || display_name,
            print_on_check_name: display_name,
            email: email || null,
            phone: phone || null,
            tax_identifier: tax_identifier || null,
            vendor_1099: Boolean(vendor_1099),
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ success: true, contact: data })
      } else {
        const { data, error } = await supabase
          .from('external_accounting_contacts')
          .insert({
            company_realm_id: realmId,
            contact_type: contact_type || 'Vendor',
            qb_contact_id: `LOCAL-CON-${Date.now()}`,
            display_name,
            company_name: company_name || display_name,
            print_on_check_name: display_name,
            email: email || null,
            phone: phone || null,
            tax_identifier: tax_identifier || null,
            vendor_1099: Boolean(vendor_1099),
            is_active: true
          })
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ success: true, contact: data })
      }
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[POST /api/external-accounting] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
