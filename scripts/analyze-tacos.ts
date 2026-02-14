import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function analyzeTacos() {
    console.log('--- ANALYZING TACOS GROUP ---')

    // Fetch by partial group name match locally if possible, or fetch all and filter
    // Since we can't ILIKE group_name easily if it's not indexed or permissioned? No, we can.
    // But let's fetch all items to be safe (it's small enough ~500 rows).

    const { data: items, error } = await supabase
        .from('toast_menu_items')
        .select('*')
        .ilike('name', '%Asada%')

    if (error) { console.error(error); return; }

    console.log(`Found ${items.length} items with 'Asada' in name.`)
    items.forEach(i => console.log(`[${i.guid}] "${i.name}" ($${i.price}) Group: ${i.group_name} [IsMod: ${i.is_modifier}]`))
}

analyzeTacos()
