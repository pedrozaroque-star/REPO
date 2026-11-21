/**
 * @module api/basecamp/sync
 * @description Ruta POST que ejecuta una sincronización INCREMENTAL de datos desde la API de Basecamp 3
 *              hacia las tablas locales bc_* de Supabase. Solo procesa proyectos que han cambiado
 *              desde la última sincronización exitosa, reduciendo el tiempo de ~2 min a ~10-15s.
 *
 * @businessRules
 * - **Sync Incremental**: Compara `updated_at` de cada proyecto (API vs DB). Si no cambió, lo salta.
 * - **Mutex/Lock**: No permite syncs concurrentes. Si hay uno corriendo (< 15 min), retorna 409.
 * - **Cleanup automático**: Syncs atascados (> 15 min en "running") se marcan como "timeout".
 * - **Orden de Sincronización**: People → Projects → Per-project resources (solo los cambiados).
 * - **Upsert por bc_id**: Todos los registros usan `bc_id` como clave de conflicto (idempotente).
 * - **Tolerancia a Fallos**: Si un recurso falla, se continúa con el siguiente.
 * - **Full Sync forzado**: Pasar `{"full": true}` en el body para forzar sync completo.
 * - **Descarga de Medios Asíncrona (Asynchronous Media Download)**: Las imágenes, videos y otros archivos
 *   adjuntos pesados se descargan en segundo plano de manera no bloqueante. Se prioriza de más reciente
 *   a más antiguo (`created_at DESC`).
 *
 * @dataFlow
 * - POST /api/basecamp/sync → cleanup stuck → mutex check → incremental filter → upsert
 *
 * @notes
 * - Per-project resources usan delta comparison por recurso (reordenar/completar todos en Basecamp no siempre mueve project.updated_at).
 * - Los dock IDs se extraen dinámicamente del proyecto.
 * - El sync principal no bloquea en descargas de medios. Si no están en caché (`bc_attachment_cache`),
 *   se deja la URL original de Basecamp temporalmente y se procesan en segundo plano por el worker.
 * - 2026-11-19 (Paquete 2A): Cuando es disparado por cron interno (`x-internal-cron: 1` o Vercel Cron), omite ventana nocturna `10:00 PM–6:59 AM LA` (`?force=1` override; usuarios manuales siempre corren); omite upserts no-op en `bc_people`, `bc_projects` y `bc_attachment_cache`; y acota `triggerBackgroundAttachmentDownloader` dentro de `after()` (Next 16) únicamente cuando hay proyectos/contenido cambiados o máximo 1×/hora.
 */

import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  fetchProjects,
  fetchPeople,
  fetchProjectPeople,
  fetchTodoLists,
  fetchAllTodos,
  fetchMessages,
  fetchCampfireLines,
  fetchDocuments,
  fetchUploads,
  fetchSubVaults,
  fetchScheduleEntries,
  fetchQuestions,
  fetchAnswers,
  fetchComments,
  findDock,
  extractDockId,
  getValidToken,
  ensureProjectWebhook,
  isSupabaseStorageUrl,
  isExternalBasecampUrl,
  extractDeterministicBlobKey,
  healPartiallyMigratedBcAttachmentHrefs,
  parseHtmlAttachments,
  assertSafeBasecampApiUrl,
  resolveHtmlAttachmentsFromCache,
  syncTodolistCounts,
  formatQuestionScheduleText,
  type BasecampProject,
} from '@/lib/basecamp-api'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  stripTegAuthorBanner,
  findPersonInListByFuzzyName,
  isMaskedOrEmptyEmail,
  isRealBasecampId,
  SYNTHETIC_BC_ID_THRESHOLD,
} from '@/lib/basecamp-person-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutos máximo para Vercel

const BG_DOWNLOADER_COOLDOWN_MS = 60 * 60 * 1000 // Máximo 1 barrido periódico/hora en ticks sin cambios
let lastBgDownloaderRunAt = 0

function getLATimeParts(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const rawHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
  const hour = rawHour === 24 ? 0 : rawHour
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
  return { hour, minute }
}

interface SyncCounters {
  people: number
  projects: number
  memberships: number
  todosets: number
  todolists: number
  todos: number
  todo_assignees: number
  message_boards: number
  messages: number
  comments: number
  campfires: number
  campfire_lines: number
  vaults: number
  documents: number
  uploads: number
  schedules: number
  schedule_entries: number
  questionnaires: number
  questions: number
  answers: number
  errors: string[]
}

function createCounters(): SyncCounters {
  return {
    people: 0,
    projects: 0,
    memberships: 0,
    todosets: 0,
    todolists: 0,
    todos: 0,
    todo_assignees: 0,
    message_boards: 0,
    messages: 0,
    comments: 0,
    campfires: 0,
    campfire_lines: 0,
    vaults: 0,
    documents: 0,
    uploads: 0,
    schedules: 0,
    schedule_entries: 0,
    questionnaires: 0,
    questions: 0,
    answers: 0,
    errors: [],
  }
}

function getSyncClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}

// ============================================================================
// HELPER FUNCTIONS FOR FILE SYNCING & HTML PROCESSING
// ============================================================================

async function downloadAndUploadAttachment(
  token: string,
  basecampUrl: string,
  filename: string,
  contentType: string,
  targetFolder: string,
  id: number | string,
  supabase: any,
  secondaryBasecampUrl?: string
): Promise<string | null> {
  try {
    // Guard: Never download or re-upload a URL that is already in Supabase Storage
    if (isSupabaseStorageUrl(basecampUrl)) {
      return basecampUrl
    }

    // 1. Check database cache first to avoid duplicate downloads/uploads
    const urlsToLookup = [basecampUrl]
    if (
      secondaryBasecampUrl &&
      isExternalBasecampUrl(secondaryBasecampUrl) &&
      secondaryBasecampUrl !== basecampUrl
    ) {
      urlsToLookup.push(secondaryBasecampUrl)
    }

    const { data: cachedRows } = await supabase
      .from('bc_attachment_cache')
      .select('basecamp_url, supabase_url')
      .in('basecamp_url', urlsToLookup)

    const validCached = (cachedRows || []).find(
      (r: any) => r?.supabase_url && isSupabaseStorageUrl(r.supabase_url)
    )
    if (validCached?.supabase_url) {
      console.log(`      ⚡ Attachment cache hit: ${filename}`)
      if (secondaryBasecampUrl && isExternalBasecampUrl(secondaryBasecampUrl)) {
        const hasSecondaryCached = (cachedRows || []).some(
          (r: any) => r.basecamp_url === secondaryBasecampUrl
        )
        if (!hasSecondaryCached) {
          await supabase
            .from('bc_attachment_cache')
            .upsert(
              { basecamp_url: secondaryBasecampUrl, supabase_url: validCached.supabase_url },
              { onConflict: 'basecamp_url' }
            )
        }
      }
      return validCached.supabase_url
    }

    const parsedAttachmentUrl = new URL(basecampUrl)
    if (
      parsedAttachmentUrl.hostname.toLowerCase() === 'preview.app.basecamp.com' ||
      parsedAttachmentUrl.hostname.toLowerCase() === 'storage.app.basecamp.com'
    ) {
      parsedAttachmentUrl.hostname = '3.basecampapi.com'
    }
    const targetUrl = assertSafeBasecampApiUrl(parsedAttachmentUrl.toString())

    const res = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (noreply@tacosgavilan.com)',
      },
      redirect: 'manual',
    })

    const downloadUrl = res.headers.get('location')
    let fileBuffer: Buffer
    let finalContentType = contentType || 'application/octet-stream'

    if (downloadUrl) {
      const s3Res = await fetch(downloadUrl)
      if (!s3Res.ok) throw new Error(`Failed to download from S3: ${s3Res.status}`)
      fileBuffer = Buffer.from(await s3Res.arrayBuffer())
      finalContentType = s3Res.headers.get('Content-Type') || finalContentType
    } else if (res.ok) {
      fileBuffer = Buffer.from(await res.arrayBuffer())
      finalContentType = res.headers.get('Content-Type') || finalContentType
    } else {
      throw new Error(`Failed to fetch from Basecamp API: ${res.status}`)
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    const blobKey = extractDeterministicBlobKey(basecampUrl)
    const filePath = `basecamp-attachments/${targetFolder}/${id}/${blobKey}-${safeFilename}`

    const { error: uploadErr } = await supabase.storage
      .from('checklist-photos')
      .upload(filePath, fileBuffer, {
        contentType: finalContentType,
        cacheControl: '3600',
        upsert: true,
      })

    if (uploadErr) throw uploadErr

    const { data: publicUrlData } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
    const publicUrl = publicUrlData?.publicUrl || null

    if (publicUrl) {
      // 2. Save mapping to database cache for future runs (both primary url and secondary href if present)
      const cacheEntries = [{ basecamp_url: basecampUrl, supabase_url: publicUrl }]
      if (
        secondaryBasecampUrl &&
        isExternalBasecampUrl(secondaryBasecampUrl) &&
        secondaryBasecampUrl !== basecampUrl
      ) {
        cacheEntries.push({ basecamp_url: secondaryBasecampUrl, supabase_url: publicUrl })
      }
      await supabase
        .from('bc_attachment_cache')
        .upsert(cacheEntries, { onConflict: 'basecamp_url' })
    }

    return publicUrl
  } catch (err: any) {
    console.error(`  ⚠️ Failed to migrate attachment: ${filename}. Error: ${err.message}`)
    return null
  }
}

async function processHtmlContent(
  html: string,
  _token: string,
  _targetFolder: string,
  _parentId: number | string,
  supabase: any,
  urlCache: Map<string, string>
): Promise<string> {
  return resolveHtmlAttachmentsFromCache(html, supabase, urlCache)
}

interface SyncPersonMeta {
  id: string
  bc_id?: number | string | null
  name?: string | null
  email?: string | null
}

function chunkArray<T>(items: T[], chunkSize: number = 200): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }
  return chunks
}

async function resolveOrCreatePerson(
  creator: any,
  supabase: any,
  peopleMap: Record<number, string>,
  allPeopleList?: SyncPersonMeta[]
): Promise<string | null> {
  if (!creator || !creator.id) return null
  const creatorId = Number(creator.id)

  if (peopleMap[creatorId]) {
    return peopleMap[creatorId]
  }

  const { data: dbPerson } = await supabase
    .from('bc_people')
    .select('id, bc_id, name, email')
    .eq('bc_id', creatorId)
    .maybeSingle()

  if (dbPerson) {
    peopleMap[creatorId] = dbPerson.id
    if (allPeopleList && !allPeopleList.some((p) => p.id === dbPerson.id)) {
      allPeopleList.push(dbPerson)
    }
    return dbPerson.id
  }

  console.log(`👤 [Basecamp Sync] Dynamically inserting missing person: ${creator.name || 'Unknown'} (bc_id: ${creatorId})`)
  try {
    const incomingEmail = creator.email_address || ''
    const cleanEmail = isMaskedOrEmptyEmail(incomingEmail) ? '' : incomingEmail
    const { data: newPerson, error: pErr } = await supabase
      .from('bc_people')
      .insert({
        bc_id: creatorId,
        name: creator.name || 'Unknown',
        email: cleanEmail,
        avatar_url: creator.avatar_url || '',
        role: creator.employee ? 'employee' : creator.client ? 'client' : 'user',
        title: creator.title || '',
        is_active: true,
      })
      .select('id, bc_id, name, email')
      .maybeSingle()

    if (!pErr && newPerson) {
      peopleMap[creatorId] = newPerson.id
      if (allPeopleList && !allPeopleList.some((p) => p.id === newPerson.id)) {
        allPeopleList.push(newPerson)
      }
      return newPerson.id
    } else if (pErr) {
      console.warn(`      ⚠️ Insert conflict for person ${creator.name}, looking up existing...`)
      const { data: conflictPerson } = await supabase
        .from('bc_people')
        .select('id, bc_id, name, email')
        .eq('bc_id', creatorId)
        .maybeSingle()
      if (conflictPerson) {
        peopleMap[creatorId] = conflictPerson.id
        if (allPeopleList && !allPeopleList.some((p) => p.id === conflictPerson.id)) {
          allPeopleList.push(conflictPerson)
        }
        return conflictPerson.id
      }
    }
  } catch (err: any) {
    console.warn(`      ⚠️ Exception inserting missing person ${creator.name}:`, err.message)
  }

  return null
}

/**
 * Author Priority Inversion:
 *  - Priority #1: Embedded TEG author banner resolved via Pass 2 + Pass 3 fuzzy matching (findPersonInListByFuzzyName).
 *  - Priority #2: Existing local author/creator in Supabase (created_by_person_id / author_person_id).
 *  - Priority #3: Basecamp API creator.
 */
async function resolveSyncedAuthorUuid(opts: {
  extractedAuthorName: string | null
  existingAuthorUuid?: string | null
  bcCreator: any
  allPeopleList: SyncPersonMeta[]
  supabase: any
  peopleMap: Record<number, string>
}): Promise<string | null> {
  if (opts.extractedAuthorName) {
    const matched = findPersonInListByFuzzyName(opts.allPeopleList, opts.extractedAuthorName)
    if (matched?.id) return matched.id
  }
  if (opts.existingAuthorUuid) {
    return opts.existingAuthorUuid
  }
  return resolveOrCreatePerson(opts.bcCreator, opts.supabase, opts.peopleMap, opts.allPeopleList)
}

export async function GET(request: Request) {
  const auth = verifyStaffAuth(request, { allowCron: true })
  if (!auth.authorized) {
    return auth.response!
  }

  const authHeader = request.headers.get('authorization')
  const cronAuthHeader = request.headers.get('x-cron-auth')
  const cookieHeader = request.headers.get('cookie')
  const userAgent = request.headers.get('user-agent')
  const vercelCronHeader = request.headers.get('x-vercel-cron')
  const mockRequest = new Request(request.url, {
    method: 'POST',
    body: JSON.stringify({ full: false }),
    headers: {
      'Content-Type': 'application/json',
      ...(!auth.user ? { 'x-internal-cron': '1' } : {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(cronAuthHeader ? { 'x-cron-auth': cronAuthHeader } : {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {}),
      ...(vercelCronHeader ? { 'x-vercel-cron': vercelCronHeader } : {}),
    },
  })

  return POST(mockRequest)
}

export async function POST(request: Request) {
  const auth = verifyStaffAuth(request, { allowCron: true })
  if (!auth.authorized) {
    return auth.response!
  }

  const urlObj = (() => {
    try {
      return new URL(request.url)
    } catch {
      return null
    }
  })()
  const forceRun = urlObj?.searchParams.get('force') === '1' || urlObj?.searchParams.get('force') === 'true'
  const isInternalCron = !auth.user

  const { hour: laHour, minute: laMinute } = getLATimeParts()
  if (isInternalCron && !forceRun && (laHour >= 22 || laHour < 7)) {
    console.log(
      `⏳ [Basecamp Sync] Internal cron skipped during overnight window (10:00 PM - 6:59 AM LA). LA Time: ${laHour}:${String(laMinute).padStart(2, '0')}`
    )
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'Overnight cron skip (10:00 PM - 6:59 AM LA)',
      la_hour: laHour,
    })
  }

  const supabase = getSyncClient()
  const counters = createCounters()
  const startTime = Date.now()

  // Parse request body for options
  let forceFullSync = false
  let targetProjectBcId: number | null = null
  try {
    const body = await request.json().catch(() => ({}))
    forceFullSync = body?.full === true
    if (body?.projectId && Number(body.projectId) > 0) {
      targetProjectBcId = Number(body.projectId)
    }
  } catch { /* no body is fine */ }

  // ================================================================
  // STEP 0a: CLEANUP — Mark stuck syncs (> 15 min in "running") as "timeout"
  // ================================================================
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: stuckSyncs } = await supabase
    .from('bc_sync_log')
    .update({
      status: 'timeout',
      completed_at: new Date().toISOString(),
      error_message: 'Automatically marked as timeout (stuck > 15 min)',
    })
    .eq('status', 'running')
    .lt('started_at', fifteenMinAgo)
    .select('id')

  if (stuckSyncs && stuckSyncs.length > 0) {
    console.log(`🧹 [Basecamp Sync] Cleaned up ${stuckSyncs.length} stuck sync(s)`)
  }

  // ================================================================
  // STEP 0b: MUTEX — Reject if a sync is already running (< 15 min old)
  // ================================================================
  const { data: activeSyncs } = await supabase
    .from('bc_sync_log')
    .select('id, started_at')
    .eq('status', 'running')
    .gte('started_at', fifteenMinAgo)

  if (activeSyncs && activeSyncs.length > 0) {
    console.log(`⏳ [Basecamp Sync] Another sync is already running. Skipping.`)
    return NextResponse.json(
      { error: 'A sync is already in progress. Try again in a few minutes.' },
      { status: 409 }
    )
  }

  // ================================================================
  // STEP 0c: Get last successful sync timestamp for incremental mode
  // ================================================================
  let lastSyncAt: string | null = null
  let lastSyncMs = 0
  if (!forceFullSync) {
    const { data: lastSync } = await supabase
      .from('bc_sync_log')
      .select('started_at')
      .in('status', ['completed', 'completed_with_errors'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    lastSyncAt = lastSync?.started_at || null
    if (lastSyncAt) {
      // Subtract 2 minutes safety buffer to prevent clock drift or format boundary misses
      lastSyncMs = Math.max(0, new Date(lastSyncAt).getTime() - 2 * 60 * 1000)
    }
  }

  const syncMode = targetProjectBcId ? 'project' : lastSyncAt ? 'incremental' : 'full'

  // 1. Create sync log entry
  const { data: logEntry, error: logError } = await supabase
    .from('bc_sync_log')
    .insert({
      sync_type: syncMode,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  const syncLogId = logEntry?.id

  // Double-check: if multiple running syncs now exist, this one loses the race
  const { data: runningSyncs } = await supabase
    .from('bc_sync_log')
    .select('id')
    .eq('status', 'running')
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })

  if (runningSyncs && runningSyncs.length > 1 && runningSyncs[0].id !== syncLogId) {
    // We lost the race — mark our entry as cancelled and bail
    await supabase.from('bc_sync_log').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', syncLogId)
    console.log('⏳ [Basecamp Sync] Lost race for sync lock. Cancelling.')
    return NextResponse.json(
      { error: 'Another sync just started. Try again in a few minutes.' },
      { status: 409 }
    )
  }

  try {
    const token = await getValidToken()
    const urlCache = new Map<string, string>()

    console.log(`🔄 [Basecamp Sync] Starting ${syncMode.toUpperCase()} sync...${lastSyncAt ? ` (changes since ${lastSyncAt})` : ''}`)

    // Maps to resolve Basecamp Numeric IDs to local Supabase UUIDs
    const peopleMap: Record<number, string> = {}
    const projectsMap: Record<number, string> = {}
    const todosetsMap: Record<number, string> = {}
    const todolistsMap: Record<number, string> = {}
    const todosMap: Record<number, string> = {}
    const messageBoardsMap: Record<number, string> = {}
    const messagesMap: Record<number, string> = {}
    const campfiresMap: Record<number, string> = {}
    const vaultsMap: Record<number, string> = {}
    const documentsMap: Record<number, string> = {}
    const schedulesMap: Record<number, string> = {}
    const questionnairesMap: Record<number, string> = {}
    const questionsMap: Record<number, string> = {}

    // ================================================================
    // STEP 1: SYNC PEOPLE (diff-based to skip no-op upserts on quiet ticks)
    // ================================================================
    console.log('👥 [Basecamp Sync] Step 1: Syncing people...')
    try {
      const [people, { data: existingPeople }] = await Promise.all([
        fetchPeople(),
        supabase
          .from('bc_people')
          .select('id, bc_id, name, email, avatar_url, role, title, is_active')
          .limit(10000),
      ])
      console.log(`   Found ${people.length} people`)

      const existingPeopleByBcId = new Map<
        number,
        {
          id: string
          bc_id: number | string
          name?: string | null
          email?: string | null
          avatar_url?: string | null
          role?: string | null
          title?: string | null
          is_active?: boolean | null
        }
      >()
      if (existingPeople) {
        for (const ep of existingPeople) {
          const bcId = Number(ep.bc_id)
          peopleMap[bcId] = ep.id
          existingPeopleByBcId.set(bcId, ep)
        }
      }

      if (people.length > 0) {
        const nowIso = new Date().toISOString()
        const changedPeopleRows = people
          .map((p) => {
            const prev = existingPeopleByBcId.get(Number(p.id))
            const incomingEmail = p.email_address || ''
            // Never overwrite an existing real TEG email with Basecamp's masked bullet email ("e•••@•••")
            const preservedEmail =
              isMaskedOrEmptyEmail(incomingEmail) && prev?.email && !isMaskedOrEmptyEmail(prev.email)
                ? prev.email
                : incomingEmail
            return {
              bc_id: p.id,
              name: p.name,
              email: preservedEmail,
              avatar_url: p.avatar_url || '',
              role: p.employee ? 'employee' : p.client ? 'client' : 'user',
              title: p.title || '',
              is_active: p.status !== 'archived',
              updated_at: nowIso,
            }
          })
          .filter((row) => {
            if (forceFullSync) return true
            const prev = existingPeopleByBcId.get(Number(row.bc_id))
            if (!prev) return true
            return (
              (prev.name || '') !== (row.name || '') ||
              (prev.email || '') !== (row.email || '') ||
              (prev.avatar_url || '') !== (row.avatar_url || '') ||
              (prev.role || '') !== (row.role || '') ||
              (prev.title || '') !== (row.title || '') ||
              Boolean(prev.is_active) !== Boolean(row.is_active)
            )
          })

        if (changedPeopleRows.length > 0) {
          const { data: insertedPeople, error: upsertErr } = await supabase
            .from('bc_people')
            .upsert(changedPeopleRows, { onConflict: 'bc_id' })
            .select('id, bc_id')

          if (upsertErr) {
            console.error('   ❌ People upsert error:', upsertErr.message)
            counters.errors.push(`People: ${upsertErr.message}`)
          } else if (insertedPeople) {
            counters.people = insertedPeople.length
            insertedPeople.forEach((p) => {
              peopleMap[Number(p.bc_id)] = p.id
            })
            console.log(`   ✅ ${insertedPeople.length}/${people.length} people changed & synced`)
          }
        } else {
          console.log(`   ⚡ People unchanged (0/${people.length} upserts skipped)`)
        }
      }
    } catch (err: any) {
      console.error('   ❌ People sync failed:', err.message)
      counters.errors.push(`People: ${err.message}`)
    }

    // Build shared in-memory people directory + synthetic person ID set for Pass 2+3 fuzzy matching & assignee preservation
    const allKnownPeopleList: SyncPersonMeta[] = []
    const syntheticPersonIds = new Set<string>()
    {
      const { data: allDbPeople } = await supabase
        .from('bc_people')
        .select('id, bc_id, name, email')
        .limit(5000)
      for (const p of allDbPeople || []) {
        allKnownPeopleList.push(p)
        if (p.bc_id != null) {
          const numBcId = Number(p.bc_id)
          peopleMap[numBcId] = p.id
          if (numBcId >= SYNTHETIC_BC_ID_THRESHOLD) {
            syntheticPersonIds.add(p.id)
          }
        }
      }
    }

    // ================================================================
    // STEP 2: SYNC PROJECTS (diff-based to skip no-op upserts & preserve member_count)
    // ================================================================
    console.log('📂 [Basecamp Sync] Step 2: Syncing projects...')
    let projects: BasecampProject[] = []
    // Map of project bc_id → Basecamp API updated_at (to detect changes)
    const projectApiUpdatedAt: Record<number, string> = {}
    try {
      const [fetchedProjects, { data: existingProjects }] = await Promise.all([
        fetchProjects(),
        supabase
          .from('bc_projects')
          .select('id, bc_id, name, description, color, is_pinned, is_archived, member_count')
          .limit(10000),
      ])
      projects = fetchedProjects
      console.log(`   Found ${projects.length} projects`)

      // Store API updated_at for incremental comparison
      for (const p of projects) {
        projectApiUpdatedAt[p.id] = p.updated_at || ''
      }

      const existingProjectByBcId = new Map<
        number,
        {
          id: string
          bc_id: number | string
          name?: string | null
          description?: string | null
          color?: string | null
          is_pinned?: boolean | null
          is_archived?: boolean | null
          member_count?: number | null
        }
      >()
      if (existingProjects) {
        for (const ep of existingProjects) {
          const epId = Number(ep.bc_id)
          projectsMap[epId] = ep.id
          existingProjectByBcId.set(epId, ep)
        }
      }

      if (projects.length > 0) {
        const nowIso = new Date().toISOString()
        const changedProjectRows = projects
          .map((p) => {
            const epId = Number(p.id)
            const prev = existingProjectByBcId.get(epId)
            const existingColor = prev?.color || 'white'
            const existingPin = prev ? Boolean(prev.is_pinned) : Boolean(p.bookmarked)

            return {
              bc_id: p.id,
              name: p.name,
              description: p.description || '',
              color: existingColor,
              is_pinned: existingPin,
              is_archived: p.status === 'archived',
              member_count: prev ? Number(prev.member_count || 0) : 0,
              updated_at: nowIso,
            }
          })
          .filter((row) => {
            if (forceFullSync) return true
            const prev = existingProjectByBcId.get(Number(row.bc_id))
            if (!prev) return true
            return (
              (prev.name || '') !== (row.name || '') ||
              (prev.description || '') !== (row.description || '') ||
              (prev.color || 'white') !== (row.color || 'white') ||
              Boolean(prev.is_pinned) !== Boolean(row.is_pinned) ||
              Boolean(prev.is_archived) !== Boolean(row.is_archived)
            )
          })

        if (changedProjectRows.length > 0) {
          const { data: insertedProjects, error: upsertErr } = await supabase
            .from('bc_projects')
            .upsert(changedProjectRows, { onConflict: 'bc_id' })
            .select('id, bc_id')

          if (upsertErr) {
            console.error('   ❌ Projects upsert error:', upsertErr.message)
            counters.errors.push(`Projects: ${upsertErr.message}`)
          } else if (insertedProjects) {
            counters.projects = insertedProjects.length
            insertedProjects.forEach((p) => {
              projectsMap[Number(p.bc_id)] = p.id
            })
            console.log(`   ✅ ${insertedProjects.length}/${projects.length} projects changed & synced`)
          }
        } else {
          console.log(`   ⚡ Projects unchanged (0/${projects.length} upserts skipped)`)
        }
      }
    } catch (err: any) {
      console.error('   ❌ Projects sync failed:', err.message)
      counters.errors.push(`Projects: ${err.message}`)
    }

    // ================================================================
    // INCREMENTAL FILTER: Determine which projects need full resource sync
    // ================================================================
    let changedProjectIds: Set<number> | null = null // null = sync all (full mode)
    let hasContentMutations = false

    if (lastSyncAt && !forceFullSync) {
      changedProjectIds = new Set<number>()
      for (const p of projects) {
        const apiUpdated = p.updated_at || ''
        // Project changed if its API updated_at is newer than our last sync
        if (apiUpdated > lastSyncAt) {
          changedProjectIds.add(p.id)
        }
      }
      console.log(`🔍 [Basecamp Sync] Incremental: ${changedProjectIds.size}/${projects.length} projects changed since last sync`)
    }

    // ================================================================
    // STEP 3: SYNC PER-PROJECT RESOURCES
    // ================================================================
    // Helper function to recursively sync vault contents (for sub-folders)
    async function syncVaultContents(
      projectId: number,
      projectUuid: string,
      vaultId: number,
      vaultUuid: string
    ) {
      // 1. Sync documents inside this vault
      try {
        const docs = await fetchDocuments(projectId, vaultId)
        const existingDocAuthorByBcId = new Map<number, string>()
        if (docs.length > 0) {
          for (const chunk of chunkArray(docs.map((d) => d.id))) {
            const { data: existingDocs } = await supabase
              .from('bc_documents')
              .select('bc_id, author_person_id')
              .in('bc_id', chunk)
            for (const ed of existingDocs || []) {
              if (ed.bc_id && ed.author_person_id) {
                existingDocAuthorByBcId.set(Number(ed.bc_id), ed.author_person_id)
              }
            }
          }
        }

        for (const d of docs) {
          const docUpdatedAt = d.updated_at || d.created_at
          const isUnchanged = !forceFullSync && lastSyncAt && docUpdatedAt && docUpdatedAt <= lastSyncAt

          if (isUnchanged) {
            counters.documents++
            continue
          }

          const rawProcessedDocContent = await processHtmlContent(
            d.content || '',
            token,
            'documents',
            d.id,
            supabase,
            urlCache
          )
          const { cleanHtml: processedContent, extractedAuthorName: extractedDocAuthor } =
            stripTegAuthorBanner(rawProcessedDocContent)

          const authorUuid = await resolveSyncedAuthorUuid({
            extractedAuthorName: extractedDocAuthor,
            existingAuthorUuid: existingDocAuthorByBcId.get(Number(d.id)) || null,
            bcCreator: d.creator,
            allPeopleList: allKnownPeopleList,
            supabase,
            peopleMap,
          })

          const { data: dbDoc, error: docErr } = await supabase
            .from('bc_documents')
            .upsert(
              {
                bc_id: d.id,
                project_id: projectUuid,
                vault_id: vaultUuid,
                title: d.title,
                content: processedContent,
                author_person_id: authorUuid,
                created_at: d.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'bc_id' }
            )
            .select('id')
            .single()

          if (docErr) {
            counters.errors.push(`Document ${d.id}: ${docErr.message}`)
            continue
          }

          const docUuid = dbDoc.id
          documentsMap[d.id] = docUuid
          counters.documents++
          hasContentMutations = true

          // Sync comments on document (scoped by parent_id to avoid 1,000-row cap)
          if (d.comments_count > 0) {
            try {
              const [comments, { data: existingDocComments }] = await Promise.all([
                fetchComments(projectId, d.id),
                supabase.from('bc_comments').select('bc_id, author_person_id').eq('parent_id', docUuid),
              ])
              const existingComAuthorMap = new Map<number, string>()
              for (const ec of existingDocComments || []) {
                if (ec.bc_id && ec.author_person_id) {
                  existingComAuthorMap.set(Number(ec.bc_id), ec.author_person_id)
                }
              }

              const commentRows = []
              for (const c of comments) {
                const rawCommentContent = await processHtmlContent(
                  c.content || '',
                  token,
                  'comments',
                  c.id,
                  supabase,
                  urlCache
                )
                const { cleanHtml: processedCommentContent, extractedAuthorName: extractedCommentAuthor } =
                  stripTegAuthorBanner(rawCommentContent)
                const finalCommentAuthorUuid = await resolveSyncedAuthorUuid({
                  extractedAuthorName: extractedCommentAuthor,
                  existingAuthorUuid: existingComAuthorMap.get(Number(c.id)) || null,
                  bcCreator: c.creator,
                  allPeopleList: allKnownPeopleList,
                  supabase,
                  peopleMap,
                })
                commentRows.push({
                  bc_id: c.id,
                  project_id: projectUuid,
                  parent_type: 'document',
                  parent_id: docUuid,
                  content: processedCommentContent,
                  author_person_id: finalCommentAuthorUuid,
                  created_at: c.created_at || new Date().toISOString(),
                })
              }

              if (commentRows.length > 0) {
                await supabase.from('bc_comments').upsert(commentRows, { onConflict: 'bc_id' })
                counters.comments += comments.length
              }
            } catch (comFetchErr: any) {
              console.warn(`      ⚠️ comments fetch error for doc ${d.id}:`, comFetchErr.message)
            }
          }
        }
      } catch (docErr: any) {
        counters.errors.push(`Documents for vault ${vaultId}: ${docErr.message}`)
      }

      // 2. Sync uploads inside this vault
      try {
        const uploads = await fetchUploads(projectId, vaultId)
        if (uploads.length > 0) {
          const existingMap = new Map<number, string>()
          const existingUploadAuthorByBcId = new Map<number, string>()
          for (const chunk of chunkArray(uploads.map((u) => u.id))) {
            const { data: existingUploads } = await supabase
              .from('bc_uploads')
              .select('bc_id, download_url, author_person_id')
              .in('bc_id', chunk)
            for (const eu of existingUploads || []) {
              const url = eu.download_url || ''
              if (url.includes('supabase.co') || url.includes('checklist-photos')) {
                existingMap.set(Number(eu.bc_id), url)
              }
              if (eu.bc_id && eu.author_person_id) {
                existingUploadAuthorByBcId.set(Number(eu.bc_id), eu.author_person_id)
              }
            }
          }

          const uploadRows = []
          for (const u of uploads) {
            let finalUrl = existingMap.get(u.id)
            if (!finalUrl && u.download_url) {
              const isBasecampUrl =
                isExternalBasecampUrl(u.download_url) && !u.download_url.includes('google.com')

              if (isBasecampUrl) {
                console.log(`📥 Syncing new upload file to Supabase Storage: ${u.filename} (bc_id: ${u.id})...`)
                const localUrl = await downloadAndUploadAttachment(
                  token,
                  u.download_url,
                  u.filename || u.title || 'file',
                  u.content_type || 'application/octet-stream',
                  'uploads',
                  u.id,
                  supabase
                )
                if (localUrl) {
                  finalUrl = localUrl
                  hasContentMutations = true
                }
              }
            }

            const uploadAuthorUuid =
              existingUploadAuthorByBcId.get(Number(u.id)) ||
              (await resolveOrCreatePerson(u.creator, supabase, peopleMap, allKnownPeopleList))

            uploadRows.push({
              bc_id: u.id,
              project_id: projectUuid,
              vault_id: vaultUuid,
              filename: u.filename || u.title,
              content_type: u.content_type || '',
              byte_size: u.byte_size || 0,
              download_url: finalUrl || u.download_url || '',
              author_person_id: uploadAuthorUuid,
              created_at: u.created_at || new Date().toISOString(),
            })
          }

          const { error: upErr } = await supabase.from('bc_uploads').upsert(uploadRows, { onConflict: 'bc_id' })
          if (upErr) {
            counters.errors.push(`Uploads for vault ${vaultId}: ${upErr.message}`)
          } else {
            counters.uploads += uploads.length
          }
        }
      } catch (upErr: any) {
        counters.errors.push(`Uploads for vault ${vaultId}: ${upErr.message}`)
      }

      // 3. Sync sub-vaults (nested folders) recursively!
      try {
        const subvaults = await fetchSubVaults(projectId, vaultId)
        for (const sv of subvaults) {
          const { data: dbSubVault, error: svErr } = await supabase
            .from('bc_vaults')
            .upsert({
              bc_id: sv.id,
              project_id: projectUuid,
              name: sv.title || sv.name || 'Folder',
              parent_vault_id: vaultUuid
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (svErr) {
            counters.errors.push(`Sub-vault ${sv.id}: ${svErr.message}`)
            continue
          }

          const subVaultUuid = dbSubVault.id
          vaultsMap[sv.id] = subVaultUuid
          counters.vaults++

          // Recurse into this sub-vault!
          await syncVaultContents(projectId, projectUuid, sv.id, subVaultUuid)
        }
      } catch (svErr: any) {
        counters.errors.push(`Subvaults for vault ${vaultId}: ${svErr.message}`)
      }
    }

    const reqOrigin = (() => {
      try {
        return new URL(request.url).origin
      } catch {
        return ''
      }
    })()
    const webhookOrigin = (process.env.NEXT_PUBLIC_APP_URL || (reqOrigin.startsWith('https://') ? reqOrigin : '')).replace(/\/+$/, '')

    for (const project of projects) {
      if (targetProjectBcId && project.id !== targetProjectBcId) {
        continue
      }

      const projectUuid = projectsMap[project.id]
      if (!projectUuid) {
        console.warn(`⚠️ Skipped project "${project.name}" (bc_id: ${project.id}) - No local project UUID found`)
        continue
      }

      // Ensure real-time webhook is registered on Basecamp when running in HTTPS production
      if (webhookOrigin.startsWith('https://')) {
        ensureProjectWebhook(project.id, `${webhookOrigin}/api/basecamp/webhook`).catch(() => {})
      }

      console.log(`\n📁 Processing project: "${project.name}" (bc_id: ${project.id})`)

      // Preload existing todos (TWO queries to respect PostgREST 1,000-row cap: all active + 1,000 most recent completed) & messages
      const [
        { data: activeProjectTodos },
        { data: recentCompletedProjectTodos },
        { data: existingProjectMessages },
      ] = await Promise.all([
        supabase
          .from('bc_todos')
          .select('id, bc_id, is_completed, comments_count, title, due_date, created_by_person_id')
          .eq('project_id', projectUuid)
          .eq('is_completed', false)
          .limit(1000),
        supabase
          .from('bc_todos')
          .select('id, bc_id, is_completed, comments_count, title, due_date, created_by_person_id')
          .eq('project_id', projectUuid)
          .eq('is_completed', true)
          .order('updated_at', { ascending: false })
          .limit(1000),
        supabase
          .from('bc_messages')
          .select('id, bc_id, comments_count, title, author_person_id')
          .eq('project_id', projectUuid)
          .limit(1000),
      ])

      const existingTodoByBcId = new Map<number, any>()
      for (const et of recentCompletedProjectTodos || []) {
        existingTodoByBcId.set(Number(et.bc_id), et)
      }
      for (const et of activeProjectTodos || []) {
        existingTodoByBcId.set(Number(et.bc_id), et)
      }

      const existingMsgByBcId = new Map<number, any>()
      for (const em of existingProjectMessages || []) {
        existingMsgByBcId.set(Number(em.bc_id), em)
      }

      // ---- MEMBERSHIPS ----
      try {
        const members = await fetchProjectPeople(project.id)
        if (members && members.length > 0) {
          const membershipRows = members
            .map((m) => {
              const personUuid = peopleMap[m.id]
              if (!personUuid) return null
              return {
                project_id: projectUuid,
                person_id: personUuid,
                role: m.employee ? 'employee' : m.client ? 'client' : 'user',
              }
            })
            .filter((row) => row !== null)

          if (membershipRows.length > 0) {
            const { error: memErr } = await supabase
              .from('bc_memberships')
              .upsert(membershipRows, { onConflict: 'project_id,person_id' })

            if (memErr) {
              console.error(`   ❌ memberships upsert error for project ${project.id}:`, memErr.message)
            } else {
              counters.memberships += membershipRows.length
              // Update member count in project
              await supabase
                .from('bc_projects')
                .update({ member_count: membershipRows.length })
                .eq('id', projectUuid)
            }
          }
        }
      } catch (err: any) {
        console.warn(`   ⚠️ Memberships sync skipped for project ${project.id}:`, err.message)
      }

      // ---- TODOSET → TODOLISTS → TODOS ----
      const todosetDock = findDock(project, 'todoset')
      if (todosetDock) {
        try {
          const todosetId = extractDockId(todosetDock.url)
          
          // Upsert the todosets container
          const { data: dbTodoset, error: todosetErr } = await supabase
            .from('bc_todosets')
            .upsert({
              bc_id: todosetId,
              project_id: projectUuid,
              name: todosetDock.title || 'Todoset',
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (todosetErr) {
            throw todosetErr
          }

          const todosetUuid = dbTodoset.id
          todosetsMap[todosetId] = todosetUuid
          counters.todosets++

          const todolists = await fetchTodoLists(project.id, todosetId)
          console.log(`   📋 Found ${todolists.length} todo lists`)

          for (const list of todolists) {
            // Upsert the todolist
            const processedListDesc = await processHtmlContent(list.description || '', token, 'todolists', list.id, supabase, urlCache)
            const { data: dbList, error: listErr } = await supabase
              .from('bc_todolists')
              .upsert(
                {
                  bc_id: list.id,
                  project_id: projectUuid,
                  todoset_id: todosetUuid,
                  name: list.title || list.name,
                  description: processedListDesc,
                  position: list.position,
                  completed_count: parseInt(list.completed_ratio?.split('/')[0] || '0', 10),
                  total_count: parseInt(list.completed_ratio?.split('/')[1] || '0', 10),
                  created_at: list.created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'bc_id' }
              )
              .select('id')
              .single()

            if (listErr) {
              counters.errors.push(`TodoList ${list.id}: ${listErr.message}`)
              continue
            }
            
            const todolistUuid = dbList.id
            todolistsMap[list.id] = todolistUuid
            counters.todolists++

            // Fetch todos within this list
            try {
              const todos = await fetchAllTodos(project.id, list.id, !forceFullSync)

              // Hydrate any older completed todos in this batch that weren't in the top-1,000 recent preload
              const uncachedTodoBcIds = todos
                .map((t) => Number(t.id))
                .filter((bcId) => !existingTodoByBcId.has(bcId))
              if (uncachedTodoBcIds.length > 0) {
                for (const chunk of chunkArray(uncachedTodoBcIds)) {
                  const { data: extraTodos } = await supabase
                    .from('bc_todos')
                    .select('id, bc_id, is_completed, comments_count, title, due_date, created_by_person_id')
                    .in('bc_id', chunk)
                  for (const et of extraTodos || []) {
                    existingTodoByBcId.set(Number(et.bc_id), et)
                  }
                }
              }

              // Separate active and completed todos
              const activeTodos = todos.filter((t) => !t.completed)
              const activeBcIds = activeTodos.map((t) => Number(t.id))

              for (const t of todos) {
                const todoUpdatedAt = t.updated_at || t.created_at
                const todoUpdatedMs = todoUpdatedAt ? new Date(todoUpdatedAt).getTime() : Infinity
                const existingTodo = existingTodoByBcId.get(Number(t.id))
                const hasMetadataDelta =
                  !existingTodo ||
                  Boolean(existingTodo.is_completed) !== Boolean(t.completed) ||
                  Number(existingTodo.comments_count || 0) !== Number(t.comments_count || 0) ||
                  (existingTodo.title || '') !== (t.content || t.title || '') ||
                  (existingTodo.due_date || null) !== (t.due_on || null)

                const isUnchanged =
                  !forceFullSync &&
                  lastSyncMs > 0 &&
                  !hasMetadataDelta &&
                  todoUpdatedMs <= lastSyncMs

                if (isUnchanged) {
                  counters.todos++
                  continue
                }

                const rawProcessedTodoDesc = await processHtmlContent(
                  t.description || '',
                  token,
                  'todos',
                  t.id,
                  supabase,
                  urlCache
                )
                const { cleanHtml: processedTodoDesc, extractedAuthorName: extractedTodoAuthor } =
                  stripTegAuthorBanner(rawProcessedTodoDesc)
                const finalTodoAuthorUuid = await resolveSyncedAuthorUuid({
                  extractedAuthorName: extractedTodoAuthor,
                  existingAuthorUuid: existingTodo?.created_by_person_id || null,
                  bcCreator: t.creator,
                  allPeopleList: allKnownPeopleList,
                  supabase,
                  peopleMap,
                })

                const { data: dbTodo, error: todoErr } = await supabase
                  .from('bc_todos')
                  .upsert(
                    {
                      bc_id: t.id,
                      project_id: projectUuid,
                      todolist_id: todolistUuid,
                      title: t.content || t.title,
                      description: processedTodoDesc,
                      is_completed: t.completed || false,
                      completed_at: t.completed ? t.updated_at || new Date().toISOString() : null,
                      due_date: t.due_on || null,
                      position: t.position,
                      comments_count: t.comments_count || 0,
                      created_by_person_id: finalTodoAuthorUuid,
                      created_at: t.created_at || new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'bc_id' }
                  )
                  .select('id')
                  .single()

                if (todoErr) {
                  counters.errors.push(`Todo ${t.id}: ${todoErr.message}`)
                  continue
                }

                const todoUuid = dbTodo.id
                todosMap[t.id] = todoUuid
                counters.todos++
                hasContentMutations = true

                // Todo Assignees (N:N) — Preserve local synthetic TEG assignees (bc_id >= SYNTHETIC_BC_ID_THRESHOLD)
                const { data: existingAssignees } = await supabase
                  .from('bc_todo_assignees')
                  .select('person_id')
                  .eq('todo_id', todoUuid)

                const mergedAssigneePersonIds = new Set<string>()
                for (const ea of existingAssignees || []) {
                  if (ea.person_id && syntheticPersonIds.has(ea.person_id)) {
                    mergedAssigneePersonIds.add(ea.person_id)
                  }
                }
                for (const a of t.assignees || []) {
                  const personUuid =
                    peopleMap[a.id] || (await resolveOrCreatePerson(a, supabase, peopleMap, allKnownPeopleList))
                  if (personUuid) mergedAssigneePersonIds.add(personUuid)
                }

                await supabase.from('bc_todo_assignees').delete().eq('todo_id', todoUuid)
                if (mergedAssigneePersonIds.size > 0) {
                  const assigneeRows = Array.from(mergedAssigneePersonIds).map((personUuid) => ({
                    todo_id: todoUuid,
                    person_id: personUuid,
                  }))
                  const { error: assErr } = await supabase
                    .from('bc_todo_assignees')
                    .upsert(assigneeRows, { onConflict: 'todo_id,person_id' })

                  if (assErr) {
                    console.error(`      ❌ assignees error for todo ${t.id}:`, assErr.message)
                  } else {
                    counters.todo_assignees += assigneeRows.length
                  }
                }

                // Sync comments on todo (scoped to parent_id so we NEVER hit PostgREST 1,000-row cap)
                if (t.comments_count > 0) {
                  try {
                    const [comments, { data: existingTodoComments }] = await Promise.all([
                      fetchComments(project.id, t.id),
                      supabase.from('bc_comments').select('bc_id, author_person_id').eq('parent_id', todoUuid),
                    ])
                    const existingComAuthorMap = new Map<number, string>()
                    let localSyntheticComCount = 0
                    for (const ec of existingTodoComments || []) {
                      if (ec.bc_id != null && Number(ec.bc_id) >= SYNTHETIC_BC_ID_THRESHOLD) {
                        localSyntheticComCount++
                      }
                      if (ec.bc_id && ec.author_person_id) {
                        existingComAuthorMap.set(Number(ec.bc_id), ec.author_person_id)
                      }
                    }

                    const commentRows = []
                    for (const c of comments) {
                      const rawCommentContent = await processHtmlContent(
                        c.content || '',
                        token,
                        'comments',
                        c.id,
                        supabase,
                        urlCache
                      )
                      const { cleanHtml: processedCommentContent, extractedAuthorName: extractedCommentAuthor } =
                        stripTegAuthorBanner(rawCommentContent)
                      const finalCommentAuthorUuid = await resolveSyncedAuthorUuid({
                        extractedAuthorName: extractedCommentAuthor,
                        existingAuthorUuid: existingComAuthorMap.get(Number(c.id)) || null,
                        bcCreator: c.creator,
                        allPeopleList: allKnownPeopleList,
                        supabase,
                        peopleMap,
                      })
                      commentRows.push({
                        bc_id: c.id,
                        project_id: projectUuid,
                        parent_type: 'todo',
                        parent_id: todoUuid,
                        content: processedCommentContent,
                        author_person_id: finalCommentAuthorUuid,
                        created_at: c.created_at || new Date().toISOString(),
                      })
                    }

                    if (commentRows.length > 0) {
                      const { error: comErr } = await supabase
                        .from('bc_comments')
                        .upsert(commentRows, { onConflict: 'bc_id' })

                      if (comErr) {
                        console.error(`      ❌ comments error for todo ${t.id}:`, comErr.message)
                      } else {
                        counters.comments += comments.length
                        const exactTotalComments = comments.length + localSyntheticComCount
                        if (exactTotalComments !== Number(t.comments_count || 0)) {
                          await supabase
                            .from('bc_todos')
                            .update({ comments_count: exactTotalComments })
                            .eq('id', todoUuid)
                        }
                      }
                    }
                  } catch (comFetchErr: any) {
                    console.warn(`      ⚠️ comments fetch error for todo ${t.id}:`, comFetchErr.message)
                  }
                }
              }

              // Self-healing: Reconcile active vs completed tasks without hitting 1,000-row cap & excluding local synthetic tasks
              {
                const activeSet = new Set(activeBcIds)
                const { data: localActiveTodos } = await supabase
                  .from('bc_todos')
                  .select('bc_id')
                  .eq('todolist_id', todolistUuid)
                  .eq('is_completed', false)
                  .limit(1000)

                const completedBcIds = (localActiveTodos || [])
                  .map((r: any) => Number(r.bc_id))
                  .filter((bcId: number) => isRealBasecampId(bcId) && !activeSet.has(bcId))

                if (completedBcIds.length > 0) {
                  console.log(
                    `🧹 [Basecamp Sync] Self-healing: Marking ${completedBcIds.length} tasks as completed for list ${list.name || list.title}:`,
                    completedBcIds
                  )
                  const nowIso = new Date().toISOString()
                  for (const chunk of chunkArray(completedBcIds)) {
                    await supabase
                      .from('bc_todos')
                      .update({ is_completed: true, completed_at: nowIso, updated_at: nowIso })
                      .eq('todolist_id', todolistUuid)
                      .in('bc_id', chunk)
                  }
                }

                if (activeBcIds.length > 0) {
                  const reopenedBcIds: number[] = []
                  for (const chunk of chunkArray(activeBcIds)) {
                    const { data: wronglyCompleted } = await supabase
                      .from('bc_todos')
                      .select('bc_id')
                      .eq('todolist_id', todolistUuid)
                      .eq('is_completed', true)
                      .in('bc_id', chunk)
                    for (const r of wronglyCompleted || []) {
                      reopenedBcIds.push(Number(r.bc_id))
                    }
                  }

                  if (reopenedBcIds.length > 0) {
                    console.log(
                      `🧹 [Basecamp Sync] Self-healing: Re-opening ${reopenedBcIds.length} tasks for list ${list.name || list.title}:`,
                      reopenedBcIds
                    )
                    const nowIso = new Date().toISOString()
                    for (const chunk of chunkArray(reopenedBcIds)) {
                      await supabase
                        .from('bc_todos')
                        .update({ is_completed: false, completed_at: null, updated_at: nowIso })
                        .eq('todolist_id', todolistUuid)
                        .in('bc_id', chunk)
                    }
                  }
                }

                // Keep bc_todolists completed_count & total_count 100% aligned with exact DB counts
                await syncTodolistCounts(supabase, todolistUuid)
              }
            } catch (todosErr: any) {
              counters.errors.push(`Todos fetch for list ${list.id}: ${todosErr.message}`)
            }
          }
        } catch (err: any) {
          counters.errors.push(`TodoSet for project ${project.id}: ${err.message}`)
        }
      }

      // ---- MESSAGE BOARD → MESSAGES ----
      const messageBoardDock = findDock(project, 'message_board')
      if (messageBoardDock) {
        try {
          const boardId = extractDockId(messageBoardDock.url)
          
          // Upsert the message board container
          const { data: dbBoard, error: boardErr } = await supabase
            .from('bc_message_boards')
            .upsert({
              bc_id: boardId,
              project_id: projectUuid,
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (boardErr) {
            throw boardErr
          }

          const boardUuid = dbBoard.id
          messageBoardsMap[boardId] = boardUuid
          counters.message_boards++

          const messages = await fetchMessages(project.id, boardId)
          console.log(`   📬 Found ${messages.length} messages`)

          for (const m of messages) {
            const msgUpdatedAt = m.updated_at || m.created_at
            const msgUpdatedMs = msgUpdatedAt ? new Date(msgUpdatedAt).getTime() : Infinity
            const existingMsg = existingMsgByBcId.get(Number(m.id))
            const hasMsgDelta =
              !existingMsg ||
              Number(existingMsg.comments_count || 0) !== Number(m.comments_count || 0) ||
              (existingMsg.title || '') !== (m.subject || m.title || '')

            const isUnchanged = !forceFullSync && lastSyncMs > 0 && !hasMsgDelta && msgUpdatedMs <= lastSyncMs

            if (isUnchanged) {
              counters.messages++
              continue
            }

            const rawMsgContent = await processHtmlContent(
              m.content || '',
              token,
              'messages',
              m.id,
              supabase,
              urlCache
            )
            const { cleanHtml: processedMsgContent, extractedAuthorName: extractedMsgAuthor } =
              stripTegAuthorBanner(rawMsgContent)
            const finalMsgAuthorUuid = await resolveSyncedAuthorUuid({
              extractedAuthorName: extractedMsgAuthor,
              existingAuthorUuid: existingMsg?.author_person_id || null,
              bcCreator: m.creator,
              allPeopleList: allKnownPeopleList,
              supabase,
              peopleMap,
            })
            const { data: dbMsg, error: msgErr } = await supabase
              .from('bc_messages')
              .upsert(
                {
                  bc_id: m.id,
                  project_id: projectUuid,
                  board_id: boardUuid,
                  title: m.subject || m.title,
                  content: processedMsgContent,
                  category: m.category?.name || 'General',
                  author_person_id: finalMsgAuthorUuid,
                  comments_count: m.comments_count || 0,
                  created_at: m.created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'bc_id' }
              )
              .select('id')
              .single()

            if (msgErr) {
              counters.errors.push(`Message ${m.id}: ${msgErr.message}`)
              continue
            }

            const messageUuid = dbMsg.id
            messagesMap[m.id] = messageUuid
            counters.messages++
            hasContentMutations = true

            // Sync comments on message (scoped by parent_id to avoid 1,000-row cap)
            if (m.comments_count > 0) {
              try {
                const [comments, { data: existingMsgComments }] = await Promise.all([
                  fetchComments(project.id, m.id),
                  supabase.from('bc_comments').select('bc_id, author_person_id').eq('parent_id', messageUuid),
                ])
                const existingComAuthorMap = new Map<number, string>()
                for (const ec of existingMsgComments || []) {
                  if (ec.bc_id && ec.author_person_id) {
                    existingComAuthorMap.set(Number(ec.bc_id), ec.author_person_id)
                  }
                }

                const commentRows = []
                for (const c of comments) {
                  const rawCommentContent = await processHtmlContent(
                    c.content || '',
                    token,
                    'comments',
                    c.id,
                    supabase,
                    urlCache
                  )
                  const { cleanHtml: processedCommentContent, extractedAuthorName: extractedCommentAuthor } =
                    stripTegAuthorBanner(rawCommentContent)
                  const finalCommentAuthorUuid = await resolveSyncedAuthorUuid({
                    extractedAuthorName: extractedCommentAuthor,
                    existingAuthorUuid: existingComAuthorMap.get(Number(c.id)) || null,
                    bcCreator: c.creator,
                    allPeopleList: allKnownPeopleList,
                    supabase,
                    peopleMap,
                  })
                  commentRows.push({
                    bc_id: c.id,
                    project_id: projectUuid,
                    parent_type: 'message',
                    parent_id: messageUuid,
                    content: processedCommentContent,
                    author_person_id: finalCommentAuthorUuid,
                    created_at: c.created_at || new Date().toISOString(),
                  })
                }

                if (commentRows.length > 0) {
                  const { error: comErr } = await supabase
                    .from('bc_comments')
                    .upsert(commentRows, { onConflict: 'bc_id' })

                  if (comErr) {
                    console.error(`      ❌ comments error for message ${m.id}:`, comErr.message)
                  } else {
                    counters.comments += comments.length
                  }
                }
              } catch (comFetchErr: any) {
                console.warn(`      ⚠️ comments fetch error for message ${m.id}:`, comFetchErr.message)
              }
            }
          }
        } catch (err: any) {
          counters.errors.push(`MessageBoard for project ${project.id}: ${err.message}`)
        }
      }

      // ---- CAMPFIRE (CHAT) → LINES ----
      const campfireDock = findDock(project, 'chat')
      if (campfireDock) {
        try {
          const campfireId = extractDockId(campfireDock.url)
          
          // Upsert the campfire container
          const { data: dbCampfire, error: campErr } = await supabase
            .from('bc_campfires')
            .upsert({
              bc_id: campfireId,
              project_id: projectUuid,
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (campErr) {
            throw campErr
          }

          const campfireUuid = dbCampfire.id
          campfiresMap[campfireId] = campfireUuid
          counters.campfires++

          const lines = await fetchCampfireLines(project.id, campfireId)
          console.log(`   🔥 Found ${lines.length} campfire lines`)

          if (lines.length > 0) {
            const existingLineAuthorByBcId = new Map<number, string>()
            for (const chunk of chunkArray(lines.map((l) => l.id))) {
              const { data: existingLines } = await supabase
                .from('bc_campfire_lines')
                .select('bc_id, author_person_id')
                .in('bc_id', chunk)
              for (const el of existingLines || []) {
                if (el.bc_id && el.author_person_id) {
                  existingLineAuthorByBcId.set(Number(el.bc_id), el.author_person_id)
                }
              }
            }

            const lineRows = []
            for (const l of lines) {
              const rawLineContent = await processHtmlContent(
                l.content || '',
                token,
                'campfire',
                l.id,
                supabase,
                urlCache
              )
              const { cleanHtml: processedLineContent, extractedAuthorName: extractedLineAuthor } =
                stripTegAuthorBanner(rawLineContent)
              const finalLineAuthorUuid = await resolveSyncedAuthorUuid({
                extractedAuthorName: extractedLineAuthor,
                existingAuthorUuid: existingLineAuthorByBcId.get(Number(l.id)) || null,
                bcCreator: l.creator,
                allPeopleList: allKnownPeopleList,
                supabase,
                peopleMap,
              })
              lineRows.push({
                bc_id: l.id,
                project_id: projectUuid,
                campfire_id: campfireUuid,
                content: processedLineContent,
                author_person_id: finalLineAuthorUuid,
                created_at: l.created_at || new Date().toISOString(),
              })
            }

            const { error: lineErr } = await supabase
              .from('bc_campfire_lines')
              .upsert(lineRows, { onConflict: 'bc_id' })

            if (lineErr) {
              counters.errors.push(`Campfire lines for project ${project.id}: ${lineErr.message}`)
            } else {
              counters.campfire_lines += lines.length
            }
          }
        } catch (err: any) {
          counters.errors.push(`Campfire for project ${project.id}: ${err.message}`)
        }
      }

      // ---- VAULT (DOCS & FILES / REPORTES) → DOCUMENTS + UPLOADS (RECURSIVAMENTE) ----
      const vaultDocks = project.dock?.filter((d) => d.name === 'vault' && d.enabled) || []
      console.log(`   📂 Found ${vaultDocks.length} root vault(s) in dock`)

      for (const vaultDock of vaultDocks) {
        try {
          const vaultId = extractDockId(vaultDock.url)
          console.log(`   📁 Syncing root vault: "${vaultDock.title || vaultDock.name}" (bc_id: ${vaultId})`)
          
          // Upsert the root vault container
          const { data: dbVault, error: vaultErr } = await supabase
            .from('bc_vaults')
            .upsert({
              bc_id: vaultId,
              project_id: projectUuid,
              name: vaultDock.title || vaultDock.name || 'Docs & Files',
              parent_vault_id: null
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (vaultErr) {
            throw vaultErr
          }

          const vaultUuid = dbVault.id
          vaultsMap[vaultId] = vaultUuid
          counters.vaults++

          // Sync recursively!
          await syncVaultContents(project.id, projectUuid, vaultId, vaultUuid)
        } catch (err: any) {
          counters.errors.push(`Vault ${vaultDock.title || vaultDock.name} for project ${project.id}: ${err.message}`)
        }
      }

      // ---- SCHEDULE → ENTRIES ----
      const scheduleDock = findDock(project, 'schedule')
      if (scheduleDock) {
        try {
          const scheduleId = extractDockId(scheduleDock.url)
          
          // Upsert the schedule container
          const { data: dbSchedule, error: schedErr } = await supabase
            .from('bc_schedules')
            .upsert({
              bc_id: scheduleId,
              project_id: projectUuid,
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (schedErr) {
            throw schedErr
          }

          const scheduleUuid = dbSchedule.id
          schedulesMap[scheduleId] = scheduleUuid
          counters.schedules++

          const entries = await fetchScheduleEntries(project.id, scheduleId)
          console.log(`   📅 Found ${entries.length} schedule entries`)

          if (entries.length > 0) {
            const existingEntryAuthorByBcId = new Map<number, string>()
            for (const chunk of chunkArray(entries.map((e) => e.id))) {
              const { data: existingEntries } = await supabase
                .from('bc_schedule_entries')
                .select('bc_id, author_person_id')
                .in('bc_id', chunk)
              for (const ee of existingEntries || []) {
                if (ee.bc_id && ee.author_person_id) {
                  existingEntryAuthorByBcId.set(Number(ee.bc_id), ee.author_person_id)
                }
              }
            }

            const eventRows = []
            for (const e of entries) {
              const rawEventDesc = await processHtmlContent(
                e.description || '',
                token,
                'schedules',
                e.id,
                supabase,
                urlCache
              )
              const { cleanHtml: processedEventDesc, extractedAuthorName: extractedEntryAuthor } =
                stripTegAuthorBanner(rawEventDesc)
              const finalEntryAuthorUuid = await resolveSyncedAuthorUuid({
                extractedAuthorName: extractedEntryAuthor,
                existingAuthorUuid: existingEntryAuthorByBcId.get(Number(e.id)) || null,
                bcCreator: e.creator,
                allPeopleList: allKnownPeopleList,
                supabase,
                peopleMap,
              })
              eventRows.push({
                bc_id: e.id,
                project_id: projectUuid,
                schedule_id: scheduleUuid,
                title: e.summary || e.title,
                description: processedEventDesc,
                starts_at: e.starts_at || null,
                ends_at: e.ends_at || null,
                all_day: e.all_day || false,
                author_person_id: finalEntryAuthorUuid,
                updated_at: new Date().toISOString(),
              })
            }

            const { error: evtErr } = await supabase
              .from('bc_schedule_entries')
              .upsert(eventRows, { onConflict: 'bc_id' })

            if (evtErr) {
              counters.errors.push(`Schedule for project ${project.id}: ${evtErr.message}`)
            } else {
              counters.schedule_entries += entries.length
            }
          }
        } catch (err: any) {
          counters.errors.push(`Schedule for project ${project.id}: ${err.message}`)
        }
      }

      // ---- QUESTIONNAIRE (CHECK-INS) → QUESTIONS → ANSWERS ----
      const questionnaireDock = findDock(project, 'questionnaire')
      if (questionnaireDock) {
        try {
          const questionnaireId = extractDockId(questionnaireDock.url)
          
          // Upsert the questionnaire container
          const { data: dbQuestionnaire, error: questErr } = await supabase
            .from('bc_questionnaires')
            .upsert({
              bc_id: questionnaireId,
              project_id: projectUuid,
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (questErr) {
            throw questErr
          }

          const questionnaireUuid = dbQuestionnaire.id
          questionnairesMap[questionnaireId] = questionnaireUuid
          counters.questionnaires++

          const questions = await fetchQuestions(project.id, questionnaireId)
          console.log(`   ❓ Found ${questions.length} check-in questions`)

          for (const q of questions) {
            const { data: dbQ, error: qErr } = await supabase
              .from('bc_questions')
              .upsert(
                {
                  bc_id: q.id,
                  project_id: projectUuid,
                  questionnaire_id: questionnaireUuid,
                  title: q.title,
                  schedule_text: formatQuestionScheduleText(q),
                  is_paused: q.paused || false,
                },
                { onConflict: 'bc_id' }
              )
              .select('id')
              .single()

            if (qErr) {
              counters.errors.push(`Question ${q.id}: ${qErr.message}`)
              continue
            }
            
            const questionUuid = dbQ.id
            questionsMap[q.id] = questionUuid
            counters.questions++

            // Fetch answers for this question
            try {
              const answers = await fetchAnswers(project.id, q.id)

              if (answers.length > 0) {
                const { data: existingAnswers } = await supabase
                  .from('bc_answers')
                  .select('bc_id, author_person_id')
                  .eq('question_id', questionUuid)
                const existingAnswerAuthorByBcId = new Map<number, string>()
                for (const ea of existingAnswers || []) {
                  if (ea.bc_id && ea.author_person_id) {
                    existingAnswerAuthorByBcId.set(Number(ea.bc_id), ea.author_person_id)
                  }
                }

                const answerRows = []
                for (const a of answers) {
                  const rawAnswerContent = await processHtmlContent(
                    a.content || '',
                    token,
                    'answers',
                    a.id,
                    supabase,
                    urlCache
                  )
                  const { cleanHtml: processedAnswerContent, extractedAuthorName: extractedAnswerAuthor } =
                    stripTegAuthorBanner(rawAnswerContent)
                  const finalAnswerAuthorUuid = await resolveSyncedAuthorUuid({
                    extractedAuthorName: extractedAnswerAuthor,
                    existingAuthorUuid: existingAnswerAuthorByBcId.get(Number(a.id)) || null,
                    bcCreator: a.creator,
                    allPeopleList: allKnownPeopleList,
                    supabase,
                    peopleMap,
                  })
                  answerRows.push({
                    bc_id: a.id,
                    project_id: projectUuid,
                    question_id: questionUuid,
                    content: processedAnswerContent,
                    author_person_id: finalAnswerAuthorUuid,
                    created_at: a.created_at || new Date().toISOString(),
                  })
                }

                const { error: ansErr } = await supabase
                  .from('bc_answers')
                  .upsert(answerRows, { onConflict: 'bc_id' })

                if (ansErr) {
                  counters.errors.push(`Answers for Q${q.id}: ${ansErr.message}`)
                } else {
                  counters.answers += answers.length
                }
              }
            } catch (ansErr: any) {
              counters.errors.push(`Answers fetch for Q${q.id}: ${ansErr.message}`)
            }
          }
        } catch (err: any) {
          counters.errors.push(`Questionnaire for project ${project.id}: ${err.message}`)
        }
      }
    }

    // ================================================================
    // FINALIZE — Update Sync Log
    // ================================================================
    const durationMs = Date.now() - startTime
    const totalRecords =
      counters.people +
      counters.projects +
      counters.memberships +
      counters.todosets +
      counters.todolists +
      counters.todos +
      counters.todo_assignees +
      counters.message_boards +
      counters.messages +
      counters.comments +
      counters.campfires +
      counters.campfire_lines +
      counters.vaults +
      counters.documents +
      counters.uploads +
      counters.schedules +
      counters.schedule_entries +
      counters.questionnaires +
      counters.questions +
      counters.answers

    const syncStatus = counters.errors.length > 0 ? 'completed_with_errors' : 'completed'

    if (syncLogId) {
      await supabase
        .from('bc_sync_log')
        .update({
          status: syncStatus,
          completed_at: new Date().toISOString(),
          records_synced: totalRecords,
          error_message: counters.errors.length > 0 ? `${counters.errors.length} sync errors occurred.` : null,
        })
        .eq('id', syncLogId)
    }

    console.log(
      `\n✅ [Basecamp Sync] Completed in ${(durationMs / 1000).toFixed(1)}s. ` +
        `Total records: ${totalRecords}. Errors: ${counters.errors.length}`
    )

    // Gate background media attachment ILIKE scans via Next.js after():
    // run only when projects/content changed OR at most once per hour (top-of-hour tick for internal cron)
    const hasProjectOrContentChanges =
      forceFullSync ||
      changedProjectIds === null ||
      changedProjectIds.size > 0 ||
      hasContentMutations
    const hourlySweepDue =
      Date.now() - lastBgDownloaderRunAt >= BG_DOWNLOADER_COOLDOWN_MS &&
      (!isInternalCron || laMinute < 30)

    if (hasProjectOrContentChanges || hourlySweepDue) {
      lastBgDownloaderRunAt = Date.now()
      after(async () => {
        try {
          await triggerBackgroundAttachmentDownloader(supabase, token)
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('⚠️ [Basecamp Sync] Background downloader error:', message)
        }
      })
    } else {
      console.log('⏭️ [Basecamp Sync] Skipping background attachment ILIKE scans (no changes & hourly sweep not due)')
    }

    return NextResponse.json({
      success: true,
      status: syncStatus,
      duration_ms: durationMs,
      total_records: totalRecords,
      details: {
        people: counters.people,
        projects: counters.projects,
        memberships: counters.memberships,
        todosets: counters.todosets,
        todolists: counters.todolists,
        todos: counters.todos,
        todo_assignees: counters.todo_assignees,
        message_boards: counters.message_boards,
        messages: counters.messages,
        comments: counters.comments,
        campfires: counters.campfires,
        campfire_lines: counters.campfire_lines,
        vaults: counters.vaults,
        documents: counters.documents,
        uploads: counters.uploads,
        schedules: counters.schedules,
        schedule_entries: counters.schedule_entries,
        questionnaires: counters.questionnaires,
        questions: counters.questions,
        answers: counters.answers,
      },
      errors: counters.errors.length > 0 ? counters.errors : undefined,
      synced_at: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('💥 [Basecamp Sync] Critical error:', error.message)

    // Update sync log with failure
    if (syncLogId) {
      await supabase
        .from('bc_sync_log')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message,
        })
        .eq('id', syncLogId)
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        partial_results: counters,
      },
      { status: 500 }
    )
  }
}

/**
 * Background worker that processes and downloads attachments asynchronously (non-blocking)
 * in order of newest to oldest created_at.
 */
async function triggerBackgroundAttachmentDownloader(supabase: any, token: string) {
  console.log('🚀 [Basecamp Background Downloader] Started processing pending attachments...')

  // 1. Process bc_comments (newest to oldest)
  try {
    const { data: comments } = await supabase
      .from('bc_comments')
      .select('id, content, created_at')
      .or('content.ilike.%/blobs/%,content.ilike.%preview.app.basecamp.com%,content.ilike.%storage.app.basecamp.com%')
      .order('created_at', { ascending: false })
      .limit(40)

    if (comments && comments.length > 0) {
      console.log(`   [Background Downloader] Found ${comments.length} comments with pending attachments`)
      for (const comment of comments) {
        const updatedContent = await downloadAndUploadPendingHtmlAttachments(comment.content, token, 'comments', comment.id, supabase)
        if (updatedContent !== comment.content) {
          await supabase
            .from('bc_comments')
            .update({ content: updatedContent })
            .eq('id', comment.id)
        }
      }
    }
  } catch (err: any) {
    console.error('   ❌ Error processing background comments:', err.message)
  }

  // 2. Process bc_todos (newest to oldest)
  try {
    const { data: todos } = await supabase
      .from('bc_todos')
      .select('id, description, bc_id, created_at')
      .or('description.ilike.%/blobs/%,description.ilike.%preview.app.basecamp.com%,description.ilike.%storage.app.basecamp.com%')
      .order('created_at', { ascending: false })
      .limit(30)

    if (todos && todos.length > 0) {
      console.log(`   [Background Downloader] Found ${todos.length} todos with pending attachments`)
      for (const todo of todos) {
        const updatedDesc = await downloadAndUploadPendingHtmlAttachments(todo.description || '', token, 'todos', todo.id, supabase)
        if (updatedDesc !== todo.description) {
          await supabase
            .from('bc_todos')
            .update({ description: updatedDesc })
            .eq('id', todo.id)
        }
      }
    }
  } catch (err: any) {
    console.error('   ❌ Error processing background todos:', err.message)
  }

  // 3. Process bc_documents (newest to oldest)
  try {
    const { data: docs } = await supabase
      .from('bc_documents')
      .select('id, content, created_at')
      .or('content.ilike.%/blobs/%,content.ilike.%preview.app.basecamp.com%,content.ilike.%storage.app.basecamp.com%')
      .order('created_at', { ascending: false })
      .limit(20)

    if (docs && docs.length > 0) {
      console.log(`   [Background Downloader] Found ${docs.length} documents with pending attachments`)
      for (const doc of docs) {
        const updatedContent = await downloadAndUploadPendingHtmlAttachments(doc.content, token, 'documents', doc.id, supabase)
        if (updatedContent !== doc.content) {
          await supabase
            .from('bc_documents')
            .update({ content: updatedContent })
            .eq('id', doc.id)
        }
      }
    }
  } catch (err: any) {
    console.error('   ❌ Error processing background docs:', err.message)
  }

  // 4. Process bc_messages (newest to oldest)
  try {
    const { data: messages } = await supabase
      .from('bc_messages')
      .select('id, content, created_at')
      .or('content.ilike.%/blobs/%,content.ilike.%preview.app.basecamp.com%,content.ilike.%storage.app.basecamp.com%')
      .order('created_at', { ascending: false })
      .limit(20)

    if (messages && messages.length > 0) {
      console.log(`   [Background Downloader] Found ${messages.length} messages with pending attachments`)
      for (const msg of messages) {
        const updatedContent = await downloadAndUploadPendingHtmlAttachments(msg.content || '', token, 'messages', msg.id, supabase)
        if (updatedContent !== msg.content) {
          await supabase
            .from('bc_messages')
            .update({ content: updatedContent })
            .eq('id', msg.id)
        }
      }
    }
  } catch (err: any) {
    console.error('   ❌ Error processing background messages:', err.message)
  }

  // 5. Process bc_answers (newest to oldest)
  try {
    const { data: answers } = await supabase
      .from('bc_answers')
      .select('id, content, created_at')
      .or('content.ilike.%/blobs/%,content.ilike.%preview.app.basecamp.com%,content.ilike.%storage.app.basecamp.com%')
      .order('created_at', { ascending: false })
      .limit(20)

    if (answers && answers.length > 0) {
      console.log(`   [Background Downloader] Found ${answers.length} answers with pending attachments`)
      for (const ans of answers) {
        const updatedContent = await downloadAndUploadPendingHtmlAttachments(ans.content || '', token, 'answers', ans.id, supabase)
        if (updatedContent !== ans.content) {
          await supabase
            .from('bc_answers')
            .update({ content: updatedContent })
            .eq('id', ans.id)
        }
      }
    }
  } catch (err: any) {
    console.error('   ❌ Error processing background answers:', err.message)
  }

  // 6. Process bc_campfire_lines (newest to oldest)
  try {
    const { data: lines } = await supabase
      .from('bc_campfire_lines')
      .select('id, content, created_at')
      .or('content.ilike.%/blobs/%,content.ilike.%preview.app.basecamp.com%,content.ilike.%storage.app.basecamp.com%')
      .order('created_at', { ascending: false })
      .limit(20)

    if (lines && lines.length > 0) {
      console.log(`   [Background Downloader] Found ${lines.length} campfire lines with pending attachments`)
      for (const line of lines) {
        const updatedContent = await downloadAndUploadPendingHtmlAttachments(line.content || '', token, 'campfire', line.id, supabase)
        if (updatedContent !== line.content) {
          await supabase
            .from('bc_campfire_lines')
            .update({ content: updatedContent })
            .eq('id', line.id)
        }
      }
    }
  } catch (err: any) {
    console.error('   ❌ Error processing background campfire lines:', err.message)
  }

  console.log('✅ [Basecamp Background Downloader] Finished batch processing.')
}

/**
 * Downloads and uploads pending html attachments, saving mapped URLs to cache.
 */
async function downloadAndUploadPendingHtmlAttachments(
  html: string,
  token: string,
  targetFolder: string,
  parentId: number | string,
  supabase: any
): Promise<string> {
  // 1. Heal any <bc-attachment> tags where `url` is already a Supabase URL but `href` still points to Basecamp
  const healed = healPartiallyMigratedBcAttachmentHrefs(html)
  let updatedHtml = healed.html
  if (healed.repairedPairs.length > 0) {
    const repairUrls = healed.repairedPairs.map((pair) => pair.basecamp_url)
    const { data: existingCacheRows } = await supabase
      .from('bc_attachment_cache')
      .select('basecamp_url, supabase_url')
      .in('basecamp_url', repairUrls)

    const existingCacheMap = new Map<string, string>()
    for (const row of existingCacheRows || []) {
      existingCacheMap.set(row.basecamp_url, row.supabase_url)
    }

    const pairsToUpsert = healed.repairedPairs.filter(
      (pair) => existingCacheMap.get(pair.basecamp_url) !== pair.supabase_url
    )

    if (pairsToUpsert.length > 0) {
      await supabase
        .from('bc_attachment_cache')
        .upsert(pairsToUpsert, { onConflict: 'basecamp_url' })
    }
  }

  // 2. Parse remaining external Basecamp attachments
  const attachments = parseHtmlAttachments(updatedHtml)
  if (attachments.length === 0) return updatedHtml

  for (const att of attachments) {
    const localUrl = await downloadAndUploadAttachment(
      token,
      att.url,
      att.filename,
      att.contentType,
      targetFolder,
      parentId,
      supabase,
      att.secondaryUrl
    )
    if (localUrl) {
      updatedHtml = updatedHtml.replaceAll(att.url, localUrl)
      if (att.secondaryUrl) {
        updatedHtml = updatedHtml.replaceAll(att.secondaryUrl, localUrl)
      }
    }
  }
  return updatedHtml
}
