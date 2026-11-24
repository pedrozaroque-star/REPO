'use client'

/**
 * @module components/food-cost/ToastVsFridgeMeterPanel
 * @description Panel visual ejecutivo del Medidor "Cierre Diario del Refrigerador: Debería Quedar (Según Toast) vs. Sobrante Real":
 *   1. Banner de Semana de Pruebas Privadas (`carlos@tacosgavilan.com` exclusivo + `shadow_blind` en las 15 sucursales).
 *   2. Corte Diario del Refrigerador al Final del Día (`Refri Inicial + Factura QBO Bodega = Había en Refri − Vendido Toast = Debería Quedar vs. Hay en Refri`).
 *   3. Tabla de Platillos Vendidos en Toast POS → Bolsas Descontadas del Refrigerador (`Tacos`, `Burritos`, `Quesadillas`, etc.).
 *   4. Semáforo de las 15 Sucursales con Último Cierre del Refrigerador + Balance Acumulado del Periodo (selección a 1 clic).
 *
 * @businessRules
 * - Al final del día el sobrante es lo que queda físicamente en bolsas cerradas dentro del refrigerador (`Orden Diaria`).
 * - Signo intuitivo de corte de caja / refrigerador (`Hay en Refri − Debería Quedar`):
 *   * Negativo (`-X bolsas / -$ USD` 🔴): FALTAN bolsas en el refrigerador respecto a las ventas cobradas en Toast POS (pérdida / sobre-porcionado).
 *   * Cerca de cero (`±0.5 bolsa` 🟢): Refrigerador cuadrado con Toast POS.
 *   * Positivo (`+X bolsas / +$ USD` 🔵): Quedaron bolsas cerradas de más en el refrigerador (porción menor a `1.50 oz` o conteo inflado vigilado por `reboundSuspected`).
 * - 100% bilingüe (`es` / `en`) vía `useLanguage()` (`t('food_cost.fridge_meter.*')`).
 * - Sin importaciones de servidor (100% seguro en el bundle cliente de Next.js).
 */

import React from 'react'
import {
  PackageCheck,
  Receipt,
  UtensilsCrossed,
  Store as StoreIcon,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatSignedUSD } from '@/lib/inventory/food-cost-sales-resolver'

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
  bagWeightLbs: number
  bagCostStore: number
  expectedEndingBags: number | null
  endingBags: number | null
  dailyFridgeLedger: ClientFridgeLedgerEntry[]
  storesComparison: ClientStoreFridgeComparison[]
  familyEquivalence: ClientFamilyEquivalence | null
  selectedStoreNumericId: number | null
  onSelectStoreNumericId: (storeNumericId: number) => void
}

export default function ToastVsFridgeMeterPanel({
  ingredientName,
  bagWeightLbs,
  bagCostStore,
  expectedEndingBags,
  endingBags,
  dailyFridgeLedger,
  storesComparison,
  familyEquivalence,
  selectedStoreNumericId,
  onSelectStoreNumericId,
}: ToastVsFridgeMeterPanelProps) {
  const { t, language } = useLanguage()
  const isEn = language === 'en'
  const bagsWord = t('food_cost.fridge_meter.bags_unit')

  const renderFridgeBalanceBadge = (
    balanceBags: number | null,
    balanceUsd: number | null,
    unbilledTacos: number | null,
    reboundSuspected = false
  ) => {
    if (balanceBags === null) return <span className="text-slate-400">—</span>
    const usdVal = balanceUsd ?? 0
    const isShortage = balanceBags < -0.5
    const isExtra = balanceBags > 0.5
    const signBags = balanceBags > 0 ? `+${balanceBags.toFixed(2)}` : balanceBags.toFixed(2)

    return (
      <div>
        <span
          className={`font-black ${
            isShortage
              ? 'text-rose-600 dark:text-rose-400'
              : isExtra
                ? 'text-sky-700 dark:text-sky-300'
                : 'text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {isShortage ? '🔴 ' : isExtra ? '🔵 ' : '🟢 '}
          {signBags} {bagsWord} ({formatSignedUSD(usdVal, { showPlus: usdVal > 0 })})
        </span>
        <div className="text-[10px] font-sans text-slate-500">
          {isShortage
            ? `${t('food_cost.fridge_meter.missing_in_fridge')}${
                unbilledTacos !== null && Math.abs(unbilledTacos) >= 5
                  ? ` (~${Math.abs(unbilledTacos)} ${t('food_cost.fridge_meter.tacos_word')})`
                  : ''
              }`
            : isExtra
              ? t('food_cost.fridge_meter.extra_in_fridge')
              : t('food_cost.fridge_meter.within_tol')}
        </div>
        {reboundSuspected && (
          <div className="text-[10px] font-sans font-bold text-amber-700 dark:text-amber-300 mt-0.5">
            {t('food_cost.fridge_meter.rebound_warning')}
          </div>
        )}
      </div>
    )
  }

  const periodNetBalanceBags =
    expectedEndingBags !== null && endingBags !== null
      ? Math.round((endingBags - expectedEndingBags) * 100) / 100
      : familyEquivalence?.excessBagsCooked !== null && familyEquivalence?.excessBagsCooked !== undefined
        ? Math.round(-familyEquivalence.excessBagsCooked * 100) / 100
        : null

  const periodNetBalanceUsd =
    familyEquivalence?.dollarLossStoreUsd !== null && familyEquivalence?.dollarLossStoreUsd !== undefined
      ? Math.round(-familyEquivalence.dollarLossStoreUsd * 100) / 100
      : periodNetBalanceBags !== null
        ? Math.round(periodNetBalanceBags * bagCostStore * 100) / 100
        : null

  return (
    <div className="space-y-5">
      {/* Banner Semana de Pruebas Privadas */}
      <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/90 dark:bg-indigo-950/40 px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase bg-indigo-600 text-white">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t('food_cost.fridge_meter.weekly_test_badge')}
        </span>
        <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-200 flex-1 min-w-[260px]">
          {t('food_cost.fridge_meter.weekly_test_desc')}
        </p>
      </div>

      {/* 1. CORTE DIARIO DEL REFRIGERADOR AL FINAL DEL DÍA: DEBERÍA QUEDAR (SEGÚN TOAST) VS. HAY EN EL REFRI */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 md:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900">
          <div>
            <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
              <PackageCheck className="w-5 h-5 text-cyan-600" />
              <span>{t('food_cost.fridge_meter.ledger_title')}</span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-100 text-cyan-900 dark:bg-cyan-900/40 dark:text-cyan-200">
                {ingredientName} ({bagWeightLbs} lb = {formatSignedUSD(bagCostStore)})
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('food_cost.fridge_meter.subtitle')}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-extrabold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-700">
                <th className="p-3 text-left">{t('food_cost.fridge_meter.col_date')}</th>
                <th className="p-3 text-right">{t('food_cost.fridge_meter.col_open')}</th>
                <th className="p-3 text-right">{t('food_cost.fridge_meter.col_arrived')}</th>
                <th className="p-3 text-right bg-slate-200/40 dark:bg-slate-800">
                  {t('food_cost.fridge_meter.col_available')}
                </th>
                <th className="p-3 text-right bg-cyan-50/80 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-300">
                  {t('food_cost.fridge_meter.col_toast_sold')}
                </th>
                <th className="p-3 text-right bg-indigo-50/90 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200">
                  {t('food_cost.fridge_meter.col_expected_close')}
                </th>
                <th className="p-3 text-right bg-amber-50/90 dark:bg-amber-950/35 text-amber-950 dark:text-amber-200">
                  {t('food_cost.fridge_meter.col_close')}
                </th>
                <th className="p-3 text-right">{t('food_cost.fridge_meter.col_diff')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {dailyFridgeLedger.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center font-sans text-slate-400 font-semibold">
                    {t('food_cost.no_data')}
                  </td>
                </tr>
              ) : (
                dailyFridgeLedger.map((row) => {
                  const isShortageCrit = (row.fridgeBalanceBags ?? 0) <= -2
                  const isShortageWarn = (row.fridgeBalanceBags ?? 0) < -0.5 && !isShortageCrit
                  const isAnomaly = row.status === 'count_anomaly'
                  const isPending = row.status === 'pending_count'

                  return (
                    <tr
                      key={`${row.startDate}_${row.endDate}`}
                      className={
                        isAnomaly
                          ? 'bg-purple-50/60 dark:bg-purple-950/20'
                          : isShortageCrit
                            ? 'bg-rose-50/55 dark:bg-rose-950/25'
                            : isShortageWarn
                              ? 'bg-amber-50/40 dark:bg-amber-950/15'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }
                    >
                      <td className="p-3 font-sans font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        <div>{row.periodLabel}</div>
                        <div className="text-[10px] font-normal text-slate-400">
                          {Math.round(row.tacosSold).toLocaleString()} {t('food_cost.fridge_meter.tacos_word')} ·{' '}
                          {Math.round(row.burritosSold).toLocaleString()} {t('food_cost.fridge_meter.burritos_word')}
                        </div>
                      </td>

                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="font-bold text-slate-700 dark:text-slate-200">
                          {row.openingBags !== null ? `${row.openingBags} ${bagsWord}` : '—'}
                        </div>
                        {row.openingCountedBy && (
                          <div className="text-[10px] font-sans text-slate-400 truncate max-w-[130px] ml-auto">
                            {row.openingCountedBy}
                          </div>
                        )}
                      </td>

                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="font-bold text-indigo-700 dark:text-indigo-300">
                          +{row.arrivedBags} {bagsWord}
                        </div>
                        {row.invoiceNumbers.length > 0 ? (
                          <div className="text-[10px] font-sans text-indigo-600 dark:text-indigo-400 flex items-center justify-end gap-1">
                            <Receipt className="w-3 h-3" />
                            <span>
                              {t('food_cost.fridge_meter.invoice_label')} {row.invoiceNumbers.join(', ')}
                            </span>
                          </div>
                        ) : row.hasUnreconciledSentOrder ? (
                          <div className="text-[10px] font-sans text-amber-600">
                            {t('food_cost.fridge_meter.estimate_pending')}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3 text-right font-bold bg-slate-100/60 dark:bg-slate-800/40 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {row.availableInFridgeBags !== null ? `${row.availableInFridgeBags} ${bagsWord}` : '—'}
                      </td>

                      <td className="p-3 text-right font-black bg-cyan-50/50 dark:bg-cyan-950/20 text-cyan-900 dark:text-cyan-200 whitespace-nowrap">
                        <div>
                          −{row.toastSoldBags.toFixed(2)} {bagsWord}
                        </div>
                        <div className="text-[10px] font-normal text-cyan-700 dark:text-cyan-400">
                          {row.toastSoldRawLbs.toFixed(1)} lb
                        </div>
                      </td>

                      <td className="p-3 text-right font-black bg-indigo-50/60 dark:bg-indigo-950/25 text-indigo-950 dark:text-indigo-200 whitespace-nowrap">
                        {row.expectedClosingBags === null ? (
                          '—'
                        ) : row.expectedClosingBags < 0 ? (
                          <div>
                            <div>0 {bagsWord}</div>
                            <div className="text-[10px] font-sans font-semibold text-indigo-600 dark:text-indigo-300">
                              ({isEn ? `Toast exceeded by ${Math.abs(row.expectedClosingBags).toFixed(2)}b` : `Toast superó por ${Math.abs(row.expectedClosingBags).toFixed(2)}b`})
                            </div>
                          </div>
                        ) : (
                          `${row.expectedClosingBags.toFixed(2)} ${bagsWord}`
                        )}
                      </td>

                      <td className="p-3 text-right bg-amber-50/50 dark:bg-amber-950/20 whitespace-nowrap">
                        {isPending ? (
                          <span className="font-sans text-[11px] font-bold text-amber-600">
                            {t('food_cost.fridge_meter.pending_close')}
                          </span>
                        ) : (
                          <>
                            <div className="font-black text-amber-950 dark:text-amber-200">
                              {row.closingBags !== null ? `${row.closingBags} ${bagsWord}` : '—'}
                            </div>
                            {row.closingCountedBy && (
                              <div className="text-[10px] font-sans text-slate-500 truncate max-w-[130px] ml-auto">
                                {row.closingCountedBy}
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      <td className="p-3 text-right whitespace-nowrap">
                        {isPending ? (
                          <span className="text-slate-400">—</span>
                        ) : isAnomaly ? (
                          <div className="text-purple-700 dark:text-purple-300 font-bold font-sans text-[11px]">
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              +{Math.abs(row.fridgeBalanceBags || 0).toFixed(2)}b
                            </span>
                            <div className="text-[10px]">{t('food_cost.fridge_meter.count_anomaly')}</div>
                          </div>
                        ) : (
                          renderFridgeBalanceBadge(
                            row.fridgeBalanceBags,
                            row.fridgeBalanceDollarStore,
                            row.unbilledTacosEquiv,
                            row.reboundSuspected
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

      {/* 2. PLATILLOS COBRADOS EN TOAST -> BOLSAS DESCONTADAS DEL REFRIGERADOR */}
      {familyEquivalence && familyEquivalence.families.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 md:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-red-600" />
              <span>{t('food_cost.fridge_meter.dishes_title')}</span>
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-extrabold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-700">
                  <th className="p-3 text-left">{t('food_cost.fridge_meter.col_family')}</th>
                  <th className="p-3 text-right">{t('food_cost.fridge_meter.col_units_sold')}</th>
                  <th className="p-3 text-right">{t('food_cost.fridge_meter.col_cooked_lbs')}</th>
                  <th className="p-3 text-right">{t('food_cost.fridge_meter.col_raw_lbs')}</th>
                  <th className="p-3 text-right bg-cyan-50/80 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-300">
                    {t('food_cost.fridge_meter.col_equiv_bags')}
                  </th>
                  <th className="p-3 text-right">{t('food_cost.fridge_meter.col_cost_store')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {familyEquivalence.families
                  .filter((f) => f.rawLbs > 0)
                  .map((fam) => (
                    <tr key={fam.familyKey} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-sans">
                        <div className="font-bold text-slate-800 dark:text-slate-100">
                          {isEn ? fam.labelEn : fam.labelEs}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {isEn ? fam.standardRuleEn : fam.standardRuleEs}
                        </div>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800 dark:text-slate-100">
                        {fam.familyKey === 'party_trays_lbs'
                          ? `${fam.ordersOrPlatesSold.toLocaleString()} ord.`
                          : Math.round(fam.exactUnitsServed).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-slate-600 dark:text-slate-300">
                        {fam.cookedLbs.toFixed(1)} lb
                      </td>
                      <td className="p-3 text-right text-slate-700 dark:text-slate-200 font-bold">
                        {fam.rawLbs.toFixed(1)} lb
                      </td>
                      <td className="p-3 text-right font-black bg-cyan-50/50 dark:bg-cyan-950/20 text-cyan-900 dark:text-cyan-200">
                        −{fam.equivalentBagsCooked.toFixed(2)} {bagsWord} ({fam.sharePct.toFixed(1)}%)
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800 dark:text-slate-100">
                        {formatSignedUSD(fam.costStoreUsd)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-mono text-xs">
                <tr>
                  <td colSpan={4} className="p-3 font-sans font-extrabold text-right">
                    {t('food_cost.fridge_meter.total_toast_bags')}:
                  </td>
                  <td className="p-3 text-right font-black text-cyan-300">
                    −{familyEquivalence.totals.theoreticalBagsCooked.toFixed(2)} {bagsWord}
                  </td>
                  <td className="p-3 text-right text-slate-300">
                    {familyEquivalence.totals.totalRawLbs.toFixed(1)} lb
                  </td>
                </tr>
                {expectedEndingBags !== null && endingBags !== null && periodNetBalanceBags !== null && (
                  <>
                    <tr className="border-t border-slate-800">
                      <td colSpan={4} className="p-3 font-sans font-extrabold text-right">
                        {t('food_cost.fridge_meter.total_expected_fridge')}:
                      </td>
                      <td className="p-3 text-right font-black text-indigo-300">
                        {expectedEndingBags.toFixed(2)} {bagsWord}
                      </td>
                      <td className="p-3 text-right text-slate-400">—</td>
                    </tr>
                    <tr className="border-t border-slate-800">
                      <td colSpan={4} className="p-3 font-sans font-extrabold text-right">
                        {t('food_cost.fridge_meter.total_actual_fridge')}:
                      </td>
                      <td className="p-3 text-right font-black text-amber-300">
                        {endingBags.toFixed(2)} {bagsWord}
                      </td>
                      <td className="p-3 text-right text-slate-400">—</td>
                    </tr>
                    <tr className="border-t border-slate-700 bg-slate-950">
                      <td colSpan={4} className="p-3 font-sans font-extrabold text-right">
                        {t('food_cost.fridge_meter.net_bag_diff')}:
                      </td>
                      <td
                        className={`p-3 text-right font-black ${
                          periodNetBalanceBags < -0.5
                            ? 'text-rose-400'
                            : periodNetBalanceBags > 0.5
                              ? 'text-sky-300'
                              : 'text-emerald-400'
                        }`}
                      >
                        {periodNetBalanceBags > 0 ? `+${periodNetBalanceBags.toFixed(2)}` : periodNetBalanceBags.toFixed(2)}{' '}
                        {bagsWord}
                      </td>
                      <td
                        className={`p-3 text-right font-black ${
                          (periodNetBalanceUsd || 0) < 0
                            ? 'text-rose-400'
                            : (periodNetBalanceUsd || 0) > 0
                              ? 'text-sky-300'
                              : 'text-emerald-400'
                        }`}
                      >
                        {formatSignedUSD(periodNetBalanceUsd || 0, {
                          showPlus: (periodNetBalanceUsd || 0) > 0,
                        })}
                      </td>
                    </tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 3. SEMÁFORO DE LAS 15 SUCURSALES: ÚLTIMO CIERRE DEL REFRIGERADOR + BALANCE ACUMULADO */}
      {storesComparison.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 md:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <StoreIcon className="w-5 h-5 text-emerald-600" />
              <span>{t('food_cost.fridge_meter.stores_ranking_title')}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{t('food_cost.fridge_meter.stores_ranking_hint')}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-extrabold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-700">
                  <th className="p-2.5 text-left">{t('food_cost.fridge_meter.col_store')}</th>
                  <th className="p-2.5 text-left">{t('food_cost.fridge_meter.col_last_cut')}</th>
                  <th className="p-2.5 text-right">{t('food_cost.fridge_meter.col_available')}</th>
                  <th className="p-2.5 text-right bg-cyan-50/80 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-300">
                    {t('food_cost.fridge_meter.col_toast_sold')}
                  </th>
                  <th className="p-2.5 text-right bg-indigo-50/90 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200">
                    {t('food_cost.fridge_meter.col_expected_close')}
                  </th>
                  <th className="p-2.5 text-right bg-amber-50/90 dark:bg-amber-950/35 text-amber-950 dark:text-amber-200">
                    {t('food_cost.fridge_meter.col_close')}
                  </th>
                  <th className="p-2.5 text-right">{t('food_cost.fridge_meter.col_last_diff')}</th>
                  <th className="p-2.5 text-right">{t('food_cost.fridge_meter.col_cum_diff')}</th>
                  <th className="p-2.5 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {storesComparison.map((st) => {
                  const isSelected = selectedStoreNumericId === st.storeId
                  const lc = st.latestCloseCut
                  const cumBags = st.cumulativeFridgeBalanceBags
                  const cumUsd = st.cumulativeFridgeBalanceDollarStore
                  return (
                    <tr
                      key={st.storeId}
                      onClick={() => onSelectStoreNumericId(st.storeId)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-red-50/80 dark:bg-red-950/30 font-bold'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="p-2.5 font-sans font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        #{st.storeId} {st.storeName}
                        {st.hasMeasuredSpan && (
                          <span className="ml-1.5 text-[10px] font-normal text-slate-400">({st.spanDays}d)</span>
                        )}
                      </td>
                      <td className="p-2.5 font-sans text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {lc ? lc.periodLabel : '—'}
                      </td>
                      <td className="p-2.5 text-right text-slate-700 dark:text-slate-200">
                        {lc && lc.availableInFridgeBags !== null ? lc.availableInFridgeBags : '—'}
                      </td>
                      <td className="p-2.5 text-right font-bold bg-cyan-50/40 dark:bg-cyan-950/15 text-cyan-900 dark:text-cyan-200">
                        {lc ? `−${lc.toastSoldBags.toFixed(2)}` : `−${st.toastSoldWindowBags.toFixed(2)}`}
                      </td>
                      <td className="p-2.5 text-right font-black bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-950 dark:text-indigo-200">
                        {!lc || lc.expectedClosingBags === null ? (
                          '—'
                        ) : lc.expectedClosingBags < 0 ? (
                          <span title={isEn ? `Recipe needed ${Math.abs(lc.expectedClosingBags).toFixed(2)} more bags` : `Receta pedía ${Math.abs(lc.expectedClosingBags).toFixed(2)}b más`}>
                            0 <span className="text-[10px] font-normal text-indigo-600">({lc.expectedClosingBags.toFixed(1)})</span>
                          </span>
                        ) : (
                          lc.expectedClosingBags.toFixed(2)
                        )}
                      </td>
                      <td className="p-2.5 text-right font-black bg-amber-50/50 dark:bg-amber-950/20 text-amber-950 dark:text-amber-200">
                        {lc && lc.closingBags !== null ? lc.closingBags : '—'}
                      </td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        {lc && lc.fridgeBalanceBags !== null ? (
                          <span
                            className={`font-bold ${
                              lc.fridgeBalanceBags < -0.5
                                ? 'text-rose-600 dark:text-rose-400'
                                : lc.fridgeBalanceBags > 0.5
                                  ? 'text-sky-700 dark:text-sky-300'
                                  : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {lc.fridgeBalanceBags > 0
                              ? `+${lc.fridgeBalanceBags.toFixed(2)}b`
                              : `${lc.fridgeBalanceBags.toFixed(2)}b`}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        {!st.hasMeasuredSpan ? (
                          <span className="font-sans text-[10px] text-slate-400">
                            {t('food_cost.fridge_meter.unmeasured_store')}
                          </span>
                        ) : st.hasNegativeCountAnomaly ? (
                          <span className="font-sans text-[11px] font-bold text-purple-700">
                            ⚠️ {t('food_cost.fridge_meter.count_anomaly')}
                          </span>
                        ) : cumBags !== null ? (
                          <span
                            className={`font-black ${
                              cumBags <= -2
                                ? 'text-rose-600 dark:text-rose-400'
                                : cumBags > 1
                                  ? 'text-sky-700 dark:text-sky-300'
                                  : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {cumBags <= -2 ? '🔴 ' : cumBags > 1 ? '🔵 ' : '🟢 '}
                            {cumBags > 0 ? `+${cumBags.toFixed(2)}b` : `${cumBags.toFixed(2)}b`} (
                            {formatSignedUSD(cumUsd || 0, { showPlus: (cumUsd || 0) > 0 })})
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2.5 text-center font-sans">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          {t('food_cost.fridge_meter.view_ledger_btn')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
