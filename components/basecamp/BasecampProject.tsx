/**
 * @module BasecampProject
 * @description Vista detallada de un proyecto de Basecamp replicando fielmente el dashboard de Basecamp 3.
 *              Muestra cabecera de proyecto con breadcrumb y avatares, feed de actividad reciente con autores,
 *              medidor de aguja de progreso, y cuadrícula de 6 tarjetas enriquecidas con vistas previas reales
 *              (To-dos con checkboxes, Messages con avatar+preview, Docs & Files con íconos por tipo,
 *              Campfire con burbujas de chat, Schedule con mini-calendario, y Check-ins).
 * @businessRules
 *   - El medidor de aguja gira en consonancia al porcentaje real de tareas completadas de To-dos (`bc_completed_ratio` o `completed_count/total_count`, `0/0` -> `0%`), o de forma manual.
 *   - Respeta `project.enabled_tools` de Basecamp 3 (`todoset -> todos`, `message_board -> messages`, `chat -> campfire`, `vault -> docs`, `schedule -> schedule`, `questionnaire -> checkins`), ocultando herramientas deshabilitadas (con fallback seguro a las 6 tarjetas si `enabled_tools` es `null`/vacío).
 *   - La tarjeta resumen de To-dos consulta TODAS las listas del proyecto (`bc_todolists`) mostrando cada lista con su punto de color real y sus primeras tareas pendientes.
 *   - El feed de actividad muestra los últimos 3 comentarios con hora en `America/Los_Angeles`, autor y enlace directo al ítem.
 *   - El mini-calendario resalta el día actual en `America/Los_Angeles` y los días con eventos (`all_day` sin desfase UTC + multi-día).
 * @dataFlow
 *   - Navegación a través de `navigateTo(params)` (incluyendo soporte directo para `replicateTodoId` y `replicateMessageId`).
 *   - Consulta `bc_comments`, `bc_todos`, `bc_todolists`, `bc_messages`, `bc_documents`, `bc_uploads`,
 *     `bc_campfire_lines`, `bc_schedule_entries`, `bc_memberships` y `bc_people`.
 * @notes
 *   - `supabase` está memoizado con `useMemo` para evitar ciclos infinitos de re-render y re-suscripción Realtime.
 *   - Limpia banners `<p data-teg-author=...>` y entidades HTML en las vistas previas, y usa clases Tailwind estándar.
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    Star, MessageSquare, ClipboardList, FolderOpen, Calendar, HelpCircle,
    Mail, Users, FileText, CheckSquare, ArrowLeft
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'
import { safeDecodeFilename, proxyBasecampUrl, isVideoMimeOrFilename } from '@/lib/basecamp-html'
import ToolMessages from '@/components/basecamp/ToolMessages'

// ───────── Avatar helpers ─────────
const AVATAR_COLORS = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#8E44AD', '#1ABC9C', '#D35400', '#2980B9', '#C0392B', '#16A085']
const getAvatarColor = (name: string) => {
    const clean = (name || '?').trim() || '?'
    let hash = 0
    for (let i = 0; i < clean.length; i++) hash = clean.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
const getInitials = (name: string) => {
    const clean = (name || '').trim()
    if (!clean) return '?'
    const parts = clean.split(/\s+/).filter(Boolean)
    return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : clean.slice(0, 2).toUpperCase()
}

const formatAbbreviatedAuthor = (rawName: string, fallback: string) => {
    const clean = (rawName || '').trim()
    if (!clean) return fallback
    const tokens = clean.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return fallback
    if (tokens.length === 1) return tokens[0]
    const lastInitial = tokens[tokens.length - 1][0]
    return lastInitial ? `${tokens[0]} ${lastInitial}.` : tokens[0]
}

const unwrapPersonName = (rel: any): string => {
    const obj = Array.isArray(rel) ? rel[0] : rel
    return typeof obj?.name === 'string' ? obj.name.trim() : ''
}

// ───────── Pacific Timezone Date Helpers ─────────
function getPacificParts(date: Date = new Date()): { year: number; month: number; day: number; ymd: string } {
    const ymd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date)
    const [y, m, d] = ymd.split('-').map(Number)
    return { year: y, month: m - 1, day: d, ymd }
}

function getEventYMD(isoStr?: string | null, allDay?: boolean): string | null {
    if (!isoStr) return null
    const str = String(isoStr)
    if (allDay) {
        const m = str.match(/^(\d{4}-\d{2}-\d{2})/)
        if (m) return m[1]
    }
    const d = new Date(str)
    if (Number.isNaN(d.getTime())) return null
    return getPacificParts(d).ymd
}

// ───────── Color Classes for project theming ─────────
const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string; dot: string; theme: string }> = {
    white: { border: 'border-slate-200 dark:border-slate-700', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-slate-400', theme: 'var(--recording-color-canvas)' },
    yellow: { border: 'border-yellow-300 dark:border-yellow-700', bg: 'bg-yellow-50/50 dark:bg-yellow-950/20', text: 'text-yellow-900 dark:text-yellow-100', dot: 'bg-yellow-500', theme: 'var(--recording-color-yellow)' },
    orange: { border: 'border-orange-300 dark:border-orange-700', bg: 'bg-orange-50/50 dark:bg-orange-950/20', text: 'text-orange-900 dark:text-orange-100', dot: 'bg-orange-500', theme: 'var(--recording-color-orange)' },
    red: { border: 'border-red-300 dark:border-red-700', bg: 'bg-red-50/50 dark:bg-red-950/20', text: 'text-red-900 dark:text-red-100', dot: 'bg-red-500', theme: 'var(--recording-color-red)' },
    pink: { border: 'border-pink-300 dark:border-pink-700', bg: 'bg-pink-50/50 dark:bg-pink-950/20', text: 'text-pink-900 dark:text-pink-100', dot: 'bg-pink-500', theme: 'var(--recording-color-pink)' },
    purple: { border: 'border-purple-300 dark:border-purple-700', bg: 'bg-purple-50/50 dark:bg-purple-950/20', text: 'text-purple-900 dark:text-purple-100', dot: 'bg-purple-500', theme: 'var(--recording-color-purple)' },
    blue: { border: 'border-blue-300 dark:border-blue-700', bg: 'bg-blue-50/50 dark:bg-blue-950/20', text: 'text-blue-900 dark:text-blue-100', dot: 'bg-blue-500', theme: 'var(--recording-color-blue)' },
    green: { border: 'border-green-300 dark:border-green-700', bg: 'bg-green-50/50 dark:bg-green-950/20', text: 'text-green-900 dark:text-green-100', dot: 'bg-green-500', theme: 'var(--recording-color-green)' },
    brown: { border: 'border-amber-600/30 dark:border-amber-700/50', bg: 'bg-amber-50/30 dark:bg-amber-950/10', text: 'text-amber-900 dark:text-amber-100', dot: 'bg-amber-600', theme: 'var(--recording-color-sand)' },
    gray: { border: 'border-gray-300 dark:border-gray-700', bg: 'bg-gray-50 dark:bg-gray-800/40', text: 'text-gray-800 dark:text-gray-200', dot: 'bg-gray-500', theme: 'var(--recording-color-primary)' },
}

// ───────── Mini Calendar Component ─────────
function MiniCalendar({ events, t: tFn }: { events: any[]; t: (key: string) => string }) {
    const { year, month, day: todayDate } = getPacificParts()

    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // Build set of days in the current Pacific month that have events (supporting all_day & multi-day spans)
    const eventDays = useMemo(() => {
        const days = new Set<number>()
        events.forEach((ev) => {
            const startYmd = getEventYMD(ev.starts_at, Boolean(ev.all_day))
            if (!startYmd) return
            const endYmdRaw = getEventYMD(ev.ends_at || ev.starts_at, Boolean(ev.all_day)) || startYmd
            const endYmd = endYmdRaw >= startYmd ? endYmdRaw : startYmd

            const [sy, sm, sd] = startYmd.split('-').map(Number)
            const [ey, em, ed] = endYmd.split('-').map(Number)
            const cursor = new Date(sy, sm - 1, sd, 12, 0, 0)
            const endDate = new Date(ey, em - 1, ed, 12, 0, 0)

            let guard = 0
            while (cursor.getTime() <= endDate.getTime() && guard < 62) {
                if (cursor.getFullYear() === year && cursor.getMonth() === month) {
                    days.add(cursor.getDate())
                }
                cursor.setDate(cursor.getDate() + 1)
                guard++
            }
        })
        return days
    }, [events, month, year])

    const weekdayKeys = [
        'basecamp.weekday_sun', 'basecamp.weekday_mon', 'basecamp.weekday_tue',
        'basecamp.weekday_wed', 'basecamp.weekday_thu', 'basecamp.weekday_fri', 'basecamp.weekday_sat',
    ]

    const cells: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)

    return (
        <div className="mt-1">
            <div className="grid grid-cols-7 gap-0 mb-1">
                {weekdayKeys.map((key) => (
                    <div key={key} className="text-[10px] font-black text-slate-400 dark:text-slate-500 text-center uppercase">
                        {tFn(key)}
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-0">
                {cells.map((day, idx) => {
                    if (day === null) {
                        return <div key={`empty-${idx}`} className="h-5" />
                    }
                    const isToday = day === todayDate
                    const hasEvent = eventDays.has(day)
                    return (
                        <div
                            key={day}
                            className={`h-5 flex items-center justify-center text-xs font-bold rounded-full
                                ${isToday ? 'bg-red-600 text-white font-black' : hasEvent ? 'text-red-600 font-black' : 'text-slate-500 dark:text-slate-400'}`}
                            style={isToday ? { width: '20px', height: '20px', margin: '0 auto' } : undefined}
                        >
                            {day}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ───────── Todolist Dot Colors & Enabled Dock Tool Mapping ─────────
const TODOLIST_DOT_CLASSES: Record<string, string> = {
    blue: 'bg-blue-500',
    orange: 'bg-orange-500',
    green: 'bg-emerald-500',
    red: 'bg-red-500',
    yellow: 'bg-amber-400',
    purple: 'bg-purple-500',
    pink: 'bg-pink-500',
    brown: 'bg-amber-700',
    gray: 'bg-slate-400',
    white: 'bg-emerald-500',
}

const getTodolistDotClass = (color?: string | null): string => {
    const key = String(color || '').toLowerCase().trim()
    return TODOLIST_DOT_CLASSES[key] || 'bg-emerald-500'
}

type ProjectToolKey = 'todos' | 'messages' | 'docs' | 'campfire' | 'schedule' | 'checkins'

const DOCK_NAME_TO_TOOL: Record<string, ProjectToolKey> = {
    todoset: 'todos',
    todos: 'todos',
    todo: 'todos',
    todolist: 'todos',
    todolists: 'todos',
    message_board: 'messages',
    'message-board': 'messages',
    messages: 'messages',
    message: 'messages',
    chat: 'campfire',
    chats: 'campfire',
    campfire: 'campfire',
    vault: 'docs',
    docs: 'docs',
    doc: 'docs',
    documents: 'docs',
    schedule: 'schedule',
    calendar: 'schedule',
    questionnaire: 'checkins',
    checkins: 'checkins',
    checkin: 'checkins',
}

const ALL_PROJECT_TOOLS: ProjectToolKey[] = ['todos', 'messages', 'docs', 'campfire', 'schedule', 'checkins']

// ───────── Types for enriched data ─────────
interface ActivityItem {
    id: string
    kind: 'comment' | 'todo_completed' | 'todo_created' | 'message_created'
    content: string
    created_at: string
    parent_type: string
    parent_id: string | null
    parent_title: string
    list_name?: string
    author_name: string
    images: string[]
}

interface TodoListSummary {
    id: string
    bc_id: number
    name: string
    color: string | null
    completedCount: number
    totalCount: number
    ratioLabel: string
    openCount: number
    tasks: any[]
}

interface BasecampProjectProps {
    project: any
    navigateTo: (params: {
        project?: string
        tool?: string
        section?: string
        todoId?: string
        replicateTodoId?: string
        messageId?: string
        replicateMessageId?: string
        docId?: string
    }) => void
    saveProjects: (projects: any[]) => void
    projects: any[]
    currentUserName: string
    selectedTodoId?: string
    selectedMessageId?: string
    replicateMessageId?: string
    onCloseDetail?: () => void
    onConsumeReplicateMessage?: () => void
    onOpenSearch?: () => void
}

export default function BasecampProject({
    project,
    navigateTo,
    saveProjects,
    projects,
    currentUserName,
    selectedTodoId,
    selectedMessageId,
    replicateMessageId,
    onCloseDetail,
    onConsumeReplicateMessage,
    onOpenSearch,
}: BasecampProjectProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'

    // Progreso de aguja (sin mocks iniciales)
    const [progressPercent, setProgressPercent] = useState(0)
    const [showNeedleModal, setShowNeedleModal] = useState(false)
    const [manualProgress, setManualProgress] = useState(0)

    // ───── Enriched state variables ─────
    const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([])
    const [activePeopleCount, setActivePeopleCount] = useState(0)
    const [activePeopleAvatars, setActivePeopleAvatars] = useState<string[]>([])

    // Tool card data & live enabled_tools
    const [todoListsSummary, setTodoListsSummary] = useState<TodoListSummary[]>([])
    const [liveEnabledTools, setLiveEnabledTools] = useState<string[] | null>(
        Array.isArray(project.enabled_tools) ? project.enabled_tools : null
    )
    const [lastMessages, setLastMessages] = useState<any[]>([])
    const [docsAndFiles, setDocsAndFiles] = useState<any[]>([])
    const [lastChat, setLastChat] = useState<any[]>([])
    const [calendarEvents, setCalendarEvents] = useState<any[]>([])
    const [projectMembers, setProjectMembers] = useState<any[]>([])
    const [latchedMessagesTool, setLatchedMessagesTool] = useState<boolean>(() => Boolean(replicateMessageId || selectedMessageId))

    useEffect(() => {
        if (replicateMessageId || selectedMessageId) {
            setLatchedMessagesTool(true)
        }
    }, [replicateMessageId, selectedMessageId])

    useEffect(() => {
        if (selectedTodoId) {
            navigateTo({ project: project.id, tool: 'todos', todoId: selectedTodoId })
        }
    }, [selectedTodoId, project.id, navigateTo])

    useEffect(() => {
        setLatchedMessagesTool(Boolean(replicateMessageId || selectedMessageId))
    }, [project.id, project.db_id, replicateMessageId, selectedMessageId])

    useEffect(() => {
        if (!showNeedleModal) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowNeedleModal(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [showNeedleModal])

    // ───── Data Fetching ─────
    useEffect(() => {
        let cancelled = false

        const fetchProjectDetails = async () => {
            if (!project.db_id) return

            try {
                const sevenDaysAgo = new Date()
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

                const { year: pYear, month: pMonth } = getPacificParts()
                const windowStart = new Date(Date.UTC(pYear, pMonth, -6, 0, 0, 0)).toISOString()
                const windowEnd = new Date(Date.UTC(pYear, pMonth + 1, 3, 23, 59, 59)).toISOString()

                const [
                    resProjectMeta,
                    resLists,
                    resComments,
                    resRecentTodos,
                    resActivePeople,
                    resMessages,
                    resDocs,
                    resUploads,
                    resChatLines,
                    resEvents,
                    resMembers,
                ] = await Promise.all([
                    supabase.from('bc_projects').select('enabled_tools').eq('id', project.db_id).maybeSingle(),
                    supabase
                        .from('bc_todolists')
                        .select('id, bc_id, name, color, position, completed_count, total_count, bc_completed_ratio')
                        .eq('project_id', project.db_id)
                        .order('position', { ascending: true })
                        .order('created_at', { ascending: true }),
                    supabase.from('bc_comments').select('id, content, created_at, parent_type, parent_id, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(15),
                    supabase.from('bc_todos').select('id, title, description, is_completed, completed_at, created_at, updated_at, todolist_id, creator:bc_people!bc_todos_created_by_person_id_fkey(name)').eq('project_id', project.db_id).order('updated_at', { ascending: false }).limit(12),
                    supabase.from('bc_comments').select('author_person_id, author:bc_people(name)').eq('project_id', project.db_id).gte('created_at', sevenDaysAgo.toISOString()),
                    supabase.from('bc_messages').select('id, title, content, category, is_pinned, created_at, author:bc_people(name)').eq('project_id', project.db_id).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(8),
                    supabase.from('bc_documents').select('id, title, created_at, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    supabase.from('bc_uploads').select('id, filename, content_type, byte_size, created_at, author:bc_people(name), download_url').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    supabase.from('bc_campfire_lines').select('id, content, created_at, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    supabase
                        .from('bc_schedule_entries')
                        .select('id, title, starts_at, ends_at, all_day')
                        .eq('project_id', project.db_id)
                        .or(`and(starts_at.gte.${windowStart},starts_at.lt.${windowEnd}),and(ends_at.gte.${windowStart},starts_at.lt.${windowEnd})`)
                        .order('starts_at', { ascending: true }),
                    supabase.from('bc_memberships').select('person:bc_people(id, name, role)').eq('project_id', project.db_id),
                ])

                if (cancelled) return

                if (Array.isArray(resProjectMeta.data?.enabled_tools)) {
                    setLiveEnabledTools(resProjectMeta.data.enabled_tools)
                } else {
                    setLiveEnabledTools(Array.isArray(project.enabled_tools) ? project.enabled_tools : null)
                }

                // 1. Process Progress (prefers bc_completed_ratio when available; guarded against 0/0, NaN, Infinity)
                let totalCompleted = 0
                let totalTasks = 0
                if (resLists.data && resLists.data.length > 0) {
                    resLists.data.forEach((l: any) => {
                        const ratioMatch =
                            typeof l.bc_completed_ratio === 'string'
                                ? l.bc_completed_ratio.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
                                : null
                        if (ratioMatch) {
                            totalCompleted += Number(ratioMatch[1]) || 0
                            totalTasks += Number(ratioMatch[2]) || 0
                        } else {
                            totalCompleted += Number(l.completed_count) || 0
                            totalTasks += Number(l.total_count) || 0
                        }
                    })
                }
                const rawPct = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0
                const safePct = Number.isFinite(rawPct) ? Math.min(100, Math.max(0, rawPct)) : 0
                setProgressPercent(safePct)
                setManualProgress(safePct)

                const extractPreviewImages = (rawHtml?: string | null): string[] => {
                    if (!rawHtml) return []
                    const withoutVideoBcAtt = rawHtml.replace(
                        /<bc-attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi,
                        (full, attrs: string) => {
                            const ct = (attrs.match(/\bcontent-type=["']([^"']+)["']/i)?.[1] || '').trim()
                            const fn = (attrs.match(/\bfilename=["']([^"']+)["']/i)?.[1] || '').trim()
                            const rawUrl = (
                                attrs.match(/\burl=["']([^"']+)["']/i)?.[1] ||
                                attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] ||
                                ''
                            ).trim()
                            if (isVideoMimeOrFilename(ct, fn, rawUrl)) return ' '
                            return full
                        }
                    )
                    const imgs: string[] = []
                    const seenImgs = new Set<string>()
                    const rx = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
                    let im: RegExpExecArray | null
                    while ((im = rx.exec(withoutVideoBcAtt)) !== null) {
                        const tag = im[0]
                        if (
                            /\bclass=["'][^"']*\bavatar\b/i.test(tag) ||
                            /\bdata-avatar-for-person-id=/i.test(tag) ||
                            /\bdata-bc-avatar=/i.test(tag)
                        ) {
                            continue
                        }
                        const src = im[1]
                        if (!src || src.includes('attachment-icon')) continue
                        const altVal = tag.match(/\balt=["']([^"']+)["']/i)?.[1] || ''
                        if (isVideoMimeOrFilename(null, altVal, src)) continue
                        const proxied = proxyBasecampUrl(src)
                        if (proxied && !seenImgs.has(proxied)) {
                            seenImgs.add(proxied)
                            imgs.push(proxied)
                            if (imgs.length >= 3) break
                        }
                    }
                    return imgs
                }

                // 2. Build Rich Latest Activity Timeline (Comments + Todos + Messages)
                const listNameById = new Map<string, string>()
                ;(resLists.data || []).forEach((l: any) => {
                    if (l.id && l.name) listNameById.set(l.id, l.name)
                })

                const commentRows = resComments.data || []
                const todoParentIds = Array.from(new Set(commentRows.filter((c: any) => c.parent_type === 'todo' && c.parent_id).map((c: any) => c.parent_id)))
                const msgParentIds = Array.from(new Set(commentRows.filter((c: any) => c.parent_type === 'message' && c.parent_id).map((c: any) => c.parent_id)))
                const docParentIds = Array.from(new Set(commentRows.filter((c: any) => c.parent_type === 'document' && c.parent_id).map((c: any) => c.parent_id)))

                const [todoTitlesRes, msgTitlesRes, docTitlesRes] = await Promise.all([
                    todoParentIds.length > 0 ? supabase.from('bc_todos').select('id, title').in('id', todoParentIds) : Promise.resolve({ data: [] as any[] }),
                    msgParentIds.length > 0 ? supabase.from('bc_messages').select('id, title').in('id', msgParentIds) : Promise.resolve({ data: [] as any[] }),
                    docParentIds.length > 0 ? supabase.from('bc_documents').select('id, title').in('id', docParentIds) : Promise.resolve({ data: [] as any[] }),
                ])

                const parentTitleMap = new Map<string, string>()
                ;(todoTitlesRes.data || []).forEach((r: any) => parentTitleMap.set(`todo:${r.id}`, r.title || ''))
                ;(msgTitlesRes.data || []).forEach((r: any) => parentTitleMap.set(`message:${r.id}`, r.title || ''))
                ;(docTitlesRes.data || []).forEach((r: any) => parentTitleMap.set(`document:${r.id}`, r.title || ''))

                const timelinePool: ActivityItem[] = []

                commentRows.forEach((c: any) => {
                    const pType = c.parent_type || 'todo'
                    timelinePool.push({
                        id: `comment-${c.id}`,
                        kind: 'comment',
                        content: c.content || '',
                        created_at: c.created_at,
                        parent_type: pType,
                        parent_id: c.parent_id || null,
                        parent_title: (c.parent_id ? parentTitleMap.get(`${pType}:${c.parent_id}`) : '') || '',
                        author_name: unwrapPersonName(c.author),
                        images: extractPreviewImages(c.content),
                    })
                })

                ;(resRecentTodos.data || []).forEach((td: any) => {
                    const eventTs = td.is_completed ? (td.completed_at || td.updated_at || td.created_at) : td.created_at
                    if (!eventTs) return
                    timelinePool.push({
                        id: `todo-${td.id}-${td.is_completed ? 'done' : 'new'}`,
                        kind: td.is_completed ? 'todo_completed' : 'todo_created',
                        content: td.description || '',
                        created_at: eventTs,
                        parent_type: 'todo',
                        parent_id: td.id,
                        parent_title: td.title || '',
                        list_name: td.todolist_id ? listNameById.get(td.todolist_id) : undefined,
                        author_name: unwrapPersonName(td.creator),
                        images: extractPreviewImages(td.description),
                    })
                })

                ;(resMessages.data || []).forEach((m: any) => {
                    if (!m.created_at) return
                    timelinePool.push({
                        id: `msg-${m.id}`,
                        kind: 'message_created',
                        content: m.content || '',
                        created_at: m.created_at,
                        parent_type: 'message',
                        parent_id: m.id,
                        parent_title: m.title || '',
                        author_name: unwrapPersonName(m.author),
                        images: extractPreviewImages(m.content),
                    })
                })

                timelinePool.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                if (!cancelled) {
                    setRecentActivity(timelinePool.slice(0, 20))
                }

                // 3. Process Active People Count
                if (resActivePeople.data) {
                    const uniqueAuthors = new Map<string, string>()
                    resActivePeople.data.forEach((ap: any) => {
                        if (ap.author_person_id && !uniqueAuthors.has(ap.author_person_id)) {
                            uniqueAuthors.set(ap.author_person_id, unwrapPersonName(ap.author) || 'U')
                        }
                    })
                    setActivePeopleCount(uniqueAuthors.size)
                    setActivePeopleAvatars(Array.from(uniqueAuthors.values()).slice(0, 8))
                } else {
                    setActivePeopleCount(0)
                    setActivePeopleAvatars([])
                }

                // 4. Process ALL Todolists in the project with real colors & pending tasks
                if (resLists.data && resLists.data.length > 0) {
                    const summaries = await Promise.all(
                        resLists.data.map(async (l: any): Promise<TodoListSummary> => {
                            const ratioMatch =
                                typeof l.bc_completed_ratio === 'string'
                                    ? l.bc_completed_ratio.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
                                    : null
                            const completedCount = ratioMatch ? Number(ratioMatch[1]) || 0 : Number(l.completed_count) || 0
                            const totalCount = ratioMatch ? Number(ratioMatch[2]) || 0 : Number(l.total_count) || 0
                            const ratioLabel =
                                typeof l.bc_completed_ratio === 'string' && l.bc_completed_ratio.trim()
                                    ? l.bc_completed_ratio.trim()
                                    : `${completedCount}/${totalCount}`

                            const { data: listTasks, count: openExactCount } = await supabase
                                .from('bc_todos')
                                .select('id, title, is_completed, due_date, starts_on, position, created_at', { count: 'exact' })
                                .eq('todolist_id', l.id)
                                .eq('is_completed', false)
                                .order('position', { ascending: true })
                                .order('created_at', { ascending: true })
                                .limit(4)

                            const tasksArr = listTasks || []
                            const openCount = typeof openExactCount === 'number' ? openExactCount : tasksArr.length

                            return {
                                id: l.id,
                                bc_id: Number(l.bc_id) || 0,
                                name: l.name || '',
                                color: l.color || null,
                                completedCount,
                                totalCount,
                                ratioLabel,
                                openCount,
                                tasks: tasksArr,
                            }
                        })
                    )
                    summaries.sort((a, b) => {
                        const aHasOpen = a.openCount > 0 ? 0 : 1
                        const bHasOpen = b.openCount > 0 ? 0 : 1
                        return aHasOpen - bHasOpen
                    })
                    if (!cancelled) {
                        setTodoListsSummary(summaries)
                    }
                } else {
                    setTodoListsSummary([])
                }

                // 5. Process Messages
                if (resMessages.data) {
                    setLastMessages(
                        resMessages.data.map((m: any) => ({
                            id: m.id,
                            title: m.title,
                            content: m.content,
                            category: m.category || null,
                            is_pinned: Boolean(m.is_pinned),
                            created_at: m.created_at,
                            author: unwrapPersonName(m.author),
                        }))
                    )
                } else {
                    setLastMessages([])
                }

                // 6 & 7. Process Docs & Uploads
                const allDocsFiles: any[] = []
                if (resDocs.data) {
                    resDocs.data.forEach((d: any) => {
                        allDocsFiles.push({
                            id: d.id,
                            title: d.title,
                            created_at: d.created_at,
                            author: unwrapPersonName(d.author),
                            file_type: 'doc',
                        })
                    })
                }
                if (resUploads.data) {
                    resUploads.data.forEach((u: any) => {
                        const isGoogle =
                            u.download_url?.includes('docs.google.com') ||
                            u.download_url?.includes('drive.google.com') ||
                            u.content_type?.endsWith('.document') ||
                            u.content_type?.endsWith('.spreadsheet')
                        const decodedName = safeDecodeFilename(u.filename, '')
                        const ext = (decodedName.includes('.') ? decodedName.split('.').pop()?.toLowerCase() : '') || ''
                        let fileType = 'file'
                        if (isGoogle) fileType = 'google_doc'
                        else if (ext === 'pdf') fileType = 'pdf'
                        else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) fileType = 'screenshot'

                        allDocsFiles.push({
                            id: u.id,
                            title: decodedName,
                            created_at: u.created_at,
                            author: unwrapPersonName(u.author),
                            file_type: fileType,
                        })
                    })
                }
                allDocsFiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                setDocsAndFiles(allDocsFiles.slice(0, 7))

                // 8. Process Campfire Lines
                if (resChatLines.data) {
                    const mappedChat = resChatLines.data
                        .map((c: any) => ({
                            id: c.id,
                            author: unwrapPersonName(c.author),
                            message: c.content,
                            created_at: c.created_at,
                        }))
                        .reverse()
                    setLastChat(mappedChat)
                } else {
                    setLastChat([])
                }

                // 9. Process Calendar Events
                setCalendarEvents(resEvents.data || [])

                // 10. Process Members
                if (resMembers.data) {
                    const seenIds = new Set<string>()
                    const mappedMembers: any[] = []
                    resMembers.data.forEach((m: any) => {
                        const p = Array.isArray(m.person) ? m.person[0] : m.person
                        if (!p) return
                        const key = p.id || p.name
                        if (key && seenIds.has(key)) return
                        if (key) seenIds.add(key)
                        mappedMembers.push({
                            id: p.id,
                            name: typeof p.name === 'string' ? p.name.trim() : '',
                            role: p.role || 'user',
                        })
                    })
                    setProjectMembers(mappedMembers)
                } else {
                    setProjectMembers([])
                }
            } catch (err: any) {
                console.error('Error loading project dashboard:', err.message)
            }
        }

        fetchProjectDetails()

        if (!project.db_id) return () => { cancelled = true }
        const channel = supabase
            .channel(`bc_project_dashboard_${project.db_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_projects', filter: `id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_todolists', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_todos', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_messages', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_comments', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_documents', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_uploads', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_campfire_lines', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_schedule_entries', filter: `project_id=eq.${project.db_id}` }, () => fetchProjectDetails())
            .subscribe()

        return () => {
            cancelled = true
            supabase.removeChannel(channel)
        }
    }, [project.id, project.db_id])

    // ───── Handlers ─────
    const handleUpdateNeedle = (e: React.FormEvent) => {
        e.preventDefault()
        const clamped = Number.isFinite(manualProgress) ? Math.min(100, Math.max(0, manualProgress)) : 0
        setProgressPercent(clamped)
        setShowNeedleModal(false)
    }

    const togglePin = () => {
        const updated = projects.map((p) => (p.id === project.id ? { ...p, is_pinned: !p.is_pinned } : p))
        saveProjects(updated)
    }

    // Format time for activity feed (America/Los_Angeles)
    const formatActivityTime = (dateStr: string) => {
        const d = new Date(dateStr)
        if (Number.isNaN(d.getTime())) return ''
        return d
            .toLocaleTimeString(locale, {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/Los_Angeles',
            })
            .toLowerCase()
    }

    // Format date for card previews (America/Los_Angeles, or pure YYYY-MM-DD for all_day)
    const formatShortDate = (dateStr: string, allDay?: boolean) => {
        if (!dateStr) return ''
        if (allDay) {
            const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/)
            if (m) {
                const localNoon = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
                return localNoon.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
            }
        }
        const d = new Date(dateStr)
        if (Number.isNaN(d.getTime())) return ''
        return d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            timeZone: 'America/Los_Angeles',
        })
    }

    // Strip TEG author banner, preserve @mentions, strip <bc-attachment> blocks, HTML tags, and decode entities
    const stripHtml = (html?: string | null) => {
        if (!html) return ''
        const { cleanHtml } = stripTegAuthorBanner(html)
        const withMentions = cleanHtml
            .replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (_m, attrs: string, inner: string) => {
                if (
                    !/content-type=["']application\/vnd\.basecamp\.mention["']/i.test(attrs) &&
                    !/data-teg-mention-person-id=/i.test(attrs)
                ) {
                    return ' '
                }
                const figMatch = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
                const altMatch = inner.match(/\balt=["']([^"']+)["']/i)
                const contentAttr = attrs.match(/\bcontent=["']([^"']+)["']/i)
                let name = ''
                if (figMatch?.[1]) name = figMatch[1].replace(/<[^>]*>/g, '').trim()
                else if (altMatch?.[1]) name = altMatch[1].trim()
                else if (contentAttr?.[1]) {
                    name = contentAttr[1]
                        .replace(/&lt;/gi, '<')
                        .replace(/&gt;/gi, '>')
                        .replace(/&quot;/gi, '"')
                        .replace(/&amp;/gi, '&')
                        .replace(/<[^>]*>/g, '')
                        .trim()
                } else {
                    name = inner.replace(/<[^>]*>/g, '').trim()
                }
                const cleanName = name.replace(/^@+/, '').trim()
                return cleanName ? ` @${cleanName} ` : ' '
            })
            .replace(/<span\b[^>]*\bdata-teg-mention-person-id=["'][^"']+["'][^>]*>([\s\S]*?)<\/span>/gi, (_m, inner: string) => {
                const cleanName = inner.replace(/<[^>]*>/g, '').replace(/^@+/, '').trim()
                return cleanName ? ` @${cleanName} ` : ' '
            })
        return withMentions
            .replace(/<bc-attachment[\s\S]*?<\/bc-attachment>/gi, ' ')
            .replace(/<bc-attachment\b[^>]*\/>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .trim()
    }

    const visibleTools = useMemo<ProjectToolKey[]>(() => {
        const rawTools =
            Array.isArray(liveEnabledTools) && liveEnabledTools.length > 0
                ? liveEnabledTools
                : Array.isArray(project.enabled_tools) && project.enabled_tools.length > 0
                    ? project.enabled_tools
                    : null
        if (!rawTools || rawTools.length === 0) {
            return ALL_PROJECT_TOOLS
        }
        const mapped: ProjectToolKey[] = []
        const seen = new Set<ProjectToolKey>()
        for (const raw of rawTools) {
            const key = DOCK_NAME_TO_TOOL[String(raw || '').toLowerCase().trim()]
            if (key && !seen.has(key)) {
                seen.add(key)
                mapped.push(key)
            }
        }
        return mapped.length > 0 ? mapped : ALL_PROJECT_TOOLS
    }, [liveEnabledTools, project.enabled_tools])

    const groupedActivityByDay = useMemo(() => {
        const todayYmd = getPacificParts().ymd
        const yestDate = new Date()
        yestDate.setDate(yestDate.getDate() - 1)
        const yesterdayYmd = getPacificParts(yestDate).ymd

        const groups: Array<{ dayKey: string; dayLabel: string; items: ActivityItem[] }> = []
        const map = new Map<string, ActivityItem[]>()

        recentActivity.forEach((act) => {
            const d = new Date(act.created_at)
            if (Number.isNaN(d.getTime())) return
            const ymd = getPacificParts(d).ymd
            if (!map.has(ymd)) {
                const itemsArr: ActivityItem[] = []
                map.set(ymd, itemsArr)
                const fullLabel = d.toLocaleDateString(locale, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'America/Los_Angeles',
                })
                const dayLabel =
                    ymd === todayYmd
                        ? `${t('basecamp.feed_today')} — ${fullLabel}`
                        : ymd === yesterdayYmd
                            ? `${t('basecamp.feed_yesterday')} — ${fullLabel}`
                            : fullLabel
                groups.push({ dayKey: ymd, dayLabel, items: itemsArr })
            }
            map.get(ymd)!.push(act)
        })

        return groups
    }, [recentActivity, locale, t])

    const navigateToActivityTarget = (act: ActivityItem) => {
        const pType = act.parent_type?.toLowerCase()
        let tool = ''
        if (pType?.includes('todo')) tool = 'todos'
        else if (pType?.includes('message') || pType?.includes('board')) tool = 'messages'
        else if (pType?.includes('document') || pType?.includes('doc') || pType?.includes('file')) tool = 'docs'
        else if (pType?.includes('chat') || pType?.includes('campfire')) tool = 'campfire'
        else if (pType?.includes('schedule') || pType?.includes('event') || pType?.includes('calendar')) tool = 'schedule'
        else if (pType?.includes('checkin') || pType?.includes('question')) tool = 'checkins'

        if (tool) {
            const navParams: {
                project: string
                tool: string
                todoId?: string
                replicateTodoId?: string
                messageId?: string
                replicateMessageId?: string
                docId?: string
            } = { project: project.id, tool }
            if (act.parent_id) {
                if (tool === 'todos') navParams.todoId = act.parent_id
                else if (tool === 'messages') navParams.messageId = act.parent_id
                else if (tool === 'docs') navParams.docId = act.parent_id
            }
            navigateTo(navParams)
        }
    }

    // Needle rotation: 0% = -90deg, 100% = +90deg
    const safeProgress = Number.isFinite(progressPercent) ? Math.min(100, Math.max(0, progressPercent)) : 0
    const needleRotationAngle = -90 + (safeProgress / 100) * 180

    const _colorStyles = COLOR_CLASSES[project.color] || COLOR_CLASSES.white
    void _colorStyles

    const membersToShow = projectMembers.length > 0 ? projectMembers : (project.people || [])
    const memberCount = membersToShow.length

    const getFileTypeIcon = (fileType: string) => {
        switch (fileType) {
            case 'google_doc': return { color: '#34A853', label: t('basecamp.google_doc') }
            case 'pdf': return { color: '#EA4335', label: t('basecamp.pdf_file') }
            case 'screenshot': return { color: '#4285F4', label: t('basecamp.screenshot_file') }
            case 'doc': return { color: '#4285F4', label: t('basecamp.doc_file_label') }
            default: return { color: '#6B7B8D', label: t('basecamp.generic_file_label') }
        }
    }

    const hintShortParts = t('basecamp.search_jump_hint_short').split('Shift + J')

    if (replicateMessageId || selectedMessageId || latchedMessagesTool) {
        return (
            <div className="flex-1 flex flex-col gap-3">
                <div>
                    <button
                        type="button"
                        onClick={() => {
                            setLatchedMessagesTool(false)
                            navigateTo({ project: project.id })
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#1D7DB5] dark:text-slate-400 dark:hover:text-sky-300 cursor-pointer"
                    >
                        <ArrowLeft size={13} />
                        <span>{project.name}</span>
                    </button>
                </div>
                <ToolMessages
                    project={project}
                    currentUserName={currentUserName}
                    selectedMessageId={selectedMessageId}
                    replicateMessageId={replicateMessageId}
                    onCloseDetail={onCloseDetail}
                    onConsumeReplicateMessage={onConsumeReplicateMessage}
                />
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col gap-6">
            {/* ════════════════════════════════════════════════
                SECTION 1: PROJECT HEADER
            ════════════════════════════════════════════════ */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <button
                            onClick={() => navigateTo({})}
                            className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold"
                        >
                            {t('basecamp.home')}
                        </button>
                        <span className="text-slate-300">/</span>
                        <span className="text-sm text-slate-400 font-bold uppercase tracking-wider">{project.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
                            {project.name}
                        </h1>
                        <button
                            onClick={togglePin}
                            className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 ${
                                project.is_pinned ? 'text-amber-500' : 'text-slate-400'
                            }`}
                            title={project.is_pinned ? t('basecamp.unstar_project') : t('basecamp.star_project')}
                        >
                            <Star size={16} fill={project.is_pinned ? 'currentColor' : 'none'} />
                        </button>
                    </div>
                </div>

                <div className="flex flex-col md:items-end gap-2.5">
                    <div className="flex items-center gap-4">
                        <div className="flex -space-x-2">
                            {membersToShow.slice(0, 5).map((m: any, idx: number) => {
                                const mName = m?.name || t('basecamp.unknown_user')
                                return (
                                    <div
                                        key={m?.id || idx}
                                        className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[10px] font-black text-white"
                                        style={{ backgroundColor: getAvatarColor(mName) }}
                                        title={mName}
                                    >
                                        {getInitials(mName)}
                                    </div>
                                )
                            })}
                            {memberCount > 5 && (
                                <div className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                    +{memberCount - 5}
                                </div>
                            )}
                        </div>
                        <button
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300 text-xs font-bold opacity-50 cursor-not-allowed"
                            title={t('basecamp.invite_coming_soon')}
                            disabled
                        >
                            <Users size={14} />
                            {t('basecamp.invite')}
                        </button>
                    </div>
                    {onOpenSearch && (
                        <div
                            onClick={onOpenSearch}
                            className="border border-slate-200/60 dark:border-slate-800 bg-[#fffdf9] dark:bg-slate-900 px-3 py-1 rounded-lg text-[11px] font-semibold text-slate-500 dark:text-slate-400 shadow-inner cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all flex items-center gap-1.5"
                        >
                            {hintShortParts.length > 1 ? (
                                <span>
                                    {hintShortParts[0]}
                                    <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[9px] mx-0.5 font-bold">Shift</kbd> + <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[9px] mx-0.5 font-bold">J</kbd>
                                    {hintShortParts[1]}
                                </span>
                            ) : (
                                <span>{t('basecamp.search_jump_hint_short')}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ════════════════════════════════════════════════
                SECTION 2: COMPACT PROGRESS BAR & ACTIVE TEAM SUMMARY
            ════════════════════════════════════════════════ */}
            {visibleTools.includes('todos') && (
                <div className="bg-[#fcfaf6] dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-800/60 px-5 py-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="relative w-[88px] h-[44px] overflow-hidden select-none shrink-0">
                            <svg className="absolute w-[88px] h-[44px] top-0 overflow-visible" viewBox="0 0 200 100">
                                <path
                                    d="M 10 100 A 90 90 0 0 1 190 100"
                                    fill="none"
                                    stroke="#e2e8f0"
                                    strokeWidth="12"
                                    className="dark:stroke-slate-700"
                                />
                                <path
                                    d="M 10 100 A 90 90 0 0 1 190 100"
                                    fill="none"
                                    stroke="#4BAE4F"
                                    strokeWidth="12"
                                    strokeDasharray="282"
                                    strokeDashoffset={282 - (safeProgress / 100) * 282}
                                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                                />
                            </svg>
                            <div
                                className="absolute bottom-1 left-[42px] w-1 h-8 bg-slate-800 dark:bg-slate-200 origin-bottom rounded-t-full z-10 transition-transform duration-500 ease-out"
                                style={{ transform: `rotate(${needleRotationAngle}deg)` }}
                            />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-lg font-black text-slate-800 dark:text-slate-100">{safeProgress}%</span>
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t('basecamp.project_progress')}</span>
                            </div>
                            <button
                                onClick={() => setShowNeedleModal(true)}
                                className="text-[10px] font-black uppercase text-[#1D7DB5] hover:underline"
                            >
                                {t('basecamp.move_needle')}
                            </button>
                        </div>
                    </div>

                    {activePeopleCount > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex -space-x-1">
                                {activePeopleAvatars.slice(0, 6).map((name, idx) => (
                                    <div
                                        key={idx}
                                        className="w-6 h-6 rounded-full border border-white dark:border-slate-800 flex items-center justify-center text-[8px] font-black text-white"
                                        style={{ backgroundColor: getAvatarColor(name) }}
                                        title={name}
                                    >
                                        {getInitials(name)}
                                    </div>
                                ))}
                            </div>
                            {activePeopleCount > 6 && (
                                <span className="text-[10px] font-bold text-slate-500">+{activePeopleCount - 6}</span>
                            )}
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                {activePeopleCount} {t('basecamp.people_active_last_7_days')}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* ════════════════════════════════════════════════
                SECTION 4: TOOL CARDS GRID (filtered & ordered by Basecamp 3 enabled_tools)
            ════════════════════════════════════════════════ */}
            <div
                className={`grid gap-6 ${
                    visibleTools.length === 1
                        ? 'grid-cols-1 max-w-2xl mx-auto w-full'
                        : visibleTools.length === 2
                            ? 'grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto w-full'
                            : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                }`}
            >
                {visibleTools.map((toolKey) => {
                    switch (toolKey) {
                        case 'todos':
                            return (
                                <div
                                    key="tool-todos"
                                    onClick={() => navigateTo({ project: project.id, tool: 'todos' })}
                                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                                >
                                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                                            <ClipboardList size={18} />
                                            {t('basecamp.todos')}
                                        </h2>
                                    </div>

                                    {todoListsSummary.length > 0 ? (
                                        <div className="flex-1 space-y-4">
                                            {todoListsSummary.map((list) => (
                                                <div
                                                    key={list.id}
                                                    className="border-b border-slate-100 dark:border-slate-800/60 pb-3 last:border-b-0 last:pb-0"
                                                >
                                                    <div className="flex items-center justify-between gap-2 mb-2">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span
                                                                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getTodolistDotClass(list.color)}`}
                                                            />
                                                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 truncate">
                                                                {list.name || t('basecamp.todos')}
                                                            </span>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex-shrink-0">
                                                            {list.ratioLabel}
                                                        </span>
                                                    </div>

                                                    {list.tasks.length > 0 ? (
                                                        <div className="space-y-1.5 pl-1">
                                                            {list.tasks.map((todo: any) => (
                                                                <div
                                                                    key={todo.id}
                                                                    onClick={(ev) => {
                                                                        ev.stopPropagation()
                                                                        navigateTo({ project: project.id, tool: 'todos', todoId: todo.id })
                                                                    }}
                                                                    className="flex items-center gap-2 text-sm group/todo hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded px-1 py-0.5 -mx-1 transition-colors"
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={Boolean(todo.is_completed)}
                                                                        readOnly
                                                                        className="rounded text-green-600 focus:ring-green-500 w-3.5 h-3.5 flex-shrink-0 pointer-events-none"
                                                                    />
                                                                    <span
                                                                        className={`truncate flex-1 group-hover/todo:text-[#1D7DB5] ${
                                                                            todo.is_completed
                                                                                ? 'line-through text-slate-400 dark:text-slate-600'
                                                                                : 'text-slate-700 dark:text-slate-300'
                                                                        }`}
                                                                    >
                                                                        {todo.title}
                                                                    </span>
                                                                    {(todo.due_date || todo.created_at) && (
                                                                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0">
                                                                            {todo.due_date
                                                                                ? formatShortDate(todo.due_date, true)
                                                                                : formatShortDate(todo.created_at)}
                                                                        </span>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={(ev) => {
                                                                            ev.stopPropagation()
                                                                            navigateTo({
                                                                                project: project.id,
                                                                                tool: 'todos',
                                                                                replicateTodoId: todo.id,
                                                                            })
                                                                        }}
                                                                        title={t('basecamp.replicate_task_tooltip')}
                                                                        className="opacity-0 group-hover/todo:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 hover:bg-[#1D7DB5] hover:text-white text-[#1D7DB5] dark:text-blue-300 text-[10px] font-extrabold flex-shrink-0 cursor-pointer"
                                                                    >
                                                                        <span>📋</span>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                            {list.openCount > list.tasks.length && (
                                                                <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 pl-5 pt-0.5">
                                                                    +{list.openCount - list.tasks.length} {t('basecamp.more_todos')}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs text-slate-400 dark:text-slate-500 italic pl-4">
                                                            ✓ {t('basecamp.no_open_todos')}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-4 text-center flex-1">
                                            {t('basecamp.no_todos')}
                                        </p>
                                    )}
                                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">
                                        {t('basecamp.manage_tasks')} →
                                    </span>
                                </div>
                            )

                        case 'messages':
                            return (
                                <div
                                    key="tool-messages"
                                    onClick={() => navigateTo({ project: project.id, tool: 'messages' })}
                                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                                >
                                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                                            <Mail size={18} />
                                            {t('basecamp.message_board')}
                                        </h2>
                                    </div>

                                    <div className="space-y-3.5 flex-1">
                                        {lastMessages.length > 0 ? (
                                            lastMessages.slice(0, 3).map((msg) => {
                                                const msgAuthor = msg.author || t('basecamp.unknown_user')
                                                return (
                                                    <div
                                                        key={msg.id}
                                                        onClick={(ev) => {
                                                            ev.stopPropagation()
                                                            navigateTo({ project: project.id, tool: 'messages', messageId: msg.id })
                                                        }}
                                                        className="group/msg flex items-start gap-3 border-b border-slate-100 dark:border-slate-800/30 pb-3 last:border-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-lg px-1 -mx-1 transition-colors"
                                                    >
                                                        <div
                                                            className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 mt-0.5 shadow-sm"
                                                            style={{ backgroundColor: getAvatarColor(msgAuthor) }}
                                                        >
                                                            {getInitials(msgAuthor)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-1.5">
                                                                <div className="flex items-baseline gap-1.5 min-w-0">
                                                                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400 truncate">
                                                                        {msgAuthor}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400 shrink-0">
                                                                        {formatShortDate(msg.created_at)}
                                                                    </span>
                                                                    {msg.is_pinned && (
                                                                        <span className="text-[10px]" title={t('basecamp.pinned_badge')}>📌</span>
                                                                    )}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={(ev) => {
                                                                        ev.stopPropagation()
                                                                        navigateTo({
                                                                            project: project.id,
                                                                            tool: 'messages',
                                                                            replicateMessageId: msg.id,
                                                                        })
                                                                    }}
                                                                    title={t('basecamp.replicate_message_tooltip')}
                                                                    className="opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 hover:bg-[#1D7DB5] hover:text-white text-[#1D7DB5] dark:text-blue-300 text-[10px] font-extrabold flex-shrink-0 cursor-pointer"
                                                                >
                                                                    <span>📋</span>
                                                                </button>
                                                            </div>
                                                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover/msg:text-[#1D7DB5] truncate leading-snug">
                                                                {msg.title}
                                                            </p>
                                                            <p className="text-xs text-slate-500 dark:text-slate-500 line-clamp-2 leading-relaxed">
                                                                {stripHtml(msg.content).slice(0, 120)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                                {t('basecamp.no_messages')}
                                            </p>
                                        )}
                                    </div>
                                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">
                                        {t('basecamp.view_board')} →
                                    </span>
                                </div>
                            )

                        case 'docs':
                            return (
                                <div
                                    key="tool-docs"
                                    onClick={() => navigateTo({ project: project.id, tool: 'docs' })}
                                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                                >
                                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                                            <FolderOpen size={18} />
                                            {t('basecamp.docs_files')}
                                        </h2>
                                    </div>

                                    <div className="space-y-2.5 flex-1">
                                        {docsAndFiles.length > 0 ? (
                                            docsAndFiles.slice(0, 5).map((doc) => {
                                                const typeInfo = getFileTypeIcon(doc.file_type)
                                                const docAuthor =
                                                    (doc.author || t('basecamp.unknown_user')).trim().split(/\s+/)[0] ||
                                                    t('basecamp.unknown_user')
                                                return (
                                                    <div key={doc.id} className="flex items-center gap-2.5 text-sm">
                                                        <div
                                                            className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 shadow-sm"
                                                            style={{ backgroundColor: typeInfo.color + '18' }}
                                                        >
                                                            <FileText size={14} style={{ color: typeInfo.color }} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate leading-none mb-0.5">
                                                                {doc.title || t('basecamp.attached_file_fallback')}
                                                            </p>
                                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                                                                {typeInfo.label} • {docAuthor} • {formatShortDate(doc.created_at)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                                {t('basecamp.no_docs')}
                                            </p>
                                        )}
                                    </div>
                                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">
                                        {t('basecamp.explore_docs')} →
                                    </span>
                                </div>
                            )

                        case 'campfire':
                            return (
                                <div
                                    key="tool-campfire"
                                    onClick={() => navigateTo({ project: project.id, tool: 'campfire' })}
                                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                                >
                                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                                            <MessageSquare size={18} />
                                            {t('basecamp.campfire')}
                                        </h2>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        {lastChat && lastChat.length > 0 ? (
                                            lastChat.slice(0, 4).map((line: any) => {
                                                const chatAuthor = line.author || t('basecamp.unknown_user')
                                                const previewText =
                                                    stripHtml(line.message || line.content).slice(0, 80) ||
                                                    `📎 ${t('basecamp.attached_file_fallback')}`
                                                return (
                                                    <div key={line.id} className="flex items-start gap-2 text-sm">
                                                        <div
                                                            className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black text-white flex-shrink-0 mt-0.5"
                                                            style={{ backgroundColor: getAvatarColor(chatAuthor) }}
                                                        >
                                                            {getInitials(chatAuthor)}
                                                        </div>
                                                        <p className="text-slate-600 dark:text-slate-400 line-clamp-1 flex-1">
                                                            {previewText}
                                                        </p>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                                {t('basecamp.no_chat')}
                                            </p>
                                        )}
                                    </div>
                                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">
                                        {t('basecamp.open_campfire')} →
                                    </span>
                                </div>
                            )

                        case 'schedule':
                            return (
                                <div
                                    key="tool-schedule"
                                    onClick={() => navigateTo({ project: project.id, tool: 'schedule' })}
                                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                                >
                                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                                            <Calendar size={18} />
                                            {t('basecamp.schedule')}
                                        </h2>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <MiniCalendar events={calendarEvents} t={t} />
                                        {calendarEvents && calendarEvents.length > 0 ? (
                                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                                                {calendarEvents.slice(0, 2).map((evt: any) => (
                                                    <div key={evt.id} className="flex items-center gap-2 text-xs">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                                                        <span className="text-slate-600 dark:text-slate-400 truncate flex-1 font-medium">
                                                            {evt.title}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 flex-shrink-0">
                                                            {formatShortDate(evt.starts_at, Boolean(evt.all_day))}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">
                                        {t('basecamp.view_schedule')} →
                                    </span>
                                </div>
                            )

                        case 'checkins':
                            return (
                                <div
                                    key="tool-checkins"
                                    onClick={() => navigateTo({ project: project.id, tool: 'checkins' })}
                                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                                >
                                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                                            <HelpCircle size={18} />
                                            {t('basecamp.checkins')}
                                        </h2>
                                    </div>
                                    <div className="flex-1 flex items-center justify-center">
                                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                                            {t('basecamp.checkins_desc')}
                                        </p>
                                    </div>
                                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">
                                        {t('basecamp.view_checkins')} →
                                    </span>
                                </div>
                            )
                    }
                })}
            </div>

            {/* ════════════════════════════════════════════════
                SECTION 5: LATEST ACTIVITY TIMELINE (Grouped by Day, Basecamp 3/4 Replica)
            ════════════════════════════════════════════════ */}
            <div className="mt-4 pt-6 border-t border-slate-200/80 dark:border-slate-800 max-w-4xl mx-auto w-full">
                <div className="flex items-center justify-center gap-3 mb-6">
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-red-600 dark:text-red-400 px-3 py-1 rounded-full bg-red-50/70 dark:bg-red-950/30 border border-red-200/60 dark:border-red-900/40">
                        {t('basecamp.recent_activity')}
                    </h3>
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                </div>

                {groupedActivityByDay.length > 0 ? (
                    <div className="space-y-7">
                        {groupedActivityByDay.map((group) => (
                            <div key={group.dayKey}>
                                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/70 dark:border-slate-800 pb-1.5 mb-3 capitalize">
                                    {group.dayLabel}
                                </div>
                                <div className="space-y-3.5">
                                    {group.items.map((act) => {
                                        const authorDisplay = act.author_name || t('basecamp.unknown_user')
                                        const cleanSnippet = stripHtml(act.content)
                                        let actionVerb = t('basecamp.commented_on')
                                        if (act.kind === 'todo_completed') actionVerb = t('basecamp.activity_complete_todo')
                                        else if (act.kind === 'todo_created') actionVerb = t('basecamp.activity_create_todo')
                                        else if (act.kind === 'message_created') actionVerb = t('basecamp.activity_create_message')
                                        else if (act.parent_type === 'todo') actionVerb = t('basecamp.activity_comment_todo')
                                        else if (act.parent_type === 'message') actionVerb = t('basecamp.activity_comment_message')
                                        else if (act.parent_type === 'document') actionVerb = t('basecamp.activity_comment_document')

                                        return (
                                            <div
                                                key={act.id}
                                                onClick={() => navigateToActivityTarget(act)}
                                                className="group/act flex items-start gap-3 p-3 rounded-xl bg-[#fcfaf6] dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-800/70 hover:bg-white dark:hover:bg-slate-800/60 hover:shadow-sm transition-all cursor-pointer"
                                            >
                                                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-bold w-16 shrink-0 pt-1">
                                                    {formatActivityTime(act.created_at)}
                                                </span>

                                                <div
                                                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 mt-0.5 shadow-sm"
                                                    style={{ backgroundColor: getAvatarColor(authorDisplay) }}
                                                >
                                                    {getInitials(authorDisplay)}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
                                                        <strong className="text-slate-900 dark:text-slate-100">
                                                            {formatAbbreviatedAuthor(act.author_name, t('basecamp.unknown_user'))}
                                                        </strong>{' '}
                                                        <span className="text-slate-500 dark:text-slate-400">{actionVerb}</span>{' '}
                                                        <span className="font-extrabold text-[#1D7DB5] hover:underline dark:text-blue-400">
                                                            {act.kind === 'todo_completed' && (
                                                                <CheckSquare size={13} className="inline text-emerald-600 mr-1 -mt-0.5" />
                                                            )}
                                                            {act.parent_title || act.parent_type}
                                                        </span>
                                                        {act.list_name && (
                                                            <span className="ml-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                                                {act.list_name}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {cleanSnippet && (
                                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                                            {cleanSnippet.slice(0, 200)}
                                                        </p>
                                                    )}

                                                    {act.images.length > 0 && (
                                                        <div className="flex flex-wrap gap-2 mt-2">
                                                            {act.images.map((imgUrl, iIdx) => (
                                                                <img
                                                                    key={iIdx}
                                                                    src={imgUrl}
                                                                    alt={t('basecamp.preview_thumbnail')}
                                                                    className="h-16 w-auto max-w-[140px] rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white shadow-sm"
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {act.parent_type?.toLowerCase().includes('todo') && act.parent_id && (
                                                    <button
                                                        type="button"
                                                        onClick={(ev) => {
                                                            ev.stopPropagation()
                                                            navigateTo({
                                                                project: project.id,
                                                                tool: 'todos',
                                                                replicateTodoId: act.parent_id || undefined,
                                                            })
                                                        }}
                                                        title={t('basecamp.replicate_task_tooltip')}
                                                        className="opacity-0 group-hover/act:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-[#1D7DB5] hover:text-white border border-blue-200/70 dark:border-blue-800 text-[#1D7DB5] dark:text-blue-300 text-[11px] font-extrabold shrink-0 cursor-pointer"
                                                    >
                                                        <span>📋</span>
                                                        <span className="hidden sm:inline">{t('basecamp.replicate_task')}</span>
                                                    </button>
                                                )}

                                                {(act.kind === 'message_created' || act.parent_type?.toLowerCase().includes('message')) && act.parent_id && (
                                                    <button
                                                        type="button"
                                                        onClick={(ev) => {
                                                            ev.stopPropagation()
                                                            navigateTo({
                                                                project: project.id,
                                                                tool: 'messages',
                                                                replicateMessageId: act.parent_id || undefined,
                                                            })
                                                        }}
                                                        title={t('basecamp.replicate_message_tooltip')}
                                                        className="opacity-0 group-hover/act:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-[#1D7DB5] hover:text-white border border-blue-200/70 dark:border-blue-800 text-[#1D7DB5] dark:text-blue-300 text-[11px] font-extrabold shrink-0 cursor-pointer"
                                                    >
                                                        <span>📋</span>
                                                        <span className="hidden sm:inline">{t('basecamp.replicate_message')}</span>
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center italic py-6">
                        {t('basecamp.no_recent_activity')}
                    </p>
                )}
            </div>

            {/* ════════════════════════════════════════════════
                Modal para Ajustar Progreso de Aguja
            ════════════════════════════════════════════════ */}
            {showNeedleModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowNeedleModal(false) }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">
                            {t('basecamp.move_needle')}
                        </h3>
                        <form onSubmit={handleUpdateNeedle} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('basecamp.progress_percentage')}</label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={manualProgress}
                                        onChange={(e) => setManualProgress(Number(e.target.value))}
                                        className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#1D7DB5]"
                                    />
                                    <span className="text-xl font-black text-slate-800 dark:text-slate-200 w-12 text-right">
                                        {manualProgress}%
                                    </span>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowNeedleModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow"
                                >
                                    {t('basecamp.adjust_needle')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
