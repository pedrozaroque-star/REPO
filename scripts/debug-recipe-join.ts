
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    // 1. Service Role (Admin)
    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    console.log("--- ADMIN QUERY ---")
    const { data: adminData, error: adminError } = await admin
        .from('recipes')
        .select(`
            toast_menu_item_guid,
            quantity,
            inventory_items (
                id,
                purchase_unit_cost,
                quantity_per_unit,
                yield_percent
            )
        `)
        .limit(2)

    if (adminError) console.error("Admin Error:", adminError)
    else console.log(JSON.stringify(adminData, null, 2))


    // 2. Anon Client (Browser Simulation)
    const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    console.log("\n--- ANON QUERY ---")
    const { data: anonData, error: anonError } = await anon
        .from('recipes')
        .select(`
            toast_menu_item_guid,
            quantity,
            inventory_items (
                id,
                purchase_unit_cost,
                quantity_per_unit,
                yield_percent
            )
        `)
        .limit(2)

    if (anonError) console.error("Anon Error:", anonError)
    else console.log(JSON.stringify(anonData, null, 2))
}

run()
