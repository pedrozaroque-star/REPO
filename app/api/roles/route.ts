import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const store_id = searchParams.get('store_id')
    const start_date = searchParams.get('start_date')
    const end_date = searchParams.get('end_date')

    if (!store_id || !start_date || !end_date) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('station_assignments')
        .select(`
            *,
            toast_employees (
                id,
                first_name,
                last_name
            )
        `)
        .eq('store_id', store_id)
        .gte('assignment_date', start_date)
        .lte('assignment_date', end_date)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
}

export async function POST(req: Request) {
    const body = await req.json()
    const { assignments } = body

    if (!assignments || !Array.isArray(assignments)) {
        return NextResponse.json({ error: 'Invalid data format' }, { status: 400 })
    }

    // Remapear para asegurar que coincida con la DB
    const processedAssignments = assignments.map((a: any) => ({
        store_id: a.store_id,
        employee_id: a.employee_id,
        assignment_date: a.assignment_date,
        main_station: a.main_station || a.sub_position,
        sub_position: a.sub_position || a.main_station,
        station_group: a.station_group || 'Front',
        tasks: a.tasks || []
    }));

    const { data, error } = await supabaseAdmin
        .from('station_assignments')
        .upsert(processedAssignments, { 
            onConflict: 'store_id, employee_id, assignment_date, sub_position' 
        })

    if (error) {
        console.error('Save error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
