import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkTodoAssignees() {
  const projectDbId = '85239168-760b-4615-9bb0-4236b2a4d5c5' // All Locations
  
  const { data: todos, error } = await supabase
    .from('bc_todos')
    .select(`
      id, title, position, is_completed,
      bc_todo_assignees(
        person:bc_people(name, email)
      )
    `)
    .eq('project_id', projectDbId)
    .eq('is_completed', false)
    .order('position', { ascending: true })

  if (error) {
    console.error('Error fetching:', error.message)
    return
  }

  console.log(`Active todos in project All Locations (total: ${todos?.length}):`)
  todos?.forEach(t => {
    const assignees = t.bc_todo_assignees?.map((a: any) => a.person?.name).join(', ') || 'No one'
    console.log(` - Pos ${t.position}: "${t.title}" | Assigned to: ${assignees}`)
  })
}

checkTodoAssignees()
