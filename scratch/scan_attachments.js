const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log('--- ESCANEANDO ENLACES DE ARCHIVOS ADJUNTOS EN LA BD ---')
    
    // Todos
    const { data: todos } = await supabase.from('bc_todos').select('id, title, description')
    let todoLinksCount = 0
    for (const t of todos || []) {
        if (t.description && (t.description.includes('basecamp') || t.description.includes('blobs'))) {
            todoLinksCount++
        }
    }
    console.log(`Todos con posibles adjuntos en HTML: ${todoLinksCount}`)

    // Comments
    const { data: comments } = await supabase.from('bc_comments').select('id, content')
    let commentLinksCount = 0
    for (const c of comments || []) {
        if (c.content && (c.content.includes('basecamp') || c.content.includes('blobs'))) {
            commentLinksCount++
        }
    }
    console.log(`Comentarios con posibles adjuntos en HTML: ${commentLinksCount}`)

    // Messages
    const { data: messages } = await supabase.from('bc_messages').select('id, content')
    let messageLinksCount = 0
    for (const m of messages || []) {
        if (m.content && (m.content.includes('basecamp') || m.content.includes('blobs'))) {
            messageLinksCount++
        }
    }
    console.log(`Mensajes con posibles adjuntos en HTML: ${messageLinksCount}`)
    
    // Uploads
    const { data: uploads } = await supabase.from('bc_uploads').select('id, filename, download_url')
    let basecampUploadsCount = 0
    for (const u of uploads || []) {
        if (u.download_url && u.download_url.includes('basecamp')) {
            basecampUploadsCount++
        }
    }
    console.log(`Archivos (bc_uploads) apuntando a Basecamp: ${basecampUploadsCount}`)
}

run()
