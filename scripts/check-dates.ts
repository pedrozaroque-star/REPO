import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkDates() {
    console.log("Checking meat_consumption_history table...")
    // Get minimum date
    const { data: minData } = await supabase
        .from('meat_consumption_history')
        .select('business_date')
        .order('business_date', { ascending: true })
        .limit(1)

    // Get maximum date
    const { data: maxData } = await supabase
        .from('meat_consumption_history')
        .select('business_date')
        .order('business_date', { ascending: false })
        .limit(1)

    // Count rows
    const { count } = await supabase
        .from('meat_consumption_history')
        .select('*', { count: 'exact', head: true })

    const minDate = minData && minData.length > 0 ? minData[0].business_date : 'N/A'
    const maxDate = maxData && maxData.length > 0 ? maxData[0].business_date : 'N/A'

    console.log("\n=============================")
    console.log(`TOTAL ROWS : ${count}`)
    console.log(`MIN DATE   : ${minDate}`)
    console.log(`MAX DATE   : ${maxDate}`)
    console.log("=============================\n")
}

checkDates()
