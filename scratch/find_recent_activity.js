const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- BUSCANDO VERDADERA ACTIVIDAD RECIENTE POR TABLAS ---')
    
    console.log('\n[BC_TODOS COMPLETED] (Ordenados por completed_at DESC):')
    const { data: completedTodos } = await supabase.from('bc_todos')
        .select('title, completed_at, is_completed')
        .eq('is_completed', true)
        .order('completed_at', { ascending: false })
        .limit(5)
    for (const t of completedTodos || []) {
        console.log(`- "${t.title}" | Completed At: ${t.completed_at}`)
    }

    console.log('\n[BC_TODOS CREATED] (Ordenados por created_at DESC):')
    const { data: createdTodos } = await supabase.from('bc_todos')
        .select('title, created_at, is_completed')
        .order('created_at', { ascending: false })
        .limit(5)
    for (const t of createdTodos || []) {
        console.log(`- "${t.title}" | Created At: ${t.created_at} | Is Completed: ${t.is_completed}`)
    }

    console.log('\n[BC_COMMENTS] (Ordenados por created_at DESC):')
    const { data: comments } = await supabase.from('bc_comments')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
    for (const c of comments || []) {
        console.log(`- "${c.content?.replace(/<[^>]*>/g, '').substring(0, 50)}" | Created At: ${c.created_at}`)
    }

    console.log('\n[BC_MESSAGES] (Ordenados por created_at DESC):')
    const { data: messages } = await supabase.from('bc_messages')
        .select('title, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
    for (const m of messages || []) {
        console.log(`- "${m.title}" | Created At: ${m.created_at}`)
    }

    console.log('\n[BC_CAMPFIRE_LINES] (Ordenados por created_at DESC):')
    const { data: campfire } = await supabase.from('bc_campfire_lines')
        .select('content, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
    for (const cf of campfire || []) {
        console.log(`- "${cf.content?.replace(/<[^>]*>/g, '').substring(0, 50)}" | Created At: ${cf.created_at}`)
    }
}

run()
