// 📊 Script de diagnóstico: Ver qué tiene hourly_data en el caché
// Run: npx tsx scripts/diagnose-hourly-cache.ts

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function diagnose() {
    console.log('📊 Diagnóstico del caché hourly_data\n')

    // Buscar los últimos 4 domingos (hoy es domingo 2 Feb 2026)
    const lookbackDates = [
        '2026-01-26', // Último domingo
        '2026-01-19',
        '2026-01-12',
        '2026-01-05'
    ]

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, net_sales, hourly_data')
        .in('business_date', lookbackDates)
        .gt('net_sales', 0)
        .limit(30)

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log(`Encontrados ${data?.length || 0} registros\n`)

    // Mostrar primeros 5 registros
    data?.slice(0, 5).forEach(row => {
        console.log(`📅 ${row.business_date} | Store: ${row.store_id.slice(0, 8)}...`)
        console.log(`   Net Sales: $${row.net_sales.toFixed(2)}`)

        const hourly = row.hourly_data || {}
        const hourlyEntries = Object.entries(hourly) as [string, number][]

        // Mostrar horas 9-14 (horas pico)
        console.log('   Hourly Data (9am-2pm):')
        for (let h = 9; h <= 14; h++) {
            const val = hourly[h] || hourly[h.toString()] || 0
            console.log(`     Hour ${h}: $${Number(val).toFixed(2)}`)
        }

        // Suma total de hourly_data
        const totalHourly = hourlyEntries.reduce((sum, [_, v]) => sum + Number(v), 0)
        console.log(`   Suma Total Hourly: $${totalHourly.toFixed(2)}`)
        console.log(`   Diferencia: $${(row.net_sales - totalHourly).toFixed(2)}\n`)
    })
}

diagnose().catch(console.error)
