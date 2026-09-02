/**
 * @module api/cron/sync-simplify-rates
 * @description Cron Job que sincroniza las tarifas salariales de Simplify HR OS para las 16 tiendas
 *   de Tacos Gavilan. Se ejecuta diariamente a las 6:00 AM PT (inicio del día laboral) para
 *   garantizar que el Motor de Nómina TEG tenga tarifas reales actualizadas de cada empleado.
 *
 * @businessRules
 *   - Las tarifas se extraen directamente de la API de Simplify HR (prod.simplifyhros.com).
 *   - Se persisten en Supabase (toast_employees.wage_data) como caché offline resiliente.
 *   - Si Simplify HR está caído, el motor usa las tarifas previamente cacheadas sin fallar.
 *   - Cubre las 16 locaciones y ~350 empleados activos.
 *
 * @dataFlow
 *   Vercel Cron (6:00 AM PT diario) → sync-simplify-rates → Simplify HR API → Supabase cache → Motor TEG
 *
 * @notes
 *   - Protegido con CRON_SECRET para prevenir ejecuciones no autorizadas.
 *   - Concurrencia limitada a 4 tiendas simultáneas para no saturar el gateway de Simplify HR.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  // Verificar autenticación del cron job
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { syncAllStoresSimplifyHrRates } = await import('@/lib/simplifyhr-api')

    console.log('[Cron sync-simplify-rates] 📡 Iniciando sincronización de tarifas de las 16 tiendas...')
    const startTime = Date.now()

    const result = await syncAllStoresSimplifyHrRates()

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    const summary = {
      success: result.success,
      totalSynced: result.totalSynced,
      totalStores: result.totalStores,
      elapsedSeconds: Number(elapsed),
      storeResults: result.storeResults.map(sr => ({
        store: sr.storeName,
        employees: sr.employeeCount,
        success: sr.success,
        ...(sr.error ? { error: sr.error } : {})
      }))
    }

    console.log(`[Cron sync-simplify-rates] ✅ Sincronización completada en ${elapsed}s — ${result.totalSynced} empleados de ${result.totalStores} tiendas`)

    return NextResponse.json(summary)
  } catch (error: any) {
    console.error('[Cron sync-simplify-rates] ❌ Error:', error?.message)
    return NextResponse.json(
      { error: error?.message || 'Error desconocido', success: false },
      { status: 500 }
    )
  }
}
