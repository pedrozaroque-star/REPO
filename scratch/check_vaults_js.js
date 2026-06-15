const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- BUSCANDO VAULTS (CARPETAS) ---')
    const { data: vaults, error: vErr } = await supabase.from('bc_vaults').select('*')
    if (vErr) {
        console.error(vErr)
        return
    }
    console.log(`Encontradas ${vaults?.length || 0} carpetas:`)
    for (const v of vaults || []) {
        console.log(`- Name: "${v.name}", ID: ${v.id}, Parent: ${v.parent_vault_id}, BC_ID: ${v.bc_id}, Project ID: ${v.project_id}`)
    }
}

run()
