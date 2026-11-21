/**
 * @module api/basecamp/webhook
 * @description Receptor en tiempo real (Webhook Endpoint) para eventos push de Basecamp 3.
 *              Recibe notificaciones instantáneas cuando se crean, completan, reabren, editan o eliminan
 *              To-dos, Comentarios, Mensajes, Documentos, Líneas de Campfire, Eventos de Schedule o
 *              Respuestas de Check-ins en Basecamp, actualizando Supabase en menos de 1 segundo.
 *
 * @businessRules
 * - **Tiempo Real (< 1s)**: Elimina la espera del Cron para cambios originados directamente en Basecamp.
 * - **Hidratación Completa**: Usa `basecampFetch` contra `recording.url` para obtener la versión completa
 *   del recurso (incluyendo asignados, descripción HTML, conteo de comentarios y estado `completed`).
 * - **Inversión de Prioridad de Autoría TEG**:
 *   1. `extractedAuthorName` de `stripTegAuthorBanner` resuelto con `findPersonInListByFuzzyName` (Prioridad #1).
 *   2. `created_by_person_id` / `author_person_id` local existente en Supabase (Prioridad #2).
 *   3. `creator` devuelto por Basecamp API (Prioridad #3).
 * - **Preservación de Asignados Locales**: Al actualizar `bc_todo_assignees`, preserva asignados sintéticos
 *   locales (`bc_people.bc_id >= 100_000_000_000`) para no borrar usuarios TEG sin cuenta en Basecamp.
 * - **Reconciliación Idempotente de Contadores**: Recalcula `comments_count` y `completed_count` / `total_count`
 *   con conteos exactos (`count: 'exact', head: true`) en `bc_todos`, `bc_messages` y `bc_todolists`.
 *
 * @dataFlow
 * - Basecamp 3 Webhook POST → /api/basecamp/webhook → basecampFetch(recording.url) → Upsert en Supabase (`bc_*`)
 *   → Supabase Realtime WebSockets → UI en vivo sin recargar página.
 *
 * @notes
 * - Basecamp requiere responder con HTTP 200 rápidamente para no reintentar ni desactivar el webhook.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  assertSafeBasecampApiUrl,
  basecampFetch,
  resolveHtmlAttachmentsFromCache,
  syncTodolistCounts,
} from '@/lib/basecamp-api'
import {
  stripTegAuthorBanner,
  findPersonInListByFuzzyName,
  isMaskedOrEmptyEmail,
  SYNTHETIC_BC_ID_THRESHOLD,
} from '@/lib/basecamp-person-resolver'
import { sendBasecampTodoNotificationEmail } from '@/lib/basecamp-todo-email'

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
    .select('id, email')
    .eq('bc_id', bcPersonId)
    .maybeSingle()

  if (existing?.id) return existing.id

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

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null)
    if (!payload || !payload.recording) {
      return NextResponse.json({ received: true, ignored: true })
    }

    const supabase = getAdminSupabase()
    const kind: string = String(payload.kind || '').toLowerCase()
    const recording = payload.recording
    const bucketBcId = Number(recording?.bucket?.id || 0)
    const recordingBcId = Number(recording?.id || 0)
    const recordingType: string = String(recording?.type || '')

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
          .select('id, todolist_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()
        if (todoRow?.id) {
          await supabase.from('bc_todo_assignees').delete().eq('todo_id', todoRow.id)
          await supabase.from('bc_comments').delete().eq('parent_type', 'todo').eq('parent_id', todoRow.id)
          await supabase.from('bc_todos').delete().eq('id', todoRow.id)
          await syncTodolistCounts(supabase, todoRow.todolist_id)
        }
      } else if (recordingType === 'Comment') {
        const { data: comRow } = await supabase
          .from('bc_comments')
          .select('id, parent_type, parent_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()
        await supabase.from('bc_comments').delete().eq('bc_id', recordingBcId)
        if (comRow?.parent_id && (comRow.parent_type === 'todo' || comRow.parent_type === 'message')) {
          await syncWebhookParentCommentsCount(supabase, comRow.parent_type, comRow.parent_id)
        }
      } else if (recordingType === 'Message') {
        const { data: msgRow } = await supabase.from('bc_messages').select('id').eq('bc_id', recordingBcId).maybeSingle()
        if (msgRow?.id) {
          await supabase.from('bc_comments').delete().eq('parent_type', 'message').eq('parent_id', msgRow.id)
          await supabase.from('bc_messages').delete().eq('id', msgRow.id)
        }
      } else if (recordingType === 'Document') {
        const { data: docRow } = await supabase.from('bc_documents').select('id').eq('bc_id', recordingBcId).maybeSingle()
        if (docRow?.id) {
          await supabase.from('bc_comments').delete().eq('parent_type', 'document').eq('parent_id', docRow.id)
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

    // 1. Handle TODO events (created, completed, uncompleted, changed)
    if (recordingType === 'Todo' || kind.startsWith('todo_')) {
      const safeTodoUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/todos/${recordingBcId}.json`
      )
      const fullTodo = await basecampFetch<any>(safeTodoUrl, { noPaginate: true })

      const parentListBcId = Number(fullTodo?.parent?.id || recording?.parent?.id || 0)
      let todolistUuid: string | null = null
      if (parentListBcId) {
        const { data: listRow } = await supabase
          .from('bc_todolists')
          .select('id')
          .eq('bc_id', parentListBcId)
          .maybeSingle()
        todolistUuid = listRow?.id || null
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

        const { data: existingTodo } = await supabase
          .from('bc_todos')
          .select('id, todolist_id, created_by_person_id, is_completed')
          .eq('bc_id', recordingBcId)
          .maybeSingle()

        // Author Priority Inversion: Priority #1 = extractedAuthorName, #2 = existing local, #3 = Basecamp creator
        const webhookActorUuid = await resolvePersonUuid(payload.creator || fullTodo.creator, supabase)
        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingTodo?.created_by_person_id ||
          webhookActorUuid

        const { data: dbTodo } = await supabase
          .from('bc_todos')
          .upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              todolist_id: todolistUuid,
              title: fullTodo.content || fullTodo.title || recording.title || 'Untitled',
              description: resolvedTodoDescription,
              is_completed: isCompleted,
              completed_at: isCompleted ? fullTodo.updated_at || new Date().toISOString() : null,
              due_date: fullTodo.due_on || null,
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

        if (dbTodo?.id && Array.isArray(fullTodo.assignees)) {
          // Preserve local synthetic assignees (bc_people.bc_id >= SYNTHETIC_BC_ID_THRESHOLD)
          const { data: existingAssignees } = await supabase
            .from('bc_todo_assignees')
            .select('person_id, person:bc_people(bc_id)')
            .eq('todo_id', dbTodo.id)

          const preservedSyntheticIds = new Set<string>()
          for (const ea of existingAssignees || []) {
            const pRel: any = Array.isArray(ea.person) ? ea.person[0] : ea.person
            const personBcId = Number(pRel?.bc_id || 0)
            if (ea.person_id && personBcId >= SYNTHETIC_BC_ID_THRESHOLD) {
              preservedSyntheticIds.add(ea.person_id)
            }
          }

          await supabase.from('bc_todo_assignees').delete().eq('todo_id', dbTodo.id)

          const mergedPersonIds = new Set<string>(preservedSyntheticIds)
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

        await syncTodolistCounts(supabase, todolistUuid)
        if (existingTodo?.todolist_id && existingTodo.todolist_id !== todolistUuid) {
          await syncTodolistCounts(supabase, existingTodo.todolist_id)
        }

        // Notify involved TEG staff ONLY for genuine external Basecamp 3 events (never echo TEG actions)
        if (dbTodo?.id && !extractedAuthorName) {
          const webhookActorName = payload.creator?.name || fullTodo.creator?.name || 'Basecamp'
          const reqOrigin = new URL(request.url).origin
          if (!existingTodo && kind === 'todo_created') {
            await sendBasecampTodoNotificationEmail({
              event: 'assigned',
              todoDbId: dbTodo.id,
              actorPersonId: webhookActorUuid,
              actorName: webhookActorName,
              appOrigin: reqOrigin,
            })
          } else if (existingTodo && Boolean(existingTodo.is_completed) !== isCompleted) {
            await sendBasecampTodoNotificationEmail({
              event: isCompleted ? 'completed' : 'reopened',
              todoDbId: dbTodo.id,
              actorPersonId: webhookActorUuid,
              actorName: webhookActorName,
              appOrigin: reqOrigin,
            })
          } else if (existingTodo && kind === 'todo_assignment_changed') {
            await sendBasecampTodoNotificationEmail({
              event: 'assigned',
              todoDbId: dbTodo.id,
              actorPersonId: webhookActorUuid,
              actorName: webhookActorName,
              appOrigin: reqOrigin,
            })
          }
        }
      }

      return NextResponse.json({ received: true, synced: 'todo', bc_id: recordingBcId })
    }

    // 2. Handle COMMENT events (comment_created, comment_changed)
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

      if (parentRawType.includes('message')) {
        parentType = 'message'
        const { data: msg } = await supabase.from('bc_messages').select('id').eq('bc_id', parentBcId).maybeSingle()
        parentUuid = msg?.id || null
      } else if (parentRawType.includes('document')) {
        parentType = 'document'
        const { data: doc } = await supabase.from('bc_documents').select('id').eq('bc_id', parentBcId).maybeSingle()
        parentUuid = doc?.id || null
      } else {
        parentType = 'todo'
        const { data: todo } = await supabase.from('bc_todos').select('id').eq('bc_id', parentBcId).maybeSingle()
        parentUuid = todo?.id || null
      }

      if (parentUuid) {
        const rawCommentHtml = await resolveHtmlAttachmentsFromCache(
          fullComment.content || recording.content || '',
          supabase
        )
        const { cleanHtml: resolvedCommentContent, extractedAuthorName } = stripTegAuthorBanner(rawCommentHtml)

        const { data: existingComment } = await supabase
          .from('bc_comments')
          .select('id, author_person_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()

        // Priority #1 = extractedAuthorName, #2 = existing local, #3 = Basecamp creator
        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingComment?.author_person_id ||
          (await resolvePersonUuid(fullComment.creator || payload.creator, supabase))

        await supabase.from('bc_comments').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            parent_type: parentType,
            parent_id: parentUuid,
            content: resolvedCommentContent,
            author_person_id: authorUuid,
            created_at: fullComment.created_at || new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )

        await syncWebhookParentCommentsCount(supabase, parentType, parentUuid)

        if (parentType === 'todo' && !existingComment && !extractedAuthorName) {
          const commentActorName = fullComment.creator?.name || payload.creator?.name || 'Basecamp'
          await sendBasecampTodoNotificationEmail({
            event: 'commented',
            todoDbId: parentUuid,
            actorPersonId: authorUuid,
            actorName: commentActorName,
            commentHtml: resolvedCommentContent,
            appOrigin: new URL(request.url).origin,
          })
        }
      }

      return NextResponse.json({ received: true, synced: 'comment', bc_id: recordingBcId })
    }

    // 3. Handle MESSAGE events
    if (recordingType === 'Message' || kind.startsWith('message_')) {
      const safeMsgUrl = resolveSafeWebhookRecordingPath(
        recording.url,
        bucketBcId,
        `/buckets/${bucketBcId}/messages/${recordingBcId}.json`
      )
      const fullMsg = await basecampFetch<any>(safeMsgUrl, { noPaginate: true })

      const { data: boardRow } = await supabase
        .from('bc_message_boards')
        .select('id')
        .eq('project_id', projectUuid)
        .limit(1)
        .maybeSingle()

      if (boardRow?.id) {
        const rawMsgHtml = await resolveHtmlAttachmentsFromCache(fullMsg.content || '', supabase)
        const { cleanHtml: resolvedMsgContent, extractedAuthorName } = stripTegAuthorBanner(rawMsgHtml)

        const { data: existingMsg } = await supabase
          .from('bc_messages')
          .select('id, author_person_id')
          .eq('bc_id', recordingBcId)
          .maybeSingle()

        const authorUuid =
          (await resolvePersonByExtractedName(extractedAuthorName, supabase)) ||
          existingMsg?.author_person_id ||
          (await resolvePersonUuid(fullMsg.creator || payload.creator, supabase))

        await supabase.from('bc_messages').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            board_id: boardRow.id,
            title: fullMsg.subject || fullMsg.title || recording.title || 'Untitled',
            content: resolvedMsgContent,
            category: fullMsg.category?.name || 'General',
            author_person_id: authorUuid,
            comments_count: fullMsg.comments_count || 0,
            created_at: fullMsg.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )
      }

      return NextResponse.json({ received: true, synced: 'message', bc_id: recordingBcId })
    }

    // 4. Handle DOCUMENT events
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

    // 5. Handle CAMPFIRE::LINE events
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

    // 6. Handle SCHEDULE::ENTRY events
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

    // 7. Handle QUESTION::ANSWER events
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
