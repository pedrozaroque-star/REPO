/**
 * @module api/basecamp/action
 * @description Ruta POST que maneja las operaciones de escritura (CRUD) desde los componentes UI.
 *              Funciona de manera híbrida: si hay conexión con Basecamp activa, envía los cambios
 *              a la API de Basecamp y luego los persiste en Supabase. Si no, opera en modo local
 *              (standalone) guardando directamente en Supabase.
 *
 * @businessRules
 * - **Autenticación**: Verifica la sesión de Next.js/Supabase del usuario.
 * - **Mapeo de Usuario**: Relaciona el email del usuario logueado con un registro en `bc_people`.
 * - **Modo Híbrido**: Llama a la API de Basecamp si `bc_oauth_tokens` tiene un token válido.
 * - **Operaciones Soportadas**:
 *   - `complete_todo` / `uncomplete_todo`
 *   - `create_todo`
 *   - `create_message`
 *   - `create_campfire_line`
 *   - `create_comment`
 *   - `create_answer`
 *   - `create_schedule_entry`
 *   - `create_document`
 *   - `delete_recording`
 *
 * @dataFlow
 * - POST /api/basecamp/action → auth check → get client/person → fetch projects → write to Basecamp API → save to Supabase
 */

import { NextResponse } from 'next/server'
import {
  getValidToken,
  completeTodo,
  uncompleteTodo,
  createTodo,
  createMessage,
  createCampfireLine,
  createComment,
  createAnswer,
  createScheduleEntry,
  createDocument,
} from '@/lib/basecamp-api'
import { getServerUser } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // 1. Get authenticated user using our custom JWT token
  const user = await getServerUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Alias supabase to supabaseAdmin to bypass RLS for all DB calls in the route
  const supabase = supabaseAdmin

  // 2. Resolve local person in bc_people
  const { data: dbPerson } = await supabase
    .from('bc_people')
    .select('id, bc_id, name')
    .eq('email', user.email || '')
    .limit(1)
    .single()

  const authorPersonId = dbPerson?.id || null

  // 3. Parse action request
  let body
  try {
    body = await request.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, projectId, ...args } = body
  if (!action || !projectId) {
    return NextResponse.json({ error: 'Missing action or projectId' }, { status: 400 })
  }

  // Find project UUID by its numeric bc_id
  const { data: dbProject } = await supabase
    .from('bc_projects')
    .select('id')
    .eq('bc_id', Number(projectId))
    .limit(1)
    .single()

  if (!dbProject) {
    return NextResponse.json({ error: `Project not found with bc_id ${projectId}` }, { status: 404 })
  }

  const projectUuid = dbProject.id

  // Check if we have Basecamp integration tokens configured
  let hasToken = false
  try {
    const token = await getValidToken()
    hasToken = !!token
  } catch (e) {
    // Standing mode fallback
  }

  try {
    switch (action) {
      case 'complete_todo': {
        const { todoId, todoDbId } = args
        if (hasToken && todoId) {
          await completeTodo(Number(projectId), Number(todoId))
        }
        await supabase
          .from('bc_todos')
          .update({ is_completed: true, completed_at: new Date().toISOString() })
          .eq('id', todoDbId)

        return NextResponse.json({ success: true })
      }

      case 'uncomplete_todo': {
        const { todoId, todoDbId } = args
        if (hasToken && todoId) {
          await uncompleteTodo(Number(projectId), Number(todoId))
        }
        await supabase
          .from('bc_todos')
          .update({ is_completed: false, completed_at: null })
          .eq('id', todoDbId)

        return NextResponse.json({ success: true })
      }

      case 'create_todolist': {
        const { name, description } = args
        let bcListId = Math.floor(Date.now() / 1000)

        // Find todoset UUID and bc_id for the project
        const { data: dbTodoset } = await supabase
          .from('bc_todosets')
          .select('id, bc_id')
          .eq('project_id', projectUuid)
          .limit(1)
          .single()

        let todosetUuid = dbTodoset?.id
        let todosetBcId = dbTodoset?.bc_id

        if (!todosetUuid) {
          // If no todoset exists, create one locally
          const { data: newTodoset } = await supabase
            .from('bc_todosets')
            .insert({
              project_id: projectUuid,
              name: 'Todoset',
              bc_id: Math.floor(Date.now() / 1000)
            })
            .select('id')
            .single()
          todosetUuid = newTodoset?.id
        }

        if (hasToken && todosetBcId) {
          const token = await getValidToken()
          const res = await fetch(`https://3.basecampapi.com/${process.env.BASECAMP_ACCOUNT_ID}/buckets/${projectId}/todosets/${todosetBcId}/todolists.json`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)',
            },
            body: JSON.stringify({ name, description: description || '' }),
          })
          if (res.ok) {
            const listObj = await res.json()
            bcListId = listObj.id
          }
        }

        const { data: dbList, error: listErr } = await supabase
          .from('bc_todolists')
          .insert({
            bc_id: bcListId,
            project_id: projectUuid,
            todoset_id: todosetUuid,
            name,
            description: description || '',
            position: 99,
            completed_count: 0,
            total_count: 0,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (listErr) throw listErr

        return NextResponse.json({ success: true, id: dbList?.id, bc_id: bcListId })
      }

      case 'create_todo': {
        const { todolistId, todolistDbId, title, description, due_date, assigneeUuids } = args
        let bcTodoId = Math.floor(Date.now() / 1000) // fallback random number

        // Find assignee numeric IDs if we have a token
        let assigneeBcIds: number[] = []
        if (assigneeUuids && assigneeUuids.length > 0) {
          const { data: people } = await supabase
            .from('bc_people')
            .select('bc_id')
            .in('id', assigneeUuids)
          if (people) {
            assigneeBcIds = people.map(p => Number(p.bc_id)).filter(id => !isNaN(id))
          }
        }

        if (hasToken && todolistId) {
          const bcTodo = await createTodo(Number(projectId), Number(todolistId), {
            content: title,
            description: description || '',
            due_on: due_date || undefined,
            assignee_ids: assigneeBcIds.length > 0 ? assigneeBcIds : undefined,
          })
          bcTodoId = bcTodo.id
        }

        // Insert todo in Supabase
        const { data: dbTodo, error: todoErr } = await supabase
          .from('bc_todos')
          .insert({
            bc_id: bcTodoId,
            project_id: projectUuid,
            todolist_id: todolistDbId,
            title,
            description: description || '',
            is_completed: false,
            due_date: due_date || null,
            created_by_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (todoErr) throw todoErr

        // Save assignees in bc_todo_assignees
        if (assigneeUuids && assigneeUuids.length > 0 && dbTodo) {
          const assigneeRows = assigneeUuids.map((uid: string) => ({
            todo_id: dbTodo.id,
            person_id: uid,
          }))
          await supabase.from('bc_todo_assignees').insert(assigneeRows)
        }

        return NextResponse.json({ success: true, id: dbTodo?.id, bc_id: bcTodoId })
      }

      case 'create_message': {
        const { boardId, boardDbId, title, content, category } = args
        let bcMsgId = Math.floor(Date.now() / 1000)

        if (hasToken && boardId) {
          const bcMsg = await createMessage(Number(projectId), Number(boardId), {
            subject: title,
            content: content || '',
            category_id: undefined, // Basecamp handles categories on creation via specific IDs, default is fine
          })
          bcMsgId = bcMsg.id
        }

        const { data: dbMsg, error: msgErr } = await supabase
          .from('bc_messages')
          .insert({
            bc_id: bcMsgId,
            project_id: projectUuid,
            board_id: boardDbId,
            title,
            content: content || '',
            category: category || 'General',
            author_person_id: authorPersonId,
            comments_count: 0,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (msgErr) throw msgErr

        return NextResponse.json({ success: true, id: dbMsg?.id, bc_id: bcMsgId })
      }

      case 'create_campfire_line': {
        const { campfireId, campfireDbId, content } = args
        let bcLineId = Math.floor(Date.now() / 1000)

        if (hasToken && campfireId) {
          const bcLine = await createCampfireLine(Number(projectId), Number(campfireId), content)
          bcLineId = bcLine.id
        }

        const { data: dbLine, error: lineErr } = await supabase
          .from('bc_campfire_lines')
          .insert({
            bc_id: bcLineId,
            project_id: projectUuid,
            campfire_id: campfireDbId,
            content,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (lineErr) throw lineErr

        return NextResponse.json({ success: true, id: dbLine?.id, bc_id: bcLineId })
      }

      case 'create_comment': {
        const { recordingId, parentType, parentDbId, content } = args
        let bcCommentId = Math.floor(Date.now() / 1000)

        if (hasToken && recordingId) {
          const bcComment = await createComment(Number(projectId), Number(recordingId), content)
          bcCommentId = bcComment.id
        }

        const { data: dbComment, error: comErr } = await supabase
          .from('bc_comments')
          .insert({
            bc_id: bcCommentId,
            project_id: projectUuid,
            parent_type: parentType,
            parent_id: parentDbId,
            content,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (comErr) throw comErr

        // Update comment counter in the parent table if needed
        if (parentType === 'message') {
          await supabase.rpc('increment_comments_count', { msg_id: parentDbId }) 
          // Note: If increment rpc isn't defined, we do a direct fetch/update or we just ignore since sync updates it.
          // Let's increment message comments count in Supabase
          const { data: msg } = await supabase.from('bc_messages').select('comments_count').eq('id', parentDbId).single()
          if (msg) {
            await supabase.from('bc_messages').update({ comments_count: (msg.comments_count || 0) + 1 }).eq('id', parentDbId)
          }
        }

        return NextResponse.json({ success: true, id: dbComment?.id, bc_id: bcCommentId })
      }

      case 'create_answer': {
        const { questionId, questionDbId, content } = args
        let bcAnswerId = Math.floor(Date.now() / 1000)

        if (hasToken && questionId) {
          const bcAnswer = await createAnswer(Number(projectId), Number(questionId), content)
          bcAnswerId = bcAnswer.id
        }

        const { data: dbAnswer, error: ansErr } = await supabase
          .from('bc_answers')
          .insert({
            bc_id: bcAnswerId,
            project_id: projectUuid,
            question_id: questionDbId,
            content,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (ansErr) throw ansErr

        return NextResponse.json({ success: true, id: dbAnswer?.id, bc_id: bcAnswerId })
      }

      case 'create_schedule_entry': {
        const { scheduleId, scheduleDbId, title, description, starts_at, ends_at, all_day } = args
        let bcEventId = Math.floor(Date.now() / 1000)

        if (hasToken && scheduleId) {
          const bcEvent = await createScheduleEntry(Number(projectId), Number(scheduleId), {
            summary: title,
            description: description || '',
            starts_at,
            ends_at,
            all_day: all_day || false,
          })
          bcEventId = bcEvent.id
        }

        const { data: dbEvent, error: evtErr } = await supabase
          .from('bc_schedule_entries')
          .insert({
            bc_id: bcEventId,
            project_id: projectUuid,
            schedule_id: scheduleDbId,
            title,
            description: description || '',
            starts_at,
            ends_at,
            all_day: all_day || false,
            author_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (evtErr) throw evtErr

        return NextResponse.json({ success: true, id: dbEvent?.id, bc_id: bcEventId })
      }

      case 'create_document': {
        const { vaultId, vaultDbId, title, content } = args
        let bcDocId = Math.floor(Date.now() / 1000)

        if (hasToken && vaultId) {
          const bcDoc = await createDocument(Number(projectId), Number(vaultId), {
            title,
            content: content || '',
          })
          bcDocId = bcDoc.id
        }

        const { data: dbDoc, error: docErr } = await supabase
          .from('bc_documents')
          .insert({
            bc_id: bcDocId,
            project_id: projectUuid,
            vault_id: vaultDbId,
            title,
            content: content || '',
            author_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (docErr) throw docErr

        return NextResponse.json({ success: true, id: dbDoc?.id, bc_id: bcDocId })
      }

      case 'delete_recording': {
        const { recordingId, recordingDbId, tableName } = args
        if (!recordingDbId || !tableName) {
          return NextResponse.json({ error: 'Missing recordingDbId or tableName' }, { status: 400 })
        }

        // Validate table
        const allowedTables = ['bc_todos', 'bc_messages', 'bc_comments', 'bc_documents', 'bc_schedule_entries']
        if (!allowedTables.includes(tableName)) {
          return NextResponse.json({ error: 'Invalid tableName' }, { status: 400 })
        }

        if (hasToken && recordingId) {
          // Basecamp uses DELETE /buckets/{bucket_id}/recordings/{recording_id}.json
          const token = await getValidToken()
          await fetch(`https://3.basecampapi.com/${process.env.BASECAMP_ACCOUNT_ID}/buckets/${projectId}/recordings/${recordingId}.json`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)',
            },
          })
        }

        const { error: delErr } = await supabase
          .from(tableName)
          .delete()
          .eq('id', recordingDbId)

        if (delErr) throw delErr

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error(`❌ [Basecamp Action Error] ${action}:`, error.message)
    return NextResponse.json(
      { error: `Failed to execute action ${action}: ${error.message}` },
      { status: 500 }
    )
  }
}
