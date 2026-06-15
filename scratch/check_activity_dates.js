const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- BUSCANDO ACTIVIDADES Y SUS FECHAS REALES ---')
    const { data: todos } = await supabase.from('bc_todos')
        .select('title, updated_at, is_completed, completed_at')
        .order('updated_at', { ascending: false })
        .limit(5)
    
    console.log('Todos recientes en DB:')
    for (const t of todos || []) {
        console.log(`- Title: "${t.title}" | Updated At: "${t.updated_at}" | Completed At: "${t.completed_at}"`)
    }
}

run()
