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
 */

'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { addDays, getMonday } from './utils'
import type { OrderableItem, WeeklyBaseRecord, ParIdealRecord, CalculatedOrderLine } from './utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// ============================================================================
// HELPERS (private, not exported — no issue with 'use server')
// ============================================================================

/** Aplica la regla de redondeo de un item */
function applyRounding(value: number, rule: string): number {
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
export async function fetchOrderableItems(storeId: string | number) {
    // Items con excel_reference (= participan en órdenes)
    const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type, excel_reference, order_unit_description, order_rounding_rule, order_sort_position')
        .not('excel_reference', 'is', null)
        .order('order_sort_position', { ascending: true })

    if (itemsError) throw new Error(itemsError.message)

    // QB mappings para poder enviar Estimates
    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, inventory_item_id')

    const qbMap = new Map<string, string>()
    mappings?.forEach(m => qbMap.set(m.inventory_item_id, m.qb_item_id))

    return (items || []).map(item => ({
        ...item,
        order_rounding_rule: item.order_rounding_rule || 'none',
        order_sort_position: item.order_sort_position || 999,
        qb_item_id: qbMap.get(item.id)
    })) as OrderableItem[]
}

/**
 * Obtiene todos los items de inventario (para vincular los que no tienen excel_reference)
 */
export async function fetchAllInventoryItems() {
    const { data } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type, excel_reference')
        .order('name', { ascending: true })
    return data || []
}

/**
 * Datos completos para una semana: bases, sobrantes, PAR ideal, e historial de órdenes
 */
export async function fetchWeeklyData(storeId: string | number, mondayStr: string) {
    // Bases de esta semana
    const { data: bases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr)

    // PAR Ideal
    const { data: parIdeal } = await supabase
        .from('inventory_par_ideal')
        .select('*')
        .eq('store_id', storeId)

    // Sobrantes de esta semana + domingo de semana pasada (para cálculo del lunes)
    const lastWeekMonday = addDays(mondayStr, -7)
    const thisSunday = addDays(mondayStr, 6)

    const { data: counts } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId.toString())
        .gte('count_date', addDays(lastWeekMonday, 6)) // Solo domingo anterior
        .lte('count_date', thisSunday)

    // Órdenes de esta semana
    const { data: orders } = await supabase
        .from('inventory_orders')
        .select('*, inventory_order_lines(*)')
        .eq('store_id', storeId)
        .eq('week_start_date', mondayStr)
        .order('order_date', { ascending: true })

    // Mapear datos
    const basesMap: Record<string, WeeklyBaseRecord> = {}
    bases?.forEach((b: any) => { basesMap[b.inventory_item_id] = b })

    const parIdealMap: Record<string, ParIdealRecord> = {}
    parIdeal?.forEach((p: any) => { parIdealMap[p.inventory_item_id] = p })

    const countsMap: Record<string, Record<string, number>> = {}
    counts?.forEach((c: any) => {
        if (!countsMap[c.inventory_item_id]) countsMap[c.inventory_item_id] = {}
        countsMap[c.inventory_item_id][c.count_date] = c.quantity_on_hand
    })

    return {
        bases: basesMap,
        parIdeal: parIdealMap,
        counts: countsMap,
        orders: orders || [],
        currentMonday: mondayStr,
        lastSundayDate: addDays(lastWeekMonday, 6)
    }
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
    mondayStr: string
): Promise<CalculatedOrderLine[]> {
    const dayKey = getDayKey(dateStr)
    const dayIndex = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(dayKey)

    // Determinar el día siguiente y su PAR
    let nextDayBaseField: string
    if (dayKey === 'sun') {
        // Domingo: mañana es lunes de la PRÓXIMA semana
        nextDayBaseField = 'mon_par'
    } else {
        const nextKeys = ['tue_par', 'wed_par', 'thu_par', 'fri_par', 'sat_par', 'sun_par']
        nextDayBaseField = nextKeys[dayIndex]
    }

    const lines: CalculatedOrderLine[] = []

    for (const item of items) {
        const base = bases[item.id]
        if (!base) continue

        // PAR del día siguiente
        const parValue = (base as any)[nextDayBaseField] || 0

        // Sobrante de hoy
        const itemCounts = counts[item.id] || {}
        const leftoverValue = itemCounts[dateStr] ?? null

        // Calcular orden
        let calculatedQty = 0
        if (leftoverValue !== null) {
            calculatedQty = parValue - leftoverValue
            // Aplicar regla de redondeo
            if (calculatedQty > 0) {
                calculatedQty = applyRounding(calculatedQty, item.order_rounding_rule)
            }
        }

        lines.push({
            inventory_item_id: item.id,
            item_name: item.excel_reference || item.name,
            unit_description: item.order_unit_description || item.unit_type,
            par_value: parValue,
            leftover_value: leftoverValue,
            calculated_qty: calculatedQty,
            rounding_rule: item.order_rounding_rule,
            qb_item_id: item.qb_item_id,
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
            .match({ store_id: storeId, inventory_item_id: itemId, count_date: dateStr })
        if (error) console.error('Error deleting count:', error)
        return
    }

    const { error } = await supabase
        .from('inventory_counts')
        .upsert({
            store_id: storeId,
            inventory_item_id: itemId,
            count_date: dateStr,
            quantity_on_hand: value
        }, { onConflict: 'store_id, inventory_item_id, count_date' })

    if (error) console.error('Error update count:', error)
}

/** Clona las bases de la semana anterior a la semana objetivo */
export async function clonePreviousWeekBases(storeId: string | number, targetMonday: string) {
    const lastWeekMonday = addDays(targetMonday, -7)

    const { data: oldBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .eq('week_start_date', lastWeekMonday)

    if (!oldBases || oldBases.length === 0) {
        return { error: 'No se encontraron bases de la semana anterior.' }
    }

    const newBases = oldBases.map((b) => ({
        store_id: storeId,
        inventory_item_id: b.inventory_item_id,
        week_start_date: targetMonday,
        mon_par: b.mon_par, tue_par: b.tue_par, wed_par: b.wed_par,
        thu_par: b.thu_par, fri_par: b.fri_par, sat_par: b.sat_par, sun_par: b.sun_par
    }))

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(newBases, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (error) return { error: error.message }
    revalidatePath('/inventory/orders')
    return { success: true }
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
    createdBy?: string
) {
    // Upsert la orden
    const { data: order, error: orderError } = await supabase
        .from('inventory_orders')
        .upsert({
            store_id: storeId,
            order_date: orderDate,
            week_start_date: weekStartDate,
            status: 'draft',
            created_by: createdBy || 'Manager',
            updated_at: new Date().toISOString()
        }, { onConflict: 'store_id, order_date' })
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

/** Obtiene el historial de órdenes de una tienda */
export async function getOrderHistory(storeId: string | number, limit: number = 30) {
    const { data, error } = await supabase
        .from('inventory_orders')
        .select('*')
        .eq('store_id', storeId)
        .order('order_date', { ascending: false })
        .limit(limit)

    if (error) return { error: error.message, orders: [] }
    return { orders: data || [] }
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

    // 3. Clonar bases a la nueva semana
    const cloneResult = await clonePreviousWeekBases(storeId, nextMonday)
    if (cloneResult.error) {
        // Si no hay bases de la semana actual, intentar con PAR Ideal
        const parResult = await copyFromParIdeal(storeId, nextMonday)
        if (parResult.error) {
            return { error: 'No se pudieron crear bases para la nueva semana.' }
        }
    }

    // 4. Recalcular PAR Ideal (promedio de últimas 8 semanas)
    await recalculateParIdeal(storeId)

    revalidatePath('/inventory/orders')
    return { success: true, nextMonday }
}

/**
 * Recalcula el PAR Ideal promediando las bases de las últimas N semanas.
 */
export async function recalculateParIdeal(storeId: string | number, weeksBack: number = 8) {
    const today = new Date()
    const currentMonday = getMonday(today)
    const startDate = addDays(currentMonday, -(weeksBack * 7))

    // Obtener todas las bases de las últimas N semanas
    const { data: allBases } = await supabase
        .from('inventory_weekly_bases')
        .select('*')
        .eq('store_id', storeId)
        .gte('week_start_date', startDate)
        .lt('week_start_date', currentMonday) // No incluir la semana actual

    if (!allBases || allBases.length === 0) return

    // Agrupar por item y promediar
    const itemBases: Record<string, { count: number; sums: Record<string, number> }> = {}

    for (const b of allBases) {
        const key = b.inventory_item_id
        if (!itemBases[key]) {
            itemBases[key] = { count: 0, sums: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } }
        }
        itemBases[key].count++
        itemBases[key].sums.mon += Number(b.mon_par) || 0
        itemBases[key].sums.tue += Number(b.tue_par) || 0
        itemBases[key].sums.wed += Number(b.wed_par) || 0
        itemBases[key].sums.thu += Number(b.thu_par) || 0
        itemBases[key].sums.fri += Number(b.fri_par) || 0
        itemBases[key].sums.sat += Number(b.sat_par) || 0
        itemBases[key].sums.sun += Number(b.sun_par) || 0
    }

    // Upsert PAR Ideal
    const parRecords = Object.entries(itemBases).map(([itemId, data]) => ({
        store_id: storeId,
        inventory_item_id: itemId,
        mon_par: Math.round(data.sums.mon / data.count),
        tue_par: Math.round(data.sums.tue / data.count),
        wed_par: Math.round(data.sums.wed / data.count),
        thu_par: Math.round(data.sums.thu / data.count),
        fri_par: Math.round(data.sums.fri / data.count),
        sat_par: Math.round(data.sums.sat / data.count),
        sun_par: Math.round(data.sums.sun / data.count),
        calculated_from_weeks: data.count,
        updated_at: new Date().toISOString()
    }))

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
