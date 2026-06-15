import { getValidToken } from './lib/basecamp-api'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function checkTodo() {
  const projectId = 21853276
  const todoId = 9951451905 // Azusa - Grapas

  try {
    const token = await getValidToken()
    const res = await fetch(`https://3.basecampapi.com/5052386/buckets/${projectId}/todos/${todoId}.json`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
      }
    })
    
    if (!res.ok) {
      console.log('HTTP Error:', res.status, await res.text())
      return
    }

    const todo = await res.json()
    console.log('Todo Info from Basecamp API:')
    console.log({
      id: todo.id,
      content: todo.content,
      completed: todo.completed,
      updated_at: todo.updated_at,
      completed_at: todo.completed_at
    })
  } catch (err: any) {
    console.error('Error fetching todo:', err.message)
  }
}

checkTodo()
