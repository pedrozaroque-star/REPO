import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, start_time, duration_minutes, activity, frequency, role, description } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('operating_procedures')
      .update({ 
        start_time, 
        duration_minutes: duration_minutes ? Number(duration_minutes) : null, 
        activity, 
        frequency, 
        role, 
        description, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
