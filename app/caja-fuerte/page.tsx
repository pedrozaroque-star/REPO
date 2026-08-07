/**
 * @module CajaFuerte
 * @description Módulo de registro y seguimiento de conteos de dinero en la caja fuerte de cada sucursal.
 * Digitaliza el proceso que antes se hacía en Excel (HORARIOS.xlsx, hoja EFECTIVO).
 * @businessRules
 * - Registra billetes sueltos ($100-$1), paquetes/rollos del banco BOA, cajas registradoras y uniformes.
 * - Los totales se calculan en tiempo real en el frontend y se validan con columnas GENERATED en Supabase.
 * - La diferencia entre conteos consecutivos se calcula automáticamente en el API.
 * - Día de negocio: 6:00 AM a 5:59 AM del siguiente día.
 * - Cada caja registradora tiene $250 de stock fijo.
 * @dataFlow
 * - Frontend calcula totales live → POST a /api/safe-counts → Supabase GENERATED columns validan.
 * - GET /api/safe-counts calcula diferencias entre conteos consecutivos de la misma tienda.
 * @notes
 * - uniforms_amount es placeholder hasta módulo dedicado.
 * - El campo loose_change es para monedas fuera de rollo (centavos sueltos).
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  Shield, Plus, History, DollarSign, Coins, CreditCard, Shirt,
  Calculator, Download, Trash2, Edit3, Check, X, ChevronDown,
  Calendar, Store, AlertTriangle, CheckCircle
} from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'
import {
  SafeCount, SafeCountFormData, SafeCountWithDiff,
  BILL_VALUES, ROLL_VALUES, DEFAULT_DRAWER_STOCK,
  calcBillsTotal, calcCoinsTotal, calcDrawersTotal, calcGrandTotal
} from '@/types/safe'

// ============================================================================
// Helpers
// ============================================================================

/** Calcula la fecha de negocio (business date). Si es antes de las 6 AM, se usa el día anterior. */
const getBusinessDate = (): string => {
  const now = new Date()
  if (now.getHours() < 6) now.setDate(now.getDate() - 1)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const formatCurrency = (val: number): string =>
  val.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const defaultForm: SafeCountFormData = {
  store_id: '',
  business_date: getBusinessDate(),
  bills_100: 0, bills_50: 0, bills_20: 0, bills_10: 0, bills_5: 0, bills_1: 0,
  packs_ones: 0, rolls_quarter: 0, rolls_dime: 0, rolls_nickel: 0, rolls_penny: 0,
  loose_change: 0,
  num_drawers: 1, drawer_stock: DEFAULT_DRAWER_STOCK,
  uniforms_amount: 0,
  notes: '',
}

// ============================================================================
// Animation variants
// ============================================================================
const tabVariants: Variants = {
  initial: { opacity: 0, x: 30 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, x: -30, transition: { duration: 0.2, ease: 'easeIn' } },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' },
  }),
}

const totalPulse = {
  scale: [1, 1.03, 1],
  transition: { duration: 0.5, ease: 'easeInOut' },
} as const

// ============================================================================
// Sub-components
// ============================================================================

/** Row de denominación: label | input | = | $amount */
function DenominationRow({
  label,
  value,
  unitValue,
  onChange,
  accentColor,
}: {
  label: string
  value: number
  unitValue: number
  onChange: (v: number) => void
  accentColor: string
}) {
  const subtotal = value * unitValue

  return (
    <div className="flex items-center gap-2 sm:gap-3 py-2 group">
      <span className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-300 w-28 sm:w-36 shrink-0 truncate">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value || ''}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className={`w-20 sm:w-24 h-12 text-center text-lg font-semibold rounded-xl border-2 
          border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
          text-gray-900 dark:text-white focus:outline-none focus:ring-2 
          transition-all duration-200 ${accentColor}
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
        inputMode="numeric"
      />
      <span className="text-gray-400 dark:text-gray-500 text-lg">=</span>
      <motion.span
        key={subtotal}
        initial={{ opacity: 0.5, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-sm sm:text-base font-bold text-gray-800 dark:text-gray-200 min-w-[80px] text-right"
      >
        {formatCurrency(subtotal)}
      </motion.span>
    </div>
  )
}

/** Row para loose_change: usa input tipo dollar en vez de multiplicar */
function LooseChangeRow({
  label,
  value,
  onChange,
  accentColor,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  accentColor: string
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-2">
      <span className="text-sm sm:text-base font-medium text-gray-700 dark:text-gray-300 w-28 sm:w-36 shrink-0 truncate">
        {label}
      </span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 font-semibold">$</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={value || ''}
          onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
          className={`w-28 sm:w-32 h-12 pl-7 pr-2 text-center text-lg font-semibold rounded-xl border-2 
            border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
            text-gray-900 dark:text-white focus:outline-none focus:ring-2 
            transition-all duration-200 ${accentColor}
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          inputMode="decimal"
        />
      </div>
    </div>
  )
}

/** Confirmation modal */
function ConfirmModal({
  open,
  title,
  message,
  yesLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = 'primary',
}: {
  open: boolean
  title: string
  message: string
  yesLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  variant?: 'primary' | 'danger'
}) {
  if (!open) return null
  const btnColor = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    : 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-md w-full border border-gray-200 dark:border-gray-700"
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2.5 rounded-xl text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${btnColor}`}
          >
            {yesLabel}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/** Toast notification */
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, y: -20, x: '-50%' }}
      className={`fixed top-6 left-1/2 z-[60] px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 
        ${type === 'success'
          ? 'bg-emerald-600 text-white'
          : 'bg-red-600 text-white'
        }`}
    >
      {type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
      <span className="font-medium text-sm">{message}</span>
      <button onClick={onClose} className="ml-2 hover:opacity-75"><X className="w-4 h-4" /></button>
    </motion.div>
  )
}

// ============================================================================
// Main page content
// ============================================================================

type TabId = 'new' | 'history'

function CajaFuerteContent() {
  const { user } = useAuth()
  const { t } = useLanguage()

  // ─── State ───
  const [activeTab, setActiveTab] = useState<TabId>('new')
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState<SafeCountFormData>({ ...defaultForm })
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  
  const [reconciliationData, setReconciliationData] = useState<{ totalCollected: number; transactionCount: number; breakdown?: string; } | null>(null)
  const [reconciliationLoading, setReconciliationLoading] = useState(false)
  const [manualOverride, setManualOverride] = useState(false)

  // History state
  const [historyStoreId, setHistoryStoreId] = useState<string>('all')
  const [historyFrom, setHistoryFrom] = useState<string>(getBusinessDate())
  const [historyTo, setHistoryTo] = useState<string>(getBusinessDate())
  const [historyData, setHistoryData] = useState<SafeCountWithDiff[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // ─── Computed ───
  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'supervisor'
  const isManager = user?.role?.toLowerCase() === 'manager' || user?.role?.toLowerCase() === 'asistente'

  // Accessible stores based on user role
  const accessibleStores = useMemo(() => {
    if (isAdmin) return stores
    if (!user) return []
    // Manager/asistente: only their assigned store(s)
    const userStoreIds = (user.store_ids || (user.store_id ? [user.store_id] : [])).map(id => id.toString())
    return stores.filter(s => userStoreIds.includes(s.id.toString()))
  }, [stores, user, isAdmin])

  // Live totals
  const billsTotal = useMemo(() => calcBillsTotal(form), [form.bills_100, form.bills_50, form.bills_20, form.bills_10, form.bills_5, form.bills_1])
  const coinsTotal = useMemo(() => calcCoinsTotal(form), [form.packs_ones, form.rolls_quarter, form.rolls_dime, form.rolls_nickel, form.rolls_penny, form.loose_change])
  const drawersTotal = useMemo(() => calcDrawersTotal(form), [form.num_drawers, form.drawer_stock])
  const grandTotal = useMemo(() => calcGrandTotal(form), [billsTotal, coinsTotal, drawersTotal, form.uniforms_amount])

  // ─── Effects ───

  // Fetch stores on mount
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const token = localStorage.getItem('teg_token')
        const res = await fetch('/api/stores', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const data = await res.json()
        if (Array.isArray(data)) {
          setStores(data.map((s: any) => ({ id: s.id, name: s.name })))
        }
      } catch (err) {
        console.error('[CajaFuerte] Error fetching stores:', err)
      }
    }
    fetchStores()
  }, [])

  // Fetch uniforms reconciliation
  useEffect(() => {
    if (!form.store_id || !form.business_date) return;
    const fetchReconciliation = async () => {
      setReconciliationLoading(true)
      try {
        const token = localStorage.getItem('teg_token')
        const res = await fetch(`/api/inventory/uniforms/safe-reconciliation?storeId=${form.store_id}&businessDate=${form.business_date}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setReconciliationData(data)
          if (data.totalCollected !== undefined && !manualOverride) {
            setForm(prev => ({ ...prev, uniforms_amount: data.totalCollected }))
          }
        }
      } catch (err) {
        console.error('[CajaFuerte] Reconciliation fetch error:', err)
      } finally {
        setReconciliationLoading(false)
      }
    }
    fetchReconciliation()
  }, [form.store_id, form.business_date, manualOverride])

  // Auto-select store for manager
  useEffect(() => {
    if (isManager && accessibleStores.length === 1 && !form.store_id) {
      setForm(prev => ({ ...prev, store_id: accessibleStores[0].id.toString() }))
    }
  }, [accessibleStores, isManager, form.store_id])

  // Auto-select history store for manager
  useEffect(() => {
    if (!isAdmin && accessibleStores.length > 0) {
      setHistoryStoreId(accessibleStores[0].id.toString())
    }
  }, [accessibleStores, isAdmin])

  // ─── Form handlers ───
  const updateField = useCallback(<K extends keyof SafeCountFormData>(field: K, value: SafeCountFormData[K]) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }, [])

  const resetForm = useCallback(() => {
    setForm({
      ...defaultForm,
      store_id: isManager && accessibleStores.length === 1 ? accessibleStores[0].id.toString() : '',
      business_date: getBusinessDate(),
    })
  }, [isManager, accessibleStores])

  // ─── Submit ───
  const handleSubmit = useCallback(async () => {
    setConfirmOpen(false)
    setSubmitting(true)

    try {
      const token = localStorage.getItem('teg_token')
      const body = { ...form, counted_by: user?.id }

      const res = await fetch('/api/safe-counts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      setToast({ message: t('safe.success'), type: 'success' })
      resetForm()
    } catch (err: any) {
      console.error('[CajaFuerte] Submit error:', err)
      setToast({ message: `${t('safe.error')}: ${err.message}`, type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [form, user, t, resetForm])

  // ─── History fetch ───
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const token = localStorage.getItem('teg_token')
      const params = new URLSearchParams()
      if (historyStoreId !== 'all') params.set('store_id', historyStoreId)
      params.set('from', historyFrom)
      params.set('to', historyTo)

      const res = await fetch(`/api/safe-counts?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      setHistoryData(data.counts || [])
    } catch (err) {
      console.error('[CajaFuerte] History fetch error:', err)
      setToast({ message: t('safe.error'), type: 'error' })
    } finally {
      setHistoryLoading(false)
    }
  }, [historyStoreId, historyFrom, historyTo, t])

  // Fetch history when tab changes to history or filters change
  useEffect(() => {
    if (activeTab === 'history') fetchHistory()
  }, [activeTab, historyStoreId, historyFrom, historyTo, fetchHistory])

  // ─── Delete ───
  const handleDelete = useCallback(async (id: string) => {
    setDeleteConfirm(null)
    try {
      const token = localStorage.getItem('teg_token')
      const res = await fetch(`/api/safe-counts/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setToast({ message: t('safe.deleted'), type: 'success' })
      fetchHistory()
    } catch (err: any) {
      setToast({ message: `${t('safe.error')}: ${err.message}`, type: 'error' })
    }
  }, [t, fetchHistory])

  // ─── CSV Export ───
  const exportCSV = useCallback(() => {
    if (historyData.length === 0) return

    const headers = [
      t('safe.business_date'), t('safe.time'), t('safe.counted_by'),
      t('safe.bills'), t('safe.change'), t('safe.drawers'),
      'Uniforms', t('safe.total'), t('safe.difference')
    ]
    const rows = historyData.map(r => [
      r.business_date,
      new Date(r.counted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      r.counted_by_name || r.user?.full_name || '-',
      r.bills_total?.toFixed(2),
      (r.coins_total + r.loose_change)?.toFixed(2),
      r.drawers_total?.toFixed(2),
      r.uniforms_amount?.toFixed(2),
      r.grand_total?.toFixed(2),
      r.difference !== null && r.difference !== undefined ? r.difference.toFixed(2) : '-',
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `caja-fuerte_${historyFrom}_${historyTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [historyData, historyFrom, historyTo, t])

  // ─── Store name lookup ───
  const storeNameById = useCallback((id: string): string => {
    const s = stores.find(s => s.id === id)
    return s ? formatStoreName(s.name) : id
  }, [stores])

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50 to-gray-100 dark:from-gray-950 dark:via-gray-900 dark:to-slate-950 p-4 sm:p-6 lg:p-8">
      {/* Toast notifications */}
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto mb-6"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
            {t('safe.title')}
          </h1>
        </div>
      </motion.div>

      {/* Tab bar */}
      <div className="max-w-5xl mx-auto mb-6">
        <div className="flex bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl p-1.5 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
          {([
            { id: 'new' as TabId, label: t('safe.new_count'), icon: Plus },
            { id: 'history' as TabId, label: t('safe.history'), icon: History },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm sm:text-base transition-all duration-300
                ${activeTab === tab.id
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-700/30'
                }`}
            >
              <tab.icon className="w-4 h-4 sm:w-5 sm:h-5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'new' ? (
            <motion.div key="new" variants={tabVariants} initial="initial" animate="animate" exit="exit">
              {/* ═════════════ TAB 1: NEW COUNT ═════════════ */}

              {/* Store & Date selectors */}
              <motion.div variants={cardVariants} custom={0} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-lg p-5 mb-5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Store selector */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
                      <Store className="w-4 h-4" />
                      {t('safe.select_store')}
                    </label>
                    <div className="relative">
                      <select
                        value={form.store_id}
                        onChange={(e) => updateField('store_id', e.target.value)}
                        disabled={isManager && accessibleStores.length === 1}
                        className="w-full h-12 px-4 pr-10 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                          text-gray-900 dark:text-white font-medium appearance-none cursor-pointer
                          focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                      >
                        <option value="">{t('safe.select_store')}</option>
                        {accessibleStores.map(s => (
                          <option key={s.id} value={s.id.toString()}>{formatStoreName(s.name)}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Business date */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
                      <Calendar className="w-4 h-4" />
                      {t('safe.business_date')}
                    </label>
                    <input
                      type="date"
                      value={form.business_date}
                      onChange={(e) => updateField('business_date', e.target.value)}
                      className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                        text-gray-900 dark:text-white font-medium 
                        focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>
              </motion.div>

              {/* ═════ SECTION 1: BILLETES (Green) ═════ */}
              <motion.div variants={cardVariants} custom={1} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border-2 border-emerald-200/60 dark:border-emerald-700/40 shadow-lg p-5 mb-5"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
                    <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="font-bold text-gray-900 dark:text-white text-lg">{t('safe.bills_section')}</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('safe.bills_subtitle')}</p>
                  </div>
                </div>

                <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-700/50">
                  {(Object.entries(BILL_VALUES) as [keyof typeof BILL_VALUES, number][]).map(([key, val]) => (
                    <DenominationRow
                      key={key}
                      label={`$${val}`}
                      value={form[key]}
                      unitValue={val}
                      onChange={(v) => updateField(key, v)}
                      accentColor="focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  ))}
                </div>

                {/* Section subtotal */}
                <div className="mt-3 pt-3 border-t-2 border-emerald-200/60 dark:border-emerald-700/40 flex justify-between items-center">
                  <span className="font-semibold text-gray-600 dark:text-gray-400 text-sm">{t('safe.subtotal')}</span>
                  <motion.span
                    key={billsTotal}
                    animate={totalPulse as any}
                    className="text-xl font-bold text-emerald-600 dark:text-emerald-400"
                  >
                    {formatCurrency(billsTotal)}
                  </motion.span>
                </div>
              </motion.div>

              {/* ═════ SECTION 2: CAMBIO / ROLLOS BOA (Blue) ═════ */}
              <motion.div variants={cardVariants} custom={2} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border-2 border-blue-200/60 dark:border-blue-700/40 shadow-lg p-5 mb-5"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40">
                    <Coins className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="font-bold text-gray-900 dark:text-white text-lg">{t('safe.change_section')}</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('safe.change_subtitle')}</p>
                  </div>
                </div>

                <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-700/50">
                  <DenominationRow
                    label={t('safe.packs_ones')}
                    value={form.packs_ones}
                    unitValue={ROLL_VALUES.packs_ones}
                    onChange={(v) => updateField('packs_ones', v)}
                    accentColor="focus:ring-blue-500 focus:border-blue-500"
                  />
                  <DenominationRow
                    label={t('safe.rolls_quarter')}
                    value={form.rolls_quarter}
                    unitValue={ROLL_VALUES.rolls_quarter}
                    onChange={(v) => updateField('rolls_quarter', v)}
                    accentColor="focus:ring-blue-500 focus:border-blue-500"
                  />
                  <DenominationRow
                    label={t('safe.rolls_dime')}
                    value={form.rolls_dime}
                    unitValue={ROLL_VALUES.rolls_dime}
                    onChange={(v) => updateField('rolls_dime', v)}
                    accentColor="focus:ring-blue-500 focus:border-blue-500"
                  />
                  <DenominationRow
                    label={t('safe.rolls_nickel')}
                    value={form.rolls_nickel}
                    unitValue={ROLL_VALUES.rolls_nickel}
                    onChange={(v) => updateField('rolls_nickel', v)}
                    accentColor="focus:ring-blue-500 focus:border-blue-500"
                  />
                  <DenominationRow
                    label={t('safe.rolls_penny')}
                    value={form.rolls_penny}
                    unitValue={ROLL_VALUES.rolls_penny}
                    onChange={(v) => updateField('rolls_penny', v)}
                    accentColor="focus:ring-blue-500 focus:border-blue-500"
                  />
                  <LooseChangeRow
                    label={t('safe.loose_change')}
                    value={form.loose_change}
                    onChange={(v) => updateField('loose_change', v)}
                    accentColor="focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Section subtotal */}
                <div className="mt-3 pt-3 border-t-2 border-blue-200/60 dark:border-blue-700/40 flex justify-between items-center">
                  <span className="font-semibold text-gray-600 dark:text-gray-400 text-sm">{t('safe.subtotal')}</span>
                  <motion.span
                    key={coinsTotal}
                    animate={totalPulse as any}
                    className="text-xl font-bold text-blue-600 dark:text-blue-400"
                  >
                    {formatCurrency(coinsTotal)}
                  </motion.span>
                </div>
              </motion.div>

              {/* ═════ SECTION 3: CAJAS REGISTRADORAS (Amber) ═════ */}
              <motion.div variants={cardVariants} custom={3} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border-2 border-amber-200/60 dark:border-amber-700/40 shadow-lg p-5 mb-5"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                    <CreditCard className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h2 className="font-bold text-gray-900 dark:text-white text-lg">{t('safe.drawers_section')}</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('safe.drawers_subtitle')}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t('safe.num_drawers')}</label>
                    <select
                      value={form.num_drawers}
                      onChange={(e) => updateField('num_drawers', parseInt(e.target.value))}
                      className="h-12 w-20 px-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                        text-gray-900 dark:text-white font-bold text-lg text-center appearance-none cursor-pointer
                        focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                    >
                      {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <X className="w-4 h-4" />
                    <span className="font-semibold">{t('safe.per_drawer')}:</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">{formatCurrency(form.drawer_stock)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 dark:text-gray-500 text-lg">=</span>
                    <motion.span
                      key={drawersTotal}
                      animate={totalPulse as any}
                      className="text-xl font-bold text-amber-600 dark:text-amber-400"
                    >
                      {formatCurrency(drawersTotal)}
                    </motion.span>
                  </div>
                </div>
              </motion.div>

              {/* ═════ SECTION 4: UNIFORMES (Purple) ═════ */}
              <motion.div variants={cardVariants} custom={4} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border-2 border-purple-200/60 dark:border-purple-700/40 shadow-lg p-5 mb-5"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/40">
                    <Shirt className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h2 className="font-bold text-gray-900 dark:text-white text-lg">{t('safe.uniforms_section')}</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('safe.uniforms_subtitle')}</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 font-semibold text-lg">$</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.uniforms_amount || ''}
                        onChange={(e) => {
                          setManualOverride(true)
                          updateField('uniforms_amount', Math.max(0, parseFloat(e.target.value) || 0))
                        }}
                        className="w-40 h-12 pl-8 pr-3 text-lg font-semibold rounded-xl border-2 
                          border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                          text-gray-900 dark:text-white focus:outline-none focus:ring-2 
                          focus:ring-purple-500 focus:border-purple-500 transition-all
                          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        inputMode="decimal"
                      />
                    </div>
                  </div>

                  {reconciliationLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                      Consultando módulo...
                    </div>
                  ) : (reconciliationData && reconciliationData.totalCollected !== undefined) ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-600 dark:text-gray-300 bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded-md border border-purple-200 dark:border-purple-700/50">
                          Ventas Módulo: <strong>{formatCurrency(reconciliationData.totalCollected)}</strong>
                        </span>
                        {manualOverride && (
                          <button
                            onClick={() => {
                              setManualOverride(false)
                              setForm(prev => ({ ...prev, uniforms_amount: reconciliationData.totalCollected }))
                            }}
                            className="text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded-md transition-colors"
                          >
                            Aplicar del Módulo
                          </button>
                        )}
                      </div>
                      {reconciliationData.breakdown && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {reconciliationData.breakdown}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </motion.div>

              {/* ═════ GRAND TOTAL (Sticky) ═════ */}
              <motion.div
                variants={cardVariants} custom={5} initial="hidden" animate="visible"
                className="sticky bottom-4 z-10 mb-5"
              >
                <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 rounded-2xl shadow-2xl shadow-emerald-600/20 p-5 border border-emerald-500/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-white/20">
                        <Calculator className="w-6 h-6 text-white" />
                      </div>
                      <span className="text-white/80 font-semibold text-sm sm:text-base">{t('safe.grand_total')}</span>
                    </div>
                    <motion.div
                      key={grandTotal}
                      initial={{ opacity: 0.5, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                      className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight"
                    >
                      {formatCurrency(grandTotal)}
                    </motion.div>
                  </div>

                  {/* Breakdown mini-bar */}
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <div className="bg-white/10 rounded-lg py-1.5 px-1">
                      <div className="text-[10px] sm:text-xs text-white/60 uppercase tracking-wide">{t('safe.bills')}</div>
                      <div className="text-xs sm:text-sm font-bold text-white">{formatCurrency(billsTotal)}</div>
                    </div>
                    <div className="bg-white/10 rounded-lg py-1.5 px-1">
                      <div className="text-[10px] sm:text-xs text-white/60 uppercase tracking-wide">{t('safe.change')}</div>
                      <div className="text-xs sm:text-sm font-bold text-white">{formatCurrency(coinsTotal)}</div>
                    </div>
                    <div className="bg-white/10 rounded-lg py-1.5 px-1">
                      <div className="text-[10px] sm:text-xs text-white/60 uppercase tracking-wide">{t('safe.drawers')}</div>
                      <div className="text-xs sm:text-sm font-bold text-white">{formatCurrency(drawersTotal)}</div>
                    </div>
                    <div className="bg-white/10 rounded-lg py-1.5 px-1">
                      <div className="text-[10px] sm:text-xs text-white/60 uppercase tracking-wide">Uniforms</div>
                      <div className="text-xs sm:text-sm font-bold text-white">{formatCurrency(form.uniforms_amount)}</div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* ═════ NOTES ═════ */}
              <motion.div variants={cardVariants} custom={6} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-lg p-5 mb-5"
              >
                <label className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 block">{t('safe.notes')}</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder={t('safe.notes_placeholder')}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                    text-gray-900 dark:text-white resize-none 
                    focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all
                    placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </motion.div>

              {/* ═════ SUBMIT BUTTON ═════ */}
              <motion.div variants={cardVariants} custom={7} initial="hidden" animate="visible" className="mb-8">
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!form.store_id || submitting}
                  className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-xl transition-all duration-300
                    bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-emerald-500 disabled:hover:to-teal-600
                    hover:shadow-2xl hover:shadow-emerald-500/25 active:scale-[0.98]
                    flex items-center justify-center gap-3"
                >
                  {submitting ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Check className="w-6 h-6" />
                      {t('safe.register_count')}
                    </>
                  )}
                </button>
              </motion.div>

              {/* Confirm Modal */}
              <AnimatePresence>
                {confirmOpen && (
                  <ConfirmModal
                    open={confirmOpen}
                    title={t('safe.confirm_title')}
                    message={`${t('safe.confirm_message')} ${formatCurrency(grandTotal)}`}
                    yesLabel={t('safe.confirm_yes')}
                    cancelLabel={t('safe.confirm_cancel')}
                    onConfirm={handleSubmit}
                    onCancel={() => setConfirmOpen(false)}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="history" variants={tabVariants} initial="initial" animate="animate" exit="exit">
              {/* ═════════════ TAB 2: HISTORY ═════════════ */}

              {/* Filters */}
              <motion.div variants={cardVariants} custom={0} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-lg p-5 mb-5"
              >
                <div className="flex flex-wrap items-end gap-4">
                  {/* Store filter */}
                  <div className="flex-1 min-w-[180px]">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
                      <Store className="w-4 h-4" />
                      {t('safe.select_store')}
                    </label>
                    <div className="relative">
                      <select
                        value={historyStoreId}
                        onChange={(e) => setHistoryStoreId(e.target.value)}
                        className="w-full h-11 px-4 pr-10 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                          text-gray-900 dark:text-white font-medium appearance-none cursor-pointer
                          focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-sm"
                      >
                        {isAdmin && <option value="all">{t('safe.all_stores')}</option>}
                        {accessibleStores.map(s => (
                          <option key={s.id} value={s.id.toString()}>{formatStoreName(s.name)}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* From date */}
                  <div className="min-w-[150px]">
                    <label className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 block">{t('safe.from_date')}</label>
                    <input
                      type="date"
                      value={historyFrom}
                      onChange={(e) => setHistoryFrom(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                        text-gray-900 dark:text-white font-medium text-sm
                        focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    />
                  </div>

                  {/* To date */}
                  <div className="min-w-[150px]">
                    <label className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 block">{t('safe.to_date')}</label>
                    <input
                      type="date"
                      value={historyTo}
                      onChange={(e) => setHistoryTo(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 
                        text-gray-900 dark:text-white font-medium text-sm
                        focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    />
                  </div>

                  {/* Search button */}
                  <button
                    onClick={fetchHistory}
                    disabled={historyLoading}
                    className="h-11 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold text-sm
                      hover:from-emerald-600 hover:to-teal-700 transition-all shadow-md hover:shadow-lg
                      disabled:opacity-50 flex items-center gap-2"
                  >
                    {historyLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Calendar className="w-4 h-4" />
                    )}
                    {t('safe.filter_dates')}
                  </button>

                  {/* Export CSV */}
                  <button
                    onClick={exportCSV}
                    disabled={historyData.length === 0}
                    className="h-11 px-5 rounded-xl border-2 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 
                      font-semibold text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-all
                      disabled:opacity-40 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {t('safe.export_csv')}
                  </button>
                </div>
              </motion.div>

              {/* History table */}
              <motion.div variants={cardVariants} custom={1} initial="hidden" animate="visible"
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-lg overflow-hidden"
              >
                {historyLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                  </div>
                ) : historyData.length === 0 ? (
                  <div className="text-center py-16 px-4">
                    <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 dark:text-gray-400 font-medium">{t('safe.no_records')}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50/80 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.business_date')}</th>
                          <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.time')}</th>
                          {historyStoreId === 'all' && (
                            <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.select_store')}</th>
                          )}
                          <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.counted_by')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.bills')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.change')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.drawers')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">Uniforms</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.total')}</th>
                          <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-400">{t('safe.difference')}</th>
                          {isAdmin && (
                            <th className="text-center py-3 px-4 font-semibold text-gray-600 dark:text-gray-400" />
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {historyData.map((row, idx) => {
                          const diff = row.difference
                          const diffColor = diff === null || diff === undefined
                            ? 'text-gray-400 dark:text-gray-500'
                            : diff > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : diff < 0
                                ? 'text-red-500 dark:text-red-400'
                                : 'text-gray-400 dark:text-gray-500'

                          return (
                            <motion.tr
                              key={row.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: idx * 0.03 }}
                              className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
                            >
                              <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{row.business_date}</td>
                              <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                                {new Date(row.counted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              {historyStoreId === 'all' && (
                                <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                                  {row.store_name ? formatStoreName(row.store_name) : storeNameById(row.store_id)}
                                </td>
                              )}
                              <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                {row.counted_by_name || row.user?.full_name || '-'}
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-gray-800 dark:text-gray-200">
                                {formatCurrency(row.bills_total)}
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-gray-800 dark:text-gray-200">
                                {formatCurrency(row.coins_total + row.loose_change)}
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-gray-800 dark:text-gray-200">
                                {formatCurrency(row.drawers_total)}
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-gray-800 dark:text-gray-200">
                                {formatCurrency(row.uniforms_amount)}
                              </td>
                              <td className="py-3 px-4 text-right font-bold text-gray-900 dark:text-white">
                                {formatCurrency(row.grand_total)}
                              </td>
                              <td className={`py-3 px-4 text-right font-bold ${diffColor}`}>
                                {diff === null || diff === undefined
                                  ? '-'
                                  : diff > 0
                                    ? `+${formatCurrency(diff)}`
                                    : formatCurrency(diff)
                                }
                              </td>
                              {isAdmin && (
                                <td className="py-3 px-4 text-center">
                                  <button
                                    onClick={() => setDeleteConfirm(row.id)}
                                    className="p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              )}
                            </motion.tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>

              {/* Delete confirmation */}
              <AnimatePresence>
                {deleteConfirm && (
                  <ConfirmModal
                    open={!!deleteConfirm}
                    title={t('safe.delete_confirm')}
                    message={t('safe.delete_confirm')}
                    yesLabel={t('safe.confirm_yes')}
                    cancelLabel={t('safe.confirm_cancel')}
                    onConfirm={() => handleDelete(deleteConfirm)}
                    onCancel={() => setDeleteConfirm(null)}
                    variant="danger"
                  />
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============================================================================
// Wrapped with ProtectedRoute + Suspense
// ============================================================================

export default function CajaFuertePage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager', 'asistente']}>
      <Suspense fallback={<SurpriseLoader />}>
        <CajaFuerteContent />
      </Suspense>
    </ProtectedRoute>
  )
}
