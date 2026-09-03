/**
 * @module contabilidad/configuracion
 * @description Página de configuración del módulo de contabilidad.
 * Permite ver y editar los mapeos GL por tienda, configurar cuentas bancarias, ubicaciones,
 * clases de QuickBooks, y sincronizar cuentas contables desde QuickBooks Online.
 * 
 * @businessRules
 * - Cada tienda tiene un mapeo único de cuentas GL (banco, ubicación QB, clase QB, etc.).
 * - Los mapeos determinan qué cuentas contables se usan en las pólizas de cada tienda.
 * - La sincronización de cuentas desde QB es necesaria para obtener los IDs internos.
 * - Permite editar y guardar en tiempo real en la base de datos de Supabase.
 * - Sigue el diseño visual estándar claro/oscuro del sistema SM TEG.
 * 
 * @dataFlow
 * accounting_site_mappings + accounting_gl_accounts ↔ this page ↔ API routes
 */

'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertCircle, 
  Building2, BookOpen, Pencil, X, Save, RotateCcw, 
  DollarSign, Receipt, CreditCard, ShieldCheck 
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'
import { getQBStoreRefs } from '@/lib/qb-classes-locations'

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

export default function AccountingConfigPage() {
  const { t, language } = useLanguage()
  const [activeTab, setActiveTab] = useState<'mappings' | 'accounts'>('mappings')
  const [mappings, setMappings] = useState<SiteMapping[]>([])
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<SiteMapping | null>(null)
  const [formData, setFormData] = useState<Partial<SiteMapping>>({})
  const [modalTab, setModalTab] = useState<'qb' | 'banking' | 'sales' | 'taxes' | 'ar'>('qb')
  const [isSaving, setIsSaving] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [mappingsRes, accountsRes] = await Promise.all([
        fetch('/api/accounting/site-mappings'),
        fetch('/api/accounting/gl-accounts'),
      ])

      if (mappingsRes.ok) {
        const data = await mappingsRes.json()
        setMappings(data.mappings || [])
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

  useEffect(() => {
    loadData()
  }, [])

  const handleSyncFromQB = async () => {
    setIsSyncing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/accounting/gl-accounts', {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setMessage({
        type: 'success',
        text: `Sincronización exitosa: ${data.accountsUpserted || 0} cuentas actualizadas desde QuickBooks Online.`,
      })
      await loadData()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error syncing with QuickBooks' })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleOpenEdit = (mapping: SiteMapping) => {
    setEditingMapping(mapping)
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
      cc_fees_account: mapping.cc_fees_account || '51030',
      undeposited_funds_account: mapping.undeposited_funds_account || '13200',
      cash_over_short_account: mapping.cash_over_short_account || '51050',
      gift_card_account: mapping.gift_card_account || '20500',
      open_orders_account: mapping.open_orders_account || '12049',
      cash_on_hand_account: mapping.cash_on_hand_account || '12100',
    })
    setModalTab('qb')
    setIsModalOpen(true)
  }

  const handleResetToCohesion = () => {
    if (!editingMapping) return
    const qbRefs = getQBStoreRefs(editingMapping.stores?.name || '')
    setFormData((prev) => ({
      ...prev,
      qb_location: qbRefs.locationName,
      qb_class: qbRefs.className,
      bank_account_number: qbRefs.bankAccount,
      bank_account_qb_id: qbRefs.bankAccountQbId,
      sales_dine_in_account: '40050',
      sales_uber_account: '40060',
      sales_doordash_account: '40062',
      sales_grubhub_account: '40063',
      sales_tax_account: '24001',
      ar_uber_account: '12050',
      ar_doordash_account: '12053',
      ar_grubhub_account: '12054',
      cc_fees_account: '51030',
      undeposited_funds_account: '13200',
      cash_over_short_account: '51050',
      gift_card_account: '20500',
      open_orders_account: '12049',
      cash_on_hand_account: '12100',
      is_active: true,
    }))
  }

  const handleSaveMapping = async () => {
    if (!editingMapping || !formData.store_id) return
    setIsSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/accounting/site-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update mapping')

      setMessage({
        type: 'success',
        text: t('accounting.alert_mapping_saved') || 'Configuración guardada exitosamente.',
      })

      // Update local state
      setMappings((prev) =>
        prev.map((m) => (m.store_id === editingMapping.store_id ? { ...m, ...data.mapping } : m))
      )
      setIsModalOpen(false)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error saving mapping' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="w-full mx-auto px-4 md:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/contabilidad"
            className="p-2.5 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-all shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('accounting.tab_settings') || 'Configuración Contable'}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {language === 'en'
                ? 'Manage store GL mappings, banking accounts, and QuickBooks Online rules'
                : 'Mapeo de cuentas contables, bancos, clases y parámetros de Cohesion'}
            </p>
          </div>
        </div>

        {activeTab === 'accounts' && (
          <button
            onClick={handleSyncFromQB}
            disabled={isSyncing}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-md shadow-blue-600/20"
          >
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('accounting.btn_sync_gl') || 'Sincronizar desde QuickBooks'}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 border shadow-sm ${
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

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-1">
        <button
          onClick={() => setActiveTab('mappings')}
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            activeTab === 'mappings'
              ? 'bg-slate-900 text-white dark:bg-blue-600 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          {language === 'en' ? 'Store Mappings' : 'Mapeos por Sucursal'} ({mappings.length})
        </button>
        <button
          onClick={() => setActiveTab('accounts')}
          className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            activeTab === 'accounts'
              ? 'bg-slate-900 text-white dark:bg-blue-600 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          {t('accounting.tab_gl_accounts') || 'Catálogo de Cuentas'} ({glAccounts.length})
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
        </div>
      ) : activeTab === 'mappings' ? (
        /* Site Mappings Table */
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_store') || 'Sucursal'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_location') || 'Ubicación QB'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_class') || 'Clase QB'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.label_bank_account') || 'Cuenta Bancaria'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">Cliente (*-COH)</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_status') || 'Estado'}</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_action') || 'Acción'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {mappings.map(m => {
                  const qbRefs = getQBStoreRefs(m.stores?.name || '')
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100">
                        {formatStoreName(m.stores?.name || '')}
                      </td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300 font-semibold">{m.qb_location}</td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300 font-semibold">{m.qb_class}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <code className="text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50 px-2.5 py-1 rounded-lg text-xs font-mono font-bold">
                            {qbRefs.bankAccountName || m.bank_account_number}
                          </code>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          {qbRefs.cohCustomerName}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {m.is_active ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Activo ✓
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleOpenEdit(m)}
                          className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-850 transition-all shadow-sm gap-1.5"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t('accounting.btn_edit_mapping') || 'Editar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* GL Accounts Table */
        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">{t('accounting.col_account') || 'Número de Cuenta'}</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">Nombre de Cuenta</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">Tipo Contable</th>
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">ID QuickBooks</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">Estado</th>
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
                      {acct.is_active ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
                          Inactivo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── COHESION EDIT MODAL ─── */}
      {isModalOpen && editingMapping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-md shadow-blue-600/20">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                      {editingMapping.stores?.name}
                    </h2>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-md">
                      {getQBStoreRefs(editingMapping.stores?.name || '').cohCustomerName}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('accounting.modal_mapping_subtitle')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Section Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/30 dark:bg-slate-900/50 gap-1 overflow-x-auto">
              <button
                onClick={() => setModalTab('qb')}
                className={`py-3 px-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                  modalTab === 'qb'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <Building2 className="w-4 h-4" />
                {t('accounting.tab_sec_qb')}
              </button>
              <button
                onClick={() => setModalTab('banking')}
                className={`py-3 px-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                  modalTab === 'banking'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <DollarSign className="w-4 h-4" />
                {t('accounting.tab_sec_banking')}
              </button>
              <button
                onClick={() => setModalTab('sales')}
                className={`py-3 px-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                  modalTab === 'sales'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <Receipt className="w-4 h-4" />
                {t('accounting.tab_sec_sales')}
              </button>
              <button
                onClick={() => setModalTab('taxes')}
                className={`py-3 px-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                  modalTab === 'taxes'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                {t('accounting.tab_sec_taxes')}
              </button>
              <button
                onClick={() => setModalTab('ar')}
                className={`py-3 px-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                  modalTab === 'ar'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                {t('accounting.tab_sec_ar')}
              </button>
            </div>

            {/* Modal Body / Tab Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* TAB 1: QUICKBOOKS & LOCATION */}
              {modalTab === 'qb' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.col_location') || 'Ubicación QB (Location)'}
                      </label>
                      <input
                        type="text"
                        value={formData.qb_location || ''}
                        onChange={(e) => setFormData({ ...formData, qb_location: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">DepartmentRef enviado en JournalEntry.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.col_class') || 'Clase QB (Class)'}
                      </label>
                      <input
                        type="text"
                        value={formData.qb_class || ''}
                        onChange={(e) => setFormData({ ...formData, qb_class: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">ClassRef enviado en cada línea contable.</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_bank_account')}
                    </label>
                    <select
                      value={formData.bank_account_number || ''}
                      onChange={(e) => {
                        const sel = OFFICIAL_BANK_ACCOUNTS.find((b) => b.number === e.target.value)
                        setFormData({
                          ...formData,
                          bank_account_number: e.target.value,
                          bank_account_qb_id: sel?.qbId || formData.bank_account_qb_id,
                        })
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    >
                      {OFFICIAL_BANK_ACCOUNTS.map((b) => (
                        <option key={b.number} value={b.number}>
                          {b.label} (QB #{b.qbId})
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-slate-400 mt-1 block">Cuenta de banco donde se aplican depósitos de tarjetas y EBT.</span>
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={Boolean(formData.is_active)}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700"
                    />
                    <label htmlFor="is_active" className="text-sm font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                      {t('accounting.label_is_active')}
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 2: BANKING & CASH */}
              {modalTab === 'banking' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_undeposited_funds')}
                    </label>
                    <input
                      type="text"
                      value={formData.undeposited_funds_account || '13200'}
                      onChange={(e) => setFormData({ ...formData, undeposited_funds_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">13200 - Undeposited Funds (Depósito de efectivo con cliente *-COH).</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_cash_over_short_acc')}
                    </label>
                    <input
                      type="text"
                      value={formData.cash_over_short_account || '51050'}
                      onChange={(e) => setFormData({ ...formData, cash_over_short_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">51050 - Cash Over/(Short) en caso de descuadre de efectivo.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_cash_on_hand')}
                    </label>
                    <input
                      type="text"
                      value={formData.cash_on_hand_account || '12100'}
                      onChange={(e) => setFormData({ ...formData, cash_on_hand_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">12100 - Cash on Hand.</span>
                  </div>
                </div>
              )}

              {/* TAB 3: SALES (GL) */}
              {modalTab === 'sales' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_sales_dine_in')}
                      </label>
                      <input
                        type="text"
                        value={formData.sales_dine_in_account || '40050'}
                        onChange={(e) => setFormData({ ...formData, sales_dine_in_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">40050 - For Here / To Go / Toast Online.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_sales_uber')}
                      </label>
                      <input
                        type="text"
                        value={formData.sales_uber_account || '40060'}
                        onChange={(e) => setFormData({ ...formData, sales_uber_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">40060 - Uber Eats Delivery & Takeout.</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_sales_doordash')}
                      </label>
                      <input
                        type="text"
                        value={formData.sales_doordash_account || '40062'}
                        onChange={(e) => setFormData({ ...formData, sales_doordash_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">40062 - DoorDash Delivery & Takeout.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_sales_grubhub')}
                      </label>
                      <input
                        type="text"
                        value={formData.sales_grubhub_account || '40063'}
                        onChange={(e) => setFormData({ ...formData, sales_grubhub_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">40063 - GrubHub Delivery & Takeout.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: TAXES & LIABILITIES */}
              {modalTab === 'taxes' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_sales_tax_acc')}
                    </label>
                    <input
                      type="text"
                      value={formData.sales_tax_account || '24001'}
                      onChange={(e) => setFormData({ ...formData, sales_tax_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">24001 - Sales Tax Payable & Marketplace Facilitator Taxes.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_gift_card_acc')}
                    </label>
                    <input
                      type="text"
                      value={formData.gift_card_account || '20500'}
                      onChange={(e) => setFormData({ ...formData, gift_card_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">20500 - Gift Cards Payable.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_open_orders_acc')}
                    </label>
                    <input
                      type="text"
                      value={formData.open_orders_account || '12049'}
                      onChange={(e) => setFormData({ ...formData, open_orders_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">12049 - Open Orders Receivables (Depósitos retenidos).</span>
                  </div>
                </div>
              )}

              {/* TAB 5: RECEIVABLES & FEES */}
              {modalTab === 'ar' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {t('accounting.label_cc_fees_acc')}
                    </label>
                    <input
                      type="text"
                      value={formData.cc_fees_account || '51030'}
                      onChange={(e) => setFormData({ ...formData, cc_fees_account: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">51030 - Bank Merchant Fees (Comisión de procesamiento Toast).</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_ar_uber')}
                      </label>
                      <input
                        type="text"
                        value={formData.ar_uber_account || '12050'}
                        onChange={(e) => setFormData({ ...formData, ar_uber_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">12050 - Uber Eats</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_ar_doordash')}
                      </label>
                      <input
                        type="text"
                        value={formData.ar_doordash_account || '12053'}
                        onChange={(e) => setFormData({ ...formData, ar_doordash_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">12053 - DoorDash</span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        {t('accounting.label_ar_grubhub')}
                      </label>
                      <input
                        type="text"
                        value={formData.ar_grubhub_account || '12054'}
                        onChange={(e) => setFormData({ ...formData, ar_grubhub_account: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">12054 - GrubHub</span>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50">
              <button
                onClick={handleResetToCohesion}
                className="text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('accounting.btn_reset_cohesion')}
              </button>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
                >
                  {language === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
                <button
                  onClick={handleSaveMapping}
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-md shadow-blue-600/20 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {isSaving
                    ? t('accounting.btn_saving_mapping')
                    : t('accounting.btn_save_mapping')}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
