
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing credentials')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function diagnose() {
    console.log('🔍 Diagnosing Google Reviews Data...\n')

    // 1. Get all stores
    const { data: stores } = await supabase.from('stores').select('id, name')
    if (!stores) return

    // 2. Get recent reviews stats
    const { data: reviews } = await supabase
        .from('customer_feedback')
        .select('store_id, submission_date')
        .eq('source', 'google')
        .order('submission_date', { ascending: false })
        .limit(500) // Look at last 500 reviews

    if (!reviews || reviews.length === 0) {
        console.log('❌ No Google reviews found in the database (or permission error).')
        return
    }

    console.log(`📊 Analyzed last ${reviews.length} reviews.`)

    const storeStats: Record<string, { lastDate: string, countLast7Days: number }> = {}

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    reviews.forEach(r => {
        if (!storeStats[r.store_id]) {
            storeStats[r.store_id] = { lastDate: r.submission_date, countLast7Days: 0 }
        }

        // Update max date if newer found (though we ordered desc, so first is newest)
        if (new Date(r.submission_date) > new Date(storeStats[r.store_id].lastDate)) {
            storeStats[r.store_id].lastDate = r.submission_date
        }

        if (new Date(r.submission_date) >= sevenDaysAgo) {
            storeStats[r.store_id].countLast7Days++
        }
    })

    console.log('\n🏥 Status per Store:')
    console.table(stores.map(s => {
        const stat = storeStats[s.id]
        return {
            Store: s.name,
            'Last Review': stat ? new Date(stat.lastDate).toLocaleDateString() : 'N/A',
            'Reviews (7 Days)': stat ? stat.countLast7Days : 0,
            'Status': stat && stat.countLast7Days > 0 ? '✅ Active' : '⚠️ Stale'
        }
    }))
}

diagnose()
