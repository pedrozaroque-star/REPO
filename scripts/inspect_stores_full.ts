
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function checkHours() {
    // Select * to see all columns
    const { data: stores } = await supabase.from('stores').select('*').limit(1)
    if (stores && stores.length > 0) {
        console.log('--- Columnas de la tabla STORES ---')
        console.log(Object.keys(stores[0]))
        console.log('\n--- Ejemplo de Datos (Primer Store) ---')
        console.log(stores[0])
    } else {
        console.log('No shops found')
    }
}

checkHours()
