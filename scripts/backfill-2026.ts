
import { fetchToastData } from '../lib/toast-api'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function backfill2026() {
    // Backfill specifically for Jan 2026 and Feb 2026
    const startDate = new Date('2026-01-01')
    const endDate = new Date('2026-02-15') // Include today

    console.log(`🚀 Starting Backfill Process for FUTURE/CURRENT YEAR: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...`)

    let current = new Date(startDate)

    while (current <= endDate) {
        const chunkStart = new Date(current)
        const chunkEnd = new Date(current)
        chunkEnd.setDate(chunkEnd.getDate() + 4) // 5 day chunk

        // Cap at endDate
        const effectiveEnd = chunkEnd > endDate ? endDate : chunkEnd

        const sStr = chunkStart.toISOString().split('T')[0]
        const eStr = effectiveEnd.toISOString().split('T')[0]

        console.log(`📦 Procesando Bloque 2026: ${sStr} to ${eStr}...`)

        try {
            await fetchToastData({
                storeIds: 'all',
                startDate: sStr,
                endDate: eStr,
                groupBy: 'day',
                skipCache: true // FORCE API FETCH + WRITE BACK
            })
            console.log(`✅ Chunk 2026 ${sStr} - ${eStr} completed.`)
        } catch (e) {
            console.error(`❌ Error processing chunk ${sStr} - ${eStr}:`, e)
        }

        // Move next
        current.setDate(current.getDate() + 5)

        // Delay to allow API breathing room
        await new Promise(r => setTimeout(r, 1000))
    }

    console.log('🎉 Backfill 2026 Complete!')
}

backfill2026()
