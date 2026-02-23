
import { getSupabaseAdminClient } from '../lib/supabase'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function compareRecipes() {
    console.log("Analyzing Cost Discrepancy: Burrito Asada vs Burrito Asada (Poco Arroz)\n")

    try {
        const supabase = await getSupabaseAdminClient()

        const { data: menuItems } = await supabase
            .from('toast_menu_items')
            .select('guid, name')
            .or('name.eq.Burrito Asada,name.eq.Burrito Asada (Poco Arroz)');

        if (!menuItems?.length) {
            console.log("Menu items not found in toast_menu_items table.")
            return
        }

        for (const item of menuItems) {
            const { data: recipeRows } = await supabase
                .from('recipes')
                .select(`*, inv:inventory_items(*)`)
                .eq('toast_menu_item_guid', item.guid);

            let totalCost = 0
            console.log(`\nPRODUCT: ${item.name} (${item.guid})`)
            console.log('--------------------------------------------------')

            if (!recipeRows?.length) {
                console.log("   (No recipe defined in DB)")
                continue
            }

            recipeRows.forEach(r => {
                const purchaseUnitCost = Number(r.inv.purchase_unit_cost || 0)
                const qtyPerUnit = Number(r.inv.quantity_per_unit || 1)
                const costPerBaseUnit = purchaseUnitCost / qtyPerUnit
                const yieldFactor = (Number(r.inv.yield_percent) || 100) / 100

                let qtyInBaseUnit = r.quantity
                if (r.unit === 'oz' && r.inv.unit_type === 'lb') qtyInBaseUnit = r.quantity / 16

                const lineCost = (qtyInBaseUnit / yieldFactor) * costPerBaseUnit
                totalCost += lineCost

                console.log(` - ${r.inv.name.padEnd(25)}: ${r.quantity.toString().padEnd(5)} ${r.unit.padEnd(4)} | Cost: $${lineCost.toFixed(3)}`)
            })

            console.log(`\nTOTAL THEORETICAL COST: $${totalCost.toFixed(3)}`)
            console.log('--------------------------------------------------')
        }

    } catch (err) {
        console.error("Script Error:", err)
    }
}

compareRecipes()
