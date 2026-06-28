import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verify() {
    console.log("🔍 Querying dt_orders for Lynwood order #691 on 2026-06-26...")
    
    const { data, error } = await supabase
        .from('dt_orders')
        .select('*')
        .eq('business_date', '2026-06-26')
        .eq('order_number', '691')
        .eq('store_name', 'Lynwood')
        
    if (error) {
        console.error("❌ DB Query Error:", error.message)
        return
    }
    
    if (!data || data.length === 0) {
        console.log("❌ No order record found in dt_orders.")
        return
    }
    
    console.log("🎯 Found record:")
    console.dir(data[0], { depth: null, colors: true })
}

verify()
