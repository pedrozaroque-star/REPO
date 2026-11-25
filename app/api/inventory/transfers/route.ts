/**
 * @module app/api/inventory/transfers
 * @description API REST oficial para registrar, consultar, confirmar/rechazar y cancelar
 *              Traspasos / Préstamos de insumos entre sucursales (`public.inventory_store_transfers`)
 *              en Tacos Gavilan.
 *
 * @businessRules
 * - Cuando una sucursal presta bolsas/unidades a otra sucursal (`from_store_id -> to_store_id`):
 *   * Si lo registra un `admin` o `supervisor`, nace directamente como `'confirmed'` e impacta
 *     al instante la Orden Diaria y el medidor `Toast vs. Sobrantes`.
 *   * Si lo registra un `manager`, `asistente` o `shift_leader` de tienda, nace como `'pending'`
 *     para que el encargado de la sucursal contraparte o un Supervisor/Admin lo confirme (`PATCH`).
 * - Validaciones estrictas:
 *   * `from_store_id !== to_store_id`
 *   * `quantity > 0` y `quantity <= 500`
 *   * `transfer_date` en formato ISO `YYYY-MM-DD` (sin permitir fechas futuras mayores al día laboral LA actual)
 *   * Alcance por tienda: encargados de sucursal solo ven y operan traspasos donde participa su tienda.
 *
 * @dataFlow
 * - UI `StoreTransferModal` -> `GET/POST/PATCH/DELETE /api/inventory/transfers` ->
 *   `public.inventory_store_transfers` -> `lib/inventory/store-transfers.ts`.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` y `getSupabaseAdminClient()`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import { addDaysIso, getBusinessDateLA, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

function isGlobalTransferRole(role: string | undefined | null): boolean {
  const r = String(role || '').toLowerCase().trim()
  return r === 'admin' || r === 'supervisor'
}

function resolveUserNumericStoreId(user: any): number | null {
  const raw = user?.storeId ?? user?.store_id ?? null
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function GET(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const supabase = await getSupabaseAdminClient()
    const sp = request.nextUrl.searchParams
    const todayLA = getBusinessDateLA()
    const defaultStart = addDaysIso(todayLA, -30)

    const rawStoreId = (sp.get('storeId') || 'all').trim()
    const startDate = (sp.get('startDate') || defaultStart).trim()
    const endDate = (sp.get('endDate') || todayLA).trim()
    const statusFilter = (sp.get('status') || 'all').trim().toLowerCase()
    const includeCatalog = sp.get('includeCatalog') === '1'

    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    const isGlobal = isGlobalTransferRole(auth.user.role)
    const userStoreId = resolveUserNumericStoreId(auth.user)
    if (!isGlobal && !userStoreId) {
      return NextResponse.json({ error: 'Store scope required' }, { status: 403 })
    }

    const effectiveStoreFilter = !isGlobal
      ? userStoreId
      : rawStoreId !== 'all' && /^\d+$/.test(rawStoreId)
        ? Number(rawStoreId)
        : null

    let query = supabase
      .from('inventory_store_transfers')
      .select(
        'id, transfer_date, from_store_id, to_store_id, inventory_item_id, quantity, status, notes, created_by_user_id, created_by_name, confirmed_by_user_id, confirmed_by_name, confirmed_at, created_at, from_store:stores!inventory_store_transfers_from_store_id_fkey(id, name), to_store:stores!inventory_store_transfers_to_store_id_fkey(id, name), item:inventory_items!inventory_store_transfers_inventory_item_id_fkey(id, name, sku, order_unit_description)'
      )
      .gte('transfer_date', startDate)
      .lte('transfer_date', endDate)
      .order('transfer_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300)

    if (effectiveStoreFilter) {
      query = query.or(`from_store_id.eq.${effectiveStoreFilter},to_store_id.eq.${effectiveStoreFilter}`)
    }
    if (statusFilter === 'pending' || statusFilter === 'confirmed' || statusFilter === 'rejected') {
      query = query.eq('status', statusFilter)
    }

    const { data: transfers, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let storesCatalog: Array<{ id: number; name: string }> = []
    let itemsCatalog: Array<{ id: string; name: string; sku: string | null; unitDesc: string | null }> = []

    if (includeCatalog) {
      const [{ data: storesData }, { data: itemsData }, { data: dailyTemplateItems }] = await Promise.all([
        supabase
          .from('stores')
          .select('id, name, external_id')
          .not('external_id', 'is', null)
          .order('id', { ascending: true }),
        supabase
          .from('inventory_items')
          .select('id, name, sku, order_unit_description, is_bodega')
          .order('name', { ascending: true }),
        supabase
          .from('store_daily_order_bases')
          .select('inventory_item_id')
          .limit(2000),
      ])

      storesCatalog = (storesData || []).map((s: any) => ({
        id: Number(s.id),
        name: String(s.name || `#${s.id}`),
      }))

      const dailyItemIds = new Set<string>(
        (dailyTemplateItems || []).map((r: any) => String(r.inventory_item_id || '')).filter(Boolean)
      )
      itemsCatalog = (itemsData || [])
        .filter((it: any) => dailyItemIds.size === 0 || dailyItemIds.has(String(it.id)) || !it.is_bodega)
        .map((it: any) => ({
          id: String(it.id),
          name: String(it.name),
          sku: it.sku ? String(it.sku) : null,
          unitDesc: it.order_unit_description ? String(it.order_unit_description) : null,
        }))
    }

    return NextResponse.json({
      transfers: (transfers || []).map((t: any) => {
        const fromObj = Array.isArray(t.from_store) ? t.from_store[0] : t.from_store
        const toObj = Array.isArray(t.to_store) ? t.to_store[0] : t.to_store
        const itemObj = Array.isArray(t.item) ? t.item[0] : t.item
        return {
          id: String(t.id),
          transferDate: String(t.transfer_date),
          fromStoreId: Number(t.from_store_id),
          fromStoreName: String(fromObj?.name || `#${t.from_store_id}`),
          toStoreId: Number(t.to_store_id),
          toStoreName: String(toObj?.name || `#${t.to_store_id}`),
          inventoryItemId: String(t.inventory_item_id),
          itemName: String(itemObj?.name || t.inventory_item_id),
          itemSku: itemObj?.sku ? String(itemObj.sku) : null,
          itemUnitDesc: itemObj?.order_unit_description ? String(itemObj.order_unit_description) : null,
          quantity: Number(t.quantity),
          status: String(t.status),
          notes: t.notes ? String(t.notes) : null,
          createdByUserId: t.created_by_user_id !== null ? Number(t.created_by_user_id) : null,
          createdByName: t.created_by_name ? String(t.created_by_name) : null,
          confirmedByUserId: t.confirmed_by_user_id !== null ? Number(t.confirmed_by_user_id) : null,
          confirmedByName: t.confirmed_by_name ? String(t.confirmed_by_name) : null,
          confirmedAt: t.confirmed_at ? String(t.confirmed_at) : null,
          createdAt: String(t.created_at || ''),
        }
      }),
      userContext: {
        userId: Number(auth.user.id) || null,
        role: String(auth.user.role || ''),
        isGlobal,
        userStoreId,
        todayLA,
      },
      ...(includeCatalog ? { storesCatalog, itemsCatalog } : {}),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const body = await request.json()
    const fromStoreId = Number(body?.from_store_id ?? body?.fromStoreId)
    const toStoreId = Number(body?.to_store_id ?? body?.toStoreId)
    const inventoryItemId = String(body?.inventory_item_id ?? body?.inventoryItemId ?? '').trim()
    const quantity = Number(body?.quantity)
    const todayLA = getBusinessDateLA()
    const transferDate = String(body?.transfer_date ?? body?.transferDate ?? todayLA).trim()
    const notes = body?.notes ? String(body.notes).trim().slice(0, 500) : null

    if (!Number.isFinite(fromStoreId) || fromStoreId <= 0 || !Number.isFinite(toStoreId) || toStoreId <= 0) {
      return NextResponse.json({ error: 'Debes seleccionar ambas sucursales.' }, { status: 400 })
    }
    if (fromStoreId === toStoreId) {
      return NextResponse.json({ error: 'La sucursal que presta y la que recibe deben ser distintas.' }, { status: 400 })
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inventoryItemId)) {
      return NextResponse.json({ error: 'Insumo inválido.' }, { status: 400 })
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 500) {
      return NextResponse.json({ error: 'La cantidad debe ser mayor a 0 y menor o igual a 500.' }, { status: 400 })
    }
    if (!isValidIsoDate(transferDate) || transferDate > todayLA) {
      return NextResponse.json({ error: 'Fecha de traspaso inválida o futura.' }, { status: 400 })
    }

    const isGlobal = isGlobalTransferRole(auth.user.role)
    const userStoreId = resolveUserNumericStoreId(auth.user)
    if (!isGlobal) {
      if (!userStoreId || (userStoreId !== fromStoreId && userStoreId !== toStoreId)) {
        return NextResponse.json(
          { error: 'Solo puedes registrar traspasos en los que participe tu sucursal.' },
          { status: 403 }
        )
      }
    }

    const userId = Number(auth.user.id) || null
    const userName = String((auth.user as any).name || (auth.user as any).full_name || auth.user.email || 'Staff')
    const initialStatus = isGlobal ? 'confirmed' : 'pending'
    const nowIso = new Date().toISOString()

    const supabase = await getSupabaseAdminClient()
    const { data: created, error } = await supabase
      .from('inventory_store_transfers')
      .insert({
        transfer_date: transferDate,
        from_store_id: fromStoreId,
        to_store_id: toStoreId,
        inventory_item_id: inventoryItemId,
        quantity: Math.round(quantity * 100) / 100,
        status: initialStatus,
        notes,
        created_by_user_id: userId,
        created_by_name: userName,
        confirmed_by_user_id: isGlobal ? userId : null,
        confirmed_by_name: isGlobal ? userName : null,
        confirmed_at: isGlobal ? nowIso : null,
      })
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ transfer: created }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const body = await request.json()
    const id = String(body?.id || '').trim()
    const action = String(body?.action || '').trim().toLowerCase()

    if (!id || (action !== 'confirm' && action !== 'reject')) {
      return NextResponse.json({ error: 'Acción o ID inválido.' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()
    const { data: existing, error: fetchErr } = await supabase
      .from('inventory_store_transfers')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Traspaso no encontrado.' }, { status: 404 })
    }
    if (existing.status !== 'pending') {
      return NextResponse.json({ error: 'Este traspaso ya fue procesado.' }, { status: 409 })
    }

    const isGlobal = isGlobalTransferRole(auth.user.role)
    const userStoreId = resolveUserNumericStoreId(auth.user)
    const userId = Number(auth.user.id) || null

    if (!isGlobal) {
      const participates =
        userStoreId !== null &&
        (userStoreId === Number(existing.from_store_id) || userStoreId === Number(existing.to_store_id))
      if (!participates) {
        return NextResponse.json({ error: 'Sin permiso sobre este traspaso.' }, { status: 403 })
      }
      if (action === 'confirm' && existing.created_by_user_id && Number(existing.created_by_user_id) === userId) {
        return NextResponse.json(
          { error: 'Debe confirmarlo la sucursal contraparte o un Supervisor/Admin.' },
          { status: 403 }
        )
      }
    }

    const userName = String((auth.user as any).name || (auth.user as any).full_name || auth.user.email || 'Staff')
    const nextStatus = action === 'confirm' ? 'confirmed' : 'rejected'
    const nowIso = new Date().toISOString()

    const { data: updated, error: updErr } = await supabase
      .from('inventory_store_transfers')
      .update({
        status: nextStatus,
        confirmed_by_user_id: userId,
        confirmed_by_name: userName,
        confirmed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({ transfer: updated })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const id = (request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) {
      return NextResponse.json({ error: 'ID requerido.' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()
    const { data: existing, error: fetchErr } = await supabase
      .from('inventory_store_transfers')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Traspaso no encontrado.' }, { status: 404 })
    }

    const isGlobal = isGlobalTransferRole(auth.user.role)
    const userId = Number(auth.user.id) || null
    const isCreatorPending =
      existing.status === 'pending' &&
      existing.created_by_user_id &&
      Number(existing.created_by_user_id) === userId

    if (!isGlobal && !isCreatorPending) {
      return NextResponse.json({ error: 'Solo Admin/Supervisor puede eliminar un traspaso confirmado.' }, { status: 403 })
    }

    const { error: delErr } = await supabase
      .from('inventory_store_transfers')
      .delete()
      .eq('id', id)

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    return NextResponse.json({ deleted: true, id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
