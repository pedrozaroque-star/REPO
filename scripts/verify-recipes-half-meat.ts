import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
    // 1. Fetch all items that ACTUALLY have a recipe configured
    const { data: recipes } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid')

    if (!recipes || recipes.length === 0) {
        console.log("No recipes found.")
        return
    }

    const recipeGuids = new Set(recipes.map(r => r.toast_menu_item_guid))

    // 2. Fetch those specific items from toast_menu_items
    const { data: menuItems } = await supabase
        .from('toast_menu_items')
        .select('guid, name')
        .in('guid', Array.from(recipeGuids))
        .eq('is_modifier', false) // Only main products

    if (!menuItems) {
        console.log("No menu items found for those recipes.")
        return
    }

    // 3. Apply the exact logic from the API
    const meats = ['Asada', 'Pollo', 'Pastor', 'Carnitas', 'Buche', 'Cabeza', 'Lengua', 'Chorizo']

    const getBaseOz = (name: string) => {
        const lower = name.toLowerCase()
        if (lower.includes('taco plate')) return 0
        if (lower.includes('burrito') || lower.includes('nacho') || lower.includes('fries') || lower.includes('torta') || lower.includes('quesadilla') || lower.includes('bowl') || lower.includes('plato')) return 6.0
        if (lower.includes('taco') || lower.includes('mulita') || lower.includes('sope') || lower.includes('gordita')) return 1.5
        return 0 // Doesn't apply
    }

    const categories = {
        'GRANDES (6.0 oz - se parte a 3.0 oz)': new Set<string>(),
        'CHICOS (1.5 oz - se parte a 0.75 oz)': new Set<string>()
    }

    menuItems.forEach(item => {
        const oz = getBaseOz(item.name)
        if (oz === 0) return

        // We only care if the item has a meat word in its name (because the fallback or direct match will adjust that meat)
        const hasMeat = meats.some(m => item.name.toLowerCase().includes(m.toLowerCase()))
        if (hasMeat) {
            if (oz === 6.0) categories['GRANDES (6.0 oz - se parte a 3.0 oz)'].add(item.name.trim())
            if (oz === 1.5) categories['CHICOS (1.5 oz - se parte a 0.75 oz)'].add(item.name.trim())
        }
    })

    console.log('\n======================================================================')
    console.log(' PRODUCTOS CON RECETA EN SISTEMA AFECTADOS POR "HALF MEAT"')
    console.log(' (Estos son los items reales que ya tienes configurados en tu BD)')
    console.log('======================================================================\n')

    console.log('🟩 PRODUCTOS GRANDES (Porción Base: 6 oz)')
    console.log('   Si detecta un Half modificador, convertirá la receta principal a 3oz')
    console.log('   y agregará 3oz de la nueva carne:\n')
    const grandes = Array.from(categories['GRANDES (6.0 oz - se parte a 3.0 oz)']).sort()
    grandes.forEach(name => console.log(`   🔸 ${name}`))
    if (grandes.length === 0) console.log('   (Ninguno configurado en recetas actualmente)')

    console.log('\n----------------------------------------------------------------------\n')

    console.log('🟦 PRODUCTOS CHICOS (Porción Base: 1.5 oz)')
    console.log('   Si detecta un Half modificador, convertirá la receta principal a 0.75oz')
    console.log('   y agregará 0.75oz de la nueva carne:\n')
    const chicos = Array.from(categories['CHICOS (1.5 oz - se parte a 0.75 oz)']).sort()
    chicos.forEach(name => console.log(`   🔹 ${name}`))
    if (chicos.length === 0) console.log('   (Ninguno configurado en recetas actualmente)')

    console.log('\n======================================================================\n')
}
main().catch(console.error)
