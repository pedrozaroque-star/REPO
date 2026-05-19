'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, TrendingDown, Users, ChefHat, Shield,
  CheckCircle2, XCircle, Flame, Eye
} from 'lucide-react'

interface AlertsData {
  totalAlerts: number
  laborAlerts: { store: string; pct: number; severity: string }[]
  foodCostAlerts: { store: string; pct: number; severity: string }[]
  lowSalesAlerts: { store: string; sales: number; fleetAvg: number; pctBelowAvg: number }[]
  inspectionCompliance: {
    supervisor: string; supervisorFull: string; scheduledStores: string[];
    inspectedStores: string[]; missingStores: string[]; extraStores: string[];
    totalScheduled: number; totalInspected: number; totalInspections: number;
    compliant: boolean; compliancePct: number
  }[]
  targets: { labor: number; laborCritical: number; foodCost: number; foodCostCritical: number }
}

interface Props {
  startDate: string
  endDate: string
}

export default function OperationsAlerts({ startDate, endDate }: Props) {
  const router = useRouter()
  const [data, setData] = useState<AlertsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/dashboard/alerts?startDate=${startDate}&endDate=${endDate}`)
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to fetch alerts:', err)
      }
      setLoading(false)
    }
    fetchAlerts()
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
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-md ${
            overallSeverity === 'critical' ? 'bg-red-500 animate-pulse' :
            overallSeverity === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
          }`}>
            {overallSeverity === 'ok'
              ? <CheckCircle2 size={18} className="text-white" />
              : <AlertTriangle size={18} className="text-white" />
            }
          </div>
          <div>
            <h3 className="font-black text-slate-800 dark:text-white text-base tracking-tight">
              {overallSeverity === 'ok' ? '✅ Operaciones Estables' : '🚨 Centro de Alertas Operativas'}
            </h3>
            <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest">
              {data.totalAlerts} {data.totalAlerts === 1 ? 'alerta' : 'alertas'} activas
            </p>
          </div>
        </div>
        {data.totalAlerts > 0 && (
          <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm ${
            overallSeverity === 'critical'
              ? 'bg-red-500 text-white animate-pulse'
              : 'bg-amber-500 text-white'
          }`}>
            {criticalCount > 0 ? `${criticalCount} CRÍTICAS` : 'ATENCIÓN'}
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
            <Users size={14} className={hasLaborAlerts ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Labor</span>
          </div>
          {hasLaborAlerts ? (
            <>
              <p className="text-3xl font-black text-red-600 dark:text-red-400">{data.laborAlerts.length}</p>
              <p className="text-[10px] text-red-500/80 dark:text-red-400/70 font-semibold mt-1">
                {data.laborAlerts.filter(a => a.severity === 'critical').length > 0
                  ? `${data.laborAlerts.filter(a => a.severity === 'critical').length} crítica(s)`
                  : 'sobre target'}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">≤{data.targets.labor}%</p>
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
            <ChefHat size={14} className={hasFoodCostAlerts ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Food Cost</span>
          </div>
          {hasFoodCostAlerts ? (
            <>
              <p className="text-3xl font-black text-amber-600 dark:text-amber-400">{data.foodCostAlerts.length}</p>
              <p className="text-[10px] text-amber-600/80 dark:text-amber-400/70 font-semibold mt-1">
                {data.foodCostAlerts.filter(a => a.severity === 'critical').length > 0
                  ? `${data.foodCostAlerts.filter(a => a.severity === 'critical').length} crítica(s)`
                  : 'sobre target'}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">≤{data.targets.foodCost}%</p>
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
            <TrendingDown size={14} className={hasLowSales ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Ventas</span>
          </div>
          {hasLowSales ? (
            <>
              <p className="text-3xl font-black text-orange-600 dark:text-orange-400">{data.lowSalesAlerts.length}</p>
              <p className="text-[10px] text-orange-600/80 dark:text-orange-400/70 font-semibold mt-1">bajo promedio</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">en promedio</p>
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
            <Shield size={14} className={hasInspectionAlerts ? 'text-purple-600 dark:text-purple-400' : 'text-emerald-600 dark:text-emerald-400'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Inspecciones</span>
          </div>
          {hasInspectionAlerts ? (
            <>
              <p className="text-3xl font-black text-purple-600 dark:text-purple-400">{nonCompliant.length}</p>
              <p className="text-[10px] text-purple-600/80 dark:text-purple-400/70 font-semibold mt-1">sin compliance</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60 font-semibold mt-1">100% cumplimiento</p>
            </>
          )}
        </button>
      </div>

      {/* Expanded Detail Section */}
      {expandedSection && (
        <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4">
          {expandedSection === 'labor' && (
            <div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                <Flame size={16} className="text-red-500" /> Labor Cost por Tienda
                <span className="text-slate-400 text-[10px] font-medium ml-auto">Target: ≤{data.targets.labor}%</span>
              </h4>
              {data.laborAlerts.length > 0 ? (
                <div className="space-y-2">
                  {data.laborAlerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-100 dark:border-slate-700"
                      onClick={() => router.push(`/ventas?period=custom&startDate=${startDate}&endDate=${endDate}`)}>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{a.store}</span>
                      <span className={`text-sm font-black px-2.5 py-0.5 rounded-md ${
                        a.severity === 'critical'
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                          : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                      }`}>{a.pct}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">Todas las tiendas dentro del target ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'foodcost' && (
            <div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                <ChefHat size={16} className="text-amber-500" /> Food Cost por Tienda
                <span className="text-slate-400 text-[10px] font-medium ml-auto">Target: ≤{data.targets.foodCost}%</span>
              </h4>
              {data.foodCostAlerts.length > 0 ? (
                <div className="space-y-2">
                  {data.foodCostAlerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-100 dark:border-slate-700"
                      onClick={() => router.push(`/admin/food-cost?startDate=${startDate}&endDate=${endDate}`)}>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{a.store}</span>
                      <span className={`text-sm font-black px-2.5 py-0.5 rounded-md ${
                        a.severity === 'critical'
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                          : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                      }`}>{a.pct}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">Todas las tiendas dentro del target ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'sales' && (
            <div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                <TrendingDown size={16} className="text-orange-500" /> Tiendas con Ventas Bajas
                <span className="text-slate-400 text-[10px] font-medium ml-auto">
                  Promedio flota: ${data.lowSalesAlerts[0]?.fleetAvg?.toLocaleString() || '—'}
                </span>
              </h4>
              {data.lowSalesAlerts.length > 0 ? (
                <div className="space-y-2">
                  {data.lowSalesAlerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-slate-100 dark:border-slate-700"
                      onClick={() => router.push(`/ventas?period=custom&startDate=${startDate}&endDate=${endDate}`)}>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{a.store}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-xs">${a.sales.toLocaleString()}</span>
                        <span className="text-sm font-black px-2.5 py-0.5 rounded-md bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
                          -{a.pctBelowAvg}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">Todas las tiendas en rango normal ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'inspections' && (
            <div>
              <h4 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                <Eye size={16} className="text-purple-500" /> Compliance de Inspecciones
              </h4>
              <div className="space-y-3">
                {data.inspectionCompliance.map((sup, i) => (
                  <div key={i} className={`rounded-xl px-4 py-3 border ${
                    sup.compliant
                      ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/40'
                      : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/40'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {sup.compliant
                          ? <CheckCircle2 size={16} className="text-emerald-500" />
                          : <XCircle size={16} className="text-red-500" />
                        }
                        <span className="text-sm font-black text-slate-800 dark:text-white">{sup.supervisor}</span>
                      </div>
                      <span className={`text-xs font-black px-2.5 py-0.5 rounded-md ${
                        sup.compliancePct === 100
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                          : sup.compliancePct >= 50
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                      }`}>
                        {sup.compliancePct}%
                      </span>
                    </div>
                    <div className="text-[11px] space-y-1">
                      {sup.totalScheduled > 0 && (
                        <p className="text-slate-500 dark:text-slate-400">
                          📅 Programado en: <span className="text-slate-700 dark:text-slate-300 font-semibold">{sup.scheduledStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.inspectedStores.length > 0 && (
                        <p className="text-emerald-600 dark:text-emerald-400">
                          ✅ Inspeccionó: <span className="font-semibold">{sup.inspectedStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.missingStores.length > 0 && (
                        <p className="text-red-600 dark:text-red-400">
                          ❌ Falta: <span className="font-bold">{sup.missingStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.extraStores.length > 0 && (
                        <p className="text-blue-600 dark:text-blue-400">
                          ➕ Extra: <span className="font-semibold">{sup.extraStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.totalScheduled === 0 && sup.totalInspections === 0 && (
                        <p className="text-slate-400 dark:text-slate-500">Sin programación ni inspecciones en este período</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
