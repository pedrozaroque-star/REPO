import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { getProductMix } from '../lib/toast-pmix'

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function backfill() {
    console.log('================================================')
    console.log('🚀 STARTING PMIX BACKFILL FOR FEBRUARY 2026 🚀')
    console.log('================================================\n')

    // 1. Obtener todas las tiendas activas de la base de datos
    const { data: stores, error } = await supabase
        .from('stores')
        .select('external_id, name')
        .eq('is_active', true)

    if (error || !stores) {
        console.error('❌ Error fetching stores:', error)
        return
    }

    console.log(`✅ Encontradas ${stores.length} tiendas activas.\n`)

    // 2. Definir el periodo (Febrero 1 hasta Ayer)
    const startDate = '2025-12-01'
    const endDate = '2026-01-31'

    // Build dates array in reverse order
    const datesToFetch: string[] = []
    let curDateObj = new Date(startDate)
    const lastDateObj = new Date(endDate)

    while (curDateObj <= lastDateObj) {
        datesToFetch.push(curDateObj.toISOString().split('T')[0])
        curDateObj.setDate(curDateObj.getDate() + 1)
    }
    datesToFetch.reverse() // Start from the latest date and go backwards

    console.log(`📅 Un total de ${datesToFetch.length} días serán procesados al revés...\n`)

    for (const dateStr of datesToFetch) {
        console.log(`\n================================================`)
        console.log(`📅 PROCESANDO FECHA: ${dateStr}`)
        console.log(`================================================`)

        let storeCount = 1
        for (const store of stores) {
            console.log(`[${storeCount}/${stores.length}] ➡️ Rellenando PMIX para: ${store.name}`)
            try {
                await getProductMix({
                    storeId: store.external_id,
                    startDate: dateStr,
                    endDate: dateStr,
                    mergeDiningOptions: false,
                    bundleModifiers: true,
                    skipCache: false
                })
                console.log(`✅ Completado para ${store.name}`)
            } catch (e: any) {
                console.error(`❌ Falló la sincronización para ${store.name}: ${e.message}`)
            }

            // Pausa ligera para no ahogar la base de datos o el hilo
            await new Promise(resolve => setTimeout(resolve, 1000))
            storeCount++
        }
    }

    console.log('\n🎉==============================================🎉')
    console.log(' BACKFILL COMPLETADO AUTOMÁTICAMENTE ')
    console.log('🎉==============================================🎉')
}

backfill()
