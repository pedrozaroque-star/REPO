import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function main() {
    console.log('🔍 Consultando la reseña más antigua de Google...')
    const { data, error } = await supabase
        .from('customer_feedback')
        .select(`
            submission_date, 
            customer_name, 
            rating, 
            stores (name)
        `)
        .eq('source', 'google')
        .order('submission_date', { ascending: true })
        .limit(1)

    if (error) {
        console.error('❌ Error consultando la base de datos:', error.message)
        return
    }

    if (data && data.length > 0) {
        const oldestReview = data[0]
        const dateObj = new Date(oldestReview.submission_date)
        console.log(`\n✅ Reseña más antigua encontrada:`)
        console.log(`📅 Fecha: ${dateObj.toLocaleDateString()} a las ${dateObj.toLocaleTimeString()}`)
        console.log(`🏪 Sucursal: ${oldestReview.stores?.name || 'Desconocida'}`)
        console.log(`👤 Cliente: ${oldestReview.customer_name}`)
        console.log(`⭐ Calificación: ${oldestReview.rating} estrellas`)
    } else {
        console.log('⚠️ No se encontraron reseñas de Google en la base de datos.')
    }
}

main()
