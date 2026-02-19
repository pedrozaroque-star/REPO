
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function auditCosts() {
    console.log('--- INICIANDO AUDITORÍA DE COSTOS BAJOS ---')

    const { data: recipes, error } = await supabase
        .from('recipes')
        .select(`
            quantity,
            unit,
            toast_menu_item:toast_menu_items (name, guid, price),
            inventory_item:inventory_items (name, purchase_unit_cost, unit_type)
        `)

    if (error) {
        console.error('Error fetching recipes:', error)
        return
    }

    if (!recipes || recipes.length === 0) {
        console.error('No se encontraron recetas.')
        return
    }

    console.log(`Analizando ${recipes.length} recetas...`)

    // Agrupar por Menu Item
    const itemMap = new Map<string, {
        name: string,
        price: number,
        ingredients: any[]
    }>()

    // Usar 'any' para evitar dolor de cabeza con arrays vs objetos en joins
    recipes.forEach((r: any) => {
        // Normalizar respuesta de Supabase (a veces ARRAY si es N:1, a veces OBJETO)
        const menuItem = Array.isArray(r.toast_menu_item) ? r.toast_menu_item[0] : r.toast_menu_item
        const invItem = Array.isArray(r.inventory_item) ? r.inventory_item[0] : r.inventory_item

        if (!menuItem || !invItem) return

        const guid = menuItem.guid
        if (!itemMap.has(guid)) {
            itemMap.set(guid, {
                name: menuItem.name,
                price: menuItem.price || 0,
                ingredients: []
            })
        }

        const item = itemMap.get(guid)!
        const ingPrice = invItem.purchase_unit_cost || 0
        const ingName = invItem.name

        item.ingredients.push({
            name: ingName,
            invPrice: ingPrice,
            qty: r.quantity,
            unit: r.unit
        })
    })

    console.log('\n--- ALERTA: INGREDIENTES CON COSTO $0.00 ---')
    const zeroCostIngredients = new Set<string>()

    // Analizar todos los ingredientes usados
    recipes.forEach((r: any) => {
        const invItem = Array.isArray(r.inventory_item) ? r.inventory_item[0] : r.inventory_item
        if (invItem && (!invItem.purchase_unit_cost || invItem.purchase_unit_cost === 0)) {
            zeroCostIngredients.add(invItem.name)
        }
    })

    if (zeroCostIngredients.size > 0) {
        zeroCostIngredients.forEach(name => {
            console.log(`❌ ${name}`)
        })
    } else {
        console.log('✅ No se encontraron ingredientes con costo $0.')
    }

    console.log('\n--- ALERTA: INTEGRIDAD DE ITEMS DE POLLO (CRÍTICO) ---')
    const polloItems = Array.from(itemMap.values()).filter(i => i.name.toLowerCase().includes('pollo'))

    if (polloItems.length === 0) {
        console.log('No se encontraron productos de Pollo en las recetas.')
    }

    polloItems.forEach(i => {
        console.log(`\nProducto: ${i.name} (Precio Venta: $${i.price})`)
        i.ingredients.forEach(ing => {
            console.log(`   - ${ing.qty} ${ing.unit} de ${ing.name} (Costo Insumo Unit: $${ing.invPrice})`)
        })

        const hasProtein = i.ingredients.some(ing => ing.name.toLowerCase().includes('pollo') || ing.name.toLowerCase().includes('chicken'))
        if (!hasProtein) {
            console.log(`   ⚠️  CRÍTICO: NO TIENE INGREDIENTE DE 'POLLO' DETECTADO O EL NOMBRE NO COINCIDE`)
        } else {
            const polloIng = i.ingredients.find(ing => ing.name.toLowerCase().includes('pollo') || ing.name.toLowerCase().includes('chicken'))
            if (polloIng && polloIng.invPrice === 0) {
                console.log(`   ⚠️  CRÍTICO: TIENE POLLO, PERO EL PRECIO ES $0.00`)
            }
        }
    })
}

auditCosts()
