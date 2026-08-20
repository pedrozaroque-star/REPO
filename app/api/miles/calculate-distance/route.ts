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
import { CANONICAL_STORE_COORDINATES, haversineDistanceMiles } from '@/lib/store-coordinates'

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
      .select('name, address, city, state, zip_code, latitude, longitude')
      .eq('is_active', true)

    const storeMap: Record<string, { lat: number; lng: number; address: string }> = {}

    // Populate from CANONICAL_STORE_COORDINATES
    Object.entries(CANONICAL_STORE_COORDINATES).forEach(([key, loc]) => {
      const fullAddr = `${loc.address}, ${loc.city}, ${loc.state} ${loc.zip_code}`.trim()
      storeMap[key] = { lat: loc.lat, lng: loc.lng, address: fullAddr }
      if (loc.shortName && loc.shortName !== key) {
        storeMap[loc.shortName] = storeMap[key]
      }
    })

    if (dbStores && dbStores.length > 0) {
      dbStores.forEach(s => {
        const fullName = s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
        if (s.latitude && s.longitude) {
          const fullAddr = `${s.address || ''}, ${s.city || ''}, ${s.state || 'CA'} ${s.zip_code || ''}`.trim()
          storeMap[fullName] = {
            lat: Number(s.latitude),
            lng: Number(s.longitude),
            address: fullAddr
          }
          const shortName = s.name.replace(/^Tacos Gavilan\s+/i, '').trim()
          if (shortName && shortName !== fullName) {
            storeMap[shortName] = storeMap[fullName]
          }
        }
      })
    }

    const origInfo = storeMap[origin]
    const destInfo = storeMap[destination]

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
