
import { getProductMix } from '../lib/toast-pmix'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function run() {
    console.log("🔍 Inspecting Toast Data Format...")
    try {
        // West Covina ID and recent date
        const data = await getProductMix({
            storeId: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02',
            startDate: '2026-02-17', // Yesterday to ensure data
            endDate: '2026-02-17'
        })

        console.log(`\n✅ Fetched ${data.length} items.\n`)

        // Find one with a group name if possible, or dump the first one
        const sample = data.find(i => i.name.toLowerCase().includes('taco')) || data[0]

        if (sample) {
            console.log("Sample Item:", JSON.stringify(sample, null, 2))
        } else {
            console.log("No items found.")
        }

    } catch (e) {
        console.error("Error:", e)
    }
}

run()
