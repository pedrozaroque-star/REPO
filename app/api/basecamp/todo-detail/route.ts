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
import { getValidToken, basecampFetch } from '@/lib/basecamp-api'
import { getServerUser } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

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

    // 2. Get valid Basecamp token
    const token = await getValidToken()
    const accountId = process.env.BASECAMP_ACCOUNT_ID

    if (!accountId) {
      return NextResponse.json({ error: 'Basecamp Account ID not configured' }, { status: 500 })
    }

    // 3. Fetch Todo details from Basecamp with rate limiting and backoff
    const todo = await basecampFetch<any>(`/buckets/${projectId}/todos/${todoId}.json`)

    // 4. Fetch Comments from Basecamp
    let comments: any[] = []
    try {
      const rawComments = await basecampFetch<any[]>(`/buckets/${projectId}/recordings/${todoId}/comments.json`)
      comments = Array.isArray(rawComments) ? rawComments : []
    } catch (commentErr: any) {
      console.warn(`[Todo Detail API] Failed to fetch comments for todo ${todoId}:`, commentErr.message)
    }

    return NextResponse.json({
      success: true,
      description: todo.description || '',
      comments: comments.map((c: any) => ({
        id: c.id,
        bc_id: c.id,
        author: c.creator?.name || 'Unknown',
        text: c.content || '',
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
