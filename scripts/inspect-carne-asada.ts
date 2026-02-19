
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    console.log("🔍 INSPECTING CARNE ASADA INVENTORY ITEM")

    const { data: item } = await supabase
        .from('inventory_items')
        .select('*')
        .ilike('name', '%Carne Asada%')
        .limit(1)
        .single()

    if (item) {
        console.log("Inventory Item:", item)
        // Calc Cost
        // Purchase Unit Cost / Qty Per Unit
        // $61.20 / 1 ?
        const unitCost = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1)
        console.log(`Unit Cost Calculation: $${item.purchase_unit_cost} / ${item.quantity_per_unit} = $${unitCost} per ${item.unit_measure}`)
    } else {
        console.log("Item not found")
    }
}

run()
