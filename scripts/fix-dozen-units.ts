import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fixDozenUnits() {
    console.log('--- FIXING DOZEN UNITS (dz) ---')

    // 1. Fetch all items that have 'dz' in their unit_type or name
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('*')
        .or('unit_type.ilike.%dz%,name.ilike.%dozen%,name.ilike.%docena%')

    if (error) {
        console.error('Error fetching items:', error)
        return
    }

    console.log(`Found ${items.length} items to potentially update.`)

    for (const item of items) {
        // Semantic checking
        const isDozen =
            item.unit_type.trim().toLowerCase() === '1 dz' ||
            item.unit_type.trim().toLowerCase() === 'dz' ||
            item.unit_type.trim().toLowerCase().includes('docena') ||
            item.unit_type.trim().toLowerCase().includes('dozen')

        if (isDozen) {
            console.log(`Updating item: ${item.name} (Current unit: ${item.unit_type})`)

            // Logic:
            // Set quantity_per_unit = 12
            // Set unit_measure = 'pza'
            // Keep unit_type as is (e.g. '1 dz') or standardize it if inconsistent

            const { error: updateError } = await supabase
                .from('inventory_items')
                .update({
                    quantity_per_unit: 12,
                    unit_measure: 'pza'
                    // We don't change unit_type here, we let it be the 'container' name 
                    // (e.g. '1 dz' is fine as the container name)
                })
                .eq('id', item.id)

            if (updateError) {
                console.error(`  Failed to update ${item.name}:`, updateError.message)
            } else {
                console.log(`  ✅ Updated ${item.name}: 12 pza`)
            }
        } else {
            console.log(`Skipping: ${item.name} (${item.unit_type}) - logic check failed or ambiguous`)
        }
    }
}

fixDozenUnits()
