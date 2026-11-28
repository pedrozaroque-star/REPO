/**
 * @module NewForYouDrawer
 * @description Panel lateral derecho de notificaciones (Hey!) y Pings para el módulo de Basecamp.
 *              Réplica funcional del menú lateral "New for you" de Basecamp.
 * @businessRules
 *   - Permite iniciar pings (mensajes directos) con colaboradores.
 *   - Muestra notificaciones de `bc_notifications`, pings entrantes y actividad reciente real de proyectos.
 *   - Permite filtrar notificaciones y colaboradores en tiempo real (insensible a acentos/mayúsculas).
 *   - Permite marcar todas las notificaciones como leídas con un solo click.
 * @dataFlow
 *   - Entrada: Props `isOpen`, `onClose`, `onMarkAllRead`, `onReadOne`, `navigateTo`.
 *   - Fetch: Resuelve al usuario mediante `resolveOrCreateTegPerson` y consulta `bc_notifications` (`type`, `recording_type`, `recording_id`), actividad y colaboradores en Supabase.
 *   - Escritura: Actualiza `bc_notifications.is_read = true` tanto individualmente al abrir una notificación como masivamente al marcar todas como leídas.
 * @notes
 *   - Soporte bilingüe completo (ES/EN) con `useLanguage()` y zona horaria `America/Los_Angeles`.
 *   - `cleanFeedSnippet` transforma menciones Basecamp (`application/vnd.basecamp.mention`) y TEG (`data-teg-mention-person-id`) a texto `@Nombre` antes de limpiar etiquetas HTML.
 *   - Sin consultas `.single()` frágiles que arrojen errores HTTP 406.
 *   - Privacidad estricta por proyecto (`bc_memberships` / `allowedProjectIds`): usuarios no-admin jamás ven notificaciones, tareas ni actividad de proyectos privados ajenos.
 *   - Rediseño Móvil + Web (2026-11-28): cajón `w-full sm:max-w-md h-[100dvh] z-[110]`, filas `min-w-0` con títulos de 2 líneas (`line-clamp-2`) y soporte completo dark mode.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import {
    resolveOrCreateTegPerson,
    canonicalizeBasecampEmail,
    canonicalizeBasecampDisplayName,
    isBasecampOAuthOwner,
    isMaskedOrEmptyEmail,
    normalizePersonName,
    stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Plus, Bell, CheckSquare, MessageSquare, FileText, Calendar,
    Search, X, Loader2, VolumeX, BellOff, AtSign
} from 'lucide-react'

interface NewForYouDrawerProps {
    isOpen: boolean
    onClose: () => void
    onMarkAllRead?: () => void
    onReadOne?: () => void
    allowedProjectIds?: string[]
    isAdmin?: boolean
    navigateTo: (params: {
        project?: string
        tool?: string
        section?: string
        ping?: string
        todoId?: string
        messageId?: string
        docId?: string
    }) => void
}

export function cleanFeedSnippet(raw?: string | null): string {
    if (!raw) return ''
    const { cleanHtml } = stripTegAuthorBanner(raw)
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
            if (figMatch?.[1]) {
                name = figMatch[1].replace(/<[^>]*>/g, '').trim()
            } else if (altMatch?.[1]) {
                name = altMatch[1].trim()
            } else if (contentAttr?.[1]) {
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
        .replace(/<span\b[^>]*\bdata-bc-mention=["']true["'][^>]*>([\s\S]*?)<\/span>/gi, (_m, inner: string) => {
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

const AVATAR_COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0D9488', '#DB2777', '#0284C7']
function getAvatarColor(name: string): string {
    const clean = (name || '?').trim() || '?'
    let hash = 0
    for (let i = 0; i < clean.length; i++) hash = clean.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
function getInitials(name: string): string {
    const clean = (name || '').trim()
    if (!clean) return '?'
    const parts = clean.split(/\s+/).filter(Boolean)
    return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : clean.slice(0, 2).toUpperCase()
}

function stripAccentsLower(s?: string | null): string {
    if (!s) return ''
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export default function NewForYouDrawer({
    isOpen,
    onClose,
    onMarkAllRead,
    onReadOne,
    allowedProjectIds,
    isAdmin = false,
    navigateTo,
}: NewForYouDrawerProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'
    const { user: authUser, loading: authLoading } = useAuth()
    const effectiveIsAdmin = Boolean(
        isAdmin || ['admin', 'administrador'].includes(String((authUser as any)?.role || '').trim().toLowerCase())
    )

    const [notifications, setNotifications] = useState<any[]>([])
    const [collaborators, setCollaborators] = useState<any[]>([])
    const [resolvedPersonId, setResolvedPersonId] = useState<string | null>(null)
    const [locallyReadIds, setLocallyReadIds] = useState<Set<string>>(() => new Set())
    const [loading, setLoading] = useState(true)
    const [filterQuery, setFilterQuery] = useState('')
    const [isSnoozed, setIsSnoozed] = useState(false)
    const [showPingSelect, setShowPingSelect] = useState(false)

    const getLastSeenStorageKey = (pid: string | null) =>
        `teg_bc_new_for_you_last_seen_${pid || canonicalizeBasecampEmail(authUser?.email) || 'anon'}`

    const loadDrawerData = useCallback(async () => {
        if (!authUser) return
        setLoading(true)
        try {
            const person = await resolveOrCreateTegPerson(supabase, {
                email: canonicalizeBasecampEmail(authUser.email),
                name: canonicalizeBasecampDisplayName(authUser.name, authUser.email),
                role: (authUser as any)?.role,
            })

            const personId = person?.id || null
            setResolvedPersonId(personId)

            const feedItems: any[] = []

            if (personId) {
                const sevenDaysAgo = new Date()
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

                const [membershipsRes, myTasksRes, peopleRes, dbNotifsRes, pingsRes] = await Promise.all([
                    supabase.from('bc_memberships').select('project_id').eq('person_id', personId),
                    supabase.from('bc_todo_assignees').select(`
                        todo:bc_todos(id, title, is_completed, updated_at, project_id,
                            project:bc_projects(bc_id, name)
                        )
                    `).eq('person_id', personId).limit(20),
                    supabase.from('bc_people').select('*').eq('is_active', true).order('name', { ascending: true }).limit(5000),
                    supabase.from('bc_notifications').select(`
                        id, type, title, description, recording_type, recording_id, is_read, created_at, project_id,
                        project:bc_projects(bc_id, name)
                    `).eq('person_id', personId).order('created_at', { ascending: false }).limit(30),
                    supabase.from('bc_pings').select(`
                        id, content, created_at,
                        sender:bc_people!bc_pings_sender_person_id_fkey(id, name)
                    `).eq('recipient_person_id', personId).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(10),
                ])

                const rawMemberProjectIds: string[] = membershipsRes.data?.map((m: any) => m.project_id).filter(Boolean) || []
                const passedSet = Array.isArray(allowedProjectIds) ? new Set(allowedProjectIds) : null
                const effectiveProjectIds: string[] = effectiveIsAdmin
                    ? Array.isArray(allowedProjectIds) && allowedProjectIds.length > 0
                        ? allowedProjectIds
                        : rawMemberProjectIds
                    : passedSet
                        ? rawMemberProjectIds.filter((id) => passedSet.has(id))
                        : rawMemberProjectIds
                const effectiveAllowedSet = new Set<string>(effectiveProjectIds)
                setCollaborators(peopleRes.data || [])

                if (dbNotifsRes.data) {
                    for (const n of dbNotifsRes.data) {
                        const nProjectId = (n as any).project_id as string | null
                        if (!effectiveIsAdmin && nProjectId && !effectiveAllowedSet.has(nProjectId)) {
                            continue
                        }
                        const proj = Array.isArray(n.project) ? n.project[0] : n.project
                        feedItems.push({
                            id: `notif-${n.id}`,
                            dbNotifId: n.id,
                            type: (n as any).type || n.recording_type || 'notification',
                            recording_type: n.recording_type || null,
                            recordingId: n.recording_id,
                            title: cleanFeedSnippet(n.title) || n.title,
                            description: cleanFeedSnippet(n.description),
                            project: proj,
                            created_at: n.created_at,
                            is_read: Boolean(n.is_read),
                        })
                    }
                }

                if (pingsRes.data) {
                    for (const p of pingsRes.data) {
                        const senderObj = Array.isArray((p as any).sender) ? (p as any).sender[0] : (p as any).sender
                        const senderName = senderObj?.name || t('basecamp.unknown_user')
                        feedItems.push({
                            id: `ping-${p.id}`,
                            type: 'ping',
                            recording_type: 'ping',
                            pingPartner: senderName,
                            title: `💬 ${senderName}`,
                            description: cleanFeedSnippet(p.content).slice(0, 110),
                            project: null,
                            created_at: p.created_at,
                            is_read: false,
                        })
                    }
                }

                if (myTasksRes.data) {
                    for (const row of myTasksRes.data) {
                        const rawTodo = (row as any).todo
                        const todo = Array.isArray(rawTodo) ? rawTodo[0] : rawTodo
                        if (!todo || !todo.updated_at) continue
                        if (!effectiveIsAdmin && (!todo.project_id || !effectiveAllowedSet.has(todo.project_id))) {
                            continue
                        }
                        const proj = Array.isArray(todo.project) ? todo.project[0] : todo.project
                        feedItems.push({
                            id: `todo-${todo.id}`,
                            type: todo.is_completed ? 'completed' : 'assigned',
                            recording_type: 'todo',
                            recordingId: todo.id,
                            title: todo.title,
                            description: todo.is_completed
                                ? t('basecamp.task_completed_notif')
                                : t('basecamp.task_assigned_notif'),
                            project: proj,
                            created_at: todo.updated_at,
                            is_read: Boolean(todo.is_completed),
                        })
                    }
                }

                if (effectiveProjectIds.length > 0) {
                    const [recentCommentsRes, recentMessagesRes] = await Promise.all([
                        supabase.from('bc_comments').select(`
                            id, content, created_at, parent_type, parent_id, author_person_id,
                            author:bc_people(name),
                            project:bc_projects(bc_id, name)
                        `).in('project_id', effectiveProjectIds).neq('author_person_id', personId).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(15),
                        supabase.from('bc_messages').select(`
                            id, title, created_at, comments_count, author_person_id,
                            author:bc_people(name),
                            project:bc_projects(bc_id, name)
                        `).in('project_id', effectiveProjectIds).neq('author_person_id', personId).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(10),
                    ])

                    if (recentCommentsRes.data) {
                        for (const c of recentCommentsRes.data) {
                            if ((c as any).author_person_id === personId) continue
                            const authorName =
                                (Array.isArray(c.author) ? (c.author as any)[0]?.name : (c.author as any)?.name) ||
                                t('basecamp.unknown_user')
                            const proj = Array.isArray(c.project) ? c.project[0] : c.project
                            const plainText = cleanFeedSnippet(c.content).slice(0, 110)
                            const resolvedParentType =
                                c.parent_type === 'message' ? 'message' : c.parent_type === 'document' ? 'document' : 'todo'
                            feedItems.push({
                                id: `comment-${c.id}`,
                                type: 'comment',
                                recording_type: resolvedParentType,
                                recordingId: c.parent_id,
                                title: `💬 ${authorName}`,
                                description: plainText || t('basecamp.new_comment_notif'),
                                project: proj,
                                created_at: c.created_at,
                                is_read: false,
                            })
                        }
                    }

                    if (recentMessagesRes.data) {
                        for (const m of recentMessagesRes.data) {
                            if ((m as any).author_person_id === personId) continue
                            const authorName =
                                (Array.isArray(m.author) ? (m.author as any)[0]?.name : (m.author as any)?.name) ||
                                t('basecamp.unknown_user')
                            const proj = Array.isArray(m.project) ? m.project[0] : m.project
                            feedItems.push({
                                id: `msg-${m.id}`,
                                type: 'message',
                                recording_type: 'message',
                                recordingId: m.id,
                                title: m.title || t('basecamp.new_msg_notif'),
                                description: `📢 ${authorName}${m.comments_count ? ` · ${m.comments_count} 💬` : ''}`,
                                project: proj,
                                created_at: m.created_at,
                                is_read: false,
                            })
                        }
                    }
                }
            } else {
                const { data: people } = await supabase
                    .from('bc_people')
                    .select('*')
                    .eq('is_active', true)
                    .order('name', { ascending: true })
                    .limit(5000)
                setCollaborators(people || [])
            }

            let lastSeenMs = 0
            try {
                const rawSeen = typeof window !== 'undefined' ? window.localStorage.getItem(getLastSeenStorageKey(personId)) : null
                if (rawSeen) {
                    const parsed = new Date(rawSeen).getTime()
                    if (Number.isFinite(parsed)) lastSeenMs = parsed
                }
            } catch { /* ignore storage errors */ }

            feedItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            const uniqueItems = feedItems
                .filter((item, idx, arr) => arr.findIndex((i) => i.id === item.id) === idx)
                .slice(0, 40)
                .map((item) => {
                    if (item.is_read || item.dbNotifId) return item
                    const itemMs = item.created_at ? new Date(item.created_at).getTime() : 0
                    if (lastSeenMs > 0 && itemMs > 0 && itemMs <= lastSeenMs) {
                        return { ...item, is_read: true }
                    }
                    return item
                })
            setNotifications(uniqueItems)
        } catch (err: any) {
            console.error('Error loading drawer data:', err.message)
        } finally {
            setLoading(false)
        }
    }, [authUser, supabase, t, effectiveIsAdmin, allowedProjectIds])

    useEffect(() => {
        if (isOpen && !authLoading && authUser) {
            loadDrawerData()
        } else if (isOpen && !authLoading && !authUser) {
            setLoading(false)
        }
    }, [isOpen, authUser, authLoading, loadDrawerData])

    // Close drawer on Escape
    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    // Mark all as read (visual state + localStorage last_seen_at + persist bc_notifications in Supabase)
    const handleMarkAllRead = async () => {
        const dbNotifIds = notifications.filter((n) => n.dbNotifId && !n.is_read).map((n) => n.dbNotifId)
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(getLastSeenStorageKey(resolvedPersonId), new Date().toISOString())
            }
        } catch { /* ignore storage errors */ }
        setLocallyReadIds((prev) => {
            const next = new Set(prev)
            notifications.forEach((n) => next.add(n.id))
            return next
        })
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
        onMarkAllRead?.()
        if (dbNotifIds.length > 0) {
            await supabase.from('bc_notifications').update({ is_read: true }).in('id', dbNotifIds)
        }
    }

    const getIcon = (type: string | null, recordingType?: string | null) => {
        const norm = (type || '').toLowerCase().trim()
        const recNorm = (recordingType || '').toLowerCase().trim()
        if (norm === 'mention' || norm.includes('mention')) {
            return <AtSign size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
        }
        if (norm === 'assigned') {
            return <CheckSquare size={16} className="text-amber-500 shrink-0" />
        }
        if (norm === 'completed') {
            return <CheckSquare size={16} className="text-emerald-600 shrink-0" />
        }
        if (norm === 'comment' || norm.includes('comment')) {
            return <MessageSquare size={16} className="text-blue-500 shrink-0" />
        }
        const combined = recNorm || norm
        if (combined.includes('todo') || combined.includes('list')) {
            return <CheckSquare size={16} className="text-emerald-500 shrink-0" />
        }
        if (combined.includes('message') || combined.includes('campfire') || combined.includes('ping') || combined.includes('chat')) {
            return <MessageSquare size={16} className="text-blue-500 shrink-0" />
        }
        if (combined.includes('doc') || combined.includes('file') || combined.includes('upload') || combined.includes('vault')) {
            return <FileText size={16} className="text-emerald-600 shrink-0" />
        }
        if (combined.includes('schedule') || combined.includes('event') || combined.includes('calendar')) {
            return <Calendar size={16} className="text-red-500 shrink-0" />
        }
        return <Bell size={16} className="text-slate-400 shrink-0" />
    }

    const getToolName = (type: string | null) => {
        if (!type) return undefined
        const rt = type.toLowerCase().trim()
        if (rt.includes('todo') || rt.includes('list') || rt === 'assigned' || rt === 'completed') return 'todos'
        if (rt.includes('message') || rt.includes('board')) return 'messages'
        if (rt.includes('chat') || rt.includes('campfire')) return 'campfire'
        if (rt.includes('document') || rt.includes('doc') || rt.includes('file') || rt.includes('upload') || rt.includes('vault')) return 'docs'
        if (rt.includes('schedule') || rt.includes('event') || rt.includes('calendar')) return 'schedule'
        if (rt.includes('checkin') || rt.includes('question') || rt.includes('answer')) return 'checkins'
        return undefined
    }

    const otherCollaborators = useMemo(() => {
        const selfEmail = canonicalizeBasecampEmail(authUser?.email)
        const selfNorm = normalizePersonName(
            canonicalizeBasecampDisplayName(authUser?.name, authUser?.email)
        )
        const selfIsOwner = isBasecampOAuthOwner(authUser?.email, authUser?.name)
        return collaborators.filter((c) => {
            if (resolvedPersonId && c.id === resolvedPersonId) return false
            if (selfEmail && !isMaskedOrEmptyEmail(c.email) && canonicalizeBasecampEmail(c.email) === selfEmail) {
                return false
            }
            if (selfIsOwner && isBasecampOAuthOwner(c.email, c.name)) return false
            if (selfNorm && normalizePersonName(c.name) === selfNorm) return false
            return true
        })
    }, [collaborators, resolvedPersonId, authUser?.name, authUser?.email])

    // Filter notifications (accent-insensitive)
    const filteredNotifications = useMemo(() => {
        if (!filterQuery.trim()) return notifications
        const q = stripAccentsLower(filterQuery.trim())
        return notifications.filter((n) => (
            stripAccentsLower(n.title).includes(q) ||
            stripAccentsLower(n.description).includes(q) ||
            stripAccentsLower(n.project?.name).includes(q)
        ))
    }, [notifications, filterQuery])

    const filteredPingCollaborators = useMemo(() => {
        if (!filterQuery.trim()) return otherCollaborators
        const q = stripAccentsLower(filterQuery.trim())
        const qPerson = normalizePersonName(filterQuery)
        return otherCollaborators.filter((c) => (
            stripAccentsLower(c.name).includes(q) ||
            (qPerson.length > 0 && normalizePersonName(c.name).includes(qPerson))
        ))
    }, [otherCollaborators, filterQuery])

    const formatDrawerTime = (dateStr?: string | null) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (Number.isNaN(d.getTime())) return ''
        const datePart = d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            timeZone: 'America/Los_Angeles',
        })
        const timePart = d.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles',
        })
        return `${datePart} · ${timePart}`
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[100] bg-slate-950/35 backdrop-blur-[1px]"
                    />

                    {/* Drawer container */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 26, stiffness: 240 }}
                        className="fixed right-0 top-0 bottom-0 z-[110] w-full sm:max-w-md h-[100dvh] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col font-sans"
                    >
                        {/* Header: Pings */}
                        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 shrink-0">
                            <div className="flex items-center justify-between gap-2 mb-2.5">
                                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                    {t('basecamp.pings')}
                                </h3>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                    title={t('basecamp.close_esc')}
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Helper sticky-note box */}
                            <div className="bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 text-slate-700 dark:text-amber-200/90 p-2.5 rounded-xl text-[11px] leading-relaxed mb-3.5 text-left">
                                {t('basecamp.pings_helper_note')}
                            </div>

                            {/* Horizontal actions list */}
                            <div className="flex gap-4 items-center">
                                <button
                                    onClick={() => setShowPingSelect(!showPingSelect)}
                                    className="flex flex-col items-center gap-1 group focus:outline-none"
                                >
                                    <div className="w-10 h-10 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 flex items-center justify-center text-slate-400 group-hover:text-blue-500 transition-colors bg-white dark:bg-slate-800">
                                        <Plus size={18} />
                                    </div>
                                    <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">
                                        {t('basecamp.ping_action')}
                                    </span>
                                </button>

                                {/* Collaborator quick list */}
                                <div className="flex -space-x-1.5 overflow-hidden py-0.5">
                                    {otherCollaborators.slice(0, 5).map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => {
                                                navigateTo({ section: 'pings', ping: c.name })
                                                onClose()
                                            }}
                                            className="w-10 h-10 rounded-full text-white font-bold ring-2 ring-white dark:ring-slate-900 flex items-center justify-center text-[11px] uppercase shadow-xs hover:-translate-y-0.5 transition-transform cursor-pointer shrink-0"
                                            style={{ backgroundColor: getAvatarColor(c.name || '?') }}
                                            title={c.name}
                                        >
                                            {getInitials(c.name || '?')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Dropdown search for ping collaborators */}
                            {showPingSelect && (
                                <div className="mt-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 max-h-[160px] overflow-y-auto shadow-lg text-left no-scrollbar">
                                    <p className="text-[9px] font-black text-slate-400 uppercase mb-2 px-2">
                                        {t('basecamp.start_chat_with')}
                                    </p>
                                    {filteredPingCollaborators.map((c) => (
                                        <button
                                            key={c.id}
                                            onClick={() => {
                                                navigateTo({ section: 'pings', ping: c.name })
                                                setShowPingSelect(false)
                                                onClose()
                                            }}
                                            className="w-full text-xs font-bold text-slate-700 dark:text-slate-300 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left block truncate"
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Mid Section: New For You (Notifications) */}
                        <div className="flex-1 overflow-y-auto p-4 flex flex-col no-scrollbar">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    {t('basecamp.new_for_you_title')}
                                </h3>
                                <button
                                    onClick={handleMarkAllRead}
                                    className="text-[10px] font-bold text-[#1D7DB5] hover:underline"
                                >
                                    {t('basecamp.mark_all_read')}
                                </button>
                            </div>

                            {loading ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                </div>
                            ) : filteredNotifications.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-center py-12">
                                    <BellOff size={32} className="mb-2 opacity-50" />
                                    <p className="text-xs italic">{t('basecamp.no_new_activity')}</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredNotifications.map((n) => {
                                        const isRead = Boolean(n.is_read || locallyReadIds.has(n.id))
                                        const tool = getToolName(n.recording_type || n.type)
                                        const projectBcId = n.project?.bc_id ? String(n.project.bc_id) : undefined

                                        return (
                                            <div
                                                key={n.id}
                                                onClick={() => {
                                                    if (!isRead) {
                                                        setLocallyReadIds((prev) => {
                                                            const next = new Set(prev)
                                                            next.add(n.id)
                                                            return next
                                                        })
                                                        setNotifications((prev) =>
                                                            prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
                                                        )
                                                        if (n.dbNotifId) {
                                                            onReadOne?.()
                                                            void supabase
                                                                .from('bc_notifications')
                                                                .update({ is_read: true })
                                                                .eq('id', n.dbNotifId)
                                                        }
                                                    }
                                                    if (n.type === 'ping' && n.pingPartner) {
                                                        navigateTo({ section: 'pings', ping: n.pingPartner })
                                                        onClose()
                                                        return
                                                    }
                                                    if (tool && projectBcId) {
                                                        const nav: {
                                                            project: string
                                                            tool: string
                                                            todoId?: string
                                                            messageId?: string
                                                            docId?: string
                                                        } = { project: projectBcId, tool }
                                                        if (n.recordingId) {
                                                            if (tool === 'todos') nav.todoId = String(n.recordingId)
                                                            else if (tool === 'messages') nav.messageId = String(n.recordingId)
                                                            else if (tool === 'docs') nav.docId = String(n.recordingId)
                                                        }
                                                        navigateTo(nav)
                                                        onClose()
                                                    }
                                                }}
                                                className={`flex gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 hover:shadow-2xs relative text-left min-w-0 ${
                                                    !isRead
                                                        ? 'bg-amber-50/40 border-amber-200/70 dark:bg-amber-950/15 dark:border-amber-900/30'
                                                        : 'bg-slate-50/70 border-slate-200/60 dark:bg-slate-800/30 dark:border-slate-800'
                                                }`}
                                            >
                                                {!isRead && (
                                                    <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-amber-500" />
                                                )}

                                                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200/70 dark:border-slate-700/60">
                                                    {getIcon(n.type, n.recording_type)}
                                                </div>

                                                <div className="flex-1 min-w-0 text-xs">
                                                    <h4 className="font-bold text-slate-900 dark:text-slate-100 line-clamp-2 break-words leading-snug pr-4">
                                                        {n.title}
                                                    </h4>
                                                    {n.description && (
                                                        <p className="text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed break-words">
                                                            {n.description}
                                                        </p>
                                                    )}
                                                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                        {n.project?.name && (
                                                            <span className="text-[9px] font-extrabold text-[#1D7DB5] dark:text-sky-400 uppercase tracking-wider bg-blue-50/70 dark:bg-blue-950/30 px-1.5 py-0.5 rounded border border-blue-200/50 dark:border-blue-800/50 truncate max-w-[180px]">
                                                                {n.project.name}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                                                            {formatDrawerTime(n.created_at)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer Section: Filter, Snooze, Close */}
                        <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex gap-2 items-center shrink-0 min-w-0">
                            <div className="relative flex-1 min-w-0">
                                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={filterQuery}
                                    onChange={(e) => setFilterQuery(e.target.value)}
                                    placeholder={t('basecamp.filter_placeholder')}
                                    className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#1D7DB5]"
                                />
                            </div>

                            <button
                                onClick={() => setIsSnoozed(!isSnoozed)}
                                className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1 ${
                                    isSnoozed
                                        ? 'bg-orange-500 border-orange-600 text-white shadow-inner'
                                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                                title={isSnoozed ? t('basecamp.snooze_active') : t('basecamp.snooze')}
                            >
                                <VolumeX size={13} />
                                <span className="hidden sm:inline">{t('basecamp.snooze_short')}</span>
                            </button>

                            <button
                                onClick={onClose}
                                className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                                title={t('basecamp.close_esc')}
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
