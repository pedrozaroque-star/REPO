/**
 * @module UniformsUtils
 * @description Types, constants, and helper functions for the uniforms inventory module.
 * @businessRules
 * - New hires get 6 red shirts, 1 red cap, 1 red jacket.
 * - Business date rolls over at 6AM (not midnight).
 * @dataFlow Provides shared definitions for all uniform components and API routes.
 * @notes Contains mappings for localized strings without relying on useLanguage in server contexts.
 */

export type UniformCategory = 
  | 'shirt_red' 
  | 'shirt_shift_leader' 
  | 'shirt_assistant' 
  | 'shirt_manager' 
  | 'cap_red' 
  | 'cap_black' 
  | 'jacket_red' 
  | 'jacket_black'

export type UniformSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | '2XL' | '3XL' | 'ONE_SIZE'

export type TransactionType = 'reception' | 'employee_sale' | 'customer_sale' | 'new_hire_package' | 'damage_exchange' | 'manager_free' | 'manual_audit' | 'initial_count' | 'initial_count_reset'

export interface PricingRecord {
    id: string
    item_category: UniformCategory
    display_name_es: string
    display_name_en: string
    sale_price: number
    is_free_for_roles: string[]
    provider_name: string | null
    provider_cost: number | null
    effective_from: string
    notes: string | null
    updated_by: string | null
    updated_at: string
}

export interface StockItem {
    id: string
    store_id: number
    item_category: UniformCategory
    size: UniformSize
    quantity_on_hand: number
    min_stock: number
    updated_at: string
    display_name_es?: string
    display_name_en?: string
    sale_price?: number
}

export interface UniformTransaction {
    id: string
    store_id: number
    item_category: UniformCategory
    size: UniformSize
    transaction_type: TransactionType
    quantity: number
    previous_stock: number
    new_stock: number
    unit_price: number | null
    total_amount: number | null
    employee_toast_guid: string | null
    employee_name: string | null
    reason: string | null
    reference_order_id: string | null
    business_date: string
    created_by: string | null
    created_at: string
}

export interface ExecutiveStoreData {
    id: number
    name: string
    totalItems: number
    totalValue: number
    hasInitialCount: boolean
    lastAuditDate: string | null
}

export interface ExecutiveDashboardData {
    stores: ExecutiveStoreData[]
    globalMetrics: {
        totalStock: number
        totalSalesAmount: number
        damageExchanges: number
        pendingReceptions: number
    }
}

export const SIZES_BY_CATEGORY: Record<string, UniformSize[]> = {
    shirt_red: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    shirt_shift_leader: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    shirt_assistant: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    shirt_manager: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    cap_red: ['ONE_SIZE'],
    cap_black: ['ONE_SIZE'],
    jacket_red: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    jacket_black: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
}

/**
 * Default minimum stock levels by category and size.
 * Triggers reorder alerts to La Bodega when quantity_on_hand <= min_stock.
 */
export const DEFAULT_MIN_STOCK: Record<UniformCategory, Record<UniformSize, number>> = {
    shirt_red: { XS: 10, S: 10, M: 20, L: 15, XL: 15, '2XL': 5, '3XL': 5, ONE_SIZE: 0 },
    cap_red: { XS: 0, S: 0, M: 0, L: 0, XL: 0, '2XL': 0, '3XL': 0, ONE_SIZE: 12 },
    jacket_red: { XS: 3, S: 3, M: 3, L: 3, XL: 3, '2XL': 2, '3XL': 2, ONE_SIZE: 0 },
    shirt_shift_leader: { XS: 10, S: 10, M: 20, L: 15, XL: 15, '2XL': 5, '3XL': 5, ONE_SIZE: 0 },
    shirt_assistant: { XS: 3, S: 3, M: 3, L: 3, XL: 3, '2XL': 3, '3XL': 3, ONE_SIZE: 0 },
    shirt_manager: { XS: 0, S: 0, M: 0, L: 0, XL: 0, '2XL': 0, '3XL': 0, ONE_SIZE: 0 },
    cap_black: { XS: 0, S: 0, M: 0, L: 0, XL: 0, '2XL': 0, '3XL': 0, ONE_SIZE: 12 },
    jacket_black: { XS: 3, S: 3, M: 3, L: 3, XL: 3, '2XL': 2, '3XL': 2, ONE_SIZE: 0 },
}

export function getDefaultMinStock(category: UniformCategory, size: UniformSize): number {
    return DEFAULT_MIN_STOCK[category]?.[size] ?? 0;
}

/**
 * Mapea el nombre de un item de inventario de uniformes (ej: "Team Members Red Small")
 * a su categoría y talla dentro del módulo de Control de Uniformes.
 */
export function parseUniformCategoryAndSize(name: string): { category: UniformCategory | null; size: UniformSize } {
    const cleanName = (name || '').trim().toLowerCase()

    let category: UniformCategory | null = null
    if (cleanName.includes('team member') || cleanName.includes('shirt red') || cleanName.includes('camisa roja')) {
        if (cleanName.includes('chamarra')) category = 'jacket_red'
        else if (cleanName.includes('gorra')) category = 'cap_red'
        else category = 'shirt_red'
    } else if (cleanName.includes('shift leader')) {
        category = 'shirt_shift_leader'
    } else if (cleanName.includes('assistant manager')) {
        category = 'shirt_assistant'
    } else if (cleanName.includes('store manager')) {
        category = 'shirt_manager'
    } else if (cleanName.includes('chamarra negra')) {
        category = 'jacket_black'
    } else if (cleanName.includes('chamarra roja')) {
        category = 'jacket_red'
    } else if (cleanName.includes('gorra') && cleanName.includes('roja')) {
        category = 'cap_red'
    } else if (cleanName.includes('gorra') && cleanName.includes('negra')) {
        category = 'cap_black'
    }

    let size: UniformSize = 'ONE_SIZE'
    if (category === 'cap_red' || category === 'cap_black') {
        size = 'ONE_SIZE'
    } else if (cleanName.includes('xxx-large') || cleanName.includes('3xl') || cleanName.includes('xxx-l')) {
        size = '3XL'
    } else if (cleanName.includes('xx-large') || cleanName.includes('2xl') || cleanName.includes('xx-l')) {
        size = '2XL'
    } else if (cleanName.includes('x-large') || cleanName.includes(' xl') || cleanName.includes('xl') || cleanName.includes('x-l')) {
        size = 'XL'
    } else if (cleanName.includes('x-small') || cleanName.includes('xs')) {
        size = 'XS'
    } else if (cleanName.includes('small')) {
        size = 'S'
    } else if (cleanName.includes('medium')) {
        size = 'M'
    } else if (cleanName.includes('large')) {
        size = 'L'
    }

    return { category, size }
}

export const NEW_HIRE_PACKAGE: Array<{ item_category: UniformCategory, quantity: number }> = [
    { item_category: 'shirt_red', quantity: 6 },
    { item_category: 'cap_red', quantity: 1 },
    { item_category: 'jacket_red', quantity: 1 },
]

export const CATEGORY_GROUPS = {
    RED_TEAM: ['shirt_red', 'cap_red', 'jacket_red'],
    SHIFT_LEADER: ['shirt_shift_leader'],
    ASSISTANT_MANAGER: ['shirt_assistant'],
    STORE_MANAGER: ['shirt_manager'],
    BLACK_ACCESSORIES: ['cap_black', 'jacket_black']
} as const

export const ALL_CATEGORIES: UniformCategory[] = [
    'shirt_red', 'shirt_shift_leader', 'shirt_assistant', 'shirt_manager', 'cap_red', 'cap_black', 'jacket_red', 'jacket_black'
]

export function getCategoryDisplayName(category: UniformCategory, lang: 'es' | 'en'): string {
    const map: Record<UniformCategory, { es: string, en: string }> = {
        shirt_red: { es: 'Team Members Red', en: 'Team Members Red' },
        shirt_shift_leader: { es: 'Shift Leader Black', en: 'Shift Leader Black' },
        shirt_assistant: { es: 'Assistant Manager Polo Black', en: 'Assistant Manager Polo Black' },
        shirt_manager: { es: 'Camisa Store Manager Negra', en: 'Camisa Store Manager Negra' },
        cap_red: { es: 'Gorra Roja', en: 'Red Cap' },
        cap_black: { es: 'Gorra Negra', en: 'Black Cap' },
        jacket_red: { es: 'Chamarra Roja', en: 'Red Jacket' },
        jacket_black: { es: 'Chamarra Negra', en: 'Black Jacket' }
    }
    return map[category]?.[lang] || category
}

export function getTransactionTypeLabel(type: TransactionType, lang: 'es' | 'en'): string {
    const map: Record<TransactionType, { es: string, en: string }> = {
        reception: { es: 'Recepción', en: 'Reception' },
        employee_sale: { es: 'Venta a Empleado', en: 'Employee Sale' },
        customer_sale: { es: 'Venta a Cliente', en: 'Customer Sale' },
        new_hire_package: { es: 'Paquete de Entrega / Ingreso', en: 'Delivery Package' },
        damage_exchange: { es: 'Cambio por Daño', en: 'Damage Exchange' },
        manager_free: { es: 'Regalía Gerente', en: 'Manager Free' },
        manual_audit: { es: 'Auditoría Manual', en: 'Manual Audit' },
        initial_count: { es: 'Conteo Inicial', en: 'Initial Count' },
        initial_count_reset: { es: 'Reinicio Conteo Inicial', en: 'Initial Count Reset' }
    }
    return map[type]?.[lang] || type
}

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount)
}

export function getBusinessDate(): string {
    const now = new Date()
    // If it's before 6AM, it counts as yesterday's business date
    if (now.getHours() < 6) {
        now.setDate(now.getDate() - 1)
    }
    
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    
    return `${year}-${month}-${day}`
}
