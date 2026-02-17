
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function testFridayForecast() {
    // Dynamic import to allow dotenv to load first
    const { generateSmartForecast } = await import('../lib/intelligence')

    const STORE_ID = '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02' // West Covina
    const FRIDAY_DATE = '2026-02-20' // Friday

    console.log(`🔮 Simulando Proyección para Viernes ${FRIDAY_DATE} (West Covina)...`)

    // Force generate
    const forecast = await generateSmartForecast(STORE_ID, FRIDAY_DATE)

    // Check Late Night Hours
    const lateNight = forecast.hours.filter(h => h.hour >= 24)

    console.log('\n--- Proyección Madrugada (Viernes) ---')
    if (lateNight.length === 0) {
        console.log('⚠️ No se generaron horas >= 24. El bucle no está funcionando o se cortaron.')
    } else {
        lateNight.forEach(h => {
            const realHour = h.hour >= 24 ? h.hour - 24 : h.hour
            console.log(`Hora ${h.hour} (${realHour}:00 AM): $${h.projected_sales.toFixed(2)} (${h.projected_tickets.toFixed(1)} tickets)`)
        })
    }

    const hasVolume = lateNight.some(h => h.projected_sales > 10)
    console.log(`\nResultado: ${hasVolume ? '✅ ÉXITO (Hay ventas proyectadas en la madrugada)' : '❌ ALERTA (Ceros en la madrugada)'}`)
}

testFridayForecast()
