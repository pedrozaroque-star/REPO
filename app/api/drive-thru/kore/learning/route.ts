/**
 * @module api/drive-thru/kore/learning
 * @description API de Aprendizaje Continuo Bidireccional del asistente de voz "Kore Drive-Thru" y la Contestadora IA
 * Telefónica (`/admin/llamadas`) de Tacos Gavilan:
 *   - `GET`: lista hallazgos automáticos, bandeja de dudas (`needs_owner_input`), reglas aprendidas activas
 *     (`approved` / `auto_applied`), canal de aplicación (`appliesToChannels`), estado de sincronización telefónica
 *     (`syncedKbId`, `stats.syncedToPhoneCount`) y métricas de latencia.
 *   - `POST`: dispara análisis inmediato de simulaciones y llamadas pendientes (`action: 'analyze_now'`) o crea una
 *     regla manual del dueño (`action: 'create_rule'`, con `appliesToChannels?: 'both'|'drive_thru_only'|'phone_only'`).
 *   - `PATCH`: aprueba (`status: 'approved'`), descarta (`status: 'dismissed'`) o cambia el canal (`appliesToChannels`)
 *     de un item, sincronizando en vivo con `public.phone_knowledge_base` e invalidando las cachés de ambos canales.
 *
 * @businessRules
 * - **RBAC estricto**: `authorizePhoneModuleRequest` + `KORE_SIM_ALLOWED_ROLES`. Reglas globales (`storeId = null` o
 *   `applyAllStores = true`) solo pueden ser creadas o modificadas por `admin`/`supervisor` (`user.isGlobalAdmin`).
 *   Managers de tienda solo pueden consultar/aprobar items de su propia sucursal con Drive-Thru.
 * - **Sincronización bidireccional real**: toda regla activa con `appliesToChannels` en `'both'` o `'phone_only'` se
 *   inserta/actualiza en `public.phone_knowledge_base` y limpia `phone_calls.unanswered_question` cuando proviene de llamada;
 *   si pasa a `'drive_thru_only'` o `'dismissed'`, se desactiva (`is_active = false`) en `phone_knowledge_base`.
 * - **Sin columnas generadas en INSERT/UPDATE**: solo valores atómicos en `public.dt_kore_learning_items`.
 *
 * @dataFlow
 * - `KoreLearningPanel` -> `GET/POST/PATCH /api/drive-thru/kore/learning` -> `lib/drive-thru-kore-learning.ts`
 *   -> `public.dt_kore_learning_items` <-> `public.phone_knowledge_base` -> inyección en vivo en Drive-Thru y Teléfono.
 *
 * @notes
 * - `Cache-Control: no-store` en todas las respuestas para reflejar cambios de reglas en tiempo real.
 * - Blindaje de Seguridad (2026-11-21): `authorizePhoneModuleRequest(request)` estricto con bloqueo explícito si `effectiveStoreId` queda `null` para usuarios no globales + límite de tasa acotado por usuario/IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest, type PhoneAuthorizedUser } from '@/lib/phone-agent-access'
import { supabaseAdmin } from '@/lib/supabase'
import { KORE_SIM_ALLOWED_ROLES, loadKoreStore } from '@/lib/drive-thru-kore'
import {
  SELECT_LEARNING_COLS,
  analyzeUnprocessedKoreSessions,
  buildBilingualRuleFromOwnerInstruction,
  getKoreLearningDashboard,
  invalidateKoreLearnedRulesCache,
  isValidAppliesToChannels,
  mapLearningRowToDto,
  syncLearningItemToPhoneKnowledgeBase,
  type KoreAppliesToChannels
} from '@/lib/drive-thru-kore-learning'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LEARNING_BUCKETS = 1000
const learningRateBuckets = new Map<string, number[]>()

function checkLearningRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (learningRateBuckets.size >= MAX_LEARNING_BUCKETS && !learningRateBuckets.has(key)) {
    const oldest = learningRateBuckets.keys().next().value
    if (oldest) learningRateBuckets.delete(oldest)
  }
  const hits = (learningRateBuckets.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    learningRateBuckets.set(key, hits)
    return false
  }
  hits.push(now)
  learningRateBuckets.set(key, hits)
  return true
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS })
}

async function authorize(
  request: NextRequest,
  targetStoreId?: number | null
): Promise<{ user?: PhoneAuthorizedUser; response?: NextResponse }> {
  const auth = await authorizePhoneModuleRequest(request, {
    permission: 'simulate',
    targetStoreId,
  })
  if (!auth.authorized || !auth.user) {
    return { response: auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401) }
  }
  if (!KORE_SIM_ALLOWED_ROLES.has(auth.user.role)) {
    return { response: jsonError(`Acceso denegado: el rol '${auth.user.role}' no tiene acceso a Kore Drive-Thru.`, 403) }
  }
  return { user: auth.user }
}

function parseOptionalStoreId(raw: unknown): { storeId: number | null; invalid: boolean } {
  if (raw === undefined || raw === null || raw === '' || raw === 'ALL') return { storeId: null, invalid: false }
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw).trim()) ? Number(raw) : NaN
  if (!Number.isInteger(n) || n <= 0) return { storeId: null, invalid: true }
  return { storeId: n, invalid: false }
}

export async function GET(request: NextRequest) {
  try {
    const parsed = parseOptionalStoreId(request.nextUrl.searchParams.get('storeId') ?? request.nextUrl.searchParams.get('store_id'))
    if (parsed.invalid) return jsonError('storeId inválido.', 400)

    const { user, response } = await authorize(request, parsed.storeId)
    if (!user) return response!

    if (!checkLearningRateLimit(`get:${user.id}`, 60, 60_000)) {
      return jsonError('Demasiadas solicitudes. Espera unos segundos.', 429)
    }

    let effectiveStoreId = parsed.storeId
    if (!user.isGlobalAdmin) {
      if (effectiveStoreId && !user.allowedStoreIds.includes(effectiveStoreId)) {
        return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
      }
      if (!effectiveStoreId) effectiveStoreId = user.assignedStoreId || user.allowedStoreIds[0] || null
      if (!effectiveStoreId) {
        return jsonError('Acceso denegado: tu cuenta no tiene una sucursal autorizada.', 403)
      }
    }

    const dashboard = await getKoreLearningDashboard(effectiveStoreId)
    return NextResponse.json(dashboard, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[Kore DT learning] GET error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error cargando el panel de aprendizaje de Kore.', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, response } = await authorize(request)
    if (!user) return response!

    if (!checkLearningRateLimit(`post:${user.id}`, 20, 60_000)) {
      return jsonError('Demasiadas acciones de aprendizaje por minuto. Intenta en unos segundos.', 429)
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Cuerpo JSON inválido.', 400)
    const b = body as Record<string, any>
    const action = String(b.action || '').trim()

    if (action === 'analyze_now') {
      const parsed = parseOptionalStoreId(b.storeId ?? b.store_id)
      if (parsed.invalid) return jsonError('storeId inválido.', 400)
      let effectiveStoreId = parsed.storeId
      if (!user.isGlobalAdmin) {
        if (effectiveStoreId && !user.allowedStoreIds.includes(effectiveStoreId)) {
          return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
        }
        if (!effectiveStoreId) effectiveStoreId = user.assignedStoreId || user.allowedStoreIds[0] || null
        if (!effectiveStoreId) {
          return jsonError('Acceso denegado: tu cuenta no tiene una sucursal autorizada.', 403)
        }
      }
      const analysis = await analyzeUnprocessedKoreSessions({
        storeId: effectiveStoreId,
        includePhoneCalls: true,
        triggerSource: 'dt_simulation'
      })
      const dashboard = await getKoreLearningDashboard(effectiveStoreId)
      return NextResponse.json({ ok: true, analysis, ...dashboard }, { headers: NO_STORE_HEADERS })
    }

    if (action === 'create_rule') {
      const parsed = parseOptionalStoreId(b.storeId ?? b.store_id)
      if (parsed.invalid) return jsonError('storeId inválido.', 400)
      const targetStoreId = parsed.storeId

      const rawChannels = b.appliesToChannels ?? b.applies_to_channels
      if (rawChannels !== undefined && rawChannels !== null && !isValidAppliesToChannels(rawChannels)) {
        return jsonError("appliesToChannels inválido (usa 'both', 'drive_thru_only' o 'phone_only').", 400)
      }
      const appliesToChannels: KoreAppliesToChannels = isValidAppliesToChannels(rawChannels) ? rawChannels : 'both'

      if (targetStoreId === null) {
        if (!user.isGlobalAdmin) {
          return jsonError('Solo Administradores o Supervisores pueden crear reglas globales para todas las sucursales.', 403)
        }
      } else {
        if (!user.isGlobalAdmin && !user.allowedStoreIds.includes(targetStoreId)) {
          return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
        }
        const st = await loadKoreStore(targetStoreId)
        if (!st || !st.isActive || (appliesToChannels !== 'phone_only' && !st.hasDriveThru)) {
          return jsonError('La sucursal indicada no existe o no cuenta con Drive-Thru.', 422)
        }
      }

      const questionOrTrigger = String(b.questionOrTrigger ?? '').replace(/\s+/g, ' ').trim().slice(0, 220)
      const ownerInstruction = String(b.ownerInstruction ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
      if (questionOrTrigger.length < 3 || ownerInstruction.length < 3) {
        return jsonError('questionOrTrigger y ownerInstruction son obligatorios (mínimo 3 caracteres).', 400)
      }

      const { triggerEn, ruleEs, ruleEn } = await buildBilingualRuleFromOwnerInstruction({
        questionOrTrigger,
        questionOrTriggerEn: b.questionOrTriggerEn ?? b.question_or_trigger_en,
        ownerInstruction,
        proposedRuleEs: b.proposedRuleEs,
        proposedRuleEn: b.proposedRuleEn
      })
      const nowIso = new Date().toISOString()
      const { data, error } = await supabaseAdmin
        .from('dt_kore_learning_items')
        .insert({
          store_id: targetStoreId,
          source_session_id: null,
          dedupe_key: null,
          source_type: 'manual_owner',
          item_kind: 'learned_rule',
          status: 'approved',
          applies_to_channels: appliesToChannels,
          question_or_trigger: questionOrTrigger,
          question_or_trigger_en: triggerEn,
          proposed_rule_es: ruleEs,
          proposed_rule_en: ruleEn,
          owner_instruction: ownerInstruction,
          evidence_count: 1,
          resolved_by: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
          resolved_by_name: user.name.slice(0, 120),
          resolved_at: nowIso,
          updated_at: nowIso
        })
        .select(SELECT_LEARNING_COLS)
        .single()

      if (error || !data) {
        console.error('[Kore DT learning] create_rule error:', error?.message)
        return jsonError('No se pudo guardar la regla de aprendizaje.', 500)
      }

      const syncedRow = await syncLearningItemToPhoneKnowledgeBase(data)
      invalidateKoreLearnedRulesCache()
      return NextResponse.json({ ok: true, item: mapLearningRowToDto(syncedRow) }, { status: 201, headers: NO_STORE_HEADERS })
    }

    return jsonError("action inválido (usa 'analyze_now' o 'create_rule').", 400)
  } catch (err: any) {
    console.error('[Kore DT learning] POST error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error procesando acción de aprendizaje.', 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, response } = await authorize(request)
    if (!user) return response!

    if (!checkLearningRateLimit(`patch:${user.id}`, 30, 60_000)) {
      return jsonError('Demasiadas actualizaciones por minuto. Intenta en unos segundos.', 429)
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Cuerpo JSON inválido.', 400)
    const b = body as Record<string, any>

    const id = String(b.id ?? '').trim()
    if (!UUID_RE.test(id)) return jsonError('id inválido.', 400)

    const rawChannels = b.appliesToChannels ?? b.applies_to_channels
    if (rawChannels !== undefined && rawChannels !== null && !isValidAppliesToChannels(rawChannels)) {
      return jsonError("appliesToChannels inválido (usa 'both', 'drive_thru_only' o 'phone_only').", 400)
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select(SELECT_LEARNING_COLS)
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) return jsonError('Error consultando el registro.', 500)
    if (!existing) return jsonError('Item de aprendizaje no encontrado.', 404)

    const rawStatus = b.status !== undefined && b.status !== null ? String(b.status).trim() : ''
    const channelOnlyToggle =
      !rawStatus &&
      rawChannels !== undefined &&
      (existing.status === 'approved' || existing.status === 'auto_applied')

    if (!channelOnlyToggle && rawStatus !== 'approved' && rawStatus !== 'dismissed') {
      return jsonError("status inválido (usa 'approved' o 'dismissed').", 400)
    }
    const status = channelOnlyToggle ? String(existing.status) : rawStatus

    const applyAllStores = b.applyAllStores === true
    if ((existing.store_id === null || applyAllStores) && !user.isGlobalAdmin) {
      return jsonError('Solo Administradores o Supervisores pueden modificar o aplicar reglas globales.', 403)
    }
    if (existing.store_id !== null && !user.isGlobalAdmin && !user.allowedStoreIds.includes(Number(existing.store_id))) {
      return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
    }

    const appliesToChannels: KoreAppliesToChannels = isValidAppliesToChannels(rawChannels)
      ? rawChannels
      : isValidAppliesToChannels(existing.applies_to_channels)
        ? existing.applies_to_channels
        : 'both'

    const nowIso = new Date().toISOString()
    const updatePayload: Record<string, any> = {
      status,
      applies_to_channels: appliesToChannels,
      resolved_by: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
      resolved_by_name: user.name.slice(0, 120),
      resolved_at: nowIso,
      updated_at: nowIso
    }

    if (!channelOnlyToggle && status === 'approved') {
      const ownerInstruction = String(
        b.ownerInstruction ?? existing.owner_instruction ?? existing.proposed_rule_es ?? existing.question_or_trigger ?? ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500)
      if (ownerInstruction.length < 3) {
        return jsonError('Escribe una instrucción o regla válida para aprobar este criterio.', 400)
      }
      const { triggerEn, ruleEs, ruleEn } = await buildBilingualRuleFromOwnerInstruction({
        questionOrTrigger: String(existing.question_or_trigger || ''),
        questionOrTriggerEn: b.questionOrTriggerEn ?? b.question_or_trigger_en ?? existing.question_or_trigger_en,
        ownerInstruction,
        proposedRuleEs: b.proposedRuleEs,
        proposedRuleEn: b.proposedRuleEn
      })
      updatePayload.question_or_trigger_en = triggerEn || existing.question_or_trigger_en || null
      updatePayload.owner_instruction = ownerInstruction
      updatePayload.proposed_rule_es = ruleEs
      updatePayload.proposed_rule_en = ruleEn
      if (applyAllStores) updatePayload.store_id = null
      if (existing.item_kind === 'latency_insight') updatePayload.item_kind = 'learned_rule'
    } else if (!channelOnlyToggle && b.ownerInstruction !== undefined) {
      updatePayload.owner_instruction = String(b.ownerInstruction || '').trim().slice(0, 500) || null
    } else if (channelOnlyToggle && applyAllStores) {
      updatePayload.store_id = null
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .update(updatePayload)
      .eq('id', id)
      .select(SELECT_LEARNING_COLS)
      .single()

    if (updErr || !updated) {
      console.error('[Kore DT learning] PATCH error:', updErr?.message)
      return jsonError('No se pudo actualizar el item de aprendizaje.', 500)
    }

    const syncedRow = await syncLearningItemToPhoneKnowledgeBase(updated)
    invalidateKoreLearnedRulesCache()
    return NextResponse.json({ ok: true, item: mapLearningRowToDto(syncedRow) }, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[Kore DT learning] PATCH exception:', String(err?.message || err).slice(0, 300))
    return jsonError('Error interno actualizando el criterio de aprendizaje.', 500)
  }
}
