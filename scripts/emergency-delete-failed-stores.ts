
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function emergencyCleanup() {
    console.log('🚨 Starting Emergency Cleanup...')

    // 1. Get stores created in the last 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { data: recentStores, error } = await supabase
        .from('stores')
        .select('*')
        .gt('created_at', oneHourAgo)

    if (error) {
        console.error('Error finding recent stores:', error)
        return
    }

    if (recentStores.length === 0) {
        console.log('✅ No stores created in the last hour. Safe.')
        return
    }

    console.log(`⚠️ Found ${recentStores.length} potentially duplicate stores created recently:`)
    recentStores.forEach(s => console.log(`   - ${s.name} (ID: ${s.id})`))

    // 2. Filter for deletion (Long names typical of Toast sync)
    const toDelete = recentStores.filter(s => s.name.includes('Tacos Gavilan ('))

    if (toDelete.length === 0) {
        console.log('ℹ️ No stores match the duplicate pattern "Tacos Gavilan (...)". Skipping deletion.')
        return
    }

    console.log(`🗑️ Deleting ${toDelete.length} duplicates...`)

    for (const store of toDelete) {
        const { error: delErr } = await supabase.from('stores').delete().eq('id', store.id)
        if (delErr) console.error(`Failed to delete ${store.name}:`, delErr)
        else console.log(`Deleted: ${store.name}`)
    }

    console.log('✅ Cleanup complete.')
}

emergencyCleanup()
