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
    // El "día de hoy" (feb 24) no se cachea porque está en curso
    const startDate = '2026-02-01'
    const endDate = '2026-02-23'

    let storeCount = 1

    for (const store of stores) {
        console.log(`[${storeCount}/${stores.length}] ➡️ Rellenando PMIX para: ${store.name}`)
        try {
            // Utilizamos el patrón "Self-Healing Cache". 
            // - skipCache: false (Saltará los días que ya estén correctamente guardados en BD)
            // - mergeDiningOptions: false (Asegura guardar los datos crudos con máximo detalle)
            await getProductMix({
                storeId: store.external_id,
                startDate,
                endDate,
                mergeDiningOptions: false,
                bundleModifiers: true, // Esto conserva los modifiers empaquetados si se indicó
                skipCache: false
            })
            console.log(`✅ Completado para ${store.name}\n`)
        } catch (e: any) {
            console.error(`❌ Falló la sincronización para ${store.name}: ${e.message}\n`)
        }

        // Pausa ligera para no ahogar la base de datos o el hilo
        await new Promise(resolve => setTimeout(resolve, 2000))
        storeCount++
    }

    console.log('🎉==============================================🎉')
    console.log(' BACKFILL COMPLETADO AUTOMÁTICAMENTE ')
    console.log('🎉==============================================🎉')
}

backfill()
