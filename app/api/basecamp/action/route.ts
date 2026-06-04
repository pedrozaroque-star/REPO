/**
 * @module api/basecamp/action
 * @description Ruta POST que maneja las operaciones de escritura (CRUD) desde los componentes UI.
 *              Opera en modo LOCAL (standalone) guardando directamente en Supabase.
 *
 * @businessRules
 * - **CRÍTICO**: Este módulo es 100% LOCAL. NUNCA escribe a la API de Basecamp original.
 * - **Sincronización**: Es ONE-WAY: Basecamp original → nuestro Supabase (lectura solamente).
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
 * - POST /api/basecamp/action → auth check → resolve person → save to Supabase ONLY
 *
 * @notes
 * - Previously this route had bidirectional sync (writing to Basecamp API too). 
 *   That was removed because our module must be 100% independent.
 *   When we fully migrate away from Basecamp, all data lives in Supabase.
 */

import { NextResponse } from 'next/server'
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
  // Strategy: Try email match first (case-insensitive), then fallback to name match
  let authorPersonId: string | null = null
  
  // Attempt 1: Match by email (case-insensitive)
  const { data: dbPersonByEmail } = await supabase
    .from('bc_people')
    .select('id, bc_id, name')
    .ilike('email', user.email || '')
    .limit(1)
    .single()
  
  if (dbPersonByEmail) {
    authorPersonId = dbPersonByEmail.id
  } else if (user.name) {
    // Attempt 2: Fallback — match by name (full_name from JWT)
    // Handles cases where login email differs from bc_people email
    const userName = user.name.trim()
    const { data: dbPersonByName } = await supabase
      .from('bc_people')
      .select('id, bc_id, name')
      .ilike('name', `%${userName}%`)
      .limit(1)
      .single()
    
    if (dbPersonByName) {
      authorPersonId = dbPersonByName.id
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

  // =========================================================================
  // ALL operations are LOCAL-ONLY — we NEVER call the Basecamp API for writes.
  // Sync is ONE-WAY: Basecamp original → Supabase (read-only sync via cron).
  // =========================================================================

  try {
    switch (action) {
      case 'complete_todo': {
        const { todoDbId } = args
        await supabase
          .from('bc_todos')
          .update({ is_completed: true, completed_at: new Date().toISOString() })
          .eq('id', todoDbId)

        return NextResponse.json({ success: true })
      }

      case 'uncomplete_todo': {
        const { todoDbId } = args
        await supabase
          .from('bc_todos')
          .update({ is_completed: false, completed_at: null })
          .eq('id', todoDbId)

        return NextResponse.json({ success: true })
      }

      case 'create_todolist': {
        const { name, description } = args
        const bcListId = Math.floor(Date.now() / 1000)

        // Find or create todoset for the project
        const { data: dbTodoset } = await supabase
          .from('bc_todosets')
          .select('id')
          .eq('project_id', projectUuid)
          .limit(1)
          .single()

        let todosetUuid = dbTodoset?.id

        if (!todosetUuid) {
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
        const { todolistDbId, title, description, due_date, assigneeUuids } = args
        const bcTodoId = Math.floor(Date.now() / 1000)

        // Insert todo in Supabase only
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
        const { boardDbId, title, content, category } = args
        const bcMsgId = Math.floor(Date.now() / 1000)

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
        const { campfireDbId, content } = args
        const bcLineId = Math.floor(Date.now() / 1000)

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
        const { parentType, parentDbId, content } = args
        const bcCommentId = Math.floor(Date.now() / 1000)

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
        }

        return NextResponse.json({ success: true, id: dbComment?.id, bc_id: bcCommentId })
      }

      case 'create_answer': {
        const { questionDbId, content } = args
        const bcAnswerId = Math.floor(Date.now() / 1000)

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
        const { scheduleDbId, title, description, starts_at, ends_at, all_day } = args
        const bcEventId = Math.floor(Date.now() / 1000)

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

      case 'create_vault': {
        const { parentVaultDbId, name } = args
        const bcVaultId = Math.floor(Date.now() / 1000)

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

        return NextResponse.json({ success: true, id: dbVault?.id, bc_id: bcVaultId })
      }

      case 'create_document': {
        const { vaultDbId, title, content } = args
        const bcDocId = Math.floor(Date.now() / 1000)

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
        const { recordingDbId, tableName } = args
        if (!recordingDbId || !tableName) {
          return NextResponse.json({ error: 'Missing recordingDbId or tableName' }, { status: 400 })
        }

        // Validate table
        const allowedTables = ['bc_todos', 'bc_messages', 'bc_comments', 'bc_documents', 'bc_schedule_entries', 'bc_vaults']
        if (!allowedTables.includes(tableName)) {
          return NextResponse.json({ error: 'Invalid tableName' }, { status: 400 })
        }

        // LOCAL-ONLY delete — does NOT touch the real Basecamp
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
