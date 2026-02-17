
import { fetchToastData } from '../lib/toast-api'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl!, supabaseServiceKey!)

async function audit2025() {
    const STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02' // West Covina
    const START = '2025-01-01'
    const END = '2025-02-15' // Same period as current range

    console.log(`🕵️ AUDITORÍA 2025: Buscando huecos o datos bajos...`)
    console.log(`Tienda: West Covina | Rango: ${START} al ${END}`)

    // 1. Fetch DB Data
    const { data: dbRows, error } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .gte('business_date', START)
        .lte('business_date', END)

    if (error) { console.error(error); return; }
    console.log(`✅ Registros en DB: ${dbRows.length} (Esperados: ~46)`)

    // 2. Iterate Day by Day
    let curr = new Date(START)
    const end = new Date(END)

    console.log('\n--- COMPARATIVA DÍA A DÍA ---')
    let mismatches = 0
    let missing = 0

    while (curr <= end) {
        const dateStr = curr.toISOString().split('T')[0]

        // Fetch Live (Skip Cache to be sure)
        // We do sequential to respect rate limits
        await new Promise(r => setTimeout(r, 400))

        try {
            const res = await fetchToastData({
                storeIds: STORE_ID,
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day',
                skipCache: true
            })

            const live = res.rows.find(r => r.periodStart === dateStr)
            const db = dbRows.find(r => r.business_date === dateStr)

            // REPORTING LOGIC
            // If DB is missing or significantly lower than Live, that's the culprit.

            if (!live) {
                // process.stdout.write('.') // No data live (closed?)
            } else if (!db) {
                console.log(`❌ [${dateStr}] FALTA EN DB (Live: $${live.netSales.toFixed(0)})`)
                missing++
            } else {
                const diff = Math.abs(db.net_sales - live.netSales)
                if (diff > 50) { // Tolerancia $50
                    console.log(`⚠️ [${dateStr}] DISCREPANCIA: DB=$${db.net_sales.toFixed(0)} vs API=$${live.netSales.toFixed(0)} (Diff: $${diff.toFixed(0)})`)
                    mismatches++
                } else if (db.net_sales < 1000) {
                    // Suspiciously low sales
                    console.log(`📉 [${dateStr}] VENTA BAJA CONFIRMADA: $${db.net_sales.toFixed(0)} (Igual en API)`)
                } else {
                    // Match OK
                    // process.stdout.write('✅') 
                }
            }

        } catch (e) {
            console.error(`Error ${dateStr}:`, e)
        }

        curr.setDate(curr.getDate() + 1)
    }

    console.log(`\n\n--- RESUMEN ---`)
    console.log(`Faltantes en DB: ${missing}`)
    console.log(`Discrepancias (> $50): ${mismatches}`)

    if (missing === 0 && mismatches === 0) {
        console.log('✅ La base de 2025 parece CORRECTA y coincide con Toast.')
        console.log('Si la base es correcta, entonces el crecimiento del 40% es REAL (o Toast cambió algo histórico).')
    } else {
        console.log('❌ Se encontraron errores. Esto explica por qué el Growth Factor se dispara.')
    }
}

audit2025()
