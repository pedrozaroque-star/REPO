import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function analyzeMenuStructure() {
    console.log('--- ANALYZING MENU STRUCTURE ---')

    const { data: items, error } = await supabase
        .from('toast_menu_items')
        .select('*')

    if (error) {
        console.error('Error fetching menu items:', error)
        return
    }

    // Separate groups
    const thirdPartyItems = items.filter(i => (i.group_name || '').toLowerCase().includes('3rd party'))
    const regularItems = items.filter(i => !(i.group_name || '').toLowerCase().includes('3rd party'))

    console.log(`Total Items: ${items.length}`)
    console.log(`3rd Party Items: ${thirdPartyItems.length}`)
    console.log(`Regular Items: ${regularItems.length}`)

    // Analyze overlaps
    // Specifically looking for "Burritos" as per user context
    const thirdPartyBurritos = thirdPartyItems.filter(i => (i.group_name || '').includes('Burritos'))

    console.log(`\n--- 3rd Party Burritos (${thirdPartyBurritos.length}) ---`)

    for (const tpItem of thirdPartyBurritos) {
        // Try to find a match in regular items
        // Simple name match first
        const match = regularItems.find(r => r.name.toLowerCase().trim() === tpItem.name.toLowerCase().trim())

        if (match) {
            console.log(`✅ MATCH FOUND: "${tpItem.name}"`)
            console.log(`   - 3rd Party: [${tpItem.group_name}] $${tpItem.price}`)
            console.log(`   - Regular:   [${match.group_name}] $${match.price}`)
        } else {
            // Try partial match or manually scanning
            // Maybe "Burrito Asada" vs "Asada Burrito"
            console.log(`❌ NO EXACT MATCH: "${tpItem.name}"`)

            // Fuzzy check
            const fuzzy = regularItems.find(r => r.name.toLowerCase().includes(tpItem.name.toLowerCase()) || tpItem.name.toLowerCase().includes(r.name.toLowerCase()))
            if (fuzzy) {
                console.log(`   ? Potential partial match: "${fuzzy.name}" [${fuzzy.group_name}]`)
            }
        }
    }

    console.log('\n--- REGULAR MENU ITEMS ---')
    // Group by group_name
    const groups: Record<string, string[]> = {}
    regularItems.forEach(i => {
        const g = i.group_name || 'Uncategorized'
        if (!groups[g]) groups[g] = []
        groups[g].push(i.name)
    })

    console.log('\n--- ANALYZING MODIFIERS ---')
    const modifiers = items.filter(i => i.is_modifier)
    console.log(`Total Modifiers: ${modifiers.length}`)

    // Search for Asada
    const asadaMods = modifiers.filter(i => i.name.toLowerCase().includes('asada'))
    console.log(`\nAsada Modifiers (${asadaMods.length}):`)
    asadaMods.forEach(m => console.log(`  - ${m.name} [${m.group_name}]`))

    // Search for Pastor
    const pastorMods = modifiers.filter(i => i.name.toLowerCase().includes('pastor'))
    console.log(`\nPastor Modifiers (${pastorMods.length}):`)
    pastorMods.forEach(m => console.log(`  - ${m.name} [${m.group_name}]`))
}

analyzeMenuStructure()
