import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET() {
    try {
        const supabase = await getSupabaseAdminClient()

        // Data derived from 2025 Analysis
        const events2026 = [
            { name: 'Super Bowl LX (Domingo)', date: '2026-02-08', impact_multiplier: 0.85 },
            { name: 'San Valentin (Sabado)', date: '2026-02-14', impact_multiplier: 1.05 },
            { name: 'St Patricks (Martes)', date: '2026-03-17', impact_multiplier: 1.00 },
            { name: 'Memorial Day (Lunes)', date: '2026-05-25', impact_multiplier: 1.15 },
            { name: 'Cinco de Mayo (Martes)', date: '2026-05-05', impact_multiplier: 1.24 },
            { name: 'Dia de las Madres (Dom)', date: '2026-05-10', impact_multiplier: 0.93 },
            { name: 'Dia del Padre (Domingo)', date: '2026-06-21', impact_multiplier: 0.88 },
            { name: 'July 4th (Sabado)', date: '2026-07-04', impact_multiplier: 0.80 },
            { name: 'Labor Day (Lunes)', date: '2026-09-07', impact_multiplier: 1.19 },
            { name: 'Halloween (Sabado)', date: '2026-10-31', impact_multiplier: 1.17 }
        ]

        // 1. Clean Future Events
        await supabase
            .from('calendar_events')
            .delete()
            .gte('date', '2026-01-01')

        // 2. Insert New Events
        const { data, error } = await supabase
            .from('calendar_events')
            .insert(events2026)
            .select()

        if (error) throw error

        return NextResponse.json({ success: true, count: data.length, inserted: data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
