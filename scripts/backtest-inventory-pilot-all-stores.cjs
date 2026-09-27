/**
 * @module scripts/backtest-inventory-pilot-all-stores
 * @description Contrasta sobrantes y pedidos reales de las sucursales con la estimación histórica del piloto.
 * @businessRules Acepta un rango cerrado de 2026; excluye 2026-09-22 cuando cae en el rango y no convierte un pedido en recepción comprobada.
 * @dataFlow Supabase stores/counts/orders/usage/items -> cruces por tienda, fecha y artículo -> métricas agregadas.
 * @notes Solo lectura. Las predicciones con consumo real registrado se separan de las que requerirían fallback 20%.
 *   Descarta capturas extremas con la misma regla de inventory/automation-pilot.
 */
require('dotenv').config({ path: '.env.local', quiet: true })
const { createClient } = require('@supabase/supabase-js')

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const START = argument('from', '2026-08-01')
const END = argument('to', '2026-09-25')
const EXCLUDED = '2026-09-22'
if (!/^2026-\d{2}-\d{2}$/.test(START) || !/^2026-\d{2}-\d{2}$/.test(END) || START > END) {
  throw new Error('Rango inválido: usa --from=YYYY-MM-DD --to=YYYY-MM-DD dentro de 2026')
}

async function all(makeQuery, pageSize = 500) {
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

function previousDate(day) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function round(value, rule) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (rule === 'ceiling_60') return Math.ceil(value / 60) * 60
  if (rule === 'ceiling_30') return Math.ceil(value / 30) * 30
  if (rule === 'ceiling_4') return Math.ceil(value / 4) * 4
  return Math.round(value)
}

const value = input => input === null || input === undefined ? null : Number(input)
const mapKey = (store, day, item) => `${store}|${day}|${item}`
const sorted = numbers => [...numbers].sort((a, b) => a - b)
const median = numbers => numbers.length ? sorted(numbers)[Math.floor(numbers.length / 2)] : null
const tightTolerance = /carne|asada|pastor|pollo|cabeza|lengua|chorizo|carnitas|buche|salsa|mixta|lima|rajas|queso|aguacate|tortilla|papelito|quesadilla/i
const pilotTolerance = (name, physical) => tightTolerance.test(name) ? 1 : Math.max(1, Number((Math.abs(physical) * 0.15).toFixed(2)))
const isImplausibleArrivalQuantity = (quantity, parValue, calculatedQuantity) => {
  if (!Number.isFinite(quantity) || quantity < 0) return true
  const par = Number.isFinite(parValue) ? Math.max(0, parValue) : 0
  const calculated = Number.isFinite(calculatedQuantity) ? Math.max(0, calculatedQuantity) : 0
  return quantity > Math.max(1000, par * 10, calculated * 10)
}

async function main() {
  const stores = await all(() => db.from('stores').select('id,name,external_id,is_active').eq('is_active', true).order('id'))
  const storeIds = stores.map(store => store.id)
  const counts = await all(() => db.from('inventory_counts')
    .select('store_id,inventory_item_id,count_date,quantity_on_hand,created_at')
    .in('store_id', storeIds).gte('count_date', previousDate(START)).lte('count_date', END)
    .order('created_at'))
  const orders = await all(() => db.from('inventory_orders')
    .select('id,store_id,order_date,status,order_type')
    .in('store_id', storeIds).eq('order_type', 'daily')
    .gte('order_date', previousDate(START)).lte('order_date', END).order('id'))
  const orderIds = orders.map(order => order.id)
  const orderLines = []
  for (let index = 0; index < orderIds.length; index += 100) {
    const chunk = orderIds.slice(index, index + 100)
    if (!chunk.length) continue
    orderLines.push(...await all(() => db.from('inventory_order_lines')
      .select('order_id,inventory_item_id,final_qty,adjusted_qty,calculated_qty,par_value,leftover_value')
      .in('order_id', chunk).order('order_id')))
  }
  const usage = await all(() => db.from('inventory_usage_log')
    .select('store_id,business_date,inventory_item_id,theoretical_usage')
    .gte('business_date', START).lte('business_date', END).order('business_date'))
  const itemIds = [...new Set(orderLines.map(line => line.inventory_item_id))]
  const items = []
  for (let index = 0; index < itemIds.length; index += 100) {
    items.push(...await all(() => db.from('inventory_items')
      .select('id,name,excel_reference,order_rounding_rule').in('id', itemIds.slice(index, index + 100)).order('id')))
  }

  const countMap = new Map()
  for (const row of counts) countMap.set(mapKey(row.store_id, row.count_date, row.inventory_item_id), value(row.quantity_on_hand))
  const orderMap = new Map(orders.map(row => [row.id, row]))
  const orderByStoreDay = new Map()
  for (const row of orders) {
    if (!['sent', 'received'].includes(row.status)) continue
    const key = `${row.store_id}|${row.order_date}`
    const prior = orderByStoreDay.get(key)
    if (!prior || String(row.id) > String(prior.id)) orderByStoreDay.set(key, row)
  }
  const orderLineMap = new Map()
  for (const line of orderLines) orderLineMap.set(`${line.order_id}|${line.inventory_item_id}`, line)
  const usageMap = new Map()
  for (const row of usage) usageMap.set(mapKey(row.store_id, row.business_date, row.inventory_item_id), value(row.theoretical_usage))
  const itemMap = new Map(items.map(item => [item.id, item]))
  const reports = []
  const productStats = new Map()
  const anomalies = orderLines.flatMap(line => {
    const quantity = value(line.final_qty ?? line.adjusted_qty ?? line.calculated_qty)
    if (quantity === null || !isImplausibleArrivalQuantity(quantity, value(line.par_value), value(line.calculated_qty))) return []
    const order = orderMap.get(line.order_id)
    return [{ store: stores.find(store => store.id === order?.store_id)?.name || order?.store_id,
      day: order?.order_date, item: itemMap.get(line.inventory_item_id)?.name || line.inventory_item_id,
      recordedQty: quantity, par: value(line.par_value), calculatedQty: value(line.calculated_qty) }]
  })

  for (const store of stores) {
    const eligibleOrders = [...orderByStoreDay.values()]
      .filter(order => order.store_id === store.id && order.order_date >= START && order.order_date <= END && order.order_date !== EXCLUDED)
    const report = {
      store: store.name, storeId: store.id, orderDays: eligibleOrders.length,
      orderLines: 0, withCurrentCount: 0, withPreviousCount: 0, withUsage: 0,
      withUsageAndPreviousCount: 0, withPreviousSentOrder: 0,
      testable: 0, absErrors: [], exact: 0, within1: 0, withinPilotTolerance: 0,
      orderExact: 0, orderWithin1: 0, orderAbsErrors: [],
      officialFormulaTests: 0, officialFormulaExact: 0, officialFormulaWithin1: 0,
      replay: { usage: { n: 0, exact: 0, tolerance: 0 }, fallback: { n: 0, exact: 0, tolerance: 0 }, anomalousPriorOrders: 0 },
      fallbackPossible: 0, negativeImplicitUse: 0, countVsOrderLeftoverMismatch: 0,
      biggest: [], datesTested: new Set(), usageDates: new Set(),
    }
    for (const order of eligibleOrders) {
      const day = order.order_date
      const priorDay = previousDate(day)
      const previousOrder = orderByStoreDay.get(`${store.id}|${priorDay}`)
      for (const line of orderLines) {
        if (line.order_id !== order.id) continue
        report.orderLines++
        const item = itemMap.get(line.inventory_item_id)
        const physical = countMap.get(mapKey(store.id, day, line.inventory_item_id))
        const previous = countMap.get(mapKey(store.id, priorDay, line.inventory_item_id))
        const usageValue = usageMap.get(mapKey(store.id, day, line.inventory_item_id))
        if (physical !== undefined) report.withCurrentCount++
        if (previous !== undefined) report.withPreviousCount++
        if (usageValue !== undefined) { report.withUsage++; report.usageDates.add(day) }
        if (previous !== undefined && usageValue !== undefined) report.withUsageAndPreviousCount++
        if (previousOrder) report.withPreviousSentOrder++
        if (previous !== undefined && usageValue === undefined && physical !== undefined) report.fallbackPossible++
        const par = value(line.par_value)
        const actualOrder = value(line.final_qty ?? line.adjusted_qty ?? line.calculated_qty)
        if (physical !== undefined && par !== null && actualOrder !== null
            && !isImplausibleArrivalQuantity(actualOrder, par, value(line.calculated_qty))) {
          const physicalFormulaOrder = round(Math.max(0, par - physical), item?.order_rounding_rule)
          const physicalOrderError = Math.abs(physicalFormulaOrder - actualOrder)
          report.officialFormulaTests++
          if (physicalOrderError === 0) report.officialFormulaExact++
          if (physicalOrderError <= 1) report.officialFormulaWithin1++
        }
        if (physical === undefined || previous === undefined || !previousOrder) continue
        const previousLine = orderLineMap.get(`${previousOrder.id}|${line.inventory_item_id}`)
        const priorOrdered = previousLine ? value(previousLine.final_qty ?? previousLine.adjusted_qty ?? previousLine.calculated_qty) || 0 : 0
        if (isImplausibleArrivalQuantity(priorOrdered, value(previousLine?.par_value), value(previousLine?.calculated_qty))) {
          report.replay.anomalousPriorOrders++
          continue
        }
        const estimatedUsage = usageValue === undefined
          ? (par > 0 ? Math.max(1, par * 0.2) : 0)
          : usageValue
        const replayPredicted = Math.max(0, round(previous + priorOrdered - estimatedUsage, item?.order_rounding_rule))
        const replayError = Math.abs(replayPredicted - physical)
        const replayBucket = usageValue === undefined ? report.replay.fallback : report.replay.usage
        replayBucket.n++
        if (replayError === 0) replayBucket.exact++
        if (replayError <= pilotTolerance(item?.excel_reference || item?.name || '', physical)) replayBucket.tolerance++
        if (usageValue === undefined) continue
        const implied = previous + priorOrdered - physical
        if (implied < 0) report.negativeImplicitUse++
        const predicted = Math.max(0, round(previous + priorOrdered - usageValue, item?.order_rounding_rule))
        const error = Math.abs(predicted - physical)
        const predictedOrder = par === null ? null : round(Math.max(0, par - predicted), item?.order_rounding_rule)
        report.testable++
        report.datesTested.add(day)
        report.absErrors.push(error)
        if (error === 0) report.exact++
        if (error <= 1) report.within1++
        if (error <= pilotTolerance(item?.excel_reference || item?.name || '', physical)) report.withinPilotTolerance++
        if (predictedOrder !== null && actualOrder !== null) {
          const orderError = Math.abs(predictedOrder - actualOrder)
          report.orderAbsErrors.push(orderError)
          if (orderError === 0) report.orderExact++
          if (orderError <= 1) report.orderWithin1++
        }
        const productName = item?.excel_reference || item?.name || line.inventory_item_id
        const stat = productStats.get(productName) || { item: productName, n: 0, totalAbsError: 0, within1: 0, predictedAbove: 0, usageTotal: 0 }
        stat.n++
        stat.totalAbsError += error
        stat.usageTotal += usageValue
        if (error <= 1) stat.within1++
        if (predicted > physical) stat.predictedAbove++
        productStats.set(productName, stat)
        const lineLeftover = value(line.leftover_value)
        if (lineLeftover !== null && lineLeftover !== physical) report.countVsOrderLeftoverMismatch++
        report.biggest.push({ day, item: item?.excel_reference || item?.name || line.inventory_item_id, physical, predicted, absError: error, priorOrdered, usage: usageValue, impliedUsageIfReceived: implied })
      }
    }
    reports.push({
      ...report,
      meanAbsError: report.absErrors.length ? Number((report.absErrors.reduce((sum, n) => sum + n, 0) / report.absErrors.length).toFixed(2)) : null,
      medianAbsError: median(report.absErrors),
      meanOrderAbsError: report.orderAbsErrors.length ? Number((report.orderAbsErrors.reduce((sum, n) => sum + n, 0) / report.orderAbsErrors.length).toFixed(2)) : null,
      datesTested: [...report.datesTested].sort(),
      usageDates: [...report.usageDates].sort(),
      biggest: report.biggest.sort((a, b) => b.absError - a.absError).slice(0, 3),
      absErrors: undefined,
      orderAbsErrors: undefined,
    })
  }

  const totals = reports.reduce((acc, row) => {
    for (const key of ['orderDays', 'orderLines', 'withCurrentCount', 'withPreviousCount', 'withUsage', 'testable', 'exact', 'within1', 'withinPilotTolerance', 'orderExact', 'orderWithin1', 'fallbackPossible', 'officialFormulaTests', 'officialFormulaExact', 'officialFormulaWithin1']) {
      acc[key] = (acc[key] || 0) + row[key]
    }
    for (const kind of ['usage', 'fallback']) {
      acc.replay ||= { usage: { n: 0, exact: 0, tolerance: 0 }, fallback: { n: 0, exact: 0, tolerance: 0 }, anomalousPriorOrders: 0 }
      for (const key of ['n', 'exact', 'tolerance']) acc.replay[kind][key] += row.replay[kind][key]
    }
    acc.replay.anomalousPriorOrders += row.replay.anomalousPriorOrders
    return acc
  }, {})
  const output = {
    period: { start: START, end: END, excluded: EXCLUDED }, sourceRows: {
    stores: stores.length, counts: counts.length, orders: orders.length, orderLines: orderLines.length, usage: usage.length, items: items.length,
    },
    totals,
    anomalies,
    stores: reports.map(row => ({
      store: row.store, orderDays: row.orderDays, orderLines: row.orderLines,
      testable: row.testable, exact: row.exact, within1: row.within1, withinPilotTolerance: row.withinPilotTolerance,
      officialFormulaTests: row.officialFormulaTests, officialFormulaExact: row.officialFormulaExact,
      fallbackPossible: row.fallbackPossible, meanAbsError: row.meanAbsError, replay: row.replay,
      latestUsageDate: row.usageDates.at(-1) || null,
    })),
    highestErrorProducts: [...productStats.values()]
      .map(stat => ({ ...stat, meanAbsError: Number((stat.totalAbsError / stat.n).toFixed(2)) }))
      .sort((a, b) => b.totalAbsError - a.totalAbsError).slice(0, 12),
    examples: ['Lynwood', 'Slauson', 'LA Central'].map(name => {
      const row = reports.find(report => report.store === name)
      return { store: name, biggest: row?.biggest || [] }
    }),
  }
  console.log(JSON.stringify(process.argv.includes('--summary')
    ? { period: output.period, totals: output.totals, anomalies: output.anomalies,
      lynwood: output.stores.find(store => store.store === 'Lynwood') }
    : output, null, 2))
}

main().catch(error => { console.error(`Backtest failed: ${error.message}`); process.exitCode = 1 })
