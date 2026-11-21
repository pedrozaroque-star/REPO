/**
 * @module app/api/delivery-armor/disputes/route
 * @description Endpoint para consultar expedientes de auditoría y generar el paquete de disputa (Dispute Dossier) formal.
 *
 * @businessRules
 *   - Provee información probatoria completa para DoorDash Merchant Portal y Uber Eats Manager.
 *   - Permite filtrar por tienda (ej. Slauson #7, Central #6), estado y término de búsqueda.
 *   - Aislamiento estricto por sucursal: `admin`, `supervisor` y `accounting` tienen alcance global;
 *     `manager`, `asistente` y `shift_leader` están restringidos exclusivamente a su `store_id` asignada.
 *
 * @dataFlow
 *   Client Admin -> GET /api/delivery-armor/disputes?storeId=6&search=999 -> `verifyStaffAuth` + `authorizeStoreScope` -> Supabase query -> formatDisputeStatement() -> Response JSON.
 *
 * @notes
 *   - Blindaje de alcance por sucursal (2026-11-21): impide que roles unipersonales consulten auditorías de otras tiendas o usen `storeId=all`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeStoreScope, getServerUser, verifyStaffAuth } from '@/lib/auth-server'
import { autoExpireUnclaimedAudits, formatDisputeStatement, getBusinessDateYmdLA } from '@/lib/delivery-armor'

const GLOBAL_DISPUTE_ROLES = new Set(['admin', 'administrador', 'supervisor', 'accounting', 'contador', 'auditor'])

export async function GET(req: NextRequest) {
  const auth = verifyStaffAuth(req, { allowCron: false })
  if (!auth.authorized || !auth.user) {
    return auth.response!
  }

  try {
    const { searchParams } = new URL(req.url)
    const storeIdParam = searchParams.get('storeId')
    const search = searchParams.get('search')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5000', 10) || 5000, 1), 10000)

    const sanitizedSearch = search
      ? search.replace(/[^a-zA-Z0-9\s#@_-]/g, '').trim().slice(0, 80)
      : ''

    const serverUser = (await getServerUser(req)) || {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.user_metadata?.full_name || auth.user.email,
      role: auth.user.role,
      store_id: auth.user.user_metadata?.store_id,
      store_ids: auth.user.user_metadata?.store_ids,
      store_scope: auth.user.user_metadata?.store_scope,
    }

    const roleLower = String(serverUser.role || '').trim().toLowerCase()
    const isGlobal = GLOBAL_DISPUTE_ROLES.has(roleLower)

    if (!isGlobal && (serverUser.store_id === undefined || serverUser.store_id === null)) {
      const numId = Number(serverUser.id)
      if (Number.isFinite(numId) && numId > 0) {
        const { data: dbUser } = await supabaseAdmin.from('users').select('store_id, store_scope').eq('id', numId).maybeSingle()
        if (dbUser) {
          serverUser.store_id = dbUser.store_id ?? serverUser.store_id
          serverUser.store_scope = dbUser.store_scope ?? serverUser.store_scope
        }
      }
    }

    let effectiveStoreId: number | undefined

    if (isGlobal) {
      const rawParsed = storeIdParam && storeIdParam.toLowerCase() !== 'all' ? parseInt(storeIdParam, 10) : NaN
      effectiveStoreId = Number.isFinite(rawParsed) && rawParsed > 0 ? rawParsed : undefined
    } else {
      if (storeIdParam && storeIdParam.toLowerCase() === 'all') {
        return NextResponse.json(
          { ok: false, error: 'Acceso denegado: tu rol solo tiene autorización sobre tu sucursal asignada.' },
          { status: 403 }
        )
      }
      const ownScope = await authorizeStoreScope(serverUser, serverUser.store_id, supabaseAdmin, { action: 'view' })
      if (!ownScope.authorized || !ownScope.resolvedStoreId) {
        return NextResponse.json(
          { ok: false, error: ownScope.error || 'Tu cuenta no tiene una sucursal asignada.' },
          { status: ownScope.status || 403 }
        )
      }
      if (storeIdParam && storeIdParam.trim() !== '') {
        const targetScope = await authorizeStoreScope(serverUser, storeIdParam, supabaseAdmin, { action: 'view' })
        if (!targetScope.authorized) {
          return NextResponse.json(
            { ok: false, error: targetScope.error || 'Acceso denegado: no puedes consultar otra sucursal.' },
            { status: targetScope.status || 403 }
          )
        }
      }
      effectiveStoreId = ownScope.resolvedStoreId
    }

    await autoExpireUnclaimedAudits(effectiveStoreId)

    const PAGE_SIZE = 1000
    const allAudits: any[] = []
    let offset = 0

    while (allAudits.length < limit) {
      const batchLimit = Math.min(PAGE_SIZE, limit - allAudits.length)
      let query = supabaseAdmin
        .from('delivery_packing_audits')
        .select('*, stores(id, name, code)')
        .order('created_at', { ascending: false })
        .range(offset, offset + batchLimit - 1)

      if (effectiveStoreId) {
        query = query.eq('store_id', effectiveStoreId)
      }

      if (status && status !== 'ALL') {
        query = query.eq('status', status)
      }

      if (sanitizedSearch) {
        query = query.or(`toast_display_number.ilike.%${sanitizedSearch}%,customer_name.ilike.%${sanitizedSearch}%,toast_order_guid.ilike.%${sanitizedSearch}%`)
      }

      const { data: batch, error } = await query

      if (error) {
        throw new Error(`Error consultando auditorías: ${error.message}`)
      }

      if (!batch || batch.length === 0) break
      allAudits.push(...batch)
      if (batch.length < batchLimit) break
      offset += batch.length
    }

    const enriched = allAudits
      .map(a => {
        const businessDate = getBusinessDateYmdLA(a.created_at || a.order_opened_at)
        return {
          ...a,
          business_date: businessDate,
          disputeStatement: formatDisputeStatement(a)
        }
      })
      .filter(a => {
        if (startDate && startDate !== 'ALL' && a.business_date < startDate) return false
        if (endDate && endDate !== 'ALL' && a.business_date > endDate) return false
        return true
      })

    return NextResponse.json({
      ok: true,
      audits: enriched,
      count: enriched.length
    })
  } catch (err: any) {
    console.error('Error en /api/delivery-armor/disputes:', err)
    return NextResponse.json({
      ok: false,
      error: 'Error al consultar expedientes de disputa'
    }, { status: 500 })
  }
}
