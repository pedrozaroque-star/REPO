
import dotenv from 'dotenv'
import path from 'path'

// Cargar variables ANTES de importar nada más
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { fetchToastData } from './lib/toast-api'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

const STORES = [
    { id: 'acf15327-54c8-4da4-8d0d-3ac0544dc422', name: 'Rialto' },
    { id: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', name: 'Azusa' },
    { id: '42ed15a6-106b-466a-9076-1e8f72451f6b', name: 'Norwalk' },
    { id: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a', name: 'Downey' },
    { id: '475bc112-187d-4b9c-884d-1f6a041698ce', name: 'LA Broadway' },
    { id: 'a83901db-2431-4283-834e-9502a2ba4b3b', name: 'Bell' },
    { id: '5fbb58f5-283c-4ea4-9415-04100ee6978b', name: 'Hollywood' },
    { id: '47256ade-2cd4-4073-9632-84567ad9e2c8', name: 'Huntington Park' },
    { id: '8685e942-3f07-403a-afb6-faec697cd2cb', name: 'LA Central' },
    { id: '3a803939-eb13-4def-a1a4-462df8e90623', name: 'La Puente' },
    { id: '80a1ec95-bc73-402e-8884-e5abbe9343e6', name: 'Lynwood' },
    { id: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', name: 'Santa Ana' },
    { id: '9625621e-1b5e-48d7-87ae-7094fab5a4fd', name: 'Slauson' },
    { id: '95866cfc-eeb8-4af9-9586-f78931e1ea04', name: 'South Gate' },
    { id: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02', name: 'West Covina' }
]

async function rescueMission() {
    console.log('🚑 OPERACIÓN RESCATE - 03 NOV 2025')
    const targetDate = '2025-11-03'
    let successCount = 0
    let failCount = 0

    for (const store of STORES) {
        process.stdout.write(`🩺 Probando ${store.name}... `)

        try {
            // Aislamiento: Pedimos solo 1 tienda
            // Nota: fetchToastData espera string[] pero en la interfaz 'storeIds' es string | 'all'.
            // Sin embargo, internamente lo maneja. Vamos a pasarle el ID especifico.
            // PERO CUIDADO: si pasamos string simple, la logica interna de 'storeIds.includes' funcionará?
            // Revisando lib/toast-api.ts: storesToUse.filter(s => options.storeIds.includes(s.id))
            // Si pasamos el ID directo, "ID".includes("ID") es true. Funciona.

            const { rows, connectionError } = await fetchToastData({
                storeIds: store.id, // Pasamos solo ESTE ID
                startDate: targetDate,
                endDate: targetDate,
                groupBy: 'day'
            })

            if (connectionError) {
                console.log(`❌ ERROR CONEXIÓN: ${connectionError}`)
                failCount++
            } else if (rows.length > 0) {
                console.log(`✅ RECUPERADA (${rows[0].netSales.toFixed(2)})`)
                successCount++
            } else {
                console.log(`⚠️  Sin datos (pero conexión OK)`)
            }

        } catch (error: any) {
            console.log(`💀 CRASH / TIMEOUT: ${error.message}`)
            failCount++
        }

        // Breve pausa táctica
        await new Promise(r => setTimeout(r, 1000))
    }

    console.log('\n📊 REPORTE DE DAÑOS:')
    console.log(`   - Recuperadas: ${successCount}/15`)
    console.log(`   - Fallidas/Tóxicas: ${failCount}`)
}

rescueMission()
