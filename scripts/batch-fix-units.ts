import { supabase } from '../lib/supabase'

    ; (async () => {
        console.log("🛠️  Iniciando corrección masiva de unidades...")

        const { data: items, error } = await supabase.from('inventory_items').select('*')
        if (error) {
            console.error(error)
            process.exit(1)
        }

        let updates = 0

        for (const item of items) {
            let newUnit: string | null = null
            const u = item.unit_type?.toLowerCase() || ''

            // 1. Libras (lbs)
            if (u.includes('lb') && (u.includes('bag') || u.includes('pack') || u.includes('case'))) {
                // "Bag of 10 lbs" -> "lb"
                newUnit = 'lb'
            }

            // 2. Onzas (oz)
            else if (u.includes('oz') && (u.includes('bag') || u.includes('pack') || u.includes('case'))) {
                // "Bag of 6 oz" -> "oz"
                newUnit = 'oz'
            }

            // 3. Galones (Gallon)
            else if (u.includes('gallon') || u.includes('gal')) {
                // "Bag of 1 Gallon" -> "gal"
                newUnit = 'gal'
            }

            // 4. Piezas (Quesadillas / Teleras)
            else if ((item.name.toLowerCase().includes('quesadilla') || item.name.toLowerCase().includes('telera')) && u.includes('pack')) {
                // "Pack of 12" -> "pza" (Confirmed by user)
                newUnit = 'pza'
            }

            // Apply Update
            if (newUnit && newUnit !== item.unit_type) {
                console.log(`✏️  [${item.name}]: "${item.unit_type}" -> "${newUnit}"`)

                const { error: updateError } = await supabase
                    .from('inventory_items')
                    .update({ unit_type: newUnit })
                    .eq('id', item.id)

                if (updateError) console.error(`❌ Error updating ${item.name}:`, updateError)
                else updates++
            }
        }

        console.log(`\n✅ Proceso completado. ${updates} items actualizados.`)
    })()
