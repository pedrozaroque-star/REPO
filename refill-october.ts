
import dotenv from 'dotenv'
import path from 'path'

// Configurar variables de entorno antes de importar cualquier cosa que las use
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'

// Cliente directo para chequeo rápido
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function refillOctober() {
    console.log('🚀 Iniciando RECARGA ROBUSTA para OCTUBRE 2025')
    console.log('⚡ Modo Inteligente: Si ve datos, los salta. Pero como borramos, debería descargar todo.')
    console.log('🛡️  Protección Anti-Hang: Timeout estricto de 60s por día.\n')

    const startDate = new Date(`2025-10-01`)
    const endDate = new Date(`2025-10-31`)

    let current = new Date(startDate)
    let processed = 0
    const totalDays = 31

    while (current <= endDate) {
        // Asegurarse de usar formato YYYY-MM-DD correcto, ajustando zona horaria si fuera necesario
        // Pero .toISOString().split('T')[0] funciona bien si las horas están en 00:00 UTC o local consistente
        const dateStr = current.toISOString().split('T')[0]
        processed++

        const processDay = async () => {
            // 1. CHEQUEO RÁPIDO: ¿Ya tenemos datos COMPLETOS para este día (>10 tiendas)?
            const { count } = await supabase
                .from('sales_daily_cache')
                .select('*', { count: 'exact', head: true })
                .eq('business_date', dateStr)

            // Si hay más de 10 registros, asumimos que el día está completo
            if (count && count >= 10) {
                process.stdout.write('.') // Feedback minimalista para saltos
                if (processed % 10 === 0) console.log(` (${processed}/${totalDays})`)
                return 'SKIPPED'
            }

            console.log(`\n⏳ [${processed}/${totalDays}] ${dateStr}: Descargando de Toast...`)
            const startT = Date.now()

            // fetchToastData hace el upsert automático a Supabase
            const { rows, connectionError } = await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day'
            })

            const duration = ((Date.now() - startT) / 1000).toFixed(1)

            if (connectionError) {
                // Si es un error de conexión, lanzamos excepción para reintentar o loguear fallo
                throw new Error(connectionError)
            }

            // Validación básica: ¿Trajo datos?
            if (rows.length === 0) {
                console.warn(`⚠️  ALERTA: 0 filas para ${dateStr}. Puede ser correcto si cerraron todas las tiendas.`)
            }

            console.log(`✅ Guardado: ${dateStr} (${rows.length} tiendas) [${duration}s]`)
            return 'OK'
        }

        try {
            // Timeout de seguridad: Si Toast tarda más de 60s, corta y sigue
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("TIMEOUT EXTREMO (60s)")), 60000)
            )

            // @ts-ignore
            await Promise.race([processDay(), timeoutPromise])

        } catch (e: any) {
            console.error(`\n💀 ERROR/SALTO en ${dateStr}:`, e.message)
        }

        // Avanzar al siguiente día
        current.setDate(current.getDate() + 1)

        // Pequeña pausa para no saturar la API
        await new Promise(r => setTimeout(r, 500))
    }

    console.log('\n🎉 ¡OCTUBRE 2025 COMPLETADO! ✨')
}

refillOctober()
