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
        // ═══ ESTRATEGIA ATÓMICA SEGURA (Safe Atomic Strategy) ═══
        // 1. Identificar registros antiguos a eliminar
        // 2. Insertar registros nuevos PRIMERO
        // 3. Eliminar registros antiguos DESPUÉS
        // Si la inserción falla, los datos originales se preservan.

        let idsToDelete: string[] = [];

        if (active_shift) {
            const shiftSuffix = `_${active_shift}`;
            const { data: existing } = await supabaseAdmin
                .from('station_assignments')
                .select('id, sub_position')
                .eq('store_id', store_id)
                .gte('assignment_date', start_date)
                .lte('assignment_date', end_date);

            if (existing && existing.length > 0) {
                idsToDelete = existing
                    .filter(a => a.sub_position?.endsWith(shiftSuffix))
                    .map(a => a.id);
            }
        } else {
            const { data: existing } = await supabaseAdmin
                .from('station_assignments')
                .select('id')
                .eq('store_id', store_id)
                .gte('assignment_date', start_date)
                .lte('assignment_date', end_date);

            if (existing && existing.length > 0) {
                idsToDelete = existing.map(a => a.id);
            }
        }

        if (assignments.length === 0 && idsToDelete.length === 0) {
            return NextResponse.json({ success: true, message: 'Semana limpiada (sin asignaciones)' });
        }

        // Paso 1: INSERTAR registros nuevos PRIMERO (si hay)
        let insertedIds: string[] = [];
        if (assignments.length > 0) {
            const processedAssignments = assignments.map((a: any) => ({
                store_id: a.store_id || store_id,
                employee_id: a.employee_id,
                assignment_date: a.assignment_date,
                main_station: a.main_station || a.sub_position,
                sub_position: a.sub_position || a.main_station,
                station_group: a.station_group || 'Front',
                tasks: a.tasks || []
            }));

            const { data: inserted, error: insertError } = await supabaseAdmin
                .from('station_assignments')
                .insert(processedAssignments)
                .select('id');

            if (insertError) throw insertError;
            insertedIds = (inserted || []).map(r => r.id);
        }

        // Paso 2: ELIMINAR registros antiguos DESPUÉS (solo si insert fue exitoso)
        if (idsToDelete.length > 0) {
            const { error: deleteError } = await supabaseAdmin
                .from('station_assignments')
                .delete()
                .in('id', idsToDelete);

            if (deleteError) {
                // Rollback: si el delete falla, eliminar los recién insertados
                console.error('DELETE failed, rolling back inserted records:', deleteError);
                if (insertedIds.length > 0) {
                    await supabaseAdmin
                        .from('station_assignments')
                        .delete()
                        .in('id', insertedIds);
                }
                throw deleteError;
            }
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('CRITICAL SAVE ERROR:', error);
        return NextResponse.json({ 
            error: 'Error al persistir en base de datos', 
            details: error.message 
        }, { status: 500 })
    }
}
