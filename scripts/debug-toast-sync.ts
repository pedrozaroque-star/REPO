import { syncMenuFromToast } from '../lib/inventory/toast-sync'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function debugSync() {
    console.log("🐞 Debugging Toast Menu Sync...")
    try {
        const result = await syncMenuFromToast()
        console.log("Result:", JSON.stringify(result, null, 2))
    } catch (e: any) {
        console.error("❌ Fatal Error:", e)
    }
}

debugSync()
