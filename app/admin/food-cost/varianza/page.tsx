/**
 * @module admin/food-cost/varianza/page
 * @description Actual vs. Theoretical (AvT) food variance table, ranking
 * ingredients primarily by financial loss in dollars ($ Loss).
 * Replicates the Monterey Jack Cheese audit screen shown in Restaurant365 (frame_061.jpg).
 * 
 * @businessRules
 * - Theoretical Usage: Sourced from Toast POS menu sales mapped to recipe portion weights.
 * - Actual Usage: Sourced from starting stock + warehouse deliveries - ending leftover counts.
 * - Dollar Loss ($ Loss): Variance Quantity * Unit Purchase Price.
 * - Sorted primarily by Dollar Loss descending to immediately surface the largest cost leaks.
 * - Integrated seamlessly into FoodCostNavigationTabs as Tab 4.
 * 
 * @dataFlow
 * Calls `GET /api/food-cost/variance-avt?storeId=...&startDate=...&endDate=...&category=...`
 * 
 * @notes
 * - Solves the exact gap identified by Carlos and Erick during Eddy Salas's R365 presentation.
 */

'use client'

import React, { useState, useEffect } from 'react'
import {
  Scale, RefreshCw, AlertTriangle, CheckCircle2, TrendingDown,
  DollarSign, ArrowUpDown, Filter, Info, ChevronRight, Store, Download
} from 'lucide-react'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'

interface AvTItem {
  id: string
  name: string
  category: 'Meat' | 'Dairy' | 'Produce' | 'Grocery' | 'Packaging'
  unit_measure: string
  unit_cost: number
  actual_qty: number
  theoretical_qty: number
  variance_qty: number
  waste_qty: number
  unexplained_variance: number
  efficiency_pct: number
  actual_dollar: number
  theoretical_dollar: number
  dollar_loss: number
  status: 'critical' | 'warning' | 'normal' | 'efficient'
}

interface AvTResponse {
  storeId: string
  startDate: string
  endDate: string
  totalNetSales: number
  totalTheoreticalDollar: number
  totalActualDollar: number
  totalDollarLoss: number
  overallEfficiencyPct: number
  itemsCount: number
  items: AvTItem[]
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val || 0)
}

export default function AvTVariancePage() {
  const { t, language } = useLanguage()

  // Filter state
  const [storeId, setStoreId] = useState<string>('all')
  const [stores, setStores] = useState<{ id: string; name: string; external_id: string }[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const mon = new Date(d.setDate(diff))
    return mon.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState<string>(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })

  // Data state
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AvTResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch store list
  useEffect(() => {
    fetch('/api/stores')
      .then(res => res.json())
      .then(json => {
        if (Array.isArray(json)) setStores(json)
      })
      .catch(err => console.error('Failed to load stores:', err))
  }, [])

  // Fetch AvT Data
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/food-cost/variance-avt?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}&category=${categoryFilter}`)
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`)
      const json: AvTResponse = await res.json()
      setData(json)
    } catch (err: any) {
      console.error('Failed to load AvT:', err)
      setError(err.message || 'Error loading AvT data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [storeId, startDate, endDate, categoryFilter])

  // Export CSV
  const handleExportCSV = () => {
    if (!data || !data.items) return
    const headers = ['Ingrediente', 'Categoría', 'Unidad', 'Costo Unitario', 'Consumo Teórico', 'Consumo Real', 'Varianza (Lbs)', 'Eficiencia %', 'Pérdida en Dólares ($ Loss)', 'Estado']
    const rows = data.items.map(i => [
      `"${i.name}"`,
      i.category,
      i.unit_measure,
      i.unit_cost,
      i.theoretical_qty,
      i.actual_qty,
      i.variance_qty,
      i.efficiency_pct + '%',
      i.dollar_loss,
      i.status
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `AvT_Varianza_Tacos_Gavilan_${startDate}_${endDate}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8 transition-colors">
      
      {/* Universal Top Navigation Tabs */}
      <FoodCostNavigationTabs />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20">
              <Scale className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                {t('avt.title') || 'Varianza Real vs. Teórica (AvT)'}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                  R365 Benchmark
                </span>
              </h1>
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('avt.subtitle') || 'Auditoría de porcionamiento y mermas ordenada por mayor pérdida económica en dólares ($ Loss)'}
              </p>
            </div>
          </div>
        </div>

        {/* Top actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('avt.refresh') || 'Actualizar'}</span>
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!data}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span>{t('avt.export_csv') || 'Exportar CSV'}</span>
          </button>
        </div>
      </div>

      {/* R365 Methodology Tip */}
      <div className="mb-6 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl text-xs flex items-center gap-2.5 text-amber-900 dark:text-amber-200">
        <Info className="w-4 h-4 flex-shrink-0 text-amber-600" />
        <span>
          {t('avt.tip_r365') || '💡 Criterio R365: Esta tabla ordena de mayor a menor pérdida de dinero para detectar inmediatamente dónde se fuga la ganancia de la tienda.'}
        </span>
      </div>

      {/* Filter Controls Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Store Selector */}
          <div className="flex items-center gap-1.5">
            <Store className="w-4 h-4 text-slate-400" />
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 outline-none"
            >
              <option value="all">{t('avt.all_stores') || 'Todas las Sucursales (Consolidado)'}</option>
              {stores.map(s => (
                <option key={s.id} value={s.external_id || s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-2.5 py-1 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono"
            />
            <span className="text-slate-400 text-xs">→</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-2.5 py-1 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono"
            />
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: t('avt.cat_all') || 'Todas' },
            { id: 'Meat', label: t('avt.cat_meat') || '🥩 Carnes' },
            { id: 'Dairy', label: t('avt.cat_dairy') || '🧀 Lácteos' },
            { id: 'Grocery', label: t('avt.cat_grocery') || '🌾 Abarrotes' },
            { id: 'Produce', label: t('avt.cat_produce') || '🥑 Verduras' }
          ].map(c => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                categoryFilter === c.id
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('avt.summary_theo_dollar') || 'Costo Teórico Total'}</span>
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
              {formatCurrency(data.totalTheoreticalDollar)}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">{t('avt.summary_theo_sub') || 'Según recetas vendidas en Toast'}</span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('avt.summary_actl_dollar') || 'Costo Real Gastado'}</span>
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
              {formatCurrency(data.totalActualDollar)}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">{t('avt.summary_actl_sub') || 'Inventario físico y entregas'}</span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-rose-500 block tracking-wider">{t('avt.summary_dollar_loss') || 'Fuga en Dinero ($ Loss)'}</span>
            <span className="text-xl font-black text-rose-600 dark:text-rose-400 font-mono">
              +{formatCurrency(data.totalDollarLoss)}
            </span>
            <span className="text-[10px] text-rose-500 block mt-0.5">{t('avt.summary_loss_sub') || 'Merma y desvío de porciones'}</span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">{t('avt.summary_efficiency') || 'Eficiencia de Porciones'}</span>
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              {data.overallEfficiencyPct}%
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">{t('avt.summary_efficiency_sub') || 'Meta ideal: 95% - 100%'}</span>
          </div>
        </div>
      )}

      {/* Main AvT Table */}
      {loading ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 flex flex-col items-center justify-center">
          <SurpriseLoader />
          <p className="text-sm font-semibold text-slate-500 mt-4">{t('avt.loading') || 'Calculando Varianza Real vs. Teórica...'}</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-6 rounded-xl text-center text-red-700 dark:text-red-300">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p className="font-bold">{error}</p>
        </div>
      ) : data ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 uppercase font-black">
                  <th className="p-3">{t('avt.th_item') || 'Ingrediente / Insumo'}</th>
                  <th className="p-3">{t('avt.th_category') || 'Categoría'}</th>
                  <th className="p-3 text-center">{t('avt.th_unit') || 'Unidad'}</th>
                  <th className="p-3 text-right">{t('avt.th_cost') || 'Costo Unit.'}</th>
                  <th className="p-3 text-right">{t('avt.th_theo_qty') || 'Consumo Teórico (Toast)'}</th>
                  <th className="p-3 text-right">{t('avt.th_actl_qty') || 'Consumo Real (Físico)'}</th>
                  <th className="p-3 text-right">{t('avt.th_variance_qty') || 'Varianza (Lbs)'}</th>
                  <th className="p-3 text-center">{t('avt.th_efficiency') || 'Eficiencia %'}</th>
                  <th className="p-3 text-right bg-rose-500/10 text-rose-800 dark:text-rose-200 border-l-2 border-rose-500">
                    {t('avt.th_dollar_loss') || 'Pérdida en $ ($ Loss)'}
                  </th>
                  <th className="p-3 text-center">{t('avt.th_status') || 'Diagnóstico'}</th>
                </tr>
              </thead>

              <tbody>
                {data.items.map((item, idx) => (
                  <tr
                    key={item.id || idx}
                    className={`border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors ${
                      item.status === 'critical' ? 'bg-rose-50/30 dark:bg-rose-950/10' : ''
                    }`}
                  >
                    <td className="p-3 font-bold text-slate-900 dark:text-white">
                      {item.name}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.category === 'Meat' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
                        item.category === 'Dairy' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                        item.category === 'Produce' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                        'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        {item.category}
                      </span>
                    </td>
                    <td className="p-3 text-center font-mono text-slate-500">{item.unit_measure}</td>
                    <td className="p-3 text-right font-mono font-medium">{formatCurrency(item.unit_cost)}</td>
                    <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {item.theoretical_qty.toLocaleString()} {item.unit_measure}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {item.actual_qty.toLocaleString()} {item.unit_measure}
                    </td>
                    <td className="p-3 text-right font-mono font-bold">
                      <span className={item.variance_qty > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                        {item.variance_qty > 0 ? `+${item.variance_qty.toLocaleString()}` : item.variance_qty.toLocaleString()} {item.unit_measure}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-12 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              item.efficiency_pct < 85 ? 'bg-rose-500' :
                              item.efficiency_pct < 95 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, item.efficiency_pct)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] font-bold">{item.efficiency_pct}%</span>
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-black text-sm bg-rose-500/10 border-l-2 border-rose-500">
                      <span className={item.dollar_loss > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                        {item.dollar_loss > 0 ? `+${formatCurrency(item.dollar_loss)}` : formatCurrency(item.dollar_loss)}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {item.status === 'critical' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{t('avt.status_critical') || 'Desperdicio Alto'}</span>
                        </span>
                      )}
                      {item.status === 'warning' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300">
                          <span>{t('avt.status_warning') || 'Revisar Porción'}</span>
                        </span>
                      )}
                      {item.status === 'efficient' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{t('avt.status_efficient') || 'Óptimo'}</span>
                        </span>
                      )}
                      {item.status === 'normal' && (
                        <span className="text-[10px] text-slate-400">{t('avt.status_normal') || 'Normal'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
