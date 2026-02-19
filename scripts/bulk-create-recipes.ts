
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// --- CONFIGURACIÓN DE PORCIONES ---
const PORTIONS = {
    'Sope': 1.5,
    'Taco': 1.5,
    'Mulita': 1.5,
    'Burrito': 6,
    'Torta': 6,
    'Quesadilla': 6, // Normalizado a 6 oz
    'Nachos': 6,     // Normalizado a 6 oz
    'Plato': 6       // Plato (3 tacos o similar)
}
const UNIT = 'oz'

// --- MAPEO DE NOMBRES TOAST -> INSUMOS INVENTARIO (LISTA DE POSIBLES NOMBRES) ---
const MEAT_ALIASES: Record<string, string[]> = {
    'Asada': ['Carne Asada', 'Asada'],
    'Pastor': ['Pastor', 'Carne Pastor', 'Adobada', 'Al Pastor'],
    'Pollo': ['Pollo', 'Chicken', 'Pollo Desmenuzado'],
    'Carnitas': ['Carnitas'],
    'Cabeza': ['Cabeza'],
    'Buche': ['Buche'],
    'Tripa': ['Tripa', 'Tripas'],
    'Lengua': ['Lengua']
}

async function bulkCreateRecipes() {
    console.log('--- Iniciando Creación Masiva de Recetas ---')

    // 1. Obtener Insumos de Carne (IDs)
    const { data: inventoryItems } = await supabase
        .from('inventory_items')
        .select('id, name')
        .ilike('name', '%Carne%') // Amplio para buscar
    // O mejor, buscar todos y filtrar en memoria

    // Fetch ALL inventory items to be safe
    const { data: allInventory } = await supabase.from('inventory_items').select('id, name')
    if (!allInventory) return

    // 2. Obtener Items del Menú (Toast) que NO tienen receta aún
    // (Opcional: Sobreescribir? Por seguridad, solo llenar vacíos primero)
    const { data: menuItems } = await supabase
        .from('toast_menu_items')
        .select('guid, name, group_name')

    if (!menuItems) return

    const updates = []

    console.log(`Analizando ${menuItems.length} items del menú...`)

    for (const item of menuItems) {
        const name = item.name

        // Detectar Tipo de Producto
        let detectedType = null
        for (const type of Object.keys(PORTIONS)) {
            if (name.includes(type)) {
                detectedType = type
                break
            }
        }
        if (!detectedType) continue

        // console.log(`Analizando ${name} (${detectedType})...`)

        // Detectar Tipo de Carne
        let detectedMeatKey = null
        for (const meatKey of Object.keys(MEAT_ALIASES)) {
            if (name.includes(meatKey)) {
                detectedMeatKey = meatKey
                break
            }
        }
        if (!detectedMeatKey) continue

        // Buscar ID del Insumo (Iterar Aliases)
        const aliases = MEAT_ALIASES[detectedMeatKey]
        let invItem = null

        for (const alias of aliases) {
            invItem = allInventory.find(i => i.name.toLowerCase() === alias.toLowerCase() || i.name.toLowerCase().includes(alias.toLowerCase()))
            if (invItem) break
        }

        if (!invItem) {
            console.warn(`⚠️  No se encontró insumo para '${detectedMeatKey}' (Item: ${name})`)
            continue
        }

        // Preparar Receta
        const quantity = PORTIONS[detectedType as keyof typeof PORTIONS]

        // Verificar si ya existe receta para este GUID
        const { data: existing } = await supabase
            .from('recipes')
            .select('id')
            .eq('toast_menu_item_guid', item.guid)
            .eq('inventory_item_id', invItem.id)
            .single()

        if (existing) {
            // console.log(`Skip: ${name} ya tiene receta.`)
            continue
        }

        console.log(`✅ Creando Receta: ${name} -> ${quantity} oz de ${invItem.name}`)

        updates.push({
            toast_menu_item_guid: item.guid,
            inventory_item_id: invItem.id,
            quantity: quantity,
            unit: UNIT
        })
    }

    // Ejecutar Inserciones en Lotes
    if (updates.length > 0) {
        const { error } = await supabase.from('recipes').insert(updates)
        if (error) console.error('Error insertando recetas:', error)
        else console.log(`🚀 ¡Éxito! Se crearon ${updates.length} recetas nuevas.`)
    } else {
        console.log('No se encontraron nuevas recetas para crear.')
    }
}

bulkCreateRecipes()
