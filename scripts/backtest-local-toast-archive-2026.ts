/**
 * @module scripts/backtest-local-toast-archive-2026
 * @description Valida el archivo histórico local de Toast y mide cobertura de reglas de empaque por ticket.
 * @businessRules Solo lee combinaciones tienda-día marcadas como completas; no escribe en Supabase ni mueve inventario.
 * @dataFlow Checkpoint local + archivos gzip → integridad de tickets → motor ticket-packaging → métricas de cobertura.
 * @notes La cobertura de empaque no equivale a cobertura de recetas; permite excluir tiendas y semanas solo para comparaciones históricas.
 */

import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { calculateTicketPackaging, type ToastTicketSelection } from '../lib/inventory/ticket-packaging'

type Progress = { complete?: boolean; tickets?: number }
type Snapshot = {
  toast_order_guid: string
  dining_option_name?: string | null
  channel_metadata?: { diningOption?: { behavior?: string | null }; source?: string | null; deliveryService?: string | null }
  selections?: ToastTicketSelection[]
}

const checkpointPath = path.resolve('tmp/toast-ticket-archive-2026.json')
const root = path.resolve('tmp/toast-ticket-archive-2026')
const from = process.argv.find(arg => arg.startsWith('--from='))?.slice('--from='.length) || '2026-01-01'
const to = process.argv.find(arg => arg.startsWith('--to='))?.slice('--to='.length) || '2026-09-25'
const excludedStoreIds = new Set((process.argv.find(arg => arg.startsWith('--exclude-store-ids='))?.slice('--exclude-store-ids='.length) || '').split(',').filter(Boolean))
const excludedWeekStarts = new Set((process.argv.find(arg => arg.startsWith('--exclude-week-starts='))?.slice('--exclude-week-starts='.length) || '').split(',').filter(Boolean))
if (!/^2026-\d{2}-\d{2}$/.test(from) || !/^2026-\d{2}-\d{2}$/.test(to) || from > to) {
  throw new Error('Rango inválido: usa --from=YYYY-MM-DD --to=YYYY-MM-DD dentro de 2026')
}
if ([...excludedStoreIds].some(id => !/^\d+$/.test(id)) || [...excludedWeekStarts].some(day => !/^2026-\d{2}-\d{2}$/.test(day))) {
  throw new Error('Exclusiones inválidas: usa IDs numéricos y semanas YYYY-MM-DD')
}
const weekStart = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as Record<string, Progress>
const completed = Object.entries(checkpoint).filter(([key, progress]) => {
  const [store, day] = key.split(':')
  return progress.complete && day >= from && day <= to && !excludedStoreIds.has(store) && !excludedWeekStarts.has(weekStart(day))
})
const counters = { storeDays: 0, tickets: 0, selections: 0, recognizedSelections: 0, unknownChannelTickets: 0, warningTickets: 0 }
const problems: string[] = []
const channels = new Map<string, number>()
const unknownNames = new Map<string, number>()
const warningCounts = new Map<string, number>()
const recognitionCache = new Map<string, boolean>()

for (const [key, progress] of completed) {
  const [store, day] = key.split(':')
  const file = path.join(root, day.slice(0, 7), `${day}-${store}.json.gz`)
  if (!fs.existsSync(file)) { problems.push(`Falta archivo: ${key}`); continue }
  let snapshots: Snapshot[]
  try { snapshots = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8')) as Snapshot[] }
  catch (error) { problems.push(`Gzip/JSON inválido: ${key}: ${String(error)}`); continue }
  const guids = new Set(snapshots.map(ticket => ticket.toast_order_guid))
  if (snapshots.length !== progress.tickets || guids.size !== snapshots.length) {
    problems.push(`Conteo/GUID no coincide: ${key}, checkpoint=${progress.tickets}, leído=${snapshots.length}, GUID=${guids.size}`)
    continue
  }
  counters.storeDays++
  counters.tickets += snapshots.length
  for (const ticket of snapshots) {
    const context = {
      diningOptionName: ticket.dining_option_name,
      diningOptionBehavior: ticket.channel_metadata?.diningOption?.behavior,
      source: ticket.channel_metadata?.source,
      deliveryService: ticket.channel_metadata?.deliveryService,
    }
    const result = calculateTicketPackaging({ ...context, selections: ticket.selections || [] })
    counters.recognizedSelections += result.recognizedSelections
    if (result.packagingChannel === 'unknown') counters.unknownChannelTickets++
    channels.set(result.packagingChannel, (channels.get(result.packagingChannel) || 0) + 1)
    if (result.warnings.length) counters.warningTickets++
    for (const warning of result.warnings) warningCounts.set(warning, (warningCounts.get(warning) || 0) + 1)
    for (const selection of ticket.selections || []) {
      const quantity = Math.max(0, Math.floor(Number(selection.quantity) || 0))
      if (quantity === 0 || /\b(separator|separador)\b/i.test(selection.name || '')) continue
      counters.selections++
      const name = selection.name || '(sin nombre)'
      let recognized = recognitionCache.get(name)
      if (recognized === undefined) {
        recognized = calculateTicketPackaging({ diningOptionName: 'Dine In', selections: [{ name, quantity: 1 }] }).recognizedSelections > 0
        recognitionCache.set(name, recognized)
      }
      if (!recognized) unknownNames.set(name, (unknownNames.get(name) || 0) + quantity)
    }
  }
}

const top = (map: Map<string, number>, limit: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }))
console.log(JSON.stringify({
  period: { from, to, excludedStoreIds: [...excludedStoreIds], excludedWeekStarts: [...excludedWeekStarts] },
  checkpointCompleteStoreDays: completed.length,
  ...counters,
  packagingRecognitionRate: counters.selections ? Number((100 * counters.recognizedSelections / counters.selections).toFixed(2)) : null,
  channels: Object.fromEntries(channels),
  topUnrecognizedNames: top(unknownNames, 30),
  topWarnings: top(warningCounts, 15),
  problems: problems.slice(0, 20),
  problemCount: problems.length,
}, null, 2))
if (problems.length) process.exitCode = 1
