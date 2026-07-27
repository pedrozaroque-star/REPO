import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { getProductMix } from '../lib/toast-pmix'

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function rebuild() {
    console.log('================================================')
    console.log('🚀 RECUPERANDO TABLA PMIX_DAILY_CACHE 🚀')
    console.log('================================================\n')

    const startDateStr = process.argv[2]
    const endDateStr = process.argv[3]
    
    if(!startDateStr || !endDateStr) {
        console.error("❌ FALTA RANGO DE FECHAS. USO: npx ts-node scripts/rebuild-pmix.ts 2026-03-01 2026-04-07")
        process.exit(1)
    }

    const { data: stores, error } = await supabase
        .from('stores')
        .select('external_id, name')
        .eq('is_active', true)

    if (error) throw error
    if (!stores || stores.length === 0) throw new Error("No hay tiendas activas")

    const start = new Date(startDateStr)
    const end = new Date(endDateStr)
    const dates = []

    let cur = new Date(start)
    while (cur <= end) {
        dates.push(cur.toISOString().split('T')[0])
        cur.setDate(cur.getDate() + 1)
    }

    console.log('Fechas a recuperar:', dates.length)

    for (const dateStr of dates) {
        console.log(`\n📅 Procesando fecha: ${dateStr}`)
        
        for (const store of stores) {
            if (!store.external_id) continue

            try {
                // Fetch directly from Toast, skipping local DB cache lookup completely
                const items = await getProductMix({
                    storeId: store.external_id,
                    startDate: dateStr,
                    endDate: dateStr,
                    bundleModifiers: true,
                    mergeDiningOptions: false,
                    skipCache: true
                })

                if (items && items.length > 0) {
                    const { error: upsertError } = await supabase.from('pmix_daily_cache').upsert({
                        store_id: store.external_id,
                        business_date: dateStr,
                        items: items,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'store_id,business_date' })

                    if (upsertError) {
                        console.log(` ❌ Error en DB para ${store.name}: ${upsertError.message}`)
                    } else {
                        process.stdout.write(` ✅ `)
                    }
                } else {
                    process.stdout.write(` ⚠️ `)
                }

            } catch (err: any) {
                console.log(` ❌ Error Toast en ${store.name}: ${err.message}`)
            }
            
            // Pausa entre tiendas para no golpear el Rate Limit
            await new Promise(r => setTimeout(r, 600))
        }
    }
    
    console.log('\n🏁 Recuperación completa.')
}

rebuild().catch(console.error).finally(() => process.exit(0))
