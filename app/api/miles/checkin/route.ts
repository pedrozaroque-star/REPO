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
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { CANONICAL_STORE_COORDINATES, haversineDistanceMiles, normalizeStoreName } from '@/lib/store-coordinates'

export async function POST(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) return auth.response!

  try {
    const body = await req.json().catch(() => ({}))
    const supabase = await getSupabaseAdminClient()
    const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
    const isAdminOrCron = !auth.user || userRole === 'admin' || userRole === 'administrador'

    const {
      supervisor_id: rawSupervisorId,
      supervisor_name,
      supervisor_email,
      store_name,
      store_id,
      previous_store_name,
      previous_store_date,
      latitude,
      longitude,
      auto_create_trip = false,
      source = 'gps_auto'
    } = body

    const supervisor_id = !isAdminOrCron && auth.user?.id ? String(auth.user.id) : rawSupervisorId

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
    // Only accept client-provided previous_store_name if it strictly belongs to today's business date
    let originName = ''
    if (previous_store_name && (!previous_store_date || previous_store_date === targetDate)) {
      originName = normalizeStoreName(previous_store_name)
    }

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

    // If still no origin, look up last inspection destination TODAY (strictly within current business date)
    if (!originName || originName === currentStore) {
      const prevDay = new Date(new Date(targetDate).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      let lastInspQuery = supabase
        .from('supervisor_inspections')
        .select('store_id, inspection_date, created_at')
        .gte('created_at', `${prevDay}T00:00:00.000Z`)
        .order('created_at', { ascending: false })
        .limit(10)

      if (supervisor_name) {
        lastInspQuery = lastInspQuery.ilike('supervisor_name', `%${supervisor_name}%`)
      }

      const { data: lastInsps } = await lastInspQuery
      if (lastInsps && lastInsps.length > 0) {
        // Filter strictly for today's business date
        const todayInsps = lastInsps.filter(insp => {
          const bDate = getCaliforniaBusinessDate(insp.created_at || insp.inspection_date)
          return bDate === targetDate
        })

        if (todayInsps.length > 0) {
          // Fetch stores mapping
          const { data: allStores } = await supabase.from('stores').select('id, name')
          const storeMap: Record<string, string> = {}
          allStores?.forEach(s => {
            storeMap[String(s.id)] = normalizeStoreName(s.name)
          })

          for (const insp of todayInsps) {
            const inspStoreName = storeMap[String(insp.store_id)]
            if (inspStoreName && inspStoreName !== currentStore) {
              originName = inspStoreName
              break
            }
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
    const pairNames = Array.from(new Set([originName, currentStore].filter(Boolean)))
    const { data: distances } = await supabase
      .from('store_distances')
      .select('origin_name, destination_name, distance_miles')
      .in('origin_name', pairNames)
      .in('destination_name', pairNames)
      .limit(5)
    const matchedDist = (distances || []).find(
      (d: any) =>
        (d.origin_name === originName && d.destination_name === currentStore) ||
        (d.origin_name === currentStore && d.destination_name === originName)
    )

    let distanceMiles = matchedDist?.distance_miles ? Number(matchedDist.distance_miles) : 0

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

    // 4. Check for duplicate trip by THIS supervisor in the last 60 minutes (LA traffic window)
    const sixtyMinsAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    let dupQuery = supabase
      .from('supervisor_mileage_trips')
      .select('id, origin_name, destination_name, created_at')
      .eq('trip_date', targetDate)
      .eq('origin_name', originName)
      .eq('destination_name', currentStore)
      .gte('created_at', sixtyMinsAgo)

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
      let finalSupervisorId = supervisor_id ? String(supervisor_id) : ''
      if (!finalSupervisorId && supervisor_email) {
        const { data: byEmail } = await supabase
          .from('users')
          .select('id')
          .ilike('email', String(supervisor_email).trim())
          .limit(1)
        if (byEmail?.[0]?.id) finalSupervisorId = String(byEmail[0].id)
      }
      if (!finalSupervisorId && supervisor_name) {
        const { data: byName } = await supabase
          .from('users')
          .select('id')
          .ilike('full_name', `%${String(supervisor_name).trim()}%`)
          .limit(1)
        if (byName?.[0]?.id) finalSupervisorId = String(byName[0].id)
      }

      if (!finalSupervisorId) {
        finalSupervisorId = '0'
      }

      const newTrip = {
        supervisor_id: finalSupervisorId,
        supervisor_name: supervisor_name || 'Supervisor',
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
