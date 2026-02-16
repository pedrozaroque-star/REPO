import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkDupes() {
    console.log('Searching everywhere (including deleted) for conflicts...')

    // Check for Domingo Ortiz
    console.log('\n--- DOMINGO ORTIZ (All Records) ---')
    const { data: domingos } = await supabase
        .from('toast_employees')
        .select('*')
        .ilike('first_name', '%Domingo%')
        .ilike('last_name', '%Ortiz%')

    if (domingos) {
        domingos.forEach(e => {
            console.log(`Store: ${e.restaurant_id} | Name: ${e.first_name} ${e.last_name} | Email: ${e.email} | Deleted: ${e.deleted}`)
        })
    }

    // Check for Isidro Mondragon
    console.log('\n--- ISIDRO MONDRAGON (All Records) ---')
    const { data: isidros } = await supabase
        .from('toast_employees')
        .select('*')
        .ilike('first_name', '%Isidro%')
        .ilike('last_name', '%Mondragon%')

    if (isidros) {
        isidros.forEach(e => {
            console.log(`Store: ${e.restaurant_id} | Name: ${e.first_name} ${e.last_name} | Email: ${e.email} | Deleted: ${e.deleted}`)
        })
    }
}

checkDupes()
