/**
 * @module api/ronos/punches
 * @description Endpoint de consulta para auditoría laboral, ponchadas y cumplimiento de Cingular HR (RONOS).
 *
 * @businessRules
 *   - Permite consultar la auditoría individual de una sucursal o el consolidado global de las 15 tiendas + Bodega.
 *   - Devuelve métricas calculadas de Meal Penalties, horas extras, puntualidad y fotografías de reloj checador.
 *
 * @dataFlow
 *   Frontend /admin/ronos -> GET /api/ronos/punches?companyId=34&weekId=155969 -> ronos-api -> JSON response.
 *
 * @notes
 *   - Si no se especifica companyId, retorna por defecto la auditoría de TEG - Lynwood (ID: 34) o el consolidado de cadena si mode=chain.
 */

import { NextResponse } from 'next/server'
import { getRonosStoreAudit, getRonosChainWideAudit, getRonosWeeks, RONOS_STORES_MAP } from '@/lib/ronos-api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') || 'store' // 'store' | 'chain' | 'weeks' | 'stores'
    const companyIdParam = searchParams.get('companyId')
    const weekIdParam = searchParams.get('weekId')

    const ronosCompanyId = companyIdParam ? parseInt(companyIdParam, 10) : 34 // Default: Lynwood
    const weekId = weekIdParam ? parseInt(weekIdParam, 10) : undefined

    // 1. Listado de tiendas disponibles
    if (mode === 'stores') {
      return NextResponse.json({
        success: true,
        stores: RONOS_STORES_MAP
      })
    }

    // 2. Listado de semanas para una tienda
    if (mode === 'weeks') {
      const weeks = await getRonosWeeks(ronosCompanyId)
      return NextResponse.json({
        success: true,
        weeks
      })
    }

    // 3. Consolidado general de toda la cadena (15 tiendas + Bodega)
    if (mode === 'chain') {
      const chainAudit = await getRonosChainWideAudit()
      return NextResponse.json({
        success: true,
        data: chainAudit
      })
    }

    // 4. Auditoría detallada de una tienda (por defecto)
    const storeAudit = await getRonosStoreAudit(ronosCompanyId, weekId)
    const availableWeeks = await getRonosWeeks(ronosCompanyId)

    return NextResponse.json({
      success: true,
      data: storeAudit,
      weeks: availableWeeks,
      stores: RONOS_STORES_MAP
    })
  } catch (error: any) {
    console.error('Error en /api/ronos/punches:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al consultar datos de RONOS'
      },
      { status: 500 }
    )
  }
}
