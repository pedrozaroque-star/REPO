
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function debugDates() {
    console.log('🕵️‍♂️ Analizando formatos de fecha en Supabase...\n')

    // Traer 1 registro cualquiera
    const { data } = await supabase
        .from('sales_daily_cache')
        .select('business_date')
        .limit(1)

    if (!data || data.length === 0) {
        console.log('⚠️ Tabla vacía.')
        return
    }

    const rawDate = data[0].business_date
    const typeOf = typeof rawDate

    console.log(`Valor crudo (Raw): "${rawDate}"`)
    console.log(`Tipo de dato JS:   ${typeOf}`)



    // Simular SEMANA COMPLETA (Lunes 12 Ene - Domingo 18 Ene)
    console.log(`\n📅 SIMULACIÓN DE CARGA SEMANAL:`)
    console.log(`---------------------------------`)

    const dates = [
        '2026-01-12', // Lunes
        '2026-01-13', // Martes
        '2026-01-14', // Miércoles
        '2026-01-15', // Jueves
        '2026-01-16', // Viernes
        '2026-01-17', // Sábado
        '2026-01-18', // Domingo (HOY - Debería ser LIVE)
    ]

    for (const date of dates) {
        const { data: search } = await supabase
            .from('sales_daily_cache')
            .select('count')
            .eq('business_date', date)

        // Contamos cuántas tiendas tienen datos para ese día
        const count = search?.length || 0
        const isToday = date === '2026-01-18'

        let status = ''
        if (isToday) status = '🔴 LIVE (Correcto)'
        else if (count > 0) status = `🟢 CACHE (${count} datos)`
        else status = '⚠️ MISSING (Lento)'

        console.log(`Date: ${date} -> ${status}`)
    }
    console.log(`---------------------------------`)
}

debugDates()
