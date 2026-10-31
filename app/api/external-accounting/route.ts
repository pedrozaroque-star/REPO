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
import { markRawAsLocallyEdited, isCreditNormalAccount, toNaturalBalance, fromNaturalBalance, buildLedgerContext } from '@/lib/external-accounting-ledger'
import {
  computeTenantAccountSummary,
  generateQboInvoicePdfBuffer,
  generateQboInvoiceEmailHtml,
  sendQboInvoiceEmail,
  generateQboStatementPdfBuffer,
  QboInvoicePdfInput,
  QboInvoiceLineItem,
} from '@/lib/external-accounting-invoice-email'

export const dynamic = 'force-dynamic'

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Computes the next sequential numeric document number for a given transaction type in a company (e.g. Invoice #3313 -> #3314).
 */
function computeNextSequentialDocNumber(txns: any[], targetType: string, fallbackBase = 1000): string {
  let maxNum = fallbackBase
  for (const t of txns || []) {
    if (t.txn_type === targetType && t.doc_number && /^\d+$/.test(String(t.doc_number).trim())) {
      const n = parseInt(String(t.doc_number).trim(), 10)
      if (n > maxNum && n < 99999999) maxNum = n
    }
  }
  return String(maxNum + 1)
}

/**
 * Fetches all transactions for a specific Customer/Tenant or Vendor within a company,
 * filtering directly in PostgreSQL so it is never truncated by PostgREST's 1,000-row company limit.
 */
async function fetchEntityTransactions(
  supabase: any,
  realmId: string,
  entityQbId: string | null,
  entityName: string,
  txnTypes: string[]
): Promise<any[]> {
  const selectCols =
    'id, qb_txn_id, txn_type, txn_date, due_date, doc_number, total_amount, open_balance, is_voided, memo, entity_qb_id, entity_name, line_items, custom_fields, raw_data'
  const queries: Promise<any>[] = []

  if (entityQbId) {
    queries.push(
      supabase
        .from('external_accounting_transactions')
        .select(selectCols)
        .eq('company_realm_id', realmId)
        .eq('entity_qb_id', String(entityQbId))
        .in('txn_type', txnTypes)
        .order('txn_date', { ascending: true })
        .limit(5000)
    )
  }
  if (entityName) {
    queries.push(
      supabase
        .from('external_accounting_transactions')
        .select(selectCols)
        .eq('company_realm_id', realmId)
        .ilike('entity_name', entityName)
        .in('txn_type', txnTypes)
        .order('txn_date', { ascending: true })
        .limit(5000)
    )
  }

  const results = await Promise.all(queries)
  const byId = new Map<string, any>()
  for (const res of results) {
    for (const row of res.data || []) {
      byId.set(row.id, row)
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(a.txn_date || '').localeCompare(String(b.txn_date || ''))
  )
}

/**
 * Recalculates open_balance & raw_data.Balance on linked Invoices/Bills AND updates external_accounting_contacts.balance
 * whenever an Invoice, Payment, CreditMemo, RefundReceipt, Bill, BillPayment, or VendorCredit is created, edited, voided, or deleted.
 */
async function recalculateEntityAndInvoiceBalances(
  supabase: any,
  realmId: string,
  txn: any,
  opts?: { linkedInvoiceIds?: string[]; wasDeletedOrVoided?: boolean }
) {
  if (!txn) return
  const tType = String(txn.txn_type || '')
  const isAr = ['Invoice', 'Payment', 'CreditMemo', 'RefundReceipt'].includes(tType)
  const isAp = ['Bill', 'BillPayment', 'VendorCredit'].includes(tType)
  if (!isAr && !isAp) return

  const entityQbId = txn.entity_qb_id ? String(txn.entity_qb_id) : null
  const entityName = String(txn.entity_name || '').trim()
  if (!entityQbId && !entityName) return

  const docType = isAr ? 'Invoice' : 'Bill'
  const payTypes = isAr ? ['Payment', 'CreditMemo'] : ['BillPayment', 'VendorCredit']
  const contactType = isAr ? 'Customer' : 'Vendor'

  const entityRows = await fetchEntityTransactions(supabase, realmId, entityQbId, entityName, [
    docType,
    ...payTypes,
  ])

  const docs = entityRows.filter((r: any) => r.txn_type === docType && !r.is_voided)
  const payments = entityRows.filter((r: any) => payTypes.includes(r.txn_type) && !r.is_voided)

  // If this call just saved a Payment/CreditMemo/BillPayment/VendorCredit and has explicit or auto-linked invoices/bills
  if (payTypes.includes(tType) && !opts?.wasDeletedOrVoided && txn.id) {
    const currentPay = payments.find((p: any) => p.id === txn.id) || txn
    const pLines: any[] = Array.isArray(currentPay.line_items) ? [...currentPay.line_items] : []
    const explicitIds: string[] = [
      ...(opts?.linkedInvoiceIds || []),
      ...(Array.isArray(currentPay.custom_fields?.linked_invoice_ids) ? currentPay.custom_fields.linked_invoice_ids : []),
      ...pLines.map((l: any) => l.linked_txn_id).filter(Boolean).map(String),
    ]

    if (explicitIds.length === 0 && (!currentPay.raw_data?.Line || !Array.isArray(currentPay.raw_data?.Line))) {
      // Auto-link FIFO to open Invoices/Bills (matching exact amount first, then oldest open first)
      let remainingToLink = Number(currentPay.total_amount || 0)
      const openDocs = docs.filter((d: any) => Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0) > 0)
      const exactDoc = openDocs.find((d: any) => Math.abs(Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0) - remainingToLink) < 0.01)
      const orderedOpen = exactDoc ? [exactDoc, ...openDocs.filter((d: any) => d.id !== exactDoc.id)] : openDocs

      const newLinkedLines: any[] = []
      for (const d of orderedOpen) {
        if (remainingToLink <= 0.005) break
        const dOpen = Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0)
        const applyAmt = Math.min(remainingToLink, dOpen)
        if (applyAmt > 0) {
          newLinkedLines.push({
            id: String(newLinkedLines.length + 1),
            line_num: newLinkedLines.length + 1,
            description: `${tType} for ${docType} #${d.doc_number || d.qb_txn_id}`,
            amount: Number(applyAmt.toFixed(2)),
            linked_txn_id: String(d.qb_txn_id || d.id),
            linked_txn_uuid: String(d.id),
            linked_txn_doc_number: d.doc_number || null,
            linked_txn_type: docType,
            detail_type: 'PaymentLineDetail',
          })
          remainingToLink = Number((remainingToLink - applyAmt).toFixed(2))
        }
      }

      if (newLinkedLines.length > 0) {
        currentPay.line_items = newLinkedLines
        await supabase
          .from('external_accounting_transactions')
          .update({ line_items: newLinkedLines })
          .eq('id', currentPay.id)
          .eq('company_realm_id', realmId)
      }
    }
  }

  // Collect all active applied amounts per Invoice/Bill (by id, qb_txn_id, or doc_number)
  const appliedByDocId = new Map<string, number>()
  const addApplied = (docRow: any, amt: number) => {
    if (!docRow || amt <= 0) return
    appliedByDocId.set(docRow.id, Number(((appliedByDocId.get(docRow.id) || 0) + amt).toFixed(2)))
  }

  const findMatchingDoc = (l: any) => {
    if (l?.linked_txn_uuid) {
      const byUuid = docs.find((d: any) => String(d.id) === String(l.linked_txn_uuid).trim())
      if (byUuid) return byUuid
    }
    if (l?.linked_txn_id) {
      const byQbId = docs.find(
        (d: any) => String(d.qb_txn_id) === String(l.linked_txn_id).trim() || String(d.id) === String(l.linked_txn_id).trim()
      )
      if (byQbId) return byQbId
    }
    if (l?.linked_txn_doc_number) {
      const byDocNum = docs.find(
        (d: any) => d.doc_number && String(d.doc_number).trim() === String(l.linked_txn_doc_number).trim()
      )
      if (byDocNum) return byDocNum
    }
    return null
  }

  let unappliedCreditsTotal = 0
  for (const p of payments) {
    const pTotal = Number(p.total_amount || 0)
    let pApplied = 0
    const pLines: any[] = Array.isArray(p.line_items) ? p.line_items : []
    const rawLines: any[] = Array.isArray(p.raw_data?.Line) ? p.raw_data.Line : []
    const customLinkedIds: string[] = Array.isArray(p.custom_fields?.linked_invoice_ids)
      ? p.custom_fields.linked_invoice_ids.map(String)
      : []

    let foundLinkInLines = false
    let updatedCurrentPayLines = false
    for (const l of pLines) {
      const hasAnyLinkProp = Boolean(l.linked_txn_id || l.linked_txn_uuid || l.linked_txn_doc_number)
      if (hasAnyLinkProp) {
        foundLinkInLines = true
        const target = findMatchingDoc(l)
        const amt = Number(l.amount || pTotal || 0)
        if (target) {
          addApplied(target, amt)
          if (p.id === txn.id && target.qb_txn_id && l.linked_txn_id !== String(target.qb_txn_id)) {
            l.linked_txn_id = String(target.qb_txn_id)
            updatedCurrentPayLines = true
          }
        }
        pApplied += amt
      }
    }
    if (updatedCurrentPayLines && p.id === txn.id) {
      txn.line_items = pLines
      await supabase
        .from('external_accounting_transactions')
        .update({ line_items: pLines })
        .eq('id', p.id)
        .eq('company_realm_id', realmId)
    }

    if (!foundLinkInLines && rawLines.length > 0) {
      for (const rl of rawLines) {
        const lt = Array.isArray(rl.LinkedTxn) ? rl.LinkedTxn[0] : null
        if (lt?.TxnId) {
          foundLinkInLines = true
          const target = docs.find((d: any) => String(d.qb_txn_id) === String(lt.TxnId) || String(d.id) === String(lt.TxnId))
          const amt = Number(rl.Amount || pTotal || 0)
          if (target) {
            addApplied(target, amt)
          }
          pApplied += amt
        }
      }
    }

    if (!foundLinkInLines && customLinkedIds.length > 0) {
      let rem = pTotal
      for (const cid of customLinkedIds) {
        const target = docs.find((d: any) => String(d.id) === cid || String(d.qb_txn_id) === cid || String(d.doc_number) === cid)
        if (target && rem > 0) {
          const amt = Math.min(rem, Number(target.total_amount || 0))
          addApplied(target, amt)
          rem = Number((rem - amt).toFixed(2))
          pApplied += amt
        }
      }
    }

    if (!foundLinkInLines && customLinkedIds.length === 0) {
      // Unlinked local payment
      unappliedCreditsTotal = Number((unappliedCreditsTotal + pTotal).toFixed(2))
    } else if (pTotal > pApplied + 0.01 && p.raw_data?.UnappliedAmt === undefined) {
      unappliedCreditsTotal = Number((unappliedCreditsTotal + (pTotal - pApplied)).toFixed(2))
    } else if (p.raw_data?.UnappliedAmt !== undefined) {
      unappliedCreditsTotal = Number((unappliedCreditsTotal + Number(p.raw_data.UnappliedAmt || 0)).toFixed(2))
    }
  }

  // Detect if a voided/deleted payment was previously linked to specific Invoices/Bills so we know to reopen them
  const reopenedDocIds = new Set<string>()
  if (opts?.wasDeletedOrVoided && payTypes.includes(tType)) {
    const oldLines: any[] = Array.isArray(txn.line_items) ? txn.line_items : []
    const oldRawLines: any[] = Array.isArray(txn.raw_data?.Line) ? txn.raw_data.Line : []
    for (const l of oldLines) {
      const target = findMatchingDoc(l)
      if (target) reopenedDocIds.add(target.id)
    }
    for (const rl of oldRawLines) {
      const lt = Array.isArray(rl.LinkedTxn) ? rl.LinkedTxn[0] : null
      if (lt?.TxnId) {
        const target = docs.find((d: any) => String(d.qb_txn_id) === String(lt.TxnId) || String(d.id) === String(lt.TxnId))
        if (target) reopenedDocIds.add(target.id)
      }
    }
  }

  // Update open_balance & raw_data.Balance on any Invoice/Bill whose computed open balance changed
  let totalOpenDocsBalance = 0
  for (const d of docs) {
    const hasActiveLink = appliedByDocId.has(d.id)
    const wasReopened = reopenedDocIds.has(d.id)
    const isThisDocJustSaved = d.id === txn.id
    const currentOpen = Number(d.open_balance ?? d.raw_data?.Balance ?? d.total_amount ?? 0)

    let nextOpen = currentOpen
    if (hasActiveLink || wasReopened || isThisDocJustSaved) {
      const applied = appliedByDocId.get(d.id) || 0
      nextOpen = Math.max(0, Number((Number(d.total_amount || 0) - applied).toFixed(2)))
    }

    if (Math.abs(nextOpen - Number(d.open_balance ?? -1)) > 0.005 || Math.abs(nextOpen - Number(d.raw_data?.Balance ?? nextOpen)) > 0.005) {
      const nextRaw = { ...(d.raw_data && typeof d.raw_data === 'object' ? d.raw_data : {}), Balance: nextOpen }
      await supabase
        .from('external_accounting_transactions')
        .update({ open_balance: nextOpen, raw_data: nextRaw })
        .eq('id', d.id)
        .eq('company_realm_id', realmId)
      d.open_balance = nextOpen
      d.raw_data = nextRaw
    }

    totalOpenDocsBalance = Number((totalOpenDocsBalance + nextOpen).toFixed(2))
  }

  const finalContactBalance = Math.max(0, Number((totalOpenDocsBalance - unappliedCreditsTotal).toFixed(2)))

  // Update external_accounting_contacts.balance for this Customer/Tenant or Vendor
  const { data: matchingContacts } = await supabase
    .from('external_accounting_contacts')
    .select('id, qb_contact_id, display_name, company_name, contact_type')
    .eq('company_realm_id', realmId)
    .eq('contact_type', contactType)

  const targetContact = (matchingContacts || []).find((c: any) =>
    (entityQbId && String(c.qb_contact_id) === entityQbId) ||
    (entityName && String(c.display_name || '').trim().toLowerCase() === entityName.toLowerCase()) ||
    (entityName && String(c.company_name || '').trim().toLowerCase() === entityName.toLowerCase())
  )

  if (targetContact) {
    await supabase
      .from('external_accounting_contacts')
      .update({ balance: finalContactBalance, updated_at: new Date().toISOString() })
      .eq('id', targetContact.id)
      .eq('company_realm_id', realmId)
  }
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
    // Full double-entry context (items + linked payments) so every running balance matches the QBO register
    const ledgerCtxForGet = buildLedgerContext(accountsList, itemsRes.data || [], allCompanyTxns)

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
      // Present like the QBO register: liabilities / equity / income balances shown positive
      const rowWithBal = {
        ...t,
        running_balance: currentBal !== null ? toNaturalBalance(acctByQbIdForGet.get(targetAccId), currentBal) : null
      }

      if (!t.is_voided && t.txn_type !== 'Estimate' && t.txn_type !== 'PurchaseOrder') {
        const revDeltas = computeTransactionAccountDeltas(acctByQbIdForGet, t, -1, ledgerCtxForGet)
        for (const [qId, revDelta] of revDeltas.entries()) {
          if (runningCursor.has(qId)) {
            runningCursor.set(qId, Number(((runningCursor.get(qId) || 0) + revDelta).toFixed(2)))
          }
          const yr = (t.txn_date || '').slice(0, 4)
          if (yr) {
            if (!actualsByAccountAndYear[qId]) actualsByAccountAndYear[qId] = {}
            // Forward delta is -revDelta; Budget vs Actual uses the natural sign (income & liabilities positive)
            const naturalForward = isCreditNormalAccount(acctByQbIdForGet.get(qId)) ? revDelta : -revDelta
            actualsByAccountAndYear[qId][yr] = Number(((actualsByAccountAndYear[qId][yr] || 0) + naturalForward).toFixed(2))
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

    // 6B. Dedicated untruncated QBO sub-view lists (Invoices, Sales, Bills, Expenses) independent of Bank Register pagination/direction filter
    const invoicesFiltered = txnsWithRunningBalance.filter(t => {
      if (t.txn_type !== 'Invoice') return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    const salesFiltered = txnsWithRunningBalance.filter(t => {
      if (!['Invoice', 'Payment', 'SalesReceipt', 'CreditMemo', 'Estimate', 'RefundReceipt', 'Deposit'].includes(t.txn_type)) return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    const billsFiltered = txnsWithRunningBalance.filter(t => {
      if (!['Bill', 'BillPayment', 'VendorCredit', 'PurchaseOrder'].includes(t.txn_type)) return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
      return true
    })

    const expensesFiltered = txnsWithRunningBalance.filter(t => {
      if (!['Expense', 'Check', 'Bill', 'BillPayment', 'CreditCardExpense', 'CreditCardCredit', 'VendorCredit', 'PurchaseOrder'].includes(t.txn_type)) return false
      if (startDate && t.txn_date < startDate) return false
      if (endDate && t.txn_date > endDate) return false
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

    // Suggest next check number for each bank account (only Check & BillPayment)
    const nextCheckNumberByBank: Record<string, string> = {}
    for (const b of bankAccounts) {
      let maxNum = 1000
      for (const t of allCompanyTxns) {
        if (
          (t.txn_type === 'Check' || t.txn_type === 'BillPayment') &&
          t.account_qb_id === b.qb_account_id &&
          t.doc_number &&
          /^\d+$/.test(t.doc_number.trim())
        ) {
          const n = parseInt(t.doc_number.trim(), 10)
          if (n > maxNum && n < 9999999) maxNum = n
        }
      }
      nextCheckNumberByBank[b.qb_account_id] = String(maxNum + 1)
    }

    const nextInvoiceNumber = computeNextSequentialDocNumber(allCompanyTxns, 'Invoice', 1000)
    const nextEstimateNumber = computeNextSequentialDocNumber(allCompanyTxns, 'Estimate', 1000)

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

    // Build QBO Chart of Accounts hierarchy (Parent -> Sub-Account -> Sub-Sub-Account -> Sub-Sub-Sub-Account)
    const QBO_ACCT_TYPE_ORDER: Record<string, number> = {
      'Bank': 1,
      'Accounts Receivable': 2,
      'Other Current Asset': 3,
      'Fixed Asset': 4,
      'Other Asset': 5,
      'Accounts Payable': 6,
      'Credit Card': 7,
      'Other Current Liability': 8,
      'Long Term Liability': 9,
      'Equity': 10,
      'Income': 11,
      'Cost of Goods Sold': 12,
      'Expense': 13,
      'Other Income': 14,
      'Other Expense': 15,
    }

    const rawAccountsWithDisplay = accountsList.map((a: any) => ({
      ...a,
      display_balance: toNaturalBalance(a, Number(a.current_balance || 0)),
    }))
    const acctByQbIdMap = new Map<string, any>()
    const acctByNameLowerMap = new Map<string, any>()
    for (const a of rawAccountsWithDisplay) {
      acctByQbIdMap.set(String(a.qb_account_id), a)
      acctByNameLowerMap.set(String(a.fully_qualified_name || a.name || '').toLowerCase(), a)
    }

    // Resolve parent_qb_id for every account (from explicit parent_qb_id, raw_data.ParentRef, or fully_qualified_name prefix)
    const resolvedParentMap = new Map<string, string | null>()
    const childrenByParentId = new Map<string, any[]>()
    for (const a of rawAccountsWithDisplay) {
      const idStr = String(a.qb_account_id)
      let pId = String(a.parent_qb_id || a.raw_data?.ParentRef?.value || '').trim()
      if (!pId && a.fully_qualified_name && String(a.fully_qualified_name).includes(':')) {
        const prefix = String(a.fully_qualified_name).split(':').slice(0, -1).join(':').toLowerCase()
        const pAcc = acctByNameLowerMap.get(prefix)
        if (pAcc && String(pAcc.qb_account_id) !== idStr) pId = String(pAcc.qb_account_id)
      }
      if (pId && pId !== idStr && acctByQbIdMap.has(pId)) {
        resolvedParentMap.set(idStr, pId)
        if (!childrenByParentId.has(pId)) childrenByParentId.set(pId, [])
        childrenByParentId.get(pId)!.push(a)
      } else {
        resolvedParentMap.set(idStr, null)
      }
    }

    const collectDescendants = (idStr: string, visited = new Set<string>()): any[] => {
      if (visited.has(idStr)) return []
      visited.add(idStr)
      const direct = childrenByParentId.get(idStr) || []
      const all: any[] = []
      for (const ch of direct) {
        all.push(ch)
        all.push(...collectDescendants(String(ch.qb_account_id), visited))
      }
      return all
    }

    const computeBreadcrumb = (idStr: string): Array<{ qb_account_id: string; name: string }> => {
      const path: Array<{ qb_account_id: string; name: string }> = []
      const seen = new Set<string>()
      let cur: string | null = idStr
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const node = acctByQbIdMap.get(cur)
        if (!node) break
        path.unshift({ qb_account_id: String(node.qb_account_id), name: node.name })
        cur = resolvedParentMap.get(cur) || null
      }
      return path
    }

    const enrichedAccounts = rawAccountsWithDisplay
      .map((a: any) => {
        const idStr = String(a.qb_account_id)
        const breadcrumb = computeBreadcrumb(idStr)
        const depth = Math.max(0, breadcrumb.length - 1, (String(a.fully_qualified_name || '').split(':').length - 1))
        const directChildren = childrenByParentId.get(idStr) || []
        const allDescendants = collectDescendants(idStr)
        const rollupBalance = Number(
          (
            Number(a.display_balance || 0) +
            allDescendants.reduce((s, d) => s + Number(d.display_balance || 0), 0)
          ).toFixed(2)
        )
        return {
          ...a,
          parent_qb_id: resolvedParentMap.get(idStr) || a.parent_qb_id || null,
          is_sub_account: Boolean(a.is_sub_account || depth > 0),
          depth,
          children_count: directChildren.length,
          descendants_count: allDescendants.length,
          rollup_balance: rollupBalance,
          breadcrumb_path: breadcrumb,
        }
      })
      .sort((a: any, b: any) => {
        const rootA = a.breadcrumb_path?.[0] ? acctByQbIdMap.get(a.breadcrumb_path[0].qb_account_id) || a : a
        const rootB = b.breadcrumb_path?.[0] ? acctByQbIdMap.get(b.breadcrumb_path[0].qb_account_id) || b : b
        const ordA = QBO_ACCT_TYPE_ORDER[rootA.account_type] ?? 99
        const ordB = QBO_ACCT_TYPE_ORDER[rootB.account_type] ?? 99
        if (ordA !== ordB) return ordA - ordB
        const fqnA = String(a.fully_qualified_name || a.breadcrumb_path?.map((p: any) => p.name).join(':') || a.name || '')
        const fqnB = String(b.fully_qualified_name || b.breadcrumb_path?.map((p: any) => p.name).join(':') || b.name || '')
        return fqnA.localeCompare(fqnB)
      })

    return NextResponse.json({
      activeRealmId,
      companies: enrichedCompanies,
      // `current_balance` keeps the QBO API sign (debit-positive); `display_balance` is how QBO shows it on screen; `rollup_balance` includes all sub-accounts
      accounts: enrichedAccounts,
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
      depositsTransactions: depositsFiltered.slice(0, 500),
      invoicesTransactions: invoicesFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      salesTransactions: salesFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      billsTransactions: billsFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      expensesTransactions: expensesFiltered.map((t, i) => i < 200 ? t : { ...t, raw_data: { Balance: t.open_balance } }),
      nextCheckNumberByBank,
      nextInvoiceNumber,
      nextEstimateNumber,
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

    // Load company accounts & items map for strict cross-realm reference validation & atomic delta calculation
    const [{ data: companyAccounts, error: accLoadErr }, { data: companyItems }] = await Promise.all([
      supabase
        .from('external_accounting_accounts')
        .select('*')
        .eq('company_realm_id', realmId),
      supabase
        .from('external_accounting_items')
        .select('*')
        .eq('company_realm_id', realmId),
    ])

    if (accLoadErr) throw accLoadErr
    const acctByQbId = new Map<string, any>()
    for (const a of companyAccounts || []) {
      acctByQbId.set(a.qb_account_id, a)
    }
    const itemByQbId = new Map<string, any>()
    const itemByNameLower = new Map<string, any>()
    for (const it of companyItems || []) {
      if (it.qb_item_id) itemByQbId.set(String(it.qb_item_id), it)
      if (it.name) itemByNameLower.set(String(it.name).trim().toLowerCase(), it)
      if (it.fully_qualified_name) itemByNameLower.set(String(it.fully_qualified_name).trim().toLowerCase(), it)
    }
    const ledgerCtx = buildLedgerContext(companyAccounts || [], companyItems || [])

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

      // Normalize line items (preserving detail_type, linked_txn_id, linked_txn_type, entity_type, and resolving item -> account mapping)
      const isSalesLikeTxn =
        txn_type === 'Invoice' ||
        txn_type === 'SalesReceipt' ||
        txn_type === 'CreditMemo' ||
        txn_type === 'RefundReceipt' ||
        txn_type === 'Estimate' ||
        txn_type === 'Deposit'
      const normalizedLines = Array.isArray(line_items) ? line_items.map((l: any, idx: number) => {
        const rawItemQbId = l.item_qb_id || l.item_id || null
        const matchedItem =
          (rawItemQbId && itemByQbId.get(String(rawItemQbId))) ||
          (l.item_name && itemByNameLower.get(String(l.item_name).trim().toLowerCase())) ||
          null
        const itemFallbackAccQbId = matchedItem
          ? (isSalesLikeTxn
              ? (matchedItem.income_account_qb_id || matchedItem.expense_account_qb_id || null)
              : (matchedItem.expense_account_qb_id || matchedItem.asset_account_qb_id || matchedItem.income_account_qb_id || null))
          : null
        const resolvedLineAccQbId = l.account_qb_id || itemFallbackAccQbId || null
        return {
          id: String(idx + 1),
          line_num: idx + 1,
          description: l.description || matchedItem?.description || '',
          amount: Number(l.amount || 0),
          posting_type: l.posting_type || null,
          detail_type: l.detail_type || null,
          account_qb_id: resolvedLineAccQbId,
          account_name: l.account_name || (resolvedLineAccQbId ? acctByQbId.get(String(resolvedLineAccQbId))?.name : '') || '',
          entity_qb_id: l.entity_qb_id || null,
          entity_name: l.entity_name || entity_name || null,
          entity_type: l.entity_type || null,
          payment_method: l.payment_method || payment_type || null,
          check_num: l.check_num || doc_number || null,
          item_qb_id: rawItemQbId || matchedItem?.qb_item_id || null,
          item_id: rawItemQbId || matchedItem?.qb_item_id || null,
          item_name: l.item_name || matchedItem?.name || null,
          class_qb_id: l.class_qb_id || class_qb_id || null,
          class_name: l.class_name || class_name || null,
          department_qb_id: l.department_qb_id || department_qb_id || null,
          department_name: l.department_name || department_name || null,
          qty: l.qty != null && l.qty !== '' ? Number(l.qty) : null,
          rate: l.rate != null && l.rate !== '' ? Number(l.rate) : (l.unit_price != null && l.unit_price !== '' ? Number(l.unit_price) : null),
          linked_txn_id: l.linked_txn_id || null,
          linked_txn_uuid: l.linked_txn_uuid || null,
          linked_txn_doc_number: l.linked_txn_doc_number || null,
          linked_txn_type: l.linked_txn_type || null,
        }
      }) : []

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
        } else if (txn_type === 'Payment' || txn_type === 'BillPayment') {
          const linesSum = normalizedLines.reduce((s, l) => s + Number(l.amount || 0), 0)
          if (computedTotal <= 0 && linesSum > 0) {
            computedTotal = Number(linesSum.toFixed(2))
          }
        } else {
          const linesSum = normalizedLines.reduce((s, l) => {
            const amt = Number(l.amount || 0)
            return l.detail_type === 'CashBackLineDetail' ? s - Math.abs(amt) : s + amt
          }, 0)
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

      // Resolve primary account for Invoice/CreditMemo (Accounts Receivable), Bill/VendorCredit (Accounts Payable), or Payment/SalesReceipt (Undeposited Funds / Bank)
      let resolvedAccountQbId = account_qb_id || null
      let resolvedAccountName = account_qb_id ? (acctByQbId.get(account_qb_id)?.name || account_name || null) : null
      if (!resolvedAccountQbId && (txn_type === 'Invoice' || txn_type === 'CreditMemo' || txn_type === 'Bill' || txn_type === 'VendorCredit')) {
        const targetType = (txn_type === 'Invoice' || txn_type === 'CreditMemo') ? 'Accounts Receivable' : 'Accounts Payable'
        const fallbackAcc = (companyAccounts || []).find(a => a.account_type === targetType && a.is_active)
        if (fallbackAcc) {
          resolvedAccountQbId = fallbackAcc.qb_account_id
          resolvedAccountName = fallbackAcc.name
        }
      } else if (!resolvedAccountQbId && (txn_type === 'Payment' || txn_type === 'SalesReceipt')) {
        const ufAcc = (companyAccounts || []).find(a =>
          (String(a.account_sub_type || '').toLowerCase() === 'undepositedfunds' ||
            String(a.name || '').toLowerCase().includes('undeposited funds')) &&
          a.is_active
        ) || (companyAccounts || []).find(a => a.account_type === 'Bank' && a.is_active)
        if (ufAcc) {
          resolvedAccountQbId = ufAcc.qb_account_id
          resolvedAccountName = ufAcc.name
        }
      }

      // Auto-create or resolve contact strictly within this realmId
      let resolvedEntityQbId = entity_qb_id || null
      const lineEntityNames = Array.from(new Set(normalizedLines.map(l => (l.entity_name || '').trim()).filter(Boolean)))
      const trimmedEntityName = (entity_name || '').trim() || lineEntityNames.join(', ')
      const lineDocNums = Array.from(new Set(normalizedLines.map(l => (l.check_num || '').trim()).filter(Boolean)))
      let resolvedDocNumber = (doc_number || '').trim() || lineDocNums.join(', ') || null

      // Auto-assign sequential Invoice # if creating an Invoice without a doc_number
      if (!resolvedDocNumber && (txn_type === 'Invoice' || txn_type === 'Estimate')) {
        const { data: existingDocs } = await supabase
          .from('external_accounting_transactions')
          .select('txn_type, doc_number')
          .eq('company_realm_id', realmId)
          .eq('txn_type', txn_type)
          .order('txn_date', { ascending: false })
          .limit(1000)
        resolvedDocNumber = computeNextSequentialDocNumber(existingDocs || [], txn_type, 1000)
      }

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

      const arDefaultAcc = (companyAccounts || []).find(a => a.account_type === 'Accounts Receivable' && a.is_active)
      const apDefaultAcc = (companyAccounts || []).find(a => a.account_type === 'Accounts Payable' && a.is_active)

      const resolvedToAccountQbId = txn_type === 'Payment'
        ? (arDefaultAcc?.qb_account_id || to_account_qb_id || null)
        : txn_type === 'BillPayment'
        ? (apDefaultAcc?.qb_account_id || to_account_qb_id || null)
        : (to_account_qb_id || normalizedLines[0]?.account_qb_id || null)

      const resolvedToAccountName = resolvedToAccountQbId
        ? (acctByQbId.get(resolvedToAccountQbId)?.name || to_account_name || null)
        : (normalizedLines[0]?.account_name || null)

      const categories = Array.from(new Set(normalizedLines.map(l => l.account_name).filter(Boolean)))
      const categorySummary = (txn_type === 'Transfer' || txn_type === 'PayDownCreditCard')
        ? `${resolvedAccountName || ''} ➔ ${resolvedToAccountName || ''}`
        : categories.join(', ') || resolvedToAccountName || txn_type

      const mergedCustomFields = {
        ...(custom_fields && typeof custom_fields === 'object' ? custom_fields : {}),
        ...(Array.isArray(body.linked_invoice_ids) && body.linked_invoice_ids.length > 0
          ? { linked_invoice_ids: body.linked_invoice_ids }
          : {}),
      }

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
        to_account_qb_id: resolvedToAccountQbId,
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
        custom_fields: mergedCustomFields,
        total_amount: computedTotal,
        open_balance: (txn_type === 'Invoice' || txn_type === 'Bill')
          ? (existingTxn ? Number(existingTxn.open_balance ?? computedTotal) : computedTotal)
          : 0,
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
        const oldReversalDeltas = computeTransactionAccountDeltas(acctByQbId, existingTxn, -1, ledgerCtx)
        // The QBO snapshot no longer describes this row until the next successful push/sync
        payload.raw_data = markRawAsLocallyEdited(existingTxn?.raw_data)
        const { data: savedTxn, error: updErr } = await supabase
          .from('external_accounting_transactions')
          .update(payload)
          .eq('id', id)
          .eq('company_realm_id', realmId)
          .select()
          .single()

        if (updErr) throw updErr

        const newApplyDeltas = computeTransactionAccountDeltas(acctByQbId, savedTxn, 1, ledgerCtx)
        const netDeltas = mergeAccountDeltas(oldReversalDeltas, newApplyDeltas)
        await applyAccountDeltasAtomically(supabase, realmId, netDeltas)
        await recalculateEntityAndInvoiceBalances(supabase, realmId, savedTxn, { linkedInvoiceIds: body.linked_invoice_ids })

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
          const newApplyDeltas = computeTransactionAccountDeltas(acctByQbId, savedTxn, 1, ledgerCtx)
          await applyAccountDeltasAtomically(supabase, realmId, newApplyDeltas)
          await recalculateEntityAndInvoiceBalances(supabase, realmId, savedTxn, { linkedInvoiceIds: body.linked_invoice_ids })
        } catch (balErr) {
          // Compensating rollback if balance update fails
          await supabase.from('external_accounting_transactions').delete().eq('id', savedTxn.id)
          throw balErr
        }

        // Two-way mirror push to Intuit QuickBooks Online V3 (if company is connected & mirror mode active)
        const qboSync = body.skipQboSync
          ? { synced: false, status: 'SKIPPED_BY_CALLER' }
          : await pushTransactionToQbo(supabase, realmId, savedTxn, 'UPSERT')
        if (qboSync?.qbTxnId) {
          savedTxn.qb_txn_id = qboSync.qbTxnId
        }

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
      await recalculateEntityAndInvoiceBalances(supabase, realmId, existing, { wasDeletedOrVoided: true })

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
      await recalculateEntityAndInvoiceBalances(supabase, realmId, existing, { wasDeletedOrVoided: true })

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

      let resolvedRecDocNumber = docNumber || lines[0]?.check_num || null
      if (!resolvedRecDocNumber) {
        if (tType === 'Invoice' || tType === 'Estimate') {
          const { data: existingDocs } = await supabase
            .from('external_accounting_transactions')
            .select('txn_type, doc_number')
            .eq('company_realm_id', realmId)
            .eq('txn_type', tType)
          resolvedRecDocNumber = computeNextSequentialDocNumber(existingDocs || [], tType, 1000)
        } else {
          resolvedRecDocNumber = 'EFT'
        }
      }

      const { data: createdTxn, error: insErr } = await supabase
        .from('external_accounting_transactions')
        .insert({
          company_realm_id: realmId,
          txn_type: tType,
          qb_entity_type: tType === 'Check' || tType === 'Expense' ? 'Purchase' : tType,
          qb_txn_id: `REC-${Date.now()}`,
          txn_date: effectiveDate,
          doc_number: resolvedRecDocNumber,
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
        await recalculateEntityAndInvoiceBalances(supabase, realmId, createdTxn)
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

        const signedBalance = fromNaturalBalance(
          { account_type, classification: derivedClass },
          Number(current_balance || 0)
        )

        const { data, error } = await supabase
          .from('external_accounting_accounts')
          .update({
            name,
            fully_qualified_name: fqn,
            acct_num: acct_num || null,
            classification: derivedClass,
            account_type,
            account_sub_type: account_sub_type || account_type,
            current_balance: signedBalance,
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
        const signedBalance = fromNaturalBalance(
          { account_type, classification: derivedClass },
          Number(current_balance || 0)
        )

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
            current_balance: signedBalance,
            initial_qbo_balance: signedBalance,
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
          raw_data: markRawAsLocallyEdited(row.raw_data),
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
                raw_data: markRawAsLocallyEdited(txn.raw_data),
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

    // -------------------------------------------------------------------------
    // 14. OFFICIAL QBO STATEMENT INVOICE PDF & EMAIL DISPATCH (`generate_invoice_pdf` / `send_invoice_email`)
    // -------------------------------------------------------------------------
    if (action === 'generate_invoice_pdf' || action === 'send_invoice_email') {
      const txnId = body.id || body.txnId || body.transactionId
      if (!txnId) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: invoiceRow, error: invErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('id', txnId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (invErr || !invoiceRow) {
        return NextResponse.json({ error: 'Factura (Invoice) no encontrada en la empresa activa.' }, { status: 404 })
      }

      // Fetch company details + tenant contact + all tenant transactions for Account Summary
      const entityName = String(invoiceRow.entity_name || '').trim()
      const entityQbId = invoiceRow.entity_qb_id ? String(invoiceRow.entity_qb_id) : null

      const [compFullRes, contactsRes, rawTenantTxns] = await Promise.all([
        supabase
          .from('external_accounting_companies')
          .select('*')
          .eq('realm_id', realmId)
          .maybeSingle(),
        supabase
          .from('external_accounting_contacts')
          .select('*')
          .eq('company_realm_id', realmId),
        fetchEntityTransactions(supabase, realmId, entityQbId, entityName, [
          'Invoice',
          'Payment',
          'CreditMemo',
          'SalesReceipt',
        ]),
      ])

      const compFull = compFullRes.data || companyRecord
      const allContacts = contactsRes.data || []
      const matchedContact = allContacts.find((c: any) =>
        (entityQbId && String(c.qb_contact_id) === entityQbId) ||
        (entityName && String(c.display_name || '').trim().toLowerCase() === entityName.toLowerCase()) ||
        (entityName && String(c.company_name || '').trim().toLowerCase() === entityName.toLowerCase())
      )

      const tenantTxns = (rawTenantTxns || []).filter((t: any) => !t.is_voided)

      // Build company address lines
      const compAddr = compFull?.address && typeof compFull.address === 'object' ? compFull.address : {}
      const companyAddressLines: string[] = []
      if (compAddr.Line1) companyAddressLines.push(String(compAddr.Line1))
      if (compAddr.Line2) companyAddressLines.push(String(compAddr.Line2))
      const cityStateZip = [
        compAddr.City,
        [compAddr.CountrySubDivisionCode, compAddr.PostalCode, compAddr.Country].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ')
      if (cityStateZip) companyAddressLines.push(cityStateZip)

      // Build Bill To lines & greeting name
      const rawInv = invoiceRow.raw_data?.Invoice || invoiceRow.raw_data || {}
      const billAddr = rawInv?.BillAddr || matchedContact?.address || {}
      const contactFullName = [matchedContact?.given_name, matchedContact?.family_name].filter(Boolean).join(' ').trim()
      const contactGreetingName = contactFullName || billAddr.Line1 || matchedContact?.display_name || entityName || 'Valued Tenant'
      const customerDisplayName = matchedContact?.display_name || matchedContact?.company_name || entityName || 'Tenant'

      const billToLines: string[] = []
      if (billAddr.Line1 || billAddr.Line2 || billAddr.Line3) {
        if (billAddr.Line1) billToLines.push(String(billAddr.Line1))
        if (billAddr.Line2) billToLines.push(String(billAddr.Line2))
        if (billAddr.Line3) billToLines.push(String(billAddr.Line3))
        if (billAddr.Line4) billToLines.push(String(billAddr.Line4))
        const billCityLine = [
          billAddr.City,
          [billAddr.CountrySubDivisionCode, billAddr.PostalCode, billAddr.Country].filter(Boolean).join(' ')
        ].filter(Boolean).join(', ')
        if (billCityLine && !billToLines.some(l => l.includes(billAddr.City || '___'))) {
          billToLines.push(billCityLine)
        }
      } else {
        if (contactFullName && contactFullName.toLowerCase() !== customerDisplayName.toLowerCase()) {
          billToLines.push(contactFullName)
        }
        billToLines.push(customerDisplayName)
      }

      // Compute QBO Statement Account Summary
      const accountSummary = computeTenantAccountSummary(invoiceRow, tenantTxns, matchedContact)

      // Extract line items (Item name e.g. "Rent" + Description e.g. "Monthly Rent")
      const rawQboLines: any[] = Array.isArray(rawInv?.Line)
        ? rawInv.Line.filter((l: any) => l.DetailType !== 'SubTotalLineDetail')
        : []
      const dbLines: any[] = Array.isArray(invoiceRow.line_items) ? invoiceRow.line_items : []

      let parsedLineItems: QboInvoiceLineItem[] = []
      if (rawQboLines.length > 0) {
        parsedLineItems = rawQboLines.map((rl: any) => {
          const salesDetail = rl.SalesItemLineDetail || {}
          const itemRefName = salesDetail.ItemRef?.name || rl.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Rent'
          const amt = Number(rl.Amount || 0)
          const unitPrice = salesDetail.UnitPrice !== undefined ? Number(salesDetail.UnitPrice) : amt
          const qty = salesDetail.Qty !== undefined ? salesDetail.Qty : null
          return {
            itemName: String(itemRefName),
            description: rl.Description ? String(rl.Description) : '',
            qty,
            rate: unitPrice,
            amount: amt,
          }
        })
      } else if (dbLines.length > 0) {
        parsedLineItems = dbLines.map((dl: any) => {
          const amt = Number(dl.amount || 0)
          const itemTitle = dl.item_name || dl.account_name || invoiceRow.category_summary || 'Rent'
          const cleanItemTitle = String(itemTitle).includes(':') ? String(itemTitle).split(':').pop()!.trim() : String(itemTitle)
          const resolvedRate = dl.unit_price !== undefined && dl.unit_price !== null
            ? Number(dl.unit_price)
            : dl.rate !== undefined && dl.rate !== null
            ? Number(dl.rate)
            : amt
          return {
            itemName: cleanItemTitle,
            description: dl.description || invoiceRow.memo || 'Monthly Rent',
            qty: dl.qty || null,
            rate: resolvedRate,
            amount: amt,
          }
        })
      } else {
        const amt = Number(invoiceRow.total_amount || 0)
        parsedLineItems = [{
          itemName: 'Rent',
          description: invoiceRow.memo || 'Monthly Rent',
          qty: null,
          rate: amt,
          amount: amt,
        }]
      }

      const termsName = rawInv?.SalesTermRef?.name || body.terms || 'Due on receipt'
      const dueDateStr = invoiceRow.due_date || rawInv?.DueDate || invoiceRow.txn_date
      const defaultCustomerEmail = matchedContact?.email || rawInv?.BillEmail?.Address || ''

      const pdfInput: QboInvoicePdfInput = {
        companyName: compFull?.company_name || compFull?.legal_name || 'Gutierrez Financial',
        companyAddressLines,
        companyPhone: compFull?.phone || '',
        companyEmail: compFull?.email || 'raquel@tacosgavilan.com',
        invoiceNumber: String(invoiceRow.doc_number || invoiceRow.qb_txn_id || 'INV'),
        invoiceDate: String(invoiceRow.txn_date || ''),
        dueDate: String(dueDateStr || invoiceRow.txn_date || ''),
        terms: String(termsName),
        billToLines,
        contactGreetingName,
        customerDisplayName,
        customerEmail: defaultCustomerEmail,
        accountSummary,
        lineItems: parsedLineItems,
        totalNewCharges: Number(invoiceRow.total_amount || 0),
        balanceDue: accountSummary.totalAmountDue,
        memo: invoiceRow.memo || '',
      }

      if (action === 'generate_invoice_pdf') {
        const pdfBuffer = generateQboInvoicePdfBuffer(pdfInput)
        const safeCompanySlug = pdfInput.companyName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const safeInvSlug = String(pdfInput.invoiceNumber || 'INV').replace(/[^a-zA-Z0-9_-]+/g, '')
        const filename = `Invoice_${safeInvSlug}_from_${safeCompanySlug}.pdf`
        const emailPreviewHtml = generateQboInvoiceEmailHtml(pdfInput, body.customMessage)

        return NextResponse.json({
          ok: true,
          success: true,
          filename,
          fileName: filename,
          pdfBase64: pdfBuffer.toString('base64'),
          emailPreviewHtml,
          htmlPreview: emailPreviewHtml,
          pdfInput,
          defaultRecipient: defaultCustomerEmail,
          recipientEmail: defaultCustomerEmail,
          subject: `Invoice #${pdfInput.invoiceNumber} from ${pdfInput.companyName}`,
        })
      }

      // action === 'send_invoice_email'
      const recipientTo = String(body.to || body.toEmail || defaultCustomerEmail || '').trim()
      if (!recipientTo) {
        return NextResponse.json(
          { error: 'Ingresa al menos un correo electrónico destinatario para enviar la factura PDF.' },
          { status: 400 }
        )
      }

      const rawCc = String(body.cc || body.ccEmail || '').trim()
      const mailRes = await sendQboInvoiceEmail({
        pdfInput,
        toEmails: recipientTo.split(/[;,]/).map(s => s.trim()).filter(Boolean),
        ccEmails: rawCc ? rawCc.split(/[;,]/).map(s => s.trim()).filter(Boolean) : undefined,
        subject: body.subject ? String(body.subject).trim() : undefined,
        customMessage: body.customMessage ? String(body.customMessage).trim() : undefined,
      })

      if (!mailRes.success) {
        return NextResponse.json({ error: mailRes.error || 'Error enviando correo' }, { status: 500 })
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'SEND_INVOICE_EMAIL',
        entityType: 'Invoice',
        entityId: invoiceRow.id,
        docNumber: pdfInput.invoiceNumber,
        amount: pdfInput.balanceDue,
        summary: `Envió Factura PDF (${mailRes.filename}) por correo a ${mailRes.recipients.join(', ')} — Balance Due $${pdfInput.balanceDue.toFixed(2)}`,
        details: { recipients: mailRes.recipients, filename: mailRes.filename, messageId: mailRes.messageId }
      })

      return NextResponse.json({
        ok: true,
        success: true,
        messageId: mailRes.messageId,
        recipients: mailRes.recipients,
        sentTo: mailRes.recipients.join(', '),
        filename: mailRes.filename,
        fileName: mailRes.filename,
        pdfBase64: mailRes.pdfBase64,
        pdfInput,
      })
    }

    // -------------------------------------------------------------------------
    // 15. GENERATE OFFICIAL QBO CUSTOMER / TENANT STATEMENT PDF (`generate_statement_pdf`)
    // -------------------------------------------------------------------------
    if (action === 'generate_statement_pdf') {
      const contactId = body.contactId || body.id
      const entityName = String(body.entityName || body.display_name || '').trim()
      const entityQbId = body.qb_contact_id ? String(body.qb_contact_id) : null

      const [compFullRes, contactsRes] = await Promise.all([
        supabase
          .from('external_accounting_companies')
          .select('*')
          .eq('realm_id', realmId)
          .maybeSingle(),
        supabase
          .from('external_accounting_contacts')
          .select('*')
          .eq('company_realm_id', realmId),
      ])

      const compFull = compFullRes.data || companyRecord
      const allContacts = contactsRes.data || []
      const matchedContact = allContacts.find((c: any) =>
        (contactId && String(c.id) === String(contactId)) ||
        (entityQbId && String(c.qb_contact_id) === entityQbId) ||
        (entityName && String(c.display_name || '').trim().toLowerCase() === entityName.toLowerCase())
      )

      const targetQbId = matchedContact?.qb_contact_id ? String(matchedContact.qb_contact_id) : entityQbId
      const targetName = matchedContact?.display_name || entityName || 'Tenant'

      const rawTenantTxns = await fetchEntityTransactions(supabase, realmId, targetQbId, targetName, [
        'Invoice',
        'Payment',
        'CreditMemo',
      ])
      const tenantTxns = (rawTenantTxns || []).filter((t: any) => !t.is_voided)

      const compAddr = compFull?.address && typeof compFull.address === 'object' ? compFull.address : {}
      const companyAddressLines: string[] = []
      if (compAddr.Line1) companyAddressLines.push(String(compAddr.Line1))
      if (compAddr.Line2) companyAddressLines.push(String(compAddr.Line2))
      const cityStateZip = [
        compAddr.City,
        [compAddr.CountrySubDivisionCode, compAddr.PostalCode, compAddr.Country].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ')
      if (cityStateZip) companyAddressLines.push(cityStateZip)

      const billAddr = matchedContact?.address || {}
      const billToLines: string[] = [targetName]
      if (billAddr.Line1) billToLines.push(String(billAddr.Line1))
      const billCityLine = [
        billAddr.City,
        [billAddr.CountrySubDivisionCode, billAddr.PostalCode, billAddr.Country].filter(Boolean).join(' ')
      ].filter(Boolean).join(', ')
      if (billCityLine) billToLines.push(billCityLine)

      const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
      const todayMs = new Date(`${todayIso}T12:00:00Z`).getTime()
      const aging = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 }
      let totalBalanceDue = 0

      for (const t of tenantTxns) {
        if (t.txn_type === 'Invoice') {
          const openAmt = Number(t.open_balance ?? t.raw_data?.Balance ?? t.total_amount ?? 0)
          if (openAmt > 0) {
            totalBalanceDue = Number((totalBalanceDue + openAmt).toFixed(2))
            const dueStr = String(t.due_date || t.txn_date || todayIso).slice(0, 10)
            const diffDays = Math.floor((todayMs - new Date(`${dueStr}T12:00:00Z`).getTime()) / 86400000)
            if (diffDays <= 0) aging.current = Number((aging.current + openAmt).toFixed(2))
            else if (diffDays <= 30) aging.days1_30 = Number((aging.days1_30 + openAmt).toFixed(2))
            else if (diffDays <= 60) aging.days31_60 = Number((aging.days31_60 + openAmt).toFixed(2))
            else if (diffDays <= 90) aging.days61_90 = Number((aging.days61_90 + openAmt).toFixed(2))
            else aging.over90 = Number((aging.over90 + openAmt).toFixed(2))
          }
        }
      }

      const pdfBuffer = generateQboStatementPdfBuffer({
        companyName: compFull?.company_name || compFull?.legal_name || 'Gutierrez Financial',
        companyAddressLines,
        companyPhone: compFull?.phone || '',
        companyEmail: compFull?.email || 'raquel@tacosgavilan.com',
        statementDate: todayIso,
        customerDisplayName: targetName,
        billToLines,
        totalBalanceDue,
        transactions: tenantTxns,
        aging,
      })

      const safeTenantSlug = targetName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      const filename = `Statement_${safeTenantSlug}_${todayIso}.pdf`

      return NextResponse.json({
        ok: true,
        success: true,
        filename,
        pdfBase64: pdfBuffer.toString('base64'),
        totalBalanceDue,
        aging,
      })
    }

    // -------------------------------------------------------------------------
    // 16. SAVE CONTACT NOTE (`save_contact_note`)
    // -------------------------------------------------------------------------
    if (action === 'save_contact_note') {
      const contactId = body.contactId || body.id
      const noteText = String(body.note ?? body.notes ?? '').trim()
      if (!contactId) {
        return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
      }

      const { data: existingCon, error: findErr } = await supabase
        .from('external_accounting_contacts')
        .select('*')
        .eq('id', contactId)
        .eq('company_realm_id', realmId)
        .maybeSingle()

      if (findErr || !existingCon) {
        return NextResponse.json({ error: 'Contacto no encontrado en la empresa activa.' }, { status: 404 })
      }

      const rawObj = existingCon.raw_data && typeof existingCon.raw_data === 'object' ? existingCon.raw_data : {}
      const existingNotesList: any[] = Array.isArray(rawObj.notes_history) ? rawObj.notes_history : []
      const newEntry = {
        id: `NOTE-${Date.now()}`,
        text: noteText,
        author: auth.user.name || auth.user.email,
        created_at: new Date().toISOString(),
      }
      const nextRaw = {
        ...rawObj,
        Notes: noteText,
        notes_history: noteText ? [newEntry, ...existingNotesList.slice(0, 49)] : existingNotesList,
      }

      const { data: updatedCon, error: updErr } = await supabase
        .from('external_accounting_contacts')
        .update({ raw_data: nextRaw, updated_at: new Date().toISOString() })
        .eq('id', contactId)
        .eq('company_realm_id', realmId)
        .select()
        .single()

      if (updErr) throw updErr
      return NextResponse.json({ ok: true, success: true, contact: updatedCon })
    }

    // -------------------------------------------------------------------------
    // 17. WRITE OFF INVOICES (My menu -> Accountant Tools -> Write off invoices / /app/writeoffinvoices)
    // -------------------------------------------------------------------------
    if (action === 'write_off_invoices') {
      const invoiceIds: string[] = Array.isArray(body.invoiceIds)
        ? Array.from(new Set(body.invoiceIds.map(String).filter(Boolean)))
        : []
      if (invoiceIds.length === 0) {
        return NextResponse.json({ error: 'Selecciona al menos una factura (Invoice) con saldo pendiente para condonar (Write Off).' }, { status: 400 })
      }

      const writeOffDate = String(body.writeOffDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })).slice(0, 10)
      if (companyClosingDate && writeOffDate <= companyClosingDate && !body.overrideClosingDate) {
        return NextResponse.json(
          { error: `No se pueden condonar facturas en una fecha dentro de un periodo cerrado (${writeOffDate} ≤ ${companyClosingDate}).` },
          { status: 400 }
        )
      }

      const requestedAccQbId = body.writeOffAccountQbId ? String(body.writeOffAccountQbId) : null
      const writeOffAcc =
        (requestedAccQbId && acctByQbId.get(requestedAccQbId)) ||
        (companyAccounts || []).find(a =>
          a.is_active &&
          (String(a.name || '').toLowerCase().includes('bad debt') ||
            String(a.name || '').toLowerCase().includes('write') ||
            String(a.name || '').toLowerCase().includes('discount') ||
            a.account_type === 'Expense' ||
            a.account_type === 'Income')
        )
      if (!writeOffAcc) {
        return NextResponse.json({ error: 'Selecciona una cuenta contable válida para aplicar el Write-Off.' }, { status: 400 })
      }

      const arDefaultAcc = (companyAccounts || []).find(a => a.account_type === 'Accounts Receivable' && a.is_active)

      const { data: openInvoices, error: loadInvErr } = await supabase
        .from('external_accounting_transactions')
        .select('*')
        .eq('company_realm_id', realmId)
        .eq('txn_type', 'Invoice')
        .in('id', invoiceIds)

      if (loadInvErr) throw loadInvErr

      let mergedDeltas = new Map<string, number>()
      const createdCreditMemos: any[] = []
      let totalWrittenOff = 0

      for (const inv of openInvoices || []) {
        if (inv.is_voided) continue
        const remBal = Number(inv.open_balance ?? inv.raw_data?.Balance ?? inv.total_amount ?? 0)
        if (remBal <= 0.009) continue

        const cmDocNumber = `WO-${inv.doc_number || inv.qb_txn_id || Date.now()}`
        const cmMemo = body.memo || `Write-off of Invoice #${inv.doc_number || inv.qb_txn_id} (${writeOffDate})`

        const { data: createdCm, error: cmErr } = await supabase
          .from('external_accounting_transactions')
          .insert({
            company_realm_id: realmId,
            txn_type: 'CreditMemo',
            qb_entity_type: 'CreditMemo',
            qb_txn_id: `LOCAL-WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            txn_date: writeOffDate,
            doc_number: cmDocNumber,
            payment_type: 'CreditMemo',
            direction: 'ACCRUAL',
            account_qb_id: arDefaultAcc?.qb_account_id || inv.account_qb_id || null,
            account_name: arDefaultAcc?.name || inv.account_name || 'Accounts Receivable (A/R)',
            to_account_qb_id: writeOffAcc.qb_account_id,
            to_account_name: writeOffAcc.name,
            entity_qb_id: inv.entity_qb_id || null,
            entity_name: inv.entity_name || null,
            entity_type: 'Customer',
            total_amount: Number(remBal.toFixed(2)),
            open_balance: 0,
            memo: cmMemo,
            category_summary: writeOffAcc.name,
            print_status: 'NotSet',
            cleared_status: 'Cleared',
            is_voided: false,
            custom_fields: { linked_invoice_ids: [inv.id], write_off: true },
            line_items: [{
              id: '1',
              line_num: 1,
              description: cmMemo,
              amount: Number(remBal.toFixed(2)),
              account_qb_id: writeOffAcc.qb_account_id,
              account_name: writeOffAcc.name,
              linked_txn_id: inv.qb_txn_id,
              linked_txn_uuid: inv.id,
              linked_txn_doc_number: inv.doc_number,
              linked_txn_type: 'Invoice',
            }],
            created_by: auth.user.name || auth.user.email,
          })
          .select()
          .single()

        if (!cmErr && createdCm) {
          createdCreditMemos.push(createdCm)
          totalWrittenOff = Number((totalWrittenOff + remBal).toFixed(2))
          const d = computeTransactionAccountDeltas(acctByQbId, createdCm, 1, ledgerCtx)
          mergedDeltas = mergeAccountDeltas(mergedDeltas, d)
          const nextInvRaw = { ...(inv.raw_data && typeof inv.raw_data === 'object' ? inv.raw_data : {}), Balance: 0 }
          await supabase
            .from('external_accounting_transactions')
            .update({ open_balance: 0, raw_data: nextInvRaw })
            .eq('id', inv.id)
            .eq('company_realm_id', realmId)
          await recalculateEntityAndInvoiceBalances(supabase, realmId, createdCm, { linkedInvoiceIds: [inv.id] })
        }
      }

      if (mergedDeltas.size > 0) {
        await applyAccountDeltasAtomically(supabase, realmId, mergedDeltas)
      }

      await logExternalAccountingAudit(supabase, {
        realmId,
        user: auth.user,
        actionType: 'WRITE_OFF_INVOICES',
        entityType: 'WriteOffInvoices',
        amount: totalWrittenOff,
        summary: `Condonó (Write Off) ${createdCreditMemos.length} facturas hacia "${writeOffAcc.name}" por un total de $${totalWrittenOff.toFixed(2)}`,
        details: { count: createdCreditMemos.length, totalWrittenOff, writeOffAccount: writeOffAcc.name }
      })

      return NextResponse.json({
        ok: true,
        success: true,
        writtenOffCount: createdCreditMemos.length,
        totalWrittenOff,
        creditMemos: createdCreditMemos,
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[POST /api/external-accounting] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
