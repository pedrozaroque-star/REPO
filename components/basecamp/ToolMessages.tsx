/**
 * @module ToolMessages
 * @description Módulo de Tablero de Anuncios (Message Board) para notificaciones extensas y procedimientos en Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_message_boards, bc_messages, bc_comments)
 *              y realiza escrituras bidireccionales en Basecamp API a través de /api/basecamp/action.
 * @businessRules
 *   - Tablero de anuncios general por proyecto.
 *   - Crear y eliminar publicaciones sincroniza con Basecamp API si hay un token configurado.
 *   - Los comentarios en las publicaciones se guardan polimórficamente en `bc_comments`.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga todas las publicaciones de Supabase. Al seleccionar una publicación, carga sus comentarios correspondientes de `bc_comments`.
 *   - Escritura: Llama al endpoint de acciones `/api/basecamp/action`.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Soporte para modo standalone si no existe token activo de Basecamp.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Mail, Plus, ArrowLeft, MessageSquare, Trash2, Tag, Calendar, User, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

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
    const [commentsLoading, setCommentsLoading] = useState(false)

    // Formulario de nuevo anuncio
    const [newTitle, setNewTitle] = useState('')
    const [newContent, setNewContent] = useState('')
    const [newCategory, setNewCategory] = useState('Anuncio')

    // Formulario de comentario
    const [commentText, setCommentText] = useState('')

    // Fetch message board and messages from Supabase
    const fetchBoardAndMessages = async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // 1. Get or create Message Board container
            let { data: dbBoard } = await supabase
                .from('bc_message_boards')
                .select('id, bc_id')
                .eq('project_id', project.db_id)
                .limit(1)
                .single()

            if (!dbBoard) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newBoard, error: boardErr } = await supabase
                    .from('bc_message_boards')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId
                    })
                    .select('id, bc_id')
                    .single()
                if (boardErr) throw boardErr
                dbBoard = newBoard
            }

            if (dbBoard) {
                setBoard({ id: dbBoard.id, bc_id: Number(dbBoard.bc_id) })

                // 2. Fetch messages belonging to this board
                const { data: dbMessages, error: msgErr } = await supabase
                    .from('bc_messages')
                    .select(`
                        *,
                        author:bc_people!bc_messages_author_person_id_fkey(id, name, email)
                    `)
                    .eq('board_id', dbBoard.id)
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

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col gap-6">
            {/* Cabecera del tablero */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center border border-blue-200/30">
                        <Mail size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-extrabold text-slate-850 dark:text-slate-100">
                            {t('basecamp.message_board')}
                        </h3>
                        <p className="text-[10px] text-slate-450 dark:text-slate-400 uppercase tracking-wider">
                            {t('basecamp.message_board_sub')}
                        </p>
                    </div>
                </div>

                {!showCreateForm && !selectedMessage && (
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow-sm transition-all"
                    >
                        <Plus size={14} />
                        <span>{t('basecamp.new_message_btn')}</span>
                    </button>
                )}
            </div>

            {/* ── 1. FORMULARIO DE CREACIÓN ── */}
            {showCreateForm && (
                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
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
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                        <button
                            onClick={() => setSelectedMessage(null)}
                            className="text-xs text-slate-450 hover:text-slate-700 dark:hover:text-slate-200 font-bold"
                        >
                            {t('basecamp.back_to_list')}
                        </button>

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

                    <article className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-500/10 text-blue-600 border border-blue-200/20">
                                <Tag size={10} />
                                {selectedMessage.category}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                                {new Date(selectedMessage.created_at).toLocaleDateString()} {new Date(selectedMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>

                        <h2 className="text-xl font-extrabold text-slate-850 dark:text-slate-100 mb-4 font-serif">
                            {selectedMessage.title}
                        </h2>

                        <div className="flex items-center gap-3 border-y border-slate-100 dark:border-slate-700/80 py-2.5 mb-6 text-xs text-slate-500">
                            <div className="w-8 h-8 rounded-full bg-[#1D7DB5] text-white font-extrabold flex items-center justify-center text-xs shrink-0">
                                {selectedMessage.author?.name ? selectedMessage.author.name[0] : 'U'}
                            </div>
                            <div>
                                <p className="font-extrabold text-slate-700 dark:text-slate-300 leading-none">
                                    {selectedMessage.author?.name || t('basecamp.unknown_user')}
                                </p>
                                <p className="text-[9px] text-slate-400 mt-0.5">
                                    {selectedMessage.author?.email || ''}
                                </p>
                            </div>
                        </div>

                        <div className="text-xs text-slate-650 dark:text-slate-350 leading-relaxed whitespace-pre-wrap">
                            {selectedMessage.content}
                        </div>
                    </article>

                    {/* Hilo de comentarios de este anuncio */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                        <h4 className="text-xs font-bold text-slate-455 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                            <MessageSquare size={14} />
                            {t('basecamp.comments_title')} ({selectedMessage.comments_count || 0})
                        </h4>

                        <div className="space-y-4 mb-6">
                            {commentsLoading && selectedMessageComments.length === 0 ? (
                                <div className="flex justify-center py-6">
                                    <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                </div>
                            ) : selectedMessageComments.length > 0 ? (
                                selectedMessageComments.map((c: any, idx: number) => (
                                    <div key={idx} className="flex gap-3 text-xs">
                                        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold flex items-center justify-center shrink-0 uppercase">
                                            {c.author?.name ? c.author.name[0] : 'U'}
                                        </div>
                                        <div className="bg-slate-50 dark:bg-slate-850/60 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 flex-1">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-extrabold text-slate-750 dark:text-slate-200">
                                                    {c.author?.name || 'Unknown'}
                                                </span>
                                                <span className="text-[8px] text-slate-400 uppercase">
                                                    {new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <p className="text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">{c.content}</p>
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
                <div className="space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : messages.length > 0 ? (
                        messages.map((m) => (
                            <div
                                key={m.id}
                                onClick={() => setSelectedMessage(m)}
                                className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-500/10 text-blue-600 border border-blue-200/20">
                                            <Tag size={10} />
                                            {m.category}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-medium">
                                            {new Date(m.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <h4 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 hover:underline font-serif">
                                        {m.title}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-2 leading-relaxed whitespace-pre-wrap">
                                        {m.content}
                                    </p>
                                </div>

                                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-4 text-[10px] text-slate-400">
                                    <span className="font-bold flex items-center gap-1">
                                        <User size={10} />
                                        {m.author?.name || t('basecamp.unknown_user')}
                                    </span>
                                    <span className="flex items-center gap-1 font-bold">
                                        <MessageSquare size={10} />
                                        {m.comments_count || 0} {t('basecamp.comments')}
                                    </span>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-12">
                            <Mail size={40} className="text-slate-300 mx-auto mb-3" />
                            <p className="text-xs text-slate-400 italic">{t('basecamp.no_messages_desc')}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
