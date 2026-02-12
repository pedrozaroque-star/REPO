import { supabase } from '../lib/supabase'

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

    ; (async () => {
        console.log("↩️  MIGRANDO UNIDADES A SU ESTADO ORIGINAL...")
        console.log("==========================================")

        let restored = 0
        let errors = 0

        for (const item of items) {
            // Find by SKU (Most reliable) or Name
            // Try SKU first
            let { data: existing, error } = await supabase.from('inventory_items').select('id, name, unit_type').eq('sku', item.sku).maybeSingle()

            if (!existing && !error) {
                // Fallback to name
                const { data: byName, error: nameError } = await supabase.from('inventory_items').select('id, name, unit_type').ilike('name', item.name).maybeSingle()
                existing = byName
            }

            if (existing) {
                // Restore ORIGINAL UNIT string (no normalization)
                const { error: updateError } = await supabase.from('inventory_items').update({ unit_type: item.unit }).eq('id', existing.id)

                if (updateError) {
                    console.error(`❌ Error restaurando [${item.name}]:`, updateError.message)
                    errors++
                } else {
                    console.log(`✅ Restaurado: [${item.name}] -> "${item.unit}"`)
                    restored++
                }
            } else {
                console.warn(`⚠️  Item no encontrado para restaurar: [${item.name}] (SKU: ${item.sku})`)
            }
        }

        console.log("\n==========================================")
        console.log(`Restaurados: ${restored}`)
        console.log(`Errores: ${errors}`)
    })()
