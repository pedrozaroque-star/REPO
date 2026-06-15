const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ywwwdcvgfculqmcfkihq.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function getValidToken() {
    const { data: tokenRow, error: fetchError } = await supabase
        .from('bc_oauth_tokens')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()

    if (fetchError || !tokenRow) {
        throw new Error('No Basecamp OAuth tokens found in database.')
    }

    const expiresAt = new Date(tokenRow.expires_at).getTime()
    const now = Date.now()
    const bufferMs = 5 * 60 * 1000

    if (now < expiresAt - bufferMs) {
        return tokenRow.access_token
    }

    console.log('🔄 Token expired, refreshing token...')
    const params = new URLSearchParams({
        type: 'refresh',
        client_id: process.env.BASECAMP_CLIENT_ID,
        redirect_uri: process.env.BASECAMP_REDIRECT_URI,
        client_secret: process.env.BASECAMP_CLIENT_SECRET,
        refresh_token: tokenRow.refresh_token,
    })

    const res = await fetch(`https://launchpad.37signals.com/authorization/token?${params.toString()}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'
        }
    })

    if (!res.ok) {
        throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
    }

    const newTokens = await res.json()
    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString()

    const { error: updateError } = await supabase
        .from('bc_oauth_tokens')
        .update({
            access_token: newTokens.access_token,
            ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString(),
        })
        .eq('id', tokenRow.id)

    if (updateError) throw updateError
    return newTokens.access_token
}

// Download a single file from Basecamp and upload to Supabase Storage
async function downloadAndUploadAttachment(token, basecampUrl, filename, contentType, targetFolder, id) {
    try {
        let targetUrl = basecampUrl.replace('preview.app.basecamp.com', '3.basecampapi.com')
        targetUrl = targetUrl.replace('storage.app.basecamp.com', '3.basecampapi.com')

        const res = await fetch(targetUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync'
            },
            redirect: 'manual'
        })

        let downloadUrl = res.headers.get('location')
        let fileBuffer
        let finalContentType = contentType || 'application/octet-stream'

        if (downloadUrl) {
            const s3Res = await fetch(downloadUrl)
            if (!s3Res.ok) throw new Error(`Failed to download from S3: ${s3Res.status}`)
            fileBuffer = Buffer.from(await s3Res.arrayBuffer())
            finalContentType = s3Res.headers.get('Content-Type') || finalContentType
        } else if (res.ok) {
            fileBuffer = Buffer.from(await res.arrayBuffer())
            finalContentType = res.headers.get('Content-Type') || finalContentType
        } else {
            throw new Error(`Failed to fetch from Basecamp API: ${res.status}`)
        }

        const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
        const filePath = `basecamp-attachments/${targetFolder}/${id}/${Date.now()}-${safeFilename}`

        const { error: uploadErr } = await supabase.storage
            .from('checklist-photos')
            .upload(filePath, fileBuffer, {
                contentType: finalContentType,
                cacheControl: '3600',
                upsert: true
            })

        if (uploadErr) throw uploadErr

        const { data: publicUrlData } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
        return publicUrlData.publicUrl
    } catch (err) {
        console.error(`  ⚠️ Failed to migrate attachment: ${filename}. Error: ${err.message}`)
        return null
    }
}

// Extract attachments from HTML string
function parseHtmlAttachments(html) {
    const attachments = []
    if (!html) return attachments

    // 1. bc-attachment tags
    const bcAttachmentRegex = /<bc-attachment\s+([^>]+)>([\s\S]*?)<\/bc-attachment>/gi
    let match
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1]
        const getAttr = (name) => {
            const m = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }
        const contentType = getAttr('content-type') || ''
        const filename = getAttr('filename') || 'attachment'
        const href = getAttr('href') || ''
        const url = getAttr('url') || href || ''
        if (url && (url.includes('basecamp') || url.includes('blobs'))) {
            attachments.push({ contentType, filename, url, rawMatch: match[0], isTag: true })
        }
    }

    // 2. img tags
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let imgMatch
    while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1]
        if (src && (src.includes('basecamp') || src.includes('blobs'))) {
            // Avoid duplicate checks
            const isAlreadyCaptured = attachments.some(a => a.url === src)
            if (!isAlreadyCaptured) {
                let filename = 'image.png'
                const altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i)
                if (altMatch) filename = altMatch[1]
                attachments.push({ contentType: 'image/png', filename, url: src, rawMatch: imgMatch[0], isTag: false })
            }
        }
    }

    return attachments
}

async function run() {
    try {
        console.log('Retrieving OAuth token...')
        const token = await getValidToken()
        console.log('OAuth token obtained successfully.')

        const startDate = '2024-01-01T00:00:00Z'

        // ==========================================
        // 1. MIGRATE BC_UPLOADS
        // ==========================================
        console.log('\n--- 1. MIGRATING UPLOADS (2024-2026) ---')
        const { data: uploads } = await supabase
            .from('bc_uploads')
            .select('*')
            .like('download_url', '%basecamp%')

        console.log(`Found ${uploads?.length || 0} uploads to migrate.`)
        let migratedUploads = 0
        for (const u of uploads || []) {
            console.log(`Migrating upload: "${u.filename}" (ID: ${u.id})...`)
            const localUrl = await downloadAndUploadAttachment(token, u.download_url, u.filename, u.content_type, 'uploads', u.id)
            if (localUrl) {
                const { error: updateErr } = await supabase
                    .from('bc_uploads')
                    .update({ download_url: localUrl })
                    .eq('id', u.id)
                if (!updateErr) {
                    migratedUploads++
                    console.log(`  ✅ Successfully migrated to: ${localUrl}`)
                } else {
                    console.error(`  ❌ Failed to update db row for upload: ${updateErr.message}`)
                }
            }
        }
        console.log(`Completed uploads migration. Migrated ${migratedUploads}/${uploads?.length || 0} files.`)

        // ==========================================
        // 2. MIGRATE BC_TODOS DESCRIPTIONS
        // ==========================================
        console.log('\n--- 2. MIGRATING TODOS DESCRIPTIONS (2024-2026) ---')
        // We select todos completed or created since 2024
        const { data: todos } = await supabase
            .from('bc_todos')
            .select('*')
            .or(`completed_at.gte.${startDate},and(is_completed.eq.false,created_at.gte.${startDate})`)

        const todosToMigrate = todos?.filter(t => t.description && (t.description.includes('basecamp') || t.description.includes('blobs'))) || []
        console.log(`Found ${todosToMigrate.length} todos with attachments to migrate.`)
        
        let migratedTodos = 0
        for (const t of todosToMigrate) {
            console.log(`Scanning attachments in todo: "${t.title}" (ID: ${t.id})...`)
            const attachments = parseHtmlAttachments(t.description)
            console.log(`  Found ${attachments.length} attachments.`)
            
            let currentDescription = t.description
            let anySuccess = false
            for (const att of attachments) {
                console.log(`  Downloading attachment: "${att.filename}"...`)
                const localUrl = await downloadAndUploadAttachment(token, att.url, att.filename, att.contentType, 'todos', t.id)
                if (localUrl) {
                    currentDescription = currentDescription.replaceAll(att.url, localUrl)
                    anySuccess = true
                    console.log(`    ✅ Migrated to: ${localUrl}`)
                }
            }

            if (anySuccess) {
                const { error: updateErr } = await supabase
                    .from('bc_todos')
                    .update({ description: currentDescription })
                    .eq('id', t.id)
                if (!updateErr) {
                    migratedTodos++
                } else {
                    console.error(`  ❌ Failed to update todo description: ${updateErr.message}`)
                }
            }
        }
        console.log(`Completed todos descriptions migration. Migrated ${migratedTodos}/${todosToMigrate.length} todos.`)

        // ==========================================
        // 3. MIGRATE BC_COMMENTS
        // ==========================================
        console.log('\n--- 3. MIGRATING COMMENTS (2024-2026) ---')
        const { data: comments } = await supabase
            .from('bc_comments')
            .select('*')
            .gte('created_at', startDate)

        const commentsToMigrate = comments?.filter(c => c.content && (c.content.includes('basecamp') || c.content.includes('blobs'))) || []
        console.log(`Found ${commentsToMigrate.length} comments with attachments to migrate.`)
        
        let migratedComments = 0
        for (const c of commentsToMigrate) {
            console.log(`Scanning attachments in comment (ID: ${c.id})...`)
            const attachments = parseHtmlAttachments(c.content)
            console.log(`  Found ${attachments.length} attachments.`)
            
            let currentContent = c.content
            let anySuccess = false
            for (const att of attachments) {
                console.log(`  Downloading attachment: "${att.filename}"...`)
                const localUrl = await downloadAndUploadAttachment(token, att.url, att.filename, att.contentType, 'comments', c.id)
                if (localUrl) {
                    currentContent = currentContent.replaceAll(att.url, localUrl)
                    anySuccess = true
                    console.log(`    ✅ Migrated to: ${localUrl}`)
                }
            }

            if (anySuccess) {
                const { error: updateErr } = await supabase
                    .from('bc_comments')
                    .update({ content: currentContent })
                    .eq('id', c.id)
                if (!updateErr) {
                    migratedComments++
                } else {
                    console.error(`  ❌ Failed to update comment content: ${updateErr.message}`)
                }
            }
        }
        console.log(`Completed comments migration. Migrated ${migratedComments}/${commentsToMigrate.length} comments.`)

        // ==========================================
        // 4. MIGRATE BC_MESSAGES
        // ==========================================
        console.log('\n--- 4. MIGRATING MESSAGES (2024-2026) ---')
        const { data: messages } = await supabase
            .from('bc_messages')
            .select('*')
            .gte('created_at', startDate)

        const messagesToMigrate = messages?.filter(m => m.content && (m.content.includes('basecamp') || m.content.includes('blobs'))) || []
        console.log(`Found ${messagesToMigrate.length} messages with attachments to migrate.`)
        
        let migratedMessages = 0
        for (const m of messagesToMigrate) {
            console.log(`Scanning attachments in message: "${m.title}" (ID: ${m.id})...`)
            const attachments = parseHtmlAttachments(m.content)
            console.log(`  Found ${attachments.length} attachments.`)
            
            let currentContent = m.content
            let anySuccess = false
            for (const att of attachments) {
                console.log(`  Downloading attachment: "${att.filename}"...`)
                const localUrl = await downloadAndUploadAttachment(token, att.url, att.filename, att.contentType, 'messages', m.id)
                if (localUrl) {
                    currentContent = currentContent.replaceAll(att.url, localUrl)
                    anySuccess = true
                    console.log(`    ✅ Migrated to: ${localUrl}`)
                }
            }

            if (anySuccess) {
                const { error: updateErr } = await supabase
                    .from('bc_messages')
                    .update({ content: currentContent })
                    .eq('id', m.id)
                if (!updateErr) {
                    migratedMessages++
                } else {
                    console.error(`  ❌ Failed to update message content: ${updateErr.message}`)
                }
            }
        }
        console.log(`Completed messages migration. Migrated ${migratedMessages}/${messagesToMigrate.length} messages.`)

        console.log('\n🎉 ALL MIGRATIONS COMPLETED SUCCESSFULLY!')
    } catch (err) {
        console.error('Fatal Migration Error:', err.message)
    }
}

run()
