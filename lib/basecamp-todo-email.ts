/**
 * @module lib/basecamp-todo-email
 * @description Motor centralizado de notificaciones por correo electrónico para tareas, casos y pedidos (To-Dos)
 *              del módulo Basecamp de Tacos Gavilan. Notifica automáticamente a cada persona involucrada
 *              (asignados, creador/solicitante y participantes en comentarios) cuando se asigna una nueva tarea,
 *              se publica un nuevo comentario o cambia el estado de la tarea (completada / reabierta / actualizada).
 *
 * @businessRules
 * - Marca oficial exclusiva: **Tacos Gavilan** (jamás "Tacos El Gavilan").
 * - Personas involucradas en un To-Do:
 *   1) Personas asignadas (`bc_todo_assignees` -> `bc_people`).
 *   2) Creador / solicitante original del caso o pedido (`bc_todos.created_by_person_id` -> `bc_people`).
 *   3) Participantes que hayan comentado previamente en el hilo (`bc_comments` `parent_type = 'todo'`).
 * - Resolución de correo electrónico:
 *   * Prioriza `bc_people.email` verificado (ignorando correos enmascarados con `•` o cuentas inactivas).
 *   * Si falta, respalda buscando por nombre normalizado en `public.users` (`is_active = true`).
 * - Prevención de auto-spam:
 *   * En comentarios y cambios de estado (`commented`, `completed`, `reopened`, `updated`), excluye al usuario
 *     que acaba de ejecutar la acción para no enviarse correos repetidos a sí mismo.
 *   * En `assigned` (`create_todo`), notifica a todos los asignados (incluyendo auto-asignación explícita).
 * - Zona horaria oficial: `America/Los_Angeles`.
 *
 * @dataFlow
 * - `/api/basecamp/action` (o `/api/basecamp/webhook` para eventos externos reales) -> `sendBasecampTodoNotificationEmail()`
 *   -> Supabase (`bc_todos`, `bc_todo_assignees`, `bc_comments`, `bc_people`, `users`) -> `sendSystemEmail()` (`lib/system-mailer`).
 *
 * @notes
 * - Operación no bloqueante (best-effort): cualquier error de transporte SMTP se registra en logs sin fallar la escritura en DB.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { sendSystemEmail } from '@/lib/system-mailer'
import {
  isMaskedOrEmptyEmail,
  normalizePersonName,
  stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import { sanitizeBasecampHtml, safeDecodeFilename } from '@/lib/basecamp-html'

export type BasecampTodoEmailEvent = 'assigned' | 'commented' | 'completed' | 'reopened' | 'updated'

export interface SendBasecampTodoEmailParams {
  event: BasecampTodoEmailEvent
  todoDbId: string
  actorPersonId?: string | null
  actorName?: string | null
  actorEmail?: string | null
  commentHtml?: string | null
  appOrigin?: string | null
  /** Optional explicit recipient override strictly for automated smoke tests */
  overrideRecipients?: string[]
}

export interface SendBasecampTodoEmailResult {
  sent: boolean
  recipients: string[]
  messageId?: string
  skippedReason?: string
}

const VALID_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

// Equivalent emails belonging to the same operator so self-actions don't self-notify
const ACTOR_EQUIVALENT_EMAIL_GROUPS: string[][] = [
  ['carlos@tacosgavilan.com', 'roque@tacosgavilan.com'],
  ['alejandro@tacosgavilan.com', 'alex@tacosgavilan.com'],
  ['yasmin@tacosgavilan.com', 'ap@tacosgavilan.com'],
]

function getEquivalentActorEmails(rawEmail?: string | null): Set<string> {
  const set = new Set<string>()
  const clean = (rawEmail || '').trim().toLowerCase()
  if (!clean) return set
  set.add(clean)
  for (const group of ACTOR_EQUIVALENT_EMAIL_GROUPS) {
    if (group.includes(clean)) {
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

function resolveAppBaseUrl(originHint?: string | null): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    originHint,
    'https://sistema.tacosgavilan.com',
  ]
  for (const c of candidates) {
    const trimmed = (c || '').trim().replace(/\/+$/, '')
    if (trimmed && /^https?:\/\//i.test(trimmed) && !trimmed.includes('localhost')) {
      return trimmed
    }
  }
  const fallback = (originHint || '').trim().replace(/\/+$/, '')
  return fallback && /^https?:\/\//i.test(fallback) ? fallback : 'https://sistema.tacosgavilan.com'
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

function cleanRichHtmlForEmail(rawHtml: string | null | undefined, appBaseUrl: string): {
  bodyHtml: string
  attachments: Array<{ filename: string; url: string }>
} {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return { bodyHtml: '', attachments: [] }
  }

  let working = stripTegAuthorBanner(rawHtml).cleanHtml
    .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')

  const attachments: Array<{ filename: string; url: string }> = []
  const bcAttRegex = /<bc-attachment\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
  let match: RegExpExecArray | null
  while ((match = bcAttRegex.exec(working)) !== null) {
    const attrs = match[1] || ''
    const getAttr = (name: string) => {
      const m = attrs.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
      return m ? m[1] : ''
    }
    const ct = getAttr('content-type').toLowerCase()
    const fn = safeDecodeFilename(getAttr('filename') || 'Archivo adjunto')
    const rawUrl = (getAttr('url') || getAttr('href') || '').replace(/&amp;/gi, '&').trim()
    const isImage = ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn)
    if (!isImage && rawUrl) {
      const absUrl = rawUrl.startsWith('/') ? `${appBaseUrl}${rawUrl}` : rawUrl
      if (/^https?:\/\//i.test(absUrl)) {
        attachments.push({ filename: fn, url: absUrl })
      }
    }
  }

  working = working
    .replace(/<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (_m, inner) => {
      if (/<img\b[^>]+>/i.test(inner)) return inner
      return ''
    })
    .replace(/<bc-attachment\b[^>]*\/>/gi, '')

  // Ensure any relative URLs (/api/basecamp/attachment?...) become absolute links
  working = working
    .replace(/(\b(?:src|href)\s*=\s*["'])(\/[^"']+)(["'])/gi, `$1${appBaseUrl}$2$3`)
    .replace(/<img\b([^>]*)>/gi, '<img$1 style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;display:block;border:1px solid #e2e8f0;" />')

  const sanitized = sanitizeBasecampHtml(working).trim()
  const plainCheck = sanitized.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
  const hasImgOrTable = /<(img|table)\b/i.test(sanitized)
  return {
    bodyHtml: plainCheck || hasImgOrTable ? sanitized : '',
    attachments,
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
    actionSummary: 'creó y asignó una tarea',
  },
  commented: {
    badge: '💬 NUEVO COMENTARIO',
    headerBg: '#0f172a',
    accent: '#2563eb',
    subjectPrefix: '💬 Nuevo comentario',
    actionSummary: 'agregó un nuevo comentario',
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
  const { event, todoDbId, actorPersonId, actorName, actorEmail, commentHtml, appOrigin, overrideRecipients } = params
  if (!todoDbId) {
    return { sent: false, recipients: [], skippedReason: 'missing_todoDbId' }
  }

  try {
    // 1. Load Todo, Project, Todolist, Assignees, Comments, and Active Users fallback in parallel
    const [todoRes, assigneesRes, commentsRes, activeUsersRes] = await Promise.all([
      supabaseAdmin
        .from('bc_todos')
        .select(`
          id, bc_id, title, description, due_date, is_completed, completed_at, created_at, created_by_person_id,
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
        .from('users')
        .select('full_name, email, is_active')
        .eq('is_active', true),
    ])

    const todo: any = todoRes.data
    if (!todo) {
      return { sent: false, recipients: [], skippedReason: 'todo_not_found' }
    }

    const projectObj = Array.isArray(todo.project) ? todo.project[0] : todo.project
    const listObj = Array.isArray(todo.todolist) ? todo.todolist[0] : todo.todolist
    let creatorObj = Array.isArray(todo.creator) ? todo.creator[0] : todo.creator

    if (!creatorObj && todo.created_by_person_id) {
      const { data: fallbackCreator } = await supabaseAdmin
        .from('bc_people')
        .select('id, name, email, is_active')
        .eq('id', todo.created_by_person_id)
        .maybeSingle()
      creatorObj = fallbackCreator || null
    }

    // Build name -> active user email fallback map
    const userEmailByNormName = new Map<string, string>()
    for (const u of activeUsersRes.data || []) {
      const em = (u.email || '').trim().toLowerCase()
      if (em && VALID_EMAIL_REGEX.test(em)) {
        const nk = normalizePersonName(u.full_name)
        if (nk) userEmailByNormName.set(nk, em)
      }
    }

    const resolveValidEmail = (person: any): string | null => {
      if (!person || person.is_active === false) return null
      const raw = (person.email || '').trim().toLowerCase()
      if (raw && !isMaskedOrEmptyEmail(raw) && VALID_EMAIL_REGEX.test(raw)) {
        return raw
      }
      const nk = normalizePersonName(person.name)
      if (nk && userEmailByNormName.has(nk)) {
        return userEmailByNormName.get(nk) || null
      }
      return null
    }

    // 2. Collect all involved people (Assignees + Creator + Commenters)
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

    const actorExcludedEmails = getEquivalentActorEmails(actorEmail)
    const recipientEmailsSet = new Set<string>()

    if (Array.isArray(overrideRecipients) && overrideRecipients.length > 0) {
      for (const r of overrideRecipients) {
        const clean = String(r || '').trim().toLowerCase()
        if (VALID_EMAIL_REGEX.test(clean)) recipientEmailsSet.add(clean)
      }
    } else if (event === 'assigned') {
      // On new To-Do creation: notify all assignees (even if self-assigned), plus any other non-actor creator
      for (const a of assigneePeople) {
        const em = resolveValidEmail(a)
        if (em) recipientEmailsSet.add(em)
      }
      if (creatorObj && creatorObj.id !== actorPersonId) {
        const creatorEm = resolveValidEmail(creatorObj)
        if (creatorEm && !actorExcludedEmails.has(creatorEm)) {
          recipientEmailsSet.add(creatorEm)
        }
      }
    } else {
      // On comment / complete / reopen / update: notify ALL involved people (assignees + creator + commenters) except the actor
      const allInvolved = [...assigneePeople, ...(creatorObj ? [creatorObj] : []), ...commenterPeople]
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
    const displayActor = (actorName || creatorObj?.name || 'Equipo Tacos Gavilan').trim()
    const assigneeNames = assigneePeople.map((a) => a.name).filter(Boolean)
    const creatorName = creatorObj?.name || displayActor
    const dueFormatted = formatDueDateEs(todo.due_date)
    const nowFormatted = formatCaliforniaDateTime(new Date().toISOString())
    const directTodoUrl = projectBcId
      ? `${appBaseUrl}/basecamp?project=${encodeURIComponent(String(projectBcId))}&tool=todos&todoId=${encodeURIComponent(todo.id)}`
      : `${appBaseUrl}/basecamp`

    const { bodyHtml: descBodyHtml, attachments: descAttachments } = cleanRichHtmlForEmail(todo.description, appBaseUrl)
    const { bodyHtml: commentBodyHtml, attachments: commentAttachments } = cleanRichHtmlForEmail(commentHtml, appBaseUrl)
    const meta = EVENT_META[event]

    const allAttachments = [...commentAttachments, ...descAttachments]
    const attachmentsButtonsHtml =
      allAttachments.length > 0
        ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;">
             <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Archivos adjuntos</div>
             ${allAttachments
               .map(
                 (att) =>
                   `<a href="${escapeHtml(att.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 8px 6px 0;padding:7px 12px;border-radius:8px;background:#f1f5f9;border:1px solid #cbd5e1;color:#0284c7;text-decoration:none;font-size:12.5px;font-weight:600;">📎 ${escapeHtml(att.filename)} — Descargar</a>`
               )
               .join('')}
           </div>`
        : ''

    const subject = `${meta.subjectPrefix}: ${todoTitle} (${listName} · ${projectName})`

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
                Tacos Gavilan · ${escapeHtml(projectName)} › ${escapeHtml(listName)}
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
                    assigneeNames.length > 0 ? escapeHtml(assigneeNames.join(', ')) : '<span style="color:#94a3b8;">Sin asignar</span>'
                  }</td>
                </tr>
                ${
                  dueFormatted
                    ? `<tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Fecha límite:</td>
                  <td style="padding:6px 0;color:#b45309;font-weight:700;">📅 ${escapeHtml(dueFormatted)}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding:6px 0;color:#64748b;font-weight:600;">Lista / Área:</td>
                  <td style="padding:6px 0;color:#0f172a;">${escapeHtml(projectName)} — <strong>${escapeHtml(listName)}</strong></td>
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

    const plainText = [
      `${meta.badge} — Tacos Gavilan`,
      `Proyecto: ${projectName} > ${listName}`,
      `Tarea: ${todoTitle}`,
      `Acción: ${displayActor} ${meta.actionSummary} (${nowFormatted})`,
      assigneeNames.length > 0 ? `Asignado a: ${assigneeNames.join(', ')}` : '',
      dueFormatted ? `Fecha límite: ${dueFormatted}` : '',
      `Abrir directamente: ${directTodoUrl}`,
    ]
      .filter(Boolean)
      .join('\n')

    const cleanReplyTo =
      actorEmail && !isMaskedOrEmptyEmail(actorEmail) && VALID_EMAIL_REGEX.test(actorEmail.trim())
        ? actorEmail.trim().toLowerCase()
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
