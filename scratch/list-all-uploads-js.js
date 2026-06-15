const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- ALL UPLOADS ---')
    const { data: uploads } = await supabase.from('bc_uploads').select('*')
    for (const u of uploads || []) {
        console.log(`- Upload: "${u.filename}" | Type: "${u.content_type}" | Url: "${u.download_url}"`)
    }
}

run()
