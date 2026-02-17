
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAzusa() {
    console.log('🔍 Inspeccionando Horarios de Azusa y West Covina...')

    const { data: stores, error } = await supabase
        .from('stores')
        .select('id, name, opening_time, closing_time')
        .or('name.ilike.%Azusa%,name.ilike.%West Covina%')

    if (error) {
        console.error('Error:', error)
        return
    }

    stores?.forEach(s => {
        console.log(`\n🏪 ${s.name}`)
        console.log(`   Apertura: [${s.opening_time}] (Tipo: ${typeof s.opening_time})`)
        console.log(`   Cierre:   [${s.closing_time}] (Tipo: ${typeof s.closing_time})`)
    })
}

checkAzusa()
