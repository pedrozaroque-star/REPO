/**
 * @module api/cron/sync-delivery-reconciliation
 * @description Cron Job automatizado diario para sincronizar la conciliación de plataformas Delivery
 *              (Toast POS + Grubhub Merchant API + Uber Eats Merchant Headless API) en las 15 sucursales
 *              de Tacos Gavilan sin requerir pestañas de Chrome abiertas.
 *
 * @businessRules
 * - Ejecución diaria escalonada en 3 lotes en `vercel.json` (`5 15 * * *`, `15 15 * * *`, `25 15 * * *` UTC = 7:05/7:15/7:25 AM PST)
 *   procesando 5 sucursales por corrida (~2.5 min < 300s `maxDuration` de Vercel) para evitar timeouts serverless.
 * - Sincroniza una ventana móvil de los últimos 7 días operativos (6:00 AM a 5:59 AM PT) más los cortes
 *   semanales recientes para mantener al día los depósitos bancarios y las pólizas de QuickBooks (`JournalEntry`).
 * - Opera de forma Server-to-Server (S2S) + sesiones cifradas con AES-256-GCM en Supabase (`integrations`):
 *   1. Toast POS: OAuth2 Client Credentials (`TOAST_CLIENT_ID` / `TOAST_CLIENT_SECRET`).
 *   2. Grubhub: Token Bearer S2S + autorrenovación automática `POST /auth/refresh` vía `refresh_token` cifrado en `integrations.grubhub_merchant`.
 *   3. Uber Eats: Sesión cifrada S2S en `integrations.ubereats_merchant` (`getNetSalesByOrder` + `getHistoricOrders`).
 *   4. DoorDash: Sesión cifrada S2S en `integrations.doordash_merchant` (`payout_summaries` y `transactions`).
 *
 * @dataFlow
 * Vercel Cron (`?batch=1..3&batches=3`) -> GET `/api/cron/sync-delivery-reconciliation` -> `reconcileAndPersistDeliveryData` -> Supabase
 *
 * @notes
 * - Soporta filtro opcional `?storeId=14`, `?batch=1&batches=3` o `?days=7` para corridas manuales o focalizadas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeDeliveryReconciliationRequest } from '@/lib/auth-server'
import { reconcileAndPersistDeliveryData } from '@/lib/delivery-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function formatIsoDatePT(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const storeIdParam = searchParams.get('storeId')
    const batchParam = Number(searchParams.get('batch') || 0)
    const totalBatchesParam = Math.min(Math.max(Number(searchParams.get('batches') || 3), 1), 15)
    const daysParam = Math.min(Math.max(Number(searchParams.get('days') || 7), 1), 14)

    const requestedStoreId =
      storeIdParam && Number.isFinite(Number(storeIdParam)) && Number(storeIdParam) > 0
        ? Number(storeIdParam)
        : null

    const auth = await authorizeDeliveryReconciliationRequest(request, supabaseAdmin, {
      permission: 'sync',
      allowCron: true,
      targetStoreIds: requestedStoreId ? [requestedStoreId] : [],
      requireAllStores: !requestedStoreId,
    })
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error || 'No autorizado para ejecutar cron de conciliación delivery', code: auth.code },
        { status: auth.status || 401 }
      )
    }

    const now = new Date()
    const endDate = formatIsoDatePT(now)
    const startObj = new Date(now.getTime() - daysParam * 86400000)
    const startDate = formatIsoDatePT(startObj)

    let storeIds: number[] = []
    let activeBatchInfo: { batch: number; totalBatches: number } | null = null
    if (requestedStoreId) {
      storeIds = [requestedStoreId]
    } else {
      const { data: stores } = await supabaseAdmin
        .from('stores')
        .select('id')
        .order('id', { ascending: true })
      const allStoreIds = (stores || []).map((s: any) => Number(s.id)).filter((id: number) => id > 0)
      if (Number.isFinite(batchParam) && batchParam >= 1 && batchParam <= totalBatchesParam) {
        const chunkSize = Math.max(1, Math.ceil(allStoreIds.length / totalBatchesParam))
        const startIdx = (batchParam - 1) * chunkSize
        storeIds = allStoreIds.slice(startIdx, startIdx + chunkSize)
        activeBatchInfo = { batch: batchParam, totalBatches: totalBatchesParam }
      } else {
        storeIds = allStoreIds
      }
    }

    const summary = await reconcileAndPersistDeliveryData({
      storeIds,
      startDate,
      endDate,
      syncToast: true,
      syncGrubhubLive: true,
      syncChromePlatforms: true,
    })

    return NextResponse.json({
      success: true,
      hasWarnings: (summary.syncErrors?.length || 0) > 0,
      window: {
        startDate,
        endDate,
        storeCount: storeIds.length,
        storeIds,
        ...(activeBatchInfo ? activeBatchInfo : {}),
      },
      summary,
    })
  } catch (error: any) {
    console.error('[CRON sync-delivery-reconciliation] Error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Error en cron de conciliación delivery' },
      { status: 500 }
    )
  }
}
