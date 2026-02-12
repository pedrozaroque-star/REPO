import { getSupabaseAdminClient } from '../lib/supabase'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function check() {
    console.log("🔍 Checking Row Count for toast_menu_items...")
    const supabase = await getSupabaseAdminClient()
    const { count, error } = await supabase
        .from('toast_menu_items')
        .select('*', { count: 'exact', head: true })

    if (error) {
        console.error("❌ Error:", error.message)
    } else {
        console.log(`✅ Total Rows: ${count}`)
    }
}

check()
