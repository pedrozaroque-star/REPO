import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

import { syncDriveThruData, autoDetectDTStores } from '../lib/drive-thru-api'

function getBusinessDate(): string {
    const now = new Date()
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    if (laTime.getHours() < 6) {
        laTime.setDate(laTime.getDate() - 1)
    }
    const y = laTime.getFullYear()
    const m = String(laTime.getMonth() + 1).padStart(2, '0')
    const d = String(laTime.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

async function main() {
    const date = getBusinessDate()
    console.log(`🚀 Starting manual Drive-Thru Sync for business date: ${date}`)
    
    try {
        console.log('🔍 Running autoDetectDTStores()...')
        const autoDetect = await autoDetectDTStores()
        console.log('Auto-detection summary:', autoDetect)
        
        console.log(`🔄 Sychronizing Drive-Thru orders and slot stats for ${date}...`)
        const result = await syncDriveThruData(date)
        console.log('✅ Synchronization completed successfully:')
        console.dir(result, { depth: null, colors: true })
    } catch (error: any) {
        console.error('❌ Error during sync:', error.message || error)
    }
}

main()
