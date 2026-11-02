/**
 * @module lib/external-accounting-html-sanitize
 * @description Strict allowlist HTML sanitizer for QBO email & statement previews in `/admin/contabilidad-externa`.
 *
 * @businessRules
 * - Never render untrusted or dynamic email/statement HTML via `dangerouslySetInnerHTML`.
 * - Enforces an explicit allowlist of safe structural/typographic tags (`div`, `span`, `p`, `br`, `hr`, `table`,
 *   `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, `strong`, `b`, `em`, `i`, `u`, `small`, `h1`–`h4`, `ul`, `ol`, `li`,
 *   `a`, `img`, `code`, `pre`, `blockquote`) and safe attributes (`style`, `href`, `src`, `alt`, `title`, `width`,
 *   `height`, `align`, `valign`, `colspan`, `rowspan`, `cellpadding`, `cellspacing`, `border`, `bgcolor`).
 * - Completely removes executable/dangerous container blocks (`<script>`, `<style>`, `<svg>`, `<math>`, `<iframe>`,
 *   `<frame>`, `<frameset>`, `<object>`, `<embed>`, `<applet>`, `<form>`, `<base>`, `<meta>`, `<link>`, `<template>`).
 * - Blocks all inline event handlers (`on*`), `srcdoc`, `formaction`, `xlink:href`, and non-http(s)/mailto schemes
 *   (`javascript:`, `vbscript:`, `data:`, `blob:`, `file:`) even when obfuscated with HTML entities or control chars.
 *
 * @dataFlow
 * Raw email/statement HTML -> `sanitizeEmailPreviewHtml(rawHtml)` -> `<iframe sandbox="" referrerPolicy="no-referrer" srcDoc={...} />`
 *
 * @notes
 * - Pure TypeScript module testable in Node/TSX runtime suites against OWASP XSS vectors.
 */

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'div',
  'span',
  'p',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'code',
  'pre',
  'blockquote',
])

const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img'])

const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'style',
  'href',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'align',
  'valign',
  'colspan',
  'rowspan',
  'cellpadding',
  'cellspacing',
  'border',
  'bgcolor',
])

function decodeHtmlEntitiesForSchemeCheck(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '')
    .replace(/&newline;/gi, '')
    .replace(/[\u0000-\u0020]+/g, '')
    .toLowerCase()
}

function sanitizeUrlAttribute(attrName: string, rawVal: string): string {
  const trimmed = String(rawVal || '').trim()
  if (!trimmed) return '#'
  const decoded = decodeHtmlEntitiesForSchemeCheck(trimmed)

  if (
    decoded.startsWith('javascript:') ||
    decoded.startsWith('vbscript:') ||
    decoded.startsWith('data:') ||
    decoded.startsWith('blob:') ||
    decoded.startsWith('file:')
  ) {
    return '#'
  }

  if (attrName === 'src') {
    if (decoded.startsWith('https://') || decoded.startsWith('http://')) {
      return trimmed.replace(/"/g, '&quot;')
    }
    return '#'
  }

  // href allows https://, http://, mailto:, tel:, or # anchor
  if (
    decoded.startsWith('https://') ||
    decoded.startsWith('http://') ||
    decoded.startsWith('mailto:') ||
    decoded.startsWith('tel:') ||
    decoded.startsWith('#')
  ) {
    return trimmed.replace(/"/g, '&quot;')
  }

  return '#'
}

function sanitizeInlineStyle(rawStyle: string): string {
  const decoded = decodeHtmlEntitiesForSchemeCheck(rawStyle)
  if (
    decoded.includes('expression(') ||
    decoded.includes('javascript:') ||
    decoded.includes('vbscript:') ||
    decoded.includes('data:') ||
    decoded.includes('-moz-binding') ||
    decoded.includes('behavior:') ||
    decoded.includes('@import') ||
    decoded.includes('url(')
  ) {
    // Strip dangerous CSS constructs completely
    return String(rawStyle || '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/url\s*\([^)]*\)/gi, '')
      .replace(/-moz-binding\s*:[^;]+;?/gi, '')
      .replace(/behavior\s*:[^;]+;?/gi, '')
      .replace(/@import[^;]+;?/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/vbscript\s*:/gi, '')
      .replace(/"/g, "'")
      .trim()
  }
  return String(rawStyle || '').replace(/"/g, "'").trim()
}

function sanitizeTagAttributes(tagName: string, rawAttrs: string): string {
  if (!rawAttrs || !rawAttrs.trim()) return ''
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const safePairs: string[] = []
  let match: RegExpExecArray | null
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const attrName = String(match[1] || '').toLowerCase()
    if (!attrName) continue
    // Block all event handlers (onload, onerror, onclick, etc.) and dangerous attributes
    if (
      attrName.startsWith('on') ||
      attrName === 'srcdoc' ||
      attrName === 'formaction' ||
      attrName === 'action' ||
      attrName === 'xlink:href'
    ) {
      continue
    }
    if (!ALLOWED_ATTRIBUTES.has(attrName)) continue
    if (attrName === 'href' && tagName !== 'a') continue
    if (attrName === 'src' && tagName !== 'img') continue

    const rawVal = match[2] ?? match[3] ?? match[4] ?? ''
    if (attrName === 'href' || attrName === 'src') {
      const safeUrl = sanitizeUrlAttribute(attrName, rawVal)
      safePairs.push(`${attrName}="${safeUrl}"`)
    } else if (attrName === 'style') {
      const safeCss = sanitizeInlineStyle(rawVal)
      if (safeCss) safePairs.push(`style="${safeCss}"`)
    } else {
      const escapedVal = String(rawVal)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      safePairs.push(`${attrName}="${escapedVal}"`)
    }
  }
  if (tagName === 'a') {
    safePairs.push('rel="noopener noreferrer"')
  }
  return safePairs.length > 0 ? ` ${safePairs.join(' ')}` : ''
}

export function sanitizeEmailPreviewHtml(rawHtml: string | null | undefined): string {
  let html = String(rawHtml ?? '')

  // 1. Remove comments and dangerous container blocks with their inner contents
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|math|iframe|frame|frameset|object|embed|applet|form|template|noscript|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|svg|math|iframe|frame|frameset|object|embed|applet|form|template|noscript|base|meta|link|input|button|select|textarea)\b[^>]*\/?>/gi, '')

  // 2. Filter remaining HTML tags through the strict allowlist and attribute sanitizer
  html = html.replace(/<\/?([a-zA-Z0-9:-]+)([^>]*)>/g, (fullMatch, rawTag, rawAttrs) => {
    const tag = String(rawTag || '').toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) {
      return ''
    }
    const isClosing = fullMatch.startsWith('</')
    if (isClosing) {
      return VOID_TAGS.has(tag) ? '' : `</${tag}>`
    }
    const cleanAttrs = sanitizeTagAttributes(tag, rawAttrs || '')
    return VOID_TAGS.has(tag) ? `<${tag}${cleanAttrs} />` : `<${tag}${cleanAttrs}>`
  })

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline';" /></head><body style="margin:0;padding:12px;font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a;background:#ffffff;">${html}</body></html>`
}
