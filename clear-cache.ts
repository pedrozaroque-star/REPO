
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function clearCache() {
    console.log('🧹 Limpiando TODA la tabla sales_daily_cache...')

    // En Supabase/Postgres, para borrar todo sin WHERE a veces se requiere policy o delete() sin filtros
    // Usaremos un filtro "id > 0" que siempre es true para borrar todo
    const { error } = await supabase
        .from('sales_daily_cache')
        .delete()
        .neq('store_id', 'cleanup_check') // Esto seleccionará todo porque ningún store_id es 'cleanup_check'

    if (error) {
        console.error('❌ Error borrando:', error.message)
    } else {
        console.log('✅ Cache purgada exitosamente. Ahora los datos se recargarán frescos y corregidos desde Toast.')
    }
}

clearCache()
