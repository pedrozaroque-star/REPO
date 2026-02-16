import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function findSpecificEmployees() {
    console.log('Searching for Domingo Ortiz and Isidro Mondragon...')
    const names = [
        { first: 'Domingo', last: 'Ortiz' },
        { first: 'Isidro', last: 'Mondragon' }
    ]

    for (const p of names) {
        console.log(`\n--- Searching for: ${p.first} ${p.last} ---`)
        const { data, error } = await supabase
            .from('toast_employees')
            .select('*')
            .ilike('first_name', `%${p.first}%`)
            .ilike('last_name', `%${p.last}%`)

        if (error) {
            console.error(`Error searching for ${p.first} ${p.last}:`, error.message)
            continue
        }

        if (!data || data.length === 0) {
            console.log(`No match for ${p.first} ${p.last}`)

            // Fallback: Try searching just matching first name or last name loosely
            console.log('  Trying broader search...')
            const { data: loose } = await supabase
                .from('toast_employees')
                .select('*')
                .or(`first_name.ilike.%${p.first}%,last_name.ilike.%${p.last}%`)
                .limit(5)

            if (loose && loose.length > 0) {
                console.log(`  Found similar names:`)
                loose.forEach(e => console.log(`  - ${e.first_name} ${e.last_name} (Email: ${e.email || 'None'})`))
            } else {
                console.log('  No similar names found.')
            }

        } else {
            console.log(`Found ${data.length} match(es):`)
            data.forEach(e => {
                console.log(`  ID: ${e.id}`)
                console.log(`  Name: ${e.first_name} ${e.last_name}`)
                console.log(`  Toast GUID: ${e.toast_guid}`)
                console.log(`  Email: ${e.email || '(None)'}`)
                console.log(`  Deleted: ${e.deleted}`)
                console.log(`  Last Updated: ${e.last_updated}`)
                console.log(`  Wage Data: ${JSON.stringify(e.wage_data)}`)
            })
        }
    }
}

findSpecificEmployees()
