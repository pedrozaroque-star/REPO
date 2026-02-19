
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function listInventory() {
    const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .or('name.ilike.%Carne%,name.ilike.%Pollo%,name.ilike.%Tripa%,name.ilike.%Cabeza%,name.ilike.%Lengua%,name.ilike.%Buche%,name.ilike.%Carnitas%,name.ilike.%Pastor%')
        .order('name')

    console.table(data)
}
listInventory()
