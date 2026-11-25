'use client'

/**
 * @module app/admin/food-cost/teorico-vs-fisico/page
 * @description Tablero y Reporte Ejecutivo Integral "Platillos Vendidos & Consumo Teórico (POS) vs. Consumo Físico Real (Sobrantes + Bodega)"
 *   diseñado para Dirección General, Gerencia de Operaciones y Supervisores de Tacos Gavilan.
 *
 * @businessRules
 *   - 100% bilingüe (`ES` / `EN`) mediante `useLanguage()` (`t('tvf.*')`).
 *   - Concilia para 1 sucursal o las 15 sucursales consolidadas:
 *     1. Todos los platillos vendidos en caja (10 familias del menú: Tacos, Burritos, Quesadillas, Mulitas, Sopes, Tortas, Platos/Nachos/Desayunos, Party Trays, Sides y Aguas/Bebidas/Postres).
 *     2. Todos los insumos alimenticios y de cocina de Orden Diaria (~45 SKUs): gasto teórico POS vs. gasto físico real (`Ini + Bodega QBO ± Traspasos − Cierre`), diferencias en unidades, peso/piezas, costos Tienda y Bodega USD, gramaje real por porción y equivalencia en platillos.
 *     3. Comparativa lado a lado de las 15 sucursales con ranking de eficiencia e impacto económico.
 *   - Soporta exportación completa a Excel (`CSV` UTF-8 con BOM) e impresión limpia en PDF ejecutivo (`window.print()`).
 *
 * @dataFlow
 *   `GET /api/food-cost/teorico-vs-fisico?storeId=...&startDate=...&endDate=...` -> estado React -> Tablero + CSV + Print.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Info,
  Printer,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
} from 'lucide-react'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import SurpriseLoader from '@/components/SurpriseLoader'
import {
  ExecutiveDishesPanel,
  ExecutiveStoresRankingPanel,
  StatusPill,
} from '@/components/food-cost/ExecutiveDishesAndStoresPanels'
import { useLanguage } from '@/lib/i18n'
import type {
  ExecutiveProductCategory,
  ExecutiveProductComparisonRow,
  ExecutiveTheoreticalVsPhysicalReport,
} from '@/lib/inventory/executive-theoretical-vs-physical'

function computeClosedBusinessDateLA(daysBackFromToday = 1): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (tp: string) => parts.find((p) => p.type === tp)?.value || '00'
  const y = Number(get('year'))
  const m = Number(get('month'))
  const d = Number(get('day'))
  const hr = Number(get('hour'))
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  if (hr < 6) dt.setUTCDate(dt.getUTCDate() - 1)
  dt.setUTCDate(dt.getUTCDate() - daysBackFromToday)
  return dt.toISOString().slice(0, 10)
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const dt = new Date(`${iso}T12:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().slice(0, 10)
}

function fmtUsd(val: number, decimals = 0): string {
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${val < 0 ? '-' : ''}$${abs}`
}

function fmtSignedUsd(val: number, decimals = 0): string {
  if (Math.abs(val) < 0.005) return '$0'
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${val > 0 ? '+' : '-'}$${abs}`
}

function fmtSignedNum(val: number, decimals = 1): string {
  if (Math.abs(val) < 0.05) return '0'
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${val > 0 ? '+' : '-'}${abs}`
}

function escapeCsvCell(raw: unknown): string {
  const s = String(raw ?? '')
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

export default function ExecutiveTheoreticalVsPhysicalPage() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'

  const defaultEnd = useMemo(() => computeClosedBusinessDateLA(1), [])
  const defaultStart = useMemo(() => shiftIsoDate(defaultEnd, -6), [defaultEnd])

  const [storeId, setStoreId] = useState<string>('all')
  const [startDate, setStartDate] = useState<string>(defaultStart)
  const [endDate, setEndDate] = useState<string>(defaultEnd)
  const [draftStartDate, setDraftStartDate] = useState<string>(defaultStart)
  const [draftEndDate, setDraftEndDate] = useState<string>(defaultEnd)
  const [activePreset, setActivePreset] = useState<'1d' | '7d' | '14d' | '30d' | 'custom'>('7d')
  const [costMode, setCostMode] = useState<'store' | 'bodega'>('store')

  const [categoryFilter, setCategoryFilter] = useState<'all' | ExecutiveProductCategory>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [onlySignificantVariances, setOnlySignificantVariances] = useState<boolean>(false)
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set())

  const [report, setReport] = useState<ExecutiveTheoreticalVsPhysicalReport | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const initializedFromUrl = useRef(false)

  useEffect(() => {
    if (initializedFromUrl.current || typeof window === 'undefined') return
    initializedFromUrl.current = true
    const sp = new URLSearchParams(window.location.search)
    const urlStore = sp.get('storeId') || sp.get('store')
    const urlStart = sp.get('startDate')
    const urlEnd = sp.get('endDate')
    if (urlStore) setStoreId(urlStore)
    if (urlStart && /^\d{4}-\d{2}-\d{2}$/.test(urlStart) && urlEnd && /^\d{4}-\d{2}-\d{2}$/.test(urlEnd) && urlStart <= urlEnd) {
      setStartDate(urlStart)
      setEndDate(urlEnd)
      setDraftStartDate(urlStart)
      setDraftEndDate(urlEnd)
      setActivePreset('custom')
    }
  }, [])

  const loadReport = useCallback(async (targetStore: string, sDate: string, eDate: string) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setErrorMsg(null)

    try {
      const qs = new URLSearchParams({
        storeId: targetStore,
        startDate: sDate,
        endDate: eDate,
      })
      const res = await fetch(`/api/food-cost/teorico-vs-fisico?${qs.toString()}`, {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      setReport(json as ExecutiveTheoreticalVsPhysicalReport)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setErrorMsg(err?.message || 'Error')
    } finally {
      if (abortRef.current === ctrl) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadReport(storeId, startDate, endDate)
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [storeId, startDate, endDate, loadReport])

  const applyPreset = (preset: '1d' | '7d' | '14d' | '30d') => {
    const end = computeClosedBusinessDateLA(1)
    const delta = preset === '1d' ? 0 : preset === '7d' ? -6 : preset === '14d' ? -13 : -29
    const start = shiftIsoDate(end, delta)
    setActivePreset(preset)
    setDraftStartDate(start)
    setDraftEndDate(end)
    setStartDate(start)
    setEndDate(end)
  }

  const handleApplyCustomDates = () => {
    if (!draftStartDate || !draftEndDate || draftStartDate > draftEndDate) return
    setActivePreset('custom')
    setStartDate(draftStartDate)
    setEndDate(draftEndDate)
  }

  const toggleExpandProduct = (itemId: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const filteredProducts = useMemo(() => {
    if (!report) return []
    const q = searchQuery.trim().toLowerCase()
    return report.productRows.filter((row) => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false
      if (onlySignificantVariances) {
        if (!row.hasMeasuredSpan) return false
        if (Math.abs(row.diffCostStoreUsd) < 30 && (row.diffPct === null || Math.abs(row.diffPct) < 8)) {
          return false
        }
      }
      if (q) {
        const hay = `${row.name} ${row.sku} ${row.relatedDishesEs} ${row.relatedDishesEn}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [report, categoryFilter, onlySignificantVariances, searchQuery])

  const filteredTotals = useMemo(() => {
    return filteredProducts.reduce(
      (acc, r) => {
        if (!r.hasMeasuredSpan) return acc
        acc.measuredCount += 1
        acc.theoStore += r.theoCostStoreUsd
        acc.theoBodega += r.theoCostBodegaUsd
        acc.physStore += r.physicalCostStoreUsd
        acc.physBodega += r.physicalCostBodegaUsd
        acc.diffStore += r.diffCostStoreUsd
        acc.diffBodega += r.diffCostBodegaUsd
        return acc
      },
      {
        measuredCount: 0,
        theoStore: 0,
        theoBodega: 0,
        physStore: 0,
        physBodega: 0,
        diffStore: 0,
        diffBodega: 0,
      }
    )
  }, [filteredProducts])

  const handleExportCsv = () => {
    if (!report) return
    const headers = isEn
      ? [
          'Store / Scope',
          'Start Date',
          'End Date',
          'SKU',
          'Product',
          'Category',
          'Unit',
          'Related Dishes Sold',
          'Opening Leftover',
          'Warehouse Delivered (QBO)',
          'Transfers Net',
          'Closing Leftover',
          'Theoretical Usage (Units)',
          'Actual Physical Usage (Units)',
          'Qty Difference (Units)',
          'Daily Avg Diff',
          'Base Measure',
          'Theoretical Base Qty',
          'Physical Base Qty',
          'Diff %',
          'Theoretical Cost Store (USD)',
          'Actual Cost Store (USD)',
          'Cost Difference Store (USD)',
          'Cost Difference Warehouse (USD)',
          'Actual Oz / Taco',
          'Equivalent Tacos Diff (1.5 oz)',
          'Status',
        ]
      : [
          'Sucursal / Alcance',
          'Fecha Inicio',
          'Fecha Fin',
          'SKU',
          'Producto',
          'Categoría',
          'Presentación',
          'Platillos Vendidos Relacionados',
          'Sobrante Inicial',
          'Entregas Bodega (QBO)',
          'Traspasos Netos',
          'Sobrante Cierre',
          'Consumo Teórico (Unidades)',
          'Consumo Físico Real (Unidades)',
          'Diferencia Cantidad',
          'Promedio Diario Dif.',
          'Unidad Base',
          'Cantidad Base Teórica',
          'Cantidad Base Física',
          'Variación %',
          'Costo Teórico Tienda (USD)',
          'Costo Físico Tienda (USD)',
          'Diferencia Costo Tienda (USD)',
          'Diferencia Costo Bodega (USD)',
          'Onzas Reales / Taco',
          'Tacos Equivalentes Dif. (1.5 oz)',
          'Estado',
        ]

    const lines = [headers.map(escapeCsvCell).join(',')]
    for (const r of filteredProducts) {
      const row = [
        report.meta.storeName,
        report.meta.startDate,
        report.meta.endDate,
        r.sku,
        r.name,
        r.category,
        isEn ? r.unitLabelEn : r.unitLabelEs,
        isEn ? r.relatedDishesEn : r.relatedDishesEs,
        r.hasMeasuredSpan ? r.openingUnits : '',
        r.hasMeasuredSpan ? r.arrivedUnits : '',
        r.hasMeasuredSpan ? r.transferNetUnits : '',
        r.hasMeasuredSpan ? r.closingUnits : '',
        r.theoUnits,
        r.hasMeasuredSpan ? r.physicalUnits : '',
        r.hasMeasuredSpan ? r.diffUnits : '',
        r.hasMeasuredSpan ? r.diffUnitsPerDay : '',
        r.baseMeasure,
        r.theoBaseQty,
        r.hasMeasuredSpan ? r.physicalBaseQty : '',
        r.diffPct !== null ? `${r.diffPct}%` : '',
        r.theoCostStoreUsd,
        r.hasMeasuredSpan ? r.physicalCostStoreUsd : '',
        r.hasMeasuredSpan ? r.diffCostStoreUsd : '',
        r.hasMeasuredSpan ? r.diffCostBodegaUsd : '',
        r.realAvgOzPerTaco !== null ? r.realAvgOzPerTaco : '',
        r.equivTacos15Oz !== null ? r.equivTacos15Oz : '',
        r.status,
      ]
      lines.push(row.map(escapeCsvCell).join(','))
    }

    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `TacosGavilan_Teorico_vs_Fisico_${report.meta.storeId}_${report.meta.startDate}_${report.meta.endDate}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const kpis = report?.kpis
  const primaryTheoCost = kpis ? (costMode === 'store' ? kpis.theoCostStoreUsd : kpis.theoCostBodegaUsd) : 0
  const primaryPhysCost = kpis ? (costMode === 'store' ? kpis.physicalCostStoreUsd : kpis.physicalCostBodegaUsd) : 0
  const primaryDiffCost = kpis ? (costMode === 'store' ? kpis.varianceCostStoreUsd : kpis.varianceCostBodegaUsd) : 0
  const secondaryDiffCost = kpis ? (costMode === 'store' ? kpis.varianceCostBodegaUsd : kpis.varianceCostStoreUsd) : 0

  const categoryTabs: Array<{ id: 'all' | ExecutiveProductCategory; labelKey: string }> = [
    { id: 'all', labelKey: 'tvf.cat_all' },
    { id: 'meats', labelKey: 'tvf.cat_meats' },
    { id: 'tortillas_bread', labelKey: 'tvf.cat_tortillas_bread' },
    { id: 'dairy_avocado', labelKey: 'tvf.cat_dairy_avocado' },
    { id: 'rice_beans_kitchen', labelKey: 'tvf.cat_rice_beans_kitchen' },
    { id: 'aguas_champurrado', labelKey: 'tvf.cat_aguas_champurrado' },
    { id: 'salsas_produce_packaging', labelKey: 'tvf.cat_salsas_produce_packaging' },
  ]

  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-5 print:px-0 print:py-0">
      <div className="print:hidden">
        <FoodCostNavigationTabs
          preserveParams={{
            startDate,
            endDate,
            storeId,
          }}
        />
      </div>

      {/* CABECERA EJECUTIVA */}
      <header className="bg-gradient-to-r from-slate-900 via-red-950 to-slate-900 text-white rounded-2xl p-5 md:p-6 mb-5 shadow-lg border border-red-900/40 print:bg-white print:text-slate-900 print:border-slate-300 print:shadow-none">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/20 border border-red-400/30 text-red-200 text-[11px] font-black tracking-wider uppercase print:bg-slate-100 print:text-slate-800">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('tvf.badge_executive')}</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black mt-2 tracking-tight">
              {t('tvf.title')}
            </h1>
            <p className="text-xs md:text-sm text-slate-300 mt-1 max-w-4xl print:text-slate-600">
              {t('tvf.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {/* Selector Costo Tienda vs Bodega */}
            <div className="inline-flex rounded-xl bg-slate-800/90 p-1 border border-slate-700">
              <button
                type="button"
                onClick={() => setCostMode('store')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  costMode === 'store'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {t('tvf.cost_mode_store')}
              </button>
              <button
                type="button"
                onClick={() => setCostMode('bodega')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                  costMode === 'bodega'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {t('tvf.cost_mode_bodega')}
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!report || loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold shadow transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{t('tvf.export_csv_btn')}</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              disabled={!report || loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 disabled:opacity-50 text-white text-xs font-extrabold border border-white/20 transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>{t('tvf.print_pdf_btn')}</span>
            </button>
          </div>
        </div>

        {/* BARRA DE FILTROS: SUCURSAL + PRESETS + FECHAS */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-end gap-3 print:hidden">
          <div className="min-w-[240px] flex-1 sm:flex-initial">
            <label className="block text-[11px] font-bold uppercase text-slate-300 mb-1">
              {t('tvf.store_label')}
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-xs font-extrabold focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">{t('tvf.all_15_stores')}</option>
                {(report?.storesCatalog || []).map((st) => (
                  <option key={st.id} value={String(st.id)}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-700">
            {(['1d', '7d', '14d', '30d'] as const).map((preset) => {
              const labelKey =
                preset === '1d'
                  ? 'tvf.preset_1d'
                  : preset === '7d'
                    ? 'tvf.preset_7d'
                    : preset === '14d'
                      ? 'tvf.preset_14d'
                      : 'tvf.preset_30d'
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    activePreset === preset
                      ? 'bg-red-600 text-white shadow'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {t(labelKey)}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                {t('tvf.from_label')}
              </label>
              <input
                type="date"
                value={draftStartDate}
                onChange={(e) => setDraftStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                {t('tvf.to_label')}
              </label>
              <input
                type="date"
                value={draftEndDate}
                onChange={(e) => setDraftEndDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-xs font-bold"
              />
            </div>
            <button
              type="button"
              onClick={handleApplyCustomDates}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold shadow transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('tvf.analyze_btn')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* AVISO REGLA OFICIAL DE CONTEO DESPUÉS DEL CIERRE */}
      <div className="mb-5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 px-4 py-2.5 text-xs font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
        <Info className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <span>{t('tvf.post_closing_rule_note')}</span>
      </div>

      {/* ESTADO DE CARGA O ERROR */}
      {loading && !report && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
          <SurpriseLoader />
          <p className="mt-4 text-sm font-bold text-slate-600 dark:text-slate-300">
            {t('tvf.loading')}
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-2xl p-5 mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-rose-800 dark:text-rose-200 text-sm font-bold">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => loadReport(storeId, startDate, endDate)}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold"
          >
            {t('tvf.retry_btn')}
          </button>
        </div>
      )}

      {report && kpis && (
        <>
          {/* 6 TARJETAS EJECUTIVAS KPI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3.5 mb-6">
            {/* KPI 1: Venta Neta y Platillos */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">
                {t('tvf.kpi_sales_title')}
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                {fmtUsd(report.meta.netSalesUsd, 0)}
              </div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mt-1">
                {report.meta.orderCount.toLocaleString('en-US')} ·{' '}
                <strong>{kpis.totalFoodUnitsSold.toLocaleString('en-US')}</strong> {t('tvf.units_served_word')}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                🌮 {kpis.tacosTotalSold.toLocaleString('en-US')} · 🌯 {kpis.burritosTotalSold.toLocaleString('en-US')} · 🥖 {kpis.tortasTotalSold.toLocaleString('en-US')}
              </div>
            </div>

            {/* KPI 2: Gasto Teórico */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">
                {t('tvf.kpi_theo_title')}
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                {fmtUsd(primaryTheoCost, 0)}
              </div>
              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                {kpis.theoPctOfSales.toFixed(1)}% {t('tvf.of_net_sales')}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{t('tvf.kpi_theo_sub')}</div>
            </div>

            {/* KPI 3: Gasto Físico Real */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">
                {t('tvf.kpi_phys_title')}
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                {fmtUsd(primaryPhysCost, 0)}
              </div>
              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                {kpis.physicalPctOfSales.toFixed(1)}% {t('tvf.of_net_sales')}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{t('tvf.kpi_phys_sub')}</div>
            </div>

            {/* KPI 4: Diferencia en Dinero */}
            <div
              className={`rounded-2xl border p-4 shadow-sm ${
                primaryDiffCost > 50
                  ? 'bg-rose-50/70 dark:bg-rose-950/25 border-rose-300 dark:border-rose-800'
                  : 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-300 dark:border-emerald-800'
              }`}
            >
              <div className="text-[11px] font-extrabold uppercase text-slate-700 dark:text-slate-200">
                {t('tvf.kpi_diff_cost_title')}
              </div>
              <div
                className={`text-2xl font-black mt-1 ${
                  primaryDiffCost > 50
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {fmtSignedUsd(primaryDiffCost, 0)}
              </div>
              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                {costMode === 'store' ? t('tvf.bodega_cost_prefix') : t('tvf.store_cost_prefix')}{' '}
                {fmtSignedUsd(secondaryDiffCost, 0)}
              </div>
              <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300 mt-1">
                {t('tvf.kpi_efficiency_label')}:{' '}
                {kpis.overallEfficiencyPct !== null ? `${kpis.overallEfficiencyPct.toFixed(1)}%` : '—'}
              </div>
            </div>

            {/* KPI 5: Balance de las 8 Carnes */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">
                {t('tvf.kpi_meats_title')}
              </div>
              <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
                {fmtSignedNum(kpis.meatsSummary.diffRawLbs, 0)} {t('tvf.lbs_short')} (
                {fmtSignedNum(kpis.meatsSummary.diffBags, 1)} {t('tvf.bags_short')})
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                POS: <strong>{Math.round(kpis.meatsSummary.theoRawLbs).toLocaleString('en-US')} lb</strong> vs Real:{' '}
                <strong>{Math.round(kpis.meatsSummary.physicalRawLbs).toLocaleString('en-US')} lb</strong>
              </div>
              <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300 mt-1">
                {t('tvf.kpi_meats_equiv')}: {fmtSignedNum(kpis.meatsSummary.equivTacos15Oz, 0)} tacos /{' '}
                {fmtSignedNum(kpis.meatsSummary.equivBurritos6Oz, 0)} burritos
              </div>
            </div>

            {/* KPI 6: Cobertura Física Auditada */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
              <div className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">
                {t('tvf.kpi_coverage_title')}
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                {report.meta.measuredStoresCount} / {report.meta.totalActiveStoresCount}
              </div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mt-1">
                {t('tvf.kpi_coverage_stores')}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {report.productRows.filter((p) => p.hasMeasuredSpan).length} {t('tvf.kpi_coverage_items')}
              </div>
            </div>
          </div>

          {/* SECCIÓN 1: LAS 10 FAMILIAS DE PLATILLOS VENDIDOS EN CAJA */}
          <ExecutiveDishesPanel dishFamilies={report.dishFamilies} />

          {/* SECCIÓN 2: MATRIZ MAESTRA DE PRODUCTOS E INSUMOS (TEÓRICO VS FÍSICO) */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-6 print:shadow-none print:border-slate-300">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Scale className="w-5 h-5 text-red-600" />
                    <span>{t('tvf.sec_products_title')}</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('tvf.sec_products_subtitle')}
                  </p>
                </div>

                {/* Buscador + filtro de solo variaciones relevantes */}
                <div className="flex flex-wrap items-center gap-2.5 print:hidden">
                  <div className="relative min-w-[240px]">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('tvf.search_placeholder')}
                      className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlySignificantVariances}
                      onChange={(e) => setOnlySignificantVariances(e.target.checked)}
                      className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                    />
                    <span>{t('tvf.only_variances_toggle')}</span>
                  </label>
                </div>
              </div>

              {/* Pestañas de Categoría */}
              <div className="flex flex-wrap items-center gap-1.5 mt-4 print:hidden">
                {categoryTabs.map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    onClick={() => setCategoryFilter(ct.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                      categoryFilter === ct.id
                        ? 'bg-red-600 text-white shadow'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {t(ct.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[11px] font-extrabold uppercase text-slate-600 dark:text-slate-300">
                    <th className="py-3 px-3 text-left">{t('tvf.col_product')}</th>
                    <th className="py-3 px-3 text-left">{t('tvf.col_related_dishes')}</th>
                    <th className="py-3 px-3 text-right">{t('tvf.col_theo_usage')}</th>
                    <th className="py-3 px-3 text-right">{t('tvf.col_theo_cost')}</th>
                    <th className="py-3 px-3 text-right">{t('tvf.col_phys_usage')}</th>
                    <th className="py-3 px-3 text-right">{t('tvf.col_phys_cost')}</th>
                    <th className="py-3 px-3 text-right">{t('tvf.col_diff_qty')}</th>
                    <th className="py-3 px-3 text-right">{t('tvf.col_diff_cost')}</th>
                    <th className="py-3 px-3 text-left">{t('tvf.col_comparisons')}</th>
                    <th className="py-3 px-3 text-center">{t('tvf.col_status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredProducts.map((r: ExecutiveProductComparisonRow) => {
                    const isExpanded = expandedProductIds.has(r.itemId)
                    const unitLabel = isEn ? r.unitLabelEn : r.unitLabelEs
                    const relatedLabel = isEn ? r.relatedDishesEn : r.relatedDishesEs
                    const compNote = isEn ? r.comparisonNoteEn : r.comparisonNoteEs
                    const theoCostVal = costMode === 'store' ? r.theoCostStoreUsd : r.theoCostBodegaUsd
                    const physCostVal = costMode === 'store' ? r.physicalCostStoreUsd : r.physicalCostBodegaUsd
                    const diffCostPrimary = costMode === 'store' ? r.diffCostStoreUsd : r.diffCostBodegaUsd
                    const diffCostSecondary = costMode === 'store' ? r.diffCostBodegaUsd : r.diffCostStoreUsd

                    return (
                      <React.Fragment key={r.itemId}>
                        <tr
                          className={`transition-colors ${
                            r.status === 'critical'
                              ? 'bg-rose-50/30 dark:bg-rose-950/15'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="py-3 px-3 align-top">
                            <div className="font-black text-slate-900 dark:text-white text-xs md:text-sm">
                              {r.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {unitLabel} · {fmtUsd(r.unitCostStoreUsd, 2)}
                              {r.isMeat ? ` · Yield ${r.yieldPct}%` : ''}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 print:hidden">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                  r.measurementMode === 'salsabar_benchmark'
                                    ? 'bg-amber-100/80 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {r.measurementMode === 'salsabar_benchmark'
                                  ? t('tvf.salsabar_badge')
                                  : t('tvf.pos_recipe_badge')}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleExpandProduct(r.itemId)}
                                className="inline-flex items-center gap-0.5 text-[11px] font-extrabold text-red-700 dark:text-red-400 hover:underline"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp className="w-3.5 h-3.5" />
                                    <span>{t('tvf.hide_15_stores_btn')}</span>
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="w-3.5 h-3.5" />
                                    <span>{t('tvf.view_15_stores_btn')}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </td>

                          <td className="py-3 px-3 align-top max-w-[240px]">
                            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 leading-snug">
                              {relatedLabel}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right align-top whitespace-nowrap">
                            <div className="font-extrabold text-slate-900 dark:text-white">
                              {r.theoUnits.toFixed(1)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {Math.round(r.theoBaseQty).toLocaleString('en-US')} {r.baseMeasure}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right align-top whitespace-nowrap font-bold text-slate-800 dark:text-slate-200">
                            {fmtUsd(theoCostVal, 0)}
                          </td>

                          <td className="py-3 px-3 text-right align-top whitespace-nowrap">
                            {r.hasMeasuredSpan ? (
                              <>
                                <div className="font-black text-slate-900 dark:text-white">
                                  {r.physicalUnits.toFixed(1)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {Math.round(r.openingUnits)} + {Math.round(r.arrivedUnits)}
                                  {Math.abs(r.transferNetUnits) > 0.01
                                    ? ` ${r.transferNetUnits > 0 ? '+' : ''}${Math.round(r.transferNetUnits)}`
                                    : ''}{' '}
                                  − {Math.round(r.closingUnits)}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right align-top whitespace-nowrap font-extrabold text-slate-900 dark:text-white">
                            {r.hasMeasuredSpan ? fmtUsd(physCostVal, 0) : '—'}
                          </td>

                          <td className="py-3 px-3 text-right align-top whitespace-nowrap">
                            {r.hasMeasuredSpan ? (
                              <>
                                <div
                                  className={`font-black ${
                                    r.diffUnits > 0.5
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : r.diffUnits < -0.5
                                        ? 'text-sky-600 dark:text-sky-400'
                                        : 'text-emerald-600 dark:text-emerald-400'
                                  }`}
                                >
                                  {fmtSignedNum(r.diffUnits, 1)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {fmtSignedNum(r.diffUnitsPerDay, 1)}
                                  {t('tvf.per_day_suffix')}{' '}
                                  {r.diffPct !== null ? `(${fmtSignedNum(r.diffPct, 1)}%)` : ''}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right align-top whitespace-nowrap">
                            {r.hasMeasuredSpan ? (
                              <>
                                <div
                                  className={`font-black ${
                                    diffCostPrimary > 25
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : diffCostPrimary < -25
                                        ? 'text-sky-600 dark:text-sky-400'
                                        : 'text-emerald-600 dark:text-emerald-400'
                                  }`}
                                >
                                  {fmtSignedUsd(diffCostPrimary, 0)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {costMode === 'store' ? t('tvf.bodega_cost_prefix') : t('tvf.store_cost_prefix')}{' '}
                                  {fmtSignedUsd(diffCostSecondary, 0)}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          <td className="py-3 px-3 align-top max-w-[260px]">
                            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 leading-snug">
                              {compNote}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-center align-top whitespace-nowrap">
                            <StatusPill status={r.status} />
                          </td>
                        </tr>

                        {/* DESGLOSE EXPANDIBLE DE LAS 15 TIENDAS PARA ESTE PRODUCTO */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90 dark:bg-slate-950/70 print:hidden">
                            <td colSpan={10} className="p-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                                {r.perStoreBreakdown.map((cell) => (
                                  <div
                                    key={cell.storeId}
                                    onClick={() => setStoreId(String(cell.storeId))}
                                    className="cursor-pointer rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 hover:border-red-400 transition-colors"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-black text-xs text-slate-900 dark:text-white">
                                        {cell.storeName}
                                      </span>
                                      <StatusPill status={cell.status} />
                                    </div>
                                    {cell.hasMeasuredSpan ? (
                                      <div className="mt-2 text-[11px] space-y-0.5 text-slate-600 dark:text-slate-300">
                                        <div>
                                          POS: <strong>{cell.theoUnits.toFixed(1)}</strong> vs Real:{' '}
                                          <strong>{cell.physicalUnits?.toFixed(1)}</strong>
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                          ({cell.openingUnits} + {cell.arrivedUnits} − {cell.closingUnits})
                                        </div>
                                        <div className="font-extrabold text-rose-600 dark:text-rose-400">
                                          Dif: {fmtSignedNum(cell.diffUnits || 0, 1)} (
                                          {fmtSignedUsd(
                                            (costMode === 'store' ? cell.diffCostStoreUsd : cell.diffCostBodegaUsd) ||
                                              0,
                                            0
                                          )}
                                          )
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="mt-2 text-[11px] text-slate-400">
                                        POS: {cell.theoUnits.toFixed(1)} · {t('tvf.status_unmeasured')}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>

                <tfoot>
                  <tr className="bg-slate-900 text-white font-black text-xs">
                    <td colSpan={3} className="py-3.5 px-3">
                      {t('tvf.total_measured_row')} ({filteredTotals.measuredCount})
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      {fmtUsd(costMode === 'store' ? filteredTotals.theoStore : filteredTotals.theoBodega, 0)}
                    </td>
                    <td className="py-3.5 px-3"></td>
                    <td className="py-3.5 px-3 text-right">
                      {fmtUsd(costMode === 'store' ? filteredTotals.physStore : filteredTotals.physBodega, 0)}
                    </td>
                    <td className="py-3.5 px-3"></td>
                    <td className="py-3.5 px-3 text-right text-rose-300">
                      {fmtSignedUsd(costMode === 'store' ? filteredTotals.diffStore : filteredTotals.diffBodega, 0)}
                    </td>
                    <td colSpan={2} className="py-3.5 px-3 text-right text-slate-300 text-[11px]">
                      {costMode === 'store' ? t('tvf.bodega_cost_prefix') : t('tvf.store_cost_prefix')}{' '}
                      {fmtSignedUsd(costMode === 'store' ? filteredTotals.diffBodega : filteredTotals.diffStore, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* SECCIÓN 3: COMPARATIVA EJECUTIVA DE LAS 15 SUCURSALES */}
          <ExecutiveStoresRankingPanel
            storeRows={report.storeRows}
            costMode={costMode}
            selectedStoreId={storeId}
            onSelectStore={(id) => {
              setStoreId(id)
              if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        </>
      )}
    </div>
  )
}
