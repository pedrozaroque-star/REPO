
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

        // OPENWEATHERMAP STRATEGY
        const weatherKey = process.env.OPENWEATHER_API_KEY || process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY

        // 1. If no key, return empty data gracefully (don't crash)
        if (!weatherKey) {
            console.warn('⚠️ OPENWEATHER_API_KEY is missing. Returning empty weather data.')
            return NextResponse.json({ data: [] })
        }

        // 2. Fetch 5-Day Forecast (Standard Free API)
        // https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&appid={API key}
        const weatherUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${weatherKey}`

        console.log(`🌦️ Fetching OpenWeather: ${lat}, ${lon}`)
        const res = await fetch(weatherUrl)

        if (!res.ok) {
            const txt = await res.text()
            console.error('OpenWeather API Error:', txt)
            return NextResponse.json({ error: 'Weather Provider Error: ' + res.status }, { status: 502 }) // Still 502 if upstream fails provided we HAVE a key
        }

        const json = await res.json()

        // 3. Adapter: Collapse 3-hour segments into Daily Highs
        // OpenWeather returns 3-hour steps. We need to find max temp per day.
        const dailyMap: Record<string, any> = {}

        json.list.forEach((item: any) => {
            // item.dt_txt is "2024-01-23 09:00:00"
            const dateStr = item.dt_txt.split(' ')[0]

            if (!dailyMap[dateStr]) {
                dailyMap[dateStr] = {
                    dt: item.dt,
                    temp_max: -999,
                    weather_main: item.weather[0]?.main,
                    weather_desc: item.weather[0]?.description
                }
            }

            // Update Max Temp
            if (item.main.temp_max > dailyMap[dateStr].temp_max) {
                dailyMap[dateStr].temp_max = item.main.temp_max
                // Take the weather condition around noon (or just keep updating, usually fine)
                if (item.dt_txt.includes('12:00:00')) {
                    dailyMap[dateStr].weather_main = item.weather[0]?.main
                    dailyMap[dateStr].weather_desc = item.weather[0]?.description
                }
            }
        })

        const adaptedData = Object.values(dailyMap).map((d: any) => ({
            dt: d.dt,
            temp: { max: d.temp_max },
            weather: [{ main: d.weather_main, description: d.weather_desc }]
        }))

        return NextResponse.json({ data: adaptedData })

    } catch (e: any) {
        console.error(e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
