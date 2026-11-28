/**
 * @module PingsDrawer
 * @description Módulo de mensajería privada (Pings) entre integrantes de Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas `bc_people` y `bc_pings`)
 *              y proporciona chat 1 a 1 en tiempo real mediante Supabase Realtime.
 * @businessRules
 *   - Chat privado 1-a-1 guardado en la tabla `bc_pings`.
 *   - Carga el listado de personas activas desde la tabla `bc_people` y resuelve/crea el perfil
 *     del usuario actual mediante `resolveOrCreateTegPerson` para evitar errores 406.
 *   - No utiliza respuestas simuladas automáticas.
 * @dataFlow
 *   - Entrada: Props `activeUser` (nombre o email del contacto), `navigateTo` y `currentUserName`.
 *   - Fetch: Resuelve el remitente y el destinatario en `bc_people`, y carga el historial de mensajes de `bc_pings`.
 *   - Realtime: Escucha eventos `INSERT` en `bc_pings` deduplicando contra mensajes optimistas.
 *   - Escritura: Inserta directamente en `bc_pings` con `bc_id` único de microsegundos.
 * @notes
 *   - Soporte multilingüe (ES/EN) con `useLanguage()` y zona horaria `America/Los_Angeles`.
 *   - Corrige colisión de `bc_id` al enviar mensajes rápidos y duplicación visual con Realtime.
 *   - Rediseño Móvil + Web (2026-11-28): panel dividido responsivo (`min-w-0`), burbujas adaptables y soporte de HTML enriquecido de Basecamp con `BASECAMP_RICH_CONTENT_CSS` + `formatBasecampRichHtmlForDisplay`.
 */

'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Send, ArrowLeft, MessageSquare, Loader2, Search, AlertCircle } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import {
    resolveOrCreateTegPerson,
    canonicalizeBasecampEmail,
    canonicalizeBasecampDisplayName,
    findPersonInListByFuzzyName,
    isBasecampOAuthOwner,
    normalizePersonName,
    isMaskedOrEmptyEmail,
    stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import {
    BASECAMP_RICH_CONTENT_CSS,
    BASECAMP_IMAGE_HOVER_CSS,
    formatBasecampRichHtmlForDisplay,
    rewriteBasecampHtmlUrls,
    transformBasecampMentionsToPills,
    sanitizeBasecampHtml,
} from '@/lib/basecamp-html'

const PING_HTML_TAG_RE = /<(?:div|p|br|ul|ol|li|strong|em|b|i|a|img|video|figure|bc-attachment|span|blockquote|code|pre)\b/i

const AVATAR_COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0D9488', '#DB2777', '#0284C7']
const getAvatarColor = (name: string): string => {
    const clean = (name || '?').trim() || '?'
    let hash = 0
    for (let i = 0; i < clean.length; i++) hash = clean.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
const getInitials = (name: string): string => {
    const clean = (name || '').trim()
    if (!clean) return '?'
    const parts = clean.split(/\s+/).filter(Boolean)
    return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : clean.slice(0, 2).toUpperCase()
}

const renderSafePingRichHtml = (rawHtml: string): string => {
    const { cleanHtml } = stripTegAuthorBanner(rawHtml)
    return formatBasecampRichHtmlForDisplay(
        sanitizeBasecampHtml(transformBasecampMentionsToPills(rewriteBasecampHtmlUrls(cleanHtml)))
    )
}

interface PingsDrawerProps {
    activeUser: string | null
    navigateTo: (params: { project?: string; tool?: string; section?: string; ping?: string }) => void
    currentUserName: string
}

function getPacificDateKey(dateStr?: string | null): string {
    const d = dateStr ? new Date(dateStr) : new Date()
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d)
}

export default function PingsDrawer({ activeUser, navigateTo, currentUserName }: PingsDrawerProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'
    const { user: authUser, loading: authLoading } = useAuth()
    const [collaborators, setCollaborators] = useState<any[]>([])
    const [messages, setMessages] = useState<any[]>([])
    const [inputText, setInputText] = useState('')
    const [partnerFilter, setPartnerFilter] = useState('')
    const [loading, setLoading] = useState(true)
    const [chatLoading, setChatLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const [currentPerson, setCurrentPerson] = useState<any>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // 1. Fetch current logged-in person and all active collaborators
    useEffect(() => {
        if (authLoading) return
        if (!authUser) {
            setLoading(false)
            return
        }

        const loadInitialData = async () => {
            setLoading(true)
            try {
                const canonicalSelfEmail = canonicalizeBasecampEmail(authUser.email)
                const canonicalSelfName = canonicalizeBasecampDisplayName(
                    authUser.name || currentUserName,
                    authUser.email
                )

                const [resolvedSelf, peopleRes] = await Promise.all([
                    resolveOrCreateTegPerson(supabase, {
                        email: canonicalSelfEmail,
                        name: canonicalSelfName,
                        role: (authUser as any)?.role,
                    }),
                    supabase
                        .from('bc_people')
                        .select('*')
                        .eq('is_active', true)
                        .order('name', { ascending: true })
                        .limit(5000),
                ])

                if (peopleRes.error) throw peopleRes.error
                const peopleList = peopleRes.data || []

                if (resolvedSelf) {
                    setCurrentPerson(resolvedSelf)
                } else {
                    const fallbackSelf = findPersonInListByFuzzyName(
                        peopleList,
                        canonicalSelfName,
                        canonicalSelfEmail
                    )
                    setCurrentPerson(fallbackSelf)
                }

                setCollaborators(peopleList)
            } catch (err: any) {
                console.error('❌ [PingsDrawer Init] Error:', err.message)
            } finally {
                setLoading(false)
            }
        }
        loadInitialData()
    }, [authUser, authLoading, currentUserName, supabase])

    // Resolve the selected contact details resiliently (exact name/email/id, then case-insensitive / normalized / Pass 3 fuzzy)
    const activePartner = useMemo(() => {
        if (!activeUser) return undefined
        const rawTarget = activeUser.trim()
        if (!rawTarget) return undefined
        const directMatch = collaborators.find((c) => c.id === rawTarget || c.name === rawTarget)
        if (directMatch) return directMatch
        const targetEmail = rawTarget.includes('@') ? canonicalizeBasecampEmail(rawTarget) : undefined
        return findPersonInListByFuzzyName(collaborators, rawTarget, targetEmail) || undefined
    }, [collaborators, activeUser])

    // 2. Fetch conversation history when partner changes
    const fetchChatHistory = useCallback(async () => {
        if (!currentPerson?.id || !activePartner?.id) return
        setChatLoading(true)
        setSendError(null)
        try {
            const { data: chatLines, error } = await supabase
                .from('bc_pings')
                .select('*')
                .or(
                    `and(sender_person_id.eq.${currentPerson.id},recipient_person_id.eq.${activePartner.id}),and(sender_person_id.eq.${activePartner.id},recipient_person_id.eq.${currentPerson.id})`
                )
                .order('created_at', { ascending: true })
                .limit(500)

            if (error) throw error
            setMessages(chatLines || [])
        } catch (err: any) {
            console.error('❌ [PingsDrawer FetchChat] Error:', err.message)
        } finally {
            setChatLoading(false)
        }
    }, [currentPerson?.id, activePartner?.id, supabase])

    useEffect(() => {
        if (currentPerson?.id && activePartner?.id) {
            fetchChatHistory()
        } else {
            setMessages([])
            setSendError(null)
        }
    }, [activeUser, activePartner?.id, currentPerson?.id, fetchChatHistory])

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
                },
                (payload) => {
                    const line = payload.new as any
                    const isFromPartner =
                        line.sender_person_id === activePartner.id &&
                        line.recipient_person_id === currentPerson.id
                    const isFromMe =
                        line.sender_person_id === currentPerson.id &&
                        line.recipient_person_id === activePartner.id

                    if (isFromPartner || isFromMe) {
                        setMessages((prev) => {
                            if (prev.some((m) => m.id === line.id)) return prev
                            // Replace matching optimistic message if Realtime arrives before insert resolves
                            const tempIdx = prev.findIndex(
                                (m) =>
                                    String(m.id).startsWith('temp-') &&
                                    m.sender_person_id === line.sender_person_id &&
                                    m.recipient_person_id === line.recipient_person_id &&
                                    m.content === line.content
                            )
                            if (tempIdx !== -1) {
                                const next = [...prev]
                                next[tempIdx] = line
                                return next
                            }
                            return [...prev, line]
                        })
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [currentPerson?.id, activePartner?.id, supabase])

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Send Ping
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!inputText.trim() || !currentPerson?.id || !activePartner?.id || sending) return

        const messageText = inputText.trim()
        const tempId = `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`

        const optimisticMsg = {
            id: tempId,
            bc_id: null,
            sender_person_id: currentPerson.id,
            recipient_person_id: activePartner.id,
            content: messageText,
            created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, optimisticMsg])
        setInputText('')
        setSendError(null)
        setSending(true)

        try {
            const { data: inserted, error } = await supabase
                .from('bc_pings')
                .insert({
                    bc_id: null,
                    sender_person_id: currentPerson.id,
                    recipient_person_id: activePartner.id,
                    content: messageText,
                })
                .select('*')
                .single()

            if (error) throw error

            if (inserted) {
                setMessages((prev) => {
                    const alreadyHasReal = prev.some((m) => m.id === inserted.id)
                    if (alreadyHasReal) {
                        return prev.filter((m) => m.id !== tempId)
                    }
                    return prev.map((m) => (m.id === tempId ? inserted : m))
                })
            }
        } catch (err: any) {
            console.error('❌ [PingsDrawer Send] Error sending ping:', err.message)
            setMessages((prev) => prev.filter((m) => m.id !== tempId))
            setInputText(messageText)
            setSendError(t('basecamp.ping_send_error'))
        } finally {
            setSending(false)
        }
    }

    // Filter chat partners list (exclude current user + accent-insensitive search)
    const chatPartners = useMemo(() => {
        const selfEmail = canonicalizeBasecampEmail(currentPerson?.email || authUser?.email)
        const selfNorm = normalizePersonName(
            canonicalizeBasecampDisplayName(
                currentPerson?.name || authUser?.name || currentUserName,
                currentPerson?.email || authUser?.email
            )
        )
        const selfIsOwner = isBasecampOAuthOwner(
            currentPerson?.email || authUser?.email,
            currentPerson?.name || authUser?.name || currentUserName
        )
        const qNorm = partnerFilter
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
        const qPersonNorm = normalizePersonName(partnerFilter)

        return collaborators.filter((c) => {
            if (currentPerson?.id && c.id === currentPerson.id) return false
            if (selfEmail && !isMaskedOrEmptyEmail(c.email) && canonicalizeBasecampEmail(c.email) === selfEmail) {
                return false
            }
            if (selfIsOwner && isBasecampOAuthOwner(c.email, c.name)) return false
            if (selfNorm && normalizePersonName(c.name) === selfNorm) return false
            if (!qNorm) return true
            const cNorm = String(c.name || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
            const cRoleNorm = String(c.title || c.role || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
            return (
                cNorm.includes(qNorm) ||
                cRoleNorm.includes(qNorm) ||
                (qPersonNorm.length > 0 && normalizePersonName(c.name).includes(qPersonNorm))
            )
        })
    }, [collaborators, currentPerson, authUser?.name, currentUserName, partnerFilter])

    const formatPingTimestamp = (dateStr?: string | null) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (Number.isNaN(d.getTime())) return ''
        const todayLA = getPacificDateKey()
        const msgLA = getPacificDateKey(dateStr)
        const timePart = d.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles',
        })
        if (msgLA && todayLA && msgLA !== todayLA) {
            const datePart = d.toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric',
                timeZone: 'America/Los_Angeles',
            })
            return `${datePart} · ${timePart}`
        }
        return timePart
    }

    return (
        <div className="flex-1 flex flex-col md:flex-row min-h-[62vh] gap-4 sm:gap-5 min-w-0 text-left">
            <style dangerouslySetInnerHTML={{ __html: `${BASECAMP_RICH_CONTENT_CSS}\n${BASECAMP_IMAGE_HOVER_CSS}` }} />
            {/* Barra lateral de Chats Activos */}
            <div className={`w-full md:w-[280px] lg:w-[300px] shrink-0 min-w-0 flex flex-col md:border-r border-slate-200/80 dark:border-slate-800 pr-0 md:pr-4 ${activePartner ? 'hidden md:flex' : 'flex'}`}>
                <h2 className="text-xs font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                    {t('basecamp.pings')}
                </h2>

                <div className="relative mb-3">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                        type="text"
                        value={partnerFilter}
                        onChange={(e) => setPartnerFilter(e.target.value)}
                        placeholder={t('basecamp.filter_people_placeholder')}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-[#1D7DB5]"
                    />
                </div>

                <div className="space-y-1 overflow-y-auto no-scrollbar flex-1 max-h-[64dvh] md:max-h-[520px] min-w-0">
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : chatPartners.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500 italic text-center py-6">
                            {t('basecamp.no_collaborators')}
                        </p>
                    ) : (
                        chatPartners.map((partner) => {
                            const isSelected = activePartner?.id === partner.id
                            const initials = getInitials(partner.name || '?')
                            return (
                                <button
                                    key={partner.id}
                                    type="button"
                                    onClick={() => navigateTo({ section: 'pings', ping: partner.name })}
                                    className={`w-full flex items-center gap-3 p-2.5 sm:p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 border transition-all text-left cursor-pointer min-w-0 ${
                                        isSelected
                                            ? 'bg-blue-50/75 border-blue-200 dark:bg-slate-800 dark:border-slate-700'
                                            : 'border-transparent hover:border-slate-100 dark:hover:border-slate-800'
                                    }`}
                                >
                                    <div
                                        className="w-9 h-9 rounded-full text-white font-bold flex items-center justify-center text-[11px] shadow-2xs uppercase shrink-0"
                                        style={{ backgroundColor: getAvatarColor(partner.name || '?') }}
                                    >
                                        {initials}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-extrabold text-slate-800 dark:text-slate-200 truncate">{partner.name}</p>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{partner.title || partner.role || t('basecamp.staff_role')}</p>
                                    </div>
                                </button>
                            )
                        })
                    )}
                </div>
            </div>

            {/* Ventana de Chat */}
            <div className={`flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden ${activePartner ? 'flex' : 'hidden md:flex items-center justify-center p-8'}`}>
                {activePartner ? (
                    <>
                        {/* Cabecera del chat */}
                        <div className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 min-w-0">
                            <button
                                type="button"
                                onClick={() => navigateTo({ section: 'pings' })}
                                className="md:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                            >
                                <ArrowLeft size={16} />
                            </button>
                            <div
                                className="w-9 h-9 rounded-full text-white font-bold flex items-center justify-center text-xs shadow-2xs uppercase shrink-0"
                                style={{ backgroundColor: getAvatarColor(activePartner.name || '?') }}
                            >
                                {getInitials(activePartner.name || '?')}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 truncate">
                                    {t('basecamp.ping_with').replace('{name}', activePartner.name)}
                                </h3>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                                    {activePartner.title || activePartner.role || t('basecamp.staff_role')}
                                </p>
                            </div>
                        </div>

                        {sendError && (
                            <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
                                <AlertCircle size={14} className="shrink-0" />
                                <span>{sendError}</span>
                            </div>
                        )}

                        {/* Contenedor de mensajes */}
                        <div className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3.5 max-h-[54dvh] md:max-h-[460px] min-h-[260px] no-scrollbar min-w-0">
                            {chatLoading && messages.length === 0 ? (
                                <div className="flex justify-center items-center h-full">
                                    <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                </div>
                            ) : messages.length > 0 ? (
                                messages.map((m) => {
                                    const isMe = m.sender_person_id === currentPerson?.id
                                    const rawText = String(m.content || '')
                                    const isRichHtml = PING_HTML_TAG_RE.test(rawText)
                                    return (
                                        <div
                                            key={m.id}
                                            className={`flex flex-col max-w-[86%] sm:max-w-[75%] min-w-0 ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                                        >
                                            <div
                                                className={`px-3.5 py-2.5 rounded-2xl shadow-2xs text-xs min-w-0 max-w-full ${
                                                    isMe
                                                        ? 'bg-[#1D7DB5] text-white rounded-br-sm border border-blue-600 [&_a]:text-white! [&_a]:underline! [&_.bc-mention-pill]:bg-white/20! [&_.bc-mention-pill]:text-white! [&_.bc-mention-pill]:border-white/30!'
                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-sm border border-slate-200/60 dark:border-slate-700/60'
                                                }`}
                                            >
                                                {isRichHtml ? (
                                                    <div
                                                        className="bc-rich-text text-xs! leading-relaxed!"
                                                        dangerouslySetInnerHTML={{
                                                            __html: renderSafePingRichHtml(rawText),
                                                        }}
                                                    />
                                                ) : (
                                                    <p className="leading-relaxed whitespace-pre-wrap break-words">{rawText}</p>
                                                )}
                                            </div>
                                            <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-wider">
                                                {formatPingTimestamp(m.created_at)}
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
                        <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-2xl flex gap-2 min-w-0">
                            <input
                                type="text"
                                value={inputText}
                                onChange={(e) => {
                                    setInputText(e.target.value)
                                    if (sendError) setSendError(null)
                                }}
                                disabled={sending || !currentPerson?.id}
                                placeholder={t('basecamp.type_ping_placeholder')}
                                className="flex-1 min-w-0 px-3.5 sm:px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={sending || !inputText.trim() || !currentPerson?.id}
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
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                            {t('basecamp.no_ping_selected_desc')}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
