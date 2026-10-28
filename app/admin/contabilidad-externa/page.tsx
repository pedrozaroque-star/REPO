/**
 * @module app/admin/contabilidad-externa/page
 * @description Módulo de CONTABILIDAD EXTERNA exclusivo para Raquel Velazquez, Roberto Velazquez y Roque.
 * Reemplaza al 100% la suscripción de Intuit QuickBooks Online (Accountant Suite) para las 8 razones sociales:
 * - 7947 Downey Plaza LLC (123145858055022)
 * - Chicken Taco Catering LLC (193514304333307)
 * - Gutierrez Financial (554651555)
 * - Raquel Accounting (123145825185692)
 * - Canasty Financial, LLC (193514841181564)
 * - Elveze LLC (9130355308251406)
 * - Govegu LLC (9130357603135416)
 * - TEG Holdings Inc (9130357696871496)
 *
 * @businessRules
 * - Acceso estrictamente restringido a las cuentas de Raquel (`raquel@tacosgavilan.com`, id: 45),
 *   Roberto (`roberto@tacosgavilan.com`, id: 46) y Roque (`roque@tacosgavilan.com`, id: 47).
 * - Permite crear, editar, imprimir, anular (VOID) y eliminar Cheques, Depósitos Bancarios, Salidas/Gastos,
 *   Transferencias entre Cuentas y Pólizas de Diario (Journal Entries) actualizando en vivo los saldos bancarios.
 * - Incluye ejecución en 1 clic de Transacciones Recurrentes (/app/recurring) y generador de 10 Reportes Avanzados
 *   para la Contadora (CPA) con exportación a Excel/CSV y vista de impresión PDF.
 *
 * @dataFlow
 * UI (/admin/contabilidad-externa) -> /api/external-accounting & /api/external-accounting/reports -> Supabase
 *
 * @notes
 * - 100% bilingüe (ES/EN) vía `useLanguage()` de `lib/i18n.tsx`.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
    Building2, DollarSign, ArrowUpRight, ArrowDownRight, Plus, Printer, Download,
    Search, RefreshCw, CheckCircle2, XCircle, FileText, Repeat, Landmark, Users,
    BarChart3, Edit3, Trash2, Ban, ArrowLeftRight, BookOpen, ShieldAlert, ChevronRight, Calendar,
    Settings, Scale, ListChecks, Layers, History, Sparkles, Calculator, Lock, Package, CheckSquare
} from 'lucide-react'

const ALLOWED_EMAILS = [
    'raquel@tacosgavilan.com',
    'roberto@tacosgavilan.com',
    'roque@tacosgavilan.com',
    'rvelasquez95@yahoo.com',
]
const ALLOWED_USER_IDS = [45, 46, 47]

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    const headers = new Headers(options.headers || {})
    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, {
        ...options,
        headers,
        credentials: 'include',
    })
}

function escapeHtml(str: any): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function openCleanPrintWindow(title: string, bodyHtml: string, landscape = false): boolean {
    if (typeof window === 'undefined') return false

    const safeTitle = escapeHtml(title)
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page {
    size: letter ${landscape ? 'landscape' : 'portrait'};
    margin: 0.4in;
  }
  @media print {
    .no-print {
      display: none !important;
    }
    body {
      padding: 0 !important;
    }
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body {
    margin: 0;
    padding: 18px 24px;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    background: #ffffff;
    font-size: 11px;
    line-height: 1.4;
  }
  .no-print {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    margin-bottom: 18px;
    background: #0f172a;
    color: #ffffff;
    border-radius: 10px;
  }
  .no-print-title {
    font-size: 12px;
    font-weight: 700;
    color: #e2e8f0;
  }
  .no-print-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn-print-pdf {
    background: #059669;
    color: #ffffff;
    border: none;
    padding: 7px 14px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .btn-close-win {
    background: #334155;
    color: #ffffff;
    border: none;
    padding: 7px 12px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .doc-header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 10px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .doc-company {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #0f172a;
    text-transform: uppercase;
  }
  .doc-title {
    font-size: 13px;
    font-weight: 700;
    color: #047857;
    margin-top: 2px;
  }
  .doc-meta {
    text-align: right;
    font-size: 10px;
    color: #475569;
  }
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .kpi-box {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 7px 10px;
    background: #f8fafc;
  }
  .kpi-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
  }
  .kpi-val {
    font-size: 13px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    margin-top: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th {
    background: #f1f5f9;
    color: #1e293b;
    font-weight: 800;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.04em;
    padding: 6px 6px;
    border-top: 1px solid #94a3b8;
    border-bottom: 1px solid #94a3b8;
    text-align: left;
  }
  td {
    padding: 5px 6px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  tr.summary-row td {
    background: #f1f5f9;
    font-weight: 800;
    border-top: 1.5px solid #0f172a;
    border-bottom: 2px double #0f172a;
  }
  tr.section-row td {
    background: #f8fafc;
    font-weight: 800;
    color: #0f172a;
    text-transform: uppercase;
    padding-top: 8px;
  }
  .mono {
    font-family: 'Courier New', Courier, monospace;
  }
  .right {
    text-align: right;
  }
  .center {
    text-align: center;
  }
  .voided {
    text-decoration: line-through;
    color: #94a3b8;
  }
</style>
</head>
<body>
<div class="no-print">
  <div class="no-print-title">${safeTitle}</div>
  <div class="no-print-actions">
    <button type="button" class="btn-print-pdf" onclick="window.focus(); window.print();">🖨️ Imprimir / Guardar como PDF</button>
    <button type="button" class="btn-close-win" onclick="window.close();">✕ Cerrar</button>
  </div>
</div>
${bodyHtml}
<script>
  setTimeout(function() {
    try {
      window.focus();
      window.print();
    } catch (e) {}
  }, 250);
</script>
</body>
</html>`

    // IMPORTANT: Never include 'noopener' or 'noreferrer' here because HTML5 spec forces window.open() to return null!
    const printWin = window.open('', '_blank', 'width=1060,height=840')
    if (printWin && printWin.document) {
        printWin.document.open()
        printWin.document.write(html)
        printWin.document.close()
        return true
    }

    // Fallback: In-page hidden iframe print (works even if popup blocker is active on desktop or mobile)
    try {
        const existing = document.getElementById('teg-accounting-print-iframe') as HTMLIFrameElement | null
        if (existing) existing.remove()
        const iframe = document.createElement('iframe')
        iframe.id = 'teg-accounting-print-iframe'
        iframe.style.position = 'fixed'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = '0'
        document.body.appendChild(iframe)
        const doc = iframe.contentWindow?.document
        if (!doc) return false
        doc.open()
        doc.write(html)
        doc.close()
        setTimeout(() => {
            iframe.contentWindow?.focus()
            iframe.contentWindow?.print()
        }, 250)
        return true
    } catch {
        return false
    }
}

function formatCurrency(val: number | string | null | undefined): string {
    const n = Number(val || 0)
    if (!Number.isFinite(n)) return '$0.00'
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return n < 0 ? `-$${abs}` : `$${abs}`
}

function numberToEnglishWords(amount: number): string {
    if (!Number.isFinite(amount) || amount < 0) return 'ZERO AND 00/100'
    const whole = Math.floor(amount)
    const cents = Math.round((amount - whole) * 100)
    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']

    const convertChunk = (n: number): string => {
        if (n === 0) return ''
        if (n < 20) return ones[n]
        if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? '-' + ones[n % 10] : ''}`
        return `${ones[Math.floor(n / 100)]} HUNDRED${n % 100 ? ' ' + convertChunk(n % 100) : ''}`
    }

    if (whole === 0) return `ZERO AND ${String(cents).padStart(2, '0')}/100`
    let rem = whole
    const parts: string[] = []
    if (rem >= 1000000) {
        parts.push(`${convertChunk(Math.floor(rem / 1000000))} MILLION`)
        rem %= 1000000
    }
    if (rem >= 1000) {
        parts.push(`${convertChunk(Math.floor(rem / 1000))} THOUSAND`)
        rem %= 1000
    }
    if (rem > 0) {
        parts.push(convertChunk(rem))
    }
    return `${parts.join(' ')} AND ${String(cents).padStart(2, '0')}/100`
}

type ActiveTab =
    | 'overview'
    | 'transactions'
    | 'checks_deposits'
    | 'reconcile'
    | 'reclassify'
    | 'rules'
    | 'budgeting'
    | 'lists'
    | 'audit_log'
    | 'company_settings'
    | 'recurring'
    | 'accounts'
    | 'contacts'
    | 'reports'

type ModalMode =
    | 'Check'
    | 'Deposit'
    | 'Expense'
    | 'Invoice'
    | 'Payment'
    | 'Bill'
    | 'BillPayment'
    | 'Transfer'
    | 'JournalEntry'
    | 'SalesReceipt'
    | 'CreditMemo'
    | 'RefundReceipt'
    | 'Estimate'
    | 'VendorCredit'
    | 'CreditCardCredit'
    | 'PurchaseOrder'
    | 'PayDownCreditCard'
    | null

interface LineItemDraft {
    account_qb_id: string
    account_name: string
    description: string
    amount: string
    posting_type?: 'Debit' | 'Credit'
    entity_name?: string
    payment_method?: string
    check_num?: string
    item_id?: string
    item_name?: string
    qty?: string
    rate?: string
}

function ExternalAccountingContent() {
    const { user } = useAuth()
    const { t } = useLanguage()

    const isAuthorized = useMemo(() => {
        if (!user) return false
        const emailNorm = (user.email || '').trim().toLowerCase()
        return ALLOWED_EMAILS.includes(emailNorm) || ALLOWED_USER_IDS.includes(Number(user.id))
    }, [user])

    const [activeRealmId, setActiveRealmId] = useState<string>('123145858055022')
    const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
    const [loading, setLoading] = useState<boolean>(true)
    const [saving, setSaving] = useState<boolean>(false)
    const [toastMsg, setToastMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

    // Top QBO Mega-Menus (+ Create & Gear Icon ⚙️)
    const [createMenuOpen, setCreateMenuOpen] = useState<boolean>(false)
    const [gearMenuOpen, setGearMenuOpen] = useState<boolean>(false)
    const [showCompanyGrid, setShowCompanyGrid] = useState<boolean>(true)

    // Data state
    const [companies, setCompanies] = useState<any[]>([])
    const [accounts, setAccounts] = useState<any[]>([])
    const [contacts, setContacts] = useState<any[]>([])
    const [recurring, setRecurring] = useState<any[]>([])
    const [transactions, setTransactions] = useState<any[]>([])
    const [totalTransactionsCount, setTotalTransactionsCount] = useState<number>(0)
    const [pagination, setPagination] = useState<{
        page: number
        pageSize: number
        totalFiltered: number
        totalPages: number
        hasNextPage: boolean
        hasPrevPage: boolean
    }>({ page: 1, pageSize: 100, totalFiltered: 0, totalPages: 1, hasNextPage: false, hasPrevPage: false })
    const [checkbookTransactions, setCheckbookTransactions] = useState<any[]>([])
    const [depositsTransactions, setDepositsTransactions] = useState<any[]>([])
    const [checkbookPagination, setCheckbookPagination] = useState<{
        page: number
        pageSize: number
        totalFiltered: number
        totalPages: number
        hasNextPage: boolean
        hasPrevPage: boolean
    }>({ page: 1, pageSize: 100, totalFiltered: 0, totalPages: 1, hasNextPage: false, hasPrevPage: false })
    const [nextCheckNumberByBank, setNextCheckNumberByBank] = useState<Record<string, string>>({})
    const [summary, setSummary] = useState<any>({})

    // Gear Menu (⚙️) Data States
    const [reconciliations, setReconciliations] = useState<any[]>([])
    const [reconcileTransactions, setReconcileTransactions] = useState<any[]>([])
    const [auditLog, setAuditLog] = useState<any[]>([])
    const [bankRules, setBankRules] = useState<any[]>([])
    const [budgets, setBudgets] = useState<any[]>([])
    const [actualsByAccountAndYear, setActualsByAccountAndYear] = useState<Record<string, Record<string, number>>>({})
    const [companyLists, setCompanyLists] = useState<{
        items: any[]
        categories: any[]
        departments: any[]
        classes: any[]
        paymentMethods: any[]
        terms: any[]
        customFields: any[]
        attachments: any[]
        costGroups: any[]
        closingDate: string | null
        accountingMethod: string
        fiscalYearStartMonth: string
        taxId: string
    }>({
        items: [],
        categories: [],
        departments: [],
        classes: [],
        paymentMethods: [],
        terms: [],
        customFields: [],
        attachments: [],
        costGroups: [],
        closingDate: null,
        accountingMethod: 'Accrual',
        fiscalYearStartMonth: '01',
        taxId: '',
    })

    // Bank Reconciliation State (Gear ⚙️ -> Tools -> Reconcile)
    const [reconcileAccountId, setReconcileAccountId] = useState<string>('')
    const [editingReconciliationId, setEditingReconciliationId] = useState<string | null>(null)
    const [recEndingDate, setRecEndingDate] = useState<string>(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    const [recBeginningBalance, setRecBeginningBalance] = useState<string>('0.00')
    const [recEndingBalance, setRecEndingBalance] = useState<string>('0.00')
    const [recServiceCharge, setRecServiceCharge] = useState<string>('0')
    const [recServiceChargeAccId, setRecServiceChargeAccId] = useState<string>('')
    const [recInterestEarned, setRecInterestEarned] = useState<string>('0')
    const [recInterestAccId, setRecInterestAccId] = useState<string>('')
    const [recNotes, setRecNotes] = useState<string>('')
    const [recSelectedIds, setRecSelectedIds] = useState<string[]>([])
    const [recFilterSide, setRecFilterSide] = useState<'ALL' | 'PAYMENTS' | 'DEPOSITS'>('ALL')
    const [recUpToEndDateOnly, setRecUpToEndDateOnly] = useState<boolean>(false)
    const [recSearch, setRecSearch] = useState<string>('')

    // Batch Reclassify State (Gear ⚙️ -> Tools -> Reclassify Transactions)
    const [reclassifySelectedIds, setReclassifySelectedIds] = useState<string[]>([])
    const [reclassifyTargetAccId, setReclassifyTargetAccId] = useState<string>('')
    const [reclassifyTargetEntity, setReclassifyTargetEntity] = useState<string>('')
    const [reclassifyTargetDept, setReclassifyTargetDept] = useState<string>('')

    // Bank Rules Modal State (Gear ⚙️ -> Lists -> Rules)
    const [ruleModalOpen, setRuleModalOpen] = useState<boolean>(false)
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
    const [ruleFormName, setRuleFormName] = useState<string>('')
    const [ruleFormDirection, setRuleFormDirection] = useState<'OUT' | 'IN' | 'ALL'>('OUT')
    const [ruleFormMatchField, setRuleFormMatchField] = useState<'ANY' | 'ENTITY' | 'MEMO' | 'DOC_NUMBER'>('ANY')
    const [ruleFormMatchText, setRuleFormMatchText] = useState<string>('')
    const [ruleFormTargetAccId, setRuleFormTargetAccId] = useState<string>('')
    const [ruleFormTargetEntity, setRuleFormTargetEntity] = useState<string>('')
    const [ruleFormPriority, setRuleFormPriority] = useState<string>('100')

    // Budgeting State (Gear ⚙️ -> Tools -> Budgeting)
    const [budgetYear, setBudgetYear] = useState<number>(2026)
    const [budgetModalOpen, setBudgetModalOpen] = useState<boolean>(false)
    const [budgetAccountQbId, setBudgetAccountQbId] = useState<string>('')
    const [budgetAnnualAmount, setBudgetAnnualAmount] = useState<string>('0')
    const [budgetNotes, setBudgetNotes] = useState<string>('')

    // Lists & Products/Services State (Gear ⚙️ -> All Lists /app/lists)
    type ListTabKey =
        | 'items'
        | 'categories'
        | 'departments'
        | 'classes'
        | 'paymentMethods'
        | 'terms'
        | 'customFields'
        | 'attachments'
        | 'costGroups'
    const [activeListKey, setActiveListKey] = useState<ListTabKey>('items')
    const [listItemModalOpen, setListItemModalOpen] = useState<boolean>(false)
    const [editingListItemId, setEditingListItemId] = useState<string | null>(null)
    const [listItemName, setListItemName] = useState<string>('')
    const [listItemSku, setListItemSku] = useState<string>('')
    const [listItemDesc, setListItemDesc] = useState<string>('')
    const [listItemPrice, setListItemPrice] = useState<string>('0')
    const [listItemPurchaseCost, setListItemPurchaseCost] = useState<string>('0')
    const [listItemType, setListItemType] = useState<string>('Service')
    const [listItemPaymentType, setListItemPaymentType] = useState<string>('NON_CREDIT_CARD')
    const [listItemCategoryId, setListItemCategoryId] = useState<string>('')
    const [listItemAccountId, setListItemAccountId] = useState<string>('')
    const [listItemExpenseAccountId, setListItemExpenseAccountId] = useState<string>('')
    const [listItemClassCode, setListItemClassCode] = useState<string>('')
    const [listItemParentId, setListItemParentId] = useState<string>('')
    const [listItemDueDays, setListItemDueDays] = useState<string>('30')
    const [listItemDiscountPct, setListItemDiscountPct] = useState<string>('0')

    // Company Settings State (Gear ⚙️ -> Settings -> Company Settings)
    const [compSetName, setCompSetName] = useState<string>('')
    const [compSetLegalName, setCompSetLegalName] = useState<string>('')
    const [compSetTaxId, setCompSetTaxId] = useState<string>('')
    const [compSetEmail, setCompSetEmail] = useState<string>('')
    const [compSetPhone, setCompSetPhone] = useState<string>('')
    const [compSetStreet, setCompSetStreet] = useState<string>('')
    const [compSetCity, setCompSetCity] = useState<string>('')
    const [compSetState, setCompSetState] = useState<string>('CA')
    const [compSetZip, setCompSetZip] = useState<string>('')
    const [compSetMethod, setCompSetMethod] = useState<string>('Accrual')
    const [compSetFyMonth, setCompSetFyMonth] = useState<string>('01')
    const [compSetClosingDate, setCompSetClosingDate] = useState<string>('')

    // Audit Log Search
    const [auditSearch, setAuditSearch] = useState<string>('')

    // Batch Transactions Modal (+ Create -> Other -> Batch Transactions)
    const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false)
    const [batchRows, setBatchRows] = useState<Array<{
        txn_date: string
        txn_type: string
        doc_number: string
        account_qb_id: string
        gl_account_qb_id: string
        entity_name: string
        memo: string
        amount: string
    }>>([])

    // Print Checks Queue Modal (+ Create -> Vendors -> Print Checks)
    const [printChecksModalOpen, setPrintChecksModalOpen] = useState<boolean>(false)
    const [selectedCheckIdsToPrint, setSelectedCheckIdsToPrint] = useState<string[]>([])
    const [startingPrintCheckNum, setStartingPrintCheckNum] = useState<string>('1001')

    // Filters for Transactions & Ledger
    const [filterType, setFilterType] = useState<string>('ALL')
    const [filterDirection, setFilterDirection] = useState<string>('ALL')
    const [filterAccountId, setFilterAccountId] = useState<string>('ALL')
    const [filterPeriod, setFilterPeriod] = useState<string>('ALL')
    const [startDate, setStartDate] = useState<string>('')
    const [endDate, setEndDate] = useState<string>('')
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [page, setPage] = useState<number>(1)
    const [pageSize, setPageSize] = useState<number>(100)
    const [checkbookPage, setCheckbookPage] = useState<number>(1)

    // Sub-filters for Accounts & Contacts tabs
    const [accountSearch, setAccountSearch] = useState<string>('')
    const [contactSearch, setContactSearch] = useState<string>('')

    // QBO Official Bank Register: Two-Line View toggle & Inline Quick-Add Row state
    const [registerTwoLineView, setRegisterTwoLineView] = useState<boolean>(true)
    const [inlineRegType, setInlineRegType] = useState<'Check' | 'Deposit' | 'Expense'>('Check')
    const [inlineRegDate, setInlineRegDate] = useState<string>(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    const [inlineRegDocNum, setInlineRegDocNum] = useState<string>('')
    const [inlineRegPayee, setInlineRegPayee] = useState<string>('')
    const [inlineRegBankId, setInlineRegBankId] = useState<string>('')
    const [inlineRegGlId, setInlineRegGlId] = useState<string>('')
    const [inlineRegMemo, setInlineRegMemo] = useState<string>('')
    const [inlineRegAmount, setInlineRegAmount] = useState<string>('')

    // Transaction Modal State
    const [modalMode, setModalMode] = useState<ModalMode>(null)
    const [editingTxnId, setEditingTxnId] = useState<number | null>(null)
    const [formDate, setFormDate] = useState<string>(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    const [formDueDate, setFormDueDate] = useState<string>(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    const [formTerms, setFormTerms] = useState<string>('Due on receipt')
    const [formAddress, setFormAddress] = useState<string>('')
    const [formCustomerEmail, setFormCustomerEmail] = useState<string>('')
    const [formDocNumber, setFormDocNumber] = useState<string>('')
    const [formBankQbId, setFormBankQbId] = useState<string>('')
    const [formToAccountQbId, setFormToAccountQbId] = useState<string>('')
    const [formPayeeName, setFormPayeeName] = useState<string>('')
    const [formPaymentMethod, setFormPaymentMethod] = useState<string>('Check')
    const [formDepartmentQbId, setFormDepartmentQbId] = useState<string>('')
    const [formClassQbId, setFormClassQbId] = useState<string>('')
    const [formMemo, setFormMemo] = useState<string>('')
    const [formPrintLater, setFormPrintLater] = useState<boolean>(false)
    const [formAmount, setFormAmount] = useState<string>('')
    const [formLines, setFormLines] = useState<LineItemDraft[]>([
        { account_qb_id: '', account_name: '', description: '', amount: '', posting_type: 'Debit' }
    ])

    // Drill-Down Transaction Detail Report Modal (Profit & Loss / Balance Sheet / Chart of Accounts QuickReport)
    const [drilldownReportModal, setDrilldownReportModal] = useState<{
        title: string
        subtitle: string
        basis?: string
        periodLabel?: string
        sectionType?: string
        totalBeginningBalance?: number
        totalAmount: number
        totalEndingBalance?: number
        groups?: Array<{
            account_id: string
            account_name: string
            account_type?: string
            is_balance_sheet?: boolean
            beginning_balance: number
            period_net_change: number
            ending_balance: number
            transactions: any[]
        }>
        rows: any[]
        loading?: boolean
        accountObj?: any
    } | null>(null)
    const [drilldownSearch, setDrilldownSearch] = useState<string>('')
    const [collapsedDrilldownGroups, setCollapsedDrilldownGroups] = useState<Record<string, boolean>>({})

    // Universal Record Preview Modal & 3-Step Security Delete Wizard
    type PreviewRecordKind =
        | 'transaction'
        | 'account'
        | 'contact'
        | 'recurring'
        | 'reconciliation'
        | 'list_item'
        | 'bank_rule'
        | 'budget'

    const [previewRecord, setPreviewRecord] = useState<{ kind: PreviewRecordKind; data: any } | null>(null)
    const [deleteWizardTarget, setDeleteWizardTarget] = useState<{
        kind: PreviewRecordKind
        data: any
        step: 1 | 2 | 3
        checkLedger: boolean
        checkQbo: boolean
    } | null>(null)

    const openRecordPreview = (kind: PreviewRecordKind, data: any) => {
        if (!data) return
        setPreviewRecord({ kind, data })
    }

    const openDeleteWizard = (kind: PreviewRecordKind, data: any) => {
        if (!data) return
        setDeleteWizardTarget({
            kind,
            data,
            step: 1,
            checkLedger: false,
            checkQbo: false,
        })
    }

    // Legacy alias so any existing check preview call opens the universal preview modal
    const setPrintableCheckTxn = (txn: any | null) => {
        if (txn) setPreviewRecord({ kind: 'transaction', data: txn })
        else setPreviewRecord(null)
    }

    // Account & Contact Modals
    const [accountModalOpen, setAccountModalOpen] = useState<boolean>(false)
    const [editingAccount, setEditingAccount] = useState<any | null>(null)
    const [accFormName, setAccFormName] = useState<string>('')
    const [accFormNum, setAccFormNum] = useState<string>('')
    const [accFormType, setAccFormType] = useState<string>('Bank')
    const [accFormSubType, setAccFormSubType] = useState<string>('')
    const [accFormClass, setAccFormClass] = useState<string>('Asset')
    const [accFormDesc, setAccFormDesc] = useState<string>('')
    const [accFormIsSub, setAccFormIsSub] = useState<boolean>(false)
    const [accFormParentId, setAccFormParentId] = useState<string>('')
    const [accFormBalance, setAccFormBalance] = useState<string>('0')

    const [contactFilterType, setContactFilterType] = useState<'ALL' | 'Vendor' | 'Customer' | '1099'>('ALL')
    const [contactModalOpen, setContactModalOpen] = useState<boolean>(false)
    const [editingContact, setEditingContact] = useState<any | null>(null)
    const [conFormName, setConFormName] = useState<string>('')
    const [conFormCompany, setConFormCompany] = useState<string>('')
    const [conFormPrintOnCheck, setConFormPrintOnCheck] = useState<string>('')
    const [conFormAcctNum, setConFormAcctNum] = useState<string>('')
    const [conFormAddress, setConFormAddress] = useState<string>('')
    const [conFormBalance, setConFormBalance] = useState<string>('0')
    const [conFormType, setConFormType] = useState<string>('Vendor')
    const [conFormEmail, setConFormEmail] = useState<string>('')
    const [conFormPhone, setConFormPhone] = useState<string>('')
    const [conFormTaxId, setConFormTaxId] = useState<string>('')
    const [conForm1099, setConForm1099] = useState<boolean>(false)

    // Recurring Template Modal
    const [recurringModalOpen, setRecurringModalOpen] = useState<boolean>(false)
    const [editingRecurring, setEditingRecurring] = useState<any | null>(null)
    const [recFormName, setRecFormName] = useState<string>('')
    const [recFormRecurType, setRecFormRecurType] = useState<string>('Automated')
    const [recFormTxnType, setRecFormTxnType] = useState<string>('Check')
    const [recFormInterval, setRecFormInterval] = useState<string>('Monthly')
    const [recFormNumInterval, setRecFormNumInterval] = useState<string>('1')
    const [recFormNextDate, setRecFormNextDate] = useState<string>('')
    const [recFormAccountQbId, setRecFormAccountQbId] = useState<string>('')
    const [recFormGlAccountQbId, setRecFormGlAccountQbId] = useState<string>('')
    const [recFormEntityName, setRecFormEntityName] = useState<string>('')
    const [recFormMemo, setRecFormMemo] = useState<string>('')
    const [recFormAmount, setRecFormAmount] = useState<string>('0')

    // Reports State
    const [reportType, setReportType] = useState<string>('pnl')
    const [reportBasis, setReportBasis] = useState<'Accrual' | 'Cash'>('Accrual')
    const [reportQboKey, setReportQboKey] = useState<string>('ProfitAndLoss_ByYear_Accrual')
    const [reportLoading, setReportLoading] = useState<boolean>(false)
    const [reportData, setReportData] = useState<any | null>(null)

    const notify = (type: 'ok' | 'err', text: string) => {
        setToastMsg({ type, text })
        setTimeout(() => setToastMsg(null), 4000)
    }

    // Period helper
    const handlePeriodPreset = (preset: string) => {
        setFilterPeriod(preset)
        setPage(1)
        setCheckbookPage(1)
        const nowStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        const [yrNum, moNum] = nowStr.split('-').map(Number)
        const yr = yrNum || new Date().getFullYear()
        const moIdx = (moNum || (new Date().getMonth() + 1)) - 1
        const mo = String(moIdx + 1).padStart(2, '0')
        const lastDayOfMonth = new Date(yr, moIdx + 1, 0).getDate()

        if (preset === 'ALL') {
            setStartDate('')
            setEndDate('')
        } else if (preset === 'TODAY') {
            setStartDate(nowStr)
            setEndDate(nowStr)
        } else if (preset === 'THIS_MONTH') {
            setStartDate(`${yr}-${mo}-01`)
            setEndDate(`${yr}-${mo}-${String(lastDayOfMonth).padStart(2, '0')}`)
        } else if (preset === 'LAST_MONTH') {
            const prevDate = new Date(yr, moIdx - 1, 1)
            const pYr = prevDate.getFullYear()
            const pMo = String(prevDate.getMonth() + 1).padStart(2, '0')
            const pLast = String(new Date(pYr, prevDate.getMonth() + 1, 0).getDate()).padStart(2, '0')
            setStartDate(`${pYr}-${pMo}-01`)
            setEndDate(`${pYr}-${pMo}-${pLast}`)
        } else if (preset === 'THIS_QUARTER') {
            const qStartMo = Math.floor(moIdx / 3) * 3
            const qEndMo = qStartMo + 2
            const qEndDay = new Date(yr, qEndMo + 1, 0).getDate()
            setStartDate(`${yr}-${String(qStartMo + 1).padStart(2, '0')}-01`)
            setEndDate(`${yr}-${String(qEndMo + 1).padStart(2, '0')}-${String(qEndDay).padStart(2, '0')}`)
        } else if (preset === 'THIS_YEAR') {
            setStartDate(`${yr}-01-01`)
            setEndDate(`${yr}-12-31`)
        } else if (preset === 'LAST_YEAR') {
            setStartDate(`${yr - 1}-01-01`)
            setEndDate(`${yr - 1}-12-31`)
        } else if (preset === '2024' || preset === '2023' || preset === '2022') {
            setStartDate(`${preset}-01-01`)
            setEndDate(`${preset}-12-31`)
        }
    }

    const fetchWorkspaceData = useCallback(async () => {
        if (!isAuthorized) return
        setLoading(true)
        try {
            const params = new URLSearchParams({
                realmId: activeRealmId,
                txnType: filterType,
                direction: filterDirection,
                accountId: filterAccountId,
                search: searchQuery,
                page: String(page),
                pageSize: String(pageSize),
                checkbookPage: String(checkbookPage),
            })
            if (reconcileAccountId) params.set('reconcileAccountId', reconcileAccountId)
            if (startDate) params.set('startDate', startDate)
            if (endDate) params.set('endDate', endDate)

            const res = await authFetch(`/api/external-accounting?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error loading external accounting')

            const loadedCompanies = json.companies || []
            setCompanies(loadedCompanies)
            const resolvedRealm = json.activeRealmId || activeRealmId
            if (json.activeRealmId && json.activeRealmId !== activeRealmId) {
                setActiveRealmId(json.activeRealmId)
            }
            const loadedAccounts = json.accounts || []
            setAccounts(loadedAccounts)
            setContacts(json.contacts || [])
            setRecurring(json.recurring || [])
            setReconciliations(json.reconciliations || [])
            setReconcileTransactions(json.reconcileTransactions || [])
            setAuditLog(json.auditLog || [])
            setBankRules(json.bankRules || [])
            setBudgets(json.budgets || [])
            if (json.lists) {
                const normalizedItems = (json.lists.items || []).map((it: any, idx: number) => ({
                    ...it,
                    Id: String(it.Id ?? it.id ?? idx + 1),
                    id: String(it.Id ?? it.id ?? idx + 1),
                    Name: it.Name ?? it.FullyQualifiedName ?? it.name ?? `Item #${idx + 1}`,
                    name: it.Name ?? it.FullyQualifiedName ?? it.name ?? `Item #${idx + 1}`,
                    UnitPrice: it.UnitPrice ?? it.unit_price ?? 0,
                    unit_price: it.UnitPrice ?? it.unit_price ?? 0,
                    Description: it.Description ?? it.description ?? '',
                    description: it.Description ?? it.description ?? '',
                    account_qb_id: it.account_qb_id ?? it.IncomeAccountRef?.value ?? it.ExpenseAccountRef?.value ?? '',
                }))
                setCompanyLists({
                    items: normalizedItems,
                    categories: json.lists.categories || [],
                    departments: json.lists.departments || [],
                    classes: json.lists.classes || [],
                    paymentMethods: json.lists.paymentMethods || [],
                    terms: json.lists.terms || [],
                    customFields: json.lists.customFields || [],
                    attachments: json.lists.attachments || [],
                    costGroups: json.lists.costGroups || [],
                    closingDate: json.lists.closingDate || null,
                    accountingMethod: json.lists.accountingMethod || 'Accrual',
                    fiscalYearStartMonth: json.lists.fiscalYearStartMonth || '01',
                    taxId: json.lists.taxId || '',
                })
            }

            // Initialize default bank for Reconciliation if empty or not in active company
            const companyBanks = loadedAccounts.filter((a: any) => a.is_active && (a.account_type === 'Bank' || (a.account_type || '').toLowerCase().includes('credit card')))
            if (companyBanks.length > 0 && (!reconcileAccountId || !companyBanks.some((b: any) => b.qb_account_id === reconcileAccountId))) {
                const firstBank = companyBanks[0]
                setReconcileAccountId(firstBank.qb_account_id)
                setRecEndingBalance(Number(firstBank.current_balance || 0).toFixed(2))
            }

            // Initialize Company Settings form fields from active company
            const currComp = loadedCompanies.find((c: any) => c.realm_id === resolvedRealm)
            if (currComp) {
                setCompSetName(currComp.company_name || '')
                setCompSetLegalName(currComp.legal_name || currComp.company_name || '')
                setCompSetEmail(currComp.email || '')
                setCompSetPhone(currComp.phone || '')
                setCompSetStreet(currComp.address?.Line1 || '')
                setCompSetCity(currComp.address?.City || '')
                setCompSetState(currComp.address?.CountrySubDivisionCode || 'CA')
                setCompSetZip(currComp.address?.PostalCode || '')
                setCompSetTaxId(json.lists?.taxId || currComp.metadata?.tax_id || '')
                setCompSetMethod(json.lists?.accountingMethod || currComp.metadata?.accounting_method || 'Accrual')
                setCompSetFyMonth(json.lists?.fiscalYearStartMonth || currComp.metadata?.fiscal_year_start_month || '01')
                setCompSetClosingDate(json.lists?.closingDate || currComp.metadata?.closing_date || '')
            }

            setTransactions(json.transactions || [])
            setTotalTransactionsCount(json.totalTransactionsCount || 0)
            if (json.pagination) {
                setPagination({
                    ...json.pagination,
                    totalFiltered: Number(json.pagination.totalFiltered ?? json.pagination.totalCount ?? 0),
                })
            }
            setCheckbookTransactions(json.checkbookTransactions || [])
            setDepositsTransactions(json.depositsTransactions || [])
            if (json.checkbookPagination) {
                setCheckbookPagination({
                    ...json.checkbookPagination,
                    totalFiltered: Number(json.checkbookPagination.totalFiltered ?? json.checkbookPagination.totalCount ?? 0),
                })
            }
            setActualsByAccountAndYear(json.actualsByAccountAndYear || {})
            setNextCheckNumberByBank(json.nextCheckNumberByBank || {})
            setSummary(json.summary || {})
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setLoading(false)
        }
    }, [isAuthorized, activeRealmId, filterType, filterDirection, filterAccountId, startDate, endDate, searchQuery, page, pageSize, checkbookPage, reconcileAccountId])

    useEffect(() => {
        fetchWorkspaceData()
    }, [fetchWorkspaceData])

    const fetchReport = useCallback(async () => {
        if (!isAuthorized || activeTab !== 'reports') return
        setReportLoading(true)
        try {
            const params = new URLSearchParams({
                realmId: activeRealmId,
                reportType,
                basis: reportBasis,
                accountId: filterAccountId,
                qboArchiveKey: reportQboKey,
            })
            if (startDate) params.set('startDate', startDate)
            if (endDate) params.set('endDate', endDate)

            const res = await authFetch(`/api/external-accounting/reports?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error loading report')
            setReportData(json)
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setReportLoading(false)
        }
    }, [isAuthorized, activeTab, activeRealmId, reportType, reportBasis, filterAccountId, reportQboKey, startDate, endDate])

    useEffect(() => {
        if (activeTab === 'reports') {
            fetchReport()
        }
    }, [activeTab, fetchReport])

    const activeCompany = useMemo(
        () => companies.find(c => c.realm_id === activeRealmId) || companies[0],
        [companies, activeRealmId]
    )

    const bankAndCardAccounts = useMemo(
        () => accounts.filter(a => a.is_active && (a.account_type === 'Bank' || a.account_type === 'Credit Card')),
        [accounts]
    )

    const expenseAndGlAccounts = useMemo(
        () => accounts.filter(a => a.is_active),
        [accounts]
    )

    const computeDueDateFromTerms = (baseDateStr: string, termsStr: string) => {
        const days = termsStr === 'Net 15' ? 15 : termsStr === 'Net 30' ? 30 : termsStr === 'Net 60' ? 60 : 0
        if (!baseDateStr || days === 0) return baseDateStr
        const [y, m, d] = baseDateStr.split('-').map(Number)
        if (!y || !m || !d) return baseDateStr
        const dt = new Date(Date.UTC(y, m - 1, d + days))
        return dt.toISOString().slice(0, 10)
    }

    // Open Transaction Modal (Create or Edit)
    const openTransactionModal = (mode: ModalMode, existing?: any) => {
        setCreateMenuOpen(false)
        setGearMenuOpen(false)
        setModalMode(mode)
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        const defaultBank = bankAndCardAccounts.find(a => a.account_type === 'Bank') || bankAndCardAccounts[0]
        const defaultCard = bankAndCardAccounts.find(a => a.account_type === 'Credit Card') || bankAndCardAccounts[1] || defaultBank
        const defaultAr = expenseAndGlAccounts.find(a => a.account_type === 'Accounts Receivable') || defaultBank
        const defaultAp = expenseAndGlAccounts.find(a => a.account_type === 'Accounts Payable') || defaultBank
        const defaultIncome = expenseAndGlAccounts.find(a => a.classification === 'Revenue' || a.account_type === 'Income') || expenseAndGlAccounts[0]
        const defaultExpense = expenseAndGlAccounts.find(a => a.classification === 'Expense' || a.account_type === 'Expense') || expenseAndGlAccounts[0]

        const primaryDefaultAcc =
            (mode === 'Invoice' || mode === 'CreditMemo' || mode === 'Estimate') ? defaultAr
            : (mode === 'Bill' || mode === 'VendorCredit' || mode === 'PurchaseOrder') ? defaultAp
            : mode === 'CreditCardCredit' ? defaultCard
            : defaultBank

        const lineDefaultAcc =
            (mode === 'Deposit' || mode === 'Invoice' || mode === 'SalesReceipt' || mode === 'CreditMemo' || mode === 'RefundReceipt' || mode === 'Estimate') ? defaultIncome
            : mode === 'Payment' ? (defaultAr || defaultIncome)
            : mode === 'BillPayment' ? (defaultAp || defaultExpense)
            : defaultExpense

        if (existing) {
            setEditingTxnId(existing.id ?? null)
            const txnDt = existing.txn_date || today
            setFormDate(txnDt)
            setFormDueDate(existing.due_date || txnDt)
            setFormTerms('Due on receipt')
            setFormAddress('')
            const matchedCon = contacts.find(c => (c.display_name || '').toLowerCase() === (existing.entity_name || '').trim().toLowerCase())
            setFormCustomerEmail(matchedCon?.email || '')
            setFormDocNumber(existing.doc_number || '')
            setFormBankQbId(existing.account_qb_id || primaryDefaultAcc?.qb_account_id || '')
            setFormToAccountQbId(existing.to_account_qb_id || '')
            setFormPayeeName(existing.entity_name || '')
            setFormPaymentMethod(existing.payment_type || mode || 'Check')
            setFormDepartmentQbId(existing.department_qb_id || '')
            setFormClassQbId(existing.class_qb_id || '')
            setFormMemo(existing.memo || '')
            setFormPrintLater(existing.print_status === 'NeedToPrint')
            setFormAmount(String(existing.total_amount || ''))
            const rawLines = Array.isArray(existing.line_items) && existing.line_items.length > 0
                ? existing.line_items.map((l: any) => ({
                    account_qb_id: l.account_qb_id || lineDefaultAcc?.qb_account_id || '',
                    account_name: l.account_name || existing.to_account_name || lineDefaultAcc?.name || '',
                    description: l.description || existing.memo || '',
                    amount: String(l.amount ?? existing.total_amount ?? ''),
                    posting_type: l.posting_type || 'Debit',
                    entity_name: l.entity_name || existing.entity_name || '',
                    payment_method: l.payment_method || existing.payment_type || 'Check',
                    check_num: l.check_num || existing.doc_number || '',
                    item_id: l.item_id || '',
                    item_name: l.item_name || '',
                    qty: String(l.qty ?? '1'),
                    rate: String(l.rate ?? l.amount ?? existing.total_amount ?? '')
                }))
                : [{
                    account_qb_id: existing.to_account_qb_id || lineDefaultAcc?.qb_account_id || '',
                    account_name: existing.to_account_name || existing.category_summary || lineDefaultAcc?.name || '',
                    description: existing.memo || '',
                    amount: String(existing.total_amount || ''),
                    posting_type: 'Debit' as const,
                    entity_name: existing.entity_name || '',
                    payment_method: existing.payment_type || 'Check',
                    check_num: existing.doc_number || '',
                    item_id: '',
                    item_name: '',
                    qty: '1',
                    rate: String(existing.total_amount || '')
                }]
            setFormLines(rawLines)
        } else {
            setEditingTxnId(null)
            setFormDate(today)
            const initialTerms = (mode === 'Bill' || mode === 'Invoice') ? 'Net 30' : 'Due on receipt'
            setFormTerms(initialTerms)
            setFormDueDate(computeDueDateFromTerms(today, initialTerms))
            setFormAddress('')
            setFormCustomerEmail('')
            const bankId = primaryDefaultAcc?.qb_account_id || ''
            setFormBankQbId(bankId)
            setFormDocNumber(mode === 'Check' ? (nextCheckNumberByBank[bankId] || '1001') : '')
            setFormToAccountQbId(mode === 'PayDownCreditCard' ? (defaultCard?.qb_account_id || expenseAndGlAccounts[1]?.qb_account_id || '') : (expenseAndGlAccounts[1]?.qb_account_id || ''))
            setFormPayeeName('')
            setFormPaymentMethod(
                mode === 'Check' || mode === 'Deposit' || mode === 'Payment' || mode === 'BillPayment'
                    ? 'Check'
                    : mode === 'CreditCardCredit'
                    ? 'Credit Card'
                    : 'Cash'
            )
            setFormDepartmentQbId('')
            setFormClassQbId('')
            setFormMemo('')
            setFormPrintLater(false)
            setFormAmount('')
            if (mode === 'JournalEntry') {
                setFormLines([
                    { account_qb_id: defaultExpense?.qb_account_id || '', account_name: defaultExpense?.name || '', description: '', amount: '', posting_type: 'Debit', entity_name: '' },
                    { account_qb_id: defaultBank?.qb_account_id || '', account_name: defaultBank?.name || '', description: '', amount: '', posting_type: 'Credit', entity_name: '' }
                ])
            } else {
                setFormLines([
                    {
                        account_qb_id: lineDefaultAcc?.qb_account_id || '',
                        account_name: lineDefaultAcc?.name || '',
                        description: '',
                        amount: '',
                        posting_type: 'Debit',
                        entity_name: '',
                        payment_method: 'Check',
                        check_num: '',
                        item_id: '',
                        item_name: '',
                        qty: '1',
                        rate: ''
                    }
                ])
            }
        }
    }

    // Open a Recurring Template inside the Transaction Editor (ideal for $0 Unscheduled templates like Payroll / Daily Sales)
    const openFromRecurringTemplate = (rec: any) => {
        const raw = rec.raw_payload || {}
        const inner = raw.Deposit || raw.Purchase || raw.Check || raw.JournalEntry || raw.Bill || raw.Invoice || raw.Transfer || {}
        const rawLines = Array.isArray(inner.Line) ? inner.Line : []
        const extractedLines: any[] = []
        for (const l of rawLines) {
            if (l.DetailType === 'SubTotalLineDetail') continue
            const detail =
                l.AccountBasedExpenseLineDetail ||
                l.ItemBasedExpenseLineDetail ||
                l.DepositLineDetail ||
                l.JournalEntryLineDetail ||
                l.SalesItemLineDetail ||
                {}
            const accRef = detail.AccountRef || detail.ItemAccountRef || detail.ItemRef || null
            const matchedAcc = accounts.find(a => a.qb_account_id === accRef?.value || (a.name || '').toLowerCase() === (accRef?.name || '').toLowerCase())
            extractedLines.push({
                account_qb_id: matchedAcc?.qb_account_id || accRef?.value || '',
                account_name: matchedAcc?.name || accRef?.name || rec.template_name || '',
                description: l.Description || rec.memo || rec.template_name || '',
                amount: l.Amount != null ? String(l.Amount) : String(rec.amount || '0'),
                posting_type: detail.PostingType || 'Debit',
                entity_name: detail.Entity?.EntityRef?.name || rec.entity_name || ''
            })
        }
        if (extractedLines.length === 0 && Array.isArray(rec.line_items) && rec.line_items.length > 0) {
            for (const l of rec.line_items) {
                extractedLines.push({
                    account_qb_id: l.account_qb_id || '',
                    account_name: l.account_name || rec.template_name || '',
                    description: l.description || rec.memo || rec.template_name || '',
                    amount: l.amount != null ? String(l.amount) : String(rec.amount || '0'),
                    posting_type: l.posting_type || 'Debit',
                    entity_name: l.entity_name || rec.entity_name || ''
                })
            }
        }

        const mappedMode: ModalMode =
            rec.txn_type === 'Deposit' ? 'Deposit'
            : rec.txn_type === 'JournalEntry' ? 'JournalEntry'
            : rec.txn_type === 'Invoice' ? 'Invoice'
            : rec.txn_type === 'Bill' ? 'Bill'
            : rec.txn_type === 'Transfer' ? 'Transfer'
            : rec.txn_type === 'Check' ? 'Check'
            : 'Expense'

        openTransactionModal(mappedMode, {
            id: null, // New transaction based on template
            txn_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
            doc_number: mappedMode === 'Check' ? (nextCheckNumberByBank[rec.account_qb_id || ''] || '1001') : '',
            account_qb_id: rec.account_qb_id || '',
            entity_name: rec.entity_name || '',
            memo: rec.memo || rec.template_name || '',
            total_amount: rec.amount || 0,
            line_items: extractedLines
        })
    }

    const handleSaveTransaction = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!modalMode) return

        // Validate JournalEntry balanced Debits === Credits
        if (modalMode === 'JournalEntry') {
            const totalDebits = Number(formLines.filter(l => (l.posting_type || 'Debit') === 'Debit').reduce((s, l) => s + Number(l.amount || 0), 0).toFixed(2))
            const totalCredits = Number(formLines.filter(l => l.posting_type === 'Credit').reduce((s, l) => s + Number(l.amount || 0), 0).toFixed(2))
            if (Math.abs(totalDebits - totalCredits) > 0.01) {
                notify('err', `${t('external_accounting.journal_unbalanced_err')} (Debit: ${formatCurrency(totalDebits)} vs Credit: ${formatCurrency(totalCredits)})`)
                return
            }
        }

        setSaving(true)
        try {
            const bankObj = accounts.find(a => a.qb_account_id === formBankQbId)
            const toAccObj = accounts.find(a => a.qb_account_id === formToAccountQbId)

            const preparedLines = formLines.map(l => {
                const acc = accounts.find(a => a.qb_account_id === l.account_qb_id || a.name === l.account_name)
                return {
                    account_qb_id: acc?.qb_account_id || l.account_qb_id || null,
                    account_name: acc?.name || l.account_name || '',
                    description: l.description || formMemo,
                    amount: Number(l.amount || formAmount || 0),
                    posting_type: l.posting_type || null,
                    entity_name: l.entity_name || formPayeeName || null,
                    payment_method: l.payment_method || formPaymentMethod || null,
                    check_num: l.check_num || formDocNumber || null,
                    item_id: l.item_id || null,
                    item_name: l.item_name || null,
                    qty: l.qty != null && l.qty !== '' ? Number(l.qty) : null,
                    rate: l.rate != null && l.rate !== '' ? Number(l.rate) : null,
                }
            })

            const effectivePayeeName = formPayeeName.trim() ||
                Array.from(new Set(preparedLines.map(l => (l.entity_name || '').trim()).filter(Boolean))).join(', ')
            const effectiveDocNumber = formDocNumber.trim() ||
                Array.from(new Set(preparedLines.map(l => (l.check_num || '').trim()).filter(Boolean))).join(', ')
            const matchedContact = contacts.find(c => (c.display_name || '').toLowerCase() === effectivePayeeName.toLowerCase())

            const sumLines = modalMode === 'JournalEntry'
                ? preparedLines.filter(l => l.posting_type === 'Debit').reduce((s, l) => s + Number(l.amount || 0), 0)
                : preparedLines.reduce((s, l) => s + Number(l.amount || 0), 0)
            const finalAmount = (modalMode === 'Transfer' || modalMode === 'PayDownCreditCard')
                ? Number(formAmount || 0)
                : (sumLines > 0 ? sumLines : Number(formAmount || 0))

            const deptObj = (companyLists.departments || []).find((d: any) => String(d.Id ?? d.qb_location_id) === String(formDepartmentQbId))
            const clsObj = (companyLists.classes || []).find((c: any) => String(c.Id ?? c.qb_class_id) === String(formClassQbId))

            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_transaction',
                    realmId: activeRealmId,
                    id: editingTxnId,
                    txn_type: modalMode,
                    txn_date: formDate,
                    due_date: (modalMode === 'Bill' || modalMode === 'Invoice' || modalMode === 'Estimate') ? (formDueDate || formDate) : null,
                    doc_number: effectiveDocNumber,
                    payment_type: formPaymentMethod,
                    account_qb_id: bankObj?.qb_account_id || formBankQbId,
                    account_name: bankObj?.name || '',
                    to_account_qb_id: (modalMode === 'Transfer' || modalMode === 'PayDownCreditCard') ? (toAccObj?.qb_account_id || formToAccountQbId) : preparedLines[0]?.account_qb_id,
                    to_account_name: (modalMode === 'Transfer' || modalMode === 'PayDownCreditCard') ? (toAccObj?.name || '') : preparedLines[0]?.account_name,
                    entity_qb_id: matchedContact?.qb_contact_id || null,
                    entity_name: effectivePayeeName,
                    department_qb_id: formDepartmentQbId || null,
                    department_name: deptObj?.Name || deptObj?.FullyQualifiedName || null,
                    class_qb_id: formClassQbId || null,
                    class_name: clsObj?.Name || clsObj?.FullyQualifiedName || null,
                    term_name: (modalMode === 'Bill' || modalMode === 'Invoice') ? formTerms : null,
                    memo: formMemo,
                    print_status: formPrintLater ? 'NeedToPrint' : 'NotSet',
                    total_amount: finalAmount,
                    line_items: (modalMode === 'Transfer' || modalMode === 'PayDownCreditCard') ? [] : preparedLines,
                    created_by: user?.name || user?.email || 'Raquel Velazquez',
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving transaction')

            notify('ok', t('external_accounting.saved_successfully'))
            setModalMode(null)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleSaveInlineRegister = async (e: React.FormEvent) => {
        e.preventDefault()
        const amt = Number(inlineRegAmount || 0)
        if (!amt || amt <= 0) return
        setSaving(true)
        try {
            const effectiveBankQbId =
                (filterAccountId !== 'ALL' && bankAndCardAccounts.some(b => b.qb_account_id === filterAccountId))
                    ? filterAccountId
                    : (inlineRegBankId || bankAndCardAccounts[0]?.qb_account_id || accounts[0]?.qb_account_id || '')
            const bankObj = accounts.find(a => a.qb_account_id === effectiveBankQbId)

            const defaultGl = inlineRegType === 'Deposit'
                ? accounts.find(a => a.classification === 'Revenue' || a.account_type === 'Income')
                : accounts.find(a => a.classification === 'Expense' || a.account_type === 'Expense')
            const glObj = accounts.find(a => a.qb_account_id === inlineRegGlId) || defaultGl || accounts[0]
            const matchedContact = contacts.find(c => (c.display_name || '').toLowerCase() === inlineRegPayee.trim().toLowerCase())

            const docNo = inlineRegDocNum.trim() || (inlineRegType === 'Check' ? (nextCheckNumberByBank[effectiveBankQbId] || '1001') : '')

            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_transaction',
                    realmId: activeRealmId,
                    txn_type: inlineRegType,
                    txn_date: inlineRegDate,
                    doc_number: docNo,
                    account_qb_id: bankObj?.qb_account_id || effectiveBankQbId,
                    account_name: bankObj?.name || '',
                    to_account_qb_id: glObj?.qb_account_id || '',
                    to_account_name: glObj?.name || '',
                    entity_qb_id: matchedContact?.qb_contact_id || null,
                    entity_name: inlineRegPayee.trim(),
                    memo: inlineRegMemo.trim(),
                    print_status: 'NotSet',
                    total_amount: amt,
                    line_items: [{
                        account_qb_id: glObj?.qb_account_id || '',
                        account_name: glObj?.name || '',
                        description: inlineRegMemo.trim(),
                        amount: amt,
                        posting_type: inlineRegType === 'Deposit' ? 'Credit' : 'Debit',
                        entity_name: inlineRegPayee.trim(),
                    }],
                    created_by: user?.name || user?.email || 'Raquel Velazquez',
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving register entry')

            setInlineRegPayee('')
            setInlineRegMemo('')
            setInlineRegAmount('')
            setInlineRegDocNum('')
            notify('ok', t('external_accounting.saved_successfully'))
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // QBO Two-Way Mirror Sync & OAuth Connection Handlers (Camino B -> Camino A transition)
    const [qboSyncing, setQboSyncing] = useState(false)

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e.data === 'qb_authorized' || e.data?.type === 'qb_external_authorized') {
                notify('ok', t('external_accounting.qbo_status_connected'))
                fetchWorkspaceData()
            }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [fetchWorkspaceData, t])

    const handleConnectQbo = () => {
        const authUrl = `/api/integrations/quickbooks/auth?mode=external&realmId=${encodeURIComponent(activeRealmId)}`
        window.open(authUrl, 'qbo_oauth_popup', 'width=680,height=760')
    }

    const handleConnectAllQbo = () => {
        const authUrl = `/api/integrations/quickbooks/auth?mode=external_all`
        window.open(authUrl, 'qbo_oauth_popup', 'width=680,height=760')
    }

    const handleSyncWithQbo = async () => {
        setQboSyncing(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync_with_qbo',
                    realmId: activeRealmId,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error syncing with QBO')
            const sr = json.syncResult || {}
            notify(
                'ok',
                `${t('external_accounting.qbo_sync_success')} (↑${sr.pushedTransactions || 0} / ↓${sr.pulledTransactions || 0})`
            )
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setQboSyncing(false)
        }
    }

    const handleSyncAllWithQbo = async () => {
        setQboSyncing(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync_all_with_qbo',
                    realmId: activeRealmId,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error syncing all companies with QBO')
            const sr = json.syncResult || {}
            notify(
                'ok',
                `${t('external_accounting.qbo_sync_all_success')} (${sr.companiesSynced || 0}/${sr.companiesTotal || 8}) · ↑${sr.pushedTransactions || 0} / ↓${sr.pulledTransactions || 0}`
            )
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setQboSyncing(false)
        }
    }

    const handleToggleQboMirrorMode = async (enabled: boolean) => {
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_qbo_mirror_mode',
                    realmId: activeRealmId,
                    enabled,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error updating QBO mode')
            notify(
                'ok',
                enabled
                    ? t('external_accounting.qbo_mode_mirror_label')
                    : t('external_accounting.qbo_status_standalone')
            )
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        }
    }

    const handleToggleClearedStatus = async (txn: any) => {
        if (txn.is_voided) return
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_cleared_status',
                    realmId: activeRealmId,
                    id: txn.id,
                    cleared_status: txn.cleared_status
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error updating status')
            setTransactions(prev => prev.map(r => r.id === txn.id ? { ...r, cleared_status: json.cleared_status } : r))
            setCheckbookTransactions(prev => prev.map(r => r.id === txn.id ? { ...r, cleared_status: json.cleared_status } : r))
        } catch (err: any) {
            notify('err', err.message || 'Error')
        }
    }

    const handleVoidTransaction = async (txn: any) => {
        if (!window.confirm(t('external_accounting.confirm_void_msg'))) return
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'void_transaction', realmId: activeRealmId, id: txn.id })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error voiding transaction')
            notify('ok', t('external_accounting.saved_successfully'))
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        }
    }

    const handleDeleteTransaction = async (txn: any) => {
        openDeleteWizard('transaction', txn)
    }

    const handleExecuteRecurring = async (rec: any) => {
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'execute_recurring',
                    realmId: activeRealmId,
                    recurringId: rec.id,
                    txnDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error executing recurring')
            notify('ok', t('external_accounting.recurring_executed'))
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleSaveRecurring = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const bankAcc = accounts.find(a => a.qb_account_id === recFormAccountQbId)
            const glAcc = accounts.find(a => a.qb_account_id === recFormGlAccountQbId)
            const matchedContact = contacts.find(c => (c.display_name || '').toLowerCase() === recFormEntityName.trim().toLowerCase())

            const rawPayload = {
                ...(editingRecurring?.raw_payload || {}),
                [recFormTxnType]: {
                    Line: glAcc ? [{
                        Amount: Number(recFormAmount || 0),
                        Description: recFormMemo || recFormName,
                        AccountBasedExpenseLineDetail: {
                            AccountRef: { value: glAcc.qb_account_id, name: glAcc.name }
                        }
                    }] : (editingRecurring?.raw_payload?.[recFormTxnType]?.Line || [])
                }
            }

            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_recurring',
                    realmId: activeRealmId,
                    id: editingRecurring?.id,
                    template_name: recFormName,
                    recur_type: recFormRecurType,
                    txn_type: recFormTxnType,
                    interval_type: recFormInterval,
                    num_interval: Number(recFormNumInterval || 1),
                    next_date: recFormNextDate || null,
                    account_qb_id: bankAcc?.qb_account_id || recFormAccountQbId || null,
                    account_name: bankAcc?.name || null,
                    gl_account_qb_id: glAcc?.qb_account_id || recFormGlAccountQbId || null,
                    gl_account_name: glAcc?.name || null,
                    entity_qb_id: matchedContact?.qb_contact_id || null,
                    entity_name: recFormEntityName || null,
                    memo: recFormMemo || null,
                    amount: Number(recFormAmount || 0),
                    raw_payload: rawPayload
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving recurring template')
            notify('ok', t('external_accounting.saved_successfully'))
            setRecurringModalOpen(false)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteRecurring = async (rec: any) => {
        openDeleteWizard('recurring', rec)
    }

    const handleSaveAccount = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const parentObj = accFormIsSub && accFormParentId
                ? accounts.find(a => a.qb_account_id === accFormParentId)
                : null
            const fqName = parentObj ? `${parentObj.name}:${accFormName.trim()}` : accFormName.trim()

            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_account',
                    realmId: activeRealmId,
                    id: editingAccount?.id,
                    name: accFormName,
                    acct_num: accFormNum,
                    account_type: accFormType,
                    account_sub_type: accFormSubType || null,
                    classification: accFormClass,
                    description: accFormDesc || null,
                    is_sub_account: Boolean(accFormIsSub && accFormParentId),
                    parent_qb_id: accFormIsSub && accFormParentId ? accFormParentId : null,
                    fully_qualified_name: fqName,
                    current_balance: Number(accFormBalance || 0)
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving account')
            notify('ok', t('external_accounting.saved_successfully'))
            setAccountModalOpen(false)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleSaveContact = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_contact',
                    realmId: activeRealmId,
                    id: editingContact?.id,
                    display_name: conFormName,
                    company_name: conFormCompany || null,
                    print_on_check_name: conFormPrintOnCheck || conFormName || null,
                    acct_num: conFormAcctNum || null,
                    address: conFormAddress.trim() ? { Line1: conFormAddress.trim() } : (editingContact?.address || null),
                    balance: Number(conFormBalance || 0),
                    contact_type: conFormType,
                    email: conFormEmail,
                    phone: conFormPhone,
                    tax_identifier: conFormTaxId,
                    vendor_1099: conForm1099
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving contact')
            notify('ok', t('external_accounting.saved_successfully'))
            setContactModalOpen(false)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // =========================================================================
    // DEDICATED CLEAN PRINT ENGINE (Official Check, Ledger, Checkbook & CPA Reports)
    // =========================================================================

    const handlePrintOfficialCheck = (txn: any) => {
        if (!txn) return
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'COMPANY'
        const payee = txn.entity_name || txn.category_summary || 'BEARER'
        const amt = Number(txn.total_amount || 0)
        const words = numberToEnglishWords(amt)
        const checkNo = txn.doc_number || 'EFT'
        const dateStr = txn.txn_date || ''
        const memoStr = txn.memo || txn.category_summary || ''
        const bankName = txn.account_name || 'Operating Bank Account'
        const rawLines = Array.isArray(txn.line_items) && txn.line_items.length > 0
            ? txn.line_items
            : [{ account_name: txn.category_summary || txn.to_account_name || 'Expense', description: memoStr, amount: amt }]

        const voucherRowsHtml = rawLines.map((l: any) => `
            <tr>
              <td>${escapeHtml(l.account_name || txn.category_summary || '—')}</td>
              <td>${escapeHtml(l.description || memoStr || '—')}</td>
              <td class="right mono">${escapeHtml(formatCurrency(l.amount ?? amt))}</td>
            </tr>
        `).join('')

        const bodyHtml = `
          <style>
            .check-sheet {
              display: flex;
              flex-direction: column;
              gap: 18px;
              font-family: Georgia, 'Times New Roman', serif;
            }
            .check-face {
              border: 2px solid #0f172a;
              border-radius: 8px;
              padding: 20px 24px;
              background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 55%, #f8fafc 100%);
              min-height: 2.95in;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .check-top {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
            }
            .check-comp {
              font-size: 16px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.03em;
            }
            .check-bank {
              font-family: 'Segoe UI', Arial, sans-serif;
              font-size: 10px;
              color: #475569;
              margin-top: 2px;
            }
            .check-num-block {
              text-align: right;
              font-family: 'Segoe UI', Arial, sans-serif;
            }
            .check-no {
              font-size: 15px;
              font-weight: 800;
              font-family: 'Courier New', monospace;
            }
            .check-date {
              font-size: 11px;
              margin-top: 4px;
            }
            .check-pay-row {
              display: flex;
              align-items: flex-end;
              gap: 12px;
              border-bottom: 1.5px solid #334155;
              padding-bottom: 6px;
              margin-top: 14px;
            }
            .check-pay-label {
              font-family: 'Segoe UI', Arial, sans-serif;
              font-size: 10px;
              font-weight: 700;
              color: #475569;
              text-transform: uppercase;
              width: 95px;
              flex-shrink: 0;
            }
            .check-payee {
              flex: 1;
              font-size: 15px;
              font-weight: 800;
              color: #0f172a;
            }
            .check-amt-box {
              border: 2px solid #0f172a;
              background: #ffffff;
              padding: 5px 12px;
              font-family: 'Courier New', monospace;
              font-size: 15px;
              font-weight: 800;
              min-width: 135px;
              text-align: right;
            }
            .check-words-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1px solid #475569;
              padding-bottom: 5px;
              margin-top: 12px;
              font-family: 'Courier New', monospace;
              font-size: 11px;
              font-weight: 700;
            }
            .check-bottom {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              margin-top: 22px;
              font-family: 'Segoe UI', Arial, sans-serif;
              font-size: 10px;
            }
            .check-sig {
              width: 230px;
              border-top: 1.5px solid #0f172a;
              padding-top: 4px;
              text-align: center;
              font-size: 9px;
              font-weight: 700;
              letter-spacing: 0.08em;
              color: #475569;
              text-transform: uppercase;
            }
            .check-micr {
              margin-top: 10px;
              text-align: center;
              font-family: 'Courier New', monospace;
              font-size: 12px;
              letter-spacing: 0.2em;
              color: #334155;
            }
            .stub-box {
              border: 1px dashed #64748b;
              border-radius: 8px;
              padding: 14px 18px;
              font-family: 'Segoe UI', Arial, sans-serif;
              min-height: 2.7in;
            }
            .stub-header {
              display: flex;
              justify-content: space-between;
              border-bottom: 1px solid #cbd5e1;
              padding-bottom: 6px;
              margin-bottom: 8px;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              color: #334155;
            }
          </style>
          <div class="check-sheet">
            <div class="check-face">
              <div>
                <div class="check-top">
                  <div>
                    <div class="check-comp">${escapeHtml(compName)}</div>
                    <div class="check-bank">${escapeHtml(bankName)}</div>
                  </div>
                  <div class="check-num-block">
                    <div class="check-no">CHECK NO. #${escapeHtml(checkNo)}</div>
                    <div class="check-date">DATE: <strong>${escapeHtml(dateStr)}</strong></div>
                  </div>
                </div>
                <div class="check-pay-row">
                  <div class="check-pay-label">${escapeHtml(t('external_accounting.pay_to_order_of'))}:</div>
                  <div class="check-payee">${escapeHtml(payee)}</div>
                  <div class="check-amt-box">${escapeHtml(formatCurrency(amt))}</div>
                </div>
                <div class="check-words-row">
                  <span>*** ${escapeHtml(words)} ***</span>
                  <span style="font-family: Arial, sans-serif; font-size: 10px;">${escapeHtml(t('external_accounting.dollars_label'))}</span>
                </div>
              </div>
              <div>
                <div class="check-bottom">
                  <div><strong>MEMO:</strong> ${escapeHtml(memoStr)}</div>
                  <div class="check-sig">AUTHORIZED SIGNATURE</div>
                </div>
                <div class="check-micr">⑆${escapeHtml(String(checkNo).padStart(6, '0'))}⑆ ⑈${escapeHtml(activeRealmId.slice(-8))}⑈</div>
              </div>
            </div>

            <div class="stub-box">
              <div class="stub-header">
                <span>${escapeHtml(t('external_accounting.check_voucher_stub'))} — PAYEE REMITTANCE COPY</span>
                <span>${escapeHtml(compName)} · #${escapeHtml(checkNo)} · ${escapeHtml(dateStr)}</span>
              </div>
              <div style="margin-bottom: 8px; font-size: 11px;">
                <strong>Payee:</strong> ${escapeHtml(payee)} &nbsp;|&nbsp;
                <strong>Bank Account:</strong> ${escapeHtml(bankName)} &nbsp;|&nbsp;
                <strong>Total Paid:</strong> <span class="mono">${escapeHtml(formatCurrency(amt))}</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>GL Account / Category</th>
                    <th>Description / Memo</th>
                    <th class="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${voucherRowsHtml}
                  <tr class="summary-row">
                    <td colspan="2">TOTAL VOUCHER AMOUNT</td>
                    <td class="right mono">${escapeHtml(formatCurrency(amt))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="stub-box">
              <div class="stub-header">
                <span>ACCOUNTING FILE COPY — INTERNAL AUDIT RECORD</span>
                <span>${escapeHtml(compName)} · #${escapeHtml(checkNo)} · ${escapeHtml(dateStr)}</span>
              </div>
              <div style="margin-bottom: 8px; font-size: 11px;">
                <strong>Payee:</strong> ${escapeHtml(payee)} &nbsp;|&nbsp;
                <strong>Bank Account:</strong> ${escapeHtml(bankName)} &nbsp;|&nbsp;
                <strong>Status:</strong> ${escapeHtml(txn.is_voided ? 'VOID' : (txn.cleared_status || 'Issued'))}
              </div>
              <table>
                <thead>
                  <tr>
                    <th>GL Account / Category</th>
                    <th>Description / Memo</th>
                    <th class="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${voucherRowsHtml}
                  <tr class="summary-row">
                    <td colspan="2">TOTAL CHECK DISBURSEMENT</td>
                    <td class="right mono">${escapeHtml(formatCurrency(amt))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `

        if (!openCleanPrintWindow(`Check_${checkNo}_${compName}`, bodyHtml, false)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    const handlePrintLedger = () => {
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const periodLabel = `${startDate || t('external_accounting.period_all_dates')} — ${endDate || 'Present'}`
        const rowsHtml = transactions.map(r => {
            const isOut = r.direction === 'OUT' || r.direction === 'TRANSFER'
            const isIn = r.direction === 'IN'
            return `
              <tr class="${r.is_voided ? 'voided' : ''}">
                <td class="mono">${escapeHtml(r.txn_date)}</td>
                <td>${escapeHtml(r.txn_type)}</td>
                <td class="mono">${escapeHtml(r.doc_number || '—')}</td>
                <td><strong>${escapeHtml(r.entity_name || '—')}</strong></td>
                <td>${escapeHtml(r.account_name || '—')}</td>
                <td>${escapeHtml(r.category_summary || '—')}</td>
                <td>${escapeHtml(r.memo || '—')}</td>
                <td class="right mono">${isOut ? escapeHtml(formatCurrency(r.total_amount)) : ''}</td>
                <td class="right mono">${isIn ? escapeHtml(formatCurrency(r.total_amount)) : ''}</td>
                <td class="right mono"><strong>${r.running_balance != null ? escapeHtml(formatCurrency(r.running_balance)) : '—'}</strong></td>
                <td class="center">${escapeHtml(r.is_voided ? 'VOID' : (r.cleared_status || 'C'))}</td>
              </tr>
            `
        }).join('')

        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.print_doc_ledger_title'))}</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.date_range_label'))}:</strong> ${escapeHtml(periodLabel)}</div>
              <div><strong>${escapeHtml(t('external_accounting.records_label'))}:</strong> ${transactions.length} / ${pagination.totalFiltered}</div>
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>

          <div class="kpi-strip">
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.kpi_bank_balance'))}</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(summary.totalBankBalance))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.kpi_total_inflows'))}</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(summary.totalInflows))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.kpi_total_outflows'))}</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(summary.totalOutflows))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.kpi_net_flow'))}</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(summary.netCashFlow))}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('external_accounting.col_date'))}</th>
                <th>${escapeHtml(t('external_accounting.col_type'))}</th>
                <th>${escapeHtml(t('external_accounting.col_doc_num'))}</th>
                <th>${escapeHtml(t('external_accounting.col_payee'))}</th>
                <th>${escapeHtml(t('external_accounting.col_account'))}</th>
                <th>${escapeHtml(t('external_accounting.col_category'))}</th>
                <th>${escapeHtml(t('external_accounting.col_memo'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.col_outflow'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.col_inflow'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.col_balance'))}</th>
                <th class="center">${escapeHtml(t('external_accounting.col_status'))}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        `

        if (!openCleanPrintWindow(`${compName}_Ledger`, bodyHtml, true)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    const handlePrintCheckbookList = () => {
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const periodLabel = `${startDate || t('external_accounting.period_all_dates')} — ${endDate || 'Present'}`
        const listToPrint = checkbookTransactions.length > 0 ? checkbookTransactions : checksList
        const totalAmt = listToPrint.reduce((s, r) => s + (r.is_voided ? 0 : Number(r.total_amount || 0)), 0)

        const rowsHtml = listToPrint.map(chk => `
          <tr class="${chk.is_voided ? 'voided' : ''}">
            <td class="mono">${escapeHtml(chk.txn_date)}</td>
            <td class="mono"><strong>${escapeHtml(chk.doc_number || '—')}</strong></td>
            <td>${escapeHtml(chk.txn_type)}</td>
            <td><strong>${escapeHtml(chk.entity_name || '—')}</strong></td>
            <td>${escapeHtml(chk.account_name || '—')}</td>
            <td>${escapeHtml(chk.category_summary || '—')}</td>
            <td>${escapeHtml(chk.memo || '—')}</td>
            <td class="center">${escapeHtml(chk.is_voided ? 'VOID' : (chk.cleared_status || 'C'))}</td>
            <td class="right mono"><strong>${escapeHtml(formatCurrency(chk.total_amount))}</strong></td>
          </tr>
        `).join('')

        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.print_doc_checkbook_title'))}</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.date_range_label'))}:</strong> ${escapeHtml(periodLabel)}</div>
              <div><strong>${escapeHtml(t('external_accounting.records_label'))}:</strong> ${listToPrint.length}</div>
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('external_accounting.col_date'))}</th>
                <th>${escapeHtml(t('external_accounting.col_doc_num'))}</th>
                <th>${escapeHtml(t('external_accounting.col_type'))}</th>
                <th>${escapeHtml(t('external_accounting.col_payee'))}</th>
                <th>${escapeHtml(t('external_accounting.col_account'))}</th>
                <th>${escapeHtml(t('external_accounting.col_category'))}</th>
                <th>${escapeHtml(t('external_accounting.col_memo'))}</th>
                <th class="center">${escapeHtml(t('external_accounting.col_status'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.col_amount'))}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr class="summary-row">
                <td colspan="8">${escapeHtml(t('external_accounting.totals_label'))}</td>
                <td class="right mono">${escapeHtml(formatCurrency(totalAmt))}</td>
              </tr>
            </tbody>
          </table>
        `

        if (!openCleanPrintWindow(`${compName}_Checkbook`, bodyHtml, false)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    const handlePrintActiveReport = () => {
        if (!reportData) {
            handlePrintLedger()
            return
        }
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const periodLabel = `${startDate || t('external_accounting.period_all_dates')} — ${endDate || 'Present'}`
        const reportTitles: Record<string, string> = {
            pnl: t('external_accounting.report_pnl'),
            balance_sheet: t('external_accounting.report_balance_sheet'),
            bank_register: t('external_accounting.report_bank_register'),
            general_ledger: t('external_accounting.report_general_ledger'),
            trial_balance: t('external_accounting.report_trial_balance'),
            vendor_expenses: t('external_accounting.report_vendor_expenses'),
            customer_income: t('external_accounting.report_customer_income'),
            check_detail: t('external_accounting.report_check_detail'),
            deposit_detail: t('external_accounting.report_deposit_detail'),
            qbo_archive: reportData?.archiveReport?.title || t('external_accounting.report_qbo_archive'),
        }
        const docTitle = reportTitles[reportType] || reportType.toUpperCase()
        let contentHtml = ''

        if (reportType === 'pnl' && reportData.pnl) {
            const yrs: string[] = reportData.pnl.years || []
            const showYrs = yrs.length > 1
            const yrHeaders = showYrs ? yrs.map(y => `<th class="right mono">${escapeHtml(y)}</th>`).join('') : ''
            const incRows = (reportData.pnl.incomeRows || []).map((r: any) => `
              <tr>
                <td>${escapeHtml(r.category)}</td>
                ${showYrs ? yrs.map(y => `<td class="right mono">${r.byYear?.[y] ? escapeHtml(formatCurrency(r.byYear[y])) : '—'}</td>`).join('') : ''}
                <td class="right mono"><strong>${escapeHtml(formatCurrency(r.amount))}</strong></td>
              </tr>
            `).join('')
            const expRows = (reportData.pnl.expenseRows || []).map((r: any) => `
              <tr>
                <td>${escapeHtml(r.category)}</td>
                ${showYrs ? yrs.map(y => `<td class="right mono">${r.byYear?.[y] ? escapeHtml(formatCurrency(r.byYear[y])) : '—'}</td>`).join('') : ''}
                <td class="right mono"><strong>${escapeHtml(formatCurrency(r.amount))}</strong></td>
              </tr>
            `).join('')

            contentHtml = `
              <table>
                <thead>
                  <tr>
                    <th>${escapeHtml(t('external_accounting.col_category'))}</th>
                    ${yrHeaders}
                    <th class="right">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="section-row"><td colspan="${showYrs ? yrs.length + 2 : 2}">${escapeHtml(t('external_accounting.income_section'))}</td></tr>
                  ${incRows}
                  <tr class="summary-row">
                    <td>${escapeHtml(t('external_accounting.total_income'))}</td>
                    ${showYrs ? yrs.map(y => `<td class="right mono">${escapeHtml(formatCurrency(reportData.pnl.incomeByYear?.[y] || 0))}</td>`).join('') : ''}
                    <td class="right mono">${escapeHtml(formatCurrency(reportData.pnl.totalIncome))}</td>
                  </tr>
                  <tr class="section-row"><td colspan="${showYrs ? yrs.length + 2 : 2}">${escapeHtml(t('external_accounting.expense_section'))}</td></tr>
                  ${expRows}
                  <tr class="summary-row">
                    <td>${escapeHtml(t('external_accounting.total_expenses'))}</td>
                    ${showYrs ? yrs.map(y => `<td class="right mono">${escapeHtml(formatCurrency(reportData.pnl.expenseByYear?.[y] || 0))}</td>`).join('') : ''}
                    <td class="right mono">${escapeHtml(formatCurrency(reportData.pnl.totalExpenses))}</td>
                  </tr>
                  <tr class="summary-row">
                    <td colspan="${showYrs ? yrs.length + 1 : 1}">${escapeHtml(t('external_accounting.net_income'))}</td>
                    <td class="right mono">${escapeHtml(formatCurrency(reportData.pnl.netIncome))}</td>
                  </tr>
                </tbody>
              </table>
            `
        } else if (reportType === 'balance_sheet' && reportData.balanceSheet) {
            const bs = reportData.balanceSheet
            const renderBsGroupRows = (rows: any[]) => (rows || []).map((a: any) => `
              <tr>
                <td style="padding-left:${a.is_sub_account ? '24px' : '12px'};">${escapeHtml(a.name)}</td>
                <td>${escapeHtml(a.account_type || '')}</td>
                <td class="right mono">${escapeHtml(formatCurrency(a.current_balance))}</td>
              </tr>
            `).join('')

            contentHtml = `
              <table>
                <thead><tr><th>${escapeHtml(t('external_accounting.col_acct_name'))}</th><th>${escapeHtml(t('external_accounting.col_acct_type'))}</th><th class="right">${escapeHtml(t('external_accounting.col_current_balance'))}</th></tr></thead>
                <tbody>
                  <tr class="section-row"><td colspan="3">${escapeHtml(t('external_accounting.assets_section'))}</td></tr>
                  <tr class="section-row"><td colspan="3" style="padding-left:8px;">${escapeHtml(t('external_accounting.bs_current_assets'))}</td></tr>
                  ${(bs.bankAccounts?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_bank_accounts'))}</td></tr>
                    ${renderBsGroupRows(bs.bankAccounts)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_bank_accounts'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalBankAccounts ?? 0))}</td></tr>
                  ` : ''}
                  ${(bs.accountsReceivable?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_accounts_receivable'))}</td></tr>
                    ${renderBsGroupRows(bs.accountsReceivable)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_ar'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalAccountsReceivable ?? 0))}</td></tr>
                  ` : ''}
                  ${(bs.otherCurrentAssets?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_other_current_assets'))}</td></tr>
                    ${renderBsGroupRows(bs.otherCurrentAssets)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_oca'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalOtherCurrentAssets ?? 0))}</td></tr>
                  ` : ''}
                  <tr class="summary-row"><td colspan="2" style="padding-left:8px;">${escapeHtml(t('external_accounting.bs_total_current_assets'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalCurrentAssets ?? bs.totalAssets ?? 0))}</td></tr>
                  ${(bs.fixedAssets?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:8px; font-weight:800;">${escapeHtml(t('external_accounting.bs_fixed_assets'))}</td></tr>
                    ${renderBsGroupRows(bs.fixedAssets)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:8px;">${escapeHtml(t('external_accounting.bs_total_fixed_assets'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalFixedAssets ?? 0))}</td></tr>
                  ` : ''}
                  ${(bs.otherAssets?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:8px; font-weight:800;">${escapeHtml(t('external_accounting.bs_other_assets'))}</td></tr>
                    ${renderBsGroupRows(bs.otherAssets)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:8px;">${escapeHtml(t('external_accounting.bs_total_other_assets'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalOtherAssets ?? 0))}</td></tr>
                  ` : ''}
                  <tr class="summary-row"><td colspan="2">${escapeHtml(t('external_accounting.total_assets'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalAssets))}</td></tr>

                  <tr class="section-row"><td colspan="3">${escapeHtml(t('external_accounting.liabilities_section'))}</td></tr>
                  ${(bs.accountsPayable?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_accounts_payable'))}</td></tr>
                    ${renderBsGroupRows(bs.accountsPayable)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_ap'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalAccountsPayable ?? 0))}</td></tr>
                  ` : ''}
                  ${(bs.creditCards?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_credit_cards'))}</td></tr>
                    ${renderBsGroupRows(bs.creditCards)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_cc'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalCreditCards ?? 0))}</td></tr>
                  ` : ''}
                  ${(bs.otherCurrentLiabilities?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_other_current_liabilities'))}</td></tr>
                    ${renderBsGroupRows(bs.otherCurrentLiabilities)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_ocl'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalOtherCurrentLiabilities ?? 0))}</td></tr>
                  ` : ''}
                  ${(bs.longTermLiabilities?.length || 0) > 0 ? `
                    <tr><td colspan="3" style="padding-left:10px; font-weight:800;">${escapeHtml(t('external_accounting.bs_long_term_liabilities'))}</td></tr>
                    ${renderBsGroupRows(bs.longTermLiabilities)}
                    <tr class="summary-row"><td colspan="2" style="padding-left:10px;">${escapeHtml(t('external_accounting.bs_total_ltl'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalLongTermLiabilities ?? 0))}</td></tr>
                  ` : ''}
                  <tr class="summary-row"><td colspan="2">${escapeHtml(t('external_accounting.total_liabilities'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalLiabilities))}</td></tr>

                  <tr class="section-row"><td colspan="3">${escapeHtml(t('external_accounting.equity_section'))}</td></tr>
                  ${renderBsGroupRows(bs.equity)}
                  <tr><td style="padding-left:12px;"><em>${escapeHtml(t('external_accounting.retained_net_income'))}</em></td><td>Equity</td><td class="right mono">${escapeHtml(formatCurrency(bs.retainedNetIncome))}</td></tr>
                  <tr class="summary-row"><td colspan="2">${escapeHtml(t('external_accounting.bs_total_equity'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalEquity ?? (Number(bs.statedEquity || 0) + Number(bs.retainedNetIncome || 0))))}</td></tr>
                  <tr class="summary-row"><td colspan="2">${escapeHtml(t('external_accounting.total_liabilities_equity'))}</td><td class="right mono">${escapeHtml(formatCurrency(bs.totalLiabilitiesAndEquity))}</td></tr>
                </tbody>
              </table>
            `
        } else if (reportType === 'trial_balance' && reportData.trialBalance) {
            const tbRows = (reportData.trialBalance.rows || []).map((r: any) => `
              <tr>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td>${escapeHtml(r.account_type)}</td>
                <td class="right mono">${r.debit ? escapeHtml(formatCurrency(r.debit)) : '—'}</td>
                <td class="right mono">${r.credit ? escapeHtml(formatCurrency(r.credit)) : '—'}</td>
              </tr>
            `).join('')
            contentHtml = `
              <table>
                <thead><tr><th>${escapeHtml(t('external_accounting.col_acct_name'))}</th><th>${escapeHtml(t('external_accounting.col_acct_type'))}</th><th class="right">${escapeHtml(t('external_accounting.col_debit'))}</th><th class="right">${escapeHtml(t('external_accounting.col_credit'))}</th></tr></thead>
                <tbody>
                  ${tbRows}
                  <tr class="summary-row">
                    <td colspan="2">${escapeHtml(t('external_accounting.totals_label'))}</td>
                    <td class="right mono">${escapeHtml(formatCurrency(reportData.trialBalance.totalDebit))}</td>
                    <td class="right mono">${escapeHtml(formatCurrency(reportData.trialBalance.totalCredit))}</td>
                  </tr>
                </tbody>
              </table>
            `
        } else if ((reportType === 'vendor_expenses' || reportType === 'customer_income') && reportData.entitySummary) {
            const entRows = (reportData.entitySummary.rows || []).map((r: any) => `
              <tr>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td>${escapeHtml(r.categories)}</td>
                <td class="center mono">${escapeHtml(r.count)}</td>
                <td class="center mono">${escapeHtml(r.last_date)}</td>
                <td class="right mono"><strong>${escapeHtml(formatCurrency(r.total_amount))}</strong></td>
              </tr>
            `).join('')
            contentHtml = `
              <table>
                <thead><tr><th>${escapeHtml(t('external_accounting.col_payee'))}</th><th>${escapeHtml(t('external_accounting.col_category'))}</th><th class="center">${escapeHtml(t('external_accounting.col_txns_count'))}</th><th class="center">${escapeHtml(t('external_accounting.col_last_date'))}</th><th class="right">${escapeHtml(t('external_accounting.col_amount'))}</th></tr></thead>
                <tbody>
                  ${entRows}
                  <tr class="summary-row"><td colspan="4">${escapeHtml(t('external_accounting.totals_label'))}</td><td class="right mono">${escapeHtml(formatCurrency(reportData.entitySummary.grandTotal))}</td></tr>
                </tbody>
              </table>
            `
        } else if (reportType === 'general_ledger' && reportData.generalLedger) {
            contentHtml = (reportData.generalLedger || []).map((acct: any) => `
              <div style="margin-bottom: 14px;">
                <div style="font-weight: 800; font-size: 11px; padding: 4px 0; border-bottom: 1.5px solid #0f172a; display: flex; justify-content: space-between;">
                  <span>${escapeHtml(acct.account_name)}</span>
                  <span class="mono">Debit: ${escapeHtml(formatCurrency(acct.total_debit))} · Credit: ${escapeHtml(formatCurrency(acct.total_credit))}</span>
                </div>
                <table>
                  <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th>Name</th><th>Memo</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead>
                  <tbody>
                    ${(acct.entries || []).map((e: any) => `
                      <tr>
                        <td class="mono">${escapeHtml(e.date)}</td>
                        <td>${escapeHtml(e.type)}</td>
                        <td class="mono">${escapeHtml(e.doc || '—')}</td>
                        <td>${escapeHtml(e.name || '—')}</td>
                        <td>${escapeHtml(e.memo || '—')}</td>
                        <td class="right mono">${e.debit ? escapeHtml(formatCurrency(e.debit)) : ''}</td>
                        <td class="right mono">${e.credit ? escapeHtml(formatCurrency(e.credit)) : ''}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `).join('')
        } else if (reportType === 'qbo_archive' && reportData.archiveReport) {
            const cols: string[] = reportData.archiveReport.columns || []
            contentHtml = `
              <table>
                <thead><tr>${cols.map((c, i) => `<th class="${i === 0 ? '' : 'right'}">${escapeHtml(c)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${(reportData.archiveReport.rows || []).map((r: any) => `
                    <tr class="${r.rowType === 'summary' ? 'summary-row' : r.rowType === 'section_header' ? 'section-row' : ''}">
                      ${(r.cells || []).map((cell: string, ci: number) => `<td class="${ci === 0 ? '' : 'right mono'}" style="${ci === 0 ? `padding-left:${6 + (r.depth || 0) * 12}px` : ''}">${escapeHtml(cell)}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `
        } else if (reportType === 'bank_register' && reportData.bankRegister) {
            const rows = reportData.bankRegister.rows || []
            contentHtml = `
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th>Payee</th><th>Category</th><th class="right">Payment</th><th class="right">Deposit</th><th class="right">Balance</th></tr></thead>
                <tbody>
                  ${rows.map((r: any) => `
                    <tr>
                      <td class="mono">${escapeHtml(r.txn_date)}</td>
                      <td>${escapeHtml(r.txn_type)}</td>
                      <td class="mono">${escapeHtml(r.doc_number || '—')}</td>
                      <td><strong>${escapeHtml(r.entity_name || '—')}</strong></td>
                      <td>${escapeHtml(r.category_summary || '—')}</td>
                      <td class="right mono">${r.outflow ? escapeHtml(formatCurrency(r.outflow)) : '—'}</td>
                      <td class="right mono">${r.inflow ? escapeHtml(formatCurrency(r.inflow)) : '—'}</td>
                      <td class="right mono"><strong>${escapeHtml(formatCurrency(r.running_balance || 0))}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `
        } else {
            const rows = reportData?.bankRegister?.rows || reportData?.detailReport?.rows || []
            contentHtml = `
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th>Payee</th><th>Category</th><th class="right">Amount</th></tr></thead>
                <tbody>
                  ${rows.map((r: any) => `
                    <tr>
                      <td class="mono">${escapeHtml(r.txn_date)}</td>
                      <td>${escapeHtml(r.txn_type)}</td>
                      <td class="mono">${escapeHtml(r.doc_number || '—')}</td>
                      <td><strong>${escapeHtml(r.entity_name || '—')}</strong></td>
                      <td>${escapeHtml(r.category_summary || '—')}</td>
                      <td class="right mono"><strong>${escapeHtml(formatCurrency(r.total_amount ?? (r.inflow || r.outflow)))}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `
        }

        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(docTitle)}</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.accounting_basis'))}:</strong> ${escapeHtml(reportBasis)}</div>
              <div><strong>${escapeHtml(t('external_accounting.date_range_label'))}:</strong> ${escapeHtml(periodLabel)}</div>
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>
          ${contentHtml}
        `

        if (!openCleanPrintWindow(`${compName}_${reportType}`, bodyHtml, reportType === 'pnl' || reportType === 'qbo_archive' || reportType === 'bank_register')) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    // Helper: Generate a formatted Microsoft Excel (.xls) workbook with styles and numeric formatting
    const downloadStyledExcelXls = (fileBaseName: string, companyTitle: string, reportTitle: string, subtitleText: string, tableHtml: string) => {
        const xlsHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body { font-family: Arial, Calibri, sans-serif; font-size: 10pt; color: #0f172a; }
  table { border-collapse: collapse; width: 100%; }
  th { background-color: #0f172a; color: #ffffff; font-weight: bold; padding: 6px 8px; border: 1px solid #cbd5e1; text-align: left; }
  th.right { text-align: right; }
  td { padding: 5px 8px; border: 1px solid #e2e8f0; vertical-align: middle; }
  td.num { text-align: right; mso-number-format:"\\#\\,\\#\\#0\\.00"; font-family: Consolas, monospace; }
  td.bold-num { text-align: right; font-weight: bold; mso-number-format:"\\#\\,\\#\\#0\\.00"; font-family: Consolas, monospace; }
  tr.group-header td { background-color: #f1f5f9; font-weight: bold; color: #0f172a; border-top: 2px solid #94a3b8; }
  tr.beg-bal td { background-color: #f8fafc; font-style: italic; font-weight: bold; color: #334155; }
  tr.subtotal-row td { background-color: #ecfdf5; font-weight: bold; border-top: 1.5px solid #059669; border-bottom: 1.5px solid #059669; }
  tr.grand-total td { background-color: #0f172a; color: #ffffff; font-weight: bold; border-top: 2px solid #0f172a; }
</style>
</head>
<body>
  <div style="font-size:14pt; font-weight:bold;">${escapeHtml(companyTitle)}</div>
  <div style="font-size:12pt; font-weight:bold; color:#059669;">${escapeHtml(reportTitle)}</div>
  <div style="font-size:9pt; color:#475569; margin-bottom:10px;">${escapeHtml(subtitleText)}</div>
  ${tableHtml}
</body>
</html>`
        const blob = new Blob(['\uFEFF' + xlsHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${fileBaseName}_${new Date().toISOString().slice(0, 10)}.xls`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Export current transactions to CSV
    const exportTransactionsCsv = () => {
        const headers = ['Date', 'Type', 'Doc_No', 'Payee_Customer', 'Bank_Account', 'GL_Category', 'Memo', 'Payment', 'Deposit', 'Total_Amount', 'Status']
        const rows = transactions.map(r => {
            const isOutflow = ['Check', 'Expense', 'Bill', 'BillPayment', 'VendorCredit'].includes(r.txn_type)
            const isInflow = ['Deposit', 'Invoice', 'Payment', 'SalesReceipt', 'CreditMemo'].includes(r.txn_type)
            return [
                r.txn_date || '',
                r.txn_type || '',
                `"${(r.doc_number || '').replace(/"/g, '""')}"`,
                `"${(r.entity_name || '').replace(/"/g, '""')}"`,
                `"${(r.account_name || '').replace(/"/g, '""')}"`,
                `"${(r.category_summary || '').replace(/"/g, '""')}"`,
                `"${(r.memo || '').replace(/"/g, '""')}"`,
                isOutflow ? Number(r.total_amount || 0).toFixed(2) : '',
                isInflow ? Number(r.total_amount || 0).toFixed(2) : '',
                Number(r.total_amount || 0).toFixed(2),
                r.cleared_status || 'Cleared'
            ].join(',')
        })
        const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${(activeCompany?.company_name || 'Company').replace(/\s+/g, '_')}_Transactions_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Export current transactions to Excel (.XLS)
    const exportTransactionsXls = () => {
        const compTitle = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const compSafe = (activeCompany?.company_name || 'Company').replace(/\s+/g, '_')
        const rowsHtml = transactions.map(r => {
            const isOutflow = ['Check', 'Expense', 'Bill', 'BillPayment', 'VendorCredit'].includes(r.txn_type)
            const isInflow = ['Deposit', 'Invoice', 'Payment', 'SalesReceipt', 'CreditMemo'].includes(r.txn_type)
            const amt = Number(r.total_amount || 0)
            return `<tr>
              <td>${escapeHtml(r.txn_date || '')}</td>
              <td>${escapeHtml(r.txn_type || '')}</td>
              <td>${escapeHtml(r.doc_number || '')}</td>
              <td>${escapeHtml(r.entity_name || '')}</td>
              <td>${escapeHtml(r.account_name || '')}</td>
              <td>${escapeHtml(r.category_summary || '')}</td>
              <td>${escapeHtml(r.memo || '')}</td>
              <td class="num">${isOutflow ? amt.toFixed(2) : ''}</td>
              <td class="num">${isInflow ? amt.toFixed(2) : ''}</td>
              <td class="bold-num">${amt.toFixed(2)}</td>
              <td>${escapeHtml(r.cleared_status || 'Cleared')}</td>
            </tr>`
        }).join('')
        const tableHtml = `<table>
          <thead><tr><th>Date</th><th>Type</th><th>Num</th><th>Name</th><th>Account</th><th>Category / Split</th><th>Memo</th><th class="right">Payment</th><th class="right">Deposit</th><th class="right">Amount</th><th>Status</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`
        downloadStyledExcelXls(`${compSafe}_Transactions`, compTitle, 'Bank & General Ledger Transactions', `${startDate || 'All Dates'} — ${endDate || 'Present'}`, tableHtml)
    }

    // Export active CPA report to Excel (.XLS)
    const exportActiveReportXls = () => {
        if (!reportData) {
            exportTransactionsXls()
            return
        }
        const compTitle = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const compSafe = (activeCompany?.company_name || 'Company').replace(/\s+/g, '_')
        const periodLabel = `${reportBasis} · ${startDate || 'All Dates'} — ${endDate || 'Present'}`
        let tableHtml = ''

        if (reportType === 'pnl' && reportData.pnl) {
            const years: string[] = reportData.pnl.years || []
            const showYrs = years.length > 1
            tableHtml = `<table>
              <thead><tr><th>Account / Category</th>${showYrs ? years.map(y => `<th class="right">${escapeHtml(y)}</th>`).join('') : ''}<th class="right">Total</th></tr></thead>
              <tbody>
                <tr class="group-header"><td colspan="${showYrs ? years.length + 2 : 2}">Income</td></tr>
                ${(reportData.pnl.incomeRows || []).map((r: any) => `<tr><td>${escapeHtml(r.category)}</td>${showYrs ? years.map(y => `<td class="num">${Number(r.byYear?.[y] || 0).toFixed(2)}</td>`).join('') : ''}<td class="bold-num">${Number(r.amount || 0).toFixed(2)}</td></tr>`).join('')}
                <tr class="subtotal-row"><td>Total Income</td>${showYrs ? years.map(y => `<td class="bold-num">${Number(reportData.pnl.incomeByYear?.[y] || 0).toFixed(2)}</td>`).join('') : ''}<td class="bold-num">${Number(reportData.pnl.totalIncome || 0).toFixed(2)}</td></tr>
                <tr class="group-header"><td colspan="${showYrs ? years.length + 2 : 2}">Expenses</td></tr>
                ${(reportData.pnl.expenseRows || []).map((r: any) => `<tr><td>${escapeHtml(r.category)}</td>${showYrs ? years.map(y => `<td class="num">${Number(r.byYear?.[y] || 0).toFixed(2)}</td>`).join('') : ''}<td class="bold-num">${Number(r.amount || 0).toFixed(2)}</td></tr>`).join('')}
                <tr class="subtotal-row"><td>Total Expenses</td>${showYrs ? years.map(y => `<td class="bold-num">${Number(reportData.pnl.expenseByYear?.[y] || 0).toFixed(2)}</td>`).join('') : ''}<td class="bold-num">${Number(reportData.pnl.totalExpenses || 0).toFixed(2)}</td></tr>
                <tr class="grand-total"><td colspan="${showYrs ? years.length + 1 : 1}">Net Income</td><td class="bold-num">${Number(reportData.pnl.netIncome || 0).toFixed(2)}</td></tr>
              </tbody>
            </table>`
        } else if (reportType === 'balance_sheet' && reportData.balanceSheet) {
            const bs = reportData.balanceSheet
            const renderGroupXls = (rows: any[]) => (rows || []).map((a: any) => `<tr><td style="padding-left:${a.is_sub_account ? '22px' : '8px'};">${escapeHtml(a.name)}</td><td>${escapeHtml(a.account_type || '')}</td><td class="num">${Number(a.current_balance || 0).toFixed(2)}</td></tr>`).join('')
            tableHtml = `<table>
              <thead><tr><th>Account</th><th>Type</th><th class="right">Total</th></tr></thead>
              <tbody>
                <tr class="group-header"><td colspan="3">Assets</td></tr>
                <tr class="group-header"><td colspan="3">Current Assets</td></tr>
                <tr class="group-header"><td colspan="3">Bank Accounts</td></tr>
                ${renderGroupXls(bs.bankAccounts)}
                <tr class="subtotal-row"><td colspan="2">Total Bank Accounts</td><td class="bold-num">${Number(bs.totalBankAccounts ?? 0).toFixed(2)}</td></tr>
                ${(bs.accountsReceivable?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Accounts Receivable</td></tr>${renderGroupXls(bs.accountsReceivable)}<tr class="subtotal-row"><td colspan="2">Total Accounts Receivable</td><td class="bold-num">${Number(bs.totalAccountsReceivable ?? 0).toFixed(2)}</td></tr>` : ''}
                ${(bs.otherCurrentAssets?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Other Current Assets</td></tr>${renderGroupXls(bs.otherCurrentAssets)}<tr class="subtotal-row"><td colspan="2">Total Other Current Assets</td><td class="bold-num">${Number(bs.totalOtherCurrentAssets ?? 0).toFixed(2)}</td></tr>` : ''}
                <tr class="subtotal-row"><td colspan="2">Total Current Assets</td><td class="bold-num">${Number(bs.totalCurrentAssets ?? bs.totalAssets ?? 0).toFixed(2)}</td></tr>
                ${(bs.fixedAssets?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Fixed Assets</td></tr>${renderGroupXls(bs.fixedAssets)}<tr class="subtotal-row"><td colspan="2">Total Fixed Assets</td><td class="bold-num">${Number(bs.totalFixedAssets ?? 0).toFixed(2)}</td></tr>` : ''}
                ${(bs.otherAssets?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Other Assets</td></tr>${renderGroupXls(bs.otherAssets)}<tr class="subtotal-row"><td colspan="2">Total Other Assets</td><td class="bold-num">${Number(bs.totalOtherAssets ?? 0).toFixed(2)}</td></tr>` : ''}
                <tr class="grand-total"><td colspan="2">TOTAL ASSETS</td><td class="bold-num">${Number(bs.totalAssets || 0).toFixed(2)}</td></tr>
                <tr class="group-header"><td colspan="3">Liabilities and Equity</td></tr>
                ${(bs.accountsPayable?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Accounts Payable</td></tr>${renderGroupXls(bs.accountsPayable)}<tr class="subtotal-row"><td colspan="2">Total Accounts Payable</td><td class="bold-num">${Number(bs.totalAccountsPayable ?? 0).toFixed(2)}</td></tr>` : ''}
                ${(bs.creditCards?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Credit Cards</td></tr>${renderGroupXls(bs.creditCards)}<tr class="subtotal-row"><td colspan="2">Total Credit Cards</td><td class="bold-num">${Number(bs.totalCreditCards ?? 0).toFixed(2)}</td></tr>` : ''}
                ${(bs.otherCurrentLiabilities?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Other Current Liabilities</td></tr>${renderGroupXls(bs.otherCurrentLiabilities)}<tr class="subtotal-row"><td colspan="2">Total Other Current Liabilities</td><td class="bold-num">${Number(bs.totalOtherCurrentLiabilities ?? 0).toFixed(2)}</td></tr>` : ''}
                ${(bs.longTermLiabilities?.length || 0) > 0 ? `<tr class="group-header"><td colspan="3">Long-Term Liabilities</td></tr>${renderGroupXls(bs.longTermLiabilities)}<tr class="subtotal-row"><td colspan="2">Total Long-Term Liabilities</td><td class="bold-num">${Number(bs.totalLongTermLiabilities ?? 0).toFixed(2)}</td></tr>` : ''}
                <tr class="subtotal-row"><td colspan="2">Total Liabilities</td><td class="bold-num">${Number(bs.totalLiabilities || 0).toFixed(2)}</td></tr>
                <tr class="group-header"><td colspan="3">Equity</td></tr>
                ${renderGroupXls(bs.equity)}
                <tr><td>Net Income / Retained Earnings</td><td>Equity</td><td class="num">${Number(bs.retainedNetIncome || 0).toFixed(2)}</td></tr>
                <tr class="subtotal-row"><td colspan="2">Total Equity</td><td class="bold-num">${Number(bs.totalEquity ?? (Number(bs.statedEquity || 0) + Number(bs.retainedNetIncome || 0))).toFixed(2)}</td></tr>
                <tr class="grand-total"><td colspan="2">TOTAL LIABILITIES AND EQUITY</td><td class="bold-num">${Number(bs.totalLiabilitiesAndEquity || 0).toFixed(2)}</td></tr>
              </tbody>
            </table>`
        } else if (reportType === 'trial_balance' && reportData.trialBalance) {
            tableHtml = `<table>
              <thead><tr><th>Account</th><th>Type</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead>
              <tbody>
                ${(reportData.trialBalance.rows || []).map((r: any) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.account_type || '')}</td><td class="num">${Number(r.debit || 0).toFixed(2)}</td><td class="num">${Number(r.credit || 0).toFixed(2)}</td></tr>`).join('')}
                <tr class="grand-total"><td colspan="2">TOTAL</td><td class="bold-num">${Number(reportData.trialBalance.totalDebit || 0).toFixed(2)}</td><td class="bold-num">${Number(reportData.trialBalance.totalCredit || 0).toFixed(2)}</td></tr>
              </tbody>
            </table>`
        } else if ((reportType === 'vendor_expenses' || reportType === 'customer_income') && reportData.entitySummary) {
            tableHtml = `<table>
              <thead><tr><th>Name</th><th>Categories</th><th>Transactions</th><th>Last Date</th><th class="right">Total Amount</th></tr></thead>
              <tbody>
                ${(reportData.entitySummary.rows || []).map((r: any) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.categories || '')}</td><td>${r.count || 0}</td><td>${escapeHtml(r.last_date || '')}</td><td class="bold-num">${Number(r.total_amount || 0).toFixed(2)}</td></tr>`).join('')}
                <tr class="grand-total"><td colspan="4">TOTAL</td><td class="bold-num">${Number(reportData.entitySummary.grandTotal || 0).toFixed(2)}</td></tr>
              </tbody>
            </table>`
        } else if (reportType === 'general_ledger' && reportData.generalLedger) {
            tableHtml = `<table>
              <thead><tr><th>Account</th><th>Date</th><th>Type</th><th>Num</th><th>Name</th><th>Memo</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead>
              <tbody>
                ${(reportData.generalLedger || []).map((acct: any) => `
                  <tr class="group-header"><td colspan="6">${escapeHtml(acct.account_name)}</td><td class="bold-num">${Number(acct.total_debit || 0).toFixed(2)}</td><td class="bold-num">${Number(acct.total_credit || 0).toFixed(2)}</td></tr>
                  ${(acct.entries || []).map((e: any) => `<tr><td>${escapeHtml(acct.account_name)}</td><td>${escapeHtml(e.date || '')}</td><td>${escapeHtml(e.type || '')}</td><td>${escapeHtml(e.doc || '')}</td><td>${escapeHtml(e.name || '')}</td><td>${escapeHtml(e.memo || '')}</td><td class="num">${Number(e.debit || 0).toFixed(2)}</td><td class="num">${Number(e.credit || 0).toFixed(2)}</td></tr>`).join('')}
                `).join('')}
              </tbody>
            </table>`
        } else if (reportType === 'qbo_archive' && reportData.archiveReport) {
            const cols: string[] = reportData.archiveReport.columns || []
            tableHtml = `<table>
              <thead><tr>${cols.map((c, i) => `<th class="${i === 0 ? '' : 'right'}">${escapeHtml(c)}</th>`).join('')}</tr></thead>
              <tbody>
                ${(reportData.archiveReport.rows || []).map((r: any) => `<tr class="${r.rowType === 'summary' ? 'subtotal-row' : r.rowType === 'section_header' ? 'group-header' : ''}">${(r.cells || []).map((cell: string, ci: number) => `<td class="${ci === 0 ? '' : 'num'}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>`
        } else {
            const rows = reportData?.bankRegister?.rows || reportData?.detailReport?.rows || []
            tableHtml = `<table>
              <thead><tr><th>Date</th><th>Type</th><th>Num</th><th>Name</th><th>Category</th><th>Memo</th><th class="right">Payment</th><th class="right">Deposit</th><th class="right">Balance / Amount</th></tr></thead>
              <tbody>
                ${rows.map((r: any) => `<tr><td>${escapeHtml(r.txn_date || '')}</td><td>${escapeHtml(r.txn_type || '')}</td><td>${escapeHtml(r.doc_number || '')}</td><td>${escapeHtml(r.entity_name || '')}</td><td>${escapeHtml(r.category_summary || '')}</td><td>${escapeHtml(r.memo || '')}</td><td class="num">${Number(r.outflow || 0).toFixed(2)}</td><td class="num">${Number(r.inflow || 0).toFixed(2)}</td><td class="bold-num">${Number(r.running_balance ?? r.total_amount ?? 0).toFixed(2)}</td></tr>`).join('')}
              </tbody>
            </table>`
        }

        downloadStyledExcelXls(`${compSafe}_Report_${reportType}`, compTitle, reportType.toUpperCase(), periodLabel, tableHtml)
    }

    // Export active CPA report to CSV
    const exportActiveReportCsv = () => {
        if (!reportData) return
        const compName = (activeCompany?.company_name || 'Company').replace(/\s+/g, '_')
        let csv = ''
        if (reportType === 'pnl' && reportData.pnl) {
            const years: string[] = reportData.pnl.years || []
            csv += ['Category', 'Section', ...years, 'Total'].join(',') + '\n'
            for (const row of (reportData.pnl.incomeRows || [])) {
                csv += [`"${(row.category || row.account_name || '').replace(/"/g, '""')}"`, 'Income', ...years.map(y => Number(row.byYear?.[y] || 0).toFixed(2)), Number(row.amount ?? row.total ?? 0).toFixed(2)].join(',') + '\n'
            }
            for (const row of (reportData.pnl.expenseRows || [])) {
                csv += [`"${(row.category || row.account_name || '').replace(/"/g, '""')}"`, 'Expense', ...years.map(y => Number(row.byYear?.[y] || 0).toFixed(2)), Number(row.amount ?? row.total ?? 0).toFixed(2)].join(',') + '\n'
            }
        } else if (reportType === 'balance_sheet' && reportData.balanceSheet) {
            csv += 'Section,Account_No,Account_Name,Type,Balance\n'
            for (const a of (reportData.balanceSheet.assets || [])) {
                csv += `Asset,"${a.acct_num || ''}","${(a.name || '').replace(/"/g, '""')}","${a.account_type || ''}",${Number(a.current_balance || 0).toFixed(2)}\n`
            }
            csv += `Asset_Total,"","Total Bank Accounts","Bank",${Number(reportData.balanceSheet.totalBankAccounts || 0).toFixed(2)}\n`
            csv += `Asset_Total,"","Total Current Assets","Current Assets",${Number(reportData.balanceSheet.totalCurrentAssets || 0).toFixed(2)}\n`
            csv += `Asset_Total,"","Total Fixed Assets","Fixed Assets",${Number(reportData.balanceSheet.totalFixedAssets || 0).toFixed(2)}\n`
            csv += `Asset_Total,"","TOTAL ASSETS","Asset",${Number(reportData.balanceSheet.totalAssets || 0).toFixed(2)}\n`
            for (const a of (reportData.balanceSheet.liabilities || [])) {
                csv += `Liability,"${a.acct_num || ''}","${(a.name || '').replace(/"/g, '""')}","${a.account_type || ''}",${Number(a.current_balance || 0).toFixed(2)}\n`
            }
            csv += `Liability_Total,"","Total Liabilities","Liability",${Number(reportData.balanceSheet.totalLiabilities || 0).toFixed(2)}\n`
            for (const a of (reportData.balanceSheet.equity || [])) {
                csv += `Equity,"${a.acct_num || ''}","${(a.name || '').replace(/"/g, '""')}","${a.account_type || ''}",${Number(a.current_balance || 0).toFixed(2)}\n`
            }
            csv += `Equity,"","Retained Earnings / Net Income","Equity",${Number(reportData.balanceSheet.retainedNetIncome || 0).toFixed(2)}\n`
            csv += `Grand_Total,"","TOTAL LIABILITIES AND EQUITY","Total",${Number(reportData.balanceSheet.totalLiabilitiesAndEquity || 0).toFixed(2)}\n`
        } else if (reportType === 'trial_balance' && reportData.trialBalance) {
            csv += 'Account_No,Account_Name,Type,Debit,Credit\n'
            for (const r of (reportData.trialBalance.rows || [])) {
                csv += `"${r.acct_num || ''}","${(r.name || '').replace(/"/g, '""')}","${r.account_type || ''}",${Number(r.debit || 0).toFixed(2)},${Number(r.credit || 0).toFixed(2)}\n`
            }
        } else if (reportType === 'bank_register' && reportData.bankRegister) {
            csv += 'Date,Type,Doc_No,Payee,GL_Category,Memo,Payment,Deposit,Running_Balance\n'
            for (const r of (reportData.bankRegister.rows || [])) {
                csv += `${r.txn_date || ''},${r.txn_type || ''},"${r.doc_number || ''}","${(r.entity_name || '').replace(/"/g, '""')}","${(r.category_summary || '').replace(/"/g, '""')}","${(r.memo || '').replace(/"/g, '""')}",${Number(r.outflow ?? r.payment ?? 0).toFixed(2)},${Number(r.inflow ?? r.deposit ?? 0).toFixed(2)},${Number(r.running_balance || 0).toFixed(2)}\n`
            }
        } else if ((reportType === 'vendor_expenses' || reportType === 'customer_income') && reportData.entitySummary) {
            const rows = reportData.entitySummary.rows || []
            csv += 'Name,Categories,Txns_Count,Last_Date,Total_Amount\n'
            for (const r of rows) {
                csv += `"${(r.name || '').replace(/"/g, '""')}","${(r.categories || '').replace(/"/g, '""')}",${r.count || 0},${r.last_date || ''},${Number(r.total_amount || 0).toFixed(2)}\n`
            }
        } else if ((reportType === 'check_detail' || reportType === 'deposit_detail') && reportData.detailReport) {
            const rows = reportData.detailReport.rows || []
            csv += 'Date,Type,Doc_No,Name,Bank_Account,GL_Category,Memo,Amount\n'
            for (const r of rows) {
                csv += `${r.txn_date || ''},${r.txn_type || ''},"${r.doc_number || ''}","${(r.entity_name || '').replace(/"/g, '""')}","${(r.account_name || '').replace(/"/g, '""')}","${(r.category_summary || '').replace(/"/g, '""')}","${(r.memo || '').replace(/"/g, '""')}",${Number(r.total_amount || 0).toFixed(2)}\n`
            }
        } else if (reportType === 'general_ledger' && reportData.generalLedger) {
            csv += 'Account,Date,Type,Doc_No,Name,Memo,Debit,Credit\n'
            for (const acct of (reportData.generalLedger || [])) {
                for (const e of (acct.entries || [])) {
                    csv += `"${(acct.account_name || '').replace(/"/g, '""')}",${e.date || ''},${e.type || ''},"${(e.doc || '').replace(/"/g, '""')}","${(e.name || '').replace(/"/g, '""')}","${(e.memo || '').replace(/"/g, '""')}",${Number(e.debit || 0).toFixed(2)},${Number(e.credit || 0).toFixed(2)}\n`
                }
            }
        } else if (reportType === 'qbo_archive' && reportData.archiveReport) {
            const cols: string[] = reportData.archiveReport.columns || []
            csv += cols.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',') + '\n'
            for (const r of (reportData.archiveReport.rows || [])) {
                csv += (r.cells || []).map((cell: string) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',') + '\n'
            }
        } else {
            exportTransactionsCsv()
            return
        }
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${compName}_Report_${reportType}_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // ── Drill-Down Transaction Detail Report (Profit & Loss / Balance Sheet / Chart of Accounts / Lists / Contacts) ──
    const buildGroupsFromFlatRows = (rows: any[], defaultTitle: string, isBalanceSheet = false, defaultBegBal = 0) => {
        const byAcc = new Map<string, any[]>()
        for (const r of rows) {
            const accKey = String(r.group_account_name || r.account_name || defaultTitle || 'Account')
            const list = byAcc.get(accKey) || []
            list.push(r)
            byAcc.set(accKey, list)
        }
        if (byAcc.size === 0) {
            const beg = Number(Number(defaultBegBal || 0).toFixed(2))
            return [{
                account_id: defaultTitle,
                account_name: defaultTitle,
                account_type: isBalanceSheet ? 'Asset' : 'Account',
                is_balance_sheet: isBalanceSheet,
                beginning_balance: beg,
                period_net_change: 0,
                ending_balance: beg,
                transactions: [],
            }]
        }
        const groups: Array<{
            account_id: string
            account_name: string
            account_type?: string
            is_balance_sheet?: boolean
            beginning_balance: number
            period_net_change: number
            ending_balance: number
            transactions: any[]
        }> = []
        for (const [accName, txList] of byAcc.entries()) {
            const beg = byAcc.size === 1 ? Number(Number(defaultBegBal || 0).toFixed(2)) : 0
            let run = beg
            const normalized = txList.map(tx => {
                const amt = Number(tx.amount ?? tx.total_amount ?? 0)
                run += amt
                return {
                    ...tx,
                    amount: Number(amt.toFixed(2)),
                    running_balance: Number(run.toFixed(2)),
                    account_name: tx.account_name || accName,
                    split_account: tx.split_account || tx.to_account_name || tx.category_summary || '—',
                }
            })
            const net = Number((run - beg).toFixed(2))
            groups.push({
                account_id: accName,
                account_name: accName,
                account_type: isBalanceSheet ? 'Asset' : 'Account',
                is_balance_sheet: isBalanceSheet,
                beginning_balance: beg,
                period_net_change: net,
                ending_balance: Number(run.toFixed(2)),
                transactions: normalized,
            })
        }
        return groups
    }

    const openPnlDrilldownReport = (
        rowOrTitle: any,
        sectionOrTxns?: any,
        yearFilterOrTotal?: any,
        subtitleExtra?: string
    ) => {
        const isRowObject = typeof rowOrTitle === 'object' && rowOrTitle !== null
        const rowTitle: string = isRowObject
            ? String(rowOrTitle.category || rowOrTitle.name || 'Account')
            : String(rowOrTitle || 'Account')
        const yearFilter: string | undefined = isRowObject && typeof yearFilterOrTotal === 'string'
            ? yearFilterOrTotal
            : undefined
        const rawTxnsSource: any[] = isRowObject
            ? (Array.isArray(rowOrTitle.transactions) ? rowOrTitle.transactions : [])
            : (Array.isArray(sectionOrTxns) ? sectionOrTxns : [])
        const rawTxns = yearFilter
            ? rawTxnsSource.filter(tx => String(tx.txn_date || '').startsWith(yearFilter))
            : rawTxnsSource
        const totalAmt: number = isRowObject
            ? (yearFilter && rowOrTitle.byYear?.[yearFilter] != null
                ? Number(rowOrTitle.byYear[yearFilter])
                : Number(rowOrTitle.amount || 0))
            : Number(yearFilterOrTotal || 0)

        const sorted = [...(rawTxns || [])].sort((a, b) => {
            const dtCmp = String(a.txn_date || '').localeCompare(String(b.txn_date || ''))
            if (dtCmp !== 0) return dtCmp
            return Number(a.id || 0) - Number(b.id || 0)
        })
        let runBal = 0
        const normalizedRows = sorted.map(tx => {
            const amt = Number(tx.amount ?? tx.total_amount ?? 0)
            runBal += amt
            return {
                ...tx,
                amount: Number(amt.toFixed(2)),
                running_balance: Number(runBal.toFixed(2)),
                account_name: tx.account_name || rowTitle,
                split_account: tx.split_account || tx.to_account_name || tx.category_summary || '—',
                location_name: tx.location_name || tx.department_name || '',
                department_name: tx.department_name || tx.location_name || '',
                class_name: tx.class_name || '',
            }
        })
        const computedSum = normalizedRows.length > 0
            ? Number(runBal.toFixed(2))
            : Number(Number(totalAmt || 0).toFixed(2))
        const periodStr = yearFilter
            ? `FY ${yearFilter}`
            : `${startDate || t('external_accounting.period_all_dates')} — ${endDate || 'Present'}`
        const groups = buildGroupsFromFlatRows(normalizedRows, rowTitle, false, 0)
        setDrilldownSearch('')
        setCollapsedDrilldownGroups({})
        setDrilldownReportModal({
            title: yearFilter ? `${rowTitle} (${yearFilter})` : rowTitle,
            subtitle: subtitleExtra || `${activeCompany?.legal_name || activeCompany?.company_name || ''} · ${reportBasis} · ${periodStr}`,
            basis: reportBasis,
            periodLabel: periodStr,
            sectionType: isRowObject && typeof sectionOrTxns === 'string' ? sectionOrTxns : 'Account',
            totalBeginningBalance: 0,
            totalAmount: computedSum,
            totalEndingBalance: computedSum,
            groups,
            rows: normalizedRows,
            loading: false,
        })
    }

    const openAccountQuickReport = async (
        accountOrQbId: any,
        accountNameArg?: string,
        accountObjArg?: any
    ) => {
        const isAccObject = typeof accountOrQbId === 'object' && accountOrQbId !== null
        const accountObj = isAccObject ? accountOrQbId : accountObjArg
        const accountQbId = isAccObject
            ? (accountOrQbId.qb_account_id ?? accountOrQbId.account_id ?? '')
            : accountOrQbId
        const accountName = isAccObject
            ? String(accountOrQbId.name || accountOrQbId.fully_qualified_name || 'Account')
            : String(accountNameArg || 'Account')

        const periodStr = `${startDate || t('external_accounting.period_all_dates')} — ${endDate || 'Present'}`
        setDrilldownSearch('')
        setCollapsedDrilldownGroups({})
        setDrilldownReportModal({
            title: accountName,
            subtitle: `${t('external_accounting.drilldown_report_title')} · ${activeCompany?.company_name || ''}`,
            basis: reportBasis,
            periodLabel: periodStr,
            totalBeginningBalance: 0,
            totalAmount: Number(accountObj?.current_balance || 0),
            totalEndingBalance: Number(accountObj?.current_balance || 0),
            groups: [],
            rows: [],
            loading: true,
            accountObj,
        })
        try {
            const params = new URLSearchParams({
                realmId: activeRealmId,
                reportType: 'account_quickreport',
                basis: reportBasis,
                accountId: accountQbId ? String(accountQbId) : 'ALL',
                accountName: accountName || '',
            })
            if (startDate) params.set('startDate', startDate)
            if (endDate) params.set('endDate', endDate)
            const res = await authFetch(`/api/external-accounting/reports?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error loading transaction report')
            const qr = json.quickReport || json || {}
            const groups = Array.isArray(qr.groups) && qr.groups.length > 0
                ? qr.groups
                : buildGroupsFromFlatRows(qr.rows || [], qr.title || accountName, true, Number(qr.totalBeginningBalance ?? 0))
            setDrilldownReportModal({
                title: qr.title || accountName,
                subtitle: `${t('external_accounting.drilldown_report_title')} · ${activeCompany?.company_name || ''}`,
                basis: reportBasis,
                periodLabel: periodStr,
                totalBeginningBalance: Number(qr.totalBeginningBalance ?? 0),
                totalAmount: Number(qr.totalAmount ?? 0),
                totalEndingBalance: Number(qr.totalEndingBalance ?? qr.totalAmount ?? 0),
                groups,
                rows: qr.rows || [],
                loading: false,
                accountObj,
            })
        } catch (err: any) {
            notify('err', err.message || 'Error')
            setDrilldownReportModal(prev => prev ? { ...prev, loading: false } : null)
        }
    }

    const openListOrContactQuickReport = async (
        filterType: 'item' | 'location' | 'class' | 'payment_method' | 'term' | 'contact',
        filterValue: string,
        filterId?: string | number,
        displayTitle?: string
    ) => {
        const periodStr = `${startDate || t('external_accounting.period_all_dates')} — ${endDate || 'Present'}`
        const titleLabel = displayTitle || filterValue || 'Transactions'
        setDrilldownSearch('')
        setCollapsedDrilldownGroups({})
        setDrilldownReportModal({
            title: titleLabel,
            subtitle: `${t('external_accounting.drilldown_report_title')} · ${activeCompany?.company_name || ''}`,
            basis: reportBasis,
            periodLabel: periodStr,
            totalBeginningBalance: 0,
            totalAmount: 0,
            totalEndingBalance: 0,
            groups: [],
            rows: [],
            loading: true,
        })
        try {
            const params = new URLSearchParams({
                realmId: activeRealmId,
                reportType: 'account_quickreport',
                basis: reportBasis,
                filterType,
                filterValue: String(filterValue || ''),
                filterId: filterId != null ? String(filterId) : '',
                accountName: titleLabel,
            })
            if (startDate) params.set('startDate', startDate)
            if (endDate) params.set('endDate', endDate)
            const res = await authFetch(`/api/external-accounting/reports?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error loading transaction report')
            const qr = json.quickReport || json || {}
            const groups = Array.isArray(qr.groups) && qr.groups.length > 0
                ? qr.groups
                : buildGroupsFromFlatRows(qr.rows || [], titleLabel, false, 0)
            setDrilldownReportModal({
                title: qr.title || titleLabel,
                subtitle: `${t('external_accounting.drilldown_report_title')} · ${activeCompany?.company_name || ''}`,
                basis: reportBasis,
                periodLabel: periodStr,
                totalBeginningBalance: Number(qr.totalBeginningBalance ?? 0),
                totalAmount: Number(qr.totalAmount ?? 0),
                totalEndingBalance: Number(qr.totalEndingBalance ?? qr.totalAmount ?? 0),
                groups,
                rows: qr.rows || [],
                loading: false,
            })
        } catch (err: any) {
            notify('err', err.message || 'Error')
            setDrilldownReportModal(prev => prev ? { ...prev, loading: false } : null)
        }
    }

    const filteredDrilldownGroups = useMemo(() => {
        if (!drilldownReportModal) return []
        const rawGroups = Array.isArray(drilldownReportModal.groups) && drilldownReportModal.groups.length > 0
            ? drilldownReportModal.groups
            : buildGroupsFromFlatRows(drilldownReportModal.rows || [], drilldownReportModal.title, false, drilldownReportModal.totalBeginningBalance || 0)
        const q = drilldownSearch.trim().toLowerCase()
        if (!q) return rawGroups
        return rawGroups
            .map(g => {
                const groupNameMatches = String(g.account_name || '').toLowerCase().includes(q)
                const matchedTxns = groupNameMatches
                    ? (g.transactions || [])
                    : (g.transactions || []).filter((r: any) =>
                        `${r.txn_date || ''} ${r.txn_type || ''} ${r.doc_number || ''} ${r.entity_name || ''} ${r.department_name || ''} ${r.class_name || ''} ${r.memo || ''} ${r.account_name || ''} ${r.split_account || ''} ${r.amount || ''}`
                            .toLowerCase()
                            .includes(q)
                    )
                const sumAmt = matchedTxns.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
                return {
                    ...g,
                    transactions: matchedTxns,
                    period_net_change: q ? Number(sumAmt.toFixed(2)) : g.period_net_change,
                    ending_balance: q ? Number((Number(g.beginning_balance || 0) + sumAmt).toFixed(2)) : g.ending_balance,
                }
            })
            .filter(g => g.transactions.length > 0 || String(g.account_name || '').toLowerCase().includes(q))
    }, [drilldownReportModal, drilldownSearch])

    const filteredDrilldownRows = useMemo(() => {
        if (!drilldownReportModal?.rows) return []
        const q = drilldownSearch.trim().toLowerCase()
        if (!q) return drilldownReportModal.rows
        return drilldownReportModal.rows.filter(r =>
            `${r.txn_date || ''} ${r.txn_type || ''} ${r.doc_number || ''} ${r.entity_name || ''} ${r.department_name || ''} ${r.class_name || ''} ${r.memo || ''} ${r.account_name || ''} ${r.split_account || ''} ${r.amount || ''}`
                .toLowerCase()
                .includes(q)
        )
    }, [drilldownReportModal, drilldownSearch])

    const exportDrilldownReportXls = () => {
        if (!drilldownReportModal) return
        const compTitle = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const compSafe = (activeCompany?.company_name || 'Company').replace(/\s+/g, '_')
        const safeTitle = (drilldownReportModal.title || 'Account').replace(/[^a-zA-Z0-9_-]/g, '_')
        const groupsToExport = filteredDrilldownGroups
        const totalNetChange = groupsToExport.reduce((s, g) => s + Number(g.period_net_change || 0), 0)
        const totalEndBal = groupsToExport.reduce((s, g) => s + Number(g.ending_balance || 0), 0)
        const anyBalanceSheet = groupsToExport.some(g => g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0)

        const groupsHtml = groupsToExport.map(g => {
            const countBadge = (g.transactions?.length || 0) + (g.is_balance_sheet ? 1 : 0)
            const begRow = (g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0)
                ? `<tr class="beg-bal">
                    <td><strong>${escapeHtml(t('external_accounting.beginning_balance'))}</strong></td>
                    <td></td><td></td><td></td><td></td><td></td><td></td>
                    <td>${escapeHtml(g.account_name)}</td>
                    <td></td>
                    <td></td>
                    <td class="bold-num">${Number(g.beginning_balance || 0).toFixed(2)}</td>
                  </tr>`
                : ''
            const txRows = (g.transactions || []).map((r: any) => `
                <tr>
                  <td>${escapeHtml(r.txn_date || '')}</td>
                  <td>${escapeHtml(r.txn_type || '')}</td>
                  <td>${escapeHtml(r.doc_number || '')}</td>
                  <td>${escapeHtml(r.entity_name || '')}</td>
                  <td>${escapeHtml(r.location_name || r.department_name || '')}</td>
                  <td>${escapeHtml(r.class_name || '')}</td>
                  <td>${escapeHtml(r.memo || '')}</td>
                  <td>${escapeHtml(r.account_name || g.account_name || '')}</td>
                  <td>${escapeHtml(r.split_account || '')}</td>
                  <td class="num">${Number(r.amount || 0).toFixed(2)}</td>
                  <td class="bold-num">${Number(r.running_balance || 0).toFixed(2)}</td>
                </tr>
            `).join('')
            return `
              <tr class="group-header">
                <td colspan="11">▾ ${escapeHtml(g.account_name)} (${countBadge})</td>
              </tr>
              ${begRow}
              ${txRows}
              <tr class="subtotal-row">
                <td colspan="9">${escapeHtml(t('external_accounting.total_for_account'))} ${escapeHtml(g.account_name)}</td>
                <td class="bold-num">${Number(g.period_net_change || 0).toFixed(2)}</td>
                <td class="bold-num">${(g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0) ? Number(g.ending_balance || 0).toFixed(2) : ''}</td>
              </tr>
            `
        }).join('')

        const tableHtml = `
          <table>
            <thead>
              <tr>
                <th>Transaction Date</th>
                <th>Transaction Type</th>
                <th>Num</th>
                <th>Name</th>
                <th>Location / Property</th>
                <th>Class</th>
                <th>Memo / Description</th>
                <th>Account Name</th>
                <th>Item Split Account</th>
                <th class="right">Amount</th>
                <th class="right">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${groupsHtml}
              <tr class="grand-total">
                <td colspan="9">TOTAL (${filteredDrilldownRows.length} Transactions)</td>
                <td class="bold-num">${totalNetChange.toFixed(2)}</td>
                <td class="bold-num">${anyBalanceSheet ? totalEndBal.toFixed(2) : totalNetChange.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        `
        downloadStyledExcelXls(
            `${compSafe}_TransactionReport_${safeTitle}`,
            compTitle,
            `${t('external_accounting.drilldown_report_title')} — ${drilldownReportModal.title}`,
            drilldownReportModal.subtitle || '',
            tableHtml
        )
    }

    const exportDrilldownReportCsv = () => {
        if (!drilldownReportModal) return
        const compName = (activeCompany?.company_name || 'Company').replace(/\s+/g, '_')
        const safeTitle = (drilldownReportModal.title || 'Account').replace(/[^a-zA-Z0-9_-]/g, '_')
        const headers = [
            'Account_Group',
            'Date',
            'Transaction_Type',
            'Num',
            'Name_Payee_Customer',
            'Location_Property',
            'Class',
            'Memo_Description',
            'Account',
            'Split_Account',
            'Amount',
            'Running_Balance',
        ]
        const csvRows: string[] = []
        for (const g of filteredDrilldownGroups) {
            if (g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0) {
                csvRows.push([
                    `"${String(g.account_name || '').replace(/"/g, '""')}"`,
                    'Beginning Balance',
                    '""',
                    '""',
                    '""',
                    '""',
                    '""',
                    '""',
                    `"${String(g.account_name || '').replace(/"/g, '""')}"`,
                    '""',
                    '',
                    Number(g.beginning_balance || 0).toFixed(2),
                ].join(','))
            }
            for (const r of (g.transactions || [])) {
                csvRows.push([
                    `"${String(g.account_name || '').replace(/"/g, '""')}"`,
                    r.txn_date || '',
                    `"${String(r.txn_type || '').replace(/"/g, '""')}"`,
                    `"${String(r.doc_number || '').replace(/"/g, '""')}"`,
                    `"${String(r.entity_name || '').replace(/"/g, '""')}"`,
                    `"${String(r.department_name || '').replace(/"/g, '""')}"`,
                    `"${String(r.class_name || '').replace(/"/g, '""')}"`,
                    `"${String(r.memo || '').replace(/"/g, '""')}"`,
                    `"${String(r.account_name || '').replace(/"/g, '""')}"`,
                    `"${String(r.split_account || '').replace(/"/g, '""')}"`,
                    Number(r.amount || 0).toFixed(2),
                    Number(r.running_balance || 0).toFixed(2),
                ].join(','))
            }
            csvRows.push([
                `"Total for ${String(g.account_name || '').replace(/"/g, '""')}"`,
                'SUBTOTAL',
                '""',
                '""',
                '""',
                '""',
                '""',
                '""',
                `"${String(g.account_name || '').replace(/"/g, '""')}"`,
                '""',
                Number(g.period_net_change || 0).toFixed(2),
                Number(g.ending_balance || 0).toFixed(2),
            ].join(','))
        }
        const sumVisible = filteredDrilldownGroups.reduce((s, g) => s + Number(g.period_net_change || 0), 0)
        const endVisible = filteredDrilldownGroups.reduce((s, g) => s + Number(g.ending_balance || 0), 0)
        csvRows.push([
            'TOTAL',
            '""',
            '""',
            '""',
            `"${filteredDrilldownRows.length} Transactions"`,
            '""',
            '""',
            '""',
            `"${String(drilldownReportModal.title || '').replace(/"/g, '""')}"`,
            '""',
            sumVisible.toFixed(2),
            endVisible.toFixed(2),
        ].join(','))
        const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${compName}_TransactionReport_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handlePrintDrilldownReportPdf = () => {
        if (!drilldownReportModal) return
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const groupsToPrint = filteredDrilldownGroups
        const sumVisible = groupsToPrint.reduce((s, g) => s + Number(g.period_net_change || 0), 0)
        const begVisible = groupsToPrint.reduce((s, g) => s + Number(g.beginning_balance || 0), 0)
        const endVisible = groupsToPrint.reduce((s, g) => s + Number(g.ending_balance || 0), 0)
        const anyBalanceSheet = groupsToPrint.some(g => g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0)

        const groupedHtmlRows = groupsToPrint.map(g => {
            const countBadge = (g.transactions?.length || 0) + (g.is_balance_sheet ? 1 : 0)
            const begRowHtml = (g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0)
                ? `<tr style="background:#f8fafc; font-weight:700;">
                    <td colspan="8" style="padding-left:16px;">${escapeHtml(t('external_accounting.beginning_balance'))}</td>
                    <td class="right mono"></td>
                    <td class="right mono"><strong>${escapeHtml(formatCurrency(g.beginning_balance || 0))}</strong></td>
                  </tr>`
                : ''
            const txRowsHtml = (g.transactions || []).map((r: any) => `
                <tr>
                  <td class="mono" style="padding-left:16px;">${escapeHtml(r.txn_date || '')}</td>
                  <td>${escapeHtml(r.txn_type || '')}</td>
                  <td class="mono">${escapeHtml(r.doc_number || '—')}</td>
                  <td><strong>${escapeHtml(r.entity_name || '—')}</strong></td>
                  <td>${escapeHtml([r.department_name, r.class_name].filter(Boolean).join(' · ') || '—')}</td>
                  <td>${escapeHtml(r.memo || '—')}</td>
                  <td>${escapeHtml(r.account_name || g.account_name || '—')}</td>
                  <td>${escapeHtml(r.split_account || '—')}</td>
                  <td class="right mono"><strong>${escapeHtml(formatCurrency(r.amount || 0))}</strong></td>
                  <td class="right mono">${escapeHtml(formatCurrency(r.running_balance || 0))}</td>
                </tr>
            `).join('')
            return `
              <tr class="section-row">
                <td colspan="10">▾ ${escapeHtml(g.account_name)} (${countBadge})</td>
              </tr>
              ${begRowHtml}
              ${txRowsHtml}
              <tr class="summary-row">
                <td colspan="8">${escapeHtml(t('external_accounting.total_for_account'))} ${escapeHtml(g.account_name)}</td>
                <td class="right mono">${escapeHtml(formatCurrency(g.period_net_change || 0))}</td>
                <td class="right mono">${(g.is_balance_sheet || Number(g.beginning_balance || 0) !== 0) ? escapeHtml(formatCurrency(g.ending_balance || 0)) : ''}</td>
              </tr>
            `
        }).join('')

        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.drilldown_report_title'))} — ${escapeHtml(drilldownReportModal.title)}</div>
              <div style="font-size:11px; color:#475569; margin-top:2px;">${escapeHtml(drilldownReportModal.subtitle)}</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.accounting_basis'))}:</strong> ${escapeHtml(drilldownReportModal.basis)}</div>
              <div><strong>${escapeHtml(t('external_accounting.date_range_label'))}:</strong> ${escapeHtml(drilldownReportModal.periodLabel)}</div>
              <div><strong>${escapeHtml(t('external_accounting.records_label'))}:</strong> ${filteredDrilldownRows.length}</div>
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>

          <div class="kpi-strip">
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.col_category'))} / Account</div>
              <div class="kpi-val" style="font-size:13px;">${escapeHtml(drilldownReportModal.title)}</div>
            </div>
            ${anyBalanceSheet ? `
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.beginning_balance'))}</div>
              <div class="kpi-val" style="font-size:13px;">${escapeHtml(formatCurrency(begVisible))}</div>
            </div>
            ` : `
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.accounting_basis'))}</div>
              <div class="kpi-val" style="font-size:13px;">${escapeHtml(drilldownReportModal.basis)}</div>
            </div>
            `}
            <div class="kpi-box">
              <div class="kpi-label">NET CHANGE (${filteredDrilldownRows.length} TXNS)</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(sumVisible))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${anyBalanceSheet ? escapeHtml(t('external_accounting.ending_balance_col')) : 'TOTAL AMOUNT'}</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(anyBalanceSheet ? endVisible : sumVisible))}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('external_accounting.col_date'))}</th>
                <th>${escapeHtml(t('external_accounting.col_type'))}</th>
                <th>${escapeHtml(t('external_accounting.col_doc_num'))}</th>
                <th>${escapeHtml(t('external_accounting.col_payee'))}</th>
                <th>${escapeHtml(t('external_accounting.drilldown_col_location'))} / ${escapeHtml(t('external_accounting.drilldown_col_class'))}</th>
                <th>${escapeHtml(t('external_accounting.col_memo'))}</th>
                <th>${escapeHtml(t('external_accounting.col_account'))}</th>
                <th>${escapeHtml(t('external_accounting.drilldown_col_split'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.col_amount'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.drilldown_running_balance'))}</th>
              </tr>
            </thead>
            <tbody>
              ${groupedHtmlRows}
              <tr class="summary-row">
                <td colspan="8">TOTAL (${filteredDrilldownRows.length} TRANSACTIONS)</td>
                <td class="right mono">${escapeHtml(formatCurrency(sumVisible))}</td>
                <td class="right mono">${escapeHtml(formatCurrency(anyBalanceSheet ? endVisible : sumVisible))}</td>
              </tr>
            </tbody>
          </table>
        `
        if (!openCleanPrintWindow(`${compName}_TransactionReport_${drilldownReportModal.title}`, bodyHtml, true)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    const checksList = useMemo(
        () => checkbookTransactions.length > 0
            ? checkbookTransactions
            : transactions.filter(r => r.txn_type === 'Check' || r.txn_type === 'BillPayment'),
        [checkbookTransactions, transactions]
    )
    const depositsList = useMemo(
        () => depositsTransactions.length > 0
            ? depositsTransactions
            : transactions.filter(r => r.txn_type === 'Deposit' || r.txn_type === 'Payment' || r.txn_type === 'SalesReceipt'),
        [depositsTransactions, transactions]
    )

    const filteredAccounts = useMemo(() => {
        const q = accountSearch.trim().toLowerCase()
        if (!q) return accounts
        return accounts.filter(a =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.fully_qualified_name || '').toLowerCase().includes(q) ||
            (a.acct_num || '').toLowerCase().includes(q) ||
            (a.account_type || '').toLowerCase().includes(q) ||
            (a.account_sub_type || '').toLowerCase().includes(q) ||
            (a.classification || '').toLowerCase().includes(q) ||
            (a.raw_data?.Description || '').toLowerCase().includes(q)
        )
    }, [accounts, accountSearch])

    const filteredContacts = useMemo(() => {
        const q = contactSearch.trim().toLowerCase()
        return contacts.filter(c => {
            if (contactFilterType === 'Vendor' && c.contact_type !== 'Vendor') return false
            if (contactFilterType === 'Customer' && c.contact_type !== 'Customer') return false
            if (contactFilterType === '1099' && !c.vendor_1099) return false
            if (!q) return true
            const addrStr = c.address
                ? [c.address.Line1, c.address.City, c.address.CountrySubDivisionCode, c.address.PostalCode].filter(Boolean).join(' ')
                : ''
            return (
                (c.display_name || '').toLowerCase().includes(q) ||
                (c.company_name || '').toLowerCase().includes(q) ||
                (c.print_on_check_name || '').toLowerCase().includes(q) ||
                (c.acct_num || '').toLowerCase().includes(q) ||
                (c.email || '').toLowerCase().includes(q) ||
                (c.phone || '').toLowerCase().includes(q) ||
                (c.tax_identifier || '').toLowerCase().includes(q) ||
                addrStr.toLowerCase().includes(q) ||
                (c.contact_type || '').toLowerCase().includes(q)
            )
        })
    }, [contacts, contactSearch, contactFilterType])

    // ── Bank Reconciliation Computed Rows & Live Equation (Gear ⚙️ -> Reconcile) ──
    const isTxnPaymentForAccount = useCallback((txn: any, bankQbId: string): boolean => {
        if (txn.txn_type === 'Transfer') {
            return txn.account_qb_id === bankQbId
        }
        return ['Check', 'Expense', 'CreditCardExpense', 'BillPayment', 'RefundReceipt', 'PayDownCreditCard'].includes(txn.txn_type) || txn.direction === 'OUT'
    }, [])

    const reconcileAccountRows = useMemo(() => {
        if (!reconcileAccountId) return []
        return reconcileTransactions.filter(t => {
            if (t.is_voided) return false
            const lineHit = Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === reconcileAccountId)
            return t.account_qb_id === reconcileAccountId || t.to_account_qb_id === reconcileAccountId || lineHit
        })
    }, [reconcileTransactions, reconcileAccountId])

    const visibleReconcileRows = useMemo(() => {
        const q = recSearch.trim().toLowerCase()
        return reconcileAccountRows.filter(t => {
            if (recUpToEndDateOnly && recEndingDate && t.txn_date > recEndingDate) return false
            const isPay = isTxnPaymentForAccount(t, reconcileAccountId)
            if (recFilterSide === 'PAYMENTS' && !isPay) return false
            if (recFilterSide === 'DEPOSITS' && isPay) return false
            if (q) {
                const hay = `${t.doc_number || ''} ${t.entity_name || ''} ${t.category_summary || ''} ${t.memo || ''} ${t.total_amount || ''}`.toLowerCase()
                if (!hay.includes(q)) return false
            }
            return true
        })
    }, [reconcileAccountRows, recUpToEndDateOnly, recEndingDate, recFilterSide, recSearch, reconcileAccountId, isTxnPaymentForAccount])

    const reconcileMath = useMemo(() => {
        const selectedSet = new Set(recSelectedIds)
        let paymentsCount = 0
        let paymentsTotal = 0
        let depositsCount = 0
        let depositsTotal = 0

        for (const t of reconcileAccountRows) {
            if (!selectedSet.has(String(t.id))) continue
            const amt = Number(t.total_amount || 0)
            if (isTxnPaymentForAccount(t, reconcileAccountId)) {
                paymentsCount++
                paymentsTotal += amt
            } else {
                depositsCount++
                depositsTotal += amt
            }
        }

        const svcFee = Number(recServiceCharge || 0)
        const intEarn = Number(recInterestEarned || 0)
        const begBal = Number(recBeginningBalance || 0)
        const endBal = Number(recEndingBalance || 0)

        const clearedBalance = Number((begBal - paymentsTotal - svcFee + depositsTotal + intEarn).toFixed(2))
        const difference = Number((endBal - clearedBalance).toFixed(2))

        return {
            begBal,
            endBal,
            paymentsCount,
            paymentsTotal: Number(paymentsTotal.toFixed(2)),
            depositsCount,
            depositsTotal: Number(depositsTotal.toFixed(2)),
            clearedBalance,
            difference,
            isBalanced: Math.abs(difference) < 0.005,
        }
    }, [recSelectedIds, reconcileAccountRows, recServiceCharge, recInterestEarned, recBeginningBalance, recEndingBalance, reconcileAccountId, isTxnPaymentForAccount])

    const handleAutoSelectReconcileAccount = (accQbId: string) => {
        setReconcileAccountId(accQbId)
        setEditingReconciliationId(null)
        const acc = accounts.find(a => a.qb_account_id === accQbId)
        const lastCompleted = reconciliations.find(r => r.account_qb_id === accQbId && r.status === 'Completed')
        const beg = lastCompleted ? Number(lastCompleted.ending_balance || 0) : 0
        const end = acc ? Number(acc.current_balance || 0) : 0
        setRecBeginningBalance(beg.toFixed(2))
        setRecEndingBalance(end.toFixed(2))

        // Pre-select all cleared/reconciled transactions for this account so the CPA starts close to $0.00 difference
        const rowsForAcc = reconcileTransactions.filter(t => !t.is_voided && (t.account_qb_id === accQbId || t.to_account_qb_id === accQbId))
        setRecSelectedIds(rowsForAcc.map(r => String(r.id)))
    }

    const handleSaveReconciliation = async (status: 'Draft' | 'Completed', autoAdjust = false) => {
        if (!reconcileAccountId) return
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_reconciliation',
                    id: editingReconciliationId,
                    realmId: activeRealmId,
                    account_qb_id: reconcileAccountId,
                    statement_ending_date: recEndingDate,
                    beginning_balance: Number(recBeginningBalance || 0),
                    ending_balance: Number(recEndingBalance || 0),
                    cleared_balance: reconcileMath.clearedBalance,
                    difference: reconcileMath.difference,
                    payments_count: reconcileMath.paymentsCount,
                    payments_total: reconcileMath.paymentsTotal,
                    deposits_count: reconcileMath.depositsCount,
                    deposits_total: reconcileMath.depositsTotal,
                    service_charge: Number(recServiceCharge || 0),
                    service_charge_account_qb_id: recServiceChargeAccId || undefined,
                    interest_earned: Number(recInterestEarned || 0),
                    interest_account_qb_id: recInterestAccId || undefined,
                    auto_adjust_difference: autoAdjust,
                    reconciled_txn_ids: recSelectedIds,
                    status,
                    notes: recNotes,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving reconciliation')
            notify('ok', status === 'Completed' ? 'Conciliación bancaria finalizada oficialmente ($0.00).' : 'Borrador de conciliación guardado.')
            setEditingReconciliationId(json.reconciliation?.id || null)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleReopenReconciliation = async (rec: any) => {
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'reopen_reconciliation',
                    realmId: activeRealmId,
                    id: rec.id,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error reopening reconciliation')
            setReconcileAccountId(rec.account_qb_id)
            setEditingReconciliationId(rec.id)
            setRecEndingDate(rec.statement_ending_date)
            setRecBeginningBalance(Number(rec.beginning_balance || 0).toFixed(2))
            setRecEndingBalance(Number(rec.ending_balance || 0).toFixed(2))
            setRecSelectedIds(Array.isArray(rec.reconciled_txn_ids) ? rec.reconciled_txn_ids.map(String) : [])
            notify('ok', 'Conciliación reabierta para edición.')
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handlePrintReconciliationReport = (rec?: any) => {
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const accName = rec?.account_name || accounts.find(a => a.qb_account_id === reconcileAccountId)?.name || 'Bank Account'
        const stmtDate = rec?.statement_ending_date || recEndingDate
        const begBal = rec ? Number(rec.beginning_balance || 0) : reconcileMath.begBal
        const endBal = rec ? Number(rec.ending_balance || 0) : reconcileMath.endBal
        const clrBal = rec ? Number(rec.cleared_balance || 0) : reconcileMath.clearedBalance
        const diff = rec ? Number(rec.difference || 0) : reconcileMath.difference
        const payCount = rec ? Number(rec.payments_count || 0) : reconcileMath.paymentsCount
        const payTotal = rec ? Number(rec.payments_total || 0) : reconcileMath.paymentsTotal
        const depCount = rec ? Number(rec.deposits_count || 0) : reconcileMath.depositsCount
        const depTotal = rec ? Number(rec.deposits_total || 0) : reconcileMath.depositsTotal
        const recIdsSet = new Set(Array.isArray(rec?.reconciled_txn_ids) ? rec.reconciled_txn_ids.map(String) : recSelectedIds)

        const includedRows = reconcileTransactions.filter(t => recIdsSet.has(String(t.id)))
        const paymentRows = includedRows.filter(t => isTxnPaymentForAccount(t, rec?.account_qb_id || reconcileAccountId))
        const depositRows = includedRows.filter(t => !isTxnPaymentForAccount(t, rec?.account_qb_id || reconcileAccountId))

        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.reconcile_title'))} — ${escapeHtml(accName)}</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.reconcile_ending_date'))}:</strong> ${escapeHtml(stmtDate)}</div>
              <div><strong>Estado:</strong> ${escapeHtml(rec?.status || (Math.abs(diff) < 0.005 ? 'Completed' : 'Draft'))}</div>
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>

          <div class="kpi-strip">
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.reconcile_beginning_balance'))}</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(begBal))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.reconcile_payments_checked'))} (${payCount})</div>
              <div class="kpi-val">-${escapeHtml(formatCurrency(payTotal))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.reconcile_deposits_checked'))} (${depCount})</div>
              <div class="kpi-val">+${escapeHtml(formatCurrency(depTotal))}</div>
            </div>
            <div class="kpi-box">
              <div class="kpi-label">${escapeHtml(t('external_accounting.reconcile_ending_balance'))} / Diff</div>
              <div class="kpi-val">${escapeHtml(formatCurrency(endBal))} (Δ ${escapeHtml(formatCurrency(diff))})</div>
            </div>
          </div>

          <h4 style="margin:12px 0 6px;font-size:11px;text-transform:uppercase;">1. ${escapeHtml(t('external_accounting.reconcile_payments_checked'))} (${paymentRows.length}) — ${escapeHtml(formatCurrency(payTotal))}</h4>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Doc / Check #</th>
                <th>Payee</th>
                <th>GL Category</th>
                <th>Memo</th>
                <th class="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${paymentRows.map(r => `
                <tr>
                  <td class="mono">${escapeHtml(r.txn_date)}</td>
                  <td>${escapeHtml(r.txn_type)}</td>
                  <td class="mono">${escapeHtml(r.doc_number || '')}</td>
                  <td><strong>${escapeHtml(r.entity_name || '-')}</strong></td>
                  <td>${escapeHtml(r.category_summary || '')}</td>
                  <td>${escapeHtml(r.memo || '')}</td>
                  <td class="right mono">${escapeHtml(formatCurrency(r.total_amount))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <h4 style="margin:16px 0 6px;font-size:11px;text-transform:uppercase;">2. ${escapeHtml(t('external_accounting.reconcile_deposits_checked'))} (${depositRows.length}) — ${escapeHtml(formatCurrency(depTotal))}</h4>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Ref #</th>
                <th>Received From</th>
                <th>GL Category</th>
                <th>Memo</th>
                <th class="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${depositRows.map(r => `
                <tr>
                  <td class="mono">${escapeHtml(r.txn_date)}</td>
                  <td>${escapeHtml(r.txn_type)}</td>
                  <td class="mono">${escapeHtml(r.doc_number || '')}</td>
                  <td><strong>${escapeHtml(r.entity_name || '-')}</strong></td>
                  <td>${escapeHtml(r.category_summary || '')}</td>
                  <td>${escapeHtml(r.memo || '')}</td>
                  <td class="right mono">${escapeHtml(formatCurrency(r.total_amount))}</td>
                </tr>
              `).join('')}
              <tr class="summary-row">
                <td colspan="6">${escapeHtml(t('external_accounting.reconcile_cleared_balance'))}</td>
                <td class="right mono">${escapeHtml(formatCurrency(clrBal))}</td>
              </tr>
            </tbody>
          </table>
        `
        if (!openCleanPrintWindow(`${compName}_Reconciliation_${accName}_${stmtDate}`, bodyHtml, false)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    // ── Batch Reclassify Handler (Gear ⚙️ -> Tools -> Reclassify Transactions) ──
    const handleReclassifyBatch = async () => {
        if (reclassifySelectedIds.length === 0) return
        if (!reclassifyTargetAccId && !reclassifyTargetEntity.trim() && !reclassifyTargetDept.trim()) {
            notify('err', 'Selecciona la cuenta contable destino, proveedor/cliente o departamento.')
            return
        }
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'reclassify_transactions',
                    realmId: activeRealmId,
                    txnIds: reclassifySelectedIds,
                    targetAccountQbId: reclassifyTargetAccId || undefined,
                    targetEntityName: reclassifyTargetEntity || undefined,
                    targetDepartmentName: reclassifyTargetDept || undefined,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error reclassifying transactions')
            notify('ok', `Se reclasificaron ${json.updatedCount} transacciones y se actualizaron los saldos atómicamente.`)
            setReclassifySelectedIds([])
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // ── Bank Rules Handlers (Gear ⚙️ -> Lists -> Rules) ──
    const handleSaveBankRule = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_bank_rule',
                    id: editingRuleId,
                    realmId: activeRealmId,
                    rule_name: ruleFormName,
                    direction: ruleFormDirection,
                    match_field: ruleFormMatchField,
                    match_text: ruleFormMatchText,
                    target_account_qb_id: ruleFormTargetAccId,
                    target_entity_name: ruleFormTargetEntity,
                    priority: Number(ruleFormPriority || 100),
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving bank rule')
            setRuleModalOpen(false)
            notify('ok', 'Regla bancaria guardada correctamente.')
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteBankRule = async (idOrObj: any) => {
        const ruleObj = typeof idOrObj === 'object' && idOrObj !== null
            ? idOrObj
            : bankRules.find(r => String(r.id) === String(idOrObj)) || { id: idOrObj, rule_name: `Rule #${idOrObj}` }
        openDeleteWizard('bank_rule', ruleObj)
    }

    const handleApplyBankRulesNow = async () => {
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'apply_bank_rules', realmId: activeRealmId })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error applying bank rules')
            notify('ok', `Reglas ejecutadas: ${json.matchedCount} transacciones categorizadas automáticamente.`)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // ── Budgeting Handlers & Print (Gear ⚙️ -> Tools -> Budgeting) ──
    const handleSaveBudget = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_budget',
                    realmId: activeRealmId,
                    fiscal_year: budgetYear,
                    account_qb_id: budgetAccountQbId,
                    annual_total: Number(budgetAnnualAmount || 0),
                    notes: budgetNotes,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving budget')
            setBudgetModalOpen(false)
            notify('ok', 'Presupuesto guardado correctamente.')
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteBudget = async (idOrObj: any) => {
        const bObj = typeof idOrObj === 'object' && idOrObj !== null
            ? idOrObj
            : budgets.find(b => String(b.id) === String(idOrObj)) || { id: idOrObj, account_name: `Budget #${idOrObj}` }
        openDeleteWizard('budget', bObj)
    }

    const budgetComparisonRows = useMemo(() => {
        return budgets
            .filter(b => Number(b.fiscal_year) === Number(budgetYear))
            .map(b => {
                const acc = accounts.find(a => a.qb_account_id === b.account_qb_id)
                const fyActual = actualsByAccountAndYear?.[b.account_qb_id]?.[String(budgetYear)]
                const actual = fyActual !== undefined
                    ? Number(fyActual.toFixed(2))
                    : Math.abs(Number(acc?.current_balance || 0))
                const annualBudget = Number(b.annual_total || 0)
                const variance = Number((actual - annualBudget).toFixed(2))
                const pct = annualBudget > 0 ? Number(((actual / annualBudget) * 100).toFixed(1)) : 0
                return {
                    ...b,
                    actual,
                    annualBudget,
                    variance,
                    pct,
                }
            })
    }, [budgets, budgetYear, accounts, actualsByAccountAndYear])

    const handlePrintBudgetReport = () => {
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.budget_title'))} — ${budgetYear}</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('external_accounting.col_acct_name'))}</th>
                <th>${escapeHtml(t('external_accounting.col_acct_type'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.budget_col_annual'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.budget_col_actual'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.budget_col_variance'))}</th>
                <th class="right">${escapeHtml(t('external_accounting.budget_col_pct'))}</th>
              </tr>
            </thead>
            <tbody>
              ${budgetComparisonRows.map(r => `
                <tr>
                  <td><strong>${escapeHtml(r.account_name)}</strong></td>
                  <td>${escapeHtml(r.account_type)}</td>
                  <td class="right mono">${escapeHtml(formatCurrency(r.annualBudget))}</td>
                  <td class="right mono">${escapeHtml(formatCurrency(r.actual))}</td>
                  <td class="right mono">${escapeHtml(formatCurrency(r.variance))}</td>
                  <td class="right mono">${escapeHtml(String(r.pct))}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        if (!openCleanPrintWindow(`${compName}_Budget_${budgetYear}`, bodyHtml, false)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    // ── Audit Log Filter & Print (Gear ⚙️ -> Tools -> Audit Log) ──
    const filteredAuditLog = useMemo(() => {
        const q = auditSearch.trim().toLowerCase()
        if (!q) return auditLog
        return auditLog.filter(a =>
            (a.user_name || '').toLowerCase().includes(q) ||
            (a.action_type || '').toLowerCase().includes(q) ||
            (a.summary || '').toLowerCase().includes(q) ||
            (a.doc_number || '').toLowerCase().includes(q)
        )
    }, [auditLog, auditSearch])

    const handlePrintAuditLog = () => {
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'Company'
        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.audit_title'))}</div>
            </div>
            <div class="doc-meta">
              <div><strong>Registros:</strong> ${filteredAuditLog.length}</div>
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha / Hora</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Doc #</th>
                <th>Detalle de Operación</th>
                <th class="right">Monto</th>
              </tr>
            </thead>
            <tbody>
              ${filteredAuditLog.map(a => `
                <tr>
                  <td class="mono">${escapeHtml(a.created_at ? new Date(a.created_at).toLocaleString('en-US') : '')}</td>
                  <td><strong>${escapeHtml(a.user_name || '')}</strong></td>
                  <td class="mono">${escapeHtml(a.action_type || '')}</td>
                  <td class="mono">${escapeHtml(a.doc_number || '-')}</td>
                  <td>${escapeHtml(a.summary || '')}</td>
                  <td class="right mono">${a.amount !== null && a.amount !== undefined ? escapeHtml(formatCurrency(a.amount)) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
        if (!openCleanPrintWindow(`${compName}_AuditLog`, bodyHtml, false)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    // ── Lists & Products/Services Handlers (Gear ⚙️ -> All Lists /app/lists) ──
    const handleSaveListItem = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const incomeAcc = accounts.find(a => a.qb_account_id === listItemAccountId)
            const expenseAcc = accounts.find(a => a.qb_account_id === listItemExpenseAccountId)
            const catObj = (companyLists.categories || []).find((c: any) => String(c.Id ?? c.id) === String(listItemCategoryId))
            const parentArr =
                activeListKey === 'departments' ? (companyLists.departments || [])
                : activeListKey === 'classes' ? (companyLists.classes || [])
                : (companyLists.categories || [])
            const parentObj = listItemParentId
                ? parentArr.find((p: any) => String(p.Id ?? p.id) === String(listItemParentId))
                : null

            const fqName = parentObj
                ? `${parentObj.FullyQualifiedName || parentObj.Name}:${listItemName.trim()}`
                : catObj && activeListKey === 'items'
                ? `${catObj.FullyQualifiedName || catObj.Name}:${listItemName.trim()}`
                : listItemName.trim()

            const itemObj: Record<string, any> = {
                Id: editingListItemId || `LOCAL-${Date.now()}`,
                Name: listItemName.trim(),
                FullyQualifiedName: fqName,
                Sku: listItemSku.trim() || null,
                Description: listItemDesc.trim(),
                PurchaseDesc: listItemDesc.trim() || null,
                UnitPrice: Number(listItemPrice || 0),
                Type: activeListKey === 'categories' ? 'Category' : (listItemType || 'Service'),
                CategoryQbId: catObj ? String(catObj.Id) : null,
                CategoryName: catObj ? String(catObj.Name) : null,
                IncomeAccountRef: incomeAcc ? { value: incomeAcc.qb_account_id, name: incomeAcc.name } : undefined,
                ExpenseAccountRef: expenseAcc ? { value: expenseAcc.qb_account_id, name: expenseAcc.name } : undefined,
                ClassCode: listItemClassCode.trim() || null,
                ParentRef: parentObj ? { value: String(parentObj.Id), name: String(parentObj.Name) } : undefined,
                SubDepartment: Boolean(parentObj && activeListKey === 'departments'),
                SubClass: Boolean(parentObj && activeListKey === 'classes'),
                SubItem: Boolean((parentObj && activeListKey === 'categories') || (catObj && activeListKey === 'items')),
                DueDays: Number(listItemDueDays || 0),
                DiscountPercent: Number(listItemDiscountPct || 0),
                Active: true,
            }
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_list_item',
                    realmId: activeRealmId,
                    listKey: activeListKey,
                    item: itemObj,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving list item')
            setListItemModalOpen(false)
            notify('ok', 'Elemento guardado en el catálogo y sincronizado.')
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteListItem = async (itemOrId: any) => {
        const listArr = (companyLists as any)[activeListKey] || []
        const itemObj = typeof itemOrId === 'object' && itemOrId !== null
            ? { ...itemOrId, listKey: itemOrId.listKey || activeListKey }
            : {
                ...(listArr.find((x: any) => String(x.Id ?? x.id) === String(itemOrId)) || { Id: itemOrId, Name: `Item #${itemOrId}` }),
                listKey: activeListKey,
            }
        openDeleteWizard('list_item', itemObj)
    }

    // ── Universal Edit, Print & 3-Step Confirmed Delete Handlers Across All Tabs ──
    const handleEditRecord = (kind: PreviewRecordKind, data: any) => {
        if (!data) return
        setPreviewRecord(null)
        if (kind === 'transaction') {
            const validModes = [
                'Check', 'Deposit', 'Expense', 'Invoice', 'Payment', 'Bill', 'BillPayment',
                'Transfer', 'JournalEntry', 'SalesReceipt', 'CreditMemo', 'RefundReceipt',
                'Estimate', 'VendorCredit', 'CreditCardCredit', 'PurchaseOrder', 'PayDownCreditCard'
            ]
            const mode = (validModes.includes(data.txn_type) ? data.txn_type : 'Expense') as ModalMode
            openTransactionModal(mode, data)
            return
        }
        if (kind === 'account') {
            setEditingAccount(data)
            setAccFormName(data.name || '')
            setAccFormNum(data.acct_num || '')
            setAccFormType(data.account_type || 'Bank')
            setAccFormSubType(data.account_sub_type || '')
            setAccFormClass(data.classification || 'Asset')
            setAccFormDesc(data.raw_data?.Description || '')
            setAccFormIsSub(Boolean(data.is_sub_account))
            setAccFormParentId(data.parent_qb_id || '')
            setAccFormBalance(String(data.current_balance || 0))
            setAccountModalOpen(true)
            return
        }
        if (kind === 'contact') {
            const formattedAddr = data.address
                ? [data.address.Line1, data.address.City, data.address.CountrySubDivisionCode, data.address.PostalCode].filter(Boolean).join(', ')
                : ''
            setEditingContact(data)
            setConFormName(data.display_name || '')
            setConFormCompany(data.company_name || '')
            setConFormPrintOnCheck(data.print_on_check_name || data.display_name || '')
            setConFormAcctNum(data.acct_num || '')
            setConFormAddress(formattedAddr)
            setConFormBalance(String(data.balance || 0))
            setConFormType(data.contact_type || 'Vendor')
            setConFormEmail(data.email || '')
            setConFormPhone(data.phone || '')
            setConFormTaxId(data.tax_identifier || '')
            setConForm1099(Boolean(data.vendor_1099))
            setContactModalOpen(true)
            return
        }
        if (kind === 'recurring') {
            setEditingRecurring(data)
            setRecFormName(data.template_name || '')
            setRecFormRecurType(data.recur_type || 'Automated')
            setRecFormTxnType(data.txn_type || 'Check')
            setRecFormInterval(data.interval_type || 'Monthly')
            setRecFormNumInterval(String(data.num_interval || 1))
            setRecFormNextDate(data.next_date || '')
            setRecFormAccountQbId(data.account_qb_id || '')
            setRecFormGlAccountQbId(data.line_items?.[0]?.account_qb_id || expenseAndGlAccounts[0]?.qb_account_id || '')
            setRecFormEntityName(data.entity_name || '')
            setRecFormMemo(data.memo || '')
            setRecFormAmount(String(data.amount || 0))
            setRecurringModalOpen(true)
            return
        }
        if (kind === 'reconciliation') {
            setActiveTab('reconcile')
            if (data.status === 'Completed') {
                handleReopenReconciliation(data)
            } else {
                setReconcileAccountId(data.account_qb_id)
                setEditingReconciliationId(data.id)
                setRecEndingDate(data.statement_ending_date)
                setRecBeginningBalance(Number(data.beginning_balance || 0).toFixed(2))
                setRecEndingBalance(Number(data.ending_balance || 0).toFixed(2))
                setRecSelectedIds(Array.isArray(data.reconciled_txn_ids) ? data.reconciled_txn_ids.map(String) : [])
            }
            return
        }
        if (kind === 'list_item') {
            if (data.listKey) setActiveListKey(data.listKey)
            setEditingListItemId(String(data.Id ?? data.id ?? ''))
            setListItemName(data.Name ?? data.name ?? '')
            setListItemSku(data.Sku ?? data.sku ?? '')
            setListItemDesc(data.Description ?? data.description ?? '')
            setListItemPrice(String(data.UnitPrice ?? data.unit_price ?? 0))
            setListItemType(data.Type ?? 'Service')
            setListItemCategoryId(data.CategoryQbId ?? data.ParentRef?.value ?? '')
            setListItemAccountId(data.IncomeAccountRef?.value ?? data.account_qb_id ?? '')
            setListItemExpenseAccountId(data.ExpenseAccountRef?.value ?? data.expense_account_qb_id ?? '')
            setListItemClassCode(data.ClassCode ?? data.class_code ?? '')
            setListItemParentId(data.ParentRef?.value ?? data.parent_qb_id ?? '')
            setListItemDueDays(String(data.DueDays ?? data.due_days ?? 30))
            setListItemDiscountPct(String(data.DiscountPercent ?? data.discount_percent ?? 0))
            setListItemModalOpen(true)
            return
        }
        if (kind === 'bank_rule') {
            setEditingRuleId(data.id)
            setRuleFormName(data.rule_name || '')
            setRuleFormDirection(data.direction || 'OUT')
            setRuleFormMatchField(data.match_field || 'ANY')
            setRuleFormMatchText(data.match_text || '')
            setRuleFormTargetAccId(data.target_account_qb_id || '')
            setRuleFormTargetEntity(data.target_entity_name || '')
            setRuleFormPriority(String(data.priority || 100))
            setRuleModalOpen(true)
            return
        }
        if (kind === 'budget') {
            setBudgetYear(Number(data.fiscal_year || budgetYear))
            setBudgetAccountQbId(data.account_qb_id || '')
            setBudgetAnnualAmount(String(data.annual_total || data.annualBudget || 0))
            setBudgetNotes(data.notes || '')
            setBudgetModalOpen(true)
            return
        }
    }

    const handlePrintRecord = (kind: PreviewRecordKind, data: any) => {
        if (!data) return
        const compName = activeCompany?.legal_name || activeCompany?.company_name || 'COMPANY'

        if (kind === 'transaction') {
            if (data.txn_type === 'Check' || data.txn_type === 'BillPayment') {
                handlePrintOfficialCheck(data)
                return
            }
            const isDeposit = data.txn_type === 'Deposit' || data.txn_type === 'Payment' || data.txn_type === 'SalesReceipt'
            const docTitle = isDeposit
                ? t('external_accounting.preview_deposit_slip')
                : `${t('external_accounting.preview_accounting_voucher')} — ${String(data.txn_type || '').toUpperCase()}`
            const amt = Number(data.total_amount || 0)
            const rawLines = Array.isArray(data.line_items) && data.line_items.length > 0
                ? data.line_items
                : [{
                    account_name: data.category_summary || data.to_account_name || data.account_name || '—',
                    entity_name: data.entity_name || '—',
                    description: data.memo || '—',
                    payment_method: data.payment_type || data.txn_type || '—',
                    check_num: data.doc_number || '—',
                    amount: amt,
                }]

            const rowsHtml = rawLines.map((l: any, idx: number) => `
              <tr>
                <td class="mono">${idx + 1}</td>
                <td><strong>${escapeHtml(l.entity_name || data.entity_name || '—')}</strong></td>
                <td>${escapeHtml(l.account_name || l.item_name || data.category_summary || '—')}</td>
                <td>${escapeHtml(l.description || data.memo || '—')}</td>
                <td>${escapeHtml(l.payment_method || data.payment_type || '—')}</td>
                <td class="mono">${escapeHtml(l.check_num || data.doc_number || '—')}</td>
                <td class="right mono"><strong>${escapeHtml(formatCurrency(l.amount ?? amt))}</strong></td>
              </tr>
            `).join('')

            const bodyHtml = `
              <div class="doc-header">
                <div>
                  <div class="doc-company">${escapeHtml(compName)}</div>
                  <div class="doc-title">${escapeHtml(docTitle)}</div>
                </div>
                <div class="doc-meta">
                  <div><strong>${escapeHtml(t('external_accounting.col_date'))}:</strong> ${escapeHtml(data.txn_date || '')}</div>
                  <div><strong>${escapeHtml(t('external_accounting.col_doc_num'))}:</strong> #${escapeHtml(data.doc_number || data.qb_txn_id || '—')}</div>
                  <div><strong>${escapeHtml(t('external_accounting.col_status'))}:</strong> ${escapeHtml(data.is_voided ? 'VOID' : (data.cleared_status || 'Cleared'))}</div>
                </div>
              </div>
              <div class="kpi-strip">
                <div class="kpi-box">
                  <div class="kpi-label">${escapeHtml(t('external_accounting.col_account'))}</div>
                  <div class="kpi-val" style="font-size:13px;">${escapeHtml(data.account_name || '—')}</div>
                </div>
                <div class="kpi-box">
                  <div class="kpi-label">${escapeHtml(t('external_accounting.col_payee'))}</div>
                  <div class="kpi-val" style="font-size:13px;">${escapeHtml(data.entity_name || '—')}</div>
                </div>
                <div class="kpi-box">
                  <div class="kpi-label">${escapeHtml(t('external_accounting.col_category'))}</div>
                  <div class="kpi-val" style="font-size:13px;">${escapeHtml(data.category_summary || data.to_account_name || '—')}</div>
                </div>
                <div class="kpi-box">
                  <div class="kpi-label">${escapeHtml(t('external_accounting.col_amount'))}</div>
                  <div class="kpi-val">${escapeHtml(formatCurrency(amt))}</div>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>${escapeHtml(t('external_accounting.col_payee'))}</th>
                    <th>${escapeHtml(t('external_accounting.col_category'))}</th>
                    <th>${escapeHtml(t('external_accounting.col_memo'))}</th>
                    <th>Method</th>
                    <th>Ref #</th>
                    <th class="right">${escapeHtml(t('external_accounting.col_amount'))}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                  <tr class="summary-row">
                    <td colspan="6">${escapeHtml(t('external_accounting.totals_label'))}</td>
                    <td class="right mono">${escapeHtml(formatCurrency(amt))}</td>
                  </tr>
                </tbody>
              </table>
            `
            if (!openCleanPrintWindow(`${compName}_${data.txn_type || 'Txn'}_${data.doc_number || data.id}`, bodyHtml, false)) {
                notify('err', t('external_accounting.print_popup_blocked'))
            }
            return
        }

        if (kind === 'reconciliation') {
            handlePrintReconciliationReport(data)
            return
        }

        if (kind === 'account') {
            const acctTxns = transactions.filter(
                t => t.account_qb_id === data.qb_account_id ||
                     t.to_account_qb_id === data.qb_account_id ||
                     (Array.isArray(t.line_items) && t.line_items.some((l: any) => l.account_qb_id === data.qb_account_id))
            ).slice(0, 50)
            const bodyHtml = `
              <div class="doc-header">
                <div>
                  <div class="doc-company">${escapeHtml(compName)}</div>
                  <div class="doc-title">${escapeHtml(t('external_accounting.preview_account_dossier'))}</div>
                </div>
                <div class="doc-meta">
                  <div><strong>QBO ID:</strong> #${escapeHtml(data.qb_account_id || '—')}</div>
                  <div><strong>${escapeHtml(t('external_accounting.col_acct_num'))}:</strong> ${escapeHtml(data.acct_num || '—')}</div>
                </div>
              </div>
              <div class="kpi-strip">
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_acct_name'))}</div><div class="kpi-val" style="font-size:13px;">${escapeHtml(data.fully_qualified_name || data.name)}</div></div>
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_acct_type'))}</div><div class="kpi-val" style="font-size:13px;">${escapeHtml(data.account_type || '—')}</div></div>
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_acct_detail'))}</div><div class="kpi-val" style="font-size:13px;">${escapeHtml(data.account_sub_type || '—')}</div></div>
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_balance'))}</div><div class="kpi-val">${escapeHtml(formatCurrency(data.current_balance || 0))}</div></div>
              </div>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th>Payee</th><th>Memo</th><th class="right">Amount</th></tr></thead>
                <tbody>
                  ${acctTxns.map(r => `<tr><td class="mono">${escapeHtml(r.txn_date)}</td><td>${escapeHtml(r.txn_type)}</td><td class="mono">${escapeHtml(r.doc_number || '—')}</td><td><strong>${escapeHtml(r.entity_name || '—')}</strong></td><td>${escapeHtml(r.memo || '—')}</td><td class="right mono">${escapeHtml(formatCurrency(r.total_amount))}</td></tr>`).join('')}
                </tbody>
              </table>
            `
            if (!openCleanPrintWindow(`${compName}_Account_${data.name}`, bodyHtml, false)) {
                notify('err', t('external_accounting.print_popup_blocked'))
            }
            return
        }

        if (kind === 'contact') {
            const addrStr = data.address
                ? [data.address.Line1, data.address.City, data.address.CountrySubDivisionCode, data.address.PostalCode].filter(Boolean).join(', ')
                : '—'
            const conTxns = transactions.filter(
                t => (t.entity_name || '').toLowerCase() === (data.display_name || '').toLowerCase() || t.entity_qb_id === data.qb_contact_id
            ).slice(0, 50)
            const bodyHtml = `
              <div class="doc-header">
                <div>
                  <div class="doc-company">${escapeHtml(compName)}</div>
                  <div class="doc-title">${escapeHtml(t('external_accounting.preview_contact_dossier'))} — ${escapeHtml(data.contact_type || 'Vendor')}</div>
                </div>
                <div class="doc-meta">
                  <div><strong>QBO ID:</strong> #${escapeHtml(data.qb_contact_id || '—')}</div>
                  <div><strong>1099:</strong> ${data.vendor_1099 ? 'YES (1099)' : 'NO'}</div>
                </div>
              </div>
              <div class="kpi-strip">
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_contact_name'))}</div><div class="kpi-val" style="font-size:13px;">${escapeHtml(data.display_name)}</div></div>
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_company_check_name'))}</div><div class="kpi-val" style="font-size:13px;">${escapeHtml(data.print_on_check_name || data.company_name || '—')}</div></div>
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_billing_address'))}</div><div class="kpi-val" style="font-size:11px;">${escapeHtml(addrStr)}</div></div>
                <div class="kpi-box"><div class="kpi-label">${escapeHtml(t('external_accounting.col_open_balance'))}</div><div class="kpi-val">${escapeHtml(formatCurrency(data.balance || 0))}</div></div>
              </div>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th>Category / GL</th><th>Memo</th><th class="right">Amount</th></tr></thead>
                <tbody>
                  ${conTxns.map(r => `<tr><td class="mono">${escapeHtml(r.txn_date)}</td><td>${escapeHtml(r.txn_type)}</td><td class="mono">${escapeHtml(r.doc_number || '—')}</td><td>${escapeHtml(r.category_summary || '—')}</td><td>${escapeHtml(r.memo || '—')}</td><td class="right mono">${escapeHtml(formatCurrency(r.total_amount))}</td></tr>`).join('')}
                </tbody>
              </table>
            `
            if (!openCleanPrintWindow(`${compName}_Contact_${data.display_name}`, bodyHtml, false)) {
                notify('err', t('external_accounting.print_popup_blocked'))
            }
            return
        }

        // Generic print for recurring, list_item, bank_rule, budget
        const pairs = Object.entries(data || {}).filter(([k, v]) => typeof v !== 'object' && k !== 'company_realm_id')
        const bodyHtml = `
          <div class="doc-header">
            <div>
              <div class="doc-company">${escapeHtml(compName)}</div>
              <div class="doc-title">${escapeHtml(t('external_accounting.preview_modal_title'))} (${escapeHtml(kind.toUpperCase())})</div>
            </div>
            <div class="doc-meta">
              <div><strong>${escapeHtml(t('external_accounting.print_generated_on'))}:</strong> ${escapeHtml(new Date().toLocaleString('en-US'))}</div>
            </div>
          </div>
          <table>
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>
              ${pairs.map(([k, v]) => `<tr><td class="mono"><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(String(v ?? '—'))}</td></tr>`).join('')}
            </tbody>
          </table>
        `
        if (!openCleanPrintWindow(`${compName}_${kind}`, bodyHtml, false)) {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    const executeConfirmedDelete = async () => {
        if (!deleteWizardTarget) return
        const { kind, data } = deleteWizardTarget
        setSaving(true)
        try {
            let payload: Record<string, any> = { realmId: activeRealmId }
            if (kind === 'transaction') {
                payload = { action: 'delete_transaction', realmId: activeRealmId, id: data.id }
            } else if (kind === 'account') {
                payload = { action: 'delete_account', realmId: activeRealmId, id: data.id, qb_account_id: data.qb_account_id }
            } else if (kind === 'contact') {
                payload = { action: 'delete_contact', realmId: activeRealmId, id: data.id, qb_contact_id: data.qb_contact_id }
            } else if (kind === 'recurring') {
                payload = { action: 'delete_recurring', realmId: activeRealmId, id: data.id }
            } else if (kind === 'reconciliation') {
                payload = { action: 'delete_reconciliation', realmId: activeRealmId, id: data.id }
            } else if (kind === 'list_item') {
                payload = {
                    action: 'delete_list_item',
                    realmId: activeRealmId,
                    listKey: data.listKey || activeListKey,
                    itemId: String(data.Id ?? data.id ?? ''),
                }
            } else if (kind === 'bank_rule') {
                payload = { action: 'delete_bank_rule', realmId: activeRealmId, id: data.id }
            } else if (kind === 'budget') {
                payload = { action: 'delete_budget', realmId: activeRealmId, id: data.id }
            }

            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error deleting record')

            setDeleteWizardTarget(null)
            setPreviewRecord(null)
            notify('ok', t('external_accounting.delete_success_with_qbo'))
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // ── Company Settings Handler (Gear ⚙️ -> Settings -> Company Settings) ──
    const handleSaveCompanySettings = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_company_settings',
                    realmId: activeRealmId,
                    company_name: compSetName,
                    legal_name: compSetLegalName,
                    email: compSetEmail,
                    phone: compSetPhone,
                    address: {
                        Line1: compSetStreet,
                        City: compSetCity,
                        CountrySubDivisionCode: compSetState,
                        PostalCode: compSetZip,
                    },
                    tax_id: compSetTaxId,
                    accounting_method: compSetMethod,
                    fiscal_year_start_month: compSetFyMonth,
                    closing_date: compSetClosingDate || null,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving company settings')
            notify('ok', 'Configuración fiscal y contable de la empresa actualizada.')
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // ── Batch Transactions Entry (+ Create -> Other -> Batch Transactions) ──
    const openBatchModal = () => {
        const defaultBank = bankAndCardAccounts[0]?.qb_account_id || accounts[0]?.qb_account_id || ''
        const defaultExp = accounts.find(a => a.account_type === 'Expense')?.qb_account_id || accounts[0]?.qb_account_id || ''
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        setBatchRows([
            { txn_date: todayStr, txn_type: 'Check', doc_number: '', account_qb_id: defaultBank, gl_account_qb_id: defaultExp, entity_name: '', memo: '', amount: '' },
            { txn_date: todayStr, txn_type: 'Check', doc_number: '', account_qb_id: defaultBank, gl_account_qb_id: defaultExp, entity_name: '', memo: '', amount: '' },
            { txn_date: todayStr, txn_type: 'Check', doc_number: '', account_qb_id: defaultBank, gl_account_qb_id: defaultExp, entity_name: '', memo: '', amount: '' },
        ])
        setCreateMenuOpen(false)
        setGearMenuOpen(false)
        setBatchModalOpen(true)
    }

    const handleSaveBatchTransactions = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'batch_save_transactions',
                    realmId: activeRealmId,
                    rows: batchRows,
                })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error saving batch transactions')
            setBatchModalOpen(false)
            notify('ok', `Se guardaron ${json.insertedCount} transacciones del lote y se actualizaron los saldos.`)
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setSaving(false)
        }
    }

    // ── Print Checks Queue (+ Create -> Vendors -> Print Checks) ──
    const openPrintChecksModal = () => {
        const defaultBankId = bankAndCardAccounts[0]?.qb_account_id || ''
        setStartingPrintCheckNum(nextCheckNumberByBank[defaultBankId] || '1001')
        const needToPrint = checksList.filter(c => !c.is_voided && c.print_status === 'NeedToPrint')
        const pendingChecks = needToPrint.length > 0
            ? needToPrint
            : checksList.filter(c => !c.is_voided).slice(0, 15)
        setSelectedCheckIdsToPrint((needToPrint.length > 0 ? needToPrint : pendingChecks.slice(0, 3)).map(c => String(c.id)))
        setCreateMenuOpen(false)
        setGearMenuOpen(false)
        setPrintChecksModalOpen(true)
    }

    const handleBatchPrintChecks = async () => {
        const chosen = checksList.filter(c => selectedCheckIdsToPrint.includes(String(c.id)))
        if (chosen.length === 0) return
        const startNum = parseInt(startingPrintCheckNum || '1001', 10) || 1001
        const compName = activeCompany?.legal_name || activeCompany?.company_name || ''

        const assignedItems = chosen.map((chk, idx) => ({
            ...chk,
            assignedDocNum: chk.doc_number && /^\d+$/.test(chk.doc_number) ? chk.doc_number : String(startNum + idx)
        }))

        const pagesHtml = assignedItems.map((chk, pageIdx) => {
            const amountNum = Number(chk.total_amount || 0)
            const words = numberToEnglishWords(amountNum)
            const lines = Array.isArray(chk.line_items) && chk.line_items.length > 0
                ? chk.line_items
                : [{ account_name: chk.category_summary || '', description: chk.memo || '', amount: amountNum }]
            return `
              <div style="${pageIdx < assignedItems.length - 1 ? 'page-break-after: always;' : ''} padding-top: 4px;">
                <div style="border: 2px solid #0f172a; border-radius: 10px; padding: 20px 24px; background: #ffffff; margin-bottom: 18px;">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
                    <div>
                      <div style="font-size:16px; font-weight:800; text-transform:uppercase;">${escapeHtml(compName)}</div>
                      <div style="font-size:11px; color:#475569;">${escapeHtml(chk.account_name || '')}</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="font-size:11px; font-weight:700; color:#475569;">CHECK NO. <span style="font-size:16px; font-family:monospace; color:#0f172a;">#${escapeHtml(chk.assignedDocNum)}</span></div>
                      <div style="font-size:11px; margin-top:4px;">DATE: <strong style="font-family:monospace;">${escapeHtml(chk.txn_date)}</strong></div>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1.5px solid #334155; padding-bottom:8px; margin-bottom:12px;">
                    <div style="font-size:10px; font-weight:800; color:#475569;">${escapeHtml(t('external_accounting.pay_to_order_of'))}:</div>
                    <div style="flex:1; font-size:15px; font-weight:800;">${escapeHtml(chk.entity_name || chk.category_summary || '')}</div>
                    <div style="border:2px solid #0f172a; padding:6px 12px; font-family:monospace; font-size:15px; font-weight:900;">${escapeHtml(formatCurrency(amountNum))}</div>
                  </div>
                  <div style="display:flex; justify-content:space-between; border-bottom:1px solid #64748b; padding-bottom:6px; margin-bottom:22px; font-family:monospace; font-size:11px;">
                    <span>*** ${escapeHtml(words)} ***</span>
                    <span style="font-weight:800;">${escapeHtml(t('external_accounting.dollars_label'))}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div style="font-size:11px;"><strong>MEMO:</strong> ${escapeHtml(chk.memo || chk.category_summary || '')}</div>
                    <div style="width:230px; border-top:1.5px solid #0f172a; text-align:center; padding-top:4px; font-size:9px; font-weight:700; color:#475569;">AUTHORIZED SIGNATURE</div>
                  </div>
                </div>
                <div style="border:1px dashed #64748b; border-radius:8px; padding:14px 18px;">
                  <div style="font-size:10px; font-weight:800; color:#475569; margin-bottom:8px;">${escapeHtml(t('external_accounting.check_voucher_stub'))} — #${escapeHtml(chk.assignedDocNum)} (${escapeHtml(chk.txn_date)})</div>
                  <table>
                    <thead><tr><th>Account / Category</th><th>Description</th><th class="right">Amount</th></tr></thead>
                    <tbody>
                      ${lines.map((l: any) => `<tr><td>${escapeHtml(l.account_name || chk.category_summary || '')}</td><td>${escapeHtml(l.description || chk.memo || '')}</td><td class="right mono">${escapeHtml(formatCurrency(l.amount ?? amountNum))}</td></tr>`).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `
        }).join('')

        if (openCleanPrintWindow(`${compName}_BatchChecks_${assignedItems.length}`, pagesHtml, false)) {
            await authFetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'batch_mark_checks_printed',
                    realmId: activeRealmId,
                    items: assignedItems.map(c => ({ id: c.id, doc_number: c.assignedDocNum }))
                })
            })
            setPrintChecksModalOpen(false)
            await fetchWorkspaceData()
        } else {
            notify('err', t('external_accounting.print_popup_blocked'))
        }
    }

    if (!isAuthorized) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center p-6">
                <div className="max-w-lg w-full rounded-2xl border border-red-500/30 bg-white dark:bg-slate-900 p-8 text-center shadow-xl">
                    <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
                        <ShieldAlert size={32} />
                    </div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">
                        {t('external_accounting.access_restricted_title')}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                        {t('external_accounting.access_restricted_desc')}
                    </p>
                    <Link
                        href="/inicio"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-all"
                    >
                        {t('external_accounting.back_to_home')}
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-5">
            {/* Notification Toast */}
            {toastMsg && (
                <div className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-bold ${
                    toastMsg.type === 'ok'
                        ? 'bg-emerald-600 text-white border-emerald-400'
                        : 'bg-red-600 text-white border-red-400'
                }`}>
                    {toastMsg.type === 'ok' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                    <span>{toastMsg.text}</span>
                </div>
            )}

            {/* ====================================================================
                BARRA SUPERIOR UNIFICADA Y MINIMALISTA (CERO RUIDO VISUAL)
               ==================================================================== */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                {/* Fila Superior: Selector de Empresa + Acciones Maestras (+ Crear y ⚙️) */}
                <div className="px-6 pt-5 pb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
                            <Landmark size={18} />
                        </div>
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                {t('external_accounting.title')} · {companies.length} {t('external_accounting.companies_count_label')}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <select
                                    value={activeRealmId}
                                    onChange={(e) => {
                                        setActiveRealmId(e.target.value)
                                        setFilterAccountId('ALL')
                                        setPage(1)
                                        setCheckbookPage(1)
                                    }}
                                    className="text-xl md:text-2xl font-black tracking-tight text-slate-900 dark:text-white bg-transparent pr-2 focus:outline-none cursor-pointer"
                                >
                                    {companies.map(c => (
                                        <option key={c.realm_id} value={c.realm_id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-base font-bold">
                                            {c.company_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Controles Maestros a la Derecha: Filtro de Periodo Compacto + "+ Crear" + "⚙️" */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Selector compacto de periodo */}
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs">
                            <Calendar size={13} className="text-slate-400" />
                            <select
                                value={filterPeriod}
                                onChange={(e) => handlePeriodPreset(e.target.value)}
                                className="bg-transparent text-slate-700 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer"
                            >
                                <option value="ALL">{t('external_accounting.period_all_dates')}</option>
                                <option value="TODAY">{t('external_accounting.period_today')}</option>
                                <option value="THIS_MONTH">{t('external_accounting.period_this_month')}</option>
                                <option value="LAST_MONTH">{t('external_accounting.period_last_month')}</option>
                                <option value="THIS_QUARTER">{t('external_accounting.period_this_quarter')}</option>
                                <option value="THIS_YEAR">{t('external_accounting.period_this_year')}</option>
                                <option value="LAST_YEAR">{t('external_accounting.period_last_year')}</option>
                                <option value="2024">{t('external_accounting.period_year_2024')}</option>
                                <option value="2023">{t('external_accounting.period_year_2023')}</option>
                                <option value="2022">{t('external_accounting.period_year_2022')}</option>
                                <option value="CUSTOM">{t('external_accounting.period_custom')}</option>
                            </select>
                        </div>

                        {filterPeriod === 'CUSTOM' && (
                            <div className="inline-flex items-center gap-1 text-xs">
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => {
                                        setStartDate(e.target.value)
                                        setPage(1)
                                        setCheckbookPage(1)
                                    }}
                                    className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                />
                                <span className="text-slate-400">–</span>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => {
                                        setEndDate(e.target.value)
                                        setPage(1)
                                        setCheckbookPage(1)
                                    }}
                                    className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                />
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => openTransactionModal('Check')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                        >
                            <span>{t('external_accounting.btn_quick_check')}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => openTransactionModal('Deposit')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                        >
                            <span>{t('external_accounting.btn_quick_deposit')}</span>
                        </button>

                        {/* Botón Principal QBO "+ Crear" */}
                        <button
                            type="button"
                            onClick={() => {
                                setCreateMenuOpen(v => !v)
                                setGearMenuOpen(false)
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                            <Plus size={15} />
                            <span>{t('external_accounting.create_menu_btn').replace(/^\+\s*/, '')}</span>
                        </button>

                        {/* Engrane "⚙️" */}
                        <button
                            type="button"
                            onClick={() => {
                                setGearMenuOpen(v => !v)
                                setCreateMenuOpen(false)
                            }}
                            title={t('external_accounting.gear_menu_btn')}
                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                                gearMenuOpen
                                    ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200'
                            }`}
                        >
                            <Settings size={15} />
                            <span className="hidden sm:inline"> {t('external_accounting.btn_settings_short')}</span>
                        </button>

                        <button
                            type="button"
                            onClick={fetchWorkspaceData}
                            title={t('external_accounting.refresh')}
                            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-500 transition-colors cursor-pointer"
                        >
                            <RefreshCw size={15} className={loading ? 'animate-spin text-emerald-600' : ''} />
                        </button>
                    </div>
                </div>

                {/* Pestañas Horizontales Limpias (Estilo Editorial Subrayado — Sin Cajas Pesadas) */}
                <div className="px-6 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1 -mb-px">
                        {([
                            { id: 'overview' as ActiveTab, label: t('external_accounting.tab_overview_clean') },
                            { id: 'transactions' as ActiveTab, label: `${t('external_accounting.tab_transactions_clean')} (${(summary.totalRecords || 0).toLocaleString()})` },
                            { id: 'checks_deposits' as ActiveTab, label: t('external_accounting.tab_checkbook_clean') },
                            { id: 'reports' as ActiveTab, label: t('external_accounting.tab_reports_clean') },
                            { id: 'reconcile' as ActiveTab, label: t('external_accounting.tab_reconcile_clean') },
                            { id: 'accounts' as ActiveTab, label: `${t('external_accounting.tab_accounts_clean')} (${accounts.length})` },
                            { id: 'contacts' as ActiveTab, label: `${t('external_accounting.tab_contacts_clean')} (${contacts.length})` },
                        ]).map(tab => {
                            const isAct = activeTab === tab.id
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => {
                                        if (tab.id === 'reconcile' && !reconcileAccountId && bankAndCardAccounts[0]) {
                                            handleAutoSelectReconcileAccount(bankAndCardAccounts[0].qb_account_id)
                                        }
                                        setActiveTab(tab.id)
                                    }}
                                    className={`px-3.5 py-3 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                                        isAct
                                            ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                                            : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            )
                        })}

                        {/* Si una herramienta avanzada del engrane está activa, mostrar su pestaña activa */}
                        {['recurring', 'lists', 'reclassify', 'rules', 'budgeting', 'audit_log', 'company_settings'].includes(activeTab) && (
                            <span className="px-3.5 py-3 text-xs font-bold border-b-2 border-emerald-600 text-emerald-700 dark:text-emerald-400">
                                ⚙️ {activeTab === 'recurring' ? t('external_accounting.tab_recurring') : activeTab === 'lists' ? t('external_accounting.tab_lists') : activeTab === 'reclassify' ? t('external_accounting.tab_reclassify') : activeTab === 'rules' ? t('external_accounting.tab_rules') : activeTab === 'budgeting' ? t('external_accounting.tab_budgeting') : activeTab === 'audit_log' ? t('external_accounting.tab_audit_log') : t('external_accounting.tab_company_settings')}
                            </span>
                        )}
                    </div>

                    {/* Acciones discretas de Sincronización QBO + Exportar / Imprimir a la derecha de las pestañas */}
                    <div className="flex flex-wrap items-center gap-3 py-2 text-xs">
                        {activeCompany?.qbo_sync_enabled === false ? (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                <span>{t('external_accounting.qbo_status_standalone')}</span>
                                <button
                                    type="button"
                                    onClick={() => handleToggleQboMirrorMode(true)}
                                    className="ml-1 text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                                >
                                    {t('external_accounting.qbo_mode_enable_btn')}
                                </button>
                            </div>
                        ) : activeCompany?.qbo_connected ? (
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-[11px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                                    {t('external_accounting.qbo_status_connected')} ({companies.filter(c => c.qbo_connected).length}/{companies.filter(c => c.qbo_sync_enabled !== false).length})
                                </span>
                                <button
                                    type="button"
                                    disabled={qboSyncing}
                                    onClick={handleSyncWithQbo}
                                    className="font-bold text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer disabled:opacity-50"
                                >
                                    {qboSyncing ? t('external_accounting.qbo_syncing_msg') : `↻ ${t('external_accounting.qbo_btn_sync_now')}`}
                                </button>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <button
                                    type="button"
                                    disabled={qboSyncing}
                                    onClick={handleSyncAllWithQbo}
                                    className="font-bold text-blue-700 dark:text-blue-300 hover:underline cursor-pointer disabled:opacity-50"
                                >
                                    ⚡ {t('external_accounting.qbo_btn_sync_all')}
                                </button>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <button
                                    type="button"
                                    onClick={() => handleToggleQboMirrorMode(false)}
                                    className="text-slate-500 hover:text-red-600 cursor-pointer"
                                    title={t('external_accounting.qbo_mode_kill_btn')}
                                >
                                    {t('external_accounting.qbo_mode_kill_btn')}
                                </button>
                            </div>
                        ) : (
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-[11px]">
                                <button
                                    type="button"
                                    onClick={handleConnectAllQbo}
                                    className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                >
                                    ⚡ {t('external_accounting.qbo_btn_connect_all')}
                                </button>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <button
                                    type="button"
                                    onClick={handleConnectQbo}
                                    className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                >
                                    🔌 {t('external_accounting.qbo_btn_connect')}
                                </button>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <button
                                    type="button"
                                    onClick={() => handleToggleQboMirrorMode(false)}
                                    className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                >
                                    {t('external_accounting.qbo_mode_kill_btn')}
                                </button>
                            </div>
                        )}
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <button
                            type="button"
                            onClick={() => {
                                if (activeTab === 'reports') exportActiveReportXls()
                                else exportTransactionsXls()
                            }}
                            className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-bold cursor-pointer"
                        >
                            <Download size={13} />
                            <span>{t('external_accounting.btn_export_report_xls')}</span>
                        </button>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <button
                            type="button"
                            onClick={() => {
                                if (activeTab === 'reports') exportActiveReportCsv()
                                else exportTransactionsCsv()
                            }}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:hover:text-white font-semibold cursor-pointer"
                        >
                            <Download size={13} />
                            <span>{t('external_accounting.export_csv_short')}</span>
                        </button>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <button
                            type="button"
                            onClick={() => {
                                if (activeTab === 'reports') handlePrintActiveReport()
                                else if (activeTab === 'checks_deposits') handlePrintCheckbookList()
                                else if (activeTab === 'reconcile') handlePrintReconciliationReport()
                                else if (activeTab === 'budgeting') handlePrintBudgetReport()
                                else if (activeTab === 'audit_log') handlePrintAuditLog()
                                else handlePrintLedger()
                            }}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:hover:text-white font-semibold cursor-pointer"
                        >
                            <Printer size={13} />
                            <span>{t('external_accounting.print_pdf_short')}</span>
                        </button>
                    </div>
                </div>

                {/* QBO "+ CREATE" 4-COLUMN MEGA-MENU PANEL (Sober QBO Style) */}
                {createMenuOpen && (
                    <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
                        {/* Column 1: Sales / Customers */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.create_col_sales')}
                            </div>
                            {[
                                { mode: 'Invoice' as ModalMode, label: t('external_accounting.btn_new_invoice') },
                                { mode: 'Payment' as ModalMode, label: t('external_accounting.btn_new_payment') },
                                { mode: 'Estimate' as ModalMode, label: t('external_accounting.create_estimate') },
                                { mode: 'CreditMemo' as ModalMode, label: t('external_accounting.create_credit_memo') },
                                { mode: 'SalesReceipt' as ModalMode, label: t('external_accounting.create_sales_receipt') },
                                { mode: 'RefundReceipt' as ModalMode, label: t('external_accounting.create_refund_receipt') },
                            ].map(item => (
                                <button
                                    key={item.mode}
                                    type="button"
                                    onClick={() => openTransactionModal(item.mode)}
                                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                                >
                                    {item.label}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setEditingContact(null)
                                    setConFormName('')
                                    setConFormType('Customer')
                                    setConFormEmail('')
                                    setConFormPhone('')
                                    setConFormTaxId('')
                                    setConForm1099(false)
                                    setContactModalOpen(true)
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold transition-colors cursor-pointer"
                            >
                                {t('external_accounting.create_new_customer')}
                            </button>
                        </div>

                        {/* Column 2: Vendors */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.create_col_vendors')}
                            </div>
                            {[
                                { mode: 'Expense' as ModalMode, label: t('external_accounting.btn_new_expense') },
                                { mode: 'Check' as ModalMode, label: t('external_accounting.btn_new_check') },
                                { mode: 'Bill' as ModalMode, label: t('external_accounting.btn_new_bill') },
                                { mode: 'BillPayment' as ModalMode, label: t('external_accounting.btn_new_bill_payment') },
                                { mode: 'PurchaseOrder' as ModalMode, label: t('external_accounting.create_purchase_order') },
                                { mode: 'VendorCredit' as ModalMode, label: t('external_accounting.create_vendor_credit') },
                                { mode: 'CreditCardCredit' as ModalMode, label: t('external_accounting.create_cc_credit') },
                            ].map(item => (
                                <button
                                    key={item.mode}
                                    type="button"
                                    onClick={() => openTransactionModal(item.mode)}
                                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                                >
                                    {item.label}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={openPrintChecksModal}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                            >
                                <Printer size={13} />
                                <span>{t('external_accounting.create_print_checks')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setEditingContact(null)
                                    setConFormName('')
                                    setConFormType('Vendor')
                                    setConFormEmail('')
                                    setConFormPhone('')
                                    setConFormTaxId('')
                                    setConForm1099(false)
                                    setContactModalOpen(true)
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold transition-colors cursor-pointer"
                            >
                                {t('external_accounting.create_new_vendor')}
                            </button>
                        </div>

                        {/* Column 3: Team */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.create_col_team')}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setEditingContact(null)
                                    setConFormName('')
                                    setConFormType('Vendor')
                                    setConFormEmail('')
                                    setConFormPhone('')
                                    setConFormTaxId('')
                                    setConForm1099(true)
                                    setContactModalOpen(true)
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.create_contractor_1099')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setEditingContact(null)
                                    setConFormName('')
                                    setConFormType('Employee')
                                    setConFormEmail('')
                                    setConFormPhone('')
                                    setConFormTaxId('')
                                    setConForm1099(false)
                                    setContactModalOpen(true)
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.create_new_employee')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setActiveTab('contacts')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.tab_contacts')} ({contacts.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setActiveTab('recurring')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.tab_recurring')} ({recurring.length})
                            </button>
                        </div>

                        {/* Column 4: Other */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.create_col_other')}
                            </div>
                            <button
                                type="button"
                                onClick={() => openTransactionModal('Deposit')}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.btn_new_deposit')}
                            </button>
                            <button
                                type="button"
                                onClick={() => openTransactionModal('Transfer')}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.btn_new_transfer')}
                            </button>
                            <button
                                type="button"
                                onClick={() => openTransactionModal('JournalEntry')}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.btn_new_journal')}
                            </button>
                            <button
                                type="button"
                                onClick={() => openTransactionModal('PayDownCreditCard')}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.create_pay_down_cc')}
                            </button>
                            <button
                                type="button"
                                onClick={openBatchModal}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                            >
                                <Layers size={13} />
                                <span>{t('external_accounting.create_batch_transactions')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false)
                                    setActiveListKey('items')
                                    setEditingListItemId(null)
                                    setListItemName('')
                                    setListItemDesc('')
                                    setListItemPrice('0')
                                    setListItemType('Service')
                                    setListItemAccountId(accounts.find(a => a.classification === 'Revenue' || a.account_type === 'Income')?.qb_account_id || accounts[0]?.qb_account_id || '')
                                    setListItemModalOpen(true)
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold transition-colors cursor-pointer"
                            >
                                + {t('external_accounting.create_product_service')}
                            </button>
                        </div>
                    </div>
                )}

                {/* QBO GEAR ICON "⚙️" 4-COLUMN MEGA-MENU PANEL */}
                {gearMenuOpen && (
                    <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
                        {/* Column 1: Settings */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.gear_col_settings')}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('company_settings')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.gear_company_settings')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('accounts')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.gear_chart_of_accounts')} ({accounts.length})
                            </button>
                        </div>

                        {/* Column 2: Lists */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.gear_col_lists')}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveListKey('items')
                                    setActiveTab('lists')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.gear_all_lists')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveListKey('items')
                                    setActiveTab('lists')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.gear_products_services')} ({companyLists.items?.length || 0})
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('recurring')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.gear_recurring_transactions')} ({recurring.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('rules')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer"
                            >
                                {t('external_accounting.gear_rules')} ({bankRules.length})
                            </button>
                        </div>

                        {/* Column 3: Tools */}
                        <div className="space-y-1">
                            <div className="font-black uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-2 mb-2">
                                {t('external_accounting.gear_col_tools')}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    if (!reconcileAccountId && bankAndCardAccounts[0]) {
                                        handleAutoSelectReconcileAccount(bankAndCardAccounts[0].qb_account_id)
                                    }
                                    setActiveTab('reconcile')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold transition-colors cursor-pointer flex items-center gap-2"
                            >
                                <Scale size={14} className="text-slate-500" />
                                <span>{t('external_accounting.gear_reconcile')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('reclassify')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer flex items-center gap-2"
                            >
                                <Layers size={14} className="text-slate-500" />
                                <span>{t('external_accounting.gear_reclassify')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('budgeting')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer flex items-center gap-2"
                            >
                                <Calculator size={14} className="text-slate-500" />
                                <span>{t('external_accounting.gear_budgeting')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setGearMenuOpen(false)
                                    setActiveTab('audit_log')
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-medium transition-colors cursor-pointer flex items-center gap-2"
                            >
                                <History size={14} className="text-slate-500" />
                                <span>{t('external_accounting.gear_audit_log')} ({auditLog.length})</span>
                            </button>
                        </div>

                        {/* Column 4: Profile */}
                        <div className="space-y-2">
                            <div className="font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-1.5 mb-2">
                                {t('external_accounting.gear_col_profile')}
                            </div>
                            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                                <div className="font-bold text-slate-900 dark:text-white">{user?.name || 'Raquel Accounting'}</div>
                                <div className="text-[11px] text-slate-500">{user?.email}</div>
                                <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 pt-1">
                                    Method: {companyLists.accountingMethod || 'Accrual'}
                                </div>
                                {companyLists.closingDate && (
                                    <div className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-red-400">
                                        <Lock size={11} />
                                        <span>Closed: {companyLists.closingDate}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ====================================================================
                TAB 1: RESUMEN Y BANCOS (DISEÑO EDITORIAL LIMPIO EN 2 COLUMNAS)
               ==================================================================== */}
            {activeTab === 'overview' && (
                <div className="space-y-6">
                    {/* Tira Financiera Unificada (1 sola tarjeta dividida en 4 métricas limpias — Clic en cualquiera abre el Reporte Detallado PDF/XLS) */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
                        <div
                            onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:BANK', name: t('external_accounting.bs_total_bank_accounts'), current_balance: summary.totalBankBalance })}
                            title={t('external_accounting.drilldown_click_row_hint')}
                            className="p-5 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 cursor-pointer transition-colors group"
                        >
                            <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
                                <span>{t('external_accounting.kpi_bank_balance')}</span>
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 opacity-80 group-hover:underline">📊 {t('external_accounting.drilldown_view_txns_badge')}</span>
                            </div>
                            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                {formatCurrency(summary.totalBankBalance)}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1">
                                {bankAndCardAccounts.length} {t('external_accounting.banks_accounts_count_sub')}
                            </div>
                        </div>
                        <div
                            onClick={() => openPnlDrilldownReport(
                                {
                                    category: t('external_accounting.kpi_total_inflows'),
                                    amount: summary.totalInflows,
                                    transactions: depositsList.map(tx => ({
                                        ...tx,
                                        amount: Number(tx.total_amount || 0),
                                        split_account: tx.category_summary || tx.to_account_name || 'Deposit',
                                    })),
                                },
                                'Income'
                            )}
                            title={t('external_accounting.drilldown_click_row_hint')}
                            className="p-5 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 cursor-pointer transition-colors group"
                        >
                            <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
                                <span>{t('external_accounting.kpi_total_inflows')}</span>
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 opacity-80 group-hover:underline">📊 {t('external_accounting.drilldown_view_txns_badge')}</span>
                            </div>
                            <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 group-hover:underline">
                                +{formatCurrency(summary.totalInflows)}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1">
                                {summary.depositsCount || 0} {t('external_accounting.registered_deposits_sub')}
                            </div>
                        </div>
                        <div
                            onClick={() => openPnlDrilldownReport(
                                {
                                    category: t('external_accounting.kpi_total_outflows'),
                                    amount: summary.totalOutflows,
                                    transactions: transactions
                                        .filter(tx => tx.direction === 'OUT' || ['Check', 'Expense', 'Bill', 'BillPayment', 'VendorCredit'].includes(tx.txn_type))
                                        .map(tx => ({
                                            ...tx,
                                            amount: Number(tx.total_amount || 0),
                                            split_account: tx.category_summary || tx.to_account_name || 'Expense',
                                        })),
                                },
                                'Expense'
                            )}
                            title={t('external_accounting.drilldown_click_row_hint')}
                            className="p-5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                        >
                            <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
                                <span>{t('external_accounting.kpi_total_outflows')}</span>
                                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 opacity-80 group-hover:underline">📊 {t('external_accounting.drilldown_view_txns_badge')}</span>
                            </div>
                            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 group-hover:underline">
                                -{formatCurrency(summary.totalOutflows)}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1">
                                {summary.checksCount || 0} {t('external_accounting.checks_and_charges_sub')} ({summary.expensesCount || 0})
                            </div>
                        </div>
                        <div
                            onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:BANK', name: `${t('external_accounting.kpi_net_flow')} — ${t('external_accounting.bs_total_bank_accounts')}`, current_balance: summary.totalBankBalance })}
                            title={t('external_accounting.drilldown_click_row_hint')}
                            className="p-5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                        >
                            <div className="text-xs font-medium text-slate-500 flex items-center justify-between">
                                <span>{t('external_accounting.kpi_net_flow')}</span>
                                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 opacity-80 group-hover:underline">📊 {t('external_accounting.drilldown_view_txns_badge')}</span>
                            </div>
                            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 group-hover:underline">
                                {formatCurrency(summary.netCashFlow)}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1">
                                {(summary.totalRecords || 0).toLocaleString()} {t('external_accounting.total_movements_sub')}
                            </div>
                        </div>
                    </div>

                    {/* Diseño Limpio en 2 Columnas: Izquierda = Bancos y Movimientos de la Empresa Activa | Derecha = Las 8 Empresas */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* Columna Izquierda (7 cols): Cuentas Bancarias + Últimos Movimientos */}
                        <div className="lg:col-span-7 space-y-6">
                            {/* Tabla limpia de Cuentas Bancarias de la empresa activa */}
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <div>
                                        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                                            {t('external_accounting.bank_cards_section_title')} — {activeCompany?.company_name}
                                        </h2>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingAccount(null)
                                            setAccFormName('')
                                            setAccFormNum('')
                                            setAccFormType('Bank')
                                            setAccFormClass('Asset')
                                            setAccFormBalance('0')
                                            setAccountModalOpen(true)
                                        }}
                                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
                                    >
                                        {t('external_accounting.btn_add_account_short')}
                                    </button>
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {bankAndCardAccounts.map(acc => {
                                        const accBal = Number(acc.current_balance || 0)
                                        return (
                                            <div
                                                key={acc.id}
                                                onClick={() => openAccountQuickReport(acc)}
                                                title={t('external_accounting.drilldown_click_row_hint')}
                                                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
                                            >
                                                <div>
                                                    <div className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                                        {acc.name}
                                                    </div>
                                                    <div className="text-xs text-slate-400 mt-0.5 font-mono">
                                                        {acc.account_type} · {t('external_accounting.next_check_short')}: #{nextCheckNumberByBank[acc.qb_account_id] || '1001'}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="text-right">
                                                        <div className="text-base font-black font-mono text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                                            {formatCurrency(accBal)}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400">{t('external_accounting.book_balance_short')}</div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            type="button"
                                                            onClick={() => openAccountQuickReport(acc)}
                                                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                                                        >
                                                            📊 {t('external_accounting.coa_action_run_report')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setFilterAccountId(acc.qb_account_id)
                                                                setPage(1)
                                                                setActiveTab('transactions')
                                                            }}
                                                            className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                                                        >
                                                            {t('external_accounting.btn_view_register_short')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                handleAutoSelectReconcileAccount(acc.qb_account_id)
                                                                setActiveTab('reconcile')
                                                            }}
                                                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        >
                                                            {t('external_accounting.bank_card_reconcile')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintRecord('account', acc)}
                                                            title={t('external_accounting.action_print')}
                                                            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        >
                                                            <Printer size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditRecord('account', acc)}
                                                            title={t('external_accounting.action_edit')}
                                                            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                        >
                                                            <Edit3 size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                    <div
                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:BANK', name: t('external_accounting.bs_total_bank_accounts'), current_balance: summary.totalBankBalance })}
                                        className="px-5 py-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 flex items-center justify-between cursor-pointer transition-colors"
                                    >
                                        <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                            {t('external_accounting.bs_total_bank_accounts')} ({bankAndCardAccounts.length})
                                        </span>
                                        <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300 underline decoration-dotted">
                                            {formatCurrency(summary.totalBankBalance)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Últimos Movimientos en 1 sola tabla limpia */}
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        {t('external_accounting.recent_activity_title')}
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('transactions')}
                                        className="text-xs font-semibold text-emerald-600 hover:underline cursor-pointer"
                                    >
                                        {t('external_accounting.view_all_txns_link')} ({(summary.totalRecords || 0).toLocaleString()}) →
                                    </button>
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {transactions.slice(0, 7).map(txn => {
                                        const isIn = txn.direction === 'IN' || ['Deposit', 'Payment', 'SalesReceipt'].includes(txn.txn_type)
                                        return (
                                            <div
                                                key={txn.id}
                                                onClick={() => openRecordPreview('transaction', txn)}
                                                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                                            >
                                                <div className="min-w-0">
                                                    <div className="font-semibold text-slate-900 dark:text-white truncate">
                                                        {txn.entity_name || txn.category_summary || txn.txn_type}
                                                        {txn.doc_number ? <span className="ml-1.5 font-mono text-slate-400">#{txn.doc_number}</span> : null}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                                        {txn.txn_date} · {txn.account_name} · {txn.category_summary}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <div className={`font-bold font-mono ${
                                                        isIn ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
                                                    }`}>
                                                        {isIn ? '+' : '-'}{formatCurrency(txn.total_amount)}
                                                    </div>
                                                    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintRecord('transaction', txn)}
                                                            title={t('external_accounting.action_print')}
                                                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                                                        >
                                                            <Printer size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditRecord('transaction', txn)}
                                                            title={t('external_accounting.action_edit')}
                                                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-600 cursor-pointer"
                                                        >
                                                            <Edit3 size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openDeleteWizard('transaction', txn)}
                                                            title={t('external_accounting.action_delete')}
                                                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-600 cursor-pointer"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {transactions.length === 0 && (
                                        <div className="py-8 text-center text-slate-400">{t('external_accounting.no_records_found')}</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Columna Derecha (5 cols): Tabla Institucional Limpia de las 8 Empresas + Estados Financieros */}
                        <div className="lg:col-span-5 space-y-6">
                            {/* Lista limpia tipo tabla de las 8 empresas */}
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                                        {t('external_accounting.available_companies_title')} ({companies.length})
                                    </h2>
                                    <span className="text-[11px] text-slate-400">{t('external_accounting.click_to_switch_hint')}</span>
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {companies.map(c => {
                                        const isSel = c.realm_id === activeRealmId
                                        const bal = Number(c.total_cash_balance ?? c.overview?.totalBankBalance ?? 0)
                                        return (
                                            <button
                                                key={c.realm_id}
                                                type="button"
                                                onClick={() => {
                                                    setActiveRealmId(c.realm_id)
                                                    setFilterAccountId('ALL')
                                                    setPage(1)
                                                    setCheckbookPage(1)
                                                }}
                                                className={`w-full px-5 py-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                                                    isSel
                                                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                                }`}
                                            >
                                                <div className="min-w-0 flex items-center gap-2.5">
                                                    <span className={`w-2 h-2 rounded-full shrink-0 ${isSel ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
                                                    <div className="truncate">
                                                        <div className={`truncate ${isSel ? 'font-black text-emerald-900 dark:text-emerald-300' : 'font-semibold text-slate-800 dark:text-slate-200'}`}>
                                                            {c.company_name}
                                                        </div>
                                                        <div className="text-[11px] text-slate-400">
                                                            {c.active_banks_count ?? c.overview?.bankAccountsCount ?? 0} {t('external_accounting.banks_short_lower')} · {(c.total_txns_count ?? c.overview?.totalAccountsCount ?? 0).toLocaleString()} {t('external_accounting.movs_short_lower')}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                                                        {formatCurrency(bal)}
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Accesos directos limpios a Estados Financieros */}
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800">
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        {t('external_accounting.quick_statements_title')}
                                    </h3>
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                    {[
                                        { id: 'pnl', title: t('external_accounting.report_pnl'), desc: t('external_accounting.quick_report_pnl_desc') },
                                        { id: 'balance_sheet', title: t('external_accounting.report_balance_sheet'), desc: t('external_accounting.quick_report_bs_desc') },
                                        { id: 'bank_register', title: t('external_accounting.report_bank_register'), desc: t('external_accounting.quick_report_reg_desc') },
                                        { id: 'vendor_expenses', title: t('external_accounting.report_vendor_expenses'), desc: t('external_accounting.quick_report_vendor_desc') },
                                    ].map(rep => (
                                        <button
                                            key={rep.id}
                                            type="button"
                                            onClick={() => {
                                                setReportType(rep.id as any)
                                                setActiveTab('reports')
                                            }}
                                            className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                                        >
                                            <div>
                                                <div className="font-semibold text-slate-900 dark:text-white">{rep.title}</div>
                                                <div className="text-[11px] text-slate-400">{rep.desc}</div>
                                            </div>
                                            <ChevronRight size={14} className="text-slate-400 shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: INFLOWS, OUTFLOWS & BANK REGISTER (QBO BANK REGISTER STANDARD) */}
            {activeTab === 'transactions' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    {/* ④ QBO ACCOUNT REGISTER HEADER: Bank Switcher Pills + Ending Balance + Reconcile + 2-Line Toggle */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3.5 border-b border-slate-200 dark:border-slate-800">
                        <div className="space-y-1.5">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                {t('external_accounting.register_active_account_label')}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFilterAccountId('ALL')
                                        setPage(1)
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                                        filterAccountId === 'ALL'
                                            ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                                            : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                    }`}
                                >
                                    {t('external_accounting.register_all_accounts_consolidated')}
                                </button>
                                {bankAndCardAccounts.map(b => {
                                    const isSel = filterAccountId === b.qb_account_id
                                    return (
                                        <button
                                            key={b.id}
                                            type="button"
                                            onClick={() => {
                                                setFilterAccountId(b.qb_account_id)
                                                setInlineRegBankId(b.qb_account_id)
                                                setPage(1)
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border inline-flex items-center gap-2 ${
                                                isSel
                                                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                                            }`}
                                        >
                                            <span>{b.name}</span>
                                            <span className={`font-mono text-[11px] ${isSel ? 'text-emerald-300 dark:text-emerald-700 font-bold' : 'text-slate-400'}`}>
                                                {formatCurrency(b.current_balance)}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Active Register Ending Balance & View Mode Switcher */}
                        <div className="flex flex-wrap items-center gap-4">
                            {(() => {
                                const selectedAcct = accounts.find(a => a.qb_account_id === filterAccountId)
                                const displayBalance = selectedAcct
                                    ? Number(selectedAcct.current_balance || 0)
                                    : Number(summary.totalBankBalance || 0)
                                const nextChkNum = selectedAcct
                                    ? nextCheckNumberByBank[selectedAcct.qb_account_id]
                                    : null
                                return (
                                    <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                {t('external_accounting.register_ending_balance_label')}
                                            </div>
                                            <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                                                {formatCurrency(displayBalance)}
                                            </div>
                                        </div>
                                        {nextChkNum && (
                                            <div className="pl-3 border-l border-slate-200 dark:border-slate-700">
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                    {t('external_accounting.next_check_label')}
                                                </div>
                                                <div className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
                                                    #{nextChkNum}
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (selectedAcct) setReconcileAccountId(selectedAcct.qb_account_id)
                                                setActiveTab('reconcile')
                                            }}
                                            className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                                        >
                                            {t('external_accounting.tab_reconcile')}
                                        </button>
                                    </div>
                                )
                            })()}

                            {/* QBO 2-Line vs 1-Line Register Toggle */}
                            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setRegisterTwoLineView(true)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                                        registerTwoLineView
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {t('external_accounting.register_view_two_line')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRegisterTwoLineView(false)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                                        !registerTwoLineView
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {t('external_accounting.register_view_one_line')}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ② QBO INLINE REGISTER QUICK-ADD ROW (Check / Deposit / Expense right inside the register) */}
                    <form
                        onSubmit={handleSaveInlineRegister}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/40 p-3 space-y-2.5"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    {t('external_accounting.inline_add_title')}
                                </span>
                                <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
                                    {(['Check', 'Deposit', 'Expense'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => {
                                                setInlineRegType(mode)
                                                const targetBank = filterAccountId !== 'ALL'
                                                    ? filterAccountId
                                                    : (inlineRegBankId || bankAndCardAccounts[0]?.qb_account_id || '')
                                                if (mode === 'Check' && targetBank && nextCheckNumberByBank[targetBank]) {
                                                    setInlineRegDocNum(String(nextCheckNumberByBank[targetBank]))
                                                } else if (mode !== 'Check') {
                                                    setInlineRegDocNum('')
                                                }
                                            }}
                                            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                                                inlineRegType === mode
                                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                            }`}
                                        >
                                            {mode === 'Check'
                                                ? t('external_accounting.inline_btn_add_check')
                                                : mode === 'Deposit'
                                                ? t('external_accounting.inline_btn_add_deposit')
                                                : t('external_accounting.inline_btn_add_expense')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => openTransactionModal(inlineRegType)}
                                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                                {t('external_accounting.inline_btn_split_form')} →
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-center">
                            <input
                                type="date"
                                value={inlineRegDate}
                                onChange={(e) => setInlineRegDate(e.target.value)}
                                className="lg:col-span-2 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                                required
                            />
                            <input
                                type="text"
                                value={inlineRegDocNum}
                                onChange={(e) => setInlineRegDocNum(e.target.value)}
                                placeholder={inlineRegType === 'Check' ? 'Cheque #' : 'Ref #'}
                                className="lg:col-span-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                            />
                            <input
                                type="text"
                                list="qbo-inline-contacts-datalist"
                                value={inlineRegPayee}
                                onChange={(e) => setInlineRegPayee(e.target.value)}
                                placeholder={t('external_accounting.inline_placeholder_payee')}
                                className="lg:col-span-2 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                            />
                            <datalist id="qbo-inline-contacts-datalist">
                                {contacts.map(c => (
                                    <option key={c.id} value={c.display_name} />
                                ))}
                            </datalist>

                            {filterAccountId === 'ALL' && (
                                <select
                                    value={inlineRegBankId || bankAndCardAccounts[0]?.qb_account_id || ''}
                                    onChange={(e) => {
                                        setInlineRegBankId(e.target.value)
                                        if (inlineRegType === 'Check' && nextCheckNumberByBank[e.target.value]) {
                                            setInlineRegDocNum(String(nextCheckNumberByBank[e.target.value]))
                                        }
                                    }}
                                    className="lg:col-span-2 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                                >
                                    {bankAndCardAccounts.map(b => (
                                        <option key={b.qb_account_id} value={b.qb_account_id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                            )}

                            <select
                                value={inlineRegGlId || expenseAndGlAccounts[0]?.qb_account_id || ''}
                                onChange={(e) => setInlineRegGlId(e.target.value)}
                                className={`${filterAccountId === 'ALL' ? 'lg:col-span-2' : 'lg:col-span-3'} px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium`}
                            >
                                {expenseAndGlAccounts.map(g => (
                                    <option key={g.qb_account_id} value={g.qb_account_id}>
                                        {g.acct_num ? `${g.acct_num} · ` : ''}{g.name} ({g.account_type})
                                    </option>
                                ))}
                            </select>

                            <input
                                type="text"
                                value={inlineRegMemo}
                                onChange={(e) => setInlineRegMemo(e.target.value)}
                                placeholder={t('external_accounting.inline_placeholder_memo')}
                                className={`${filterAccountId === 'ALL' ? 'lg:col-span-1' : 'lg:col-span-2'} px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs`}
                            />

                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={inlineRegAmount}
                                onChange={(e) => setInlineRegAmount(e.target.value)}
                                placeholder={inlineRegType === 'Deposit' ? 'Depósito $' : 'Pago $'}
                                className="lg:col-span-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-right"
                                required
                            />

                            <button
                                type="submit"
                                disabled={saving}
                                className="lg:col-span-1 px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                                + {t('external_accounting.inline_btn_save')}
                            </button>
                        </div>
                    </form>

                    {/* Filter Bar */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                        <div className="relative lg:col-span-2">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value)
                                    setPage(1)
                                }}
                                placeholder={t('external_accounting.search_placeholder')}
                                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-400"
                            />
                        </div>

                        <select
                            value={filterType}
                            onChange={(e) => {
                                setFilterType(e.target.value)
                                setPage(1)
                            }}
                            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold"
                        >
                            <option value="ALL">{t('external_accounting.filter_all_types')}</option>
                            <option value="Check">{t('external_accounting.filter_checks')}</option>
                            <option value="Deposit">{t('external_accounting.filter_deposits')}</option>
                            <option value="EXPENSE_ALL">{t('external_accounting.filter_expenses')}</option>
                            <option value="JournalEntry">{t('external_accounting.filter_journals')}</option>
                            <option value="Transfer">{t('external_accounting.filter_transfers')}</option>
                            <option value="Bill">{t('external_accounting.filter_bills')}</option>
                            <option value="BillPayment">{t('external_accounting.filter_bill_payments')}</option>
                            <option value="Invoice">{t('external_accounting.filter_invoices')}</option>
                            <option value="Payment">{t('external_accounting.filter_payments')}</option>
                        </select>

                        <select
                            value={filterDirection}
                            onChange={(e) => {
                                setFilterDirection(e.target.value)
                                setPage(1)
                            }}
                            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold"
                        >
                            <option value="ALL">{t('external_accounting.filter_all_directions')}</option>
                            <option value="IN">{t('external_accounting.filter_inflows_only')}</option>
                            <option value="OUT">{t('external_accounting.filter_outflows_only')}</option>
                        </select>

                        <select
                            value={filterAccountId}
                            onChange={(e) => {
                                setFilterAccountId(e.target.value)
                                setPage(1)
                                setCheckbookPage(1)
                            }}
                            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold"
                        >
                            <option value="ALL">{t('external_accounting.filter_all_accounts')}</option>
                            {accounts.map(a => (
                                <option key={a.qb_account_id} value={a.qb_account_id}>
                                    {a.name} ({formatCurrency(a.current_balance)})
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={handlePrintLedger}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                        >
                            <Printer size={14} />
                            <span>{t('external_accounting.btn_print_ledger')}</span>
                        </button>
                    </div>

                    {/* ① & ③ QBO BANK REGISTER TABLE: 2-LINE VIEW (DEFAULT) OR 1-LINE VIEW */}
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        {registerTwoLineView ? (
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                                        <th className="py-2.5 px-3 w-[110px]">{t('external_accounting.col_date')}</th>
                                        <th className="py-2.5 px-3 w-[130px]">{t('external_accounting.col_ref_and_type')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_payee_and_account')}</th>
                                        <th className="py-2.5 px-3 text-right w-[125px]">{t('external_accounting.col_outflow')}</th>
                                        <th className="py-2.5 px-3 text-right w-[125px]">{t('external_accounting.col_inflow')}</th>
                                        <th className="py-2.5 px-2.5 text-center w-[52px]">✓</th>
                                        <th className="py-2.5 px-3 text-right w-[140px]">{t('external_accounting.col_balance')}</th>
                                        <th className="py-2.5 px-3 text-right w-[115px]">{t('external_accounting.col_actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                                    {transactions.map((row, idx) => {
                                        const isOut = row.direction === 'OUT' || row.direction === 'TRANSFER'
                                        const isIn = row.direction === 'IN'
                                        const lineItemsArr = Array.isArray(row.line_items) ? row.line_items : []
                                        const isSplit = lineItemsArr.length > 1
                                        const zebraClass = idx % 2 === 1 ? 'bg-slate-50/45 dark:bg-slate-800/20' : 'bg-white dark:bg-slate-900'

                                        return (
                                            <tr
                                                key={row.id}
                                                onClick={() => openRecordPreview('transaction', row)}
                                                className={`${zebraClass} hover:bg-slate-100/70 dark:hover:bg-slate-800/50 transition-colors align-top cursor-pointer ${
                                                    row.is_voided ? 'opacity-50 line-through' : ''
                                                }`}
                                            >
                                                {/* Col 1: Date */}
                                                <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-800 dark:text-slate-200 font-semibold">
                                                    <div>{row.txn_date}</div>
                                                    {filterAccountId === 'ALL' && row.account_name && (
                                                        <div className="text-[10px] font-sans font-normal text-slate-400 mt-0.5 truncate max-w-[115px]" title={row.account_name}>
                                                            {row.account_name}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* Col 2: Ref No. (Line 1) + Type & QBO Sync Status (Line 2) */}
                                                <td className="py-2.5 px-3 whitespace-nowrap">
                                                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                                                        {row.doc_number ? `#${row.doc_number}` : '—'}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium flex items-center gap-1.5">
                                                        <span>{row.txn_type}</span>
                                                        {String(row.qb_txn_id || '').startsWith('LOCAL-') || row.raw_data?.qbo_sync_status === 'PENDING_QBO_SYNC' ? (
                                                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300" title={row.raw_data?.qbo_sync_error || t('external_accounting.qbo_badge_pending')}>
                                                                ⏳ {t('external_accounting.qbo_badge_pending')}
                                                            </span>
                                                        ) : row.qb_txn_id ? (
                                                            <span className="text-[9px] font-mono text-slate-400" title={`${t('external_accounting.qbo_badge_synced')} #${row.qb_txn_id}`}>
                                                                QBO#{row.qb_txn_id}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>

                                                {/* Col 3: Payee (Line 1) + GL Account / -SPLIT- Breakdown & Memo (Line 2) */}
                                                <td className="py-2.5 px-3">
                                                    <div className="font-semibold text-slate-900 dark:text-white text-[13px] leading-snug flex flex-wrap items-center gap-1.5">
                                                        <span>{row.entity_name || row.category_summary || '—'}</span>
                                                        {row.department_name && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 font-sans font-semibold text-[10px]">
                                                                📍 {row.department_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                        {isSplit ? (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono font-bold text-[10px]">
                                                                {t('external_accounting.split_badge_label')} ({lineItemsArr.length} {t('external_accounting.split_lines_count')})
                                                            </span>
                                                        ) : (
                                                            <span className="font-medium text-slate-600 dark:text-slate-300">
                                                                {row.category_summary || row.account_name || '—'}
                                                            </span>
                                                        )}
                                                        {row.memo && (
                                                            <span className="text-slate-400 dark:text-slate-500 italic">
                                                                — {row.memo}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* ③ Visible Split Breakdown (when transaction has 2+ GL distribution lines) */}
                                                    {isSplit && (
                                                        <div className="mt-1.5 pl-2.5 border-l-2 border-slate-200 dark:border-slate-700 space-y-0.5">
                                                            {lineItemsArr.slice(0, 4).map((li: any, liIdx: number) => (
                                                                <div key={liIdx} className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between max-w-lg">
                                                                    <span className="truncate pr-2">
                                                                        • {li.entity_name ? `${li.entity_name} · ` : ''}
                                                                        {li.check_num ? `#${li.check_num} · ` : ''}
                                                                        {li.account_name || li.description || 'Cuenta GL'}
                                                                        {li.description && li.account_name ? ` (${li.description})` : ''}
                                                                    </span>
                                                                    <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-300">
                                                                        {formatCurrency(li.amount)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {lineItemsArr.length > 4 && (
                                                                <div className="text-[10px] text-slate-400 italic">
                                                                    +{lineItemsArr.length - 4} líneas adicionales...
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* Col 4: Payment / Outflow */}
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                                    {isOut ? formatCurrency(row.total_amount) : ''}
                                                </td>

                                                {/* Col 5: Deposit / Inflow */}
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                                    {isIn ? formatCurrency(row.total_amount) : ''}
                                                </td>

                                                {/* Col 6: Cleared / Reconciled Status (C / R / U) */}
                                                <td className="py-2.5 px-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                    {row.is_voided ? (
                                                        <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase">
                                                            VOID
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleClearedStatus(row)}
                                                            title={t('external_accounting.col_status')}
                                                            className={`w-6 h-6 rounded text-[11px] font-mono font-bold cursor-pointer transition-colors inline-flex items-center justify-center border ${
                                                                row.cleared_status === 'Reconciled'
                                                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                                                    : row.cleared_status === 'Cleared'
                                                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                                                                    : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                                                            }`}
                                                        >
                                                            {row.cleared_status === 'Reconciled' ? 'R' : row.cleared_status === 'Cleared' ? 'C' : ''}
                                                        </button>
                                                    )}
                                                </td>

                                                {/* Col 7: Running Balance */}
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                                    {row.running_balance != null ? formatCurrency(row.running_balance) : '—'}
                                                </td>

                                                {/* Col 8: Actions */}
                                                <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                    <div className="inline-flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintRecord('transaction', row)}
                                                            title={t('external_accounting.action_print')}
                                                            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        >
                                                            <Printer size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditRecord('transaction', row)}
                                                            title={t('external_accounting.action_edit')}
                                                            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        >
                                                            <Edit3 size={13} />
                                                        </button>
                                                        {!row.is_voided && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleVoidTransaction(row)}
                                                                title={t('external_accounting.action_void')}
                                                                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                                                            >
                                                                <Ban size={13} />
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteTransaction(row)}
                                                            title={t('external_accounting.action_delete')}
                                                            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-600 dark:text-red-400 cursor-pointer"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {transactions.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="py-10 text-center text-slate-400">
                                                {t('external_accounting.no_records_found')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        ) : (
                            /* Compact 1-Line View */
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                                        <th className="py-2.5 px-3">{t('external_accounting.col_date')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_type')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_doc_num')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_payee')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_account')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_category')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_memo')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_outflow')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_inflow')}</th>
                                        <th className="py-2.5 px-3 text-center">✓</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_balance')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                    {transactions.map(row => {
                                        const isOut = row.direction === 'OUT' || row.direction === 'TRANSFER'
                                        const isIn = row.direction === 'IN'
                                        return (
                                            <tr
                                                key={row.id}
                                                onClick={() => openRecordPreview('transaction', row)}
                                                className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${
                                                    row.is_voided ? 'opacity-50 line-through' : ''
                                                }`}
                                            >
                                                <td className="py-2 px-3 font-mono whitespace-nowrap">{row.txn_date}</td>
                                                <td className="py-2 px-3 whitespace-nowrap font-medium text-slate-600 dark:text-slate-300">{row.txn_type}</td>
                                                <td className="py-2 px-3 font-mono font-bold">{row.doc_number || '—'}</td>
                                                <td className="py-2 px-3 font-semibold max-w-[180px] truncate">{row.entity_name || '—'}</td>
                                                <td className="py-2 px-3 text-slate-600 dark:text-slate-400 max-w-[160px] truncate">{row.account_name || '—'}</td>
                                                <td className="py-2 px-3 text-slate-600 dark:text-slate-400 max-w-[180px] truncate">{row.category_summary || '—'}</td>
                                                <td className="py-2 px-3 text-slate-500 max-w-[180px] truncate">{row.memo || '—'}</td>
                                                <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                                    {isOut ? formatCurrency(row.total_amount) : ''}
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                                    {isIn ? formatCurrency(row.total_amount) : ''}
                                                </td>
                                                <td className="py-2 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleClearedStatus(row)}
                                                        className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-[10px] font-mono font-bold cursor-pointer"
                                                    >
                                                        {row.cleared_status === 'Reconciled' ? 'R' : row.cleared_status === 'Cleared' ? 'C' : 'U'}
                                                    </button>
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono font-bold whitespace-nowrap">
                                                    {row.running_balance != null ? formatCurrency(row.running_balance) : '—'}
                                                </td>
                                                <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                    <div className="inline-flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintRecord('transaction', row)}
                                                            title={t('external_accounting.action_print')}
                                                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 cursor-pointer"
                                                        >
                                                            <Printer size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditRecord('transaction', row)}
                                                            title={t('external_accounting.action_edit')}
                                                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 cursor-pointer"
                                                        >
                                                            <Edit3 size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteTransaction(row)}
                                                            title={t('external_accounting.action_delete')}
                                                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-600 cursor-pointer"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* True Server-Side Pagination Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-slate-600 dark:text-slate-400">
                        <div className="flex items-center gap-3">
                            <span>
                                {t('external_accounting.showing_range')}{' '}
                                <strong>{pagination.totalFiltered === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}</strong>
                                {' – '}
                                <strong>{Math.min(pagination.page * pagination.pageSize, pagination.totalFiltered)}</strong>
                                {' '}{t('external_accounting.of_total')}{' '}
                                <strong>{pagination.totalFiltered.toLocaleString()}</strong>{' '}
                                {t('external_accounting.records_label')}
                            </span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value))
                                    setPage(1)
                                }}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold text-xs"
                            >
                                <option value={50}>50 {t('external_accounting.per_page')}</option>
                                <option value={100}>100 {t('external_accounting.per_page')}</option>
                                <option value={250}>250 {t('external_accounting.per_page')}</option>
                                <option value={500}>500 {t('external_accounting.per_page')}</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={!pagination.hasPrevPage || loading}
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 font-bold cursor-pointer"
                            >
                                ← {t('external_accounting.prev_page')}
                            </button>
                            <span className="font-mono font-bold px-2">
                                {t('external_accounting.page_label')} {pagination.page} / {pagination.totalPages}
                            </span>
                            <button
                                type="button"
                                disabled={!pagination.hasNextPage || loading}
                                onClick={() => setPage(p => p + 1)}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 font-bold cursor-pointer"
                            >
                                {t('external_accounting.next_page')} →
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 3: DEDICATED CHECKS & DEPOSITS WORKSPACE */}
            {activeTab === 'checks_deposits' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Checks Column */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-black uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-2">
                                <ArrowUpRight size={16} />
                                <span>{t('external_accounting.checks_issued_title')} ({checkbookPagination.totalFiltered || checksList.length})</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handlePrintCheckbookList}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold cursor-pointer"
                                >
                                    <Printer size={13} />
                                    <span>{t('external_accounting.btn_print_checkbook')}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openTransactionModal('Check')}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                                >
                                    <Plus size={14} />
                                    <span>{t('external_accounting.btn_new_check')}</span>
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-[600px]">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase">
                                    <tr>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_date')}</th>
                                        <th className="py-2.5 px-3">#</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_payee')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_category')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                        <th className="py-2.5 px-3 text-center">{t('external_accounting.col_actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                    {checksList.map(chk => (
                                        <tr
                                            key={chk.id}
                                            onClick={() => openRecordPreview('transaction', chk)}
                                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors ${chk.is_voided ? 'opacity-50 line-through' : ''}`}
                                        >
                                            <td className="py-2 px-3 font-mono whitespace-nowrap">{chk.txn_date}</td>
                                            <td className="py-2 px-3 font-mono font-bold">{chk.doc_number || '—'}</td>
                                            <td className="py-2 px-3 font-semibold truncate max-w-[150px]">{chk.entity_name || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-[140px]">{chk.category_summary || '—'}</td>
                                            <td className="py-2 px-3 text-right font-black text-red-600 dark:text-red-400 whitespace-nowrap">
                                                {formatCurrency(chk.total_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrintRecord('transaction', chk)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                                                        title={t('external_accounting.action_print')}
                                                    >
                                                        <Printer size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditRecord('transaction', chk)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                                        title={t('external_accounting.action_edit')}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteTransaction(chk)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-500 cursor-pointer"
                                                        title={t('external_accounting.action_delete')}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {checkbookPagination.totalPages > 1 && (
                            <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
                                <span>
                                    {t('external_accounting.page_label')} {checkbookPagination.page} / {checkbookPagination.totalPages} ({checkbookPagination.totalFiltered} {t('external_accounting.records_label')})
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        disabled={!checkbookPagination.hasPrevPage || loading}
                                        onClick={() => setCheckbookPage(p => Math.max(1, p - 1))}
                                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 disabled:opacity-40 font-bold cursor-pointer"
                                    >
                                        ← {t('external_accounting.prev_page')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!checkbookPagination.hasNextPage || loading}
                                        onClick={() => setCheckbookPage(p => p + 1)}
                                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 disabled:opacity-40 font-bold cursor-pointer"
                                    >
                                        {t('external_accounting.next_page')} →
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Deposits Column */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3.5">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                <ArrowDownRight size={16} />
                                <span>{t('external_accounting.deposits_made_title')} ({depositsList.length})</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => openTransactionModal('Deposit')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                            >
                                <Plus size={14} />
                                <span>{t('external_accounting.btn_new_deposit')}</span>
                            </button>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-[600px]">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase">
                                    <tr>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_date')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_payee')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_account')}</th>
                                        <th className="py-2.5 px-3">{t('external_accounting.col_memo')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                        <th className="py-2.5 px-3 text-center">{t('external_accounting.col_actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                    {depositsList.map(dep => (
                                        <tr
                                            key={dep.id}
                                            onClick={() => openRecordPreview('transaction', dep)}
                                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors ${dep.is_voided ? 'opacity-50 line-through' : ''}`}
                                        >
                                            <td className="py-2 px-3 font-mono whitespace-nowrap">{dep.txn_date}</td>
                                            <td className="py-2 px-3 font-semibold truncate max-w-[150px]">{dep.entity_name || dep.category_summary || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-[140px]">{dep.account_name || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-[150px]">{dep.memo || '—'}</td>
                                            <td className="py-2 px-3 text-right font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                +{formatCurrency(dep.total_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrintRecord('transaction', dep)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                                                        title={t('external_accounting.action_print')}
                                                    >
                                                        <Printer size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditRecord('transaction', dep)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                                        title={t('external_accounting.action_edit')}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteTransaction(dep)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-500 cursor-pointer"
                                                        title={t('external_accounting.action_delete')}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 4: RECURRING TRANSACTIONS (/app/recurring) */}
            {activeTab === 'recurring' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <Repeat size={18} className="text-emerald-500" />
                                <span>{t('external_accounting.tab_recurring')} — {activeCompany?.company_name}</span>
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5">{t('external_accounting.recurring_subtitle')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingRecurring(null)
                                setRecFormName('')
                                setRecFormRecurType('Automated')
                                setRecFormTxnType('Check')
                                setRecFormInterval('Monthly')
                                setRecFormNumInterval('1')
                                setRecFormNextDate(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
                                setRecFormAccountQbId(bankAndCardAccounts[0]?.qb_account_id || accounts[0]?.qb_account_id || '')
                                setRecFormGlAccountQbId(expenseAndGlAccounts[0]?.qb_account_id || '')
                                setRecFormEntityName('')
                                setRecFormMemo('')
                                setRecFormAmount('0')
                                setRecurringModalOpen(true)
                            }}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                        >
                            {t('external_accounting.btn_new_recurring')}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                    <th className="py-3 px-3">{t('external_accounting.col_template_name')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_recur_type')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_type')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_interval')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_prev_date')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_next_date')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_account')}</th>
                                    <th className="py-3 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                    <th className="py-3 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {recurring.map(rec => (
                                    <tr
                                        key={rec.id}
                                        onClick={() => openRecordPreview('recurring', rec)}
                                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                                    >
                                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">{rec.template_name}</td>
                                        <td className="py-3 px-3">
                                            <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                                                {rec.recur_type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-3 font-semibold">{rec.txn_type}</td>
                                        <td className="py-3 px-3 text-slate-500">
                                            {rec.interval_type ? `Every ${rec.num_interval || 1} ${rec.interval_type}` : 'Unscheduled'}
                                        </td>
                                        <td className="py-3 px-3 font-mono">{rec.previous_date || '—'}</td>
                                        <td className="py-3 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{rec.next_date || '—'}</td>
                                        <td className="py-3 px-3 text-slate-500">{rec.account_name || '—'}</td>
                                        <td className="py-3 px-3 text-right font-black">{formatCurrency(rec.amount)}</td>
                                        <td className="py-3 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                            <div className="inline-flex items-center gap-1.5">
                                                {Number(rec.amount || 0) > 0 && (
                                                    <button
                                                        type="button"
                                                        disabled={saving}
                                                        onClick={() => handleExecuteRecurring(rec)}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                                                    >
                                                        <CheckCircle2 size={13} />
                                                        <span>{t('external_accounting.btn_use_recurring')}</span>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => openFromRecurringTemplate(rec)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-xs cursor-pointer"
                                                >
                                                    <Edit3 size={12} />
                                                    <span>{t('external_accounting.btn_open_in_editor')}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePrintRecord('recurring', rec)}
                                                    title={t('external_accounting.action_print')}
                                                    className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                >
                                                    <Printer size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleEditRecord('recurring', rec)}
                                                    title={t('external_accounting.action_edit')}
                                                    className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                                >
                                                    <Edit3 size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteRecurring(rec)}
                                                    title={t('external_accounting.action_delete')}
                                                    className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-500 cursor-pointer"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {recurring.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="py-8 text-center text-slate-400">
                                            {t('external_accounting.no_records_found')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 5: CHART OF ACCOUNTS & BALANCES */}
            {activeTab === 'accounts' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="relative w-full sm:w-80">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={accountSearch}
                                onChange={(e) => setAccountSearch(e.target.value)}
                                placeholder={t('external_accounting.search_placeholder')}
                                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingAccount(null)
                                setAccFormName('')
                                setAccFormNum('')
                                setAccFormType('Bank')
                                setAccFormSubType('Checking')
                                setAccFormClass('Asset')
                                setAccFormDesc('')
                                setAccFormIsSub(false)
                                setAccFormParentId('')
                                setAccFormBalance('0')
                                setAccountModalOpen(true)
                            }}
                            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 font-bold text-xs cursor-pointer"
                        >
                            {t('external_accounting.btn_new_account')}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                    <th className="py-2.5 px-3">{t('external_accounting.col_acct_num')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_acct_name')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_classification')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_acct_type')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_sub_type')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_acct_desc')}</th>
                                    <th className="py-2.5 px-3 text-center">{t('external_accounting.col_acct_status')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_current_balance')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {filteredAccounts.map(acc => {
                                    const isBalanceSheetAcct = ['Asset', 'Liability', 'Equity'].includes(acc.classification || '') ||
                                        ['Bank', 'Credit Card', 'Other Current Asset', 'Fixed Asset', 'Accounts Payable', 'Accounts Receivable', 'Other Current Liability', 'Long Term Liability', 'Equity'].includes(acc.account_type || '')
                                    const descText = acc.raw_data?.Description || ''
                                    return (
                                        <tr
                                            key={acc.id}
                                            onClick={() => openRecordPreview('account', acc)}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                                        >
                                            <td className="py-2.5 px-3 font-mono text-slate-500">{acc.acct_num || '—'}</td>
                                            <td className="py-2.5 px-3">
                                                <div className={`font-bold text-slate-900 dark:text-white flex items-center gap-1.5 ${acc.is_sub_account ? 'pl-4' : ''}`}>
                                                    {acc.is_sub_account && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
                                                            ↳ {t('external_accounting.sub_account_badge')}
                                                        </span>
                                                    )}
                                                    <span>{acc.name}</span>
                                                </div>
                                                {acc.is_sub_account && acc.fully_qualified_name && acc.fully_qualified_name !== acc.name && (
                                                    <div className="pl-4 text-[10px] text-slate-400 font-mono mt-0.5">
                                                        {acc.fully_qualified_name}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{acc.classification || '—'}</td>
                                            <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300">{acc.account_type}</td>
                                            <td className="py-2.5 px-3 text-slate-500">{acc.account_sub_type || '—'}</td>
                                            <td className="py-2.5 px-3 text-slate-500 max-w-[200px] truncate" title={descText}>{descText || '—'}</td>
                                            <td className="py-2.5 px-3 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                    acc.is_active !== false
                                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                                }`}>
                                                    {acc.is_active !== false ? t('external_accounting.status_active') : t('external_accounting.status_inactive')}
                                                </span>
                                            </td>
                                            <td
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    openAccountQuickReport(acc)
                                                }}
                                                title={t('external_accounting.drilldown_click_hint')}
                                                className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline cursor-pointer"
                                            >
                                                {acc.current_balance != null ? formatCurrency(acc.current_balance) : '—'}
                                            </td>
                                            <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1.5">
                                                    {isBalanceSheetAcct && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setFilterAccountId(acc.qb_account_id)
                                                                setSearchQuery('')
                                                                setPage(1)
                                                                setActiveTab('transactions')
                                                            }}
                                                            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer mr-1"
                                                        >
                                                            {t('external_accounting.coa_action_view_register')}
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => openAccountQuickReport(acc)}
                                                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer mr-1"
                                                    >
                                                        {t('external_accounting.coa_action_run_report')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrintRecord('account', acc)}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        title={t('external_accounting.action_print')}
                                                    >
                                                        <Printer size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditRecord('account', acc)}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                        title={t('external_accounting.action_edit')}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openDeleteWizard('account', acc)}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-600 dark:text-red-400 cursor-pointer"
                                                        title={t('external_accounting.action_delete')}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 6: VENDORS & CUSTOMERS */}
            {activeTab === 'contacts' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative w-full sm:w-72">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={contactSearch}
                                    onChange={(e) => setContactSearch(e.target.value)}
                                    placeholder={t('external_accounting.search_placeholder')}
                                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                                />
                            </div>
                            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px] font-bold">
                                {([
                                    { key: 'ALL', label: `${t('external_accounting.filter_all_contacts')} (${contacts.length})` },
                                    { key: 'Vendor', label: `${t('external_accounting.filter_vendors_only')} (${contacts.filter(c => c.contact_type === 'Vendor').length})` },
                                    { key: 'Customer', label: `${t('external_accounting.filter_customers_only')} (${contacts.filter(c => c.contact_type === 'Customer').length})` },
                                    { key: '1099', label: `${t('external_accounting.filter_1099_only')} (${contacts.filter(c => c.vendor_1099).length})` },
                                ] as const).map(pill => (
                                    <button
                                        key={pill.key}
                                        type="button"
                                        onClick={() => setContactFilterType(pill.key)}
                                        className={`px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                                            contactFilterType === pill.key
                                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {pill.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingContact(null)
                                setConFormName('')
                                setConFormCompany('')
                                setConFormPrintOnCheck('')
                                setConFormAcctNum('')
                                setConFormAddress('')
                                setConFormBalance('0')
                                setConFormType('Vendor')
                                setConFormEmail('')
                                setConFormPhone('')
                                setConFormTaxId('')
                                setConForm1099(false)
                                setContactModalOpen(true)
                            }}
                            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 font-bold text-xs cursor-pointer"
                        >
                            {t('external_accounting.btn_new_contact')}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                    <th className="py-2.5 px-3">{t('external_accounting.col_contact_name')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_company_check_name')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_contact_type')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_email')} / {t('external_accounting.col_phone')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_billing_address')}</th>
                                    <th className="py-2.5 px-3">{t('external_accounting.col_tax_id')} / Acct #</th>
                                    <th className="py-2.5 px-3 text-center">{t('external_accounting.col_1099')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_open_balance')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {filteredContacts.map(c => {
                                    const formattedAddr = c.address
                                        ? [c.address.Line1, c.address.City, c.address.CountrySubDivisionCode, c.address.PostalCode].filter(Boolean).join(', ')
                                        : ''
                                    return (
                                        <tr
                                            key={c.id}
                                            onClick={() => openRecordPreview('contact', c)}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                                        >
                                            <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{c.display_name}</td>
                                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                                                <div>{c.company_name || c.print_on_check_name || '—'}</div>
                                                {c.print_on_check_name && c.company_name && c.print_on_check_name !== c.company_name && (
                                                    <div className="text-[10px] text-slate-400">Cheque: {c.print_on_check_name}</div>
                                                )}
                                            </td>
                                            <td className="py-2.5 px-3">
                                                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold">
                                                    {c.contact_type === 'Customer' ? t('external_accounting.type_customer') : t('external_accounting.type_vendor')}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 text-slate-500">
                                                <div>{c.email || '—'}</div>
                                                {c.phone && <div className="text-[11px] font-mono text-slate-400">{c.phone}</div>}
                                            </td>
                                            <td className="py-2.5 px-3 text-slate-500 max-w-[200px] truncate" title={formattedAddr}>
                                                {formattedAddr || '—'}
                                            </td>
                                            <td className="py-2.5 px-3 font-mono text-slate-500">
                                                <div>{c.tax_identifier || '—'}</div>
                                                {c.acct_num && <div className="text-[10px] text-slate-400">Acct: {c.acct_num}</div>}
                                            </td>
                                            <td className="py-2.5 px-3 text-center">
                                                {c.vendor_1099 ? (
                                                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-black text-[10px]">1099</span>
                                                ) : '—'}
                                            </td>
                                            <td
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    openListOrContactQuickReport('contact', c.display_name, c.qb_contact_id || c.id, c.display_name)
                                                }}
                                                title={t('external_accounting.drilldown_click_hint')}
                                                className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline cursor-pointer"
                                            >
                                                {formatCurrency(c.balance || 0)}
                                            </td>
                                            <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => openListOrContactQuickReport('contact', c.display_name, c.qb_contact_id || c.id, c.display_name)}
                                                        className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer mr-1"
                                                    >
                                                        {t('external_accounting.coa_action_run_report')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setFilterAccountId('ALL')
                                                            setSearchQuery(c.display_name)
                                                            setPage(1)
                                                            setActiveTab('transactions')
                                                        }}
                                                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer mr-1"
                                                    >
                                                        {t('external_accounting.contact_action_view_txns')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrintRecord('contact', c)}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        title={t('external_accounting.action_print')}
                                                    >
                                                        <Printer size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditRecord('contact', c)}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                        title={t('external_accounting.action_edit')}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openDeleteWizard('contact', c)}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-red-600 dark:text-red-400 cursor-pointer"
                                                        title={t('external_accounting.action_delete')}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 7: ADVANCED CPA REPORTS (CONTADORA) */}
            {activeTab === 'reports' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-5">
                    {/* Report Controls */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end border-b border-slate-200 dark:border-slate-800 pb-4">
                        <div className="lg:col-span-2">
                            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                {t('external_accounting.select_report_type')}
                            </label>
                            <select
                                value={reportType}
                                onChange={(e) => setReportType(e.target.value)}
                                className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/30 font-bold text-xs"
                            >
                                <option value="pnl">{t('external_accounting.report_pnl')}</option>
                                <option value="balance_sheet">{t('external_accounting.report_balance_sheet')}</option>
                                <option value="bank_register">{t('external_accounting.report_bank_register')}</option>
                                <option value="general_ledger">{t('external_accounting.report_general_ledger')}</option>
                                <option value="trial_balance">{t('external_accounting.report_trial_balance')}</option>
                                <option value="vendor_expenses">{t('external_accounting.report_vendor_expenses')}</option>
                                <option value="customer_income">{t('external_accounting.report_customer_income')}</option>
                                <option value="check_detail">{t('external_accounting.report_check_detail')}</option>
                                <option value="deposit_detail">{t('external_accounting.report_deposit_detail')}</option>
                                <option value="qbo_archive">{t('external_accounting.report_qbo_archive')}</option>
                            </select>
                        </div>

                        {reportType === 'qbo_archive' ? (
                            <div className="lg:col-span-2">
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                    {t('external_accounting.select_qbo_snapshot')}
                                </label>
                                <select
                                    value={reportQboKey}
                                    onChange={(e) => setReportQboKey(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold text-xs"
                                >
                                    {(reportData?.availableArchives || []).map((a: any) => (
                                        <option key={a.report_key} value={a.report_key}>
                                            {a.report_key} ({a.accounting_method || 'QBO'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <>
                                {reportType === 'bank_register' ? (
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                            {t('external_accounting.col_account')}
                                        </label>
                                        <select
                                            value={filterAccountId}
                                            onChange={(e) => setFilterAccountId(e.target.value)}
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold text-xs"
                                        >
                                            <option value="ALL">{t('external_accounting.filter_all_accounts')}</option>
                                            {bankAndCardAccounts.map(acc => (
                                                <option key={acc.qb_account_id} value={acc.qb_account_id}>
                                                    {acc.name} ({acc.account_type})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                            {t('external_accounting.accounting_basis')}
                                        </label>
                                        <select
                                            value={reportBasis}
                                            onChange={(e) => setReportBasis(e.target.value as 'Accrual' | 'Cash')}
                                            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold text-xs"
                                        >
                                            <option value="Accrual">{t('external_accounting.basis_accrual')}</option>
                                            <option value="Cash">{t('external_accounting.basis_cash')}</option>
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                                        {t('external_accounting.col_date')}
                                    </label>
                                    <select
                                        value={filterPeriod}
                                        onChange={(e) => handlePeriodPreset(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold text-xs"
                                    >
                                        <option value="ALL">{t('external_accounting.period_all_dates')}</option>
                                        <option value="TODAY">{t('external_accounting.period_today')}</option>
                                        <option value="THIS_MONTH">{t('external_accounting.period_this_month')}</option>
                                        <option value="LAST_MONTH">{t('external_accounting.period_last_month')}</option>
                                        <option value="THIS_QUARTER">{t('external_accounting.period_this_quarter')}</option>
                                        <option value="THIS_YEAR">{t('external_accounting.period_this_year')}</option>
                                        <option value="LAST_YEAR">{t('external_accounting.period_last_year')}</option>
                                        <option value="2024">{t('external_accounting.period_year_2024')}</option>
                                        <option value="2023">{t('external_accounting.period_year_2023')}</option>
                                        <option value="2022">{t('external_accounting.period_year_2022')}</option>
                                        <option value="CUSTOM">{t('external_accounting.period_custom')}</option>
                                    </select>
                                </div>
                            </>
                        )}

                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={exportActiveReportXls}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-bold text-xs cursor-pointer"
                            >
                                <Download size={13} />
                                <span>{t('external_accounting.btn_export_report_xls')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={exportActiveReportCsv}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold text-xs cursor-pointer"
                            >
                                <Download size={13} />
                                <span>.CSV</span>
                            </button>
                            <button
                                type="button"
                                onClick={handlePrintActiveReport}
                                className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                            >
                                <Printer size={13} />
                                <span>PDF</span>
                            </button>
                        </div>
                    </div>

                    {reportLoading ? (
                        <div className="py-12 text-center text-sm text-slate-400">{t('external_accounting.loading_data')}</div>
                    ) : (
                        <div className="space-y-6">
                            {/* Report Header Banner */}
                            <div className="text-center border-b border-slate-200 dark:border-slate-800 pb-4">
                                <h2 className="text-xl font-black text-slate-900 dark:text-white">
                                    {activeCompany?.legal_name || activeCompany?.company_name}
                                </h2>
                                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                    {reportType === 'pnl' && t('external_accounting.report_pnl')}
                                    {reportType === 'balance_sheet' && t('external_accounting.report_balance_sheet')}
                                    {reportType === 'bank_register' && t('external_accounting.report_bank_register')}
                                    {reportType === 'general_ledger' && t('external_accounting.report_general_ledger')}
                                    {reportType === 'trial_balance' && t('external_accounting.report_trial_balance')}
                                    {reportType === 'vendor_expenses' && t('external_accounting.report_vendor_expenses')}
                                    {reportType === 'customer_income' && t('external_accounting.report_customer_income')}
                                    {reportType === 'check_detail' && t('external_accounting.report_check_detail')}
                                    {reportType === 'deposit_detail' && t('external_accounting.report_deposit_detail')}
                                    {reportType === 'qbo_archive' && (reportData?.archiveReport?.title || t('external_accounting.report_qbo_archive'))}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {reportBasis} · {startDate || 'All Dates'} — {endDate || 'Present'}
                                </p>
                            </div>

                            {/* 1. P&L View */}
                            {reportType === 'pnl' && reportData?.pnl && (
                                <div className="space-y-6 overflow-x-auto">
                                    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                                        <span>💡 {t('external_accounting.drilldown_click_hint')}</span>
                                        <span className="font-mono text-[11px]">PDF · Excel (.XLS) · .CSV</span>
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">
                                            {t('external_accounting.income_section')}
                                        </h3>
                                        <table className="w-full text-xs border-collapse">
                                            {reportData.pnl.years?.length > 1 && (
                                                <thead>
                                                    <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                                        <th className="py-2 px-2 text-left">{t('external_accounting.col_category')}</th>
                                                        {reportData.pnl.years.map((yr: string) => (
                                                            <th key={yr} className="py-2 px-2 text-right font-mono">{yr}</th>
                                                        ))}
                                                        <th className="py-2 px-2 text-right font-mono">TOTAL</th>
                                                    </tr>
                                                </thead>
                                            )}
                                            <tbody>
                                                {reportData.pnl.incomeRows.map((r: any) => (
                                                    <tr
                                                        key={r.category}
                                                        onClick={() => openPnlDrilldownReport(r, 'Income')}
                                                        title={t('external_accounting.drilldown_click_hint')}
                                                        className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                                    >
                                                        <td className="py-2 px-2 font-medium group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                                            <span>{r.category}</span>
                                                            <span className="ml-2 text-[10px] font-mono text-slate-400">
                                                                ({(r.transactions || []).length})
                                                            </span>
                                                        </td>
                                                        {reportData.pnl.years?.length > 1 && reportData.pnl.years.map((yr: string) => (
                                                            <td
                                                                key={yr}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    openPnlDrilldownReport(r, 'Income', yr)
                                                                }}
                                                                className="py-2 px-2 text-right font-mono text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
                                                            >
                                                                {r.byYear?.[yr] ? formatCurrency(r.byYear[yr]) : '—'}
                                                            </td>
                                                        ))}
                                                        <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300 group-hover:underline">
                                                            {formatCurrency(r.amount)}
                                                        </td>
                                                    </tr>
                                                ))}
                                                <tr
                                                    onClick={() => openPnlDrilldownReport({
                                                        category: t('external_accounting.total_income'),
                                                        amount: reportData.pnl.totalIncome,
                                                        byYear: reportData.pnl.incomeByYear,
                                                        transactions: reportData.pnl.incomeRows.flatMap((x: any) => x.transactions || [])
                                                    }, 'Income')}
                                                    title={t('external_accounting.drilldown_click_hint')}
                                                    className="bg-emerald-500/10 hover:bg-emerald-500/20 font-black cursor-pointer transition-colors"
                                                >
                                                    <td className="py-2.5 px-2">{t('external_accounting.total_income')}</td>
                                                    {reportData.pnl.years?.length > 1 && reportData.pnl.years.map((yr: string) => (
                                                        <td
                                                            key={yr}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                openPnlDrilldownReport({
                                                                    category: t('external_accounting.total_income'),
                                                                    amount: reportData.pnl.totalIncome,
                                                                    byYear: reportData.pnl.incomeByYear,
                                                                    transactions: reportData.pnl.incomeRows.flatMap((x: any) => x.transactions || [])
                                                                }, 'Income', yr)
                                                            }}
                                                            className="py-2.5 px-2 text-right font-mono text-emerald-600/80 dark:text-emerald-400/80 hover:underline"
                                                        >
                                                            {formatCurrency(reportData.pnl.incomeByYear?.[yr] || 0)}
                                                        </td>
                                                    ))}
                                                    <td className="py-2.5 px-2 text-right font-mono text-emerald-600 dark:text-emerald-400 underline decoration-dotted">
                                                        {formatCurrency(reportData.pnl.totalIncome)}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">
                                            {t('external_accounting.expense_section')}
                                        </h3>
                                        <table className="w-full text-xs border-collapse">
                                            {reportData.pnl.years?.length > 1 && (
                                                <thead>
                                                    <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                                        <th className="py-2 px-2 text-left">{t('external_accounting.col_category')}</th>
                                                        {reportData.pnl.years.map((yr: string) => (
                                                            <th key={yr} className="py-2 px-2 text-right font-mono">{yr}</th>
                                                        ))}
                                                        <th className="py-2 px-2 text-right font-mono">TOTAL</th>
                                                    </tr>
                                                </thead>
                                            )}
                                            <tbody>
                                                {reportData.pnl.expenseRows.map((r: any) => (
                                                    <tr
                                                        key={r.category}
                                                        onClick={() => openPnlDrilldownReport(r, 'Expense')}
                                                        title={t('external_accounting.drilldown_click_hint')}
                                                        className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-red-500/10 cursor-pointer transition-colors group"
                                                    >
                                                        <td className="py-2 px-2 font-medium group-hover:text-red-600 dark:group-hover:text-red-400 group-hover:underline">
                                                            <span>{r.category}</span>
                                                            <span className="ml-2 text-[10px] font-mono text-slate-400">
                                                                ({(r.transactions || []).length})
                                                            </span>
                                                        </td>
                                                        {reportData.pnl.years?.length > 1 && reportData.pnl.years.map((yr: string) => (
                                                            <td
                                                                key={yr}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    openPnlDrilldownReport(r, 'Expense', yr)
                                                                }}
                                                                className="py-2 px-2 text-right font-mono text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:underline"
                                                            >
                                                                {r.byYear?.[yr] ? formatCurrency(r.byYear[yr]) : '—'}
                                                            </td>
                                                        ))}
                                                        <td className="py-2 px-2 text-right font-mono font-bold text-red-700 dark:text-red-300 group-hover:underline">
                                                            {formatCurrency(r.amount)}
                                                        </td>
                                                    </tr>
                                                ))}
                                                <tr
                                                    onClick={() => openPnlDrilldownReport({
                                                        category: t('external_accounting.total_expenses'),
                                                        amount: reportData.pnl.totalExpenses,
                                                        byYear: reportData.pnl.expenseByYear,
                                                        transactions: reportData.pnl.expenseRows.flatMap((x: any) => x.transactions || [])
                                                    }, 'Expense')}
                                                    title={t('external_accounting.drilldown_click_hint')}
                                                    className="bg-red-500/10 hover:bg-red-500/20 font-black cursor-pointer transition-colors"
                                                >
                                                    <td className="py-2.5 px-2">{t('external_accounting.total_expenses')}</td>
                                                    {reportData.pnl.years?.length > 1 && reportData.pnl.years.map((yr: string) => (
                                                        <td
                                                            key={yr}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                openPnlDrilldownReport({
                                                                    category: t('external_accounting.total_expenses'),
                                                                    amount: reportData.pnl.totalExpenses,
                                                                    byYear: reportData.pnl.expenseByYear,
                                                                    transactions: reportData.pnl.expenseRows.flatMap((x: any) => x.transactions || [])
                                                                }, 'Expense', yr)
                                                            }}
                                                            className="py-2.5 px-2 text-right font-mono text-red-600/80 dark:text-red-400/80 hover:underline"
                                                        >
                                                            {formatCurrency(reportData.pnl.expenseByYear?.[yr] || 0)}
                                                        </td>
                                                    ))}
                                                    <td className="py-2.5 px-2 text-right font-mono text-red-600 dark:text-red-400 underline decoration-dotted">
                                                        {formatCurrency(reportData.pnl.totalExpenses)}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div
                                        onClick={() => openPnlDrilldownReport({
                                            category: t('external_accounting.net_income'),
                                            amount: reportData.pnl.netIncome,
                                            transactions: [
                                                ...reportData.pnl.incomeRows.flatMap((x: any) => x.transactions || []),
                                                ...reportData.pnl.expenseRows.flatMap((x: any) => (x.transactions || []).map((tItem: any) => ({ ...tItem, amount: -Math.abs(Number(tItem.amount || 0)) })))
                                            ]
                                        }, 'Net')}
                                        title={t('external_accounting.drilldown_click_hint')}
                                        className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-between font-black text-base cursor-pointer transition-colors"
                                    >
                                        <span>{t('external_accounting.net_income')}</span>
                                        <span className="font-mono text-emerald-400 underline decoration-dotted">{formatCurrency(reportData.pnl.netIncome)}</span>
                                    </div>
                                </div>
                            )}

                            {/* 2. Balance Sheet View (QBO Hierarchical & 100% Clickable) */}
                            {reportType === 'balance_sheet' && reportData?.balanceSheet && (
                                <div className="space-y-6 text-xs">
                                    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                                        <span>💡 {t('external_accounting.drilldown_click_hint')}</span>
                                        <span className="font-mono text-[11px]">PDF · Excel (.XLS) · .CSV</span>
                                    </div>

                                    {/* ASSETS */}
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                        <div className="bg-emerald-500/10 px-3 py-2 font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300 border-b border-slate-200 dark:border-slate-800">
                                            {t('external_accounting.assets_section')}
                                        </div>

                                        <div className="p-2 space-y-2">
                                            <div className="font-bold text-slate-700 dark:text-slate-300 px-2 pt-1">
                                                ▾ {t('external_accounting.bs_current_assets')}
                                            </div>

                                            {/* Bank Accounts */}
                                            {(reportData.balanceSheet.bankAccounts?.length > 0) && (
                                                <div className="pl-3 space-y-0.5">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_bank_accounts')}
                                                    </div>
                                                    {reportData.balanceSheet.bankAccounts.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                                                {a.name}
                                                            </span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                                                {formatCurrency(a.current_balance)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:BANK', name: t('external_accounting.bs_total_bank_accounts'), account_type: 'Bank' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700 group"
                                                    >
                                                        <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">
                                                            {t('external_accounting.bs_total_bank_accounts')}
                                                        </span>
                                                        <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300 underline decoration-dotted">
                                                            {formatCurrency(reportData.balanceSheet.totalBankAccounts)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Accounts Receivable */}
                                            {(reportData.balanceSheet.accountsReceivable?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-1">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_accounts_receivable')}
                                                    </div>
                                                    {reportData.balanceSheet.accountsReceivable.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:AR', name: t('external_accounting.bs_total_ar'), account_type: 'Accounts Receivable' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700 group"
                                                    >
                                                        <span className="group-hover:underline">{t('external_accounting.bs_total_ar')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalAccountsReceivable)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Other Current Assets */}
                                            {(reportData.balanceSheet.otherCurrentAssets?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-1">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_other_current_assets')}
                                                    </div>
                                                    {reportData.balanceSheet.otherCurrentAssets.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:OCA', name: t('external_accounting.bs_total_oca'), account_type: 'Other Current Asset' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700 group"
                                                    >
                                                        <span className="group-hover:underline">{t('external_accounting.bs_total_oca')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalOtherCurrentAssets)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Total Current Assets */}
                                            <div
                                                onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:CURRENT_ASSETS', name: t('external_accounting.bs_total_current_assets'), account_type: 'Current Assets' })}
                                                className="flex justify-between py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 font-black cursor-pointer transition-colors border-t border-emerald-500/30"
                                            >
                                                <span>{t('external_accounting.bs_total_current_assets')}</span>
                                                <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalCurrentAssets)}</span>
                                            </div>

                                            {/* Fixed Assets */}
                                            {(reportData.balanceSheet.fixedAssets?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-2">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_fixed_assets')}
                                                    </div>
                                                    {reportData.balanceSheet.fixedAssets.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:FIXED_ASSETS', name: t('external_accounting.bs_total_fixed_assets'), account_type: 'Fixed Asset' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700 group"
                                                    >
                                                        <span className="group-hover:underline">{t('external_accounting.bs_total_fixed_assets')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalFixedAssets)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Other Assets */}
                                            {(reportData.balanceSheet.otherAssets?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-2">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_other_assets')}
                                                    </div>
                                                    {reportData.balanceSheet.otherAssets.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:OTHER_ASSETS', name: t('external_accounting.bs_total_other_assets'), account_type: 'Other Asset' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700 group"
                                                    >
                                                        <span className="group-hover:underline">{t('external_accounting.bs_total_other_assets')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalOtherAssets)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* TOTAL ASSETS */}
                                            <div
                                                onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:TOTAL_ASSETS', name: t('external_accounting.total_assets'), account_type: 'Assets' })}
                                                className="flex justify-between py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm cursor-pointer transition-colors mt-2"
                                            >
                                                <span>{t('external_accounting.total_assets')}</span>
                                                <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalAssets)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* LIABILITIES & EQUITY */}
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                        <div className="bg-amber-500/10 px-3 py-2 font-black uppercase tracking-wider text-amber-700 dark:text-amber-300 border-b border-slate-200 dark:border-slate-800">
                                            {t('external_accounting.liabilities_section')} & {t('external_accounting.equity_section')}
                                        </div>

                                        <div className="p-2 space-y-2">
                                            <div className="font-bold text-slate-700 dark:text-slate-300 px-2 pt-1">
                                                ▾ {t('external_accounting.bs_current_liabilities')}
                                            </div>

                                            {/* Accounts Payable */}
                                            {(reportData.balanceSheet.accountsPayable?.length > 0) && (
                                                <div className="pl-3 space-y-0.5">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_accounts_payable')}
                                                    </div>
                                                    {reportData.balanceSheet.accountsPayable.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-amber-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:AP', name: t('external_accounting.bs_total_ap'), account_type: 'Accounts Payable' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-amber-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700"
                                                    >
                                                        <span>{t('external_accounting.bs_total_ap')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalAccountsPayable)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Credit Cards */}
                                            {(reportData.balanceSheet.creditCards?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-1">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_credit_cards')}
                                                    </div>
                                                    {reportData.balanceSheet.creditCards.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-amber-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:CC', name: t('external_accounting.bs_total_cc'), account_type: 'Credit Card' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-amber-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700"
                                                    >
                                                        <span>{t('external_accounting.bs_total_cc')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalCreditCards)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Other Current Liabilities */}
                                            {(reportData.balanceSheet.otherCurrentLiabilities?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-1">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_other_current_liabilities')}
                                                    </div>
                                                    {reportData.balanceSheet.otherCurrentLiabilities.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-amber-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:OCL', name: t('external_accounting.bs_total_ocl'), account_type: 'Other Current Liability' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-amber-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700"
                                                    >
                                                        <span>{t('external_accounting.bs_total_ocl')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalOtherCurrentLiabilities)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Total Current Liabilities */}
                                            <div
                                                onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:CURRENT_LIABILITIES', name: t('external_accounting.bs_total_current_liabilities'), account_type: 'Current Liabilities' })}
                                                className="flex justify-between py-2 px-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 font-black cursor-pointer transition-colors border-t border-amber-500/30"
                                            >
                                                <span>{t('external_accounting.bs_total_current_liabilities')}</span>
                                                <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalCurrentLiabilities)}</span>
                                            </div>

                                            {/* Long-Term Liabilities */}
                                            {(reportData.balanceSheet.longTermLiabilities?.length > 0) && (
                                                <div className="pl-3 space-y-0.5 pt-2">
                                                    <div className="font-semibold text-slate-500 dark:text-slate-400 px-2 py-1">
                                                        ▾ {t('external_accounting.bs_long_term_liabilities')}
                                                    </div>
                                                    {reportData.balanceSheet.longTermLiabilities.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-amber-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:LTL', name: t('external_accounting.bs_total_ltl'), account_type: 'Long Term Liability' })}
                                                        className="flex justify-between py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-amber-500/15 font-black cursor-pointer transition-colors border-t border-slate-200 dark:border-slate-700"
                                                    >
                                                        <span>{t('external_accounting.bs_total_ltl')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalLongTermLiabilities)}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Total Liabilities */}
                                            <div
                                                onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:TOTAL_LIABILITIES', name: t('external_accounting.total_liabilities'), account_type: 'Liabilities' })}
                                                className="flex justify-between py-2 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-black cursor-pointer transition-colors"
                                            >
                                                <span>{t('external_accounting.total_liabilities')}</span>
                                                <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalLiabilities)}</span>
                                            </div>

                                            {/* Equity */}
                                            <div className="pt-3">
                                                <div className="font-bold text-blue-600 dark:text-blue-400 px-2 py-1">
                                                    ▾ {t('external_accounting.equity_section')}
                                                </div>
                                                <div className="pl-3 space-y-0.5">
                                                    {reportData.balanceSheet.equity.map((a: any) => (
                                                        <div
                                                            key={a.id}
                                                            onClick={() => openAccountQuickReport(a)}
                                                            style={{ paddingLeft: `${16 + (a.depth || 0) * 16}px` }}
                                                            className="flex justify-between py-1.5 pr-3 rounded-lg hover:bg-blue-500/10 cursor-pointer transition-colors group"
                                                        >
                                                            <span className="group-hover:underline">{a.name}</span>
                                                            <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(a.current_balance)}</span>
                                                        </div>
                                                    ))}
                                                    <div
                                                        onClick={() => {
                                                            setReportType('pnl')
                                                        }}
                                                        className="flex justify-between py-1.5 pl-4 pr-3 rounded-lg hover:bg-blue-500/10 cursor-pointer italic transition-colors group"
                                                    >
                                                        <span className="group-hover:underline">{t('external_accounting.retained_net_income')}</span>
                                                        <span className="font-mono font-bold tabular-nums group-hover:underline">{formatCurrency(reportData.balanceSheet.retainedNetIncome)}</span>
                                                    </div>
                                                    <div
                                                        onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:EQUITY', name: t('external_accounting.bs_total_equity'), account_type: 'Equity' })}
                                                        className="flex justify-between py-2 px-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 font-black cursor-pointer transition-colors border-t border-blue-500/30"
                                                    >
                                                        <span>{t('external_accounting.bs_total_equity')}</span>
                                                        <span className="font-mono tabular-nums underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalEquity)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* TOTAL LIABILITIES AND EQUITY */}
                                            <div
                                                onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:LIABILITIES_AND_EQUITY', name: t('external_accounting.total_liabilities_equity'), account_type: 'Liabilities & Equity' })}
                                                className="flex justify-between py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-sm cursor-pointer transition-colors mt-2"
                                            >
                                                <span>{t('external_accounting.total_liabilities_equity')}</span>
                                                <span className="font-mono tabular-nums text-emerald-400 underline decoration-dotted">{formatCurrency(reportData.balanceSheet.totalLiabilitiesAndEquity)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 3. Trial Balance View */}
                            {reportType === 'trial_balance' && reportData?.trialBalance && (
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_acct_name')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_acct_type')}</th>
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_debit')}</th>
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_credit')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                        {reportData.trialBalance.rows.map((r: any) => {
                                            const matchedAcct = accounts.find(a => a.qb_account_id === r.account_id || a.name === r.name) || {
                                                qb_account_id: r.account_id,
                                                name: r.name,
                                                account_type: r.account_type
                                            }
                                            return (
                                                <tr
                                                    key={r.account_id}
                                                    onClick={() => openAccountQuickReport(matchedAcct)}
                                                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                                >
                                                    <td className="py-2 px-3 font-semibold hover:underline">{r.name}</td>
                                                    <td className="py-2 px-3 text-slate-500">{r.account_type}</td>
                                                    <td className="py-2 px-3 text-right font-mono">{r.debit ? formatCurrency(r.debit) : '—'}</td>
                                                    <td className="py-2 px-3 text-right font-mono">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                                                </tr>
                                            )
                                        })}
                                        <tr
                                            onClick={() => openAccountQuickReport({ qb_account_id: 'GROUP:ALL_TRIAL_BALANCE', name: t('external_accounting.report_trial_balance') })}
                                            className="bg-slate-100 dark:bg-slate-800 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors"
                                        >
                                            <td colSpan={2} className="py-2.5 px-3 underline decoration-dotted">{t('external_accounting.totals_label')}</td>
                                            <td className="py-2.5 px-3 text-right font-mono underline decoration-dotted">{formatCurrency(reportData.trialBalance.totalDebit)}</td>
                                            <td className="py-2.5 px-3 text-right font-mono underline decoration-dotted">{formatCurrency(reportData.trialBalance.totalCredit)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}

                            {/* 4. Vendor Expenses / Customer Income View */}
                            {(reportType === 'vendor_expenses' || reportType === 'customer_income') && reportData?.entitySummary && (
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_category')}</th>
                                            <th className="py-2.5 px-3 text-center">{t('external_accounting.col_txns_count')}</th>
                                            <th className="py-2.5 px-3 text-center">{t('external_accounting.col_last_date')}</th>
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                        {reportData.entitySummary.rows.map((r: any) => (
                                            <tr
                                                key={r.name}
                                                onClick={() => openPnlDrilldownReport({
                                                    category: `${r.name} — ${reportType === 'vendor_expenses' ? t('external_accounting.report_vendor_expenses') : t('external_accounting.report_customer_income')}`,
                                                    amount: Number(r.total_amount || 0),
                                                    transactions: r.transactions || []
                                                }, reportType === 'vendor_expenses' ? 'Expense' : 'Income')}
                                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group"
                                            >
                                                <td className="py-2 px-3 font-bold group-hover:underline">{r.name}</td>
                                                <td className="py-2 px-3 text-slate-500">{r.categories}</td>
                                                <td className="py-2 px-3 text-center font-mono">{r.count}</td>
                                                <td className="py-2 px-3 text-center font-mono">{r.last_date}</td>
                                                <td className="py-2 px-3 text-right font-mono font-black group-hover:underline">{formatCurrency(r.total_amount)}</td>
                                            </tr>
                                        ))}
                                        <tr
                                            onClick={() => openPnlDrilldownReport({
                                                category: reportType === 'vendor_expenses' ? t('external_accounting.report_vendor_expenses') : t('external_accounting.report_customer_income'),
                                                amount: Number(reportData.entitySummary.grandTotal || 0),
                                                transactions: reportData.entitySummary.rows.flatMap((x: any) => x.transactions || [])
                                            }, reportType === 'vendor_expenses' ? 'Expense' : 'Income')}
                                            className="bg-slate-100 dark:bg-slate-800 hover:bg-emerald-500/15 font-black cursor-pointer transition-colors"
                                        >
                                            <td colSpan={4} className="py-2.5 px-3 underline decoration-dotted">{t('external_accounting.totals_label')}</td>
                                            <td className="py-2.5 px-3 text-right font-mono underline decoration-dotted">{formatCurrency(reportData.entitySummary.grandTotal)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}

                            {/* 5. Bank Register / Check Detail / Deposit Detail */}
                            {(reportType === 'bank_register' || reportType === 'check_detail' || reportType === 'deposit_detail') && (
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_date')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_type')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_doc_num')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_category')}</th>
                                            {reportType === 'bank_register' ? (
                                                <>
                                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_outflow')}</th>
                                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_inflow')}</th>
                                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_balance')}</th>
                                                </>
                                            ) : (
                                                <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                            )}
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                        {(reportData?.bankRegister?.rows || reportData?.detailReport?.rows || []).map((r: any) => (
                                            <tr
                                                key={r.id}
                                                onClick={() => openRecordPreview('transaction', r)}
                                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                            >
                                                <td className="py-2 px-3 font-mono">{r.txn_date}</td>
                                                <td className="py-2 px-3">{r.txn_type}</td>
                                                <td className="py-2 px-3 font-mono">{r.doc_number || '—'}</td>
                                                <td className="py-2 px-3 font-semibold">{r.entity_name || '—'}</td>
                                                <td className="py-2 px-3 text-slate-500">{r.category_summary || '—'}</td>
                                                {reportType === 'bank_register' ? (
                                                    <>
                                                        <td className="py-2 px-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                                                            {r.outflow ? formatCurrency(r.outflow) : '—'}
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                            {r.inflow ? formatCurrency(r.inflow) : '—'}
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-mono font-black">
                                                            {formatCurrency(r.running_balance || 0)}
                                                        </td>
                                                    </>
                                                ) : (
                                                    <td className="py-2 px-3 text-right font-mono font-bold">
                                                        {formatCurrency(r.total_amount ?? (r.inflow || r.outflow))}
                                                    </td>
                                                )}
                                                <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                    <div className="inline-flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintRecord('transaction', r)}
                                                            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_print')}
                                                        >
                                                            <Printer size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditRecord('transaction', r)}
                                                            className="p-1 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_edit')}
                                                        >
                                                            <Edit3 size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openDeleteWizard('transaction', r)}
                                                            className="p-1 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_delete')}
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {/* 6. General Ledger View */}
                            {reportType === 'general_ledger' && reportData?.generalLedger && (
                                <div className="space-y-4">
                                    {reportData.generalLedger.map((acct: any) => (
                                        <div key={acct.account_name} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                                            <div
                                                onClick={() => openAccountQuickReport({ qb_account_id: acct.account_id || '', name: acct.account_name })}
                                                className="flex items-center justify-between font-black text-xs mb-2 cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 group"
                                            >
                                                <span className="group-hover:underline">▾ {acct.account_name} ({acct.entries?.length || 0})</span>
                                                <span className="font-mono group-hover:underline">
                                                    Debit: {formatCurrency(acct.total_debit)} · Credit: {formatCurrency(acct.total_credit)}
                                                </span>
                                            </div>
                                            <div className="max-h-96 overflow-y-auto">
                                                <table className="w-full text-[11px]">
                                                    <tbody>
                                                        {(acct.entries || []).map((e: any, idx: number) => {
                                                            const matchedTx = transactions.find(tx =>
                                                                (e.id && String(tx.id) === String(e.id)) ||
                                                                (tx.txn_date === e.date && tx.txn_type === e.type && (tx.doc_number || '') === (e.doc || ''))
                                                            )
                                                            return (
                                                                <tr
                                                                    key={idx}
                                                                    onClick={() => matchedTx && openRecordPreview('transaction', matchedTx)}
                                                                    className={`border-t border-slate-100 dark:border-slate-800/60 ${matchedTx ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer' : ''}`}
                                                                >
                                                                    <td className="py-1 font-mono w-24">{e.date}</td>
                                                                    <td className="py-1 w-24">{e.type}</td>
                                                                    <td className="py-1 font-mono w-20">{e.doc}</td>
                                                                    <td className="py-1 font-semibold">{e.name}</td>
                                                                    <td className="py-1 text-slate-500">{e.memo}</td>
                                                                    <td className="py-1 text-right font-mono w-24">{e.debit ? formatCurrency(e.debit) : ''}</td>
                                                                    <td className="py-1 text-right font-mono w-24">{e.credit ? formatCurrency(e.credit) : ''}</td>
                                                                </tr>
                                                            )
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 7. Official QBO Archive Snapshot View */}
                            {reportType === 'qbo_archive' && reportData?.archiveReport && (
                                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                                {reportData.archiveReport.columns.map((col: string, i: number) => (
                                                    <th key={i} className={`py-2.5 px-3 ${i === 0 ? 'text-left' : 'text-right'}`}>{col}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                            {reportData.archiveReport.rows.map((r: any, idx: number) => {
                                                const label = String(r.cells?.[0] || '').trim()
                                                const matchedAcc = accounts.find(a =>
                                                    a.name.toLowerCase() === label.toLowerCase() ||
                                                    (a.fully_qualified_name && a.fully_qualified_name.toLowerCase().endsWith(label.toLowerCase()))
                                                )
                                                return (
                                                    <tr
                                                        key={idx}
                                                        onClick={() => {
                                                            if (matchedAcc) {
                                                                openAccountQuickReport(matchedAcc)
                                                            } else if (label && r.rowType !== 'section_header') {
                                                                openAccountQuickReport({ qb_account_id: '', name: label, account_type: 'Archive' })
                                                            }
                                                        }}
                                                        className={
                                                            r.rowType === 'summary'
                                                                ? 'bg-emerald-500/10 font-black cursor-pointer hover:bg-emerald-500/20'
                                                                : r.rowType === 'section_header'
                                                                ? 'bg-slate-50 dark:bg-slate-800/40 font-bold'
                                                                : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 group'
                                                        }
                                                    >
                                                        {r.cells.map((cell: string, ci: number) => (
                                                            <td
                                                                key={ci}
                                                                style={ci === 0 ? { paddingLeft: `${12 + (r.depth || 0) * 14}px` } : undefined}
                                                                className={`py-1.5 px-3 ${ci === 0 ? 'text-left group-hover:underline' : 'text-right font-mono group-hover:underline'}`}
                                                            >
                                                                {cell}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* TAB 8: BANK & CREDIT CARD RECONCILIATION (GEAR ⚙️ -> TOOLS -> RECONCILE) */}
            {activeTab === 'reconcile' && (
                <div className="space-y-5">
                    {/* Top Reconciliation Setup & Live Equation Banner */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                    <Scale size={20} className="text-emerald-500" />
                                    <span>{t('external_accounting.reconcile_title')} — {activeCompany?.company_name}</span>
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {t('external_accounting.reconcile_subtitle')}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handlePrintReconciliationReport()}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold cursor-pointer"
                                >
                                    <Printer size={14} />
                                    <span>{t('external_accounting.reconcile_btn_print')}</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => handleSaveReconciliation('Draft', false)}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-bold cursor-pointer"
                                >
                                    <span>{t('external_accounting.reconcile_btn_save_draft')}</span>
                                </button>
                                {!reconcileMath.isBalanced && (
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => handleSaveReconciliation('Completed', true)}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-200 text-xs font-bold cursor-pointer"
                                    >
                                        <span>{t('external_accounting.reconcile_btn_auto_adjust')}</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => handleSaveReconciliation('Completed', false)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm cursor-pointer"
                                >
                                    <CheckCircle2 size={15} />
                                    <span>{t('external_accounting.reconcile_btn_finish')}</span>
                                </button>
                            </div>
                        </div>

                        {/* Statement Inputs Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
                            <div className="lg:col-span-2">
                                <label className="block font-bold text-slate-500 mb-1">
                                    {t('external_accounting.reconcile_select_account')}
                                </label>
                                <select
                                    value={reconcileAccountId}
                                    onChange={(e) => handleAutoSelectReconcileAccount(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/30 font-bold"
                                >
                                    <option value="">-- Seleccionar Banco / Tarjeta --</option>
                                    {bankAndCardAccounts.map(a => (
                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                            {a.name} ({a.account_type}) — {formatCurrency(a.current_balance)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block font-bold text-slate-500 mb-1">
                                    {t('external_accounting.reconcile_ending_date')}
                                </label>
                                <input
                                    type="date"
                                    value={recEndingDate}
                                    onChange={(e) => setRecEndingDate(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                />
                            </div>
                            <div>
                                <label className="block font-bold text-slate-500 mb-1">
                                    {t('external_accounting.reconcile_beginning_balance')}
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={recBeginningBalance}
                                    onChange={(e) => setRecBeginningBalance(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                />
                            </div>
                            <div>
                                <label className="block font-bold text-slate-500 mb-1">
                                    {t('external_accounting.reconcile_ending_balance')}
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={recEndingBalance}
                                    onChange={(e) => setRecEndingBalance(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-emerald-500 bg-white dark:bg-slate-950 font-mono font-black"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-slate-500 mb-1 truncate" title={t('external_accounting.reconcile_service_charge')}>
                                        Fee ($)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={recServiceCharge}
                                        onChange={(e) => setRecServiceCharge(e.target.value)}
                                        className="w-full px-2 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-500 mb-1 truncate" title={t('external_accounting.reconcile_interest_earned')}>
                                        Interest ($)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={recInterestEarned}
                                        onChange={(e) => setRecInterestEarned(e.target.value)}
                                        className="w-full px-2 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Live QBO Reconciliation Equation Banner */}
                        <div className={`p-4 rounded-2xl border-2 grid grid-cols-2 sm:grid-cols-5 gap-3 items-center ${
                            reconcileMath.isBalanced
                                ? 'border-emerald-500 bg-emerald-500/10'
                                : 'border-amber-500/60 bg-amber-500/10'
                        }`}>
                            <div>
                                <div className="text-[10px] font-black uppercase text-slate-500">
                                    {t('external_accounting.reconcile_ending_balance')}
                                </div>
                                <div className="text-lg font-black font-mono">
                                    {formatCurrency(reconcileMath.endBal)}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase text-slate-500">
                                    {t('external_accounting.reconcile_cleared_balance')}
                                </div>
                                <div className="text-lg font-black font-mono text-blue-600 dark:text-blue-400">
                                    {formatCurrency(reconcileMath.clearedBalance)}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase text-slate-500">
                                    {t('external_accounting.reconcile_payments_checked')} ({reconcileMath.paymentsCount})
                                </div>
                                <div className="text-base font-bold font-mono text-red-600 dark:text-red-400">
                                    -{formatCurrency(reconcileMath.paymentsTotal)}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase text-slate-500">
                                    {t('external_accounting.reconcile_deposits_checked')} ({reconcileMath.depositsCount})
                                </div>
                                <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                                    +{formatCurrency(reconcileMath.depositsTotal)}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-black uppercase text-slate-500">
                                    {t('external_accounting.reconcile_difference')}
                                </div>
                                <div className={`text-2xl font-black font-mono flex items-center justify-end gap-1.5 ${
                                    reconcileMath.isBalanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                                }`}>
                                    {reconcileMath.isBalanced && <CheckCircle2 size={20} />}
                                    <span>{formatCurrency(reconcileMath.difference)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Filter & Bulk Check Controls */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {(['ALL', 'PAYMENTS', 'DEPOSITS'] as const).map(side => (
                                    <button
                                        key={side}
                                        type="button"
                                        onClick={() => setRecFilterSide(side)}
                                        className={`px-3 py-1.5 rounded-xl font-bold cursor-pointer ${
                                            recFilterSide === side
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                        }`}
                                    >
                                        {side === 'ALL' ? t('external_accounting.reconcile_filter_all') : side === 'PAYMENTS' ? t('external_accounting.reconcile_filter_payments') : t('external_accounting.reconcile_filter_deposits')}
                                    </button>
                                ))}
                                <label className="inline-flex items-center gap-1.5 ml-2 font-semibold cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={recUpToEndDateOnly}
                                        onChange={(e) => setRecUpToEndDateOnly(e.target.checked)}
                                    />
                                    <span>≤ {recEndingDate}</span>
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={recSearch}
                                    onChange={(e) => setRecSearch(e.target.value)}
                                    placeholder={t('external_accounting.search_placeholder')}
                                    className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                                />
                                <button
                                    type="button"
                                    onClick={() => setRecSelectedIds(visibleReconcileRows.map(r => String(r.id)))}
                                    className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold cursor-pointer"
                                >
                                    ✓ Marcar Visibles ({visibleReconcileRows.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRecSelectedIds([])}
                                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold cursor-pointer"
                                >
                                    Desmarcar Todo
                                </button>
                            </div>
                        </div>

                        {/* Transactions Selection Table */}
                        <div className="overflow-x-auto max-h-[420px] rounded-xl border border-slate-200 dark:border-slate-800">
                            <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                    <tr>
                                        <th className="py-2.5 px-3 text-center w-10">✓</th>
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.col_date')}</th>
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.col_type')}</th>
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.col_doc_num')}</th>
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.col_category')}</th>
                                        <th className="py-2.5 px-3 text-right">Payment (-)</th>
                                        <th className="py-2.5 px-3 text-right">Deposit (+)</th>
                                        <th className="py-2.5 px-3 text-center">Clr</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                    {visibleReconcileRows.map(row => {
                                        const idStr = String(row.id)
                                        const checked = recSelectedIds.includes(idStr)
                                        const isPay = isTxnPaymentForAccount(row, reconcileAccountId)
                                        return (
                                            <tr
                                                key={idStr}
                                                onClick={() => openRecordPreview('transaction', row)}
                                                className={`cursor-pointer transition-colors ${
                                                    checked ? 'bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                }`}
                                            >
                                                <td
                                                    className="py-2 px-3 text-center"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setRecSelectedIds(prev =>
                                                            prev.includes(idStr) ? prev.filter(x => x !== idStr) : [...prev, idStr]
                                                        )
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => {}}
                                                        className="cursor-pointer"
                                                    />
                                                </td>
                                                <td className="py-2 px-3 font-mono">{row.txn_date}</td>
                                                <td className="py-2 px-3">{row.txn_type}</td>
                                                <td className="py-2 px-3 font-mono font-bold">{row.doc_number || '—'}</td>
                                                <td className="py-2 px-3 font-semibold">{row.entity_name || '—'}</td>
                                                <td className="py-2 px-3 text-slate-500">{row.category_summary || '—'}</td>
                                                <td className="py-2 px-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                                                    {isPay ? formatCurrency(row.total_amount) : ''}
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                    {!isPay ? formatCurrency(row.total_amount) : ''}
                                                </td>
                                                <td className="py-2 px-3 text-center font-mono font-black">
                                                    {checked ? 'R' : (row.cleared_status === 'Reconciled' ? 'R' : 'C')}
                                                </td>
                                                <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                    <div className="inline-flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePrintRecord('transaction', row)}
                                                            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_print')}
                                                        >
                                                            <Printer size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEditRecord('transaction', row)}
                                                            className="p-1 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_edit')}
                                                        >
                                                            <Edit3 size={12} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openDeleteWizard('transaction', row)}
                                                            className="p-1 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_delete')}
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Saved Reconciliations History Table */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
                        <h3 className="text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                            {t('external_accounting.reconcile_history_title')} ({reconciliations.length})
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs border-collapse">
                                <thead>
                                    <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.col_account')}</th>
                                        <th className="py-2.5 px-3 text-left">{t('external_accounting.reconcile_ending_date')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.reconcile_beginning_balance')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.reconcile_ending_balance')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.reconcile_difference')}</th>
                                        <th className="py-2.5 px-3 text-center">{t('external_accounting.col_status')}</th>
                                        <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                    {reconciliations.map(rec => (
                                        <tr
                                            key={rec.id}
                                            onClick={() => openRecordPreview('reconciliation', rec)}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                        >
                                            <td className="py-2 px-3 font-bold">{rec.account_name}</td>
                                            <td className="py-2 px-3 font-mono">{rec.statement_ending_date}</td>
                                            <td className="py-2 px-3 text-right font-mono">{formatCurrency(rec.beginning_balance)}</td>
                                            <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(rec.ending_balance)}</td>
                                            <td className="py-2 px-3 text-right font-mono">{formatCurrency(rec.difference)}</td>
                                            <td className="py-2 px-3 text-center">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                                                    rec.status === 'Completed'
                                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                                }`}>
                                                    {rec.status === 'Completed' ? t('external_accounting.reconcile_status_completed') : t('external_accounting.reconcile_status_draft')}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-right whitespace-nowrap space-x-1.5" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePrintReconciliationReport(rec)}
                                                    className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 font-bold cursor-pointer"
                                                    title={t('external_accounting.preview_btn_print')}
                                                >
                                                    <Printer size={12} className="inline mr-1" />
                                                    PDF
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleReopenReconciliation(rec)}
                                                    className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold cursor-pointer"
                                                >
                                                    {t('external_accounting.reconcile_btn_reopen')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openDeleteWizard('reconciliation', rec)}
                                                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer inline-flex items-center"
                                                    title={t('external_accounting.preview_btn_delete')}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 9: ACCOUNTANT BATCH RECLASSIFY TRANSACTIONS (GEAR ⚙️ -> TOOLS -> RECLASSIFY) */}
            {activeTab === 'reclassify' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div>
                        <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <Layers size={19} className="text-blue-500" />
                            <span>{t('external_accounting.reclassify_title')} — {activeCompany?.company_name}</span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('external_accounting.reclassify_subtitle')}
                        </p>
                    </div>

                    <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/30 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end text-xs">
                        <div>
                            <label className="block font-bold mb-1">{t('external_accounting.reclassify_target_account')}</label>
                            <select
                                value={reclassifyTargetAccId}
                                onChange={(e) => setReclassifyTargetAccId(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold"
                            >
                                <option value="">-- Sin cambio de cuenta --</option>
                                {accounts.map(a => (
                                    <option key={a.qb_account_id} value={a.qb_account_id}>
                                        {a.name} ({a.account_type})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block font-bold mb-1">{t('external_accounting.reclassify_target_entity')}</label>
                            <input
                                type="text"
                                list="contacts-datalist"
                                value={reclassifyTargetEntity}
                                onChange={(e) => setReclassifyTargetEntity(e.target.value)}
                                placeholder="Opcional..."
                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold"
                            />
                        </div>
                        <div>
                            <label className="block font-bold mb-1">{t('external_accounting.reclassify_target_dept')}</label>
                            <input
                                type="text"
                                value={reclassifyTargetDept}
                                onChange={(e) => setReclassifyTargetDept(e.target.value)}
                                placeholder="Sucursal / Clase..."
                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-bold"
                            />
                        </div>
                        <div>
                            <button
                                type="button"
                                disabled={saving || reclassifySelectedIds.length === 0}
                                onClick={handleReclassifyBatch}
                                className="w-full px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black cursor-pointer"
                            >
                                {t('external_accounting.reclassify_btn_apply')} ({reclassifySelectedIds.length})
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto max-h-[500px] rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                <tr>
                                    <th className="py-2.5 px-3 text-center w-10">
                                        <input
                                            type="checkbox"
                                            checked={transactions.length > 0 && reclassifySelectedIds.length === transactions.length}
                                            onChange={(e) => setReclassifySelectedIds(e.target.checked ? transactions.map(r => String(r.id)) : [])}
                                        />
                                    </th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_date')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_type')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_doc_num')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_category')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {transactions.map(r => {
                                    const idStr = String(r.id)
                                    const checked = reclassifySelectedIds.includes(idStr)
                                    return (
                                        <tr
                                            key={idStr}
                                            onClick={() => openRecordPreview('transaction', r)}
                                            className={`cursor-pointer ${checked ? 'bg-blue-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                                        >
                                            <td
                                                className="py-2 px-3 text-center"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setReclassifySelectedIds(prev => prev.includes(idStr) ? prev.filter(x => x !== idStr) : [...prev, idStr])
                                                }}
                                            >
                                                <input type="checkbox" checked={checked} onChange={() => {}} className="cursor-pointer" />
                                            </td>
                                            <td className="py-2 px-3 font-mono">{r.txn_date}</td>
                                            <td className="py-2 px-3">{r.txn_type}</td>
                                            <td className="py-2 px-3 font-mono">{r.doc_number || '—'}</td>
                                            <td className="py-2 px-3 font-semibold">{r.entity_name || '—'}</td>
                                            <td className="py-2 px-3 font-bold text-blue-600 dark:text-blue-400">{r.category_summary || r.to_account_name || '—'}</td>
                                            <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(r.total_amount)}</td>
                                            <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrintRecord('transaction', r)}
                                                        className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        title={t('external_accounting.preview_btn_print')}
                                                    >
                                                        <Printer size={12} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditRecord('transaction', r)}
                                                        className="p-1 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                        title={t('external_accounting.preview_btn_edit')}
                                                    >
                                                        <Edit3 size={12} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openDeleteWizard('transaction', r)}
                                                        className="p-1 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer"
                                                        title={t('external_accounting.preview_btn_delete')}
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 10: BANK RULES ENGINE (GEAR ⚙️ -> LISTS -> RULES) */}
            {activeTab === 'rules' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <Sparkles size={19} className="text-amber-500" />
                                <span>{t('external_accounting.rules_title')} — {activeCompany?.company_name}</span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {t('external_accounting.rules_subtitle')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={handleApplyBankRulesNow}
                                className="px-3.5 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold cursor-pointer"
                            >
                                ⚡ {t('external_accounting.rules_btn_apply_now')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingRuleId(null)
                                    setRuleFormName('')
                                    setRuleFormMatchText('')
                                    setRuleFormTargetAccId(accounts[0]?.qb_account_id || '')
                                    setRuleFormTargetEntity('')
                                    setRuleModalOpen(true)
                                }}
                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                            >
                                {t('external_accounting.rules_btn_new')}
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                    <th className="py-2.5 px-3 text-left">Rule Name</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.rules_match_text')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.reclassify_target_account')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {bankRules.map(rule => (
                                    <tr
                                        key={rule.id}
                                        onClick={() => openRecordPreview('bank_rule', rule)}
                                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                    >
                                        <td className="py-2 px-3 font-bold">{rule.rule_name}</td>
                                        <td className="py-2 px-3 font-mono">{rule.direction} · {rule.match_field}: &quot;{rule.match_text}&quot;</td>
                                        <td className="py-2 px-3 font-semibold text-emerald-600 dark:text-emerald-400">{rule.target_account_name}</td>
                                        <td className="py-2 px-3">{rule.target_entity_name || '—'}</td>
                                        <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                            <div className="inline-flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => handlePrintRecord('bank_rule', rule)}
                                                    className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                    title={t('external_accounting.preview_btn_print')}
                                                >
                                                    <Printer size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleEditRecord('bank_rule', rule)}
                                                    className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                    title={t('external_accounting.preview_btn_edit')}
                                                >
                                                    <Edit3 size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteBankRule(rule)}
                                                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer"
                                                    title={t('external_accounting.preview_btn_delete')}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 11: BUDGETING & VARIANCE ANALYSIS (GEAR ⚙️ -> TOOLS -> BUDGETING) */}
            {activeTab === 'budgeting' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <Calculator size={19} className="text-purple-500" />
                                <span>{t('external_accounting.budget_title')} ({budgetYear}) — {activeCompany?.company_name}</span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {t('external_accounting.budget_subtitle')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={budgetYear}
                                onChange={(e) => setBudgetYear(Number(e.target.value))}
                                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                            >
                                {[2026, 2025, 2024, 2023].map(yr => (
                                    <option key={yr} value={yr}>{yr}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => {
                                    const rowsHtml = budgetComparisonRows.map(b => `<tr>
                                        <td>${escapeHtml(b.account_name)}</td>
                                        <td>${escapeHtml(b.account_type)}</td>
                                        <td class="num">${Number(b.annualBudget || 0).toFixed(2)}</td>
                                        <td class="num">${Number(b.actual || 0).toFixed(2)}</td>
                                        <td class="num">${Number(b.variance || 0).toFixed(2)}</td>
                                        <td class="num">${escapeHtml(String(b.pct))}%</td>
                                    </tr>`).join('')
                                    const tableHtml = `<table>
                                        <thead><tr>
                                            <th>${escapeHtml(t('external_accounting.col_acct_name'))}</th>
                                            <th>${escapeHtml(t('external_accounting.col_acct_type'))}</th>
                                            <th class="right">${escapeHtml(t('external_accounting.budget_col_annual'))}</th>
                                            <th class="right">${escapeHtml(t('external_accounting.budget_col_actual'))}</th>
                                            <th class="right">${escapeHtml(t('external_accounting.budget_col_variance'))}</th>
                                            <th class="right">${escapeHtml(t('external_accounting.budget_col_pct'))}</th>
                                        </tr></thead>
                                        <tbody>${rowsHtml}</tbody>
                                    </table>`
                                    downloadStyledExcelXls(
                                        `Budget_${(activeCompany?.company_name || 'Company').replace(/\s+/g, '_')}_${budgetYear}`,
                                        activeCompany?.legal_name || activeCompany?.company_name || 'Company',
                                        `${t('external_accounting.budget_title')} (${budgetYear})`,
                                        `Fiscal Year ${budgetYear}`,
                                        tableHtml
                                    )
                                }}
                                className="px-3.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold cursor-pointer"
                            >
                                <Download size={14} className="inline mr-1" />
                                .XLS
                            </button>
                            <button
                                type="button"
                                onClick={handlePrintBudgetReport}
                                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-bold cursor-pointer"
                            >
                                <Printer size={14} className="inline mr-1" />
                                PDF
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setBudgetAccountQbId(accounts[0]?.qb_account_id || '')
                                    setBudgetAnnualAmount('12000')
                                    setBudgetNotes('')
                                    setBudgetModalOpen(true)
                                }}
                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                            >
                                {t('external_accounting.budget_btn_new')}
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_acct_name')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_acct_type')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.budget_col_annual')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.budget_col_actual')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.budget_col_variance')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.budget_col_pct')}</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {budgetComparisonRows.map(b => (
                                    <tr
                                        key={b.id}
                                        onClick={() => openRecordPreview('budget', b)}
                                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                    >
                                        <td className="py-2 px-3 font-bold">{b.account_name}</td>
                                        <td className="py-2 px-3 text-slate-500">{b.account_type}</td>
                                        <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(b.annualBudget)}</td>
                                        <td
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                openAccountQuickReport({
                                                    qb_account_id: b.account_qb_id,
                                                    name: b.account_name,
                                                    account_type: b.account_type
                                                })
                                            }}
                                            title={t('external_accounting.drilldown_click_hint')}
                                            className="py-2 px-3 text-right font-mono font-bold hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline cursor-pointer"
                                        >
                                            {formatCurrency(b.actual)}
                                        </td>
                                        <td className={`py-2 px-3 text-right font-mono font-bold ${b.variance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                            {formatCurrency(b.variance)}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono">{b.pct}%</td>
                                        <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                            <div className="inline-flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => openAccountQuickReport({
                                                        qb_account_id: b.account_qb_id,
                                                        name: b.account_name,
                                                        account_type: b.account_type
                                                    })}
                                                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer mr-1"
                                                >
                                                    {t('external_accounting.coa_action_run_report')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePrintRecord('budget', b)}
                                                    className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                    title={t('external_accounting.preview_btn_print')}
                                                >
                                                    <Printer size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleEditRecord('budget', b)}
                                                    className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                    title={t('external_accounting.preview_btn_edit')}
                                                >
                                                    <Edit3 size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteBudget(b)}
                                                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer"
                                                    title={t('external_accounting.preview_btn_delete')}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 12: ALL LISTS — QBO /app/lists 11-LIST RELATIONAL DIRECTORY */}
            {activeTab === 'lists' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-5">
                    {/* QBO /app/lists Top Relational Directory Banner (Chart of Accounts + Recurring + 9 Relational Lists) */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                        <div>
                            <h2 className="text-base font-black text-slate-900 dark:text-white">
                                {t('external_accounting.tab_lists')} — {activeCompany?.legal_name || activeCompany?.company_name}
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                QuickBooks Online `/app/lists` Relational Master Tables (Chart of Accounts · Products & Services · Categories · Locations/Properties · Classes · Payment Methods · Terms · Custom Fields · Attachments · Cost Groups)
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab('accounts')}
                                className="px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold cursor-pointer"
                            >
                                📊 {t('external_accounting.tab_accounts')} ({accounts.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('recurring')}
                                className="px-3 py-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-bold cursor-pointer"
                            >
                                🔄 {t('external_accounting.tab_recurring')} ({recurring.length})
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {([
                                { key: 'items', label: `${t('external_accounting.lists_tab_items')} (${companyLists.items?.length || 0})` },
                                { key: 'categories', label: `${t('external_accounting.lists_tab_categories')} (${companyLists.categories?.length || 0})` },
                                { key: 'departments', label: `${t('external_accounting.lists_tab_departments')} (${companyLists.departments?.length || 0})` },
                                { key: 'classes', label: `${t('external_accounting.lists_tab_classes')} (${companyLists.classes?.length || 0})` },
                                { key: 'paymentMethods', label: `${t('external_accounting.lists_tab_payment_methods')} (${companyLists.paymentMethods?.length || 0})` },
                                { key: 'terms', label: `${t('external_accounting.lists_tab_terms')} (${companyLists.terms?.length || 0})` },
                                { key: 'customFields', label: `${t('external_accounting.lists_tab_custom_fields')} (${companyLists.customFields?.length || 0})` },
                                { key: 'attachments', label: `${t('external_accounting.lists_tab_attachments')} (${companyLists.attachments?.length || 0})` },
                                { key: 'costGroups', label: `${t('external_accounting.lists_tab_cost_groups')} (${companyLists.costGroups?.length || 0})` },
                            ] as const).map(sub => (
                                <button
                                    key={sub.key}
                                    type="button"
                                    onClick={() => setActiveListKey(sub.key)}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                                        activeListKey === sub.key
                                            ? 'bg-emerald-600 text-white shadow-xs'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {sub.label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingListItemId(null)
                                setListItemName('')
                                setListItemDesc('')
                                setListItemPrice('0')
                                setListItemPurchaseCost('0')
                                setListItemSku('')
                                setListItemType('Service')
                                setListItemAccountId(accounts.find(a => a.account_type === 'Income')?.qb_account_id || accounts[0]?.qb_account_id || '')
                                setListItemExpenseAccountId(accounts.find(a => a.account_type === 'Expense' || a.account_type === 'Cost of Goods Sold')?.qb_account_id || '')
                                setListItemCategoryId('')
                                setListItemClassCode('')
                                setListItemPaymentType('NON_CREDIT_CARD')
                                setListItemDueDays('30')
                                setListItemDiscountPct('0')
                                setListItemModalOpen(true)
                            }}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                            {t('external_accounting.lists_btn_new_item')}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                    <th className="py-2.5 px-3 text-left">ID</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_acct_name')}</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_type')} / SKU / Code</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.lists_col_income_account')} / Details</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.lists_col_expense_account')} / Category</th>
                                    <th className="py-2.5 px-3 text-right">Price / Terms</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {(companyLists[activeListKey] || []).map((it: any, i: number) => {
                                    const enrichedItem = { ...it, listKey: activeListKey }
                                    const itemName = it.Name || it.FullyQualifiedName || it.name || it.file_name || '—'
                                    const incomeAcctLabel = it.IncomeAccountRef?.name || it.income_account_name || ''
                                    const expenseAcctLabel = it.ExpenseAccountRef?.name || it.expense_account_name || ''
                                    const parentCatLabel = it.ParentRef?.name || it.category_name || ''
                                    return (
                                        <tr
                                            key={it.Id || it.id || i}
                                            onClick={() => openRecordPreview('list_item', enrichedItem)}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                                        >
                                            <td className="py-2 px-3 font-mono text-slate-500">{it.Id || it.qb_id || i + 1}</td>
                                            <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">{itemName}</td>
                                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                                {it.Type || it.item_type || it.class_code || it.payment_type || it.field_type || it.mime_type || 'Active'}
                                                {(it.Sku || it.sku) ? ` · SKU: ${it.Sku || it.sku}` : ''}
                                            </td>
                                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                                                {incomeAcctLabel ? (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                                                        {incomeAcctLabel}
                                                    </span>
                                                ) : (
                                                    it.Description || it.description || it.entity_type || '—'
                                                )}
                                            </td>
                                            <td className="py-2 px-3 text-slate-500">
                                                {expenseAcctLabel && (
                                                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold text-[11px] mr-1">
                                                        {expenseAcctLabel}
                                                    </span>
                                                )}
                                                {parentCatLabel && (
                                                    <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold text-[10px]">
                                                        {parentCatLabel}
                                                    </span>
                                                )}
                                                {!expenseAcctLabel && !parentCatLabel && '—'}
                                            </td>
                                            <td className="py-2 px-3 text-right font-mono font-bold">
                                                {it.UnitPrice != null
                                                    ? formatCurrency(it.UnitPrice)
                                                    : it.DueDays != null
                                                    ? `${it.DueDays}d${it.DiscountPercent ? ` (${it.DiscountPercent}%)` : ''}`
                                                    : it.file_size != null
                                                    ? `${Math.round(Number(it.file_size) / 1024)} KB`
                                                    : '—'}
                                            </td>
                                            <td className="py-2 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                <div className="inline-flex items-center gap-1">
                                                    {(activeListKey === 'items' || activeListKey === 'categories' || activeListKey === 'departments' || activeListKey === 'classes' || activeListKey === 'paymentMethods' || activeListKey === 'terms') && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const qbId = String(it.Id || it.qb_id || it.id || '')
                                                                if (activeListKey === 'items') {
                                                                    openListOrContactQuickReport('item', itemName, qbId, itemName)
                                                                } else if (activeListKey === 'departments') {
                                                                    openListOrContactQuickReport('location', itemName, qbId, itemName)
                                                                } else if (activeListKey === 'classes') {
                                                                    openListOrContactQuickReport('class', itemName, qbId, itemName)
                                                                } else if (activeListKey === 'paymentMethods') {
                                                                    openListOrContactQuickReport('payment_method', itemName, qbId, itemName)
                                                                } else if (activeListKey === 'terms') {
                                                                    openListOrContactQuickReport('term', itemName, qbId, itemName)
                                                                } else {
                                                                    openAccountQuickReport({ qb_account_id: qbId, name: itemName })
                                                                }
                                                            }}
                                                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer mr-1"
                                                        >
                                                            {t('external_accounting.coa_action_run_report')}
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePrintRecord('list_item', enrichedItem)}
                                                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        title={t('external_accounting.preview_btn_print')}
                                                    >
                                                        <Printer size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditRecord('list_item', enrichedItem)}
                                                        className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                        title={t('external_accounting.preview_btn_edit')}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    {(it.Id || it.id) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteListItem(enrichedItem)}
                                                            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-600 dark:text-red-400 cursor-pointer"
                                                            title={t('external_accounting.preview_btn_delete')}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 13: IMMUTABLE AUDIT LOG (GEAR ⚙️ -> TOOLS -> AUDIT LOG) */}
            {activeTab === 'audit_log' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <History size={19} className="text-amber-500" />
                                <span>{t('external_accounting.audit_title')} — {activeCompany?.company_name}</span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {t('external_accounting.audit_subtitle')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={auditSearch}
                                onChange={(e) => setAuditSearch(e.target.value)}
                                placeholder={t('external_accounting.search_placeholder')}
                                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                            />
                            <button
                                type="button"
                                onClick={handlePrintAuditLog}
                                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-bold cursor-pointer"
                            >
                                <Printer size={14} className="inline mr-1" />
                                PDF
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto max-h-[520px]">
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                <tr>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_date')}</th>
                                    <th className="py-2.5 px-3 text-left">User</th>
                                    <th className="py-2.5 px-3 text-left">Action</th>
                                    <th className="py-2.5 px-3 text-left">{t('external_accounting.col_doc_num')}</th>
                                    <th className="py-2.5 px-3 text-left">Summary</th>
                                    <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {filteredAuditLog.map(a => (
                                    <tr key={a.id}>
                                        <td className="py-2 px-3 font-mono">{a.created_at ? new Date(a.created_at).toLocaleString('en-US') : ''}</td>
                                        <td className="py-2 px-3 font-bold">{a.user_name}</td>
                                        <td className="py-2 px-3 font-mono text-emerald-600 dark:text-emerald-400">{a.action_type}</td>
                                        <td className="py-2 px-3 font-mono">{a.doc_number || '—'}</td>
                                        <td className="py-2 px-3">{a.summary}</td>
                                        <td className="py-2 px-3 text-right font-mono font-bold">
                                            {a.amount != null ? formatCurrency(a.amount) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 14: COMPANY SETTINGS & BOOKS CLOSING LOCK (GEAR ⚙️ -> SETTINGS -> COMPANY SETTINGS) */}
            {activeTab === 'company_settings' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs max-w-3xl space-y-4">
                    <div>
                        <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <Settings size={19} className="text-emerald-500" />
                            <span>{t('external_accounting.settings_title')} — {activeCompany?.company_name}</span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('external_accounting.settings_subtitle')}
                        </p>
                    </div>

                    <form onSubmit={handleSaveCompanySettings} className="space-y-4 text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block font-bold mb-1">Company Name</label>
                                <input
                                    type="text"
                                    value={compSetName}
                                    onChange={(e) => setCompSetName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                />
                            </div>
                            <div>
                                <label className="block font-bold mb-1">Legal Name (Razón Social)</label>
                                <input
                                    type="text"
                                    value={compSetLegalName}
                                    onChange={(e) => setCompSetLegalName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                />
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_tax_id')}</label>
                                <input
                                    type="text"
                                    value={compSetTaxId}
                                    onChange={(e) => setCompSetTaxId(e.target.value)}
                                    placeholder="XX-XXXXXXX"
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                />
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.settings_accounting_method')}</label>
                                <select
                                    value={compSetMethod}
                                    onChange={(e) => setCompSetMethod(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                >
                                    <option value="Accrual">Accrual (Devengado)</option>
                                    <option value="Cash">Cash (Flujo de Efectivo)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_email')}</label>
                                <input
                                    type="text"
                                    value={compSetEmail}
                                    onChange={(e) => setCompSetEmail(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                />
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_phone')}</label>
                                <input
                                    type="text"
                                    value={compSetPhone}
                                    onChange={(e) => setCompSetPhone(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                />
                            </div>
                        </div>

                        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-2">
                            <label className="block font-black text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                <Lock size={14} />
                                <span>{t('external_accounting.settings_closing_date')}</span>
                            </label>
                            <input
                                type="date"
                                value={compSetClosingDate}
                                onChange={(e) => setCompSetClosingDate(e.target.value)}
                                className="px-3 py-2 rounded-xl border border-amber-500/50 bg-white dark:bg-slate-950 font-mono font-bold"
                            />
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black cursor-pointer"
                            >
                                {t('external_accounting.settings_btn_save')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* MODAL: CREATE BANK RULE */}
            {ruleModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <h3 className="text-base font-black">{t('external_accounting.rules_btn_new')}</h3>
                        <form onSubmit={handleSaveBankRule} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold mb-1">Rule Name</label>
                                <input
                                    type="text"
                                    required
                                    value={ruleFormName}
                                    onChange={(e) => setRuleFormName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold mb-1">Direction</label>
                                    <select
                                        value={ruleFormDirection}
                                        onChange={(e) => setRuleFormDirection(e.target.value as any)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    >
                                        <option value="OUT">Money Out (Salidas)</option>
                                        <option value="IN">Money In (Entradas)</option>
                                        <option value="ALL">All (Ambos)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.rules_match_text')}</label>
                                    <input
                                        type="text"
                                        required
                                        value={ruleFormMatchText}
                                        onChange={(e) => setRuleFormMatchText(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.reclassify_target_account')}</label>
                                <select
                                    value={ruleFormTargetAccId}
                                    onChange={(e) => setRuleFormTargetAccId(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                >
                                    {accounts.map(a => (
                                        <option key={a.qb_account_id} value={a.qb_account_id}>{a.name} ({a.account_type})</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setRuleModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                    {t('external_accounting.close_btn')}
                                </button>
                                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
                                    {t('external_accounting.btn_save_transaction')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE / UPDATE BUDGET */}
            {budgetModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <h3 className="text-base font-black">{t('external_accounting.budget_btn_new')} ({budgetYear})</h3>
                        <form onSubmit={handleSaveBudget} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_account')}</label>
                                <select
                                    value={budgetAccountQbId}
                                    onChange={(e) => setBudgetAccountQbId(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                >
                                    {accounts.map(a => (
                                        <option key={a.qb_account_id} value={a.qb_account_id}>{a.name} ({a.account_type})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.budget_col_annual')}</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    required
                                    value={budgetAnnualAmount}
                                    onChange={(e) => setBudgetAnnualAmount(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setBudgetModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                    {t('external_accounting.close_btn')}
                                </button>
                                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
                                    {t('external_accounting.btn_save_transaction')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE / EDIT LIST ITEM (ALL 9 QBO /app/lists RELATIONAL TABLES) */}
            {listItemModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div>
                                <h3 className="text-base font-black">
                                    {editingListItemId ? t('external_accounting.action_edit') : t('external_accounting.lists_btn_new_item')} ({activeListKey})
                                </h3>
                                <p className="text-xs text-slate-500">{activeCompany?.legal_name || activeCompany?.company_name}</p>
                            </div>
                            <button type="button" onClick={() => setListItemModalOpen(false)} className="font-bold cursor-pointer">✕</button>
                        </div>
                        <form onSubmit={handleSaveListItem} className="space-y-3 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="sm:col-span-2">
                                    <label className="block font-bold mb-1">{t('external_accounting.col_acct_name')} *</label>
                                    <input
                                        type="text"
                                        required
                                        value={listItemName}
                                        onChange={(e) => setListItemName(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    />
                                </div>

                                {activeListKey === 'items' && (
                                    <>
                                        <div>
                                            <label className="block font-bold mb-1">{t('external_accounting.col_type')}</label>
                                            <select
                                                value={listItemType}
                                                onChange={(e) => setListItemType(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                            >
                                                <option value="Service">Service</option>
                                                <option value="NonInventory">Non-Inventory</option>
                                                <option value="Inventory">Inventory</option>
                                                <option value="Bundle">Bundle</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block font-bold mb-1">SKU</label>
                                            <input
                                                type="text"
                                                value={listItemSku}
                                                onChange={(e) => setListItemSku(e.target.value)}
                                                placeholder="SKU-001"
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="block font-bold mb-1">Sales Price / Rate ($)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={listItemPrice}
                                                onChange={(e) => setListItemPrice(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block font-bold mb-1">Purchase Cost ($)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={listItemPurchaseCost}
                                                onChange={(e) => setListItemPurchaseCost(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="block font-bold mb-1">{t('external_accounting.lists_col_income_account')}</label>
                                            <select
                                                value={listItemAccountId}
                                                onChange={(e) => setListItemAccountId(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                            >
                                                <option value="">— Select Income Account —</option>
                                                {accounts.map(a => (
                                                    <option key={a.qb_account_id} value={a.qb_account_id}>
                                                        {a.name} ({a.account_type})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block font-bold mb-1">{t('external_accounting.lists_col_expense_account')}</label>
                                            <select
                                                value={listItemExpenseAccountId}
                                                onChange={(e) => setListItemExpenseAccountId(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                            >
                                                <option value="">— Select Expense Account —</option>
                                                {accounts.map(a => (
                                                    <option key={a.qb_account_id} value={a.qb_account_id}>
                                                        {a.name} ({a.account_type})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className="block font-bold mb-1">{t('external_accounting.lists_tab_categories')}</label>
                                            <select
                                                value={listItemCategoryId}
                                                onChange={(e) => setListItemCategoryId(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                            >
                                                <option value="">— None —</option>
                                                {(companyLists.categories || []).map((cat: any) => (
                                                    <option key={cat.Id} value={cat.Id}>{cat.Name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </>
                                )}

                                {activeListKey === 'classes' && (
                                    <div className="sm:col-span-2">
                                        <label className="block font-bold mb-1">{t('external_accounting.lists_col_class_code')}</label>
                                        <input
                                            type="text"
                                            value={listItemClassCode}
                                            onChange={(e) => setListItemClassCode(e.target.value)}
                                            placeholder="e.g. CLS-OPS, CLS-PROP"
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                        />
                                    </div>
                                )}

                                {activeListKey === 'paymentMethods' && (
                                    <div className="sm:col-span-2">
                                        <label className="block font-bold mb-1">{t('external_accounting.col_type')}</label>
                                        <select
                                            value={listItemPaymentType}
                                            onChange={(e) => setListItemPaymentType(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                        >
                                            <option value="NON_CREDIT_CARD">Non-Credit Card (Cash, Check, ACH, Wire, Zelle)</option>
                                            <option value="CREDIT_CARD">Credit Card (Visa, Mastercard, Amex)</option>
                                        </select>
                                    </div>
                                )}

                                {activeListKey === 'terms' && (
                                    <>
                                        <div>
                                            <label className="block font-bold mb-1">{t('external_accounting.lists_col_due_days')}</label>
                                            <input
                                                type="number"
                                                value={listItemDueDays}
                                                onChange={(e) => setListItemDueDays(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block font-bold mb-1">{t('external_accounting.lists_col_discount_pct')}</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={listItemDiscountPct}
                                                onChange={(e) => setListItemDiscountPct(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                            />
                                        </div>
                                    </>
                                )}

                                <div className="sm:col-span-2">
                                    <label className="block font-bold mb-1">Description / Notes</label>
                                    <input
                                        type="text"
                                        value={listItemDesc}
                                        onChange={(e) => setListItemDesc(e.target.value)}
                                        placeholder="Optional description or notes"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setListItemModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                    {t('external_accounting.close_btn')}
                                </button>
                                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
                                    {t('external_accounting.btn_save_transaction')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: BATCH TRANSACTIONS (+ CREATE -> OTHER -> BATCH TRANSACTIONS) */}
            {batchModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-5xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div>
                                <h3 className="text-base font-black">{t('external_accounting.batch_modal_title')} — {activeCompany?.company_name}</h3>
                                <p className="text-xs text-slate-500">{t('external_accounting.batch_modal_subtitle')}</p>
                            </div>
                            <button type="button" onClick={() => setBatchModalOpen(false)} className="font-bold cursor-pointer">✕</button>
                        </div>
                        <form onSubmit={handleSaveBatchTransactions} className="space-y-3 text-xs">
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {batchRows.map((row, idx) => (
                                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                        <input
                                            type="date"
                                            value={row.txn_date}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, txn_date: e.target.value } : r))}
                                            className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                        />
                                        <select
                                            value={row.txn_type}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, txn_type: e.target.value } : r))}
                                            className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                        >
                                            <option value="Check">Check</option>
                                            <option value="Deposit">Deposit</option>
                                            <option value="Expense">Expense</option>
                                        </select>
                                        <input
                                            type="text"
                                            placeholder="# Doc"
                                            value={row.doc_number}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, doc_number: e.target.value } : r))}
                                            className="col-span-1 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                        />
                                        <select
                                            value={row.account_qb_id}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, account_qb_id: e.target.value } : r))}
                                            className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                        >
                                            {bankAndCardAccounts.map(a => <option key={a.qb_account_id} value={a.qb_account_id}>{a.name}</option>)}
                                        </select>
                                        <select
                                            value={row.gl_account_qb_id}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, gl_account_qb_id: e.target.value } : r))}
                                            className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                        >
                                            {accounts.map(a => <option key={a.qb_account_id} value={a.qb_account_id}>{a.name}</option>)}
                                        </select>
                                        <input
                                            type="text"
                                            placeholder="Payee"
                                            value={row.entity_name}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, entity_name: e.target.value } : r))}
                                            className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                        />
                                        <input
                                            type="number"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={row.amount}
                                            onChange={(e) => setBatchRows(prev => prev.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                                            className="col-span-1 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between pt-2">
                                <button
                                    type="button"
                                    onClick={() => setBatchRows(prev => [...prev, { ...prev[prev.length - 1], doc_number: '', amount: '' }])}
                                    className="text-emerald-600 font-bold cursor-pointer"
                                >
                                    {t('external_accounting.batch_btn_add_row')}
                                </button>
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => setBatchModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                        {t('external_accounting.close_btn')}
                                    </button>
                                    <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-black cursor-pointer">
                                        {t('external_accounting.batch_btn_save_all')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: PRINT CHECKS QUEUE (+ CREATE -> VENDORS -> PRINT CHECKS) */}
            {printChecksModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 text-xs">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <h3 className="text-base font-black">{t('external_accounting.print_checks_queue_title')}</h3>
                            <button type="button" onClick={() => setPrintChecksModalOpen(false)} className="font-bold cursor-pointer">✕</button>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.print_checks_starting_num')}</label>
                                <input
                                    type="text"
                                    value={startingPrintCheckNum}
                                    onChange={(e) => setStartingPrintCheckNum(e.target.value)}
                                    className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleBatchPrintChecks}
                                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black cursor-pointer flex items-center gap-1.5"
                            >
                                <Printer size={15} />
                                <span>{t('external_accounting.print_checks_btn_print_selected')} ({selectedCheckIdsToPrint.length})</span>
                            </button>
                        </div>
                        <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                            <table className="w-full text-xs border-collapse">
                                <thead className="bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px]">
                                    <tr>
                                        <th className="py-2 px-3 text-center">✓</th>
                                        <th className="py-2 px-3 text-left">{t('external_accounting.col_date')}</th>
                                        <th className="py-2 px-3 text-left">#</th>
                                        <th className="py-2 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                        <th className="py-2 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                    {checksList.slice(0, 30).map(chk => {
                                        const idStr = String(chk.id)
                                        const sel = selectedCheckIdsToPrint.includes(idStr)
                                        return (
                                            <tr
                                                key={idStr}
                                                onClick={() => setSelectedCheckIdsToPrint(prev => prev.includes(idStr) ? prev.filter(x => x !== idStr) : [...prev, idStr])}
                                                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                            >
                                                <td className="py-2 px-3 text-center"><input type="checkbox" checked={sel} onChange={() => {}} /></td>
                                                <td className="py-2 px-3 font-mono">{chk.txn_date}</td>
                                                <td className="py-2 px-3 font-mono font-bold">{chk.doc_number || '—'}</td>
                                                <td className="py-2 px-3 font-semibold">{chk.entity_name}</td>
                                                <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(chk.total_amount)}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE / EDIT TRANSACTION (1:1 QUICKBOOKS ONLINE FORM-SPECIFIC LAYOUTS) */}
            {modalMode && (() => {
                const isSalesForm = modalMode === 'Invoice' || modalMode === 'Estimate' || modalMode === 'CreditMemo' || modalMode === 'SalesReceipt' || modalMode === 'RefundReceipt'
                const isBillForm = modalMode === 'Bill' || modalMode === 'VendorCredit' || modalMode === 'PurchaseOrder'
                const isTransferLike = modalMode === 'Transfer' || modalMode === 'PayDownCreditCard'
                const liveModalTotal = isTransferLike
                    ? Number(formAmount || 0)
                    : modalMode === 'JournalEntry'
                    ? formLines.filter(l => (l.posting_type || 'Debit') === 'Debit').reduce((s, l) => s + Number(l.amount || 0), 0)
                    : formLines.reduce((s, l) => s + Number(l.amount || 0), 0)

                const openBillsForCompany = modalMode === 'BillPayment'
                    ? transactions.filter(tx => tx.txn_type === 'Bill' && !tx.is_voided).slice(0, 6)
                    : []
                const openInvoicesForCompany = modalMode === 'Payment'
                    ? transactions.filter(tx => tx.txn_type === 'Invoice' && !tx.is_voided).slice(0, 6)
                    : []

                return (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                        <div className="w-full max-w-5xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 my-auto">
                            {/* QBO Top Modal Header with Live Amount Display */}
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                                <div>
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white">
                                        {modalMode === 'Check' && t('external_accounting.modal_check_title')}
                                        {modalMode === 'Deposit' && t('external_accounting.modal_deposit_title')}
                                        {modalMode === 'Expense' && t('external_accounting.modal_expense_title')}
                                        {modalMode === 'Invoice' && t('external_accounting.modal_invoice_title')}
                                        {modalMode === 'Payment' && t('external_accounting.modal_payment_title')}
                                        {modalMode === 'Bill' && t('external_accounting.modal_bill_title')}
                                        {modalMode === 'BillPayment' && t('external_accounting.modal_bill_payment_title')}
                                        {modalMode === 'Transfer' && t('external_accounting.modal_transfer_title')}
                                        {modalMode === 'JournalEntry' && t('external_accounting.modal_journal_title')}
                                        {modalMode === 'SalesReceipt' && t('external_accounting.create_sales_receipt')}
                                        {modalMode === 'CreditMemo' && t('external_accounting.create_credit_memo')}
                                        {modalMode === 'RefundReceipt' && t('external_accounting.create_refund_receipt')}
                                        {modalMode === 'Estimate' && t('external_accounting.create_estimate')}
                                        {modalMode === 'VendorCredit' && t('external_accounting.create_vendor_credit')}
                                        {modalMode === 'CreditCardCredit' && t('external_accounting.create_cc_credit')}
                                        {modalMode === 'PurchaseOrder' && t('external_accounting.create_purchase_order')}
                                        {modalMode === 'PayDownCreditCard' && t('external_accounting.create_pay_down_cc')}
                                        {' — '}{activeCompany?.company_name}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right">
                                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                            {t('external_accounting.qbo_total_label')}
                                        </div>
                                        <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(liveModalTotal)}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setModalMode(null)}
                                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-bold text-base px-2 py-1 cursor-pointer"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            <form onSubmit={handleSaveTransaction} className="space-y-4 text-xs">
                                <datalist id="contacts-datalist">
                                    {contacts.map(c => (
                                        <option key={c.id} value={c.display_name} />
                                    ))}
                                </datalist>

                                {/* =========================================================
                                    1. QBO BANK DEPOSIT HEADER (/app/deposit)
                                    Only Account (Deposit To) + Date in header!
                                   ========================================================= */}
                                {modalMode === 'Deposit' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.field_deposit_to')}
                                            </label>
                                            <select
                                                value={formBankQbId}
                                                onChange={(e) => setFormBankQbId(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                            >
                                                {accounts.map(a => (
                                                    <option key={a.qb_account_id} value={a.qb_account_id}>
                                                        {a.name} ({formatCurrency(a.current_balance)})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.field_date')}
                                            </label>
                                            <input
                                                type="date"
                                                required
                                                value={formDate}
                                                onChange={(e) => setFormDate(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    2. QBO CHECK HEADER (/app/check)
                                    Payee, Bank Account, Mailing Address, Payment Date, Check no., Print Later
                                   ========================================================= */}
                                {modalMode === 'Check' && (
                                    <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_payee')}
                                                </label>
                                                <input
                                                    type="text"
                                                    list="contacts-datalist"
                                                    value={formPayeeName}
                                                    onChange={(e) => setFormPayeeName(e.target.value)}
                                                    placeholder="Vendor / Payee"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_bank_account')}
                                                </label>
                                                <select
                                                    value={formBankQbId}
                                                    onChange={(e) => {
                                                        setFormBankQbId(e.target.value)
                                                        if (!editingTxnId) {
                                                            setFormDocNumber(nextCheckNumberByBank[e.target.value] || '1001')
                                                        }
                                                    }}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({formatCurrency(a.current_balance)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formDate}
                                                    onChange={(e) => setFormDate(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_check_num')}
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={formDocNumber}
                                                        onChange={(e) => setFormDocNumber(e.target.value)}
                                                        placeholder="1001"
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                    />
                                                    <label className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={formPrintLater}
                                                            onChange={(e) => setFormPrintLater(e.target.checked)}
                                                        />
                                                        <span>{t('external_accounting.field_print_later')}</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.qbo_field_mailing_address')}
                                            </label>
                                            <input
                                                type="text"
                                                value={formAddress}
                                                onChange={(e) => setFormAddress(e.target.value)}
                                                placeholder="Street, City, State, ZIP (Optional)"
                                                className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    3. QBO EXPENSE & CREDIT CARD CREDIT HEADER (/app/expense)
                                    Payee, Payment Account, Payment Date, Payment Method, Ref no.
                                   ========================================================= */}
                                {(modalMode === 'Expense' || modalMode === 'CreditCardCredit') && (
                                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.field_payee')}
                                            </label>
                                            <input
                                                type="text"
                                                list="contacts-datalist"
                                                value={formPayeeName}
                                                onChange={(e) => setFormPayeeName(e.target.value)}
                                                placeholder="Who did you pay?"
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.qbo_field_payment_account')}
                                            </label>
                                            <select
                                                value={formBankQbId}
                                                onChange={(e) => setFormBankQbId(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                            >
                                                {accounts.map(a => (
                                                    <option key={a.qb_account_id} value={a.qb_account_id}>
                                                        {a.name} ({formatCurrency(a.current_balance)})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.field_date')}
                                            </label>
                                            <input
                                                type="date"
                                                required
                                                value={formDate}
                                                onChange={(e) => setFormDate(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_payment_method')}
                                                </label>
                                                <select
                                                    value={formPaymentMethod}
                                                    onChange={(e) => setFormPaymentMethod(e.target.value)}
                                                    className="w-full px-2 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                                                >
                                                    <option value="Cash">Cash</option>
                                                    <option value="Credit Card">Credit Card</option>
                                                    <option value="Check">Check</option>
                                                    <option value="EFT">EFT / ACH</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_ref_no')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formDocNumber}
                                                    onChange={(e) => setFormDocNumber(e.target.value)}
                                                    placeholder="Ref #"
                                                    className="w-full px-2 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    4. QBO BILL / VENDOR CREDIT / PURCHASE ORDER HEADER (/app/bill)
                                    Vendor, Terms, Bill Date, Due Date, Bill no., Mailing Address, AP Account
                                   ========================================================= */}
                                {isBillForm && (
                                    <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.type_vendor')}
                                                </label>
                                                <input
                                                    type="text"
                                                    list="contacts-datalist"
                                                    value={formPayeeName}
                                                    onChange={(e) => setFormPayeeName(e.target.value)}
                                                    placeholder="Choose a vendor"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_terms')}
                                                </label>
                                                <select
                                                    value={formTerms}
                                                    onChange={(e) => {
                                                        setFormTerms(e.target.value)
                                                        setFormDueDate(computeDueDateFromTerms(formDate, e.target.value))
                                                    }}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    <option value="Due on receipt">Due on receipt</option>
                                                    <option value="Net 15">Net 15</option>
                                                    <option value="Net 30">Net 30</option>
                                                    <option value="Net 60">Net 60</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_bill_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formDate}
                                                    onChange={(e) => {
                                                        setFormDate(e.target.value)
                                                        setFormDueDate(computeDueDateFromTerms(e.target.value, formTerms))
                                                    }}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_due_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    value={formDueDate}
                                                    onChange={(e) => setFormDueDate(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_bill_no')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formDocNumber}
                                                    onChange={(e) => setFormDocNumber(e.target.value)}
                                                    placeholder="Bill / Ref #"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_mailing_address')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formAddress}
                                                    onChange={(e) => setFormAddress(e.target.value)}
                                                    placeholder="Vendor Mailing Address"
                                                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_ap_account')}
                                                </label>
                                                <select
                                                    value={formBankQbId}
                                                    onChange={(e) => setFormBankQbId(e.target.value)}
                                                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({a.account_type})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    5. QBO PAY BILLS HEADER (/app/paybills — BillPayment)
                                   ========================================================= */}
                                {modalMode === 'BillPayment' && (
                                    <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_payment_account')}
                                                </label>
                                                <select
                                                    value={formBankQbId}
                                                    onChange={(e) => setFormBankQbId(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({formatCurrency(a.current_balance)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.type_vendor')}
                                                </label>
                                                <input
                                                    type="text"
                                                    list="contacts-datalist"
                                                    value={formPayeeName}
                                                    onChange={(e) => setFormPayeeName(e.target.value)}
                                                    placeholder="Vendor to pay"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formDate}
                                                    onChange={(e) => setFormDate(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_check_num')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formDocNumber}
                                                    onChange={(e) => setFormDocNumber(e.target.value)}
                                                    placeholder="Check / EFT #"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                        </div>
                                        {openBillsForCompany.length > 0 && (
                                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                                <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mb-1.5">
                                                    {t('external_accounting.qbo_open_bills_hint')}
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {openBillsForCompany.map(b => (
                                                        <button
                                                            key={b.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setFormPayeeName(b.entity_name || '')
                                                                setFormMemo(`Pago Bill ${b.doc_number ? `#${b.doc_number}` : ''} (${b.txn_date})`)
                                                                const apAcc = accounts.find(a => a.account_type === 'Accounts Payable') || accounts.find(a => a.qb_account_id === b.account_qb_id)
                                                                setFormLines([{
                                                                    account_qb_id: apAcc?.qb_account_id || b.account_qb_id || '',
                                                                    account_name: apAcc?.name || b.account_name || '',
                                                                    description: `Bill ${b.doc_number || ''} — ${b.entity_name || ''}`,
                                                                    amount: String(b.total_amount || ''),
                                                                    entity_name: b.entity_name || ''
                                                                }])
                                                            }}
                                                            className="px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-200 font-semibold text-[11px] cursor-pointer"
                                                        >
                                                            {b.entity_name || 'Vendor'} · #{b.doc_number || b.id} · {formatCurrency(b.total_amount)}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* =========================================================
                                    6. QBO CUSTOMER SALES FORMS HEADER (Invoice, Estimate, CreditMemo, SalesReceipt, RefundReceipt)
                                   ========================================================= */}
                                {isSalesForm && (
                                    <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.type_customer')}
                                                </label>
                                                <input
                                                    type="text"
                                                    list="contacts-datalist"
                                                    value={formPayeeName}
                                                    onChange={(e) => {
                                                        setFormPayeeName(e.target.value)
                                                        const found = contacts.find(c => (c.display_name || '').toLowerCase() === e.target.value.trim().toLowerCase())
                                                        if (found?.email) setFormCustomerEmail(found.email)
                                                    }}
                                                    placeholder="Customer / Tenant"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_customer_email')}
                                                </label>
                                                <input
                                                    type="email"
                                                    value={formCustomerEmail}
                                                    onChange={(e) => setFormCustomerEmail(e.target.value)}
                                                    placeholder="customer@email.com"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formDate}
                                                    onChange={(e) => {
                                                        setFormDate(e.target.value)
                                                        setFormDueDate(computeDueDateFromTerms(e.target.value, formTerms))
                                                    }}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            {(modalMode === 'Invoice' || modalMode === 'Estimate') ? (
                                                <div>
                                                    <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                        {t('external_accounting.qbo_field_due_date')}
                                                    </label>
                                                    <input
                                                        type="date"
                                                        value={formDueDate}
                                                        onChange={(e) => setFormDueDate(e.target.value)}
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                    />
                                                </div>
                                            ) : (
                                                <div>
                                                    <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                        {t('external_accounting.field_payment_method')}
                                                    </label>
                                                    <select
                                                        value={formPaymentMethod}
                                                        onChange={(e) => setFormPaymentMethod(e.target.value)}
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                    >
                                                        <option value="Check">Check</option>
                                                        <option value="Cash">Cash</option>
                                                        <option value="EFT">EFT / ACH</option>
                                                        <option value="Credit Card">Credit Card</option>
                                                    </select>
                                                </div>
                                            )}
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_invoice_no')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formDocNumber}
                                                    onChange={(e) => setFormDocNumber(e.target.value)}
                                                    placeholder="INV-1001"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_billing_address')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formAddress}
                                                    onChange={(e) => setFormAddress(e.target.value)}
                                                    placeholder="Customer Billing Address"
                                                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_terms')}
                                                </label>
                                                <select
                                                    value={formTerms}
                                                    onChange={(e) => {
                                                        setFormTerms(e.target.value)
                                                        setFormDueDate(computeDueDateFromTerms(formDate, e.target.value))
                                                    }}
                                                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                                                >
                                                    <option value="Due on receipt">Due on receipt</option>
                                                    <option value="Net 15">Net 15</option>
                                                    <option value="Net 30">Net 30</option>
                                                    <option value="Net 60">Net 60</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {(modalMode === 'SalesReceipt' || modalMode === 'RefundReceipt')
                                                        ? t('external_accounting.field_deposit_to')
                                                        : t('external_accounting.col_account')}
                                                </label>
                                                <select
                                                    value={formBankQbId}
                                                    onChange={(e) => setFormBankQbId(e.target.value)}
                                                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({a.account_type})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    7. QBO RECEIVE PAYMENT HEADER (/app/recvpayment — Payment)
                                   ========================================================= */}
                                {modalMode === 'Payment' && (
                                    <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.type_customer')}
                                                </label>
                                                <input
                                                    type="text"
                                                    list="contacts-datalist"
                                                    value={formPayeeName}
                                                    onChange={(e) => setFormPayeeName(e.target.value)}
                                                    placeholder="Customer name"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formDate}
                                                    onChange={(e) => setFormDate(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_payment_method')}
                                                </label>
                                                <select
                                                    value={formPaymentMethod}
                                                    onChange={(e) => setFormPaymentMethod(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    <option value="Check">Check</option>
                                                    <option value="Cash">Cash</option>
                                                    <option value="EFT">EFT / ACH</option>
                                                    <option value="Credit Card">Credit Card</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.qbo_field_ref_no')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formDocNumber}
                                                    onChange={(e) => setFormDocNumber(e.target.value)}
                                                    placeholder="Check # / EFT"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_deposit_to')}
                                                </label>
                                                <select
                                                    value={formBankQbId}
                                                    onChange={(e) => setFormBankQbId(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({formatCurrency(a.current_balance)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        {openInvoicesForCompany.length > 0 && (
                                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                                <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1.5">
                                                    {t('external_accounting.qbo_open_invoices_hint')}
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {openInvoicesForCompany.map(inv => (
                                                        <button
                                                            key={inv.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setFormPayeeName(inv.entity_name || '')
                                                                setFormMemo(`Cobro Invoice ${inv.doc_number ? `#${inv.doc_number}` : ''} (${inv.txn_date})`)
                                                                const arAcc = accounts.find(a => a.account_type === 'Accounts Receivable') || accounts.find(a => a.qb_account_id === inv.account_qb_id)
                                                                setFormLines([{
                                                                    account_qb_id: arAcc?.qb_account_id || inv.account_qb_id || '',
                                                                    account_name: arAcc?.name || inv.account_name || '',
                                                                    description: `Invoice ${inv.doc_number || ''} — ${inv.entity_name || ''}`,
                                                                    amount: String(inv.total_amount || ''),
                                                                    entity_name: inv.entity_name || ''
                                                                }])
                                                            }}
                                                            className="px-2.5 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 font-semibold text-[11px] cursor-pointer"
                                                        >
                                                            {inv.entity_name || 'Customer'} · #{inv.doc_number || inv.id} · {formatCurrency(inv.total_amount)}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* =========================================================
                                    8. QBO TRANSFER & PAY DOWN CREDIT CARD (/app/transfer, /app/paydowncreditcard)
                                   ========================================================= */}
                                {isTransferLike && (
                                    <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {modalMode === 'PayDownCreditCard'
                                                        ? t('external_accounting.qbo_field_bank_used_to_pay')
                                                        : t('external_accounting.field_from_account')}
                                                </label>
                                                <select
                                                    value={formBankQbId}
                                                    onChange={(e) => setFormBankQbId(e.target.value)}
                                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({formatCurrency(a.current_balance)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {modalMode === 'PayDownCreditCard'
                                                        ? t('external_accounting.qbo_field_cc_to_pay')
                                                        : t('external_accounting.field_to_account')}
                                                </label>
                                                <select
                                                    value={formToAccountQbId}
                                                    onChange={(e) => setFormToAccountQbId(e.target.value)}
                                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({formatCurrency(a.current_balance)})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_amount')}
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    required
                                                    value={formAmount}
                                                    onChange={(e) => setFormAmount(e.target.value)}
                                                    placeholder="0.00"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-black text-base"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_date')}
                                                </label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formDate}
                                                    onChange={(e) => setFormDate(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                                />
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_memo')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formMemo}
                                                    onChange={(e) => setFormMemo(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    9. QBO JOURNAL ENTRY HEADER (/app/journal)
                                    Journal Date & Journal No.
                                   ========================================================= */}
                                {modalMode === 'JournalEntry' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.qbo_field_journal_date')}
                                            </label>
                                            <input
                                                type="date"
                                                required
                                                value={formDate}
                                                onChange={(e) => setFormDate(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                {t('external_accounting.qbo_field_journal_no')}
                                            </label>
                                            <input
                                                type="text"
                                                value={formDocNumber}
                                                onChange={(e) => setFormDocNumber(e.target.value)}
                                                placeholder="JE-101"
                                                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* =========================================================
                                    LINE ITEM GRIDS (1:1 WITH QUICKBOOKS ONLINE)
                                   ========================================================= */}
                                {!isTransferLike && (
                                    <div className="space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <span className="font-black uppercase text-[11px] tracking-wider text-emerald-700 dark:text-emerald-400">
                                                {modalMode === 'Deposit'
                                                    ? t('external_accounting.qbo_deposit_funds_title')
                                                    : isSalesForm
                                                    ? t('external_accounting.qbo_item_details_title')
                                                    : t('external_accounting.qbo_category_details_title')}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setFormLines(prev => [
                                                    ...prev,
                                                    {
                                                        account_qb_id: prev[prev.length - 1]?.account_qb_id || accounts[0]?.qb_account_id || '',
                                                        account_name: prev[prev.length - 1]?.account_name || accounts[0]?.name || '',
                                                        description: '',
                                                        amount: '',
                                                        posting_type: modalMode === 'JournalEntry' ? 'Credit' : 'Debit',
                                                        entity_name: '',
                                                        payment_method: 'Check',
                                                        check_num: '',
                                                        item_id: '',
                                                        item_name: '',
                                                        qty: '1',
                                                        rate: ''
                                                    }
                                                ])}
                                                className="px-3 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer"
                                            >
                                                {t('external_accounting.btn_add_line')}
                                            </button>
                                        </div>

                                        {/* GRID A: QBO BANK DEPOSIT 6-COLUMN TABLE (RECEIVED FROM | ACCOUNT | DESCRIPTION | PAYMENT METHOD | REF NO. | AMOUNT) */}
                                        {modalMode === 'Deposit' && (
                                            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                                <table className="w-full text-xs border-collapse">
                                                    <thead className="bg-slate-100 dark:bg-slate-800/90 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">
                                                        <tr>
                                                            <th className="py-2 px-2 text-center w-8">#</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_received_from')}</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_account')}</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_description')}</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_payment_method')}</th>
                                                            <th className="py-2 px-2 text-left w-28">{t('external_accounting.qbo_col_ref_no')}</th>
                                                            <th className="py-2 px-2 text-right w-32">{t('external_accounting.qbo_col_amount')}</th>
                                                            <th className="py-2 px-2 text-center w-8"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                                        {formLines.map((line, idx) => (
                                                            <tr key={idx} className="bg-white dark:bg-slate-900">
                                                                <td className="py-1.5 px-2 text-center font-mono text-slate-400">{idx + 1}</td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="text"
                                                                        list="contacts-datalist"
                                                                        value={line.entity_name || ''}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, entity_name: e.target.value } : item))}
                                                                        placeholder="Customer / Payor"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <select
                                                                        value={line.account_qb_id}
                                                                        onChange={(e) => {
                                                                            const acc = accounts.find(a => a.qb_account_id === e.target.value)
                                                                            setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                                ...item,
                                                                                account_qb_id: e.target.value,
                                                                                account_name: acc?.name || ''
                                                                            } : item))
                                                                        }}
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                    >
                                                                        {accounts.map(a => (
                                                                            <option key={a.qb_account_id} value={a.qb_account_id}>
                                                                                {a.name} ({a.account_type})
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="text"
                                                                        value={line.description}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, description: e.target.value } : item))}
                                                                        placeholder="Description"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <select
                                                                        value={line.payment_method || 'Check'}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, payment_method: e.target.value } : item))}
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                    >
                                                                        <option value="Check">Check</option>
                                                                        <option value="Cash">Cash</option>
                                                                        <option value="EFT">EFT / ACH</option>
                                                                        <option value="Credit Card">Credit Card</option>
                                                                    </select>
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="text"
                                                                        value={line.check_num || ''}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, check_num: e.target.value } : item))}
                                                                        placeholder="Check / Ref #"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        required
                                                                        value={line.amount}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, amount: e.target.value } : item))}
                                                                        placeholder="0.00"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2 text-center">
                                                                    {formLines.length > 1 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setFormLines(prev => prev.filter((_, i) => i !== idx))}
                                                                            className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {/* GRID B: QBO JOURNAL ENTRY 6-COLUMN TABLE (# | ACCOUNT | DEBITS | CREDITS | DESCRIPTION | NAME) */}
                                        {modalMode === 'JournalEntry' && (() => {
                                            const debits = formLines
                                                .filter(l => (l.posting_type || 'Debit') === 'Debit')
                                                .reduce((s, l) => s + Number(l.amount || 0), 0)
                                            const credits = formLines
                                                .filter(l => l.posting_type === 'Credit')
                                                .reduce((s, l) => s + Number(l.amount || 0), 0)
                                            const balanced = Math.abs(debits - credits) <= 0.01
                                            return (
                                                <div className="space-y-2">
                                                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                                        <table className="w-full text-xs border-collapse">
                                                            <thead className="bg-slate-100 dark:bg-slate-800/90 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">
                                                                <tr>
                                                                    <th className="py-2 px-2 text-center w-8">#</th>
                                                                    <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_account')}</th>
                                                                    <th className="py-2 px-2 text-right w-32">{t('external_accounting.qbo_col_debits')}</th>
                                                                    <th className="py-2 px-2 text-right w-32">{t('external_accounting.qbo_col_credits')}</th>
                                                                    <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_description')}</th>
                                                                    <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_name')}</th>
                                                                    <th className="py-2 px-2 text-center w-8"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                                                {formLines.map((line, idx) => {
                                                                    const isDebit = (line.posting_type || 'Debit') === 'Debit'
                                                                    return (
                                                                        <tr key={idx} className="bg-white dark:bg-slate-900">
                                                                            <td className="py-1.5 px-2 text-center font-mono text-slate-400">{idx + 1}</td>
                                                                            <td className="py-1.5 px-2">
                                                                                <select
                                                                                    value={line.account_qb_id}
                                                                                    onChange={(e) => {
                                                                                        const acc = accounts.find(a => a.qb_account_id === e.target.value)
                                                                                        setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                                            ...item,
                                                                                            account_qb_id: e.target.value,
                                                                                            account_name: acc?.name || ''
                                                                                        } : item))
                                                                                    }}
                                                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                                >
                                                                                    {accounts.map(a => (
                                                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                                                            {a.name} ({a.account_type})
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                            </td>
                                                                            <td className="py-1.5 px-2">
                                                                                <input
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    value={isDebit ? line.amount : ''}
                                                                                    onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                                        ...item,
                                                                                        posting_type: 'Debit',
                                                                                        amount: e.target.value
                                                                                    } : item))}
                                                                                    placeholder="0.00"
                                                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                                                                />
                                                                            </td>
                                                                            <td className="py-1.5 px-2">
                                                                                <input
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    value={!isDebit ? line.amount : ''}
                                                                                    onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                                        ...item,
                                                                                        posting_type: 'Credit',
                                                                                        amount: e.target.value
                                                                                    } : item))}
                                                                                    placeholder="0.00"
                                                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                                                                />
                                                                            </td>
                                                                            <td className="py-1.5 px-2">
                                                                                <input
                                                                                    type="text"
                                                                                    value={line.description}
                                                                                    onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, description: e.target.value } : item))}
                                                                                    placeholder="Memo / Description"
                                                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                                                />
                                                                            </td>
                                                                            <td className="py-1.5 px-2">
                                                                                <input
                                                                                    type="text"
                                                                                    list="contacts-datalist"
                                                                                    value={line.entity_name || ''}
                                                                                    onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, entity_name: e.target.value } : item))}
                                                                                    placeholder="Customer / Vendor"
                                                                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                                />
                                                                            </td>
                                                                            <td className="py-1.5 px-2 text-center">
                                                                                {formLines.length > 1 && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => setFormLines(prev => prev.filter((_, i) => i !== idx))}
                                                                                        className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                                                                                    >
                                                                                        ✕
                                                                                    </button>
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    )
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    <div className={`p-2.5 rounded-xl flex items-center justify-between font-mono text-xs font-bold ${
                                                        balanced ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                                    }`}>
                                                        <span>Total Debits: {formatCurrency(debits)} · Total Credits: {formatCurrency(credits)}</span>
                                                        <span>{balanced ? '✓ Balanced (Cuadrado)' : `Δ Diff: ${formatCurrency(Math.abs(debits - credits))}`}</span>
                                                    </div>
                                                </div>
                                            )
                                        })()}

                                        {/* GRID C: QBO SALES FORMS PRODUCT/SERVICE TABLE (Invoice, Estimate, CreditMemo, SalesReceipt, RefundReceipt) */}
                                        {isSalesForm && (
                                            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                                <table className="w-full text-xs border-collapse">
                                                    <thead className="bg-slate-100 dark:bg-slate-800/90 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">
                                                        <tr>
                                                            <th className="py-2 px-2 text-center w-8">#</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_product_service')}</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_account')}</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_description')}</th>
                                                            <th className="py-2 px-2 text-right w-20">{t('external_accounting.qbo_col_qty')}</th>
                                                            <th className="py-2 px-2 text-right w-28">{t('external_accounting.qbo_col_rate')}</th>
                                                            <th className="py-2 px-2 text-right w-32">{t('external_accounting.qbo_col_amount')}</th>
                                                            <th className="py-2 px-2 text-center w-8"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                                        {formLines.map((line, idx) => (
                                                            <tr key={idx} className="bg-white dark:bg-slate-900">
                                                                <td className="py-1.5 px-2 text-center font-mono text-slate-400">{idx + 1}</td>
                                                                <td className="py-1.5 px-2">
                                                                    <select
                                                                        value={line.item_id || ''}
                                                                        onChange={(e) => {
                                                                            const chosen = (companyLists.items || []).find((it: any) => String(it.Id ?? it.id ?? '') === e.target.value)
                                                                            const incomeAccId = chosen?.account_qb_id || chosen?.IncomeAccountRef?.value || ''
                                                                            const acc = incomeAccId ? accounts.find(a => a.qb_account_id === String(incomeAccId)) : null
                                                                            const rawPrice = chosen?.UnitPrice ?? chosen?.unit_price
                                                                            const unitPrice = rawPrice != null ? Number(rawPrice) : null
                                                                            const itemName = chosen?.Name ?? chosen?.FullyQualifiedName ?? chosen?.name ?? ''
                                                                            const itemDesc = chosen?.Description ?? chosen?.description ?? itemName
                                                                            setFormLines(prev => prev.map((item, i) => {
                                                                                if (i !== idx) return item
                                                                                const q = Number(item.qty || 1)
                                                                                const newRate = unitPrice != null && unitPrice > 0 ? String(unitPrice) : (item.rate || '')
                                                                                const newAmt = unitPrice != null && unitPrice > 0 ? String((q * unitPrice).toFixed(2)) : item.amount
                                                                                return {
                                                                                    ...item,
                                                                                    item_id: e.target.value,
                                                                                    item_name: itemName,
                                                                                    account_qb_id: acc?.qb_account_id || item.account_qb_id,
                                                                                    account_name: acc?.name || item.account_name,
                                                                                    description: itemDesc || item.description,
                                                                                    rate: newRate,
                                                                                    amount: newAmt
                                                                                }
                                                                            }))
                                                                        }}
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                    >
                                                                        <option value="">— Select Item / Service —</option>
                                                                        {(companyLists.items || []).map((it: any, itIdx: number) => {
                                                                            const itemId = String(it.Id ?? it.id ?? itIdx)
                                                                            const itemName = it.Name ?? it.FullyQualifiedName ?? it.name ?? `Item #${itemId}`
                                                                            const itemPrice = Number(it.UnitPrice ?? it.unit_price ?? 0)
                                                                            return (
                                                                                <option key={`item-${itemId}-${itIdx}`} value={itemId}>
                                                                                    {itemName} {itemPrice > 0 ? `(${formatCurrency(itemPrice)})` : ''}
                                                                                </option>
                                                                            )
                                                                        })}
                                                                    </select>
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <select
                                                                        value={line.account_qb_id}
                                                                        onChange={(e) => {
                                                                            const acc = accounts.find(a => a.qb_account_id === e.target.value)
                                                                            setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                                ...item,
                                                                                account_qb_id: e.target.value,
                                                                                account_name: acc?.name || ''
                                                                            } : item))
                                                                        }}
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                    >
                                                                        {accounts.map(a => (
                                                                            <option key={a.qb_account_id} value={a.qb_account_id}>
                                                                                {a.name} ({a.account_type})
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="text"
                                                                        value={line.description}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, description: e.target.value } : item))}
                                                                        placeholder="Description on invoice"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="number"
                                                                        step="any"
                                                                        value={line.qty ?? '1'}
                                                                        onChange={(e) => {
                                                                            const qVal = e.target.value
                                                                            setFormLines(prev => prev.map((item, i) => {
                                                                                if (i !== idx) return item
                                                                                const rNum = Number(item.rate || 0)
                                                                                const nextAmt = rNum > 0 ? String((Number(qVal || 0) * rNum).toFixed(2)) : item.amount
                                                                                return { ...item, qty: qVal, amount: nextAmt }
                                                                            }))
                                                                        }}
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={line.rate ?? ''}
                                                                        onChange={(e) => {
                                                                            const rVal = e.target.value
                                                                            setFormLines(prev => prev.map((item, i) => {
                                                                                if (i !== idx) return item
                                                                                const qNum = Number(item.qty || 1)
                                                                                const nextAmt = rVal !== '' ? String((qNum * Number(rVal)).toFixed(2)) : item.amount
                                                                                return { ...item, rate: rVal, amount: nextAmt }
                                                                            }))
                                                                        }}
                                                                        placeholder="0.00"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        required
                                                                        value={line.amount}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? { ...item, amount: e.target.value } : item))}
                                                                        placeholder="0.00"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2 text-center">
                                                                    {formLines.length > 1 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setFormLines(prev => prev.filter((_, i) => i !== idx))}
                                                                            className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {/* GRID D: QBO CATEGORY DETAILS TABLE (Check, Expense, Bill, BillPayment, Payment, VendorCredit, CreditCardCredit, PurchaseOrder) */}
                                        {modalMode !== 'Deposit' && modalMode !== 'JournalEntry' && !isSalesForm && (
                                            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                                <table className="w-full text-xs border-collapse">
                                                    <thead className="bg-slate-100 dark:bg-slate-800/90 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">
                                                        <tr>
                                                            <th className="py-2 px-2 text-center w-8">#</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_category')}</th>
                                                            <th className="py-2 px-2 text-left">{t('external_accounting.qbo_col_description')}</th>
                                                            <th className="py-2 px-2 text-right w-36">{t('external_accounting.qbo_col_amount')}</th>
                                                            <th className="py-2 px-2 text-left w-48">{t('external_accounting.qbo_col_customer_project')}</th>
                                                            <th className="py-2 px-2 text-center w-8"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                                        {formLines.map((line, idx) => (
                                                            <tr key={idx} className="bg-white dark:bg-slate-900">
                                                                <td className="py-1.5 px-2 text-center font-mono text-slate-400">{idx + 1}</td>
                                                                <td className="py-1.5 px-2">
                                                                    <select
                                                                        value={line.account_qb_id}
                                                                        onChange={(e) => {
                                                                            const acc = accounts.find(a => a.qb_account_id === e.target.value)
                                                                            setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                                ...item,
                                                                                account_qb_id: e.target.value,
                                                                                account_name: acc?.name || ''
                                                                            } : item))
                                                                        }}
                                                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                                    >
                                                                        {accounts.map(a => (
                                                                            <option key={a.qb_account_id} value={a.qb_account_id}>
                                                                                {a.name} ({a.account_type})
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="text"
                                                                        placeholder={t('external_accounting.field_line_desc')}
                                                                        value={line.description}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                            ...item,
                                                                            description: e.target.value
                                                                        } : item))}
                                                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        required
                                                                        placeholder="0.00"
                                                                        value={line.amount}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                            ...item,
                                                                            amount: e.target.value
                                                                        } : item))}
                                                                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2">
                                                                    <input
                                                                        type="text"
                                                                        list="contacts-datalist"
                                                                        value={line.entity_name || ''}
                                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                                            ...item,
                                                                            entity_name: e.target.value
                                                                        } : item))}
                                                                        placeholder="Customer / Project"
                                                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                                    />
                                                                </td>
                                                                <td className="py-1.5 px-2 text-center">
                                                                    {formLines.length > 1 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setFormLines(prev => prev.filter((_, i) => i !== idx))}
                                                                            className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {/* QBO Relational Location/Property, Class & Bottom Memo Fields */}
                                        <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.drilldown_col_location')}
                                                </label>
                                                <select
                                                    value={formDepartmentQbId}
                                                    onChange={(e) => setFormDepartmentQbId(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                >
                                                    <option value="">— No Location / Property —</option>
                                                    {(companyLists.departments || []).map((dep: any) => (
                                                        <option key={dep.Id} value={dep.Id}>{dep.Name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.drilldown_col_class')}
                                                </label>
                                                <select
                                                    value={formClassQbId}
                                                    onChange={(e) => setFormClassQbId(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                >
                                                    <option value="">— No Class —</option>
                                                    {(companyLists.classes || []).map((cls: any) => (
                                                        <option key={cls.Id} value={cls.Id}>
                                                            {cls.Name}{cls.class_code ? ` (${cls.class_code})` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                    {t('external_accounting.field_memo')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formMemo}
                                                    onChange={(e) => setFormMemo(e.target.value)}
                                                    placeholder="Memo / Notes"
                                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                                    <div className="text-xs font-mono font-bold text-slate-500">
                                        {t('external_accounting.qbo_total_label')}: <span className="text-slate-900 dark:text-white font-black">{formatCurrency(liveModalTotal)}</span>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => setModalMode(null)}
                                            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer"
                                        >
                                            {t('external_accounting.close_btn')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={saving}
                                            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm cursor-pointer"
                                        >
                                            {t('external_accounting.btn_save_transaction')}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            })()}

            {/* MODAL: QBO TRANSACTION DETAIL DRILL-DOWN REPORT (PROFIT & LOSS / BALANCE SHEET / CHART OF ACCOUNTS RUN REPORT) */}
            {drilldownReportModal && (() => {
                const groups = filteredDrilldownGroups
                const totalTxnsCount = groups.reduce((s, g) => s + (g.transactions || []).length, 0)
                const totalBeginningBalance = groups.reduce((s, g) => s + Number(g.beginning_balance || 0), 0)
                const totalNetChange = groups.reduce((s, g) => s + Number(g.period_net_change || 0), 0)
                const totalEndingBalance = groups.reduce((s, g) => s + Number(g.ending_balance || 0), 0)
                const hasBalanceSheetGroup = groups.some(g => g.is_balance_sheet || Math.abs(Number(g.beginning_balance || 0)) > 0.004)
                return (
                    <div
                        className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
                        onClick={() => setDrilldownReportModal(null)}
                    >
                        <div
                            className="w-full max-w-6xl rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Top Report Header + Export Excel (.XLS / .CSV) & Print PDF Actions */}
                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                            {t('external_accounting.drilldown_modal_title')}
                                        </span>
                                        <span className="text-xs font-mono text-slate-500">
                                            ({groups.length} {t('external_accounting.tab_accounts')} · {totalTxnsCount} {t('external_accounting.col_txns_count')})
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white mt-1">
                                        {drilldownReportModal.title}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {drilldownReportModal.subtitle}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="relative w-52">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={drilldownSearch}
                                            onChange={(e) => setDrilldownSearch(e.target.value)}
                                            placeholder={t('external_accounting.search_placeholder')}
                                            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                                        />
                                    </div>

                                    <button
                                        type="button"
                                        onClick={exportDrilldownReportXls}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-xs"
                                    >
                                        <Download size={14} />
                                        <span>{t('external_accounting.drilldown_btn_export_xls')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={exportDrilldownReportCsv}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold cursor-pointer"
                                    >
                                        <Download size={14} />
                                        <span>.CSV</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handlePrintDrilldownReportPdf}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-xs"
                                    >
                                        <Printer size={14} />
                                        <span>{t('external_accounting.drilldown_btn_print_pdf')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setDrilldownReportModal(null)}
                                        className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {t('external_accounting.close_btn')}
                                    </button>
                                </div>
                            </div>

                            {/* KPI Summary Strip */}
                            <div className={`grid grid-cols-2 ${hasBalanceSheetGroup ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-2.5 text-xs`}>
                                {hasBalanceSheetGroup && (
                                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {t('external_accounting.beginning_balance')}
                                        </div>
                                        <div className="text-sm font-black font-mono tabular-nums mt-0.5">
                                            {formatCurrency(totalBeginningBalance)}
                                        </div>
                                    </div>
                                )}
                                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        {t('external_accounting.col_txns_count')}
                                    </div>
                                    <div className="text-sm font-black font-mono tabular-nums mt-0.5">
                                        {totalTxnsCount}
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        {t('external_accounting.col_amount')} (Net Change)
                                    </div>
                                    <div className={`text-sm font-black font-mono tabular-nums mt-0.5 ${totalNetChange < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        {formatCurrency(totalNetChange)}
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                        {hasBalanceSheetGroup ? t('external_accounting.ending_balance_col') : 'TOTAL'}
                                    </div>
                                    <div className="text-sm font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-0.5">
                                        {formatCurrency(hasBalanceSheetGroup ? totalEndingBalance : totalNetChange)}
                                    </div>
                                </div>
                            </div>

                            {/* Grouped Transaction Detail Table (QBO Transaction Report 11 Columns + Collapsible Account Groups + Beginning Balance + Subtotals) */}
                            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-[60vh]">
                                <table className="w-full text-xs border-collapse">
                                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 font-black uppercase text-[10px] z-10 border-b border-slate-200 dark:border-slate-700">
                                        <tr>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_date')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_type')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_doc_num')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_payee')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.drilldown_col_location')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.drilldown_col_class')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_memo')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.col_account')}</th>
                                            <th className="py-2.5 px-3 text-left">{t('external_accounting.drilldown_col_split')}</th>
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_balance')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                        {groups.length === 0 ? (
                                            <tr>
                                                <td colSpan={11} className="py-10 text-center text-slate-400">
                                                    {t('external_accounting.no_transactions')}
                                                </td>
                                            </tr>
                                        ) : (
                                            groups.map((g) => {
                                                const isCollapsed = !!collapsedDrilldownGroups[g.account_id]
                                                const showBegBal = g.is_balance_sheet || Math.abs(Number(g.beginning_balance || 0)) > 0.004
                                                const txList = g.transactions || []
                                                const countBadge = txList.length + (showBegBal ? 1 : 0)
                                                return (
                                                    <React.Fragment key={g.account_id}>
                                                        {/* Account Group Collapsible Header Row */}
                                                        <tr
                                                            onClick={() => setCollapsedDrilldownGroups(prev => ({
                                                                ...prev,
                                                                [g.account_id]: !prev[g.account_id]
                                                            }))}
                                                            className="bg-slate-100/90 dark:bg-slate-800/90 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 font-black cursor-pointer transition-colors"
                                                        >
                                                            <td colSpan={9} className="py-2 px-3 text-slate-900 dark:text-white">
                                                                <span className="inline-block w-4 font-mono">{isCollapsed ? '▸' : '▾'}</span>
                                                                <span>{g.account_name}</span>
                                                                <span className="ml-1.5 text-[11px] font-mono text-slate-500">({countBadge})</span>
                                                            </td>
                                                            <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                                                                {isCollapsed ? formatCurrency(g.period_net_change || 0) : ''}
                                                            </td>
                                                            <td className="py-2 px-3 text-right font-mono text-emerald-700 dark:text-emerald-300">
                                                                {isCollapsed ? formatCurrency(g.ending_balance || 0) : ''}
                                                            </td>
                                                        </tr>

                                                        {/* Beginning Balance Row */}
                                                        {!isCollapsed && showBegBal && (
                                                            <tr className="bg-slate-50/70 dark:bg-slate-900/50 font-bold text-slate-700 dark:text-slate-300">
                                                                <td className="py-1.5 pl-7 pr-3 whitespace-nowrap">
                                                                    {t('external_accounting.beginning_balance')}
                                                                </td>
                                                                <td colSpan={8} className="py-1.5 px-3 text-slate-400 font-normal">
                                                                    {g.account_name}
                                                                </td>
                                                                <td className="py-1.5 px-3 text-right font-mono">—</td>
                                                                <td className="py-1.5 px-3 text-right font-mono font-black text-slate-900 dark:text-white whitespace-nowrap">
                                                                    {formatCurrency(g.beginning_balance || 0)}
                                                                </td>
                                                            </tr>
                                                        )}

                                                        {/* Chronological Transactions in Group */}
                                                        {!isCollapsed && txList.map((r: any, idx: number) => {
                                                            const matchedTx = transactions.find(tx =>
                                                                (r.id && String(tx.id) === String(r.id)) ||
                                                                (r.qb_txn_id && tx.qb_txn_id === r.qb_txn_id)
                                                            )
                                                            return (
                                                                <tr
                                                                    key={`${g.account_id}-${r.id || r.qb_txn_id || idx}-${idx}`}
                                                                    onClick={() => {
                                                                        if (matchedTx) {
                                                                            openRecordPreview('transaction', matchedTx)
                                                                        } else {
                                                                            openRecordPreview('transaction', r)
                                                                        }
                                                                    }}
                                                                    className="hover:bg-emerald-500/10 cursor-pointer transition-colors"
                                                                >
                                                                    <td className="py-2 pl-7 pr-3 font-mono whitespace-nowrap">{r.txn_date}</td>
                                                                    <td className="py-2 px-3 whitespace-nowrap font-semibold">{r.txn_type}</td>
                                                                    <td className="py-2 px-3 font-mono whitespace-nowrap">{r.doc_number || '—'}</td>
                                                                    <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">{r.entity_name || '—'}</td>
                                                                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{r.location_name || '—'}</td>
                                                                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{r.class_name || '—'}</td>
                                                                    <td className="py-2 px-3 text-slate-500 max-w-[220px] truncate" title={r.memo || ''}>
                                                                        {r.memo || '—'}
                                                                    </td>
                                                                    <td className="py-2 px-3 font-medium">{r.account_name || g.account_name || '—'}</td>
                                                                    <td className="py-2 px-3 text-slate-500">{r.split_account || '—'}</td>
                                                                    <td className={`py-2 px-3 text-right font-mono font-bold whitespace-nowrap ${Number(r.amount || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                                                                        {formatCurrency(r.amount || 0)}
                                                                    </td>
                                                                    <td className="py-2 px-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                                        {formatCurrency(r.running_balance ?? r.amount ?? 0)}
                                                                    </td>
                                                                </tr>
                                                            )
                                                        })}

                                                        {/* Group Subtotal Row: Total for [Account] */}
                                                        {!isCollapsed && (
                                                            <tr className="bg-slate-50 dark:bg-slate-800/60 font-black border-t border-slate-300 dark:border-slate-700">
                                                                <td colSpan={9} className="py-2 pl-5 pr-3 text-slate-800 dark:text-slate-200">
                                                                    {t('external_accounting.total_for_account')} {g.account_name}
                                                                </td>
                                                                <td className={`py-2 px-3 text-right font-mono whitespace-nowrap ${Number(g.period_net_change || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                                                                    {formatCurrency(g.period_net_change || 0)}
                                                                </td>
                                                                <td className="py-2 px-3 text-right font-mono text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                                                                    {showBegBal ? formatCurrency(g.ending_balance || 0) : ''}
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                )
                                            })
                                        )}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-900 text-white font-black text-xs">
                                            <td colSpan={9} className="py-3 px-3">
                                                TOTAL — {drilldownReportModal.title} ({totalTxnsCount} {t('external_accounting.col_txns_count')})
                                            </td>
                                            <td className="py-3 px-3 text-right font-mono text-emerald-400 whitespace-nowrap">
                                                {formatCurrency(totalNetChange)}
                                            </td>
                                            <td className="py-3 px-3 text-right font-mono text-emerald-400 whitespace-nowrap">
                                                {formatCurrency(hasBalanceSheetGroup ? totalEndingBalance : totalNetChange)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                )
            })()}

            {/* MODAL: UNIVERSAL RECORD PREVIEW (ALL TABS — CLICK ANY ELEMENT TO PREVIEW, PRINT, EDIT OR DELETE) */}
            {previewRecord && (() => {
                const { kind, data } = previewRecord
                const closePreview = () => {
                    setPreviewRecord(null)
                }

                const isCheckDoc = kind === 'transaction' && ['Check', 'BillPayment'].includes(String(data?.txn_type || ''))
                const isDepositDoc = kind === 'transaction' && ['Deposit', 'Payment', 'SalesReceipt'].includes(String(data?.txn_type || ''))
                const lineItemsArr: any[] = Array.isArray(data?.line_items) ? data.line_items : []

                const relatedAccountTxns = kind === 'account'
                    ? transactions.filter(tx =>
                        tx.account_qb_id === data.qb_account_id ||
                        tx.gl_account_qb_id === data.qb_account_id ||
                        tx.to_account_qb_id === data.qb_account_id ||
                        tx.account_name === data.name ||
                        tx.category_summary === data.name
                    ).slice(0, 10)
                    : []

                const relatedContactTxns = kind === 'contact'
                    ? transactions.filter(tx =>
                        tx.entity_qb_id === data.qb_entity_id ||
                        (tx.entity_name && data.display_name && tx.entity_name.toLowerCase() === data.display_name.toLowerCase())
                    ).slice(0, 10)
                    : []

                return (
                    <div
                        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
                        onClick={closePreview}
                    >
                        <div
                            className="w-full max-w-4xl rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Top Action Header */}
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4 print:hidden">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                            {kind.toUpperCase()}
                                        </span>
                                        <h3 className="text-base font-black">
                                            {t('external_accounting.preview_modal_title')}
                                        </h3>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        {t('external_accounting.preview_modal_subtitle')} — {activeCompany?.legal_name || activeCompany?.company_name}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {(kind === 'account' || kind === 'contact' || kind === 'budget' || kind === 'list_item') && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                closePreview()
                                                if (kind === 'account') {
                                                    openAccountQuickReport(data)
                                                } else if (kind === 'contact') {
                                                    openListOrContactQuickReport('contact', data.display_name, data.qb_contact_id || data.id, data.display_name)
                                                } else if (kind === 'budget') {
                                                    openAccountQuickReport({ qb_account_id: data.account_qb_id, name: data.account_name, account_type: data.account_type })
                                                } else if (kind === 'list_item') {
                                                    const lk = data.listKey
                                                    const nm = data.Name || data.FullyQualifiedName || data.name || ''
                                                    const qid = String(data.Id || data.qb_id || data.id || '')
                                                    if (lk === 'items') openListOrContactQuickReport('item', nm, qid, nm)
                                                    else if (lk === 'departments') openListOrContactQuickReport('location', nm, qid, nm)
                                                    else if (lk === 'classes') openListOrContactQuickReport('class', nm, qid, nm)
                                                    else if (lk === 'paymentMethods') openListOrContactQuickReport('payment_method', nm, qid, nm)
                                                    else if (lk === 'terms') openListOrContactQuickReport('term', nm, qid, nm)
                                                    else openAccountQuickReport({ qb_account_id: qid, name: nm })
                                                }
                                            }}
                                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-xs"
                                        >
                                            <span>📊 {t('external_accounting.coa_action_run_report')}</span>
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => handlePrintRecord(kind, data)}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold cursor-pointer transition-colors"
                                    >
                                        <Printer size={14} />
                                        <span>{t('external_accounting.preview_btn_print')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleEditRecord(kind, data)}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-xs"
                                    >
                                        <Edit3 size={14} />
                                        <span>{t('external_accounting.preview_btn_edit')}</span>
                                    </button>

                                    {kind === 'transaction' && !String(data?.memo || '').includes('[VOIDED') && Number(data?.total_amount || 0) > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                closePreview()
                                                handleVoidTransaction(data)
                                            }}
                                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold cursor-pointer transition-colors"
                                        >
                                            <span>{t('external_accounting.preview_btn_void')}</span>
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => openDeleteWizard(kind, data)}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-xs"
                                    >
                                        <Trash2 size={14} />
                                        <span>{t('external_accounting.preview_btn_delete')}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={closePreview}
                                        className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {t('external_accounting.close_btn')}
                                    </button>
                                </div>
                            </div>

                            {/* BODY 1: OFFICIAL CHECK FACE + VOUCHER STUB */}
                            {isCheckDoc && (
                                <div className="space-y-4">
                                    <div className="rounded-xl border-2 border-slate-800 p-6 bg-gradient-to-br from-emerald-50/50 via-white to-slate-50 text-slate-900 space-y-5 font-serif shadow-inner">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="text-base font-bold uppercase tracking-wide">
                                                    {activeCompany?.legal_name || activeCompany?.company_name}
                                                </div>
                                                <div className="text-xs text-slate-600 font-sans font-semibold">
                                                    {data.account_name}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs font-sans font-bold text-slate-500">
                                                    CHECK NO. <span className="text-base font-mono text-slate-900">#{data.doc_number || 'EFT'}</span>
                                                </div>
                                                <div className="text-xs font-sans mt-1">
                                                    DATE: <span className="font-mono font-bold">{data.txn_date}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-4 border-b border-slate-400 pb-2">
                                            <div className="text-xs font-sans font-bold text-slate-500 shrink-0">
                                                {t('external_accounting.pay_to_order_of')}:
                                            </div>
                                            <div className="flex-1 text-base font-bold">
                                                {data.entity_name || data.category_summary || '—'}
                                            </div>
                                            <div className="px-3 py-1.5 border-2 border-slate-800 bg-white font-mono font-black text-base">
                                                {formatCurrency(data.total_amount)}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between border-b border-slate-400 pb-2 text-xs font-mono uppercase">
                                            <span>*** {numberToEnglishWords(Number(data.total_amount || 0))} ***</span>
                                            <span className="font-sans font-bold">{t('external_accounting.dollars_label')}</span>
                                        </div>

                                        <div className="flex items-end justify-between pt-4 text-xs font-sans">
                                            <div>
                                                <span className="font-bold text-slate-500">MEMO: </span>
                                                <span>{data.memo || data.category_summary || ''}</span>
                                            </div>
                                            <div className="w-56 border-t border-slate-600 text-center pt-1 text-[10px] uppercase tracking-wider text-slate-500">
                                                AUTHORIZED SIGNATURE
                                            </div>
                                        </div>
                                    </div>

                                    {/* Check Voucher Stub */}
                                    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="font-black uppercase text-[10px] tracking-wider text-slate-400">
                                                {t('external_accounting.check_voucher_stub')}
                                            </span>
                                            <span className="font-mono text-[11px] text-slate-500">
                                                QBO ID: {data.qb_txn_id || 'LOCAL'} · Status: {data.cleared_status || 'Uncleared'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between font-bold">
                                            <span>{data.entity_name || '—'} — #{data.doc_number || 'EFT'} ({data.txn_date})</span>
                                            <span className="font-mono text-red-600 dark:text-red-400">-{formatCurrency(data.total_amount)}</span>
                                        </div>
                                        <div className="text-slate-600 dark:text-slate-300">
                                            {t('external_accounting.col_category')}: <span className="font-bold">{data.category_summary || '—'}</span> · Memo: {data.memo || '—'}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* BODY 2: OFFICIAL BANK DEPOSIT SLIP */}
                            {isDepositDoc && (
                                <div className="rounded-xl border-2 border-emerald-600/70 bg-emerald-50/20 dark:bg-emerald-950/20 p-5 space-y-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-500/30 pb-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                                                {t('external_accounting.preview_deposit_slip')}
                                            </div>
                                            <div className="text-lg font-black mt-0.5">
                                                {data.account_name}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {t('external_accounting.col_payee')}: <span className="font-bold text-slate-800 dark:text-slate-200">{data.entity_name || 'Depósito General'}</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-mono text-slate-500">
                                                REF #{data.doc_number || 'DEP'} · {data.txn_date}
                                            </div>
                                            <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                                                +{formatCurrency(data.total_amount)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_category')}</div>
                                            <div className="font-bold mt-0.5">{data.category_summary || '—'}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_payment_method')}</div>
                                            <div className="font-bold mt-0.5">{data.payment_method || 'Deposit'}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_status')}</div>
                                            <div className="font-bold mt-0.5">{data.cleared_status || 'Cleared'}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">QBO ID</div>
                                            <div className="font-mono font-bold mt-0.5">{data.qb_txn_id || 'LOCAL'}</div>
                                        </div>
                                    </div>

                                    {data.memo && (
                                        <div className="text-xs p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <span className="font-bold text-slate-500">MEMO: </span>
                                            <span>{data.memo}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* BODY 3: OTHER TRANSACTIONS (EXPENSE, BILL, INVOICE, JOURNAL ENTRY, TRANSFER) */}
                            {kind === 'transaction' && !isCheckDoc && !isDepositDoc && (
                                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 p-5 space-y-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">
                                                {t('external_accounting.preview_voucher_details')} ({data.txn_type})
                                            </span>
                                            <h4 className="text-lg font-black mt-0.5">
                                                {data.entity_name || data.category_summary || data.txn_type}
                                            </h4>
                                            <p className="text-xs text-slate-500">
                                                {t('external_accounting.col_account')}: <span className="font-bold text-slate-800 dark:text-slate-200">{data.account_name || '—'}</span>
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-mono text-slate-500">
                                                #{data.doc_number || '—'} · {data.txn_date}
                                            </div>
                                            <div className="text-2xl font-black font-mono mt-1">
                                                {formatCurrency(data.total_amount)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_category')}</div>
                                            <div className="font-bold mt-0.5">{data.category_summary || data.to_account_name || '—'}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.field_due_date')}</div>
                                            <div className="font-mono font-bold mt-0.5">{data.due_date || data.txn_date}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_status')}</div>
                                            <div className="font-bold mt-0.5">{data.cleared_status || 'Uncleared'}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">QBO ID</div>
                                            <div className="font-mono font-bold mt-0.5">{data.qb_txn_id || 'LOCAL'}</div>
                                        </div>
                                    </div>

                                    {data.memo && (
                                        <div className="text-xs p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                            <span className="font-bold text-slate-500">MEMO: </span>
                                            <span>{data.memo}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* TRANSACTION LINE ITEMS TABLE (IF PRESENT) */}
                            {kind === 'transaction' && lineItemsArr.length > 0 && (
                                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                    <div className="bg-slate-100 dark:bg-slate-800 px-3.5 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                                        {t('external_accounting.qbo_category_details')} ({lineItemsArr.length})
                                    </div>
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase text-slate-400">
                                                <th className="py-2 px-3 text-left">#</th>
                                                <th className="py-2 px-3 text-left">{t('external_accounting.col_account')} / Item</th>
                                                <th className="py-2 px-3 text-left">{t('external_accounting.col_memo')}</th>
                                                <th className="py-2 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                                            {lineItemsArr.map((li: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td className="py-2 px-3 font-mono text-slate-400">{idx + 1}</td>
                                                    <td className="py-2 px-3 font-bold">
                                                        {li.account_name || li.item_name || data.category_summary || '—'}
                                                        {li.posting_type ? ` (${li.posting_type})` : ''}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-500">{li.description || data.memo || '—'}</td>
                                                    <td className="py-2 px-3 text-right font-mono font-bold">
                                                        {formatCurrency(li.amount || 0)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* BODY 4: ACCOUNT PREVIEW DOSSIER + RECENT REGISTER */}
                            {kind === 'account' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_acct_name')}</div>
                                            <div className="text-sm font-black mt-0.5">{data.name}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_acct_type')}</div>
                                            <div className="text-sm font-bold mt-0.5">{data.account_type} ({data.classification || '—'})</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_acct_num')} / QBO ID</div>
                                            <div className="text-sm font-mono font-bold mt-0.5">{data.acct_num || '—'} · #{data.qb_account_id}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                            <div className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">{t('external_accounting.col_current_balance')}</div>
                                            <div className="text-lg font-black font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                                                {formatCurrency(data.current_balance)}
                                            </div>
                                        </div>
                                    </div>

                                    {relatedAccountTxns.length > 0 && (
                                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                            <div className="bg-slate-100 dark:bg-slate-800 px-3.5 py-2 text-[10px] font-black uppercase tracking-wider">
                                                Movimientos Recientes en esta Cuenta ({relatedAccountTxns.length}) — Clic para ver detalle
                                            </div>
                                            <table className="w-full text-xs border-collapse">
                                                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                                                    {relatedAccountTxns.map(tx => (
                                                        <tr
                                                            key={tx.id}
                                                            onClick={() => openRecordPreview('transaction', tx)}
                                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                                                        >
                                                            <td className="py-2 px-3 font-mono">{tx.txn_date}</td>
                                                            <td className="py-2 px-3 font-bold">{tx.txn_type}</td>
                                                            <td className="py-2 px-3 font-mono">#{tx.doc_number || '—'}</td>
                                                            <td className="py-2 px-3 font-semibold">{tx.entity_name || tx.category_summary || '—'}</td>
                                                            <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(tx.total_amount)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* BODY 5: CONTACT (VENDOR / CUSTOMER) PREVIEW DOSSIER */}
                            {kind === 'contact' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_contact_name')}</div>
                                            <div className="text-sm font-black mt-0.5">{data.display_name}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_contact_type')}</div>
                                            <div className="text-sm font-bold mt-0.5">{data.contact_type} {data.vendor_1099 ? '· 1099 Tracked' : ''}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                            <div className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">{t('external_accounting.field_open_balance')}</div>
                                            <div className="text-lg font-black font-mono mt-0.5">{formatCurrency(data.balance || 0)}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_email')}</div>
                                            <div className="font-semibold mt-0.5">{data.email || '—'}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_phone')}</div>
                                            <div className="font-mono font-semibold mt-0.5">{data.phone || '—'}</div>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{t('external_accounting.col_tax_id')}</div>
                                            <div className="font-mono font-semibold mt-0.5">{data.tax_identifier || '—'}</div>
                                        </div>
                                    </div>

                                    {relatedContactTxns.length > 0 && (
                                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                            <div className="bg-slate-100 dark:bg-slate-800 px-3.5 py-2 text-[10px] font-black uppercase tracking-wider">
                                                Historial de Transacciones con {data.display_name} ({relatedContactTxns.length}) — Clic para ver detalle
                                            </div>
                                            <table className="w-full text-xs border-collapse">
                                                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                                                    {relatedContactTxns.map(tx => (
                                                        <tr
                                                            key={tx.id}
                                                            onClick={() => openRecordPreview('transaction', tx)}
                                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                                                        >
                                                            <td className="py-2 px-3 font-mono">{tx.txn_date}</td>
                                                            <td className="py-2 px-3 font-bold">{tx.txn_type}</td>
                                                            <td className="py-2 px-3 font-mono">#{tx.doc_number || '—'}</td>
                                                            <td className="py-2 px-3 text-slate-500">{tx.account_name}</td>
                                                            <td className="py-2 px-3 text-right font-mono font-bold">{formatCurrency(tx.total_amount)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* BODY 6: GENERIC STRUCTURED DOSSIER FOR RECURRING, RECONCILIATION, LIST_ITEM, BANK_RULE, BUDGET */}
                            {!['transaction', 'account', 'contact'].includes(kind) && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                    {Object.entries(data || {})
                                        .filter(([k, v]) => v !== null && v !== undefined && typeof v !== 'object' && k !== 'raw_payload')
                                        .map(([k, v]) => (
                                            <div key={k} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex justify-between items-center gap-2">
                                                <span className="text-[10px] font-bold uppercase text-slate-400">{k.replace(/_/g, ' ')}</span>
                                                <span className="font-mono font-bold text-right">{String(v)}</span>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                )
            })()}

            {/* MODAL: 3-STEP MULTI-QUESTION SECURITY CONFIRMATION WIZARD FOR DELETION (LOCAL + QBO V3) */}
            {deleteWizardTarget && (() => {
                const { kind, data, step, checkLedger: check1, checkQbo: check2 } = deleteWizardTarget
                const recordTitle =
                    kind === 'transaction'
                        ? `${data.txn_type} ${data.doc_number ? `#${data.doc_number}` : ''} — ${data.entity_name || data.category_summary || data.account_name || ''}`
                        : kind === 'account'
                        ? `${data.name} (${data.account_type})`
                        : kind === 'contact'
                        ? `${data.display_name} (${data.contact_type})`
                        : kind === 'recurring'
                        ? `${data.template_name} (${data.txn_type})`
                        : kind === 'reconciliation'
                        ? `${data.account_name} — Corte ${data.statement_ending_date}`
                        : kind === 'list_item'
                        ? `${data.Name || data.FullyQualifiedName || data.id}`
                        : kind === 'bank_rule'
                        ? `${data.rule_name} ("${data.match_text}")`
                        : `${data.account_name} (${data.fiscal_year || budgetYear})`

                const recordAmount =
                    kind === 'transaction'
                        ? formatCurrency(data.total_amount)
                        : kind === 'account'
                        ? formatCurrency(data.current_balance)
                        : kind === 'contact'
                        ? formatCurrency(data.balance || 0)
                        : kind === 'recurring'
                        ? formatCurrency(data.amount)
                        : kind === 'reconciliation'
                        ? formatCurrency(data.ending_balance)
                        : kind === 'budget'
                        ? formatCurrency(data.annualBudget || data.annual_amount || 0)
                        : null

                return (
                    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
                        <div className="w-full max-w-xl rounded-2xl border-2 border-red-500/60 bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 shadow-2xl space-y-5">
                            {/* Header */}
                            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                                        <Trash2 size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black text-red-600 dark:text-red-400">
                                            {t('external_accounting.delete_wizard_title')}
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {t('external_accounting.delete_wizard_subtitle')}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setDeleteWizardTarget(null)}
                                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Step Indicator Pills */}
                            <div className="grid grid-cols-3 gap-2 text-[11px] font-black uppercase text-center">
                                <div className={`py-1.5 px-2 rounded-lg border ${step >= 1 ? 'bg-red-500/15 border-red-500 text-red-600 dark:text-red-300' : 'border-slate-200 dark:border-slate-800 text-slate-400'}`}>
                                    1. Verificación
                                </div>
                                <div className={`py-1.5 px-2 rounded-lg border ${step >= 2 ? 'bg-red-500/15 border-red-500 text-red-600 dark:text-red-300' : 'border-slate-200 dark:border-slate-800 text-slate-400'}`}>
                                    2. Libro Mayor + QBO
                                </div>
                                <div className={`py-1.5 px-2 rounded-lg border ${step >= 3 ? 'bg-red-600 border-red-600 text-white' : 'border-slate-200 dark:border-slate-800 text-slate-400'}`}>
                                    3. Confirmación Final
                                </div>
                            </div>

                            {/* Target Record Summary Card */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">
                                        {kind.toUpperCase()}
                                    </span>
                                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                        ⚡ Sincronización Directa con QuickBooks Online V3
                                    </span>
                                </div>
                                <div className="text-sm font-black pt-1">{recordTitle}</div>
                                {recordAmount && (
                                    <div className="text-base font-mono font-black text-red-600 dark:text-red-400">
                                        {recordAmount}
                                    </div>
                                )}
                            </div>

                            {/* STEP 1 */}
                            {step === 1 && (
                                <div className="space-y-4">
                                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-semibold text-amber-900 dark:text-amber-200">
                                        <div className="font-black uppercase text-[10px] mb-1">
                                            {t('external_accounting.delete_wizard_step1_title')}
                                        </div>
                                        {t('external_accounting.delete_wizard_q1')}
                                    </div>
                                    <div className="flex items-center justify-end gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => setDeleteWizardTarget(null)}
                                            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                                        >
                                            {t('external_accounting.delete_wizard_btn_cancel')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDeleteWizardTarget(prev => prev ? { ...prev, step: 2 } : null)}
                                            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black cursor-pointer"
                                        >
                                            {t('external_accounting.delete_wizard_btn_next_1')}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* STEP 2 */}
                            {step === 2 && (
                                <div className="space-y-4">
                                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                        {t('external_accounting.delete_wizard_q2_label')}
                                    </div>

                                    <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={check1}
                                            onChange={(e) => setDeleteWizardTarget(prev => prev ? { ...prev, checkLedger: e.target.checked } : null)}
                                            className="mt-0.5 cursor-pointer"
                                        />
                                        <span className="font-semibold">{t('external_accounting.delete_wizard_check1')}</span>
                                    </label>

                                    <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={check2}
                                            onChange={(e) => setDeleteWizardTarget(prev => prev ? { ...prev, checkQbo: e.target.checked } : null)}
                                            className="mt-0.5 cursor-pointer"
                                        />
                                        <span className="font-semibold">{t('external_accounting.delete_wizard_check2')}</span>
                                    </label>

                                    <div className="flex items-center justify-between gap-2.5 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setDeleteWizardTarget(prev => prev ? { ...prev, step: 1 } : null)}
                                            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                                        >
                                            {t('external_accounting.delete_wizard_btn_back')}
                                        </button>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setDeleteWizardTarget(null)}
                                                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                                            >
                                                {t('external_accounting.delete_wizard_btn_cancel')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!check1 || !check2}
                                                onClick={() => setDeleteWizardTarget(prev => prev ? { ...prev, step: 3 } : null)}
                                                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-black cursor-pointer"
                                            >
                                                {t('external_accounting.delete_wizard_btn_next_2')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 3 */}
                            {step === 3 && (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-red-500/15 border-2 border-red-500 text-xs font-bold text-red-700 dark:text-red-300 space-y-1">
                                        <div className="font-black uppercase text-[11px]">
                                            ⚠️ {t('external_accounting.delete_wizard_step3_title')}
                                        </div>
                                        <p>{t('external_accounting.delete_wizard_step3_warning')}</p>
                                    </div>

                                    <div className="flex items-center justify-between gap-2.5">
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => setDeleteWizardTarget(prev => prev ? { ...prev, step: 2 } : null)}
                                            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                                        >
                                            {t('external_accounting.delete_wizard_btn_back')}
                                        </button>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                disabled={saving}
                                                onClick={() => setDeleteWizardTarget(null)}
                                                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer"
                                            >
                                                {t('external_accounting.delete_wizard_btn_cancel')}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={saving}
                                                onClick={executeConfirmedDelete}
                                                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-black shadow-lg cursor-pointer"
                                            >
                                                {saving ? '...' : t('external_accounting.delete_wizard_btn_confirm_final')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            })()}

            {/* MODAL: CREATE / EDIT ACCOUNT */}
            {accountModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <h3 className="text-base font-black">{t('external_accounting.btn_new_account')}</h3>
                        <form onSubmit={handleSaveAccount} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_acct_name')}</label>
                                <input
                                    type="text"
                                    required
                                    value={accFormName}
                                    onChange={(e) => setAccFormName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_acct_num')}</label>
                                    <input
                                        type="text"
                                        value={accFormNum}
                                        onChange={(e) => setAccFormNum(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_acct_type')}</label>
                                    <select
                                        value={accFormType}
                                        onChange={(e) => {
                                            const val = e.target.value
                                            setAccFormType(val)
                                            const derivedClass =
                                                ['Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset'].includes(val) ? 'Asset'
                                                : ['Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability'].includes(val) ? 'Liability'
                                                : val === 'Equity' ? 'Equity'
                                                : ['Income', 'Other Income'].includes(val) ? 'Revenue'
                                                : 'Expense'
                                            setAccFormClass(derivedClass)
                                        }}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    >
                                        <option value="Bank">Bank</option>
                                        <option value="Credit Card">Credit Card</option>
                                        <option value="Income">Income</option>
                                        <option value="Other Income">Other Income</option>
                                        <option value="Expense">Expense</option>
                                        <option value="Other Expense">Other Expense</option>
                                        <option value="Cost of Goods Sold">Cost of Goods Sold</option>
                                        <option value="Fixed Asset">Fixed Asset</option>
                                        <option value="Other Current Asset">Other Current Asset</option>
                                        <option value="Other Asset">Other Asset</option>
                                        <option value="Accounts Payable">Accounts Payable</option>
                                        <option value="Accounts Receivable">Accounts Receivable</option>
                                        <option value="Other Current Liability">Other Current Liability</option>
                                        <option value="Long Term Liability">Long Term Liability</option>
                                        <option value="Equity">Equity</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_sub_type')}</label>
                                    <input
                                        type="text"
                                        placeholder="Checking, Savings, RentOrLeaseOfBuildings..."
                                        value={accFormSubType}
                                        onChange={(e) => setAccFormSubType(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_current_balance')}</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={accFormBalance}
                                        onChange={(e) => setAccFormBalance(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_acct_desc')}</label>
                                <input
                                    type="text"
                                    value={accFormDesc}
                                    onChange={(e) => setAccFormDesc(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                />
                            </div>
                            <div className="space-y-2 pt-1">
                                <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={accFormIsSub}
                                        onChange={(e) => setAccFormIsSub(e.target.checked)}
                                    />
                                    <span>{t('external_accounting.field_is_sub_account')}</span>
                                </label>
                                {accFormIsSub && (
                                    <div>
                                        <label className="block font-bold mb-1">{t('external_accounting.field_parent_account')}</label>
                                        <select
                                            value={accFormParentId}
                                            onChange={(e) => setAccFormParentId(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                        >
                                            <option value="">—</option>
                                            {accounts
                                                .filter(a => a.qb_account_id !== editingAccount?.qb_account_id)
                                                .map(a => (
                                                    <option key={a.qb_account_id} value={a.qb_account_id}>
                                                        {a.name} ({a.account_type})
                                                    </option>
                                                ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setAccountModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                    {t('external_accounting.close_btn')}
                                </button>
                                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
                                    {t('external_accounting.btn_save_transaction')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE / EDIT CONTACT */}
            {contactModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <h3 className="text-base font-black">{t('external_accounting.btn_new_contact')}</h3>
                        <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_contact_name')}</label>
                                    <input
                                        type="text"
                                        required
                                        value={conFormName}
                                        onChange={(e) => {
                                            setConFormName(e.target.value)
                                            if (!conFormPrintOnCheck) setConFormPrintOnCheck(e.target.value)
                                        }}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_company_name')}</label>
                                    <input
                                        type="text"
                                        value={conFormCompany}
                                        onChange={(e) => setConFormCompany(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_print_on_check')}</label>
                                    <input
                                        type="text"
                                        value={conFormPrintOnCheck}
                                        onChange={(e) => setConFormPrintOnCheck(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_contact_type')}</label>
                                    <select
                                        value={conFormType}
                                        onChange={(e) => setConFormType(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    >
                                        <option value="Vendor">{t('external_accounting.type_vendor')}</option>
                                        <option value="Customer">{t('external_accounting.type_customer')}</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_tax_id')}</label>
                                    <input
                                        type="text"
                                        value={conFormTaxId}
                                        onChange={(e) => setConFormTaxId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_acct_num')}</label>
                                    <input
                                        type="text"
                                        value={conFormAcctNum}
                                        onChange={(e) => setConFormAcctNum(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_open_balance')}</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={conFormBalance}
                                        onChange={(e) => setConFormBalance(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_email')}</label>
                                    <input
                                        type="email"
                                        value={conFormEmail}
                                        onChange={(e) => setConFormEmail(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_phone')}</label>
                                    <input
                                        type="text"
                                        value={conFormPhone}
                                        onChange={(e) => setConFormPhone(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.field_billing_address')}</label>
                                <input
                                    type="text"
                                    value={conFormAddress}
                                    onChange={(e) => setConFormAddress(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                />
                            </div>
                            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={conForm1099}
                                    onChange={(e) => setConForm1099(e.target.checked)}
                                />
                                <span>{t('external_accounting.col_1099')}</span>
                            </label>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setContactModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                    {t('external_accounting.close_btn')}
                                </button>
                                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
                                    {t('external_accounting.btn_save_transaction')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE / EDIT RECURRING TEMPLATE */}
            {recurringModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <h3 className="text-base font-black">{t('external_accounting.modal_recurring_title')}</h3>
                        <form onSubmit={handleSaveRecurring} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.field_template_name')}</label>
                                <input
                                    type="text"
                                    required
                                    value={recFormName}
                                    onChange={(e) => setRecFormName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_type')}</label>
                                    <select
                                        value={recFormTxnType}
                                        onChange={(e) => setRecFormTxnType(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    >
                                        <option value="Invoice">{t('external_accounting.type_invoice')}</option>
                                        <option value="Deposit">{t('external_accounting.type_deposit')}</option>
                                        <option value="Check">{t('external_accounting.type_check')}</option>
                                        <option value="Bill">{t('external_accounting.type_bill')}</option>
                                        <option value="Expense">{t('external_accounting.type_expense')}</option>
                                        <option value="JournalEntry">{t('external_accounting.type_journal')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_interval')}</label>
                                    <select
                                        value={recFormInterval}
                                        onChange={(e) => setRecFormInterval(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    >
                                        <option value="Monthly">{t('external_accounting.interval_monthly')}</option>
                                        <option value="Weekly">{t('external_accounting.interval_weekly')}</option>
                                        <option value="Unscheduled">{t('external_accounting.interval_unscheduled')}</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_payee')}</label>
                                    <input
                                        type="text"
                                        list="contacts-datalist"
                                        value={recFormEntityName}
                                        onChange={(e) => setRecFormEntityName(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_amount')}</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={recFormAmount}
                                        onChange={(e) => setRecFormAmount(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_next_date')}</label>
                                    <input
                                        type="date"
                                        value={recFormNextDate}
                                        onChange={(e) => setRecFormNextDate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_bank_account')}</label>
                                    <select
                                        value={recFormAccountQbId}
                                        onChange={(e) => setRecFormAccountQbId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                    >
                                        {accounts.map(a => (
                                            <option key={a.qb_account_id} value={a.qb_account_id}>
                                                {a.name} ({a.account_type})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.field_category_account')}</label>
                                    <select
                                        value={recFormGlAccountQbId}
                                        onChange={(e) => setRecFormGlAccountQbId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                    >
                                        {accounts.map(a => (
                                            <option key={a.qb_account_id} value={a.qb_account_id}>
                                                {a.name} ({a.account_type})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.field_memo')}</label>
                                <input
                                    type="text"
                                    value={recFormMemo}
                                    onChange={(e) => setRecFormMemo(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setRecurringModalOpen(false)} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer">
                                    {t('external_accounting.close_btn')}
                                </button>
                                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer">
                                    {t('external_accounting.btn_save_transaction')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default function ExternalAccountingPage() {
    return (
        <ProtectedRoute>
            <ExternalAccountingContent />
        </ProtectedRoute>
    )
}
