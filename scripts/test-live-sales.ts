
import { fetchToastData } from '../lib/toast-api'
import 'dotenv/config'

async function test() {
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    console.log(`Testing Live Sales for Store: ${storeId} Date: ${today}`)

    const res = await fetchToastData({
        storeIds: storeId,
        startDate: today,
        endDate: today,
        groupBy: 'day'
    })

    if (res.connectionError) {
        console.error('Connection Error:', res.connectionError)
    } else {
        console.log('Rows returned:', res.rows.length)
        if (res.rows.length > 0) {
            console.log('Data:', JSON.stringify(res.rows[0], null, 2))
        } else {
            console.log('No rows found! Possible reasons: No orders, Date mismatch, or API filtering.')
        }
    }
}

test()
