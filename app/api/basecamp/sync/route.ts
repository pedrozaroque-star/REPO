/**
 * @module api/basecamp/sync
 * @description Ruta POST que ejecuta una sincronización completa de datos desde la API de Basecamp 3
 *              hacia las tablas locales bc_* de Supabase. Recorre todos los proyectos, extrae todos los
 *              recursos (todos, mensajes, campfire, documentos, eventos, check-ins, comentarios) y hace upsert
 *              en las tablas correspondientes usando `bc_id` como clave de mapeo.
 *
 * @businessRules
 * - **Orden de Sincronización**: La dependencia de datos exige un orden estricto:
 *   1. People (personas) — sin dependencias
 *   2. Projects (proyectos) — sin dependencias
 *   3. Per-project resources — dependen de project_id y de las personas (creadores/asignatarios)
 * - **Upsert por bc_id**: Todos los registros se insertan o actualizan usando el campo `bc_id`
 *   (ID numérico de Basecamp) como clave de conflicto, garantizando idempotencia.
 * - **Logging**: Cada sincronización genera un registro en `bc_sync_log` con status, conteos,
 *   y detalles por entidad para auditoría.
 * - **Tolerancia a Fallos**: Si un recurso o proyecto falla, se continúa con el siguiente. El error
 *   se registra en el log pero no aborta toda la sincronización.
 *
 * @dataFlow
 * - POST /api/basecamp/sync → `getValidToken()` → API calls por entidad → Supabase upsert
 * - Cada entidad: basecampFetch → map to DB schema → supabase.from(table).upsert()
 * - Al final: bc_sync_log entry con resumen completo
 *
 * @notes
 * - Una sincronización completa puede tardar varios minutos dependiendo del volumen de datos.
 * - Los dock IDs (todoset, message_board, etc.) se extraen dinámicamente del proyecto.
 * - Sincroniza también los comentarios para mensajes, todos y documentos, asociando con el autor real.
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
  fetchScheduleEntries,
  fetchQuestions,
  fetchAnswers,
  fetchComments,
  findDock,
  extractDockId,
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

export async function POST(request: Request) {
  const supabase = getSyncClient()
  const counters = createCounters()
  const startTime = Date.now()

  // 1. Create sync log entry
  const { data: logEntry, error: logError } = await supabase
    .from('bc_sync_log')
    .insert({
      sync_type: 'full',
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  const syncLogId = logEntry?.id

  try {
    console.log('🔄 [Basecamp Sync] Starting full synchronization to bc_* tables...')

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
      const { data: dbPeople } = await supabase.from('bc_people').select('id, bc_id')
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
    try {
      projects = await fetchProjects()
      console.log(`   Found ${projects.length} projects`)

      if (projects.length > 0) {
        const projectRows = projects.map((p) => ({
          bc_id: p.id,
          name: p.name,
          description: p.description || '',
          color: 'white',
          is_pinned: p.bookmarked || false,
          is_archived: p.status === 'archived',
          member_count: 0, // Will be computed or updated later
          updated_at: new Date().toISOString(),
        }))

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
      const { data: dbProjects } = await supabase.from('bc_projects').select('id, bc_id')
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
    // STEP 3: SYNC PER-PROJECT RESOURCES
    // ================================================================
    console.log('🔧 [Basecamp Sync] Step 3: Syncing per-project resources...')

    for (const project of projects) {
      const projectUuid = projectsMap[project.id]
      if (!projectUuid) {
        console.warn(`⚠️ Skipped project "${project.name}" (bc_id: ${project.id}) - No local project UUID found`)
        continue
      }

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
            const { data: dbList, error: listErr } = await supabase
              .from('bc_todolists')
              .upsert(
                {
                  bc_id: list.id,
                  project_id: projectUuid,
                  todoset_id: todosetUuid,
                  name: list.title || list.name,
                  description: list.description || '',
                  position: list.position,
                  completed_count: parseInt(list.completed_ratio?.split('/')[0] || '0', 10),
                  total_count: parseInt(list.completed_ratio?.split('/')[1] || '0', 10),
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
              const todos = await fetchAllTodos(project.id, list.id)

              for (const t of todos) {
                const authorUuid = peopleMap[t.creator?.id] || null
                const { data: dbTodo, error: todoErr } = await supabase
                  .from('bc_todos')
                  .upsert({
                    bc_id: t.id,
                    project_id: projectUuid,
                    todolist_id: todolistUuid,
                    title: t.content || t.title,
                    description: t.description || '',
                    is_completed: t.completed || false,
                    completed_at: t.completed ? (t.updated_at || new Date().toISOString()) : null,
                    due_date: t.due_on || null,
                    position: t.position,
                    created_by_person_id: authorUuid,
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
                    const commentRows = comments.map((c) => ({
                      bc_id: c.id,
                      project_id: projectUuid,
                      parent_type: 'todo',
                      parent_id: todoUuid,
                      content: c.content || '',
                      author_person_id: peopleMap[c.creator?.id] || null,
                      created_at: c.created_at || new Date().toISOString(),
                    }))

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
            const authorUuid = peopleMap[m.creator?.id] || null
            const { data: dbMsg, error: msgErr } = await supabase
              .from('bc_messages')
              .upsert({
                bc_id: m.id,
                project_id: projectUuid,
                board_id: boardUuid,
                title: m.subject || m.title,
                content: m.content || '',
                category: m.category?.name || 'General',
                author_person_id: authorUuid,
                comments_count: m.comments_count || 0,
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
                const commentRows = comments.map((c) => ({
                  bc_id: c.id,
                  project_id: projectUuid,
                  parent_type: 'message',
                  parent_id: messageUuid,
                  content: c.content || '',
                  author_person_id: peopleMap[c.creator?.id] || null,
                  created_at: c.created_at || new Date().toISOString(),
                }))

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
            const lineRows = lines.map((l) => ({
              bc_id: l.id,
              project_id: projectUuid,
              campfire_id: campfireUuid,
              content: l.content || '',
              author_person_id: peopleMap[l.creator?.id] || null,
              created_at: l.created_at || new Date().toISOString(),
            }))

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

      // ---- VAULT (DOCS & FILES) → DOCUMENTS + UPLOADS ----
      const vaultDock = findDock(project, 'vault')
      if (vaultDock) {
        try {
          const vaultId = extractDockId(vaultDock.url)
          
          // Upsert the vault container
          const { data: dbVault, error: vaultErr } = await supabase
            .from('bc_vaults')
            .upsert({
              bc_id: vaultId,
              project_id: projectUuid,
            }, { onConflict: 'bc_id' })
            .select('id')
            .single()

          if (vaultErr) {
            throw vaultErr
          }

          const vaultUuid = dbVault.id
          vaultsMap[vaultId] = vaultUuid
          counters.vaults++

          // Documents
          try {
            const docs = await fetchDocuments(project.id, vaultId)
            console.log(`   📄 Found ${docs.length} documents`)

            for (const d of docs) {
              const authorUuid = peopleMap[d.creator?.id] || null
              const { data: dbDoc, error: docErr } = await supabase
                .from('bc_documents')
                .upsert({
                  bc_id: d.id,
                  project_id: projectUuid,
                  vault_id: vaultUuid,
                  title: d.title,
                  content: d.content || '',
                  author_person_id: authorUuid,
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
                  const comments = await fetchComments(project.id, d.id)
                  const commentRows = comments.map((c) => ({
                    bc_id: c.id,
                    project_id: projectUuid,
                    parent_type: 'document',
                    parent_id: docUuid,
                    content: c.content || '',
                    author_person_id: peopleMap[c.creator?.id] || null,
                    created_at: c.created_at || new Date().toISOString(),
                  }))

                  const { error: comErr } = await supabase
                    .from('bc_comments')
                    .upsert(commentRows, { onConflict: 'bc_id' })

                  if (comErr) {
                    console.error(`      ❌ comments error for doc ${d.id}:`, comErr.message)
                  } else {
                    counters.comments += comments.length
                  }
                } catch (comFetchErr: any) {
                  console.warn(`      ⚠️ comments fetch error for doc ${d.id}:`, comFetchErr.message)
                }
              }
            }
          } catch (docErr: any) {
            counters.errors.push(`Documents for project ${project.id}: ${docErr.message}`)
          }

          // Uploads
          try {
            const uploads = await fetchUploads(project.id, vaultId)
            console.log(`   📎 Found ${uploads.length} uploads`)

            if (uploads.length > 0) {
              const uploadRows = uploads.map((u) => ({
                bc_id: u.id,
                project_id: projectUuid,
                vault_id: vaultUuid,
                filename: u.filename || u.title,
                content_type: u.content_type || '',
                byte_size: u.byte_size || 0,
                download_url: u.download_url || '',
                author_person_id: peopleMap[u.creator?.id] || null,
                created_at: u.created_at || new Date().toISOString(),
              }))

              const { error: upErr } = await supabase
                .from('bc_uploads')
                .upsert(uploadRows, { onConflict: 'bc_id' })

              if (upErr) {
                counters.errors.push(`Uploads for project ${project.id}: ${upErr.message}`)
              } else {
                counters.uploads += uploads.length
              }
            }
          } catch (upErr: any) {
            counters.errors.push(`Uploads for project ${project.id}: ${upErr.message}`)
          }
        } catch (err: any) {
          counters.errors.push(`Vault for project ${project.id}: ${err.message}`)
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
            const eventRows = entries.map((e) => ({
              bc_id: e.id,
              project_id: projectUuid,
              schedule_id: scheduleUuid,
              title: e.summary || e.title,
              description: e.description || '',
              starts_at: e.starts_at || null,
              ends_at: e.ends_at || null,
              all_day: e.all_day || false,
              author_person_id: peopleMap[e.creator?.id] || null,
              updated_at: new Date().toISOString(),
            }))

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
                const answerRows = answers.map((a) => ({
                  bc_id: a.id,
                  project_id: projectUuid,
                  question_id: questionUuid,
                  content: a.content || '',
                  author_person_id: peopleMap[a.creator?.id] || null,
                  created_at: a.created_at || new Date().toISOString(),
                }))

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
