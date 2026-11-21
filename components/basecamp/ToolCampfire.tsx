/**
 * @module ToolCampfire
 * @description Módulo de Chat Campfire de Basecamp para coordinación rápida de proyectos de Tacos Gavilan.
 *              Carga las últimas 80 líneas del proyecto desde Supabase (`bc_campfire_lines` por `project_id`),
 *              renderiza HTML de Basecamp Trix de forma segura, reconcilia mensajes optimistas al instante
 *              y escucha cambios en tiempo real (`INSERT`, `UPDATE`, `DELETE`) vía Supabase Realtime.
 * @businessRules
 *   - Chat grupal compartido en tiempo real por proyecto (`project_id`).
 *   - Proyectos como "All Locations" pueden tener más de un contenedor en `bc_campfires`; la lectura siempre
 *     filtra por `project_id` (últimos 80 mensajes ordenados cronológicamente) y la escritura elige el
 *     contenedor activo/poblado.
 *   - Identificación de mensajes propios (`isMe`) resiliente a tildes y variantes ortográficas (`normalizePersonName`).
 *   - Fechas y horas formateadas siempre en zona horaria `America/Los_Angeles`.
 * @dataFlow
 *   - Entrada: Props `project` (contiene `id` = bc_id y `db_id` = UUID) y `currentUserName`.
 *   - Fetch: `bc_campfires` + `bc_campfire_lines` (`.eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(80)` + `.reverse()`).
 *   - Realtime: Canal `postgres_changes` (`event: '*'`) filtrado por `project_id=eq.${project.db_id}`.
 *   - Escritura: `POST /api/basecamp/action` (`action: 'create_campfire_line'`), reconciliando `{ id }` de inmediato.
 * @notes
 *   - Corrige bug donde `.eq('campfire_id', dbCampfire.id)` ocultaba mensajes reales cuando existían múltiples `bc_campfires`.
 *   - Renderiza HTML Trix limpio sin exponer etiquetas `<div>`/`<br>` crudas ni banners `<p data-teg-author=...>`.
 */

'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Send, MessageSquare, Loader2, Paperclip, AlertCircle, X } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { normalizePersonName, stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'
import {
    rewriteBasecampHtmlUrls,
    proxyBasecampUrl,
    safeDecodeFilename,
    injectImageDownloadOverlays,
    triggerBasecampDownload,
    buildBasecampDirectDownloadHref,
    BASECAMP_IMAGE_HOVER_CSS,
} from '@/lib/basecamp-html'

interface ToolCampfireProps {
    project: any
    currentUserName: string
}

function extractAuthorObj(rel: any): { name?: string; email?: string; avatar_url?: string } | null {
    if (!rel) return null
    return Array.isArray(rel) ? rel[0] || null : rel
}

function isSameTegPerson(authorName?: string | null, currentUserName?: string | null): boolean {
    const normA = normalizePersonName(authorName)
    const normB = normalizePersonName(currentUserName)
    if (!normA || !normB) return false
    if (normA === normB) return true

    const tokensA = normA.split(' ').filter(Boolean)
    const tokensB = normB.split(' ').filter(Boolean)
    if (tokensA.length === 0 || tokensB.length === 0) return false
    if (tokensA[0] !== tokensB[0]) return false

    // Handle Basecamp initialed profiles like "Victor M" <-> "Victor Muñoz" without colliding distinct last names
    if (tokensA.length >= 2 && tokensB.length >= 2) {
        const lastA = tokensA[tokensA.length - 1]
        const lastB = tokensB[tokensB.length - 1]
        if (lastA.length === 1 && lastB.startsWith(lastA)) return true
        if (lastB.length === 1 && lastA.startsWith(lastB)) return true
    }

    return false
}

function renderCampfireLineHtml(raw?: string | null): {
    html: string
    fileAttachments: { filename: string; url: string }[]
    hasVisibleContent: boolean
    plainText: string
} {
    if (!raw) {
        return { html: '', fileAttachments: [], hasVisibleContent: false, plainText: '' }
    }
    const { cleanHtml } = stripTegAuthorBanner(raw)
    if (!cleanHtml) {
        return { html: '', fileAttachments: [], hasVisibleContent: false, plainText: '' }
    }

    const fileAttachments: { filename: string; url: string }[] = []
    const attachRegex = /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi
    let match: RegExpExecArray | null
    while ((match = attachRegex.exec(cleanHtml)) !== null) {
        const attrs = match[1] || ''
        const getAttr = (attr: string) => {
            const r = attrs.match(new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(["'])([^"']+)\\1`, 'i'))
            return r ? r[2] : ''
        }
        const ct = getAttr('content-type').toLowerCase()
        const rawHref = getAttr('href') || getAttr('url')
        if (rawHref && !ct.startsWith('image/')) {
            fileAttachments.push({
                filename: safeDecodeFilename(getAttr('filename'), 'attachment'),
                url: proxyBasecampUrl(rawHref),
            })
        }
    }

    const hasHtmlTags = /<\s*(?:div|p|br|ul|ol|li|h[1-6]|blockquote|pre|table|figure|bc-attachment|img|a|strong|b|em|i|span|del|u)\b/i.test(
        cleanHtml
    )
    let safeHtml: string
    if (hasHtmlTags) {
        safeHtml = rewriteBasecampHtmlUrls(cleanHtml).replace(
            /<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi,
            '$1'
        )
    } else {
        safeHtml = cleanHtml
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\r?\n/g, '<br />')
    }

    const plainText = safeHtml
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim()

    const hasImages = /<img\b/i.test(safeHtml)

    return {
        html: safeHtml,
        fileAttachments,
        hasVisibleContent: plainText.length > 0 || hasImages || fileAttachments.length > 0,
        plainText,
    }
}

function formatCampfireTimestamp(isoStr: string | undefined | null, locale: string): string {
    if (!isoStr) return ''
    const date = new Date(isoStr)
    if (Number.isNaN(date.getTime())) return ''
    try {
        const nowYear = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
        }).format(new Date())
        const msgYear = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
        }).format(date)

        const datePart = new Intl.DateTimeFormat(locale, {
            timeZone: 'America/Los_Angeles',
            month: 'short',
            day: 'numeric',
            ...(msgYear !== nowYear ? { year: 'numeric' } : {}),
        }).format(date)

        const timePart = new Intl.DateTimeFormat(locale, {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric',
            minute: '2-digit',
        }).format(date)

        return `${datePart} • ${timePart}`
    } catch {
        return date.toLocaleString(locale)
    }
}

async function parseActionError(res: Response, fallback: string): Promise<string> {
    try {
        const text = await res.text()
        if (!text) return fallback
        const parsed = JSON.parse(text)
        return parsed?.error || text
    } catch {
        return fallback
    }
}

export default function ToolCampfire({ project, currentUserName }: ToolCampfireProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'

    const [campfire, setCampfire] = useState<{ id: string; bc_id: number } | null>(null)
    const [messages, setMessages] = useState<any[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)
    const [errorBanner, setErrorBanner] = useState<string | null>(null)
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

    const handleCampfireHtmlClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const creatingCampfireRef = useRef<Record<string, boolean>>({})
    const activeProjectDbIdRef = useRef<string | null>(project?.db_id || null)

    const fetchCampfireAndLines = useCallback(async (projectDbId: string) => {
        if (!projectDbId) return
        try {
            // 1. Fetch all campfires for this project ordered oldest-first
            const { data: existingCampfires, error: cfQueryErr } = await supabase
                .from('bc_campfires')
                .select('id, bc_id, created_at')
                .eq('project_id', projectDbId)
                .order('created_at', { ascending: true })

            if (cfQueryErr) throw cfQueryErr

            let campfiresList = existingCampfires || []

            // Auto-create container safely with in-flight guard if none exists
            if (campfiresList.length === 0 && !creatingCampfireRef.current[projectDbId]) {
                creatingCampfireRef.current[projectDbId] = true
                try {
                    const { data: recheck } = await supabase
                        .from('bc_campfires')
                        .select('id, bc_id, created_at')
                        .eq('project_id', projectDbId)
                        .order('created_at', { ascending: true })
                        .limit(1)
                        .maybeSingle()

                    if (recheck) {
                        campfiresList = [recheck]
                    } else {
                        const uniqueBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
                        const { data: createdCf, error: insertErr } = await supabase
                            .from('bc_campfires')
                            .insert({
                                project_id: projectDbId,
                                bc_id: uniqueBcId,
                            })
                            .select('id, bc_id, created_at')
                            .maybeSingle()
                        if (insertErr) throw insertErr
                        if (createdCf) campfiresList = [createdCf]
                    }
                } finally {
                    creatingCampfireRef.current[projectDbId] = false
                }
            }

            // 2. Fetch latest 80 campfire lines across the entire project (fixes multi-campfire projects like All Locations)
            const { data: dbLines, error: linesErr } = await supabase
                .from('bc_campfire_lines')
                .select(`
                    id,
                    bc_id,
                    campfire_id,
                    content,
                    created_at,
                    author:bc_people!bc_campfire_lines_author_person_id_fkey(name, email, avatar_url)
                `)
                .eq('project_id', projectDbId)
                .order('created_at', { ascending: false })
                .limit(80)

            if (linesErr) throw linesErr
            if (activeProjectDbIdRef.current !== projectDbId) return

            const latestLinesDesc = dbLines || []
            const chronologicalLines = [...latestLinesDesc].reverse()

            // Pick the active/populated campfire container for sending new messages
            let chosenCampfire = campfiresList[0] || null
            if (campfiresList.length > 1) {
                const populatedId = latestLinesDesc.find((l: any) =>
                    campfiresList.some((c: any) => c.id === l.campfire_id)
                )?.campfire_id
                if (populatedId) {
                    chosenCampfire = campfiresList.find((c: any) => c.id === populatedId) || chosenCampfire
                } else {
                    const realBcCampfire = campfiresList.find(
                        (c: any) => Number(c.bc_id) > 0 && Number(c.bc_id) < 100_000_000_000
                    )
                    if (realBcCampfire) chosenCampfire = realBcCampfire
                }
            }

            if (chosenCampfire) {
                setCampfire({ id: chosenCampfire.id, bc_id: Number(chosenCampfire.bc_id) })
            }
            setMessages(chronologicalLines)
        } catch (err: any) {
            console.error('❌ [ToolCampfire Fetch] Error:', err.message)
            if (activeProjectDbIdRef.current === projectDbId) {
                setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
            }
        } finally {
            if (activeProjectDbIdRef.current === projectDbId) {
                setLoading(false)
            }
        }
    }, [supabase, t])

    // Reset state cleanly when project changes
    useEffect(() => {
        const projectDbId = project?.db_id || null
        activeProjectDbIdRef.current = projectDbId
        setCampfire(null)
        setMessages([])
        setInputText('')
        setErrorBanner(null)
        setLoading(true)

        if (projectDbId) {
            fetchCampfireAndLines(projectDbId)
        } else {
            setLoading(false)
        }
    }, [project?.id, project?.db_id, fetchCampfireAndLines])

    // Subscribe to Supabase Realtime (`event: '*'`) scoped to `project_id`
    useEffect(() => {
        const projectDbId = project?.db_id
        if (!projectDbId) return

        const hydrateLine = async (lineId: string) => {
            const { data, error } = await supabase
                .from('bc_campfire_lines')
                .select(`
                    id,
                    bc_id,
                    campfire_id,
                    content,
                    created_at,
                    author:bc_people!bc_campfire_lines_author_person_id_fkey(name, email, avatar_url)
                `)
                .eq('id', lineId)
                .maybeSingle()
            if (error || !data) return null
            return data
        }

        const channel = supabase
            .channel(`campfire-lines-project-${projectDbId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_campfire_lines',
                    filter: `project_id=eq.${projectDbId}`,
                },
                async (payload) => {
                    if (activeProjectDbIdRef.current !== projectDbId) return

                    if (payload.eventType === 'DELETE') {
                        const deletedId = (payload.old as any)?.id
                        if (deletedId) {
                            setMessages((prev) => prev.filter((m) => m.id !== deletedId))
                        }
                        return
                    }

                    const targetId = (payload.new as any)?.id
                    if (!targetId) return

                    const hydrated = await hydrateLine(targetId)
                    if (!hydrated || activeProjectDbIdRef.current !== projectDbId) return

                    setMessages((prev) => {
                        // Already present (e.g. reconciled from POST or UPDATE event): update in place
                        if (prev.some((m) => m.id === hydrated.id)) {
                            return prev.map((m) => (m.id === hydrated.id ? hydrated : m))
                        }

                        // Check if this matches a single pending optimistic temp-* message
                        const incomingPlain = renderCampfireLineHtml(hydrated.content).plainText
                        const tempIdx = prev.findIndex(
                            (m) =>
                                typeof m.id === 'string' &&
                                m.id.startsWith('temp-') &&
                                renderCampfireLineHtml(m.content).plainText === incomingPlain
                        )

                        if (tempIdx !== -1) {
                            const copy = [...prev]
                            copy[tempIdx] = hydrated
                            return copy
                        }

                        const merged = [...prev, hydrated]
                        merged.sort(
                            (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
                        )
                        return merged
                    })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project?.db_id, supabase])

    // Auto-scroll when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!inputText.trim() || !campfire || sending) return

        const textToSend = inputText.trim()
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        setErrorBanner(null)

        const optimisticLine = {
            id: tempId,
            content: textToSend,
            created_at: new Date().toISOString(),
            author: { name: currentUserName },
        }
        setMessages((prev) => [...prev, optimisticLine])
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
                    content: textToSend,
                }),
            })

            if (!res.ok) {
                const msg = await parseActionError(res, t('basecamp.action_error'))
                throw new Error(msg)
            }

            const result = await res.json()
            const createdId: string | undefined = result?.id

            if (createdId) {
                const { data: hydrated } = await supabase
                    .from('bc_campfire_lines')
                    .select(`
                        id,
                        bc_id,
                        campfire_id,
                        content,
                        created_at,
                        author:bc_people!bc_campfire_lines_author_person_id_fkey(name, email, avatar_url)
                    `)
                    .eq('id', createdId)
                    .maybeSingle()

                setMessages((prev) => {
                    const finalRow = hydrated || { ...optimisticLine, id: createdId }
                    if (prev.some((m) => m.id === createdId)) {
                        return prev
                            .filter((m) => m.id !== tempId)
                            .map((m) => (m.id === createdId ? finalRow : m))
                    }
                    return prev.map((m) => (m.id === tempId ? finalRow : m))
                })
            }
        } catch (err: any) {
            console.error('❌ [ToolCampfire Send] Error sending message:', err.message)
            setMessages((prev) => prev.filter((m) => m.id !== tempId))
            setInputText(textToSend)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col bg-[#fffdfb] dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-2xl shadow-sm">
            <style dangerouslySetInnerHTML={{ __html: BASECAMP_IMAGE_HOVER_CSS }} />
            {/* Header del Campfire */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900 rounded-t-2xl">
                <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center border border-orange-200/30">
                    <MessageSquare size={20} />
                </div>
                <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                        {t('basecamp.campfire')}
                    </h3>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {t('basecamp.campfire_sub')}
                    </p>
                </div>
            </div>

            {/* Banner de error visible */}
            {errorBanner && (
                <div className="mx-4 mt-3 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <AlertCircle size={14} className="shrink-0" />
                        <span className="truncate">{errorBanner}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorBanner(null)}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50 shrink-0"
                    >
                        <X size={13} />
                    </button>
                </div>
            )}

            {/* Panel de mensajes */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[480px] min-h-[350px] no-scrollbar">
                {loading ? (
                    <div className="flex justify-center items-center h-full py-12">
                        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                    </div>
                ) : messages.length > 0 ? (
                    messages.map((m) => {
                        const authorObj = extractAuthorObj(m.author)
                        const authorName =
                            (authorObj?.name && String(authorObj.name).trim()) ||
                            t('basecamp.anonymous_user')
                        const isMe = isSameTegPerson(authorName, currentUserName)
                        const rendered = renderCampfireLineHtml(m.content)

                        return (
                            <div
                                key={m.id}
                                className={`flex gap-3 items-start ${isMe ? 'flex-row-reverse' : ''}`}
                            >
                                {/* Avatar */}
                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold flex items-center justify-center text-xs shrink-0 uppercase border border-slate-300/30">
                                    {(authorName[0] || 'U').toUpperCase()}
                                </div>

                                {/* Detalle */}
                                <div
                                    className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${
                                        isMe ? 'items-end' : 'items-start'
                                    }`}
                                >
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-[10px] font-black text-slate-800 dark:text-slate-200">
                                            {authorName}
                                        </span>
                                        <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">
                                            {formatCampfireTimestamp(m.created_at, locale)}
                                        </span>
                                    </div>

                                    <div
                                        className={`p-2.5 sm:p-3 rounded-2xl text-xs mt-1 leading-relaxed border break-words ${
                                            isMe
                                                ? 'bg-orange-500 text-white border-orange-600 rounded-tr-none [&_a]:underline [&_a]:text-white'
                                                : 'bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border-slate-200/40 dark:border-slate-800 rounded-tl-none [&_a]:underline [&_a]:text-blue-600 dark:[&_a]:text-blue-400'
                                        }`}
                                    >
                                        {rendered.hasVisibleContent ? (
                                            <>
                                                {rendered.html && (
                                                    <div
                                                        onClick={handleCampfireHtmlClick}
                                                        className="[&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-1 [&_p]:my-0.5"
                                                        dangerouslySetInnerHTML={{ __html: injectImageDownloadOverlays(rendered.html, t('basecamp.download_btn')) }}
                                                    />
                                                )}
                                                {rendered.fileAttachments.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                        {rendered.fileAttachments.map((att, idx) => (
                                                            <a
                                                                key={idx}
                                                                href={buildBasecampDirectDownloadHref(att.url, att.filename)}
                                                                onClick={(ev) => {
                                                                    ev.preventDefault()
                                                                    triggerBasecampDownload(att.url, att.filename)
                                                                }}
                                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border ${
                                                                    isMe
                                                                        ? 'bg-orange-600/60 border-orange-400/50 text-white'
                                                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                                                                }`}
                                                            >
                                                                <Paperclip size={11} />
                                                                <span className="truncate max-w-[180px]">
                                                                    {att.filename}
                                                                </span>
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 italic opacity-85">
                                                <Paperclip size={12} />
                                                <span>{t('basecamp.attached_file_fallback')}</span>
                                            </span>
                                        )}
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
            <form
                onSubmit={handleSendMessage}
                className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-2xl flex gap-2"
            >
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

            {lightboxUrl && (
                <div
                    onClick={() => setLightboxUrl(null)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 100,
                        background: 'rgba(0,0,0,0.85)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out',
                    }}
                >
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(null) }}
                        style={{
                            position: 'absolute', top: 20, right: 20,
                            width: 40, height: 40, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                            color: '#fff', fontSize: 20, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                            objectFit: 'contain', borderRadius: 8,
                            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                            cursor: 'default',
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
                        }}
                    >
                        {t('basecamp.download_btn')}
                    </a>
                </div>
            )}
        </div>
    )
}
