'use client'

/**
 * @module components/food-cost/ExecutiveDishesAndStoresPanels
 * @description Sub-paneles ejecutivos del Tablero "Platillos Vendidos & Consumo Teórico vs. Físico Real":
 *   1. `ExecutiveDishesPanel`: Las 10 familias oficiales de platillos vendidos en Toast POS con modal/cajón
 *      desplegable de platillos exactos cobrados.
 *   2. `ExecutiveStoresRankingPanel`: Comparativa lado a lado de las 15 sucursales activas de Tacos Gavilan
 *      con fila consolidada `TOTAL CADENA` y filtro directo en 1 clic hacia cualquier tienda.
 *
 * @businessRules
 *   - 100% bilingüe (`ES` / `EN`) mediante `useLanguage()` (`t('tvf.*')`).
 *   - Todos los montos expresados en dólares estadounidenses (`USD`).
 *   - En `Tacos y Taco Plates`, `exactUnitsServed` refleja los tacos reales servidos (3 por cada Taco Plate).
 *
 * @dataFlow
 *   Props desde `app/admin/food-cost/teorico-vs-fisico/page.tsx` -> renderizado interactivo + `@media print`.
 */

import React, { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Store,
  TrendingDown,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import type {
  ExecutiveDishFamilyKey,
  ExecutiveDishFamilySummary,
  ExecutiveStoreComparisonRow,
  VarianceHealthStatus,
} from '@/lib/inventory/executive-theoretical-vs-physical'

function fmtUsd(val: number, decimals = 0): string {
  const abs = Math.abs(val)
  const str = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${val < 0 ? '-' : ''}$${str}`
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

const FAMILY_TRANSLATION_KEY: Record<ExecutiveDishFamilyKey, string> = {
  tacos: 'tvf.fam_tacos',
  burritos: 'tvf.fam_burritos',
  quesadillas: 'tvf.fam_quesadillas',
  mulitas: 'tvf.fam_mulitas',
  sopes: 'tvf.fam_sopes',
  tortas: 'tvf.fam_tortas',
  plates_breakfast_nachos: 'tvf.fam_plates_breakfast_nachos',
  party_trays_lbs: 'tvf.fam_party_trays_lbs',
  sides_extras: 'tvf.fam_sides_extras',
  aguas_drinks_desserts: 'tvf.fam_aguas_drinks_desserts',
}

export function StatusPill({ status }: { status: VarianceHealthStatus }) {
  const { t } = useLanguage()
  if (status === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
        <AlertTriangle className="w-3 h-3" />
        {t('tvf.status_critical')}
      </span>
    )
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
        <AlertTriangle className="w-3 h-3" />
        {t('tvf.status_warning')}
      </span>
    )
  }
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
        <TrendingDown className="w-3 h-3" />
        {t('tvf.status_saving')}
      </span>
    )
  }
  if (status === 'unmeasured') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
        <Clock className="w-3 h-3" />
        {t('tvf.status_unmeasured')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
      <CheckCircle2 className="w-3 h-3" />
      {t('tvf.status_ok')}
    </span>
  )
}

export function ExecutiveDishesPanel({
  dishFamilies,
}: {
  dishFamilies: ExecutiveDishFamilySummary[]
}) {
  const { t } = useLanguage()
  const [selectedFamily, setSelectedFamily] = useState<ExecutiveDishFamilySummary | null>(null)

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 mb-6 print:shadow-none print:border-slate-300">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-red-600" />
            <span>{t('tvf.sec_dishes_title')}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 print:hidden">
            {t('tvf.sec_dishes_subtitle')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {dishFamilies.map((fam) => {
          const isSelected = selectedFamily?.familyKey === fam.familyKey
          return (
            <button
              key={fam.familyKey}
              type="button"
              onClick={() => setSelectedFamily(isSelected ? null : fam)}
              className={`text-left rounded-xl p-3.5 border transition-all ${
                isSelected
                  ? 'bg-red-50/70 dark:bg-red-950/25 border-red-400 ring-2 ring-red-500/20'
                  : 'bg-slate-50/80 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/70 hover:border-red-300 dark:hover:border-red-700'
              }`}
            >
              <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200 leading-snug">
                {t(FAMILY_TRANSLATION_KEY[fam.familyKey])}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <div className="text-xl font-black text-slate-900 dark:text-white">
                  {Math.round(fam.exactUnitsServed).toLocaleString('en-US')}
                </div>
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  {fmtUsd(fam.netSalesUsd, 0)}
                </div>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {Math.round(fam.ordersSold).toLocaleString('en-US')} {t('tvf.orders_word')} · {fam.shareOfSalesPct}%
              </div>
              {fam.meatRawLbs > 0.5 && (
                <div className="mt-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/60 text-[11px] font-bold text-red-700 dark:text-red-300">
                  🥩 {Math.round(fam.meatRawLbs).toLocaleString('en-US')} {t('tvf.meat_raw_word')} ({Math.round(fam.meatCookedLbs).toLocaleString('en-US')} {t('tvf.meat_cooked_word')})
                </div>
              )}
              <div className="mt-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1 print:hidden">
                <span>{t('tvf.click_to_expand_dishes')}</span>
              </div>
            </button>
          )
        })}
      </div>

      {selectedFamily && (
        <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-slate-50 dark:bg-slate-950/60 p-4 print:hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <ChevronDown className="w-4 h-4 text-red-600" />
              <span>{t(FAMILY_TRANSLATION_KEY[selectedFamily.familyKey])}</span>
              <span className="text-xs font-bold text-slate-500">
                ({Math.round(selectedFamily.exactUnitsServed).toLocaleString('en-US')} {t('tvf.units_served_word')} · {fmtUsd(selectedFamily.netSalesUsd, 0)})
              </span>
            </h3>
            <button
              type="button"
              onClick={() => setSelectedFamily(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
            >
              <X className="w-3.5 h-3.5" />
              {t('tvf.close_btn')}
            </button>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase font-extrabold">
                  <th className="py-2 px-3 text-left">{t('tvf.modal_dishes_col_dish')}</th>
                  <th className="py-2 px-3 text-right">{t('tvf.modal_dishes_col_orders')}</th>
                  <th className="py-2 px-3 text-right">{t('tvf.modal_dishes_col_units')}</th>
                  <th className="py-2 px-3 text-right">{t('tvf.modal_dishes_col_sales')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                {selectedFamily.topItems.map((it) => (
                  <tr key={it.itemName} className="hover:bg-white dark:hover:bg-slate-900/60">
                    <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">{it.itemName}</td>
                    <td className="py-2 px-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                      {Math.round(it.ordersSold).toLocaleString('en-US')}
                    </td>
                    <td className="py-2 px-3 text-right font-extrabold text-slate-900 dark:text-white">
                      {Math.round(it.exactUnitsServed).toLocaleString('en-US')}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-emerald-700 dark:text-emerald-400">
                      {fmtUsd(it.netSalesUsd, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export function ExecutiveStoresRankingPanel({
  storeRows,
  costMode,
  selectedStoreId,
  onSelectStore,
}: {
  storeRows: ExecutiveStoreComparisonRow[]
  costMode: 'store' | 'bodega'
  selectedStoreId: string
  onSelectStore: (storeId: string) => void
}) {
  const { t } = useLanguage()

  const sortedStores = [...storeRows].sort((a, b) => {
    const aMeas = a.allMeasuredItemsCount > 0 ? 1 : 0
    const bMeas = b.allMeasuredItemsCount > 0 ? 1 : 0
    if (aMeas !== bMeas) return bMeas - aMeas
    const aCost = costMode === 'store' ? a.allDiffCostStoreUsd : a.allDiffCostBodegaUsd
    const bCost = costMode === 'store' ? b.allDiffCostStoreUsd : b.allDiffCostBodegaUsd
    return bCost - aCost
  })

  const chainTotals = storeRows.reduce(
    (acc, r) => {
      acc.sales += r.netSalesUsd
      acc.orders += r.orderCount
      acc.tacos += r.tacosSold
      acc.burritos += r.burritosSold
      acc.tortas += r.tortasSold
      acc.meatsTheoBags += r.meatsTheoBags
      acc.meatsPhysBags += r.meatsPhysicalBags
      acc.meatsTheoLbs += r.meatsTheoRawLbs
      acc.meatsPhysLbs += r.meatsPhysicalRawLbs
      acc.meatsDiffStore += r.meatsDiffCostStoreUsd
      acc.meatsDiffBodega += r.meatsDiffCostBodegaUsd
      acc.meatsEquivTacos += r.meatsEquivTacosDiff
      acc.allTheoStore += r.allTheoCostStoreUsd
      acc.allPhysStore += r.allPhysicalCostStoreUsd
      acc.allDiffStore += r.allDiffCostStoreUsd
      acc.allDiffBodega += r.allDiffCostBodegaUsd
      return acc
    },
    {
      sales: 0,
      orders: 0,
      tacos: 0,
      burritos: 0,
      tortas: 0,
      meatsTheoBags: 0,
      meatsPhysBags: 0,
      meatsTheoLbs: 0,
      meatsPhysLbs: 0,
      meatsDiffStore: 0,
      meatsDiffBodega: 0,
      meatsEquivTacos: 0,
      allTheoStore: 0,
      allPhysStore: 0,
      allDiffStore: 0,
      allDiffBodega: 0,
    }
  )

  const chainMeatsDiffBags = chainTotals.meatsPhysBags - chainTotals.meatsTheoBags
  const chainMeatsDiffLbs = chainTotals.meatsPhysLbs - chainTotals.meatsTheoLbs
  const chainMeatsDiffPct =
    chainTotals.meatsTheoLbs > 0 ? ((chainMeatsDiffLbs / chainTotals.meatsTheoLbs) * 100).toFixed(1) : '0.0'
  const chainEff =
    chainTotals.allPhysStore > 0 ? ((chainTotals.allTheoStore / chainTotals.allPhysStore) * 100).toFixed(1) : null
  const isSingleStoreView = storeRows.length === 1
  const chainMeatsCostDiff = costMode === 'store' ? chainTotals.meatsDiffStore : chainTotals.meatsDiffBodega
  const chainAllCostDiff = costMode === 'store' ? chainTotals.allDiffStore : chainTotals.allDiffBodega

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-8 print:shadow-none print:border-slate-300">
      <div className="p-5 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Store className="w-5 h-5 text-red-600" />
          <span>{isSingleStoreView ? t('tvf.sec_single_store_title') : t('tvf.sec_stores_title')}</span>
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('tvf.sec_stores_subtitle')}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[11px] font-extrabold uppercase text-slate-600 dark:text-slate-300">
              <th className="py-3 px-3 text-left">{t('tvf.st_col_store')}</th>
              <th className="py-3 px-3 text-right">{t('tvf.st_col_sales')}</th>
              <th className="py-3 px-3 text-center">{t('tvf.st_col_dishes')}</th>
              <th className="py-3 px-3 text-right">{t('tvf.st_col_meats_theo')}</th>
              <th className="py-3 px-3 text-right">{t('tvf.st_col_meats_phys')}</th>
              <th className="py-3 px-3 text-right">{t('tvf.st_col_meats_diff')}</th>
              <th className="py-3 px-3 text-right">{t('tvf.st_col_meats_cost_diff')}</th>
              <th className="py-3 px-3 text-center">{t('tvf.st_col_portion_comp')}</th>
              <th className="py-3 px-3 text-right">{t('tvf.st_col_all_cost_diff')}</th>
              <th className="py-3 px-3 text-center">{t('tvf.st_col_efficiency')}</th>
              <th className="py-3 px-3 text-center">{t('tvf.st_col_status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sortedStores.map((st) => {
              const isActive = String(st.storeId) === selectedStoreId
              const meatCostDiff = costMode === 'store' ? st.meatsDiffCostStoreUsd : st.meatsDiffCostBodegaUsd
              const allCostDiff = costMode === 'store' ? st.allDiffCostStoreUsd : st.allDiffCostBodegaUsd
              const isExcessMeat = meatCostDiff > 25
              const isExcessAll = allCostDiff > 25
              return (
                <tr
                  key={st.storeId}
                  onClick={() => onSelectStore(String(st.storeId))}
                  className={`cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-amber-50/70 dark:bg-amber-950/25'
                      : st.status === 'critical'
                        ? 'bg-rose-50/25 hover:bg-rose-50/60 dark:bg-rose-950/10 dark:hover:bg-rose-950/25'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <td className="py-3 px-3 font-black text-slate-900 dark:text-white whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{st.storeName}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 print:hidden" />
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    <div className="font-extrabold text-slate-900 dark:text-white">{fmtUsd(st.netSalesUsd, 0)}</div>
                    <div className="text-[10px] text-slate-500">
                      {st.orderCount.toLocaleString('en-US')} {t('tvf.orders_count_fmt')}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      🌮 {st.tacosSold.toLocaleString('en-US')} · 🌯 {st.burritosSold.toLocaleString('en-US')} · 🥖 {st.tortasSold.toLocaleString('en-US')}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      {st.meatsTheoBags.toFixed(1)} {t('tvf.bags_short')}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {Math.round(st.meatsTheoRawLbs).toLocaleString('en-US')} {t('tvf.lbs_short')}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    {st.meatsMeasuredCount > 0 ? (
                      <>
                        <div className="font-extrabold text-slate-900 dark:text-white">
                          {st.meatsPhysicalBags.toFixed(1)} {t('tvf.bags_short')}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {Math.round(st.meatsPhysicalRawLbs).toLocaleString('en-US')} {t('tvf.lbs_short')}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    {st.meatsMeasuredCount > 0 ? (
                      <>
                        <div
                          className={`font-extrabold ${
                            st.meatsDiffRawLbs > 10
                              ? 'text-rose-600 dark:text-rose-400'
                              : st.meatsDiffRawLbs < -10
                                ? 'text-sky-600 dark:text-sky-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {fmtSignedNum(st.meatsDiffBags, 1)} {t('tvf.bags_short')}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {fmtSignedNum(st.meatsDiffRawLbs, 0)} {t('tvf.lbs_short')}{' '}
                          {st.meatsDiffPct !== null ? `(${fmtSignedNum(st.meatsDiffPct, 1)}%)` : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    {st.meatsMeasuredCount > 0 ? (
                      <div
                        className={`font-black ${
                          isExcessMeat
                            ? 'text-rose-600 dark:text-rose-400'
                            : meatCostDiff < -25
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {fmtSignedUsd(meatCostDiff, 0)}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    {st.meatsMeasuredCount > 0 ? (
                      <>
                        {st.asadaRealOzPerTaco !== null && (
                          <div className="font-bold text-slate-800 dark:text-slate-200">
                            {st.asadaRealOzPerTaco.toFixed(2)} {t('tvf.oz_per_taco_short')}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-500">
                          {fmtSignedNum(st.meatsEquivTacosDiff, 0)} {t('tvf.tacos_equiv_short')}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    {st.allMeasuredItemsCount > 0 ? (
                      <div
                        className={`font-black ${
                          isExcessAll
                            ? 'text-rose-600 dark:text-rose-400'
                            : allCostDiff < -25
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {fmtSignedUsd(allCostDiff, 0)}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center font-extrabold text-slate-800 dark:text-slate-200">
                    {st.allEfficiencyPct !== null ? `${st.allEfficiencyPct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-center whitespace-nowrap">
                    <StatusPill status={st.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-900 text-white font-black text-xs">
              <td className="py-3.5 px-3">
                {isSingleStoreView ? t('tvf.st_total_single_store_row') : t('tvf.st_total_chain_row')}
              </td>
              <td className="py-3.5 px-3 text-right">{fmtUsd(chainTotals.sales, 0)}</td>
              <td className="py-3.5 px-3 text-center">
                🌮 {chainTotals.tacos.toLocaleString('en-US')} · 🌯 {chainTotals.burritos.toLocaleString('en-US')} · 🥖 {chainTotals.tortas.toLocaleString('en-US')}
              </td>
              <td className="py-3.5 px-3 text-right">
                {chainTotals.meatsTheoBags.toFixed(1)} {t('tvf.bags_short')}
                <div className="text-[10px] font-semibold text-slate-300">
                  {Math.round(chainTotals.meatsTheoLbs).toLocaleString('en-US')} {t('tvf.lbs_short')}
                </div>
              </td>
              <td className="py-3.5 px-3 text-right">
                {chainTotals.meatsPhysBags.toFixed(1)} {t('tvf.bags_short')}
                <div className="text-[10px] font-semibold text-slate-300">
                  {Math.round(chainTotals.meatsPhysLbs).toLocaleString('en-US')} {t('tvf.lbs_short')}
                </div>
              </td>
              <td
                className={`py-3.5 px-3 text-right ${
                  chainMeatsDiffBags > 0.5
                    ? 'text-amber-300'
                    : chainMeatsDiffBags < -0.5
                      ? 'text-sky-300'
                      : 'text-emerald-300'
                }`}
              >
                {fmtSignedNum(chainMeatsDiffBags, 1)} {t('tvf.bags_short')}
                <div className="text-[10px] font-semibold">
                  {fmtSignedNum(chainMeatsDiffLbs, 0)} {t('tvf.lbs_short')} ({Number(chainMeatsDiffPct) >= 0 ? '+' : ''}{chainMeatsDiffPct}%)
                </div>
              </td>
              <td
                className={`py-3.5 px-3 text-right ${
                  chainMeatsCostDiff > 25 ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                {fmtSignedUsd(chainMeatsCostDiff, 0)}
              </td>
              <td className="py-3.5 px-3 text-center text-slate-200">
                {fmtSignedNum(chainTotals.meatsEquivTacos, 0)} {t('tvf.tacos_equiv_short')}
              </td>
              <td
                className={`py-3.5 px-3 text-right ${
                  chainAllCostDiff > 25 ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                {fmtSignedUsd(chainAllCostDiff, 0)}
              </td>
              <td className="py-3.5 px-3 text-center text-emerald-300">
                {chainEff ? `${chainEff}%` : '—'}
              </td>
              <td className="py-3.5 px-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
