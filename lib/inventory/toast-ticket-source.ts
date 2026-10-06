/**
 * @module lib/inventory/toast-ticket-source
 * @description Recupera tickets reales de Toast para el consumo de Orden Diaria sin datos personales.
 * @businessRules Dos lecturas consecutivas deben coincidir en GUID, canal, selecciones y
 *                modificadores; órdenes/checks/selecciones anulados no generan venta.
 * @dataFlow Toast ordersBulk + diningOptions -> RawToastTicket[] y huella SHA-256 estable.
 * @notes Solo lectura. Una fuente estable no garantiza que todas las recetas estén mapeadas ni
 *        que reembolsos/anulaciones posteriores al servicio no requieran ajuste físico.
 */

import { createHash } from 'node:crypto'
import type { RawToastTicket } from './daily-order-consumption-engine'

type ToastRecord = Record<string, any>

export interface StableToastTicketSource {
  tickets: RawToastTicket[]
  totalOrdersFetched: number
  activeOrders: number
  selectionCount: number
  digest: string
  verification: 'two_matching_toast_reads'
}

const host = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function jsonWithRetry(url: string, init: RequestInit): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        await pause(Math.min(1000 * 2 ** attempt, 10_000))
        continue
      }
      if (!response.ok) throw new Error(`Toast HTTP ${response.status} (${url.split('?')[0]})`)
      return response.json()
    } catch (error) {
      if (attempt === 4 || error instanceof Error && error.message.startsWith('Toast HTTP ')) throw error
      await pause(Math.min(1000 * 2 ** attempt, 10_000))
    }
  }
  throw new Error('Toast no respondió')
}

function normalizeQuantity(value: unknown, context: string): number {
  const quantity = value === null || value === undefined ? 1 : Number(value)
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Cantidad inválida en ${context}`)
  return quantity
}

function normalizeOrder(order: ToastRecord, date: string, optionMap: Map<string, ToastRecord>): RawToastTicket {
  const diningOption = optionMap.get(order.diningOption?.guid)
  const diningOptionName = diningOption?.name || order.diningOption?.name || null
  const service = order.deliveryInfo?.deliveryService?.name || order.deliveryService?.name || order.deliveryService
  return {
    orderGuid: order.guid,
    businessDate: date,
    diningOptionName,
    diningOptionBehavior: diningOption?.behavior || null,
    source: typeof order.source === 'string' ? order.source : null,
    deliveryService: typeof service === 'string' ? service : null,
    selections: (order.checks || []).filter((check: ToastRecord) => !check.voided).flatMap((check: ToastRecord) =>
      (check.selections || []).filter((selection: ToastRecord) => !selection.voided).map((selection: ToastRecord) => ({
        guid: selection.item?.guid || null,
        name: selection.displayName || '',
        quantity: normalizeQuantity(selection.quantity, `selección ${order.guid}`),
        price: Number.isFinite(Number(selection.price)) ? Number(selection.price) : null,
        modifiers: (selection.modifiers || []).filter((modifier: ToastRecord) => !modifier.voided).map((modifier: ToastRecord) => ({
          guid: modifier.item?.guid || null,
          name: modifier.displayName || '',
          quantity: normalizeQuantity(modifier.quantity, `modificador ${order.guid}`),
        })),
      })))
  }
}

function fingerprint(tickets: RawToastTicket[]): string {
  const ordered = tickets.map(ticket => ({
    ...ticket,
    selections: [...(ticket.selections || [])].map(selection => ({
      ...selection,
      modifiers: [...(selection.modifiers || [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).sort((a, b) => String(a.orderGuid).localeCompare(String(b.orderGuid)))
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

/** Huella de los campos compartidos por Toast vivo y snapshots históricos. */
export function comparableTicketDigest(tickets: RawToastTicket[]): string {
  const normalized = tickets.map(ticket => {
    const metadata = ticket.channel_metadata
    return {
      guid: ticket.orderGuid ?? ticket.toast_order_guid ?? '',
      diningOption: ticket.diningOptionName ?? ticket.dining_option_name ?? metadata?.diningOption?.name ?? null,
      behavior: ticket.diningOptionBehavior ?? metadata?.diningOption?.behavior ?? null,
      source: ticket.source ?? metadata?.source ?? null,
      deliveryService: ticket.deliveryService ?? metadata?.deliveryService ?? null,
      selections: (ticket.selections || []).map(selection => ({
        guid: selection.guid ?? null,
        name: selection.name ?? '',
        quantity: Number(selection.quantity ?? 1),
        modifiers: (selection.modifiers || []).map(modifier => ({
          guid: modifier.guid ?? null,
          name: modifier.name ?? '',
          quantity: Number(modifier.quantity ?? 1),
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    }
  }).sort((a, b) => a.guid.localeCompare(b.guid))
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export async function fetchStableToastTicketSource(externalStoreId: string, businessDate: string): Promise<StableToastTicketSource> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || new Date(`${businessDate}T12:00:00Z`).toISOString().slice(0, 10) !== businessDate) {
    throw new Error(`Fecha de negocio inválida: ${businessDate}`)
  }
  if (!externalStoreId) throw new Error('Toast externalStoreId vacío')
  const clientId = process.env.TOAST_CLIENT_ID
  const clientSecret = process.env.TOAST_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Faltan credenciales Toast')
  const login = await jsonWithRetry(`${host}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
  })
  const token = login?.token?.accessToken
  if (!token) throw new Error('Toast no entregó token de acceso')
  const headers = { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': externalStoreId }
  const options = await jsonWithRetry(`${host}/config/v2/diningOptions`, { headers }) as ToastRecord[]
  if (!Array.isArray(options)) throw new Error('Toast diningOptions inválidas')
  const optionMap = new Map(options.map(option => [String(option.guid), option]))

  const readPass = async () => {
    const orders: ToastRecord[] = []
    for (let page = 1; page <= 100; page++) {
      const batch = await jsonWithRetry(`${host}/orders/v2/ordersBulk?businessDate=${businessDate.replaceAll('-', '')}&pageSize=100&page=${page}`, { headers }) as ToastRecord[]
      if (!Array.isArray(batch)) throw new Error(`Toast ordersBulk página ${page} inválida`)
      orders.push(...batch)
      if (batch.length < 100) break
      if (page === 100) throw new Error('Toast ordersBulk excedió 100 páginas')
    }
    const seen = new Set<string>()
    const tickets: RawToastTicket[] = []
    for (const order of orders) {
      if (order.voided || !order.guid) continue
      if (seen.has(order.guid)) throw new Error(`Toast GUID duplicado: ${order.guid}`)
      seen.add(order.guid)
      tickets.push(normalizeOrder(order, businessDate, optionMap))
    }
    if (!tickets.length) throw new Error(`Toast no devolvió tickets activos para ${businessDate}`)
    return { orders: orders.length, tickets, digest: fingerprint(tickets) }
  }

  const first = await readPass()
  const second = await readPass()
  if (first.orders !== second.orders || first.digest !== second.digest) {
    throw new Error(`Toast cambió durante la lectura de ${businessDate}; consumo no certificado`)
  }
  return {
    tickets: second.tickets,
    totalOrdersFetched: second.orders,
    activeOrders: second.tickets.length,
    selectionCount: second.tickets.reduce((sum, ticket) => sum + (ticket.selections || []).length, 0),
    digest: second.digest,
    verification: 'two_matching_toast_reads',
  }
}
