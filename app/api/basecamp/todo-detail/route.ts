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
import { getValidToken } from '@/lib/basecamp-api'
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
    const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'

    if (!accountId) {
      return NextResponse.json({ error: 'Basecamp Account ID not configured' }, { status: 500 })
    }

    // 3. Fetch Todo details from Basecamp
    const todoUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todos/${todoId}.json`
    const todoRes = await fetch(todoUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
    })

    if (!todoRes.ok) {
      throw new Error(`Failed to fetch todo details from Basecamp: ${todoRes.statusText}`)
    }

    const todo = await todoRes.json()

    // 4. Fetch Comments from Basecamp
    const commentsUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/recordings/${todoId}/comments.json`
    const commentsRes = await fetch(commentsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
    })

    let comments = []
    if (commentsRes.ok) {
      comments = await commentsRes.json()
    } else {
      console.warn(`[Todo Detail API] Failed to fetch comments for todo ${todoId}: ${commentsRes.statusText}`)
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
