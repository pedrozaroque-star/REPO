/**
 * @module SafeTypes
 * @description TypeScript interfaces para el módulo de Caja Fuerte (Cash Safe).
 * @businessRules
 * - Cada conteo registra billetes sueltos, paquetes/rollos de banco, cajas registradoras y uniformes.
 * - Los totales (bills_total, coins_total, drawers_total, grand_total) son columnas GENERATED en Supabase.
 * - Valores fijos por rollo/paquete BOA: packs_ones=$100, quarter=$10, dime=$5, nickel=$2, penny=$0.50
 * - Cada caja registradora tiene $250 de stock fijo.
 * @dataFlow
 * - La página /caja-fuerte envía SafeCountFormData al API /api/safe-counts
 * - El API devuelve SafeCount (con campos GENERATED calculados por Supabase)
 * @notes
 * - uniforms_amount es placeholder temporal hasta que se construya el módulo de Uniformes.
 */

// ============================================================================
// Valores constantes de rollos/paquetes Bank of America
// ============================================================================
export const ROLL_VALUES = {
  packs_ones: 100.00,    // 100 billetes de $1 por paquete
  rolls_quarter: 10.00,  // 40 monedas × $0.25
  rolls_dime: 5.00,      // 50 monedas × $0.10
  rolls_nickel: 2.00,    // 40 monedas × $0.05
  rolls_penny: 0.50,     // 50 monedas × $0.01
} as const

export const BILL_VALUES = {
  bills_100: 100,
  bills_50: 50,
  bills_20: 20,
  bills_10: 10,
  bills_5: 5,
  bills_1: 1,
} as const

export const DEFAULT_DRAWER_STOCK = 250.00

// ============================================================================
// Interfaces
// ============================================================================

/** Registro completo de un conteo de caja fuerte (como viene de Supabase) */
export interface SafeCount {
  id: string
  store_id: string
  counted_by: number
  counted_at: string        // ISO timestamp
  business_date: string     // YYYY-MM-DD

  // Billetes
  bills_100: number
  bills_50: number
  bills_20: number
  bills_10: number
  bills_5: number
  bills_1: number
  bills_total: number       // GENERATED

  // Cambio (rollos/paquetes BOA)
  packs_ones: number
  rolls_quarter: number
  rolls_dime: number
  rolls_nickel: number
  rolls_penny: number
  coins_total: number       // GENERATED

  // Cambio suelto
  loose_change: number

  // Cajas registradoras
  num_drawers: number
  drawer_stock: number
  drawers_total: number     // GENERATED

  // Uniformes
  uniforms_amount: number

  // Total
  grand_total: number       // GENERATED

  notes: string | null
  created_at: string

  // Joins opcionales
  store?: { name: string }
  user?: { full_name: string }
}

/** Datos del formulario para crear/editar un conteo */
export interface SafeCountFormData {
  store_id: string
  business_date: string

  // Billetes
  bills_100: number
  bills_50: number
  bills_20: number
  bills_10: number
  bills_5: number
  bills_1: number

  // Cambio
  packs_ones: number
  rolls_quarter: number
  rolls_dime: number
  rolls_nickel: number
  rolls_penny: number
  loose_change: number

  // Cajas
  num_drawers: number
  drawer_stock: number

  // Uniformes
  uniforms_amount: number

  notes: string
}

/** Conteo con diferencia calculada vs conteo anterior */
export interface SafeCountWithDiff extends SafeCount {
  difference: number | null  // grand_total actual - grand_total anterior
  counted_by_name?: string
  store_name?: string
}

// ============================================================================
// Helpers de cálculo (para preview en frontend)
// ============================================================================

export function calcBillsTotal(form: Pick<SafeCountFormData, 'bills_100' | 'bills_50' | 'bills_20' | 'bills_10' | 'bills_5' | 'bills_1'>): number {
  return (
    form.bills_100 * BILL_VALUES.bills_100 +
    form.bills_50 * BILL_VALUES.bills_50 +
    form.bills_20 * BILL_VALUES.bills_20 +
    form.bills_10 * BILL_VALUES.bills_10 +
    form.bills_5 * BILL_VALUES.bills_5 +
    form.bills_1 * BILL_VALUES.bills_1
  )
}

export function calcCoinsTotal(form: Pick<SafeCountFormData, 'packs_ones' | 'rolls_quarter' | 'rolls_dime' | 'rolls_nickel' | 'rolls_penny' | 'loose_change'>): number {
  return (
    form.packs_ones * ROLL_VALUES.packs_ones +
    form.rolls_quarter * ROLL_VALUES.rolls_quarter +
    form.rolls_dime * ROLL_VALUES.rolls_dime +
    form.rolls_nickel * ROLL_VALUES.rolls_nickel +
    form.rolls_penny * ROLL_VALUES.rolls_penny +
    form.loose_change
  )
}

export function calcDrawersTotal(form: Pick<SafeCountFormData, 'num_drawers' | 'drawer_stock'>): number {
  return form.num_drawers * form.drawer_stock
}

export function calcGrandTotal(form: SafeCountFormData): number {
  return calcBillsTotal(form) + calcCoinsTotal(form) + calcDrawersTotal(form) + form.uniforms_amount
}
