import { supabase } from '../lib/supabase'

    ; (async () => {
        console.log("🛠️  CORRIGIENDO DOCENAS (dz) A PIEZAS (pza)...")

        // Lista específica de problemas
        const fixes = [
            { name: 'Huevo', correct: '180 pza' }, // 15 dz
            { name: '1100 Tortilla', correct: '60 pza' }, // 5 dz
            { name: '358-9673BT', correct: '12 pza' }, // 1 dz
            { name: '358_9604BT', correct: '12 pza' }, // 1 dz
            { name: 'Sopes', correct: '12 pza' }, // 1 dz
        ]

        for (const fix of fixes) {
            // Buscar item por parte del nombre
            const { data: items, error } = await supabase.from('inventory_items').select('*').ilike('name', `%${fix.name}%`)

            if (error) {
                console.error(error)
                continue
            }

            for (const item of items) {
                console.log(`✏️  [${item.name}]: Corrigiendo a "${fix.correct}" (antes: "${item.unit_type}")`)

                await supabase
                    .from('inventory_items')
                    .update({ unit_type: fix.correct })
                    .eq('id', item.id)
            }
        }
        console.log("✅ Listo. Corregidos Sopes, Tortillas y Huevo.")
    })()
