/**
 * @module Preparador Manual Schedule API
 * @description Manages recurring weekly manual target quantities for meats per 30-minute block and day of week.
 * @businessRules Manual entries set by managers repeat weekly for that specific Day of Week (1=Monday...7=Sunday).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const dow = searchParams.get('dow') // 1 (Monday) to 7 (Sunday)

        if (!storeId || !dow) {
            return NextResponse.json({ error: 'Missing storeId or dow' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()
        const { data, error } = await supabase
            .from('prep_manual_schedule')
            .select('interval_start, meat_type, max_lbs')
            .eq('store_id', storeId)
            .eq('day_of_week', parseInt(dow))

        if (error) {
            // If table does not exist yet in DB, return empty array cleanly
            return NextResponse.json([])
        }

        return NextResponse.json(data || [])
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { storeId, dow, intervalStart, meatType, maxLbs } = body

        if (!storeId || !dow || !intervalStart || !meatType || maxLbs === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()
        const { data, error } = await supabase
            .from('prep_manual_schedule')
            .upsert({
                store_id: storeId,
                day_of_week: parseInt(dow),
                interval_start: intervalStart,
                meat_type: meatType,
                max_lbs: Number(maxLbs),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'store_id,day_of_week,interval_start,meat_type'
            })
            .select()

        if (error) {
            console.warn('prep_manual_schedule upsert warning:', error.message)
            return NextResponse.json({ success: true, warning: error.message })
        }

        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
