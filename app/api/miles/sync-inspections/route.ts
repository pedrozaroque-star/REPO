/**
 * @module api/miles/sync-inspections
 * @description Sincroniza automáticamente los viajes de un supervisor a partir de sus inspecciones de calidad realizadas en el día de negocio.
 * @businessRules
 * - Lee las inspecciones registradas en supervisor_inspections para la fecha de negocio en California.
 * - Conecta cronológicamente las tiendas visitadas [Tienda A → Tienda B → Tienda C].
 * - Consulta la distancia estándar en store_distances.
 * - Evita duplicar viajes si ya existen para el mismo par de tiendas y fecha.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'

const FALLBACK_DISTANCES: Record<string, number> = {
  'Tacos Gavilan Bell-Tacos Gavilan Downey': 4.70,
  'Tacos Gavilan Downey-Tacos Gavilan Lynwood': 6.64,
  'Tacos Gavilan Lynwood-Tacos Gavilan South Gate': 4.00,
  'Tacos Gavilan Bell-Tacos Gavilan Lynwood': 4.10,
  'Tacos Gavilan South Gate-Tacos Gavilan Downey': 2.70,
  'Tacos Gavilan Bell-Tacos Gavilan South Gate': 2.70,
  'Tacos Gavilan Huntington Park-Tacos Gavilan Bell': 2.90,
  'Tacos Gavilan LA Central-Tacos Gavilan LA Broadway': 2.90,
  'Tacos Gavilan LA Central-Tacos Gavilan Slauson': 4.30,
  'Tacos Gavilan Hollywood-Tacos Gavilan LA Central': 8.50,
  'Tacos Gavilan Downey-Tacos Gavilan Norwalk': 3.80,
  'Tacos Gavilan Norwalk-Tacos Gavilan Santa Ana': 14.20,
  'Tacos Gavilan West Covina-Tacos Gavilan Azusa': 5.20,
  'Tacos Gavilan West Covina-Tacos Gavilan La Puente': 4.60,
  'Tacos Gavilan Azusa-Tacos Gavilan Rialto': 34.50,
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const supabase = await getSupabaseAdminClient()

    const targetDate = body.date || getCaliforniaBusinessDate()
    const supervisorId = body.supervisor_id
    const supervisorName = body.supervisor_name

    // 1. Get current official rate per mile
    const { data: settings } = await supabase
      .from('supervisor_mileage_settings')
      .select('current_rate_per_mile')
      .limit(1)
    const ratePerMile = Number(settings?.[0]?.current_rate_per_mile) || 0.76

    // 2. Fetch stores map
    const { data: stores } = await supabase.from('stores').select('id, name')
    const storeMap: Record<number, string> = {}
    stores?.forEach(s => {
      storeMap[s.id] = s.name.startsWith('Tacos Gavilan') ? s.name : `Tacos Gavilan ${s.name}`
    })

    // 3. Fetch inspections for supervisor on this business date
    let inspQuery = supabase
      .from('supervisor_inspections')
      .select('*')
      .order('created_at', { ascending: true })

    if (supervisorName) {
      inspQuery = inspQuery.ilike('supervisor_name', `%${supervisorName}%`)
    }

    const { data: allInspections, error: inspError } = await inspQuery

    if (inspError) {
      return NextResponse.json({ error: inspError.message }, { status: 500 })
    }

    // Filter by California business date
    const dayInspections = (allInspections || []).filter(i => {
      const bDate = getCaliforniaBusinessDate(i.created_at || i.inspection_date)
      return bDate === targetDate
    })

    if (dayInspections.length < 2) {
      return NextResponse.json({
        success: true,
        created: 0,
        message: `Se encontraron ${dayInspections.length} inspecciones en la fecha ${targetDate}. Se necesitan al menos 2 inspecciones para trazar una ruta entre tiendas.`
      })
    }

    // 4. Fetch standard distance matrix
    const { data: distancesData } = await supabase.from('store_distances').select('*')
    const distanceLookup: Record<string, number> = {}
    distancesData?.forEach(d => {
      distanceLookup[`${d.origin_name}-${d.destination_name}`] = Number(d.distance_miles)
      distanceLookup[`${d.destination_name}-${d.origin_name}`] = Number(d.distance_miles)
    })

    // 5. Fetch existing trips for this date and supervisor to avoid duplicate creation
    let tripsQuery = supabase
      .from('supervisor_mileage_trips')
      .select('*')
      .eq('trip_date', targetDate)

    if (supervisorId) {
      tripsQuery = tripsQuery.eq('supervisor_id', supervisorId)
    } else if (supervisorName) {
      tripsQuery = tripsQuery.ilike('supervisor_name', `%${supervisorName}%`)
    }

    const { data: existingTrips } = await tripsQuery

    const isDuplicate = (origin: string, dest: string) => {
      return (existingTrips || []).some(
        t => t.origin_name === origin && t.destination_name === dest
      )
    }

    // 6. Build consecutive pairs [A -> B], [B -> C]
    const tripsToInsert: any[] = []

    for (let i = 0; i < dayInspections.length - 1; i++) {
      const current = dayInspections[i]
      const next = dayInspections[i + 1]

      const originName = storeMap[current.store_id] || current.store_name || `Tienda #${current.store_id}`
      const destName = storeMap[next.store_id] || next.store_name || `Tienda #${next.store_id}`

      if (originName === destName) continue
      if (isDuplicate(originName, destName)) continue

      // Look up distance
      const key1 = `${originName}-${destName}`
      const key2 = `${destName}-${originName}`
      const distance = distanceLookup[key1] || distanceLookup[key2] || FALLBACK_DISTANCES[key1] || FALLBACK_DISTANCES[key2] || 4.5

      const startTime = new Date(current.created_at).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })

      const supName = current.supervisor_name || supervisorName || 'Supervisor'

      tripsToInsert.push({
        supervisor_id: supervisorId || current.supervisor_id || 'e89547d2-7c8d-4e9e-97c3-71869e984920',
        supervisor_name: supName,
        supervisor_email: current.supervisor_email || 'willian@tacosgavilan.com',
        trip_date: targetDate,
        start_time: startTime,
        origin_type: 'store',
        origin_name: originName,
        destination_type: 'store',
        destination_name: destName,
        is_round_trip: false,
        purpose: 'Business',
        purpose_notes: `Generado automáticamente desde Inspección de Calidad (${originName} → ${destName})`,
        distance_miles: distance,
        rate_per_mile: ratePerMile,
        parking_amount: 0,
        tolls_amount: 0,
        status: 'pending'
      })
    }

    if (tripsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        message: 'Todas las rutas de las inspecciones ya se encuentran registradas en DriveLog.'
      })
    }

    const { data: inserted, error: insertError } = await supabase
      .from('supervisor_mileage_trips')
      .insert(tripsToInsert)
      .select()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      created: inserted?.length || 0,
      trips: inserted,
      message: `Se sincronizaron con éxito ${inserted?.length} viajes de inspección para el día ${targetDate}.`
    })
  } catch (error: any) {
    console.error('Error in sync-inspections:', error)
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 })
  }
}
