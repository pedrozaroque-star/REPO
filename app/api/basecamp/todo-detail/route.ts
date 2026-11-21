/**
 * @module api/basecamp/todo-detail
 * @description Ruta GET que obtiene los detalles de una tarea (todo) y sus comentarios desde la API de Basecamp 3
 *              en tiempo real (con fallback resiliente a Supabase local para tareas sintéticas `bc_id >= 1e11`,
 *              404 remotos o fallos transitorios de red), garantizando firmas frescas de imágenes y preservación
 *              estricta de autoría TEG.
 * @businessRules
 *   - Requiere autenticación de personal interno SM TEG (`verifyStaffAuth`, `allowCron: false`).
 *   - Para tareas locales (`bc_id >= 100_000_000_000`) o ante 404/error de Basecamp, responde desde Supabase local.
 *   - Si la carga de comentarios en Basecamp falla (`commentsFetchFailed`), NUNCA sobreescribe `comments_count = 0`
 *     ni devuelve un arreglo vacío; conserva y retorna los comentarios locales de Supabase.
 *   - Inversión de Prioridad de Autoría: `extractedAuthorName` (`stripTegAuthorBanner` + `findPersonInListByFuzzyName`)
 *     tiene Prioridad #1 sobre registros previos que hayan guardado temporalmente el dueño del token OAuth.
 *   - Persiste `description: resolvedTodoDescription` de vuelta en `bc_todos` cuando cambia para sanar URLs expiradas
 *     y eliminar banners residuales en base de datos, y retorna el UUID real de Supabase en `comments[].id`.
 * @dataFlow
 *   - GET /api/basecamp/todo-detail?projectId=X&todoId=Y
 *   - verifyStaffAuth -> lookup local `bc_todos` -> Basecamp API (si `< 1e11`) -> reconciliación DB -> JSON
 * @notes
 *   - Sincroniza `bc_todolists` (`syncTodolistCounts`) cuando cambia `is_completed`.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidToken, basecampFetch, resolveHtmlAttachmentsFromCache, syncTodolistCounts } from '@/lib/basecamp-api'
import {
  stripTegAuthorBanner,
  findPersonInListByFuzzyName,
  isMaskedOrEmptyEmail,
  isRealBasecampId,
  SYNTHETIC_BC_ID_THRESHOLD,
} from '@/lib/basecamp-person-resolver'
import { verifyStaffAuth } from '@/lib/auth-server'

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

function unwrapAuthorName(authorRel: any): string | null {
  if (!authorRel) return null
  if (Array.isArray(authorRel)) return authorRel[0]?.name || null
  return authorRel.name || null
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

  const { data: localComments } = await supabase
    .from('bc_comments')
    .select('id, bc_id, content, created_at, author_person_id, author:bc_people(name)')
    .eq('parent_id', dbTodo.id)
    .order('created_at', { ascending: true })

  const formattedComments = []
  for (const lc of localComments || []) {
    const rawCom = await resolveHtmlAttachmentsFromCache(lc.content || '', supabase, urlCache)
    const { cleanHtml, extractedAuthorName } = stripTegAuthorBanner(rawCom)
    if (cleanHtml !== (lc.content || '')) {
      await supabase.from('bc_comments').update({ content: cleanHtml }).eq('id', lc.id)
    }
    formattedComments.push({
      id: String(lc.id),
      bc_id: lc.bc_id,
      author: unwrapAuthorName(lc.author) || extractedAuthorName || 'Unknown',
      text: cleanHtml,
      timestamp: lc.created_at,
    })
  }

  return NextResponse.json({
    success: true,
    source: 'local',
    is_completed: Boolean(dbTodo.is_completed),
    description: resolvedTodoDescription,
    comments_count: formattedComments.length,
    comments: formattedComments,
  })
}

export async function GET(request: Request) {
  const auth = verifyStaffAuth(request, { allowCron: false })
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
      .select('id, bc_id, project_id, todolist_id, is_completed, description, comments_count, created_by_person_id')
    const { data: dbTodo } = isUuidQuery
      ? await todoLookupQuery.eq('id', todoId).maybeSingle()
      : await todoLookupQuery.eq('bc_id', Number(todoId)).maybeSingle()

    const numericTodoBcId = isNumericTodoId ? Number(todoId) : Number(dbTodo?.bc_id || 0)

    // 1. Local-only synthetic todo (bc_id >= 1e11) or non-numeric projectId -> serve directly from Supabase
    if (!isNumericProjectId || !isRealBasecampId(numericTodoBcId)) {
      if (!dbTodo?.id) {
        return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
      }
      return buildLocalTodoDetailResponse(supabase, dbTodo, urlCache)
    }

    // 2. Fetch Todo details and Comments from Basecamp API with resilient fallback
    let todo: any = null
    try {
      await getValidToken()
      todo = await basecampFetch<any>(`/buckets/${projectId}/todos/${numericTodoBcId}.json`, { noPaginate: true })
    } catch (todoFetchErr: any) {
      console.warn(`[Todo Detail API] Basecamp fetch fallback for todo ${numericTodoBcId}:`, todoFetchErr.message)
      if (dbTodo?.id) {
        return buildLocalTodoDetailResponse(supabase, dbTodo, urlCache)
      }
      const status = String(todoFetchErr?.message || '').includes('(404)') ? 404 : 502
      return NextResponse.json({ error: `Failed to fetch todo detail: ${todoFetchErr.message}` }, { status })
    }

    let commentsFetchFailed = false
    const rawComments = await basecampFetch<any[]>(
      `/buckets/${projectId}/recordings/${numericTodoBcId}/comments.json`
    ).catch((err) => {
      commentsFetchFailed = true
      console.warn(`[Todo Detail API] Failed to fetch comments for todo ${numericTodoBcId}:`, err.message)
      return []
    })

    const comments = Array.isArray(rawComments) ? rawComments : []

    const [{ data: peopleRows }, { data: existingComments }] = await Promise.all([
      supabase.from('bc_people').select('id, bc_id, name, email').limit(5000),
      dbTodo?.id
        ? supabase
            .from('bc_comments')
            .select('id, bc_id, content, created_at, author_person_id, author:bc_people(name)')
            .eq('parent_id', dbTodo.id)
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ])

    const allPeople = peopleRows || []
    const peopleMap = new Map<number, string>()
    const personNameById = new Map<string, string>()
    for (const p of allPeople) {
      if (p.bc_id != null) peopleMap.set(Number(p.bc_id), p.id)
      if (p.id && p.name) personNameById.set(p.id, p.name)
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

    if (dbTodo?.id) {
      const targetCompleted = Boolean(todo.completed)
      const completedChanged = Boolean(dbTodo.is_completed) !== targetCompleted
      const healedCreatorId = extractedTodoPerson?.id || dbTodo.created_by_person_id || null
      const effectiveCommentsCount = commentsFetchFailed
        ? Number(dbTodo.comments_count ?? (existingComments || []).length)
        : comments.length + localSyntheticComments.length

      if (
        completedChanged ||
        resolvedTodoDescription !== (dbTodo.description || '') ||
        (!commentsFetchFailed && Number(dbTodo.comments_count || 0) !== effectiveCommentsCount) ||
        healedCreatorId !== (dbTodo.created_by_person_id || null)
      ) {
        await supabase
          .from('bc_todos')
          .update({
            description: resolvedTodoDescription,
            is_completed: targetCompleted,
            completed_at: targetCompleted ? todo.updated_at || new Date().toISOString() : null,
            ...(commentsFetchFailed ? {} : { comments_count: effectiveCommentsCount }),
            ...(healedCreatorId ? { created_by_person_id: healedCreatorId } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbTodo.id)

        if (completedChanged) {
          await syncTodolistCounts(supabase, dbTodo.todolist_id)
        }
      }
    }

    // 4. If Basecamp comments fetch failed, preserve & return existing local comments without wiping
    if (commentsFetchFailed) {
      const preservedComments = (existingComments || []).map((ec: any) => {
        const { cleanHtml, extractedAuthorName } = stripTegAuthorBanner(ec.content || '')
        return {
          id: String(ec.id),
          bc_id: ec.bc_id,
          author:
            unwrapAuthorName(ec.author) ||
            (ec.author_person_id ? personNameById.get(ec.author_person_id) : null) ||
            extractedAuthorName ||
            'Unknown',
          text: cleanHtml,
          timestamp: ec.created_at,
        }
      })

      return NextResponse.json({
        success: true,
        comments_degraded: true,
        is_completed: Boolean(todo.completed),
        description: resolvedTodoDescription,
        comments_count: Number(dbTodo?.comments_count ?? preservedComments.length),
        comments: preservedComments,
      })
    }

    // 5. Reconcile comments with Author Priority Inversion + real Supabase UUIDs
    const existingAuthorByCommentBcId = new Map<number, string>()
    const existingUuidByCommentBcId = new Map<number, string>()
    for (const ec of existingComments || []) {
      if (ec.bc_id != null) {
        if (ec.id) existingUuidByCommentBcId.set(Number(ec.bc_id), String(ec.id))
        if (ec.author_person_id) existingAuthorByCommentBcId.set(Number(ec.bc_id), ec.author_person_id)
      }
    }

    const commentAuthorNameByBcId = new Map<number, string>()
    const upsertedUuidByBcId = new Map<number, string>()

    if (comments.length > 0) {
      const commentUpserts = []
      for (const c of comments) {
        const rawCommentHtml = await resolveHtmlAttachmentsFromCache(c.content || '', supabase, urlCache)
        const { cleanHtml: resolvedCommentContent, extractedAuthorName } = stripTegAuthorBanner(rawCommentHtml)
        c._resolvedContent = resolvedCommentContent

        // Priority 1: Embedded TEG author banner resolved via Pass 2 + Pass 3 fuzzy matching
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
        if (!authorUuid) {
          authorUuid = c.creator?.id ? peopleMap.get(Number(c.creator.id)) || null : null
        }

        if (!authorUuid && c.creator?.id) {
          const incomingEmail = c.creator.email_address || ''
          const { data: newPerson } = await supabase
            .from('bc_people')
            .upsert(
              {
                bc_id: Number(c.creator.id),
                name: c.creator.name || 'Unknown',
                email: isMaskedOrEmptyEmail(incomingEmail) ? '' : incomingEmail,
                avatar_url: c.creator.avatar_url || '',
                role: c.creator.employee ? 'employee' : 'user',
                title: c.creator.title || '',
                is_active: true,
              },
              { onConflict: 'bc_id' }
            )
            .select('id, name')
            .maybeSingle()
          if (newPerson?.id) {
            authorUuid = newPerson.id
            peopleMap.set(Number(c.creator.id), newPerson.id)
            if (newPerson.name) personNameById.set(newPerson.id, newPerson.name)
          }
        }

        const finalAuthorName =
          (authorUuid ? personNameById.get(authorUuid) : null) ||
          extractedAuthorName ||
          c.creator?.name ||
          'Unknown'
        commentAuthorNameByBcId.set(Number(c.id), finalAuthorName)

        if (dbTodo?.id) {
          commentUpserts.push({
            bc_id: c.id,
            project_id: dbTodo.project_id,
            parent_type: 'todo',
            parent_id: dbTodo.id,
            content: resolvedCommentContent,
            author_person_id: authorUuid,
            created_at: c.created_at || new Date().toISOString(),
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
      }
    }

    const responseComments = [
      ...comments.map((c: any) => ({
        id:
          upsertedUuidByBcId.get(Number(c.id)) ||
          existingUuidByCommentBcId.get(Number(c.id)) ||
          String(c.id),
        bc_id: c.id,
        author: commentAuthorNameByBcId.get(Number(c.id)) || c.creator?.name || 'Unknown',
        text: c._resolvedContent ?? c.content ?? '',
        timestamp: c.created_at,
      })),
      ...localSyntheticComments.map((lc: any) => {
        const { cleanHtml, extractedAuthorName } = stripTegAuthorBanner(lc.content || '')
        return {
          id: String(lc.id),
          bc_id: lc.bc_id,
          author:
            unwrapAuthorName(lc.author) ||
            (lc.author_person_id ? personNameById.get(lc.author_person_id) : null) ||
            extractedAuthorName ||
            'Unknown',
          text: cleanHtml,
          timestamp: lc.created_at,
        }
      }),
    ]

    return NextResponse.json({
      success: true,
      is_completed: Boolean(todo.completed),
      description: resolvedTodoDescription,
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
