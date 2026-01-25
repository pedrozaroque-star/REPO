
import { useState, useEffect } from 'react'

export interface WeatherDay {
    dt: number
    temp: { max: number }
    weather: { main: string, description: string }[]
    dateStr?: string // YYYY-MM-DD
}

export function useWeather(storeId: string | null) {
    const [weather, setWeather] = useState<Record<string, WeatherDay>>({})
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!storeId) return

        async function fetchWeather() {
            setLoading(true)
            console.log("🌦️ [useWeather] Fetching for:", storeId)
            try {
                // Fetch via our local API proxy
                const res = await fetch(`/api/external/weather?storeId=${storeId}`)
                if (!res.ok) throw new Error('Weather fetch failed')

                const json = await res.json()
                console.log("🌦️ [useWeather] Response:", json)

                if (json.data) {
                    const map: Record<string, WeatherDay> = {}

                    json.data.forEach((d: WeatherDay) => {
                        // OpenWeather dt is Unix Seconds
                        // We must reconstruct the date string YYYY-MM-DD that matches the Planner's "local" view
                        // If we use toISOString(), 5pm PST might become next day UTC.
                        // We force 'America/Los_Angeles' logic here too.
                        const date = new Date(d.dt * 1000)
                        const dateKey = new Intl.DateTimeFormat('en-CA', {
                            timeZone: 'America/Los_Angeles',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit'
                        }).format(date)

                        map[dateKey] = d
                    })
                    setWeather(map)
                }
            } catch (e) {
                console.error("Weather error:", e)
            } finally {
                setLoading(false)
            }
        }

        fetchWeather()
    }, [storeId])

    return { weather, loading }
}
