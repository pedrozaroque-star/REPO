import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// ═══════════════════════════════════════
// GET - Obtener todos los procedimientos
// ═══════════════════════════════════════
export async function GET() {
  try {
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
// PATCH - Editar un procedimiento
// ═══════════════════════════════════════
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, start_time, duration_minutes, activity, frequency, role, description, shift_type, shift, overrides, store_model } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (start_time !== undefined) updateData.start_time = start_time;
    if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes ? Number(duration_minutes) : null;
    if (activity !== undefined) updateData.activity = activity;
    if (shift_type !== undefined) updateData.shift_type = shift_type;
    if (frequency !== undefined) updateData.frequency = frequency;
    if (role !== undefined) updateData.role = role;
    if (description !== undefined) updateData.description = description;
    if (shift !== undefined) updateData.shift = shift;
    if (overrides !== undefined) updateData.overrides = overrides;
    if (store_model !== undefined) updateData.store_model = store_model;

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
// POST - Crear un nuevo procedimiento
// ═══════════════════════════════════════
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { start_time, duration_minutes, activity, frequency, role, description, shift_type, shift, overrides, store_model } = body;

    if (!activity || !shift_type) {
      return NextResponse.json({ 
        success: false, 
        error: 'Actividad y categoría son obligatorios' 
      }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('operating_procedures')
      .insert({ 
        start_time: start_time || null, 
        duration_minutes: duration_minutes ? Number(duration_minutes) : null, 
        activity, 
        shift_type,
        frequency: frequency || 'Diario', 
        role: role || null, 
        description: description || null,
        shift: shift || 'AMBOS',
        overrides: overrides || {},
        store_model: store_model || 'AMBOS'
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

// ═══════════════════════════════════════
// DELETE - Eliminar un procedimiento
// ═══════════════════════════════════════
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('operating_procedures')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
