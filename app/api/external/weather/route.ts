
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

        // --- STRATEGY 1: NWS (api.weather.gov) ---
        // Best for US stores (all CA), no API key, very reliable local routing.
        try {
            console.log(`🌦️ Fetching NWS Weather: ${lat}, ${lon}`)
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)

            const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
                headers: { 'User-Agent': 'TacosGavilanApp/1.0 (contact@tacosgavilan.com)' },
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (pointsRes.ok) {
                const pointsJson = await pointsRes.json()
                const forecastUrl = pointsJson.properties?.forecast

                if (forecastUrl) {
                    const forecastController = new AbortController()
                    const forecastTimeoutId = setTimeout(() => forecastController.abort(), 3000)

                    const forecastRes = await fetch(forecastUrl, {
                        headers: { 'User-Agent': 'TacosGavilanApp/1.0 (contact@tacosgavilan.com)' },
                        signal: forecastController.signal
                    })
                    clearTimeout(forecastTimeoutId)

                    if (forecastRes.ok) {
                        const forecastJson = await forecastRes.json()
                        const periods = forecastJson.properties?.periods || []
                        const dayPeriods = periods.filter((p: any) => p.isDaytime)

                        if (dayPeriods.length > 0) {
                            const adaptedData = dayPeriods.map((p: any) => {
                                const dateStr = p.startTime.split('T')[0]
                                const noonDate = new Date(`${dateStr}T12:00:00`)
                                const dt = Math.floor(noonDate.getTime() / 1000)

                                const sf = (p.shortForecast || '').toLowerCase()
                                let main = 'Clouds'
                                let description = p.shortForecast

                                if (sf.includes('sun') || sf.includes('clear') || sf.includes('sunny')) {
                                    main = 'Clear'
                                } else if (sf.includes('rain') || sf.includes('drizzle') || sf.includes('shower')) {
                                    main = 'Rain'
                                } else if (sf.includes('fog') || sf.includes('mist') || sf.includes('haze')) {
                                    main = 'Mist'
                                } else if (sf.includes('snow')) {
                                    main = 'Snow'
                                } else if (sf.includes('thunder')) {
                                    main = 'Thunderstorm'
                                }

                                return {
                                    dt: dt,
                                    temp: { max: p.temperature },
                                    weather: [{ main: main, description: description }]
                                }
                            })

                            console.log(`✅ [NWS] Weather successfully fetched and adapted for ${lat}, ${lon}`)
                            const filledData = fillWeatherData(adaptedData, parseFloat(String(lat)), parseFloat(String(lon)))
                            return NextResponse.json({ data: filledData })
                        }
                    }
                }
            }
        } catch (nwsErr: any) {
            console.warn('⚠️ NWS Weather fetch failed, falling back to Open-Meteo:', nwsErr.message || nwsErr)
        }

        // --- STRATEGY 2: OPEN-METEO FALLBACK ---
        // https://open-meteo.com/en/docs
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,weathercode&temperature_unit=fahrenheit&timezone=auto`

        console.log(`🌦️ Fetching Open-Meteo Fallback: ${lat}, ${lon}`)
        
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000)
        
        let res
        try {
            res = await fetch(weatherUrl, { signal: controller.signal })
        } catch (fetchErr: any) {
            console.error('Open-Meteo Fetch Error (Timeout/Network):', fetchErr.message || fetchErr)
            return NextResponse.json({ error: 'Weather Providers unavailable' }, { status: 504 })
        } finally {
            clearTimeout(timeoutId)
        }

        if (!res.ok) {
            const txt = await res.text()
            console.error('Open-Meteo API Error:', txt)
            return NextResponse.json({ error: 'Weather Provider Error: ' + res.status }, { status: 502 })
        }

        const json = await res.json()

        // Helper to map WMO code to OpenWeather-style main/desc
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

        const filledData = fillWeatherData(adaptedData, parseFloat(String(lat)), parseFloat(String(lon)))
        return NextResponse.json({ data: filledData })

    } catch (e: any) {
        console.error(e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

// ============================================================================
// HELPERS FOR 14-DAY CLIMATOLOGICAL OUTLOOK FALLBACK
// ============================================================================

function getHistoricalWeather(lat: number, lon: number, date: Date) {
    const month = date.getMonth(); // 0-11
    const isRialto = lon > -117.5; // Rialto is inland, others are coastal/LA
    
    // High temps by month in Fahrenheit
    const coastalTemps = [68, 69, 71, 73, 75, 79, 83, 84, 83, 79, 73, 68];
    const inlandTemps = [67, 69, 73, 78, 83, 90, 97, 97, 92, 83, 73, 67];
    
    const temp = isRialto ? inlandTemps[month] : coastalTemps[month];
    
    // Weather condition by month
    const isSunnyMonth = month >= 4 && month <= 9; // May - Oct
    const main = isSunnyMonth ? 'Clear' : 'Clouds';
    const description = isSunnyMonth ? 'Sunny' : 'Partly Cloudy';
    
    return {
        temp,
        main,
        description
    };
}

function fillWeatherData(realData: any[], lat: number, lon: number) {
    const today = new Date()
    const merged: any[] = []
    
    for (let i = 0; i < 14; i++) {
        const targetDate = new Date()
        targetDate.setDate(today.getDate() + i)
        
        const dateStr = targetDate.toLocaleDateString('en-CA', {
            timeZone: 'America/Los_Angeles'
        })
        
        // Find in realData by formatting dt into date string in America/Los_Angeles timezone
        const realEntry = realData.find(entry => {
            const entryDate = new Date(entry.dt * 1000).toLocaleDateString('en-CA', {
                timeZone: 'America/Los_Angeles'
            })
            return entryDate === dateStr
        })
        
        if (realEntry) {
            merged.push(realEntry)
        } else {
            const hist = getHistoricalWeather(lat, lon, targetDate)
            const noonDate = new Date(`${dateStr}T12:00:00`)
            const targetDt = Math.floor(noonDate.getTime() / 1000)
            
            merged.push({
                dt: targetDt,
                temp: { max: hist.temp },
                weather: [{ main: hist.main, description: hist.description }]
            })
        }
    }
    
    return merged
}
