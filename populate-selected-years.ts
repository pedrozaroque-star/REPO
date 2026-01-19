
import dotenv from 'dotenv'
import path from 'path'

// Configurar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'

// Cliente directo Supabase
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

const YEARS_TO_PROCESS = [2020, 2021, 2022, 2024, 2025] // Excluido 2023

async function populateSelectedYears() {
    console.log('🚀 Iniciando Carga Histórica Selectiva')
    console.log('📅 Años a procesar:', YEARS_TO_PROCESS.join(', '))
    console.log('⚡ Modo Inteligente: Saltará días ya cacheados en Supabase.')
    console.log('🛡️  Protección Anti-Hang: Timeout estricto de 60s por día.\n')

    for (const year of YEARS_TO_PROCESS) {
        console.log(`\n📅 ============== PROCESANDO AÑO ${year} ==============`)

        const startDate = new Date(`${year}-01-01`)
        const endDate = new Date(`${year}-12-31`)

        // Si es 2025, limitamos hasta hoy para no pedir futuro
        const today = new Date()
        const effectiveEnd = (year === today.getFullYear() && endDate > today) ? today : endDate

        let current = new Date(startDate)
        let processed = 0
        const totalDays = Math.ceil((effectiveEnd.getTime() - startDate.getTime()) / (1000 * 3600 * 24)) + 1

        while (current <= effectiveEnd) {
            const dateStr = current.toISOString().split('T')[0]
            processed++

            const processDay = async () => {
                // 1. CHEQUEO RÁPIDO: ¿Día completo (>14 tiendas)?
                const { count } = await supabase
                    .from('sales_daily_cache')
                    .select('*', { count: 'exact', head: true })
                    .eq('business_date', dateStr)

                if (count && count >= 14) {
                    process.stdout.write('.') // Feedback minimalista
                    if (processed % 50 === 0) console.log(` (${processed}/${totalDays})`)
                    return 'SKIPPED'
                }

                console.log(`\n⏳ [${processed}/${totalDays}] ${dateStr}: Descargando de Toast...`)
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
                console.error(`\n💀 ERROR/SALTO en ${dateStr}:`, e.message)
            }

            current.setDate(current.getDate() + 1)
            // Pequeña pausa
            await new Promise(r => setTimeout(r, 200))
        }

        console.log(`\n✨ ¡AÑO ${year} COMPLETADO! ✨`)
    }

    console.log('\n🎉 ¡FIN DE PROCESO! Todos los años seleccionados han sido verificados/descargados.')
}

populateSelectedYears()
