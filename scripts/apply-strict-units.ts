import { supabase } from '../lib/supabase'

const updates = [
    // Galones
    { sku: '001W', unit: '1 gal' }, // Horchata
    { sku: '002W', unit: '1 gal' }, // Tamarindo
    { sku: '003W', unit: '1 gal' }, // Jamaica
    { sku: '004W', unit: '1 gal' }, // Piña
    { sku: '005W', unit: '1 gal' }, // Salsa Roja (Bag of 1 Gallon)
    { sku: '006W', unit: '1 gal' }, // Salsa Verde (Bag of 1 Gallon)
    { sku: '037W', unit: '1 gal' }, // Champurrado

    // Salsas Individuales (Crate of 400 ct) -> 400 pza
    { sku: '008W', unit: '400 pza' },
    { sku: '007W', unit: '400 pza' },
    { sku: '009-W', unit: '400 pza' },

    // Carnes (Libras)
    { sku: '009W', unit: '10 lb' }, // Carne Asada
    { sku: '010W', unit: '10 lb' }, // Pastor
    { sku: '011W', unit: '5 lb' },  // Cabeza
    { sku: '012W', unit: '5 lb' },  // Lengua
    { sku: '015W', unit: '10 lb' }, // Pollo
    { sku: '021W', unit: '10 lb' }, // Frijol Entero
    { sku: '022W', unit: '10 lb' }, // Frijol Molido
    { sku: '023W', unit: '5 lb' },  // Onion/Cil Mix
    { sku: '032W', unit: '2 lb' },  // Aguacate
    { sku: '025W', unit: '1.5 lb' }, // Crema
    { sku: '052W', unit: '1.5 lb' }, // Mayonesa
    { sku: '026W', unit: '2 lb' },  // Queso Rayado
    { sku: '033W', unit: '2.3 lb' }, // Salsa Huevos Rancheros
    { sku: '4264802', unit: '6.56 lb' }, // Rajas y Zanahorias (6 lbs 9 oz = ~6.56 lbs or keep precise?) 
    // Wait, 6 lbs 9 oz. Let's start with 'lb' base. 9 oz is 9/16 lb = 0.5625. So 6.5625 lb.
    // Or maybe keep "6 lb 9 oz"? No, user wants numbers. Let's use decimal lbs for now or convert to oz?
    // User might prefer "6.5 lb" roughly? Let's stick to "6.56 lb" for accuracy.
    { sku: '277W', unit: '5 lb' }, // Onion Pepper Mix
    { sku: '273W', unit: '5 lb' }, // Bolsa Lima 5 LB
    { sku: '8602773', unit: '48 lb' }, // Viva Lard

    // Carnes (Onzas)
    { sku: '319W', unit: '6 oz' }, // Buche
    { sku: '320W', unit: '6 oz' }, // Carnitas
    { sku: '321W', unit: '8 oz' }, // Chorizo
    { sku: '017W', unit: '1 lb' },  // Salchicha (Bag of 1 lb)
    { sku: '019W', unit: '2 lb' },  // Jamon Pack
    { sku: '045W', unit: '560 oz' }, // Amarillo Cheese
    { sku: '265W', unit: '4.5 oz' }, // Tortilla Nachos

    // Excepciones (Piezas / Mulas / Teleras)
    { sku: '016W', unit: '20 pza' }, // Milaneza (Antes Bag of 2.6 lbs) -> User Request: 20 pza
    { sku: '024W', unit: '13 pza' }, // Mulitas (Antes 3.06 lbs or 13 mulitas) -> User Request: 13 pza
    { sku: '036W', unit: '12 pza' }, // Quesadilla Bodega (Pack of 12) -> 12 pza
    { sku: '028W', unit: '6 pza' },  // Teleras (Pack of 6) -> 6 pza
    { sku: '044W', unit: '12 pza' }, // Sopes (1 dz) -> 12 pza
    { sku: '034W', unit: '180 pza' }, // Huevo (15 dz) -> 180 pza
    { sku: '1100', unit: '60 pza' },  // Tortilla (5 dz) -> 60 pza
    { sku: '358-9673BT', unit: '12 pza' }, // Flour Tortilla (1 dz) -> 12 pza
    { sku: '043W', unit: '12 pza' }, // Tortilla Regular (1 dz) -> 12 pza
    { sku: '047W', unit: '24 pza' }, // Agua Gavilan (24 unis) -> 24 pza

    // Otros
    { sku: '271W', unit: '3.9 oz' }, // Papelito Para Torta
    { sku: '270W', unit: '190 pza' }, // 1 oz Bolsa de Mixta (Case of 190 ct) -> 190 pza? The unit is 1 oz.
    // Wait, "Case of 190 ct, 1 oz". Probably 190 packs of 1 oz.
    // So unit count is 190.
    { sku: '272W', unit: '165 pza' }, // 2 oz Bolsas de Rajas (Case of 165 ct) -> 165 pza
    { sku: '029W', unit: '1 lb' }, // Queso Tortas (Pack of 1 lb)
    { sku: '020W', unit: '5 lb' }, // Arroz (Bag of 5 lbs)
    { sku: '052W', unit: '1.5 lb' }, // Mayonesa (Bag of 1.5 lb)
    { sku: '027W', unit: '210 pza' }, // Lima Bolsita (Case of 210 ct) - SKU might be 272W duplicate? Image says 272W for "2 oz Bolsas..." AND "Lima Bolsita".
    // I will try to find Lima Bolsita by name if SKU fails.
    { sku: '021', unit: '12 oz' }, // Queso Cotija (Bag of 12 oz)
];

; (async () => {
    console.log("🛠️  Aplicando actualización ESTRICTA de unidades...")

    let success = 0
    let errors = 0

    for (const update of updates) {
        // Try exact SKU match
        const { error } = await supabase
            .from('inventory_items')
            .update({ unit_type: update.unit })
            .eq('sku', update.sku)

        if (error) {
            console.error(`❌ Error actualizando SKU ${update.sku}:`, error.message)
            errors++
        } else {
            success++
        }
    }

    // Special handling for duplicates or missing SKUs
    // "Lima Bolsita" SKU 272W conflicts with "2 oz Bolsas..."
    await supabase.from('inventory_items').update({ unit_type: '210 pza' }).ilike('name', '%Lima Bolsita%')

    console.log(`✅ ${success} actualizaciones enviadas.`)
})()
