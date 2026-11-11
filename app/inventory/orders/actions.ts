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
 * - [2026-09-25] Orden Diaria requiere conteo completo antes de guardar; cero explícito sí es válido.
 * - [2026-09-25] Piloto Lynwood: conteo ciego y snapshot shadow antes de revelar la comparación automática.
 * - [2026-09-26] El piloto se amplió a Slauson; cada manager cierra únicamente su sucursal y Roque conserva acceso global.
 * - [2026-09-26] Capturas históricas extremas no entran como entregas estimadas al sobrante automático.
 * - [2026-09-28] Pedido oficial = PAR mañana menos conteo físico, redondeado por empaque.
 *   Sin conteo no hay pedido oficial; sin consumo Toast no se inventa sobrante teórico.
 *   Una existencia teórica negativa se conserva para investigar la falta de movimientos.
 * - [2026-09-28] Piloto shadow: tickets reales Toast verificados en dos lecturas
 *   sustituyen el PMIX sintético para Lynwood; Slauson permanece sin teórico
 *   hasta versionar sus empaques. Una fuente incompleta nunca altera el pedido físico.
 * - [2026-10-01] Escrituras fail-closed: sesión y perfil de tienda obligatorios también en desarrollo.
 * - [2026-11-04] Blindaje de updateDailyLeftover: respuesta estructurada { success, error } en lugar de throw no capturado para evitar la censura de errores de Next.js en producción.
 * - [2026-11-09] Sincronización blindada de Orden de Uniformes → QuickBooks:
 *   * `assertUserStoreAccess` permite roles de piso autorizados (`manager`, `gerente`, `asistente`, `assistant`) con alcance estricto por sucursal.
 *   * `fetchWeeklyData` filtra `store_order_template` por `store_id` y garantiza `countsMap` (`d = -1..7`) sin valores `null` ni sobreescritura de PAR explícito en `0`.
 *   * `fetchOrderableItems` evita caer al catálogo diario de comida cuando `orderType` es `uniforms` o `liquids`.
 *   * `saveOrderDraft` rechaza cantidades finales negativas y preserva overrides explícitos `adjusted_qty = 0` para que `Generar Orden` → `Enviar a QuickBooks` nunca borre ajustes manuales.
 * - [2026-11-09] Arquitectura Dual de Orden Diaria (`dual-engine-v2`) para Lynwood (#14) y Slauson (#7):
 *   * `calculateDailyOrder` combina consumo por recetas de tickets Toast (`getPilotTicketUsage`) en los 32 SKU observables en POS con Balance de Masas Histórico causal (`getHistoricalMassBalanceUsage`) en los 19 SKU de autoservicio, salsabar y cocina, cubriendo los 51 productos sin ocultarlos detrás de `'-'`.
 *   * Corregida precedencia de `recentOrderError` y `unreliableArrivalItems` antes de calcular `suggestedLeftover`.
 *   * `finalizeInventoryPilotCount` recalcula en el servidor el sobrante teórico actualizado al momento exacto del cierre para evitar sesiones en `NULL` cuando el navegador cargó antes de estabilizarse Toast.
 * - [2026-11-10] Upgrades Integrales 1–4 rumbo al Cierre Asistido de Orden Diaria:
 *   * Upgrade 1: Aislamiento total de postres externos `TRACK_ONLY` (`Flan`, `Cheesecake`) para impedir pedidos o llegadas ficticias de Bodega.
 *   * Upgrade 2: Conciliación automática `QBO Invoice -> inventory_order_lines` (`reconcileStoreOrdersWithQbInvoices`) para reflejar recortes/ajustes reales de La Bodega Central.
 *   * Upgrade 3: Descongelamiento automático (>7 días) y modernización de `recalculateParIdeal` integrando pronóstico inteligente de ventas y clima (`generateSmartForecast` de `lib/intelligence.ts`) sin sobreescribir `PAR Actual`.
 *   * Upgrade 4 (Paso 3): Modo Operativo de 2 Niveles (`assisted_2tier` vs `shadow_blind`) con pre-llenado `AUTO_CYCLE_V2` de los 34 SKU estables (Lun–Sáb), auditoría física rápida de los 17 SKU críticos diarios y Ancla Física Dominical obligatoria.
 * - [2026-11-10] Modo Definitivo `'auto_order_visible'` en las 15 Sucursales Activas:
 *   * `calculateDailyOrder` ejecuta el motor dual (`dual-engine-v2` + conciliación `QBO Invoice` de 7 días + respaldo telescópico multi-día hasta 7 días para cierres dominicales o días sin conteo) en TODAS las sucursales activas con `external_id`.
 *   * Los 51 SKU muestran desde el segundo 1 tanto el sobrante calculado por el sistema como la Orden Calculada a QuickBooks (`effective_leftover` / `calculated_qty`), sin candados ciegos ni bloqueos obligatorios.
 *   * Regla de Oro ("Físico Manda"): si el asistente o manager captura su sobrante físico en cualquier ítem, ese conteo físico toma prioridad inmediata y absoluta (`100%`) sobre el cálculo del sistema; los ítems no editados manualmente se materializan de forma transparente como `AUTO_CYCLE_V2` en `saveOrderDraft` sin sobrescribir jamás un conteo físico humano ni generar deriva circular en el motor histórico.
 * - [2026-11-11] Blindajes adicionales tras auditoría forense multi-sucursal:
 *   * `calculateDailyOrder` excluye capturas accidentales de sábado (`getUTCDay() === 6`) como `anchorDate` en Orden Diaria para evitar restar doblemente el consumo del sábado en el cierre unificado del domingo (`Sáb+Dom`).
 *   * `fetchWeeklyData` y `finalizeInventoryPilotCount` completan por ítem las bases faltantes desde la semana previa o `PAR Ideal` cuando una semana futura tiene edición parcial (`1..N` filas), evitando que el resto del catálogo caiga en `PAR = 0`.
 */

'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import {
    addDays,
    getBusinessDate,
    getMonday,
    EXTERNAL_TRACK_ONLY_ITEM_IDS,
    isTrackOnlyOrderItem,
} from './utils'
import type { OrderableItem, WeeklyBaseRecord, ParIdealRecord, CalculatedOrderLine } from './utils'
import { parseUniformCategoryAndSize, getDefaultMinStock } from '../uniforms/utils'
import { getMissingDailyCounts } from '@/lib/inventory/order-count-validation'
import { getServerUser } from '@/lib/auth-server'
import { getPilotTicketUsage, type PilotTicketUsage } from '@/lib/inventory/pilot-ticket-usage'
import {
    getHistoricalMassBalanceUsage,
    isAutoCycleCountRecord,
    isHistoricalMassBalanceItem,
    isSeasonalBeverageMassBalanceItem,
    type HistoricalMassBalanceResult,
} from '@/lib/inventory/historical-mass-balance'
import {
    AUTO_CYCLE_COUNT_MARKER,
    buildPilotComparisonLine,
    canCloseInventoryAutomationPilot,
    canManageInventoryAutomationMode,
    getInventoryAutomationPilotStoreName,
    isCriticalDailyPhysicalSku,
    isExternalTrackOnlyDessert,
    isFullPhysicalAnchorDate,
    isInventoryAutomationPilotStore,
    isImplausibleArrivalQuantity,
    type InventoryAutomationMode,
    type PilotComparisonInput,
} from '@/lib/inventory/automation-pilot'
import { reconcileStoreOrdersWithQbInvoices } from '@/lib/inventory/qb-shipped-reconciliation'
import { recalculateStoreParIdeal } from '@/lib/inventory/par-ideal-engine'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

/** Tipos de orden soportados: diaria, líquidos, uniformes */
export type OrderType = 'daily' | 'liquids' | 'uniforms'

export type InventoryPilotSession = {
    enabled: boolean
    schemaReady: boolean
    status: 'counting' | 'revealed'
    storeName?: string | null
    sessionId?: string
    completedAt?: string | null
    completedBy?: string | null
    automationMode?: InventoryAutomationMode
    isSundayAnchor?: boolean
    canManageMode?: boolean
    lines: any[]
}

// ============================================================================
// HELPERS (private, not exported — no issue with 'use server')
// ============================================================================

/** Verifica la identidad del usuario y sus permisos sobre la tienda antes de mutar datos */
async function assertUserStoreAccess(storeId: string | number) {
    const user = await getServerUser()
    if (!user) {
        throw new Error('Sesión no válida o expirada. Por favor inicia sesión.')
    }

    const { data: userProfile, error: profileError } = await supabase
        .from('users')
        .select('role, store_id, store_scope')
        .eq('email', user.email)
        .maybeSingle()
    if (profileError || !userProfile) {
        throw new Error('No se pudo verificar tu perfil y sucursal. No se guardaron cambios.')
    }

    const profileRole = String(userProfile.role || '').trim().toLowerCase()
    if (profileRole === 'admin' || profileRole === 'supervisor') return user
    if (!['manager', 'gerente', 'asistente', 'assistant'].includes(profileRole)) {
        throw new Error('No tienes permiso para modificar pedidos.')
    }

    const profileScope = Array.isArray(userProfile.store_scope) ? userProfile.store_scope : []
    const assignedStores = [userProfile.store_id, ...profileScope]
        .filter(value => value !== null && value !== undefined).map(String)
    if (!assignedStores.includes(String(storeId))) {
        throw new Error('No tienes permiso para modificar datos de esta sucursal.')
    }
    return user
}

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

    if (result.length === 0 && orderType === 'daily') {
        // Fallback exclusivo de orden diaria: si no hay template, usar la lista global con excel_reference
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
    // y blindar cualquier coincidencia de postre externo para que jamás se envíe como item de Bodega
    if (orderType === 'daily') {
        result = result.map(r => (
            isTrackOnlyOrderItem(r)
                ? { ...r, qb_item_id: 'TRACK_ONLY' }
                : r
        ))

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
 * Obtiene todos los items de inventario (para vincular los que no tienen excel_reference y resolver metadatos en modales)
 */
export async function fetchAllInventoryItems() {
    const [{ data }, { data: mappings }] = await Promise.all([
        supabase
            .from('inventory_items')
            .select('id, name, unit_type, excel_reference, purchase_unit_cost, unit_measure, order_unit_description')
            .order('name', { ascending: true }),
        supabase
            .from('quickbooks_mappings')
            .select('inventory_item_id, qb_item_id')
    ])
    const qbMap = new Map<string, string>()
    mappings?.forEach(m => {
        if (m.inventory_item_id && m.qb_item_id) qbMap.set(m.inventory_item_id, m.qb_item_id)
    })
    return (data || []).map(item => ({
        ...item,
        qb_item_id: qbMap.get(item.id) || null
    }))
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
    await assertUserStoreAccess(storeId)
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

    // Bases de esta semana + semana anterior en paralelo para garantizar integridad en todos los orderType (daily, liquids, uniforms)
    const lastWeekMonday = addDays(mondayStr, -7)
    const [{ data: currBasesData }, { data: prevBases }] = await Promise.all([
        supabase
            .from('inventory_weekly_bases')
            .select('*')
            .eq('store_id', storeId)
            .eq('week_start_date', mondayStr),
        supabase
            .from('inventory_weekly_bases')
            .select('*')
            .eq('store_id', storeId)
            .eq('week_start_date', lastWeekMonday),
    ])
    let bases = currBasesData

    // Fix #3: Si la semana actual no tiene bases o solo tiene una edición parcial (ej. 1 ítem de uniformes/diario editado por adelantado),
    // auto-completar TODOS los ítems faltantes desde la semana anterior o PAR Ideal sin sobrescribir los ya guardados.
    let basesAreFallback = false
    const existingBaseIds = new Set((bases || []).map((b: any) => String(b.inventory_item_id)))
    const missingPrev = (prevBases || []).filter((b: any) => !existingBaseIds.has(String(b.inventory_item_id)))
    if (missingPrev.length > 0) {
        const clonedBases = missingPrev.map((b: any) => ({
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
        bases = [...(bases || []), ...missingPrev]
        basesAreFallback = existingBaseIds.size === 0
        console.log(`[fetchWeeklyData] Store ${storeId}: Auto-cloned ${missingPrev.length} missing bases from ${lastWeekMonday} → ${mondayStr}`)
    } else if (!bases || bases.length === 0) {
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

    // PAR Ideal (Baseline PAR) — auto-descongelamiento cuando lleva >7 días sin actualizarse
    let { data: parIdealRaw } = await supabase
        .from('inventory_par_ideal')
        .select('*')
        .eq('store_id', storeId)

    if (orderType === 'daily') {
        const latestParIdealMs = (parIdealRaw || []).reduce((maxMs: number, row: any) => {
            const ts = row?.updated_at ? Date.parse(String(row.updated_at)) : 0
            return Number.isFinite(ts) && ts > maxMs ? ts : maxMs
        }, 0)
        const isParIdealStale = !parIdealRaw || parIdealRaw.length === 0 || (Date.now() - latestParIdealMs > 7 * 86_400_000)
        if (isParIdealStale) {
            try {
                await recalculateStoreParIdeal(storeId, 4, mondayStr)
                const { data: refreshedParIdeal } = await supabase
                    .from('inventory_par_ideal')
                    .select('*')
                    .eq('store_id', storeId)
                if (refreshedParIdeal && refreshedParIdeal.length > 0) {
                    parIdealRaw = refreshedParIdeal
                }
            } catch (parErr: any) {
                console.warn(`[fetchWeeklyData] Auto-refresh de PAR Ideal omitido para tienda ${storeId}:`, parErr?.message || parErr)
            }
        }
    }

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

    // Sobrantes de esta semana + semana anterior completa (ventana de 14 días para respaldo telescópico multi-día)
    const lastWeekMondayForCounts = addDays(mondayStr, -7)
    const thisSunday = addDays(mondayStr, 6)

    const { data: counts } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId.toString())
        .gte('count_date', lastWeekMondayForCounts)
        .lte('count_date', thisSunday)
        .limit(2500)

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
    const countSourcesMap: Record<string, Record<string, 'manual' | 'auto_cycle_v2'>> = {}
    counts?.forEach((c: any) => {
        if (!countsMap[c.inventory_item_id]) countsMap[c.inventory_item_id] = {}
        if (!countSourcesMap[c.inventory_item_id]) countSourcesMap[c.inventory_item_id] = {}
        countsMap[c.inventory_item_id][c.count_date] = c.quantity_on_hand
        countSourcesMap[c.inventory_item_id][c.count_date] = isAutoCycleCountRecord({
            countedBy: c.counted_by,
            notes: c.notes,
        })
            ? 'auto_cycle_v2'
            : 'manual'
    })

    // Auto-sincronizar módulo de uniformes: PAR = Stock Mínimo, Sobrante = En Existencia Real
    if (orderType === 'uniforms') {
        const numericStoreId = typeof storeId === 'string' ? parseInt(storeId, 10) : storeId
        if (!isNaN(numericStoreId)) {
            const { data: uniformStock } = await supabase
                .from('uniforms_inventory_stock')
                .select('*')
                .eq('store_id', numericStoreId)

            let { data: templateItems } = await supabase
                .from('store_order_template')
                .select('inventory_item_id, inventory_items(name, excel_reference)')
                .eq('store_id', numericStoreId)
                .eq('order_type', 'uniforms')

            if (!templateItems || templateItems.length === 0) {
                const { data: fallbackTemplate } = await supabase
                    .from('store_order_template')
                    .select('inventory_item_id, inventory_items(name, excel_reference)')
                    .eq('order_type', 'uniforms')
                    .limit(200)
                const seen = new Set<string>()
                templateItems = (fallbackTemplate || []).filter(t => {
                    if (!t.inventory_item_id || seen.has(t.inventory_item_id)) return false
                    seen.add(t.inventory_item_id)
                    return true
                })
            }

            const stockMap = new Map<string, any>()
            uniformStock?.forEach(s => stockMap.set(`${s.item_category}_${s.size}`, s))

            templateItems?.forEach(t => {
                const itemId = t.inventory_item_id
                if (!itemId) return

                const itemObj = t.inventory_items as any
                const name = itemObj?.excel_reference || itemObj?.name || ''
                const { category, size } = parseUniformCategoryAndSize(name)

                let minStock = 0
                let quantityOnHand = 0
                if (category) {
                    const stockRow = stockMap.get(`${category}_${size}`)
                    const defaultMin = getDefaultMinStock(category, size)
                    minStock = (stockRow?.min_stock !== null && stockRow?.min_stock !== undefined) ? Number(stockRow.min_stock) : defaultMin
                    quantityOnHand = stockRow ? Number(stockRow.quantity_on_hand) || 0 : 0
                }

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
                } else if (basesMap[itemId].mon_par === null || basesMap[itemId].mon_par === undefined) {
                    // Respetar 0 explícito; solo rellenar cuando mon_par es null/undefined
                    basesMap[itemId].mon_par = minStock
                }

                // Sincronizar automáticamente el Sobrante con la existencia física (incluye domingo previo y lunes siguiente)
                if (!countsMap[itemId]) countsMap[itemId] = {}
                for (let d = -1; d <= 7; d++) {
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
        countSources: countSourcesMap,
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
    await assertUserStoreAccess(storeId)
    for (const base of basesList) {
        for (const key of ['mon_par', 'tue_par', 'wed_par', 'thu_par', 'fri_par', 'sat_par', 'sun_par'] as const) {
            const value = base[key]
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
                throw new Error('Cada PAR debe ser un número finito no negativo.')
            }
        }
    }
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
    await assertUserStoreAccess(storeId)
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
    nextWeekBases?: Record<string, WeeklyBaseRecord>,
    countSources?: Record<string, Record<string, 'manual' | 'auto_cycle_v2'>>,
    options?: { forceRefresh?: boolean }
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

    const MAX_TELESCOPIC_LOOKBACK_DAYS = 7
    const lookbackStartStr = addDays(dateStr, -MAX_TELESCOPIC_LOOKBACK_DAYS)

    let storeMode: InventoryAutomationMode = 'off'
    let useDualEngine = false

    if (orderType === 'daily') {
        const { data: store, error: storeError } = await supabase
            .from('stores')
            .select('id, name, external_id, inventory_automation_mode')
            .eq('id', storeId)
            .maybeSingle()
        if (storeError) throw new Error(`No se pudo identificar la sucursal: ${storeError.message}`)

        const rawMode = String((store as any)?.inventory_automation_mode || '')
        if (rawMode === 'auto_order_visible' || rawMode === 'assisted_2tier' || rawMode === 'shadow_blind' || rawMode === 'off') {
            storeMode = rawMode
        } else {
            storeMode = store?.external_id ? 'auto_order_visible' : 'off'
        }
        useDualEngine = Boolean(store?.external_id) && storeMode !== 'off'

        const ageDays = Math.max(0, Math.ceil((Date.now() - Date.parse(`${dateStr}T12:00:00Z`)) / 86_400_000))
        const dynamicLookback = Math.min(60, Math.max(7, ageDays + 7))
        try {
            await reconcileStoreOrdersWithQbInvoices({
                storeId: Number(storeId),
                lookbackDays: dynamicLookback,
                forceResync: Boolean(options?.forceRefresh),
            })
        } catch (qbRecErr: any) {
            console.warn(`[calculateDailyOrder] QBO Invoice check omitido (${dateStr}):`, qbRecErr?.message || qbRecErr)
        }
    }

    // 1. Resolver el ancla previa más reciente (A en [dateStr - 7, dateStr - 1]) por cada ítem
    //    Garantiza cierre exacto en domingos (ancla viernes -> resta consumo Sáb+Dom) y días sin conteo intermedio.
    const mergedPriorCounts: Record<string, Record<string, number>> = {}
    for (const item of items) {
        const src = counts[item.id]
        if (src) {
            mergedPriorCounts[item.id] = { ...src }
        }
    }

    if (orderType === 'daily') {
        const anyMissingAnchor = items.some(item => {
            const cMap = mergedPriorCounts[item.id]
            if (!cMap) return true
            const ib = bases[item.id]
            const maxPar = ib
                ? Math.max(
                    Number(ib.mon_par || 0),
                    Number(ib.tue_par || 0),
                    Number(ib.wed_par || 0),
                    Number(ib.thu_par || 0),
                    Number(ib.fri_par || 0),
                    Number(ib.sat_par || 0)
                )
                : 0
            for (let k = 1; k <= MAX_TELESCOPIC_LOOKBACK_DAYS; k++) {
                const d = addDays(dateStr, -k)
                if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) continue
                const v = cMap[d]
                if (v !== null && v !== undefined && Number.isFinite(Number(v))) {
                    const nv = Number(v)
                    const spiked =
                        !isTrackOnlyOrderItem(item) &&
                        maxPar > 0 &&
                        ((maxPar <= 3 && nv >= 8) || (maxPar > 3 && nv >= maxPar * 4 && nv - maxPar >= 12))
                    if (!spiked) return false
                }
            }
            return true
        })

        if (anyMissingAnchor) {
            const { data: fallbackPriorRows } = await supabase
                .from('inventory_counts')
                .select('inventory_item_id, count_date, quantity_on_hand')
                .eq('store_id', String(storeId))
                .gte('count_date', lookbackStartStr)
                .lt('count_date', dateStr)
                .limit(1000)

            fallbackPriorRows?.forEach((r: any) => {
                if (r.quantity_on_hand === null || r.quantity_on_hand === undefined) return
                const num = Number(r.quantity_on_hand)
                if (!Number.isFinite(num)) return
                if (!mergedPriorCounts[r.inventory_item_id]) mergedPriorCounts[r.inventory_item_id] = {}
                if (mergedPriorCounts[r.inventory_item_id][r.count_date] === undefined) {
                    mergedPriorCounts[r.inventory_item_id][r.count_date] = num
                }
            })
        }
    }

    const anchorByItemId = new Map<string, { anchorDate: string; anchorQty: number; spanDays: number }>()
    const neededUsageDatesSet = new Set<string>([dateStr])

    if (orderType === 'daily') {
        for (const item of items) {
            const cMap = mergedPriorCounts[item.id]
            if (!cMap) continue
            const ib = bases[item.id]
            const maxItemPar = ib
                ? Math.max(
                    Number(ib.mon_par || 0),
                    Number(ib.tue_par || 0),
                    Number(ib.wed_par || 0),
                    Number(ib.thu_par || 0),
                    Number(ib.fri_par || 0),
                    Number(ib.sat_par || 0)
                )
                : 0

            for (let k = 1; k <= MAX_TELESCOPIC_LOOKBACK_DAYS; k++) {
                const candidateDate = addDays(dateStr, -k)
                // Sábado no tiene cierre diario; ignorar capturas sabatinas accidentales para no restar doble el consumo de sábado en el domingo
                if (new Date(`${candidateDate}T12:00:00Z`).getUTCDay() === 6) continue
                const rawVal = cMap[candidateDate]
                if (rawVal !== null && rawVal !== undefined && Number.isFinite(Number(rawVal))) {
                    const numVal = Number(rawVal)
                    // Ignorar picos de error de unidad (ej. capturar 8 o 15 rebanadas sueltas en un ítem de PAR 1-3 paquetes) si existe un ancla previa limpia
                    const isUnitSpikeAnchor =
                        !isTrackOnlyOrderItem(item) &&
                        maxItemPar > 0 &&
                        ((maxItemPar <= 3 && numVal >= 8) || (maxItemPar > 3 && numVal >= maxItemPar * 4 && numVal - maxItemPar >= 12))
                    if (isUnitSpikeAnchor) {
                        const hasEarlierCleanAnchor = Array.from({ length: MAX_TELESCOPIC_LOOKBACK_DAYS - k }, (_, idx) => addDays(dateStr, -(k + 1 + idx)))
                            .some(d => {
                                if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) return false
                                const v = cMap[d]
                                if (v === null || v === undefined || !Number.isFinite(Number(v))) return false
                                const nv = Number(v)
                                return !((maxItemPar <= 3 && nv >= 8) || (maxItemPar > 3 && nv >= maxItemPar * 4 && nv - maxItemPar >= 12))
                            })
                        if (hasEarlierCleanAnchor) continue
                    }

                    anchorByItemId.set(item.id, {
                        anchorDate: candidateDate,
                        anchorQty: numVal,
                        spanDays: k,
                    })
                    for (let step = k - 1; step >= 0; step--) {
                        const candUsage = addDays(dateStr, -step)
                        const candDow = new Date(`${candUsage}T12:00:00Z`).getUTCDay()
                        // Sábado se concilia de forma unificada dentro del domingo (Sáb+Dom) en ambos motores
                        if (candDow === 6 && addDays(candUsage, 1) <= dateStr) continue
                        neededUsageDatesSet.add(candUsage)
                    }
                    break
                }
            }
        }
    }

    // 2. Calcular consumo dual por cada fecha necesaria en (anchorDate, dateStr]
    type DailyDualUsageBundle = {
        pilotUsage: PilotTicketUsage
        massBalanceUsage: HistoricalMassBalanceResult
        combinedMap: Map<string, number>
    }
    const dualUsageByDate = new Map<string, DailyDualUsageBundle>()
    const legacyUsageMap = new Map<string, number>()
    let theoreticalSource = 'legacy_pmix_unverified'

    if (useDualEngine) {
        const sortedUsageDates = Array.from(neededUsageDatesSet).sort()
        const bundles = await Promise.all(
            sortedUsageDates.map(async uDate => {
                const pUsage = await getPilotTicketUsage(Number(storeId), uDate, {
                    forceRefresh: Boolean(options?.forceRefresh && uDate === dateStr),
                })
                const mUsage = await getHistoricalMassBalanceUsage(
                    Number(storeId),
                    uDate,
                    items.map(it => ({ id: it.id, name: it.excel_reference || it.name })),
                    pUsage.sourceStatus !== 'unavailable' ? pUsage.tickets : undefined,
                    { forceRefresh: Boolean(options?.forceRefresh && uDate === dateStr) }
                )
                const combinedMap = new Map<string, number>()
                if (pUsage.sourceStatus !== 'unavailable') {
                    for (const [itemId, qty] of pUsage.usageByItemId) combinedMap.set(itemId, qty)
                }
                if (mUsage.status === 'ok') {
                    for (const [itemId, qty] of mUsage.usageByItemId) combinedMap.set(itemId, qty)
                }
                return { uDate, pilotUsage: pUsage, massBalanceUsage: mUsage, combinedMap }
            })
        )
        for (const b of bundles) {
            dualUsageByDate.set(b.uDate, {
                pilotUsage: b.pilotUsage,
                massBalanceUsage: b.massBalanceUsage,
                combinedMap: b.combinedMap,
            })
        }
        const todayBundle = dualUsageByDate.get(dateStr)
        if (todayBundle) {
            theoreticalSource = todayBundle.pilotUsage.sourceStatus !== 'unavailable'
                ? `${todayBundle.pilotUsage.sourceReason} | ${todayBundle.massBalanceUsage.reason}`
                : todayBundle.massBalanceUsage.status === 'ok'
                ? `${todayBundle.pilotUsage.sourceReason} | ${todayBundle.massBalanceUsage.reason}`
                : todayBundle.pilotUsage.sourceReason
        }
    } else if (orderType === 'daily') {
        const { data: usageLogData, error: usageError } = await supabase
            .from('inventory_usage_log')
            .select('inventory_item_id, theoretical_usage')
            .eq('store_id', storeId.toString())
            .eq('business_date', dateStr)
        if (usageError) throw new Error(`No se pudo leer consumo teórico: ${usageError.message}`)
        usageLogData?.forEach((u: any) => legacyUsageMap.set(u.inventory_item_id, Number(u.theoretical_usage) || 0))
    }

    // 3. Leer órdenes entregadas en [dateStr - 7, dateStr] para llegadas telescópicas y estado de envío de hoy
    let recentOrderError: { message: string } | null = null
    const arrivedByOrderDate = new Map<string, Map<string, number>>()
    const unreliableArrivalByOrderDate = new Map<string, Set<string>>()
    let hasSentOrderToday = false

    const trackOnlyIdsInCatalog = new Set(
        items.filter(it => orderType === 'daily' && isTrackOnlyOrderItem(it)).map(it => it.id)
    )

    if (orderType === 'daily') {
        const { data: recentOrderLines, error: orderErr } = await supabase
            .from('inventory_order_lines')
            .select('inventory_item_id, final_qty, adjusted_qty, calculated_qty, par_value, order_id, inventory_orders!inner(order_date, store_id, order_type, status)')
            .eq('inventory_orders.store_id', storeId)
            .gte('inventory_orders.order_date', lookbackStartStr)
            .lte('inventory_orders.order_date', dateStr)
            .eq('inventory_orders.order_type', 'daily')
            .in('inventory_orders.status', ['sent', 'received'])

        if (orderErr) {
            recentOrderError = { message: orderErr.message }
        } else {
            recentOrderLines?.forEach((l: any) => {
                const ordObj = Array.isArray(l.inventory_orders) ? l.inventory_orders[0] : l.inventory_orders
                const ordDate = String(ordObj?.order_date || '')
                if (!ordDate) return
                if (ordDate === dateStr) {
                    hasSentOrderToday = true
                    return
                }
                const lineItemId = String(l.inventory_item_id || '')
                if (
                    EXTERNAL_TRACK_ONLY_ITEM_IDS.has(lineItemId) ||
                    trackOnlyIdsInCatalog.has(lineItemId) ||
                    isExternalTrackOnlyDessert({ inventory_item_id: lineItemId })
                ) {
                    return
                }
                const qty = Number(l.final_qty ?? l.adjusted_qty ?? l.calculated_qty ?? 0)
                if (isImplausibleArrivalQuantity(qty, Number(l.par_value), Number(l.calculated_qty))) {
                    if (!unreliableArrivalByOrderDate.has(ordDate)) unreliableArrivalByOrderDate.set(ordDate, new Set())
                    unreliableArrivalByOrderDate.get(ordDate)!.add(lineItemId)
                    return
                }
                if (!arrivedByOrderDate.has(ordDate)) arrivedByOrderDate.set(ordDate, new Map())
                const dayArrivals = arrivedByOrderDate.get(ordDate)!
                dayArrivals.set(lineItemId, (dayArrivals.get(lineItemId) || 0) + qty)
            })
        }
    }

    const todayDualBundle = dualUsageByDate.get(dateStr) || null
    const lines: CalculatedOrderLine[] = []

    for (const item of items) {
        const isTrackOnly = orderType === 'daily' && isTrackOnlyOrderItem(item)
        const isCritical = isCriticalDailyPhysicalSku(item)

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

        // Sobrante de hoy en DB
        const itemCounts = counts[item.id] || {}
        const leftoverValue = itemCounts[dateStr] ?? null
        const countSource = countSources?.[item.id]?.[dateStr] ?? (leftoverValue !== null ? 'manual' : null)

        const usesMassBalance = Boolean(useDualEngine && isHistoricalMassBalanceItem(item))
        const anchor = anchorByItemId.get(item.id) || null

        let arrivedSinceAnchor = 0
        let spanTheoreticalUsage: number | null = null
        let itemTheoreticalBlocked = false
        let hasUnreliableArrivalInSpan = false

        if (orderType === 'daily') {
            if (useDualEngine && anchor) {
                let totalUsage = 0
                for (let offset = 0; offset < anchor.spanDays; offset++) {
                    const orderD = addDays(anchor.anchorDate, offset) // [anchorDate .. dateStr - 1]
                    if (!isTrackOnly) {
                        if (unreliableArrivalByOrderDate.get(orderD)?.has(item.id)) {
                            hasUnreliableArrivalInSpan = true
                        }
                        arrivedSinceAnchor += arrivedByOrderDate.get(orderD)?.get(item.id) || 0
                    }

                    const usageD = addDays(anchor.anchorDate, offset + 1) // [anchorDate + 1 .. dateStr]
                    const usageDow = new Date(`${usageD}T12:00:00Z`).getUTCDay()
                    // El cierre dominical en getPilotTicketUsage y getHistoricalMassBalanceUsage ya integra Sáb+Dom
                    if (usageDow === 6 && addDays(usageD, 1) <= dateStr) {
                        continue
                    }
                    const bundle = dualUsageByDate.get(usageD)
                    const posVerifiedForItem = Boolean(
                        bundle &&
                        !usesMassBalance &&
                        bundle.pilotUsage.sourceStatus !== 'unavailable' &&
                        !bundle.pilotUsage.allItemsBlocked &&
                        !bundle.pilotUsage.blockedItemIds.has(item.id)
                    )
                    const rawDayUsage = bundle?.combinedMap.get(item.id)
                    const dayItemUsage = rawDayUsage !== undefined
                        ? rawDayUsage
                        : (posVerifiedForItem ? 0 : null)
                    const dayBlocked = !bundle || (
                        usesMassBalance
                            ? (bundle.massBalanceUsage.status === 'unavailable' && bundle.pilotUsage.sourceStatus === 'unavailable') || dayItemUsage === null
                            : !posVerifiedForItem || dayItemUsage === null
                    )
                    if (dayBlocked || dayItemUsage === null) {
                        itemTheoreticalBlocked = true
                    } else {
                        totalUsage += dayItemUsage
                    }
                }
                spanTheoreticalUsage = itemTheoreticalBlocked ? null : Number(totalUsage.toFixed(4))
            } else if (useDualEngine && !anchor) {
                const todayUsageVal = todayDualBundle?.combinedMap.get(item.id) ?? null
                spanTheoreticalUsage = todayUsageVal !== null ? Number(todayUsageVal.toFixed(4)) : null
                const prevDay = addDays(dateStr, -1)
                arrivedSinceAnchor = isTrackOnly ? 0 : (arrivedByOrderDate.get(prevDay)?.get(item.id) || 0)
            } else {
                const prevDay = addDays(dateStr, dayKey === 'sun' ? -2 : -1)
                arrivedSinceAnchor = isTrackOnly ? 0 : (arrivedByOrderDate.get(prevDay)?.get(item.id) || 0)
                hasUnreliableArrivalInSpan = !isTrackOnly && Boolean(unreliableArrivalByOrderDate.get(prevDay)?.has(item.id))
                spanTheoreticalUsage = legacyUsageMap.get(item.id) ?? null
            }
        }

        let rawSuggestedLeftover: number | null = null
        let suggestedLeftover: number | null = null

        if (
            orderType === 'daily' &&
            !recentOrderError &&
            !itemTheoreticalBlocked &&
            !hasUnreliableArrivalInSpan &&
            anchor !== null &&
            spanTheoreticalUsage !== null
        ) {
            // Ley Telescópica de Conservación de Masa:
            // Sobrante(T) = Sobrante(A) + Sum_{d=A..T-1} Llegadas(d) - Sum_{d=A+1..T} Consumo(d)
            const rawCalc = anchor.anchorQty + arrivedSinceAnchor - spanTheoreticalUsage
            rawSuggestedLeftover = Number(rawCalc.toFixed(2))
            // Piso físico 0 para cálculo de orden: evita pedir más que el PAR completo cuando hubo sobre-porcionado
            suggestedLeftover = Number(Math.max(0, rawCalc).toFixed(1))
        }

        // Regla A3 ("Físico Manda"):
        // 1) Si el asistente o manager capturó conteo físico ('manual'), su número manda al 100%.
        // 2) Si fue materializado automáticamente ('auto_cycle_v2'), refresca en vivo mientras no se haya enviado a QB.
        // 3) Si aún no hay captura en DB y el modo es 'auto_order_visible', la orden ya viene lista con suggestedLeftover.
        let effectiveLeftover: number | null = null
        let effectiveSource: 'manual' | 'auto_cycle_v2' | 'system_auto' | null = null

        if (leftoverValue !== null && countSource === 'manual') {
            effectiveLeftover = leftoverValue
            effectiveSource = 'manual'
        } else if (leftoverValue !== null && countSource === 'auto_cycle_v2') {
            effectiveLeftover = (storeMode === 'auto_order_visible' && !hasSentOrderToday && suggestedLeftover !== null)
                ? suggestedLeftover
                : leftoverValue
            effectiveSource = 'auto_cycle_v2'
        } else if (orderType === 'daily' && storeMode === 'auto_order_visible' && suggestedLeftover !== null) {
            effectiveLeftover = suggestedLeftover
            effectiveSource = 'system_auto'
        }

        // Calcular varianza y tolerancia en vivo cuando existe conteo en DB
        let variance: number | null = null
        let toleranceValue: number | null = null
        let withinTolerance: boolean | null = null
        if (suggestedLeftover !== null && leftoverValue !== null) {
            const comp = buildPilotComparisonLine({
                inventory_item_id: item.id,
                item_name: item.excel_reference || item.name,
                physical_leftover: leftoverValue,
                automatic_leftover: suggestedLeftover,
                par_value: parValue,
                rounding_rule: item.order_rounding_rule,
            })
            variance = Number((leftoverValue - suggestedLeftover).toFixed(2))
            toleranceValue = comp.tolerance_value
            withinTolerance = comp.within_tolerance
        }

        // Los postres externos TRACK_ONLY jamás generan pedido a La Bodega (siempre 0).
        const effectiveOrderBase = effectiveLeftover === null ? null : Math.max(0, parValue - effectiveLeftover)
        const calculatedQty = isTrackOnly
            ? 0
            : (effectiveOrderBase === null ? 0 : applyRounding(effectiveOrderBase, item.order_rounding_rule))
        const suggestedBase = suggestedLeftover === null ? null : Math.max(0, parValue - suggestedLeftover)
        const suggestedOrderQty = isTrackOnly
            ? 0
            : (suggestedBase === null ? undefined : applyRounding(suggestedBase, item.order_rounding_rule))

        lines.push({
            inventory_item_id: item.id,
            item_name: item.excel_reference || item.name,
            unit_description: item.order_unit_description || item.unit_type,
            par_value: parValue,
            par_ideal_value: itemParIdeal,
            leftover_value: leftoverValue,
            suggested_leftover: suggestedLeftover,
            raw_suggested_leftover: rawSuggestedLeftover,
            effective_leftover: effectiveLeftover,
            effective_source: effectiveSource,
            is_burn_rate: Boolean(usesMassBalance && todayDualBundle?.massBalanceUsage.usageByItemId.has(item.id)),
            variance: variance,
            tolerance_value: toleranceValue,
            within_tolerance: withinTolerance,
            calculated_qty: calculatedQty,
            suggested_order_qty: suggestedOrderQty,
            rounding_rule: item.order_rounding_rule,
            qb_item_id: isTrackOnly ? 'TRACK_ONLY' : item.qb_item_id,
            purchase_unit_cost: item.purchase_unit_cost,
            unit_measure: item.unit_measure,
            theoretical_consumption: spanTheoreticalUsage,
            yesterday_order_qty: arrivedSinceAnchor,
            theoretical_source_status: itemTheoreticalBlocked || recentOrderError
                ? 'not_certified'
                : useDualEngine
                ? 'verified_dual_engine_v2'
                : 'legacy_pmix_unverified',
            theoretical_source_reason: recentOrderError?.message || theoreticalSource,
            sku_tier: isCritical ? 'critical_daily' : 'cycle_stable',
            count_source: countSource,
        })
    }

    return lines
}

/**
 * Lee el estado operativo de automatización de Orden Diaria en las 15 sucursales activas
 * ('auto_order_visible', 'assisted_2tier', 'shadow_blind', 'off').
 * Si la migración aún no fue aplicada, informa schemaReady=false sin romper el módulo existente.
 */
export async function fetchInventoryPilotSession(
    storeId: string | number,
    businessDate: string,
    orderType: OrderType = 'daily'
): Promise<InventoryPilotSession> {
    if (orderType !== 'daily') {
        return { enabled: false, schemaReady: true, status: 'counting', automationMode: 'off', lines: [] }
    }

    const { data: store, error: storeError } = await supabase
        .from('stores')
        .select('id, name, external_id, inventory_automation_mode')
        .eq('id', storeId)
        .maybeSingle()
    if (storeError) throw new Error(storeError.message)

    const hasActiveToastStore = Boolean(store?.external_id) || isInventoryAutomationPilotStore(store?.name)
    if (!hasActiveToastStore) {
        return { enabled: false, schemaReady: true, status: 'counting', automationMode: 'off', lines: [] }
    }

    const displayStoreName = getInventoryAutomationPilotStoreName(store?.name) || store?.name || null
    const rawMode = String((store as any)?.inventory_automation_mode || '')
    const automationMode: InventoryAutomationMode =
        rawMode === 'auto_order_visible' || rawMode === 'assisted_2tier' || rawMode === 'shadow_blind' || rawMode === 'off'
            ? rawMode
            : 'auto_order_visible'
    const isSundayAnchor = isFullPhysicalAnchorDate(businessDate)

    let canManageMode = false
    try {
        const user = await getServerUser()
        if (user) {
            const { data: userProfile } = await supabase
                .from('users')
                .select('*')
                .ilike('email', user.email)
                .maybeSingle()
            canManageMode = canManageInventoryAutomationMode({
                userName: (userProfile as any)?.full_name || (userProfile as any)?.name || user.name,
                userEmail: user.email,
                userRole: (userProfile as any)?.role || user.role,
            })
        }
    } catch {
        canManageMode = false
    }

    if (automationMode === 'off') {
        return {
            enabled: canManageMode,
            schemaReady: true,
            status: 'revealed',
            storeName: displayStoreName,
            automationMode: 'off',
            isSundayAnchor,
            canManageMode,
            lines: [],
        }
    }

    const { data: session, error } = await supabase
        .from('inventory_automation_pilot_sessions')
        .select('id, status, completed_at, completed_by_name, inventory_automation_pilot_lines(*)')
        .eq('store_id', storeId)
        .eq('business_date', businessDate)
        .eq('order_type', 'daily')
        .maybeSingle()

    if (error) {
        const missingSchema = error.code === '42P01' || /does not exist|schema cache/i.test(error.message)
        if (missingSchema) {
            return {
                enabled: true,
                schemaReady: false,
                status: automationMode === 'auto_order_visible' ? 'revealed' : 'counting',
                storeName: displayStoreName,
                automationMode,
                isSundayAnchor,
                canManageMode,
                lines: [],
            }
        }
        throw new Error(error.message)
    }

    const resolvedStatus: 'counting' | 'revealed' =
        automationMode === 'auto_order_visible'
            ? 'revealed'
            : session?.status === 'revealed'
            ? 'revealed'
            : 'counting'

    return {
        enabled: true,
        schemaReady: true,
        status: resolvedStatus,
        storeName: displayStoreName,
        sessionId: session?.id,
        completedAt: session?.completed_at,
        completedBy: session?.completed_by_name,
        automationMode,
        isSundayAnchor,
        canManageMode,
        lines: (session?.inventory_automation_pilot_lines as any[]) || [],
    }
}

/** Cierra el conteo y persiste el comparativo de precisión física vs cálculo automático. */
export async function finalizeInventoryPilotCount(
    storeId: string | number,
    businessDate: string,
    rawLines: PilotComparisonInput[]
) {
    const user = await getServerUser()
    if (!user) return { error: 'Sesión no válida. Vuelve a iniciar sesión.' }

    const { data: userProfile } = await supabase
        .from('users')
        .select('*')
        .ilike('email', user.email)
        .maybeSingle()
    const authenticatedName = (userProfile as any)?.full_name || (userProfile as any)?.name || user.name
    const { data: store, error: storeError } = await supabase
        .from('stores').select('id, name, external_id, inventory_automation_mode').eq('id', storeId).single()
    if (storeError || !store || (!store.external_id && !isInventoryAutomationPilotStore(store.name))) {
        return { error: 'Sucursal no habilitada para comparación automática.' }
    }

    const profileRole = String((userProfile as any)?.role || user.role || '').trim().toLowerCase()
    const profileScope = Array.isArray((userProfile as any)?.store_scope) ? (userProfile as any).store_scope : []
    const assignedStoreIds = [
        (userProfile as any)?.store_id,
        ...profileScope,
    ].filter(value => value !== null && value !== undefined)

    const canClosePilot = canCloseInventoryAutomationPilot({
        storeName: store.name,
        targetStoreId: store.id,
        userName: authenticatedName,
        userEmail: user.email,
        userRole: profileRole,
        assignedStoreIds,
    })
    if (!canClosePilot) {
        return { error: `Solo el manager o asistente asignado a ${store.name} o Administración puede cerrar este comparativo.` }
    }

    const missing = await getMissingDailyCounts(supabase, storeId, businessDate)
    if (missing.length) {
        return { error: `Faltan ${missing.length} conteos antes de comparar: ${missing.map(i => i.name).join(', ')}` }
    }

    const { data: storedCounts, error: countError } = await supabase
        .from('inventory_counts')
        .select('inventory_item_id, quantity_on_hand')
        .eq('store_id', String(storeId))
        .eq('count_date', businessDate)
    if (countError) return { error: countError.message }

    const countMap = new Map((storedCounts || []).map(row => [row.inventory_item_id, Number(row.quantity_on_hand)]))
    const uniqueLines = new Map<string, PilotComparisonInput>()
    for (const line of rawLines) uniqueLines.set(line.inventory_item_id, line)

    for (const line of uniqueLines.values()) {
        const stored = countMap.get(line.inventory_item_id)
        if (stored === undefined || stored !== Number(line.physical_leftover)) {
            return { error: `El conteo de ${line.item_name} cambió mientras se cerraba. Recarga y vuelve a intentar.` }
        }
    }

    // Recálculo autoritativo en el servidor al instante de guardar el comparativo:
    // evita que un estado inicial obsoleto o NULL del navegador se persista en la sesión.
    let serverLineMap = new Map<string, CalculatedOrderLine>()
    try {
        const lookbackStartStr = addDays(businessDate, -7)
        const mondayStr = getMonday(businessDate)
        const prevMondayStr = addDays(mondayStr, -7)
        const nextMondayStr = addDays(mondayStr, 7)

        const [
            orderableItems,
            { data: openingCounts },
            { data: currBases },
            { data: prevBases },
            { data: nextBases },
            { data: idealBases },
        ] = await Promise.all([
            fetchOrderableItems(store.id, 'daily'),
            supabase
                .from('inventory_counts')
                .select('inventory_item_id, count_date, quantity_on_hand')
                .eq('store_id', String(store.id))
                .gte('count_date', lookbackStartStr)
                .lt('count_date', businessDate)
                .limit(1000),
            supabase
                .from('inventory_weekly_bases')
                .select('*')
                .eq('store_id', store.id)
                .eq('week_start_date', mondayStr),
            supabase
                .from('inventory_weekly_bases')
                .select('*')
                .eq('store_id', store.id)
                .eq('week_start_date', prevMondayStr),
            supabase
                .from('inventory_weekly_bases')
                .select('*')
                .eq('store_id', store.id)
                .eq('week_start_date', nextMondayStr),
            supabase
                .from('inventory_par_ideal')
                .select('*')
                .eq('store_id', store.id),
        ])

        const countsForCalc: Record<string, Record<string, number>> = {}
        for (const row of openingCounts || []) {
            if (!countsForCalc[row.inventory_item_id]) countsForCalc[row.inventory_item_id] = {}
            countsForCalc[row.inventory_item_id][row.count_date] = Number(row.quantity_on_hand)
        }
        for (const [itemId, qty] of countMap.entries()) {
            if (!countsForCalc[itemId]) countsForCalc[itemId] = {}
            countsForCalc[itemId][businessDate] = qty
        }

        const basesMap: Record<string, WeeklyBaseRecord> = {}
        for (const b of (idealBases || []) as any[]) {
            basesMap[b.inventory_item_id] = b
        }
        for (const b of (prevBases || []) as any[]) {
            basesMap[b.inventory_item_id] = b
        }
        for (const b of (currBases || []) as any[]) {
            basesMap[b.inventory_item_id] = b
        }
        const nextBasesMap: Record<string, WeeklyBaseRecord> = {}
        for (const b of (nextBases || []) as any[]) {
            nextBasesMap[b.inventory_item_id] = b
        }

        const freshServerLines = await calculateDailyOrder(
            store.id,
            businessDate,
            orderableItems,
            basesMap,
            countsForCalc,
            mondayStr,
            undefined,
            'auto',
            0,
            'daily',
            nextBasesMap
        )
        serverLineMap = new Map(freshServerLines.map(l => [l.inventory_item_id, l]))
    } catch (recalcErr: any) {
        console.error(`[finalizeInventoryPilotCount] Fallback a líneas cliente tras error en recálculo servidor:`, recalcErr?.message || recalcErr)
    }

    const rawMode = String((store as any)?.inventory_automation_mode || 'auto_order_visible')
    const effectiveAutomationMode: InventoryAutomationMode =
        rawMode === 'auto_order_visible' || rawMode === 'assisted_2tier' || rawMode === 'shadow_blind' || rawMode === 'off'
            ? rawMode
            : 'auto_order_visible'
    const sessionModelVersion =
        effectiveAutomationMode === 'auto_order_visible'
            ? 'auto-order-visible-v3'
            : effectiveAutomationMode === 'assisted_2tier' && !isFullPhysicalAnchorDate(businessDate)
            ? 'assisted-2tier-v2'
            : 'dual-engine-v2'

    const now = new Date().toISOString()
    const { data: session, error: sessionError } = await supabase
        .from('inventory_automation_pilot_sessions')
        .upsert({
            store_id: storeId,
            business_date: businessDate,
            order_type: 'daily',
            status: 'revealed',
            model_version: sessionModelVersion,
            completed_by_user_id: String(user.id),
            completed_by_name: authenticatedName,
            completed_at: now,
            updated_at: now,
        }, { onConflict: 'store_id,business_date,order_type' })
        .select('id')
        .single()

    if (sessionError || !session) {
        return { error: sessionError?.message || 'No se pudo guardar la sesión del piloto.' }
    }

    const comparisons = [...uniqueLines.values()].map(line => {
        const serverLine = serverLineMap.get(line.inventory_item_id)
        return buildPilotComparisonLine({
            ...line,
            automatic_leftover: serverLine?.suggested_leftover ?? line.automatic_leftover ?? null,
            par_value: serverLine ? serverLine.par_value : line.par_value,
            rounding_rule: serverLine?.rounding_rule || line.rounding_rule,
        })
    })
    const payload = comparisons.map(line => ({
        session_id: session.id,
        inventory_item_id: line.inventory_item_id,
        item_name: line.item_name,
        physical_leftover: line.physical_leftover,
        automatic_leftover: line.automatic_leftover,
        variance: line.variance,
        tolerance_value: line.tolerance_value,
        within_tolerance: line.within_tolerance,
        par_value: line.par_value,
        automatic_order_qty: line.automatic_order_qty,
        official_order_qty: line.official_order_qty,
        updated_at: now,
    }))

    const { error: linesError } = await supabase
        .from('inventory_automation_pilot_lines')
        .upsert(payload, { onConflict: 'session_id,inventory_item_id' })
    if (linesError) return { error: linesError.message }

    revalidatePath('/inventory/orders')
    return { success: true, sessionId: session.id, comparisons }
}

/**
 * Cambia el modo operativo de automatización de Orden Diaria en una sucursal
 * ('auto_order_visible', 'assisted_2tier', 'shadow_blind', 'off').
 * Restringido a Administración, Roque y Carlos Velázquez.
 */
export async function setStoreInventoryAutomationMode(
    storeId: string | number,
    mode: InventoryAutomationMode
): Promise<{ success: boolean; mode?: InventoryAutomationMode; error?: string }> {
    try {
        const user = await assertUserStoreAccess(storeId)
        if (!['off', 'shadow_blind', 'assisted_2tier', 'auto_order_visible'].includes(mode)) {
            return { success: false, error: 'Modo de automatización inválido.' }
        }

        const { data: userProfile } = await supabase
            .from('users')
            .select('*')
            .ilike('email', user.email)
            .maybeSingle()

        const allowed = canManageInventoryAutomationMode({
            userRole: (userProfile as any)?.role || user.role,
            userName: (userProfile as any)?.full_name || (userProfile as any)?.name || user.name,
            userEmail: user.email,
        })
        if (!allowed) {
            return {
                success: false,
                error: 'Solo Administración, Roque o Carlos Velázquez pueden cambiar el modo operativo.',
            }
        }

        const { error: updateErr } = await supabase
            .from('stores')
            .update({ inventory_automation_mode: mode })
            .eq('id', storeId)

        if (updateErr) {
            return { success: false, error: `No se pudo cambiar el modo: ${updateErr.message}` }
        }

        revalidatePath('/inventory/orders')
        return { success: true, mode }
    } catch (err: any) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Error al actualizar el modo operativo',
        }
    }
}

/**
 * Pre-llena automáticamente en `inventory_counts` con `counted_by = 'AUTO_CYCLE_V2'`
 * sin sobrescribir jamás conteos físicos manuales (`count_source === 'manual'`):
 * - En `'assisted_2tier'`: pre-llena los 34 insumos estables (`cycle_stable`) de Lun–Vie.
 * - En `'auto_order_visible'`: permite estampar opcionalmente en un clic los ítems aún vacíos.
 */
export async function applyAssistedCycleCountPrefill(
    storeId: string | number,
    businessDate: string
): Promise<{
    success: boolean
    prefilledCount?: number
    skippedAnomalyCount?: number
    criticalRemainingCount?: number
    error?: string
}> {
    try {
        await assertUserStoreAccess(storeId)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
            return { success: false, error: 'Fecha operativa inválida.' }
        }

        const { data: store, error: storeErr } = await supabase
            .from('stores')
            .select('id, name, external_id, inventory_automation_mode')
            .eq('id', storeId)
            .maybeSingle()

        if (storeErr || !store) {
            return { success: false, error: storeErr?.message || 'Sucursal no encontrada.' }
        }
        if (!store.external_id && !isInventoryAutomationPilotStore(store.name)) {
            return { success: false, error: 'Esta sucursal no tiene integración Toast activa.' }
        }

        const mode = String((store as any).inventory_automation_mode || 'auto_order_visible')
        if (mode !== 'assisted_2tier' && mode !== 'auto_order_visible') {
            return { success: false, error: 'Activa el Modo Orden Automática Visible o Asistido 2 Niveles para usar esta función.' }
        }
        if (mode === 'assisted_2tier' && isFullPhysicalAnchorDate(businessDate)) {
            return {
                success: false,
                error: 'Hoy es Domingo de Ancla Física: los 51 productos requieren conteo físico completo para reiniciar el ciclo.',
            }
        }
        const utcDow = new Date(`${businessDate}T12:00:00Z`).getUTCDay()
        if (mode === 'assisted_2tier' && utcDow === 6) {
            return {
                success: false,
                error: 'El sábado no lleva Orden Diaria a Bodega (PAR de domingo = 0).',
            }
        }

        const mondayStr = getMonday(businessDate)
        const [orderableItems, weekData] = await Promise.all([
            fetchOrderableItems(storeId, 'daily'),
            fetchWeeklyData(storeId, mondayStr, 'daily'),
        ])

        const serverLines = await calculateDailyOrder(
            storeId,
            businessDate,
            orderableItems,
            weekData.bases,
            weekData.counts,
            mondayStr,
            weekData.parIdeal,
            'auto',
            0,
            'daily',
            weekData.nextWeekBases,
            weekData.countSources
        )

        const upsertRows: Array<{
            store_id: string
            inventory_item_id: string
            count_date: string
            quantity_on_hand: number
            counted_by: string
            notes: string
        }> = []
        let skippedAnomalyCount = 0
        let criticalRemainingCount = 0

        for (const line of serverLines) {
            if (mode === 'assisted_2tier') {
                if (line.sku_tier === 'critical_daily') {
                    if (line.leftover_value === null) criticalRemainingCount++
                    continue
                }
                if (isTrackOnlyOrderItem(line)) continue
            }
            // REGLA DE ORO: Respetar SIEMPRE cualquier conteo físico manual ya capturado
            if (line.leftover_value !== null && line.count_source === 'manual') continue

            const suggestedVal = line.suggested_leftover
            if (
                suggestedVal === null ||
                suggestedVal === undefined ||
                !Number.isFinite(suggestedVal)
            ) {
                skippedAnomalyCount++
                continue
            }

            const prefillQty = Math.max(0, Number(suggestedVal.toFixed(1)))
            upsertRows.push({
                store_id: String(storeId),
                inventory_item_id: line.inventory_item_id,
                count_date: businessDate,
                quantity_on_hand: prefillQty,
                counted_by: AUTO_CYCLE_COUNT_MARKER,
                notes: 'auto_cycle_v2',
            })
        }

        if (upsertRows.length > 0) {
            const { error: upsertErr } = await supabase
                .from('inventory_counts')
                .upsert(upsertRows, { onConflict: 'store_id, inventory_item_id, count_date' })

            if (upsertErr) {
                return { success: false, error: `No se pudo guardar el pre-llenado: ${upsertErr.message}` }
            }
        }

        revalidatePath('/inventory/orders')
        return {
            success: true,
            prefilledCount: upsertRows.length,
            skippedAnomalyCount,
            criticalRemainingCount,
        }
    } catch (err: any) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Error al ejecutar pre-llenado asistido',
        }
    }
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
    await assertUserStoreAccess(storeId)
    if (!['mon_par', 'tue_par', 'wed_par', 'thu_par', 'fri_par', 'sat_par', 'sun_par'].includes(field)) {
        throw new Error('Campo PAR no permitido.')
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('El PAR debe ser un número finito no negativo.')
    }
    const payload: any = {
        store_id: storeId,
        inventory_item_id: itemId,
        week_start_date: mondayStr
    }
    payload[field] = value

    const { error } = await supabase
        .from('inventory_weekly_bases')
        .upsert(payload, { onConflict: 'store_id, inventory_item_id, week_start_date' })

    if (error) throw new Error(`No se pudo guardar el PAR: ${error.message}`)
}

/** Actualiza o elimina un sobrante diario con respuesta estructurada para evitar censura en producción */
export async function updateDailyLeftover(
    storeId: string | number,
    itemId: string,
    dateStr: string,
    value: number | null
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await assertUserStoreAccess(storeId)
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
            return { success: false, error: 'El sobrante debe ser un número finito no negativo.' }
        }
        if (value === null) {
            const { error } = await supabase
                .from('inventory_counts')
                .delete()
                .match({ store_id: storeId.toString(), inventory_item_id: itemId, count_date: dateStr })
            if (error) return { success: false, error: `No se pudo eliminar el sobrante: ${error.message}` }
            return { success: true }
        }

        const countedByLabel = String(user.name || user.email || 'Manager').trim() || 'Manager'
        const { error } = await supabase
            .from('inventory_counts')
            .upsert({
                store_id: storeId.toString(),
                inventory_item_id: itemId,
                count_date: dateStr,
                quantity_on_hand: value,
                counted_by: countedByLabel,
                notes: null,
            }, { onConflict: 'store_id, inventory_item_id, count_date' })

        if (error) return { success: false, error: `No se pudo guardar el sobrante: ${error.message}` }
        return { success: true }
    } catch (err: any) {
        console.error(`[updateDailyLeftover] Error para tienda ${storeId}, item ${itemId}:`, err?.message || err)
        return { success: false, error: err instanceof Error ? err.message : 'Error desconocido al validar acceso o guardar datos' }
    }
}

/** Clona las bases de la semana anterior a la semana objetivo */
export async function clonePreviousWeekBases(storeId: string | number, targetMonday: string) {
    await assertUserStoreAccess(storeId)
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
    await assertUserStoreAccess(storeId)
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
    const user = await getServerUser()
    if (!user) throw new Error('Sesión no válida o expirada.')
    const { data: profile, error: profileError } = await supabase
        .from('users').select('role').eq('email', user.email).maybeSingle()
    if (profileError || String(profile?.role || '').trim().toLowerCase() !== 'admin') {
        throw new Error('Solo un administrador puede cambiar los mapeos de inventario.')
    }
    // Limpiar si otro item ya tenía este nombre
    await supabase.from('inventory_items').update({ excel_reference: null }).eq('excel_reference', excelName)
    // Asignar al item elegido
    const { error } = await supabase.from('inventory_items').update({ excel_reference: excelName }).eq('id', itemId)
    if (error) return { error: error.message }
    revalidatePath('/inventory/orders')
    return { success: true }
}

/** Guarda una orden como borrador (materializando AUTO_CYCLE_V2 en ítems no tocados cuando la sucursal opera en 'auto_order_visible') */
export async function saveOrderDraft(
    storeId: string | number,
    orderDate: string,
    weekStartDate: string,
    lines: {
        inventory_item_id: string
        calculated_qty: number
        adjusted_qty?: number
        par_value: number
        leftover_value: number
        is_auto_leftover?: boolean
    }[],
    createdBy?: string,
    notes?: string,
    orderType: OrderType = 'daily',
    autoCountsFallback?: Array<{ inventory_item_id: string; quantity_on_hand: number }>
) {
    const user = await assertUserStoreAccess(storeId)

    // Si la orden ya existe y fue enviada o facturada en QB, proteger su integridad primero
    let preservedStatus: string | null = null
    const { data: existingOrder } = await supabase
        .from('inventory_orders')
        .select('status, qb_estimate_id, qb_estimate_number, qb_invoice_id, qb_invoice_number')
        .eq('store_id', storeId)
        .eq('order_date', orderDate)
        .eq('order_type', orderType)
        .maybeSingle()

    if (existingOrder?.qb_invoice_id || existingOrder?.status === 'received') {
        return {
            error: `Esta orden ya fue facturada y conciliada con La Bodega (Invoice #${existingOrder.qb_invoice_number || existingOrder.qb_invoice_id || 'QBO'}) y no puede sobrescribirse.`,
        }
    }

    if (existingOrder?.qb_estimate_id) {
        preservedStatus = existingOrder.status // Preservar 'sent' o lo que sea
    }

    let storeMode: InventoryAutomationMode = 'off'
    const sacredManualMap = new Map<string, number>()

    if (orderType === 'daily') {
        try {
            const { data: storeRow } = await supabase
                .from('stores')
                .select('id, name, external_id, inventory_automation_mode')
                .eq('id', storeId)
                .maybeSingle()

            const rawMode = String((storeRow as any)?.inventory_automation_mode || '')
            if (rawMode === 'auto_order_visible' || rawMode === 'assisted_2tier' || rawMode === 'shadow_blind' || rawMode === 'off') {
                storeMode = rawMode
            } else {
                storeMode = storeRow?.external_id ? 'auto_order_visible' : 'off'
            }

            if (storeMode === 'auto_order_visible' && !existingOrder?.qb_estimate_id) {
                // 1. Identificar conteos físicos manuales sagrados ya guardados en DB (JAMÁS se sobrescriben)
                const { data: existingCounts } = await supabase
                    .from('inventory_counts')
                    .select('inventory_item_id, quantity_on_hand, counted_by, notes')
                    .eq('store_id', String(storeId))
                    .eq('count_date', orderDate)

                for (const c of existingCounts || []) {
                    if (
                        c.quantity_on_hand !== null &&
                        c.quantity_on_hand !== undefined &&
                        Number.isFinite(Number(c.quantity_on_hand)) &&
                        !isAutoCycleCountRecord({ countedBy: c.counted_by, notes: c.notes })
                    ) {
                        sacredManualMap.set(c.inventory_item_id, Number(c.quantity_on_hand))
                    }
                }

                // 2. Armar mapa de sobrantes automáticos candidatos para ítems NO contados manualmente
                const candidateAutoMap = new Map<string, number>()
                for (const fb of autoCountsFallback || []) {
                    const id = String(fb.inventory_item_id || '')
                    const qty = Number(fb.quantity_on_hand)
                    if (id && !sacredManualMap.has(id) && Number.isFinite(qty) && qty >= 0) {
                        candidateAutoMap.set(id, Number(qty.toFixed(1)))
                    }
                }
                for (const l of lines) {
                    const id = String(l.inventory_item_id || '')
                    if (id && l.is_auto_leftover && !sacredManualMap.has(id) && !candidateAutoMap.has(id) && Number.isFinite(Number(l.leftover_value)) && Number(l.leftover_value) >= 0) {
                        candidateAutoMap.set(id, Number(Number(l.leftover_value).toFixed(1)))
                    }
                }

                // 3. Verificar si aún falta algún SKU requerido (ej. Flan/Cheesecake o edición desde modal)
                const preliminaryMissing = await getMissingDailyCounts(supabase, storeId, orderDate)
                const unresolvedMissing = preliminaryMissing.filter(
                    m => !sacredManualMap.has(m.id) && !candidateAutoMap.has(m.id)
                )

                if (unresolvedMissing.length > 0) {
                    const mondayForCalc = getMonday(orderDate)
                    const [orderableItems, weekData] = await Promise.all([
                        fetchOrderableItems(storeId, 'daily'),
                        fetchWeeklyData(storeId, mondayForCalc, 'daily'),
                    ])
                    const calcLines = await calculateDailyOrder(
                        storeId,
                        orderDate,
                        orderableItems,
                        weekData.bases,
                        weekData.counts,
                        mondayForCalc,
                        weekData.parIdeal,
                        'auto',
                        0,
                        'daily',
                        weekData.nextWeekBases,
                        weekData.countSources
                    )
                    for (const cl of calcLines) {
                        if (
                            !sacredManualMap.has(cl.inventory_item_id) &&
                            !candidateAutoMap.has(cl.inventory_item_id) &&
                            cl.suggested_leftover !== null &&
                            cl.suggested_leftover !== undefined &&
                            Number.isFinite(cl.suggested_leftover)
                        ) {
                            candidateAutoMap.set(cl.inventory_item_id, Math.max(0, Number(cl.suggested_leftover.toFixed(1))))
                        }
                    }
                }

                // 4. Materializar en inventory_counts ÚNICAMENTE los ítems sin conteo físico humano (con AUTO_CYCLE_V2)
                if (candidateAutoMap.size > 0) {
                    const autoUpsertPayload = Array.from(candidateAutoMap.entries())
                        .filter(([itemId]) => !sacredManualMap.has(itemId))
                        .map(([itemId, qty]) => ({
                            store_id: String(storeId),
                            inventory_item_id: itemId,
                            count_date: orderDate,
                            quantity_on_hand: qty,
                            counted_by: AUTO_CYCLE_COUNT_MARKER,
                            notes: 'auto_cycle_v2',
                        }))

                    if (autoUpsertPayload.length > 0) {
                        const { error: autoUpsertErr } = await supabase
                            .from('inventory_counts')
                            .upsert(autoUpsertPayload, { onConflict: 'store_id, inventory_item_id, count_date' })
                        if (autoUpsertErr) {
                            return { error: `No se pudieron registrar los sobrantes del sistema: ${autoUpsertErr.message}` }
                        }
                    }
                }
            }

            const missing = await getMissingDailyCounts(supabase, storeId, orderDate)
            if (missing.length) {
                return { error: `Captura todos los sobrantes antes de generar la orden. Faltan ${missing.length}: ${missing.map(i => i.name).join(', ')}` }
            }
        } catch (error) {
            return { error: `No se pudo verificar la captura completa: ${error instanceof Error ? error.message : 'error desconocido'}` }
        }
    }

    // Excluir artículos externos TRACK_ONLY (Flan, Cheesecake) de las líneas persistibles a La Bodega
    // Si en DB existe un conteo físico humano más reciente que un auto_leftover del cliente, el conteo físico manda al 100%.
    const roundingLookup = new Map<string, string>()
    if (orderType === 'daily' && sacredManualMap.size > 0) {
        const hasStaleAutoLine = lines.some(l => l.is_auto_leftover && sacredManualMap.has(l.inventory_item_id))
        if (hasStaleAutoLine) {
            const { data: itemRules } = await supabase
                .from('inventory_items')
                .select('id, order_rounding_rule')
                .in('id', Array.from(sacredManualMap.keys()))
            itemRules?.forEach((r: any) => roundingLookup.set(r.id, r.order_rounding_rule || 'none'))
        }
    }

    const sanitizedLines = (orderType === 'daily'
        ? lines.filter(l => !isTrackOnlyOrderItem(l) && !EXTERNAL_TRACK_ONLY_ITEM_IDS.has(String(l.inventory_item_id || '')))
        : lines
    ).map(l => {
        if (orderType === 'daily' && l.is_auto_leftover && sacredManualMap.has(l.inventory_item_id)) {
            const manualLeftover = sacredManualMap.get(l.inventory_item_id)!
            const rule = roundingLookup.get(l.inventory_item_id) || 'none'
            const recomputedCalcQty = applyRounding(Math.max(0, l.par_value - manualLeftover), rule)
            return {
                ...l,
                leftover_value: manualLeftover,
                calculated_qty: recomputedCalcQty,
                is_auto_leftover: false,
            }
        }
        return l
    })

    for (const l of sanitizedLines) {
        const finalQty = l.adjusted_qty ?? l.calculated_qty
        if (typeof finalQty !== 'number' || !Number.isFinite(finalQty) || finalQty < 0) {
            return { error: `Cantidad final inválida (${finalQty}). La cantidad mínima permitida es 0.` }
        }
    }

    // Upsert la orden
    const { data: order, error: orderError } = await supabase
        .from('inventory_orders')
        .upsert({
            store_id: storeId,
            order_date: orderDate,
            week_start_date: weekStartDate,
            status: preservedStatus || 'draft',
            created_by: createdBy || user.name || 'Manager',
            notes: notes || null,
            order_type: orderType,
            updated_at: new Date().toISOString()
        }, { onConflict: 'store_id, order_date, order_type' })
        .select()
        .single()

    if (orderError) return { error: orderError.message }

    // Borrar líneas existentes y reemplazar
    await supabase.from('inventory_order_lines').delete().eq('order_id', order.id)

    // Insertar nuevas líneas (sin postres externos TRACK_ONLY)
    const orderLines = sanitizedLines.map(l => ({
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
    return {
        success: true,
        orderId: order.id,
        alreadySentToQb: Boolean(existingOrder?.qb_estimate_id),
        qbEstimateNumber: existingOrder?.qb_estimate_number || null
    }
}


/**
 * Ejecuta el cierre de semana (equivalente al macro de Google Sheets).
 * 1. Valida que todos los items tengan sobrante de Domingo
 * 2. Clona bases a la nueva semana (o usa PAR Ideal)
 * 3. Recalcula PAR Ideal con promedio histórico + tendencia de ventas y clima
 */
export async function executeWeekRollover(storeId: string | number, currentMonday: string) {
    await assertUserStoreAccess(storeId)
    const sundayDate = addDays(currentMonday, 6)
    const nextMonday = addDays(currentMonday, 7)

    // 1. Obtener items de la plantilla diaria de la tienda
    const orderableItems = await fetchOrderableItems(storeId, 'daily')
    if (!orderableItems || orderableItems.length === 0) {
        return { error: 'No hay items configurados para órdenes.' }
    }

    // 2. Verificar que todos tengan sobrante de domingo
    const { data: sundayCounts } = await supabase
        .from('inventory_counts')
        .select('inventory_item_id')
        .eq('store_id', storeId.toString())
        .eq('count_date', sundayDate)

    const capturedIds = new Set(sundayCounts?.map(c => c.inventory_item_id) || [])
    const missing = orderableItems.filter(i => !capturedIds.has(i.id))

    if (missing.length > 0) {
        return { error: `Faltan sobrantes del domingo para ${missing.length} productos.`, missingCount: missing.length }
    }

    // 3. Recalcular PAR Ideal PRIMERO (incluyendo la semana que se cierra)
    await recalculateStoreParIdeal(storeId, 4, currentMonday)

    // 4. Clonar bases a la nueva semana (ahora usa el PAR Ideal recién recalculado como respaldo)
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
 * ajustadas matemáticamente según sobrantes reales + tendencia inteligente de ventas y clima.
 * NUNCA sobrescribe `inventory_weekly_bases` (PAR Actual).
 */
export async function recalculateParIdeal(
    storeId: string | number,
    weeksBack: number = 4
): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
    try {
        await assertUserStoreAccess(storeId)
        const { updatedCount } = await recalculateStoreParIdeal(storeId, weeksBack)
        revalidatePath('/inventory/orders')
        return { success: true, updatedCount }
    } catch (err: any) {
        console.error(`[recalculateParIdeal] Error en tienda ${storeId}:`, err?.message || err)
        return {
            success: false,
            error: err instanceof Error ? err.message : 'No se pudo recalcular el PAR Ideal',
        }
    }
}

/**
 * Obtiene datos de análisis: historial de uso de las últimas N semanas
 */
export async function fetchAnalysisData(storeId: string | number, weeksBack: number = 8) {
    const currentMonday = getMonday(getBusinessDate())
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

    // Historial de órdenes (incluyendo conciliación de Invoice de Bodega)
    const { data: orderHistory } = await supabase
        .from('inventory_orders')
        .select('id, order_date, week_start_date, status, qb_estimate_number, qb_invoice_number, qb_invoiced_at, sent_at')
        .eq('store_id', storeId)
        .gte('week_start_date', startDate)
        .order('order_date', { ascending: false })

    return {
        weeklyBases: allBases || [],
        dailyCounts: allCounts || [],
        orderHistory: orderHistory || []
    }
}
