
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function listTables() {
    // This requires pg_catalog access, which service role has.
    // Or we use a known trick: query 'pg_catalog.pg_tables' via rpc or raw sql if allowed?
    // Supabase JS client doesn't do raw SQL easily unless we have an RPC function.
    // Let's try to select from a likely table name or guess.

    // Alternative: check `store_operating_hours` directly.
    const { data, error } = await supabase.from('store_operating_hours').select('*').limit(5)
    if (error) {
        console.log('Error accessing store_operating_hours:', error.message)
    } else {
        console.log('store_operating_hours exists!', data)
        return
    }

    // Try store_hours
    const { data: h2, error: e2 } = await supabase.from('store_hours').select('*').limit(5)
    if (e2) console.log('Error accessing store_hours:', e2.message)
    else console.log('store_hours exists!', h2)

    // Try looking at `stores` columns more deeply
    // We can't describe table easily.
}

listTables()
