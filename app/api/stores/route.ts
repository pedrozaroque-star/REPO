/**
 * @module api/stores/route
 * @description API endpoint para consultar y administrar las sucursales de Tacos Gavilan.
 * @businessRules
 * - `GET` sin sesión autenticada devuelve únicamente columnas públicas de tiendas activas (`id, code, name, address, phone, external_id, has_drive_thru, opening_time, closing_time, is_active, latitude, longitude`).
 * - `GET` con sesión autenticada (`getServerUser(request)`) devuelve las columnas completas del registro con `Cache-Control: private, no-store`.
 * - `POST` y `PUT` requieren JWT corporativo TEG válido (`getServerUser`) con rol `admin` o `supervisor`.
 * @dataFlow Client -> GET/POST/PUT `/api/stores` -> `getServerUser` -> `supabaseAdmin` ('stores') -> JSON Response.
 * @notes
 * - [2026-11-12] Agregados métodos POST y PUT autenticados para soportar `/tiendas` tras el cierre de `teg_rls_access_stores`.
 * - [2026-11-19] Invalidación inmediata de cachés RAM (`invalidateStoreLookupCache`, `clearOrderReadyStoresCache`) tras POST/PUT.
 * - [2026-11-21] Separación estricta de columnas públicas vs columnas internas según autenticación (`getServerUser(request)`) + `Vary: Authorization, Cookie`.
 * - [2026-11-24] Sanitización de `name` sin prefijos `#` (`formatStoreDisplayName`) y ordenamiento alfabético A–Z (`sortStoresAlphabetically`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerUser, invalidateStoreLookupCache } from '@/lib/auth-server'
import { clearOrderReadyStoresCache } from '@/lib/order-ready-access'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'
import { supabaseAdmin } from '@/lib/supabase'

const STORE_MANAGE_ROLES = new Set(['admin', 'administrador', 'supervisor'])

const PUBLIC_STORE_SELECT_COLUMNS =
  'id, code, name, address, phone, external_id, has_drive_thru, opening_time, closing_time, is_active, latitude, longitude'

function normalizeStoreResponseRow<T extends { id?: number | string | null; code?: string | null; name?: string | null }>(
  row: T
): T {
  return {
    ...row,
    name: formatStoreDisplayName(row),
  }
}

function pickStorePayload(body: Record<string, unknown>) {
  return {
    name: typeof body.name === 'string' ? formatStoreDisplayName(body.name) : '',
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

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request)
    const isAuthenticatedStaff = Boolean(user && String(user.role || '').toLowerCase() !== 'employee')

    if (isAuthenticatedStaff) {
      const { data, error } = await supabaseAdmin
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error

      const sorted = sortStoresAlphabetically(
        (data || []).map((row) => normalizeStoreResponseRow(row)),
        (row) => row.name
      )

      return NextResponse.json(sorted, {
        headers: {
          'Cache-Control': 'private, no-store',
          Vary: 'Authorization, Cookie',
        },
      })
    }

    const { data, error } = await supabaseAdmin
      .from('stores')
      .select(PUBLIC_STORE_SELECT_COLUMNS)
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    const sorted = sortStoresAlphabetically(
      (data || []).map((row) => normalizeStoreResponseRow(row)),
      (row) => row.name
    )

    return NextResponse.json(sorted, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        Vary: 'Authorization, Cookie',
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error consultando tiendas'
    return NextResponse.json({ error: message }, { status: 500 })
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
    invalidateStoreLookupCache()
    clearOrderReadyStoresCache()
    return NextResponse.json({ success: true, store: normalizeStoreResponseRow(data) }, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error creando tienda'
    return NextResponse.json({ error: message }, { status: 500 })
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
    invalidateStoreLookupCache()
    clearOrderReadyStoresCache()
    return NextResponse.json({ success: true, store: normalizeStoreResponseRow(data) })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error actualizando tienda'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
