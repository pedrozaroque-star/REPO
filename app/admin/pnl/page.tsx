/**
 * @module admin/pnl/page
 * @description Master multi-unit side-by-side Profit & Loss (P&L) dashboard
 * for all 15 Tacos Gavilan restaurants plus the consolidated chain total.
 * Replicates the executive financial grid of Restaurant365 (R365).
 * 
 * @businessRules
 * - Shows all 15 active stores in parallel columns with a Consolidated Total column.
 * - Allows switching between:
 *   * Store View: Shows food cost with La Bodega transfer price/markup to evaluate store discipline.
 *   * Corporate View: Eliminates internal Bodega markup (~10%) to reflect true corporate profit without double-counting.
 * - Tab 1: Interactive Side-by-Side P&L Matrix with collapsible financial categories.
 * - Tab 2: Fixed OpEx and Shared Brand Expense (Meta Ads) manager with automatic store proration.
 * - Exports report to CSV and supports publication-grade printing.
 * 
 * @dataFlow
 * - Calls `GET /api/pnl/consolidated?startDate=...&endDate=...&bodegaMode=...`
 * - Calls `GET /api/pnl/expenses` and `POST /api/pnl/expenses`
 * 
 * @notes
 * - Built to satisfy the exact requirements expressed by Erick Velazquez in the R365 meeting.
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  BarChart3, RefreshCw, Download, Printer, Settings, Eye, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronRight, Store, DollarSign, TrendingUp,
  Percent, ArrowUpDown, Shield, Building, Trash2, Plus, Info, Sparkles
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import SurpriseLoader from '@/components/SurpriseLoader'

interface StoreSummary {
  id: string
  external_id: string
  name: string
  gross_sales: number
  comps_discounts: number
  net_sales: number
  sales_pct: number
  food_cost: number
  food_cost_pct: number
  labor_wages: number
  labor_wages_pct: number
  employee_benefits: number
  employee_benefits_pct: number
  total_prime_cost: number
  prime_cost_pct: number
  gross_profit: number
  gross_profit_pct: number
  rent: number
  cam_charges: number
  utilities: number
  repairs_maintenance: number
  supplies_misc: number
  insurance: number
  total_operating_expenses: number
  operating_expenses_pct: number
  store_net_income: number
  store_net_income_pct: number
  corporate_overhead: number
  corporate_overhead_pct: number
  ebitda: number
  ebitda_pct: number
  net_profit: number
  net_profit_pct: number
}

interface ConsolidatedData {
  period: string
  startDate: string
  endDate: string
  daysCount: number
  bodegaMode: 'store' | 'corporate'
  stores: StoreSummary[]
  consolidated: StoreSummary
  sharedExpenses: any[]
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val || 0)
}

function formatPct(val: number): string {
  return `${(val || 0).toFixed(1)}%`
}

function safePct(numerator: number, denominator: number): string {
  if (!denominator || denominator <= 0) return '0.0'
  return ((numerator / denominator) * 100).toFixed(1)
}

export default function PnLPage() {
  const { t, language } = useLanguage()

  // Period State
  const [period, setPeriod] = useState<'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom'>('this_week')
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date()
    // Default to Monday of current week
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const mon = new Date(d.setDate(diff))
    return mon.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState<string>(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })

  // Mode and View State
  const [bodegaMode, setBodegaMode] = useState<'store' | 'corporate'>('corporate')
  const [activeTab, setActiveTab] = useState<'pnl' | 'expenses'>('pnl')
  const [selectedStoreDetail, setSelectedStoreDetail] = useState<StoreSummary | null>(null)

  // Collapsible Sections in Table
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    sales: false,
    prime_cost: false,
    gross_profit: false,
    opex: false,
    net_income: false,
    corporate: false,
    ebitda: false
  })

  // Data Loading State
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ConsolidatedData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Expenses Tab State
  const [storeExpensesList, setStoreExpensesList] = useState<any[]>([])
  const [sharedExpensesList, setSharedExpensesList] = useState<any[]>([])
  const [newSharedName, setNewSharedName] = useState('')
  const [newSharedAmount, setNewSharedAmount] = useState('')
  const [newSharedCategory, setNewSharedCategory] = useState('marketing')
  const [newSharedMethod, setNewSharedMethod] = useState<'even_split' | 'sales_weighted'>('even_split')
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null)

  // Period change handler
  const handlePeriodChange = (newPeriod: 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom') => {
    setPeriod(newPeriod)
    const now = new Date()
    let start = new Date()
    let end = new Date()

    if (newPeriod === 'this_week') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      start = new Date(now.setDate(diff))
      end = new Date()
    } else if (newPeriod === 'last_week') {
      const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7
      start = new Date(now.setDate(diff))
      end = new Date(start)
      end.setDate(start.getDate() + 6)
    } else if (newPeriod === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date()
    } else if (newPeriod === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end = new Date(now.getFullYear(), now.getMonth(), 0)
    }

    if (newPeriod !== 'custom') {
      setStartDate(start.toISOString().split('T')[0])
      setEndDate(end.toISOString().split('T')[0])
    }
  }

  // Fetch Consolidated PnL
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/pnl/consolidated?startDate=${startDate}&endDate=${endDate}&period=${period}&bodegaMode=${bodegaMode}`)
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`)
      }
      const json: ConsolidatedData = await res.json()
      setData(json)
    } catch (err: any) {
      console.error('Failed to load PnL:', err)
      setError(err.message || 'Error loading PnL statement')
    } finally {
      setLoading(false)
    }
  }

  // Fetch Expenses List
  const fetchExpenses = async () => {
    try {
      const res = await fetch('/api/pnl/expenses')
      if (res.ok) {
        const json = await res.json()
        setStoreExpensesList(json.storeExpenses || [])
        setSharedExpensesList(json.sharedExpenses || [])
      }
    } catch (err) {
      console.error('Failed to load expenses list:', err)
    }
  }

  useEffect(() => {
    fetchData()
  }, [startDate, endDate, bodegaMode])

  useEffect(() => {
    if (activeTab === 'expenses') {
      fetchExpenses()
    }
  }, [activeTab])

  const toggleSection = (sec: string) => {
    setCollapsedSections(prev => ({ ...prev, [sec]: !prev[sec] }))
  }

  // Handle Add Shared Expense (Meta Ads)
  const handleAddSharedExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSharedName || !newSharedAmount) return

    try {
      setIsSavingExpense(true)
      const res = await fetch('/api/pnl/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_shared_expense',
          expense_name: newSharedName,
          amount: parseFloat(newSharedAmount),
          category: newSharedCategory,
          allocation_method: newSharedMethod,
          period_start: startDate,
          period_end: endDate,
          notes: 'Added via PnL Dashboard'
        })
      })

      if (res.ok) {
        setNewSharedName('')
        setNewSharedAmount('')
        setSaveSuccessMsg(t('pnl.saved_success') || 'Guardado con éxito')
        setTimeout(() => setSaveSuccessMsg(null), 3000)
        fetchExpenses()
        fetchData()
      }
    } catch (err) {
      console.error('Failed to add shared expense:', err)
    } finally {
      setIsSavingExpense(false)
    }
  }

  // Handle Delete Shared Expense
  const handleDeleteSharedExpense = async (id: string) => {
    if (!confirm('¿Eliminar este gasto compartido?')) return
    try {
      const res = await fetch('/api/pnl/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_shared_expense', id })
      })
      if (res.ok) {
        fetchExpenses()
        fetchData()
      }
    } catch (err) {
      console.error('Failed to delete shared expense:', err)
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    if (!data) return
    const headers = ['Concepto', ...data.stores.map(s => s.name), 'Total Consolidado']
    const rows = [
      ['Gross Restaurant Sales', ...data.stores.map(s => s.gross_sales), data.consolidated.gross_sales],
      ['Comps & Discounts', ...data.stores.map(s => s.comps_discounts), data.consolidated.comps_discounts],
      ['Total Net Sales', ...data.stores.map(s => s.net_sales), data.consolidated.net_sales],
      ['Food Cost (COGS)', ...data.stores.map(s => s.food_cost), data.consolidated.food_cost],
      ['Salaries & Wages', ...data.stores.map(s => s.labor_wages), data.consolidated.labor_wages],
      ['Employee Benefits', ...data.stores.map(s => s.employee_benefits), data.consolidated.employee_benefits],
      ['Total Prime Cost', ...data.stores.map(s => s.total_prime_cost), data.consolidated.total_prime_cost],
      ['Prime Cost %', ...data.stores.map(s => s.prime_cost_pct + '%'), data.consolidated.prime_cost_pct + '%'],
      ['Gross Profit', ...data.stores.map(s => s.gross_profit), data.consolidated.gross_profit],
      ['Total Operating Expenses', ...data.stores.map(s => s.total_operating_expenses), data.consolidated.total_operating_expenses],
      ['Store Level Net Income', ...data.stores.map(s => s.store_net_income), data.consolidated.store_net_income],
      ['Corporate Overhead', ...data.stores.map(s => s.corporate_overhead), data.consolidated.corporate_overhead],
      ['EBITDA', ...data.stores.map(s => s.ebitda), data.consolidated.ebitda],
      ['Net Profit', ...data.stores.map(s => s.net_profit), data.consolidated.net_profit]
    ]

    const csvContent = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `Tacos_Gavilan_PnL_${startDate}_${endDate}_${bodegaMode}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8 transition-colors">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20">
              <BarChart3 className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                {t('pnl.title') || 'Estado de Resultados Multi-Sucursal'}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  R365 Parity
                </span>
              </h1>
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('pnl.subtitle') || 'Comparativo financiero lado a lado de las 15 sucursales de Tacos Gavilan y Total Consolidado'}
              </p>
            </div>
          </div>
        </div>

        {/* Top Actions: Export CSV and Print */}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('pnl.refresh') || 'Actualizar'}</span>
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
          >
            <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>{t('pnl.export_csv') || 'Exportar CSV'}</span>
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-red-700 hover:bg-red-800 text-white shadow-md transition-all"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t('pnl.print_report') || 'Imprimir'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('pnl')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
            activeTab === 'pnl'
              ? 'bg-red-700 text-white shadow-md'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>{t('pnl.tab_pnl') || '📊 Estado de Resultados (P&L)'}</span>
        </button>
        <button
          onClick={() => setActiveTab('expenses')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
            activeTab === 'expenses'
              ? 'bg-red-700 text-white shadow-md'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>{t('pnl.tab_expenses') || '⚙️ Gastos Fijos y Meta Ads'}</span>
        </button>
      </div>

      {/* TAB 1: P&L GRID */}
      {activeTab === 'pnl' && (
        <>
          {/* Controls Bar: Date Period & Bodega Intercompany Switch */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Period selector */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-black uppercase text-slate-400 mr-1">Período:</span>
              {(['this_week', 'last_week', 'this_month', 'last_month', 'custom'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => handlePeriodChange(p)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    period === p
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {t(`pnl.period_${p}`) || p}
                </button>
              ))}

              {/* Date pickers for custom */}
              <div className="flex items-center gap-1.5 ml-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setPeriod('custom'); setStartDate(e.target.value); }}
                  className="px-2 py-1 text-xs border rounded bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono"
                />
                <span className="text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setPeriod('custom'); setEndDate(e.target.value); }}
                  className="px-2 py-1 text-xs border rounded bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono"
                />
              </div>
            </div>

            {/* THE BODEGA INTERCOMPANY TOGGLE SWITCH */}
            <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setBodegaMode('store')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  bodegaMode === 'store'
                    ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-md border border-blue-500/20'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>{t('pnl.store_view') || '🏪 Vista Tiendas'}</span>
              </button>
              <button
                type="button"
                onClick={() => setBodegaMode('corporate')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  bodegaMode === 'corporate'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-md border border-amber-600'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Building className="w-3.5 h-3.5" />
                <span>{t('pnl.corp_view') || '🏢 Vista Corporativa'}</span>
              </button>
            </div>
          </div>

          {/* Mode explanation banner */}
          <div className={`mb-6 p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
            bodegaMode === 'corporate'
              ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200'
              : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/50 text-blue-900 dark:text-blue-200'
          }`}>
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>
              {bodegaMode === 'corporate'
                ? (t('pnl.corp_view_desc') || 'Vista Corporativa activa: Se eliminó el margen interno (~10%) de La Bodega para reflejar la utilidad consolidada real de Roberto Velázquez sin duplicidad de ingresos.')
                : (t('pnl.store_view_desc') || 'Vista Tiendas activa: Los insumos de carne y salsas se muestran al precio de transferencia que cobra La Bodega para evaluar con rigor la disciplina operativa de cada gerente.')}
            </span>
          </div>

          {/* Top KPI Cards */}
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('pnl.kpi_net_sales') || 'Ventas Netas Cadena'}</span>
                <span className="text-xl md:text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {formatCurrency(data.consolidated.net_sales)}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">15 Tiendas ({data.daysCount} días)</span>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('pnl.kpi_prime_cost') || 'Costo Primo (Prime)'}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
                    {formatCurrency(data.consolidated.total_prime_cost)}
                  </span>
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                    {formatPct(data.consolidated.prime_cost_pct)}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{t('pnl.kpi_prime_sub') || 'Comida + Nómina + Beneficios'}</span>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('pnl.kpi_gross_profit') || 'Utilidad Bruta'}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 font-mono">
                    {formatCurrency(data.consolidated.gross_profit)}
                  </span>
                  <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                    {formatPct(data.consolidated.gross_profit_pct)}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{t('pnl.kpi_gross_sub') || 'Ventas Netas - Costo Primo'}</span>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('pnl.kpi_ebitda') || 'EBITDA (Operativo)'}</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl md:text-2xl font-black font-mono ${data.consolidated.ebitda >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}`}>
                    {formatCurrency(data.consolidated.ebitda)}
                  </span>
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {formatPct(data.consolidated.ebitda_pct)}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{t('pnl.kpi_ebitda_sub') || 'Antes de Impuestos y Depreciación'}</span>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('pnl.kpi_net_profit') || 'Utilidad Neta Final'}</span>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl md:text-2xl font-black font-mono ${data.consolidated.net_profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}`}>
                    {formatCurrency(data.consolidated.net_profit)}
                  </span>
                  <span className="text-xs font-bold text-slate-500">
                    {formatPct(data.consolidated.net_profit_pct)}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{t('pnl.kpi_net_profit_sub') || 'Retorno Neto Corporativo'}</span>
              </div>
            </div>
          )}

          {/* MAIN SIDE-BY-SIDE MATRIX TABLE */}
          {loading ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 flex flex-col items-center justify-center">
              <SurpriseLoader />
              <p className="text-sm font-semibold text-slate-500 mt-4">Calculando Estado de Resultados Multi-Sucursal...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-6 rounded-xl text-center text-red-700 dark:text-red-300">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
              <p className="font-bold">{error}</p>
              <button onClick={fetchData} className="mt-3 px-4 py-1.5 text-xs bg-red-700 text-white rounded-lg">Reintentar</button>
            </div>
          ) : data ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  {/* Table Head: Store Names */}
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700">
                      <th className="p-3 sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 min-w-[220px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700">
                        {t('pnl.concept_header') || 'Concepto Financiero'}
                      </th>
                      {data.stores.map(s => (
                        <th
                          key={s.id}
                          onClick={() => setSelectedStoreDetail(s)}
                          className="p-3 min-w-[150px] text-right font-black uppercase text-slate-800 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/50 cursor-pointer transition-colors border-r border-slate-200 dark:border-slate-700"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>{s.name}</span>
                            <Eye className="w-3 h-3 text-slate-400 opacity-60" />
                          </div>
                        </th>
                      ))}
                      {/* Consolidated Total Column */}
                      <th className="p-3 min-w-[170px] text-right font-black uppercase bg-amber-500/15 text-amber-900 dark:text-amber-200 border-l-2 border-amber-500">
                        {t('pnl.consolidated_total') || 'Total Consolidado'}
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {/* SECTION 1: SALES */}
                    <tr
                      onClick={() => toggleSection('sales')}
                      className="bg-slate-50/80 dark:bg-slate-800/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-200 dark:border-slate-800"
                    >
                      <td colSpan={data.stores.length + 2} className="p-2.5 font-black uppercase text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        {collapsedSections.sales ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        <span>{t('pnl.sales_section') || 'Ventas (Sales)'}</span>
                      </td>
                    </tr>

                    {!collapsedSections.sales && (
                      <>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.gross_sales') || 'Gross Restaurant Sales'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.gross_sales)}</div>
                              <div className="text-[10px] text-slate-400">{safePct(s.gross_sales, s.net_sales)}%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.gross_sales)}</div>
                            <div className="text-[10px] text-slate-400">{safePct(data.consolidated.gross_sales, data.consolidated.net_sales)}%</div>
                          </td>
                        </tr>

                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.discounts') || 'Comps & Discounts'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400 border-r border-slate-200 dark:border-slate-700/60">
                              <div>-{formatCurrency(s.comps_discounts)}</div>
                              <div className="text-[10px] opacity-70">-{safePct(s.comps_discounts, s.net_sales)}%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400 bg-amber-500/5 border-l-2 border-amber-500">
                            <div>-{formatCurrency(data.consolidated.comps_discounts)}</div>
                            <div className="text-[10px] opacity-70">-{safePct(data.consolidated.comps_discounts, data.consolidated.net_sales)}%</div>
                          </td>
                        </tr>

                        {/* Net Sales Line */}
                        <tr className="border-b-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 font-bold">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.net_sales') || 'Total Net Sales'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.net_sales)}</div>
                              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black">100.0%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-black text-slate-900 dark:text-white bg-amber-500/10 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.net_sales)}</div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-black">100.0%</div>
                          </td>
                        </tr>
                      </>
                    )}

                    {/* SECTION 2: PRIME COST */}
                    <tr
                      onClick={() => toggleSection('prime_cost')}
                      className="bg-slate-50/80 dark:bg-slate-800/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-200 dark:border-slate-800"
                    >
                      <td colSpan={data.stores.length + 2} className="p-2.5 font-black uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        {collapsedSections.prime_cost ? <ChevronRight className="w-4 h-4 text-amber-500" /> : <ChevronDown className="w-4 h-4 text-amber-500" />}
                        <span>{t('pnl.prime_cost_section') || 'Costo Primo (Prime Cost)'}</span>
                      </td>
                    </tr>

                    {!collapsedSections.prime_cost && (
                      <>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.food_cost') || 'Cost of Goods Sold (COGS)'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.food_cost)}</div>
                              <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">{formatPct(s.food_cost_pct)}</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.food_cost)}</div>
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">{formatPct(data.consolidated.food_cost_pct)}</div>
                          </td>
                        </tr>

                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.labor_wages') || 'Salaries and Wages'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.labor_wages)}</div>
                              <div className="text-[10px] text-slate-500">{formatPct(s.labor_wages_pct)}</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.labor_wages)}</div>
                            <div className="text-[10px] text-slate-500">{formatPct(data.consolidated.labor_wages_pct)}</div>
                          </td>
                        </tr>

                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.benefits') || 'Employee Benefits (12%)'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.employee_benefits)}</div>
                              <div className="text-[10px] text-slate-400">{formatPct(s.employee_benefits_pct)}</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.employee_benefits)}</div>
                            <div className="text-[10px] text-slate-400">{formatPct(data.consolidated.employee_benefits_pct)}</div>
                          </td>
                        </tr>

                        {/* Total Prime Cost Line (Golden Highlight) */}
                        <tr className="border-b-2 border-amber-400/40 bg-amber-500/10 font-bold">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-amber-500/15 text-amber-950 dark:text-amber-200 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.total_prime_cost') || 'Total Prime Cost'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums text-amber-900 dark:text-amber-300 border-r border-slate-200 dark:border-slate-700/60">
                              <div className="font-black">{formatCurrency(s.total_prime_cost)}</div>
                              <div className="text-[10px] font-black">{formatPct(s.prime_cost_pct)}</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-black text-amber-950 dark:text-amber-200 bg-amber-500/25 border-l-2 border-amber-600">
                            <div className="text-sm">{formatCurrency(data.consolidated.total_prime_cost)}</div>
                            <div className="text-xs font-black">{formatPct(data.consolidated.prime_cost_pct)}</div>
                          </td>
                        </tr>
                      </>
                    )}

                    {/* SECTION 3: GROSS PROFIT */}
                    <tr className="border-b-2 border-slate-300 dark:border-slate-700 bg-blue-50/40 dark:bg-blue-950/20 font-bold">
                      <td className="p-2.5 sticky left-0 z-10 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 border-r border-slate-200 dark:border-slate-700 uppercase">
                        {t('pnl.gross_profit') || 'Gross Profit (Utilidad Bruta)'}
                      </td>
                      {data.stores.map(s => (
                        <td key={s.id} className="p-2.5 text-right font-mono tabular-nums text-blue-900 dark:text-blue-300 border-r border-slate-200 dark:border-slate-700/60">
                          <div className="font-black">{formatCurrency(s.gross_profit)}</div>
                          <div className="text-[10px] font-bold">{formatPct(s.gross_profit_pct)}</div>
                        </td>
                      ))}
                      <td className="p-2.5 text-right font-mono tabular-nums font-black text-blue-950 dark:text-blue-200 bg-blue-500/20 border-l-2 border-amber-500">
                        <div className="text-sm">{formatCurrency(data.consolidated.gross_profit)}</div>
                        <div className="text-xs font-black">{formatPct(data.consolidated.gross_profit_pct)}</div>
                      </td>
                    </tr>

                    {/* SECTION 4: OPERATING EXPENSES (OpEx) */}
                    <tr
                      onClick={() => toggleSection('opex')}
                      className="bg-slate-50/80 dark:bg-slate-800/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-200 dark:border-slate-800"
                    >
                      <td colSpan={data.stores.length + 2} className="p-2.5 font-black uppercase text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        {collapsedSections.opex ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        <span>{t('pnl.opex_section') || 'Gastos Operativos (Operating Expenses)'}</span>
                      </td>
                    </tr>

                    {!collapsedSections.opex && (
                      <>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.rent') || 'Rent & Occupancy'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.rent + s.cam_charges)}</div>
                              <div className="text-[10px] text-slate-400">{safePct(s.rent + s.cam_charges, s.net_sales)}%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.rent + data.consolidated.cam_charges)}</div>
                            <div className="text-[10px] text-slate-400">{safePct(data.consolidated.rent + data.consolidated.cam_charges, data.consolidated.net_sales)}%</div>
                          </td>
                        </tr>

                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.utilities') || 'Utilities (Luz, Gas, Agua)'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.utilities)}</div>
                              <div className="text-[10px] text-slate-400">{safePct(s.utilities, s.net_sales)}%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.utilities)}</div>
                            <div className="text-[10px] text-slate-400">{safePct(data.consolidated.utilities, data.consolidated.net_sales)}%</div>
                          </td>
                        </tr>

                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.repairs') || 'Repairs & Maintenance (R&M)'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.repairs_maintenance)}</div>
                              <div className="text-[10px] text-slate-400">{safePct(s.repairs_maintenance, s.net_sales)}%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.repairs_maintenance)}</div>
                            <div className="text-[10px] text-slate-400">{safePct(data.consolidated.repairs_maintenance, data.consolidated.net_sales)}%</div>
                          </td>
                        </tr>

                        <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.supplies') || 'Supplies (Viele & Sons)'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.supplies_misc)}</div>
                              <div className="text-[10px] text-slate-400">{safePct(s.supplies_misc, s.net_sales)}%</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.supplies_misc)}</div>
                            <div className="text-[10px] text-slate-400">{safePct(data.consolidated.supplies_misc, data.consolidated.net_sales)}%</div>
                          </td>
                        </tr>

                        {/* Total Operating Expense Line */}
                        <tr className="border-b-2 border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/40 font-bold">
                          <td className="p-2.5 pl-6 sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700">
                            {t('pnl.total_opex') || 'Total Operating Expenses'}
                          </td>
                          {data.stores.map(s => (
                            <td key={s.id} className="p-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700/60">
                              <div>{formatCurrency(s.total_operating_expenses)}</div>
                              <div className="text-[10px] font-bold">{formatPct(s.operating_expenses_pct)}</div>
                            </td>
                          ))}
                          <td className="p-2.5 text-right font-mono tabular-nums font-black text-slate-900 dark:text-white bg-amber-500/10 border-l-2 border-amber-500">
                            <div>{formatCurrency(data.consolidated.total_operating_expenses)}</div>
                            <div className="text-[10px] font-bold">{formatPct(data.consolidated.operating_expenses_pct)}</div>
                          </td>
                        </tr>
                      </>
                    )}

                    {/* SECTION 5: STORE LEVEL NET INCOME */}
                    <tr className="border-b-2 border-slate-300 dark:border-slate-700 bg-emerald-50/30 dark:bg-emerald-950/20 font-bold">
                      <td className="p-2.5 sticky left-0 z-10 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border-r border-slate-200 dark:border-slate-700 uppercase">
                        {t('pnl.store_net_income') || 'Store Level Net Income'}
                      </td>
                      {data.stores.map(s => (
                        <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                          <div className={`font-black ${s.store_net_income >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>
                            {formatCurrency(s.store_net_income)}
                          </div>
                          <div className="text-[10px] font-bold">{formatPct(s.store_net_income_pct)}</div>
                        </td>
                      ))}
                      <td className="p-2.5 text-right font-mono tabular-nums font-black bg-emerald-500/20 border-l-2 border-amber-500 text-emerald-900 dark:text-emerald-100">
                        <div className="text-sm">{formatCurrency(data.consolidated.store_net_income)}</div>
                        <div className="text-xs font-black">{formatPct(data.consolidated.store_net_income_pct)}</div>
                      </td>
                    </tr>

                    {/* SECTION 6: CORPORATE OVERHEAD (META ADS) */}
                    <tr className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <td className="p-2.5 sticky left-0 z-10 bg-white dark:bg-slate-900 font-medium text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                        <span>{t('pnl.corporate_overhead') || 'Corporate Overhead (Meta Ads)'}</span>
                      </td>
                      {data.stores.map(s => (
                        <td key={s.id} className="p-2.5 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60 text-purple-700 dark:text-purple-300">
                          <div>{formatCurrency(s.corporate_overhead)}</div>
                          <div className="text-[10px] opacity-70">{formatPct(s.corporate_overhead_pct)}</div>
                        </td>
                      ))}
                      <td className="p-2.5 text-right font-mono tabular-nums font-bold bg-amber-500/5 border-l-2 border-amber-500 text-purple-700 dark:text-purple-300">
                        <div>{formatCurrency(data.consolidated.corporate_overhead)}</div>
                        <div className="text-[10px] opacity-70">{formatPct(data.consolidated.corporate_overhead_pct)}</div>
                      </td>
                    </tr>

                    {/* SECTION 7: EBITDA (OPERATIONAL CASH FLOW) */}
                    <tr className="border-b-2 border-emerald-500 bg-emerald-500/10 font-bold">
                      <td className="p-3 sticky left-0 z-10 bg-emerald-600 text-white font-black uppercase tracking-wider border-r border-slate-200 dark:border-slate-700">
                        {t('pnl.ebitda') || 'EBITDA (Flujo Operativo)'}
                      </td>
                      {data.stores.map(s => (
                        <td key={s.id} className="p-3 text-right font-mono tabular-nums border-r border-slate-200 dark:border-slate-700/60">
                          <div className={`font-black text-sm ${s.ebitda >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600'}`}>
                            {formatCurrency(s.ebitda)}
                          </div>
                          <div className="text-xs font-black">{formatPct(s.ebitda_pct)}</div>
                        </td>
                      ))}
                      <td className="p-3 text-right font-mono tabular-nums font-black bg-emerald-600 text-white border-l-2 border-amber-600">
                        <div className="text-base">{formatCurrency(data.consolidated.ebitda)}</div>
                        <div className="text-xs">{formatPct(data.consolidated.ebitda_pct)}</div>
                      </td>
                    </tr>

                    {/* SECTION 8: FINAL NET PROFIT */}
                    <tr className="bg-slate-900 text-white font-black border-t-2 border-slate-700">
                      <td className="p-3 sticky left-0 z-10 bg-slate-900 text-white uppercase tracking-wider border-r border-slate-700">
                        {t('pnl.net_profit') || 'Utilidad Neta Final'}
                      </td>
                      {data.stores.map(s => (
                        <td key={s.id} className="p-3 text-right font-mono tabular-nums border-r border-slate-800">
                          <div className={`text-sm ${s.net_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCurrency(s.net_profit)}
                          </div>
                          <div className="text-xs font-normal opacity-80">{formatPct(s.net_profit_pct)}</div>
                        </td>
                      ))}
                      <td className="p-3 text-right font-mono tabular-nums font-black bg-amber-500 text-slate-950 border-l-2 border-amber-600">
                        <div className="text-base">{formatCurrency(data.consolidated.net_profit)}</div>
                        <div className="text-xs font-black">{formatPct(data.consolidated.net_profit_pct)}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* TAB 2: EXPENSES AND META ADS CONFIGURATION */}
      {activeTab === 'expenses' && (
        <div className="space-y-8">
          {/* Card 1: Add Shared Brand Expense (Meta Ads) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <span>{t('pnl.add_shared_expense') || 'Agregar Gasto Compartido (Meta Ads / Corporativo)'}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
              Replicación de Journal Entry Distribution de R365: Ingresa una factura central de publicidad o supervisión y el sistema la prorratea automáticamente entre las 15 tiendas.
            </p>

            {saveSuccessMsg && (
              <div className="mb-4 p-3 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-lg text-xs font-bold border border-emerald-300">
                ✓ {saveSuccessMsg}
              </div>
            )}

            <form onSubmit={handleAddSharedExpense} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                  {t('pnl.shared_expense_name') || 'Concepto del Gasto'}
                </label>
                <input
                  type="text"
                  placeholder="ej. Meta Ads Instagram Septiembre"
                  value={newSharedName}
                  onChange={e => setNewSharedName(e.target.value)}
                  className="w-full p-2.5 text-sm border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                  {t('pnl.shared_amount') || 'Monto ($ USD)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="ej. 3000.00"
                  value={newSharedAmount}
                  onChange={e => setNewSharedAmount(e.target.value)}
                  className="w-full p-2.5 text-sm border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                  {t('pnl.allocation_method') || 'Método de Prorrateo'}
                </label>
                <select
                  value={newSharedMethod}
                  onChange={e => setNewSharedMethod(e.target.value as any)}
                  className="w-full p-2.5 text-sm border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                >
                  <option value="even_split">{t('pnl.even_split') || 'Partes Iguales (1/15 por tienda)'}</option>
                  <option value="sales_weighted">{t('pnl.sales_weighted') || 'Prorrateado por Ventas Netas'}</option>
                </select>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={isSavingExpense}
                  className="w-full py-2.5 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isSavingExpense ? 'Guardando...' : 'Guardar y Prorratear'}</span>
                </button>
              </div>
            </form>

            {/* List of active shared expenses */}
            <div className="mt-8">
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Gastos Compartidos Vigentes</h3>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="p-3">Concepto</th>
                      <th className="p-3">Categoría</th>
                      <th className="p-3 text-right">Monto</th>
                      <th className="p-3">Método</th>
                      <th className="p-3">Vigencia</th>
                      <th className="p-3 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sharedExpensesList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400">No hay gastos compartidos registrados.</td>
                      </tr>
                    ) : (
                      sharedExpensesList.map(sh => (
                        <tr key={sh.id} className="border-b border-slate-100 dark:border-slate-800/40">
                          <td className="p-3 font-bold text-slate-900 dark:text-white">{sh.expense_name}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 font-semibold">
                              {sh.category}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-black">{formatCurrency(sh.amount)}</td>
                          <td className="p-3">{sh.allocation_method === 'sales_weighted' ? 'Proporcional Ventas' : 'Partes Iguales'}</td>
                          <td className="p-3 text-slate-400">{sh.period_start} a {sh.period_end}</td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleDeleteSharedExpense(sh.id)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Card 2: Store Fixed Operating Expenses Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 mb-2">
              <Building className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>Gastos Fijos Mensuales por Sucursal (Renta, Luz, Servicios)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
              Valores base mensuales utilizados para calcular el OpEx prorrateado de cada restaurante en el P&L.
            </p>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="p-3">Sucursal</th>
                    <th className="p-3 text-right">Renta</th>
                    <th className="p-3 text-right">CAM / Plaza</th>
                    <th className="p-3 text-right">Servicios (Luz/Gas)</th>
                    <th className="p-3 text-right">Mantenimiento</th>
                    <th className="p-3 text-right">Insumos Misc</th>
                    <th className="p-3 text-right">Seguro</th>
                    <th className="p-3 text-right">Total Fijo Mes</th>
                  </tr>
                </thead>
                <tbody>
                  {storeExpensesList.map(se => {
                    const totalMonth = (Number(se.rent_monthly) || 0) +
                      (Number(se.cam_charges) || 0) +
                      (Number(se.utilities_monthly) || 0) +
                      (Number(se.repairs_maintenance_monthly) || 0) +
                      (Number(se.supplies_misc_monthly) || 0) +
                      (Number(se.insurance_monthly) || 0)

                    return (
                      <tr key={se.id} className="border-b border-slate-100 dark:border-slate-800/40 hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-slate-900 dark:text-white">{se.store_name}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(se.rent_monthly)}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(se.cam_charges)}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(se.utilities_monthly)}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(se.repairs_maintenance_monthly)}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(se.supplies_misc_monthly)}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(se.insurance_monthly)}</td>
                        <td className="p-3 text-right font-mono font-black text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/30">
                          {formatCurrency(totalMonth)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Drilldown for Selected Store */}
      {selectedStoreDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Store className="w-5 h-5 text-amber-500" />
                  <span>{selectedStoreDetail.name}</span>
                </h3>
                <p className="text-xs text-slate-400">Desglose de Operaciones y Rentabilidad</p>
              </div>
              <button
                onClick={() => setSelectedStoreDetail(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Ventas Netas:</span>
                <span className="font-mono font-bold">{formatCurrency(selectedStoreDetail.net_sales)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Costo de Comida ({bodegaMode === 'corporate' ? 'Sin Margen Bodega' : 'Con Margen Bodega'}):</span>
                <span className="font-mono font-bold text-amber-600">{formatCurrency(selectedStoreDetail.food_cost)} ({formatPct(selectedStoreDetail.food_cost_pct)})</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Mano de Obra (Wages + 12% Beneficios):</span>
                <span className="font-mono font-bold">{formatCurrency(selectedStoreDetail.labor_wages + selectedStoreDetail.employee_benefits)} ({formatPct(selectedStoreDetail.labor_wages_pct + selectedStoreDetail.employee_benefits_pct)})</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 bg-amber-500/10 p-2 rounded">
                <span className="font-bold text-amber-900 dark:text-amber-200">Total Costo Primo:</span>
                <span className="font-mono font-black text-amber-900 dark:text-amber-200">{formatCurrency(selectedStoreDetail.total_prime_cost)} ({formatPct(selectedStoreDetail.prime_cost_pct)})</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Gastos de Operación Prorrateados:</span>
                <span className="font-mono font-bold">{formatCurrency(selectedStoreDetail.total_operating_expenses)} ({formatPct(selectedStoreDetail.operating_expenses_pct)})</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Overhead Asignado (Meta Ads):</span>
                <span className="font-mono font-bold text-purple-600">{formatCurrency(selectedStoreDetail.corporate_overhead)}</span>
              </div>
              <div className="flex justify-between py-2 border-t-2 border-slate-300 dark:border-slate-700 pt-3">
                <span className="font-bold text-sm">EBITDA Sucursal:</span>
                <span className={`font-mono font-black text-sm ${selectedStoreDetail.ebitda >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {formatCurrency(selectedStoreDetail.ebitda)} ({formatPct(selectedStoreDetail.ebitda_pct)})
                </span>
              </div>
            </div>

            <button
              onClick={() => setSelectedStoreDetail(null)}
              className="mt-6 w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-xs"
            >
              Cerrar Desglose
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        @media print {
          @page { size: landscape; margin: 0.3in; }
          nav, aside, .no-print, header { display: none !important; }
          body { font-size: 9px !important; }
          table { font-size: 8px !important; }
          td, th { padding: 2px 4px !important; }
        }
      `}</style>
    </div>
  )
}
