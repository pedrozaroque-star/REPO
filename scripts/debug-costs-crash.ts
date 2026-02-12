
import { calculateRecipeCost } from '../lib/inventory/costs'
import { InventoryItem, Recipe } from '@/types/inventory'

console.log("🛠️ Diagnóstico de Costos...")

// Mock Data
const inventoryItems: InventoryItem[] = [
    {
        id: '1',
        name: 'Carne Asada',
        unit_type: '10 lb',
        purchase_unit_cost: 40, // $40 per 10lb bag = $4/lb
        yield_percent: 100,
        category_id: '1',
        sku: '009W',
        inventory_type: 'ingredient'
    }
]

const recipe: Recipe = {
    id: 'r1',
    name: 'Taco Asada',
    ingredients: [
        {
            inventory_item_id: '1',
            quantity: 0.25, // 0.25 lb
            unit: 'lb',
            type: 'raw'
        }
    ],
    menu_item_id: 'm1'
}

try {
    const result = calculateRecipeCost(recipe, inventoryItems)
    console.log("✅ Resultado:", result)
} catch (e) {
    console.error("❌ ERROR CRÍTICO EN CÁLCULO:", e)
}
