/**
 * @module api/basecamp/attachment
 * @description Ruta GET que redirige al navegador del usuario a la URL temporal y pre-firmada de AWS S3
 *              de un archivo adjunto de Basecamp, resolviendo el problema de las imágenes rotas y
 *              evitando proxyar binarios pesados a través del servidor.
 * @businessRules
 *   - Requiere autenticación de SM TEG.
 *   - Requiere un token de OAuth de Basecamp válido (con auto-refresh).
 *   - Solo permite peticiones dirigidas a la cuenta de Basecamp configurada (5052386).
 * @dataFlow
 *   - GET /api/basecamp/attachment?url=https://3.basecampapi.com/5052386/blobs/...
 *   - getValidToken() -> fetch URL con Bearer token (redirect: manual) -> 307 Redirect a AWS S3
 * @notes
 *   - Transforma automáticamente hosts como preview.app.basecamp.com y storage.app.basecamp.com a 3.basecampapi.com.
 */

import { NextResponse } from 'next/server'
import { getValidToken } from '@/lib/basecamp-api'
import { getServerUser } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const urlParam = searchParams.get('url')

    if (!urlParam) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    // 2. Normalize and validate URL
    let targetUrl = urlParam.trim()

    // Replace cookie-only domains with the API domain that supports Bearer authentication
    targetUrl = targetUrl.replace('preview.app.basecamp.com', '3.basecampapi.com')
    targetUrl = targetUrl.replace('storage.app.basecamp.com', '3.basecampapi.com')

    // 1. Get authenticated user
    const user = await getServerUser()
    if (!user) {
      console.log('❌ [Basecamp Attachment API] getServerUser returned null. Cookies:', request.headers.get('cookie'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log('✅ [Basecamp Attachment API] Authenticated user:', user.email, 'Target URL:', targetUrl)

    const accountId = process.env.BASECAMP_ACCOUNT_ID || '5052386'
    
    // Safety check: ensure it is a Basecamp URL and matches our account ID
    const basecampPattern = new RegExp(`^https://3\\.basecampapi\\.com/${accountId}/`, 'i')
    if (!basecampPattern.test(targetUrl)) {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

    // 3. Get valid Basecamp token
    const token = await getValidToken()
    const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'

    // 4. Fetch the attachment from Basecamp with manual redirect tracking
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
      redirect: 'manual',
    })

    // Basecamp download/preview endpoints return a 302/307 redirect to S3
    const s3Url = res.headers.get('location')

    if (s3Url) {
      // Return 307 Temporary Redirect to the AWS S3 URL
      return NextResponse.redirect(s3Url, { status: 307 })
    }

    // If it did not redirect, but returned 200 OK (unlikely for blobs, but possible)
    if (res.ok) {
      const blob = await res.blob()
      const headers = new Headers()
      headers.set('Content-Type', res.headers.get('Content-Type') || 'application/octet-stream')
      headers.set('Cache-Control', 'private, max-age=3600')
      return new Response(blob, {
        status: 200,
        headers,
      })
    }

    throw new Error(`Basecamp returned status ${res.status}`)
  } catch (error: any) {
    console.error('❌ [Basecamp Attachment API] Error:', error.message)
    return NextResponse.json(
      { error: `Failed to resolve attachment: ${error.message}` },
      { status: 500 }
    )
  }
}
