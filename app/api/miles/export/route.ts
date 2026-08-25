/**
 * @module api/miles/export/route
 * @description API endpoint to generate CSV report downloads of supervisor mileage logs (MilesIQ).
 * @businessRules
 * - Exports formatted CSV with columns matching MileIQ standards.
 * - Supports filtering by supervisor_id, date range, and status.
 * @dataFlow Client GET request -> Supabase ('supervisor_mileage_trips') -> CSV Stream response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getCaliforniaDate } from '@/lib/business-date'

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

    const { data: trips } = await query

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
