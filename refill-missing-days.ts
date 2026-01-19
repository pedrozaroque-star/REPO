
import dotenv from 'dotenv'
import path from 'path'

// Configurar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { fetchToastData } from './lib/toast-api'

const TARGET_DATES = [
    '2021-11-08',
    '2023-11-06',
    '2023-12-10',
    '2024-11-04'
]

async function refillMissingDays() {
    console.log('🚀 Iniciando RECARGA DE DÍAS DIFÍCILES')
    console.log('🎯 Fechas objetivo:', TARGET_DATES.join(', '))
    console.log('⏳ Timeout extendido: 3 minutos (180s) por día.\n')

    for (const dateStr of TARGET_DATES) {
        console.log(`\n📅 Procesando ${dateStr}...`)
        const startT = Date.now()

        const processDay = async () => {
            console.log(`⏳ Descargando de Toast...`)

            // fetchToastData hace el upsert automático a Supabase
            const { rows, connectionError } = await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day'
            })

            const duration = ((Date.now() - startT) / 1000).toFixed(1)

            if (connectionError) throw new Error(connectionError)

            console.log(`✅ Guardado: ${dateStr} (${rows.length} tiendas) [${duration}s]`)
            return 'OK'
        }

        try {
            // SIN LÍMITE DE TIEMPO: Esperamos indefinidamente
            await processDay()
        } catch (e: any) {
            console.error(`\n💀 ERROR FINAL en ${dateStr}:`, e.message)
        }

        // Pausa de enfriamiento entre intentos pesados
        console.log("❄️ Enfriando (5s)...")
        await new Promise(r => setTimeout(r, 5000))
    }

    console.log('\n🎉 ¡PROCESO DE RECARGA FINALIZADO!')
}

refillMissingDays()
