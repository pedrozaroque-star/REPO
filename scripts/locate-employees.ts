import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function locateEmployees() {
    console.log('Locating stores for Domingo and Isidro...')

    // 1. Get Stores
    const { data: stores, error: storeError } = await supabase
        .from('stores') // Assuming 'stores' table exists
        .select('*')

    const storeMap: Record<string, string> = {}
    if (stores) {
        stores.forEach(s => {
            // Map both id and guid just in case
            if (s.id) storeMap[s.id] = s.name
            if (s.guid) storeMap[s.guid] = s.name
            if (s.toast_guid) storeMap[s.toast_guid] = s.name
        })
    }

    // 2. Get Employees
    const names = ['Domingo Ortiz', 'Isidro Mondragon']

    for (const name of names) {
        const parts = name.split(' ')
        const { data: emps } = await supabase
            .from('toast_employees')
            .select('*')
            .ilike('first_name', `%${parts[0]}%`)
            .ilike('last_name', `%${parts[1]}%`)

        if (emps && emps.length > 0) {
            console.log(`\n--- ${name} ---`)
            emps.forEach(e => {
                const locationIds = e.store_ids || [] // Array of GUIDs
                const locationNames = locationIds.map((id: string) => storeMap[id] || id).join(', ')

                console.log(`Email: ${e.email}`)
                console.log(`Current Locations: ${locationNames}`)
                console.log(`Toast GUID: ${e.toast_guid}`)
            })
        }
    }
}

locateEmployees()
