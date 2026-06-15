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

async function run() {
    try {
        console.log('Retrieving OAuth token...')
        const token = await getValidToken()
        console.log('OAuth token obtained successfully.')

        // Search for Norwalk Todo BC ID: 9287087501
        const { data: todos } = await supabase
            .from('bc_todos')
            .select('*')
            .eq('bc_id', 9287087501)
            .limit(1)

        if (!todos || todos.length === 0) {
            console.log('Norwalk todo not found in database.')
            return
        }

        const todo = todos[0]
        console.log('Found Norwalk Todo:', todo.title)

        // Parse attachments
        const bcAttachmentRegex = /<bc-attachment\s+([^>]+)>([\s\S]*?)<\/bc-attachment>/gi
        let match
        const attachments = []
        while ((match = bcAttachmentRegex.exec(todo.description)) !== null) {
            const attrsStr = match[1]
            const getAttr = (name) => {
                const m = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
                return m ? m[1] : null
            }
            const contentType = getAttr('content-type') || ''
            const filename = getAttr('filename') || 'attachment'
            const href = getAttr('href') || ''
            const url = getAttr('url') || href || ''
            attachments.push({ contentType, filename, href, url })
        }

        console.log(`Found ${attachments.length} attachments in Norwalk todo.`)
        if (attachments.length === 0) return

        const testAttach = attachments[0]
        console.log('Testing with first attachment:', testAttach.filename, 'URL:', testAttach.url)

        // Download attachment from Basecamp following redirect manually
        let targetUrl = testAttach.url.replace('preview.app.basecamp.com', '3.basecampapi.com')
        targetUrl = targetUrl.replace('storage.app.basecamp.com', '3.basecampapi.com')

        console.log('Fetching attachment from Basecamp API:', targetUrl)
        const res = await fetch(targetUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync'
            },
            redirect: 'manual'
        })

        let downloadUrl = res.headers.get('location')
        let fileBuffer
        let finalContentType = testAttach.contentType || 'application/octet-stream'

        if (downloadUrl) {
            console.log('Redirect location found (S3 URL):', downloadUrl.substring(0, 100) + '...')
            const s3Res = await fetch(downloadUrl)
            if (!s3Res.ok) throw new Error(`Failed to download from S3: ${s3Res.status}`)
            fileBuffer = Buffer.from(await s3Res.arrayBuffer())
            finalContentType = s3Res.headers.get('Content-Type') || finalContentType
        } else if (res.ok) {
            console.log('Direct response 200 OK')
            fileBuffer = Buffer.from(await res.arrayBuffer())
            finalContentType = res.headers.get('Content-Type') || finalContentType
        } else {
            throw new Error(`Failed to fetch: ${res.status} ${await res.text()}`)
        }

        console.log(`Successfully downloaded buffer of size: ${fileBuffer.length} bytes. ContentType: ${finalContentType}`)

        // Upload to Supabase Storage
        const fileExt = testAttach.filename.split('.').pop() || 'jpg'
        const filePath = `basecamp-attachments/${todo.id}/${Date.now()}-${testAttach.filename}`
        console.log('Uploading to Supabase Storage bucket "checklist-photos" path:', filePath)

        const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('checklist-photos')
            .upload(filePath, fileBuffer, {
                contentType: finalContentType,
                cacheControl: '3600',
                upsert: true
            })

        if (uploadErr) {
            console.error('Storage Upload Error:', uploadErr)
            return
        }

        console.log('Upload successful! Retrieve public URL...')
        const { data: publicUrlData } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
        console.log('Supabase Storage Public URL:', publicUrlData.publicUrl)

    } catch (err) {
        console.error('Error:', err.message)
    }
}

run()
