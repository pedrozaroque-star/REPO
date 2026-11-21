/**
 * @module api/basecamp/webhook
 * @description Receptor en tiempo real (Webhook Endpoint) para eventos push de Basecamp 3.
 *              Recibe notificaciones instantáneas cuando se crean, completan, reabren, editan o eliminan
 *              To-dos, Listas (`Todolist`), Grupos (`Todolist` hijo), Comentarios, Mensajes, Boosts (`🚀`),
 *              Documentos, Líneas de Campfire, Eventos de Schedule o Respuestas de Check-ins en Basecamp,
 *              actualizando Supabase en menos de 1 segundo.
 *
 * @businessRules
 * - **Tiempo Real (< 1s)**: Elimina la espera del Cron para cambios originados directamente en Basecamp.
 * - **Hidratación Completa**: Usa `basecampFetch` contra `recording.url` para obtener la versión completa
 *   del recurso (incluyendo asignados, `starts_on`, `due_on`, `completion_subscribers`, `boosts_count`,
 *   color de lista/grupo y estado `completed`).
 * - **Resolución de Grupos (`bc_todolist_groups`)**: Cuando `fullTodo.parent.id` corresponde a un Grupo hijo,
 *   resuelve tanto `group_id` como su `todolist_id` padre (auto-hidratando el grupo desde Basecamp si aún no existía),
 *   evitando que tareas agrupadas caigan en una lista incorrecta o sean marcadas falsamente como completadas.
 * - **Inversión de Prioridad de Autoría TEG**:
 *   1. `extractedAuthorName` de `stripTegAuthorBanner` resuelto con `findPersonInListByFuzzyName` (Prioridad #1).
 *   2. `created_by_person_id` / `author_person_id` local existente en Supabase (Prioridad #2).
 *   3. `creator` devuelto por Basecamp API (Prioridad #3).
 * - **Notificaciones Externas (`@Menciones` + Email + `bc_notifications`)**: Dispara avisos en vivo para cambios
 *   genuinamente originados en Basecamp 3 sin duplicar acciones ya notificadas desde TEG.
 *
 * @dataFlow
 * - Basecamp 3 Webhook POST → /api/basecamp/webhook → basecampFetch(recording.url) → Upsert en Supabase (`bc_*`)
 *   → Supabase Realtime WebSockets + `bc_notifications` + Email.
 *
 * @notes
 * - Basecamp requiere responder con HTTP 200 rápidamente para no reintentar ni desactivar el webhook.
 * - Blindaje de Seguridad (2026-11-21): valida `BASECAMP_WEBHOOK_SECRET` con `crypto.timingSafeEqual` cuando está configurado y, en modo nativo de Basecamp 3 (`ensureProjectWebhook` sin secreto HMAC nativo), aplica rate limit por IP, lista blanca estricta `https://3.basecampapi.com/<accountId>/...` y verificación obligatoria server-to-server contra la API OAuth de Basecamp (`basecampFetch`) antes de crear, actualizar o eliminar cualquier registro (cero downtime en producción y cero payloads falsificados).
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/auth-server'
import {
  assertSafeBasecampApiUrl,
  basecampFetch,
  resolveHtmlAttachmentsFromCache,
  syncTodolistCounts,
  syncTodolistGroupCounts,
} from '@/lib/basecamp-api'
import {
  stripTegAuthorBanner,
  findPersonInListByFuzzyName,
  isMaskedOrEmptyEmail,
  SYNTHETIC_BC_ID_THRESHOLD,
} from '@/lib/basecamp-person-resolver'
import {
  sendBasecampTodoNotificationEmail,
  sendBasecampMessageNotificationEmail,
  createBasecampInAppNotifications,
  extractMentionedPersonIds,
} from '@/lib/basecamp-todo-email'

export const dynamic = 'force-dynamic'

const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID || '5052386'

function resolveSafeWebhookRecordingPath(
  rawRecordingUrl: unknown,
  bucketBcId: number,
  fallbackRelativePath: string
): string {
  if (!rawRecordingUrl) {
    return fallbackRelativePath
  }
  const safeAbsolute = assertSafeBasecampApiUrl(String(rawRecordingUrl), BASECAMP_ACCOUNT_ID)
  const parsed = new URL(safeAbsolute)
  const expectedPrefix = `/${BASECAMP_ACCOUNT_ID}/buckets/${bucketBcId}/`
  if (!parsed.pathname.startsWith(expectedPrefix)) {
    throw new Error('Blocked Basecamp webhook URL: bucket mismatch')
  }
  return safeAbsolute
}

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}

async function resolvePersonByExtractedName(extractedName: string | null, supabase: any): Promise<string | null> {
  if (!extractedName) return null
  const { data: people } = await supabase.from('bc_people').select('id, name, email').limit(5000)
  if (!people) return null
  const found = findPersonInListByFuzzyName(people, extractedName)
  return found?.id || null
}

async function resolvePersonUuid(creator: any, supabase: any): Promise<string | null> {
  if (!creator?.id) return null
  const bcPersonId = Number(creator.id)

  const { data: existing } = await supabase
    .from('bc_people')
    .select('id, email, attachable_sgid')
    .eq('bc_id', bcPersonId)
    .maybeSingle()

  if (existing?.id) {
    if (!existing.attachable_sgid && creator.attachable_sgid) {
      await supabase
        .from('bc_people')
        .update({ attachable_sgid: creator.attachable_sgid })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const incomingEmail = creator.email_address || ''
  const { data: inserted } = await supabase
    .from('bc_people')
    .upsert(
      {
        bc_id: bcPersonId,
        name: creator.name || 'Unknown',
        email: isMaskedOrEmptyEmail(incomingEmail) ? '' : incomingEmail,
        avatar_url: creator.avatar_url || '',
        role: creator.employee ? 'employee' : creator.client ? 'client' : 'user',
        title: creator.title || '',
        attachable_sgid: creator.attachable_sgid || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'bc_id' }
    )
    .select('id')
    .maybeSingle()

  return inserted?.id || null
}

async function syncWebhookParentCommentsCount(
  supabase: any,
  parentType: 'todo' | 'message' | 'document',
  parentUuid: string
): Promise<void> {
  if (parentType !== 'todo' && parentType !== 'message') return
  const { count, error } = await supabase
    .from('bc_comments')
    .select('*', { count: 'exact', head: true })
    .eq('parent_type', parentType)
    .eq('parent_id', parentUuid)
  if (error) return

  if (parentType === 'todo') {
    await supabase
      .from('bc_todos')
      .update({ comments_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', parentUuid)
  } else {
    await supabase
      .from('bc_messages')
      .update({ comments_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', parentUuid)
  }
}

async function syncWebhookBoostsCount(
  supabase: any,
  recordingType: string,
  recordingUuid: string
): Promise<void> {
  if (!recordingType || !recordingUuid) return
  const { count, error } = await supabase
    .from('bc_boosts')
    .select('*', { count: 'exact', head: true })
    .eq('recording_type', recordingType)
    .eq('recording_id', recordingUuid)
  if (error) return
  const exact = count ?? 0
  if (recordingType === 'todo') {
    await supabase.from('bc_todos').update({ boosts_count: exact }).eq('id', recordingUuid)
  } else if (recordingType === 'comment') {
    await supabase.from('bc_comments').update({ boosts_count: exact }).eq('id', recordingUuid)
  } else if (recordingType === 'message') {
    await supabase.from('bc_messages').update({ boosts_count: exact }).eq('id', recordingUuid)
  }
}

function safeTimingEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    const ha = createHash('sha256').update(bufA).digest()
    const hb = createHash('sha256').update(bufB).digest()
    timingSafeEqual(ha, hb)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

function verifyBasecampWebhookAuth(request: Request, rawBody: string, secret: string): boolean {
  const { searchParams } = new URL(request.url)
  const queryToken = (searchParams.get('token') || searchParams.get('secret') || '').trim()
  if (queryToken && safeTimingEqualStrings(queryToken, secret)) {
    return true
  }

  const headerSecret = (
    request.headers.get('x-basecamp-webhook-secret') ||
    request.headers.get('x-webhook-secret') ||
    ''
  ).trim()
  if (headerSecret && safeTimingEqualStrings(headerSecret, secret)) {
    return true
  }

  const authHeader = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim()
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim()
    if (safeTimingEqualStrings(bearer, secret)) {
      return true
    }
  }

  const rawSig = (request.headers.get('x-basecamp-signature') || request.headers.get('x-hub-signature-256') || '').trim()
  if (rawSig) {
    const cleanedSig = rawSig.replace(/^sha256=/i, '').trim()
    const expectedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const expectedBase64 = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
    if (safeTimingEqualStrings(cleanedSig.toLowerCase(), expectedHex.toLowerCase()) || safeTimingEqualStrings(cleanedSig, expectedBase64)) {
      return true
    }
  }

  return false
}

export async function POST(request: Request) {
  try {
    const clientIp =
      (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || 'unknown')
        .split(',')[0]
        .trim() || 'unknown'
    const rl = checkRateLimit(`basecamp-webhook:${clientIp}`, 180, 60_000)
    if (rl.limited) {
      return NextResponse.json({ error: 'Too many webhook requests' }, { status: 429 })
    }

    const rawBody = await request.text()
    const webhookSecret = (process.env.BASECAMP_WEBHOOK_SECRET || '').trim()
    if (webhookSecret && !verifyBasecampWebhookAuth(request, rawBody, webhookSecret)) {
      return NextResponse.json(
        { error: 'No autorizado: secreto de webhook Basecamp inválido o ausente.' },
        { status: 401 }
      )
    }

    let payload: any = null
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = null
    }
    const targetObj = payload?.recording || payload?.boost
    if (!payload || !targetObj) {
      return NextResponse.json({ received: true, ignored: true })
    }

    const supabase = getAdminSupabase()
    const kind: string = String(payload.kind || '').toLowerCase()
    const recording = targetObj
    const bucketBcId = Number(recording?.bucket?.id || recording?.recording?.bucket?.id || 0)
    const recordingBcId = Number(recording?.id || 0)
    const recordingType: string = String(recording?.type || (payload.boost ? 'Boost' : ''))

    if (!bucketBcId || !recordingBcId || !Number.isInteger(bucketBcId) || !Number.isInteger(recordingBcId)) {
      return NextResponse.json({ received: true, ignored: true })
    }

    // Validate recording.url strictly BEFORE any DB mutation or Basecamp API call
    if (recording?.url !== undefined && recording?.url !== null && String(recording.url).trim() !== '') {
      try {
        resolveSafeWebhookRecordingPath(
          recording.url,
          bucketBcId,
          `/buckets/${bucketBcId}/recordings/${recordingBcId}.json`
        )
      } catch (urlErr: any) {
        console.warn(`🚨 [Basecamp Webhook] Rejected unsafe recording.url:`, urlErr.message)
        return NextResponse.json({ error: 'Forbidden recording URL' }, { status: 403 })
      }
    }

    console.log(`⚡ [Basecamp Webhook] Event "${kind}" on ${recordingType} #${recordingBcId} (Bucket #${bucketBcId})`)

    // Resolve Project UUID
    const { data: projectRow } = await supabase
      .from('bc_projects')
      .select('id')
      .eq('bc_id', bucketBcId)
      .maybeSingle()

    if (!projectRow?.id) {
      return NextResponse.json({ received: true, status: 'project_not_found' })
    }
    const projectUuid = projectRow.id

    // Handle Boost events early (created / deleted)
    if (recordingType === 'Boost' || kind.startsWith('boost_')) {
      const safeBoostUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/boosts/${recordingBcId}.json`
      )

      if (kind.includes('deleted') || kind.includes('trashed')) {
        if (!webhookSecret) {
          let confirmedBoostGone = false
          try {
            await basecampFetch<any>(safeBoostUrl, { noPaginate: true })
          } catch (err: any) {
            if (String(err?.message || '').includes('(404)')) {
              confirmedBoostGone = true
            }
          }
          if (!confirmedBoostGone) {
            return NextResponse.json({ received: true, ignored: true, reason: 'boost_still_exists' })
          }
        }
        const { data: existingBoost } = await supabase
          .from('bc_boosts')
          .select('id, recording_type, recording_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()
        if (existingBoost?.id) {
          await supabase.from('bc_boosts').delete().eq('id', existingBoost.id)
          await syncWebhookBoostsCount(supabase, existingBoost.recording_type, existingBoost.recording_id)
        }
        return NextResponse.json({ received: true, synced: 'boost_deleted', bc_id: recordingBcId })
      }

      let fullBoost: any = null
      try {
        fullBoost = await basecampFetch<any>(safeBoostUrl, { noPaginate: true })
      } catch {
        if (!webhookSecret) {
          return NextResponse.json({ error: 'No autorizado: boost no verificado en Basecamp API' }, { status: 401 })
        }
        fullBoost = recording
      }

      const boostedRec = fullBoost?.recording || recording?.recording || recording?.parent
      const boostedBcId = Number(boostedRec?.id || 0)
      const boostedRawType = String(boostedRec?.type || '').toLowerCase()

      let targetType: 'todo' | 'comment' | 'message' | 'document' | null = null
      let targetUuid: string | null = null

      if (boostedBcId > 0) {
        if (boostedRawType.includes('comment')) {
          targetType = 'comment'
          const { data: r } = await supabase.from('bc_comments').select('id').eq('bc_id', boostedBcId).maybeSingle()
          targetUuid = r?.id || null
        } else if (boostedRawType.includes('message')) {
          targetType = 'message'
          const { data: r } = await supabase.from('bc_messages').select('id').eq('bc_id', boostedBcId).maybeSingle()
          targetUuid = r?.id || null
        } else if (boostedRawType.includes('document')) {
          targetType = 'document'
          const { data: r } = await supabase.from('bc_documents').select('id').eq('bc_id', boostedBcId).maybeSingle()
          targetUuid = r?.id || null
        } else {
          targetType = 'todo'
          const { data: r } = await supabase.from('bc_todos').select('id').eq('bc_id', boostedBcId).maybeSingle()
          targetUuid = r?.id || null
        }
      }

      if (targetType && targetUuid) {
        const boosterUuid = await resolvePersonUuid(fullBoost?.booster || payload.creator, supabase)
        await supabase.from('bc_boosts').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            recording_type: targetType,
            recording_id: targetUuid,
            booster_person_id: boosterUuid,
            content: String(fullBoost?.content || recording?.content || '👍').slice(0, 16),
            created_at: fullBoost?.created_at || new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )
        await syncWebhookBoostsCount(supabase, targetType, targetUuid)
      }

      return NextResponse.json({ received: true, synced: 'boost', bc_id: recordingBcId })
    }

    // Handle Trashed / Archived recordings — verify against Basecamp API before deleting local rows
    if (kind.endsWith('_trashed') || recording.status === 'trashed') {
      const checkPath = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/recordings/${recordingBcId}.json`
      )
      let confirmedTrashed = false
      try {
        const remoteRec = await basecampFetch<any>(checkPath, { noPaginate: true })
        confirmedTrashed = remoteRec?.status === 'trashed' || remoteRec?.status === 'archived'
      } catch (err: any) {
        if (String(err?.message || '').includes('(404)')) {
          confirmedTrashed = true
        }
      }

      if (!confirmedTrashed) {
        return NextResponse.json({ received: true, ignored: true, reason: 'not_confirmed_trashed' })
      }

      if (recordingType === 'Todo') {
        const { data: todoRow } = await supabase
          .from('bc_todos')
          .select('id, todolist_id, group_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()
        if (todoRow?.id) {
          await Promise.all([
            supabase.from('bc_todo_assignees').delete().eq('todo_id', todoRow.id),
            supabase.from('bc_comments').delete().eq('parent_type', 'todo').eq('parent_id', todoRow.id),
            supabase.from('bc_boosts').delete().eq('recording_type', 'todo').eq('recording_id', todoRow.id),
            supabase.from('bc_notifications').delete().eq('recording_type', 'todo').eq('recording_id', todoRow.id),
          ])
          await supabase.from('bc_todos').delete().eq('id', todoRow.id)
          await Promise.all([
            syncTodolistCounts(supabase, todoRow.todolist_id),
            syncTodolistGroupCounts(supabase, todoRow.group_id),
          ])
        }
      } else if (recordingType === 'Todolist') {
        const { data: grpRow } = await supabase
          .from('bc_todolist_groups')
          .select('id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()
        if (grpRow?.id) {
          await supabase.from('bc_todos').update({ group_id: null }).eq('group_id', grpRow.id)
          await supabase.from('bc_todolist_groups').delete().eq('id', grpRow.id)
        } else {
          const { data: listRow } = await supabase
            .from('bc_todolists')
            .select('id')
            .eq('bc_id', recordingBcId)
            .maybeSingle()
          if (listRow?.id) {
            await supabase.from('bc_todolists').delete().eq('id', listRow.id)
          }
        }
      } else if (recordingType === 'Comment') {
        const { data: comRow } = await supabase
          .from('bc_comments')
          .select('id, parent_type, parent_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()
        if (comRow?.id) {
          await supabase.from('bc_boosts').delete().eq('recording_type', 'comment').eq('recording_id', comRow.id)
        }
        await supabase.from('bc_comments').delete().eq('bc_id', recordingBcId)
        if (comRow?.parent_id && (comRow.parent_type === 'todo' || comRow.parent_type === 'message')) {
          await syncWebhookParentCommentsCount(supabase, comRow.parent_type, comRow.parent_id)
        }
      } else if (recordingType === 'Message') {
        const { data: msgRow } = await supabase.from('bc_messages').select('id').eq('bc_id', recordingBcId).maybeSingle()
        if (msgRow?.id) {
          await Promise.all([
            supabase.from('bc_comments').delete().eq('parent_type', 'message').eq('parent_id', msgRow.id),
            supabase.from('bc_boosts').delete().eq('recording_type', 'message').eq('recording_id', msgRow.id),
            supabase.from('bc_notifications').delete().eq('recording_type', 'message').eq('recording_id', msgRow.id),
          ])
          await supabase.from('bc_messages').delete().eq('id', msgRow.id)
        }
      } else if (recordingType === 'Document') {
        const { data: docRow } = await supabase.from('bc_documents').select('id').eq('bc_id', recordingBcId).maybeSingle()
        if (docRow?.id) {
          await Promise.all([
            supabase.from('bc_comments').delete().eq('parent_type', 'document').eq('parent_id', docRow.id),
            supabase.from('bc_boosts').delete().eq('recording_type', 'document').eq('recording_id', docRow.id),
          ])
          await supabase.from('bc_documents').delete().eq('id', docRow.id)
        }
      } else if (recordingType === 'Upload') {
        await supabase.from('bc_uploads').delete().eq('bc_id', recordingBcId)
      } else if (recordingType === 'Schedule::Entry') {
        await supabase.from('bc_schedule_entries').delete().eq('bc_id', recordingBcId)
      } else if (recordingType === 'Question::Answer') {
        await supabase.from('bc_answers').delete().eq('bc_id', recordingBcId)
      } else if (recordingType === 'Campfire::Line') {
        await supabase.from('bc_campfire_lines').delete().eq('bc_id', recordingBcId)
      }
      return NextResponse.json({ received: true, action: 'deleted_trashed' })
    }

    // 1. Handle TODOLIST & TODOLIST GROUP events
    if (recordingType === 'Todolist' || kind.startsWith('todolist_')) {
      const safeListUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/todolists/${recordingBcId}.json`
      )
      const fullList = await basecampFetch<any>(safeListUrl, { noPaginate: true })

      // In Basecamp 3 API, a Todolist Group has parent.type === 'Todolist'
      if (String(fullList?.parent?.type || '') === 'Todolist') {
        const parentListBcId = Number(fullList?.parent?.id || 0)
        const { data: parentListRow } = await supabase
          .from('bc_todolists')
          .select('id')
          .eq('bc_id', parentListBcId)
          .maybeSingle()

        if (parentListRow?.id) {
          await supabase.from('bc_todolist_groups').upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              todolist_id: parentListRow.id,
              name: fullList.title || fullList.name || 'Group',
              color: fullList.color || null,
              position: fullList.position ?? 1,
              completed_count: parseInt(fullList.completed_ratio?.split('/')[0] || '0', 10),
              total_count: parseInt(fullList.completed_ratio?.split('/')[1] || '0', 10),
              created_at: fullList.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'bc_id' }
          )
        }
        return NextResponse.json({ received: true, synced: 'todolist_group', bc_id: recordingBcId })
      }

      const { data: todosetRow } = await supabase
        .from('bc_todosets')
        .select('id')
        .eq('project_id', projectUuid)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (todosetRow?.id) {
        const rawListDesc = await resolveHtmlAttachmentsFromCache(fullList.description || '', supabase)
        const { cleanHtml: cleanListDesc } = stripTegAuthorBanner(rawListDesc)

        await supabase.from('bc_todolists').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            todoset_id: todosetRow.id,
            name: fullList.title || fullList.name || 'To-dos',
            description: cleanListDesc,
            color: fullList.color || null,
            bc_completed_ratio: fullList.completed_ratio || null,
            position: fullList.position ?? 1,
            completed_count: parseInt(fullList.completed_ratio?.split('/')[0] || '0', 10),
            total_count: parseInt(fullList.completed_ratio?.split('/')[1] || '0', 10),
            created_at: fullList.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )
      }

      return NextResponse.json({ received: true, synced: 'todolist', bc_id: recordingBcId })
    }

    // 2. Handle TODO events (created, completed, uncompleted, changed, moved)
    if (recordingType === 'Todo' || kind.startsWith('todo_')) {
      const safeTodoUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/todos/${recordingBcId}.json`
      )
      const fullTodo = await basecampFetch<any>(safeTodoUrl, { noPaginate: true })

      const parentBcId = Number(fullTodo?.parent?.id || recording?.parent?.id || 0)
      let todolistUuid: string | null = null
      let groupUuid: string | null = null

      if (parentBcId) {
        const { data: listRow } = await supabase
          .from('bc_todolists')
          .select('id')
          .eq('bc_id', parentBcId)
          .maybeSingle()
        if (listRow?.id) {
          todolistUuid = listRow.id
        } else {
          // Check if parent is a Todolist Group (bc_todolist_groups)!
          const { data: grpRow } = await supabase
            .from('bc_todolist_groups')
            .select('id, todolist_id')
            .eq('bc_id', parentBcId)
            .maybeSingle()
          if (grpRow?.id) {
            groupUuid = grpRow.id
            todolistUuid = grpRow.todolist_id
          } else {
            // Auto-hydrate unknown parent Todolist / Group from Basecamp API on out-of-order webhooks
            try {
              const remoteParent = await basecampFetch<any>(
                `/buckets/${bucketBcId}/todolists/${parentBcId}.json`,
                { noPaginate: true }
              )
              if (String(remoteParent?.parent?.type || '') === 'Todolist') {
                const rootListBcId = Number(remoteParent.parent.id || 0)
                const { data: rootListRow } = await supabase
                  .from('bc_todolists')
                  .select('id')
                  .eq('bc_id', rootListBcId)
                  .maybeSingle()
                if (rootListRow?.id) {
                  const { data: insertedGrp } = await supabase
                    .from('bc_todolist_groups')
                    .upsert(
                      {
                        bc_id: parentBcId,
                        project_id: projectUuid,
                        todolist_id: rootListRow.id,
                        name: remoteParent.title || remoteParent.name || 'Group',
                        color: remoteParent.color || null,
                        position: remoteParent.position ?? 1,
                        updated_at: new Date().toISOString(),
                      },
                      { onConflict: 'bc_id' }
                    )
                    .select('id')
                    .maybeSingle()
                  groupUuid = insertedGrp?.id || null
                  todolistUuid = rootListRow.id
                }
              }
            } catch {
              // Ignore parent hydration failure and use safe fallback below
            }
          }
        }
      }

      if (!todolistUuid) {
        const { data: fallbackList } = await supabase
          .from('bc_todolists')
          .select('id')
          .eq('project_id', projectUuid)
          .order('position', { ascending: true })
          .limit(1)
          .maybeSingle()
        todolistUuid = fallbackList?.id || null
      }

      if (todolistUuid) {
        const isCompleted =
          kind === 'todo_completed'
            ? true
            : kind === 'todo_uncompleted'
            ? false
            : Boolean(fullTodo.completed)

        const rawDesc = await resolveHtmlAttachmentsFromCache(fullTodo.description ?? '', supabase)
        const { cleanHtml: resolvedTodoDescription, extractedAuthorName } = stripTegAuthorBanner(rawDesc)

        const [{ data: existingTodo }, { data: allPeopleRows }] = await Promise.all([
          supabase
            .from('bc_todos')
            .select(
              'id, todolist_id, group_id, description, created_by_person_id, is_completed, completion_subscriber_ids'
            )
            .eq('bc_id', recordingBcId)
            .maybeSingle(),
          supabase.from('bc_people').select('id, bc_id, name, email, is_active, attachable_sgid').limit(5000),
        ])

        const allPeople = allPeopleRows || []
        const webhookActorUuid = await resolvePersonUuid(payload.creator || fullTodo.creator, supabase)
        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingTodo?.created_by_person_id ||
          webhookActorUuid

        // Resolve completion_subscribers preserving synthetic UUIDs
        const compSubIds = new Set<string>()
        if (Array.isArray(existingTodo?.completion_subscriber_ids)) {
          for (const uid of existingTodo.completion_subscriber_ids) {
            const p = allPeople.find((row: any) => row.id === uid)
            if (p && Number(p.bc_id) >= SYNTHETIC_BC_ID_THRESHOLD) compSubIds.add(uid)
          }
        }
        for (const cs of fullTodo.completion_subscribers || []) {
          const csUuid = await resolvePersonUuid(cs, supabase)
          if (csUuid) compSubIds.add(csUuid)
        }

        const todoTitle = fullTodo.content || fullTodo.title || recording.title || 'Untitled'

        const { data: dbTodo } = await supabase
          .from('bc_todos')
          .upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              todolist_id: todolistUuid,
              group_id: groupUuid,
              title: todoTitle,
              description: resolvedTodoDescription,
              is_completed: isCompleted,
              completed_at: isCompleted ? fullTodo.updated_at || new Date().toISOString() : null,
              starts_on: fullTodo.starts_on || null,
              due_date: fullTodo.due_on || null,
              completion_subscriber_ids: Array.from(compSubIds),
              boosts_count: Number(fullTodo.boosts_count || 0),
              position: fullTodo.position ?? 1,
              comments_count: fullTodo.comments_count ?? 0,
              created_by_person_id: authorUuid,
              created_at: fullTodo.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'bc_id' }
          )
          .select('id')
          .maybeSingle()

        const mergedPersonIds = new Set<string>()
        if (dbTodo?.id && Array.isArray(fullTodo.assignees)) {
          const { data: existingAssignees } = await supabase
            .from('bc_todo_assignees')
            .select('person_id, person:bc_people(bc_id)')
            .eq('todo_id', dbTodo.id)

          for (const ea of existingAssignees || []) {
            const pRel: any = Array.isArray(ea.person) ? ea.person[0] : ea.person
            const personBcId = Number(pRel?.bc_id || 0)
            if (ea.person_id && personBcId >= SYNTHETIC_BC_ID_THRESHOLD) {
              mergedPersonIds.add(ea.person_id)
            }
          }

          await supabase.from('bc_todo_assignees').delete().eq('todo_id', dbTodo.id)

          for (const a of fullTodo.assignees) {
            const pUuid = await resolvePersonUuid(a, supabase)
            if (pUuid) mergedPersonIds.add(pUuid)
          }

          if (mergedPersonIds.size > 0) {
            const assigneeRows = Array.from(mergedPersonIds).map((pid) => ({
              todo_id: dbTodo.id,
              person_id: pid,
            }))
            await supabase.from('bc_todo_assignees').upsert(assigneeRows, { onConflict: 'todo_id,person_id' })
          }
        }

        await Promise.all([
          syncTodolistCounts(supabase, todolistUuid),
          existingTodo?.todolist_id && existingTodo.todolist_id !== todolistUuid
            ? syncTodolistCounts(supabase, existingTodo.todolist_id)
            : Promise.resolve(),
          syncTodolistGroupCounts(supabase, groupUuid),
          existingTodo?.group_id && existingTodo.group_id !== groupUuid
            ? syncTodolistGroupCounts(supabase, existingTodo.group_id)
            : Promise.resolve(),
        ])

        // Notify involved TEG staff ONLY for genuine external Basecamp 3 events (never echo TEG actions)
        if (dbTodo?.id && !extractedAuthorName) {
          const webhookActorName = payload.creator?.name || fullTodo.creator?.name || 'Basecamp'
          const reqOrigin = new URL(request.url).origin
          const prevMentions = new Set(extractMentionedPersonIds(existingTodo?.description || '', allPeople))
          const newlyMentioned = extractMentionedPersonIds(resolvedTodoDescription, allPeople).filter(
            (uid) => !prevMentions.has(uid)
          )

          if (!existingTodo && kind === 'todo_created') {
            await Promise.all([
              createBasecampInAppNotifications({
                projectUuid,
                recordingType: 'todo',
                recordingUuid: dbTodo.id,
                actorPersonId: webhookActorUuid,
                actorName: webhookActorName,
                title: todoTitle,
                rawHtml: resolvedTodoDescription,
                assignedPersonIds: Array.from(mergedPersonIds),
                defaultType: 'assigned',
              }),
              sendBasecampTodoNotificationEmail({
                event: 'assigned',
                todoDbId: dbTodo.id,
                actorPersonId: webhookActorUuid,
                actorName: webhookActorName,
                appOrigin: reqOrigin,
              }),
            ])
          } else if (existingTodo && Boolean(existingTodo.is_completed) !== isCompleted) {
            await Promise.all([
              isCompleted
                ? createBasecampInAppNotifications({
                    projectUuid,
                    recordingType: 'todo',
                    recordingUuid: dbTodo.id,
                    actorPersonId: webhookActorUuid,
                    actorName: webhookActorName,
                    title: todoTitle,
                    involvedPersonIds: [
                      ...Array.from(mergedPersonIds),
                      ...(authorUuid ? [authorUuid] : []),
                      ...Array.from(compSubIds),
                    ],
                    defaultType: 'completed',
                  })
                : Promise.resolve(null),
              sendBasecampTodoNotificationEmail({
                event: isCompleted ? 'completed' : 'reopened',
                todoDbId: dbTodo.id,
                actorPersonId: webhookActorUuid,
                actorName: webhookActorName,
                appOrigin: reqOrigin,
              }),
            ])
          } else if (existingTodo && (kind === 'todo_assignment_changed' || newlyMentioned.length > 0)) {
            await Promise.all([
              createBasecampInAppNotifications({
                projectUuid,
                recordingType: 'todo',
                recordingUuid: dbTodo.id,
                actorPersonId: webhookActorUuid,
                actorName: webhookActorName,
                title: todoTitle,
                rawHtml: resolvedTodoDescription,
                mentionedPersonIds: newlyMentioned,
                assignedPersonIds: kind === 'todo_assignment_changed' ? Array.from(mergedPersonIds) : [],
                defaultType: newlyMentioned.length > 0 ? 'mention' : 'assigned',
              }),
              sendBasecampTodoNotificationEmail({
                event: kind === 'todo_assignment_changed' ? 'assigned' : 'updated',
                todoDbId: dbTodo.id,
                actorPersonId: webhookActorUuid,
                actorName: webhookActorName,
                excludeActorOnAssigned: true,
                appOrigin: reqOrigin,
              }),
            ])
          }
        }
      }

      return NextResponse.json({ received: true, synced: 'todo', bc_id: recordingBcId })
    }

    // 3. Handle COMMENT events (comment_created, comment_changed)
    if (recordingType === 'Comment' || kind.startsWith('comment_')) {
      const safeCommentUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/comments/${recordingBcId}.json`
      )
      const fullComment = await basecampFetch<any>(safeCommentUrl, { noPaginate: true })

      const parentBcId = Number(fullComment?.parent?.id || recording?.parent?.id || 0)
      const parentRawType = String(fullComment?.parent?.type || recording?.parent?.type || '').toLowerCase()

      let parentType: 'todo' | 'message' | 'document' = 'todo'
      let parentUuid: string | null = null
      let parentTitle = 'Nuevo comentario'
      let parentAuthorPersonId: string | null = null

      if (parentRawType.includes('message')) {
        parentType = 'message'
        const { data: msg } = await supabase
          .from('bc_messages')
          .select('id, title, author_person_id')
          .eq('bc_id', parentBcId)
          .maybeSingle()
        parentUuid = msg?.id || null
        if (msg?.title) parentTitle = msg.title
        parentAuthorPersonId = msg?.author_person_id || null
      } else if (parentRawType.includes('document')) {
        parentType = 'document'
        const { data: doc } = await supabase
          .from('bc_documents')
          .select('id, title')
          .eq('bc_id', parentBcId)
          .maybeSingle()
        parentUuid = doc?.id || null
        if (doc?.title) parentTitle = doc.title
      } else {
        parentType = 'todo'
        const { data: todo } = await supabase
          .from('bc_todos')
          .select('id, title')
          .eq('bc_id', parentBcId)
          .maybeSingle()
        parentUuid = todo?.id || null
        if (todo?.title) parentTitle = todo.title
      }

      if (parentUuid) {
        const rawCommentHtml = await resolveHtmlAttachmentsFromCache(
          fullComment.content || recording.content || '',
          supabase
        )
        const { cleanHtml: resolvedCommentContent, extractedAuthorName } = stripTegAuthorBanner(rawCommentHtml)

        const [{ data: existingComment }, { data: allPeopleRows }] = await Promise.all([
          supabase
            .from('bc_comments')
            .select('id, content, author_person_id')
            .eq('bc_id', recordingBcId)
            .maybeSingle(),
          supabase.from('bc_people').select('id, bc_id, name, email, is_active, attachable_sgid').limit(5000),
        ])

        let matchedInFlightComment: { id: string; content: string | null; author_person_id: string | null } | null =
          null
        if (!existingComment) {
          const recentCutoff = new Date(Date.now() - 45_000).toISOString()
          const { data: inFlightCom } = await supabase
            .from('bc_comments')
            .select('id, content, author_person_id')
            .eq('project_id', projectUuid)
            .eq('parent_type', parentType)
            .eq('parent_id', parentUuid)
            .gte('bc_id', SYNTHETIC_BC_ID_THRESHOLD)
            .gte('created_at', recentCutoff)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (inFlightCom?.id) {
            matchedInFlightComment = inFlightCom
          }
        }

        const allPeople = allPeopleRows || []
        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingComment?.author_person_id ||
          matchedInFlightComment?.author_person_id ||
          (await resolvePersonUuid(fullComment.creator || payload.creator, supabase))

        if (matchedInFlightComment) {
          await supabase
            .from('bc_comments')
            .update({
              bc_id: recordingBcId,
              boosts_count: Number(fullComment.boosts_count || 0),
              updated_at: fullComment.updated_at || new Date().toISOString(),
            })
            .eq('id', matchedInFlightComment.id)
        } else {
          await supabase.from('bc_comments').upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              parent_type: parentType,
              parent_id: parentUuid,
              content: resolvedCommentContent,
              author_person_id: authorUuid,
              boosts_count: Number(fullComment.boosts_count || 0),
              created_at: fullComment.created_at || new Date().toISOString(),
              updated_at: fullComment.updated_at || new Date().toISOString(),
            },
            { onConflict: 'bc_id' }
          )
        }

        await syncWebhookParentCommentsCount(supabase, parentType, parentUuid)

        if (!extractedAuthorName && !matchedInFlightComment) {
          const commentActorName = fullComment.creator?.name || payload.creator?.name || 'Basecamp'
          const prevMentions = new Set(extractMentionedPersonIds(existingComment?.content || '', allPeople))
          const newlyMentioned = extractMentionedPersonIds(resolvedCommentContent, allPeople).filter(
            (uid) => !prevMentions.has(uid)
          )

          if (!existingComment || newlyMentioned.length > 0) {
            const reqOrigin = new URL(request.url).origin
            const involvedForComment =
              !existingComment && parentType === 'message' && parentAuthorPersonId ? [parentAuthorPersonId] : []

            await Promise.all([
              createBasecampInAppNotifications({
                projectUuid,
                recordingType: parentType,
                recordingUuid: parentUuid,
                actorPersonId: authorUuid,
                actorName: commentActorName,
                title: parentTitle,
                rawHtml: !existingComment ? resolvedCommentContent : undefined,
                mentionedPersonIds: newlyMentioned,
                involvedPersonIds: involvedForComment,
                defaultType: newlyMentioned.length > 0 && existingComment ? 'mention' : 'comment',
              }),
              parentType === 'todo'
                ? sendBasecampTodoNotificationEmail({
                    event: 'commented',
                    todoDbId: parentUuid,
                    actorPersonId: authorUuid,
                    actorName: commentActorName,
                    commentHtml: resolvedCommentContent,
                    appOrigin: reqOrigin,
                  })
                : parentType === 'message'
                ? sendBasecampMessageNotificationEmail({
                    event: 'commented',
                    messageDbId: parentUuid,
                    actorPersonId: authorUuid,
                    actorName: commentActorName,
                    commentHtml: resolvedCommentContent,
                    ...(existingComment
                      ? { mentionedPersonIdsOverride: newlyMentioned, onlyMentionedOnComment: true }
                      : {}),
                    appOrigin: reqOrigin,
                    skipInAppNotifications: true,
                  })
                : Promise.resolve(null),
            ])
          }
        }
      }

      return NextResponse.json({ received: true, synced: 'comment', bc_id: recordingBcId })
    }

    // 4. Handle MESSAGE events
    if (recordingType === 'Message' || kind.startsWith('message_')) {
      const safeMsgUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/messages/${recordingBcId}.json`
      )
      const fullMsg = await basecampFetch<any>(safeMsgUrl, { noPaginate: true })

      const parentBoardBcId = Number(fullMsg?.parent?.id || recording?.parent?.id || 0)
      let boardUuid: string | null = null
      if (parentBoardBcId) {
        const { data: exactBoard } = await supabase
          .from('bc_message_boards')
          .select('id')
          .eq('bc_id', parentBoardBcId)
          .maybeSingle()
        boardUuid = exactBoard?.id || null
      }
      if (!boardUuid) {
        const { data: boardRow } = await supabase
          .from('bc_message_boards')
          .select('id')
          .eq('project_id', projectUuid)
          .limit(1)
          .maybeSingle()
        boardUuid = boardRow?.id || null
      }

      if (boardUuid) {
        const rawMsgHtml = await resolveHtmlAttachmentsFromCache(fullMsg.content || '', supabase)
        const { cleanHtml: resolvedMsgContent, extractedAuthorName } = stripTegAuthorBanner(rawMsgHtml)

        const [{ data: existingMsg }, { data: allPeopleRows }] = await Promise.all([
          supabase
            .from('bc_messages')
            .select('id, content, category, author_person_id, is_pinned')
            .eq('bc_id', recordingBcId)
            .maybeSingle(),
          supabase.from('bc_people').select('id, bc_id, name, email, is_active, attachable_sgid').limit(5000),
        ])

        const msgTitle = fullMsg.subject || fullMsg.title || recording.title || 'Untitled'

        let matchedInFlightMsg: {
          id: string
          content: string | null
          category: string | null
          author_person_id: string | null
          is_pinned: boolean | null
        } | null = null
        if (!existingMsg) {
          const recentCutoff = new Date(Date.now() - 45_000).toISOString()
          const { data: inFlightMsg } = await supabase
            .from('bc_messages')
            .select('id, content, category, author_person_id, is_pinned')
            .eq('project_id', projectUuid)
            .eq('title', msgTitle)
            .gte('bc_id', SYNTHETIC_BC_ID_THRESHOLD)
            .gte('created_at', recentCutoff)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (inFlightMsg?.id) {
            matchedInFlightMsg = inFlightMsg
          }
        }

        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingMsg?.author_person_id ||
          matchedInFlightMsg?.author_person_id ||
          (await resolvePersonUuid(fullMsg.creator || payload.creator, supabase))

        const preservedPinned =
          typeof fullMsg.pinned === 'boolean'
            ? fullMsg.pinned
            : Boolean(existingMsg?.is_pinned ?? matchedInFlightMsg?.is_pinned)
        const preservedCategory =
          fullMsg.category?.name || existingMsg?.category || matchedInFlightMsg?.category || 'General'

        let upsertedMsgId: string | null = null
        if (matchedInFlightMsg) {
          await supabase
            .from('bc_messages')
            .update({
              bc_id: recordingBcId,
              comments_count: fullMsg.comments_count || 0,
              boosts_count: Number(fullMsg.boosts_count || 0),
            })
            .eq('id', matchedInFlightMsg.id)
          upsertedMsgId = matchedInFlightMsg.id
        } else {
          const { data: upsertedMsg } = await supabase
            .from('bc_messages')
            .upsert(
              {
                bc_id: recordingBcId,
                project_id: projectUuid,
                board_id: boardUuid,
                title: msgTitle,
                content: resolvedMsgContent,
                category: preservedCategory,
                is_pinned: preservedPinned,
                author_person_id: authorUuid,
                comments_count: fullMsg.comments_count || 0,
                boosts_count: Number(fullMsg.boosts_count || 0),
                created_at: fullMsg.created_at || new Date().toISOString(),
                updated_at: fullMsg.updated_at || new Date().toISOString(),
              },
              { onConflict: 'bc_id' }
            )
            .select('id')
            .maybeSingle()
          upsertedMsgId = upsertedMsg?.id || null
        }

        if (upsertedMsgId && !extractedAuthorName && !matchedInFlightMsg) {
          const msgActorName = fullMsg.creator?.name || payload.creator?.name || 'Basecamp'
          const allPeople = allPeopleRows || []
          if (!existingMsg) {
            const { data: memRows } = await supabase
              .from('bc_memberships')
              .select('person_id')
              .eq('project_id', projectUuid)
            const memberPersonIds = (memRows || []).map((r: any) => r.person_id).filter(Boolean)
            await createBasecampInAppNotifications({
              projectUuid,
              recordingType: 'message',
              recordingUuid: upsertedMsgId,
              actorPersonId: authorUuid,
              actorName: msgActorName,
              title: msgTitle,
              rawHtml: resolvedMsgContent,
              involvedPersonIds: memberPersonIds,
              defaultType: 'message',
            })
          } else {
            const prevMentions = new Set(extractMentionedPersonIds(existingMsg.content || '', allPeople))
            const newlyMentioned = extractMentionedPersonIds(resolvedMsgContent, allPeople).filter(
              (uid) => !prevMentions.has(uid)
            )
            if (newlyMentioned.length > 0) {
              await createBasecampInAppNotifications({
                projectUuid,
                recordingType: 'message',
                recordingUuid: upsertedMsgId,
                actorPersonId: authorUuid,
                actorName: msgActorName,
                title: msgTitle,
                mentionedPersonIds: newlyMentioned,
                defaultType: 'mention',
              })
            }
          }
        }
      }

      return NextResponse.json({ received: true, synced: 'message', bc_id: recordingBcId })
    }

    // 5. Handle DOCUMENT events
    if (recordingType === 'Document' || kind.startsWith('document_')) {
      const safeDocUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/documents/${recordingBcId}.json`
      )
      const fullDoc = await basecampFetch<any>(safeDocUrl, { noPaginate: true })

      const parentVaultBcId = Number(fullDoc?.parent?.id || recording?.parent?.id || 0)
      let vaultUuid: string | null = null
      if (parentVaultBcId) {
        const { data: vaultRow } = await supabase
          .from('bc_vaults')
          .select('id')
          .eq('bc_id', parentVaultBcId)
          .maybeSingle()
        vaultUuid = vaultRow?.id || null
      }
      if (!vaultUuid) {
        const { data: rootVault } = await supabase
          .from('bc_vaults')
          .select('id')
          .eq('project_id', projectUuid)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        vaultUuid = rootVault?.id || null
      }

      if (vaultUuid) {
        const rawDocHtml = await resolveHtmlAttachmentsFromCache(fullDoc.content || '', supabase)
        const { cleanHtml: resolvedDocContent, extractedAuthorName } = stripTegAuthorBanner(rawDocHtml)

        const { data: existingDoc } = await supabase
          .from('bc_documents')
          .select('id, author_person_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()

        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingDoc?.author_person_id ||
          (await resolvePersonUuid(fullDoc.creator || payload.creator, supabase))

        await supabase.from('bc_documents').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            vault_id: vaultUuid,
            title: fullDoc.title || recording.title || 'Untitled',
            content: resolvedDocContent,
            author_person_id: authorUuid,
            created_at: fullDoc.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )
      }

      return NextResponse.json({ received: true, synced: 'document', bc_id: recordingBcId })
    }

    // 6. Handle CAMPFIRE::LINE events
    if (recordingType === 'Campfire::Line' || kind.startsWith('campfire_line_')) {
      const parentChatBcId = Number(recording?.parent?.id || 0)
      if (parentChatBcId) {
        const safeLineUrl = resolveSafeWebhookRecordingPath(
          recording.url,
          bucketBcId,
          `/buckets/${bucketBcId}/chats/${parentChatBcId}/lines/${recordingBcId}.json`
        )
        const fullLine = await basecampFetch<any>(safeLineUrl, { noPaginate: true })

        const { data: campfireRow } = await supabase
          .from('bc_campfires')
          .select('id')
          .eq('bc_id', parentChatBcId)
          .maybeSingle()

        if (campfireRow?.id) {
          const rawLineHtml = await resolveHtmlAttachmentsFromCache(
            fullLine.content || recording.content || '',
            supabase
          )
          const { cleanHtml: resolvedLineContent, extractedAuthorName } = stripTegAuthorBanner(rawLineHtml)

          const { data: existingLine } = await supabase
            .from('bc_campfire_lines')
            .select('id, author_person_id')
            .eq('bc_id', recordingBcId)
            .maybeSingle()

          const authorUuid =
            (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
            existingLine?.author_person_id ||
            (await resolvePersonUuid(fullLine.creator || payload.creator, supabase))

          await supabase.from('bc_campfire_lines').upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              campfire_id: campfireRow.id,
              content: resolvedLineContent,
              author_person_id: authorUuid,
              created_at: fullLine.created_at || new Date().toISOString(),
            },
            { onConflict: 'bc_id' }
          )
        }
      }

      return NextResponse.json({ received: true, synced: 'campfire_line', bc_id: recordingBcId })
    }

    // 7. Handle SCHEDULE::ENTRY events
    if (recordingType === 'Schedule::Entry' || kind.startsWith('schedule_entry_')) {
      const safeEntryUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/schedule_entries/${recordingBcId}.json`
      )
      const fullEntry = await basecampFetch<any>(safeEntryUrl, { noPaginate: true })

      const { data: scheduleRow } = await supabase
        .from('bc_schedules')
        .select('id')
        .eq('project_id', projectUuid)
        .limit(1)
        .maybeSingle()

      if (scheduleRow?.id) {
        const rawEntryHtml = await resolveHtmlAttachmentsFromCache(fullEntry.description || '', supabase)
        const { cleanHtml: resolvedEntryDesc, extractedAuthorName } = stripTegAuthorBanner(rawEntryHtml)

        const { data: existingEntry } = await supabase
          .from('bc_schedule_entries')
          .select('id, author_person_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()

        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingEntry?.author_person_id ||
          (await resolvePersonUuid(fullEntry.creator || payload.creator, supabase))

        await supabase.from('bc_schedule_entries').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            schedule_id: scheduleRow.id,
            title: fullEntry.summary || fullEntry.title || recording.title || 'Untitled',
            description: resolvedEntryDesc,
            starts_at: fullEntry.starts_at || null,
            ends_at: fullEntry.ends_at || null,
            all_day: Boolean(fullEntry.all_day),
            author_person_id: authorUuid,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )
      }

      return NextResponse.json({ received: true, synced: 'schedule_entry', bc_id: recordingBcId })
    }

    // 8. Handle QUESTION::ANSWER events
    if (recordingType === 'Question::Answer' || kind.startsWith('question_answer_')) {
      const safeAnswerUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/question_answers/${recordingBcId}.json`
      )
      const fullAnswer = await basecampFetch<any>(safeAnswerUrl, { noPaginate: true })

      const parentQuestionBcId = Number(fullAnswer?.parent?.id || recording?.parent?.id || 0)
      if (parentQuestionBcId) {
        const { data: qRow } = await supabase
          .from('bc_questions')
          .select('id')
          .eq('bc_id', parentQuestionBcId)
          .maybeSingle()

        if (qRow?.id) {
          const rawAnsHtml = await resolveHtmlAttachmentsFromCache(fullAnswer.content || '', supabase)
          const { cleanHtml: resolvedAnsContent, extractedAuthorName } = stripTegAuthorBanner(rawAnsHtml)

          const { data: existingAns } = await supabase
            .from('bc_answers')
            .select('id, author_person_id')
            .eq('bc_id', recordingBcId)
            .maybeSingle()

          const authorUuid =
            (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
            existingAns?.author_person_id ||
            (await resolvePersonUuid(fullAnswer.creator || payload.creator, supabase))

          await supabase.from('bc_answers').upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              question_id: qRow.id,
              content: resolvedAnsContent,
              author_person_id: authorUuid,
              created_at: fullAnswer.created_at || new Date().toISOString(),
            },
            { onConflict: 'bc_id' }
          )
        }
      }

      return NextResponse.json({ received: true, synced: 'question_answer', bc_id: recordingBcId })
    }

    return NextResponse.json({ received: true, kind, recordingType })
  } catch (error: any) {
    console.error('❌ [Basecamp Webhook] Error processing webhook:', error.message)
    // Return 200 so Basecamp does not disable the webhook on transient errors
    return NextResponse.json({ received: true, error: error.message }, { status: 200 })
  }
}
