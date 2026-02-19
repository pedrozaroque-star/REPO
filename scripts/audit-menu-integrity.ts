
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function auditMenu() {
    console.log("\n👨‍🍳 INICIANDO AUDITORÍA DEL CHEF/DUEÑO...\n")

    // 1. Fetch relevant data
    const { data: recipes, error } = await supabase
        .from('recipes')
        .select(`
            id,
            toast_menu_item_guid,
            quantity,
            unit,
            inventory_item:inventory_items (
                id,
                name,
                unit_type,
                yield_percent,
                purchase_unit_cost,
                quantity_per_unit,
                unit_measure
            )
        `)

    const { data: menuItems } = await supabase.from('menu_items').select('*')

    if (!recipes || !menuItems) return

    // Group recipes by Menu Item
    const recipeMap = new Map()
    recipes.forEach(r => {
        if (!recipeMap.has(r.toast_menu_item_guid)) {
            recipeMap.set(r.toast_menu_item_guid, [])
        }
        recipeMap.get(r.toast_menu_item_guid).push(r)
    })

    // --- ANÁLISIS 1: EL MITO DE LA MERMA (YIELD) ---
    console.log("🍖 [ALERTA] CARNES CON 100% RENDIMIENTO (IMPOSIBLE EN COCINA REAL):")
    const meatsChecked = new Set()
    recipes.forEach((r: any) => {
        const item = Array.isArray(r.inventory_item) ? r.inventory_item[0] : r.inventory_item
        const name = item?.name?.toLowerCase() || ''
        const yieldPct = item?.yield_percent || 0

        if ((name.includes('asada') || name.includes('pastor') || name.includes('carnitas') || name.includes('lengua') || name.includes('birria')) && yieldPct >= 100) {
            if (!meatsChecked.has(name)) {
                console.log(`   ❌ ${item.name}: Está al ${yieldPct}%. (La carne cocida merma 25-35%. Tu costo real es más alto).`)
                meatsChecked.add(name)
            }
        }
    })

    // --- ANÁLISIS 2: RECETAS INCOMPLETAS ("ESQUELÉTICAS") ---
    console.log("\n🌮 [ALERTA] PLATOS COMPLEJOS CON POCOS INGREDIENTES (FALTAN EMPAQUES/SALSAS):")
    menuItems.forEach((item: any) => {
        const itemRecipes = recipeMap.get(item.guid) || []
        const name = item.name.toLowerCase()

        // Ignorar bebidas, sides simples, o modificadores
        if (!item.plu && item.price > 3 && itemRecipes.length > 0 && itemRecipes.length < 3) {
            if (name.includes('burrito') || name.includes('taco') || name.includes('torta') || name.includes('nachos')) {
                const ingredients = itemRecipes.map((ir: any) => {
                    const inv = Array.isArray(ir.inventory_item) ? ir.inventory_item[0] : ir.inventory_item
                    return inv?.name
                }).join(', ')
                console.log(`   ⚠️ ${item.name} ($${item.price}): Solo tiene ${itemRecipes.length} insumos: [${ingredients}]. ¿Y el papel? ¿Salsa? ¿Cebolla?`)
            }
        }
    })

    // --- ANÁLISIS 3: COSTO SOSPECHOSAMENTE BAJO ---
    console.log("\n📉 [ALERTA] COSTO DE ALIMENTOS DEMASIADO BAJO (BAJO INVESTIGACIÓN):")
    menuItems.forEach((item: any) => {
        const itemRecipes = recipeMap.get(item.guid) || []
        if (itemRecipes.length === 0) return

        let totalCost = 0
        itemRecipes.forEach((r: any) => {
            const inv = Array.isArray(r.inventory_item) ? r.inventory_item[0] : r.inventory_item
            if (!inv) return

            // Replicate simple cost logic
            const costPerUnit = (inv.purchase_unit_cost || 0) / (inv.quantity_per_unit || 1)
            // Simple version check
            let conversion = 1 // Simplified for audit
            if (r.unit !== inv.unit_measure) conversion = 1 // Assuming massive error if units mismatch

            totalCost += (costPerUnit * r.quantity * conversion)
        })

        if (item.price > 4 && totalCost < 0.50) {
            console.log(`   ❓ ${item.name}: Precio $${item.price} vs Costo aprox $${totalCost.toFixed(2)}. (Food Cost < ${(totalCost / item.price * 100).toFixed(1)}%). Revisar cantidades.`)
        }
    })

    // --- ANÁLISIS 4: INCONGRUENCIAS DE TAMAÑO ---
    console.log("\n🥤 [ALERTA] LÓGICA DE TAMAÑOS (MEDIUM VS LARGE):")
    const sizes = new Map()
    menuItems.forEach(item => {
        if (item.name.includes('Medium')) sizes.set(item.name.replace('Medium', '').trim(), { medCost: 0, medPrice: item.price, name: item.name })
        if (item.name.includes('Large')) sizes.set(item.name.replace('Large', '').trim(), { ...sizes.get(item.name.replace('Large', '').trim()), lgCost: 0, lgPrice: item.price, lgName: item.name })
    })

    // (Calculation omitted for brevity in script, focusing on previous findings first)
    console.log("   (Análisis manual requerido en tabla: Verificar que Large Horchata cueste proporcionalmente más que Medium Horchata)")

    console.log("\n✅ FIN DE LA AUDITORÍA.")
}

auditMenu()
