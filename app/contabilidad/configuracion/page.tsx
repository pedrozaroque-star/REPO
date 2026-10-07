/**
 * @module contabilidad/configuracion
 * @description Centro de Configuración de Flujo de Trabajo Cohesion 1:1.
 * Réplica idéntica de la configuración de Cohesion For Restaurants para Tacos Gavilan:
 * 9 pestañas canónicas (QuickBooks, Sales, Discounts, Taxes, Tips, Payments, Cash Reconciliation,
 * Receivables, Validation) por cada sucursal con mapeos GL, cuentas bancarias, ubicaciones,
 * clases, reglas de marketplace facilitators y candado de órdenes abiertas del Paso 11.
 * 
 * @businessRules
 * - Cada sucursal tiene su cuenta bancaria específica (10000+), clase QB y ubicación QB.
 * - Las 9 pestañas replican fielmente la interfaz y comportamiento de Cohesion:
 *   1. QuickBooks (TargetQbOnline): Ubicación, Clase, Cliente *-COH de Fondos No Depositados.
 *   2. Sales (SalesReconGrossReceiptsSales): Opciones de comedor (Dining Options), cargos por servicio, reembolsos, ventas diferidas.
 *   3. Discounts (SalesReconGrossReceiptsDiscounts): Descuentos por razón y reglas de promos externas (delivery).
 *   4. Taxes (SalesReconGrossReceiptsTaxes): Impuesto municipal y ajuste de facilitadores (CDTFA).
 *   5. Tips (SalesReconGrossReceiptsTips): Tips/Grat Payable y Out a través de 12100 Cash on Hand.
 *   6. Payments (SalesReconPayments): Depósitos CC #1/#2, comisiones (51030), delivery apps (12050, 12053, 12054, 12051).
 *   7. Cash Reconciliation (SalesReconCashReconciliation): Cash In, Deposit to Bank (13200), Over/Short (51050), COGS Supplies (50006).
 *   8. Receivables (SalesReconReceivables): Cuentas por cobrar y cuentas clearing (12049).
 *   9. Validation (SalesReconValidationRules): Alerta de comisiones y verificación de órdenes abiertas (Paso 11).
 * - Soporta navegación bilingüe completa (Español / Inglés) vía useLanguage().
 * - Persiste en tiempo real a Supabase (accounting_site_mappings).
 * 
 * @dataFlow
 * accounting_site_mappings + accounting_gl_accounts ↔ API (/api/accounting/site-mappings) ↔ This Page
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertCircle, 
  Building2, BookOpen, Save, RotateCcw, 
  DollarSign, Receipt, CreditCard, ShieldCheck, 
  Percent, HeartHandshake, Banknote, ShieldAlert,
  HelpCircle, ChevronRight, Check, Sparkles, ExternalLink
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'
import { getQBStoreRefs, QBStoreRefs } from '@/lib/qb-classes-locations'

interface SiteMapping {
  id: string
  store_id: number
  qb_location: string
  qb_class: string
  bank_account_number: string
  bank_account_qb_id?: string
  sales_dine_in_account?: string
  sales_uber_account?: string
  sales_doordash_account?: string
  sales_grubhub_account?: string
  sales_tax_account?: string
  ar_uber_account?: string
  ar_doordash_account?: string
  ar_grubhub_account?: string
  ar_postmates_account?: string
  cc_fees_account?: string
  undeposited_funds_account?: string
  cash_over_short_account?: string
  gift_card_account?: string
  open_orders_account?: string
  cash_on_hand_account?: string
  tips_account?: string
  cogs_account?: string
  is_active: boolean
  stores: { id: number; name: string }
}

interface GLAccount {
  id: string
  account_number: string
  account_name: string
  account_type: string
  qb_account_id: string | null
  is_active: boolean
}

type CohesionTabKey = 
  | 'qb' 
  | 'sales' 
  | 'discounts' 
  | 'taxes' 
  | 'tips' 
  | 'payments' 
  | 'cash' 
  | 'receivables' 
  | 'validation'

const OFFICIAL_BANK_ACCOUNTS = [
  { number: '10000', qbId: '213', label: '10000 - Azusa' },
  { number: '10001', qbId: '189', label: '10001 - Bell' },
  { number: '10002', qbId: '45', label: '10002 - Central' },
  { number: '10003', qbId: '212', label: '10003 - Hollywood' },
  { number: '10004', qbId: '258', label: '10004 - Lynwood' },
  { number: '10005', qbId: '48', label: '10005 - Paramount (Downey)' },
  { number: '10007', qbId: '272', label: '10007 - Santa ana' },
  { number: '10008', qbId: '37', label: '10008 - Santa fe (Huntington Park)' },
  { number: '10009', qbId: '211', label: '10009 - South Gate' },
  { number: '10010', qbId: '46', label: '10010 - Vernon (Broadway LA)' },
  { number: '10012', qbId: '282', label: '10012 - West covina' },
  { number: '10013', qbId: '334', label: '10013 - La Puente' },
  { number: '10014', qbId: '378', label: '10014 - Norwalk' },
  { number: '10015', qbId: '379', label: '10015 - Slauson' },
  { number: '10017', qbId: '412', label: '10017 - Rialto-8205' },
]

const OFFICIAL_QB_LOCATIONS = [
  'Azusa', 'Azusa TEG', 'Bell', 'Bristol', 'Broadway LA', 'Central LA', 
  'Downey', 'Hollywood', 'Huntington Park', 'La Puente', 'Lynwood', 
  'Norwalk', 'Ontario', 'Pepes', 'Rialto', 'Santa Ana', 'Santa Fe Springs', 
  'Slauson', 'South Gate', 'Warehouse', 'West Covina', 'zG&A'
]

const OFFICIAL_QB_CLASSES = [
  'Azusa', 'Azusa TEG', 'Bell', 'Bristol', 'Broadway LA', 'Central LA', 
  'Downey', 'Hollywood', 'Huntington Park', 'La Puente', 'Lynwood', 
  'Norwalk', 'ONTARIO', 'pepes', 'Rialto', 'Santa Ana', 'Santa Fe Springs', 
  'Slauson', 'Souht Gate', 'South Gate', 'West Covina'
]

export default function AccountingConfigPage() {
  const { t, language } = useLanguage()

  // Top view mode: 'workflow' (9 tabs 1:1), 'stores' (summary table), 'accounts' (GL accounts table)
  const [viewMode, setViewMode] = useState<'workflow' | 'stores' | 'accounts'>('workflow')
  
  // Data State
  const [mappings, setMappings] = useState<SiteMapping[]>([])
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Active Store Selection in Workflow Mode
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null)

  // Active Tab in the 9-Tab Workflow
  const [cohesionTab, setCohesionTab] = useState<CohesionTabKey>('qb')

  // Form State for Active Store
  const [formData, setFormData] = useState<Partial<SiteMapping>>({})

  // Additional Workflow States (Discounts, Receivables, Validation)
  const [discountAccount, setDiscountAccount] = useState<string>('40010')
  const [incCustomerReceivables, setIncCustomerReceivables] = useState<boolean>(false)
  const [addCustomerNameMemo, setAddCustomerNameMemo] = useState<boolean>(false)
  const [addRevenueCenterMemo, setAddRevenueCenterMemo] = useState<boolean>(false)
  const [ccFeeValidation, setCcFeeValidation] = useState<'Warn' | 'None' | 'Block'>('Warn')
  const [checkOpenOrders, setCheckOpenOrders] = useState<boolean>(true)

  // Fetch initial data
  const loadData = async () => {
    setIsLoading(true)
    try {
      const [mappingsRes, accountsRes] = await Promise.all([
        fetch('/api/accounting/site-mappings'),
        fetch('/api/accounting/gl-accounts'),
      ])

      if (mappingsRes.ok) {
        const data = await mappingsRes.json()
        const fetchedMappings: SiteMapping[] = data.mappings || []
        setMappings(fetchedMappings)
        
        // Select first store by default if none selected
        if (!selectedStoreId && fetchedMappings.length > 0) {
          const firstStore = fetchedMappings[0]
          setSelectedStoreId(firstStore.store_id)
          populateFormData(firstStore)
        } else if (selectedStoreId) {
          const found = fetchedMappings.find(m => m.store_id === selectedStoreId)
          if (found) populateFormData(found)
        }
      }

      if (accountsRes.ok) {
        const data = await accountsRes.json()
        setGlAccounts(data.accounts || [])
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load configuration data' })
    } finally {
      setIsLoading(false)
    }
  }

  const populateFormData = (mapping: SiteMapping) => {
    setFormData({
      ...mapping,
      sales_dine_in_account: mapping.sales_dine_in_account || '40050',
      sales_uber_account: mapping.sales_uber_account || '40060',
      sales_doordash_account: mapping.sales_doordash_account || '40062',
      sales_grubhub_account: mapping.sales_grubhub_account || '40063',
      sales_tax_account: mapping.sales_tax_account || '24001',
      ar_uber_account: mapping.ar_uber_account || '12050',
      ar_doordash_account: mapping.ar_doordash_account || '12053',
      ar_grubhub_account: mapping.ar_grubhub_account || '12054',
      ar_postmates_account: mapping.ar_postmates_account || '12051',
      cc_fees_account: mapping.cc_fees_account || '51030',
      undeposited_funds_account: mapping.undeposited_funds_account || '13200',
      cash_over_short_account: mapping.cash_over_short_account || '51050',
      gift_card_account: mapping.gift_card_account || '20500',
      open_orders_account: mapping.open_orders_account || '12049',
      cash_on_hand_account: mapping.cash_on_hand_account || '12100',
      tips_account: mapping.tips_account || '12100',
      cogs_account: mapping.cogs_account || '50006',
    })
  }

  useEffect(() => {
    loadData()
  }, [])

  // Currently active mapping object
  const activeMapping = useMemo(() => {
    return mappings.find(m => m.store_id === selectedStoreId) || null
  }, [mappings, selectedStoreId])

  // Store metadata refs (QuickBooks class, location, customer)
  const storeRefs = useMemo<QBStoreRefs>(() => {
    return getQBStoreRefs(activeMapping?.stores?.name || '')
  }, [activeMapping])

  // Handle switching store
  const handleSelectStore = (storeId: number) => {
    setSelectedStoreId(storeId)
    const mapping = mappings.find(m => m.store_id === storeId)
    if (mapping) {
      populateFormData(mapping)
    }
  }

  // Handle restoring canonical Cohesion values
  const handleRestoreCohesion = () => {
    if (!activeMapping) return
    const confirmed = window.confirm(
      t('accounting.btn_confirm_restore') || 
      '¿Restaurar la configuración oficial extraída de Cohesion para esta sucursal?'
    )
    if (!confirmed) return

    const refs = getQBStoreRefs(activeMapping.stores?.name || '')
    const isCentralOrBroadway = 
      activeMapping.stores?.name?.toLowerCase().includes('central') || 
      activeMapping.stores?.name?.toLowerCase().includes('broadway')

    setFormData(prev => ({
      ...prev,
      qb_location: refs.locationName,
      qb_class: refs.className,
      bank_account_number: refs.bankAccount,
      bank_account_qb_id: refs.bankAccountQbId,
      sales_dine_in_account: '40050',
      sales_uber_account: '40060',
      sales_doordash_account: '40062',
      sales_grubhub_account: '40063',
      sales_tax_account: '24001',
      ar_uber_account: '12050',
      ar_doordash_account: '12053',
      ar_grubhub_account: '12054',
      ar_postmates_account: '12051',
      cc_fees_account: isCentralOrBroadway ? '12100' : '51030',
      undeposited_funds_account: '13200',
      cash_over_short_account: '51050',
      gift_card_account: '20500',
      open_orders_account: '12049',
      cash_on_hand_account: '12100',
      tips_account: '12100',
      cogs_account: '50006',
      is_active: true,
    }))

    setMessage({
      type: 'success',
      text: `${t('accounting.btn_restore_canonical')}: ${formatStoreName(activeMapping.stores?.name || '')}`,
    })
  }

  // Handle saving form data to backend
  const handleSave = async () => {
    if (!selectedStoreId) return
    setIsSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/accounting/site-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          store_id: selectedStoreId,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update mapping')

      setMessage({
        type: 'success',
        text: `${t('accounting.alert_mapping_saved')} (${formatStoreName(activeMapping?.stores?.name || '')})`,
      })

      // Update local mappings state
      setMappings(prev =>
        prev.map(m => (m.store_id === selectedStoreId ? { ...m, ...data.mapping } : m))
      )
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error saving mapping' })
    } finally {
      setIsSaving(false)
    }
  }

  // Handle QBO account sync
  const handleSyncFromQB = async () => {
    setIsSyncing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/accounting/gl-accounts', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setMessage({
        type: 'success',
        text: (t('accounting.alert_sync_qb_success') || 'Sincronización exitosa: {count} cuentas actualizadas desde QuickBooks Online.').replace('{count}', String(data.accountsUpserted || 0)),
      })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error syncing with QuickBooks' })
    } finally {
      setIsSyncing(false)
    }
  }

  // Searchable Account Selector component
  const AccountSelect = ({
    value,
    onChange,
    defaultCode = '40050',
    className = '',
  }: {
    value?: string
    onChange: (val: string) => void
    defaultCode?: string
    className?: string
  }) => {
    const currentVal = value || defaultCode
    return (
      <select
        value={currentVal}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm ${className}`}
      >
        <option value={currentVal}>{currentVal} - {getAccountLabel(currentVal)}</option>
        <optgroup label="Cuentas Principales Cohesion">
          <option value="40050">40050 - Sales</option>
          <option value="40060">40060 - Sales - Uber Eats</option>
          <option value="40062">40062 - Sales - DoorDash</option>
          <option value="40063">40063 - Sales - GrubHub</option>
          <option value="40010">40010 - Discounts</option>
          <option value="24001">24001 - Sales Tax Payable</option>
          <option value="12050">12050 - Receivables Due from Uber Eats</option>
          <option value="12053">12053 - Receivables Due from DoorDash</option>
          <option value="12054">12054 - Receivables Due from GrubHub</option>
          <option value="12051">12051 - Receivables Due from Postmates</option>
          <option value="12049">12049 - Open Orders Receivables</option>
          <option value="12100">12100 - Cash on Hand</option>
          <option value="13200">13200 - Undeposited Funds</option>
          <option value="20500">20500 - Gift Cards Payable</option>
          <option value="51030">51030 - Bank Merchant Fees</option>
          <option value="51050">51050 - Cash Over/(Short)</option>
          <option value="50006">50006 - Materials and Supplies</option>
        </optgroup>
        {glAccounts.length > 0 && (
          <optgroup label="Todas las Cuentas de QuickBooks Online">
            {glAccounts.map((a) => (
              <option key={a.id} value={a.account_number}>
                {a.account_number} - {a.account_name} {a.qb_account_id ? `(QB #${a.qb_account_id})` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    )
  }

  // Account label helper
  const getAccountLabel = (code: string) => {
    const acct = glAccounts.find(a => a.account_number === code)
    if (acct) return acct.account_name
    switch (code) {
      case '40050': return 'Sales'
      case '40060': return 'Sales-Uber Eats'
      case '40062': return 'Sales - Doordash'
      case '40063': return 'Sales - Grubhub'
      case '40010': return 'Discounts'
      case '24001': return 'Sales tax payable'
      case '12050': return 'Receivables Due from Uber Eats'
      case '12053': return 'Receivables Due from Doordash'
      case '12054': return 'Receivables Due from Grubhub'
      case '12051': return 'Receivables Due from Postmates'
      case '12049': return 'Open Orders Receivables'
      case '12100': return 'Cash on Hand'
      case '13200': return 'Undeposited Funds'
      case '20500': return 'Gift Cards Payable'
      case '51030': return 'Bank Merchant Fees'
      case '51050': return 'Cash Over/(Short)'
      case '50006': return 'Materials and Supplies'
      default: return 'GL Account'
    }
  }

  // Class Override Selector
  const ClassSelect = ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => {
    return (
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
      >
        <option value="">&lt;Not Selected&gt;</option>
        {OFFICIAL_QB_CLASSES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    )
  }

  return (
    <div className="w-full mx-auto px-4 md:px-6 py-6 space-y-6">
      
      {/* ─── TOP EXECUTIVE HEADER ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/contabilidad"
            className="p-2.5 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-all shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {t('accounting.header_workflow_title') || 'Cohesion — Configuración del Flujo de Trabajo'}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                Cohesion 1:1 Parity
              </span>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {t('accounting.header_workflow_subtitle') || 'Configuración 1:1 de parámetros contables, clases, ubicaciones y cuentas GL por sucursal'}
            </p>
          </div>
        </div>

        {/* Global Action / View Switcher */}
        <div className="flex items-center gap-2.5 flex-wrap self-stretch lg:self-auto justify-end">
          <button
            onClick={() => setViewMode('workflow')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === 'workflow'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            {t('accounting.mode_workflow_tabs') || 'Flujo de Trabajo (9 Pestañas)'}
          </button>
          <button
            onClick={() => setViewMode('stores')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === 'stores'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            {t('accounting.mode_all_stores') || 'Resumen de Sucursales'}
          </button>
          <button
            onClick={() => setViewMode('accounts')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === 'accounts'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            {t('accounting.mode_gl_catalog') || 'Catálogo de Cuentas QB'}
          </button>
        </div>
      </div>

      {/* ─── ALERT / FEEDBACK BANNER ─── */}
      {message && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 border shadow-sm animate-in fade-in duration-200 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800/60'
              : 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/60'
          }`}
        >
          <div className="flex items-center gap-3">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <span className="text-sm font-semibold">{message.text}</span>
          </div>
          {message.type === 'error' && (
            <a
              href="/api/integrations/quickbooks/auth"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-sm flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reconectar QuickBooks
            </a>
          )}
        </div>
      )}

      {/* ─── LOADING STATE ─── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
          <p className="text-sm font-bold text-slate-500">{t('accounting.loading_cohesion_settings') || 'Cargando configuración de Cohesion...'}</p>
        </div>
      ) : viewMode === 'stores' ? (
        /* ─── VIEW MODE: ALL STORES TABLE ─── */
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('accounting.mode_all_stores') || 'Mapeo General por Sucursal'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Resumen de cuentas bancarias, ubicaciones y clases para las 15 sucursales.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_store') || 'Sucursal'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_location') || 'Ubicación QB'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_class') || 'Clase QB'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.label_bank_account') || 'Cuenta Bancaria'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_entity_name') || 'Cliente (*-COH)'}</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_status') || 'Estado'}</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_action') || 'Acción'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {mappings.map(m => {
                  const refs = getQBStoreRefs(m.stores?.name || '')
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100">
                        {formatStoreName(m.stores?.name || '')}
                      </td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300 font-semibold">{m.qb_location}</td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300 font-semibold">{m.qb_class}</td>
                      <td className="px-6 py-4">
                        <code className="text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50 px-2.5 py-1 rounded-lg text-xs font-mono font-bold">
                          {refs.bankAccountName || m.bank_account_number}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          {refs.cohCustomerName}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Activo ✓
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => {
                            handleSelectStore(m.store_id)
                            setViewMode('workflow')
                          }}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm gap-1.5"
                        >
                          Configurar Flujo
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === 'accounts' ? (
        /* ─── VIEW MODE: CHART OF ACCOUNTS TABLE ─── */
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50 dark:bg-slate-900/50">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {t('accounting.tab_gl_accounts') || 'Catálogo de Cuentas QuickBooks'} ({glAccounts.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cuentas contables sincronizadas directamente con QuickBooks Online.
              </p>
            </div>
            <button
              onClick={handleSyncFromQB}
              disabled={isSyncing}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {t('accounting.btn_sync_gl') || 'Sincronizar desde QuickBooks'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.th_qb_number') || 'Número'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.th_qb_account_name') || 'Nombre de Cuenta'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.th_qb_account_type') || 'Tipo Contable'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.th_qb_id') || 'ID QuickBooks'}</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_status') || 'Estado'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {glAccounts.map(acct => (
                  <tr key={acct.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-bold text-blue-700 dark:text-blue-400">{acct.account_number}</td>
                    <td className="px-6 py-4 font-sans font-semibold text-slate-800 dark:text-slate-200">{acct.account_name}</td>
                    <td className="px-6 py-4 font-sans">
                      <span className="capitalize text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {acct.account_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400 text-xs">
                      {acct.qb_account_id ? <span className="font-bold text-emerald-600 dark:text-emerald-400">QB #{acct.qb_account_id}</span> : '—'}
                    </td>
                    <td className="px-6 py-4 text-center font-sans">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Activo
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ─── VIEW MODE: 1:1 COHESION 9-TAB WORKFLOW ─── */
        <div className="space-y-6">

          {/* STORE SELECTOR & COHESION CONTEXT CARD */}
          <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              
              {/* Store Switcher */}
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-600 text-white rounded-xl shadow-md shadow-blue-600/20">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {t('accounting.store_selector_label') || 'Sucursal Seleccionada:'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <select
                      value={selectedStoreId || ''}
                      onChange={(e) => handleSelectStore(Number(e.target.value))}
                      className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2 text-base font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
                    >
                      {mappings.map((m) => (
                        <option key={m.store_id} value={m.store_id}>
                          {formatStoreName(m.stores?.name || '')} ({m.bank_account_number})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Restore & Save */}
              <div className="flex items-center gap-3 self-stretch md:self-auto justify-end flex-wrap">
                <button
                  onClick={handleRestoreCohesion}
                  disabled={isSaving}
                  className="px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-xl transition-all flex items-center gap-2 shadow-sm"
                  title="Restaura la configuración oficial de Cohesion"
                >
                  <RotateCcw className="w-4 h-4 text-slate-500" />
                  {t('accounting.btn_restore_canonical') || 'Restaurar Valores Cohesion'}
                </button>

                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-5 py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-md shadow-blue-600/20 flex items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {isSaving
                    ? t('accounting.btn_saving_mapping') || 'Guardando...'
                    : t('accounting.btn_save_mapping') || 'Guardar Configuración'}
                </button>
              </div>
            </div>

            {/* Cohesion Context Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Company</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">Tacos Gavilan (1866)</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Task</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">Sales Reconciliation</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">QB Location</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 truncate block">{formData.qb_location || storeRefs.locationName}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">QB Class</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 truncate block">{formData.qb_class || storeRefs.className}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Bank Account</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate block font-mono">{formData.bank_account_number || storeRefs.bankAccount}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 font-bold block uppercase">Customer *-COH</span>
                <span className="font-bold text-amber-600 dark:text-amber-400 truncate block font-mono">{storeRefs.cohCustomerName}</span>
              </div>
            </div>
          </div>

          {/* ─── 9 CANONICAL COHESION TABS BAR ─── */}
          <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-sm overflow-x-auto">
            <div className="flex gap-1.5 min-w-max">
              
              {/* Tab 1: QuickBooks */}
              <button
                onClick={() => setCohesionTab('qb')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'qb'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Building2 className="w-4 h-4" />
                1. {t('accounting.tab_cohesion_qb') || 'QuickBooks'}
              </button>

              {/* Tab 2: Sales */}
              <button
                onClick={() => setCohesionTab('sales')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'sales'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Receipt className="w-4 h-4" />
                2. {t('accounting.tab_cohesion_sales') || 'Ventas'}
              </button>

              {/* Tab 3: Discounts */}
              <button
                onClick={() => setCohesionTab('discounts')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'discounts'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Percent className="w-4 h-4" />
                3. {t('accounting.tab_cohesion_discounts') || 'Descuentos'}
              </button>

              {/* Tab 4: Taxes */}
              <button
                onClick={() => setCohesionTab('taxes')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'taxes'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                4. {t('accounting.tab_cohesion_taxes') || 'Impuestos'}
              </button>

              {/* Tab 5: Tips */}
              <button
                onClick={() => setCohesionTab('tips')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'tips'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <HeartHandshake className="w-4 h-4" />
                5. {t('accounting.tab_cohesion_tips') || 'Propinas'}
              </button>

              {/* Tab 6: Payments */}
              <button
                onClick={() => setCohesionTab('payments')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'payments'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                6. {t('accounting.tab_cohesion_payments') || 'Pagos'}
              </button>

              {/* Tab 7: Cash Reconciliation */}
              <button
                onClick={() => setCohesionTab('cash')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'cash'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Banknote className="w-4 h-4" />
                7. {t('accounting.tab_cohesion_cash') || 'Efectivo'}
              </button>

              {/* Tab 8: Receivables */}
              <button
                onClick={() => setCohesionTab('receivables')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'receivables'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <DollarSign className="w-4 h-4" />
                8. {t('accounting.tab_cohesion_receivables') || 'Cuentas x Cobrar'}
              </button>

              {/* Tab 9: Validation */}
              <button
                onClick={() => setCohesionTab('validation')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  cohesionTab === 'validation'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                9. {t('accounting.tab_cohesion_validation') || 'Validación (Paso 11)'}
              </button>

            </div>
          </div>

          {/* ─── TAB 1: QUICKBOOKS (TargetQbOnline) ─── */}
          {cohesionTab === 'qb' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  {t('accounting.label_qb_list_assignments') || 'QuickBooks List Assignments'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
                  {t('accounting.desc_qb_list_assignments') || 
                    'Select optional QuickBooks List Items that are relevant for this site. These assignments will be included in the Transactions booked to QuickBooks Online.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                
                {/* Location Assignment */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('accounting.label_location_assignment') || 'Location Assignment (Optional):'}
                  </label>
                  <select
                    value={formData.qb_location || ''}
                    onChange={(e) => setFormData({ ...formData, qb_location: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">&lt;Not Selected&gt;</option>
                    {OFFICIAL_QB_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-400 block">{t('accounting.desc_department_ref') || 'DepartmentRef enviado en JournalEntry a QBO.'}</span>
                </div>

                {/* Class Assignment */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('accounting.label_class_assignment') || 'Class Assignment (Optional):'}
                  </label>
                  <select
                    value={formData.qb_class || ''}
                    onChange={(e) => setFormData({ ...formData, qb_class: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">&lt;Not Selected&gt;</option>
                    {OFFICIAL_QB_CLASSES.map((cls) => (
                      <option key={cls} value={cls}>{cls}</option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-400 block">{t('accounting.desc_class_ref') || 'ClassRef asignado a cada línea contable.'}</span>
                </div>

                {/* Customer Assignment (*-COH) */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('accounting.label_customer_assignment') || 'Undeposited Funds Customer Assignment (Optional):'}
                  </label>
                  <input
                    type="text"
                    value={storeRefs.cohCustomerName}
                    readOnly
                    className="w-full bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-amber-600 dark:text-amber-400 cursor-not-allowed"
                  />
                  <span className="text-[11px] text-slate-400 block">{t('accounting.desc_customer_ref') || 'EntityRef tipo Customer requerido por QuickBooks para 13200 Undeposited Funds.'}</span>
                </div>

                {/* Bank Account */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('accounting.label_bank_account') || 'Cuenta Bancaria de Depósito:'}
                  </label>
                  <select
                    value={formData.bank_account_number || ''}
                    onChange={(e) => {
                      const sel = OFFICIAL_BANK_ACCOUNTS.find(b => b.number === e.target.value)
                      setFormData({
                        ...formData,
                        bank_account_number: e.target.value,
                        bank_account_qb_id: sel?.qbId || formData.bank_account_qb_id,
                      })
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {OFFICIAL_BANK_ACCOUNTS.map((b) => (
                      <option key={b.number} value={b.number}>
                        {b.label} (QB #{b.qbId})
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-400 block">{t('accounting.desc_bank_ref') || 'Cuenta de banco donde se aplican depósitos de tarjetas y EBT.'}</span>
                </div>

              </div>

              {/* Refresh Lists Action */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-bold text-slate-900 dark:text-white block">{t('accounting.sync_catalog_title') || 'Sincronización de Catálogos'}</span>
                  ¿Agregaste una nueva clase o ubicación en QuickBooks Online?
                </div>
                <button
                  onClick={handleSyncFromQB}
                  disabled={isSyncing}
                  className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
                >
                  {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {t('accounting.btn_refresh_qb_lists') || 'Refresh Lists from QuickBooks'}
                </button>
              </div>
            </div>
          )}

          {/* ─── TAB 2: SALES (SalesReconGrossReceiptsSales) ─── */}
          {cohesionTab === 'sales' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Gross Receipts - Sales
                </h2>
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('accounting.label_report_sales_by') || 'Report Sales Categorized By:'}
                  </label>
                  <select
                    disabled
                    className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400"
                  >
                    <option value="DiningOption">Dining Option (Cohesion Standard)</option>
                  </select>
                </div>
              </div>

              {/* Table 1: Dining Option Sales Accounts */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-blue-500" />
                  {t('accounting.section_dining_options') || 'Dining Option Sales Accounts'}
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">{t('accounting.th_toast_dining_option') || 'Toast Dining Option'}</th>
                        <th className="px-4 py-2.5">{t('accounting.th_target_account') || 'Cuenta Contable (GL)'}</th>
                        <th className="px-4 py-2.5">{t('accounting.th_class_override') || 'Clase Override'}</th>
                        <th className="px-4 py-2.5">{t('accounting.th_alt_memo') || 'Memo Alternativo'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {[
                        { name: 'For Here', key: 'sales_dine_in_account', def: '40050', memo: 'For Here' },
                        { name: 'To Go', key: 'sales_dine_in_account', def: '40050', memo: 'To Go' },
                        { name: 'Drive Thru Temp / Drive Thru', key: 'sales_dine_in_account', def: '40050', memo: 'Drive Thru' },
                        { name: 'Toast Online', key: 'sales_dine_in_account', def: '40050', memo: 'Toast Online' },
                        { name: 'Uber Eats - Delivery', key: 'sales_uber_account', def: '40060', memo: 'Uber Eats - Delivery' },
                        { name: 'Uber Eats Takeout', key: 'sales_uber_account', def: '40060', memo: 'Uber Eats Takeout' },
                        { name: 'DoorDash - Delivery', key: 'sales_doordash_account', def: '40062', memo: 'DoorDash - Delivery' },
                        { name: 'DoorDash - Takeout', key: 'sales_doordash_account', def: '40062', memo: 'DoorDash - Takeout' },
                        { name: 'GrubHub Delivery', key: 'sales_grubhub_account', def: '40063', memo: 'GrubHub Delivery' },
                        { name: 'Grubhub - Takeout', key: 'sales_grubhub_account', def: '40063', memo: 'Grubhub - Takeout' },
                        { name: 'Kiosk Dine In', key: 'sales_dine_in_account', def: '40050', memo: 'Kiosk Dine In' },
                        { name: 'Kiosk To Go', key: 'sales_dine_in_account', def: '40050', memo: 'Kiosk To Go' },
                        { name: 'Curbside Pickup', key: 'sales_dine_in_account', def: '40050', memo: 'Curbside Pickup' },
                        { name: 'Phone', key: 'sales_dine_in_account', def: '40050', memo: 'Phone' },
                        { name: 'PostMates', key: 'sales_dine_in_account', def: '40050', memo: 'PostMates' },
                        { name: 'Toast Delivery Services', key: 'sales_dine_in_account', def: '40050', memo: 'Toast Delivery Services' },
                      ].map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200">{row.name}</td>
                          <td className="px-4 py-2">
                            <AccountSelect
                              value={(formData as any)[row.key] || row.def}
                              onChange={(v) => setFormData({ ...formData, [row.key]: v })}
                              defaultCode={row.def}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <ClassSelect
                              value={formData.qb_class}
                              onChange={(v) => setFormData({ ...formData, qb_class: v })}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              defaultValue={row.memo}
                              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 w-44"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 2: Service Charges & Delivery Fees */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {t('accounting.section_service_charges') || 'Service Charges'}
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">{t('accounting.th_toast_service_charge') || 'Toast Service Charge'}</th>
                        <th className="px-4 py-2.5">{t('accounting.th_target_account') || 'Target Account'}</th>
                        <th className="px-4 py-2.5">{t('accounting.th_class_override') || 'Class Override'}</th>
                        <th className="px-4 py-2.5">{t('accounting.th_alt_memo') || 'Alternate Memo'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Delivery Fee &gt; 6 Miles</td>
                        <td className="px-4 py-2"><AccountSelect value={formData.cc_fees_account || '51030'} onChange={(v) => setFormData({ ...formData, cc_fees_account: v })} defaultCode="51030" /></td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Delivery Fee > 6 Miles" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Delivery Service</td>
                        <td className="px-4 py-2"><AccountSelect value={formData.cc_fees_account || '51030'} onChange={(v) => setFormData({ ...formData, cc_fees_account: v })} defaultCode="51030" /></td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Delivery Service" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 3: Refunds & Deferred Sales */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {t('accounting.section_refunds') || 'Refunds'}
                  </h3>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        <tr>
                          <td className="px-4 py-2.5 font-semibold">Refunds</td>
                          <td className="px-4 py-2.5"><AccountSelect value={formData.sales_dine_in_account || '40050'} onChange={(v) => setFormData({ ...formData, sales_dine_in_account: v })} defaultCode="40050" /></td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2.5 font-semibold">Refunds In Range</td>
                          <td className="px-4 py-2.5"><AccountSelect value={formData.sales_dine_in_account || '40050'} onChange={(v) => setFormData({ ...formData, sales_dine_in_account: v })} defaultCode="40050" /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {t('accounting.section_deferred_sales') || 'Deferred Sales'}
                  </h3>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        <tr>
                          <td className="px-4 py-2.5 font-semibold">Deferred (GC)</td>
                          <td className="px-4 py-2.5"><AccountSelect value={formData.gift_card_account || '20500'} onChange={(v) => setFormData({ ...formData, gift_card_account: v })} defaultCode="20500" /></td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2.5 font-semibold">Paid In Total (Deposits Received)</td>
                          <td className="px-4 py-2.5"><AccountSelect value={formData.open_orders_account || '12049'} onChange={(v) => setFormData({ ...formData, open_orders_account: v })} defaultCode="12049" /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 3: DISCOUNTS (SalesReconGrossReceiptsDiscounts) ─── */}
          {cohesionTab === 'discounts' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Gross Receipts - Discounts
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('accounting.label_sales_amounts_as') || 'Sales Amounts Reported As:'}
                    </label>
                    <select
                      disabled
                      className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 rounded-lg px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                    >
                      <option value="Net">Net (Cohesion Canonical Rule)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('accounting.label_report_discounts_by') || 'Report Discounts Categorized By:'}
                    </label>
                    <select
                      disabled
                      className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400"
                    >
                      <option value="Individual">Each Individual Discount</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Toast POS Discounts Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Toast POS Discount Reasons
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Toast Discount Reason</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5">Class Override</th>
                        <th className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {[
                        'Employee 50%', 'Waste', 'Loyalty Reward', 'Open $ Discount', 
                        'Open % Discount', 'Comp Manager', 'Del/Arc/No Discount Reason'
                      ].map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200">{item}</td>
                          <td className="px-4 py-2"><AccountSelect value={discountAccount} defaultCode="40010" onChange={(v) => setDiscountAccount(v)} /></td>
                          <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                          <td className="px-4 py-2"><span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Net Deducted</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* External Discount Rules */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-blue-500" />
                  {t('accounting.section_external_discount_rules') || 'External Discount Rules (e.g. GrubHub, DoorDash, UberEats)'}
                </h3>
                <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-xl text-xs space-y-2">
                  <span className="font-bold text-blue-900 dark:text-blue-200 block">
                    A few things to know:
                  </span>
                  <p className="text-blue-800 dark:text-blue-300 leading-relaxed">
                    {t('accounting.desc_external_discounts') || 
                      'These rules identify external discount line items from third-party delivery apps so that gross receipts and commissions reconcile accurately.'}
                  </p>
                </div>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">External Partner Rule</th>
                        <th className="px-4 py-2.5">Pattern Match</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr>
                        <td className="px-4 py-2 font-semibold">Free Item Promotions</td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">*FREE_ITEM*, *BOGO*</td>
                        <td className="px-4 py-2"><AccountSelect value={discountAccount} defaultCode="40010" onChange={(v) => setDiscountAccount(v)} /></td>
                        <td className="px-4 py-2"><span className="text-[11px] font-bold text-emerald-600">Active ✓</span></td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2 font-semibold">Dollar Off Promotions</td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">*PROMO_OFF*, *DISCOUNT*</td>
                        <td className="px-4 py-2"><AccountSelect value={discountAccount} defaultCode="40010" onChange={(v) => setDiscountAccount(v)} /></td>
                        <td className="px-4 py-2"><span className="text-[11px] font-bold text-emerald-600">Active ✓</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 4: TAXES (SalesReconGrossReceiptsTaxes) ─── */}
          {cohesionTab === 'taxes' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Gross Receipts - Taxes
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Mapeo de impuestos municipales sobre ventas y ajustes de facilitadores de mercado.
                </p>
              </div>

              {/* Facilitator Tax Checkbox Card */}
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl space-y-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="facilitator_tax_chk"
                    defaultChecked
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-emerald-300"
                  />
                  <label htmlFor="facilitator_tax_chk" className="text-xs font-bold text-emerald-950 dark:text-emerald-200 cursor-pointer">
                    {t('accounting.label_book_facilitator_tax')}
                  </label>
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300/90 leading-relaxed pl-7">
                  {t('accounting.desc_book_facilitator_tax')}
                </p>
              </div>

              {/* Tax Rates Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Municipal Tax Rates & Marketplace Facilitator
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Toast Tax Authority / Type</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5">Class Override</th>
                        <th className="px-4 py-2.5">Alternate Memo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">
                          Local Municipal Sales Tax ({formatStoreName(activeMapping?.stores?.name || '')})
                        </td>
                        <td className="px-4 py-2">
                          <AccountSelect
                            value={formData.sales_tax_account || '24001'}
                            onChange={(v) => setFormData({ ...formData, sales_tax_account: v })}
                            defaultCode="24001"
                          />
                        </td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Sales Tax" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">
                          Marketplace Facilitator Taxes Not Paid
                        </td>
                        <td className="px-4 py-2">
                          <AccountSelect
                            value={formData.sales_tax_account || '24001'}
                            onChange={(v) => setFormData({ ...formData, sales_tax_account: v })}
                            defaultCode="24001"
                          />
                        </td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Marketplace Facilitator Taxes" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 5: TIPS (SalesReconGrossReceiptsTips) ─── */}
          {cohesionTab === 'tips' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Gross Receipts - Tips
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Mapeo de propinas registradas con tarjetas y su liquidación en efectivo al personal.
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl text-xs space-y-1">
                <span className="font-bold text-slate-900 dark:text-white block">Regla Operativa de Propinas:</span>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Toast POS acredita Tips/Grat Payable en las transacciones con tarjeta. Al cierre de cada turno, el gerente entrega las propinas en efectivo al equipo de meseros y taqueros (Tips Out). Por ello, ambas líneas balancean a través de la cuenta <strong>12100 - Cash on Hand</strong>, resultando en balance neto de cero pasivo.
                </p>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Tips Captured on Non-Cash Forms of Payment
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Tips Category</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5">Class Override</th>
                        <th className="px-4 py-2.5">Alternate Memo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Tips/Grat Payable</td>
                        <td className="px-4 py-2">
                          <AccountSelect
                            value={formData.tips_account || '12100'}
                            onChange={(v) => setFormData({ ...formData, tips_account: v })}
                            defaultCode="12100"
                          />
                        </td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Tips/Grat Payable" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Tips/Grat Out</td>
                        <td className="px-4 py-2">
                          <AccountSelect
                            value={formData.tips_account || '12100'}
                            onChange={(v) => setFormData({ ...formData, tips_account: v })}
                            defaultCode="12100"
                          />
                        </td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Tips/Grat Out" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 6: PAYMENTS (SalesReconPayments) ─── */}
          {cohesionTab === 'payments' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Non-Cash Payments & Deposits
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Configuración de cuentas bancarias por tarjeta, comisiones y cuentas clearing de delivery apps.
                </p>
              </div>

              {/* Credit Card Deposits Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Credit Card Deposits
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Deposit Account</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5">Class Override</th>
                        <th className="px-4 py-2.5">Alternate Memo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Credit Card Deposit #1</td>
                        <td className="px-4 py-2 font-mono font-bold text-blue-600 dark:text-blue-400">
                          {storeRefs.bankAccountName || formData.bank_account_number}
                        </td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Credit Card Deposit" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Credit Card Deposit #2</td>
                        <td className="px-4 py-2 font-mono font-bold text-blue-600 dark:text-blue-400">
                          {storeRefs.bankAccountName || formData.bank_account_number}
                        </td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="EBT Deposit" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold text-slate-400">Credit Card Deposit #3</td>
                        <td className="px-4 py-2 text-slate-400 italic">Please Select an Account</td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class || ''} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" placeholder="" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Merchant Fees & Built-in types */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Merchant Fees & Other Deductions
                  </h3>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        <tr>
                          <td className="px-4 py-2 font-semibold">Credit Card Fees</td>
                          <td className="px-4 py-2">
                            <AccountSelect
                              value={formData.cc_fees_account || '51030'}
                              onChange={(v) => setFormData({ ...formData, cc_fees_account: v })}
                              defaultCode="51030"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 font-semibold">Other Deductions</td>
                          <td className="px-4 py-2">
                            <AccountSelect
                              value={formData.cc_fees_account || '51030'}
                              onChange={(v) => setFormData({ ...formData, cc_fees_account: v })}
                              defaultCode="51030"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Built-In Payment Types
                  </h3>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        <tr>
                          <td className="px-4 py-2 font-semibold">Gift Card Redeemed</td>
                          <td className="px-4 py-2">
                            <AccountSelect
                              value={formData.gift_card_account || '20500'}
                              onChange={(v) => setFormData({ ...formData, gift_card_account: v })}
                              defaultCode="20500"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 font-semibold">Deposit Sales Collected</td>
                          <td className="px-4 py-2">
                            <AccountSelect
                              value={formData.open_orders_account || '12049'}
                              onChange={(v) => setFormData({ ...formData, open_orders_account: v })}
                              defaultCode="12049"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Other Payments (Delivery Apps) Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {t('accounting.section_other_payments_toast') || 'Other Payments (Toast Delivery & Special)'}
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Payment Type</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5 text-center">Book Detail?</th>
                        <th className="px-4 py-2.5">Class Override</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {[
                        { name: 'Uber Eats', key: 'ar_uber_account', def: '12050' },
                        { name: 'DoorDash', key: 'ar_doordash_account', def: '12053' },
                        { name: 'GrubHub', key: 'ar_grubhub_account', def: '12054' },
                        { name: 'PostMates', key: 'ar_postmates_account', def: '12051' },
                        { name: 'EBT', key: 'bank_account_number', def: storeRefs.bankAccount },
                        { name: 'EBT-Cash', key: 'bank_account_number', def: storeRefs.bankAccount },
                        { name: 'EBT-SNAP', key: 'bank_account_number', def: storeRefs.bankAccount },
                        { name: 'Del/Arc/No Payment Type', key: 'cash_on_hand_account', def: '12100' },
                      ].map((p, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200">{p.name}</td>
                          <td className="px-4 py-2">
                            <AccountSelect
                              value={(formData as any)[p.key] || p.def}
                              onChange={(v) => setFormData({ ...formData, [p.key]: v })}
                              defaultCode={p.def}
                            />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="inline-flex items-center text-emerald-600 font-bold">✓</span>
                          </td>
                          <td className="px-4 py-2">
                            <ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 7: CASH RECONCILIATION (SalesReconCashReconciliation) ─── */}
          {cohesionTab === 'cash' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Cash Reconciliation
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Mapeo contable del flujo de efectivo, depósitos bancarios y sobrante/faltante de caja.
                </p>
              </div>

              {/* Cash Reconciliation Entries Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Cash Reconciliation Entries
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Entry Type</th>
                        <th className="px-4 py-2.5">Target Account</th>
                        <th className="px-4 py-2.5">Class Override</th>
                        <th className="px-4 py-2.5">Alternate Memo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Cash In</td>
                        <td className="px-4 py-2"><AccountSelect value={formData.cash_on_hand_account || '12100'} onChange={(v) => setFormData({ ...formData, cash_on_hand_account: v })} defaultCode="12100" /></td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Cash In" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Deposit To Bank</td>
                        <td className="px-4 py-2"><AccountSelect value={formData.undeposited_funds_account || '13200'} onChange={(v) => setFormData({ ...formData, undeposited_funds_account: v })} defaultCode="13200" /></td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Deposit To Bank" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-semibold">Over/Short</td>
                        <td className="px-4 py-2"><AccountSelect value={formData.cash_over_short_account || '51050'} onChange={(v) => setFormData({ ...formData, cash_over_short_account: v })} defaultCode="51050" /></td>
                        <td className="px-4 py-2"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                        <td className="px-4 py-2"><input type="text" defaultValue="Over/Short" className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs w-44" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cash Pay Out/In Reasons */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Cash Pay Out/In Reasons
                </h3>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold">COGS-Materials and Supplies</td>
                        <td className="px-4 py-2.5"><AccountSelect value={formData.cogs_account || '50006'} onChange={(v) => setFormData({ ...formData, cogs_account: v })} defaultCode="50006" /></td>
                        <td className="px-4 py-2.5"><ClassSelect value={formData.qb_class} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-400">Not Assigned</td>
                        <td className="px-4 py-2.5 text-slate-400 italic">Please Select an Account</td>
                        <td className="px-4 py-2.5"><ClassSelect value={formData.qb_class || ''} onChange={(v) => setFormData({ ...formData, qb_class: v })} /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 8: RECEIVABLES (SalesReconReceivables) ─── */}
          {cohesionTab === 'receivables' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Accounts Receivable (House Charges)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Mapeo de cuentas por cobrar para órdenes a crédito y opciones de formato en QuickBooks.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Accounts Receivable:
                  </label>
                  <AccountSelect
                    value={formData.open_orders_account || '12000'}
                    onChange={(v) => setFormData({ ...formData, open_orders_account: v })}
                    defaultCode="12000"
                  />
                  <span className="text-[11px] text-slate-400 block">Cuenta de activos para cuentas por cobrar comerciales.</span>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Accounts Receivable Clearing Account:
                  </label>
                  <AccountSelect
                    value={formData.open_orders_account || '12049'}
                    onChange={(v) => setFormData({ ...formData, open_orders_account: v })}
                    defaultCode="12049"
                  />
                  <span className="text-[11px] text-slate-400 block">12049 - Open Orders Receivables (Cuenta clearing).</span>
                </div>
              </div>

              {/* Invoice Options Checkboxes */}
              <div className="space-y-3 pt-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Invoice Options
                </h3>
                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="inc_rec"
                      checked={incCustomerReceivables}
                      onChange={(e) => setIncCustomerReceivables(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 border-slate-300"
                    />
                    <label htmlFor="inc_rec" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                      Include Customer Receivables in Sales Packet
                    </label>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="add_cust_memo"
                      checked={addCustomerNameMemo}
                      onChange={(e) => setAddCustomerNameMemo(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 border-slate-300"
                    />
                    <label htmlFor="add_cust_memo" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                      Add Customer Name to Memo
                    </label>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="add_rev_memo"
                      checked={addRevenueCenterMemo}
                      onChange={(e) => setAddRevenueCenterMemo(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 border-slate-300"
                    />
                    <label htmlFor="add_rev_memo" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                      Add Revenue Center & Restaurant Service to Memo
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 9: VALIDATION (SalesReconValidationRules) ─── */}
          {cohesionTab === 'validation' && (
            <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Validation Settings (Paso 11 / Step 11 Rules)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Reglas de control previo a la publicación para evitar discrepancias o envíos de órdenes no cerradas a QuickBooks Online.
                </p>
              </div>

              {/* Credit Card Fees Validation */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('accounting.label_cc_fee_validation') || 'If Credit Card Fees have NOT been Reported:'}
                </label>
                <select
                  value={ccFeeValidation}
                  onChange={(e) => setCcFeeValidation(e.target.value as any)}
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Warn">Warn me if Fees are NOT Reported (Cohesion Standard)</option>
                  <option value="None">Do not warn</option>
                  <option value="Block">Do not allow packet to be booked</option>
                </select>
                <span className="text-[11px] text-slate-400 block">Emite una alerta preventiva si Toast POS no incluye el cálculo de comisiones.</span>
              </div>

              {/* STEP 11 CHECK FOR OPEN ORDERS */}
              <div className="p-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="check_open_orders_chk"
                    checked={checkOpenOrders}
                    onChange={(e) => setCheckOpenOrders(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-amber-300"
                  />
                  <label htmlFor="check_open_orders_chk" className="text-xs font-black text-amber-950 dark:text-amber-200 cursor-pointer flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    {t('accounting.label_check_open_orders') || 'Check for Open OR Out-of-Balance Orders:'}
                  </label>
                </div>
                <p className="text-xs text-amber-900 dark:text-amber-300 leading-relaxed pl-7">
                  {t('accounting.desc_check_open_orders') || 
                    'Verifica activamente contra Toast POS si existen órdenes abiertas o tickets desbalanceados antes de permitir la publicación a QuickBooks Online.'}
                </p>
                <div className="pl-7 pt-1 text-[11px] text-amber-800 dark:text-amber-400/80">
                  ✓ <strong>Protocolo Activo:</strong> Si se detecta al menos una orden abierta en Toast POS para la fecha, el botón de Publicar se bloquea automáticamente mostrando el listado de tickets pendientes, cajeros y montos.
                </div>
              </div>

              {/* Active Toggle for this Store */}
              <div className="pt-2 flex items-center gap-3">
                <input
                  type="checkbox"
                  id="store_active_chk"
                  checked={Boolean(formData.is_active)}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700"
                />
                <label htmlFor="store_active_chk" className="text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                  {t('accounting.label_is_active') || 'Sucursal Activa para Conciliación Diaria'}
                </label>
              </div>
            </div>
          )}

          {/* ─── BOTTOM SAVE BAR ─── */}
          <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
            <button
              onClick={handleRestoreCohesion}
              disabled={isSaving}
              className="text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('accounting.btn_restore_canonical') || 'Restaurar Valores Oficiales de Cohesion'}
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full sm:w-auto px-6 py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-md shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isSaving
                ? t('accounting.btn_saving_mapping') || 'Guardando...'
                : t('accounting.btn_save_mapping') || 'Guardar Configuración'}
            </button>
          </div>

        </div>
      )}

    </div>
  )
}
