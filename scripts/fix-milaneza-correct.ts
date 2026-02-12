import { supabaseAdmin } from '../lib/supabase'

    ; (async () => {
        console.log("Updating Milaneza to 20 pza unit...")
        const { data, error } = await supabaseAdmin
            .from('inventory_items')
            .update({ unit_type: '20 pza' })
            .ilike('name', 'Milaneza')
            .select()

        if (error) {
            console.error("Error:", error)
        } else {
            console.log("Updated:", JSON.stringify(data, null, 2))
        }
    })()
