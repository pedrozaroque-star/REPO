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
