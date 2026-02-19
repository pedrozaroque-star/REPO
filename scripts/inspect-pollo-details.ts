
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectPolloDetails() {
    const { data: item } = await supabase
        .from('inventory_items')
        .select('*')
        .ilike('name', '%Pollo%')
        .limit(1)
        .single() // Asumiendo que es el "Pollo" correcto

    console.log(item)
}

inspectPolloDetails()
