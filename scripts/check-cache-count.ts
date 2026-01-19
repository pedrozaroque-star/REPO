
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function checkCache() {
    const today = new Date()
    const ninetyAgo = new Date()
    ninetyAgo.setDate(today.getDate() - 90)

    console.log(`🔍 Verificando Cache desde ${ninetyAgo.toISOString().split('T')[0]} hasta ${today.toISOString().split('T')[0]}`)

    const { count, error } = await supabase
        .from('sales_daily_cache')
        .select('*', { count: 'exact', head: true })
        .gte('business_date', ninetyAgo.toISOString().split('T')[0])
        .lte('business_date', today.toISOString().split('T')[0])

    if (error) console.error("❌ Error Supabase:", error.message)
    else console.log(`📊 Registros encontrados: ${count} (Esperados aprox: ~1350)`)
}

checkCache()
