/**
 * @module BasecampProject
 * @description Vista detallada de un proyecto de Basecamp replicando fielmente el dashboard real de Basecamp 3.
 *              Muestra cabecera de proyecto con breadcrumb y avatares, feed de actividad reciente con autores,
 *              medidor de aguja de progreso, y cuadrícula de 6 tarjetas enriquecidas con vistas previas reales
 *              (To-dos con checkboxes, Messages con avatar+preview, Docs & Files con íconos por tipo,
 *              Campfire con burbujas de chat, Schedule con mini-calendario, y Check-ins).
 * @businessRules
 *   - El medidor de aguja gira en consonancia al porcentaje de tareas completadas de To-dos, o de forma manual.
 *   - Cada tarjeta de herramienta proporciona una vista previa con datos reales desde Supabase.
 *   - El feed de actividad muestra los últimos 3 comentarios con hora, autor y padre.
 *   - El mini-calendario resalta el día actual y los días con eventos programados.
 * @dataFlow
 *   - Pasa la navegación a través de navigateTo(project, tool).
 *   - Permite destacar o quitar destacado directamente.
 *   - Consulta bc_comments, bc_todos, bc_todolists, bc_messages, bc_documents, bc_uploads,
 *     bc_campfire_lines, bc_schedule_entries, bc_memberships y bc_people.
 * @notes
 *   - La variable `t` del i18n NO colisiona con las variables de mapeo de tareas (renombradas a `todo`).
 *   - bc_uploads se envuelve en try/catch por si la tabla no existe.
 *   - bc_comments NO tiene columna parent_title; se obtiene el título del padre con una consulta separada.
 */

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    Star, MessageSquare, ClipboardList, FolderOpen, Calendar, HelpCircle,
    Mail, Plus, Bell, Users, FileText
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

// ───────── Avatar helpers (shared pattern from ToolTodos) ─────────
const AVATAR_COLORS = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#8E44AD', '#1ABC9C', '#D35400', '#2980B9', '#C0392B', '#16A085']
const getAvatarColor = (name: string) => {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/)
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
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
    gray: { border: 'border-gray-300 dark:border-gray-700', bg: 'bg-gray-50 dark:bg-gray-850/40', text: 'text-gray-800 dark:text-gray-200', dot: 'bg-gray-500', theme: 'var(--recording-color-primary)' }
}

// ───────── Mini Calendar Component ─────────
function MiniCalendar({ events, t: tFn }: { events: any[]; t: (key: string) => string }) {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const todayDate = now.getDate()

    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // Build set of days that have events
    const eventDays = useMemo(() => {
        const days = new Set<number>()
        events.forEach(ev => {
            if (ev.starts_at) {
                const d = new Date(ev.starts_at)
                if (d.getMonth() === month && d.getFullYear() === year) {
                    days.add(d.getDate())
                }
            }
        })
        return days
    }, [events, month, year])

    const weekdayKeys = [
        'basecamp.weekday_sun', 'basecamp.weekday_mon', 'basecamp.weekday_tue',
        'basecamp.weekday_wed', 'basecamp.weekday_thu', 'basecamp.weekday_fri', 'basecamp.weekday_sat'
    ]

    const cells: (number | null)[] = []
    for (let i = 0; i < firstDay; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)

    return (
        <div className="mt-1">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0 mb-1">
                {weekdayKeys.map((key) => (
                    <div key={key} className="text-[10px] font-black text-slate-400 dark:text-slate-550 text-center uppercase">
                        {tFn(key)}
                    </div>
                ))}
            </div>
            {/* Day cells */}
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

// ───────── Types for enriched data ─────────
interface ActivityItem {
    id: string
    content: string
    created_at: string
    parent_type: string
    parent_title: string
    author_name: string
}

interface BasecampProjectProps {
    project: any
    navigateTo: (params: { project?: string; tool?: string; section?: string }) => void
    saveProjects: (projects: any[]) => void
    projects: any[]
    currentUserName: string
    onOpenSearch?: () => void
}

export default function BasecampProject({ project, navigateTo, saveProjects, projects, currentUserName, onOpenSearch }: BasecampProjectProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()

    // Progreso de aguja
    const [progressPercent, setProgressPercent] = useState(34)
    const [showNeedleModal, setShowNeedleModal] = useState(false)
    const [manualProgress, setManualProgress] = useState(34)

    // ───── Enriched state variables ─────
    const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([])
    const [activePeopleCount, setActivePeopleCount] = useState(0)
    const [activePeopleAvatars, setActivePeopleAvatars] = useState<string[]>([])

    // Tool card data
    const [firstTodoList, setFirstTodoList] = useState<{ name: string; tasks: any[] } | null>(null)
    const [lastMessages, setLastMessages] = useState<any[]>([])
    const [docsAndFiles, setDocsAndFiles] = useState<any[]>([])
    const [lastChat, setLastChat] = useState<any[]>([])
    const [calendarEvents, setCalendarEvents] = useState<any[]>([])
    const [projectMembers, setProjectMembers] = useState<any[]>([])

    // ───── Data Fetching ─────
    useEffect(() => {
        const fetchProjectDetails = async () => {
            if (!project.db_id) return

            try {
                const sevenDaysAgo = new Date()
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

                const startOfMonth = new Date()
                startOfMonth.setDate(1)
                startOfMonth.setHours(0, 0, 0, 0)
                const endOfMonth = new Date(startOfMonth)
                endOfMonth.setMonth(endOfMonth.getMonth() + 1)

                // ═══════════════════════════════════════════════════
                // Execute all primary dashboard queries in parallel (No waterfall)
                // ═══════════════════════════════════════════════════
                const [
                    resLists,
                    resComments,
                    resActivePeople,
                    resFirstList,
                    resMessages,
                    resDocs,
                    resUploads,
                    resChatLines,
                    resEvents,
                    resMembers
                ] = await Promise.all([
                    // 1. Progress count
                    supabase.from('bc_todolists').select('completed_count, total_count').eq('project_id', project.db_id),
                    // 2. Activity Feed
                    supabase.from('bc_comments').select('id, content, created_at, parent_type, parent_id, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(3),
                    // 3. Active people count
                    supabase.from('bc_comments').select('author_person_id, author:bc_people(name)').eq('project_id', project.db_id).gte('created_at', sevenDaysAgo.toISOString()),
                    // 4. First list info
                    supabase.from('bc_todolists').select('id, name, bc_id').eq('project_id', project.db_id).order('position', { ascending: true }).limit(1).maybeSingle(),
                    // 5. Messages
                    supabase.from('bc_messages').select('id, title, content, created_at, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    // 6. Docs
                    supabase.from('bc_documents').select('id, title, created_at, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    // 7. Uploads (Safely handled in case table is missing)
                    supabase.from('bc_uploads').select('id, filename, content_type, byte_size, created_at, author:bc_people(name), download_url').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    // 8. Campfire
                    supabase.from('bc_campfire_lines').select('id, content, created_at, author:bc_people(name)').eq('project_id', project.db_id).order('created_at', { ascending: false }).limit(5),
                    // 9. Schedule Entries
                    supabase.from('bc_schedule_entries').select('id, title, starts_at, ends_at, all_day').eq('project_id', project.db_id).gte('starts_at', startOfMonth.toISOString()).lt('starts_at', endOfMonth.toISOString()),
                    // 10. Memberships
                    supabase.from('bc_memberships').select('person:bc_people(id, name, role)').eq('project_id', project.db_id)
                ])

                // ═══════════════════════════════════════════════════
                // Process results
                // ═══════════════════════════════════════════════════

                // 1. Process Progress
                let totalCompleted = 0
                let totalTasks = 0
                if (resLists.data && resLists.data.length > 0) {
                    resLists.data.forEach((l: any) => {
                        totalCompleted += l.completed_count || 0
                        totalTasks += l.total_count || 0
                    })
                }
                const pct = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0
                setProgressPercent(pct)
                setManualProgress(pct)

                // 2. Process Activity Comments & Resolve Parent Titles in Parallel (No loop queries)
                if (resComments.data && resComments.data.length > 0) {
                    const activityItems = await Promise.all(resComments.data.map(async (c: any) => {
                        let parentTitle = ''
                        try {
                            if (c.parent_type === 'todo' && c.parent_id) {
                                const { data: parentTodo } = await supabase.from('bc_todos').select('title').eq('id', c.parent_id).maybeSingle()
                                parentTitle = parentTodo?.title || ''
                            } else if (c.parent_type === 'message' && c.parent_id) {
                                const { data: parentMsg } = await supabase.from('bc_messages').select('title').eq('id', c.parent_id).maybeSingle()
                                parentTitle = parentMsg?.title || ''
                            } else if (c.parent_type === 'document' && c.parent_id) {
                                const { data: parentDoc } = await supabase.from('bc_documents').select('title').eq('id', c.parent_id).maybeSingle()
                                parentTitle = parentDoc?.title || ''
                            }
                        } catch { /* ignore parent resolve errors */ }
                        return {
                            id: c.id,
                            content: c.content || '',
                            created_at: c.created_at,
                            parent_type: c.parent_type || 'unknown',
                            parent_title: parentTitle,
                            author_name: (c.author as any)?.name || 'Unknown'
                        }
                    }))
                    setRecentActivity(activityItems)
                } else {
                    setRecentActivity([])
                }

                // 3. Process Active People Count
                if (resActivePeople.data) {
                    const uniqueAuthors = new Map<string, string>()
                    resActivePeople.data.forEach((ap: any) => {
                        if (ap.author_person_id && !uniqueAuthors.has(ap.author_person_id)) {
                            uniqueAuthors.set(ap.author_person_id, (ap.author as any)?.name || 'U')
                        }
                    })
                    setActivePeopleCount(uniqueAuthors.size)
                    setActivePeopleAvatars(Array.from(uniqueAuthors.values()).slice(0, 8))
                }

                // 4. Process First List and fetch tasks
                if (resFirstList.data) {
                    const { data: listTasks } = await supabase
                        .from('bc_todos')
                        .select('id, title, is_completed')
                        .eq('todolist_id', resFirstList.data.id)
                        .order('position', { ascending: true })
                        .limit(10)

                    setFirstTodoList({
                        name: resFirstList.data.name || 'To-dos',
                        tasks: listTasks || []
                    })
                } else {
                    setFirstTodoList(null)
                }

                // 5. Process Messages
                if (resMessages.data) {
                    setLastMessages(resMessages.data.map((m: any) => ({
                        id: m.id,
                        title: m.title,
                        content: m.content,
                        created_at: m.created_at,
                        author: (m.author as any)?.name || 'Unknown'
                    })))
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
                            author: (d.author as any)?.name || 'Unknown',
                            file_type: 'doc'
                        })
                    })
                }
                if (resUploads.data) {
                    resUploads.data.forEach((u: any) => {
                        const isGoogle = u.download_url?.includes('docs.google.com') || u.download_url?.includes('drive.google.com') ||
                            u.content_type?.endsWith('.document') || u.content_type?.endsWith('.spreadsheet')
                        const ext = u.filename?.split('.').pop()?.toLowerCase() || ''
                        let fileType = 'file'
                        if (isGoogle) fileType = 'google_doc'
                        else if (ext === 'pdf') fileType = 'pdf'
                        else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) fileType = 'screenshot'

                        allDocsFiles.push({
                            id: u.id,
                            title: u.filename || 'File',
                            created_at: u.created_at,
                            author: (u.author as any)?.name || 'Unknown',
                            file_type: fileType
                        })
                    })
                }
                allDocsFiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                setDocsAndFiles(allDocsFiles.slice(0, 7))

                // 8. Process Campfire Lines
                if (resChatLines.data) {
                    const mappedChat = resChatLines.data.map((c: any) => ({
                        id: c.id,
                        author: (c.author as any)?.name || 'Unknown',
                        message: c.content,
                        created_at: c.created_at
                    })).reverse()
                    setLastChat(mappedChat)
                } else {
                    setLastChat([])
                }

                // 9. Process Calendar Events
                setCalendarEvents(resEvents.data || [])

                // 10. Process Members
                if (resMembers.data) {
                    setProjectMembers(resMembers.data.map((m: any) => ({
                        name: (m.person as any)?.name || 'Unknown',
                        role: (m.person as any)?.role || 'user'
                    })))
                } else {
                    setProjectMembers([])
                }

            } catch (err: any) {
                console.error('Error loading project dashboard:', err.message)
            }
        }

        fetchProjectDetails()
    }, [project.id, project.db_id])

    // ───── Handlers ─────
    const handleUpdateNeedle = (e: React.FormEvent) => {
        e.preventDefault()
        setProgressPercent(manualProgress)
        setShowNeedleModal(false)
    }

    const togglePin = () => {
        const updated = projects.map(p => p.id === project.id ? { ...p, is_pinned: !p.is_pinned } : p)
        saveProjects(updated)
    }

    // Format time for activity feed
    const formatActivityTime = (dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
    }

    // Format date for card previews
    const formatShortDate = (dateStr: string) => {
        const d = new Date(dateStr)
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        return `${months[d.getMonth()]} ${d.getDate()}`
    }

    // Strip HTML tags from content previews
    const stripHtml = (html: string) => {
        return html?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() || ''
    }

    // Needle rotation: 0% = -90deg, 100% = +90deg
    const needleRotationAngle = -90 + (progressPercent / 100) * 180

    const colorStyles = COLOR_CLASSES[project.color] || COLOR_CLASSES.white

    // Determine people display
    const membersToShow = projectMembers.length > 0 ? projectMembers : (project.people || [])
    const memberCount = membersToShow.length

    // File type icon helpers
    const getFileTypeIcon = (fileType: string) => {
        switch (fileType) {
            case 'google_doc': return { color: '#34A853', label: t('basecamp.google_doc') }
            case 'pdf': return { color: '#EA4335', label: t('basecamp.pdf_file') }
            case 'screenshot': return { color: '#4285F4', label: t('basecamp.screenshot_file') }
            case 'doc': return { color: '#4285F4', label: 'Doc' }
            default: return { color: '#6B7B8D', label: 'File' }
        }
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
                            className="text-sm text-slate-400 hover:text-slate-650 dark:hover:text-slate-300 font-bold"
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
                            {membersToShow.slice(0, 5).map((m: any, idx: number) => (
                                <div
                                    key={idx}
                                    className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[10px] font-black text-white"
                                    style={{ backgroundColor: getAvatarColor(m.name) }}
                                    title={m.name}
                                >
                                    {getInitials(m.name)}
                                </div>
                            ))}
                            {memberCount > 5 && (
                                <div className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900 bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                    +{memberCount - 5}
                                </div>
                            )}
                        </div>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300 text-xs font-bold">
                            <Users size={14} />
                            {t('basecamp.invite')}
                        </button>
                    </div>
                    {onOpenSearch && (
                        <div 
                            onClick={onOpenSearch}
                            className="border border-slate-200/60 dark:border-slate-800 bg-[#fffdf9] dark:bg-slate-900 px-3 py-1 rounded-lg text-[11px] font-semibold text-slate-500 dark:text-slate-400 shadow-inner cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all flex items-center gap-1.5"
                        >
                            {t('language') === 'es' ? (
                                <span>Presione <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border text-[9px] mx-0.5 font-bold">Shift</kbd> + <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border text-[9px] mx-0.5 font-bold">J</kbd> para buscar</span>
                            ) : (
                                <span>Press <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border text-[9px] mx-0.5 font-bold">Shift</kbd> + <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border text-[9px] mx-0.5 font-bold">J</kbd> to search</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ════════════════════════════════════════════════
                SECTION 2: FEED & GAUGE
            ════════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Recent Activity Feed */}
                <div className="lg:col-span-2 bg-[#fcfaf6] dark:bg-slate-800/20 border border-slate-300 dark:border-slate-800/60 rounded-2xl p-5 shadow-sm">
                    {recentActivity.length > 0 ? (
                        <div className="space-y-2">
                            {recentActivity.map((act) => (
                                <div key={act.id} className="flex items-start gap-3 text-sm">
                                    <span className="mt-2 w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                                    <span className="text-slate-400 dark:text-slate-500 font-semibold w-16 flex-shrink-0">
                                        {formatActivityTime(act.created_at)}
                                    </span>
                                    <span className="text-slate-700 dark:text-slate-300">
                                        <strong>{act.author_name.split(' ')[0]} {act.author_name.split(' ').length > 1 ? act.author_name.split(' ')[act.author_name.split(' ').length - 1][0] + '.' : ''}</strong>
                                        {' '}
                                        {t('basecamp.commented_on')}
                                        {' '}
                                        <button
                                            onClick={() => {
                                                const pType = act.parent_type?.toLowerCase()
                                                let tool = ''
                                                if (pType?.includes('todo')) tool = 'todos'
                                                else if (pType?.includes('message') || pType?.includes('board')) tool = 'messages'
                                                else if (pType?.includes('document') || pType?.includes('doc') || pType?.includes('file')) tool = 'docs'
                                                else if (pType?.includes('chat') || pType?.includes('campfire')) tool = 'campfire'
                                                else if (pType?.includes('schedule') || pType?.includes('event') || pType?.includes('calendar')) tool = 'schedule'
                                                else if (pType?.includes('checkin') || pType?.includes('question')) tool = 'checkins'
                                                
                                                if (tool) navigateTo({ project: project.id, tool })
                                            }}
                                            className="font-bold text-[#1D7DB5] hover:text-[#155D8A] hover:underline dark:text-blue-400 dark:hover:text-blue-300 transition-colors inline-flex items-center text-left"
                                        >
                                            {act.parent_title || act.parent_type}
                                        </button>
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-slate-400 dark:text-slate-500 text-center italic">
                            {t('basecamp.no_recent_activity')}
                        </p>
                    )}

                    {/* Active people bar */}
                    {activePeopleCount > 0 && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                            <div className="flex -space-x-1">
                                {activePeopleAvatars.slice(0, 6).map((name, idx) => (
                                    <div
                                        key={idx}
                                        className="w-5 h-5 rounded-full border border-white dark:border-slate-800 flex items-center justify-center text-[7px] font-black text-white"
                                        style={{ backgroundColor: getAvatarColor(name) }}
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
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer ml-1">
                                — {t('basecamp.view_all_activity')}
                            </span>
                        </div>
                    )}
                </div>

                {/* Progress Gauge */}
                <div className="bg-[#fcfaf6] dark:bg-slate-800/30 border border-slate-300 dark:border-slate-800/60 p-6 rounded-2xl flex flex-col items-center justify-center gap-3 shadow-sm">
                    <h3 className="text-base font-black text-slate-800 dark:text-slate-100">
                        {t('basecamp.project_progress')}
                    </h3>
                    
                    <div className="relative w-[200px] h-[100px] overflow-hidden select-none">
                        <svg className="absolute w-[200px] h-[100px] top-0 overflow-visible" viewBox="0 0 200 100">
                            <path
                                d="M 10 100 A 90 90 0 0 1 190 100"
                                fill="none"
                                stroke="#e2e8f0"
                                strokeWidth="8"
                                className="dark:stroke-slate-700"
                            />
                            <path
                                d="M 10 100 A 90 90 0 0 1 190 100"
                                fill="none"
                                stroke="#4BAE4F"
                                strokeWidth="8"
                                strokeDasharray="282"
                                strokeDashoffset={282 - (progressPercent / 100) * 282}
                                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                            />
                        </svg>

                        {/* Pin de la aguja */}
                        <div className="absolute bottom-0 left-[94px] w-8 h-8 rounded-full bg-slate-800 dark:bg-slate-600 border-4 border-white dark:border-slate-900 z-20 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        </div>

                        {/* La Aguja */}
                        <div
                            className="absolute bottom-4 left-[107px] w-1.5 h-20 bg-slate-800 dark:bg-slate-200 origin-bottom rounded-t-full z-10 transition-transform duration-500 ease-out"
                            style={{ transform: `rotate(${needleRotationAngle}deg)` }}
                        />

                        {/* Valor en porcentaje */}
                        <span className="absolute bottom-1 right-0 left-0 text-center text-2xl font-black text-slate-800 dark:text-slate-100">
                            {progressPercent}%
                        </span>
                    </div>

                    <button
                        onClick={() => setShowNeedleModal(true)}
                        className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 shadow-sm"
                    >
                        {t('basecamp.move_needle')}
                    </button>
                </div>
            </div>

            {/* ════════════════════════════════════════════════
                SECTION 4: TOOL CARDS GRID (3 columns, rich previews)
            ════════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* ─────── Card 1: TO-DOS (tall card with checkboxes) ─────── */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'todos' })}
                    className="bg-white dark:bg-slate-900 border-2 border-slate-300/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-md hover:shadow-xl hover:border-slate-400 dark:hover:border-slate-600 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
                >
                    <div className="border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                        <h2 className="text-base font-extrabold text-red-600 flex items-center gap-2">
                            <ClipboardList size={18} />
                            {t('basecamp.todos')}
                        </h2>
                    </div>

                    {firstTodoList ? (
                        <div className="flex-1">
                            {/* List name with colored dot */}
                            <div className="flex items-center gap-2 mb-2.5">
                                <span className="w-2 h-2 rounded-full bg-green-500" />
                                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-300">{firstTodoList.name}</span>
                            </div>
                            {/* Task checkboxes */}
                            <div className="space-y-1.5">
                                {firstTodoList.tasks.map((todo) => (
                                    <div key={todo.id} className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={todo.is_completed}
                                            readOnly
                                            className="rounded text-green-600 focus:ring-green-500 w-4 h-4 flex-shrink-0"
                                        />
                                        <span className={`truncate flex-1 ${todo.is_completed ? 'line-through text-slate-400 dark:text-slate-600' : 'text-slate-650 dark:text-slate-300'}`}>
                                            {todo.title}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-4 text-center flex-1">
                            {t('basecamp.no_todos')}
                        </p>
                    )}
                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">{t('basecamp.manage_tasks')} →</span>
                </div>

                {/* ─────── Card 2: MESSAGE BOARD (with avatar + preview) ─────── */}
                <div
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
                            lastMessages.slice(0, 3).map((msg) => (
                                <div key={msg.id} className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800/30 pb-3 last:border-0">
                                    {/* Author avatar */}
                                    <div
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 mt-0.5 shadow-sm"
                                        style={{ backgroundColor: getAvatarColor(msg.author) }}
                                    >
                                        {getInitials(msg.author)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{msg.author}</span>
                                            <span className="text-[10px] text-slate-400">{formatShortDate(msg.created_at)}</span>
                                        </div>
                                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate leading-snug">{msg.title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-500 line-clamp-2 leading-relaxed">
                                            {stripHtml(msg.content || '').slice(0, 120)}
                                        </p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                {t('basecamp.no_messages')}
                            </p>
                        )}
                    </div>
                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">{t('basecamp.view_board')} →</span>
                </div>

                {/* ─────── Card 3: DOCS & FILES (with file type icons) ─────── */}
                <div
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
                                return (
                                    <div key={doc.id} className="flex items-center gap-2.5 text-sm">
                                        <div
                                            className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0 shadow-sm"
                                            style={{ backgroundColor: typeInfo.color + '18' }}
                                        >
                                            <FileText size={14} style={{ color: typeInfo.color }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-750 dark:text-slate-300 truncate leading-none mb-0.5">
                                                {doc.title}
                                            </p>
                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                                                {typeInfo.label} • {doc.author.split(' ')[0]} • {formatShortDate(doc.created_at)}
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
                    <span className="text-xs font-black text-[#1D7DB5] mt-3 uppercase tracking-wider">{t('basecamp.explore_docs')} →</span>
                </div>

            </div>

            {/* ════════════════════════════════════════════════
                Modal para Ajustar Progreso de Aguja
            ════════════════════════════════════════════════ */}
            {showNeedleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-slate-855 dark:text-slate-100 mb-4">
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
                                    <span className="text-xl font-black text-slate-850 dark:text-slate-200 w-12 text-right">
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
