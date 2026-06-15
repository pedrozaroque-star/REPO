import { supabaseAdmin } from '../lib/supabase';

const getBlobUuid = (url: string) => {
    const match = url.match(/\/blobs\/([a-f0-9-]+)/i)
    return match ? match[1] : null
}

const parseAttachments = (html: string) => {
    const attachments: any[] = []
    if (!html) return attachments

    const bcAttachmentRegex = /<bc-attachment\s+([^>]+)>([\s\S]*?)<\/bc-attachment>/gi
    let match
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1]
        
        const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }
        
        const contentType = getAttr('content-type') || ''
        const filename = getAttr('filename') || 'attachment'
        const href = getAttr('href') || ''
        const url = getAttr('url') || href || ''
        
        attachments.push({
            contentType,
            filename,
            href,
            url
        })
    }

    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let imgMatch
    while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1]
        const isAlreadyCaptured = attachments.some(a => {
            const srcUuid = getBlobUuid(src)
            const aUrlUuid = getBlobUuid(a.url)
            const aHrefUuid = getBlobUuid(a.href)
            
            if (srcUuid && (srcUuid === aUrlUuid || srcUuid === aHrefUuid)) {
                return true
            }
            
            const srcKey = src.split('/').pop()?.split('?')[0]
            const aUrlKey = a.url.split('/').pop()?.split('?')[0]
            const aHrefKey = a.href.split('/').pop()?.split('?')[0]
            return srcKey && (srcKey === aUrlKey || srcKey === aHrefKey)
        })
        if (isAlreadyCaptured) {
            continue;
        }
        
        let filename = 'Image'
        const altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i)
        if (altMatch) {
            filename = altMatch[1]
        } else {
            const lastPart = src.split('/').pop()?.split('?')[0] || 'image.png'
            filename = lastPart === 'full' ? 'Image' : lastPart
        }
        
        attachments.push({
            contentType: 'image/png',
            filename,
            href: src,
            url: src
        })
    }
    
    return attachments
}

async function main() {
    // Let's search specifically for the Norwalk todo BC ID: 9287087501
    const { data: todos } = await supabaseAdmin
        .from('bc_todos')
        .select('*')
        .eq('bc_id', 9287087501);

    console.log('Found Norwalk todos count:', todos?.length);
    if (todos && todos.length > 0) {
        const todo = todos[0];
        console.log('Todo Title:', todo.title);
        console.log('Todo BC ID:', todo.bc_id);
        const parsed = parseAttachments(todo.description);
        console.log('Parsed attachments final count:', parsed.length);
        console.log('Parsed attachments list:', parsed.map(p => p.filename));
    }
}

main().catch(console.error);
