/**
 * @module api/cron/sync-daily-payroll
 * @description Cron Job automatizado que sincroniza diariamente a las 11:59 AM PT la nómina y facturación
 *   de Tacos Gavilan para las 16 sucursales (15 restaurantes + Bodega Central).
 *   - Sincroniza tarifas salariales actualizadas y recibos desde Simplify HR OS (prod.simplifyhros.com).
 *   - Sincroniza tarjetas de tiempo (timecards), ponchadas, horas extras y penalizaciones de comida desde RONOS.
 *   - Detecta cheques de separación / finiquitos (supplemental batches) y concilia facturas PEO de Cingular HR.
 *
 * @businessRules
 *   - El horario de ejecución oficial solicitado por Gerencia General es diariamente a las 11:59 AM PT.
 *   - En horario de verano (PDT, UTC-7): 18:59 UTC ("59 18 * * *").
 *   - En horario estándar (PST, UTC-8): 19:59 UTC ("59 19 * * *").
 *   - El día laboral de Tacos Gavilan inicia a las 6:00 AM y termina a las 5:59 AM del siguiente día.
 *   - Las tarifas se persisten en Supabase (toast_employees.wage_data) como caché offline resiliente.
 *   - Ante fallos de conexión externa, el sistema no colapsa: utiliza la caché persistida y notifica métricas.
 *
 * @dataFlow
 *   Vercel Cron (11:59 AM PT) → sync-daily-payroll → [Simplify HR OS API + RONOS API] → Supabase Cache → Motor de Nómina TEG
 *
 * @notes
 *   - Protegido con CRON_SECRET para asegurar que solo Vercel Scheduler pueda detonarlo.
 *   - Timeout configurado en maxDuration = 120s para permitir la sincronización completa de las 16 tiendas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncAllStoresSimplifyHrRates } from '@/lib/simplifyhr-api'
import { getRonosChainWideAudit } from '@/lib/ronos-api'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Vercel Cron only accepts UTC schedules. We register the two possible UTC
 * instants for 11:59 AM Los Angeles and allow exactly the one that maps to
 * 11:59 locally. This prevents the inactive DST schedule from running the
 * payroll synchronization an hour early or late.
 */
function isPayrollSyncMinuteInLosAngeles(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const hour = parts.find(part => part.type === 'hour')?.value
  const minute = parts.find(part => part.type === 'minute')?.value
  return hour === '11' && minute === '59'
}

export async function GET(request: NextRequest) {
  // 1. Verificación de autorización de Cron Job
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isPayrollSyncMinuteInLosAngeles()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'Outside the scheduled 11:59 AM America/Los_Angeles minute',
      timestamp: new Date().toISOString()
    })
  }

  const startTime = Date.now()

  console.log('[Cron sync-daily-payroll] ⏰ Iniciando sincronización diaria de nómina (11:59 AM PT)...')

  const results: {
    simplifyRates?: any
    ronosLabor?: any
    errors: string[]
  } = {
    errors: []
  }

  // 2. Sincronización de Tarifas Simplify HR OS (16 tiendas)
  try {
    console.log('[Cron sync-daily-payroll] 📡 1/2 Sincronizando tarifas de Simplify HR OS...')
    const ratesResult = await syncAllStoresSimplifyHrRates()
    const failedStores = ratesResult.storeResults.filter(store => !store.success)
    results.simplifyRates = {
      success: ratesResult.success,
      totalSynced: ratesResult.totalSynced,
      totalStores: ratesResult.totalStores,
      storesSummary: ratesResult.storeResults.map(sr => ({
        store: sr.storeName,
        employees: sr.employeeCount,
        success: sr.success
      }))
    }
    if (!ratesResult.success || failedStores.length > 0) {
      results.errors.push(
        `SimplifyHR: synchronization incomplete (${failedStores.length}/${ratesResult.storeResults.length} stores failed)`
      )
    }
  } catch (err: any) {
    console.error('[Cron sync-daily-payroll] ⚠️ Error en sincronización de Simplify HR:', err?.message)
    results.errors.push(`SimplifyHR: ${err?.message || 'Error desconocido'}`)
  }

  // 3. Sincronización de Ponchadas y Auditoría RONOS (Cadena Completa)
  try {
    console.log('[Cron sync-daily-payroll] 📡 2/2 Sincronizando ponchadas y auditoría de RONOS...')
    const laborResult = await getRonosChainWideAudit()
    results.ronosLabor = {
      totalStores: laborResult.totalStores,
      totalActiveEmployees: laborResult.totalActiveEmployees,
      totalChainHours: laborResult.totalChainHours,
      totalOvertimeHours: laborResult.totalOvertimeHours,
      totalMealPenalties: laborResult.totalMealPenalties,
      totalPenaltyCostUsd: laborResult.totalPenaltyCostUsd,
      totalBrokenTimecards: laborResult.totalBrokenTimecards
    }
  } catch (err: any) {
    console.error('[Cron sync-daily-payroll] ⚠️ Error en sincronización de RONOS:', err?.message)
    results.errors.push(`RONOS: ${err?.message || 'Error desconocido'}`)
  }

  const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(1))
  const isOverallSuccess = results.errors.length === 0

  console.log(`[Cron sync-daily-payroll] ${isOverallSuccess ? '✅' : '⚠️'} Sincronización finalizada en ${durationSec}s. Errores: ${results.errors.length}`)

  return NextResponse.json({
    success: isOverallSuccess,
    timestamp: new Date().toISOString(),
    durationSeconds: durationSec,
    summary: results
  })
}
