/**
 * @module inventory/orders/actions
 * @description Server actions para el módulo de Pedidos a Bodega (Warehouse Orders).
 *              Gestiona el CRUD de bases semanales (PAR), sobrantes diarios,
 *              cálculo automático de órdenes, historial, y cierre de semana.
 *
 * @businessRules
 * - FÓRMULA CORE: ORDER = PAR_mañana - Sobrante_hoy
 * - Viernes no lleva BASE; Sábado cubre Sáb+Dom juntos
 * - Redondeos especiales: Papelitos CEILING(x, 30), Quesadillas CEILING(x, 4)
 * - Lunes de la nueva semana: usa Sobrante_Domingo de la semana anterior
 * - El rollover de semana solo se ejecuta si TODOS los items tienen sobrante de Domingo
 *
 * @dataFlow
 * - inventory_weekly_bases → PAR semanal por tienda/item/semana
 * - inventory_counts → Sobrantes diarios por tienda/item/fecha
 * - inventory_orders + inventory_order_lines → Órdenes generadas
 * - inventory_par_ideal → Promedio histórico de PAR
 *
 * @notes
 * - [2026-06-24] Reescritura total. Eliminados datos hardcodeados (EXCEL_PARS, EXCEL_SOBRANTES).
 * - Toda la data viene de la BD, no hay constantes de Lynwood.
 * - [2026-07-04] Added fetchMappedItems for emergency/extraordinary order items.
 */

'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { addDays, getMonday } from './utils'
import type { OrderableItem, WeeklyBaseRecord, ParIdealRecord, CalculatedOrderLine } from './utils'
import { parseUniformCategoryAndSize, getDefaultMinStock } from '../uniforms/utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

/** Tipos de orden soportados: diaria, líquidos, uniformes */
export type OrderType = 'daily' | 'liquids' | 'uniforms'

// ============================================================================
// HELPERS (private, not exported — no issue with 'use server')
// ============================================================================

/** Aplica la regla de redondeo de un item */
function applyRounding(value: number, rule: string): number {
    if (rule === 'ceiling_60') return Math.ceil(value / 60) * 60
    if (rule === 'ceiling_30') return Math.ceil(value / 30) * 30
    if (rule === 'ceiling_4') return Math.ceil(value / 4) * 4
    return Math.round(value) // Default: redondear al entero más cercano
}

/** Obtiene el key del día de la semana para un date string */
function getDayKey(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    const dayIndex = d.getUTCDay() // 0=Sun, 1=Mon, ... 6=Sat
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    return keys[dayIndex]
}

// ============================================================================
// FETCHERS
// ============================================================================

/**
 * Obtiene los items que participan en el sistema de órdenes (con excel_reference).
 * Incluye el qb_item_id si existe el mapeo en quickbooks_mappings.
 */
export async function fetchOrderableItems(storeId: string | number, orderType: OrderType = 'daily') {
    // 1. Intentar obtener el template específico de esta tienda
    const { data: template, error: templateError } = await supabase
        .from('store_order_template')
        .select(`
            inventory_item_id,
            qb_item_id,
            qb_item_name,
            sort_position,
            inventory_items:inventory_item_id (id, name, unit_type, excel_reference, order_unit_description, order_rounding_rule, purchase_unit_cost, unit_measure)
        `)
        .eq('store_id', storeId)
        .eq('order_type', orderType)
        .order('sort_position', { ascending: true })

    let result: OrderableItem[] = []

    if (!templateError && template && template.length > 0) {
        result = template.map(t => {
            const item = t.inventory_items as any
            const qbCleanName = t.qb_item_name ? t.qb_item_name.split(':').pop()?.trim() || '' : '';
            return {
                id: item.id,
                name: item.name,
                unit_type: item.unit_type,
                excel_reference: item.excel_reference || qbCleanName || item.name,
                order_unit_description: item.order_unit_description,
                order_rounding_rule: item.order_rounding_rule || 'none',
                order_sort_position: t.sort_position || 999,
                qb_item_id: t.qb_item_id,
                purchase_unit_cost: item.purchase_unit_cost,
                unit_measure: item.unit_measure
            }
        }) as OrderableItem[]
    } else if (orderType === 'liquids' || orderType === 'uniforms') {
        // Fallback unificado para líquidos y uniformes: buscar el template de cualquier otra tienda ya que es compartido
        const { data: fallbackTemplate } = await supabase
            .from('store_order_template')
            .select(`
                inventory_item_id,
                qb_item_id,
                qb_item_name,
                sort_position,
                inventory_items:inventory_item_id (id, name, unit_type, excel_reference, order_unit_description, order_rounding_rule, purchase_unit_cost, unit_measure)
            `)
            .eq('order_type', orderType)
            .limit(400)

        if (fallbackTemplate && fallbackTemplate.length > 0) {
            const seenIds = new Set()
            const uniqueLines = []
            for (const t of fallbackTemplate) {
                if (t.inventory_item_id && !seenIds.has(t.inventory_item_id)) {
                    seenIds.add(t.inventory_item_id)
                    uniqueLines.push(t)
                }
            }
            uniqueLines.sort((a, b) => (a.sort_position || 0) - (b.sort_position || 0))

            result = uniqueLines.map(t => {
                const item = t.inventory_items as any
                const qbCleanName = t.qb_item_name ? t.qb_item_name.split(':').pop()?.trim() || '' : '';
                return {
                    id: item.id,
                    name: item.name,
                    unit_type: item.unit_type,
                    excel_reference: item.excel_reference || qbCleanName || item.name,
                    order_unit_description: item.order_unit_description,
                    order_rounding_rule: item.order_rounding_rule || 'none',
                    order_sort_position: t.sort_position || 999,
                    qb_item_id: t.qb_item_id,
                    purchase_unit_cost: item.purchase_unit_cost,
                    unit_measure: item.unit_measure
                }
            }) as OrderableItem[]
        }
    }

    if (result.length === 0) {
        // Fallback: Si no hay template, usar la lista global anterior
        const { data: items, error: itemsError } = await supabase
            .from('inventory_items')
            .select('id, name, unit_type, excel_reference, order_unit_description, order_rounding_rule, order_sort_position, purchase_unit_cost, unit_measure')
            .not('excel_reference', 'is', null)
            .order('order_sort_position', { ascending: true })

        if (itemsError) throw new Error(itemsError.message)

        // QB mappings globales
        const { data: mappings } = await supabase
            .from('quickbooks_mappings')
            .select('qb_item_id, inventory_item_id')

        const qbMap = new Map<string, string>()
        mappings?.forEach(m => qbMap.set(m.inventory_item_id, m.qb_item_id))

        result = (items || []).map(item => ({
            ...item,
            order_rounding_rule: item.order_rounding_rule || 'none',
            order_sort_position: item.order_sort_position || 999,
            qb_item_id: qbMap.get(item.id),
            purchase_unit_cost: item.purchase_unit_cost,
            unit_measure: item.unit_measure
        })) as OrderableItem[]
    }

    // Asegurar que Flan y Cheesecake estén presentes en el pedido diario como TRACK_ONLY
    if (orderType === 'daily') {
        const requiredDesserts = [
            { id: 'f8f776c5-3b8c-453e-8161-b49840823933', name: 'Flan', unit_type: 'Per Unit', order_unit_description: '', purchase_unit_cost: 1.85, unit_measure: 'pza' },
            { id: '8ba55664-5ca9-4886-8ac8-acf1fd070713', name: 'Cheesecake', unit_type: 'Per Unit', order_unit_description: 'Cheesecake', purchase_unit_cost: 2.15, unit_measure: 'pza' }
        ]

        for (const dessert of requiredDesserts) {
            if (!result.some(r => r.id === dessert.id)) {
                result.push({
                    id: dessert.id,
                    name: dessert.name,
                    unit_type: dessert.unit_type,
                    excel_reference: dessert.name,
                    order_unit_description: dessert.order_unit_description,
                    order_rounding_rule: 'none',
                    order_sort_position: 9999,
                    qb_item_id: 'TRACK_ONLY',
                    purchase_unit_cost: dessert.purchase_unit_cost,
                    unit_measure: dessert.unit_measure
                })
            }
        }
    }

    return result
}

/**
 * Obtiene todos los items de inventario (para vincular los que no tienen excel_reference)
 */
export async function fetchAllInventoryItems() {
    const { data } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type, excel_reference, purchase_unit_cost, unit_measure, order_unit_description')
        .order('name', { ascending: true })
    return data || []
}

/**
 * Obtiene todos los items de inventario que tienen un mapeo en QuickBooks (para pedidos extraordinarios).
 */
export async function fetchMappedItems() {
    const { data: mappings, error: mapError } = await supabase
        .from('quickbooks_mappings')
        .select('inventory_item_id, qb_item_id, qb_item_name')

    if (mapError) throw new Error(mapError.message)

    const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type, order_unit_description, purchase_unit_cost, unit_measure')

    if (itemsError) throw new Error(itemsError.message)

    const itemMap = new Map()
    items?.forEach(i => itemMap.set(i.id, i))

    return (mappings || []).map(m => {
        const item = itemMap.get(m.inventory_item_id)
        return {
            id: m.inventory_item_id,
            name: item?.name || m.qb_item_name,
            unit_type: item?.unit_type || 'Unit',
            order_unit_description: item?.order_unit_description || '',
            qb_item_id: m.qb_item_id,
            purchase_unit_cost: item?.purchase_unit_cost,
            unit_measure: item?.unit_measure
        }
    })
}

/**
 * Datos completos para una semana: bases, sobrantes, PAR ideal, e historial de órdenes
 */
export async function fetchWeeklyData(storeId: string | number, mondayStr: string, orderType: OrderType = 'daily') {
    // 0. Obtener las reglas de redondeo de todos los items
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, order_rounding_rule')
    const roundingMap = new Map<string, string>()
    items?.forEach(i => roundingMap.set(i.id, i.order_rounding_rule || 'none'))

    const applyRound = (itemId: string, val: number) => {
        if (val <= 0) return 0
        const rule = roundingMap.get(itemId) || 'none'
        return applyRounding(val, rule)
    }

    // Bases de esta semana
    let { data: bases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr)

    // Fix #3: Si la semana actual no tiene bases, auto-clonar de la semana anterior o PAR Ideal
    let basesAreFallback = false
    if (!bases || bases.length === 0) {
        const lastWeekMonday = addDays(mondayStr, -7)
        const { data: prevBases } = await supabase
            .from('inventory_weekly_bases')
            .select('*')
            .eq('store_id', storeId)
            .eq('week_start_date', lastWeekMonday)

        if (prevBases && prevBases.length > 0) {
            // Auto-clonar de semana anterior a semana actual para que no se pierdan
            const clonedBases = prevBases.map((b: any) => ({
                store_id: storeId,
                inventory_item_id: b.inventory_item_id,
                week_start_date: mondayStr,
                mon_par: b.mon_par, tue_par: b.tue_par, wed_par: b.wed_par,
                thu_par: b.thu_par, fri_par: b.fri_par, sat_par: b.sat_par, sun_par: b.sun_par
            }))
            const { error: cloneErr } = await supabase
                .from('inventory_weekly_bases')
                .upsert(clonedBases, { onConflict: 'store_id, inventory_item_id, week_start_date' })
            if (cloneErr) {
                console.error(`[fetchWeeklyData] Error auto-cloning bases for store ${storeId}:`, cloneErr.message)
            }
            bases = prevBases
            basesAreFallback = true
            console.log(`[fetchWeeklyData] Store ${storeId}: Auto-cloned ${prevBases.length} bases from ${lastWeekMonday} → ${mondayStr}`)
        } else {
            // Intentar con PAR Ideal
            const { data: idealFallback } = await supabase
                .from('inventory_par_ideal')
                .select('*')
                .eq('store_id', storeId)
            if (idealFallback && idealFallback.length > 0) {
                const idealBases = idealFallback.map((p: any) => ({
                    store_id: storeId,
                    inventory_item_id: p.inventory_item_id,
                    week_start_date: mondayStr,
                    mon_par: p.mon_par, tue_par: p.tue_par, wed_par: p.wed_par,
                    thu_par: p.thu_par, fri_par: p.fri_par, sat_par: p.sat_par, sun_par: p.sun_par
                }))
                const { error: idealErr } = await supabase
                    .from('inventory_weekly_bases')
                    .upsert(idealBases, { onConflict: 'store_id, inventory_item_id, week_start_date' })
                if (idealErr) {
                    console.error(`[fetchWeeklyData] Error auto-populating from PAR Ideal for store ${storeId}:`, idealErr.message)
                }
                bases = idealFallback
                basesAreFallback = true
                console.log(`[fetchWeeklyData] Store ${storeId}: Auto-populated ${idealFallback.length} bases from PAR Ideal → ${mondayStr}`)
            }
        }
    }

    // PAR Ideal (Baseline PAR)
    const { data: parIdealRaw } = await supabase
        .from('inventory_par_ideal')
        .select('*')
        .eq('store_id', storeId)

    // Redondear dinámicamente el PAR Ideal obtenido de la BD
    const parIdeal = parIdealRaw?.map((p: any) => ({
        ...p,
        mon_par: applyRound(p.inventory_item_id, p.mon_par),
        tue_par: applyRound(p.inventory_item_id, p.tue_par),
        wed_par: applyRound(p.inventory_item_id, p.wed_par),
        thu_par: applyRound(p.inventory_item_id, p.thu_par),
        fri_par: applyRound(p.inventory_item_id, p.fri_par),
        sat_par: applyRound(p.inventory_item_id, p.sat_par),
        sun_par: applyRound(p.inventory_item_id, p.sun_par)
    })) || []

    // Sobrantes de esta semana + domingo de semana pasada (para cálculo del lunes)
    const lastWeekMondayForCounts = addDays(mondayStr, -7)
    const thisSunday = addDays(mondayStr, 6)

    const { data: counts } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId.toString())
        .gte('count_date', addDays(lastWeekMondayForCounts, 6)) // Solo domingo anterior
        .lte('count_date', thisSunday)

    // Bases de la próxima semana (para previsualizar cambios guardados para próxima semana)
    const nextWeekMonday = addDays(mondayStr, 7)
    const { data: nextBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', nextWeekMonday)

    // Órdenes de esta semana
    const { data: orders } = await supabase
        .from('inventory_orders')
        .select('*, inventory_order_lines(*)')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr)
        .eq('order_type', orderType)
        .order('order_date', { ascending: true })

    // Mapear datos
    const basesMap: Record<string, WeeklyBaseRecord> = {}
    
    // Sobrescribir con las bases reales de esta semana si existen
    if (bases && bases.length > 0) {
        bases.forEach((b: any) => {
            basesMap[b.inventory_item_id] = {
                ...b,
                mon_par: applyRound(b.inventory_item_id, b.mon_par),
                tue_par: applyRound(b.inventory_item_id, b.tue_par),
                wed_par: applyRound(b.inventory_item_id, b.wed_par),
                thu_par: applyRound(b.inventory_item_id, b.thu_par),
                fri_par: applyRound(b.inventory_item_id, b.fri_par),
                sat_par: applyRound(b.inventory_item_id, b.sat_par),
                sun_par: applyRound(b.inventory_item_id, b.sun_par)
            }
        })
    }

    const nextWeekBasesMap: Record<string, WeeklyBaseRecord> = {}
    if (nextBases && nextBases.length > 0) {
        nextBases.forEach((b: any) => {
            nextWeekBasesMap[b.inventory_item_id] = {
                ...b,
                mon_par: applyRound(b.inventory_item_id, b.mon_par),
                tue_par: applyRound(b.inventory_item_id, b.tue_par),
                wed_par: applyRound(b.inventory_item_id, b.wed_par),
                thu_par: applyRound(b.inventory_item_id, b.thu_par),
                fri_par: applyRound(b.inventory_item_id, b.fri_par),
                sat_par: applyRound(b.inventory_item_id, b.sat_par),
                sun_par: applyRound(b.inventory_item_id, b.sun_par)
            }
        })
    }

    const parIdealMap: Record<string, ParIdealRecord> = {}
    parIdeal?.forEach((p: any) => { parIdealMap[p.inventory_item_id] = p })

    const countsMap: Record<string, Record<string, number>> = {}
    counts?.forEach((c: any) => {
        if (!countsMap[c.inventory_item_id]) countsMap[c.inventory_item_id] = {}
        countsMap[c.inventory_item_id][c.count_date] = c.quantity_on_hand
    })

    // Auto-sincronizar módulo de uniformes: PAR = Stock Mínimo, Sobrante = En Existencia Real
    if (orderType === 'uniforms') {
        const numericStoreId = typeof storeId === 'string' ? parseInt(storeId, 10) : storeId
        if (!isNaN(numericStoreId)) {
            const { data: uniformStock } = await supabase
                .from('uniforms_inventory_stock')
                .select('*')
                .eq('store_id', numericStoreId)

            const { data: templateItems } = await supabase
                .from('store_order_template')
                .select('inventory_item_id, inventory_items(name, excel_reference)')
                .eq('order_type', 'uniforms')

            const stockMap = new Map<string, any>()
            uniformStock?.forEach(s => stockMap.set(`${s.item_category}_${s.size}`, s))

            templateItems?.forEach(t => {
                const itemId = t.inventory_item_id
                if (!itemId) return

                const itemObj = t.inventory_items as any
                const name = itemObj?.excel_reference || itemObj?.name || ''
                const { category, size } = parseUniformCategoryAndSize(name)
                if (!category) return

                const stockRow = stockMap.get(`${category}_${size}`)
                const defaultMin = getDefaultMinStock(category, size)
                const minStock = (stockRow?.min_stock !== null && stockRow?.min_stock !== undefined) ? Number(stockRow.min_stock) : defaultMin
                const quantityOnHand = stockRow ? Number(stockRow.quantity_on_hand) || 0 : 0

                // Si no hay base manual de esta semana, pre-cargar el Stock Mínimo como PAR
                if (!basesMap[itemId]) {
                    basesMap[itemId] = {
                        inventory_item_id: itemId,
                        mon_par: minStock,
                        tue_par: minStock,
                        wed_par: minStock,
                        thu_par: minStock,
                        fri_par: minStock,
                        sat_par: minStock,
                        sun_par: minStock
                    }
                } else {
                    // Asegurar que si mon_par es 0 o vacio, tome el Stock Mínimo por defecto
                    if (!basesMap[itemId].mon_par) basesMap[itemId].mon_par = minStock
                }

                // Sincronizar automáticamente el Sobrante con la existencia física del módulo de uniformes
                if (!countsMap[itemId]) countsMap[itemId] = {}
                for (let d = 0; d < 7; d++) {
                    const dateStr = addDays(mondayStr, d)
                    countsMap[itemId][dateStr] = quantityOnHand
                }
            })
        }
    }

    return {
        bases: basesMap,
        nextWeekBases: nextWeekBasesMap,
        parIdeal: parIdealMap,
        counts: countsMap,
        orders: orders || [],
        currentMonday: mondayStr,
        lastSundayDate: addDays(lastWeekMondayForCounts, 6),
        basesAreFallback
    }
}

/**
 * Guarda las modificaciones del PAR en las bases semanales.
 */
export async function saveWeeklyBases(
    storeId: string | number,
    weekStartDate: string,
    basesList: { inventory_item_id: string; mon_par?: number; tue_par?: number; wed_par?: number; thu_par?: number; fri_par?: number; sat_par?: number; sun_par?: number }[]
) {
    const weeklyPayload = basesList.map(b => {
        const row: any = {
            store_id: storeId,
            inventory_item_id: b.inventory_item_id,
            week_start_date: weekStartDate,
            updated_at: new Date().toISOString()
        }
        if (b.mon_par !== undefined) row.mon_par = b.mon_par
        if (b.tue_par !== undefined) row.tue_par = b.tue_par
        if (b.wed_par !== undefined) row.wed_par = b.wed_par
        if (b.thu_par !== undefined) row.thu_par = b.thu_par
        if (b.fri_par !== undefined) row.fri_par = b.fri_par
        if (b.sat_par !== undefined) row.sat_par = b.sat_par
        if (b.sun_par !== undefined) row.sun_par = b.sun_par
        return row
    })

    const { error: err1 } = await supabase
        .from('inventory_weekly_bases')
        .upsert(weeklyPayload, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (err1) {
        console.error('Error al guardar bases semanales:', err1.message)
        throw new Error(err1.message)
    }

    revalidatePath('/inventory/orders')
}

/**
 * Guardado en vivo (real-time live auto-save) de un solo ítem de PAR base.
 */
export async function saveSingleItemWeeklyBase(
    storeId: string | number,
    weekStartDate: string,
    b: { inventory_item_id: string; mon_par?: number; tue_par?: number; wed_par?: number; thu_par?: number; fri_par?: number; sat_par?: number; sun_par?: number }
) {
    const payload: any = {
        store_id: storeId,
        inventory_item_id: b.inventory_item_id,
        week_start_date: weekStartDate,
        updated_at: new Date().toISOString()
    }
    if (b.mon_par !== undefined) payload.mon_par = b.mon_par
    if (b.tue_par !== undefined) payload.tue_par = b.tue_par
    if (b.wed_par !== undefined) payload.wed_par = b.wed_par
    if (b.thu_par !== undefined) payload.thu_par = b.thu_par
    if (b.fri_par !== undefined) payload.fri_par = b.fri_par
    if (b.sat_par !== undefined) payload.sat_par = b.sat_par
    if (b.sun_par !== undefined) payload.sun_par = b.sun_par

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(payload, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (error) {
        console.error('Error en guardado en vivo de PAR base:', error.message)
        throw new Error(error.message)
    }
}

/**
 * Carga datos del historial para las pestañas Historial y Sobrantes.
 * Usa el service role key (sin RLS) igual que fetchWeeklyData.
 */
export async function fetchHistoryData(
    storeId: string | number,
    mondayStr: string
): Promise<{ orders: any[]; counts: Record<string, Record<string, number>>; bases: Record<string, any> }> {
    const sunday = addDays(mondayStr, 6)

    // Fetch ALL orders for this week (both daily and liquids)
    const { data: ordersData } = await supabase
        .from('inventory_orders')
        .select('*, inventory_order_lines(*)')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr)
        .order('order_date', { ascending: true })

    // Fetch counts (sobrantes) for the week
    const { data: countsData } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId.toString())
        .gte('count_date', mondayStr)
        .lte('count_date', sunday)

    // Fetch weekly bases (PAR per day) for this week
    const { data: basesData } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr)

    // Build counts map: { itemId: { dateStr: value } }
    const countsMap: Record<string, Record<string, number>> = {}
    if (countsData) {
        for (const c of countsData) {
            if (!countsMap[c.inventory_item_id]) countsMap[c.inventory_item_id] = {}
            countsMap[c.inventory_item_id][c.count_date] = c.quantity_on_hand
        }
    }

    // Build bases map: { itemId: { mon_par, tue_par, ... } }
    const basesMap: Record<string, any> = {}
    if (basesData) {
        for (const b of basesData) {
            basesMap[b.inventory_item_id] = b
        }
    }

    return { orders: ordersData || [], counts: countsMap, bases: basesMap }
}

/**
 * Calcula la orden del día para una fecha específica.
 * ORDER = PAR_mañana - Sobrante_hoy
 * Para domingo: nextDay es Lunes de la PRÓXIMA semana
 */
export async function calculateDailyOrder(
    storeId: string | number,
    dateStr: string,
    items: OrderableItem[],
    bases: Record<string, WeeklyBaseRecord>,
    counts: Record<string, Record<string, number>>,
    mondayStr: string,
    parIdeal?: Record<string, ParIdealRecord>,
    overrideDayField?: string,
    parBoostPercent: number = 0,
    orderType: OrderType = 'daily',
    nextWeekBases?: Record<string, WeeklyBaseRecord>
): Promise<CalculatedOrderLine[]> {
    const dayKey = getDayKey(dateStr)
    const dayIndex = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(dayKey)

    // Determinar el día siguiente y su PAR por defecto
    let nextDayBaseField: string
    if (dayKey === 'sun') {
        // Domingo: mañana es lunes de la PRÓXIMA semana
        nextDayBaseField = 'mon_par'
    } else {
        const nextKeys = ['tue_par', 'wed_par', 'thu_par', 'fri_par', 'sat_par', 'sun_par']
        nextDayBaseField = nextKeys[dayIndex]
    }

    // Usar override si está definido, si no usar el día siguiente por defecto
    const targetField = overrideDayField && overrideDayField !== 'auto' ? overrideDayField : nextDayBaseField
    const actualTargetField = (orderType === 'liquids' || orderType === 'uniforms') ? 'mon_par' : targetField

    // 1. Cargar consumo teórico del día desde inventory_usage_log
    const { data: usageLogData } = await supabase
        .from('inventory_usage_log')
        .select('inventory_item_id, theoretical_usage')
        .eq('store_id', storeId.toString())
        .eq('business_date', dateStr)

    const usageMap = new Map<string, number>()
    usageLogData?.forEach((u: any) => usageMap.set(u.inventory_item_id, Number(u.theoretical_usage) || 0))

    // 2. Obtener la fecha de ayer para leer Sobrante de Ayer + Pedido Llegó Hoy
    const yesterdayStr = addDays(dateStr, -1)

    // Leer orden entregada ayer/hoy para saber lo que llegó de Bodega
    const { data: recentOrderLines } = await supabase
        .from('inventory_order_lines')
        .select('inventory_item_id, final_qty, adjusted_qty, calculated_qty, order_id, inventory_orders!inner(order_date, store_id)')
        .eq('inventory_orders.store_id', storeId)
        .eq('inventory_orders.order_date', yesterdayStr)

    const arrivedMap = new Map<string, number>()
    recentOrderLines?.forEach((l: any) => {
        const qty = l.final_qty ?? (l.adjusted_qty ?? (l.calculated_qty ?? 0))
        arrivedMap.set(l.inventory_item_id, qty)
    })

    const lines: CalculatedOrderLine[] = []

    for (const item of items) {
        // Si el día seleccionado es Domingo (dayKey === 'sun') y estamos buscando 'mon_par' (Lunes),
        // el Lunes pertenece a la PRÓXIMA SEMANA. Usamos nextWeekBases si está disponible.
        let base = bases[item.id]
        if (dayKey === 'sun' && actualTargetField === 'mon_par' && nextWeekBases && nextWeekBases[item.id]) {
            base = nextWeekBases[item.id]
        }

        const effectiveBase = base || {
            mon_par: 0, tue_par: 0, wed_par: 0, thu_par: 0, fri_par: 0, sat_par: 0, sun_par: 0
        }

        // PAR original del día seleccionado (para líquidos/uniformes siempre es mon_par)
        let parValue = (effectiveBase as any)[actualTargetField] || 0

        // Aplicar incremento de emergencia si está definido y el PAR > 0
        if (parBoostPercent > 0 && parValue > 0) {
            const boosted = parValue * (1 + parBoostPercent / 100)
            // Asegurar que el PAR incrementado también respete las reglas de múltiplos del item
            parValue = applyRounding(boosted, item.order_rounding_rule)
        }

        // PAR Ideal de referencia para ese mismo día
        const itemParIdeal = parIdeal && parIdeal[item.id] ? (parIdeal[item.id] as any)[actualTargetField] || 0 : 0

        // Sobrante de hoy
        const itemCounts = counts[item.id] || {}
        const leftoverValue = itemCounts[dateStr] ?? null

        // Sobrante de ayer
        const yesterdayLeftover = itemCounts[yesterdayStr] ?? null
        const arrivedToday = arrivedMap.get(item.id) || 0
        const theoreticalUsage = usageMap.get(item.id) ?? null

        let suggestedLeftover: number | null = null
        let isBurnRate = false

        if (theoreticalUsage !== null && yesterdayLeftover !== null) {
            // Ecuación Fundamental: Sobrante Teórico = Sobrante Ayer + Llegó Hoy - Consumo Teórico
            const calc = yesterdayLeftover + arrivedToday - theoreticalUsage
            suggestedLeftover = Math.max(0, applyRounding(calc, item.order_rounding_rule))
        } else if (theoreticalUsage === null && yesterdayLeftover !== null) {
            // Fallback Burn Rate para items de limpieza/suministros
            // Si el item no tiene receta, estimar un consumo diario moderado basado en el PAR
            isBurnRate = true
            const estimatedDailyUsage = parValue > 0 ? Math.max(1, parValue * 0.2) : 0
            const calc = yesterdayLeftover + arrivedToday - estimatedDailyUsage
            suggestedLeftover = Math.max(0, applyRounding(calc, item.order_rounding_rule))
        }

        // Calcular varianza: Sobrante Teórico Sugerido - Sobrante Real Capturado
        let variance: number | null = null
        if (suggestedLeftover !== null && leftoverValue !== null) {
            variance = Number((leftoverValue - suggestedLeftover).toFixed(2))
        }

        // Calcular orden: si no hay sobrante capturado, asumir 0 (pedir PAR completo)
        const effectiveLeftover = leftoverValue ?? 0
        let calculatedQty = parValue - effectiveLeftover
        // Clamp a 0: si sobrante > PAR, no pedir cantidades negativas
        calculatedQty = Math.max(0, calculatedQty)
        // Aplicar regla de redondeo
        if (calculatedQty > 0) {
            calculatedQty = applyRounding(calculatedQty, item.order_rounding_rule)
        }

        lines.push({
            inventory_item_id: item.id,
            item_name: item.excel_reference || item.name,
            unit_description: item.order_unit_description || item.unit_type,
            par_value: parValue,
            par_ideal_value: itemParIdeal,
            leftover_value: leftoverValue,
            suggested_leftover: suggestedLeftover,
            is_burn_rate: isBurnRate,
            variance: variance,
            calculated_qty: calculatedQty,
            rounding_rule: item.order_rounding_rule,
            qb_item_id: item.qb_item_id,
            purchase_unit_cost: item.purchase_unit_cost,
            unit_measure: item.unit_measure
        })
    }

    return lines
}

// ============================================================================
// MUTACIONES
// ============================================================================

/** Actualiza un campo de PAR semanal */
export async function updateWeeklyBase(
    storeId: string | number,
    itemId: string,
    mondayStr: string,
    field: string,
    value: number
) {
    const payload: any = {
        store_id: storeId,
        inventory_item_id: itemId,
        week_start_date: mondayStr
    }
    payload[field] = value

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(payload, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (error) console.error('Error update base:', error)
}

/** Actualiza o elimina un sobrante diario */
export async function updateDailyLeftover(
    storeId: string | number,
    itemId: string,
    dateStr: string,
    value: number | null
) {
    if (value === null) {
        const { error } = await supabase
            .from('inventory_counts')
            .delete()
            .match({ store_id: storeId.toString(), inventory_item_id: itemId, count_date: dateStr })
        if (error) console.error('Error deleting count:', error)
        return
    }

    const { error } = await supabase
        .from('inventory_counts')
        .upsert({
            store_id: storeId.toString(),
            inventory_item_id: itemId,
            count_date: dateStr,
            quantity_on_hand: value
        }, { onConflict: 'store_id, inventory_item_id, count_date' })

    if (error) console.error('Error update count:', error)
}

/** Clona las bases de la semana anterior a la semana objetivo */
export async function clonePreviousWeekBases(storeId: string | number, targetMonday: string) {
    const lastWeekMonday = addDays(targetMonday, -7)

    // 1. Obtener bases de la semana anterior
    const { data: oldBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', lastWeekMonday)

    // 2. Obtener PAR Ideal como respaldo para items faltantes
    const { data: parIdealData } = await supabase
        .from('inventory_par_ideal')
        .select('*')
        .eq('store_id', storeId)

    // 3. Obtener todos los items del template de la tienda (daily + liquids)
    const { data: templateItems } = await supabase
        .from('store_order_template')
        .select('inventory_item_id')
        .eq('store_id', storeId)

    if ((!oldBases || oldBases.length === 0) && (!parIdealData || parIdealData.length === 0)) {
        return { error: 'No se encontraron bases de la semana anterior ni PAR Ideal.' }
    }

    // Mapear bases anteriores por item_id
    const oldBasesMap = new Map<string, any>()
    oldBases?.forEach(b => oldBasesMap.set(b.inventory_item_id, b))

    // Mapear PAR Ideal por item_id
    const parIdealMap = new Map<string, any>()
    parIdealData?.forEach(p => parIdealMap.set(p.inventory_item_id, p))

    // 4. Construir set de TODOS los item_ids que deberían tener bases
    const allItemIds = new Set<string>()
    oldBases?.forEach(b => allItemIds.add(b.inventory_item_id))
    parIdealData?.forEach(p => allItemIds.add(p.inventory_item_id))
    templateItems?.forEach(t => { if (t.inventory_item_id) allItemIds.add(t.inventory_item_id) })

    // 5. Merge inteligente: prioridad = bases semana anterior > PAR Ideal > skip
    const newBases: any[] = []
    let fromPrev = 0, fromIdeal = 0

    allItemIds.forEach(itemId => {
        const prev = oldBasesMap.get(itemId)
        const ideal = parIdealMap.get(itemId)
        const source = prev || ideal

        if (source) {
            newBases.push({
                store_id: storeId,
                inventory_item_id: itemId,
                week_start_date: targetMonday,
                mon_par: source.mon_par || 0, tue_par: source.tue_par || 0, wed_par: source.wed_par || 0,
                thu_par: source.thu_par || 0, fri_par: source.fri_par || 0, sat_par: source.sat_par || 0,
                sun_par: source.sun_par || 0
            })
            if (prev) fromPrev++
            else fromIdeal++
        }
    })

    if (newBases.length === 0) {
        return { error: 'No hay datos suficientes para crear bases para la nueva semana.' }
    }

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(newBases, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (error) return { error: error.message }
    console.log(`[Rollover] Store ${storeId}: ${newBases.length} items clonados (${fromPrev} de semana anterior, ${fromIdeal} de PAR Ideal)`)
    revalidatePath('/inventory/orders')
    return { success: true, total: newBases.length, fromPrev, fromIdeal }
}

/** Copia los valores del PAR Ideal a la semana objetivo */
export async function copyFromParIdeal(storeId: string | number, targetMonday: string) {
    const { data: parIdeal } = await supabase
        .from('inventory_par_ideal')
        .select('*')
        .eq('store_id', storeId)

    if (!parIdeal || parIdeal.length === 0) {
        return { error: 'No se encontraron valores de PAR Ideal.' }
    }

    const newBases = parIdeal.map((p) => ({
        store_id: storeId,
        inventory_item_id: p.inventory_item_id,
        week_start_date: targetMonday,
        mon_par: p.mon_par, tue_par: p.tue_par, wed_par: p.wed_par,
        thu_par: p.thu_par, fri_par: p.fri_par, sat_par: p.sat_par, sun_par: p.sun_par
    }))

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(newBases, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (error) return { error: error.message }
    revalidatePath('/inventory/orders')
    return { success: true }
}

/** Vincula un item de inventario con un nombre del Excel */
export async function linkExcelItem(itemId: string, excelName: string) {
    // Limpiar si otro item ya tenía este nombre
    await supabase.from('inventory_items').update({ excel_reference: null }).eq('excel_reference', excelName)
    // Asignar al item elegido
    const { error } = await supabase.from('inventory_items').update({ excel_reference: excelName }).eq('id', itemId)
    if (error) return { error: error.message }
    revalidatePath('/inventory/orders')
    return { success: true }
}

/** Guarda una orden como borrador */
export async function saveOrderDraft(
    storeId: string | number,
    orderDate: string,
    weekStartDate: string,
    lines: { inventory_item_id: string; calculated_qty: number; adjusted_qty?: number; par_value: number; leftover_value: number }[],
    createdBy?: string,
    notes?: string,
    orderType: OrderType = 'daily'
) {
    // Si la orden ya existe y fue enviada a QB, preservar su status actual
    // (no resetear a 'draft' un pedido que ya tiene Estimate en QB)
    let preservedStatus: string | null = null
    const { data: existingOrder } = await supabase
        .from('inventory_orders')
        .select('status, qb_estimate_id')
        .eq('store_id', storeId)
        .eq('order_date', orderDate)
        .eq('order_type', orderType)
        .maybeSingle()

    if (existingOrder?.qb_estimate_id) {
        preservedStatus = existingOrder.status // Preservar 'sent' o lo que sea
    }

    // Upsert la orden
    const { data: order, error: orderError } = await supabase
        .from('inventory_orders')
        .upsert({
            store_id: storeId,
            order_date: orderDate,
            week_start_date: weekStartDate,
            status: preservedStatus || 'draft',
            created_by: createdBy || 'Manager',
            notes: notes || null,
            order_type: orderType,
            updated_at: new Date().toISOString()
        }, { onConflict: 'store_id, order_date, order_type' })
        .select()
        .single()

    if (orderError) return { error: orderError.message }

    // Borrar líneas existentes y reemplazar
    await supabase.from('inventory_order_lines').delete().eq('order_id', order.id)

    // Insertar nuevas líneas
    const orderLines = lines.map(l => ({
        order_id: order.id,
        inventory_item_id: l.inventory_item_id,
        calculated_qty: l.calculated_qty,
        adjusted_qty: l.adjusted_qty ?? null,
        final_qty: l.adjusted_qty ?? l.calculated_qty,
        par_value: l.par_value,
        leftover_value: l.leftover_value
    }))

    if (orderLines.length > 0) {
        const { error: linesError } = await supabase
            .from('inventory_order_lines')
            .insert(orderLines)
        if (linesError) return { error: linesError.message }
    }

    revalidatePath('/inventory/orders')
    return { success: true, orderId: order.id }
}


/**
 * Ejecuta el cierre de semana (equivalente al macro de Google Sheets).
 * 1. Valida que todos los items tengan sobrante de Domingo
 * 2. Clona bases a la nueva semana (o usa PAR Ideal)
 * 3. Recalcula PAR Ideal con promedio histórico
 */
export async function executeWeekRollover(storeId: string | number, currentMonday: string) {
    const sundayDate = addDays(currentMonday, 6)
    const nextMonday = addDays(currentMonday, 7)

    // 1. Obtener items que participan en órdenes
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id')
        .not('excel_reference', 'is', null)

    if (!items || items.length === 0) {
        return { error: 'No hay items configurados para órdenes.' }
    }

    // 2. Verificar que todos tengan sobrante de domingo
    const { data: sundayCounts } = await supabase
        .from('inventory_counts')
        .select('inventory_item_id')
        .eq('store_id', storeId.toString())
        .eq('count_date', sundayDate)

    const capturedIds = new Set(sundayCounts?.map(c => c.inventory_item_id) || [])
    const missing = items.filter(i => !capturedIds.has(i.id))

    if (missing.length > 0) {
        return { error: `Faltan sobrantes del domingo para ${missing.length} productos.`, missingCount: missing.length }
    }

    // 3. Recalcular PAR Ideal PRIMERO (incluyendo la semana que se cierra)
    await recalculateParIdeal(storeId)

    // 4. Clonar bases a la nueva semana (ahora usa el PAR Ideal recién recalculado)
    const cloneResult = await clonePreviousWeekBases(storeId, nextMonday)
    if (cloneResult.error) {
        // Si no hay bases de la semana actual, usar el PAR Ideal recién calculado
        const parResult = await copyFromParIdeal(storeId, nextMonday)
        if (parResult.error) {
            return { error: 'No se pudieron crear bases para la nueva semana.' }
        }
    }

    revalidatePath('/inventory/orders')
    return { success: true, nextMonday }
}

/**
 * Recalcula el PAR Ideal promediando las bases de las últimas N semanas,
 * ajustadas matemáticamente según el sobrante diario de cada día.
 */
export async function recalculateParIdeal(storeId: string | number, weeksBack: number = 4) {
    const today = new Date()
    const currentMonday = getMonday(today)
    const startDate = addDays(currentMonday, -(weeksBack * 7))

    // 1. Obtener todas las bases de las últimas N semanas
    const { data: allBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .gte('week_start_date', startDate)
        .lte('week_start_date', currentMonday) // Incluir la semana actual (la que se está cerrando)

    if (!allBases || allBases.length === 0) return

    // 1b. Obtener las reglas de redondeo de todos los items
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, order_rounding_rule')
    const roundingMap = new Map<string, string>()
    items?.forEach(i => roundingMap.set(i.id, i.order_rounding_rule || 'none'))

    // 2. Obtener todos los sobrantes registrados en ese mismo rango
    const { data: leftovers } = await supabase
        .from('inventory_counts')
        .select('inventory_item_id, count_date, quantity_on_hand')
        .eq('store_id', storeId.toString())
        .gte('count_date', startDate)
        .lte('count_date', addDays(currentMonday, 6)) // Incluir toda la semana actual

    // Mapa de sobrantes para búsqueda rápida
    const leftoverMap = new Map()
    leftovers?.forEach(l => {
        leftoverMap.set(`${l.inventory_item_id}_${l.count_date}`, Number(l.quantity_on_hand) || 0)
    })

    const daysOfWeek = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const itemAdjustedBases: Record<string, { count: number; sums: Record<string, number> }> = {}

    // 3. Procesar y ajustar el PAR de cada día según la fórmula matemática
    for (const b of allBases) {
        const itemId = b.inventory_item_id
        if (!itemAdjustedBases[itemId]) {
            itemAdjustedBases[itemId] = { count: 0, sums: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } }
        }
        itemAdjustedBases[itemId].count++

        daysOfWeek.forEach((day, index) => {
            const parVal = Number(b[`${day}_par`]) || 0
            let adjPar = parVal

            if (day === 'sat') {
                // Sábado se valida con el sobrante del Domingo (índice 6)
                const sundayDateStr = addDays(b.week_start_date, 6)
                const sundayLeftoverVal = leftoverMap.get(`${itemId}_${sundayDateStr}`)
                
                if (sundayLeftoverVal !== undefined && parVal >= 8) {
                    const leftoverPct = (sundayLeftoverVal / parVal) * 100
                    if (leftoverPct >= 40) {
                        // ≥40% sobrante → exceso, bajar PAR
                        if (leftoverPct >= 60) {
                            adjPar = parVal - Math.round(parVal * 0.15)
                        } else {
                            adjPar = parVal - Math.round(parVal * 0.10)
                        }
                    } else if (leftoverPct < 15) {
                        // <15% sobrante → riesgo de quedarse sin, subir PAR
                        if (parVal >= 40) {
                            adjPar = parVal + Math.round(parVal * 0.10)
                        } else {
                            adjPar = parVal + Math.round(parVal * 0.20)
                        }
                    }
                    // 15%-40% → rango ideal, sin cambio
                }
            } else {
                // Lunes a Viernes se valida con el sobrante del mismo día
                const dateStr = addDays(b.week_start_date, index)
                const leftoverVal = leftoverMap.get(`${itemId}_${dateStr}`)
                
                if (leftoverVal !== undefined && parVal >= 8) {
                    const leftoverPct = (leftoverVal / parVal) * 100
                    if (leftoverPct >= 60) {
                        // ≥60% sobrante → sobra demasiado, bajar PAR
                        if (leftoverPct >= 80) {
                            adjPar = parVal - Math.round(parVal * 0.15)
                        } else {
                            adjPar = parVal - Math.round(parVal * 0.10)
                        }
                    } else if (leftoverPct < 20) {
                        // <20% sobrante → riesgo de quedarse sin producto, subir PAR
                        if (parVal >= 40) {
                            adjPar = parVal + Math.round(parVal * 0.10)
                        } else {
                            adjPar = parVal + Math.round(parVal * 0.20)
                        }
                    }
                    // 20%-60% → rango ideal, sin cambio
                }
            }

            itemAdjustedBases[itemId].sums[day] += adjPar
        })
    }

    // 4. Promediar e insertar/actualizar en la tabla de PAR Ideal
    const parRecords = Object.entries(itemAdjustedBases).map(([itemId, data]) => {
        const rule = roundingMap.get(itemId) || 'none'
        const roundPar = (val: number) => {
            const rawAvg = val / data.count
            if (rawAvg <= 0) return 0
            return applyRounding(rawAvg, rule)
        }
        return {
            store_id: storeId,
            inventory_item_id: itemId,
            mon_par: roundPar(data.sums.mon),
            tue_par: roundPar(data.sums.tue),
            wed_par: roundPar(data.sums.wed),
            thu_par: roundPar(data.sums.thu),
            fri_par: roundPar(data.sums.fri),
            sat_par: roundPar(data.sums.sat),
            sun_par: 0, // Domingo siempre es 0
            calculated_from_weeks: data.count,
            updated_at: new Date().toISOString()
        }
    })

    if (parRecords.length > 0) {
        await supabase
            .from('inventory_par_ideal')
            .upsert(parRecords, { onConflict: 'store_id, inventory_item_id' })
    }
}

/**
 * Obtiene datos de análisis: historial de uso de las últimas N semanas
 */
export async function fetchAnalysisData(storeId: string | number, weeksBack: number = 8) {
    const today = new Date()
    const currentMonday = getMonday(today)
    const startDate = addDays(currentMonday, -(weeksBack * 7))

    // Bases históricas
    const { data: allBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .gte('week_start_date', startDate)
        .order('week_start_date', { ascending: false })

    // Sobrantes históricos
    const { data: allCounts } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId.toString())
        .gte('count_date', startDate)
        .order('count_date', { ascending: false })

    // Historial de órdenes
    const { data: orderHistory } = await supabase
        .from('inventory_orders')
        .select('id, order_date, week_start_date, status, qb_estimate_number, sent_at')
        .eq('store_id', storeId)
        .gte('week_start_date', startDate)
        .order('order_date', { ascending: false })

    return {
        weeklyBases: allBases || [],
        dailyCounts: allCounts || [],
        orderHistory: orderHistory || []
    }
}
