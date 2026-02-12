import { supabase } from '../lib/supabase'

    ; (async () => {
        console.log("🛠️  Iniciando corrección INTELIGENTE de unidades...")
        console.log("==================================================")
        console.log("Objetivo: 'Bag of 10 lbs' -> '10 lb'")

        const { data: items, error } = await supabase.from('inventory_items').select('*')
        if (error) {
            console.error(error)
            process.exit(1)
        }

        let updates = 0

        for (const item of items) {
            let u = item.unit_type?.toLowerCase() || ''
            let newUnit: string | null = null

            // 1. Limpieza de prefijos comunes (Case of, Bag of, Pack of...)
            // Regex: (bag|pack|case|crate|box) (of)? (number)? (unit)?

            // Simpler approach: Extract the NUMBER and the UNIT from the string.
            // Cases:
            // "Bag of 10 lbs" -> "10 lb"
            // "Pack of 12" -> "12 pza" (If no unit, assume pza?)
            // "1.5 oz Salsa Roja Pack" -> "1.5 oz" (Wait, name might be key too)

            // Let's iterate specific patterns to be safe.

            // Pattern: "Bag of X lbs" or "X lbs"
            const lbMatch = u.match(/(?:bag|pack|case|box).*?(\d+(?:\.\d+)?)\s*lbs?/i)
            if (lbMatch) {
                newUnit = `${lbMatch[1]} lb`
            }

            // Pattern: "Bag of X oz" or "X oz"
            const ozMatch = u.match(/(?:bag|pack|case|box).*?(\d+(?:\.\d+)?)\s*oz/i)
            if (ozMatch) {
                newUnit = `${ozMatch[1]} oz`
            }

            // Pattern: "Bag of 1 Gallon" -> "1 gal"
            if (u.includes('gallon') || u.includes('gal')) {
                const galMatch = u.match(/(\d+(?:\.\d+)?)\s*gal/i)
                if (galMatch) {
                    newUnit = `${galMatch[1]} gal`
                } else if (u.includes('1 gallon')) {
                    newUnit = '1 gal'
                }
            }

            // Pattern: "Pack of X" (without unit) -> "X pza"
            // Only if it doesn't match lb/oz/gal above
            if (!newUnit) {
                const pzaMatch = u.match(/(?:pack|case|bag|crate).*?of\s*(\d+)(?:\s*(?:ct|count|pcs|pza|mulitas|teleras|unis))?/i)
                // Special case for "13 mulitas" -> "13 pza"
                if (u.includes('mulita')) {
                    const m = u.match(/(\d+)\s*mulita/i)
                    if (m) newUnit = `${m[1]} pza`
                }
                else if (pzaMatch) {
                    newUnit = `${pzaMatch[1]} pza`
                }
            }

            // Manual Cleanups known from previous list
            if (u.includes('quesadilla') && u.includes('12')) newUnit = '12 pza'
            if (item.name.toLowerCase().includes('telera') && u.includes('6')) newUnit = '6 pza'

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
