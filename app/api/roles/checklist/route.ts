import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import {
    fetchCompleteRangeAssignments,
    isValidCalendarDateISO,
    parseStrictChecklistShiftType,
    validateChecklistMutationSafety,
} from '@/lib/actividades-resolution'

/**
 * @module ChecklistCompletionsAPI
 * @description Endpoint autenticado del servidor para consultar y marcar/desmarcar actividades del Checklist Operativo (`checklist_completions`).
 * @businessRules
 * - GET requiere sesión activa y alcance sobre la sucursal (`action: 'view'`, `allowEmployeeRead: true`).
 * - POST requiere sesión activa con permiso explícito `complete_checklist` (`admin`, `supervisor`, `manager`, `asistente`/`assistant`, `shift_leader` de la sucursal).
 * - Conserva estrictamente la identidad compuesta `(store_id, checklist_date, shift_type, activity_id)` tanto al marcar como al desmarcar/toggle, evitando borrados cruzados entre categorías (`Apertura`, `Regular`, `Cierre`).
 * - Registra `completed_by` y `completed_by_name` directamente desde el token JWT verificado en el servidor.
 * - Compuerta fail-closed (Hallazgo D):
 *   1) Rechaza `shift_type` inválido (`'Todos'`, `'ALL'`, `''` o desconocidos) con HTTP 400 (sin convertirlos silenciosamente en `'Regular'`).
 *   2) Si falla la consulta previa de `checklist_completions`, aborta con HTTP 500 (nunca interpreta un fallo de lectura como "no completado").
 *   3) Antes de insertar un completado, valida que `activity_id` exista en `operating_procedures` y sea compatible con la sucursal y fecha laboral.
 * @dataFlow
 * - Lee/escribe `public.checklist_completions` y valida contra `public.operating_procedures` y `public.stores` usando `supabaseAdmin`.
 * @notes
 * - Remediación de Hallazgos 2, 5 y Hallazgo D (Etapa 3, 2026-10-21).
 */

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

        let canonicalStoreFilter: string | null = null

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
            canonicalStoreFilter = authScope.canonicalExternalId || store_id
        }

        const paginatedRes = await fetchCompleteRangeAssignments<Record<string, unknown>>({
            pageSize: 1000,
            maxRows: 30000,
            fetchPage: async (offset, limit) => {
                let pageQuery = supabaseAdmin
                    .from('checklist_completions')
                    .select(
                        'id, store_id, checklist_date, activity_id, completed_at, completed_by_name, shift_type',
                        { count: 'exact' }
                    )
                    .gte('checklist_date', start_date)
                    .lte('checklist_date', end_date)
                    .order('id', { ascending: true })
                    .range(offset, offset + limit - 1)

                if (canonicalStoreFilter) {
                    pageQuery = pageQuery.eq('store_id', canonicalStoreFilter)
                }

                const res = await pageQuery
                return {
                    data: res.data || null,
                    error: res.error ? { message: res.error.message } : null,
                    count: res.count,
                }
            },
        })

        if (paginatedRes.error || !paginatedRes.isComplete) {
            return NextResponse.json(
                {
                    error:
                        paginatedRes.error?.message ||
                        `No se pudo completar la lectura íntegra de checklist_completions (${paginatedRes.incompletenessReason || 'INCOMPLETE_READ'}).`,
                    code: 'CHECKLIST_REPORT_READ_INCOMPLETE',
                },
                { status: 500 }
            )
        }

        return NextResponse.json(paginatedRes.data || [])
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

        const normalizedShiftType = parseStrictChecklistShiftType(shift_type)
        if (!normalizedShiftType) {
            return NextResponse.json(
                {
                    error: `Categoría shift_type inválida ("${String(shift_type ?? '')}"). Use exactamente Apertura, Regular o Cierre.`,
                    code: 'INVALID_SHIFT_TYPE',
                },
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

        // Hallazgo 5 & Hallazgo D: Preservar identidad compuesta (store_id, checklist_date, shift_type, activity_id)
        // y verificar con compuerta fail-closed si ocurre un error de lectura.
        const [existingRes, procRes, storeRes] = await Promise.all([
            supabaseAdmin
                .from('checklist_completions')
                .select('id, shift_type')
                .eq('store_id', canonicalStoreGuid)
                .eq('checklist_date', checklist_date)
                .eq('shift_type', normalizedShiftType)
                .eq('activity_id', cleanActivityId),
            supabaseAdmin
                .from('operating_procedures')
                .select('id, activity, description, shift_type, shift, start_time, duration_minutes, frequency, store_model, role, overrides')
                .eq('id', cleanActivityId)
                .maybeSingle(),
            supabaseAdmin
                .from('stores')
                .select('id, name, external_id, opening_time, closing_time, weekly_hours, has_drive_thru')
                .eq('external_id', canonicalStoreGuid)
                .maybeSingle(),
        ])

        const safetyValidation = validateChecklistMutationSafety({
            action: action as 'toggle' | 'complete' | 'uncomplete',
            rawShiftType: shift_type,
            businessDateStr: String(checklist_date),
            store: storeRes.data || { external_id: canonicalStoreGuid, has_drive_thru: false },
            existingQueryError: existingRes.error,
            existingRows: existingRes.data,
            procedureQueryError: procRes.error,
            procedure: procRes.data as any,
        })

        if (!safetyValidation.ok) {
            return NextResponse.json(
                {
                    error: safetyValidation.error,
                    code: safetyValidation.code,
                },
                { status: safetyValidation.status }
            )
        }

        if (safetyValidation.shouldDelete) {
            const ids = safetyValidation.existingIds
            if (ids.length > 0) {
                const { error: delError } = await supabaseAdmin
                    .from('checklist_completions')
                    .delete()
                    .eq('store_id', canonicalStoreGuid)
                    .eq('checklist_date', checklist_date)
                    .eq('shift_type', safetyValidation.normalizedShiftType)
                    .eq('activity_id', cleanActivityId)
                    .in('id', ids)
                if (delError) {
                    return NextResponse.json({ error: delError.message }, { status: 500 })
                }
            }
            return NextResponse.json({
                success: true,
                completed: false,
                composite_key: `${canonicalStoreGuid}::${checklist_date}::${safetyValidation.normalizedShiftType}::${cleanActivityId}`,
            })
        }

        const { data: upserted, error: upsertError } = await supabaseAdmin
            .from('checklist_completions')
            .upsert(
                {
                    store_id: canonicalStoreGuid,
                    checklist_date,
                    shift_type: safetyValidation.normalizedShiftType,
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
