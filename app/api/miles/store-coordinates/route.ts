/**
 * @module api/miles/store-coordinates/route
 * @description API endpoint que retorna las coordenadas geográficas de todas las tiendas activas,
 *              la Bodega Central y la Oficina Corporativa para pintar marcadores en el mapa de MilesIQ.
 * @businessRules
 * - Las coordenadas provienen primero de la tabla 'stores' en Supabase.
 * - Si una tienda no tiene coordenadas en DB, se usa el diccionario hardcodeado STORE_COORDINATES como fallback.
 * - Siempre incluye Bodega Central (5182 Malabar St, Vernon) y Oficina Corporativa.
 * @dataFlow Client GET → Supabase stores → merge con fallback → JSON response
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

const STORE_COORDINATES: Record<string, { lat: number; lng: number; address: string }> = {
  'Tacos Gavilan LA Central': { lat: 33.9947, lng: -118.2784, address: '4801 S Central Ave, Los Angeles, CA 90011' },
  'Tacos Gavilan LA Broadway': { lat: 34.0152, lng: -118.2736, address: '4363 S Broadway, Los Angeles, CA 90037' },
  'Tacos Gavilan Slauson': { lat: 33.9892, lng: -118.2560, address: '200 W Slauson Ave, Los Angeles, CA 90003' },
  'Tacos Gavilan Hollywood': { lat: 34.0983, lng: -118.3267, address: '7083 Sunset Blvd, Los Angeles, CA 90028' },
  'Tacos Gavilan Lynwood': { lat: 33.9248, lng: -118.2045, address: '3740 E Imperial Hwy, Lynwood, CA 90262' },
  'Tacos Gavilan Huntington Park': { lat: 33.9818, lng: -118.2251, address: '2652 Florence Ave, Huntington Park, CA 90255' },
  'Tacos Gavilan Bell': { lat: 33.9806, lng: -118.1867, address: '4406 E Florence Ave, Bell, CA 90201' },
  'Tacos Gavilan Downey': { lat: 33.9312, lng: -118.1251, address: '12051 Paramount Blvd, Downey, CA 90242' },
  'Tacos Gavilan Norwalk': { lat: 33.9015, lng: -118.0818, address: '12539 Rosecrans Ave, Norwalk, CA 90650' },
  'Tacos Gavilan Santa Ana': { lat: 33.7456, lng: -117.8678, address: '801 W 17th St, Santa Ana, CA 92706' },
  'Tacos Gavilan La Puente': { lat: 34.0321, lng: -117.9421, address: '13009 Valley Blvd, La Puente, CA 91746' },
  'Tacos Gavilan Azusa': { lat: 34.1336, lng: -117.9076, address: '122 N Azusa Ave, Azusa, CA 91702' },
  'Tacos Gavilan West Covina': { lat: 34.0412, lng: -117.9011, address: '2330 S Azusa Ave, West Covina, CA 91792' },
  'Tacos Gavilan South Gate': { lat: 33.9452, lng: -118.1812, address: '8940 Garfield Ave, South Gate, CA 90280' },
  'Tacos Gavilan Rialto': { lat: 34.1065, lng: -117.3701, address: '240 W Baseline Rd, Rialto, CA 92376' },
  'Bodega Central': { lat: 34.00445, lng: -118.20436, address: '5182 Malabar St, Vernon, CA 90058' },
  'Oficina Corporativa': { lat: 33.9947, lng: -118.2784, address: '5304 S Broadway, Los Angeles, CA 90037' }
}

export async function GET() {
  try {
    const supabase = await getSupabaseAdminClient()

    const { data: dbStores } = await supabase
      .from('stores')
      .select('name, address, city, latitude, longitude')
      .eq('is_active', true)

    // Start with hardcoded fallback, then override with DB values
    const coordinates: Record<string, { lat: number; lng: number; address: string }> = { ...STORE_COORDINATES }

    if (dbStores && dbStores.length > 0) {
      dbStores.forEach(s => {
        if (s.latitude && s.longitude) {
          const fullName = s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
          coordinates[fullName] = {
            lat: Number(s.latitude),
            lng: Number(s.longitude),
            address: `${s.address || ''}, ${s.city || ''}, CA`
          }
          // Also map short name for flexible matching
          const shortName = s.name.replace(/^Tacos Gavilan\s+/i, '').trim()
          if (shortName !== fullName) {
            coordinates[shortName] = coordinates[fullName]
          }
        }
      })
    }

    return NextResponse.json({ success: true, coordinates })
  } catch (err: any) {
    console.error('Error in GET /api/miles/store-coordinates:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
