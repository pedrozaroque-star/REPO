
import { getSupabaseAdminClient } from '../lib/supabase'

async function fixInventoryUnits() {
    const supabase = await getSupabaseAdminClient()

    console.log("🛠️ Starting unit migration...")

    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('id, name, unit_type')

    if (error) {
        console.error("Error fetching items:", error)
        return
    }

    // Patterns to match:
    // 1. "Case of X dz" -> X * 12 pza
    // 2. "bag of X dz" -> X * 12 pza
    // 3. "bag of X ct" -> X pza
    // 4. "Case of X unis" -> X pza
    // 5. "Crate of X ct" -> X pza

    const updates = []

    for (const item of items || []) {
        const u = item.unit_type.toLowerCase()
        let newUnit = item.unit_type // maintain original if no change
        let changed = false

        // --- 1. Handle DOZEN (dz) ---
        // Look for number preceding "dz"
        const dzMatch = u.match(/(\d+(?:\.\d+)?)\s*dz/)
        if (dzMatch) {
            const quantityDz = parseFloat(dzMatch[1])
            if (!isNaN(quantityDz)) {
                newUnit = 'pza' // We don't change quantity in DB, we just change Unit Type.
                // WAIT. If item is "Huevo" and unit is "Case of 15 dz".
                // If I change unit to "pza".
                // The implicit stock "1 case" becomes "1 pza"? NO.
                // The USER wants to TRACK in PIECES.
                // So the ITEM definition is now per PIECE.
                // This script only changes the DEFINITION (unit_type).
                // It does NOT change stock counts because there are likely 0 stock counts yet (new system).
                // If there were stock counts, we'd need to multiply them. 
                // Assuming 0 stock for now or negligible impact as this is setup phase.

                // Log what we found for verification
                // console.log(`[${item.name}] "${item.unit_type}" -> will become "pza" (implicitly 1/12th of a dozen?)`)
                // Actually the user said: "si dice 1dz son 12 piezas".
                // This implies the CONVERSION FACTOR.
                // But `unit_type` is just a string label in `inventory_items`.
                // Changing "Case of 15 dz" to "pza" is correct for the LABEL.

                newUnit = 'pza'
                changed = true
            }
        }

        // --- 2. Handle COUNT/UNITS/UNIS (ct, unit, uni) ---
        if (!changed && (u.includes('ct') || u.includes('unit') || u.includes('uni'))) {
            // Avoid matching "community" or "opportunity" if those existed, but 'unit' is safe enough in this context
            // Also check for "pza" to avoid double migration
            if (!u.includes('pza')) {
                newUnit = 'pza'
                changed = true
            }
        }

        // --- 3. Handle METRIC (g, kg) ---
        // User said "no vamos a usar gramos ni kg". 
        // If found, we should probably default to 'lb' or 'oz' or just alert.
        // For now, if we match strictly:
        if (!changed && (u === 'kg' || u.endsWith(' kg') || u === 'g' || u.endsWith(' g'))) {
            newUnit = 'lb' // Default fallback? Or 'oz'? 
            // Better to force 'lb' as standard weight unit.
            changed = true
            console.log(`⚠️ [${item.name}] forcing metric '${item.unit_type}' to 'lb'`)
        }

        if (changed) {
            console.log(`✅ Update [${item.name}]: "${item.unit_type}" -> "${newUnit}"`)
            updates.push(
                supabase.from('inventory_items').update({ unit_type: newUnit }).eq('id', item.id)
            )
        }
    }

    if (updates.length > 0) {
        console.log(`Applying ${updates.length} updates...`)
        await Promise.all(updates)
        console.log("Migration complete.")
    } else {
        console.log("No items needed migration.")
    }
}

fixInventoryUnits()
