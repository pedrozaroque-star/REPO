/**
 * @module api/basecamp/attachment
 * @description Ruta GET que resuelve imágenes y archivos adjuntos del módulo Basecamp.
 *              - Modo visualización (`GET /api/basecamp/attachment?url=...`): redirige (307) a la URL firmada de AWS S3.
 *              - Modo descarga directa (`GET /api/basecamp/attachment?url=...&download=1&filename=...`): descarga el binario
 *                en servidor (soportando tanto blobs de Basecamp 3 como imágenes alojadas en Supabase Storage `checklist-photos`)
 *                y lo entrega con `Content-Disposition: attachment` para descarga inmediata en 1 clic sin abrir pestañas nuevas.
 *
 * @businessRules
 *   - Requiere autenticación de personal SM TEG (`verifyStaffAuth`).
 *   - Validación estricta anti-SSRF: solo permite hosts oficiales de Basecamp (cuenta `5052386`) o el host oficial
 *     de Supabase Storage del proyecto (`checklist-photos`).
 *
 * @dataFlow
 *   - GET `/api/basecamp/attachment?url=...` -> `verifyStaffAuth` -> 307 Redirect (inline) o 200 Stream (`attachment` cuando `download=1`).
 */

import { NextResponse } from 'next/server'
import { getValidToken } from '@/lib/basecamp-api'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
}

function buildContentDisposition(rawFilename: string | null, urlPath: string, contentType: string): string {
  let candidate = (rawFilename || '').trim()
  if (!candidate) {
    const lastSeg = urlPath.split('/').pop()?.split('?')[0] || 'imagen'
    try {
      candidate = decodeURIComponent(lastSeg)
    } catch {
      candidate = lastSeg
    }
  }
  if (!candidate || candidate === 'full' || candidate === 'preview') {
    candidate = `imagen-${Date.now()}`
  }

  // Ensure file extension matches MIME when missing
  if (!/\.[a-z0-9]{2,5}$/i.test(candidate)) {
    const ext = EXT_BY_MIME[contentType.split(';')[0].trim().toLowerCase()] || ''
    if (ext) candidate += ext
  }

  const asciiSafe = candidate
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["\\\r\n;]/g, '_')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .trim() || 'archivo'

  const utf8Encoded = encodeURIComponent(candidate.replace(/[\r\n]/g, ''))
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${utf8Encoded}`
}

export async function GET(request: Request) {
  const auth = verifyStaffAuth(request, { allowCron: false })
  if (!auth.authorized) {
    return auth.response!
  }

  try {
    const { searchParams } = new URL(request.url)
    let urlParam = searchParams.get('url')
    const forceDownload = searchParams.get('download') === '1' || searchParams.get('download') === 'true'
    const filenameParam = searchParams.get('filename')

    if (!urlParam) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
    }

    // Unwrap nested /api/basecamp/attachment?url=... if caller passed an already-proxied path
    if (urlParam.startsWith('/api/basecamp/attachment?')) {
      const innerParams = new URLSearchParams(urlParam.split('?')[1] || '')
      const innerUrl = innerParams.get('url')
      if (innerUrl) urlParam = innerUrl
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

    const inputHost = parsed.hostname.toLowerCase()
    const configuredSupabaseHost = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.toLowerCase()
      } catch {
        return ''
      }
    })()

    // Case A: Direct download of an image/file already stored in our Supabase Storage `checklist-photos` bucket
    const isAllowedSupabaseStorage =
      configuredSupabaseHost &&
      inputHost === configuredSupabaseHost &&
      parsed.pathname.startsWith('/storage/v1/object/public/checklist-photos/') &&
      !parsed.pathname.includes('//')

    if (isAllowedSupabaseStorage) {
      if (!forceDownload) {
        return NextResponse.redirect(parsed.toString(), { status: 307 })
      }
      const supaRes = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      if (!supaRes.ok) {
        return NextResponse.json({ error: `Storage fetch failed (${supaRes.status})` }, { status: 502 })
      }
      const contentType = (supaRes.headers.get('Content-Type') || 'application/octet-stream').toLowerCase()
      const blob = await supaRes.blob()
      const headers = new Headers()
      headers.set('Content-Type', contentType)
      headers.set('Content-Disposition', buildContentDisposition(filenameParam, parsed.pathname, contentType))
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('Cache-Control', 'private, max-age=3600')
      return new Response(blob, { status: 200, headers })
    }

    // Case B: Basecamp 3 attachment hosts
    const allowedBasecampHosts = new Set([
      '3.basecampapi.com',
      'preview.app.basecamp.com',
      'storage.app.basecamp.com',
    ])
    if (!allowedBasecampHosts.has(inputHost)) {
      return NextResponse.json({ error: 'Forbidden URL' }, { status: 403 })
    }

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
    const token = await getValidToken()
    const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (noreply@tacosgavilan.com)'

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })

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

      if (!forceDownload) {
        return NextResponse.redirect(parsedRedirect.toString(), { status: 307 })
      }

      // Stream S3 payload with Content-Disposition: attachment when download=1 is requested
      const s3Res = await fetch(parsedRedirect.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(20_000),
      })
      if (!s3Res.ok) {
        return NextResponse.json({ error: `Upstream S3 download failed (${s3Res.status})` }, { status: 502 })
      }
      const contentType = (s3Res.headers.get('Content-Type') || 'application/octet-stream').toLowerCase()
      const blob = await s3Res.blob()
      const headers = new Headers()
      headers.set('Content-Type', contentType)
      headers.set('Content-Disposition', buildContentDisposition(filenameParam, decodedPath, contentType))
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('Cache-Control', 'private, max-age=3600')
      return new Response(blob, { status: 200, headers })
    }

    if (res.ok) {
      const contentType = (res.headers.get('Content-Type') || 'application/octet-stream').toLowerCase()
      if (contentType.includes('application/json') || contentType.includes('text/html')) {
        return NextResponse.json({ error: 'Forbidden attachment content type' }, { status: 403 })
      }
      const blob = await res.blob()
      const headers = new Headers()
      headers.set('Content-Type', contentType)
      if (forceDownload) {
        headers.set('Content-Disposition', buildContentDisposition(filenameParam, decodedPath, contentType))
      }
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
