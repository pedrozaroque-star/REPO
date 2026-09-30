import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
    console.log('Testing missing employee lookup...')
    const { data: sampleEmps } = await supabase
        .from('toast_employees')
        .select('id, toast_guid, first_name, last_name')
        .limit(2)

    if (sampleEmps && sampleEmps.length > 0) {
        const idToSearch = sampleEmps[0].id
        const guidToSearch = sampleEmps[1]?.toast_guid || 'none'

        console.log(`Searching for ID ${idToSearch} and GUID ${guidToSearch}...`)

        const { data: res1 } = await supabase
            .from('toast_employees')
            .select('id, first_name, last_name')
            .in('id', [idToSearch])

        const { data: res2 } = await supabase
            .from('toast_employees')
            .select('id, first_name, last_name')
            .in('toast_guid', [guidToSearch])

        console.log('Lookup by ID result:', res1)
        console.log('Lookup by GUID result:', res2)
    }
}

main().catch(console.error)
