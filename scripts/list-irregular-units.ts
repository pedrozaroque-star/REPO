import { supabase } from '../lib/supabase'

    ; (async () => {
        // Busca items cuya unit_type tenga más de 4 caracteres (ej: "bags", "pza" son ok, "Box of..." son largos)
        // O que contengan espacios.

        // Obtener todo y filtrar el JS para flexibilidad
        const { data, error } = await supabase.from('inventory_items').select('name, unit_type')

        if (error) {
            console.error(error)
            return
        }

        const standardUnits = ['lb', 'oz', 'kg', 'g', 'gal', 'l', 'ml', 'pza', 'caja', 'paq', 'bto']

        const irregulars = data.filter(i => {
            const u = i.unit_type?.toLowerCase()
            return !standardUnits.includes(u)
        })

        console.log(`\n🔍 Encontrados ${irregulars.length} items con unidades irregulares:\n`)

        irregulars.forEach(i => {
            console.log(`- [${i.unit_type}] ${i.name}`)
        })
    })()
