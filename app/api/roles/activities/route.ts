/**
 * @module PositionActivitiesAPI
 * @description API endpoint to fetch and manage global position-activity mappings.
 * @businessRules
 * - Activity assignments are global for all stores.
 * - Store model type allows custom mappings for Regular vs Drive-Thru stores.
 * - Assignments are resolved by position key (e.g. COOK_MALE, CASHIER) instead of specific stations.
 * @dataFlow
 * - Reads and writes to the `position_activities` and `operating_procedures` tables in Supabase.
 * @notes
 * - Uses supabaseAdmin to bypass RLS for configuration read/write operations.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
    try {
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
                    frequency,
                    role,
                    description
                )
            `)
            .order('sort_order', { ascending: true })

        if (error) throw error

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('FETCH POSITION ACTIVITIES ERROR:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { position_key, shift, activity_id, frequency, store_model, action } = body

        if (!position_key || !activity_id) {
            return NextResponse.json({ error: 'Position key and Activity ID are required' }, { status: 400 })
        }

        const resolvedShift = shift || 'AMBOS'
        const resolvedFreq = frequency || 'Diario'
        const resolvedModel = store_model || 'AMBOS'

        if (action === 'delete') {
            const { error } = await supabaseAdmin
                .from('position_activities')
                .delete()
                .eq('position_key', position_key)
                .eq('shift', resolvedShift)
                .eq('activity_id', activity_id)
                .eq('frequency', resolvedFreq)
                .eq('store_model', resolvedModel)

            if (error) throw error

            return NextResponse.json({ success: true })
        } else {
            // Find activity in operating_procedures to get start_time for sort_order
            const { data: proc } = await supabaseAdmin
                .from('operating_procedures')
                .select('start_time')
                .eq('id', activity_id)
                .single()

            let sortOrder = 0;
            if (proc?.start_time) {
                const parts = proc.start_time.split(':');
                const h = parseInt(parts[0], 10) || 0;
                const m = parseInt(parts[1], 10) || 0;
                const effectiveH = h < 6 ? h + 24 : h;
                sortOrder = effectiveH * 60 + m;
            }

            const { error } = await supabaseAdmin
                .from('position_activities')
                .upsert([{
                    position_key,
                    shift: resolvedShift,
                    activity_id,
                    frequency: resolvedFreq,
                    store_model: resolvedModel,
                    sort_order: sortOrder
                }], { onConflict: 'position_key,shift,activity_id,frequency,store_model' })

            if (error) throw error

            return NextResponse.json({ success: true })
        }
    } catch (error: any) {
        console.error('SAVE POSITION ACTIVITIES ERROR:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
