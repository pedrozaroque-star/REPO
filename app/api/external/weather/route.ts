
import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const storeId = searchParams.get('storeId')
        const latParam = searchParams.get('lat')
        const lonParam = searchParams.get('lon')

        if (!storeId && (!latParam || !lonParam)) {
            return NextResponse.json({ error: 'Missing storeId or coordinates' }, { status: 400 })
        }

        let lat = latParam
        let lon = lonParam

        if (storeId && (!lat || !lon)) {
            const supabase = await getSupabaseClient()
            const { data: store, error } = await supabase
                .from('stores')
                .select('latitude, longitude')
                .eq('external_id', storeId)
                .single()

            if (error || !store) {
                return NextResponse.json({ error: 'Store or coordinates not found' }, { status: 404 })
            }
            lat = store.latitude
            lon = store.longitude
        }

        if (!lat || !lon) {
            return NextResponse.json({ error: 'Coordinates missing for this store' }, { status: 400 })
        }

        // OPEN-METEO STRATEGY (No Key Required)
        // https://open-meteo.com/en/docs
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,weathercode&temperature_unit=fahrenheit&timezone=auto`

        console.log(`🌦️ Fetching Open-Meteo: ${lat}, ${lon}`)
        const res = await fetch(weatherUrl)

        if (!res.ok) {
            const txt = await res.text()
            console.error('Open-Meteo API Error:', txt)
            return NextResponse.json({ error: 'Weather Provider Error: ' + res.status }, { status: 502 })
        }

        const json = await res.json()

        // Helper to map WMO code to OpenWeather-style main/desc
        // https://open-meteo.com/en/docs#weathervariables
        const mapWmo = (code: number) => {
            if (code === 0) return { main: 'Clear', description: 'clear sky' }
            if (code === 1 || code === 2 || code === 3) return { main: 'Clouds', description: 'partly cloudy' }
            if (code >= 45 && code <= 48) return { main: 'Mist', description: 'fog' }
            if (code >= 51 && code <= 67) return { main: 'Rain', description: 'drizzle/rain' }
            if (code >= 71 && code <= 77) return { main: 'Snow', description: 'snow' }
            if (code >= 80 && code <= 82) return { main: 'Rain', description: 'showers' }
            if (code >= 85 && code <= 86) return { main: 'Snow', description: 'snow showers' }
            if (code >= 95 && code <= 99) return { main: 'Thunderstorm', description: 'thunderstorm' }
            return { main: 'Clouds', description: 'unknown' }
        }

        const daily = json.daily || {}
        if (!daily.time || !daily.temperature_2m_max) {
            return NextResponse.json({ data: [] })
        }

        const adaptedData = daily.time.map((dateStr: string, i: number) => {
            // Open-Meteo returns YYYY-MM-DD strings directly.
            // We need to return a structure compatible with our frontend hook.
            // Hook expects: { dt: unix_seconds, temp: {max}, weather: [{main, description}] }
            // To ensure hook's date logic works (dt * 1000), we should provide a noon-time unix timestamp for that date.

            const noonDate = new Date(`${dateStr}T12:00:00`)
            const dt = Math.floor(noonDate.getTime() / 1000)
            const code = daily.weathercode ? daily.weathercode[i] : 0
            const cond = mapWmo(code)

            return {
                dt: dt,
                temp: { max: daily.temperature_2m_max[i] },
                weather: [{ main: cond.main, description: cond.description }]
            }
        })

        return NextResponse.json({ data: adaptedData })

    } catch (e: any) {
        console.error(e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
