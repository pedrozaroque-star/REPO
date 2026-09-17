
/**
 * @module ForecastWeather
 * @description Consulta clima de corto plazo y produce un factor conservador para la proyección de ventas.
 * @businessRules El clima solo se aplica de 0 a 7 fechas calendario desde hoy en America/Los_Angeles.
 * @dataFlow stores -> Open-Meteo -> condición validada -> factor usado por `lib/intelligence.ts`.
 * @notes Usa el cliente compartido de lectura y un timeout para que una API externa no bloquee generaciones masivas.
 */

import { supabase } from '@/lib/supabase'

export interface WeatherCondition {
    date: string
    maxTempF: number
    precipProb: number // 0-100
    condition: string // 'Clear', 'Rain', 'Heavy Rain', 'Snow', etc.
    isSevere: boolean
    weatherFactor: number // 1.0 = no impact, 0.92 = -8% severe, etc.
}

export async function getStoreWeatherForecast(storeId: string, targetDate: string): Promise<WeatherCondition | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null
    // 1. Get Store Coordinates
    const { data: store } = await supabase
        .from('stores')
        .select('latitude, longitude')
        .eq('external_id', storeId)
        .single()

    if (!store || !store.latitude || !store.longitude) return null

    // 2. Check if date is within reliable forecast range (0-7 days)
    const todayString = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date())
    const today = Date.parse(`${todayString}T12:00:00Z`)
    const target = Date.parse(`${targetDate}T12:00:00Z`)
    if (!Number.isFinite(target)) return null
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24))

    if (diffDays < 0 || diffDays > 7) {
        // Outside forecast range, return null (neutral weather)
        return null
    }

    // 3. Call Open-Meteo
    // Variables: weathercode, temperature_2m_max, precipitation_probability_max
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${store.latitude}&longitude=${store.longitude}&daily=weathercode,temperature_2m_max,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto`

    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) return null
        const json = await res.json()

        if (!json.daily || !json.daily.time) return null

        // Find the index for our target date
        const index = json.daily.time.findIndex((t: string) => t === targetDate)
        if (index === -1) return null

        const code = Number(json.daily.weathercode[index])
        const prob = Number(json.daily.precipitation_probability_max[index])
        const temp = Number(json.daily.temperature_2m_max[index])
        if (![code, prob, temp].every(Number.isFinite)) return null

        const condition = mapWmoCode(code)

        // GRADUATED WEATHER IMPACT SYSTEM (v3.0)
        // Old system: prob >= 95 && (Heavy Rain || Snow) — NEVER triggered in SoCal
        // New system: 3-tier graduated impact based on empirical backtest data
        const isHeavyRain = condition === 'Heavy Rain' || condition === 'Thunderstorm'
        const isSnow = condition === 'Snow'
        const isRain = condition === 'Rain' || condition === 'Rain Showers' || condition === 'Drizzle'

        let weatherFactor = 1.0
        if (prob >= 70 && (isHeavyRain || isSnow)) {
            weatherFactor = 0.92  // -8% severe weather
        } else if (prob >= 50 && (isRain || isHeavyRain)) {
            weatherFactor = 0.96  // -4% moderate rain
        } else if (prob >= 30 && condition !== 'Clear' && condition !== 'Cloudy') {
            weatherFactor = 0.98  // -2% light precipitation
        }

        const isSevere = weatherFactor < 0.95

        return {
            date: targetDate,
            maxTempF: temp,
            precipProb: prob,
            condition,
            isSevere,
            weatherFactor
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

    // HEAVY STUFF FIRST
    if (code === 65) return 'Heavy Rain' // Heavy intens
    if (code === 82) return 'Heavy Rain' // Violent showers

    if (code >= 61 && code <= 64) return 'Rain'
    if (code >= 66 && code <= 67) return 'Freezing Rain'
    if (code >= 71 && code <= 77) return 'Snow'
    if (code >= 80 && code <= 81) return 'Rain Showers' // Often heavy but brief
    if (code >= 95) return 'Thunderstorm'

    return 'Unknown'
}
