import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { getValidToken } from '../lib/basecamp-api'

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
            const srcKey = src.split('/').pop()?.split('?')[0]
            const aUrlKey = a.url.split('/').pop()?.split('?')[0]
            const aHrefKey = a.href.split('/').pop()?.split('?')[0]
            return srcKey && (srcKey === aUrlKey || srcKey === aHrefKey)
        })
        if (isAlreadyCaptured) continue
        
        let filename = 'Image'
        const altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i)
        if (altMatch) {
            filename = altMatch[1]
        } else {
            filename = src.split('/').pop()?.split('?')[0] || 'image.png'
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

async function run() {
    try {
        const token = await getValidToken()
        const projectId = '21853276'
        const todoId = '9287087501'
        const accountId = process.env.BASECAMP_ACCOUNT_ID
        const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todos/${todoId}.json`
        
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'SM-TEG-Sync (carlos@tacosgavilan.com)'
            }
        })
        
        if (res.ok) {
            const data = await res.json()
            const desc = data.description || ''
            const atts = parseAttachments(desc)
            console.log('Parsed attachments count:', atts.length)
            console.log('Parsed attachments:', JSON.stringify(atts, null, 2))
        } else {
            console.log('Failed:', res.status, await res.text())
        }
    } catch (e: any) {
        console.error('Error:', e.message)
    }
}
run()
