import { supabaseAdmin } from '../lib/supabase'

    ; (async () => {
        console.log("Updating Queso Cotija (Tortas/Platos/Desayunos) to 20 pza unit...")

        // We update anything matching "Queso" and "Tortas"
        // List: "Queso Tortas/platos/Desayuno"
        const { data, error } = await supabaseAdmin
            .from('inventory_items')
            .update({ unit_type: '20 pza' })
            .ilike('name', '%Queso%Tortas%') // Matches "Queso Tortas/platos/Desayun"
            .select()

        if (error) {
            console.error("Error:", error)
        } else {
            console.log("Updated:", JSON.stringify(data, null, 2))
        }
    })()
