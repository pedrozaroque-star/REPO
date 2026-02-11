import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
    try {
        const { storeId, startDate, endDate } = await req.json()

        if (!storeId || !startDate || !endDate) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        const supabase = await getSupabaseClient()

        // NUCLEAR OPTION: Delete ALL shifts in this range for this store
        // We do not filter by status - the user wants to clear the board.
        const { error, count } = await supabase
            .from('shifts')
            .delete({ count: 'exact' })
            .eq('store_id', storeId)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)

        if (error) {
            console.error('Error clearing shifts:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, count })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
