
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function checkDate() {
    const targetDate = '2024-02-14'
    const { data } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .eq('business_date', targetDate)
        .single()

    if (data) {
        console.log(`\n💘 VALENTINE'S DAY 2024 (Lynwood)`)
        console.log(`-----------------------------------`)
        console.log(`💰 Net Sales:   $${data.net_sales.toFixed(2)}`)
        console.log(`🎟️ Tickets:     ${data.total_tickets || 'N/A'}`)
        console.log(`-----------------------------------`)
        console.log(`🕐 Hourly Breakdown:`)

        const sortedHours = Object.entries(data.hourly_data || {})
            .sort((a, b) => Number(a[0]) - Number(b[0]))

        let peakHour = ''
        let maxSales = 0

        sortedHours.forEach(([h, s]) => {
            const sales = Number(s)
            if (sales > maxSales) { maxSales = sales; peakHour = h }
            const bars = '█'.repeat(Math.ceil(sales / 200))
            console.log(`   ${h.padStart(2, '0')}:00 | $${sales.toFixed(0).padStart(4)} | ${bars}`)
        })

        console.log(`-----------------------------------`)
        console.log(`🔥 Peak Hour: ${peakHour}:00 with $${maxSales.toFixed(0)}`)
    } else {
        console.log('No data found for 2024-02-14')
    }
}

checkDate()
