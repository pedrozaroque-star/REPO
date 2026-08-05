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
        const rawStoreId = searchParams.get('storeId')
        const dow = searchParams.get('dow') // 1 (Monday) to 7 (Sunday)

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

        const numericStoreId = parseInt(String(storeId), 10)
        const supabase = await getSupabaseAdminClient()
        const { data, error } = await supabase
            .from('prep_manual_schedule')
            .upsert({
                store_id: isNaN(numericStoreId) ? storeId : numericStoreId,
                day_of_week: parseInt(String(dow), 10),
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
