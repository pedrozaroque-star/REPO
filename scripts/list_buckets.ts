
import { getSupabaseAdminClient } from '../lib/supabase'

async function run() {
    const supabase = await getSupabaseAdminClient()
    const { data, error } = await supabase.storage.listBuckets()
    if (error) {
        console.error('Error fetching buckets:', error)
    } else {
        console.table(data.map(b => ({ name: b.name, public: b.public })))
    }
}

run()
