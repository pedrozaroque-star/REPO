/**
 * @module api/ronos/sync
 * @description Endpoint de sincronización forzada bajo demanda para actualizar datos de RONOS
 *   y extraer salarios reales de Simplify HR OS con las credenciales corporativas de Raquel.
 *
 * @businessRules
 *   - Permite forzar la re-sincronización y auditoría inmediata de una sucursal o de toda la cadena.
 *   - Refresca el token de autenticación y re-calcula las métricas de penalizaciones laborales.
 *   - Cuando `syncChain = true`, sincroniza TODAS las 16 tiendas de Simplify HR.
 *   - Cuando se sincroniza una tienda individual, extrae los salarios de solo esa tienda.
 *   - Las tarifas reales de Simplify HR se persisten en `toast_employees.wage_data` para su uso
 *     en el motor de nómina Cingular (`payroll-calculator.ts`).
 *
 * @dataFlow
 *   Frontend (Botón "Sincronizar RONOS Ahora") -> POST /api/ronos/sync -> ronos-api + simplifyhr-api -> Supabase.
 *
 * @notes
 *   - Login corporativo: raquel@tacosgavilan.com (rol shr_hrproxy con acceso a las 16 sucursales).
 *   - maxDuration 300s para permitir la extracción masiva de ~580 empleados cuando syncChain=true.
 *   - La cascada de tarifas en payroll-calculator.ts es:
 *     1. CINGULAR_RATE_OVERRIDES (calibrado vs invoice)
 *     2. Simplify HR (in-memory cache)
 *     3. Toast wage_data (Simplify HR persistido)
 *     4. Defaults ($16.90 crew / $39.90 GM)
 */

import { NextResponse } from 'next/server'
import { getRonosStoreAudit, getRonosChainWideAudit, RonosWeekNotFoundError } from '@/lib/ronos-api'
import { syncSimplifyHrRates, syncAllStoresSimplifyHrRates } from '@/lib/simplifyhr-api'
import { verifyAdminAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutos — necesario para extracción masiva de 16 tiendas / ~580 empleados

export async function GET(request: Request) {
  const auth = verifyAdminAuth(request)
  if (!auth.authorized) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status || 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  if (searchParams.get('format')?.toLowerCase() === 'csv') {
    return NextResponse.json(
      { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
      { status: 400 }
    )
  }

  const action = searchParams.get('action')
  if (action === 'health') {
    // Diagnóstico real de solo lectura
    let supabaseStatus: 'online' | 'warning' | 'offline' = 'offline'
    let ronosStatus: 'online' | 'warning' | 'offline' = 'offline'
    let simplifyStatus: 'online' | 'warning' | 'offline' = 'offline'

    // 1. Supabase / Base de datos
    try {
      const { data, error } = await supabaseAdmin.from('stores').select('id').limit(1)
      supabaseStatus = (!error && data && data.length > 0) ? 'online' : 'warning'
    } catch {
      supabaseStatus = 'offline'
    }

    // 2. RONOS Cache / Datos
    try {
      const { data, error } = await supabaseAdmin.from('ronos_work_weeks').select('week_id').limit(1)
      ronosStatus = (!error && data && data.length > 0) ? 'online' : 'warning'
    } catch {
      ronosStatus = 'offline'
    }

    // 3. Simplify HR OS
    try {
      const { data, error } = await supabaseAdmin.from('simplify_employee_rates').select('id').limit(1)
      simplifyStatus = (!error && data && data.length > 0) ? 'online' : 'warning'
    } catch {
      simplifyStatus = 'offline'
    }

    return NextResponse.json({
      success: true,
      health: {
        supabaseDb: supabaseStatus,
        ronosApi: ronosStatus,
        simplifyHr: simplifyStatus,
        testedAt: new Date().toISOString()
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, max-age=0'
      }
    })
  }

  return NextResponse.json({
    success: true,
    message: 'RONOS Sync Endpoint Ready'
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, max-age=0'
    }
  })
}

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    const auth = verifyAdminAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    if (searchParams.get('format')?.toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))

    if (body.format && String(body.format).toLowerCase() === 'csv') {
      return NextResponse.json(
        { success: false, error: 'El formato CSV no está permitido por razones de seguridad.' },
        { status: 400 }
      )
    }

    // Validación estricta de companyId (regex /^\d+$/)
    const rawCompanyId = body.ronosCompanyId ?? body.companyId
    if (rawCompanyId !== undefined && rawCompanyId !== null && !/^\d+$/.test(String(rawCompanyId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro companyId inválido: debe ser numérico' },
        { status: 400 }
      )
    }

    // Validación estricta de weekId (regex /^\d+$/)
    if (body.weekId !== undefined && body.weekId !== null && !/^\d+$/.test(String(body.weekId))) {
      return NextResponse.json(
        { success: false, error: 'Parámetro weekId inválido: debe ser numérico' },
        { status: 400 }
      )
    }

    // Validación de mode si está presente
    if (body.mode !== undefined && body.mode !== null && !['store', 'chain'].includes(String(body.mode))) {
      return NextResponse.json(
        { success: false, error: 'Modo inválido: debe ser store o chain' },
        { status: 400 }
      )
    }

    const companyId = rawCompanyId !== undefined ? parseInt(String(rawCompanyId), 10) : 34
    const weekId = body.weekId !== undefined ? parseInt(String(body.weekId), 10) : undefined
    const syncChain = Boolean(body.syncChain || body.mode === 'chain' || companyId === 0)
    const syncSimplify = body.syncSimplify !== false

    // 1. Iniciar sincronización de Simplify HR (Salarios Reales de Cingular) en paralelo
    let simplifyPromise: Promise<any> = Promise.resolve(null)
    if (syncSimplify) {
      if (syncChain) {
        simplifyPromise = syncAllStoresSimplifyHrRates().catch((sErr: any) => {
          console.warn('Advertencia en sincronización masiva de Simplify HR:', sErr?.message)
          return { success: false, error: sErr?.message }
        })
      } else {
        simplifyPromise = syncSimplifyHrRates(companyId).catch((sErr: any) => {
          console.warn(`Advertencia en sincronización de Simplify HR (tienda ${companyId}):`, sErr?.message)
          return { success: false, error: sErr?.message }
        })
      }
    }

    const antiCacheHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }

    // 2. Ejecutar auditoría de RONOS y Simplify HR de forma concurrente
    if (syncChain) {
      const [chainAudit, simplifyResult] = await Promise.all([
        getRonosChainWideAudit(weekId, undefined, true),
        simplifyPromise
      ])

      const durationMs = Date.now() - startTime
      const failedStores = chainAudit?.failedStores || []
      const failedStoresCount = chainAudit?.failedStoresCount ?? failedStores.length
      const totalStores = chainAudit?.totalStores || 0
      const isPartial = failedStoresCount > 0

      return NextResponse.json({
        success: true,
        type: 'chain',
        status: failedStoresCount > 0 && totalStores === 0 ? 'failed' : (isPartial ? 'partial' : 'success'),
        isPartial,
        durationMs,
        data: chainAudit,
        failedStores,
        failedStoresCount,
        simplifyHr: simplifyResult ? {
          success: simplifyResult.success,
          totalSynced: simplifyResult.totalSynced,
          totalStores: simplifyResult.totalStores,
          storeResults: simplifyResult.storeResults?.map((s: any) => ({
            storeName: s.storeName,
            employeeCount: s.employeeCount,
            success: s.success,
            error: s.error
          }))
        } : null
      }, { headers: antiCacheHeaders })
    }

    const [storeAudit, simplifyResult] = await Promise.all([
      getRonosStoreAudit(companyId, weekId, true),
      simplifyPromise
    ])

    const durationMs = Date.now() - startTime

    return NextResponse.json({
      success: true,
      type: 'store',
      durationMs,
      data: storeAudit,
      simplifyHr: simplifyResult ? {
        success: simplifyResult.success,
        syncedCount: simplifyResult.syncedCount,
        siteId: simplifyResult.siteId
      } : null
    }, { headers: antiCacheHeaders })
  } catch (error: any) {
    console.error('Error en /api/ronos/sync:', error)
    const isNotFound = error instanceof RonosWeekNotFoundError || error?.statusCode === 400 || error?.name === 'RonosWeekNotFoundError' || /no encontrada|inexistente|not found/i.test(error?.message || '')
    const status = isNotFound ? 400 : 500
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al sincronizar datos de RONOS y Simplify HR'
      },
      { status, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } }
    )
  }
}
