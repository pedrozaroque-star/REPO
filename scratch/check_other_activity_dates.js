const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- COMMENTS DATES ---')
    const { data: comments } = await supabase.from('bc_comments').select('created_at').order('created_at', { ascending: false }).limit(2)
    console.log('Comments:', comments)

    console.log('--- MESSAGES DATES ---')
    const { data: messages } = await supabase.from('bc_messages').select('created_at').order('created_at', { ascending: false }).limit(2)
    console.log('Messages:', messages)

    console.log('--- CAMPFIRE DATES ---')
    const { data: campfire } = await supabase.from('bc_campfire_lines').select('created_at').order('created_at', { ascending: false }).limit(2)
    console.log('Campfire:', campfire)
}

run()
