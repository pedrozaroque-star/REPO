/**
 * @module app/api/web-preview/[[...slug]]/route
 * @description Servidor de archivos estáticos y puente de previsualización en vivo para el nuevo diseño web de Tacos Gavilan.
 * Permite renderizar y probar en tiempo real el sitio web estático desarrollado localmente en
 * file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html dentro de un iframe o en pestaña independiente,
 * evitando las restricciones de seguridad del navegador para esquemas file:///.
 * 
 * @businessRules
 * - **Fuente Oficial en Desarrollo**: Lee en tiempo real directamente de C:\Users\pedro\Desktop\tacosgavilan-web
 *   sin requerir re-compilaciones ni copias manuales.
 * - **Fallback de Producción**: Si el directorio local no existe, busca en public/tacosgavilan-web.
 * - **Seguridad y Aislamiento**: Bloquea ataques de Directory Traversal (../) validando que la ruta resuelta
 *   inicie estrictamente con el directorio raíz base autorizado.
 * - **Lanzador Local Nativo**: El endpoint POST /api/web-preview/launch o GET con ?action=launch permite
 *   abrir file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html directamente en el navegador del sistema operativo
 *   sin restricciones de sandbox web.
 * - **Cero Caché en Desarrollo**: Encabezados Cache-Control 'no-cache, no-store, must-revalidate' para reflejar
 *   cualquier cambio de código al instante.
 * 
 * @dataFlow
 * - Cliente (Iframe o Nueva Pestaña) -> GET /api/web-preview/[...slug] -> Node fs.readFile -> Response (Stream / Buffer con Content-Type).
 * - Cliente (Lanzador) -> POST /api/web-preview/launch -> child_process.exec -> Windows shell (cmd /c start ...).
 * 
 * @notes
 * - La extensión [[...slug]] de Next.js App Router captura tanto la raíz (/api/web-preview) como cualquier
 *   recurso anidado (/api/web-preview/css/style.css, /api/web-preview/img/hero-bg.webp, etc.).
 */

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import dns from 'dns'
import { exec } from 'child_process'
import { syncTacosGavilanWeb } from '@/scripts/sync-web'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const LOCAL_WEB_DIR = 'C:\\Users\\pedro\\Desktop\\tacosgavilan-web'
const FALLBACK_WEB_DIR = path.join(process.cwd(), 'public', 'tacosgavilan-web')

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
}

const STORE_ID_TO_NAME: Record<number, string> = {
    1: 'Rialto',
    3: 'West Covina',
    4: 'Azusa',
    5: 'LA Broadway',
    6: 'LA Central',
    7: 'Slauson',
    8: 'Hollywood',
    9: 'Santa Ana',
    10: 'La Puente',
    11: 'Huntington Park',
    12: 'Norwalk',
    13: 'Bell',
    14: 'Lynwood',
    15: 'South Gate',
    16: 'Downey',
}

interface StoreCatalogEntry {
    id: number
    uuid: string
    name: string
    crossStreets: string
    phone: string
    toastUrl: string
}

const STORES_CATALOG: StoreCatalogEntry[] = [
    { id: 6, uuid: '8685e942-3f07-403a-afb6-faec697cd2cb', name: 'LA Central', crossStreets: 'Central/Washington', phone: '(213) 742-6677', toastUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260847' },
    { id: 14, uuid: '80a1ec95-bc73-402e-8884-e5abbe9343e6', name: 'Lynwood', crossStreets: 'Imperial/Long Beach', phone: '(424) 785-5535', toastUrl: 'https://order.online/store/tacos-gavilan-lynwood-727877' },
    { id: 5, uuid: '475bc112-187d-4b9c-884d-1f6a041698ce', name: 'LA Broadway', crossStreets: 'Vernon/Broadway', phone: '(323) 233-2302', toastUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260769' },
    { id: 12, uuid: '42ed15a6-106b-466a-9076-1e8f72451f6b', name: 'Norwalk', crossStreets: 'Rosecrans/Studebaker', phone: '(562) 651-0045', toastUrl: 'https://order.online/store/tacos-gavilan-norwalk-1327857' },
    { id: 7, uuid: '9625621e-1b5e-48d7-87ae-7094fab5a4fd', name: 'Slauson', crossStreets: 'Slauson/Broadway', phone: '(323) 615-0084', toastUrl: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119' },
    { id: 1, uuid: 'acf15327-54c8-4da4-8d0d-3ac0544dc422', name: 'Rialto', crossStreets: 'Baseline/Riverside', phone: '(909) 562-0430', toastUrl: 'https://order.online/store/tacos-gavilan-rialto-841931' },
    { id: 3, uuid: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02', name: 'West Covina', crossStreets: '10 FWY/Azusa', phone: '(626) 917-2662', toastUrl: 'https://order.online/store/tacos-gavilan-west-covina-725035' },
    { id: 15, uuid: '95866cfc-eeb8-4af9-9586-f78931e1ea04', name: 'South Gate', crossStreets: 'Firestone/Garfield', phone: '(562) 806-1200', toastUrl: 'https://order.online/store/tacos-gavilan-south-gate-846517' },
    { id: 16, uuid: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a', name: 'Downey', crossStreets: 'Florence/Paramount', phone: '(562) 927-7486', toastUrl: 'https://order.online/store/tacos-gavilan-downey-302620' },
    { id: 8, uuid: '5fbb58f5-283c-4ea4-9415-04100ee6978b', name: 'Hollywood', crossStreets: 'Sunset/La Brea', phone: '(323) 963-7993', toastUrl: 'https://order.online/store/tacos-gavilan-los-angeles-551916' },
    { id: 9, uuid: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', name: 'Santa Ana', crossStreets: '17th/Grand', phone: '(714) 480-0713', toastUrl: 'https://order.online/store/tacos-gavilan-santa-ana-724574' },
    { id: 11, uuid: '47256ade-2cd4-4073-9632-84567ad9e2c8', name: 'Huntington Park', crossStreets: 'Florence/Santa Fe', phone: '(323) 581-7309', toastUrl: 'https://order.online/store/tacos-gavilan-huntington-park-260849' },
    { id: 10, uuid: '3a803939-eb13-4def-a1a4-462df8e90623', name: 'La Puente', crossStreets: '605 FWY/Valley', phone: '(626) 336-3000', toastUrl: 'https://order.online/store/tacos-gavilan-la-puente-963464' },
    { id: 4, uuid: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', name: 'Azusa', crossStreets: 'Azusa/Arrow', phone: '(626) 969-1011', toastUrl: 'https://order.online/store/tacos-gavilan-azusa-718169' },
    { id: 13, uuid: 'a83901db-2431-4283-834e-9502a2ba4b3b', name: 'Bell', crossStreets: 'Florence/Atlantic', phone: '(323) 771-1722', toastUrl: 'https://order.online/store/tacos-gavilan-bell-260912' },
]

export interface StorefrontOrderRecord {
    guid: string
    storeId: number
    storeName: string
    channel: 'order.online'
    fulfillmentType: 'pickup' | 'delivery'
    diningOptionName?: string
    orderCode: string
    customerMasked: string
    openedDate: string
    openedMs: number
    businessDate: string
    netSales: number
}

const memoryStorefrontCache = new Map<string, { syncedAtMs: number; orders: StorefrontOrderRecord[] }>()
const memoryDiningOptionsCache = new Map<string, Record<string, { name: string; behavior: string | null }>>()
const inFlightStorefrontSync = new Set<string>()

async function getStoreDiningOptionsMap(
    token: string,
    storeUuid: string
): Promise<Record<string, { name: string; behavior: string | null }>> {
    const cached = memoryDiningOptionsCache.get(storeUuid)
    if (cached && Object.keys(cached).length > 0) return cached
    try {
        const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeUuid
            },
            cache: 'no-store'
        })
        if (!res.ok) return {}
        const data = await res.json()
        const map: Record<string, { name: string; behavior: string | null }> = {}
        if (Array.isArray(data)) {
            for (const opt of data) {
                if (opt?.guid && opt?.name) {
                    map[opt.guid] = {
                        name: String(opt.name),
                        behavior: opt.behavior ? String(opt.behavior) : null
                    }
                }
            }
        }
        if (Object.keys(map).length > 0) {
            memoryDiningOptionsCache.set(storeUuid, map)
        }
        return map
    } catch {
        return {}
    }
}

function maskGuestName(rawName: string): string {
    const clean = String(rawName || '')
        .replace(/^SF\s+[a-f0-9]{6,10}\s*/i, '')
        .replace(/^pickup-\s*/i, '')
        .trim()
    if (!clean) return 'C•••'
    const parts = clean.split(/\s+/).filter(Boolean)
    const first = (parts[0] || 'C').charAt(0).toUpperCase()
    if (parts.length === 1) return `${first}•••`
    const last = parts[parts.length - 1].charAt(0).toUpperCase()
    return `${first}••• ${last}.`
}

async function fetchStorefrontOrdersForDay(businessDate: string): Promise<StorefrontOrderRecord[]> {
    const token = await getAuthToken()
    if (!token) return []
    const formattedDate = businessDate.replace(/-/g, '')
    const fields = [
        'guid', 'openedDate', 'voided', 'deleted', 'source', 'diningOption', 'deliveryInfo',
        'checks.voided', 'checks.tabName', 'checks.customer', 'checks.amount',
        'checks.taxAmount', 'checks.appliedDiscounts', 'checks.payments.refundAmount',
        'checks.payments.voided', 'checks.selections.price', 'checks.selections.preDiscountPrice',
        'checks.selections.tax', 'checks.selections.taxInclusion', 'checks.selections.voided',
        'checks.selections.deferred', 'checks.selections.toastGiftCard', 'checks.selections.displayName',
        'checks.selections.refundDetails'
    ].join(',')

    const perStoreArrays = await Promise.all(STORES_CATALOG.map(async (st) => {
        const diningMap = await getStoreDiningOptionsMap(token, st.uuid)
        const found: StorefrontOrderRecord[] = []
        let page = 1
        while (page <= 15) {
            const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${formattedDate}&pageSize=100&page=${page}&fields=${encodeURIComponent(fields)}`
            try {
                const res = await fetch(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Toast-Restaurant-External-ID': st.uuid
                    },
                    cache: 'no-store'
                })
                if (!res.ok) break
                const orders = await res.json()
                if (!Array.isArray(orders) || orders.length === 0) break

                for (const o of orders) {
                    if (o.voided || o.deleted) continue
                    const chk = o.checks?.[0]
                    if (!chk || chk.voided) continue
                    const tab = String(chk.tabName || '').trim()
                    const email = String(chk.customer?.email || '').toLowerCase()

                    // Strictly order.online (DoorDash Storefront SF) orders only
                    const isStorefront = /^SF\s+[a-f0-9]{6,10}\b/i.test(tab) || email.endsWith('@guest.doordash.com')
                    if (!isStorefront) continue

                    // Protocolo Toast API: Traducir diningOption.guid -> Nombre/Behavior con getStoreDiningOptionsMap
                    const dOpt = o.diningOption?.guid ? diningMap[o.diningOption.guid] : undefined
                    const dName = String(dOpt?.name || '').toLowerCase()
                    const dBehavior = String(dOpt?.behavior || '').toUpperCase()
                    const isDelivery =
                        dBehavior === 'DELIVERY' ||
                        dName.includes('delivery') ||
                        Boolean(o.deliveryInfo && (o.deliveryInfo.address1 || o.deliveryInfo.deliveryState))
                    const fulfillmentType: 'pickup' | 'delivery' = isDelivery ? 'delivery' : 'pickup'

                    // Protocolo Toast API: Sum(Item.Price) - Sum(Item.Discounts) - Sum(Item.Refunds) - Sum(UnlinkedRefunds)
                    let orderNet = 0
                    for (const c of (o.checks || [])) {
                        if (c.voided) continue
                        let itemNetSum = 0
                        let itemRefunds = 0
                        for (const sel of (c.selections || [])) {
                            if (sel.voided) continue
                            const isGC = sel.toastGiftCard || String(sel.displayName || '').toLowerCase().includes('gift card')
                            if (sel.deferred && !isGC) continue
                            if (isGC) continue
                            let p = Number(sel.price || 0)
                            if (sel.taxInclusion === 'INCLUDED') {
                                p -= Number(sel.tax || 0)
                            }
                            if (sel.refundDetails?.refundAmount) {
                                itemRefunds += Number(sel.refundDetails.refundAmount)
                            }
                            itemNetSum += p
                        }
                        const checkDisc = Array.isArray(c.appliedDiscounts)
                            ? c.appliedDiscounts.reduce((s: number, d: any) => s + Number(d.amount || 0), 0)
                            : 0
                        let cNet = itemNetSum - checkDisc - itemRefunds
                        let payRefunds = 0
                        for (const p of (c.payments || [])) {
                            if (!p.voided && p.refundAmount) payRefunds += Number(p.refundAmount)
                        }
                        if (payRefunds > itemRefunds + 0.01) {
                            cNet -= (payRefunds - itemRefunds)
                        }
                        orderNet += Math.max(0, cNet)
                    }

                    const sfMatch = tab.match(/^SF\s+([a-f0-9]{6,10})\b/i)
                    const orderCode = sfMatch
                        ? `SF ${sfMatch[1].toUpperCase()}`
                        : `SF ${String(o.guid || '').slice(0, 6).toUpperCase()}`
                    const rawGuest = [chk.customer?.firstName, chk.customer?.lastName].filter(Boolean).join(' ') || tab
                    const openedDate = o.openedDate || new Date().toISOString()

                    found.push({
                        guid: o.guid,
                        storeId: st.id,
                        storeName: st.name,
                        channel: 'order.online',
                        fulfillmentType,
                        diningOptionName: dOpt?.name || (fulfillmentType === 'delivery' ? 'DoorDash - Delivery' : 'DoorDash - Takeout'),
                        orderCode,
                        customerMasked: maskGuestName(rawGuest),
                        openedDate,
                        openedMs: new Date(openedDate).getTime(),
                        businessDate,
                        netSales: Math.round(orderNet * 100) / 100
                    })
                }
                if (orders.length < 100) break
                page++
            } catch {
                break
            }
        }
        return found
    }))

    return perStoreArrays.flat().sort((a, b) => a.openedMs - b.openedMs)
}

function getGavilanBusinessDate(now = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hour12: false
        }).formatToParts(now)
        const map: Record<string, string> = {}
        for (const p of parts) {
            if (p.type !== 'literal') map[p.type] = p.value
        }
        const year = parseInt(map.year, 10)
        const month = parseInt(map.month, 10)
        const day = parseInt(map.day, 10)
        const hour = parseInt(map.hour, 10) % 24
        const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
        if (hour < 6) {
            dt.setUTCDate(dt.getUTCDate() - 1)
        }
        return dt.toISOString().slice(0, 10)
    } catch {
        return now.toISOString().slice(0, 10)
    }
}

function shiftDateStr(dateStr: string, deltaDays: number): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    dt.setUTCDate(dt.getUTCDate() + deltaDays)
    return dt.toISOString().slice(0, 10)
}

function resolveBaseDir(): string | null {
    if (fs.existsSync(LOCAL_WEB_DIR)) {
        return LOCAL_WEB_DIR
    }
    if (fs.existsSync(FALLBACK_WEB_DIR)) {
        return FALLBACK_WEB_DIR
    }
    return null
}

export async function GET(
    request: Request,
    context: { params: Promise<{ slug?: string[] }> }
) {
    const { slug } = await context.params
    const url = new URL(request.url)
    const action = url.searchParams.get('action')

    // Acción ejecutiva para consultar analíticas de visitas web, clics de orden y cruce con órdenes order.online (Opción 2)
    if (action === 'analytics' || (slug?.length === 1 && slug[0] === 'analytics')) {
        try {
            const range = url.searchParams.get('range') || '7d'
            const todayBiz = getGavilanBusinessDate()
            let startDate = todayBiz
            let endDate = todayBiz

            if (range === 'yesterday') {
                startDate = shiftDateStr(todayBiz, -1)
                endDate = startDate
            } else if (range === '7d') {
                startDate = shiftDateStr(todayBiz, -6)
                endDate = todayBiz
            } else if (range === '30d') {
                startDate = shiftDateStr(todayBiz, -29)
                endDate = todayBiz
            }

            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co'
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
            const headers: Record<string, string> = {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }

            const [logsRes, sfCacheRes, feedbackRes] = await Promise.all([
                fetch(`${supabaseUrl}/rest/v1/activity_logs?select=*&entity_type=eq.tacosgavilan_web&order=created_at.desc&limit=5000`, { headers, cache: 'no-store' }),
                fetch(`${supabaseUrl}/rest/v1/activity_logs?select=id,new_values,created_at&entity_type=eq.tacosgavilan_storefront_cache&order=created_at.desc&limit=60`, { headers, cache: 'no-store' }),
                fetch(`${supabaseUrl}/rest/v1/customer_feedback?select=id,store_id,customer_name,customer_email,customer_phone,comments,complaint_type,source,created_at,submission_date&source=in.(website_contact,website_newsletter,website)&order=created_at.desc&limit=100`, { headers, cache: 'no-store' })
            ])

            const rawLogs = logsRes.ok ? await logsRes.json() : []
            const rawSfCache = sfCacheRes.ok ? await sfCacheRes.json() : []
            const rawFeedback = feedbackRes.ok ? await feedbackRes.json() : []

            // Map cached Storefront orders by business_date
            const sfOrdersByDate = new Map<string, { id?: number; syncedAtMs: number; orders: StorefrontOrderRecord[]; needsUpgrade?: boolean }>()
            for (const cRow of (Array.isArray(rawSfCache) ? rawSfCache : [])) {
                const nv = cRow.new_values || {}
                const bDate = nv.business_date
                if (bDate && !sfOrdersByDate.has(bDate) && Array.isArray(nv.orders)) {
                    const syncedAtMs = nv.synced_at ? new Date(nv.synced_at).getTime() : new Date(cRow.created_at).getTime()
                    const needsUpgrade = nv.orders.some(
                        (o: any) => !o?.fulfillmentType || o?.channel !== 'order.online' || !/^SF\s+/i.test(String(o?.orderCode || ''))
                    )
                    const cleanOrders = nv.orders
                        .filter((o: any) => o?.channel === 'order.online' && /^SF\s+/i.test(String(o?.orderCode || '')))
                        .map((o: any) => ({
                            ...o,
                            fulfillmentType: (o.fulfillmentType === 'delivery' ? 'delivery' : 'pickup') as 'pickup' | 'delivery'
                        }))
                    sfOrdersByDate.set(bDate, { id: cRow.id, syncedAtMs, orders: cleanOrders, needsUpgrade })
                }
            }

            // Merge in-memory cache if newer than DB cache
            for (const [bDate, memEntry] of memoryStorefrontCache.entries()) {
                const dbEntry = sfOrdersByDate.get(bDate)
                if (!dbEntry || memEntry.syncedAtMs > dbEntry.syncedAtMs) {
                    sfOrdersByDate.set(bDate, { id: dbEntry?.id, syncedAtMs: memEntry.syncedAtMs, orders: memEntry.orders, needsUpgrade: false })
                }
            }

            const forceSync = url.searchParams.get('force') === '1'
            const syncStorefrontDate = async (bDate: string) => {
                if (inFlightStorefrontSync.has(bDate)) return
                inFlightStorefrontSync.add(bDate)
                try {
                    const freshOrders = await fetchStorefrontOrdersForDay(bDate)
                    const nowMs = Date.now()
                    memoryStorefrontCache.set(bDate, { syncedAtMs: nowMs, orders: freshOrders })
                    const prevId = sfOrdersByDate.get(bDate)?.id
                    sfOrdersByDate.set(bDate, { syncedAtMs: nowMs, orders: freshOrders, needsUpgrade: false })

                    if (prevId) {
                        await fetch(`${supabaseUrl}/rest/v1/activity_logs?id=eq.${prevId}`, {
                            method: 'DELETE',
                            headers
                        }).catch(() => {})
                    }
                    await fetch(`${supabaseUrl}/rest/v1/activity_logs`, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'daily_sf_orders',
                            entity_type: 'tacosgavilan_storefront_cache',
                            entity_id: null,
                            new_values: {
                                business_date: bDate,
                                synced_at: new Date(nowMs).toISOString(),
                                orders: freshOrders
                            }
                        })
                    }).catch(() => {})
                } catch {
                    // Fallback to existing cache if Toast API fails transiently
                } finally {
                    inFlightStorefrontSync.delete(bDate)
                }
            }

            // Refresh Today's Storefront (order.online) orders if older than 180 seconds or needing schema upgrade
            const blockingDates: string[] = []
            const backgroundDates: string[] = []

            if (todayBiz >= startDate && todayBiz <= endDate) {
                const existingToday = sfOrdersByDate.get(todayBiz)
                const latestSyncMs = existingToday?.syncedAtMs || 0
                if (!existingToday || forceSync || existingToday.needsUpgrade) {
                    blockingDates.push(todayBiz)
                } else if (Date.now() - latestSyncMs > 180_000) {
                    backgroundDates.push(todayBiz)
                }
            }

            const yesterdayBiz = shiftDateStr(todayBiz, -1)
            if (yesterdayBiz >= startDate && yesterdayBiz <= endDate) {
                const existingYesterday = sfOrdersByDate.get(yesterdayBiz)
                if (!existingYesterday || existingYesterday.needsUpgrade) {
                    if (range === 'yesterday') {
                        blockingDates.push(yesterdayBiz)
                    } else {
                        backgroundDates.push(yesterdayBiz)
                    }
                }
            }

            for (const bDate of blockingDates) {
                await syncStorefrontDate(bDate)
            }
            for (const bDate of backgroundDates) {
                void syncStorefrontDate(bDate)
            }

            // Collect strictly order.online (SF) orders in [startDate, endDate]
            const allStorefrontOrders: (StorefrontOrderRecord & { matched?: boolean })[] = []
            for (const [bDate, entry] of sfOrdersByDate.entries()) {
                if (bDate >= startDate && bDate <= endDate) {
                    for (const ord of entry.orders) {
                        if (ord.channel === 'order.online' && /^SF\s+/i.test(ord.orderCode)) {
                            allStorefrontOrders.push({
                                ...ord,
                                fulfillmentType: ord.fulfillmentType === 'delivery' ? 'delivery' : 'pickup',
                                matched: false
                            })
                        }
                    }
                }
            }
            allStorefrontOrders.sort((a, b) => a.openedMs - b.openedMs)

            // Filter website events by business_date in [startDate, endDate]
            const filteredLogs = (Array.isArray(rawLogs) ? rawLogs : []).filter((row: any) => {
                const nv = row.new_values || {}
                const bDate = nv.business_date || (row.created_at ? getGavilanBusinessDate(new Date(row.created_at)) : '')
                return bDate >= startDate && bDate <= endDate
            })

            let totalPageViews = 0
            const sessionSet = new Set<string>()
            let totalOrderClicks = 0
            let totalPhoneClicks = 0
            let totalDirectionsClicks = 0
            let generalSelectorClicks = 0

            const deviceBreakdown = { mobile: 0, desktop: 0, tablet: 0 }
            const langBreakdown = { es: 0, en: 0 }
            const pageMap: Record<string, number> = {}
            const refMap: Record<string, number> = {}
            const buttonSourceMap: Record<string, number> = {}

            // Initialize per-store map
            const storeStatsMap: Record<number, {
                id: number
                name: string
                crossStreets: string
                phone: string
                toastUrl: string
                webOrderClicks: number
                webPhoneClicks: number
                webDirectionsClicks: number
                webStoreViews: number
                matchedWebOrdersCount: number
                matchedWebOrdersSales: number
                pickupOrdersCount: number
                pickupOrdersSales: number
                deliveryOrdersCount: number
                deliveryOrdersSales: number
                storefrontOrdersCount: number
                storefrontOrdersSales: number
                toastDirectSales: number
            }> = {}

            for (const st of STORES_CATALOG) {
                storeStatsMap[st.id] = {
                    id: st.id,
                    name: st.name,
                    crossStreets: st.crossStreets,
                    phone: st.phone,
                    toastUrl: st.toastUrl,
                    webOrderClicks: 0,
                    webPhoneClicks: 0,
                    webDirectionsClicks: 0,
                    webStoreViews: 0,
                    matchedWebOrdersCount: 0,
                    matchedWebOrdersSales: 0,
                    pickupOrdersCount: 0,
                    pickupOrdersSales: 0,
                    deliveryOrdersCount: 0,
                    deliveryOrdersSales: 0,
                    storefrontOrdersCount: 0,
                    storefrontOrdersSales: 0,
                    toastDirectSales: 0,
                }
            }

            // Aggregate total Storefront (order.online) orders per store (Pickup vs Delivery)
            for (const ord of allStorefrontOrders) {
                const stStat = storeStatsMap[ord.storeId]
                if (stStat) {
                    stStat.storefrontOrdersCount++
                    stStat.storefrontOrdersSales += ord.netSales
                    stStat.toastDirectSales += ord.netSales
                    if (ord.fulfillmentType === 'delivery') {
                        stStat.deliveryOrdersCount++
                        stStat.deliveryOrdersSales += ord.netSales
                    } else {
                        stStat.pickupOrdersCount++
                        stStat.pickupOrdersSales += ord.netSales
                    }
                }
            }

            // Process website events & build chronological click intents for Opción 2 Time-Window Matching
            const chronologicalLogs = [...filteredLogs].sort(
                (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
            const sessionStoreHint = new Map<string, number>()

            interface OrderClickIntent {
                sessionId: string
                storeId: number | null
                explicitStore: boolean
                buttonSource: string
                firstClickAt: string
                lastClickAt: string
                firstClickMs: number
                lastClickMs: number
                matchedOrder?: StorefrontOrderRecord
                matchType?: 'exact_store' | 'session_store' | 'general_selector'
            }
            const clickIntents: OrderClickIntent[] = []

            for (const row of chronologicalLogs) {
                const nv = row.new_values || {}
                const sid = nv.session_id || `row_${row.id}`
                sessionSet.add(sid)

                const dev = nv.device_type === 'mobile' ? 'mobile' : (nv.device_type === 'tablet' ? 'tablet' : 'desktop')
                const lg = nv.lang === 'es' ? 'es' : 'en'
                const stId = Number(row.entity_id || nv.store_id || 0) || null
                if (stId && storeStatsMap[stId]) {
                    sessionStoreHint.set(sid, stId)
                }

                if (row.action === 'website_page_view') {
                    totalPageViews++
                    deviceBreakdown[dev]++
                    langBreakdown[lg]++

                    const cleanPath = (nv.page_path || '/').replace(/\/index\.html$/, '/')
                    pageMap[cleanPath] = (pageMap[cleanPath] || 0) + 1

                    const ref = nv.referrer || 'direct'
                    if (ref !== 'internal') {
                        refMap[ref] = (refMap[ref] || 0) + 1
                    }

                    if (stId && storeStatsMap[stId]) {
                        storeStatsMap[stId].webStoreViews++
                    }
                } else if (row.action === 'website_order_click') {
                    const plat = nv.platform || 'toast'
                    const bSrc = nv.button_source || 'page'
                    buttonSourceMap[bSrc] = (buttonSourceMap[bSrc] || 0) + 1

                    if (plat === 'phone') {
                        totalPhoneClicks++
                        if (stId && storeStatsMap[stId]) {
                            storeStatsMap[stId].webPhoneClicks++
                        }
                    } else if (plat === 'directions') {
                        totalDirectionsClicks++
                        if (stId && storeStatsMap[stId]) {
                            storeStatsMap[stId].webDirectionsClicks++
                        }
                    } else {
                        totalOrderClicks++
                        if (stId && storeStatsMap[stId]) {
                            storeStatsMap[stId].webOrderClicks++
                        } else {
                            generalSelectorClicks++
                        }

                        // Build or update session click intent (15-min grouping window per session)
                        const clickMs = new Date(row.created_at).getTime()
                        const inferredStore = stId || sessionStoreHint.get(sid) || null
                        const existingIntent = [...clickIntents].reverse().find(
                            i => i.sessionId === sid && (clickMs - i.lastClickMs) <= 15 * 60 * 1000
                        )
                        if (existingIntent) {
                            existingIntent.lastClickAt = row.created_at
                            existingIntent.lastClickMs = clickMs
                            if (stId && !existingIntent.explicitStore) {
                                existingIntent.storeId = stId
                                existingIntent.explicitStore = true
                                existingIntent.buttonSource = bSrc
                            } else if (inferredStore && !existingIntent.storeId) {
                                existingIntent.storeId = inferredStore
                            }
                        } else {
                            clickIntents.push({
                                sessionId: sid,
                                storeId: inferredStore,
                                explicitStore: !!stId,
                                buttonSource: bSrc,
                                firstClickAt: row.created_at,
                                lastClickAt: row.created_at,
                                firstClickMs: clickMs,
                                lastClickMs: clickMs
                            })
                        }
                    }
                }
            }

            // Opción 2: Two-Pass Time-Window Order Matching (10 seconds to 30 minutes after click)
            const MIN_WINDOW_MS = 10 * 1000
            const MAX_WINDOW_MS = 30 * 60 * 1000

            // Pass 1: Store-specific click intents (exact store button or store viewed in session)
            for (const intent of clickIntents) {
                if (!intent.storeId) continue
                const candidate = allStorefrontOrders.find(
                    o =>
                        !o.matched &&
                        o.storeId === intent.storeId &&
                        o.openedMs >= intent.firstClickMs + MIN_WINDOW_MS &&
                        o.openedMs <= intent.lastClickMs + MAX_WINDOW_MS
                )
                if (candidate) {
                    candidate.matched = true
                    intent.matchedOrder = candidate
                    intent.matchType = intent.explicitStore ? 'exact_store' : 'session_store'
                }
            }

            // Pass 2: General selector click intents (order.online/business/-137616)
            for (const intent of clickIntents) {
                if (intent.matchedOrder || intent.storeId) continue
                const candidate = allStorefrontOrders.find(
                    o =>
                        !o.matched &&
                        o.openedMs >= intent.firstClickMs + MIN_WINDOW_MS &&
                        o.openedMs <= intent.lastClickMs + MAX_WINDOW_MS
                )
                if (candidate) {
                    candidate.matched = true
                    intent.matchedOrder = candidate
                    intent.matchType = 'general_selector'
                }
            }

            const matchedOrdersList: {
                orderGuid: string
                orderCode: string
                storeId: number
                storeName: string
                customerMasked: string
                fulfillmentType: 'pickup' | 'delivery'
                netSales: number
                openedDate: string
                clickAt: string
                buttonSource: string
                matchType: 'exact_store' | 'session_store' | 'general_selector'
                minutesAfterClick: number
            }[] = []

            for (const intent of clickIntents) {
                if (!intent.matchedOrder || !intent.matchType) continue
                const ord = intent.matchedOrder
                const refClickMs = ord.openedMs >= intent.lastClickMs ? intent.lastClickMs : intent.firstClickMs
                const refClickAt = ord.openedMs >= intent.lastClickMs ? intent.lastClickAt : intent.firstClickAt
                const minutesAfterClick = Math.max(0.2, Math.round(((ord.openedMs - refClickMs) / 60000) * 10) / 10)

                if (storeStatsMap[ord.storeId]) {
                    storeStatsMap[ord.storeId].matchedWebOrdersCount++
                    storeStatsMap[ord.storeId].matchedWebOrdersSales += ord.netSales
                }

                matchedOrdersList.push({
                    orderGuid: ord.guid,
                    orderCode: ord.orderCode,
                    storeId: ord.storeId,
                    storeName: ord.storeName,
                    customerMasked: ord.customerMasked,
                    fulfillmentType: ord.fulfillmentType === 'delivery' ? 'delivery' : 'pickup',
                    netSales: ord.netSales,
                    openedDate: ord.openedDate,
                    clickAt: refClickAt,
                    buttonSource: intent.buttonSource,
                    matchType: intent.matchType,
                    minutesAfterClick
                })
            }

            matchedOrdersList.sort((a, b) => new Date(b.openedDate).getTime() - new Date(a.openedDate).getTime())

            const storefrontOrdersList = [...allStorefrontOrders]
                .sort((a, b) => b.openedMs - a.openedMs)
                .map(ord => ({
                    orderGuid: ord.guid,
                    orderCode: ord.orderCode,
                    storeId: ord.storeId,
                    storeName: ord.storeName,
                    customerMasked: ord.customerMasked,
                    fulfillmentType: (ord.fulfillmentType === 'delivery' ? 'delivery' : 'pickup') as 'pickup' | 'delivery',
                    netSales: ord.netSales,
                    openedDate: ord.openedDate,
                    businessDate: ord.businessDate
                }))

            let totalMatchedWebOrdersCount = 0
            let totalMatchedWebOrdersSales = 0
            let totalPickupOrdersCount = 0
            let totalPickupOrdersSales = 0
            let totalDeliveryOrdersCount = 0
            let totalDeliveryOrdersSales = 0
            let totalStorefrontOrdersCount = 0
            let totalStorefrontOrdersSales = 0

            const storeBreakdown = Object.values(storeStatsMap).map(st => {
                st.matchedWebOrdersSales = Math.round(st.matchedWebOrdersSales * 100) / 100
                st.pickupOrdersSales = Math.round(st.pickupOrdersSales * 100) / 100
                st.deliveryOrdersSales = Math.round(st.deliveryOrdersSales * 100) / 100
                st.storefrontOrdersSales = Math.round(st.storefrontOrdersSales * 100) / 100
                st.toastDirectSales = st.storefrontOrdersSales

                totalMatchedWebOrdersCount += st.matchedWebOrdersCount
                totalMatchedWebOrdersSales += st.matchedWebOrdersSales
                totalPickupOrdersCount += st.pickupOrdersCount
                totalPickupOrdersSales += st.pickupOrdersSales
                totalDeliveryOrdersCount += st.deliveryOrdersCount
                totalDeliveryOrdersSales += st.deliveryOrdersSales
                totalStorefrontOrdersCount += st.storefrontOrdersCount
                totalStorefrontOrdersSales += st.storefrontOrdersSales
                return st
            }).sort(
                (a, b) =>
                    (b.storefrontOrdersSales - a.storefrontOrdersSales) ||
                    (b.webOrderClicks - a.webOrderClicks) ||
                    (b.webStoreViews - a.webStoreViews) ||
                    (a.id - b.id)
            )

            const topPages = Object.entries(pageMap)
                .map(([p, views]) => ({
                    path: p,
                    views,
                    pct: totalPageViews > 0 ? Math.round((views / totalPageViews) * 100) : 0
                }))
                .sort((a, b) => b.views - a.views)
                .slice(0, 10)

            const referrers = Object.entries(refMap)
                .map(([source, count]) => ({ source, count }))
                .sort((a, b) => b.count - a.count)

            const recentEvents = filteredLogs.slice(0, 25).map((r: any) => {
                const nv = r.new_values || {}
                return {
                    id: r.id,
                    action: r.action,
                    page_path: nv.page_path || '/',
                    store_id: r.entity_id || nv.store_id || null,
                    store_name: nv.store_name || (r.entity_id ? STORE_ID_TO_NAME[Number(r.entity_id)] : null),
                    platform: nv.platform || 'web',
                    button_source: nv.button_source || 'page',
                    device_type: nv.device_type || 'desktop',
                    lang: nv.lang || 'en',
                    referrer: nv.referrer || 'direct',
                    created_at: r.created_at
                }
            })

            const feedbackRows = (Array.isArray(rawFeedback) ? rawFeedback : []).map((r: any) => ({
                ...r,
                store_name: r.store_id ? (STORE_ID_TO_NAME[Number(r.store_id)] || `Sucursal #${r.store_id}`) : null
            }))

            return Response.json({
                ok: true,
                range,
                startDate,
                endDate,
                todayBusinessDate: todayBiz,
                summary: {
                    totalPageViews,
                    uniqueVisitors: sessionSet.size,
                    totalOrderClicks,
                    totalPhoneClicks,
                    totalDirectionsClicks,
                    generalSelectorClicks,
                    matchedWebOrdersCount: totalMatchedWebOrdersCount,
                    matchedWebOrdersSales: Math.round(totalMatchedWebOrdersSales * 100) / 100,
                    pickupOrdersCount: totalPickupOrdersCount,
                    pickupOrdersSales: Math.round(totalPickupOrdersSales * 100) / 100,
                    deliveryOrdersCount: totalDeliveryOrdersCount,
                    deliveryOrdersSales: Math.round(totalDeliveryOrdersSales * 100) / 100,
                    storefrontOrdersCount: totalStorefrontOrdersCount,
                    storefrontOrdersSales: Math.round(totalStorefrontOrdersSales * 100) / 100,
                    toastDirectSales: Math.round(totalStorefrontOrdersSales * 100) / 100,
                    totalFeedbackCount: feedbackRows.length
                },
                deviceBreakdown,
                langBreakdown,
                topPages,
                referrers,
                buttonSources: buttonSourceMap,
                storeBreakdown,
                storefrontOrders: storefrontOrdersList,
                matchedOrders: matchedOrdersList,
                recentEvents,
                feedback: feedbackRows
            })
        } catch (err: any) {
            return Response.json({ ok: false, error: err.message }, { status: 500 })
        }
    }

    // Acción para consultar estado de disponibilidad del archivo local y versión sincronizada
    if (action === 'status' || (slug?.length === 1 && slug[0] === 'status')) {
        const localIndexPath = path.join(LOCAL_WEB_DIR, 'index.html')
        const localIndexExists = fs.existsSync(localIndexPath)
        let localLastModified: string | null = null
        if (localIndexExists) {
            const stats = fs.statSync(localIndexPath)
            localLastModified = stats.mtime.toISOString()
        }

        const fallbackIndexPath = path.join(FALLBACK_WEB_DIR, 'index.html')
        const fallbackIndexExists = fs.existsSync(fallbackIndexPath)
        let fallbackLastModified: string | null = null
        if (fallbackIndexExists) {
            const stats = fs.statSync(fallbackIndexPath)
            fallbackLastModified = stats.mtime.toISOString()
        }

        return Response.json({
            ok: true,
            localDir: LOCAL_WEB_DIR,
            localExists: localIndexExists,
            localLastModified,
            fallbackExists: fallbackIndexExists,
            fallbackLastModified,
            activeSource: localIndexExists ? 'local' : (fallbackIndexExists ? 'cloud' : 'none'),
            fileUrl: 'file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html'
        })
    }

    // Acción para sincronizar desde desarrollo local hacia public/tacosgavilan-web
    if (action === 'sync' || (slug?.length === 1 && slug[0] === 'sync')) {
        const syncResult = syncTacosGavilanWeb()
        return Response.json(syncResult)
    }

    // Acción para abrir directamente en el navegador del sistema operativo
    if (action === 'launch' || (slug?.length === 1 && slug[0] === 'launch')) {
        return handleLaunch()
    }

    // Acción para consultar en vivo el estado DNS de tacosgavilan.com
    if (action === 'dns-status' || (slug?.length === 1 && slug[0] === 'dns-status')) {
        try {
            const domain = 'tacosgavilan.com'
            const [aRecords, cnameRecords, mxRecords, nsRecords] = await Promise.all([
                dns.promises.resolve4(domain).catch(() => [] as string[]),
                dns.promises.resolveCname(`www.${domain}`).catch(() => [] as string[]),
                dns.promises.resolveMx(domain).catch(() => [] as any[]),
                dns.promises.resolveNs(domain).catch(() => [] as string[])
            ])

            const isVercel = aRecords.includes('76.76.21.21')
            const isCnameVercel = cnameRecords.some(c => c.includes('vercel-dns.com'))
            const isWpEngine = aRecords.some(ip => ip.startsWith('141.193.')) || cnameRecords.some(c => c.includes('wpengine'))
            const isMxSafe = mxRecords.some(m => m.exchange && m.exchange.includes('google.com'))

            let hostingDetected = 'Desconocido / En transición'
            if (isVercel) hostingDetected = 'Vercel Edge Network (En Vivo)'
            else if (isWpEngine) hostingDetected = 'WP Engine (Servidor WordPress Anterior)'

            return Response.json({
                ok: true,
                domain,
                aRecords,
                cnameRecords,
                mxRecords,
                nsRecords,
                isVercel,
                isCnameVercel,
                isWpEngine,
                isMxSafe,
                hostingDetected,
                lastChecked: new Date().toISOString()
            })
        } catch (err: any) {
            return Response.json({ ok: false, error: err.message }, { status: 500 })
        }
    }

    // Acción para consultar feedback y leads de contacto recibidos exclusivamente desde la web oficial
    if (action === 'feedback' || (slug?.length === 1 && slug[0] === 'feedback')) {
        try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co'
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

            const queryUrl = `${supabaseUrl}/rest/v1/customer_feedback?select=*&source=in.(website_contact,website_newsletter,website)&order=created_at.desc&limit=50`
            const res = await fetch(queryUrl, {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                },
                cache: 'no-store'
            })

            if (!res.ok) {
                const text = await res.text()
                return Response.json({ ok: false, error: text }, { status: 500 })
            }

            const rawRows = await res.json()
            const rows = (Array.isArray(rawRows) ? rawRows : []).map((r: any) => ({
                ...r,
                store_name: r.store_id ? (STORE_ID_TO_NAME[Number(r.store_id)] || `Sucursal #${r.store_id}`) : null
            }))
            return Response.json({ ok: true, data: rows })
        } catch (err: any) {
            return Response.json({ ok: false, error: err.message }, { status: 500 })
        }
    }

    // Acción para obtener catálogo de medios y recursos de marca del respaldo
    if (action === 'brand-assets' || (slug?.length === 1 && slug[0] === 'brand-assets')) {
        const backupMediaDir = 'C:\\Users\\pedro\\Desktop\\tacosgavilan-oficial-backup\\media'
        const catalogPath = path.join(backupMediaDir, 'media-catalog.json')
        let catalog = []
        if (fs.existsSync(catalogPath)) {
            try {
                catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
            } catch {}
        }
        return Response.json({
            ok: true,
            totalItems: catalog.length,
            items: catalog.slice(0, 40)
        })
    }

    const baseDir = resolveBaseDir()
    if (!baseDir) {
        return new Response('Directory tacosgavilan-web not found', { status: 404 })
    }

    // Determinar la ruta relativa del archivo solicitado
    const slugParts = slug || []
    let relativePath = slugParts.join('/')

    if (!relativePath || relativePath === '') {
        relativePath = 'index.html'
    }

    const targetPath = path.resolve(baseDir, relativePath)

    // Seguridad: Prevenir Directory Traversal
    if (!targetPath.startsWith(path.resolve(baseDir))) {
        return new Response('Forbidden: Invalid path traversal', { status: 403 })
    }

    // Si es un directorio, buscar index.html dentro de él
    let finalPath = targetPath
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
        finalPath = path.join(finalPath, 'index.html')
    }

    if (!fs.existsSync(finalPath)) {
        return new Response(`File not found: ${relativePath}`, { status: 404 })
    }

    try {
        const ext = path.extname(finalPath).toLowerCase()
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream'

        if (ext === '.html' || ext === '.htm') {
            let html = await fs.promises.readFile(finalPath, 'utf8')
            const relDir = path.relative(baseDir, path.dirname(finalPath)).replace(/\\/g, '/')
            const baseHref = `/api/web-preview/${relDir ? `${relDir}/` : ''}`

            // If accessed without .html in the URL path, inject <base> so relative assets resolve properly
            if (!url.pathname.endsWith('.html') && !url.pathname.endsWith('.htm')) {
                html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${baseHref}">`)
            }

            // Rewrite root-relative asset and page paths (href="/..." or src="/...") to /api/web-preview/...
            html = html.replace(/\b(href|src)=["']\/(?!\/|api\/web-preview\/)([^"']*)["']/gi, (_match, attr, rest) => {
                const cleaned = rest.endsWith('/') ? `${rest}index.html` : rest
                return `${attr}="/api/web-preview/${cleaned}"`
            })

            // Rewrite relative directory links (e.g., href="blog/", href="locations/") so Next.js trailing-slash redirect doesn't break relative base
            html = html.replace(/\bhref=["']((?!https?:\/\/|mailto:|tel:|#|\/)[^"']*\/)["']/gi, (_match, relLink) => {
                return `href="${relLink}index.html"`
            })

            return new Response(html, {
                headers: {
                    'Content-Type': mimeType,
                    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                }
            })
        }

        if (ext === '.js') {
            let jsContent = await fs.promises.readFile(finalPath, 'utf8')
            jsContent = jsContent.replace(/(['"])\/img\//g, '$1/api/web-preview/img/')
            return new Response(jsContent, {
                headers: {
                    'Content-Type': mimeType,
                    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                }
            })
        }

        const fileBuffer = await fs.promises.readFile(finalPath)

        return new Response(fileBuffer, {
            headers: {
                'Content-Type': mimeType,
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        })
    } catch (error: any) {
        return new Response(`Error reading file: ${error?.message}`, { status: 500 })
    }
}

export async function POST(
    request: Request,
    context: { params: Promise<{ slug?: string[] }> }
) {
    const { slug } = await context.params
    if (slug?.length === 1 && slug[0] === 'launch') {
        return handleLaunch()
    }
    if (slug?.length === 1 && slug[0] === 'sync') {
        const syncResult = syncTacosGavilanWeb()
        return Response.json(syncResult)
    }
    return Response.json({ error: 'Endpoint not found' }, { status: 404 })
}

function handleLaunch() {
    const indexPath = path.join(LOCAL_WEB_DIR, 'index.html')
    if (!fs.existsSync(indexPath)) {
        return Response.json({
            ok: false,
            error: 'El archivo index.html no existe en ' + LOCAL_WEB_DIR
        }, { status: 404 })
    }

    try {
        // En Windows, cmd /c start "" "C:\..." lanza el navegador predeterminado con el archivo local
        exec(`cmd.exe /c start "" "${indexPath}"`)
        return Response.json({
            ok: true,
            message: 'Abriendo en navegador predeterminado...',
            fileUrl: 'file:///C:/Users/pedro/Desktop/tacosgavilan-web/index.html'
        })
    } catch (err: any) {
        return Response.json({
            ok: false,
            error: err?.message || 'Error al ejecutar comando start en el sistema operativo'
        }, { status: 500 })
    }
}
