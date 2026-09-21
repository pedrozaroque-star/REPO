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
 *   - Si no se especifica companyId o si se envía companyId=0, retorna por defecto la auditoría de toda la cadena con semanas de referencia.
 */

import { NextResponse } from 'next/server'
import { getRonosStoreAudit, getRonosChainWideAudit, getRonosChainWideStoreAudit, getRonosWeeks, getDynamicRonosStores, RonosWeekNotFoundError } from '@/lib/ronos-api'
import { verifyAdminAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const auth = verifyAdminAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(request.url)

    // 1. Bloqueo inmediato de format=csv antes de cualquier procesamiento
    const formatParam = searchParams.get('format')
    if (formatParam && formatParam.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad e integridad.' },
        { status: 400 }
      )
    }

    // 2. Validación estricta de mode
    const modeParam = searchParams.get('mode')
    const validModes = ['store', 'chain', 'weeks', 'stores']
    if (modeParam && !validModes.includes(modeParam)) {
      return NextResponse.json(
        { success: false, error: `Modo inválido: '${modeParam}'. Modos válidos: ${validModes.join(', ')}` },
        { status: 400 }
      )
    }

    // 3. Validación estricta de companyId (debe ser estrictamente numérico)
    const companyIdParam = searchParams.get('companyId')
    if (companyIdParam !== null && !/^\d+$/.test(companyIdParam)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId inválido: debe ser numérico' },
        { status: 400 }
      )
    }

    // 4. Validación estricta de weekId (debe ser estrictamente numérico)
    const weekIdParam = searchParams.get('weekId')
    if (weekIdParam !== null && !/^\d+$/.test(weekIdParam)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro weekId inválido: debe ser numérico' },
        { status: 400 }
      )
    }

    // 5. Validación estricta de startDate (YYYY-MM-DD)
    const startDateParam = searchParams.get('startDate') || undefined
    if (startDateParam && !/^\d{4}-\d{2}-\d{2}$/.test(startDateParam)) {
      return NextResponse.json(
        { success: false, error: 'Parámetro startDate inválido: debe tener formato YYYY-MM-DD' },
        { status: 400 }
      )
    }

    const isChain = modeParam === 'chain' || searchParams.get('chain') === 'true'
    const mode = isChain ? 'chain' : (modeParam || 'store') // 'store' | 'chain' | 'weeks' | 'stores'

    const ronosCompanyId = companyIdParam ? parseInt(companyIdParam, 10) : 34 // Default: Lynwood
    const weekId = weekIdParam ? parseInt(weekIdParam, 10) : undefined

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
        stores: await getDynamicRonosStores()
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

    // 3. Consolidado general de toda la cadena (15 tiendas + Bodega - Resumen corporativo)
    if (mode === 'chain') {
      const chainAudit = await getRonosChainWideAudit(weekId, startDateParam, forceLive)
      const availableWeeks = await getRonosWeeks(34, forceLive)
      return NextResponse.json({
        success: true,
        data: chainAudit,
        weeks: availableWeeks,
        stores: await getDynamicRonosStores()
      }, { headers: antiCacheHeaders })
    }

    // 4. Auditoría de Tienda o Consolidado de Colaboradores si companyId === 0
    let storeAudit: any
    let availableWeeks: any[]

    if (ronosCompanyId === 0) {
      storeAudit = await getRonosChainWideStoreAudit(weekId, startDateParam, forceLive)
      availableWeeks = await getRonosWeeks(34, forceLive)
    } else {
      storeAudit = await getRonosStoreAudit(ronosCompanyId, weekId, forceLive)
      availableWeeks = await getRonosWeeks(ronosCompanyId, forceLive)
    }

    return NextResponse.json({
      success: true,
      data: storeAudit,
      weeks: availableWeeks,
      stores: await getDynamicRonosStores()
    }, { headers: antiCacheHeaders })
  } catch (error: any) {
    console.error('Error en /api/ronos/punches:', error)
    const isNotFound = error instanceof RonosWeekNotFoundError || error?.statusCode === 400 || error?.name === 'RonosWeekNotFoundError' || /no encontrada|inexistente|not found/i.test(error?.message || '')
    const status = isNotFound ? 400 : (error?.statusCode || 500)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al consultar datos de RONOS'
      },
      { status, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } }
    )
  }
}
