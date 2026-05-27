import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Helper: verificar autenticación básica
function getAuthFromRequest(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════
// PATCH - Editar un procedimiento
// ═══════════════════════════════════════
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, start_time, duration_minutes, activity, frequency, role, description, shift_type } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('operating_procedures')
      .update({ 
        start_time, 
        duration_minutes: duration_minutes ? Number(duration_minutes) : null, 
        activity, 
        shift_type,
        frequency, 
        role, 
        description, 
        updated_at: new Date().toISOString() 
      })
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
    const { start_time, duration_minutes, activity, frequency, role, description, shift_type } = body;

    if (!activity || !shift_type || !frequency) {
      return NextResponse.json({ 
        success: false, 
        error: 'Actividad, categoría y frecuencia son obligatorios' 
      }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('operating_procedures')
      .insert({ 
        start_time: start_time || null, 
        duration_minutes: duration_minutes ? Number(duration_minutes) : null, 
        activity, 
        shift_type,
        frequency, 
        role: role || null, 
        description: description || null
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
