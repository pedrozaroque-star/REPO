/**
 * @module api/cron/sync-labor
 * @description Daily Vercel cron handler that synchronizes employee data, job classifications, and punches from Toast API to Supabase.
 * 
 * @businessRules
 * - **Ventana de Lookback (Last 3 Days)**: Sincroniza únicamente los últimos 3 días para todas las sucursales activas (`is_active = true`). Esto previene que se agote el tiempo de ejecución (timeout) de Vercel y cubre ajustes de horarios tardíos.
 * - **Doble Horario con Protección DST (`0 15 * * *` y `50 18,19 * * *`)**: Garantiza sincronización matutina (7:00 AM PST / 8:00 AM PDT) y pre-auditoría exactamente a las **11:50 AM hora California** tanto en invierno (PST, `19:50 UTC`) como en verano (PDT, `18:50 UTC`), omitiendo la ranura gemela inactiva (`10:50 AM PST` / `12:50 PM PDT`) para que las ponchadas de Toast POS estén 100% frescas antes de los crons de las 11:59 AM PT (`sync-violations` y `sync-ronos-violations`).
 * 
 * @dataFlow
 * - Invocación del endpoint -> Lee las tiendas activas con Toast GUID (`external_id`) -> Ejecuta en cadena `syncToastEmployees`, `syncToastJobs` y `syncToastPunches` -> Actualiza metadatos de empleados, puestos y punches en Supabase.
 * 
 * @notes
 * - La duración máxima de la función está configurada a 300 segundos (`maxDuration = 300`), que es el límite de Vercel Pro.
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor`.
 */
import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { syncToastPunches, syncToastEmployees, syncToastJobs } from '@/lib/toast-labor'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic' // No caching
export const maxDuration = 300 // 5 minutes max (Vercel Pro)

function getLaMinutesOfDay(refDate = new Date()): { hour: number; minute: number; totalMinutes: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(refDate)
    const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
    const hour = rawHour === 24 ? 0 : rawHour
    return { hour, minute, totalMinutes: hour * 60 + minute }
}

export async function GET(request: Request) {
    const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const url = new URL(request.url)
    const forceRun = url.searchParams.get('force') === 'true'
    const { hour: laHour, minute: laMinute, totalMinutes: laTotal } = getLaMinutesOfDay()

    // Omitir únicamente las ranuras gemelas inactivas de `50 18,19 * * *`:
    // - Invierno (PST): `18:50 UTC` cae a las 10:50 AM PST (10:45 AM – 11:44 AM con jitter)
    // - Verano (PDT):   `19:50 UTC` cae a las 12:50 PM PDT (12:48 PM – 1:45 PM con jitter)
    const isInactiveWinterMiddaySlot = laTotal >= 10 * 60 + 45 && laTotal <= 11 * 60 + 44
    const isInactiveSummerMiddaySlot = laTotal >= 12 * 60 + 48 && laTotal <= 13 * 60 + 45
    if (!forceRun && (isInactiveWinterMiddaySlot || isInactiveSummerMiddaySlot)) {
        return NextResponse.json({
            success: true,
            skipped: true,
            la_hour: laHour,
            la_minute: laMinute,
            reason: 'Inactive DST twin slot for 11:50 AM America/Los_Angeles pre-audit sync',
        })
    }

    console.log('[CRON] Starting Labor Sync...')
    const supabase = await getSupabaseClient()

    // 1. Get Active Stores
    const { data: stores, error } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .not('external_id', 'is', null) // Only active stores with Toast GUID

    if (error || !stores) {
        return NextResponse.json({ error: 'Failed to fetch stores' }, { status: 500 })
    }

    console.log(`[CRON] Found ${stores.length} stores to sync.`)

    // 2. Determine Date Range (Last 3 days to cover edits/delays) - UTC Optimized
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 3) // 3 Days lookback instead of 14 to prevent Vercel 5min timeout

    // Format ISO for Toast (YYYY-MM-DDThh:mm:ss.000+0000)
    const startIso = start.toISOString().split('T')[0] + 'T00:00:00.000+0000'
    const endIso = end.toISOString().split('T')[0] + 'T23:59:59.999+0000'

    const results = []

    interface Store {
        name: string
        external_id: string
    }

    // 3. Sync Each Store
    // Explicit cast to avoid implicit any errors
    const storesList = (stores || []) as Store[]

    for (const store of storesList) {
        if (!store.external_id) continue
        console.log(`[CRON] Syncing Labor for ${store.name}...`)

        try {
            // A. Sync Employees & Jobs (Metadata)
            const empRes = await syncToastEmployees(store.external_id)
            const jobRes = await syncToastJobs(store.external_id)

            // B. Sync Punches (Time Entries)
            const punchRes = await syncToastPunches(store.external_id, startIso, endIso)

            results.push({
                store: store.name,
                employees: empRes.count,
                jobs: jobRes.count,
                punches: punchRes.count,
                success: true
            })
        } catch (e: any) {
            console.error(`[CRON] Error syncing ${store.name}:`, e)
            results.push({
                store: store.name,
                error: e.message,
                success: false
            })
        }
    }

    console.log('[CRON] Labor Sync Complete.')
    return NextResponse.json({
        message: 'Labor Sync Executed',
        range: { start: startIso, end: endIso },
        results
    })
}
