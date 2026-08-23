/**
 * @module api/miles/checkin
 * @description Registra presencia física de supervisores por GPS en sucursales de Tacos Gavilan, detecta transiciones de ruta y auto-crea o sugiere viajes en MilesIQ.
 * @businessRules
 * - Regla de 6:00 AM de California para asignación de fecha contable (America/Los_Angeles).
 * - Tarifa oficial de reembolso IRS: $0.760/mi.
 * - Detecta si el supervisor se trasladó de una tienda A a una tienda B.
 * - Permite auto-creación directa (auto_create_trip: true) o emisión de sugerencia de 1 clic para la interfaz.
 * - Previene duplicados idénticos en ventanas menores a 15 minutos.
 * @dataFlow
 * - Consulta: stores, store_distances, supervisor_mileage_settings, supervisor_mileage_trips
 * - Inserta: supervisor_mileage_trips (cuando auto_create_trip es true)
 * @notes
 * - Diseñado para replicar la experiencia sin fricción de la app comercial de MilesIQ sin requerir suscripciones de pago.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { CANONICAL_STORE_COORDINATES, haversineDistanceMiles, normalizeStoreName } from '@/lib/store-coordinates'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const supabase = await getSupabaseAdminClient()

    const {
      supervisor_id,
      supervisor_name,
      supervisor_email,
      store_name,
      store_id,
      previous_store_name,
      latitude,
      longitude,
      auto_create_trip = false,
      source = 'gps_auto'
    } = body

    if (!supervisor_name || !store_name) {
      return NextResponse.json(
        { error: 'supervisor_name and store_name are required' },
        { status: 400 }
      )
    }

    const currentStore = normalizeStoreName(store_name)
    const targetDate = getCaliforniaBusinessDate()

    // 1. Get current official rate per mile
    const { data: settings } = await supabase
      .from('supervisor_mileage_settings')
      .select('current_rate_per_mile')
      .limit(1)
    const ratePerMile = Number(settings?.[0]?.current_rate_per_mile) || 0.76

    // 2. Determine previous store (origin)
    let originName = previous_store_name ? normalizeStoreName(previous_store_name) : ''

    // If no previous store provided, look up the supervisor's last trip destination today
    if (!originName || originName === currentStore) {
      let lastTripQuery = supabase
        .from('supervisor_mileage_trips')
        .select('destination_name, created_at')
        .eq('trip_date', targetDate)
        .order('created_at', { ascending: false })
        .limit(1)

      if (supervisor_id) {
        lastTripQuery = lastTripQuery.eq('supervisor_id', supervisor_id)
      } else {
        lastTripQuery = lastTripQuery.ilike('supervisor_name', `%${supervisor_name}%`)
      }

      const { data: lastTrips } = await lastTripQuery
      if (lastTrips && lastTrips.length > 0 && lastTrips[0].destination_name) {
        const potentialOrigin = normalizeStoreName(lastTrips[0].destination_name)
        if (potentialOrigin !== currentStore) {
          originName = potentialOrigin
        }
      }
    }

    // If still no origin, look up last inspection destination today
    if (!originName || originName === currentStore) {
      let lastInspQuery = supabase
        .from('supervisor_inspections')
        .select('store_id, created_at')
        .order('created_at', { ascending: false })
        .limit(2)

      if (supervisor_name) {
        lastInspQuery = lastInspQuery.ilike('supervisor_name', `%${supervisor_name}%`)
      }

      const { data: lastInsps } = await lastInspQuery
      if (lastInsps && lastInsps.length > 0) {
        // Fetch stores mapping
        const { data: allStores } = await supabase.from('stores').select('id, name')
        const storeMap: Record<string, string> = {}
        allStores?.forEach(s => {
          storeMap[String(s.id)] = normalizeStoreName(s.name)
        })

        for (const insp of lastInsps) {
          const inspStoreName = storeMap[String(insp.store_id)]
          if (inspStoreName && inspStoreName !== currentStore) {
            originName = inspStoreName
            break
          }
        }
      }
    }

    // If origin is still equal to current store or not found, just confirm presence without a trip
    if (!originName || originName === currentStore) {
      return NextResponse.json({
        success: true,
        presence_confirmed: true,
        current_store: currentStore,
        has_pending_transition: false,
        message: `Presencia confirmada en ${currentStore}.`
      })
    }

    // 3. Look up distance between origin and currentStore
    const { data: distances } = await supabase
      .from('store_distances')
      .select('distance_miles')
      .or(`and(origin_name.ilike.%${originName}%,destination_name.ilike.%${currentStore}%),and(origin_name.ilike.%${currentStore}%,destination_name.ilike.%${originName}%)`)
      .limit(1)

    let distanceMiles = distances?.[0]?.distance_miles ? Number(distances[0].distance_miles) : 0

    if (!distanceMiles || distanceMiles <= 0) {
      const oLoc = CANONICAL_STORE_COORDINATES[originName]
      const dLoc = CANONICAL_STORE_COORDINATES[currentStore]
      if (oLoc && dLoc) {
        distanceMiles = parseFloat((haversineDistanceMiles(oLoc.lat, oLoc.lng, dLoc.lat, dLoc.lng) * 1.33).toFixed(2))
      } else {
        distanceMiles = 4.5
      }
    }

    const mileageValue = parseFloat((distanceMiles * ratePerMile).toFixed(2))
    const totalReimbursement = mileageValue

    const nowLa = new Date()
    const startTime = nowLa.toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    // 4. Check for duplicate trip by THIS supervisor in the last 15 minutes
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    let dupQuery = supabase
      .from('supervisor_mileage_trips')
      .select('id, origin_name, destination_name, created_at')
      .eq('trip_date', targetDate)
      .eq('origin_name', originName)
      .eq('destination_name', currentStore)
      .gte('created_at', fifteenMinsAgo)

    if (supervisor_id) {
      dupQuery = dupQuery.eq('supervisor_id', supervisor_id)
    } else if (supervisor_name) {
      dupQuery = dupQuery.ilike('supervisor_name', `%${supervisor_name}%`)
    }

    const { data: recentDuplicates } = await dupQuery.limit(1)

    if (recentDuplicates && recentDuplicates.length > 0) {
      return NextResponse.json({
        success: true,
        presence_confirmed: true,
        current_store: currentStore,
        has_pending_transition: false,
        already_logged: true,
        trip_id: recentDuplicates[0].id,
        message: `El recorrido ${originName} → ${currentStore} ya fue registrado recientemente para ${supervisor_name || 'este supervisor'}.`
      })
    }

    // 5. If auto_create_trip is true, insert the trip directly into supervisor_mileage_trips
    if (auto_create_trip) {
      let resolvedSupervisorId = supervisor_id
      if (!resolvedSupervisorId && (supervisor_name || supervisor_email)) {
        const { data: matchedUser } = await supabase
          .from('users')
          .select('id')
          .or(`email.eq.${supervisor_email || ''},full_name.ilike.%${supervisor_name || ''}%`)
          .limit(1)
        if (matchedUser && matchedUser[0]?.id) {
          resolvedSupervisorId = String(matchedUser[0].id)
        }
      }

      const newTrip = {
        supervisor_id: resolvedSupervisorId || supervisor_name,
        supervisor_name: supervisor_name,
        supervisor_email: supervisor_email || 'supervisor@tacosgavilan.com',
        trip_date: targetDate,
        start_time: startTime,
        origin_type: 'store',
        origin_name: originName,
        destination_type: 'store',
        destination_name: currentStore,
        is_round_trip: false,
        purpose: 'Business',
        purpose_notes: `Auto-detectado por presencia GPS (${source})`,
        distance_miles: distanceMiles,
        rate_per_mile: ratePerMile,
        parking_amount: 0,
        tolls_amount: 0,
        status: 'pending'
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('supervisor_mileage_trips')
        .insert([newTrip])
        .select()
        .single()

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        trip_created: true,
        trip: inserted,
        origin_name: originName,
        destination_name: currentStore,
        distance_miles: distanceMiles,
        total_reimbursement: totalReimbursement,
        message: `Recorrido auto-guardado: ${originName} → ${currentStore} (${distanceMiles} mi • $${totalReimbursement} USD)`
      })
    }

    // If not auto-created, return the suggestion for 1-click confirmation in UI
    return NextResponse.json({
      success: true,
      trip_suggested: true,
      origin_name: originName,
      destination_name: currentStore,
      distance_miles: distanceMiles,
      rate_per_mile: ratePerMile,
      total_reimbursement: totalReimbursement,
      start_time: startTime,
      message: `Traslado detectado: ${originName} → ${currentStore} (${distanceMiles} mi • $${totalReimbursement} USD)`
    })

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Error en checkin de supervisor' },
      { status: 500 }
    )
  }
}
