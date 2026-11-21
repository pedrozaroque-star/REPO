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
 *   - `create_upload`
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
import { getServerUser, verifyStaffAuth } from '@/lib/auth-server'
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
  uploadBasecampAttachment,
  syncTodolistCounts,
} from '@/lib/basecamp-api'
import {
  resolveOrCreateTegPerson,
  buildBasecampDescriptionWithAuthor,
  buildBasecampCommentWithAuthor,
  isRealBasecampId,
} from '@/lib/basecamp-person-resolver'
import { sendBasecampTodoNotificationEmail } from '@/lib/basecamp-todo-email'

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

async function syncParentCommentsCount(
  supabase: any,
  parentType?: string | null,
  parentDbId?: string | null
): Promise<void> {
  if (!parentDbId || (parentType !== 'todo' && parentType !== 'message')) return
  const { count, error } = await supabase
    .from('bc_comments')
    .select('*', { count: 'exact', head: true })
    .eq('parent_type', parentType)
    .eq('parent_id', parentDbId)
  if (error) return

  if (parentType === 'todo') {
    await supabase
      .from('bc_todos')
      .update({ comments_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', parentDbId)
  } else {
    await supabase
      .from('bc_messages')
      .update({ comments_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', parentDbId)
  }
}

function extractBasecampUploadStoragePath(downloadUrl?: string | null): string | null {
  if (!downloadUrl || typeof downloadUrl !== 'string') return null
  const marker = '/storage/v1/object/public/checklist-photos/'
  const idx = downloadUrl.indexOf(marker)
  if (idx === -1) return null
  let relPath = downloadUrl.slice(idx + marker.length).split('?')[0]
  try {
    relPath = decodeURIComponent(relPath)
  } catch {
    // Keep raw path when not percent-encoded
  }
  if (!relPath.startsWith('basecamp-uploads/') || relPath.includes('..')) {
    return null
  }
  return relPath
}

const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

/**
 * Uploads any embedded `<img src="data:...">` / `<a href="data:...">` / `url="data:..."` base64 payloads
 * to Supabase Storage (`checklist-photos/basecamp-attachments/...`) and replaces them with durable HTTPS
 * public URLs before saving to Supabase or mirroring to Basecamp API.
 */
async function uploadEmbeddedDataUrisToStorage(
  html: string | undefined | null,
  folder: string,
  supabase: any
): Promise<string> {
  if (!html || typeof html !== 'string' || !html.includes('data:')) {
    return html || ''
  }

  const dataAttrRegex =
    /(?:src|href|url)\s*=\s*(["'])(data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)(?:;[a-zA-Z0-9=._-]+)*;base64,([A-Za-z0-9+/=\s]+))\1/gi

  const pendingMatches = new Map<string, { mimeType: string; b64: string }>()
  let match: RegExpExecArray | null
  while ((match = dataAttrRegex.exec(html)) !== null) {
    const fullDataUri = match[2]
    const mimeType = (match[3] || 'application/octet-stream').toLowerCase()
    const b64 = (match[4] || '').replace(/\s+/g, '')
    if (fullDataUri && b64 && !pendingMatches.has(fullDataUri)) {
      pendingMatches.set(fullDataUri, { mimeType, b64 })
    }
  }

  if (pendingMatches.size === 0) return html

  let updatedHtml = html
  for (const [dataUri, { mimeType, b64 }] of pendingMatches.entries()) {
    try {
      const buffer = Buffer.from(b64, 'base64')
      if (buffer.length === 0) continue
      const fallbackExt = (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
      const ext = MIME_EXT_MAP[mimeType] || fallbackExt
      const filePath = `basecamp-attachments/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: upErr } = await supabase.storage.from('checklist-photos').upload(filePath, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: true,
      })
      if (upErr) {
        console.warn(`⚠️ [Basecamp Action] Failed to upload embedded data URI (${mimeType}):`, upErr.message)
        continue
      }

      const { data: pub } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
      if (pub?.publicUrl) {
        updatedHtml = updatedHtml.replaceAll(dataUri, pub.publicUrl)
      }
    } catch (err: any) {
      console.warn('⚠️ [Basecamp Action] Non-fatal data URI upload error:', err.message)
    }
  }

  return updatedHtml
}

/**
 * Converts Supabase Storage (`checklist-photos/...`) `<bc-attachment>` and `<img>` elements into native
 * Basecamp 3 `<bc-attachment sgid="...">` tags strictly for the outbound Basecamp API payload, while keeping
 * Supabase's permanent public URLs untouched in our own database.
 */
async function mirrorSupabaseAttachmentsForBasecampHtml(html: string | undefined | null, supabase: any): Promise<string> {
  if (!html || typeof html !== 'string' || !html.includes('/storage/v1/object/public/checklist-photos/')) {
    return html || ''
  }

  const marker = '/storage/v1/object/public/checklist-photos/'
  const sgidCache = new Map<string, string | null>()

  const resolveSgidForUrl = async (rawUrl: string, fallbackName: string, fallbackMime: string): Promise<string | null> => {
    const unescapedUrl = rawUrl.replace(/&amp;/gi, '&').trim()
    if (sgidCache.has(unescapedUrl)) return sgidCache.get(unescapedUrl) || null
    const idx = unescapedUrl.indexOf(marker)
    if (idx === -1) return null
    let relPath = unescapedUrl.slice(idx + marker.length).split('?')[0]
    try {
      relPath = decodeURIComponent(relPath)
    } catch {
      // keep raw
    }
    if (!relPath || relPath.includes('..')) return null

    try {
      const { data: blob, error } = await supabase.storage.from('checklist-photos').download(relPath)
      if (error || !blob) {
        sgidCache.set(unescapedUrl, null)
        return null
      }
      const arrBuf = await blob.arrayBuffer()
      const buf = Buffer.from(arrBuf)
      const detectedMime = blob.type || fallbackMime || 'application/octet-stream'
      const sgid = await uploadBasecampAttachment(buf, fallbackName || relPath.split('/').pop() || 'attachment', detectedMime)
      sgidCache.set(unescapedUrl, sgid)
      return sgid
    } catch (err: any) {
      console.warn('⚠️ [Basecamp Action] Could not upload attachment to Basecamp SGID:', err?.message || err)
      sgidCache.set(unescapedUrl, null)
      return null
    }
  }

  let out = html

  // 1. Convert <bc-attachment ... url="https://...checklist-photos/...">...</bc-attachment>
  const bcAttRegex = /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi
  const bcMatches = [...out.matchAll(bcAttRegex)]
  for (const m of bcMatches) {
    const fullTag = m[0]
    const attrs = m[1] || ''
    const urlMatch = attrs.match(/\b(?:url|href)=["']([^"']+)["']/i)
    const rawUrl = urlMatch?.[1] || ''
    if (!rawUrl.includes(marker)) continue
    const fnMatch = attrs.match(/\bfilename=["']([^"']+)["']/i)
    const ctMatch = attrs.match(/\bcontent-type=["']([^"']+)["']/i)
    const filename = fnMatch?.[1] || 'attachment'
    const mime = ctMatch?.[1] || 'application/octet-stream'
    const sgid = await resolveSgidForUrl(rawUrl, filename, mime)
    if (sgid) {
      out = out.replace(fullTag, `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullTag, `<p><a href="${rawUrl}">📎 ${filename}</a></p>`)
    }
  }

  // 2. Convert standalone <img ... src="https://...checklist-photos/..." ...>
  const imgRegex = /<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi
  const imgMatches = [...out.matchAll(imgRegex)]
  for (const m of imgMatches) {
    const fullImg = m[0]
    const rawUrl = m[3] || ''
    if (!rawUrl.includes(marker)) continue
    const altMatch = (m[1] + ' ' + m[4]).match(/\balt=(["'])([^"']+)\1/i)
    const filename = altMatch?.[2] || rawUrl.split('/').pop()?.split('?')[0] || 'photo.jpg'
    const sgid = await resolveSgidForUrl(rawUrl, filename, 'image/jpeg')
    if (sgid) {
      out = out.replace(fullImg, `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullImg, `<a href="${rawUrl}">🖼 ${filename}</a>`)
    }
  }

  return out
}

export async function POST(request: Request) {
  // 1. Require authenticated staff user (blocks unauthenticated & employee kiosk tokens)
  const staffAuth = verifyStaffAuth(request, { allowCron: false })
  if (!staffAuth.authorized) {
    return staffAuth.response!
  }

  const user = await getServerUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Alias supabase to supabaseAdmin to bypass RLS for all DB calls in the route
  const supabase = supabaseAdmin

  // 2. Resolve or auto-create local person in bc_people (handles masked Basecamp emails & spelling variants like Erick/Erik, Velazquez/Velasquez)
  const resolvedAuthor = await resolveOrCreateTegPerson(supabase, {
    email: user.email,
    name: user.name,
    role: user.role,
  })
  const authorPersonId: string | null = resolvedAuthor?.id || null
  const authorDisplayName: string = resolvedAuthor?.name || user.name || user.email || 'Usuario TEG'

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
    .maybeSingle()

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
        const { data: todoRow } = await supabase
          .from('bc_todos')
          .select('bc_id, todolist_id')
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!todoRow) {
          return NextResponse.json({ error: 'Todo not found in project' }, { status: 404 })
        }

        // 1. Update locally
        const nowIso = new Date().toISOString()
        await supabase
          .from('bc_todos')
          .update({ is_completed: true, completed_at: nowIso, updated_at: nowIso })
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)

        await syncTodolistCounts(supabase, todoRow.todolist_id)

        // 2. Mirror to Basecamp API + Notify all involved people by email (best-effort)
        const reqOrigin = new URL(request.url).origin
        await Promise.all([
          isRealBasecampId(todoRow.bc_id)
            ? basecampBestEffort('complete_todo', () => bcCompleteTodo(bcProjectId, Number(todoRow.bc_id)))
            : Promise.resolve(null),
          args.skipEmailNotification
            ? Promise.resolve(null)
            : sendBasecampTodoNotificationEmail({
                event: 'completed',
                todoDbId,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                appOrigin: reqOrigin,
              }),
        ])

        return NextResponse.json({ success: true })
      }

      case 'uncomplete_todo': {
        requireArgs(['todoDbId'])
        const { todoDbId } = args
        const { data: todoRow } = await supabase
          .from('bc_todos')
          .select('bc_id, todolist_id')
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!todoRow) {
          return NextResponse.json({ error: 'Todo not found in project' }, { status: 404 })
        }

        // 1. Update locally
        await supabase
          .from('bc_todos')
          .update({ is_completed: false, completed_at: null, updated_at: new Date().toISOString() })
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)

        await syncTodolistCounts(supabase, todoRow.todolist_id)

        // 2. Mirror to Basecamp API + Notify all involved people by email (best-effort)
        const reqOrigin = new URL(request.url).origin
        await Promise.all([
          isRealBasecampId(todoRow.bc_id)
            ? basecampBestEffort('uncomplete_todo', () => bcUncompleteTodo(bcProjectId, Number(todoRow.bc_id)))
            : Promise.resolve(null),
          args.skipEmailNotification
            ? Promise.resolve(null)
            : sendBasecampTodoNotificationEmail({
                event: 'reopened',
                todoDbId,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                appOrigin: reqOrigin,
              }),
        ])

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
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

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
        const cleanListDesc = await uploadEmbeddedDataUrisToStorage(description, 'todolists', supabase)
        const { data: dbList, error: listErr } = await supabase
          .from('bc_todolists')
          .insert({
            bc_id: bcListId,
            project_id: projectUuid,
            todoset_id: todosetUuid,
            name,
            description: cleanListDesc,
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
        requireArgs(['todolistDbId', 'title'])
        const { todolistDbId, title, description, due_date, assigneeUuids, subtasks } = args
        const bcTodoId = generateUniqueBcId()
        let cleanTodoDesc = await uploadEmbeddedDataUrisToStorage(description, 'todos', supabase)

        // Append structured Subtasks checklist if provided
        const validSubtasks = Array.isArray(subtasks)
          ? subtasks.map((s: any) => String(s || '').trim()).filter(Boolean)
          : []
        if (validSubtasks.length > 0) {
          const escHtml = (v: string) =>
            v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
          const itemsHtml = validSubtasks.map((st: string) => `<li>☐ ${escHtml(st)}</li>`).join('')
          const subtasksBlock = `<div data-teg-subtasks="true" style="margin-top: 10px;"><strong>Subtasks:</strong><ul>${itemsHtml}</ul></div>`
          cleanTodoDesc = cleanTodoDesc ? `${cleanTodoDesc}${subtasksBlock}` : subtasksBlock
        }

        // 1. Save to Supabase
        const { data: dbTodo, error: todoErr } = await supabase
          .from('bc_todos')
          .insert({
            bc_id: bcTodoId,
            project_id: projectUuid,
            todolist_id: todolistDbId,
            title,
            description: cleanTodoDesc,
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

        await syncTodolistCounts(supabase, todolistDbId)

        // 2. Mirror to Basecamp API (notify: false so TEG sends the accurate branded email) + Email involved people
        let finalTodoBcId = bcTodoId
        const reqOrigin = new URL(request.url).origin
        const { data: todolistRow } = await supabase
          .from('bc_todolists')
          .select('bc_id')
          .eq('id', todolistDbId)
          .maybeSingle()

        const mirrorPromise = (async () => {
          if (!isRealBasecampId(todolistRow?.bc_id)) return
          let assigneeBcIds: number[] = []
          if (assigneeUuids && assigneeUuids.length > 0) {
            const { data: assigneePeople } = await supabase
              .from('bc_people')
              .select('bc_id')
              .in('id', assigneeUuids)
            if (assigneePeople) {
              assigneeBcIds = assigneePeople.map((p: any) => Number(p.bc_id)).filter((id: number) => isRealBasecampId(id))
            }
          }

          const bcReadyDesc = await mirrorSupabaseAttachmentsForBasecampHtml(cleanTodoDesc, supabase)
          const bcDescriptionWithAuthor = buildBasecampDescriptionWithAuthor(
            bcReadyDesc,
            authorDisplayName,
            user.email
          )

          const bcResult = await basecampBestEffort('create_todo', () =>
            bcCreateTodo(bcProjectId, Number(todolistRow!.bc_id), {
              content: title,
              description: bcDescriptionWithAuthor || undefined,
              assignee_ids: assigneeBcIds.length > 0 ? assigneeBcIds : undefined,
              notify: false,
              due_on: due_date || undefined,
            })
          )

          if (bcResult && dbTodo) {
            finalTodoBcId = bcResult.id
            await supabase.from('bc_todos').delete().eq('bc_id', bcResult.id).neq('id', dbTodo.id)
            await supabase
              .from('bc_todos')
              .update({ bc_id: bcResult.id, created_by_person_id: authorPersonId })
              .eq('id', dbTodo.id)
          }
        })()

        const emailPromise =
          args.skipEmailNotification || !dbTodo?.id
            ? Promise.resolve(null)
            : sendBasecampTodoNotificationEmail({
                event: 'assigned',
                todoDbId: dbTodo.id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                appOrigin: reqOrigin,
              })

        await Promise.all([mirrorPromise, emailPromise])

        return NextResponse.json({ success: true, id: dbTodo?.id, bc_id: finalTodoBcId })
      }

      case 'create_message': {
        requireArgs(['boardDbId', 'title'])
        const { boardDbId, title, content, category } = args
        const bcMsgId = generateUniqueBcId()
        const cleanMsgContent = await uploadEmbeddedDataUrisToStorage(content, 'messages', supabase)

        // 1. Save to Supabase
        const { data: dbMsg, error: msgErr } = await supabase
          .from('bc_messages')
          .insert({
            bc_id: bcMsgId,
            project_id: projectUuid,
            board_id: boardDbId,
            title,
            content: cleanMsgContent,
            category: category || 'General',
            author_person_id: authorPersonId,
            comments_count: 0,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (msgErr) throw msgErr

        // 2. Mirror to Basecamp API (best-effort)
        let finalMsgBcId = bcMsgId
        const { data: boardRow } = await supabase
          .from('bc_message_boards')
          .select('bc_id')
          .eq('id', boardDbId)
          .maybeSingle()
        if (isRealBasecampId(boardRow?.bc_id)) {
          const bcMsgContentWithAuthor = buildBasecampCommentWithAuthor(
            cleanMsgContent,
            authorDisplayName,
            user.email
          )
          const bcResult = await basecampBestEffort('create_message', () =>
            bcCreateMessage(bcProjectId, Number(boardRow!.bc_id), {
              subject: title,
              content: bcMsgContentWithAuthor || undefined,
            })
          )

          if (bcResult && dbMsg) {
            finalMsgBcId = bcResult.id
            await supabase.from('bc_messages').delete().eq('bc_id', bcResult.id).neq('id', dbMsg.id)
            await supabase
              .from('bc_messages')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbMsg.id)
          }
        }

        return NextResponse.json({ success: true, id: dbMsg?.id, bc_id: finalMsgBcId })
      }

      case 'create_campfire_line': {
        requireArgs(['campfireDbId', 'content'])
        const { campfireDbId, content } = args
        const bcLineId = generateUniqueBcId()
        const cleanLineContent = await uploadEmbeddedDataUrisToStorage(content, 'campfire', supabase)

        // 1. Save to Supabase
        const { data: dbLine, error: lineErr } = await supabase
          .from('bc_campfire_lines')
          .insert({
            bc_id: bcLineId,
            project_id: projectUuid,
            campfire_id: campfireDbId,
            content: cleanLineContent,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (lineErr) throw lineErr

        // 2. Mirror to Basecamp API (best-effort)
        let finalLineBcId = bcLineId
        const { data: campfireRow } = await supabase
          .from('bc_campfires')
          .select('bc_id')
          .eq('id', campfireDbId)
          .maybeSingle()
        if (isRealBasecampId(campfireRow?.bc_id)) {
          const bcLineContentWithAuthor = buildBasecampCommentWithAuthor(
            cleanLineContent,
            authorDisplayName,
            user.email
          )
          const bcResult = await basecampBestEffort('create_campfire_line', () =>
            bcCreateCampfireLine(bcProjectId, Number(campfireRow!.bc_id), bcLineContentWithAuthor)
          )

          if (bcResult && dbLine) {
            finalLineBcId = bcResult.id
            await supabase.from('bc_campfire_lines').delete().eq('bc_id', bcResult.id).neq('id', dbLine.id)
            await supabase
              .from('bc_campfire_lines')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbLine.id)
          }
        }

        return NextResponse.json({ success: true, id: dbLine?.id, bc_id: finalLineBcId })
      }

      case 'create_comment': {
        requireArgs(['parentType', 'parentDbId', 'content'])
        const { parentType, parentDbId, content } = args
        const bcCommentId = generateUniqueBcId()
        const cleanCommentContent = await uploadEmbeddedDataUrisToStorage(content, 'comments', supabase)

        // 1. Save to Supabase
        const { data: dbComment, error: comErr } = await supabase
          .from('bc_comments')
          .insert({
            bc_id: bcCommentId,
            project_id: projectUuid,
            parent_type: parentType,
            parent_id: parentDbId,
            content: cleanCommentContent,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (comErr) throw comErr

        // Update comment counter in the parent table using exact DB count
        await syncParentCommentsCount(supabase, parentType, parentDbId)

        // 2. Mirror to Basecamp API + Email involved people on To-Do comments (best-effort)
        let finalCommentBcId = bcCommentId
        const reqOrigin = new URL(request.url).origin
        const parentTableMap: Record<string, string> = {
          message: 'bc_messages',
          todo: 'bc_todos',
          document: 'bc_documents',
        }
        const parentTable = parentTableMap[parentType]
        const mirrorCommentPromise = (async () => {
          if (!parentTable) return
          const { data: parentRow } = await supabase
            .from(parentTable)
            .select('bc_id')
            .eq('id', parentDbId)
            .maybeSingle()
          if (isRealBasecampId(parentRow?.bc_id)) {
            const bcReadyComment = await mirrorSupabaseAttachmentsForBasecampHtml(cleanCommentContent, supabase)
            const bcCommentWithAuthor = buildBasecampCommentWithAuthor(
              bcReadyComment,
              authorDisplayName,
              user.email
            )
            const bcResult = await basecampBestEffort('create_comment', () =>
              bcCreateComment(bcProjectId, Number(parentRow!.bc_id), bcCommentWithAuthor)
            )

            if (bcResult && dbComment) {
              finalCommentBcId = bcResult.id
              await supabase.from('bc_comments').delete().eq('bc_id', bcResult.id).neq('id', dbComment.id)
              await supabase
                .from('bc_comments')
                .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
                .eq('id', dbComment.id)
            }
          }
        })()

        const emailCommentPromise =
          parentType === 'todo' && !args.skipEmailNotification
            ? sendBasecampTodoNotificationEmail({
                event: 'commented',
                todoDbId: parentDbId,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                commentHtml: cleanCommentContent,
                appOrigin: reqOrigin,
              })
            : Promise.resolve(null)

        await Promise.all([mirrorCommentPromise, emailCommentPromise])

        return NextResponse.json({ success: true, id: dbComment?.id, bc_id: finalCommentBcId })
      }

      case 'create_answer': {
        requireArgs(['questionDbId', 'content'])
        const { questionDbId, content } = args
        const bcAnswerId = generateUniqueBcId()
        const cleanAnswerContent = await uploadEmbeddedDataUrisToStorage(content, 'answers', supabase)

        // 1. Save to Supabase
        const { data: dbAnswer, error: ansErr } = await supabase
          .from('bc_answers')
          .insert({
            bc_id: bcAnswerId,
            project_id: projectUuid,
            question_id: questionDbId,
            content: cleanAnswerContent,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (ansErr) throw ansErr

        // 2. Mirror to Basecamp API (best-effort)
        let finalAnswerBcId = bcAnswerId
        const { data: questionRow } = await supabase
          .from('bc_questions')
          .select('bc_id')
          .eq('id', questionDbId)
          .maybeSingle()
        if (isRealBasecampId(questionRow?.bc_id)) {
          const bcAnswerWithAuthor = buildBasecampCommentWithAuthor(cleanAnswerContent, authorDisplayName, user.email)
          const bcResult = await basecampBestEffort('create_answer', () =>
            bcCreateAnswer(bcProjectId, Number(questionRow!.bc_id), bcAnswerWithAuthor)
          )

          if (bcResult && dbAnswer) {
            finalAnswerBcId = bcResult.id
            await supabase.from('bc_answers').delete().eq('bc_id', bcResult.id).neq('id', dbAnswer.id)
            await supabase
              .from('bc_answers')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbAnswer.id)
          }
        }

        return NextResponse.json({ success: true, id: dbAnswer?.id, bc_id: finalAnswerBcId })
      }

      case 'create_schedule_entry': {
        requireArgs(['scheduleDbId', 'title', 'starts_at', 'ends_at'])
        const { scheduleDbId, title, description, starts_at, ends_at, all_day } = args
        const bcEventId = generateUniqueBcId()
        const cleanEventDesc = await uploadEmbeddedDataUrisToStorage(description, 'schedules', supabase)

        // 1. Save to Supabase
        const { data: dbEvent, error: evtErr } = await supabase
          .from('bc_schedule_entries')
          .insert({
            bc_id: bcEventId,
            project_id: projectUuid,
            schedule_id: scheduleDbId,
            title,
            description: cleanEventDesc,
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
        let finalEventBcId = bcEventId
        const { data: scheduleRow } = await supabase
          .from('bc_schedules')
          .select('bc_id')
          .eq('id', scheduleDbId)
          .maybeSingle()
        if (isRealBasecampId(scheduleRow?.bc_id)) {
          const bcDescWithAuthor = buildBasecampDescriptionWithAuthor(cleanEventDesc, authorDisplayName, user.email)
          const bcResult = await basecampBestEffort('create_schedule_entry', () =>
            bcCreateScheduleEntry(bcProjectId, Number(scheduleRow!.bc_id), {
              summary: title,
              description: bcDescWithAuthor || undefined,
              starts_at,
              ends_at,
              all_day: all_day || false,
            })
          )

          if (bcResult && dbEvent) {
            finalEventBcId = bcResult.id
            await supabase.from('bc_schedule_entries').delete().eq('bc_id', bcResult.id).neq('id', dbEvent.id)
            await supabase
              .from('bc_schedule_entries')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbEvent.id)
          }
        }

        return NextResponse.json({ success: true, id: dbEvent?.id, bc_id: finalEventBcId })
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
        const cleanDocContent = await uploadEmbeddedDataUrisToStorage(content, 'documents', supabase)

        // 1. Save to Supabase
        const { data: dbDoc, error: docErr } = await supabase
          .from('bc_documents')
          .insert({
            bc_id: bcDocId,
            project_id: projectUuid,
            vault_id: vaultDbId,
            title,
            content: cleanDocContent,
            author_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (docErr) throw docErr

        // 2. Mirror to Basecamp API (best-effort)
        let finalDocBcId = bcDocId
        const { data: vaultRow } = await supabase
          .from('bc_vaults')
          .select('bc_id')
          .eq('id', vaultDbId)
          .maybeSingle()
        if (isRealBasecampId(vaultRow?.bc_id)) {
          const bcDocContentWithAuthor = buildBasecampDescriptionWithAuthor(cleanDocContent, authorDisplayName, user.email)
          const bcResult = await basecampBestEffort('create_document', () =>
            bcCreateDocument(bcProjectId, Number(vaultRow!.bc_id), { title, content: bcDocContentWithAuthor })
          )

          if (bcResult && dbDoc) {
            finalDocBcId = bcResult.id
            await supabase.from('bc_documents').delete().eq('bc_id', bcResult.id).neq('id', dbDoc.id)
            await supabase
              .from('bc_documents')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbDoc.id)
          }
        }

        return NextResponse.json({ success: true, id: dbDoc?.id, bc_id: finalDocBcId })
      }

      case 'create_upload': {
        requireArgs(['filename', 'download_url'])
        const { vaultDbId, filename, content_type, byte_size, download_url } = args
        const trimmedFilename = String(filename).trim()
        const trimmedDownloadUrl = String(download_url).trim()
        if (!trimmedFilename || !trimmedDownloadUrl) {
          return NextResponse.json({ error: 'Missing filename or download_url' }, { status: 400 })
        }

        let targetVaultDbId: string | null = vaultDbId || null
        if (!targetVaultDbId) {
          const { data: existingVault } = await supabase
            .from('bc_vaults')
            .select('id')
            .eq('project_id', projectUuid)
            .is('parent_vault_id', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          if (existingVault?.id) {
            targetVaultDbId = existingVault.id
          } else {
            const { data: createdVault, error: createdVaultErr } = await supabase
              .from('bc_vaults')
              .insert({
                bc_id: generateUniqueBcId(),
                project_id: projectUuid,
                name: 'Docs & Files',
                parent_vault_id: null,
                created_at: new Date().toISOString(),
              })
              .select('id')
              .single()
            if (createdVaultErr) throw createdVaultErr
            targetVaultDbId = createdVault.id
          }
        }

        const bcUploadId = generateUniqueBcId()
        const { data: dbUpload, error: upErr } = await supabase
          .from('bc_uploads')
          .insert({
            bc_id: bcUploadId,
            project_id: projectUuid,
            vault_id: targetVaultDbId,
            filename: trimmedFilename,
            content_type: content_type || 'application/octet-stream',
            byte_size: Math.max(0, Number(byte_size) || 0),
            download_url: trimmedDownloadUrl,
            author_person_id: authorPersonId,
            created_at: new Date().toISOString(),
          })
          .select(
            `
            id, bc_id, filename, content_type, byte_size, download_url, vault_id, author_person_id, created_at,
            author:bc_people(name)
          `
          )
          .single()

        if (upErr) throw upErr

        return NextResponse.json({
          success: true,
          id: dbUpload?.id,
          bc_id: bcUploadId,
          vault_id: targetVaultDbId,
          author_person_id: authorPersonId,
          upload: dbUpload,
        })
      }

      case 'delete_recording': {
        const { recordingDbId, tableName } = args
        if (!recordingDbId || !tableName) {
          return NextResponse.json({ error: 'Missing recordingDbId or tableName' }, { status: 400 })
        }

        // Validate table
        const allowedTables = [
          'bc_todos',
          'bc_messages',
          'bc_comments',
          'bc_documents',
          'bc_schedule_entries',
          'bc_vaults',
          'bc_uploads',
        ]
        if (!allowedTables.includes(tableName)) {
          return NextResponse.json({ error: 'Invalid tableName' }, { status: 400 })
        }

        let commentParentToSync: { parent_type?: string | null; parent_id?: string | null } | null = null
        let todolistDbIdToSync: string | null = null

        if (tableName === 'bc_comments') {
          const { data: commentRow } = await supabase
            .from('bc_comments')
            .select('parent_type, parent_id')
            .eq('id', recordingDbId)
            .eq('project_id', projectUuid)
            .maybeSingle()
          commentParentToSync = commentRow || null
        } else if (tableName === 'bc_todos') {
          const { data: todoRow } = await supabase
            .from('bc_todos')
            .select('id, todolist_id')
            .eq('id', recordingDbId)
            .eq('project_id', projectUuid)
            .maybeSingle()
          if (todoRow) {
            todolistDbIdToSync = todoRow.todolist_id || null
            await supabase.from('bc_todo_assignees').delete().eq('todo_id', recordingDbId)
            await supabase
              .from('bc_comments')
              .delete()
              .eq('project_id', projectUuid)
              .eq('parent_type', 'todo')
              .eq('parent_id', recordingDbId)
          }
        } else if (tableName === 'bc_messages') {
          await supabase
            .from('bc_comments')
            .delete()
            .eq('project_id', projectUuid)
            .eq('parent_type', 'message')
            .eq('parent_id', recordingDbId)
        } else if (tableName === 'bc_documents') {
          await supabase
            .from('bc_comments')
            .delete()
            .eq('project_id', projectUuid)
            .eq('parent_type', 'document')
            .eq('parent_id', recordingDbId)
        } else if (tableName === 'bc_uploads') {
          const { data: uploadRow } = await supabase
            .from('bc_uploads')
            .select('download_url')
            .eq('id', recordingDbId)
            .eq('project_id', projectUuid)
            .maybeSingle()
          const storagePath = extractBasecampUploadStoragePath(uploadRow?.download_url)
          if (storagePath) {
            const { error: storageDelErr } = await supabase.storage.from('checklist-photos').remove([storagePath])
            if (storageDelErr) {
              console.warn(`⚠️ [Basecamp Action] Non-fatal Storage delete warning (${storagePath}):`, storageDelErr.message)
            }
          }
        } else if (tableName === 'bc_vaults') {
          // Recursively collect all nested sub-vaults and delete child bc_documents + bc_uploads (since FK is ON DELETE SET NULL)
          const { data: projectVaults } = await supabase
            .from('bc_vaults')
            .select('id, parent_vault_id')
            .eq('project_id', projectUuid)

          const childrenByParent = new Map<string, string[]>()
          for (const v of projectVaults || []) {
            if (v.parent_vault_id) {
              const arr = childrenByParent.get(v.parent_vault_id) || []
              arr.push(v.id)
              childrenByParent.set(v.parent_vault_id, arr)
            }
          }

          const subtreeVaultIds: string[] = []
          const collectBottomUp = (vid: string) => {
            const kids = childrenByParent.get(vid) || []
            for (const kid of kids) collectBottomUp(kid)
            subtreeVaultIds.push(vid)
          }
          if ((projectVaults || []).some((v: any) => v.id === recordingDbId)) {
            collectBottomUp(recordingDbId)
          }

          if (subtreeVaultIds.length > 0) {
            const [{ data: childDocs }, { data: childUploads }] = await Promise.all([
              supabase.from('bc_documents').select('id').eq('project_id', projectUuid).in('vault_id', subtreeVaultIds),
              supabase
                .from('bc_uploads')
                .select('id, download_url')
                .eq('project_id', projectUuid)
                .in('vault_id', subtreeVaultIds),
            ])

            const docIds = (childDocs || []).map((d: any) => d.id)
            if (docIds.length > 0) {
              await supabase
                .from('bc_comments')
                .delete()
                .eq('project_id', projectUuid)
                .eq('parent_type', 'document')
                .in('parent_id', docIds)
              await supabase.from('bc_documents').delete().eq('project_id', projectUuid).in('id', docIds)
            }

            const uploadIds = (childUploads || []).map((u: any) => u.id)
            const storagePaths = (childUploads || [])
              .map((u: any) => extractBasecampUploadStoragePath(u.download_url))
              .filter((p: string | null): p is string => Boolean(p))
            if (storagePaths.length > 0) {
              await supabase.storage.from('checklist-photos').remove(storagePaths)
            }
            if (uploadIds.length > 0) {
              await supabase.from('bc_uploads').delete().eq('project_id', projectUuid).in('id', uploadIds)
            }

            // Delete descendant sub-vaults bottom-up before deleting the target vault itself
            for (const subId of subtreeVaultIds) {
              if (subId !== recordingDbId) {
                await supabase.from('bc_vaults').delete().eq('project_id', projectUuid).eq('id', subId)
              }
            }
          }
        }

        // LOCAL delete — scoped to projectUuid for safety
        const { error: delErr } = await supabase
          .from(tableName)
          .delete()
          .eq('id', recordingDbId)
          .eq('project_id', projectUuid)

        if (delErr) throw delErr

        if (commentParentToSync?.parent_id) {
          await syncParentCommentsCount(supabase, commentParentToSync.parent_type, commentParentToSync.parent_id)
        }
        if (todolistDbIdToSync) {
          await syncTodolistCounts(supabase, todolistDbIdToSync)
        }

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
