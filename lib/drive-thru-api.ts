/**
 * @module lib/drive-thru-api
 * @description Central integration library for Drive-Thru (DT) data extraction, aggregation,
 * and synchronization from Toast API v2 Orders into Supabase DT-specific tables.
 * Provides functions for fetching DT orders, computing half-hour slot statistics,
 * building leaderboards, calculating ideal time percentiles, and a full sync pipeline.
 *
 * @businessRules
 * - **Detección Drive-Thru**: Una orden es Drive-Thru si el nombre de su dining option
 *   contiene la palabra "drive" (case-insensitive). Los GUIDs de dining options se resuelven
 *   dinámicamente usando el endpoint `/config/v2/diningOptions` porque cambian por tienda.
 * - **Umbrales de Velocidad (Speed of Service thresholds)**:
 *   🟢 Verde (Green)  = ≤210 segundos (3:30)
 *   🟡 Amarillo (Yellow) = 211–300 segundos (3:31–5:00)
 *   🔴 Rojo (Red)     = >300 segundos (>5:00)
 * - **Slots de Media Hora (Half-hour slots)**: El día laboral empieza a las 06:00 y termina
 *   a las 05:30 (48 slots). Cada slot se identifica como "HH:MM" (e.g., "06:00", "06:30").
 *   El slot_index empieza en 0 para "06:00" y termina en 47 para "05:30".
 * - **Día Laboral (Business Date)**: Empieza a las 6:00 AM y termina a las 5:59 AM del
 *   siguiente día calendario. Zona horaria: America/Los_Angeles.
 * - **Turno PM**: Inicia a las 5:00 PM (17:00).
 * - **Cálculo de Duración**: Primero intenta usar `order.duration` (en segundos, provisto
 *   por Toast). Si no existe, calcula `closedDate - openedDate` en segundos.
 * - **Net Sales DT**: Se calcula como la suma de (check.amount - check.taxAmount) para
 *   cada check no-voided de la orden. Esto es una aproximación rápida suficiente para el
 *   módulo DT (el cálculo de precisión financiera completa vive en toast-api.ts).
 *
 * @dataFlow
 * - Toast API `/orders/v2/ordersBulk` → fetchDriveThruOrders() → DTOrder[]
 * - DTOrder[] → aggregateHalfHourStats() → DTHalfHourStats[]
 * - syncDriveThruData() → upsert dt_orders + dt_halfhour_stats en Supabase
 * - getLeaderboard() → consulta dt_orders/dt_halfhour_stats → LeaderboardEntry[]
 * - getIdealTime() → consulta dt_halfhour_stats (últimos 30 días) → percentiles
 *
 * @notes
 * - TOAST_GUID_MAP está replicado aquí (no importado de toast-api.ts) para evitar
 *   dependencias circulares y mantener este módulo autocontenido.
 * - Para operaciones server-side/cron se usa createClient con SUPABASE_SERVICE_ROLE_KEY
 *   (mismo patrón que sync-sales-today/route.ts), NO getSupabaseClient().
 * - El sync procesa tiendas secuencialmente con 1s de espera entre cada una para
 *   respetar los rate limits de Toast API.
 * - Logging usa el prefijo [DT-SYNC] para facilitar búsqueda en logs.
 */

import { getAuthToken } from '@/lib/toast-api'

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

/**
 * Speed of Service thresholds in seconds.
 * 🟢 green: ≤210s (3:30)  |  🟡 yellow: 211–300s (5:00)  |  🔴 red: >300s
 */
export const DT_THRESHOLDS = { green: 210, yellow: 300 } as const

/**
 * TOAST_GUID_MAP — Replicated from toast-api.ts to avoid circular dependencies.
 * Maps Toast restaurant GUID → clean store name.
 */
const TOAST_GUID_MAP: Record<string, string> = {
    'acf15327-54c8-4da4-8d0d-3ac0544dc422': 'Rialto',
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': 'Azusa',
    '42ed15a6-106b-466a-9076-1e8f72451f6b': 'Norwalk',
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a': 'Downey',
    '475bc112-187d-4b9c-884d-1f6a041698ce': 'LA Broadway',
    'a83901db-2431-4283-834e-9502a2ba4b3b': 'Bell',
    '5fbb58f5-283c-4ea4-9415-04100ee6978b': 'Hollywood',
    '47256ade-2cd4-4073-9632-84567ad9e2c8': 'Huntington Park',
    '8685e942-3f07-403a-afb6-faec697cd2cb': 'LA Central',
    '3a803939-eb13-4def-a1a4-462df8e90623': 'La Puente',
    '80a1ec95-bc73-402e-8884-e5abbe9343e6': 'Lynwood',
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': 'Santa Ana',
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd': 'Slauson',
    '95866cfc-eeb8-4af9-9586-f78931e1ea04': 'South Gate',
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': 'West Covina'
}

/**
 * HALF_HOUR_SLOTS — All 48 half-hour slots in a 24h business day starting at 06:00.
 * Index 0 = "06:00", index 1 = "06:30", ..., index 47 = "05:30".
 */
export const HALF_HOUR_SLOTS: string[] = (() => {
    const slots: string[] = []
    // Start at 06:00, go through 24 hours (48 half-hour slots)
    for (let i = 0; i < 48; i++) {
        // Raw hour offset from 06:00
        const totalMinutes = (6 * 60) + (i * 30)
        const hour = Math.floor(totalMinutes / 60) % 24
        const minute = totalMinutes % 60
        slots.push(
            `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        )
    }
    return slots
})()

// ============================================================================
// INTERFACES
// ============================================================================

/** Represents a single Drive-Thru order extracted from Toast */
export interface DTOrder {
    id?: string
    store_id: string
    store_name: string
    business_date: string
    order_guid: string
    order_number: string | null
    opened_at: string
    closed_at: string | null
    duration_seconds: number | null
    half_hour_slot: string
    hour: number
    net_sales: number
}

/** Aggregated stats for a single half-hour slot at a specific store/date */
export interface DTHalfHourStats {
    store_id: string
    store_name: string
    business_date: string
    slot: string
    slot_index: number
    order_count: number
    avg_duration_sec: number
    min_duration_sec: number | null
    max_duration_sec: number | null
    min_order_number: string | null
    max_order_number: string | null
    cars_per_hour_rate: number
    total_sales: number
}

/** A single entry in the store leaderboard ranked by average DT speed */
export interface LeaderboardEntry {
    store_id: string
    store_name: string
    avg_duration_sec: number
    order_count: number
    fastest_order: { number: string | null; duration: number } | null
    slowest_order: { number: string | null; duration: number } | null
    color: 'green' | 'yellow' | 'red'
    rank: number
    trend?: 'up' | 'down' | 'same'
}

// ============================================================================
// HELPER: Server-side Supabase Client
// ============================================================================

/**
 * Creates a server-side Supabase client using the service role key.
 * Same pattern as sync-sales-today/route.ts — bypasses RLS.
 */
function getServerSupabase() {
    const { createClient } = require('@supabase/supabase-js')
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// ============================================================================
// HELPER: getDiningOptionsMap (local copy)
// ============================================================================

/**
 * Fetches the dining options configuration for a specific Toast restaurant.
 * Maps dining option GUID → name (e.g., "Drive Thru", "Dine In", etc.)
 * Needed because Toast GUIDs change per store/instance.
 *
 * @param token - Toast API Bearer token
 * @param storeId - Toast restaurant external GUID
 * @returns Record<guid, name>
 */
async function getDiningOptionsMap(token: string, storeId: string): Promise<Record<string, string>> {
    try {
        const url = new URL(`${TOAST_API_HOST}/config/v2/diningOptions`)
        const res = await fetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeId
            }
        })
        if (!res.ok) return {}
        const data = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(data)) {
            data.forEach((opt: any) => {
                if (opt.guid && opt.name) map[opt.guid] = opt.name
            })
        }
        return map
    } catch {
        return {}
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Returns the color code for a given duration based on DT speed thresholds.
 * 🟢 ≤210s  |  🟡 211-300s  |  🔴 >300s
 *
 * @param seconds - Duration in seconds
 * @returns 'green' | 'yellow' | 'red'
 */
export function getColorForDuration(seconds: number): 'green' | 'yellow' | 'red' {
    if (seconds <= DT_THRESHOLDS.green) return 'green'
    if (seconds <= DT_THRESHOLDS.yellow) return 'yellow'
    return 'red'
}

/**
 * Formats a duration in seconds to "M:SS" format.
 * Example: 210 → "3:30", 65 → "1:05", 300 → "5:00"
 *
 * @param seconds - Duration in seconds (must be >= 0)
 * @returns Formatted string "M:SS"
 */
export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Converts an ISO timestamp to its half-hour slot, hour, and slot index
 * using the America/Los_Angeles timezone.
 *
 * The slot_index starts at 0 for "06:00" and ends at 47 for "05:30".
 * Hours before 06:00 belong to the previous business day but still get a
 * valid slot (indices 36–47 for 00:00–05:30).
 *
 * @param timestamp - ISO 8601 date-time string
 * @returns { slot: "HH:MM", hour: number (0-23), slotIndex: number (0-47) }
 */
export function calculateHalfHourSlot(timestamp: string): { slot: string; hour: number; slotIndex: number } {
    const date = new Date(timestamp)

    // Convert to LA timezone components
    const laTimeStr = date.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    })

    // Parse "HH:MM" from locale string — handles "24:00" edge case
    const parts = laTimeStr.split(':')
    let hour = parseInt(parts[0], 10)
    const minute = parseInt(parts[1], 10)
    if (hour === 24) hour = 0

    // Determine which 30-min block: 0 = :00-:29, 1 = :30-:59
    const halfHour = minute < 30 ? 0 : 30
    const slot = `${String(hour).padStart(2, '0')}:${String(halfHour).padStart(2, '0')}`

    // Calculate slot_index relative to 06:00 start
    // 06:00 = index 0, 06:30 = index 1, ..., 05:30 = index 47
    const totalMinutesSince6 = ((hour - 6 + 24) % 24) * 60 + halfHour
    const slotIndex = Math.floor(totalMinutesSince6 / 30)

    return { slot, hour, slotIndex }
}

// ============================================================================
// DATA FETCHING
// ============================================================================

/**
 * Fetches all Drive-Thru orders from Toast API for a specific store and business date.
 *
 * Process:
 * 1. Authenticates via getAuthToken()
 * 2. Fetches dining options map to identify DT dining option by name containing "drive"
 * 3. Paginates through /orders/v2/ordersBulk with pageSize=100
 * 4. Filters for non-voided orders with DT dining option
 * 5. Calculates duration (order.duration or closedDate - openedDate fallback)
 * 6. Calculates net_sales as sum of non-voided checks (amount - taxAmount)
 *
 * @param storeId - Toast restaurant external GUID
 * @param storeName - Clean store name for display
 * @param businessDate - Date in YYYY-MM-DD format
 * @returns Array of DTOrder objects
 */
export async function fetchDriveThruOrders(
    storeId: string,
    storeName: string,
    businessDate: string
): Promise<DTOrder[]> {
    const token = await getAuthToken()
    if (!token) {
        console.error('[DT-SYNC] Failed to obtain auth token')
        return []
    }

    // Fetch dining options map to resolve DT dining option name dynamically
    const diningOptionsMap = await getDiningOptionsMap(token, storeId)

    const orders: DTOrder[] = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    // Format date YYYY-MM-DD → YYYYMMDD for Toast API
    const formattedDate = businessDate.replace(/-/g, '')

    const fields = [
        'openedDate',
        'closedDate',
        'duration',
        'voided',
        'diningOption',
        'displayNumber',
        'checks.voided',
        'checks.amount',
        'checks.taxAmount'
    ].join(',')

    while (hasMore) {
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', formattedDate)
        url.searchParams.append('pageSize', String(pageSize))
        url.searchParams.append('page', String(page))
        url.searchParams.append('fields', fields)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60000) // 60s timeout

        try {
            const res = await fetch(url.toString(), {
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            })
            clearTimeout(timeoutId)

            if (!res.ok) {
                if (res.status === 429) {
                    console.warn(`[DT-SYNC] Rate limited on page ${page} for ${storeName}, waiting 5s...`)
                    await new Promise(r => setTimeout(r, 5000))
                    continue // Retry same page
                }
                const errTxt = await res.text().catch(() => 'No body')
                console.error(`[DT-SYNC] Toast API error ${res.status} for ${storeName}: ${errTxt}`)
                break
            }

            const data = await res.json()
            const rawOrders = Array.isArray(data) ? data : []

            for (const order of rawOrders) {
                // Skip voided orders
                if (order.voided) continue

                // Resolve dining option name
                const diningOptionName = order.diningOption?.name
                    || diningOptionsMap[order.diningOption?.guid]
                    || ''

                // Only keep Drive-Thru orders
                if (!diningOptionName.toLowerCase().includes('drive')) continue

                // --- Calculate duration_seconds ---
                let durationSeconds: number | null = null

                if (typeof order.duration === 'number' && order.duration > 0) {
                    // Toast provides duration in seconds directly
                    durationSeconds = order.duration
                } else if (order.openedDate && order.closedDate) {
                    // Fallback: calculate from timestamps
                    const diffMs = new Date(order.closedDate).getTime() - new Date(order.openedDate).getTime()
                    if (diffMs > 0) {
                        durationSeconds = Math.floor(diffMs / 1000)
                    }
                }

                // Skip order if duration is null, or if it is an outlier (under 15s or over 15 min / 900s)
                if (durationSeconds === null) continue
                if (durationSeconds < 15 || durationSeconds > 900) {
                    continue
                }

                // --- Calculate net_sales from non-voided checks ---
                let netSales = 0
                if (order.checks && Array.isArray(order.checks)) {
                    for (const check of order.checks) {
                        if (check.voided) continue
                        const amount = Number(check.amount || 0)
                        const tax = Number(check.taxAmount || 0)
                        netSales += (amount - tax)
                    }
                }

                // --- Determine half_hour_slot ---
                const openedAt = order.openedDate || ''
                const { slot, hour, slotIndex } = openedAt
                    ? calculateHalfHourSlot(openedAt)
                    : { slot: '06:00', hour: 6, slotIndex: 0 }

                // --- Build DTOrder ---
                orders.push({
                    store_id: storeId,
                    store_name: storeName,
                    business_date: businessDate,
                    order_guid: order.guid || `${storeId}-${page}-${orders.length}`,
                    order_number: order.displayNumber ? String(order.displayNumber) : null,
                    opened_at: openedAt,
                    closed_at: order.closedDate || null,
                    duration_seconds: durationSeconds,
                    half_hour_slot: slot,
                    hour,
                    net_sales: Math.round(netSales * 100) / 100
                })
            }

            // Pagination control
            if (rawOrders.length < pageSize) {
                hasMore = false
            } else {
                page++
            }
        } catch (err: any) {
            clearTimeout(timeoutId)
            if (err.name === 'AbortError') {
                console.error(`[DT-SYNC] Timeout fetching page ${page} for ${storeName}`)
                break
            }
            console.error(`[DT-SYNC] Fetch error for ${storeName} page ${page}:`, err.message)
            break
        }
    }

    console.log(`[DT-SYNC] ${storeName}: fetched ${orders.length} DT orders for ${businessDate}`)
    return orders
}

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * Aggregates DTOrder[] into half-hour slot statistics.
 *
 * For each slot that has at least 1 order, calculates:
 * - order_count, avg_duration_sec, min/max_duration_sec
 * - min/max_order_number (for ticket range display)
 * - cars_per_hour_rate (count × 2, since each slot is 30 minutes)
 * - total_sales
 *
 * @param orders - Array of DTOrder for a single store/date
 * @param storeId - Toast restaurant GUID
 * @param storeName - Clean store name
 * @param businessDate - YYYY-MM-DD
 * @returns Array of DTHalfHourStats (only slots with ≥1 order)
 */
export function aggregateHalfHourStats(
    orders: DTOrder[],
    storeId: string,
    storeName: string,
    businessDate: string
): DTHalfHourStats[] {
    // Group orders by half_hour_slot
    const slotGroups: Record<string, DTOrder[]> = {}
    for (const order of orders) {
        if (!slotGroups[order.half_hour_slot]) {
            slotGroups[order.half_hour_slot] = []
        }
        slotGroups[order.half_hour_slot].push(order)
    }

    const stats: DTHalfHourStats[] = []

    for (const [slot, slotOrders] of Object.entries(slotGroups)) {
        if (slotOrders.length === 0) continue

        // Collect durations (only non-null)
        const durations = slotOrders
            .map(o => o.duration_seconds)
            .filter((d): d is number => d !== null && d > 0)

        const avgDuration = durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : 0

        const minDuration = durations.length > 0 ? Math.min(...durations) : null
        const maxDuration = durations.length > 0 ? Math.max(...durations) : null

        // Order numbers for min/max display
        const orderNumbers = slotOrders
            .map(o => o.order_number)
            .filter((n): n is string => n !== null)
            .sort()

        const minOrderNumber = orderNumbers.length > 0 ? orderNumbers[0] : null
        const maxOrderNumber = orderNumbers.length > 0 ? orderNumbers[orderNumbers.length - 1] : null

        // Total sales
        const totalSales = Math.round(
            slotOrders.reduce((sum, o) => sum + o.net_sales, 0) * 100
        ) / 100

        // Slot index (0-based from 06:00)
        const slotIndex = HALF_HOUR_SLOTS.indexOf(slot)

        stats.push({
            store_id: storeId,
            store_name: storeName,
            business_date: businessDate,
            slot,
            slot_index: slotIndex >= 0 ? slotIndex : 0,
            order_count: slotOrders.length,
            avg_duration_sec: avgDuration,
            min_duration_sec: minDuration,
            max_duration_sec: maxDuration,
            min_order_number: minOrderNumber,
            max_order_number: maxOrderNumber,
            cars_per_hour_rate: slotOrders.length * 2, // 30min slot → ×2 for hourly rate
            total_sales: totalSales
        })
    }

    // Sort by slot_index for chronological order
    stats.sort((a, b) => a.slot_index - b.slot_index)
    return stats
}

// ============================================================================
// STORE DISCOVERY
// ============================================================================

/**
 * Gets the list of stores that have Drive-Thru capability.
 *
 * Strategy:
 * 1. Query Supabase `stores` table for rows where has_drive_thru = true
 * 2. Fallback: if has_drive_thru column doesn't exist or returns empty,
 *    uses the full TOAST_GUID_MAP as fallback (all 15 stores)
 *
 * @returns Array of { store_id (Toast GUID), store_name }
 */
export async function getDTStores(): Promise<{ store_id: string; store_name: string }[]> {
    try {
        const supabase = getServerSupabase()

        // Try to fetch stores with has_drive_thru = true
        const { data: stores, error } = await supabase
            .from('stores')
            .select('external_id, name, has_drive_thru')
            .eq('has_drive_thru', true)
            .eq('is_active', true)
            .not('external_id', 'is', null)

        if (!error && stores && stores.length > 0) {
            console.log(`[DT-SYNC] Found ${stores.length} DT stores from database`)
            return stores.map((s: any) => ({
                store_id: s.external_id,
                store_name: s.name
            }))
        }

        // Fallback: if has_drive_thru column doesn't exist or no results,
        // use the full TOAST_GUID_MAP
        console.log('[DT-SYNC] Fallback: using TOAST_GUID_MAP (has_drive_thru not available or empty)')
    } catch (err: any) {
        console.warn('[DT-SYNC] Error querying stores for DT, using fallback:', err.message)
    }

    // Fallback: return all stores from TOAST_GUID_MAP
    return Object.entries(TOAST_GUID_MAP).map(([guid, name]) => ({
        store_id: guid,
        store_name: name
    }))
}

// ============================================================================
// SYNC PIPELINE
// ============================================================================

/**
 * Full sync pipeline: fetches DT orders from Toast for all DT stores,
 * upserts into dt_orders and dt_halfhour_stats tables in Supabase.
 *
 * Processes stores sequentially (1s delay between each) to respect
 * Toast API rate limits.
 *
 * @param businessDate - Date in YYYY-MM-DD format
 * @returns Summary: { stored: orders upserted, stats: stats rows upserted, errors: error messages }
 */
export async function syncDriveThruData(
    businessDate: string
): Promise<{ stored: number; stats: number; errors: string[] }> {
    const supabase = getServerSupabase()
    const dtStores = await getDTStores()

    let totalStored = 0
    let totalStats = 0
    const errors: string[] = []

    console.log(`[DT-SYNC] Starting sync for ${businessDate} across ${dtStores.length} stores`)

    for (let i = 0; i < dtStores.length; i++) {
        const { store_id, store_name } = dtStores[i]

        try {
            // --- 1. Fetch DT orders from Toast ---
            const orders = await fetchDriveThruOrders(store_id, store_name, businessDate)

            // Explicitly delete existing orders and stats for this store and date before upserting.
            // This ensures that any old outliers or stale orders are completely removed!
            await supabase
                .from('dt_orders')
                .delete()
                .eq('store_id', store_id)
                .eq('business_date', businessDate)

            await supabase
                .from('dt_halfhour_stats')
                .delete()
                .eq('store_id', store_id)
                .eq('business_date', businessDate)

            if (orders.length === 0) {
                console.log(`[DT-SYNC] ${store_name}: No DT orders found, cleaned up database entries`)
                // Wait between stores even if empty (to maintain rate limit spacing)
                if (i < dtStores.length - 1) {
                    await new Promise(r => setTimeout(r, 1000))
                }
                continue
            }

            // --- 2. Upsert orders into dt_orders ---
            const orderRows = orders.map(o => ({
                store_id: o.store_id,
                store_name: o.store_name,
                business_date: o.business_date,
                order_guid: o.order_guid,
                order_number: o.order_number,
                opened_at: o.opened_at,
                closed_at: o.closed_at,
                duration_seconds: o.duration_seconds,
                half_hour_slot: o.half_hour_slot,
                hour: o.hour,
                net_sales: o.net_sales
            }))

            const { error: ordersError } = await supabase
                .from('dt_orders')
                .upsert(orderRows, { onConflict: 'store_id,order_guid' })

            if (ordersError) {
                const msg = `${store_name}: dt_orders upsert error — ${ordersError.message}`
                console.error(`[DT-SYNC] ${msg}`)
                errors.push(msg)
            } else {
                totalStored += orderRows.length
                console.log(`[DT-SYNC] ${store_name}: upserted ${orderRows.length} orders`)
            }

            // --- 3. Aggregate and upsert half-hour stats ---
            const halfHourStats = aggregateHalfHourStats(orders, store_id, store_name, businessDate)

            if (halfHourStats.length > 0) {
                const statsRows = halfHourStats.map(s => ({
                    store_id: s.store_id,
                    store_name: s.store_name,
                    business_date: s.business_date,
                    slot: s.slot,
                    slot_index: s.slot_index,
                    order_count: s.order_count,
                    avg_duration_sec: s.avg_duration_sec,
                    min_duration_sec: s.min_duration_sec,
                    max_duration_sec: s.max_duration_sec,
                    min_order_number: s.min_order_number,
                    max_order_number: s.max_order_number,
                    cars_per_hour_rate: s.cars_per_hour_rate,
                    total_sales: s.total_sales,
                    updated_at: new Date().toISOString()
                }))

                const { error: statsError } = await supabase
                    .from('dt_halfhour_stats')
                    .upsert(statsRows, { onConflict: 'store_id,business_date,slot' })

                if (statsError) {
                    const msg = `${store_name}: dt_halfhour_stats upsert error — ${statsError.message}`
                    console.error(`[DT-SYNC] ${msg}`)
                    errors.push(msg)
                } else {
                    totalStats += statsRows.length
                    console.log(`[DT-SYNC] ${store_name}: upserted ${statsRows.length} half-hour stats`)
                }
            }
        } catch (err: any) {
            const msg = `${store_name}: unexpected error — ${err.message}`
            console.error(`[DT-SYNC] ${msg}`)
            errors.push(msg)
        }

        // Wait 1s between stores to avoid rate limiting
        if (i < dtStores.length - 1) {
            await new Promise(r => setTimeout(r, 1000))
        }
    }

    console.log(`[DT-SYNC] Sync complete for ${businessDate}: ${totalStored} orders, ${totalStats} stats, ${errors.length} errors`)
    return { stored: totalStored, stats: totalStats, errors }
}

// ============================================================================
// AUTO-DETECTION OF DT STORES
// ============================================================================

/**
 * Automatically detects which stores have Drive-Thru based on real order data.
 *
 * Strategy:
 * 1. Query `sales_daily_cache` for the last 7 days — the `guest_count` column
 *    is actually repurposed as Drive-Thru ticket count (see toast-api.ts L661).
 *    If a store has guest_count > 0 in any recent day, it has Drive-Thru.
 * 2. Also check `dt_orders` table for any orders in the last 14 days as a
 *    secondary source of truth.
 * 3. For stores detected as having DT → SET has_drive_thru = true
 * 4. For stores that had has_drive_thru = true but have ZERO DT activity
 *    for 30+ consecutive days → SET has_drive_thru = false (closed their DT window)
 *
 * This function is called by the cron job once a day (typically at 7 AM)
 * so that new stores with DT are automatically onboarded without manual config.
 *
 * @returns Summary of changes: { activated: string[], deactivated: string[], unchanged: number }
 */
export async function autoDetectDTStores(): Promise<{
    activated: string[]
    deactivated: string[]
    unchanged: number
}> {
    const supabase = getServerSupabase()
    const activated: string[] = []
    const deactivated: string[] = []
    let unchanged = 0

    try {
        // ── Step 1: Get all stores ──
        const { data: allStores, error: storesErr } = await supabase
            .from('stores')
            .select('id, name, external_id, has_drive_thru, is_active')
            .eq('is_active', true)
            .not('external_id', 'is', null)

        if (storesErr || !allStores || allStores.length === 0) {
            console.warn('[DT-AUTO] Could not fetch stores:', storesErr?.message)
            return { activated, deactivated, unchanged: 0 }
        }

        // ── Step 2: Check sales_daily_cache for DT activity (last 7 days) ──
        // guest_count is repurposed as DT ticket count in toast-api.ts
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10)

        const { data: cacheRows, error: cacheErr } = await supabase
            .from('sales_daily_cache')
            .select('store_id, guest_count')
            .gte('business_date', sevenDaysStr)
            .gt('guest_count', 0)

        const storesWithDTFromCache = new Set<string>()
        if (!cacheErr && cacheRows) {
            for (const row of cacheRows) {
                if (row.store_id && row.guest_count > 0) {
                    storesWithDTFromCache.add(row.store_id)
                }
            }
        }

        // ── Step 3: Also check dt_orders table (last 14 days) ──
        const fourteenDaysAgo = new Date()
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
        const fourteenDaysStr = fourteenDaysAgo.toISOString().slice(0, 10)

        const { data: dtOrderRows, error: dtErr } = await supabase
            .from('dt_orders')
            .select('store_id')
            .gte('business_date', fourteenDaysStr)
            .limit(500)

        const storesWithDTFromOrders = new Set<string>()
        if (!dtErr && dtOrderRows) {
            for (const row of dtOrderRows) {
                if (row.store_id) storesWithDTFromOrders.add(row.store_id)
            }
        }

        // ── Step 4: Merge both sources ──
        const storesWithDT = new Set([...storesWithDTFromCache, ...storesWithDTFromOrders])

        console.log(`[DT-AUTO] Detected ${storesWithDT.size} stores with DT activity (last 7-14 days)`)

        // ── Step 5: Check for stores to deactivate (30+ days no DT) ──
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const thirtyDaysStr = thirtyDaysAgo.toISOString().slice(0, 10)

        // Get stores currently marked as DT but with no recent activity
        const currentDTStores = allStores.filter((s: any) => s.has_drive_thru === true)
        const storesNoRecentDT = new Set<string>()

        for (const store of currentDTStores) {
            const extId = store.external_id
            if (!storesWithDT.has(extId)) {
                // No DT in last 14 days — check if they had any in last 30 days
                const { count, error: countErr } = await supabase
                    .from('sales_daily_cache')
                    .select('*', { count: 'exact', head: true })
                    .eq('store_id', extId)
                    .gte('business_date', thirtyDaysStr)
                    .gt('guest_count', 0)

                if (!countErr && (count === 0 || count === null)) {
                    storesNoRecentDT.add(extId)
                }
            }
        }

        // ── Step 6: Apply changes ──
        for (const store of allStores) {
            const extId = store.external_id
            const currentlyDT = store.has_drive_thru === true

            if (storesWithDT.has(extId) && !currentlyDT) {
                // NEW DT STORE DETECTED! → activate
                const { error: updateErr } = await supabase
                    .from('stores')
                    .update({ has_drive_thru: true })
                    .eq('id', store.id)

                if (!updateErr) {
                    activated.push(store.name)
                    console.log(`[DT-AUTO] 🟢 ACTIVATED: ${store.name} — Drive-Thru detected!`)
                } else {
                    console.error(`[DT-AUTO] Failed to activate ${store.name}:`, updateErr.message)
                }
            } else if (storesNoRecentDT.has(extId) && currentlyDT) {
                // DT STORE GONE SILENT for 30+ days → deactivate
                const { error: updateErr } = await supabase
                    .from('stores')
                    .update({ has_drive_thru: false })
                    .eq('id', store.id)

                if (!updateErr) {
                    deactivated.push(store.name)
                    console.log(`[DT-AUTO] 🔴 DEACTIVATED: ${store.name} — No DT activity for 30+ days`)
                } else {
                    console.error(`[DT-AUTO] Failed to deactivate ${store.name}:`, updateErr.message)
                }
            } else {
                unchanged++
            }
        }

        console.log(`[DT-AUTO] Summary: ${activated.length} activated, ${deactivated.length} deactivated, ${unchanged} unchanged`)

    } catch (err: any) {
        console.error('[DT-AUTO] Unexpected error in auto-detection:', err.message)
    }

    return { activated, deactivated, unchanged }
}

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * Builds a ranked leaderboard of stores by average DT speed of service.
 *
 * - If `slot` is provided: queries dt_halfhour_stats for that specific slot
 * - If no slot: queries dt_orders for the full day and calculates averages
 * - Sorted by avg_duration_sec ascending (fastest = rank 1)
 * - Each entry gets a color based on DT_THRESHOLDS
 *
 * @param businessDate - YYYY-MM-DD
 * @param slot - Optional half-hour slot (e.g., "12:00")
 * @returns Ranked array of LeaderboardEntry
 */
export async function getLeaderboard(
    businessDate: string,
    slot?: string
): Promise<LeaderboardEntry[]> {
    const supabase = getServerSupabase()
    const entries: LeaderboardEntry[] = []

    if (slot) {
        // --- Query specific slot from dt_halfhour_stats ---
        const { data: statsRows, error } = await supabase
            .from('dt_halfhour_stats')
            .select('*')
            .eq('business_date', businessDate)
            .eq('slot', slot)

        if (error) {
            console.error(`[DT-SYNC] Leaderboard query error (slot=${slot}):`, error.message)
            return []
        }

        if (!statsRows || statsRows.length === 0) return []

        for (const row of statsRows) {
            entries.push({
                store_id: row.store_id,
                store_name: row.store_name,
                avg_duration_sec: row.avg_duration_sec,
                order_count: row.order_count,
                fastest_order: row.min_duration_sec !== null
                    ? { number: row.min_order_number, duration: row.min_duration_sec }
                    : null,
                slowest_order: row.max_duration_sec !== null
                    ? { number: row.max_order_number, duration: row.max_duration_sec }
                    : null,
                color: getColorForDuration(row.avg_duration_sec),
                rank: 0 // Will be assigned after sorting
            })
        }
    } else {
        // --- Query full day from dt_orders ---
        let allOrders: any[] = []
        let page = 0
        const pageSize = 1000
        let hasMore = true
        let queryError = null

        while (hasMore) {
            const { data, error } = await supabase
                .from('dt_orders')
                .select('store_id, store_name, order_number, duration_seconds')
                .eq('business_date', businessDate)
                .not('duration_seconds', 'is', null)
                .order('opened_at', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1)

            if (error) {
                queryError = error
                break
            }

            if (data && data.length > 0) {
                allOrders = allOrders.concat(data)
                if (data.length < pageSize) {
                    hasMore = false
                } else {
                    page++
                }
            } else {
                hasMore = false
            }
        }

        if (queryError) {
            console.error(`[DT-SYNC] Leaderboard query error (full day):`, queryError.message)
            return []
        }

        if (allOrders.length === 0) return []

        // Group by store_id
        const storeGroups: Record<string, typeof allOrders> = {}
        for (const order of allOrders) {
            if (!storeGroups[order.store_id]) storeGroups[order.store_id] = []
            storeGroups[order.store_id].push(order)
        }

        for (const [storeId, storeOrders] of Object.entries(storeGroups)) {
            const durations = storeOrders
                .map((o: any) => o.duration_seconds as number)
                .filter((d: number) => d > 0)

            if (durations.length === 0) continue

            const avg = Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
            const minDur = Math.min(...durations)
            const maxDur = Math.max(...durations)

            // Find fastest and slowest orders for detail display
            const fastestOrder = storeOrders.find((o: any) => o.duration_seconds === minDur)
            const slowestOrder = storeOrders.find((o: any) => o.duration_seconds === maxDur)

            entries.push({
                store_id: storeId,
                store_name: storeOrders[0].store_name,
                avg_duration_sec: avg,
                order_count: storeOrders.length,
                fastest_order: fastestOrder
                    ? { number: fastestOrder.order_number, duration: minDur }
                    : null,
                slowest_order: slowestOrder
                    ? { number: slowestOrder.order_number, duration: maxDur }
                    : null,
                color: getColorForDuration(avg),
                rank: 0
            })
        }
    }

    // Sort by average duration ascending (fastest first = rank 1)
    entries.sort((a, b) => a.avg_duration_sec - b.avg_duration_sec)

    // Assign ranks
    entries.forEach((entry, index) => {
        entry.rank = index + 1
    })

    return entries
}

// ============================================================================
// IDEAL TIME (PERCENTILES)
// ============================================================================

/**
 * Calculates ideal DT time percentiles from the last 30 days of half-hour stats.
 *
 * Returns overall percentiles (p25, p50, p75, p90) and broken down by daypart:
 * - breakfast: 06:00–09:59
 * - lunch:     10:00–13:59
 * - afternoon: 14:00–16:59
 * - dinner:    17:00–21:59
 * - late:      22:00–05:59
 *
 * @param storeId - Optional: filter to a specific store. If omitted, includes all stores.
 * @returns Percentile data overall and by daypart
 */
export async function getIdealTime(
    storeId?: string
): Promise<{
    p25: number
    p50: number
    p75: number
    p90: number
    byDaypart: Record<string, { p25: number; p50: number }>
}> {
    const supabase = getServerSupabase()

    // Calculate date range: last 30 days
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const endDate = now.toISOString().split('T')[0]
    const startDate = thirtyDaysAgo.toISOString().split('T')[0]

    // Build query with pagination loop
    let allRows: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true
    let queryError = null

    while (hasMore) {
        let query = supabase
            .from('dt_halfhour_stats')
            .select('avg_duration_sec, slot, slot_index')
            .gte('business_date', startDate)
            .lte('business_date', endDate)
            .gt('avg_duration_sec', 0)

        if (storeId) {
            query = query.eq('store_id', storeId)
        }

        const { data, error } = await query
            .order('business_date', { ascending: true })
            .order('slot_index', { ascending: true })
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            queryError = error
            break
        }

        if (data && data.length > 0) {
            allRows = allRows.concat(data)
            if (data.length < pageSize) {
                hasMore = false
            } else {
                page++
            }
        } else {
            hasMore = false
        }
    }

    if (queryError || allRows.length === 0) {
        console.warn('[DT-SYNC] getIdealTime: no data found or error:', queryError?.message)
        return {
            p25: 0,
            p50: 0,
            p75: 0,
            p90: 0,
            byDaypart: {
                breakfast: { p25: 0, p50: 0 },
                lunch: { p25: 0, p50: 0 },
                afternoon: { p25: 0, p50: 0 },
                dinner: { p25: 0, p50: 0 },
                late: { p25: 0, p50: 0 }
            }
        }
    }

    const rows = allRows;

    // --- Overall percentiles ---
    const allDurations = rows.map((r: any) => r.avg_duration_sec as number).sort((a: number, b: number) => a - b)

    const calcPercentile = (arr: number[], p: number): number => {
        if (arr.length === 0) return 0
        const idx = Math.ceil((p / 100) * arr.length) - 1
        return arr[Math.max(0, idx)]
    }

    // --- Daypart classification based on slot hour ---
    // Parse hour from slot string "HH:MM"
    const daypartMap: Record<string, number[]> = {
        breakfast: [],  // 06:00–09:59
        lunch: [],      // 10:00–13:59
        afternoon: [],  // 14:00–16:59
        dinner: [],     // 17:00–21:59
        late: []        // 22:00–05:59
    }

    for (const row of rows) {
        const slotHour = parseInt(row.slot.split(':')[0], 10)
        const dur = row.avg_duration_sec as number

        if (slotHour >= 6 && slotHour <= 9) {
            daypartMap.breakfast.push(dur)
        } else if (slotHour >= 10 && slotHour <= 13) {
            daypartMap.lunch.push(dur)
        } else if (slotHour >= 14 && slotHour <= 16) {
            daypartMap.afternoon.push(dur)
        } else if (slotHour >= 17 && slotHour <= 21) {
            daypartMap.dinner.push(dur)
        } else {
            // 22–23 and 0–5
            daypartMap.late.push(dur)
        }
    }

    // Sort each daypart array
    for (const key of Object.keys(daypartMap)) {
        daypartMap[key].sort((a, b) => a - b)
    }

    const byDaypart: Record<string, { p25: number; p50: number }> = {}
    for (const [daypart, durations] of Object.entries(daypartMap)) {
        byDaypart[daypart] = {
            p25: calcPercentile(durations, 25),
            p50: calcPercentile(durations, 50)
        }
    }

    return {
        p25: calcPercentile(allDurations, 25),
        p50: calcPercentile(allDurations, 50),
        p75: calcPercentile(allDurations, 75),
        p90: calcPercentile(allDurations, 90),
        byDaypart
    }
}
