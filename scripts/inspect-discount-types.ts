import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function inspect() {
    const { data } = await supabase.from('sales_discounts_log')
        .select('discount_name, discount_amount, store_name')
        .eq('business_date', '2026-07-28')
        .limit(100)

    const counts: Record<string, number> = {}
    data?.forEach(d => {
        counts[d.discount_name] = (counts[d.discount_name] || 0) + 1
    })

    console.log('Sample discount counts on 2026-07-28:', counts)
}

inspect()
