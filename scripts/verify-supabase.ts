import { getSupabaseClient } from '../lib/supabase'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function verifyConnection() {
    console.log("🔌 Verifying Inventory Schema...")
    try {
        const supabase = await getSupabaseClient()

        // Check for our new table
        const { data, error } = await supabase
            .from('inventory_items')
            .select('count', { count: 'exact', head: true })

        if (error) {
            console.error("❌ Verification Failed:", error.message)
        } else {
            console.log("✅ Schema Verified! 'inventory_items' table exists.")
        }

    } catch (e: any) {
        console.error("❌ Unexpected Error:", e.message)
    }
}

verifyConnection()
