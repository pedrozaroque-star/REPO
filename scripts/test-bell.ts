import { getProductMix } from '../lib/toast-pmix'
import { config } from 'dotenv'
config({ path: '.env.local' })

async function run() {
    try {
        console.log('Testing pmix...')
        const storeId = 'a83901db-2431-4283-834e-9502a2ba4b3b' // Bell
        const items = await getProductMix({ storeId, startDate: '2026-02-16', endDate: '2026-02-22', bundleModifiers: true })
        console.log('Fetched', items.length, 'unique items.')
        const totalNet = items.reduce((sum, i) => sum + Number(i.net_sales), 0)
        console.log('TOTAL NET SALES:', totalNet)
    } catch (e: any) {
        console.error('ERROR:', e.message)
    }
}
run()
