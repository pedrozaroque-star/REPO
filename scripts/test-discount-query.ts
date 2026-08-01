import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function testWithoutOrderId() {
    const dateStr = '2026-07-28' // 8,655 rows!

    console.log(`--- Fetching all ${dateStr} rows (8,655 rows) without order("id") ---`)
    const t0 = Date.now()
    let allData: any[] = []
    let from = 0
    const pageSize = 1000
    let hasMore = true
    let page = 0

    while (hasMore) {
        page++
        const tPage = Date.now()
        const { data, error } = await supabase
            .from('sales_discounts_log')
            .select('*')
            .eq('business_date', dateStr)
            .range(from, from + pageSize - 1)

        console.log(`Page ${page} (${from}-${from + pageSize - 1}): time = ${Date.now() - tPage}ms, rows = ${data?.length}, error = ${error?.message || 'none'}`)

        if (error) {
            console.error('ERROR:', error)
            break
        }
        if (data) allData = [...allData, ...data]
        if (!data || data.length < pageSize) hasMore = false
        else from += pageSize
    }

    console.log(`Total time for 8,655 rows without order('id'): ${Date.now() - t0}ms. Total fetched = ${allData.length}`)
}

testWithoutOrderId()
