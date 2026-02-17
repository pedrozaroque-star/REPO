
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function updateHours() {
    console.log('🔄 Actualizando Horarios (Estrategia: Ventana Más Amplia)...')

    const updates = [
        {
            namePart: 'Azusa',
            open: '10:00:00',
            close: '24:00:00' // Postgres usually treats 24:00:00 as 00:00:00 next day or rejects. Safest is 00:00:00? Or 23:59:00? Let's try 00:00:00.
            // Actually, if I put 00:00:00, logic might think it closes at morning.
            // Let's use 23:59:59 purely for safety or rely on app logic handling wrapping?
            // If West Covina is 03:00, that is clearly next morning.
            // Let's assume 00:00 is acceptable.
        },
        {
            namePart: 'West Covina',
            open: '10:00:00',
            close: '03:00:00'
        },
        {
            namePart: 'Rialto',
            open: '10:00:00',
            close: '02:00:00'
        }
    ]

    for (const u of updates) {
        // Find ID first to be safe
        const { data: stores } = await supabase
            .from('stores')
            .select('id, name')
            .ilike('name', `%${u.namePart}%`)
            .limit(1)

        if (!stores || stores.length === 0) {
            console.log(`❌ No encontré tienda: ${u.namePart}`)
            continue
        }

        const store = stores[0]

        // Update
        const { error } = await supabase
            .from('stores')
            .update({
                opening_time: u.open,
                closing_time: u.close
            })
            .eq('id', store.id)

        if (error) console.error(`❌ Error actualizando ${store.name}:`, error.message)
        else console.log(`✅ ${store.name} -> Open: ${u.open}, Close: ${u.close}`)
    }
}

updateHours()
