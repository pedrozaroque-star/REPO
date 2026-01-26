
import { getSupabaseClient } from '../lib/supabase'
import 'dotenv/config'

async function checkStores() {
    const supabase = await getSupabaseClient()
    const { data: stores, error } = await supabase.from('stores').select('*')
    if (error) console.error(error)
    else console.log(JSON.stringify(stores.map(s => ({ name: s.name, id: s.id, guid: s.external_id })), null, 2))
}

checkStores()
