/**
 * @module components/ronos/ChainComplianceTab
 * @description Pestaña de Cumplimiento de Leyes Laborales de California y Auditoría de Fugas (Meal Penalties).
 *   - Audita en tiempo real las 16 sucursales de Tacos Gavilan frente al Código Laboral de California § 512 / IWC Wage Order 5.
 *   - Identifica violaciones a la Regla de la 5ta Hora (descansos de comida tardíos > 5.0 hrs o menores a 30 minutos).
 *   - Cuantifica la fuga financiera exacta en dólares ($ USD) y clasifica a las tiendas por nivel de riesgo.
 *
 * @businessRules
 *   - Regla de la 5ta hora: Todo turno de más de 5 horas requiere descanso ininterrumpido de 30 min antes de la 5ta hora.
 *   - Penalización: 1 hora de salario ordinario por día que ocurra una infracción.
 *   - Exención legal de 6.0 horas: Turnos que concluyan en 6.0 horas o menos pueden eximir el almuerzo con acuerdo mutuo.
 *
 * @dataFlow
 *   Recibe `chainData` originado en `/api/ronos/punches?companyId=0`.
 *
 * @notes
 *   - Utiliza mediciones en segundos reales sin redondeo según Donohue v. AMN Services, LLC.
 */

'use client'

import React, { useState, useMemo } from 'react'
import {
  BarChart3,
  AlertTriangle,
  DollarSign,
  Building2,
  CheckCircle2,
  ArrowRight,
  TrendingDown,
  Scale,
  Users,
  Clock,
  RefreshCw
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { ChainAuditData, WorkWeekOption } from './types'
import { formatCurrency, formatUsaDate } from './helpers'

interface ChainComplianceTabProps {
  chainData: ChainAuditData | null
  loading: boolean
  onSelectStore: (companyId: number) => void
}

export default function ChainComplianceTab({
  chainData,
  loading,
  onSelectStore
}: ChainComplianceTabProps) {
  const { t } = useLanguage()

  const [sortField, setSortField] = useState<'penaltyCost' | 'penalties' | 'hours' | 'compliance' | 'store'>('penaltyCost')
  const [sortAsc, setSortAsc] = useState(false)

  // Ordenamiento de tiendas
  const sortedStores = useMemo(() => {
    if (!Array.isArray(chainData?.stores)) return []
    const list = [...chainData.stores]

    list.sort((a, b) => {
      let valA = 0
      let valB = 0

      if (sortField === 'penaltyCost') {
        valA = a.estimatedPenaltyCostUsd || 0
        valB = b.estimatedPenaltyCostUsd || 0
      } else if (sortField === 'penalties') {
        valA = a.mealPenaltiesCount || 0
        valB = b.mealPenaltiesCount || 0
      } else if (sortField === 'hours') {
        valA = a.totalHours || 0
        valB = b.totalHours || 0
      } else if (sortField === 'compliance') {
        valA = a.complianceScore || 0
        valB = b.complianceScore || 0
      } else if (sortField === 'store') {
        return sortAsc
          ? a.storeName.localeCompare(b.storeName)
          : b.storeName.localeCompare(a.storeName)
      }

      return sortAsc ? valA - valB : valB - valA
    })

    return list
  }, [chainData?.stores, sortField, sortAsc])

  const totalPenalties = chainData?.chainMealPenaltiesCount ?? chainData?.totalMealPenalties ?? 0
  const totalPenaltyCost = chainData?.chainPenaltyCostUsd ?? chainData?.totalPenaltyCostUsd ?? 0
  const avgCompliance = chainData?.chainAverageComplianceScore ?? 100
  const totalEmployees = chainData?.totalActiveEmployees ?? chainData?.totalChainEmployees ?? 0
  const totalChainHours = chainData?.chainTotalHours ?? chainData?.totalChainHours ?? 0

  return (
    <div className="space-y-5">
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* 1. TOP CARDS: AUDITORÍA DE FUGAS & CUMPLIMIENTO LEGAL CALIFORNIA            */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Fuga en USD */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-rose-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">{t('ronos.kpi_estimated_leakage') || 'Fuga Estimada'}</span>
            <DollarSign className="w-5 h-5" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-600 font-mono">
            {formatCurrency(totalPenaltyCost)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Costo multas por comida tarde
          </span>
        </div>

        {/* Total Multas */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-amber-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">{t('ronos.kpi_meal_penalties') || 'Multas de Comida'}</span>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600 font-mono">
            {totalPenalties}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Turnos sin descanso a tiempo (&gt;5h)
          </span>
        </div>

        {/* Compliance Score */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">{t('ronos.kpi_compliance_score') || 'Cumplimiento'}</span>
            <Scale className="w-5 h-5" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600 font-mono">
            {avgCompliance.toFixed(1)}%
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Promedio legal de la cadena
          </span>
        </div>

        {/* Personal Activo */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[#0288d1] mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">{t('ronos.kpi_workforce') || 'Personal Activo'}</span>
            <Users className="w-5 h-5" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
            {totalEmployees}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Colaboradores en 16 tiendas
          </span>
        </div>

        {/* Horas Totales */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">{t('ronos.kpi_total_hours') || 'Horas Cadena'}</span>
            <Clock className="w-5 h-5" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
            {totalChainHours.toLocaleString('en-US', { maximumFractionDigits: 1 })}h
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Total horas ponchadas
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* 2. EXPLICACIÓN LEGAL SENCILLA (CALIFORNIA WAGE ORDER 5)                      */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 flex items-start gap-3">
        <Scale className="w-5 h-5 text-[#0288d1] shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          <strong className="font-bold text-slate-900 dark:text-white block mb-0.5">
            Ley Laboral de California (California Labor Code § 512 / IWC Wage Order 5):
          </strong>
          En California, todo colaborador que labore más de 5 horas consecutivas tiene derecho legal a un descanso de comida de mínimo 30 minutos continuos antes de cumplir la 5ta hora. Si el descanso se toma tarde (ej. a las 5h 15m) o dura menos de 30 minutos, la ley exige pagarle al colaborador 1 hora adicional de salario como penalización (*Meal Penalty*). Este panel te muestra exactamente qué tiendas tienen más fugas para tomar medidas con la gerencia.
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* 3. RANKING DE TIENDAS: SEMÁFORO DE CUMPLIMIENTO Y FUGAS                    */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#0288d1]" />
              <span>{t('ronos.chain_compliance_ranking')}</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Haz clic en cualquier tienda para auditar el detalle de los colaboradores que poncharon tarde.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold">Ordenar por:</span>
            <button
              onClick={() => {
                if (sortField === 'penaltyCost') setSortAsc(!sortAsc)
                else { setSortField('penaltyCost'); setSortAsc(false); }
              }}
              className={`px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                sortField === 'penaltyCost' ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Mayor Fuga ($) {sortField === 'penaltyCost' ? (sortAsc ? '▲' : '▼') : ''}
            </button>
            <button
              onClick={() => {
                if (sortField === 'compliance') setSortAsc(!sortAsc)
                else { setSortField('compliance'); setSortAsc(true); }
              }}
              className={`px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                sortField === 'compliance' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Cumplimiento (%) {sortField === 'compliance' ? (sortAsc ? '▲' : '▼') : ''}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4">Sucursal</th>
                <th className="py-3 px-3 text-center">Personal</th>
                <th className="py-3 px-3 text-center font-bold">Total Horas</th>
                <th className="py-3 px-3 text-center text-amber-600 font-semibold">Overtime</th>
                <th className="py-3 px-3 text-center font-bold text-rose-600">Multas de Comida</th>
                <th className="py-3 px-4 text-right font-black text-rose-600">Fuga en Dinero</th>
                <th className="py-3 px-3 text-center font-bold">Semáforo</th>
                <th className="py-3 px-4 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-[#0288d1]" />
                    <span className="font-bold text-sm">Auditando el cumplimiento de las 16 sucursales...</span>
                  </td>
                </tr>
              ) : sortedStores.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <span>No hay datos de tiendas para la semana seleccionada.</span>
                  </td>
                </tr>
              ) : (
                sortedStores.map((st, idx) => {
                  const penaltiesCount = st.mealPenaltiesCount || 0
                  const penaltyCost = st.estimatedPenaltyCostUsd || 0
                  const score = st.complianceScore || 0

                  return (
                    <tr
                      key={st.ronosCompanyId}
                      onClick={() => onSelectStore(st.ronosCompanyId)}
                      className="hover:bg-sky-50/40 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      {/* Ranking */}
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-400">
                        {idx + 1}
                      </td>

                      {/* Tienda */}
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-[#0288d1]" />
                          <span>{st.storeName}</span>
                          {st.isBodega && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              BODEGA
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Personal Activo */}
                      <td className="py-3 px-3 text-center text-slate-700 dark:text-slate-300">
                        {st.activeEmployees}
                      </td>

                      {/* Horas Totales */}
                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-900 dark:text-white">
                        {(st.totalHours || 0).toFixed(1)}h
                      </td>

                      {/* Overtime */}
                      <td className="py-3 px-3 text-center font-mono font-semibold text-amber-600">
                        {(st.overtimeHours || 0).toFixed(1)}h
                      </td>

                      {/* Multas de Comida */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-xs ${
                          penaltiesCount > 0
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}>
                          {penaltiesCount > 0 ? `${penaltiesCount} multas` : '0'}
                        </span>
                      </td>

                      {/* Fuga en Dinero */}
                      <td className="py-3 px-4 text-right font-mono font-black text-rose-600 dark:text-rose-400 text-sm">
                        {penaltyCost > 0 ? formatCurrency(penaltyCost) : '$0.00'}
                      </td>

                      {/* Semáforo */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full font-black text-[11px] ${
                          score >= 95
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : score >= 85
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}>
                          {score.toFixed(1)}%
                        </span>
                      </td>

                      {/* Botón Acción */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectStore(st.ronosCompanyId)
                          }}
                          className="px-3 py-1.5 rounded-xl bg-[#0288d1] hover:bg-[#0277bd] text-white font-bold text-xs shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1 mx-auto"
                        >
                          <span>Auditar Tienda</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
