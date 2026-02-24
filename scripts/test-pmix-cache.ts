import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

import { getProductMix } from '../lib/toast-pmix'

async function run() {
    console.log('Testing with mergeDiningOptions: false')
    const noMerge = await getProductMix({
        storeId: '42ed15a6-106b-466a-9076-1e8f72451f6b',
        startDate: '2026-02-16',
        endDate: '2026-02-16',
        mergeDiningOptions: false
    })
    console.log('Got', noMerge.length, 'items.')

    console.log('Testing with mergeDiningOptions: true (SHOULD HIT CACHE)')
    const cacheHit = await getProductMix({
        storeId: '42ed15a6-106b-466a-9076-1e8f72451f6b',
        startDate: '2026-02-16',
        endDate: '2026-02-16',
        mergeDiningOptions: true
    })
    console.log('Got', cacheHit.length, 'items.')
    console.log('Groups: ', [...new Set(cacheHit.map(i => i.group_name))])
}

run()
