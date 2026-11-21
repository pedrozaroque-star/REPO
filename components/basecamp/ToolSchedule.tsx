/**
 * @module ToolSchedule
 * @description Módulo de Calendario y Agenda (Schedule) para eventos, entregas e hitos operativos de Tacos Gavilan.
 *              Conecta con Supabase (`bc_schedules`, `bc_schedule_entries`), soporta vistas de cuadrícula mensual
 *              y lista cronológica, eventos de múltiples días, eventos de todo el día vs. con horario específico,
 *              y sincronización en tiempo real mediante Supabase Realtime.
 * @businessRules
 *   - Eventos `all_day === true` se interpretan como fechas calendario puras (`YYYY-MM-DD`) sin conversión de zona
 *     horaria (evitando desplazamientos al día anterior a las 5:00 PM) y muestran "Todo el día" / "All day".
 *   - Eventos `all_day === false` formatean fecha y hora estrictamente en `America/Los_Angeles` (Pacific Time) para
 *     que eventos vespertinos (PM) nunca salten al día siguiente por UTC.
 *   - Eventos de múltiples días (`starts_at..ends_at`) se pintan en todas las celdas abarcadas en la vista mensual.
 *   - Hacer clic sobre una píldora de evento en el calendario (`e.stopPropagation()`) abre el detalle completo
 *     (notas, ubicación, autor y botón de eliminar) sin disparar el formulario de alta de celda vacía.
 * @dataFlow
 *   - Entrada: Props `project` (`id` = bc_id, `db_id` = UUID) y `currentUserName`.
 *   - Fetch: `bc_schedules` + `bc_schedule_entries` ordenados por `starts_at` ascendente.
 *   - Realtime: Canal `postgres_changes` (`event: '*'`) sobre `bc_schedule_entries` filtrado por `project_id`.
 *   - Escritura: `POST /api/basecamp/action` (`create_schedule_entry`, `delete_recording`).
 * @notes
 *   - Bilingüe (ES/EN) con `useLanguage` (`es-MX` / `en-US`) y `t('basecamp.location_prefix')`.
 *   - Renderiza HTML Trix en notas de eventos de forma segura con `rewriteBasecampHtmlUrls` y `stripTegAuthorBanner`.
 */

'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    Calendar as CalendarIcon,
    Plus,
    Trash2,
    Clock,
    MapPin,
    List,
    ChevronLeft,
    ChevronRight,
    Loader2,
    User,
    Paperclip,
    AlertCircle,
    X,
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'
import {
    rewriteBasecampHtmlUrls,
    proxyBasecampUrl,
    safeDecodeFilename,
    injectImageDownloadOverlays,
    triggerBasecampDownload,
    buildBasecampDirectDownloadHref,
    BASECAMP_IMAGE_HOVER_CSS,
} from '@/lib/basecamp-html'

interface ToolScheduleProps {
    project: any
    currentUserName: string
}

export function getPacificTodayStr(refDate: Date = new Date()): string {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(refDate)
    } catch {
        const y = refDate.getFullYear()
        const m = String(refDate.getMonth() + 1).padStart(2, '0')
        const d = String(refDate.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }
}

function getPacificDateStrFromInstant(isoStr?: string | null): string {
    if (!isoStr) return ''
    const parsed = new Date(isoStr)
    if (Number.isNaN(parsed.getTime())) return ''
    return getPacificTodayStr(parsed)
}

function extractPureYmd(rawStr?: string | null): string {
    if (!rawStr) return ''
    const m = String(rawStr).trim().match(/^(\d{4}-\d{2}-\d{2})/)
    return m ? m[1] : ''
}

export function getEventDateRange(ev: {
    starts_at?: string | null
    ends_at?: string | null
    all_day?: boolean | null
}): { startYmd: string; endYmd: string } {
    if (!ev?.starts_at) return { startYmd: '', endYmd: '' }
    if (ev.all_day) {
        const startYmd = extractPureYmd(ev.starts_at)
        const rawEnd = extractPureYmd(ev.ends_at) || startYmd
        const endYmd = rawEnd >= startYmd ? rawEnd : startYmd
        return { startYmd, endYmd }
    }
    const startYmd = getPacificDateStrFromInstant(ev.starts_at)
    const rawEnd = ev.ends_at ? getPacificDateStrFromInstant(ev.ends_at) : startYmd
    const endYmd = rawEnd && rawEnd >= startYmd ? rawEnd : startYmd
    return { startYmd, endYmd }
}

function formatPureYmd(
    ymd: string,
    locale: string,
    opts: Intl.DateTimeFormatOptions
): string {
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return ymd
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])
    // Noon UTC formatted in UTC prevents any local/Pacific timezone shift on pure calendar dates
    const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(utcNoon)
}

function formatPacificTime(isoStr: string | undefined | null, locale: string): string {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
    }).format(d)
}

function buildPacificIsoTimestamp(ymd: string, hm: string): string {
    const [y, m, d] = ymd.split('-').map(Number)
    const [hh, mm] = (hm || '09:00').split(':').map(Number)
    const guessUtcMs = Date.UTC(y, m - 1, d, (hh || 0) + 8, mm || 0, 0)
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(guessUtcMs))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
    const laHour = get('hour') === 24 ? 0 : get('hour')
    const laAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), laHour, get('minute'), 0)
    const targetAsUtcMs = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0)
    return new Date(guessUtcMs + (targetAsUtcMs - laAsUtcMs)).toISOString()
}

function extractAuthorName(rel: any, fallback: string): string {
    const obj = Array.isArray(rel) ? rel[0] : rel
    return (obj?.name && String(obj.name).trim()) || fallback
}

function parseEventDescriptionAndLocation(rawDesc?: string | null): {
    location: string
    notesHtml: string
    fileAttachments: { filename: string; url: string }[]
} {
    if (!rawDesc) return { location: '', notesHtml: '', fileAttachments: [] }
    const { cleanHtml } = stripTegAuthorBanner(rawDesc)
    if (!cleanHtml) return { location: '', notesHtml: '', fileAttachments: [] }

    let location = ''
    const locMatch = cleanHtml.match(/(?:Ubicación|Ubicacion|Location)\s*:\s*([^\r\n<]+)/i)
    if (locMatch?.[1]) {
        location = locMatch[1].trim()
    }

    const withoutLoc = cleanHtml
        .replace(/<p[^>]*>\s*(?:Ubicación|Ubicacion|Location)\s*:\s*[^<]*<\/p>/gi, '')
        .replace(/(?:\r?\n|^)\s*(?:Ubicación|Ubicacion|Location)\s*:\s*[^\r\n<]*/gi, '')
        .trim()

    if (!withoutLoc) {
        return { location, notesHtml: '', fileAttachments: [] }
    }

    const fileAttachments: { filename: string; url: string }[] = []
    const attachRegex = /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi
    let match: RegExpExecArray | null
    while ((match = attachRegex.exec(withoutLoc)) !== null) {
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
        withoutLoc
    )
    let safeHtml: string
    if (hasHtmlTags) {
        safeHtml = rewriteBasecampHtmlUrls(withoutLoc).replace(
            /<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi,
            '$1'
        )
    } else {
        safeHtml = withoutLoc
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\r?\n/g, '<br />')
    }

    const plainCheck = safeHtml.replace(/<img\b[^>]*>/gi, '[img]').replace(/<[^>]*>/g, '').trim()
    return {
        location,
        notesHtml: plainCheck ? safeHtml : '',
        fileAttachments,
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

export default function ToolSchedule({ project }: ToolScheduleProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'

    const [schedule, setSchedule] = useState<{ id: string; bc_id: number } | null>(null)
    const [events, setEvents] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [errorBanner, setErrorBanner] = useState<string | null>(null)

    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar')

    // Initialize calendar month strictly in Pacific time
    const [currentDate, setCurrentDate] = useState<Date>(() => {
        const [y, m] = getPacificTodayStr().split('-').map(Number)
        return new Date(y, (m || 1) - 1, 1)
    })

    const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

    const handleScheduleHtmlClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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

    // Form state
    const [showAddForm, setShowAddForm] = useState(false)
    const [newTitle, setNewTitle] = useState('')
    const [newDate, setNewDate] = useState('')
    const [newEndDate, setNewEndDate] = useState('')
    const [newAllDay, setNewAllDay] = useState(true)
    const [newStartTime, setNewStartTime] = useState('09:00')
    const [newEndTime, setNewEndTime] = useState('10:00')
    const [newLocation, setNewLocation] = useState('')
    const [newNotes, setNewNotes] = useState('')

    const creatingScheduleRef = useRef<Record<string, boolean>>({})
    const activeProjectDbIdRef = useRef<string | null>(project?.db_id || null)

    const fetchScheduleAndEntries = useCallback(
        async (opts?: { silent?: boolean }) => {
            const projectDbId = project?.db_id
            if (!projectDbId) return
            const silent = opts?.silent ?? false
            if (!silent) setLoading(true)

            try {
                let { data: dbSchedule, error: schedQueryErr } = await supabase
                    .from('bc_schedules')
                    .select('id, bc_id, created_at')
                    .eq('project_id', projectDbId)
                    .order('created_at', { ascending: true })
                    .limit(1)
                    .maybeSingle()

                if (schedQueryErr) throw schedQueryErr

                if (!dbSchedule && !creatingScheduleRef.current[projectDbId]) {
                    creatingScheduleRef.current[projectDbId] = true
                    try {
                        const { data: recheck } = await supabase
                            .from('bc_schedules')
                            .select('id, bc_id, created_at')
                            .eq('project_id', projectDbId)
                            .order('created_at', { ascending: true })
                            .limit(1)
                            .maybeSingle()

                        if (recheck) {
                            dbSchedule = recheck
                        } else {
                            const uniqueBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
                            const { data: createdSched, error: schedErr } = await supabase
                                .from('bc_schedules')
                                .insert({
                                    project_id: projectDbId,
                                    bc_id: uniqueBcId,
                                })
                                .select('id, bc_id, created_at')
                                .maybeSingle()
                            if (schedErr) throw schedErr
                            dbSchedule = createdSched
                        }
                    } finally {
                        creatingScheduleRef.current[projectDbId] = false
                    }
                }

                const { data: dbEntries, error: entErr } = await supabase
                    .from('bc_schedule_entries')
                    .select(
                        `
                        *,
                        author:bc_people(name)
                    `
                    )
                    .eq('project_id', projectDbId)
                    .order('starts_at', { ascending: true })

                if (entErr) throw entErr
                if (activeProjectDbIdRef.current !== projectDbId) return

                if (dbSchedule) {
                    setSchedule({ id: dbSchedule.id, bc_id: Number(dbSchedule.bc_id) })
                }
                setEvents(dbEntries || [])
            } catch (err: any) {
                console.error('❌ [ToolSchedule Fetch] Error:', err.message)
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

    // Reset state when project changes
    useEffect(() => {
        activeProjectDbIdRef.current = project?.db_id || null
        setSchedule(null)
        setEvents([])
        setSelectedEventId(null)
        setShowAddForm(false)
        setErrorBanner(null)
        setLoading(true)

        if (project?.db_id) {
            fetchScheduleAndEntries()
        } else {
            setLoading(false)
        }
    }, [project?.id, project?.db_id, fetchScheduleAndEntries])

    // Realtime subscription on bc_schedule_entries
    useEffect(() => {
        const projectDbId = project?.db_id
        if (!projectDbId) return

        const channel = supabase
            .channel(`schedule-entries-${projectDbId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_schedule_entries',
                    filter: `project_id=eq.${projectDbId}`,
                },
                () => {
                    fetchScheduleAndEntries({ silent: true })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project?.db_id, supabase, fetchScheduleAndEntries])

    // Escape key closes event detail or add form
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (selectedEventId) setSelectedEventId(null)
                else if (showAddForm) setShowAddForm(false)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [selectedEventId, showAddForm])

    const selectedEvent = useMemo(
        () => (selectedEventId ? events.find((ev) => ev.id === selectedEventId) || null : null),
        [events, selectedEventId]
    )

    const openAddFormForDate = (dateYmd: string) => {
        setSelectedEventId(null)
        setErrorBanner(null)
        setNewDate(dateYmd)
        setNewEndDate(dateYmd)
        setNewAllDay(true)
        setNewStartTime('09:00')
        setNewEndTime('10:00')
        setShowAddForm(true)
    }

    const handleAddEvent = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTitle.trim() || !newDate || !schedule || actionLoading) return
        setActionLoading(true)
        setErrorBanner(null)

        try {
            const effectiveEndDate =
                newEndDate && newEndDate >= newDate ? newEndDate : newDate

            let startsAt: string
            let endsAt: string

            if (newAllDay) {
                startsAt = `${newDate}T00:00:00Z`
                endsAt = `${effectiveEndDate}T00:00:00Z`
            } else {
                startsAt = buildPacificIsoTimestamp(newDate, newStartTime || '09:00')
                const candidateEnd = buildPacificIsoTimestamp(
                    effectiveEndDate,
                    newEndTime || newStartTime || '10:00'
                )
                endsAt =
                    new Date(candidateEnd).getTime() >= new Date(startsAt).getTime()
                        ? candidateEnd
                        : startsAt
            }

            const locLine = newLocation.trim()
                ? `${t('basecamp.location_prefix')} ${newLocation.trim()}`
                : ''
            const combinedDescription = [newNotes.trim(), locLine]
                .filter(Boolean)
                .join('\n')

            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_schedule_entry',
                    projectId: project.id,
                    scheduleId: schedule.bc_id,
                    scheduleDbId: schedule.id,
                    title: newTitle.trim(),
                    description: combinedDescription,
                    starts_at: startsAt,
                    ends_at: endsAt,
                    all_day: newAllDay,
                }),
            })

            if (!res.ok) {
                throw new Error(await parseActionError(res, t('basecamp.action_error')))
            }

            setNewTitle('')
            setNewDate('')
            setNewEndDate('')
            setNewLocation('')
            setNewNotes('')
            setShowAddForm(false)
            await fetchScheduleAndEntries({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolSchedule Add] Error:', err.message)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setActionLoading(false)
        }
    }

    const handleDeleteEvent = async (ev: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_event_confirm'))) return
        setActionLoading(true)
        setErrorBanner(null)

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: ev.bc_id,
                    recordingDbId: ev.id,
                    tableName: 'bc_schedule_entries',
                }),
            })

            if (!res.ok) {
                throw new Error(await parseActionError(res, t('basecamp.action_error')))
            }

            if (selectedEventId === ev.id) {
                setSelectedEventId(null)
            }
            await fetchScheduleAndEntries({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolSchedule Delete] Error:', err.message)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setActionLoading(false)
        }
    }

    const formatEventScheduleSummary = (ev: any): string => {
        const { startYmd, endYmd } = getEventDateRange(ev)
        if (!startYmd) return ''

        const startFormatted = formatPureYmd(startYmd, locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
        const endFormatted = formatPureYmd(endYmd, locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })

        if (ev.all_day) {
            if (endYmd && endYmd !== startYmd) {
                return `${startFormatted} – ${endFormatted} • ${t('basecamp.all_day')}`
            }
            return `${startFormatted} • ${t('basecamp.all_day')}`
        }

        const startTimeStr = formatPacificTime(ev.starts_at, locale)
        const endTimeStr = ev.ends_at ? formatPacificTime(ev.ends_at, locale) : ''

        if (endYmd && endYmd !== startYmd) {
            return `${startFormatted} ${startTimeStr}${
                endTimeStr ? ` – ${endFormatted} ${endTimeStr}` : ''
            }`
        }

        if (endTimeStr && endTimeStr !== startTimeStr) {
            return `${startFormatted} • ${startTimeStr} – ${endTimeStr}`
        }
        return `${startFormatted} • ${startTimeStr}`
    }

    const getBadgeParts = (ev: any): { month: string; day: number } => {
        const { startYmd } = getEventDateRange(ev)
        if (!startYmd) return { month: '', day: 0 }
        const dayNum = Number(startYmd.split('-')[2] || 0)
        const monthShort = formatPureYmd(startYmd, locale, { month: 'short' })
            .replace('.', '')
            .toUpperCase()
        return { month: monthShort, day: dayNum }
    }

    const getDaysInMonth = (year: number, month: number) =>
        new Date(year, month + 1, 0).getDate()
    const getFirstDayOfMonth = (year: number, month: number) =>
        new Date(year, month, 1).getDay()

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    }

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    }

    const renderCalendarGrid = () => {
        const year = currentDate.getFullYear()
        const month = currentDate.getMonth()
        const daysInMonth = getDaysInMonth(year, month)
        const firstDayIndex = getFirstDayOfMonth(year, month)

        const monthYmd = `${year}-${String(month + 1).padStart(2, '0')}-01`
        const monthName = formatPureYmd(monthYmd, locale, {
            month: 'long',
            year: 'numeric',
        })

        const prevMonthDate = new Date(year, month - 1, 1)
        const daysInPrevMonth = getDaysInMonth(
            prevMonthDate.getFullYear(),
            prevMonthDate.getMonth()
        )

        const gridCells: { day: number; isCurrentMonth: boolean; date: Date }[] = []

        for (let i = firstDayIndex - 1; i >= 0; i--) {
            const dayNum = daysInPrevMonth - i
            gridCells.push({
                day: dayNum,
                isCurrentMonth: false,
                date: new Date(year, month - 1, dayNum),
            })
        }

        for (let d = 1; d <= daysInMonth; d++) {
            gridCells.push({
                day: d,
                isCurrentMonth: true,
                date: new Date(year, month, d),
            })
        }

        const totalCells = Math.ceil(gridCells.length / 7) * 7
        const nextDaysCount = totalCells - gridCells.length
        for (let n = 1; n <= nextDaysCount; n++) {
            gridCells.push({
                day: n,
                isCurrentMonth: false,
                date: new Date(year, month + 1, n),
            })
        }

        const weekdayLabels = [
            t('basecamp.weekday_sun'),
            t('basecamp.weekday_mon'),
            t('basecamp.weekday_tue'),
            t('basecamp.weekday_wed'),
            t('basecamp.weekday_thu'),
            t('basecamp.weekday_fri'),
            t('basecamp.weekday_sat'),
        ]

        const pacificToday = getPacificTodayStr()

        return (
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl p-2 sm:p-4 shadow-sm">
                {/* Month navigation */}
                <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h4 className="text-sm font-black text-slate-800 dark:text-slate-200 capitalize">
                        {monthName}
                    </h4>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={handlePrevMonth}
                            className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={handleNextMonth}
                            className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

                {/* Weekdays */}
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1 text-center mb-1">
                    {weekdayLabels.map((lbl, idx) => (
                        <div
                            key={idx}
                            className="text-[9px] sm:text-[10px] font-black text-slate-400 dark:text-slate-500 py-1"
                        >
                            {lbl}
                        </div>
                    ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-0.5 sm:gap-1 bg-slate-100/50 dark:bg-slate-800 p-0.5 sm:p-1 rounded-xl">
                    {gridCells.map((cell, idx) => {
                        const cellYear = cell.date.getFullYear()
                        const cellMonth = String(cell.date.getMonth() + 1).padStart(2, '0')
                        const cellDay = String(cell.date.getDate()).padStart(2, '0')
                        const cellDateStr = `${cellYear}-${cellMonth}-${cellDay}`

                        // Match single-day AND multi-day events spanning cellDateStr
                        const dayEvents = events.filter((ev) => {
                            const { startYmd, endYmd } = getEventDateRange(ev)
                            if (!startYmd) return false
                            return cellDateStr >= startYmd && cellDateStr <= endYmd
                        })

                        const isToday = pacificToday === cellDateStr

                        return (
                            <div
                                key={idx}
                                onClick={() => {
                                    if (cell.isCurrentMonth) {
                                        openAddFormForDate(cellDateStr)
                                    }
                                }}
                                className={`min-h-[56px] sm:min-h-[76px] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/40 p-1 sm:p-1.5 rounded-md sm:rounded-lg flex flex-col justify-between transition-colors ${
                                    cell.isCurrentMonth
                                        ? 'cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/70'
                                        : 'opacity-40'
                                } ${isToday ? 'ring-2 ring-purple-500 ring-inset' : ''}`}
                            >
                                <span
                                    className={`text-[9px] sm:text-[10px] font-black ${
                                        cell.isCurrentMonth
                                            ? 'text-slate-800 dark:text-slate-200'
                                            : 'text-slate-400'
                                    }`}
                                >
                                    {cell.day}
                                </span>

                                <div className="space-y-0.5 sm:space-y-1 mt-0.5 sm:mt-1 max-h-[36px] sm:max-h-[52px] overflow-y-auto no-scrollbar">
                                    {dayEvents.map((ev) => (
                                        <button
                                            key={ev.id}
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setSelectedEventId(ev.id)
                                            }}
                                            title={ev.title}
                                            className="w-full text-left text-[8px] sm:text-[9px] font-extrabold truncate px-1 py-0.5 rounded bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 text-purple-800 dark:text-purple-200 border border-purple-200/50 dark:border-purple-800/50 transition-colors"
                                        >
                                            {ev.title}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 max-w-3xl mx-auto w-full flex flex-col gap-6">
            <style dangerouslySetInnerHTML={{ __html: BASECAMP_IMAGE_HOVER_CSS }} />
            {/* Cabecera */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center border border-purple-200/30">
                        <CalendarIcon size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                            {t('basecamp.schedule')}
                        </h3>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            {t('basecamp.schedule_sub')}
                        </p>
                    </div>
                </div>

                {!showAddForm && (
                    <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
                        {/* Toggle de vistas */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/40 dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => setViewMode('calendar')}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                                    viewMode === 'calendar'
                                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                {t('basecamp.calendar_view')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('list')}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-1 ${
                                    viewMode === 'list'
                                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                <List size={10} />
                                <span>{t('basecamp.list_view')}</span>
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={() => openAddFormForDate(getPacificTodayStr())}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs shadow-sm transition-all"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.add_event_btn')}</span>
                        </button>
                    </div>
                )}
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

            {/* Modal / Tarjeta de Detalle de Evento seleccionado desde Calendario */}
            {selectedEvent && !showAddForm && (
                <div className="bg-[#fcfaf6] dark:bg-slate-900 border border-purple-200 dark:border-purple-900/60 p-5 rounded-2xl shadow-md">
                    <div className="flex items-center justify-between border-b border-slate-200/70 dark:border-slate-800 pb-2.5 mb-3">
                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">
                            {t('basecamp.event_details_title')}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={(e) => handleDeleteEvent(selectedEvent, e)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
                            >
                                <Trash2 size={13} />
                                <span>{t('basecamp.delete')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedEventId(null)}
                                title={t('basecamp.close_esc')}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </div>

                    <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                        {selectedEvent.title}
                    </h4>

                    {(() => {
                        const parsed = parseEventDescriptionAndLocation(selectedEvent.description)
                        const authorName = extractAuthorName(
                            selectedEvent.author,
                            t('basecamp.unknown_user')
                        )
                        return (
                            <>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300 mt-2 font-medium">
                                    <span className="inline-flex items-center gap-1.5">
                                        <Clock size={13} className="text-purple-600 dark:text-purple-400" />
                                        <span>{formatEventScheduleSummary(selectedEvent)}</span>
                                    </span>
                                    {parsed.location && (
                                        <span className="inline-flex items-center gap-1.5">
                                            <MapPin
                                                size={13}
                                                className="text-purple-600 dark:text-purple-400"
                                            />
                                            <span>{parsed.location}</span>
                                        </span>
                                    )}
                                    <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                        <User size={12} />
                                        <span>{authorName}</span>
                                    </span>
                                </div>

                                {parsed.notesHtml && (
                                    <div
                                        onClick={handleScheduleHtmlClick}
                                        className="text-xs text-slate-700 dark:text-slate-300 mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 leading-relaxed break-words [&_a]:text-purple-600 dark:[&_a]:text-purple-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-xl [&_img]:my-2"
                                        dangerouslySetInnerHTML={{ __html: injectImageDownloadOverlays(parsed.notesHtml, t('basecamp.download_btn')) }}
                                    />
                                )}

                                {parsed.fileAttachments.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {parsed.fileAttachments.map((att, idx) => (
                                            <a
                                                key={idx}
                                                href={buildBasecampDirectDownloadHref(att.url, att.filename)}
                                                onClick={(ev) => {
                                                    ev.preventDefault()
                                                    triggerBasecampDownload(att.url, att.filename)
                                                }}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
                                            >
                                                <Paperclip size={12} />
                                                <span>{att.filename}</span>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </>
                        )
                    })()}
                </div>
            )}

            {/* ── 1. FORMULARIO DE CREACIÓN ── */}
            {showAddForm && (
                <div className="bg-[#fcfaf6] dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
                    <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold mb-4 block"
                    >
                        {t('basecamp.cancel_back')}
                    </button>
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2.5 mb-4">
                        {t('basecamp.add_event_btn')}
                    </h4>
                    <form onSubmit={handleAddEvent} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                    {t('basecamp.event_name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder={t('basecamp.new_event_title')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                    {t('basecamp.date_label')}
                                </label>
                                <input
                                    type="date"
                                    required
                                    value={newDate}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        setNewDate(val)
                                        if (!newEndDate || newEndDate < val) {
                                            setNewEndDate(val)
                                        }
                                    }}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                    {t('basecamp.end_date_label')}
                                </label>
                                <input
                                    type="date"
                                    min={newDate || undefined}
                                    value={newEndDate}
                                    onChange={(e) => setNewEndDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                id="schedule-all-day-toggle"
                                type="checkbox"
                                checked={newAllDay}
                                onChange={(e) => setNewAllDay(e.target.checked)}
                                className="rounded border-slate-300 text-purple-600 focus:ring-purple-600"
                            />
                            <label
                                htmlFor="schedule-all-day-toggle"
                                className="text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                                {t('basecamp.all_day')}
                            </label>
                        </div>

                        {!newAllDay && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                        {t('basecamp.start_time_label')}
                                    </label>
                                    <input
                                        type="time"
                                        value={newStartTime}
                                        onChange={(e) => setNewStartTime(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                        {t('basecamp.end_time_label')}
                                    </label>
                                    <input
                                        type="time"
                                        value={newEndTime}
                                        onChange={(e) => setNewEndTime(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                {t('basecamp.location_label')}
                            </label>
                            <input
                                type="text"
                                value={newLocation}
                                onChange={(e) => setNewLocation(e.target.value)}
                                placeholder={t('basecamp.location_placeholder')}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                {t('basecamp.notes_label')}
                            </label>
                            <textarea
                                value={newNotes}
                                onChange={(e) => setNewNotes(e.target.value)}
                                placeholder={t('basecamp.event_notes')}
                                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-600 text-xs h-24"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowAddForm(false)}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={actionLoading}
                                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-extrabold text-xs shadow-sm flex items-center gap-1.5"
                            >
                                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{t('basecamp.save_event')}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── 2. VISTAS DE CONTENIDO ── */}
            {!showAddForm && (
                <div>
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                        </div>
                    ) : viewMode === 'calendar' ? (
                        renderCalendarGrid()
                    ) : (
                        <div className="space-y-4">
                            {events.length > 0 ? (
                                events.map((ev) => {
                                    const badge = getBadgeParts(ev)
                                    const parsed = parseEventDescriptionAndLocation(ev.description)
                                    const authorName = extractAuthorName(
                                        ev.author,
                                        t('basecamp.unknown_user')
                                    )

                                    return (
                                        <div
                                            key={ev.id}
                                            className="flex gap-4 p-4 rounded-2xl border border-slate-200/60 bg-white dark:bg-slate-900 dark:border-slate-800 shadow-sm relative group items-start"
                                        >
                                            {/* Bloque de fecha */}
                                            <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200/40 dark:border-purple-900/50 w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0">
                                                <span className="text-[9px] font-black uppercase text-purple-600 dark:text-purple-400">
                                                    {badge.month}
                                                </span>
                                                <span className="text-lg font-black text-slate-800 dark:text-slate-200 leading-none">
                                                    {badge.day}
                                                </span>
                                            </div>

                                            {/* Información del evento */}
                                            <div className="flex-1 min-w-0 pr-7">
                                                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                                    {ev.title}
                                                </h4>
                                                <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex-wrap font-medium">
                                                    <span className="flex items-center gap-1.5">
                                                        <Clock size={11} />
                                                        <span>{formatEventScheduleSummary(ev)}</span>
                                                    </span>
                                                    {parsed.location && (
                                                        <span className="flex items-center gap-1.5">
                                                            <MapPin size={11} />
                                                            <span>{parsed.location}</span>
                                                        </span>
                                                    )}
                                                    <span className="flex items-center gap-1">
                                                        <User size={10} />
                                                        <span>{authorName}</span>
                                                    </span>
                                                </div>
                                                {parsed.notesHtml && (
                                                    <div
                                                        onClick={handleScheduleHtmlClick}
                                                        className="text-[11px] text-slate-600 dark:text-slate-300 mt-2 leading-relaxed break-words [&_a]:text-purple-600 dark:[&_a]:text-purple-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-1.5"
                                                        dangerouslySetInnerHTML={{
                                                            __html: injectImageDownloadOverlays(parsed.notesHtml, t('basecamp.download_btn')),
                                                        }}
                                                    />
                                                )}
                                                {parsed.fileAttachments.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                                        {parsed.fileAttachments.map((att, idx) => (
                                                            <a
                                                                key={idx}
                                                                href={buildBasecampDirectDownloadHref(att.url, att.filename)}
                                                                onClick={(ev) => {
                                                                    ev.preventDefault()
                                                                    triggerBasecampDownload(att.url, att.filename)
                                                                }}
                                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
                                                            >
                                                                <Paperclip size={10} />
                                                                <span>{att.filename}</span>
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Eliminar */}
                                            <button
                                                type="button"
                                                disabled={actionLoading}
                                                onClick={(event) => handleDeleteEvent(ev, event)}
                                                className="absolute right-3 top-4 p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )
                                })
                            ) : (
                                <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl">
                                    <CalendarIcon size={40} className="text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                                        {t('basecamp.no_events_desc')}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

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
