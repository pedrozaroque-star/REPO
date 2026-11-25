'use client'

/**
 * @module components/food-cost/ToastVsFridgeMeterPanel
 * @description Vista ejecutiva simple de lectura en 5 segundos para Control de Sobrantes vs. Ventas Toast POS:
 *   - MODO 15 SUCURSALES (`selectedStoreNumericId === null`):
 *     1. Tres cuadros grandes: `Con Faltante` · `En Regla` · `Sin Contar`.
 *     2. Una sola tabla limpia de 4 columnas con números cerrados (`Sucursal | Debía Sobrar | Capturaron | Resultado`).
 *   - MODO 1 SUCURSAL (`selectedStoreNumericId !== null`):
 *     1. Botón `← Ver las 15 sucursales` + encabezado limpio de la sucursal.
 *     2. Tres cuadros grandes de esa tienda (`Último Cierre` · `Resultado Último Cierre` · `Acumulado del Periodo`).
 *     3. Una sola tabla limpia `Día por Día` (`Día | Había (Ini + Bodega) | Vendió Toast | Debía Sobrar | Capturaron | Resultado`).
 *
 * @businessRules
 * - 100% bilingüe (`es` / `en`) vía `useLanguage()` (`t('food_cost.fridge_meter.*')`).
 * - Números cerrados fáciles de leer en segundos y formato `'en-US'` en `USD`.
 */

import React, { useState } from 'react'
import { PackageCheck, Store as StoreIcon, ArrowLeft, ArrowRight, ArrowRightLeft, ShieldCheck } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatSignedUSD } from '@/lib/inventory/food-cost-sales-resolver'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import StoreTransferModal from '@/components/inventory/StoreTransferModal'

export interface ClientFridgeLedgerEntry {
  startDate: string
  endDate: string
  anchorDate: string | null
  spanDays: number
  periodLabel: string
  isWeekendPair: boolean
  isBridgedMultiDay: boolean
  openingBags: number | null
  openingCountedBy: string | null
  arrivedBags: number
  invoiceNumbers: string[]
  hasUnreconciledSentOrder: boolean
  availableInFridgeBags: number | null
  expectedClosingBags: number | null
  closingBags: number | null
  closingCountedBy: string | null
  fridgeBalanceBags: number | null
  fridgeBalanceDollarStore: number | null
  reboundSuspected: boolean
  fridgeUsedBags: number | null
  fridgeUsedRawLbs: number | null
  toastSoldBags: number
  toastSoldRawLbs: number
  tacosSold: number
  burritosSold: number
  varianceBags: number | null
  varianceRawLbs: number | null
  variancePct: number | null
  dollarImpactStore: number | null
  dollarImpactBodega: number | null
  unbilledTacosEquiv: number | null
  hasNegativeCountAnomaly: boolean
  status: 'ok' | 'warning' | 'critical' | 'efficient' | 'count_anomaly' | 'pending_count'
}

export interface ClientStoreFridgeComparison {
  storeId: number
  storeName: string
  storeCode: string
  hasMeasuredSpan: boolean
  t0: string | null
  t1: string | null
  spanDays: number
  openingBags: number | null
  arrivedBags: number
  invoiceNumbers: string[]
  expectedEndingBags: number | null
  closingBags: number | null
  fridgeUsedBags: number | null
  toastSoldWindowBags: number
  toastSoldSpanBags: number
  tacosSoldWindow: number
  burritosSoldWindow: number
  varianceBags: number | null
  variancePct: number | null
  dollarImpactStore: number | null
  unbilledTacosEquiv: number | null
  hasNegativeCountAnomaly: boolean
  cumulativeFridgeBalanceBags: number | null
  cumulativeFridgeBalanceDollarStore: number | null
  latestCloseCut: {
    periodLabel: string
    availableInFridgeBags: number | null
    toastSoldBags: number
    expectedClosingBags: number | null
    closingBags: number | null
    closingCountedBy: string | null
    fridgeBalanceBags: number | null
    fridgeBalanceDollarStore: number | null
  } | null
}

export interface ClientDishFamilyRow {
  familyKey: string
  labelEs: string
  labelEn: string
  ordersOrPlatesSold: number
  exactUnitsServed: number
  cookedOz: number
  cookedLbs: number
  rawLbs: number
  equivalentBagsCooked: number
  sharePct: number
  costStoreUsd: number
  costBodegaUsd: number
  standardRuleEs: string
  standardRuleEn: string
}

export interface ClientFamilyEquivalence {
  families: ClientDishFamilyRow[]
  totals: {
    tacosServed: number
    burritosServed: number
    totalCookedLbs: number
    totalRawLbs: number
    theoreticalBagsCooked: number
  }
  physicalBagsCooked: number | null
  excessBagsCooked: number | null
  unbilledTacosEquiv: number | null
  unbilledBurritosEquiv: number | null
  dollarLossStoreUsd: number | null
}

interface ToastVsFridgeMeterPanelProps {
  ingredientName: string
  storeName?: string
  bagWeightLbs: number
  bagCostStore: number
  expectedEndingBags: number | null
  endingBags: number | null
  dailyFridgeLedger: ClientFridgeLedgerEntry[]
  storesComparison: ClientStoreFridgeComparison[]
  familyEquivalence: ClientFamilyEquivalence | null
  selectedStoreNumericId: number | null
  onSelectStoreNumericId: (storeNumericId: number) => void
  onBackToAllStores?: () => void
  defaultIngredientId?: string | null
  onTransfersUpdated?: () => void
}

export default function ToastVsFridgeMeterPanel({
  ingredientName,
  storeName,
  bagWeightLbs,
  bagCostStore,
  dailyFridgeLedger,
  storesComparison,
  selectedStoreNumericId,
  onSelectStoreNumericId,
  onBackToAllStores,
  defaultIngredientId = null,
  onTransfersUpdated,
}: ToastVsFridgeMeterPanelProps) {
  const { t } = useLanguage()
  const [showTransferModal, setShowTransferModal] = useState(false)
  const bagsWord = t('food_cost.fridge_meter.bags_unit')

  const shortageStores = storesComparison
    .filter((s) => s.hasMeasuredSpan && !s.hasNegativeCountAnomaly && (s.cumulativeFridgeBalanceBags ?? 0) <= -1)
    .sort((a, b) => (a.cumulativeFridgeBalanceDollarStore ?? 0) - (b.cumulativeFridgeBalanceDollarStore ?? 0))

  const uncountedStores = storesComparison.filter((s) => !s.hasMeasuredSpan || s.hasNegativeCountAnomaly)
  const okStores = storesComparison.filter(
    (s) => s.hasMeasuredSpan && !s.hasNegativeCountAnomaly && (s.cumulativeFridgeBalanceBags ?? 0) > -1
  )

  const totalMissingBags = Math.round(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceBags || 0), 0)
  )
  const totalShortageUsd = Math.round(
    shortageStores.reduce((acc, s) => acc + Math.abs(s.cumulativeFridgeBalanceDollarStore || 0), 0)
  )

  const isMultiDayWindow = storesComparison.some((s) => s.hasMeasuredSpan && s.spanDays > 2)

  const selectedStoreSummary =
    selectedStoreNumericId !== null
      ? storesComparison.find((s) => s.storeId === selectedStoreNumericId) || null
      : null

  const renderCleanDiffPill = (balanceBags: number | null, balanceUsd: number | null, isCountAnomaly = false) => {
    if (isCountAnomaly) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-bold text-xs">
          ⚠️ {t('food_cost.fridge_meter.check_count_badge')}
        </span>
      )
    }
    if (balanceBags === null) return <span className="text-slate-400">—</span>
    if (balanceBags <= -1) {
      const missing = Math.max(1, Math.round(Math.abs(balanceBags)))
      const lossUsd = formatSignedUSD(-Math.round(Math.abs(balanceUsd || missing * bagCostStore)), {
        decimals: 0,
      })
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-extrabold text-sm">
          🔴 {t('food_cost.fridge_meter.missing_bags_fmt')} {missing} {bagsWord} ({lossUsd})
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
        ✅ {t('food_cost.fridge_meter.in_rule_badge')}
      </span>
    )
  }

  return (
    <div className="space-y-5">
      {/* Cinta discreta de Semana de Pruebas + Botón Traspasos entre Tiendas */}
      <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/90 dark:bg-indigo-950/40 px-4 py-2.5 flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase bg-indigo-600 text-white">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t('food_cost.fridge_meter.weekly_test_badge')}
        </span>
        <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-200 flex-1 min-w-[240px]">
          {t('food_cost.fridge_meter.weekly_test_desc')}
        </p>
        <button
          type="button"
          onClick={() => setShowTransferModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-indigo-100 dark:hover:bg-slate-800 border border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200 text-xs font-black shadow-2xs cursor-pointer transition-all"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          {t('food_cost.store_transfers.open_btn')}
        </button>
      </div>

      {/* ===================================================================== */}
      {/* VISTA A: RESUMEN LIMPIO DE LAS 15 SUCURSALES (IGUAL QUE EL CORREO)    */}
      {/* ===================================================================== */}
      {selectedStoreNumericId === null ? (
        <div className="space-y-5">
          {/* 3 Cuadros Grandes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 p-5 text-center shadow-sm">
              <div className="text-xs font-extrabold uppercase tracking-wider text-rose-800 dark:text-rose-300">
                {t('food_cost.fridge_meter.card_shortage_stores')}
              </div>
              <div className="text-4xl font-black text-rose-600 dark:text-rose-400 mt-1">
                {shortageStores.length}
              </div>
              <div className="text-sm font-bold text-rose-700 dark:text-rose-300 mt-1">
                {shortageStores.length > 0
                  ? `−${totalMissingBags} ${bagsWord} (${formatSignedUSD(-totalShortageUsd, { decimals: 0 })})`
                  : t('food_cost.fridge_meter.card_no_loss')}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/30 p-5 text-center shadow-sm">
              <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                {t('food_cost.fridge_meter.card_ok_stores')}
              </div>
              <div className="text-4xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                {okStores.length}
              </div>
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                {t('food_cost.fridge_meter.card_no_loss')}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 p-5 text-center shadow-sm">
              <div className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                {t('food_cost.fridge_meter.card_uncounted_stores')}
              </div>
              <div className="text-4xl font-black text-amber-600 dark:text-amber-400 mt-1">
                {uncountedStores.length}
              </div>
              <div className="text-sm font-bold text-amber-700 dark:text-amber-300 mt-1 truncate">
                {uncountedStores.length > 0
                  ? sortStoresAlphabetically(uncountedStores, (u) => u.storeName)
                      .map((u) => formatStoreDisplayName({ id: u.storeId, name: u.storeName }))
                      .join(', ')
                  : t('food_cost.fridge_meter.card_none')}
              </div>
            </div>
          </div>

          {/* 1 Sola Tabla Limpia de 4 Columnas + Botón Ver Día por Día */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <StoreIcon className="w-5 h-5 text-slate-700 dark:text-slate-200" />
                  <span>
                    {t('food_cost.fridge_meter.stores_ranking_title')} · {ingredientName}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t('food_cost.fridge_meter.stores_ranking_hint')}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-extrabold uppercase tracking-wider text-xs border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4 text-left">{t('food_cost.fridge_meter.col_store')}</th>
                    <th className="py-3.5 px-4 text-center">
                      {isMultiDayWindow
                        ? t('food_cost.fridge_meter.col_sold_day')
                        : t('food_cost.fridge_meter.col_should_remain')}
                    </th>
                    <th className="py-3.5 px-4 text-center">
                      {isMultiDayWindow
                        ? t('food_cost.fridge_meter.col_used_real')
                        : t('food_cost.fridge_meter.col_captured')}
                    </th>
                    <th className="py-3.5 px-4 text-right">{t('food_cost.fridge_meter.col_day_result')}</th>
                    <th className="py-3.5 px-4 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {storesComparison.map((st) => {
                    const cumBags = st.cumulativeFridgeBalanceBags
                    const cumUsd = st.cumulativeFridgeBalanceDollarStore
                    const isShortage = st.hasMeasuredSpan && !st.hasNegativeCountAnomaly && cumBags !== null && cumBags <= -1
                    const actual = st.closingBags !== null ? Math.round(st.closingBags) : null
                    const missing = isShortage ? Math.max(1, Math.round(Math.abs(cumBags || 0))) : 0
                    const expectedDisplay =
                      !st.hasMeasuredSpan || actual === null
                        ? null
                        : isShortage
                          ? actual + missing
                          : st.expectedEndingBags !== null
                            ? Math.max(0, Math.round(st.expectedEndingBags))
                            : actual

                    const col2Val = isMultiDayWindow
                      ? st.hasMeasuredSpan
                        ? Math.round(st.toastSoldSpanBags)
                        : null
                      : expectedDisplay
                    const col3Val = isMultiDayWindow
                      ? st.hasMeasuredSpan && st.fridgeUsedBags !== null
                        ? Math.round(st.fridgeUsedBags)
                        : null
                      : actual

                    return (
                      <tr
                        key={st.storeId}
                        onClick={() => onSelectStoreNumericId(st.storeId)}
                        className={`cursor-pointer transition-colors ${
                          isShortage
                            ? 'bg-rose-50/35 hover:bg-rose-50/70 dark:bg-rose-950/15 dark:hover:bg-rose-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-3.5 px-4 font-extrabold text-slate-900 dark:text-white text-base">
                          {formatStoreDisplayName({ id: st.storeId, name: st.storeName })}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-slate-700 dark:text-slate-200">
                          {col2Val !== null ? `${col2Val} ${bagsWord}` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-center font-extrabold text-slate-900 dark:text-white">
                          {col3Val !== null ? `${col3Val} ${bagsWord}` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {!st.hasMeasuredSpan ? (
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                              ⚠️ {t('food_cost.fridge_meter.unmeasured_store')}
                            </span>
                          ) : st.hasNegativeCountAnomaly ? (
                            renderCleanDiffPill(cumBags, cumUsd, true)
                          ) : isShortage ? (
                            renderCleanDiffPill(cumBags, cumUsd)
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                              ✅ {t('food_cost.fridge_meter.in_rule_badge')}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-extrabold hover:bg-slate-800">
                            <span>{t('food_cost.fridge_meter.view_ledger_btn')}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* ===================================================================== */
        /* VISTA B: DETALLE DÍA POR DÍA DE UNA SOLA SUCURSAL (SÚPER LIMPIA)      */
        /* ===================================================================== */
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {onBackToAllStores && (
              <button
                type="button"
                onClick={onBackToAllStores}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-extrabold hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('food_cost.fridge_meter.back_all_stores')}</span>
              </button>
            )}
            <div className="text-lg md:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <PackageCheck className="w-6 h-6 text-red-600" />
              <span>
                {formatStoreDisplayName({ id: selectedStoreNumericId, name: selectedStoreSummary?.storeName || storeName })} · {ingredientName}
              </span>
            </div>
          </div>

          {/* 3 Cuadros Grandes de esta Sucursal */}
          {selectedStoreSummary && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center shadow-sm">
                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  {t('food_cost.fridge_meter.card_last_close')}{' '}
                  {selectedStoreSummary.latestCloseCut ? `(${selectedStoreSummary.latestCloseCut.periodLabel})` : ''}
                </div>
                <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">
                  {selectedStoreSummary.latestCloseCut?.closingBags !== null &&
                  selectedStoreSummary.latestCloseCut?.closingBags !== undefined
                    ? `${Math.round(selectedStoreSummary.latestCloseCut.closingBags)} ${bagsWord}`
                    : '—'}
                </div>
                {selectedStoreSummary.latestCloseCut?.closingCountedBy && (
                  <div className="text-xs font-semibold text-slate-500 mt-1">
                    {selectedStoreSummary.latestCloseCut.closingCountedBy}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center shadow-sm flex flex-col items-center justify-center">
                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                  {t('food_cost.fridge_meter.card_last_result')}
                </div>
                {renderCleanDiffPill(
                  selectedStoreSummary.latestCloseCut?.fridgeBalanceBags ?? null,
                  selectedStoreSummary.latestCloseCut?.fridgeBalanceDollarStore ?? null
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center shadow-sm flex flex-col items-center justify-center">
                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                  {t('food_cost.fridge_meter.card_period_result')}
                </div>
                {renderCleanDiffPill(
                  selectedStoreSummary.cumulativeFridgeBalanceBags,
                  selectedStoreSummary.cumulativeFridgeBalanceDollarStore,
                  selectedStoreSummary.hasNegativeCountAnomaly
                )}
              </div>
            </div>
          )}

          {/* 1 Sola Tabla Limpia Día por Día */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base md:text-lg font-black text-slate-900 dark:text-white">
                {t('food_cost.fridge_meter.ledger_title')} ({bagWeightLbs} lb = {formatSignedUSD(bagCostStore)})
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-extrabold uppercase tracking-wider text-xs border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4 text-left">{t('food_cost.fridge_meter.col_date')}</th>
                    <th className="py-3.5 px-4 text-center">{t('food_cost.fridge_meter.col_had_day')}</th>
                    <th className="py-3.5 px-4 text-center">{t('food_cost.fridge_meter.col_sold_day')}</th>
                    <th className="py-3.5 px-4 text-center">{t('food_cost.fridge_meter.col_should_remain')}</th>
                    <th className="py-3.5 px-4 text-center">{t('food_cost.fridge_meter.col_captured')}</th>
                    <th className="py-3.5 px-4 text-right">{t('food_cost.fridge_meter.col_day_result')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dailyFridgeLedger.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400 font-semibold">
                        {t('food_cost.no_data')}
                      </td>
                    </tr>
                  ) : (
                    dailyFridgeLedger.map((row) => {
                      const isPending = row.status === 'pending_count'
                      const availRounded =
                        row.availableInFridgeBags !== null ? Math.round(row.availableInFridgeBags) : null
                      const soldRounded = Math.round(row.toastSoldBags)
                      const actualRounded = row.closingBags !== null ? Math.round(row.closingBags) : null
                      const isDayShortage = (row.fridgeBalanceBags ?? 0) <= -1
                      const dayMissing = isDayShortage
                        ? Math.max(1, Math.round(Math.abs(row.fridgeBalanceBags || 0)))
                        : 0
                      const expectedRounded =
                        actualRounded !== null && isDayShortage
                          ? actualRounded + dayMissing
                          : row.expectedClosingBags !== null
                            ? Math.max(0, Math.round(row.expectedClosingBags))
                            : null

                      return (
                        <tr
                          key={`${row.startDate}_${row.endDate}`}
                          className={
                            isDayShortage
                              ? 'bg-rose-50/40 dark:bg-rose-950/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-3.5 px-4 font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                            {row.periodLabel}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <div className="font-bold text-slate-800 dark:text-slate-100">
                              {availRounded !== null ? `${availRounded} ${bagsWord}` : '—'}
                            </div>
                            {row.openingBags !== null && (
                              <div className="text-xs text-slate-500">
                                ({Math.round(row.openingBags)} {t('food_cost.fridge_meter.yesterday_word')} +{' '}
                                {Math.round(row.arrivedBags)} {t('food_cost.fridge_meter.bodega_word')})
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center font-bold text-cyan-800 dark:text-cyan-300">
                            {soldRounded} {bagsWord}
                          </td>

                          <td className="py-3.5 px-4 text-center font-extrabold text-indigo-900 dark:text-indigo-200">
                            {expectedRounded !== null ? `${expectedRounded} ${bagsWord}` : '—'}
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            {isPending ? (
                              <span className="text-xs font-bold text-amber-600">
                                {t('food_cost.fridge_meter.pending_close')}
                              </span>
                            ) : (
                              <div>
                                <div className="font-black text-slate-900 dark:text-white">
                                  {actualRounded !== null ? `${actualRounded} ${bagsWord}` : '—'}
                                </div>
                                {row.closingCountedBy && (
                                  <div className="text-xs text-slate-500">{row.closingCountedBy}</div>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            {isPending ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              renderCleanDiffPill(
                                row.fridgeBalanceBags,
                                row.fridgeBalanceDollarStore,
                                row.status === 'count_anomaly' || row.hasNegativeCountAnomaly
                              )
                            )}
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
      )}

      <StoreTransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        defaultStoreId={selectedStoreNumericId}
        defaultIngredientId={defaultIngredientId}
        onTransfersUpdated={onTransfersUpdated}
      />
    </div>
  )
}
