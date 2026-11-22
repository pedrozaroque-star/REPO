/**
 * @module lib/basecamp-html
 * @description Utilidades puras en TypeScript (compatibles con cliente React y servidor Node.js) para
 *              sanitizar HTML de Basecamp Trix, transformar `@menciones` (Basecamp 3/4 y sintéticas TEG)
 *              en píldoras interactivas o payloads oficiales `<bc-attachment sgid="...">`, extraer
 *              referencias de personas mencionadas, detectar y preservar videos inline (`.mov`, `.mp4`, `.webm`),
 *              reescribir URLs privadas hacia `/api/basecamp/attachment` y excluir mini-avatares de overlays de descarga.
 *
 * @businessRules
 * - Las URLs directas de `preview.app.basecamp.com`, `storage.app.basecamp.com`, `preview.3.basecamp.com`,
 *   `storage.3.basecamp.com` y `3.basecampapi.com` requieren cookie de sesión o token OAuth de Basecamp;
 *   en el navegador deben pasar por `/api/basecamp/attachment?url=...`. Las URLs ya migradas a Supabase Storage permanecen intactas.
 * - Los atributos `srcset` en etiquetas `<img>` se eliminan para evitar que el navegador ignore el `src`
 *   reescrito y falle con 403/404 contra Basecamp.
 * - Las `@menciones` en Basecamp 3/4 llegan como `<bc-attachment content-type="application/vnd.basecamp.mention">`
 *   (con `<figure><img class="avatar"><figcaption>Nombre</figcaption></figure>` o atributo `content` escapado),
 *   y las menciones sintéticas de gerentes TEG usan `<span data-teg-mention-person-id="...">@Nombre</span>`.
 *   Ambas se unifican visualmente como `.bc-mention-pill` y NUNCA deben recibir botón `⬇ Descargar` ni
 *   tratarse como archivos adjuntos descargables.
 * - Los videos inline (`.mov`, `.mp4`, `.webm`, `.m4v` o MIME `video/*`) se detectan con `isVideoMimeOrFilename`.
 *   `sanitizeBasecampHtml` preserva etiquetas seguras `<video>` y `<source>` (`controls`, `preload`, `playsinline`,
 *   `src`, `style`, `data-orig-bc-sgid`) bloqueando `on*` y esquemas peligrosos en `src`/`poster`/`href`.
 * - Al enviar HTML hacia Basecamp 3 API (`prepareHtmlForBasecampApi`), toda mención con `sgid` y todo
 *   adjunto replicado (foto, video o archivo) con `data-orig-bc-sgid` se envía como `<bc-attachment sgid="X"></bc-attachment>`
 *   (contrato oficial `rich_text.md`), y las menciones sintéticas sin `sgid` se degradan a `<strong>@Nombre</strong>`.
 * - Al replicar una tarea o anuncio (`prepareHtmlForTaskReplication`), se eliminan banners viejos de
 *   autoría (`Solicitado por:`) y `data-teg-when-done`, conservando intacto el formato enriquecido, menciones,
 *   fotos (`<img>` con `proxyBasecampUrl` + `data-orig-bc-sgid`), videos (`<bc-attachment>` + `<video>`) y archivos adjuntos (`data-teg-attachment="true"`).
 *
 * @dataFlow
 * - Renderizado UI: Raw HTML -> `rewriteBasecampHtmlUrls` -> `stripTegAuthorBanner` -> `transformBasecampMentionsToPills` -> proxy URLs -> `sanitizeBasecampHtml` -> `injectImageDownloadOverlays`
 * - Hidratación Editor: Raw HTML -> `hydrateBasecampHtmlForEditor` -> preserva `sgid` y `data-teg-mention-person-id` en `.bc-mention-pill`
 * - Replicación de Tarea / Anuncio: Source HTML -> `prepareHtmlForTaskReplication` -> limpia autor viejo + proxia fotos/videos/adjuntos preservando `data-orig-bc-sgid`
 * - Salida Basecamp API: Editor HTML -> `prepareHtmlForBasecampApi` -> `<bc-attachment sgid="X"></bc-attachment>` / `<strong>@Nombre</strong>`
 * - Notificaciones: HTML -> `extractMentionedPeopleRefs` -> `{ personUuids, bcPersonIds, sgids }`
 *
 * @notes
 * - Corrige el bug del regex antiguo `[^\/>]*` que fallaba cuando un `<img>` o `<a>` tenía atributos
 *   posteriores con `/` (ej. `type="application/pdf"` o `data-mime="image/png"`), haciendo match
 *   únicamente hasta la comilla de cierre de `src`/`href`.
 * - Incluye `preview.3.basecamp.com` y `storage.3.basecamp.com` para anuncios históricos como `Sign holders` (`9238410089`).
 * - Repara las 2,457 `@menciones` reales en `bc_comments` y `bc_todos` evitando chips de archivo roto
 *   y excluyendo mini-avatares (`class="avatar"`, `data-avatar-for-person-id`, `data-bc-avatar`) de
 *   `injectImageDownloadOverlays`.
 * - Autonomía Basecamp Standalone (2026-11-21): provee `parseInterceptableBasecampHref` (interceptor de enlaces
 *   históricos `https://(app|3).basecamp.com/5052386/buckets/...` y deep-links internos), `canUserAccessBasecampProject`
 *   (privacidad estricta por `bc_memberships`), `isManagerOrSupervisorBcPerson` y `normalizeEnabledProjectTools`.
 */

import {
  stripTegAuthorBanner,
  canonicalizeBasecampEmail,
  isMaskedOrEmptyEmail,
} from '@/lib/basecamp-person-resolver'

export const BASECAMP_PROXYABLE_HOSTS = new Set([
  'preview.app.basecamp.com',
  'storage.app.basecamp.com',
  'preview.3.basecamp.com',
  'storage.3.basecamp.com',
  '3.basecampapi.com',
])

const BASECAMP_HOSTS_REGEX_GROUP =
  '(?:preview\\.app\\.basecamp\\.com|storage\\.app\\.basecamp\\.com|preview\\.3\\.basecamp\\.com|storage\\.3\\.basecamp\\.com|3\\.basecampapi\\.com|[a-z0-9-]+\\.supabase\\.co\\/storage\\/v1\\/object\\/public\\/checklist-photos\\/basecamp-attachments)'
const BASECAMP_MEDIA_SRC_RE = new RegExp(
  `(<(?:img|video|source)\\b[^>]*?[\\s/"']src\\s*=\\s*)(["'])(https:\\/\\/${BASECAMP_HOSTS_REGEX_GROUP}[^"']*)(\\2)`,
  'gi'
)
const BASECAMP_ANCHOR_HREF_RE = new RegExp(
  `(<a\\b[^>]*?[\\s/"']href\\s*=\\s*)(["'])(https:\\/\\/${BASECAMP_HOSTS_REGEX_GROUP}[^"']*)(\\2)`,
  'gi'
)

function safeCodePointToChar(code: number, allowZero: boolean = false): string {
  if (!Number.isInteger(code)) return ''
  const min = allowZero ? 0 : 1
  if (code < min || code > 0x10ffff) return ''
  if (code >= 0xd800 && code <= 0xdfff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

function escapeHtmlText(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlAttr(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeHtmlEntities(raw: string): string {
  if (!raw) return ''
  return String(raw)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => {
      const code = parseInt(hex, 16)
      return safeCodePointToChar(code, false)
    })
    .replace(/&#(\d+);?/g, (_m, dec) => {
      const code = parseInt(dec, 10)
      return safeCodePointToChar(code, false)
    })
    .replace(/&amp;/gi, '&')
}

function stripTagsToPlainText(fragment: string): string {
  if (!fragment) return ''
  return unescapeHtmlEntities(String(fragment).replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeMentionLabel(rawName: string): string {
  const cleaned = String(rawName || '')
    .replace(/\u00a0/g, ' ')
    .replace(/^@+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Usuario'
}

/**
 * Safely decodes the Base64 payload portion of a Rails SignedGlobalID (`<base64>--<digest>`)
 * in both browser (`atob`) and Node.js (`Buffer`) runtimes to inspect `gid://bc3/Person/<id>`.
 */
function decodeSgidPayload(sgid: string): string {
  if (!sgid || typeof sgid !== 'string') return ''
  const payloadPart = sgid.split('--')[0]?.trim()
  if (!payloadPart) return ''
  try {
    const stdB64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const padLen = (4 - (stdB64.length % 4)) % 4
    const padded = stdB64 + '='.repeat(padLen)
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf8')
    }
    if (typeof atob === 'function') {
      return atob(padded)
    }
  } catch {
    // Ignore malformed base64
  }
  return ''
}

function extractMentionNameFromBcAttachment(attrsStr: string, innerHtml: string = ''): string {
  const attrs = String(attrsStr || '')
  const inner = String(innerHtml || '')

  // 1. Classic & BC4 <figcaption>Nombre</figcaption> inside <bc-attachment>
  const figMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)
  if (figMatch?.[1]) {
    const fromFig = stripTagsToPlainText(figMatch[1])
    if (fromFig) return normalizeMentionLabel(fromFig)
  }

  // 2. <img alt="Nombre Completo"> inside <bc-attachment> or alt="..." attribute on tag
  const innerAltMatch = inner.match(/\balt\s*=\s*(["'])([^"']+)\1/i)
  if (innerAltMatch?.[2]) {
    const fromAlt = unescapeHtmlEntities(innerAltMatch[2]).trim()
    if (fromAlt) return normalizeMentionLabel(fromAlt)
  }
  const attrAltMatch = attrs.match(/\balt\s*=\s*(["'])([^"']+)\1/i)
  if (attrAltMatch?.[2]) {
    const fromAttrAlt = unescapeHtmlEntities(attrAltMatch[2]).trim()
    if (fromAttrAlt) return normalizeMentionLabel(fromAttrAlt)
  }

  // 3. Escaped `content` attribute in BC4 (`content="&lt;bc-mention ...&gt;...&lt;/bc-mention&gt;"`)
  const contentAttrMatch = attrs.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)
  if (contentAttrMatch?.[2]) {
    const decodedContent = unescapeHtmlEntities(contentAttrMatch[2])
    const nestedFig = decodedContent.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)
    if (nestedFig?.[1]) {
      const fromNestedFig = stripTagsToPlainText(nestedFig[1])
      if (fromNestedFig) return normalizeMentionLabel(fromNestedFig)
    }
    const nestedAlt = decodedContent.match(/\balt\s*=\s*(["'])([^"']+)\1/i)
    if (nestedAlt?.[2]) {
      const fromNestedAlt = unescapeHtmlEntities(nestedAlt[2]).trim()
      if (fromNestedAlt) return normalizeMentionLabel(fromNestedAlt)
    }
    const fromContentPlain = stripTagsToPlainText(decodedContent)
    if (fromContentPlain) return normalizeMentionLabel(fromContentPlain)
  }

  // 4. Plain inner text (e.g. `<bc-attachment ...>@Carlos Roque</bc-attachment>`)
  const fromInnerText = stripTagsToPlainText(inner)
  if (fromInnerText) return normalizeMentionLabel(fromInnerText)

  return 'Usuario'
}

/**
 * Returns true when a `<bc-attachment ...>` attribute string corresponds to a Basecamp `@mention`
 * (`content-type="application/vnd.basecamp.mention"` or `data-teg-mention-person-id`).
 */
export function isBasecampMentionAttachment(attrsStr?: string | null): boolean {
  if (!attrsStr || typeof attrsStr !== 'string') return false
  return (
    /\bcontent-type\s*=\s*(?:["']application\/vnd\.basecamp\.mention["']|application\/vnd\.basecamp\.mention\b)/i.test(
      attrsStr
    ) || /\bdata-teg-mention-person-id\s*=/i.test(attrsStr)
  )
}

/**
 * Transforms Basecamp 3/4 `<bc-attachment content-type="application/vnd.basecamp.mention">...</bc-attachment>`
 * (both `<figure><img class="avatar"><figcaption>` and escaped `content` attribute variants) and TEG
 * `<span data-teg-mention-person-id="...">@Nombre</span>` spans into clean, uniform visual pills:
 * `<span class="bc-mention-pill" data-bc-mention="true">@Nombre</span>`.
 */
export function transformBasecampMentionsToPills(html?: string | null): string {
  if (!html || typeof html !== 'string') return ''

  // 1. Paired <bc-attachment ...>...</bc-attachment>
  let out = html.replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs, inner) => {
    if (!isBasecampMentionAttachment(attrs)) return full
    const cleanName = extractMentionNameFromBcAttachment(attrs, inner)
    return `<span class="bc-mention-pill" data-bc-mention="true">@${escapeHtmlText(cleanName)}</span>`
  })

  // 2. Self-closing <bc-attachment ... />
  out = out.replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) => {
    if (!isBasecampMentionAttachment(attrs)) return full
    const cleanName = extractMentionNameFromBcAttachment(attrs, '')
    return `<span class="bc-mention-pill" data-bc-mention="true">@${escapeHtmlText(cleanName)}</span>`
  })

  // 3. TEG synthetic or already-rendered mention spans
  out = out.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (full, attrs, inner) => {
    if (
      !/\bdata-teg-mention-person-id\s*=/i.test(attrs) &&
      !/\bdata-bc-mention\s*=\s*(?:["']true["']|true\b)/i.test(attrs)
    ) {
      return full
    }
    const plain = stripTagsToPlainText(inner)
    const cleanName = normalizeMentionLabel(plain)
    return `<span class="bc-mention-pill" data-bc-mention="true">@${escapeHtmlText(cleanName)}</span>`
  })

  return out
}

/**
 * Hydrates stored Basecamp/TEG HTML for `BasecampRichEditor` when editing an existing To-Do, Comment,
 * or Message: converts existing mentions into atomic `contenteditable="false"` `.bc-mention-pill` nodes
 * while strictly preserving `sgid` and `data-teg-mention-person-id`, and proxies Basecamp image/file URLs.
 */
export function hydrateBasecampHtmlForEditor(
  html?: string | null,
  people?: Array<{
    id: string
    bc_id?: number | string | null
    name?: string | null
    attachable_sgid?: string | null
  }>
): string {
  if (!html || typeof html !== 'string') return ''

  const { cleanHtml } = stripTegAuthorBanner(html)
  const withoutWhenDone = cleanHtml
    .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
  if (!withoutWhenDone.trim()) return ''

  const peopleList = Array.isArray(people) ? people : []
  const byUuid = new Map<string, (typeof peopleList)[number]>()
  const byBcId = new Map<number, (typeof peopleList)[number]>()
  const bySgid = new Map<string, (typeof peopleList)[number]>()

  for (const p of peopleList) {
    if (!p?.id) continue
    byUuid.set(String(p.id), p)
    const nBc = Number(p.bc_id)
    if (Number.isFinite(nBc) && nBc > 0) byBcId.set(nBc, p)
    if (p.attachable_sgid) bySgid.set(String(p.attachable_sgid), p)
  }

  const resolveMentionMeta = (attrs: string, inner: string) => {
    const sgidMatch = attrs.match(/\bsgid\s*=\s*(["'])([^"']+)\1/i)
    let sgid = sgidMatch?.[2]?.trim() || ''

    const uuidMatch = attrs.match(/\bdata-teg-mention-person-id\s*=\s*(["'])([^"']+)\1/i)
    let personUuid = uuidMatch?.[2]?.trim() || ''

    const combined = `${attrs} ${inner}`
    const avatarBcMatch = combined.match(/\bdata-avatar-for-person-id\s*=\s*(?:["'](\d+)["']|(\d+))/i)
    const gidMatch = combined.match(/gid:\/\/bc3\/Person\/(\d+)/i)
    const decodedSgid = sgid ? decodeSgidPayload(sgid) : ''
    const sgidGidMatch = decodedSgid.match(/gid:\/\/bc3\/Person\/(\d+)/i)
    const bcPersonId = Number(avatarBcMatch?.[1] || avatarBcMatch?.[2] || gidMatch?.[1] || sgidGidMatch?.[1] || 0)

    const matchedPerson =
      (personUuid && byUuid.get(personUuid)) ||
      (sgid && bySgid.get(sgid)) ||
      (bcPersonId > 0 ? byBcId.get(bcPersonId) : undefined)

    if (!personUuid && matchedPerson?.id) {
      personUuid = String(matchedPerson.id)
    }
    if (!sgid && matchedPerson?.attachable_sgid) {
      sgid = String(matchedPerson.attachable_sgid)
    }

    const cleanName = extractMentionNameFromBcAttachment(attrs, inner)
    const finalName =
      cleanName === 'Usuario' && matchedPerson?.name
        ? normalizeMentionLabel(matchedPerson.name)
        : cleanName

    return { sgid, personUuid, finalName }
  }

  // 1. Convert paired mention <bc-attachment> into editable-safe pill preserving sgid + personUuid
  let hydrated = withoutWhenDone.replace(
    /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi,
    (full, attrs, inner) => {
      if (!isBasecampMentionAttachment(attrs)) return full
      const { sgid, personUuid, finalName } = resolveMentionMeta(attrs, inner)
      const personAttr = personUuid ? ` data-teg-mention-person-id="${escapeHtmlAttr(personUuid)}"` : ''
      if (sgid) {
        return `<bc-attachment sgid="${escapeHtmlAttr(sgid)}" content-type="application/vnd.basecamp.mention"${personAttr} class="bc-mention-pill" contenteditable="false">@${escapeHtmlText(finalName)}</bc-attachment>`
      }
      return `<span${personAttr} data-bc-mention="true" class="bc-mention-pill" contenteditable="false">@${escapeHtmlText(finalName)}</span>`
    }
  )

  // 2. Convert self-closing mention <bc-attachment ... />
  hydrated = hydrated.replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) => {
    if (!isBasecampMentionAttachment(attrs)) return full
    const { sgid, personUuid, finalName } = resolveMentionMeta(attrs, '')
    const personAttr = personUuid ? ` data-teg-mention-person-id="${escapeHtmlAttr(personUuid)}"` : ''
    if (sgid) {
      return `<bc-attachment sgid="${escapeHtmlAttr(sgid)}" content-type="application/vnd.basecamp.mention"${personAttr} class="bc-mention-pill" contenteditable="false">@${escapeHtmlText(finalName)}</bc-attachment>`
    }
    return `<span${personAttr} data-bc-mention="true" class="bc-mention-pill" contenteditable="false">@${escapeHtmlText(finalName)}</span>`
  })

  // 3. Normalize existing TEG mention spans for editing
  hydrated = hydrated.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (full, attrs, inner) => {
    if (
      !/\bdata-teg-mention-person-id\s*=/i.test(attrs) &&
      !/\bdata-bc-mention\s*=\s*(?:["']true["']|true\b)/i.test(attrs)
    ) {
      return full
    }
    const uuidMatch = attrs.match(/\bdata-teg-mention-person-id\s*=\s*(["'])([^"']+)\1/i)
    const personUuid = uuidMatch?.[2]?.trim() || ''
    const sgidAttrMatch = attrs.match(/(?:^|\s)(?:data-bc-sgid|sgid)\s*=\s*(["'])([^"']+)\1/i)
    const matched = personUuid ? byUuid.get(personUuid) : undefined
    const sgid = sgidAttrMatch?.[2]?.trim() || matched?.attachable_sgid || ''
    const cleanName = normalizeMentionLabel(stripTagsToPlainText(inner) || matched?.name || 'Usuario')
    const personAttr = personUuid ? ` data-teg-mention-person-id="${escapeHtmlAttr(personUuid)}"` : ''
    if (sgid) {
      return `<bc-attachment sgid="${escapeHtmlAttr(sgid)}" content-type="application/vnd.basecamp.mention"${personAttr} class="bc-mention-pill" contenteditable="false">@${escapeHtmlText(cleanName)}</bc-attachment>`
    }
    return `<span${personAttr} data-bc-mention="true" class="bc-mention-pill" contenteditable="false">@${escapeHtmlText(cleanName)}</span>`
  })

  // 4. Normalize video <bc-attachment> tags so broken <figure><img src="...mov"></figure> never enters the editor
  hydrated = hydrated.replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs, inner) => {
    if (isBasecampMentionAttachment(attrs)) return full
    const rawCt = unescapeHtmlEntities(extractAttrFromTag(attrs, 'content-type')).trim()
    const rawFn = safeDecodeFilename(unescapeHtmlEntities(extractAttrFromTag(attrs, 'filename')).trim())
    const rawUrl = extractAttrFromTag(attrs, 'url').replace(/&amp;/gi, '&').trim()
    const rawHref = extractAttrFromTag(attrs, 'href').replace(/&amp;/gi, '&').trim()
    const innerImgMatch = inner.match(/<img\b([^>]*)>/i)
    const innerImgSrc = innerImgMatch?.[1] ? extractAttrFromTag(innerImgMatch[1], 'src').replace(/&amp;/gi, '&').trim() : ''
    const innerVidMatch = inner.match(/<video\b([^>]*)>/i)
    const innerVidSrc = innerVidMatch?.[1] ? extractAttrFromTag(innerVidMatch[1], 'src').replace(/&amp;/gi, '&').trim() : ''
    const candidateUrl = rawHref || rawUrl || innerVidSrc || innerImgSrc

    if (!isVideoMimeOrFilename(rawCt, rawFn, candidateUrl)) return full

    const sgid = unescapeHtmlEntities(extractAttrFromTag(attrs, 'sgid')).trim()
    const origSgid = unescapeHtmlEntities(extractAttrFromTag(attrs, 'data-orig-bc-sgid')).trim()
    const sgidAttr = sgid ? ` sgid="${escapeHtmlAttr(sgid)}"` : ''
    const origSgidAttr = origSgid ? ` data-orig-bc-sgid="${escapeHtmlAttr(origSgid)}"` : ''
    const proxiedHref = candidateUrl ? proxyBasecampUrl(candidateUrl) : '#'
    const urlBase = candidateUrl ? safeDecodeFilename(candidateUrl.split('?')[0].split('/').pop() || '') : ''
    const displayFn =
      rawFn && isVideoMimeOrFilename(null, rawFn, null)
        ? rawFn
        : urlBase || rawFn || 'video.mp4'
    const videoMime = inferVideoMimeType(rawCt, displayFn, candidateUrl)
    const playerHtml =
      proxiedHref && proxiedHref !== '#'
        ? `<video controls preload="metadata" playsinline src="${escapeHtmlAttr(proxiedHref)}" style="max-width: 100%; max-height: 320px; border-radius: 8px; background: #0F172A; display: block; margin: 6px 0;"></video>`
        : ''
    return `<bc-attachment${sgidAttr}${origSgidAttr} content-type="${escapeHtmlAttr(videoMime)}" filename="${escapeHtmlAttr(displayFn)}" url="${escapeHtmlAttr(proxiedHref || '#')}" href="${escapeHtmlAttr(proxiedHref || '#')}" data-teg-attachment="true">${playerHtml}<a href="${escapeHtmlAttr(proxiedHref || '#')}" target="_blank" rel="noopener noreferrer" contenteditable="false" style="display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">🎬 ${escapeHtmlText(displayFn)}</a></bc-attachment>`
  })

  // 5. Remove srcset and proxy Basecamp image/video/link URLs so existing media renders inside contentEditable
  hydrated = rewriteBasecampMediaAndLinks(hydrated)

  return sanitizeBasecampHtml(hydrated)
}

function rewriteBasecampMediaAndLinks(fragment: string): string {
  return fragment
    .replace(/\s+srcset\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+srcset\s*=\s*'[^']*'/gi, '')
    .replace(/\s+srcset\s*=\s*[^\s>"']+/gi, '')
    .replace(
      BASECAMP_MEDIA_SRC_RE,
      (_match, prefix, quote, rawUrl, closingQuote) => `${prefix}${quote}${proxyBasecampUrl(rawUrl)}${closingQuote}`
    )
    .replace(
      BASECAMP_ANCHOR_HREF_RE,
      (_match, prefix, quote, rawUrl, closingQuote) => `${prefix}${quote}${proxyBasecampUrl(rawUrl)}${closingQuote}`
    )
}

const IMAGE_FILE_EXT_RE = /\.(?:jpe?g|png|gif|webp|bmp|svg|heic|heif|avif)(?:$|[?#])/i
const VIDEO_FILE_EXT_RE = /\.(?:mov|mp4|webm|m4v)(?:$|[?#])/i
const NON_IMAGE_FILE_EXT_RE =
  /\.(?:pdf|mov|mp4|m4v|avi|mkv|webm|mp3|wav|m4a|ogg|xlsx?|docx?|pptx?|csv|zip|rar|7z|txt|rtf|json|xml)(?:$|[?#])/i

/**
 * Returns true when a MIME `content-type`, `filename`, or `url` corresponds to an inline-playable video
 * (`video/*` or `.mov`, `.mp4`, `.webm`, `.m4v`), including URLs wrapped in `/api/basecamp/attachment?url=...`.
 */
export function isVideoMimeOrFilename(
  contentType?: string | null,
  filename?: string | null,
  url?: string | null
): boolean {
  const ct = unescapeHtmlEntities(String(contentType || ''))
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (ct.startsWith('video/')) return true

  const fn = safeDecodeFilename(unescapeHtmlEntities(String(filename || '')).trim())
  if (fn && VIDEO_FILE_EXT_RE.test(fn)) return true

  const rawUrl = unescapeHtmlEntities(String(url || '')).trim()
  if (rawUrl) {
    if (rawUrl.startsWith('/api/basecamp/attachment?')) {
      try {
        const qs = new URLSearchParams(rawUrl.split('?')[1] || '')
        const innerFn = safeDecodeFilename(qs.get('filename') || '')
        const innerUrl = safeDecodeFilename(qs.get('url') || '')
        if ((innerFn && VIDEO_FILE_EXT_RE.test(innerFn)) || (innerUrl && VIDEO_FILE_EXT_RE.test(innerUrl))) {
          return true
        }
      } catch {
        // Ignore malformed query string
      }
    }
    if (VIDEO_FILE_EXT_RE.test(safeDecodeFilename(rawUrl))) return true
  }

  return false
}

function inferVideoMimeType(contentType?: string | null, filename?: string | null, url?: string | null): string {
  const ct = unescapeHtmlEntities(String(contentType || ''))
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (ct.startsWith('video/')) return ct

  const probe = `${safeDecodeFilename(filename || '')} ${safeDecodeFilename(url || '')}`.toLowerCase()
  if (/\.webm(?:$|[?#\s])/i.test(probe)) return 'video/webm'
  if (/\.mov(?:$|[?#\s])/i.test(probe)) return 'video/quicktime'
  return 'video/mp4'
}

function extractAttrFromTag(attrsStr: string, attrName: string): string {
  if (!attrsStr || !attrName) return ''
  const escapedName = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attrsStr)
  if (quoted) return quoted[2] || ''
  const unquoted = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*([^\\s>"']+)`, 'i').exec(attrsStr)
  return unquoted?.[1] || ''
}

function isImageBcAttachment(attrs: string, inner: string): boolean {
  const ct = unescapeHtmlEntities(extractAttrFromTag(attrs, 'content-type')).trim().toLowerCase()
  const filename = safeDecodeFilename(unescapeHtmlEntities(extractAttrFromTag(attrs, 'filename')).trim())
  const rawUrl = extractAttrFromTag(attrs, 'url').replace(/&amp;/gi, '&').trim()
  const rawHref = extractAttrFromTag(attrs, 'href').replace(/&amp;/gi, '&').trim()

  const imgMatch = inner.match(/<img\b([^>]*)>/i)
  const innerSrc =
    imgMatch && !isAvatarImageAttrs(imgMatch[1] || '')
      ? extractAttrFromTag(imgMatch[1] || '', 'src').replace(/&amp;/gi, '&').trim()
      : ''

  if (
    isVideoMimeOrFilename(ct, filename, rawHref || rawUrl) ||
    (innerSrc ? isVideoMimeOrFilename(null, null, innerSrc) : false)
  ) {
    return false
  }

  if (ct.startsWith('image/')) return true
  if (ct && ct !== 'application/octet-stream') {
    return false
  }

  if (IMAGE_FILE_EXT_RE.test(filename) || IMAGE_FILE_EXT_RE.test(rawHref) || IMAGE_FILE_EXT_RE.test(rawUrl)) {
    return true
  }
  if (NON_IMAGE_FILE_EXT_RE.test(filename) || NON_IMAGE_FILE_EXT_RE.test(rawHref) || NON_IMAGE_FILE_EXT_RE.test(rawUrl)) {
    return false
  }

  if (innerSrc && !NON_IMAGE_FILE_EXT_RE.test(innerSrc)) {
    return true
  }

  return false
}

function convertAttachmentTagForReplication(fullTag: string, attrs: string, inner: string): string {
  if (isBasecampMentionAttachment(attrs)) return fullTag

  const sgid = unescapeHtmlEntities(
    extractAttrFromTag(attrs, 'sgid') || extractAttrFromTag(attrs, 'data-orig-bc-sgid')
  ).trim()
  const rawContentType = unescapeHtmlEntities(extractAttrFromTag(attrs, 'content-type')).trim()
  const rawUrl = extractAttrFromTag(attrs, 'url').replace(/&amp;/gi, '&').trim()
  const rawHref = extractAttrFromTag(attrs, 'href').replace(/&amp;/gi, '&').trim()
  const rawFilename = safeDecodeFilename(unescapeHtmlEntities(extractAttrFromTag(attrs, 'filename')).trim())
  const rawCaption = unescapeHtmlEntities(extractAttrFromTag(attrs, 'caption')).trim()

  const imgMatch = inner.match(/<img\b([^>]*)>/i)
  const imgAttrs = imgMatch && !isAvatarImageAttrs(imgMatch[1] || '') ? imgMatch[1] || '' : ''
  const innerImgSrc = imgAttrs ? extractAttrFromTag(imgAttrs, 'src').replace(/&amp;/gi, '&').trim() : ''
  const innerImgAlt = imgAttrs ? unescapeHtmlEntities(extractAttrFromTag(imgAttrs, 'alt')).trim() : ''
  const innerImgSgid = imgAttrs ? unescapeHtmlEntities(extractAttrFromTag(imgAttrs, 'data-orig-bc-sgid')).trim() : ''

  const videoMatch = inner.match(/<video\b([^>]*)>/i)
  const sourceMatch = inner.match(/<source\b([^>]*)>/i)
  const innerVideoSrc = videoMatch?.[1]
    ? extractAttrFromTag(videoMatch[1], 'src').replace(/&amp;/gi, '&').trim()
    : sourceMatch?.[1]
      ? extractAttrFromTag(sourceMatch[1], 'src').replace(/&amp;/gi, '&').trim()
      : ''
  const innerVideoSgid = videoMatch?.[1]
    ? unescapeHtmlEntities(extractAttrFromTag(videoMatch[1], 'data-orig-bc-sgid')).trim()
    : ''

  const anchorMatch = inner.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i)
  const innerAnchorHref = anchorMatch?.[1] ? extractAttrFromTag(anchorMatch[1], 'href').replace(/&amp;/gi, '&').trim() : ''
  const innerAnchorSgid = anchorMatch?.[1]
    ? unescapeHtmlEntities(extractAttrFromTag(anchorMatch[1], 'data-orig-bc-sgid')).trim()
    : ''

  const finalSgid = sgid || innerImgSgid || innerVideoSgid || innerAnchorSgid
  const sgidAttr = finalSgid ? ` data-orig-bc-sgid="${escapeHtmlAttr(finalSgid)}"` : ''

  if (isImageBcAttachment(attrs, inner)) {
    const candidateSrc = innerImgSrc || rawUrl || rawHref
    const proxiedSrc = candidateSrc ? proxyBasecampUrl(candidateSrc) : ''
    const figMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)
    const figText = figMatch?.[1] ? stripTagsToPlainText(figMatch[1]) : ''
    const displayAlt = innerImgAlt || rawFilename || figText || 'Imagen adjunta'

    if (proxiedSrc) {
      const captionHtml =
        rawCaption && rawCaption !== rawFilename && rawCaption !== displayAlt
          ? `<div style="font-size: 12px; color: #64748B; margin-top: 4px;">${escapeHtmlText(rawCaption)}</div>`
          : ''
      return `<div style="margin: 8px 0;"><img src="${escapeHtmlAttr(proxiedSrc)}" alt="${escapeHtmlAttr(displayAlt)}"${sgidAttr} style="max-width: 100%; max-height: 360px; height: auto; border-radius: 6px;" />${captionHtml}</div>`
    }
    if (finalSgid) {
      return `<p data-teg-attachment="true" style="margin: 6px 0;"><a href="#"${sgidAttr} style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">🖼️ ${escapeHtmlText(displayAlt)}</a></p>`
    }
    return ''
  }

  const candidateFileUrl = rawHref || rawUrl || innerVideoSrc || innerImgSrc || innerAnchorHref
  const proxiedHref = candidateFileUrl ? proxyBasecampUrl(candidateFileUrl) : finalSgid ? '#' : ''
  if (!proxiedHref && !finalSgid) return ''

  const figMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)
  const figText = figMatch?.[1] ? stripTagsToPlainText(figMatch[1]) : ''
  const anchorText = anchorMatch?.[2]
    ? stripTagsToPlainText(anchorMatch[2]).replace(/^(?:📎|🎬)\s*/, '').replace(/\s*\(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B)\)\s*$/i, '').trim()
    : ''
  const urlBasename = candidateFileUrl
    ? safeDecodeFilename(candidateFileUrl.split('?')[0].split('/').pop() || '')
    : ''
  let displayFilename = rawFilename || figText || anchorText || urlBasename || 'Archivo adjunto'

  if (isVideoMimeOrFilename(rawContentType, displayFilename, candidateFileUrl)) {
    if (!isVideoMimeOrFilename(null, displayFilename, null) && urlBasename && isVideoMimeOrFilename(null, urlBasename, null)) {
      displayFilename = urlBasename
    }
    const videoMime = inferVideoMimeType(rawContentType, displayFilename, candidateFileUrl)
    const videoPlayerHtml =
      proxiedHref && proxiedHref !== '#'
        ? `<video controls preload="metadata" playsinline src="${escapeHtmlAttr(proxiedHref)}" style="max-width: 100%; max-height: 320px; border-radius: 8px; background: #0F172A; display: block; margin: 6px 0;"></video>`
        : ''
    return `<bc-attachment content-type="${escapeHtmlAttr(videoMime)}" filename="${escapeHtmlAttr(displayFilename)}" url="${escapeHtmlAttr(proxiedHref || '#')}" href="${escapeHtmlAttr(proxiedHref || '#')}"${sgidAttr} data-teg-attachment="true">${videoPlayerHtml}<a href="${escapeHtmlAttr(proxiedHref || '#')}" target="_blank" rel="noopener noreferrer" contenteditable="false" style="display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">🎬 ${escapeHtmlText(displayFilename)}</a></bc-attachment>`
  }

  return `<p data-teg-attachment="true" style="margin: 6px 0;"><a href="${escapeHtmlAttr(proxiedHref || '#')}" target="_blank" rel="noopener noreferrer"${sgidAttr} style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">📎 ${escapeHtmlText(displayFilename)}</a></p>`
}

/**
 * Prepares stored HTML of a historical or active To-Do (Pedido / Caso) or Announcement (`bc_messages`)
 * for replication inside `BasecampRichEditor`:
 * - Strips old authorship banners (`Solicitado por: ...` / `data-teg-author`) and `data-teg-when-done` spans.
 * - Preserves rich formatting (paragraphs, lists, tables, links) and converts `@mentions` into editable pills.
 * - Unwraps image `<bc-attachment>` elements into visible `<img>` tags with `proxyBasecampUrl(src)` and
 *   `data-orig-bc-sgid="<sgid>"` so images display immediately in the editor and round-trip cleanly to Basecamp 3.
 * - Preserves video `<bc-attachment>` elements (`.mov`, `.mp4`, `.webm`, `.m4v`) as `<bc-attachment data-teg-attachment="true">`
 *   with an inline `<video controls preload="metadata" playsinline>` preview, `proxyBasecampUrl`, and `data-orig-bc-sgid`.
 * - Converts non-image/non-video `<bc-attachment>` files (PDF, spreadsheets, etc.) into clean
 *   `<p data-teg-attachment="true">...<a href="..." data-orig-bc-sgid="...">📎 filename</a></p>` blocks.
 * - Proxies loose `<img>` / `<video>` / `<source>` / `<a>` Basecamp URLs, strips `srcset`, and sanitizes via `sanitizeBasecampHtml`.
 */
export function prepareHtmlForTaskReplication(
  rawHtml?: string | null,
  people?: Array<{
    id: string
    bc_id?: number | string | null
    name?: string | null
    attachable_sgid?: string | null
  }>
): string {
  if (!rawHtml || typeof rawHtml !== 'string' || !rawHtml.trim()) return ''

  const { cleanHtml } = stripTegAuthorBanner(rawHtml)
  const stripped = cleanHtml
    .replace(/<(?:p|div)\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/(?:p|div)>/gi, '')
    .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<a\b[^>]*\bdata-bc-download=["']true["'][^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<span\b[^>]*\bclass=["'][^"']*\bbc-img-frame\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '$1')
    .trim()

  if (!stripped || !hasRichContentOrMedia(stripped)) return ''

  // Hydrate @mentions into editable pills and strip srcset / proxy raw Basecamp URLs
  let out = hydrateBasecampHtmlForEditor(stripped, people)
  if (!out) return ''

  // Convert paired non-mention <bc-attachment>...</bc-attachment> (images, videos & files)
  out = out.replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs, inner) =>
    convertAttachmentTagForReplication(full, attrs, inner)
  )

  // Convert self-closing non-mention <bc-attachment ... />
  out = out.replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) =>
    convertAttachmentTagForReplication(full, attrs, '')
  )

  // Ensure any loose <img>, <video>, and <source> tags have srcset stripped and src passed through proxyBasecampUrl
  out = out
    .replace(/\s+srcset\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+srcset\s*=\s*'[^']*'/gi, '')
    .replace(/\s+srcset\s*=\s*[^\s>"']+/gi, '')
    .replace(/<(img|video|source)\b([^>]*)>/gi, (fullTag, _tagName, attrs) => {
      const srcVal = extractAttrFromTag(attrs, 'src')
      if (!srcVal) return fullTag
      const proxied = proxyBasecampUrl(srcVal)
      if (!proxied) return ''
      return fullTag.replace(
        /((?:^|\s)src\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
        (_m, prefix, q) => `${prefix}${q || '"'}${escapeHtmlAttr(proxied)}${q || '"'}`
      )
    })

  const sanitized = sanitizeBasecampHtml(out).trim()
  return hasRichContentOrMedia(sanitized) ? sanitized : ''
}

/**
 * Prepares rich HTML before sending it to the official Basecamp 3 API:
 * - Mention `<bc-attachment>` with `sgid="X"` (and existing Basecamp SGID attachments) -> `<bc-attachment sgid="X"></bc-attachment>`
 * - Replicated `<bc-attachment ... data-orig-bc-sgid="X">`, `<video ... data-orig-bc-sgid="X">`, `<img ... data-orig-bc-sgid="X">`, and `<a ... data-orig-bc-sgid="X">` -> `<bc-attachment sgid="X"></bc-attachment>`
 * - Synthetic TEG mentions (`data-teg-mention-person-id` without `sgid`) -> `<strong>@Nombre</strong>`
 */
export function prepareHtmlForBasecampApi(html?: string | null): string {
  if (!html || typeof html !== 'string') return ''

  // 1. Paired <bc-attachment ...>...</bc-attachment>
  let out = html.replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs, inner) => {
    const sgid = unescapeHtmlEntities(extractAttrFromTag(attrs, 'sgid')).trim()
    const origSgid = unescapeHtmlEntities(extractAttrFromTag(attrs, 'data-orig-bc-sgid')).trim()
    const isSupabaseUpload = /\/storage\/v1\/object\/public\/checklist-photos\//i.test(attrs)

    if ((sgid && !isSupabaseUpload) || origSgid) {
      return `<bc-attachment sgid="${escapeHtmlAttr(sgid || origSgid)}"></bc-attachment>`
    }
    if (isBasecampMentionAttachment(attrs)) {
      const cleanName = extractMentionNameFromBcAttachment(attrs, inner)
      return `<strong>@${escapeHtmlText(cleanName)}</strong>`
    }
    return full
  })

  // 2. Self-closing <bc-attachment ... />
  out = out.replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) => {
    const sgid = unescapeHtmlEntities(extractAttrFromTag(attrs, 'sgid')).trim()
    const origSgid = unescapeHtmlEntities(extractAttrFromTag(attrs, 'data-orig-bc-sgid')).trim()
    const isSupabaseUpload = /\/storage\/v1\/object\/public\/checklist-photos\//i.test(attrs)

    if ((sgid && !isSupabaseUpload) || origSgid) {
      return `<bc-attachment sgid="${escapeHtmlAttr(sgid || origSgid)}"></bc-attachment>`
    }
    if (isBasecampMentionAttachment(attrs)) {
      const cleanName = extractMentionNameFromBcAttachment(attrs, '')
      return `<strong>@${escapeHtmlText(cleanName)}</strong>`
    }
    return full
  })

  // 3. Synthetic TEG mention spans (<span data-teg-mention-person-id="...">@Nombre</span>)
  out = out.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (full, attrs, inner) => {
    if (
      !/\bdata-teg-mention-person-id\s*=/i.test(attrs) &&
      !/\bdata-bc-mention\s*=\s*(?:["']true["']|true\b)/i.test(attrs)
    ) {
      return full
    }
    const sgid = unescapeHtmlEntities(
      extractAttrFromTag(attrs, 'data-bc-sgid') || extractAttrFromTag(attrs, 'sgid')
    ).trim()
    if (sgid) {
      return `<bc-attachment sgid="${escapeHtmlAttr(sgid)}"></bc-attachment>`
    }
    const cleanName = normalizeMentionLabel(stripTagsToPlainText(inner))
    return `<strong>@${escapeHtmlText(cleanName)}</strong>`
  })

  // 4. Replicated file attachment blocks (<p data-teg-attachment="true"><a ... data-orig-bc-sgid="X">...</a></p>)
  out = out.replace(
    /<p\b[^>]*\bdata-teg-attachment\s*=\s*(?:["']true["']|true\b)[^>]*>\s*<a\b([^>]*)>[\s\S]*?<\/a>\s*<\/p>/gi,
    (full, aAttrs) => {
      const origSgid = unescapeHtmlEntities(extractAttrFromTag(aAttrs, 'data-orig-bc-sgid')).trim()
      if (!origSgid) return full
      return `<bc-attachment sgid="${escapeHtmlAttr(origSgid)}"></bc-attachment>`
    }
  )

  // 5. Replicated standalone <video ... data-orig-bc-sgid="X">...</video>
  out = out.replace(/<video\b([^>]*)>[\s\S]*?<\/video>/gi, (full, videoAttrs) => {
    const origSgid = unescapeHtmlEntities(extractAttrFromTag(videoAttrs, 'data-orig-bc-sgid')).trim()
    if (!origSgid) return full
    return `<bc-attachment sgid="${escapeHtmlAttr(origSgid)}"></bc-attachment>`
  })

  // 6. Standalone <a ... data-orig-bc-sgid="X">...</a>
  out = out.replace(/<a\b([^>]*)>[\s\S]*?<\/a>/gi, (full, aAttrs) => {
    const origSgid = unescapeHtmlEntities(extractAttrFromTag(aAttrs, 'data-orig-bc-sgid')).trim()
    if (!origSgid) return full
    return `<bc-attachment sgid="${escapeHtmlAttr(origSgid)}"></bc-attachment>`
  })

  // 7. Replicated <figure><img ... data-orig-bc-sgid="X">...</figure> and standalone <img ... data-orig-bc-sgid="X">
  out = out.replace(
    /<figure\b[^>]*>\s*<img\b([^>]*?)\/?>\s*(?:<figcaption\b[^>]*>[\s\S]*?<\/figcaption>\s*)?<\/figure>/gi,
    (full, imgAttrs) => {
      const origSgid = unescapeHtmlEntities(extractAttrFromTag(imgAttrs, 'data-orig-bc-sgid')).trim()
      if (!origSgid) return full
      return `<bc-attachment sgid="${escapeHtmlAttr(origSgid)}"></bc-attachment>`
    }
  )
  out = out.replace(/<img\b([^>]*?)\/?>/gi, (full, imgAttrs) => {
    const origSgid = unescapeHtmlEntities(extractAttrFromTag(imgAttrs, 'data-orig-bc-sgid')).trim()
    if (!origSgid) return full
    return `<bc-attachment sgid="${escapeHtmlAttr(origSgid)}"></bc-attachment>`
  })

  return out
}

/**
 * Extracts all mentioned people identifiers from Basecamp/TEG HTML:
 * - `personUuids` from `data-teg-mention-person-id`
 * - `bcPersonIds` from `data-avatar-for-person-id`, `gid://bc3/Person/(\d+)`, and decoded mention `sgid`s
 * - `sgids` from mention `<bc-attachment sgid="...">` tags
 */
export function extractMentionedPeopleRefs(html?: string | null): {
  personUuids: string[]
  bcPersonIds: number[]
  sgids: string[]
} {
  if (!html || typeof html !== 'string') {
    return { personUuids: [], bcPersonIds: [], sgids: [] }
  }

  const personUuids = new Set<string>()
  const bcPersonIds = new Set<number>()
  const sgids = new Set<string>()

  // 1. Direct TEG UUIDs (`data-teg-mention-person-id="..."`)
  const uuidRegex = /\bdata-teg-mention-person-id\s*=\s*(["'])([^"']+)\1/gi
  let m: RegExpExecArray | null
  while ((m = uuidRegex.exec(html)) !== null) {
    const val = m[2]?.trim()
    if (val) personUuids.add(val)
  }

  // 2. Basecamp avatar person IDs (`data-avatar-for-person-id="34962132"`)
  const avatarIdRegex = /\bdata-avatar-for-person-id\s*=\s*(?:["'](\d+)["']|(\d+))/gi
  while ((m = avatarIdRegex.exec(html)) !== null) {
    const n = Number(m[1] || m[2])
    if (Number.isFinite(n) && n > 0) bcPersonIds.add(n)
  }

  // 3. Basecamp Global IDs (`gid://bc3/Person/34962132`, including inside escaped `content` attributes)
  const gidRegex = /gid:\/\/bc3\/Person\/(\d+)/gi
  while ((m = gidRegex.exec(html)) !== null) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) bcPersonIds.add(n)
  }

  // 4. Mention `<bc-attachment>` SGIDs (and Person GIDs encoded inside Rails SignedGlobalID)
  const bcTagRegex = /<bc-attachment\b([^>]*)>/gi
  while ((m = bcTagRegex.exec(html)) !== null) {
    const attrs = m[1] || ''
    const sgidMatch = attrs.match(/\bsgid\s*=\s*(["'])([^"']+)\1/i)
    const sgid = sgidMatch?.[2]?.trim() || ''
    if (!sgid) continue

    const decoded = decodeSgidPayload(sgid)
    const decodedPersonMatch = decoded.match(/gid:\/\/bc3\/Person\/(\d+)/i)
    const isPersonSgid = Boolean(decodedPersonMatch?.[1])

    if (isBasecampMentionAttachment(attrs) || isPersonSgid) {
      sgids.add(sgid)
      if (decodedPersonMatch?.[1]) {
        const n = Number(decodedPersonMatch[1])
        if (Number.isFinite(n) && n > 0) bcPersonIds.add(n)
      }
    }
  }

  // 5. Optional `data-bc-sgid` on span elements
  const spanSgidRegex = /\bdata-bc-sgid\s*=\s*(["'])([^"']+)\1/gi
  while ((m = spanSgidRegex.exec(html)) !== null) {
    const sgid = m[2]?.trim()
    if (!sgid) continue
    sgids.add(sgid)
    const decoded = decodeSgidPayload(sgid)
    const decodedPersonMatch = decoded.match(/gid:\/\/bc3\/Person\/(\d+)/i)
    if (decodedPersonMatch?.[1]) {
      const n = Number(decodedPersonMatch[1])
      if (Number.isFinite(n) && n > 0) bcPersonIds.add(n)
    }
  }

  return {
    personUuids: Array.from(personUuids),
    bcPersonIds: Array.from(bcPersonIds),
    sgids: Array.from(sgids),
  }
}

/**
 * Checks whether an HTML fragment contains visible text, inline images, videos, attachments, `@mentions`, or tables.
 */
export function hasRichContentOrMedia(html?: string | null): boolean {
  if (!html || typeof html !== 'string') return false

  if (
    /<img\b/i.test(html) ||
    /<video\b/i.test(html) ||
    /<source\b/i.test(html) ||
    /<bc-attachment\b/i.test(html) ||
    /\bdata-teg-attachment\b/i.test(html) ||
    /\bdata-orig-bc-sgid\b/i.test(html) ||
    /\bdata-teg-mention-person-id\b/i.test(html) ||
    /\bdata-bc-mention\b/i.test(html) ||
    /<table\b/i.test(html)
  ) {
    return true
  }

  const plain = unescapeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[\u00a0\u200b]+/g, ' ')
    .trim()

  return plain.length > 0
}

/**
 * Decodes HTML numeric/hex entities and strips control/whitespace characters for URI scheme inspection.
 */
function decodeUriForSchemeCheck(rawVal: string): string {
  return String(rawVal)
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => {
      const code = parseInt(hex, 16)
      return safeCodePointToChar(code, true)
    })
    .replace(/&#(\d+);?/g, (_m, dec) => {
      const code = parseInt(dec, 10)
      return safeCodePointToChar(code, true)
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
 * `preview.3.basecamp.com`, `storage.3.basecamp.com`, `3.basecampapi.com`) and legacy synced video URLs
 * under `checklist-photos/basecamp-attachments/` (whose stored object may be a JPEG poster while
 * `bc_attachment_cache` holds the real Basecamp video blob) to `/api/basecamp/attachment?url=...`.
 * Leaves `checklist-photos/basecamp-uploads/` and other safe URLs intact. Blocks dangerous URI schemes.
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
    const host = parsed.hostname.toLowerCase()
    if (parsed.protocol === 'https:') {
      if (BASECAMP_PROXYABLE_HOSTS.has(host)) {
        return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
      }
      if (
        host.endsWith('.supabase.co') &&
        parsed.pathname.startsWith('/storage/v1/object/public/checklist-photos/basecamp-attachments/') &&
        isVideoMimeOrFilename(null, null, parsed.pathname)
      ) {
        return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
      }
    }
  } catch {
    // Relative path or non-standard URL — leave intact since dangerous schemes were already filtered
  }

  return trimmed
}

function sanitizeOpeningTagAttributes(tagPrefix: string, rawAttrs: string | undefined): string {
  if (!rawAttrs) return `${tagPrefix}>`
  const n = rawAttrs.length
  let i = 0
  let isSelfClosing = false
  const outAttrs: string[] = []

  while (i < n) {
    while (i < n && /[\s/]/.test(rawAttrs[i])) {
      if (rawAttrs[i] === '/') {
        const rest = rawAttrs.slice(i + 1).trim()
        if (rest.length === 0) isSelfClosing = true
      }
      i++
    }
    if (i >= n) break

    if (rawAttrs[i] === '"' || rawAttrs[i] === "'" || rawAttrs[i] === '=') {
      i++
      continue
    }

    const nameStart = i
    while (i < n && !/[\s/=>"']/.test(rawAttrs[i])) {
      i++
    }
    const rawName = rawAttrs.slice(nameStart, i)
    if (!rawName || !/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/.test(rawName)) {
      continue
    }
    const attrLower = rawName.toLowerCase()

    while (i < n && /\s/.test(rawAttrs[i])) i++

    let hasValue = false
    let quoteChar: '"' | "'" | '' = ''
    let rawVal = ''

    if (i < n && rawAttrs[i] === '=') {
      hasValue = true
      i++
      while (i < n && /\s/.test(rawAttrs[i])) i++
      if (i < n && (rawAttrs[i] === '"' || rawAttrs[i] === "'")) {
        quoteChar = rawAttrs[i] as '"' | "'"
        i++
        const valStart = i
        while (i < n && rawAttrs[i] !== quoteChar) i++
        rawVal = rawAttrs.slice(valStart, i)
        if (i < n && rawAttrs[i] === quoteChar) i++
      } else {
        const valStart = i
        while (i < n && !/[\s/>]/.test(rawAttrs[i])) i++
        rawVal = rawAttrs.slice(valStart, i)
      }
    }

    if (
      attrLower.startsWith('on') ||
      attrLower === 'srcdoc' ||
      attrLower === 'formaction' ||
      attrLower === 'xlink:href'
    ) {
      continue
    }

    if (
      attrLower === 'href' ||
      attrLower === 'src' ||
      attrLower === 'poster' ||
      attrLower === 'action' ||
      attrLower === 'data'
    ) {
      if (isDangerousScheme(rawVal)) {
        if (attrLower === 'href') {
          outAttrs.push(` ${rawName}="#"`)
        }
        continue
      }
    }

    if (attrLower === 'style' && hasValue) {
      const decodedStyle = decodeUriForSchemeCheck(rawVal)
      if (
        decodedStyle.includes('javascript:') ||
        decodedStyle.includes('vbscript:') ||
        decodedStyle.includes('expression(')
      ) {
        continue
      }
    }

    if (!hasValue) {
      outAttrs.push(` ${rawName}`)
    } else if (quoteChar === "'") {
      outAttrs.push(` ${rawName}='${rawVal.replace(/'/g, '&#39;').replace(/>/g, '&gt;')}'`)
    } else {
      outAttrs.push(` ${rawName}="${rawVal.replace(/"/g, '&quot;').replace(/>/g, '&gt;')}"`)
    }
  }

  return `${tagPrefix}${outAttrs.join('')}${isSelfClosing ? ' /' : ''}>`
}

/**
 * Sanitizes Basecamp Trix HTML against XSS vectors (dangerous tags, inline `on*` event handlers,
 * `srcdoc`, delimiterless attributes after quotes or `/`, and `javascript:`/`vbscript:`/`data:` URIs)
 * while preserving safe formatting tags, `<bc-attachment>`, `<video>` / `<source>` (`controls`,
 * `preload`, `playsinline`, `src`, `style`, `data-orig-bc-sgid`), images, tables, lists, and links.
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
        /<\s*\/?\s*(script|iframe|object|embed|form|applet|meta|link|style|base|svg|math|template|input|button|textarea|select)\b(?:(?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/gi,
        ''
      )
  }

  clean = clean.replace(
    /(<\s*[a-zA-Z][a-zA-Z0-9:-]*)((?:[\s/](?:(?:"[^"]*"|'[^']*'|[^>"'])*))?)>/g,
    (_full, tagPrefix: string, rawAttrs: string | undefined) =>
      sanitizeOpeningTagAttributes(tagPrefix, rawAttrs)
  )

  return clean
}

/**
 * Strips TEG author attribution banners, converts Basecamp/TEG `@mentions` into `.bc-mention-pill` spans,
 * removes `srcset`, rewrites Basecamp `<img>` / `<video>` / `<source>` `src` and `<a>` `href` URLs
 * (across `preview.app.basecamp.com`, `storage.app.basecamp.com`, `preview.3.basecamp.com`,
 * `storage.3.basecamp.com`, and `3.basecampapi.com`), and sanitizes dangerous HTML tags/attributes.
 */
export function rewriteBasecampHtmlUrls(html?: string | null): string {
  if (!html || typeof html !== 'string') return ''

  // 1. Strip Basecamp-mirrored TEG author banner (<p data-teg-author=...> / Solicitado por:)
  const { cleanHtml } = stripTegAuthorBanner(html)
  if (!cleanHtml) return ''

  // 2. Transform Basecamp 3/4 and TEG @mentions into clean pills before stripping/rewriting tags
  const withPills = transformBasecampMentionsToPills(cleanHtml)

  // 3. Remove srcset and rewrite Basecamp image/video/link URLs matching up to closing quote
  const rewritten = rewriteBasecampMediaAndLinks(withPills)

  // 4. Sanitize dangerous tags, event handlers, and URI schemes
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

  const genericSegs = new Set(['image', 'full', 'preview', 'card', 'gallery', 'lightbox'])

  const deriveFilename = (): string => {
    const fn = safeDecodeFilename(rawFilename || '').trim()
    if (fn && !genericSegs.has(fn.toLowerCase())) return fn
    try {
      const target = trimmed.startsWith('/api/basecamp/attachment?')
        ? new URLSearchParams(trimmed.split('?')[1] || '').get('url') || trimmed
        : trimmed
      const last = target.split('/').pop()?.split('?')[0] || ''
      const dec = safeDecodeFilename(last)
      if (dec && !genericSegs.has(dec.toLowerCase())) return dec
    } catch {
      // ignore
    }
    return isVideoMimeOrFilename(null, rawFilename, trimmed) ? 'video' : 'imagen'
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

function isAvatarImageAttrs(attrsStr: string): boolean {
  const s = String(attrsStr || '')
  if (/\bdata-avatar-for-person-id\b/i.test(s) || /\bdata-bc-avatar\b/i.test(s)) {
    return true
  }
  const quotedClassMatch = s.match(/\bclass\s*=\s*(["'])([^"']*)\1/i)
  if (quotedClassMatch?.[2] && /\bavatar\b/i.test(quotedClassMatch[2])) {
    return true
  }
  if (/\bclass\s*=\s*avatar(?:\s|$)/i.test(s)) {
    return true
  }
  return false
}

/**
 * Wraps every content `<img>` in sanitized Basecamp HTML inside a `.bc-img-frame` container with a hoverable
 * 1-click download button (`a[data-bc-download="true"]`), while excluding mini-avatars (`class="avatar"`,
 * `data-avatar-for-person-id`, `data-bc-avatar`) and preserving click-to-zoom on content images.
 */
export function injectImageDownloadOverlays(sanitizedHtml: string, downloadLabel: string = '⬇ Descargar'): string {
  if (!sanitizedHtml || !/<img\b/i.test(sanitizedHtml)) return sanitizedHtml
  const safeLabel = downloadLabel
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  return sanitizedHtml.replace(/<img\b([^>]*)>/gi, (fullImg, attrs) => {
    const attrStr = String(attrs || '')
    if (isAvatarImageAttrs(attrStr)) return fullImg

    const srcMatch = attrStr.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)
    const rawSrc = srcMatch?.[2] || ''
    if (!rawSrc) return fullImg
    const altMatch = attrStr.match(/\balt\s*=\s*(["'])([^"']*)\1/i)
    const rawAlt = altMatch?.[2] || ''
    const dlHref = buildBasecampDirectDownloadHref(rawSrc, rawAlt).replace(/"/g, '&quot;')
    const escSrc = rawSrc.replace(/"/g, '&quot;')
    const escAlt = rawAlt.replace(/"/g, '&quot;')
    return `<span class="bc-img-frame">${fullImg}<a href="${dlHref}" data-bc-download="true" data-bc-src="${escSrc}" data-bc-filename="${escAlt}" class="bc-img-dl-btn" title="${safeLabel}">${safeLabel}</a></span>`
  })
}

export const BASECAMP_IMAGE_HOVER_CSS = `
  .bc-mention-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 8px;
    margin: 0 1px;
    border-radius: 9999px;
    background-color: #DBEAFE;
    color: #1D4ED8 !important;
    border: 1px solid #BFDBFE;
    font-size: 0.92em;
    font-weight: 600;
    line-height: 1.45;
    white-space: nowrap;
    vertical-align: baseline;
    text-decoration: none !important;
  }
  .dark .bc-mention-pill,
  [data-theme="dark"] .bc-mention-pill {
    background-color: rgba(37, 99, 235, 0.26);
    color: #93C5FD !important;
    border-color: rgba(96, 165, 250, 0.42);
  }
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

export type CanonicalBasecampDockTool =
  | 'todoset'
  | 'message_board'
  | 'chat'
  | 'vault'
  | 'schedule'
  | 'questionnaire'

export const ALL_CANONICAL_DOCK_TOOLS: CanonicalBasecampDockTool[] = [
  'todoset',
  'message_board',
  'chat',
  'vault',
  'schedule',
  'questionnaire',
]

const RAW_TOOL_TO_CANONICAL_DOCK: Record<string, CanonicalBasecampDockTool> = {
  todoset: 'todoset',
  todos: 'todoset',
  todo: 'todoset',
  todolist: 'todoset',
  todolists: 'todoset',
  message_board: 'message_board',
  'message-board': 'message_board',
  messages: 'message_board',
  message: 'message_board',
  chat: 'chat',
  chats: 'chat',
  campfire: 'chat',
  vault: 'vault',
  docs: 'vault',
  doc: 'vault',
  documents: 'vault',
  schedule: 'schedule',
  calendar: 'schedule',
  questionnaire: 'questionnaire',
  checkins: 'questionnaire',
  checkin: 'questionnaire',
}

export function normalizeEnabledProjectTools(rawTools?: string[] | null): CanonicalBasecampDockTool[] {
  if (!Array.isArray(rawTools) || rawTools.length === 0) {
    return [...ALL_CANONICAL_DOCK_TOOLS]
  }
  const seen = new Set<CanonicalBasecampDockTool>()
  const out: CanonicalBasecampDockTool[] = []
  for (const item of rawTools) {
    const mapped = RAW_TOOL_TO_CANONICAL_DOCK[String(item || '').toLowerCase().trim()]
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped)
      out.push(mapped)
    }
  }
  return out.length > 0 ? out : [...ALL_CANONICAL_DOCK_TOOLS]
}

export function isManagerOrSupervisorBcPerson(person?: {
  role?: string | null
  title?: string | null
}): boolean {
  if (!person) return false
  const probe = `${person.role || ''} ${person.title || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return /\b(admin|administrador|supervisor|regional_manager|regional manager|general_manager|general manager|manager|gerente)\b/.test(
    probe
  )
}

export function canUserAccessBasecampProject(
  project: {
    people?: Array<{ id?: string | null; email?: string | null }> | null
    memberPersonIds?: string[] | null
  } | null | undefined,
  opts: {
    isAdmin: boolean
    resolvedPersonId?: string | null
    canonicalEmail?: string | null
  }
): boolean {
  if (!project) return false
  if (opts.isAdmin) return true
  const pid = (opts.resolvedPersonId || '').trim()
  const cleanEmail = canonicalizeBasecampEmail(opts.canonicalEmail)
  if (pid && Array.isArray(project.memberPersonIds) && project.memberPersonIds.includes(pid)) {
    return true
  }
  const members = Array.isArray(project.people) ? project.people : []
  return members.some((m) => {
    if (pid && m?.id === pid) return true
    if (cleanEmail && !isMaskedOrEmptyEmail(m?.email) && canonicalizeBasecampEmail(m?.email) === cleanEmail) {
      return true
    }
    return false
  })
}

export type InterceptedBasecampLink =
  | {
      kind: 'bc_bucket'
      projectBcId: string
      resourceType: 'todos' | 'messages' | 'documents' | 'todolists' | null
      itemBcId: string | null
    }
  | {
      kind: 'teg_deeplink'
      project: string
      tool?: string
      todoId?: string
      messageId?: string
      docId?: string
    }

export function parseInterceptableBasecampHref(rawHref?: string | null): InterceptedBasecampLink | null {
  if (!rawHref || typeof rawHref !== 'string') return null
  const trimmed = rawHref.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return null
  }
  if (trimmed.startsWith('/api/basecamp/')) return null

  const bucketMatch = trimmed.match(
    /^https?:\/\/(?:app|3)\.basecamp\.com\/\d+\/buckets\/(\d+)(?:\/(todos|messages|documents|todolists)\/(\d+))?(?:[/?#].*)?$/i
  )
  if (bucketMatch) {
    return {
      kind: 'bc_bucket',
      projectBcId: bucketMatch[1],
      resourceType: bucketMatch[2]
        ? (bucketMatch[2].toLowerCase() as 'todos' | 'messages' | 'documents' | 'todolists')
        : null,
      itemBcId: bucketMatch[3] || null,
    }
  }

  try {
    const parsed = trimmed.startsWith('/')
      ? new URL(trimmed, 'https://tacosgavilan.vercel.app')
      : new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    const isSameBasecampRoute =
      parsed.pathname === '/basecamp' &&
      (trimmed.startsWith('/basecamp') ||
        host === 'tacosgavilan.vercel.app' ||
        (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase()))
    if (isSameBasecampRoute) {
      const proj = parsed.searchParams.get('project')?.trim() || ''
      if (proj) {
        return {
          kind: 'teg_deeplink',
          project: proj,
          tool: parsed.searchParams.get('tool')?.trim() || undefined,
          todoId: parsed.searchParams.get('todoId')?.trim() || undefined,
          messageId: parsed.searchParams.get('messageId')?.trim() || undefined,
          docId: parsed.searchParams.get('docId')?.trim() || undefined,
        }
      }
    }
  } catch {
    // Non-URL
  }

  return null
}

export function buildBasecampJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    try {
      const token = window.localStorage?.getItem('teg_token')
      if (token) headers['Authorization'] = `Bearer ${token}`
    } catch {
      // Ignore storage access errors
    }
  }
  return headers
}
