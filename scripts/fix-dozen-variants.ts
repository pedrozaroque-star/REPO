import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function findAndFixDozenVariants() {
    console.log('--- FINDING ALL DOZEN VARIANTS ---')

    // Find items where 'dz' appears anywhere in unit_type OR name, case insensitive
    // Logic: 
    // If unit_type contains 'dz', inspect it.
    // If name contains 'dozen', inspect it.

    // We'll broaden the search significantly
    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('*')
    // Using raw filter for broader search if needed, but 'ilike' is good.

    if (error) { console.error(error); return; }

    console.log(`Scanning ${items.length} total items...`)

    const dozenCandidates = items.filter(item => {
        const u = (item.unit_type || '').toLowerCase()
        const n = (item.name || '').toLowerCase()

        // Match 'dz', 'doz', 'docena'
        if (u.includes('dz') || u.includes('doz') || u.includes('docena')) return true
        if (n.includes('dz') || n.includes('doz') || n.includes('docena')) return true

        return false
    })

    console.log(`Found ${dozenCandidates.length} candidate items.`)

    for (const item of dozenCandidates) {
        let quantity = 0
        let unitMeasure = 'pza'

        const text = `${item.name} ${item.unit_type}`.toLowerCase()

        // Logic to extract quantity
        // 1. "1 dz" -> 12
        // 2. "5 dz" -> 60
        // 3. "15 dz" -> 180
        // 4. "60 ct (5 dz)" -> 60

        // Regex for "X dz"
        const dzMatch = text.match(/(\d+)\s*dz/)
        const dozMatch = text.match(/(\d+)\s*doz/)
        const docenaMatch = text.match(/(\d+)\s*docena/)

        // Simple case: "1 dz" or just "dz" implies 12
        if (item.unit_type.trim() === '1 dz' || item.unit_type.trim() === 'dz') {
            quantity = 12
        }
        else if (dzMatch) {
            const count = parseInt(dzMatch[1])
            quantity = count * 12
        }
        else if (dozMatch) {
            const count = parseInt(dozMatch[1])
            quantity = count * 12
        }
        else if (docenaMatch) {
            const count = parseInt(docenaMatch[1])
            quantity = count * 12
        }

        // Override if explicit count is present e.g. "60ct"
        const ctMatch = text.match(/(\d+)\s*ct/)
        if (ctMatch) {
            // "60 ct" usually overrides "5 dz" calculation, but let's see if they match.
            // 5 * 12 = 60. So 60 is the quantity.
            // We should prioritize the CT if available as it's definitive pieces.
            quantity = parseInt(ctMatch[1])
        }

        if (quantity > 0) {
            console.log(`> Updating: ${item.name} [${item.unit_type}] -> ${quantity} pza`)

            await supabase.from('inventory_items').update({
                quantity_per_unit: quantity,
                unit_measure: 'pza'
            }).eq('id', item.id)

        } else {
            console.log(`? Skipping (Could not determine qty): ${item.name} [${item.unit_type}]`)
        }
    }
}

findAndFixDozenVariants()
