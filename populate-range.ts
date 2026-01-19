
import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

async function populateRange() {
    const startArg = process.argv[2]
    const endArg = process.argv[3]

    if (!startArg || !endArg) {
        console.error("❌ Uso: npx tsx populate-range.ts YYYY-MM-DD YYYY-MM-DD")
        process.exit(1)
    }

    console.log(`🚀 Iniciando Rango: ${startArg} -> ${endArg}`)

    const startDate = new Date(startArg)
    const endDate = new Date(endArg)
    let current = new Date(startDate)

    // Total días para log
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)) + 1
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
                // Log ligero para no spamear
                // process.stdout.write('.') 
                if (processed % 10 === 0) console.log(`⏩ [${processed}/${totalDays}] ${dateStr}: YA EXISTE (${count} tiendas). Saltando...`)
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
                setTimeout(() => reject(new Error("TIMEOUT EXTENDIDO (180s)")), 180000)
            )
            // @ts-ignore
            await Promise.race([processDay(), timeoutPromise])

        } catch (e: any) {
            console.error(`💀 SALTO DE EMERGENCIA en ${dateStr}:`, e.message)
        }

        // Avanzar día
        current.setDate(current.getDate() + 1)

        // Garbage collection manual hint y pausa
        if (global.gc) { global.gc(); }
        await new Promise(r => setTimeout(r, 200))
    }

    console.log(`✨ Rango ${startArg} - ${endArg} COMPLETADO.`)
}

populateRange()
