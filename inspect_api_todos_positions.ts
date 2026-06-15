import { fetchTodos } from './lib/basecamp-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function inspectPositions() {
  const projectId = 21853276
  const todolistId = 4053105034 // Pedidos (No Poner Casos)

  console.log(`Fetching active todos from Basecamp API for project ${projectId}, list ${todolistId}...`)
  
  try {
    const activeTodos = await fetchTodos(projectId, todolistId)
    console.log(`Fetched ${activeTodos.length} active todos from Basecamp:`)
    
    console.table(activeTodos.map((t, index) => ({
      index,
      title: t.content || t.title,
      position: t.position,
      updated_at: t.updated_at
    })))
  } catch (err: any) {
    console.error('Error fetching from Basecamp API:', err.message)
  }
}

inspectPositions()
