/**
 * @module ToolCampfire
 * @description Módulo de Chat Campfire de Basecamp para coordinación rápida de proyectos de Tacos Gavilan.
 *              Carga el historial desde Supabase (bc_campfire_lines) y escucha nuevos mensajes
 *              en tiempo real utilizando canales de Supabase Realtime.
 * @businessRules
 *   - Chat grupal compartido en tiempo real por proyecto.
 *   - Enviar mensajes invoca la API de Basecamp y persiste la línea en Supabase.
 *   - No utiliza respuestas simuladas automáticas.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga las líneas de chat desde `bc_campfire_lines` ordenadas cronológicamente.
 *   - Realtime: Escucha eventos `INSERT` en `bc_campfire_lines` filtrados por `project_id`.
 *   - Escritura: Envía peticiones POST a `/api/basecamp/action`.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: El chat funciona localmente en Supabase de forma autónoma.
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Send, MessageSquare, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

interface ToolCampfireProps {
    project: any
    currentUserName: string
}

export default function ToolCampfire({ project, currentUserName }: ToolCampfireProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const [campfire, setCampfire] = useState<{ id: string; bc_id: number } | null>(null)
    const [messages, setMessages] = useState<any[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // 1. Fetch campfire and message history
    const fetchCampfireAndLines = async () => {
        if (!project.db_id) return
        try {
            // Get or create campfire container
            let { data: dbCampfire } = await supabase
                .from('bc_campfires')
                .select('id, bc_id')
                .eq('project_id', project.db_id)
                .limit(1)
                .single()

            if (!dbCampfire) {
                const tempBcId = Math.floor(Date.now() / 1000)
                const { data: newCampfire, error: campErr } = await supabase
                    .from('bc_campfires')
                    .insert({
                        project_id: project.db_id,
                        bc_id: tempBcId
                    })
                    .select('id, bc_id')
                    .single()
                if (campErr) throw campErr
                dbCampfire = newCampfire
            }

            if (dbCampfire) {
                setCampfire({ id: dbCampfire.id, bc_id: Number(dbCampfire.bc_id) })

                // Fetch last 50 campfire lines
                const { data: dbLines, error: linesErr } = await supabase
                    .from('bc_campfire_lines')
                    .select(`
                        id,
                        content,
                        created_at,
                        author:bc_people!bc_campfire_lines_author_person_id_fkey(name, email, avatar_url)
                    `)
                    .eq('campfire_id', dbCampfire.id)
                    .order('created_at', { ascending: true })
                    .limit(80)

                if (linesErr) throw linesErr
                setMessages(dbLines || [])
            }
        } catch (err: any) {
            console.error('❌ [ToolCampfire Fetch] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setLoading(true)
        fetchCampfireAndLines()
    }, [project.id, project.db_id])

    // 2. Set up Supabase Realtime Subscription
    useEffect(() => {
        if (!campfire?.id) return

        const channel = supabase
            .channel(`campfire-lines-${campfire.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'bc_campfire_lines',
                    filter: `campfire_id=eq.${campfire.id}`
                },
                async (payload) => {
                    // Fetch details of the newly inserted line
                    const { data: newLine, error } = await supabase
                        .from('bc_campfire_lines')
                        .select(`
                            id,
                            content,
                            created_at,
                            author:bc_people!bc_campfire_lines_author_person_id_fkey(name, email, avatar_url)
                        `)
                        .eq('id', payload.new.id)
                        .single()

                    if (!error && newLine) {
                        setMessages((prev) => {
                            // Avoid duplicate appends
                            if (prev.some((m) => m.id === newLine.id)) return prev
                            return [...prev, newLine]
                        })
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [campfire?.id])

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Send Message
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!inputText.trim() || !campfire || sending) return

        const textToSend = inputText.trim()
        setInputText('')
        setSending(true)

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_campfire_line',
                    projectId: project.id,
                    campfireId: campfire.bc_id,
                    campfireDbId: campfire.id,
                    content: textToSend
                })
            })

            if (!res.ok) throw new Error(await res.text())
        } catch (err: any) {
            console.error('❌ [ToolCampfire Send] Error sending message:', err.message)
            // Restore input in case of failure
            setInputText(textToSend)
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col bg-[#fffdfb] dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-2xl shadow-sm">
            {/* Header del Campfire */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900 rounded-t-2xl">
                <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border border-orange-200/30">
                    <MessageSquare size={20} />
                </div>
                <div>
                    <h3 className="text-base font-extrabold text-slate-855 dark:text-slate-100">
                        {t('basecamp.campfire')}
                    </h3>
                    <p className="text-[10px] text-slate-455 dark:text-slate-400 uppercase tracking-wider">
                        {t('basecamp.campfire_sub')}
                    </p>
                </div>
            </div>

            {/* Panel de mensajes */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[480px] min-h-[350px] no-scrollbar">
                {loading ? (
                    <div className="flex justify-center items-center h-full">
                        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                    </div>
                ) : messages.length > 0 ? (
                    messages.map((m) => {
                        const authorName = m.author?.name || 'Usuario'
                        const isMe = authorName === currentUserName
                        return (
                            <div key={m.id} className={`flex gap-3 items-start ${isMe ? 'flex-row-reverse' : ''}`}>
                                {/* Avatar */}
                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold flex items-center justify-center text-xs shrink-0 uppercase border border-slate-300/30">
                                    {authorName[0]}
                                </div>
                                
                                {/* Detalle */}
                                <div className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-[10px] font-black text-slate-800 dark:text-slate-200">{authorName}</span>
                                        <span className="text-[8px] text-slate-400 dark:text-slate-500 font-medium">
                                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className={`p-2.5 sm:p-3 rounded-2xl text-xs mt-1 leading-relaxed whitespace-pre-wrap border ${
                                        isMe 
                                            ? 'bg-orange-500 text-white border-orange-600 rounded-tr-none' 
                                            : 'bg-slate-55/70 dark:bg-slate-800/80 text-slate-800 dark:text-slate-250 border-slate-200/40 dark:border-slate-800 rounded-tl-none'
                                    }`}>
                                        {m.content}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 py-12">
                        <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
                        <p className="text-xs italic">{t('basecamp.welcome_campfire')}</p>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-100 dark:border-slate-850 bg-white dark:bg-slate-900 rounded-b-2xl flex gap-2">
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    disabled={sending || !campfire}
                    placeholder={t('basecamp.send_campfire_placeholder')}
                    className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 text-xs disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={sending || !campfire || !inputText.trim()}
                    className="p-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white shadow transition-all flex items-center justify-center shrink-0 w-11 h-11"
                >
                    {sending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Send size={15} />
                    )}
                </button>
            </form>
        </div>
    )
}
