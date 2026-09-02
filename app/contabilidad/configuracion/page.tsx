/**
 * @module contabilidad/configuracion
 * @description Página de configuración del módulo de contabilidad.
 * Permite ver y editar los mapeos GL por tienda y sincronizar cuentas desde QuickBooks.
 * 
 * @businessRules
 * - Cada tienda tiene un mapeo único de cuentas GL (banco, ubicación QB, clase QB).
 * - Los mapeos determinan qué cuentas contables se usan en las pólizas de cada tienda.
 * - La sincronización de cuentas desde QB es necesaria para obtener los IDs internos.
 * - Sigue el diseño visual estándar claro/oscuro del sistema SM TEG.
 * 
 * @dataFlow
 * accounting_site_mappings + accounting_gl_accounts ↔ this page ↔ API routes
 */

'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertCircle, Building2, BookOpen } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'

interface SiteMapping {
  id: string
  store_id: number
  qb_location: string
  qb_class: string
  bank_account_number: string
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

export default function AccountingConfigPage() {
  const { t, language } = useLanguage()
  const [activeTab, setActiveTab] = useState<'mappings' | 'accounts'>('mappings')
  const [mappings, setMappings] = useState<SiteMapping[]>([])
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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

  return (
    <div className="w-full mx-auto px-4 md:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/contabilidad"
            className="p-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-all shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('accounting.tab_settings') || 'Configuración Contable'}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {language === 'en'
                ? 'Manage store GL mappings and chart of accounts'
                : 'Mapeo de cuentas contables, bancos y clases por sucursal'}
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
          className={`p-4 rounded-xl flex items-center gap-3 border shadow-sm ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800/60'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800/60'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          <span className="text-sm font-semibold">{message.text}</span>
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
                  <th className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase text-xs">Cuenta Bancaria</th>
                  <th className="px-6 py-4 font-bold text-center text-slate-900 dark:text-white uppercase text-xs">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {mappings.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100">
                      {formatStoreName(m.stores?.name || '')}
                    </td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300 font-semibold">{m.qb_location}</td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300 font-semibold">{m.qb_class}</td>
                    <td className="px-6 py-4">
                      <code className="text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50 px-2.5 py-1 rounded-lg text-xs font-mono font-bold">
                        {m.bank_account_number}
                      </code>
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
                  </tr>
                ))}
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
                          Activa ✓
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          Inactiva
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
    </div>
  )
}
