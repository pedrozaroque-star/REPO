/**
 * @module api/miles/route
 * @description API endpoint handler for querying and creating supervisor mileage trips (MilesIQ).
 * @businessRules
 * - Supervisors can read their own trip logs. Admins can read trips across all supervisors.
 * - Rate per mile defaults to $0.760/mi (IRS standard rate observed in supervisor reports).
 * - Total reimbursement is calculated as (distance_miles * rate_per_mile) + parking_amount + tolls_amount.
 * @dataFlow
 * - Client request -> Supabase ('supervisor_mileage_trips') -> Response JSON.
 * @notes Implements fallback memory/cached responses if database tables are being initialized.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth, type DecodedToken } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaTime } from '@/lib/business-date'

async function resolveSupervisorIdentity(supabase: any, user?: DecodedToken) {
  if (!user) return { uid: '', email: '', name: '' }
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
  return { uid, email, name }
}

function tripBelongsToSupervisor(t: any, ident: { uid: string; email: string; name: string }): boolean {
  const supId = String(t?.supervisor_id || '').trim()
  const supEmail = String(t?.supervisor_email || '').trim().toLowerCase()
  const supName = String(t?.supervisor_name || '').trim().toLowerCase()
  if (ident.uid && supId === ident.uid) return true
  if (ident.email && supEmail === ident.email) return true
  if (ident.name && (supName === ident.name || supId.toLowerCase() === ident.name)) return true
  return false
}

export async function GET(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) return auth.response!

  try {
    const supabase = await getSupabaseAdminClient()
    const { searchParams } = new URL(req.url)

    const supervisorId = searchParams.get('supervisor_id')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const status = searchParams.get('status')

    const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
    const isAdminOrCron = !auth.user || userRole === 'admin' || userRole === 'administrador'

    let query = supabase
      .from('supervisor_mileage_trips')
      .select('*')
      .order('trip_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (isAdminOrCron && supervisorId) {
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

    let scopedTrips = trips || []
    if (!isAdminOrCron) {
      const ident = await resolveSupervisorIdentity(supabase, auth.user)
      scopedTrips = scopedTrips.filter((t: any) => tripBelongsToSupervisor(t, ident))
    }

    return NextResponse.json({ success: true, trips: scopedTrips })
  } catch (err: any) {
    console.error('Error in GET /api/miles:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) return auth.response!

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
      rate_per_mile = 0.76,
      parking_amount = 0,
      tolls_amount = 0
    } = body

    const supabase = await getSupabaseAdminClient()
    const userRole = String(auth.user?.role || auth.user?.user_role || '').toLowerCase()
    const isAdminOrCron = !auth.user || userRole === 'admin' || userRole === 'administrador'
    const ident = !isAdminOrCron ? await resolveSupervisorIdentity(supabase, auth.user) : null

    const effectiveSupervisorId = !isAdminOrCron ? ident!.uid : supervisor_id
    if (!effectiveSupervisorId || !origin_name || !destination_name || distance_miles === undefined) {
      return NextResponse.json(
        { error: 'Campos requeridos faltantes: supervisor_id, origin_name, destination_name, distance_miles' },
        { status: 400 }
      )
    }

    const baseMiles = Number(distance_miles)
    if (!Number.isFinite(baseMiles) || baseMiles < 0) {
      return NextResponse.json({ error: 'distance_miles inválido' }, { status: 400 })
    }

    let rate = Number(rate_per_mile) || 0.76
    if (!isAdminOrCron) {
      const { data: settings } = await supabase
        .from('supervisor_mileage_settings')
        .select('current_rate_per_mile')
        .limit(1)
      rate = Number(settings?.[0]?.current_rate_per_mile) || 0.76
    }

    const effectiveMiles = is_round_trip ? baseMiles * 2 : baseMiles
    const parking = Math.max(0, Number(parking_amount) || 0)
    const tolls = Math.max(0, Number(tolls_amount) || 0)

    const { data: inserted, error } = await supabase
      .from('supervisor_mileage_trips')
      .insert({
        supervisor_id: effectiveSupervisorId,
        supervisor_name: supervisor_name || 'Supervisor',
        supervisor_email: supervisor_email || 'supervisor@tacosgavilan.com',
        trip_date: trip_date || getCaliforniaBusinessDate(),
        start_time: (start_time && start_time.trim() !== '') ? start_time.trim() : getCaliforniaTime(),
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
