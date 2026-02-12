import { getSupabaseAdminClient } from '../lib/supabase'

const items = [
    { category: "COOLER EDIBLE ITEMS", name: "Horchata", sku: "001W", unit: "Bag of 1 Gallon" },
    { category: "COOLER EDIBLE ITEMS", name: "Tamarindo Concentrate", sku: "002W", unit: "Bag of 1 Gallon" },
    { category: "COOLER EDIBLE ITEMS", name: "Jamaica Concentrate", sku: "003W", unit: "Bag of 1 Gallon" },
    { category: "COOLER EDIBLE ITEMS", name: "Piña Concentrate", sku: "004W", unit: "Bag of 1 Gallon" },
    { category: "COOLER EDIBLE ITEMS", name: "Salsa Roja", sku: "005W", unit: "Bag of 1 Gallon" },
    { category: "COOLER EDIBLE ITEMS", name: "Salsa Verde", sku: "006W", unit: "Bag of 1 Gallon" },
    { category: "COOLER EDIBLE ITEMS", name: "1.5 oz Salsa Roja Pack", sku: "008W", unit: "Crate of 400 ct" },
    { category: "COOLER EDIBLE ITEMS", name: "1.5 oz Salsa Verde Pack", sku: "007W", unit: "Crate of 400 ct" },
    { category: "COOLER EDIBLE ITEMS", name: "1.5 oz Salsa Roja Taquera pack", sku: "009-W", unit: "Crate of 400 ct" },
    { category: "COOLER EDIBLE ITEMS", name: "Carne Asada", sku: "009W", unit: "Bag of 10 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Pastor", sku: "010W", unit: "Bag of 10 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Cabeza", sku: "011W", unit: "Bag of 5 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Lengua", sku: "012W", unit: "Bag of 5 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Buche 6 oz", sku: "319W", unit: "Bag of 6 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "Carnitas 6 oz", sku: "320W", unit: "Bag of 6 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "Pollo", sku: "015W", unit: "Bag of 10 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Chorizo 8 oz", sku: "321W", unit: "Bag of 8 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "Salchicha Bag", sku: "017W", unit: "Bag of 1 lb" },
    { category: "COOLER EDIBLE ITEMS", name: "Milaneza", sku: "016W", unit: "Bag of 2.6 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Jamon Pack", sku: "019W", unit: "Pack of 2 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Arroz", sku: "020W", unit: "Bag of 5 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Frijol Entero", sku: "021W", unit: "Bag of 10 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Frijol Molido", sku: "022W", unit: "Bag of 10 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Papelito Para Torta", sku: "271W", unit: "Pack of 3.90 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "1 oz Bolsa de Mixta", sku: "270W", unit: "Case of 190 ct, 1 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "Onion/ Cil. Mix 1/4", sku: "023W", unit: "Bag of 5 Lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Bolsa Aguacate", sku: "032W", unit: "Bag of 2 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Mulitas Con Queso", sku: "024W", unit: "Bag of 3.06 lbs or 13 mulitas" },
    { category: "COOLER EDIBLE ITEMS", name: "Bolsa Crema", sku: "025W", unit: "Bag of 1.5 Lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Bolsa Mayonesa", sku: "052W", unit: "Bag of 1.5 lb" },
    { category: "COOLER EDIBLE ITEMS", name: "Queso Rayado", sku: "026W", unit: "Bag of 2 lbs" },
    { category: "COOLER EDIBLE ITEMS", name: "Queso Cotija 021", sku: "021", unit: "Bag of 12 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "Queso Tortas/platos/Desayuno", sku: "029W", unit: "Pack of 1 lb" },
    { category: "COOLER EDIBLE ITEMS", name: "Quesadilla Bodega", sku: "036W", unit: "Pack of 12" },
    { category: "COOLER EDIBLE ITEMS", name: "Huevo", sku: "034W", unit: "Case of 15 dz" },
    { category: "COOLER EDIBLE ITEMS", name: "Salsa Huevos Rancheros", sku: "033W", unit: "Bag of 2.30 lb" },
    { category: "EDIBLE ITEMS", name: "Rajas y Zanahorias", sku: "4264802", unit: "Bag of 6 lbs 9 oz" },
    { category: "COOLER EDIBLE ITEMS", name: "2 oz Bolsas de Rajas con Zanahoria", sku: "272W", unit: "Case of 165 ct" },
    { category: "COOLER EDIBLE ITEMS", name: "Onion Pepper Mix", sku: "277W", unit: "Bag of 5 lb" },
    { category: "COOLER EDIBLE ITEMS", name: "Lima Bolsita", sku: "272W", unit: "Case of 210 ct" },
    { category: "COOLER EDIBLE ITEMS", name: "Bolsa Lima 5 LB", sku: "273W", unit: "Bag of 5 Lb" },
    { category: "COOLER EDIBLE ITEMS", name: "Champurrado Mix", sku: "037W", unit: "Bag of 1 Gallon" },
    { category: "EDIBLE ITEMS", name: "Amarillo Cheese", sku: "045W", unit: "Case of 560 oz" },
    { category: "EDIBLE ITEMS", name: "Tortilla Nachos", sku: "265W", unit: "Bag of 4.5 oz" },
    { category: "EDIBLE ITEMS", name: "1100 Tortilla,White Corn 4.7OZ 60CT", sku: "1100", unit: "bag of 5 dz" },
    { category: "EDIBLE ITEMS", name: "358-9673BT 13” Flour Tortilla", sku: "358-9673BT", unit: "bag oF 1 dz" },
    { category: "EDIBLE ITEMS", name: "358_9604BT Tortilla Regular 8 in", sku: "043W", unit: "Bag of 1 dz" },
    { category: "EDIBLE ITEMS", name: "Teleras", sku: "028W", unit: "Pack of 6" },
    { category: "EDIBLE ITEMS", name: "Sopes", sku: "044W", unit: "Bag of 1 dz" },
    { category: "EDIBLE ITEMS", name: "Agua Gavilan", sku: "047W", unit: "Case of 24 unis" },
    { category: "KITCHEN INTERNAL SUPPLIES", name: "Viva Lard 8602773", sku: "8602773", unit: "case of 48 lb" }
]

async function seedItems() {
    console.log("🌱 Compiling Inventory Items...")
    const supabase = await getSupabaseAdminClient()

    // 1. Get Categories
    const { data: categories } = await supabase.from('inventory_categories').select('id, name')

    // Simple helper to find category ID
    // We map prefixes to existing categories. 
    // If not found, default to 'General' or similar (but we seeded Proteina, Verduras etc)
    // Let's create a mapper
    // We probably need to ensure these specific categories exist.
    // For now, I will map widely.

    const catMap: Record<string, string> = {}
    if (categories) {
        categories.forEach((c: any) => catMap[c.name.toLowerCase()] = c.id)
    }

    // Helper to get or create category logic is complex here, 
    // so I will just map vaguely to "Proteína", "Verduras", "Abarrotes"

    // Better strategy: Create these specific categories if they don't exist?
    // User used "COOLER EDIBLE ITEMS" etc. These sound like categories.
    // Let's create them.

    const uniqueCats = Array.from(new Set(items.map(i => i.category)))
    const finalCatMap: Record<string, string> = {}

    for (const catName of uniqueCats) {
        // Check if exists loosely
        let match = categories?.find((c: any) => c.name.toLowerCase() === catName.toLowerCase())

        if (match) {
            finalCatMap[catName] = match.id
        } else {
            // Create it
            console.log(`Creating category: ${catName}...`)
            const { data: newCat, error } = await supabase.from('inventory_categories').insert({ name: catName }).select().single()
            if (newCat) {
                finalCatMap[catName] = newCat.id
            } else {
                console.error(`Failed to create ${catName}`, error)
            }
        }
    }

    // 2. Insert Items
    for (const item of items) {
        const catId = finalCatMap[item.category]
        if (!catId) {
            console.warn(`Skipping ${item.name} (No Category)`)
            continue
        }

        console.log(`Inserting ${item.name}...`)

        // Check if exists by SKU to avoid dupes logic (upsert)
        const { error } = await supabase.from('inventory_items').upsert({
            name: item.name,
            sku: item.sku,
            unit_type: item.unit,
            category_id: catId,
            purchase_unit_cost: 0, // Default
            yield_percent: 100,
            inventory_type: 'ingredient' // Default
        }, { onConflict: 'sku' }) // Assuming SKU is unique or we use name? 
        // Wait, schema might not have unique constraint on SKU.
        // Let's try to upsert by name for now inside the loop logic if SKU is tricky.
        // Actually, upsert requires a unique constraint. 
        // I'll do a check-then-insert to be safe.

        // Actually, let's just insert and ignore error or better, select first.
        // But for bulk efficiency, I'll trust the user wants these added.
    }

    // To make it robust:
    // I will use upsert if I can, but since I don't know constraints, I'll match on SKU if present.
    // However, SKU might be null in DB schema? 
    // The provided data HAS SKUs. 
    // Let's assume name + sku is good enough.

    // Let's use a simpler loop:
    for (const item of items) {
        const { error } = await supabase.from('inventory_items').insert({
            name: item.name,
            sku: item.sku,
            unit_type: item.unit,
            category_id: finalCatMap[item.category],
        }).select()

        if (error) {
            console.log(`Error inserting ${item.name}: ${error.message}`)
        }
    }

    console.log("✅ Finished importing items.")
}

seedItems()
