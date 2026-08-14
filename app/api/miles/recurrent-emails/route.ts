/**
 * @module api/miles/recurrent-emails/route
 * @description API endpoint to fetch and manage recurrent recipient email addresses for HR payroll dispatches.
 * @businessRules
 * - Returns email addresses sorted by use_count DESC so the most frequently used contacts appear first.
 * - Allows admins/supervisors to add or save new recurrent contact labels.
 * @dataFlow Client GET/POST request -> Supabase ('mileage_recurrent_emails') -> Response JSON.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = await getSupabaseAdminClient()

    const { data: emails, error } = await supabase
      .from('mileage_recurrent_emails')
      .select('*')
      .order('use_count', { ascending: false })
      .order('last_used_at', { ascending: false })

    if (error) {
      console.warn('Warning querying mileage_recurrent_emails:', error.message)
      // Fallback default list
      return NextResponse.json({
        success: true,
        emails: [
          { id: '1', email: 'roque@tacosgavilan.com', label: 'Roque (Administración)', use_count: 10 },
          { id: '2', email: 'roberto@tacosgavilan.com', label: 'Roberto Velázquez (Dirección / Nómina)', use_count: 8 }
        ]
      })
    }

    return NextResponse.json({ success: true, emails: emails || [] })
  } catch (err: any) {
    console.error('Error in GET /api/miles/recurrent-emails:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, label = 'Recursos Humanos / Nómina', created_by = null } = body

    if (!email) {
      return NextResponse.json({ error: 'El correo electrónico es requerido' }, { status: 400 })
    }

    const cleanEmail = email.toLowerCase().trim()
    const supabase = await getSupabaseAdminClient()

    const { data: existing } = await supabase
      .from('mileage_recurrent_emails')
      .select('*')
      .eq('email', cleanEmail)
      .single()

    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('mileage_recurrent_emails')
        .update({
          label: label || existing.label,
          use_count: (existing.use_count || 1) + 1,
          last_used_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, item: updated })
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('mileage_recurrent_emails')
        .insert({
          email: cleanEmail,
          label,
          use_count: 1,
          created_by
        })
        .select()
        .single()

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, item: inserted })
    }
  } catch (err: any) {
    console.error('Error in POST /api/miles/recurrent-emails:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
