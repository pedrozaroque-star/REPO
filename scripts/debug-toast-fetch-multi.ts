
import { fetchToastData } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function debug() {
    console.log('--- Fetching for Range (2025-02-10 to 2025-02-12) ---')
    const res = await fetchToastData({
        storeIds: 'all',
        startDate: '2025-02-10',
        endDate: '2025-02-12',
        groupBy: 'day',
        skipCache: false
    })

    // Filter for one store
    const storeRows = res.rows.filter(r => r.storeName.includes('West Covina'))
    console.table(storeRows.map(r => ({
        Date: r.periodStart,
        NetSales: r.netSales,
        LaborCost: r.laborCost
    })))
}

debug()
