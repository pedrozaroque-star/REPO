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
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // 1. Require authenticated staff user (never log cookies)
  const auth = verifyStaffAuth(request, { allowCron: false })
  if (!auth.authorized) {
    return auth.response!
  }

  try {
    const { searchParams } = new URL(request.url)
    const urlParam = searchParams.get('url')

    if (!urlParam) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    const rawTrimmed = urlParam.trim()
    if (
      rawTrimmed.includes('..') ||
      rawTrimmed.includes('\\') ||
      /%2e|%5c|%00/i.test(rawTrimmed) ||
      /[\r\n\t]/.test(rawTrimmed)
    ) {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

    let parsed: URL
    try {
      parsed = new URL(rawTrimmed)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

    const allowedInputHosts = new Set([
      '3.basecampapi.com',
      'preview.app.basecamp.com',
      'storage.app.basecamp.com',
    ])
    const inputHost = parsed.hostname.toLowerCase()
    if (!allowedInputHosts.has(inputHost)) {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

    // Replace cookie-only Basecamp attachment domains with API domain supporting Bearer auth
    parsed.hostname = '3.basecampapi.com'

    let decodedPath = parsed.pathname
    try {
      decodedPath = decodeURIComponent(parsed.pathname)
    } catch {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

    const accountId = process.env.BASECAMP_ACCOUNT_ID || '5052386'
    if (
      decodedPath.includes('..') ||
      decodedPath.includes('\\') ||
      parsed.pathname.includes('//') ||
      !parsed.pathname.startsWith(`/${accountId}/`)
    ) {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

    const targetUrl = parsed.toString()

    // 3. Get valid Basecamp token
    const token = await getValidToken()
    const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (noreply@tacosgavilan.com)'

    // 4. Fetch the attachment from Basecamp with manual redirect tracking
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })

    // Basecamp download/preview endpoints return a 302/307 redirect to S3
    const s3Url = res.headers.get('location')

    if (s3Url) {
      let parsedRedirect: URL
      try {
        parsedRedirect = new URL(s3Url)
      } catch {
        return NextResponse.json({ error: 'Invalid upstream redirect URL' }, { status: 502 })
      }
      if (parsedRedirect.protocol !== 'https:' || parsedRedirect.username !== '' || parsedRedirect.password !== '') {
        return NextResponse.json({ error: 'Forbidden upstream redirect URL' }, { status: 403 })
      }
      // Return 307 Temporary Redirect to the AWS S3 URL
      return NextResponse.redirect(parsedRedirect.toString(), { status: 307 })
    }

    // If it did not redirect, but returned 200 OK (unlikely for blobs, but possible)
    if (res.ok) {
      const contentType = (res.headers.get('Content-Type') || 'application/octet-stream').toLowerCase()
      if (contentType.includes('application/json') || contentType.includes('text/html')) {
        return NextResponse.json({ error: 'Forbidden attachment content type' }, { status: 403 })
      }
      const blob = await res.blob()
      const headers = new Headers()
      headers.set('Content-Type', contentType)
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
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
