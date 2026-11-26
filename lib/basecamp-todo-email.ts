/**
 * @module lib/basecamp-todo-email
 * @description Motor centralizado de notificaciones por correo electrónico y bandeja interna (`bc_notifications`)
 *              para tareas, casos, pedidos (To-Dos), anuncios (`Message Board`) y menciones (`@Nombre`) del módulo
 *              Basecamp de Tacos Gavilan.
 *              - Para To-Dos (`sendBasecampTodoNotificationEmail`): notifica a asignados, creador/solicitante,
 *                participantes en comentarios, suscriptores al completar y personas `@mencionadas`.
 *              - Para Anuncios (`sendBasecampMessageNotificationEmail`): soporta `published` (`notifyMode: 'all' | 'selected' | 'none'`),
 *                `updated` (solo `@mencionados`) y `commented` (autor del anuncio + `@mencionados` en el comentario,
 *                evitando spam masivo a sucursales en respuestas cortas).
 *
 * @businessRules
 * - Marca oficial exclusiva: **Tacos Gavilan** (jamás "Tacos El Gavilan").
 * - Personas involucradas en un To-Do:
 *   1) Personas asignadas (`bc_todo_assignees` -> `bc_people`).
 *   2) Creador / solicitante original del caso o pedido (`bc_todos.created_by_person_id` -> `bc_people`).
 *   3) Participantes que hayan comentado previamente en el hilo (`bc_comments` `parent_type = 'todo'`).
 *   4) Personas `@mencionadas` en `commentHtml` o `todo.description` (vía `data-teg-mention-person-id`,
 *      `data-avatar-for-person-id`, `gid://bc3/Person/{bc_id}`, y `bc_people.attachable_sgid`).
 *   5) En `completed`, personas en `bc_todos.completion_subscriber_ids` (`When done` heredados de Basecamp 3).
 * - Píldoras `@Nombre` en correos HTML:
 *   * `cleanRichHtmlForEmail` NUNCA elimina menciones (`application/vnd.basecamp.mention` ni `data-teg-mention-person-id`);
 *     las convierte en píldoras azules legibles compatibles con clientes de correo (Gmail/Outlook/Apple Mail).
 * - Notificaciones In-App (`bc_notifications`):
 *   * `createBasecampInAppNotifications` inserta filas con `recording_type: 'todo' | 'message' | 'document'`
 *     y `recording_id: <UUID del padre>` para navegación directa desde `NewForYouDrawer` (`Hey!`).
 * - Prevención de auto-spam:
 *   * Excluye al actor en comentarios, actualizaciones, menciones y cambios de estado.
 * - Zona horaria oficial: `America/Los_Angeles`.
 *
 * @dataFlow
 * - `/api/basecamp/action` y `/api/basecamp/webhook` -> `sendBasecampTodoNotificationEmail()` + `createBasecampInAppNotifications()`
 *   -> Supabase (`bc_todos`, `bc_todo_assignees`, `bc_comments`, `bc_people`, `users`, `bc_notifications`) -> `sendSystemEmail()`.
 *
 * @notes
 * - Operación no bloqueante (best-effort): cualquier error SMTP o de notificación secundaria se registra en logs
 *   sin interrumpir la transacción principal.
 * - Resolución de imágenes públicas para Gmail (`resolvePublicImagesForEmailHtml`): el proxy de imágenes de Gmail
 *   (`googleusercontent.com`) no envía cookies `teg_token` a `/api/basecamp/attachment` (recibiendo `401`).
 *   Antes de construir cada correo HTML, todas las etiquetas `<img>` que apunten a `/api/basecamp/attachment?url=...`
 *   o a hosts privados de Basecamp se resuelven a URLs públicas HTTPS en Supabase Storage (`checklist-photos`),
 *   consultando `bc_attachment_cache` (Paso A) o descargando vía OAuth -> S3 y subiendo a `basecamp-email-cache/` (Paso B).
 * - Resolución canónica de dominio (`resolveAppBaseUrl`): prioriza `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`,
 *   `VERCEL_PROJECT_PRODUCTION_URL` y `originHint` HTTPS público (excluyendo `localhost`/`127.0.0.1`), con fallback
 *   oficial de producción en `https://tacosgavilan.vercel.app`.
 */

import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSystemEmail } from '@/lib/system-mailer'
import { stripStoreNumberTokensInText } from '@/lib/store-display'
import { getValidToken, assertSafeBasecampApiUrl } from '@/lib/basecamp-api'
import {
  canonicalizeBasecampEmail,
  canonicalizeBasecampDisplayName,
  isMaskedOrEmptyEmail,
  normalizePersonName,
  stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import { sanitizeBasecampHtml, safeDecodeFilename } from '@/lib/basecamp-html'
import {
  loadEmailDeliverabilityContext,
  resolveSingleRecipientEmail,
} from '@/lib/email-recipient-guard'

export type BasecampTodoEmailEvent = 'assigned' | 'commented' | 'completed' | 'reopened' | 'updated'
export type BasecampMessageEmailEvent = 'published' | 'updated' | 'commented'
export type BasecampMessageNotifyMode = 'all' | 'selected' | 'none'

export interface SendBasecampMessageEmailParams {
  event: BasecampMessageEmailEvent
  messageDbId: string
  actorPersonId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  commentHtml?: string | null
  notifyMode?: BasecampMessageNotifyMode
  selectedPersonIds?: string[]
  appOrigin?: string | null
  overrideRecipients?: string[]
  /** Optional: restrict @mentioned person IDs (e.g. only newly mentioned on edit) */
  mentionedPersonIdsOverride?: string[]
  /** Optional: on edited comment, notify only newly mentioned people without re-emailing author */
  onlyMentionedOnComment?: boolean
  /** Optional: skip inserting bc_notifications if caller already inserted them */
  skipInAppNotifications?: boolean
}

export interface SendBasecampMessageEmailResult {
  sent: boolean
  recipients: string[]
  notifiedPersonIds?: string[]
  inAppInsertedCount?: number
  messageId?: string
  skippedReason?: string
}

export interface SendBasecampTodoEmailParams {
  event: BasecampTodoEmailEvent
  todoDbId: string
  actorPersonId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  commentHtml?: string | null
  appOrigin?: string | null
  /** Exclude actor even on 'assigned' when triggered from update_todo */
  excludeActorOnAssigned?: boolean
  /** Optional explicit recipient override strictly for automated smoke tests */
  overrideRecipients?: string[]
}

export interface SendBasecampTodoEmailResult {
  sent: boolean
  recipients: string[]
  messageId?: string
  skippedReason?: string
}

export interface BasecampPersonLookupRow {
  id: string
  bc_id?: number | string | null
  name?: string | null
  email?: string | null
  is_active?: boolean | null
  attachable_sgid?: string | null
}

export interface CreateBasecampInAppNotificationsParams {
  projectUuid: string
  recordingType: 'todo' | 'message' | 'document'
  /** UUID of parent bc_todos.id, bc_messages.id, or bc_documents.id */
  recordingUuid: string
  actorPersonId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  title: string
  rawHtml?: string | null
  mentionedPersonIds?: string[]
  assignedPersonIds?: string[]
  involvedPersonIds?: string[]
  defaultType: 'mention' | 'assigned' | 'comment' | 'completed' | 'message'
  /** Allow actor in explicit selections (e.g. notifyMode === 'selected') */
  allowActorInTargets?: boolean
}

const VALID_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

const EMAIL_MENTION_PILL_STYLE =
  'display:inline-block;padding:1px 7px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-weight:700;'

// Equivalent emails belonging to the same operator so self-actions don't self-notify
const ACTOR_EQUIVALENT_EMAIL_GROUPS: string[][] = [
  ['carlos@tacosgavilan.com', 'roque@tacosgavilan.com'],
  ['alejandro@tacosgavilan.com', 'alex@tacosgavilan.com'],
  ['yasmin@tacosgavilan.com', 'ap@tacosgavilan.com'],
]

function getEquivalentActorEmails(rawEmail?: string | null): Set<string> {
  const set = new Set<string>()
  const clean = (rawEmail || '').trim().toLowerCase()
  const canonical = canonicalizeBasecampEmail(rawEmail)
  if (!clean && !canonical) return set
  if (clean) set.add(clean)
  if (canonical) set.add(canonical)
  for (const group of ACTOR_EQUIVALENT_EMAIL_GROUPS) {
    if ((clean && group.includes(clean)) || (canonical && group.includes(canonical))) {
      for (const e of group) set.add(e)
    }
  }
  return set
}

function escapeHtml(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function decodeHtmlEntities(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/**
 * Attempts to extract a Basecamp 3 Person numeric `bc_id` embedded inside a Rails `attachable_sgid`
 * (`BAh7...--signature` -> Base64 payload contains `gid://bc3/Person/34962132`).
 */
export function extractBcPersonIdFromSgid(sgid?: string | null): number | null {
  if (!sgid || typeof sgid !== 'string') return null
  const b64Part = sgid.split('--')[0]?.trim()
  if (!b64Part) return null
  try {
    const decoded = Buffer.from(b64Part, 'base64').toString('utf8')
    const m = decoded.match(/gid:\/\/bc3\/Person\/(\d+)/)
    if (m?.[1]) {
      const id = Number(m[1])
      return Number.isFinite(id) && id > 0 ? id : null
    }
  } catch {
    // Ignore malformed base64
  }
  return null
}

function getAttrFromTagAttrs(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))
  return m ? m[2] : ''
}

function isMentionAttachmentAttrs(attrs: string): boolean {
  const ct = getAttrFromTagAttrs(attrs, 'content-type').trim().toLowerCase()
  if (ct === 'application/vnd.basecamp.mention') return true
  if (/\bdata-teg-mention-person-id\s*=/i.test(attrs)) return true
  const sgid = getAttrFromTagAttrs(attrs, 'sgid')
  return extractBcPersonIdFromSgid(sgid) !== null
}

function resolveMentionLabel(
  attrs: string,
  innerHtml: string,
  peopleLookup?: {
    byUuid: Map<string, BasecampPersonLookupRow>
    byBcId: Map<number, BasecampPersonLookupRow>
    bySgid: Map<string, BasecampPersonLookupRow>
  }
): string {
  let candidate = ''

  const figCapMatch = innerHtml.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)
  if (figCapMatch?.[1]) {
    candidate = decodeHtmlEntities(figCapMatch[1].replace(/<[^>]*>/g, '')).trim()
  }

  if (!candidate) {
    const altMatch = (innerHtml + ' ' + attrs).match(/\balt\s*=\s*(["'])([^"']+)\1/i)
    if (altMatch?.[2]) {
      candidate = decodeHtmlEntities(altMatch[2]).trim()
    }
  }

  if (!candidate) {
    const rawContentAttr = getAttrFromTagAttrs(attrs, 'content')
    if (rawContentAttr) {
      const unescaped = decodeHtmlEntities(rawContentAttr)
      candidate = decodeHtmlEntities(unescaped.replace(/<[^>]*>/g, '')).trim()
    }
  }

  if (!candidate && innerHtml) {
    candidate = decodeHtmlEntities(innerHtml.replace(/<[^>]*>/g, '')).trim()
  }

  if (!candidate && peopleLookup) {
    const uuid = getAttrFromTagAttrs(attrs, 'data-teg-mention-person-id').trim()
    if (uuid && peopleLookup.byUuid.has(uuid)) {
      candidate = peopleLookup.byUuid.get(uuid)?.name || ''
    }
    if (!candidate) {
      const sgid = getAttrFromTagAttrs(attrs, 'sgid').trim()
      if (sgid && peopleLookup.bySgid.has(sgid)) {
        candidate = peopleLookup.bySgid.get(sgid)?.name || ''
      }
      const sgidBcId = extractBcPersonIdFromSgid(sgid)
      if (!candidate && sgidBcId && peopleLookup.byBcId.has(sgidBcId)) {
        candidate = peopleLookup.byBcId.get(sgidBcId)?.name || ''
      }
    }
  }

  const normalized = candidate.replace(/^@+/, '').replace(/\s+/g, ' ').trim()
  return normalized || 'Usuario'
}

function buildPeopleLookupMaps(allPeople?: BasecampPersonLookupRow[]) {
  const byUuid = new Map<string, BasecampPersonLookupRow>()
  const byBcId = new Map<number, BasecampPersonLookupRow>()
  const bySgid = new Map<string, BasecampPersonLookupRow>()
  for (const p of allPeople || []) {
    if (p.id) byUuid.set(p.id, p)
    if (p.bc_id != null && Number.isFinite(Number(p.bc_id))) {
      byBcId.set(Number(p.bc_id), p)
    }
    if (p.attachable_sgid) {
      bySgid.set(String(p.attachable_sgid).trim(), p)
    }
  }
  return { byUuid, byBcId, bySgid }
}

/**
 * Extracts all `@mentioned` people from Basecamp/TEG Rich HTML using:
 * 1) `data-teg-mention-person-id="<uuid>"`
 * 2) `data-avatar-for-person-id="<bc_id>"`
 * 3) `gid://bc3/Person/<bc_id>` (raw or entity-encoded)
 * 4) `sgid="..."` matched against `bc_people.attachable_sgid` AND Base64-decoded `gid://bc3/Person/<bc_id>`
 */
export function extractMentionedPeopleFromHtml<T extends BasecampPersonLookupRow>(
  html: string | null | undefined,
  allPeople: T[]
): T[] {
  if (!html || typeof html !== 'string' || !Array.isArray(allPeople) || allPeople.length === 0) {
    return []
  }

  const { byUuid, byBcId, bySgid } = buildPeopleLookupMaps(allPeople)
  const matchedById = new Map<string, T>()

  const addPerson = (p?: BasecampPersonLookupRow | null) => {
    if (p?.id && !matchedById.has(p.id)) {
      matchedById.set(p.id, p as T)
    }
  }

  // 1. Direct TEG UUID mentions
  const uuidRegex = /data-teg-mention-person-id\s*=\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi
  let m: RegExpExecArray | null
  while ((m = uuidRegex.exec(html)) !== null) {
    addPerson(byUuid.get(m[1]))
  }

  // 2. Basecamp avatar person IDs
  const avatarIdRegex = /data-avatar-for-person-id\s*=\s*["'](\d+)["']/gi
  while ((m = avatarIdRegex.exec(html)) !== null) {
    addPerson(byBcId.get(Number(m[1])))
  }

  // 3. gid://bc3/Person/{bc_id} (both raw and HTML-escaped inside content="...")
  const decodedHtml = decodeHtmlEntities(html)
  const gidRegex = /gid:\/\/bc3\/Person\/(\d+)/g
  while ((m = gidRegex.exec(decodedHtml)) !== null) {
    addPerson(byBcId.get(Number(m[1])))
  }

  // 4. <bc-attachment ... sgid="..."> mention attachments
  const bcAttTagRegex = /<bc-attachment\b([^>]*?)(?:\/>|>[\s\S]*?<\/bc-attachment>)/gi
  while ((m = bcAttTagRegex.exec(html)) !== null) {
    const attrs = m[1] || ''
    if (!isMentionAttachmentAttrs(attrs)) continue
    const sgid = getAttrFromTagAttrs(attrs, 'sgid').trim()
    if (sgid) {
      addPerson(bySgid.get(sgid))
      const bcIdFromSgid = extractBcPersonIdFromSgid(sgid)
      if (bcIdFromSgid) addPerson(byBcId.get(bcIdFromSgid))
    }
  }

  return Array.from(matchedById.values())
}

export function extractMentionedPersonIds(
  html: string | null | undefined,
  allPeople: BasecampPersonLookupRow[]
): string[] {
  return extractMentionedPeopleFromHtml(html, allPeople).map((p) => p.id)
}

/**
 * Converts outbound mention markup into Basecamp 3's official Rich Text format BEFORE sending to Basecamp API:
 * - `<bc-attachment sgid="X" content-type="application/vnd.basecamp.mention"...>...</bc-attachment>` -> `<bc-attachment sgid="X"></bc-attachment>`
 * - Synthetic TEG mentions (`<span data-teg-mention-person-id="...">@Nombre</span>` or mention without sgid) -> `<strong>@Nombre</strong>`
 */
export function convertMentionsForBasecampOutbound(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') return ''

  let out = html
    .replace(/<bc-attachment\b([^>]*?)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs, inner) => {
      if (!isMentionAttachmentAttrs(attrs)) return full
      const sgid = getAttrFromTagAttrs(attrs, 'sgid').trim()
      if (sgid) {
        return `<bc-attachment sgid="${sgid}"></bc-attachment>`
      }
      const name = resolveMentionLabel(attrs, inner)
      return `<strong>@${escapeHtml(name)}</strong>`
    })
    .replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) => {
      if (!isMentionAttachmentAttrs(attrs)) return full
      const sgid = getAttrFromTagAttrs(attrs, 'sgid').trim()
      if (sgid) {
        return `<bc-attachment sgid="${sgid}"></bc-attachment>`
      }
      const name = resolveMentionLabel(attrs, '')
      return `<strong>@${escapeHtml(name)}</strong>`
    })
    .replace(
      /<span\b([^>]*?\b(?:data-teg-mention-person-id|data-bc-mention)\s*=\s*["'][^"']*["'][^>]*?)>([\s\S]*?)<\/span>/gi,
      (_full, attrs, inner) => {
        const name = resolveMentionLabel(attrs, inner)
        return `<strong>@${escapeHtml(name)}</strong>`
      }
    )

  return out
}

/**
 * Converts Rich HTML into a clean plain-text snippet while preserving `@Nombres` of all mentioned people.
 */
export function cleanPlainSnippetWithMentions(
  rawHtml: string | null | undefined,
  allPeople?: BasecampPersonLookupRow[]
): string {
  if (!rawHtml || typeof rawHtml !== 'string') return ''
  const lookup = allPeople ? buildPeopleLookupMaps(allPeople) : undefined
  let working = stripTegAuthorBanner(rawHtml).cleanHtml
    .replace(/<bc-attachment\b([^>]*?)>([\s\S]*?)<\/bc-attachment>/gi, (_full, attrs, inner) => {
      if (isMentionAttachmentAttrs(attrs)) {
        return ` @${resolveMentionLabel(attrs, inner, lookup)} `
      }
      return ' '
    })
    .replace(/<bc-attachment\b([^>]*?)\/>/gi, (_full, attrs) => {
      if (isMentionAttachmentAttrs(attrs)) {
        return ` @${resolveMentionLabel(attrs, '', lookup)} `
      }
      return ' '
    })
    .replace(
      /<span\b([^>]*?\b(?:data-teg-mention-person-id|data-bc-mention)\s*=\s*["'][^"']*["'][^>]*?)>([\s\S]*?)<\/span>/gi,
      (_full, attrs, inner) => ` @${resolveMentionLabel(attrs, inner, lookup)} `
    )

  working = decodeHtmlEntities(working.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

  return working
}

const CANONICAL_TEG_APP_URL = 'https://tacosgavilan.vercel.app'

function normalizePublicHttpsBaseUrl(raw?: string | null): string | null {
  const trimmed = (raw || '').trim().replace(/\/+$/, '')
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return null
    const host = parsed.hostname.toLowerCase()
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]'
    ) {
      return null
    }
    const cleanPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${cleanPath}`
  } catch {
    return null
  }
}

export function resolveAppBaseUrl(originHint?: string | null): string {
  const vercelProdRaw = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/\/+$/, '')
  const vercelProdUrl = vercelProdRaw
    ? /^https?:\/\//i.test(vercelProdRaw)
      ? vercelProdRaw
      : `https://${vercelProdRaw}`
    : ''

  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    vercelProdUrl,
    originHint,
  ]
  for (const c of candidates) {
    const valid = normalizePublicHttpsBaseUrl(c)
    if (valid) return valid
  }
  return CANONICAL_TEG_APP_URL
}

function formatCaliforniaDateTime(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  })
}

function formatDueDateEs(dateStr?: string | null): string {
  if (!dateStr) return ''
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const localNoon = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
    if (!isNaN(localNoon.getTime())) {
      return localNoon.toLocaleDateString('es-MX', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    }
  }
  return String(dateStr)
}

function normalizeEmailMediaUrl(rawUrl: string, appBaseUrl: string, filename?: string): string {
  const clean = (rawUrl || '').replace(/&amp;/gi, '&').trim()
  if (!clean) return ''
  if (clean.startsWith('/')) return `${appBaseUrl}${clean}`
  try {
    const parsed = new URL(clean)
    const host = parsed.hostname.toLowerCase()
    if (
      host === '3.basecampapi.com' ||
      host === 'preview.app.basecamp.com' ||
      host === 'storage.app.basecamp.com' ||
      host === 'preview.3.basecamp.com' ||
      host === 'storage.3.basecamp.com'
    ) {
      const fnParam = filename ? `&filename=${encodeURIComponent(filename)}` : ''
      return `${appBaseUrl}/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}${fnParam}`
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

function isVideoMediaRef(contentType?: string | null, filename?: string | null, url?: string | null): boolean {
  const ct = (contentType || '').trim().toLowerCase()
  if (ct.startsWith('video/')) return true
  const sample = `${filename || ''} ${url || ''}`
  return /\.(?:mov|mp4|webm|m4v|avi|mkv)(?:$|[?#\s])/i.test(sample)
}

export function cleanRichHtmlForEmail(
  rawHtml: string | null | undefined,
  appBaseUrl: string,
  allPeople?: BasecampPersonLookupRow[]
): {
  bodyHtml: string
  attachments: Array<{ filename: string; url: string; isVideo?: boolean }>
} {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return { bodyHtml: '', attachments: [] }
  }

  const lookup = allPeople ? buildPeopleLookupMaps(allPeople) : undefined

  let working = stripTegAuthorBanner(rawHtml).cleanHtml
    .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')

  // 1. Collect downloadable non-image file & video attachments (strictly excluding mentions!)
  const attachments: Array<{ filename: string; url: string; isVideo?: boolean }> = []
  const seenAttachmentUrls = new Set<string>()
  const pushAttachment = (filename: string, rawUrl: string, isVideo: boolean) => {
    let absUrl = normalizeEmailMediaUrl(rawUrl, appBaseUrl, filename)
    if (!absUrl || !/^https?:\/\//i.test(absUrl)) return
    if (absUrl.includes('/api/basecamp/attachment?') && !/[?&]download=/i.test(absUrl)) {
      absUrl = `${absUrl}&download=1`
    }
    if (seenAttachmentUrls.has(absUrl)) return
    seenAttachmentUrls.add(absUrl)
    attachments.push({ filename, url: absUrl, isVideo })
  }

  const bcAttRegex = /<bc-attachment\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
  let match: RegExpExecArray | null
  while ((match = bcAttRegex.exec(working)) !== null) {
    const attrs = match[1] || ''
    if (isMentionAttachmentAttrs(attrs)) continue
    const ct = getAttrFromTagAttrs(attrs, 'content-type').toLowerCase()
    const fn = safeDecodeFilename(getAttrFromTagAttrs(attrs, 'filename') || 'Archivo adjunto')
    const rawUrl = (getAttrFromTagAttrs(attrs, 'url') || getAttrFromTagAttrs(attrs, 'href') || '').trim()
    const isVideo = isVideoMediaRef(ct, fn, rawUrl)
    const isImage = !isVideo && (ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn))
    if (!isImage && rawUrl) {
      pushAttachment(fn, rawUrl, isVideo)
    }
  }

  // Also collect inline <video> elements & replicated <p data-teg-attachment="true"> blocks for email buttons
  const videoTagRegex = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi
  let vidMatch: RegExpExecArray | null
  while ((vidMatch = videoTagRegex.exec(working)) !== null) {
    const vAttrs = vidMatch[1] || ''
    const vInner = vidMatch[2] || ''
    let rawSrc = getAttrFromTagAttrs(vAttrs, 'src')
    if (!rawSrc) {
      const srcTagMatch = vInner.match(/<source\b([^>]*)>/i)
      if (srcTagMatch?.[1]) rawSrc = getAttrFromTagAttrs(srcTagMatch[1], 'src')
    }
    if (rawSrc) {
      const rawFn =
        getAttrFromTagAttrs(vAttrs, 'data-filename') ||
        rawSrc.split('/').pop()?.split('?')[0] ||
        'Video.mp4'
      pushAttachment(safeDecodeFilename(rawFn), rawSrc, true)
    }
  }

  const tegAttRegex =
    /<p\b[^>]*\bdata-teg-attachment\s*=\s*(?:["']true["']|true\b)[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/p>/gi
  let tegMatch: RegExpExecArray | null
  while ((tegMatch = tegAttRegex.exec(working)) !== null) {
    const aAttrs = tegMatch[1] || ''
    const rawHref = getAttrFromTagAttrs(aAttrs, 'href')
    const label = decodeHtmlEntities((tegMatch[2] || '').replace(/<[^>]*>/g, '').replace(/^[📎🎬]\s*/, '').trim())
    if (rawHref) {
      const fn = safeDecodeFilename(label || rawHref.split('/').pop()?.split('?')[0] || 'Archivo adjunto')
      pushAttachment(fn, rawHref, isVideoMediaRef('', fn, rawHref))
    }
  }

  // 2. Transform Basecamp & TEG @mentions into readable blue pills BEFORE stripping generic <bc-attachment> / <video>
  working = working
    .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '')
    .replace(tegAttRegex, '')
    .replace(/<bc-attachment\b([^>]*?)>([\s\S]*?)<\/bc-attachment>/gi, (_m, attrs, inner) => {
      if (isMentionAttachmentAttrs(attrs)) {
        const name = resolveMentionLabel(attrs, inner, lookup)
        return `<strong style="${EMAIL_MENTION_PILL_STYLE}">@${escapeHtml(name)}</strong>`
      }
      const ct = getAttrFromTagAttrs(attrs, 'content-type').toLowerCase()
      const fn = safeDecodeFilename(getAttrFromTagAttrs(attrs, 'filename') || 'Imagen')
      const rawUrl = (getAttrFromTagAttrs(attrs, 'url') || getAttrFromTagAttrs(attrs, 'href') || '').trim()
      if (isVideoMediaRef(ct, fn, rawUrl)) return ''
      if (/<img\b[^>]+>/i.test(inner)) return inner
      const isImage = ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn)
      if (isImage && rawUrl) {
        const absImg = normalizeEmailMediaUrl(rawUrl, appBaseUrl, fn)
        if (absImg) return `<img src="${escapeHtml(absImg)}" alt="${escapeHtml(fn)}" />`
      }
      return ''
    })
    .replace(/<bc-attachment\b([^>]*?)\/>/gi, (_m, attrs) => {
      if (isMentionAttachmentAttrs(attrs)) {
        const name = resolveMentionLabel(attrs, '', lookup)
        return `<strong style="${EMAIL_MENTION_PILL_STYLE}">@${escapeHtml(name)}</strong>`
      }
      const ct = getAttrFromTagAttrs(attrs, 'content-type').toLowerCase()
      const fn = safeDecodeFilename(getAttrFromTagAttrs(attrs, 'filename') || 'Imagen')
      const rawUrl = (getAttrFromTagAttrs(attrs, 'url') || getAttrFromTagAttrs(attrs, 'href') || '').trim()
      const isImage = !isVideoMediaRef(ct, fn, rawUrl) && (ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn))
      if (isImage && rawUrl) {
        const absImg = normalizeEmailMediaUrl(rawUrl, appBaseUrl, fn)
        if (absImg) return `<img src="${escapeHtml(absImg)}" alt="${escapeHtml(fn)}" />`
      }
      return ''
    })
    .replace(
      /<span\b([^>]*?\b(?:data-teg-mention-person-id|data-bc-mention)\s*=\s*["'][^"']*["'][^>]*?)>([\s\S]*?)<\/span>/gi,
      (_m, attrs, inner) => {
        const name = resolveMentionLabel(attrs, inner, lookup)
        return `<strong style="${EMAIL_MENTION_PILL_STYLE}">@${escapeHtml(name)}</strong>`
      }
    )

  // 3. Ensure any relative or Basecamp-hosted URLs become absolute playable/viewable links
  working = working
    .replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+)/gi, '')
    .replace(/(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi, (_full, prefix, q, val) => {
      const normalized = normalizeEmailMediaUrl(val, appBaseUrl)
      return `${prefix}${q}${normalized || val}${q}`
    })
    .replace(
      /<img\b([^>]*)>/gi,
      '<img$1 style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;display:block;border:1px solid #e2e8f0;" />'
    )

  const sanitized = sanitizeBasecampHtml(working).trim()
  const plainCheck = sanitized.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
  const hasImgOrTable = /<(img|table)\b/i.test(sanitized)
  return {
    bodyHtml: plainCheck || hasImgOrTable ? sanitized : '',
    attachments,
  }
}

const ALLOWED_EMAIL_BASECAMP_HOSTS = new Set([
  'preview.app.basecamp.com',
  'storage.app.basecamp.com',
  'preview.3.basecamp.com',
  'storage.3.basecamp.com',
  '3.basecampapi.com',
])

const MAX_EMAIL_IMAGE_BYTES = 25 * 1024 * 1024 - 64 * 1024 // ~24.93 MB (within checklist-photos 25 MB limit)

const EMAIL_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const EMAIL_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

const GENERIC_EMAIL_IMG_NAMES = new Set([
  'full',
  'preview',
  'card',
  'gallery',
  'lightbox',
  'image',
  'imagen',
  'imagen adjunta',
  'archivo adjunto',
  'attachment',
])

interface ParsedImgHtmlAttr {
  name: string
  nameLower: string
  value: string
  hasValue: boolean
  quote: '"' | "'" | ''
}

interface EmailImageResolutionTarget {
  kind: 'already_public_supabase' | 'basecamp'
  publicUrl?: string
  originalBcUrl?: string
  cleanBcUrl?: string
  targetBcApiUrl?: string
  blobUuid?: string
  filenameHint?: string
}

function getConfiguredSupabaseHost(): string {
  try {
    const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
    return raw ? new URL(raw).hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

function isPublicChecklistPhotosUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false
  try {
    const parsed = new URL(rawUrl.trim())
    if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
      return false
    }
    const supaHost = getConfiguredSupabaseHost()
    const hostOk = supaHost
      ? parsed.hostname.toLowerCase() === supaHost
      : parsed.hostname.toLowerCase().endsWith('.supabase.co')
    return (
      hostOk &&
      parsed.pathname.startsWith('/storage/v1/object/public/checklist-photos/') &&
      !parsed.pathname.includes('//') &&
      !parsed.pathname.includes('..')
    )
  } catch {
    return false
  }
}

function parseImgHtmlAttributes(attrsStr: string): ParsedImgHtmlAttr[] {
  const out: ParsedImgHtmlAttr[] = []
  const attrRegex = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g
  let m: RegExpExecArray | null
  while ((m = attrRegex.exec(attrsStr)) !== null) {
    const name = m[1]
    const nameLower = name.toLowerCase()
    if (m[2] !== undefined) {
      out.push({ name, nameLower, value: m[2], hasValue: true, quote: '"' })
    } else if (m[3] !== undefined) {
      out.push({ name, nameLower, value: m[3], hasValue: true, quote: "'" })
    } else if (m[4] !== undefined) {
      out.push({ name, nameLower, value: m[4], hasValue: true, quote: '' })
    } else {
      out.push({ name, nameLower, value: '', hasValue: false, quote: '' })
    }
  }
  return out
}

function serializeImgHtmlTag(resolvedSrc: string, attrs: ParsedImgHtmlAttr[], selfClosing: boolean): string {
  const parts: string[] = [`src="${escapeHtml(resolvedSrc)}"`]
  for (const a of attrs) {
    if (a.nameLower === 'src' || a.nameLower === 'srcset') continue
    if (!a.hasValue) {
      parts.push(a.name)
    } else if (a.quote === "'") {
      parts.push(`${a.name}='${a.value.replace(/'/g, '&#39;')}'`)
    } else {
      parts.push(`${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
    }
  }
  return `<img ${parts.join(' ')}${selfClosing ? ' />' : '>'}`
}

function extractEmailImageResolutionTarget(rawSrc?: string | null): EmailImageResolutionTarget | null {
  if (!rawSrc || typeof rawSrc !== 'string') return null
  let candidate = decodeHtmlEntities(rawSrc)
    .replace(/&#38;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .trim()
  if (!candidate) return null

  let filenameHint = ''

  // Unwrap relative or absolute /api/basecamp/attachment?url=... (up to 3 nested levels)
  for (let depth = 0; depth < 3; depth++) {
    if (candidate.startsWith('/api/basecamp/attachment?')) {
      const qs = new URLSearchParams(candidate.slice('/api/basecamp/attachment?'.length))
      const fn = qs.get('filename')
      if (fn && !filenameHint) filenameHint = fn
      const inner = qs.get('url')
      if (!inner) return null
      candidate = inner.trim()
      continue
    }
    try {
      const maybeProxy = new URL(candidate)
      if (maybeProxy.pathname === '/api/basecamp/attachment') {
        const fn = maybeProxy.searchParams.get('filename')
        if (fn && !filenameHint) filenameHint = fn
        const inner = maybeProxy.searchParams.get('url')
        if (!inner) return null
        candidate = inner.trim()
        continue
      }
    } catch {
      // Not a full URL yet
    }
    break
  }

  if (isPublicChecklistPhotosUrl(candidate) && !isVideoMediaRef(null, filenameHint, candidate)) {
    const cleanSupa = new URL(candidate)
    cleanSupa.searchParams.delete('dppx')
    return {
      kind: 'already_public_supabase',
      publicUrl: cleanSupa.toString(),
    }
  }

  if (
    candidate.includes('..') ||
    candidate.includes('\\') ||
    /%2e|%5c|%00/i.test(candidate) ||
    /[\r\n\t]/.test(candidate)
  ) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  if (!ALLOWED_EMAIL_BASECAMP_HOSTS.has(host)) {
    return null
  }

  let decodedPathname = parsed.pathname
  try {
    decodedPathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }

  const accountId = process.env.BASECAMP_ACCOUNT_ID || '5052386'
  const isLegacyThreeHost = host === 'preview.3.basecamp.com' || host === 'storage.3.basecamp.com'
  if (
    decodedPathname.includes('..') ||
    decodedPathname.includes('\\') ||
    parsed.pathname.includes('//') ||
    !parsed.pathname.startsWith(`/${accountId}/`) ||
    (isLegacyThreeHost && !parsed.pathname.startsWith(`/${accountId}/blobs/`))
  ) {
    return null
  }

  const originalBcUrl = parsed.toString()
  const cleanOrig = new URL(originalBcUrl)
  cleanOrig.searchParams.delete('dppx')
  const cleanBcUrl = cleanOrig.toString()

  let targetBcApiUrl: string
  try {
    const apiParsed = new URL(cleanBcUrl)
    apiParsed.hostname = '3.basecampapi.com'
    targetBcApiUrl = assertSafeBasecampApiUrl(apiParsed.toString(), accountId)
  } catch {
    return null
  }

  const blobMatch =
    parsed.pathname.match(/\/blobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i) ||
    parsed.pathname.match(/\/blobs\/([0-9a-f-]{8,64})(?:\/|$)/i)
  const blobUuid = blobMatch?.[1] ? blobMatch[1].toLowerCase() : undefined

  if (!filenameHint) {
    const lastSeg = safeDecodeFilename(parsed.pathname.split('/').pop() || '').trim()
    if (lastSeg && !GENERIC_EMAIL_IMG_NAMES.has(lastSeg.toLowerCase())) {
      filenameHint = lastSeg
    }
  }

  return {
    kind: 'basecamp',
    originalBcUrl,
    cleanBcUrl,
    targetBcApiUrl,
    blobUuid,
    filenameHint,
  }
}

async function checkPublicStorageImageAlive(
  url: string
): Promise<'ok' | 'missing_or_invalid' | 'transient_error'> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return 'missing_or_invalid'
    const ct = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
    if (ct && (ct.startsWith('video/') || ct.includes('application/json') || ct.includes('text/html'))) {
      return 'missing_or_invalid'
    }
    return 'ok'
  } catch {
    return 'transient_error'
  }
}

function inferEmailImageMime(buffer: Buffer, declaredMime: string, filename: string): string {
  if (buffer.length >= 4) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif'
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp'
    }
  }
  const cleanDeclared = (declaredMime || '').split(';')[0].trim().toLowerCase()
  if (cleanDeclared.startsWith('image/')) {
    return cleanDeclared === 'image/jpg' ? 'image/jpeg' : cleanDeclared
  }
  const extMatch = filename.match(/\.([a-z0-9]{2,5})$/i)
  if (extMatch?.[1]) {
    const mapped = EMAIL_MIME_BY_EXT[extMatch[1].toLowerCase()]
    if (mapped) return mapped
  }
  return cleanDeclared || 'application/octet-stream'
}

function buildSafeEmailCacheFilename(hintName: string, mimeType: string): string {
  const decoded = safeDecodeFilename(decodeHtmlEntities(hintName || '')).trim()
  let base = decoded && !GENERIC_EMAIL_IMG_NAMES.has(decoded.toLowerCase()) ? decoded : 'image'
  const extMatch = base.match(/\.([a-zA-Z0-9]{2,5})$/)
  let rawExt = extMatch?.[1]?.toLowerCase() || ''
  if (extMatch && EMAIL_MIME_BY_EXT[rawExt]) {
    base = base.slice(0, base.length - extMatch[0].length)
  } else {
    rawExt = ''
  }

  let safeStem = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64)
  if (!safeStem) safeStem = 'image'

  const canonicalExt = EMAIL_EXT_BY_MIME[mimeType] || rawExt || 'png'
  return `${safeStem}.${canonicalExt}`
}

async function downloadBasecampImageForEmailCache(
  targetBcApiUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const accountId = process.env.BASECAMP_ACCOUNT_ID || '5052386'
    const safeApiUrl = assertSafeBasecampApiUrl(targetBcApiUrl, accountId)
    const token = await getValidToken()
    const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (noreply@tacosgavilan.com)'

    const res = await fetch(safeApiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })

    const redirectLocation = res.headers.get('location')
    if (redirectLocation) {
      let parsedS3: URL
      try {
        parsedS3 = new URL(redirectLocation)
      } catch {
        return null
      }
      if (parsedS3.protocol !== 'https:' || parsedS3.username !== '' || parsedS3.password !== '') {
        return null
      }

      // Follow 302 to AWS S3 strictly WITHOUT forwarding Authorization header
      const s3Res = await fetch(parsedS3.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(25_000),
      })
      if (!s3Res.ok) {
        console.warn(`⚠️ [Basecamp Email Image] S3 download returned ${s3Res.status}`)
        return null
      }
      const declaredLen = Number(s3Res.headers.get('content-length') || 0)
      if (declaredLen > MAX_EMAIL_IMAGE_BYTES) return null

      const contentType = (s3Res.headers.get('Content-Type') || 'application/octet-stream')
        .split(';')[0]
        .trim()
        .toLowerCase()
      const buffer = Buffer.from(await s3Res.arrayBuffer())
      if (buffer.length === 0 || buffer.length > MAX_EMAIL_IMAGE_BYTES) return null
      return { buffer, contentType }
    }

    if (res.ok) {
      const contentType = (res.headers.get('Content-Type') || 'application/octet-stream')
        .split(';')[0]
        .trim()
        .toLowerCase()
      if (contentType.includes('application/json') || contentType.includes('text/html')) {
        return null
      }
      const declaredLen = Number(res.headers.get('content-length') || 0)
      if (declaredLen > MAX_EMAIL_IMAGE_BYTES) return null

      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length === 0 || buffer.length > MAX_EMAIL_IMAGE_BYTES) return null
      return { buffer, contentType }
    }

    console.warn(`⚠️ [Basecamp Email Image] Basecamp API returned status ${res.status}`)
    return null
  } catch (err: any) {
    console.warn('⚠️ [Basecamp Email Image] Non-fatal download error:', err?.message || err)
    return null
  }
}

async function resolveSingleBasecampEmailImage(
  target: EmailImageResolutionTarget,
  altHint: string
): Promise<string | null> {
  if (target.kind === 'already_public_supabase') {
    return target.publicUrl || null
  }

  const cleanBcUrl = target.cleanBcUrl || ''
  const originalBcUrl = target.originalBcUrl || cleanBcUrl
  const targetBcApiUrl = target.targetBcApiUrl || ''
  if (!cleanBcUrl || !targetBcApiUrl) return null

  let transientFallbackCachedUrl: string | null = null

  // Paso A: Consultar bc_attachment_cache (por URL exacta/variante de host o coincidencia UUID /blobs/<uuid>/)
  try {
    const parsedClean = new URL(cleanBcUrl)
    const candidateExactUrls = Array.from(
      new Set([
        originalBcUrl,
        cleanBcUrl,
        `https://preview.app.basecamp.com${parsedClean.pathname}`,
        `https://preview.3.basecamp.com${parsedClean.pathname}`,
        `https://storage.app.basecamp.com${parsedClean.pathname}`,
        `https://storage.3.basecamp.com${parsedClean.pathname}`,
        `https://3.basecampapi.com${parsedClean.pathname}`,
      ])
    )

    const { data: exactRows } = await supabaseAdmin
      .from('bc_attachment_cache')
      .select('basecamp_url, supabase_url')
      .in('basecamp_url', candidateExactUrls)
      .limit(10)

    let cacheCandidates: Array<{ basecamp_url?: string | null; supabase_url?: string | null }> = exactRows || []

    if (cacheCandidates.length === 0 && target.blobUuid) {
      const { data: uuidRows } = await supabaseAdmin
        .from('bc_attachment_cache')
        .select('basecamp_url, supabase_url')
        .ilike('basecamp_url', `%/blobs/${target.blobUuid}/%`)
        .order('created_at', { ascending: false })
        .limit(10)
      cacheCandidates = uuidRows || []
    }

    const seenSupaUrls = new Set<string>()
    for (const row of cacheCandidates) {
      const supaUrl = (row?.supabase_url || '').trim()
      if (!supaUrl || seenSupaUrls.has(supaUrl)) continue
      seenSupaUrls.add(supaUrl)
      if (!isPublicChecklistPhotosUrl(supaUrl) || isVideoMediaRef(null, null, supaUrl)) continue

      const alive = await checkPublicStorageImageAlive(supaUrl)
      if (alive === 'ok') {
        const hasExactRow = cacheCandidates.some((r) => r?.basecamp_url === cleanBcUrl && r?.supabase_url === supaUrl)
        if (!hasExactRow) {
          try {
            await supabaseAdmin
              .from('bc_attachment_cache')
              .upsert({ basecamp_url: cleanBcUrl, supabase_url: supaUrl }, { onConflict: 'basecamp_url' })
          } catch {
            // Best-effort cache alias save
          }
        }
        return supaUrl
      }
      if (alive === 'transient_error' && !transientFallbackCachedUrl) {
        transientFallbackCachedUrl = supaUrl
      }
    }
  } catch (cacheLookupErr: any) {
    console.warn('⚠️ [Basecamp Email Image] Cache lookup warning:', cacheLookupErr?.message || cacheLookupErr)
  }

  // Paso B: No está en bc_attachment_cache (o el objeto histórico ya no existe) -> descargar vía OAuth -> S3 y subir a checklist-photos
  const downloaded = await downloadBasecampImageForEmailCache(targetBcApiUrl)
  if (!downloaded) {
    return transientFallbackCachedUrl
  }

  const hintForName = target.filenameHint || altHint || 'image'
  const effectiveMime = inferEmailImageMime(downloaded.buffer, downloaded.contentType, hintForName)
  if (!effectiveMime.startsWith('image/')) {
    return transientFallbackCachedUrl
  }

  const safeFilename = buildSafeEmailCacheFilename(hintForName, effectiveMime)
  const blobUuidOrHash =
    target.blobUuid || crypto.createHash('sha256').update(cleanBcUrl).digest('hex').slice(0, 24)
  const storagePath = `basecamp-email-cache/${blobUuidOrHash}-${safeFilename}`

  try {
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('checklist-photos')
      .upload(storagePath, downloaded.buffer, {
        contentType: effectiveMime,
        cacheControl: '3600',
        upsert: true,
      })

    if (uploadErr) {
      console.warn(`⚠️ [Basecamp Email Image] Storage upload warning (${storagePath}):`, uploadErr.message)
      return transientFallbackCachedUrl
    }

    const { data: pubData } = supabaseAdmin.storage.from('checklist-photos').getPublicUrl(storagePath)
    const publicUrl = pubData?.publicUrl || null
    if (!publicUrl) return transientFallbackCachedUrl

    try {
      await supabaseAdmin
        .from('bc_attachment_cache')
        .upsert({ basecamp_url: cleanBcUrl, supabase_url: publicUrl }, { onConflict: 'basecamp_url' })
    } catch (upsertErr: any) {
      console.warn('⚠️ [Basecamp Email Image] Non-fatal bc_attachment_cache upsert warning:', upsertErr?.message || upsertErr)
    }

    return publicUrl
  } catch (err: any) {
    console.warn('⚠️ [Basecamp Email Image] Unexpected upload error:', err?.message || err)
    return transientFallbackCachedUrl
  }
}

/**
 * Resuelve todas las imágenes `<img ... src="...">` dentro del HTML de un correo para que apunten
 * directamente a URLs públicas HTTPS en `checklist-photos` (Supabase Storage), evitando que el proxy
 * de imágenes de Gmail (`googleusercontent.com`) reciba `401 Unauthorized` de `/api/basecamp/attachment`.
 */
export async function resolvePublicImagesForEmailHtml(html: string): Promise<string> {
  if (!html || typeof html !== 'string') return ''

  // Expand self-closing image <bc-attachment ... /> if caller passed raw Basecamp HTML directly
  let working = html.replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) => {
    if (isMentionAttachmentAttrs(attrs)) return full
    const ct = getAttrFromTagAttrs(attrs, 'content-type').toLowerCase()
    const fn = safeDecodeFilename(getAttrFromTagAttrs(attrs, 'filename') || 'Imagen')
    const rawUrl = (getAttrFromTagAttrs(attrs, 'url') || getAttrFromTagAttrs(attrs, 'href') || '').trim()
    const isImg = !isVideoMediaRef(ct, fn, rawUrl) && (ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn))
    if (isImg && rawUrl) {
      return `<img src="${escapeHtml(rawUrl)}" alt="${escapeHtml(fn)}" />`
    }
    return full
  })

  if (!/<img\b/i.test(working)) return working

  const imgRegex = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi
  const matches = [...working.matchAll(imgRegex)]
  if (matches.length === 0) return working

  const inFlightByKey = new Map<string, Promise<string | null>>()
  const replacements: Array<{ start: number; end: number; replacement: string }> = []

  for (const m of matches) {
    const fullTag = m[0]
    const attrsStr = m[1] || ''
    const selfClosing = Boolean(m[2])
    const startIdx = m.index ?? -1
    if (startIdx < 0) continue

    const parsedAttrs = parseImgHtmlAttributes(attrsStr)
    if (
      parsedAttrs.some(
        (a) => a.nameLower === 'data-avatar-for-person-id' || a.nameLower === 'data-bc-avatar'
      )
    ) {
      continue
    }

    const srcAttr = parsedAttrs.find((a) => a.nameLower === 'src')
    if (!srcAttr || !srcAttr.value) continue

    const target = extractEmailImageResolutionTarget(srcAttr.value)
    if (!target) continue

    const altHint = parsedAttrs.find((a) => a.nameLower === 'alt')?.value || ''
    const dedupKey =
      target.kind === 'already_public_supabase'
        ? `supa:${target.publicUrl}`
        : `bc:${target.cleanBcUrl}`

    let promise = inFlightByKey.get(dedupKey)
    if (!promise) {
      promise = resolveSingleBasecampEmailImage(target, altHint)
      inFlightByKey.set(dedupKey, promise)
    }

    const resolvedPublicUrl = await promise
    if (!resolvedPublicUrl) continue

    const updatedTag = serializeImgHtmlTag(resolvedPublicUrl, parsedAttrs, selfClosing)
    if (updatedTag !== fullTag) {
      replacements.push({
        start: startIdx,
        end: startIdx + fullTag.length,
        replacement: updatedTag,
      })
    }
  }

  if (replacements.length === 0) return working

  // Apply replacements from right to left so string offsets remain exact even when identical tags repeat
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    working = working.slice(0, r.start) + r.replacement + working.slice(r.end)
  }

  return working
}

/**
 * Inserts in-app notifications into `public.bc_notifications` for mentioned, assigned, or involved
 * collaborators (excluding the actor), setting `recording_id` to the parent UUID (`bc_todos.id`,
 * `bc_messages.id`, or `bc_documents.id`) so `NewForYouDrawer` navigates directly on click.
 */
export async function createBasecampInAppNotifications(
  params: CreateBasecampInAppNotificationsParams
): Promise<{ insertedCount: number; recipientPersonIds: string[] }> {
  const {
    projectUuid,
    recordingType,
    recordingUuid,
    actorPersonId,
    actorName,
    actorEmail,
    title,
    rawHtml,
    mentionedPersonIds,
    assignedPersonIds,
    involvedPersonIds,
    defaultType,
    allowActorInTargets,
  } = params

  if (!projectUuid || !recordingUuid) {
    return { insertedCount: 0, recipientPersonIds: [] }
  }

  try {
    const { data: peopleRows } = await supabaseAdmin
      .from('bc_people')
      .select('id, bc_id, name, email, is_active, attachable_sgid')
      .limit(5000)

    const allPeople: BasecampPersonLookupRow[] = peopleRows || []
    const activePersonIds = new Set<string>(
      allPeople.filter((p) => p.is_active !== false).map((p) => p.id)
    )

    const autoMentioned = rawHtml ? extractMentionedPersonIds(rawHtml, allPeople) : []
    const allMentionedSet = new Set<string>([...(mentionedPersonIds || []), ...autoMentioned])
    const allAssignedSet = new Set<string>(assignedPersonIds || [])
    const allInvolvedSet = new Set<string>(involvedPersonIds || [])

    const personById = new Map<string, BasecampPersonLookupRow>()
    for (const p of allPeople) {
      if (p.id) personById.set(p.id, p)
    }
    const inferredActorEmail = canonicalizeBasecampEmail(
      actorEmail || (actorPersonId ? personById.get(actorPersonId)?.email : null)
    )
    const actorExcludedEmails = getEquivalentActorEmails(inferredActorEmail)
    const isExcludedActor = (pid: string, allowExplicitSelf = false): boolean => {
      if (allowExplicitSelf) return false
      if (actorPersonId && pid === actorPersonId) return true
      const pEmail = canonicalizeBasecampEmail(personById.get(pid)?.email)
      return Boolean(pEmail && actorExcludedEmails.has(pEmail))
    }

    // Map recipient person_id -> highest-priority notification type ('mention' > 'assigned' > defaultType)
    const recipientTypeMap = new Map<string, 'mention' | 'assigned' | 'comment' | 'completed' | 'message'>()

    for (const pid of allInvolvedSet) {
      if (!pid || isExcludedActor(pid, Boolean(allowActorInTargets)) || !activePersonIds.has(pid)) continue
      recipientTypeMap.set(pid, defaultType)
    }
    for (const pid of allAssignedSet) {
      if (!pid || isExcludedActor(pid) || !activePersonIds.has(pid)) continue
      recipientTypeMap.set(pid, 'assigned')
    }
    for (const pid of allMentionedSet) {
      if (!pid || isExcludedActor(pid) || !activePersonIds.has(pid)) continue
      recipientTypeMap.set(pid, 'mention')
    }

    if (recipientTypeMap.size === 0) {
      return { insertedCount: 0, recipientPersonIds: [] }
    }

    const displayActor = (
      canonicalizeBasecampDisplayName(actorName, inferredActorEmail) || 'Equipo Tacos Gavilan'
    ).trim()
    const cleanTitleBase = (title || 'Actividad en Basecamp').trim()
    const cleanSnippet = cleanPlainSnippetWithMentions(rawHtml, allPeople).slice(0, 240)
    const nowIso = new Date().toISOString()

    const rowsToInsert = Array.from(recipientTypeMap.entries()).map(([personId, notifType]) => {
      let formattedTitle = cleanTitleBase
      if (notifType === 'mention') {
        formattedTitle = `@${displayActor} te mencionó: ${cleanTitleBase}`
      } else if (notifType === 'assigned') {
        formattedTitle = `📋 ${displayActor} te asignó: ${cleanTitleBase}`
      } else if (notifType === 'completed') {
        formattedTitle = `✅ ${displayActor} completó: ${cleanTitleBase}`
      } else if (notifType === 'comment') {
        formattedTitle = `💬 ${displayActor}: ${cleanTitleBase}`
      } else if (notifType === 'message') {
        formattedTitle = `📢 ${displayActor}: ${cleanTitleBase}`
      }

      return {
        project_id: projectUuid,
        person_id: personId,
        type: notifType,
        title: formattedTitle.slice(0, 240),
        description: cleanSnippet || cleanTitleBase,
        recording_type: recordingType,
        recording_id: recordingUuid,
        is_read: false,
        created_at: nowIso,
      }
    })

    const { error } = await supabaseAdmin.from('bc_notifications').insert(rowsToInsert)
    if (error) {
      console.warn('⚠️ [Basecamp In-App Notif] Non-fatal insert warning:', error.message)
      return { insertedCount: 0, recipientPersonIds: [] }
    }

    return {
      insertedCount: rowsToInsert.length,
      recipientPersonIds: Array.from(recipientTypeMap.keys()),
    }
  } catch (err: any) {
    console.warn('⚠️ [Basecamp In-App Notif] Unexpected error:', err?.message || err)
    return { insertedCount: 0, recipientPersonIds: [] }
  }
}

const EVENT_META: Record<
  BasecampTodoEmailEvent,
  { badge: string; headerBg: string; accent: string; subjectPrefix: string; actionSummary: string }
> = {
  assigned: {
    badge: '📋 NUEVA TAREA / PEDIDO',
    headerBg: '#0f172a',
    accent: '#0284c7',
    subjectPrefix: '📋 Nuevo Pedido/Caso',
    actionSummary: 'asignó una tarea',
  },
  commented: {
    badge: '💬 NUEVO COMENTARIO',
    headerBg: '#0f172a',
    accent: '#2563eb',
    subjectPrefix: '💬 Nuevo comentario',
    actionSummary: 'agregó un comentario',
  },
  completed: {
    badge: '✅ TAREA COMPLETADA',
    headerBg: '#064e3b',
    accent: '#16a34a',
    subjectPrefix: '✅ Completado',
    actionSummary: 'marcó esta tarea como completada',
  },
  reopened: {
    badge: '🔄 TAREA REABIERTA',
    headerBg: '#78350f',
    accent: '#d97706',
    subjectPrefix: '🔄 Reabierto',
    actionSummary: 'reabrió esta tarea como pendiente',
  },
  updated: {
    badge: '🔔 ACTUALIZACIÓN DE TAREA',
    headerBg: '#0f172a',
    accent: '#0284c7',
    subjectPrefix: '🔔 Actualización',
    actionSummary: 'actualizó esta tarea',
  },
}

export async function sendBasecampTodoNotificationEmail(
  params: SendBasecampTodoEmailParams
): Promise<SendBasecampTodoEmailResult> {
  const {
    event,
    todoDbId,
    actorPersonId,
    actorName,
    actorEmail,
    commentHtml,
    appOrigin,
    excludeActorOnAssigned,
    overrideRecipients,
  } = params
  if (!todoDbId) {
    return { sent: false, recipients: [], skippedReason: 'missing_todoDbId' }
  }

  try {
    // 1. Load Todo, Assignees, Comments, All bc_people (with attachable_sgid), and Active Users fallback in parallel
    const [todoRes, assigneesRes, commentsRes, allPeopleRes, activeUsersRes] = await Promise.all([
      supabaseAdmin
        .from('bc_todos')
        .select(`
          id, bc_id, title, description, starts_on, due_date, is_completed, completed_at, created_at,
          created_by_person_id, completion_subscriber_ids,
          project:bc_projects(id, bc_id, name),
          todolist:bc_todolists(id, name),
          creator:bc_people!bc_todos_created_by_person_id_fkey(id, name, email, is_active)
        `)
        .eq('id', todoDbId)
        .maybeSingle(),
      supabaseAdmin
        .from('bc_todo_assignees')
        .select('person_id, person:bc_people(id, name, email, is_active)')
        .eq('todo_id', todoDbId),
      supabaseAdmin
        .from('bc_comments')
        .select('author_person_id, author:bc_people(id, name, email, is_active)')
        .eq('parent_type', 'todo')
        .eq('parent_id', todoDbId),
      supabaseAdmin
        .from('bc_people')
        .select('id, bc_id, name, email, is_active, attachable_sgid')
        .limit(5000),
      supabaseAdmin
        .from('users')
        .select('full_name, email, is_active')
        .eq('is_active', true),
    ])

    const todo: any = todoRes.data
    if (!todo) {
      return { sent: false, recipients: [], skippedReason: 'todo_not_found' }
    }

    const allPeople: BasecampPersonLookupRow[] = allPeopleRes.data || []
    const personByUuid = new Map<string, BasecampPersonLookupRow>()
    for (const p of allPeople) {
      if (p.id) personByUuid.set(p.id, p)
    }

    const projectObj = Array.isArray(todo.project) ? todo.project[0] : todo.project
    const listObj = Array.isArray(todo.todolist) ? todo.todolist[0] : todo.todolist
    let creatorObj = Array.isArray(todo.creator) ? todo.creator[0] : todo.creator

    if (!creatorObj && todo.created_by_person_id) {
      creatorObj = personByUuid.get(todo.created_by_person_id) || null
    }

    // Build name -> active user email fallback map (always canonicalized + deliverable so login-only mailboxes never bounce)
    const emailGuardCtx = await loadEmailDeliverabilityContext(supabaseAdmin)
    const userEmailByNormName = new Map<string, string>()
    for (const u of activeUsersRes.data || []) {
      const rawEm = canonicalizeBasecampEmail(u.email)
      const checked = rawEm ? resolveSingleRecipientEmail(rawEm, emailGuardCtx) : null
      if (checked?.deliverable && checked.resolvedEmail) {
        const nk = normalizePersonName(u.full_name)
        if (nk) userEmailByNormName.set(nk, checked.resolvedEmail)
        if (nk === 'roque') {
          userEmailByNormName.set('carlos roque velasquez', checked.resolvedEmail)
          userEmailByNormName.set('carlos roque', checked.resolvedEmail)
        }
      }
    }

    const resolveValidEmail = (person: any): string | null => {
      if (!person || person.is_active === false) return null
      const raw = !isMaskedOrEmptyEmail(person.email) ? canonicalizeBasecampEmail(person.email) : ''
      if (raw && VALID_EMAIL_REGEX.test(raw)) {
        const checked = resolveSingleRecipientEmail(raw, emailGuardCtx)
        if (checked.deliverable && checked.resolvedEmail) {
          return checked.resolvedEmail
        }
      }
      const nk = normalizePersonName(person.name)
      if (nk && userEmailByNormName.has(nk)) {
        return userEmailByNormName.get(nk) || null
      }
      return null
    }

    // 2. Collect all involved people (Assignees + Creator + Commenters + @Mentioned + Completion Subscribers)
    const assigneePeople: any[] = []
    for (const row of assigneesRes.data || []) {
      const p = Array.isArray((row as any).person) ? (row as any).person[0] : (row as any).person
      if (p) assigneePeople.push(p)
    }

    const commenterPeople: any[] = []
    for (const row of commentsRes.data || []) {
      const p = Array.isArray((row as any).author) ? (row as any).author[0] : (row as any).author
      if (p) commenterPeople.push(p)
    }

    const mentionedInComment = extractMentionedPeopleFromHtml(commentHtml, allPeople)
    const mentionedInDesc = extractMentionedPeopleFromHtml(todo.description, allPeople)
    const mentionedPeople = [...mentionedInComment, ...mentionedInDesc]

    const completionSubPeople: BasecampPersonLookupRow[] = []
    if (event === 'completed' && Array.isArray(todo.completion_subscriber_ids)) {
      for (const subUuid of todo.completion_subscriber_ids) {
        const subPerson = personByUuid.get(String(subUuid))
        if (subPerson) completionSubPeople.push(subPerson)
      }
    }

    const canonicalTodoActorEmail = canonicalizeBasecampEmail(
      actorEmail || (actorPersonId ? personByUuid.get(actorPersonId)?.email : null)
    )
    const actorExcludedEmails = getEquivalentActorEmails(canonicalTodoActorEmail)
    const recipientEmailsSet = new Set<string>()

    if (Array.isArray(overrideRecipients) && overrideRecipients.length > 0) {
      for (const r of overrideRecipients) {
        const clean = canonicalizeBasecampEmail(String(r || ''))
        if (VALID_EMAIL_REGEX.test(clean)) recipientEmailsSet.add(clean)
      }
    } else if (event === 'assigned') {
      // Notify assignees (including explicit self-assign on creation unless excludeActorOnAssigned is set)
      for (const a of assigneePeople) {
        if (excludeActorOnAssigned && actorPersonId && a.id === actorPersonId) continue
        const em = resolveValidEmail(a)
        if (!em) continue
        if (excludeActorOnAssigned && actorExcludedEmails.has(em)) continue
        recipientEmailsSet.add(em)
      }
      if (creatorObj && creatorObj.id !== actorPersonId) {
        const creatorEm = resolveValidEmail(creatorObj)
        if (creatorEm && !actorExcludedEmails.has(creatorEm)) {
          recipientEmailsSet.add(creatorEm)
        }
      }
      // Also notify any @mentioned collaborators in description/comment (excluding actor to prevent self-spam)
      for (const mp of mentionedPeople) {
        if (!mp || (actorPersonId && mp.id === actorPersonId)) continue
        const em = resolveValidEmail(mp)
        if (em && !actorExcludedEmails.has(em)) {
          recipientEmailsSet.add(em)
        }
      }
    } else {
      // On comment / complete / reopen / update: notify ALL involved + @mentioned + completion subscribers except the actor
      const allInvolved = [
        ...assigneePeople,
        ...(creatorObj ? [creatorObj] : []),
        ...commenterPeople,
        ...mentionedPeople,
        ...completionSubPeople,
      ]
      for (const person of allInvolved) {
        if (!person) continue
        if (actorPersonId && person.id === actorPersonId) continue
        const em = resolveValidEmail(person)
        if (!em || actorExcludedEmails.has(em)) continue
        recipientEmailsSet.add(em)
      }
    }

    const recipients = Array.from(recipientEmailsSet)
    if (recipients.length === 0) {
      return { sent: false, recipients: [], skippedReason: 'no_eligible_recipients' }
    }

    // 3. Build clean Tacos Gavilan HTML & Plain-Text Email
    const appBaseUrl = resolveAppBaseUrl(appOrigin)
    const projectBcId = projectObj?.bc_id || ''
    const projectName = projectObj?.name || 'Basecamp'
    const listName = listObj?.name || 'To-dos'
    const todoTitle = todo.title || 'Sin título'
    const displayActor = (
      canonicalizeBasecampDisplayName(actorName, canonicalTodoActorEmail) ||
      creatorObj?.name ||
      'Equipo Tacos Gavilan'
    ).trim()
    const assigneeNames = assigneePeople.map((a) => a.name).filter(Boolean)
    const creatorName = creatorObj?.name || displayActor
    const startsFormatted = formatDueDateEs(todo.starts_on)
    const dueFormatted = formatDueDateEs(todo.due_date)
    const dateRangeLabel =
      startsFormatted && dueFormatted
        ? `${startsFormatted} → ${dueFormatted}`
        : dueFormatted || startsFormatted || ''
    const nowFormatted = formatCaliforniaDateTime(new Date().toISOString())
    const directTodoUrl = projectBcId
      ? `${appBaseUrl}/basecamp?project=${encodeURIComponent(String(projectBcId))}&tool=todos&todoId=${encodeURIComponent(todo.id)}`
      : `${appBaseUrl}/basecamp`

    const { bodyHtml: rawDescBodyHtml, attachments: descAttachments } = cleanRichHtmlForEmail(
      todo.description,
      appBaseUrl,
      allPeople
    )
    const { bodyHtml: rawCommentBodyHtml, attachments: commentAttachments } = cleanRichHtmlForEmail(
      commentHtml,
      appBaseUrl,
      allPeople
    )
    const [descBodyHtml, commentBodyHtml] = await Promise.all([
      resolvePublicImagesForEmailHtml(rawDescBodyHtml),
      resolvePublicImagesForEmailHtml(rawCommentBodyHtml),
    ])
    const meta = EVENT_META[event]

    const allAttachments = [...commentAttachments, ...descAttachments]
    const attachmentsButtonsHtml =
      allAttachments.length > 0
        ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;">
             <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Archivos adjuntos</div>
             ${allAttachments
               .map(
                 (att) =>
                   `<a href="${escapeHtml(att.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 8px 6px 0;padding:7px 12px;border-radius:8px;background:#f1f5f9;border:1px solid #cbd5e1;color:#0284c7;text-decoration:none;font-size:12.5px;font-weight:600;">${att.isVideo ? '🎬' : '📎'} ${escapeHtml(att.filename)} — ${att.isVideo ? 'Ver / Descargar video' : 'Descargar'}</a>`
               )
               .join('')}
           </div>`
        : ''

    const cleanListName = stripStoreNumberTokensInText(listName)
    const cleanProjectName = stripStoreNumberTokensInText(projectName)
    const subject = `${meta.subjectPrefix}: ${todoTitle} (${cleanListName} · ${cleanProjectName})`

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          <!-- Header -->
          <tr>
            <td style="background-color:${meta.headerBg};padding:22px 26px;">
              <div style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${meta.accent};color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.05em;">
                ${escapeHtml(meta.badge)}
              </div>
              <div style="margin-top:10px;font-size:13px;color:#cbd5e1;font-weight:600;">
                Tacos Gavilan · ${escapeHtml(cleanProjectName)} › ${escapeHtml(cleanListName)}
              </div>
              <h1 style="margin:6px 0 0;font-size:21px;line-height:1.35;color:#ffffff;font-weight:800;">
                ${escapeHtml(todoTitle)}
              </h1>
            </td>
          </tr>

          <!-- Action Summary Banner -->
          <tr>
            <td style="padding:18px 26px 0;">
              <div style="padding:12px 16px;border-radius:10px;background-color:#f8fafc;border:1px solid #e2e8f0;font-size:14px;color:#334155;">
                <strong style="color:#0f172a;">${escapeHtml(displayActor)}</strong> ${escapeHtml(meta.actionSummary)} · <span style="color:#64748b;font-size:12.5px;">${escapeHtml(nowFormatted)}</span>
              </div>
            </td>
          </tr>

          ${
            commentBodyHtml
              ? `<!-- New Comment Block -->
          <tr>
            <td style="padding:18px 26px 0;">
              <div style="font-size:11px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">
                💬 Comentario de ${escapeHtml(displayActor)}
              </div>
              <div style="padding:16px;border-radius:12px;background-color:#eff6ff;border:1px solid #bfdbfe;font-size:14px;line-height:1.6;color:#1e293b;">
                ${commentBodyHtml}
              </div>
            </td>
          </tr>`
              : ''
          }

          <!-- Metadata Table -->
          <tr>
            <td style="padding:18px 26px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
                <tr>
                  <td style="padding:6px 0;color:#64748b;width:130px;font-weight:600;">Solicitado por:</td>
                  <td style="padding:6px 0;color:#0f172a;font-weight:700;">${escapeHtml(creatorName)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Asignado a:</td>
                  <td style="padding:6px 0;color:#0f172a;font-weight:600;">${
                    assigneeNames.length > 0
                      ? escapeHtml(assigneeNames.join(', '))
                      : '<span style="color:#94a3b8;">Sin asignar</span>'
                  }</td>
                </tr>
                ${
                  dateRangeLabel
                    ? `<tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Fecha límite:</td>
                  <td style="padding:6px 0;color:#b45309;font-weight:700;">📅 ${escapeHtml(dateRangeLabel)}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Lista / Área:</td>
                  <td style="padding:6px 0;color:#0f172a;">${escapeHtml(cleanProjectName)} — <strong>${escapeHtml(cleanListName)}</strong></td>
                </tr>
              </table>
            </td>
          </tr>

          ${
            descBodyHtml || attachmentsButtonsHtml
              ? `<!-- Notes & Attachments -->
          <tr>
            <td style="padding:16px 26px 0;">
              <div style="padding:16px;border-radius:12px;background-color:#f8fafc;border:1px solid #e2e8f0;">
                ${
                  descBodyHtml
                    ? `<div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Notas / Detalles</div>
                       <div style="font-size:14px;line-height:1.6;color:#1e293b;">${descBodyHtml}</div>`
                    : ''
                }
                ${attachmentsButtonsHtml}
              </div>
            </td>
          </tr>`
              : ''
          }

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:24px 26px 26px;">
              <a href="${escapeHtml(directTodoUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 26px;border-radius:10px;background-color:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
                Abrir Caso / Pedido en Sistema TEG →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 26px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:11.5px;color:#64748b;">
              Notificación automática de <strong>Tacos Gavilan</strong> · Sistema de Monitoreo (Basecamp)
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    const plainComment = commentHtml ? cleanPlainSnippetWithMentions(commentHtml, allPeople) : ''
    const plainDesc = todo.description ? cleanPlainSnippetWithMentions(todo.description, allPeople) : ''

    const plainText = [
      `${meta.badge} — Tacos Gavilan`,
      `Proyecto: ${projectName} > ${listName}`,
      `Tarea: ${todoTitle}`,
      `Acción: ${displayActor} ${meta.actionSummary} (${nowFormatted})`,
      plainComment ? `Comentario: ${plainComment}` : '',
      assigneeNames.length > 0 ? `Asignado a: ${assigneeNames.join(', ')}` : '',
      dateRangeLabel ? `Fecha límite: ${dateRangeLabel}` : '',
      plainDesc ? `Notas: ${plainDesc}` : '',
      `Abrir directamente: ${directTodoUrl}`,
    ]
      .filter(Boolean)
      .join('\n')

    const cleanReplyTo =
      canonicalTodoActorEmail &&
      !isMaskedOrEmptyEmail(canonicalTodoActorEmail) &&
      VALID_EMAIL_REGEX.test(canonicalTodoActorEmail)
        ? canonicalTodoActorEmail
        : undefined

    const mailRes = await sendSystemEmail({
      fromName: `${displayActor} · Tacos Gavilan`,
      to: recipients,
      replyTo: cleanReplyTo,
      subject,
      html,
      text: plainText,
    })

    console.log(
      `📧 [Basecamp Todo Email] Sent "${event}" notification for "${todoTitle}" to [${recipients.join(', ')}] (msgId: ${mailRes.messageId})`
    )

    return {
      sent: true,
      recipients,
      messageId: mailRes.messageId,
    }
  } catch (err: any) {
    console.error(`⚠️ [Basecamp Todo Email] Non-fatal error sending "${event}" email for ${todoDbId}:`, err?.message || err)
    return {
      sent: false,
      recipients: [],
      skippedReason: err?.message || 'send_error',
    }
  }
}
function resolveMessageCategoryMeta(rawCategory?: string | null): { emoji: string; label: string } {
  const norm = String(rawCategory || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  if (!norm || norm === 'general' || norm.includes('anuncio') || norm.includes('announcement')) {
    return { emoji: '📢', label: 'Anuncio' }
  }
  if (norm === 'fyi' || norm.includes('fyi') || norm.includes('informacion')) {
    return { emoji: '✨', label: 'FYI' }
  }
  if (norm.includes('heartbeat') || norm.includes('pulso')) {
    return { emoji: '❤️', label: 'Pulso de Equipo' }
  }
  if (norm.includes('pitch') || norm.includes('propuesta') || norm.includes('idea')) {
    return { emoji: '💡', label: 'Propuesta / Idea' }
  }
  if (norm.includes('question') || norm.includes('pregunta')) {
    return { emoji: '👋', label: 'Pregunta' }
  }
  if (norm.includes('procedimiento') || norm.includes('procedure') || norm.includes('guide')) {
    return { emoji: '📘', label: 'Procedimiento' }
  }
  if (norm.includes('alerta') || norm.includes('alert') || norm.includes('urgent')) {
    return { emoji: '🚨', label: 'Alerta' }
  }
  return { emoji: '📢', label: String(rawCategory).trim() || 'Anuncio' }
}

/**
 * Envía correo HTML oficial de **Tacos Gavilan** + inserta notificaciones `bc_notifications` (`recording_type: 'message'`)
 * al publicar (`published`), actualizar con menciones (`updated`) o comentar (`commented`) un Anuncio (`Message Board`).
 */
export async function sendBasecampMessageNotificationEmail(
  params: SendBasecampMessageEmailParams
): Promise<SendBasecampMessageEmailResult> {
  const {
    event,
    messageDbId,
    actorPersonId,
    actorName,
    actorEmail,
    commentHtml,
    notifyMode,
    selectedPersonIds,
    appOrigin,
    overrideRecipients,
    mentionedPersonIdsOverride,
    onlyMentionedOnComment,
    skipInAppNotifications,
  } = params

  if (!messageDbId) {
    return { sent: false, recipients: [], notifiedPersonIds: [], inAppInsertedCount: 0, skippedReason: 'missing_messageDbId' }
  }

  try {
    const [msgRes, allPeopleRes, activeUsersRes] = await Promise.all([
      supabaseAdmin
        .from('bc_messages')
        .select(`
          id, bc_id, title, content, category, is_pinned, author_person_id, project_id, created_at,
          project:bc_projects(id, bc_id, name),
          author:bc_people(id, name, email, is_active)
        `)
        .eq('id', messageDbId)
        .maybeSingle(),
      supabaseAdmin
        .from('bc_people')
        .select('id, bc_id, name, email, is_active, attachable_sgid')
        .limit(5000),
      supabaseAdmin
        .from('users')
        .select('full_name, email, is_active')
        .eq('is_active', true),
    ])

    const msg: any = msgRes.data
    if (!msg) {
      return { sent: false, recipients: [], notifiedPersonIds: [], inAppInsertedCount: 0, skippedReason: 'message_not_found' }
    }

    const allPeople: BasecampPersonLookupRow[] = allPeopleRes.data || []
    const personByUuid = new Map<string, BasecampPersonLookupRow>()
    for (const p of allPeople) {
      if (p.id) personByUuid.set(p.id, p)
    }

    const projectObj = Array.isArray(msg.project) ? msg.project[0] : msg.project
    const projectUuid: string = msg.project_id || projectObj?.id || ''
    let authorObj = Array.isArray(msg.author) ? msg.author[0] : msg.author
    if (!authorObj && msg.author_person_id) {
      authorObj = personByUuid.get(msg.author_person_id) || null
    }

    const effectiveMode: BasecampMessageNotifyMode =
      notifyMode === 'none' || notifyMode === 'selected' || notifyMode === 'all' ? notifyMode : 'all'
    const hasOverrideRecipients = Array.isArray(overrideRecipients) && overrideRecipients.length > 0

    let projectMemberPeople: BasecampPersonLookupRow[] = []
    if (event === 'published' && effectiveMode === 'all' && projectUuid && !hasOverrideRecipients) {
      const { data: memRows } = await supabaseAdmin
        .from('bc_memberships')
        .select('person_id, person:bc_people(id, bc_id, name, email, is_active)')
        .eq('project_id', projectUuid)

      for (const row of memRows || []) {
        const rel = Array.isArray((row as any).person) ? (row as any).person[0] : (row as any).person
        const resolvedPerson = rel || (row.person_id ? personByUuid.get(row.person_id) : null)
        if (resolvedPerson && resolvedPerson.is_active !== false) {
          projectMemberPeople.push(resolvedPerson)
        }
      }
    }

    const emailGuardCtx = await loadEmailDeliverabilityContext(supabaseAdmin)
    const userEmailByNormName = new Map<string, string>()
    for (const u of activeUsersRes.data || []) {
      const rawEm = canonicalizeBasecampEmail(u.email)
      const checked = rawEm ? resolveSingleRecipientEmail(rawEm, emailGuardCtx) : null
      if (checked?.deliverable && checked.resolvedEmail) {
        const nk = normalizePersonName(u.full_name)
        if (nk) userEmailByNormName.set(nk, checked.resolvedEmail)
        if (nk === 'roque') {
          userEmailByNormName.set('carlos roque velasquez', checked.resolvedEmail)
          userEmailByNormName.set('carlos roque', checked.resolvedEmail)
        }
      }
    }

    const resolveValidEmail = (person: any): string | null => {
      if (!person || person.is_active === false) return null
      const raw = !isMaskedOrEmptyEmail(person.email) ? canonicalizeBasecampEmail(person.email) : ''
      if (raw && VALID_EMAIL_REGEX.test(raw)) {
        const checked = resolveSingleRecipientEmail(raw, emailGuardCtx)
        if (checked.deliverable && checked.resolvedEmail) {
          return checked.resolvedEmail
        }
      }
      const nk = normalizePersonName(person.name)
      if (nk && userEmailByNormName.has(nk)) {
        return userEmailByNormName.get(nk) || null
      }
      return null
    }

    const inferredActorEmail =
      canonicalizeBasecampEmail(
        actorEmail || (actorPersonId ? personByUuid.get(actorPersonId)?.email : null)
      ) || null
    const actorExcludedEmails = getEquivalentActorEmails(inferredActorEmail)

    const isSelfActorPerson = (person: any): boolean => {
      if (!person) return true
      if (actorPersonId && person.id === actorPersonId) return true
      const rawEm = !isMaskedOrEmptyEmail(person.email) ? canonicalizeBasecampEmail(person.email) : ''
      if (rawEm && actorExcludedEmails.has(rawEm)) return true
      const fallbackEm = resolveValidEmail(person)
      if (fallbackEm && actorExcludedEmails.has(fallbackEm)) return true
      return false
    }

    const rawMentionedPeople =
      event === 'commented'
        ? extractMentionedPeopleFromHtml(commentHtml, allPeople)
        : extractMentionedPeopleFromHtml(msg.content, allPeople)

    const overrideMentionSet = Array.isArray(mentionedPersonIdsOverride)
      ? new Set(mentionedPersonIdsOverride.filter(Boolean))
      : null

    const mentionedPeople = overrideMentionSet
      ? Array.from(overrideMentionSet)
          .map((uid) => personByUuid.get(uid))
          .filter((p): p is BasecampPersonLookupRow => Boolean(p && p.is_active !== false))
      : rawMentionedPeople.filter((p) => p && p.is_active !== false)

    const eligibleMentionedPeople = mentionedPeople.filter((p) => !isSelfActorPerson(p))

    const involvedPeopleForInApp: BasecampPersonLookupRow[] = []
    const recipientEmailsSet = new Set<string>()
    let allowExplicitSelfInApp = false

    const addPersonRecipient = (person: any, excludeSelf: boolean) => {
      if (!person || person.is_active === false) return
      if (excludeSelf && isSelfActorPerson(person)) return
      const em = resolveValidEmail(person)
      if (!em) return
      if (excludeSelf && actorExcludedEmails.has(em)) return
      recipientEmailsSet.add(em)
    }

    if (event === 'published') {
      if (effectiveMode === 'none') {
        // Strictly @mentioned people only (or nobody if no @mentions)
        for (const mp of eligibleMentionedPeople) {
          addPersonRecipient(mp, true)
        }
      } else if (effectiveMode === 'selected') {
        allowExplicitSelfInApp = true
        const cleanSelectedIds = Array.from(new Set((selectedPersonIds || []).filter(Boolean)))
        for (const pid of cleanSelectedIds) {
          const sp = personByUuid.get(pid)
          if (sp && sp.is_active !== false) {
            involvedPeopleForInApp.push(sp)
            addPersonRecipient(sp, false)
          }
        }
        for (const mp of eligibleMentionedPeople) {
          addPersonRecipient(mp, true)
        }
      } else {
        // 'all': all active project members + @mentioned (excluding actor & equivalent actor emails)
        for (const member of projectMemberPeople) {
          if (!isSelfActorPerson(member)) {
            involvedPeopleForInApp.push(member)
            addPersonRecipient(member, true)
          }
        }
        for (const mp of eligibleMentionedPeople) {
          addPersonRecipient(mp, true)
        }
      }
    } else if (event === 'updated') {
      // Strictly @mentioned people in updated content (excluding actor)
      for (const mp of eligibleMentionedPeople) {
        addPersonRecipient(mp, true)
      }
    } else if (event === 'commented') {
      // Announcement author + @mentioned people in comment (excluding the commenter to prevent 65-store reply spam!)
      if (!onlyMentionedOnComment && authorObj && authorObj.is_active !== false && !isSelfActorPerson(authorObj)) {
        involvedPeopleForInApp.push(authorObj)
        addPersonRecipient(authorObj, true)
      }
      for (const mp of eligibleMentionedPeople) {
        addPersonRecipient(mp, true)
      }
    }

    if (hasOverrideRecipients) {
      recipientEmailsSet.clear()
      for (const r of overrideRecipients!) {
        const clean = canonicalizeBasecampEmail(String(r || ''))
        if (VALID_EMAIL_REGEX.test(clean)) recipientEmailsSet.add(clean)
      }
    }

    let inAppInsertedCount = 0
    let notifiedPersonIds: string[] = []
    if (!skipInAppNotifications && projectUuid) {
      const mentionedIdsForInApp = hasOverrideRecipients
        ? eligibleMentionedPeople
            .filter((p) => {
              const em = resolveValidEmail(p)
              return Boolean(em && recipientEmailsSet.has(em))
            })
            .map((p) => p.id)
        : eligibleMentionedPeople.map((p) => p.id)

      const involvedIdsForInApp = hasOverrideRecipients
        ? allPeople
            .filter((p) => {
              if (!p.id || p.is_active === false) return false
              const em = resolveValidEmail(p)
              return Boolean(em && recipientEmailsSet.has(em) && !mentionedIdsForInApp.includes(p.id))
            })
            .map((p) => p.id)
        : involvedPeopleForInApp.map((p) => p.id)

      if (mentionedIdsForInApp.length > 0 || involvedIdsForInApp.length > 0) {
        const inAppRes = await createBasecampInAppNotifications({
          projectUuid,
          recordingType: 'message',
          recordingUuid: msg.id,
          actorPersonId,
          actorName:
            canonicalizeBasecampDisplayName(actorName, inferredActorEmail) ||
            authorObj?.name ||
            'Equipo Tacos Gavilan',
          actorEmail: inferredActorEmail,
          title: msg.title || 'Anuncio',
          rawHtml: undefined,
          mentionedPersonIds: mentionedIdsForInApp,
          involvedPersonIds: involvedIdsForInApp,
          defaultType: event === 'commented' ? 'comment' : event === 'published' ? 'message' : 'mention',
          allowActorInTargets: allowExplicitSelfInApp || hasOverrideRecipients,
        })
        inAppInsertedCount = inAppRes.insertedCount
        notifiedPersonIds = inAppRes.recipientPersonIds
      }
    }

    const recipients = Array.from(recipientEmailsSet)
    if (recipients.length === 0) {
      return {
        sent: false,
        recipients: [],
        notifiedPersonIds,
        inAppInsertedCount,
        skippedReason: 'no_eligible_recipients',
      }
    }

    const appBaseUrl = resolveAppBaseUrl(appOrigin)
    const projectBcId = projectObj?.bc_id || ''
    const projectName = projectObj?.name || 'Basecamp'
    const msgTitle = msg.title || 'Sin título'
    const catMeta = resolveMessageCategoryMeta(msg.category)
    const displayActor = (
      canonicalizeBasecampDisplayName(actorName, inferredActorEmail) ||
      authorObj?.name ||
      'Equipo Tacos Gavilan'
    ).trim()
    const authorDisplay = (authorObj?.name || displayActor).trim()
    const nowFormatted = formatCaliforniaDateTime(new Date().toISOString())
    const directMessageUrl = projectBcId
      ? `${appBaseUrl}/basecamp?project=${encodeURIComponent(String(projectBcId))}&tool=messages&messageId=${encodeURIComponent(msg.id)}`
      : `${appBaseUrl}/basecamp`

    const { bodyHtml: rawMsgBodyHtml, attachments: msgAttachments } = cleanRichHtmlForEmail(
      msg.content,
      appBaseUrl,
      allPeople
    )
    const { bodyHtml: rawCommentBodyHtml, attachments: commentAttachments } = cleanRichHtmlForEmail(
      commentHtml,
      appBaseUrl,
      allPeople
    )
    const [msgBodyHtml, commentBodyHtml] = await Promise.all([
      resolvePublicImagesForEmailHtml(rawMsgBodyHtml),
      resolvePublicImagesForEmailHtml(rawCommentBodyHtml),
    ])

    const allAttachments = [...commentAttachments, ...msgAttachments]
    const attachmentsButtonsHtml =
      allAttachments.length > 0
        ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;">
             <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Archivos y videos adjuntos</div>
             ${allAttachments
               .map(
                 (att) =>
                   `<a href="${escapeHtml(att.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 8px 6px 0;padding:7px 12px;border-radius:8px;background:#f1f5f9;border:1px solid #cbd5e1;color:#0284c7;text-decoration:none;font-size:12.5px;font-weight:600;">${att.isVideo ? '🎬' : '📎'} ${escapeHtml(att.filename)} — ${att.isVideo ? 'Ver / Descargar video' : 'Descargar'}</a>`
               )
               .join('')}
           </div>`
        : ''

    const headerBadge =
      event === 'commented'
        ? `💬 NUEVO COMENTARIO · ${catMeta.emoji} ${catMeta.label.toUpperCase()}`
        : event === 'updated'
        ? `🔔 ANUNCIO ACTUALIZADO · ${catMeta.emoji} ${catMeta.label.toUpperCase()}`
        : `${catMeta.emoji} ${catMeta.label.toUpperCase()}`

    const accentColor = event === 'commented' ? '#2563eb' : '#0284c7'
    const actionSummary =
      event === 'commented'
        ? 'comentó en este anuncio'
        : event === 'updated'
        ? 'actualizó este anuncio'
        : 'publicó un nuevo anuncio'

    const cleanMsgProjectName = stripStoreNumberTokensInText(projectName)
    const subject =
      event === 'commented'
        ? `💬 Re: ${msgTitle} (${cleanMsgProjectName})`
        : event === 'updated'
        ? `🔔 ${catMeta.emoji} ${msgTitle} (${cleanMsgProjectName})`
        : `${catMeta.emoji} ${catMeta.label}: ${msgTitle} (${cleanMsgProjectName})`

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a;padding:22px 26px;">
              <div style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${accentColor};color:#ffffff;font-size:11px;font-weight:800;letter-spacing:0.05em;">
                ${escapeHtml(headerBadge)}
              </div>
              <div style="margin-top:10px;font-size:13px;color:#cbd5e1;font-weight:600;">
                Tacos Gavilan · ${escapeHtml(cleanMsgProjectName)} › Tablón de Anuncios
              </div>
              <h1 style="margin:6px 0 0;font-size:21px;line-height:1.35;color:#ffffff;font-weight:800;">
                ${escapeHtml(msgTitle)}
              </h1>
            </td>
          </tr>

          <!-- Action Summary Banner -->
          <tr>
            <td style="padding:18px 26px 0;">
              <div style="padding:12px 16px;border-radius:10px;background-color:#f8fafc;border:1px solid #e2e8f0;font-size:14px;color:#334155;">
                <strong style="color:#0f172a;">${escapeHtml(displayActor)}</strong> ${escapeHtml(actionSummary)} · <span style="color:#64748b;font-size:12.5px;">${escapeHtml(nowFormatted)}</span>
              </div>
            </td>
          </tr>

          ${
            commentBodyHtml
              ? `<!-- New Comment Block -->
          <tr>
            <td style="padding:18px 26px 0;">
              <div style="font-size:11px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">
                💬 Comentario de ${escapeHtml(displayActor)}
              </div>
              <div style="padding:16px;border-radius:12px;background-color:#eff6ff;border:1px solid #bfdbfe;font-size:14px;line-height:1.6;color:#1e293b;">
                ${commentBodyHtml}
              </div>
            </td>
          </tr>`
              : ''
          }

          <!-- Metadata Table -->
          <tr>
            <td style="padding:18px 26px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
                <tr>
                  <td style="padding:6px 0;color:#64748b;width:130px;font-weight:600;">Publicado por:</td>
                  <td style="padding:6px 0;color:#0f172a;font-weight:700;">${escapeHtml(authorDisplay)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Categoría:</td>
                  <td style="padding:6px 0;color:#0f172a;font-weight:600;">${escapeHtml(`${catMeta.emoji} ${catMeta.label}`)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Proyecto:</td>
                  <td style="padding:6px 0;color:#0f172a;">${escapeHtml(cleanMsgProjectName)} — <strong>Tablón de Anuncios</strong></td>
                </tr>
              </table>
            </td>
          </tr>

          ${
            msgBodyHtml || attachmentsButtonsHtml
              ? `<!-- Message Content & Attachments -->
          <tr>
            <td style="padding:16px 26px 0;">
              <div style="padding:16px;border-radius:12px;background-color:#f8fafc;border:1px solid #e2e8f0;">
                ${
                  msgBodyHtml
                    ? `<div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">${
                        event === 'commented' ? 'Anuncio original' : 'Contenido del anuncio'
                      }</div>
                       <div style="font-size:14px;line-height:1.6;color:#1e293b;">${msgBodyHtml}</div>`
                    : ''
                }
                ${attachmentsButtonsHtml}
              </div>
            </td>
          </tr>`
              : ''
          }

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:24px 26px 26px;">
              <a href="${escapeHtml(directMessageUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 26px;border-radius:10px;background-color:#0284c7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
                Ver Anuncio en Sistema TEG →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 26px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:11.5px;color:#64748b;">
              Notificación automática de <strong>Tacos Gavilan</strong> · Sistema de Monitoreo (Basecamp)
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    const plainComment = commentHtml ? cleanPlainSnippetWithMentions(commentHtml, allPeople) : ''
    const plainMsg = msg.content ? cleanPlainSnippetWithMentions(msg.content, allPeople) : ''

    const plainText = [
      `${headerBadge} — Tacos Gavilan`,
      `Proyecto: ${projectName} > Tablón de Anuncios`,
      `Anuncio: ${msgTitle}`,
      `Categoría: ${catMeta.emoji} ${catMeta.label}`,
      `Acción: ${displayActor} ${actionSummary} (${nowFormatted})`,
      plainComment ? `Comentario: ${plainComment}` : '',
      plainMsg ? `Mensaje: ${plainMsg}` : '',
      `Abrir directamente: ${directMessageUrl}`,
    ]
      .filter(Boolean)
      .join('\n')

    const cleanReplyTo =
      inferredActorEmail && !isMaskedOrEmptyEmail(inferredActorEmail) && VALID_EMAIL_REGEX.test(inferredActorEmail)
        ? canonicalizeBasecampEmail(inferredActorEmail)
        : undefined

    const mailRes = await sendSystemEmail({
      fromName: `${displayActor} · Tacos Gavilan`,
      to: recipients,
      replyTo: cleanReplyTo,
      subject,
      html,
      text: plainText,
    })

    console.log(
      `📧 [Basecamp Message Email] Sent "${event}" notification for "${msgTitle}" to [${recipients.join(', ')}] (msgId: ${mailRes.messageId})`
    )

    return {
      sent: true,
      recipients,
      notifiedPersonIds,
      inAppInsertedCount,
      messageId: mailRes.messageId,
    }
  } catch (err: any) {
    console.error(
      `⚠️ [Basecamp Message Email] Non-fatal error sending "${event}" email for ${messageDbId}:`,
      err?.message || err
    )
    return {
      sent: false,
      recipients: [],
      notifiedPersonIds: [],
      inAppInsertedCount: 0,
      skippedReason: err?.message || 'send_error',
    }
  }
}
