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
    console.log('📊 Contando reseñas por sucursal...\n')

    // Traemos todas las tiendas
    const { data: stores, error: storesError } = await supabase.from('stores').select('id, name')

    if (storesError) {
        console.error('❌ Error consultando tiendas:', storesError.message)
        return
    }

    // Traemos de forma agregada el COUNT por tienda usando un group by (via rpc o client filter)
    // Para simplificar, traemos todas las de Google y contamos
    const { data: reviews, error: reviewsError } = await supabase
        .from('customer_feedback')
        .select('store_id')
        .eq('source', 'google')

    if (reviewsError) {
        console.error('❌ Error consultando reseñas:', reviewsError.message)
        return
    }

    // Contamos por store_id
    const countMap: Record<string, number> = {}
    reviews?.forEach(r => {
        countMap[r.store_id] = (countMap[r.store_id] || 0) + 1
    })

    // Imprimimos la tabla
    const report = stores?.map(store => ({
        Sucursal: store.name,
        Reseñas_Guardadas: countMap[store.id] || 0,
        Status: (countMap[store.id] || 0) > 0 ? '✅ Listo' : '❌ Vacío'
    }))

    // Ordenamos para que las vacías queden arriba
    report?.sort((a, b) => a.Reseñas_Guardadas - b.Reseñas_Guardadas)

    console.table(report)
}

main()
