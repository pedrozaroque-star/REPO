import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import {
  fetchComments,
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

    console.log('💬 Obteniendo comentarios de la base de datos local...')
    const { data: dbComments, error: commErr } = await supabase
      .from('bc_comments')
      .select('id, bc_id, project_id, parent_type, parent_id')

    if (commErr || !dbComments) {
      throw new Error(`Error al obtener comentarios: ${commErr?.message}`)
    }

    console.log(`Encontrados ${dbComments.length} comentarios locales. Agrupando por elemento padre...`)

    // Group comments by parent to optimize API calls
    const parentMap = new Map<string, {
      parentId: string
      parentType: string
      projectId: string
      commentBcIds: number[]
    }>()

    for (const c of dbComments) {
      const key = `${c.parent_type}:${c.parent_id}`
      if (!parentMap.has(key)) {
        parentMap.set(key, {
          parentId: c.parent_id,
          parentType: c.parent_type,
          projectId: c.project_id,
          commentBcIds: [],
        })
      }
      parentMap.get(key)!.commentBcIds.push(Number(c.bc_id))
    }

    console.log(`Identificados ${parentMap.size} elementos padres únicos. Resolviendo sus Basecamp IDs...`)

    let updatedCommentsTotal = 0

    for (const [key, info] of parentMap.entries()) {
      // 1. Get project bc_id
      const { data: projData } = await supabase
        .from('bc_projects')
        .select('bc_id, name')
        .eq('id', info.projectId)
        .single()

      if (!projData) {
        console.warn(`⚠️ No se encontró el proyecto ${info.projectId} para el padre ${key}`)
        continue
      }

      const projectBcId = Number(projData.bc_id)

      // 2. Get parent bc_id
      let parentBcId: number | null = null
      let parentTitle = 'Elemento'

      if (info.parentType === 'todo') {
        const { data: todoData } = await supabase
          .from('bc_todos')
          .select('bc_id, title')
          .eq('id', info.parentId)
          .single()
        if (todoData) {
          parentBcId = Number(todoData.bc_id)
          parentTitle = todoData.title
        }
      } else if (info.parentType === 'message') {
        const { data: msgData } = await supabase
          .from('bc_messages')
          .select('bc_id, title')
          .eq('id', info.parentId)
          .single()
        if (msgData) {
          parentBcId = Number(msgData.bc_id)
          parentTitle = msgData.title
        }
      } else if (info.parentType === 'document') {
        const { data: docData } = await supabase
          .from('bc_documents')
          .select('bc_id, title')
          .eq('id', info.parentId)
          .single()
        if (docData) {
          parentBcId = Number(docData.bc_id)
          parentTitle = docData.title
        }
      }

      if (!parentBcId) {
        console.warn(`⚠️ No se encontró el ID de Basecamp para el padre ${key} (${info.parentType})`)
        continue
      }

      console.log(`💬 Buscando comentarios para: "${parentTitle}" (${info.parentType}, bc_id: ${parentBcId}) en el proyecto: "${projData.name}"...`)

      try {
        const bcComments = await fetchComments(projectBcId, parentBcId)
        console.log(`   Encontrados ${bcComments.length} comentarios en Basecamp.`)

        let updatedInParent = 0
        for (const bcComment of bcComments) {
          if (info.commentBcIds.includes(bcComment.id)) {
            const { error: updateErr } = await supabase
              .from('bc_comments')
              .update({ created_at: bcComment.created_at })
              .eq('bc_id', bcComment.id)

            if (!updateErr) {
              updatedInParent++
              updatedCommentsTotal++
            }
          }
        }
        console.log(`   ✅ Actualizados ${updatedInParent} comentarios de este elemento.`)
      } catch (err: any) {
        console.error(`   ❌ Error al obtener comentarios del API:`, err.message)
      }
    }

    console.log(`\n🎉 SE COMPLETÓ LA CORRECCIÓN DE COMENTARIOS. Total actualizados: ${updatedCommentsTotal}`)
  } catch (err: any) {
    console.error('💥 Error crítico en la ejecución:', err.message)
  }
}

run()
