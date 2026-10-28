/**
 * @module api/external-accounting
 * @description Backend ERP autónomo de Contabilidad Externa para las 8 empresas de Raquel Velazquez, Roberto Velazquez y Roque.
 * Reemplaza al 100% la operación diaria de Intuit QuickBooks Online (Accountant Suite):
 * - Seguridad Fail-Closed en servidor (`authorizeExternalAccounting`): solo `raquel@tacosgavilan.com` (45),
 *   `roberto@tacosgavilan.com` (46) y `roque@tacosgavilan.com` (47).
 * - Aislamiento estricto por `company_realm_id` en todas las lecturas y mutaciones (cero cruces entre empresas).
 * - Lectura completa sin truncamiento de 1,000 filas de PostgREST (`fetchAllCompanyTransactions`).
 * - Paginación real en servidor para el Libro Mayor (`page`, `pageSize`, `totalPages`) y para la Chequera (`checkbookPage`).
 * - Actualización atómica en partida doble (`applyAccountDeltasAtomically`) sin condiciones de carrera ni estados parciales.
 *
 * @businessRules
 * - Todas las operaciones exigen sesión válida (`teg_token`) de Raquel, Roberto o Roque.
 * - `running_balance` se calcula sobre la historia cronológica completa de cada cuenta antes de filtrar por fechas o búsqueda.
 * - Ninguna cuenta o registro de una empresa (`realmId`) puede vincularse o modificarse desde otra empresa.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  authorizeExternalAccounting,
  fetchAllCompanyTransactions,
  computeTransactionAccountDeltas,
  mergeAccountDeltas,
  applyAccountDeltasAtomically,
  logExternalAccountingAudit,
} from '@/lib/external-accounting-auth'
import {
  pushTransactionToQbo,
  pushAccountToQbo,
  pushContactToQbo,
  pushListItemToQbo,
  queuePendingQboDelete,
  syncCompanyWithQbo,
  syncAllCompaniesWithQbo,
} from '@/lib/external-accounting-qbo-sync'

export const dynamic = 'force-dynamic'

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminSupabase()

    // 1. Strict Backend Authorization (Fail-Closed)
    const auth = await authorizeExternalAccounting(req, supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(req.url)
    const realmId = searchParams.get('realmId') || ''
    const txnType = searchParams.get('txnType') || 'ALL'
    const direction = searchParams.get('direction') || 'ALL'
    const accountId = searchParams.get('accountId') || 'ALL'
    const department = searchParams.get('department') || 'ALL'
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const search = (searchParams.get('search') || '').trim().toLowerCase()

    // Pagination parameters
    const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || searchParams.get('limit') || '100'), 10), 1000)
    const page = Math.max(Number(searchParams.get('page') || '1'), 1)
    const offset = searchParams.get('offset') !== null
      ? Math.max(Number(searchParams.get('offset') || '0'), 0)
      : (page - 1) * pageSize

    // Checkbook independent filter & pagination parameters
    const checkbookAccountId = searchParams.get('checkbookAccountId') || accountId || 'ALL'
    const checkbookSearch = (searchParams.get('checkbookSearch') || '').trim().toLowerCase()
    const checkbookPage = Math.max(Number(searchParams.get('checkbookPage') || '1'), 1)
    const checkbookOffset = (checkbookPage - 1) * pageSize

    // 2. Fetch all 8 companies + all accounts
    const [companiesRes, allAccountsRes] = await Promise.all([
      supabase
        .from('external_accounting_companies')
        .select('*')
        .order('company_name', { ascending: true }),
      supabase
        .from('external_accounting_accounts')
        .select('company_realm_id, qb_account_id, name, acct_num, classification, account_type, current_balance, is_active')
    ])

    if (companiesRes.error) throw companiesRes.error
    const companiesList = companiesRes.data || []

    // Exact non-truncated transaction counts per company in parallel
    const companyCountsArr = await Promise.all(
      companiesList.map(async (c: any) => {
        const { count } = await supabase
          .from('external_accounting_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('company_realm_id', c.realm_id)
          .eq('is_voided', false)
        return { realmId: c.realm_id, count: count || 0 }
      })
    )
    const countByRealm = new Map<string, number>(
      companyCountsArr.map(item => [item.realmId, item.count])
    )

    const allAccounts = allAccountsRes.data || []
    const enrichedCompanies = companiesList.map((c: any) => {
      const compBanks = allAccounts.filter(
        a => a.company_realm_id === c.realm_id && a.account_type === 'Bank' && a.is_active
      )
      const totalCashBalance = compBanks.reduce((s, b) => s + Number(b.current_balance || 0), 0)
      const meta = c.metadata && typeof c.metadata === 'object' ? c.metadata : {}
      const oauth = meta.qbo_oauth && typeof meta.qbo_oauth === 'object' ? meta.qbo_oauth : null
      return {
        ...c,
        active_banks_count: compBanks.length,
        total_cash_balance: Number(totalCashBalance.toFixed(2)),
        total_txns_count: countByRealm.get(c.realm_id) || 0,
        qbo_connected: Boolean(oauth?.refresh_token),
        qbo_sync_enabled: meta.qbo_sync_enabled !== false,
        qbo_last_synced_at: oauth?.last_synced_at || null,
        qbo_last_sync_error: oauth?.last_sync_error || null,
      }
    })

    const activeRealmId = realmId || enrichedCompanies[0]?.realm_id || '123145825185692'
    const validCompany = companiesList.find((c: any) => c.realm_id === activeRealmId)
    if (!validCompany) {
      return NextResponse.json({ error: `Empresa no encontrada para realmId: ${activeRealmId}` }, { status: 404 })
    }

    // 3. Fetch active company accounts, contacts, recurring templates, reconciliations, audit log, bank rules, budgets, 9 relational Lists tables, and 100% of company transactions
    const [
      accountsRes,
      contactsRes,
      recurringRes,
      reconciliationsRes,
      auditLogRes,
      bankRulesRes,
      budgetsRes,
      itemsRes,
      categoriesRes,
      locationsRes,
      classesRes,
      paymentMethodsRes,
      termsRes,
      customFieldsRes,
      attachmentsRes,
      costGroupsRes,
      allCompanyTxns
    ] = await Promise.all([
      supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('account_type', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('display_name', { ascending: true }),
      supabase
        .from('external_accounting_recurring')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('template_name', { ascending: true }),
      supabase
        .from('external_accounting_reconciliations')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('statement_ending_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_audit_log')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('external_accounting_bank_rules')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_budgets')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('fiscal_year', { ascending: false })
        .order('account_name', { ascending: true }),
      supabase
        .from('external_accounting_items')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_categories')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_locations')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('fully_qualified_name', { ascending: true }),
      supabase
        .from('external_accounting_classes')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('fully_qualified_name', { ascending: true }),
      supabase
        .from('external_accounting_payment_methods')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_terms')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('due_days', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_custom_fields')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      supabase
        .from('external_accounting_attachments')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('created_at', { ascending: false }),
      supabase
        .from('external_accounting_cost_groups')
        .select('*')
        .eq('company_realm_id', activeRealmId)
        .order('name', { ascending: true }),
      fetchAllCompanyTransactions(supabase, activeRealmId, false)
    ])

    if (accountsRes.error) throw accountsRes.error
    if (contactsRes.error) throw contactsRes.error
    if (recurringRes.error) throw recurringRes.error

    const accountsList = accountsRes.data || []
    const acctBalanceMap = new Map<string, number>()
    const acctByQbIdForGet = new Map<string, any>()
    for (const a of accountsList) {
      acctBalanceMap.set(a.qb_account_id, Number(a.current_balance || 0))
      acctByQbIdForGet.set(a.qb_account_id, a)
    }

    // 4. Compute accurate chronological Running Balance per account across ALL company transactions
    //    and accumulate annual activity per account (`actualsByAccountAndYear`) for Budgeting vs Actuals
    const runningCursor = new Map<string, number>(acctBalanceMap)
    const actualsByAccountAndYear: Record<string, Record<string, number>> = {}

    const txnsWithRunningBalance = allCompanyTxns.map((t: any) => {
      const touchesFilteredAccount = Boolean(
        accountId &&
        accountId !== 'ALL' &&
        (
          t.account_qb_id === accountId ||
          t.to_account_qb_id === accountId ||
          (Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === accountId))
        )
      )
      const targetAccId = touchesFilteredAccount ? accountId : t.account_qb_id
      const currentBal = (targetAccId && runningCursor.has(targetAccId)) ? runningCursor.get(targetAccId)! : null
      const rowWithBal = {
        ...t,
        running_balance: currentBal !== null ? Number(currentBal.toFixed(2)) : null
      }

      if (!t.is_voided && t.txn_type !== 'Estimate' && t.txn_type !== 'PurchaseOrder') {
        const revDeltas = computeTransactionAccountDeltas(acctByQbIdForGet, t, -1)
        for (const [qId, revDelta] of revDeltas.entries()) {
          if (runningCursor.has(qId)) {
            runningCursor.set(qId, Number(((runningCursor.get(qId) || 0) + revDelta).toFixed(2)))
          }
          const yr = (t.txn_date || '').slice(0, 4)
          if (yr) {
            if (!actualsByAccountAndYear[qId]) actualsByAccountAndYear[qId] = {}
            // Forward delta is -revDelta
            actualsByAccountAndYear[qId][yr] = Number(((actualsByAccountAndYear[qId][yr] || 0) - revDelta).toFixed(2))
          }
        }
      }
      return rowWithBal
    })

    // 5. Apply user filters for Ledger (Tab 2) and Summary (Tab 1)
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
      if (department && department !== 'ALL') {
        const deptLineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => l.department_name === department || l.department_qb_id === department)
        if (t.department_name !== department && t.department_qb_id !== department && !deptLineHit) return false
      }
      if (search) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.account_name || ''} ${t.to_account_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.txn_type || ''} ${t.department_name || ''} ${t.total_amount || ''}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })

    // 6. Apply dedicated filters for Checkbook (Tab 3) across ALL company checks & deposits
    const checkbookFiltered = txnsWithRunningBalance.filter(t => {
      if (t.txn_type !== 'Check' && t.txn_type !== 'BillPayment') return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      if (checkbookAccountId && checkbookAccountId !== 'ALL' && t.account_qb_id !== checkbookAccountId) return false
      if (checkbookSearch) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.account_name || ''}`.toLowerCase()
        if (!hay.includes(checkbookSearch)) return false
      }
      return true
    })

    const depositsFiltered = txnsWithRunningBalance.filter(t => {
      if (t.txn_type !== 'Deposit' && t.txn_type !== 'Payment' && t.txn_type !== 'SalesReceipt') return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      if (checkbookAccountId && checkbookAccountId !== 'ALL' && t.account_qb_id !== checkbookAccountId) return false
      if (checkbookSearch) {
        const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.account_name || ''}`.toLowerCase()
        if (!hay.includes(checkbookSearch)) return false
      }
      return true
    })

    // 7. Calculate Period & Company Summary KPIs
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
      if (t.is_voided || t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder') continue
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

    const totalPages = Math.max(1, Math.ceil(filteredTxns.length / pageSize))
    const checkbookTotalPages = Math.max(1, Math.ceil(checkbookFiltered.length / pageSize))

    // Build full non-truncated candidate list for Bank / Credit Card Reconciliation
    const reconcileAccountId = searchParams.get('reconcileAccountId') || bankAccounts[0]?.qb_account_id || ''
    const bankAndCcIds = new Set(
      accountsList
        .filter(a => a.account_type === 'Bank' || (a.account_type || '').toLowerCase().includes('credit card'))
        .map(a => a.qb_account_id)
    )
    const reconcileTransactions = txnsWithRunningBalance.filter(t => {
      if (t.is_voided || t.txn_type === 'Estimate' || t.txn_type === 'PurchaseOrder') return false
      if (reconcileAccountId && reconcileAccountId !== 'ALL') {
        const lineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === reconcileAccountId)
        return t.account_qb_id === reconcileAccountId || t.to_account_qb_id === reconcileAccountId || lineHit
      }
      return (t.account_qb_id && bankAndCcIds.has(t.account_qb_id)) || (t.to_account_qb_id && bankAndCcIds.has(t.to_account_qb_id))
    })

    const compMeta = validCompany?.metadata || {}

    const mappedItems = (itemsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_item_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      Sku: row.sku,
      Type: row.item_type || 'Service',
      Description: row.description,
      UnitPrice: Number(row.unit_price ?? 0),
      PurchaseDesc: row.purchase_desc,
      PurchaseCost: Number(row.purchase_cost ?? 0),
      IncomeAccountRef: row.income_account_qb_id ? { value: row.income_account_qb_id, name: row.income_account_name } : null,
      ExpenseAccountRef: row.expense_account_qb_id ? { value: row.expense_account_qb_id, name: row.expense_account_name } : null,
      AssetAccountRef: row.asset_account_qb_id ? { value: row.asset_account_qb_id, name: row.asset_account_name } : null,
      ParentRef: row.category_qb_id ? { value: row.category_qb_id, name: row.category_name } : null,
      Taxable: Boolean(row.taxable),
      Active: row.is_active !== false,
    }))

    const mappedCategories = (categoriesRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_category_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      Type: 'Category',
      ParentRef: row.parent_qb_id ? { value: row.parent_qb_id, name: row.parent_name } : null,
      SubItem: Boolean(row.is_sub_category),
      Active: row.is_active !== false,
    }))

    const mappedDepartments = (locationsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_location_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      ParentRef: row.parent_qb_id ? { value: row.parent_qb_id, name: row.parent_name } : null,
      SubDepartment: Boolean(row.is_sub_location),
      Active: row.is_active !== false,
    }))

    const mappedClasses = (classesRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_class_id,
      Name: row.name,
      FullyQualifiedName: row.fully_qualified_name || row.name,
      ClassCode: row.class_code,
      ParentRef: row.parent_qb_id ? { value: row.parent_qb_id, name: row.parent_name } : null,
      SubClass: Boolean(row.is_sub_class),
      Active: row.is_active !== false,
    }))

    const mappedPaymentMethods = (paymentMethodsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_payment_method_id,
      Name: row.name,
      Type: row.method_type || 'NON_CREDIT_CARD',
      Active: row.is_active !== false,
    }))

    const mappedTerms = (termsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_term_id,
      Name: row.name,
      Type: row.term_type || 'STANDARD',
      DueDays: Number(row.due_days ?? 0),
      DiscountPercent: Number(row.discount_percent ?? 0),
      DiscountDays: Number(row.discount_days ?? 0),
      DayOfMonthDue: row.day_of_month_due,
      Active: row.is_active !== false,
    }))

    const mappedCustomFields = (customFieldsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_field_id,
      Name: row.name,
      Type: row.data_type || 'StringType',
      Active: row.is_active !== false,
    }))

    const mappedAttachments = (attachmentsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_attachable_id,
      Name: row.file_name,
      FileName: row.file_name,
      ContentType: row.content_type,
      Size: Number(row.size_bytes ?? 0),
      Note: row.note,
      Active: true,
    }))

    const mappedCostGroups = (costGroupsRes.data || []).map((row: any) => ({
      ...row,
      Id: row.qb_cost_group_id,
      Name: row.name,
      Code: row.code,
      Description: row.description,
      Active: row.is_active !== false,
    }))

    return NextResponse.json({
      activeRealmId,
      companies: enrichedCompanies,
      accounts: accountsList,
      contacts: contactsRes.data || [],
      recurring: recurringRes.data || [],
      reconciliations: reconciliationsRes.data || [],
      reconcileTransactions,
      auditLog: auditLogRes.data || [],
      bankRules: bankRulesRes.data || [],
      budgets: budgetsRes.data || [],
      actualsByAccountAndYear,
      lists: {
        items: mappedItems.length > 0 ? mappedItems : (Array.isArray(compMeta.items) ? compMeta.items : []),
        categories: mappedCategories,
        departments: mappedDepartments.length > 0 ? mappedDepartments : (Array.isArray(compMeta.departments) ? compMeta.departments : []),
        paymentMethods: mappedPaymentMethods.length > 0 ? mappedPaymentMethods : (Array.isArray(compMeta.paymentMethods) ? compMeta.paymentMethods : []),
        terms: mappedTerms.length > 0 ? mappedTerms : (Array.isArray(compMeta.terms) ? compMeta.terms : []),
        classes: mappedClasses.length > 0 ? mappedClasses : (Array.isArray(compMeta.classes) ? compMeta.classes : []),
        customFields: mappedCustomFields,
        attachments: mappedAttachments,
        costGroups: mappedCostGroups,
        preferences: compMeta.preferences || {},
        companyInfo: compMeta.companyInfo || {},
        closingDate: compMeta.closing_date || null,
        accountingMethod: compMeta.accounting_method || 'Accrual',
        fiscalYearStartMonth: compMeta.fiscal_year_start_month || '01',
        taxId: compMeta.tax_id || '',
      },
      transactions: filteredTxns.slice(offset, offset + pageSize),
      totalTransactionsCount: filteredTxns.length,
      pagination: {
        page,
        pageSize,
        offset,
        totalCount: filteredTxns.length,
        totalFiltered: filteredTxns.length,
        totalPages,
        hasNextPage: offset + pageSize < filteredTxns.length,
        hasPrevPage: offset > 0,
      },
      checkbookTransactions: checkbookFiltered.slice(checkbookOffset, checkbookOffset + pageSize),
      checkbookPagination: {
        page: checkbookPage,
        pageSize,
        offset: checkbookOffset,
        totalCount: checkbookFiltered.length,
        totalFiltered: checkbookFiltered.length,
        totalPages: checkbookTotalPages,
        hasNextPage: checkbookOffset + pageSize < checkbookFiltered.length,
        hasPrevPage: checkbookOffset > 0,
      },
      depositsTransactions: depositsFiltered.slice(0, 200),
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

    // 1. Strict Backend Authorization (Fail-Closed)
    const auth = await authorizeExternalAccounting(req, supabase)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await req.json()
    const { action } = body
    const realmId = String(body.realmId || body.realm_id || '').trim()

    if (!realmId) {
      return NextResponse.json({ error: 'El identificador de empresa (realmId) es obligatorio.' }, { status: 400 })
    }

    // Verify that realmId exists in external_accounting_companies
    const { data: companyRecord } = await supabase
      .from('external_accounting_companies')
      .select('realm_id, company_name, legal_name, email, phone, address, metadata')
      .eq('realm_id', realmId)
      .maybeSingle()

    if (!companyRecord) {
      return NextResponse.json({ error: `Empresa inválida o no registrada (realmId: ${realmId}).` }, { status: 404 })
    }
    const companyClosingDate: string | null = companyRecord.metadata?.closing_date || null

    // Load company accounts map for strict cross-realm reference validation & atomic delta calculation
    const { data: companyAccounts, error: accLoadErr } = await supabase
      .from('external_accounting_accounts')
      .select('*')
      .eq('company_realm_id', realmId)

    if (accLoadErr) throw accLoadErr
    const acctByQbId = new Map<string, any>()
    for (const a of companyAccounts || []) {
      acctByQbId.set(a.qb_account_id, a)
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
        payment_method_qb_id,
        term_qb_id,
        term_name,
        account_qb_id,
        account_name,
        to_account_qb_id,
        to_account_name,
        entity_qb_id,
        entity_name,
        entity_type,
        department_qb_id,
        department_name,
        class_qb_id,
        class_name,
        custom_fields,
        memo,
        print_status,
        line_items,
        total_amount,
      } = body

      if (!txn_type || !txn_date) {
        return NextResponse.json({ error: 'txn_type y txn_date son obligatorios.' }, { status: 400 })
      }

      if (companyClosingDate && txn_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `Los libros contables están cerrados hasta el ${companyClosingDate}. Desbloquea la fecha de cierre en Configuración (⚙️) o confirma la excepción.` },
          { status: 400 }
        )
      }

      // If editing an existing transaction, verify it exists AND belongs to this exact realmId
      let existingTxn: any = null
      if (id) {
        const { data: found } = await supabase
          .from('external_accounting_transactions')
          .select('*')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!found) {
          return NextResponse.json(
            { error: 'La transacción no existe o pertenece a otra empresa (realmId mismatch).' },
            { status: 404 }
          )
        }
        if (companyClosingDate && found.txn_date && found.txn_date <= companyClosingDate && !body.overrideClosingDate) {
          return NextResponse.json(
            { error: `La transacción original pertenece a un periodo cerrado (${found.txn_date} ≤ ${companyClosingDate}). Desbloquea la fecha de cierre en Configuración (⚙️).` },
            { status: 400 }
          )
        }
        existingTxn = found
      }

      // Normalize line items
      const normalizedLines = Array.isArray(line_items) ? line_items.map((l: any, idx: number) => ({
        id: String(idx + 1),
        line_num: idx + 1,
        description: l.description || '',
        amount: Number(l.amount || 0),
        posting_type: l.posting_type || null,
        account_qb_id: l.account_qb_id || null,
        account_name: l.account_name || acctByQbId.get(l.account_qb_id)?.name || '',
        entity_qb_id: l.entity_qb_id || null,
        entity_name: l.entity_name || entity_name || null,
        payment_method: l.payment_method || payment_type || null,
        check_num: l.check_num || doc_number || null,
        item_qb_id: l.item_qb_id || l.item_id || null,
        item_id: l.item_id || l.item_qb_id || null,
        item_name: l.item_name || null,
        class_qb_id: l.class_qb_id || class_qb_id || null,
        class_name: l.class_name || class_name || null,
        department_qb_id: l.department_qb_id || department_qb_id || null,
        department_name: l.department_name || department_name || null,
        qty: l.qty != null && l.qty !== '' ? Number(l.qty) : null,
        rate: l.rate != null && l.rate !== '' ? Number(l.rate) : null,
      })) : []

      // Validate that all referenced accounts belong to this company (realmId)
      if (account_qb_id && !acctByQbId.has(account_qb_id)) {
        return NextResponse.json(
          { error: `La cuenta principal (${account_qb_id}) no pertenece a la empresa activa.` },
          { status: 400 }
        )
      }
      if (to_account_qb_id && !acctByQbId.has(to_account_qb_id)) {
        return NextResponse.json(
          { error: `La cuenta destino (${to_account_qb_id}) no pertenece a la empresa activa.` },
          { status: 400 }
        )
      }
      for (const l of normalizedLines) {
        if (l.account_qb_id && !acctByQbId.has(l.account_qb_id)) {
          return NextResponse.json(
            { error: `La cuenta de partida (${l.account_qb_id}) no pertenece a la empresa activa.` },
            { status: 400 }
          )
        }
      }

      let computedTotal = Number(total_amount || 0)
      if (normalizedLines.length > 0) {
        if (txn_type === 'JournalEntry') {
          const debitSum = normalizedLines
            .filter(l => (l.posting_type || 'Debit') === 'Debit')
            .reduce((s, l) => s + Number(l.amount || 0), 0)
          const creditSum = normalizedLines
            .filter(l => l.posting_type === 'Credit')
            .reduce((s, l) => s + Number(l.amount || 0), 0)
          if (Math.abs(debitSum - creditSum) > 0.01) {
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
      let direction: 'IN' | 'OUT' | 'TRANSFER' | 'JOURNAL' | 'ACCRUAL' | 'NON_POSTING' = 'OUT'
      if (txn_type === 'Deposit' || txn_type === 'Payment' || txn_type === 'SalesReceipt' || txn_type === 'CreditCardCredit') {
        direction = 'IN'
      } else if (txn_type === 'Transfer' || txn_type === 'PayDownCreditCard') {
        direction = 'TRANSFER'
      } else if (txn_type === 'JournalEntry') {
        direction = 'JOURNAL'
      } else if (txn_type === 'Bill' || txn_type === 'Invoice' || txn_type === 'VendorCredit' || txn_type === 'CreditMemo') {
        direction = 'ACCRUAL'
      } else if (txn_type === 'Estimate' || txn_type === 'PurchaseOrder') {
        direction = 'NON_POSTING'
      }

      // Resolve primary account for Invoice/CreditMemo (Accounts Receivable) or Bill/VendorCredit (Accounts Payable) if not explicitly chosen
      let resolvedAccountQbId = account_qb_id || null
      let resolvedAccountName = account_qb_id ? (acctByQbId.get(account_qb_id)?.name || account_name || null) : null
      if (!resolvedAccountQbId && (txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Bill' || txn_type === 'VendorCredit')) {
        const targetType = (txn_type === 'Invoice' || txn_type === 'CreditMemo') ? 'Accounts Receivable' : 'Accounts Payable'
        const fallbackAcc = (companyAccounts || []).find(a => a.account_type === targetType && a.is_active)
        if (fallbackAcc) {
          resolvedAccountQbId = fallbackAcc.qb_account_id
          resolvedAccountName = fallbackAcc.name
        }
      }

      // Auto-create or resolve contact strictly within this realmId
      let resolvedEntityQbId = entity_qb_id || null
      const lineEntityNames = Array.from(new Set(normalizedLines.map(l => (l.entity_name || '').trim()).filter(Boolean)))
      const trimmedEntityName = (entity_name || '').trim() || lineEntityNames.join(', ')
      const lineDocNums = Array.from(new Set(normalizedLines.map(l => (l.check_num || '').trim()).filter(Boolean)))
      const resolvedDocNumber = (doc_number || '').trim() || lineDocNums.join(', ') || null
      if (trimmedEntityName && !resolvedEntityQbId) {
        const primaryEntityName = (entity_name || '').trim() || lineEntityNames[0] || trimmedEntityName
        const contactType = (direction === 'IN' || txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Estimate' || txn_type === 'RefundReceipt') ? 'Customer' : 'Vendor'
        const { data: existingContact } = await supabase
          .from('external_accounting_contacts')
          .select('qb_contact_id')
          .eq('company_realm_id', realmId)
          .ilike('display_name', primaryEntityName)
          .maybeSingle()

        if (existingContact) {
          resolvedEntityQbId = existingContact.qb_contact_id
        } else {
          const newContactId = `LOCAL-C-${Date.now()}`
          await supabase.from('external_accounting_contacts').insert({
            company_realm_id: realmId,
            contact_type: contactType,
            qb_contact_id: newContactId,
            display_name: primaryEntityName,
            print_on_check_name: primaryEntityName,
            is_active: true
          })
          resolvedEntityQbId = newContactId
        }
      }

      const resolvedToAccountName = to_account_qb_id
        ? (acctByQbId.get(to_account_qb_id)?.name || to_account_name || null)
        : (normalizedLines[0]?.account_name || null)

      const categories = Array.from(new Set(normalizedLines.map(l => l.account_name).filter(Boolean)))
      const categorySummary = (txn_type === 'Transfer' || txn_type === 'PayDownCreditCard')
        ? `${resolvedAccountName || ''} ➔ ${resolvedToAccountName || ''}`
        : categories.join(', ') || resolvedToAccountName || txn_type

      const payload: Record<string, any> = {
        company_realm_id: realmId,
        txn_type,
        qb_entity_type: existingTxn?.qb_entity_type || (txn_type === 'Check' || txn_type === 'Expense' || txn_type === 'CreditCardExpense' ? 'Purchase' : txn_type),
        qb_txn_id: existingTxn?.qb_txn_id || `LOCAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        txn_date,
        due_date: due_date || null,
        doc_number: resolvedDocNumber,
        payment_type: payment_type || txn_type,
        direction,
        account_qb_id: resolvedAccountQbId,
        account_name: resolvedAccountName,
        to_account_qb_id: to_account_qb_id || normalizedLines[0]?.account_qb_id || null,
        to_account_name: resolvedToAccountName,
        entity_qb_id: resolvedEntityQbId,
        entity_name: trimmedEntityName || null,
        entity_type: entity_type || ((direction === 'IN' || txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Estimate' || txn_type === 'RefundReceipt') ? 'Customer' : 'Vendor'),
        department_qb_id: department_qb_id || null,
        department_name: department_name || null,
        class_qb_id: class_qb_id || null,
        class_name: class_name || null,
        term_qb_id: term_qb_id || null,
        term_name: term_name || null,
        payment_method_qb_id: payment_method_qb_id || null,
        custom_fields: custom_fields || {},
        total_amount: computedTotal,
        open_balance: (txn_type === 'Invoice' || txn_type === 'Bill') ? computedTotal : 0,
        memo: memo || null,
        category_summary: categorySummary,
        print_status: print_status || 'NotSet',
        cleared_status: existingTxn?.cleared_status || 'Cleared',
        is_voided: false,
        line_items: normalizedLines,
        created_by: auth.user.name || auth.user.email,
        updated_at: new Date().toISOString(),
      }

      if (id) {
        const oldReversalDeltas = computeTransactionAccountDeltas(acctByQbId, existingTxn, -1)
        const { data: savedTxn, error: updErr } = await supabase
          .from('external_accounting_transactions')
          .update(payload)
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()

        if (updErr) throw updErr

        const newApplyDeltas = computeTransactionAccountDeltas(acctByQbId, savedTxn, 1)
        const netDeltas = mergeAccountDeltas(oldReversalDeltas, newApplyDeltas)
        await applyAccountDeltasAtomically(supabase, realmId, netDeltas)

        // Two-way mirror push to Intuit QuickBooks Online V3 (if company is connected & mirror mode active)
        const qboSync = await pushTransactionToQbo(supabase, realmId, savedTxn, 'UPSERT')

        await logExternalAccountingAudit(supabase, {
          realmId,
          user: auth.user,
          actionType: 'EDIT_TRANSACTION',
          entityType: savedTxn.txn_type,
          entityId: savedTxn.id,
          docNumber: savedTxn.doc_number,
          amount: Number(savedTxn.total_amount || 0),
          summary: `Editó ${savedTxn.txn_type} ${savedTxn.doc_number ? `#${savedTxn.doc_number} ` : ''}(${savedTxn.entity_name || savedTxn.category_summary || ''}) por $${Number(savedTxn.total_amount || 0).toFixed(2)}${qboSync.synced ? ` [QBO #${qboSync.qbTxnId}]` : ''}`,
          details: { before: { total_amount: existingTxn?.total_amount, category_summary: existingTxn?.category_summary }, after: { total_amount: savedTxn.total_amount, category_summary: savedTxn.category_summary }, qboSync }
        })

        return NextResponse.json({ success: true, transaction: savedTxn, qboSync })
      } else {
        const { data: savedTxn, error: insErr } = await supabase
          .from('external_accounting_transactions')
          .insert(payload)
          .select()
          .single()

        if (insErr) throw insErr

        try {
          const newApplyDeltas = computeTransactionAccountDeltas(acctByQbId, savedTxn, 1)
          await applyAccountDeltasAtomically(supabase, realmId, newApplyDeltas)
        } catch (balErr) {
          // Compensating rollback if balance update fails
          await supabase.from('external_accounting_transactions').delete().eq('id', savedTxn.id)
          throw balErr
        }

        // Two-way mirror push to Intuit QuickBooks Online V3 (if company is connected & mirror mode active)
        const qboSync = await pushTransactionToQbo(supabase, realmId, savedTxn, 'UPSERT')

        await logExternalAccountingAudit(supabase, {
          realmId,
          user: auth.user,
          actionType: 'CREATE_TRANSACTION',
          entityType: savedTxn.txn_type,
          entityId: savedTxn.id,
          docNumber: savedTxn.doc_number,
          amount: Number(savedTxn.total_amount || 0),
          summary: `Creó ${savedTxn.txn_type} ${savedTxn.doc_number ? `#${savedTxn.doc_number} ` : ''}(${savedTxn.entity_name || savedTxn.category_summary || ''}) por $${Number(savedTxn.total_amount || 0).toFixed(2)}${qboSync.synced ? ` [QBO #${qboSync.qbTxnId}]` : ''}`,
          details: { account_name: savedTxn.account_name, category_summary: savedTxn.category_summary, qboSync }
        })

        return NextResponse.json({ success: true, transaction: savedTxn, qboSync })
      }
    }

    // -------------------------------------------------------------------------
    // 2. TOGGLE CLEARED / RECONCILED STATUS (Bank Reconciliation)
    // -------------------------------------------------------------------------
    if (action === 'toggle_cleared_status') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('id, company_realm_id, txn_date, cleared_status, is_voided')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existing) {
        return NextResponse.json(
          { error: 'Transacción no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }
      if (existing.is_voided) {
        return NextResponse.json({ error: 'No se puede conciliar una transacción anulada (VOID).' }, { status: 400 })
      }
      if (companyClosingDate && existing.txn_date && existing.txn_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede alterar el estado de conciliación de un periodo cerrado (${existing.txn_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
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
        .eq('company_realm_id', realmId)
        .select()
        .single()

      if (updErr) throw updErr
      return NextResponse.json({ success: true, cleared_status: nextStatus, transaction: updated })
    }

    // -------------------------------------------------------------------------
    // 3. VOID TRANSACTION (Anular Cheque / Registro)
    // -------------------------------------------------------------------------
    if (action === 'void_transaction') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existing) {
        return NextResponse.json(
          { error: 'Transacción no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }
      if (companyClosingDate && existing.txn_date && existing.txn_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede anular (VOID) una transacción de un periodo cerrado (${existing.txn_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

      const reversalDeltas = existing.is_voided
        ? new Map<string, number>()
        : computeTransactionAccountDeltas(acctByQbId, existing, -1)

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
        .eq('company_realm_id', realmId)
        .select()
        .single()

      if (updErr) throw updErr

      if (reversalDeltas.size > 0) {
        await applyAccountDeltasAtomically(supabase, realmId, reversalDeltas)
      }

      const qboSync = await pushTransactionToQbo(supabase, realmId, existing, 'VOID')

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'VOID_TRANSACTION',
        entityType: existing.txn_type,
        entityId: existing.id,
        docNumber: existing.doc_number,
        amount: Number(existing.total_amount || 0),
        summary: `Anuló (VOID) ${existing.txn_type} ${existing.doc_number ? `#${existing.doc_number} ` : ''}(${existing.entity_name || ''}) — revertido $${Number(existing.total_amount || 0).toFixed(2)}`,
        details: { qboSync }
      })

      return NextResponse.json({ success: true, transaction: updated, qboSync })
    }

    // -------------------------------------------------------------------------
    // 4. DELETE TRANSACTION
    // -------------------------------------------------------------------------
    if (action === 'delete_transaction') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existing, error: findErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existing) {
        return NextResponse.json(
          { error: 'Transacción no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }
      if (companyClosingDate && existing.txn_date && existing.txn_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede eliminar una transacción de un periodo cerrado (${existing.txn_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

      const reversalDeltas = existing.is_voided
        ? new Map<string, number>()
        : computeTransactionAccountDeltas(acctByQbId, existing, -1)

      const { error: delErr } = await supabase
        .from('external_accounting_transactions')
        .delete()
        .eq('id', id)
        .eq('company_realm_id', realmId)

      if (delErr) throw delErr

      if (reversalDeltas.size > 0) {
        await applyAccountDeltasAtomically(supabase, realmId, reversalDeltas)
      }

      const qboSync = await pushTransactionToQbo(supabase, realmId, existing, 'DELETE')

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_TRANSACTION',
        entityType: existing.txn_type,
        entityId: existing.id,
        docNumber: existing.doc_number,
        amount: Number(existing.total_amount || 0),
        summary: `Eliminó ${existing.txn_type} ${existing.doc_number ? `#${existing.doc_number} ` : ''}(${existing.entity_name || ''}) por $${Number(existing.total_amount || 0).toFixed(2)}`,
        details: { qboSync }
      })

      return NextResponse.json({ success: true, qboSync })
    }

    // -------------------------------------------------------------------------
    // 5. EXECUTE RECURRING TEMPLATE (Post Scheduled/Reminder Transaction Now)
    // -------------------------------------------------------------------------
    if (action === 'execute_recurring') {
      const recurringId = body.recurringId || body.recurring_id
      const txnDate = body.txnDate || body.txn_date
      const docNumber = body.docNumber || body.doc_number

      if (!recurringId) {
        return NextResponse.json({ error: 'recurringId is required' }, { status: 400 })
      }

      const { data: rec, error: recErr } = await supabase
        .from('external_accounting_recurring')
        .select('*')
        .eq('id', recurringId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (recErr || !rec) {
        return NextResponse.json(
          { error: 'Plantilla recurrente no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }

      const effectiveDate = txnDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
      if (companyClosingDate && effectiveDate <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede ejecutar la plantilla en una fecha cerrada (${effectiveDate} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

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
        const fallbackAcc = (companyAccounts || []).find(a => a.account_type === fallbackType && a.is_active)
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
          created_by: `${auth.user.name || auth.user.email} (Recurring)`,
        })
        .select()
        .single()

      if (insErr) throw insErr

      try {
        const deltas = computeTransactionAccountDeltas(acctByQbId, createdTxn, 1)
        await applyAccountDeltasAtomically(supabase, realmId, deltas)
      } catch (balErr) {
        await supabase.from('external_accounting_transactions').delete().eq('id', createdTxn.id)
        throw balErr
      }

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
        .eq('company_realm_id', realmId)

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'EXECUTE_RECURRING',
        entityType: createdTxn.txn_type,
        entityId: createdTxn.id,
        docNumber: createdTxn.doc_number,
        amount: Number(createdTxn.total_amount || 0),
        summary: `Ejecutó plantilla recurrente "${rec.template_name}" (${createdTxn.txn_type} por $${Number(createdTxn.total_amount || 0).toFixed(2)})`
      })

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
        gl_account_qb_id,
        gl_account_name,
        entity_qb_id,
        entity_name,
        department_name,
        amount,
        memo,
        line_items,
        raw_payload
      } = body

      if (!template_name) {
        return NextResponse.json({ error: 'template_name is required' }, { status: 400 })
      }

      if (id) {
        const { data: existingRec } = await supabase
          .from('external_accounting_recurring')
          .select('id')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!existingRec) {
          return NextResponse.json(
            { error: 'La plantilla recurrente no existe en la empresa seleccionada (realmId mismatch).' },
            { status: 404 }
          )
        }
      }

      if (account_qb_id && !acctByQbId.has(account_qb_id)) {
        return NextResponse.json({ error: 'La cuenta bancaria no pertenece a la empresa activa.' }, { status: 400 })
      }
      if (gl_account_qb_id && !acctByQbId.has(gl_account_qb_id)) {
        return NextResponse.json({ error: 'La cuenta contable GL no pertenece a la empresa activa.' }, { status: 400 })
      }

      let resolvedLines: any[] = Array.isArray(line_items) ? line_items : []
      if (gl_account_qb_id) {
        resolvedLines = [{
          id: '1',
          line_num: 1,
          account_qb_id: gl_account_qb_id,
          account_name: acctByQbId.get(gl_account_qb_id)?.name || gl_account_name || '',
          description: memo || template_name,
          amount: Number(amount || 0)
        }]
      } else if (resolvedLines.length === 0 && raw_payload) {
        const innerKey = Object.keys(raw_payload)[0]
        const rawLines = raw_payload[innerKey]?.Line || []
        resolvedLines = rawLines
          .map((rl: any, idx: number) => {
            const accRef = rl.AccountBasedExpenseLineDetail?.AccountRef
              || rl.DepositLineDetail?.AccountRef
              || rl.JournalEntryLineDetail?.AccountRef
              || rl.SalesItemLineDetail?.ItemAccountRef
              || rl.SalesItemLineDetail?.ItemRef
            if (!accRef) return null
            return {
              id: String(idx + 1),
              line_num: idx + 1,
              account_qb_id: accRef.value,
              account_name: acctByQbId.get(accRef.value)?.name || accRef.name || '',
              description: rl.Description || memo || template_name,
              amount: Number(rl.Amount || amount || 0)
            }
          })
          .filter(Boolean)
      }

      for (const l of resolvedLines) {
        if (l.account_qb_id && !acctByQbId.has(l.account_qb_id)) {
          return NextResponse.json({ error: `La cuenta (${l.account_qb_id}) no pertenece a la empresa activa.` }, { status: 400 })
        }
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
        account_name: account_qb_id ? (acctByQbId.get(account_qb_id)?.name || account_name || null) : null,
        entity_qb_id: entity_qb_id || null,
        entity_name: entity_name || template_name,
        department_name: department_name || null,
        amount: Number(amount || 0),
        memo: memo || null,
        line_items: resolvedLines,
        is_active: true,
        updated_at: new Date().toISOString()
      }

      let savedRec: any = null
      if (id) {
        delete payload.qb_recurring_id
        const { data, error } = await supabase
          .from('external_accounting_recurring')
          .update(payload)
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()
        if (error) throw error
        savedRec = data
      } else {
        const { data, error } = await supabase
          .from('external_accounting_recurring')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        savedRec = data
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: id ? 'EDIT_RECURRING' : 'CREATE_RECURRING',
        entityType: 'RecurringTemplate',
        entityId: savedRec.id,
        amount: Number(amount || 0),
        summary: `${id ? 'Editó' : 'Creó'} plantilla recurrente "${template_name}" (${txn_type || 'Deposit'} por $${Number(amount || 0).toFixed(2)})`
      })

      return NextResponse.json({ success: true, recurring: savedRec })
    }

    // -------------------------------------------------------------------------
    // 7. DELETE RECURRING TEMPLATE
    // -------------------------------------------------------------------------
    if (action === 'delete_recurring') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 })
      }
      const { data: existingRec } = await supabase
        .from('external_accounting_recurring')
        .select('id, template_name')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (!existingRec) {
        return NextResponse.json(
          { error: 'Plantilla recurrente no encontrada en la empresa seleccionada (realmId mismatch).' },
          { status: 404 }
        )
      }

      const { error } = await supabase
        .from('external_accounting_recurring')
        .delete()
        .eq('id', id)
        .eq('company_realm_id', realmId)
      if (error) throw error

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_RECURRING',
        entityType: 'RecurringTemplate',
        entityId: id,
        summary: `Eliminó plantilla recurrente "${existingRec.template_name || id}"`
      })

      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------------------------
    // 8. SAVE ACCOUNT (Chart of Accounts)
    // -------------------------------------------------------------------------
    if (action === 'save_account') {
      const {
        id,
        name,
        acct_num,
        classification,
        account_type,
        account_sub_type,
        current_balance,
        description,
        is_sub_account,
        parent_qb_id,
        is_active,
      } = body
      if (!name || !account_type) {
        return NextResponse.json({ error: 'Name and account_type are required' }, { status: 400 })
      }
      // Auto-derive accurate classification from account_type if not explicitly aligned
      const tLow = String(account_type || '').toLowerCase()
      const derivedClass =
        tLow.includes('payable') || tLow.includes('credit card') || tLow.includes('liability') ? 'Liability' :
        tLow.includes('equity') ? 'Equity' :
        tLow.includes('income') || tLow.includes('revenue') ? 'Revenue' :
        tLow.includes('expense') || tLow.includes('cost of goods') ? 'Expense' :
        (classification || 'Asset')

      const parentAcc = parent_qb_id ? acctByQbId.get(String(parent_qb_id)) : null
      const fqn = is_sub_account && parentAcc ? `${parentAcc.name}:${name}` : name

      let savedAcc: any = null
      if (id) {
        const { data: existingAcc } = await supabase
          .from('external_accounting_accounts')
          .select('id, raw_data, is_active')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!existingAcc) {
          return NextResponse.json(
            { error: 'La cuenta no existe o pertenece a otra empresa (realmId mismatch).' },
            { status: 404 }
          )
        }

        const existingRaw = existingAcc.raw_data && typeof existingAcc.raw_data === 'object' ? existingAcc.raw_data : {}
        const nextRaw = description !== undefined
          ? { ...existingRaw, Description: description || null }
          : existingRaw

        const { data, error } = await supabase
          .from('external_accounting_accounts')
          .update({
            name,
            fully_qualified_name: fqn,
            acct_num: acct_num || null,
            classification: derivedClass,
            account_type,
            account_sub_type: account_sub_type || account_type,
            current_balance: Number(current_balance || 0),
            is_sub_account: Boolean(is_sub_account && parent_qb_id),
            parent_qb_id: is_sub_account && parent_qb_id ? String(parent_qb_id) : null,
            is_active: is_active !== undefined ? Boolean(is_active) : existingAcc.is_active,
            raw_data: nextRaw,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()
        if (error) throw error
        savedAcc = data
      } else {
        const { data, error } = await supabase
          .from('external_accounting_accounts')
          .insert({
            company_realm_id: realmId,
            qb_account_id: `LOCAL-ACC-${Date.now()}`,
            name,
            fully_qualified_name: fqn,
            acct_num: acct_num || null,
            classification: derivedClass,
            account_type,
            account_sub_type: account_sub_type || account_type,
            current_balance: Number(current_balance || 0),
            initial_qbo_balance: Number(current_balance || 0),
            is_sub_account: Boolean(is_sub_account && parent_qb_id),
            parent_qb_id: is_sub_account && parent_qb_id ? String(parent_qb_id) : null,
            is_active: is_active !== undefined ? Boolean(is_active) : true,
            raw_data: description ? { Description: description } : {},
          })
          .select()
          .single()
        if (error) throw error
        savedAcc = data
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: id ? 'EDIT_ACCOUNT' : 'CREATE_ACCOUNT',
        entityType: 'Account',
        entityId: savedAcc.id,
        amount: Number(current_balance || 0),
        summary: `${id ? 'Editó' : 'Creó'} cuenta contable "${name}" (${account_type})`
      })

      const qboSync = await pushAccountToQbo(supabase, realmId, savedAcc)
      return NextResponse.json({ success: true, account: savedAcc, qboSync })
    }

    if (action === 'delete_account') {
      const { id, qb_account_id } = body
      if (!id && !qb_account_id) {
        return NextResponse.json({ error: 'Account id or qb_account_id is required' }, { status: 400 })
      }
      let query = supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', realmId)
      if (id) {
        query = query.eq('id', id)
      } else {
        query = query.eq('qb_account_id', String(qb_account_id))
      }
      const { data: existingAcc } = await query.maybeSingle()
      if (!existingAcc) {
        return NextResponse.json({ error: 'Cuenta contable no encontrada en la empresa activa.' }, { status: 404 })
      }

      const qboSync = await pushAccountToQbo(supabase, realmId, existingAcc, 'DELETE')

      const { error: delErr } = await supabase
        .from('external_accounting_accounts')
        .delete()
        .eq('id', existingAcc.id)
        .eq('company_realm_id', realmId)
      if (delErr) throw delErr

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_ACCOUNT',
        entityType: 'Account',
        entityId: existingAcc.id,
        docNumber: existingAcc.acct_num || existingAcc.qb_account_id,
        amount: Number(existingAcc.current_balance || 0),
        summary: `Eliminó cuenta contable "${existingAcc.name}" (${existingAcc.account_type}) y sincronizó baja con QuickBooks Online (${qboSync.status || 'OK'})`
      })

      return NextResponse.json({ success: true, qboSync })
    }

    // -------------------------------------------------------------------------
    // 9. SAVE / DELETE CONTACT (Vendor / Customer)
    // -------------------------------------------------------------------------
    if (action === 'save_contact') {
      const {
        id,
        contact_type,
        display_name,
        company_name,
        print_on_check_name,
        email,
        phone,
        tax_identifier,
        vendor_1099,
        acct_num,
        address,
        balance,
        is_active,
      } = body
      if (!display_name) {
        return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
      }
      let savedCon: any = null
      if (id) {
        const { data: existingCon } = await supabase
          .from('external_accounting_contacts')
          .select('id, address, acct_num, balance, is_active, print_on_check_name')
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .maybeSingle()

        if (!existingCon) {
          return NextResponse.json(
            { error: 'El contacto no existe o pertenece a otra empresa (realmId mismatch).' },
            { status: 404 }
          )
        }

        const { data, error } = await supabase
          .from('external_accounting_contacts')
          .update({
            contact_type: contact_type || 'Vendor',
            display_name,
            company_name: company_name || display_name,
            print_on_check_name: print_on_check_name || existingCon.print_on_check_name || display_name,
            email: email || null,
            phone: phone || null,
            tax_identifier: tax_identifier || null,
            vendor_1099: Boolean(vendor_1099),
            acct_num: acct_num !== undefined ? (acct_num || null) : existingCon.acct_num,
            address: address !== undefined ? (address || {}) : existingCon.address,
            balance: balance !== undefined ? Number(balance || 0) : Number(existingCon.balance || 0),
            is_active: is_active !== undefined ? Boolean(is_active) : existingCon.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()
        if (error) throw error
        savedCon = data
      } else {
        const { data, error } = await supabase
          .from('external_accounting_contacts')
          .insert({
            company_realm_id: realmId,
            contact_type: contact_type || 'Vendor',
            qb_contact_id: `LOCAL-CON-${Date.now()}`,
            display_name,
            company_name: company_name || display_name,
            print_on_check_name: print_on_check_name || display_name,
            email: email || null,
            phone: phone || null,
            tax_identifier: tax_identifier || null,
            vendor_1099: Boolean(vendor_1099),
            acct_num: acct_num || null,
            address: address || {},
            balance: Number(balance || 0),
            is_active: is_active !== undefined ? Boolean(is_active) : true
          })
          .select()
          .single()
        if (error) throw error
        savedCon = data
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: id ? 'EDIT_CONTACT' : 'CREATE_CONTACT',
        entityType: contact_type || 'Vendor',
        entityId: savedCon.id,
        summary: `${id ? 'Editó' : 'Creó'} ${contact_type || 'Vendor'} "${display_name}"${vendor_1099 ? ' (1099)' : ''}`
      })

      const qboSync = await pushContactToQbo(supabase, realmId, savedCon)
      return NextResponse.json({ success: true, contact: savedCon, qboSync })
    }

    if (action === 'delete_contact') {
      const { id, qb_contact_id } = body
      if (!id && !qb_contact_id) {
        return NextResponse.json({ error: 'Contact id or qb_contact_id is required' }, { status: 400 })
      }
      let query = supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('company_realm_id', realmId)
      if (id) {
        query = query.eq('id', id)
      } else {
        query = query.eq('qb_contact_id', String(qb_contact_id))
      }
      const { data: existingCon } = await query.maybeSingle()
      if (!existingCon) {
        return NextResponse.json({ error: 'Proveedor/Cliente no encontrado en la empresa activa.' }, { status: 404 })
      }

      const qboSync = await pushContactToQbo(supabase, realmId, existingCon, 'DELETE')

      const { error: delErr } = await supabase
        .from('external_accounting_contacts')
        .delete()
        .eq('id', existingCon.id)
        .eq('company_realm_id', realmId)
      if (delErr) throw delErr

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_CONTACT',
        entityType: existingCon.contact_type || 'Vendor',
        entityId: existingCon.id,
        docNumber: existingCon.acct_num || existingCon.qb_contact_id,
        amount: Number(existingCon.balance || 0),
        summary: `Eliminó ${existingCon.contact_type || 'Vendor'} "${existingCon.display_name}" y sincronizó baja con QuickBooks Online (${qboSync.status || 'OK'})`
      })

      return NextResponse.json({ success: true, qboSync })
    }

    // -------------------------------------------------------------------------
    // 9B. TWO-WAY SYNC WITH INTUIT QUICKBOOKS ONLINE V3 (`sync_with_qbo` & `toggle_qbo_mirror_mode`)
    // -------------------------------------------------------------------------
    if (action === 'sync_with_qbo') {
      const syncRes = await syncCompanyWithQbo(supabase, realmId)
      if (!syncRes.ok) {
        return NextResponse.json({ error: syncRes.error || 'Error sincronizando con QuickBooks Online', syncResult: syncRes }, { status: 400 })
      }
      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'QBO_TWO_WAY_SYNC',
        entityType: 'Company',
        entityId: realmId,
        summary: `Sincronizó con QuickBooks Online: Push (${syncRes.pushedTransactions} txns, ${syncRes.pushedAccounts} cuentas, ${syncRes.pushedContacts} contactos) · Pull (${syncRes.pulledTransactions} txns, ${syncRes.pulledAccounts} cuentas, ${syncRes.pulledContacts} contactos)`
      })
      return NextResponse.json({ success: true, syncResult: syncRes })
    }

    if (action === 'sync_all_with_qbo') {
      const syncAllRes = await syncAllCompaniesWithQbo(supabase)
      if (!syncAllRes.ok) {
        return NextResponse.json({ error: 'Ninguna empresa pudo sincronizarse con QuickBooks Online', syncResult: syncAllRes }, { status: 400 })
      }
      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'QBO_TWO_WAY_SYNC_ALL',
        entityType: 'Company',
        entityId: 'ALL_8_COMPANIES',
        summary: `Sincronización Masiva (${syncAllRes.companiesSynced}/${syncAllRes.companiesTotal} empresas): Push (${syncAllRes.pushedTransactions} txns, ${syncAllRes.pushedAccounts} cuentas, ${syncAllRes.pushedContacts} contactos) · Pull (${syncAllRes.pulledTransactions} txns, ${syncAllRes.pulledAccounts} cuentas, ${syncAllRes.pulledContacts} contactos)`
      })
      return NextResponse.json({ success: true, syncResult: syncAllRes })
    }

    if (action === 'toggle_qbo_mirror_mode') {
      const enabled = Boolean(body.enabled)
      const applyToAll = Boolean(body.applyToAll)

      if (applyToAll) {
        const { data: allComps } = await supabase.from('external_accounting_companies').select('realm_id, metadata')
        for (const c of allComps || []) {
          const m = c.metadata && typeof c.metadata === 'object' ? c.metadata : {}
          await supabase
            .from('external_accounting_companies')
            .update({ metadata: { ...m, qbo_sync_enabled: enabled }, updated_at: new Date().toISOString() })
            .eq('realm_id', c.realm_id)
        }
      } else {
        const { data: currComp } = await supabase
          .from('external_accounting_companies')
          .select('metadata')
          .eq('realm_id', realmId)
          .maybeSingle()
        const m = currComp?.metadata && typeof currComp.metadata === 'object' ? currComp.metadata : {}
        await supabase
          .from('external_accounting_companies')
          .update({ metadata: { ...m, qbo_sync_enabled: enabled }, updated_at: new Date().toISOString() })
          .eq('realm_id', realmId)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'TOGGLE_QBO_MIRROR_MODE',
        entityType: 'Company',
        entityId: realmId,
        summary: `${enabled ? 'Activó Modo Espejo QBO (Two-Way Sync)' : 'Activó Modo 100% Autónomo (QBO Desconectado)'}${applyToAll ? ' para las 8 empresas' : ''}`
      })

      return NextResponse.json({ success: true, qbo_sync_enabled: enabled })
    }

    // -------------------------------------------------------------------------
    // 10. BANK RECONCILIATION (Gear Menu ⚙️ -> Tools -> Reconcile)
    // -------------------------------------------------------------------------
    if (action === 'save_reconciliation') {
      const {
        id,
        account_qb_id,
        statement_ending_date,
        beginning_balance,
        ending_balance,
        cleared_balance,
        difference,
        payments_count,
        payments_total,
        deposits_count,
        deposits_total,
        service_charge,
        service_charge_account_qb_id,
        interest_earned,
        interest_account_qb_id,
        auto_adjust_difference,
        adjustment_account_qb_id,
        reconciled_txn_ids,
        status,
        notes,
      } = body

      if (!account_qb_id || !statement_ending_date) {
        return NextResponse.json(
          { error: 'La cuenta bancaria y la fecha de corte del estado de cuenta son obligatorias.' },
          { status: 400 }
        )
      }
      if (companyClosingDate && statement_ending_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede guardar una conciliación con fecha de corte dentro de un periodo cerrado (${statement_ending_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }
      const bankAcc = acctByQbId.get(account_qb_id)
      if (!bankAcc) {
        return NextResponse.json(
          { error: `La cuenta (${account_qb_id}) no pertenece a la empresa activa.` },
          { status: 400 }
        )
      }

      const txnIdsList: string[] = Array.isArray(reconciled_txn_ids)
        ? Array.from(new Set(reconciled_txn_ids.map(String)))
        : []

      let extraPaymentsCount = 0
      let extraPaymentsTotal = 0
      let extraDepositsCount = 0
      let extraDepositsTotal = 0

      // Optional auto-create Bank Service Charge on statement ending date (with fallback Expense account)
      const svcChargeAmt = Number(service_charge || 0)
      const resolvedSvcAcc = (service_charge_account_qb_id && acctByQbId.get(service_charge_account_qb_id))
        || Array.from(acctByQbId.values()).find(a => (a.name || '').toLowerCase().includes('bank charge') || (a.name || '').toLowerCase().includes('service') || a.account_type === 'Expense')
      if (svcChargeAmt > 0 && resolvedSvcAcc && !id) {
        const expAcc = resolvedSvcAcc
        const { data: svcTxn, error: svcErr } = await supabase
          .from('external_accounting_transactions')
          .insert({
            company_realm_id: realmId,
            txn_type: 'Expense',
            qb_entity_type: 'Purchase',
            qb_txn_id: `LOCAL-SVC-${Date.now()}`,
            txn_date: statement_ending_date,
            payment_type: 'Expense',
            direction: 'OUT',
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: expAcc.qb_account_id,
            to_account_name: expAcc.name,
            entity_name: bankAcc.name,
            entity_type: 'Vendor',
            total_amount: svcChargeAmt,
            memo: `Bank Service Charge (${statement_ending_date})`,
            category_summary: expAcc.name,
            cleared_status: status === 'Completed' ? 'Reconciled' : 'Cleared',
            is_voided: false,
            line_items: [{
              id: '1',
              line_num: 1,
              description: `Bank Service Charge (${statement_ending_date})`,
              amount: svcChargeAmt,
              account_qb_id: expAcc.qb_account_id,
              account_name: expAcc.name,
            }],
            created_by: auth.user.name || auth.user.email,
          })
          .select()
          .single()
        if (!svcErr && svcTxn) {
          const deltas = computeTransactionAccountDeltas(acctByQbId, svcTxn, 1)
          await applyAccountDeltasAtomically(supabase, realmId, deltas)
          txnIdsList.push(svcTxn.id)
          extraPaymentsCount += 1
          extraPaymentsTotal += svcChargeAmt
        }
      }

      // Optional auto-create Interest Earned on statement ending date (with fallback Income account)
      const intEarnedAmt = Number(interest_earned || 0)
      const resolvedIntAcc = (interest_account_qb_id && acctByQbId.get(interest_account_qb_id))
        || Array.from(acctByQbId.values()).find(a => (a.name || '').toLowerCase().includes('interest') || a.account_type === 'Other Income' || a.account_type === 'Income')
      if (intEarnedAmt > 0 && resolvedIntAcc && !id) {
        const incAcc = resolvedIntAcc
        const { data: intTxn, error: intErr } = await supabase
          .from('external_accounting_transactions')
          .insert({
            company_realm_id: realmId,
            txn_type: 'Deposit',
            qb_entity_type: 'Deposit',
            qb_txn_id: `LOCAL-INT-${Date.now()}`,
            txn_date: statement_ending_date,
            payment_type: 'Deposit',
            direction: 'IN',
            account_qb_id: bankAcc.qb_account_id,
            account_name: bankAcc.name,
            to_account_qb_id: incAcc.qb_account_id,
            to_account_name: incAcc.name,
            entity_name: bankAcc.name,
            entity_type: 'Customer',
            total_amount: intEarnedAmt,
            memo: `Interest Earned (${statement_ending_date})`,
            category_summary: incAcc.name,
            cleared_status: status === 'Completed' ? 'Reconciled' : 'Cleared',
            is_voided: false,
            line_items: [{
              id: '1',
              line_num: 1,
              description: `Interest Earned (${statement_ending_date})`,
              amount: intEarnedAmt,
              account_qb_id: incAcc.qb_account_id,
              account_name: incAcc.name,
            }],
            created_by: auth.user.name || auth.user.email,
          })
          .select()
          .single()
        if (!intErr && intTxn) {
          const deltas = computeTransactionAccountDeltas(acctByQbId, intTxn, 1)
          await applyAccountDeltasAtomically(supabase, realmId, deltas)
          txnIdsList.push(intTxn.id)
          extraDepositsCount += 1
          extraDepositsTotal += intEarnedAmt
        }
      }

      // Compute finalClearedBalance deterministically from beginning_balance + deposits_total - payments_total - svcChargeAmt + intEarnedAmt
      const isCc = (bankAcc.account_type || '').toLowerCase().includes('credit card')
      const baseBegin = Number(beginning_balance || 0)
      const basePay = Number(payments_total || 0)
      const baseDep = Number(deposits_total || 0)
      const computedFromParts = isCc
        ? Number((baseBegin + basePay + svcChargeAmt - baseDep - intEarnedAmt).toFixed(2))
        : Number((baseBegin - basePay - svcChargeAmt + baseDep + intEarnedAmt).toFixed(2))
      let finalClearedBalance = cleared_balance !== undefined && cleared_balance !== null
        ? Number(Number(cleared_balance).toFixed(2))
        : computedFromParts
      let finalDifference = Number((Number(ending_balance || 0) - finalClearedBalance).toFixed(2))

      // Optional QBO "Finish & Add Adjustment Entry" if difference != 0
      if (status === 'Completed' && auto_adjust_difference && Math.abs(finalDifference) >= 0.01) {
        const fallbackAdjAcc = (adjustment_account_qb_id && acctByQbId.get(adjustment_account_qb_id))
          || Array.from(acctByQbId.values()).find(a => (a.name || '').toLowerCase().includes('reconciliation') || a.account_type === 'Expense')
        if (fallbackAdjAcc) {
          const isPositiveDiff = finalDifference > 0 // Ending balance > Cleared balance -> need Deposit
          const adjAmt = Math.abs(finalDifference)
          const { data: adjTxn, error: adjErr } = await supabase
            .from('external_accounting_transactions')
            .insert({
              company_realm_id: realmId,
              txn_type: isPositiveDiff ? 'Deposit' : 'Expense',
              qb_entity_type: isPositiveDiff ? 'Deposit' : 'Purchase',
              qb_txn_id: `LOCAL-ADJ-${Date.now()}`,
              txn_date: statement_ending_date,
              payment_type: isPositiveDiff ? 'Deposit' : 'Expense',
              direction: isPositiveDiff ? 'IN' : 'OUT',
              account_qb_id: bankAcc.qb_account_id,
              account_name: bankAcc.name,
              to_account_qb_id: fallbackAdjAcc.qb_account_id,
              to_account_name: fallbackAdjAcc.name,
              entity_name: 'Reconciliation Discrepancy Adjustment',
              entity_type: isPositiveDiff ? 'Customer' : 'Vendor',
              total_amount: adjAmt,
              memo: `Ajuste Automático de Conciliación (${statement_ending_date})`,
              category_summary: fallbackAdjAcc.name,
              cleared_status: 'Reconciled',
              is_voided: false,
              line_items: [{
                id: '1',
                line_num: 1,
                description: `Reconciliation Discrepancy Adjustment (${statement_ending_date})`,
                amount: adjAmt,
                account_qb_id: fallbackAdjAcc.qb_account_id,
                account_name: fallbackAdjAcc.name,
              }],
              created_by: auth.user.name || auth.user.email,
            })
            .select()
            .single()

          if (!adjErr && adjTxn) {
            const deltas = computeTransactionAccountDeltas(acctByQbId, adjTxn, 1)
            await applyAccountDeltasAtomically(supabase, realmId, deltas)
            txnIdsList.push(adjTxn.id)
            if (isPositiveDiff) {
              extraDepositsCount += 1
              extraDepositsTotal += adjAmt
            } else {
              extraPaymentsCount += 1
              extraPaymentsTotal += adjAmt
            }
            finalClearedBalance = Number(ending_balance || 0)
            finalDifference = 0
          }
        }
      }

      const finalStatus = status === 'Completed' ? 'Completed' : 'Draft'

      // If Completed, mark all included transactions as Reconciled
      if (finalStatus === 'Completed' && txnIdsList.length > 0) {
        for (let i = 0; i < txnIdsList.length; i += 200) {
          const chunk = txnIdsList.slice(i, i + 200)
          await supabase
            .from('external_accounting_transactions')
            .update({ cleared_status: 'Reconciled', updated_at: new Date().toISOString() })
            .eq('company_realm_id', realmId)
            .in('id', chunk)
        }
      }

      const recPayload: Record<string, any> = {
        company_realm_id: realmId,
        account_qb_id: bankAcc.qb_account_id,
        account_name: bankAcc.name,
        statement_ending_date,
        beginning_balance: Number(beginning_balance || 0),
        ending_balance: Number(ending_balance || 0),
        cleared_balance: finalClearedBalance,
        difference: finalDifference,
        payments_count: Number(payments_count || 0) + extraPaymentsCount,
        payments_total: Number((Number(payments_total || 0) + extraPaymentsTotal).toFixed(2)),
        deposits_count: Number(deposits_count || 0) + extraDepositsCount,
        deposits_total: Number((Number(deposits_total || 0) + extraDepositsTotal).toFixed(2)),
        service_charge: svcChargeAmt,
        interest_earned: intEarnedAmt,
        reconciled_txn_ids: txnIdsList,
        status: finalStatus,
        notes: notes || null,
        reconciled_by: auth.user.name || auth.user.email,
        completed_at: finalStatus === 'Completed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }

      let savedRec: any = null
      if (id) {
        const { data, error } = await supabase
          .from('external_accounting_reconciliations')
          .update(recPayload)
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()
        if (error) throw error
        savedRec = data
      } else {
        const { data, error } = await supabase
          .from('external_accounting_reconciliations')
          .insert(recPayload)
          .select()
          .single()
        if (error) throw error
        savedRec = data
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: finalStatus === 'Completed' ? 'RECONCILE_BANK_COMPLETED' : 'RECONCILE_BANK_DRAFT',
        entityType: 'Reconciliation',
        entityId: savedRec.id,
        docNumber: statement_ending_date,
        amount: Number(ending_balance || 0),
        summary: `${finalStatus === 'Completed' ? 'Finalizó conciliación bancaria' : 'Guardó borrador de conciliación'} de ${bankAcc.name} al ${statement_ending_date} (Saldo Final: $${Number(ending_balance || 0).toFixed(2)}, Diferencia: $${finalDifference.toFixed(2)})`,
        details: { account_name: bankAcc.name, payments_count: recPayload.payments_count, deposits_count: recPayload.deposits_count, difference: finalDifference }
      })

      return NextResponse.json({ success: true, reconciliation: savedRec })
    }

    if (action === 'reopen_reconciliation') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Reconciliation id is required' }, { status: 400 })
      }
      const { data: existingRec } = await supabase
        .from('external_accounting_reconciliations')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (!existingRec) {
        return NextResponse.json({ error: 'Conciliación no encontrada en esta empresa.' }, { status: 404 })
      }
      if (companyClosingDate && existingRec.statement_ending_date && existingRec.statement_ending_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede reabrir una conciliación de un periodo cerrado (${existingRec.statement_ending_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

      const txnIds: string[] = Array.isArray(existingRec.reconciled_txn_ids) ? existingRec.reconciled_txn_ids : []
      if (txnIds.length > 0) {
        for (let i = 0; i < txnIds.length; i += 200) {
          const chunk = txnIds.slice(i, i + 200)
          await supabase
            .from('external_accounting_transactions')
            .update({ cleared_status: 'Cleared', updated_at: new Date().toISOString() })
            .eq('company_realm_id', realmId)
            .in('id', chunk)
        }
      }

      const { data: updatedRec, error: updErr } = await supabase
        .from('external_accounting_reconciliations')
        .update({ status: 'Draft', completed_at: null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .select()
        .single()

      if (updErr) throw updErr

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'REOPEN_RECONCILIATION',
        entityType: 'Reconciliation',
        entityId: id,
        docNumber: existingRec.statement_ending_date,
        amount: Number(existingRec.ending_balance || 0),
        summary: `Reabrió conciliación bancaria de ${existingRec.account_name} (${existingRec.statement_ending_date})`
      })

      return NextResponse.json({ success: true, reconciliation: updatedRec })
    }

    if (action === 'delete_reconciliation') {
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Reconciliation id is required' }, { status: 400 })
      }
      const { data: existingRec } = await supabase
        .from('external_accounting_reconciliations')
        .select('*')
        .eq('id', id)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (!existingRec) {
        return NextResponse.json({ error: 'Conciliación no encontrada en esta empresa.' }, { status: 404 })
      }
      if (companyClosingDate && existingRec.statement_ending_date && existingRec.statement_ending_date <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se puede eliminar una conciliación de un periodo cerrado (${existingRec.statement_ending_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

      const txnIds: string[] = Array.isArray(existingRec.reconciled_txn_ids) ? existingRec.reconciled_txn_ids : []
      if (txnIds.length > 0) {
        for (let i = 0; i < txnIds.length; i += 200) {
          const chunk = txnIds.slice(i, i + 200)
          await supabase
            .from('external_accounting_transactions')
            .update({ cleared_status: 'Cleared', updated_at: new Date().toISOString() })
            .eq('company_realm_id', realmId)
            .in('id', chunk)
        }
      }

      const { error } = await supabase
        .from('external_accounting_reconciliations')
        .delete()
        .eq('id', id)
        .eq('company_realm_id', realmId)

      if (error) throw error

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_RECONCILIATION',
        entityType: 'Reconciliation',
        entityId: id,
        docNumber: existingRec.statement_ending_date,
        amount: Number(existingRec.ending_balance || 0),
        summary: `Eliminó conciliación bancaria de ${existingRec.account_name} (${existingRec.statement_ending_date})`
      })

      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------------------------
    // 11. RECLASSIFY TRANSACTIONS IN BATCH (Gear Menu ⚙️ -> Tools -> Reclassify Transactions)
    // -------------------------------------------------------------------------
    if (action === 'reclassify_transactions') {
      const { txnIds, targetAccountQbId, targetEntityName, targetDepartmentName } = body
      if (!Array.isArray(txnIds) || txnIds.length === 0) {
        return NextResponse.json({ error: 'Selecciona al menos una transacción para reclasificar.' }, { status: 400 })
      }
      if (!targetAccountQbId && !targetEntityName && !targetDepartmentName) {
        return NextResponse.json({ error: 'Debes indicar la nueva cuenta contable, beneficiario o departamento.' }, { status: 400 })
      }

      const targetAcc = targetAccountQbId ? acctByQbId.get(targetAccountQbId) : null
      if (targetAccountQbId && !targetAcc) {
        return NextResponse.json({ error: 'La cuenta destino no pertenece a la empresa activa.' }, { status: 400 })
      }

      const { data: txnsToUpdate, error: loadErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('company_realm_id', realmId)
        .in('id', txnIds)

      if (loadErr) throw loadErr
      const closedRow = companyClosingDate && !body.overrideClosingDate
        ? (txnsToUpdate || []).find(r => r.txn_date && r.txn_date <= companyClosingDate)
        : null
      if (closedRow) {
        return NextResponse.json(
          { error: `No se pueden reclasificar transacciones dentro de un periodo cerrado (${closedRow.txn_date} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

      const validRows = (txnsToUpdate || []).filter(r => !r.is_voided && r.txn_type !== 'Transfer' && r.txn_type !== 'JournalEntry')

      let accumulatedDeltas = new Map<string, number>()
      let updatedCount = 0

      for (const row of validRows) {
        const oldRev = computeTransactionAccountDeltas(acctByQbId, row, -1)
        const existingLines = Array.isArray(row.line_items) && row.line_items.length > 0
          ? row.line_items
          : [{ id: '1', line_num: 1, description: row.memo || '', amount: Number(row.total_amount || 0), account_qb_id: row.to_account_qb_id, account_name: row.to_account_name || row.category_summary }]

        const newLines = existingLines.map((l: any) => ({
          ...l,
          account_qb_id: targetAcc ? targetAcc.qb_account_id : l.account_qb_id,
          account_name: targetAcc ? targetAcc.name : l.account_name,
          entity_name: targetEntityName ? targetEntityName.trim() : l.entity_name,
        }))

        const updatedPayload: Record<string, any> = {
          to_account_qb_id: targetAcc ? targetAcc.qb_account_id : row.to_account_qb_id,
          to_account_name: targetAcc ? targetAcc.name : row.to_account_name,
          category_summary: targetAcc ? targetAcc.name : row.category_summary,
          entity_name: targetEntityName ? targetEntityName.trim() : row.entity_name,
          department_name: targetDepartmentName ? targetDepartmentName.trim() : row.department_name,
          line_items: newLines,
          updated_at: new Date().toISOString(),
        }

        const { data: updatedRow, error: uErr } = await supabase
          .from('external_accounting_transactions')
          .update(updatedPayload)
          .eq('id', row.id)
          .eq('company_realm_id', realmId)
          .select()
          .single()

        if (!uErr && updatedRow) {
          const newApp = computeTransactionAccountDeltas(acctByQbId, updatedRow, 1)
          const rowNet = mergeAccountDeltas(oldRev, newApp)
          accumulatedDeltas = mergeAccountDeltas(accumulatedDeltas, rowNet)
          updatedCount++
        }
      }

      if (accumulatedDeltas.size > 0) {
        await applyAccountDeltasAtomically(supabase, realmId, accumulatedDeltas)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'RECLASSIFY_BATCH',
        entityType: 'BatchReclassify',
        amount: validRows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
        summary: `Reclasificó ${updatedCount} transacciones en lote hacia ${targetAcc?.name || targetEntityName || targetDepartmentName}`,
        details: { updatedCount, targetAccount: targetAcc?.name, targetEntityName, targetDepartmentName }
      })

      return NextResponse.json({ success: true, updatedCount })
    }

    // -------------------------------------------------------------------------
    // 12. BATCH SAVE TRANSACTIONS (+ Create -> Other -> Batch Transactions)
    // -------------------------------------------------------------------------
    if (action === 'batch_save_transactions') {
      const { rows } = body
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: 'Agrega al menos un renglón válido en el lote.' }, { status: 400 })
      }
      if (companyClosingDate && !body.overrideClosingDate) {
        const closedRow = rows.find((r: any) => r.txn_date && r.txn_date <= companyClosingDate)
        if (closedRow) {
          return NextResponse.json(
            { error: `El lote contiene renglones con fecha dentro de un periodo cerrado (${closedRow.txn_date} ≤ ${companyClosingDate}).` },
            { status: 400 }
          )
        }
      }

      let batchDeltas = new Map<string, number>()
      const insertedTxns: any[] = []

      for (const r of rows) {
        const amt = Number(r.amount || 0)
        if (!r.txn_date || !r.account_qb_id || !r.gl_account_qb_id || amt <= 0) continue
        const bankAcc = acctByQbId.get(r.account_qb_id)
        const glAcc = acctByQbId.get(r.gl_account_qb_id)
        if (!bankAcc || !glAcc) continue

        const tType = r.txn_type || 'Check'
        const direction = (tType === 'Deposit' || tType === 'Payment' || tType === 'SalesReceipt') ? 'IN' : 'OUT'

        const payload = {
          company_realm_id: realmId,
          txn_type: tType,
          qb_entity_type: tType === 'Deposit' ? 'Deposit' : 'Purchase',
          qb_txn_id: `LOCAL-BATCH-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          txn_date: r.txn_date,
          doc_number: r.doc_number || null,
          payment_type: tType,
          direction,
          account_qb_id: bankAcc.qb_account_id,
          account_name: bankAcc.name,
          to_account_qb_id: glAcc.qb_account_id,
          to_account_name: glAcc.name,
          entity_name: (r.entity_name || '').trim() || null,
          entity_type: direction === 'IN' ? 'Customer' : 'Vendor',
          total_amount: amt,
          memo: r.memo || null,
          category_summary: glAcc.name,
          print_status: 'NotSet',
          cleared_status: 'Cleared',
          is_voided: false,
          line_items: [{
            id: '1',
            line_num: 1,
            description: r.memo || '',
            amount: amt,
            account_qb_id: glAcc.qb_account_id,
            account_name: glAcc.name,
            entity_name: (r.entity_name || '').trim() || null,
          }],
          created_by: auth.user.name || auth.user.email,
        }

        const { data: saved, error: insErr } = await supabase
          .from('external_accounting_transactions')
          .insert(payload)
          .select()
          .single()

        if (!insErr && saved) {
          insertedTxns.push(saved)
          const d = computeTransactionAccountDeltas(acctByQbId, saved, 1)
          batchDeltas = mergeAccountDeltas(batchDeltas, d)
        }
      }

      if (batchDeltas.size > 0) {
        await applyAccountDeltasAtomically(supabase, realmId, batchDeltas)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'BATCH_CREATE_TRANSACTIONS',
        entityType: 'BatchTransactions',
        amount: insertedTxns.reduce((s, t) => s + Number(t.total_amount || 0), 0),
        summary: `Registró lote de ${insertedTxns.length} transacciones simultáneas`
      })

      return NextResponse.json({ success: true, insertedCount: insertedTxns.length, savedCount: insertedTxns.length, transactions: insertedTxns })
    }

    // -------------------------------------------------------------------------
    // 13. PRINT CHECKS QUEUE (+ Create -> Vendors -> Print Checks)
    // -------------------------------------------------------------------------
    if (action === 'batch_mark_checks_printed') {
      const { items } = body
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'No checks provided' }, { status: 400 })
      }
      for (const item of items) {
        if (!item.id) continue
        await supabase
          .from('external_accounting_transactions')
          .update({
            doc_number: item.doc_number || undefined,
            print_status: 'PrintComplete',
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id)
          .eq('company_realm_id', realmId)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'PRINT_CHECKS_BATCH',
        entityType: 'CheckQueue',
        summary: `Imprimió lote de ${items.length} cheques oficiales`
      })

      return NextResponse.json({ success: true, count: items.length })
    }

    // -------------------------------------------------------------------------
    // 14. BANK RULES (Gear Menu ⚙️ -> Lists -> Rules)
    // -------------------------------------------------------------------------
    if (action === 'save_bank_rule') {
      const {
        id,
        rule_name,
        direction,
        match_field,
        match_text,
        target_account_qb_id,
        target_entity_name,
        target_txn_type,
        auto_apply,
        priority,
      } = body

      if (!rule_name || !match_text || !target_account_qb_id) {
        return NextResponse.json({ error: 'Nombre de regla, texto a buscar y cuenta destino son obligatorios.' }, { status: 400 })
      }
      const targetAcc = acctByQbId.get(target_account_qb_id)
      if (!targetAcc) {
        return NextResponse.json({ error: 'La cuenta destino no pertenece a la empresa activa.' }, { status: 400 })
      }

      const rulePayload = {
        company_realm_id: realmId,
        rule_name: rule_name.trim(),
        direction: direction || 'OUT',
        match_field: match_field || 'ANY',
        match_text: match_text.trim(),
        target_account_qb_id: targetAcc.qb_account_id,
        target_account_name: targetAcc.name,
        target_entity_name: target_entity_name ? target_entity_name.trim() : null,
        target_txn_type: target_txn_type || 'Expense',
        auto_apply: auto_apply !== false,
        priority: Number(priority || 100),
        is_active: true,
        updated_at: new Date().toISOString(),
      }

      let savedRule: any = null
      if (id) {
        const { data, error } = await supabase
          .from('external_accounting_bank_rules')
          .update(rulePayload)
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()
        if (error) throw error
        savedRule = data
      } else {
        const { data, error } = await supabase
          .from('external_accounting_bank_rules')
          .insert(rulePayload)
          .select()
          .single()
        if (error) throw error
        savedRule = data
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: id ? 'EDIT_BANK_RULE' : 'CREATE_BANK_RULE',
        entityType: 'BankRule',
        entityId: savedRule.id,
        summary: `${id ? 'Editó' : 'Creó'} regla bancaria "${rule_name.trim()}" (${match_text.trim()} ➔ ${targetAcc.name})`
      })

      return NextResponse.json({ success: true, rule: savedRule })
    }

    if (action === 'delete_bank_rule') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'Rule id is required' }, { status: 400 })
      const { error } = await supabase
        .from('external_accounting_bank_rules')
        .delete()
        .eq('id', id)
        .eq('company_realm_id', realmId)
      if (error) throw error

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_BANK_RULE',
        entityType: 'BankRule',
        entityId: id,
        summary: `Eliminó regla bancaria #${id}`
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'apply_bank_rules') {
      const { data: rules } = await supabase
        .from('external_accounting_bank_rules')
        .select('*')
        .eq('company_realm_id', realmId)
        .eq('is_active', true)
        .order('priority', { ascending: true })

      if (!rules || rules.length === 0) {
        return NextResponse.json({ success: true, matchedCount: 0, appliedCount: 0 })
      }

      const allTxns = await fetchAllCompanyTransactions(supabase, realmId, false)
      let netDeltas = new Map<string, number>()
      let matchedCount = 0

      for (const txn of allTxns) {
        if (txn.is_voided || txn.cleared_status === 'Reconciled' || txn.txn_type === 'Transfer' || txn.txn_type === 'JournalEntry' || txn.txn_type === 'Estimate' || txn.txn_type === 'PurchaseOrder') continue
        if (companyClosingDate && txn.txn_date && txn.txn_date <= companyClosingDate && !body.overrideClosingDate) continue

        for (const rule of rules) {
          if (rule.direction !== 'ALL' && txn.direction !== rule.direction) continue
          const needle = String(rule.match_text || '').toLowerCase()
          if (!needle) continue
          const hayEntity = String(txn.entity_name || '').toLowerCase()
          const hayMemo = String(txn.memo || '').toLowerCase()
          const hayDoc = String(txn.doc_number || '').toLowerCase()
          const matched =
            rule.match_field === 'ENTITY' ? hayEntity.includes(needle) :
            rule.match_field === 'MEMO' ? hayMemo.includes(needle) :
            rule.match_field === 'DOC_NUMBER' ? hayDoc.includes(needle) :
            (hayEntity.includes(needle) || hayMemo.includes(needle) || hayDoc.includes(needle))

          if (matched && acctByQbId.has(rule.target_account_qb_id)) {
            const targetAcc = acctByQbId.get(rule.target_account_qb_id)
            if (txn.category_summary === targetAcc.name && (!rule.target_entity_name || txn.entity_name === rule.target_entity_name)) {
              break
            }
            const oldRev = computeTransactionAccountDeltas(acctByQbId, txn, -1)
            const existingLines = Array.isArray(txn.line_items) && txn.line_items.length > 0
              ? txn.line_items
              : [{
                  id: '1',
                  line_num: 1,
                  description: txn.memo || '',
                  amount: Number(txn.total_amount || 0),
                  account_qb_id: targetAcc.qb_account_id,
                  account_name: targetAcc.name,
                  entity_name: rule.target_entity_name || txn.entity_name,
                }]
            const newLines = existingLines.map((l: any) => ({
              ...l,
              account_qb_id: targetAcc.qb_account_id,
              account_name: targetAcc.name,
              entity_name: rule.target_entity_name || l.entity_name || txn.entity_name,
            }))
            const { data: updatedTxn, error: uErr } = await supabase
              .from('external_accounting_transactions')
              .update({
                to_account_qb_id: targetAcc.qb_account_id,
                to_account_name: targetAcc.name,
                category_summary: targetAcc.name,
                entity_name: rule.target_entity_name || txn.entity_name,
                line_items: newLines,
                updated_at: new Date().toISOString(),
              })
              .eq('id', txn.id)
              .eq('company_realm_id', realmId)
              .select()
              .single()

            if (!uErr && updatedTxn) {
              const newApp = computeTransactionAccountDeltas(acctByQbId, updatedTxn, 1)
              netDeltas = mergeAccountDeltas(netDeltas, mergeAccountDeltas(oldRev, newApp))
              matchedCount++
            }
            break
          }
        }
      }

      if (netDeltas.size > 0) {
        await applyAccountDeltasAtomically(supabase, realmId, netDeltas)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'BANK_RULES_APPLIED',
        entityType: 'BankRules',
        summary: `Ejecutó reglas bancarias automáticas (${matchedCount} transacciones actualizadas)`
      })

      return NextResponse.json({ success: true, matchedCount, appliedCount: matchedCount })
    }

    // -------------------------------------------------------------------------
    // 15. BUDGETING (Gear Menu ⚙️ -> Tools -> Budgeting)
    // -------------------------------------------------------------------------
    if (action === 'save_budget') {
      const { fiscal_year, account_qb_id, monthly_amounts, annual_total, notes } = body
      if (!account_qb_id) {
        return NextResponse.json({ error: 'Selecciona una cuenta contable para el presupuesto.' }, { status: 400 })
      }
      const targetAcc = acctByQbId.get(account_qb_id)
      if (!targetAcc) {
        return NextResponse.json({ error: 'La cuenta no pertenece a la empresa activa.' }, { status: 400 })
      }

      const fy = Number(fiscal_year || 2026)
      const monthsObj: Record<string, number> = {}
      let computedAnnual = 0
      if (monthly_amounts && typeof monthly_amounts === 'object') {
        for (let m = 1; m <= 12; m++) {
          const key = String(m).padStart(2, '0')
          const val = Number(monthly_amounts[key] ?? monthly_amounts[String(m)] ?? 0)
          monthsObj[key] = Number(val.toFixed(2))
          computedAnnual += monthsObj[key]
        }
      } else {
        const perMonth = Number((Number(annual_total || 0) / 12).toFixed(2))
        for (let m = 1; m <= 12; m++) {
          const key = String(m).padStart(2, '0')
          monthsObj[key] = perMonth
          computedAnnual += perMonth
        }
      }

      const { data, error } = await supabase
        .from('external_accounting_budgets')
        .upsert({
          company_realm_id: realmId,
          fiscal_year: fy,
          account_qb_id: targetAcc.qb_account_id,
          account_name: targetAcc.name,
          account_type: targetAcc.account_type,
          monthly_amounts: monthsObj,
          annual_total: Number(computedAnnual.toFixed(2)),
          notes: notes || null,
          updated_by: auth.user.name || auth.user.email,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_realm_id,fiscal_year,account_qb_id' })
        .select()
        .single()

      if (error) throw error

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'SAVE_BUDGET',
        entityType: 'Budget',
        amount: Number(computedAnnual.toFixed(2)),
        summary: `Actualizó presupuesto ${fy} para ${targetAcc.name} ($${computedAnnual.toFixed(2)} anual)`
      })

      return NextResponse.json({ success: true, budget: data })
    }

    if (action === 'delete_budget') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'Budget id is required' }, { status: 400 })
      const { error } = await supabase
        .from('external_accounting_budgets')
        .delete()
        .eq('id', id)
        .eq('company_realm_id', realmId)
      if (error) throw error

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_BUDGET',
        entityType: 'Budget',
        entityId: id,
        summary: `Eliminó presupuesto #${id}`
      })

      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------------------------
    // 16. COMPANY SETTINGS & BOOKS CLOSING DATE (Gear Menu ⚙️ -> Settings -> Company Settings)
    // -------------------------------------------------------------------------
    if (action === 'save_company_settings') {
      const {
        company_name,
        legal_name,
        email,
        phone,
        address,
        tax_id,
        accounting_method,
        fiscal_year_start_month,
        closing_date,
      } = body

      const nextMeta = {
        ...(companyRecord.metadata || {}),
        tax_id: tax_id ?? companyRecord.metadata?.tax_id ?? '',
        accounting_method: accounting_method || companyRecord.metadata?.accounting_method || 'Accrual',
        fiscal_year_start_month: fiscal_year_start_month || companyRecord.metadata?.fiscal_year_start_month || '01',
        closing_date: closing_date || null,
      }

      const { data: updatedComp, error } = await supabase
        .from('external_accounting_companies')
        .update({
          company_name: company_name || companyRecord.company_name,
          legal_name: legal_name || company_name || companyRecord.legal_name,
          email: email ?? companyRecord.email,
          phone: phone ?? companyRecord.phone,
          address: address || companyRecord.address || {},
          metadata: nextMeta,
          updated_at: new Date().toISOString(),
        })
        .eq('realm_id', realmId)
        .select()
        .single()

      if (error) throw error

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'SAVE_COMPANY_SETTINGS',
        entityType: 'CompanySettings',
        summary: `Actualizó configuración de empresa (${updatedComp.company_name})${closing_date ? ` — Fecha de Cierre: ${closing_date}` : ''}`
      })

      return NextResponse.json({ success: true, company: updatedComp })
    }

    // -------------------------------------------------------------------------
    // 17. LISTS MANAGER: ALL 9 QBO LISTS RELATIONAL TABLES (Gear Menu ⚙️ -> Lists / Tab 12)
    // -------------------------------------------------------------------------
    if (action === 'save_list_item') {
      const { listKey, item } = body
      const allowedKeys = [
        'items',
        'categories',
        'departments',
        'classes',
        'paymentMethods',
        'terms',
        'customFields',
        'attachments',
        'costGroups',
      ]
      if (!allowedKeys.includes(listKey) || !item || !(item.Name || item.name || item.file_name)) {
        return NextResponse.json({ error: 'Lista e información del elemento son obligatorias.' }, { status: 400 })
      }

      const rawName = String(item.Name || item.name || item.file_name || '').trim()
      let itemId = item.Id || item.qb_item_id || item.qb_category_id || item.qb_location_id || item.qb_class_id || item.qb_payment_method_id || item.qb_term_id || item.field_key || item.qb_attachable_id || item.qb_cost_group_id
        ? String(item.Id || item.qb_item_id || item.qb_category_id || item.qb_location_id || item.qb_class_id || item.qb_payment_method_id || item.qb_term_id || item.field_key || item.qb_attachable_id || item.qb_cost_group_id)
        : `LOCAL-${Date.now()}`

      const normalizedItem: Record<string, any> = {
        ...item,
        Id: itemId,
        Name: rawName,
        Active: item.Active !== false,
      }

      // Sync to QuickBooks Online V3 if connected & supported
      const qboPush = await pushListItemToQbo(supabase, realmId, listKey, normalizedItem, 'UPSERT')
      if (qboPush.synced && qboPush.qbId) {
        itemId = qboPush.qbId
        normalizedItem.Id = itemId
      }

      const nowIso = new Date().toISOString()

      // Upsert into the corresponding relational table
      if (listKey === 'items') {
        const incAccId = normalizedItem.income_account_qb_id || normalizedItem.IncomeAccountRef?.value || null
        const expAccId = normalizedItem.expense_account_qb_id || normalizedItem.ExpenseAccountRef?.value || null
        const assAccId = normalizedItem.asset_account_qb_id || normalizedItem.AssetAccountRef?.value || null
        const incAccName = incAccId ? (acctByQbId.get(String(incAccId))?.name || normalizedItem.income_account_name || normalizedItem.IncomeAccountRef?.name || null) : null
        const expAccName = expAccId ? (acctByQbId.get(String(expAccId))?.name || normalizedItem.expense_account_name || normalizedItem.ExpenseAccountRef?.name || null) : null
        const assAccName = assAccId ? (acctByQbId.get(String(assAccId))?.name || normalizedItem.asset_account_name || normalizedItem.AssetAccountRef?.name || null) : null
        const catId = normalizedItem.category_qb_id || normalizedItem.ParentRef?.value || null
        const catName = normalizedItem.category_name || normalizedItem.ParentRef?.name || null

        const { error: dbErr } = await supabase.from('external_accounting_items').upsert({
          company_realm_id: realmId,
          qb_item_id: itemId,
          name: rawName,
          fully_qualified_name: catName ? `${catName}:${rawName}` : (normalizedItem.FullyQualifiedName || rawName),
          sku: normalizedItem.Sku || normalizedItem.sku || null,
          item_type: normalizedItem.Type || normalizedItem.item_type || 'Service',
          category_qb_id: catId ? String(catId) : null,
          category_name: catName,
          is_sub_item: Boolean(catId),
          description: normalizedItem.Description || normalizedItem.description || null,
          unit_price: Number(normalizedItem.UnitPrice ?? normalizedItem.unit_price ?? 0),
          purchase_desc: normalizedItem.PurchaseDesc || normalizedItem.purchase_desc || null,
          purchase_cost: Number(normalizedItem.PurchaseCost ?? normalizedItem.purchase_cost ?? 0),
          income_account_qb_id: incAccId ? String(incAccId) : null,
          income_account_name: incAccName,
          expense_account_qb_id: expAccId ? String(expAccId) : null,
          expense_account_name: expAccName,
          asset_account_qb_id: assAccId ? String(assAccId) : null,
          asset_account_name: assAccName,
          track_qty_on_hand: Boolean(normalizedItem.TrackQtyOnHand ?? normalizedItem.track_qty_on_hand),
          qty_on_hand: Number(normalizedItem.QtyOnHand ?? normalizedItem.qty_on_hand ?? 0),
          taxable: Boolean(normalizedItem.Taxable ?? normalizedItem.taxable),
          is_active: normalizedItem.Active !== false,
          raw_data: qboPush.qboObject || normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_item_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'categories') {
        const parentId = normalizedItem.parent_qb_id || normalizedItem.ParentRef?.value || null
        const parentName = normalizedItem.parent_name || normalizedItem.ParentRef?.name || null
        const { error: dbErr } = await supabase.from('external_accounting_categories').upsert({
          company_realm_id: realmId,
          qb_category_id: itemId,
          name: rawName,
          fully_qualified_name: parentName ? `${parentName}:${rawName}` : rawName,
          parent_qb_id: parentId ? String(parentId) : null,
          parent_name: parentName,
          is_sub_category: Boolean(parentId),
          is_active: normalizedItem.Active !== false,
          raw_data: qboPush.qboObject || normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_category_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'departments') {
        const parentId = normalizedItem.parent_qb_id || normalizedItem.ParentRef?.value || null
        const parentName = normalizedItem.parent_name || normalizedItem.ParentRef?.name || null
        const { error: dbErr } = await supabase.from('external_accounting_locations').upsert({
          company_realm_id: realmId,
          qb_location_id: itemId,
          name: rawName,
          fully_qualified_name: parentName ? `${parentName}:${rawName}` : (normalizedItem.FullyQualifiedName || rawName),
          parent_qb_id: parentId ? String(parentId) : null,
          parent_name: parentName,
          is_sub_location: Boolean(parentId || normalizedItem.SubDepartment),
          address: normalizedItem.address || null,
          is_active: normalizedItem.Active !== false,
          raw_data: qboPush.qboObject || normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_location_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'classes') {
        const parentId = normalizedItem.parent_qb_id || normalizedItem.ParentRef?.value || null
        const parentName = normalizedItem.parent_name || normalizedItem.ParentRef?.name || null
        const { error: dbErr } = await supabase.from('external_accounting_classes').upsert({
          company_realm_id: realmId,
          qb_class_id: itemId,
          name: rawName,
          fully_qualified_name: parentName ? `${parentName}:${rawName}` : (normalizedItem.FullyQualifiedName || rawName),
          class_code: normalizedItem.class_code || normalizedItem.ClassCode || null,
          parent_qb_id: parentId ? String(parentId) : null,
          parent_name: parentName,
          is_sub_class: Boolean(parentId || normalizedItem.SubClass),
          is_active: normalizedItem.Active !== false,
          raw_data: qboPush.qboObject || normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_class_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'paymentMethods') {
        const { error: dbErr } = await supabase.from('external_accounting_payment_methods').upsert({
          company_realm_id: realmId,
          qb_payment_method_id: itemId,
          name: rawName,
          method_type: normalizedItem.Type || normalizedItem.method_type || 'NON_CREDIT_CARD',
          is_active: normalizedItem.Active !== false,
          raw_data: qboPush.qboObject || normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_payment_method_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'terms') {
        const { error: dbErr } = await supabase.from('external_accounting_terms').upsert({
          company_realm_id: realmId,
          qb_term_id: itemId,
          name: rawName,
          term_type: normalizedItem.Type || normalizedItem.term_type || 'STANDARD',
          due_days: Number(normalizedItem.DueDays ?? normalizedItem.due_days ?? 30),
          discount_percent: Number(normalizedItem.DiscountPercent ?? normalizedItem.discount_percent ?? 0),
          discount_days: Number(normalizedItem.DiscountDays ?? normalizedItem.discount_days ?? 0),
          is_active: normalizedItem.Active !== false,
          raw_data: qboPush.qboObject || normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_term_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'customFields') {
        const fieldKey = normalizedItem.field_key || itemId
        const { error: dbErr } = await supabase.from('external_accounting_custom_fields').upsert({
          company_realm_id: realmId,
          field_key: String(fieldKey),
          name: rawName,
          data_type: normalizedItem.data_type || normalizedItem.Type || 'StringType',
          applies_to: Array.isArray(normalizedItem.applies_to) ? normalizedItem.applies_to : ['Invoice', 'SalesReceipt', 'Bill', 'PurchaseOrder', 'Check', 'Expense'],
          is_required: Boolean(normalizedItem.is_required),
          show_on_print: normalizedItem.show_on_print !== false,
          is_active: normalizedItem.Active !== false,
          raw_data: normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,field_key' })
        if (dbErr) throw dbErr
      } else if (listKey === 'attachments') {
        const { error: dbErr } = await supabase.from('external_accounting_attachments').upsert({
          company_realm_id: realmId,
          qb_attachable_id: itemId,
          file_name: rawName,
          content_type: normalizedItem.content_type || normalizedItem.ContentType || 'application/pdf',
          file_size: Number(normalizedItem.file_size || 0),
          file_url: normalizedItem.file_url || normalizedItem.FileAccessUri || null,
          linked_entity_type: normalizedItem.linked_entity_type || null,
          linked_entity_id: normalizedItem.linked_entity_id || null,
          note: normalizedItem.note || normalizedItem.Note || normalizedItem.Description || null,
          raw_data: normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_attachable_id' })
        if (dbErr) throw dbErr
      } else if (listKey === 'costGroups') {
        const { error: dbErr } = await supabase.from('external_accounting_cost_groups').upsert({
          company_realm_id: realmId,
          qb_cost_group_id: itemId,
          name: rawName,
          description: normalizedItem.description || normalizedItem.Description || null,
          cost_type: normalizedItem.cost_type || normalizedItem.Type || 'Direct Cost',
          default_account_qb_id: normalizedItem.default_account_qb_id || null,
          default_account_name: normalizedItem.default_account_name || null,
          is_active: normalizedItem.Active !== false,
          raw_data: normalizedItem,
          updated_at: nowIso,
        }, { onConflict: 'company_realm_id,qb_cost_group_id' })
        if (dbErr) throw dbErr
      }

      // Also keep companyRecord.metadata[listKey] synchronized
      const currentList: any[] = Array.isArray(companyRecord.metadata?.[listKey])
        ? [...companyRecord.metadata[listKey]]
        : []
      const existingIdx = currentList.findIndex(x => String(x.Id) === itemId)
      if (existingIdx >= 0) {
        currentList[existingIdx] = normalizedItem
      } else {
        currentList.push(normalizedItem)
      }
      const nextMeta = {
        ...(companyRecord.metadata || {}),
        [listKey]: currentList,
      }
      await supabase
        .from('external_accounting_companies')
        .update({ metadata: nextMeta, updated_at: nowIso })
        .eq('realm_id', realmId)

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'SAVE_LIST_ITEM',
        entityType: listKey,
        entityId: itemId,
        summary: `Guardó elemento "${rawName}" en tabla relacional ${listKey}${qboPush.synced ? ` [QBO #${itemId}]` : ''}`
      })

      return NextResponse.json({ success: true, itemId, qboPush })
    }

    if (action === 'delete_list_item') {
      const { listKey, itemId } = body
      const allowedKeys = [
        'items',
        'categories',
        'departments',
        'classes',
        'paymentMethods',
        'terms',
        'customFields',
        'attachments',
        'costGroups',
      ]
      if (!allowedKeys.includes(listKey) || !itemId) {
        return NextResponse.json({ error: 'listKey and itemId are required' }, { status: 400 })
      }
      const targetId = String(itemId)
      const existingArr: any[] = Array.isArray(companyRecord.metadata?.[listKey])
        ? companyRecord.metadata[listKey]
        : []
      const removedItem = existingArr.find((x: any) => String(x.Id ?? x.id) === targetId)

      // Delete from the relational table in Supabase
      const tableMap: Record<string, { table: string; idCol: string }> = {
        items: { table: 'external_accounting_items', idCol: 'qb_item_id' },
        categories: { table: 'external_accounting_categories', idCol: 'qb_category_id' },
        departments: { table: 'external_accounting_locations', idCol: 'qb_location_id' },
        classes: { table: 'external_accounting_classes', idCol: 'qb_class_id' },
        paymentMethods: { table: 'external_accounting_payment_methods', idCol: 'qb_payment_method_id' },
        terms: { table: 'external_accounting_terms', idCol: 'qb_term_id' },
        customFields: { table: 'external_accounting_custom_fields', idCol: 'field_key' },
        attachments: { table: 'external_accounting_attachments', idCol: 'qb_attachable_id' },
        costGroups: { table: 'external_accounting_cost_groups', idCol: 'qb_cost_group_id' },
      }
      const tbl = tableMap[listKey]
      if (tbl) {
        const { error: delErr } = await supabase
          .from(tbl.table)
          .delete()
          .eq('company_realm_id', realmId)
          .eq(tbl.idCol, targetId)
        if (delErr) throw delErr
      }

      const currentList: any[] = existingArr.filter((x: any) => String(x.Id ?? x.id) !== targetId)
      const nextMeta = {
        ...(companyRecord.metadata || {}),
        [listKey]: currentList,
      }
      await supabase
        .from('external_accounting_companies')
        .update({ metadata: nextMeta, updated_at: new Date().toISOString() })
        .eq('realm_id', realmId)

      const qboDel = await pushListItemToQbo(
        supabase,
        realmId,
        listKey,
        { Id: targetId, Name: removedItem?.Name || removedItem?.name || targetId },
        'DEACTIVATE'
      )

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'DELETE_LIST_ITEM',
        entityType: listKey,
        entityId: targetId,
        summary: `Eliminó elemento "${removedItem?.Name || removedItem?.name || targetId}" de tabla relacional ${listKey} y sincronizó baja con QuickBooks Online`
      })

      return NextResponse.json({ success: true, list: currentList, qboDel })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[POST /api/external-accounting] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
