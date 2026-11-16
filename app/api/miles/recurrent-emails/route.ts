/**
 * @module api/miles/recurrent-emails/route
 * @description API endpoint to fetch and manage recurrent recipient email addresses for HR payroll dispatches.
 * @businessRules
 * - Returns email addresses sorted by use_count DESC so the most frequently used contacts appear first.
 * - Allows admins/supervisors to add or save new recurrent contact labels.
 * @dataFlow Client GET/POST request -> Supabase ('mileage_recurrent_emails') -> Response JSON.
 * @notes
 * - Resolves alias `roque@tacosgavilan.com` canonically to `carlos@tacosgavilan.com` so test/HR dispatches never list or target the login-only alias.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

function normalizeMilesMailbox(email: string): string {
  const clean = email.toLowerCase().trim()
  return clean === 'roque@tacosgavilan.com' ? 'carlos@tacosgavilan.com' : clean
}

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
          { id: '1', email: 'raquel@tacosgavilan.com', label: 'Recursos Humanos / Nómina', use_count: 10 },
          { id: '2', email: 'roberto@tacosgavilan.com', label: 'Roberto Velázquez (Dirección / Nómina)', use_count: 8 }
        ]
      })
    }

    const dedupMap = new Map<string, any>()
    for (const item of emails || []) {
      const normalized = normalizeMilesMailbox(item.email || '')
      if (!normalized) continue
      // No exponer buzones personales o protegidos como chips públicos a supervisores
      if (normalized === 'carlos@tacosgavilan.com' || normalized === 'pedrozaroque@gmail.com') {
        continue
      }
      const existing = dedupMap.get(normalized)
      if (existing) {
        existing.use_count = (existing.use_count || 0) + (item.use_count || 0)
        if ((item.last_used_at || '') > (existing.last_used_at || '')) {
          existing.last_used_at = item.last_used_at
        }
      } else {
        dedupMap.set(normalized, {
          ...item,
          email: normalized,
          label: /carlos/i.test(String(item.label || ''))
            ? 'Sistema de Monitoreo (Administración)'
            : item.label
        })
      }
    }

    const normalizedList = Array.from(dedupMap.values()).sort(
      (a, b) => (b.use_count || 0) - (a.use_count || 0)
    )

    return NextResponse.json({ success: true, emails: normalizedList })
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

    const cleanEmail = normalizeMilesMailbox(email)
    if (cleanEmail === 'carlos@tacosgavilan.com' || cleanEmail === 'pedrozaroque@gmail.com') {
      return NextResponse.json({
        success: true,
        item: { id: 'system', email: 'noreply@tacosgavilan.com', label: 'Sistema de Monitoreo', use_count: 1 }
      })
    }
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
