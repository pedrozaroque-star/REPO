
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function checkWeatherForWeek() {
    const { getStoreWeatherForecast } = await import('../lib/weather') // Dynamic import inside async to force tsx

    const STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02' // West Covina
    const START_DATE = new Date('2026-02-16') // Monday
    const DAYS_TO_CHECK = 7

    console.log(`🌦️ Diagnóstico Clima: 16-22 Feb 2026 (West Covina)`)

    for (let i = 0; i < DAYS_TO_CHECK; i++) {
        const d = new Date(START_DATE)
        d.setDate(d.getDate() + i)
        const dateStr = d.toISOString().split('T')[0]

        try {
            const weather = await getStoreWeatherForecast(STORE_ID, dateStr)

            if (!weather) {
                console.log(`[${dateStr}] ❌ No hay datos de clima disponibles.`)
                continue
            }

            const status = weather.isSevere ? '⚠️ SÍ (Afecta Proyección)' : '✅ NO (Normal)'
            console.log(`[${dateStr}] ${status} | Condición: ${weather.condition} (${weather.precipProb}%) | Temp Max: ${weather.maxTempF}°F`)

        } catch (e) {
            console.error(`Error ${dateStr}:`, e)
        }
    }
}

checkWeatherForWeek()
