/**
 * @module api/miles/[id]/route
 * @description API route to edit, update status (approve, reject, mark paid), or delete a specific trip in MilesIQ.
 * @businessRules
 * - Only pending or draft trips can be deleted or fully edited by supervisors.
 * - Admins can approve, reject, or mark trips as paid.
 * @dataFlow Client request -> Supabase ('supervisor_mileage_trips') -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (is_round_trip !== undefined) updateData.is_round_trip = is_round_trip
    if (purpose !== undefined) updateData.purpose = purpose
    if (purpose_notes !== undefined) updateData.purpose_notes = purpose_notes
    if (odometer_start !== undefined) updateData.odometer_start = odometer_start
    if (odometer_end !== undefined) updateData.odometer_end = odometer_end
    if (distance_miles !== undefined) updateData.distance_miles = distance_miles
    if (rate_per_mile !== undefined) updateData.rate_per_mile = rate_per_mile
    if (parking_amount !== undefined) updateData.parking_amount = parking_amount
    if (tolls_amount !== undefined) updateData.tolls_amount = tolls_amount
    if (supervisor_id !== undefined) updateData.supervisor_id = supervisor_id
    if (supervisor_name !== undefined) updateData.supervisor_name = supervisor_name
    if (supervisor_email !== undefined) updateData.supervisor_email = supervisor_email

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
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID de viaje requerido' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()

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
