'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, TrendingDown, Users, ChefHat, Shield,
  CheckCircle2, XCircle, ArrowRight, Flame, Eye
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
      <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 animate-pulse">
        <div className="h-6 bg-slate-800 rounded w-48 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-slate-800 rounded-xl" />)}
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

  // Overall severity
  const criticalCount =
    data.laborAlerts.filter(a => a.severity === 'critical').length +
    data.foodCostAlerts.filter(a => a.severity === 'critical').length
  const overallSeverity = criticalCount > 0 ? 'critical' : data.totalAlerts > 0 ? 'warning' : 'ok'

  const severityColors = {
    critical: 'from-red-600/20 to-red-900/30 border-red-500/30',
    warning: 'from-amber-600/10 to-amber-900/20 border-amber-500/20',
    ok: 'from-emerald-600/10 to-emerald-900/20 border-emerald-500/20'
  }

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${severityColors[overallSeverity]} backdrop-blur-sm shadow-xl overflow-hidden`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ${
            overallSeverity === 'critical' ? 'bg-red-500 animate-pulse' :
            overallSeverity === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
          }`}>
            {overallSeverity === 'ok' ? <CheckCircle2 size={18} className="text-white" /> : <AlertTriangle size={18} className="text-white" />}
          </div>
          <div>
            <h3 className="font-black text-white text-base tracking-tight">
              {overallSeverity === 'ok' ? '✅ Operaciones Estables' : '🚨 Centro de Alertas Operativas'}
            </h3>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">
              {data.totalAlerts} {data.totalAlerts === 1 ? 'alerta' : 'alertas'} activas
            </p>
          </div>
        </div>
        {data.totalAlerts > 0 && (
          <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm ${
            overallSeverity === 'critical' ? 'bg-red-500 text-white animate-pulse' :
            'bg-amber-500 text-white'
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
          className={`rounded-xl p-4 text-left transition-all duration-300 border ${
            hasLaborAlerts
              ? 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-400/50'
              : 'bg-white/5 border-white/10 hover:bg-white/10'
          } ${expandedSection === 'labor' ? 'ring-2 ring-rose-400/50' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className={hasLaborAlerts ? 'text-rose-400' : 'text-white/30'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Labor</span>
          </div>
          {hasLaborAlerts ? (
            <>
              <p className="text-2xl font-black text-rose-400">{data.laborAlerts.length}</p>
              <p className="text-[10px] text-rose-300/70 font-medium mt-1">
                {data.laborAlerts.filter(a => a.severity === 'critical').length > 0
                  ? `${data.laborAlerts.filter(a => a.severity === 'critical').length} crítica(s)`
                  : 'sobre target'}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-black text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-300/70 font-medium mt-1">≤{data.targets.labor}%</p>
            </>
          )}
        </button>

        {/* Food Cost Card */}
        <button
          onClick={() => toggleSection('foodcost')}
          className={`rounded-xl p-4 text-left transition-all duration-300 border ${
            hasFoodCostAlerts
              ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-400/50'
              : 'bg-white/5 border-white/10 hover:bg-white/10'
          } ${expandedSection === 'foodcost' ? 'ring-2 ring-amber-400/50' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <ChefHat size={16} className={hasFoodCostAlerts ? 'text-amber-400' : 'text-white/30'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Food Cost</span>
          </div>
          {hasFoodCostAlerts ? (
            <>
              <p className="text-2xl font-black text-amber-400">{data.foodCostAlerts.length}</p>
              <p className="text-[10px] text-amber-300/70 font-medium mt-1">
                {data.foodCostAlerts.filter(a => a.severity === 'critical').length > 0
                  ? `${data.foodCostAlerts.filter(a => a.severity === 'critical').length} crítica(s)`
                  : 'sobre target'}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-black text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-300/70 font-medium mt-1">≤{data.targets.foodCost}%</p>
            </>
          )}
        </button>

        {/* Low Sales Card */}
        <button
          onClick={() => toggleSection('sales')}
          className={`rounded-xl p-4 text-left transition-all duration-300 border ${
            hasLowSales
              ? 'bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20 hover:border-orange-400/50'
              : 'bg-white/5 border-white/10 hover:bg-white/10'
          } ${expandedSection === 'sales' ? 'ring-2 ring-orange-400/50' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown size={16} className={hasLowSales ? 'text-orange-400' : 'text-white/30'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Ventas</span>
          </div>
          {hasLowSales ? (
            <>
              <p className="text-2xl font-black text-orange-400">{data.lowSalesAlerts.length}</p>
              <p className="text-[10px] text-orange-300/70 font-medium mt-1">bajo promedio</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-black text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-300/70 font-medium mt-1">en promedio</p>
            </>
          )}
        </button>

        {/* Inspection Compliance Card */}
        <button
          onClick={() => toggleSection('inspections')}
          className={`rounded-xl p-4 text-left transition-all duration-300 border ${
            hasInspectionAlerts
              ? 'bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20 hover:border-purple-400/50'
              : 'bg-white/5 border-white/10 hover:bg-white/10'
          } ${expandedSection === 'inspections' ? 'ring-2 ring-purple-400/50' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className={hasInspectionAlerts ? 'text-purple-400' : 'text-white/30'} />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Inspecciones</span>
          </div>
          {hasInspectionAlerts ? (
            <>
              <p className="text-2xl font-black text-purple-400">{nonCompliant.length}</p>
              <p className="text-[10px] text-purple-300/70 font-medium mt-1">sin compliance</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-black text-emerald-400">✓</p>
              <p className="text-[10px] text-emerald-300/70 font-medium mt-1">100% cumplimiento</p>
            </>
          )}
        </button>
      </div>

      {/* Expanded Detail Section */}
      {expandedSection && (
        <div className="border-t border-white/10 bg-black/20 px-5 py-4 animate-in slide-in-from-top-2 duration-300">
          {expandedSection === 'labor' && (
            <div>
              <h4 className="text-sm font-black text-white mb-3 flex items-center gap-2">
                <Flame size={16} className="text-rose-400" /> Labor Cost por Tienda
                <span className="text-white/30 text-[10px] font-medium ml-auto">Target: ≤{data.targets.labor}%</span>
              </h4>
              {data.laborAlerts.length > 0 ? (
                <div className="space-y-2">
                  {data.laborAlerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors cursor-pointer"
                      onClick={() => router.push(`/ventas?period=custom&startDate=${startDate}&endDate=${endDate}`)}>
                      <span className="text-sm font-bold text-white">{a.store}</span>
                      <span className={`text-sm font-black px-2 py-0.5 rounded-md ${
                        a.severity === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>{a.pct}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-400 text-sm font-medium">Todas las tiendas dentro del target ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'foodcost' && (
            <div>
              <h4 className="text-sm font-black text-white mb-3 flex items-center gap-2">
                <ChefHat size={16} className="text-amber-400" /> Food Cost por Tienda
                <span className="text-white/30 text-[10px] font-medium ml-auto">Target: ≤{data.targets.foodCost}%</span>
              </h4>
              {data.foodCostAlerts.length > 0 ? (
                <div className="space-y-2">
                  {data.foodCostAlerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors cursor-pointer"
                      onClick={() => router.push(`/admin/food-cost?startDate=${startDate}&endDate=${endDate}`)}>
                      <span className="text-sm font-bold text-white">{a.store}</span>
                      <span className={`text-sm font-black px-2 py-0.5 rounded-md ${
                        a.severity === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>{a.pct}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-400 text-sm font-medium">Todas las tiendas dentro del target ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'sales' && (
            <div>
              <h4 className="text-sm font-black text-white mb-3 flex items-center gap-2">
                <TrendingDown size={16} className="text-orange-400" /> Tiendas con Ventas Bajas
                <span className="text-white/30 text-[10px] font-medium ml-auto">
                  Promedio flota: ${data.lowSalesAlerts[0]?.fleetAvg?.toLocaleString() || '—'}
                </span>
              </h4>
              {data.lowSalesAlerts.length > 0 ? (
                <div className="space-y-2">
                  {data.lowSalesAlerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors cursor-pointer"
                      onClick={() => router.push(`/ventas?period=custom&startDate=${startDate}&endDate=${endDate}`)}>
                      <span className="text-sm font-bold text-white">{a.store}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-white/40 text-xs">${a.sales.toLocaleString()}</span>
                        <span className="text-sm font-black px-2 py-0.5 rounded-md bg-orange-500/20 text-orange-400">
                          -{a.pctBelowAvg}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-400 text-sm font-medium">Todas las tiendas en rango normal ✓</p>
              )}
            </div>
          )}

          {expandedSection === 'inspections' && (
            <div>
              <h4 className="text-sm font-black text-white mb-3 flex items-center gap-2">
                <Eye size={16} className="text-purple-400" /> Compliance de Inspecciones
              </h4>
              <div className="space-y-3">
                {data.inspectionCompliance.map((sup, i) => (
                  <div key={i} className={`rounded-lg px-4 py-3 border transition-colors ${
                    sup.compliant
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-red-500/5 border-red-500/20'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {sup.compliant
                          ? <CheckCircle2 size={16} className="text-emerald-400" />
                          : <XCircle size={16} className="text-red-400" />
                        }
                        <span className="text-sm font-black text-white">{sup.supervisor}</span>
                      </div>
                      <span className={`text-xs font-black px-2 py-0.5 rounded-md ${
                        sup.compliancePct === 100 ? 'bg-emerald-500/20 text-emerald-400' :
                        sup.compliancePct >= 50 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {sup.compliancePct}%
                      </span>
                    </div>
                    <div className="text-[11px] space-y-1">
                      {sup.totalScheduled > 0 && (
                        <p className="text-white/40">
                          📅 Programado en: <span className="text-white/60 font-medium">{sup.scheduledStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.inspectedStores.length > 0 && (
                        <p className="text-emerald-400/80">
                          ✅ Inspeccionó: <span className="font-medium">{sup.inspectedStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.missingStores.length > 0 && (
                        <p className="text-red-400/80">
                          ❌ Falta: <span className="font-bold">{sup.missingStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.extraStores.length > 0 && (
                        <p className="text-blue-400/80">
                          ➕ Extra: <span className="font-medium">{sup.extraStores.join(', ')}</span>
                        </p>
                      )}
                      {sup.totalScheduled === 0 && sup.totalInspections === 0 && (
                        <p className="text-white/30">Sin programación ni inspecciones en este período</p>
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
