import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkProjectTodos() {
  const projectBcId = 21853276
  console.log(`Checking project bc_id: ${projectBcId}`)

  // Find project in DB
  const { data: project } = await supabase
    .from('bc_projects')
    .select('id, name')
    .eq('bc_id', projectBcId)
    .single()

  if (!project) {
    console.error('Project not found in DB')
    return
  }
  console.log(`Found Project in DB: ${project.name} (UUID: ${project.id})`)

  // Find todolists in this project
  const { data: lists } = await supabase
    .from('bc_todolists')
    .select('id, name, bc_id, completed_count, total_count')
    .eq('project_id', project.id)

  if (!lists || lists.length === 0) {
    console.log('No todo lists found in DB for this project.')
    return
  }

  console.log(`Found ${lists.length} Todo Lists:`)
  console.table(lists)

  for (const list of lists) {
    // Count active and completed tasks in DB
    const { count: totalTasks } = await supabase
      .from('bc_todos')
      .select('*', { count: 'exact', head: true })
      .eq('todolist_id', list.id)

    const { count: completedTasks } = await supabase
      .from('bc_todos')
      .select('*', { count: 'exact', head: true })
      .eq('todolist_id', list.id)
      .eq('is_completed', true)

    const { count: activeTasks } = await supabase
      .from('bc_todos')
      .select('*', { count: 'exact', head: true })
      .eq('todolist_id', list.id)
      .eq('is_completed', false)

    console.log(`List "${list.name}" (bc_id: ${list.bc_id}):`)
    console.log(` - DB Total: ${totalTasks}, Completed: ${completedTasks}, Active: ${activeTasks}`)

    // Print first 5 active tasks
    const { data: activeList } = await supabase
      .from('bc_todos')
      .select('title, position, is_completed')
      .eq('todolist_id', list.id)
      .eq('is_completed', false)
      .order('position', { ascending: true })
      .limit(10)

    console.log(' - Top 10 Active Tasks in DB:')
    console.table(activeList)
  }
}

checkProjectTodos()
