/**
 * @module api/miles/sync-inspections
 * @description Sincroniza automáticamente los viajes de un supervisor a partir de sus inspecciones de calidad realizadas en el día de negocio.
 * @businessRules
 * - Lee las inspecciones registradas en supervisor_inspections para la fecha de negocio en California (regla 6:00 AM).
 * - Conecta cronológicamente las tiendas visitadas [Tienda A → Tienda B → Tienda C], soportando re-visitas a una misma tienda en horarios distintos.
 * - Soporta ejecución inmediata en tiempo real tras guardar una inspección individual (target_store_id).
 * - Consulta la distancia estándar en store_distances o calcula con coordenadas canónicas y factor 1.33x de tráfico.
 * - Tarifa oficial de reembolso IRS: $0.760/mi.
 * @dataFlow
 * - Consulta: stores, supervisor_inspections, store_distances, supervisor_mileage_trips, supervisor_mileage_settings
 * - Inserta: supervisor_mileage_trips
 * @notes
 * - La lógica de duplicados evalúa la ventana temporal del viaje para permitir viajes de ida y vuelta o re-visitas legítimas sin descartarlos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { CANONICAL_STORE_COORDINATES, haversineDistanceMiles, normalizeStoreName } from '@/lib/store-coordinates'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const supabase = await getSupabaseAdminClient()

    const targetDate = body.date || getCaliforniaBusinessDate()
    const supervisorId = body.supervisor_id
    const supervisorName = body.supervisor_name
    const targetStoreId = body.target_store_id

    // 1. Get current official rate per mile
    const { data: settings } = await supabase
      .from('supervisor_mileage_settings')
      .select('current_rate_per_mile')
      .limit(1)
    const ratePerMile = Number(settings?.[0]?.current_rate_per_mile) || 0.76

    // 2. Fetch stores map
    const { data: stores } = await supabase.from('stores').select('id, name')
    const storeMap: Record<string, string> = {}
    stores?.forEach(s => {
      storeMap[String(s.id)] = normalizeStoreName(s.name)
    })

    // 3. Fetch standard distance matrix
    const { data: distancesData } = await supabase.from('store_distances').select('*')
    const distanceLookup: Record<string, number> = {}
    distancesData?.forEach(d => {
      distanceLookup[`${d.origin_name}-${d.destination_name}`] = Number(d.distance_miles)
      distanceLookup[`${d.destination_name}-${d.origin_name}`] = Number(d.distance_miles)
    })

    const getDistance = (origin: string, dest: string): number => {
      const key1 = `${origin}-${dest}`
      const key2 = `${dest}-${origin}`
      let dist = distanceLookup[key1] || distanceLookup[key2]
      if (!dist || dist <= 0) {
        const oLoc = CANONICAL_STORE_COORDINATES[origin]
        const dLoc = CANONICAL_STORE_COORDINATES[dest]
        if (oLoc && dLoc) {
          dist = parseFloat((haversineDistanceMiles(oLoc.lat, oLoc.lng, dLoc.lat, dLoc.lng) * 1.33).toFixed(2))
        } else {
          dist = 4.5
        }
      }
      return dist
    }

    // --- CASE A: SINGLE REAL-TIME INSPECTION AUTO-SYNC (Called on inspection submit) ---
    if (targetStoreId) {
      const destinationName = storeMap[String(targetStoreId)] || `Tienda #${targetStoreId}`
      
      // Look up supervisor's most recent trip destination or previous inspection destination
      let previousStoreName = ''

      // Check last trip today
      let lastTripQuery = supabase
        .from('supervisor_mileage_trips')
        .select('destination_name, created_at')
        .eq('trip_date', targetDate)
        .order('created_at', { ascending: false })
        .limit(1)

      if (supervisorId) {
        lastTripQuery = lastTripQuery.eq('supervisor_id', supervisorId)
      } else if (supervisorName) {
        lastTripQuery = lastTripQuery.ilike('supervisor_name', `%${supervisorName}%`)
      }

      const { data: lastTrips } = await lastTripQuery
      if (lastTrips && lastTrips.length > 0 && lastTrips[0].destination_name) {
        const prev = normalizeStoreName(lastTrips[0].destination_name)
        if (prev !== destinationName) {
          previousStoreName = prev
        }
      }

      // If no prior trip, check previous inspection today
      if (!previousStoreName) {
        let prevInspQuery = supabase
          .from('supervisor_inspections')
          .select('store_id, created_at')
          .order('created_at', { ascending: false })
          .limit(2)

        if (supervisorName) {
          prevInspQuery = prevInspQuery.ilike('supervisor_name', `%${supervisorName}%`)
        }

        const { data: prevInsps } = await prevInspQuery
        if (prevInsps) {
          for (const insp of prevInsps) {
            const name = storeMap[String(insp.store_id)]
            if (name && name !== destinationName) {
              previousStoreName = name
              break
            }
          }
        }
      }

      // If we found an origin different from destination, log the trip
      if (previousStoreName && previousStoreName !== destinationName) {
        // Check if created within last 20 mins for this supervisor
        const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString()
        let dupQuery = supabase
          .from('supervisor_mileage_trips')
          .select('id')
          .eq('trip_date', targetDate)
          .eq('origin_name', previousStoreName)
          .eq('destination_name', destinationName)
          .gte('created_at', twentyMinsAgo)

        if (supervisorId) {
          dupQuery = dupQuery.eq('supervisor_id', supervisorId)
        } else if (supervisorName) {
          dupQuery = dupQuery.ilike('supervisor_name', `%${supervisorName}%`)
        }

        const { data: dup } = await dupQuery.limit(1)

        if (!dup || dup.length === 0) {
          const dist = getDistance(previousStoreName, destinationName)
          const nowLa = new Date()
          const startTime = nowLa.toLocaleTimeString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })
          const mileageVal = parseFloat((dist * ratePerMile).toFixed(2))

          let resolvedSupId = supervisorId
          if (!resolvedSupId && supervisorName) {
            const { data: matchedUser } = await supabase
              .from('users')
              .select('id')
              .ilike('full_name', `%${supervisorName}%`)
              .limit(1)
            if (matchedUser && matchedUser[0]?.id) {
              resolvedSupId = String(matchedUser[0].id)
            }
          }

          const { data: createdTrip, error: tripErr } = await supabase
            .from('supervisor_mileage_trips')
            .insert([{
              supervisor_id: resolvedSupId || supervisorName || 'Supervisor',
              supervisor_name: supervisorName || 'Supervisor',
              supervisor_email: body.supervisor_email || 'supervisor@tacosgavilan.com',
              trip_date: targetDate,
              start_time: startTime,
              origin_type: 'store',
              origin_name: previousStoreName,
              destination_type: 'store',
              destination_name: destinationName,
              is_round_trip: false,
              purpose: 'Business',
              purpose_notes: `Auto-generado al completar Inspección de Calidad en ${destinationName}`,
              distance_miles: dist,
              rate_per_mile: ratePerMile,
              parking_amount: 0,
              tolls_amount: 0,
              status: 'pending'
            }])
            .select()
            .single()

          if (!tripErr && createdTrip) {
            return NextResponse.json({
              success: true,
              created: 1,
              trip: createdTrip,
              message: `Recorrido auto-guardado: ${previousStoreName} → ${destinationName} (${dist} mi • $${mileageVal} USD)`
            })
          }
        }
      }

      return NextResponse.json({
        success: true,
        created: 0,
        message: `Inspección procesada en ${destinationName}.`
      })
    }

    // --- CASE B: BULK DAY RECONCILIATION ---
    // Filter inspections starting from previous day to capture full 6:00 AM business day
    const prevDay = new Date(new Date(targetDate).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    let inspQuery = supabase
      .from('supervisor_inspections')
      .select('*')
      .gte('created_at', `${prevDay}T00:00:00.000Z`)
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
        message: `Se encontraron ${dayInspections.length} inspecciones en la fecha ${targetDate}. Se necesitan al menos 2 paradas para trazar una ruta entre tiendas.`
      })
    }

    // Fetch existing trips for this date
    let tripsQuery = supabase
      .from('supervisor_mileage_trips')
      .select('*')
      .eq('trip_date', targetDate)

    const { data: existingTrips } = await tripsQuery

    // Group inspections strictly by supervisor so we never cross-contaminate routes between different people
    const inspectionsBySupervisor: Record<string, typeof dayInspections> = {}
    dayInspections.forEach(insp => {
      const sName = (insp.supervisor_name || '').trim()
      
      // Regla de Negocio: Ricardo Velazquez y Estefani Duran inician el 1 de Septiembre 2026
      if (targetDate < '2026-09-01' && /estefani|ricardo/i.test(sName)) {
        return
      }

      if (supervisorName && !sName.toLowerCase().includes(supervisorName.toLowerCase())) {
        return
      }

      const supKey = sName || 'Supervisor'
      if (!inspectionsBySupervisor[supKey]) {
        inspectionsBySupervisor[supKey] = []
      }
      inspectionsBySupervisor[supKey].push(insp)
    })

    const tripsToInsert: any[] = []

    // Build consecutive pairs [A -> B], [B -> C] for EACH supervisor INDEPENDENTLY
    for (const [supKey, supInspections] of Object.entries(inspectionsBySupervisor)) {
      if (supInspections.length < 2) continue

      // Sort this supervisor's inspections chronologically
      const sortedInsps = [...supInspections].sort((a, b) => {
        const timeA = new Date(a.created_at || a.inspection_date).getTime()
        const timeB = new Date(b.created_at || b.inspection_date).getTime()
        return timeA - timeB
      })

      // Get existing trips for this supervisor
      const supExistingTrips = (existingTrips || []).filter(t => 
        (t.supervisor_name || '').toLowerCase().includes(supKey.toLowerCase()) ||
        (t.supervisor_id && sortedInsps[0]?.supervisor_id && t.supervisor_id === sortedInsps[0]?.supervisor_id)
      )

      for (let i = 0; i < sortedInsps.length - 1; i++) {
        const current = sortedInsps[i]
        const next = sortedInsps[i + 1]

        const originName = storeMap[String(current.store_id)] || current.store_name || `Tienda #${current.store_id}`
        const destName = storeMap[String(next.store_id)] || next.store_name || `Tienda #${next.store_id}`

        if (originName === destName) continue

        // Check if this supervisor already logged this trip on this date
        const alreadyExists = supExistingTrips.some(t => {
          const normOrigin = (t.origin_name || '').toLowerCase()
          const normDest = (t.destination_name || '').toLowerCase()
          const checkOrigin = originName.toLowerCase()
          const checkDest = destName.toLowerCase()
          return (normOrigin.includes(checkOrigin) || checkOrigin.includes(normOrigin)) &&
                 (normDest.includes(checkDest) || checkDest.includes(normDest))
        })

        if (alreadyExists) continue

        const distance = getDistance(originName, destName)

        const startTime = new Date(current.created_at || current.inspection_date).toLocaleTimeString('en-US', {
          timeZone: 'America/Los_Angeles',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })

        tripsToInsert.push({
          supervisor_id: current.inspector_id || current.supervisor_id || supKey,
          supervisor_name: supKey,
          supervisor_email: current.supervisor_email || 'supervisor@tacosgavilan.com',
          trip_date: targetDate,
          start_time: startTime,
          origin_type: 'store',
          origin_name: originName,
          destination_type: 'store',
          destination_name: destName,
          is_round_trip: false,
          purpose: 'Business',
          purpose_notes: `Generado automáticamente desde Inspección de Calidad (${originName.replace('Tacos Gavilan ', '')} → ${destName.replace('Tacos Gavilan ', '')})`,
          distance_miles: distance,
          rate_per_mile: ratePerMile,
          parking_amount: 0,
          tolls_amount: 0,
          status: 'pending'
        })
      }
    }

    if (tripsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        message: 'Todas las rutas de las inspecciones de los supervisores activos ya se encuentran registradas en DriveLog.'
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
