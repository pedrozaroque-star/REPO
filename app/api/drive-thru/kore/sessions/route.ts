/**
 * @module api/drive-thru/kore/sessions
 * @description Bitácora del simulador "Kore Drive-Thru": guarda cada simulación terminada (transcripción, orden
 * re-cotizada y totales) en `dt_kore_sim_sessions` y lista las más recientes por sucursal.
 *
 * @businessRules
 * - **Mismo control de acceso que `/api/drive-thru/kore/session`**: `authorizePhoneModuleRequest` + roles de liderazgo
 *   (`KORE_SIM_ALLOWED_ROLES`); manager/general_manager/gerente solo ven y guardan su propia sucursal.
 * - **No se confía en el cliente**: la orden se reconstruye con `rebuildKoreOrderFromMenu` contra el menú vigente de
 *   `app_menu_cache` (precios del servidor), los totales salen de `computeKoreTotals` con la tasa estimada del servidor
 *   (`getKoreStoreTaxRate`) y la duración se calcula con `startedAt`/`endedAt`.
 * - **Sin columnas generadas en el INSERT**: solo valores atómicos (los CHECK de la tabla validan `total = subtotal + tax`).
 * - `outcome`: `confirmed` | `cancelled` | `abandoned`. Simulación pura: nada llega a Toast ni a cocina.
 * - Límites: transcripción ≤ 400 turnos y ≤ 2,000 caracteres por turno; sesiones de hasta 2 horas; fechas no futuras.
 *
 * @dataFlow
 * - `POST { storeId, startedAt, endedAt, lang, outcome, transcript[], order }` -> validación -> re-cotización ->
 *   `INSERT dt_kore_sim_sessions` -> `after(() => analyzeUnprocessedKoreSessions(...))` en segundo plano -> `201 { session }`.
 * - `GET ?storeId=14&limit=20` -> `SELECT ... ORDER BY created_at DESC` -> `{ sessions: [...] }` (camelCase).
 *
 * @notes
 * - La orden se guarda en la columna `order_json` (ORDER es palabra reservada en SQL/PostgREST).
 * - `taxRatePct` enviado por el cliente se ignora: se usa siempre la tasa del servidor (marcada como estimada).
 * - Blindaje de Seguridad (2026-11-21): `authorizePhoneModuleRequest(request, { permission: 'simulate', targetStoreId })` más límite de tasa acotado por usuario.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { authorizePhoneModuleRequest, type PhoneAuthorizedUser } from '@/lib/phone-agent-access'
import { supabaseAdmin } from '@/lib/supabase'
import { KORE_LIVE_MODEL, KORE_SIM_ALLOWED_ROLES, getKoreStoreTaxRate, loadKoreMenu, loadKoreStore } from '@/lib/drive-thru-kore'
import {
  computeKoreTotals,
  rebuildKoreOrderFromMenu,
  sanitizeKoreCashierIntervention
} from '@/lib/drive-thru-kore-order'
import { analyzeUnprocessedKoreSessions } from '@/lib/drive-thru-kore-learning'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const MAX_SESSION_RATE_BUCKETS = 1000
const sessionRateBuckets = new Map<string, number[]>()

function checkSessionRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (sessionRateBuckets.size >= MAX_SESSION_RATE_BUCKETS && !sessionRateBuckets.has(key)) {
    const oldest = sessionRateBuckets.keys().next().value
    if (oldest) sessionRateBuckets.delete(oldest)
  }
  const hits = (sessionRateBuckets.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    sessionRateBuckets.set(key, hits)
    return false
  }
  hits.push(now)
  sessionRateBuckets.set(key, hits)
  return true
}
const OUTCOMES = new Set(['confirmed', 'cancelled', 'abandoned'])
const TRANSCRIPT_ROLE_MAP: Readonly<Record<string, string>> = {
  customer: 'customer',
  user: 'customer',
  kore: 'kore',
  assistant: 'kore',
  model: 'kore',
  cashier: 'cashier',
  cajera: 'cashier',
  cajero: 'cashier',
  system: 'system',
  tool: 'tool'
}
const MAX_TRANSCRIPT_TURNS = 400
const MAX_TURN_CHARS = 2000
const MAX_SESSION_MS = 2 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000
const SELECT_COLUMNS =
  'id, store_id, started_at, ended_at, duration_sec, lang, transcript, order_json, subtotal_cents, tax_cents, total_cents, tax_rate_pct, tax_is_estimate, item_count, outcome, model, avg_latency_ms, p95_latency_ms, barge_in_count, session_kind, analyzed_at, created_by, created_by_name, created_at'

function jsonError(error: string, status: number, details?: string[]) {
  return NextResponse.json(details?.length ? { error, details } : { error }, { status, headers: NO_STORE_HEADERS })
}

async function authorize(request: NextRequest, targetStoreId?: number | null): Promise<{ user?: PhoneAuthorizedUser; response?: NextResponse }> {
  const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate', targetStoreId })
  if (!auth.authorized || !auth.user) {
    return { response: auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401) }
  }
  if (!KORE_SIM_ALLOWED_ROLES.has(auth.user.role)) {
    return { response: jsonError(`Acceso denegado: el rol '${auth.user.role}' no puede usar el simulador Kore Drive-Thru.`, 403) }
  }
  return { user: auth.user }
}

function parseStoreId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw ?? '').trim()) ? Number(raw) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

function canAccessStore(user: PhoneAuthorizedUser, storeId: number): boolean {
  return user.isGlobalAdmin || user.allowedStoreIds.includes(storeId)
}

function parseIso(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d : null
}

function sanitizeTranscript(raw: unknown): { turns: any[] | null; error?: string } {
  if (raw === undefined || raw === null) return { turns: [] }
  if (!Array.isArray(raw)) return { turns: null, error: 'transcript debe ser un arreglo.' }
  if (raw.length > MAX_TRANSCRIPT_TURNS) return { turns: null, error: `transcript excede ${MAX_TRANSCRIPT_TURNS} turnos.` }
  const turns: any[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') return { turns: null, error: 'Cada turno de transcript debe ser un objeto.' }
    const rawRole = String((t as any).role ?? '')
    const role = TRANSCRIPT_ROLE_MAP[rawRole]
    if (!role) return { turns: null, error: `Rol de transcript inválido: "${rawRole.slice(0, 20)}".` }
    const text = String((t as any).text ?? '').replace(/\u0000/g, '').trim().slice(0, MAX_TURN_CHARS)
    if (!text) continue
    const at = parseIso((t as any).at ?? (t as any).timestamp)
    turns.push(at ? { role, text, at: at.toISOString() } : { role, text })
  }
  return { turns }
}

function parseOptionalMetric(raw: unknown, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(max, n)
}

function mapRow(r: any) {
  return {
    id: r.id,
    storeId: Number(r.store_id),
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSec: Number(r.duration_sec) || 0,
    lang: r.lang,
    outcome: r.outcome,
    sessionKind: r.session_kind === 'driver_pickup' ? 'driver_pickup' : 'customer_order',
    avgLatencyMs: r.avg_latency_ms === null || r.avg_latency_ms === undefined ? null : Number(r.avg_latency_ms),
    p95LatencyMs: r.p95_latency_ms === null || r.p95_latency_ms === undefined ? null : Number(r.p95_latency_ms),
    bargeInCount: Number(r.barge_in_count) || 0,
    analyzedAt: r.analyzed_at || null,
    subtotalCents: Number(r.subtotal_cents) || 0,
    taxCents: Number(r.tax_cents) || 0,
    totalCents: Number(r.total_cents) || 0,
    taxRatePct: r.tax_rate_pct === null ? null : Number(r.tax_rate_pct),
    taxIsEstimate: r.tax_is_estimate !== false,
    itemCount: Number(r.item_count) || 0,
    model: r.model || null,
    createdBy: r.created_by === null ? null : Number(r.created_by),
    createdByName: r.created_by_name || null,
    createdAt: r.created_at,
    cashierIntervention: sanitizeKoreCashierIntervention(r.order_json?.cashierIntervention) || null,
    order: r.order_json || null,
    transcript: Array.isArray(r.transcript) ? r.transcript : []
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, response } = await authorize(request)
    if (!user) return response!
    if (!checkSessionRateLimit(`post:${user.id}`, 30, 60_000)) {
      return jsonError('Demasiadas simulaciones guardadas por minuto. Intenta en unos segundos.', 429)
    }
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Cuerpo JSON inválido.', 400)
    const b = body as Record<string, any>

    const storeId = parseStoreId(b.storeId ?? b.store_id)
    if (!storeId) return jsonError('storeId inválido (usa stores.id numérico).', 400)
    if (!canAccessStore(user, storeId)) return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)

    const rawStartedAt = parseIso(b.startedAt ?? b.started_at)
    const rawEndedAt = parseIso(b.endedAt ?? b.ended_at)
    if (!rawStartedAt || !rawEndedAt) return jsonError('startedAt y endedAt deben ser fechas ISO válidas.', 400)
    const nowMs = Date.now()
    if (rawEndedAt.getTime() < rawStartedAt.getTime()) return jsonError('endedAt no puede ser anterior a startedAt.', 400)
    if (rawEndedAt.getTime() > nowMs + 24 * 60 * 60 * 1000) return jsonError('endedAt no puede estar en el futuro.', 400)
    // Tolerar desfase leve de reloj local en tablet/PC acotando al reloj del servidor en lugar de descartar la sesión
    const rawDurationMs = rawEndedAt.getTime() - rawStartedAt.getTime()
    if (rawDurationMs > MAX_SESSION_MS) return jsonError('La simulación excede 2 horas.', 400)
    const endedAt = rawEndedAt.getTime() > nowMs + CLOCK_SKEW_MS ? new Date(nowMs) : rawEndedAt
    const startedAt = endedAt.getTime() < rawStartedAt.getTime() ? new Date(endedAt.getTime() - rawDurationMs) : rawStartedAt
    const lang = b.lang === undefined || b.lang === null ? 'es' : b.lang
    if (lang !== 'es' && lang !== 'en') return jsonError("lang inválido (usa 'es' o 'en').", 400)
    const outcome = String(b.outcome ?? '')
    if (!OUTCOMES.has(outcome)) return jsonError('outcome inválido (confirmed | cancelled | abandoned).', 400)
    const tr = sanitizeTranscript(b.transcript)
    if (!tr.turns) return jsonError(tr.error || 'transcript inválido.', 400)

    const store = await loadKoreStore(storeId)
    if (!store || !store.isActive) return jsonError('Sucursal no encontrada o inactiva.', 404)
    if (!store.hasDriveThru) return jsonError('Esta sucursal no tiene Drive-Thru.', 422)

    const [menu, tax] = await Promise.all([loadKoreMenu(store.id), getKoreStoreTaxRate(store)])
    const rebuilt = rebuildKoreOrderFromMenu(b.order ?? b.order_json, menu)
    if (!rebuilt.state) return jsonError('La orden no coincide con el menú vigente de la sucursal.', 400, rebuilt.errors.slice(0, 10))
    const rawSessionKind = b.sessionKind ?? b.session_kind
    if (rawSessionKind !== undefined && rawSessionKind !== null && rawSessionKind !== 'customer_order' && rawSessionKind !== 'driver_pickup') {
      return jsonError("sessionKind inválido (usa 'customer_order' o 'driver_pickup').", 400)
    }
    const isDriverPickup = rebuilt.state.sessionKind === 'driver_pickup'
    const hasConfirmedContent = isDriverPickup
      ? (rebuilt.state.driverPickup?.orders.length || 0) > 0
      : rebuilt.state.lines.length > 0
    if (outcome === 'confirmed' && (rebuilt.state.status !== 'confirmed' || !hasConfirmedContent)) {
      return jsonError(
        "outcome 'confirmed' requiere status 'confirmed' con al menos una línea de menú o una recolección de repartidor registrada.",
        400
      )
    }
    if (outcome === 'cancelled' && rebuilt.state.status === 'confirmed') {
      return jsonError("outcome 'cancelled' contradice una orden ya 'confirmed'.", 400)
    }
    const baseFinalState =
      outcome === 'cancelled' && rebuilt.state.status === 'building'
        ? { ...rebuilt.state, status: 'cancelled' as const }
        : rebuilt.state

    const rawOrderObj = b.order && typeof b.order === 'object' ? b.order : b.order_json && typeof b.order_json === 'object' ? b.order_json : null
    const rawCashierMeta =
      b.cashierIntervention ??
      b.cashier_intervention ??
      rawOrderObj?.cashierIntervention ??
      rawOrderObj?.cashier_intervention ??
      baseFinalState.cashierIntervention
    let cashierMeta = sanitizeKoreCashierIntervention(rawCashierMeta)
    const cashierTurnsInTranscript = tr.turns.filter((t) => t.role === 'cashier')
    if (cashierMeta) {
      const mergedTurnCount = Math.max(cashierMeta.cashierTurnCount, cashierTurnsInTranscript.length)
      const mergedTriggered = cashierMeta.triggered || mergedTurnCount > 0
      cashierMeta = {
        ...cashierMeta,
        triggered: mergedTriggered,
        triggerSource: mergedTriggered ? cashierMeta.triggerSource ?? (mergedTurnCount > 0 ? 'verbal_cue' : null) : null,
        triggeredAt: mergedTriggered
          ? cashierMeta.triggeredAt ?? cashierTurnsInTranscript[0]?.at ?? startedAt.toISOString()
          : null,
        cashierTurnCount: mergedTurnCount
      }
    } else if (cashierTurnsInTranscript.length > 0) {
      cashierMeta = {
        triggered: true,
        triggerSource: 'verbal_cue',
        triggeredAt: cashierTurnsInTranscript[0]?.at ?? startedAt.toISOString(),
        resumedToKoreCount: 0,
        cashierTurnCount: cashierTurnsInTranscript.length
      }
    }

    const finalState = cashierMeta ? { ...baseFinalState, cashierIntervention: cashierMeta } : baseFinalState
    const totals = computeKoreTotals(finalState, tax.taxRatePct)
    const avgLatencyMs = parseOptionalMetric(b.avgLatencyMs ?? b.avg_latency_ms, 120000)
    const p95LatencyMs = parseOptionalMetric(b.p95LatencyMs ?? b.p95_latency_ms, 120000)
    const bargeInCount = parseOptionalMetric(b.bargeInCount ?? b.barge_in_count, 1000) ?? 0

    const insertPayload = {
      store_id: store.id,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_sec: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      lang,
      transcript: tr.turns,
      order_json: finalState,
      subtotal_cents: totals.subtotalCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      tax_rate_pct: totals.taxRatePct,
      tax_is_estimate: tax.taxIsEstimate,
      item_count: isDriverPickup ? finalState.driverPickup?.orders.length || 0 : totals.itemCount,
      outcome,
      model: KORE_LIVE_MODEL,
      avg_latency_ms: avgLatencyMs,
      p95_latency_ms: p95LatencyMs,
      barge_in_count: bargeInCount,
      session_kind: isDriverPickup ? 'driver_pickup' : 'customer_order',
      created_by: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
      created_by_name: user.name.slice(0, 120)
    }
    const { data, error } = await supabaseAdmin.from('dt_kore_sim_sessions').insert(insertPayload).select(SELECT_COLUMNS).single()
    if (error || !data) {
      console.error('[Kore DT sessions] insert error:', error?.message)
      return jsonError('No se pudo guardar la simulación.', 500)
    }

    const isSmokeOrTest =
      /\b(?:smoke|test)\b/i.test(insertPayload.created_by_name) ||
      tr.turns.some((t) => /\bTEST_SMOKE\b/i.test(t.text))
    if (!isSmokeOrTest) {
      after(async () => {
        try {
          await analyzeUnprocessedKoreSessions({
            storeId: store.id,
            limit: 6,
            includePhoneCalls: false,
            triggerSource: 'auto_analysis'
          })
        } catch (e) {
          console.warn('[Kore DT auto-learn]', e)
        }
      })
    }

    return NextResponse.json({ session: mapRow(data) }, { status: 201, headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[Kore DT sessions] POST error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error interno guardando la simulación.', 500)
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const storeId = parseStoreId(params.get('storeId') ?? params.get('store_id'))
    const { user, response } = await authorize(request, storeId)
    if (!user) return response!
    if (!checkSessionRateLimit(`get:${user.id}`, 60, 60_000)) {
      return jsonError('Demasiadas consultas por minuto. Intenta en unos segundos.', 429)
    }
    if (!storeId) return jsonError('storeId inválido (usa stores.id numérico).', 400)
    if (!canAccessStore(user, storeId)) return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
    const rawLimit = Number(params.get('limit') ?? 20)
    const limit = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20
    const { data, error } = await supabaseAdmin
      .from('dt_kore_sim_sessions')
      .select(SELECT_COLUMNS)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      console.error('[Kore DT sessions] select error:', error.message)
      return jsonError('No se pudo cargar el historial de simulaciones.', 500)
    }
    return NextResponse.json({ sessions: (data || []).map(mapRow) }, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[Kore DT sessions] GET error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error interno cargando el historial.', 500)
  }
}
