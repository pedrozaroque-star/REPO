import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkListActiveTasks() {
  const listBcId = 4053105034 // Pedidos (No Poner Casos)
  
  const { data: list } = await supabase
    .from('bc_todolists')
    .select('id, name')
    .eq('bc_id', listBcId)
    .single()

  if (!list) {
    console.error('List not found')
    return
  }

  console.log(`List: ${list.name} (UUID: ${list.id})`)

  const { data: activeTasks } = await supabase
    .from('bc_todos')
    .select('title, position, is_completed, bc_id')
    .eq('todolist_id', list.id)
    .eq('is_completed', false)
    .order('position', { ascending: true })

  console.log(`Active Tasks in DB (total: ${activeTasks?.length}):`)
  console.table(activeTasks)
}

checkListActiveTasks()
