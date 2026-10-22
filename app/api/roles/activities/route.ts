/**
 * @module PositionActivitiesAPI
 * @description API endpoint para consultar y administrar relaciones globales puesto-actividad (`position_activities`).
 * @businessRules
 * - GET requiere sesión autenticada válida (`A18`).
 * - POST requiere rol `admin` o `supervisor` (`A19`).
 * - Soporta operaciones individuales (`add`, `delete`) y reemplazo transaccional atómico por puesto
 *   (`replace_all` vía RPC `replace_position_activities_atomic` en PostgreSQL, con rollback completo ante fallos).
 * @dataFlow
 * - Reads and writes to `position_activities` and `operating_procedures` via `supabaseAdmin`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeStoreScope, getServerUser } from '@/lib/auth-server'
import { filterApprovedPositionActivities } from '@/lib/actividades-resolution'

function computeSortOrderFromTime(startTime?: string | null): number {
    if (!startTime) return 9999
    const parts = startTime.split(':')
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) || 0
    if (Number.isNaN(h)) return 9999
    const effectiveH = h < 6 ? h + 24 : h
    return effectiveH * 60 + m
}

export async function GET(req: Request) {
    try {
        const user = await getServerUser(req)
        if (!user) {
            return NextResponse.json(
                { error: 'No autenticado. Inicia sesión para consultar la configuración de posiciones.' },
                { status: 401 }
            )
        }

        const { data, error } = await supabaseAdmin
            .from('position_activities')
            .select(`
                *,
                operating_procedures (
                    id,
                    activity,
                    start_time,
                    duration_minutes,
                    shift_type,
                    shift,
                    frequency,
                    store_model,
                    role,
                    description,
                    overrides
                )
            `)
            .order('sort_order', { ascending: true })

        if (error) throw error

        return NextResponse.json(filterApprovedPositionActivities(data || []))
    } catch (error: any) {
        console.error('FETCH POSITION ACTIVITIES ERROR:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const user = await getServerUser(req)
        const authScope = await authorizeStoreScope(user, null, supabaseAdmin, {
            action: 'manage_catalog',
            allowedRoles: ['admin', 'supervisor'],
        })
        if (!authScope.authorized) {
            return NextResponse.json(
                { error: authScope.error || 'Acceso denegado: Se requiere rol admin o supervisor' },
                { status: authScope.status }
            )
        }

        const body = await req.json()
        const { position_key, shift, activity_id, frequency, store_model, action, mappings } = body

        if (!position_key || typeof position_key !== 'string' || !position_key.trim()) {
            return NextResponse.json({ error: 'Position key is required' }, { status: 400 })
        }

        const cleanPositionKey = position_key.trim()

        // Reemplazo atómico transaccional de todos los mapeos de una posición (Fase 1 item 1 y 2 + Hallazgo G)
        if (action === 'replace_all') {
            if (!Array.isArray(mappings)) {
                return NextResponse.json(
                    { error: 'mappings array is required for replace_all' },
                    { status: 400 }
                )
            }

            if (mappings.length === 0) {
                const { data: existingRows, count: existingCount, error: existingErr } =
                    await supabaseAdmin
                        .from('position_activities')
                        .select('id', { count: 'exact' })
                        .eq('position_key', cleanPositionKey)

                if (existingErr) {
                    return NextResponse.json(
                        {
                            error: `No se pudo verificar el estado actual de position_activities antes de reemplazar: ${existingErr.message}`,
                            code: 'POSITION_ACTIVITIES_READ_FAILED',
                        },
                        { status: 500 }
                    )
                }

                const totalExisting = existingCount ?? (existingRows || []).length
                if (totalExisting > 0 && body.allow_empty_replace !== true) {
                    return NextResponse.json(
                        {
                            error: `Protección contra vaciado accidental: la posición "${cleanPositionKey}" tiene ${totalExisting} actividad(es) configurada(s). Envíe allow_empty_replace: true para vaciarla intencionalmente.`,
                            code: 'EMPTY_POSITION_REPLACE_CONFIRMATION_REQUIRED',
                            existing_count: totalExisting,
                        },
                        { status: 400 }
                    )
                }
            }

            const rawActIds = mappings.map((m: Record<string, unknown>) => String(m?.activity_id || '').trim())
            const invalidFormatId = rawActIds.find((id) => !/^[0-9a-f-]{36}$/i.test(id))
            if (invalidFormatId !== undefined) {
                return NextResponse.json(
                    {
                        error: `activity_id inválido en replace_all ("${invalidFormatId}").`,
                        code: 'INVALID_POSITION_ACTIVITY_ID',
                    },
                    { status: 400 }
                )
            }

            const uniqueActIds = Array.from(new Set(rawActIds))
            const { data: procs, error: procsErr } =
                uniqueActIds.length > 0
                    ? await supabaseAdmin
                          .from('operating_procedures')
                          .select('id, start_time, role')
                          .in('id', uniqueActIds)
                    : { data: [], error: null }

            if (procsErr) {
                return NextResponse.json(
                    {
                        error: `No se pudo validar operating_procedures antes de replace_all: ${procsErr.message}`,
                        code: 'CATALOG_VALIDATION_READ_FAILED',
                    },
                    { status: 500 }
                )
            }

            const validProcsById = new Map<string, { start_time: string | null; role: string | null }>()
            for (const p of procs || []) {
                if (p && p.role !== 'ROLES_MODULE') {
                    validProcsById.set(String(p.id), {
                        start_time: p.start_time ?? null,
                        role: p.role ?? null,
                    })
                }
            }

            const missingOrRolesModuleId = uniqueActIds.find((id) => !validProcsById.has(id))
            if (missingOrRolesModuleId) {
                return NextResponse.json(
                    {
                        error: `La actividad "${missingOrRolesModuleId}" no existe en el catálogo operativo activo o pertenece a ROLES_MODULE.`,
                        code: 'INVALID_POSITION_ACTIVITY_ID',
                    },
                    { status: 400 }
                )
            }

            const preparedMappings = mappings.map((m: Record<string, unknown>) => ({
                activity_id: String(m?.activity_id).trim(),
                shift: (m?.shift || 'AMBOS').toString().trim(),
                frequency: (m?.frequency || 'Diario').toString().trim(),
                store_model: (m?.store_model || 'AMBOS').toString().trim(),
                sort_order:
                    m?.sort_order !== undefined
                        ? Number(m.sort_order)
                        : computeSortOrderFromTime(
                              validProcsById.get(String(m?.activity_id).trim())?.start_time
                          ),
            }))

            const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
                'replace_position_activities_atomic',
                {
                    p_position_key: cleanPositionKey,
                    p_mappings: preparedMappings,
                }
            )

            if (rpcError) {
                return NextResponse.json(
                    { error: rpcError.message || 'Atomic replace failed' },
                    { status: 400 }
                )
            }

            return NextResponse.json({ success: true, result: rpcData })
        }

        if (!activity_id) {
            return NextResponse.json(
                { error: 'Position key and Activity ID are required' },
                { status: 400 }
            )
        }

        const resolvedShift = (shift || 'AMBOS').toString().trim()
        const resolvedFreq = (frequency || 'Diario').toString().trim()
        const resolvedModel = (store_model || 'AMBOS').toString().trim()

        if (action === 'delete') {
            const { data: existing, error: checkError } = await supabaseAdmin
                .from('position_activities')
                .select('id')
                .eq('position_key', cleanPositionKey)
                .eq('shift', resolvedShift)
                .eq('activity_id', activity_id)
                .eq('frequency', resolvedFreq)
                .eq('store_model', resolvedModel)
                .single()

            if (checkError || !existing) {
                return NextResponse.json({ error: 'Activity assignment not found' }, { status: 404 })
            }

            const { error } = await supabaseAdmin
                .from('position_activities')
                .delete()
                .eq('position_key', cleanPositionKey)
                .eq('shift', resolvedShift)
                .eq('activity_id', activity_id)
                .eq('frequency', resolvedFreq)
                .eq('store_model', resolvedModel)

            if (error) throw error

            return NextResponse.json({ success: true })
        } else {
            const { data: proc, error: procErr } = await supabaseAdmin
                .from('operating_procedures')
                .select('id, start_time, role')
                .eq('id', activity_id)
                .maybeSingle()

            if (procErr) {
                return NextResponse.json(
                    {
                        error: `No se pudo validar operating_procedures: ${procErr.message}`,
                        code: 'CATALOG_VALIDATION_READ_FAILED',
                    },
                    { status: 500 }
                )
            }

            if (!proc || proc.role === 'ROLES_MODULE') {
                return NextResponse.json(
                    {
                        error: `La actividad "${String(activity_id)}" no existe en el catálogo operativo activo o pertenece a ROLES_MODULE.`,
                        code: 'INVALID_POSITION_ACTIVITY_ID',
                    },
                    { status: 400 }
                )
            }

            const sortOrder = computeSortOrderFromTime(proc.start_time)

            const { error } = await supabaseAdmin.from('position_activities').upsert(
                [
                    {
                        position_key: cleanPositionKey,
                        shift: resolvedShift,
                        activity_id,
                        frequency: resolvedFreq,
                        store_model: resolvedModel,
                        sort_order: sortOrder,
                    },
                ],
                { onConflict: 'position_key,shift,activity_id,frequency,store_model' }
            )

            if (error) throw error

            return NextResponse.json({ success: true })
        }
    } catch (error: any) {
        console.error('SAVE POSITION ACTIVITIES ERROR:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
