/**
 * @module ToolMessages
 * @description Módulo de Tablero de Anuncios (Message Board) con paridad 100% Basecamp 3/4 para Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_message_boards, bc_messages, bc_comments, bc_boosts)
 *              y ejecuta mutaciones bidireccionales + notificaciones por correo vía /api/basecamp/action.
 * @businessRules
 *   - Tablero de anuncios por proyecto con soporte completo de formato enriquecido Trix (`BasecampRichEditor`), `@menciones`,
 *     fotos inline con zoom Lightbox y videos inline (`<video controls preload="metadata" playsInline>`, `.mov`/`.mp4`/`.webm`)
 *     con botón directo de descarga (`⬇ Descargar video`).
 *   - Soporta las 5 categorías oficiales de Basecamp (`📢 Announcement`, `✨ FYI`, `❤️ Heartbeat`, `💡 Pitch`, `👋 Question`)
 *     manteniendo compatibilidad retroactiva total con categorías históricas en DB (`General`, `Procedimiento`, `Alerta`, `Idea`).
 *   - Anuncios fijados (`is_pinned === true`, `pin_message` / `unpin_message`) aparecen siempre arriba con badge `📌 Fijado`,
 *     combinados con selector de ordenamiento de 4 modos (`Más recientes`, `Último comentario`, `Más antiguos`, `Alfabético A–Z`).
 *   - Función `📋 Replicar anuncio` disponible desde cada fila del listado, barra superior del detalle, menús `•••` y deep-link
 *     `?replicateMessageId=` del buscador global (`Shift + J`), precargando categoría, título y HTML + fotos/videos/adjuntos
 *     vía `prepareHtmlForTaskReplication`.
 *   - Selector real de destinatarios de correo al publicar (`notifyMode`: `'all' | 'selected' | 'none'` + `notifyPersonUuids`).
 * @dataFlow
 *   - Entrada: Props `project` (`db_id`, `id` = `bc_id`, `people`), `currentUserName`, `selectedMessageId` / `messageId`,
 *     `replicateMessageId`, `onCloseDetail` y `onConsumeReplicateMessage`.
 *   - Lectura: Supabase (`bc_message_boards`, `bc_messages`, `bc_comments`, `bc_boosts`, `bc_people`) + suscripción Realtime.
 *   - Escritura: `POST /api/basecamp/action` (`create_message`, `update_message`, `pin_message`, `unpin_message`,
 *     `delete_recording`, `create_comment`, `update_comment`, `create_boost`, `delete_boost`).
 * @notes
 *   - 100% bilingüe (`es`/`en`) mediante `useLanguage()`.
 *   - En anuncios con video de Basecamp (ej. `Toast taco Tuesday solución`, `IMG_5298.mov`), descarta el `<img>` interno
 *     de `<figure>` dentro de `<bc-attachment content-type="video/...">` para evitar íconos de imagen rota en Chrome/Windows
 *     y renderiza un reproductor `<video>` nativo limpio con descarga directa.
 *   - Jerarquía estricta de stacking contexts (`z-index`): cabecera de filtros y cabecera de detalle con `relative z-40`,
 *     filas de anuncios y comentarios con menú `•••` o `🚀 Boost` activos elevados dinámicamente a `relative z-40`
 *     (sobre hermanos `relative z-0` y compositor `relative z-10`) e inversión hacia arriba cerca del borde inferior.
 *   - Deep-link en carga fría (`selectedMessageId` / `messageId`): soporta tanto `UUID` (`id`) como `bc_id` numérico,
 *     con fallback directo a `bc_messages` cuando el anuncio no está en el lote cargado en memoria.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    Mail, Plus, MessageSquare, Trash2, Loader2, FileText, Paperclip,
    Pencil, MoreHorizontal, Reply, Rocket, Link2, Check, Download, Pin, Search, X
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner, normalizePersonName, isMaskedOrEmptyEmail } from '@/lib/basecamp-person-resolver'
import {
    proxyBasecampUrl,
    BASECAMP_PROXYABLE_HOSTS,
    rewriteBasecampHtmlUrls,
    safeDecodeFilename,
    sanitizeBasecampHtml,
    injectImageDownloadOverlays,
    triggerBasecampDownload,
    buildBasecampDirectDownloadHref,
    isBasecampMentionAttachment,
    transformBasecampMentionsToPills,
    hasRichContentOrMedia,
    prepareHtmlForTaskReplication,
    isVideoMimeOrFilename,
    BASECAMP_IMAGE_HOVER_CSS,
} from '@/lib/basecamp-html'
import BasecampRichEditor, { type BasecampPersonOption } from '@/components/basecamp/BasecampRichEditor'

export { sanitizeBasecampHtml }

const IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|bmp|svg|heic|heif|avif)(?:$|[?#])/i

const getBlobUuid = (url?: string | null) => {
    if (!url) return null
    const match = String(url).match(/\/blobs\/([a-f0-9-]+)/i)
    return match ? match[1] : null
}

const normalizeUrlDedupKey = (raw?: string | null): string => {
    if (!raw) return ''
    const trimmed = String(raw).trim().replace(/&amp;/gi, '&')
    if (trimmed.startsWith('/api/basecamp/attachment?')) {
        try {
            const qs = new URLSearchParams(trimmed.split('?')[1] || '')
            const inner = qs.get('url')
            if (inner) return normalizeUrlDedupKey(inner)
        } catch {
            // ignore
        }
    }
    const uuid = getBlobUuid(trimmed)
    if (uuid) return `blob:${uuid.toLowerCase()}`
    return trimmed.split('?')[0].split('#')[0].toLowerCase()
}

const normalizeSearch = (raw?: string | null): string =>
    (raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()

const plainTextToHtml = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    return trimmed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\r?\n/g, '<br>')
}

const buildActionHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (typeof window !== 'undefined') {
        try {
            const token = window.localStorage.getItem('teg_token')
            if (token) headers['Authorization'] = `Bearer ${token}`
        } catch {
            // ignore storage errors
        }
    }
    return headers
}

export interface ParsedMessageAttachment {
    contentType: string
    filename: string
    href: string
    url: string
    kind: 'image' | 'video' | 'file'
}

const parseAttachments = (html: string): ParsedMessageAttachment[] => {
    const attachments: ParsedMessageAttachment[] = []
    if (!html) return attachments

    const seenKeys = new Set<string>()
    const pushUnique = (entry: ParsedMessageAttachment) => {
        const candidateUrl = entry.url || entry.href
        const key = normalizeUrlDedupKey(candidateUrl) || `fn:${entry.filename.toLowerCase()}`
        if (key && seenKeys.has(key)) return
        if (key) seenKeys.add(key)
        attachments.push(entry)
    }

    // 1. <bc-attachment ...> (Basecamp native & BasecampRichEditor / replicated attachments)
    const bcAttachmentRegex = /<bc-attachment\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
    let match: RegExpExecArray | null
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1] || ''
        const innerHtml = match[2] || ''
        if (isBasecampMentionAttachment(attrsStr) || /\bdata-teg-mention-person-id=/i.test(attrsStr)) {
            continue
        }

        const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }

        const contentType = getAttr('content-type') || ''
        const filename = getAttr('filename') || ''
        const href = getAttr('href') || ''
        let url = getAttr('url') || href || ''
        if (!url) {
            const innerSrc =
                innerHtml.match(/<video[^>]+src=["']([^"']+)["']/i)?.[1] ||
                innerHtml.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
                innerHtml.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1] ||
                ''
            url = innerSrc
        }
        if (!url && !href && !filename) continue

        const isVideo = isVideoMimeOrFilename(contentType, filename, url || href)
        const isImage =
            !isVideo &&
            (contentType.toLowerCase().startsWith('image/') ||
                IMAGE_EXT_RE.test(filename) ||
                IMAGE_EXT_RE.test(url || href))

        pushUnique({
            contentType,
            filename: filename || (isVideo ? 'video.mp4' : isImage ? 'Image' : 'Attachment'),
            href: href || url,
            url: url || href,
            kind: isVideo ? 'video' : isImage ? 'image' : 'file',
        })
    }

    // Strip <bc-attachment> blocks before scanning loose tags so inner <figure><img>/<video>/<a> are not double-counted
    const outsideBcAtt = html
        .replace(/<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi, ' ')
        .replace(/<bc-attachment\b[^>]*\/>/gi, ' ')

    // 2. Loose <video> tags
    const videoRegex = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi
    while ((match = videoRegex.exec(outsideBcAtt)) !== null) {
        const vAttrs = match[1] || ''
        const vInner = match[2] || ''
        const src =
            vAttrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] ||
            vInner.match(/<source[^>]+src=["']([^"']+)["']/i)?.[1] ||
            ''
        if (!src) continue
        const lastPart = safeDecodeFilename(src.split('?')[0].split('/').pop() || 'video.mp4')
        pushUnique({
            contentType: 'video/mp4',
            filename: lastPart || 'video.mp4',
            href: src,
            url: src,
            kind: 'video',
        })
    }

    // 3. Replicated / editor <p data-teg-attachment="true"><a href="...">📎 filename</a></p> blocks
    const tegAttParaRegex = /<p\b[^>]*\bdata-teg-attachment=["']true["'][^>]*>([\s\S]*?)<\/p>/gi
    while ((match = tegAttParaRegex.exec(outsideBcAtt)) !== null) {
        const pInner = match[1] || ''
        const aMatch = pInner.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i)
        if (!aMatch) continue
        const href = aMatch[1]?.match(/\bhref=["']([^"']+)["']/i)?.[1] || ''
        if (!href || href === '#') continue
        const rawLabel = (aMatch[2] || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/^(?:📎|🎬|🖼️)\s*/u, '')
            .replace(/\s*\(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B)\)\s*$/i, '')
            .trim()
        const isVideo = isVideoMimeOrFilename('', rawLabel, href)
        const isImage = !isVideo && (IMAGE_EXT_RE.test(rawLabel) || IMAGE_EXT_RE.test(href))
        pushUnique({
            contentType: isVideo ? 'video/mp4' : isImage ? 'image/png' : 'application/octet-stream',
            filename: rawLabel || safeDecodeFilename(href.split('?')[0].split('/').pop() || 'Attachment'),
            href,
            url: href,
            kind: isVideo ? 'video' : isImage ? 'image' : 'file',
        })
    }

    // 4. Loose <img> tags (excluding mention mini-avatars)
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let imgMatch: RegExpExecArray | null
    while ((imgMatch = imgRegex.exec(outsideBcAtt)) !== null) {
        const fullTag = imgMatch[0]
        if (
            /\bclass=["'][^"']*\bavatar\b/i.test(fullTag) ||
            /\bdata-avatar-for-person-id=/i.test(fullTag) ||
            /\bdata-bc-avatar=/i.test(fullTag)
        ) {
            continue
        }
        const src = imgMatch[1]
        if (!src || src.includes('attachment-icon')) continue

        let filename = 'Image'
        const altMatch = fullTag.match(/alt=["']([^"']+)["']/i)
        if (altMatch?.[1]) {
            filename = altMatch[1]
        } else {
            const lastPart = safeDecodeFilename(src.split('/').pop()?.split('?')[0] || 'image.png')
            filename = lastPart === 'full' ? 'Image' : lastPart
        }

        const isVideo = isVideoMimeOrFilename('', filename, src)
        pushUnique({
            contentType: isVideo ? 'video/quicktime' : 'image/png',
            filename,
            href: src,
            url: src,
            kind: isVideo ? 'video' : 'image',
        })
    }

    return attachments
}

const rewriteHtmlUrls = (html: string) => {
    if (!html) return ''
    const withPills = transformBasecampMentionsToPills(
        html.replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    )
    const withoutRemainingBcAtt = withPills
        .replace(/<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (_m, inner) => inner || '')
        .replace(/<bc-attachment\b[^>]*\/>/gi, '')
    return rewriteBasecampHtmlUrls(withoutRemainingBcAtt)
}

export const prepareRichContent = (rawHtml?: string | null) => {
    if (!rawHtml) {
        return {
            sanitizedHtml: '',
            videoAttachments: [] as ParsedMessageAttachment[],
            nonImageAttachments: [] as ParsedMessageAttachment[],
            allAttachments: [] as ParsedMessageAttachment[],
        }
    }
    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')

    const allAttachments = parseAttachments(cleaned)
    const videoAttachments = allAttachments.filter(a => a.kind === 'video')
    const nonImageAttachments = allAttachments.filter(a => a.kind === 'file')

    const withMentionPills = transformBasecampMentionsToPills(cleaned)
    const strippedBcHtml = withMentionPills
        .replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (_match, attrs: string, inner: string) => {
            const ct = (attrs.match(/\bcontent-type=["']([^"']+)["']/i)?.[1] || '').trim()
            const fn = (attrs.match(/\bfilename=["']([^"']+)["']/i)?.[1] || '').trim()
            const rawUrl = (
                attrs.match(/\burl=["']([^"']+)["']/i)?.[1] ||
                attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] ||
                ''
            ).trim()
            // Critical: never keep <figure><img src="...mov"></figure> inside video <bc-attachment>
            if (isVideoMimeOrFilename(ct, fn, rawUrl)) {
                return ''
            }
            if (/<img\b[^>]+>/i.test(inner)) {
                const innerImgSrc = inner.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || ''
                if (isVideoMimeOrFilename('', fn, innerImgSrc)) return ''
                return inner
            }
            return ''
        })
        .replace(/<bc-attachment\b[^>]*\/>/gi, '')
        .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '')
        .replace(/<p\b[^>]*\bdata-teg-attachment=["']true["'][^>]*>[\s\S]*?<\/p>/gi, '')
        .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (fullImg, srcVal: string) => {
            if (isVideoMimeOrFilename('', '', srcVal)) return ''
            return fullImg
        })
        .trim()

    const sanitizedHtml = rewriteHtmlUrls(strippedBcHtml)
    return { sanitizedHtml, videoAttachments, nonImageAttachments, allAttachments }
}

const sanitizeAttachmentHref = (rawUrl?: string): string => {
    if (!rawUrl || typeof rawUrl !== 'string') return '#'
    const trimmed = rawUrl.trim().replace(/&amp;/g, '&')
    if (trimmed.startsWith('/api/basecamp/attachment?')) return trimmed
    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'https:') return '#'
        const host = parsed.hostname.toLowerCase()
        if (host.endsWith('.supabase.co')) {
            if (
                parsed.pathname.startsWith('/storage/v1/object/public/checklist-photos/basecamp-attachments/') &&
                isVideoMimeOrFilename(null, null, parsed.pathname)
            ) {
                return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
            }
            return proxyBasecampUrl(parsed.toString())
        }
        if (host.endsWith('.amazonaws.com')) return parsed.toString()
        if (BASECAMP_PROXYABLE_HOSTS.has(host)) {
            return proxyBasecampUrl(parsed.toString())
        }
        return '#'
    } catch {
        return '#'
    }
}

export const prepareMessageHtmlForEdit = (rawHtml?: string | null): string => {
    if (!rawHtml) return ''
    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')

    const escapeAttr = (s: string) =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    const escapeText = (s: string) =>
        String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')

    const withFixedBcVideos = cleaned.replace(
        /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi,
        (full, attrs: string, inner: string) => {
            if (isBasecampMentionAttachment(attrs) || /\bdata-teg-mention-person-id=/i.test(attrs)) {
                return full
            }
            const ct = (attrs.match(/\bcontent-type=["']([^"']+)["']/i)?.[1] || '').trim()
            const fn = (attrs.match(/\bfilename=["']([^"']+)["']/i)?.[1] || '').trim()
            const rawUrl = (
                attrs.match(/\burl=["']([^"']+)["']/i)?.[1] ||
                attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] ||
                ''
            ).trim()
            const innerImgSrc = inner.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || ''
            const innerVideoSrc = inner.match(/<video[^>]+src=["']([^"']+)["']/i)?.[1] || ''
            const candidateUrl = rawUrl || innerVideoSrc || innerImgSrc

            if (!isVideoMimeOrFilename(ct, fn, candidateUrl)) {
                return full
            }

            const sgid = (
                attrs.match(/\bsgid=["']([^"']+)["']/i)?.[1] ||
                attrs.match(/\bdata-orig-bc-sgid=["']([^"']+)["']/i)?.[1] ||
                ''
            ).trim()
            const safeHref = sanitizeAttachmentHref(candidateUrl)
            const displayFilename =
                safeDecodeFilename(fn) ||
                safeDecodeFilename(candidateUrl.split('?')[0].split('/').pop() || '') ||
                'video.mp4'
            const videoMime = ct.toLowerCase().startsWith('video/')
                ? ct
                : /\.webm(?:$|[?#])/i.test(displayFilename)
                  ? 'video/webm'
                  : /\.mov(?:$|[?#])/i.test(displayFilename)
                    ? 'video/quicktime'
                    : 'video/mp4'
            const sgidAttrs = sgid
                ? ` sgid="${escapeAttr(sgid)}" data-orig-bc-sgid="${escapeAttr(sgid)}"`
                : ''
            const playerHtml =
                safeHref && safeHref !== '#'
                    ? `<video controls preload="metadata" playsinline src="${escapeAttr(safeHref)}" style="max-width: 100%; max-height: 320px; border-radius: 8px; background: #0F172A; display: block; margin: 6px 0;"></video>`
                    : ''
            return `<bc-attachment${sgidAttrs} content-type="${escapeAttr(videoMime)}" filename="${escapeAttr(displayFilename)}" url="${escapeAttr(safeHref)}" href="${escapeAttr(safeHref)}" data-teg-attachment="true">${playerHtml}<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer" contenteditable="false" style="display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">🎬 ${escapeText(displayFilename)}</a></bc-attachment>`
        }
    )

    // Convert any loose <img src="...mov/mp4/webm"> outside <bc-attachment> into <video>
    return withFixedBcVideos.replace(/<img\b([^>]*)>/gi, (fullImg, imgAttrs: string) => {
        if (
            /\bclass=["'][^"']*\bavatar\b/i.test(imgAttrs) ||
            /\bdata-avatar-for-person-id=/i.test(imgAttrs) ||
            /\bdata-bc-avatar=/i.test(imgAttrs)
        ) {
            return fullImg
        }
        const srcVal = (imgAttrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] || '').trim()
        const altVal = (imgAttrs.match(/\balt=["']([^"']+)["']/i)?.[1] || '').trim()
        if (!srcVal || !isVideoMimeOrFilename(null, altVal, srcVal)) return fullImg
        const safeHref = sanitizeAttachmentHref(srcVal)
        if (!safeHref || safeHref === '#') return ''
        return `<video controls preload="metadata" playsinline src="${escapeAttr(safeHref)}" style="max-width: 100%; max-height: 320px; border-radius: 8px; background: #0F172A; display: block; margin: 6px 0;"></video>`
    })
}

const stripHtml = (html?: string | null): string => {
    if (!html) return ''
    const withPills = transformBasecampMentionsToPills(
        stripTegAuthorBanner(html).cleanHtml
            .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    )
    const withoutBanner = withPills
        .replace(/<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi, ' ')
        .replace(/<bc-attachment\b[^>]*\/>/gi, ' ')
    return withoutBanner
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim()
}

const SHORT_ACK_PHRASES = new Set([
    'ok', 'okay', 'okey', 'gracias', 'muchas gracias', 'entendido',
    'enterado', 'enterada', 'recibido', 'listo', 'perfecto', 'de acuerdo',
    'copiado', 'thank you', 'thanks', 'got it', 'understood', 'noted',
    'roger', '10-4', 'si', 'claro'
])

const isShortAckBoost = (rawHtml?: string | null): boolean => {
    const plain = stripHtml(rawHtml)
    if (!plain || plain.length > 35) return false
    if (/^(?:👍|👌|✅|🙌|🙏)+$/u.test(plain.trim())) return true
    const norm = plain
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¡¿!.,👍👌✅🙌🙏]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!norm || norm.startsWith('no ') || norm.includes(' pero ')) return false
    return SHORT_ACK_PHRASES.has(norm)
}

const getAuthorObj = (rel: any) => (Array.isArray(rel) ? rel[0] : rel)

const AVATAR_COLORS = [
    '#E74C3C', '#27AE60', '#F39C12', '#8E44AD', '#1ABC9C',
    '#D35400', '#2980B9', '#C0392B', '#16A085', '#F1C40F',
    '#9B59B6', '#34495E', '#3498DB'
]

const getAvatarColor = (name: string) => {
    if (!name) return '#95A5A6'
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const getInitials = (name: string) => {
    if (!name) return 'U'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
}

type CanonicalCategory =
    | 'announcement'
    | 'fyi'
    | 'heartbeat'
    | 'pitch'
    | 'question'
    | 'general'
    | 'guide'
    | 'alert'
    | string

const stripLeadingCategoryEmoji = (raw: string): string =>
    String(raw || '')
        .replace(/^(?:📢|ℹ️|✨|❤️|❤|💡|👋|❓|💬|📋|⚠️|⚠)\uFE0F?\s*/u, '')
        .trim()

const getCanonicalCategory = (raw?: string | null): CanonicalCategory => {
    const norm = normalizeSearch(raw)
    if (!norm || norm === 'general') return 'general'
    if (norm.includes('anuncio') || norm.includes('announcement')) return 'announcement'
    if (norm === 'fyi' || norm.includes('fyi') || norm.includes('informacion') || norm.includes('aviso')) return 'fyi'
    if (norm.includes('heartbeat') || norm.includes('pulso')) return 'heartbeat'
    if (norm.includes('pitch') || norm.includes('propuesta') || norm.includes('idea')) return 'pitch'
    if (norm.includes('question') || norm.includes('pregunta')) return 'question'
    if (norm.includes('procedimiento') || norm.includes('procedure') || norm.includes('guide') || norm.includes('proc')) return 'guide'
    if (norm.includes('alerta') || norm.includes('alert') || norm.includes('urgent')) return 'alert'
    return norm
}

// The 5 official Basecamp categories + 'General' for historical DB compatibility
const BASECAMP_CATEGORY_OPTIONS = [
    { value: 'Announcement', canonical: 'announcement' },
    { value: 'FYI', canonical: 'fyi' },
    { value: 'Heartbeat', canonical: 'heartbeat' },
    { value: 'Pitch', canonical: 'pitch' },
    { value: 'Question', canonical: 'question' },
]

const CATEGORY_FILTER_OPTIONS = [
    ...BASECAMP_CATEGORY_OPTIONS,
    { value: 'General', canonical: 'general' },
]

const resolveCategorySelectValue = (rawCategory?: string | null): string => {
    const canon = getCanonicalCategory(rawCategory)
    switch (canon) {
        case 'announcement': return 'Announcement'
        case 'fyi': return 'FYI'
        case 'heartbeat': return 'Heartbeat'
        case 'pitch': return 'Pitch'
        case 'question': return 'Question'
        case 'general': return 'General'
        case 'guide': return 'Procedimiento'
        case 'alert': return 'Alerta'
        default: return rawCategory?.trim() || 'Announcement'
    }
}

type MessageSortOrder = 'newest' | 'latest_comment' | 'oldest' | 'alphabetical'

const QUICK_BOOST_PRESETS = ['👍', '🚀', '✅', '🙌', '❤️', 'Ok', 'Gracias']

const wasRecordEdited = (createdAt?: string | null, updatedAt?: string | null): boolean => {
    if (!createdAt || !updatedAt) return false
    const cMs = new Date(createdAt).getTime()
    const uMs = new Date(updatedAt).getTime()
    return Number.isFinite(cMs) && Number.isFinite(uMs) && uMs - cMs > 60_000
}

interface ToolMessagesProps {
    project: any
    currentUserName: string
    selectedMessageId?: string
    messageId?: string
    replicateMessageId?: string
    onCloseDetail?: () => void
    onConsumeReplicateMessage?: () => void
}

export default function ToolMessages({
    project,
    currentUserName,
    selectedMessageId,
    messageId,
    replicateMessageId,
    onCloseDetail,
    onConsumeReplicateMessage,
}: ToolMessagesProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const [messages, setMessages] = useState<any[]>([])
    const [board, setBoard] = useState<{ id: string; bc_id: number } | null>(null)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [mutationError, setMutationError] = useState<string | null>(null)

    // Estados de navegación interna
    const [selectedMessage, setSelectedMessage] = useState<any | null>(null)
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [selectedMessageComments, setSelectedMessageComments] = useState<any[]>([])
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
    const [commentsLoading, setCommentsLoading] = useState(false)

    // Directorio enriquecido de personas para autocompletado @menciones
    const [directoryPeople, setDirectoryPeople] = useState<BasecampPersonOption[]>([])

    // Formulario de nuevo anuncio / replicación (Rich Editor + Notificaciones)
    const [newTitle, setNewTitle] = useState('')
    const [newContent, setNewContent] = useState('')
    const [newCategory, setNewCategory] = useState('Announcement')
    const [createEditorKey, setCreateEditorKey] = useState(1)
    const [replicatingBannerTitle, setReplicatingBannerTitle] = useState<string | null>(null)
    const [replicatingMsgId, setReplicatingMsgId] = useState<string | null>(null)

    // Selector "When I post this, send email to:" (notifyMode + notifyPersonUuids)
    const [notifyMode, setNotifyMode] = useState<'all' | 'selected' | 'none'>('all')
    const [notifyPersonUuids, setNotifyPersonUuids] = useState<string[]>([])
    const [notifySearchQuery, setNotifySearchQuery] = useState('')

    // Edición de anuncio existente (update_message) + menús •••
    const [isEditingMessage, setIsEditingMessage] = useState(false)
    const [editMsgTitle, setEditMsgTitle] = useState('')
    const [editMsgCategory, setEditMsgCategory] = useState('Announcement')
    const [editMsgContent, setEditMsgContent] = useState('')
    const [editMsgEditorKey, setEditMsgEditorKey] = useState(1)
    const [copiedLink, setCopiedLink] = useState(false)
    const [showDetailMoreMenu, setShowDetailMoreMenu] = useState(false)
    const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null)
    const [rowMenuUp, setRowMenuUp] = useState(false)
    const [pinBusyId, setPinBusyId] = useState<string | null>(null)

    // Formulario de comentario, edición de comentario y filtros
    const [commentText, setCommentText] = useState('')
    const [commentEditorKey, setCommentEditorKey] = useState(1)
    const [commentFocusSeq, setCommentFocusSeq] = useState(0)
    const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(null)
    const [commentMenuUp, setCommentMenuUp] = useState(false)
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    const [editingCommentHtml, setEditingCommentHtml] = useState('')
    const [editingCommentKey, setEditingCommentKey] = useState(1)

    // Boosts nativos (bc_boosts: anuncio + comentarios)
    const [messageNativeBoosts, setMessageNativeBoosts] = useState<any[]>([])
    const [commentBoostsById, setCommentBoostsById] = useState<Record<string, any[]>>({})
    const [activeBoostPickerKey, setActiveBoostPickerKey] = useState<string | null>(null)
    const [boostMenuDown, setBoostMenuDown] = useState(false)
    const [boostMenuOffsetX, setBoostMenuOffsetX] = useState(0)
    const [customBoostText, setCustomBoostText] = useState('')
    const [boostBusyKey, setBoostBusyKey] = useState<string | null>(null)

    const [filterText, setFilterText] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
    const [showCategoryMenu, setShowCategoryMenu] = useState(false)
    const [sortOrder, setSortOrder] = useState<MessageSortOrder>('newest')
    const [showSortMenu, setShowSortMenu] = useState(false)

    // Miembros exclusivos del proyecto (para el selector "Al publicar este anuncio, enviar correo a:")
    const projectPeople = useMemo<BasecampPersonOption[]>(() => {
        const merged = new Map<string, BasecampPersonOption>()
        ;(project?.people || []).forEach((p: any) => {
            if (!p || !p.id || !p.name) return
            const key = String(p.id)
            if (merged.has(key)) return
            const cleanEmail = isMaskedOrEmptyEmail(p.email) ? '' : String(p.email || '')
            merged.set(key, {
                id: String(p.id),
                bc_id: p.bc_id ?? null,
                name: String(p.name),
                email: cleanEmail,
                title: p.title || '',
                role: p.role || 'user',
                avatar: p.avatar || p.avatar_url || '',
                avatar_url: p.avatar_url || p.avatar || '',
                attachable_sgid: p.attachable_sgid || null,
            })
        })
        return Array.from(merged.values())
    }, [project?.people])

    const editorPeople = useMemo<BasecampPersonOption[]>(() => {
        const merged = new Map<string, BasecampPersonOption>()
        const pushPerson = (p: any) => {
            if (!p || !p.id || !p.name) return
            const key = normalizePersonName(p.name) || String(p.id)
            const cleanEmail = isMaskedOrEmptyEmail(p.email) ? '' : String(p.email || '')
            const existing = merged.get(key)
            if (existing) {
                if (!existing.attachable_sgid && p.attachable_sgid) existing.attachable_sgid = p.attachable_sgid
                if (!existing.email && cleanEmail) existing.email = cleanEmail
                if (!existing.title && p.title) existing.title = p.title
                if (!existing.avatar_url && (p.avatar_url || p.avatar)) {
                    existing.avatar_url = p.avatar_url || p.avatar
                    existing.avatar = p.avatar || p.avatar_url
                }
                return
            }
            merged.set(key, {
                id: String(p.id),
                bc_id: p.bc_id ?? null,
                name: String(p.name),
                email: cleanEmail,
                title: p.title || '',
                role: p.role || 'user',
                avatar: p.avatar || p.avatar_url || '',
                avatar_url: p.avatar_url || p.avatar || '',
                attachable_sgid: p.attachable_sgid || null,
            })
        }
        ;(project?.people || []).forEach(pushPerson)
        directoryPeople.forEach(pushPerson)
        return Array.from(merged.values())
    }, [project?.people, directoryPeople])

    const notifyCandidates = useMemo(() => {
        const base = projectPeople.length > 0 ? projectPeople : editorPeople
        const q = normalizeSearch(notifySearchQuery)
        const qPerson = normalizePersonName(notifySearchQuery)
        if (!q) return base
        return base.filter((p) => {
            const nameNorm = normalizeSearch(p.name)
            const emailNorm = normalizeSearch(p.email)
            const titleNorm = normalizeSearch(p.title)
            return (
                nameNorm.includes(q) ||
                emailNorm.includes(q) ||
                titleNorm.includes(q) ||
                (qPerson.length > 0 && normalizePersonName(p.name).includes(qPerson))
            )
        })
    }, [projectPeople, editorPeople, notifySearchQuery])

    const categoryMenuRef = useRef<HTMLDivElement>(null)
    const sortMenuRef = useRef<HTMLDivElement>(null)
    const detailMoreMenuRef = useRef<HTMLDivElement>(null)
    const createFormRef = useRef<HTMLDivElement>(null)
    const createTitleInputRef = useRef<HTMLInputElement>(null)
    const inFlightBoardCreateRef = useRef(false)
    const consumedReplicateMsgRef = useRef<string | null>(null)
    const activeMessageIdRef = useRef<string | null>(null)
    const openedDeepLinkMsgRef = useRef<string | null>(null)
    const loadedMsgsProjectIdRef = useRef<string | null>(null)
    activeMessageIdRef.current = selectedMessage?.id || null

    const getCategoryDisplayLabel = useCallback((rawCategory?: string | null): string => {
        const canon = getCanonicalCategory(rawCategory)
        switch (canon) {
            case 'announcement':
                return `📢 ${stripLeadingCategoryEmoji(t('basecamp.cat_announcement'))}`
            case 'fyi':
                return `✨ ${stripLeadingCategoryEmoji(t('basecamp.cat_fyi'))}`
            case 'heartbeat':
                return `❤️ ${stripLeadingCategoryEmoji(t('basecamp.cat_heartbeat'))}`
            case 'pitch':
                return `💡 ${stripLeadingCategoryEmoji(t('basecamp.cat_pitch'))}`
            case 'question':
                return `👋 ${stripLeadingCategoryEmoji(t('basecamp.cat_question'))}`
            case 'general':
                return `💬 ${stripLeadingCategoryEmoji(t('basecamp.cat_general'))}`
            case 'guide':
                return t('basecamp.cat_guide')
            case 'alert':
                return t('basecamp.cat_alert')
            default:
                return `💬 ${rawCategory}`
        }
    }, [t])

    const getSortOrderLabel = useCallback((order: MessageSortOrder): string => {
        switch (order) {
            case 'newest': return t('basecamp.sort_newest_post')
            case 'latest_comment': return t('basecamp.sort_latest_comment')
            case 'oldest': return t('basecamp.sort_oldest_post')
            case 'alphabetical': return t('basecamp.sort_alphabetical')
        }
    }, [t])

    const formatMessageDate = useCallback((dateStr?: string | null) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return ''
        const locale = language === 'es' ? 'es-MX' : 'en-US'
        const msgYear = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Los_Angeles' }).format(d)
        const curYear = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date())
        return d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            ...(msgYear !== curYear ? { year: 'numeric' } : {}),
            timeZone: 'America/Los_Angeles'
        })
    }, [language])

    const formatMessageTime = useCallback((dateStr?: string | null) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return ''
        const locale = language === 'es' ? 'es-MX' : 'en-US'
        return d.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles'
        })
    }, [language])

    const closeMessageDetail = useCallback(() => {
        setSelectedMessage(null)
        setIsEditingMessage(false)
        setShowDetailMoreMenu(false)
        setEditingCommentId(null)
        setOpenCommentMenuId(null)
        setActiveBoostPickerKey(null)
        if (onCloseDetail) onCloseDetail()
    }, [onCloseDetail])

    const openFreshCreateForm = useCallback(() => {
        setReplicatingBannerTitle(null)
        setNewTitle('')
        setNewCategory('Announcement')
        setNewContent('')
        setCreateEditorKey(k => k + 1)
        setNotifyMode('all')
        setNotifyPersonUuids([])
        setNotifySearchQuery('')
        setSelectedMessage(null)
        setIsEditingMessage(false)
        setShowCreateForm(true)
    }, [])

    useEffect(() => {
        let cancelled = false
        supabase
            .from('bc_people')
            .select('id, bc_id, name, email, title, role, avatar_url, attachable_sgid, is_active')
            .eq('is_active', true)
            .order('name', { ascending: true })
            .limit(500)
            .then(({ data }) => {
                if (!cancelled && data) {
                    setDirectoryPeople(data as any[])
                }
            })
        return () => {
            cancelled = true
        }
    }, [supabase])

    // Close dropdown menus & boost popovers on outside click
    useEffect(() => {
        if (
            !showCategoryMenu &&
            !showSortMenu &&
            !showDetailMoreMenu &&
            !openRowMenuId &&
            !openCommentMenuId &&
            !activeBoostPickerKey
        ) {
            return
        }
        const handleOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null
            if (showCategoryMenu && categoryMenuRef.current && !categoryMenuRef.current.contains(target as Node)) {
                setShowCategoryMenu(false)
            }
            if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(target as Node)) {
                setShowSortMenu(false)
            }
            if (showDetailMoreMenu && detailMoreMenuRef.current && !detailMoreMenuRef.current.contains(target as Node)) {
                setShowDetailMoreMenu(false)
            }
            if (openRowMenuId && !target?.closest('[data-msg-row-menu="true"]')) {
                setOpenRowMenuId(null)
            }
            if (openCommentMenuId && !target?.closest('[data-msg-comment-menu="true"]')) {
                setOpenCommentMenuId(null)
            }
            if (activeBoostPickerKey && !target?.closest('[data-msg-boost-popover="true"]')) {
                setActiveBoostPickerKey(null)
            }
        }
        document.addEventListener('mousedown', handleOutside)
        return () => document.removeEventListener('mousedown', handleOutside)
    }, [showCategoryMenu, showSortMenu, showDetailMoreMenu, openRowMenuId, openCommentMenuId, activeBoostPickerKey])

    // Fetch message board and messages from Supabase
    const fetchBoardAndMessages = useCallback(async (opts?: { silent?: boolean }) => {
        if (!project.db_id) return
        if (!opts?.silent) setLoading(true)
        try {
            // 1. Get all Message Board containers for the project
            const { data: dbBoards, error: boardErr } = await supabase
                .from('bc_message_boards')
                .select('id, bc_id')
                .eq('project_id', project.db_id)
                .order('created_at', { ascending: true })

            if (boardErr) throw boardErr

            let dbBoard: { id: string; bc_id: number } | null = null
            if (dbBoards && dbBoards.length > 0) {
                const dummyBcId = Number(project.id) + 2000
                dbBoard = dbBoards.find(b => Number(b.bc_id) !== dummyBcId) || dbBoards[0]
            }

            if (!dbBoard && !inFlightBoardCreateRef.current) {
                inFlightBoardCreateRef.current = true
                try {
                    const tempBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
                    const { data: newBoard } = await supabase
                        .from('bc_message_boards')
                        .insert({
                            project_id: project.db_id,
                            bc_id: tempBcId
                        })
                        .select('id, bc_id')
                        .maybeSingle()

                    if (newBoard) {
                        dbBoard = newBoard
                    } else {
                        const { data: fallbackBoard } = await supabase
                            .from('bc_message_boards')
                            .select('id, bc_id')
                            .eq('project_id', project.db_id)
                            .order('created_at', { ascending: true })
                            .limit(1)
                            .maybeSingle()
                        dbBoard = fallbackBoard
                    }
                } finally {
                    inFlightBoardCreateRef.current = false
                }
            }

            if (dbBoard) {
                setBoard({ id: dbBoard.id, bc_id: Number(dbBoard.bc_id) })
            }

            // 2. Fetch messages belonging to this project (by project_id to avoid splits/orphans)
            const { data: dbMessages, error: msgErr } = await supabase
                .from('bc_messages')
                .select(`
                    *,
                    author:bc_people!bc_messages_author_person_id_fkey(id, name, email)
                `)
                .eq('project_id', project.db_id)
                .order('is_pinned', { ascending: false })
                .order('created_at', { ascending: false })

            if (msgErr) throw msgErr
            setMessages(dbMessages || [])
            setSelectedMessage((prev: any) => {
                if (!prev) return null
                return (dbMessages || []).find((m: any) => m.id === prev.id) || prev
            })
        } catch (err: any) {
            console.error('❌ [ToolMessages Fetch] Error:', err.message)
        } finally {
            if (project.db_id) {
                loadedMsgsProjectIdRef.current = project.db_id
            }
            setLoading(false)
        }
    }, [project.db_id, project.id, supabase])

    // Fetch comments + native boosts for selected message and its comments
    const fetchSelectedMessageComments = useCallback(async (msgId: string, opts?: { silent?: boolean }) => {
        if (!msgId) return
        if (!opts?.silent) setCommentsLoading(true)
        try {
            const [commentsRes, msgBoostsRes] = await Promise.all([
                supabase
                    .from('bc_comments')
                    .select('*, author:bc_people(id, name, email, avatar_url)')
                    .eq('parent_type', 'message')
                    .eq('parent_id', msgId)
                    .order('created_at', { ascending: true }),
                supabase
                    .from('bc_boosts')
                    .select('id, bc_id, recording_type, recording_id, booster_person_id, content, created_at, booster:bc_people!bc_boosts_booster_person_id_fkey(id, name, avatar_url)')
                    .eq('recording_type', 'message')
                    .eq('recording_id', msgId)
                    .order('created_at', { ascending: true }),
            ])

            if (commentsRes.error) throw commentsRes.error
            if (activeMessageIdRef.current !== msgId) return

            const commentsList = commentsRes.data || []
            setSelectedMessageComments(commentsList)
            setMessageNativeBoosts(msgBoostsRes.data || [])

            const commentIds = commentsList.map((c: any) => c.id).filter(Boolean)
            if (commentIds.length > 0) {
                const { data: cBoosts } = await supabase
                    .from('bc_boosts')
                    .select('id, bc_id, recording_type, recording_id, booster_person_id, content, created_at, booster:bc_people!bc_boosts_booster_person_id_fkey(id, name, avatar_url)')
                    .eq('recording_type', 'comment')
                    .in('recording_id', commentIds)
                    .order('created_at', { ascending: true })
                if (activeMessageIdRef.current === msgId) {
                    const grouped: Record<string, any[]> = {}
                    ;(cBoosts || []).forEach((b: any) => {
                        const rid = String(b.recording_id)
                        if (!grouped[rid]) grouped[rid] = []
                        grouped[rid].push(b)
                    })
                    setCommentBoostsById(grouped)
                }
            } else {
                setCommentBoostsById({})
            }
        } catch (err: any) {
            console.error('❌ [ToolMessages Comments Fetch] Error:', err.message)
        } finally {
            if (!opts?.silent && activeMessageIdRef.current === msgId) {
                setCommentsLoading(false)
            }
        }
    }, [supabase])

    // Reset state & fetch when project changes
    useEffect(() => {
        openedDeepLinkMsgRef.current = null
        loadedMsgsProjectIdRef.current = null
        setMessages([])
        setSelectedMessage(null)
        setSelectedMessageComments([])
        setShowCreateForm(false)
        setReplicatingBannerTitle(null)
        setFilterText('')
        setCategoryFilter(null)
        setShowCategoryMenu(false)
        setShowSortMenu(false)
        setShowDetailMoreMenu(false)
        setOpenRowMenuId(null)
        setMutationError(null)
        fetchBoardAndMessages()
    }, [project.db_id, fetchBoardAndMessages])

    // Support deep-link selection via selectedMessageId or messageId prop (UUID or numeric bc_id, with direct DB fallback)
    const targetDeepLinkId = selectedMessageId || messageId
    useEffect(() => {
        if (!targetDeepLinkId) {
            openedDeepLinkMsgRef.current = null
            return
        }
        if (replicateMessageId) return

        const cleanTargetId = String(targetDeepLinkId).trim()
        if (!cleanTargetId) return
        if (openedDeepLinkMsgRef.current === cleanTargetId) return

        const found = messages.find(
            (m: any) => m.id === cleanTargetId || (m.bc_id != null && String(m.bc_id) === cleanTargetId)
        )
        if (found) {
            openedDeepLinkMsgRef.current = cleanTargetId
            setSelectedMessage(found)
            setShowCreateForm(false)
            return
        }

        if (loading || (project.db_id && loadedMsgsProjectIdRef.current !== project.db_id)) {
            return
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTargetId)
        const isNumericBcId = /^\d+$/.test(cleanTargetId)
        if (!isUuid && !isNumericBcId) return

        let cancelled = false
        ;(async () => {
            try {
                const baseQuery = supabase
                    .from('bc_messages')
                    .select(`
                        *,
                        author:bc_people!bc_messages_author_person_id_fkey(id, name, email)
                    `)
                const { data: directMsg, error } = await (isUuid
                    ? baseQuery.eq('id', cleanTargetId).maybeSingle()
                    : baseQuery.eq('bc_id', Number(cleanTargetId)).maybeSingle())

                if (cancelled || error || !directMsg) return

                openedDeepLinkMsgRef.current = cleanTargetId
                if (directMsg.project_id === project.db_id) {
                    setMessages((prev) =>
                        prev.some((m: any) => m.id === directMsg.id) ? prev : [directMsg, ...prev]
                    )
                }
                setSelectedMessage(directMsg)
                setShowCreateForm(false)
            } catch (err: any) {
                console.warn('⚠️ [ToolMessages DeepLink Fallback] Error:', err?.message || err)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [targetDeepLinkId, replicateMessageId, messages, loading, project.db_id, supabase])

    // Replicate Announcement (from row, detail header, ••• menu, or ?replicateMessageId= deep-link)
    const handleReplicateMessage = useCallback(
        async (sourceInput: any) => {
            const msgId = typeof sourceInput === 'string' ? sourceInput : sourceInput?.id
            if (!msgId) return

            setReplicatingMsgId(msgId)
            setOpenRowMenuId(null)
            setShowDetailMoreMenu(false)
            setMutationError(null)

            try {
                let sourceObj = typeof sourceInput === 'object' && sourceInput ? sourceInput : null
                if (!sourceObj) {
                    sourceObj = messages.find((m: any) => m.id === msgId) || null
                }

                // Always fetch fresh row from bc_messages to guarantee complete HTML + attachments
                const { data: dbRow, error: dbErr } = await supabase
                    .from('bc_messages')
                    .select('id, bc_id, title, content, category, is_pinned')
                    .eq('id', msgId)
                    .maybeSingle()

                if (!dbErr && dbRow) {
                    sourceObj = dbRow
                }
                if (!sourceObj) return

                const resolvedTitle = String(sourceObj.title || '').trim()
                const resolvedCategory = resolveCategorySelectValue(sourceObj.category)
                const rawHtml = String(sourceObj.content || '')
                const replicatedHtml = prepareHtmlForTaskReplication(rawHtml, editorPeople)

                if (activeMessageIdRef.current) {
                    setSelectedMessage(null)
                    setIsEditingMessage(false)
                    if (onCloseDetail) onCloseDetail()
                }

                setFilterText('')
                setCategoryFilter(null)
                setNewTitle(resolvedTitle)
                setNewCategory(resolvedCategory)
                setNewContent(replicatedHtml)
                setCreateEditorKey((k) => k + 1)
                setNotifyMode('all')
                setNotifyPersonUuids([])
                setNotifySearchQuery('')
                setReplicatingBannerTitle(resolvedTitle || t('basecamp.replicate_message'))
                setShowCreateForm(true)

                if (onConsumeReplicateMessage) {
                    onConsumeReplicateMessage()
                } else if (typeof window !== 'undefined') {
                    const url = new URL(window.location.href)
                    if (url.searchParams.has('replicateMessageId')) {
                        url.searchParams.delete('replicateMessageId')
                        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''))
                    }
                }

                setTimeout(() => {
                    createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    createTitleInputRef.current?.focus({ preventScroll: true })
                }, 100)
            } catch (err: any) {
                console.error('❌ [ToolMessages Replicate] Error:', err?.message || err)
                setMutationError(`${t('basecamp.sync_error_prefix')}${err?.message || t('basecamp.action_error')}`)
            } finally {
                setReplicatingMsgId(null)
            }
        },
        [messages, supabase, editorPeople, onCloseDetail, onConsumeReplicateMessage, t]
    )

    // Deep-link trigger from Global Search (?replicateMessageId=...)
    useEffect(() => {
        if (!replicateMessageId) {
            consumedReplicateMsgRef.current = null
            return
        }
        if (loading) return
        if (consumedReplicateMsgRef.current === replicateMessageId) return
        consumedReplicateMsgRef.current = replicateMessageId
        void handleReplicateMessage(replicateMessageId)
    }, [replicateMessageId, loading, handleReplicateMessage])

    // Supabase Realtime subscription for live updates to bc_messages and bc_comments
    useEffect(() => {
        if (!project.db_id) return
        const channel = supabase
            .channel(`bc_messages_live_${project.db_id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_messages', filter: `project_id=eq.${project.db_id}` },
                () => {
                    fetchBoardAndMessages({ silent: true })
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_comments', filter: `project_id=eq.${project.db_id}` },
                (payload: any) => {
                    fetchBoardAndMessages({ silent: true })
                    const parentId = payload.new?.parent_id || payload.old?.parent_id
                    if (selectedMessage?.id && parentId === selectedMessage.id) {
                        fetchSelectedMessageComments(selectedMessage.id, { silent: true })
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_boosts', filter: `project_id=eq.${project.db_id}` },
                () => {
                    if (selectedMessage?.id) {
                        fetchSelectedMessageComments(selectedMessage.id, { silent: true })
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project.db_id, selectedMessage?.id, fetchBoardAndMessages, fetchSelectedMessageComments, supabase])

    // Layered Escape key handling: Lightbox -> Menus -> Selected Message -> Create Form
    useEffect(() => {
        const hasOpenPopup = Boolean(
            lightboxUrl ||
            showCategoryMenu ||
            showSortMenu ||
            showDetailMoreMenu ||
            openRowMenuId ||
            openCommentMenuId ||
            activeBoostPickerKey ||
            selectedMessage ||
            showCreateForm
        )
        if (!hasOpenPopup) return
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (lightboxUrl) {
                e.preventDefault()
                setLightboxUrl(null)
                return
            }
            if (
                showCategoryMenu ||
                showSortMenu ||
                showDetailMoreMenu ||
                openRowMenuId ||
                openCommentMenuId ||
                activeBoostPickerKey
            ) {
                e.preventDefault()
                setShowCategoryMenu(false)
                setShowSortMenu(false)
                setShowDetailMoreMenu(false)
                setOpenRowMenuId(null)
                setOpenCommentMenuId(null)
                setActiveBoostPickerKey(null)
                return
            }
            if (selectedMessage) {
                e.preventDefault()
                closeMessageDetail()
                return
            }
            if (showCreateForm) {
                e.preventDefault()
                setShowCreateForm(false)
                setReplicatingBannerTitle(null)
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [lightboxUrl, showCategoryMenu, showSortMenu, showDetailMoreMenu, openRowMenuId, openCommentMenuId, activeBoostPickerKey, selectedMessage, showCreateForm, closeMessageDetail])

    // Load comments & boosts when selectedMessage ID changes
    useEffect(() => {
        setIsEditingMessage(false)
        setShowDetailMoreMenu(false)
        setEditingCommentId(null)
        setOpenCommentMenuId(null)
        setActiveBoostPickerKey(null)
        if (selectedMessage?.id) {
            setSelectedMessageComments([])
            setMessageNativeBoosts([])
            setCommentBoostsById({})
            fetchSelectedMessageComments(selectedMessage.id)
        } else {
            setSelectedMessageComments([])
            setMessageNativeBoosts([])
            setCommentBoostsById({})
        }
    }, [selectedMessage?.id, fetchSelectedMessageComments])

    const handleRichImgClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement
        const dlAnchor = target.closest('a[data-bc-download="true"]') as HTMLAnchorElement | null
        if (dlAnchor) {
            e.preventDefault()
            e.stopPropagation()
            const rawSrc = dlAnchor.getAttribute('data-bc-src') || dlAnchor.href
            const rawFilename = dlAnchor.getAttribute('data-bc-filename') || undefined
            triggerBasecampDownload(rawSrc, rawFilename)
            return
        }
        if (target.tagName === 'IMG') {
            const imgEl = target as HTMLImageElement
            if (
                imgEl.classList.contains('avatar') ||
                imgEl.hasAttribute('data-avatar-for-person-id') ||
                imgEl.hasAttribute('data-bc-avatar')
            ) {
                return
            }
            const imgSrc = imgEl.src
            if (imgSrc) {
                e.preventDefault()
                e.stopPropagation()
                setLightboxUrl(imgSrc)
            }
        }
    }, [])

    // Publish Message (Rich HTML + notifyMode + notifyPersonUuids)
    const handlePublishMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!newTitle.trim() || !hasRichContentOrMedia(newContent) || !board) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const htmlContent = /<[a-z][\s\S]*>/i.test(newContent) ? newContent : plainTextToHtml(newContent)
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'create_message',
                    projectId: project.id,
                    boardId: board.bc_id,
                    boardDbId: board.id,
                    title: newTitle.trim(),
                    content: htmlContent,
                    category: newCategory,
                    notifyMode,
                    notifyPersonUuids: notifyMode === 'selected' ? notifyPersonUuids : [],
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewTitle('')
            setNewContent('')
            setCreateEditorKey(k => k + 1)
            setNewCategory('Announcement')
            setNotifyMode('all')
            setNotifyPersonUuids([])
            setNotifySearchQuery('')
            setReplicatingBannerTitle(null)
            setShowCreateForm(false)
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages Publish] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Start Editing Selected Message (or open from row ••• menu)
    const startEditMessage = useCallback((msgTarget?: any) => {
        const target = msgTarget || selectedMessage
        if (!target) return
        if (msgTarget && (!selectedMessage || selectedMessage.id !== msgTarget.id)) {
            setSelectedMessage(msgTarget)
        }
        const rawCleaned = prepareMessageHtmlForEdit(target.content || '')
        setEditMsgTitle(target.title || '')
        setEditMsgCategory(resolveCategorySelectValue(target.category))
        setEditMsgContent(rawCleaned)
        setEditMsgEditorKey(k => k + 1)
        setOpenRowMenuId(null)
        setShowDetailMoreMenu(false)
        setIsEditingMessage(true)
    }, [selectedMessage])

    // Update Message (update_message)
    const handleUpdateMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!selectedMessage || !editMsgTitle.trim() || !hasRichContentOrMedia(editMsgContent)) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'update_message',
                    projectId: project.id,
                    messageDbId: selectedMessage.id,
                    title: editMsgTitle.trim(),
                    content: editMsgContent,
                    category: editMsgCategory,
                })
            })

            if (!res.ok) throw new Error(await res.text())
            const nowIso = new Date().toISOString()
            setSelectedMessage((prev: any) =>
                prev
                    ? {
                          ...prev,
                          title: editMsgTitle.trim(),
                          content: editMsgContent,
                          category: editMsgCategory,
                          updated_at: nowIso,
                      }
                    : null
            )
            setIsEditingMessage(false)
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages Update] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Pin / Unpin Message (pin_message / unpin_message)
    const handleTogglePinMessage = async (msg: any, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        if (!msg?.id) return
        setOpenRowMenuId(null)
        setShowDetailMoreMenu(false)
        setPinBusyId(msg.id)
        setMutationError(null)
        const nextPinned = !Boolean(msg.is_pinned)

        // Optimistic update
        setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_pinned: nextPinned } : m)))
        setSelectedMessage((prev: any) => (prev && prev.id === msg.id ? { ...prev, is_pinned: nextPinned } : prev))

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: nextPinned ? 'pin_message' : 'unpin_message',
                    projectId: project.id,
                    messageDbId: msg.id,
                    recordingId: msg.bc_id,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages Pin] Error:', err.message)
            setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_pinned: !nextPinned } : m)))
            setSelectedMessage((prev: any) => (prev && prev.id === msg.id ? { ...prev, is_pinned: !nextPinned } : prev))
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setPinBusyId(null)
        }
    }

    // Download All Attachments of an Announcement
    const handleDownloadAllAttachments = (attachmentsList: ParsedMessageAttachment[], e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        setOpenRowMenuId(null)
        setShowDetailMoreMenu(false)
        attachmentsList.forEach((att, idx) => {
            const safeUrl = sanitizeAttachmentHref(att.url || att.href)
            if (!safeUrl || safeUrl === '#') return
            const cleanName = safeDecodeFilename(att.filename) || `attachment-${idx + 1}`
            setTimeout(() => {
                triggerBasecampDownload(safeUrl, cleanName)
            }, idx * 250)
        })
    }

    // Delete Message
    const handleDeleteMessage = async (msg: any, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        setOpenRowMenuId(null)
        setShowDetailMoreMenu(false)
        if (!confirm(t('basecamp.delete_message_confirm'))) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: msg.bc_id,
                    recordingDbId: msg.id,
                    tableName: 'bc_messages'
                })
            })

            if (!res.ok) throw new Error(await res.text())
            if (selectedMessage?.id === msg.id) {
                closeMessageDetail()
            }
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages Delete] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Copy Direct Link to Message
    const handleCopyMessageLink = (msgTarget?: any, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        const target = msgTarget || selectedMessage
        if (!target || typeof window === 'undefined') return
        setOpenRowMenuId(null)
        setShowDetailMoreMenu(false)
        const url = `${window.location.origin}/basecamp?project=${encodeURIComponent(String(project.id))}&tool=messages&messageId=${encodeURIComponent(String(target.id))}`
        navigator.clipboard?.writeText(url).catch(() => {})
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2000)
    }

    // Publish Comment (Rich HTML via BasecampRichEditor)
    const handleAddComment = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!hasRichContentOrMedia(commentText) || !selectedMessage) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const htmlComment = /<[a-z][\s\S]*>/i.test(commentText) ? commentText : plainTextToHtml(commentText)
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'create_comment',
                    projectId: project.id,
                    recordingId: selectedMessage.bc_id,
                    parentType: 'message',
                    parentDbId: selectedMessage.id,
                    content: htmlComment
                })
            })

            if (!res.ok) throw new Error(await res.text())
            setCommentText('')
            setCommentEditorKey(k => k + 1)
            await fetchSelectedMessageComments(selectedMessage.id, { silent: true })

            // Reload comment count locally without full spinner
            const { data: updatedMsg } = await supabase
                .from('bc_messages')
                .select('comments_count, updated_at')
                .eq('id', selectedMessage.id)
                .maybeSingle()
            if (updatedMsg) {
                setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, comments_count: updatedMsg.comments_count, updated_at: updatedMsg.updated_at } : m))
                setSelectedMessage((prev: any) => prev ? { ...prev, comments_count: updatedMsg.comments_count, updated_at: updatedMsg.updated_at } : null)
            }
        } catch (err: any) {
            console.error('❌ [ToolMessages Comment] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Reply to a Comment with Blockquote citation
    const handleReplyToComment = (c: any) => {
        const cAuthor = getAuthorObj(c.author)?.name || t('basecamp.unknown_user')
        const snippet = stripHtml(c.content).slice(0, 220)
        const escapedAuthor = cAuthor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const escapedSnippet = snippet.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const quoteBlock = `<blockquote><strong>${escapedAuthor}:</strong> ${escapedSnippet}</blockquote><p><br></p>`
        setCommentText(prev => (prev ? `${prev}${quoteBlock}` : quoteBlock))
        setCommentEditorKey(k => k + 1)
        setCommentFocusSeq(s => s + 1)
    }

    // Start Editing Comment
    const startEditComment = (c: any) => {
        const cleaned = prepareMessageHtmlForEdit(c.content || '')
        setEditingCommentId(c.id)
        setEditingCommentHtml(cleaned)
        setEditingCommentKey(k => k + 1)
        setOpenCommentMenuId(null)
    }

    // Save Edited Comment (update_comment)
    const handleUpdateComment = async (commentObj: any) => {
        if (!commentObj?.id || !hasRichContentOrMedia(editingCommentHtml) || !selectedMessage) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'update_comment',
                    projectId: project.id,
                    commentDbId: commentObj.id,
                    content: editingCommentHtml,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setEditingCommentId(null)
            setEditingCommentHtml('')
            await fetchSelectedMessageComments(selectedMessage.id, { silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages UpdateComment] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Delete Comment (delete_recording -> bc_comments)
    const handleDeleteComment = async (commentObj: any) => {
        if (!commentObj?.id || !selectedMessage) return
        setOpenCommentMenuId(null)
        if (!confirm(t('basecamp.confirm_delete_comment'))) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: commentObj.bc_id,
                    recordingDbId: commentObj.id,
                    tableName: 'bc_comments',
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            await fetchSelectedMessageComments(selectedMessage.id, { silent: true })
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages DeleteComment] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Create Boost (create_boost)
    const handleCreateBoost = async (recordingType: 'message' | 'comment', recordingDbId: string, boostContent: string) => {
        const trimmed = boostContent.trim().slice(0, 16)
        if (!trimmed || !selectedMessage) return
        const pickerKey = `${recordingType}:${recordingDbId}`
        setBoostBusyKey(pickerKey)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'create_boost',
                    projectId: project.id,
                    recordingType,
                    recordingDbId,
                    content: trimmed,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setCustomBoostText('')
            setActiveBoostPickerKey(null)
            await fetchSelectedMessageComments(selectedMessage.id, { silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages CreateBoost] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setBoostBusyKey(null)
        }
    }

    // Delete Boost (delete_boost)
    const handleDeleteBoost = async (boost: any) => {
        if (!boost?.id || !selectedMessage) return
        setBoostBusyKey(`del:${boost.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildActionHeaders(),
                body: JSON.stringify({
                    action: 'delete_boost',
                    projectId: project.id,
                    boostDbId: boost.id,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            await fetchSelectedMessageComments(selectedMessage.id, { silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages DeleteBoost] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setBoostBusyKey(null)
        }
    }

    const renderVideoAttachments = (videos: ParsedMessageAttachment[], compact = false) => {
        if (!videos || videos.length === 0) return null
        return (
            <div className="flex flex-col gap-4 mt-2">
                {videos.map((vid, idx) => {
                    const safeUrl = sanitizeAttachmentHref(vid.url || vid.href)
                    if (!safeUrl || safeUrl === '#') return null
                    const cleanName = safeDecodeFilename(vid.filename) || 'video.mp4'
                    return (
                        <div
                            key={`${safeUrl}-${idx}`}
                            className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950/95 shadow-sm"
                        >
                            <video
                                controls
                                preload="metadata"
                                playsInline
                                src={safeUrl}
                                className={`w-full bg-black object-contain ${compact ? 'max-h-[360px]' : 'max-h-[520px]'}`}
                            />
                            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/90 border-t border-slate-200 dark:border-slate-700">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm shrink-0">🎬</span>
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                                        {cleanName}
                                    </span>
                                </div>
                                <a
                                    href={buildBasecampDirectDownloadHref(safeUrl, cleanName)}
                                    onClick={(ev) => {
                                        ev.preventDefault()
                                        triggerBasecampDownload(safeUrl, cleanName)
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-extrabold shadow-sm transition-all shrink-0 cursor-pointer"
                                >
                                    <Download size={12} />
                                    <span>{t('basecamp.download_video')}</span>
                                </a>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    const renderBoostsRow = (recordingType: 'message' | 'comment', recordingDbId: string, boostsList: any[]) => {
        const pickerKey = `${recordingType}:${recordingDbId}`
        const isPickerOpen = activeBoostPickerKey === pickerKey
        const selfNorm = normalizePersonName(currentUserName)

        return (
            <div
                data-msg-boost-popover="true"
                className={`flex items-center gap-1.5 flex-wrap mt-2.5 ${isPickerOpen ? 'relative z-40' : 'relative z-10'}`}
            >
                {boostsList.map((b: any) => {
                    const boosterObj = getAuthorObj(b.booster)
                    const boosterName = boosterObj?.name || t('basecamp.unknown_user')
                    const isMine = Boolean(selfNorm && normalizePersonName(boosterName) === selfNorm)
                    const isDeleting = boostBusyKey === `del:${b.id}`
                    return (
                        <button
                            key={b.id}
                            type="button"
                            disabled={!isMine || isDeleting}
                            onClick={() => { if (isMine) void handleDeleteBoost(b) }}
                            title={isMine ? `${boosterName} — ${t('basecamp.remove_boost')}` : boosterName}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold transition-all ${
                                isMine
                                    ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200 hover:bg-red-50 hover:border-red-200 dark:hover:bg-red-950/30 cursor-pointer'
                                    : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-default'
                            }`}
                        >
                            <span
                                className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black text-white shrink-0"
                                style={{ backgroundColor: getAvatarColor(boosterName) }}
                            >
                                {getInitials(boosterName)}
                            </span>
                            <span>{b.content}</span>
                            {isMine && <span className="text-[10px] opacity-60 ml-0.5">×</span>}
                        </button>
                    )
                })}

                <div className="relative">
                    <button
                        type="button"
                        onClick={(ev) => {
                            const btnEl = ev.currentTarget as HTMLElement
                            const btnRect = btnEl.getBoundingClientRect()
                            const clipEl = btnEl.closest('.overflow-hidden, .overflow-y-auto') as HTMLElement | null
                            const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
                            const topLimit = clipEl ? Math.max(0, clipEl.getBoundingClientRect().top) : 0
                            const leftLimit = clipEl ? Math.max(0, clipEl.getBoundingClientRect().left) : 0
                            const rightLimit = clipEl ? Math.min(vw, clipEl.getBoundingClientRect().right) : vw
                            setBoostMenuDown(btnRect.top - topLimit < 160)
                            const menuW = Math.min(256, Math.max(190, rightLimit - leftLimit - 24))
                            let offsetX = 0
                            if (btnRect.left + menuW > rightLimit - 12) {
                                offsetX = rightLimit - 12 - (btnRect.left + menuW)
                            }
                            if (btnRect.left + offsetX < leftLimit + 12) {
                                offsetX = leftLimit + 12 - btnRect.left
                            }
                            setBoostMenuOffsetX(Math.round(offsetX))
                            setOpenCommentMenuId(null)
                            setShowDetailMoreMenu(false)
                            setActiveBoostPickerKey(isPickerOpen ? null : pickerKey)
                            setCustomBoostText('')
                        }}
                        title={t('basecamp.boost_btn')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-slate-300 dark:border-slate-700 hover:border-[#1D7DB5] bg-white dark:bg-slate-800 text-slate-500 hover:text-[#1D7DB5] dark:text-slate-400 text-[11px] font-bold transition-all cursor-pointer"
                    >
                        <Rocket size={12} />
                        <span>{t('basecamp.boost_btn')}</span>
                    </button>

                    {isPickerOpen && (
                        <div
                            style={{ left: boostMenuOffsetX }}
                            className={`absolute ${boostMenuDown ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-2.5 w-64 max-w-[calc(100vw-24px)]`}
                        >
                            <div className="flex flex-wrap gap-1 mb-2">
                                {QUICK_BOOST_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        disabled={boostBusyKey === pickerKey}
                                        onClick={() => void handleCreateBoost(recordingType, recordingDbId, preset)}
                                        className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700/60 hover:bg-sky-50 dark:hover:bg-sky-900/40 border border-slate-200/70 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                                    >
                                        {preset}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="text"
                                    maxLength={16}
                                    value={customBoostText}
                                    onChange={(ev) => setCustomBoostText(ev.target.value)}
                                    onKeyDown={(ev) => {
                                        if (ev.key === 'Enter') {
                                            ev.preventDefault()
                                            void handleCreateBoost(recordingType, recordingDbId, customBoostText)
                                        }
                                    }}
                                    placeholder={t('basecamp.add_boost_placeholder')}
                                    className="flex-1 min-w-0 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#1D7DB5]"
                                />
                                <button
                                    type="button"
                                    disabled={!customBoostText.trim() || boostBusyKey === pickerKey}
                                    onClick={() => void handleCreateBoost(recordingType, recordingDbId, customBoostText)}
                                    className="px-2.5 py-1 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] disabled:opacity-40 text-white text-xs font-extrabold cursor-pointer"
                                >
                                    🚀
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const filteredMessages = useMemo(() => {
        const query = normalizeSearch(filterText)
        const targetCanonCat = categoryFilter ? getCanonicalCategory(categoryFilter) : null
        const sortLocale = language === 'es' ? 'es' : 'en'

        const result = messages.filter(m => {
            const authorName = getAuthorObj(m.author)?.name || ''
            const titleNorm = normalizeSearch(m.title)
            const contentNorm = normalizeSearch(stripHtml(m.content || ''))
            const rawHtmlNorm = normalizeSearch(m.content || '')
            const authorNorm = normalizeSearch(authorName)
            const rawCatNorm = normalizeSearch(m.category)
            const displayCatNorm = normalizeSearch(getCategoryDisplayLabel(m.category))

            const matchesQuery =
                !query ||
                titleNorm.includes(query) ||
                contentNorm.includes(query) ||
                rawHtmlNorm.includes(query) ||
                authorNorm.includes(query) ||
                rawCatNorm.includes(query) ||
                displayCatNorm.includes(query)

            const matchesCat =
                !targetCanonCat ||
                getCanonicalCategory(m.category) === targetCanonCat

            return matchesQuery && matchesCat
        })

        result.sort((a, b) => {
            // Pinned announcements ALWAYS stay at the top
            const pinA = Boolean(a.is_pinned)
            const pinB = Boolean(b.is_pinned)
            if (pinA !== pinB) return pinA ? -1 : 1

            if (sortOrder === 'alphabetical') {
                return String(a.title || '').localeCompare(String(b.title || ''), sortLocale, { sensitivity: 'base' })
            }
            if (sortOrder === 'latest_comment') {
                const uA = new Date(a.updated_at || a.created_at || 0).getTime()
                const uB = new Date(b.updated_at || b.created_at || 0).getTime()
                if (uB !== uA) return uB - uA
            }
            const tA = new Date(a.created_at || 0).getTime()
            const tB = new Date(b.created_at || 0).getTime()
            return sortOrder === 'oldest' ? tA - tB : tB - tA
        })

        return result
    }, [messages, filterText, categoryFilter, sortOrder, language, getCategoryDisplayLabel])

    const buildCategorySelectOptions = (activeValue: string) => {
        const exists = CATEGORY_FILTER_OPTIONS.some(o => o.value === activeValue)
        if (exists || !activeValue) return CATEGORY_FILTER_OPTIONS
        return [...CATEGORY_FILTER_OPTIONS, { value: activeValue, canonical: getCanonicalCategory(activeValue) }]
    }

    const toggleSelectedNotifyUuid = (uuid: string) => {
        setNotifyPersonUuids((prev) =>
            prev.includes(uuid) ? prev.filter((id) => id !== uuid) : [...prev, uuid]
        )
    }

    const totalProjectMembersCount = (project?.people || []).length

    return (
        <div className="flex-1 max-w-4xl mx-auto px-4 w-full flex flex-col gap-6">
            <style dangerouslySetInnerHTML={{ __html: `
                .bc-rich-text {
                    white-space: pre-wrap;
                }
                .bc-rich-text a {
                    color: #1D7DB5;
                    text-decoration: none;
                    font-weight: 500;
                }
                .bc-rich-text a:hover {
                    text-decoration: underline;
                }
                .bc-rich-text p {
                    margin: 0 0 16px 0;
                    line-height: 1.7;
                    font-size: 16px;
                }
                .bc-rich-text p:last-child {
                    margin-bottom: 0;
                }
                .bc-rich-text ul {
                    margin: 0 0 16px 0;
                    padding-left: 24px;
                    list-style-type: disc;
                    font-size: 16px;
                    line-height: 1.7;
                }
                .bc-rich-text ol {
                    margin: 0 0 16px 0;
                    padding-left: 24px;
                    list-style-type: decimal;
                    font-size: 15px;
                    line-height: 1.7;
                }
                .bc-rich-text blockquote {
                    border-left: 4px solid #E8E6E1;
                    padding-left: 16px;
                    margin: 0 0 16px 0;
                    color: #6B7B8D;
                    font-style: italic;
                }
                .bc-rich-text img {
                    max-width: 100%;
                    height: auto;
                    border-radius: 8px;
                    margin: 16px 0;
                    cursor: pointer;
                    transition: opacity 0.15s;
                    display: block;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                }
                .bc-rich-text img:hover {
                    opacity: 0.9;
                }
                .bc-rich-text figure {
                    margin: 16px 0;
                }
                .bc-rich-text figcaption {
                    font-size: 12px;
                    color: #6B7B8D;
                    text-align: center;
                    margin-top: 4px;
                }
                ${BASECAMP_IMAGE_HOVER_CSS}
            ` }} />

            {mutationError && (
                <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-between gap-3">
                    <span>{mutationError}</span>
                    <button
                        type="button"
                        onClick={() => setMutationError(null)}
                        className="text-red-600 dark:text-red-300 hover:opacity-80 font-extrabold cursor-pointer"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Cabecera del tablero */}
            {!showCreateForm && !selectedMessage && (
                <div className={`relative ${showCategoryMenu || showSortMenu ? 'z-40' : 'z-20'} flex flex-col items-center gap-4 text-center border-b border-slate-100 dark:border-slate-800/80 pb-6`}>
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            {t('basecamp.message_board_sub')}
                        </span>
                        <h3 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 font-serif">
                            {t('basecamp.message_board')}
                        </h3>
                    </div>

                    {/* Fila de controles de Basecamp */}
                    <div className="relative z-40 flex flex-wrap items-center justify-center gap-2 mt-2 w-full max-w-3xl text-xs">
                        <button
                            type="button"
                            onClick={openFreshCreateForm}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold shadow-sm transition-all cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.new_message_btn')}</span>
                        </button>

                        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

                        <button
                            type="button"
                            onClick={() => { setCategoryFilter(null); setFilterText(''); setShowCategoryMenu(false) }}
                            className={`px-3 py-2 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                                !categoryFilter && !filterText
                                    ? 'border-[#1D7DB5] bg-[#1D7DB5]/10 text-[#1D7DB5] dark:text-sky-400'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                        >
                            {t('basecamp.all_messages')}
                        </button>

                        {/* Dropdown de las 5 Categorías de Basecamp + General */}
                        <div ref={categoryMenuRef} className="relative z-40">
                            <button
                                type="button"
                                onClick={() => { setShowCategoryMenu(prev => !prev); setShowSortMenu(false); setOpenRowMenuId(null) }}
                                className={`px-3 py-2 rounded-full border text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                                    categoryFilter
                                        ? 'border-[#1D7DB5] bg-[#1D7DB5]/10 text-[#1D7DB5] dark:text-sky-400'
                                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                            >
                                <span>{categoryFilter ? getCategoryDisplayLabel(categoryFilter) : t('basecamp.categories')}</span>
                                <span className="text-[9px]">▼</span>
                            </button>

                            {showCategoryMenu && (
                                <div className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-50 text-left">
                                    <button
                                        type="button"
                                        onClick={() => { setCategoryFilter(null); setShowCategoryMenu(false) }}
                                        className={`w-full px-3 py-1.5 text-xs font-bold flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${
                                            !categoryFilter ? 'text-[#1D7DB5] dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'
                                        }`}
                                    >
                                        <span>{t('basecamp.all_messages')}</span>
                                        {!categoryFilter && <span>✓</span>}
                                    </button>
                                    {CATEGORY_FILTER_OPTIONS.map(opt => {
                                        const isSelected = categoryFilter ? getCanonicalCategory(categoryFilter) === opt.canonical : false
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => { setCategoryFilter(opt.value); setShowCategoryMenu(false) }}
                                                className={`w-full px-3 py-1.5 text-xs font-bold flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${
                                                    isSelected ? 'text-[#1D7DB5] dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'
                                                }`}
                                            >
                                                <span>{getCategoryDisplayLabel(opt.value)}</span>
                                                {isSelected && <span>✓</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Selector de Ordenamiento (4 opciones reales de Basecamp) */}
                        <div ref={sortMenuRef} className="relative z-40">
                            <button
                                type="button"
                                onClick={() => { setShowSortMenu(prev => !prev); setShowCategoryMenu(false); setOpenRowMenuId(null) }}
                                className="px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer transition-all"
                            >
                                <span>{getSortOrderLabel(sortOrder)}</span>
                                <span className="text-[9px]">▼</span>
                            </button>

                            {showSortMenu && (
                                <div className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-50 text-left">
                                    {(['newest', 'latest_comment', 'oldest', 'alphabetical'] as MessageSortOrder[]).map((mode) => {
                                        const isSelected = sortOrder === mode
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => { setSortOrder(mode); setShowSortMenu(false) }}
                                                className={`w-full px-3 py-1.5 text-xs font-bold flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${
                                                    isSelected ? 'text-[#1D7DB5] dark:text-sky-400' : 'text-slate-700 dark:text-slate-300'
                                                }`}
                                            >
                                                <span>{getSortOrderLabel(mode)}</span>
                                                {isSelected && <span>✓</span>}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Input de filtro */}
                        <div className="relative flex-1 min-w-[160px] max-w-[240px]">
                            <input
                                type="text"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                placeholder={t('basecamp.filter_placeholder')}
                                className="w-full pl-7 pr-7 py-2 border border-slate-200 dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1D7DB5] text-xs font-bold"
                            />
                            <div className="absolute left-2.5 top-2.5 text-slate-400">
                                <Search size={13} />
                            </div>
                            {filterText && (
                                <button
                                    type="button"
                                    onClick={() => setFilterText('')}
                                    title={t('basecamp.clear_filter')}
                                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold cursor-pointer"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── 1. FORMULARIO DE CREACIÓN / REPLICACIÓN ── */}
            {showCreateForm && (
                <div
                    ref={createFormRef}
                    className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm"
                >
                    <div className="flex items-center gap-2 mb-3">
                        <button
                            type="button"
                            onClick={() => { setShowCreateForm(false); setReplicatingBannerTitle(null) }}
                            className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-bold cursor-pointer"
                        >
                            {t('basecamp.back')}
                        </button>
                    </div>

                    {replicatingBannerTitle && (
                        <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 flex items-start justify-between gap-3">
                            <div className="text-xs leading-relaxed">
                                <strong className="text-[#0369A1] dark:text-sky-300 font-extrabold">
                                    📋 {t('basecamp.replicating_message_banner')}: &ldquo;{replicatingBannerTitle}&rdquo;
                                </strong>{' '}
                                <span className="text-slate-600 dark:text-slate-300 font-medium">
                                    — {t('basecamp.replicating_message_hint')}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setReplicatingBannerTitle(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-xs cursor-pointer shrink-0"
                                title={t('basecamp.cancel')}
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">
                        {replicatingBannerTitle ? `📋 ${t('basecamp.replicate_message')}` : t('basecamp.new_message_btn')}
                    </h4>

                    <form onSubmit={handlePublishMessage} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-2">
                                <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.announcement_title_label')}</label>
                                <input
                                    ref={createTitleInputRef}
                                    type="text"
                                    required
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder={t('basecamp.new_message_title')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-sm font-bold"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.category_label')}</label>
                                <select
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs font-bold"
                                >
                                    {buildCategorySelectOptions(newCategory).map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {getCategoryDisplayLabel(opt.value)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.message_content_label')}</label>
                            <BasecampRichEditor
                                editorKey={`new-msg-${createEditorKey}`}
                                initialHtml={newContent}
                                onChangeHtml={(html) => setNewContent(html)}
                                people={editorPeople}
                                placeholder={t('basecamp.new_message_placeholder')}
                                minHeight={220}
                                uploadFolder="messages"
                                onSubmitShortcut={() => void handlePublishMessage()}
                            />
                        </div>

                        {/* ── Selector Real de Basecamp: "Al publicar este anuncio, enviar correo a:" ── */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                                <Mail size={14} className="text-[#1D7DB5]" />
                                <span>{t('basecamp.when_post_notify_label')}</span>
                            </div>

                            <div className="space-y-2">
                                {/* Option 1: All people on this project */}
                                <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <input
                                            type="radio"
                                            name="bc_msg_notify_mode"
                                            checked={notifyMode === 'all'}
                                            onChange={() => setNotifyMode('all')}
                                            className="accent-[#1D7DB5] w-4 h-4 cursor-pointer"
                                        />
                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                            {t('basecamp.notify_all_project')} ({totalProjectMembersCount})
                                        </span>
                                    </div>
                                    {projectPeople.length > 0 && (
                                        <div className="hidden sm:flex -space-x-1.5 shrink-0">
                                            {projectPeople.slice(0, 6).map((p) => (
                                                <span
                                                    key={p.id}
                                                    title={p.name}
                                                    className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[8px] font-black text-white"
                                                    style={{ backgroundColor: getAvatarColor(p.name) }}
                                                >
                                                    {getInitials(p.name)}
                                                </span>
                                            ))}
                                            {projectPeople.length > 6 && (
                                                <span className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[8px] font-extrabold text-slate-600 dark:text-slate-300">
                                                    +{projectPeople.length - 6}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </label>

                                {/* Option 2: Only people I select… */}
                                <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
                                    <label className="flex items-center justify-between gap-3 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                                        <div className="flex items-center gap-2.5">
                                            <input
                                                type="radio"
                                                name="bc_msg_notify_mode"
                                                checked={notifyMode === 'selected'}
                                                onChange={() => setNotifyMode('selected')}
                                                className="accent-[#1D7DB5] w-4 h-4 cursor-pointer"
                                            />
                                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                                {t('basecamp.notify_selected_only')}
                                            </span>
                                        </div>
                                        {notifyMode === 'selected' && notifyPersonUuids.length > 0 && (
                                            <span className="px-2 py-0.5 rounded-full bg-[#1D7DB5]/15 text-[#1D7DB5] dark:text-sky-300 text-[11px] font-extrabold">
                                                {notifyPersonUuids.length}
                                            </span>
                                        )}
                                    </label>

                                    {notifyMode === 'selected' && (
                                        <div className="p-3 pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-2.5">
                                            {notifyPersonUuids.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {notifyPersonUuids.map((uid) => {
                                                        const pObj =
                                                            projectPeople.find((p) => p.id === uid) ||
                                                            editorPeople.find((p) => p.id === uid)
                                                        if (!pObj) return null
                                                        return (
                                                            <span
                                                                key={uid}
                                                                className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-xs font-bold text-sky-900 dark:text-sky-200"
                                                            >
                                                                <span
                                                                    className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black text-white shrink-0"
                                                                    style={{ backgroundColor: getAvatarColor(pObj.name) }}
                                                                >
                                                                    {getInitials(pObj.name)}
                                                                </span>
                                                                <span className="truncate max-w-[160px]">{pObj.name}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleSelectedNotifyUuid(uid)}
                                                                    className="text-sky-700 dark:text-sky-300 hover:text-red-600 cursor-pointer"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </span>
                                                        )
                                                    })}
                                                </div>
                                            )}

                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={notifySearchQuery}
                                                    onChange={(ev) => setNotifySearchQuery(ev.target.value)}
                                                    placeholder={t('basecamp.select_people_to_notify')}
                                                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#1D7DB5]"
                                                />
                                                <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
                                            </div>

                                            <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200/70 dark:border-slate-700 bg-white dark:bg-slate-800">
                                                {notifyCandidates.length > 0 ? (
                                                    notifyCandidates.map((p) => {
                                                        const checked = notifyPersonUuids.includes(p.id)
                                                        return (
                                                            <button
                                                                key={p.id}
                                                                type="button"
                                                                onClick={() => toggleSelectedNotifyUuid(p.id)}
                                                                className={`w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors cursor-pointer ${
                                                                    checked ? 'bg-sky-50/70 dark:bg-sky-950/30' : ''
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span
                                                                        className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black text-white shrink-0"
                                                                        style={{ backgroundColor: getAvatarColor(p.name) }}
                                                                    >
                                                                        {getInitials(p.name)}
                                                                    </span>
                                                                    <div className="min-w-0">
                                                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                                                            {p.name}
                                                                        </p>
                                                                        {(p.title || p.email) && (
                                                                            <p className="text-[10px] text-slate-400 truncate">
                                                                                {p.title || p.email}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <span
                                                                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                                                        checked
                                                                            ? 'bg-[#1D7DB5] border-[#1D7DB5] text-white'
                                                                            : 'border-slate-300 dark:border-slate-600'
                                                                    }`}
                                                                >
                                                                    {checked && <Check size={11} />}
                                                                </span>
                                                            </button>
                                                        )
                                                    })
                                                ) : (
                                                    <p className="text-xs text-slate-400 italic text-center py-3">
                                                        {t('basecamp.no_people_found')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Option 3: Don't notify anyone by email */}
                                <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors">
                                    <input
                                        type="radio"
                                        name="bc_msg_notify_mode"
                                        checked={notifyMode === 'none'}
                                        onChange={() => setNotifyMode('none')}
                                        className="accent-[#1D7DB5] w-4 h-4 cursor-pointer"
                                    />
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                        {t('basecamp.notify_nobody')}
                                    </span>
                                </label>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => { setShowCreateForm(false); setReplicatingBannerTitle(null) }}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={actionLoading || !newTitle.trim() || !hasRichContentOrMedia(newContent)}
                                className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                            >
                                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{t('basecamp.post_message')}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── 2. VISTA DETALLADA DE UN ANUNCIO ── */}
            {selectedMessage && (() => {
                const selectedAuthorName = getAuthorObj(selectedMessage.author)?.name || t('basecamp.unknown_user')
                const {
                    sanitizedHtml: richHtml,
                    videoAttachments,
                    nonImageAttachments,
                    allAttachments,
                } = prepareRichContent(selectedMessage.content || '')
                const messageBoosts = selectedMessageComments
                    .filter((c: any) => isShortAckBoost(c.content))
                    .slice(0, 8)
                const isPinnedSelected = Boolean(selectedMessage.is_pinned)

                return (
                    <div className="flex-1 flex flex-col gap-6">
                        {/* Header: Breadcrumbs & Actions */}
                        <div className={`relative ${showDetailMoreMenu ? 'z-50' : 'z-20'} flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3`}>
                            <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                                <span
                                    onClick={closeMessageDetail}
                                    className="text-[#1D7DB5] hover:underline cursor-pointer"
                                >
                                    {project.name || t('basecamp.all_projects')}
                                </span>
                                <span className="text-slate-300 font-normal">/</span>
                                <span
                                    onClick={closeMessageDetail}
                                    className="text-[#1D7DB5] hover:underline cursor-pointer"
                                >
                                    {t('basecamp.message_board')}
                                </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                    type="button"
                                    disabled={replicatingMsgId === selectedMessage.id}
                                    onClick={() => void handleReplicateMessage(selectedMessage)}
                                    title={t('basecamp.replicate_message_tooltip')}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#1D7DB5] bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-extrabold shadow-sm transition-all cursor-pointer"
                                >
                                    {replicatingMsgId === selectedMessage.id ? (
                                        <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                        <span>📋</span>
                                    )}
                                    <span>{t('basecamp.replicate_message')}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => startEditMessage()}
                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 rounded-xl transition-all cursor-pointer"
                                >
                                    <Pencil size={13} />
                                    <span>{t('basecamp.edit_message')}</span>
                                </button>

                                {/* Menú ••• completo estilo Basecamp */}
                                <div ref={detailMoreMenuRef} className="relative z-50">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOpenCommentMenuId(null)
                                            setActiveBoostPickerKey(null)
                                            setShowDetailMoreMenu(prev => !prev)
                                        }}
                                        title={t('basecamp.more_actions')}
                                        className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all flex items-center justify-center cursor-pointer"
                                    >
                                        <MoreHorizontal size={16} />
                                    </button>

                                    {showDetailMoreMenu && (
                                        <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1.5 z-[90] text-left">
                                            <button
                                                type="button"
                                                onClick={() => void handleReplicateMessage(selectedMessage)}
                                                className="w-full px-3.5 py-2 text-xs font-bold text-[#0369A1] dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 flex items-center gap-2.5 cursor-pointer"
                                            >
                                                <span>📋</span>
                                                <span>{t('basecamp.replicate_message')}</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => startEditMessage()}
                                                className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                            >
                                                <Pencil size={14} className="text-slate-400" />
                                                <span>{t('basecamp.edit_message')}</span>
                                            </button>

                                            <button
                                                type="button"
                                                disabled={pinBusyId === selectedMessage.id}
                                                onClick={(ev) => void handleTogglePinMessage(selectedMessage, ev)}
                                                className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                            >
                                                <span>📌</span>
                                                <span>{isPinnedSelected ? t('basecamp.unpin_message') : t('basecamp.pin_message')}</span>
                                            </button>

                                            {allAttachments.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={(ev) => handleDownloadAllAttachments(allAttachments, ev)}
                                                    className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                                >
                                                    <Download size={14} className="text-[#1D7DB5]" />
                                                    <span>{t('basecamp.download_all_attachments')} ({allAttachments.length})</span>
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={(ev) => handleCopyMessageLink(selectedMessage, ev)}
                                                className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                            >
                                                {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Link2 size={14} className="text-slate-400" />}
                                                <span>{copiedLink ? t('basecamp.link_copied') : t('basecamp.copy_link')}</span>
                                            </button>

                                            <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />

                                            <button
                                                type="button"
                                                onClick={(ev) => void handleDeleteMessage(selectedMessage, ev)}
                                                className="w-full px-3.5 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2.5 cursor-pointer"
                                            >
                                                <Trash2 size={14} />
                                                <span>{t('basecamp.put_in_trash')}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Message Body Container or Inline Edit Form */}
                        {isEditingMessage ? (
                            <form
                                onSubmit={handleUpdateMessage}
                                className="relative z-10 bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-4 sm:p-6 rounded-2xl space-y-4 shadow-sm"
                            >
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">
                                            {t('basecamp.announcement_title_label')}
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={editMsgTitle}
                                            onChange={(e) => setEditMsgTitle(e.target.value)}
                                            placeholder={t('basecamp.new_message_title')}
                                            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-sm font-bold"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">
                                            {t('basecamp.category_label')}
                                        </label>
                                        <select
                                            value={editMsgCategory}
                                            onChange={(e) => setEditMsgCategory(e.target.value)}
                                            className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs font-bold"
                                        >
                                            {buildCategorySelectOptions(editMsgCategory).map(opt => (
                                                <option key={opt.value} value={opt.value}>
                                                    {getCategoryDisplayLabel(opt.value)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">
                                        {t('basecamp.message_content_label')}
                                    </label>
                                    <BasecampRichEditor
                                        editorKey={`edit-msg-${selectedMessage.id}-${editMsgEditorKey}`}
                                        initialHtml={editMsgContent}
                                        onChangeHtml={(html) => setEditMsgContent(html)}
                                        people={editorPeople}
                                        placeholder={t('basecamp.new_message_placeholder')}
                                        minHeight={220}
                                        uploadFolder="messages"
                                        onSubmitShortcut={() => void handleUpdateMessage()}
                                    />
                                </div>

                                <div className="flex justify-end gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingMessage(false)}
                                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                    >
                                        {t('basecamp.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={actionLoading || !editMsgTitle.trim() || !hasRichContentOrMedia(editMsgContent)}
                                        className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                                    >
                                        {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        <span>{actionLoading ? t('basecamp.saving_changes') : t('basecamp.save_changes')}</span>
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className={`w-full flex flex-col gap-6 ${activeBoostPickerKey === `message:${selectedMessage.id}` ? 'relative z-40' : 'relative z-10'}`}>
                                {/* Title and Subtitle */}
                                <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                                    <div className="flex items-center gap-2 flex-wrap mb-2">
                                        {isPinnedSelected && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-extrabold text-amber-700 dark:text-amber-300">
                                                <span>📌</span>
                                                <span>{t('basecamp.pinned_badge')}</span>
                                            </span>
                                        )}
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                                            {getCategoryDisplayLabel(selectedMessage.category)}
                                        </span>
                                    </div>
                                    <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-50 font-sans tracking-tight leading-tight mb-2">
                                        {selectedMessage.title}
                                    </h2>
                                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5 flex-wrap">
                                        <span>
                                            {selectedAuthorName} {t('basecamp.on_date')} {formatMessageDate(selectedMessage.created_at)} {t('basecamp.time_at')} {formatMessageTime(selectedMessage.created_at)}
                                        </span>
                                        {wasRecordEdited(selectedMessage.created_at, selectedMessage.updated_at) && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                                {t('basecamp.edited_badge')}
                                            </span>
                                        )}
                                    </p>
                                </div>

                                {/* Flex container for Message content (Avatar on Left, Content on Right) */}
                                <div className="flex gap-3 sm:gap-4 items-start w-full">
                                    <div
                                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-xs sm:text-sm font-black text-white flex-shrink-0 shadow-sm"
                                        style={{ backgroundColor: getAvatarColor(selectedAuthorName) }}
                                    >
                                        {getInitials(selectedAuthorName)}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-col gap-4">
                                            {richHtml && (
                                                <div
                                                    className="bc-rich-text text-[16px] sm:text-[17px] text-slate-800 dark:text-slate-200 leading-relaxed font-sans"
                                                    onClick={handleRichImgClick}
                                                    dangerouslySetInnerHTML={{ __html: injectImageDownloadOverlays(richHtml, t('basecamp.download_btn')) }}
                                                />
                                            )}

                                            {/* Inline Video Players (<video controls preload="metadata" playsInline> + ⬇ Descargar video) */}
                                            {renderVideoAttachments(videoAttachments)}

                                            {/* Non-image/non-video attachments (PDFs, files) as cards */}
                                            {nonImageAttachments.length > 0 && (
                                                <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                                                    <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-2">
                                                        📎 {nonImageAttachments.length} {nonImageAttachments.length === 1 ? t('basecamp.file_count') : t('basecamp.files_count')}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {nonImageAttachments.map((file, i) => {
                                                            const rawFileUrl = sanitizeAttachmentHref(file.url || file.href)
                                                            const cleanName = safeDecodeFilename(file.filename) || t('basecamp.attached_file_fallback')
                                                            return (
                                                                <a
                                                                    key={i}
                                                                    href={buildBasecampDirectDownloadHref(rawFileUrl, cleanName)}
                                                                    onClick={(ev) => {
                                                                        ev.preventDefault()
                                                                        triggerBasecampDownload(rawFileUrl, cleanName)
                                                                    }}
                                                                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 rounded-xl text-xs font-bold text-[#1D7DB5] hover:text-[#155D8A] transition-all cursor-pointer"
                                                                >
                                                                    <FileText size={14} className="text-slate-400 flex-shrink-0" />
                                                                    <span className="max-w-[220px] truncate">
                                                                        {cleanName}
                                                                    </span>
                                                                </a>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Native Boosts (bc_boosts + create_boost / delete_boost) */}
                                            {renderBoostsRow('message', selectedMessage.id, messageNativeBoosts)}
                                        </div>
                                    </div>
                                </div>

                                {/* Legacy short-ack comments summary (only if no native boosts yet) */}
                                {messageNativeBoosts.length === 0 && messageBoosts.length > 0 && (
                                    <div className="flex items-center gap-2.5 flex-wrap pl-14 mt-1 pb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="flex -space-x-1.5">
                                                {messageBoosts.map((boost: any, i: number) => {
                                                    const boostAuthor = getAuthorObj(boost.author)?.name || t('basecamp.unknown_user')
                                                    return (
                                                        <div
                                                            key={boost.id || i}
                                                            title={`${boostAuthor} — Ok`}
                                                            className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[9px] font-black text-white shadow-sm shrink-0"
                                                            style={{ backgroundColor: getAvatarColor(boostAuthor) }}
                                                        >
                                                            {getInitials(boostAuthor)}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                                {messageBoosts.length} {messageBoosts.length === 1 ? t('basecamp.said_ok_singular') : t('basecamp.said_ok_plural')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Hilo de comentarios de este anuncio */}
                        <div className={`relative ${openCommentMenuId || activeBoostPickerKey?.startsWith('comment:') ? 'z-40' : 'z-10'} border-t border-slate-100 dark:border-slate-800 pt-6`}>
                            <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-1.5">
                                <MessageSquare size={14} />
                                {t('basecamp.comments_title')} ({Math.max(Number(selectedMessage.comments_count || 0), selectedMessageComments.length)})
                            </h4>

                            <div className="space-y-6 mb-6">
                                {commentsLoading && selectedMessageComments.length === 0 ? (
                                    <div className="flex justify-center py-6">
                                        <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                    </div>
                                ) : selectedMessageComments.length > 0 ? (
                                    selectedMessageComments.map((c: any, idx: number) => {
                                        const commentAuthor = getAuthorObj(c.author)?.name || t('basecamp.unknown_user')
                                        const {
                                            sanitizedHtml: commentHtml,
                                            videoAttachments: commentVideos,
                                            nonImageAttachments: commentFiles,
                                        } = prepareRichContent(c.content)
                                        const isEditingThisComment = editingCommentId === c.id
                                        const isCommentMenuOpen = openCommentMenuId === c.id
                                        const isCommentBoostOpen = activeBoostPickerKey === `comment:${c.id}`
                                        const cBoosts = commentBoostsById[String(c.id)] || []

                                        return (
                                            <div
                                                key={c.id || idx}
                                                className={`${isCommentMenuOpen || isCommentBoostOpen ? 'relative z-40' : 'relative z-0'} flex gap-3 sm:gap-4 items-start text-xs border-b border-slate-100 dark:border-slate-800/40 pb-5 last:border-0 last:pb-0`}
                                            >
                                                {/* Comment avatar */}
                                                <div
                                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 uppercase shadow-sm"
                                                    style={{ backgroundColor: getAvatarColor(commentAuthor) }}
                                                >
                                                    {getInitials(commentAuthor)}
                                                </div>

                                                {/* Comment Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                                        <div className="flex items-baseline gap-1.5 flex-wrap">
                                                            <span className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                                                                {commentAuthor}
                                                            </span>
                                                            <span className="text-[11px] text-slate-400">
                                                                • {formatMessageDate(c.created_at)} {t('basecamp.time_at')} {formatMessageTime(c.created_at)}
                                                            </span>
                                                            {wasRecordEdited(c.created_at, c.updated_at) && (
                                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                                                    {t('basecamp.edited_badge')}
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div data-msg-comment-menu="true" className="flex items-center gap-1 shrink-0 relative">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleReplyToComment(c)}
                                                                title={t('basecamp.reply_comment')}
                                                                className="p-1.5 rounded-lg text-slate-400 hover:text-[#1D7DB5] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                                            >
                                                                <Reply size={13} />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={(ev) => {
                                                                    const btnRect = ev.currentTarget.getBoundingClientRect()
                                                                    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
                                                                    setCommentMenuUp(vh - btnRect.bottom < 140)
                                                                    setActiveBoostPickerKey(null)
                                                                    setShowDetailMoreMenu(false)
                                                                    setOpenCommentMenuId(prev => prev === c.id ? null : c.id)
                                                                }}
                                                                title={t('basecamp.more_actions')}
                                                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                                            >
                                                                <MoreHorizontal size={14} />
                                                            </button>

                                                            {isCommentMenuOpen && (
                                                                <div className={`absolute right-0 ${commentMenuUp ? 'bottom-full mb-1.5' : 'top-full mt-1'} w-44 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1 z-50`}>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => startEditComment(c)}
                                                                        className="w-full px-3 py-1.5 text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer"
                                                                    >
                                                                        <Pencil size={12} />
                                                                        <span>{t('basecamp.edit_comment')}</span>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleDeleteComment(c)}
                                                                        className="w-full px-3 py-1.5 text-left text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2 cursor-pointer"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                        <span>{t('basecamp.delete_comment')}</span>
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {isEditingThisComment ? (
                                                        <div className="space-y-2.5 mt-2">
                                                            <BasecampRichEditor
                                                                compact
                                                                editorKey={`edit-com-${c.id}-${editingCommentKey}`}
                                                                initialHtml={editingCommentHtml}
                                                                onChangeHtml={(html) => setEditingCommentHtml(html)}
                                                                people={editorPeople}
                                                                placeholder={t('basecamp.add_comment_placeholder')}
                                                                minHeight={100}
                                                                uploadFolder="comments"
                                                                onSubmitShortcut={() => void handleUpdateComment(c)}
                                                            />
                                                            <div className="flex justify-end gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setEditingCommentId(null); setEditingCommentHtml('') }}
                                                                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                                                >
                                                                    {t('basecamp.cancel')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={actionLoading || !hasRichContentOrMedia(editingCommentHtml)}
                                                                    onClick={() => void handleUpdateComment(c)}
                                                                    className="px-3.5 py-1.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer"
                                                                >
                                                                    {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                                                                    <span>{t('basecamp.save_changes')}</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {commentHtml && (
                                                                <div
                                                                    className="bc-rich-text text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-sans"
                                                                    onClick={handleRichImgClick}
                                                                    dangerouslySetInnerHTML={{ __html: injectImageDownloadOverlays(commentHtml, t('basecamp.download_btn')) }}
                                                                />
                                                            )}

                                                            {/* Inline Video Players in Comments */}
                                                            {renderVideoAttachments(commentVideos, true)}

                                                            {commentFiles.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-2">
                                                                    {commentFiles.map((file: any, fIdx: number) => {
                                                                        const rawFileUrl = sanitizeAttachmentHref(file.url || file.href)
                                                                        const cleanName = safeDecodeFilename(file.filename) || t('basecamp.attached_file_fallback')
                                                                        return (
                                                                            <a
                                                                                key={fIdx}
                                                                                href={buildBasecampDirectDownloadHref(rawFileUrl, cleanName)}
                                                                                onClick={(ev) => {
                                                                                    ev.preventDefault()
                                                                                    triggerBasecampDownload(rawFileUrl, cleanName)
                                                                                }}
                                                                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 rounded-xl text-xs font-bold text-[#1D7DB5] hover:text-[#155D8A] transition-all cursor-pointer"
                                                                            >
                                                                                <Paperclip size={13} className="text-[#1D7DB5] flex-shrink-0" />
                                                                                <span className="max-w-[200px] truncate">
                                                                                    {cleanName}
                                                                                </span>
                                                                            </a>
                                                                        )
                                                                    })}
                                                                </div>
                                                            )}

                                                            {c.id && renderBoostsRow('comment', String(c.id), cBoosts)}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })
                                ) : (
                                    <p className="text-xs text-slate-400 italic text-center py-6">
                                        {t('basecamp.no_comments_yet')}
                                    </p>
                                )}
                            </div>

                            {/* Publicar comentario enriquecido con BasecampRichEditor */}
                            <form onSubmit={handleAddComment} className="relative z-10 space-y-3">
                                <BasecampRichEditor
                                    compact
                                    editorKey={`new-msg-comment-${selectedMessage.id}-${commentEditorKey}`}
                                    focusSeq={commentFocusSeq}
                                    initialHtml={commentText}
                                    onChangeHtml={(html) => setCommentText(html)}
                                    people={editorPeople}
                                    placeholder={t('basecamp.add_comment_placeholder')}
                                    minHeight={110}
                                    uploadFolder="comments"
                                    onSubmitShortcut={() => void handleAddComment()}
                                />
                                <div className="flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={actionLoading || !hasRichContentOrMedia(commentText)}
                                        className="px-5 py-2.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm flex items-center justify-center gap-1.5 min-w-[120px] cursor-pointer"
                                    >
                                        {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        <span>{t('basecamp.post_comment')}</span>
                                    </button>
                                </div>
                            </form>

                            {/* Pie informativo de notificaciones estilo Basecamp */}
                            <div className="mt-8 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl p-4">
                                <Mail size={15} className="text-[#1D7DB5] shrink-0 mt-0.5" />
                                <p className="leading-relaxed font-medium">
                                    {t('basecamp.msg_subscribers_footer')}
                                </p>
                            </div>
                        </div>
                    </div>
                )
            })()}

            {/* ── 3. LISTADO DE ANUNCIOS ── */}
            {!showCreateForm && !selectedMessage && (
                <div className={`relative ${openRowMenuId ? 'z-30' : 'z-10'} flex flex-col w-full`}>
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : filteredMessages.length > 0 ? (
                        filteredMessages.map((m) => {
                            const authorName = getAuthorObj(m.author)?.name || t('basecamp.unknown_user')
                            const formattedDate = formatMessageDate(m.created_at)
                            const rowAttachments = parseAttachments(m.content || '')
                            const hasRowPhotos = rowAttachments.some((a) => a.kind === 'image')
                            const hasRowVideos = rowAttachments.some((a) => a.kind === 'video')
                            const isPinned = Boolean(m.is_pinned)
                            const isRowMenuOpen = openRowMenuId === m.id

                            return (
                                <div
                                    key={m.id}
                                    onClick={() => setSelectedMessage(m)}
                                    className={`${isRowMenuOpen ? 'relative z-40' : 'relative z-0'} group/row border-b border-slate-100 dark:border-slate-800 py-5 px-2 -mx-2 rounded-xl flex items-start gap-3 sm:gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors cursor-pointer ${
                                        isPinned ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                                    }`}
                                >
                                    {/* Left side: Avatar */}
                                    <div
                                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 shadow-sm mt-0.5"
                                        style={{ backgroundColor: getAvatarColor(authorName) }}
                                    >
                                        {getInitials(authorName)}
                                    </div>

                                    {/* Middle: Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            {isPinned && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100/80 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[10px] font-extrabold text-amber-800 dark:text-amber-300 shrink-0">
                                                    <span>📌</span>
                                                    <span>{t('basecamp.pinned_badge')}</span>
                                                </span>
                                            )}
                                            <h4 className="text-[18px] sm:text-[19px] font-bold text-slate-900 dark:text-slate-100 group-hover/row:text-[#1D7DB5] group-hover/row:underline leading-snug font-sans truncate max-w-full">
                                                {m.title}
                                            </h4>
                                            {hasRowPhotos && (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                                                    📷
                                                </span>
                                            )}
                                            {hasRowVideos && (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 border border-purple-200/80 dark:border-purple-800/60 text-[10px] font-bold text-purple-700 dark:text-purple-300 shrink-0">
                                                    🎬
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                                            <span className="font-bold text-slate-700 dark:text-slate-300">
                                                {getCategoryDisplayLabel(m.category)} {t('basecamp.by')} {authorName} • {formattedDate} •{' '}
                                            </span>
                                            <span className="text-slate-500 dark:text-slate-400">
                                                {stripHtml(m.content)}
                                            </span>
                                        </p>
                                    </div>

                                    {/* Right side: Quick Replicate button + ••• menu + Comments count circle badge */}
                                    <div
                                        data-msg-row-menu="true"
                                        onClick={(ev) => ev.stopPropagation()}
                                        className="flex items-center gap-1.5 flex-shrink-0 mt-0.5 relative"
                                    >
                                        <button
                                            type="button"
                                            disabled={replicatingMsgId === m.id}
                                            onClick={(ev) => {
                                                ev.stopPropagation()
                                                void handleReplicateMessage(m)
                                            }}
                                            title={t('basecamp.replicate_message_tooltip')}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-extrabold transition-all cursor-pointer ${
                                                filterText.trim() || categoryFilter
                                                    ? 'bg-[#1D7DB5] hover:bg-[#155D8A] border-[#1D7DB5] text-white shadow-sm'
                                                    : 'opacity-80 group-hover/row:opacity-100 bg-sky-50 dark:bg-sky-950/40 hover:bg-[#1D7DB5] hover:text-white border-sky-200 dark:border-sky-800 text-[#1D7DB5] dark:text-sky-300'
                                            }`}
                                        >
                                            {replicatingMsgId === m.id ? (
                                                <Loader2 size={12} className="animate-spin" />
                                            ) : (
                                                <span>📋</span>
                                            )}
                                            <span className="hidden sm:inline">{t('basecamp.replicate_message')}</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={(ev) => {
                                                ev.stopPropagation()
                                                const btnRect = ev.currentTarget.getBoundingClientRect()
                                                const vh = typeof window !== 'undefined' ? window.innerHeight : 800
                                                setRowMenuUp(vh - btnRect.bottom < 240)
                                                setShowCategoryMenu(false)
                                                setShowSortMenu(false)
                                                setOpenRowMenuId(prev => prev === m.id ? null : m.id)
                                            }}
                                            title={t('basecamp.more_actions')}
                                            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                        >
                                            <MoreHorizontal size={15} />
                                        </button>

                                        {m.comments_count > 0 && (
                                            <span className="w-5 h-5 rounded-full bg-[#1D7DB5] text-white font-extrabold text-[10px] flex items-center justify-center shadow-sm">
                                                {m.comments_count}
                                            </span>
                                        )}

                                        {isRowMenuOpen && (
                                            <div className={`absolute right-0 ${rowMenuUp ? 'bottom-full mb-1.5' : 'top-full mt-1'} w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1.5 z-50 text-left`}>
                                                <button
                                                    type="button"
                                                    onClick={(ev) => {
                                                        ev.stopPropagation()
                                                        void handleReplicateMessage(m)
                                                    }}
                                                    className="w-full px-3.5 py-2 text-xs font-bold text-[#0369A1] dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 flex items-center gap-2.5 cursor-pointer"
                                                >
                                                    <span>📋</span>
                                                    <span>{t('basecamp.replicate_message')}</span>
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={(ev) => {
                                                        ev.stopPropagation()
                                                        startEditMessage(m)
                                                    }}
                                                    className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                                >
                                                    <Pencil size={14} className="text-slate-400" />
                                                    <span>{t('basecamp.edit_message')}</span>
                                                </button>

                                                <button
                                                    type="button"
                                                    disabled={pinBusyId === m.id}
                                                    onClick={(ev) => void handleTogglePinMessage(m, ev)}
                                                    className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                                >
                                                    <Pin size={14} className="text-amber-500" />
                                                    <span>{isPinned ? t('basecamp.unpin_message') : t('basecamp.pin_message')}</span>
                                                </button>

                                                {rowAttachments.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={(ev) => handleDownloadAllAttachments(rowAttachments, ev)}
                                                        className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                                    >
                                                        <Download size={14} className="text-[#1D7DB5]" />
                                                        <span>{t('basecamp.download_all_attachments')} ({rowAttachments.length})</span>
                                                    </button>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={(ev) => handleCopyMessageLink(m, ev)}
                                                    className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 cursor-pointer"
                                                >
                                                    <Link2 size={14} className="text-slate-400" />
                                                    <span>{t('basecamp.copy_link')}</span>
                                                </button>

                                                <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />

                                                <button
                                                    type="button"
                                                    onClick={(ev) => void handleDeleteMessage(m, ev)}
                                                    className="w-full px-3.5 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2.5 cursor-pointer"
                                                >
                                                    <Trash2 size={14} />
                                                    <span>{t('basecamp.put_in_trash')}</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })
                    ) : (
                        <div className="text-center py-12">
                            <Mail size={40} className="text-slate-300 mx-auto mb-3" />
                            <p className="text-xs text-slate-400 italic mb-3">
                                {(filterText.trim() || categoryFilter) ? t('basecamp.no_filtered_results') : t('basecamp.no_messages_desc')}
                            </p>
                            {(filterText.trim() || categoryFilter) && (
                                <button
                                    type="button"
                                    onClick={() => { setFilterText(''); setCategoryFilter(null) }}
                                    className="px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-[#1D7DB5] hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                                >
                                    {t('basecamp.clear_filter')}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Lightbox visor */}
            {lightboxUrl && (
                <div
                    onClick={() => setLightboxUrl(null)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 100,
                        background: 'rgba(0,0,0,0.85)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out'
                    }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(null) }}
                        style={{
                            position: 'absolute', top: 20, right: 20,
                            width: 40, height: 40, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                            color: '#fff', fontSize: 20, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.15s'
                        }}
                    >
                        ✕
                    </button>
                    <img
                        src={lightboxUrl}
                        alt={t('basecamp.fullscreen_view')}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '90vw', maxHeight: '90vh',
                            objectFit: 'contain',
                            borderRadius: 8,
                            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                            cursor: 'default'
                        }}
                    />
                    <a
                        href={buildBasecampDirectDownloadHref(lightboxUrl)}
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            triggerBasecampDownload(lightboxUrl)
                        }}
                        style={{
                            position: 'absolute', bottom: 20,
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 18px', borderRadius: 20,
                            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                            color: '#fff', fontSize: 13, fontWeight: 600,
                            textDecoration: 'none', cursor: 'pointer',
                            transition: 'background 0.15s'
                        }}
                    >
                        {t('basecamp.download_btn')}
                    </a>
                </div>
            )}
        </div>
    )
}
