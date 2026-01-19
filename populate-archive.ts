
import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function populateArchive() {
    console.log('🏛️  Iniciando El Gran Archivo Histórico (2020-2024)')
    console.log('📅 Rango: 01 Ene 2020 -> 31 Dic 2024')
    console.log('💾 Estrategia: "Smart Skip" ajustado para años anteriores.\n')

    const startDate = new Date('2020-01-01')
    const endDate = new Date('2024-12-31')

    let current = new Date(startDate)
    let processed = 0
    let skipped = 0
    let errors = 0

    // Total aproximado de días
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

    while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0]
        processed++

        // 1. CHEQUEO RÁPIDO INTELIGENTE
        // Para años antiguos, asumimos que "completado" es tener > 0 registros.
        // Esto evita re-intentos infinitos en días donde había pocas sucursales abiertas.
        const { count } = await supabase
            .from('sales_daily_cache')
            .select('*', { count: 'exact', head: true })
            .eq('business_date', dateStr)

        // Umbral bajo (5) para considerar el día "ya procesado" en el pasado
        if (count && count >= 5) {
            skipped++
            if (skipped % 10 === 0) {
                process.stdout.write(`⏩ Saltando días ya guardados... (${dateStr})\r`)
            }
            current.setDate(current.getDate() + 1)
            continue
        }

        console.log(`\n⏳ [${processed}/${totalDays}] ${dateStr}: Descargando Historia...`)
        const startT = Date.now()

        try {
            const { rows, connectionError } = await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day'
            })

            const duration = ((Date.now() - startT) / 1000).toFixed(1)

            if (connectionError) {
                console.error(`❌ Error en ${dateStr}: ${connectionError} [${duration}s]`)
                errors++
            } else {
                console.log(`✅ ${dateStr} ARCHIVADO (${rows.length} tiendas) [${duration}s]`)
            }

        } catch (e: any) {
            console.error(`❌ Fallo crítico en ${dateStr}:`, e.message)
            errors++
        }

        current.setDate(current.getDate() + 1)

        // Pausa breve para estabilidad a largo plazo
        await new Promise(r => setTimeout(r, 200))
    }

    console.log('\n\n✨ ¡MISIÓN CUMPLIDA! 5 AÑOS DE HISTORIA GUARDADOS. ✨')
    console.log(`Resumen: ${processed} días escaneados. Errores: ${errors}.`)
}

populateArchive()
