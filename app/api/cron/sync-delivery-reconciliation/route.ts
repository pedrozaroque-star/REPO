/**
 * @module api/cron/sync-delivery-reconciliation
 * @description Cron Job automatizado diario para sincronizar la conciliación de plataformas Delivery
 *              (Toast POS + Grubhub Merchant API + Uber Eats Merchant Headless API) en las 15 sucursales
 *              de Tacos Gavilan sin requerir pestañas de Chrome abiertas.
 *
 * @businessRules
 * - Ejecución diaria programada en `vercel.json` (`15 15 * * *` UTC = ~8:15 AM PT).
 * - Sincroniza una ventana móvil de los últimos 7 días operativos (6:00 AM a 5:59 AM PT) más los cortes
 *   semanales recientes para mantener al día los depósitos bancarios y las pólizas de QuickBooks (`JournalEntry`).
 * - Opera 100% Headless (Server-to-Server):
 *   1. Toast POS: OAuth2 Client Credentials (`TOAST_CLIENT_ID` / `TOAST_CLIENT_SECRET`).
 *   2. Grubhub: Autenticación directa vía `api-merchant-gtm.grubhub.com`.
 *   3. Uber Eats: Sesión persistida en Supabase (`integrations.service_name = 'ubereats_merchant'`).
 *   4. DoorDash: Si se ejecuta en entorno local con Chrome activo, abre una pestaña silenciosa en background y la cierra;
 *      en la nube utiliza las transacciones previamente sincronizadas o importadas.
 *
 * @dataFlow
 * Vercel Cron -> GET `/api/cron/sync-delivery-reconciliation` -> `reconcileAndPersistDeliveryData` -> Supabase
 *
 * @notes
 * - Soporta filtro opcional `?storeId=14` o `?days=7` para corridas manuales o focalizadas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
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
    const daysParam = Math.min(Math.max(Number(searchParams.get('days') || 5), 1), 14)

    const now = new Date()
    const endDate = formatIsoDatePT(now)
    const startObj = new Date(now.getTime() - daysParam * 86400000)
    const startDate = formatIsoDatePT(startObj)

    let storeIds: number[] = []
    if (storeIdParam && Number.isFinite(Number(storeIdParam))) {
      storeIds = [Number(storeIdParam)]
    } else {
      const { data: stores } = await supabaseAdmin
        .from('stores')
        .select('id')
        .order('id', { ascending: true })
      storeIds = (stores || []).map((s: any) => Number(s.id)).filter((id: number) => id > 0)
    }

    const summary = await reconcileAndPersistDeliveryData({
      storeIds,
      startDate,
      endDate,
      syncToast: true,
      syncGrubhubLive: true,
    })

    return NextResponse.json({
      success: true,
      window: { startDate, endDate, storeCount: storeIds.length },
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
