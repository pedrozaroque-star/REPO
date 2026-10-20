import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import { isValidCalendarDateISO } from '@/lib/actividades-resolution'

/**
 * @module ChecklistCompletionsAPI
 * @description Endpoint autenticado del servidor para consultar y marcar/desmarcar actividades del Checklist Operativo (`checklist_completions`).
 * @businessRules
 * - GET requiere sesión activa y alcance sobre la sucursal (`action: 'view'`, `allowEmployeeRead: true`).
 * - POST requiere sesión activa con permiso explícito `complete_checklist` (`admin`, `supervisor`, `manager`, `asistente`/`assistant`, `shift_leader` de la sucursal).
 * - Conserva estrictamente la identidad compuesta `(store_id, checklist_date, shift_type, activity_id)` tanto al marcar como al desmarcar/toggle, evitando borrados cruzados entre categorías (`Apertura`, `Regular`, `Cierre`).
 * - Registra `completed_by` y `completed_by_name` directamente desde el token JWT verificado en el servidor.
 * @dataFlow
 * - Lee/escribe `public.checklist_completions` usando `supabaseAdmin`.
 * @notes
 * - Remediación de Hallazgos 2 y 5 (permisos por acción e identidad compuesta de completado, 2026-10-20).
 */

const ALLOWED_CHECKLIST_CATEGORIES: Record<string, 'Apertura' | 'Regular' | 'Cierre'> = {
    apertura: 'Apertura',
    regular: 'Regular',
    cierre: 'Cierre',
}

function normalizeChecklistCategory(raw?: string | null): 'Apertura' | 'Regular' | 'Cierre' | null {
    if (!raw || typeof raw !== 'string') return 'Regular'
    const clean = raw.trim().toLowerCase()
    if (!clean || clean === 'todos' || clean === 'all') return 'Regular'
    return ALLOWED_CHECKLIST_CATEGORIES[clean] || null
}

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

        if (
            !store_id ||
            !start_date ||
            !end_date ||
            !isValidCalendarDateISO(start_date) ||
            !isValidCalendarDateISO(end_date) ||
            start_date > end_date
        ) {
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
                action: 'view',
            })
            if (!authAll.authorized) {
                return NextResponse.json({ error: authAll.error || 'Acceso denegado a reporte comparativo' }, { status: authAll.status })
            }
        } else {
            const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
                allowEmployeeRead: true,
                requireWrite: false,
                action: 'view',
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

        if (
            !store_id ||
            !checklist_date ||
            !isValidCalendarDateISO(String(checklist_date)) ||
            !activity_id ||
            typeof activity_id !== 'string' ||
            !activity_id.trim() ||
            activity_id.trim().length > 120
        ) {
            return NextResponse.json(
                { error: 'Parámetros requeridos inválidos (store_id, checklist_date real YYYY-MM-DD, activity_id)' },
                { status: 400 }
            )
        }

        if (!['toggle', 'complete', 'uncomplete'].includes(String(action))) {
            return NextResponse.json(
                { error: 'Parámetro action inválido (use toggle, complete o uncomplete)' },
                { status: 400 }
            )
        }

        const normalizedShiftType = normalizeChecklistCategory(shift_type)
        if (!normalizedShiftType) {
            return NextResponse.json(
                { error: `Categoría shift_type inválida ("${shift_type}"). Use Apertura, Regular o Cierre.` },
                { status: 400 }
            )
        }

        const authScope = await authorizeStoreScope(user, store_id, supabaseAdmin, {
            allowEmployeeRead: false,
            requireWrite: false,
            action: 'complete_checklist',
            allowedRoles: [
                'admin',
                'supervisor',
                'manager',
                'asistente',
                'assistant',
                'shift_leader',
                'shift leader',
                'shiftleader',
            ],
        })
        if (!authScope.authorized) {
            return NextResponse.json({ error: authScope.error || 'Acceso denegado a esta sucursal' }, { status: authScope.status })
        }

        const canonicalStoreGuid = authScope.canonicalExternalId || String(store_id)
        const cleanActivityId = activity_id.trim()

        // Hallazgo 5: Preservar identidad compuesta (store_id, checklist_date, shift_type, activity_id)
        // para evitar borrados cruzados entre categorías.
        const { data: existingRows } = await supabaseAdmin
            .from('checklist_completions')
            .select('id, shift_type')
            .eq('store_id', canonicalStoreGuid)
            .eq('checklist_date', checklist_date)
            .eq('shift_type', normalizedShiftType)
            .eq('activity_id', cleanActivityId)

        const isCurrentlyCompleted = Boolean(existingRows && existingRows.length > 0)

        if (action === 'uncomplete' || (action === 'toggle' && isCurrentlyCompleted)) {
            const ids = (existingRows || []).map((r: any) => r.id)
            if (ids.length > 0) {
                const { error: delError } = await supabaseAdmin
                    .from('checklist_completions')
                    .delete()
                    .eq('store_id', canonicalStoreGuid)
                    .eq('checklist_date', checklist_date)
                    .eq('shift_type', normalizedShiftType)
                    .eq('activity_id', cleanActivityId)
                    .in('id', ids)
                if (delError) {
                    return NextResponse.json({ error: delError.message }, { status: 500 })
                }
            }
            return NextResponse.json({
                success: true,
                completed: false,
                composite_key: `${canonicalStoreGuid}::${checklist_date}::${normalizedShiftType}::${cleanActivityId}`,
            })
        }

        const { data: upserted, error: upsertError } = await supabaseAdmin
            .from('checklist_completions')
            .upsert(
                {
                    store_id: canonicalStoreGuid,
                    checklist_date,
                    shift_type: normalizedShiftType,
                    activity_id: cleanActivityId,
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

        return NextResponse.json({
            success: true,
            completed: true,
            composite_key: `${canonicalStoreGuid}::${checklist_date}::${normalizedShiftType}::${cleanActivityId}`,
            data: upserted,
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
