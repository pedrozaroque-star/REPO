/**
 * @module scripts/backtest-january-par-minus-count
 * @description Reconstruye pedidos candidatos de enero 2026 desde PAR semanal y sobrantes históricos.
 * @businessRules Pedido candidato D = redondear(max(0, PAR de D+1 − sobrante físico D)); no equivale a envío ni recepción.
 * @dataFlow Supabase inventory_weekly_bases + inventory_counts + inventory_items → cálculo de solo lectura por tienda, fecha e insumo.
 * @notes Cuenta ceros explícitos como captura válida; no imputa valores ausentes ni escribe registros.
 */

require('dotenv').config({ path: '.env.local', quiet: true })
const { createClient } = require('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function all(makeQuery, size = 500) {
  const rows = []
  for (let offset = 0; ; offset += size) {
    const { data, error } = await makeQuery().range(offset, offset + size - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < size) return rows
  }
}
function addDay(day) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
function monday(day) {
  const date = new Date(`${day}T12:00:00Z`)
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}
function round(value, rule) {
  if (value <= 0) return 0
  if (rule === 'ceiling_60') return Math.ceil(value / 60) * 60
  if (rule === 'ceiling_30') return Math.ceil(value / 30) * 30
  if (rule === 'ceiling_4') return Math.ceil(value / 4) * 4
  return Math.round(value)
}
const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const key = (store, day, item) => `${store}|${day}|${item}`

async function main() {
  const [stores, items, bases, counts] = await Promise.all([
    all(() => db.from('stores').select('id,name,is_active').eq('is_active', true).order('id')),
    all(() => db.from('inventory_items').select('id,name,excel_reference,order_rounding_rule').order('id')),
    all(() => db.from('inventory_weekly_bases').select('id,store_id,inventory_item_id,week_start_date,mon_par,tue_par,wed_par,thu_par,fri_par,sat_par,sun_par').gte('week_start_date', '2025-12-29').lte('week_start_date', '2026-01-26').order('id')),
    all(() => db.from('inventory_counts').select('id,store_id,inventory_item_id,count_date,quantity_on_hand').gte('count_date', '2026-01-01').lte('count_date', '2026-01-31').order('id')),
  ])
  const storeNames = new Map(stores.map(row => [String(row.id), row.name]))
  const itemMap = new Map(items.map(row => [String(row.id), row]))
  const baseMap = new Map()
  for (const base of bases) baseMap.set(key(base.store_id, base.week_start_date, base.inventory_item_id), base)
  const countMap = new Map()
  for (const count of counts) countMap.set(key(count.store_id, count.count_date, count.inventory_item_id), count)
  const summary = { period: '2026-01-01/2026-01-31', stores: stores.length, source: { bases: bases.length, counts: counts.length, uniqueCounts: countMap.size, items: items.length }, testable: 0, positive: 0, zero: 0, missingNextPar: 0, invalidCount: 0, examples: [], byStore: {} }
  for (const count of countMap.values()) {
    const store = storeNames.get(String(count.store_id))
    if (!store) continue
    const bucket = summary.byStore[store] ||= { counts: 0, testable: 0, missingNextPar: 0, positive: 0 }
    bucket.counts++
    const physical = Number(count.quantity_on_hand)
    if (!Number.isFinite(physical) || physical < 0) { summary.invalidCount++; continue }
    const tomorrow = addDay(count.count_date)
    const base = baseMap.get(key(count.store_id, monday(tomorrow), count.inventory_item_id))
    const field = `${days[new Date(`${tomorrow}T12:00:00Z`).getUTCDay()]}_par`
    const par = base ? Number(base[field]) : NaN
    if (!Number.isFinite(par) || par < 0) { summary.missingNextPar++; bucket.missingNextPar++; continue }
    const item = itemMap.get(String(count.inventory_item_id))
    const candidate = round(Math.max(0, par - physical), item?.order_rounding_rule)
    summary.testable++; bucket.testable++
    if (candidate > 0) { summary.positive++; bucket.positive++ } else summary.zero++
    if (store === 'Lynwood' && item?.excel_reference === 'Carne Asada' && ['2026-01-05', '2026-01-06', '2026-01-07'].includes(count.count_date)) {
      summary.examples.push({ store, day: count.count_date, item: item.excel_reference, physical, nextPar: par, candidate })
    }
  }
  console.log(JSON.stringify(summary, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
