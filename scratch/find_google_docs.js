const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- BUSCANDO UPLOADS GOOGLE DOCS O SHEETS ---')
    const { data: uploads, error: uErr } = await supabase.from('bc_uploads').select('*')
    if (uErr) {
        console.error(uErr)
        return
    }
    const filtered = uploads.filter(u => 
        (u.content_type && (u.content_type.includes('document') || u.content_type.includes('spreadsheet') || u.content_type.includes('google'))) ||
        (u.download_url && u.download_url.includes('google.com'))
    )
    console.log(`Encontrados ${filtered.length} matches de Google Docs / Sheets:`)
    for (const u of filtered) {
        console.log(`- ID: ${u.id}, Filename: "${u.filename}", ContentType: "${u.content_type}", DownloadURL: "${u.download_url}", VaultID: ${u.vault_id}`)
    }
}

run()
