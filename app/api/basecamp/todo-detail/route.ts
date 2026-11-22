/**
 * @module api/basecamp/todo-detail
 * @description Ruta GET que obtiene los detalles completos de una tarea (To-Do), sus asignados, fechas
 *              (`starts_on` / `due_date`), grupo (`group_id`), reacciones (`boosts` y `commentBoosts`) y
 *              comentarios desde la API de Basecamp 3 en tiempo real (con fallback resiliente a Supabase
 *              local para tareas sintéticas `bc_id >= 1e11`, 404 remotos o fallos transitorios de red),
 *              garantizando firmas frescas de imágenes y preservación estricta de autoría TEG.
 * @businessRules
 *   - Requiere autenticación de personal interno SM TEG (`verifyStaffAuth`, `allowCron: false`).
 *   - Para tareas locales (`bc_id >= 100_000_000_000`) o ante 404/error de Basecamp, responde desde Supabase local
 *     con la misma estructura completa (`title`, `starts_on`, `due_date`, `assigneeUuids`, `group_id`, `boosts`, `commentBoosts`).
 *   - Si la carga de comentarios en Basecamp falla (`commentsFetchFailed`), NUNCA sobreescribe `comments_count = 0`
 *     ni devuelve un arreglo vacío; conserva y retorna los comentarios locales de Supabase.
 *   - Inversión de Prioridad de Autoría: `extractedAuthorName` (`stripTegAuthorBanner` + `findPersonInListByFuzzyName`)
 *     tiene Prioridad #1 sobre registros previos que hayan guardado temporalmente el dueño del token OAuth.
 *   - Hidrata `fetchBoosts` hacia `bc_boosts` cuando `boosts_count > 0` en el To-Do o en sus comentarios,
 *     preservando cualquier boost sintético local (`bc_id >= 1e11`).
 * @dataFlow
 *   - GET /api/basecamp/todo-detail?projectId=X&todoId=Y
 *   - verifyStaffAuth -> lookup local `bc_todos` -> Basecamp API (si `< 1e11`) -> reconciliación DB -> JSON enriquecido
 * @notes
 *   - Sincroniza `bc_todolists` (`syncTodolistCounts`) y `bc_todolist_groups` (`syncTodolistGroupCounts`) cuando cambia `is_completed` o `group_id`.
 *   - En modo `standalone` (o sin token OAuth), responde en `0 ms` sin red externa hidratando directamente desde Supabase (`bc_todos`, `bc_todo_assignees`, `bc_comments`, `bc_boosts`, `bc_todolists`, `bc_todolist_groups`).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  BASECAMP_STAFF_ALLOWED_ROLES,
  detectBasecampCutoverReason,
  getBasecampSystemConfig,
  getValidToken,
  basecampFetch,
  fetchBoosts,
  isSupabaseStorageUrl,
  resolveHtmlAttachmentsFromCache,
  syncTodolistCounts,
  syncTodolistGroupCounts,
  triggerBasecampAutoCutover,
} from '@/lib/basecamp-api'
import {
  stripTegAuthorBanner,
  findPersonInListByFuzzyName,
  isMaskedOrEmptyEmail,
  isRealBasecampId,
  SYNTHETIC_BC_ID_THRESHOLD,
} from '@/lib/basecamp-person-resolver'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export interface TodoDetailBoostItem {
  id: string
  bc_id: number
  recording_type: string
  recording_id: string
  booster_person_id: string | null
  booster_name: string
  booster_avatar_url: string
  content: string
  created_at: string
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

function unwrapPersonRel(rel: any): { id?: string; name?: string; avatar_url?: string } | null {
  if (!rel) return null
  if (Array.isArray(rel)) return rel[0] || null
  return rel
}

function formatBoostRow(row: any): TodoDetailBoostItem {
  const booster = unwrapPersonRel(row.booster)
  return {
    id: String(row.id),
    bc_id: Number(row.bc_id || 0),
    recording_type: String(row.recording_type || 'todo'),
    recording_id: String(row.recording_id || ''),
    booster_person_id: row.booster_person_id || booster?.id || null,
    booster_name: booster?.name || 'Equipo TEG',
    booster_avatar_url: booster?.avatar_url || '',
    content: String(row.content || '👍'),
    created_at: row.created_at || new Date().toISOString(),
  }
}

async function loadBoostMapsForTodoAndComments(
  supabase: any,
  todoUuid: string | null | undefined,
  commentUuids: string[]
): Promise<{
  todoBoosts: TodoDetailBoostItem[]
  commentBoosts: Record<string, TodoDetailBoostItem[]>
}> {
  const commentBoosts: Record<string, TodoDetailBoostItem[]> = {}
  for (const cid of commentUuids) {
    if (cid) commentBoosts[cid] = []
  }

  const allTargetIds = [
    ...(todoUuid ? [todoUuid] : []),
    ...commentUuids.filter((cid) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cid)),
  ]
  if (allTargetIds.length === 0) {
    return { todoBoosts: [], commentBoosts }
  }

  const { data: boostRows } = await supabase
    .from('bc_boosts')
    .select('id, bc_id, recording_type, recording_id, booster_person_id, content, created_at, booster:bc_people(id, name, avatar_url)')
    .in('recording_id', allTargetIds)
    .order('created_at', { ascending: true })

  const todoBoosts: TodoDetailBoostItem[] = []
  for (const row of boostRows || []) {
    const formatted = formatBoostRow(row)
    if (todoUuid && formatted.recording_type === 'todo' && formatted.recording_id === todoUuid) {
      todoBoosts.push(formatted)
    } else if (formatted.recording_type === 'comment') {
      if (!commentBoosts[formatted.recording_id]) {
        commentBoosts[formatted.recording_id] = []
      }
      commentBoosts[formatted.recording_id].push(formatted)
    }
  }

  return { todoBoosts, commentBoosts }
}

async function buildLocalTodoDetailResponse(supabase: any, dbTodo: any, urlCache: Map<string, string>) {
  const rawDesc = await resolveHtmlAttachmentsFromCache(dbTodo.description || '', supabase, urlCache)
  const { cleanHtml: resolvedTodoDescription } = stripTegAuthorBanner(rawDesc)

  if (resolvedTodoDescription !== (dbTodo.description || '')) {
    await supabase
      .from('bc_todos')
      .update({ description: resolvedTodoDescription, updated_at: new Date().toISOString() })
      .eq('id', dbTodo.id)
  }

  const [
    { data: localComments },
    { data: assigneeRows },
    { data: todolistRow },
    { data: groupRow },
  ] = await Promise.all([
    supabase
      .from('bc_comments')
      .select('id, bc_id, content, created_at, updated_at, boosts_count, author_person_id, author:bc_people(id, name, avatar_url)')
      .eq('parent_id', dbTodo.id)
      .order('created_at', { ascending: true }),
    supabase.from('bc_todo_assignees').select('person_id').eq('todo_id', dbTodo.id),
    dbTodo.todolist_id
      ? supabase
          .from('bc_todolists')
          .select('id, bc_id, name, color, completed_count, total_count')
          .eq('id', dbTodo.todolist_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    dbTodo.group_id
      ? supabase
          .from('bc_todolist_groups')
          .select('id, bc_id, name, color, completed_count, total_count')
          .eq('id', dbTodo.group_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const commentUuids = (localComments || []).map((lc: any) => String(lc.id))
  const { todoBoosts, commentBoosts } = await loadBoostMapsForTodoAndComments(supabase, dbTodo.id, commentUuids)

  const formattedComments = []
  for (const lc of localComments || []) {
    const rawCom = await resolveHtmlAttachmentsFromCache(lc.content || '', supabase, urlCache)
    const { cleanHtml, extractedAuthorName } = stripTegAuthorBanner(rawCom)
    if (cleanHtml !== (lc.content || '')) {
      await supabase.from('bc_comments').update({ content: cleanHtml }).eq('id', lc.id)
    }
    const cId = String(lc.id)
    const cBoosts = commentBoosts[cId] || []
    const authorRel = unwrapPersonRel(lc.author)
    formattedComments.push({
      id: cId,
      bc_id: lc.bc_id,
      author: authorRel?.name || extractedAuthorName || 'Unknown',
      author_person_id: lc.author_person_id || authorRel?.id || null,
      text: cleanHtml,
      timestamp: lc.created_at,
      updated_at: lc.updated_at || lc.created_at,
      boosts_count: cBoosts.length || Number(lc.boosts_count || 0),
      boosts: cBoosts,
    })
  }

  const assigneeUuids = (assigneeRows || []).map((r: any) => String(r.person_id)).filter(Boolean)

  return NextResponse.json({
    success: true,
    source: 'local',
    id: dbTodo.id,
    bc_id: dbTodo.bc_id,
    title: dbTodo.title || '',
    is_completed: Boolean(dbTodo.is_completed),
    starts_on: dbTodo.starts_on || null,
    due_date: dbTodo.due_date || null,
    group_id: dbTodo.group_id || null,
    todolist_id: dbTodo.todolist_id || null,
    todolist: todolistRow || null,
    group: groupRow || null,
    assigneeUuids,
    completionSubscriberUuids: Array.isArray(dbTodo.completion_subscriber_ids)
      ? dbTodo.completion_subscriber_ids
      : [],
    description: resolvedTodoDescription,
    boosts_count: todoBoosts.length || Number(dbTodo.boosts_count || 0),
    boosts: todoBoosts,
    commentBoosts,
    comments_count: formattedComments.length,
    comments: formattedComments,
  })
}

export async function GET(request: Request) {
  const auth = verifyStaffAuth(request, {
    allowCron: false,
    allowedRoles: BASECAMP_STAFF_ALLOWED_ROLES,
  })
  if (!auth.authorized) {
    return auth.response!
  }

  try {
    const { searchParams } = new URL(request.url)
    const projectId = (searchParams.get('projectId') || '').trim()
    const todoId = (searchParams.get('todoId') || '').trim()

    if (!projectId || !todoId) {
      return NextResponse.json({ error: 'Missing projectId or todoId' }, { status: 400 })
    }

    const supabase = getAdminSupabase()
    const urlCache = new Map<string, string>()

    const isUuidQuery = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(todoId)
    const isNumericTodoId = /^\d+$/.test(todoId)
    const isNumericProjectId = /^\d+$/.test(projectId)

    if (!isUuidQuery && !isNumericTodoId) {
      return NextResponse.json({ error: 'Invalid todoId format' }, { status: 400 })
    }

    const todoLookupQuery = supabase
      .from('bc_todos')
      .select(
        'id, bc_id, project_id, todolist_id, group_id, title, starts_on, due_date, is_completed, description, comments_count, boosts_count, completion_subscriber_ids, created_by_person_id'
      )
    const { data: dbTodo } = isUuidQuery
      ? await todoLookupQuery.eq('id', todoId).maybeSingle()
      : await todoLookupQuery.eq('bc_id', Number(todoId)).maybeSingle()

    const numericTodoBcId = isNumericTodoId ? Number(todoId) : Number(dbTodo?.bc_id || 0)

    // Resolve numeric Basecamp project bc_id even if projectId query param was passed as UUID
    let numericProjectBcId = isNumericProjectId ? Number(projectId) : 0
    if (!numericProjectBcId && dbTodo?.project_id) {
      const { data: pRow } = await supabase
        .from('bc_projects')
        .select('bc_id')
        .eq('id', dbTodo.project_id)
        .maybeSingle()
      if (pRow?.bc_id) numericProjectBcId = Number(pRow.bc_id)
    }

    // 1. Standalone mode, local-only synthetic todo (bc_id >= 1e11), or non-Basecamp project -> 0ms direct from Supabase
    const sysCfg = await getBasecampSystemConfig()
    if (
      sysCfg.runtime_mode === 'standalone' ||
      !isRealBasecampId(numericProjectBcId) ||
      !isRealBasecampId(numericTodoBcId)
    ) {
      if (!dbTodo?.id) {
        return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
      }
      return buildLocalTodoDetailResponse(supabase, dbTodo, urlCache)
    }

    // 2. Fetch Todo details and Comments from Basecamp API with instant local fallback if OAuth token missing/expired
    let todo: any = null
    try {
      const token = await getValidToken().catch(async (tokenErr: any) => {
        const cutoverReason = detectBasecampCutoverReason(tokenErr)
        if (cutoverReason) {
          await triggerBasecampAutoCutover(cutoverReason)
        }
        return ''
      })
      if (!token) {
        if (dbTodo?.id) {
          return buildLocalTodoDetailResponse(supabase, dbTodo, urlCache)
        }
        return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
      }
      todo = await basecampFetch<any>(`/buckets/${numericProjectBcId}/todos/${numericTodoBcId}.json`, {
        noPaginate: true,
      })
    } catch (todoFetchErr: any) {
      const cutoverReason = detectBasecampCutoverReason(todoFetchErr)
      if (cutoverReason) {
        await triggerBasecampAutoCutover(cutoverReason)
      }
      console.warn(`[Todo Detail API] Basecamp fetch fallback for todo ${numericTodoBcId}:`, todoFetchErr.message)
      if (dbTodo?.id) {
        return buildLocalTodoDetailResponse(supabase, dbTodo, urlCache)
      }
      const status = String(todoFetchErr?.message || '').includes('(404)') ? 404 : 502
      return NextResponse.json({ error: `Failed to fetch todo detail: ${todoFetchErr.message}` }, { status })
    }

    let commentsFetchFailed = false
    const rawComments = await basecampFetch<any[]>(
      `/buckets/${numericProjectBcId}/recordings/${numericTodoBcId}/comments.json`
    ).catch((err) => {
      commentsFetchFailed = true
      console.warn(`[Todo Detail API] Failed to fetch comments for todo ${numericTodoBcId}:`, err.message)
      return []
    })

    const comments = Array.isArray(rawComments) ? rawComments : []

    const [{ data: peopleRows }, { data: existingComments }, { data: existingAssignees }] = await Promise.all([
      supabase.from('bc_people').select('id, bc_id, name, email, avatar_url, attachable_sgid').limit(5000),
      dbTodo?.id
        ? supabase
            .from('bc_comments')
            .select('id, bc_id, content, created_at, updated_at, boosts_count, author_person_id, author:bc_people(id, name)')
            .eq('parent_id', dbTodo.id)
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
      dbTodo?.id
        ? supabase.from('bc_todo_assignees').select('person_id, person:bc_people(bc_id)').eq('todo_id', dbTodo.id)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const allPeople = peopleRows || []
    const peopleMap = new Map<number, string>()
    const personNameById = new Map<string, string>()
    for (const p of allPeople) {
      if (p.bc_id != null) peopleMap.set(Number(p.bc_id), p.id)
      if (p.id && p.name) personNameById.set(p.id, p.name)
    }

    const ensurePersonInDb = async (personRef: any): Promise<string | null> => {
      if (!personRef?.id) return null
      const bcPid = Number(personRef.id)
      if (peopleMap.has(bcPid)) return peopleMap.get(bcPid) || null
      const incomingEmail = personRef.email_address || ''
      const { data: existingRow } = await supabase
        .from('bc_people')
        .select('id, name, email, avatar_url')
        .eq('bc_id', bcPid)
        .maybeSingle()
      const preservedAvatar =
        existingRow?.avatar_url && isSupabaseStorageUrl(existingRow.avatar_url)
          ? existingRow.avatar_url
          : personRef.avatar_url || ''
      const preservedEmail =
        isMaskedOrEmptyEmail(incomingEmail) && existingRow?.email && !isMaskedOrEmptyEmail(existingRow.email)
          ? existingRow.email
          : isMaskedOrEmptyEmail(incomingEmail)
          ? ''
          : incomingEmail
      const { data: newPerson } = await supabase
        .from('bc_people')
        .upsert(
          {
            bc_id: bcPid,
            name: personRef.name || 'Unknown',
            email: preservedEmail,
            avatar_url: preservedAvatar,
            role: personRef.employee ? 'employee' : 'user',
            title: personRef.title || '',
            attachable_sgid: personRef.attachable_sgid || null,
            is_active: true,
          },
          { onConflict: 'bc_id' }
        )
        .select('id, name')
        .maybeSingle()
      if (newPerson?.id) {
        peopleMap.set(bcPid, newPerson.id)
        if (newPerson.name) personNameById.set(newPerson.id, newPerson.name)
        return newPerson.id
      }
      return null
    }

    // 3. Resolve & strip TEG banner on Todo description + Priority #1 author healing
    const rawResolvedDesc = await resolveHtmlAttachmentsFromCache(todo.description || '', supabase, urlCache)
    const { cleanHtml: resolvedTodoDescription, extractedAuthorName: extractedTodoAuthor } =
      stripTegAuthorBanner(rawResolvedDesc)

    const extractedTodoPerson = extractedTodoAuthor
      ? findPersonInListByFuzzyName(allPeople, extractedTodoAuthor)
      : null

    const localSyntheticComments = (existingComments || []).filter(
      (ec: any) => Number(ec.bc_id) >= SYNTHETIC_BC_ID_THRESHOLD
    )

    // Reconcile title, starts_on, due_date, group_id, assignees, completion_subscribers, and boosts
    const remoteTitle = String(todo.content || todo.title || dbTodo?.title || '').trim()
    const remoteStartsOn: string | null = todo.starts_on || null
    const remoteDueDate: string | null = todo.due_on || null
    const remoteBoostsCount = Number(todo.boosts_count || 0)

    let resolvedGroupId: string | null = dbTodo?.group_id || null
    let resolvedTodolistId: string | null = dbTodo?.todolist_id || null
    const parentBcId = Number(todo.parent?.id || 0)
    if (parentBcId > 0) {
      const { data: parentGroup } = await supabase
        .from('bc_todolist_groups')
        .select('id, todolist_id')
        .eq('bc_id', parentBcId)
        .maybeSingle()
      if (parentGroup?.id) {
        resolvedGroupId = parentGroup.id
        resolvedTodolistId = parentGroup.todolist_id
      } else {
        const { data: parentList } = await supabase
          .from('bc_todolists')
          .select('id')
          .eq('bc_id', parentBcId)
          .maybeSingle()
        if (parentList?.id) {
          resolvedGroupId = null
          resolvedTodolistId = parentList.id
        }
      }
    }

    // Merge remote assignees + preserved local synthetic assignees
    const reconciledAssigneeSet = new Set<string>()
    for (const ea of existingAssignees || []) {
      const pRel = unwrapPersonRel((ea as any).person)
      const pBcId = Number((pRel as any)?.bc_id || 0)
      if (ea.person_id && pBcId >= SYNTHETIC_BC_ID_THRESHOLD) {
        reconciledAssigneeSet.add(String(ea.person_id))
      }
    }
    for (const a of todo.assignees || []) {
      const aUuid = await ensurePersonInDb(a)
      if (aUuid) reconciledAssigneeSet.add(aUuid)
    }
    const reconciledAssigneeUuids = Array.from(reconciledAssigneeSet)

    // Merge remote completion_subscribers + preserved local synthetic subscribers
    const reconciledCompSubSet = new Set<string>()
    if (Array.isArray(dbTodo?.completion_subscriber_ids)) {
      for (const uid of dbTodo.completion_subscriber_ids) {
        const p = allPeople.find((r: any) => r.id === uid)
        if (p && Number(p.bc_id) >= SYNTHETIC_BC_ID_THRESHOLD) reconciledCompSubSet.add(String(uid))
      }
    }
    for (const cs of todo.completion_subscribers || []) {
      const csUuid = await ensurePersonInDb(cs)
      if (csUuid) reconciledCompSubSet.add(csUuid)
    }
    const reconciledCompSubUuids = Array.from(reconciledCompSubSet)

    if (dbTodo?.id) {
      const targetCompleted = Boolean(todo.completed)
      const completedChanged = Boolean(dbTodo.is_completed) !== targetCompleted
      const groupChanged = (dbTodo.group_id || null) !== (resolvedGroupId || null)
      const listChanged = (dbTodo.todolist_id || null) !== (resolvedTodolistId || null)
      const healedCreatorId = extractedTodoPerson?.id || dbTodo.created_by_person_id || null
      const effectiveCommentsCount = commentsFetchFailed
        ? Number(dbTodo.comments_count ?? (existingComments || []).length)
        : comments.length + localSyntheticComments.length

      if (
        completedChanged ||
        groupChanged ||
        listChanged ||
        remoteTitle !== (dbTodo.title || '') ||
        remoteStartsOn !== (dbTodo.starts_on || null) ||
        remoteDueDate !== (dbTodo.due_date || null) ||
        resolvedTodoDescription !== (dbTodo.description || '') ||
        (!commentsFetchFailed && Number(dbTodo.comments_count || 0) !== effectiveCommentsCount) ||
        healedCreatorId !== (dbTodo.created_by_person_id || null)
      ) {
        await supabase
          .from('bc_todos')
          .update({
            title: remoteTitle,
            starts_on: remoteStartsOn,
            due_date: remoteDueDate,
            group_id: resolvedGroupId,
            ...(resolvedTodolistId ? { todolist_id: resolvedTodolistId } : {}),
            completion_subscriber_ids: reconciledCompSubUuids,
            description: resolvedTodoDescription,
            is_completed: targetCompleted,
            completed_at: targetCompleted ? todo.updated_at || new Date().toISOString() : null,
            ...(commentsFetchFailed ? {} : { comments_count: effectiveCommentsCount }),
            ...(healedCreatorId ? { created_by_person_id: healedCreatorId } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbTodo.id)

        if (completedChanged || listChanged) {
          await syncTodolistCounts(supabase, resolvedTodolistId)
          if (listChanged && dbTodo.todolist_id) {
            await syncTodolistCounts(supabase, dbTodo.todolist_id)
          }
        }
        if (completedChanged || groupChanged) {
          await syncTodolistGroupCounts(supabase, resolvedGroupId)
          if (groupChanged && dbTodo.group_id) {
            await syncTodolistGroupCounts(supabase, dbTodo.group_id)
          }
        }
      }

      // Reconcile bc_todo_assignees if changed
      const prevAssigneeIdsSorted = (existingAssignees || [])
        .map((r: any) => String(r.person_id))
        .filter(Boolean)
        .sort()
        .join(',')
      const nextAssigneeIdsSorted = [...reconciledAssigneeUuids].sort().join(',')
      if (prevAssigneeIdsSorted !== nextAssigneeIdsSorted) {
        await supabase.from('bc_todo_assignees').delete().eq('todo_id', dbTodo.id)
        if (reconciledAssigneeUuids.length > 0) {
          await supabase.from('bc_todo_assignees').upsert(
            reconciledAssigneeUuids.map((pid) => ({ todo_id: dbTodo.id, person_id: pid })),
            { onConflict: 'todo_id,person_id' }
          )
        }
      }

      // Hydrate Todo boosts from Basecamp when boosts_count > 0
      if (remoteBoostsCount > 0) {
        const remoteBoosts = await fetchBoosts(numericProjectBcId, numericTodoBcId).catch(() => null)
        if (Array.isArray(remoteBoosts) && remoteBoosts.length > 0) {
          const boostUpserts = []
          const remoteBoostBcIdSet = new Set<number>()
          for (const b of remoteBoosts) {
            remoteBoostBcIdSet.add(Number(b.id))
            const boosterUuid = b.booster ? await ensurePersonInDb(b.booster) : null
            boostUpserts.push({
              bc_id: b.id,
              project_id: dbTodo.project_id,
              recording_type: 'todo',
              recording_id: dbTodo.id,
              booster_person_id: boosterUuid,
              content: String(b.content || '👍').slice(0, 16),
              created_at: b.created_at || new Date().toISOString(),
            })
          }
          await supabase.from('bc_boosts').upsert(boostUpserts, { onConflict: 'bc_id' })

          const { data: localTodoBoosts } = await supabase
            .from('bc_boosts')
            .select('id, bc_id')
            .eq('recording_type', 'todo')
            .eq('recording_id', dbTodo.id)
          for (const lb of localTodoBoosts || []) {
            if (isRealBasecampId(lb.bc_id) && !remoteBoostBcIdSet.has(Number(lb.bc_id))) {
              await supabase.from('bc_boosts').delete().eq('id', lb.id)
            }
          }
        }
      }
    }

    // 4. If Basecamp comments fetch failed, preserve & return existing local comments without wiping
    if (commentsFetchFailed) {
      const preservedUuids = (existingComments || []).map((ec: any) => String(ec.id))
      const { todoBoosts, commentBoosts } = await loadBoostMapsForTodoAndComments(
        supabase,
        dbTodo?.id,
        preservedUuids
      )

      const preservedComments = (existingComments || []).map((ec: any) => {
        const { cleanHtml, extractedAuthorName } = stripTegAuthorBanner(ec.content || '')
        const cId = String(ec.id)
        const cBoosts = commentBoosts[cId] || []
        const authorRel = unwrapPersonRel(ec.author)
        return {
          id: cId,
          bc_id: ec.bc_id,
          author:
            authorRel?.name ||
            (ec.author_person_id ? personNameById.get(ec.author_person_id) : null) ||
            extractedAuthorName ||
            'Unknown',
          author_person_id: ec.author_person_id || authorRel?.id || null,
          text: cleanHtml,
          timestamp: ec.created_at,
          updated_at: ec.updated_at || ec.created_at,
          boosts_count: cBoosts.length || Number(ec.boosts_count || 0),
          boosts: cBoosts,
        }
      })

      return NextResponse.json({
        success: true,
        comments_degraded: true,
        id: dbTodo?.id || null,
        bc_id: numericTodoBcId,
        title: remoteTitle,
        is_completed: Boolean(todo.completed),
        starts_on: remoteStartsOn,
        due_date: remoteDueDate,
        group_id: resolvedGroupId,
        todolist_id: resolvedTodolistId,
        assigneeUuids: reconciledAssigneeUuids,
        completionSubscriberUuids: reconciledCompSubUuids,
        description: resolvedTodoDescription,
        boosts_count: todoBoosts.length || remoteBoostsCount,
        boosts: todoBoosts,
        commentBoosts,
        comments_count: Number(dbTodo?.comments_count ?? preservedComments.length),
        comments: preservedComments,
      })
    }

    // 5. Reconcile comments with Author Priority Inversion + real Supabase UUIDs + comment boosts
    const existingAuthorByCommentBcId = new Map<number, string>()
    const existingUuidByCommentBcId = new Map<number, string>()
    for (const ec of existingComments || []) {
      if (ec.bc_id != null) {
        if (ec.id) existingUuidByCommentBcId.set(Number(ec.bc_id), String(ec.id))
        if (ec.author_person_id) existingAuthorByCommentBcId.set(Number(ec.bc_id), ec.author_person_id)
      }
    }

    const commentAuthorNameByBcId = new Map<number, string>()
    const commentAuthorUuidByBcId = new Map<number, string | null>()
    const upsertedUuidByBcId = new Map<number, string>()

    if (comments.length > 0) {
      const commentUpserts = []
      for (const c of comments) {
        const rawCommentHtml = await resolveHtmlAttachmentsFromCache(c.content || '', supabase, urlCache)
        const { cleanHtml: resolvedCommentContent, extractedAuthorName } = stripTegAuthorBanner(rawCommentHtml)
        c._resolvedContent = resolvedCommentContent

        // Priority 1: Embedded TEG author banner
        let authorUuid: string | null = null
        if (extractedAuthorName) {
          const matched = findPersonInListByFuzzyName(allPeople, extractedAuthorName)
          if (matched?.id) authorUuid = matched.id
        }

        // Priority 2: Existing local author_person_id in Supabase
        if (!authorUuid) {
          authorUuid = existingAuthorByCommentBcId.get(Number(c.id)) || null
        }

        // Priority 3: Basecamp API creator
        if (!authorUuid && c.creator?.id) {
          authorUuid = await ensurePersonInDb(c.creator)
        }

        const finalAuthorName =
          (authorUuid ? personNameById.get(authorUuid) : null) ||
          extractedAuthorName ||
          c.creator?.name ||
          'Unknown'
        commentAuthorNameByBcId.set(Number(c.id), finalAuthorName)
        commentAuthorUuidByBcId.set(Number(c.id), authorUuid)

        if (dbTodo?.id) {
          commentUpserts.push({
            bc_id: c.id,
            project_id: dbTodo.project_id,
            parent_type: 'todo',
            parent_id: dbTodo.id,
            content: resolvedCommentContent,
            author_person_id: authorUuid,
            boosts_count: Number(c.boosts_count || 0),
            created_at: c.created_at || new Date().toISOString(),
            updated_at: c.updated_at || c.created_at || new Date().toISOString(),
          })
        }
      }

      if (dbTodo?.id && commentUpserts.length > 0) {
        const { data: upsertedRows } = await supabase
          .from('bc_comments')
          .upsert(commentUpserts, { onConflict: 'bc_id' })
          .select('id, bc_id')

        for (const ur of upsertedRows || []) {
          if (ur.bc_id != null && ur.id) {
            upsertedUuidByBcId.set(Number(ur.bc_id), String(ur.id))
          }
        }

        // Hydrate boosts on comments where boosts_count > 0
        for (const c of comments) {
          const cBoostCount = Number(c.boosts_count || 0)
          const cUuid = upsertedUuidByBcId.get(Number(c.id)) || existingUuidByCommentBcId.get(Number(c.id))
          if (cBoostCount > 0 && cUuid) {
            const remoteComBoosts = await fetchBoosts(numericProjectBcId, Number(c.id)).catch(() => null)
            if (Array.isArray(remoteComBoosts) && remoteComBoosts.length > 0) {
              const comBoostUpserts = []
              for (const b of remoteComBoosts) {
                const boosterUuid = b.booster ? await ensurePersonInDb(b.booster) : null
                comBoostUpserts.push({
                  bc_id: b.id,
                  project_id: dbTodo.project_id,
                  recording_type: 'comment',
                  recording_id: cUuid,
                  booster_person_id: boosterUuid,
                  content: String(b.content || '👍').slice(0, 16),
                  created_at: b.created_at || new Date().toISOString(),
                })
              }
              await supabase.from('bc_boosts').upsert(comBoostUpserts, { onConflict: 'bc_id' })
            }
          }
        }
      }
    }

    const allCommentUuids = [
      ...comments
        .map((c: any) => upsertedUuidByBcId.get(Number(c.id)) || existingUuidByCommentBcId.get(Number(c.id)) || '')
        .filter(Boolean),
      ...localSyntheticComments.map((lc: any) => String(lc.id)),
    ]

    const { todoBoosts, commentBoosts } = await loadBoostMapsForTodoAndComments(
      supabase,
      dbTodo?.id,
      allCommentUuids
    )

    if (dbTodo?.id && todoBoosts.length !== Number(dbTodo.boosts_count || 0)) {
      await supabase.from('bc_todos').update({ boosts_count: todoBoosts.length }).eq('id', dbTodo.id)
    }

    const responseComments = [
      ...comments.map((c: any) => {
        const cId =
          upsertedUuidByBcId.get(Number(c.id)) ||
          existingUuidByCommentBcId.get(Number(c.id)) ||
          String(c.id)
        const cBoosts = commentBoosts[cId] || []
        return {
          id: cId,
          bc_id: c.id,
          author: commentAuthorNameByBcId.get(Number(c.id)) || c.creator?.name || 'Unknown',
          author_person_id: commentAuthorUuidByBcId.get(Number(c.id)) ?? null,
          text: c._resolvedContent ?? c.content ?? '',
          timestamp: c.created_at,
          updated_at: c.updated_at || c.created_at,
          boosts_count: cBoosts.length || Number(c.boosts_count || 0),
          boosts: cBoosts,
        }
      }),
      ...localSyntheticComments.map((lc: any) => {
        const { cleanHtml, extractedAuthorName } = stripTegAuthorBanner(lc.content || '')
        const cId = String(lc.id)
        const cBoosts = commentBoosts[cId] || []
        const authorRel = unwrapPersonRel(lc.author)
        return {
          id: cId,
          bc_id: lc.bc_id,
          author:
            authorRel?.name ||
            (lc.author_person_id ? personNameById.get(lc.author_person_id) : null) ||
            extractedAuthorName ||
            'Unknown',
          author_person_id: lc.author_person_id || authorRel?.id || null,
          text: cleanHtml,
          timestamp: lc.created_at,
          updated_at: lc.updated_at || lc.created_at,
          boosts_count: cBoosts.length || Number(lc.boosts_count || 0),
          boosts: cBoosts,
        }
      }),
    ]

    return NextResponse.json({
      success: true,
      id: dbTodo?.id || null,
      bc_id: numericTodoBcId,
      title: remoteTitle,
      is_completed: Boolean(todo.completed),
      starts_on: remoteStartsOn,
      due_date: remoteDueDate,
      group_id: resolvedGroupId,
      todolist_id: resolvedTodolistId,
      assigneeUuids: reconciledAssigneeUuids,
      completionSubscriberUuids: reconciledCompSubUuids,
      description: resolvedTodoDescription,
      boosts_count: todoBoosts.length || remoteBoostsCount,
      boosts: todoBoosts,
      commentBoosts,
      comments_count: responseComments.length,
      comments: responseComments,
    })
  } catch (error: any) {
    console.error('❌ [Basecamp Todo Detail API] Error:', error.message)
    return NextResponse.json(
      { error: `Failed to fetch todo detail: ${error.message}` },
      { status: 500 }
    )
  }
}
