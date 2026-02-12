import { supabaseAdmin } from '../lib/supabase'

    ; (async () => {
        console.log("Updating Milaneza to Piece-based unit...")
        const { data, error } = await supabaseAdmin
            .from('inventory_items')
            .update({ unit_type: '4 pza' })
            .ilike('name', 'Milaneza')
            .select()

        if (error) {
            console.error("Error:", error)
        } else {
            console.log("Updated:", data)
        }
    })()
