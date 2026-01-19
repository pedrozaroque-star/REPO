
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkCache() {
    // Calcular Ayer en L.A.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const d = new Date(today)
    d.setDate(d.getDate() - 1)
    const yesterday = d.toISOString().split('T')[0]

    console.log(`🔍 Verificando Cache para la fecha: ${yesterday} (Ayer en L.A.)\n`)

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('store_name, net_sales')
        .eq('business_date', yesterday)
        .order('net_sales', { ascending: false })

    if (error) {
        console.error('❌ Error consultando Supabase:', error.message)
        return
    }

    if (!data || data.length === 0) {
        console.log('⚠️  NO hay datos en cache para ayer.')
        console.log('   Si acabas de usar el dashboard y presionaste "Ayer", deberían aparecer aquí.')
        console.log('   Si no has entrado al dashboard hoy, es normal que esté vacío.')
    } else {
        console.log(`✅ ¡ENCONTRADO! Hay datos guardados para ${data.length} tiendas.\n`)
        console.table(data)
    }
}

checkCache()
