/**
 * @module api/miles/pdf
 * @description Genera y descarga bajo demanda el reporte PDF oficial de recorridos de un supervisor para un periodo determinado.
 * @businessRules
 * - Marca oficial: estrictamente "Tacos Gavilan" (nunca "Tacos El Gavilan").
 * - Tarifa IRS: $0.760/milla.
 * - Formato: Horizontal (Landscape, Letter) con métricas KPI, desglose detallado de viajes y bloque de firmas.
 * - Filtra por supervisor_id o supervisor_name y rango de fechas (start_date, end_date).
 * @dataFlow Parámetros query -> Supabase ('supervisor_mileage_trips') -> generateSupervisorMileagePdf -> Response (application/pdf).
 * @notes Retorna el binario directamente como Uint8Array con cabecera application/pdf para descarga instantánea o previsualización.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { generateSupervisorMileagePdf } from '@/lib/miles-pdf'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const supervisorId = searchParams.get('supervisor_id')
    const supervisorName = searchParams.get('supervisor_name')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Parámetros requeridos: start_date y end_date' },
        { status: 400 }
      )
    }

    const supabase = await getSupabaseAdminClient()

    // 1. Obtener tarifa vigente
    const { data: settings } = await supabase
      .from('supervisor_mileage_settings')
      .select('current_rate_per_mile')
      .limit(1)
    const ratePerMile = Number(settings?.[0]?.current_rate_per_mile) || 0.76

    // 2. Consultar viajes del supervisor en el rango
    let query = supabase
      .from('supervisor_mileage_trips')
      .select('*')
      .gte('trip_date', startDate)
      .lte('trip_date', endDate)

    if (supervisorId) {
      query = query.eq('supervisor_id', supervisorId)
    } else if (supervisorName) {
      query = query.ilike('supervisor_name', `%${supervisorName}%`)
    }

    const { data: trips, error } = await query.order('trip_date', { ascending: true })

    if (error) {
      console.error('Error fetching trips for PDF:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!trips || trips.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron viajes para este supervisor en el período seleccionado.' },
        { status: 404 }
      )
    }

    const targetSupervisorName = trips[0].supervisor_name || supervisorName || 'Supervisor'
    const targetSupervisorEmail = trips[0].supervisor_email || ''

    // 3. Generar PDF
    const { filename, buffer } = generateSupervisorMileagePdf({
      supervisorId: trips[0].supervisor_id,
      supervisorName: targetSupervisorName,
      supervisorEmail: targetSupervisorEmail,
      periodStart: startDate,
      periodEnd: endDate,
      trips,
      ratePerMile
    })

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    })
  } catch (err: any) {
    console.error('Error in GET /api/miles/pdf:', err)
    return NextResponse.json({ error: err.message || 'Error generando PDF' }, { status: 500 })
  }
}
