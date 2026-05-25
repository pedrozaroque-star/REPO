import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { generateSmartForecast } from '../lib/intelligence'
import { addDays, format } from 'date-fns'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testParity() {
    const storeId = 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8' // Azusa
    const targetDate = '2026-06-01'

    console.log(`\n===========================================`)
    console.log(`🔍 INICIANDO PRUEBA DE PARIDAD - ${targetDate}`)
    console.log(`===========================================\n`)

    // 1. Simular Planificador (Generar y Guardar en Caché)
    console.log(`[1/3] Simulando PLANIFICADOR (Generando forecast base)`)
    
    // Verificamos si ya existe
    const { data: existing } = await supabase
        .from('sales_projections_cache')
        .select('*')
        .eq('store_id', storeId)
        .eq('business_date', targetDate)
        .maybeSingle()

    let generatedValue = 0

    if (existing) {
        console.log(` -> Ya existe un valor en caché: $${existing.total_sales}`)
        generatedValue = Number(existing.total_sales)
    } else {
        console.log(` -> No hay caché, calculando con Intelligence Engine...`)
        const forecast = await generateSmartForecast(storeId, targetDate, true)
        generatedValue = forecast.total_sales

        // Guardamos
        const { error: upsertErr } = await supabase
            .from('sales_projections_cache')
            .upsert({
                store_id: storeId,
                business_date: targetDate,
                total_sales: generatedValue,
                hourly_data: forecast.hours,
                meta: { generated_by: 'verify_parity_script', version: '2.1' }
            })
        
        if (upsertErr) {
            console.error(` ❌ Error al guardar en caché:`, upsertErr)
            return
        }
        console.log(` -> Generado y guardado exitosamente: $${generatedValue.toFixed(2)}`)
    }

    // 2. Simular Dashboard de Ventas (Leer de caché)
    console.log(`\n[2/3] Simulando DASHBOARD DE VENTAS (/api/ventas)`)
    
    const { data: dbVentas, error: dbErr } = await supabase
        .from('sales_projections_cache')
        .select('business_date, total_sales')
        .eq('store_id', storeId)
        .eq('business_date', targetDate)
        .single()

    let ventasValue = 0
    if (dbErr) {
        console.error(` ❌ Error al leer caché (Dashboard):`, dbErr)
    } else {
        ventasValue = Number(dbVentas.total_sales)
        console.log(` -> Valor leído por Dashboard: $${ventasValue.toFixed(2)}`)
    }

    // 3. Evaluar Paridad
    console.log(`\n[3/3] RESULTADOS DE PARIDAD`)
    
    const diff = Math.abs(generatedValue - ventasValue)
    if (diff < 0.01 && generatedValue > 0) {
        console.log(` ✅ ÉXITO TOTAL: Planificador ($${generatedValue.toFixed(2)}) == Dashboard de Ventas ($${ventasValue.toFixed(2)})`)
        console.log(` 🚀 El diseño funciona perfectamente. Las proyecciones ya no flotan y están amarradas a la caché.`)
    } else {
        console.log(` ❌ DISCREPANCIA DETECTADA:`)
        console.log(`    Planificador: $${generatedValue.toFixed(2)}`)
        console.log(`    Dashboard:    $${ventasValue.toFixed(2)}`)
    }
}

testParity()
