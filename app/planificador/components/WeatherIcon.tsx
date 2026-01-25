
import { Cloud, CloudRain, Sun, CloudLightning, Snowflake, CloudFog } from 'lucide-react'

export function WeatherIcon({ condition, className }: { condition: string, className?: string }) {
    // OpenWeather Main conditions
    const c = (condition || '').toLowerCase()

    if (c.includes('clear')) return <Sun className={`text-yellow-500 ${className}`} />
    if (c.includes('rain') || c.includes('drizzle')) return <CloudRain className={`text-blue-400 ${className}`} />
    if (c.includes('clouds')) return <Cloud className={`text-gray-400 ${className}`} />
    if (c.includes('thunder')) return <CloudLightning className={`text-purple-500 ${className}`} />
    if (c.includes('snow')) return <Snowflake className={`text-cyan-300 ${className}`} />
    if (c.includes('mist') || c.includes('fog')) return <CloudFog className={`text-gray-300 ${className}`} />

    return <Sun className={`text-gray-300 ${className}`} />
}
