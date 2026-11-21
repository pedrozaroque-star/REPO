/**
 * @module preparador-manual-schedule
 * @description API endpoint que gestiona las metas manuales recurrentes de libras de carne por bloque de 30 minutos y día de la semana.
 * @businessRules
 *   - Las capturas manuales de los gerentes se repiten semanalmente para ese día específico (1=Lunes ... 7=Domingo).
 *   - Las modificaciones se guardan directamente en prep_manual_schedule y tienen precedencia en modo Manual.
 * @dataFlow prep_manual_schedule table <-> UI Tablet Preparador.
 * @notes Admite inserción individual o por lote (batch).
 *   - Optimización 2026-11-19 (Paquete 2B): `GET` responde `Cache-Control: private, max-age=60, stale-while-revalidate=120`
 *     para polling normal en segundo plano; si viene parámetro `_t` (bypass explícito tras guardado del gerente o despertar tableta),
 *     responde `Cache-Control: no-store` para frescura inmediata (Caveat C).
 *   - Blindaje Fail-Closed (`verifyStaffAuth` + `authorizeStoreScope`): exige sesión de personal en `GET`, y rol de liderazgo con alcance de sucursal en `POST`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const PREP_WRITE_ROLES = [
    'admin',
    'supervisor',
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
]

export async function GET(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request)
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const searchParams = request.nextUrl.searchParams
        const rawStoreId = searchParams.get('storeId')
        const dow = searchParams.get('dow') // 1 (Monday) to 7 (Sunday)
        const hasCacheBust = searchParams.has('_t')

        if (!rawStoreId || !dow) {
            return NextResponse.json({ error: 'Missing storeId or dow' }, { status: 400 })
        }

        const numericStoreId = parseInt(rawStoreId, 10)
        const supabase = await getSupabaseAdminClient()
        const { data, error } = await supabase
            .from('prep_manual_schedule')
            .select('interval_start, meat_type, max_lbs')
            .eq('store_id', isNaN(numericStoreId) ? rawStoreId : numericStoreId)
            .eq('day_of_week', parseInt(dow, 10))

        if (error) {
            console.error('GET prep_manual_schedule error:', error.message)
            return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
        }

        const cacheControl = hasCacheBust
            ? 'no-store'
            : 'private, max-age=60, stale-while-revalidate=120'

        return NextResponse.json(data || [], {
            headers: { 'Cache-Control': cacheControl }
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: PREP_WRITE_ROLES })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const body = await request.json()
        const { storeId, dow, intervalStart, meatType, maxLbs, applyToAllDay, items } = body

        if (!storeId || !dow) {
            return NextResponse.json({ error: 'Missing required fields (storeId, dow)' }, { status: 400 })
        }

        const numericStoreId = parseInt(String(storeId), 10)
        const targetStoreId = isNaN(numericStoreId) ? storeId : numericStoreId
        const numericDow = parseInt(String(dow), 10)
        const supabase = await getSupabaseAdminClient()

        if (auth.user) {
            const rawServerUser = await getServerUser(request)
            let effectiveRole = (rawServerUser?.role || auth.user.role || auth.user.user_role || '').toLowerCase()
            let effectiveStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id
            let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope

            if (!effectiveStoreId && auth.user.email && !['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
                const { data: userProfile } = await supabase
                    .from('users')
                    .select('role, store_id, store_scope')
                    .ilike('email', auth.user.email)
                    .maybeSingle()
                if (userProfile) {
                    if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase()
                    if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveStoreId = userProfile.store_id
                    if (userProfile.store_scope) effectiveScope = userProfile.store_scope
                }
            }

            const serverUser = {
                id: rawServerUser?.id || auth.user.id,
                email: rawServerUser?.email || auth.user.email,
                name: rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email,
                role: effectiveRole === 'administrador' ? 'admin' : effectiveRole,
                store_id: effectiveStoreId,
                store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
                store_scope: effectiveScope,
            }

            const scopeCheck = await authorizeStoreScope(serverUser, targetStoreId, supabase, {
                requireWrite: true,
                allowedRoles: PREP_WRITE_ROLES,
            })
            if (!scopeCheck.authorized) {
                return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
            }
        }

        // Batch bulk items provided
        if (Array.isArray(items) && items.length > 0) {
            const rows = items.map(item => ({
                store_id: targetStoreId,
                day_of_week: numericDow,
                interval_start: item.intervalStart,
                meat_type: String(item.meatType).toUpperCase(),
                max_lbs: Number(item.maxLbs),
                updated_at: new Date().toISOString()
            }))

            const { data, error } = await supabase
                .from('prep_manual_schedule')
                .upsert(rows, { onConflict: 'store_id,day_of_week,interval_start,meat_type' })
                .select()

            if (error) {
                console.error('prep_manual_schedule batch upsert error:', error.message)
                return NextResponse.json({ error: error.message }, { status: 500 })
            }

            return NextResponse.json({ success: true, count: data?.length || 0 })
        }

        // Apply to all 48 30-minute intervals of the day if applyToAllDay flag is true
        if (applyToAllDay && meatType && maxLbs !== undefined) {
            const rows = []
            for (let h = 0; h < 24; h++) {
                for (let m of [0, 30]) {
                    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
                    rows.push({
                        store_id: targetStoreId,
                        day_of_week: numericDow,
                        interval_start: timeStr,
                        meat_type: String(meatType).toUpperCase(),
                        max_lbs: Number(maxLbs),
                        updated_at: new Date().toISOString()
                    })
                }
            }

            const { data, error } = await supabase
                .from('prep_manual_schedule')
                .upsert(rows, { onConflict: 'store_id,day_of_week,interval_start,meat_type' })
                .select()

            if (error) {
                console.error('prep_manual_schedule applyToAllDay error:', error.message)
                return NextResponse.json({ error: error.message }, { status: 500 })
            }

            return NextResponse.json({ success: true, count: data?.length || 0 })
        }

        // Single interval upsert
        if (!intervalStart || !meatType || maxLbs === undefined) {
            return NextResponse.json({ error: 'Missing intervalStart, meatType or maxLbs' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('prep_manual_schedule')
            .upsert({
                store_id: targetStoreId,
                day_of_week: numericDow,
                interval_start: intervalStart,
                meat_type: String(meatType).toUpperCase(),
                max_lbs: Number(maxLbs),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'store_id,day_of_week,interval_start,meat_type'
            })
            .select()

        if (error) {
            console.error('prep_manual_schedule upsert error:', error.message)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
