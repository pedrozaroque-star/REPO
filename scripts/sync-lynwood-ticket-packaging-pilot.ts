/**
 * @module scripts/sync-lynwood-ticket-packaging-pilot
 * @description Lanza el piloto de sincronización de tickets cerrados de Lynwood mediante el endpoint protegido existente.
 * @businessRules Solo crea/actualiza snapshots operativos; no escribe inventory_usage_log, sobrantes, kardex ni pedidos.
 * @dataFlow .env.local → API local sync-ticket-consumption → Toast → toast_ticket_consumption_snapshots.
 * @notes El endpoint aplica upsert idempotente por tienda y GUID de ticket.
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true })

const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const businessDate = '2026-09-22'

async function run() {
  const headers: Record<string, string> = {}
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`
  const response = await fetch(`http://localhost:3000/api/inventory/sync-ticket-consumption?storeId=${storeId}&businessDate=${businessDate}`, { headers })
  const body = await response.text()
  if (!response.ok) throw new Error(`Snapshot sync failed (${response.status}): ${body}`)
  console.log(body)
}

run().catch(error => { console.error(error.message); process.exitCode = 1 })
