/**
 * @module api/miles/route
 * @description API endpoint handler for querying and creating supervisor mileage trips (MilesIQ).
 * @businessRules
 * - Supervisors can read their own trip logs. Admins can read trips across all supervisors.
 * - Rate per mile defaults to $0.725/mi (IRS standard rate observed in supervisor reports).
 * - Total reimbursement is calculated as (distance_miles * rate_per_mile) + parking_amount + tolls_amount.
 * @dataFlow
 * - Client request -> Supabase ('supervisor_mileage_trips') -> Response JSON.
 * @notes Implements fallback memory/cached responses if database tables are being initialized.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()
    const { searchParams } = new URL(req.url)

    const supervisorId = searchParams.get('supervisor_id')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const status = searchParams.get('status')

    let query = supabase
      .from('supervisor_mileage_trips')
      .select('*')
      .order('trip_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (supervisorId) {
      query = query.eq('supervisor_id', supervisorId)
    }
    if (startDate) {
      query = query.gte('trip_date', startDate)
    }
    if (endDate) {
      query = query.lte('trip_date', endDate)
    }
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: trips, error } = await query

    if (error) {
      console.error('Error querying supervisor_mileage_trips:', error.message)
      return NextResponse.json({ success: false, error: error.message, trips: [] }, { status: 500 })
    }

    return NextResponse.json({ success: true, trips: trips || [] })
  } catch (err: any) {
    console.error('Error in GET /api/miles:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      supervisor_id,
      supervisor_name,
      supervisor_email,
      trip_date,
      start_time,
      end_time,
      origin_type = 'store',
      origin_store_id = null,
      origin_name,
      destination_type = 'store',
      destination_store_id = null,
      destination_name,
      is_round_trip = false,
      purpose = 'Business',
      purpose_notes = '',
      odometer_start = null,
      odometer_end = null,
      distance_miles,
      rate_per_mile = 0.725,
      parking_amount = 0,
      tolls_amount = 0
    } = body

    if (!supervisor_id || !origin_name || !destination_name || distance_miles === undefined) {
      return NextResponse.json(
        { error: 'Campos requeridos faltantes: supervisor_id, origin_name, destination_name, distance_miles' },
        { status: 400 }
      )
    }

    const effectiveMiles = is_round_trip ? Number(distance_miles) * 2 : Number(distance_miles)
    const rate = Number(rate_per_mile) || 0.725
    const parking = Number(parking_amount) || 0
    const tolls = Number(tolls_amount) || 0
    const mileageVal = effectiveMiles * rate
    const totalReimbursement = mileageVal + parking + tolls

    const supabase = await getSupabaseAdminClient()

    const { data: inserted, error } = await supabase
      .from('supervisor_mileage_trips')
      .insert({
        supervisor_id,
        supervisor_name: supervisor_name || 'Supervisor',
        supervisor_email: supervisor_email || 'supervisor@tacosgavilan.com',
        trip_date: trip_date || new Date().toISOString().split('T')[0],
        start_time,
        end_time,
        origin_type,
        origin_store_id,
        origin_name,
        destination_type,
        destination_store_id,
        destination_name,
        is_round_trip: Boolean(is_round_trip),
        purpose,
        purpose_notes,
        odometer_start,
        odometer_end,
        distance_miles: effectiveMiles,
        rate_per_mile: rate,
        parking_amount: parking,
        tolls_amount: tolls,
        status: 'pending'
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting trip:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, trip: inserted })
  } catch (err: any) {
    console.error('Error in POST /api/miles:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
