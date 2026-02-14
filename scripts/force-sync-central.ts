
import { syncToastPunches } from '../lib/toast-labor'
import { getSupabaseClient } from '../lib/supabase'

async function main() {
    const storeId = '8685e942-3f07-403a-afb6-faec697cd2cb' // LA Central
    // Target Day: Feb 12 (Thursday)
    // Sync Range: Feb 11 - Feb 13
    const start = '2026-02-11T00:00:00.000+0000'
    const end = '2026-02-13T23:59:59.999+0000'

    console.log('1. Force syncing LA Central labor...')
    const result = await syncToastPunches(storeId, start, end)
    console.log('Sync Result:', result)

    console.log('2. Inspecting DB Data for Feb 12...')
    const supabase = await getSupabaseClient()
    const { data: punches, error } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', storeId)
        .eq('business_date', '2026-02-12')

    if (error) {
        console.error('Error fetching punches:', error)
        return
    }

    console.log(`Found ${punches.length} punches for Feb 12.`)

    let totalRegular = 0
    let totalOvertime = 0
    let estimatedCost = 0

    punches.forEach(p => {
        const reg = p.regular_hours || 0
        const ot = p.overtime_hours || 0
        const wage = p.hourly_wage || 0

        totalRegular += reg
        totalOvertime += ot
        estimatedCost += (reg * wage) + (ot * wage * 1.5)
    })

    console.log('--- Summary Feb 12 ---')
    console.log(`Total Regular Hours: ${totalRegular.toFixed(2)}`)
    console.log(`Total Overtime Hours: ${totalOvertime.toFixed(2)}`)
    console.log(`Total Hours: ${(totalRegular + totalOvertime).toFixed(2)}`)
    console.log(`Estimated Gross Pay: $${estimatedCost.toFixed(2)}`)
}

main()
