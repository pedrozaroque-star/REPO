import { supabaseAdmin } from '../lib/supabase'

    ; (async () => {
        console.log("Updating Telera (Bread) to 6 pza unit...")

        // Search "Telera" or "Pan"
        const { data: items } = await supabaseAdmin
            .from('inventory_items')
            .select('*')
            .ilike('name', '%Telera%')

        if (!items || items.length === 0) {
            console.log("No exact match for 'Telera'. Searching 'Pan'...")
            const { data: panItems } = await supabaseAdmin
                .from('inventory_items')
                .select('*')
                .ilike('name', '%Pan%')
            console.log("Found matches for Pan:", panItems?.map(i => i.name))
            return
        }

        console.log("Found Telera items:", items.map(i => i.name))

        const { data, error } = await supabaseAdmin
            .from('inventory_items')
            .update({ unit_type: '6 pza' })
            .ilike('name', '%Telera%')
            .select()

        if (error) {
            console.error("Error updating:", error)
        } else {
            console.log("Updated:", JSON.stringify(data, null, 2))
        }
    })()
