import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]
    const storeId = searchParams.get('storeId') || '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

    const supabase = await getSupabaseClient()

    // Get punches for the date
    const { data: punches, error } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', storeId)
        .eq('business_date', date)
        .limit(50)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Calculate totals
    let totalRegular = 0
    let totalOvertime = 0
    let totalFromClock = 0

    punches?.forEach((p: any) => {
        const reg = Number(p.regular_hours) || 0
        const ot = Number(p.overtime_hours) || 0
        totalRegular += reg
        totalOvertime += ot

        // Also calculate from clock_in/clock_out for comparison
        if (p.clock_in && p.clock_out) {
            const start = new Date(p.clock_in).getTime()
            const end = new Date(p.clock_out).getTime()
            totalFromClock += (end - start) / (1000 * 60 * 60)
        }
    })

    return NextResponse.json({
        date,
        storeId,
        punchCount: punches?.length || 0,
        totalRegularHours: totalRegular.toFixed(2),
        totalOvertimeHours: totalOvertime.toFixed(2),
        totalHours: (totalRegular + totalOvertime).toFixed(2),
        totalFromClockCalc: totalFromClock.toFixed(2),
        samplePunches: punches?.slice(0, 5)
    })
}
