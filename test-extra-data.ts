
import { fetchToastData, ToastMetricsOptions } from './lib/toast-api'

// Mock environment
process.env.TOAST_CLIENT_ID = process.env.TOAST_CLIENT_ID || 'dummy'
process.env.TOAST_CLIENT_SECRET = process.env.TOAST_CLIENT_SECRET || 'dummy'
process.env.TOAST_API_HOST = 'https://ws-api.toasttab.com'

async function run() {
    console.log('Testing Extra Data Fetching...')

    // Use a known date (Yesterday)
    const storeId = '8910822000000000000' // West Covina approx ID, or we fetch all
    const startDate = '2026-01-16'

    // We will use the main function but filter logic inside might be complex
    // Let's rely on the logs I just added to toast-api.ts
    // I need to import getSalesForStore but it is not exported.
    // So I will call fetchToastData with a single store if possible or just run for all

    try {
        const options: ToastMetricsOptions = {
            storeIds: 'all',
            startDate: '2026-01-16',
            endDate: '2026-01-16',
            groupBy: 'day'
        }

        const data = await fetchToastData(options)
        console.log(`Fetched ${data.length} rows.`)

        if (data.length > 0) {
            console.log('Sample Row 0 Top Products:', JSON.stringify(data[0].topProducts, null, 2))
            console.log('Sample Row 0 Sales Mix:', JSON.stringify(data[0].salesMix, null, 2))
        }

    } catch (e) {
        console.error(e)
    }
}

run()
