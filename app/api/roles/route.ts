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
    const { assignments, store_id, start_date, end_date, active_shift } = body

    if (!assignments || !Array.isArray(assignments) || !store_id || !start_date || !end_date) {
        return NextResponse.json({ error: 'Faltan parámetros críticos (assignments, store_id, dates)' }, { status: 400 })
    }

    try {
        // 1. ELIMINACIÓN SEGURA POR TURNO: Solo borrar el turno que se está guardando
        // Esto evita que el save del turno AM borre los datos del turno PM (y viceversa)
        // cuando hay 2 usuarios editando simultáneamente.
        if (active_shift) {
            const shiftSuffix = `_${active_shift}`;
            // Obtener todos los assignments de la semana para filtrar por turno
            const { data: existing } = await supabaseAdmin
                .from('station_assignments')
                .select('id, sub_position')
                .eq('store_id', store_id)
                .gte('assignment_date', start_date)
                .lte('assignment_date', end_date);

            if (existing && existing.length > 0) {
                const idsToDelete = existing
                    .filter(a => a.sub_position?.endsWith(shiftSuffix))
                    .map(a => a.id);
                
                if (idsToDelete.length > 0) {
                    const { error: deleteError } = await supabaseAdmin
                        .from('station_assignments')
                        .delete()
                        .in('id', idsToDelete);
                    if (deleteError) throw deleteError;
                }
            }
        } else {
            // Fallback: borrar toda la semana (comportamiento legacy)
            const { error: deleteError } = await supabaseAdmin
                .from('station_assignments')
                .delete()
                .eq('store_id', store_id)
                .gte('assignment_date', start_date)
                .lte('assignment_date', end_date);
            if (deleteError) throw deleteError;
        }

        if (assignments.length === 0) {
            return NextResponse.json({ success: true, message: 'Semana limpiada (sin asignaciones)' });
        }

        // 2. INSERCIÓN DE NUEVO ESTADO
        const processedAssignments = assignments.map((a: any) => ({
            store_id: a.store_id || store_id,
            employee_id: a.employee_id,
            assignment_date: a.assignment_date,
            main_station: a.main_station || a.sub_position,
            sub_position: a.sub_position || a.main_station,
            station_group: a.station_group || 'Front',
            tasks: a.tasks || []
        }));

        const { error: insertError } = await supabaseAdmin
            .from('station_assignments')
            .insert(processedAssignments);

        if (insertError) throw insertError;

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('CRITICAL SAVE ERROR:', error);
        return NextResponse.json({ 
            error: 'Error al persistir en base de datos', 
            details: error.message 
        }, { status: 500 })
    }
}
