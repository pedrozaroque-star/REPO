/**
 * @module inventory/orders/utils
 * @description Funciones utilitarias y tipos compartidos para el módulo de Pedidos a Bodega.
 *              Separadas de actions.ts porque las server actions requieren que TODAS
 *              las funciones exportadas sean async.
 *
 * @notes
 * - [2026-06-24] Extraído de actions.ts para resolver error de Next.js 16:
 *   "Server Actions must be async functions."
 */

// ============================================================================
// HELPERS
// ============================================================================

/** Obtiene el lunes de la semana de una fecha dada (calendario puro) */
export function getMonday(d: Date): string {
    const date = new Date(d)
    date.setHours(0, 0, 0, 0)
    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1)
    return new Date(date.setDate(diff)).toISOString().split('T')[0]
}

/**
 * Obtiene el lunes de la semana de NEGOCIO actual.
 * El día laboral empieza a las 6:00 AM y termina a las 5:59 AM del siguiente día.
 * Entonces lunes 1:00 AM = todavía es "domingo" → retorna el lunes de la semana anterior.
 */
export function getBusinessMonday(d: Date = new Date()): string {
    const adjusted = new Date(d)
    if (adjusted.getHours() < 6) {
        adjusted.setDate(adjusted.getDate() - 1) // Retroceder al día laboral anterior
    }
    adjusted.setHours(12, 0, 0, 0)
    return getMonday(adjusted)
}

/** Suma días a una fecha string YYYY-MM-DD */
export function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().split('T')[0]
}

// ============================================================================
// TIPOS
// ============================================================================

export type OrderableItem = {
    id: string
    name: string
    unit_type: string
    excel_reference?: string
    order_unit_description?: string
    order_rounding_rule: string
    order_sort_position: number
    qb_item_id?: string
    purchase_unit_cost?: number
    unit_measure?: string
}

export type WeeklyBaseRecord = {
    inventory_item_id: string
    mon_par: number
    tue_par: number
    wed_par: number
    thu_par: number
    fri_par: number
    sat_par: number
    sun_par: number
}

export type ParIdealRecord = WeeklyBaseRecord

export type CalculatedOrderLine = {
    inventory_item_id: string
    item_name: string
    unit_description: string
    par_value: number
    par_ideal_value?: number
    leftover_value: number | null
    calculated_qty: number
    rounding_rule: string
    qb_item_id?: string
    is_extraordinary?: boolean
    suggested_leftover?: number | null
    is_burn_rate?: boolean
    variance?: number | null
    purchase_unit_cost?: number
    unit_measure?: string
    adjusted_qty?: number
}

export type OrderRecord = {
    id: string
    store_id: number
    order_date: string
    week_start_date: string
    status: string
    created_by?: string
    notes?: string
    qb_estimate_id?: string
    qb_estimate_number?: string
    sent_at?: string
    created_at: string
    lines?: OrderLineRecord[]
}

export type OrderLineRecord = {
    id: string
    order_id: string
    inventory_item_id: string
    calculated_qty: number
    adjusted_qty?: number
    final_qty: number
    par_value: number
    leftover_value: number
}
