import { exec } from 'child_process'
import path from 'path'

const scriptPath = path.resolve(__dirname, 'sync-drive-thru.ts')

function runSync() {
    console.log(`\n⏰ [LOCAL CRON] [${new Date().toLocaleTimeString()}] Triggering Drive-Thru sync...`)
    
    exec(`npx tsx "${scriptPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ [LOCAL CRON] Error executing sync:`, error.message)
            return
        }
        if (stderr) {
            console.error(`⚠️ [LOCAL CRON] Stderr output:\n`, stderr)
        }
        console.log(`✅ [LOCAL CRON] Sync output:\n`, stdout.trim())
    })
}

// Run immediately
runSync()

// Repeat every 2 minutes (120,000 milliseconds)
const INTERVAL_MS = 2 * 60 * 1000
console.log(`🚀 Local Cron Runner started. Will sync every 2 minutes (${INTERVAL_MS / 1000} seconds)...`)
setInterval(runSync, INTERVAL_MS)
