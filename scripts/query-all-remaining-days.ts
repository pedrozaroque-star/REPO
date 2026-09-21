import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { supabaseAdmin } from '../lib/supabase'

async function getAllRemainingDays() {
    const fridays = ['2026-09-11', '2026-09-04', '2026-08-28', '2026-08-21', '2026-08-14', '2026-08-07']
    const saturdays = ['2026-09-12', '2026-09-05', '2026-08-29', '2026-08-22', '2026-08-15', '2026-08-08']
    const sundays = ['2026-09-13', '2026-09-06', '2026-08-30', '2026-08-23', '2026-08-16', '2026-08-09']

    const allDates = [...fridays, ...saturdays, ...sundays]

    const { data: stores, error: sErr } = await supabaseAdmin
        .from('stores')
        .select('id, external_id, name')
        .eq('is_active', true)
        .order('name')

    if (sErr) throw sErr

    const { data: sales, error: salesErr } = await supabaseAdmin
        .from('sales_daily_cache')
        .select('store_id, business_date, net_sales, order_count')
        .in('business_date', allDates)

    if (salesErr) throw salesErr

    function buildDayTable(dateList: string[]) {
        const tableData: any[] = []
        for (const store of stores || []) {
            const cleanName = store.name.replace(/^Tacos Gavilan\s+/i, '').trim()
            const row: any = { store: cleanName }
            let total = 0
            let count = 0
            for (const d of dateList) {
                const match = sales?.find(s => 
                    (s.store_id === store.external_id || s.store_id === String(store.id)) && 
                    s.business_date === d
                )
                const val = match ? Number(match.net_sales || 0) : 0
                row[d] = val
                total += val
                if (val > 0) count++
            }
            row.total = total
            row.avg = count > 0 ? total / count : 0
            tableData.push(row)
        }
        tableData.sort((a, b) => b.total - a.total)

        const chainTotals: any = { store: 'TOTAL CADENA' }
        for (const d of dateList) {
            chainTotals[d] = tableData.reduce((sum, r) => sum + (r[d] || 0), 0)
        }
        chainTotals.total = tableData.reduce((sum, r) => sum + r.total, 0)
        chainTotals.avg = tableData.reduce((sum, r) => sum + r.avg, 0)

        return { tableData, chainTotals }
    }

    const result = {
        fridays: { dates: fridays, ...buildDayTable(fridays) },
        saturdays: { dates: saturdays, ...buildDayTable(saturdays) },
        sundays: { dates: sundays, ...buildDayTable(sundays) }
    }

    import('fs').then(fs => {
        fs.writeFileSync('scripts/all-remaining-days.json', JSON.stringify(result, null, 2))
        console.log('SAVED_SUCCESSFULLY')
    })
}

getAllRemainingDays().catch(err => {
    console.error(err)
    process.exit(1)
})
