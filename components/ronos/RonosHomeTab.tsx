/**
 * @module components/ronos/RonosHomeTab
 * @description Pestaña Resumen Ejecutivo del módulo RONOS para Tacos Gavilan.
 *   - Estructurado en 3 pilares operativos de alta claridad:
 *     1. Requiere revisión (alertas de jornada hoy en tienda vs incidencias consolidadas en cadena).
 *     2. Todo en orden (sucursales y turnos conforme a estándar, con cálculo real de cobertura).
 *     3. Sin información suficiente (tiendas con fallas de conexión o registros faltantes).
 *
 * @businessRules
 *   - Día laboral oficial: 6:00 AM a 5:59 AM del día siguiente (horario Los Ángeles).
 *   - En vista corporativa (selectedCompanyId === 0), NO se emiten falsos ceros de checador ("0 abiertas hoy");
 *     se expone aviso operativo de auditoría en vivo por sucursal.
 *   - Desacoplamiento temporal estricto: la jornada actual no se mezcla con descansos semanales ni nómina quincenal.
 *   - Cobertura real: contrasta el total esperado de sucursales contra tiendas activas y failedStores sin inflar porcentajes.
 *
 * @dataFlow
 *   Recibe chainData, payrollData, storeData, stores y controladores desde app/admin/ronos/page.tsx.
 *
 * @notes
 *   - Mobile-First con controles táctiles >= 44px.
 *   - Bilingüe completo (i18n) usando useLanguage() sin textos hardcodeados.
 *   - Cumple con directiva de cero falsas alarmas, cero falsos ceros y datos auditables.
 */

'use client'

import React, { useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Clock,
  Receipt,
  Building2,
  ArrowRight,
  RefreshCw
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { ChainAuditData, PayrollReportData, StoreAuditData, StoreOption } from './types'
import { RonosTabId } from './RonosHeader'
import { detectTodayAnomalies } from './helpers'

interface RonosHomeTabProps {
  chainData: ChainAuditData | null
  payrollData: PayrollReportData | null
  storeData: StoreAuditData | null
  selectedCompanyId: number
  stores: StoreOption[]
  loading: boolean
  onNavigateToTab: (tab: RonosTabId) => void
  onSelectStore: (companyId: number) => void
}

export default function RonosHomeTab({
  chainData,
  payrollData,
  storeData,
  selectedCompanyId,
  stores,
  loading,
  onNavigateToTab,
  onSelectStore
}: RonosHomeTabProps) {
  const { t } = useLanguage()

  // 1. ANÁLISIS OPERATIVO DE SUCURSALES (CON O SIN INCIDENCIAS)
  const storesAnalysis = useMemo(() => {
    const rawStores = chainData?.stores || []
    const failedCompanyIds = new Set((chainData as any)?.failedStores?.map((f: any) => f.ronosCompanyId) || [])
    const withIssues: typeof rawStores = []
    const inOrder: typeof rawStores = []
    const insufficient: typeof rawStores = []

    for (const st of rawStores) {
      const broken = st.brokenTimecards ?? st.brokenEmployeesCount ?? 0
      const mealIssues = st.mealPenaltiesCount || 0
      // El endpoint corporativo entrega `activeEmployees`; el detalle individual usa
      // `totalEmployees`. Ambos representan evidencia de tarjetas para esta vista.
      const totalEmp = st.activeEmployees ?? st.totalEmployees ?? 0

      // Si no tiene registros o no respondió la conexión en la auditoría
      if (totalEmp === 0 || failedCompanyIds.has(st.ronosCompanyId)) {
        insufficient.push(st)
      } else if (broken > 0 || mealIssues > 0) {
        withIssues.push(st)
      } else {
        inOrder.push(st)
      }
    }

    return { withIssues, inOrder, insufficient }
  }, [chainData?.stores, (chainData as any)?.failedStores])

  // 2. INCIDENCIAS DE CHECADOR Y TARJETAS
  const totalBrokenPunches = useMemo(() => {
    if (selectedCompanyId === 0) {
      return (chainData?.stores || []).reduce((acc, s) => acc + (s.brokenTimecards ?? s.brokenEmployeesCount ?? 0), 0)
    }
    return storeData?.brokenTimecardsCount || 0
  }, [selectedCompanyId, chainData?.stores, storeData?.brokenTimecardsCount])

  const totalMealIssues = useMemo(() => {
    if (selectedCompanyId === 0) {
      return (chainData?.stores || []).reduce((acc, s) => acc + (s.mealPenaltiesCount || 0), 0)
    }
    return storeData?.mealPenaltiesCount || 0
  }, [selectedCompanyId, chainData?.stores, storeData?.mealPenaltiesCount])

  // 3. RECIBOS PENDIENTES EN NÓMINA
  const pendingPaystubs = useMemo(() => {
    return (payrollData?.unmatchedPaystubs || []).filter(
      s => s.category === 'pending_native_link'
    )
  }, [payrollData?.unmatchedPaystubs])

  // 4. ANOMALÍAS CONFIRMADAS DE HOY EN VIVO + Revisiones semanales pendientes
  const anomalyResults = useMemo(() => {
    if (storeData?.employees && Array.isArray(storeData.employees)) {
      return detectTodayAnomalies(storeData.employees)
    }
    return { openToday: [], historicalBroken: [], pendingWeeklyReview: [] }
  }, [storeData?.employees])

  const todayAnomalies = anomalyResults.openToday
  const pendingWeeklyCount = anomalyResults.pendingWeeklyReview.length

  const openTodayCount = todayAnomalies.length
  const isChainView = selectedCompanyId === 0
  const totalExpectedStores = stores.length > 0 ? stores.length : 16

  // Hallazgo A: Distinguir "0 anomalías con datos reales" de "0 anomalías porque no hay datos cargados".
  // Sin esta bandera, storeData === null produce openTodayCount === 0 y se muestra "Checador al día" (falso cero).
  const hasStoreData = !isChainView && storeData !== null && Array.isArray(storeData?.employees)
  // Hallazgo D: Evitar falso "0 recibos pendientes" cuando payrollData aún no se cargó.
  const hasPayrollData = payrollData !== null

  // REGLA CRÍTICA: Desacoplar alertas de hoy vs semanales vs nómina.
  // - En vista de tienda individual: las alertas urgentes de hoy son ÚNICAMENTE las del turno actual (`openTodayCount`).
  // - En vista corporativa de cadena: las alertas son las sucursales con incidencias activas + recibos pendientes.
  const urgentAlertsCount = isChainView
    ? storesAnalysis.withIssues.length + pendingPaystubs.length
    : openTodayCount
  const hasImmediateIssues = urgentAlertsCount > 0

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center shadow-xs">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-[#0288d1]" />
        <p className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
          {t('ronos.updating') || 'Actualizando información...'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3 PILARES OPERATIVOS: Requiere revisión | Todo en orden | Sin info       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* PILAR 1: REQUIERE REVISIÓN                                          */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="heading-requires-review"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 p-5 shadow-xs flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-rose-100 dark:border-rose-950">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="heading-requires-review" className="text-sm font-black text-slate-900 dark:text-white">
                    {t('ronos.summary.requires_review') || 'Requiere Revisión'}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isChainView
                      ? (t('ronos.summary.requires_review_desc_chain') || 'Incidencias consolidadas en la cadena.')
                      : (t('ronos.summary.requires_review_desc') || 'Incidencias detectadas en la jornada y período.')}
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-black ${
                hasImmediateIssues
                  ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}>
                {urgentAlertsCount}
              </span>
            </div>

            {/* Lista de alertas con período explícito y sin falso cero corporativo */}
            <div className="space-y-2 text-xs">
              {/* Alerta Abiertas Hoy */}
              {isChainView ? (
                /* VISTA CADENA: No inventar 0 abiertas hoy; mostrar estado neutral con acción a tienda */
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                  <div className="min-w-0 pr-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                        {t('ronos.summary.chain_live_notice_title') || 'Detalle en vivo por tienda'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {t('ronos.summary.period_today') || 'Jornada Hoy'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block leading-tight">
                      {t('ronos.summary.chain_live_notice_desc') || 'Las anomalías del checador de la jornada actual se auditan por sucursal.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateToTab('attendance')}
                    className="px-2.5 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 font-bold text-xs shrink-0 flex items-center gap-1 cursor-pointer hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors"
                  >
                    <span>{t('ronos.tabs.attendance') || 'Asistencia'}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ) : !hasStoreData ? (
                /* TIENDA INDIVIDUAL SIN DATOS CARGADOS — NO afirmar "todo bien" sin evidencia (Hallazgo A) */
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-bold text-slate-700 dark:text-slate-300 block">
                        {t('ronos.summary.no_store_data') || 'Datos del checador no disponibles'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
                        {t('ronos.summary.period_today') || 'Jornada Hoy'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('ronos.summary.no_store_data_desc') || 'Selecciona una tienda o sincroniza para consultar el estado del checador.'}
                    </span>
                  </div>
                  <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
              ) : openTodayCount > 0 ? (
                /* TIENDA INDIVIDUAL CON ANOMALÍAS ACTIVAS HOY */
                <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-bold text-rose-900 dark:text-rose-200 block">
                        {t('ronos.summary.open_today') || 'Abiertas hoy'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                        {t('ronos.summary.period_today') || 'Jornada Hoy'}
                      </span>
                    </div>
                    <span className="text-[11px] text-rose-700 dark:text-rose-400">
                      {t('ronos.summary.open_today_desc') || 'Turnos activos de la jornada laboral actual con anomalías de ponchada.'}
                    </span>
                  </div>
                  <span className="text-base font-mono font-black text-rose-600 dark:text-rose-400">
                    {openTodayCount}
                  </span>
                </div>
              ) : (
                /* TIENDA INDIVIDUAL CON CHECADOR AL DÍA */
                <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-bold text-emerald-900 dark:text-emerald-200 block">
                        {t('ronos.summary.open_today_zero') || '0 abiertas hoy · Checador al día'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                        {t('ronos.summary.period_today') || 'Jornada Hoy'}
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      {t('ronos.summary.open_today_desc') || 'Turnos activos de la jornada laboral actual con anomalías de ponchada.'}
                    </span>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                </div>
              )}

              {/* Alerta Descansos de Comida (Período Semanal) */}
              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-bold text-amber-900 dark:text-amber-200 block">
                      {t('ronos.summary.breaks_to_review') || 'Descansos por revisar (>5h)'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                      {t('ronos.summary.period_week') || 'Semana'}
                    </span>
                  </div>
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">
                    {t('ronos.summary.breaks_to_review_desc') || 'Turnos mayores a 5 horas sin descanso registrado en la semana.'}
                  </span>
                </div>
                <span className="text-base font-mono font-black text-amber-600 dark:text-amber-300">
                  {hasStoreData || (selectedCompanyId === 0 && chainData) ? totalMealIssues : '—'}
                </span>
              </div>

              {/* Alerta Revisiones Semanales Pendientes */}
              {!isChainView && hasStoreData && pendingWeeklyCount > 0 && (
                <div className="p-3 rounded-xl bg-violet-50/70 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/40 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-bold text-violet-900 dark:text-violet-200 block">
                        {t('ronos.summary.weekly_review') || 'Revisiones semanales pendientes'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-violet-100 dark:bg-violet-900/60 text-violet-800 dark:text-violet-300">
                        {t('ronos.summary.period_week') || 'Semana'}
                      </span>
                    </div>
                    <span className="text-[11px] text-violet-700 dark:text-violet-400">
                      {t('ronos.summary.weekly_review_desc') || 'Empleados con bandera semanal de horas rotas sin detalle diario específico.'}
                    </span>
                  </div>
                  <span className="text-base font-mono font-black text-violet-600 dark:text-violet-300">
                    {pendingWeeklyCount}
                  </span>
                </div>
              )}

              {/* Alerta Recibos Pendientes (Período Quincenal de Nómina) */}
              <div className="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-bold text-sky-900 dark:text-sky-200 block">
                      {t('ronos.summary.pending_stubs') || 'Recibos pendientes de nómina'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300">
                      {t('ronos.summary.period_biweek') || 'Quincena'}
                    </span>
                  </div>
                  <span className="text-[11px] text-sky-700 dark:text-sky-400">
                    {t('ronos.summary.pending_stubs_desc') || 'Pagos registrados en Simplify HR sin tarjeta checador asociada.'}
                  </span>
                </div>
                <span className="text-base font-mono font-black text-sky-600 dark:text-sky-300">
                  {hasPayrollData ? pendingPaystubs.length : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2">
            <button
              type="button"
              onClick={() => onNavigateToTab('attendance')}
              className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{t('ronos.tabs.attendance') || 'Asistencia'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateToTab('payroll')}
              className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>{t('ronos.tabs.payroll') || 'Nómina'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* PILAR 2: TODO EN ORDEN                                              */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="heading-in-order"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 p-5 shadow-xs flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-emerald-100 dark:border-emerald-950">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="heading-in-order" className="text-sm font-black text-slate-900 dark:text-white">
                    {t('ronos.summary.in_order') || 'Todo en Orden'}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('ronos.summary.in_order_desc') || 'Operando conforme al estándar.'}
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-mono font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                {storesAnalysis.inOrder.length}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
                <span className="font-bold text-emerald-900 dark:text-emerald-200 block mb-0.5">
                  {t('ronos.summary.stores_clean') || 'Sucursales sin incidencias'}
                </span>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  {storesAnalysis.inOrder.length === totalExpectedStores && storesAnalysis.insufficient.length === 0
                    ? (t('ronos.summary.stores_clean_all', { total: totalExpectedStores }) || `Todas las ${totalExpectedStores} ubicaciones operan conforme al estándar sin incidencias.`)
                    : (t('ronos.summary.stores_clean_desc', { count: storesAnalysis.inOrder.length, total: totalExpectedStores }) || `${storesAnalysis.inOrder.length} de ${totalExpectedStores} ubicaciones operan con checador y descansos conforme al estándar.`)}
                </p>
              </div>

              {/* Muestra rápida de tiendas limpias */}
              <div className="max-h-[160px] overflow-y-auto space-y-1.5 pr-1">
                {storesAnalysis.inOrder.map(st => (
                  <div
                    key={st.ronosCompanyId}
                    className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]"
                  >
                    <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                      #{st.tegStoreId} · {st.storeName}
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                      ✓ {t('ronos.summary.in_order') || 'En regla'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 mt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onNavigateToTab('attendance')}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{t('ronos.summary.view_details') || 'Ver Sucursales'}</span>
            </button>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* PILAR 3: SIN INFORMACIÓN SUFICIENTE                                 */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="heading-insufficient"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="heading-insufficient" className="text-sm font-black text-slate-900 dark:text-white">
                    {t('ronos.summary.insufficient_info') || 'Sin Información'}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('ronos.summary.insufficient_info_desc') || 'Tiendas o registros sin datos.'}
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-mono font-black bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {storesAnalysis.insufficient.length}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {storesAnalysis.insufficient.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500 dark:text-slate-400 py-8">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                  <p className="font-bold text-xs text-slate-700 dark:text-slate-300">
                    {t('ronos.summary.no_insufficient_data') || 'Toda la información está validada.'}
                  </p>
                  <p className="text-[11px] mt-1">
                    {t('ronos.summary.no_insufficient_data_desc', { total: totalExpectedStores }) || `Las ${totalExpectedStores} sucursales cuentan con información validada.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    <span className="font-bold block mb-0.5">
                      {t('ronos.summary.connection_review') || 'Sin datos / conexión por revisar'}
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('ronos.summary.connection_review_desc') || 'Sucursales sin ponchadas registradas o sin respuesta del servicio durante la auditoría.'}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    {storesAnalysis.insufficient.map(st => (
                      <div
                        key={st.ronosCompanyId}
                        className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px]"
                      >
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          #{st.tegStoreId} · {st.storeName}
                        </span>
                        <span className="text-slate-400 italic">{t('ronos.summary.no_data_label') || 'Sin datos'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 mt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onNavigateToTab('admin')}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <span>{t('ronos.tabs.admin') || 'Ver Diagnóstico de Conexiones'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SEGUIMIENTO HISTÓRICO DEL PERÍODO (BLOQUE NEUTRO DE AUDITORÍA)         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section
        aria-labelledby="heading-historical-tracking"
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 id="heading-historical-tracking" className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                {t('ronos.summary.historical_tracking_title') || 'Seguimiento Histórico del Período'}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {t('ronos.summary.historical_tracking_badge') || 'Historial Semanal'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
              {t('ronos.summary.historical_tracking_desc') || 'Tarjetas de días anteriores con ponchadas faltantes acumuladas en la semana. Se auditan en el Kardex y no representan incidencias abiertas hoy.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
          <div className="text-right">
            <span className="text-xl sm:text-2xl font-black font-mono text-slate-800 dark:text-slate-200 block">
              {totalBrokenPunches}
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {t('ronos.summary.under_review_label') || 'En revisión'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToTab('attendance')}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <span>{t('ronos.tabs.attendance') || 'Asistencia'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* LISTA OPERATIVA: SUCURSALES CON INCIDENCIAS A REVISAR                   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {storesAnalysis.withIssues.length > 0 && (
        <section
          aria-labelledby="heading-stores-with-issues"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden"
        >
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <h3 id="heading-stores-with-issues" className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {t('ronos.summary.stores_with_issues') || 'Sucursales con Incidencias Inmediatas'}
            </h3>
            <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">
              {storesAnalysis.withIssues.length} {t('ronos.summary.stores_label') || 'sucursales'}
            </span>
          </div>

          {/* VISTA ESCRITORIO (MÁXIMO 5 COLUMNAS INICIALES) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">{t('ronos.col_store_name') || 'Sucursal'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.col_active_staff') || 'Colaboradores'}</th>
                  <th className="py-3 px-3 text-center text-slate-600 dark:text-slate-400 font-bold">
                    {t('ronos.summary.historical_incomplete_col') || 'Historial Incompletas'}
                  </th>
                  <th className="py-3 px-3 text-center text-amber-600 font-bold">
                    {t('ronos.summary.breaks_to_review') || 'Descansos por Revisar'}
                  </th>
                  <th className="py-3 px-4 text-center">{t('ronos.col_action') || 'Acción'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {storesAnalysis.withIssues.map((st) => (
                  <tr key={st.ronosCompanyId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      #{st.tegStoreId} · {st.storeName}
                    </td>
                    <td className="py-3 px-3 text-center font-mono">
                      {st.totalEmployees}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-slate-600 dark:text-slate-400">
                      {st.brokenTimecards ?? st.brokenEmployeesCount ?? 0}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                      {st.mealPenaltiesCount || 0}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectStore(st.ronosCompanyId)
                          onNavigateToTab('attendance')
                        }}
                        className="min-h-[44px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 font-bold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <span>{t('ronos.summary.jump_to_store') || 'Ir a Tienda'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* VISTA MÓVIL: TARJETAS LEGIBLES (CONTROLES >= 44px) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {storesAnalysis.withIssues.map((st) => (
              <div key={st.ronosCompanyId} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-black text-sm text-slate-900 dark:text-white">
                    #{st.tegStoreId} · {st.storeName}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {st.totalEmployees} {t('ronos.payroll.employees_count') || 'colabs'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    <span className="block text-[10px] uppercase font-bold text-slate-500">
                      {t('ronos.summary.historical_incomplete_col') || 'Historial Incompletas'}
                    </span>
                    <span className="text-base font-black font-mono">
                      {st.brokenTimecards ?? st.brokenEmployeesCount ?? 0}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200">
                    <span className="block text-[10px] uppercase font-bold text-amber-500">{t('ronos.summary.breaks_to_review') || 'Descansos >5h'}</span>
                    <span className="text-base font-black font-mono">{st.mealPenaltiesCount || 0}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSelectStore(st.ronosCompanyId)
                    onNavigateToTab('attendance')
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-[#0288d1] font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>{t('ronos.summary.jump_to_store') || 'Ir a Tienda'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
