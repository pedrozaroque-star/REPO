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
import { getRonosStoreAudit, getRonosChainWideAudit } from '@/lib/ronos-api'
import { syncSimplifyHrRates, syncAllStoresSimplifyHrRates } from '@/lib/simplifyhr-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutos — necesario para extracción masiva de 16 tiendas / ~580 empleados

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    const body = await request.json().catch(() => ({}))
    const { companyId = 34, weekId, syncChain = false, syncSimplify = true } = body

    // 1. Sincronización de Simplify HR (Salarios Reales de Cingular)
    let simplifyResult: any = null
    if (syncSimplify) {
      try {
        if (syncChain) {
          // Chain-wide: Extraer TODAS las 16 tiendas con login corporativo de Raquel
          console.log('🔄 Sincronización masiva de Simplify HR — 16 tiendas...')
          simplifyResult = await syncAllStoresSimplifyHrRates()
          console.log(`✅ Simplify HR chain sync completo: ${simplifyResult.totalSynced} empleados de ${simplifyResult.totalStores} tiendas`)
        } else {
          // Individual: Solo la tienda seleccionada
          simplifyResult = await syncSimplifyHrRates(companyId)
        }
      } catch (sErr: any) {
        console.warn('Advertencia en sincronización de Simplify HR:', sErr?.message)
        simplifyResult = { success: false, error: sErr?.message }
      }
    }

    // 2. Sincronización de RONOS (Tarjetas de tiempo, horas y ponchadas)
    if (syncChain) {
      const chainAudit = await getRonosChainWideAudit(weekId, undefined, true)
      const durationMs = Date.now() - startTime
      return NextResponse.json({
        success: true,
        type: 'chain',
        durationMs,
        data: chainAudit,
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
      })
    }

    const storeAudit = await getRonosStoreAudit(companyId, weekId)
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
    })
  } catch (error: any) {
    console.error('Error en /api/ronos/sync:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error al sincronizar datos de RONOS y Simplify HR'
      },
      { status: 500 }
    )
  }
}
