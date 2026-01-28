
// lib/weather.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

export interface WeatherCondition {
    date: string
    maxTempF: number
    precipProb: number // 0-100
    condition: string // 'Clear', 'Rain', 'Heavy Rain', 'Snow', etc.
    isSevere: boolean
}

export async function getStoreWeatherForecast(storeId: string, targetDate: string): Promise<WeatherCondition | null> {
    // 1. Get Store Coordinates
    const { data: store } = await supabase
        .from('stores')
        .select('latitude, longitude')
        .eq('external_id', storeId)
        .single()

    if (!store || !store.latitude || !store.longitude) return null

    // 2. Check if date is within reliable forecast range (0-7 days)
    const today = new Date()
    const target = new Date(targetDate)
    const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < 0 || diffDays > 7) {
        // Outside forecast range, return null (neutral weather)
        return null
    }

    // 3. Call Open-Meteo
    // Variables: weathercode, temperature_2m_max, precipitation_probability_max
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${store.latitude}&longitude=${store.longitude}&daily=weathercode,temperature_2m_max,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto`

    try {
        const res = await fetch(url)
        if (!res.ok) return null
        const json = await res.json()

        if (!json.daily || !json.daily.time) return null

        // Find the index for our target date
        const index = json.daily.time.findIndex((t: string) => t === targetDate)
        if (index === -1) return null

        const code = json.daily.weathercode[index]
        const prob = json.daily.precipitation_probability_max[index]
        const temp = json.daily.temperature_2m_max[index]

        const condition = mapWmoCode(code)

        // Define SEVERE rule based on user request & research:
        // "Heavy Rain (>95%) OR Snow"
        const isHeavyRain = condition === 'Heavy Rain' || condition === 'Thunderstorm'
        const isSnow = condition === 'Snow'

        // Snow is severe even at lower probs because it blocks roads, but let's keep 95% threshold for consistency or assume snow is always disruptive?
        // Let's stick to high probability to avoid false positives.
        const isSevere = (prob >= 95 && (isHeavyRain || isSnow))

        return {
            date: targetDate,
            maxTempF: temp,
            precipProb: prob,
            condition,
            isSevere
        }
    } catch (e) {
        console.error('Weather Fetch Error', e)
        return null
    }
}

function mapWmoCode(code: number): string {
    // https://open-meteo.com/en/docs
    if (code === 0) return 'Clear'
    if (code <= 3) return 'Cloudy'
    if (code >= 45 && code <= 48) return 'Fog'
    if (code >= 51 && code <= 55) return 'Drizzle'
    if (code >= 61 && code <= 65) return 'Rain'
    if (code >= 66 && code <= 67) return 'Freezing Rain'
    if (code >= 71 && code <= 77) return 'Snow'
    if (code >= 80 && code <= 82) return 'Rain Showers' // Often heavy but brief

    // HEAVY STUFF
    if (code === 65) return 'Heavy Rain' // Heavy intens
    if (code === 82) return 'Heavy Rain' // Violent showers
    if (code >= 95) return 'Thunderstorm'

    return 'Unknown'
}
