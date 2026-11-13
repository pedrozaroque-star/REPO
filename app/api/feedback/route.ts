/**
 * @module api/feedback/route
 * @description API privada autenticada para lectura y gestión administrativa de `customer_feedback` en el sistema interno TEG.
 * @businessRules
 * - Exige autenticación corporativa válida (`getServerUser` con `teg_token`). Cero acceso anónimo o desde tokens de clientes de app móvil.
 * - `GET` soporta modos:
 *   * `dashboard`: últimas 500 evaluaciones (filtrables por `startTs`/`endTs`) para métricas NPS en Dashboard.
 *   * `list`: consulta paginada con filtros (`storeFilter`, `statusFilter`, `sourceFilter`, `startDate`, `endDate`, `page`, `itemsPerPage`), conteo de comentarios y RPC `get_feedback_overview`.
 *   * `notify_status`: consulta `notify_manager` para un `id` específico dentro de `FeedbackReviewModal`.
 * - `PATCH` permite únicamente a roles revisores (`admin`, `administrador`, `auditor`, `manager`, `supervisor`, `gerente`) actualizar `notify_manager` o concluir revisión (`conclude_review`) derivando `reviewed_by` exclusivamente desde `user.id` del JWT verificado.
 * @dataFlow Dashboard / Feedback UI / Modal -> `/api/feedback` (`getServerUser`) -> `supabaseAdmin` -> JSON Response.
 * @notes
 * - [2026-11-12] Creado para sustituir consultas directas del navegador sobre `customer_feedback` y permitir eliminar `teg_rls_access_customer_feedback` y `authenticated_select_feedback`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

const STAFF_READ_ROLES = new Set([
  'admin',
  'administrador',
  'auditor',
  'supervisor',
  'manager',
  'gerente',
  'asistente',
  'assistant',
  'shift_leader',
  'cocina',
])

const REVIEW_WRITE_ROLES = new Set([
  'admin',
  'administrador',
  'auditor',
  'supervisor',
  'manager',
  'gerente',
])

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser(req)
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const roleLower = String(user.role || '').toLowerCase()
    if (!STAFF_READ_ROLES.has(roleLower)) {
      return NextResponse.json({ error: 'Acceso denegado para este rol' }, { status: 403 })
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
        .select('notify_manager')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
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

    let query = supabaseAdmin
      .from('customer_feedback')
      .select('*, stores(name,code,city,state,google_place_id)', { count: 'exact' })
      .order('submission_date', { ascending: false })

    if (storeFilter !== 'all') {
      query = query.eq('store_id', storeFilter)
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
      storeFilter === 'all' || Number.isNaN(Number(storeFilter)) ? null : parseInt(storeFilter, 10)
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

    const roleLower = String(user.role || '').toLowerCase()
    if (!REVIEW_WRITE_ROLES.has(roleLower)) {
      return NextResponse.json({ error: 'Permisos insuficientes para actualizar feedback' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const feedbackId = body?.id
    const action = body?.action

    if (!feedbackId || !action) {
      return NextResponse.json({ error: 'id y action son requeridos' }, { status: 400 })
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

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error actualizando feedback' }, { status: 500 })
  }
}
