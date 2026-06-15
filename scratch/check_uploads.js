const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- BUSCANDO UPLOADS (ARCHIVOS Y LINKS DE GOOGLE) ---')
    const { data: uploads, error: uErr } = await supabase.from('bc_uploads').select('*')
    if (uErr) {
        console.error(uErr)
        return
    }
    console.log(`Encontrados ${uploads?.length || 0} uploads:`)
    for (const u of uploads || []) {
        console.log(`- Filename: "${u.filename}", ContentType: "${u.content_type}", DownloadURL: "${u.download_url}", VaultID: ${u.vault_id}`)
    }
}

run()
