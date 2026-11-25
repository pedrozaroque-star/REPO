/**
 * @module admin/food-cost/varianza/page
 * @description Centro ejecutivo de Varianza Real vs. Teórica (Actual vs. Theoretical / AvT),
 * ordenando los insumos por pérdida económica real medida en dólares (`$ Loss`) con protagonismo #1 en Carne Asada.
 *
 * @businessRules
 * - Inicializa en fecha laboral oficial de `America/Los_Angeles` (regla 06:00 AM) con ventana predeterminada de **7 días cerrados**
 *   y selector rápido `1D / 7D / 14D / 30D` para cancelar el ruido diario de bolsas abiertas (WIP) en cámara fría.
 * - Consumo Real: Balance telescópico `Inicial(t0) + Llegadas[t0, t1) - Final(t1)` exclusivamente con conteos físicos humanos.
 * - Consumo Teórico: Tickets reales de Toast POS (`meat_consumption_history` en lbs crudas para las 8 carnes; `inventory_usage_log` en unidades de compra).
 * - Renderiza de forma honesta y diferenciada las filas `'unmeasured'` (sin conteo físico completo) sin barras rojas falsas de `0%` ni `$0.00` engañosos.
 *
 * @dataFlow
 * - `GET /api/stores` + `GET /api/food-cost/variance-avt?storeId=...&startDate=...&endDate=...&category=...`
 *
 * @notes
 * - [2026-11-23] Agregado Spotlight Banner de Carne Asada (`$60/bolsa 10 lb = $6/lb` Tienda, `$50/bolsa = $5/lb` Bodega),
 *   selector `1D/7D/14D/30D`, categoría `Packaging`, manejo explícito de `'unmeasured'` y protección CSV con `escapeCsvCell`.
 */

'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Scale,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  Store,
  Download,
  Flame,
  ArrowRight,
  Clock,
} from 'lucide-react'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import {
  addDaysIso,
  escapeCsvCell,
  FOOD_COST_MAX_RANGE_ALL_STORES_DAYS,
  FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS,
  formatSignedUSD,
  getBusinessDateLA,
  validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'

type SpanPreset = '1d' | '7d' | '14d' | '30d' | 'custom'

interface AvTItem {
  id: string
  name: string
  category: 'Meat' | 'Dairy' | 'Produce' | 'Grocery' | 'Packaging'
  unit_measure: string
  unit_cost: number
  bodega_unit_cost?: number
  actual_qty: number
  theoretical_qty: number
  variance_qty: number
  variance_pct?: number
  waste_qty: number
  unexplained_variance: number
  efficiency_pct: number
  actual_dollar: number
  theoretical_dollar: number
  dollar_loss: number
  bodega_dollar_loss?: number
  status: 'critical' | 'warning' | 'normal' | 'efficient' | 'unmeasured'
  dataSource?: 'real' | 'unmeasured'
  hasRealInventoryData?: boolean
  is_meat?: boolean
  meat_key?: string
  bag_weight_lbs?: number
  bag_cost?: number
  actual_bags?: number
  theoretical_bags?: number
  variance_bags?: number
  variance_lbs?: number
  excess_tacos_equiv?: number
  yield_pct?: number
  span_days?: number
  measured_stores_count?: number
  wip_cooler_note?: boolean
  opening_count_units?: number
  arrived_units?: number
  ending_count_units?: number
  closing_sobrante_cooked_lbs?: number | null
  closing_sobrante_date?: string | null
}

interface AvTResponse {
  storeId: string
  startDate: string
  endDate: string
  todayBusinessDateLA?: string
  totalNetSales: number
  totalTheoreticalDollar: number
  allItemsTheoreticalDollar?: number
  totalActualDollar: number
  totalDollarLoss: number
  totalBodegaDollarLoss?: number
  netDollarVariance?: number
  overallEfficiencyPct: number
  itemsCount: number
  measuredItemsCount?: number
  unmeasuredItemsCount?: number
  asadaSpotlight?: AvTItem | null
  items: AvTItem[]
  dataQuality?: 'real' | 'mixed' | 'unmeasured'
  message?: string
}

function getPresetDates(preset: Exclude<SpanPreset, 'custom'>): { start: string; end: string } {
  const todayLA = getBusinessDateLA()
  const yesterdayLA = addDaysIso(todayLA, -1)
  if (preset === '1d') {
    return { start: yesterdayLA, end: yesterdayLA }
  }
  if (preset === '14d') {
    return { start: addDaysIso(yesterdayLA, -13), end: yesterdayLA }
  }
  if (preset === '30d') {
    return { start: addDaysIso(yesterdayLA, -29), end: yesterdayLA }
  }
  return { start: addDaysIso(yesterdayLA, -6), end: yesterdayLA }
}

export default function AvTVariancePage() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'

  const [storeId, setStoreId] = useState<string>('all')
  const [stores, setStores] = useState<{ id: string; name: string; external_id: string }[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [spanPreset, setSpanPreset] = useState<SpanPreset>('7d')

  const [startDate, setStartDate] = useState<string>(() => getPresetDates('7d').start)
  const [endDate, setEndDate] = useState<string>(() => getPresetDates('7d').end)
  const [draftStartDate, setDraftStartDate] = useState<string>(() => getPresetDates('7d').start)
  const [draftEndDate, setDraftEndDate] = useState<string>(() => getPresetDates('7d').end)

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AvTResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const maxAllowedDays = storeId === 'all' ? FOOD_COST_MAX_RANGE_ALL_STORES_DAYS : FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/stores', { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (Array.isArray(json)) {
          setStores(
            sortStoresAlphabetically(
              json.map((s: any) => ({ ...s, name: formatStoreDisplayName({ id: s.id, name: s.name }) || s.name })),
              (s) => s.name
            )
          )
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') console.error('Failed to load stores:', err)
      })
    return () => controller.abort()
  }, [])

  const applyPreset = (preset: Exclude<SpanPreset, 'custom'>) => {
    const range = getPresetDates(preset)
    setSpanPreset(preset)
    setStartDate(range.start)
    setEndDate(range.end)
    setDraftStartDate(range.start)
    setDraftEndDate(range.end)
    setError(null)
  }

  const handleApplyDraftDates = () => {
    const check = validateDateRangeWithinMaxDays(draftStartDate, draftEndDate, maxAllowedDays)
    if (!check.ok) {
      setError(t('food_cost.max_range_exceeded', { max: maxAllowedDays }))
      return
    }
    setError(null)
    setSpanPreset('custom')
    setStartDate(draftStartDate)
    setEndDate(draftEndDate)
  }

  const fetchData = useCallback(async () => {
    const check = validateDateRangeWithinMaxDays(startDate, endDate, maxAllowedDays)
    if (!check.ok) {
      setError(t('food_cost.max_range_exceeded', { max: maxAllowedDays }))
      setLoading(false)
      return
    }
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      setLoading(true)
      setError(null)
      // Always request `category=all` so clicking category pills filters instantaneously client-side with ZERO extra backend queries.
      const params = new URLSearchParams({
        storeId,
        startDate,
        endDate,
        category: 'all',
      })
      const res = await fetch(`/api/food-cost/variance-avt?${params.toString()}`, { signal: controller.signal })
      const rawText = await res.text()
      let json: any = null
      try {
        json = rawText ? JSON.parse(rawText) : null
      } catch {
        json = null
      }
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}: ${res.statusText}`)
      setData(json)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error('Failed to load AvT:', err)
      setError(err.message || t('food_cost.load_error'))
    } finally {
      if (abortRef.current === controller) {
        setLoading(false)
      }
    }
  }, [storeId, startDate, endDate, maxAllowedDays, t])

  useEffect(() => {
    fetchData()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchData])

  // Client-side category filter & KPI recalculation (exact parity with backend, zero extra DB/PMIX queries)
  const scopedView = useMemo(() => {
    if (!data) return null
    const visibleItems = categoryFilter === 'all'
      ? data.items
      : data.items.filter((i) => i.category === categoryFilter)

    if (categoryFilter === 'all') {
      return {
        items: visibleItems,
        itemsCount: data.itemsCount,
        measuredItemsCount: data.measuredItemsCount ?? visibleItems.filter((i) => i.hasRealInventoryData).length,
        totalTheoreticalDollar: data.totalTheoreticalDollar,
        totalActualDollar: data.totalActualDollar,
        totalDollarLoss: data.totalDollarLoss,
        totalBodegaDollarLoss: data.totalBodegaDollarLoss ?? 0,
        overallEfficiencyPct: data.overallEfficiencyPct,
      }
    }

    let measuredCount = 0
    let totalTheo = 0
    let totalActl = 0
    let totalLoss = 0
    let totalBodegaLoss = 0
    for (const item of visibleItems) {
      if (item.hasRealInventoryData) {
        measuredCount++
        totalTheo += Number(item.theoretical_dollar) || 0
        totalActl += Number(item.actual_dollar) || 0
        if ((Number(item.dollar_loss) || 0) > 0) totalLoss += Number(item.dollar_loss) || 0
        if ((Number(item.bodega_dollar_loss) || 0) > 0) totalBodegaLoss += Number(item.bodega_dollar_loss) || 0
      }
    }
    const eff = totalActl > 0 ? Math.min(200, Math.round((totalTheo / totalActl) * 1000) / 10) : 0
    return {
      items: visibleItems,
      itemsCount: visibleItems.length,
      measuredItemsCount: measuredCount,
      totalTheoreticalDollar: Math.round(totalTheo * 100) / 100,
      totalActualDollar: Math.round(totalActl * 100) / 100,
      totalDollarLoss: Math.round(totalLoss * 100) / 100,
      totalBodegaDollarLoss: Math.round(totalBodegaLoss * 100) / 100,
      overallEfficiencyPct: eff,
    }
  }, [data, categoryFilter])

  const handleExportCSV = () => {
    if (!scopedView || !scopedView.items) return
    const headers = [
      isEn ? 'Ingredient' : 'Ingrediente',
      isEn ? 'Category' : 'Categoría',
      isEn ? 'Unit' : 'Unidad',
      isEn ? 'Store Unit Cost (USD)' : 'Costo Unit. Tienda (USD)',
      isEn ? 'Bodega Unit Cost (USD)' : 'Costo Unit. Bodega (USD)',
      isEn ? 'Theoretical POS Usage' : 'Consumo Teórico POS',
      isEn ? 'Actual Physical Usage' : 'Consumo Real Físico',
      isEn ? 'Variance' : 'Varianza',
      isEn ? 'Variance Bags (Meats)' : 'Varianza Bolsas (Carnes)',
      isEn ? 'Efficiency %' : 'Eficiencia %',
      isEn ? 'Store $ Loss (USD)' : 'Pérdida Tienda $ (USD)',
      isEn ? 'Bodega $ Loss (USD)' : 'Pérdida Bodega $ (USD)',
      isEn ? 'Status' : 'Estado',
    ]
    const rows = scopedView.items.map((i) => [
      escapeCsvCell(i.name),
      escapeCsvCell(i.category),
      escapeCsvCell(i.unit_measure),
      escapeCsvCell(i.unit_cost.toFixed(2)),
      escapeCsvCell((i.bodega_unit_cost ?? i.unit_cost).toFixed(2)),
      escapeCsvCell(i.theoretical_qty),
      escapeCsvCell(i.hasRealInventoryData ? i.actual_qty : 'UNMEASURED'),
      escapeCsvCell(i.hasRealInventoryData ? i.variance_qty : 'UNMEASURED'),
      escapeCsvCell(i.is_meat && i.hasRealInventoryData ? i.variance_bags ?? 0 : ''),
      escapeCsvCell(i.hasRealInventoryData ? `${i.efficiency_pct}%` : 'UNMEASURED'),
      escapeCsvCell(i.hasRealInventoryData ? i.dollar_loss.toFixed(2) : '0.00'),
      escapeCsvCell(i.hasRealInventoryData ? (i.bodega_dollar_loss ?? 0).toFixed(2) : '0.00'),
      escapeCsvCell(i.status),
    ])

    const csvBody = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `AvT_Varianza_Tacos_Gavilan_${startDate}_${endDate}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const asada = data?.asadaSpotlight || null
  const hasShortSpanMeat = Boolean(data?.items?.some((i) => i.wip_cooler_note && i.hasRealInventoryData))

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-8 transition-colors">
      <FoodCostNavigationTabs />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/20">
              <Scale className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                {t('avt.title') || (isEn ? 'Actual vs. Theoretical Variance (AvT)' : 'Varianza Real vs. Teórica (AvT)')}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-300 dark:border-red-800">
                  {isEn ? 'True Mass-Balance' : 'Balance de Masas Real'}
                </span>
              </h1>
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('avt.subtitle') ||
                  (isEn
                    ? 'Portion & shrinkage audit comparing Toast POS tickets vs human physical inventory counts'
                    : 'Auditoría de porcionamiento y mermas cruzando tickets reales de Toast POS contra conteos físicos humanos')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('avt.refresh') || (isEn ? 'Refresh' : 'Actualizar')}</span>
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!scopedView || scopedView.items.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span>{t('avt.export_csv') || (isEn ? 'Export CSV' : 'Exportar CSV')}</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-6 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Store Selector */}
          <div className="flex items-center gap-1.5">
            <Store className="w-4 h-4 text-slate-400" />
            <select
              value={storeId}
              onChange={(e) => {
                const nextStore = e.target.value
                setStoreId(nextStore)
                if (nextStore === 'all') {
                  const check = validateDateRangeWithinMaxDays(startDate, endDate, FOOD_COST_MAX_RANGE_ALL_STORES_DAYS)
                  if (!check.ok) {
                    const clampedStart = addDaysIso(endDate, -(FOOD_COST_MAX_RANGE_ALL_STORES_DAYS - 1))
                    setStartDate(clampedStart)
                    setDraftStartDate(clampedStart)
                    setDraftEndDate(endDate)
                    setSpanPreset('custom')
                  }
                }
              }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 outline-none"
            >
              <option value="all">{t('avt.all_stores') || (isEn ? 'All 15 Stores (Consolidated)' : 'Todas las Sucursales (Consolidado)')}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.external_id || s.id}>
                  {formatStoreDisplayName({ id: s.id, name: s.name })}
                </option>
              ))}
            </select>
          </div>

          {/* Rolling Window Selector (1D / 7D / 14D / 30D) */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {(
              [
                { id: '1d', label: '1D' },
                { id: '7d', label: '7D' },
                { id: '14d', label: '14D' },
                { id: '30d', label: '30D' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`px-2.5 py-1 text-xs font-black rounded-md transition-all cursor-pointer ${
                  spanPreset === p.id
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date range inputs (explicit Apply prevents firing DB queries on every keystroke/calendar step) */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={draftStartDate}
              onChange={(e) => setDraftStartDate(e.target.value)}
              className="px-2.5 py-1 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono"
            />
            <span className="text-slate-400 text-xs">→</span>
            <input
              type="date"
              value={draftEndDate}
              onChange={(e) => setDraftEndDate(e.target.value)}
              className="px-2.5 py-1 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 font-mono"
            />
            <button
              type="button"
              onClick={handleApplyDraftDates}
              disabled={loading || (draftStartDate === startDate && draftEndDate === endDate)}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
            >
              {t('food_cost.apply_dates')}
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: t('avt.cat_all') || (isEn ? 'All' : 'Todas') },
            { id: 'Meat', label: t('avt.cat_meat') || (isEn ? '🥩 Meats' : '🥩 Carnes') },
            { id: 'Dairy', label: t('avt.cat_dairy') || (isEn ? '🧀 Dairy' : '🧀 Lácteos') },
            { id: 'Grocery', label: t('avt.cat_grocery') || (isEn ? '🌾 Grocery' : '🌾 Abarrotes') },
            { id: 'Produce', label: t('avt.cat_produce') || (isEn ? '🥑 Produce' : '🥑 Verduras') },
            { id: 'Packaging', label: isEn ? '📦 Packaging' : '📦 Empaques' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryFilter(c.id)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
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

      {/* CARNE ASADA #1 PRIORITY SPOTLIGHT BANNER */}
      {asada && !loading && (
        <div className="mb-6 rounded-2xl border-2 border-red-500/40 bg-gradient-to-r from-red-950 via-slate-900 to-slate-900 text-white p-5 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-red-600 text-white">
                  <Flame className="w-3.5 h-3.5" />
                  {isEn ? '#1 Cost Priority · Carne Asada' : 'Prioridad #1 de Costo · Carne Asada'}
                </span>
                <span className="text-xs text-red-200 font-mono">
                  $60.00 / {isEn ? '10 lb bag' : 'bolsa 10 lb'} ($6.00/lb {isEn ? 'Store' : 'Tienda'} · $5.00/lb Bodega · 61.5% Yield)
                </span>
              </div>
              <h2 className="text-lg md:text-xl font-black">
                {asada.hasRealInventoryData ? (
                  <>
                    {isEn ? 'Physical Used:' : 'Consumo Físico:'}{' '}
                    <span className="text-amber-300 font-mono">
                      {(asada.actual_bags ?? 0).toLocaleString()} {isEn ? 'bags' : 'bolsas'} ({asada.actual_qty.toLocaleString()} lb)
                    </span>{' '}
                    vs POS:{' '}
                    <span className="text-cyan-300 font-mono">
                      {(asada.theoretical_bags ?? 0).toLocaleString()} {isEn ? 'bags' : 'bolsas'} ({asada.theoretical_qty.toLocaleString()} lb)
                    </span>
                  </>
                ) : (
                  <>
                    {isEn ? 'POS Theoretical:' : 'Consumo Teórico POS:'}{' '}
                    <span className="text-cyan-300 font-mono">
                      {(asada.theoretical_bags ?? 0).toLocaleString()} {isEn ? 'bags' : 'bolsas'} ({asada.theoretical_qty.toLocaleString()} lb)
                    </span>{' '}
                    <span className="text-xs font-normal text-slate-300">
                      ({isEn ? 'Awaiting closing physical count' : 'Pendiente conteo físico de cierre'})
                    </span>
                  </>
                )}
              </h2>
              {asada.hasRealInventoryData && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 font-mono">
                  <span>
                    {isEn ? 'Opening' : 'Inicial'}: <strong>{asada.opening_count_units ?? 0}</strong>b +{' '}
                    {isEn ? 'Arrived' : 'Llegadas'}: <strong>{asada.arrived_units ?? 0}</strong>b −{' '}
                    {isEn ? 'Closing' : 'Final'}: <strong>{asada.ending_count_units ?? 0}</strong>b
                  </span>
                  {asada.closing_sobrante_cooked_lbs !== null && asada.closing_sobrante_cooked_lbs !== undefined && (
                    <span className="px-2 py-0.5 rounded bg-white/10 text-amber-200">
                      {isEn ? 'Closing Cooked Sobrante:' : 'Sobrante Cocido Cierre:'} {asada.closing_sobrante_cooked_lbs} lb
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {asada.hasRealInventoryData && (
                <>
                  <div className="bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-right">
                    <span className="text-[10px] uppercase tracking-wider text-slate-300 block font-bold">
                      {isEn ? 'Variance (Bags / Store $)' : 'Varianza (Bolsas / $ Tienda)'}
                    </span>
                    <span
                      className={`text-lg font-black font-mono ${
                        (asada.dollar_loss || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {(asada.variance_bags || 0) > 0 ? `+${asada.variance_bags}` : asada.variance_bags}{' '}
                      {isEn ? 'bags' : 'bolsas'} ({formatSignedUSD(asada.dollar_loss, { showPlus: true })})
                    </span>
                    <span className="text-[10px] text-slate-300 block font-mono">
                      Bodega: {formatSignedUSD(asada.bodega_dollar_loss || 0, { showPlus: true })} ·{' '}
                      {Math.round(asada.excess_tacos_equiv || 0).toLocaleString()} tacos eq.
                    </span>
                  </div>
                </>
              )}

              <Link
                href={`/admin/food-cost/meats?storeId=${encodeURIComponent(storeId)}&startDate=${startDate}&endDate=${endDate}`}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black shadow-md transition-all"
              >
                <span>{isEn ? 'AM / PM Shift Attribution' : 'Atribución Turno AM / PM'}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* WIP Cooler Note when span < 5 days */}
      {hasShortSpanMeat && !loading && (
        <div className="mb-4 p-3.5 bg-amber-50 dark:bg-amber-950/25 border border-amber-300 dark:border-amber-800 rounded-xl text-xs flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
          <Clock className="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" />
          <span>
            {isEn
              ? 'Closed-Bag Cooler Observability Note: Spans shorter than 5 days include ±1–2 bags of open marinated/grill WIP because nightly counts measure sealed bags in the walk-in cooler. Use 7D, 14D, or 30D for 97%+ telescoping convergence.'
              : 'Nota Operativa de Cámara Fría (Bolsas Selladas): En ventanas menores a 5 días existe una variación normal de ±1–2 bolsas por producto abierto/marinado en línea. Usa los selectores 7D, 14D o 30D para precisión telescópica superior al 97%.'}
          </span>
        </div>
      )}

      {/* Unmeasured / Partial Data Notice */}
      {data?.message && !loading && (
        <div className="mb-4 p-3.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs flex items-center gap-2.5 text-blue-900 dark:text-blue-200">
          <Info className="w-4 h-4 flex-shrink-0 text-blue-600" />
          <span>{data.message}</span>
        </div>
      )}

      {/* KPI Cards */}
      {scopedView && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              {t('avt.summary_theo_dollar') || (isEn ? 'Theoretical POS Cost' : 'Costo Teórico (Ítems Medidos)')}
            </span>
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
              {formatSignedUSD(scopedView.totalTheoreticalDollar)}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              {scopedView.measuredItemsCount} / {scopedView.itemsCount}{' '}
              {isEn ? 'items with physical span' : 'insumos con tramo físico'}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              {t('avt.summary_actl_dollar') || (isEn ? 'Actual Physical Cost' : 'Costo Real Gastado')}
            </span>
            <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
              {formatSignedUSD(scopedView.totalActualDollar)}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              {t('avt.summary_actl_sub') || (isEn ? 'Opening + Deliveries − Closing' : 'Inicial + Entregas Bodega − Final')}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-rose-500 block tracking-wider">
              {t('avt.summary_dollar_loss') || (isEn ? 'Over-Portioning Loss ($)' : 'Fuga por Sobre-Porción ($ Loss)')}
            </span>
            <span className="text-xl font-black text-rose-600 dark:text-rose-400 font-mono">
              {formatSignedUSD(scopedView.totalDollarLoss, { showPlus: scopedView.totalDollarLoss > 0 })}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
              Bodega: {formatSignedUSD(scopedView.totalBodegaDollarLoss || 0)}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl shadow-sm">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              {t('avt.summary_efficiency') || (isEn ? 'Portion Efficiency' : 'Eficiencia de Porciones')}
            </span>
            <span
              className={`text-xl font-black font-mono ${
                scopedView.measuredItemsCount === 0
                  ? 'text-slate-400'
                  : scopedView.overallEfficiencyPct >= 96
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : scopedView.overallEfficiencyPct >= 88
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {scopedView.measuredItemsCount === 0 ? '—' : `${scopedView.overallEfficiencyPct}%`}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              {isEn ? 'Target: 96% – 100%' : 'Meta ideal: 96% – 100%'}
            </span>
          </div>
        </div>
      )}

      {/* Main AvT Table */}
      {loading ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 flex flex-col items-center justify-center">
          <SurpriseLoader />
          <p className="text-sm font-semibold text-slate-500 mt-4">
            {t('avt.loading') || (isEn ? 'Computing Telescoping Mass-Balance...' : 'Calculando Balance de Masas Real vs. Teórico...')}
          </p>
        </div>
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-6 rounded-xl text-center text-red-700 dark:text-red-300 space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto" />
          <p className="font-bold">{error}</p>
          <button
            type="button"
            onClick={fetchData}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
          >
            {t('food_cost.retry')}
          </button>
        </div>
      ) : scopedView ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 uppercase font-black">
                  <th className="p-3">{t('avt.th_item') || (isEn ? 'Ingredient' : 'Ingrediente / Insumo')}</th>
                  <th className="p-3">{t('avt.th_category') || (isEn ? 'Category' : 'Categoría')}</th>
                  <th className="p-3 text-center">{t('avt.th_unit') || (isEn ? 'Unit' : 'Unidad')}</th>
                  <th className="p-3 text-right">{t('avt.th_cost') || (isEn ? 'Unit Cost' : 'Costo Unit.')}</th>
                  <th className="p-3 text-right">{t('avt.th_theo_qty') || (isEn ? 'POS Theoretical' : 'Teórico (Toast)')}</th>
                  <th className="p-3 text-right">{t('avt.th_actl_qty') || (isEn ? 'Physical Actual' : 'Real (Físico)')}</th>
                  <th className="p-3 text-right">{isEn ? 'Variance' : 'Varianza'}</th>
                  <th className="p-3 text-center">{t('avt.th_efficiency') || (isEn ? 'Efficiency %' : 'Eficiencia %')}</th>
                  <th className="p-3 text-right bg-rose-500/10 text-rose-800 dark:text-rose-200 border-l-2 border-rose-500">
                    {t('avt.th_dollar_loss') || (isEn ? 'Store $ Loss' : 'Pérdida $ ($ Loss)')}
                  </th>
                  <th className="p-3 text-center">{t('avt.th_status') || (isEn ? 'Status' : 'Diagnóstico')}</th>
                </tr>
              </thead>

              <tbody>
                {scopedView.items.map((item, idx) => {
                  const isUnmeasured = !item.hasRealInventoryData || item.status === 'unmeasured'
                  const isAsada = item.meat_key === 'asada'

                  return (
                    <tr
                      key={item.id || idx}
                      className={`border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors ${
                        isAsada
                          ? 'bg-red-50/40 dark:bg-red-950/15'
                          : item.status === 'critical'
                            ? 'bg-rose-50/30 dark:bg-rose-950/10'
                            : isUnmeasured
                              ? 'opacity-75'
                              : ''
                      }`}
                    >
                      <td className="p-3 font-bold text-slate-900 dark:text-white">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{item.name}</span>
                          {isAsada && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-600 text-white uppercase">
                              #1
                            </span>
                          )}
                          {item.wip_cooler_note && !isUnmeasured && (
                            <span
                              title={
                                isEn
                                  ? 'Span < 5 days: includes closed-bag cooler WIP'
                                  : 'Tramo < 5 días: sujeto a WIP de bolsas abiertas'
                              }
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            >
                              {item.span_days}d WIP
                            </span>
                          )}
                        </div>
                        {item.closing_sobrante_cooked_lbs !== null && item.closing_sobrante_cooked_lbs !== undefined && (
                          <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                            {isEn ? 'Cooked Sobrante:' : 'Sobrante cocido:'} {item.closing_sobrante_cooked_lbs} lb
                          </span>
                        )}
                      </td>

                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.category === 'Meat'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                              : item.category === 'Dairy'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : item.category === 'Produce'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : item.category === 'Packaging'
                                    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                    : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {item.category}
                        </span>
                      </td>

                      <td className="p-3 text-center font-mono text-slate-500">
                        {item.unit_measure}
                        {item.is_meat && item.bag_weight_lbs ? (
                          <span className="block text-[9px] text-slate-400">({item.bag_weight_lbs} lb/b)</span>
                        ) : null}
                      </td>

                      <td className="p-3 text-right font-mono font-medium">
                        {formatSignedUSD(item.unit_cost)}
                        {item.is_meat && item.bag_cost ? (
                          <span className="block text-[9px] text-slate-400">
                            {formatSignedUSD(item.bag_cost)}/{isEn ? 'bag' : 'bolsa'}
                          </span>
                        ) : null}
                      </td>

                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-400">
                        {item.theoretical_qty.toLocaleString()} {item.unit_measure}
                        {item.is_meat && item.theoretical_bags !== undefined && (
                          <span className="block text-[10px] text-slate-400">
                            ({item.theoretical_bags.toLocaleString()} {isEn ? 'bags' : 'bolsas'})
                          </span>
                        )}
                      </td>

                      <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {isUnmeasured ? (
                          <span className="text-slate-400 font-normal italic">
                            {isEn ? 'Unmeasured' : 'Sin conteo'}
                          </span>
                        ) : (
                          <>
                            {item.actual_qty.toLocaleString()} {item.unit_measure}
                            {item.is_meat && item.actual_bags !== undefined && (
                              <span className="block text-[10px] text-slate-400 font-normal">
                                ({item.actual_bags.toLocaleString()} {isEn ? 'bags' : 'bolsas'})
                              </span>
                            )}
                          </>
                        )}
                      </td>

                      <td className="p-3 text-right font-mono font-bold">
                        {isUnmeasured ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <>
                            <span
                              className={
                                item.variance_qty > 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }
                            >
                              {item.variance_qty > 0
                                ? `+${item.variance_qty.toLocaleString()}`
                                : item.variance_qty.toLocaleString()}{' '}
                              {item.unit_measure}
                            </span>
                            {item.is_meat && item.variance_bags !== undefined && (
                              <span className="block text-[10px] text-slate-400 font-normal">
                                ({item.variance_bags > 0 ? `+${item.variance_bags}` : item.variance_bags}{' '}
                                {isEn ? 'bags' : 'bolsas'})
                              </span>
                            )}
                          </>
                        )}
                      </td>

                      <td className="p-3 text-center">
                        {isUnmeasured ? (
                          <span className="text-[10px] font-semibold text-slate-400">
                            {isEn ? 'No physical span' : 'Sin tramo físico'}
                          </span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-12 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  item.efficiency_pct < 85
                                    ? 'bg-rose-500'
                                    : item.efficiency_pct < 96
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, item.efficiency_pct))}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] font-bold">{item.efficiency_pct}%</span>
                          </div>
                        )}
                      </td>

                      <td className="p-3 text-right font-mono font-black text-sm bg-rose-500/10 border-l-2 border-rose-500">
                        {isUnmeasured ? (
                          <span className="text-slate-400 font-normal text-xs">—</span>
                        ) : (
                          <>
                            <span
                              className={
                                item.dollar_loss > 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }
                            >
                              {formatSignedUSD(item.dollar_loss, { showPlus: item.dollar_loss > 0 })}
                            </span>
                            {item.bodega_dollar_loss !== undefined && item.is_meat && (
                              <span className="block text-[9px] font-normal text-slate-500">
                                Bodega: {formatSignedUSD(item.bodega_dollar_loss, { showPlus: item.bodega_dollar_loss > 0 })}
                              </span>
                            )}
                          </>
                        )}
                      </td>

                      <td className="p-3 text-center">
                        {isUnmeasured ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                            {isEn ? 'Unmeasured' : 'Sin Conteo Físico'}
                          </span>
                        ) : item.status === 'critical' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{t('avt.status_critical') || (isEn ? 'Critical Loss' : 'Sobre-Porción Crítica')}</span>
                          </span>
                        ) : item.status === 'warning' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300">
                            <span>{t('avt.status_warning') || (isEn ? 'Check Portion' : 'Revisar Porción')}</span>
                          </span>
                        ) : item.status === 'efficient' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{t('avt.status_efficient') || (isEn ? 'Optimal' : 'Óptimo')}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">
                            {t('avt.status_normal') || (isEn ? 'Within Range' : 'Normal')}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
