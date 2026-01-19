
import { fetchToastData } from './lib/toast-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testFetch() {
    console.log("🚀 TESTING QUARTER LIMIT")
    const today = new Date()
    const quarterAgo = new Date()
    quarterAgo.setDate(today.getDate() - 90)

    const startDate = quarterAgo.toISOString().split('T')[0]
    const endDate = today.toISOString().split('T')[0]

    // Fetch data
    await fetchToastData({
        storeIds: 'all',
        startDate,
        endDate,
        groupBy: 'week'
    })
}

testFetch()
