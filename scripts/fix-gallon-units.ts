
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
    console.log("Scanning for items to fix...")

    // 1. Fetch candidates
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('*')
        .or('unit_type.ilike.%gallon%,unit_type.ilike.%gal%')
        .eq('unit_measure', 'pza')

    if (error) {
        console.error("Error fetching candidates:", error)
        return
    }

    console.log(`Found ${items?.length} items with Gallon/Gal in description but 'pza' measure.`)

    if (!items || items.length === 0) return

    // 2. Update them
    for (const item of items) {
        console.log(`Fixing: ${item.name} (${item.unit_type}) -> Setting unit_measure to 'gal'`)

        const { error: updateError } = await supabase
            .from('inventory_items')
            .update({ unit_measure: 'gal' })
            .eq('id', item.id)

        if (updateError) console.error(`Failed to update ${item.name}:`, updateError)
        else console.log(`  ✅ Updated.`)
    }

    console.log("Done.")
}

main()
