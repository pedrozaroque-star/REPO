/**
 * @module app/api/evaluacion/notify/route
 * @description Endpoint endurecido para notificar de inmediato a la Dirección General de Tacos Gavilan
 * tras el registro verificado de una evaluación de personal (`public.staff_evaluations`).
 *
 * @businessRules
 * - **Cierre Total de Relay SMTP Abierto**:
 *   1) Verifica en servidor (`supabaseAdmin`) que la evaluación exista realmente en `public.staff_evaluations` (por `id` o captura reciente en kiosco `< 10 min`).
 *   2) Ignora `body.recipients` en envíos de kiosco no autenticados (enviando exclusivamente a `STAFF_EVALUATION_DIRECTORS`: Raquel, Roberto y Gonzalo + BCC Carlos).
 *   3) Cuando es invocado por personal gerencial autenticado (`verifyStaffAuth`), restringe cualquier destinatario personalizado estrictamente a cuentas corporativas `@tacosgavilan.com` o directivos/gerentes activos en `public.users` — jamás envía a correos externos arbitrarios.
 * - **Prevención de Inyección HTML y SMTP Header**: Escapa todas las entidades HTML (`&`, `<`, `>`, `"`, `'`) y elimina saltos de línea en campos interpolados en el asunto y cuerpo HTML.
 *
 * @dataFlow
 * - `StaffEvaluationForm` / `StaffEvaluationReviewModal` -> POST `/api/evaluacion/notify` -> Verificación DB + Sanitización HTML -> `sendStaffEvaluationEmail()` -> Gmail SMTP corporativo.
 *
 * @notes
 * - Endurecido 2026-11-20 contra abuso de relay SMTP, spam repetido e inyección HTML en correos ejecutivos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  sendStaffEvaluationEmail,
  STAFF_EVALUATION_DIRECTORS,
  StaffEvaluationEmailPayload
} from '@/lib/staff-evaluation-email'
import { formatStoreDisplayName, getInternalStoreNameById } from '@/lib/store-display'

export const dynamic = 'force-dynamic'

const CORPORATE_EMAIL_REGEX = /^[a-z0-9._%+-]+@tacosgavilan\.com$/i
const SAFE_EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,12}$/i

const recentEvalNotifyMap = new Map<string, number>()
const ipRateBuckets = new Map<string, { count: number; windowStartMs: number }>()

function escapeHtml(raw: unknown, maxLen = 2000): string {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlMultiline(raw: unknown, maxLen = 4000): string {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLen)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function clampRating(val: unknown, min = 1, max = 5): number | undefined {
  const num = Number(val)
  if (!Number.isFinite(num) || num < min || num > max) return undefined
  return Math.round(num * 10) / 10
}

function checkNotifyIpRateLimit(ip: string): boolean {
  const now = Date.now()
  const windowMs = 10 * 60 * 1000
  const bucket = ipRateBuckets.get(ip)
  if (!bucket || now - bucket.windowStartMs > windowMs) {
    ipRateBuckets.set(ip, { count: 1, windowStartMs: now })
    return true
  }
  if (bucket.count >= 15) {
    return false
  }
  bucket.count += 1
  return true
}

export async function POST(request: NextRequest) {
  try {
    const clientIp =
      (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    if (!checkNotifyIpRateLimit(clientIp)) {
      return NextResponse.json(
        { success: false, error: 'Demasiadas solicitudes de notificación. Intenta más tarde.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const rawEvaluatedName = typeof body?.evaluated_name === 'string' ? body.evaluated_name.trim() : ''
    const rawEvaluatedRole = typeof body?.evaluated_role === 'string' ? body.evaluated_role.trim() : ''

    if (!body || !rawEvaluatedName || !rawEvaluatedRole) {
      return NextResponse.json(
        {
          success: false,
          error: 'Datos incompletos: se requiere evaluated_name y evaluated_role.'
        },
        { status: 400 }
      )
    }

    const staffAuth = verifyStaffAuth(request, {
      allowedRoles: ['admin', 'supervisor', 'manager'],
      allowCron: false
    })
    const supabaseAdmin = await getSupabaseAdminClient()

    // 1. Verificar que el registro de evaluación exista realmente en public.staff_evaluations
    let dbEval: Record<string, any> | null = null

    if (body.id !== undefined && body.id !== null && String(body.id).trim() !== '') {
      const numericId = Number(body.id)
      if (!Number.isFinite(numericId) || numericId <= 0) {
        return NextResponse.json(
          { success: false, error: 'Identificador de evaluación inválido.' },
          { status: 400 }
        )
      }
      const { data } = await supabaseAdmin
        .from('staff_evaluations')
        .select('*')
        .eq('id', numericId)
        .maybeSingle()
      dbEval = data || null

      if (!dbEval) {
        return NextResponse.json(
          { success: false, error: 'La evaluación indicada no existe en el registro oficial.' },
          { status: 404 }
        )
      }
    } else {
      // Captura desde kiosco donde anon insert pudo no retornar id: exigir coincidencia reciente (< 10 min) en DB
      const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      let recentQuery = supabaseAdmin
        .from('staff_evaluations')
        .select('*')
        .eq('evaluated_name', rawEvaluatedName)
        .eq('evaluated_role', rawEvaluatedRole)
        .gte('created_at', tenMinAgoIso)
        .order('created_at', { ascending: false })
        .limit(1)

      if (body.store_id !== undefined && body.store_id !== null && Number.isFinite(Number(body.store_id))) {
        recentQuery = recentQuery.eq('store_id', Number(body.store_id))
      }

      const { data: recentRows } = await recentQuery
      dbEval = Array.isArray(recentRows) && recentRows.length > 0 ? recentRows[0] : null

      if (!dbEval) {
        return NextResponse.json(
          {
            success: false,
            error: 'No autorizado: la evaluación debe estar registrada previamente en el sistema.'
          },
          { status: 403 }
        )
      }
    }

    // Deduplicación anti-spam por evaluación (cooldown 60s para envíos no autenticados)
    const dedupKey = String(dbEval.id)
    const prevSentAt = recentEvalNotifyMap.get(dedupKey) || 0
    if (!staffAuth.authorized && Date.now() - prevSentAt < 60_000) {
      return NextResponse.json(
        { success: true, deduplicated: true, recipients: STAFF_EVALUATION_DIRECTORS },
        { status: 200 }
      )
    }

    // 2. Validar estrictamente destinatarios (CERO relay SMTP abierto)
    let verifiedCustomRecipients: string[] | undefined = undefined
    if (Array.isArray(body.recipients) && body.recipients.length > 0) {
      if (!staffAuth.authorized) {
        return NextResponse.json(
          {
            success: false,
            error: 'No autorizado para especificar destinatarios personalizados.'
          },
          { status: 403 }
        )
      }

      const cleanedCandidates: string[] = Array.from(
        new Set<string>(
          body.recipients
            .filter((r: unknown): r is string => typeof r === 'string')
            .map((r: string) => r.trim().toLowerCase())
            .filter(Boolean)
        )
      ).slice(0, 10)

      if (cleanedCandidates.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Lista de destinatarios inválida.' },
          { status: 400 }
        )
      }

      for (const addr of cleanedCandidates) {
        if (!SAFE_EMAIL_REGEX.test(addr)) {
          return NextResponse.json(
            { success: false, error: `Correo destinatario inválido: ${addr}` },
            { status: 400 }
          )
        }
      }

      const nonCorporate = cleanedCandidates.filter(addr => !CORPORATE_EMAIL_REGEX.test(addr))
      if (nonCorporate.length > 0) {
        const { data: allowedStaff } = await supabaseAdmin
          .from('users')
          .select('email, role, is_active')
          .in('role', ['admin', 'supervisor', 'manager'])
          .eq('is_active', true)

        const allowedStaffEmails = new Set(
          (allowedStaff || [])
            .map((u: any) => String(u.email || '').trim().toLowerCase())
            .filter(Boolean)
        )

        const unauthorizedRecipient = nonCorporate.find(addr => !allowedStaffEmails.has(addr))
        if (unauthorizedRecipient) {
          return NextResponse.json(
            {
              success: false,
              error: 'Destinatario rechazado: solo se permiten cuentas corporativas verificadas de Tacos Gavilan.'
            },
            { status: 403 }
          )
        }
      }

      verifiedCustomRecipients = cleanedCandidates
    }

    // 3. Construir payload desde el registro autoritativo de DB con escape HTML estricto
    const src = dbEval
    const rawAnswers = (src.answers && typeof src.answers === 'object' ? src.answers : body.answers) || {}

    const cleanedLocationRaw =
      formatStoreDisplayName(src.location_name || rawAnswers.location_name || body.location_name || '') ||
      getInternalStoreNameById(src.store_id) ||
      ''
    const safeLocationName = escapeHtml(cleanedLocationRaw, 140)
    const safeEvaluatorName = escapeHtml(src.evaluator_name ?? body.evaluator_name ?? '', 140)
    const safeEvaluatedName = escapeHtml(src.evaluated_name || rawEvaluatedName, 140)
    const safeEvaluatedRole = escapeHtml(src.evaluated_role || rawEvaluatedRole, 120)
    const safeFortalezas = escapeHtmlMultiline(src.fortalezas ?? body.fortalezas ?? '', 3000)
    const safeAreasMejora = escapeHtmlMultiline(src.areas_mejora ?? body.areas_mejora ?? '', 3000)
    const safeComentarios = escapeHtmlMultiline(src.comentarios ?? body.comentarios ?? '', 3000)
    const rawRec = String(src.recomendaria ?? body.recomendaria ?? '').trim().toLowerCase()
    const safeRecomendaria = rawRec === 'si' || rawRec === 'sí' || rawRec === 'yes' ? 'si' : 'no'
    const safeDesempeno = clampRating(src.desempeno_general ?? body.desempeno_general, 1, 10) ?? 10

    const payload: StaffEvaluationEmailPayload = {
      id: src.id,
      store_id: typeof src.store_id === 'number' ? src.store_id : null,
      location_name: safeLocationName || null,
      evaluation_date: src.evaluation_date || src.created_at || new Date().toISOString(),
      evaluator_name: safeEvaluatorName || null,
      evaluated_name: safeEvaluatedName,
      evaluated_role: safeEvaluatedRole,
      q1_1: clampRating(src.q1_1), q1_2: clampRating(src.q1_2), q1_3: clampRating(src.q1_3), q1_4: clampRating(src.q1_4), q1_5: clampRating(src.q1_5),
      q2_1: clampRating(src.q2_1) ?? null, q2_2: clampRating(src.q2_2) ?? null, q2_3: clampRating(src.q2_3) ?? null, q2_4: clampRating(src.q2_4) ?? null, q2_5: clampRating(src.q2_5) ?? null,
      q3_1: clampRating(src.q3_1), q3_2: clampRating(src.q3_2), q3_3: clampRating(src.q3_3), q3_4: clampRating(src.q3_4), q3_5: clampRating(src.q3_5),
      q4_1: clampRating(src.q4_1), q4_2: clampRating(src.q4_2), q4_3: clampRating(src.q4_3), q4_4: clampRating(src.q4_4), q4_5: clampRating(src.q4_5),
      q5_1: clampRating(src.q5_1), q5_2: clampRating(src.q5_2), q5_3: clampRating(src.q5_3), q5_4: clampRating(src.q5_4), q5_5: clampRating(src.q5_5),
      fortalezas: safeFortalezas || null,
      areas_mejora: safeAreasMejora || null,
      recomendaria: safeRecomendaria,
      desempeno_general: safeDesempeno,
      comentarios: safeComentarios || null,
      language: src.language === 'en' ? 'en' : 'es',
      answers: {
        is_lead_role: Boolean(rawAnswers.is_lead_role),
        location_name: safeLocationName || undefined,
        custom_role: rawAnswers.custom_role ? escapeHtml(rawAnswers.custom_role, 120) : undefined
      }
    }

    const result = await sendStaffEvaluationEmail(payload, verifiedCustomRecipients)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Error al despachar el correo a Dirección General.'
        },
        { status: 500 }
      )
    }

    recentEvalNotifyMap.set(dedupKey, Date.now())

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      recipients: result.recipients,
      notifiedAt: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[API /api/evaluacion/notify] Error procesando notificación:', error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Error interno del servidor al procesar notificación.'
      },
      { status: 500 }
    )
  }
}
