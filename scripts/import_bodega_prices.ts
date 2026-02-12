import { supabaseAdmin } from '../lib/supabase'

const updates = [
    { name: 'Horchata', price: 4.45, unit: '1 Gallon', note: 'Bag' },
    { name: 'Tamarindo Concentrate', price: 2.71, unit: '1 Gallon', note: 'Bag' },
    { name: 'Jamaica Concentrate', price: 3.12, unit: '1 Gallon', note: 'Bag' },
    { name: 'Piña Concentrate', price: 4.50, unit: '1 Gallon', note: 'Bag' },
    { name: 'Salsa Roja', price: 7.96, unit: '1 Gallon', note: 'Bag' },
    { name: 'Salsa Verde', price: 6.61, unit: '1 Gallon', note: 'Bag' },
    { name: 'Salsa Roja Pack', price: 30.00, unit: '400 ct', note: 'Crate' },
    { name: 'Salsa Verde Pack', price: 30.00, unit: '400 ct', note: 'Crate' },
    { name: 'Carne Asada', price: 61.20, unit: '10 lb', note: 'Bag' },
    { name: 'Pastor', price: 26.22, unit: '10 lb', note: 'Bag' },
    { name: 'Cabeza', price: 19.28, unit: '5 lb', note: 'Bag' },
    { name: 'Lengua', price: 33.00, unit: '5 lb', note: 'Bag' },
    { name: 'Buche', price: 1.90, unit: '6 oz', note: 'Bag' }, // Check if this matches DB Item
    { name: 'Carnitas', price: 2.20, unit: '6 oz', note: 'Bag' },
    { name: 'Pollo', price: 19.80, unit: '10 lb', note: 'Bag' },
    { name: 'Chorizo', price: 1.60, unit: '8 oz', note: 'Bag' },
    { name: 'Salchicha', price: 3.00, unit: '1 lb', note: 'Bag' },
    { name: 'Milaneza', price: 15.00, unit: '2.6 lb', note: 'Bag' },
    { name: 'Jamon', price: 9.216, unit: '2 lb', note: 'Pack' }, // 'Jamon Pack'
    { name: 'Arroz', price: 5.58, unit: '5 lb', note: 'Bag' },
    { name: 'Frijol Entero', price: 2.91, unit: '10 lb', note: 'Bag' },
    { name: 'Frijol Molido', price: 4.27, unit: '10 lb', note: 'Bag' },
    { name: 'Papelito Para Torta', price: 0.58, unit: '3.90 oz', note: 'Pack' },
    { name: 'Bolsa de Mixta', price: 23.00, unit: '190 ct', note: 'Case 1 oz' },
    { name: 'Onion/ Cil. Mix', price: 10.40, unit: '5 lb', note: 'Bag' },
    { name: 'Bolsa Aguacate', price: 6.56, unit: '2 lb', note: 'Bag' },
    { name: 'Mulitas Con Queso', price: 7.73, unit: '3.06 lb', note: 'Bag' }, // or 13 mulitas
    { name: 'Bolsa Crema', price: 3.20, unit: '1.5 lb', note: 'Bag' },
    { name: 'Bolsa Mayonesa', price: 3.10, unit: '1.5 lb', note: 'Bag' },
    { name: 'Queso Rayado', price: 6.27, unit: '2 lb', note: 'Bag' },
    { name: 'Queso Cotija', price: 4.79, unit: '12 oz', note: 'Bag' },
    { name: 'Queso Tortas', price: 3.28, unit: '1 lb', note: 'Pack' },
    { name: 'Quesadilla Bodega', price: 9.50, unit: '12 ct', note: 'Pack' }, // 'Pack of 12'
    { name: 'Huevo', price: 50.00, unit: '15 dz', note: 'Case' },
    { name: 'Salsa Huevos Rancheros', price: 10.00, unit: '2.30 lb', note: 'Bag' },
    { name: 'Rajas y Zanahorias', price: 6.228, unit: '6.56 lb', note: 'Bag' }, // 6lb 9oz = 6.5625 lb
    { name: 'Onion Pepper Mix', price: 4.32, unit: '5 lb', note: 'Bag' },
    { name: 'Lima Bolsita', price: 19.20, unit: '210 ct', note: 'Case' },
    { name: 'Bolsa Lima 5', price: 10.80, unit: '5 lb', note: 'Bag' },
    { name: 'Champurrado Mix', price: 10.32, unit: '1 Gallon', note: 'Bag' },
    { name: 'Amarillo Cheese', price: 58.80, unit: '560 oz', note: 'Case' },
    { name: 'Tortilla Nachos', price: 1.26, unit: '4.5 oz', note: 'Bag' },
    { name: 'Tortilla,White Corn', price: 1.50, unit: '5 dz', note: 'Bag' }, // 60ct = 5dz
    { name: 'Flour Tortilla', price: 2.70, unit: '1 dz', note: 'Bag' },
    { name: 'Tortilla Regular 8', price: 1.22, unit: '1 dz', note: 'Bag' },
    { name: 'Teleras', price: 3.00, unit: '6 pza', note: 'Pack' },
    { name: 'Sopes', price: 2.48, unit: '1 dz', note: 'Bag' },
    { name: 'Agua Gavilan', price: 9.00, unit: '24 ct', note: 'Case' },
    { name: 'Viva Lard', price: 79.90, unit: '48 lb', note: 'Case' }
]

    ; (async () => {
        console.log("🚀 Starting Price Import...")
        let updated = 0
        let notFound = 0

        for (const item of updates) {
            // 1. Find the item loosely
            const { data: dbItems } = await supabaseAdmin
                .from('inventory_items')
                .select('*')
                .ilike('name', `%${item.name}%`)
                .limit(1)

            if (dbItems && dbItems.length > 0) {
                const dbItem = dbItems[0]
                console.log(`✅ MATCH: '${item.name}' -> DB: '${dbItem.name}'`)

                // 2. Update
                const { error: updateError } = await supabaseAdmin
                    .from('inventory_items')
                    .update({
                        purchase_unit_cost: item.price,
                        // Optionally update unit_type if current is generic, but let's be careful.
                        // Ideally we sync the unit to allow calculation.
                        // If DB says 'pza' but we have '10 lb', we should likely update it.
                        unit_type: item.unit
                    })
                    .eq('id', dbItem.id)

                if (!updateError) {
                    console.log(`   💰 Updated Price: $${item.price} / ${item.unit}`)
                    updated++
                } else {
                    console.error(`   ❌ Failed to update: ${updateError.message}`)
                }
            } else {
                console.warn(`⚠️ NOT FOUND: '${item.name}'`)
                notFound++
            }
        }

        console.log(`\n🏁 Done! Updated: ${updated}, Not Found: ${notFound}`)
    })()
