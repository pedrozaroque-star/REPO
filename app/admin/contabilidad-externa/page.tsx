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
    BarChart3, Edit3, Trash2, Ban, ArrowLeftRight, BookOpen, ShieldAlert, ChevronRight
} from 'lucide-react'

const ALLOWED_EMAILS = [
    'raquel@tacosgavilan.com',
    'roberto@tacosgavilan.com',
    'roque@tacosgavilan.com',
    'rvelasquez95@yahoo.com',
]
const ALLOWED_USER_IDS = [45, 46, 47]

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

type ActiveTab = 'overview' | 'transactions' | 'checks_deposits' | 'recurring' | 'accounts' | 'contacts' | 'reports'
type ModalMode = 'Check' | 'Deposit' | 'Expense' | 'Invoice' | 'Payment' | 'Bill' | 'BillPayment' | 'Transfer' | 'JournalEntry' | null

interface LineItemDraft {
    account_qb_id: string
    account_name: string
    description: string
    amount: string
    posting_type?: 'Debit' | 'Credit'
    entity_name?: string
    payment_method?: string
    check_num?: string
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

    // Data state
    const [companies, setCompanies] = useState<any[]>([])
    const [accounts, setAccounts] = useState<any[]>([])
    const [contacts, setContacts] = useState<any[]>([])
    const [recurring, setRecurring] = useState<any[]>([])
    const [transactions, setTransactions] = useState<any[]>([])
    const [totalTransactionsCount, setTotalTransactionsCount] = useState<number>(0)
    const [nextCheckNumberByBank, setNextCheckNumberByBank] = useState<Record<string, string>>({})
    const [summary, setSummary] = useState<any>({})

    // Filters for Transactions & Ledger
    const [filterType, setFilterType] = useState<string>('ALL')
    const [filterDirection, setFilterDirection] = useState<string>('ALL')
    const [filterAccountId, setFilterAccountId] = useState<string>('ALL')
    const [filterPeriod, setFilterPeriod] = useState<string>('ALL')
    const [startDate, setStartDate] = useState<string>('')
    const [endDate, setEndDate] = useState<string>('')
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [limit, setLimit] = useState<number>(300)

    // Sub-filters for Accounts & Contacts tabs
    const [accountSearch, setAccountSearch] = useState<string>('')
    const [contactSearch, setContactSearch] = useState<string>('')

    // Transaction Modal State
    const [modalMode, setModalMode] = useState<ModalMode>(null)
    const [editingTxnId, setEditingTxnId] = useState<number | null>(null)
    const [formDate, setFormDate] = useState<string>(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    const [formDocNumber, setFormDocNumber] = useState<string>('')
    const [formBankQbId, setFormBankQbId] = useState<string>('')
    const [formToAccountQbId, setFormToAccountQbId] = useState<string>('')
    const [formPayeeName, setFormPayeeName] = useState<string>('')
    const [formPaymentMethod, setFormPaymentMethod] = useState<string>('Check')
    const [formMemo, setFormMemo] = useState<string>('')
    const [formPrintLater, setFormPrintLater] = useState<boolean>(false)
    const [formAmount, setFormAmount] = useState<string>('')
    const [formLines, setFormLines] = useState<LineItemDraft[]>([
        { account_qb_id: '', account_name: '', description: '', amount: '', posting_type: 'Debit' }
    ])

    // Printable Check Preview Modal
    const [printableCheckTxn, setPrintableCheckTxn] = useState<any | null>(null)

    // Account & Contact Modals
    const [accountModalOpen, setAccountModalOpen] = useState<boolean>(false)
    const [editingAccount, setEditingAccount] = useState<any | null>(null)
    const [accFormName, setAccFormName] = useState<string>('')
    const [accFormNum, setAccFormNum] = useState<string>('')
    const [accFormType, setAccFormType] = useState<string>('Bank')
    const [accFormClass, setAccFormClass] = useState<string>('Asset')
    const [accFormBalance, setAccFormBalance] = useState<string>('0')

    const [contactModalOpen, setContactModalOpen] = useState<boolean>(false)
    const [editingContact, setEditingContact] = useState<any | null>(null)
    const [conFormName, setConFormName] = useState<string>('')
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
        const now = new Date()
        const yr = now.getFullYear()
        const mo = String(now.getMonth() + 1).padStart(2, '0')
        if (preset === 'ALL') {
            setStartDate('')
            setEndDate('')
        } else if (preset === 'THIS_YEAR') {
            setStartDate(`${yr}-01-01`)
            setEndDate(`${yr}-12-31`)
        } else if (preset === 'LAST_YEAR') {
            setStartDate(`${yr - 1}-01-01`)
            setEndDate(`${yr - 1}-12-31`)
        } else if (preset === 'THIS_MONTH') {
            setStartDate(`${yr}-${mo}-01`)
            setEndDate(`${yr}-${mo}-31`)
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
                limit: String(limit)
            })
            if (startDate) params.set('startDate', startDate)
            if (endDate) params.set('endDate', endDate)

            const res = await fetch(`/api/external-accounting?${params.toString()}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error loading external accounting')

            setCompanies(json.companies || [])
            if (json.activeRealmId && json.activeRealmId !== activeRealmId) {
                setActiveRealmId(json.activeRealmId)
            }
            setAccounts(json.accounts || [])
            setContacts(json.contacts || [])
            setRecurring(json.recurring || [])
            setTransactions(json.transactions || [])
            setTotalTransactionsCount(json.totalTransactionsCount || 0)
            setNextCheckNumberByBank(json.nextCheckNumberByBank || {})
            setSummary(json.summary || {})
        } catch (err: any) {
            notify('err', err.message || 'Error')
        } finally {
            setLoading(false)
        }
    }, [isAuthorized, activeRealmId, filterType, filterDirection, filterAccountId, startDate, endDate, searchQuery, limit])

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

            const res = await fetch(`/api/external-accounting/reports?${params.toString()}`)
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

    // Open Transaction Modal (Create or Edit)
    const openTransactionModal = (mode: ModalMode, existing?: any) => {
        setModalMode(mode)
        const defaultBank = bankAndCardAccounts.find(a => a.account_type === 'Bank') || bankAndCardAccounts[0]
        const defaultAr = expenseAndGlAccounts.find(a => a.account_type === 'Accounts Receivable') || defaultBank
        const defaultAp = expenseAndGlAccounts.find(a => a.account_type === 'Accounts Payable') || defaultBank
        const defaultIncome = expenseAndGlAccounts.find(a => a.classification === 'Revenue' || a.account_type === 'Income') || expenseAndGlAccounts[0]
        const defaultExpense = expenseAndGlAccounts.find(a => a.classification === 'Expense' || a.account_type === 'Expense') || expenseAndGlAccounts[0]

        const primaryDefaultAcc =
            mode === 'Invoice' ? defaultAr
            : mode === 'Bill' ? defaultAp
            : defaultBank

        const lineDefaultAcc =
            (mode === 'Deposit' || mode === 'Invoice') ? defaultIncome
            : mode === 'Payment' ? (defaultAr || defaultIncome)
            : mode === 'BillPayment' ? (defaultAp || defaultExpense)
            : defaultExpense

        if (existing) {
            setEditingTxnId(existing.id ?? null)
            setFormDate(existing.txn_date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
            setFormDocNumber(existing.doc_number || '')
            setFormBankQbId(existing.account_qb_id || primaryDefaultAcc?.qb_account_id || '')
            setFormToAccountQbId(existing.to_account_qb_id || '')
            setFormPayeeName(existing.entity_name || '')
            setFormPaymentMethod(existing.payment_type || mode || 'Check')
            setFormMemo(existing.memo || '')
            setFormPrintLater(existing.print_status === 'NeedToPrint')
            setFormAmount(String(existing.total_amount || ''))
            const rawLines = Array.isArray(existing.line_items) && existing.line_items.length > 0
                ? existing.line_items.map((l: any) => ({
                    account_qb_id: l.account_qb_id || '',
                    account_name: l.account_name || existing.to_account_name || '',
                    description: l.description || existing.memo || '',
                    amount: String(l.amount ?? existing.total_amount ?? ''),
                    posting_type: l.posting_type || 'Debit',
                    entity_name: l.entity_name || existing.entity_name || '',
                    payment_method: l.payment_method || '',
                    check_num: l.check_num || ''
                }))
                : [{
                    account_qb_id: existing.to_account_qb_id || lineDefaultAcc?.qb_account_id || '',
                    account_name: existing.to_account_name || existing.category_summary || lineDefaultAcc?.name || '',
                    description: existing.memo || '',
                    amount: String(existing.total_amount || ''),
                    posting_type: 'Debit' as const
                }]
            setFormLines(rawLines)
        } else {
            setEditingTxnId(null)
            setFormDate(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
            const bankId = primaryDefaultAcc?.qb_account_id || ''
            setFormBankQbId(bankId)
            setFormDocNumber(mode === 'Check' ? (nextCheckNumberByBank[bankId] || '1001') : '')
            setFormToAccountQbId(expenseAndGlAccounts[1]?.qb_account_id || '')
            setFormPayeeName('')
            setFormPaymentMethod(mode === 'Check' ? 'Check' : mode === 'Deposit' ? 'Check' : 'Cash')
            setFormMemo('')
            setFormPrintLater(false)
            setFormAmount('')
            if (mode === 'JournalEntry') {
                setFormLines([
                    { account_qb_id: defaultExpense?.qb_account_id || '', account_name: defaultExpense?.name || '', description: '', amount: '', posting_type: 'Debit' },
                    { account_qb_id: defaultBank?.qb_account_id || '', account_name: defaultBank?.name || '', description: '', amount: '', posting_type: 'Credit' }
                ])
            } else {
                setFormLines([
                    { account_qb_id: lineDefaultAcc?.qb_account_id || '', account_name: lineDefaultAcc?.name || '', description: '', amount: '', posting_type: 'Debit' }
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
            const matchedContact = contacts.find(c => (c.display_name || '').toLowerCase() === formPayeeName.trim().toLowerCase())

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
                }
            })

            const sumLines = modalMode === 'JournalEntry'
                ? preparedLines.filter(l => l.posting_type === 'Debit').reduce((s, l) => s + Number(l.amount || 0), 0)
                : preparedLines.reduce((s, l) => s + Number(l.amount || 0), 0)
            const finalAmount = modalMode === 'Transfer'
                ? Number(formAmount || 0)
                : (sumLines > 0 ? sumLines : Number(formAmount || 0))

            const res = await fetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_transaction',
                    realmId: activeRealmId,
                    id: editingTxnId,
                    txn_type: modalMode,
                    txn_date: formDate,
                    doc_number: formDocNumber,
                    payment_type: formPaymentMethod,
                    account_qb_id: bankObj?.qb_account_id || formBankQbId,
                    account_name: bankObj?.name || '',
                    to_account_qb_id: modalMode === 'Transfer' ? (toAccObj?.qb_account_id || formToAccountQbId) : preparedLines[0]?.account_qb_id,
                    to_account_name: modalMode === 'Transfer' ? (toAccObj?.name || '') : preparedLines[0]?.account_name,
                    entity_qb_id: matchedContact?.qb_contact_id || null,
                    entity_name: formPayeeName,
                    memo: formMemo,
                    print_status: formPrintLater ? 'NeedToPrint' : 'NotSet',
                    total_amount: finalAmount,
                    line_items: modalMode === 'Transfer' ? [] : preparedLines,
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

    const handleToggleClearedStatus = async (txn: any) => {
        if (txn.is_voided) return
        try {
            const res = await fetch('/api/external-accounting', {
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
        } catch (err: any) {
            notify('err', err.message || 'Error')
        }
    }

    const handleVoidTransaction = async (txn: any) => {
        if (!window.confirm(t('external_accounting.confirm_void_msg'))) return
        try {
            const res = await fetch('/api/external-accounting', {
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
        if (!window.confirm(t('external_accounting.confirm_delete_msg'))) return
        try {
            const res = await fetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_transaction', realmId: activeRealmId, id: txn.id })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error deleting transaction')
            notify('ok', t('external_accounting.saved_successfully'))
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        }
    }

    const handleExecuteRecurring = async (rec: any) => {
        setSaving(true)
        try {
            const res = await fetch('/api/external-accounting', {
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

            const rawPayload = editingRecurring?.raw_payload && Object.keys(editingRecurring.raw_payload).length > 0
                ? editingRecurring.raw_payload
                : {
                    [recFormTxnType]: {
                        Line: glAcc ? [{
                            Amount: Number(recFormAmount || 0),
                            Description: recFormMemo || recFormName,
                            AccountBasedExpenseLineDetail: {
                                AccountRef: { value: glAcc.qb_account_id, name: glAcc.name }
                            }
                        }] : []
                    }
                }

            const res = await fetch('/api/external-accounting', {
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
        if (!window.confirm(t('external_accounting.confirm_delete_msg'))) return
        try {
            const res = await fetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_recurring', realmId: activeRealmId, id: rec.id })
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Error deleting recurring')
            notify('ok', t('external_accounting.saved_successfully'))
            await fetchWorkspaceData()
        } catch (err: any) {
            notify('err', err.message || 'Error')
        }
    }

    const handleSaveAccount = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await fetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_account',
                    realmId: activeRealmId,
                    id: editingAccount?.id,
                    name: accFormName,
                    acct_num: accFormNum,
                    account_type: accFormType,
                    classification: accFormClass,
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
            const res = await fetch('/api/external-accounting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_contact',
                    realmId: activeRealmId,
                    id: editingContact?.id,
                    display_name: conFormName,
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

    const exportTransactionsCsv = () => {
        const headers = ['Date', 'Type', 'Check/Ref #', 'Payee', 'Bank/Account', 'Category/GL Account', 'Memo', 'Inflow (+)', 'Outflow (-)', 'Running Balance', 'Status']
        const rows = transactions.map(r => {
            const isOut = r.direction === 'OUT' || r.direction === 'TRANSFER'
            const isIn = r.direction === 'IN'
            const inflow = !r.is_voided && isIn ? Number(r.total_amount || 0).toFixed(2) : ''
            const outflow = !r.is_voided && isOut ? Number(r.total_amount || 0).toFixed(2) : ''
            const bal = r.running_balance != null ? Number(r.running_balance).toFixed(2) : ''
            return [
                r.txn_date || '',
                r.txn_type || '',
                `"${(r.doc_number || '').replace(/"/g, '""')}"`,
                `"${(r.entity_name || '').replace(/"/g, '""')}"`,
                `"${(r.account_name || '').replace(/"/g, '""')}"`,
                `"${(r.category_summary || '').replace(/"/g, '""')}"`,
                `"${(r.memo || '').replace(/"/g, '""')}"`,
                inflow,
                outflow,
                bal,
                r.is_voided ? 'VOID' : (r.cleared_status || 'Cleared')
            ].join(',')
        })
        const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${(activeCompany?.slug || 'contabilidad')}_registros_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const exportActiveReportCsv = () => {
        if (!reportData) return
        const lines: string[] = []
        const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`

        lines.push(`${esc(activeCompany?.legal_name || activeCompany?.company_name)},${esc(reportType.toUpperCase())},${esc(reportBasis)}`)
        lines.push('')

        if (reportType === 'pnl' && reportData.pnl) {
            const yrs: string[] = reportData.pnl.years || []
            lines.push(['Category', ...yrs, 'Total'].map(esc).join(','))
            lines.push(esc('INCOME'))
            for (const r of reportData.pnl.incomeRows || []) {
                lines.push([r.category, ...yrs.map(y => Number(r.byYear?.[y] || 0).toFixed(2)), Number(r.amount || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['TOTAL INCOME', ...yrs.map(() => ''), Number(reportData.pnl.totalIncome || 0).toFixed(2)].map(esc).join(','))
            lines.push('')
            lines.push(esc('EXPENSES'))
            for (const r of reportData.pnl.expenseRows || []) {
                lines.push([r.category, ...yrs.map(y => Number(r.byYear?.[y] || 0).toFixed(2)), Number(r.amount || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['TOTAL EXPENSES', ...yrs.map(() => ''), Number(reportData.pnl.totalExpenses || 0).toFixed(2)].map(esc).join(','))
            lines.push(['NET INCOME', ...yrs.map(() => ''), Number(reportData.pnl.netIncome || 0).toFixed(2)].map(esc).join(','))
        } else if (reportType === 'balance_sheet' && reportData.balanceSheet) {
            lines.push('Section,Account Name,Account Type,Balance')
            for (const a of reportData.balanceSheet.assets || []) {
                lines.push(['ASSET', a.name, a.account_type, Number(a.current_balance || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['TOTAL ASSETS', '', '', Number(reportData.balanceSheet.totalAssets || 0).toFixed(2)].map(esc).join(','))
            for (const a of reportData.balanceSheet.liabilities || []) {
                lines.push(['LIABILITY', a.name, a.account_type, Number(a.current_balance || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['TOTAL LIABILITIES', '', '', Number(reportData.balanceSheet.totalLiabilities || 0).toFixed(2)].map(esc).join(','))
            for (const a of reportData.balanceSheet.equity || []) {
                lines.push(['EQUITY', a.name, a.account_type, Number(a.current_balance || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['EQUITY', 'Retained Earnings / Net Income', 'Equity', Number(reportData.balanceSheet.retainedNetIncome || 0).toFixed(2)].map(esc).join(','))
            lines.push(['TOTAL LIABILITIES & EQUITY', '', '', Number(reportData.balanceSheet.totalLiabilitiesAndEquity || 0).toFixed(2)].map(esc).join(','))
        } else if (reportType === 'trial_balance' && reportData.trialBalance) {
            lines.push('Account Name,Account Type,Debit,Credit')
            for (const r of reportData.trialBalance.rows || []) {
                lines.push([r.name, r.account_type, Number(r.debit || 0).toFixed(2), Number(r.credit || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['TOTALS', '', Number(reportData.trialBalance.totalDebit || 0).toFixed(2), Number(reportData.trialBalance.totalCredit || 0).toFixed(2)].map(esc).join(','))
        } else if ((reportType === 'vendor_expenses' || reportType === 'customer_income') && reportData.entitySummary) {
            lines.push('Name,Tax ID,1099 Eligible,Transactions Count,Last Date,Categories,Total Amount')
            for (const r of reportData.entitySummary.rows || []) {
                lines.push([r.name, r.tax_identifier || '', r.vendor_1099 ? 'YES' : 'NO', r.count, r.last_date, r.categories, Number(r.total_amount || 0).toFixed(2)].map(esc).join(','))
            }
            lines.push(['GRAND TOTAL', '', '', '', '', '', Number(reportData.entitySummary.grandTotal || 0).toFixed(2)].map(esc).join(','))
        } else if (reportType === 'qbo_archive' && reportData.archiveReport) {
            lines.push((reportData.archiveReport.columns || []).map(esc).join(','))
            for (const r of reportData.archiveReport.rows || []) {
                lines.push((r.cells || []).map(esc).join(','))
            }
        } else {
            const rows = reportData?.bankRegister?.rows || reportData?.detailReport?.rows || []
            lines.push('Date,Type,Check/Ref #,Payee,Account,Category,Memo,Inflow,Outflow,Running Balance')
            for (const r of rows) {
                lines.push([
                    r.txn_date,
                    r.txn_type,
                    r.doc_number || '',
                    r.entity_name || '',
                    r.account_name || '',
                    r.category_summary || '',
                    r.memo || '',
                    r.inflow != null ? Number(r.inflow).toFixed(2) : '',
                    r.outflow != null ? Number(r.outflow).toFixed(2) : Number(r.total_amount || 0).toFixed(2),
                    r.running_balance != null ? Number(r.running_balance).toFixed(2) : ''
                ].map(esc).join(','))
            }
        }

        const csvContent = '\uFEFF' + lines.join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${(activeCompany?.slug || 'contabilidad')}_${reportType}_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const checksList = useMemo(
        () => transactions.filter(r => r.txn_type === 'Check' || r.txn_type === 'BillPayment'),
        [transactions]
    )
    const depositsList = useMemo(
        () => transactions.filter(r => r.txn_type === 'Deposit' || r.txn_type === 'Payment'),
        [transactions]
    )

    const filteredAccounts = useMemo(() => {
        const q = accountSearch.trim().toLowerCase()
        if (!q) return accounts
        return accounts.filter(a =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.acct_num || '').toLowerCase().includes(q) ||
            (a.account_type || '').toLowerCase().includes(q) ||
            (a.classification || '').toLowerCase().includes(q)
        )
    }, [accounts, accountSearch])

    const filteredContacts = useMemo(() => {
        const q = contactSearch.trim().toLowerCase()
        if (!q) return contacts
        return contacts.filter(c =>
            (c.display_name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.phone || '').toLowerCase().includes(q) ||
            (c.contact_type || '').toLowerCase().includes(q)
        )
    }, [contacts, contactSearch])

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

            {/* Top Executive Header */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-black tracking-wider uppercase mb-2">
                            <Landmark size={13} />
                            <span>{t('external_accounting.badge_raquel')}</span>
                        </div>
                        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                            {t('external_accounting.title')}
                        </h1>
                        <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {t('external_accounting.subtitle')}
                        </p>
                    </div>

                    {/* Active Company Selector + Refresh */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex flex-col">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                {t('external_accounting.company_selector')}
                            </label>
                            <div className="flex items-center gap-2">
                                <select
                                    value={activeRealmId}
                                    onChange={(e) => {
                                        setActiveRealmId(e.target.value)
                                        setFilterAccountId('ALL')
                                    }}
                                    className="px-3.5 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/30 text-slate-900 dark:text-white font-bold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                    {companies.map(c => (
                                        <option key={c.realm_id} value={c.realm_id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                            {c.company_name} ({formatCurrency(c.overview?.totalBankBalance || 0)})
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={fetchWorkspaceData}
                                    title={t('external_accounting.refresh')}
                                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                                >
                                    <RefreshCw size={17} className={loading ? 'animate-spin text-emerald-500' : ''} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Action Bar: Create Check, Deposit, Expense, Invoice, Payment, Bill, BillPayment, Transfer, Journal */}
                <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Check')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>{t('external_accounting.btn_new_check')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Deposit')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>{t('external_accounting.btn_new_deposit')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Expense')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>{t('external_accounting.btn_new_expense')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Invoice')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-xs transition-all cursor-pointer"
                        >
                            <FileText size={13} />
                            <span>{t('external_accounting.btn_new_invoice')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Payment')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 font-bold text-xs transition-all cursor-pointer"
                        >
                            <DollarSign size={13} />
                            <span>{t('external_accounting.btn_new_payment')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Bill')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 dark:text-orange-300 font-bold text-xs transition-all cursor-pointer"
                        >
                            <FileText size={13} />
                            <span>{t('external_accounting.btn_new_bill')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('BillPayment')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold text-xs transition-all cursor-pointer"
                        >
                            <CheckCircle2 size={13} />
                            <span>{t('external_accounting.btn_new_bill_payment')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('Transfer')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer"
                        >
                            <ArrowLeftRight size={13} />
                            <span>{t('external_accounting.btn_new_transfer')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => openTransactionModal('JournalEntry')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer"
                        >
                            <BookOpen size={13} />
                            <span>{t('external_accounting.btn_new_journal')}</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={exportTransactionsCsv}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-xs transition-all cursor-pointer"
                        >
                            <Download size={14} />
                            <span>{t('external_accounting.btn_export_csv')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer"
                        >
                            <Printer size={14} />
                            <span>{t('external_accounting.btn_print_report')}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* 5 Executive KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                <div className="rounded-2xl border border-emerald-500/30 bg-white dark:bg-slate-900 p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                        <span>{t('external_accounting.kpi_bank_balance')}</span>
                        <Landmark size={16} className="text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1.5">
                        {formatCurrency(summary.totalBankBalance)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 truncate">
                        {activeCompany?.company_name}
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                        <span>{t('external_accounting.kpi_total_inflows')}</span>
                        <ArrowDownRight size={16} className="text-emerald-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1.5">
                        {formatCurrency(summary.totalInflows)}
                    </div>
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                        {summary.depositsCount || 0} {t('external_accounting.filter_deposits')}
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                        <span>{t('external_accounting.kpi_total_outflows')}</span>
                        <ArrowUpRight size={16} className="text-red-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1.5">
                        {formatCurrency(summary.totalOutflows)}
                    </div>
                    <div className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">
                        {summary.checksCount || 0} {t('external_accounting.filter_checks')} · {summary.expensesCount || 0} EFT/Card
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                        <span>{t('external_accounting.kpi_net_flow')}</span>
                        <DollarSign size={16} className="text-blue-500" />
                    </div>
                    <div className={`text-2xl font-black mt-1.5 ${
                        Number(summary.netCashFlow || 0) >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                    }`}>
                        {formatCurrency(summary.netCashFlow)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                        Inflows - Outflows
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                        <span>{t('external_accounting.kpi_total_records')}</span>
                        <FileText size={16} className="text-purple-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1.5">
                        {(summary.totalRecords || 0).toLocaleString()}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                        {accounts.length} GL · {contacts.length} Contacts · {recurring.length} Rec
                    </div>
                </div>
            </div>

            {/* 7 Navigation Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
                {([
                    { id: 'overview', label: t('external_accounting.tab_overview'), icon: <Building2 size={15} /> },
                    { id: 'transactions', label: t('external_accounting.tab_transactions'), icon: <FileText size={15} /> },
                    { id: 'checks_deposits', label: t('external_accounting.tab_checks_deposits'), icon: <DollarSign size={15} /> },
                    { id: 'recurring', label: `${t('external_accounting.tab_recurring')} (${recurring.length})`, icon: <Repeat size={15} /> },
                    { id: 'accounts', label: `${t('external_accounting.tab_accounts')} (${accounts.length})`, icon: <Landmark size={15} /> },
                    { id: 'contacts', label: `${t('external_accounting.tab_contacts')} (${contacts.length})`, icon: <Users size={15} /> },
                    { id: 'reports', label: t('external_accounting.tab_reports'), icon: <BarChart3 size={15} /> },
                ] as { id: ActiveTab; label: string; icon: React.ReactNode }[]).map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer ${
                            activeTab === tab.id
                                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
                        }`}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* TAB 1: OVERVIEW & 8 COMPANIES */}
            {activeTab === 'overview' && (
                <div className="space-y-5">
                    {/* Consolidated 8 Companies Grid */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                        <h2 className="text-sm font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3.5 flex items-center gap-2">
                            <Building2 size={16} className="text-emerald-500" />
                            <span>{t('external_accounting.all_companies_overview')}</span>
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {companies.map(c => {
                                const isSel = c.realm_id === activeRealmId
                                return (
                                    <button
                                        key={c.realm_id}
                                        type="button"
                                        onClick={() => {
                                            setActiveRealmId(c.realm_id)
                                            setFilterAccountId('ALL')
                                        }}
                                        className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${
                                            isSel
                                                ? 'border-emerald-500 bg-emerald-500/10 shadow-sm'
                                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 hover:border-emerald-500/50'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                                                {c.company_name}
                                            </div>
                                            {isSel && (
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-black uppercase">
                                                    ACTIVE
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1.5">
                                            {formatCurrency(c.overview?.totalBankBalance || 0)}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                                            <span>{c.overview?.bankAccountsCount || 0} Banks · {c.overview?.totalAccountsCount || 0} GL</span>
                                            <ChevronRight size={13} />
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Active Company Bank & Credit Card Accounts */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                        <div className="flex items-center justify-between mb-3.5">
                            <h2 className="text-sm font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                                <Landmark size={16} className="text-emerald-500" />
                                <span>{t('external_accounting.bank_accounts_section')} — {activeCompany?.company_name}</span>
                            </h2>
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
                                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                            >
                                {t('external_accounting.btn_new_account')}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                            {bankAndCardAccounts.map(acc => (
                                <div
                                    key={acc.id}
                                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 flex flex-col justify-between"
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-black uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                                {acc.account_type}
                                            </span>
                                            {acc.acct_num && (
                                                <span className="text-xs font-mono text-slate-400">#{acc.acct_num}</span>
                                            )}
                                        </div>
                                        <h3 className="text-base font-bold text-slate-900 dark:text-white mt-2">
                                            {acc.name}
                                        </h3>
                                        <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                                            {formatCurrency(acc.current_balance)}
                                        </div>
                                    </div>
                                    <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between">
                                        <span className="text-[11px] text-slate-400">
                                            Next Check: #{nextCheckNumberByBank[acc.qb_account_id] || '1001'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFilterAccountId(acc.qb_account_id)
                                                setActiveTab('transactions')
                                            }}
                                            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                        >
                                            <span>{t('external_accounting.view_bank_register')}</span>
                                            <ChevronRight size={13} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recent Checks & Recent Deposits Split */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                    <ArrowUpRight size={16} className="text-red-500" />
                                    <span>{t('external_accounting.recent_checks')}</span>
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('checks_deposits')}
                                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                >
                                    {t('external_accounting.view_all')}
                                </button>
                            </div>
                            <div className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                                {checksList.slice(0, 7).map(chk => (
                                    <div key={chk.id} className="py-2.5 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-slate-900 dark:text-white truncate">
                                                {chk.entity_name || chk.category_summary || 'Check'}
                                                {chk.doc_number ? ` (#${chk.doc_number})` : ''}
                                            </div>
                                            <div className="text-[11px] text-slate-400 truncate">
                                                {chk.txn_date} · {chk.account_name} · {chk.category_summary}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={`font-black ${chk.is_voided ? 'line-through text-slate-400' : 'text-red-600 dark:text-red-400'}`}>
                                                {formatCurrency(chk.total_amount)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setPrintableCheckTxn(chk)}
                                                title={t('external_accounting.action_print')}
                                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                            >
                                                <Printer size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {checksList.length === 0 && (
                                    <div className="py-6 text-center text-slate-400">{t('external_accounting.no_records_found')}</div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                    <ArrowDownRight size={16} className="text-emerald-500" />
                                    <span>{t('external_accounting.recent_deposits')}</span>
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('checks_deposits')}
                                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                >
                                    {t('external_accounting.view_all')}
                                </button>
                            </div>
                            <div className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                                {depositsList.slice(0, 7).map(dep => (
                                    <div key={dep.id} className="py-2.5 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-slate-900 dark:text-white truncate">
                                                {dep.entity_name || dep.category_summary || 'Deposit'}
                                            </div>
                                            <div className="text-[11px] text-slate-400 truncate">
                                                {dep.txn_date} · {dep.account_name} · {dep.memo || dep.category_summary}
                                            </div>
                                        </div>
                                        <span className="font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                                            +{formatCurrency(dep.total_amount)}
                                        </span>
                                    </div>
                                ))}
                                {depositsList.length === 0 && (
                                    <div className="py-6 text-center text-slate-400">{t('external_accounting.no_records_found')}</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: INFLOWS, OUTFLOWS & BANK REGISTER */}
            {activeTab === 'transactions' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    {/* Filter Bar */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                        <div className="relative lg:col-span-2">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('external_accounting.search_placeholder')}
                                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>

                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
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
                            onChange={(e) => setFilterDirection(e.target.value)}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                        >
                            <option value="ALL">{t('external_accounting.filter_all_directions')}</option>
                            <option value="IN">{t('external_accounting.filter_inflows_only')}</option>
                            <option value="OUT">{t('external_accounting.filter_outflows_only')}</option>
                        </select>

                        <select
                            value={filterAccountId}
                            onChange={(e) => setFilterAccountId(e.target.value)}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                        >
                            <option value="ALL">{t('external_accounting.filter_all_accounts')}</option>
                            {accounts.map(a => (
                                <option key={a.qb_account_id} value={a.qb_account_id}>
                                    {a.name} ({formatCurrency(a.current_balance)})
                                </option>
                            ))}
                        </select>

                        <select
                            value={filterPeriod}
                            onChange={(e) => handlePeriodPreset(e.target.value)}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                        >
                            <option value="ALL">{t('external_accounting.period_all_dates')}</option>
                            <option value="THIS_YEAR">{t('external_accounting.period_this_year')}</option>
                            <option value="LAST_YEAR">{t('external_accounting.period_last_year')}</option>
                            <option value="THIS_MONTH">{t('external_accounting.period_this_month')}</option>
                            <option value="CUSTOM">{t('external_accounting.period_custom')}</option>
                        </select>
                    </div>

                    {filterPeriod === 'CUSTOM' && (
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                            />
                            <span className="text-xs text-slate-400">➔</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                            />
                        </div>
                    )}

                    {/* Ledger Table */}
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[10px] tracking-wider">
                                    <th className="py-3 px-3">{t('external_accounting.col_date')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_type')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_doc_num')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_payee')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_account')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_category')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_memo')}</th>
                                    <th className="py-3 px-3 text-right">{t('external_accounting.col_outflow')}</th>
                                    <th className="py-3 px-3 text-right">{t('external_accounting.col_inflow')}</th>
                                    <th className="py-3 px-3 text-right">{t('external_accounting.col_balance')}</th>
                                    <th className="py-3 px-3 text-center">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {transactions.map(row => {
                                    const isOut = row.direction === 'OUT' || row.direction === 'TRANSFER'
                                    const isIn = row.direction === 'IN'
                                    return (
                                        <tr
                                            key={row.id}
                                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                                                row.is_voided ? 'opacity-50 line-through' : ''
                                            }`}
                                        >
                                            <td className="py-2.5 px-3 font-mono whitespace-nowrap">{row.txn_date}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                    row.txn_type === 'Check'
                                                        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                                                        : row.txn_type === 'Deposit'
                                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                }`}>
                                                    {row.txn_type}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 font-mono font-bold">{row.doc_number || '—'}</td>
                                            <td className="py-2.5 px-3 font-semibold max-w-[180px] truncate">{row.entity_name || '—'}</td>
                                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-[160px] truncate">{row.account_name || '—'}</td>
                                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-[180px] truncate">{row.category_summary || '—'}</td>
                                            <td className="py-2.5 px-3 text-slate-500 max-w-[200px] truncate">{row.memo || '—'}</td>
                                            <td className="py-2.5 px-3 text-right font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                                                {isOut ? formatCurrency(row.total_amount) : ''}
                                            </td>
                                            <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                {isIn ? formatCurrency(row.total_amount) : ''}
                                            </td>
                                            <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                                                {row.running_balance != null ? formatCurrency(row.running_balance) : '—'}
                                            </td>
                                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                                <div className="inline-flex items-center gap-1">
                                                    {row.txn_type === 'Check' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setPrintableCheckTxn(row)}
                                                            title={t('external_accounting.action_print')}
                                                            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                                                        >
                                                            <Printer size={13} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => openTransactionModal(
                                                            (row.txn_type === 'Check' || row.txn_type === 'Deposit' || row.txn_type === 'Transfer' || row.txn_type === 'JournalEntry')
                                                                ? row.txn_type
                                                                : 'Expense',
                                                            row
                                                        )}
                                                        title={t('external_accounting.action_edit')}
                                                        className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 cursor-pointer"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    {!row.is_voided && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleVoidTransaction(row)}
                                                            title={t('external_accounting.action_void')}
                                                            className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400 cursor-pointer"
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
                                        <td colSpan={11} className="py-10 text-center text-slate-400">
                                            {t('external_accounting.no_records_found')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>
                            {t('external_accounting.showing_records', { shown: transactions.length, total: totalTransactionsCount })}
                        </span>
                        {transactions.length < totalTransactionsCount && (
                            <button
                                type="button"
                                onClick={() => setLimit(prev => prev + 300)}
                                className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
                            >
                                {t('external_accounting.load_more')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: DEDICATED CHECKS & DEPOSITS WORKSPACE */}
            {activeTab === 'checks_deposits' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Checks Column */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3.5">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-2">
                                <ArrowUpRight size={16} />
                                <span>{t('external_accounting.checks_issued_title')} ({checksList.length})</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => openTransactionModal('Check')}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                            >
                                <Plus size={14} />
                                <span>{t('external_accounting.btn_new_check')}</span>
                            </button>
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
                                        <tr key={chk.id} className={chk.is_voided ? 'opacity-50 line-through' : ''}>
                                            <td className="py-2 px-3 font-mono whitespace-nowrap">{chk.txn_date}</td>
                                            <td className="py-2 px-3 font-mono font-bold">{chk.doc_number || '—'}</td>
                                            <td className="py-2 px-3 font-semibold truncate max-w-[150px]">{chk.entity_name || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-[140px]">{chk.category_summary || '—'}</td>
                                            <td className="py-2 px-3 text-right font-black text-red-600 dark:text-red-400 whitespace-nowrap">
                                                {formatCurrency(chk.total_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-center whitespace-nowrap">
                                                <div className="inline-flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPrintableCheckTxn(chk)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                                                        title={t('external_accounting.action_print')}
                                                    >
                                                        <Printer size={13} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openTransactionModal('Check', chk)}
                                                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
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
                                        <tr key={dep.id}>
                                            <td className="py-2 px-3 font-mono whitespace-nowrap">{dep.txn_date}</td>
                                            <td className="py-2 px-3 font-semibold truncate max-w-[150px]">{dep.entity_name || dep.category_summary || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-[140px]">{dep.account_name || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 truncate max-w-[150px]">{dep.memo || '—'}</td>
                                            <td className="py-2 px-3 text-right font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                +{formatCurrency(dep.total_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => openTransactionModal('Deposit', dep)}
                                                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                                >
                                                    <Edit3 size={13} />
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
                                    <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">{rec.template_name}</td>
                                        <td className="py-3 px-3">
                                            <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                                                {rec.recur_type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-3 font-semibold">{rec.txn_type}</td>
                                        <td className="py-3 px-3 text-slate-500">
                                            Every {rec.num_interval || 1} {rec.interval_type}
                                        </td>
                                        <td className="py-3 px-3 font-mono">{rec.previous_date || '—'}</td>
                                        <td className="py-3 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{rec.next_date || '—'}</td>
                                        <td className="py-3 px-3 text-slate-500">{rec.account_name || '—'}</td>
                                        <td className="py-3 px-3 text-right font-black">{formatCurrency(rec.amount)}</td>
                                        <td className="py-3 px-3 text-right">
                                            <button
                                                type="button"
                                                disabled={saving}
                                                onClick={() => handleExecuteRecurring(rec)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                                            >
                                                <CheckCircle2 size={13} />
                                                <span>{t('external_accounting.btn_use_recurring')}</span>
                                            </button>
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
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="relative w-full sm:w-80">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={accountSearch}
                                onChange={(e) => setAccountSearch(e.target.value)}
                                placeholder={t('external_accounting.search_placeholder')}
                                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                            />
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
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                        >
                            {t('external_accounting.btn_new_account')}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase tracking-wider">
                                    <th className="py-3 px-3">{t('external_accounting.col_acct_num')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_acct_name')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_classification')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_acct_type')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_sub_type')}</th>
                                    <th className="py-3 px-3 text-right">{t('external_accounting.col_current_balance')}</th>
                                    <th className="py-3 px-3 text-center">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {filteredAccounts.map(acc => (
                                    <tr key={acc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                        <td className="py-2.5 px-3 font-mono text-slate-500">{acc.acct_num || '—'}</td>
                                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{acc.name}</td>
                                        <td className="py-2.5 px-3">{acc.classification || '—'}</td>
                                        <td className="py-2.5 px-3 font-semibold">{acc.account_type}</td>
                                        <td className="py-2.5 px-3 text-slate-500">{acc.account_sub_type || '—'}</td>
                                        <td className="py-2.5 px-3 text-right font-mono font-black">
                                            {formatCurrency(acc.current_balance)}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingAccount(acc)
                                                    setAccFormName(acc.name || '')
                                                    setAccFormNum(acc.acct_num || '')
                                                    setAccFormType(acc.account_type || 'Bank')
                                                    setAccFormClass(acc.classification || 'Asset')
                                                    setAccFormBalance(String(acc.current_balance || 0))
                                                    setAccountModalOpen(true)
                                                }}
                                                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                            >
                                                <Edit3 size={13} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 6: VENDORS & CUSTOMERS */}
            {activeTab === 'contacts' && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="relative w-full sm:w-80">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={contactSearch}
                                onChange={(e) => setContactSearch(e.target.value)}
                                placeholder={t('external_accounting.search_placeholder')}
                                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setEditingContact(null)
                                setConFormName('')
                                setConFormType('Vendor')
                                setConFormEmail('')
                                setConFormPhone('')
                                setConFormTaxId('')
                                setConForm1099(false)
                                setContactModalOpen(true)
                            }}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                        >
                            {t('external_accounting.btn_new_contact')}
                        </button>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase tracking-wider">
                                    <th className="py-3 px-3">{t('external_accounting.col_contact_name')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_contact_type')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_email')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_phone')}</th>
                                    <th className="py-3 px-3">{t('external_accounting.col_tax_id')}</th>
                                    <th className="py-3 px-3 text-center">{t('external_accounting.col_1099')}</th>
                                    <th className="py-3 px-3 text-center">{t('external_accounting.col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                {filteredContacts.map(c => (
                                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{c.display_name}</td>
                                        <td className="py-2.5 px-3">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                c.contact_type === 'Customer'
                                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                    : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                            }`}>
                                                {c.contact_type === 'Customer' ? t('external_accounting.type_customer') : t('external_accounting.type_vendor')}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-3 text-slate-500">{c.email || '—'}</td>
                                        <td className="py-2.5 px-3 text-slate-500">{c.phone || '—'}</td>
                                        <td className="py-2.5 px-3 font-mono">{c.tax_identifier || '—'}</td>
                                        <td className="py-2.5 px-3 text-center">
                                            {c.vendor_1099 ? (
                                                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-black text-[10px]">1099</span>
                                            ) : '—'}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingContact(c)
                                                    setConFormName(c.display_name || '')
                                                    setConFormType(c.contact_type || 'Vendor')
                                                    setConFormEmail(c.email || '')
                                                    setConFormPhone(c.phone || '')
                                                    setConFormTaxId(c.tax_identifier || '')
                                                    setConForm1099(Boolean(c.vendor_1099))
                                                    setContactModalOpen(true)
                                                }}
                                                className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-blue-500 cursor-pointer"
                                            >
                                                <Edit3 size={13} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
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
                                        <option value="THIS_YEAR">{t('external_accounting.period_this_year')}</option>
                                        <option value="LAST_YEAR">{t('external_accounting.period_last_year')}</option>
                                        <option value="THIS_MONTH">{t('external_accounting.period_this_month')}</option>
                                    </select>
                                </div>
                            </>
                        )}

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => window.print()}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                            >
                                <Printer size={14} />
                                <span>{t('external_accounting.btn_print_report')}</span>
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
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">
                                            {t('external_accounting.income_section')}
                                        </h3>
                                        <table className="w-full text-xs border-collapse">
                                            <tbody>
                                                {reportData.pnl.incomeRows.map((r: any) => (
                                                    <tr key={r.category} className="border-b border-slate-100 dark:border-slate-800/60">
                                                        <td className="py-2 px-2 font-medium">{r.category}</td>
                                                        <td className="py-2 px-2 text-right font-mono font-bold">{formatCurrency(r.amount)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="bg-emerald-500/10 font-black">
                                                    <td className="py-2.5 px-2">{t('external_accounting.total_income')}</td>
                                                    <td className="py-2.5 px-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
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
                                            <tbody>
                                                {reportData.pnl.expenseRows.map((r: any) => (
                                                    <tr key={r.category} className="border-b border-slate-100 dark:border-slate-800/60">
                                                        <td className="py-2 px-2 font-medium">{r.category}</td>
                                                        <td className="py-2 px-2 text-right font-mono font-bold">{formatCurrency(r.amount)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="bg-red-500/10 font-black">
                                                    <td className="py-2.5 px-2">{t('external_accounting.total_expenses')}</td>
                                                    <td className="py-2.5 px-2 text-right font-mono text-red-600 dark:text-red-400">
                                                        {formatCurrency(reportData.pnl.totalExpenses)}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between font-black text-base">
                                        <span>{t('external_accounting.net_income')}</span>
                                        <span className="font-mono text-emerald-400">{formatCurrency(reportData.pnl.netIncome)}</span>
                                    </div>
                                </div>
                            )}

                            {/* 2. Balance Sheet View */}
                            {reportType === 'balance_sheet' && reportData?.balanceSheet && (
                                <div className="space-y-6 text-xs">
                                    <div>
                                        <h3 className="font-black uppercase text-emerald-600 mb-2">{t('external_accounting.assets_section')}</h3>
                                        {reportData.balanceSheet.assets.map((a: any) => (
                                            <div key={a.id} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                                                <span>{a.name} ({a.account_type})</span>
                                                <span className="font-mono font-bold">{formatCurrency(a.current_balance)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between py-2.5 font-black bg-emerald-500/10 px-2 mt-1">
                                            <span>{t('external_accounting.total_assets')}</span>
                                            <span className="font-mono">{formatCurrency(reportData.balanceSheet.totalAssets)}</span>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="font-black uppercase text-amber-600 mb-2">{t('external_accounting.liabilities_section')}</h3>
                                        {reportData.balanceSheet.liabilities.map((a: any) => (
                                            <div key={a.id} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                                                <span>{a.name} ({a.account_type})</span>
                                                <span className="font-mono font-bold">{formatCurrency(a.current_balance)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between py-2.5 font-black bg-amber-500/10 px-2 mt-1">
                                            <span>{t('external_accounting.total_liabilities')}</span>
                                            <span className="font-mono">{formatCurrency(reportData.balanceSheet.totalLiabilities)}</span>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="font-black uppercase text-blue-600 mb-2">{t('external_accounting.equity_section')}</h3>
                                        {reportData.balanceSheet.equity.map((a: any) => (
                                            <div key={a.id} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                                                <span>{a.name}</span>
                                                <span className="font-mono font-bold">{formatCurrency(a.current_balance)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 italic">
                                            <span>{t('external_accounting.retained_net_income')}</span>
                                            <span className="font-mono font-bold">{formatCurrency(reportData.balanceSheet.retainedNetIncome)}</span>
                                        </div>
                                        <div className="flex justify-between py-2.5 font-black bg-blue-500/10 px-2 mt-1">
                                            <span>{t('external_accounting.total_liabilities_equity')}</span>
                                            <span className="font-mono">{formatCurrency(reportData.balanceSheet.totalLiabilitiesAndEquity)}</span>
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
                                        {reportData.trialBalance.rows.map((r: any) => (
                                            <tr key={r.account_id}>
                                                <td className="py-2 px-3 font-semibold">{r.name}</td>
                                                <td className="py-2 px-3 text-slate-500">{r.account_type}</td>
                                                <td className="py-2 px-3 text-right font-mono">{r.debit ? formatCurrency(r.debit) : '—'}</td>
                                                <td className="py-2 px-3 text-right font-mono">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                                            </tr>
                                        ))}
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-black">
                                            <td colSpan={2} className="py-2.5 px-3">{t('external_accounting.totals_label')}</td>
                                            <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(reportData.trialBalance.totalDebit)}</td>
                                            <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(reportData.trialBalance.totalCredit)}</td>
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
                                            <tr key={r.name}>
                                                <td className="py-2 px-3 font-bold">{r.name}</td>
                                                <td className="py-2 px-3 text-slate-500">{r.categories}</td>
                                                <td className="py-2 px-3 text-center font-mono">{r.count}</td>
                                                <td className="py-2 px-3 text-center font-mono">{r.last_date}</td>
                                                <td className="py-2 px-3 text-right font-mono font-black">{formatCurrency(r.total_amount)}</td>
                                            </tr>
                                        ))}
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-black">
                                            <td colSpan={4} className="py-2.5 px-3">{t('external_accounting.totals_label')}</td>
                                            <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(reportData.entitySummary.grandTotal)}</td>
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
                                            <th className="py-2.5 px-3 text-right">{t('external_accounting.col_amount')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                                        {(reportData?.bankRegister?.rows || reportData?.detailReport?.rows || []).map((r: any) => (
                                            <tr key={r.id}>
                                                <td className="py-2 px-3 font-mono">{r.txn_date}</td>
                                                <td className="py-2 px-3">{r.txn_type}</td>
                                                <td className="py-2 px-3 font-mono">{r.doc_number || '—'}</td>
                                                <td className="py-2 px-3 font-semibold">{r.entity_name || '—'}</td>
                                                <td className="py-2 px-3 text-slate-500">{r.category_summary || '—'}</td>
                                                <td className="py-2 px-3 text-right font-mono font-bold">
                                                    {formatCurrency(r.total_amount ?? (r.inflow || r.outflow))}
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
                                            <div className="flex items-center justify-between font-black text-xs mb-2">
                                                <span>{acct.account_name}</span>
                                                <span className="font-mono">
                                                    Debit: {formatCurrency(acct.total_debit)} · Credit: {formatCurrency(acct.total_credit)}
                                                </span>
                                            </div>
                                            <table className="w-full text-[11px]">
                                                <tbody>
                                                    {acct.entries.slice(0, 30).map((e: any, idx: number) => (
                                                        <tr key={idx} className="border-t border-slate-100 dark:border-slate-800/60">
                                                            <td className="py-1 font-mono w-24">{e.date}</td>
                                                            <td className="py-1 w-24">{e.type}</td>
                                                            <td className="py-1 font-mono w-20">{e.doc}</td>
                                                            <td className="py-1 font-semibold">{e.name}</td>
                                                            <td className="py-1 text-slate-500">{e.memo}</td>
                                                            <td className="py-1 text-right font-mono w-24">{e.debit ? formatCurrency(e.debit) : ''}</td>
                                                            <td className="py-1 text-right font-mono w-24">{e.credit ? formatCurrency(e.credit) : ''}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
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
                                            {reportData.archiveReport.rows.map((r: any, idx: number) => (
                                                <tr
                                                    key={idx}
                                                    className={
                                                        r.rowType === 'summary'
                                                            ? 'bg-emerald-500/10 font-black'
                                                            : r.rowType === 'section_header'
                                                            ? 'bg-slate-50 dark:bg-slate-800/40 font-bold'
                                                            : ''
                                                    }
                                                >
                                                    {r.cells.map((cell: string, ci: number) => (
                                                        <td
                                                            key={ci}
                                                            style={ci === 0 ? { paddingLeft: `${12 + (r.depth || 0) * 14}px` } : undefined}
                                                            className={`py-1.5 px-3 ${ci === 0 ? 'text-left' : 'text-right font-mono'}`}
                                                        >
                                                            {cell}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* MODAL: CREATE / EDIT TRANSACTION (CHECK, DEPOSIT, EXPENSE, TRANSFER, JOURNAL ENTRY) */}
            {modalMode && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">
                                {modalMode === 'Check' && t('external_accounting.modal_check_title')}
                                {modalMode === 'Deposit' && t('external_accounting.modal_deposit_title')}
                                {modalMode === 'Expense' && t('external_accounting.modal_expense_title')}
                                {modalMode === 'Transfer' && t('external_accounting.modal_transfer_title')}
                                {modalMode === 'JournalEntry' && t('external_accounting.modal_journal_title')}
                                {' — '}{activeCompany?.company_name}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setModalMode(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-bold text-sm cursor-pointer"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveTransaction} className="space-y-4 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {modalMode !== 'JournalEntry' && (
                                    <div>
                                        <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            {modalMode === 'Deposit'
                                                ? t('external_accounting.field_deposit_to')
                                                : modalMode === 'Transfer'
                                                ? t('external_accounting.field_from_account')
                                                : t('external_accounting.field_bank_account')}
                                        </label>
                                        <select
                                            value={formBankQbId}
                                            onChange={(e) => {
                                                setFormBankQbId(e.target.value)
                                                if (modalMode === 'Check' && !editingTxnId) {
                                                    setFormDocNumber(nextCheckNumberByBank[e.target.value] || '1001')
                                                }
                                            }}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                        >
                                            {accounts.map(a => (
                                                <option key={a.qb_account_id} value={a.qb_account_id}>
                                                    {a.name} ({formatCurrency(a.current_balance)})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {modalMode === 'Transfer' && (
                                    <div>
                                        <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            {t('external_accounting.field_to_account')}
                                        </label>
                                        <select
                                            value={formToAccountQbId}
                                            onChange={(e) => setFormToAccountQbId(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                        >
                                            {accounts.map(a => (
                                                <option key={a.qb_account_id} value={a.qb_account_id}>
                                                    {a.name} ({formatCurrency(a.current_balance)})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        {t('external_accounting.field_date')}
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={formDate}
                                        onChange={(e) => setFormDate(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
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
                                        placeholder="1001 / EFT"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                                    />
                                </div>
                            </div>

                            {modalMode !== 'Transfer' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            {modalMode === 'Deposit'
                                                ? t('external_accounting.field_received_from')
                                                : t('external_accounting.field_payee')}
                                        </label>
                                        <input
                                            type="text"
                                            list="contacts-datalist"
                                            value={formPayeeName}
                                            onChange={(e) => setFormPayeeName(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                        />
                                        <datalist id="contacts-datalist">
                                            {contacts.map(c => (
                                                <option key={c.id} value={c.display_name} />
                                            ))}
                                        </datalist>
                                    </div>

                                    <div>
                                        <label className="block font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            {t('external_accounting.field_memo')}
                                        </label>
                                        <input
                                            type="text"
                                            value={formMemo}
                                            onChange={(e) => setFormMemo(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                        />
                                    </div>
                                </div>
                            )}

                            {modalMode === 'Transfer' ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-black text-base"
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
                                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="font-black uppercase text-[10px] tracking-wider text-slate-500">
                                            {t('external_accounting.field_category_account')}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setFormLines(prev => [
                                                ...prev,
                                                { account_qb_id: accounts[0]?.qb_account_id || '', account_name: accounts[0]?.name || '', description: '', amount: '', posting_type: 'Debit' }
                                            ])}
                                            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                        >
                                            {t('external_accounting.btn_add_line')}
                                        </button>
                                    </div>

                                    {formLines.map((line, idx) => (
                                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                            <div className={modalMode === 'JournalEntry' ? 'col-span-4' : 'col-span-5'}>
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
                                                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                                                >
                                                    {accounts.map(a => (
                                                        <option key={a.qb_account_id} value={a.qb_account_id}>
                                                            {a.name} ({a.account_type})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            {modalMode === 'JournalEntry' && (
                                                <div className="col-span-2">
                                                    <select
                                                        value={line.posting_type || 'Debit'}
                                                        onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                            ...item,
                                                            posting_type: e.target.value as 'Debit' | 'Credit'
                                                        } : item))}
                                                        className="w-full px-2 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                                    >
                                                        <option value="Debit">Debit (+)</option>
                                                        <option value="Credit">Credit (-)</option>
                                                    </select>
                                                </div>
                                            )}
                                            <div className={modalMode === 'JournalEntry' ? 'col-span-3' : 'col-span-4'}>
                                                <input
                                                    type="text"
                                                    placeholder={t('external_accounting.field_line_desc')}
                                                    value={line.description}
                                                    onChange={(e) => setFormLines(prev => prev.map((item, i) => i === idx ? {
                                                        ...item,
                                                        description: e.target.value
                                                    } : item))}
                                                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                                                />
                                            </div>
                                            <div className="col-span-2">
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
                                                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-right font-mono font-bold"
                                                />
                                            </div>
                                            <div className="col-span-1 text-center">
                                                {formLines.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormLines(prev => prev.filter((_, i) => i !== idx))}
                                                        className="text-red-500 hover:text-red-700 font-bold cursor-pointer"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
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
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: PRINTABLE OFFICIAL CHECK PREVIEW */}
            {printableCheckTxn && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl rounded-2xl bg-white text-slate-900 p-6 shadow-2xl space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-3 print:hidden">
                            <h3 className="text-base font-black">{t('external_accounting.check_preview_title')}</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => window.print()}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                                >
                                    <Printer size={14} />
                                    <span>{t('external_accounting.print_now_btn')}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPrintableCheckTxn(null)}
                                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold cursor-pointer"
                                >
                                    {t('external_accounting.close_btn')}
                                </button>
                            </div>
                        </div>

                        {/* Official Check Face */}
                        <div className="rounded-xl border-2 border-slate-800 p-6 bg-gradient-to-br from-emerald-50/40 via-white to-slate-50 space-y-5 font-serif">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="text-base font-bold uppercase tracking-wide">
                                        {activeCompany?.legal_name || activeCompany?.company_name}
                                    </div>
                                    <div className="text-xs text-slate-500 font-sans">
                                        {printableCheckTxn.account_name}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs font-sans font-bold text-slate-500">
                                        CHECK NO. <span className="text-base font-mono text-slate-900">#{printableCheckTxn.doc_number || 'EFT'}</span>
                                    </div>
                                    <div className="text-xs font-sans mt-1">
                                        DATE: <span className="font-mono font-bold">{printableCheckTxn.txn_date}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 border-b border-slate-400 pb-2">
                                <div className="text-xs font-sans font-bold text-slate-500 shrink-0">
                                    {t('external_accounting.pay_to_order_of')}:
                                </div>
                                <div className="flex-1 text-base font-bold">
                                    {printableCheckTxn.entity_name || printableCheckTxn.category_summary}
                                </div>
                                <div className="px-3 py-1.5 border-2 border-slate-800 bg-white font-mono font-black text-base">
                                    {formatCurrency(printableCheckTxn.total_amount)}
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-b border-slate-400 pb-2 text-xs font-mono uppercase">
                                <span>*** {numberToEnglishWords(Number(printableCheckTxn.total_amount || 0))} ***</span>
                                <span className="font-sans font-bold">{t('external_accounting.dollars_label')}</span>
                            </div>

                            <div className="flex items-end justify-between pt-4 text-xs font-sans">
                                <div>
                                    <span className="font-bold text-slate-500">MEMO: </span>
                                    <span>{printableCheckTxn.memo || printableCheckTxn.category_summary || ''}</span>
                                </div>
                                <div className="w-56 border-t border-slate-600 text-center pt-1 text-[10px] uppercase tracking-wider text-slate-500">
                                    AUTHORIZED SIGNATURE
                                </div>
                            </div>
                        </div>

                        {/* Check Voucher Stub */}
                        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-xs space-y-2">
                            <div className="font-black uppercase text-[10px] tracking-wider text-slate-400">
                                {t('external_accounting.check_voucher_stub')}
                            </div>
                            <div className="flex justify-between font-bold">
                                <span>{printableCheckTxn.entity_name} — #{printableCheckTxn.doc_number || 'EFT'} ({printableCheckTxn.txn_date})</span>
                                <span className="font-mono">{formatCurrency(printableCheckTxn.total_amount)}</span>
                            </div>
                            <div className="text-slate-600">
                                {printableCheckTxn.category_summary} · {printableCheckTxn.memo}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: CREATE / EDIT ACCOUNT */}
            {accountModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
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
                                        onChange={(e) => setAccFormType(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                    >
                                        <option value="Bank">Bank</option>
                                        <option value="Credit Card">Credit Card</option>
                                        <option value="Income">Income</option>
                                        <option value="Expense">Expense</option>
                                        <option value="Cost of Goods Sold">Cost of Goods Sold</option>
                                        <option value="Fixed Asset">Fixed Asset</option>
                                        <option value="Other Current Asset">Other Current Asset</option>
                                        <option value="Accounts Payable">Accounts Payable</option>
                                        <option value="Accounts Receivable">Accounts Receivable</option>
                                        <option value="Long Term Liability">Long Term Liability</option>
                                        <option value="Equity">Equity</option>
                                    </select>
                                </div>
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
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
                        <h3 className="text-base font-black">{t('external_accounting.btn_new_contact')}</h3>
                        <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold mb-1">{t('external_accounting.col_contact_name')}</label>
                                <input
                                    type="text"
                                    required
                                    value={conFormName}
                                    onChange={(e) => setConFormName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
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
                                <div>
                                    <label className="block font-bold mb-1">{t('external_accounting.col_tax_id')}</label>
                                    <input
                                        type="text"
                                        value={conFormTaxId}
                                        onChange={(e) => setConFormTaxId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
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
