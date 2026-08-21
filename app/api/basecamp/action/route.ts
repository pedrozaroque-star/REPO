/**
 * @module api/basecamp/action
 * @description Ruta POST que maneja las operaciones de escritura (CRUD) desde los componentes UI.
 *              Opera en modo BIDIRECCIONAL: guarda en Supabase (fuente local) Y escribe a Basecamp API.
 *
 * @businessRules
 * - **Supabase primero**: SIEMPRE guarda localmente primero. Si Supabase falla, la operación falla.
 * - **Basecamp después (best-effort)**: Después de guardar en Supabase, intenta escribir en Basecamp API.
 *   Si Basecamp falla, el dato local queda intacto y se loguea el error.
 * - **bc_id real**: Si Basecamp API responde exitosamente, actualiza el bc_id en Supabase con el ID real
 *   para mantener consistencia con el sync cron.
 * - **Autenticación**: Verifica la sesión JWT del usuario (teg_token).
 * - **Mapeo de Usuario**: Relaciona el email/nombre del usuario logueado con un registro en `bc_people`.
 * - **Operaciones Soportadas**:
 *   - `complete_todo` / `uncomplete_todo`
 *   - `create_todo`
 *   - `create_todolist`
 *   - `create_message`
 *   - `create_campfire_line`
 *   - `create_comment`
 *   - `create_answer`
 *   - `create_schedule_entry`
 *   - `create_vault`
 *   - `create_document`
 *   - `delete_recording`
 *
 * @dataFlow
 * - POST /api/basecamp/action → auth check → resolve person → save to Supabase → mirror to Basecamp API (best-effort)
 *
 * @notes
 * - El sync bidireccional se restauró para que los cambios hechos en la UI aparezcan también en Basecamp original.
 * - Las funciones de escritura a Basecamp API viven en lib/basecamp-api.ts (createTodo, completeTodo, etc.)
 * - Si Basecamp API falla (token expirado, rate limit, etc.), la operación NO falla — el dato local se mantiene.
 */

import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  createTodo as bcCreateTodo,
  completeTodo as bcCompleteTodo,
  uncompleteTodo as bcUncompleteTodo,
  createMessage as bcCreateMessage,
  createCampfireLine as bcCreateCampfireLine,
  createComment as bcCreateComment,
  createAnswer as bcCreateAnswer,
  createScheduleEntry as bcCreateScheduleEntry,
  createDocument as bcCreateDocument,
} from '@/lib/basecamp-api'

export const dynamic = 'force-dynamic'

/**
 * Helper: intenta ejecutar una operación en Basecamp API como best-effort.
 * Si falla, loguea el error pero NO lanza excepción.
 * @returns El resultado de Basecamp si tuvo éxito, o null si falló.
 */
async function basecampBestEffort<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn()
    console.log(`✅ [Basecamp Sync] ${label} — synced to Basecamp successfully`)
    return result
  } catch (err: any) {
    console.warn(`⚠️ [Basecamp Sync] ${label} — failed (best-effort, local data intact): ${err.message}`)
    return null
  }
}

export async function POST(request: Request) {
  // 1. Get authenticated user using our custom JWT token
  const user = await getServerUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Alias supabase to supabaseAdmin to bypass RLS for all DB calls in the route
  const supabase = supabaseAdmin

  // 2. Resolve local person in bc_people
  // Strategy: Try email match first (case-insensitive), then fallback to name match
  let authorPersonId: string | null = null
  let authorBcId: number | null = null
  
  // Attempt 1: Match by email (case-insensitive)
  const { data: dbPersonByEmail } = await supabase
    .from('bc_people')
    .select('id, bc_id, name')
    .ilike('email', user.email || '')
    .limit(1)
    .single()
  
  if (dbPersonByEmail) {
    authorPersonId = dbPersonByEmail.id
    authorBcId = dbPersonByEmail.bc_id
  } else if (user.name) {
    // Attempt 2: Fallback — match by name (full_name from JWT)
    const userName = user.name.trim()
    const { data: dbPersonByName } = await supabase
      .from('bc_people')
      .select('id, bc_id, name')
      .ilike('name', `%${userName}%`)
      .limit(1)
      .single()
    
    if (dbPersonByName) {
      authorPersonId = dbPersonByName.id
      authorBcId = dbPersonByName.bc_id
      console.log(`ℹ️ [Basecamp Action] Resolved author by name fallback: "${userName}" → ${dbPersonByName.name} (${dbPersonByName.id})`)
    }
  }

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

  const bcProjectId = Number(projectId)

  // Find project UUID by its numeric bc_id
  const { data: dbProject } = await supabase
    .from('bc_projects')
    .select('id')
    .eq('bc_id', bcProjectId)
    .limit(1)
    .single()

  if (!dbProject) {
    return NextResponse.json({ error: `Project not found with bc_id ${projectId}` }, { status: 404 })
  }

  const projectUuid = dbProject.id

  // =========================================================================
  // BIDIRECTIONAL: Save to Supabase first (always), then mirror to Basecamp API (best-effort).
  // If Basecamp write succeeds → update Supabase bc_id with real Basecamp ID.
  // If Basecamp write fails → local data remains intact, warning is logged.
  // =========================================================================

  try {
    // Helper to generate high-entropy unique fake bc_id to avoid second-level collisions
    const generateUniqueBcId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000)

    // Helper to validate required args
    const requireArgs = (names: string[]) => {
      for (const name of names) {
        if (args[name] === undefined || args[name] === null) {
          throw new Error(`Missing required parameter: ${name}`)
        }
      }
    }

    switch (action) {
      case 'complete_todo': {
        requireArgs(['todoDbId'])
        const { todoDbId } = args
        // 1. Update locally
        await supabase
          .from('bc_todos')
          .update({ is_completed: true, completed_at: new Date().toISOString() })
          .eq('id', todoDbId)

        // 2. Mirror to Basecamp API (best-effort)
        const { data: todoRow } = await supabase.from('bc_todos').select('bc_id').eq('id', todoDbId).single()
        if (todoRow?.bc_id) {
          await basecampBestEffort('complete_todo', () => bcCompleteTodo(bcProjectId, todoRow.bc_id))
        }

        return NextResponse.json({ success: true })
      }

      case 'uncomplete_todo': {
        requireArgs(['todoDbId'])
        const { todoDbId } = args
        // 1. Update locally
        await supabase
          .from('bc_todos')
          .update({ is_completed: false, completed_at: null })
          .eq('id', todoDbId)

        // 2. Mirror to Basecamp API (best-effort)
        const { data: todoRow } = await supabase.from('bc_todos').select('bc_id').eq('id', todoDbId).single()
        if (todoRow?.bc_id) {
          await basecampBestEffort('uncomplete_todo', () => bcUncompleteTodo(bcProjectId, todoRow.bc_id))
        }

        return NextResponse.json({ success: true })
      }

      case 'create_todolist': {
        requireArgs(['name'])
        const { name, description } = args
        const bcListId = generateUniqueBcId()

        // Find or create todoset for the project
        const { data: dbTodoset } = await supabase
          .from('bc_todosets')
          .select('id, bc_id')
          .eq('project_id', projectUuid)
          .limit(1)
          .single()

        let todosetUuid = dbTodoset?.id

        if (!todosetUuid) {
          const { data: newTodoset, error: setErr } = await supabase
            .from('bc_todosets')
            .insert({
              project_id: projectUuid,
              name: 'Todoset',
              bc_id: generateUniqueBcId()
            })
            .select('id')
            .single()

          if (setErr) throw setErr
          todosetUuid = newTodoset?.id
        }

        // 1. Save to Supabase
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

        // TODO: Implement upward sync for todolist creation.
        // Basecamp API supports: POST /buckets/{projectId}/todosets/{todosetId}/todolists.json
        // Currently, locally-created lists only exist in Supabase until a manual full sync runs.

        return NextResponse.json({ success: true, id: dbList?.id, bc_id: bcListId })
      }

      case 'create_todo': {
        requireArgs(['todolistDbId', 'title'])
        const { todolistDbId, title, description, due_date, assigneeUuids } = args
        const bcTodoId = generateUniqueBcId()

        // 1. Save to Supabase
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

        // 2. Mirror to Basecamp API (best-effort)
        // Need the bc_id of the todolist to call the API
        const { data: todolistRow } = await supabase.from('bc_todolists').select('bc_id').eq('id', todolistDbId).single()
        if (todolistRow?.bc_id) {
          // Resolve assignee bc_ids for Basecamp API
          let assigneeBcIds: number[] = []
          if (assigneeUuids && assigneeUuids.length > 0) {
            const { data: assigneePeople } = await supabase
              .from('bc_people')
              .select('bc_id')
              .in('id', assigneeUuids)
            if (assigneePeople) {
              assigneeBcIds = assigneePeople.map((p: any) => p.bc_id).filter(Boolean)
            }
          }

          const bcResult = await basecampBestEffort('create_todo', () =>
            bcCreateTodo(bcProjectId, todolistRow.bc_id, {
              content: title,
              description: description || undefined,
              assignee_ids: assigneeBcIds.length > 0 ? assigneeBcIds : undefined,
              due_on: due_date || undefined,
            })
          )

          // If Basecamp API succeeded, update the Supabase record with the real bc_id
          if (bcResult && dbTodo) {
            await supabase.from('bc_todos').update({ bc_id: bcResult.id }).eq('id', dbTodo.id)
          }
        }

        return NextResponse.json({ success: true, id: dbTodo?.id, bc_id: bcTodoId })
      }

      case 'create_message': {
        requireArgs(['boardDbId', 'title'])
        const { boardDbId, title, content, category } = args
        const bcMsgId = generateUniqueBcId()

        // 1. Save to Supabase
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

        // 2. Mirror to Basecamp API (best-effort)
        const { data: boardRow } = await supabase.from('bc_message_boards').select('bc_id').eq('id', boardDbId).single()
        if (boardRow?.bc_id) {
          const bcResult = await basecampBestEffort('create_message', () =>
            bcCreateMessage(bcProjectId, boardRow.bc_id, {
              subject: title,
              content: content || undefined,
            })
          )

          if (bcResult && dbMsg) {
            await supabase.from('bc_messages').update({ bc_id: bcResult.id }).eq('id', dbMsg.id)
          }
        }

        return NextResponse.json({ success: true, id: dbMsg?.id, bc_id: bcMsgId })
      }

      case 'create_campfire_line': {
        requireArgs(['campfireDbId', 'content'])
        const { campfireDbId, content } = args
        const bcLineId = generateUniqueBcId()

        // 1. Save to Supabase
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

        // 2. Mirror to Basecamp API (best-effort)
        const { data: campfireRow } = await supabase.from('bc_campfires').select('bc_id').eq('id', campfireDbId).single()
        if (campfireRow?.bc_id) {
          const bcResult = await basecampBestEffort('create_campfire_line', () =>
            bcCreateCampfireLine(bcProjectId, campfireRow.bc_id, content)
          )

          if (bcResult && dbLine) {
            await supabase.from('bc_campfire_lines').update({ bc_id: bcResult.id }).eq('id', dbLine.id)
          }
        }

        return NextResponse.json({ success: true, id: dbLine?.id, bc_id: bcLineId })
      }

      case 'create_comment': {
        requireArgs(['parentType', 'parentDbId', 'content'])
        const { parentType, parentDbId, content } = args
        const bcCommentId = generateUniqueBcId()

        // 1. Save to Supabase
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
          const { data: msg } = await supabase.from('bc_messages').select('comments_count').eq('id', parentDbId).single()
          if (msg) {
            await supabase.from('bc_messages').update({ comments_count: (msg.comments_count || 0) + 1 }).eq('id', parentDbId)
          }
        } else if (parentType === 'todo') {
          const { data: todo } = await supabase.from('bc_todos').select('comments_count').eq('id', parentDbId).single()
          if (todo) {
            await supabase.from('bc_todos').update({ comments_count: (todo.comments_count || 0) + 1 }).eq('id', parentDbId)
          }
        }

        // 2. Mirror to Basecamp API (best-effort)
        // Resolve the parent's bc_id to use as recordingId in Basecamp API
        const parentTableMap: Record<string, string> = {
          message: 'bc_messages',
          todo: 'bc_todos',
          document: 'bc_documents',
        }
        const parentTable = parentTableMap[parentType]
        if (parentTable) {
          const { data: parentRow } = await supabase.from(parentTable).select('bc_id').eq('id', parentDbId).single()
          if (parentRow?.bc_id) {
            const bcResult = await basecampBestEffort('create_comment', () =>
              bcCreateComment(bcProjectId, parentRow.bc_id, content)
            )

            if (bcResult && dbComment) {
              await supabase.from('bc_comments').update({ bc_id: bcResult.id }).eq('id', dbComment.id)
            }
          }
        }

        return NextResponse.json({ success: true, id: dbComment?.id, bc_id: bcCommentId })
      }

      case 'create_answer': {
        requireArgs(['questionDbId', 'content'])
        const { questionDbId, content } = args
        const bcAnswerId = generateUniqueBcId()

        // 1. Save to Supabase
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

        // 2. Mirror to Basecamp API (best-effort)
        const { data: questionRow } = await supabase.from('bc_questions').select('bc_id').eq('id', questionDbId).single()
        if (questionRow?.bc_id) {
          const bcResult = await basecampBestEffort('create_answer', () =>
            bcCreateAnswer(bcProjectId, questionRow.bc_id, content)
          )

          if (bcResult && dbAnswer) {
            await supabase.from('bc_answers').update({ bc_id: bcResult.id }).eq('id', dbAnswer.id)
          }
        }

        return NextResponse.json({ success: true, id: dbAnswer?.id, bc_id: bcAnswerId })
      }

      case 'create_schedule_entry': {
        requireArgs(['scheduleDbId', 'title', 'starts_at', 'ends_at'])
        const { scheduleDbId, title, description, starts_at, ends_at, all_day } = args
        const bcEventId = generateUniqueBcId()

        // 1. Save to Supabase
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

        // 2. Mirror to Basecamp API (best-effort)
        const { data: scheduleRow } = await supabase.from('bc_schedules').select('bc_id').eq('id', scheduleDbId).single()
        if (scheduleRow?.bc_id) {
          const bcResult = await basecampBestEffort('create_schedule_entry', () =>
            bcCreateScheduleEntry(bcProjectId, scheduleRow.bc_id, {
              summary: title,
              description: description || undefined,
              starts_at,
              ends_at,
              all_day: all_day || false,
            })
          )

          if (bcResult && dbEvent) {
            await supabase.from('bc_schedule_entries').update({ bc_id: bcResult.id }).eq('id', dbEvent.id)
          }
        }

        return NextResponse.json({ success: true, id: dbEvent?.id, bc_id: bcEventId })
      }

      case 'create_vault': {
        requireArgs(['name'])
        const { parentVaultDbId, name } = args
        const bcVaultId = generateUniqueBcId()

        // 1. Save to Supabase
        const { data: dbVault, error: vaultErr } = await supabase
          .from('bc_vaults')
          .insert({
            bc_id: bcVaultId,
            project_id: projectUuid,
            name,
            parent_vault_id: parentVaultDbId || null,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (vaultErr) throw vaultErr

        // TODO: Implement upward sync for vault creation.
        // Basecamp API supports: POST /buckets/{projectId}/vaults/{parentVaultId}/vaults.json
        // Currently, locally-created vaults only exist in Supabase until a manual full sync runs.

        return NextResponse.json({ success: true, id: dbVault?.id, bc_id: bcVaultId })
      }

      case 'create_document': {
        requireArgs(['vaultDbId', 'title'])
        const { vaultDbId, title, content } = args
        const bcDocId = generateUniqueBcId()

        // 1. Save to Supabase
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

        // 2. Mirror to Basecamp API (best-effort)
        const { data: vaultRow } = await supabase.from('bc_vaults').select('bc_id').eq('id', vaultDbId).single()
        if (vaultRow?.bc_id) {
          const bcResult = await basecampBestEffort('create_document', () =>
            bcCreateDocument(bcProjectId, vaultRow.bc_id, { title, content: content || '' })
          )

          if (bcResult && dbDoc) {
            await supabase.from('bc_documents').update({ bc_id: bcResult.id }).eq('id', dbDoc.id)
          }
        }

        return NextResponse.json({ success: true, id: dbDoc?.id, bc_id: bcDocId })
      }

      case 'delete_recording': {
        const { recordingDbId, tableName } = args
        if (!recordingDbId || !tableName) {
          return NextResponse.json({ error: 'Missing recordingDbId or tableName' }, { status: 400 })
        }

        // Validate table
        const allowedTables = ['bc_todos', 'bc_messages', 'bc_comments', 'bc_documents', 'bc_schedule_entries', 'bc_vaults']
        if (!allowedTables.includes(tableName)) {
          return NextResponse.json({ error: 'Invalid tableName' }, { status: 400 })
        }

        // If deleting a comment, decrement the parent's comments_count first
        if (tableName === 'bc_comments') {
          const { data: commentRow } = await supabase
            .from('bc_comments')
            .select('parent_type, parent_id')
            .eq('id', recordingDbId)
            .single()

          if (commentRow?.parent_type === 'message' && commentRow?.parent_id) {
            const { data: msg } = await supabase.from('bc_messages').select('comments_count').eq('id', commentRow.parent_id).single()
            if (msg && (msg.comments_count || 0) > 0) {
              await supabase.from('bc_messages').update({ comments_count: (msg.comments_count || 0) - 1 }).eq('id', commentRow.parent_id)
            }
          } else if (commentRow?.parent_type === 'todo' && commentRow?.parent_id) {
            const { data: todo } = await supabase.from('bc_todos').select('comments_count').eq('id', commentRow.parent_id).single()
            if (todo && (todo.comments_count || 0) > 0) {
              await supabase.from('bc_todos').update({ comments_count: (todo.comments_count || 0) - 1 }).eq('id', commentRow.parent_id)
            }
          }
        }

        // If deleting a todo, also clean up its assignee records
        if (tableName === 'bc_todos') {
          await supabase.from('bc_todo_assignees').delete().eq('todo_id', recordingDbId)
        }

        // LOCAL delete — Basecamp API trash is not supported via our sync
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
