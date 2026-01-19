
import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function populateHistory() {
    console.log('🚀 Iniciando Carga - Última semana Nov 2025...')
    console.log('📅 Rango: 24 Nov 2025 -> 30 Nov 2025\n')

    const startDate = new Date('2025-11-24') // Lunes
    const endDate = new Date('2025-11-30')   // Domingo

    let current = new Date(startDate)

    // Bucle Día por Día
    while (current <= endDate) {
        // Formato YYYY-MM-DD
        const dateStr = current.toISOString().split('T')[0]

        console.log(`⏳ Procesando: ${dateStr}...`)
        const startT = Date.now()

        try {
            // Fetch for Single Day -> Trigger API -> Save to Cache
            const { rows, connectionError } = await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day'
            })

            const duration = ((Date.now() - startT) / 1000).toFixed(1)

            if (connectionError) {
                console.error(`❌ Error en ${dateStr}: ${connectionError} [${duration}s]`)
            } else {
                console.log(`✅ Guardado: ${dateStr} (${rows.length} tiendas) [${duration}s]`)
            }

        } catch (e: any) {
            const duration = ((Date.now() - startT) / 1000).toFixed(1)
            console.error(`❌ Fallo crítico en ${dateStr}:`, e.message, `[${duration}s]`)
        }

        // Avanzar 1 día
        current.setDate(current.getDate() + 1)

        // Pausa de 500ms para no saturar
        await new Promise(r => setTimeout(r, 500))
    }

    console.log('\n✨ ¡Semana Noviembre Cargada! ✨')
}

populateHistory()
