/**
 * @module api/basecamp/todo-detail
 * @description Ruta GET que obtiene los detalles de una tarea (todo) y sus comentarios directamente
 *              desde la API de Basecamp 3 en tiempo real, garantizando firmas de S3 frescas para imágenes.
 * @businessRules
 *   - Requiere autenticación de SM TEG.
 *   - Requiere un token de OAuth de Basecamp válido (con auto-refresh).
 *   - Retorna la descripción con URLs pre-firmadas de S3 actualizadas.
 * @dataFlow
 *   - GET /api/basecamp/todo-detail?projectId=X&todoId=Y
 *   - getValidToken() -> fetch todo de Basecamp -> fetch comments de Basecamp -> retorna JSON
 * @notes
 *   - Previene el error de imágenes rotas (403 Forbidden) causado por la expiración de las firmas temporales de AWS S3.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getValidToken, basecampFetch, resolveHtmlAttachmentsFromCache } from '@/lib/basecamp-api'
import { stripTegAuthorBanner, normalizePersonName } from '@/lib/basecamp-person-resolver'
import { getServerUser } from '@/lib/auth-server'

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

export async function GET(request: Request) {
  try {
    // 1. Get authenticated user
    const user = await getServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const todoId = searchParams.get('todoId')

    if (!projectId || !todoId) {
      return NextResponse.json({ error: 'Missing projectId or todoId' }, { status: 400 })
    }

    // 2. Ensure valid Basecamp token
    await getValidToken()

    // 3. Fetch Todo details and Comments in parallel from Basecamp API
    const [todo, rawComments] = await Promise.all([
      basecampFetch<any>(`/buckets/${projectId}/todos/${todoId}.json`, { noPaginate: true }),
      basecampFetch<any[]>(`/buckets/${projectId}/recordings/${todoId}/comments.json`).catch((err) => {
        console.warn(`[Todo Detail API] Failed to fetch comments for todo ${todoId}:`, err.message)
        return []
      }),
    ])

    const comments = Array.isArray(rawComments) ? rawComments : []

    // 4. Persist live updates into Supabase so cache is 100% synchronized
    const supabase = getAdminSupabase()
    const urlCache = new Map<string, string>()
    const rawResolvedDesc = await resolveHtmlAttachmentsFromCache(
      todo.description || '',
      supabase,
      urlCache
    )
    const { cleanHtml: resolvedTodoDescription } = stripTegAuthorBanner(rawResolvedDesc)

    const { data: dbTodo } = await supabase
      .from('bc_todos')
      .select('id, project_id, is_completed, comments_count, created_by_person_id')
      .eq('bc_id', Number(todoId))
      .maybeSingle()

    const commentAuthorNameByBcId = new Map<number, string>()

    if (dbTodo?.id) {
      if (
        Boolean(dbTodo.is_completed) !== Boolean(todo.completed) ||
        Number(dbTodo.comments_count || 0) !== comments.length
      ) {
        await supabase
          .from('bc_todos')
          .update({
            is_completed: Boolean(todo.completed),
            completed_at: todo.completed ? (todo.updated_at || new Date().toISOString()) : null,
            comments_count: comments.length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbTodo.id)
      }

      if (comments.length > 0) {
        const [{ data: peopleRows }, { data: existingComments }] = await Promise.all([
          supabase.from('bc_people').select('id, bc_id, name').limit(5000),
          supabase
            .from('bc_comments')
            .select('id, bc_id, author_person_id')
            .eq('parent_id', dbTodo.id),
        ])

        const peopleMap = new Map<number, string>()
        const personNameById = new Map<string, string>()
        ;(peopleRows || []).forEach((p: any) => {
          peopleMap.set(Number(p.bc_id), p.id)
          if (p.id && p.name) personNameById.set(p.id, p.name)
        })

        const existingAuthorByCommentBcId = new Map<number, string>()
        ;(existingComments || []).forEach((ec: any) => {
          if (ec.bc_id && ec.author_person_id) {
            existingAuthorByCommentBcId.set(Number(ec.bc_id), ec.author_person_id)
          }
        })

        const commentUpserts = []
        for (const c of comments) {
          const rawCommentHtml = await resolveHtmlAttachmentsFromCache(
            c.content || '',
            supabase,
            urlCache
          )
          const { cleanHtml: resolvedCommentContent, extractedAuthorName } = stripTegAuthorBanner(rawCommentHtml)
          c._resolvedContent = resolvedCommentContent

          // Priority 1: Preserve existing local author_person_id in Supabase (never overwrite TEG user with OAuth owner)
          let authorUuid: string | null = existingAuthorByCommentBcId.get(Number(c.id)) || null

          // Priority 2: If comment had an embedded TEG author stamp, resolve by normalized name
          if (!authorUuid && extractedAuthorName && peopleRows) {
            const normExtracted = normalizePersonName(extractedAuthorName)
            const matched = peopleRows.find((p: any) => normalizePersonName(p.name) === normExtracted)
            if (matched?.id) authorUuid = matched.id
          }

          // Priority 3: Fallback to Basecamp API creator
          if (!authorUuid) {
            authorUuid = c.creator?.id ? peopleMap.get(Number(c.creator.id)) || null : null
          }

          if (!authorUuid && c.creator?.id) {
            const { data: newPerson } = await supabase
              .from('bc_people')
              .upsert(
                {
                  bc_id: Number(c.creator.id),
                  name: c.creator.name || 'Unknown',
                  email: c.creator.email_address || '',
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

        await supabase.from('bc_comments').upsert(commentUpserts, { onConflict: 'bc_id' })
      }
    }

    return NextResponse.json({
      success: true,
      is_completed: Boolean(todo.completed),
      description: resolvedTodoDescription,
      comments_count: comments.length,
      comments: comments.map((c: any) => ({
        id: String(c.id),
        bc_id: c.id,
        author: commentAuthorNameByBcId.get(Number(c.id)) || c.creator?.name || 'Unknown',
        text: c._resolvedContent ?? c.content ?? '',
        timestamp: c.created_at,
      })),
    })
  } catch (error: any) {
    console.error('❌ [Basecamp Todo Detail API] Error:', error.message)
    return NextResponse.json(
      { error: `Failed to fetch todo detail: ${error.message}` },
      { status: 500 }
    )
  }
}
