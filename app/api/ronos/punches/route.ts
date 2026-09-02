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
    const modeParam = searchParams.get('mode')
    const isChain = modeParam === 'chain' || searchParams.get('chain') === 'true'
    const mode = isChain ? 'chain' : (modeParam || 'store') // 'store' | 'chain' | 'weeks' | 'stores'
    const companyIdParam = searchParams.get('companyId')
    const weekIdParam = searchParams.get('weekId')

    const ronosCompanyId = companyIdParam ? parseInt(companyIdParam, 10) : 34 // Default: Lynwood
    const weekId = weekIdParam ? parseInt(weekIdParam, 10) : undefined

    const startDateParam = searchParams.get('startDate') || undefined
    const forceLive = searchParams.get('force') === 'true' || searchParams.get('live') === 'true'

    const antiCacheHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }

    // 1. Listado de tiendas disponibles
    if (mode === 'stores') {
      return NextResponse.json({
        success: true,
        stores: RONOS_STORES_MAP
      }, { headers: antiCacheHeaders })
    }

    // 2. Listado de semanas para una tienda
    if (mode === 'weeks') {
      const weeks = await getRonosWeeks(ronosCompanyId, forceLive)
      return NextResponse.json({
        success: true,
        weeks
      }, { headers: antiCacheHeaders })
    }

    // 3. Consolidado general de toda la cadena (15 tiendas + Bodega)
    if (mode === 'chain') {
      const chainAudit = await getRonosChainWideAudit(weekId, startDateParam, forceLive)
      return NextResponse.json({
        success: true,
        data: chainAudit
      }, { headers: antiCacheHeaders })
    }

    // 4. Auditoría detallada de una tienda (por defecto)
    const storeAudit = await getRonosStoreAudit(ronosCompanyId, weekId, forceLive)
    const availableWeeks = await getRonosWeeks(ronosCompanyId, forceLive)

    return NextResponse.json({
      success: true,
      data: storeAudit,
      weeks: availableWeeks,
      stores: RONOS_STORES_MAP
    }, { headers: antiCacheHeaders })
  } catch (error: any) {
    console.error('Error en /api/ronos/punches:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al consultar datos de RONOS'
      },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } }
    )
  }
}
