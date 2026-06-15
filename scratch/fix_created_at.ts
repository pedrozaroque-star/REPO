import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import {
  fetchProject,
  fetchTodoLists,
  fetchAllTodos,
  fetchMessages,
  fetchDocuments,
  findDock,
  extractDockId,
  getValidToken,
} from '../lib/basecamp-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
  try {
    console.log('🔑 Obteniendo token de Basecamp...')
    const token = await getValidToken()
    console.log('✅ Token obtenido con éxito.')

    console.log('📁 Obteniendo proyectos de la base de datos local...')
    const { data: dbProjects, error: projErr } = await supabase
      .from('bc_projects')
      .select('id, name, bc_id')
      .eq('is_archived', false)

    if (projErr || !dbProjects) {
      throw new Error(`Error al obtener proyectos: ${projErr?.message}`)
    }

    console.log(`Encontrados ${dbProjects.length} proyectos activos. Comienza la corrección de timestamps...`)

    for (const project of dbProjects) {
      console.log(`\n──────────────────────────────────────────────────`)
      console.log(`📁 Procesando proyecto: "${project.name}" (bc_id: ${project.bc_id})`)
      console.log(`──────────────────────────────────────────────────`)

      // 1. Fetch project from Basecamp to get dock configurations
      let p
      try {
        p = await fetchProject(Number(project.bc_id))
      } catch (err: any) {
        console.error(`⚠️  Error al obtener el proyecto ${project.bc_id} desde la API:`, err.message)
        continue
      }

      // ---- 1. MESSAGES ----
      const messageBoardDock = findDock(p, 'message_board')
      if (messageBoardDock) {
        try {
          const boardId = extractDockId(messageBoardDock.url)
          console.log(`📬 Buscando mensajes en el Message Board (bc_id: ${boardId})...`)
          const messages = await fetchMessages(Number(project.bc_id), boardId)
          console.log(`   Encontrados ${messages.length} mensajes en Basecamp.`)

          let updatedMessagesCount = 0
          for (const m of messages) {
            const { error: updateErr } = await supabase
              .from('bc_messages')
              .update({ created_at: m.created_at })
              .eq('bc_id', m.id)

            if (!updateErr) {
              updatedMessagesCount++
            }
          }
          console.log(`   ✅ Actualizados ${updatedMessagesCount}/${messages.length} mensajes con su fecha original.`)
        } catch (err: any) {
          console.error(`   ❌ Error al procesar mensajes del proyecto:`, err.message)
        }
      }

      // ---- 2. DOCUMENTS ----
      const vaultDocks = p.dock?.filter((d: any) => d.name === 'vault' && d.enabled) || []
      for (const vaultDock of vaultDocks) {
        try {
          const vaultId = extractDockId(vaultDock.url)
          console.log(`📄 Buscando documentos en vault: "${vaultDock.title || vaultDock.name}" (bc_id: ${vaultId})...`)
          const docs = await fetchDocuments(Number(project.bc_id), vaultId)
          console.log(`   Encontrados ${docs.length} documentos en Basecamp.`)

          let updatedDocsCount = 0
          for (const d of docs) {
            const { error: updateErr } = await supabase
              .from('bc_documents')
              .update({ created_at: d.created_at })
              .eq('bc_id', d.id)

            if (!updateErr) {
              updatedDocsCount++
            }
          }
          console.log(`   ✅ Actualizados ${updatedDocsCount}/${docs.length} documentos con su fecha original.`)
        } catch (err: any) {
          console.error(`   ❌ Error al procesar documentos del vault:`, err.message)
        }
      }

      // ---- 3. TODO LISTS & TODOS ----
      const todosetDock = findDock(p, 'todoset')
      if (todosetDock) {
        try {
          const todosetId = extractDockId(todosetDock.url)
          console.log(`📋 Buscando to-do lists en todoset (bc_id: ${todosetId})...`)
          const todolists = await fetchTodoLists(Number(project.bc_id), todosetId)
          console.log(`   Encontrados ${todolists.length} listas en Basecamp.`)

          let updatedListsCount = 0
          let totalTodosUpdated = 0
          for (const list of todolists) {
            // Update List created_at
            const { error: listUpdateErr } = await supabase
              .from('bc_todolists')
              .update({ created_at: list.created_at })
              .eq('bc_id', list.id)

            if (!listUpdateErr) {
              updatedListsCount++
            }

            // Fetch and update todos inside the list
            try {
              const todos = await fetchAllTodos(Number(project.bc_id), list.id)
              for (const t of todos) {
                const { error: todoUpdateErr } = await supabase
                  .from('bc_todos')
                  .update({ created_at: t.created_at })
                  .eq('bc_id', t.id)

                if (!todoUpdateErr) {
                  totalTodosUpdated++
                }
              }
            } catch (todoErr: any) {
              console.error(`      ⚠️ Error al procesar to-dos de la lista ${list.id}:`, todoErr.message)
            }
          }
          console.log(`   ✅ Actualizadas ${updatedListsCount}/${todolists.length} listas y ${totalTodosUpdated} tareas.`)
        } catch (err: any) {
          console.error(`   ❌ Error al procesar to-dos del proyecto:`, err.message)
        }
      }
    }

    console.log('\n🎉 TIMESTAMPS CORREGIDOS CON ÉXITO EN TODA LA BASE DE DATOS!')
  } catch (err: any) {
    console.error('💥 Error crítico en la ejecución:', err.message)
  }
}

run()
