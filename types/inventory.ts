export type UnitType = 'lb' | 'oz' | 'kg' | 'g' | 'gal' | 'l' | 'pza' | 'caja' | 'bolsa'

export interface InventoryCategory {
    id: string
    name: string
    description?: string
}

export interface InventoryItem {
    id: string
    category_id: string
    name: string
    sku?: string
    unit_type: UnitType
    quantity_per_unit?: number
    unit_measure?: string
    purchase_unit_cost?: number

    // YIELD LOGIC
    // Ejemplo Carne Asada:
    // yield_percent = 60.83 (10.11 lbs raw -> 6.15 lbs cooked)
    // Si la receta pide 1.5 oz cooked, el sistema calcula: 1.5 / 0.6083 = 2.46 oz raw
    yield_percent: number

    alert_threshold?: number
}

export interface ToastMenuItemCache {
    guid: string
    name: string
    sku?: string
    price?: number
    group_name?: string
    is_modifier: boolean
    active: boolean
}

export interface RecipeIngredient {
    inventory_item_id: string
    quantity: number // Cantidad según la receta (ej: 1.5 oz)
    unit: UnitType   // Unidad de la receta (ej: 'oz')
    type: 'raw' | 'cooked' // IMPORTANTE: ¿La cantidad es en crudo o cocinado?
}

export interface Recipe {
    id: string
    toast_menu_item_guid: string
    ingredients: RecipeIngredient[]
}

export interface ModifierRule {
    modifier_guid: string
    inventory_item_id: string
    quantity_adjustment: number
    unit: UnitType
}

export interface InventoryCount {
    id: string
    store_id: string
    inventory_item_id: string
    count_date: string
    quantity_on_hand: number
    counted_by?: string
}
