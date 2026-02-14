
import { getSupabaseClient } from '@/lib/supabase'

async function main() {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.from('stores').select('id, name, external_id').ilike('name', '%Central%')
    if (error) console.error(error)
    else console.log(JSON.stringify(data, null, 2))
}

main()
