
import { calculateRecipeCost } from '../lib/inventory/costs'
import { InventoryItem, Recipe } from '@/types/inventory'

console.log("🛠️ Diagnóstico de Costos...")

// Mock Data
const inventoryItems: InventoryItem[] = [
    {
        id: '1',
        name: 'Carne Asada',
        unit_type: 'lb',
        purchase_unit_cost: 40, // $40 per lb (mock)
        yield_percent: 100,
        category_id: '1',
        sku: '009W'
    }
]

const recipe: Recipe = {
    id: 'r1',
    toast_menu_item_guid: 'm1',
    ingredients: [
        {
            inventory_item_id: '1',
            quantity: 0.25, // 0.25 lb
            unit: 'lb',
            type: 'raw'
        }
    ],

}

try {
    const result = calculateRecipeCost(recipe, inventoryItems)
    console.log("✅ Resultado:", result)
} catch (e) {
    console.error("❌ ERROR CRÍTICO EN CÁLCULO:", e)
}
