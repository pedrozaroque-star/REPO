/**
 * @module lib/inventory/par-ideal-engine
 * @description Motor de servidor para el recálculo dinámico de `inventory_par_ideal` (PAR Ideal de referencia).
 *              Combina el historial de PAR y sobrantes reales de las últimas N semanas con el pronóstico
 *              inteligente de ventas y clima (`generateSmartForecast` de `lib/intelligence.ts`), sin tocar
 *              ni sobrescribir jamás las bases activas (`inventory_weekly_bases` / `PAR Actual`).
 *
 * @businessRules
 *   - Usa siempre la fecha comercial en `America/Los_Angeles` (corte 6:00 AM PT) vía `getBusinessDate()`.
 *   - Excluye postres de proveedor externo `TRACK_ONLY` (`Flan`, `Cheesecake`) para no contaminar Bodega.
 *   - Duplica el peso (`2x`) de las 2 semanas más recientes en bebidas estacionales (`Horchata`, `Jamaica`,
 *     `Tamarindo`, `Piña`, `Champurrado`) para reaccionar rápido a cambios de clima.
 *   - Escala cada día (`mon`..`sat`, donde `sat` cubre Sábado + Domingo juntos) según la razón entre el
 *     pronóstico inteligente de ventas (`generateSmartForecast`) y el promedio real de las últimas 4 semanas,
 *     acotada a `[0.88, 1.15]` para evitar saltos bruscos.
 *   - Respeta estrictamente las reglas de múltiplo de empaque (`ceiling_60`, `ceiling_30`, `ceiling_4`).
 *
 * @dataFlow
 *   `stores` + `inventory_weekly_bases` + `inventory_counts` + `sales_daily_cache` + `generateSmartForecast`
 *   -> ajuste ponderado por sobrante y tendencia -> `UPSERT` en `inventory_par_ideal`.
 *
 * @notes
 *   - [2026-11-10] Extraído a librería pura de servidor (`lib/inventory`) para mantener `actions.ts`
 *     con autenticación estricta (`assertUserStoreAccess`) sin exponer funciones internas como Server Actions.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import {
  addDays,
  getBusinessDate,
  getMonday,
  EXTERNAL_TRACK_ONLY_ITEM_IDS,
} from '@/app/inventory/orders/utils'
import { isExternalTrackOnlyDessert } from './automation-pilot'
import { isSeasonalBeverageMassBalanceItem } from './historical-mass-balance'
import { generateSmartForecast } from '@/lib/intelligence'

function applyOrderRounding(value: number, rule: string): number {
  if (rule === 'ceiling_60') return Math.ceil(value / 60) * 60
  if (rule === 'ceiling_30') return Math.ceil(value / 30) * 30
  if (rule === 'ceiling_4') return Math.ceil(value / 4) * 4
  return Math.round(value)
}

export async function recalculateStoreParIdeal(
  storeId: string | number,
  weeksBack: number = 4,
  targetMondayOverride?: string
): Promise<{ updatedCount: number; demandMultipliers: Record<string, number> }> {
  const supabase = await getSupabaseAdminClient()
  const currentMonday = targetMondayOverride || getMonday(getBusinessDate())
  const startDate = addDays(currentMonday, -(weeksBack * 7))
  const endSunday = addDays(currentMonday, 6)
  const recentCutoffMonday = addDays(currentMonday, -14)

  const [{ data: store }, { data: allBases }, { data: items }, { data: leftovers }] = await Promise.all([
    supabase.from('stores').select('id, name, external_id').eq('id', storeId).maybeSingle(),
    supabase
      .from('inventory_weekly_bases')
      .select('*')
      .eq('store_id', storeId)
      .gte('week_start_date', startDate)
      .lte('week_start_date', currentMonday),
    supabase
      .from('inventory_items')
      .select('id, name, excel_reference, order_rounding_rule'),
    supabase
      .from('inventory_counts')
      .select('inventory_item_id, count_date, quantity_on_hand')
      .eq('store_id', storeId.toString())
      .gte('count_date', startDate)
      .lte('count_date', endSunday),
  ])

  const demandMultipliers: Record<string, number> = {
    mon: 1,
    tue: 1,
    wed: 1,
    thu: 1,
    fri: 1,
    sat: 1,
  }

  if (!allBases || allBases.length === 0) {
    return { updatedCount: 0, demandMultipliers }
  }

  if (store?.external_id) {
    try {
      const { data: salesRows } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales')
        .eq('store_id', store.external_id)
        .gte('business_date', startDate)
        .lt('business_date', currentMonday)

      const weekdayBuckets: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
      for (const row of salesRows || []) {
        const net = Number(row.net_sales)
        if (!Number.isFinite(net) || net <= 300) continue
        const dow = new Date(`${row.business_date}T12:00:00Z`).getUTCDay()
        weekdayBuckets[dow]?.push(net)
      }

      const avgOf = (arr: number[]) =>
        arr.length > 0 ? arr.reduce((sum, v) => sum + v, 0) / arr.length : 0

      const targetWeekDates = [0, 1, 2, 3, 4, 5, 6].map(offset => addDays(currentMonday, offset))
      const forecastResults = await Promise.allSettled(
        targetWeekDates.map(dStr => generateSmartForecast(store.external_id, dStr))
      )
      const forecastByOffset = forecastResults.map(res =>
        res.status === 'fulfilled' && Number(res.value?.total_sales) > 0
          ? Number(res.value.total_sales)
          : 0
      )

      const clampTrend = (ratio: number) =>
        Number.isFinite(ratio) && ratio > 0
          ? Math.min(1.15, Math.max(0.88, ratio))
          : 1

      const monFriMeta: Array<{ key: string; offset: number; dow: number }> = [
        { key: 'mon', offset: 0, dow: 1 },
        { key: 'tue', offset: 1, dow: 2 },
        { key: 'wed', offset: 2, dow: 3 },
        { key: 'thu', offset: 3, dow: 4 },
        { key: 'fri', offset: 4, dow: 5 },
      ]
      for (const m of monFriMeta) {
        const histAvg = avgOf(weekdayBuckets[m.dow])
        const fSales = forecastByOffset[m.offset]
        if (histAvg > 300 && fSales > 300) {
          demandMultipliers[m.key] = clampTrend(fSales / histAvg)
        }
      }

      const histWeekendAvg = avgOf(weekdayBuckets[6]) + avgOf(weekdayBuckets[0])
      const forecastWeekend = (forecastByOffset[5] || 0) + (forecastByOffset[6] || 0)
      if (histWeekendAvg > 600 && forecastWeekend > 600) {
        demandMultipliers.sat = clampTrend(forecastWeekend / histWeekendAvg)
      }
    } catch (forecastErr: any) {
      console.warn(
        `[recalculateStoreParIdeal] Pronóstico inteligente omitido para tienda ${storeId}:`,
        forecastErr?.message || forecastErr
      )
    }
  }

  const roundingMap = new Map<string, string>()
  const itemMetaMap = new Map<string, { id: string; name?: string | null; excel_reference?: string | null }>()
  items?.forEach((i: any) => {
    roundingMap.set(i.id, i.order_rounding_rule || 'none')
    itemMetaMap.set(i.id, { id: i.id, name: i.name, excel_reference: i.excel_reference })
  })

  const leftoverMap = new Map<string, number>()
  leftovers?.forEach((l: any) => {
    leftoverMap.set(`${l.inventory_item_id}_${l.count_date}`, Number(l.quantity_on_hand) || 0)
  })

  const daysOfWeek = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const itemAdjustedBases: Record<
    string,
    { weekCount: number; weightSum: number; sums: Record<string, number> }
  > = {}

  for (const b of allBases) {
    const itemId = String(b.inventory_item_id || '')
    if (!itemId) continue
    const meta = itemMetaMap.get(itemId)
    if (
      EXTERNAL_TRACK_ONLY_ITEM_IDS.has(itemId) ||
      isExternalTrackOnlyDessert({
        inventory_item_id: itemId,
        item_name: meta?.excel_reference || meta?.name || null,
      })
    ) {
      continue
    }

    const isSeasonal = meta
      ? isSeasonalBeverageMassBalanceItem({
          id: meta.id,
          name: meta.excel_reference || meta.name || '',
        })
      : false
    const weekWeight = isSeasonal && String(b.week_start_date) >= recentCutoffMonday ? 2 : 1

    if (!itemAdjustedBases[itemId]) {
      itemAdjustedBases[itemId] = {
        weekCount: 0,
        weightSum: 0,
        sums: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
      }
    }
    itemAdjustedBases[itemId].weekCount++
    itemAdjustedBases[itemId].weightSum += weekWeight

    daysOfWeek.forEach((day, index) => {
      const parVal = Number(b[`${day}_par`]) || 0
      let adjPar = parVal

      if (day === 'sat') {
        const sundayDateStr = addDays(b.week_start_date, 6)
        const sundayLeftoverVal = leftoverMap.get(`${itemId}_${sundayDateStr}`)

        if (sundayLeftoverVal !== undefined && parVal >= 8) {
          const leftoverPct = (sundayLeftoverVal / parVal) * 100
          if (leftoverPct >= 40) {
            adjPar = leftoverPct >= 60 ? parVal - Math.round(parVal * 0.15) : parVal - Math.round(parVal * 0.10)
          } else if (leftoverPct < 15) {
            adjPar = parVal >= 40 ? parVal + Math.round(parVal * 0.10) : parVal + Math.round(parVal * 0.20)
          }
        }
      } else {
        const dateStr = addDays(b.week_start_date, index)
        const leftoverVal = leftoverMap.get(`${itemId}_${dateStr}`)

        if (leftoverVal !== undefined && parVal >= 8) {
          const leftoverPct = (leftoverVal / parVal) * 100
          if (leftoverPct >= 60) {
            adjPar = leftoverPct >= 80 ? parVal - Math.round(parVal * 0.15) : parVal - Math.round(parVal * 0.10)
          } else if (leftoverPct < 20) {
            adjPar = parVal >= 40 ? parVal + Math.round(parVal * 0.10) : parVal + Math.round(parVal * 0.20)
          }
        }
      }

      itemAdjustedBases[itemId].sums[day] += adjPar * weekWeight
    })
  }

  const trackOnlyIdsArray = Array.from(EXTERNAL_TRACK_ONLY_ITEM_IDS)
  if (trackOnlyIdsArray.length > 0) {
    await supabase
      .from('inventory_par_ideal')
      .delete()
      .eq('store_id', storeId)
      .in('inventory_item_id', trackOnlyIdsArray)
  }

  const nowIso = new Date().toISOString()
  const parRecords = Object.entries(itemAdjustedBases).map(([itemId, data]) => {
    const rule = roundingMap.get(itemId) || 'none'
    const roundPar = (val: number, dayKey: string) => {
      if (data.weightSum <= 0) return 0
      const rawAvg = (val / data.weightSum) * (demandMultipliers[dayKey] || 1)
      if (rawAvg <= 0) return 0
      return applyOrderRounding(rawAvg, rule)
    }
    return {
      store_id: storeId,
      inventory_item_id: itemId,
      mon_par: roundPar(data.sums.mon, 'mon'),
      tue_par: roundPar(data.sums.tue, 'tue'),
      wed_par: roundPar(data.sums.wed, 'wed'),
      thu_par: roundPar(data.sums.thu, 'thu'),
      fri_par: roundPar(data.sums.fri, 'fri'),
      sat_par: roundPar(data.sums.sat, 'sat'),
      sun_par: 0,
      calculated_from_weeks: data.weekCount,
      updated_at: nowIso,
    }
  })

  if (parRecords.length > 0) {
    const { error: upsertErr } = await supabase
      .from('inventory_par_ideal')
      .upsert(parRecords, { onConflict: 'store_id, inventory_item_id' })
    if (upsertErr) {
      throw new Error(`No se pudo actualizar PAR Ideal: ${upsertErr.message}`)
    }
  }

  return { updatedCount: parRecords.length, demandMultipliers }
}
