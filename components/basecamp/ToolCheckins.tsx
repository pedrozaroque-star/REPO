/**
 * @module ToolCheckins
 * @description Módulo de Preguntas Recurrentes Automáticas (Check-ins) para registrar reportes operativos
 *              diarios de Tacos Gavilan. Conecta con Supabase (`bc_questionnaires`, `bc_questions`, `bc_answers`),
 *              renderiza HTML de Basecamp Trix de forma segura y sincroniza respuestas bidireccionalmente
 *              a través de `/api/basecamp/action` y Supabase Realtime.
 * @businessRules
 *   - Consulta preguntas por `project_id` para evitar perder preguntas si existen múltiples contenedores `bc_questionnaires`.
 *   - Distingue preguntas activas de pausadas (`is_paused === true`), mostrando el distintivo `t('basecamp.paused_badge')`
 *     y priorizando las activas al inicio de la lista.
 *   - Trata valores residuales como `"at"` o `"a las"` en `schedule_text` como vacíos, usando `t('basecamp.every_day')`.
 *   - Formatea fechas y horas de respuestas estrictamente en `America/Los_Angeles` según el idioma activo.
 * @dataFlow
 *   - Entrada: Props `project` (`id` = bc_id, `db_id` = UUID) y `currentUserName`.
 *   - Fetch: `bc_questionnaires`, `bc_questions` (por `project_id`) y `bc_answers` (por `question_id`).
 *   - Realtime: Canal `postgres_changes` (`event: '*'`) sobre `bc_answers` y `bc_questions`.
 *   - Escritura: `POST /api/basecamp/action` (`action: 'create_answer'`).
 * @notes
 *   - Soporte bilingüe completo (ES/EN) con `useLanguage`.
 *   - Renderiza HTML Trix en respuestas de forma segura con `rewriteBasecampHtmlUrls` y `stripTegAuthorBanner`.
 */

'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Send, Clock, Loader2, Paperclip, PauseCircle, AlertCircle, X } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'
import {
    rewriteBasecampHtmlUrls,
    proxyBasecampUrl,
    safeDecodeFilename,
} from '@/lib/basecamp-html'

interface ToolCheckinsProps {
    project: any
    currentUserName: string
}

function extractAuthorName(rel: any, fallback: string): string {
    const obj = Array.isArray(rel) ? rel[0] : rel
    return (obj?.name && String(obj.name).trim()) || fallback
}

function formatQuestionTitle(rawTitle: string | undefined | null, language: string): string {
    const parts = String(rawTitle || '').split(' / ')
    if (language === 'en' && parts[1]) {
        return parts[1].trim()
    }
    return (parts[0] || '').trim()
}

function formatQuestionSchedule(
    rawSchedule: string | undefined | null,
    language: string,
    everyDayFallback: string
): string {
    const cleaned = String(rawSchedule || '').trim()
    if (!cleaned || /^(?:at|a las)$/i.test(cleaned)) {
        return everyDayFallback
    }
    if (language === 'en') {
        return cleaned
            .replace(/Todos los días/gi, 'Every day')
            .replace(/\s+a las\s+/gi, ' at ')
    }
    return cleaned
        .replace(/Every day/gi, 'Todos los días')
        .replace(/\s+at\s+/gi, ' a las ')
}

function formatAnswerTimestamp(isoStr: string | undefined | null, locale: string): string {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (Number.isNaN(d.getTime())) return ''
    try {
        const nowYear = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
        }).format(new Date())
        const ansYear = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
        }).format(d)

        const dateStr = new Intl.DateTimeFormat(locale, {
            timeZone: 'America/Los_Angeles',
            month: 'short',
            day: 'numeric',
            ...(ansYear !== nowYear ? { year: 'numeric' } : {}),
        }).format(d)

        const timeStr = new Intl.DateTimeFormat(locale, {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric',
            minute: '2-digit',
        }).format(d)

        return `${dateStr} • ${timeStr}`
    } catch {
        return d.toLocaleString(locale)
    }
}

function renderAnswerContentHtml(raw?: string | null): {
    html: string
    fileAttachments: { filename: string; url: string }[]
} {
    if (!raw) return { html: '', fileAttachments: [] }
    const { cleanHtml } = stripTegAuthorBanner(raw)
    if (!cleanHtml) return { html: '', fileAttachments: [] }

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

    return { html: safeHtml, fileAttachments }
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

export default function ToolCheckins({ project }: ToolCheckinsProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'

    const [questions, setQuestions] = useState<any[]>([])
    const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
    const [answers, setAnswers] = useState<any[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(true)
    const [answersLoading, setAnswersLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [errorBanner, setErrorBanner] = useState<string | null>(null)
    const [_questionnaire, setQuestionnaire] = useState<{ id: string; bc_id: number } | null>(null)

    const creatingQuestionnaireRef = useRef<Record<string, boolean>>({})
    const activeProjectDbIdRef = useRef<string | null>(project?.db_id || null)
    const activeQuestionIdRef = useRef<string | null>(null)

    const fetchQuestionsList = useCallback(
        async (opts?: { silent?: boolean }) => {
            const projectDbId = project?.db_id
            if (!projectDbId) return
            const silent = opts?.silent ?? false
            if (!silent) setLoading(true)

            try {
                let { data: dbQuestionnaire, error: qnErr } = await supabase
                    .from('bc_questionnaires')
                    .select('id, bc_id, created_at')
                    .eq('project_id', projectDbId)
                    .order('created_at', { ascending: true })
                    .limit(1)
                    .maybeSingle()

                if (qnErr) throw qnErr

                if (!dbQuestionnaire && !creatingQuestionnaireRef.current[projectDbId]) {
                    creatingQuestionnaireRef.current[projectDbId] = true
                    try {
                        const { data: recheck } = await supabase
                            .from('bc_questionnaires')
                            .select('id, bc_id, created_at')
                            .eq('project_id', projectDbId)
                            .order('created_at', { ascending: true })
                            .limit(1)
                            .maybeSingle()

                        if (recheck) {
                            dbQuestionnaire = recheck
                        } else {
                            const uniqueBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
                            const { data: newQuest, error: questErr } = await supabase
                                .from('bc_questionnaires')
                                .insert({
                                    project_id: projectDbId,
                                    bc_id: uniqueBcId,
                                })
                                .select('id, bc_id, created_at')
                                .maybeSingle()
                            if (questErr) throw questErr
                            dbQuestionnaire = newQuest
                        }
                    } finally {
                        creatingQuestionnaireRef.current[projectDbId] = false
                    }
                }

                // Fetch all questions for this project ordered oldest-first
                let { data: dbQuestions, error: qErr } = await supabase
                    .from('bc_questions')
                    .select('*')
                    .eq('project_id', projectDbId)
                    .order('created_at', { ascending: true })

                if (qErr) throw qErr

                if (
                    (!dbQuestions || dbQuestions.length === 0) &&
                    dbQuestionnaire &&
                    !creatingQuestionnaireRef.current[`seed-${projectDbId}`]
                ) {
                    creatingQuestionnaireRef.current[`seed-${projectDbId}`] = true
                    try {
                        const { data: existingCheck } = await supabase
                            .from('bc_questions')
                            .select('*')
                            .eq('project_id', projectDbId)
                            .order('created_at', { ascending: true })

                        if (existingCheck && existingCheck.length > 0) {
                            dbQuestions = existingCheck
                        } else {
                            const uniqueQBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
                            const { data: seededQ, error: seedErr } = await supabase
                                .from('bc_questions')
                                .insert({
                                    project_id: projectDbId,
                                    questionnaire_id: dbQuestionnaire.id,
                                    bc_id: uniqueQBcId,
                                    title: '¿Qué trabajaste hoy? / What did you work on today?',
                                    schedule_text: 'Todos los días a las 5:00 PM',
                                    is_paused: false,
                                })
                                .select('*')
                            if (seedErr) throw seedErr
                            dbQuestions = seededQ || []
                        }
                    } finally {
                        creatingQuestionnaireRef.current[`seed-${projectDbId}`] = false
                    }
                }

                if (activeProjectDbIdRef.current !== projectDbId) return

                if (dbQuestionnaire) {
                    setQuestionnaire({
                        id: dbQuestionnaire.id,
                        bc_id: Number(dbQuestionnaire.bc_id),
                    })
                }

                // Sort active questions first, then paused questions
                const sorted = [...(dbQuestions || [])].sort((a, b) => {
                    const aPaused = Boolean(a.is_paused)
                    const bPaused = Boolean(b.is_paused)
                    if (aPaused !== bPaused) return aPaused ? 1 : -1
                    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
                })

                setQuestions(sorted)
                setSelectedQuestionId((prev) => {
                    if (prev && sorted.some((q) => q.id === prev)) return prev
                    return sorted[0]?.id || null
                })
            } catch (err: any) {
                console.error('❌ [ToolCheckins FetchQ] Error:', err.message)
                if (activeProjectDbIdRef.current === projectDbId && !silent) {
                    setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
                }
            } finally {
                if (activeProjectDbIdRef.current === projectDbId && !silent) {
                    setLoading(false)
                }
            }
        },
        [project?.db_id, supabase, t]
    )

    const fetchQuestionAnswers = useCallback(
        async (qId: string, opts?: { silent?: boolean }) => {
            const silent = opts?.silent ?? false
            if (!silent) setAnswersLoading(true)
            try {
                const { data: dbAnswers, error } = await supabase
                    .from('bc_answers')
                    .select(
                        `
                        id, bc_id, content, created_at,
                        author:bc_people(name)
                    `
                    )
                    .eq('question_id', qId)
                    .order('created_at', { ascending: false })

                if (error) throw error
                if (activeQuestionIdRef.current !== qId) return
                setAnswers(dbAnswers || [])
            } catch (err: any) {
                console.error('❌ [ToolCheckins FetchA] Error:', err.message)
                if (activeQuestionIdRef.current === qId && !silent) {
                    setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
                }
            } finally {
                if (activeQuestionIdRef.current === qId && !silent) {
                    setAnswersLoading(false)
                }
            }
        },
        [supabase, t]
    )

    // Reset state cleanly when project changes
    useEffect(() => {
        activeProjectDbIdRef.current = project?.db_id || null
        activeQuestionIdRef.current = null
        setQuestions([])
        setSelectedQuestionId(null)
        setAnswers([])
        setInputText('')
        setQuestionnaire(null)
        setErrorBanner(null)
        setLoading(true)

        if (project?.db_id) {
            fetchQuestionsList()
        } else {
            setLoading(false)
        }
    }, [project?.id, project?.db_id, fetchQuestionsList])

    const selectedQuestion = useMemo(
        () => (selectedQuestionId ? questions.find((q) => q.id === selectedQuestionId) || null : null),
        [questions, selectedQuestionId]
    )

    // Load answers when selected question changes
    useEffect(() => {
        activeQuestionIdRef.current = selectedQuestion?.id || null
        if (selectedQuestion?.id) {
            setAnswers([])
            fetchQuestionAnswers(selectedQuestion.id)
        } else {
            setAnswers([])
        }
    }, [selectedQuestion?.id, fetchQuestionAnswers])

    // Realtime subscription for bc_questions on the project
    useEffect(() => {
        const projectDbId = project?.db_id
        if (!projectDbId) return

        const channel = supabase
            .channel(`checkin-questions-${projectDbId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_questions',
                    filter: `project_id=eq.${projectDbId}`,
                },
                () => {
                    fetchQuestionsList({ silent: true })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project?.db_id, supabase, fetchQuestionsList])

    // Realtime subscription (`event: '*'`) to checkin answers on selected question
    useEffect(() => {
        const qId = selectedQuestion?.id
        if (!qId) return

        const channel = supabase
            .channel(`checkin-answers-${qId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_answers',
                    filter: `question_id=eq.${qId}`,
                },
                () => {
                    fetchQuestionAnswers(qId, { silent: true })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [selectedQuestion?.id, supabase, fetchQuestionAnswers])

    const handleSendAnswer = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!inputText.trim() || !selectedQuestion || sending) return

        const contentToSend = inputText.trim()
        setInputText('')
        setSending(true)
        setErrorBanner(null)

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_answer',
                    projectId: project.id,
                    questionId: selectedQuestion.bc_id,
                    questionDbId: selectedQuestion.id,
                    content: contentToSend,
                }),
            })

            if (!res.ok) {
                throw new Error(await parseActionError(res, t('basecamp.action_error')))
            }

            await fetchQuestionAnswers(selectedQuestion.id, { silent: true })
        } catch (err: any) {
            console.error('❌ [ToolCheckins SendA] Error:', err.message)
            setInputText(contentToSend)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setSending(false)
        }
    }

    const activeCount = useMemo(
        () => questions.filter((q) => !q.is_paused).length,
        [questions]
    )

    return (
        <div className="flex-1 max-w-4xl mx-auto px-4 w-full flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-col items-center gap-1 text-center border-b border-slate-100 dark:border-slate-800 pb-6">
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {t('basecamp.checkins_sub')}
                </span>
                <h3 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-slate-100 font-serif">
                    {t('basecamp.checkins')}
                </h3>
            </div>

            {/* Banner de error visible */}
            {errorBanner && (
                <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <AlertCircle size={15} className="shrink-0" />
                        <span className="break-words">{errorBanner}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorBanner(null)}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50 shrink-0"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Left Column: Questions List */}
                    <div className="md:col-span-1 flex flex-col gap-2">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                            {t('basecamp.active_questions')} ({activeCount}/{questions.length})
                        </h4>
                        {questions.map((q) => {
                            const isSelected = selectedQuestion?.id === q.id
                            const isPaused = Boolean(q.is_paused)
                            const displayTitle = formatQuestionTitle(q.title, language)
                            const displaySched = formatQuestionSchedule(
                                q.schedule_text,
                                language,
                                t('basecamp.every_day')
                            )

                            return (
                                <div
                                    key={q.id}
                                    onClick={() => setSelectedQuestionId(q.id)}
                                    className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all ${
                                        isSelected
                                            ? 'bg-[#1D7DB5] text-white border-[#1D7DB5] shadow-md shadow-blue-500/10'
                                            : isPaused
                                            ? 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/60 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 opacity-80'
                                            : 'bg-white dark:bg-slate-900 border-slate-200/60 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p
                                            className={`text-xs font-bold leading-snug line-clamp-2 ${
                                                isSelected
                                                    ? 'text-white'
                                                    : 'text-slate-800 dark:text-slate-200'
                                            }`}
                                        >
                                            {displayTitle}
                                        </p>
                                        {isPaused && (
                                            <span
                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                                                    isSelected
                                                        ? 'bg-white/20 text-white'
                                                        : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                                }`}
                                            >
                                                <PauseCircle size={10} />
                                                <span>{t('basecamp.paused_badge')}</span>
                                            </span>
                                        )}
                                    </div>
                                    <span
                                        className={`text-[10px] block mt-1.5 font-semibold ${
                                            isSelected ? 'text-blue-100' : 'text-slate-400'
                                        }`}
                                    >
                                        {displaySched}
                                    </span>
                                </div>
                            )
                        })}
                    </div>

                    {/* Right Column: Question Details & Answers */}
                    <div className="md:col-span-2 flex flex-col gap-6">
                        {selectedQuestion && (
                            <>
                                {/* Active Question Header */}
                                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-inner text-left">
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <h4 className="text-[9px] font-black text-amber-700 dark:text-amber-500 uppercase tracking-widest">
                                            {t('basecamp.checkins')}
                                        </h4>
                                        {Boolean(selectedQuestion.is_paused) && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                <PauseCircle size={11} />
                                                <span>{t('basecamp.paused_badge')}</span>
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                                        {formatQuestionTitle(selectedQuestion.title, language)}
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider font-semibold">
                                        {formatQuestionSchedule(
                                            selectedQuestion.schedule_text,
                                            language,
                                            t('basecamp.every_day')
                                        )}
                                    </p>
                                </div>

                                {/* Answers feed */}
                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2">
                                        {t('basecamp.team_answers').replace(
                                            '{count}',
                                            String(answers.length)
                                        )}
                                    </h4>

                                    <div className="space-y-4">
                                        {answersLoading && answers.length === 0 ? (
                                            <div className="flex justify-center py-6">
                                                <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                            </div>
                                        ) : answers.length > 0 ? (
                                            answers.map((ans) => {
                                                const authorName = extractAuthorName(
                                                    ans.author,
                                                    t('basecamp.anonymous_user')
                                                )
                                                const rendered = renderAnswerContentHtml(ans.content)

                                                return (
                                                    <div
                                                        key={ans.id}
                                                        className="flex gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-2xl shadow-sm items-start text-left"
                                                    >
                                                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold flex items-center justify-center text-xs shrink-0 uppercase">
                                                            {(authorName[0] || 'U').toUpperCase()}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                                                                <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                                                                    {authorName}
                                                                </span>
                                                                <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                                                                    <Clock size={10} />
                                                                    <span>
                                                                        {formatAnswerTimestamp(
                                                                            ans.created_at,
                                                                            locale
                                                                        )}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            {rendered.html && (
                                                                <div
                                                                    className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words [&_a]:text-[#1D7DB5] dark:[&_a]:text-sky-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-xl [&_img]:my-2 [&_p]:my-1"
                                                                    dangerouslySetInnerHTML={{
                                                                        __html: rendered.html,
                                                                    }}
                                                                />
                                                            )}
                                                            {rendered.fileAttachments.length > 0 && (
                                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                                    {rendered.fileAttachments.map(
                                                                        (att, idx) => (
                                                                            <a
                                                                                key={idx}
                                                                                href={att.url}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                                                                            >
                                                                                <Paperclip size={11} />
                                                                                <span>
                                                                                    {att.filename}
                                                                                </span>
                                                                            </a>
                                                                        )
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <p className="text-xs text-slate-400 italic text-center py-8">
                                                {t('basecamp.checkin_first_answer')}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Form to answer */}
                                <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                                        {t('basecamp.your_answer_label')}
                                    </h4>
                                    <form onSubmit={handleSendAnswer} className="space-y-3">
                                        <textarea
                                            required
                                            value={inputText}
                                            onChange={(e) => setInputText(e.target.value)}
                                            disabled={sending}
                                            placeholder={t('basecamp.checkin_answer_placeholder')}
                                            className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-xs h-24 disabled:opacity-50"
                                        />
                                        <div className="flex justify-end">
                                            <button
                                                type="submit"
                                                disabled={sending || !inputText.trim()}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:bg-blue-300 text-white font-extrabold text-xs shadow-sm transition-all"
                                            >
                                                {sending ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Send size={13} />
                                                )}
                                                <span>{t('basecamp.post_answer')}</span>
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
