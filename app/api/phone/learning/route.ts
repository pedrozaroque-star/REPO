/**
 * @module api/phone/learning
 * @description API administrativa con RBAC por sucursal para el motor de Aprendizaje Continuo Diario de la
 * Contestadora IA Multi-Sucursal (`/admin/llamadas`):
 *   - `GET`: devuelve la bandeja de dudas para el dueño (`needs_owner_input`), reglas aprendidas activas
 *     (`approved` / `auto_applied`), audios WAV pre-calentados (`~80 ms`) y métricas (`stats`).
 *   - `POST`: dispara análisis inmediato (`action: 'analyze_now'`) o registra una regla manual directa del dueño
 *     (`action: 'create_rule'`, con soporte de `appliesToChannels?: 'both' | 'phone_only' | 'drive_thru_only'`).
 *   - `PATCH`: resuelve una duda o hallazgo (`action: 'answer_doubt' | 'approve' | 'dismiss' | 'set_channel'`), redactando en ES/EN,
 *     sincronizando bidireccionalmente `public.phone_knowledge_base` + `public.dt_kore_learning_items`, pre-calentando audio WAV en
 *     `phone_v6/Kore/` e invalidando cachés tanto de Teléfono como de Kore Drive-Thru.
 *
 * @businessRules
 * - **RBAC estricto (`authorizePhoneModuleRequest`)**:
 *   * `GET`: permiso `read_dashboard` (Admin/Supervisor ven las 15 tiendas; Managers ven su sucursal + reglas globales).
 *   * `POST` / `PATCH`: reglas o barridos globales (`storeId = null` o `applyAllStores = true`) requieren `isGlobalAdmin`
 *     (`admin` / `administrador` / `supervisor`); Managers solo pueden ejecutar `analyze_now` o gestionar reglas acotadas
 *     a `allowedStoreIds`.
 * - **Sin columnas generadas**: toda escritura en `phone_learning_items`, `dt_kore_learning_items` y `phone_knowledge_base` usa campos atómicos.
 *
 * @dataFlow
 * - `/admin/llamadas` -> `GET / POST / PATCH /api/phone/learning` -> `lib/phone-agent-learning.ts`
 *   -> `public.phone_learning_items` <-> `public.dt_kore_learning_items` + `public.phone_knowledge_base` + `phone_v6/Kore/` Storage.
 *
 * @notes
 * - `preferredRegion = 'sfo1'` y `Cache-Control: no-store` en todas las respuestas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  analyzeUnprocessedPhoneCalls,
  createManualPhoneLearnedRule,
  getPhoneLearningDashboard,
  isValidPhoneAppliesToChannels,
  resolveOwnerPhoneLearningDecision,
  type PhoneAppliesToChannels
} from '@/lib/phone-agent-learning'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'sfo1'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE_HEADERS })
}

function parseOptionalStoreId(raw: unknown): { storeId: number | null; invalid: boolean } {
  if (raw === undefined || raw === null || raw === '' || raw === 'all' || raw === 'ALL') {
    return { storeId: null, invalid: false }
  }
  const str = String(raw).trim()
  const n = typeof raw === 'number' ? raw : /^\d+$/.test(str) ? Number(str) : NaN
  if (!Number.isInteger(n) || n <= 0) return { storeId: null, invalid: true }
  return { storeId: n, invalid: false }
}

export async function GET(request: NextRequest) {
  try {
    const parsed = parseOptionalStoreId(
      request.nextUrl.searchParams.get('storeId') ?? request.nextUrl.searchParams.get('store_id')
    )
    if (parsed.invalid) return jsonError('storeId inválido.', 400)

    const auth = await authorizePhoneModuleRequest(request, {
      permission: 'read_dashboard',
      targetStoreId: parsed.storeId
    })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autenticado.', auth.status || 401)
    }

    let effectiveStoreId = parsed.storeId
    if (!auth.user.isGlobalAdmin && !effectiveStoreId) {
      effectiveStoreId = auth.user.assignedStoreId || auth.user.allowedStoreIds[0] || null
    }

    const dashboard = await getPhoneLearningDashboard(effectiveStoreId)
    return NextResponse.json({ ok: true, ...dashboard }, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    console.error('[api/phone/learning] GET error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error cargando el panel de Aprendizaje Continuo.', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError('Cuerpo JSON inválido.', 400)
    }
    const b = body as Record<string, any>
    const action = String(b.action || '').trim()
    const parsed = parseOptionalStoreId(b.storeId ?? b.store_id)
    if (parsed.invalid) return jsonError('storeId inválido.', 400)

    const auth = await authorizePhoneModuleRequest(request, {
      permission: parsed.storeId === null && action === 'create_rule' ? 'manage_global' : 'simulate',
      targetStoreId: parsed.storeId
    })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autorizado.', auth.status || 401)
    }
    const user = auth.user

    if (action === 'analyze_now') {
      let effectiveStoreId = parsed.storeId
      if (!user.isGlobalAdmin) {
        if (effectiveStoreId && !user.allowedStoreIds.includes(effectiveStoreId)) {
          return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
        }
        if (!effectiveStoreId) effectiveStoreId = user.assignedStoreId || user.allowedStoreIds[0] || null
      }

      const analysis = await analyzeUnprocessedPhoneCalls({
        storeId: effectiveStoreId,
        limit: Number.isFinite(Number(b.limit)) ? Number(b.limit) : 80,
        reanalyzeRecentHours:
          Number.isFinite(Number(b.reanalyzeRecentHours)) && Number(b.reanalyzeRecentHours) > 0
            ? Number(b.reanalyzeRecentHours)
            : undefined,
        prewarmAudio: b.prewarmAudio !== false,
        triggerSource: 'auto_analysis'
      })
      const dashboard = await getPhoneLearningDashboard(effectiveStoreId)
      return NextResponse.json({ ok: true, analysis, ...dashboard }, { headers: NO_STORE_HEADERS })
    }

    if (action === 'create_rule') {
      const targetStoreId = parsed.storeId
      if (targetStoreId === null && !user.isGlobalAdmin) {
        return jsonError(
          'Solo Administradores o Supervisores pueden crear reglas globales para las 15 sucursales.',
          403
        )
      }
      if (targetStoreId !== null) {
        if (!user.isGlobalAdmin && !user.allowedStoreIds.includes(targetStoreId)) {
          return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
        }
        const { data: st } = await supabaseAdmin
          .from('stores')
          .select('id, is_active')
          .eq('id', targetStoreId)
          .maybeSingle()
        if (!st || st.is_active === false) {
          return jsonError('La sucursal indicada no existe o no está activa.', 422)
        }
      }

      const rawChannels = b.appliesToChannels ?? b.applies_to_channels
      if (rawChannels !== undefined && rawChannels !== null && !isValidPhoneAppliesToChannels(rawChannels)) {
        return jsonError("appliesToChannels inválido (usa 'both', 'phone_only' o 'drive_thru_only').", 400)
      }
      const appliesToChannels: PhoneAppliesToChannels | undefined = isValidPhoneAppliesToChannels(rawChannels)
        ? rawChannels
        : undefined

      const questionOrTrigger = String(b.questionOrTrigger ?? '').replace(/\s+/g, ' ').trim()
      const ownerInstruction = String(b.ownerInstruction ?? '').replace(/\s+/g, ' ').trim()
      if (questionOrTrigger.length < 3 || ownerInstruction.length < 3) {
        return jsonError('questionOrTrigger y ownerInstruction son obligatorios (mínimo 3 caracteres).', 400)
      }

      const item = await createManualPhoneLearnedRule({
        storeId: targetStoreId,
        category: b.category,
        appliesToChannels,
        questionOrTrigger,
        ownerInstruction,
        proposedRuleEs: b.proposedRuleEs,
        proposedRuleEn: b.proposedRuleEn,
        fastReplyEs: b.fastReplyEs,
        fastReplyEn: b.fastReplyEn,
        triggerKeywords: b.triggerKeywords,
        resolvedBy: user.id,
        resolvedByName: user.name
      })
      return NextResponse.json({ ok: true, item }, { status: 201, headers: NO_STORE_HEADERS })
    }

    return jsonError("action inválido (usa 'analyze_now' o 'create_rule').", 400)
  } catch (err: any) {
    console.error('[api/phone/learning] POST error:', String(err?.message || err).slice(0, 300))
    return jsonError('Error procesando acción de Aprendizaje Continuo.', 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return auth.response || jsonError(auth.error || 'No autorizado.', auth.status || 401)
    }
    const user = auth.user

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError('Cuerpo JSON inválido.', 400)
    }
    const b = body as Record<string, any>

    const id = String(b.id ?? '').trim()
    if (!UUID_RE.test(id)) return jsonError('id inválido.', 400)

    const rawChannels = b.appliesToChannels ?? b.applies_to_channels
    if (rawChannels !== undefined && rawChannels !== null && !isValidPhoneAppliesToChannels(rawChannels)) {
      return jsonError("appliesToChannels inválido (usa 'both', 'phone_only' o 'drive_thru_only').", 400)
    }
    const appliesToChannels: PhoneAppliesToChannels | undefined = isValidPhoneAppliesToChannels(rawChannels)
      ? rawChannels
      : undefined

    const rawAction = String(b.action || '').trim()
    const rawStatus = String(b.status || '').trim()
    const action: 'approve' | 'answer_doubt' | 'dismiss' | 'set_channel' | null =
      rawAction === 'approve' ||
      rawAction === 'answer_doubt' ||
      rawAction === 'dismiss' ||
      rawAction === 'set_channel'
        ? rawAction
        : rawStatus === 'approved'
          ? 'approve'
          : rawStatus === 'dismissed'
            ? 'dismiss'
            : !rawAction && !rawStatus && appliesToChannels !== undefined
              ? 'set_channel'
              : null

    if (!action) {
      return jsonError("action inválido (usa 'answer_doubt', 'approve', 'dismiss' o 'set_channel').", 400)
    }

    let parsedStoreOverride: number | null | undefined = undefined
    if (b.storeId !== undefined || b.store_id !== undefined) {
      const parsed = parseOptionalStoreId(b.storeId ?? b.store_id)
      if (parsed.invalid) return jsonError('storeId inválido.', 400)
      parsedStoreOverride = parsed.storeId
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('phone_learning_items')
      .select('id, store_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) return jsonError('Error consultando el registro de aprendizaje.', 500)
    if (!existing) return jsonError('Item de aprendizaje no encontrado.', 404)

    const applyAllStores = b.applyAllStores === true
    const resultingStoreId = applyAllStores
      ? null
      : parsedStoreOverride !== undefined
        ? parsedStoreOverride
        : existing.store_id === null || existing.store_id === undefined
          ? null
          : Number(existing.store_id)

    if ((existing.store_id === null || resultingStoreId === null) && !user.isGlobalAdmin) {
      return jsonError('Solo Administradores o Supervisores pueden aprobar o modificar reglas globales.', 403)
    }
    if (
      existing.store_id !== null &&
      !user.isGlobalAdmin &&
      !user.allowedStoreIds.includes(Number(existing.store_id))
    ) {
      return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal.', 403)
    }
    if (resultingStoreId !== null && !user.isGlobalAdmin && !user.allowedStoreIds.includes(resultingStoreId)) {
      return jsonError('Acceso denegado: no tienes autorización sobre esa sucursal destino.', 403)
    }

    const item = await resolveOwnerPhoneLearningDecision({
      id,
      action,
      ownerInstruction: b.ownerInstruction,
      proposedRuleEs: b.proposedRuleEs,
      proposedRuleEn: b.proposedRuleEn,
      fastReplyEs: b.fastReplyEs,
      fastReplyEn: b.fastReplyEn,
      triggerKeywords: b.triggerKeywords,
      appliesToChannels,
      storeId: parsedStoreOverride,
      applyAllStores,
      category: b.category,
      resolvedBy: user.id,
      resolvedByName: user.name
    })

    return NextResponse.json({ ok: true, item }, { headers: NO_STORE_HEADERS })
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (msg.startsWith('VALIDATION:')) {
      return jsonError(msg.replace(/^VALIDATION:\s*/, ''), 400)
    }
    if (msg.startsWith('NOT_FOUND:')) {
      return jsonError(msg.replace(/^NOT_FOUND:\s*/, ''), 404)
    }
    console.error('[api/phone/learning] PATCH error:', msg.slice(0, 300))
    return jsonError('Error actualizando criterio de Aprendizaje Continuo.', 500)
  }
}
