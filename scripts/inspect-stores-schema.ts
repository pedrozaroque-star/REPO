import { getSupabaseAdminClient } from '../lib/supabase'

async function checkStores() {
    const supabase = await getSupabaseAdminClient()
    const { data, error } = await supabase
        .from('stores')
        .select('*')
        .limit(1)

    if (error) {
        console.error(error)
        return
    }

    console.log('--- Stores Schema ---')
    console.log(data)
}

checkStores()
