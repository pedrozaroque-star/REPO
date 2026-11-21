/**
 * @module ToolMessages
 * @description Módulo de Tablero de Anuncios (Message Board) para notificaciones extensas y procedimientos en Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_message_boards, bc_messages, bc_comments)
 *              y realiza escrituras en Supabase y Basecamp API a través de /api/basecamp/action.
 * @businessRules
 *   - Tablero de anuncios general por proyecto.
 *   - Crear y eliminar publicaciones sincroniza con Supabase local y replica en Basecamp 3 API.
 *   - Los comentarios en las publicaciones se guardan polimórficamente en `bc_comments`.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id), `currentUserName`, y opcionales `selectedMessageId` / `messageId` / `onCloseDetail`.
 *   - Fetch: Carga todas las publicaciones de Supabase asociadas a este proyecto (project_id).
 *   - Escritura: Llama al endpoint de acciones `/api/basecamp/action`.
 * @notes
 *   - Soporte multilingüe 100% bilingüe (ES/EN) con useLanguage.
 *   - Fix: Corrección de desalineación en IDs de tableros consultando mensajes por `project_id`.
 *   - Audit fixes (2026): Integración con `@/lib/basecamp-html` (`rewriteBasecampHtmlUrls`, `safeDecodeFilename`),
 *     soporte completo de categorías reales de DB (`Announcement`, `FYI`, `General`, `Question`, `Anuncio`, `Procedimiento`, `Alerta`, `Idea`)
 *     con equivalencia bilingüe, chips de descarga de adjuntos y visor Lightbox también en comentarios,
 *     desempaquetado seguro de `Array.isArray(author)`, fechas/horas en `America/Los_Angeles`, boosts solo en acuses cortos,
 *     normalización de acentos (`NFD`), conversión de `\n` a `<br>`, y reemplazo de clases Tailwind inválidas.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Mail, Plus, MessageSquare, Trash2, Loader2, FileText, Paperclip } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'
import {
    rewriteBasecampHtmlUrls,
    safeDecodeFilename,
    sanitizeBasecampHtml,
    injectImageDownloadOverlays,
    triggerBasecampDownload,
    buildBasecampDirectDownloadHref,
    BASECAMP_IMAGE_HOVER_CSS,
} from '@/lib/basecamp-html'

export { sanitizeBasecampHtml }

const getBlobUuid = (url: string) => {
    const match = url.match(/\/blobs\/([a-f0-9-]+)/i)
    return match ? match[1] : null
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

const parseAttachments = (html: string) => {
    const attachments: any[] = []
    if (!html) return attachments

    const bcAttachmentRegex = /<bc-attachment\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
    let match
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1]

        const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }

        const contentType = getAttr('content-type') || ''
        const filename = getAttr('filename') || ''
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
        if (isAlreadyCaptured) continue

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

const rewriteHtmlUrls = (html: string) => {
    if (!html) return ''
    const withoutDataAuthor = html
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
        .replace(/<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (_m, inner) => inner || '')
        .replace(/<bc-attachment\b[^>]*\/>/gi, '')
    return rewriteBasecampHtmlUrls(withoutDataAuthor)
}

const prepareRichContent = (rawHtml?: string | null) => {
    if (!rawHtml) return { sanitizedHtml: '', nonImageAttachments: [] as any[] }
    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    const allAttachments = parseAttachments(cleaned)
    const nonImageAttachments = allAttachments.filter(a => {
        const ct = (a.contentType || '').toLowerCase()
        const fn = (a.filename || '').toLowerCase()
        return !ct.startsWith('image/') && !fn.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
    })
    const strippedBcHtml = cleaned
        .replace(/<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (_match, inner) => {
            if (/<img\b[^>]+>/i.test(inner)) return inner
            return ''
        })
        .replace(/<bc-attachment\b[^>]*\/>/gi, '')
        .trim()
    const sanitizedHtml = rewriteHtmlUrls(strippedBcHtml)
    return { sanitizedHtml, nonImageAttachments }
}

const sanitizeAttachmentHref = (rawUrl?: string): string => {
    if (!rawUrl || typeof rawUrl !== 'string') return '#'
    const trimmed = rawUrl.trim().replace(/&amp;/g, '&')
    if (trimmed.startsWith('/api/basecamp/attachment?')) return trimmed
    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'https:') return '#'
        const host = parsed.hostname.toLowerCase()
        if (host.endsWith('.supabase.co') || host.endsWith('.amazonaws.com')) return parsed.toString()
        if (
            host === '3.basecampapi.com' ||
            host === 'preview.app.basecamp.com' ||
            host === 'storage.app.basecamp.com'
        ) {
            return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
        }
        return '#'
    } catch {
        return '#'
    }
}

const stripHtml = (html?: string | null): string => {
    if (!html) return ''
    const withoutBanner = stripTegAuthorBanner(html).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
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

type CanonicalCategory = 'announcement' | 'fyi' | 'general' | 'question' | 'guide' | 'alert' | 'idea' | string

const getCanonicalCategory = (raw?: string | null): CanonicalCategory => {
    const norm = normalizeSearch(raw)
    if (!norm || norm === 'general') return 'general'
    if (norm.includes('anuncio') || norm.includes('announcement')) return 'announcement'
    if (norm === 'fyi' || norm.includes('fyi') || norm.includes('informacion')) return 'fyi'
    if (norm.includes('question') || norm.includes('pregunta')) return 'question'
    if (norm.includes('procedimiento') || norm.includes('procedure') || norm.includes('guide') || norm.includes('proc')) return 'guide'
    if (norm.includes('alerta') || norm.includes('alert') || norm.includes('urgent')) return 'alert'
    if (norm.includes('idea')) return 'idea'
    return norm
}

const CATEGORY_FILTER_OPTIONS = [
    { value: 'Anuncio', canonical: 'announcement' },
    { value: 'FYI', canonical: 'fyi' },
    { value: 'General', canonical: 'general' },
    { value: 'Question', canonical: 'question' },
    { value: 'Procedimiento', canonical: 'guide' },
    { value: 'Alerta', canonical: 'alert' },
    { value: 'Idea', canonical: 'idea' },
]

interface ToolMessagesProps {
    project: any
    currentUserName: string
    selectedMessageId?: string
    messageId?: string
    onCloseDetail?: () => void
}

export default function ToolMessages({
    project,
    currentUserName,
    selectedMessageId,
    messageId,
    onCloseDetail
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

    // Formulario de nuevo anuncio
    const [newTitle, setNewTitle] = useState('')
    const [newContent, setNewContent] = useState('')
    const [newCategory, setNewCategory] = useState('Anuncio')

    // Formulario de comentario y filtros
    const [commentText, setCommentText] = useState('')
    const [filterText, setFilterText] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
    const [showCategoryMenu, setShowCategoryMenu] = useState(false)
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

    const categoryMenuRef = useRef<HTMLDivElement>(null)
    const inFlightBoardCreateRef = useRef(false)
    const activeMessageIdRef = useRef<string | null>(null)
    activeMessageIdRef.current = selectedMessage?.id || null

    const getCategoryDisplayLabel = useCallback((rawCategory?: string | null): string => {
        const canon = getCanonicalCategory(rawCategory)
        switch (canon) {
            case 'announcement': return t('basecamp.cat_announcement')
            case 'fyi': return t('basecamp.cat_fyi')
            case 'general': return t('basecamp.cat_general')
            case 'question': return t('basecamp.cat_question')
            case 'guide': return t('basecamp.cat_guide')
            case 'alert': return t('basecamp.cat_alert')
            case 'idea': return t('basecamp.cat_idea')
            default: return `💬 ${rawCategory}`
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
        if (onCloseDetail) onCloseDetail()
    }, [onCloseDetail])

    // Close category dropdown on outside click
    useEffect(() => {
        if (!showCategoryMenu) return
        const handleOutside = (e: MouseEvent) => {
            if (categoryMenuRef.current && !categoryMenuRef.current.contains(e.target as Node)) {
                setShowCategoryMenu(false)
            }
        }
        document.addEventListener('mousedown', handleOutside)
        return () => document.removeEventListener('mousedown', handleOutside)
    }, [showCategoryMenu])

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
            setLoading(false)
        }
    }, [project.db_id, project.id, supabase])

    // Fetch comments for selected message
    const fetchSelectedMessageComments = useCallback(async (msgId: string, opts?: { silent?: boolean }) => {
        if (!msgId) return
        if (!opts?.silent) setCommentsLoading(true)
        try {
            const { data: comments, error } = await supabase
                .from('bc_comments')
                .select('*, author:bc_people(name, email, avatar_url)')
                .eq('parent_type', 'message')
                .eq('parent_id', msgId)
                .order('created_at', { ascending: true })

            if (error) throw error
            if (activeMessageIdRef.current !== msgId) return
            setSelectedMessageComments(comments || [])
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
        setMessages([])
        setSelectedMessage(null)
        setSelectedMessageComments([])
        setShowCreateForm(false)
        setFilterText('')
        setCategoryFilter(null)
        setShowCategoryMenu(false)
        setMutationError(null)
        fetchBoardAndMessages()
    }, [project.db_id, fetchBoardAndMessages])

    // Support deep-link selection via selectedMessageId or messageId prop
    const targetDeepLinkId = selectedMessageId || messageId
    useEffect(() => {
        if (targetDeepLinkId && messages.length > 0) {
            const found = messages.find((m: any) => m.id === targetDeepLinkId)
            if (found) {
                setSelectedMessage(found)
                setShowCreateForm(false)
            }
        }
    }, [targetDeepLinkId, messages])

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
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project.db_id, selectedMessage?.id, fetchBoardAndMessages, fetchSelectedMessageComments, supabase])

    // Layered Escape key handling: Lightbox -> Category Menu -> Selected Message -> Create Form
    useEffect(() => {
        if (!lightboxUrl && !showCategoryMenu && !selectedMessage && !showCreateForm) return
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (lightboxUrl) {
                e.preventDefault()
                setLightboxUrl(null)
                return
            }
            if (showCategoryMenu) {
                e.preventDefault()
                setShowCategoryMenu(false)
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
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [lightboxUrl, showCategoryMenu, selectedMessage, showCreateForm, closeMessageDetail])

    // Load comments when selectedMessage ID changes
    useEffect(() => {
        if (selectedMessage?.id) {
            setSelectedMessageComments([])
            fetchSelectedMessageComments(selectedMessage.id)
        } else {
            setSelectedMessageComments([])
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
            const imgSrc = (target as HTMLImageElement).src
            if (imgSrc) {
                e.preventDefault()
                e.stopPropagation()
                setLightboxUrl(imgSrc)
            }
        }
    }, [])

    // Publish Message
    const handlePublishMessage = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTitle.trim() || !newContent.trim() || !board) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const htmlContent = plainTextToHtml(newContent)
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_message',
                    projectId: project.id,
                    boardId: board.bc_id,
                    boardDbId: board.id,
                    title: newTitle.trim(),
                    content: htmlContent,
                    category: newCategory
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewTitle('')
            setNewContent('')
            setNewCategory('Anuncio')
            setShowCreateForm(false)
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages Publish] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Delete Message
    const handleDeleteMessage = async (msg: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_message_confirm'))) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: msg.bc_id,
                    recordingDbId: msg.id,
                    tableName: 'bc_messages'
                })
            })

            if (!res.ok) throw new Error(await res.text())
            closeMessageDetail()
            await fetchBoardAndMessages({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolMessages Delete] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    // Publish Comment
    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!commentText.trim() || !selectedMessage) return
        setActionLoading(true)
        setMutationError(null)
        try {
            const htmlComment = plainTextToHtml(commentText)
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            await fetchSelectedMessageComments(selectedMessage.id, { silent: true })

            // Reload comment count locally without full spinner
            const { data: updatedMsg } = await supabase
                .from('bc_messages')
                .select('comments_count')
                .eq('id', selectedMessage.id)
                .maybeSingle()
            if (updatedMsg) {
                setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, comments_count: updatedMsg.comments_count } : m))
                setSelectedMessage((prev: any) => prev ? { ...prev, comments_count: updatedMsg.comments_count } : null)
            }
        } catch (err: any) {
            console.error('❌ [ToolMessages Comment] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(false)
        }
    }

    const filteredMessages = useMemo(() => {
        const query = normalizeSearch(filterText)
        const targetCanonCat = categoryFilter ? getCanonicalCategory(categoryFilter) : null

        const result = messages.filter(m => {
            const authorName = getAuthorObj(m.author)?.name || ''
            const titleNorm = normalizeSearch(m.title)
            const contentNorm = normalizeSearch(stripHtml(m.content || ''))
            const authorNorm = normalizeSearch(authorName)
            const rawCatNorm = normalizeSearch(m.category)
            const displayCatNorm = normalizeSearch(getCategoryDisplayLabel(m.category))

            const matchesQuery =
                !query ||
                titleNorm.includes(query) ||
                contentNorm.includes(query) ||
                authorNorm.includes(query) ||
                rawCatNorm.includes(query) ||
                displayCatNorm.includes(query)

            const matchesCat =
                !targetCanonCat ||
                getCanonicalCategory(m.category) === targetCanonCat

            return matchesQuery && matchesCat
        })
        result.sort((a, b) => {
            const tA = new Date(a.created_at || 0).getTime()
            const tB = new Date(b.created_at || 0).getTime()
            return sortOrder === 'newest' ? tB - tA : tA - tB
        })
        return result
    }, [messages, filterText, categoryFilter, sortOrder, getCategoryDisplayLabel])

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
                <div className="flex flex-col items-center gap-4 text-center border-b border-slate-100 dark:border-slate-800/80 pb-6">
                    <div className="flex flex-col items-center gap-1">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            {t('basecamp.message_board_sub')}
                        </span>
                        <h3 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 font-serif">
                            {t('basecamp.message_board')}
                        </h3>
                    </div>

                    {/* Fila de controles de Basecamp */}
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-2 w-full max-w-2xl text-xs">
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold shadow-sm transition-all cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.new_message_btn')}</span>
                        </button>

                        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

                        <button
                            onClick={() => { setCategoryFilter(null); setFilterText(''); setShowCategoryMenu(false) }}
                            className={`px-3 py-2 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                                !categoryFilter && !filterText
                                    ? 'border-[#1D7DB5] bg-[#1D7DB5]/10 text-[#1D7DB5] dark:text-sky-400'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                        >
                            {t('basecamp.all_messages')}
                        </button>

                        {/* Dropdown de Categorías (soporta todas las categorías reales de DB con equivalencia ES/EN) */}
                        <div ref={categoryMenuRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setShowCategoryMenu(prev => !prev)}
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
                                <div className="absolute left-0 top-full mt-1.5 w-48 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg py-1.5 z-40 text-left">
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

                        <button
                            onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
                            className="px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer transition-all"
                        >
                            <span>{sortOrder === 'newest' ? t('basecamp.sort_newest') : t('basecamp.sort_oldest')}</span>
                            <span className="text-[9px]">▼</span>
                        </button>

                        {/* Input de filtro */}
                        <div className="relative flex-1 min-w-[150px] max-w-[200px]">
                            <input
                                type="text"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                placeholder={t('basecamp.filter_placeholder')}
                                className="w-full pl-7 pr-7 py-2 border border-slate-200 dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1D7DB5] text-xs font-bold"
                            />
                            <div className="absolute left-2.5 top-2.5 text-slate-400">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
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

            {/* ── 1. FORMULARIO DE CREACIÓN ── */}
            {showCreateForm && (
                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <button
                            type="button"
                            onClick={() => setShowCreateForm(false)}
                            className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-bold cursor-pointer"
                        >
                            {t('basecamp.back')}
                        </button>
                    </div>
                    <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">
                        {t('basecamp.new_message_btn')}
                    </h4>
                    <form onSubmit={handlePublishMessage} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-2">
                                <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.announcement_title_label')}</label>
                                <input
                                    type="text"
                                    required
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder={t('basecamp.new_message_title')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.category_label')}</label>
                                <select
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs"
                                >
                                    {CATEGORY_FILTER_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {getCategoryDisplayLabel(opt.value)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 tracking-wider mb-1">{t('basecamp.message_content_label')}</label>
                            <textarea
                                required
                                value={newContent}
                                onChange={(e) => setNewContent(e.target.value)}
                                placeholder={t('basecamp.new_message_placeholder')}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs h-40"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={actionLoading}
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
                const { sanitizedHtml: richHtml, nonImageAttachments } = prepareRichContent(selectedMessage.content || '')
                const messageBoosts = selectedMessageComments
                    .filter((c: any) => isShortAckBoost(c.content))
                    .slice(0, 8)

                return (
                    <div className="flex-1 flex flex-col gap-6">
                        {/* Header: Breadcrumbs & Actions */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
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

                            <button
                                onClick={(e) => handleDeleteMessage(selectedMessage, e)}
                                className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 px-3 py-1 rounded-xl transition-all cursor-pointer"
                            >
                                <Trash2 size={13} />
                                <span>{t('basecamp.delete')}</span>
                            </button>
                        </div>

                        {/* Message Body Container */}
                        <div className="w-full flex flex-col gap-6">
                            {/* Title and Subtitle */}
                            <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                                <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-50 font-sans tracking-tight leading-tight mb-2">
                                    {selectedMessage.title}
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-bold">
                                    {selectedAuthorName} {t('basecamp.on_date')} {formatMessageDate(selectedMessage.created_at)} {t('basecamp.time_at')} {formatMessageTime(selectedMessage.created_at)} • {getCategoryDisplayLabel(selectedMessage.category)}
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

                                        {/* Non-image attachments (PDFs, files) as cards */}
                                        {nonImageAttachments.length > 0 && (
                                            <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4">
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
                                                            <span className="max-w-[200px] truncate">
                                                                {cleanName}
                                                            </span>
                                                        </a>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Boosts/Ok likes section (short acknowledgements only, bilingual label) */}
                            {messageBoosts.length > 0 && (
                                <div className="flex items-center gap-2.5 flex-wrap pl-16 mt-2 pb-4">
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

                        {/* Hilo de comentarios de este anuncio */}
                        <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
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
                                        const { sanitizedHtml: commentHtml, nonImageAttachments: commentFiles } = prepareRichContent(c.content)

                                        return (
                                            <div key={c.id || idx} className="flex gap-3 sm:gap-4 items-start text-xs border-b border-slate-100 dark:border-slate-800/40 pb-5 last:border-0 last:pb-0">
                                                {/* Comment avatar */}
                                                <div
                                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 uppercase shadow-sm"
                                                    style={{ backgroundColor: getAvatarColor(commentAuthor) }}
                                                >
                                                    {getInitials(commentAuthor)}
                                                </div>

                                                {/* Comment Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-baseline gap-1.5 mb-1.5 flex-wrap">
                                                        <span className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                                                            {commentAuthor}
                                                        </span>
                                                        <span className="text-[11px] text-slate-400">
                                                            • {formatMessageDate(c.created_at)} {t('basecamp.time_at')} {formatMessageTime(c.created_at)}
                                                        </span>
                                                    </div>

                                                    {commentHtml && (
                                                        <div
                                                            className="bc-rich-text text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-sans"
                                                            onClick={handleRichImgClick}
                                                            dangerouslySetInnerHTML={{ __html: injectImageDownloadOverlays(commentHtml, t('basecamp.download_btn')) }}
                                                        />
                                                    )}

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

                            {/* Publicar comentario */}
                            <form onSubmit={handleAddComment} className="flex gap-2 items-start">
                                <textarea
                                    required
                                    rows={2}
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value)}
                                    placeholder={t('basecamp.add_comment_placeholder')}
                                    className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs resize-y"
                                />
                                <button
                                    type="submit"
                                    disabled={actionLoading}
                                    className="px-4 py-2.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm shrink-0 flex items-center justify-center min-w-[80px] cursor-pointer"
                                >
                                    {actionLoading ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        t('basecamp.post_comment')
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>
                )
            })()}

            {/* ── 3. LISTADO DE ANUNCIOS ── */}
            {!showCreateForm && !selectedMessage && (
                <div className="flex flex-col w-full">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : filteredMessages.length > 0 ? (
                        filteredMessages.map((m) => {
                            const authorName = getAuthorObj(m.author)?.name || t('basecamp.unknown_user')
                            const formattedDate = formatMessageDate(m.created_at)

                            return (
                                <div
                                    key={m.id}
                                    onClick={() => setSelectedMessage(m)}
                                    className="border-b border-slate-100 dark:border-slate-800 py-5 flex items-start gap-3 sm:gap-4 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors cursor-pointer"
                                >
                                    {/* Left side: Avatar */}
                                    <div
                                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 shadow-sm"
                                        style={{ backgroundColor: getAvatarColor(authorName) }}
                                    >
                                        {getInitials(authorName)}
                                    </div>

                                    {/* Middle: Content */}
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-[19px] font-bold text-slate-900 dark:text-slate-100 hover:text-[#1D7DB5] hover:underline leading-snug mb-1.5 font-sans">
                                            {m.title}
                                        </h4>
                                        <p className="text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                                            <span className="font-bold text-slate-700 dark:text-slate-300">
                                                {getCategoryDisplayLabel(m.category)} {t('basecamp.by')} {authorName} • {formattedDate} •{' '}
                                            </span>
                                            <span className="text-slate-500 dark:text-slate-400">
                                                {stripHtml(m.content)}
                                            </span>
                                        </p>
                                    </div>

                                    {/* Right side: Comments count circle badge */}
                                    {m.comments_count > 0 && (
                                        <div className="flex-shrink-0 flex items-center justify-center mt-1">
                                            <span className="w-5 h-5 rounded-full bg-[#1D7DB5] text-white font-extrabold text-[10px] flex items-center justify-center shadow-sm">
                                                {m.comments_count}
                                            </span>
                                        </div>
                                    )}
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
