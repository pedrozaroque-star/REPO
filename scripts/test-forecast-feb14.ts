
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Dynamic import to ensure env vars are loaded FIRST
async function run() {
    const { generateSmartForecast } = await import('../lib/intelligence')

    const STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02' // West Covina
    const DATE = '2026-02-14'

    console.log(`Diagnóstico Intelligence para ${DATE} (West Covina)...`)

    try {
        const forecast = await generateSmartForecast(STORE_ID, DATE)

        console.log('\n--- RADIOGRAFÍA DE LA PROYECCIÓN ---')
        console.log(`1. Venta Final Proyectada: $${forecast.total_sales.toLocaleString('en-US')}`)
        console.log(`2. Factor de Crecimiento Aplicado: ${forecast.growth_factor_applied.toFixed(3)}x`)
        console.log(`   (Significa que el sistema detectó un crecimiento del ${((forecast.growth_factor_applied - 1) * 100).toFixed(1)}% vs el año pasado)`)

    } catch (e) {
        console.error(e)
    }
}

run()
