const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    const { data: users } = await supabase.from('users').select('*')
    
    console.log('--- BUSCANDO POR STORE_ID 7 (SLAUSON) ---')
    const slausonManagers = users?.filter(u => u.store_id === 7 || (u.store_scope && u.store_scope.includes('SLAUSON')))
    console.log('Managers de Slauson:', slausonManagers)

    const ramos = users?.find(u => 
        (u.full_name && u.full_name.toLowerCase().includes('ramos')) || 
        (u.email && u.email.toLowerCase().includes('ramos'))
    )
    console.log('Cualquier "Ramos":', ramos)
}

run()
