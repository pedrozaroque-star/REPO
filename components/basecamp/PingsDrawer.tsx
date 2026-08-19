/**
 * @module PingsDrawer
 * @description Módulo de mensajería privada (Pings) entre integrantes de Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_people y bc_pings)
 *              y proporciona chat 1 a 1 en tiempo real mediante Supabase Realtime.
 * @businessRules
 *   - Chat privado 1-a-1 guardado en la tabla `bc_pings`.
 *   - Carga el listado de personas activas desde la tabla `bc_people`.
 *   - No utiliza respuestas simuladas automáticas.
 * @dataFlow
 *   - Entrada: Props `activeUser` (nombre o email del contacto) y la función de navegación.
 *   - Fetch: Resuelve el remitente y el destinatario en `bc_people`, y carga el historial de mensajes de `bc_pings`.
 *   - Realtime: Escucha eventos `INSERT` en `bc_pings` que correspondan al remitente y destinatario seleccionados.
 *   - Escritura: Inserta directamente en la tabla `bc_pings` de Supabase.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: La mensajería funciona localmente en Supabase de forma autónoma.
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Send, ArrowLeft, MessageSquare, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'

interface PingsDrawerProps {
    activeUser: string | null
    navigateTo: (params: { project?: string; tool?: string; section?: string; ping?: string }) => void
    currentUserName: string
}

export default function PingsDrawer({ activeUser, navigateTo, currentUserName }: PingsDrawerProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const { user: authUser, loading: authLoading } = useAuth()
    const [collaborators, setCollaborators] = useState<any[]>([])
    const [messages, setMessages] = useState<any[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(true)
    const [chatLoading, setChatLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [currentPerson, setCurrentPerson] = useState<any>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // 1. Fetch current logged-in person and all active collaborators
    useEffect(() => {
        if (authLoading || !authUser) return

        const loadInitialData = async () => {
            setLoading(true)
            try {
                // Fetch current user in bc_people using authUser email from localStorage
                const { data: selfPerson } = await supabase
                    .from('bc_people')
                    .select('id, name, email')
                    .eq('email', authUser.email || '')
                    .limit(1)
                    .single()

                if (selfPerson) {
                    setCurrentPerson(selfPerson)
                }

                // Fetch all active people
                const { data: people, error } = await supabase
                    .from('bc_people')
                    .select('*')
                    .eq('is_active', true)
                    .order('name', { ascending: true })

                if (error) throw error
                setCollaborators(people || [])
            } catch (err: any) {
                console.error('❌ [PingsDrawer Init] Error:', err.message)
            } finally {
                setLoading(false)
            }
        }
        loadInitialData()
    }, [authUser, authLoading])

    // Resolve the selected contact details
    const activePartner = collaborators.find(c => c.name === activeUser || c.email === activeUser)

    // 2. Fetch conversation history when partner changes
    const fetchChatHistory = async () => {
        if (!currentPerson?.id || !activePartner?.id) return
        setChatLoading(true)
        try {
            const { data: chatLines, error } = await supabase
                .from('bc_pings')
                .select('*')
                .or(`and(sender_person_id.eq.${currentPerson.id},recipient_person_id.eq.${activePartner.id}),and(sender_person_id.eq.${activePartner.id},recipient_person_id.eq.${currentPerson.id})`)
                .order('created_at', { ascending: true })

            if (error) throw error
            setMessages(chatLines || [])
        } catch (err: any) {
            console.error('❌ [PingsDrawer FetchChat] Error:', err.message)
        } finally {
            setChatLoading(false)
        }
    }

    useEffect(() => {
        if (currentPerson?.id && activePartner?.id) {
            fetchChatHistory()
        } else {
            setMessages([])
        }
    }, [activeUser, activePartner?.id, currentPerson?.id])

    // 3. Set up Realtime Subscription for incoming pings
    useEffect(() => {
        if (!currentPerson?.id || !activePartner?.id) return

        const channel = supabase
            .channel(`ping-chat-${currentPerson.id}-${activePartner.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'bc_pings',
                    filter: `recipient_person_id=eq.${currentPerson.id}`,
                },
                (payload) => {
                    const line = payload.new
                    // Check if the new message belongs to this conversation
                    const isFromPartner = line.sender_person_id === activePartner.id && line.recipient_person_id === currentPerson.id
                    const isFromMe = line.sender_person_id === currentPerson.id && line.recipient_person_id === activePartner.id

                    if (isFromPartner || isFromMe) {
                        setMessages((prev) => {
                            if (prev.some((m) => m.id === line.id)) return prev
                            return [...prev, line]
                        })
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [currentPerson?.id, activePartner?.id])

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Send Ping
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!inputText.trim() || !currentPerson || !activePartner || sending) return

        const messageText = inputText.trim()
        setInputText('')
        setSending(true)

        try {
            const tempBcId = Math.floor(Date.now() / 1000)
            const { error } = await supabase
                .from('bc_pings')
                .insert({
                    bc_id: tempBcId,
                    sender_person_id: currentPerson.id,
                    recipient_person_id: activePartner.id,
                    content: messageText
                })

            if (error) throw error
        } catch (err: any) {
            console.error('❌ [PingsDrawer Send] Error sending ping:', err.message)
            setInputText(messageText)
        } finally {
            setSending(false)
        }
    }

    // Filter chat partners list (exclude current user)
    const chatPartners = collaborators.filter(c => c.id !== currentPerson?.id)

    return (
        <div className="flex-1 flex flex-col md:flex-row min-h-[60vh] gap-6 text-left">
            {/* Barra lateral de Chats Activos */}
            <div className={`w-full md:w-[280px] flex flex-col border-r border-slate-100 dark:border-slate-800/80 pr-0 md:pr-6 ${activePartner ? 'hidden md:flex' : 'flex'}`}>
                <h2 className="text-sm font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">
                    {t('basecamp.pings')}
                </h2>

                <div className="space-y-1 overflow-y-auto no-scrollbar flex-1">
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : chatPartners.map((partner) => {
                        const isSelected = activePartner?.id === partner.id
                        return (
                            <button
                                key={partner.id}
                                onClick={() => navigateTo({ section: 'pings', ping: partner.name })}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 border transition-all text-left ${
                                    isSelected
                                        ? 'bg-blue-50/75 border-blue-200 dark:bg-slate-800 dark:border-slate-700'
                                        : 'border-transparent hover:border-slate-100 dark:hover:border-slate-800'
                                }`}
                            >
                                <div className="w-9 h-9 rounded-full bg-blue-500/10 border border-blue-200 text-blue-600 font-extrabold flex items-center justify-center text-xs shadow-inner uppercase">
                                    {partner.name[0]}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-extrabold text-slate-750 dark:text-slate-200 truncate">{partner.name}</p>
                                    <p className="text-[10px] text-slate-440 dark:text-slate-550 truncate">{partner.title || partner.role || t('basecamp.staff_role')}</p>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Ventana de Chat */}
            <div className={`flex-1 flex flex-col bg-[#fffdfb] dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-2xl ${activePartner ? 'flex' : 'hidden md:flex items-center justify-center p-8'}`}>
                {activePartner ? (
                    <>
                        {/* Cabecera del chat */}
                        <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900 rounded-t-2xl">
                            <button
                                onClick={() => navigateTo({ section: 'pings' })}
                                className="md:hidden p-1.5 rounded-lg text-slate-450 hover:text-slate-600 hover:bg-slate-100"
                            >
                                <ArrowLeft size={16} />
                            </button>
                            <div className="w-9 h-9 rounded-full bg-blue-500/10 border border-blue-200 text-blue-600 font-extrabold flex items-center justify-center text-sm shadow-sm uppercase">
                                {activePartner.name[0]}
                            </div>
                            <div>
                                <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                                    {t('basecamp.ping_with').replace('{name}', activePartner.name)}
                                </h3>
                                <p className="text-[10px] text-slate-450 dark:text-slate-400 uppercase tracking-wider">{activePartner.title || activePartner.role || t('basecamp.staff_role')}</p>
                            </div>
                        </div>

                        {/* Contenedor de mensajes */}
                        <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[450px] min-h-[300px] no-scrollbar">
                            {chatLoading && messages.length === 0 ? (
                                <div className="flex justify-center items-center h-full">
                                    <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                </div>
                            ) : messages.length > 0 ? (
                                messages.map((m) => {
                                    const isMe = m.sender_person_id === currentPerson?.id
                                    return (
                                        <div
                                            key={m.id}
                                            className={`flex flex-col max-w-[75%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                                        >
                                            <div
                                                className={`p-3 rounded-2xl shadow-sm text-xs ${
                                                    isMe
                                                        ? 'bg-[#1D7DB5] text-white rounded-br-none border border-blue-600'
                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200/40 dark:border-slate-700/50'
                                                }`}
                                            >
                                                <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>
                                            </div>
                                            <span className="text-[8px] text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-widest">
                                                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    )
                                })
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400 dark:text-slate-500">
                                    <MessageSquare className="w-8 h-8 mb-2 opacity-50" />
                                    <p className="text-xs italic">{t('basecamp.ping_welcome_chat')}</p>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input de envío */}
                        <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-100 dark:border-slate-850 bg-white dark:bg-slate-900 rounded-b-2xl flex gap-2">
                            <input
                                type="text"
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                disabled={sending}
                                placeholder={t('basecamp.type_ping_placeholder')}
                                className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-955 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={sending || !inputText.trim()}
                                className="p-2.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white shadow-md transition-all flex items-center justify-center shrink-0 w-10 h-10"
                            >
                                {sending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send size={15} />
                                )}
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="text-center max-w-sm flex flex-col items-center mx-auto my-auto py-12">
                        <MessageSquare size={48} className="text-slate-300 dark:text-slate-700 mb-3" />
                        <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                            {t('basecamp.no_ping_selected_title')}
                        </h3>
                        <p className="text-xs text-slate-405 dark:text-slate-500">
                            {t('basecamp.no_ping_selected_desc')}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
