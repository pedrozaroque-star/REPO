import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'

/**
 * @module ChecklistCompletionsAPI
 * @description Endpoint autenticado del servidor para consultar y marcar/desmarcar actividades del Checklist Operativo (`checklist_completions`).
 * @businessRules
 * - GET requiere sesión activa y alcance sobre la sucursal (`allowEmployeeRead: true`).
 * - POST requiere sesión activa con permisos operativos sobre la sucursal (`admin`, `supervisor`, `manager`, `asistente`).
 * - Registra `completed_by` y `completed_by_name` directamente desde el token JWT verificado en el servidor.
 * @dataFlow
 * - Lee/escribe `public.checklist_completions` usando `supabaseAdmin`.
 * @notes
 * - Creado en la remediación integral de ACTIVIDADES (Fase 0 item 9, 2026-10-19).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json({ error: 'No autenticado. Inicie sesión.' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const store_id = searchParams.get('store_id')
        const checklist_date = searchParams.get('checklist_date') || searchParams.get('date')
        const start_date = searchParams.get('start_date') || checklist_date
        const end_date = searchParams.get('end_date') || checklist_date

        if (!store_id || !start_date || !end_date || !ISO_DATE_RE.test(start_date) || !ISO_DATE_RE.test(end_date) || start_date > end_date) {
            return NextResponse.json({ error: 'Parámetros inválidos (store_id, checklist_date o start_date/end_date)' }, { status: 400 })
        }

        let query = supabaseAdmin
            .from('checklist_completions')
            .select('id, store_id, checklist_date, activity_id, completed_at, completed_by_name, shift_type')
            .gte('checklist_date', start_date)
            .lte('checklist_date', end_date)
            .limit(10000)

        if (store_id.toUpperCase() === 'ALL') {
            const authAll = await authorizeStoreScope(user, 'ALL', supabaseAdmin, {
                allowComparativeAll: true,
                allowEmployeeRead: false,
                requireWrite: false,
            })
            if (!authAll.authorized) {
                return NextResponse.json({ error: authAll.error || 'Acceso denegado a reporte comparativo' }, { status: authAll.status })
            }
        } else {
            const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
                allowEmployeeRead: true,
                requireWrite: false,
            })
            if (!authScope.authorized) {
                return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta sucursal' }, { status: authScope.status })
            }
            const canonicalStoreGuid = authScope.canonicalExternalId || store_id
            query = query.eq('store_id', canonicalStoreGuid)
        }

        const { data, error } = await query

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json(data || [])
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json({ error: 'No autenticado. Inicie sesión.' }, { status: 401 })
        }

        const body = await req.json()
        const { action = 'toggle', store_id, checklist_date, activity_id, shift_type } = body

        if (!store_id || !checklist_date || !ISO_DATE_RE.test(String(checklist_date)) || !activity_id) {
            return NextResponse.json(
                { error: 'Faltan parámetros requeridos (store_id, checklist_date, activity_id)' },
                { status: 400 }
            )
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: false,
            requireWrite: true,
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta sucursal' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || String(store_id)

        const { data: existingRows } = await supabaseAdmin
            .from('checklist_completions')
            .select('id')
            .eq('store_id', canonicalStoreGuid)
            .eq('checklist_date', checklist_date)
            .eq('activity_id', activity_id)

        const isCurrentlyCompleted = Boolean(existingRows && existingRows.length > 0)

        if (action === 'uncomplete' || (action === 'toggle' && isCurrentlyCompleted)) {
            const ids = (existingRows || []).map((r: any) => r.id)
            if (ids.length > 0) {
                const { error: delError } = await supabaseAdmin
                    .from('checklist_completions')
                    .delete()
                    .in('id', ids)
                if (delError) {
                    return NextResponse.json({ error: delError.message }, { status: 500 })
                }
            }
            return NextResponse.json({ success: true, completed: false })
        }

        const normalizedShiftType =
            shift_type && shift_type !== 'Todos'
                ? String(shift_type)
                : 'Regular'

        const { data: upserted, error: upsertError } = await supabaseAdmin
            .from('checklist_completions')
            .upsert(
                {
                    store_id: canonicalStoreGuid,
                    checklist_date,
                    shift_type: normalizedShiftType,
                    activity_id,
                    completed_at: new Date().toISOString(),
                    completed_by: String(user.id || ''),
                    completed_by_name: user.name || user.username || 'Manager',
                },
                { onConflict: 'store_id,checklist_date,shift_type,activity_id' }
            )
            .select('id, activity_id, completed_at, completed_by_name, shift_type')
            .single()

        if (upsertError) {
            return NextResponse.json({ error: upsertError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, completed: true, data: upserted })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
