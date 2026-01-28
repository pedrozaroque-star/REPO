
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function forecast2026() {
    const { generateSmartForecast } = await import('@/lib/intelligence')

    console.log("🔮 Consultando Oráculo para San Valentín 2026...")
    const date = '2026-02-14' // Sábado

    const prediction = await generateSmartForecast(STORE_ID, date)

    console.log(`\n📅 FECHA: ${prediction.date} (Sábado)`)
    console.log(`💰 VENTAS PROYECTADAS: $${prediction.total_sales.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
    console.log(`📈 FACTOR DE CRECIMIENTO: ${(prediction.growth_factor_applied * 100).toFixed(1)}%`)

    console.log('\n--- 📋 STAFF RECOMENDADO ---')
    console.log('| Hora | Ventas | Tix | Cocina | Cajeros |')
    console.log('|------|--------|-----|--------|---------|')

    prediction.hours.forEach(h => {
        if (h.hour >= 9 && h.hour <= 22) { // Mostrar horario operativo principal
            console.log(`| ${h.hour.toString().padStart(2, '0')}:00 | $${h.projected_sales.toFixed(0).padStart(5)} | ${h.projected_tickets.toFixed(0).padStart(3)} | ${h.required_kitchen}      | ${h.required_foh}       |`)
        }
    })
}

forecast2026()
