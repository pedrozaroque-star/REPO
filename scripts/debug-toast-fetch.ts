
import { fetchToastData } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function debug() {
    // Check specifically for Yesterday (Feb 13)
    // This should come from cache if present.
    console.log('--- Fetching for Yesterday (2025-02-13) ---')
    const res = await fetchToastData({
        storeIds: 'all',
        startDate: '2025-02-13',
        endDate: '2025-02-13',
        groupBy: 'day', // Changed from hour to day to clear build error
        skipCache: false
    })

    // Check one store
    const storeRow = res.rows.find(r => r.storeName.includes('West Covina'))
    console.log('West Covina (Yesterday):', {
        NetSales: storeRow?.netSales,
        LaborCost: storeRow?.laborCost
    })
}

debug()
