/**
 * @module api/phone/dashboard
 * @description API administrativa y operativa con RBAC por sucursal para la Contestadora IA Multi-Sucursal (`/admin/llamadas`)
 * y para las alertas de recados prioritarios en la terminal del Manager (`/order-ready-board`).
 *
 * @businessRules
 * - **RBAC Estricto (`authorizePhoneModuleRequest`)**:
 *   * `admin` / `administrador` / `supervisor`: Acceso global a las 15 tiendas, reglas de conocimiento, horarios festivos y configuraciones.
 *   * `manager` / `general_manager` / `asistente`: Acceso aislado exclusivamente a su sucursal asignada (`allowedStoreIds`) para ver llamadas,
 *     consultar reglas y resolver recados telefónicos (`callback_request`).
 * - **Aislamiento de Pruebas (`source = 'twilio'` vs `'simulator'`)**:
 *   * `GET ?callbacksOnly=true` filtra por defecto `source = 'twilio'` para que las pruebas del simulador jamás disparen banners rojos
 *     en las PCs operativas de tienda (`/order-ready-board`). Solo usuarios `isGlobalAdmin` (`Admin`/`Supervisor`) pueden pasar
 *     `?includeSimulator=true` para activar la Vista Previa Admin en `/order-ready-board`.
 * - **KPIs Exactos en Base de Datos**: Calcula conteos reales directamente en PostgreSQL (`count: 'exact'`) sin truncarse al límite
 *   de paginación de la tabla visual, y calcula `resolvedByAiPct` únicamente sobre llamadas con `turns_count > 0`.
 * - **Cero Desvío a Celulares de Gerentes (`allow_live_transfer = false`)**: Por política de Tacos Gavilan, jamás se desvían
 *   llamadas a teléfonos personales de gerentes; `PATCH store_config` fuerza `allow_live_transfer = false` y
 *   `manager_transfer_phone = null`, validando únicamente unicidad E.164 de `twilio_phone_number`.
 *
 * @dataFlow
 * - `/admin/llamadas` o `/order-ready-board` -> `GET / POST / PATCH / DELETE /api/phone/dashboard` -> `supabaseAdmin`.
 *
 * @notes
 * - Incluye acción `dismiss_unanswered` en `PATCH` para descartar preguntas irrelevantes sin ensuciar la Base de Conocimiento,
 *   y soporte completo `PATCH` para `special_hours`.
 * - Blindaje 2026-11-12: limpieza de sesiones colgadas con throttle 5 min en RAM, ordenamiento de recados `pending` por urgencia (`critical`>`high`>`normal`),
 *   `resolvedByAiPct` real sobre llamadas Twilio, validación estricta UUID/fecha/tienda/anti-bucle de `stores.phone` y rechazo 400/409 limpio.
 * - Blindaje 2026-11-17: validación de unicidad `twilio_phone_number` también cuando cambia únicamente `routing_mode` a `direct_twilio`;
 *   atribución de `resolved_by` exclusiva desde sesión autenticada (ignora `resolved_by_name` de cliente); paginación keyset acotada O(log N)
 *   sobre `idx_phone_callbacks_pending_critical_scoped` con tope de seguridad (10,000 registros) y detección explícita de truncamiento
 *   (`callbacksPagination.criticalPendingTruncated` / `pendingTruncated`) para nunca presentar una lista truncada como completa;
 *   y propagación explícita HTTP 500 en el panel.
 * - Blindaje 2026-11-18: el barrido en segundo plano jamás borra tombstones >24h a ciegas; primero reconcilia sesiones colgadas
 *   con tombstones pendientes y depura únicamente los tombstones >24h cuyo cierre ya quedó comprobado en `phone_calls`
 *   (`cleanupOrReconcileExpiredTombstones`), mientras el fallback visual de configuración ausente usa `is_enabled: false`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolvePhoneFemaleVoice } from '@/lib/order-ready-tts'
import {
  authorizePhoneModuleRequest,
  extractPhoneDigits,
  isFictitiousNanpPhone,
  normalizeUsPhoneE164
} from '@/lib/phone-agent-access'
import {
  CarrierType,
  cleanupOrReconcileExpiredTombstones,
  CRITICAL_CALLBACKS_MAX_ROWS,
  cleanPhoneStoreName,
  evaluateStoreSchedulePure,
  fetchScopedCriticalPendingCallbacksWithCap,
  getCarrierForwardingInstructions,
  invalidatePhoneRoutingDirectoryCache,
  invalidateStorePhoneContextCache,
  reconcileCallWithTerminalTombstone
} from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'sfo1'

function sanitizeNestedStore<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object') return row
  if (row.stores && typeof row.stores === 'object' && row.stores.name) {
    return {
      ...row,
      stores: {
        ...row.stores,
        name: cleanPhoneStoreName(row.stores.name)
      }
    }
  }
  return row
}

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_YYYYMMDD_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STALE_SWEEP_INTERVAL_MS = 5 * 60_000
let lastStaleSweepAt = 0

function isRealCalendarDate(dateStr: string): boolean {
  if (!DATE_YYYYMMDD_RE.test(dateStr)) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function parseOptionalStoreIdParam(raw: string | null): { valid: boolean; value: number | null } {
  if (raw === null || raw === '' || raw === 'all') return { valid: true, value: null }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || Math.trunc(n) !== n) return { valid: false, value: null }
  return { valid: true, value: n }
}

function callbackUrgencyRank(u: string | null | undefined): number {
  const norm = String(u || '').toLowerCase()
  if (norm === 'critical') return 0
  if (norm === 'urgent') return 1
  if (norm === 'high') return 2
  if (norm === 'medium') return 3
  if (norm === 'normal') return 4
  return 5
}

export interface CallbacksPaginationMeta {
  criticalPendingCap: number
  criticalPendingReturned: number
  criticalPendingTotal: number
  criticalPendingTruncated: boolean
  nonCriticalPendingCap: number
  pendingReturned: number
  pendingTotal: number
  pendingTruncated: boolean
  hasMorePending: boolean
}

function buildCallbacksPaginationMeta(params: {
  sortedCallbacks: any[]
  criticalCapLimit: number
  criticalCapTruncated: boolean
  criticalExactTotal: number | null
  pendingExactTotal: number | null
  nonCriticalPendingCap: number
  wantsPendingIncluded: boolean
}): CallbacksPaginationMeta {
  const criticalPendingReturned = params.sortedCallbacks.filter(
    (cb: any) => cb?.status === 'pending' && (cb?.urgency === 'critical' || cb?.urgency === 'urgent')
  ).length
  const pendingReturned = params.sortedCallbacks.filter((cb: any) => cb?.status === 'pending').length

  const criticalPendingTotal = params.wantsPendingIncluded
    ? Math.max(criticalPendingReturned, Number(params.criticalExactTotal ?? 0))
    : criticalPendingReturned
  const pendingTotal = params.wantsPendingIncluded
    ? Math.max(pendingReturned, Number(params.pendingExactTotal ?? 0))
    : pendingReturned

  const criticalPendingTruncated = Boolean(
    params.wantsPendingIncluded &&
      (params.criticalCapTruncated || criticalPendingTotal > criticalPendingReturned)
  )
  const pendingTruncated = Boolean(
    params.wantsPendingIncluded &&
      (criticalPendingTruncated || pendingTotal > pendingReturned)
  )

  return {
    criticalPendingCap: params.criticalCapLimit || CRITICAL_CALLBACKS_MAX_ROWS,
    criticalPendingReturned,
    criticalPendingTotal,
    criticalPendingTruncated,
    nonCriticalPendingCap: params.nonCriticalPendingCap,
    pendingReturned,
    pendingTotal,
    pendingTruncated,
    hasMorePending: pendingTruncated
  }
}

function mergeAndSortCallbacks(lists: Array<any[] | null | undefined>): any[] {
  const byId = new Map<string, any>()
  for (const list of lists) {
    for (const row of list || []) {
      if (row && row.id && !byId.has(String(row.id))) {
        byId.set(String(row.id), sanitizeNestedStore(row))
      }
    }
  }
  return Array.from(byId.values()).sort((a: any, b: any) => {
    const aPend = a.status === 'pending' ? 0 : 1
    const bPend = b.status === 'pending' ? 0 : 1
    if (aPend !== bPend) return aPend - bPend
    if (aPend === 0) {
      const ua = callbackUrgencyRank(a.urgency)
      const ub = callbackUrgencyRank(b.urgency)
      if (ua !== ub) return ua - ub
    }
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const callbacksOnly = searchParams.get('callbacksOnly') === 'true'
    const storeIdCheck = parseOptionalStoreIdParam(searchParams.get('storeId'))
    if (!storeIdCheck.valid) {
      return NextResponse.json({ error: 'storeId inválido' }, { status: 400 })
    }
    const parsedStoreParam = storeIdCheck.value

    if (callbacksOnly) {
      const auth = await authorizePhoneModuleRequest(request, {
        permission: 'read_callbacks',
        targetStoreId: parsedStoreParam,
        allowLongLivedStoreTerminal: true
      })
      if (!auth.authorized || !auth.user) {
        return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
      }

      const cbViewer = auth.user
      const includeSim = searchParams.get('includeSimulator') === 'true' && cbViewer.isGlobalAdmin
      const statusFilter = searchParams.get('status')

      const applyCbScope = (q: any) => {
        if (!includeSim) {
          q = q.eq('source', 'twilio')
        }
        if (parsedStoreParam && Number.isFinite(parsedStoreParam)) {
          q = q.eq('store_id', parsedStoreParam)
        } else if (!cbViewer.isGlobalAdmin) {
          q = q.in('store_id', cbViewer.allowedStoreIds)
        }
        return q
      }

      const buildScopedCbQuery = () =>
        applyCbScope(supabaseAdmin.from('phone_callback_requests').select('*, stores(id, name)'))

      const buildScopedCbCountQuery = () =>
        applyCbScope(supabaseAdmin.from('phone_callback_requests').select('id', { count: 'exact', head: true }))

      const wantsPendingIncluded = !statusFilter || statusFilter === 'pending'
      const [
        criticalPendingRes,
        pendingBatchRes,
        recentCbRes,
        scopedCriticalCountRes,
        scopedPendingCountRes
      ] = await Promise.all([
        wantsPendingIncluded
          ? fetchScopedCriticalPendingCallbacksWithCap(buildScopedCbQuery)
          : Promise.resolve({
              data: [] as any[],
              error: null,
              truncated: false,
              capLimit: CRITICAL_CALLBACKS_MAX_ROWS,
              pagesFetched: 0
            }),
        wantsPendingIncluded
          ? buildScopedCbQuery()
              .eq('status', 'pending')
              .not('urgency', 'in', '("critical","urgent")')
              .order('created_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] as any[], error: null }),
        (() => {
          let q = buildScopedCbQuery()
          if (statusFilter) q = q.eq('status', statusFilter)
          return q.order('created_at', { ascending: false }).limit(50)
        })(),
        wantsPendingIncluded
          ? buildScopedCbCountQuery().eq('status', 'pending').in('urgency', ['critical', 'urgent'])
          : Promise.resolve({ count: 0, error: null }),
        wantsPendingIncluded
          ? buildScopedCbCountQuery().eq('status', 'pending')
          : Promise.resolve({ count: 0, error: null })
      ])

      const cbQueryErr =
        criticalPendingRes.error ||
        pendingBatchRes.error ||
        recentCbRes.error ||
        scopedCriticalCountRes.error ||
        scopedPendingCountRes.error
      if (cbQueryErr) {
        return NextResponse.json(
          { error: `Error al consultar recados telefónicos: ${cbQueryErr.message}` },
          { status: 500 }
        )
      }

      const sortedCallbacks = mergeAndSortCallbacks([
        criticalPendingRes.data,
        pendingBatchRes.data,
        recentCbRes.data
      ])
      const callbacksPagination = buildCallbacksPaginationMeta({
        sortedCallbacks,
        criticalCapLimit: criticalPendingRes.capLimit,
        criticalCapTruncated: criticalPendingRes.truncated,
        criticalExactTotal: scopedCriticalCountRes.count ?? 0,
        pendingExactTotal: scopedPendingCountRes.count ?? 0,
        nonCriticalPendingCap: 100,
        wantsPendingIncluded
      })
      return NextResponse.json({ callbacks: sortedCallbacks, callbacksPagination })
    }

    // Filtros independientes de la pestaña Bitácora (Tab 4): no alteran los KPIs globales ni las preguntas de Tab 2
    const callsStoreCheck = parseOptionalStoreIdParam(searchParams.get('callsStoreId') ?? searchParams.get('storeId'))
    if (!callsStoreCheck.valid) {
      return NextResponse.json({ error: 'callsStoreId inválido' }, { status: 400 })
    }
    const filterCallsStoreId = callsStoreCheck.value
    const callsSourceFilter = searchParams.get('callsSource') || 'all'

    const auth = await authorizePhoneModuleRequest(request, {
      permission: 'read_dashboard',
      targetStoreId: filterCallsStoreId
    })
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    }

    const viewer = auth.user
    const scopeStoreIds = viewer.isGlobalAdmin ? null : viewer.allowedStoreIds

    const applyStoreScope = <Q extends { eq: any; in: any }>(q: Q, explicitStoreId?: number | null): Q => {
      if (explicitStoreId && Number.isFinite(explicitStoreId)) {
        return q.eq('store_id', explicitStoreId)
      }
      if (scopeStoreIds) {
        return q.in('store_id', scopeStoreIds)
      }
      return q
    }

    // Cerrar automáticamente sesiones huérfanas (> 25 min en `in_progress`) con throttle cada 5 min sin perder cierres pendientes
    const sweepNow = Date.now()
    if (sweepNow - lastStaleSweepAt >= STALE_SWEEP_INTERVAL_MS) {
      lastStaleSweepAt = sweepNow
      const staleCutoffIso = new Date(sweepNow - 25 * 60 * 1000).toISOString()
      const oldTombstoneCutoffIso = new Date(sweepNow - 24 * 60 * 60 * 1000).toISOString()
      void (async () => {
        try {
          const { data: staleCalls } = await supabaseAdmin
            .from('phone_calls')
            .select('call_sid')
            .eq('status', 'in_progress')
            .lt('started_at', staleCutoffIso)
            .limit(100)
          if (Array.isArray(staleCalls) && staleCalls.length > 0) {
            for (const sc of staleCalls) {
              if (sc?.call_sid) {
                await reconcileCallWithTerminalTombstone(sc.call_sid).catch(() => null)
              }
            }
          }
          await supabaseAdmin
            .from('phone_calls')
            .update({ status: 'completed', ended_at: new Date(sweepNow).toISOString() })
            .eq('status', 'in_progress')
            .lt('started_at', staleCutoffIso)
          await cleanupOrReconcileExpiredTombstones({ olderThanIso: oldTombstoneCutoffIso })
        } catch {
          // Ignorar errores transitorios en barrido de mantenimiento; todo tombstone pendiente permanece intacto
        }
      })()
    }

    const [
      storesRes,
      configsRes,
      kbRes,
      specialRes,
      callsRes,
      callbacksRes,
      pendingCriticalCbRes,
      pendingAllCbRes,
      unansweredRes,
      realCallsCountRes,
      realEvaluatedCallsCountRes,
      simCallsCountRes,
      evaluatedCallsCountRes,
      resolvedCallsCountRes,
      realResolvedCallsCountRes,
      pendingRealCbCountRes,
      pendingSimCbCountRes,
      scopedCriticalCbCountRes,
      scopedPendingCbCountRes
    ] = await Promise.all([
      (() => {
        let q = supabaseAdmin
          .from('stores')
          .select('id, name, address, phone, has_drive_thru, weekly_hours, is_active')
          .order('id', { ascending: true })
        if (scopeStoreIds) {
          q = q.in('id', scopeStoreIds)
        }
        return q
      })(),
      (() => {
        let q = supabaseAdmin.from('phone_agent_config').select('*').order('store_id', { ascending: true })
        if (scopeStoreIds) q = q.in('store_id', scopeStoreIds)
        return q
      })(),
      supabaseAdmin
        .from('phone_knowledge_base')
        .select('*, stores(id, name)')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('phone_special_hours')
        .select('*, stores(id, name)')
        .order('event_date', { ascending: true }),
      (() => {
        let q = supabaseAdmin
          .from('phone_calls')
          .select('*, stores(id, name)')
          .order('started_at', { ascending: false })
          .limit(150)
        q = applyStoreScope(q, filterCallsStoreId)
        if (callsSourceFilter === 'twilio' || callsSourceFilter === 'simulator') {
          q = q.eq('source', callsSourceFilter)
        }
        return q
      })(),
      (() => {
        let q = supabaseAdmin
          .from('phone_callback_requests')
          .select('*, stores(id, name)')
          .order('created_at', { ascending: false })
          .limit(120)
        q = applyStoreScope(q, filterCallsStoreId)
        if (callsSourceFilter === 'twilio' || callsSourceFilter === 'simulator') {
          q = q.eq('source', callsSourceFilter)
        }
        return q
      })(),
      fetchScopedCriticalPendingCallbacksWithCap(() => {
        let q = supabaseAdmin.from('phone_callback_requests').select('*, stores(id, name)')
        q = applyStoreScope(q, filterCallsStoreId)
        if (callsSourceFilter === 'twilio' || callsSourceFilter === 'simulator') {
          q = q.eq('source', callsSourceFilter)
        }
        return q
      }),
      (() => {
        let q = supabaseAdmin
          .from('phone_callback_requests')
          .select('*, stores(id, name)')
          .eq('status', 'pending')
          .not('urgency', 'in', '("critical","urgent")')
          .order('created_at', { ascending: false })
          .limit(120)
        q = applyStoreScope(q, filterCallsStoreId)
        if (callsSourceFilter === 'twilio' || callsSourceFilter === 'simulator') {
          q = q.eq('source', callsSourceFilter)
        }
        return q
      })(),
      (() => {
        let q = supabaseAdmin
          .from('phone_calls')
          .select('id, store_id, unanswered_question, caller_number, started_at, source, stores(id, name)')
          .not('unanswered_question', 'is', null)
          .order('started_at', { ascending: false })
          .limit(50)
        q = applyStoreScope(q, null)
        return q
      })(),
      applyStoreScope(
        supabaseAdmin.from('phone_calls').select('id', { count: 'exact', head: true }).eq('source', 'twilio'),
        null
      ),
      applyStoreScope(
        supabaseAdmin.from('phone_calls').select('id', { count: 'exact', head: true }).eq('source', 'twilio').gt('turns_count', 0),
        null
      ),
      applyStoreScope(
        supabaseAdmin.from('phone_calls').select('id', { count: 'exact', head: true }).eq('source', 'simulator'),
        null
      ),
      applyStoreScope(
        supabaseAdmin.from('phone_calls').select('id', { count: 'exact', head: true }).gt('turns_count', 0),
        null
      ),
      applyStoreScope(
        supabaseAdmin
          .from('phone_calls')
          .select('id', { count: 'exact', head: true })
          .gt('turns_count', 0)
          .eq('resolved_by_ai', true),
        null
      ),
      applyStoreScope(
        supabaseAdmin
          .from('phone_calls')
          .select('id', { count: 'exact', head: true })
          .eq('source', 'twilio')
          .gt('turns_count', 0)
          .eq('resolved_by_ai', true),
        null
      ),
      applyStoreScope(
        supabaseAdmin
          .from('phone_callback_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('source', 'twilio'),
        null
      ),
      applyStoreScope(
        supabaseAdmin
          .from('phone_callback_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .eq('source', 'simulator'),
        null
      ),
      (() => {
        let q = supabaseAdmin
          .from('phone_callback_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .in('urgency', ['critical', 'urgent'])
        q = applyStoreScope(q, filterCallsStoreId)
        if (callsSourceFilter === 'twilio' || callsSourceFilter === 'simulator') {
          q = q.eq('source', callsSourceFilter)
        }
        return q
      })(),
      (() => {
        let q = supabaseAdmin
          .from('phone_callback_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
        q = applyStoreScope(q, filterCallsStoreId)
        if (callsSourceFilter === 'twilio' || callsSourceFilter === 'simulator') {
          q = q.eq('source', callsSourceFilter)
        }
        return q
      })()
    ])

    const dashboardChecks: Array<[string, any]> = [
      ['stores', storesRes.error],
      ['phone_agent_config', configsRes.error],
      ['phone_knowledge_base', kbRes.error],
      ['phone_special_hours', specialRes.error],
      ['phone_calls', callsRes.error],
      ['phone_callback_requests', callbacksRes.error],
      ['pending_critical_callbacks', pendingCriticalCbRes.error],
      ['pending_callbacks', pendingAllCbRes.error],
      ['unanswered_questions', unansweredRes.error],
      ['kpi_real_calls', realCallsCountRes.error],
      ['kpi_real_evaluated_calls', realEvaluatedCallsCountRes.error],
      ['kpi_simulator_calls', simCallsCountRes.error],
      ['kpi_evaluated_calls', evaluatedCallsCountRes.error],
      ['kpi_resolved_calls', resolvedCallsCountRes.error],
      ['kpi_real_resolved_calls', realResolvedCallsCountRes.error],
      ['kpi_pending_real_callbacks', pendingRealCbCountRes.error],
      ['kpi_pending_simulator_callbacks', pendingSimCbCountRes.error],
      ['scoped_critical_callbacks_count', scopedCriticalCbCountRes.error],
      ['scoped_pending_callbacks_count', scopedPendingCbCountRes.error]
    ]
    const failedQuery = dashboardChecks.find(([, err]) => Boolean(err))
    if (failedQuery) {
      const [label, qErr] = failedQuery
      console.error(`[api/phone/dashboard] Query failed (${label}):`, qErr)
      return NextResponse.json(
        { error: `Error en consulta del panel (${label}): ${qErr.message || String(qErr)}` },
        { status: 500 }
      )
    }

    const stores = (storesRes.data || []).filter((s: any) => s.is_active !== false)
    const configs = configsRes.data || []
    const specialHours = (specialRes.data || []).map(sanitizeNestedStore)
    const configByStore = new Map<number, any>()
    for (const c of configs) {
      configByStore.set(c.store_id, c)
    }

    const storeRows = stores.map((s: any) => {
      const cleanName = cleanPhoneStoreName(s.name)
      const cfg = configByStore.get(s.id) || {
        store_id: s.id,
        is_enabled: false,
        routing_mode: 'conditional_forward',
        carrier_type: [1, 8, 14, 16].includes(s.id) ? 'spectrum_landline' : 'att_wireless',
        twilio_phone_number: null,
        forwarding_status: 'pending',
        ring_timeout_seconds: 20,
        voice_id: 'Kore',
        default_language: 'es',
        custom_greeting_es: null,
        custom_greeting_en: null,
        manager_transfer_phone: null,
        allow_live_transfer: false,
        accepts_ebt: ![1, 9].includes(s.id),
        parking_notes_es: null,
        parking_notes_en: null
      }

      const scheduleEval = evaluateStoreSchedulePure({
        storeId: s.id,
        storeName: cleanName,
        weeklyHours: s.weekly_hours,
        specialHours
      })

      const forwardingGuide = getCarrierForwardingInstructions(
        (cfg.carrier_type || 'att_wireless') as CarrierType,
        cfg.twilio_phone_number,
        Number(cfg.ring_timeout_seconds || 20),
        { storePhones: stores.map((st: any) => st.phone).filter(Boolean) }
      )

      return {
        ...s,
        name: cleanName,
        config: {
          ...cfg,
          voice_id: resolvePhoneFemaleVoice(cfg.voice_id)
        },
        scheduleEval,
        forwardingGuide
      }
    })

    const calls = (callsRes.data || []).map(sanitizeNestedStore)
    const callbacks = mergeAndSortCallbacks([
      pendingCriticalCbRes.data,
      pendingAllCbRes.data,
      callbacksRes.data
    ])
    const callbacksPagination = buildCallbacksPaginationMeta({
      sortedCallbacks: callbacks,
      criticalCapLimit: pendingCriticalCbRes.capLimit,
      criticalCapTruncated: pendingCriticalCbRes.truncated,
      criticalExactTotal: scopedCriticalCbCountRes.count ?? 0,
      pendingExactTotal: scopedPendingCbCountRes.count ?? 0,
      nonCriticalPendingCap: 120,
      wantsPendingIncluded: true
    })

    const realCallsCount = Number(realCallsCountRes.count || 0)
    const realEvaluatedCallsCount = Number(realEvaluatedCallsCountRes.count || 0)
    const simulatorCallsCount = Number(simCallsCountRes.count || 0)
    const totalCalls = realCallsCount + simulatorCallsCount
    const evaluatedCallsCount = Number(evaluatedCallsCountRes.count || 0)
    const resolvedByAiCount = Number(resolvedCallsCountRes.count || 0)
    const realResolvedByAiCount = Number(realResolvedCallsCountRes.count || 0)
    const resolvedByAiPct =
      realEvaluatedCallsCount > 0
        ? Math.round((realResolvedByAiCount / realEvaluatedCallsCount) * 1000) / 10
        : realCallsCount > 0
          ? 0
          : evaluatedCallsCount > 0
            ? Math.round((resolvedByAiCount / evaluatedCallsCount) * 1000) / 10
            : 0
    const pendingCallbacksCount = Number(pendingRealCbCountRes.count || 0)
    const pendingSimulatorCallbacksCount = Number(pendingSimCbCountRes.count || 0)
    const estimatedCashierMinutesSaved = Math.round(
      (realCallsCount > 0 ? realResolvedByAiCount : resolvedByAiCount) * 1.5
    )

    const unansweredQuestions = (unansweredRes.data || [])
      .filter((c: any) => c.unanswered_question && String(c.unanswered_question).trim().length > 0)
      .map((c: any) => ({
        callId: c.id,
        storeId: c.store_id,
        storeName: cleanPhoneStoreName((c.stores as any)?.name) || `#${c.store_id}`,
        question: c.unanswered_question,
        callerNumber: c.caller_number,
        source: c.source || 'twilio',
        startedAt: c.started_at
      }))

    const visibleKnowledgeBase = (kbRes.data || [])
      .filter((kb: any) => !scopeStoreIds || kb.store_id === null || scopeStoreIds.includes(Number(kb.store_id)))
      .map(sanitizeNestedStore)

    const visibleSpecialHours = specialHours.filter(
      (sh: any) => !scopeStoreIds || sh.store_id === null || scopeStoreIds.includes(Number(sh.store_id))
    )

    return NextResponse.json({
      viewer: {
        id: viewer.id,
        name: viewer.name,
        email: viewer.email,
        role: viewer.role,
        isGlobalAdmin: viewer.isGlobalAdmin,
        assignedStoreId: viewer.assignedStoreId,
        allowedStoreIds: viewer.allowedStoreIds
      },
      stores: storeRows,
      knowledgeBase: visibleKnowledgeBase,
      specialHours: visibleSpecialHours,
      calls,
      callbacks,
      callbacksPagination,
      unansweredQuestions,
      twilioIntegration: {
        authTokenConfigured: Boolean(process.env.TWILIO_AUTH_TOKEN?.trim()),
        accountSidConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim()),
        defaultPilotStoreId: process.env.TWILIO_DEFAULT_STORE_ID ? Number(process.env.TWILIO_DEFAULT_STORE_ID) : null,
        sharedPilotAllowed: true
      },
      kpis: {
        totalCalls,
        realCallsCount,
        realEvaluatedCallsCount,
        simulatorCallsCount,
        evaluatedCallsCount,
        resolvedByAiCount,
        realResolvedByAiCount,
        resolvedByAiPct,
        pendingCallbacksCount,
        pendingSimulatorCallbacksCount,
        estimatedCashierMinutesSaved,
        activeStoresCount: storeRows.filter((s: any) => s.config.is_enabled).length,
        verifiedForwardingCount: storeRows.filter((s: any) => s.config.forwarding_status === 'verified').length
      }
    })
  } catch (err: any) {
    console.error('[api/phone/dashboard] GET Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al cargar dashboard telefónico' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'manage_global' })
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 })
    }
    const entity = String(body?.entity || '')

    const parseStoreFk = async (raw: any): Promise<{ ok: true; storeId: number | null } | { ok: false; res: NextResponse }> => {
      if (raw === null || raw === undefined || raw === '') return { ok: true, storeId: null }
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0 || Math.trunc(n) !== n) {
        return { ok: false, res: NextResponse.json({ error: 'store_id inválido' }, { status: 400 }) }
      }
      const { data: st, error: stErr } = await supabaseAdmin.from('stores').select('id').eq('id', n).maybeSingle()
      if (stErr) {
        return { ok: false, res: NextResponse.json({ error: `Error validando sucursal: ${stErr.message}` }, { status: 500 }) }
      }
      if (!st) {
        return { ok: false, res: NextResponse.json({ error: `Sucursal #${n} no existe` }, { status: 404 }) }
      }
      return { ok: true, storeId: n }
    }

    if (entity === 'knowledge_base') {
      const fk = await parseStoreFk(body?.store_id)
      if (!fk.ok) return fk.res
      const storeId = fk.storeId
      const category = String(body?.category || 'general').trim().slice(0, 80) || 'general'
      const title = String(body?.title || '').trim().slice(0, 180)
      const questionKeywords = body?.question_keywords ? String(body.question_keywords).trim().slice(0, 500) : null
      const answerEs = String(body?.answer_es || '').trim().slice(0, 1500)
      // Si no se captura traducción al inglés, se guarda cadena vacía (Gemini traduce en vivo desde answer_es)
      const answerEn = body?.answer_en ? String(body.answer_en).trim().slice(0, 1500) : ''
      const priority = Number.isFinite(Number(body?.priority))
        ? Math.max(0, Math.min(1000, Math.round(Number(body.priority))))
        : 50

      if (!title || !answerEs) {
        return NextResponse.json({ error: 'Título y respuesta en español son obligatorios' }, { status: 400 })
      }

      const { data: created, error } = await supabaseAdmin
        .from('phone_knowledge_base')
        .insert({
          store_id: storeId,
          category,
          title,
          question_keywords: questionKeywords,
          answer_es: answerEs,
          answer_en: answerEn,
          is_active: true,
          priority
        })
        .select('*, stores(id, name)')
        .single()

      if (error) throw error
      invalidateStorePhoneContextCache()

      if (body?.resolveCallId && UUID_RE.test(String(body.resolveCallId))) {
        await supabaseAdmin
          .from('phone_calls')
          .update({ unanswered_question: null })
          .eq('id', String(body.resolveCallId))
      }

      return NextResponse.json({ ok: true, item: sanitizeNestedStore(created) })
    }

    if (entity === 'special_hours') {
      const fk = await parseStoreFk(body?.store_id)
      if (!fk.ok) return fk.res
      const storeId = fk.storeId
      const eventDate = String(body?.event_date || '').trim()
      const holidayName = String(body?.holiday_name || '').trim().slice(0, 140)
      const isClosed = Boolean(body?.is_closed)
      const rawOpen = body?.open_time ? String(body.open_time).trim().slice(0, 5) : ''
      const rawClose = body?.close_time ? String(body.close_time).trim().slice(0, 5) : ''
      const openTime = isClosed ? null : rawOpen || null
      const closeTime = isClosed ? null : rawClose || null

      if (!isRealCalendarDate(eventDate) || !holidayName) {
        return NextResponse.json({ error: 'Fecha calendario válida (YYYY-MM-DD) y nombre del día festivo son requeridos' }, { status: 400 })
      }
      if (!isClosed && !openTime && !closeTime) {
        return NextResponse.json(
          { error: 'Indica al menos la hora de apertura especial o la hora de cierre especial' },
          { status: 400 }
        )
      }
      if ((openTime && !TIME_HHMM_RE.test(openTime)) || (closeTime && !TIME_HHMM_RE.test(closeTime))) {
        return NextResponse.json({ error: 'Formato de hora inválido (usa HH:MM en 24h)' }, { status: 400 })
      }

      const payload = {
        store_id: storeId,
        event_date: eventDate,
        holiday_name: holidayName,
        is_closed: isClosed,
        open_time: openTime,
        close_time: closeTime,
        notes_es: body?.notes_es || null,
        notes_en: body?.notes_en || null
      }

      const findExisting = async () => {
        let q = supabaseAdmin.from('phone_special_hours').select('id').eq('event_date', eventDate)
        q = storeId === null ? q.is('store_id', null) : q.eq('store_id', storeId)
        const { data, error: findErr } = await q.limit(1).maybeSingle()
        if (findErr) throw findErr
        return data
      }

      const existingMatch = await findExisting()
      let saved: any = null
      let saveErr: any = null

      if (existingMatch?.id) {
        const res = await supabaseAdmin
          .from('phone_special_hours')
          .update(payload)
          .eq('id', existingMatch.id)
          .select('*, stores(id, name)')
          .single()
        saved = res.data
        saveErr = res.error
      } else {
        const res = await supabaseAdmin
          .from('phone_special_hours')
          .insert(payload)
          .select('*, stores(id, name)')
          .single()
        if (res.error?.code === '23505') {
          const raceMatch = await findExisting()
          if (raceMatch?.id) {
            const retry = await supabaseAdmin
              .from('phone_special_hours')
              .update(payload)
              .eq('id', raceMatch.id)
              .select('*, stores(id, name)')
              .single()
            saved = retry.data
            saveErr = retry.error
          } else {
            saveErr = res.error
          }
        } else {
          saved = res.data
          saveErr = res.error
        }
      }

      if (saveErr) throw saveErr
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true, item: sanitizeNestedStore(saved) })
    }

    return NextResponse.json({ error: 'Entidad POST no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[api/phone/dashboard] POST Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al guardar registro' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 })
    }
    const entity = String(body?.entity || '')

    if (entity === 'callback_request') {
      const id = String(body?.id || '').trim()
      if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: 'ID de recado inválido' }, { status: 400 })
      }

      const { data: existingCb, error: fetchErr } = await supabaseAdmin
        .from('phone_callback_requests')
        .select('id, store_id, status')
        .eq('id', id)
        .maybeSingle()

      if (fetchErr) throw fetchErr
      if (!existingCb) {
        return NextResponse.json({ error: 'Recado telefónico no encontrado' }, { status: 404 })
      }

      const auth = await authorizePhoneModuleRequest(request, {
        permission: 'resolve_callback',
        targetStoreId: Number(existingCb.store_id),
        allowLongLivedStoreTerminal: true
      })
      if (!auth.authorized || !auth.user) {
        return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 403 })
      }

      const allowedStatuses = new Set(['pending', 'resolved', 'dismissed'])
      const rawStatus = String(body?.status || 'resolved').trim().toLowerCase()
      const status = allowedStatuses.has(rawStatus) ? rawStatus : 'resolved'

      // Seguridad anti-suplantación: atribuir exclusivamente al usuario autenticado de la sesión (ignorar body.resolved_by_name)
      const resolverIdentity = String(auth.user.name || auth.user.email || 'Manager').trim().slice(0, 120)
      const updates: Record<string, any> = {
        status,
        resolved_by: status === 'pending' ? null : resolverIdentity,
        resolved_at: status === 'pending' ? null : new Date().toISOString()
      }
      if (body?.resolution_notes !== undefined) {
        updates.resolution_notes = body.resolution_notes ? String(body.resolution_notes).trim().slice(0, 1000) : null
      }

      const { data: updated, error } = await supabaseAdmin
        .from('phone_callback_requests')
        .update(updates)
        .eq('id', id)
        .select('*, stores(id, name)')
        .single()

      if (error) throw error
      return NextResponse.json({ ok: true, callback: sanitizeNestedStore(updated) })
    }

    // Todas las demás mutaciones administrativas exigen rol global (`admin` / `administrador` / `supervisor`)
    const auth = await authorizePhoneModuleRequest(request, { permission: 'manage_global' })
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 403 })
    }

    if (entity === 'dismiss_unanswered') {
      const callId = String(body?.callId || body?.id || '').trim()
      if (!UUID_RE.test(callId)) {
        return NextResponse.json({ error: 'callId inválido' }, { status: 400 })
      }
      const { error } = await supabaseAdmin
        .from('phone_calls')
        .update({ unanswered_question: null })
        .eq('id', callId)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (entity === 'store_config') {
      const storeId = Number(body?.store_id)
      if (!Number.isFinite(storeId) || storeId <= 0) {
        return NextResponse.json({ error: 'store_id inválido' }, { status: 400 })
      }

      const [allStoresRes, allConfigsRes] = await Promise.all([
        supabaseAdmin.from('stores').select('id, name, phone'),
        supabaseAdmin.from('phone_agent_config').select('*')
      ])
      if (allStoresRes.error) throw allStoresRes.error
      if (allConfigsRes.error) throw allConfigsRes.error
      const allStores = allStoresRes.data || []
      const allConfigs = allConfigsRes.data || []

      const storeExists = (allStores || []).some((s: any) => Number(s.id) === storeId)
      if (!storeExists) {
        return NextResponse.json({ error: `Sucursal #${storeId} no existe` }, { status: 404 })
      }

      const prevCfg = (allConfigs || []).find((c: any) => Number(c.store_id) === storeId) || null

      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
        updated_by: auth.user.email || String(auth.user.id || 'admin')
      }

      if (body.is_enabled !== undefined) updates.is_enabled = Boolean(body.is_enabled)
      if (body.routing_mode !== undefined) {
        updates.routing_mode = body.routing_mode === 'direct_twilio' ? 'direct_twilio' : 'conditional_forward'
      }
      if (body.carrier_type !== undefined) {
        updates.carrier_type = body.carrier_type === 'spectrum_landline' ? 'spectrum_landline' : 'att_wireless'
      }
      if (body.ring_timeout_seconds !== undefined) {
        const r = Number(body.ring_timeout_seconds)
        updates.ring_timeout_seconds = Number.isFinite(r) ? Math.min(30, Math.max(5, Math.round(r / 5) * 5)) : 20
      }
      if (body.voice_id !== undefined) {
        updates.voice_id = resolvePhoneFemaleVoice(body.voice_id)
      }
      if (body.default_language !== undefined) {
        updates.default_language = body.default_language === 'en' ? 'en' : 'es'
      }
      if (body.accepts_ebt !== undefined) updates.accepts_ebt = Boolean(body.accepts_ebt)
      // Política estricta de Tacos Gavilan: nunca desviar llamadas a teléfonos personales de gerentes
      updates.allow_live_transfer = false
      updates.manager_transfer_phone = null

      for (const textField of ['custom_greeting_es', 'custom_greeting_en', 'parking_notes_es', 'parking_notes_en'] as const) {
        if (body[textField] !== undefined) {
          const v = String(body[textField] ?? '').trim()
          updates[textField] = v ? v.slice(0, 700) : null
        }
      }

      // Validar y normalizar `twilio_phone_number` + unicidad entre las 15 tiendas (incluyendo cuando cambia solo `routing_mode` a `direct_twilio`)
      const effectiveRoutingMode = updates.routing_mode || prevCfg?.routing_mode || 'conditional_forward'
      const candidateTwilioRaw =
        body.twilio_phone_number !== undefined ? body.twilio_phone_number : prevCfg?.twilio_phone_number ?? null
      let effectiveTwilioPhone: string | null = prevCfg?.twilio_phone_number || null

      const shouldValidateTwilio =
        body.twilio_phone_number !== undefined ||
        (body.routing_mode !== undefined && candidateTwilioRaw !== null && String(candidateTwilioRaw).trim() !== '')

      if (shouldValidateTwilio) {
        const parsedTw = normalizeUsPhoneE164(candidateTwilioRaw)
        if (!parsedTw.valid) {
          return NextResponse.json({ error: `Número Twilio inválido: ${parsedTw.error}` }, { status: 400 })
        }
        if (parsedTw.tenDigits && isFictitiousNanpPhone(parsedTw.tenDigits, false)) {
          return NextResponse.json(
            { error: 'El número Twilio no puede ser ficticio (ej. 555-xxxx o dígitos repetidos).' },
            { status: 400 }
          )
        }
        if (parsedTw.tenDigits) {
          const storeConflict = allStores.find(
            (s: any) => s.phone && extractPhoneDigits(s.phone).slice(-10) === parsedTw.tenDigits
          )
          if (storeConflict) {
            return NextResponse.json(
              {
                error: `El número Twilio no puede coincidir con la línea pública de la sucursal ${storeConflict.name || '#' + storeConflict.id}.`
              },
              { status: 400 }
            )
          }
          const duplicateDirectCfg = allConfigs.find(
            (c: any) =>
              Number(c.store_id) !== storeId &&
              c.twilio_phone_number &&
              extractPhoneDigits(c.twilio_phone_number).slice(-10) === parsedTw.tenDigits &&
              (effectiveRoutingMode === 'direct_twilio' || c.routing_mode === 'direct_twilio')
          )
          if (duplicateDirectCfg) {
            return NextResponse.json(
              {
                error: `Ese número Twilio ya está asignado a la sucursal #${duplicateDirectCfg.store_id} y el modo directo (direct_twilio) exige un número exclusivo por tienda. Para compartir un número piloto usa Desvío Condicional (ForwardedFrom).`
              },
              { status: 409 }
            )
          }
        }
        effectiveTwilioPhone = parsedTw.normalized

        if (body.twilio_phone_number !== undefined) {
          updates.twilio_phone_number = parsedTw.normalized
          const prevDigits = extractPhoneDigits(prevCfg?.twilio_phone_number).slice(-10)
          const nextDigits = parsedTw.tenDigits || ''
          if (!effectiveTwilioPhone || nextDigits !== prevDigits) {
            updates.forwarding_status = 'pending'
            updates.forwarding_verified_at = null
          }
        }
      }

      if (body.forwarding_status !== undefined && updates.forwarding_status !== 'pending') {
        if (body.forwarding_status === 'verified') {
          const twCheck = normalizeUsPhoneE164(effectiveTwilioPhone)
          const storeSelfConflict =
            twCheck.tenDigits &&
            allStores.some((s: any) => s.phone && extractPhoneDigits(s.phone).slice(-10) === twCheck.tenDigits)
          if (
            !twCheck.valid ||
            !twCheck.normalized ||
            !twCheck.tenDigits ||
            isFictitiousNanpPhone(twCheck.tenDigits, false) ||
            storeSelfConflict
          ) {
            return NextResponse.json(
              { error: 'Primero guarda un número Twilio real válido de 10 dígitos de EE. UU. antes de marcar el desvío como verificado.' },
              { status: 400 }
            )
          }
          updates.forwarding_status = 'verified'
          updates.forwarding_verified_at = new Date().toISOString()
        } else {
          updates.forwarding_status = 'pending'
          updates.forwarding_verified_at = null
        }
      }

      const { data: updated, error } = await supabaseAdmin
        .from('phone_agent_config')
        .upsert({ store_id: storeId, ...updates }, { onConflict: 'store_id' })
        .select()
        .single()

      if (error) throw error
      invalidateStorePhoneContextCache(storeId)
      invalidatePhoneRoutingDirectoryCache()
      return NextResponse.json({ ok: true, config: updated })
    }

    if (entity === 'knowledge_base') {
      const id = String(body?.id || '').trim()
      if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: 'ID de regla inválido' }, { status: 400 })
      }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (body.store_id !== undefined) {
        if (body.store_id === null || body.store_id === '') {
          updates.store_id = null
        } else {
          const n = Number(body.store_id)
          if (!Number.isFinite(n) || n <= 0 || Math.trunc(n) !== n) {
            return NextResponse.json({ error: 'store_id inválido' }, { status: 400 })
          }
          const { data: stExists, error: stLookupErr } = await supabaseAdmin.from('stores').select('id').eq('id', n).maybeSingle()
          if (stLookupErr) throw stLookupErr
          if (!stExists) {
            return NextResponse.json({ error: `Sucursal #${n} no existe` }, { status: 404 })
          }
          updates.store_id = n
        }
      }
      if (body.category !== undefined) updates.category = String(body.category || 'general').trim().slice(0, 80) || 'general'
      if (body.title !== undefined) {
        const t = String(body.title || '').trim().slice(0, 180)
        if (!t) return NextResponse.json({ error: 'El título de la regla no puede quedar vacío' }, { status: 400 })
        updates.title = t
      }
      if (body.question_keywords !== undefined) {
        updates.question_keywords = body.question_keywords ? String(body.question_keywords).trim().slice(0, 500) : null
      }
      if (body.answer_es !== undefined) {
        const aes = String(body.answer_es || '').trim().slice(0, 1500)
        if (!aes) return NextResponse.json({ error: 'La respuesta en español no puede quedar vacía' }, { status: 400 })
        updates.answer_es = aes
      }
      if (body.answer_en !== undefined) updates.answer_en = body.answer_en ? String(body.answer_en).trim().slice(0, 1500) : ''
      if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active)
      if (body.priority !== undefined && Number.isFinite(Number(body.priority))) {
        updates.priority = Math.max(0, Math.min(1000, Math.round(Number(body.priority))))
      }

      const { data: updated, error } = await supabaseAdmin
        .from('phone_knowledge_base')
        .update(updates)
        .eq('id', id)
        .select('*, stores(id, name)')
        .single()

      if (error) {
        if (error.code === 'PGRST116') return NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 })
        throw error
      }
      invalidateStorePhoneContextCache()

      if (body?.resolveCallId && UUID_RE.test(String(body.resolveCallId))) {
        await supabaseAdmin
          .from('phone_calls')
          .update({ unanswered_question: null })
          .eq('id', String(body.resolveCallId))
      }

      return NextResponse.json({ ok: true, item: sanitizeNestedStore(updated) })
    }

    if (entity === 'special_hours') {
      const id = String(body?.id || '').trim()
      if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: 'ID de horario festivo inválido' }, { status: 400 })
      }

      const { data: currentSh, error: shFetchErr } = await supabaseAdmin
        .from('phone_special_hours')
        .select('id, is_closed, open_time, close_time, holiday_name')
        .eq('id', id)
        .maybeSingle()
      if (shFetchErr) throw shFetchErr
      if (!currentSh) return NextResponse.json({ error: 'Horario festivo no encontrado' }, { status: 404 })

      const updates: Record<string, any> = {}
      if (body.store_id !== undefined) {
        if (body.store_id === null || body.store_id === '') {
          updates.store_id = null
        } else {
          const n = Number(body.store_id)
          if (!Number.isFinite(n) || n <= 0 || Math.trunc(n) !== n) {
            return NextResponse.json({ error: 'store_id inválido' }, { status: 400 })
          }
          const { data: stExists, error: stLookupErr } = await supabaseAdmin.from('stores').select('id').eq('id', n).maybeSingle()
          if (stLookupErr) throw stLookupErr
          if (!stExists) {
            return NextResponse.json({ error: `Sucursal #${n} no existe` }, { status: 404 })
          }
          updates.store_id = n
        }
      }
      if (body.event_date !== undefined) {
        const d = String(body.event_date).trim()
        if (!isRealCalendarDate(d)) {
          return NextResponse.json({ error: 'Fecha calendario inválida (YYYY-MM-DD)' }, { status: 400 })
        }
        updates.event_date = d
      }
      if (body.holiday_name !== undefined) {
        const hn = String(body.holiday_name || '').trim().slice(0, 140)
        if (!hn) return NextResponse.json({ error: 'El nombre del día festivo no puede quedar vacío' }, { status: 400 })
        updates.holiday_name = hn
      }
      const nextClosed = body.is_closed !== undefined ? Boolean(body.is_closed) : Boolean(currentSh.is_closed)
      if (body.is_closed !== undefined) updates.is_closed = nextClosed

      let nextOpen = currentSh.open_time ? String(currentSh.open_time).slice(0, 5) : null
      let nextClose = currentSh.close_time ? String(currentSh.close_time).slice(0, 5) : null
      if (body.open_time !== undefined) {
        const o = body.open_time ? String(body.open_time).trim().slice(0, 5) : null
        if (o && !TIME_HHMM_RE.test(o)) {
          return NextResponse.json({ error: 'Hora de apertura inválida (HH:MM)' }, { status: 400 })
        }
        nextOpen = o
        updates.open_time = o
      }
      if (body.close_time !== undefined) {
        const c = body.close_time ? String(body.close_time).trim().slice(0, 5) : null
        if (c && !TIME_HHMM_RE.test(c)) {
          return NextResponse.json({ error: 'Hora de cierre inválida (HH:MM)' }, { status: 400 })
        }
        nextClose = c
        updates.close_time = c
      }
      if (nextClosed) {
        updates.open_time = null
        updates.close_time = null
      } else if (!nextOpen && !nextClose) {
        return NextResponse.json({ error: 'Si no está cerrado todo el día, indica hora de apertura o cierre especial' }, { status: 400 })
      }

      if (body.notes_es !== undefined) updates.notes_es = body.notes_es || null
      if (body.notes_en !== undefined) updates.notes_en = body.notes_en || null

      const { data: updated, error } = await supabaseAdmin
        .from('phone_special_hours')
        .update(updates)
        .eq('id', id)
        .select('*, stores(id, name)')
        .single()

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json({ error: 'Ya existe un horario festivo registrado para esa fecha y sucursal' }, { status: 409 })
        }
        throw error
      }
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true, item: sanitizeNestedStore(updated) })
    }

    return NextResponse.json({ error: 'Entidad PATCH no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[api/phone/dashboard] PATCH Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al actualizar registro' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'manage_global' })
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 403 })
    }

    const { searchParams } = new URL(request.url)
    const entity = searchParams.get('entity')
    const id = searchParams.get('id')

    if (!entity || !id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'entity e id UUID válido requeridos' }, { status: 400 })
    }

    if (entity === 'knowledge_base') {
      const { error } = await supabaseAdmin.from('phone_knowledge_base').delete().eq('id', id)
      if (error) throw error
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true })
    }

    if (entity === 'special_hours') {
      const { error } = await supabaseAdmin.from('phone_special_hours').delete().eq('id', id)
      if (error) throw error
      invalidateStorePhoneContextCache()
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Entidad DELETE no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[api/phone/dashboard] DELETE Error:', err)
    return NextResponse.json({ error: err?.message || 'Error al eliminar registro' }, { status: 500 })
  }
}
