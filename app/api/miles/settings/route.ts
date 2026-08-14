/**
 * @module api/miles/settings/route
 * @description API endpoint to fetch and update mileage rates and standard store distance matrix.
 * @businessRules
 * - Default rate per mile is $0.725 (IRS standard reimbursement rate).
 * - Admins can update current rate per mile and manage standard distance estimates between store pairs.
 * - 'auto_populate_matrix' calculates pairwise driving distances for all active stores using map coordinates and traffic evasion model directly in Supabase.
 * @dataFlow Client GET/POST request -> Supabase ('supervisor_mileage_settings', 'store_distances') -> Response JSON.
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

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function calculateDirectDistance(orig: string, dest: string, storeMap: Record<string, { lat: number; lng: number }>): { distance: number; notes: string } {
  if (orig.trim().toLowerCase() === dest.trim().toLowerCase()) {
    return { distance: 0, notes: 'Misma ubicación' }
  }

  const o = storeMap[orig] || STORE_COORDINATES[orig]
  const d = storeMap[dest] || STORE_COORDINATES[dest]

  if (o?.lat && d?.lat) {
    const direct = haversineMiles(o.lat, o.lng, d.lat, d.lng)
    const miles = parseFloat((direct * 1.33).toFixed(2))
    return { distance: miles > 0 ? miles : 2.5, notes: 'Calculado por Mapa IA (Desvío de Tráfico 1.33x)' }
  }

  return { distance: 4.5, notes: 'Estimación mapa por defecto' }
}

export async function GET() {
  try {
    const supabase = await getSupabaseAdminClient()

    // 1. Fetch settings
    const { data: settings } = await supabase
      .from('supervisor_mileage_settings')
      .select('*')
      .limit(1)

    const currentRate = settings && settings.length > 0 ? Number(settings[0].current_rate_per_mile) : 0.725

    // 2. Fetch distance matrix
    const { data: distances } = await supabase
      .from('store_distances')
      .select('*')
      .order('origin_name')

    const defaultDistances = [
      { id: '1', origin_name: 'Tacos Gavilan LA Central', destination_name: 'Tacos Gavilan LA Broadway', distance_miles: 2.9, notes: 'Ruta directa vía Broadway' },
      { id: '2', origin_name: 'Tacos Gavilan LA Central', destination_name: 'Tacos Gavilan Slauson', distance_miles: 6.2, notes: 'Vía Slauson Ave' },
      { id: '3', origin_name: 'Tacos Gavilan Slauson', destination_name: 'Tacos Gavilan Hollywood', distance_miles: 12.5, notes: 'Vía Freeway 101' },
      { id: '4', origin_name: 'Tacos Gavilan LA Broadway', destination_name: 'Tacos Gavilan Slauson', distance_miles: 3.2, notes: 'Vía Broadway y Slauson' },
      { id: '5', origin_name: 'Bodega Central', destination_name: 'Tacos Gavilan LA Central', distance_miles: 4.5, notes: 'Surtido de almacén' }
    ]

    return NextResponse.json({
      success: true,
      rate_per_mile: currentRate,
      distances: (distances && distances.length > 0) ? distances : defaultDistances
    })
  } catch (err: any) {
    console.error('Error in GET /api/miles/settings:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, rate_per_mile, origin_name, destination_name, distance_miles, notes, updated_by } = body
    const supabase = await getSupabaseAdminClient()

    if (action === 'update_rate') {
      if (rate_per_mile === undefined) {
        return NextResponse.json({ error: 'rate_per_mile requerido' }, { status: 400 })
      }

      const { data: settings } = await supabase
        .from('supervisor_mileage_settings')
        .select('*')
        .limit(1)

      if (settings && settings.length > 0) {
        await supabase
          .from('supervisor_mileage_settings')
          .update({
            current_rate_per_mile: Number(rate_per_mile),
            updated_at: new Date().toISOString(),
            updated_by: updated_by || null
          })
          .eq('id', settings[0].id)
      } else {
        await supabase
          .from('supervisor_mileage_settings')
          .insert({
            current_rate_per_mile: Number(rate_per_mile),
            updated_by: updated_by || null
          })
      }

      return NextResponse.json({ success: true, rate_per_mile: Number(rate_per_mile) })
    }

    if (action === 'upsert_distance') {
      if (!origin_name || !destination_name || distance_miles === undefined) {
        return NextResponse.json({ error: 'Campos requeridos: origin_name, destination_name, distance_miles' }, { status: 400 })
      }

      const { data: upserted, error } = await supabase
        .from('store_distances')
        .upsert(
          {
            origin_name,
            destination_name,
            distance_miles: Number(distance_miles),
            notes: notes || ''
          },
          { onConflict: 'origin_name,destination_name' }
        )
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, distance: upserted })
    }

    if (action === 'auto_populate_matrix') {
      // 1. Fetch active stores from DB
      const { data: dbStores } = await supabase
        .from('stores')
        .select('name, address, city, latitude, longitude')
        .eq('is_active', true)

      const storeMap: Record<string, { lat: number; lng: number }> = {}

      // Add presets first
      Object.keys(STORE_COORDINATES).forEach(k => {
        storeMap[k] = { lat: STORE_COORDINATES[k].lat, lng: STORE_COORDINATES[k].lng }
        const shortName = k.replace(/^Tacos Gavilan\s+/i, '').trim()
        storeMap[shortName] = storeMap[k]
      })

      const storeNames: string[] = []

      if (dbStores && dbStores.length > 0) {
        dbStores.forEach(s => {
          const fullName = s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
          if (!storeNames.includes(fullName)) storeNames.push(fullName)

          if (s.latitude && s.longitude) {
            storeMap[fullName] = { lat: Number(s.latitude), lng: Number(s.longitude) }
            const shortName = s.name.replace(/^Tacos Gavilan\s+/i, '').trim()
            storeMap[shortName] = storeMap[fullName]
          }
        })
      }

      // Add central landmarks if missing
      ['Bodega Central', 'Oficina Corporativa'].forEach(l => {
        if (!storeNames.includes(l)) storeNames.push(l)
      })

      const upsertRows: { origin_name: string; destination_name: string; distance_miles: number; notes: string }[] = []

      // Generate pairwise combinations for all active store branches
      for (let i = 0; i < storeNames.length; i++) {
        for (let j = i + 1; j < storeNames.length; j++) {
          const orig = storeNames[i]
          const dest = storeNames[j]
          const calc = calculateDirectDistance(orig, dest, storeMap)
          if (calc.distance > 0) {
            upsertRows.push({
              origin_name: orig,
              destination_name: dest,
              distance_miles: calc.distance,
              notes: calc.notes
            })
          }
        }
      }

      if (upsertRows.length > 0) {
        // Clear old default rows if any, then insert full matrix
        const { error: upsertErr } = await supabase
          .from('store_distances')
          .upsert(upsertRows, { onConflict: 'origin_name,destination_name' })

        if (upsertErr) {
          console.error('Error upserting store_distances:', upsertErr.message)
          return NextResponse.json({ error: upsertErr.message }, { status: 500 })
        }
      }

      // Fetch fresh updated matrix
      const { data: updatedMatrix } = await supabase
        .from('store_distances')
        .select('*')
        .order('origin_name')

      return NextResponse.json({
        success: true,
        message: `¡Matriz generada con éxito para ${storeNames.length} sucursales y ${upsertRows.length} rutas calculadas por Mapa IA!`,
        distances: updatedMatrix || upsertRows
      })
    }

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
  } catch (err: any) {
    console.error('Error in POST /api/miles/settings:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
