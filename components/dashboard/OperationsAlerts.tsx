/**
 * @module components/dashboard/OperationsAlerts
 * @description Centro de Alertas Operativas para el Dashboard Ejecutivo.
 *   Visualiza en tiempo real alertas de Labor Cost (>21.5%), Food Cost (>32%),
 *   caídas de ventas por sucursal (>=15% vs período anterior) y cumplimiento de inspecciones de supervisores.
 * @businessRules
 * - Auto-refresca cada 30 segundos en segundo plano sin parpadear la interfaz.
 * - Cancela peticiones en vuelo con AbortController cuando el usuario cambia el rango de fechas.
 * - Cada tarjeta de tienda o supervisor navega directamente al módulo correspondiente preservando fechas y filtros.
 * @dataFlow
 * - Props (startDate, endDate) -> GET /api/dashboard/alerts -> Renderizado de tarjetas y desglose expandible.
 * @notes
 * - Soporta Español e Inglés mediante useLanguage() (lib/i18n.tsx).
 */
'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, TrendingDown, Users, ChefHat, Shield,
  CheckCircle2, XCircle, Flame, Eye
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface DailyDetail {
  date: string
  wasScheduled: boolean
  scheduledAt: string | null
  shift: string | null
  inspectedStores: string[]
  ownedStoresInspected: string[]
  ownedStoresMissing: string[]
  compliant: boolean
}

interface AlertsData {
  totalAlerts: number
  laborAlerts: { store: string; storeId?: string; pct: number; sales: number; labor: number; severity: string }[]
  foodCostAlerts: { store: string; storeId?: string; pct: number; sales: number; cost: number; severity: string }[]
  lowSalesAlerts: { store: string; storeId?: string; sales: number; previousSales: number; pctChange: number; prevPeriodLabel: string }[]
  inspectionCompliance: {
    supervisor: string; supervisorFull: string; supervisorId?: number;
    ownedStores: string[]; scheduledStores: string[];
    inspectedStores: string[]; missingStores: string[]; extraStores: string[];
    totalScheduled: number; totalInspected: number; totalInspections: number;
    compliant: boolean; compliancePct: number;
    dailyDetail: DailyDetail[]
  }[]
  targets: { labor: number; laborCritical: number; foodCost: number; foodCostCritical: number }
}

interface Props {
  startDate: string
  endDate: string
}

export default function OperationsAlerts({ startDate, endDate }: Props) {
  const router = useRouter()
  const { t, language } = useLanguage()
  const [data, setData] = useState<AlertsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const fetchAlerts = async (signal: AbortSignal, isBackground = false) => {
      if (!isBackground) setLoading(true)
      try {
        const res = await fetch(`/api/dashboard/alerts?startDate=${startDate}&endDate=${endDate}`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!signal.aborted) {
          setData(json)
          setLoading(false)
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        console.error('Failed to fetch alerts:', err)
        if (!isBackground) setLoading(false)
      }
    }

    fetchAlerts(controller.signal, false)

    const interval = setInterval(() => {
      const refreshController = new AbortController()
      abortRef.current = refreshController
      fetchAlerts(refreshController.signal, true)
    }, 30000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [startDate, endDate])

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 animate-pulse shadow-sm">
        <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-48 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!data) return null

  const hasLaborAlerts = data.laborAlerts.length > 0
  const hasFoodCostAlerts = data.foodCostAlerts.length > 0
  const hasLowSales = data.lowSalesAlerts.length > 0
  const nonCompliant = data.inspectionCompliance.filter(s => !s.compliant)
  const hasInspectionAlerts = nonCompliant.length > 0

  const criticalCount =
    data.laborAlerts.filter(a => a.severity === 'critical').length +
    data.foodCostAlerts.filter(a => a.severity === 'critical').length
  const overallSeverity = criticalCount > 0 ? 'critical' : data.totalAlerts > 0 ? 'warning' : 'ok'

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden ${
      overallSeverity === 'critical'
        ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/40'
        : overallSeverity === 'warning'
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/30'
          : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/30'
    }`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
            overallSeverity === 'critical' ? 'bg-red-500 animate-pulse' :
            overallSeverity === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
          }`}>
            {overallSeverity === 'ok'
              ? <CheckCircle2 size={20} className="text-white" />
              : <AlertTriangle size={20} className="text-white" />
            }
          </div>
          <div>
            <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">
              {overallSeverity === 'ok' ? t('dashboard.alerts_stable') : t('dashboard.alerts_center')}
            </h3>
            <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-widest">
              {data.totalAlerts} {data.totalAlerts === 1 ? t('dashboard.alerts_active_single') : t('dashboard.alerts_active_plural')}
            </p>
          </div>
        </div>
        {data.totalAlerts > 0 && (
          <span className={`text-xs font-black px-3 py-1.5 rounded-full uppercase tracking-widest shadow-sm ${
            overallSeverity === 'critical'
              ? 'bg-red-500 text-white animate-pulse'
              : 'bg-amber-500 text-white'
          }`}>
            {criticalCount > 0 ? `${criticalCount} ${t('dashboard.alerts_critical_badge')}` : t('dashboard.alerts_attention_badge')}
          </span>
        )}
      </div>

      {/* Alert Cards Grid */}
      <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Labor Cost Card */}
        <button
          onClick={() => toggleSection('labor')}
          className={`rounded-xl p-4 text-left transition-all duration-200 border cursor-pointer ${
            hasLaborAlerts
              ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700/50 hover:bg-red-200 dark:hover:bg-red-900/50 hover:shadow-md'
              : 'bg-emerald-100 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/40'
          } ${expandedSection === 'labor' ? 'ring-2 ring-red-400 dark:ring-red-500 shadow-md' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Users size={18} className={hasLaborAlerts ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('dashboard.alerts_labor_label')}</span>
          </div>
          {hasLaborAlerts ? (
            <>
              <p className="text-3xl font-black text-red-600 dark:text-red-400">{data.laborAlerts.length}</p>
              <p className="text-xs text-red-500/80 dark:text-red-400/70 font-semibold mt-1">
                {data.laborAlerts.filter(a => a.severity === 'critical').length > 0
                  ? `${data.laborAlerts.filter(a => a.severity === 'critical').length} ${t('dashboard.alerts_critical_count')}`
                  : t('dashboard.alerts_over_target')}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">≤{data.targets.labor}%</p>
            </>
          )}
        </button>

        {/* Food Cost Card */}
        <button
          onClick={() => toggleSection('foodcost')}
          className={`rounded-xl p-4 text-left transition-all duration-200 border cursor-pointer ${
            hasFoodCostAlerts
              ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700/50 hover:bg-amber-200 dark:hover:bg-amber-900/50 hover:shadow-md'
              : 'bg-emerald-100 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/40'
          } ${expandedSection === 'foodcost' ? 'ring-2 ring-amber-400 dark:ring-amber-500 shadow-md' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <ChefHat size={18} className={hasFoodCostAlerts ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('dashboard.alerts_foodcost_label')}</span>
          </div>
          {hasFoodCostAlerts ? (
            <>
              <p className="text-3xl font-black text-amber-600 dark:text-amber-400">{data.foodCostAlerts.length}</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/70 font-semibold mt-1">
                {data.foodCostAlerts.filter(a => a.severity === 'critical').length > 0
                  ? `${data.foodCostAlerts.filter(a => a.severity === 'critical').length} ${t('dashboard.alerts_critical_count')}`
                  : t('dashboard.alerts_over_target')}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">≤{data.targets.foodCost}%</p>
            </>
          )}
        </button>

        {/* Low Sales Card */}
        <button
          onClick={() => toggleSection('sales')}
          className={`rounded-xl p-4 text-left transition-all duration-200 border cursor-pointer ${
            hasLowSales
              ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700/50 hover:bg-orange-200 dark:hover:bg-orange-900/50 hover:shadow-md'
              : 'bg-emerald-100 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/40'
          } ${expandedSection === 'sales' ? 'ring-2 ring-orange-400 dark:ring-orange-500 shadow-md' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown size={18} className={hasLowSales ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('dashboard.alerts_sales_label')}</span>
          </div>
          {hasLowSales ? (
            <>
              <p className="text-3xl font-black text-orange-600 dark:text-orange-400">{data.lowSalesAlerts.length}</p>
              <p className="text-xs text-orange-600/80 dark:text-orange-400/70 font-semibold mt-1">{t('dashboard.alerts_below_avg')}</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">{t('dashboard.alerts_on_avg')}</p>
            </>
          )}
        </button>

        {/* Inspection Compliance Card */}
        <button
          onClick={() => toggleSection('inspections')}
          className={`rounded-xl p-4 text-left transition-all duration-200 border cursor-pointer ${
            hasInspectionAlerts
              ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700/50 hover:bg-purple-200 dark:hover:bg-purple-900/50 hover:shadow-md'
              : 'bg-emerald-100 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/40'
          } ${expandedSection === 'inspections' ? 'ring-2 ring-purple-400 dark:ring-purple-500 shadow-md' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className={hasInspectionAlerts ? 'text-purple-600 dark:text-purple-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('dashboard.alerts_inspections_label')}</span>
          </div>
          {hasInspectionAlerts ? (
            <>
              <p className="text-3xl font-black text-purple-600 dark:text-purple-400">{nonCompliant.length}</p>
              <p className="text-xs text-purple-600/80 dark:text-purple-400/70 font-semibold mt-1">{t('dashboard.alerts_non_compliant')}</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">{t('dashboard.alerts_full_compliance')}</p>
            </>
          )}
        </button>
      </div>

      {/* Expanded Detail Section */}
      {expandedSection && (
        <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4">
          {expandedSection === 'labor' && (
            <div>
              <h4 className="text-base font-black text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <Flame size={20} className="text-red-500" /> {t('dashboard.alerts_labor_by_store')}
              </h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                {t('dashboard.alerts_labor_desc_1')} <span className="font-bold text-red-500">{t('dashboard.alerts_target_of')} {data.targets.labor}%</span> {t('dashboard.alerts_labor_desc_2')} {data.targets.laborCritical}%.
              </p>
              {data.laborAlerts.length > 0 ? (
                <div className="space-y-3">
                  {data.laborAlerts.map((a: any, i: number) => {
                    const barPct = Math.min(100, (a.pct / data.targets.laborCritical) * 100)
                    return (
                      <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-100 dark:border-slate-700"
                        onClick={() => router.push(`/ventas?period=custom&startDate=${startDate}&endDate=${endDate}&store=${encodeURIComponent(a.store)}&storeId=${encodeURIComponent(a.storeId || '')}`)}>
                        {/* Store name + badge */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-base font-black text-slate-800 dark:text-white">{a.store}</span>
                          <span className={`text-sm font-black px-2.5 py-1 rounded-md ${
                            a.severity === 'critical'
                              ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                              : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                          }`}>
                            {a.pct}% {a.severity === 'critical' ? t('dashboard.alerts_critical') : t('dashboard.alerts_warning')}
                          </span>
                        </div>

                        {/* Visual bar */}
                        <div className="relative h-5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                              a.severity === 'critical'
                                ? 'bg-gradient-to-r from-red-400 to-red-500'
                                : 'bg-gradient-to-r from-amber-400 to-amber-500'
                            }`}
                            style={{ width: `${Math.max(barPct, 8)}%` }}
                          />
                          {/* Target line */}
                          <div className="absolute inset-y-0 flex items-center" style={{ left: `${(data.targets.labor / data.targets.laborCritical) * 100}%` }}>
                            <div className="w-0.5 h-full bg-slate-400 dark:bg-slate-500" />
                          </div>
                          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{data.targets.laborCritical}%</span>
                          </div>
                        </div>

                        {/* Dollar breakdown */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_sales')}:</span>
                            <span className="font-bold text-slate-600 dark:text-slate-300">${a.sales?.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_labor')}:</span>
                            <span className={`font-bold ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>${a.labor?.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_exceeds_by')}:</span>
                            <span className="font-bold text-red-500">+{(a.pct - data.targets.labor).toFixed(1)}pp</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">{t('dashboard.alerts_all_within_target')} {data.targets.labor}% ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'foodcost' && (
            <div>
              <h4 className="text-base font-black text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <ChefHat size={20} className="text-amber-500" /> {t('dashboard.alerts_food_by_store')}
              </h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                {t('dashboard.alerts_food_desc_1')} <span className="font-bold text-amber-500">{t('dashboard.alerts_target_of')} {data.targets.foodCost}%</span> {t('dashboard.alerts_food_desc_2')} {data.targets.foodCostCritical}%.
              </p>
              {data.foodCostAlerts.length > 0 ? (
                <div className="space-y-3">
                  {data.foodCostAlerts.map((a: any, i: number) => {
                    const barPct = Math.min(100, (a.pct / (data.targets.foodCostCritical + 4)) * 100)
                    return (
                      <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-100 dark:border-slate-700"
                        onClick={() => router.push(`/admin/food-cost?startDate=${startDate}&endDate=${endDate}&store=${encodeURIComponent(a.store)}&storeId=${encodeURIComponent(a.storeId || '')}`)}>
                        {/* Store name + badge */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-base font-black text-slate-800 dark:text-white">{a.store}</span>
                          <span className={`text-sm font-black px-2.5 py-1 rounded-md ${
                            a.severity === 'critical'
                              ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                              : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                          }`}>
                            {a.pct}% {a.severity === 'critical' ? t('dashboard.alerts_critical') : t('dashboard.alerts_warning')}
                          </span>
                        </div>

                        {/* Visual bar */}
                        <div className="relative h-5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                              a.severity === 'critical'
                                ? 'bg-gradient-to-r from-red-400 to-red-500'
                                : 'bg-gradient-to-r from-amber-400 to-amber-500'
                            }`}
                            style={{ width: `${Math.max(barPct, 8)}%` }}
                          />
                          {/* Target line */}
                          <div className="absolute inset-y-0 flex items-center" style={{ left: `${(data.targets.foodCost / (data.targets.foodCostCritical + 4)) * 100}%` }}>
                            <div className="w-0.5 h-full bg-slate-400 dark:bg-slate-500" />
                          </div>
                          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{data.targets.foodCostCritical}%</span>
                          </div>
                        </div>

                        {/* Dollar breakdown */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_sales')}:</span>
                            <span className="font-bold text-slate-600 dark:text-slate-300">${a.sales?.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_cost')}:</span>
                            <span className={`font-bold ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>${a.cost?.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_exceeds_by')}:</span>
                            <span className="font-bold text-red-500">+{(a.pct - data.targets.foodCost).toFixed(1)}pp</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">{t('dashboard.alerts_all_within_target')} {data.targets.foodCost}% ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'sales' && (
            <div>
              <h4 className="text-base font-black text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <TrendingDown size={20} className="text-orange-500" /> {t('dashboard.alerts_sales_comparison')}
              </h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                {t('dashboard.alerts_sales_desc_1')} <span className="font-bold text-orange-500">{t('dashboard.alerts_sales_desc_2')}</span>. {t('dashboard.alerts_sales_desc_3')} <span className="font-bold">15% {t('dashboard.alerts_or_more')}</span>.
              </p>
              {data.lowSalesAlerts.length > 0 ? (
                <div className="space-y-3">
                  {data.lowSalesAlerts.map((a: any, i: number) => {
                    const pctOfPrev = a.previousSales > 0 ? Math.round((a.sales / a.previousSales) * 100) : 0
                    return (
                      <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-100 dark:border-slate-700"
                        onClick={() => router.push(`/ventas?period=custom&startDate=${startDate}&endDate=${endDate}&store=${encodeURIComponent(a.store)}&storeId=${encodeURIComponent(a.storeId || '')}`)}>
                        {/* Store name + badge */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-base font-black text-slate-800 dark:text-white">{a.store}</span>
                          <span className={`text-sm font-black px-2.5 py-1 rounded-md ${
                            a.pctChange <= -25
                              ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                              : 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400'
                          }`}>
                            {a.pctChange}% {t('dashboard.alerts_vs_previous')}
                          </span>
                        </div>

                        {/* Visual comparison bar */}
                        <div className="relative h-5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                              a.pctChange <= -25
                                ? 'bg-gradient-to-r from-red-400 to-red-500'
                                : 'bg-gradient-to-r from-orange-400 to-orange-500'
                            }`}
                            style={{ width: `${Math.max(pctOfPrev, 8)}%` }}
                          />
                          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('dashboard.alerts_previous_upper')}</span>
                          </div>
                        </div>

                        {/* Numbers detail */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_now')}:</span>
                            <span className="font-bold text-orange-600 dark:text-orange-400">${a.sales.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_previous')}:</span>
                            <span className="font-bold text-slate-600 dark:text-slate-300">${a.previousSales?.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_difference')}:</span>
                            <span className="font-bold text-red-500">-${(a.previousSales - a.sales).toLocaleString()}</span>
                          </div>
                        </div>

                        {/* Period context */}
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 italic">
                          {t('dashboard.alerts_compared_vs')} {a.prevPeriodLabel}
                        </p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">{t('dashboard.alerts_all_within_normal')}</p>
              )}
            </div>
          )}

          {expandedSection === 'inspections' && (
            <div>
              <h4 className="text-base font-black text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                <Eye size={20} className="text-purple-500" /> {t('dashboard.alerts_inspections_by_supervisor')}
              </h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                {t('dashboard.alerts_inspections_desc_1')} <span className="font-bold text-purple-500">{t('dashboard.alerts_inspections_desc_2')}</span> {t('dashboard.alerts_inspections_desc_3')} <span className="font-bold">{t('dashboard.alerts_inspections_desc_4')}</span>.
              </p>
              <div className="space-y-3">
                {data.inspectionCompliance.map((sup, i) => {
                  const failedDays = sup.dailyDetail?.filter(d => !d.compliant) || []
                  return (
                    <div
                      key={i}
                      onClick={() => router.push(`/inspecciones?startDate=${startDate}&endDate=${endDate}&inspector_id=${sup.supervisorId || ''}&user=${encodeURIComponent(sup.supervisorFull || sup.supervisor)}`)}
                      className={`rounded-xl border overflow-hidden cursor-pointer transition-colors ${
                        sup.compliant
                          ? 'bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40'
                          : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/80 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {/* Supervisor Header */}
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {sup.compliant
                              ? <CheckCircle2 size={18} className="text-emerald-500" />
                              : <XCircle size={18} className="text-red-500" />
                            }
                            <span className="text-base font-black text-slate-800 dark:text-white">{sup.supervisor}</span>
                          </div>
                          <span className={`text-sm font-black px-2.5 py-1 rounded-md ${
                            sup.compliancePct === 100
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                              : sup.compliancePct >= 50
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                          }`}>
                            {sup.compliancePct}% {t('dashboard.alerts_compliance_pct')}
                          </span>
                        </div>

                        {/* Compliance bar */}
                        <div className="relative h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                              sup.compliancePct === 100
                                ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                : sup.compliancePct >= 50
                                  ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                                  : 'bg-gradient-to-r from-red-400 to-red-500'
                            }`}
                            style={{ width: `${Math.max(sup.compliancePct, 4)}%` }}
                          />
                          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">100%</span>
                          </div>
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_stores_label')}:</span>
                            <span className="font-bold text-slate-600 dark:text-slate-300">{sup.ownedStores?.join(', ') || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_completed_days')}:</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{sup.totalInspected} {t('dashboard.alerts_of')} {sup.totalScheduled} {t('dashboard.alerts_days')}</span>
                          </div>
                          {failedDays.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400 dark:text-slate-500">{t('dashboard.alerts_failures')}:</span>
                              <span className="font-bold text-red-500">{failedDays.length} {failedDays.length > 1 ? t('dashboard.alerts_days') : t('dashboard.alerts_day')}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Daily Detail — only non-compliant days */}
                      {failedDays.length > 0 && (
                        <div className="border-t border-slate-200/60 dark:border-slate-700/50">
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {failedDays.map((day, j) => {
                              const dateObj = new Date(day.date + 'T12:00:00')
                              const dayName = dateObj.toLocaleDateString(language === 'en' ? 'en-US' : 'es-MX', { weekday: 'short' }).toUpperCase()
                              const dayNum = dateObj.getDate()
                              return (
                                <div key={j} className="px-4 py-2.5 flex items-center gap-3 bg-red-50/80 dark:bg-red-900/10">
                                  {/* Date badge */}
                                  <div className="w-12 h-12 rounded-lg flex flex-col items-center justify-center flex-shrink-0 text-center bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                    <span className="text-[10px] font-black uppercase leading-none">{dayName}</span>
                                    <span className="text-lg font-black leading-tight">{dayNum}</span>
                                  </div>

                                  {/* Detail */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                        {t('dashboard.alerts_no_inspection')}
                                      </span>
                                      {day.shift && (
                                        <span className="text-xs text-slate-400 dark:text-slate-500">
                                          {t('dashboard.alerts_scheduled')}: {day.shift}
                                        </span>
                                      )}
                                    </div>
                                    {day.ownedStoresMissing.length > 0 && (
                                      <p className="text-xs text-red-500/80 dark:text-red-400/60 mt-0.5">
                                        {t('dashboard.alerts_unvisited_stores')}: {day.ownedStoresMissing.join(', ')}
                                      </p>
                                    )}
                                  </div>

                                  <div className="flex-shrink-0">
                                    <XCircle size={18} className="text-red-400" />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* No scheduled days message */}
                      {(!sup.dailyDetail || sup.dailyDetail.length === 0) && (
                        <div className="px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/50">
                          <p className="text-sm text-slate-400 dark:text-slate-500">
                            {t('dashboard.alerts_no_scheduled_days')}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
