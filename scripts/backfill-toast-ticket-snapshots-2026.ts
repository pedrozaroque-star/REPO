/**
 * @module scripts/backfill-toast-ticket-snapshots-2026
 * @description Recupera tickets operativos históricos de Toast por tienda y día comercial, sin datos personales.
 * @businessRules
 *   - Solo procesa días cerrados de 2026 y tiendas activas; no crea consumo, pedidos ni movimientos de inventario.
 *   - Omite órdenes, checks, selecciones y modificadores anulados.
 *   - Por defecto archiva localmente y comprime por tienda/día sin escribir tickets en la base operativa.
 *   - Solo --write-supabase habilita upsert idempotente (store_id, toast_order_guid) por página.
 * @dataFlow Toast ordersBulk + diningOptions → normalización mínima → archivo local gzip o Supabase → checkpoint local.
 * @notes Reintenta 429/5xx con backoff; el checkpoint no contiene PII. El modo Supabase reanuda por página y el archivo local por día.
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true })

const host = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key || !process.env.TOAST_CLIENT_ID || !process.env.TOAST_CLIENT_SECRET) {
  throw new Error('Faltan credenciales Toast o Supabase en .env.local')
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

type Store = { id: number; name: string; external_id: string }
type Progress = { nextPage: number; complete: boolean; tickets: number }
type Checkpoint = Record<string, Progress>
type JsonObject = Record<string, any>

const args = process.argv.slice(2)
function arg(name: string, fallback: string): string {
  return args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
}
const from = arg('from', '2026-01-01')
const to = arg('to', '2026-09-25')
const storeFilter = arg('store', '').toLowerCase()
const maxStoreDays = Number(arg('max-store-days', '0'))
const archiveLocal = !args.includes('--write-supabase')
const checkpointPath = path.resolve(process.cwd(), 'tmp', archiveLocal ? 'toast-ticket-archive-2026.json' : 'toast-ticket-backfill-2026.json')
const archiveRoot = path.resolve(process.cwd(), 'tmp', 'toast-ticket-archive-2026')
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function assertDate(value: string): void {
  if (!/^2026-\d{2}-\d{2}$/.test(value) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Fecha inválida de 2026: ${value}`)
  }
}

function dates(start: string, end: string): string[] {
  assertDate(start)
  assertDate(end)
  if (start > end) throw new Error('La fecha inicial es posterior a la final')
  const values: string[] = []
  for (let time = Date.parse(`${start}T12:00:00Z`); time <= Date.parse(`${end}T12:00:00Z`); time += 86_400_000) {
    values.push(new Date(time).toISOString().slice(0, 10))
  }
  return values
}

function readCheckpoint(): Checkpoint {
  if (!fs.existsSync(checkpointPath)) return {}
  return JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as Checkpoint
}

function writeCheckpoint(value: Checkpoint): void {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true })
  const temporary = `${checkpointPath}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2))
  fs.renameSync(temporary, checkpointPath)
}

let token = ''
async function login(): Promise<void> {
  const response = await fetch(`${host}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Toast login HTTP ${response.status}`)
  token = (await response.json()).token.accessToken
}

async function toastGet(endpoint: string, externalId: string): Promise<any> {
  for (let attempt = 1; attempt <= 7; attempt++) {
    try {
      const response = await fetch(`${host}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': externalId },
        signal: AbortSignal.timeout(60_000),
      })
      if (response.status === 401 && attempt < 7) {
        await login()
        continue
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 7) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : Math.min(1000 * 2 ** attempt, 30_000))
        continue
      }
      if (!response.ok) throw new Error(`Toast HTTP ${response.status}: ${endpoint}`)
      return response.json()
    } catch (error) {
      if (attempt === 7 || (error instanceof Error && error.message.startsWith('Toast HTTP '))) throw error
      await pause(Math.min(1000 * 2 ** attempt, 30_000))
    }
  }
  throw new Error(`No se pudo consultar Toast: ${endpoint}`)
}

function normalize(order: JsonObject, store: Store, businessDate: string, optionMap: Map<string, JsonObject>): JsonObject | null {
  if (order.voided || !order.guid) return null
  const diningOption = optionMap.get(order.diningOption?.guid)
  const diningOptionName = diningOption?.name || order.diningOption?.name || null
  const service = order.deliveryInfo?.deliveryService?.name || order.deliveryService?.name || order.deliveryService
  return {
    store_id: store.id,
    business_date: businessDate,
    toast_order_guid: order.guid,
    dining_option_name: diningOptionName,
    channel_metadata: {
      diningOption: { guid: order.diningOption?.guid || null, name: diningOptionName, behavior: diningOption?.behavior || null },
      source: order.source || null,
      deliveryService: typeof service === 'string' ? service : null,
    },
    selections: (order.checks || []).filter((check: JsonObject) => !check.voided).flatMap((check: JsonObject) =>
      (check.selections || []).filter((selection: JsonObject) => !selection.voided).map((selection: JsonObject) => ({
        guid: selection.item?.guid,
        name: selection.displayName,
        quantity: Number(selection.quantity ?? 1),
        modifiers: (selection.modifiers || []).filter((modifier: JsonObject) => !modifier.voided).map((modifier: JsonObject) => ({
          guid: modifier.item?.guid,
          name: modifier.displayName,
          quantity: Number(modifier.quantity ?? 1),
        })),
      }))),
    source_opened_at: order.openedDate || null,
    synced_at: new Date().toISOString(),
  }
}

async function upsertPage(rows: JsonObject[]): Promise<void> {
  if (!rows.length) return
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await db.from('toast_ticket_consumption_snapshots').upsert(rows, { onConflict: 'store_id,toast_order_guid' })
    if (!error) return
    if (attempt === 5) throw new Error(`Supabase upsert falló: ${error.message}`)
    await pause(Math.min(1000 * 2 ** attempt, 20_000))
  }
}

async function smokeTest(store: Store): Promise<void> {
  const guid = `codex-smoke-${randomUUID()}`
  try {
    const { error: insertError } = await db.from('toast_ticket_consumption_snapshots').insert({
      store_id: store.id,
      business_date: '2026-01-01',
      toast_order_guid: guid,
      dining_option_name: 'SMOKE TEST',
      channel_metadata: {},
      selections: [],
    })
    if (insertError) throw insertError
    const { data, error: readError } = await db.from('toast_ticket_consumption_snapshots')
      .select('toast_order_guid').eq('store_id', store.id).eq('toast_order_guid', guid).single()
    if (readError || data?.toast_order_guid !== guid) throw new Error(`No se pudo verificar inserción: ${readError?.message || guid}`)
    console.log(`Prueba real INSERT/SELECT correcta: ${guid}`)
  } finally {
    const { error: deleteError } = await db.from('toast_ticket_consumption_snapshots')
      .delete().eq('store_id', store.id).eq('toast_order_guid', guid)
    if (deleteError) throw deleteError
    const { count, error: verifyError } = await db.from('toast_ticket_consumption_snapshots')
      .select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('toast_order_guid', guid)
    if (verifyError || count !== 0) throw new Error(`No se pudo verificar limpieza: ${verifyError?.message || count}`)
    console.log('Prueba real DELETE/SELECT correcta; sin registro de prueba residual')
  }
}

async function main(): Promise<void> {
  const calendar = dates(from, to)
  if (!Number.isInteger(maxStoreDays) || maxStoreDays < 0) throw new Error('--max-store-days debe ser entero no negativo')
  const { data: stores, error } = await db.from('stores').select('id,name,external_id').eq('is_active', true).order('id')
  if (error) throw error
  const selected = (stores as Store[] || []).filter(store => store.external_id && (!storeFilter ||
    store.name.toLowerCase().includes(storeFilter) || store.external_id.toLowerCase() === storeFilter))
  if (!selected.length) throw new Error('No se encontraron tiendas activas con Toast external_id')
  if (args.includes('--smoke-test')) {
    await smokeTest(selected[0])
    return
  }
  const checkpoint = readCheckpoint()
  await login()
  let processed = 0
  let tickets = 0
  for (const businessDate of calendar) {
    for (const store of selected) {
      const progressKey = `${store.id}:${businessDate}`
      const saved = checkpoint[progressKey]
      if (saved?.complete) continue
      if (maxStoreDays && processed >= maxStoreDays) {
        console.log(`Límite alcanzado: ${processed} tienda-días; ${tickets} tickets en esta ejecución`)
        return
      }
      const options = await toastGet('/config/v2/diningOptions', store.external_id) as JsonObject[]
      if (!Array.isArray(options)) throw new Error(`diningOptions inválidas: ${store.name}`)
      const optionMap = new Map(options.map(option => [option.guid, option]))
      let page = archiveLocal ? 1 : saved?.nextPage || 1
      let dayTickets = archiveLocal ? 0 : saved?.tickets || 0
      const archiveRows: JsonObject[] = []
      while (true) {
        const orders = await toastGet(`/orders/v2/ordersBulk?businessDate=${businessDate.replaceAll('-', '')}&pageSize=100&page=${page}`, store.external_id) as JsonObject[]
        if (!Array.isArray(orders)) throw new Error(`ordersBulk inválido: ${store.name} ${businessDate} p${page}`)
        const rows = orders.map(order => normalize(order, store, businessDate, optionMap)).filter((row): row is JsonObject => row !== null)
        if (archiveLocal) archiveRows.push(...rows)
        else await upsertPage(rows)
        dayTickets += rows.length
        tickets += rows.length
        if (!archiveLocal) {
          checkpoint[progressKey] = { nextPage: page + 1, complete: false, tickets: dayTickets }
          writeCheckpoint(checkpoint)
        }
        if (orders.length < 100) break
        page++
        await pause(150)
      }
      if (archiveLocal) {
        const directory = path.join(archiveRoot, businessDate.slice(0, 7))
        fs.mkdirSync(directory, { recursive: true })
        const destination = path.join(directory, `${businessDate}-${store.id}.json.gz`)
        const temporary = `${destination}.tmp`
        fs.writeFileSync(temporary, gzipSync(JSON.stringify(archiveRows)))
        const verified = JSON.parse(gunzipSync(fs.readFileSync(temporary)).toString('utf8')) as JsonObject[]
        if (verified.length !== dayTickets || new Set(verified.map(row => row.toast_order_guid)).size !== dayTickets) {
          fs.unlinkSync(temporary)
          throw new Error(`Archivo no coincide: ${store.name} ${businessDate}, esperado=${dayTickets}, leído=${verified.length}`)
        }
        fs.renameSync(temporary, destination)
        checkpoint[progressKey] = { nextPage: page + 1, complete: true, tickets: dayTickets }
      } else {
        const { count, error: countError } = await db.from('toast_ticket_consumption_snapshots')
          .select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('business_date', businessDate)
        if (countError) throw countError
        if (count !== dayTickets) {
          checkpoint[progressKey].complete = false
          checkpoint[progressKey].nextPage = 1
          checkpoint[progressKey].tickets = 0
          writeCheckpoint(checkpoint)
          throw new Error(`Conteo no coincide: ${store.name} ${businessDate}, Toast=${dayTickets}, Supabase=${count}`)
        }
        checkpoint[progressKey].complete = true
      }
      writeCheckpoint(checkpoint)
      processed++
      console.log(`${businessDate} | ${store.name} | ${dayTickets} tickets ${archiveLocal ? 'archivados' : 'verificados'} | ${processed} tienda-días procesados`)
    }
  }
  console.log(`Recuperación completa para el intervalo: ${processed} tienda-días nuevos, ${tickets} tickets en esta ejecución`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
