/**
 * @module api/feedback/route
 * @description API privada autenticada para lectura y gestión administrativa de `customer_feedback` en el sistema interno TEG.
 * @businessRules
 * - Exige autenticación corporativa válida (`getServerUser` con `teg_token`). Cero acceso anónimo o desde tokens de clientes de app móvil.
 * - Aislamiento por sucursal: `admin`, `administrador`, `auditor` y `supervisor` tienen alcance global; `manager`, `gerente`, `asistente`, `shift_leader` y `cocina` están restringidos exclusivamente a su `store_id` asignada.
 * - `GET` soporta modos:
 *   * `dashboard`: últimas 500 evaluaciones (filtrables por `startTs`/`endTs`) para métricas NPS en Dashboard (restringidas a la tienda del usuario si no es global).
 *   * `list`: consulta paginada con filtros (`storeFilter`, `statusFilter`, `sourceFilter`, `startDate`, `endDate`, `page`, `itemsPerPage`), conteo de comentarios y RPC `get_feedback_overview`.
 *   * `notify_status`: consulta `notify_manager` para un `id` específico dentro de `FeedbackReviewModal` (verificando pertenencia de tienda).
 * - `PATCH` permite únicamente a roles revisores (`admin`, `administrador`, `auditor`, `manager`, `supervisor`, `gerente`) actualizar `notify_manager` o concluir revisión (`conclude_review`) derivando `reviewed_by` exclusivamente desde `user.id` del JWT verificado y validando tienda.
 * @dataFlow Dashboard / Feedback UI / Modal -> `/api/feedback` (`getServerUser` + `authorizeStoreScope`) -> `supabaseAdmin` -> JSON Response.
 * @notes
 * - [2026-11-12] Creado para sustituir consultas directas del navegador sobre `customer_feedback`.
 * - [2026-11-21] Endurecido aislamiento por sucursal para `manager`, `asistente` y `shift_leader` tanto en `GET` (`dashboard`, `list`, `notify_status`) como en `PATCH`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizeStoreScope, getServerUser, type ServerUser } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

const STAFF_READ_ROLES = new Set([
  'admin',
  'administrador',
  'auditor',
  'supervisor',
  'manager',
  'general_manager',
  'gerente',
  'asistente',
  'assistant',
  'shift_leader',
  'shift leader',
  'shiftleader',
  'cocina',
])

const REVIEW_WRITE_ROLES = new Set([
  'admin',
  'administrador',
  'auditor',
  'supervisor',
  'manager',
  'general_manager',
  'gerente',
])

const GLOBAL_FEEDBACK_ROLES = new Set([
  'admin',
  'administrador',
  'auditor',
  'supervisor',
])

export const dynamic = 'force-dynamic'

async function resolveAssignedStoreForFeedbackUser(user: ServerUser): Promise<{
  isGlobal: boolean
  assignedStoreId: number | null
  hydratedUser: ServerUser
}> {
  const roleLower = String(user.role || '').trim().toLowerCase()
  if (GLOBAL_FEEDBACK_ROLES.has(roleLower)) {
    return { isGlobal: true, assignedStoreId: null, hydratedUser: user }
  }

  const hydrated: ServerUser = { ...user }
  if (hydrated.store_id === undefined || hydrated.store_id === null) {
    const numId = Number(hydrated.id)
    if (Number.isFinite(numId) && numId > 0) {
      const { data: dbUser } = await supabaseAdmin
        .from('users')
        .select('store_id, store_scope')
        .eq('id', numId)
        .maybeSingle()
      if (dbUser) {
        hydrated.store_id = dbUser.store_id ?? hydrated.store_id
        hydrated.store_scope = dbUser.store_scope ?? hydrated.store_scope
      }
    }
  }

  // Para rol cocina (no incluido en ACTION_ALLOWED_ROLES de authorizeStoreScope), resolver sucursal directamente desde store_id
  if (roleLower === 'cocina') {
    const directStoreId = Number(hydrated.store_id)
    return {
      isGlobal: false,
      assignedStoreId: Number.isFinite(directStoreId) && directStoreId > 0 ? directStoreId : null,
      hydratedUser: hydrated,
    }
  }

  const scopeRes = await authorizeStoreScope(hydrated, hydrated.store_id, supabaseAdmin, { action: 'view' })
  return {
    isGlobal: false,
    assignedStoreId: scopeRes.authorized && scopeRes.resolvedStoreId ? scopeRes.resolvedStoreId : null,
    hydratedUser: hydrated,
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser(req)
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const roleLower = String(user.role || '').trim().toLowerCase()
    if (!STAFF_READ_ROLES.has(roleLower)) {
      return NextResponse.json({ error: 'Acceso denegado para este rol' }, { status: 403 })
    }

    const { isGlobal, assignedStoreId, hydratedUser } = await resolveAssignedStoreForFeedbackUser(user)
    if (!isGlobal && !assignedStoreId) {
      return NextResponse.json(
        { error: 'Acceso denegado: tu cuenta no tiene una sucursal asignada.' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode') || 'list'

    if (mode === 'notify_status') {
      const id = searchParams.get('id')
      if (!id) {
        return NextResponse.json({ error: 'id requerido' }, { status: 400 })
      }
      const { data, error } = await supabaseAdmin
        .from('customer_feedback')
        .select('notify_manager, store_id')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        return NextResponse.json({ error: 'Evaluación no encontrada' }, { status: 404 })
      }
      if (!isGlobal && Number(data.store_id) !== assignedStoreId) {
        return NextResponse.json({ error: 'Acceso denegado a evaluaciones de otra sucursal' }, { status: 403 })
      }
      return NextResponse.json({ success: true, notify_manager: Boolean(data?.notify_manager) })
    }

    if (mode === 'dashboard') {
      const startTs = searchParams.get('startTs')
      const endTs = searchParams.get('endTs')

      let queryFeedback = supabaseAdmin
        .from('customer_feedback')
        .select('*, stores(name,code,city,state,google_place_id)')
        .order('submission_date', { ascending: false })
        .limit(500)

      if (!isGlobal && assignedStoreId) {
        queryFeedback = queryFeedback.eq('store_id', assignedStoreId)
      }
      if (startTs) queryFeedback = queryFeedback.gte('submission_date', startTs)
      if (endTs) queryFeedback = queryFeedback.lte('submission_date', endTs)

      const { data, error } = await queryFeedback
      if (error) throw error
      return NextResponse.json({ success: true, data: data || [] })
    }

    // mode === 'list'
    const storeFilter = searchParams.get('storeFilter') || 'all'
    const statusFilter = searchParams.get('statusFilter') || 'all'
    const sourceFilter = searchParams.get('sourceFilter') || 'all'
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const itemsPerPage = Math.min(200, Math.max(1, parseInt(searchParams.get('itemsPerPage') || '100', 10) || 100))

    let effectiveStoreFilter: string | number = storeFilter
    if (!isGlobal && assignedStoreId) {
      if (storeFilter !== 'all') {
        if (roleLower === 'cocina') {
          if (Number(storeFilter) !== assignedStoreId) {
            return NextResponse.json({ error: 'Acceso denegado a otra sucursal' }, { status: 403 })
          }
        } else {
          const targetCheck = await authorizeStoreScope(hydratedUser, storeFilter, supabaseAdmin, { action: 'view' })
          if (!targetCheck.authorized) {
            return NextResponse.json({ error: targetCheck.error || 'Acceso denegado a otra sucursal' }, { status: targetCheck.status || 403 })
          }
        }
      }
      effectiveStoreFilter = assignedStoreId
    }

    let query = supabaseAdmin
      .from('customer_feedback')
      .select('*, stores(name,code,city,state,google_place_id)', { count: 'exact' })
      .order('submission_date', { ascending: false })

    if (effectiveStoreFilter !== 'all') {
      query = query.eq('store_id', effectiveStoreFilter)
    }
    if (startDate) {
      query = query.gte('submission_date', startDate)
    }
    if (endDate) {
      query = query.lte('submission_date', `${endDate}T23:59:59.999Z`)
    }
    if (sourceFilter === 'google') {
      query = query.eq('source', 'google')
    } else if (sourceFilter === 'internal') {
      query = query.neq('source', 'google')
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'pendiente') {
        query = query.or('admin_review_status.eq.pendiente,admin_review_status.is.null')
      } else if (statusFilter === 'cerrado') {
        query = query.in('admin_review_status', ['aprobado', 'cerrado', 'closed'])
      } else {
        query = query.eq('admin_review_status', statusFilter)
      }
    }

    const from = (page - 1) * itemsPerPage
    const to = from + itemsPerPage - 1
    query = query.range(from, to)

    const { data: rawFeedback, error, count } = await query
    if (error) throw error

    const feedbacksList = rawFeedback || []
    const feedbackIds = feedbacksList.map((f: any) => f.id)

    const commentCounts: Record<string, number> = {}
    if (feedbackIds.length > 0) {
      const { data: commentsData } = await supabaseAdmin
        .from('feedback_comments')
        .select('feedback_id')
        .in('feedback_id', feedbackIds)

      if (commentsData) {
        for (const c of commentsData) {
          commentCounts[c.feedback_id] = (commentCounts[c.feedback_id] || 0) + 1
        }
      }
    }

    const feedbacks = feedbacksList.map((f: any) => ({
      ...f,
      has_chat: (commentCounts[f.id] || 0) > 0,
    }))

    const rpcStoreId =
      effectiveStoreFilter === 'all' || Number.isNaN(Number(effectiveStoreFilter))
        ? null
        : parseInt(String(effectiveStoreFilter), 10)
    const { data: globalStats } = await supabaseAdmin.rpc('get_feedback_overview', {
      p_store_id: rpcStoreId,
      p_status: statusFilter,
    })

    return NextResponse.json({
      success: true,
      feedbacks,
      totalCount: count || 0,
      globalStats: globalStats || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error consultando feedback' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getServerUser(req)
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const roleLower = String(user.role || '').trim().toLowerCase()
    if (!REVIEW_WRITE_ROLES.has(roleLower)) {
      return NextResponse.json({ error: 'Permisos insuficientes para actualizar feedback' }, { status: 403 })
    }

    const { isGlobal, assignedStoreId } = await resolveAssignedStoreForFeedbackUser(user)
    if (!isGlobal && !assignedStoreId) {
      return NextResponse.json({ error: 'Acceso denegado: tu cuenta no tiene una sucursal asignada.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const feedbackId = body?.id
    const action = body?.action

    if (!feedbackId || !action) {
      return NextResponse.json({ error: 'id y action son requeridos' }, { status: 400 })
    }

    const { data: targetRow, error: fetchErr } = await supabaseAdmin
      .from('customer_feedback')
      .select('id, store_id')
      .eq('id', feedbackId)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!targetRow) {
      return NextResponse.json({ error: 'Evaluación no encontrada' }, { status: 404 })
    }
    if (!isGlobal && Number(targetRow.store_id) !== assignedStoreId) {
      return NextResponse.json(
        { error: 'Acceso denegado: solo puedes gestionar feedback de tu propia sucursal.' },
        { status: 403 }
      )
    }

    if (action === 'toggle_notify_manager') {
      const { error } = await supabaseAdmin
        .from('customer_feedback')
        .update({ notify_manager: Boolean(body.notify_manager) })
        .eq('id', feedbackId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'conclude_review') {
      const nowIso = new Date().toISOString()
      const { error } = await supabaseAdmin
        .from('customer_feedback')
        .update({
          requires_follow_up: false,
          review_status: 'closed',
          admin_review_status: 'closed',
          reviewed_by: user.id,
          reviewed_at: nowIso,
          admin_review_date: nowIso,
        })
        .eq('id', feedbackId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error actualizando feedback' }, { status: 500 })
  }
}
