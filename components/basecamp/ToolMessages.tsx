/**
 * @module ToolMessages
 * @description Módulo de Tablero de Anuncios (Message Board) para notificaciones extensas y procedimientos en Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_message_boards, bc_messages, bc_comments)
 *              y realiza escrituras en Supabase a través de /api/basecamp/action.
 * @businessRules
 *   - Tablero de anuncios general por proyecto.
 *   - Crear y eliminar publicaciones sincroniza con Supabase local.
 *   - Los comentarios en las publicaciones se guardan polimórficamente en `bc_comments`.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga todas las publicaciones de Supabase asociadas a este proyecto (project_id).
 *   - Escritura: Llama al endpoint de acciones `/api/basecamp/action`.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Fix: Corrección de desalineación en IDs de tableros. Al sincronizar con la API real, se genera un board con el bc_id de Basecamp,
 *     mientras que el importador de datos local utilizaba bc_id ficticios (id_proyecto + 2000). Se ha modificado para buscar el tablero real no ficticio,
 *     y consultar todos los mensajes del proyecto por `project_id` en lugar de por `board_id` para garantizar que aparezcan todos los mensajes importados y sincronizados.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Mail, Plus, ArrowLeft, MessageSquare, Trash2, Tag, Calendar, User, Loader2, FileText } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

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

    // Step 0: Remove bc-attachment wrapper tags but preserve inner content
    let rewritten = html.replace(/<bc-attachment[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (match, inner) => {
        return inner || ''
    })
    
    // Step 1: Remove srcset attributes entirely
    rewritten = rewritten.replace(/\s+srcset="[^"]*"/gi, '')
    rewritten = rewritten.replace(/\s+srcset='[^']*'/gi, '')
    
    // Step 2: Rewrite Basecamp image src URLs to our proxy
    rewritten = rewritten.replace(
        /(<img[^>]+src=["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']+)((?:["'])[^\/>]*\/?>)/gi,
        (match, p1, p2, p3) => {
            return `${p1}/api/basecamp/attachment?url=${encodeURIComponent(p2)}${p3}`
        }
    )
    
    // Step 3: Rewrite Basecamp link href URLs to our proxy
    rewritten = rewritten.replace(
        /(<a[^>]+href=["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']+)((?:["'])[^\/>]*\/?>)/gi,
        (match, p1, p2, p3) => {
            return `${p1}/api/basecamp/attachment?url=${encodeURIComponent(p2)}${p3}`
        }
    )
    
    return rewritten
}

const stripHtml = (html: string) => {
    return html?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() || ''
}

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

const getCategoryIcon = (category: string) => {
    const cat = (category || '').toLowerCase()
    if (cat.includes('anuncio') || cat.includes('announcement')) return '📢'
    if (cat.includes('alerta') || cat.includes('alert')) return '🚨'
    if (cat.includes('procedimiento') || cat.includes('guide') || cat.includes('proc')) return '📋'
    if (cat.includes('idea')) return '💡'
    return '💬'
}

const formatBasecampDate = (dateStr: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const currentYear = new Date().getFullYear()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[d.getMonth()]
    const day = d.getDate()
    if (d.getFullYear() === currentYear) {
        return `${month} ${day}`
    } else {
        return `${month} ${day}, ${d.getFullYear()}`
    }
}

interface ToolMessagesProps {
    project: any
    currentUserName: string
}

export default function ToolMessages({ project, currentUserName }: ToolMessagesProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const [messages, setMessages] = useState<any[]>([])
    const [board, setBoard] = useState<{ id: string; bc_id: number } | null>(null)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)

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

    // Formulario de comentario
    const [commentText, setCommentText] = useState('')
    const [filterText, setFilterText] = useState('')

    // Fetch message board and messages from Supabase
    const fetchBoardAndMessages = async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // 1. Get all Message Board containers for the project
            const { data: dbBoards, error: boardErr } = await supabase
                .from('bc_message_boards')
                .select('id, bc_id')
                .eq('project_id', project.db_id)

            if (boardErr) throw boardErr

            let dbBoard = null
            if (dbBoards && dbBoards.length > 0) {
                // Try to find the real board first (not the dummy one: project.id + 2000)
                const dummyBcId = Number(project.id) + 2000
                dbBoard = dbBoards.find(b => Number(b.bc_id) !== dummyBcId)
                // Fallback to first board if no other is found
                if (!dbBoard) {
                    dbBoard = dbBoards[0]
                }
            }

            if (!dbBoard) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newBoard, error: createErr } = await supabase
                    .from('bc_message_boards')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId
                    })
                    .select('id, bc_id')
                    .single()
                if (createErr) throw createErr
                dbBoard = newBoard
            }

            if (dbBoard) {
                setBoard({ id: dbBoard.id, bc_id: Number(dbBoard.bc_id) })

                // 2. Fetch messages belonging to this project (NOT just the board, to avoid splits/orphans)
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
            }
        } catch (err: any) {
            console.error('❌ [ToolMessages Fetch] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    // Fetch comments for selected message
    const fetchSelectedMessageComments = async (msgId: string) => {
        setCommentsLoading(true)
        try {
            const { data: comments, error } = await supabase
                .from('bc_comments')
                .select('*, author:bc_people(name, email, avatar_url)')
                .eq('parent_type', 'message')
                .eq('parent_id', msgId)
                .order('created_at', { ascending: true })

            if (error) throw error
            setSelectedMessageComments(comments || [])
        } catch (err: any) {
            console.error('❌ [ToolMessages Comments Fetch] Error:', err.message)
        } finally {
            setCommentsLoading(false)
        }
    }

    useEffect(() => {
        fetchBoardAndMessages()
        setSelectedMessage(null)
        setSelectedMessageComments([])
    }, [project.id, project.db_id])

    // Load comments when selectedMessage changes
    useEffect(() => {
        if (selectedMessage) {
            fetchSelectedMessageComments(selectedMessage.id)
        } else {
            setSelectedMessageComments([])
        }
    }, [selectedMessage])

    // Publish Message
    const handlePublishMessage = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTitle.trim() || !newContent.trim() || !board) return
        setActionLoading(true)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_message',
                    projectId: project.id,
                    boardId: board.bc_id,
                    boardDbId: board.id,
                    title: newTitle.trim(),
                    content: newContent.trim(),
                    category: newCategory
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewTitle('')
            setNewContent('')
            setNewCategory('Anuncio')
            setShowCreateForm(false)
            await fetchBoardAndMessages()
        } catch (err: any) {
            console.error('❌ [ToolMessages Publish] Error:', err.message)
        } finally {
            setActionLoading(false)
        }
    }

    // Delete Message
    const handleDeleteMessage = async (msg: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_message_confirm'))) return
        setActionLoading(true)
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
            setSelectedMessage(null)
            await fetchBoardAndMessages()
        } catch (err: any) {
            console.error('❌ [ToolMessages Delete] Error:', err.message)
        } finally {
            setActionLoading(false)
        }
    }

    // Publish Comment
    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!commentText.trim() || !selectedMessage) return
        setCommentsLoading(true)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_comment',
                    projectId: project.id,
                    recordingId: selectedMessage.bc_id,
                    parentType: 'message',
                    parentDbId: selectedMessage.id,
                    content: commentText.trim()
                })
            })

            if (!res.ok) throw new Error(await res.text())
            setCommentText('')
            await fetchSelectedMessageComments(selectedMessage.id)

            // Also reload Board Messages to update comment count locally
            const { data: updatedMsg } = await supabase
                .from('bc_messages')
                .select('comments_count')
                .eq('id', selectedMessage.id)
                .single()
            if (updatedMsg) {
                setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, comments_count: updatedMsg.comments_count } : m))
                setSelectedMessage((prev: any) => prev ? { ...prev, comments_count: updatedMsg.comments_count } : null)
            }
        } catch (err: any) {
            console.error('❌ [ToolMessages Comment] Error:', err.message)
        } finally {
            setCommentsLoading(false)
        }
    }

    const filteredMessages = messages.filter(m => {
        const title = (m.title || '').toLowerCase()
        const content = stripHtml(m.content || '').toLowerCase()
        const author = (m.author?.name || '').toLowerCase()
        const cat = (m.category || '').toLowerCase()
        const query = filterText.toLowerCase()
        return title.includes(query) || content.includes(query) || author.includes(query) || cat.includes(query)
    })

    return (
        <div className="flex-1 max-w-4xl mx-auto px-4 w-full flex flex-col gap-6">
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

                    {/* Fila de controles de Basecamp: [+ New message] [All messages] [Categories ▾] [Newest post ▾] [Filter...] */}
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-2 w-full max-w-2xl text-xs">
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold shadow-sm transition-all"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.new_message_btn')}</span>
                        </button>
                        
                        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>

                        <button className="px-3 py-2 rounded-full border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800">
                            {t('basecamp.all_messages')}
                        </button>
                        
                        <button className="px-3 py-2 rounded-full border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                            <span>{t('basecamp.categories')}</span>
                            <span className="text-[9px]">▼</span>
                        </button>

                        <button className="px-3 py-2 rounded-full border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                            <span>{t('basecamp.newest_post')}</span>
                            <span className="text-[9px]">▼</span>
                        </button>

                        {/* Input de filtro */}
                        <div className="relative flex-1 min-w-[150px] max-w-[200px]">
                            <input
                                type="text"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                placeholder={t('basecamp.filter_placeholder')}
                                className="w-full pl-7 pr-3 py-2 border border-slate-250 dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1D7DB5] text-xs font-bold"
                            />
                            <div className="absolute left-2.5 top-2.5 text-slate-400">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
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
                            className="text-xs text-slate-455 hover:text-slate-700 dark:hover:text-slate-200 font-bold"
                        >
                            {t('basecamp.back')}
                        </button>
                    </div>
                    <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 border-b border-slate-100 dark:border-slate-700 pb-2 mb-4">
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
                                    className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-750 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs"
                                >
                                    <option value="Anuncio">{t('basecamp.cat_announcement')}</option>
                                    <option value="Procedimiento">{t('basecamp.cat_guide')}</option>
                                    <option value="Alerta">{t('basecamp.cat_alert')}</option>
                                    <option value="Idea">{t('basecamp.cat_idea')}</option>
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
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={actionLoading}
                                className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm flex items-center gap-1.5"
                            >
                                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{t('basecamp.post_message')}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── 2. VISTA DETALLADA DE UN ANUNCIO ── */}
            {selectedMessage && (
                <div className="flex-1 flex flex-col gap-6">
                    {/* Header: Breadcrumbs & Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                        <div className="text-xs font-bold text-slate-450 flex items-center gap-1.5">
                            <span
                                onClick={() => setSelectedMessage(null)}
                                className="text-[#1D7DB5] hover:underline cursor-pointer"
                            >
                                {project.name || 'All Locations'}
                            </span>
                            <span className="text-slate-350 font-normal">/</span>
                            <span
                                onClick={() => setSelectedMessage(null)}
                                className="text-[#1D7DB5] hover:underline cursor-pointer"
                            >
                                {t('basecamp.message_board')}
                            </span>
                        </div>

                        <button
                            onClick={(e) => {
                                handleDeleteMessage(selectedMessage, e)
                            }}
                            className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 px-3 py-1 rounded-xl transition-all"
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
                                {selectedMessage.author?.name || t('basecamp.unknown_user')} on {formatBasecampDate(selectedMessage.created_at)} • {getCategoryIcon(selectedMessage.category)} {selectedMessage.category || 'General'}
                            </p>
                        </div>

                        {/* Flex container for Message content (Avatar on Left, Content on Right) */}
                        <div className="flex gap-3 sm:gap-4 items-start w-full">
                            {/* Left Side: Large avatar */}
                            <div
                                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-xs sm:text-sm font-black text-white flex-shrink-0 shadow-sm"
                                style={{ backgroundColor: getAvatarColor(selectedMessage.author?.name || '') }}
                            >
                                {getInitials(selectedMessage.author?.name || '')}
                            </div>

                            {/* Right Side: Content and Attachments */}
                            <div className="flex-1 min-w-0">
                                {/* Rich HTML body and attachments styling */}
                                <style dangerouslySetInnerHTML={{ __html: `
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
                                ` }} />

                                {(() => {
                                    const desc = selectedMessage.content || ''
                                    const allAttachments = parseAttachments(desc)
                                    const nonImageAttachments = allAttachments.filter(a => {
                                        const ct = (a.contentType || '').toLowerCase()
                                        const fn = (a.filename || '').toLowerCase()
                                        return !ct.startsWith('image/') && !fn.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
                                    })

                                    let richHtml = desc
                                        .replace(/<bc-attachment[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (match: string, inner: string) => {
                                            if (/<img[^>]+>/i.test(inner)) {
                                                return inner
                                            }
                                            return ''
                                        })
                                        .trim()

                                    richHtml = rewriteHtmlUrls(richHtml)

                                    return (
                                        <div className="flex flex-col gap-4">
                                            {richHtml && (
                                                <div
                                                    className="bc-rich-text text-[16px] sm:text-[17px] text-slate-800 dark:text-slate-200 leading-relaxed font-sans"
                                                    onClick={(e) => {
                                                        const target = e.target as HTMLElement
                                                        if (target.tagName === 'IMG') {
                                                            e.preventDefault()
                                                            e.stopPropagation()
                                                            const imgSrc = (target as HTMLImageElement).src
                                                            setLightboxUrl(imgSrc)
                                                        }
                                                    }}
                                                    dangerouslySetInnerHTML={{ __html: richHtml }}
                                                />
                                            )}

                                            {/* Non-image attachments (PDFs, files) as cards */}
                                            {nonImageAttachments.length > 0 && (
                                                <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4">
                                                    <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-2">
                                                        📎 {nonImageAttachments.length} {nonImageAttachments.length === 1 ? t('basecamp.file_count') : t('basecamp.files_count')}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {nonImageAttachments.map((file, i) => (
                                                            <a
                                                                key={i}
                                                                href={file.url.startsWith('http') ? `/api/basecamp/attachment?url=${encodeURIComponent(file.url)}` : file.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-850 border border-slate-200/60 dark:border-slate-700 rounded-xl text-xs font-bold text-[#1D7DB5] hover:text-[#155D8A] transition-all"
                                                            >
                                                                <FileText size={14} className="text-slate-400 flex-shrink-0" />
                                                                <span className="max-w-[200px] truncate">
                                                                    {decodeURIComponent(file.filename)}
                                                                </span>
                                                            </a>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
                        </div>

                        {/* Boosts/Ok likes section (dynamic ok boosts) */}
                        {(() => {
                            const messageBoosts = selectedMessageComments
                                .filter((c: any) => {
                                    const text = (c.content || '').toLowerCase().trim()
                                    return text === 'ok' || text === 'gracias' || text === 'entendido' || text === 'ok.' || text.includes('gracias')
                                })
                                .slice(0, 8)

                            if (messageBoosts.length === 0) return null

                            return (
                                <div className="flex items-center gap-2.5 flex-wrap pl-16 mt-2 pb-4">
                                    <div className="flex items-center gap-2">
                                        <div className="flex -space-x-1.5">
                                            {messageBoosts.map((boost: any, i: number) => (
                                                <div
                                                    key={i}
                                                    title={`${boost.author?.name || 'User'} - Ok`}
                                                    className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[9px] font-black text-white shadow-sm shrink-0"
                                                    style={{ backgroundColor: getAvatarColor(boost.author?.name || '') }}
                                                >
                                                    {getInitials(boost.author?.name || '')}
                                                </div>
                                            ))}
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                            {messageBoosts.length} {messageBoosts.length === 1 ? 'person said Ok' : 'people said Ok'}
                                        </span>
                                    </div>
                                </div>
                            )
                        })()}
                    </div>

                    {/* Hilo de comentarios de este anuncio */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                        <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-6 flex items-center gap-1.5">
                            <MessageSquare size={14} />
                            {t('basecamp.comments_title')} ({selectedMessage.comments_count || 0})
                        </h4>

                        <div className="space-y-6 mb-6">
                            {commentsLoading && selectedMessageComments.length === 0 ? (
                                <div className="flex justify-center py-6">
                                    <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                </div>
                            ) : selectedMessageComments.length > 0 ? (
                                selectedMessageComments.map((c: any, idx: number) => (
                                    <div key={idx} className="flex gap-3 sm:gap-4 items-start text-xs border-b border-slate-100 dark:border-slate-800/40 pb-5 last:border-0 last:pb-0">
                                        {/* Comment avatar */}
                                        <div
                                            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 uppercase shadow-sm"
                                            style={{ backgroundColor: getAvatarColor(c.author?.name || '') }}
                                        >
                                            {getInitials(c.author?.name || '')}
                                        </div>

                                        {/* Comment Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-1.5 mb-1.5">
                                                <span className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                                                    {c.author?.name || 'Unknown'}
                                                </span>
                                                <span className="text-[11px] text-slate-400">
                                                    • {formatBasecampDate(c.created_at)} at {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div
                                                className="bc-rich-text text-sm text-slate-700 dark:text-slate-350 leading-relaxed font-sans"
                                                dangerouslySetInnerHTML={{ __html: rewriteHtmlUrls(c.content) }}
                                            />
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-400 italic text-center py-6">
                                    {t('basecamp.no_comments_yet')}
                                </p>
                            )}
                        </div>

                        {/* Publicar comentario */}
                        <form onSubmit={handleAddComment} className="flex gap-2">
                            <input
                                type="text"
                                required
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                placeholder={t('basecamp.add_comment_placeholder')}
                                className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs"
                            />
                            <button
                                type="submit"
                                disabled={commentsLoading}
                                className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm shrink-0 flex items-center justify-center min-w-[80px]"
                            >
                                {commentsLoading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    t('basecamp.post_comment')
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ── 3. LISTADO DE ANUNCIOS ── */}
            {!showCreateForm && !selectedMessage && (
                <div className="flex flex-col w-full">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : filteredMessages.length > 0 ? (
                        filteredMessages.map((m) => {
                            const authorName = m.author?.name || t('basecamp.unknown_user')
                            const catIcon = getCategoryIcon(m.category)
                            const formattedDate = formatBasecampDate(m.created_at)

                            return (
                                <div
                                    key={m.id}
                                    onClick={() => setSelectedMessage(m)}
                                    className="border-b border-slate-100 dark:border-slate-850 py-5 flex items-start gap-3 sm:gap-4 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors cursor-pointer"
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
                                            <span className="font-bold text-slate-700 dark:text-slate-350">
                                                {catIcon} {m.category || 'General'} by {authorName} • {formattedDate} •{' '}
                                            </span>
                                            <span className="text-slate-500 dark:text-slate-450">
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
                            <p className="text-xs text-slate-400 italic">
                                {filterText ? t('basecamp.no_filtered_results') : t('basecamp.no_messages_desc')}
                            </p>
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
                        alt="Fullscreen view"
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
                        href={lightboxUrl}
                        download
                        onClick={(e) => e.stopPropagation()}
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
                        {t('basecamp.download_btn') || 'Download'}
                    </a>
                </div>
            )}
        </div>
    )
}
