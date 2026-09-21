/**
 * @module components/ronos/RonosHeader
 * @description Cabecera ejecutiva unificada y barra de 5 pestañas compactas para el módulo RONOS de Tacos Gavilan.
 *   - Encabezado único y sobrio: "RONOS · [Tienda o cadena] · [Período exacto] · Actualizado [hora]".
 *   - Pestañas compactas (5): Resumen | Asistencia | Nómina | Equipo | Administración.
 *   - Filtros de tienda y período con controles táctiles ergonómicos (mínimo 44px).
 *
 * @businessRules
 *   - Selección de tienda y período unificada para toda la auditoría.
 *   - Actualización en vivo de checador y contratos Simplify HR OS.
 *
 * @dataFlow
 *   Recibe props de estado y funciones controladoras desde app/admin/ronos/page.tsx.
 *
 * @notes
 *   - Cumple con estándar Mobile-First (áreas táctiles >= 44px).
 *   - Soporte bilingüe completo (i18n) sin textos hardcodeados.
 *   - Elimina el bloque oscuro superior, tarjetas gigantes y "Protegido 100%".
 */

'use client'

import React, { useMemo } from 'react'
import {
  Building2,
  Calendar,
  RefreshCw,
  Clock,
  Receipt,
  Users,
  Server,
  LayoutDashboard
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { StoreOption, WorkWeekOption, BiWeeklyPeriod } from './types'
import { formatUsaDate } from './helpers'

export type RonosTabId = 'summary' | 'attendance' | 'payroll' | 'team' | 'admin'

interface RonosHeaderProps {
  activeTab: RonosTabId
  setActiveTab: (tab: RonosTabId) => void
  stores: StoreOption[]
  weeks: WorkWeekOption[]
  biWeeklyPeriods: BiWeeklyPeriod[]
  selectedCompanyId: number
  selectedWeekId?: number
  selectedBiWeeklyPeriod: string
  payrollBiWeekly: boolean
  setPayrollBiWeekly: (val: boolean) => void
  onStoreChange: (companyId: number) => void
  onWeekChange: (weekId: number) => void
  onBiWeeklyPeriodChange: (periodId: string) => void
  onSyncLive: () => void
  syncing: boolean
  lastSyncedTime: string | null
  isUpdating?: boolean
}

export default function RonosHeader({
  activeTab,
  setActiveTab,
  stores,
  weeks,
  biWeeklyPeriods,
  selectedCompanyId,
  selectedWeekId,
  selectedBiWeeklyPeriod,
  payrollBiWeekly,
  setPayrollBiWeekly,
  onStoreChange,
  onWeekChange,
  onBiWeeklyPeriodChange,
  onSyncLive,
  syncing,
  lastSyncedTime,
  isUpdating = false
}: RonosHeaderProps) {
  const { t } = useLanguage()

  // Nombre de la sucursal seleccionada
  const activeStoreName = useMemo(() => {
    if (selectedCompanyId === 0) {
      return t('ronos.all_stores') || 'Todas las Tiendas (Cadena)'
    }
    const store = stores.find(s => s.ronosCompanyId === selectedCompanyId)
    if (!store) return `Tienda #${selectedCompanyId}`
    return `${store.tegName} (#${store.tegStoreId})${store.isBodega ? ' - Bodega' : ''}`
  }, [selectedCompanyId, stores, t])

  // Etiqueta del período exacto
  const activePeriodLabel = useMemo(() => {
    if (activeTab === 'payroll' && payrollBiWeekly) {
      const p = biWeeklyPeriods.find(b => b.id === selectedBiWeeklyPeriod)
      return p ? p.label : (biWeeklyPeriods[0]?.label || t('ronos.period_cingular') || 'Período Quincenal')
    }
    const w = weeks.find(wk => wk.weekId === selectedWeekId)
    return w
      ? `${formatUsaDate(w.startDate)} - ${formatUsaDate(w.endDate)}`
      : weeks[0]
      ? `${formatUsaDate(weeks[0].startDate)} - ${formatUsaDate(weeks[0].endDate)}`
      : 'Período Actual'
  }, [activeTab, payrollBiWeekly, biWeeklyPeriods, selectedBiWeeklyPeriod, weeks, selectedWeekId, t])

  // Definición de las 5 pestañas compactas
  const tabs = [
    {
      id: 'summary' as const,
      label: t('ronos.tabs.summary') || 'Resumen',
      icon: LayoutDashboard
    },
    {
      id: 'attendance' as const,
      label: t('ronos.tabs.attendance') || 'Asistencia',
      icon: Clock
    },
    {
      id: 'payroll' as const,
      label: t('ronos.tabs.payroll') || 'Nómina',
      icon: Receipt
    },
    {
      id: 'team' as const,
      label: t('ronos.tabs.team') || 'Equipo',
      icon: Users
    },
    {
      id: 'admin' as const,
      label: t('ronos.tabs.admin') || 'Administración',
      icon: Server
    }
  ]

  const updatedTimeLabel = lastSyncedTime
    ? `${t('ronos.updated') || 'Actualizado'} ${lastSyncedTime}`
    : `${t('ronos.live_indicator') || 'En vivo'}`

  return (
    <header className="space-y-3">
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ENCABEZADO ÚNICO Y SOBRIO: RONOS · [Tienda] · [Período] · Actualizado   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Título unificado en una sola línea ejecutiva */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                RONOS
              </span>
              <span className="text-slate-400 font-bold">·</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 font-bold text-xs sm:text-sm truncate">
                <Building2 className="w-3.5 h-3.5 shrink-0 text-[#0288d1]" />
                <span className="truncate">{activeStoreName}</span>
              </span>
              <span className="text-slate-400 font-bold">·</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs sm:text-sm">
                <Calendar className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                <span>{activePeriodLabel}</span>
              </span>
              <span className="text-slate-400 font-bold">·</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-medium text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span>{updatedTimeLabel}</span>
              </span>
            </div>
          </div>

          {/* Botón Sincronizar en Vivo (Mínimo 44px de área táctil) */}
          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <button
              type="button"
              onClick={onSyncLive}
              disabled={syncing || isUpdating}
              aria-label={t('ronos.sync_live') || 'Sincronizar en Vivo'}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs inline-flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing || isUpdating ? 'animate-spin text-[#0288d1]' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">
                {syncing
                  ? (t('ronos.syncing') || 'Sincronizando...')
                  : (t('ronos.sync_live') || 'Sincronizar en Vivo')}
              </span>
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SELECTORES DE TIENDA Y PERÍODO (ÁREAS TÁCTILES >= 44px)             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          {/* Selector de Sucursal */}
          <div>
            <label htmlFor="ronos-store-select" className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              {t('ronos.select_store') || 'Sucursal'}
            </label>
            <select
              id="ronos-store-select"
              value={selectedCompanyId}
              onChange={(e) => onStoreChange(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
            >
              <option value={0}>
                {t('ronos.all_stores') || 'Todas las Tiendas (Cadena)'}
              </option>
              {stores.map(st => (
                <option key={st.ronosCompanyId} value={st.ronosCompanyId}>
                  #{st.tegStoreId} · {st.tegName} {st.isBodega ? '(Bodega)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Período */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="ronos-period-select" className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t('ronos.select_period') || 'Período'}
              </label>
              {activeTab === 'payroll' && (
                <div className="flex items-center flex-wrap gap-1 sm:gap-2 text-[11px] font-semibold">
                  <label className="flex items-center gap-1 cursor-pointer min-h-[28px]">
                    <input
                      type="radio"
                      name="headerPayrollBiWeekly"
                      checked={payrollBiWeekly}
                      onChange={() => setPayrollBiWeekly(true)}
                      className="accent-[#0288d1]"
                    />
                    <span className="text-slate-600 dark:text-slate-300">
                      {t('ronos.period_biweekly') || 'Quincenal'}
                    </span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer min-h-[28px]">
                    <input
                      type="radio"
                      name="headerPayrollBiWeekly"
                      checked={!payrollBiWeekly}
                      onChange={() => setPayrollBiWeekly(false)}
                      className="accent-[#0288d1]"
                    />
                    <span className="text-slate-600 dark:text-slate-300">
                      {t('ronos.period_weekly') || 'Semanal'}
                    </span>
                  </label>
                </div>
              )}
            </div>

            {activeTab === 'payroll' && payrollBiWeekly ? (
              <select
                id="ronos-period-select"
                value={selectedBiWeeklyPeriod}
                onChange={(e) => onBiWeeklyPeriodChange(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
              >
                {biWeeklyPeriods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id="ronos-period-select"
                value={selectedWeekId}
                onChange={(e) => onWeekChange(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs sm:text-sm font-bold text-slate-800 dark:text-white cursor-pointer focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
              >
                {weeks.map(w => (
                  <option key={w.weekId} value={w.weekId}>
                    {formatUsaDate(w.startDate)} - {formatUsaDate(w.endDate)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 5 PESTAÑAS COMPACTAS: Resumen | Asistencia | Nómina | Equipo | Admin   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <nav
        aria-label="Pestañas de navegación RONOS"
        className="grid grid-cols-2 sm:grid-cols-5 gap-2"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`min-h-[44px] px-3 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#0288d1] text-white shadow-xs font-black'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Indicador de actualización de filtros */}
      {isUpdating && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-150"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-[#0288d1]" />
          <span>{t('ronos.updating') || 'Actualizando información...'}</span>
        </div>
      )}
    </header>
  )
}
