
import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Cliente directo para chequeo rápido
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function populateYear() {
    console.log('🚀 Iniciando Carga Masiva - AÑO 2024 COMPLETO')
    console.log('📅 Rango: 01 Ene 2024 -> 31 Dic 2024')
    console.log('⚡ Modo Inteligente: Saltará días ya cacheados.\n')

    const startDate = new Date('2024-01-01')
    const endDate = new Date('2024-12-31')

    let current = new Date(startDate)
    let totalDays = 366 // 2024 fue bisiesto
    let processed = 0

    while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0]
        processed++

        const processDay = async () => {
            // 1. CHEQUEO RÁPIDO
            const { count } = await supabase
                .from('sales_daily_cache')
                .select('*', { count: 'exact', head: true })
                .eq('business_date', dateStr)

            if (count && count >= 14) {
                console.log(`⏩ [${processed}/${totalDays}] ${dateStr}: YA EXISTE (${count} tiendas). Saltando...`)
                return 'SKIPPED'
            }

            console.log(`⏳ [${processed}/${totalDays}] ${dateStr}: Descargando...`)
            const startT = Date.now()

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
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("TIMEOUT EXTREMO (60s)")), 60000)
            )

            // @ts-ignore
            await Promise.race([processDay(), timeoutPromise])

        } catch (e: any) {
            console.error(`💀 SALTO DE EMERGENCIA en ${dateStr}:`, e.message)
        }

        current.setDate(current.getDate() + 1)
        // Pequeña pausa
        await new Promise(r => setTimeout(r, 200))
    }

    console.log('\n✨ ¡AÑO 2024 COMPLETADO! ✨')
}

populateYear()
