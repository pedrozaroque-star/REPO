/**
 * @module lib/basecamp-html
 * @description Utilidades puras en TypeScript (compatibles con cliente React y servidor Node.js) para
 *              sanitizar HTML de Basecamp Trix, reescribir URLs privadas de adjuntos hacia el proxy
 *              seguro `/api/basecamp/attachment`, eliminar banners de atribución TEG duplicados y
 *              decodificar nombres de archivo sin errores `URIError`.
 *
 * @businessRules
 * - Las URLs directas de `preview.app.basecamp.com`, `storage.app.basecamp.com` y `3.basecampapi.com`
 *   requieren cookie de sesión o token OAuth de Basecamp; en el navegador deben pasar por
 *   `/api/basecamp/attachment?url=...`. Las URLs ya migradas a Supabase Storage permanecen intactas.
 * - Los atributos `srcset` en etiquetas `<img>` se eliminan para evitar que el navegador ignore el `src`
 *   reescrito y falle con 403/404 contra Basecamp.
 * - Cualquier banner `<p data-teg-author="...">` / `Solicitado por:` inyectado para Basecamp 3 se limpia
 *   al renderizar en TEG porque la interfaz nativa ya muestra el autor real.
 *
 * @dataFlow
 * - Raw HTML (DB / API) -> `rewriteBasecampHtmlUrls(html)` -> `stripTegAuthorBanner` -> URL proxy rewrite -> `sanitizeBasecampHtml` -> Safe HTML string
 * - Raw URL -> `proxyBasecampUrl(url)` -> `/api/basecamp/attachment?url=...` o URL original segura
 * - Raw Filename -> `safeDecodeFilename(raw)` -> Nombre legible sin excepciones por `%` literal
 *
 * @notes
 * - Corrige el bug del regex antiguo `[^\/>]*` que fallaba cuando un `<img>` o `<a>` tenía atributos
 *   posteriores con `/` (ej. `type="application/pdf"` o `data-mime="image/png"`), haciendo match
 *   únicamente hasta la comilla de cierre de `src`/`href`.
 */

import { stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'

const BASECAMP_PROXYABLE_HOSTS = new Set([
  'preview.app.basecamp.com',
  'storage.app.basecamp.com',
  '3.basecampapi.com',
])

/**
 * Decodes HTML numeric/hex entities and strips control/whitespace characters for URI scheme inspection.
 */
function decodeUriForSchemeCheck(rawVal: string): string {
  return String(rawVal)
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);?/g, (_m, dec) => {
      const code = parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/[\u0000-\u0020]+/g, '')
    .toLowerCase()
}

function isDangerousScheme(rawVal: string): boolean {
  const decoded = decodeUriForSchemeCheck(rawVal)
  return (
    decoded.startsWith('javascript:') ||
    decoded.startsWith('vbscript:') ||
    (decoded.startsWith('data:') && !/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(decoded))
  )
}

/**
 * Rewrites raw Basecamp attachment/blob URLs (`preview.app.basecamp.com`, `storage.app.basecamp.com`,
 * `3.basecampapi.com`) to `/api/basecamp/attachment?url=...`, while leaving Supabase Storage and other
 * safe URLs intact. Blocks dangerous `javascript:` / `vbscript:` / non-image `data:` URLs.
 */
export function proxyBasecampUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''

  if (isDangerousScheme(trimmed)) return ''

  // Already proxied — keep idempotent
  if (trimmed.startsWith('/api/basecamp/attachment?')) {
    return trimmed
  }

  // Unescape HTML &amp; if caller extracted URL from raw HTML attributes
  const unescaped = trimmed.replace(/&amp;/gi, '&')

  try {
    const parsed = new URL(unescaped)
    if (parsed.protocol === 'https:' && BASECAMP_PROXYABLE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
    }
  } catch {
    // Relative path or non-standard URL — leave intact since dangerous schemes were already filtered
  }

  return trimmed
}

/**
 * Sanitizes Basecamp Trix HTML against XSS vectors (dangerous tags, inline `on*` event handlers,
 * `srcdoc`, and `javascript:`/`vbscript:`/`data:` URIs) while preserving safe formatting tags,
 * `<bc-attachment>`, images, tables, lists, and links.
 */
export function sanitizeBasecampHtml(html?: string | null): string {
  if (!html || typeof html !== 'string') return ''
  let clean = html.replace(/<!--[\s\S]*?-->/g, '')

  let prev = ''
  while (clean !== prev) {
    prev = clean
    clean = clean
      .replace(
        /<\s*(script|iframe|object|embed|form|applet|meta|link|style|base|svg|math|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
        ''
      )
      .replace(
        /<\s*\/?\s*(script|iframe|object|embed|form|applet|meta|link|style|base|svg|math|template|input|button|textarea|select)\b[^>]*\/?>/gi,
        ''
      )
      .replace(/(<[^>]*?)(?:[\s/]+)(on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*))/gi, '$1')
      .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/gi, '')
  }

  clean = clean.replace(
    /(\s+(?:href|src|xlink:href|action|formaction)\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (full, attrPrefix, quote, rawVal) => {
      if (isDangerousScheme(rawVal)) {
        const safeFallback = /href/i.test(attrPrefix) ? '#' : ''
        return `${attrPrefix}${quote}${safeFallback}${quote}`
      }
      return full
    }
  )

  clean = clean.replace(
    /(\s+(?:href|src|xlink:href|action|formaction)\s*=\s*)([^\s>"']+)/gi,
    (full, attrPrefix, rawVal) => {
      if (isDangerousScheme(rawVal)) {
        const safeFallback = /href/i.test(attrPrefix) ? '"#"' : '""'
        return `${attrPrefix}${safeFallback}`
      }
      return full
    }
  )

  return clean
}

/**
 * Strips TEG author attribution banners, removes `srcset`, rewrites Basecamp `<img>` `src` and `<a>` `href`
 * URLs (matching strictly up to the closing quote so attributes containing `/` like `type="application/pdf"`
 * never break), and sanitizes dangerous HTML tags/attributes cleanly.
 */
export function rewriteBasecampHtmlUrls(html?: string | null): string {
  if (!html || typeof html !== 'string') return ''

  // 1. Strip Basecamp-mirrored TEG author banner (<p data-teg-author=...> / Solicitado por:)
  const { cleanHtml } = stripTegAuthorBanner(html)
  if (!cleanHtml) return ''

  // 2. Remove srcset attributes so the browser uses the rewritten src
  let rewritten = cleanHtml
    .replace(/\s+srcset\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+srcset\s*=\s*'[^']*'/gi, '')
    .replace(/\s+srcset\s*=\s*[^\s>"']+/gi, '')

  // 3. Rewrite Basecamp image src URLs matching up to the closing quote of src
  rewritten = rewritten.replace(
    /(<img\b[^>]*?\s+src\s*=\s*)(["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']*)(\2)/gi,
    (_match, prefix, quote, rawUrl, closingQuote) => {
      const proxied = proxyBasecampUrl(rawUrl)
      return `${prefix}${quote}${proxied}${closingQuote}`
    }
  )

  // 4. Rewrite Basecamp link href URLs matching up to the closing quote of href
  rewritten = rewritten.replace(
    /(<a\b[^>]*?\s+href\s*=\s*)(["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']*)(\2)/gi,
    (_match, prefix, quote, rawUrl, closingQuote) => {
      const proxied = proxyBasecampUrl(rawUrl)
      return `${prefix}${quote}${proxied}${closingQuote}`
    }
  )

  // 5. Sanitize dangerous tags, event handlers, and URI schemes
  return sanitizeBasecampHtml(rewritten)
}

/**
 * Safely decodes a percent-encoded filename without throwing `URIError` when literal `%` characters
 * (e.g. `"Reporte 100% Pollo.pdf"`) appear in filenames.
 */
export function safeDecodeFilename(raw?: string | null, fallback: string = ''): string {
  if (!raw || typeof raw !== 'string') return fallback
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Builds a same-origin `/api/basecamp/attachment?...&download=1&filename=...` URL that forces
 * `Content-Disposition: attachment` for both Basecamp 3 blobs and Supabase Storage `checklist-photos` files.
 */
export function buildBasecampDirectDownloadHref(rawUrl?: string | null, rawFilename?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '#'
  const trimmed = rawUrl.trim().replace(/&amp;/gi, '&')
  if (!trimmed || isDangerousScheme(trimmed)) return '#'

  const deriveFilename = (): string => {
    const fn = safeDecodeFilename(rawFilename || '').trim()
    if (fn && fn !== 'Image' && fn !== 'full' && fn !== 'preview') return fn
    try {
      const target = trimmed.startsWith('/api/basecamp/attachment?')
        ? new URLSearchParams(trimmed.split('?')[1] || '').get('url') || trimmed
        : trimmed
      const last = target.split('/').pop()?.split('?')[0] || ''
      const dec = safeDecodeFilename(last)
      if (dec && dec !== 'full' && dec !== 'preview') return dec
    } catch {
      // ignore
    }
    return 'imagen'
  }

  const filename = deriveFilename()

  if (trimmed.startsWith('/api/basecamp/attachment?')) {
    const qs = new URLSearchParams(trimmed.split('?')[1] || '')
    qs.set('download', '1')
    if (filename) qs.set('filename', filename)
    return `/api/basecamp/attachment?${qs.toString()}`
  }

  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    if (
      parsed.protocol === 'https:' &&
      (BASECAMP_PROXYABLE_HOSTS.has(host) ||
        (host.endsWith('.supabase.co') && parsed.pathname.startsWith('/storage/v1/object/public/checklist-photos/')))
    ) {
      const qs = new URLSearchParams({
        url: parsed.toString(),
        download: '1',
      })
      if (filename) qs.set('filename', filename)
      return `/api/basecamp/attachment?${qs.toString()}`
    }
  } catch {
    // Non-URL or external URL
  }

  return trimmed
}

/**
 * Programmatically downloads an image or attachment in 1 click without opening a new tab.
 */
export async function triggerBasecampDownload(rawUrl: string, rawFilename?: string | null): Promise<void> {
  if (typeof window === 'undefined' || !rawUrl) return
  const downloadHref = buildBasecampDirectDownloadHref(rawUrl, rawFilename)
  if (!downloadHref || downloadHref === '#') return

  try {
    const token = window.localStorage?.getItem('teg_token')
    const headers: Record<string, string> = {}
    if (token && downloadHref.startsWith('/api/')) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const res = await fetch(downloadHref, { headers, credentials: 'same-origin' })
    if (res.ok) {
      const blob = await res.blob()
      let finalName = safeDecodeFilename(rawFilename || '').trim()
      const cd = res.headers.get('Content-Disposition') || ''
      const utf8Match = cd.match(/filename\*=UTF-8''([^;\r\n]+)/i)
      const asciiMatch = cd.match(/filename="([^"]+)"/i)
      if (utf8Match?.[1]) {
        finalName = safeDecodeFilename(utf8Match[1])
      } else if (asciiMatch?.[1]) {
        finalName = asciiMatch[1]
      }
      if (!finalName) finalName = 'imagen.jpg'

      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = finalName
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000)
      return
    }
  } catch {
    // Fallback to direct anchor download below
  }

  const fallbackAnchor = document.createElement('a')
  fallbackAnchor.href = downloadHref
  fallbackAnchor.download = safeDecodeFilename(rawFilename || '') || 'imagen'
  fallbackAnchor.style.display = 'none'
  document.body.appendChild(fallbackAnchor)
  fallbackAnchor.click()
  document.body.removeChild(fallbackAnchor)
}

/**
 * Wraps every `<img>` in sanitized Basecamp HTML inside a `.bc-img-frame` container with a hoverable
 * 1-click download button (`a[data-bc-download="true"]`), while preserving click-to-zoom on the image itself.
 */
export function injectImageDownloadOverlays(sanitizedHtml: string, downloadLabel: string = '⬇ Descargar'): string {
  if (!sanitizedHtml || !/<img\b/i.test(sanitizedHtml)) return sanitizedHtml
  const safeLabel = downloadLabel
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  return sanitizedHtml.replace(/<img\b([^>]*)>/gi, (fullImg, attrs) => {
    const srcMatch = String(attrs).match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)
    const rawSrc = srcMatch?.[2] || ''
    if (!rawSrc) return fullImg
    const altMatch = String(attrs).match(/\balt\s*=\s*(["'])([^"']*)\1/i)
    const rawAlt = altMatch?.[2] || ''
    const dlHref = buildBasecampDirectDownloadHref(rawSrc, rawAlt).replace(/"/g, '&quot;')
    const escSrc = rawSrc.replace(/"/g, '&quot;')
    const escAlt = rawAlt.replace(/"/g, '&quot;')
    return `<span class="bc-img-frame">${fullImg}<a href="${dlHref}" data-bc-download="true" data-bc-src="${escSrc}" data-bc-filename="${escAlt}" class="bc-img-dl-btn" title="${safeLabel}">${safeLabel}</a></span>`
  })
}

export const BASECAMP_IMAGE_HOVER_CSS = `
  .bc-img-frame {
    position: relative;
    display: inline-block;
    max-width: 100%;
    margin: 10px 0;
    line-height: 0;
  }
  .bc-img-frame img {
    margin: 0 !important;
    display: block;
    cursor: zoom-in !important;
  }
  .bc-img-frame a.bc-img-dl-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    opacity: 0;
    transform: translateY(-3px);
    transition: opacity 0.16s ease, transform 0.16s ease, background-color 0.15s ease;
    background-color: rgba(15, 23, 42, 0.85);
    color: #ffffff !important;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 12px;
    line-height: 1.2;
    font-weight: 700;
    cursor: pointer;
    text-decoration: none !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    z-index: 6;
    backdrop-filter: blur(6px);
  }
  .bc-img-frame:hover a.bc-img-dl-btn,
  .bc-img-frame a.bc-img-dl-btn:focus-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .bc-img-frame a.bc-img-dl-btn:hover {
    background-color: #1D7DB5;
    text-decoration: none !important;
  }
  @media (hover: none) {
    .bc-img-frame a.bc-img-dl-btn {
      opacity: 0.92;
      transform: none;
    }
  }
`
