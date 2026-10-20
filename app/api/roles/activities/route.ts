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

        // Reemplazo atómico transaccional de todos los mapeos de una posición (Fase 1 item 1 y 2)
        if (action === 'replace_all') {
            if (!Array.isArray(mappings)) {
                return NextResponse.json(
                    { error: 'mappings array is required for replace_all' },
                    { status: 400 }
                )
            }

            const actIds = mappings
                .map((m: any) => m?.activity_id)
                .filter((id: any) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))

            const { data: procs } =
                actIds.length > 0
                    ? await supabaseAdmin
                          .from('operating_procedures')
                          .select('id, start_time')
                          .in('id', actIds)
                    : { data: [] }

            const procTimeMap = new Map<string, string | null>(
                (procs || []).map((p: any) => [String(p.id), p.start_time])
            )

            const preparedMappings = mappings.map((m: any) => ({
                activity_id: m?.activity_id,
                shift: (m?.shift || 'AMBOS').toString().trim(),
                frequency: (m?.frequency || 'Diario').toString().trim(),
                store_model: (m?.store_model || 'AMBOS').toString().trim(),
                sort_order:
                    m?.sort_order !== undefined
                        ? Number(m.sort_order)
                        : computeSortOrderFromTime(procTimeMap.get(String(m?.activity_id))),
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
            const { data: proc } = await supabaseAdmin
                .from('operating_procedures')
                .select('start_time')
                .eq('id', activity_id)
                .single()

            const sortOrder = computeSortOrderFromTime(proc?.start_time)

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
