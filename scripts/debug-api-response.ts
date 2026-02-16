
import { fetchToastData } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function debug() {
    console.log('--- Simulating "Last Month" Request ---')

    // Frontend sends groupBy='day' usually for charts, OR groupBy='year' for summary?
    // Actually, the summary (cards) is calculated from the rows returned.
    // The screenshot shows "Sales Trend" by Day. So groupBy='day'.

    const res = await fetchToastData({
        storeIds: 'all',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        groupBy: 'day',
        skipCache: false
    })

    // Check rows
    const rows = res.rows
    console.log(`Received ${rows.length} total rows.`)

    // Aggregate Labor Cost
    const totalLabor = rows.reduce((sum, r) => sum + (r.laborCost || 0), 0)
    const totalSales = rows.reduce((sum, r) => sum + (r.netSales || 0), 0)

    console.log('--- AGGREGATION RESULT ---')
    console.log(`Total Sales: $${totalSales.toLocaleString()}`)
    console.log(`Total Labor: $${totalLabor.toLocaleString()}`)

    if (totalLabor === 0) {
        console.error('❌ Labor is ZERO! The API is stripping it somewhere.')
    } else {
        console.log('✅ Labor comes safely from API.')
    }

    // Sample row
    const sample = rows.find(r => r.storeName.includes('Lynwood') && r.periodStart.includes('2025-01-10'))
    console.log('Sample Row (Lynwood Jan 10):', {
        LaborCost: sample?.laborCost,
        NetSales: sample?.netSales
    })
}

debug()
