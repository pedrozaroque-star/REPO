const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- BUSCANDO EN TABLA "users" ---')
    const { data: users } = await supabase.from('users').select('id, email, first_name, last_name, google_refresh_token')
    
    console.log(`Encontrados ${users?.length || 0} usuarios.`)
    
    const jesus = users?.find(u => 
        (u.first_name && u.first_name.toLowerCase().includes('jesus')) || 
        (u.last_name && u.last_name.toLowerCase().includes('ramos')) ||
        (u.email && u.email.toLowerCase().includes('jesusr'))
    )
    
    if (jesus) {
        console.log('ENCONTRADO JESUS RAMOS:', jesus)
    } else {
        console.log('No se encontro ningun Jesus en la tabla "users".')
        console.log('Primeros 5 usuarios:', users?.slice(0, 5))
    }
}

run()
