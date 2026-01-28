
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function testWeather() {
    const { getStoreWeatherForecast } = await import('@/lib/weather')

    // Test for TOMORROW
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const targetDate = d.toISOString().split('T')[0]

    console.log(`🌤️ Checking Weather Forecast for: ${targetDate} (Lynwood)`)

    const weather = await getStoreWeatherForecast(STORE_ID, targetDate)

    if (weather) {
        console.log(`   Condition: ${weather.condition}`)
        console.log(`   Precip Prob: ${weather.precipProb}%`)
        console.log(`   Max Temp: ${weather.maxTempF}°F`)
        console.log(`   Severe Alert?: ${weather.isSevere ? 'YES 🚨' : 'No'}`)
    } else {
        console.log('   ❌ No forecast returned (API Error or out of range)')
    }
}

testWeather()
