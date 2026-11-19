/**
 * @module api/cron/sync-external-accounting
 * @description Cron job automático para Contabilidad Externa (`/admin/contabilidad-externa`):
 * 1. Renueva preventivamente los tokens OAuth 2.0 de Intuit QuickBooks Online en las 6 empresas `ACTIVE_QBO`
 *    usando el candado distribuido en PostgreSQL (`fn_ext_acct_acquire_qbo_refresh_lock`), evitando expiración por inactividad.
 * 2. Procesa atómicamente la cola de salida (`external_accounting_sync_outbox`) mediante `FOR UPDATE SKIP LOCKED`
 *    (`fn_ext_acct_claim_pending_qbo_outbox`), reintentando operaciones `PENDING` o `FAILED` con backoff exponencial.
 *
 * @businessRules
 * - Exige `CRON_SECRET` válido en el header `Authorization: Bearer <CRON_SECRET>` (Fail-Closed).
 * - Respeta estrictamente `qbo_sync_enabled === false` en las empresas retiradas (`Chicken Taco Catering LLC`, `Elveze LLC`).
 * - Registra ejecución en `external_accounting_audit_log` únicamente cuando procesa entradas del Outbox o detecta un fallo OAuth.
 * - Ahorro nocturno (`America/Los_Angeles`): Omite ejecuciones de cron entre `10:00 PM` y `6:59 AM LA`, excepto un barrido de seguridad a las `2:00 AM LA` (`laHour === 2 && laMinute < 30`). Disparo manual (`?force=1` o `x-manual-trigger: 1`) siempre permitido.
 *
 * @dataFlow
 * - Vercel Cron (every 30 min) -> GET `/api/cron/sync-external-accounting` -> `getExternalCompanyQboAuth` + `processPendingQboOutbox`.
 *
 * @notes
 * - 2026-11-12 (Wave P0): Creado para garantizar drenado automático del Outbox y rotación segura de tokens OAuth 24/7.
 * - 2026-11-19 (Paquete 2A): Frecuencia reducida a cada 30 min en `vercel.json` y throttle nocturno `10:00 PM–6:59 AM LA` con barrido único a las `2:00 AM LA` y soporte `?force=1`.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getExternalCompanyQboAuth, processPendingQboOutbox } from '@/lib/external-accounting-qbo-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function getLATimeParts(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const rawHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const hour = rawHour === 24 ? 0 : rawHour
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  return { hour, minute }
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim()
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const forceRun =
      searchParams.get('force') === '1' ||
      searchParams.get('force') === 'true' ||
      searchParams.get('manual') === '1' ||
      request.headers.get('x-manual-trigger') === '1'

    if (!forceRun) {
      const { hour: laHour, minute: laMinute } = getLATimeParts()
      const isOvernight = laHour >= 22 || laHour < 7
      const isTwoAmSweep = laHour === 2 && laMinute < 30
      if (isOvernight && !isTwoAmSweep) {
        console.log(
          `⏳ [CRON sync-external-accounting] Omitido en ventana nocturna (10:00 PM - 6:59 AM LA, excepto 2:00 AM). Hora LA: ${laHour}:${String(laMinute).padStart(2, '0')}`
        )
        return NextResponse.json({
          ok: true,
          skipped: true,
          message: 'Skipped: Overnight throttle (10:00 PM - 6:59 AM LA; 2:00 AM sweep active)',
          timestamp: new Date().toISOString(),
        })
      }
    }

    const supabase = await getSupabaseAdminClient()

    const { data: companies, error: compErr } = await supabase
      .from('external_accounting_companies')
      .select('realm_id, company_name, metadata')
      .order('company_name', { ascending: true })

    if (compErr) {
      throw new Error(`Failed loading external_accounting_companies: ${compErr.message}`)
    }

    const tokenHealth: Array<{
      realmId: string
      companyName: string
      syncEnabled: boolean
      connected: boolean
      error?: string | null
    }> = []

    for (const comp of companies || []) {
      const syncEnabled = comp.metadata?.qbo_sync_enabled !== false
      if (!syncEnabled) {
        tokenHealth.push({
          realmId: comp.realm_id,
          companyName: comp.company_name,
          syncEnabled: false,
          connected: false,
          error: null,
        })
        continue
      }
      const authStatus = await getExternalCompanyQboAuth(supabase, comp.realm_id)
      tokenHealth.push({
        realmId: comp.realm_id,
        companyName: comp.company_name,
        syncEnabled: true,
        connected: authStatus.connected,
        error: authStatus.lastSyncError || null,
      })
    }

    const outboxResult = await processPendingQboOutbox(supabase, { limit: 50 })

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      activeCompaniesChecked: tokenHealth.filter(t => t.syncEnabled).length,
      connectedCompanies: tokenHealth.filter(t => t.connected).length,
      tokenHealth,
      outbox: {
        processedCount: outboxResult.processedCount,
        syncedCount: outboxResult.syncedCount,
        failedCount: outboxResult.failedCount,
        skippedCount: outboxResult.skippedCount,
      },
    })
  } catch (error: any) {
    console.error('[CRON sync-external-accounting] Error:', error?.message || error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal cron error' },
      { status: 500 }
    )
  }
}
