
import { fetchToastData } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function backfill() {
    // Backfill specifically for Jan 2025 and Feb 2025
    // We do it in chunks of 5 days to handle API limits gracefully
    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-14')

    console.log(`🚀 Starting Backfill Process from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...`)

    let current = new Date(startDate)

    while (current <= endDate) {
        const chunkStart = new Date(current)
        const chunkEnd = new Date(current)
        chunkEnd.setDate(chunkEnd.getDate() + 4) // 5 day chunk

        // Cap at endDate
        const effectiveEnd = chunkEnd > endDate ? endDate : chunkEnd

        const sStr = chunkStart.toISOString().split('T')[0]
        const eStr = effectiveEnd.toISOString().split('T')[0]

        console.log(`📦 Processing Chunk: ${sStr} to ${eStr}...`)

        try {
            // Calling fetchToastData will handle fetching + Writing to Cache (because readOnly=false by default)
            // We pass skipCache=true to FORCE it to fetch from API and update cache
            await fetchToastData({
                storeIds: 'all',
                startDate: sStr,
                endDate: eStr,
                groupBy: 'day',
                skipCache: true // FORCE API FETCH + WRITE BACK
            })
            console.log(`✅ Chunk ${sStr} - ${eStr} completed.`)
        } catch (e) {
            console.error(`❌ Error processing chunk ${sStr} - ${eStr}:`, e)
            // Continue to next chunk anyway
        }

        // Move next
        current.setDate(current.getDate() + 5)

        // Moral delay to be nice to API
        await new Promise(r => setTimeout(r, 2000))
    }

    console.log('🎉 Backfill Complete! Please check the dashboard.')
}

backfill()
