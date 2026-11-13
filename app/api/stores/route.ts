/**
 * @module api/stores/route
 * @description API endpoint para consultar y administrar las sucursales de Tacos Gavilan.
 * @businessRules
 * - GET devuelve únicamente tiendas activas (`is_active = true`) ordenadas por nombre (uso público / mapas).
 * - POST y PUT requieren JWT corporativo TEG válido (`getServerUser`) con rol `admin` o `supervisor`.
 * - Las escrituras en `public.stores` pasan exclusivamente por servidor (`supabaseAdmin`), eliminando políticas RLS públicas de escritura.
 * @dataFlow Client -> GET/POST/PUT `/api/stores` -> `getServerUser` -> `supabaseAdmin` ('stores') -> JSON Response.
 * @notes
 * - [2026-11-12] Agregados métodos POST y PUT autenticados para soportar `/tiendas` tras el cierre de `teg_rls_access_stores`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth-server'
import { getSupabaseClient, supabaseAdmin } from '@/lib/supabase'

const STORE_MANAGE_ROLES = new Set(['admin', 'administrador', 'supervisor'])

function pickStorePayload(body: Record<string, any>) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    code: typeof body.code === 'string' ? body.code.trim() : null,
    city: typeof body.city === 'string' ? body.city.trim() : null,
    state: typeof body.state === 'string' ? body.state.trim() : null,
    address: typeof body.address === 'string' ? body.address.trim() : null,
    phone: typeof body.phone === 'string' ? body.phone.trim() : null,
    supervisor_name: typeof body.supervisor_name === 'string' ? body.supervisor_name.trim() : null,
    is_active: Boolean(body.is_active),
    opening_time: body.opening_time ? String(body.opening_time).trim() : null,
    closing_time: body.closing_time ? String(body.closing_time).trim() : null,
    weekly_hours: Array.isArray(body.weekly_hours) ? body.weekly_hours : null,
    latitude:
      body.latitude !== null && body.latitude !== undefined && body.latitude !== ''
        ? Number(body.latitude)
        : null,
    longitude:
      body.longitude !== null && body.longitude !== undefined && body.longitude !== ''
        ? Number(body.longitude)
        : null,
    external_id: body.external_id ? String(body.external_id).trim() : null,
    has_drive_thru: Boolean(body.has_drive_thru),
    zip_code: body.zip_code ? String(body.zip_code).trim() : null,
  }
}

export async function GET() {
  try {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, address, city, state, zip_code, latitude, longitude, external_id, has_drive_thru')
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser(req)
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    if (!STORE_MANAGE_ROLES.has(String(user.role || '').toLowerCase())) {
      return NextResponse.json({ error: 'Permisos insuficientes para crear tiendas' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || !String(body.name || '').trim()) {
      return NextResponse.json({ error: 'El nombre de la tienda es requerido' }, { status: 400 })
    }

    const payload = pickStorePayload(body)
    const { data, error } = await supabaseAdmin
      .from('stores')
      .insert([payload])
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, store: data }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error creando tienda' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getServerUser(req)
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    if (!STORE_MANAGE_ROLES.has(String(user.role || '').toLowerCase())) {
      return NextResponse.json({ error: 'Permisos insuficientes para editar tiendas' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const storeId = body?.id
    if (!storeId) {
      return NextResponse.json({ error: 'id de tienda requerido' }, { status: 400 })
    }
    if (!String(body.name || '').trim()) {
      return NextResponse.json({ error: 'El nombre de la tienda es requerido' }, { status: 400 })
    }

    const payload = pickStorePayload(body)
    const { data, error } = await supabaseAdmin
      .from('stores')
      .update(payload)
      .eq('id', storeId)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, store: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error actualizando tienda' }, { status: 500 })
  }
}
