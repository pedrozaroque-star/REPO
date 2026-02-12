import { supabaseAdmin } from '../lib/supabase'

    ; (async () => {
        console.log("Updating Mulitas Con Queso to 13 pza unit...")

        // Search "Mulitas Con Queso"
        const { data, error } = await supabaseAdmin
            .from('inventory_items')
            .update({ unit_type: '13 pza' })
            .ilike('name', '%Mulitas Con Queso%')
            .select()

        if (error) {
            console.error("Error:", error)
        } else {
            console.log("Updated:", JSON.stringify(data, null, 2))
        }
    })()
