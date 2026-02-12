import { getSupabaseAdminClient } from '../lib/supabase'

const DEFAULT_CATEGORIES = [
    { name: 'Proteína', description: 'Carnes, Mariscos, Pollo' },
    { name: 'Verduras', description: 'Frescos, Frutas, Verduras' },
    { name: 'Lácteos y Huevos', description: 'Quesos, Leche, Crema' },
    { name: 'Secos y Especias', description: 'Arroz, Frijol, Tortillas, Condimentos' },
    { name: 'Bebidas', description: 'Refrescos, Aguas, Jarabes' },
    { name: 'Alcohol', description: 'Cerveza, Vino, Licor' },
    { name: 'Desechables', description: 'Vasos, Platos, Servilletas' },
    { name: 'Limpieza', description: 'Jabón, Químicos' }
]

async function seed() {
    console.log("🌱 Seeding Inventory Categories...")
    const supabase = await getSupabaseAdminClient()

    // Check if exists
    const { count } = await supabase.from('inventory_categories').select('*', { count: 'exact', head: true })

    if (count && count > 0) {
        console.log("✅ Categories already exist. Skipping.")
        return
    }

    const { error } = await supabase.from('inventory_categories').insert(DEFAULT_CATEGORIES)

    if (error) {
        console.error("❌ Error seeding categories:", error.message)
    } else {
        console.log("✅ Categories seeded successfully!")
    }
}

seed()
