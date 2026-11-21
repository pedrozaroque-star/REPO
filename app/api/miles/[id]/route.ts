/**
 * @module api/miles/[id]/route
 * @description API route to edit, update status (approve, reject, mark paid), or delete a specific trip in MilesIQ.
 * @businessRules
 * - Only pending or draft trips can be deleted or fully edited by supervisors.
 * - Admins can approve, reject, or mark trips as paid.
 * @dataFlow Client request -> Supabase ('supervisor_mileage_trips') -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth, type DecodedToken } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

async function verifyTripOwnership(supabase: any, trip: any, user?: DecodedToken): Promise<boolean> {
  if (!user) return false
  const uid = String(user.id || '').trim()
  let email = String(user.email || '').trim().toLowerCase()
  let name = String(user.user_metadata?.full_name || '').trim().toLowerCase()

  const numericUid = Number(uid)
  if (!name && Number.isFinite(numericUid) && numericUid > 0) {
    const { data: uRow } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', numericUid)
      .maybeSingle()
    if (uRow) {
      if (uRow.full_name) name = String(uRow.full_name).trim().toLowerCase()
      if (!email && uRow.email) email = String(uRow.email).trim().toLowerCase()
    }
  }

  const supId = String(trip?.supervisor_id || '').trim()
  const supEmail = String(trip?.supervisor_email || '').trim().toLowerCase()
  const supName = String(trip?.supervisor_name || '').trim().toLowerCase()
  if (uid && supId === uid) return true
  if (email && supEmail === email) return true
  if (name && (supName === name || supId.toLowerCase() === name)) return true
  return false
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: false })
  if (!auth.authorized) return auth.response!

  const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
  const isAdmin = userRole === 'admin' || userRole === 'administrador'

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID de viaje requerido' }, { status: 400 })
    }

    const body = await req.json()
    const supabase = await getSupabaseAdminClient()

    const {
      status, trip_date, start_time, end_time, origin_type, origin_store_id,
      origin_name, destination_type, destination_store_id, destination_name,
      is_round_trip, purpose, purpose_notes, odometer_start, odometer_end,
      distance_miles, rate_per_mile, parking_amount, tolls_amount,
      supervisor_id, supervisor_name, supervisor_email
    } = body

    const { data: existingTrip } = await supabase
      .from('supervisor_mileage_trips')
      .select('id, status, supervisor_id, supervisor_name, supervisor_email, is_round_trip')
      .eq('id', id)
      .maybeSingle()

    if (!existingTrip) {
      return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 })
    }

    if (!isAdmin) {
      const ownsTrip = await verifyTripOwnership(supabase, existingTrip, auth.user)
      if (!ownsTrip) {
        return NextResponse.json(
          { error: 'Acceso denegado: No puedes modificar viajes de otro supervisor.' },
          { status: 403 }
        )
      }
      // Non-admin CANNOT mutate paid or submitted_hr trips under ANY payload (including status-only!)
      if (existingTrip.status === 'submitted_hr' || existingTrip.status === 'paid') {
        return NextResponse.json(
          { error: 'No se pueden editar ni reabrir viajes que ya han sido enviados a Recursos Humanos o pagados.' },
          { status: 403 }
        )
      }
      // Non-admin CANNOT set status to paid, submitted_hr, approved, or rejected
      if (status !== undefined && status !== 'pending' && status !== 'draft') {
        return NextResponse.json(
          { error: 'Acceso denegado: Solo un administrador puede aprobar, rechazar o marcar viajes como pagados.' },
          { status: 403 }
        )
      }
    } else {
      // Admin: block full field edits on submitted_hr / paid trips (status-only changes allowed for admin workflows)
      const isStatusOnlyUpdate =
        status !== undefined &&
        Object.keys(body).filter(k => body[k] !== undefined && k !== 'status' && k !== 'id').length === 0
      if (!isStatusOnlyUpdate && (existingTrip.status === 'submitted_hr' || existingTrip.status === 'paid')) {
        return NextResponse.json(
          { error: 'No se pueden editar viajes que ya han sido enviados a Recursos Humanos o pagados.' },
          { status: 403 }
        )
      }
    }

    const updateData: any = { updated_at: new Date().toISOString() }
    
    if (status !== undefined) updateData.status = status
    if (trip_date !== undefined) updateData.trip_date = trip_date
    if (start_time !== undefined) updateData.start_time = start_time
    if (end_time !== undefined) updateData.end_time = end_time
    if (origin_type !== undefined) updateData.origin_type = origin_type
    if (origin_store_id !== undefined) updateData.origin_store_id = origin_store_id
    if (origin_name !== undefined) updateData.origin_name = origin_name
    if (destination_type !== undefined) updateData.destination_type = destination_type
    if (destination_store_id !== undefined) updateData.destination_store_id = destination_store_id
    if (destination_name !== undefined) updateData.destination_name = destination_name
    if (is_round_trip !== undefined) updateData.is_round_trip = Boolean(is_round_trip)
    if (purpose !== undefined) updateData.purpose = purpose
    if (purpose_notes !== undefined) updateData.purpose_notes = purpose_notes
    if (odometer_start !== undefined) updateData.odometer_start = odometer_start
    if (odometer_end !== undefined) updateData.odometer_end = odometer_end

    // Apply round-trip distance doubling preserving existing is_round_trip when omitted
    if (distance_miles !== undefined) {
      const roundTrip = is_round_trip !== undefined ? Boolean(is_round_trip) : Boolean(existingTrip.is_round_trip)
      updateData.distance_miles = roundTrip ? Number(distance_miles) * 2 : Number(distance_miles)
    }

    if (isAdmin && rate_per_mile !== undefined) updateData.rate_per_mile = rate_per_mile
    if (parking_amount !== undefined) updateData.parking_amount = Math.max(0, Number(parking_amount) || 0)
    if (tolls_amount !== undefined) updateData.tolls_amount = Math.max(0, Number(tolls_amount) || 0)
    if (isAdmin && supervisor_id !== undefined) updateData.supervisor_id = supervisor_id
    if (isAdmin && supervisor_name !== undefined) updateData.supervisor_name = supervisor_name
    if (isAdmin && supervisor_email !== undefined) updateData.supervisor_email = supervisor_email

    const { data: updated, error } = await supabase
      .from('supervisor_mileage_trips')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error(`Error updating trip ${id}:`, error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, trip: updated })
  } catch (err: any) {
    console.error('Error in PUT /api/miles/[id]:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: false })
  if (!auth.authorized) return auth.response!

  const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
  const isAdmin = userRole === 'admin' || userRole === 'administrador'

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID de viaje requerido' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()

    // 1. Fetch trip to verify ownership and status
    const { data: existingTrip } = await supabase
      .from('supervisor_mileage_trips')
      .select('id, status, supervisor_id, supervisor_name, supervisor_email')
      .eq('id', id)
      .maybeSingle()

    if (!existingTrip) {
      return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 })
    }

    if (!isAdmin) {
      const ownsTrip = await verifyTripOwnership(supabase, existingTrip, auth.user)
      if (!ownsTrip) {
        return NextResponse.json(
          { error: 'Acceso denegado: No puedes eliminar viajes de otro supervisor.' },
          { status: 403 }
        )
      }
    }

    if (existingTrip.status === 'submitted_hr' || existingTrip.status === 'paid') {
      return NextResponse.json(
        { error: 'No se pueden eliminar viajes que ya han sido enviados a Recursos Humanos o pagados.' },
        { status: 403 }
      )
    }

    const { error } = await supabase
      .from('supervisor_mileage_trips')
      .delete()
      .eq('id', id)

    if (error) {
      console.error(`Error deleting trip ${id}:`, error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Viaje eliminado con éxito' })
  } catch (err: any) {
    console.error('Error in DELETE /api/miles/[id]:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
