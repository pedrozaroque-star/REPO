
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectTacoPollo() {
    console.log('--- INSPECTING TACO POLLO ---')

    // Buscar GUID por nombre primero
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('guid, name')
        .eq('name', 'Taco Pollo')

    if (!items || items.length === 0) {
        console.log('No encontrado item "Taco Pollo"')
        return
    }

    const guid = items[0].guid
    console.log(`GUID: ${guid}`)

    const { data: recipes } = await supabase
        .from('recipes')
        .select(`
            quantity,
            unit,
            inventory_item:inventory_items (name, purchase_unit_cost, unit_type)
        `)
        .eq('toast_menu_item_guid', guid)

    console.log('Ingredientes:')
    recipes?.forEach((r: any) => {
        // cast
        const inv = Array.isArray(r.inventory_item) ? r.inventory_item[0] : r.inventory_item
        console.log(`- ${r.quantity} ${r.unit} de ${inv.name} ($${inv.purchase_unit_cost})`)
    })
}

inspectTacoPollo()
