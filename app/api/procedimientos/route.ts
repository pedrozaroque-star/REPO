import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getServerUser } from '@/lib/auth-server';

/**
 * @module ProcedimientosAPI
 * @description CRUD API para `operating_procedures` (catálogo corporativo de actividades).
 * @businessRules
 *   - GET requiere sesión autenticada válida (`A18`).
 *   - POST/PATCH requieren rol `admin` o `supervisor` (`A19`; `manager` tiene acceso de solo lectura al catálogo global).
 *   - DELETE requiere exclusivamente rol `admin` (`A19`).
 *   - Registra trazabilidad de auditoría (`created_by_*`, `updated_by_*`) desde el JWT verificado.
 * @dataFlow
 *   - Reads/writes to `operating_procedures` table via `supabaseAdmin`.
 */

// ═══════════════════════════════════════
// GET - Obtener todos los procedimientos
// ═══════════════════════════════════════
export async function GET(request: Request) {
    try {
        const user = await getServerUser(request);
        if (!user) {
            return NextResponse.json(
                { success: false, error: 'No autenticado. Inicia sesión para consultar el catálogo.' },
                { status: 401 }
            );
        }

        const { data, error } = await supabaseAdmin
            .from('operating_procedures')
            .select('*')
            .order('start_time', { ascending: true });

        if (error) throw error;

        return NextResponse.json({ success: true, data: data || [] });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

// ═══════════════════════════════════════
// PATCH - Editar un procedimiento (SOLO ADMIN / SUPERVISOR)
// ═══════════════════════════════════════
export async function PATCH(request: Request) {
    try {
        const user = await getServerUser(request);
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        if (user.role !== 'admin' && user.role !== 'supervisor') {
            return NextResponse.json(
                {
                    error: 'Acceso denegado: Solo Admin o Supervisor pueden modificar el catálogo corporativo.',
                },
                { status: 403 }
            );
        }

        const body = await request.json();
        const {
            id,
            start_time,
            duration_minutes,
            activity,
            frequency,
            role,
            description,
            shift_type,
            shift,
            overrides,
            store_model,
        } = body;

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        const updateData: any = { updated_at: new Date().toISOString() };
        if (start_time !== undefined) updateData.start_time = start_time || null;
        if (duration_minutes !== undefined) {
            const parsedDuration = Number(duration_minutes);
            updateData.duration_minutes =
                duration_minutes !== null &&
                duration_minutes !== '' &&
                Number.isFinite(parsedDuration)
                    ? parsedDuration
                    : null;
        }
        if (activity !== undefined) updateData.activity = String(activity).trim();
        if (shift_type !== undefined) updateData.shift_type = String(shift_type).trim();
        if (frequency !== undefined) updateData.frequency = String(frequency).trim();
        if (role !== undefined) updateData.role = role;
        if (description !== undefined) updateData.description = description;
        if (shift !== undefined) updateData.shift = shift;
        if (overrides !== undefined) updateData.overrides = overrides;
        if (store_model !== undefined) updateData.store_model = store_model;

        if (user.id) updateData.updated_by_id = String(user.id);
        if (user.name) updateData.updated_by_name = user.name;

        const { data, error } = await supabaseAdmin
            .from('operating_procedures')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
}

// ═══════════════════════════════════════
// POST - Crear un nuevo procedimiento (SOLO ADMIN / SUPERVISOR)
// ═══════════════════════════════════════
export async function POST(request: Request) {
    try {
        const user = await getServerUser(request);
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        if (user.role !== 'admin' && user.role !== 'supervisor') {
            return NextResponse.json(
                {
                    error: 'Acceso denegado: Solo Admin o Supervisor pueden crear actividades en el catálogo corporativo.',
                },
                { status: 403 }
            );
        }

        const body = await request.json();
        const {
            start_time,
            duration_minutes,
            activity,
            frequency,
            role,
            description,
            shift_type,
            shift,
            overrides,
            store_model,
        } = body;

        if (!activity || !shift_type) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Actividad y categoría son obligatorios',
                },
                { status: 400 }
            );
        }

        const parsedDuration = Number(duration_minutes);
        const insertData: any = {
            start_time: start_time || null,
            duration_minutes:
                duration_minutes !== null &&
                duration_minutes !== undefined &&
                duration_minutes !== '' &&
                Number.isFinite(parsedDuration)
                    ? parsedDuration
                    : null,
            activity: String(activity).trim(),
            shift_type: String(shift_type).trim(),
            frequency: frequency ? String(frequency).trim() : 'Diario',
            role: role || null,
            description: description || null,
            shift: shift || 'AMBOS',
            overrides: overrides || {},
            store_model: store_model || 'AMBOS',
        };

        if (user.id) {
            insertData.created_by_id = String(user.id);
            insertData.updated_by_id = String(user.id);
        }
        if (user.name) {
            insertData.created_by_name = user.name;
            insertData.updated_by_name = user.name;
        }

        const { data, error } = await supabaseAdmin
            .from('operating_procedures')
            .insert(insertData)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
}

// ═══════════════════════════════════════
// DELETE - Eliminar un procedimiento (SOLO ADMIN)
// ═══════════════════════════════════════
export async function DELETE(request: Request) {
    try {
        const user = await getServerUser(request);
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const body = await request.json();
        const { id } = body;

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        if (user.role !== 'admin') {
            return NextResponse.json(
                {
                    success: false,
                    error: 'ADMIN_ONLY',
                    message: 'Solo la cuenta de Administrador puede eliminar actividades',
                },
                { status: 403 }
            );
        }

        const { error } = await supabaseAdmin.from('operating_procedures').delete().eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
}
