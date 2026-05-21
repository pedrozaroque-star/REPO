/**
 * 🔧 BACKFILL: Descuentos de Mayo 2026
 * 
 * Script de una sola vez para rellenar la tabla sales_discounts_log
 * con todos los descuentos de mayo 2026 (1 al 20).
 * 
 * Basado en scripts/sync-discounts-week.ts (lógica probada).
 * 
 * USO: npx tsx scripts/backfill-discounts-may.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
const TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || ''
const TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || ''

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TOAST_GUID_MAP: Record<string, string> = {
    "acf15327-54c8-4da4-8d0d-3ac0544dc422": "Rialto",
    "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8": "Azusa",
    "42ed15a6-106b-466a-9076-1e8f72451f6b": "Norwalk",
    "b7f63b01-f089-4ad7-a346-afdb1803dc1a": "Downey",
    "475bc112-187d-4b9c-884d-1f6a041698ce": "LA Broadway",
    "a83901db-2431-4283-834e-9502a2ba4b3b": "Bell",
    "5fbb58f5-283c-4ea4-9415-04100ee6978b": "Hollywood",
    "47256ade-2cd4-4073-9632-84567ad9e2c8": "Huntington Park",
    "8685e942-3f07-403a-afb6-faec697cd2cb": "LA Central",
    "3a803939-eb13-4def-a1a4-462df8e90623": "La Puente",
    "80a1ec95-bc73-402e-8884-e5abbe9343e6": "Lynwood",
    "3c2d8251-c43c-43b8-8306-387e0a4ed7c2": "Santa Ana",
    "9625621e-1b5e-48d7-87ae-7094fab5a4fd": "Slauson",
    "95866cfc-eeb8-4af9-9586-f78931e1ea04": "South Gate",
    "5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02": "West Covina"
}

async function getAuthToken() {
    console.log('🔑 Obteniendo Token de Toast...')
    const res = await fetch(`${TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    })
    if (!res.ok) throw new Error('Fallo al autenticar Toast')
    const data = await res.json()
    console.log('✅ Token obtenido.')
    return data.token.accessToken
}

async function loadEmployeeMap() {
    console.log('👥 Cargando Diccionario Histórico de Empleados...')
    let allEmployees: any[] = []
    let page = 0
    while (true) {
        const { data } = await supabase
            .from('toast_employees')
            .select('toast_guid, first_name, last_name, chosen_name')
            .range(page * 1000, (page + 1) * 1000 - 1)
        if (!data || data.length === 0) break
        allEmployees = [...allEmployees, ...data]
        if (data.length < 1000) break
        page++
    }
    const map = new Map<string, string>()
    allEmployees.forEach(emp => {
        const name = emp.chosen_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
        if (name) map.set(emp.toast_guid, name)
    })
    console.log(`✅ ${map.size} Empleados listos en el Radar.`)
    return map
}

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
    } catch (e) {
        return {}
    }
}

async function syncStoreDiscountsForDate(
    token: string, storeId: string, storeName: string, dateStr: string,
    employeeMap: Map<string, string>, diningOptionsMap: Record<string, string>
) {
    const formattedDate = dateStr.split('-').join('')
    let page = 1
    let hasMore = true
    const pageSize = 100
    const allDiscountsToInsert: any[] = []

    while (hasMore) {
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', formattedDate)
        url.searchParams.append('pageSize', String(pageSize))
        url.searchParams.append('page', String(page))

        let res: any
        let attempt = 0
        let success = false

        while (attempt < 3 && !success) {
            res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': storeId }
            })
            if (res.ok) {
                success = true
            } else if (res.status === 429) {
                console.warn(`  [429] Rate limit en ${storeName}, esperando 5s...`)
                await new Promise(r => setTimeout(r, 5000))
                attempt++
            } else if (res.status >= 500) {
                console.warn(`  [${res.status}] Backend Toast inestable. Reintentando en 3s...`)
                await new Promise(r => setTimeout(r, 3000))
                attempt++
            } else {
                break
            }
        }

        if (!success) {
            console.error(`  💥 Toast falló para ${storeName}. Saltando tienda.`)
            return
        }

        const orders = await res.json()
        if (!Array.isArray(orders) || orders.length === 0) {
            hasMore = false; break
        }

        const buildName = (obj: any, fallback: string) => {
            if (!obj) return fallback
            if (typeof obj === 'string') {
                if (employeeMap.has(obj)) return employeeMap.get(obj)!
                return obj === 'Unknown Server' ? 'Caja / Sistema Automático' : obj
            }
            const idToUse = obj.guid || obj.id
            if (idToUse && employeeMap.has(idToUse)) return employeeMap.get(idToUse)!
            if (obj.firstName || obj.lastName) return `${obj.firstName || ''} ${obj.lastName || ''}`.trim()
            if (obj.name) return obj.name === 'Unknown Server' ? 'Caja / Sistema Automático' : obj.name
            return fallback
        }

        orders.forEach(order => {
            if (order.voided || order.deleted || order.createdInTestMode) return

            let fallbackName = 'Sistema Automático'
            if (order.diningOption) {
                const optId = order.diningOption.guid || order.diningOption.id
                if (optId && diningOptionsMap[optId]) {
                    fallbackName = `Integración: ${diningOptionsMap[optId]}`
                }
            }

            const serverNameOrder = buildName(order.server, fallbackName)
            const openedDate = order.openedDate

            order.checks?.forEach((check: any) => {
                if (check.voided || check.deleted || (check.paymentStatus !== 'CLOSED' && check.paymentStatus !== 'PAID')) return
                const isRefundedCheck = check.payments?.some((p: any) => p.refundStatus && p.refundStatus !== 'NONE') || false
                if (isRefundedCheck) return

                // ESCUDO MATEMÁTICO
                const subtotalBruto = check.selections?.filter((s: any) => !s.deleted && !s.voided).reduce((sum: number, sel: any) => {
                    const qty = sel.quantity || 1
                    const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0)
                    return sum + (unitPrice * qty)
                }, 0) || 0
                const subtotalNeto = Number(check.amount || 0)
                const totalRealDiscount = Math.max(0, subtotalBruto - subtotalNeto)
                if (totalRealDiscount < 0.01) return

                // Check-level discounts
                if (check.appliedDiscounts && check.appliedDiscounts.length > 0) {
                    check.appliedDiscounts.forEach((disc: any) => {
                        if (disc.voided || disc.deleted || disc.state === 'VOIDED' || disc.state === 'REMOVED' || disc.applied === false) return
                        const amount = Number(disc.discountAmount || 0)
                        if (amount === 0 || amount > totalRealDiscount + 0.05) return
                        allDiscountsToInsert.push({
                            store_id: storeId, store_name: storeName, business_date: dateStr,
                            discount_name: disc.name || 'Unknown Discount', discount_amount: amount,
                            approver_name: buildName(disc.approver, serverNameOrder),
                            server_name: serverNameOrder,
                            order_id: String(order.guid || order.id || 'N/A'),
                            check_id: String(check.displayNumber || order.displayNumber || check.guid || check.id || 'N/A'),
                            opened_date: openedDate
                        })
                    })
                }

                // Item-level discounts (Seniors, etc.)
                if (check.selections && check.selections.length > 0) {
                    check.selections.forEach((sel: any) => {
                        if (sel.voided || sel.deleted || sel.deferred || sel.state === 'VOIDED' || sel.state === 'REMOVED' || sel.refundDetails) return
                        const qty = sel.quantity || 1
                        const unitPrice = Number(sel.receiptLinePrice || (Number(sel.price) / qty) || 0)
                        const originalLinePrice = unitPrice * qty
                        const finalLinePrice = Number(sel.price || 0)
                        const inferredDiscount = originalLinePrice - finalLinePrice

                        if (sel.appliedDiscounts && sel.appliedDiscounts.length > 0) {
                            sel.appliedDiscounts.forEach((disc: any) => {
                                if (disc.voided || disc.deleted || disc.state === 'VOIDED' || disc.state === 'REMOVED' || disc.applied === false) return
                                const amount = Number(disc.discountAmount || 0)
                                if (amount === 0 || amount > inferredDiscount + 0.05) return
                                allDiscountsToInsert.push({
                                    store_id: storeId, store_name: storeName, business_date: dateStr,
                                    discount_name: disc.name || 'Unknown Discount', discount_amount: amount,
                                    approver_name: buildName(disc.approver, serverNameOrder),
                                    server_name: serverNameOrder,
                                    order_id: String(order.guid || order.id || 'N/A'),
                                    check_id: String(check.displayNumber || order.displayNumber || check.guid || check.id || 'N/A'),
                                    opened_date: openedDate
                                })
                            })
                        }
                    })
                }
            })
        })

        if (orders.length < pageSize) hasMore = false
        else page++
    }

    // Write to DB
    if (allDiscountsToInsert.length > 0) {
        await supabase.from('sales_discounts_log').delete().eq('store_id', storeId).eq('business_date', dateStr)
        const { error } = await supabase.from('sales_discounts_log').insert(allDiscountsToInsert)
        if (error) {
            console.error(`  ❌ Error insertando en ${storeName}:`, error.message)
        } else {
            console.log(`  ✅ ${storeName}: ${allDiscountsToInsert.length} descuentos`)
        }
    } else {
        // Limpiar datos previos si no hay descuentos para este día
        await supabase.from('sales_discounts_log').delete().eq('store_id', storeId).eq('business_date', dateStr)
    }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN: Backfill Mayo 2026 completo (May 1 → May 20)
// ═══════════════════════════════════════════════════════════════════
async function run() {
    const START_DATE = '2026-05-01'
    const END_DATE = '2026-05-20'

    console.log(`\n${'═'.repeat(60)}`)
    console.log(`🗓️  BACKFILL DESCUENTOS: ${END_DATE} → ${START_DATE} (más reciente primero)`)
    console.log(`${'═'.repeat(60)}\n`)

    try {
        const token = await getAuthToken()
        const employeeMap = await loadEmployeeMap()

        console.log('🍽️ Obteniendo Diccionario de Canales de Venta (Dining Options)...')
        const storeDiningMaps: Record<string, Record<string, string>> = {}
        for (const [storeId] of Object.entries(TOAST_GUID_MAP)) {
            storeDiningMaps[storeId] = await getDiningOptionsMap(token, storeId)
        }
        console.log('✅ Dining Options cargados.\n')

        // Generate all dates in range — REVERSED (most recent first)
        const dates: string[] = []
        const current = new Date(END_DATE + 'T12:00:00')
        const start = new Date(START_DATE + 'T12:00:00')
        while (current >= start) {
            const y = current.getFullYear()
            const m = String(current.getMonth() + 1).padStart(2, '0')
            const d = String(current.getDate()).padStart(2, '0')
            dates.push(`${y}-${m}-${d}`)
            current.setDate(current.getDate() - 1)
        }

        console.log(`📊 Total de días a procesar: ${dates.length}`)
        console.log(`📊 Total de tiendas: ${Object.keys(TOAST_GUID_MAP).length}`)
        console.log(`📊 Total de operaciones: ${dates.length * Object.keys(TOAST_GUID_MAP).length}\n`)

        let totalDiscounts = 0

        for (let i = 0; i < dates.length; i++) {
            const dateStr = dates[i]
            console.log(`\n${'─'.repeat(50)}`)
            console.log(`📅 [${i + 1}/${dates.length}] Procesando: ${dateStr}`)
            console.log(`${'─'.repeat(50)}`)

            for (const [storeId, storeName] of Object.entries(TOAST_GUID_MAP)) {
                await syncStoreDiscountsForDate(token, storeId, storeName, dateStr, employeeMap, storeDiningMaps[storeId] || {})
            }
        }

        // Count total
        const { count } = await supabase
            .from('sales_discounts_log')
            .select('*', { count: 'exact', head: true })
            .gte('business_date', START_DATE)
            .lte('business_date', END_DATE)

        console.log(`\n${'═'.repeat(60)}`)
        console.log(`🎉 BACKFILL COMPLETADO`)
        console.log(`   Rango: ${START_DATE} → ${END_DATE}`)
        console.log(`   Total descuentos en BD: ${count || 0}`)
        console.log(`${'═'.repeat(60)}\n`)

    } catch (e: any) {
        console.error('💥 Error Crítico:', e.message)
        process.exit(1)
    }
}

run()
