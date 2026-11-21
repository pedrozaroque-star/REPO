/**
 * @module api/miles/export/route
 * @description API endpoint to generate CSV report downloads of supervisor mileage logs (MilesIQ).
 * @businessRules
 * - Exports formatted CSV with columns matching MileIQ standards.
 * - Supports filtering by supervisor_id, date range, and status.
 * @dataFlow Client GET request -> Supabase ('supervisor_mileage_trips') -> CSV Stream response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaDate } from '@/lib/business-date'

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

    const { data: rawTrips } = await query
    let trips = rawTrips || []
    if (!isAdminOrCron && auth.user) {
      const uid = String(auth.user.id || '').trim()
      let uEmail = String(auth.user.email || '').trim().toLowerCase()
      let uName = String(auth.user.user_metadata?.full_name || '').trim().toLowerCase()
      const numericUid = Number(uid)
      if (!uName && Number.isFinite(numericUid) && numericUid > 0) {
        const { data: uRow } = await supabase.from('users').select('full_name, email').eq('id', numericUid).maybeSingle()
        if (uRow?.full_name) uName = String(uRow.full_name).trim().toLowerCase()
        if (!uEmail && uRow?.email) uEmail = String(uRow.email).trim().toLowerCase()
      }
      trips = trips.filter((t: any) => {
        const sId = String(t.supervisor_id || '').trim()
        const sEmail = String(t.supervisor_email || '').trim().toLowerCase()
        const sName = String(t.supervisor_name || '').trim().toLowerCase()
        return (uid && sId === uid) || (uEmail && sEmail === uEmail) || (uName && (sName === uName || sId.toLowerCase() === uName))
      })
    }

    const rows = (trips || []).map(t => {
      const miles = Number(t.distance_miles) || 0
      const rate = Number(t.rate_per_mile) || 0.76
      const val = t.mileage_value !== undefined && t.mileage_value !== null ? Number(t.mileage_value) : miles * rate
      const parking = Number(t.parking_amount) || 0
      const tolls = Number(t.tolls_amount) || 0
      const total = t.total_reimbursement !== undefined && t.total_reimbursement !== null ? Number(t.total_reimbursement) : val + parking + tolls

      return [
        `"${t.trip_date || ''}"`,
        `"${t.start_time || ''}"`,
        `"${(t.supervisor_name || '').replace(/"/g, '""')}"`,
        `"${(t.purpose || 'Business').replace(/"/g, '""')}"`,
        `"${(t.origin_name || '').replace(/"/g, '""')}"`,
        `"${(t.destination_name || '').replace(/"/g, '""')}"`,
        t.is_round_trip ? '"Sí"' : '"No"',
        miles.toFixed(2),
        rate.toFixed(3),
        val.toFixed(2),
        parking.toFixed(2),
        tolls.toFixed(2),
        total.toFixed(2),
        `"${t.status || 'pending'}"`,
        `"${(t.purpose_notes || '').replace(/"/g, '""')}"`
      ].join(',')
    })

    const header = [
      'Fecha',
      'Hora',
      'Supervisor',
      'Motivo',
      'Origen',
      'Destino',
      'Ida y Vuelta',
      'Millas',
      'Tarifa ($/mi)',
      'Valor Millas ($)',
      'Parking ($)',
      'Tolls ($)',
      'Total ($)',
      'Estado',
      'Notas'
    ].join(',')

    const csvContent = '\uFEFF' + [header, ...rows].join('\n')

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="MilesIQ_Reporte_Millas_${getCaliforniaDate()}.csv"`
      }
    })
  } catch (err: any) {
    console.error('Error in GET /api/miles/export:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
