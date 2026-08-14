/**
 * @module api/miles/calculate-distance/route
 * @description API route to automatically calculate realistic driving distances between store pairs using map coordinates and traffic-evasion median routing logic.
 * @businessRules
 * - Uses store coordinates (latitude, longitude) and addresses from the 'stores' table.
 * - Applies a balanced route model ("ni la más larga ni la más corta") to reflect real supervisor driving detours to evade LA traffic.
 * - Integrates Google Maps API when key is available, falling back to Haversine with a 1.33x SoCal urban detour multiplier.
 * @dataFlow Client GET request -> Stores DB / Maps API -> Calculated distance JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
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

function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const origin = searchParams.get('origin')
    const destination = searchParams.get('destination')

    if (!origin || !destination) {
      return NextResponse.json(
        { error: 'Origen y destino son requeridos (origin, destination)' },
        { status: 400 }
      )
    }

    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      return NextResponse.json({
        success: true,
        origin,
        destination,
        distance_miles: 0,
        route_type: 'same_location',
        notes: 'Misma ubicación'
      })
    }

    const supabase = await getSupabaseAdminClient()

    const { data: dbStores } = await supabase
      .from('stores')
      .select('name, address, city, latitude, longitude')
      .eq('is_active', true)

    const storeMap: Record<string, { lat: number; lng: number; address: string }> = { ...STORE_COORDINATES }

    if (dbStores && dbStores.length > 0) {
      dbStores.forEach(s => {
        const fullName = s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
        if (s.latitude && s.longitude) {
          storeMap[fullName] = {
            lat: Number(s.latitude),
            lng: Number(s.longitude),
            address: `${s.address || ''}, ${s.city || ''}, CA`
          }
          const shortName = s.name.replace(/^Tacos Gavilan\s+/i, '').trim()
          storeMap[shortName] = storeMap[fullName]
        }
      })
    }

    const origInfo = storeMap[origin] || STORE_COORDINATES[origin]
    const destInfo = storeMap[destination] || STORE_COORDINATES[destination]

    let distanceMiles = 0
    let routeMethod = 'median_traffic_evasion'
    let notes = 'Ruta intermedia balanceada (evasión de tráfico)'

    const apiKey = process.env.GOOGLE_MAPS_API_KEY

    if (apiKey && origInfo?.address && destInfo?.address) {
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
          origInfo.address
        )}&destinations=${encodeURIComponent(destInfo.address)}&mode=driving&key=${apiKey}`

        const googleRes = await fetch(googleUrl)
        const googleData = await googleRes.json()

        if (
          googleData.status === 'OK' &&
          googleData.rows?.[0]?.elements?.[0]?.status === 'OK'
        ) {
          const meters = googleData.rows[0].elements[0].distance.value
          const baseMiles = meters / 1609.34
          distanceMiles = parseFloat((baseMiles * 1.08).toFixed(2))
          routeMethod = 'google_maps_median_traffic'
          notes = `Calculado via Google Maps con desvío de tráfico (${baseMiles.toFixed(2)} mi directas)`
        }
      } catch (errGoogle) {
        console.warn('Google Maps Distance Matrix call failed, falling back to Haversine median formula:', errGoogle)
      }
    }

    if (distanceMiles <= 0) {
      if (origInfo?.lat && destInfo?.lat) {
        const directMiles = haversineDistanceMiles(origInfo.lat, origInfo.lng, destInfo.lat, destInfo.lng)
        distanceMiles = parseFloat((directMiles * 1.33).toFixed(2))
        routeMethod = 'haversine_socal_median_grid'
        notes = `Calculado por Mapa IA (Desvío de Tráfico 1.33x)`
      } else {
        distanceMiles = 4.5
        routeMethod = 'estimated_default'
        notes = 'Estimación estándar de recorrido entre sucursales'
      }
    }

    return NextResponse.json({
      success: true,
      origin,
      destination,
      distance_miles: distanceMiles,
      route_type: routeMethod,
      notes
    })
  } catch (err: any) {
    console.error('Error in GET /api/miles/calculate-distance:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
