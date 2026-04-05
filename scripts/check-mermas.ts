import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkMermas() {
    console.log("Checking meat items...")
    
    const targetProteins = ['ASADA', 'PASTOR', 'POLLO', 'CARNITAS', 'CABEZA', 'LENGUA', 'CAFE', 'CHAMPURRADO']
    
    const { data: invData, error: err1 } = await supabase.from('inventory_items').select('id, name, yield_percent')
    const { data: recipesData, error: err2 } = await supabase.from('recipes').select('inventory_item_id, toast_menu_item_guid, quantity, unit')
    
    if (!invData || !recipesData) {
        console.error("Missing data", err1, err2)
        return
    }

    const items = invData.filter(i => {
        const name = i.name.toUpperCase()
        return targetProteins.some(p => name.includes(p)) && !name.includes('SALSA')
    })
    
    for (const item of items) {
        console.log(`\n🥩 ${item.name.toUpperCase()} (Merma / Yield: ${item.yield_percent}%)`)
        
        // Muestra ejemplos de porcionado para este item
        const usage = recipesData.filter(r => r.inventory_item_id === item.id)
        if (usage.length > 0) {
            // Mostrar hasta 3 recetas de ejemplo para no sobrecargar
            usage.slice(0, 3).forEach(r => {
                console.log(`   🔸 [Item GUID: ${r.toast_menu_item_guid}] -> Lleva ${r.quantity} ${r.unit}`)
            })
            if (usage.length > 3) {
                console.log(`   ... y ${usage.length - 3} recetas más.`)
            }
        } else {
            console.log(`   ❌ No hay recetas usando este ingrediente.`)
        }
    }
}

checkMermas()
