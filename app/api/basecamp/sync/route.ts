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
 * - People y Projects SIEMPRE se sincronizan (son 1-2 API calls, rápido).
 * - Per-project resources solo se sincronizan si el proyecto cambió desde el último sync exitoso.
 * - Los dock IDs se extraen dinámicamente del proyecto.
 * - El sync principal no bloquea en descargas de medios. Si no están en caché (`bc_attachment_cache`),
 *   se deja la URL original de Basecamp temporalmente y se procesan en segundo plano por el worker.
 */

import { NextResponse } from 'next/server'
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
  type BasecampProject,
} from '@/lib/basecamp-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutos máximo para Vercel

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
  supabase: any
): Promise<string | null> {
  try {
    // 1. Check database cache first to avoid duplicate downloads/uploads
    const { data: cached } = await supabase
      .from('bc_attachment_cache')
      .select('supabase_url')
      .eq('basecamp_url', basecampUrl)
      .maybeSingle()

    if (cached?.supabase_url) {
      console.log(`      ⚡ Attachment cache hit: ${filename}`)
      return cached.supabase_url
    }

    let targetUrl = basecampUrl.replace('preview.app.basecamp.com', '3.basecampapi.com')
    targetUrl = targetUrl.replace('storage.app.basecamp.com', '3.basecampapi.com')

    const res = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)',
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
    const filePath = `basecamp-attachments/${targetFolder}/${id}/${Date.now()}-${safeFilename}`

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
      // 2. Save mapping to database cache for future runs
      await supabase
        .from('bc_attachment_cache')
        .upsert({
          basecamp_url: basecampUrl,
          supabase_url: publicUrl
        }, { onConflict: 'basecamp_url' })
    }

    return publicUrl
  } catch (err: any) {
    console.error(`  ⚠️ Failed to migrate attachment: ${filename}. Error: ${err.message}`)
    return null
  }
}

interface HtmlAttachment {
  contentType: string
  filename: string
  url: string
  rawMatch: string
  isTag: boolean
}

function parseHtmlAttachments(html: string): HtmlAttachment[] {
  const attachments: HtmlAttachment[] = []
  if (!html) return attachments

  // 1. bc-attachment tags
  const bcAttachmentRegex = /<bc-attachment\s+([^>]+)>([\s\S]*?)<\/bc-attachment>/gi
  let match: RegExpExecArray | null
  while ((match = bcAttachmentRegex.exec(html)) !== null) {
    const attrsStr = match[1]
    const getAttr = (name: string) => {
      const m = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
      return m ? m[1] : null
    }
    const contentType = getAttr('content-type') || ''
    const filename = getAttr('filename') || 'attachment'
    const href = getAttr('href') || ''
    const url = getAttr('url') || href || ''
    if (url && (url.includes('basecamp') || url.includes('blobs'))) {
      attachments.push({ contentType, filename, url, rawMatch: match[0], isTag: true })
    }
  }

  // 2. img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let imgMatch: RegExpExecArray | null
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const src = imgMatch[1]
    if (src && (src.includes('basecamp') || src.includes('blobs'))) {
      const isAlreadyCaptured = attachments.some((a) => a.url === src)
      if (!isAlreadyCaptured) {
        let filename = 'image.png'
        const altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i)
        if (altMatch) filename = altMatch[1]
        attachments.push({
          contentType: 'image/png',
          filename,
          url: src,
          rawMatch: imgMatch[0],
          isTag: false,
        })
      }
    }
  }

  return attachments
}

async function processHtmlContent(
  html: string,
  token: string,
  targetFolder: string,
  parentId: number | string,
  supabase: any,
  urlCache: Map<string, string>
): Promise<string> {
  if (!html || (!html.includes('basecamp') && !html.includes('blobs'))) {
    return html
  }

  const attachments = parseHtmlAttachments(html)
  if (attachments.length === 0) return html

  let updatedHtml = html
  for (const att of attachments) {
    let localUrl = urlCache.get(att.url)
    if (!localUrl) {
      // 1. Resolve strictly from database cache. NO blocking downloads during main sync.
      const { data: cached } = await supabase
        .from('bc_attachment_cache')
        .select('supabase_url')
        .eq('basecamp_url', att.url)
        .maybeSingle()

      if (cached?.supabase_url) {
        localUrl = cached.supabase_url
        urlCache.set(att.url, cached.supabase_url)
      }
    }
    if (localUrl) {
      updatedHtml = updatedHtml.replaceAll(att.url, localUrl as string)
    }
  }

  return updatedHtml
}

async function resolveOrCreatePerson(
  creator: any,
  supabase: any,
  peopleMap: Record<number, string>
): Promise<string | null> {
  if (!creator || !creator.id) return null
  const creatorId = Number(creator.id)
  
  if (peopleMap[creatorId]) {
    return peopleMap[creatorId]
  }
  
  const { data: dbPerson } = await supabase
    .from('bc_people')
    .select('id')
    .eq('bc_id', creatorId)
    .maybeSingle()
    
  if (dbPerson) {
    peopleMap[creatorId] = dbPerson.id
    return dbPerson.id
  }
  
  console.log(`👤 [Basecamp Sync] Dynamically inserting missing person: ${creator.name || 'Unknown'} (bc_id: ${creatorId})`)
  try {
    const { data: newPerson, error: pErr } = await supabase
      .from('bc_people')
      .insert({
        bc_id: creatorId,
        name: creator.name || 'Unknown',
        email: creator.email_address || '',
        avatar_url: creator.avatar_url || '',
        role: creator.employee ? 'employee' : creator.client ? 'client' : 'user',
        title: creator.title || '',
        is_active: true
      })
      .select('id')
      .maybeSingle()
      
    if (!pErr && newPerson) {
      peopleMap[creatorId] = newPerson.id
      return newPerson.id
    } else if (pErr) {
      // Conflict: another async loop just inserted this person — look it up
      console.warn(`      ⚠️ Insert conflict for person ${creator.name}, looking up existing...`)
      const { data: conflictPerson } = await supabase
        .from('bc_people')
        .select('id')
        .eq('bc_id', creatorId)
        .maybeSingle()
      if (conflictPerson) {
        peopleMap[creatorId] = conflictPerson.id
        return conflictPerson.id
      }
    }
  } catch (err: any) {
    console.warn(`      ⚠️ Exception inserting missing person ${creator.name}:`, err.message)
  }
  
  return null
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mockRequest = new Request(request.url, {
    method: 'POST',
    body: JSON.stringify({ full: false }),
    headers: { 'Content-Type': 'application/json' },
  })

  return POST(mockRequest)
}

export async function POST(request: Request) {
  const supabase = getSyncClient()
  const counters = createCounters()
  const startTime = Date.now()

  // Parse request body for options
  let forceFullSync = false
  try {
    const body = await request.json().catch(() => ({}))
    forceFullSync = body?.full === true
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
  if (!forceFullSync) {
    const { data: lastSync } = await supabase
      .from('bc_sync_log')
      .select('started_at')
      .in('status', ['completed', 'completed_with_errors'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    lastSyncAt = lastSync?.started_at || null
  }

  const syncMode = lastSyncAt ? 'incremental' : 'full'

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
    // STEP 1: SYNC PEOPLE
    // ================================================================
    console.log('👥 [Basecamp Sync] Step 1: Syncing people...')
    try {
      const people = await fetchPeople()
      console.log(`   Found ${people.length} people`)

      if (people.length > 0) {
        const peopleRows = people.map((p) => ({
          bc_id: p.id,
          name: p.name,
          email: p.email_address,
          avatar_url: p.avatar_url,
          role: p.employee ? 'employee' : p.client ? 'client' : 'user',
          title: p.title || '',
          is_active: p.status !== 'archived',
          updated_at: new Date().toISOString(),
        }))

        const { data: insertedPeople, error: upsertErr } = await supabase
          .from('bc_people')
          .upsert(peopleRows, { onConflict: 'bc_id' })
          .select('id, bc_id')

        if (upsertErr) {
          console.error('   ❌ People upsert error:', upsertErr.message)
          counters.errors.push(`People: ${upsertErr.message}`)
        } else if (insertedPeople) {
          counters.people = insertedPeople.length
          console.log(`   ✅ ${insertedPeople.length} people synced`)
        }
      }

      // Populate memory map for people UUIDs
      const { data: dbPeople } = await supabase.from('bc_people').select('id, bc_id').limit(10000)
      if (dbPeople) {
        dbPeople.forEach((p) => {
          peopleMap[Number(p.bc_id)] = p.id
        })
      }
    } catch (err: any) {
      console.error('   ❌ People sync failed:', err.message)
      counters.errors.push(`People: ${err.message}`)
    }

    // ================================================================
    // STEP 2: SYNC PROJECTS
    // ================================================================
    console.log('📂 [Basecamp Sync] Step 2: Syncing projects...')
    let projects: BasecampProject[] = []
    // Map of project bc_id → Basecamp API updated_at (to detect changes)
    const projectApiUpdatedAt: Record<number, string> = {}
    try {
      projects = await fetchProjects()
      console.log(`   Found ${projects.length} projects`)

      // Store API updated_at for incremental comparison
      for (const p of projects) {
        projectApiUpdatedAt[p.id] = p.updated_at || ''
      }

      // Fetch existing projects to preserve user custom colors and pins
      const { data: existingProjects } = await supabase
        .from('bc_projects')
        .select('bc_id, color, is_pinned')
        .limit(1000)

      const existingColorMap = new Map<number, string>()
      const existingPinMap = new Map<number, boolean>()
      if (existingProjects) {
        for (const ep of existingProjects) {
          existingColorMap.set(Number(ep.bc_id), ep.color || 'white')
          existingPinMap.set(Number(ep.bc_id), ep.is_pinned || false)
        }
      }

      if (projects.length > 0) {
        const projectRows = projects.map((p) => {
          const epId = Number(p.id)
          const existingColor = existingColorMap.get(epId) || 'white'
          const existingPin = existingPinMap.has(epId) ? existingPinMap.get(epId) : (p.bookmarked || false)

          return {
            bc_id: p.id,
            name: p.name,
            description: p.description || '',
            color: existingColor,
            is_pinned: existingPin,
            is_archived: p.status === 'archived',
            member_count: 0, // Will be computed or updated later
            updated_at: new Date().toISOString(),
          }
        })

        const { data: insertedProjects, error: upsertErr } = await supabase
          .from('bc_projects')
          .upsert(projectRows, { onConflict: 'bc_id' })
          .select('id, bc_id')

        if (upsertErr) {
          console.error('   ❌ Projects upsert error:', upsertErr.message)
          counters.errors.push(`Projects: ${upsertErr.message}`)
        } else if (insertedProjects) {
          counters.projects = insertedProjects.length
          console.log(`   ✅ ${insertedProjects.length} projects synced`)
        }
      }

      // Populate memory map for projects UUIDs
      const { data: dbProjects } = await supabase.from('bc_projects').select('id, bc_id').limit(10000)
      if (dbProjects) {
        dbProjects.forEach((p) => {
          projectsMap[Number(p.bc_id)] = p.id
        })
      }
    } catch (err: any) {
      console.error('   ❌ Projects sync failed:', err.message)
      counters.errors.push(`Projects: ${err.message}`)
    }

    // ================================================================
    // INCREMENTAL FILTER: Determine which projects need full resource sync
    // ================================================================
    let changedProjectIds: Set<number> | null = null // null = sync all (full mode)

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
        for (const d of docs) {
          const docUpdatedAt = d.updated_at || d.created_at
          const isUnchanged = !forceFullSync && lastSyncAt && docUpdatedAt && docUpdatedAt <= lastSyncAt

          if (isUnchanged) {
            counters.documents++
            continue
          }

          const authorUuid = await resolveOrCreatePerson(d.creator, supabase, peopleMap)
          const processedContent = await processHtmlContent(d.content || '', token, 'documents', d.id, supabase, urlCache)

          const { data: dbDoc, error: docErr } = await supabase
            .from('bc_documents')
            .upsert({
              bc_id: d.id,
              project_id: projectUuid,
              vault_id: vaultUuid,
              title: d.title,
              content: processedContent,
              author_person_id: authorUuid,
              created_at: d.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (docErr) {
            counters.errors.push(`Document ${d.id}: ${docErr.message}`)
            continue
          }

          const docUuid = dbDoc.id
          documentsMap[d.id] = docUuid
          counters.documents++

          // Sync comments on document
          if (d.comments_count > 0) {
            try {
              const comments = await fetchComments(projectId, d.id)
              const commentRows = []
              for (const c of comments) {
                const processedCommentContent = await processHtmlContent(c.content || '', token, 'comments', c.id, supabase, urlCache)
                commentRows.push({
                  bc_id: c.id,
                  project_id: projectUuid,
                  parent_type: 'document',
                  parent_id: docUuid,
                  content: processedCommentContent,
                  author_person_id: await resolveOrCreatePerson(c.creator, supabase, peopleMap),
                  created_at: c.created_at || new Date().toISOString(),
                })
              }

              await supabase.from('bc_comments').upsert(commentRows, { onConflict: 'bc_id' })
              counters.comments += comments.length
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
          const bcIds = uploads.map((u) => u.id)
          const { data: existingUploads } = await supabase
            .from('bc_uploads')
            .select('bc_id, download_url')
            .in('bc_id', bcIds)

          const existingMap = new Map<number, string>()
          if (existingUploads) {
            existingUploads.forEach((eu: any) => {
              const url = eu.download_url || ''
              if (url.includes('supabase.co') || url.includes('checklist-photos')) {
                existingMap.set(Number(eu.bc_id), url)
              }
            })
          }

          const uploadRows = []
          for (const u of uploads) {
            let finalUrl = existingMap.get(u.id)
            if (!finalUrl && u.download_url) {
              const isBasecampUrl = (u.download_url.includes('basecamp') || u.download_url.includes('blobs')) &&
                !u.download_url.includes('google.com')

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
                }
              }
            }

            uploadRows.push({
              bc_id: u.id,
              project_id: projectUuid,
              vault_id: vaultUuid,
              filename: u.filename || u.title,
              content_type: u.content_type || '',
              byte_size: u.byte_size || 0,
              download_url: finalUrl || u.download_url || '',
              author_person_id: await resolveOrCreatePerson(u.creator, supabase, peopleMap),
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

    for (const project of projects) {
      const projectUuid = projectsMap[project.id]
      if (!projectUuid) {
        console.warn(`⚠️ Skipped project "${project.name}" (bc_id: ${project.id}) - No local project UUID found`)
        continue
      }

      // ALWAYS sync all projects. Reordering/completing tasks in Basecamp does NOT update the project's updated_at timestamp,
      // so skipping projects causes list order and completion mismatches. Individual resources inside the project
      // are still skipped if they are unchanged, ensuring high speed.

      console.log(`\n📁 Processing project: "${project.name}" (bc_id: ${project.id})`)

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

              // Separate active and completed todos
              const activeTodos = todos.filter(t => !t.completed)
              const activeBcIds = activeTodos.map(t => t.id)

              for (const t of todos) {
                const todoUpdatedAt = t.updated_at || t.created_at
                const isUnchanged = !forceFullSync && lastSyncAt && todoUpdatedAt && todoUpdatedAt <= lastSyncAt

                if (isUnchanged) {
                  counters.todos++
                  continue
                }

                const authorUuid = await resolveOrCreatePerson(t.creator, supabase, peopleMap)
                const processedTodoDesc = await processHtmlContent(t.description || '', token, 'todos', t.id, supabase, urlCache)
                const { data: dbTodo, error: todoErr } = await supabase
                  .from('bc_todos')
                  .upsert({
                    bc_id: t.id,
                    project_id: projectUuid,
                    todolist_id: todolistUuid,
                    title: t.content || t.title,
                    description: processedTodoDesc,
                    is_completed: t.completed || false,
                    completed_at: t.completed ? (t.updated_at || new Date().toISOString()) : null,
                    due_date: t.due_on || null,
                    position: t.position,
                    comments_count: t.comments_count || 0,
                    created_by_person_id: authorUuid,
                    created_at: t.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  }, { onConflict: 'bc_id' })
                  .select('id')
                  .single()

                if (todoErr) {
                  counters.errors.push(`Todo ${t.id}: ${todoErr.message}`)
                  continue
                }

                const todoUuid = dbTodo.id
                todosMap[t.id] = todoUuid
                counters.todos++

                // Todo Assignees (N:N)
                if (t.assignees && t.assignees.length > 0) {
                  const assigneeRows = t.assignees
                    .map((a) => {
                      const personUuid = peopleMap[a.id]
                      if (!personUuid) return null
                      return {
                        todo_id: todoUuid,
                        person_id: personUuid,
                      }
                    })
                    .filter((row) => row !== null)

                  if (assigneeRows.length > 0) {
                    const { error: assErr } = await supabase
                      .from('bc_todo_assignees')
                      .upsert(assigneeRows, { onConflict: 'todo_id,person_id' })
                    
                    if (assErr) {
                      console.error(`      ❌ assignees error for todo ${t.id}:`, assErr.message)
                    } else {
                      counters.todo_assignees += assigneeRows.length
                    }
                  }
                }

                // Sync comments on todo
                if (t.comments_count > 0) {
                  try {
                    const comments = await fetchComments(project.id, t.id)
                    const commentRows = []
                    for (const c of comments) {
                      const processedCommentContent = await processHtmlContent(c.content || '', token, 'comments', c.id, supabase, urlCache)
                      commentRows.push({
                        bc_id: c.id,
                        project_id: projectUuid,
                        parent_type: 'todo',
                        parent_id: todoUuid,
                        content: processedCommentContent,
                        author_person_id: await resolveOrCreatePerson(c.creator, supabase, peopleMap),
                        created_at: c.created_at || new Date().toISOString(),
                      })
                    }

                    const { error: comErr } = await supabase
                      .from('bc_comments')
                      .upsert(commentRows, { onConflict: 'bc_id' })

                    if (comErr) {
                      console.error(`      ❌ comments error for todo ${t.id}:`, comErr.message)
                    } else {
                      counters.comments += comments.length
                    }
                  } catch (comFetchErr: any) {
                    console.warn(`      ⚠️ comments fetch error for todo ${t.id}:`, comFetchErr.message)
                  }
                }
              }

              // Self-healing: Reconcile active vs completed tasks
              // Since fetchTodos(project.id, list.id) returns all currently active todos from Basecamp API,
              // any task in Supabase for this list that is marked active but not present in activeBcIds has been completed.
              if (activeBcIds.length > 0 || todos.length > 0) {
                const { data: dbActiveTodos } = await supabase
                  .from('bc_todos')
                  .select('bc_id')
                  .eq('todolist_id', todolistUuid)
                  .eq('is_completed', false)

                if (dbActiveTodos && dbActiveTodos.length > 0) {
                  const dbActiveBcIds = dbActiveTodos.map(t => Number(t.bc_id))
                  const completedBcIds = dbActiveBcIds.filter(bcId => !activeBcIds.includes(bcId))

                  if (completedBcIds.length > 0) {
                    console.log(`🧹 [Basecamp Sync] Self-healing: Marking ${completedBcIds.length} tasks as completed for list ${list.name || list.title}:`, completedBcIds)
                    await supabase
                      .from('bc_todos')
                      .update({ is_completed: true, completed_at: new Date().toISOString() })
                      .eq('todolist_id', todolistUuid)
                      .in('bc_id', completedBcIds)
                  }
                }
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
            const isUnchanged = !forceFullSync && lastSyncAt && msgUpdatedAt && msgUpdatedAt <= lastSyncAt

            if (isUnchanged) {
              counters.messages++
              continue
            }

            const authorUuid = await resolveOrCreatePerson(m.creator, supabase, peopleMap)
            const processedMsgContent = await processHtmlContent(m.content || '', token, 'messages', m.id, supabase, urlCache)
            const { data: dbMsg, error: msgErr } = await supabase
              .from('bc_messages')
              .upsert({
                bc_id: m.id,
                project_id: projectUuid,
                board_id: boardUuid,
                title: m.subject || m.title,
                content: processedMsgContent,
                category: m.category?.name || 'General',
                author_person_id: authorUuid,
                comments_count: m.comments_count || 0,
                created_at: m.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }, { onConflict: 'bc_id' })
              .select('id')
              .single()

            if (msgErr) {
              counters.errors.push(`Message ${m.id}: ${msgErr.message}`)
              continue
            }

            const messageUuid = dbMsg.id
            messagesMap[m.id] = messageUuid
            counters.messages++

            // Sync comments on message
            if (m.comments_count > 0) {
              try {
                const comments = await fetchComments(project.id, m.id)
                const commentRows = []
                for (const c of comments) {
                  const processedCommentContent = await processHtmlContent(c.content || '', token, 'comments', c.id, supabase, urlCache)
                  commentRows.push({
                    bc_id: c.id,
                    project_id: projectUuid,
                    parent_type: 'message',
                    parent_id: messageUuid,
                    content: processedCommentContent,
                    author_person_id: await resolveOrCreatePerson(c.creator, supabase, peopleMap),
                    created_at: c.created_at || new Date().toISOString(),
                  })
                }

                const { error: comErr } = await supabase
                  .from('bc_comments')
                  .upsert(commentRows, { onConflict: 'bc_id' })

                if (comErr) {
                  console.error(`      ❌ comments error for message ${m.id}:`, comErr.message)
                } else {
                  counters.comments += comments.length
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
            const lineRows = []
            for (const l of lines) {
              const processedLineContent = await processHtmlContent(l.content || '', token, 'campfire', l.id, supabase, urlCache)
              lineRows.push({
                bc_id: l.id,
                project_id: projectUuid,
                campfire_id: campfireUuid,
                content: processedLineContent,
                author_person_id: await resolveOrCreatePerson(l.creator, supabase, peopleMap),
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
            const eventRows = []
            for (const e of entries) {
              const processedEventDesc = await processHtmlContent(e.description || '', token, 'schedules', e.id, supabase, urlCache)
              eventRows.push({
                bc_id: e.id,
                project_id: projectUuid,
                schedule_id: scheduleUuid,
                title: e.summary || e.title,
                description: processedEventDesc,
                starts_at: e.starts_at || null,
                ends_at: e.ends_at || null,
                all_day: e.all_day || false,
                author_person_id: await resolveOrCreatePerson(e.creator, supabase, peopleMap),
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
                  schedule_text: `${q.schedule_day || ''} at ${q.schedule_time || ''}`.trim(),
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
                const answerRows = []
                for (const a of answers) {
                  const processedAnswerContent = await processHtmlContent(a.content || '', token, 'answers', a.id, supabase, urlCache)
                  answerRows.push({
                    bc_id: a.id,
                    project_id: projectUuid,
                    question_id: questionUuid,
                    content: processedAnswerContent,
                    author_person_id: await resolveOrCreatePerson(a.creator, supabase, peopleMap),
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

    // Trigger background media attachment download (non-blocking) from newest to oldest
    triggerBackgroundAttachmentDownloader(supabase, token).catch(err => {
      console.error('⚠️ [Basecamp Sync] Background downloader error:', err.message)
    })

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
  const attachments = parseHtmlAttachments(html)
  if (attachments.length === 0) return html

  let updatedHtml = html
  for (const att of attachments) {
    const localUrl = await downloadAndUploadAttachment(token, att.url, att.filename, att.contentType, targetFolder, parentId, supabase)
    if (localUrl) {
      updatedHtml = updatedHtml.replaceAll(att.url, localUrl)
    }
  }
  return updatedHtml
}
