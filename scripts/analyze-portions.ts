
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function analyzePortions() {
    console.log('--- Analizando Porciones Existentes ---')

    // Fetch recipes with item names
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select(`
            quantity,
            unit,
            toast_menu_item:toast_menu_items (name),
            inventory_item:inventory_items (name)
        `)

    if (error) {
        console.error(error)
        return
    }

    // Filter for meat ingredients
    const meatKeywords = ['asada', 'pastor', 'pollo', 'carnitas', 'cabeza', 'buche', 'tripa', 'lengua', 'carne']
    const meatRecipes = recipes.filter(r => {
        const invName = r.inventory_item?.name.toLowerCase() || ''
        return meatKeywords.some(k => invName.includes(k))
    })

    // Group by Product Type
    const productTypes = ['Sope', 'Taco', 'Burrito', 'Mulita', 'Torta', 'Quesadilla', 'Nachos', 'Plato']
    const standards: Record<string, any> = {}

    productTypes.forEach(type => {
        const relevant = meatRecipes.filter(r => r.toast_menu_item?.name.includes(type))
        if (relevant.length > 0) {
            // Calculate average or pick first
            const sample = relevant[0]
            standards[type] = {
                meat: sample.inventory_item?.name,
                quantity: sample.quantity,
                unit: sample.unit
            }
        }
    })

    console.table(standards)
}

analyzePortions()
