import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function simulateFetch() {
  const projectDbId = '85239168-760b-4615-9bb0-4236b2a4d5c5' // All Locations

  console.log('Simulating fetchLists for project db_id:', projectDbId)

  const [listsResult, todosResult] = await Promise.all([
    supabase
      .from('bc_todolists')
      .select('id, bc_id, name, description, position')
      .eq('project_id', projectDbId)
      .order('position', { ascending: true }),

    supabase
      .from('bc_todos')
      .select('id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position')
      .eq('project_id', projectDbId)
      .order('position', { ascending: true })
  ])

  if (listsResult.error) console.error('Lists error:', listsResult.error)
  if (todosResult.error) console.error('Todos error:', todosResult.error)

  const lists = listsResult.data || []
  const todos = todosResult.data || []

  console.log(`Fetched lists count: ${lists.length}`)
  console.log(`Fetched todos count: ${todos.length}`)

  lists.forEach((list, index) => {
    const listTodos = todos.filter(t => t.todolist_id === list.id)
    const open = listTodos.filter(t => !t.is_completed)
    const completed = listTodos.filter(t => t.is_completed)

    console.log(`\nList index ${index}: "${list.name}" (UUID: ${list.id})`)
    console.log(` - Fetched total: ${listTodos.length}, Open: ${open.length}, Completed: ${completed.length}`)
    console.log(` - Top 5 Open:`)
    console.table(open.slice(0, 5).map(o => ({ title: o.title, pos: o.position, is_completed: o.is_completed })))
  })
}

simulateFetch()
