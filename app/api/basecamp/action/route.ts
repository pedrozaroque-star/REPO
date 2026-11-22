/**
 * @module api/basecamp/action
 * @description Ruta POST que maneja las operaciones de escritura (CRUD) desde los componentes UI.
 *              Opera en modo BIDIRECCIONAL: guarda en Supabase (fuente local) Y escribe a Basecamp 3 API.
 *
 * @businessRules
 * - **Supabase primero**: SIEMPRE guarda localmente primero. Si Supabase falla, la operación falla.
 * - **Basecamp después (best-effort)**: Después de guardar en Supabase, intenta escribir en Basecamp API.
 *   Si Basecamp falla, el dato local queda intacto y se loguea el error.
 * - **bc_id real**: Si Basecamp API responde exitosamente, actualiza el `bc_id` en Supabase con el ID real
 *   para mantener consistencia con el sync cron y webhooks.
 * - **Autenticación**: Verifica sesión de personal interno (`verifyStaffAuth`, `teg_token`).
 * - **Mapeo de Usuario**: Relaciona el email/nombre del usuario logueado con un registro en `bc_people`.
 * - **Menciones Outbound (`@Nombre`)**: Convierte `<bc-attachment sgid="X" content-type="application/vnd.basecamp.mention">`
 *   en `<bc-attachment sgid="X"></bc-attachment>` (contrato oficial Basecamp 3) y menciones sintéticas TEG en `<strong>@Nombre</strong>`.
 * - **Replicación de Tareas y Clonado Permanente de Fotos/Adjuntos (`Caso A / B / C`)**:
 *   1) **Caso A (`checklist-photos`)**: Sube el binario a Basecamp 3 vía `uploadBasecampAttachment` -> `<bc-attachment sgid="...">`.
 *   2) **Caso B (`data-orig-bc-sgid`)**: Conserva `data-orig-bc-sgid` como respaldo para emitir `<bc-attachment sgid="X"></bc-attachment>` en adjuntos no clonados (ej. videos pesados o enlaces).
 *   3) **Caso C (`/api/basecamp/attachment?url=...` o `preview.app.basecamp.com` / `storage.app.basecamp.com` / `3.basecampapi.com`)**:
 *      Descarga el blob real en servidor con OAuth (`getValidToken`, siguiendo el redirect 302 a S3 sin reenviar `Authorization`),
 *      lo clona a `checklist-photos` (`basecamp-uploads/replicated-${ts}-${safeName}`) para que la nueva tarea en Supabase tenga su propia
 *      URL pública permanente e independiente, y al espejar (`!skipRemoteMirror`) sube esos mismos bytes a `uploadBasecampAttachment`
 *      generando un `<bc-attachment sgid="...">` fresco en Basecamp 3.
 * - **Papelera Real (`delete_recording`)**: Antes de borrar localmente cualquier registro con `bc_id < 1e11`,
 *   ejecuta `trashRecording(projectBcId, bcId)` en Basecamp 3 para evitar que reviva en futuros syncs.
 * - **Operaciones Soportadas**:
 *   - `complete_todo` / `uncomplete_todo` / `create_todo` / `update_todo` / `move_todo`
 *   - `create_todolist` / `update_todolist`
 *   - `create_todolist_group` / `update_todolist_group`
 *   - `create_message` / `update_message` / `pin_message` / `unpin_message`
 *   - `create_comment` / `update_comment`
 *   - `create_boost` / `delete_boost`
 *   - `create_campfire_line` / `create_answer` / `create_schedule_entry`
 *   - `create_vault` / `create_document` / `create_upload`
 *   - `delete_recording`
 *   - `list_manageable_people` / `create_project` / `update_project` / `update_project_members` (exclusivas Admin)
 * - **Autonomía Standalone & Membresías**:
 *   - Cuando `bc_system_config.runtime_mode === 'standalone'`, fuerza `skipRemoteMirror = true` para latencia cero 100% nativa en Supabase (manteniendo correos TEG y `bc_notifications`), y activa `triggerBasecampAutoCutover` ante `402` / `invalid_grant`.
 *   - Valida membresía en `bc_memberships` para todo usuario no-Admin (`403` si intenta mutar proyectos ajenos).
 *
 * @dataFlow
 * - POST /api/basecamp/action → auth check → resolve person → save to Supabase → mirror to Basecamp API (best-effort)
 *   → email (`sendBasecampTodoNotificationEmail`) + bandeja `Hey!` (`createBasecampInAppNotifications`).
 *
 * @notes
 * - Soporta `skipEmailNotification: true` para pruebas automatizadas sin enviar correos reales a gerentes.
 */

import { NextResponse } from 'next/server'
import { getServerUser, verifyStaffAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  createTodo as bcCreateTodo,
  updateTodo as bcUpdateTodo,
  repositionTodo as bcRepositionTodo,
  completeTodo as bcCompleteTodo,
  uncompleteTodo as bcUncompleteTodo,
  createTodolistRemote as bcCreateTodolistRemote,
  updateTodolistRemote as bcUpdateTodolistRemote,
  createTodolistGroupRemote as bcCreateTodolistGroupRemote,
  createMessage as bcCreateMessage,
  updateMessageRemote as bcUpdateMessageRemote,
  fetchMessageCategories as bcFetchMessageCategories,
  pinRecordingRemote as bcPinRecordingRemote,
  unpinRecordingRemote as bcUnpinRecordingRemote,
  createCampfireLine as bcCreateCampfireLine,
  createComment as bcCreateComment,
  updateCommentRemote as bcUpdateCommentRemote,
  createAnswer as bcCreateAnswer,
  createScheduleEntry as bcCreateScheduleEntry,
  createDocument as bcCreateDocument,
  trashRecording as bcTrashRecording,
  createBoostRemote as bcCreateBoostRemote,
  deleteBoostRemote as bcDeleteBoostRemote,
  BASECAMP_STAFF_ALLOWED_ROLES,
  detectBasecampCutoverReason,
  getBasecampSystemConfig,
  triggerBasecampAutoCutover,
  getValidToken,
  uploadBasecampAttachment,
  syncTodolistCounts,
  syncTodolistGroupCounts,
} from '@/lib/basecamp-api'
import {
  resolveOrCreateTegPerson,
  buildBasecampDescriptionWithAuthor,
  buildBasecampCommentWithAuthor,
  isRealBasecampId,
  canonicalizeBasecampEmail,
  canonicalizeBasecampDisplayName,
  findPersonInListByFuzzyName,
  isMaskedOrEmptyEmail,
  normalizePersonName,
} from '@/lib/basecamp-person-resolver'
import {
  sendBasecampTodoNotificationEmail,
  sendBasecampMessageNotificationEmail,
  createBasecampInAppNotifications,
  convertMentionsForBasecampOutbound,
  extractMentionedPersonIds,
  type BasecampMessageNotifyMode,
} from '@/lib/basecamp-todo-email'
import {
  prepareHtmlForBasecampApi,
  safeDecodeFilename,
  isBasecampMentionAttachment,
  isVideoMimeOrFilename,
} from '@/lib/basecamp-html'

export const dynamic = 'force-dynamic'

/**
 * Helper: intenta ejecutar una operación en Basecamp API como best-effort.
 * Si falla, loguea el error pero NO lanza excepción.
 */
let lastSyntheticActionBcId = 0
function nextSyntheticBcId(): number {
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000)
  lastSyntheticActionBcId = candidate > lastSyntheticActionBcId ? candidate : lastSyntheticActionBcId + 1
  return lastSyntheticActionBcId
}

const ALL_CANONICAL_DOCK_TOOLS = [
  'todoset',
  'message_board',
  'chat',
  'vault',
  'schedule',
  'questionnaire',
] as const

const TOOL_INPUT_TO_CANONICAL_DOCK: Record<string, string> = {
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
  files: 'vault',
  schedule: 'schedule',
  calendar: 'schedule',
  questionnaire: 'questionnaire',
  checkins: 'questionnaire',
  checkin: 'questionnaire',
  'check-ins': 'questionnaire',
  inbox: 'inbox',
}

function normalizeEnabledTools(rawTools: unknown, fallbackTools?: string[] | null): string[] {
  if (!Array.isArray(rawTools)) {
    return Array.isArray(fallbackTools) && fallbackTools.length > 0
      ? fallbackTools
      : [...ALL_CANONICAL_DOCK_TOOLS]
  }
  const normalizedSet = new Set<string>()
  for (const item of rawTools) {
    const key = String(item || '').trim().toLowerCase()
    const mapped = TOOL_INPUT_TO_CANONICAL_DOCK[key]
    if (mapped) normalizedSet.add(mapped)
  }
  return Array.from(normalizedSet)
}

async function ensureProjectToolContainers(
  supabase: any,
  projectUuid: string,
  toolsToEnsure?: string[] | null
): Promise<void> {
  const targetTools = new Set<string>(
    Array.isArray(toolsToEnsure) && toolsToEnsure.length > 0
      ? normalizeEnabledTools(toolsToEnsure)
      : [...ALL_CANONICAL_DOCK_TOOLS]
  )

  const [
    { data: existingTodoset },
    { data: existingBoard },
    { data: existingCampfire },
    { data: existingVault },
    { data: existingSchedule },
    { data: existingQuestionnaire },
  ] = await Promise.all([
    targetTools.has('todoset')
      ? supabase.from('bc_todosets').select('id').eq('project_id', projectUuid).limit(1).maybeSingle()
      : Promise.resolve({ data: { id: 'skip' } }),
    targetTools.has('message_board')
      ? supabase.from('bc_message_boards').select('id').eq('project_id', projectUuid).limit(1).maybeSingle()
      : Promise.resolve({ data: { id: 'skip' } }),
    targetTools.has('chat')
      ? supabase.from('bc_campfires').select('id').eq('project_id', projectUuid).limit(1).maybeSingle()
      : Promise.resolve({ data: { id: 'skip' } }),
    targetTools.has('vault')
      ? supabase
          .from('bc_vaults')
          .select('id')
          .eq('project_id', projectUuid)
          .is('parent_vault_id', null)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: { id: 'skip' } }),
    targetTools.has('schedule')
      ? supabase.from('bc_schedules').select('id').eq('project_id', projectUuid).limit(1).maybeSingle()
      : Promise.resolve({ data: { id: 'skip' } }),
    targetTools.has('questionnaire')
      ? supabase.from('bc_questionnaires').select('id').eq('project_id', projectUuid).limit(1).maybeSingle()
      : Promise.resolve({ data: { id: 'skip' } }),
  ])

  const insertTasks: Promise<any>[] = []
  if (targetTools.has('todoset') && !existingTodoset?.id) {
    insertTasks.push(
      supabase.from('bc_todosets').insert({
        bc_id: nextSyntheticBcId(),
        project_id: projectUuid,
        name: 'To-dos',
      })
    )
  }
  if (targetTools.has('message_board') && !existingBoard?.id) {
    insertTasks.push(
      supabase.from('bc_message_boards').insert({
        bc_id: nextSyntheticBcId(),
        project_id: projectUuid,
      })
    )
  }
  if (targetTools.has('chat') && !existingCampfire?.id) {
    insertTasks.push(
      supabase.from('bc_campfires').insert({
        bc_id: nextSyntheticBcId(),
        project_id: projectUuid,
      })
    )
  }
  if (targetTools.has('vault') && !existingVault?.id) {
    insertTasks.push(
      supabase.from('bc_vaults').insert({
        bc_id: nextSyntheticBcId(),
        project_id: projectUuid,
        name: 'Docs & Files',
        parent_vault_id: null,
      })
    )
  }
  if (targetTools.has('schedule') && !existingSchedule?.id) {
    insertTasks.push(
      supabase.from('bc_schedules').insert({
        bc_id: nextSyntheticBcId(),
        project_id: projectUuid,
      })
    )
  }
  if (targetTools.has('questionnaire') && !existingQuestionnaire?.id) {
    insertTasks.push(
      supabase.from('bc_questionnaires').insert({
        bc_id: nextSyntheticBcId(),
        project_id: projectUuid,
      })
    )
  }

  if (insertTasks.length > 0) {
    await Promise.all(insertTasks)
  }
}

async function hasProjectMembershipAccess(
  supabase: any,
  projectUuid: string,
  authorPersonId: string | null,
  userEmail: string | null,
  isCallerAdmin: boolean
): Promise<boolean> {
  if (isCallerAdmin) return true

  if (authorPersonId) {
    const { data: directRow } = await supabase
      .from('bc_memberships')
      .select('id')
      .eq('project_id', projectUuid)
      .eq('person_id', authorPersonId)
      .limit(1)
      .maybeSingle()
    if (directRow?.id) return true
  }

  const canonEmail = canonicalizeBasecampEmail(userEmail)
  if (canonEmail && !isMaskedOrEmptyEmail(canonEmail)) {
    const { data: memberRows } = await supabase
      .from('bc_memberships')
      .select('person_id, person:bc_people(email, is_active)')
      .eq('project_id', projectUuid)

    for (const m of memberRows || []) {
      const pObj = Array.isArray((m as any).person) ? (m as any).person[0] : (m as any).person
      if (!pObj || pObj.is_active === false) continue
      if (!isMaskedOrEmptyEmail(pObj.email) && canonicalizeBasecampEmail(pObj.email) === canonEmail) {
        return true
      }
    }
  }

  return false
}

async function validatePersonIdsInDb(supabase: any, rawIds: unknown): Promise<string[]> {
  if (!Array.isArray(rawIds)) return []
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const deduped = Array.from(
    new Set(
      rawIds
        .map((id) => String(id || '').trim())
        .filter((id) => uuidRegex.test(id))
    )
  )
  if (deduped.length === 0) return []

  const { data: existingRows } = await supabase
    .from('bc_people')
    .select('id')
    .in('id', deduped)

  const validSet = new Set((existingRows || []).map((r: any) => String(r.id)))
  return deduped.filter((id) => validSet.has(id))
}

async function syncAndListManageablePeople(supabase: any) {
  const MANAGEABLE_TEG_ROLES = [
    'admin',
    'administrador',
    'supervisor',
    'regional_manager',
    'manager',
    'gerente',
    'general_manager',
    'asistente',
    'assistant',
    'basecamp',
  ]

  const [{ data: activeTegUsers }, { data: existingPeopleRows }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, is_active, avatar_url')
      .eq('is_active', true)
      .in('role', MANAGEABLE_TEG_ROLES),
    supabase
      .from('bc_people')
      .select('id, bc_id, name, email, role, avatar_url, title, is_active')
      .limit(5000),
  ])

  const allPeople: any[] = [...(existingPeopleRows || [])]
  const tegRoleByPersonId = new Map<string, string>()

  for (const u of activeTegUsers || []) {
    const rawEmail = String(u.email || '').trim().toLowerCase()
    if (!rawEmail) continue

    const canonEmail = canonicalizeBasecampEmail(rawEmail)
    const displayName =
      canonicalizeBasecampDisplayName(u.full_name, canonEmail) ||
      String(u.full_name || '').trim() ||
      canonEmail.split('@')[0]
    const normRole = String(u.role || 'user').trim().toLowerCase()

    const matched = findPersonInListByFuzzyName(allPeople, displayName, canonEmail)
    if (matched) {
      tegRoleByPersonId.set(matched.id, normRole)
      const needsEmailHeal = canonEmail && isMaskedOrEmptyEmail(matched.email)
      const needsActiveHeal = matched.is_active === false && !/^\s*test\b/i.test(matched.name || '')
      const needsTitleHeal = !String(matched.title || '').trim() && Boolean(normRole)

      if (needsEmailHeal || needsActiveHeal || needsTitleHeal) {
        const patch: Record<string, any> = { updated_at: new Date().toISOString() }
        if (needsEmailHeal) {
          patch.email = canonEmail
          matched.email = canonEmail
        }
        if (needsActiveHeal) {
          patch.is_active = true
          matched.is_active = true
        }
        if (needsTitleHeal) {
          patch.title = normRole
          matched.title = normRole
        }
        await supabase.from('bc_people').update(patch).eq('id', matched.id)
      }
    } else if (rawEmail !== 'roque@tacosgavilan.com') {
      const nowIso = new Date().toISOString()
      const { data: created } = await supabase
        .from('bc_people')
        .insert({
          bc_id: nextSyntheticBcId(),
          name: displayName,
          email: canonEmail,
          avatar_url: u.avatar_url || '',
          role: 'employee',
          title: normRole,
          is_active: true,
          updated_at: nowIso,
        })
        .select('id, bc_id, name, email, role, avatar_url, title, is_active')
        .maybeSingle()

      if (created?.id) {
        allPeople.push(created)
        tegRoleByPersonId.set(created.id, normRole)
      }
    }
  }

  const seenKey = new Set<string>()
  const cleanList: Array<{
    id: string
    bc_id: number | null
    name: string
    email: string
    role: string
    avatar_url: string
    title: string
  }> = []

  for (const p of allPeople) {
    if (p.is_active === false) continue
    const cleanName = String(p.name || '').trim()
    if (!cleanName || /^\s*test\b/i.test(cleanName)) continue
    const rawPemail = String(p.email || '').trim().toLowerCase()
    if (rawPemail === 'roque@tacosgavilan.com') continue

    const cleanEmail = isMaskedOrEmptyEmail(p.email) ? '' : canonicalizeBasecampEmail(p.email)
    const dedupeKey = cleanEmail || `name:${normalizePersonName(cleanName)}` || p.id
    if (seenKey.has(dedupeKey)) continue
    seenKey.add(dedupeKey)

    const mappedRole = tegRoleByPersonId.get(p.id) || String(p.role || 'user').trim().toLowerCase()
    cleanList.push({
      id: p.id,
      bc_id: p.bc_id != null ? Number(p.bc_id) : null,
      name: cleanName,
      email: cleanEmail,
      role: mappedRole,
      avatar_url: p.avatar_url || '',
      title: String(p.title || '').trim(),
    })
  }

  cleanList.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  return cleanList
}

async function basecampBestEffort<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const cfg = await getBasecampSystemConfig()
    if (cfg.runtime_mode === 'standalone') {
      return null
    }
    const result = await fn()
    console.log(`✅ [Basecamp Sync] ${label} — synced to Basecamp successfully`)
    return result
  } catch (err: any) {
    const cutoverReason = detectBasecampCutoverReason(err)
    if (cutoverReason) {
      await triggerBasecampAutoCutover(cutoverReason).catch(() => {})
    }
    console.warn(`⚠️ [Basecamp Sync] ${label} — failed (best-effort, local data intact): ${err.message}`)
    return null
  }
}

async function syncParentCommentsCount(
  supabase: any,
  parentType?: string | null,
  parentDbId?: string | null
): Promise<void> {
  if (!parentDbId || (parentType !== 'todo' && parentType !== 'message')) return
  const { count, error } = await supabase
    .from('bc_comments')
    .select('*', { count: 'exact', head: true })
    .eq('parent_type', parentType)
    .eq('parent_id', parentDbId)
  if (error) return

  if (parentType === 'todo') {
    await supabase
      .from('bc_todos')
      .update({ comments_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', parentDbId)
  } else {
    await supabase
      .from('bc_messages')
      .update({ comments_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', parentDbId)
  }
}

async function syncRecordingBoostsCount(
  supabase: any,
  recordingType?: string | null,
  recordingUuid?: string | null
): Promise<number> {
  if (!recordingUuid || !recordingType) return 0
  const { count, error } = await supabase
    .from('bc_boosts')
    .select('*', { count: 'exact', head: true })
    .eq('recording_type', recordingType)
    .eq('recording_id', recordingUuid)
  if (error) return 0

  const exact = count ?? 0
  if (recordingType === 'todo') {
    await supabase.from('bc_todos').update({ boosts_count: exact }).eq('id', recordingUuid)
  } else if (recordingType === 'comment') {
    await supabase.from('bc_comments').update({ boosts_count: exact }).eq('id', recordingUuid)
  } else if (recordingType === 'message') {
    await supabase.from('bc_messages').update({ boosts_count: exact }).eq('id', recordingUuid)
  }
  return exact
}

function extractBasecampUploadStoragePath(downloadUrl?: string | null): string | null {
  if (!downloadUrl || typeof downloadUrl !== 'string') return null
  const marker = '/storage/v1/object/public/checklist-photos/'
  const idx = downloadUrl.indexOf(marker)
  if (idx === -1) return null
  let relPath = downloadUrl.slice(idx + marker.length).split('?')[0]
  try {
    relPath = decodeURIComponent(relPath)
  } catch {
    // Keep raw path when not percent-encoded
  }
  if (!relPath.startsWith('basecamp-uploads/') || relPath.includes('..')) {
    return null
  }
  return relPath
}

interface ClonedMediaCacheEntry {
  buffer: Buffer
  filename: string
  contentType: string
}

const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'video/quicktime': 'mov',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
}

const EXT_TO_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
}

const ALLOWED_BASECAMP_MEDIA_HOSTS = new Set([
  '3.basecampapi.com',
  'preview.app.basecamp.com',
  'storage.app.basecamp.com',
  'preview.3.basecamp.com',
  'storage.3.basecamp.com',
])

const MAX_CLONE_MEDIA_BYTES = 25 * 1024 * 1024 - 64 * 1024 // ~24.93 MB ceiling (within checklist-photos 25 MB limit)

let lastReplicatedMediaTs = 0
function nextReplicatedMediaTimestamp(): number {
  const now = Date.now()
  lastReplicatedMediaTs = now > lastReplicatedMediaTs ? now : lastReplicatedMediaTs + 1
  return lastReplicatedMediaTs
}

function extractHtmlAttr(attrsStr: string, attrName: string): string {
  if (!attrsStr || !attrName) return ''
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attrsStr)
  if (quoted) return quoted[2] || ''
  const unquoted = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*([^\\s>"']+)`, 'i').exec(attrsStr)
  return unquoted?.[1] || ''
}

function isAvatarImgAttrs(attrsStr: string): boolean {
  if (!attrsStr) return false
  return (
    /\bclass\s*=\s*(?:["'][^"']*\bavatar\b[^"']*["']|avatar\b)/i.test(attrsStr) ||
    /\bdata-avatar-for-person-id\b/i.test(attrsStr) ||
    /\bdata-bc-avatar\b/i.test(attrsStr)
  )
}

function inferEffectiveMimeType(buffer: Buffer, declaredMime: string, filename: string): string {
  const cleanDeclared = (declaredMime || '').split(';')[0].trim().toLowerCase()
  if (cleanDeclared && cleanDeclared !== 'application/octet-stream' && cleanDeclared !== 'binary/octet-stream') {
    return cleanDeclared
  }
  if (buffer.length >= 4) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif'
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
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return 'application/pdf'
    }
    if (
      buffer.length >= 12 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      const brand = buffer.subarray(8, 12).toString('ascii')
      return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
    }
  }
  const extMatch = filename.match(/\.([a-z0-9]{2,5})$/i)
  if (extMatch?.[1]) {
    const mapped = EXT_TO_MIME_MAP[extMatch[1].toLowerCase()]
    if (mapped) return mapped
  }
  return cleanDeclared || 'application/octet-stream'
}

function buildSafeReplicatedFilename(hintName: string, bcApiUrl: string, contentType: string): string {
  const GENERIC_NAMES = new Set(['imagen adjunta', 'archivo adjunto', 'image', 'imagen', 'full', 'preview', 'attachment'])
  const unescapedHint = (hintName || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
  let candidate = safeDecodeFilename(unescapedHint).trim()
  if (!candidate || GENERIC_NAMES.has(candidate.toLowerCase())) {
    try {
      const pathPart = new URL(bcApiUrl).pathname.split('/').pop() || ''
      const dec = safeDecodeFilename(pathPart).trim()
      if (dec && !GENERIC_NAMES.has(dec.toLowerCase())) {
        candidate = dec
      }
    } catch {
      // ignore
    }
  }
  if (!candidate || GENERIC_NAMES.has(candidate.toLowerCase())) {
    candidate = contentType.startsWith('image/') ? 'photo' : 'attachment'
  }

  let safe = candidate
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
  if (!safe) safe = contentType.startsWith('image/') ? 'photo' : 'attachment'

  const extMatch = safe.match(/\.([a-zA-Z0-9]{2,5})$/)
  if (extMatch) {
    const stem = safe.slice(0, safe.length - extMatch[0].length).slice(0, 64) || 'file'
    return `${stem}.${extMatch[1].toLowerCase()}`
  }

  const ext = MIME_EXT_MAP[contentType] || (contentType.startsWith('image/') ? 'jpg' : 'bin')
  return `${safe.slice(0, 64)}.${ext}`
}

/**
 * Extracts and validates a Basecamp 3 blob URL (from either `/api/basecamp/attachment?url=...`
 * or direct `preview.app.basecamp.com` / `storage.app.basecamp.com` / `3.basecampapi.com` URLs),
 * enforcing strict anti-SSRF account/host rules and normalizing hostname to `3.basecampapi.com`.
 */
function extractRealBasecampBlobUrl(
  rawAttrUrl?: string | null
): { targetBcApiUrl: string; filenameHint: string } | null {
  if (!rawAttrUrl || typeof rawAttrUrl !== 'string') return null
  let candidate = rawAttrUrl
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&')
    .trim()
  if (!candidate) return null

  let filenameHint = ''

  for (let depth = 0; depth < 2; depth++) {
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
      const maybeOrigin = new URL(candidate)
      if (maybeOrigin.pathname === '/api/basecamp/attachment') {
        const fn = maybeOrigin.searchParams.get('filename')
        if (fn && !filenameHint) filenameHint = fn
        const inner = maybeOrigin.searchParams.get('url')
        if (!inner) return null
        candidate = inner.trim()
        continue
      }
    } catch {
      // Not a full URL
    }
    break
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

  if (!ALLOWED_BASECAMP_MEDIA_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null
  }

  let decodedPath = parsed.pathname
  try {
    decodedPath = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }

  const accountId = process.env.BASECAMP_ACCOUNT_ID || '5052386'
  if (
    decodedPath.includes('..') ||
    decodedPath.includes('\\') ||
    parsed.pathname.includes('//') ||
    !parsed.pathname.startsWith(`/${accountId}/`)
  ) {
    return null
  }

  parsed.hostname = '3.basecampapi.com'
  return { targetBcApiUrl: parsed.toString(), filenameHint }
}

/**
 * Downloads a Basecamp 3 attachment blob on the server using OAuth (`getValidToken`),
 * following the 302 redirect to S3 WITHOUT forwarding the `Authorization` header to AWS S3.
 */
async function downloadBasecampBlobBuffer(
  targetBcApiUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const cfg = await getBasecampSystemConfig()
    if (cfg.runtime_mode === 'standalone') {
      return null
    }
    const token = await getValidToken()
    const userAgent = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (noreply@tacosgavilan.com)'

    const res = await fetch(targetBcApiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })

    const s3Location = res.headers.get('location')
    if (s3Location) {
      let parsedRedirect: URL
      try {
        parsedRedirect = new URL(s3Location)
      } catch {
        return null
      }
      if (parsedRedirect.protocol !== 'https:' || parsedRedirect.username !== '' || parsedRedirect.password !== '') {
        return null
      }

      const s3Res = await fetch(parsedRedirect.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(25_000),
      })
      if (!s3Res.ok) {
        console.warn(`⚠️ [Basecamp Action] S3 download failed (${s3Res.status}) for replicated Basecamp blob`)
        return null
      }
      const declaredLen = Number(s3Res.headers.get('content-length') || 0)
      if (declaredLen > MAX_CLONE_MEDIA_BYTES) return null

      const contentType = (s3Res.headers.get('Content-Type') || 'application/octet-stream')
        .split(';')[0]
        .trim()
        .toLowerCase()
      const arrBuf = await s3Res.arrayBuffer()
      const buffer = Buffer.from(arrBuf)
      if (buffer.length === 0 || buffer.length > MAX_CLONE_MEDIA_BYTES) return null
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
      if (declaredLen > MAX_CLONE_MEDIA_BYTES) return null

      const arrBuf = await res.arrayBuffer()
      const buffer = Buffer.from(arrBuf)
      if (buffer.length === 0 || buffer.length > MAX_CLONE_MEDIA_BYTES) return null
      return { buffer, contentType }
    }

    console.warn(`⚠️ [Basecamp Action] Basecamp blob fetch returned status ${res.status}`)
    return null
  } catch (err: any) {
    console.warn('⚠️ [Basecamp Action] Non-fatal error downloading Basecamp blob:', err?.message || err)
    return null
  }
}

/**
 * Clones any historical Basecamp-hosted images, videos, and files referenced in Announcements, To-Dos, or Comments
 * (`/api/basecamp/attachment?url=...` or `preview.3.basecamp.com` / `storage.3.basecamp.com` /
 * `preview.app.basecamp.com` / `storage.app.basecamp.com` / `3.basecampapi.com`)
 * into our own Supabase Storage bucket `checklist-photos` (`basecamp-uploads/replicated-${ts}-${safeName}`)
 * so replicated/new records have their own permanent, independent public URLs.
 */
async function cloneExternalBasecampAttachmentsToSupabase(
  html: string | undefined | null,
  supabase: any,
  mediaMemoryCache?: Map<string, ClonedMediaCacheEntry>
): Promise<string> {
  if (!html || typeof html !== 'string') return ''
  if (
    !html.includes('/api/basecamp/attachment') &&
    !html.includes('basecamp.com') &&
    !html.includes('basecampapi.com') &&
    !html.includes('basecamp-attachments/')
  ) {
    return html
  }

  // Mask @mention <bc-attachment> tags so mini-avatars inside mentions are never treated as file attachments
  const maskedMentions: string[] = []
  let working = html
    .replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs) => {
      if (!isBasecampMentionAttachment(attrs)) return full
      const idx = maskedMentions.push(full) - 1
      return `\uE000BC_MENTION_${idx}\uE001`
    })
    .replace(/<bc-attachment\b([^>]*?)\/>/gi, (full, attrs) => {
      if (!isBasecampMentionAttachment(attrs)) return full
      const idx = maskedMentions.push(full) - 1
      return `\uE000BC_MENTION_${idx}\uE001`
    })

  const clonedByBcUrl = new Map<string, string | null>()
  const resolvedReplacementByRawInput = new Map<string, string>()
  const histCacheLookup = new Map<string, string | null>()
  const accountId = process.env.BASECAMP_ACCOUNT_ID || '5052386'

  const resolveBlobOrHistoricalVideoTarget = async (
    rawAttrUrl: string | undefined | null,
    hintFilename: string,
    forceVideo: boolean
  ): Promise<{ targetBcApiUrl: string; filenameHint: string; fallbackProxyUrl?: string } | null> => {
    if (!rawAttrUrl || typeof rawAttrUrl !== 'string') return null
    const direct = extractRealBasecampBlobUrl(rawAttrUrl)
    if (direct) {
      const effectiveHint = hintFilename || direct.filenameHint
      const isVid = forceVideo || isVideoMimeOrFilename(null, effectiveHint, rawAttrUrl)
      if (isVid) {
        const blobPreviewMatch = direct.targetBcApiUrl.match(
          new RegExp(`^https:\\/\\/3\\.basecampapi\\.com\\/${accountId}\\/blobs\\/([a-f0-9-]{8,})\\/previews\\/`, 'i')
        )
        if (blobPreviewMatch?.[1]) {
          const dlName = buildSafeReplicatedFilename(effectiveHint || 'video.mov', direct.targetBcApiUrl, 'video/quicktime')
          const upgradedApiUrl = `https://3.basecampapi.com/${accountId}/blobs/${blobPreviewMatch[1]}/download/${encodeURIComponent(dlName)}`
          const fallbackProxyUrl = `/api/basecamp/attachment?url=${encodeURIComponent(`https://storage.app.basecamp.com/${accountId}/blobs/${blobPreviewMatch[1]}/download/${encodeURIComponent(dlName)}`)}`
          return { targetBcApiUrl: upgradedApiUrl, filenameHint: dlName, fallbackProxyUrl }
        }
      }
      return { targetBcApiUrl: direct.targetBcApiUrl, filenameHint: effectiveHint }
    }

    // Unwrap /api/basecamp/attachment?url=... pointing to legacy Supabase Storage basecamp-attachments/
    let candidate = rawAttrUrl.replace(/&amp;/gi, '&').replace(/&#38;/gi, '&').trim()
    let qsFilename = ''
    for (let depth = 0; depth < 2; depth++) {
      if (candidate.startsWith('/api/basecamp/attachment?')) {
        const qs = new URLSearchParams(candidate.slice('/api/basecamp/attachment?'.length))
        const fn = qs.get('filename')
        if (fn && !qsFilename) qsFilename = fn
        const inner = qs.get('url')
        if (!inner) break
        candidate = inner.trim()
        continue
      }
      try {
        const parsedMaybe = new URL(candidate)
        if (parsedMaybe.pathname === '/api/basecamp/attachment') {
          const fn = parsedMaybe.searchParams.get('filename')
          if (fn && !qsFilename) qsFilename = fn
          const inner = parsedMaybe.searchParams.get('url')
          if (!inner) break
          candidate = inner.trim()
          continue
        }
      } catch {
        // ignore
      }
      break
    }

    const cleanSupaUrl = candidate.split('?')[0]
    if (!cleanSupaUrl.includes('/storage/v1/object/public/checklist-photos/basecamp-attachments/')) {
      return null
    }
    const effectiveName = hintFilename || qsFilename || cleanSupaUrl.split('/').pop() || ''
    if (!forceVideo && !isVideoMimeOrFilename(null, effectiveName, cleanSupaUrl)) {
      return null
    }

    let cachedBasecampUrl = histCacheLookup.get(cleanSupaUrl)
    if (cachedBasecampUrl === undefined) {
      const { data: cacheRow } = await supabase
        .from('bc_attachment_cache')
        .select('basecamp_url')
        .eq('supabase_url', cleanSupaUrl)
        .limit(1)
        .maybeSingle()
      const resolvedCacheUrl: string | null = cacheRow?.basecamp_url ? String(cacheRow.basecamp_url) : null
      cachedBasecampUrl = resolvedCacheUrl
      histCacheLookup.set(cleanSupaUrl, resolvedCacheUrl)
    }
    if (!cachedBasecampUrl) return null

    const blobMatch = cachedBasecampUrl.match(new RegExp(`/${accountId}/blobs/([a-f0-9-]{8,})`, 'i'))
    if (!blobMatch?.[1]) return null

    const dlName = buildSafeReplicatedFilename(effectiveName || 'video.mov', cleanSupaUrl, 'video/quicktime')
    const targetBcApiUrl = `https://3.basecampapi.com/${accountId}/blobs/${blobMatch[1]}/download/${encodeURIComponent(dlName)}`
    const fallbackProxyUrl = `/api/basecamp/attachment?url=${encodeURIComponent(`https://storage.app.basecamp.com/${accountId}/blobs/${blobMatch[1]}/download/${encodeURIComponent(dlName)}`)}`
    return { targetBcApiUrl, filenameHint: dlName, fallbackProxyUrl }
  }

  const cloneUrlToChecklistPhotos = async (
    targetBcApiUrl: string,
    hintName: string
  ): Promise<string | null> => {
    if (clonedByBcUrl.has(targetBcApiUrl)) {
      return clonedByBcUrl.get(targetBcApiUrl) || null
    }
    const downloaded = await downloadBasecampBlobBuffer(targetBcApiUrl)
    if (!downloaded) {
      clonedByBcUrl.set(targetBcApiUrl, null)
      return null
    }

    const preliminaryName = buildSafeReplicatedFilename(hintName, targetBcApiUrl, downloaded.contentType)
    const effectiveMime = inferEffectiveMimeType(downloaded.buffer, downloaded.contentType, preliminaryName)
    const safeName = buildSafeReplicatedFilename(hintName, targetBcApiUrl, effectiveMime)
    const storagePath = `basecamp-uploads/replicated-${nextReplicatedMediaTimestamp()}-${safeName}`

    try {
      const { error: upErr } = await supabase.storage.from('checklist-photos').upload(storagePath, downloaded.buffer, {
        contentType: effectiveMime,
        cacheControl: '3600',
        upsert: true,
      })
      if (upErr) {
        console.warn(`⚠️ [Basecamp Action] Failed to upload replicated media (${storagePath}):`, upErr.message)
        clonedByBcUrl.set(targetBcApiUrl, null)
        return null
      }

      const { data: pub } = supabase.storage.from('checklist-photos').getPublicUrl(storagePath)
      const publicUrl = pub?.publicUrl || null
      clonedByBcUrl.set(targetBcApiUrl, publicUrl)
      if (publicUrl && mediaMemoryCache) {
        mediaMemoryCache.set(publicUrl, {
          buffer: downloaded.buffer,
          filename: safeName,
          contentType: effectiveMime,
        })
      }
      return publicUrl
    } catch (err: any) {
      console.warn('⚠️ [Basecamp Action] Non-fatal replicated media upload error:', err?.message || err)
      clonedByBcUrl.set(targetBcApiUrl, null)
      return null
    }
  }

  // 1. Clone <img ... src="..."> tags pointing to Basecamp proxy or Basecamp blob hosts
  const imgTagRegex = /<img\b([^>]*)>/gi
  const imgMatches = [...working.matchAll(imgTagRegex)]
  for (const m of imgMatches) {
    const fullImg = m[0]
    const attrs = m[1] || ''
    if (isAvatarImgAttrs(attrs)) continue
    const rawSrc = extractHtmlAttr(attrs, 'src')
    const resolved = extractRealBasecampBlobUrl(rawSrc)
    if (!resolved) continue

    const altHint = extractHtmlAttr(attrs, 'alt') || resolved.filenameHint
    const publicUrl = await cloneUrlToChecklistPhotos(resolved.targetBcApiUrl, altHint)
    if (!publicUrl) continue

    const updatedImg = fullImg
      .replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+)/gi, '')
      .replace(
        /((?:^|\s)src\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
        (_sm, prefix, q) => `${prefix}${q || '"'}${publicUrl}${q || '"'}`
      )
    working = working.replace(fullImg, () => updatedImg)
  }

  // 2. Clone <video ... src="..."> and <source ... src="..."> tags (including historical bc_attachment_cache videos)
  const videoOrSourceRegex = /<(video|source)\b([^>]*)>/gi
  const videoMatches = [...working.matchAll(videoOrSourceRegex)]
  for (const m of videoMatches) {
    const fullTag = m[0]
    const attrs = m[2] || ''
    const rawSrc = extractHtmlAttr(attrs, 'src')
    const fnAttr = extractHtmlAttr(attrs, 'data-filename')
    const resolved = await resolveBlobOrHistoricalVideoTarget(rawSrc, fnAttr, true)
    if (!resolved) continue

    const publicUrl = await cloneUrlToChecklistPhotos(resolved.targetBcApiUrl, resolved.filenameHint)
    const replacementUrl = publicUrl || resolved.fallbackProxyUrl
    if (!replacementUrl) continue
    resolvedReplacementByRawInput.set(rawSrc.replace(/&amp;/gi, '&').trim(), replacementUrl)

    const updatedTag = fullTag.replace(
      /((?:^|\s)src\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
      (_sm, prefix, q) => `${prefix}${q || '"'}${replacementUrl}${q || '"'}`
    )
    working = working.replace(fullTag, () => updatedTag)
  }

  // 3. Clone replicated file & video blocks (<p data-teg-attachment="true">...<a href="...">...</a></p>)
  const tegAttBlockRegex =
    /<p\b[^>]*\bdata-teg-attachment\s*=\s*(?:["']true["']|true\b)[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/p>/gi
  const tegAttMatches = [...working.matchAll(tegAttBlockRegex)]
  for (const m of tegAttMatches) {
    const fullBlock = m[0]
    const aAttrs = m[1] || ''
    const innerText = (m[2] || '').replace(/<[^>]+>/g, '').replace(/^[📎🎬]\s*/, '').trim()
    const rawHref = extractHtmlAttr(aAttrs, 'href')
    const resolved = await resolveBlobOrHistoricalVideoTarget(rawHref, innerText, false)
    if (!resolved) continue

    const publicUrl = await cloneUrlToChecklistPhotos(resolved.targetBcApiUrl, innerText || resolved.filenameHint)
    const replacementUrl = publicUrl || resolved.fallbackProxyUrl
    if (!replacementUrl) continue
    resolvedReplacementByRawInput.set(rawHref.replace(/&amp;/gi, '&').trim(), replacementUrl)

    const updatedBlock = fullBlock.replace(
      /(<a\b[^>]*?\shref\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
      (_hm, prefix, q) => `${prefix}${q || '"'}${replacementUrl}${q || '"'}`
    )
    working = working.replace(fullBlock, () => updatedBlock)
  }

  // 4. Clone non-mention <bc-attachment ... url/href="..."> (photos, files, and videos <= 25 MB incl. historical cache)
  const rawBcAttRegex = /<bc-attachment\b([^>]*?)>/gi
  const rawBcMatches = [...working.matchAll(rawBcAttRegex)]
  for (const m of rawBcMatches) {
    const fullOpenTag = m[0]
    const attrs = m[1] || ''
    const ct = extractHtmlAttr(attrs, 'content-type')
    const fnAttr = extractHtmlAttr(attrs, 'filename')
    const rawUrl = extractHtmlAttr(attrs, 'href') || extractHtmlAttr(attrs, 'url')
    const isVid = isVideoMimeOrFilename(ct, fnAttr, rawUrl)
    const resolved = await resolveBlobOrHistoricalVideoTarget(rawUrl, fnAttr, isVid)
    if (!resolved) continue

    const publicUrl = await cloneUrlToChecklistPhotos(resolved.targetBcApiUrl, fnAttr || resolved.filenameHint)
    const replacementUrl = publicUrl || resolved.fallbackProxyUrl
    if (!replacementUrl) continue
    resolvedReplacementByRawInput.set(rawUrl.replace(/&amp;/gi, '&').trim(), replacementUrl)

    let updatedOpenTag = fullOpenTag
    if (/\burl\s*=/i.test(updatedOpenTag)) {
      updatedOpenTag = updatedOpenTag.replace(
        /((?:^|\s)url\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
        (_um, prefix, q) => `${prefix}${q || '"'}${replacementUrl}${q || '"'}`
      )
    }
    if (/\bhref\s*=/i.test(updatedOpenTag)) {
      updatedOpenTag = updatedOpenTag.replace(
        /((?:^|\s)href\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
        (_hm, prefix, q) => `${prefix}${q || '"'}${replacementUrl}${q || '"'}`
      )
    }
    working = working.replace(fullOpenTag, () => updatedOpenTag)
  }

  // 5. Rewrite any remaining <a href="..."> pointing to an already-cloned Basecamp blob or historical video
  if (clonedByBcUrl.size > 0 || resolvedReplacementByRawInput.size > 0) {
    const anchorTagRegex = /<a\b([^>]*)>/gi
    const anchorMatches = [...working.matchAll(anchorTagRegex)]
    for (const m of anchorMatches) {
      const fullA = m[0]
      const aAttrs = m[1] || ''
      const rawHref = extractHtmlAttr(aAttrs, 'href')
      const cleanRaw = rawHref.replace(/&amp;/gi, '&').trim()
      const directMapped = resolvedReplacementByRawInput.get(cleanRaw)
      const resolved = directMapped ? null : extractRealBasecampBlobUrl(rawHref)
      const replacementUrl = directMapped || (resolved ? clonedByBcUrl.get(resolved.targetBcApiUrl) : null)
      if (!replacementUrl) continue
      const updatedA = fullA.replace(
        /((?:^|\s)href\s*=\s*)(?:(["'])([\s\S]*?)\2|([^\s>"']+))/i,
        (_hm, prefix, q) => `${prefix}${q || '"'}${replacementUrl}${q || '"'}`
      )
      working = working.replace(fullA, () => updatedA)
    }
  }

  // Restore masked @mentions
  working = working.replace(/\uE000BC_MENTION_(\d+)\uE001/g, (_m, idxStr) => {
    return maskedMentions[Number(idxStr)] || ''
  })

  return working
}

const cloneReplicatedBasecampMediaToStorage = cloneExternalBasecampAttachmentsToSupabase

/**
 * Uploads any embedded `<img src="data:...">` / `<a href="data:...">` / `url="data:..."` base64 payloads
 * AND clones any replicated Basecamp-hosted attachments/photos into Supabase Storage (`checklist-photos`),
 * replacing them with durable, independent HTTPS public URLs before saving to Supabase or mirroring to Basecamp 3.
 */
async function uploadEmbeddedDataUrisToStorage(
  html: string | undefined | null,
  folder: string,
  supabase: any,
  mediaMemoryCache?: Map<string, ClonedMediaCacheEntry>
): Promise<string> {
  if (!html || typeof html !== 'string') {
    return ''
  }

  let updatedHtml = html

  if (updatedHtml.includes('data:')) {
    const dataAttrRegex =
      /(?:src|href|url)\s*=\s*(["'])(data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)(?:;[a-zA-Z0-9=._-]+)*;base64,([A-Za-z0-9+/=\s]+))\1/gi

    const pendingMatches = new Map<string, { mimeType: string; b64: string }>()
    let match: RegExpExecArray | null
    while ((match = dataAttrRegex.exec(updatedHtml)) !== null) {
      const fullDataUri = match[2]
      const mimeType = (match[3] || 'application/octet-stream').toLowerCase()
      const b64 = (match[4] || '').replace(/\s+/g, '')
      if (fullDataUri && b64 && !pendingMatches.has(fullDataUri)) {
        pendingMatches.set(fullDataUri, { mimeType, b64 })
      }
    }

    for (const [dataUri, { mimeType, b64 }] of pendingMatches.entries()) {
      try {
        const buffer = Buffer.from(b64, 'base64')
        if (buffer.length === 0) continue
        const fallbackExt = (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
        const ext = MIME_EXT_MAP[mimeType] || fallbackExt
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const filePath = `basecamp-attachments/${folder}/${filename}`

        const { error: upErr } = await supabase.storage.from('checklist-photos').upload(filePath, buffer, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: true,
        })
        if (upErr) {
          console.warn(`⚠️ [Basecamp Action] Failed to upload embedded data URI (${mimeType}):`, upErr.message)
          continue
        }

        const { data: pub } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
        if (pub?.publicUrl) {
          updatedHtml = updatedHtml.replaceAll(dataUri, pub.publicUrl)
          if (mediaMemoryCache) {
            mediaMemoryCache.set(pub.publicUrl, { buffer, filename, contentType: mimeType })
          }
        }
      } catch (err: any) {
        console.warn('⚠️ [Basecamp Action] Non-fatal data URI upload error:', err.message)
      }
    }
  }

  return cloneReplicatedBasecampMediaToStorage(updatedHtml, supabase, mediaMemoryCache)
}

/**
 * Converts Supabase Storage (`checklist-photos/...`) `<bc-attachment>`, `<p data-teg-attachment>` and `<img>`
 * elements into native Basecamp 3 `<bc-attachment sgid="...">` tags strictly for the outbound Basecamp API payload
 * (reusing `mediaMemoryCache` when bytes were uploaded in the same request, and falling back to `data-orig-bc-sgid`
 * if remote upload fails), while keeping Supabase's permanent public URLs untouched in our own database.
 */
async function mirrorSupabaseAttachmentsForBasecampHtml(
  html: string | undefined | null,
  supabase: any,
  mediaMemoryCache?: Map<string, ClonedMediaCacheEntry>
): Promise<string> {
  if (!html || typeof html !== 'string' || !html.includes('/storage/v1/object/public/checklist-photos/')) {
    return html || ''
  }

  const marker = '/storage/v1/object/public/checklist-photos/'
  const sgidCache = new Map<string, string | null>()

  const resolveSgidForUrl = async (
    rawUrl: string,
    fallbackName: string,
    fallbackMime: string
  ): Promise<string | null> => {
    const unescapedUrl = rawUrl.replace(/&amp;/gi, '&').trim()
    if (sgidCache.has(unescapedUrl)) return sgidCache.get(unescapedUrl) || null

    const cachedEntry = mediaMemoryCache?.get(unescapedUrl)
    if (cachedEntry) {
      try {
        const sgid = await uploadBasecampAttachment(
          cachedEntry.buffer,
          cachedEntry.filename || fallbackName || 'attachment',
          cachedEntry.contentType || fallbackMime || 'application/octet-stream'
        )
        sgidCache.set(unescapedUrl, sgid)
        return sgid
      } catch (err: any) {
        console.warn('⚠️ [Basecamp Action] Could not upload cached attachment to Basecamp SGID:', err?.message || err)
        sgidCache.set(unescapedUrl, null)
        return null
      }
    }

    const idx = unescapedUrl.indexOf(marker)
    if (idx === -1) return null
    let relPath = unescapedUrl.slice(idx + marker.length).split('?')[0]
    try {
      relPath = decodeURIComponent(relPath)
    } catch {
      // keep raw
    }
    if (!relPath || relPath.includes('..')) return null

    try {
      const { data: blob, error } = await supabase.storage.from('checklist-photos').download(relPath)
      if (error || !blob) {
        sgidCache.set(unescapedUrl, null)
        return null
      }
      const arrBuf = await blob.arrayBuffer()
      const buf = Buffer.from(arrBuf)
      const finalFilename = fallbackName || relPath.split('/').pop() || 'attachment'
      const detectedMime = inferEffectiveMimeType(buf, blob.type || fallbackMime || '', finalFilename)
      const sgid = await uploadBasecampAttachment(buf, finalFilename, detectedMime)
      sgidCache.set(unescapedUrl, sgid)
      return sgid
    } catch (err: any) {
      console.warn('⚠️ [Basecamp Action] Could not upload attachment to Basecamp SGID:', err?.message || err)
      sgidCache.set(unescapedUrl, null)
      return null
    }
  }

  let out = html

  // 1. Convert paired & self-closing <bc-attachment ... url="https://...checklist-photos/...">
  const bcAttRegex = /<bc-attachment\b([^>]*?)(?:>([\s\S]*?)<\/bc-attachment>|\/>)/gi
  const bcMatches = [...out.matchAll(bcAttRegex)]
  for (const m of bcMatches) {
    const fullTag = m[0]
    const attrs = m[1] || ''
    if (isBasecampMentionAttachment(attrs)) continue
    const rawUrl = extractHtmlAttr(attrs, 'url') || extractHtmlAttr(attrs, 'href')
    if (!rawUrl.includes(marker)) continue
    const filename = extractHtmlAttr(attrs, 'filename') || 'attachment'
    const mime = extractHtmlAttr(attrs, 'content-type') || 'application/octet-stream'
    const origSgid = (extractHtmlAttr(attrs, 'sgid') || extractHtmlAttr(attrs, 'data-orig-bc-sgid')).trim()
    const sgid = await resolveSgidForUrl(rawUrl, filename, mime)
    if (sgid) {
      out = out.replace(fullTag, () => `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else if (origSgid) {
      out = out.replace(fullTag, () => `<bc-attachment sgid="${origSgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullTag, () => `<p><a href="${rawUrl}">📎 ${filename}</a></p>`)
    }
  }

  // 2. Convert replicated <p data-teg-attachment="true">...<a href="https://...checklist-photos/...">...</a></p>
  const tegAttRegex =
    /<p\b[^>]*\bdata-teg-attachment\s*=\s*(?:["']true["']|true\b)[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/p>/gi
  const tegAttMatches = [...out.matchAll(tegAttRegex)]
  for (const m of tegAttMatches) {
    const fullBlock = m[0]
    const aAttrs = m[1] || ''
    const rawUrl = extractHtmlAttr(aAttrs, 'href')
    if (!rawUrl.includes(marker)) continue
    const origSgid = extractHtmlAttr(aAttrs, 'data-orig-bc-sgid').trim()
    const innerLabel = (m[2] || '').replace(/<[^>]+>/g, '').replace(/^📎\s*/, '').trim()
    const filename = innerLabel || rawUrl.split('/').pop()?.split('?')[0] || 'attachment'
    const sgid = await resolveSgidForUrl(rawUrl, filename, 'application/octet-stream')
    if (sgid) {
      out = out.replace(fullBlock, () => `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else if (origSgid) {
      out = out.replace(fullBlock, () => `<bc-attachment sgid="${origSgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullBlock, () => `<p><a href="${rawUrl}">📎 ${filename}</a></p>`)
    }
  }

  // 2b. Convert inline <video ...>...</video> pointing to checklist-photos into Basecamp <bc-attachment sgid="...">
  const videoElemRegex = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi
  const vidElemMatches = [...out.matchAll(videoElemRegex)]
  for (const m of vidElemMatches) {
    const fullVid = m[0]
    const vAttrs = m[1] || ''
    const vInner = m[2] || ''
    let rawUrl = extractHtmlAttr(vAttrs, 'src')
    if (!rawUrl) {
      const srcTagMatch = vInner.match(/<source\b([^>]*)>/i)
      if (srcTagMatch?.[1]) rawUrl = extractHtmlAttr(srcTagMatch[1], 'src')
    }
    if (!rawUrl || !rawUrl.includes(marker)) continue
    const origSgid = extractHtmlAttr(vAttrs, 'data-orig-bc-sgid').trim()
    const filename =
      extractHtmlAttr(vAttrs, 'data-filename') ||
      rawUrl.split('/').pop()?.split('?')[0] ||
      'video.mp4'
    const ext = (filename.split('.').pop() || '').toLowerCase()
    const mime = EXT_TO_MIME_MAP[ext] || 'video/mp4'
    const sgid = await resolveSgidForUrl(rawUrl, filename, mime)
    if (sgid) {
      out = out.replace(fullVid, () => `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else if (origSgid) {
      out = out.replace(fullVid, () => `<bc-attachment sgid="${origSgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullVid, () => `<p><a href="${rawUrl}">🎬 ${filename}</a></p>`)
    }
  }

  // 3. Convert <figure><img src="...checklist-photos...">...</figure> and standalone <img ... src="https://...checklist-photos/...">
  const figureImgRegex =
    /<figure\b[^>]*>\s*<img\b([^>]*)>\s*(?:<figcaption\b[^>]*>[\s\S]*?<\/figcaption>\s*)?<\/figure>/gi
  const figMatches = [...out.matchAll(figureImgRegex)]
  for (const m of figMatches) {
    const fullFig = m[0]
    const attrs = m[1] || ''
    if (isAvatarImgAttrs(attrs)) continue
    const rawUrl = extractHtmlAttr(attrs, 'src')
    if (!rawUrl.includes(marker)) continue
    const origSgid = extractHtmlAttr(attrs, 'data-orig-bc-sgid').trim()
    const filename = extractHtmlAttr(attrs, 'alt') || rawUrl.split('/').pop()?.split('?')[0] || 'photo.jpg'
    const sgid = await resolveSgidForUrl(rawUrl, filename, 'image/jpeg')
    if (sgid) {
      out = out.replace(fullFig, () => `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else if (origSgid) {
      out = out.replace(fullFig, () => `<bc-attachment sgid="${origSgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullFig, () => `<a href="${rawUrl}">🖼 ${filename}</a>`)
    }
  }

  const imgRegex = /<img\b([^>]*)>/gi
  const imgMatches = [...out.matchAll(imgRegex)]
  for (const m of imgMatches) {
    const fullImg = m[0]
    const attrs = m[1] || ''
    if (isAvatarImgAttrs(attrs)) continue
    const rawUrl = extractHtmlAttr(attrs, 'src')
    if (!rawUrl.includes(marker)) continue
    const origSgid = extractHtmlAttr(attrs, 'data-orig-bc-sgid').trim()
    const filename = extractHtmlAttr(attrs, 'alt') || rawUrl.split('/').pop()?.split('?')[0] || 'photo.jpg'
    const sgid = await resolveSgidForUrl(rawUrl, filename, 'image/jpeg')
    if (sgid) {
      out = out.replace(fullImg, () => `<bc-attachment sgid="${sgid}"></bc-attachment>`)
    } else if (origSgid) {
      out = out.replace(fullImg, () => `<bc-attachment sgid="${origSgid}"></bc-attachment>`)
    } else {
      out = out.replace(fullImg, () => `<a href="${rawUrl}">🖼 ${filename}</a>`)
    }
  }

  return out
}

/**
 * Prepares Rich HTML for outbound Basecamp 3 API calls:
 * 1) Converts `@mention` tags (`<bc-attachment sgid="X" content-type="application/vnd.basecamp.mention">` -> `<bc-attachment sgid="X"></bc-attachment>`
 *    and synthetic TEG spans -> `<strong>@Nombre</strong>`).
 * 2) Uploads any Supabase Storage `checklist-photos` images/files (including newly cloned replicated Basecamp photos)
 *    to fresh `uploadBasecampAttachment` SGIDs.
 * 3) If any un-cloned Basecamp `<img>` remains (e.g. cross-project `move_todo` or transient storage fallback),
 *    downloads & uploads to `uploadBasecampAttachment` or falls back to `data-orig-bc-sgid`.
 * 4) Converts any remaining `data-orig-bc-sgid` file/image tags via `prepareHtmlForBasecampApi`.
 */
async function prepareOutboundHtmlForBasecamp(
  html: string | undefined | null,
  supabase: any,
  mediaMemoryCache?: Map<string, ClonedMediaCacheEntry>
): Promise<string> {
  if (!html) return ''
  const withMentionsConverted = convertMentionsForBasecampOutbound(html)
  let out = await mirrorSupabaseAttachmentsForBasecampHtml(withMentionsConverted, supabase, mediaMemoryCache)

  // Fallback for any remaining <img src="/api/basecamp/attachment?url=..."> or direct Basecamp blob URL
  if (out.includes('/api/basecamp/attachment') || out.includes('basecamp.com') || out.includes('basecampapi.com')) {
    const fallbackImgRegex = /<img\b([^>]*)>/gi
    const remainingImgs = [...out.matchAll(fallbackImgRegex)]
    for (const m of remainingImgs) {
      const fullImg = m[0]
      const attrs = m[1] || ''
      if (isAvatarImgAttrs(attrs)) continue
      const rawSrc = extractHtmlAttr(attrs, 'src')
      const resolved = extractRealBasecampBlobUrl(rawSrc)
      if (!resolved) continue

      const origSgid = extractHtmlAttr(attrs, 'data-orig-bc-sgid').trim()
      const downloaded = await downloadBasecampBlobBuffer(resolved.targetBcApiUrl)
      let freshSgid: string | null = null
      if (downloaded) {
        const hint = extractHtmlAttr(attrs, 'alt') || resolved.filenameHint
        const prelimName = buildSafeReplicatedFilename(hint, resolved.targetBcApiUrl, downloaded.contentType)
        const mime = inferEffectiveMimeType(downloaded.buffer, downloaded.contentType, prelimName)
        const safeName = buildSafeReplicatedFilename(hint, resolved.targetBcApiUrl, mime)
        try {
          freshSgid = await uploadBasecampAttachment(downloaded.buffer, safeName, mime)
        } catch {
          freshSgid = null
        }
      }

      if (freshSgid) {
        out = out.replace(fullImg, () => `<bc-attachment sgid="${freshSgid}"></bc-attachment>`)
      } else if (origSgid) {
        out = out.replace(fullImg, () => `<bc-attachment sgid="${origSgid}"></bc-attachment>`)
      }
    }
  }

  return prepareHtmlForBasecampApi(out)
}

async function resolveRealBcPersonIds(supabase: any, uuids?: string[] | null): Promise<number[]> {
  if (!Array.isArray(uuids) || uuids.length === 0) return []
  const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)))
  if (uniqueUuids.length === 0) return []
  const { data: rows } = await supabase
    .from('bc_people')
    .select('bc_id')
    .in('id', uniqueUuids)
  if (!rows) return []
  return rows
    .map((r: any) => Number(r.bc_id))
    .filter((id: number) => isRealBasecampId(id))
}

const projectCategoriesCache = new Map<number, Array<{ id: number; name: string }>>()

async function resolveRemoteMessageCategoryId(
  bcProjectId: number,
  rawCategory?: string | null
): Promise<number | undefined> {
  if (!rawCategory || !isRealBasecampId(bcProjectId)) return undefined
  const norm = String(rawCategory)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  if (!norm || norm === 'general') return undefined

  let canonicalTarget = norm
  if (norm.includes('anuncio') || norm.includes('announcement')) canonicalTarget = 'announcement'
  else if (norm === 'fyi' || norm.includes('fyi') || norm.includes('informacion')) canonicalTarget = 'fyi'
  else if (norm.includes('heartbeat') || norm.includes('pulso')) canonicalTarget = 'heartbeat'
  else if (norm.includes('pitch') || norm.includes('propuesta') || norm.includes('idea')) canonicalTarget = 'pitch'
  else if (norm.includes('question') || norm.includes('pregunta')) canonicalTarget = 'question'

  try {
    let cats = projectCategoriesCache.get(bcProjectId)
    if (!cats) {
      const fetched = await bcFetchMessageCategories(bcProjectId)
      cats = (fetched || []).map((c) => ({ id: Number(c.id), name: String(c.name || '') }))
      projectCategoriesCache.set(bcProjectId, cats)
    }
    const found = cats.find((c) => c.name.trim().toLowerCase() === canonicalTarget)
    return found?.id && Number.isFinite(found.id) ? found.id : undefined
  } catch {
    return undefined
  }
}

function normalizeDateOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  if (!s) return null
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export async function POST(request: Request) {
  // 1. Require authenticated staff user (including 'basecamp' role; blocks unauthenticated & employee kiosk tokens)
  const staffAuth = verifyStaffAuth(request, {
    allowCron: false,
    allowedRoles: BASECAMP_STAFF_ALLOWED_ROLES,
  })
  if (!staffAuth.authorized) {
    return staffAuth.response!
  }

  const user = await getServerUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const callerRole = String(user.role || '').trim().toLowerCase()
  const isCallerAdmin = callerRole === 'admin' || callerRole === 'administrador'

  const supabase = supabaseAdmin

  // 2. Resolve or auto-create local person in bc_people
  const resolvedAuthor = await resolveOrCreateTegPerson(supabase, {
    email: user.email,
    name: user.name,
    role: user.role,
  })
  const authorPersonId: string | null = resolvedAuthor?.id || null
  const authorDisplayName: string = resolvedAuthor?.name || user.name || user.email || 'Usuario TEG'

  // 3. Parse action request
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, projectId, ...args } = body || {}
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  // Force 100% native local operation with 0ms external calls when standalone mode is active
  const sysCfg = await getBasecampSystemConfig()
  if (sysCfg.runtime_mode === 'standalone') {
    args.skipRemoteMirror = true
  }

  // 4. Global Admin-only actions that do NOT require an existing projectId
  if (action === 'list_manageable_people') {
    if (!isCallerAdmin) {
      return NextResponse.json(
        { error: 'Acceso denegado: Se requieren permisos de Administrador' },
        { status: 403 }
      )
    }
    try {
      const people = await syncAndListManageablePeople(supabase)
      return NextResponse.json({ success: true, people })
    } catch (err: any) {
      console.error('❌ [Basecamp Action] list_manageable_people error:', err.message)
      return NextResponse.json(
        { error: `Failed to list manageable people: ${err.message}` },
        { status: 500 }
      )
    }
  }

  if (action === 'create_project') {
    if (!isCallerAdmin) {
      return NextResponse.json(
        { error: 'Acceso denegado: Se requieren permisos de Administrador' },
        { status: 403 }
      )
    }
    try {
      const cleanName = String(args.name || '').trim()
      if (!cleanName) {
        return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
      }
      const cleanDescription = args.description !== undefined ? String(args.description) : ''
      const cleanColor = String(args.color || 'white').trim() || 'white'
      const isPinned = Boolean(args.isPinned ?? args.is_pinned ?? false)
      const enabledTools = normalizeEnabledTools(args.enabledTools ?? args.enabled_tools)
      const validMemberIds = await validatePersonIdsInDb(
        supabase,
        args.memberPersonIds ?? args.member_person_ids ?? []
      )
      const nowIso = new Date().toISOString()

      const { data: createdProject, error: projErr } = await supabase
        .from('bc_projects')
        .insert({
          bc_id: nextSyntheticBcId(),
          name: cleanName,
          description: cleanDescription,
          color: cleanColor,
          is_pinned: isPinned,
          is_archived: false,
          member_count: validMemberIds.length,
          enabled_tools: enabledTools,
          updated_at: nowIso,
        })
        .select('*')
        .single()

      if (projErr || !createdProject) {
        throw projErr || new Error('Failed to insert project in bc_projects')
      }

      // Initialize all 6 local tool containers so every tool works 100% natively without Basecamp 3
      await ensureProjectToolContainers(supabase, createdProject.id, [...ALL_CANONICAL_DOCK_TOOLS])

      if (validMemberIds.length > 0) {
        const membershipRows = validMemberIds.map((pid) => ({
          project_id: createdProject.id,
          person_id: pid,
          role: 'employee',
        }))
        const { error: memErr } = await supabase
          .from('bc_memberships')
          .upsert(membershipRows, { onConflict: 'project_id,person_id' })
        if (memErr) throw memErr
      }

      return NextResponse.json({
        success: true,
        project: {
          ...createdProject,
          db_id: createdProject.id,
          bc_id: Number(createdProject.bc_id),
          member_count: validMemberIds.length,
        },
      })
    } catch (err: any) {
      console.error('❌ [Basecamp Action] create_project error:', err.message)
      return NextResponse.json(
        { error: `Failed to create project: ${err.message}` },
        { status: 500 }
      )
    }
  }

  if (!projectId) {
    return NextResponse.json({ error: 'Missing action or projectId' }, { status: 400 })
  }

  const rawProjectId = String(projectId).trim()
  const isProjectUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawProjectId)

  const { data: dbProject } = isProjectUuid
    ? await supabase.from('bc_projects').select('id, bc_id').eq('id', rawProjectId).limit(1).maybeSingle()
    : await supabase.from('bc_projects').select('id, bc_id').eq('bc_id', Number(rawProjectId)).limit(1).maybeSingle()

  if (!dbProject) {
    return NextResponse.json({ error: `Project not found with id ${projectId}` }, { status: 404 })
  }

  const projectUuid = dbProject.id
  const bcProjectId = Number(dbProject.bc_id)

  // 5. Enforce project membership authorization for non-admin staff
  const hasProjectAccess = await hasProjectMembershipAccess(
    supabase,
    projectUuid,
    authorPersonId,
    user.email,
    isCallerAdmin
  )
  if (!hasProjectAccess) {
    return NextResponse.json(
      { error: 'Acceso denegado: No perteneces a este proyecto' },
      { status: 403 }
    )
  }
  const reqOrigin = (() => {
    try {
      return new URL(request.url).origin
    } catch {
      return null
    }
  })()

  const requestMediaCache = new Map<string, ClonedMediaCacheEntry>()

  try {
    const generateUniqueBcId = () => nextSyntheticBcId()

    const requireArgs = (names: string[]) => {
      for (const name of names) {
        if (args[name] === undefined || args[name] === null) {
          throw new Error(`Missing required parameter: ${name}`)
        }
      }
    }

    switch (action) {
      case 'update_project': {
        if (!isCallerAdmin) {
          return NextResponse.json(
            { error: 'Acceso denegado: Se requieren permisos de Administrador' },
            { status: 403 }
          )
        }

        const { data: currentProj, error: curErr } = await supabase
          .from('bc_projects')
          .select('*')
          .eq('id', projectUuid)
          .single()

        if (curErr || !currentProj) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        const nextName =
          args.name !== undefined ? String(args.name).trim() : String(currentProj.name || '').trim()
        if (!nextName) {
          return NextResponse.json({ error: 'Project name cannot be empty' }, { status: 400 })
        }

        const nextDescription =
          args.description !== undefined ? String(args.description) : (currentProj.description ?? '')
        const nextColor =
          args.color !== undefined
            ? String(args.color).trim() || 'white'
            : currentProj.color || 'white'

        const rawPinned = args.isPinned !== undefined ? args.isPinned : args.is_pinned
        const nextPinned = rawPinned !== undefined ? Boolean(rawPinned) : Boolean(currentProj.is_pinned)

        const rawArchived = args.isArchived !== undefined ? args.isArchived : args.is_archived
        const nextArchived =
          rawArchived !== undefined ? Boolean(rawArchived) : Boolean(currentProj.is_archived)

        const rawTools = args.enabledTools !== undefined ? args.enabledTools : args.enabled_tools
        const nextTools =
          rawTools !== undefined
            ? normalizeEnabledTools(rawTools, currentProj.enabled_tools)
            : currentProj.enabled_tools

        const { data: updatedProj, error: updErr } = await supabase
          .from('bc_projects')
          .update({
            name: nextName,
            description: nextDescription,
            color: nextColor,
            is_pinned: nextPinned,
            is_archived: nextArchived,
            enabled_tools: nextTools,
            updated_at: new Date().toISOString(),
          })
          .eq('id', projectUuid)
          .select('*')
          .single()

        if (updErr || !updatedProj) {
          throw updErr || new Error('Failed to update project')
        }

        await ensureProjectToolContainers(supabase, projectUuid, updatedProj.enabled_tools)

        return NextResponse.json({
          success: true,
          project: {
            ...updatedProj,
            db_id: updatedProj.id,
            bc_id: Number(updatedProj.bc_id),
          },
        })
      }

      case 'update_project_members': {
        if (!isCallerAdmin) {
          return NextResponse.json(
            { error: 'Acceso denegado: Se requieren permisos de Administrador' },
            { status: 403 }
          )
        }

        const rawMemberIds = args.memberPersonIds ?? args.member_person_ids
        if (!Array.isArray(rawMemberIds)) {
          return NextResponse.json(
            { error: 'memberPersonIds array is required' },
            { status: 400 }
          )
        }

        const validPersonIds = await validatePersonIdsInDb(supabase, rawMemberIds)
        const validSet = new Set(validPersonIds)

        const { data: existingMemberships, error: exMemErr } = await supabase
          .from('bc_memberships')
          .select('id, person_id')
          .eq('project_id', projectUuid)

        if (exMemErr) throw exMemErr

        const existingPersonSet = new Set(
          (existingMemberships || []).map((m: any) => String(m.person_id))
        )
        const toInsert = validPersonIds
          .filter((pid) => !existingPersonSet.has(pid))
          .map((pid) => ({
            project_id: projectUuid,
            person_id: pid,
            role: 'employee',
          }))

        if (toInsert.length > 0) {
          const { error: insErr } = await supabase
            .from('bc_memberships')
            .upsert(toInsert, { onConflict: 'project_id,person_id' })
          if (insErr) throw insErr
        }

        const toDeleteRowIds = (existingMemberships || [])
          .filter((m: any) => !validSet.has(String(m.person_id)))
          .map((m: any) => m.id)

        if (toDeleteRowIds.length > 0) {
          const { error: delErr } = await supabase
            .from('bc_memberships')
            .delete()
            .eq('project_id', projectUuid)
            .in('id', toDeleteRowIds)
          if (delErr) throw delErr
        }

        const { error: projCountErr } = await supabase
          .from('bc_projects')
          .update({
            member_count: validPersonIds.length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', projectUuid)

        if (projCountErr) throw projCountErr

        return NextResponse.json({
          success: true,
          memberCount: validPersonIds.length,
          projectId: projectUuid,
        })
      }

      case 'complete_todo': {
        const todoDbId = args.todoDbId || args.todoId || args.id
        if (!todoDbId) throw new Error('Missing required parameter: todoDbId')

        const { data: todoRow } = await supabase
          .from('bc_todos')
          .select('id, bc_id, todolist_id, group_id, title, created_by_person_id, completion_subscriber_ids')
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!todoRow) {
          return NextResponse.json({ error: 'Todo not found in project' }, { status: 404 })
        }

        const nowIso = new Date().toISOString()
        await supabase
          .from('bc_todos')
          .update({ is_completed: true, completed_at: nowIso, updated_at: nowIso })
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)

        await Promise.all([
          syncTodolistCounts(supabase, todoRow.todolist_id),
          syncTodolistGroupCounts(supabase, todoRow.group_id),
        ])

        const { data: assignees } = await supabase
          .from('bc_todo_assignees')
          .select('person_id')
          .eq('todo_id', todoDbId)

        const involvedIds = [
          ...(assignees || []).map((a: any) => a.person_id).filter(Boolean),
          ...(todoRow.created_by_person_id ? [todoRow.created_by_person_id] : []),
          ...(Array.isArray(todoRow.completion_subscriber_ids) ? todoRow.completion_subscriber_ids : []),
        ]

        await Promise.all([
          !args.skipRemoteMirror && isRealBasecampId(todoRow.bc_id)
            ? basecampBestEffort('complete_todo', () => bcCompleteTodo(bcProjectId, Number(todoRow.bc_id)))
            : Promise.resolve(null),
          createBasecampInAppNotifications({
            projectUuid,
            recordingType: 'todo',
            recordingUuid: todoRow.id,
            actorPersonId: authorPersonId,
            actorName: authorDisplayName,
            title: todoRow.title || 'Tarea completada',
            involvedPersonIds: involvedIds,
            defaultType: 'completed',
          }),
          args.skipEmailNotification
            ? Promise.resolve(null)
            : sendBasecampTodoNotificationEmail({
                event: 'completed',
                todoDbId,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                appOrigin: reqOrigin,
              }),
        ])

        return NextResponse.json({ success: true })
      }

      case 'uncomplete_todo': {
        const todoDbId = args.todoDbId || args.todoId || args.id
        if (!todoDbId) throw new Error('Missing required parameter: todoDbId')

        const { data: todoRow } = await supabase
          .from('bc_todos')
          .select('id, bc_id, todolist_id, group_id')
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!todoRow) {
          return NextResponse.json({ error: 'Todo not found in project' }, { status: 404 })
        }

        await supabase
          .from('bc_todos')
          .update({ is_completed: false, completed_at: null, updated_at: new Date().toISOString() })
          .eq('id', todoDbId)
          .eq('project_id', projectUuid)

        await Promise.all([
          syncTodolistCounts(supabase, todoRow.todolist_id),
          syncTodolistGroupCounts(supabase, todoRow.group_id),
        ])

        await Promise.all([
          !args.skipRemoteMirror && isRealBasecampId(todoRow.bc_id)
            ? basecampBestEffort('uncomplete_todo', () => bcUncompleteTodo(bcProjectId, Number(todoRow.bc_id)))
            : Promise.resolve(null),
          args.skipEmailNotification
            ? Promise.resolve(null)
            : sendBasecampTodoNotificationEmail({
                event: 'reopened',
                todoDbId,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                appOrigin: reqOrigin,
              }),
        ])

        return NextResponse.json({ success: true })
      }

      case 'create_todolist': {
        requireArgs(['name'])
        const { name, description, color } = args
        let finalListBcId = generateUniqueBcId()

        const { data: dbTodoset } = await supabase
          .from('bc_todosets')
          .select('id, bc_id')
          .eq('project_id', projectUuid)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        let todosetUuid = dbTodoset?.id
        const todosetBcId = dbTodoset?.bc_id ? Number(dbTodoset.bc_id) : null

        if (!todosetUuid) {
          const { data: newTodoset, error: setErr } = await supabase
            .from('bc_todosets')
            .insert({
              project_id: projectUuid,
              name: 'Todoset',
              bc_id: generateUniqueBcId(),
            })
            .select('id')
            .single()

          if (setErr) throw setErr
          todosetUuid = newTodoset?.id
        }

        const cleanListDesc = await uploadEmbeddedDataUrisToStorage(description, 'todolists', supabase)
        const { data: dbList, error: listErr } = await supabase
          .from('bc_todolists')
          .insert({
            bc_id: finalListBcId,
            project_id: projectUuid,
            todoset_id: todosetUuid,
            name: String(name).trim(),
            description: cleanListDesc,
            color: color || null,
            position: 99,
            completed_count: 0,
            total_count: 0,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (listErr) throw listErr

        // Mirror to Basecamp 3 when project has a real todoset_id
        if (!args.skipRemoteMirror && isRealBasecampId(todosetBcId) && isRealBasecampId(bcProjectId)) {
          const bcReadyDesc = await prepareOutboundHtmlForBasecamp(cleanListDesc, supabase)
          const bcList = await basecampBestEffort('create_todolist', () =>
            bcCreateTodolistRemote(bcProjectId, Number(todosetBcId), String(name).trim(), bcReadyDesc || undefined)
          )
          if (bcList?.id && dbList?.id) {
            finalListBcId = bcList.id
            await supabase.from('bc_todolists').delete().eq('bc_id', bcList.id).neq('id', dbList.id)
            await supabase
              .from('bc_todolists')
              .update({
                bc_id: bcList.id,
                position: bcList.position ?? 99,
                color: color || bcList.color || null,
                bc_completed_ratio: bcList.completed_ratio || '0/0',
              })
              .eq('id', dbList.id)
          }
        }

        return NextResponse.json({ success: true, id: dbList?.id, bc_id: finalListBcId })
      }

      case 'update_todolist': {
        const todolistDbId = args.todolistDbId || args.todolistId || args.id
        if (!todolistDbId) throw new Error('Missing required parameter: todolistDbId')

        const { data: existingList } = await supabase
          .from('bc_todolists')
          .select('id, bc_id, name, description, color, position')
          .eq('id', todolistDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!existingList) {
          return NextResponse.json({ error: 'Todolist not found in project' }, { status: 404 })
        }

        const finalName = args.name !== undefined ? String(args.name).trim() || existingList.name : existingList.name
        const finalDesc =
          args.description !== undefined
            ? await uploadEmbeddedDataUrisToStorage(args.description, 'todolists', supabase)
            : existingList.description || ''
        const finalColor = args.color !== undefined ? args.color || null : existingList.color
        const finalPos = args.position !== undefined ? Math.max(1, Number(args.position) || 1) : existingList.position

        const { error: updErr } = await supabase
          .from('bc_todolists')
          .update({
            name: finalName,
            description: finalDesc,
            color: finalColor,
            position: finalPos,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingList.id)

        if (updErr) throw updErr

        if (!args.skipRemoteMirror && isRealBasecampId(existingList.bc_id) && isRealBasecampId(bcProjectId)) {
          const bcReadyDesc = await prepareOutboundHtmlForBasecamp(finalDesc, supabase)
          await basecampBestEffort('update_todolist', () =>
            bcUpdateTodolistRemote(bcProjectId, Number(existingList.bc_id), finalName, bcReadyDesc)
          )
        }

        return NextResponse.json({
          success: true,
          id: existingList.id,
          name: finalName,
          description: finalDesc,
          color: finalColor,
        })
      }

      case 'create_todolist_group': {
        const todolistDbId = args.todolistDbId || args.todolistId
        if (!todolistDbId || !args.name) {
          throw new Error('Missing required parameters: todolistDbId and name')
        }

        const { data: todolistRow } = await supabase
          .from('bc_todolists')
          .select('id, bc_id')
          .eq('id', todolistDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!todolistRow) {
          return NextResponse.json({ error: 'Todolist not found in project' }, { status: 404 })
        }

        const { count: existingGroupCount } = await supabase
          .from('bc_todolist_groups')
          .select('*', { count: 'exact', head: true })
          .eq('todolist_id', todolistRow.id)

        let finalGroupBcId = generateUniqueBcId()
        const groupName = String(args.name).trim()
        const groupColor = args.color || null
        const groupPosition =
          args.position !== undefined ? Math.max(1, Number(args.position) || 1) : (existingGroupCount ?? 0) + 1
        const nowIso = new Date().toISOString()

        const { data: dbGroup, error: grpErr } = await supabase
          .from('bc_todolist_groups')
          .insert({
            bc_id: finalGroupBcId,
            project_id: projectUuid,
            todolist_id: todolistRow.id,
            name: groupName,
            color: groupColor,
            position: groupPosition,
            completed_count: 0,
            total_count: 0,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select('*')
          .single()

        if (grpErr) throw grpErr

        if (!args.skipRemoteMirror && isRealBasecampId(todolistRow.bc_id) && isRealBasecampId(bcProjectId)) {
          const bcGroup = await basecampBestEffort('create_todolist_group', () =>
            bcCreateTodolistGroupRemote(bcProjectId, Number(todolistRow.bc_id), groupName, groupColor || undefined)
          )
          if (bcGroup?.id && dbGroup?.id) {
            finalGroupBcId = bcGroup.id
            await supabase.from('bc_todolist_groups').delete().eq('bc_id', bcGroup.id).neq('id', dbGroup.id)
            await supabase
              .from('bc_todolist_groups')
              .update({
                bc_id: bcGroup.id,
                color: groupColor || bcGroup.color || null,
                position: bcGroup.position ?? groupPosition,
              })
              .eq('id', dbGroup.id)
          }
        }

        return NextResponse.json({
          success: true,
          id: dbGroup?.id,
          bc_id: finalGroupBcId,
          group: { ...dbGroup, bc_id: finalGroupBcId },
        })
      }

      case 'update_todolist_group': {
        const groupDbId = args.groupDbId || args.groupId || args.id
        if (!groupDbId) throw new Error('Missing required parameter: groupDbId')

        const { data: existingGroup } = await supabase
          .from('bc_todolist_groups')
          .select('id, bc_id, name, color, position')
          .eq('id', groupDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!existingGroup) {
          return NextResponse.json({ error: 'Todolist group not found in project' }, { status: 404 })
        }

        const finalName = args.name !== undefined ? String(args.name).trim() || existingGroup.name : existingGroup.name
        const finalColor = args.color !== undefined ? args.color || null : existingGroup.color
        const finalPos = args.position !== undefined ? Math.max(1, Number(args.position) || 1) : existingGroup.position

        const { error: updErr } = await supabase
          .from('bc_todolist_groups')
          .update({
            name: finalName,
            color: finalColor,
            position: finalPos,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingGroup.id)

        if (updErr) throw updErr

        if (!args.skipRemoteMirror && isRealBasecampId(existingGroup.bc_id) && isRealBasecampId(bcProjectId)) {
          await basecampBestEffort('update_todolist_group', () =>
            bcUpdateTodolistRemote(bcProjectId, Number(existingGroup.bc_id), finalName, '')
          )
        }

        return NextResponse.json({
          success: true,
          id: existingGroup.id,
          name: finalName,
          color: finalColor,
          position: finalPos,
        })
      }

      case 'create_todo': {
        const todolistDbId = args.todolistDbId || args.todolistId
        if (!todolistDbId || !args.title) {
          throw new Error('Missing required parameters: todolistDbId and title')
        }
        const { title, description, assigneeUuids, subtasks } = args
        const startsOnVal = normalizeDateOrNull(args.starts_on)
        const dueDateVal = normalizeDateOrNull(args.due_date ?? args.due_on)
        const groupUuid: string | null = args.groupDbId ?? args.group_id ?? args.groupId ?? null
        const bcTodoId = generateUniqueBcId()
        let cleanTodoDesc = await uploadEmbeddedDataUrisToStorage(description, 'todos', supabase, requestMediaCache)

        const validSubtasks = Array.isArray(subtasks)
          ? subtasks.map((s: any) => String(s || '').trim()).filter(Boolean)
          : []
        if (validSubtasks.length > 0) {
          const escHtml = (v: string) =>
            v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
          const itemsHtml = validSubtasks.map((st: string) => `<li>☐ ${escHtml(st)}</li>`).join('')
          const subtasksBlock = `<div data-teg-subtasks="true" style="margin-top: 10px;"><strong>Subtasks:</strong><ul>${itemsHtml}</ul></div>`
          cleanTodoDesc = cleanTodoDesc ? `${cleanTodoDesc}${subtasksBlock}` : subtasksBlock
        }

        const { data: dbTodo, error: todoErr } = await supabase
          .from('bc_todos')
          .insert({
            bc_id: bcTodoId,
            project_id: projectUuid,
            todolist_id: todolistDbId,
            group_id: groupUuid,
            title: String(title).trim(),
            description: cleanTodoDesc,
            is_completed: false,
            starts_on: startsOnVal,
            due_date: dueDateVal,
             ...(args.position !== undefined ? { position: Math.max(1, Number(args.position) || 1) } : {}),
            created_by_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (todoErr) throw todoErr

        const cleanAssigneeUuids: string[] = Array.isArray(assigneeUuids)
          ? Array.from(new Set(assigneeUuids.filter(Boolean)))
          : []
        if (cleanAssigneeUuids.length > 0 && dbTodo) {
          const assigneeRows = cleanAssigneeUuids.map((uid: string) => ({
            todo_id: dbTodo.id,
            person_id: uid,
          }))
          await supabase.from('bc_todo_assignees').insert(assigneeRows)
        }

        await Promise.all([
          syncTodolistCounts(supabase, todolistDbId),
          syncTodolistGroupCounts(supabase, groupUuid),
        ])

        let finalTodoBcId = bcTodoId
        const [{ data: todolistRow }, { data: groupRow }] = await Promise.all([
          supabase.from('bc_todolists').select('bc_id').eq('id', todolistDbId).maybeSingle(),
          groupUuid
            ? supabase.from('bc_todolist_groups').select('bc_id').eq('id', groupUuid).maybeSingle()
            : Promise.resolve({ data: null as any }),
        ])

        const targetParentBcId =
          groupRow?.bc_id && isRealBasecampId(groupRow.bc_id)
            ? Number(groupRow.bc_id)
            : todolistRow?.bc_id && isRealBasecampId(todolistRow.bc_id)
            ? Number(todolistRow.bc_id)
            : null

        const mirrorPromise = (async () => {
          if (args.skipRemoteMirror || !targetParentBcId || !isRealBasecampId(bcProjectId)) return
          const assigneeBcIds = await resolveRealBcPersonIds(supabase, cleanAssigneeUuids)
          const bcReadyDesc = await prepareOutboundHtmlForBasecamp(cleanTodoDesc, supabase, requestMediaCache)
          const bcDescriptionWithAuthor = buildBasecampDescriptionWithAuthor(
            bcReadyDesc,
            authorDisplayName,
            user.email
          )

          const bcResult = await basecampBestEffort('create_todo', () =>
            bcCreateTodo(bcProjectId, targetParentBcId, {
              content: String(title).trim(),
              description: bcDescriptionWithAuthor || undefined,
              assignee_ids: assigneeBcIds.length > 0 ? assigneeBcIds : undefined,
              notify: false,
              starts_on: startsOnVal || undefined,
              due_on: dueDateVal || undefined,
            })
          )

          if (bcResult && dbTodo) {
            finalTodoBcId = bcResult.id
            await supabase.from('bc_todos').delete().eq('bc_id', bcResult.id).neq('id', dbTodo.id)
            await supabase
              .from('bc_todos')
              .update({ bc_id: bcResult.id, created_by_person_id: authorPersonId })
              .eq('id', dbTodo.id)
          }
        })()

        const inAppPromise = dbTodo?.id
          ? createBasecampInAppNotifications({
              projectUuid,
              recordingType: 'todo',
              recordingUuid: dbTodo.id,
              actorPersonId: authorPersonId,
              actorName: authorDisplayName,
              title: String(title).trim(),
              rawHtml: cleanTodoDesc,
              assignedPersonIds: cleanAssigneeUuids,
              defaultType: 'assigned',
            })
          : Promise.resolve(null)

        const emailPromise =
          args.skipEmailNotification || !dbTodo?.id
            ? Promise.resolve(null)
            : sendBasecampTodoNotificationEmail({
                event: 'assigned',
                todoDbId: dbTodo.id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                appOrigin: reqOrigin,
              })

        await Promise.all([mirrorPromise, inAppPromise, emailPromise])

        return NextResponse.json({ success: true, id: dbTodo?.id, bc_id: finalTodoBcId })
      }

      case 'update_todo': {
        const todoDbId = args.todoDbId || args.todoId || args.id
        if (!todoDbId) throw new Error('Missing required parameter: todoDbId')

        const [{ data: existingTodo }, { data: existingAssigneeRows }, { data: allPeopleRows }] = await Promise.all([
          supabase
            .from('bc_todos')
            .select(
              'id, bc_id, project_id, todolist_id, group_id, title, description, starts_on, due_date, position, is_completed, completion_subscriber_ids, created_by_person_id'
            )
            .eq('id', todoDbId)
            .eq('project_id', projectUuid)
            .maybeSingle(),
          supabase.from('bc_todo_assignees').select('person_id').eq('todo_id', todoDbId),
          supabase.from('bc_people').select('id, bc_id, name, email, is_active, attachable_sgid').limit(5000),
        ])

        if (!existingTodo) {
          return NextResponse.json({ error: 'Todo not found in project' }, { status: 404 })
        }

        const prevAssigneeSet = new Set<string>((existingAssigneeRows || []).map((r: any) => r.person_id).filter(Boolean))
        const allPeople = allPeopleRows || []

        const finalTitle =
          args.title !== undefined
            ? String(args.title).trim() || existingTodo.title
            : args.content !== undefined
            ? String(args.content).trim() || existingTodo.title
            : existingTodo.title

        const finalDesc =
          args.description !== undefined
            ? await uploadEmbeddedDataUrisToStorage(args.description, 'todos', supabase, requestMediaCache)
            : existingTodo.description || ''

        const finalStartsOn =
          args.starts_on !== undefined ? normalizeDateOrNull(args.starts_on) : existingTodo.starts_on || null

        const finalDueDate =
          args.due_date !== undefined
            ? normalizeDateOrNull(args.due_date)
            : args.due_on !== undefined
            ? normalizeDateOrNull(args.due_on)
            : existingTodo.due_date || null

        const hasGroupArg =
          args.group_id !== undefined || args.groupDbId !== undefined || args.groupId !== undefined
        const rawGroupArg = args.group_id ?? args.groupDbId ?? args.groupId ?? null
        const finalGroupId: string | null = hasGroupArg ? rawGroupArg || null : existingTodo.group_id || null

        const rawAssigneesArg = args.assigneeUuids !== undefined ? args.assigneeUuids : args.assignee_ids
        const hasAssigneesArg = Array.isArray(rawAssigneesArg)
        const finalAssigneeUuids: string[] = hasAssigneesArg
          ? Array.from(new Set(rawAssigneesArg.filter(Boolean)))
          : Array.from(prevAssigneeSet)

        const nowIso = new Date().toISOString()
        const { error: updErr } = await supabase
          .from('bc_todos')
          .update({
            title: finalTitle,
            description: finalDesc,
            starts_on: finalStartsOn,
            due_date: finalDueDate,
            group_id: finalGroupId,
            updated_at: nowIso,
          })
          .eq('id', existingTodo.id)

        if (updErr) throw updErr

        if (hasAssigneesArg) {
          await supabase.from('bc_todo_assignees').delete().eq('todo_id', existingTodo.id)
          if (finalAssigneeUuids.length > 0) {
            await supabase.from('bc_todo_assignees').insert(
              finalAssigneeUuids.map((uid) => ({
                todo_id: existingTodo.id,
                person_id: uid,
              }))
            )
          }
        }

        if ((existingTodo.group_id || null) !== (finalGroupId || null)) {
          await Promise.all([
            syncTodolistGroupCounts(supabase, existingTodo.group_id),
            syncTodolistGroupCounts(supabase, finalGroupId),
          ])
        }

        const newlyAssignedIds = finalAssigneeUuids.filter((uid) => !prevAssigneeSet.has(uid))
        const prevMentionedSet = new Set(extractMentionedPersonIds(existingTodo.description || '', allPeople))
        const currentMentionedIds = extractMentionedPersonIds(finalDesc, allPeople)
        const newlyMentionedIds = currentMentionedIds.filter((uid) => !prevMentionedSet.has(uid))

        // Mirror to Basecamp 3 (preserving completion_subscriber_ids so we never wipe When Done subscribers!)
        const mirrorUpdatePromise = (async () => {
          if (args.skipRemoteMirror || !isRealBasecampId(existingTodo.bc_id) || !isRealBasecampId(bcProjectId)) return

          const [assigneeBcIds, completionSubBcIds] = await Promise.all([
            resolveRealBcPersonIds(supabase, finalAssigneeUuids),
            resolveRealBcPersonIds(
              supabase,
              Array.isArray(existingTodo.completion_subscriber_ids) ? existingTodo.completion_subscriber_ids : []
            ),
          ])

          const creatorRow = existingTodo.created_by_person_id
            ? allPeople.find((p: any) => p.id === existingTodo.created_by_person_id)
            : null
          const attributionName = creatorRow?.name || authorDisplayName
          const attributionEmail = creatorRow?.email || user.email

          const bcReadyDesc = await prepareOutboundHtmlForBasecamp(finalDesc, supabase, requestMediaCache)
          const bcDescWithAuthor = buildBasecampDescriptionWithAuthor(
            bcReadyDesc,
            attributionName,
            attributionEmail
          )

          await basecampBestEffort('update_todo', () =>
            bcUpdateTodo(bcProjectId, Number(existingTodo.bc_id), {
              content: finalTitle,
              description: bcDescWithAuthor,
              assignee_ids: assigneeBcIds,
              completion_subscriber_ids: completionSubBcIds,
              starts_on: finalStartsOn,
              due_on: finalDueDate,
              notify: false,
            })
          )

          if ((existingTodo.group_id || null) !== (finalGroupId || null)) {
            let targetParentBcId: number | undefined
            if (finalGroupId) {
              const { data: grp } = await supabase
                .from('bc_todolist_groups')
                .select('bc_id')
                .eq('id', finalGroupId)
                .maybeSingle()
              if (grp?.bc_id && isRealBasecampId(grp.bc_id)) targetParentBcId = Number(grp.bc_id)
            } else if (existingTodo.todolist_id) {
              const { data: lst } = await supabase
                .from('bc_todolists')
                .select('bc_id')
                .eq('id', existingTodo.todolist_id)
                .maybeSingle()
              if (lst?.bc_id && isRealBasecampId(lst.bc_id)) targetParentBcId = Number(lst.bc_id)
            }
            if (targetParentBcId) {
              await basecampBestEffort('reposition_todo_group', () =>
                bcRepositionTodo(
                  bcProjectId,
                  Number(existingTodo.bc_id),
                  Number(existingTodo.position || 1),
                  targetParentBcId
                )
              )
            }
          }
        })()

        const shouldNotifyInApp = newlyAssignedIds.length > 0 || newlyMentionedIds.length > 0
        const inAppUpdatePromise = shouldNotifyInApp
          ? createBasecampInAppNotifications({
              projectUuid,
              recordingType: 'todo',
              recordingUuid: existingTodo.id,
              actorPersonId: authorPersonId,
              actorName: authorDisplayName,
              title: finalTitle,
              rawHtml: finalDesc,
              mentionedPersonIds: newlyMentionedIds,
              assignedPersonIds: newlyAssignedIds,
              defaultType: newlyMentionedIds.length > 0 ? 'mention' : 'assigned',
            })
          : Promise.resolve(null)

        const shouldSendEmail =
          !args.skipEmailNotification &&
          (newlyAssignedIds.length > 0 || newlyMentionedIds.length > 0 || finalAssigneeUuids.length > 0)
        const emailUpdatePromise = shouldSendEmail
          ? sendBasecampTodoNotificationEmail({
              event: newlyAssignedIds.length > 0 ? 'assigned' : 'updated',
              todoDbId: existingTodo.id,
              actorPersonId: authorPersonId,
              actorName: authorDisplayName,
              actorEmail: user.email,
              excludeActorOnAssigned: true,
              appOrigin: reqOrigin,
            })
          : Promise.resolve(null)

        await Promise.all([mirrorUpdatePromise, inAppUpdatePromise, emailUpdatePromise])

        return NextResponse.json({
          success: true,
          id: existingTodo.id,
          title: finalTitle,
          description: finalDesc,
          starts_on: finalStartsOn,
          due_date: finalDueDate,
          group_id: finalGroupId,
          assigneeUuids: finalAssigneeUuids,
        })
      }

      case 'move_todo': {
        const todoDbId = args.todoDbId || args.todoId || args.id
        if (!todoDbId) throw new Error('Missing required parameter: todoDbId')

        const { data: todoRow } = await supabase
          .from('bc_todos')
          .select(
            'id, bc_id, project_id, todolist_id, group_id, title, description, is_completed, starts_on, due_date, position, created_by_person_id'
          )
          .eq('id', todoDbId)
          .maybeSingle()

        if (!todoRow) {
          return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
        }

        const requestedListId =
          args.targetTodolistId || args.targetTodolistDbId || args.todolistDbId || args.todolist_id || todoRow.todolist_id
        const { data: destList } = await supabase
          .from('bc_todolists')
          .select('id, bc_id, project_id, name')
          .eq('id', requestedListId)
          .maybeSingle()

        if (!destList) {
          return NextResponse.json({ error: 'Destination todolist not found' }, { status: 404 })
        }

        const hasTargetGroupArg =
          args.targetGroupId !== undefined || args.targetGroupDbId !== undefined || args.group_id !== undefined
        const rawTargetGroupId = args.targetGroupId ?? args.targetGroupDbId ?? args.group_id ?? null
        let destGroup: { id: string; bc_id: number | string; todolist_id: string } | null = null
        if (hasTargetGroupArg && rawTargetGroupId) {
          const { data: grp } = await supabase
            .from('bc_todolist_groups')
            .select('id, bc_id, todolist_id')
            .eq('id', rawTargetGroupId)
            .maybeSingle()
          if (grp && grp.todolist_id === destList.id) {
            destGroup = grp
          }
        } else if (!hasTargetGroupArg && destList.id === todoRow.todolist_id && todoRow.group_id) {
          const { data: grp } = await supabase
            .from('bc_todolist_groups')
            .select('id, bc_id, todolist_id')
            .eq('id', todoRow.group_id)
            .maybeSingle()
          destGroup = grp || null
        }

        const [{ data: sourceProj }, { data: destProj }] = await Promise.all([
          supabase.from('bc_projects').select('id, bc_id, name').eq('id', todoRow.project_id).maybeSingle(),
          supabase.from('bc_projects').select('id, bc_id, name').eq('id', destList.project_id).maybeSingle(),
        ])

        const targetPosition =
          args.position !== undefined ? Math.max(1, Math.floor(Number(args.position) || 1)) : 1
        const isSameProject = todoRow.project_id === destList.project_id

        if (!isSameProject && !isCallerAdmin) {
          const hasDestAccess = await hasProjectMembershipAccess(
            supabase,
            destList.project_id,
            authorPersonId,
            user.email,
            isCallerAdmin
          )
          if (!hasDestAccess) {
            return NextResponse.json(
              { error: 'Acceso denegado: No perteneces al proyecto destino' },
              { status: 403 }
            )
          }
        }
        const nowIso = new Date().toISOString()

        const reindexDestinationSiblings = async () => {
          let sibQuery = supabase
            .from('bc_todos')
            .select('id, position, created_at')
            .eq('todolist_id', destList.id)
            .eq('is_completed', false)
            .neq('id', todoRow.id)
          sibQuery = destGroup ? sibQuery.eq('group_id', destGroup.id) : sibQuery.is('group_id', null)
          const { data: siblings } = await sibQuery
          if (!siblings || siblings.length === 0) return
          const ordered = [...siblings].sort((a: any, b: any) => {
            const pa = Number(a.position ?? 999999)
            const pb = Number(b.position ?? 999999)
            if (pa !== pb) return pa - pb
            return String(a.created_at || '').localeCompare(String(b.created_at || ''))
          })
          const insertIdx = Math.max(0, Math.min(ordered.length, targetPosition - 1))
          const finalOrderIds = [
            ...ordered.slice(0, insertIdx).map((r: any) => r.id),
            todoRow.id,
            ...ordered.slice(insertIdx).map((r: any) => r.id),
          ]
          await Promise.all(
            finalOrderIds.map((id, idx) => {
              const desiredPos = idx + 1
              if (id === todoRow.id) {
                return desiredPos !== targetPosition
                  ? supabase.from('bc_todos').update({ position: desiredPos }).eq('id', id)
                  : Promise.resolve()
              }
              const prev = ordered.find((r: any) => r.id === id)
              if (Number(prev?.position) === desiredPos) return Promise.resolve()
              return supabase.from('bc_todos').update({ position: desiredPos }).eq('id', id)
            })
          )
        }

        if (isSameProject) {
          const { error: mvErr } = await supabase
            .from('bc_todos')
            .update({
              todolist_id: destList.id,
              group_id: destGroup ? destGroup.id : null,
              position: targetPosition,
              updated_at: nowIso,
            })
            .eq('id', todoRow.id)

          if (mvErr) throw mvErr

          await Promise.all([
            reindexDestinationSiblings(),
            syncTodolistCounts(supabase, todoRow.todolist_id),
            destList.id !== todoRow.todolist_id ? syncTodolistCounts(supabase, destList.id) : Promise.resolve(),
            syncTodolistGroupCounts(supabase, todoRow.group_id),
            (destGroup?.id || null) !== (todoRow.group_id || null)
              ? syncTodolistGroupCounts(supabase, destGroup?.id || null)
              : Promise.resolve(),
          ])

          if (!args.skipRemoteMirror && isRealBasecampId(todoRow.bc_id) && isRealBasecampId(destProj?.bc_id)) {
            const parentBcId =
              destGroup && isRealBasecampId(destGroup.bc_id)
                ? Number(destGroup.bc_id)
                : isRealBasecampId(destList.bc_id)
                ? Number(destList.bc_id)
                : undefined

            await basecampBestEffort('move_todo_same_project', () =>
              bcRepositionTodo(Number(destProj!.bc_id), Number(todoRow.bc_id), targetPosition, parentBcId)
            )
          }

          return NextResponse.json({
            success: true,
            id: todoRow.id,
            bc_id: todoRow.bc_id,
            project_id: destList.project_id,
            todolist_id: destList.id,
            group_id: destGroup ? destGroup.id : null,
            position: targetPosition,
          })
        }

        // Cross-project move (e.g., All Locations -> Edison cases)
        const { error: crossMvErr } = await supabase
          .from('bc_todos')
          .update({
            project_id: destList.project_id,
            todolist_id: destList.id,
            group_id: destGroup ? destGroup.id : null,
            position: targetPosition,
            updated_at: nowIso,
          })
          .eq('id', todoRow.id)

        if (crossMvErr) throw crossMvErr

        await Promise.all([
          supabase
            .from('bc_comments')
            .update({ project_id: destList.project_id })
            .eq('parent_type', 'todo')
            .eq('parent_id', todoRow.id),
          supabase
            .from('bc_boosts')
            .update({ project_id: destList.project_id })
            .eq('recording_type', 'todo')
            .eq('recording_id', todoRow.id),
          supabase
            .from('bc_notifications')
            .update({ project_id: destList.project_id })
            .eq('recording_type', 'todo')
            .eq('recording_id', todoRow.id),
          syncTodolistCounts(supabase, todoRow.todolist_id),
          syncTodolistCounts(supabase, destList.id),
          syncTodolistGroupCounts(supabase, todoRow.group_id),
          syncTodolistGroupCounts(supabase, destGroup?.id || null),
        ])

        let finalMovedBcId = todoRow.bc_id
        if (!args.skipRemoteMirror && isRealBasecampId(destProj?.bc_id)) {
          const destParentBcId =
            destGroup && isRealBasecampId(destGroup.bc_id)
              ? Number(destGroup.bc_id)
              : isRealBasecampId(destList.bc_id)
              ? Number(destList.bc_id)
              : null

          if (destParentBcId) {
            const [{ data: assRows }, { data: commentRows }] = await Promise.all([
              supabase.from('bc_todo_assignees').select('person_id').eq('todo_id', todoRow.id),
              supabase
                .from('bc_comments')
                .select('id, content, author_person_id, author:bc_people(name, email)')
                .eq('parent_type', 'todo')
                .eq('parent_id', todoRow.id)
                .order('created_at', { ascending: true }),
            ])

            const assigneeBcIds = await resolveRealBcPersonIds(
              supabase,
              (assRows || []).map((r: any) => r.person_id)
            )
            const bcReadyDesc = await prepareOutboundHtmlForBasecamp(todoRow.description || '', supabase)
            const newBcTodo = await basecampBestEffort('move_todo_cross_project_create', () =>
              bcCreateTodo(Number(destProj!.bc_id), destParentBcId, {
                content: todoRow.title,
                description: bcReadyDesc || undefined,
                assignee_ids: assigneeBcIds.length > 0 ? assigneeBcIds : undefined,
                starts_on: todoRow.starts_on || undefined,
                due_on: todoRow.due_date || undefined,
                notify: false,
              })
            )

            if (newBcTodo?.id) {
              finalMovedBcId = newBcTodo.id
              await supabase.from('bc_todos').delete().eq('bc_id', newBcTodo.id).neq('id', todoRow.id)
              await supabase.from('bc_todos').update({ bc_id: newBcTodo.id }).eq('id', todoRow.id)

              if (todoRow.is_completed) {
                await basecampBestEffort('move_todo_cross_project_complete', () =>
                  bcCompleteTodo(Number(destProj!.bc_id), newBcTodo.id)
                )
              }

              for (const com of commentRows || []) {
                const authorObj: any = Array.isArray((com as any).author)
                  ? (com as any).author[0]
                  : (com as any).author
                const bcComHtml = await prepareOutboundHtmlForBasecamp(com.content || '', supabase)
                const stampedCom = buildBasecampCommentWithAuthor(
                  bcComHtml,
                  authorObj?.name || authorDisplayName,
                  authorObj?.email || null
                )
                const newBcCom = await basecampBestEffort('move_todo_cross_project_comment', () =>
                  bcCreateComment(Number(destProj!.bc_id), newBcTodo.id, stampedCom)
                )
                if (newBcCom?.id) {
                  await supabase.from('bc_comments').delete().eq('bc_id', newBcCom.id).neq('id', com.id)
                  await supabase.from('bc_comments').update({ bc_id: newBcCom.id }).eq('id', com.id)
                }
              }

              if (isRealBasecampId(todoRow.bc_id) && isRealBasecampId(sourceProj?.bc_id)) {
                await basecampBestEffort('move_todo_cross_project_trash_old', () =>
                  bcTrashRecording(Number(sourceProj!.bc_id), Number(todoRow.bc_id))
                )
              }
            }
          }
        }

        return NextResponse.json({
          success: true,
          id: todoRow.id,
          bc_id: finalMovedBcId,
          project_id: destList.project_id,
          project_bc_id: destProj?.bc_id || bcProjectId,
          todolist_id: destList.id,
          group_id: destGroup ? destGroup.id : null,
          position: targetPosition,
        })
      }

      case 'create_message': {
        requireArgs(['title'])
        const { title, content, category } = args
        let resolvedBoardDbId: string | null = args.boardDbId || args.boardId || null
        let boardBcId: number | null = null

        if (resolvedBoardDbId) {
          const { data: boardRow } = await supabase
            .from('bc_message_boards')
            .select('id, bc_id')
            .eq('id', resolvedBoardDbId)
            .maybeSingle()
          if (boardRow) {
            resolvedBoardDbId = boardRow.id
            boardBcId = boardRow.bc_id ? Number(boardRow.bc_id) : null
          }
        }
        if (!resolvedBoardDbId) {
          const { data: fallbackBoard } = await supabase
            .from('bc_message_boards')
            .select('id, bc_id')
            .eq('project_id', projectUuid)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (fallbackBoard?.id) {
            resolvedBoardDbId = fallbackBoard.id
            boardBcId = fallbackBoard.bc_id ? Number(fallbackBoard.bc_id) : null
          } else {
            const { data: newBoard, error: newBoardErr } = await supabase
              .from('bc_message_boards')
              .insert({
                bc_id: generateUniqueBcId(),
                project_id: projectUuid,
                title: 'Message Board',
              })
              .select('id')
              .single()
            if (newBoardErr) throw newBoardErr
            resolvedBoardDbId = newBoard?.id || null
          }
        }

        const effectiveNotifyMode: BasecampMessageNotifyMode =
          args.notifyMode === 'none' || args.notifyMode === 'selected' || args.notifyMode === 'all'
            ? args.notifyMode
            : 'all'
        const rawSelectedUuids = Array.isArray(args.notifyPersonUuids)
          ? args.notifyPersonUuids
          : Array.isArray(args.selectedPersonIds)
          ? args.selectedPersonIds
          : []
        const cleanSelectedPersonUuids: string[] = Array.from(new Set(rawSelectedUuids.filter(Boolean)))
        const finalCategory = String(category || '').trim() || 'General'
        const initialPinned = Boolean(args.is_pinned)

        const bcMsgId = generateUniqueBcId()
        const cleanMsgContent = await uploadEmbeddedDataUrisToStorage(content, 'messages', supabase, requestMediaCache)
        const nowIso = new Date().toISOString()

        const { data: dbMsg, error: msgErr } = await supabase
          .from('bc_messages')
          .insert({
            bc_id: bcMsgId,
            project_id: projectUuid,
            board_id: resolvedBoardDbId,
            title: String(title).trim(),
            content: cleanMsgContent,
            category: finalCategory,
            is_pinned: initialPinned,
            author_person_id: authorPersonId,
            comments_count: 0,
            updated_at: nowIso,
          })
          .select('id')
          .single()

        if (msgErr) throw msgErr

        let finalMsgBcId = bcMsgId

        const mirrorMsgPromise = (async () => {
          if (args.skipRemoteMirror || !isRealBasecampId(boardBcId) || !isRealBasecampId(bcProjectId)) return
          const [bcReadyMsg, remoteCategoryId] = await Promise.all([
            prepareOutboundHtmlForBasecamp(cleanMsgContent, supabase, requestMediaCache),
            resolveRemoteMessageCategoryId(bcProjectId, finalCategory),
          ])
          const bcMsgContentWithAuthor = buildBasecampCommentWithAuthor(
            bcReadyMsg,
            authorDisplayName,
            user.email
          )
          // Publish immediately with status='active' & subscriptions=[] so Basecamp 3 does NOT double-email
          const bcResult = await basecampBestEffort('create_message', () =>
            bcCreateMessage(bcProjectId, Number(boardBcId), {
              subject: String(title).trim(),
              content: bcMsgContentWithAuthor || undefined,
              status: 'active',
              ...(remoteCategoryId ? { category_id: remoteCategoryId } : {}),
              subscriptions: [],
            })
          )

          if (bcResult && dbMsg) {
            finalMsgBcId = bcResult.id
            await supabase.from('bc_messages').delete().eq('bc_id', bcResult.id).neq('id', dbMsg.id)
            await supabase
              .from('bc_messages')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbMsg.id)

            if (initialPinned && isRealBasecampId(bcResult.id)) {
              await basecampBestEffort('pin_created_message', () =>
                bcPinRecordingRemote(bcProjectId, Number(bcResult.id))
              )
            }
          }
        })()

        const inAppMsgPromise = (async () => {
          if (!dbMsg?.id) return null
          let involvedIds: string[] = []
          let allowSelf = false
          if (effectiveNotifyMode === 'selected') {
            involvedIds = cleanSelectedPersonUuids
            allowSelf = true
          } else if (effectiveNotifyMode === 'all') {
            const { data: memRows } = await supabase
              .from('bc_memberships')
              .select('person_id')
              .eq('project_id', projectUuid)
            involvedIds = (memRows || []).map((r: any) => r.person_id).filter(Boolean)
          }
          return createBasecampInAppNotifications({
            projectUuid,
            recordingType: 'message',
            recordingUuid: dbMsg.id,
            actorPersonId: authorPersonId,
            actorName: authorDisplayName,
            actorEmail: user.email,
            title: String(title).trim(),
            rawHtml: cleanMsgContent,
            involvedPersonIds: involvedIds,
            defaultType: effectiveNotifyMode === 'none' ? 'mention' : 'message',
            allowActorInTargets: allowSelf,
          })
        })()

        const emailMsgPromise =
          args.skipEmailNotification || !dbMsg?.id
            ? Promise.resolve(null)
            : sendBasecampMessageNotificationEmail({
                event: 'published',
                messageDbId: dbMsg.id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                notifyMode: effectiveNotifyMode,
                selectedPersonIds: cleanSelectedPersonUuids,
                appOrigin: reqOrigin,
                skipInAppNotifications: true,
              })

        await Promise.all([mirrorMsgPromise, inAppMsgPromise, emailMsgPromise])

        return NextResponse.json({
          success: true,
          id: dbMsg?.id,
          bc_id: finalMsgBcId,
          title: String(title).trim(),
          content: cleanMsgContent,
          category: finalCategory,
          is_pinned: initialPinned,
        })
      }

      case 'update_message': {
        const messageDbId = args.messageDbId || args.messageId || args.id
        if (!messageDbId) throw new Error('Missing required parameter: messageDbId')

        const [{ data: existingMsg }, { data: allPeopleRows }] = await Promise.all([
          supabase
            .from('bc_messages')
            .select('id, bc_id, project_id, title, content, category, is_pinned, author_person_id')
            .eq('id', messageDbId)
            .eq('project_id', projectUuid)
            .maybeSingle(),
          supabase.from('bc_people').select('id, bc_id, name, email, is_active, attachable_sgid').limit(5000),
        ])

        if (!existingMsg) {
          return NextResponse.json({ error: 'Message not found in project' }, { status: 404 })
        }

        const finalTitle =
          args.title !== undefined
            ? String(args.title).trim() || existingMsg.title
            : args.subject !== undefined
            ? String(args.subject).trim() || existingMsg.title
            : existingMsg.title
        const finalContent =
          args.content !== undefined
            ? await uploadEmbeddedDataUrisToStorage(args.content, 'messages', supabase, requestMediaCache)
            : existingMsg.content || ''
        const finalCategory =
          args.category !== undefined ? String(args.category || '').trim() || 'General' : existingMsg.category || 'General'
        const finalPinned =
          args.is_pinned !== undefined ? Boolean(args.is_pinned) : Boolean(existingMsg.is_pinned)
        const nowIso = new Date().toISOString()

        const { error: updMsgErr } = await supabase
          .from('bc_messages')
          .update({
            title: finalTitle,
            content: finalContent,
            category: finalCategory,
            is_pinned: finalPinned,
            updated_at: nowIso,
          })
          .eq('id', existingMsg.id)

        if (updMsgErr) throw updMsgErr

        const allPeople = allPeopleRows || []
        const prevMentions = new Set(extractMentionedPersonIds(existingMsg.content || '', allPeople))
        const newlyMentionedIds = extractMentionedPersonIds(finalContent, allPeople).filter(
          (uid) => !prevMentions.has(uid)
        )

        const mirrorUpdMsgPromise = (async () => {
          if (args.skipRemoteMirror || !isRealBasecampId(existingMsg.bc_id) || !isRealBasecampId(bcProjectId)) return
          const authorObj = existingMsg.author_person_id
            ? allPeople.find((p: any) => p.id === existingMsg.author_person_id)
            : null
          const [bcReadyMsg, remoteCategoryId] = await Promise.all([
            prepareOutboundHtmlForBasecamp(finalContent, supabase, requestMediaCache),
            resolveRemoteMessageCategoryId(bcProjectId, finalCategory),
          ])
          const bcMsgWithAuthor = buildBasecampCommentWithAuthor(
            bcReadyMsg,
            authorObj?.name || authorDisplayName,
            authorObj?.email || user.email
          )
          await basecampBestEffort('update_message', () =>
            bcUpdateMessageRemote(bcProjectId, Number(existingMsg.bc_id), finalTitle, bcMsgWithAuthor, remoteCategoryId)
          )
        })()

        const inAppUpdMsgPromise =
          newlyMentionedIds.length > 0
            ? createBasecampInAppNotifications({
                projectUuid,
                recordingType: 'message',
                recordingUuid: existingMsg.id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                title: finalTitle,
                rawHtml: undefined,
                mentionedPersonIds: newlyMentionedIds,
                defaultType: 'mention',
              })
            : Promise.resolve(null)

        const emailUpdMsgPromise =
          !args.skipEmailNotification && newlyMentionedIds.length > 0
            ? sendBasecampMessageNotificationEmail({
                event: 'updated',
                messageDbId: existingMsg.id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                mentionedPersonIdsOverride: newlyMentionedIds,
                appOrigin: reqOrigin,
                skipInAppNotifications: true,
              })
            : Promise.resolve(null)

        await Promise.all([mirrorUpdMsgPromise, inAppUpdMsgPromise, emailUpdMsgPromise])

        return NextResponse.json({
          success: true,
          id: existingMsg.id,
          title: finalTitle,
          content: finalContent,
          category: finalCategory,
          is_pinned: finalPinned,
          updated_at: nowIso,
        })
      }

      case 'pin_message':
      case 'unpin_message': {
        const messageDbId = args.messageDbId || args.messageId || args.recordingDbId || args.id
        if (!messageDbId) throw new Error('Missing required parameter: messageDbId')

        const { data: existingMsg } = await supabase
          .from('bc_messages')
          .select('id, bc_id, project_id, is_pinned')
          .eq('id', messageDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        if (!existingMsg) {
          return NextResponse.json({ error: 'Message not found in project' }, { status: 404 })
        }

        const targetPinned = action === 'pin_message'
        const { error: pinErr } = await supabase
          .from('bc_messages')
          .update({ is_pinned: targetPinned })
          .eq('id', existingMsg.id)

        if (pinErr) throw pinErr

        if (!args.skipRemoteMirror && isRealBasecampId(existingMsg.bc_id) && isRealBasecampId(bcProjectId)) {
          await basecampBestEffort(action, () =>
            targetPinned
              ? bcPinRecordingRemote(bcProjectId, Number(existingMsg.bc_id))
              : bcUnpinRecordingRemote(bcProjectId, Number(existingMsg.bc_id))
          )
        }

        return NextResponse.json({
          success: true,
          id: existingMsg.id,
          bc_id: existingMsg.bc_id,
          is_pinned: targetPinned,
        })
      }

      case 'create_campfire_line': {
        requireArgs(['campfireDbId', 'content'])
        const { campfireDbId, content } = args
        const bcLineId = generateUniqueBcId()
        const cleanLineContent = await uploadEmbeddedDataUrisToStorage(content, 'campfire', supabase)

        const { data: dbLine, error: lineErr } = await supabase
          .from('bc_campfire_lines')
          .insert({
            bc_id: bcLineId,
            project_id: projectUuid,
            campfire_id: campfireDbId,
            content: cleanLineContent,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (lineErr) throw lineErr

        let finalLineBcId = bcLineId
        const { data: campfireRow } = await supabase
          .from('bc_campfires')
          .select('bc_id')
          .eq('id', campfireDbId)
          .maybeSingle()
        if (!args.skipRemoteMirror && isRealBasecampId(campfireRow?.bc_id)) {
          const bcReadyLine = await prepareOutboundHtmlForBasecamp(cleanLineContent, supabase)
          const bcLineContentWithAuthor = buildBasecampCommentWithAuthor(
            bcReadyLine,
            authorDisplayName,
            user.email
          )
          const bcResult = await basecampBestEffort('create_campfire_line', () =>
            bcCreateCampfireLine(bcProjectId, Number(campfireRow!.bc_id), bcLineContentWithAuthor)
          )

          if (bcResult && dbLine) {
            finalLineBcId = bcResult.id
            await supabase.from('bc_campfire_lines').delete().eq('bc_id', bcResult.id).neq('id', dbLine.id)
            await supabase
              .from('bc_campfire_lines')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbLine.id)
          }
        }

        return NextResponse.json({ success: true, id: dbLine?.id, bc_id: finalLineBcId })
      }

      case 'create_comment': {
        requireArgs(['parentType', 'parentDbId', 'content'])
        const { parentType, parentDbId, content } = args
        const bcCommentId = generateUniqueBcId()
        const cleanCommentContent = await uploadEmbeddedDataUrisToStorage(content, 'comments', supabase, requestMediaCache)
        const nowIso = new Date().toISOString()

        const { data: dbComment, error: comErr } = await supabase
          .from('bc_comments')
          .insert({
            bc_id: bcCommentId,
            project_id: projectUuid,
            parent_type: parentType,
            parent_id: parentDbId,
            content: cleanCommentContent,
            author_person_id: authorPersonId,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select('id')
          .single()

        if (comErr) throw comErr

        await syncParentCommentsCount(supabase, parentType, parentDbId)

        let finalCommentBcId = bcCommentId
        const parentTableMap: Record<string, string> = {
          message: 'bc_messages',
          todo: 'bc_todos',
          document: 'bc_documents',
        }
        const parentTable = parentTableMap[parentType]
        const { data: parentRow } = parentTable
          ? await supabase
              .from(parentTable)
              .select(
                parentType === 'todo'
                  ? 'id, bc_id, title, created_by_person_id'
                  : 'id, bc_id, title, author_person_id'
              )
              .eq('id', parentDbId)
              .maybeSingle()
          : { data: null as any }

        const mirrorCommentPromise = (async () => {
          if (args.skipRemoteMirror || !isRealBasecampId(parentRow?.bc_id) || !isRealBasecampId(bcProjectId)) return
          const bcReadyComment = await prepareOutboundHtmlForBasecamp(cleanCommentContent, supabase, requestMediaCache)
          const bcCommentWithAuthor = buildBasecampCommentWithAuthor(
            bcReadyComment,
            authorDisplayName,
            user.email
          )
          const bcResult = await basecampBestEffort('create_comment', () =>
            bcCreateComment(bcProjectId, Number(parentRow!.bc_id), bcCommentWithAuthor)
          )

          if (bcResult && dbComment) {
            finalCommentBcId = bcResult.id
            await supabase.from('bc_comments').delete().eq('bc_id', bcResult.id).neq('id', dbComment.id)
            await supabase
              .from('bc_comments')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbComment.id)
          }
        })()

        const inAppCommentPromise = (async () => {
          if (parentType !== 'todo' && parentType !== 'message' && parentType !== 'document') return
          const involvedIds: string[] = []
          if (parentType === 'todo') {
            if (parentRow?.created_by_person_id) involvedIds.push(parentRow.created_by_person_id)
            const { data: assRows } = await supabase
              .from('bc_todo_assignees')
              .select('person_id')
              .eq('todo_id', parentDbId)
            for (const r of assRows || []) {
              if (r.person_id) involvedIds.push(r.person_id)
            }
          } else if (parentRow?.author_person_id) {
            involvedIds.push(parentRow.author_person_id)
          }

          // For Announcements (parentType === 'message'), DO NOT include prior commenters so 20 store "Ok" replies
          // never spam each other; only notify the announcement author + anyone @mentioned in the comment!
          if (parentType !== 'message') {
            const { data: priorComments } = await supabase
              .from('bc_comments')
              .select('author_person_id')
              .eq('parent_type', parentType)
              .eq('parent_id', parentDbId)
            for (const pc of priorComments || []) {
              if (pc.author_person_id) involvedIds.push(pc.author_person_id)
            }
          }

          await createBasecampInAppNotifications({
            projectUuid,
            recordingType: parentType as 'todo' | 'message' | 'document',
            recordingUuid: parentDbId,
            actorPersonId: authorPersonId,
            actorName: authorDisplayName,
            actorEmail: user.email,
            title: parentRow?.title || 'Nuevo comentario',
            rawHtml: cleanCommentContent,
            involvedPersonIds: involvedIds,
            defaultType: 'comment',
          })
        })()

        const emailCommentPromise = args.skipEmailNotification
          ? Promise.resolve(null)
          : parentType === 'todo'
          ? sendBasecampTodoNotificationEmail({
              event: 'commented',
              todoDbId: parentDbId,
              actorPersonId: authorPersonId,
              actorName: authorDisplayName,
              actorEmail: user.email,
              commentHtml: cleanCommentContent,
              appOrigin: reqOrigin,
            })
          : parentType === 'message'
          ? sendBasecampMessageNotificationEmail({
              event: 'commented',
              messageDbId: parentDbId,
              actorPersonId: authorPersonId,
              actorName: authorDisplayName,
              actorEmail: user.email,
              commentHtml: cleanCommentContent,
              appOrigin: reqOrigin,
              skipInAppNotifications: true,
            })
          : Promise.resolve(null)

        await Promise.all([mirrorCommentPromise, inAppCommentPromise, emailCommentPromise])

        return NextResponse.json({
          success: true,
          id: dbComment?.id,
          bc_id: finalCommentBcId,
          updated_at: nowIso,
        })
      }

      case 'update_comment': {
        const commentDbId = args.commentDbId || args.commentId || args.id
        if (!commentDbId || args.content === undefined) {
          throw new Error('Missing required parameters: commentDbId and content')
        }

        const [{ data: existingComment }, { data: allPeopleRows }] = await Promise.all([
          supabase
            .from('bc_comments')
            .select('id, bc_id, project_id, parent_type, parent_id, content, author_person_id')
            .eq('id', commentDbId)
            .eq('project_id', projectUuid)
            .maybeSingle(),
          supabase.from('bc_people').select('id, bc_id, name, email, is_active, attachable_sgid').limit(5000),
        ])

        if (!existingComment) {
          return NextResponse.json({ error: 'Comment not found in project' }, { status: 404 })
        }

        const cleanCommentContent = await uploadEmbeddedDataUrisToStorage(args.content, 'comments', supabase, requestMediaCache)
        const nowIso = new Date().toISOString()

        const { error: updComErr } = await supabase
          .from('bc_comments')
          .update({
            content: cleanCommentContent,
            updated_at: nowIso,
          })
          .eq('id', existingComment.id)

        if (updComErr) throw updComErr

        const allPeople = allPeopleRows || []
        const prevMentions = new Set(extractMentionedPersonIds(existingComment.content || '', allPeople))
        const newlyMentionedIds = extractMentionedPersonIds(cleanCommentContent, allPeople).filter(
          (uid) => !prevMentions.has(uid)
        )

        const mirrorUpdComPromise = (async () => {
          if (args.skipRemoteMirror || !isRealBasecampId(existingComment.bc_id) || !isRealBasecampId(bcProjectId)) return
          const authorObj = existingComment.author_person_id
            ? allPeople.find((p: any) => p.id === existingComment.author_person_id)
            : null
          const bcReadyComment = await prepareOutboundHtmlForBasecamp(cleanCommentContent, supabase, requestMediaCache)
          const bcCommentWithAuthor = buildBasecampCommentWithAuthor(
            bcReadyComment,
            authorObj?.name || authorDisplayName,
            authorObj?.email || user.email
          )
          await basecampBestEffort('update_comment', () =>
            bcUpdateCommentRemote(bcProjectId, Number(existingComment.bc_id), bcCommentWithAuthor)
          )
        })()

        const inAppUpdComPromise = (async () => {
          if (newlyMentionedIds.length === 0) return
          const pType = existingComment.parent_type
          if (pType !== 'todo' && pType !== 'message' && pType !== 'document') return
          const pTable = pType === 'todo' ? 'bc_todos' : pType === 'message' ? 'bc_messages' : 'bc_documents'
          const { data: parentRow } = await supabase
            .from(pTable)
            .select('title')
            .eq('id', existingComment.parent_id)
            .maybeSingle()

          await createBasecampInAppNotifications({
            projectUuid,
            recordingType: pType,
            recordingUuid: existingComment.parent_id,
            actorPersonId: authorPersonId,
            actorName: authorDisplayName,
            actorEmail: user.email,
            title: parentRow?.title || 'Mención en comentario',
            rawHtml: undefined,
            mentionedPersonIds: newlyMentionedIds,
            defaultType: 'mention',
          })
        })()

        const emailUpdComPromise =
          args.skipEmailNotification || newlyMentionedIds.length === 0
            ? Promise.resolve(null)
            : existingComment.parent_type === 'todo'
            ? sendBasecampTodoNotificationEmail({
                event: 'commented',
                todoDbId: existingComment.parent_id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                commentHtml: cleanCommentContent,
                appOrigin: reqOrigin,
              })
            : existingComment.parent_type === 'message'
            ? sendBasecampMessageNotificationEmail({
                event: 'commented',
                messageDbId: existingComment.parent_id,
                actorPersonId: authorPersonId,
                actorName: authorDisplayName,
                actorEmail: user.email,
                commentHtml: cleanCommentContent,
                mentionedPersonIdsOverride: newlyMentionedIds,
                onlyMentionedOnComment: true,
                appOrigin: reqOrigin,
                skipInAppNotifications: true,
              })
            : Promise.resolve(null)

        await Promise.all([mirrorUpdComPromise, inAppUpdComPromise, emailUpdComPromise])

        return NextResponse.json({
          success: true,
          id: existingComment.id,
          content: cleanCommentContent,
          updated_at: nowIso,
        })
      }

      case 'create_boost': {
        const recordingType = String(args.recordingType || args.recording_type || '').trim().toLowerCase()
        const recordingDbId = args.recordingDbId || args.recordingId || args.recording_id
        const boostContent = String(args.content || '👍').trim().slice(0, 16)

        if (!recordingType || !recordingDbId || !boostContent) {
          return NextResponse.json(
            { error: 'Missing recordingType, recordingDbId, or content' },
            { status: 400 }
          )
        }

        const tableByType: Record<string, string> = {
          todo: 'bc_todos',
          comment: 'bc_comments',
          message: 'bc_messages',
          document: 'bc_documents',
        }
        const targetTable = tableByType[recordingType]
        if (!targetTable) {
          return NextResponse.json({ error: `Invalid recordingType: ${recordingType}` }, { status: 400 })
        }

        const { data: targetRec } = await supabase
          .from(targetTable)
          .select('id, bc_id, project_id')
          .eq('id', recordingDbId)
          .maybeSingle()

        if (!targetRec) {
          return NextResponse.json({ error: 'Target recording not found' }, { status: 404 })
        }

        let finalBoostBcId = generateUniqueBcId()
        const nowIso = new Date().toISOString()

        const { data: dbBoost, error: boostErr } = await supabase
          .from('bc_boosts')
          .insert({
            bc_id: finalBoostBcId,
            project_id: targetRec.project_id || projectUuid,
            recording_type: recordingType,
            recording_id: targetRec.id,
            booster_person_id: authorPersonId,
            content: boostContent,
            created_at: nowIso,
          })
          .select('id, bc_id, recording_type, recording_id, booster_person_id, content, created_at, booster:bc_people(id, name, avatar_url)')
          .single()

        if (boostErr) throw boostErr

        const exactBoostCount = await syncRecordingBoostsCount(supabase, recordingType, targetRec.id)

        if (!args.skipRemoteMirror && isRealBasecampId(targetRec.bc_id) && isRealBasecampId(bcProjectId)) {
          const bcBoost = await basecampBestEffort('create_boost', () =>
            bcCreateBoostRemote(bcProjectId, Number(targetRec.bc_id), boostContent)
          )
          if (bcBoost?.id && dbBoost?.id) {
            finalBoostBcId = bcBoost.id
            await supabase.from('bc_boosts').delete().eq('bc_id', bcBoost.id).neq('id', dbBoost.id)
            await supabase.from('bc_boosts').update({ bc_id: bcBoost.id }).eq('id', dbBoost.id)
          }
        }

        const boosterRel: any = Array.isArray((dbBoost as any)?.booster)
          ? (dbBoost as any).booster[0]
          : (dbBoost as any)?.booster

        return NextResponse.json({
          success: true,
          id: dbBoost?.id,
          bc_id: finalBoostBcId,
          boosts_count: exactBoostCount,
          boost: {
            id: dbBoost?.id,
            bc_id: finalBoostBcId,
            recording_type: recordingType,
            recording_id: targetRec.id,
            booster_person_id: authorPersonId,
            booster_name: boosterRel?.name || authorDisplayName,
            booster_avatar_url: boosterRel?.avatar_url || '',
            content: boostContent,
            created_at: dbBoost?.created_at || nowIso,
          },
        })
      }

      case 'delete_boost': {
        const boostDbId = args.boostDbId || args.boostId || args.id
        if (!boostDbId) {
          return NextResponse.json({ error: 'Missing boostDbId' }, { status: 400 })
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(boostDbId))
        const { data: existingBoost } = isUuid
          ? await supabase
              .from('bc_boosts')
              .select('id, bc_id, project_id, recording_type, recording_id')
              .eq('id', String(boostDbId))
              .maybeSingle()
          : await supabase
              .from('bc_boosts')
              .select('id, bc_id, project_id, recording_type, recording_id')
              .eq('bc_id', Number(boostDbId))
              .maybeSingle()

        if (!existingBoost) {
          return NextResponse.json({ error: 'Boost not found' }, { status: 404 })
        }

        const { error: delBoostErr } = await supabase.from('bc_boosts').delete().eq('id', existingBoost.id)
        if (delBoostErr) throw delBoostErr

        const exactBoostCount = await syncRecordingBoostsCount(
          supabase,
          existingBoost.recording_type,
          existingBoost.recording_id
        )

        if (!args.skipRemoteMirror && isRealBasecampId(existingBoost.bc_id) && isRealBasecampId(bcProjectId)) {
          await basecampBestEffort('delete_boost', () =>
            bcDeleteBoostRemote(bcProjectId, Number(existingBoost.bc_id))
          )
        }

        return NextResponse.json({
          success: true,
          boosts_count: exactBoostCount,
        })
      }

      case 'create_answer': {
        requireArgs(['questionDbId', 'content'])
        const { questionDbId, content } = args
        const bcAnswerId = generateUniqueBcId()
        const cleanAnswerContent = await uploadEmbeddedDataUrisToStorage(content, 'answers', supabase)

        const { data: dbAnswer, error: ansErr } = await supabase
          .from('bc_answers')
          .insert({
            bc_id: bcAnswerId,
            project_id: projectUuid,
            question_id: questionDbId,
            content: cleanAnswerContent,
            author_person_id: authorPersonId,
          })
          .select('id')
          .single()

        if (ansErr) throw ansErr

        let finalAnswerBcId = bcAnswerId
        const { data: questionRow } = await supabase
          .from('bc_questions')
          .select('bc_id')
          .eq('id', questionDbId)
          .maybeSingle()
        if (!args.skipRemoteMirror && isRealBasecampId(questionRow?.bc_id)) {
          const bcReadyAns = await prepareOutboundHtmlForBasecamp(cleanAnswerContent, supabase)
          const bcAnswerWithAuthor = buildBasecampCommentWithAuthor(bcReadyAns, authorDisplayName, user.email)
          const bcResult = await basecampBestEffort('create_answer', () =>
            bcCreateAnswer(bcProjectId, Number(questionRow!.bc_id), bcAnswerWithAuthor)
          )

          if (bcResult && dbAnswer) {
            finalAnswerBcId = bcResult.id
            await supabase.from('bc_answers').delete().eq('bc_id', bcResult.id).neq('id', dbAnswer.id)
            await supabase
              .from('bc_answers')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbAnswer.id)
          }
        }

        return NextResponse.json({ success: true, id: dbAnswer?.id, bc_id: finalAnswerBcId })
      }

      case 'create_schedule_entry': {
        requireArgs(['scheduleDbId', 'title', 'starts_at', 'ends_at'])
        const { scheduleDbId, title, description, starts_at, ends_at, all_day } = args
        const bcEventId = generateUniqueBcId()
        const cleanEventDesc = await uploadEmbeddedDataUrisToStorage(description, 'schedules', supabase)

        const { data: dbEvent, error: evtErr } = await supabase
          .from('bc_schedule_entries')
          .insert({
            bc_id: bcEventId,
            project_id: projectUuid,
            schedule_id: scheduleDbId,
            title,
            description: cleanEventDesc,
            starts_at,
            ends_at,
            all_day: all_day || false,
            author_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (evtErr) throw evtErr

        let finalEventBcId = bcEventId
        const { data: scheduleRow } = await supabase
          .from('bc_schedules')
          .select('bc_id')
          .eq('id', scheduleDbId)
          .maybeSingle()
        if (!args.skipRemoteMirror && isRealBasecampId(scheduleRow?.bc_id)) {
          const bcReadyDesc = await prepareOutboundHtmlForBasecamp(cleanEventDesc, supabase)
          const bcDescWithAuthor = buildBasecampDescriptionWithAuthor(bcReadyDesc, authorDisplayName, user.email)
          const bcResult = await basecampBestEffort('create_schedule_entry', () =>
            bcCreateScheduleEntry(bcProjectId, Number(scheduleRow!.bc_id), {
              summary: title,
              description: bcDescWithAuthor || undefined,
              starts_at,
              ends_at,
              all_day: all_day || false,
            })
          )

          if (bcResult && dbEvent) {
            finalEventBcId = bcResult.id
            await supabase.from('bc_schedule_entries').delete().eq('bc_id', bcResult.id).neq('id', dbEvent.id)
            await supabase
              .from('bc_schedule_entries')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbEvent.id)
          }
        }

        return NextResponse.json({ success: true, id: dbEvent?.id, bc_id: finalEventBcId })
      }

      case 'create_vault': {
        requireArgs(['name'])
        const { parentVaultDbId, name } = args
        const bcVaultId = generateUniqueBcId()

        const { data: dbVault, error: vaultErr } = await supabase
          .from('bc_vaults')
          .insert({
            bc_id: bcVaultId,
            project_id: projectUuid,
            name,
            parent_vault_id: parentVaultDbId || null,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (vaultErr) throw vaultErr

        return NextResponse.json({ success: true, id: dbVault?.id, bc_id: bcVaultId })
      }

      case 'create_document': {
        requireArgs(['vaultDbId', 'title'])
        const { vaultDbId, title, content } = args
        const bcDocId = generateUniqueBcId()
        const cleanDocContent = await uploadEmbeddedDataUrisToStorage(content, 'documents', supabase)

        const { data: dbDoc, error: docErr } = await supabase
          .from('bc_documents')
          .insert({
            bc_id: bcDocId,
            project_id: projectUuid,
            vault_id: vaultDbId,
            title,
            content: cleanDocContent,
            author_person_id: authorPersonId,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (docErr) throw docErr

        let finalDocBcId = bcDocId
        const { data: vaultRow } = await supabase
          .from('bc_vaults')
          .select('bc_id')
          .eq('id', vaultDbId)
          .maybeSingle()
        if (!args.skipRemoteMirror && isRealBasecampId(vaultRow?.bc_id)) {
          const bcReadyDoc = await prepareOutboundHtmlForBasecamp(cleanDocContent, supabase)
          const bcDocContentWithAuthor = buildBasecampDescriptionWithAuthor(bcReadyDoc, authorDisplayName, user.email)
          const bcResult = await basecampBestEffort('create_document', () =>
            bcCreateDocument(bcProjectId, Number(vaultRow!.bc_id), { title, content: bcDocContentWithAuthor })
          )

          if (bcResult && dbDoc) {
            finalDocBcId = bcResult.id
            await supabase.from('bc_documents').delete().eq('bc_id', bcResult.id).neq('id', dbDoc.id)
            await supabase
              .from('bc_documents')
              .update({ bc_id: bcResult.id, author_person_id: authorPersonId })
              .eq('id', dbDoc.id)
          }
        }

        return NextResponse.json({ success: true, id: dbDoc?.id, bc_id: finalDocBcId })
      }

      case 'create_upload': {
        requireArgs(['filename', 'download_url'])
        const { vaultDbId, filename, content_type, byte_size, download_url } = args
        const trimmedFilename = String(filename).trim()
        const trimmedDownloadUrl = String(download_url).trim()
        if (!trimmedFilename || !trimmedDownloadUrl) {
          return NextResponse.json({ error: 'Missing filename or download_url' }, { status: 400 })
        }

        let targetVaultDbId: string | null = vaultDbId || null
        if (!targetVaultDbId) {
          const { data: existingVault } = await supabase
            .from('bc_vaults')
            .select('id')
            .eq('project_id', projectUuid)
            .is('parent_vault_id', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          if (existingVault?.id) {
            targetVaultDbId = existingVault.id
          } else {
            const { data: createdVault, error: createdVaultErr } = await supabase
              .from('bc_vaults')
              .insert({
                bc_id: generateUniqueBcId(),
                project_id: projectUuid,
                name: 'Docs & Files',
                parent_vault_id: null,
                created_at: new Date().toISOString(),
              })
              .select('id')
              .single()
            if (createdVaultErr) throw createdVaultErr
            targetVaultDbId = createdVault.id
          }
        }

        const bcUploadId = generateUniqueBcId()
        const { data: dbUpload, error: upErr } = await supabase
          .from('bc_uploads')
          .insert({
            bc_id: bcUploadId,
            project_id: projectUuid,
            vault_id: targetVaultDbId,
            filename: trimmedFilename,
            content_type: content_type || 'application/octet-stream',
            byte_size: Math.max(0, Number(byte_size) || 0),
            download_url: trimmedDownloadUrl,
            author_person_id: authorPersonId,
            created_at: new Date().toISOString(),
          })
          .select(
            `
            id, bc_id, filename, content_type, byte_size, download_url, vault_id, author_person_id, created_at,
            author:bc_people(name)
          `
          )
          .single()

        if (upErr) throw upErr

        return NextResponse.json({
          success: true,
          id: dbUpload?.id,
          bc_id: bcUploadId,
          vault_id: targetVaultDbId,
          author_person_id: authorPersonId,
          upload: dbUpload,
        })
      }

      case 'delete_recording': {
        const recordingDbId = args.recordingDbId || args.id
        const { tableName } = args
        if (!recordingDbId || !tableName) {
          return NextResponse.json({ error: 'Missing recordingDbId or tableName' }, { status: 400 })
        }

        const allowedTables = [
          'bc_todos',
          'bc_messages',
          'bc_comments',
          'bc_documents',
          'bc_schedule_entries',
          'bc_vaults',
          'bc_uploads',
          'bc_todolists',
          'bc_todolist_groups',
        ]
        if (!allowedTables.includes(tableName)) {
          return NextResponse.json({ error: 'Invalid tableName' }, { status: 400 })
        }

        // Read bc_id + project_id BEFORE deleting so we can trash the real recording in Basecamp 3 (ZOMBIE FIX!)
        const { data: targetRow } = await supabase
          .from(tableName)
          .select('id, bc_id, project_id')
          .eq('id', recordingDbId)
          .eq('project_id', projectUuid)
          .maybeSingle()

        const targetBcId = Number(targetRow?.bc_id || args.recordingId || 0)

        let commentParentToSync: { parent_type?: string | null; parent_id?: string | null } | null = null
        let todolistDbIdToSync: string | null = null
        let groupDbIdToSync: string | null = null

        if (tableName === 'bc_comments') {
          const { data: commentRow } = await supabase
            .from('bc_comments')
            .select('parent_type, parent_id')
            .eq('id', recordingDbId)
            .eq('project_id', projectUuid)
            .maybeSingle()
          commentParentToSync = commentRow || null
          await supabase
            .from('bc_boosts')
            .delete()
            .eq('recording_type', 'comment')
            .eq('recording_id', recordingDbId)
        } else if (tableName === 'bc_todos') {
          const { data: todoRow } = await supabase
            .from('bc_todos')
            .select('id, todolist_id, group_id')
            .eq('id', recordingDbId)
            .eq('project_id', projectUuid)
            .maybeSingle()
          if (todoRow) {
            todolistDbIdToSync = todoRow.todolist_id || null
            groupDbIdToSync = todoRow.group_id || null
            await Promise.all([
              supabase.from('bc_todo_assignees').delete().eq('todo_id', recordingDbId),
              supabase
                .from('bc_comments')
                .delete()
                .eq('project_id', projectUuid)
                .eq('parent_type', 'todo')
                .eq('parent_id', recordingDbId),
              supabase
                .from('bc_boosts')
                .delete()
                .eq('recording_type', 'todo')
                .eq('recording_id', recordingDbId),
              supabase
                .from('bc_notifications')
                .delete()
                .eq('recording_type', 'todo')
                .eq('recording_id', recordingDbId),
            ])
          }
        } else if (tableName === 'bc_messages') {
          await Promise.all([
            supabase
              .from('bc_comments')
              .delete()
              .eq('project_id', projectUuid)
              .eq('parent_type', 'message')
              .eq('parent_id', recordingDbId),
            supabase
              .from('bc_boosts')
              .delete()
              .eq('recording_type', 'message')
              .eq('recording_id', recordingDbId),
            supabase
              .from('bc_notifications')
              .delete()
              .eq('recording_type', 'message')
              .eq('recording_id', recordingDbId),
          ])
        } else if (tableName === 'bc_documents') {
          await Promise.all([
            supabase
              .from('bc_comments')
              .delete()
              .eq('project_id', projectUuid)
              .eq('parent_type', 'document')
              .eq('parent_id', recordingDbId),
            supabase
              .from('bc_boosts')
              .delete()
              .eq('recording_type', 'document')
              .eq('recording_id', recordingDbId),
          ])
        } else if (tableName === 'bc_todolists') {
          const { data: listTodos } = await supabase
            .from('bc_todos')
            .select('id')
            .eq('project_id', projectUuid)
            .eq('todolist_id', recordingDbId)
          const listTodoIds = (listTodos || []).map((t: any) => t.id)
          if (listTodoIds.length > 0) {
            await Promise.all([
              supabase.from('bc_todo_assignees').delete().in('todo_id', listTodoIds),
              supabase
                .from('bc_comments')
                .delete()
                .eq('project_id', projectUuid)
                .eq('parent_type', 'todo')
                .in('parent_id', listTodoIds),
              supabase.from('bc_boosts').delete().eq('recording_type', 'todo').in('recording_id', listTodoIds),
              supabase.from('bc_todos').delete().in('id', listTodoIds),
            ])
          }
          await supabase.from('bc_todolist_groups').delete().eq('todolist_id', recordingDbId)
        } else if (tableName === 'bc_todolist_groups') {
          await supabase
            .from('bc_todos')
            .update({ group_id: null })
            .eq('project_id', projectUuid)
            .eq('group_id', recordingDbId)
        } else if (tableName === 'bc_uploads') {
          const { data: uploadRow } = await supabase
            .from('bc_uploads')
            .select('download_url')
            .eq('id', recordingDbId)
            .eq('project_id', projectUuid)
            .maybeSingle()
          const storagePath = extractBasecampUploadStoragePath(uploadRow?.download_url)
          if (storagePath) {
            const { error: storageDelErr } = await supabase.storage.from('checklist-photos').remove([storagePath])
            if (storageDelErr) {
              console.warn(`⚠️ [Basecamp Action] Non-fatal Storage delete warning (${storagePath}):`, storageDelErr.message)
            }
          }
        } else if (tableName === 'bc_vaults') {
          const { data: projectVaults } = await supabase
            .from('bc_vaults')
            .select('id, parent_vault_id')
            .eq('project_id', projectUuid)

          const childrenByParent = new Map<string, string[]>()
          for (const v of projectVaults || []) {
            if (v.parent_vault_id) {
              const arr = childrenByParent.get(v.parent_vault_id) || []
              arr.push(v.id)
              childrenByParent.set(v.parent_vault_id, arr)
            }
          }

          const subtreeVaultIds: string[] = []
          const collectBottomUp = (vid: string) => {
            const kids = childrenByParent.get(vid) || []
            for (const kid of kids) collectBottomUp(kid)
            subtreeVaultIds.push(vid)
          }
          if ((projectVaults || []).some((v: any) => v.id === recordingDbId)) {
            collectBottomUp(recordingDbId)
          }

          if (subtreeVaultIds.length > 0) {
            const [{ data: childDocs }, { data: childUploads }] = await Promise.all([
              supabase.from('bc_documents').select('id').eq('project_id', projectUuid).in('vault_id', subtreeVaultIds),
              supabase
                .from('bc_uploads')
                .select('id, download_url')
                .eq('project_id', projectUuid)
                .in('vault_id', subtreeVaultIds),
            ])

            const docIds = (childDocs || []).map((d: any) => d.id)
            if (docIds.length > 0) {
              await supabase
                .from('bc_comments')
                .delete()
                .eq('project_id', projectUuid)
                .eq('parent_type', 'document')
                .in('parent_id', docIds)
              await supabase.from('bc_documents').delete().eq('project_id', projectUuid).in('id', docIds)
            }

            const uploadIds = (childUploads || []).map((u: any) => u.id)
            const storagePaths = (childUploads || [])
              .map((u: any) => extractBasecampUploadStoragePath(u.download_url))
              .filter((p: string | null): p is string => Boolean(p))
            if (storagePaths.length > 0) {
              await supabase.storage.from('checklist-photos').remove(storagePaths)
            }
            if (uploadIds.length > 0) {
              await supabase.from('bc_uploads').delete().eq('project_id', projectUuid).in('id', uploadIds)
            }

            for (const subId of subtreeVaultIds) {
              if (subId !== recordingDbId) {
                await supabase.from('bc_vaults').delete().eq('project_id', projectUuid).eq('id', subId)
              }
            }
          }
        }

        // Mirror trash status to Basecamp 3 BEFORE/ALONGSIDE local delete so it NEVER revives on next sync!
        if (!args.skipRemoteMirror && isRealBasecampId(targetBcId) && isRealBasecampId(bcProjectId)) {
          await basecampBestEffort(`trash_recording:${tableName}`, () =>
            bcTrashRecording(bcProjectId, targetBcId)
          )
        }

        // LOCAL delete — scoped to projectUuid for safety
        const { error: delErr } = await supabase
          .from(tableName)
          .delete()
          .eq('id', recordingDbId)
          .eq('project_id', projectUuid)

        if (delErr) throw delErr

        if (commentParentToSync?.parent_id) {
          await syncParentCommentsCount(supabase, commentParentToSync.parent_type, commentParentToSync.parent_id)
        }
        if (todolistDbIdToSync) {
          await syncTodolistCounts(supabase, todolistDbIdToSync)
        }
        if (groupDbIdToSync) {
          await syncTodolistGroupCounts(supabase, groupDbIdToSync)
        }

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error(`❌ [Basecamp Action Error] ${action}:`, error.message)
    return NextResponse.json(
      { error: `Failed to execute action ${action}: ${error.message}` },
      { status: 500 }
    )
  }
}
