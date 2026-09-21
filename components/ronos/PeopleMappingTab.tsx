/**
 * @module components/ronos/PeopleMappingTab
 * @description Pestaña de Equipo: Directorio de Personal, Traslados Multi-Tienda y Cola de Revisión 1 a 1.
 *   - Colaboradores activos, traslados confirmados con horas en el período y sin vínculo.
 *   - Cola de revisión manual 1 a 1 con tres acciones explícitas: Confirmar, Descartar, Cancelar.
 *   - Máximo 5 columnas iniciales en escritorio; tarjetas táctiles en móvil.
 *
 * @businessRules
 *   - Un colaborador transferido conserva su identidad y acumula horas en la tienda donde ponchó.
 *   - La vinculación supervisada individual (1 a 1) previene duplicaciones de identidad en nómina.
 *
 * @dataFlow
 *   Interactúa con /api/ronos/mappings y /api/ronos/refresh-transfers.
 *
 * @notes
 *   - Cumple con estándar Mobile-First con controles táctiles >= 44px.
 *   - Bilingüe completo (i18n) sin textos hardcodeados.
 *   - Elimina IDs crudos, assignmentId y tecnicismos.
 */

'use client'

import React, { useState, useMemo } from 'react'
import {
  Users,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Plane,
  XCircle,
  UserX,
  UserCheck,
  Check,
  X,
  RotateCcw
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { MappedEmployeeItem, ToastCandidate } from './types'

interface PeopleMappingTabProps {
  mappingsList: MappedEmployeeItem[]
  toastCandidates: ToastCandidate[]
  mappingStats: {
    totalRonos: number
    autoMatched: number
    manuallyMatched: number
    inactive: number
    unmapped: number
  }
  loading: boolean
  savingMappingId: number | null
  refreshingTransfers: boolean
  storeName?: string
  currentPeriodLabel?: string
  onSaveSingleMapping: (item: MappedEmployeeItem, toastId: string) => Promise<void>
  onRefreshTransfers: () => Promise<void>
}

export default function PeopleMappingTab({
  mappingsList,
  toastCandidates,
  mappingStats,
  loading,
  savingMappingId,
  refreshingTransfers,
  storeName = 'Lynwood',
  currentPeriodLabel = 'Período Visible',
  onSaveSingleMapping,
  onRefreshTransfers
}: PeopleMappingTabProps) {
  const { t } = useLanguage()

  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'transfers' | 'unmapped' | 'matched' | 'inactive'>('all')
  const [selectedToastMap, setSelectedToastMap] = useState<Record<number, string>>({})

  // Filtrado de colaboradores
  const filteredList = useMemo(() => {
    return mappingsList.filter((item) => {
      // 1. Buscador
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim()
        const matchName = item.ronosFullName.toLowerCase().includes(q)
        const matchPin = item.ronosPin.includes(q)
        const matchToast = (item.toastFullName || '').toLowerCase().includes(q)
        const matchTrans = (item.transferredToStore || '').toLowerCase().includes(q)
        if (!matchName && !matchPin && !matchToast && !matchTrans) return false
      }

      // 2. Filtro de vista
      if (filterType === 'transfers') return Boolean(item.transferredToStore)
      if (filterType === 'unmapped') return item.mappingType === 'unmapped'
      if (filterType === 'matched') return item.mappingType === 'auto' || item.mappingType === 'manual'
      if (filterType === 'inactive') return item.mappingType === 'inactive'

      return true
    })
  }, [mappingsList, searchTerm, filterType])

  // Colaboradores pendientes de vincular para la Cola de Revisión 1 a 1
  const reviewQueue = useMemo(() => {
    return mappingsList.filter(m => m.mappingType === 'unmapped')
  }, [mappingsList])

  const transfersCount = mappingsList.filter(m => Boolean(m.transferredToStore)).length
  const activeEmployeesCount = mappingStats.autoMatched + mappingStats.manuallyMatched

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. CUATRO MÉTRICAS EJECUTIVAS: Activos | Traslados | Sin Vínculo | Cola */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
            {t('ronos.team.active_employees') || 'Colaboradores Activos'}
          </span>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            {mappingStats.totalRonos}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">En checador</span>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 block mb-1">
            {t('ronos.team.confirmed_transfers') || 'Traslados Confirmados'}
          </span>
          <div className="text-2xl font-black text-sky-600 dark:text-sky-400 font-mono">
            {transfersCount}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Turnos multi-tienda</span>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-1">
            Vinculados Toast
          </span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
            {activeEmployeesCount}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Identidad unificada</span>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block mb-1">
            {t('ronos.team.unlinked') || 'Sin Vínculo'}
          </span>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
            {mappingStats.unmapped}
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">En cola de revisión</span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. COLA DE REVISIÓN MANUAL 1 A 1 (Confirmar, Descartar, Cancelar)       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {reviewQueue.length > 0 && (
        <section
          aria-labelledby="heading-manual-queue"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-xs p-4 sm:p-5 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-rose-100 dark:border-rose-950">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <h3 id="heading-manual-queue" className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  {t('ronos.team.manual_queue') || 'Cola de Revisión 1 a 1'}
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('ronos.team.manual_queue_desc') || 'Revisión y confirmación de identidad supervisada individual.'}
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
              {reviewQueue.length} pendientes
            </span>
          </div>

          {/* Tarjetas de Revisión 1 a 1 con 3 botones explícitos */}
          <div className="space-y-2.5">
            {reviewQueue.map((item) => {
              const isSaving = savingMappingId === item.ronosEmployeeUserId
              const currentToast = selectedToastMap[item.ronosEmployeeUserId] || ''

              return (
                <div
                  key={item.ronosEmployeeUserId}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                        {item.ronosFullName}
                      </span>
                      {item.ronosPin && (
                        <span className="text-[10px] font-mono text-slate-400">PIN #{item.ronosPin}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {item.transferredToStore ? `Traslado a: ${item.transferredToStore}` : 'Colaborador en checador sin vínculo a Toast POS'}
                    </span>
                  </div>

                  {/* Selector y 3 Botones: Confirmar, Descartar, Cancelar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={currentToast}
                      onChange={(e) => {
                        const val = e.target.value
                        setSelectedToastMap(prev => ({ ...prev, [item.ronosEmployeeUserId]: val }))
                      }}
                      className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-white focus:ring-2 focus:ring-[#0288d1] cursor-pointer flex-1 sm:flex-none sm:min-w-[220px]"
                    >
                      <option value="">{t('ronos.team.select_candidate_placeholder') || 'Seleccionar colaborador...'}</option>
                      {toastCandidates.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.fullName || `${c.first_name || ''} ${c.last_name || ''}`} ({c.jobTitle || 'Crew'})
                        </option>
                      ))}
                    </select>

                    {/* Botón 1: Confirmar */}
                    <button
                      type="button"
                      onClick={() => {
                        if (currentToast) onSaveSingleMapping(item, currentToast)
                      }}
                      disabled={!currentToast || isSaving}
                      className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isSaving ? '...' : (t('ronos.team.btn_confirm') || 'Confirmar')}</span>
                    </button>

                    {/* Botón 2: Descartar (Marcar inactivo) */}
                    <button
                      type="button"
                      onClick={() => onSaveSingleMapping(item, 'INACTIVE')}
                      disabled={isSaving}
                      className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{t('ronos.team.btn_discard') || 'Descartar'}</span>
                    </button>

                    {/* Botón 3: Cancelar Selección */}
                    {currentToast && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedToastMap(prev => {
                            const next = { ...prev }
                            delete next[item.ronosEmployeeUserId]
                            return next
                          })
                        }}
                        className="min-h-[44px] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-white text-xs font-bold transition-all cursor-pointer"
                        title="Cancelar selección"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. DIRECTORIO Y ACCIONES SUPERVISADAS                                   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section
        aria-labelledby="heading-staff-directory"
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden"
      >
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('ronos.team.search_placeholder') || 'Buscar colaborador por nombre, PIN o sucursal...'}
              className="w-full min-h-[44px] pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onRefreshTransfers}
            disabled={refreshingTransfers}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingTransfers ? 'animate-spin text-[#0288d1]' : ''}`} />
            <span>{refreshingTransfers ? 'Escaneando...' : (t('ronos.team.scan_transfers') || 'Escanear Traslados')}</span>
          </button>
        </div>

        {/* Sub-filtro de Pestañas */}
        <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 ${
              filterType === 'all'
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t('ronos.team.filter_all') || 'Todos'} ({mappingsList.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('transfers')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1 ${
              filterType === 'transfers'
                ? 'bg-sky-600 text-white'
                : 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
            }`}
          >
            <Plane className="w-3 h-3" />
            <span>{t('ronos.team.filter_transfers') || 'Traslados'} ({transfersCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('unmapped')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1 ${
              filterType === 'unmapped'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
            }`}
          >
            <AlertTriangle className="w-3 h-3" />
            <span>{t('ronos.team.filter_unmapped') || 'Cola de Revisión'} ({mappingStats.unmapped})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('matched')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1 ${
              filterType === 'matched'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>{t('ronos.team.filter_matched') || 'Vinculados'} ({activeEmployeesCount})</span>
          </button>
        </div>

        {/* VISTA ESCRITORIO: MÁXIMO 5 COLUMNAS INICIALES */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4">{t('ronos.team.col_employee') || 'Colaborador'}</th>
                <th className="py-3 px-3 text-center">{t('ronos.team.col_pin') || 'PIN'}</th>
                <th className="py-3 px-3">{t('ronos.team.col_toast_profile') || 'Identidad Toast POS'}</th>
                <th className="py-3 px-3 text-center">{t('ronos.team.col_store') || 'Sucursal / Traslado'}</th>
                <th className="py-3 px-4 text-center">{t('ronos.team.col_actions') || 'Acción'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0288d1]" />
                    <span>Cargando directorio...</span>
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    No se encontraron colaboradores para este filtro.
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const isSaving = savingMappingId === item.ronosEmployeeUserId

                  return (
                    <tr key={item.ronosEmployeeUserId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        {item.ronosFullName}
                      </td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                        {item.ronosPin || '—'}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {item.toastFullName || '—'}
                          </span>
                          {item.toastJobTitle && (
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({item.toastJobTitle})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.transferredToStore ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                            <Plane className="w-3 h-3" />
                            <span>{item.transferredToStore}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {item.mappingType === 'unmapped' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            Pendiente Revisión
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSaveSingleMapping(item, 'INACTIVE')}
                            disabled={isSaving}
                            className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <UserX className="w-3.5 h-3.5 text-slate-400" />
                            <span>Desvincular</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* VISTA MÓVIL: TARJETAS LEGIBLES */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredList.map((item) => (
            <div key={item.ronosEmployeeUserId} className="p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900 dark:text-white">{item.ronosFullName}</span>
                {item.ronosPin && <span className="text-xs font-mono text-slate-400">PIN #{item.ronosPin}</span>}
              </div>
              <div className="text-xs text-slate-500">
                Toast: <strong className="text-slate-700 dark:text-slate-300">{item.toastFullName || 'Sin vincular'}</strong>
              </div>
              {item.transferredToStore && (
                <div className="text-[11px] text-sky-600 font-bold flex items-center gap-1">
                  <Plane className="w-3 h-3" />
                  <span>Traslado: {item.transferredToStore}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
