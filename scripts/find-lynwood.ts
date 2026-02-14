import { getSupabaseAdminClient } from '../lib/supabase'

async function findLynwood() {
    const supabase = await getSupabaseAdminClient()
    const { data, error } = await supabase
        .from('stores')
        .select('*')
        .ilike('name', '%lynwood%')

    if (error) {
        console.error(error)
    } else {
        console.log(JSON.stringify(data, null, 2))
    }
}

findLynwood()
