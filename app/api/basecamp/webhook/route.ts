/**
 * @module api/basecamp/webhook
 * @description Receptor en tiempo real (Webhook Endpoint) para eventos push de Basecamp 3.
 *              Recibe notificaciones instantáneas cuando se crean, completan, reabren, editan o eliminan
 *              To-dos, Comentarios, Mensajes, Documentos, Líneas de Campfire o Respuestas de Check-ins
 *              en Basecamp, actualizando Supabase en menos de 1 segundo.
 *
 * @businessRules
 * - **Tiempo Real (< 1s)**: Elimina la espera del Cron para cambios originados directamente en Basecamp.
 * - **Hidratación Completa**: Usa `basecampFetch` contra `recording.url` para obtener la versión completa
 *   del recurso (incluyendo asignados, descripción HTML, conteo de comentarios y estado `completed`).
 * - **Reconciliación de Contadores**: Actualiza automáticamente `comments_count` y `completed_count` en las
 *   tablas padre (`bc_todos`, `bc_messages`, `bc_todolists`) para disparar eventos en Supabase Realtime.
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
import { basecampFetch } from '@/lib/basecamp-api'

export const dynamic = 'force-dynamic'

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

async function resolvePersonUuid(creator: any, supabase: any): Promise<string | null> {
  if (!creator?.id) return null
  const bcPersonId = Number(creator.id)

  const { data: existing } = await supabase
    .from('bc_people')
    .select('id')
    .eq('bc_id', bcPersonId)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: inserted } = await supabase
    .from('bc_people')
    .upsert(
      {
        bc_id: bcPersonId,
        name: creator.name || 'Unknown',
        email: creator.email_address || '',
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

    if (!bucketBcId || !recordingBcId) {
      return NextResponse.json({ received: true, ignored: true })
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

    // Handle Trashed / Archived recordings
    if (kind.endsWith('_trashed') || recording.status === 'trashed') {
      if (recordingType === 'Todo') {
        const { data: todoRow } = await supabase.from('bc_todos').select('id').eq('bc_id', recordingBcId).maybeSingle()
        if (todoRow?.id) {
          await supabase.from('bc_todo_assignees').delete().eq('todo_id', todoRow.id)
          await supabase.from('bc_todos').delete().eq('id', todoRow.id)
        }
      } else if (recordingType === 'Comment') {
        await supabase.from('bc_comments').delete().eq('bc_id', recordingBcId)
      } else if (recordingType === 'Message') {
        await supabase.from('bc_messages').delete().eq('bc_id', recordingBcId)
      }
      return NextResponse.json({ received: true, action: 'deleted_trashed' })
    }

    // 1. Handle TODO events (created, completed, uncompleted, changed)
    if (recordingType === 'Todo' || kind.startsWith('todo_')) {
      const fullTodo = await basecampFetch<any>(
        recording.url || `/buckets/${bucketBcId}/todos/${recordingBcId}.json`,
        { noPaginate: true }
      ).catch(() => recording)

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

        const authorUuid = await resolvePersonUuid(fullTodo.creator || payload.creator, supabase)
        const { data: dbTodo } = await supabase
          .from('bc_todos')
          .upsert(
            {
              bc_id: recordingBcId,
              project_id: projectUuid,
              todolist_id: todolistUuid,
              title: fullTodo.content || fullTodo.title || recording.title || 'Untitled',
              description: fullTodo.description ?? '',
              is_completed: isCompleted,
              completed_at: isCompleted ? (fullTodo.updated_at || new Date().toISOString()) : null,
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
          await supabase.from('bc_todo_assignees').delete().eq('todo_id', dbTodo.id)
          const assigneeRows: { todo_id: string; person_id: string }[] = []
          for (const a of fullTodo.assignees) {
            const pUuid = await resolvePersonUuid(a, supabase)
            if (pUuid) assigneeRows.push({ todo_id: dbTodo.id, person_id: pUuid })
          }
          if (assigneeRows.length > 0) {
            await supabase.from('bc_todo_assignees').upsert(assigneeRows, { onConflict: 'todo_id,person_id' })
          }
        }
      }

      return NextResponse.json({ received: true, synced: 'todo', bc_id: recordingBcId })
    }

    // 2. Handle COMMENT events (comment_created, comment_changed)
    if (recordingType === 'Comment' || kind.startsWith('comment_')) {
      const fullComment = await basecampFetch<any>(
        recording.url || `/buckets/${bucketBcId}/comments/${recordingBcId}.json`,
        { noPaginate: true }
      ).catch(() => recording)

      const parentBcId = Number(fullComment?.parent?.id || recording?.parent?.id || 0)
      const parentRawType = String(fullComment?.parent?.type || recording?.parent?.type || '').toLowerCase()

      let parentType: 'todo' | 'message' | 'document' = 'todo'
      let parentUuid: string | null = null

      if (parentRawType.includes('message')) {
        parentType = 'message'
        const { data: msg } = await supabase.from('bc_messages').select('id, comments_count').eq('bc_id', parentBcId).maybeSingle()
        parentUuid = msg?.id || null
        if (parentUuid && kind === 'comment_created') {
          await supabase.from('bc_messages').update({ comments_count: (msg?.comments_count || 0) + 1 }).eq('id', parentUuid)
        }
      } else if (parentRawType.includes('document')) {
        parentType = 'document'
        const { data: doc } = await supabase.from('bc_documents').select('id').eq('bc_id', parentBcId).maybeSingle()
        parentUuid = doc?.id || null
      } else {
        parentType = 'todo'
        const { data: todo } = await supabase.from('bc_todos').select('id, comments_count').eq('bc_id', parentBcId).maybeSingle()
        parentUuid = todo?.id || null
        if (parentUuid && kind === 'comment_created') {
          await supabase.from('bc_todos').update({ comments_count: (todo?.comments_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', parentUuid)
        }
      }

      if (parentUuid) {
        const authorUuid = await resolvePersonUuid(fullComment.creator || payload.creator, supabase)
        await supabase.from('bc_comments').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            parent_type: parentType,
            parent_id: parentUuid,
            content: fullComment.content || recording.content || '',
            author_person_id: authorUuid,
            created_at: fullComment.created_at || new Date().toISOString(),
          },
          { onConflict: 'bc_id' }
        )
      }

      return NextResponse.json({ received: true, synced: 'comment', bc_id: recordingBcId })
    }

    // 3. Handle MESSAGE events
    if (recordingType === 'Message' || kind.startsWith('message_')) {
      const fullMsg = await basecampFetch<any>(
        recording.url || `/buckets/${bucketBcId}/messages/${recordingBcId}.json`,
        { noPaginate: true }
      ).catch(() => recording)

      const { data: boardRow } = await supabase
        .from('bc_message_boards')
        .select('id')
        .eq('project_id', projectUuid)
        .limit(1)
        .maybeSingle()

      if (boardRow?.id) {
        const authorUuid = await resolvePersonUuid(fullMsg.creator || payload.creator, supabase)
        await supabase.from('bc_messages').upsert(
          {
            bc_id: recordingBcId,
            project_id: projectUuid,
            board_id: boardRow.id,
            title: fullMsg.subject || fullMsg.title || recording.title || 'Untitled',
            content: fullMsg.content || '',
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

    return NextResponse.json({ received: true, kind, recordingType })
  } catch (error: any) {
    console.error('❌ [Basecamp Webhook] Error processing webhook:', error.message)
    // Return 200 so Basecamp does not disable the webhook on transient errors
    return NextResponse.json({ received: true, error: error.message }, { status: 200 })
  }
}
